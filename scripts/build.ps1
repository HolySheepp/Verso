# 打包有簽章的安裝檔和攜帶版：「打包成安裝包與攜帶版.bat」和發布（release.ps1）都用這個，
# 設定、環境變數完全一樣，所以先打包再發布時不用重打包，第二次打包也不會整批重編。
# 私鑰在專案外的「翻譯界面\簽章金鑰\verso.key」，不放進 GitHub。產物在專案外的「建置暫存」，安裝檔和攜帶版複製到「安裝包」。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
$outer = Split-Path $root -Parent
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$key = Join-Path $outer '簽章金鑰\verso.key'
if (-not (Test-Path $key)) { throw "找不到簽章私鑰：$key" }

$env:CARGO_TARGET_DIR = Join-Path $outer '建置暫存'
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
New-Item -ItemType Directory -Force $env:CARGO_TARGET_DIR | Out-Null

# 兩邊同時打包時，網頁的輸出會互相蓋掉：有人在打包就先等（超過 1 小時的鎖當成上次中斷留下的）
$lock = Join-Path $env:CARGO_TARGET_DIR 'build.lock'
while ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 60) {
  Write-Host '另一個打包正在進行，等它完成…'
  Start-Sleep -Seconds 10
}
[IO.File]::WriteAllText($lock, "$PID")
try {
  $extra = Join-Path $env:CARGO_TARGET_DIR 'release-config.json'
  [IO.File]::WriteAllText($extra, '{"bundle":{"createUpdaterArtifacts":true}}')
  $nsis = Join-Path $env:CARGO_TARGET_DIR 'release\bundle\nsis'
  # 舊的安裝檔先刪掉，只留這次打包的
  if (Test-Path $nsis) { Get-ChildItem $nsis -Filter '*-setup.exe*' | Remove-Item -Force }
  # 私鑰沒有密碼：送一個空白行給它，打包時就不會停在 password: 等人按 Enter
  '' | npx tauri build --config $extra
  if ($LASTEXITCODE -ne 0) { throw '打包失敗' }
} finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}

$setup = Get-ChildItem $nsis -Filter "Verso_${version}_x64-setup.exe" | Select-Object -First 1
if (-not $setup) { throw "找不到 $version 的安裝檔" }
# 安裝檔、攜帶版放一份到「翻譯界面\安裝包」（舊的安裝檔先刪掉，只留最新的）
$dist = Join-Path $outer '安裝包'
New-Item -ItemType Directory -Force $dist | Out-Null
Get-ChildItem $dist -Filter '*-setup.exe' | Remove-Item -Force
Copy-Item $setup.FullName $dist -Force
Copy-Item (Join-Path $env:CARGO_TARGET_DIR 'release\verso.exe') (Join-Path $dist 'Verso_portable.exe') -Force
Write-Host "打包完成：$version 的安裝檔和攜帶版在 $dist"
