# Fills the blank values in .env.local without hand-editing the file.
# Run it by double-clicking tools\set-keys.cmd
$ErrorActionPreference = "Stop"
$envPath = Join-Path $PSScriptRoot "..\.env.local"
$envPath = [System.IO.Path]::GetFullPath($envPath)

if (-not (Test-Path $envPath)) {
  Write-Host "Could not find $envPath" -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$prompts = @(
  @{ Key = "SUPABASE_DB_PASSWORD"; Label = "Supabase DATABASE password"; Help  = "From when you created the project. Lost it? Supabase > Project Settings > Database > Reset database password." },
  @{ Key = "DATAFORSEO_LOGIN";     Label = "DataForSEO API login";       Help  = "Shown on the DataForSEO API Access page - usually your email." },
  @{ Key = "DATAFORSEO_PASSWORD";  Label = "DataForSEO API password";    Help  = "Shown on the same API Access page. NOT your dashboard password." }
)

$lines = [System.IO.File]::ReadAllLines($envPath)
$changed = 0

Write-Host ""
Write-Host "PRN key setup" -ForegroundColor Cyan
Write-Host "Paste each value and press Enter. Press Enter on its own to skip one."
Write-Host "Right-click inside this window to paste."
Write-Host ""

foreach ($p in $prompts) {
  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match ("^" + [regex]::Escape($p.Key) + "=")) { $idx = $i; break }
  }
  $current = ""
  if ($idx -ge 0) { $current = $lines[$idx].Substring($p.Key.Length + 1) }

  if ($current.Trim().Length -gt 0) {
    Write-Host ("{0}: already set - leaving it alone." -f $p.Label) -ForegroundColor DarkGray
    continue
  }

  Write-Host ("{0}" -f $p.Label) -ForegroundColor Yellow
  Write-Host ("  {0}" -f $p.Help) -ForegroundColor DarkGray
  $value = Read-Host "  paste here"
  $value = $value.Trim()
  if ($value.Length -eq 0) {
    Write-Host "  skipped" -ForegroundColor DarkGray
    Write-Host ""
    continue
  }
  $newLine = "{0}={1}" -f $p.Key, $value
  if ($idx -ge 0) { $lines[$idx] = $newLine } else { $lines += $newLine }
  $changed++
  Write-Host ("  saved ({0} characters)" -f $value.Length) -ForegroundColor Green
  Write-Host ""
}

if ($changed -gt 0) {
  [System.IO.File]::WriteAllLines($envPath, $lines)
  Write-Host ("Updated {0} value(s) in .env.local" -f $changed) -ForegroundColor Green
} else {
  Write-Host "Nothing changed." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "You can close this window and tell Claude: done" -ForegroundColor Cyan
Read-Host "Press Enter to close"
