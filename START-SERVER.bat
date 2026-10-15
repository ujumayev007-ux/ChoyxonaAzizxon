@echo off
title Choyxona Azizxon — Asosiy Server [Port 3000]
color 0E
cd /d "%~dp0"

echo ==========================================================
echo        CHOYXONA AZIZXON - ASOSIY SERVER ISHGA TUSHYAPTI
echo ==========================================================
echo.
echo Server manzili: http://localhost:3000
echo.
echo Panellar:
echo   - Super Owner:  http://localhost:3000/super-owner
echo   - Admin:        http://localhost:3000/admin
echo   - Kassa:        http://localhost:3000/cashier
echo   - Ofitsiant:    http://localhost:3000/waiter
echo   - Oshxona:      http://localhost:3000/kitchen
echo.
echo [Serverni to'xtatish uchun ushbu oynani yoping yoki Ctrl+C bosing]
echo ==========================================================
echo.

node dist\server.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server ishga tushishida xatolik yuz berdi. npm run build tekshirilmoqda...
    call npm run build
    node dist\server.js
)
pause

