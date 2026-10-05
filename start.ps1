$ErrorActionPreference = "Stop"
$appDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $appDirectory

Write-Host "Starting the class scoring app..."
Write-Host "Student page: http://localhost:3000"
Write-Host "Admin page:   http://localhost:3000/admin"
Write-Host "Press Ctrl+C to stop."
node server.mjs
