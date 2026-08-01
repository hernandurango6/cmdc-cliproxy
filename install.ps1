# install.ps1 — install the CLIProxyAPI mod into Command Code.
#
# Usage:
#   .\install.ps1
#   .\install.ps1 -BaseUrl http://127.0.0.1:8317/v1 -ApiKey sk-xxx
#   .\install.ps1 -SkipConfig
#   .\install.ps1 -Force
#
# Loose files under ~/.commandcode/mods are discovered automatically by
# Command Code. This installer therefore never modifies settings.json.

param(
    [string]$BaseUrl,
    [string]$ApiKey,
    [switch]$SkipConfig,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$homeDir = $env:USERPROFILE
if (-not $homeDir) { $homeDir = $HOME }
if (-not $homeDir) { throw 'Could not determine the user home directory.' }

$ccDir = Join-Path $homeDir '.commandcode'
$modsDir = Join-Path $ccDir 'mods'
$configPath = Join-Path $ccDir 'cliproxy.json'
$destination = Join-Path $modsDir 'cliproxy-provider.ts'

New-Item -ItemType Directory -Force -Path $modsDir | Out-Null

# 1. Copy the mod. It is intentionally a loose file so Command Code discovers it.
$source = Join-Path $PSScriptRoot 'index.ts'
if (-not (Test-Path $source)) {
    throw "index.ts not found next to install.ps1 ($source)"
}
Copy-Item $source $destination -Force
Write-Host "[1/2] Provider copied to $destination"

# 2. Create or explicitly replace the private provider configuration.
if ($SkipConfig) {
    Write-Host "[2/2] Skipped config (-SkipConfig); keeping $configPath"
} elseif ((Test-Path $configPath) -and -not $Force) {
    Write-Host "[2/2] Existing config preserved at $configPath (use -Force to replace it; supplied parameters were ignored)"
} else {
    if (-not $BaseUrl -and -not $ApiKey) {
        $examplePath = Join-Path $PSScriptRoot 'cliproxy.example.json'
        if (Test-Path $examplePath) {
            $example = Get-Content $examplePath -Raw | ConvertFrom-Json
            if ($example.baseUrl -and $example.baseUrl -notlike 'YOUR_*') {
                $BaseUrl = [string]$example.baseUrl
            }
        }
    }

    if (-not $BaseUrl) {
        $BaseUrl = Read-Host 'CLIProxyAPI base URL (e.g. http://127.0.0.1:8317/v1)'
    }
    if (-not $ApiKey) {
        $ApiKey = Read-Host 'CLIProxyAPI API key'
    }
    if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
        throw 'A CLIProxyAPI base URL is required.'
    }
    if ([string]::IsNullOrWhiteSpace($ApiKey) -or $ApiKey -like 'YOUR_*') {
        throw 'An actual CLIProxyAPI API key is required; placeholder or empty values are not accepted.'
    }

    @{
        baseUrl = $BaseUrl.TrimEnd('/')
        apiKey = $ApiKey
        model = 'cliproxy-gpt-5.6-sol'
        effort = 'high'
    } | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
    Write-Host "[2/2] Config written to $configPath"
}

Write-Host ''
Write-Host 'Done. Restart Command Code (or use /reload) and the CLIProxyAPI mod will be discovered automatically.'
Write-Host 'settings.json was not modified.'
Write-Host 'Available models: cliproxy-gpt-5.6-sol, cliproxy-gpt-5.6-terra, cliproxy-gpt-5.6-luna, ...'
