# 需要時才 npm install：package-lock.json 跟上次裝的時候一樣、node_modules 也在，就跳過（啟動、打包都用）。
# 上次裝的 lock 檔雜湊記在 node_modules\.verso-lock-hash；pull 了新版本、lock 檔變了才重裝
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$mark = Join-Path $root 'node_modules\.verso-lock-hash'
$hash = (Get-FileHash (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash
if ((Test-Path (Join-Path $root 'node_modules')) -and (Test-Path $mark) -and ((Get-Content $mark -Raw).Trim() -eq $hash)) { exit 0 }
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
[IO.File]::WriteAllText($mark, $hash)
