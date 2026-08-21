#!/usr/bin/env bash
# Sets up a complete local CompNinja working folder on macOS or Linux.
#
# Clones the repo, restores the Claude Code files a fresh clone does NOT get
# (.gitignore excludes everything under .claude/ except skills/), creates the
# .env, and verifies the whole thing boots.
#
# Safe to re-run. It never overwrites an existing .env, an existing
# settings.json, or any file you have edited -- it says what it skipped.
#
#   ./setup-mac.sh
#   ./setup-mac.sh --path ~/work/compninja --gemini-key AIza...     # matches production
#   ./setup-mac.sh --api-key sk-ant-...                             # Anthropic-only laptop
set -euo pipefail

REPO_URL="https://github.com/agouraninja-cmd/market-comp-puller.git"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HOME/dev/compninja"
API_KEY=""
GEMINI_KEY=""
SKIP_TESTS=0
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --path)     TARGET="$2"; shift 2 ;;
    --api-key)  API_KEY="$2"; shift 2 ;;
    --gemini-key) GEMINI_KEY="$2"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --force)    FORCE=1; shift ;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

step() { printf '\n== %s\n' "$1"; }
say()  { printf '  %s\n' "$1"; }
ok()   { printf '  + %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }
die()  { printf '\nX %s\n' "$1" >&2; exit 1; }

printf '\nCompNinja local setup\nTarget folder: %s\n' "$TARGET"

# ------------------------------------------------------------------ 1. git
step "Checking git"
command -v git >/dev/null 2>&1 || die "git is not installed. On macOS run: xcode-select --install"
ok "$(git --version)"

# ------------------------------------------------------------------ 2. node
step "Checking Node (18+ required -- the server uses built-in fetch)"
command -v node >/dev/null 2>&1 || die "Node is not installed. Get the LTS build from https://nodejs.org"
NODE_VER="$(node --version)"
NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $NODE_VER is too old. CompNinja needs 18 or newer."
ok "$NODE_VER at $(command -v node)"

# ----------------------------------------------------------------- 3. clone
step "Getting the code"
if [ -d "$TARGET/.git" ]; then
  say "Already a checkout -- fetching the latest main."
  git -C "$TARGET" fetch origin main
  if [ -n "$(git -C "$TARGET" status --porcelain)" ]; then
    warn "You have uncommitted changes here, so nothing was merged. Your files are untouched."
  else
    git -C "$TARGET" merge --ff-only origin/main >/dev/null
    ok "Up to date with main."
  fi
elif [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  die "$TARGET already exists and is not empty. Pass --path with a different folder."
else
  git clone "$REPO_URL" "$TARGET"
  ok "Cloned into $TARGET"
fi

# --------------------------------------------- 4. the Claude local files
step "Installing the Claude Code files a clone does not carry"
# .gitignore ignores .claude/* except skills/, so the hook and settings must be
# put in place here or the vendored tailwind.css silently goes stale on edit.
mkdir -p "$TARGET/.claude/hooks"

if [ -f "$TARGET/.claude/hooks/regen-tailwind.js" ] && [ "$FORCE" -eq 0 ]; then
  say "regen-tailwind.js already present -- left alone (pass --force to replace)."
else
  cp "$KIT_DIR/files/hooks/regen-tailwind.js" "$TARGET/.claude/hooks/regen-tailwind.js"
  ok "Installed .claude/hooks/regen-tailwind.js"
fi

if [ -f "$TARGET/.claude/settings.json" ]; then
  cp "$KIT_DIR/files/settings.json" "$TARGET/.claude/settings.json.new"
  warn "You already have .claude/settings.json -- yours was kept. Merge the hooks block from settings.json.new by hand."
else
  cp "$KIT_DIR/files/settings.json" "$TARGET/.claude/settings.json"
  ok "Installed .claude/settings.json (tailwind regen hook)"
fi
say "Skills came with the clone: $(ls "$TARGET/.claude/skills" 2>/dev/null | tr '\n' ' ')"

# ------------------------------------------------------------------ 5. .env
step "Setting up your API key"
# The default provider is Gemini, so an Anthropic-only .env boots a perfectly
# healthy-looking server whose every search errors. Handle that here, loudly.
set_env() {  # set_env KEY VALUE -- replaces a commented or placeholder line
  local key="$1" val="$2" f="$TARGET/.env" tmp
  tmp="$(mktemp)"
  if grep -q "^#\? *${key}=" "$f"; then
    sed "s|^#\? *${key}=.*|${key}=${val}|" "$f" > "$tmp" && mv "$tmp" "$f"
  else
    rm -f "$tmp"; printf '\n%s=%s\n' "$key" "$val" >> "$f"
  fi
}

if [ -f "$TARGET/.env" ]; then
  say ".env already exists -- left completely alone."
else
  cp "$TARGET/.env.example" "$TARGET/.env"
  ok "Created .env from .env.example."
  if [ -n "$API_KEY" ]; then set_env ANTHROPIC_API_KEY "$API_KEY"; ok "Anthropic key written."; fi
  if [ -n "$GEMINI_KEY" ]; then set_env GEMINI_API_KEY "$GEMINI_KEY"; ok "Gemini key written -- provider stays gemini, matching production."; fi

  if [ -z "$GEMINI_KEY" ] && [ -n "$API_KEY" ]; then
    set_env SEARCH_PROVIDER anthropic
    warn "No Gemini key given, so SEARCH_PROVIDER=anthropic was set. Production runs gemini;"
    warn "add GEMINI_API_KEY to .env and comment that line out to match the live site."
  elif [ -z "$GEMINI_KEY" ] && [ -z "$API_KEY" ]; then
    warn "No key given. Open $TARGET/.env and do ONE of these before searching:"
    warn "  a) set GEMINI_API_KEY  (matches production; needs a PAID Google project)"
    warn "  b) set ANTHROPIC_API_KEY and uncomment SEARCH_PROVIDER=anthropic"
    warn "Without one, the app boots and looks fine but every search returns an error."
  fi
fi

# ----------------------------------------------------------------- 6. verify
step "Verifying"
( cd "$TARGET" && node --check server.js ) || die "server.js failed the syntax check -- something is wrong with the clone."
ok "server.js parses."
if [ "$SKIP_TESTS" -eq 1 ]; then
  say "Tests skipped (--skip-tests)."
else
  say "Running the test suite (about a minute)..."
  if ( cd "$TARGET" && node --test "test/*.test.js" >/tmp/cn-test.$$ 2>&1 ); then
    ok "Tests pass."
  else
    warn "Some tests failed -- last lines below. The app still runs."
    tail -12 "/tmp/cn-test.$$"
  fi
  rm -f "/tmp/cn-test.$$"
fi

cat <<EOF

Done.

  Your folder:   $TARGET

  Start the app:
      cd "$TARGET"
      npm start
      then open http://localhost:3000

  Start a Claude session on it:
      cd "$TARGET"
      claude

  Read first: ONBOARDING.md (setup + the rules), CLAUDE.md (how it all works).

EOF
