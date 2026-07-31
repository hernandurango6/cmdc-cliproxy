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

// Placeholders in cliproxy.json mean "not configured yet" — fall back to env/default.
const PLACEHOLDER = (s: string | undefined) =>
	!s || s.startsWith('YOUR_') || s === '';

function loadConfig(): { baseUrl?: string; apiKey?: string; model?: string } {
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

// Persist the preferred model into cliproxy.json (keeps baseUrl/apiKey).
function persistPrefModel(modelId: string): void {
	try {
		const parsed = (() => {
			try {
				return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
			} catch {
				return {};
			}
		})() as Record<string, unknown>;
		parsed[PREF_MODEL_KEY] = modelId;
		writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2), 'utf8');
	} catch {
		// best-effort
	}
}

const MODELS = [
	{ id: 'cliproxy-gpt-5.6-sol', name: 'GPT-5.6 Sol (CLIProxyAPI)' },
	{ id: 'cliproxy-gpt-5.6-terra', name: 'GPT-5.6 Terra (CLIProxyAPI)' },
	{ id: 'cliproxy-gpt-5.6-luna', name: 'GPT-5.6 Luna (CLIProxyAPI)' },
	{ id: 'cliproxy-gpt-5.5', name: 'GPT-5.5 (CLIProxyAPI)' },
	{ id: 'cliproxy-gpt-5.4', name: 'GPT-5.4 (CLIProxyAPI)' },
	{ id: 'cliproxy-gpt-5.4-mini', name: 'GPT-5.4 Mini (CLIProxyAPI)' },
	{ id: 'cliproxy-gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark (CLIProxyAPI)' },
	{ id: 'cliproxy-codex-auto-review', name: 'Codex Auto Review (CLIProxyAPI)' },
];

const MODEL_IDS = MODELS.map((m) => m.id);

const normalizeModel = (model: string): string => {
	if (model.startsWith('cliproxy-')) return model.slice('cliproxy-'.length);
	const map: Record<string, string> = {
		'claude-sonnet-5': 'gpt-5.6-sol',
		'claude-opus-5': 'gpt-5.6-sol',
		'claude-haiku-4-5-20251001': 'gpt-5.6-luna',
	};
	return map[model] ?? model;
};

// OpenAI-compatible reasoning_effort only accepts low/medium/high.
const EFFORT_MAP: Record<string, string> = {
	low: 'low',
	medium: 'medium',
	high: 'high',
	xhigh: 'high',
	max: 'high',
};

function buildProviderModule() {
	return {
		id: 'cliproxy',
		displayName: 'CLIProxyAPI',
		models: MODELS,
		transport: {
			kind: 'direct',
			stream: async (req: any) => {
				const model = normalizeModel(req.model);
				const messages = (req.messages ?? []).map((m: any) => {
					if (m.role === 'user' && Array.isArray(m.content)) {
						const parts: string[] = [];
						for (const c of m.content) {
							if (c.type === 'text') parts.push(c.text);
							else if (c.type === 'tool_result') {
								const t = Array.isArray(c.content)
									? c.content.map((x: any) => x.text ?? '').join('')
									: String(c.content ?? '');
								parts.push(`[tool result] ${t}`);
							}
						}
						return { role: 'user', content: parts.join('\n') };
					}
					if (m.role === 'assistant' && Array.isArray(m.content)) {
						const text = m.content
							.filter((c: any) => c.type === 'text')
							.map((c: any) => c.text)
							.join('');
						return { role: 'assistant', content: text || ' ' };
					}
					return { role: m.role, content: m.content };
				});

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
							...(reasoning ? { reasoning_effort: reasoning } : {}),
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
					const text =
						choice?.message?.content ?? choice?.message?.reasoning_content ?? '';
					return {
						content: [{ type: 'text', text: String(text) }],
						stopReason: choice?.finish_reason === 'stop' ? 'end_turn' : 'tool_use',
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
		matchesModelId: (id: string) => MODELS.some((m) => m.id === id),
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
					// ui.select devuelve el objeto de la opción elegida y solo
					// propaga label/description — por eso el id va en el label.
					return ui.select({
						title: 'CLIProxyAPI model',
						options: MODELS.map((m) => ({
							label: m.id,
							description: m.name,
						})),
					}).then((selected: any) => {
						const value = selected?.label;
						if (!value) return { message: 'Cancelado.' };
						cmd.setModel?.(value);
						persistPrefModel(value);
						return {
							message: `Modelo cambiado a ${value}. Aplica al próximo turno.`,
						};
					});
				}
				return {
					message: `CLIProxyAPI provider. Preferido: ${PREF_MODEL}. Base: ${BASE_URL}. Key: ${API_KEY ? 'set' : 'NOT set'}. Uso: /cliproxy model`,
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

		// Fuerza el modelo de sesión al preferido. Factory-time setModel es buffered
		// pre-bind y el TUI restaura el modelo de sesión anterior (p.ej. deepseek)
		// después del bind. onSessionStart dispara DESPUÉS del bind, así que aquí
		// el setModel sí gana y aplica al turno siguiente.
		cmd.hooks({
			onSessionStart: () => {
				try {
					cmd.setModel?.(PREF_MODEL);
				} catch {
					// best-effort
				}
			},
		});
		// También en factory para headless, donde el orden del bind difiere.
		try {
			cmd.setModel?.(PREF_MODEL);
		} catch {
			// best-effort
		}
	}
	return module;
}
