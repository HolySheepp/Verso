@echo off
chcp 65001 >nul
rem Double-click to build Verso as an installed-style app (no installer) into ..\Verso軟體 ; build files go to ..\建置暫存 (outside the source folder).
cd /d "%~dp0"
set "CARGO_TARGET_DIR=%~dp0..\建置暫存"

call npm install --no-audit --no-fund
if errorlevel 1 goto fail

call npm run tauri build -- --no-bundle
if errorlevel 1 goto fail

if not exist "..\Verso軟體" mkdir "..\Verso軟體"
copy /y "%CARGO_TARGET_DIR%\release\verso.exe" "..\Verso軟體\Verso.exe" >nul
echo.
echo Done: the app is in ..\Verso軟體
pause
exit /b 0

:fail
echo.
echo Build failed. See the messages above.
pause
