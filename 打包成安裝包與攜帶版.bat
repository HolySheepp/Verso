@echo off
chcp 65001 >nul
rem Double-click to build the signed installer and the portable exe. Output goes to ..\安裝包 ; build files go to ..\建置暫存 (outside the source folder).
rem Same build as publishing (scripts\build.ps1), so publishing afterwards only uploads.
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\npm-install.ps1"
if errorlevel 1 goto fail

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build.ps1"
if errorlevel 1 goto fail
echo.
echo Done: installer and portable exe are in ..\安裝包
pause
exit /b 0

:fail
echo.
echo Build failed. See the messages above.
pause
