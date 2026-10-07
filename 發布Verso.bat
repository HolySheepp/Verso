@echo off
chcp 65001 >nul
rem Double-click to publish the current version to GitHub Releases.
rem Checks first, skips the build when the newest installer (with signature) already exists, then runs scripts\release.ps1.
cd /d "%~dp0"
set "CARGO_TARGET_DIR=%~dp0..\建置暫存"

echo [1/5] Checking git state...
git fetch origin >nul 2>&1
if errorlevel 1 ( echo Cannot reach GitHub. Check the network. & goto fail )

set "DIRTY="
for /f "delims=" %%a in ('git status --porcelain -- . ":(exclude).claude"') do set "DIRTY=1"
if defined DIRTY ( echo There are uncommitted changes. Ask the main developer to commit or revert them first. & goto fail )

set "UNPUSHED="
for /f "delims=" %%a in ('git log @{u}..HEAD --oneline') do set "UNPUSHED=1"
if defined UNPUSHED ( echo There are commits not pushed to GitHub yet. Ask the main developer to push first. & goto fail )

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"
echo       Version: %VER%

echo [2/5] Checking the version tag...
set "TAGGED="
for /f "delims=" %%t in ('git tag --points-at HEAD') do if "%%t"=="v%VER%" set "TAGGED=1"
if not defined TAGGED ( echo HEAD has no tag v%VER%. Ask the main developer to tag it. & goto fail )

echo [3/5] Checking GitHub for an existing release...
rem Check the GitHub login before building, so a long build is not wasted
gh auth status >nul 2>&1
if errorlevel 1 ( echo GitHub CLI ^(gh^) is not installed or not logged in. Run "gh auth login" first. & goto fail )
gh release view v%VER% --repo HolySheepp/Verso >nul 2>&1
if not errorlevel 1 ( echo v%VER% is already published. Nothing to do. & goto done )

echo [4/5] Checking for an up-to-date installer...
set "SKIP="
set "NSIS=%CARGO_TARGET_DIR%\release\bundle\nsis"
if exist "..\安裝包\Verso_%VER%_x64-setup.exe" if exist "%NSIS%\Verso_%VER%_x64-setup.exe" if exist "%NSIS%\Verso_%VER%_x64-setup.exe.sig" if exist "%CARGO_TARGET_DIR%\release\verso.exe" set "SKIP=-SkipBuild"
if defined SKIP ( echo       Installer for %VER% already built, skipping the build. ) else ( echo       No up-to-date installer, building now. This takes a few minutes. )

echo [5/5] Publishing...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 %SKIP%
if errorlevel 1 goto fail

:done
echo.
pause
exit /b 0

:fail
echo.
echo Publish stopped. See the message above.
pause
exit /b 1
