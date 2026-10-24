param([ValidateSet('build','test','ui','probe')][string]$Task = 'test')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskHostRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot '..\AppDock.at365'))
$taskTools = Get-Content -LiteralPath (Join-Path $taskHostRoot 'toolchain.json') -Raw | ConvertFrom-Json
$taskNode = Join-Path $taskHostRoot ".tools\node\$($taskTools.node)\node.exe"
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Run the AppDock fixed-tool setup first.' }
Push-Location $taskRoot
try {
    if ($Task -eq 'test') {
        $taskTests = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'tests') -File -Filter '*.test.cjs' | ForEach-Object { $_.FullName })
        & $taskNode --test --test-concurrency=1 @taskTests
    } else {
        $taskScript = @{build='build.cjs';ui='ui-test.cjs';probe='real-probe.cjs'}[$Task]
        & $taskNode (Join-Path $PSScriptRoot $taskScript)
    }
    if ($LASTEXITCODE -ne 0) { throw "Task failed ($LASTEXITCODE)" }
} finally { Pop-Location }
