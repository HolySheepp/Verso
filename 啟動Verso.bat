@echo off
rem Double-click to start Verso (dev mode). Same as running "npm run tauri dev" in this folder.
cd /d "%~dp0"

rem Install or update dependencies first (needed after git pull)
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

call npm run tauri dev
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo Verso failed to start. See the messages above.
pause
