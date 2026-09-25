---
paths:
  - "devlog.json"
  - "dev-returns.js"
  - "test/dev-returns.test.js"
---
# Admin, analytics and the dev hub

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Architecture

- `GET /admin`, `GET /api/stats` — a small analytics dashboard. Every search,
  lead, share, and comp submission is logged as a **PII-free** event (`ts`,
  `kind`, `prop_type`, `market` = city+state only, `source`, `cached`) via
  `logEvent()` → the Supabase `analytics_events` table (`analytics.jsonl` file
  fallback). `/admin` is a self-contained page (own inline CSS/JS) that fetches
  `/api/stats` with the key as an `x-admin-key` header; `/api/stats` is
  `ADMIN_KEY`-gated and returns aggregates (searches/day billed-vs-cached, cache
  hit rate, by-type, top markets, leads by source, conversion %, and
  `corpus.health` — see the corpus-health note under **Comp corpus**, which
  renders as a red banner above the tiles). It also carries `introRequests`,
  a read of the broker inbox's `lead_intro_requests` table (count + recent
  rows with broker email and the lead's market/type — owner-facing, so that
  PII is allowed here even though analytics EVENTS stay PII-free), rendered
  as a "Broker intro requests" card on `/admin`; without it a dropped owner
  email made a request invisible. Supabase-only like the route that writes
  it (`db: false` when unconfigured), and fails safe: a read error yields
  `null`/"Unavailable", never a broken dashboard or a fabricated zero.
  **Logging is always on**; the
  dashboard only renders once `ADMIN_KEY` is set (same key as the lead CSV).
  `/admin` is `noindex` + `Disallow`ed in robots (meta tag, `X-Robots-Tag`
  header, and robots.txt).
  Reading the **corpus hit rate** tile: the denominator is *every* billed
  non-Explorer search ever, including the weeks before corpus-first retrieval
  existed, so the lifetime figure reads far lower than current behavior — judge
  the ratio going forward, not the headline. A hit requires ≥4 recent priced
  comps in that exact market **and** property type, so it only fires on repeat
  searches in the same market. Non-USD searches can never become corpus-covered
  (harvest skips them), so heavy international use slightly deflates the tile.
  `analytics_events` is queryable directly in
  Supabase when the dashboard is unavailable: `source = 'corpus'` marks a hit.
  **Whose visit an event was** (2026-08-13; migration
  `026-analytics-visitor.sql`, **run before deploying — see below**). Events
  recorded what happened and nothing about whose visit it was, so the table
  could count signups and count reports and never say whether the same
  browser did both. `visitor_id` (an opaque random id in the httpOnly
  `cn_vid` cookie) and `user_id` (once a session resolves) make that a query,
  and `/admin`'s **Visitor funnel** card reads it: arrived, hit the sign-in
  wall, created an account, ran a report. The events stay PII-free — the id
  is a random number handed to a browser, not derived from IP, user agent or
  anything else about the person, and the privacy policy's cookie section
  names `cn_vid` alongside `cn_guest`; keep it in step. Five rules:
  - **The cookie is minted only on document navigations.** A page load fires
    a dozen parallel requests; minting on whichever arrives first is a race
    where each mints its own id, the browser keeps the last, and that visit's
    events scatter across ids that never appear again.
  - **A cookie value that is not 32 hex characters is replaced, never
    stored.** It arrives from a client and is written to a column.
  - **The funnel stages are cumulative sets over distinct visitors**, so a
    stage can never exceed the one above it and the gap between two lines is
    a real drop-off rather than two different populations.
  - **Rows with no `visitor_id` are excluded, not bucketed.** Every event
    before the migration has a blank id, and lumping them together would
    invent a single visitor who did everything the product has ever seen.
  - **`AsyncLocalStorage` does NOT reach a `req.on("end")` callback**, which
    is where every route with a request body logs from. Measured, not
    assumed, and `enterWith()` does not fix it either: Node emits those
    events from the connection's async context, a sibling of the handler's
    rather than a descendant. A plain `run()` around the handler attributes
    every GET perfectly and records every signup, lead, share and vault
    import as anonymous — which is exactly why it needs a test rather than a
    spot check. `bindRequestListeners()` binds the registration functions so
    listeners added afterward inherit the context; it relies on server.js
    never removing a listener (a wrapped function cannot be matched by
    `removeListener`), so check that before adding a `.off()` anywhere.
  **This migration must be run BEFORE the code deploys**, unlike most in this
  folder: `logEvent`'s INSERT names the two columns, PostgREST 400s an insert
  on an unknown column, so every analytics write would divert to the
  ephemeral `analytics.jsonl` and the dashboard would quietly flatten.
- `GET /dev`, `GET /api/devlog`, `GET|PUT /api/dev-ideas` — the **Development
  Hub**: an internal changelog + future-ideas page, gated by the same
  `ADMIN_KEY` (and sessionStorage key) as `/admin`, with the same triple-noindex
  treatment. The changelog is the repo-committed **`devlog.json`**, read from
  disk per request (edits need no restart; the `/dev` page itself lives in
  server.js and does). **The standing devlog rule: every time you ship a
  fix, improvement, or feature to this project, append an entry to
  `devlog.json` in the same commit** — shape `{ "date": "YYYY-MM-DD", "type":
  "fix"|"improvement"|"feature", "title": "...", "details": "optional",
  "commit": "optional short hash (renders as a GitHub link on /dev)" }`;
  file order doesn't matter (the page groups/sorts by date); routine
  docs-only or refactor commits don't need entries, anything a changelog
  reader would care about does. **Save devlog.json as clean UTF-8, never
  Windows-1252** — em dashes, curly quotes, arrows, and emoji are normal
  and fine raw; do NOT escape them. The file has been mojibake'd by
  encoding round-trips more than once (a PowerShell write without
  `-Encoding utf8` reads UTF-8 as the ANSI codepage, and a merge conflict
  resolved in the wrong editor re-mangles what's already mangled — one
  incident doubled on five successive merges, 60 to 2307 occurrences,
  before anyone noticed). CI (`.github/workflows/ci.yml`) fails the build
  if the telltale double-encoding pattern (`Ã`, `â€`, `Â` sequences)
  appears anywhere in the file — that check is what actually guards this,
  not an ASCII-only rule. Entries are **click-to-edit** on `/dev`:
  edits and per-entry notes live in a Supabase `devlog_overrides` overlay
  (DDL in `migrations/006-devlog-overrides.sql` — run it
  before deploying) keyed by the file entry's original date+title and merged
  at read time, so devlog.json itself is never rewritten at runtime and
  stays the source of truth. Renaming an entry's date or title in the FILE
  orphans its override — re-edit on /dev if that happens. Future ideas are whole-list replaced via
  `PUT /api/dev-ideas` into the Supabase `dev_ideas` table (DDL in
  `migrations/005-dev-ideas.sql` — **run it before deploying**),
  git-ignored `dev-ideas.json` fallback otherwise. When an idea ships, mark
  it done on `/dev` and add the devlog entry.
