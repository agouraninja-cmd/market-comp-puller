# Dev Seats — how CompNinja is developed from any machine

> Written 2026-08-17, after the Windows work computer holding the original
> local checkout (and its `.env`) was reclaimed. The lesson it encodes: **no
> computer may ever be the place CompNinja lives.** The company lives in
> GitHub (code), Render (production + its secrets), Supabase (data), Stripe
> (billing), and Google Cloud (the two Google keys). A dev machine is a
> disposable terminal onto those, and the only thing it holds that matters
> is a key — so every seat gets its OWN key, and losing a machine costs one
> revocation and zero work.

## Where every secret lives

| Secret | Lives | Never lives |
|---|---|---|
| Production provider key (Gemini/Anthropic) | Render env vars | any laptop |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Render | any laptop, any eval worktree |
| Stripe `sk_live_` | Render | anywhere else, full stop |
| `ADMIN_KEY`, `APP_PASSWORD`, passkeys | Render | committed files |
| A **dev** provider key (one per seat) | that seat's `.env` / env config | git, chat transcripts |
| Stripe restricted `rk_live_` (ledger only) | the one laptop that runs the ledger | Render, cloud sessions |

`.gitignore` blocks `.env`, `.env.*`, and `*.env` — including backup files
like `.env.bak-<timestamp>` — precisely so `git add -A` can never publish a
key. Do not route around it.

## Seat 1 — your own computer (primary)

Install Claude Code (or the desktop app) on the machine you own, with a
local clone. This is the no-copy-paste experience, locally: you talk, it
edits, tests, and runs — and the checkout persists between sessions.

One-time setup (~30 min): ONBOARDING.md sections 2–5 walk through it —
Node LTS + git from their normal installers (the portable-node workaround
in HANDOFF.md existed only because the old work machine had no admin
rights), clone, `cp .env.example .env`, paste a **new dev key** created for
this machine. The default search provider is **Gemini**, so the key you
need is `GEMINI_API_KEY` from a paid-tier Google project (search grounding
429s on the free tier).

What only this seat does: the ledger (`node ledger/ledger.js`, with its
restricted Stripe read key), and anything driven through a browser you're
signed into — the Render dashboard, the Supabase SQL editor, the Stripe
dashboard. Those are websites, not machine state; any browser works.

## Seat 2 — cloud sessions (claude.ai/code)

Cloud sessions clone fresh and run the whole offline suite with nothing
configured — the repo has zero npm dependencies, so a session is ready the
moment it opens. What a bare session CANNOT do is spend money: no provider
key, so no billed searches, no eval runs.

To give cloud sessions that power, put a key in the **environment config**
(claude.ai/code → this repo's environment → environment variables), never
in the chat — a key pasted into a message lives in the transcript forever:

- `GEMINI_API_KEY` = a dedicated dev key, created for this purpose,
  revocable without touching production.

That is the whole configuration. The provider endpoints are reachable from
the session containers (verified 2026-08-17 — they answer with auth errors,
not proxy blocks), so with that one variable a cloud session can boot the
server, run real searches, and run `scripts/eval-size-band.js` end to end.

Do NOT put `SUPABASE_*` there: a cloud session that can write production's
database is the eval-isolation failure mode with extra steps.

## When a machine goes away

Assume the machine's disk and its signed-in browser both belong to someone
else now. "It was probably wiped" is not a security control. In order:

1. **Rotate the keys its `.env` held.** At minimum the provider key
   (Anthropic console / Google Cloud console: create new, update Render if
   production shared it, delete old). If the ledger ever ran there: roll the
   restricted Stripe `rk_live_` key and the `ANTHROPIC_ADMIN_KEY`.
2. **Rotate `ADMIN_KEY` in Render** if that machine ever held it or had an
   `/admin` session. Rotation invalidates every `cn_admin` cookie ever
   issued, which is exactly what you want; cost is re-entering the key once.
3. **Sign out the accounts its browser was logged into** — GitHub, Render,
   Supabase, Stripe, Google, Anthropic all have a "sign out other sessions"
   or equivalent; use it, and change any password the browser had saved.
4. **Passkeys** (`TESTER_PASSKEY` / `VAULT_PASSKEY`): rotate the strings in
   Render if they were in that `.env`. Grants already redeemed survive
   rotation by design (they live on the user row), so nobody loses access.
5. **PII fallbacks**: if the app ever ran there without Supabase, the folder
   may hold `leads.jsonl` / `account-store.json`. Nothing to rotate — just
   know it, and let it be a reason production PII stays in Supabase.

What you did NOT lose: code, history, skills, docs, migrations — all in
git. Production config — in Render. Data — in Supabase. A machine loss
costs the keys above and about half an hour.
