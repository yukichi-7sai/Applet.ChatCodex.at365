param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskHostRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot '..\AppDock.at365'))
$taskTools = Get-Content -LiteralPath (Join-Path $taskHostRoot 'toolchain.json') -Raw | ConvertFrom-Json
$taskNode = Join-Path $taskHostRoot ".tools\node\$($taskTools.node)\node.exe"
& $taskNode (Join-Path $PSScriptRoot 'build.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$taskSource = Join-Path $taskRoot 'out\Applet.ChatCodex.at365'
$taskOutput = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { [IO.Path]::GetFullPath((Join-Path $taskRoot '..\..\40.ARTIFACT\Applet.ChatCodex.at365')) }
$taskPackage = Join-Path $taskOutput 'Applet.ChatCodex.at365'
New-Item -ItemType Directory -Path $taskPackage -Force | Out-Null
Copy-Item -Path (Join-Path $taskSource '*') -Destination $taskPackage -Recurse -Force
$taskPacker = Join-Path $taskHostRoot '.artifacts\updater\AppDock.Updater.exe'
if (-not (Test-Path -LiteralPath $taskPacker)) { throw 'The existing AppDock update packer is required. Host rebuild is not performed.' }
# Use the standard packer without rebuilding or writing into the host repository.
& $taskPacker --pack applet $taskPackage unused $taskOutput
if ($LASTEXITCODE -ne 0) { throw 'Applet update packaging failed.' }
. (Join-Path $taskHostRoot 'scripts\publish-paths.ps1')
Install-PublishedDeployment $taskRoot $taskOutput
Write-Output "Published: $taskOutput"
