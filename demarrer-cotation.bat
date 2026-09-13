@echo off
title PKM Signal - Serveur de Cotation Cardmarket Live
cd /d "%~dp0"
echo ========================================================
echo   PKM SIGNAL - Moteur de Cotation Cardmarket Live
echo ========================================================
echo.
echo Verification des dependances...
if not exist "node_modules\" (
    echo [1/2] Installation initiale des dependances...
    call npm install
)
echo [2/2] Lancement du serveur sur http://localhost:3000...
echo.
echo Laissez cette fenetre ouverte pendant que vous utilisez PKM Portal.
echo Si Cloudflare demande une verification, cochez la case dans la fenetre Chrome.
echo.
node src/server.js
pause
