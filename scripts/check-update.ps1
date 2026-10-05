# 開發版啟動前：檢查 GitHub 有沒有新版本，有就問要不要更新
# 最多試 3 次、每次 3 秒；沒網路或連不上就直接啟動；本機有還沒推上去的修改時不更新
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { exit 0 }

function Invoke-Fetch {
  $p = Start-Process git -ArgumentList 'fetch', '--quiet', 'origin', 'main' -NoNewWindow -PassThru
  $null = $p.Handle  # 先拿 handle，之後才讀得到結束代碼
  if (-not $p.WaitForExit(3000)) { try { $p.Kill() } catch {} ; return $false }
  return ($p.ExitCode -eq 0)
}

$ok = $false
for ($i = 1; $i -le 3 -and -not $ok; $i++) { $ok = Invoke-Fetch }
if (-not $ok) { Write-Host '連不上 GitHub，略過檢查更新。'; exit 0 }

$behind = [int](git rev-list --count HEAD..origin/main)
if ($behind -le 0) { exit 0 }

$dirty = git status --porcelain --untracked-files=no
$ahead = [int](git rev-list --count origin/main..HEAD)
if ($dirty -or $ahead -gt 0) { Write-Host '本機有還沒推上去的修改，這次不更新。'; exit 0 }

$ver = ''
try { $ver = ((git show origin/main:package.json) -join "`n" | ConvertFrom-Json).version } catch {}
$cur = ''
try { $cur = (Get-Content package.json -Raw | ConvertFrom-Json).version } catch {}
$ans = Read-Host "檢測到新版本 $ver（目前 $cur），要更新嗎？(Y/N)"
if ($ans -match '^[Yy]') {
  git pull --ff-only --quiet origin main
  if ($LASTEXITCODE -eq 0) { Write-Host '已更新。' } else { Write-Host '更新失敗，用目前的版本啟動。' }
}
exit 0
