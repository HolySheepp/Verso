@echo off
chcp 65001 >nul
rem Double-click to start Verso (dev mode). Same as running "npm run tauri dev" in this folder.
cd /d "%~dp0"

rem Check GitHub for a newer version first (asks before updating; skipped when offline)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\check-update.ps1"

rem Install or update dependencies only when package-lock.json changed (for example after git pull)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\npm-install.ps1"
if errorlevel 1 goto fail

call npm run tauri dev
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo Verso failed to start. See the messages above.
pause
