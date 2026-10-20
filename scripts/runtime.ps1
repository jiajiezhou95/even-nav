$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = Join-Path $root 'node_modules/node/bin/node.exe'
if (!(Test-Path -LiteralPath $node)) { throw 'Run npm ci first to install the project-local Node runtime.' }
$npm = Join-Path (Split-Path (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js'
$env:PATH = (Split-Path $node) + ';' + $env:PATH
& $node $npm @args
exit $LASTEXITCODE
