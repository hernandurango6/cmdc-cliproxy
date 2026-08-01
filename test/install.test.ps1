$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('cmdc-cliproxy-install-' + [guid]::NewGuid().ToString('N'))
$env:USERPROFILE = $temp
$env:HOME = $temp

try {
    $ccDir = Join-Path $temp '.commandcode'
    New-Item -ItemType Directory -Force -Path $ccDir | Out-Null
    $settingsPath = Join-Path $ccDir 'settings.json'
    $configPath = Join-Path $ccDir 'cliproxy.json'
    $missingConfigHome = Join-Path ([System.IO.Path]::GetTempPath()) ('cmdc-cliproxy-install-missing-' + [guid]::NewGuid().ToString('N'))
    $settingsBefore = [ordered]@{
        theme = 'dark'
        providers = [ordered]@{
            existing = [ordered]@{ module = 'existing-provider' }
        }
    }
    $settingsBefore | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8
    $configBefore = [ordered]@{
        baseUrl = 'http://existing.test/v1'
        apiKey = 'existing-key'
        model = 'cliproxy-gpt-5.6-luna'
        effort = 'max'
    }
    $configBefore | ConvertTo-Json | Set-Content $configPath -Encoding UTF8

    & (Join-Path $repo 'install.ps1') -SkipConfig | Out-Null

    $settingsAfter = Get-Content $settingsPath -Raw | ConvertFrom-Json
    $configAfter = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($settingsAfter.theme -ne 'dark') { throw 'settings.json theme was modified' }
    if ($settingsAfter.providers.existing.module -ne 'existing-provider') { throw 'existing provider was modified' }
    if ($null -ne $settingsAfter.providers.cliproxy) { throw 'installer unexpectedly added a cliproxy provider setting' }
    if ($configAfter.baseUrl -ne 'http://existing.test/v1') { throw 'existing cliproxy config was modified' }
    if ($configAfter.apiKey -ne 'existing-key') { throw 'existing API key was modified' }

    & (Join-Path $repo 'install.ps1') -BaseUrl 'http://new.test/v1' -ApiKey 'new-key' | Out-Null
    $preservedAfterParams = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($preservedAfterParams.baseUrl -ne 'http://existing.test/v1') { throw 'parameters unexpectedly replaced an existing config without -Force' }

    & (Join-Path $repo 'install.ps1') -Force -BaseUrl 'http://new.test/v1' -ApiKey 'new-key' | Out-Null
    $replaced = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($replaced.baseUrl -ne 'http://new.test/v1') { throw '-Force did not replace the existing base URL' }
    if ($replaced.apiKey -ne 'new-key') { throw '-Force did not replace the existing API key' }
    if ($replaced.model -ne 'cliproxy-gpt-5.6-sol') { throw 'new config is missing model' }
    if ($replaced.effort -ne 'high') { throw 'new config is missing effort' }

    $missingEnvUserProfile = $env:USERPROFILE
    $missingEnvHome = $env:HOME
    try {
        $env:USERPROFILE = $missingConfigHome
        $env:HOME = $missingConfigHome
        & (Join-Path $repo 'install.ps1') -BaseUrl 'http://created.test/v1' -ApiKey 'created-key' | Out-Null
        $createdPath = Join-Path $missingConfigHome '.commandcode\cliproxy.json'
        if (-not (Test-Path $createdPath)) { throw 'installer did not create a missing config' }
        $created = Get-Content $createdPath -Raw | ConvertFrom-Json
        if ($created.baseUrl -ne 'http://created.test/v1') { throw 'created config has wrong base URL' }
        if ($created.apiKey -ne 'created-key') { throw 'created config has wrong API key' }
        if ($created.model -ne 'cliproxy-gpt-5.6-sol') { throw 'created config is missing model' }
        if ($created.effort -ne 'high') { throw 'created config is missing effort' }
    } finally {
        $env:USERPROFILE = $missingEnvUserProfile
        $env:HOME = $missingEnvHome
        if (Test-Path $missingConfigHome) { Remove-Item $missingConfigHome -Recurse -Force }
    }

    Write-Host 'install.ps1 isolated preservation and creation test passed'
} finally {
    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
}
