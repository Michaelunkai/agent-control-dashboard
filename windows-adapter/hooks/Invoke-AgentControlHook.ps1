param()

$ErrorActionPreference = "Stop"
$endpoint = "http://127.0.0.1:17867/hooks"
$fallback = Join-Path $env:LOCALAPPDATA "AgentControl\hook-fallback.jsonl"
$payload = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrWhiteSpace($payload)) {
    exit 0
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
Write-Output '{"continue":true}'
exit 0
