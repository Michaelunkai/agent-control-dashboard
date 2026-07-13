param(
    [string]$DatabaseName = "agent-control",
    [string]$WorkerName = "agent-control",
    [string]$OwnerToken
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root "wrangler.toml"
$deploymentRoot = Join-Path $env:LOCALAPPDATA "AgentControl"
$deploymentPath = Join-Path $deploymentRoot "deployment.json"

function Invoke-WranglerJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = & npx wrangler @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Wrangler failed: $($output -join [Environment]::NewLine)"
    }
    $jsonStart = ($output | Select-String -Pattern '^\s*[\[{]' | Select-Object -First 1).LineNumber
    if (-not $jsonStart) {
        throw "Wrangler did not return JSON: $($output -join [Environment]::NewLine)"
    }
    return (($output[($jsonStart - 1)..($output.Count - 1)] -join [Environment]::NewLine) | ConvertFrom-Json)
}

Push-Location $root
try {
    $identity = & npx wrangler whoami 2>&1
    if ($LASTEXITCODE -ne 0 -or ($identity -join "`n") -match "not authenticated") {
        throw "Cloudflare authorization is required. Run 'npx wrangler login' and approve it in the browser."
    }

    $databases = @(Invoke-WranglerJson -Arguments @("d1", "list", "--json"))
    $database = $databases | Where-Object { $_.name -eq $DatabaseName } | Select-Object -First 1
    if (-not $database) {
        $created = Invoke-WranglerJson -Arguments @("d1", "create", $DatabaseName, "--json")
        $database = if ($created.uuid) { $created } elseif ($created.result) { $created.result } else { $created }
    }
    $databaseId = if ($database.uuid) { [string]$database.uuid } else { [string]$database.id }
    if ([string]::IsNullOrWhiteSpace($databaseId)) {
        throw "Could not determine the D1 database id."
    }

    $config = Get-Content -LiteralPath $configPath -Raw
    $config = [regex]::Replace($config, '(?m)^name\s*=\s*"[^"]+"', "name = `"$WorkerName`"")
    $config = [regex]::Replace($config, '(?m)^database_name\s*=\s*"[^"]+"', "database_name = `"$DatabaseName`"")
    $config = [regex]::Replace($config, '(?m)^database_id\s*=\s*"[^"]+"', "database_id = `"$databaseId`"")
    Set-Content -LiteralPath $configPath -Value $config -Encoding UTF8

    & npx wrangler d1 migrations apply $DatabaseName --remote
    if ($LASTEXITCODE -ne 0) { throw "Remote D1 migration failed." }

    if ([string]::IsNullOrWhiteSpace($OwnerToken)) {
        $bytes = [byte[]]::new(32)
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $random.GetBytes($bytes)
        } finally {
            $random.Dispose()
        }
        $OwnerToken = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    }
    $OwnerToken | & npx wrangler secret put OWNER_TOKEN
    if ($LASTEXITCODE -ne 0) { throw "OWNER_TOKEN secret update failed." }

    $deployOutput = & npx wrangler deploy 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Worker deployment failed: $($deployOutput -join [Environment]::NewLine)"
    }
    $deploymentUrl = [regex]::Match(($deployOutput -join "`n"), 'https://[a-zA-Z0-9.-]+\.workers\.dev').Value
    if ([string]::IsNullOrWhiteSpace($deploymentUrl)) {
        throw "Deployment succeeded but the workers.dev URL was not found in Wrangler output."
    }

    New-Item -ItemType Directory -Path $deploymentRoot -Force | Out-Null
    [pscustomobject]@{
        apiUrl = $deploymentUrl
        ownerToken = $OwnerToken
        databaseName = $DatabaseName
        databaseId = $databaseId
        workerName = $WorkerName
        deployedAt = [DateTimeOffset]::UtcNow.ToString("O")
    } | ConvertTo-Json | Set-Content -LiteralPath $deploymentPath -Encoding UTF8

    $acl = Get-Acl -LiteralPath $deploymentPath
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
        "FullControl",
        "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $deploymentPath -AclObject $acl

    [pscustomobject]@{
        ApiUrl = $deploymentUrl
        DatabaseId = $databaseId
        DeploymentFile = $deploymentPath
        HealthUrl = "$deploymentUrl/health"
    }
} finally {
    Pop-Location
}
