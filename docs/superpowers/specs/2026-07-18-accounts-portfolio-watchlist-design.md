# CompNinja Accounts + My Desk (Portfolio & Watchlist) — Design

Date: 2026-07-18
Status: approved by owner (this doc is the written record of that design conversation)

## Goal

Turn CompNinja from a one-shot report page into the start of an ecosystem:
signed-in users keep a **portfolio** of specific properties (with value history
across re-runs) and a **watchlist** of markets (with an in-app feed of new comp
activity). This is the retention loop from the product vision — daily-use,
customer-first — and it is additive: the logged-out experience (search, share,
BOV funnel, market pages) is untouched.

## Decisions already made (owner-approved)

- Real CompNinja accounts, **email + password** (not magic link, not OAuth).
- Watchlist updates are **in-app only** — bell icon + feed, no emails.
- **Search stays open** to visitors with no account; the account is the save/
  sync upgrade moment.
- **Free at launch** for everyone with an account; caps/paid tier come later.
- **Approach 1**: auth built into `server.js` in the existing zero-dependency
  pattern (Supabase via REST fetch + file fallback), NOT Supabase Auth.
- Portfolio = specific properties you track. Watchlist = markets you follow.

## Data model (new Supabase tables + file fallbacks)

All tables follow the existing pattern: written via Supabase REST with plain
`fetch`; when Supabase is unconfigured (or an insert fails), fall back to
git-ignored local files + in-memory maps, same as `leads` / `shared_reports`.

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,              -- stored lowercase-trimmed
  password_hash text not null,             -- scrypt string, format below
  name text,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,             -- sha256 hex of the raw cookie token
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null          -- now() + 90 days
);

create table portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  address text not null,
  property_type text not null,
  payload jsonb not null,                  -- { meta, data } — same shape as the
                                           -- localStorage savedReports entries
  snapshots jsonb not null default '[]',   -- [{ts, low, likely, high, median_psf}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  market text not null,                    -- "City, ST" — matches comp_corpus.market
  property_type text not null,             -- matches the app's property-type enum
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, market, property_type)
);

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,         -- now() + 1 hour
  used boolean not null default false,
  created_at timestamptz not null default now()
);
```

File fallbacks: `users.jsonl`, `sessions.jsonl`, `portfolio.jsonl`,
`watchlist.jsonl` (all git-ignored — PII). Password resets may be in-memory
only in fallback mode (they're one-hour tokens; losing them on restart is fine).

**No feed table.** The updates feed reads the existing `comp_corpus`:
`harvestComps` already stamps every row with `ts`, `market` (via `marketOf`),
and `property_type`, so "new comps in a watched market" is a corpus query —
rows matching `(market, property_type)` with `ts > last_seen_at`.

## Auth mechanics

- **Password hashing:** Node built-in `crypto.scrypt`. Stored as
  `scrypt$N=16384,r=8,p=1$<salt b64>$<hash b64>`; verified with
  `crypto.timingSafeEqual` (same discipline as the existing app-password gate).
  Minimum password length 8; no other composition rules.
- **Sessions:** on signup/login, generate 32 random bytes (base64url) as the
  token; store only its sha256 in `sessions`; send the raw token as a cookie:
  `cn_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000`
  (+ `Secure` except on localhost). A small in-memory cache fronts session
  lookups so `/api/account/me` doesn't hit Supabase on every page load.
- **Password reset:** `POST /api/account/forgot` always returns `{ok:true}`
  (no account enumeration). If the account exists, email a one-hour reset link
  via the existing Resend outbound gate (`EMAIL_FROM` is live). Reset link is
  `/#reset=<token>`; the SPA shows a new-password form and calls
  `/api/account/reset`, which also invalidates all existing sessions.
- **Rate limiting:** the existing `rateLimited()` per-IP limiter guards
  signup/login/forgot (e.g. `rateLimited("acct:" + ip, 10, 15 * 60 * 1000)`).

## API routes (all new, in server.js)

| Route | Auth | Behavior |
|---|---|---|
| `POST /api/account/signup` | — | `{email, password, name?}` → create user + session, set cookie. 409 if email taken. |
| `POST /api/account/login` | — | `{email, password}` → verify, set cookie. Same 401 for bad email vs bad password. |
| `POST /api/account/logout` | cookie | Delete session row, clear cookie. |
| `GET /api/account/me` | cookie | `{email, name}` or 401. |
| `POST /api/account/forgot` | — | Always `{ok:true}`; sends reset email if account exists. |
| `POST /api/account/reset` | — | `{token, password}` → set new hash, kill all sessions. |
| `DELETE /api/account` | cookie | Delete user; cascades wipe sessions/portfolio/watchlist. |
| `GET /api/portfolio` | cookie | List item summaries (id, address, type, snapshots, updated_at) — no payloads. |
| `GET /api/portfolio?id=` | cookie | One item with full `payload` (renders the report client-side, no billed search). |
| `POST /api/portfolio` | cookie | `{payload, snapshot}` → new item (address/type extracted server-side; the client-computed snapshot appended). With `{id, payload, snapshot}` → replace payload + append snapshot (the re-run case). |
| `DELETE /api/portfolio?id=` | cookie | Remove item. |
| `GET /api/watchlist` | cookie | List watched markets. |
| `POST /api/watchlist` | cookie | `{market, property_type}` → add (upsert on the unique key). |
| `DELETE /api/watchlist?id=` | cookie | Remove. |
| `GET /api/watchlist/feed` | cookie | Per watched market: corpus comps since `last_seen_at` (capped ~20/market, newest first), current median $/SF over the trailing 6 months of corpus **sale** rows (leases excluded, matching the valuation math), and the total unseen count (for the bell badge). |
| `POST /api/watchlist/seen` | cookie | Set every item's `last_seen_at = now()` (clears the bell). |

Snapshot values (low/likely/high/median $/SF) are computed client-side by the
existing valuation math and sent with the payload — the server never recomputes
valuation (consistent with "all valuation math is client-side").

## Front-end (index.html)

- **Header (logged out):** add a quiet "Sign in" link. **(Logged in):** bell
  icon with a small numeric badge when the feed has unseen comps, a "My Desk"
  link, and an initials menu (Sign out / Delete account). Calm UI — no
  animation, muted colors.
- **Auth modal:** reuses the existing modal pattern (like `leadModal`). Two
  tabs — Sign in / Create account — plus a "Forgot password?" link. On signup,
  if `localStorage.savedReports` is non-empty, offer one-click import:
  "Import your N saved reports into your portfolio?" → POST each.
- **Save moment:** local auto-save of the last 10 reports stays exactly as-is
  (it's the offline nicety). Signed-in users additionally get an explicit
  **"Save to portfolio"** button on the report — the portfolio is *curated*,
  not every search. Logged-out users see the button too; clicking it opens the
  auth modal with a one-line nudge ("Create a free account to keep this in
  your portfolio on any device").
- **My Desk section** (rendered only when signed in, below the hero/search —
  search remains the top action):
  - **Portfolio grid:** card per property — address, type, likely value,
    last-run date, and change vs. the previous snapshot (▲/▼ %, muted
    green/red). Click → full report re-renders from the stored payload
    (free). **"Refresh valuation"** button re-runs the live search with the
    stored inputs (billed like any search; goes through cache + daily cap),
    then updates the item and appends a snapshot.
  - **Watchlist manager:** add market (city/state + property type — pre-suggest
    from the user's own past searches) / remove; shows each market's current
    median $/SF.
  - **Updates feed:** grouped by market — new comps since last visit with
    source-confidence badges. Opening My Desk fires `/api/watchlist/seen`.
- **Shared reports** (`/r/<id>`): unchanged, except signed-in viewers also get
  "Save to portfolio" on them.

## Analytics

New PII-free `logEvent` kinds, consistent with `/admin`: `signup`, `login`,
`portfolio_add`, `portfolio_refresh`, `watchlist_add`, `feed_view` (dims:
`prop_type`/`market` where applicable — never email or address).

## Explicitly out of scope (v1)

- Paid tier, caps, or upgrade prompts (free at launch; limits are easy to add).
- Email notifications of any kind for watchlists (in-app only, owner's call).
- Any change to search, share links, BOV flow, broker submission flow, or
  market pages.
- Broker-facing accounts/dashboards — but this auth system is deliberately
  generic so a later broker dashboard can sit on the same `users`/`sessions`
  tables (e.g. a future `role` column).
- Cross-device conflict resolution beyond last-write-wins on portfolio items.

## Cost & risk

- $0 marginal cost everywhere except "Refresh valuation," which is one normal
  billed search (~$0.60) behind an explicit click, subject to the existing
  cache and `DAILY_SEARCH_CAP`.
- Security surface = auth. Mitigations are the boring proven ones above
  (scrypt, hashed session tokens, httpOnly cookies, constant-time compares,
  rate limits, no-enumeration responses). No secrets ever reach index.html.
- `server.js` and `index.html` both grow. Accepted for now; if My Desk strains
  the page, break it into its own section/tab later (owner's stated
  preference) rather than cutting features.

## Implementation notes

- New Tailwind utilities used by My Desk will be picked up by the existing
  auto-regen hook — do not regenerate `tailwind.css` manually.
- Rollout: (1) run the DDL above in Supabase, (2) deploy, (3) smoke-test
  signup/login/portfolio/watchlist on compninja.co. The feature is additive,
  so no migration or downtime.
- Add the new fallback files to `.gitignore` alongside `leads.jsonl`.

## Verification plan (no test suite exists in this repo — manual QA)

1. Signup → cookie set → `me` returns the account → survives a server restart
   (Supabase mode) / survives within-process (file mode).
2. Login with wrong password → 401 (same as unknown email); limiter kicks in
   after repeated failures.
3. Save a report to portfolio → appears in grid → click re-renders the full
   report with correct badges/columns → no `/api/comps` call fired.
4. Refresh valuation → new snapshot appended → delta renders on the card →
   the search obeyed the cache (repeat within TTL is a cache hit).
5. Watch a market → run a search that harvests new corpus rows in that market
   → bell badges → feed lists the comps → opening My Desk clears the bell.
6. Forgot/reset flow end-to-end via Resend; old sessions die after reset.
7. Delete account → rows gone (cascade) → cookie invalid.
8. Logged-out visitor: zero behavior change on search/share/BOV/exports.
