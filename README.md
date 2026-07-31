# cliproxy-provider

Command Code provider for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — exposes your
proxy's models (GPT-5.6 Sol / Terra / Luna, etc.) inside Command Code through an OpenAI-compatible
`direct` transport, with no Command Code Pro plan required.

## What it does

- Registers a `cliproxy` provider with Command Code (transport `direct`).
- Reads URL + API key from `~/.commandcode/cliproxy.json` (no env vars needed).
- Self-bootstraps on first load: writes its own path into `~/.commandcode/settings.json`
  (`providers.cliproxy.module`) and sets `model: cliproxy-gpt-5.6-sol`.
- **TUI commands** for switching model and reasoning effort.
- **Claims the catalog ids** (`gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`) so
  `--model gpt-5.6-luna` routes to your proxy (verified against proxy request logs), bypassing
  the built-in gateway and its plan gating.

## Files

| File | Purpose |
|---|---|
| `index.ts` | The provider (dual-mode: works as a mod or as a config provider). |
| `install.ps1` | One-command installer for Windows. |
| `cliproxy.example.json` | Template for URL + API key. |

## Install on a new machine

**Automatic (recommended) — as a mod from a git repo:**

```bash
cmd mods add <owner>/cliproxy-provider
```

On first load, the mod self-bootstraps: it writes its own path into
`~/.commandcode/settings.json` (`providers.cliproxy.module`) and creates
`~/.commandcode/cliproxy.json` with paste-ready placeholders. Only the API key (and baseUrl if
not default) needs to be provided per machine:

```powershell
# ~/.commandcode/cliproxy.json — created automatically on first load; fill the placeholders
@'{ "baseUrl": "http://100.111.17.56:8317/v1", "apiKey": "your-key" }'@ |
  Set-Content "$HOME\.commandcode\cliproxy.json"
```

or via env vars `CLIPROXY_BASE_URL` / `CLIPROXY_API_KEY`.

Then restart Command Code (or `/reload`). Check it registered:

```powershell
cmdc providers --json
```

**Scripted (alternative) — from a local folder:**

```powershell
cd cliproxy-provider
.\install.ps1                       # uses cliproxy.json / cliproxy.example.json, or prompts
.\install.ps1 -BaseUrl http://100.111.17.56:8317/v1 -ApiKey fff75d...   # direct
```

The installer copies the provider to `~/.commandcode/mods/`, writes
`~/.commandcode/cliproxy.json`, and merges the `providers` + `model` keys into
`~/.commandcode/settings.json` **without touching** your existing settings.

## Usage

### Interactive TUI

**Recommended start — pass the catalog id so the banner and `/effort` work natively:**

```bash
cmdc --model gpt-5.6-luna
```

This shows the real model in the header (`# models: gpt-5.6-luna · taste-1`), makes the native
`/effort` selector work (the catalog knows `gpt-5.6-*` supports `low/medium/high/xhigh/max`), and
the turns still route to your proxy.

| Command | What it does |
|---|---|
| `/cliproxy model` | Opens a picker with all cliproxy models; selection applies next turn and persists as the preferred model. |
| `/cliproxy effort` | Opens a picker with `low` / `medium` / `high` / `xhigh` / `max`; selection is sent to the proxy as `reasoning_effort` on every request and persists. |
| `/effort` (native) | Works when the session model is a catalog id (e.g. started with `--model gpt-5.6-luna`); the chosen effort is passed through to the proxy. |
| `/cliproxy` | Status: preferred model, effort, base URL, whether the key is set. |

The preferred model is forced at session start (`onSessionStart` → `setModel`), so the session
runs on your proxy instead of the default catalog model. The feed also shows a
`[cliproxy] modelo del turno: …` row whenever the per-turn model changes, since the TUI banner
keeps showing the catalog model.

### Headless / scripts

The provider also claims the catalog ids, so the CLI accepts them directly:

```bash
cmdc -p "hola" --model gpt-5.6-luna
cmdc -p "explain this diff" --model gpt-5.6-sol
```

These route to your proxy (no Pro plan needed). `--model cliproxy-gpt-5.6-*` is NOT accepted
(`--model` only accepts catalog ids); use `--model gpt-5.6-*` or the TUI commands instead.

## Available models

`cliproxy-gpt-5.6-sol`, `cliproxy-gpt-5.6-terra`, `cliproxy-gpt-5.6-luna`, `cliproxy-gpt-5.5`,
`cliproxy-gpt-5.4`, `cliproxy-gpt-5.4-mini`, `cliproxy-gpt-5.3-codex-spark`, `cliproxy-codex-auto-review`.

Set the default via `model` in `~/.commandcode/settings.json`:

```json
{ "model": "cliproxy-gpt-5.6-terra", "providers": { "cliproxy": { "module": "..." } } }
```

or via `~/.commandcode/cliproxy.json`:

```json
{ "baseUrl": "http://100.111.17.56:8317/v1", "apiKey": "your-key", "model": "cliproxy-gpt-5.6-luna", "effort": "max" }
```

## Notes

- **Config file** (`~/.commandcode/cliproxy.json`): `baseUrl`, `apiKey`, optional `model`
  (preferred) and `effort`. Placeholders (`YOUR_BASE_URL_HERE` / `YOUR_API_KEY_HERE`) count as
  "not configured" — env fallbacks keep working until replaced.
- **Env var fallbacks**: `CLIPROXY_BASE_URL`, `CLIPROXY_API_KEY`.
- **Effort**: the proxy accepts `low` / `medium` / `high` / `xhigh` / `max` (same set Command Code
  defines for gpt-5.6); the value is passed through verbatim, default `high`.
- **Why the catalog ids work**: the provider lists the catalog ids in `models` and
  `matchesModelId`, so the harness routes those models to this `direct` transport instead of the
  built-in gateway. Verified with proxy request logs (requests from the local machine hit
  `/v1/chat/completions`).
- **Banner caveat**: starting the TUI without `--model` keeps showing the default catalog model
  (e.g. `deepseek-v4-flash`) in the header even though turns run on your proxy. Start with
  `cmdc --model gpt-5.6-luna` to show the real model and enable the native `/effort` selector.

## License

MIT
