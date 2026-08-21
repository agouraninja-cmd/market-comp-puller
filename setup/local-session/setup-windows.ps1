<#
.SYNOPSIS
  Sets up a complete local CompNinja working folder on Windows.

.DESCRIPTION
  Clones the repo, restores the Claude Code files a fresh clone does NOT get
  (.gitignore excludes everything under .claude/ except skills/), creates the
  .env, and verifies the whole thing boots.

  Safe to re-run. It never overwrites an existing .env, an existing
  settings.json, or any file you have edited -- it says what it skipped.

.EXAMPLE
  .\setup-windows.ps1
  .\setup-windows.ps1 -GeminiKey AIza...                  # matches production
  .\setup-windows.ps1 -Path D:\work\compninja -ApiKey sk-ant-...   # Anthropic-only laptop
#>
param(
  [string]$Path   = "$env:USERPROFILE\dev\compninja",
  [string]$ApiKey = "",
  [string]$GeminiKey = "",
  [switch]$SkipTests,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/agouraninja-cmd/market-comp-puller.git"
$KitDir  = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say  ($m) { Write-Host "  $m" }
function Step ($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Ok   ($m) { Write-Host "  + $m" -ForegroundColor Green }
function Die  ($m) { Write-Host "`nX $m" -ForegroundColor Red; exit 1 }

Write-Host "`nCompNinja local setup" -ForegroundColor White
Write-Host "Target folder: $Path"

# ---------------------------------------------------------------- 1. git
Step "Checking git"
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Die "git is not installed. Get it from https://git-scm.com/download/win, then re-run this script."
}
Ok  ((git --version) -join "")

# ---------------------------------------------------------------- 2. node
Step "Checking Node (18+ required -- the server uses built-in fetch)"
$node = $null
$onPath = Get-Command node -ErrorAction SilentlyContinue
if ($onPath) {
  $node = $onPath.Source
} else {
  # The owner's machine runs a portable, no-admin Node that is not on PATH.
  $portable = Get-ChildItem "$env:LOCALAPPDATA\node-portable\*\node.exe" -ErrorAction SilentlyContinue |
              Sort-Object FullName -Descending | Select-Object -First 1
  if ($portable) { $node = $portable.FullName }
}
if (-not $node) {
  Die "Node is not installed. Get the LTS installer from https://nodejs.org, then re-run this script."
}
$ver = (& $node --version)
$major = [int]($ver -replace '^v(\d+)\..*$', '$1')
if ($major -lt 18) { Die "Node $ver is too old. CompNinja needs 18 or newer." }
Ok "$ver at $node"
if (-not $onPath) { Warn "Node is not on PATH, so 'npm start' will not work. Use the full path shown at the end." }

# ---------------------------------------------------------------- 3. clone
Step "Getting the code"
if (Test-Path (Join-Path $Path ".git")) {
  Say "Already a checkout -- fetching the latest main."
  Push-Location $Path
  try {
    git fetch origin main
    $dirty = git status --porcelain
    if ($dirty) {
      Warn "You have uncommitted changes here, so nothing was merged. Your files are untouched."
    } else {
      git merge --ff-only origin/main | Out-Null
      Ok "Up to date with main."
    }
  } finally { Pop-Location }
} elseif ((Test-Path $Path) -and (Get-ChildItem $Path -Force | Measure-Object).Count -gt 0) {
  Die "$Path already exists and is not empty. Pass -Path with a different folder."
} else {
  git clone $RepoUrl $Path
  Ok "Cloned into $Path"
}

# ------------------------------------------------- 4. the Claude local files
Step "Installing the Claude Code files a clone does not carry"
# .gitignore ignores .claude/* except skills/, so the hook and settings must be
# put in place here or the vendored tailwind.css silently goes stale on edit.
$claudeDir = Join-Path $Path ".claude"
$hooksDir  = Join-Path $claudeDir "hooks"
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

$hookSrc = Join-Path $KitDir "files\hooks\regen-tailwind.js"
$hookDst = Join-Path $hooksDir "regen-tailwind.js"
if ((Test-Path $hookDst) -and -not $Force) {
  Say "regen-tailwind.js already present -- left alone (pass -Force to replace)."
} else {
  Copy-Item $hookSrc $hookDst -Force
  Ok "Installed .claude\hooks\regen-tailwind.js"
}

$setSrc = Join-Path $KitDir "files\settings.json"
$setDst = Join-Path $claudeDir "settings.json"
if (Test-Path $setDst) {
  Copy-Item $setSrc "$setDst.new" -Force
  Warn "You already have .claude\settings.json -- yours was kept. Merge the hooks block from settings.json.new by hand."
} else {
  $json = Get-Content $setSrc -Raw
  if (-not $onPath) {
    # Portable Node is not on PATH, so bake in the absolute path. It is quoted
    # inside the JSON string because %LOCALAPPDATA% can contain a space, and an
    # unquoted path with one would split into a bogus command and a bogus arg.
    $escaped = $node.Replace('\', '\\')
    $json = $json.Replace('"node .claude', '"\"' + $escaped + '\" .claude')
  }
  [IO.File]::WriteAllText($setDst, $json, (New-Object Text.UTF8Encoding $false))
  Ok "Installed .claude\settings.json (tailwind regen hook)"
}
Say "Skills came with the clone: $(((Get-ChildItem (Join-Path $claudeDir 'skills') -Directory -ErrorAction SilentlyContinue).Name) -join ', ')"

# ---------------------------------------------------------------- 5. .env
Step "Setting up your API key"
# The default provider is Gemini, so an Anthropic-only .env boots a perfectly
# healthy-looking server whose every search errors. Handle that here, loudly.
$envFile = Join-Path $Path ".env"

function Set-EnvVar($key, $val) {
  $lines = [IO.File]::ReadAllLines($envFile)
  $hit = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^#?\s*$key=") { $lines[$i] = "$key=$val"; $hit = $true; break }
  }
  if (-not $hit) { $lines += @("", "$key=$val") }
  [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))
}

if (Test-Path $envFile) {
  Say ".env already exists -- left completely alone."
} else {
  Copy-Item (Join-Path $Path ".env.example") $envFile
  Ok "Created .env from .env.example."
  if ($ApiKey)    { Set-EnvVar "ANTHROPIC_API_KEY" $ApiKey; Ok "Anthropic key written." }
  if ($GeminiKey) { Set-EnvVar "GEMINI_API_KEY" $GeminiKey; Ok "Gemini key written -- provider stays gemini, matching production." }

  if (-not $GeminiKey -and $ApiKey) {
    Set-EnvVar "SEARCH_PROVIDER" "anthropic"
    Warn "No Gemini key given, so SEARCH_PROVIDER=anthropic was set. Production runs gemini;"
    Warn "add GEMINI_API_KEY to .env and comment that line out to match the live site."
  } elseif (-not $GeminiKey -and -not $ApiKey) {
    Warn "No key given. Open $envFile and do ONE of these before searching:"
    Warn "  a) set GEMINI_API_KEY  (matches production; needs a PAID Google project)"
    Warn "  b) set ANTHROPIC_API_KEY and uncomment SEARCH_PROVIDER=anthropic"
    Warn "Without one, the app boots and looks fine but every search returns an error."
  }
}

# ---------------------------------------------------------------- 6. verify
Step "Verifying"
Push-Location $Path
try {
  & $node --check server.js
  if ($LASTEXITCODE -ne 0) { Die "server.js failed the syntax check -- something is wrong with the clone." }
  Ok "server.js parses."
  if ($SkipTests) {
    Say "Tests skipped (-SkipTests)."
  } else {
    Say "Running the test suite (about a minute)..."
    & $node --test "test/*.test.js" 2>&1 | Select-Object -Last 12
    if ($LASTEXITCODE -eq 0) { Ok "Tests pass." } else { Warn "Some tests failed -- see the lines above. The app still runs." }
  }
} finally { Pop-Location }

# ---------------------------------------------------------------- done
$startCmd = if ($onPath) { "npm start" } else { "& `"$node`" server.js" }
Write-Host "`nDone." -ForegroundColor Green
Write-Host @"

  Your folder:   $Path

  Start the app:
      cd "$Path"
      $startCmd
      then open http://localhost:3000

  Start a Claude session on it:
      cd "$Path"
      claude

  Read first: ONBOARDING.md (setup + the rules), CLAUDE.md (how it all works).

"@
