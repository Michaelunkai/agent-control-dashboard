param([switch]$RemoveCredentials)

$ErrorActionPreference = "Stop"
$taskName = "AgentControlWindowsAdapter"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
if ($RemoveCredentials) {
    [Environment]::SetEnvironmentVariable("AgentControl__ApiUrl", $null, "User")
    [Environment]::SetEnvironmentVariable("AgentControl__OwnerToken", $null, "User")
}
Write-Output "Adapter task removed. Existing Codex hooks were left unchanged for preserve-first cleanup."
