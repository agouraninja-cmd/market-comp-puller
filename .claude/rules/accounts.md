---
paths:
  - "google-auth.js"
  - "account-avatar.js"
  - "portfolio-match.js"
  - "portfolio-delta.js"
  - "test/account-*.test.js"
  - "test/google-auth*.test.js"
  - "test/portfolio-*.test.js"
---
# Accounts, the wall and sign-in

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `ACCOUNT_WALL` — optional `on`/`off`, **default ON** (live since 2026-08-05).
  Makes the app account-only. Since 2026-08-08 a visitor with no `cn_session`
  cookie gets a **real page rendered at `/` with a 200** (since 2026-09-01
  that is the HOME page, `renderHomeHTML()` over `home-page.js`; until then it
  was the same bytes `/how-it-works` served, via
  `renderHowItWorksHTML({ home: true })`. Canonical `/`, served no-store
  because what lives at `/` depends on auth state) — NOT the 302 to
  `/how-it-works` the wall shipped with, which left
  the site's strongest URL a redirect Google never followed (Search Console
  confirmed the target was never crawled). `/desk` still 302s, and since
  2026-08-13 it goes to **`/?auth=signin`** rather than `/`: asking for the
  desk is asking for your own account, and the marketing page answers that by
  telling somebody who already has one to go read about the product. The
  wall's actual rule — a personal workspace never renders anonymously — is
  unchanged, and so are the 302 and the `no-store`; only the destination
  moved, onto a door the wall already exempts. It surfaced when the watchlist
  digest started linking to `/desk` from email, and any future mail that links
  there inherits it. Query strings are still dropped
  (`/desk?checkout=success` lost them under the old target too, and a real
  checkout return carries a session cookie and never reaches this branch).
  Signed-in visitors get the app; `index.html` swaps the search form
  for a signup card (`applySearchLock()`, driven by `/api/config`'s
  `accountWall`). It decides on cookie **presence**, never `getSessionUser()`,
  because that reads the database and this route runs on every page load; the
  real gate is that the wall **forces `GUEST_SEARCH_LIMIT` to 0**, so
  `/api/comps` refuses an anonymous search whatever the browser does. The two
  settings are deliberately not allowed to disagree. Two exemptions:
  `/r/<id>` (shared reports are public by design, and now render with the
  signup card above them) and `/?auth=signup|signin` (the account modal lives
  only in `index.html`, so the signup buttons on the landing page need a door
  that serves the app — note a 200 alone no longer proves which page answered;
  tests discriminate on content). **The /how-it-works coupling is gone as of
  2026-09-01**: that page no longer shares this render, canonicalizes to
  itself in both wall states, and is in `sitemap.xml` unconditionally. What
  the wall still decides at `/` is WHICH page answers — the home page for an
  anonymous visitor, the app for a member — and the `WebApplication` JSON-LD
  still reaches crawlers at `/` itself through that render. `off` is the
  instant rollback lever and restores the pre-wall app exactly — `/` serves
  the app and `GUEST_SEARCH_LIMIT` keeps its own configured value; the startup
  banner says which state it is in. Spec in
  `docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md`
  (predates the 200-at-root change; test/account-wall.test.js pins the
  current contract).
- `GUEST_SEARCH_LIMIT` — optional (default 1, LIVE since 2026-08-03; forced to
  0 while `ACCOUNT_WALL` is on). Free
  report searches per **anonymous** visitor before a free sign-in is required —
  a signup funnel, not a paywall (any account clears it; spec in
  `docs/superpowers/specs/2026-08-03-guest-search-cap-design.md`). `0` = sign-in
  before any search; `off` = gate disabled entirely (the instant rollback lever).
  Tracked two ways, blocked when EITHER fires: the Supabase
  `guest_search_quota` ledger keyed by sha256(IP) (DDL in
  `migrations/011-guest-search-quota.sql` — already run in prod), and the httpOnly
  `cn_guest` cookie set once the quota is spent. **Cache hits count** (the
  funnel is the point); a failed search doesn't consume; admins and
  `x-admin-key` callers bypass. Enforced in `/api/comps` **and
  `/api/explore-market`** (403 + `signin_required: true`, which the client
  turns into the account modal) — the Explorer runs the same billed search
  pipeline as a report, so it spends the same single allowance, but only
  when that search PUBLISHES a page (`published: true`); a thin-data
  preview (`published: false`) does not consume it, because the preview
  lives only in memory behind a 30-minute TTL and dies on redeploy, so
  charging the visitor's one free search for it is the same empty-handed
  outcome as the 422 a thin market already returns. A market
  page that already exists is still served free and ungated above the
  check, since that's a database read, not a search. `/api/config` carries
  `guestSearch: { limit, used }` for the form hint and syncs the cookie the
  SSE exit can't set (its headers are already streaming).
  Fails OPEN on ledger errors — `DAILY_SEARCH_CAP` still backstops spend. Each
  block logs a PII-free `signup_gate` analytics event. The privacy policy's
  cookie section names `cn_guest` and the hashed-IP ledger; keep it in step.
- `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` — optional pair
  enabling **"Continue with Google"** on the account modal (2026-08-25).
  Unset (or half-set, which the startup banner calls out): `GET /auth/google`
  and `/auth/google/callback` 404 and the button never renders — /api/config
  carries `googleAuth` for exactly that reveal (the Buy-button rule). Created
  in the Google Cloud console, project "compninja" (the Street View key's
  project): OAuth consent screen (External, non-sensitive scopes only —
  `openid email profile` — so no review), then Credentials → OAuth client ID
  (Web application) with redirect URIs
  `https://compninja.co/auth/google/callback` and
  `http://localhost:3000/auth/google/callback`. What a returned token must
  prove lives in the pure, tested **`google-auth.js`**; server.js owns the
  `cn_gstate` state nonce (named in the privacy policy's cookie list — keep
  in step), the code exchange, and find-or-create. Four decisions worth
  knowing before touching it: **identity is the email** (018's rule), so
  there is deliberately NO migration and no `google_sub` column — a Google
  sign-in lands on the same `users` row a password sign-in does, gated on
  `email_verified === true` strictly; a Google-created account gets a
  **random password hash, never an empty one**, so the password door answers
  it like any wrong guess and the existing reset flow is how it gains a
  password (the reset email goes to the address Google verified, which is
  also why the pre-hijack worry resolves in the email owner's favor); the
  id_token's **signature is not verified**, safe only because the token
  arrives over the server's own secret-authenticated exchange —
  google-auth.js's header says when that stops being true; and the callback
  logs the same `signup`/`login` analytics kinds as the password doors
  (`source: "google"`), so the /admin funnel keeps counting.
  `GOOGLE_OAUTH_TOKEN_URL` is **test-only** (`RESEND_API_URL`'s precedent:
  the whole point is a credential exchange leaving the building, and
  `test/google-auth-routes.test.js` runs the entire flow against a stub) —
  not a secret, but it decides where that exchange is posted, so treat it as
  trusted config and never set it in production.

## Architecture

- **Accounts + My Desk** (added 2026-07-19; spec/plan in `docs/superpowers/`):
  email+password accounts with a server-synced property **portfolio**
  (value-snapshot history per re-run) and an in-app market **watchlist** whose
  updates feed reads the comp corpus. Signed-in searches auto-save to
  `portfolio_items`, upserted on the **verified** address + type since
  2026-08-21 (migration 035, **run before deploying** — `listPortfolio`
  SELECTs `verified_key` by name and PostgREST 400s an unknown column, which
  throws and takes the desk read down until it exists). It upserted on the
  TYPED address, compared with `===`, which made one building typed three ways
  three saved properties with three value histories — measured on a real desk
  (`1210N17th st` / `1210 N 17th st Boise Idaho 83702` / `1210N17th st Boise
  Id`), all of which the confirm dialog had already geocoded to one place
  before running the report. Rules live in the pure, tested
  **`portfolio-match.js`**; the browser sends the label the geocoder verified
  and server.js stores it normalized. Four rules: it **misses rather than
  guesses** (a miss costs a duplicate row somebody can delete, a wrong merge
  destroys one of two value histories and nothing on the desk would show it),
  so a key that names no street number — `boise, id` is a real geocoder answer
  — is refused rather than shared; the **typed-address rule is unchanged** as
  the fallback, which is what keeps every pre-035 row and every report
  restored from history or a share behaving exactly as before; a stored key is
  **only ever filled, never rewritten**, so a property keeps its identity even
  if a later save geocodes differently; and the browser **refuses to send one
  for an address naming a unit** (`unitDesignatorOf`, the same helper the
  footprint estimate and the Street View gate use) because geocoders silently
  drop the unit, so Apt 3 and Apt 5 verify identically. Nothing merges the
  duplicates already on a desk — that is a decision about whose numbers to
  keep, and the column has no business making it silently; Free My Desk is an address
  list, Pro is the book of values, and the caps (100 / 500) live in
  `entitlements.js` as `portfolioMaxItems` / `portfolioValues`. The (retired)
  `$20` unlock does not auto-save. Auth is built into server.js — scrypt
  (Node built-in) password hashes, 90-day session tokens stored as SHA-256
  hashes, `cn_session` httpOnly cookie. Routes: `POST /api/account/signup|
  login|logout|forgot|reset`, `GET /api/account/me`, `DELETE /api/account`,
  `GET|POST|DELETE /api/portfolio`, `GET|POST|DELETE /api/watchlist`,
  `GET /api/watchlist/feed` (exact URL, no query string), `POST
  /api/watchlist/seen`. Storage: Supabase tables `users`, `sessions`,
  `portfolio_items`, `watchlist_items`, `password_resets` (DDL in
  `migrations/002-accounts.sql`) with a git-ignored
  `account-store.json` file fallback for local dev. Search stays fully open
  to visitors — accounts only gate saving/watching. The feed marks items
  "seen" only on explicit My Desk/bell clicks, never on render. Password
  reset emails go through the Resend outbound gate (`EMAIL_FROM` +
  `RESEND_API_KEY`); with either unset the link logs to console instead.
  **Add a property by address (2026-09-02).** `POST /api/portfolio` takes
  `{ address, propertyType }` with no report: the row is the ordinary row
  holding an EMPTY report (`data.comps: []`, the shape the next search
  fills), so the match key, the cap and the fill-never-rewrite verified key
  apply unchanged. One rule is new and test-pinned: a match is ANSWERED
  (`existed: true`, the row's own id and snapshots) and never rewritten,
  because an empty report must not replace the one a search stored. It
  refuses the firm buildings form's three cases — a type outside the
  vault's vocabulary, an address with no street number (a city is not a
  property), and one `addressHasMarket` cannot place. `/vault`'s
  properties deck carries the door (`#propAddToggle`, ships closed,
  `setPropAddOpen` its one writer; the "+ Run a report" link it replaced
  lives inside the form). A row with no snapshot now says "not valued yet"
  instead of "checked <date>", which claimed a check nobody ran — that
  reaches rows added from recent searches too, honestly.
  **Profile photo** (2026-08-14; migration `027-account-avatar.sql`). A
  signed-in account can upload a picture that replaces the initial in the
  account circle (app header, every server-rendered page, My Desk). Rules
  in the pure, tested **`account-avatar.js`**: data URI only (png/jpeg/webp),
  bytes sniffed so a PDF labeled as a PNG is refused, 80KB save cap. The
  bytes live in `user_avatars`, not on `users`, so the session lookup that
  runs on every authenticated request never pulls them; `users.avatar_rev`
  is a short content hash that `/api/account/me` carries so the circle
  knows to fetch `GET /api/account/avatar`. File fallback stores both on
  the user object in `account-store.json`. PUT/DELETE `/api/account/avatar`;
  empty body is how Remove works. Not Pro-gated.
