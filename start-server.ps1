# Swasthya Healthcare Server Launcher for PowerShell
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Swasthya Production Healthcare Companion Server" -ForegroundColor Green
Write-Host "  Running at: http://localhost:4173" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    Write-Host "[INFO] Starting with system Node.js..." -ForegroundColor Cyan
    & node server.js
} else {
    $vscode = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
    if (Test-Path $vscode) {
        Write-Host "[INFO] Starting with VS Code Node runtime..." -ForegroundColor Cyan
        $env:ELECTRON_RUN_AS_NODE = "1"
        & $vscode server.js
    } else {
        Write-Host "[ERROR] Node.js not detected. Please install Node.js from https://nodejs.org" -ForegroundColor Red
        Read-Host "Press Enter to exit..."
    }
}

