# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A commercial real estate comp + valuation tool, branded **CompNinja** (the
owner's independent brand — it previously carried Adler Industrial branding;
do not reintroduce Adler anywhere). A user enters a property address + type;
the server asks Claude (with web search) for recent comparable sales/leases
and returns one unified report that both answers and proves: a "What This
Building Is Worth" value hero (the building's SF is looked up from public
records when not entered), a plain-English market summary, a "What's Driving
Prices Here" card (model-supplied `value_drivers` + `market_trend`), a market
position chart, a comp map, and the full sortable comp table with per-comp
source-confidence badges (Verified / Public record / Listing / News /
Estimate). There is deliberately **no mode toggle** — an earlier owner-mode /
comps-mode split was merged (commit 87095aa); `#owner` survives only as a
deep link that pre-opens the property-details section. The hero carries a
"Get a free Broker Opinion of Value" button — the site's lead funnel; those
leads are stored with `source: "bov"` (vs `"export"` for export unlocks).
The front-end is a single HTML file plus one shared script it depends on at
runtime, **`valuation.js`** (the value-range math, extracted so the browser
and the accuracy backtest run one copy of it — see "Non-obvious flows" in
`.claude/rules/report-and-valuation.md` and the Restart rule below); a small Node proxy holds the API key so the browser
never sees it. The public contact email across the site is
info@compninja.co. The owner is not a licensed broker: site copy must say
we "connect you with a local broker", never that we are one, and every
valuation is labeled an automated estimate, never an appraisal. That rule
reaches the DATA too, not just the copy: publishing a vault comp earns the
green "Verified · via \<name\>" badge, which means "a named broker vouched
for this deal", so **the owner does not publish** (decided 2026-08-12) and
the standing plan is to refuse `POST /api/vault/publish` without a license
on the broker profile — see docs/ROADMAP.md's "Next" for the decision and
the alternatives already rejected.

There is no build step, no linter, and **no npm dependencies** — it runs on
plain Node (uses the built-in `fetch`, so **Node 18+ is required**).

The one build-*ish* artifact is **`tailwind.css`**: a vendored, pre-generated
Tailwind build (checked in, served by `server.js`) that replaced the Play CDN.
A Claude Code hook (`.claude/hooks/regen-tailwind.js`) regenerates it when
`index.html` is edited in a session — do not also regen manually; outside a
session, the manual command is under "Restart rule". Either way, verify a NEW
utility class actually landed in the vendored file and commit it alongside.

## Never-break rules

These hold whether or not you have opened the feature's file. The file in
brackets has the detail and the history; this list is what must survive a
session that never reads it.

1. **Plans are decided in one place.** Never test a plan or subscription
   status outside `getEntitlements(user, reportId)` / `entitlementsFor(req,
   reportId)` (rules in `entitlements.js`, which fail closed). `/api/config`'s
   `pro` block is presentation only. `/api/comps`'s `internal` bypass stays
   header-only (`x-admin-key`): a cookie must never widen it. [billing.md]
2. **Gate and blend at serialization only.** Comp gating (`gateReport`),
   vault and firm blending, the radius blend and `locked_basis` all happen in
   `finishReportForViewer()` (the old `gate()` closure), downstream of the
   cache write, `harvestComps()` and `maybePublishMarketSnapshot()`, which must
   keep seeing the whole public report. Blend earlier and one broker's private
   book is served from `search_cache` to the next visitor, or harvested into
   the public corpus with nothing alerting anyone. [search-pipeline.md, vault.md]
3. **The privacy wall is separate tables read by separate functions.** No
   vault row (`broker_comps`, `org_comps`) may reach `harvestComps()`,
   `corpusRowsForMarket()`, a market snapshot, the shared cache or another
   account's report. Never a `private` column filtered in a corpus query, and
   never widen an existing `user_id=eq.` read to an org —
   `or=(user_id.eq.X,org_id.eq.Y)` looks right in review and fails silently,
   and `test/org-routes.test.js` fails the build on it. [vault.md, firms.md]
4. **Where a local file would be the loss, refuse instead of falling back.**
   Most of the app degrades to a local JSON file without Supabase. The vault,
   invited and firm shares (`storeSharedReport` throws), the billing tables
   and the watchlist digest deliberately do not — they refuse (503), because
   Render erases its disk on every deploy. [vault.md, sharing.md]
5. **Shares.** `report-access.js` alone decides who may read a shared report;
   any `visibility` other than the literal `"public"` is treated as invited;
   the ACL (visibility, `revoked_at`, viewers) is re-read on every call and
   never cached with the payload; a public share never carries a private comp.
   [sharing.md]
6. **Private finances stay in the browser.** NOI, debt terms, the rent roll
   and op-ex gross income never reach the model, `/api/comps` (so never the
   cache key) or any public surface, and `/api/share` strips them. The
   signed-in portfolio is the one place they are stored, so any future
   share-from-portfolio must strip them too. [report-and-valuation.md]
7. **A private comp's address never goes to a third party** — only our own
   POST `/api/geocode` (Census behind it), never Nominatim, never in a URL.
   [report-and-valuation.md, maps.md]
8. **"Verified" is reserved** for the badge the server awards, and
   `scrubUnearnedVerifiedClaims` stays outermost in `finishReport`. An unknown
   `source_type` normalizes to `estimate`: badges may under-claim provenance,
   never over-claim. [search-pipeline.md]
9. **Migrate before deploy when code names the column.** PostgREST 400s a
   SELECT or INSERT naming an unknown column, and several paths swallow that
   into an ephemeral fallback or an empty read (the corpus sat frozen for
   weeks that way). Each migration's section says which order it needs.
10. **A per-type comp field spans four maps plus a `comp_corpus` column** —
    use the `add-comp-field` skill, never memory.
11. **⚠ pairs move together.** Browser code cannot always require a module,
    so some logic is deliberately copied and marked ⚠ on both sides
    (`compWeight` in index.html and comp-gate.js; `reportIdFor` /
    `exportReportKey`; `normalizeBrandBlock` / `normalizeBrand`; `areaStyle` /
    `boundaryStyle`; `BULK_SUBJECT_FIELDS` / `TYPE_SUBJECT_FIELDS`; the vault
    page's refusal needles). Grep for ⚠ before changing either side.
12. **Nothing mails or sweeps on a timer.** The watchlist digest, the trial
    emails and the permit sweep are `ADMIN_KEY`-gated routes driven from
    outside the process. A ledger is marked only after the send, and opening
    `/admin` must never send mail. [watchlist-and-mail.md, billing.md,
    permits.md]
13. **Checkout has no fallthrough.** `/api/checkout`'s `PLANS` map 400s an
    unknown plan, `.pricing-buy` `data-plan` values must match it, and
    `single_report` stays retired (a source-scan test pins it). [billing.md]
14. **Page routes match on the path without its query string** (`pagePath`);
    API routes keep their exact `req.url` matches. [workspace.md]
15. **Member pages are built before anyone sees them** (instant tab
    switching — the likely next tab on every page view: prerendered in
    Chrome, rendered ahead on the server for Safari/Firefox, built in a
    hidden view by the desktop app's shell). A page writes
    only through `fetch`, which holds a non-GET until the page is shown;
    never a `sendBeacon` or `XMLHttpRequest`, which slip past it. A page
    visit event goes through `logPageVisit`, never a bare `logEvent`, and a
    page's SERVER render that writes checks `INSTANTNAV.isSpeculative`.
    [app-shell.md]

## Tests and CI

`npm test` (`node --test`, no dependencies) covers the pure rule modules —
each states its own rules in its header comment — plus route suites that boot
a real `server.js` as a child process to prove those rules are actually wired
(`test/routes.test.js` and the `*-run.test.js` files, many of them against the
stand-in database in `test/helpers/fake-supabase.js`). Run it after touching
any of those rules, and trust its own summary for the test count. Nothing
beyond those modules and that wiring is tested, so a green suite does not mean
the app works.

CI (`.github/workflows/ci.yml`) runs `node --check` on the entry points, the
suite, and a bare-environment boot smoke against `/healthz` on every push. A
red X on GitHub Actions means fix or revert now. **No result at all is not
green** — use the workflow's "Run workflow" button (`workflow_dispatch`) when
webhooks are being dropped.

`npm start` runs `prestart` (`node --check server.js`), which is the
production deploy gate on Render. **Do NOT put `npm test` back in front of
it**: it sat there until 2026-08-20 and killed three production deploys in a
row by fighting Render's health check for the CPU.

How to write a test here — the stand-in database 400s any query shape it was
not taught, every mail assertion goes through `waitForMail`, and a subtest
that touches the context declares `(t)` (enforced by
`test/subtest-teardown.test.js`) — is in `.claude/rules/testing.md`, which
loads when you open anything under `test/`.

## Working alongside another session

**If someone else already has this folder, take your own.** A clone has one
checked-out branch and one staging area shared by every process pointed at it,
so two agents in `~/dev/compninja-owen` are not two workspaces, they are two
people at one desk. Whichever commits first sweeps up whatever the other has
staged, and a branch switch pulls files out from under the other mid-edit. On
2026-08-20 that filed an entire iOS client under an unrelated feature branch one
minute before that branch was pushed. Nothing was lost, but only because someone
checked.

```bash
node scripts/worktree.js market-badge   # -> ../cn-market-badge on feat/market-badge
```

That makes a second folder with its own branch, its own staging area, and the
same history, branched off `origin/main` as it is right now rather than off
whatever this folder is sitting on. Git then refuses to check out one branch in
two worktrees, which is the guardrail the shared folder never had. It also
symlinks `.env`, which is gitignored and therefore absent from a fresh worktree
— without it the server boots keyless and every Supabase script fails
confusingly rather than obviously. The other gitignored files
(`account-store.json`, `analytics.jsonl`, `shared-reports.json`,
`search-cache.json`) are local fallback DATA and are deliberately not linked.

Run `git worktree list` to see who holds what. When your PR merges,
`git worktree remove <dir> && git worktree prune`.

**Check what you are about to send, every time.** `git status` shows changed
files and says nothing about whose commits are underneath them:

```bash
git log origin/main..HEAD
```

If that lists work you did not do, it arrived the way described above. Do not
just drop it — confirm the same content is committed somewhere else first (`git
diff --stat <other-commit> <yours>` over the relevant paths), then rebase in a
throwaway worktree and push with `--force-with-lease`, leaving the shared folder
on the other session's branch so its files stay on disk.

## Running it

```bash
npm start          # prestart runs node --check, then node server.js -> http://localhost:3000
```

`npm start` first runs `prestart` (`node --check server.js`) and refuses to
boot on a failure — that is the production deploy gate (Render's start command
is `npm start`). Keep it: it is fast and it catches the one failure that takes
the site down at boot. Do NOT put `npm test` back in front of it — see the note
above on the deploys that killed. Node is a system install on PATH on the
owner's Windows machine, so plain `node` and `npm` work in every shell. (It
was a portable no-admin copy launched by full path until 2026-09; that
folder is gone, so a `node-portable` path found in an old plan is dead.)

### Restart rule (important)

- Editing **`index.html`** needs no restart — `server.js` reads it from disk on
  every request, so just refresh the browser. That page's one inline
  `<script>` block has a hard runtime dependency on **`/valuation.js`**: its
  very first statement destructures `VALUATION`, so if that file fails to
  load, the destructure throws and the whole front end aborts — no search
  form, no modals, no report rendering — while the page still renders its
  HTML and CSS, so it looks fine and does nothing. `/valuation.js` must never
  be cached stale relative to the HTML that depends on it, which is why it is
  served with `max-age: 0` while every other static asset in `STATIC_FILES`
  caches normally; do not add caching back to it.
- Editing **`server.js`** (e.g. the prompt) **requires restarting the process** —
  it's loaded once at startup. Kill the process listening on port 3000 and
  relaunch.
- Adding **new Tailwind utility classes** to `index.html` requires regenerating
  the vendored **`tailwind.css`** — a class missing from it silently won't
  style. Run from the project root:

  ```powershell
  npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
  ```

  Classes already used anywhere in `index.html` (including inside JS strings)
  are covered; only genuinely new utilities need a regen. Commit the updated
  `tailwind.css` alongside the HTML change.

### Design drafts: one format (standing rule)

**When the owner asks for a draft of a design** (drafts, options, mockups, a
redesign of any page), the answer is a published Artifact page in the format
of the Workspace drafts page (https://claude.ai/artifact/CqHmNs3iL5JWFDVmUJKT3c,
owner's call 2026-09-25). It has draft cards A/B/C with a trade-off each, a
viewer of real screenshots (situations × desktop/dark/phone, next to today),
"Found while making these", and "How to pick". The `design-drafts` skill
(`.claude/skills/design-drafts/`) holds the checklist and a `template.html` of
that page. Start from the template rather than designing a new wrapper. Drafts
come before building; the before-and-after rule below applies once a draft is
picked and built.

### Design changes: before and after (standing rule)

**Every time you change how something LOOKS, show the owner a before and an
after picture of it** — a layout, spacing, colour, copy on a rendered surface,
a new card or section, anything in `index.html`, `vault-page.js`, or the
server-rendered pages in `server.js`. A diff of a template literal says what
the markup now is and nothing about what the page now looks like, which is why
this is a rule and not a nicety.

```bash
node scripts/shot.js /how-it-works --before      # vs origin/main
node scripts/shot.js / /markets /brokers-firms --before HEAD~1
node scripts/shot.js / --size 390x844 --expand   # phone width, accordions open
```

PNGs land in the git-ignored `screenshots/` as `<page>--before.png` /
`<page>--after.png`. Zero dependencies: it drives a Chromium the machine
already has (`desktop.js`'s `findBrowser`, reused rather than copied) over the
DevTools protocol, boots `server.js` on a free port at each side of the
comparison, and removes the worktree it made. Five things to know before
editing it or trusting its output:

- **The "before" is a DETACHED WORKTREE, never `git stash`.** This checkout is
  routinely shared with another session, and stash moves files under them
  mid-edit. Detached because git refuses to check out one branch twice, and a
  comparison needs no branch of its own.
- **Both servers boot with `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` blanked**, by
  ASSIGNMENT rather than delete — server.js's `.env` loader fills anything
  `undefined` and would restore the real ones, pointing a scratch server at
  production's corpus, market pages and cache (the trap `run-eval.js`
  documents at more length). The consequence to remember when reading a
  picture: **anything DB-driven renders its fallback**, so a change to real
  market figures or to `/vault` will not show. `--env SUPABASE_URL=…` puts a
  database back deliberately and prints a warning; point it at a scratch
  project, because the before pass runs OLD code against whatever it is given.
- **It emulates `prefers-reduced-motion: reduce`,** which is load-bearing, not
  polite. The server-rendered pages hide below-the-fold content with
  `.anim .rv{opacity:0}` and reveal it from an IntersectionObserver that never
  fires in a beyond-viewport capture; without this, `/how-it-works` comes out
  with blank bands where the Method and FAQ should be, and two runs of
  IDENTICAL code produce different bytes.
- **Collapsed `<details>` are invisible unless you pass `--expand`.** Real copy
  lives inside them (the FAQ accordions on `/` and `/how-it-works`;
  the vault's `dbox` panels). A change to a FAQ answer photographs as two
  identical pages, which reads as "nothing changed" rather than "you
  photographed a closed drawer" — that is exactly how this was found.
- **Identical pages produce byte-identical PNGs**, so "this changed nothing
  visually" is provable with `sha256` rather than eyeballed. Treat a
  same-bytes result on a change you expected to see as a question about the
  capture (a closed accordion, a DB-driven surface) before concluding the code
  is wrong.

Pure helpers are tested in `test/shot.test.js`; requiring the module starts
nothing.

### The devlog (standing rule)

**Every time you ship a fix, improvement, or feature, append an entry to
`devlog.json` in the same commit** — shape `{ "date": "YYYY-MM-DD", "type":
"fix"|"improvement"|"feature", "title": "...", "details": "optional",
"commit": "optional short hash" }`. File order doesn't matter; routine
docs-only or refactor commits don't need one, anything a changelog reader
would care about does. **Save it as clean UTF-8** — em dashes, curly quotes
and emoji are fine raw; do not escape them. A PowerShell write without
`-Encoding utf8` has mangled it more than once, and CI fails the build on the
double-encoding pattern. The `/dev` page that renders it is in
`.claude/rules/admin-and-analytics.md`.

## Configuration (environment / `.env`)

`server.js` has a tiny built-in `.env` loader, so a local `.env` works without any
dependency. `.env` is git-ignored — never commit it.

- `ANTHROPIC_API_KEY` — **required.** Keep the key on ONE line with nothing after
  it; a stray comment or a smart `—` dash on the same line will corrupt it.
- `APP_PASSWORD` — optional shared password. When set, the front-end shows a lock
  screen and every `/api/comps` call must carry the matching `x-app-password`
  header (checked server-side with a constant-time compare). When unset, the app
  is fully open.
- `LEAD_CAPTURE` — optional `on`/`off`. When on, the CSV/PNG/print exports are
  unlocked by a one-time contact form (the lead-magnet flow). Defaults to ON when
  `APP_PASSWORD` is unset (public deployment) and OFF when it is set (internal).
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — optional pair. When both are set,
  leads are stored durably in a Supabase Postgres table named `leads` (written
  via its REST API with plain fetch — still zero npm deps). When unset, or if a
  DB insert fails, leads append to `leads.jsonl` (git-ignored — contains PII,
  never commit). `GET /api/leads` merges both sources.
- `ADMIN_KEY` — optional. When set, `GET /api/leads` returns the captured leads
  as CSV (send the key via `x-admin-key` header or `?key=`). Unset = that
  endpoint is disabled. Without Supabase configured, leads live only in
  `leads.jsonl`, which ephemeral-filesystem hosts wipe on every redeploy.
  **It is also the admin identity for comped Pro** — see "Admin access" in
  `.claude/rules/billing.md`.
- `PORT` — defaults to 3000. Hosts set this themselves.

### Every other variable

Each has a full entry — rationale, rollback, traps — in the rules file named.
The **test-only** ones decide where a request is posted or switch off a guard,
so they are trusted config and are never set in production.

| Variable | Default | What it does | Details |
|---|---|---|---|
| `TESTER_PASSKEY` | unset (route 404s) | shared code that comps all of Pro to a signed-in account (`users.pro_tester`) | billing.md |
| `VAULT_PASSKEY` | unset | shared code that grants the broker vault only (`users.vault_beta`); a second secret, never the same string | billing.md |
| `RESEND_API_KEY`, `LEAD_NOTIFY_EMAIL`, `EMAIL_FROM` | unset / owner's inbox / unset | owner notifications; `EMAIL_FROM` is the single gate for mail to leads and brokers | watchlist-and-mail.md |
| `DAILY_SEARCH_CAP` | 150 | site-wide ceiling on billed searches per UTC day (cache hits are free; Pro is exempt, a trial is not) | search-pipeline.md |
| `BULK_DAILY_ADDRESSES` | 200 | per-member daily ceiling on bulk-valuation addresses | bulk.md |
| `ACCOUNT_WALL` | on | account-only app; anonymous `/` gets the home page and `GUEST_SEARCH_LIMIT` is forced to 0; `off` is the rollback | accounts.md |
| `GUEST_SEARCH_LIMIT` | 1 (0 under the wall) | free searches per anonymous visitor before sign-in | accounts.md |
| `GOOGLE_MAPS_API_KEY` | set on Render | Street View photos in map popups via `/api/streetview` | maps.md |
| `GOOGLE_OAUTH_CLIENT_ID` + `_SECRET` | unset | "Continue with Google" | accounts.md |
| `SEARCH_PROVIDER` | `gemini` | `gemini` or `anthropic`; an unknown value exits at boot; `MODEL` overrides the model; `/healthz` reports what is live | search-pipeline.md |
| `THINKING_LEVEL` | unset (production: `low`, set on Render) | Gemini reasoning depth — the largest wall-clock and cost lever | search-pipeline.md |
| `STREAM_ANTHROPIC` | on | stream the search call | search-pipeline.md |
| `PARALLEL_SEARCH` | off | two concurrent search lanes; measured and not worth it yet | search-pipeline.md |
| `CORPUS_RADIUS`, `CORPUS_METRO`, `CORPUS_LISTED`, `ARCHIVE_FIRST` | on | `off` rolls back the radius blend, metro retrieval, on-market listings, archive-first | corpus.md |
| `LEAD_METRO` | on | broker lead coverage matches across metro groups | vault.md |
| `NAV_SHELL` | `rail` | signed-in chrome as a left rail; `bar` is the rollback | app-shell.md |
| `SITE_URL`, `GOOGLE_SITE_VERIFICATION` | Render URL / unset | canonical origin; Search Console file verification (keep it set for good) | public-pages.md |
| `PRO_ENABLED` | off in code | master switch for the paid tier (run its DDL first) | billing.md |
| `PRO_AUDIENCE` | unset (everyone) | email allowlist narrowing who Pro applies to; unsetting it is the launch | billing.md |
| `PRO_TRIAL_DAYS` / `PRO_TRIAL_START` | 14 / unset | new-account Pro trial; `0` or `off` is the rollback | billing.md |
| `STRIPE_PRICE_*` | — | price ids; each may be a comma list (first is sold, all are recognized), so a price change is `new_id,old_id`, never a swap | billing.md |
| `STRIPE_PRICE_CHECK` | on | boot check that each sold price matches `PRICING`; a mismatch pauses that plan's checkout | billing.md |
| `FREE_REPORTS_PER_MONTH` | 3 | a free account's monthly report allowance | billing.md |
| `RESEND_API_URL`, `SEARCH_API_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `CENSUS_API_URL`, `PERMIT_PORTAL_ORIGIN`, `SHIP_BOARD_BASE`, `LOGO_IMPORT_ALLOW_PRIVATE` | unset | **test-only** endpoint overrides and one guard switch | that feature's file |

## Where everything else lives

This file holds what every session needs. Each feature's routes, data rules,
history and traps live in a file under `.claude/rules/` (moved there verbatim
on 2026-09-25), and Claude Code loads that file **automatically when it opens
a matching file** — the `paths:` list at the top of each. `server.js` and
`index.html` hold code for every area, so opening them does not pull in
everything: **before changing an area's code in `server.js`, read that area's
file.** A cross-reference inside one of them ("see X above", "flow 3") may
point into a sibling file, so grep `.claude/rules/` rather than assuming it is
gone. Document a new feature in its area's file, not here.

| File | What it holds | Loads when Claude opens |
|---|---|---|
| `search-pipeline.md` | `POST /api/comps`, prompt, cache, live progress (SSE), providers, `MODEL`, `THINKING_LEVEL`, measuring a model change (`run-eval.js`), upstream health, the source-link check, flows 1 and 5 (parsing, currency) | `search-provider-*.js`, `report-parse.js`, `link-check.js`, `run-eval.js`, `eval-*` |
| `corpus.md` | the comp corpus and its health alarm, corpus-first retrieval, radius blend, archive-first, metro matching, on-market listings, `/api/corpus-comps`, the accuracy backtest | `corpus-*.js`, `blend-corpus.js`, `backtest.js`, `market.js`, `deal-date.js` |
| `report-and-valuation.md` | the report front end: search form, valuation math and hero, flows 2–4 and 3a–3f, private comps on screen and in exports, PowerPoint export | `index.html`, `valuation.js`, `comp-gate.js`, `market-snapshot.js` |
| `billing.md` | Pro tier, trial, prices, free allowance, passkeys, admin access, branding, trial emails, `/api/config`, `/pricing` | `entitlements.js`, `stripe.js`, `branding.js`, `trial-notices.js`, `pricing-page.js` |
| `vault.md` | the broker vault (import, mapper, editing, publishing, dashboard, gut check, BOV, building facts), comp submissions, the lead inbox | `vault-*.js`, `broker-*.js`, `building-facts.js`, `gut-check.js`, `bov-log.js`, `blend-comps.js`, `xlsx.js` |
| `firms.md` | firms: membership, shelf, buildings, sheets, leases, contacts, messaging doors, auto-share, the shared vault, seats, shop kinds | `org-*.js`, `buildings-page.js`, `messaging.js` |
| `workspace.md` | the signed-in `/` workspace: layout drafts, figure strip, skyline, one-paint fill, `DESK_BOOT`, `AUTH_BOOT`, `pagePath` | `index.html`, `firm-skyline.js`, desk tests |
| `app-shell.md` | the `NAV_SHELL` rail, the signed-in header on server-rendered pages, nav parity with `index.html`, instant tab switching (prerendered tabs, `/api/visit`) | `theme.js`, `instant-nav.js`, nav tests |
| `sharing.md` | `POST /api/share`, `/api/shared`, `/r/<id>`, permissioned sharing | `report-access.js` |
| `accounts.md` | account wall, guest limit, Google sign-in, accounts and portfolio, profile photo | `google-auth.js`, `account-avatar.js`, `portfolio-*.js` |
| `public-pages.md` | home, FAQ, how-it-works, brokers-firms, the brand entity, `SITE_URL`, Search Console | `home-page.js`, `faq-page.js`, `brokers-firms-page.js` |
| `markets.md` | market pages, momentum map, city photos and boundaries, the Market Explorer, broker directory | `market-*.js`, `city-check.js`, `gen-market-seed.js`, `broker-directory.js` |
| `bulk.md` | bulk valuation | `bulk.js`, `bulk-page.js` |
| `permits.md` | the permit sweep and `/permits` | `permit-*.js`, `permits-page.js` |
| `watchlist-and-mail.md` | Resend and outbound mail settings, `/api/lead`, the watchlist digest, search demand | `watchlist-digest.js`, `search-demand.js`, `email-shell.js` |
| `admin-and-analytics.md` | `/admin`, `/api/stats`, the visitor funnel, the `/dev` hub | `devlog.json`, `dev-returns.js` |
| `maps.md` | the Google Maps key, `/api/geocode`, `/api/streetview` | `index.html`, `streetview-aim.js` |
| `desktop.md` | `desktop.js`, the Electron app in `desktop-app/`, the installable web app | `desktop.js`, `desktop-app/**` |
| `ship-board.md` | the nightly Google Chat post and `/dev/shipped` | `ship-board.js`, `scripts/ship-chat.js` |
| `testing.md` | how tests are written here | `test/**` |

## Deployment

Standard Node web service. Push to a Git host and deploy on Render/Railway/Fly/etc.
with start command `npm start`. Set `ANTHROPIC_API_KEY` (and `APP_PASSWORD` for a
public link) as host environment variables — do not rely on `.env` in production.
Every search is billed to the owner's Anthropic account, which is why a public
deployment should set `APP_PASSWORD` and/or a spend cap in the Anthropic console.
