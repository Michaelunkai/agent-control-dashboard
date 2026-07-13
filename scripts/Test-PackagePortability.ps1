$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $root "windows-adapter\Start-AgentControlAdapterHidden.vbs"
$launcher = Get-Content -LiteralPath $launcherPath -Raw

if ($launcher -match '[A-Za-z]:\\') {
    throw "The hidden adapter launcher contains an absolute Windows path."
}
if ($launcher -notmatch 'WScript\.ScriptFullName') {
    throw "The hidden adapter launcher does not resolve its own directory."
}
if ($launcher -notmatch 'dist\\server\.js') {
    throw "The hidden adapter launcher does not resolve the built server."
}

$personalPathMatches = @(Get-ChildItem -LiteralPath $root -Recurse -File |
    Where-Object { $_.FullName -notmatch '\\.git\\|\\node_modules\\|\\build\\|\\dist\\' } |
    Select-String -Pattern 'C:\\Users\\micha\\Documents\\Codex')
if ($personalPathMatches.Count -gt 0) {
    throw "The portable package contains the original machine-specific source path."
}

Write-Output "Package portability checks passed."
