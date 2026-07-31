# cliproxy-provider

Command Code provider for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — exposes your
proxy's models (GPT-5.6 Sol / Terra / Luna, etc.) inside Command Code through an OpenAI-compatible
`direct` transport.

## What it does

- Registers a `cliproxy` provider with Command Code.
- Default model: `cliproxy-gpt-5.6-sol` (change via `model` in `~/.commandcode/settings.json`).
- Reads URL + API key from `~/.commandcode/cliproxy.json` (no env vars needed).

## Files

| File | Purpose |
|---|---|
| `index.ts` | The provider (dual-mode: works as a mod or as a config provider). |
| `install.ps1` | One-command installer for Windows. |
| `cliproxy.example.json` | Template for URL + API key. |

## Install on a new machine

```powershell
# 1. Clone/copy this folder to the machine, then:
cd cliproxy-provider

# 2. Put your real URL + key in cliproxy.json (copy from the example), OR:
Copy-Item cliproxy.example.json cliproxy.json
#    ...then edit cliproxy.json

# 3. Run the installer:
.\install.ps1
```

Or pass the values directly (no config file needed):

```powershell
.\install.ps1 -BaseUrl http://100.111.17.56:8317/v1 -ApiKey fff75d...
```

The installer copies the provider to `~/.commandcode/mods/`, writes `~/.commandcode/cliproxy.json`,
and merges the `providers` + `model` keys into `~/.commandcode/settings.json` **without touching**
your existing settings.

Then restart Command Code (or `/reload`). Check it registered:

```powershell
cmdc providers --json
```

## Available models

`cliproxy-gpt-5.6-sol`, `cliproxy-gpt-5.6-terra`, `cliproxy-gpt-5.6-luna`, `cliproxy-gpt-5.5`,
`cliproxy-gpt-5.4`, `cliproxy-gpt-5.4-mini`, `cliproxy-gpt-5.3-codex-spark`, `cliproxy-codex-auto-review`.

Switch models in-session with `/model`, or set the default:

```json
{ "model": "cliproxy-gpt-5.6-terra", "providers": { "cliproxy": { "module": "..." } } }
```

## Notes

- `--model <id>` on the CLI only accepts the built-in catalog; select via `/model` or the
  `model` setting instead.
- The provider reads `~/.commandcode/cliproxy.json`:
  ```json
  { "baseUrl": "http://100.111.17.56:8317/v1", "apiKey": "your-key" }
  ```
- Env var fallbacks: `CLIPROXY_BASE_URL`, `CLIPROXY_API_KEY`.

## License

MIT
