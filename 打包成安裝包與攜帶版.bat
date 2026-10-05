@echo off
chcp 65001 >nul
rem Double-click to build the installer and the portable exe. Output goes to ..\安裝包 ; build files go to ..\建置暫存 (outside the source folder).
cd /d "%~dp0"
set "CARGO_TARGET_DIR=%~dp0..\建置暫存"

call npm install --no-audit --no-fund
if errorlevel 1 goto fail

rem remove old installers so only the latest build is copied
if exist "%CARGO_TARGET_DIR%\release\bundle\nsis" erase /q "%CARGO_TARGET_DIR%\release\bundle\nsis\*-setup.exe" >nul 2>&1

call npm run tauri build
if errorlevel 1 goto fail

if not exist "..\安裝包" mkdir "..\安裝包"
rem remove old installers in ..\安裝包 so only the newest one is kept
erase /q "..\安裝包\*-setup.exe" >nul 2>&1
copy /y "%CARGO_TARGET_DIR%\release\verso.exe" "..\安裝包\Verso_portable.exe" >nul
for %%f in ("%CARGO_TARGET_DIR%\release\bundle\nsis\*-setup.exe") do copy /y "%%f" "..\安裝包\" >nul
echo.
echo Done: installer and portable exe are in ..\安裝包
pause
exit /b 0

:fail
echo.
echo Build failed. See the messages above.
pause
