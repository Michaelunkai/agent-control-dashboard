param()

$ErrorActionPreference = "Stop"
$endpointOverride = [Environment]::GetEnvironmentVariable('AgentControl__HookEndpoint')
$fallbackOverride = [Environment]::GetEnvironmentVariable('AgentControl__HookFallbackPath')
$endpoint = if ([string]::IsNullOrWhiteSpace($endpointOverride)) { "http://127.0.0.1:17867/hooks" } else { $endpointOverride }
$fallback = if ([string]::IsNullOrWhiteSpace($fallbackOverride)) {
    Join-Path $env:LOCALAPPDATA "AgentControl\hook-fallback.jsonl"
} else {
    $fallbackOverride
}
$payload = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrWhiteSpace($payload)) {
    exit 0
}
$parsedPayload = $null
try {
    $parsedPayload = $payload | ConvertFrom-Json
} catch {
    # The local receiver remains responsible for rejecting malformed hook JSON.
}

try {
    Invoke-RestMethod -Method Post -Uri $endpoint -ContentType "application/json" -Body $payload -TimeoutSec 2 | Out-Null
} catch {
    $directory = Split-Path -Parent $fallback
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    try {
        $payload = $payload | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 100
    } catch {
        # Preserve the original payload when Codex supplied malformed JSON.
    }
    Add-Content -LiteralPath $fallback -Value $payload -Encoding UTF8
}
if ($null -ne $parsedPayload -and $parsedPayload.hook_event_name -eq 'SessionStart') {
    [pscustomobject]@{
        continue = $true
        hookSpecificOutput = [pscustomobject]@{
            hookEventName = 'SessionStart'
            additionalContext = @'
Agent Control lifecycle contract: finish every final response with exactly one standalone line. Use AGENT_CONTROL_RESULT: DONE only after implementation and verification, AGENT_CONTROL_RESULT: WAITING when external input or access is required, or AGENT_CONTROL_RESULT: FAILED when supported recovery is exhausted. Never emit more than one result line.
'@
        }
    } | ConvertTo-Json -Compress -Depth 5
} else {
    Write-Output '{"continue":true}'
}
exit 0
