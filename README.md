# cliproxy-provider

Mod de [Command Code](https://commandcode.ai/) para usar [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) como un provider OpenAI-compatible.

El mod registra un provider `direct`, envía las conversaciones a `/v1/chat/completions` y soporta texto, razonamiento, tools y streaming SSE.

## Estado actual

- Modelos disponibles mediante IDs propios `cliproxy-*`.
- Streaming SSE real con fallback a respuestas JSON.
- Conversión de tools y `tool_result` al formato OpenAI.
- Cancelación del request enlazada al `AbortSignal` de Command Code.
- Selección de modelo y reasoning effort desde `/cliproxy`.
- No modifica `settings.json`.
- No reclama IDs del catálogo de Command Code.

> Los mods de Command Code son experimentales y se ejecutan sin sandbox. Instala únicamente código que confíes.

## Modelos

El mod ofrece estos IDs:

- `cliproxy-gpt-5.6-sol`
- `cliproxy-gpt-5.6-terra`
- `cliproxy-gpt-5.6-luna`
- `cliproxy-gpt-5.5`
- `cliproxy-gpt-5.4`
- `cliproxy-gpt-5.4-mini`
- `cliproxy-codex-auto-review`

CLIProxyAPI actualmente puede resolver `codex-auto-review` hacia GPT-5.4; el nombre del modelo efectivo puede diferir del ID solicitado.

`gpt-5.3-codex-spark` no se anuncia por defecto porque el endpoint probado respondió `auth_unavailable` para ese modelo.

## Configuración

El mod lee:

```text
~/.commandcode/cliproxy.json
```

Ejemplo:

```json
{
  "baseUrl": "http://127.0.0.1:8317/v1",
  "apiKey": "your-api-key",
  "model": "cliproxy-gpt-5.6-luna",
  "effort": "high"
}
```

También acepta:

```text
CLIPROXY_BASE_URL
CLIPROXY_API_KEY
```

La precedencia es:

1. `cliproxy.json`.
2. Variables de entorno.
3. `http://127.0.0.1:8317/v1` para la URL y ningún token para la API key.

El valor de `baseUrl` puede terminar en `/`; el mod lo normaliza antes de añadir `/chat/completions`.

## Instalación recomendada

### Como paquete git

```bash
cmd mods add -g hernandurango6/cmdc-cliproxy
```

El paquete se descubre como mod en la siguiente sesión. Configura después:

```powershell
@'
{
  "baseUrl": "http://127.0.0.1:8317/v1",
  "apiKey": "your-api-key",
  "model": "cliproxy-gpt-5.6-luna",
  "effort": "high"
}
'@ | Set-Content "$HOME\.commandcode\cliproxy.json"
```

O utiliza variables de entorno:

```powershell
$env:CLIPROXY_BASE_URL = 'http://127.0.0.1:8317/v1'
$env:CLIPROXY_API_KEY = 'your-api-key'
```

### Instalador local de Windows

```powershell
.\install.ps1 -BaseUrl http://127.0.0.1:8317/v1 -ApiKey your-api-key
```

El instalador:

1. Copia `index.ts` a `~/.commandcode/mods/cliproxy-provider.ts`.
2. Crea `~/.commandcode/cliproxy.json` si no existe.
3. No modifica `~/.commandcode/settings.json`.
4. Conserva una configuración existente salvo que se use `-Force`.

Opciones:

```powershell
.\install.ps1 -SkipConfig
.\install.ps1 -Force -BaseUrl http://127.0.0.1:8317/v1 -ApiKey new-key
```

## Uso

### Inicio

En Command Code 1.7.0, el CLI valida `--model` antes de que el mod pueda registrar sus IDs. Por eso esto puede ser rechazado:

```bash
cmdc --model cliproxy-gpt-5.6-luna
```

El mod no reclama IDs del catálogo como `gpt-5.6-luna`. En su lugar, inicia normalmente:

```bash
cmdc
```

y el mod fuerza el modelo configurado (`cliproxy-*`) cuando se crea o reanuda la sesión.

También puedes iniciar con un ID de catálogo válido para Command Code, pero el mod lo reemplazará por el modelo `cliproxy-*` configurado en `cliproxy.json`:

```bash
cmdc --model gpt-5.6-luna
```

El ID mostrado en el banner puede no coincidir con el modelo efectivo del provider.

### Comandos

| Comando | Función |
|---|---|
| `/cliproxy` | Muestra provider, modelo, effort, URL y si existe una key. |
| `/cliproxy model` | Selecciona un modelo CLIProxyAPI y lo aplica al siguiente turno. |
| `/cliproxy effort` | Selecciona `low`, `medium`, `high`, `xhigh` o `max` y lo aplica en vivo. |

Los cambios de modelo y effort se guardan en `cliproxy.json` y también llaman a `cmd.setModel`/`cmd.setEffort`, por lo que no requieren reiniciar la sesión.

### Headless

Para una prueba headless, carga el archivo explícitamente y usa un modelo de catálogo válido; el mod lo reemplazará durante el arranque:

```bash
cmdc -p "Respond with exactly OK." \
  --mod ./index.ts \
  --model gpt-5.6-luna \
  --max-turns 1
```

La validación inicial de `--model` ocurre antes de la ejecución del mod; `cliproxy-*` no es un valor válido para esa opción en Command Code 1.7.0.

## Tools y streaming

El mod convierte las tools de Command Code a:

```json
{
  "type": "function",
  "function": {
    "name": "...",
    "description": "...",
    "parameters": {}
  }
}
```

Las respuestas SSE se procesan incrementalmente. Se acumulan llamadas de tools fragmentadas por índice y se convierten a bloques `tool_use`. Los resultados de tools se envían como mensajes OpenAI `role: "tool"` con `tool_call_id`.

Si el servidor no devuelve `text/event-stream`, se acepta una respuesta JSON compatible.

## Limitaciones conocidas

- Los subagentes de Command Code validan su modelo contra el catálogo integrado; por eso no pueden seleccionar directamente un ID `cliproxy-*`.
- El banner puede seguir mostrando un modelo de catálogo aunque la petición efectiva use CLIProxyAPI.
- El backend de CLIProxyAPI determina qué modelos están realmente autorizados.
- Las imágenes se convierten a `image_url` cuando el bloque incluye una URL o una fuente base64 compatible.

## Verificación

Comprobar que el mod fue descubierto:

```bash
cmdc mods list
```

Debe aparecer el paquete `cmdc-cliproxy` o el archivo `cliproxy-provider`.

Para una prueba real:

```bash
cmdc -p "Respond with exactly OK." \
  --mod ./index.ts \
  --model gpt-5.6-luna \
  --max-turns 1
```

No uses `cmdc providers --json` para verificar este mod: ese comando lista providers de autenticación integrados, no providers registrados por mods.

## Desarrollo

```bash
npm install
npm test
```

Las pruebas usan mocks locales y no requieren una API key.

## Licencia

MIT
