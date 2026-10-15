@echo off
title ChoyxonaAzizxon — Ofitsiant Paneli
cd /d "%~dp0"

node -e "require('net').connect(3000, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Server ishga tushirilmoqda, iltimos 2 soniya kuting...
    start "Choyxona Server" /min cmd /c "node dist\server.js"
    timeout /t 3 /nobreak >nul
)

start "" msedge --app=http://localhost:3000/waiter 2>nul || start "" chrome --app=http://localhost:3000/waiter 2>nul || start http://localhost:3000/waiter
exit
