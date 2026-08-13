# AGENTS.md

The authoritative guide to this codebase is `CLAUDE.md` in the repo root —
read it for architecture, routes, env vars, and the many non-obvious flows.
This file only adds cloud-agent environment notes.

## Cursor Cloud specific instructions

**Stack:** plain Node HTTP server, **zero npm dependencies**, no build step, no
linter. Node 18+ is required (uses built-in `fetch`); the VM has Node 22. There
is nothing to `npm install` — `node_modules` never exists and there is no
lockfile.

**Boot / run:**
- `npm start` runs `prestart` first (`node --check server.js && npm test`,
  ~3s) and then `node server.js` on port 3000. This is the production/deploy
  gate — do not remove it. For a faster dev boot that skips the prestart tests,
  run `node server.js` directly. Set `PORT` to change the port.
- The server boots with **no environment variables at all** — every optional
  integration degrades gracefully. `GET /healthz` returns
  `{"ok":true,"hasKey":false,...}` on a bare environment.

**"Lint" / test / build:**
- There is no separate linter or build. The checks that gate the repo (see
  `.github/workflows/ci.yml`) are: `node --check` on the entry points
  (`server.js entitlements.js comp-gate.js stripe.js gen-market-seed.js
  market-snapshot.js`), then `npm test` (Node's built-in test runner,
  `node --test`, ~886 tests in ~3s, no external services), then a bare-env
  boot smoke against `/healthz` and `/`.
- `tailwind.css` is a **vendored, checked-in** build — no build step is needed
  to run or style the app. (Only regenerate it if you add brand-new Tailwind
  utility classes to `index.html`; see CLAUDE.md's "Restart rule".)

**What works without secrets (good enough for most dev/testing):** the landing
page, account signup/login/logout, portfolio, watchlist, lead capture, address
geocoding (free US Census proxy), the market SEO pages, and the full test suite.
When Supabase is unconfigured these persist to git-ignored local JSON files
(`account-store.json`, `search-cache.json`, `comp-corpus.jsonl`, etc.).

**What needs a secret:** the core comp-search / report generation
(`POST /api/comps`, the Market Explorer) calls an LLM with web search. The
default provider is **Gemini** (`SEARCH_PROVIDER=gemini`), so it needs
`GEMINI_API_KEY`; without it a search returns
`{"error":"Server is missing the GEMINI_API_KEY environment variable."}` while
the rest of the app stays fully usable. Set `SEARCH_PROVIDER=anthropic` +
`ANTHROPIC_API_KEY` to use Anthropic instead. Note **every search is billed** to
the owner's account.

**Two features deliberately refuse (503) instead of using a file fallback**
without Supabase: the broker vault and invited (permissioned) shares — losing a
broker's book or leaking a restricted share is worse than a DB blip, so they
fail closed by design (see CLAUDE.md).

**Restart rule (quick reference):** editing `index.html` or `devlog.json` needs
no restart (read from disk per request); editing `server.js` requires killing
and relaunching the process. Full detail in CLAUDE.md.
