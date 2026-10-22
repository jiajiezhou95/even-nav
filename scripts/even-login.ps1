$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
& './node_modules/node/bin/node.exe' node_modules/@evenrealities/evenhub-cli/main.js login
exit $LASTEXITCODE
