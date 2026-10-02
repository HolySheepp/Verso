@echo off
rem Double-click to build Verso: the installer (Verso_x.y.z_x64-setup.exe) and Verso.exe are copied next to this file.
cd /d "%~dp0"

call npm install --no-audit --no-fund
if errorlevel 1 goto fail

call npm run tauri build
if errorlevel 1 goto fail

copy /y "src-tauri\target\release\verso.exe" "Verso.exe" >nul
for %%f in ("src-tauri\target\release\bundle\nsis\*-setup.exe") do copy /y "%%f" . >nul
echo.
echo Done: the installer and Verso.exe are in this folder.
pause
exit /b 0

:fail
echo.
echo Build failed. See the messages above.
pause
