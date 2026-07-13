$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$parseErrors = @()
$scripts = @(Get-ChildItem -LiteralPath $root -Recurse -Filter *.ps1 -File |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\build\\' })

foreach ($script in $scripts) {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $script.FullName,
        [ref]$tokens,
        [ref]$errors
    ) | Out-Null

    foreach ($errorItem in @($errors)) {
        $parseErrors += "{0}:{1}: {2}" -f `
            $errorItem.Extent.File,
            $errorItem.Extent.StartLineNumber,
            $errorItem.Message
    }
}

if ($parseErrors.Count -gt 0) {
    $parseErrors | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output "PowerShell 5.1 parse passed for $($scripts.Count) scripts."
