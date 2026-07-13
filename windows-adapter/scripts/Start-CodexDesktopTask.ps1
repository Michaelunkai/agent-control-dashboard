param(
    [Parameter(Mandatory = $true)][string]$Workspace,
    [Parameter(Mandatory = $true)][string]$TaskId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$title = [Environment]::GetEnvironmentVariable('AGENT_CONTROL_TASK_TITLE')
$description = [Environment]::GetEnvironmentVariable('AGENT_CONTROL_TASK_DESCRIPTION')
if ([string]::IsNullOrWhiteSpace($title) -or [string]::IsNullOrWhiteSpace($description)) {
    throw 'Task title and description are required.'
}
$marker = 'AC-' + $TaskId.Substring(0, [Math]::Min(8, $TaskId.Length))
$prompt = @"
$title [$marker]

MANDATORY FIRST ACTION: obtain your current thread ID from the goal/thread context, then call
codex_app.set_thread_pinned with that thread ID and pinned=true. Verify the native pin succeeds
before doing any mission work.

Agent Control mission:
$description

Work autonomously. Keep this session's progress understandable, verify the result, and finish with a concise summary.
"@
$pinStatePath = Join-Path $env:USERPROFILE '.codex\.codex-global-state.json'
$sessionsRoot = Join-Path $env:USERPROFILE '.codex\sessions'
$knownSessionIds = @{}
Get-ChildItem -LiteralPath $sessionsRoot -Recurse -Filter '*.jsonl' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.BaseName -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$') {
        $knownSessionIds[$Matches[1]] = $true
    }
}

function Get-CodexWindow {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $ids = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    foreach ($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($ids -contains $window.Current.ProcessId -and $window.Current.ClassName -eq 'Chrome_WidgetWin_1') {
            return $window
        }
    }
    return $null
}

function Get-CodexWindowForWorkspace {
    $workspaceLeaf = Split-Path -Leaf $Workspace
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $ids = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    foreach ($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($ids -notcontains $window.Current.ProcessId -or $window.Current.ClassName -ne 'Chrome_WidgetWin_1') { continue }
        foreach ($element in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            $name = [string]$element.Current.Name
            if ($name -eq $Workspace -or $name -eq $workspaceLeaf -or $name -like "*$workspaceLeaf*") {
                return $window
            }
        }
    }
    return $null
}

function Wait-Until([scriptblock]$Action, [int]$Seconds = 20) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $result = & $Action
        if ($null -ne $result) { return $result }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return $null
}

function Find-CodexButton([string]$Name) {
    $liveWindow = Get-CodexWindowForWorkspace
    if ($null -eq $liveWindow) { return $null }
    $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $Name
    )
    $matches = $liveWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, $nameCondition)
    foreach ($candidate in $matches) {
        if ($candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
            return $candidate
        }
    }
    return $null
}

$codexCommand = (Get-Command codex.cmd -ErrorAction Stop).Source
Start-Process -FilePath $codexCommand -ArgumentList @('app', $Workspace) -WindowStyle Hidden
$window = Wait-Until { Get-CodexWindowForWorkspace } 30
if ($null -eq $window) { throw "Codex Desktop did not open the required workspace: $Workspace" }

$newTask = Wait-Until { Find-CodexButton 'New task' } 10
if ($null -eq $newTask) { throw 'Codex Desktop New task control was not available.' }
$newTask.SetFocus()
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')

$composer = Wait-Until {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -ne $focused -and $focused.Current.ClassName -like 'ProseMirror*') { $focused } else { $null }
} 10
if ($null -eq $composer) { throw 'Codex Desktop composer did not receive focus.' }

$hadText = [System.Windows.Forms.Clipboard]::ContainsText()
$previousText = if ($hadText) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }
try {
    [System.Windows.Forms.Clipboard]::SetText($prompt)
    $composer.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 350
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
} finally {
    Start-Sleep -Milliseconds 500
    if ($hadText) { [System.Windows.Forms.Clipboard]::SetText($previousText) }
}

$newSessionId = Wait-Until {
    $candidates = Get-ChildItem -LiteralPath $sessionsRoot -Recurse -Filter '*.jsonl' -ErrorAction SilentlyContinue |
        Where-Object {
            $_.BaseName -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' -and
            -not $knownSessionIds.ContainsKey($Matches[1])
        }
    foreach ($candidate in $candidates) {
        if (Select-String -LiteralPath $candidate.FullName -Pattern $marker -SimpleMatch -Quiet) {
            $firstRecord = Get-Content -LiteralPath $candidate.FullName -TotalCount 1 | ConvertFrom-Json
            if ($firstRecord.type -eq 'session_meta' -and $firstRecord.payload.id) {
                return [string]$firstRecord.payload.id
            }
        }
    }
    return $null
} 30
if ([string]::IsNullOrWhiteSpace($newSessionId)) {
    throw "Codex submitted the prompt but its new persistent session could not be identified ($marker)."
}

$pinPersisted = Wait-Until {
    $saved = Get-Content -LiteralPath $pinStatePath -Raw | ConvertFrom-Json
    if (@($saved.'pinned-thread-ids') -contains $newSessionId) { return $true }
    return $null
} 30
if ($pinPersisted -ne $true) { throw "The new Codex session did not complete its native pin action ($newSessionId)." }
Start-Sleep -Seconds 3
$confirmedState = Get-Content -LiteralPath $pinStatePath -Raw | ConvertFrom-Json
if (@($confirmedState.'pinned-thread-ids') -notcontains $newSessionId) {
    throw "Codex did not retain native pin state for session $newSessionId."
}

[pscustomobject]@{
    accepted = $true
    marker = $marker
    sessionId = $newSessionId
    title = $title
    pinned = $true
} | ConvertTo-Json -Compress
