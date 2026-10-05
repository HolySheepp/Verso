@echo off
chcp 65001 >nul
rem Double-click to build Verso: the installer (Verso_x.y.z_x64-setup.exe) goes to ..\安裝包, Verso.exe is copied next to this file.
cd /d "%~dp0"

call npm install --no-audit --no-fund
if errorlevel 1 goto fail

rem remove old installers so only the latest build is copied
if exist "src-tauri\target\release\bundle\nsis" erase /q "src-tauri\target\release\bundle\nsis\*-setup.exe" >nul 2>&1

call npm run tauri build
if errorlevel 1 goto fail

if not exist "..\安裝包" mkdir "..\安裝包"
copy /y "src-tauri\target\release\verso.exe" "Verso.exe" >nul
for %%f in ("src-tauri\target\release\bundle\nsis\*-setup.exe") do copy /y "%%f" "..\安裝包\" >nul
echo.
echo Done: installer in ..\安裝包 , Verso.exe in this folder.
pause
exit /b 0

:fail
echo.
echo Build failed. See the messages above.
pause
