# install.ps1 — installs the CLIProxyAPI provider into Command Code on this machine.
# Usage:  .\install.ps1              (uses ./cliproxy.json or ./cliproxy.example.json)
#         .\install.ps1 -BaseUrl http://host:port/v1 -ApiKey sk-xxx
#         .\install.ps1 -SkipConfig  (keep an existing ~/.commandcode/cliproxy.json)
#
# Does:
#   1. Copies index.ts -> ~/.commandcode/mods/cliproxy-provider.ts
#   2. Creates ~/.commandcode/cliproxy.json from cliproxy.json / cliproxy.example.json
#      (or from -BaseUrl/-ApiKey), unless it already exists and -SkipConfig is set.
#   3. Merges the "providers" and "model" keys into ~/.commandcode/settings.json,
#      preserving any existing settings (theme, permissions, etc.).

param(
    [string]$BaseUrl,
    [string]$ApiKey,
    [switch]$SkipConfig
)

$ErrorActionPreference = 'Stop'

$homeDir = $env:USERPROFILE
if (-not $homeDir) { $homeDir = $HOME }
$ccDir   = Join-Path $homeDir '.commandcode'
$modsDir = Join-Path $ccDir 'mods'
$settingsPath = Join-Path $ccDir 'settings.json'
$configPath   = Join-Path $ccDir 'cliproxy.json'

New-Item -ItemType Directory -Force -Path $modsDir | Out-Null

# 1. Provider file
$src = Join-Path $PSScriptRoot 'index.ts'
if (-not (Test-Path $src)) { throw "index.ts not found next to install.ps1 ($src)" }
Copy-Item $src (Join-Path $modsDir 'cliproxy-provider.ts') -Force
Write-Host "[1/3] Provider copied to $modsDir\cliproxy-provider.ts"

# 2. Config file
if (-not $SkipConfig) {
    if (-not $BaseUrl -and -not $ApiKey) {
        # Prefer a real config in the repo, else the example
        $repoConfig = Join-Path $PSScriptRoot 'cliproxy.json'
        $example    = Join-Path $PSScriptRoot 'cliproxy.example.json'
        $configSrc  = if (Test-Path $repoConfig) { $repoConfig } else { $example }
        $parsed = Get-Content $configSrc -Raw | ConvertFrom-Json
        $BaseUrl = if ($BaseUrl) { $BaseUrl } elseif ($parsed.baseUrl) { $parsed.baseUrl } else { '' }
        $ApiKey  = if ($ApiKey)  { $ApiKey }  elseif ($parsed.apiKey)  { $parsed.apiKey }  else { '' }
    }
    if (-not $BaseUrl) { $BaseUrl = Read-Host 'CLIProxyAPI base URL (e.g. http://host:8317/v1)' }
    if (-not $ApiKey)  { $ApiKey  = Read-Host 'CLIProxyAPI API key' }
    @{ baseUrl = $BaseUrl; apiKey = $ApiKey } | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
    Write-Host "[2/3] Config written to $configPath"
} else {
    Write-Host "[2/3] Skipped config (-SkipConfig); keeping $configPath"
}

# 3. Merge into settings.json
$modulePath = (Join-Path $modsDir 'cliproxy-provider.ts').Replace('\', '/')
$settings = @{}
if (Test-Path $settingsPath) {
    $existing = Get-Content $settingsPath -Raw | ConvertFrom-Json -AsHashtable
    foreach ($k in $existing.Keys) { $settings[$k] = $existing[$k] }
}
$settings['providers'] = @{
    cliproxy = @{ module = $modulePath }
}
if (-not $settings.ContainsKey('model')) {
    $settings['model'] = 'cliproxy-gpt-5.6-sol'
}
$settings | ConvertTo-Json -Depth 6 | Set-Content $settingsPath -Encoding UTF8
Write-Host "[3/3] settings.json updated (model: $($settings['model']))"

Write-Host ""
Write-Host "Done. Restart Command Code (or /reload) and the CLIProxyAPI provider is active."
Write-Host "Available models: cliproxy-gpt-5.6-sol, cliproxy-gpt-5.6-terra, cliproxy-gpt-5.6-luna, ..."
