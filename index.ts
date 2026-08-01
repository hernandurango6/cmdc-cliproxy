// CLIProxyAPI provider for Command Code.
//
// This file is a pure Command Code mod: it registers one direct provider and
// a small set of optional TUI helpers. Configuration lives in
// ~/.commandcode/cliproxy.json or in CLIPROXY_* environment variables.
import {homedir} from 'node:os';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

export const CONFIG_PATH = join(homedir(), '.commandcode', 'cliproxy.json');
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8317/v1';
export const DEFAULT_MODEL = 'cliproxy-gpt-5.6-sol';
export const DEFAULT_EFFORT = 'high';
export const PREF_MODEL_KEY = 'model';
export const PREF_EFFORT_KEY = 'effort';

export const MODELS = [
	{ id: 'cliproxy-gpt-5.6-sol', name: 'GPT-5.6 Sol (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'cliproxy-gpt-5.6-terra', name: 'GPT-5.6 Terra (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'cliproxy-gpt-5.6-luna', name: 'GPT-5.6 Luna (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'cliproxy-gpt-5.5', name: 'GPT-5.5 (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh'] },
	{ id: 'cliproxy-gpt-5.4', name: 'GPT-5.4 (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh'] },
	{ id: 'cliproxy-gpt-5.4-mini', name: 'GPT-5.4 Mini (CLIProxyAPI)', efforts: ['low', 'medium', 'high'] },
	{
		id: 'cliproxy-codex-auto-review',
		name: 'Codex Auto Review (CLIProxyAPI; currently resolves to GPT-5.4)',
		efforts: ['low', 'medium', 'high'],
	},
] as const;

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export type CLIProxyModelId = (typeof MODELS)[number]['id'];

const MODEL_IDS = MODELS.map((model) => model.id);
const PLACEHOLDER = (value: unknown): value is string =>
	typeof value !== 'string' || value.length === 0 || value.startsWith('YOUR_');

export interface CLIProxyConfig {
	baseUrl?: string;
	apiKey?: string;
	model?: CLIProxyModelId;
	effort?: Effort;
}

export interface CLIProxyProviderOptions {
	baseUrl?: string;
	apiKey?: string;
	defaultEffort?: string;
	getEffort?: () => string | undefined;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

export interface CLIProxyRequest {
	model: string;
	messages?: readonly any[];
	system?: string | ((input: unknown) => string | Promise<string>);
	tools?: readonly any[];
	effort?: string;
	reasoning?: string;
	temperature?: number;
	maxTokens?: number;
	maxOutputTokens?: number;
	signal?: AbortSignal;
	auth?: {headers?: HeadersInit};
	onThinkingStart?: () => void;
	onThinkingDelta?: (text: string) => void;
	onThinkingEnd?: (text: string) => void;
	onTextDelta?: (text: string) => void;
}

export interface CLIProxyResponse {
	content: any[];
	stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
	rawFinishReason: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
	};
	raw?: unknown;
}

export const CONFIG_SKELETON = JSON.stringify(
	{
		baseUrl: DEFAULT_BASE_URL,
		apiKey: 'YOUR_API_KEY_HERE',
		model: DEFAULT_MODEL,
		effort: DEFAULT_EFFORT,
	},
	null,
	2,
);

export function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

export function normalizeModel(model: string): string {
	if (model.startsWith('cliproxy-')) return model.slice('cliproxy-'.length);
	const map: Record<string, string> = {
		'claude-sonnet-5': 'gpt-5.6-sol',
		'claude-opus-5': 'gpt-5.6-sol',
		'claude-haiku-4-5-20251001': 'gpt-5.6-luna',
	};
	return map[model] ?? model;
}

export function loadConfig(configPath = CONFIG_PATH): CLIProxyConfig {
	try {
		const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
		return {
			baseUrl: typeof parsed.baseUrl === 'string' && !PLACEHOLDER(parsed.baseUrl) ? parsed.baseUrl : undefined,
			apiKey: typeof parsed.apiKey === 'string' && !PLACEHOLDER(parsed.apiKey) ? parsed.apiKey : undefined,
			model: typeof parsed.model === 'string' && MODEL_IDS.includes(parsed.model as CLIProxyModelId)
				? (parsed.model as CLIProxyModelId)
				: undefined,
			effort: typeof parsed.effort === 'string' && EFFORTS.includes(parsed.effort as Effort)
				? (parsed.effort as Effort)
				: undefined,
		};
	} catch {
		return {};
	}
}

export function persistPreference(
	key: typeof PREF_MODEL_KEY | typeof PREF_EFFORT_KEY,
	value: unknown,
	configPath = CONFIG_PATH,
): void {
	try {
		let parsed: Record<string, unknown> = {};
		try {
			const loaded = JSON.parse(readFileSync(configPath, 'utf8'));
			if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) parsed = loaded as Record<string, unknown>;
		} catch {
			// Create the config file lazily when a preference is first persisted.
		}
		mkdirSync(dirname(configPath), {recursive: true});
		parsed[key] = value;
		writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
	} catch {
		// Preference persistence is best-effort; the live session still changes.
	}
}

function toNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function textFromContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.filter((part) => part?.type === 'text' && typeof part.text === 'string')
		.map((part) => part.text)
		.join('');
}

function imageUrlFromSource(source: unknown): string | undefined {
	if (typeof source === 'string') return source;
	if (!source || typeof source !== 'object') return undefined;
	const value = source as Record<string, unknown>;
	if (typeof value.url === 'string') return value.url;
	if (typeof value.data === 'string') {
		const mediaType = typeof value.media_type === 'string' ? value.media_type : 'application/octet-stream';
		return `data:${mediaType};base64,${value.data}`;
	}
	return undefined;
}

function userContentToOpenAI(content: unknown): string | any[] {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return String(content ?? '');
	const parts: any[] = [];
	for (const part of content) {
		if (part?.type === 'text' && typeof part.text === 'string') {
			parts.push({type: 'text', text: part.text});
			continue;
		}
		if (part?.type === 'image') {
			const url = imageUrlFromSource(part.source ?? part.url);
			if (url) parts.push({type: 'image_url', image_url: {url}});
		}
	}
	if (parts.length === 0) return '';
	if (parts.every((part) => part.type === 'text')) return parts.map((part) => part.text).join('');
	return parts;
}

function toolResultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return String(content ?? '');
	return content
		.filter((part) => part?.type === 'text' && typeof part.text === 'string')
		.map((part) => part.text)
		.join('');
}

function commandMessagesToOpenAI(messages: readonly any[]): any[] {
	const output: any[] = [];
	for (const message of messages) {
		if (message?.role === 'user' && Array.isArray(message.content)) {
			const normalParts: any[] = [];
			for (const part of message.content) {
				if (part?.type === 'tool_result') {
					const content = toolResultText(part.content);
					if (part.tool_use_id) {
						output.push({role: 'tool', tool_call_id: part.tool_use_id, content});
					} else if (content) {
						normalParts.push({type: 'text', text: `[tool result] ${content}`});
					}
				} else {
					normalParts.push(part);
				}
			}
			if (normalParts.length > 0) {
				const content = userContentToOpenAI(normalParts);
				if (content !== '') output.push({role: 'user', content});
			}
			continue;
		}

		if (message?.role === 'assistant' && Array.isArray(message.content)) {
			const text = textFromContent(message.content);
			const toolCalls = message.content
				.filter((part: any) => part?.type === 'tool_use')
				.map((part: any) => ({
					id: part.id,
					type: 'function',
					function: {
						name: part.name,
						arguments: JSON.stringify(part.input ?? {}),
					},
				}));
			if (toolCalls.length > 0) {
				output.push({role: 'assistant', content: text || null, tool_calls: toolCalls});
			} else {
				output.push({role: 'assistant', content: text || ' '});
			}
			continue;
		}

		output.push({role: message?.role, content: typeof message?.content === 'string' ? message.content : message?.content});
	}
	return output;
}

function usageFromOpenAI(usage: any): CLIProxyResponse['usage'] {
	return {
		inputTokens: toNumber(usage?.prompt_tokens),
		outputTokens: toNumber(usage?.completion_tokens),
		cacheReadTokens: toNumber(usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens),
		cacheWriteTokens: toNumber(usage?.prompt_tokens_details?.cached_creation_tokens ?? usage?.cached_creation_tokens),
	};
}

function stopReasonFrom(finishReason: string | undefined, hasToolCalls: boolean): CLIProxyResponse['stopReason'] {
	if (hasToolCalls || finishReason === 'tool_calls' || finishReason === 'function_call') return 'tool_use';
	if (finishReason === 'length' || finishReason === 'max_tokens') return 'max_tokens';
	return 'end_turn';
}

function messageContentToBlocks(message: any): {text?: string; reasoning?: string; toolCalls?: any[]} {
	const text = typeof message?.content === 'string' ? message.content : textFromContent(message?.content);
	const reasoning = typeof message?.reasoning_content === 'string'
		? message.reasoning_content
		: typeof message?.reasoning === 'string'
			? message.reasoning
			: '';
	return {text, reasoning, toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : []};
}

interface ToolCallAccumulator {
	id: string;
	name: string;
	arguments: string;
}

function createResponseAccumulator(req: CLIProxyRequest) {
	let text = '';
	let choiceSeen = false;
	let reasoning = '';
	let finishReason: string | undefined;
	let usage: any;
	let thinkingStarted = false;
	const toolCalls = new Map<number, ToolCallAccumulator>();

	const addReasoning = (value: unknown) => {
		if (typeof value !== 'string' || value.length === 0) return;
		if (!thinkingStarted) {
			thinkingStarted = true;
			req.onThinkingStart?.();
		}
		reasoning += value;
		req.onThinkingDelta?.(value);
	};
	const addText = (value: unknown) => {
		if (typeof value !== 'string' || value.length === 0) return;
		text += value;
		req.onTextDelta?.(value);
	};
	const addToolCalls = (calls: any[]) => {
		for (const call of calls) {
			const index = typeof call?.index === 'number' ? call.index : toolCalls.size;
			const existing = toolCalls.get(index) ?? {id: '', name: '', arguments: ''};
			if (typeof call?.id === 'string') existing.id = call.id;
			if (typeof call?.function?.name === 'string') existing.name += call.function.name;
			if (typeof call?.function?.arguments === 'string') existing.arguments += call.function.arguments;
			toolCalls.set(index, existing);
		}
	};
	const processChunk = (data: any) => {
		throwIfOpenAIError(data, 'stream');
		if (data?.usage) usage = data.usage;
		const choice = data?.choices?.[0];
		if (!choice || typeof choice !== 'object') return;
		choiceSeen = true;
		if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
		const delta = choice.delta;
		if (delta) {
			addReasoning(delta.reasoning_content ?? delta.reasoning);
			addText(delta.content);
			if (Array.isArray(delta.tool_calls)) addToolCalls(delta.tool_calls);
			return;
		}
		const message = choice.message;
		if (!message) return;
		const blocks = messageContentToBlocks(message);
		addReasoning(blocks.reasoning);
		addText(blocks.text);
		if (blocks.toolCalls) addToolCalls(blocks.toolCalls);
	};
	const finish = (): CLIProxyResponse => {
		if (!choiceSeen) throw new Error('CLIProxyAPI stream ended without a valid choice');
		if (thinkingStarted) req.onThinkingEnd?.(reasoning);
		const content: any[] = [];
		if (text) content.push({type: 'text', text});
		for (const call of [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call)) {
			let input: any = {};
			if (call.arguments.trim()) {
				try {
					input = JSON.parse(call.arguments);
				} catch {
					throw new Error(`CLIProxyAPI returned invalid JSON arguments for tool "${call.name}"`);
				}
			}
			content.push({type: 'tool_use', id: call.id, name: call.name, input});
		}
		return {
			content,
			stopReason: stopReasonFrom(finishReason, toolCalls.size > 0),
			rawFinishReason: finishReason ?? 'stop',
			usage: usageFromOpenAI(usage),
		};
	};
	return {processChunk, finish};
}

function throwIfOpenAIError(data: any, source: string): void {
	if (!data?.error || typeof data.error !== 'object') return;
	const message = typeof data.error.message === 'string' ? data.error.message : JSON.stringify(data.error);
	const code = typeof data.error.code === 'string' ? ` (${data.error.code})` : '';
	throw new Error(`CLIProxyAPI ${source} error${code}: ${message}`);
}

function parseSseBlock(block: string): {done: boolean; data?: any} {
	const dataLines = block
		.split(/\r?\n/)
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trimStart());
	if (dataLines.length === 0) return {done: false};
	const payload = dataLines.join('\n').trim();
	if (payload === '[DONE]') return {done: true};
	try {
		return {done: false, data: JSON.parse(payload)};
	} catch (error) {
		throw new Error(`CLIProxyAPI invalid SSE event: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function consumeSse(response: Response, req: CLIProxyRequest, accumulator: ReturnType<typeof createResponseAccumulator>): Promise<void> {
	if (!response.body) throw new Error('CLIProxyAPI returned an empty streaming body');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let done = false;
	while (!done) {
		const next = await reader.read();
		buffer += decoder.decode(next.value ?? new Uint8Array(), {stream: !next.done});
		while (true) {
			const match = /\r?\n\r?\n/.exec(buffer);
			if (!match) break;
			const block = buffer.slice(0, match.index);
			buffer = buffer.slice(match.index + match[0].length);
			const event = parseSseBlock(block);
			if (event.data !== undefined) accumulator.processChunk(event.data);
			if (event.done) {
				done = true;
				break;
			}
		}
		if (next.done) break;
	}
	const trailing = buffer.trim();
	if (!done && trailing) {
		const event = parseSseBlock(trailing);
		if (event.data !== undefined) accumulator.processChunk(event.data);
	}
	void req;
}

async function readJsonResponse(response: Response): Promise<any> {
	const body = await response.text();
	try {
		return JSON.parse(body);
	} catch (error) {
		throw new Error(`CLIProxyAPI invalid JSON response: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function errorTextFromBody(body: string): string {
	try {
		const parsed = JSON.parse(body);
		return parsed?.error?.message ?? parsed?.message ?? body;
	} catch {
		return body;
	}
}

function makeCombinedSignal(callerSignal: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	let timedOut = false;
	const abortFromCaller = () => controller.abort(callerSignal?.reason);
	if (callerSignal) {
		if (callerSignal.aborted) abortFromCaller();
		else callerSignal.addEventListener('abort', abortFromCaller, {once: true});
	}
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException('Timeout', 'TimeoutError'));
	}, timeoutMs);
	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		cleanup: () => {
			clearTimeout(timer);
			callerSignal?.removeEventListener('abort', abortFromCaller);
		},
	};
}

export function createCLIProxyProvider(options: CLIProxyProviderOptions = {}) {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const baseUrl = normalizeBaseUrl(
		options.baseUrl ?? process.env.CLIPROXY_BASE_URL ?? DEFAULT_BASE_URL,
	);
	const fallbackApiKey = options.apiKey ?? process.env.CLIPROXY_API_KEY ?? '';
	const timeoutMs = options.timeoutMs ?? 120_000;
	const getEffort = options.getEffort ?? (() => options.defaultEffort ?? DEFAULT_EFFORT);

	return {
		id: 'cliproxy',
		displayName: 'CLIProxyAPI',
		models: MODELS,
		transport: {
			kind: 'direct',
			stream: async (req: CLIProxyRequest): Promise<CLIProxyResponse> => {
				const model = normalizeModel(req.model);
				const system = typeof req.system === 'function' ? await req.system({}) : req.system;
				const tools = (req.tools ?? []).map((tool: any) => ({
					type: 'function',
					function: {
						name: tool.name,
						description: tool.description ?? '',
						parameters: tool.input_schema ?? {type: 'object', properties: {}},
					},
				}));
				const messages: any[] = [];
				if (typeof system === 'string' && system.length > 0) messages.push({role: 'system', content: system});
				messages.push(...commandMessagesToOpenAI(req.messages ?? []));

				const headers = new Headers(req.auth?.headers);
				if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
				if (!headers.has('authorization') && fallbackApiKey) headers.set('Authorization', `Bearer ${fallbackApiKey}`);

				const effort = req.effort ?? req.reasoning ?? getEffort();
				const requestBody = {
					model,
					messages,
					stream: true,
					...(tools.length > 0 ? {tools} : {}),
					...(effort ? {reasoning_effort: effort} : {}),
					...(req.temperature !== undefined ? {temperature: req.temperature} : {}),
					...((req.maxTokens ?? req.maxOutputTokens) !== undefined
						? {max_tokens: req.maxTokens ?? req.maxOutputTokens}
						: {}),
				};
				const combined = makeCombinedSignal(req.signal, timeoutMs);
				try {
					const response = await fetchImpl(`${baseUrl}/chat/completions`, {
						method: 'POST',
						headers,
						body: JSON.stringify(requestBody),
						signal: combined.signal,
					});
					if (!response.ok) {
						const body = await response.text().catch(() => '');
						throw new Error(`CLIProxyAPI HTTP ${response.status}: ${errorTextFromBody(body).slice(0, 500)}`);
					}

					const accumulator = createResponseAccumulator(req);
					const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
					if (contentType.includes('text/event-stream')) {
						await consumeSse(response, req, accumulator);
					} else {
						const data = await readJsonResponse(response);
						throwIfOpenAIError(data, 'response');
						if (!Array.isArray(data?.choices) || data.choices.length === 0) {
							throw new Error('CLIProxyAPI response did not contain choices');
						}
						accumulator.processChunk(data);
					}
					const result = accumulator.finish();
					return {
						...result,
						raw: undefined,
					};
				} catch (error) {
					if (combined.timedOut() && !req.signal?.aborted) {
						throw new Error(`CLIProxyAPI request timed out after ${timeoutMs}ms`);
					}
					throw error;
				} finally {
					combined.cleanup();
				}
			},
		},
		auth: {
			methods: [
				{
					kind: 'api',
					label: 'CLIProxyAPI API key',
					validate: async ({key}: {key?: string}) => {
						if (!key) return false;
						try {
							const response = await fetchImpl(`${baseUrl}/models`, {
								headers: {Authorization: `Bearer ${key}`},
							});
							return response.ok;
						} catch {
							return false;
						}
					},
				},
			],
			loader: async ({credential}: {credential?: any}) => {
				const token = credential?.kind === 'api' ? credential.token : fallbackApiKey;
				return token ? {headers: {Authorization: `Bearer ${token}`}} : {};
			},
		},
		hooks: {
			onResponse: ({response}: {response: unknown}) => response,
		},
		matchesModelId: (id: string) => MODEL_IDS.includes(id as CLIProxyModelId),
	};
}

export interface CLIProxyModOptions {
	configPath?: string;
	config?: CLIProxyConfig;
	fetchImpl?: typeof fetch;
}

export function createCLIProxyMod(cmd: any, options: CLIProxyModOptions = {}): void {
	const configPath = options.configPath ?? CONFIG_PATH;
	const config = options.config ?? loadConfig(configPath);
	let currentModel: CLIProxyModelId = config.model ?? DEFAULT_MODEL;
	let currentEffort: Effort = config.effort ?? DEFAULT_EFFORT;
	const baseUrl = normalizeBaseUrl(config.baseUrl ?? process.env.CLIPROXY_BASE_URL ?? DEFAULT_BASE_URL);
	const apiKey = config.apiKey ?? process.env.CLIPROXY_API_KEY ?? '';
	const provider = createCLIProxyProvider({
		baseUrl,
		apiKey,
		fetchImpl: options.fetchImpl,
		getEffort: () => currentEffort,
	});

	cmd.addProvider(provider);
	cmd.addCommand({
		name: 'cliproxy',
		description: 'CLIProxyAPI provider status / model selector',
		handler: async ({args, ui}: any) => {
			const subcommand = String(args ?? '').trim().toLowerCase();
			if (subcommand === 'model' || subcommand === 'm') {
				const selected = await ui.select({
					title: 'CLIProxyAPI model',
					options: MODELS.map((model) => ({label: model.id, description: model.name})),
				});
				if (typeof selected !== 'string' || !MODEL_IDS.includes(selected as CLIProxyModelId)) return {message: 'Cancelado.'};
				currentModel = selected as CLIProxyModelId;
				persistPreference(PREF_MODEL_KEY, currentModel, configPath);
				cmd.setModel?.(currentModel);
				return {message: `Modelo cambiado a ${currentModel}. Aplica al próximo turno.`};
			}
			if (subcommand === 'effort' || subcommand === 'e') {
				const selected = await ui.select({
					title: 'CLIProxyAPI reasoning effort',
					options: EFFORTS.map((effort) => ({label: effort})),
				});
				if (typeof selected !== 'string' || !EFFORTS.includes(selected as Effort)) return {message: 'Cancelado.'};
				currentEffort = selected as Effort;
				persistPreference(PREF_EFFORT_KEY, currentEffort, configPath);
				cmd.setEffort?.(currentEffort);
				return {message: `Effort cambiado a ${currentEffort}. Aplica al próximo turno.`};
			}
			return {
				message: `CLIProxyAPI provider. Modelo: ${currentModel}. Effort: ${currentEffort}. Base: ${baseUrl}. Key: ${apiKey ? 'set' : 'NOT set'}. Uso: /cliproxy model | /cliproxy effort`,
			};
		},
	});

	let lastModel: string = currentModel;
	cmd.addRenderer('cliproxy-model', (data: {model: string}) => [`[cliproxy] modelo del turno: ${data.model}`]);
	cmd.on('model_request_start', (event: any) => {
		const model = event?.model;
		if (typeof model === 'string' && model.startsWith('cliproxy-') && model !== lastModel) {
			lastModel = model;
			cmd.showEntry('cliproxy-model', {model});
		}
	});

	const applyPreferences = () => {
		try {
			cmd.setModel?.(currentModel);
			cmd.setEffort?.(currentEffort);
		} catch {
			// Command Code may not have bound the session yet.
		}
	};
	applyPreferences();
	cmd.hooks({onSessionStart: applyPreferences});
}

export default createCLIProxyMod;
