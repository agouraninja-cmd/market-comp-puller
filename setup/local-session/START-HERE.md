# CompNinja — local session setup

This kit builds a complete CompNinja folder on your machine: the GitHub code,
the Claude Code files, and a working `.env`. One command, about three minutes.

## Run it

**Windows (PowerShell)**

```powershell
cd <the folder holding this file>
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
```

**Mac / Linux**

```bash
cd <the folder holding this file>
./setup-mac.sh
```

By default it builds the folder at `%USERPROFILE%\dev\compninja` (Windows) or
`~/dev/compninja` (Mac). Pass `-Path` / `--path` for somewhere else.

You can hand it your key in the same command:

```powershell
.\setup-windows.ps1 -GeminiKey AIza...        # matches production
.\setup-windows.ps1 -ApiKey sk-ant-...        # Anthropic-only machine
```

```bash
./setup-mac.sh --gemini-key AIza...
./setup-mac.sh --api-key sk-ant-...
```

## Which key do I need?

This is the one thing that silently bites people, so it is worth 30 seconds.

**Production runs Gemini, not Anthropic** (`SEARCH_PROVIDER` defaults to
`gemini`). The server boots fine with no key at all — the page loads, the
market pages render, `/healthz` says `ok: true` — and then *every search
returns an error*. Nothing about the startup output looks wrong.

| What you have | What the script does | Matches production? |
|---|---|---|
| A Gemini key (`--gemini-key`) | writes `GEMINI_API_KEY` | yes |
| Only an Anthropic key (`--api-key`) | writes the key **and** `SEARCH_PROVIDER=anthropic` | no, but works |
| Neither | leaves `.env` with placeholders and tells you | app boots, searches fail |

Gemini also needs a **paid-tier** Google project — search grounding returns 429
on the free tier and the error does not say so.

Everything else (Supabase, Stripe, Resend, Google Maps) is optional. The app
detects they are missing and falls back to local JSON files.

## What you get

```
compninja/
├── CLAUDE.md              how the whole system works — Claude reads this automatically
├── ONBOARDING.md          the fuller guide: git, branches, the safety rules
├── AGENTS.md, HANDOFF.md  further project context
├── .claude/
│   ├── skills/            add-comp-field, deploy, housekeeping,
│   │                      session-recap, shared-checkout  (came with the clone)
│   ├── hooks/
│   │   └── regen-tailwind.js   ← installed by this kit, see below
│   └── settings.json           ← installed by this kit, registers the hook
├── .env                   your keys — never commit this
├── server.js, index.html, valuation.js, ...   the app
├── test/                  npm test
├── docs/                  specs, plans, roadmap, eval history
└── migrations/            the SQL, in order
```

### Why the kit has to install two of those files

`.gitignore` ignores everything under `.claude/` **except** `skills/`. That is
deliberate — `settings.json` is personal config — but it means a fresh
`git clone` does **not** contain `.claude/hooks/regen-tailwind.js`, even though
`CLAUDE.md` describes it as part of the project.

That hook matters. `tailwind.css` is a pre-generated file committed to the repo;
a **new** Tailwind utility class added to `index.html` has no CSS until the file
is rebuilt, so the page just quietly renders unstyled in that one spot. The hook
rebuilds it whenever `index.html` is edited in a Claude session, and prints the
byte delta so you can see the change actually landed.

Both files are installed from `files/` in this kit. Re-running the script never
overwrites edits you have made to either one.

## Start working

```bash
cd ~/dev/compninja      # or your -Path
npm start               # http://localhost:3000
claude                  # a Claude session, with CLAUDE.md and the skills loaded
```

Windows with portable Node (not on PATH):

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js
```

Useful once you are in:

- `npm test` — the full suite, about a minute, no database or network needed.
- `node desktop.js` — the app in a chromeless window on a free port.
- `/housekeeping`, `/deploy`, `/add-comp-field` — the project's own skills.

## Two rules worth knowing before you edit anything

1. **Editing `server.js` needs a restart**; editing `index.html` does not
   (the server reads it from disk per request — just refresh).
2. **One folder per session.** A checkout has one branch and one staging area,
   so two agents in one folder are two people at one desk. For a second stream
   of work: `node scripts/worktree.js my-feature`. `CLAUDE.md` explains why.

## Re-running this kit

Safe any time. On an existing checkout it fetches the latest `main` (and skips
the merge if you have uncommitted work), leaves `.env` alone, and leaves any
`.claude` file you have edited alone.
