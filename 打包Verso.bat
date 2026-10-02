@echo off
rem Double-click to build Verso.exe (release). The exe is copied next to this file.
cd /d "%~dp0"

call npm install --no-audit --no-fund
if errorlevel 1 goto fail

call npm run tauri build -- --no-bundle
if errorlevel 1 goto fail

copy /y "src-tauri\target\release\verso.exe" "Verso.exe" >nul
echo.
echo Done: Verso.exe is ready in this folder.
pause
exit /b 0

:fail
echo.
echo Build failed. See the messages above.
pause
