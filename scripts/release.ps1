# 發布新版本：打包有簽章的安裝檔，上傳到 GitHub Releases，裝好的 Verso 才會收到自動更新。
# 只在使用者說「發布」時執行。私鑰在專案外的「翻譯界面\簽章金鑰\verso.key」，不放進 GitHub。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\release.ps1 [-Notes "這版的說明"] [-SkipBuild]
# -SkipBuild：已經打包好、只要上傳時用
param([string]$Notes = '', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
$outer = Split-Path $root -Parent
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$key = Join-Path $outer '簽章金鑰\verso.key'
if (-not (Test-Path $key)) { throw "找不到簽章私鑰：$key" }

# 1. 打包（產物放在專案外的「建置暫存」），同時產生更新用的簽章檔
$env:CARGO_TARGET_DIR = Join-Path $outer '建置暫存'
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
$extra = Join-Path $env:CARGO_TARGET_DIR 'release-config.json'
New-Item -ItemType Directory -Force $env:CARGO_TARGET_DIR | Out-Null
if (-not $SkipBuild) {
  [IO.File]::WriteAllText($extra, '{"bundle":{"createUpdaterArtifacts":true}}')
  npx tauri build --config $extra
  if ($LASTEXITCODE -ne 0) { throw '打包失敗' }
}
$nsis = Join-Path $env:CARGO_TARGET_DIR 'release\bundle\nsis'
$setup = Get-ChildItem $nsis -Filter "Verso_${version}_x64-setup.exe" | Select-Object -First 1
if (-not $setup) { throw "找不到 $version 的安裝檔，請先打包" }
$sig = Get-Item "$($setup.FullName).sig"

# 安裝檔也放一份到「翻譯界面\安裝包」（先刪掉舊的安裝檔，只留最新的）
$dist = Join-Path $outer '安裝包'
New-Item -ItemType Directory -Force $dist | Out-Null
Get-ChildItem $dist -Filter '*-setup.exe' | Remove-Item -Force
Copy-Item $setup.FullName $dist -Force
Copy-Item (Join-Path $env:CARGO_TARGET_DIR 'release\verso.exe') (Join-Path $dist 'Verso_portable.exe') -Force

# 2. 更新清單 latest.json：裝好的 Verso 會讀這個檔案判斷有沒有新版本
$asset = $setup.Name
$latest = [ordered]@{
  version   = $version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  platforms = @{ 'windows-x86_64' = @{ signature = (Get-Content $sig.FullName -Raw).Trim(); url = "https://github.com/HolySheepp/Verso/releases/download/$tag/$asset" } }
}
$latestPath = Join-Path $nsis 'latest.json'
[IO.File]::WriteAllText($latestPath, ($latest | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

# 3. 用 GitHub CLI（gh，這台電腦已登入）建立 Release、上傳檔案
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = 'C:\Program Files\GitHub CLI\gh.exe' }
if (-not (Test-Path $gh)) { throw '找不到 GitHub CLI（gh），請先安裝並登入' }
$notesFile = Join-Path $env:CARGO_TARGET_DIR 'release-notes.txt'
[IO.File]::WriteAllText($notesFile, $Notes, (New-Object Text.UTF8Encoding $false))
& $gh release create $tag $setup.FullName $sig.FullName $latestPath --repo HolySheepp/Verso --title "Verso $version" --notes-file $notesFile
if ($LASTEXITCODE -ne 0) { throw '上傳到 GitHub 失敗' }
Write-Host "發布完成：https://github.com/HolySheepp/Verso/releases/tag/$tag"
