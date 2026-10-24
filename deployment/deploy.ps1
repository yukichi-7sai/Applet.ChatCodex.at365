param([Parameter(Mandatory=$true)][string]$AppDockDirectory)
$ErrorActionPreference = 'Stop'
$taskHost = [IO.Path]::GetFullPath($AppDockDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $taskHost 'AppDock.at365.exe'))) { throw 'AppDock.at365.exe was not found.' }
$taskSource = Join-Path $PSScriptRoot 'Applet.ChatCodex.at365'
$taskTarget = Join-Path $taskHost 'extensions\Applet.ChatCodex.at365'
New-Item -ItemType Directory -Path $taskTarget -Force | Out-Null
Copy-Item -Path (Join-Path $taskSource '*') -Destination $taskTarget -Recurse -Force
Write-Output "Deployed: $taskTarget"
