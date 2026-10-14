@echo off
title ChoyxonaAzizxon — Admin Boshqaruv
set APP_ROLE=admin
if exist node_modules\electron (
    start "" npx electron desktop --role=admin
) else (
    start "" msedge --app=http://localhost:3000/admin 2>nul || start "" chrome --app=http://localhost:3000/admin 2>nul || start http://localhost:3000/admin
)
exit

