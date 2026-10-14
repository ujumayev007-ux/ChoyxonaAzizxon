@echo off
title ChoyxonaAzizxon — Kassa (POS)
set APP_ROLE=cashier
if exist node_modules\electron (
    start "" npx electron desktop --role=cashier
) else (
    start "" msedge --app=http://localhost:3000/cashier 2>nul || start "" chrome --app=http://localhost:3000/cashier 2>nul || start http://localhost:3000/cashier
)
exit

