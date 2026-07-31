// cliproxy-provider.ts — CLIProxyAPI provider for Command Code.
//
// DUAL MODE: this same file works two ways:
//  1. As a MOD (auto-loaded from ~/.commandcode/mods/ or via `cmd mods add`):
//     the default export is called with `cmd`, and it calls cmd.addProvider(module).
//     It ALSO self-bootstraps: writes its own path into ~/.commandcode/settings.json
//     ("providers.cliproxy.module") so the provider loads via config on the next
//     start/reload — that is what actually makes the models selectable.
//  2. As a CONFIG provider (settings.json "providers" entry): the loader calls the
//     default export with NO args, so it returns the ProviderModule object.
//
// Config: reads ~/.commandcode/cliproxy.json for { baseUrl, apiKey }.
//   Falls back to CLIPROXY_BASE_URL / CLIPROXY_API_KEY env vars, then built-in defaults.
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = join(homedir(), '.commandcode', 'cliproxy.json');
const SETTINGS_PATH = join(homedir(), '.commandcode', 'settings.json');
const PREF_MODEL_KEY = 'model'; // in cliproxy.json — the user's preferred cliproxy model
const PREF_EFFORT_KEY = 'effort'; // in cliproxy.json — preferred reasoning effort

const MODELS = [
	{ id: 'cliproxy-gpt-5.6-sol', name: 'GPT-5.6 Sol (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'cliproxy-gpt-5.6-terra', name: 'GPT-5.6 Terra (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'cliproxy-gpt-5.6-luna', name: 'GPT-5.6 Luna (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'cliproxy-gpt-5.5', name: 'GPT-5.5 (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh'] },
	{ id: 'cliproxy-gpt-5.4', name: 'GPT-5.4 (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh'] },
	{ id: 'cliproxy-gpt-5.4-mini', name: 'GPT-5.4 Mini (CLIProxyAPI)', efforts: ['low', 'medium', 'high'] },
	{ id: 'cliproxy-gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark (CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh'] },
	{ id: 'cliproxy-codex-auto-review', name: 'Codex Auto Review (CLIProxyAPI)', efforts: ['low', 'medium', 'high'] },
];

// Reclamar también los ids del catálogo de Command Code (gpt-5.6-sol/terra/luna, etc.)
// para que headless/--model los enrute a este provider direct en vez del built-in
// gateway (que bloquea por plan y va al backend de Command Code). Verificado con
// logs del proxy: los requests --model gpt-5.6-* llegan al proxy. En el TUI el
// picker sigue mostrando los ids cliproxy-* vía /cliproxy model.
const CATALOG_IDS: { id: string; name: string; efforts?: string[] }[] = [
	{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol (vía CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra (vía CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna (vía CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
	{ id: 'gpt-5.5', name: 'GPT-5.5 (vía CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh'] },
	{ id: 'gpt-5.4', name: 'GPT-5.4 (vía CLIProxyAPI)', efforts: ['low', 'medium', 'high', 'xhigh'] },
	{ id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini (vía CLIProxyAPI)', efforts: ['low', 'medium', 'high'] },
];
const ALL_MODELS = [...MODELS, ...CATALOG_IDS];

const MODEL_IDS = MODELS.map((m) => m.id);

// Placeholders in cliproxy.json mean "not configured yet" — fall back to env/default.
const PLACEHOLDER = (s: string | undefined) =>
	!s || s.startsWith('YOUR_') || s === '';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

function loadConfig(): { baseUrl?: string; apiKey?: string; model?: string; effort?: Effort } {
	try {
		const raw = readFileSync(CONFIG_PATH, 'utf8');
		const parsed = JSON.parse(raw);
		return {
			baseUrl:
				typeof parsed.baseUrl === 'string' && !PLACEHOLDER(parsed.baseUrl)
					? parsed.baseUrl
					: undefined,
			apiKey:
				typeof parsed.apiKey === 'string' && !PLACEHOLDER(parsed.apiKey)
					? parsed.apiKey
					: undefined,
			model:
				typeof parsed.model === 'string' && MODEL_IDS.includes(parsed.model)
					? parsed.model
					: undefined,
			effort:
				typeof parsed.effort === 'string' && (EFFORTS as readonly string[]).includes(parsed.effort)
					? (parsed.effort as Effort)
					: undefined,
		};
	} catch {
		return {};
	}
}

// The empty cliproxy.json skeleton created when none exists — paste URL + key here.
const CONFIG_SKELETON = JSON.stringify(
	{
		baseUrl: 'YOUR_BASE_URL_HERE',
		apiKey: 'YOUR_API_KEY_HERE',
	},
	null,
	2,
);

const CONFIG = loadConfig();
const BASE_URL = CONFIG.baseUrl ?? process.env.CLIPROXY_BASE_URL ?? 'http://100.111.17.56:8317/v1';
const API_KEY = CONFIG.apiKey ?? process.env.CLIPROXY_API_KEY ?? '';
const PREF_MODEL = CONFIG.model ?? 'cliproxy-gpt-5.6-sol';
const PREF_EFFORT = CONFIG.effort ?? 'high';

// Persist a key into cliproxy.json (keeps baseUrl/apiKey/other keys).
function persistPref(key: string, value: unknown): void {
	try {
		const parsed = (() => {
			try {
				return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
			} catch {
				return {};
			}
		})() as Record<string, unknown>;
		parsed[key] = value;
		writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2), 'utf8');
	} catch {
		// best-effort
	}
}

const normalizeModel = (model: string): string => {
	if (model.startsWith('cliproxy-')) return model.slice('cliproxy-'.length);
	const map: Record<string, string> = {
		'claude-sonnet-5': 'gpt-5.6-sol',
		'claude-opus-5': 'gpt-5.6-sol',
		'claude-haiku-4-5-20251001': 'gpt-5.6-luna',
	};
	return map[model] ?? model;
};

// OpenAI-compatible reasoning_effort — passthrough. Command Code's catalog gives
// gpt-5.6-sol/terra/luna: low, medium, high, xhigh, max. The proxy decides what it
// accepts; pass the value verbatim so the strongest supported effort is used.
const EFFORT_MAP: Record<string, string> = {
	low: 'low',
	medium: 'medium',
	high: 'high',
	xhigh: 'xhigh',
	max: 'max',
};

function buildProviderModule() {
	return {
		id: 'cliproxy',
		displayName: 'CLIProxyAPI',
		models: ALL_MODELS,
		transport: {
			kind: 'direct',
			stream: async (req: any) => {
				const model = normalizeModel(req.model);
				// system prompt: separado (el proxy OpenAI espera role system)
				const system =
					typeof req.system === 'string'
						? req.system
						: typeof req.system === 'function'
							? (req.system({}) ?? '')
							: '';
				// tools: formato OpenAI (name/description/parameters)
				const tools = (req.tools ?? []).map((t: any) => ({
					type: 'function',
					function: {
						name: t.name,
						description: t.description ?? '',
						parameters: t.input_schema ?? { type: 'object', properties: {} },
					},
				}));

				const messages: any[] = [];
				if (system) messages.push({ role: 'system', content: system });
				for (const m of req.messages ?? []) {
					if (m.role === 'user' && Array.isArray(m.content)) {
						const parts: string[] = [];
						for (const c of m.content) {
							if (c.type === 'text') parts.push(c.text);
							else if (c.type === 'tool_result') {
								const t = Array.isArray(c.content)
									? c.content.map((x: any) => x.text ?? '').join('')
									: String(c.content ?? '');
								// El proxy OpenAI espera role "tool" con tool_call_id,
								// no el resultado incrustado en texto user.
								if (c.tool_use_id) {
									messages.push({
										role: 'tool',
										tool_call_id: c.tool_use_id,
										content: t,
									});
								} else {
									parts.push(`[tool result] ${t}`);
								}
							}
						}
						if (parts.length > 0) messages.push({ role: 'user', content: parts.join('\n') });
					} else if (m.role === 'assistant' && Array.isArray(m.content)) {
						const text = m.content
							.filter((c: any) => c.type === 'text')
							.map((c: any) => c.text)
							.join('');
						const toolCalls = m.content
							.filter((c: any) => c.type === 'tool_use')
							.map((c: any) => ({
								id: c.id,
								type: 'function',
								function: {
									name: c.name,
									arguments: JSON.stringify(c.input ?? {}),
								},
							}));
						if (toolCalls.length > 0) {
							messages.push({
								role: 'assistant',
								content: text || null,
								tool_calls: toolCalls,
							});
						} else {
							messages.push({ role: 'assistant', content: text || ' ' });
						}
					} else {
						messages.push({ role: m.role, content: m.content });
					}
				}

				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
					...(req.auth?.headers ?? {}),
				};
				if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

				const reasoning = req.effort ? EFFORT_MAP[req.effort] : undefined;

				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 120000);
				try {
					const res = await fetch(`${BASE_URL}/chat/completions`, {
						method: 'POST',
						headers,
						body: JSON.stringify({
							model,
							messages,
							...(tools.length > 0 ? { tools } : {}),
							...(reasoning ? { reasoning_effort: reasoning } : { reasoning_effort: PREF_EFFORT }),
							...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
							...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
						}),
						signal: controller.signal,
					});
					if (!res.ok) {
						const errText = await res.text().catch(() => '');
						throw new Error(`CLIProxyAPI HTTP ${res.status}: ${errText.slice(0, 500)}`);
					}
					const data = await res.json();
					const choice = data.choices?.[0];
					const reasoningText = choice?.message?.reasoning_content ?? '';
					const text = choice?.message?.content ?? reasoningText ?? '';
					// tool_calls de la respuesta → content con tipo tool_use (el harness
					// espera ese shape en el content del assistant).
					const toolUses = (choice?.message?.tool_calls ?? []).map((tc: any) => {
						let input: any = {};
						try {
							input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
						} catch {
							input = {};
						}
						return {
							type: 'tool_use',
							id: tc.id,
							name: tc.function?.name ?? '',
							input,
						};
					});
					// Emit streaming deltas so the harness/TUI paint the response live
					// and close the turn (text + token usage). Without these, the
					// response lands in the transcript but never renders until reload.
					if (reasoningText) {
						req.onThinkingStart?.();
						req.onThinkingDelta?.(reasoningText);
						req.onThinkingEnd?.(reasoningText);
					}
					if (text) req.onTextDelta?.(String(text));
					const content: any[] = [];
					if (text) content.push({ type: 'text', text: String(text) });
					for (const tu of toolUses) content.push(tu);
					return {
						content,
						stopReason:
							choice?.finish_reason === 'stop' || choice?.finish_reason === 'length'
								? 'end_turn'
								: toolUses.length > 0
									? 'tool_use'
									: 'end_turn',
						rawFinishReason: choice?.finish_reason ?? 'stop',
						usage: data.usage
							? {
									inputTokens: data.usage.prompt_tokens ?? 0,
									outputTokens: data.usage.completion_tokens ?? 0,
									cacheReadTokens: 0,
									cacheWriteTokens: 0,
							  }
							: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
						raw: data,
					};
				} finally {
					clearTimeout(timeout);
				}
			},
		},
		auth: {
			methods: [
				{
					kind: 'api',
					label: 'CLIProxyAPI API key',
					validate: async ({ key }: { key?: string }) => {
						if (!key) return false;
						try {
							const res = await fetch(`${BASE_URL}/models`, {
								headers: { Authorization: `Bearer ${key}` },
							});
							return res.ok;
						} catch {
							return false;
						}
					},
				},
			],
			loader: async ({ credential }: { credential?: any }) => {
				const token = credential?.kind === 'api' ? credential.token : API_KEY;
				return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
			},
		},
		hooks: {
			onResponse: ({ response }: { response: any }) => response,
		},
		matchesModelId: (id: string) => ALL_MODELS.some((m) => m.id === id),
	};
}

// Dual-mode default export:
// - loaded as a mod: cmd is the ModApi → register via addProvider
// - loaded as a config provider: cmd is undefined → return the ProviderModule object
export default function (cmd?: any): any {
	const module = buildProviderModule();
	if (cmd?.addProvider) {
		cmd.addProvider(module);
		// Self-bootstrap: make this provider load via config (the seam that actually
		// feeds the model registry) on the next start/reload.
		try {
			const selfPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
			const ccDir = join(homedir(), '.commandcode');
			if (!existsSync(ccDir)) mkdirSync(ccDir, { recursive: true });
			if (!existsSync(CONFIG_PATH)) {
				// Create the skeleton so the user just pastes URL + key.
				writeFileSync(CONFIG_PATH, CONFIG_SKELETON, 'utf8');
			}
			let settings: Record<string, any> = {};
			if (existsSync(SETTINGS_PATH)) {
				settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
			}
			const providers = (settings.providers ?? {}) as Record<string, any>;
			const changed =
				providers.cliproxy?.module !== selfPath || settings.model === undefined;
			providers.cliproxy = { module: selfPath };
			settings.providers = providers;
			if (settings.model === undefined) {
				// Id cliproxy-* (no catálogo): las feature calls (title/taste) usan
				// settings.model contra el registry — con cliproxy-* van a este
				// provider (proxy); con un id de catálogo irían al built-in gateway
				// y darían 403 MODEL_NOT_IN_PLAN. La sesión interactiva se elige con
				// `cmdc --model gpt-5.6-*` (id de catálogo) para banner/effort/
				// subagentes nativos.
				settings.model = 'cliproxy-gpt-5.6-sol';
			}
			if (changed) {
				writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
			}
		} catch {
			// Bootstrap is best-effort; the mod still registers via addProvider.
		}
		cmd.addCommand({
			name: 'cliproxy',
			description: 'CLIProxyAPI provider status / model selector',
			handler: ({ args, ui }) => {
				const sub = (args ?? '').trim();
				if (sub === 'model' || sub === 'm') {
					// Selector de modelos (mismo modal que el picker SSH).
					// ui.select devuelve el LABEL (string) de la opción elegida, o
					// undefined si se cancela — por eso el id va en el label.
					return ui.select({
						title: 'CLIProxyAPI model',
						options: MODELS.map((m) => ({
							label: m.id,
							description: m.name,
						})),
					}).then((selected: any) => {
						const value = typeof selected === 'string' ? selected : undefined;
						if (!value) return { message: 'Cancelado.' };
						persistPref(PREF_MODEL_KEY, value);
						cmd.setModel?.(value);
						return {
							message: `Modelo cambiado a ${value}. Aplica al próximo turno.`,
						};
					});
				}
				if (sub === 'effort' || sub === 'e') {
					// Selector de reasoning effort (los 5 niveles que el proxy acepta).
					return ui.select({
						title: 'CLIProxyAPI reasoning effort',
						options: EFFORTS.map((e) => ({
							label: e,
						})),
					}).then((selected: any) => {
						const value = typeof selected === 'string' && (EFFORTS as readonly string[]).includes(selected) ? selected : undefined;
						if (!value) return { message: 'Cancelado.' };
						persistPref(PREF_EFFORT_KEY, value);
						return {
							message: `Effort cambiado a ${value}. Aplica al próximo turno.`,
						};
					});
				}
				return {
					message: `CLIProxyAPI provider. Modelo: ${PREF_MODEL}. Effort: ${PREF_EFFORT}. Base: ${BASE_URL}. Key: ${API_KEY ? 'set' : 'NOT set'}. Uso: /cliproxy model | /cliproxy effort`,
				};
			},
		});

		// Muestra en el feed el modelo REAL que usa cada turno (el banner puede
		// mostrar el modelo del catálogo aunque el turno use cliproxy).
		let lastModel = PREF_MODEL;
		cmd.addRenderer('cliproxy-model', (data: { model: string }) => [
			`[cliproxy] modelo del turno: ${data.model}`,
		]);
		cmd.on('model_request_start', (ev: any) => {
			const model = ev?.model;
			if (typeof model === 'string' && model.startsWith('cliproxy-')) {
				if (model !== lastModel) {
					lastModel = model;
					cmd.showEntry('cliproxy-model', { model });
				}
			}
		});

		// Forzar el modelo de sesión al preferido SOLO en headless (sin TTY):
		// en headless, un `--model gpt-5.6-*` del CLI (override) hace que el
		// harness valide el id contra el plan del gateway y aborte con 403
		// MODEL_NOT_IN_PLAN antes de llamar al provider — pisar el override con
		// cliproxy-* evita eso y el turno va al proxy.
		// En el TUI NO se fuerza: el `--model gpt-5.6-*` del arranque queda activo
		// en runtime (banner, /effort, subagentes heredan un id de catálogo y
		// enrutan al proxy). Forzarlo ahí pisa el override y rompe los subagentes
		// (el id cliproxy-* no pasa la validación describeUnknownSubagentModel).
		const isTui = Boolean(process.stdout.isTTY);
		cmd.hooks({
			onSessionStart: () => {
				if (isTui) return;
				try {
					cmd.setModel?.(PREF_MODEL);
				} catch {
					// best-effort
				}
			},
		});
		// En factory también, para headless (el orden del bind difiere).
		if (!isTui) {
			try {
				cmd.setModel?.(PREF_MODEL);
			} catch {
				// best-effort
			}
		}
	}
	return module;
}
