param(
    [Parameter(Mandatory = $true)][ValidatePattern('^https://')][string]$ApiUrl,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$OwnerToken
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$hook = Join-Path $root "hooks\Invoke-AgentControlHook.ps1"
$server = Join-Path $root "dist\server.js"
$hooksPath = Join-Path $env:USERPROFILE ".codex\hooks.json"
$hooksDirectory = Split-Path -Parent $hooksPath
$taskName = "AgentControlWindowsAdapter"
$windowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$hiddenLauncher = Join-Path $root "Start-AgentControlAdapterHidden.vbs"

Push-Location $root
try {
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "Adapter build failed." }
} finally {
    Pop-Location
}
New-Item -ItemType Directory -Path $hooksDirectory -Force | Out-Null

$document = if (Test-Path -LiteralPath $hooksPath) {
    Get-Content -LiteralPath $hooksPath -Raw | ConvertFrom-Json
} else {
    [pscustomobject]@{ hooks = [pscustomobject]@{} }
}
if (-not $document.hooks) {
    $document | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force
}

$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$hook`""
foreach ($eventName in @("SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd")) {
    $current = @($document.hooks.$eventName)
    $filtered = @($current | Where-Object {
        $commands = @($_.hooks | ForEach-Object { $_.commandWindows; $_.command_windows; $_.command })
        -not ($commands -match [regex]::Escape("Invoke-AgentControlHook.ps1"))
    })
    $entry = [pscustomobject]@{
        hooks = @([pscustomobject]@{
            type = "command"
            command = $command
            timeout = 5
            statusMessage = "Updating Agent Control"
        })
    }
    $document.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue @($filtered + $entry) -Force
}

$temporary = "$hooksPath.tmp"
$document | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporary -Encoding UTF8
Move-Item -LiteralPath $temporary -Destination $hooksPath -Force

[Environment]::SetEnvironmentVariable("AgentControl__ApiUrl", $ApiUrl.TrimEnd('/'), "User")
[Environment]::SetEnvironmentVariable("AgentControl__OwnerToken", $OwnerToken, "User")

$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$escapedLauncher = $hiddenLauncher.Replace('"', '""')
$action = New-ScheduledTaskAction -Execute $wscript -Argument "//B //Nologo `"$escapedLauncher`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $windowsIdentity
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Durable local Codex lifecycle adapter for Agent Control" -Force -ErrorAction Stop | Out-Null
Start-ScheduledTask -TaskName $taskName

[pscustomobject]@{
    TaskName = $taskName
    HooksPath = $hooksPath
    Server = $server
    TrustReviewRequired = $true
}
