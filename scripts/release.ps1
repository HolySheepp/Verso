# 發布新版本：打包有簽章的安裝檔，上傳到 GitHub Releases，裝好的 Verso 才會收到自動更新。
# 只在使用者說「發布」時執行。私鑰在專案外的「翻譯界面\簽章金鑰\verso.key」，不放進 GitHub。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\release.ps1 [-Notes "這版的說明"]
param([string]$Notes = '')
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
[IO.File]::WriteAllText($extra, '{"bundle":{"createUpdaterArtifacts":true}}')
npx tauri build --config $extra
if ($LASTEXITCODE -ne 0) { throw '打包失敗' }
$nsis = Join-Path $env:CARGO_TARGET_DIR 'release\bundle\nsis'
$setup = Get-ChildItem $nsis -Filter "Verso_${version}_x64-setup.exe" | Select-Object -First 1
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

# 3. 用這台電腦登入 GitHub 的帳號建立 Release、上傳檔案
$cred = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { throw '找不到 GitHub 登入資訊' }
$headers = @{ Authorization = "token $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'verso-release' }
$api = 'https://api.github.com/repos/HolySheepp/Verso'
$body = @{ tag_name = $tag; name = "Verso $version"; body = $Notes } | ConvertTo-Json
$rel = Invoke-RestMethod -Method Post -Uri "$api/releases" -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8'
foreach ($f in @($setup.FullName, $sig.FullName, $latestPath)) {
  $name = [IO.Path]::GetFileName($f)
  $uri = "https://uploads.github.com/repos/HolySheepp/Verso/releases/$($rel.id)/assets?name=$([Uri]::EscapeDataString($name))"
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -InFile $f -ContentType 'application/octet-stream' | Out-Null
  Write-Host "已上傳 $name"
}
Write-Host "發布完成：$($rel.html_url)"
