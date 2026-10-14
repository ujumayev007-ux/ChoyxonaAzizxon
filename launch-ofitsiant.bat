@echo off
title ChoyxonaAzizxon — Ofitsiant Terminali
set APP_ROLE=waiter
if exist node_modules\electron (
    start "" npx electron desktop --role=waiter
) else (
    start "" msedge --app=http://localhost:3000/waiter 2>nul || start "" chrome --app=http://localhost:3000/waiter 2>nul || start http://localhost:3000/waiter
)
exit

