import assert from 'node:assert/strict';
import test from 'node:test';
import {createCLIProxyProvider, normalizeModel} from '../index.ts';

const baseRequest = (overrides: Record<string, unknown> = {}) => ({
	model: 'cliproxy-gpt-5.6-luna',
	messages: [{role: 'user', content: [{type: 'text', text: 'Hello'}]}],
	tools: [],
	...overrides,
});

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: {'content-type': 'application/json'},
	});
}

function sseResponse(chunks: string[], contentType = 'text/event-stream'): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: {'content-type': contentType},
	});
}

function providerWithFetch(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
	return createCLIProxyProvider({
		baseUrl: 'http://proxy.test/v1/',
		apiKey: 'config-key',
		fetchImpl,
		timeoutMs: 1_000,
		...options,
	});
}

test('normalizes proxy and compatibility model ids', () => {
	assert.equal(normalizeModel('cliproxy-gpt-5.6-luna'), 'gpt-5.6-luna');
	assert.equal(normalizeModel('claude-sonnet-5'), 'gpt-5.6-sol');
	assert.equal(normalizeModel('custom-model'), 'custom-model');
});

test('handles a JSON text response and forwards normalized request fields', async () => {
	let request: {url: string; init: RequestInit} | undefined;
	const provider = providerWithFetch(async (url, init) => {
		request = {url: String(url), init: init ?? {}};
		return jsonResponse({
			choices: [{message: {content: 'OK'}, finish_reason: 'stop'}],
			usage: {prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: {cached_tokens: 2}},
		});
	});
	const deltas: string[] = [];
	const result = await provider.transport.stream({
		...baseRequest(),
		effort: 'max',
		maxTokens: 32,
		onTextDelta: (text: string) => deltas.push(text),
	});

	assert.equal(request?.url, 'http://proxy.test/v1/chat/completions');
	const body = JSON.parse(String(request?.init.body));
	assert.equal(body.model, 'gpt-5.6-luna');
	assert.equal(body.stream, true);
	assert.equal(body.reasoning_effort, 'max');
	assert.equal(body.max_tokens, 32);
	assert.equal(request?.init.headers && new Headers(request.init.headers).get('authorization'), 'Bearer config-key');
	assert.deepEqual(deltas, ['OK']);
	assert.deepEqual(result.content, [{type: 'text', text: 'OK'}]);
	assert.equal(result.stopReason, 'end_turn');
	assert.equal(result.usage.inputTokens, 10);
	assert.equal(result.usage.outputTokens, 4);
	assert.equal(result.usage.cacheReadTokens, 2);
});

test('parses SSE split across arbitrary byte chunks and emits reasoning separately', async () => {
	const provider = providerWithFetch(async () =>
		sseResponse([
			'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"think"},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{"reasoning_content":"ing","content":"O"},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{"content":"K"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
			'data: [DONE]\n\n',
		],
	));
	const events: string[] = [];
	const result = await provider.transport.stream({
		...baseRequest(),
		onThinkingStart: () => events.push('thinking-start'),
		onThinkingDelta: (text: string) => events.push(`thinking:${text}`),
		onThinkingEnd: (text: string) => events.push(`thinking-end:${text}`),
		onTextDelta: (text: string) => events.push(`text:${text}`),
	});

	assert.deepEqual(events, [
		'thinking-start',
		'thinking:think',
		'thinking:ing',
		'text:O',
		'text:K',
		'thinking-end:thinking',
	]);
	assert.deepEqual(result.content, [{type: 'text', text: 'OK'}]);
	assert.equal(result.stopReason, 'end_turn');
	assert.equal(result.usage.inputTokens, 7);
});

test('accumulates fragmented SSE tool calls by index', async () => {
	const provider = providerWithFetch(async () =>
		sseResponse([
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_","arguments":"{\\"city\\":"}}]},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"\\"Bogota\\"}"}}]},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n',
			'data: [DONE]\n\n',
		],
	));
	const result = await provider.transport.stream(baseRequest({
		tools: [{name: 'get_weather', description: 'Weather', input_schema: {type: 'object'}}],
	}));

	assert.deepEqual(result.content, [{
		type: 'tool_use',
		id: 'call_1',
		name: 'get_weather',
		input: {city: 'Bogota'},
	}]);
	assert.equal(result.stopReason, 'tool_use');
});

test('accumulates multiple fragmented tool calls in index order', async () => {
	const provider = providerWithFetch(async () => sseResponse([
		'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"second","arguments":"{}"}},{"index":0,"id":"call_1","function":{"name":"first","arguments":"{\\"x\\":"}}]},"finish_reason":null}]}\n\n',
		'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}\n\n',
		'data: [DONE]\n\n',
	]));
	const result = await provider.transport.stream(baseRequest());
	assert.deepEqual(result.content, [
		{type: 'tool_use', id: 'call_1', name: 'first', input: {x: 1}},
		{type: 'tool_use', id: 'call_2', name: 'second', input: {}},
	]);
});

test('rejects invalid fragmented tool arguments', async () => {
	const provider = providerWithFetch(async () => sseResponse([
		'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"bad","arguments":"{oops"}}]},"finish_reason":"tool_calls"}]}\n\n',
		'data: [DONE]\n\n',
	]));
	await assert.rejects(provider.transport.stream(baseRequest()), /invalid JSON arguments/);
});

test('rejects OpenAI error events and empty SSE streams', async () => {
	const errorProvider = providerWithFetch(async () => sseResponse([
		'data: {"error":{"type":"server_error","code":"overloaded","message":"try later"}}\n\n',
		'data: [DONE]\n\n',
	]));
	await assert.rejects(errorProvider.transport.stream(baseRequest()), /overloaded.*try later/);

	const emptyProvider = providerWithFetch(async () => sseResponse(['data: [DONE]\n\n']));
	await assert.rejects(emptyProvider.transport.stream(baseRequest()), /without a valid choice/);
});

test('rejects malformed SSE JSON', async () => {
	const provider = providerWithFetch(async () => sseResponse(['data: {not-json}\n\n']));
	await assert.rejects(provider.transport.stream(baseRequest()), /invalid SSE event/);
});

test('uses a mutable effort getter for later requests', async () => {
	let effort = 'low';
	const bodies: any[] = [];
	const provider = providerWithFetch(async (_url, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		return jsonResponse({choices: [{message: {content: 'OK'}, finish_reason: 'stop'}]});
	}, {getEffort: () => effort});
	await provider.transport.stream(baseRequest());
	effort = 'max';
	await provider.transport.stream(baseRequest());
	assert.equal(bodies[0].reasoning_effort, 'low');
	assert.equal(bodies[1].reasoning_effort, 'max');
});

test('converts timeout aborts into a useful timeout error', async () => {
	const provider = providerWithFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
		init?.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), {once: true});
	}), {timeoutMs: 5});
	await assert.rejects(provider.transport.stream(baseRequest()), /timed out after 5ms/);
});

test('factory registers once and updates model, effort, and status live', async () => {
	const tempRoot = process.env.TEMP ?? process.env.TMP ?? '.';
	const configPath = `${tempRoot}/cliproxy-test-${Date.now()}.json`;
	const settingsPath = `${tempRoot}/settings-cliproxy-test-${Date.now()}.json`;
	const fs = await import('node:fs');
	fs.writeFileSync(settingsPath, '{"sentinel":true}\n');
	const calls: any = {providers: 0, model: [], effort: []};
	let selected = 'cliproxy-gpt-5.6-luna';
	const command: any = {
		addProvider: (provider: any) => { calls.providers += 1; calls.provider = provider; },
		addCommand: (command: any) => { calls.command = command; },
		addRenderer: () => undefined,
		on: () => undefined,
		hooks: () => undefined,
		setModel: (value: string) => calls.model.push(value),
		setEffort: (value: string) => calls.effort.push(value),
	};
	const {createCLIProxyMod} = await import('../index.ts');
	createCLIProxyMod(command, {
		configPath,
		config: {baseUrl: 'http://proxy.test/v1', apiKey: 'test', model: 'cliproxy-gpt-5.6-sol', effort: 'low'},
		fetchImpl: async () => jsonResponse({choices: [{message: {content: 'OK'}, finish_reason: 'stop'}]}),
	});
	assert.equal(calls.providers, 1);
	assert.deepEqual(calls.model, ['cliproxy-gpt-5.6-sol']);
	assert.deepEqual(calls.effort, ['low']);
	command.ui = {select: async () => selected};
	const modelResult = await calls.command.handler({args: 'model', ui: command.ui});
	assert.match(modelResult.message, /cliproxy-gpt-5.6-luna/);
	assert.equal(calls.model.at(-1), 'cliproxy-gpt-5.6-luna');
	selected = 'max';
	const effortResult = await calls.command.handler({args: 'effort', ui: command.ui});
	assert.match(effortResult.message, /max/);
	assert.equal(calls.effort.at(-1), 'max');
	const status = await calls.command.handler({args: '', ui: command.ui});
	assert.match(status.message, /cliproxy-gpt-5.6-luna/);
	assert.match(status.message, /Effort: max/);
	assert.equal(fs.existsSync(configPath), true);
	assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"sentinel":true}\n');
	fs.rmSync(configPath, {force: true});
	fs.rmSync(settingsPath, {force: true});
});

test('tool calls win over an inconsistent stop finish reason', async () => {
	const provider = providerWithFetch(async () => jsonResponse({
		choices: [{
			message: {tool_calls: [{id: 'call_1', type: 'function', function: {name: 'noop', arguments: '{}'}}]},
			finish_reason: 'stop',
		}],
	}));
	const result = await provider.transport.stream(baseRequest());
	assert.equal(result.stopReason, 'tool_use');
	assert.equal(result.content[0].type, 'tool_use');
});

test('maps a length finish reason to max_tokens', async () => {
	const provider = providerWithFetch(async () => jsonResponse({
		choices: [{message: {content: 'partial'}, finish_reason: 'length'}],
	}));
	const result = await provider.transport.stream(baseRequest());
	assert.equal(result.stopReason, 'max_tokens');
});

test('maps tool results to OpenAI role=tool messages', async () => {
	let body: any;
	const provider = providerWithFetch(async (_url, init) => {
		body = JSON.parse(String(init?.body));
		return jsonResponse({choices: [{message: {content: '4'}, finish_reason: 'stop'}]});
	});
	await provider.transport.stream(baseRequest({
		messages: [
			{role: 'user', content: [{type: 'text', text: 'Calculate'}]},
			{role: 'assistant', content: [{type: 'tool_use', id: 'call_1', name: 'calculator', input: {expression: '2+2'}}]},
			{role: 'user', content: [{type: 'tool_result', tool_use_id: 'call_1', content: [{type: 'text', text: '4'}]}]},
		],
	}));
	assert.deepEqual(body.messages, [
		{role: 'user', content: 'Calculate'},
		{role: 'assistant', content: null, tool_calls: [{
			id: 'call_1', type: 'function', function: {name: 'calculator', arguments: '{"expression":"2+2"}'},
		}]},
		{role: 'tool', tool_call_id: 'call_1', content: '4'},
	]);
});

test('prefers Command Code auth headers over config or environment keys', async () => {
	let authorization = '';
	const provider = providerWithFetch(async (_url, init) => {
		authorization = new Headers(init?.headers).get('authorization') ?? '';
		return jsonResponse({choices: [{message: {content: 'OK'}, finish_reason: 'stop'}]});
	});
	await provider.transport.stream(baseRequest({auth: {headers: {Authorization: 'Bearer runtime-key'}}}));
	assert.equal(authorization, 'Bearer runtime-key');
});

test('propagates caller cancellation to fetch', async () => {
	let fetchSignal: AbortSignal | undefined;
	const provider = providerWithFetch((_url, init) => {
		fetchSignal = init?.signal as AbortSignal | undefined;
		return new Promise<Response>((_resolve, reject) => {
			fetchSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true});
		});
	});
	const controller = new AbortController();
	const pending = provider.transport.stream(baseRequest({signal: controller.signal}));
	controller.abort();
	await assert.rejects(pending, /abort/i);
	assert.equal(fetchSignal?.aborted, true);
});

test('reports HTTP and malformed response errors', async () => {
	const httpProvider = providerWithFetch(async () => jsonResponse({error: {message: 'overloaded'}}, 503));
	await assert.rejects(httpProvider.transport.stream(baseRequest()), /CLIProxyAPI HTTP 503: overloaded/);

	const malformedProvider = providerWithFetch(async () => new Response('{bad json', {
		status: 200,
		headers: {'content-type': 'application/json'},
	}));
	await assert.rejects(malformedProvider.transport.stream(baseRequest()), /invalid JSON|JSON/i);
});
