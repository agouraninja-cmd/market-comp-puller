# Creates the "CompNinja" desktop-app shortcut on Windows.
#
# The shortcut runs desktop.js (the zero-dependency launcher — see the header
# comment in that file) with the repo's favicon as its icon and the console
# window minimized. By default it launches the LOCAL app: boots server.js on
# a free port and opens the chromeless app window; local mode needs the
# repo's .env (ANTHROPIC_API_KEY) exactly like `npm start` does.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1
#
# Point the shortcut at the hosted site instead (no local server, no key):
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1 -Url https://compninja.co
#
# Add -StartMenu to also place it in the Start Menu. Node is found on PATH
# first (the owner's machine has a system install there), then, as a fallback
# for a machine without one, at the old portable no-admin location
# ($env:LOCALAPPDATA\node-portable\<version>\node.exe).

param(
  [string]$Url = "",
  [switch]$StartMenu
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot

# --- Find node: PATH first, then the portable install (newest version wins).
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not $node) {
  $portable = Get-ChildItem -Path "$env:LOCALAPPDATA\node-portable" -Filter node.exe -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($portable) { $node = $portable.FullName }
}
if (-not $node) {
  Write-Error "Could not find node.exe — install Node 18+, or put the portable copy under $env:LOCALAPPDATA\node-portable\"
}

# --- Validate -Url the same way desktop.js will (http/https only), so the
# shortcut can't be created in a state the launcher refuses at double-click.
if ($Url -and $Url -notmatch '^https?://') {
  Write-Error "-Url must start with http:// or https:// (got: $Url)"
}

$arguments = "`"$repo\desktop.js`""
if ($Url) { $arguments += " --url `"$Url`"" }

$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath("Desktop"))
if ($StartMenu) { $targets += (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs") }

foreach ($dir in $targets) {
  $lnkPath = Join-Path $dir "CompNinja.lnk"
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath = $node
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $repo
  $lnk.IconLocation = "$repo\favicon.ico,0"
  $lnk.WindowStyle = 7   # minimized — the console carries the server log, not the app
  $lnk.Description = if ($Url) { "CompNinja ($Url)" } else { "CompNinja (local)" }
  $lnk.Save()
  Write-Host "Created $lnkPath"
}

Write-Host "Done. Double-click CompNinja to open the app window; closing the window stops the local server."
