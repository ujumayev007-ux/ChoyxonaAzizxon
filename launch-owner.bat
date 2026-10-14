@echo off
title ChoyxonaAzizxon — Owner Portal
start "" msedge --app=http://localhost:3000/owner 2>nul || start "" chrome --app=http://localhost:3000/owner 2>nul || start http://localhost:3000/owner
exit

