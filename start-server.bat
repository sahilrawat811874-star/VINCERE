@echo off
title Swasthya Production Healthcare Server
echo ========================================================
echo   Swasthya Production Healthcare Companion Server
echo   Running at http://localhost:4173
echo ========================================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [INFO] Found system Node.js. Starting server...
    node server.js
) else (
    if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" (
        echo [INFO] Using VS Code Node runtime...
        set ELECTRON_RUN_AS_NODE=1
        "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" server.js
    ) else (
        echo [ERROR] Node.js or VS Code runtime not found.
        echo Please install Node.js from https://nodejs.org
        pause
    )
)
pause

