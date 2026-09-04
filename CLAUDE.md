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
and the accuracy backtest run one copy of it — see "Non-obvious flows" and
the Restart rule below); a small Node proxy holds the API key so the browser
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

There is one small test suite: `npm test` (`node --test`, no dependencies)
covers the nine pure modules — **`entitlements.js`** (the Pro tier's
decision table), **`comp-gate.js`**, **`stripe.js`**, **`broker-vault.js`**,
**`corpus-audit.js`**, **`blend-corpus.js`** (saved deals within 10 miles
join the report at serialization, before the paywall), **`broker-leads.js`** (the broker lead inbox's
rules: coverage matching, lead anonymization allowlist, coverage seeding,
notify dedupe), **`valuation.js`** (the value-range math shared by the
browser and the accuracy backtest — the one pure module here that loads in a
browser too, via a dual Node/global export), **`backtest.js`** (the
hold-one-out accuracy scorer built on it, requiring nothing but
`valuation.js`) and **`branding.js`** (report branding's decision table: what
mark a render uses, and the rule that a shared report is decided entirely by
its own snapshot) and **`account-avatar.js`** (what may be stored as a
profile photo: data URI only, bytes sniffed, never a URL) and **`watchlist-digest.js`** (the digest's copy and its
"is this worth sending?" rule — the only email this product sends on its own
initiative, so every judgment in it is about what a person is worth
interrupting for), **`deal-date.js`** (the deal-date parser, including the
Active / Listed sentinels) and **`corpus-harvest.js`** (what gets stored, and
the usable-vs-listed split) and **`building-facts.js`** (what a broker's own
deals on one building agree on and what an empty cell may inherit from that,
read-time only — dual-exported like `valuation.js`, since `/vault` prefills
from the same rule the server fills with) — plus **`report-access.js`** (the ONLY function that
decides who may read a shared report: an unrecognized `visibility` is
treated as invited, never public) and **`org-buildings.js`** (what may be put on a firm's board and how the list is
summarized: the two keys are the vault's `addressKey` and the portfolio's
`verifiedKeyFor`, INJECTED so no third key exists; a building with no street
number is a city and is refused) and **`org-access.js`** (who is in a firm
and what their membership allows — an unknown role is a `member`,
`removed_at` beats ownership, and an invite is not a membership until the
invited person accepts it) and **`market-hero.js`** (which city's
photograph heads a market page, and the rule that a missing city gets no
picture rather than someone else's skyline) and **`market-hero-quality.js`**
(whether a stored hero JPEG is the right size and dense enough to not be an
upscale) and **`market-hero-pick.js`** (which Wikimedia candidate is worth
downloading for a city nobody curated — every hard refusal in it ends in a
satellite aerial, so it refuses freely) and **`market-hero-judge.js`** (the
request that asks a model to LOOK at the finished crop, and the rule that any
answer which is not a clear "good" is not a good picture) and
**`market-area.js`** (the one claim a CITY's carved shape on the momentum map
may make when it holds several markets: agreement colours it, disagreement is
`mixed`, no reads is `none`, and an unread market never argues an agreeing
city into `mixed`) and **`bulk.js`**
(bulk valuation's rules: what counts as an address in a pasted list — a line
is ONE address however many commas it holds — what one finished report is
worth as a portfolio row, and the rule that a total sums only what was
actually valued rather than counting a failed lookup as zero) and
**`test/routes.test.js`**, which boots a real
server twice as a child process to prove the gates are actually WIRED to the
routes and not merely correct in isolation (320 tests on 2026-08-06). The
count moves whenever a module is added, and this line has already lagged
twice, so trust `npm test`'s own summary over the number written here.
Nothing needs a real database or a real mail provider, only the route-level
files start a server, nothing calls anything external, and the whole run
finishes in a couple of seconds, so there is
no excuse for not running it after touching any of those rules.
**`test/helpers/fake-supabase.js`** is how the second half of that stays true
(2026-08-13): a stand-in PostgREST + Resend that lets a suite exercise the
paths which exist ONLY with a database. Most of this app degrades to a local
JSON file when Supabase is unconfigured, which is what makes the rest of the
suite free — but the features that deliberately have NO file fallback (the
vault, permissioned shares, the watchlist digest) are exactly the ones where a
mistake costs a broker their book or mails a stranger twice, and before this
they could only be tested up to "it refuses without a database".
`test/watchlist-digest-run.test.js` is the first user. Two rules: the fake
implements only the query shapes server.js actually sends and **400s on
anything else rather than matching everything** (a fake that matches
everything reports a user-scoped read as working while it returns another
account's rows); and it is a stand-in, not a Postgres, so a new query shape
means teaching it that shape deliberately, never loosening its parser.
It also owns **`waitForMail(db, want)`**, and every suite that reads its
`sent` array must go through it: the routes that mail hand the send to
`sendOutboundEmail` WITHOUT awaiting it, so `sent` fills in after the response
and a test reading it on the next line is asserting on a race it usually wins.
There were four hand-copied versions of that loop with three different budgets
(1.5s, 1.5s, 2s, 10s), and the short ones were the ones written first rather
than a decision about those routes. The one exception is the hub invitation,
whose sends ARE awaited (`emailed` is their own answer) — `test/hub-run.test.js`
says so where it reads `sent` with no wait. A wait is only half of it: the
suites must also assert that the REQUEST which should have caused the mail
succeeded, or an unrelated failure — a 503, a child server dying mid-run —
arrives as an empty recipient list and reads as a broken notifier.
**A subtest that touches the test context must DECLARE one** — write
`async (t) => {}`, never `async () => {}`. The argument-less form has no
context of its own, so a `t.after()` inside it (or a fixture helper it hands
`t` to) registers on the PARENT, and every server the block boots stays alive
until its LAST subtest ends, then shuts down in one burst. Nothing goes red;
the suite just runs with eleven idle server.js children and eleven stand-in
databases where it uses one, which is the load that makes boot.js's
spontaneous child death likelier and the burst a hung `node --test` was found
sitting in. Fixed once in PR #239 and again the next day in four more files
(2026-09-01, after `test/org-run.test.js` went intermittently red under load),
so it is a check now rather than a convention: **`test/subtest-teardown.test.js`**
scans every suite and fails the build on either shape. The difference between
right and wrong is one character and the suite is green either way, so a
person is the wrong detector for it.
Nothing beyond those modules and that route wiring is tested; do not assume a
green suite means the app works. CI (`.github/workflows/ci.yml`) runs on
every push: `node --check` on
the entry points, the test suite, and a bare-environment boot smoke against
`/healthz` — advisory on GitHub, but since 2026-08-08 the same checks also
gate the deploy itself: `npm start` runs a `prestart` script (`node --check
server.js`), so on Render an unparseable server.js exits before the server
listens and the previous green deploy keeps serving. That gate holds even
when Actions is down.

**`npm test` was removed from `prestart` on 2026-08-20**, after it broke
production deploys. It was written when the suite was about two seconds; it is
now 1731 tests taking **63 seconds on Render**, and several suites spawn real
child servers. On a 0.5-CPU Starter instance that is 63 seconds of saturated
CPU before the port is ever bound, re-run from scratch on every restart and by
every concurrent instance. Three deploys in a row died on
`Timed out after waiting for internal health check ... /healthz` while the
health checker fought the test suite for a core — and each failure restarted
the instance, which re-ran the suite, which made the next one likelier to fail.
`node --check` stays, because that is the failure the gate was actually
protecting against: a syntax error in server.js takes the whole site down at
boot. Correctness is CI's job, on every push, where it costs nothing to run it
twice. A red X on
GitHub Actions still means fix or revert now. **No result at all is not the same as
green**, and it happens: during a 7-hour Actions incident on 2026-08-06 GitHub
throttled webhooks to ~15% and four branches merged with no CI run ever
created. So the workflow also carries **`workflow_dispatch`** — a "Run
workflow" button on any branch, which is a direct API call rather than a
webhook delivery and therefore still works when pushes are being dropped. Use
it to get a verdict on a commit already on main without pushing an empty commit
to manufacture a webhook. The four checks can also be run locally in about two
seconds; that is what to do when Actions is down, rather than assuming.

The one build-*ish* artifact is **`tailwind.css`**: a vendored, pre-generated
Tailwind build (checked in, served by `server.js`) that replaced the Play CDN.
A Claude Code hook (`.claude/hooks/regen-tailwind.js`) regenerates it when
`index.html` is edited in a session — do not also regen manually; outside a
session, the manual command is under "Restart rule". Either way, verify a NEW
utility class actually landed in the vendored file and commit it alongside.

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

### Desktop app (`desktop.js`)

```bash
npm run desktop                          # local server + chromeless app window
node desktop.js --url https://compninja.co   # hosted site as an app window, no local server
```

A zero-dependency launcher, **deliberately not Electron** — the no-npm-deps
rule covers it, and every target machine already ships a Chromium (Edge is
preinstalled on Windows). It boots the ordinary `server.js` on a **free
port, never 3000** (so it can run beside `npm start`), waits for `/healthz`,
then opens a Chromium-family browser in `--app` mode. Three rules from its
header comment: children spawn from `process.execPath`, never the string
`"node"` (the owner's portable Node is not on PATH); the app window gets its
**own `--user-data-dir`** (`~/.compninja/desktop-profile`) — without one
Chromium hands the URL to an existing instance and exits, leaving no process
to wait on, so the server would die under an open window; and closing the
window stops the server. Flags are refused, never guessed (`--ur`, a
non-http `--url`, `--port` combined with `--url` are all errors). Pure
helpers are tested in `test/desktop.test.js`, and requiring the module
starts nothing (`require.main` guard).
`scripts/install-desktop-shortcut.ps1` creates the Windows shortcut (repo
favicon as icon, portable-Node lookup, `-Url` for the hosted variant,
`-StartMenu` for a Start Menu copy).

**The standalone downloadable app lives in `desktop-app/`** (2026-08-20) —
an Electron shell around https://compninja.co with its own installer,
icon, and process: no visible browser anywhere, which is what the owner
asked for after the PWA still carried Chrome's chrome. It holds NO product
code (every deploy of the site reaches installed copies instantly) and is
**the one folder in the repo with npm dependencies** — dev-only build
tools, in their own package.json; the site's zero-dep rule is about
server.js and stands, and root `npm test`/`npm start` never touch this
folder. The window is locked down like a browser tab (sandbox, no
nodeIntegration, no preload, no IPC); navigation stays in-window only for
compninja.co and *.stripe.com (checkout must complete and return),
everything else opens the system browser; an unreachable site shows the
branded `offline.html`, never Chromium's grey error. Installers build on a
`desktop-v*` tag via `.github/workflows/desktop-release.yml` (create the
release once, then a 3-OS matrix attaches `CompNinja-Setup.exe` /
`CompNinja.dmg` / `CompNinja.AppImage` — version-less artifact names on
purpose, so `releases/latest/download/…` URLs are stable; keep them in
step with the /download page). Cut a release:
`git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`. The installers
are **unsigned** until the owner buys a Windows code-signing cert and
Apple notarization ($99/yr) — first-run SmartScreen/Gatekeeper warnings
are expected and the /download page says so honestly.

**A door you are already through is hidden** (2026-08-20; `INAPP_BOOT` /
`INAPP_UA_TOKEN` in server.js, `test/inapp-nav.test.js`). Inside the desktop
app or an installed PWA, the Explore menu drops "Download the app". Nothing
detects an app INSTALLED on the machine — browsers refuse to answer that and
any attempt is a guess; what is knowable is whether THIS page is being viewed
from inside the app. **Two signals, because one is not enough**: an installed
PWA matches `display-mode: standalone`, but Electron reports
`display-mode: browser` (measured via CDP, Electron 43) and is identifiable
only by the UA token `desktop-app/main.js` appends — the test fails the build
if the two spellings drift, since a rename on one side alone just quietly
brings the link back inside the shipped app. One constant carries the script
AND its CSS into all three surfaces (marketShell, the landing render, and
index.html via an `<!--INAPP_BOOT-->` marker replaced at serve time like
NAV_LINKS — never a hand-copy, THEME_BOOT being the cautionary tale). It runs
inline in `<head>` so the link is never painted then snatched away, and
`!important` is load-bearing for the `.hdr nav [hidden]` reason: `.hdr nav
.dd a` sets `display:block` at higher specificity, as does the app menu's
Tailwind `block`. Presentation only — `/download` itself stays reachable.

**Users can also install from the site itself** (2026-08-20) — `desktop.js`
is the owner/dev door; the site is an installable web app (PWA).
`manifest.webmanifest` + `icon-192/512/icon-maskable-512.png` (all on the
`STATIC_FILES` allowlist, served without a session so the wall never blocks
install) make Chrome/Edge offer "Install CompNinja" from the address bar,
and index.html's footer carries an "Install the desktop app" button that
ships `hidden` and is revealed only by `beforeinstallprompt` — the
Buy-button rule: a control that can only fail (already installed,
Safari/Firefox) never renders. There is **deliberately NO service worker**:
installability no longer requires one, and a SW cache could serve
`/valuation.js` stale relative to index.html — the exact failure that
file's `max-age: 0` rule exists to prevent; `test/manifest.test.js` pins
that, the manifest fields, the icon sizes against their real PNG bytes, and
the allowlist entries. There is no installer to host or code-sign anywhere:
"where do users download it" is answered by compninja.co, and installed
copies update themselves because the app IS the live site. (A Microsoft
Store listing can wrap this same manifest via PWABuilder later; nothing
here would change.)

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
  **It is also the admin identity for comped Pro** — see "Admin access" below.
- `TESTER_PASSKEY` — optional shared passkey that comps Pro to a **signed-in**
  account (the beta-tester door). Unset = `POST /api/redeem-passkey` 404s and
  the pricing modal's "Have a code?" row never renders, so this is inert on any
  deployment that never configured it. **It is not `ADMIN_KEY`**: that key also
  unlocks `/admin`, `/dev` and `/contacts`, so it can never be the thing handed
  to testers. Redeeming sets `users.pro_tester` (migration 022), so the grant
  follows the ACCOUNT across devices, survives a passkey rotation, and is
  revoked one tester at a time with a one-row `update users set pro_tester =
  false where email = …` rather than by rotating the code for everyone.
  Rules live in `entitlements.js`, so `npm test` covers them; four of them
  matter. It grants **everything Pro, the broker vault, firms and bulk
  valuation included** (owner's call, 2026-09-01). Until then it withheld all
  three — the vault as a private-data workspace with an upload endpoint, firms
  as an endpoint that emails any address typed in, bulk as a spend fan-out —
  on the argument that a shared passkey is a bigger surface than "try Pro's
  reports"; what that produced was testers opening `/vault` and `/bulk` and
  reading the product as the free tier. The bounds that remain are the ones
  that were always doing the work: `BULK_DAILY_ADDRESSES` caps bulk spend per
  member per day, and revoking one tester is still a one-row UPDATE. (The
  door for handing a broker the vault WITHOUT comping Pro is still
  `VAULT_PASSKEY` / `users.vault_beta` — see the next bullet; that direction
  is unchanged.) It **cannot switch
  a dark deployment on** (`PRO_ENABLED` still wins, same as the admin branch).
  Its `status` is `"tester"`, never `"active"`, so the UI never offers a
  billing portal to an account with no Stripe customer. And unlike the admin
  branch it is **checked as a fallback after the subscription**, not as an
  early short-circuit: a tester who later subscribes gets their real Stripe
  status and their billing portal, and comped access resumes if that
  subscription lapses. A tester is also NOT the `internal` bypass in
  `/api/comps`, which stays header-only.
- `VAULT_PASSKEY` — optional shared passkey that grants the **broker vault**
  (and only the vault) to a signed-in account. It exists because
  `users.vault_beta` was set by hand in the Supabase SQL editor, one broker at
  a time, which put the owner in the loop for every onboarding — "hand three
  brokers a vault at a meeting" was a note-to-self rather than something that
  happened in the room. Redeeming sets the same `users.vault_beta` column
  (migration 023), so everything already true of that grant stays true:
  entitlements gives `broker`/`canUseVault` and **not one Pro report feature**,
  it cannot switch a dark deployment on (`PRO_ENABLED` still wins), it does not
  ride the subscription lapse rules, and revoking is the one-row `update users
  set vault_beta = false where email = …`.
  **It is a SECOND secret, not a widening of `TESTER_PASSKEY`**, and the two
  are independent — either can be set alone. The tester grant excludes the
  vault deliberately (see the bullet above), so folding the vault into that
  code would open a private-data workspace with an upload endpoint to everyone
  ever handed a try-Pro code. Two codes also keep the two audiences separately
  revocable: rotating one does not lock the other out. Setting them to the
  same string is a configuration mistake and the startup banner says so
  loudly (it is not fatal — a rotation closes it).
  **Both codes redeem through the same `POST /api/redeem-passkey` and the same
  input**, because someone handed a code should not also have to know which
  kind it is; the route compares against both secrets and its `granted` array
  names which door opened. The route 404s only when NEITHER is set. One
  behavior deliberately changed to make room for the second code: the
  idempotency check used to run BEFORE the secret compare, so an existing
  tester typing a rotated code was told "already" rather than "incorrect". It
  now runs after (the route cannot know which grant is claimed until it
  compares) and asks whether the account holds *everything this deployment can
  give* — identical behavior on a tester-only deployment, and pinned by tests
  in both shapes.
- `RESEND_API_KEY` — optional. When set, every stored lead AND every broker
  comp submission fires an email notification via Resend's REST API (plain
  fetch, free tier is plenty). Fire-and-forget: a failing provider is logged
  but never breaks the request. Caveat: without a verified domain Resend only
  delivers to the address that owns the Resend account, so the account must be
  registered with the notify address itself.
- `RESEND_API_URL` — **test-only**, defaults to Resend's real endpoint and is
  never set in production. It exists because the watchlist digest is the one
  feature whose entire point is an email leaving the building, and without it
  the suite could reach the send call and then had to stop and assume. With
  it, `test/watchlist-digest-run.test.js` asserts who was mailed and what the
  body said. Not a secret and authorizes nothing (`RESEND_API_KEY` still
  does), but it decides where mail is posted, so treat it as trusted config.
- `LEAD_NOTIFY_EMAIL` — where those notifications go; defaults to
  agouraninja@gmail.com.
- `EMAIL_FROM` — optional, e.g. `CompNinja <reports@yourdomain.com>`. The single
  gate for OUTBOUND mail (to leads and brokers, not the owner): a BOV lead gets
  a follow-up with their report share link, and a broker gets a confirmation
  after submitting a comp. Leave UNSET until a custom domain is verified in
  Resend — the free tier only delivers to the owner, so without it these sends
  log `Outbound email skipped` and silently no-op. Replies go to
  `LEAD_NOTIFY_EMAIL` (Resend `reply_to`).
- `DAILY_SEARCH_CAP` — optional (default 150). Hard ceiling on *billed*
  Anthropic searches per UTC day; cache hits don't count. On the (cap+1)th
  search the server returns 429 to visitors and emails the owner once (via the
  same Resend notifier). An in-memory counter reset at UTC midnight and on
  process restart — a backstop against a rotating-IP scraper the per-IP limiter
  can't stop, not precise accounting.
- `BULK_DAILY_ADDRESSES` — optional (default 200). Per-MEMBER ceiling on
  addresses bulk valuation may put through a search in one UTC day. A
  SEPARATE number from `DAILY_SEARCH_CAP` on purpose: that one is site-wide
  and Pro deliberately bypasses it (`countsDailyCap: !ent.pro`), an exemption
  written for somebody typing one address at a time. Bulk multiplies it by
  fifty per click — one run is ~17 minutes and ~$18, and with
  one-job-at-a-time as the only other bound a member could start another the
  moment it finishes, roughly $63/hour indefinitely. Charging bulk to
  `DAILY_SEARCH_CAP` instead was rejected: one 50-address run would eat a
  third of the site's daily allowance and lock out the free visitors that cap
  exists to protect. Counts rows that were ATTEMPTED (anything past `queued`),
  so cancelling a run costs what actually ran rather than what was queued;
  windowed on `created_at`, so a job straddling midnight counts wholly against
  the day it started. Fails OPEN on a read error — a paying member must not be
  locked out by one failed count, and the 50-address cap still bounds the
  damage. The remaining allowance rides on `GET /api/bulk` and the `/bulk`
  boot payload (`leftToday`/`dailyLimit`) so the form says it BEFORE a list is
  pasted, not only at the moment of refusal. Env-overridable because the
  moment it bites is the moment a real customer is blocked mid-workday.
- `SEARCH_API_URL` — **test-only**, unset in production, where the provider's
  own endpoint is the live value. `RESEND_API_URL`'s precedent for
  `RESEND_API_URL`'s reason: bulk valuation's whole point is fifty searches
  leaving the building, and without this the suite could reach the provider
  call and then had to stop and assume — everything from "a report came back"
  through valuing it, writing the row and putting it on the member's desk was
  argued in comments and never executed. `test/bulk-run.test.js` is the user.
  It covers the SEARCH call only; the extract vendor (PDF/screenshot import)
  keeps its own endpoint, so there is one override and one thing it can move.
  Not a secret and authorizes nothing (the API key still does), but it decides
  where a billed request is posted, so treat it as trusted config.
- `LOGO_IMPORT_ALLOW_PRIVATE` — **test-only**, unset in production. Lets
  `POST /api/branding/logo-from-site` fetch a loopback or private address,
  which the route's DNS guard refuses by design; `test/logo-import-run.test.js`
  stands its stub firm website up on 127.0.0.1 and could not reach the fetch
  path without it (the link check's suites route around the same guard by
  citing bot-walled hosts, which this feature has no equivalent of). Not a
  secret and authorizes nothing, but it switches off an SSRF guard, so treat
  it as trusted config the way `RESEND_API_URL` is.
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
- `GOOGLE_MAPS_API_KEY` — optional; SET on Render since 2026-07-29 (key
  "CompNinja Street View" in the owner's Google Cloud project `compninja`,
  restricted to the Street View Static API only). When set, map pin popups
  show a street-level photo of the building via `GET /api/streetview` (a
  proxy so the key never reaches the browser; Google's free metadata check
  runs first so no-imagery spots cost nothing). Unset = the route 404s and
  popups use the keyless stitched-Esri-tile aerial close-up (`aerialThumb`
  in index.html) — which is also what a Street View 404 swaps in via the
  img's onerror.
  **A pin only gets a photo at all when its OSM building footprint exists
  AND its address starts with a street number AND that street number names a
  whole property rather than one unit of it** (`snapMarkersToBuildings` —
  one batched browser-direct Overpass query per report after pins settle,
  two public endpoints tried in order, cached in localStorage
  `bldgCache.v2`): the footprint is the one signal proving the photo shows
  the property. Geocoded points sit on the street centerline, so every
  unsnapped aiming strategy (raw point, Google address geocode) produced
  photos of roads/trees on rural reports — owner's rule is "the actual
  property or nothing," so no footprint = text-only popup. The street-
  number gate exists because submarket-estimate comps ("Financial District
  (general submarket estimate)") geocode to a district point and several
  snapped onto the SAME building — one Boston report showed one white
  column three times. It is deliberately NOT the shape-lenient
  `isAggregateAddress()` in server.js, which protects corpus DATA where
  numberless comps are still valid rows.
  Two further gates, both added 2026-08-13 after a Boise mobile-home report
  photographed a bike shop 81 m up the street (same incident as the $795,000
  valuation — see flow 3 under "Non-obvious flows"). **The footprint must
  PROVE the address** (`addr:housenumber` + `addr:street`, via the existing
  `osmNumberMatches`/`streetLooksSame` written for the type detector's
  Phoenix "Mandarin Super Buffet" bug): proximity cannot tell two sides of a
  street apart, let alone a shop from the trailer park beside it. Where
  NOTHING in range carries a house number the map cannot answer and the
  main-mass pick stands, so coverage holds in the suburbs where photos work.
  Among several footprints that all prove the address (one building mapped
  in parts) it still takes the main mass — a photo of the wrong wing is
  still a photo of the right building, which is why this is the PHOTO's rule
  and not the size estimate's. **And `unitDesignatorOf()` refuses outright**
  for an address naming one unit of a site (`Trailer 51`, `Apt 3B`, `SPC 12`,
  `#45`): geocoders silently drop the unit — Census answered "6728 W
  Fairview Ave Trailer 51" with "6728 FAIRVIEW AVE" — so no footprint at
  that point is provably the subject's, and 38 of them shared that number.
  It gates comps too, because the model returns unit addresses of its own.
  Its vocabulary is tested in both directions (`test/index-html.test.js`):
  loosened, wrong buildings return; tightened, ordinary streets lose their
  photos, and "Roomy", "Lotus" and "United Nations" all parsed as unit
  designators on the first pass.
  `bldgCache` went to **v2** with these: the snap now depends on the
  ADDRESS, not just the pin, so a key of coordinates alone held one answer
  for every unit of a park — and the bump retires the wrong-building snaps
  already sitting in browsers, the same reason `geoCache` went to v2.
  Spend guardrails: Google Maps API quotas are NO LONGER user-adjustable
  (the spec's 500/day quota-cap step is obsolete) — the backstops are the
  "CompNinja Street View cap" $5/month budget alert on the billing account
  (emails the owner at 50/90/100%), the route's per-IP rate limit, and the
  10k-photos/month free tier (a fully-hovered report uses ~6).
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
- `STREAM_ANTHROPIC` — optional `on`/`off`, **default ON**. Streams the
  Anthropic call (`stream: true` + a hand-rolled SSE reader, `sseFrames` in
  server.js) instead of awaiting one JSON body. The parsed report is identical
  either way — the streaming branch rebuilds the text by concatenating
  `text_delta`s per block index and joining with `"\n"`, deliberately matching
  the non-streaming `content.filter(type==="text").map(.text).join("\n")` so
  `parseCompJson` sees the same input. Set it to `off` only to rule streaming
  out while debugging. **Careful if you touch the timeout**: with `stream:true`
  `fetch` resolves at the HEADERS, so `clearTimeout` must stay wrapped around
  the whole read loop or the call deadline silently stops guarding anything.
  The deadline is DERIVED per call (`searchTimeoutMsFor`: 30s slack + 10s per
  allowed search + 13ms per allowed output token — ~260s for a full 10-search
  10k-token report) so it always sits above the wall clock of a healthy call;
  a fixed constant was outgrown twice (100s, then 150s), and each time it
  aborted alive, already-billed calls into "took too long" errors.
  There is also a `STREAM_IDLE_MS` (30s) per-chunk watchdog, which only becomes
  possible once the response is streamed.
- **Live search progress** (no env var — always on for the browser). `POST
  /api/comps` **and `POST /api/explore-market`** take an optional `stream:
  true` in the body; when set, and only once the slow leg is actually about
  to run, the response switches to
  `text/event-stream` (`openSse` in server.js) emitting `progress` events then
  a final `result` (or `error`) event. **Everything fast or failed stays plain
  JSON with a real status code** — the password gate, both rate limiters,
  validation, and a 43ms cache hit — so the client chooses how to read the body
  from the response's `content-type`, *never* from the fact that it asked to
  stream. `gen-market-seed.js` simply omits the flag and is unaffected.
  Progress phases: `corpus` (coverage, before the call), `start`, `search`
  (n + the model's real query text), `results` (count), `writing`, `drafting`
  (chars, ~1/s), `comp` (one per finished comp as the model writes the array —
  `makeCompExtractor` in server.js scans the streamed text incrementally, and
  the handler's `guardComp` closure anonymizes events past the visitor's
  `maxComps` entitlement to `{ locked: true }` so gated comp identities never
  reach a free browser, even transiently), `retry`. Front-end:
  `readProgressStream` + `applyProgress` in index.html. Since 2026-08-09 the
  streamed events assemble the REAL report surfaces (`beginAssembly` /
  `assemblyComp` / `assemblySummary` / `resetAssembly`): the first `comp` or
  summary `field` event reveals `#results` with only the `data-assemble` cards
  visible (hero as a counts-only placeholder, never a dollar figure; summary;
  core-column comp table + "+ N more found · unlock with Pro" lock line),
  everything else hidden under `.asm-hidden` until `renderResults` repaints
  wholesale.
  Assembly never touches the `hidden` class except on
  `#results`/`#ownerHero`/`#loadingSkeletons`;
  every exit (result, error, `retry`) funnels through `resetAssembly` riding on
  `hideLoadingCard`. Three fallback layers, all
  load-bearing — the old wall-clock simulation still starts on submit and is
  cancelled by the first real event; a non-SSE content-type falls back to
  `res.json()`; and an 8-second silence watchdog restarts the simulation,
  which is what saves the card if Render's edge buffers the stream despite
  `x-accel-buffering: no`.
  **What the measurement showed** (worth knowing before optimizing anything
  here): the web searches finish in the first ~5 seconds; the model then spends
  **40-70 seconds writing the report**. Wall clock is roughly
  `4s x searches + output_tokens / 78`. Cutting *searches* therefore buys far
  less than it looks like it should — a corpus-strong 2-search run still took
  74s because it still had to write 4,700 tokens. **The lever is OUTPUT size.**
  Measured composition of a report: the `comps` array is 69-76% of it, and
  within that `notes` was by far the largest field (18-28% of the whole
  report, up to 466 chars on one comp), followed by `source_url` (~8-11%,
  not cuttable — it is the proof). Top-level, the four narrative fields
  (`summary`, `value_drivers`, `market_trend`, `price_discovery.note`)
  measured a combined 33% of one real report and got the same notes-style
  caps on 2026-08-03 (~450 chars / 80-per-entry / 140 / 200, banned
  patterns named, the summary's REQUIRED honesty caveats given a protected
  third-sentence slot — don't tighten further without protecting them
  again). Verified same day: summary 941 → 559, report 13% shorter.
  The comps array itself got compact encoding the same day: the model
  writes 1-3 char keys (`SHORT_COMP_KEYS`) and omits empty fields;
  `expandCompKeys` restores the long-keyed, ""-backfilled shape at parse
  time, so only the MODEL OUTPUT is smaller — every stored and served
  report keeps the classic shape. A new comp field needs a short key too
  (the add-comp-field skill has the step). Measured with caps + encoding
  together: a 7-comp report fell from 6,111 to 3,111 output tokens.
  `notes` is now capped in the prompt at two short sentences with the two
  real sources of bloat banned by name — the model narrating its own search
  ("Included as the nearest comparable found; details require CoStar") and
  restating fields that have their own columns. Result: average note
  139 → 104 chars, longest 188 → 115, report 13% shorter, price caveats
  preserved and promoted. Keep `max_tokens` generous — the cap is a quality
  instruction, and a low `max_tokens` would truncate the JSON mid-array
  instead.
  **FIELD ORDER is the other half of that lever** (2026-08-21). The model
  writes the JSON top to bottom, and `comps` is the only part the browser
  can paint while it is still writing, so every field above the array is
  dead air on screen. The shape now writes `summary` (the one field the
  loading card can show), currency, and the tiny subject lookups, then
  **`comps`**, then every market-level field — `avg_price_per_sqft`,
  `subject_lat`/`lng`, `market_cap_rate_range`, `market_opex_range`,
  `value_drivers`, `market_trend`, `annual_price_trend_pct`,
  `search_radius`, `transactions_reviewed`, `price_discovery`. That is
  ~800 characters (~200 output tokens, ~2.5s at the measured 78 tok/s) the
  live comp table no longer waits through, and it is a quality change in
  the same direction: every one of those fields is a read OF the comps
  (`avg_price_per_sqft` averages them, `transactions_reviewed` must exceed
  their count), so the model now describes rows it has committed to
  instead of rows it still intends to write. A new top-level field belongs
  BELOW `comps` unless the browser can render it mid-stream or a later
  figure depends on it; `test/routes.test.js` evaluates the taught shape
  and fails the build otherwise.
  Also dropped that day: `price_per_sqft` on any SALE comp carrying both a
  price and a size. `reconcilePricePerSqft` already derived that number
  server-side and already overrode the model's figure when the two
  disagreed by more than 10%, so the field was tokens spent restating
  arithmetic. The source cross-check it was really performing survives as
  a prompt instruction; the field is still asked for where it is NOT
  derivable (lease rates, and sales missing a price or a size). One
  consequence: `psf_reconciled` now fires only on a real CORRECTION, never
  on a fill, because a "calc" mark on every row would drain the meaning
  out of a mark that says "we did not trust the figure we were handed".
  **The default provider streams too, since 2026-08-29.** Gemini's wire
  format was confirmed live that day with
  **`node scripts/verify-gemini-stream.js`** (~$0.001 a run; plain and
  `--grounded`), and the first run FAILED — the real stream is
  `event_type`-tagged frames (`interaction.created`, `step.start`/`.delta`/
  `.stop`, `interaction.completed`), not the `{steps:[...]}` snapshots the
  reader was guessed from — which is exactly why it shipped dark behind a
  verifier instead of guessing on the default path. The reader was rewritten
  from the frames the script printed; the captured frames are committed as
  `test/fixtures/gemini-stream-frames*.json` and replayed by
  `test/search-provider-gemini.test.js`, the new ground truth. Keep the
  script: it is how a vendor-side frame change gets diagnosed, and how a
  future provider earns `streaming: true` the same way. The
  `STREAM_UNVERIFIED` env opt-in and `capabilities.streamingUnverified` are
  deleted, not just off — a test pins the flag as GONE so the branch cannot
  quietly return. **Reading a stream lives behind
  the provider seam**: `PROVIDER.createStreamReader()` takes one decoded SSE
  frame and returns normalized events (`start` / `text` / `results` /
  `search` / `usage` / `error` / `done`), and owns rebuilding the final
  text. server.js's read loop names no vendor event type. The rule that
  makes it safe, and the first test this code ever had: a reader's `text()`
  must be **byte-identical** to what that provider's `parseResponse()`
  produces from the equivalent non-streaming body, or `parseCompJson` sees
  different input depending on a setting nobody thinks about. (One
  deliberate asymmetry survives: streamed Gemini calls emit real `search`
  events — the `google_search_call` delta carries the model's query strings
  — while `parseResponse` still honestly reports `searches: 0`, because the
  non-streaming body has nothing to count them from.) The request FORM
  needs `?alt=sse` **and** `stream: true`; either alone silently returns
  ordinary JSON. Three traps the reader guards, all test-pinned: a re-sent
  cumulative snapshot must REPLACE rather than append (appending duplicates
  the whole report, which still parses and is wrong — the worst failure
  available); only newly-arrived characters may be emitted as `text`
  events or the comp extractor re-scans and double-counts every comp; and
  report text is harvested ONLY from a `model_output` step's deltas, so a
  thought delta that one day carries text can never leak reasoning into
  `parseCompJson`'s input. And thought tokens count toward OUTPUT there: a
  measured call spent **4,207 in / 928 out / 6,473 thought**, so the report
  JSON is about one eighth of what the model generates and reasoning is the
  other seven eighths. That makes `THINKING_LEVEL` (see its bullet under
  Configuration) a larger wall-clock lever than everything in the report
  JSON put together — and makes it the one to MEASURE first, since Google's
  guidance calls the default depth the best quality for agentic work.
  The Explorer reaches the same rule from the other side: its cache lookup
  lives inside the shared in-flight job, so it cannot decide up front whether
  the request is fast. Its SSE opens on the FIRST progress event instead, and
  a cache hit (which emits nothing) therefore answers as plain JSON with no
  special-casing. `exploreInFlight` carries a listener set and a bounded
  replay log so two visitors sharing one billed search both see it.
- `PARALLEL_SEARCH` — optional `on`/`off`, **default OFF**. When on, a report
  search that would run a 6+ search budget is split into two CONCURRENT
  Anthropic calls (`LANE_GUIDANCE` in server.js): a `primary` lane that starts
  from brokerage/listing sources and owns every market-level figure and all
  narrative, plus a `records` lane that starts from news/press/public records,
  returns comps + the subject-size lookup only, and is folded in by
  `mergeLaneReports` (address-normalized dedupe, interleaved so the slice to
  `maxComps` can't drop one lane's provenance wholesale, currency-mismatch
  guard). The records lane is additive and never retried — if it fails the
  report still renders from the primary lane.
  **Why it is off**: measured 2026-07-30 against a same-address control
  (Indianapolis Industrial), the split ran 81.7s → 47.0s (42% faster) but
  returned 3 comps instead of 4; on a dense market (Dallas) it returned a
  healthy 8 comps with a better provenance mix but saved almost no time,
  because wall clock is the SLOWER lane. A single deep call steers its later
  searches at the gaps it knows it still has; two shallow lanes rediscover
  the same easy comps. Re-measure on real traffic before flipping it on.
  Each search logs `Anthropic call [lane]: Ns · N search(es) · N out / N in
  tokens`, which is how any of this gets re-measured.
- `LEAD_METRO` — optional `on`/`off`, **default ON**. Matches broker lead
  coverage across `market.js`'s curated `METRO_GROUPS`, so a Boise-covering
  broker sees Meridian leads. Reads the same table as `CORPUS_METRO` and is
  switched separately on purpose — one decides which comps a search may draw
  on, the other decides who sees a stranger's enquiry, and rolling back one is
  no reason to roll back the other. `off` restores exact-market matching in
  the inbox, the intro gate and the new-lead alert together. Rules live in
  `broker-leads.js`, so `npm test` covers them.
- `NAV_SHELL` — optional `rail` (**default**) or `bar`, added 2026-08-28. Which
  shape the SIGNED-IN chrome takes on every server-rendered page. `rail` lays
  the header out as a persistent 224px left sidebar at **900px and up**; `bar`
  is the horizontal header exactly as it shipped before that date, and is the
  instant rollback lever. An unrecognized value **exits at boot** (the
  `SEARCH_PROVIDER` / `THINKING_LEVEL` no-fallthrough rule).
  **It gates ONE CSS class on `<html>` and nothing else.** The rail is not a
  new component: every surface already renders the same header shape — brand,
  `<nav>`, account slots, in a centered container — so the rail is that same
  element re-laid-out, and **the markup is byte-identical in both modes**.
  `test/nav-shell.test.js` diffs the two renders to hold that, because the
  moment a second markup branch appears the eight-page header assertions in
  `routes.test.js` are only checking one of them. Never grow one.
  **No content wrapper moves.** `.wrap` keeps its own `margin:0 auto`, so with
  the body padded on the left every centered band re-centres itself — measured
  on `/markets`, where `main` lands 1120px wide beside the rail with nothing
  else edited. The 224px width is a **literal**, never a `var()`: `theme.js`
  holds colours, and `theme.test.js` fails any custom property that is not one
  of its tokens.
  **Below 900px the class does nothing** and the wrapping bar returns. That is
  the whole mobile answer — no drawer, no focus trap, no scroll lock.
  **Anonymous visitors never get it** (it marks being inside the product, and a
  marketing page read by a stranger is not that); it is decided on cookie
  presence, and those routes already send `vary: cookie`. Cookie presence is
  not the same question as "is this session still valid", so BOTH shells
  retire the class once the account read answers: `refreshAccountUI()` in the
  app, `ACCOUNT_NAV_JS` on every server-rendered page. Removed only, never
  added — a member's copy is stamped before first paint and must not flicker
  in after it. The rules live in **one** const, `RAIL_CSS`, interpolated by
  `MARKET_CSS` and `HOW_CSS` — and since 2026-08-30 that is the whole list:
  `/vault` was briefly a third consumer, taking `RAIL_CSS`, `FOOTER_LINK_COLS`
  and `FOOTER_LINKS_CSS` through a chrome object because it drew its own
  document, and Task 9 folded it onto `marketShell` so it gets all of them the
  way every other page does. `FOOTER_LINK_COLS` / `FOOTER_LINKS_CSS` remain
  extracted, now with `MARKET_FOOTER` and the two stylesheets as their
  consumers.
  **The app draws its own half of this shell, and the two must agree.**
  `index.html` is not rendered by `marketBar`, so every rule above has a second
  implementation in that file's `<style>` and markup, and the whole class of
  bug here is a difference between them: a row named one thing on one side and
  another thing on the other, a control that is a row here and a modal setting
  there, a current-page highlight only one of them writes.
  `test/nav-parity.test.js` reads both files together and exists for exactly
  that; `test/nav-shell.test.js` pins that the rail exists at all. The rules
  that fall out of it: the app writes `aria-current` from `markNavCurrent()`
  (ONE writer, called from all four seams that change which view is showing —
  the two report seams included, since assembly yields the workspace a minute
  before `renderResults` repaints); every nav row is a real link on both sides,
  so `#myDeskLink` is an `<a href="/desk">` whose handler stands aside for a
  modified or middle click; `/` and `/desk` both serve the workspace, so
  neither rewrites the URL into the other; **the theme toggle is a nav row on
  NEITHER** (owner's call, 2026-08-30 — it was a row on both for one morning,
  which fixed the old asymmetry the wrong way round; dark mode is one
  preference, so it gets one control, `#themeToggleApp` in `index.html`'s
  settings panel, and `accountNavSlots` renders no toggle, no moon/sun CSS
  and no toggle handler — one hand-copy fewer, since `THEME_BOOT` alone is
  what every page needs in order to APPLY a stored choice); and the settings
  panel, which lives only in `index.html`, is reachable from every account
  menu through `/desk?settings=1` — a query the wall can see, read and
  cleared exactly as `?pricing=1` is. **A signed-out visitor has no account
  menu and now no toggle either**, so the wall exempts a bare `/?settings=1`
  (never `/desk?settings=1`, which stays a personal workspace) and the panel
  opens for them showing its two account-free rows, appearance and plan.
  Nothing in the chrome points there: it is the escape hatch for a browser
  that stored `dark` and would otherwise have no way back to light. Choosing
  a theme is a member affordance now.
  Two things moved because the rail forced them: the Explore `<details>` has
  nowhere to open in a 224px column so it is hidden there and **its links moved
  to `MARKET_FOOTER`** (which finally puts `/download` in a footer at all — it
  had been in the Explore menu and in neither footer), and **Markets, Vault and
  Bulk became nav destinations**. `/bulk` previously had NO link anywhere on
  the site: not a menu, not a footer, not a header, only a link from inside
  itself. `#navVault` moved out of the account dropdown to join them, so a hub
  — which builds its header from `accountNavSlots` and not from `marketBar` —
  no longer shows a vault link.
  **The red "Run a report" CTA is dropped on the four pages a member is
  WORKING IN** (owner's call, 2026-08-30; `CTA_FREE_PAGES` above `marketBar`,
  pinned from both sides in `test/routes.test.js`): `/vault`, `/markets`,
  `/1031-exchange`, `/bulk`. A broker mid-task is not deciding whether to run
  a report, so there the button is a nag for a different task; every other
  server-rendered page keeps it, because those are where somebody is still
  deciding. Two things it is NOT. It is not a way home — that argument
  (2026-08-28/29) is unchanged, the way back is the **Workspace** row, and it
  is the only reason dropping the button strands nobody, so a future edit that
  suppresses Workspace on these pages must put the CTA back. And a market
  DETAIL page (`/market/<slug>`) keeps it: it passes no `current`, it is a
  browse surface reached FROM the explorer, and it already carries its own
  "value a property here" form. Keyed on the same paths the nav rows point at,
  so "the row you are standing on" and "the page that drops the CTA" cannot
  become two lists.
- `SITE_URL` — optional. Public URL used in `robots.txt`/`sitemap.xml`; defaults
  to the Render URL. index.html's canonical/`og:url`/JSON-LD tags are written
  against the default origin and rewritten to `SITE_URL` at serve time, so
  moving to a custom domain is a single env change — no HTML edits.
- `GOOGLE_SITE_VERIFICATION` — optional. The token from Google Search Console's
  **HTML file** verification method; accepts the whole `google<token>.html`
  filename or the bare token. Set, the server answers that exact path with the
  line Google expects and logs the live path at startup; unset, the route does
  not exist. **The file method, not the meta tag, on purpose**: meta-tag
  verification fetches the property root, and when this shipped `/` was a 302
  under `ACCOUNT_WALL`, so a tag placed there was never seen and verification
  failed with no stated reason. `/` answers 200 now (the landing page), but
  the file method stays — it is auth-independent by construction and Google
  re-checks it forever, so it must never ride on what `/` happens to serve.
  This path is its own route and the wall never touches
  it (the static handler is an allowlist). A DNS TXT record reaches the same
  place and is better where there is registrar access — it covers every
  subdomain and survives any redirect; the two do not conflict. **Keep the var
  set for good** — Google re-fetches the file and unverifies the property if it
  stops answering. Search Console is the only view of whether the ~38 market
  pages in `sitemap.xml` are indexed at all; `analytics_events` only ever sees
  people who already arrived.
- `PRO_ENABLED` — optional `on`/`off`, **default OFF**. Master switch for the
  paid Pro tier. Off means the app behaves exactly as it did before the tier
  existed: no comp gating, no export cap, no lookback limit
  (`computeEntitlements`' `enabled: false` branch returns
  `maxComps: "all"` / `exportsRemaining: "unlimited"` and skips every billing
  read, so the flag costs nothing on the hot path). **Do not turn this on
  before running the Pro DDL** in `migrations/008-pro-billing.sql`
  — and note the billing tables have **no file fallback** by
  design, so `PRO_ENABLED=on` without Supabase configured resolves every
  visitor to the free tier and logs a `⛔` line at startup.
- `PRO_AUDIENCE` — optional comma-separated email allowlist narrowing **who**
  `PRO_ENABLED` applies to. Unset (the launch setting) means everyone. Set, it
  means only those *signed-in* accounts are gated and only they can reach
  `/api/checkout` and `/api/billing-portal`; every other visitor, anonymous
  included, takes `computeEntitlements`' `enabled: false` branch and sees the
  pre-Pro app. It exists so the paid tier can be proven against the live
  deployment without gating real traffic or exposing a test-mode checkout — the
  Stripe test card numbers are public, so an open test window lets a stranger
  take a genuine subscription row for free. Three rules: `PRO_ENABLED` is still
  the master switch (`proEnabledFor()` is the AND of both); the **webhook is
  deliberately not audience-scoped** (it has no user and must keep writing rows
  or a test proves nothing); and **unsetting it is the launch** — left set, the
  product is live but unbuyable and the deployment looks perfectly healthy,
  which is why startup logs it loudly. Rules live in `entitlements.js`
  (`parseAudience` / `inAudience`), so `npm test` covers them.
- `SEARCH_PROVIDER` — optional `gemini` (**default since 2026-08-10**) or `anthropic`. Picks which
  vendor runs the comp search. An unrecognized value **exits at boot** rather
  than silently falling back, the same no-fallthrough rule `/api/checkout`'s
  `PLANS` map follows. `MODEL` still overrides the chosen provider's default
  model, so existing `MODEL=` deployments are unaffected. Gemini authenticates
  with `GEMINI_API_KEY` and needs a **paid-tier** Google project: search
  grounding 429s on the free tier, and the error names no project. Gemini
  cannot cap its search rounds (`google_search` takes no `max_uses`), so
  corpus-first retrieval remains a quality lever there but stops being a cost
  lever. Server code must branch on `PROVIDER.capabilities.*`, never on
  `PROVIDER.name`.
  **`GET /healthz` reports the live `provider`, `model`, `commit` and
  `started`** — ask the deployment, never the repo. `commit` is the deployed
  SHA (`RENDER_GIT_COMMIT`, falling back to a `.git` read locally, `""` when
  unknown) and it is how a deploy is verified from outside when the change has
  no anonymous-visible byte — a server-side rule, a budget, a cache decision.
  Grepping a served page proves nothing for those, and on 2026-08-09 two
  deploys failed back to back while every page answered 200. `MODEL` is read once at startup from an env var
  nobody can see from here, and a provider's `defaultModel` moves with the
  code, so a checkout only proves what the source says. The Gemini default is
  `gemini-3.7-flash` (moved from 3.6 on 2026-08-13). Rollback is
  `SEARCH_PROVIDER=anthropic` or `MODEL=gemini-3.6-flash`.
- `THINKING_LEVEL` — optional `low`/`medium`/`high`. **Production runs
  `low`** as of 2026-08-22, set in Render's environment rather than in code,
  so rollback is unsetting it with no deploy. Unset means the request is
  byte-identical to what it was before this knob existed and the vendor's own
  default applies (`medium` on gemini-3.7-flash).
  **It is the largest wall-clock setting this deployment has**, and the
  reason is that on Gemini thought tokens are generated and billed as
  OUTPUT: a measured call spent 4,207 in / **928 out / 6,473 thought**, so
  about seven of every eight tokens the model produces are reasoning and
  only one in eight is the report. Every trim to the report JSON is
  attacking that one eighth; this is the other seven.
  **It was measured before it was set** (four runs, ~$1.36, full record in
  `docs/evals/2026-08-22-thinking-level-decision.md`). `low` made reports
  **3x faster (34.3s → ~10s) and 3x cheaper ($29.56 → ~$9.50 per 1,000)**,
  and every delta is 3-5x the run-to-run noise floor. It returned about a
  third fewer comps — but the shorter list was BETTER sourced: provenance
  up, market match up, and the unsourced-`estimate` rate down from as high
  as 14% to **2%**, the best this eval has recorded. Valuation stayed
  possible on 100% of targets in every run, and 8 of 10 kept enough priced
  sales (4+) for the hero's trimmed band. The cost paid is real and worth
  knowing: ~20% of reports fall back to a full-spread value range, and the
  comp table is visibly shorter.
  **Two things to re-check on real traffic**, both in that record: the 2%
  estimate rate is the prize, so a climb means re-running the comparison;
  and comp counts should drift back UP on their own as the radius blend
  folds saved corpus deals into new reports.
  **`COMP_FLOOR` was the attempt to buy those comps back, and it failed** —
  see its own note in server.js. It moved comps by less than the arm's own
  wobble while more than doubling the estimate rate, and `thoughtTokens`
  went 0 → 309: telling a model you have deliberately told to reason less to
  "try harder" spends the saving on deliberation, not on searching. Kept in
  the tree and off, because a recorded negative result is worth more than a
  deleted one.
  **`node scripts/compare-thinking.js` runs that whole pair as one command**
  (boot → score → restart at the candidate depth → score → compare). Prefer
  it over doing the steps by hand: it spawns the server with an EXPLICIT
  env, which makes the PowerShell `$env:SUPABASE_URL = ""` delete-vs-empty
  trap in run-eval.js's header impossible rather than merely documented; it
  enforces the restart, refuses to run against the main checkout, verifies
  via `/healthz` that the server is at the depth asked for BEFORE spending,
  and prints the bill and stops without `--yes`.
  The run summary records `thinkingLevel` beside `model` and `--compare`
  prints it, so a pair that differs only in this can never be misread as
  model noise. The scorecard also carries **spend** as of 2026-08-21 —
  `costUsd`, `billedCalls`, `inputTokens`, `outputTokens`, `thoughtTokens`,
  `reportTokens`, `thoughtShare` — because until then it measured quality
  and wall clock and nothing about cost, which is the half of this question
  that decides it. Those ride on a `_call` block that `gate()` attaches for
  an INTERNAL caller only and only on a billed leg: never cached, never
  harvested, never served to a customer, and absent (not zero) on a cache
  hit, so a run that hit the cache reports "no cost data" rather than
  halving its own average. `thought_tokens` is a **subset** of
  `output_tokens`, never an addition — summing them double-counts the
  thinking and doubles the bill; `reportTokens` is the remainder, and it is
  the figure every prompt trim in this project has actually been aiming at. `GET /healthz` reports the live value for the same reason it
  reports `model` — ask the deployment, never the repo; `""` there means the
  vendor default, and an absent field means a build older than this.
  Three rules, all pinned by tests. It is read through
  `PROVIDER.capabilities.thinkingLevels`, never a provider name. An
  unrecognized level **exits at boot** (the `SEARCH_PROVIDER` /
  `/api/checkout` `PLANS` no-fallthrough rule). And a level set against a
  provider that declares `thinkingLevels: null` — Anthropic, which has no
  tunable depth on this path — **also exits at boot** rather than being
  accepted and dropped: a knob that appears to work and changes nothing is
  worse than either a working knob or a refused one, because the deployment
  would conclude that thinking less does not help. Lowering it only ever
  generates fewer tokens, so Gemini's `deadlineTokens()` ceiling stays safe
  in the one direction this moves.
- `PORT` — defaults to 3000. Hosts set this themselves.

### Admin access — comped Pro for the team

There is **no admin user** in this codebase: `ADMIN_KEY` is a shared secret
typed into `/admin`, `/dev` and `/contacts`, and `users` has no `is_admin`
column. So "is this an admin?" is answered by **possession of that key**, which
`isAdminRequest(req)` reads two ways:

1. the **`x-admin-key` header** — how machine callers have always identified
   themselves (`gen-market-seed.js`, the dashboards' own fetches); and
2. the **`cn_admin` cookie** — how a browser carries it. The dashboards keep the
   key in `sessionStorage`, which is scoped to **one tab**; `POST
   /api/admin-access` trades the key for this cookie, and all four dashboards
   (`/hq`, `/admin`, `/dev`, `/contacts`) plus `/admin/heroes` call it (`grantAdminAccess()`) the
   moment their own key check passes. Since 2026-08-04 **every dashboard
   endpoint accepts the cookie** (via `isAdminRequest`) as an alternative to
   the header, so a new tab within the 30-day cookie window opens unlocked
   without retyping the key — each page's loader silently tries a keyless
   fetch before showing the gate. In a cookie session `/hq`'s CSV links are
   plain hrefs (the cookie rides along); `?key=` survives on the CSV routes
   and `/api/stats`/`/api/admin/submissions` for machine callers only.

The cookie is **not the key**: it is `<expiry ms>.<HMAC-SHA256(expiry,
ADMIN_KEY)>`, httpOnly, 30 days. It cannot be turned back into the key, and
rotating `ADMIN_KEY` invalidates every cookie ever issued. `index.html` never
holds a secret to get Pro.

Four rules, all in `entitlements.js` and covered by `npm test`:

- **It requires a signed-in account.** A key identifies a machine, not a person,
  and the rule is that admins get Pro *when they sign in*. An anonymous request
  holding the key takes the ordinary free path.
- **It cannot switch a dark deployment on.** `getEntitlements` only takes the
  admin branch when `proEnabledFor(user)` is true, so `PRO_ENABLED=off` still
  means the pre-Pro app for everyone, staff included.
- **`status` is `"admin"`, never `"active"`.** The UI decides whether to offer
  the Stripe billing portal off `status !== "none"`; reporting a Stripe status
  would send a comped account to a portal that 400s. `/api/config` also carries
  `pro.admin` so the plan card can say "Pro — comped (team)".
- **It is NOT the `internal` bypass.** `/api/comps` has its own header-only
  `internal` check that skips comp gating, the lookback clamp and the daily
  search cap for the seed generator. That stays header-only on purpose — a
  cookie must never widen a bypass a browser was not meant to have.

`POST /api/admin-access {clear:true}` drops it again, which is what the "View as
a free user" button on the plan card does. Keep that button working: the team is
permanently on the far side of the paywall, so it is the only way anyone
internal ever renders one.

This is not the only comped-Pro door: `TESTER_PASSKEY` (above) comps Pro to a
signed-in account without any dashboard access, and stores the grant on the
user row rather than in a cookie. Admin wins outright and skips the billing
reads; a tester deliberately yields to a real subscription.

There is also one comped-VAULT door, **`users.vault_beta`** (migration 023,
2026-08-11) — the broker-onboarding grant. It exists because neither existing
door could ever be handed to a real broker: the tester passkey deliberately
excludes the vault, and `ADMIN_KEY` also unlocks the dashboards. Rules in
`entitlements.js`, covered by `npm test`, and deliberately narrow: it grants
the broker surfaces only (vault, lead inbox, blended comps —
`broker`/`canUseVault`), never Pro's report features; it cannot switch a dark
deployment on (`PRO_ENABLED` still wins); and unlike everything else
vault-shaped it does NOT ride the subscription lapse rules — the grant was
never billing, so only the one-row UPDATE revokes it, and a beta broker whose
trial subscription lapses keeps their book.

**Two ways to set it**, and the column is the same either way:

1. by hand, `update users set vault_beta = true where email = …` — still the
   right tool for one specific account, and the only tool for revoking; and
2. **`VAULT_PASSKEY`** (2026-08-13), a shared code the broker redeems
   themselves at `POST /api/redeem-passkey`. This is the one to reach for
   when access is being handed out in person: the SQL path made every
   onboarding wait on the owner opening the SQL editor later, which is the
   wrong shape for the channel the product actually grows through. See the
   `VAULT_PASSKEY` bullet under Configuration for why it is a separate secret
   from `TESTER_PASSKEY` and what changed about the redeem route's
   idempotency ordering to fit two codes on one input.

`MODEL` is set in `server.js`, overridable by a `MODEL` environment variable (unset in production, so the constant is the live value). If the API returns a
404 for the model, list available models via `GET https://api.anthropic.com/v1/models`
with the key and update the constant — an earlier model ID was retired.

**Measuring a model or prompt change** (2026-08-09, contamination doors closed and a database refusal added 2026-08-10). `run-eval.js` puts the 12 fixed targets in `eval-set.json` through real searches and scores each report with the pure, tested `eval-score.js` (priced sale comps and whether a valuation was possible at all, provenance weighted with `valuation.js`'s own `TIER_WEIGHT`, aggregate-address and out-of-window and off-market rates, narrative lengths against the 2026-08-03 caps, wall clock). It is a SCORECARD, not an assertion suite: nothing has a pass/fail threshold, because a dozen stochastic searches are noisy, and the product is `--compare` between two runs. Summaries land in `docs/evals/`, timestamped in the filename so a same-day, same-label rerun can never silently clobber a possibly-good baseline (committed, so history accumulates); raw reports go to the git-ignored `eval-runs/`. Several things make it trustworthy and must not be undone. The run sends `fresh: true`, an internal-only flag that skips BOTH cache read paths (the exact hit and the derivable-window one), because a cached report would score the model that wrote it and report a false "no difference". Before every run the runner also wipes two local files and records both in the summary: `comp-corpus.jsonl` (`corpusWiped`), because `corpusRowsForMarket` reads that file fallback even with no database configured, so a previous run's harvest would otherwise hand the next run corpus coverage and a smaller search budget; and `subject-sizes.json` (`subjectSizesWiped`), because no eval target supplies `subjectSizeSqft`, so a previous run's building-size lookup would otherwise be found by `findKnownSubjectSize`, again shrinking the search budget and also silently backfilling `subject_size_sqft` regardless of what the run's own model did. The subject-size wipe is not the whole fix: `findKnownSubjectSize` also keeps an in-memory `subjectSizesMem` Map that a file delete cannot clear, so **the server must be restarted, not just have its files wiped, between two runs that are being compared** (the corpus read hits disk on every call with no in-memory layer, so it does not need this). A model comparison already forces a restart because `MODEL` is read once at server startup; this restart rule mainly matters for an A/A run pair meant to measure noise, where nothing else would force one. Before spending anything, the runner also probes the target with `GET /api/stats` (the admin key) and reads `introRequests.db`: a confirmed `true`, a failed probe, or the field simply missing all refuse the run and name the risk, because isolation (`SUPABASE_URL` blank on the server under test) is enforced only by however that server was launched, and a database the runner can see is a database it would both write into and read stale corpus coverage from; only a confirmed `false` proceeds. `EVAL_SKIP_DB_CHECK=1` is the deliberate override for someone who has already verified the database really is disposable. And the runner must target a server started from a separate worktree with `SUPABASE_URL` blank, so every write lands in that worktree's own fallback files instead of production's corpus, market pages, and cache: on Windows this is a documented trap, because in PowerShell `$env:SUPABASE_URL = ""` DELETES the variable rather than emptying it, so server.js's `.env` loader (which only fills vars that are `undefined`) silently restores whatever the worktree's own `.env` holds. Copy ONLY the `ANTHROPIC_API_KEY` line into the eval worktree's `.env`, never the whole file, and prefer a `node -e` launcher that sets `process.env.SUPABASE_URL = ""` (and `SUPABASE_SERVICE_KEY`) explicitly before requiring `./server.js`. A full run costs about $4.30, a model comparison about $8.60. The accuracy backtest (`/api/accuracy`) is the other half of the picture and answers a different question: it scores the reconciliation math over comps already harvested, never what a search found.

## Architecture

```
Browser (index.html)  --POST /api/comps-->  server.js  -->  Anthropic Messages API
        ^                                       |              (+ web_search tool)
        +-------------- JSON comps --------------+
```

**`server.js`** — zero-dependency Node HTTP server. Routes:
- `POST /api/comps` — the core endpoint. Enforces the password gate (if set),
  builds the prompt, calls Anthropic with the `web_search` tool enabled, and
  returns parsed JSON. **Its two halves are module-level functions, shared
  with the bulk worker since 2026-08-21**: `runCompSearch()` (cache →
  derivable window → daily cap → size memo → corpus retrieval → the billed
  call, plus every side effect that must see the UNGATED report) and
  `finishReportForViewer()` (the old `gate()` closure). Nothing about
  either changed in the move, and the ordering rules inside them are
  pinned by source-scanning tests that name them. Body takes optional `maxComps` (allowed 4/6/8/10/12,
  default 12 — the Explorer/seed pipeline stays pinned at 8) and optional
  `subjectSizeSqft`; when absent the prompt also asks the model to look up
  the building's size (returned as `subject_size_sqft` +
  `subject_size_source`) and `max_uses` rises 8 → 10 to budget the lookup
  (6 → 8 for a ≤8-comp ask). Body also takes optional `subjectDetails` — the per-type
  facts about the user's own building (see flow 4), whitelisted by
  `sanitizeSubjectDetails` against that type's `TYPE_COMP_FIELDS` keys and
  shown to the model so comp selection matches the subject. Every response carries `market_cap_rate_range`,
  `value_drivers`, `market_trend`, and a per-comp `source_type` that the
  server normalizes onto its enum (unknown → `estimate`, so badges can
  under-claim provenance but never over-claim). Normalization also ENFORCES
  the prompt's individual-property rule: a comp whose address lacks a
  leading street number, or that names a statistic
  (`isAggregateAddress`), is forced to `estimate` no matter what the model
  claimed — thin markets make the model pad with submarket rows despite
  the prompt telling it not to, and prompt rules are requests while
  normalization is a guarantee.
  **Market-page cross-link (2026-08-20).** Every served report also carries
  `market_page` (`{ slug, market }`) when a standing `/market/<slug>` page
  covers the subject's market + type — attached at SERIALIZATION inside
  `gate()` via `marketPageInfo()` (pure in-memory reads of the loaded page
  stores, so it costs nothing and a page published later lights up older
  cached reports), never written into the cache. index.html renders it as
  the "See the {market} market page →" line under the Market Summary
  (`renderMarketPageLink`; `no-print`/`no-capture` — navigation, not report
  content). The reverse door is the market page's own CTA: a "value a
  property here" mini-form (`vform` / `MARKET_VALUE_FORM_JS`) that stores
  the typed address under `pendingLandingAddress.v1` — the landing form's
  exact mechanism, already consumed at startup — and navigates to
  `/?type=<type>` (member) or `/?auth=signup&type=<type>` (anonymous, the
  wall-honored door). The same `marketPageInfo` decorates `GET
  /api/portfolio` items and the watchlist feed, so My Desk links each saved
  property and watched market to its market page.
  **"Verified" is a reserved word (2026-08-10).** It names a badge only the
  server awards (a broker vouched, our team reviewed), so the model must
  never write it. Two layers, the same requests-vs-guarantee split: the
  `verified` field is **only in the comp shape when broker comps were
  actually offered** (`hasVerified` in `buildPrompt`) — with none offered it
  could only ever be false, and asking for it made the model award itself the
  badge, measured live at 4 of 5 comps on a market with zero submissions; and
  `scrubUnearnedVerifiedClaims` (pure, tested, in report-parse.js) rewrites
  the verified word family in `summary`/`value_drivers`/`market_trend`/
  `price_discovery`/comp `notes` whenever the finished report carries no
  verified comp. `enforceVerifiedFlags` always kept the BADGES honest; what
  was broken was that nothing revisited the prose the model wrote around
  them, so a summary described verified comps while every badge read
  Estimate/News/Listing. Three rules: the scrub is **outermost** in
  `finishReport` because it counts the FINAL flags (inside
  `attachVerifiedAttribution` it would read the model's own claims); it fires
  **only at zero** verified comps, since one real badge makes the word
  accurate; and it **rewrites rather than deletes**, because cutting a clause
  can take the summary's required honesty caveat with it. Keep the summary
  rule's own caveat examples free of the word too — they said "scarce
  verified data" and contradicted this rule on the same prompt.
  **Source-link check (2026-08-09).** After the
  report is parsed and normalized, and before the cache write, harvest, market
  snapshot, and the `gate()` funnel, `applySourceLinkCheck` (server.js) checks
  each comp's `source_url`: max 12 unique URLs in parallel under one 2.5s
  budget, HEAD with a GET-on-405 fallback, redirects never followed (one hop
  could steer past the DNS guard; a 3xx counts as live), DNS resolved first and
  private/loopback answers refused (the URLs are model-supplied, so this is an
  SSRF guard, not a nicety). Rules live in the pure, tested **`link-check.js`**:
  bot-walled hosts (loopnet, cityfeet, propertyshark, commercialsearch, costar,
  crexi, zillow, redfin, realtor) are never fetched and never demoted; only
  DNS-gone/404/410 count as dead; a dead-linked comp is demoted to `estimate`
  (dead at birth usually means the citation was never real), keeping its
  `source_url` as the audit trail; broker-`verified` comps are exempt. It runs
  inside `getComps`, so the Explorer inherits it and the served report, cache,
  corpus, and shares all agree; the backtest and corpus retrieval need no
  changes because `estimate` is already excluded from both. Fails open on any
  error. Counts ride a `link_check` analytics event packed into the `source`
  column (the analytics schema is fixed). Link rot on existing corpus rows
  deliberately does nothing; the sweep is deferred (see the spec).
  **Cached**: identical requests
  within a 30-day TTL (7 days until 2026-08-03 — widened as a cost lever) are
  served from the `search_cache` layer (Supabase table
  `search_cache`, keyed by a SHA-256 of address+type+note+window+size+a
  signature of the offered verified comps — so approving a broker comp busts
  the cache for that type — plus a signature of `subjectDetails`, appended only
  when non-empty so pre-existing cache entries keep their keys; in-memory Map +
  file fallback when Supabase is unconfigured). Since 2026-08-08 each DB entry
  also records `address_key` + `prop_type` (nullable columns, migration 020) —
  written by a separate best-effort PATCH after the main insert, never in it
  (an unknown column in the insert would divert the whole cache to the
  ephemeral file, the 004 outage's shape) — feeding the Address Explorer's
  "Instant" badge via `cachedAddressKeys()`; presence-based, failure-safe,
  and an approximation by design (the true hit still needs the exact key).
  A cache hit does NOT call Anthropic and does NOT count against
  `DAILY_SEARCH_CAP`.
- `GET /api/config` — what the front-end needs before it can render:
  `{ authRequired, leadCapture, streetview, pro }`. The `pro` block carries
  this visitor's entitlements (`enabled`, `billing`, `isPro`, `plan`, `status`,
  `maxComps`, `maxLookbackMonths`, `exportsRemaining`, `graceUntil`) so locked
  states need no second round trip. **Presentation only** — every limit in it
  is enforced server-side, so editing the response unlocks nothing but the
  visitor's own greyed-out controls. `billing` is `PRO_ENABLED &&
  STRIPE_CONFIGURED`: the UI needs both, since checkout 503s without Stripe
  keys and a Buy button that can only fail is worse than no button.
- `GET /api/pricing` — the founding-member counter for the pricing modal
  (`{ billing, foundingLeft, foundingLimit }`), deliberately kept OUT of
  `/api/config` because it costs a DB read and `/api/config` runs on every page
  load. Memoized 60s, and refreshed by the webhook when a founding seat sells.
  `foundingLeft: null` means unknown (DB down or unconfigured); checkout treats
  unknown as closed, so the UI hides the founding tile rather than advertise an
  offer that would 409.
- `POST /api/report-access` — "do I own this report yet?", answering
  `{ unlocked, pro }` for the `{ address, type, months }` in the body. Exists
  for the return from a $39 checkout: Stripe redirects the instant the card
  clears, routinely before the webhook writes the purchase row, so the client
  polls this instead of re-running the search and rendering a still-locked
  report at someone who just paid. Deliberately **not** folded into
  `/api/config`, which runs on every page load and would drag a purchase lookup
  along with it, and deliberately **POST** so the address never lands in a URL,
  a log, or a Referer header. Fails CLOSED — an error answers "not yet", which
  makes the client wait, where a false yes would render a locked report as paid.
- `POST /api/login` — validates a password so the UI can confirm before searching.
- `POST /api/lead` — stores a lead-capture submission (name/email/phone/company
  + the searched address/type + `source`: `"export"` for export unlocks,
  `"bov"` for Broker Opinion of Value requests, `"1031"` for a BOV request
  from a browser that recently read `/1031-exchange` (the guide's widget
  stamps localStorage `cnRef1031.v1`, index.html reads it at submit, 7-day
  TTL); the Supabase `leads` table has a matching `source` column. `"1031"`
  is bov-CLASS everywhere behavior branches (`bovClass` in the handler, and
  the inbox/intro queries use `source=in.(bov,1031)`) — the tag is
  attribution and urgency, never a separate funnel, and it surfaces as an
  anonymized `is_1031` boolean in the broker inbox (never the raw tag).
  Also takes an optional `size_sqft`, cleaned by
  `LEADSVC.cleanSizeSqft` and written only when present (a conditional spread,
  so a lead with no size never touches the column — protects the file
  fallback if migration 015 has not run). A durably-stored (`dest === "db"`)
  bov-class lead fires a fire-and-forget alert to every broker covering that
  market + property type: the same four anonymized facts the inbox shows,
  never the owner's name/email/phone/company/address, throttled to one email
  per broker/market/hour (`BROKER_ALERT_SUPPRESS`, `BROKER_ALERT_WINDOW_MS`)
  so a hot market cannot turn one lead into a mail storm. Rate-limited per IP.
- `POST /api/share` — publishes the current report (`{ data, meta }`) under a
  short random id so the visitor can share the link; returns
  `{ id, url, visibility, invited }`. Strips `meta.subject.noi` and
  `meta.assumptions` `debt`/`rentRoll`/`opex` (private finances) before
  storing. Stored in the Supabase `shared_reports` table
  (id/payload/created_at, plus the four columns migration 018 adds — see
  below), in-memory Map + `shared-reports.json` file fallback (the file
  fallback only ever holds the original three columns' worth of data — see
  the permissioned-sharing rules below), **no expiry**. Rate-limited per IP.
  **Permissioned sharing** (v3, 2026-08-06; migration
  `018-report-sharing.sql`, **applied to production 2026-08-06**; spec
  `docs/superpowers/specs/2026-08-06-client-sharing-design.md`). The body
  also takes `visibility` (`"public"`, the default, or `"invited"`) and, for
  an invited share, `viewers` (up to 20 emails) and `includePrivate`. An
  invited share requires a signed-in Pro account and a database — there is
  no file fallback for a viewer list, so `storeSharedReport` **refuses to
  create one without Supabase** rather than silently writing it as an
  ordinary public entry; see the rule below. A public share may never carry
  `includePrivate` (400) — a link anyone can open is the one place a
  broker's private comps must never ride along.
  What a broker's own vault comps become depends on visibility:
  `blend-comps.js`'s `stripPrivateComps()` removes them entirely from a
  public link; `anonymizePrivateComps()` (the invited default) replaces them
  with anonymized `locked_basis` rows — the same shape a free visitor's
  gated comps use — so the client's valuation range matches the broker's to
  the dollar with no address, price, or notes traveling; and the whole
  private comp travels only when the owner explicitly set
  `includePrivate: true` on an invited share **and** their entitlements
  still carry `canUseVault` at share time. Three routes manage an invited
  share afterward: `GET /api/shares` (both "my shares" and "shared with me,"
  in one call, for My Desk), `PUT /api/shares/viewers` (whole-list replace,
  ownership proven by a scoped read before the write, mails only the
  newly-added addresses), and `POST /api/shares/revoke` (one-way — there is
  no un-revoke, matching the vault's stance that access lapsing is safer
  than access silently returning).
  **Three rules a future editor will otherwise break:**
  - **The ACL is never cached.** `sharedReportsMem` caches a share's
    *payload* for the life of the process — right for a report body, and
    catastrophic for an access rule. `getShareRecord()` re-reads
    `visibility`, `revoked_at`, and the viewer list from the database on
    every single call, so a revoked link stops working immediately rather
    than at the next deploy. Never let a share's access decision ride on the
    memoized payload.
  - **An unrecognized `visibility` is treated as invited, never public.**
    `report-access.js`'s `canReadShare()` treats every value other than the
    literal string `"public"` as invited (falling through to the viewer-list
    check). A typo in a database column, or a new visibility value added
    later without updating this function, must fail toward *less* access, not
    publish a report to the whole internet.
  - **A public share may never carry a private comp, and `storeSharedReport`
    enforces that itself** rather than trusting the route to have checked.
    With no database configured, storing a share whose visibility is not
    `"public"` **throws** instead of falling back to the
    `shared-reports.json` file store — the file has no column for
    `visibility`, `user_id`, or viewers, so an invited share written there
    would come back out of `getShareRecord` as `{ visibility: "public" }`,
    publishing exactly what the member asked to restrict. This is the same
    rule the broker vault's 503 already carries (see "Broker vault" below):
    everywhere else in this app a Supabase failure falls back to a local
    file so nothing is lost, but here the file WOULD be the loss, so the
    write refuses instead. A **public** share keeps the fallback it has
    always had — the file store still holds its body and the link still
    works through a database blip, exactly as before this feature shipped;
    the asymmetry between the two visibilities is the point. `POST
    /api/share` also refuses this case at the route level (503, before
    storage is ever reached), but that check protects one caller — this one
    protects every future caller of `storeSharedReport`, which is why it
    stays even though the route should make it unreachable in practice.
- `GET /api/shared?id=` — returns a published report's `{ data, meta }`.
  For a public share, anyone with the link can view it (the original
  behavior, unchanged for every pre-v3 link already in the world). For an
  invited share, only the owner or a viewer on the list — `report-access.js`
  is the single, sole decider, returning one of `revoked` (403, the link was
  turned off), `signin_required` (403 + `signin_required: true`, which the
  client turns into a sign-in card), or `not_invited` (403, signed in but
  not on the list). `meta.shared` is
  true so the front-end renders it without saving to the viewer's history.
- `GET /r/<id>` — serves `index.html`; the SPA reads the id off the path and
  fetches the report from `/api/shared`. (server.js allow-lists this path
  alongside `/` and `/index.html`.)
- **Firms — enterprise accounts, slice 1** (2026-08-16; migration
  `030-enterprise-orgs.sql`, **run before deploying — see below**; spec
  `docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md`).
  Colleagues at one brokerage share a shelf: a report shared with the firm
  lands on every member's desk, while each of them keeps their own reports,
  portfolio, watchlist, BOV pipeline and private vault. Rules live in the
  pure, tested **`org-access.js`**; server.js owns the reads.
  `GET|POST /api/org` (my firms + pending invites / create one),
  `GET /api/org/members?id=`, `GET /api/org/shelf?id=`, `POST /api/org/invite`,
  `POST /api/org/accept`,
  `DELETE /api/org/member?org=&id=` (removing somebody and leaving are the
  SAME route under different permissions, so the last-owner rule has one
  home). `POST /api/share` takes `visibility: "org"` + `orgId`; `/desk`
  renders the shelf plus the firm section.
  **The shelf** (`GET /api/org/shelf`) is every report anybody has shared with
  the firm, up to 1000, fetched WHOLE and filtered in the browser — `/vault`'s
  rule, for its reasons: the header count describes the whole shelf, so a
  server-side filter would leave the page unable to say how much it was not
  showing, and a search box that re-queries per keystroke is a request per
  keystroke. Past 1000 it SAYS it is truncated rather than under-reporting.
  It includes **the caller's own** shares, attributed and marked "shared by
  you" — slice 1 excluded them, which is right for a "shared with you" list
  and wrong for a shelf, since a record missing your own work cannot answer
  "has anybody here valued this building". `market` is computed with
  `marketOf()` so the filter matches the corpus and vault vocabulary.
  `GET /api/shares` is otherwise back to its pre-firm shape; its `mine` rows
  gained `firm` so a firm share's status line can say "Shared with Colliers
  Boise" and never "Anyone with the link" (it read as the latter before that
  field existed, which is the one wrong answer there that could make somebody
  forward a firm-only report).
  **The reader's half of that same rule**: `GET /api/shared` adds
  `meta.firmShare` (`firm`, `sharedBy`, `mine`, `sharedAt`) so a colleague
  opening the link is told it is a firm link and by whom —
  `renderFirmShareNotice()` in index.html, `no-print`/`no-capture` because it
  is context about the LINK, not report content, and a printed copy handed to
  a client has no business carrying a firm's routing. Three rules: it is sent
  ONLY to a reader entitled by the firm or its owner (an outside client named
  on a firm share's viewer list is not owed the firm's internals); the payload
  is **copied, never mutated**, because `sharedReportsMem` holds that object
  for the life of the process and writing into it would stamp one reader's
  context onto every later reader's copy; and the two extra reads are paid
  only on that path.
  **"org" is the internal noun and "firm" is the word on screen** — tables,
  columns, routes and identifiers all say org, every string a person reads
  says firm. One translation point, at the copy layer.
  Rules a future editor will otherwise break:
  - **No existing `user_id=eq.` read is ever widened to an org.** There are
    60-odd of them in server.js and they are the wall; a firm read is a new
    query against the new tables, migration 013's separate-tables rule. The
    one-line version of the shared vault is `or=(user_id.eq.X,org_id.eq.Y)`
    on `vaultCompsForReport`, which looks correct in review and fails
    silently because that path returns `[]` on error. `test/org-routes.test.js`
    fails the build if that pattern appears.
  - **No auto-join by email domain, ever.** `gmail.com` is a company by that
    logic, and even a real corporate domain proves only that somebody can
    receive mail there. A domain may one day SUGGEST an invite to an admin;
    it may never grant one, which is why `orgs` has no domain column.
    `broker_profiles.company` is free text a broker typed about themselves —
    two people typing "Colliers" are not verified colleagues.
  - **An invite is not a membership.** `joined_at` is null until the invited
    person accepts. Identity is the EMAIL (018's decision, adopted by 024 and
    again here), so anyone can type anyone's address into their own firm;
    without the accept step that would put a firm's reports on a stranger's
    desk and offer their next report a "share with my firm" button for a firm
    they have never heard of.
  - **`canReadShare` requires BOTH `visibility === "org"` AND a non-null
    `org_id`** before it consults membership, so a mistake in either column
    fails toward the viewer list — toward LESS access. The firm branch sits
    INSIDE the invited path, below revocation and below the sign-in check, so
    a firm share inherits every protection an invited one has.
  - **A firm share can never carry whole vault comps** (400, not a silent
    strip). Private comps are anonymized into the valuation basis exactly as
    on an invited share, so a colleague's range matches to the dollar with no
    address or price travelling. Opting an INDIVIDUAL comp into the firm is a
    different act and it shipped on 2026-08-16 as the spec's §7 — see "The
    shared vault" below; the three things it was waiting on (the opt-in, the
    attribution, and the vault's "Visible only to you" copy rewritten to
    match) all landed with it. This bullet is unaffected either way: a firm
    SHARE still never carries a whole vault comp.
  - **`canUseOrg` gates creating and inviting, never accepting or reading.**
    It tracks `broker` (one subscription), so it is false on a dark
    deployment. (It was also withheld from a tester without `vault_beta`
    until 2026-09-01, when testers became Pro outright — see the
    `TESTER_PASSKEY` bullet.) A colleague on the
    receiving end needs no plan at all: they are exactly an invited share's
    viewer, and a firm that could only share with people who had already
    bought the product would not solve the problem it exists for.
  - **Migration 030 must be run BEFORE the code deploys**, like 018 and 026
    and unlike most: it adds `shared_reports.org_id`, which `getShareRecord`
    SELECTs by name on EVERY share read, and PostgREST 400s an unknown
    column. Deploy-first breaks every legacy public link — including ones
    already mailed to property owners with no account — not just the new
    feature.
  **The firm's buildings** (Three Spaces slice 3, 2026-09-01; migration
  `046-org-buildings.sql`, **run before deploying**; spec
  `docs/superpowers/specs/2026-09-01-three-spaces-design.md`). `org_buildings`
  is the firm's index: one row per building a member CHOSE to put on the board,
  keyed on `(org_id, address_key)` with a nullable `verified_key` so a
  portfolio row can be matched. `GET|POST|DELETE /api/org/buildings?id=<org>`
  on the existing `openOrg` + `memberOf` gate; rules in the pure
  **`org-buildings.js`**; the desk section `#deskBuildings` sits at the top of
  the firm deck with an "Add to firm" door on the firm shelf's rows, and the
  Vault's portfolio rows carry the same door (`firmDoorCell` in
  vault-page.js — the portfolio moved there in slice 1), each reading the
  board off the server's own rows so neither page grows an address key. Four
  rules: **nothing creates a building as a side effect** — `linkVaultProperties`
  never touches the table and `test/org-routes.test.js` fails the build if the
  table is named outside its read function and route block (a row appearing
  from an upload would let a colleague read another's book by watching the
  list); **POST is idempotent** on the key and a repeat add only ever FILLS a
  missing `verified_key`, never rewrites (035's rule); **the whole set is
  returned, never a server-side `?limit=8`** (the shelf's rule; slice 4 slices
  in the browser); and **`org_contacts.building_id` is written ONLY by
  `POST|DELETE /api/org/buildings/contacts`** (2026-09-02, see below) —
  naming it in `orgContactRows`' `select=` before 046 has run 400s every
  contacts read. The plan numbered this migration 044; messaging took it.
  **The overflow rule and `/buildings`** (slice 4, 2026-09-02, no migration):
  the desk shows at most `COLLAPSE_AT` (8) rows and past that — only past
  that — `#buildingsMore` links to `/buildings`, a marketShell body in
  **`buildings-page.js`** whose boot payload is the SAME `/api/org/buildings`
  answer the desk reads (one read, one count), filtered in the browser with
  the header count always describing the whole set. `CTA_FREE_PAGES` gains
  `/buildings`. `org-buildings.js`'s `OVERFLOW_AT` mirrors index.html's
  `COLLAPSE_AT` and `test/org-desk.test.js` holds them together.
  **Each building has a sheet** (slice 5, 2026-09-02; migration
  `047-org-building-notes.sql`, **run before deploying**): `GET /building/<id>`
  (`renderBuildingSheetBody`), composed by the pure `composeSheet` from reads
  `buildingSheetPayload` makes SEPARATELY — the firm's `org_comps` filtered on
  the vault's address key, the viewer's own `broker_comps` through a
  user-scoped read, the shelf as metadata (`orgShelfMetaRows`, a
  `payload->meta` projection that falls back to the full read on any error),
  the viewer's own portfolio snapshots plus the firm's matching shared reports
  priced with `BULK.valueFromReport`, contacts by `building_id`, and notes.
  Two rules, tested: a colleague's private vault comp can never appear
  (composeSheet drops anything in the viewer's arrays not carrying their
  user_id), and valuations are the viewer's own plus the firm's shared reports,
  never a colleague's portfolio. `PATCH /api/org/buildings` edits type, size and
  year and never the address; `POST|DELETE /api/org/buildings/notes` are
  appended, attributed, author-deletable, and a note counts as activity.
  `test/building-sheet-run.test.js` runs the two-account isolation case.
  **Leases, and the dates that matter** (slice 6, 2026-09-02; migration
  `048-org-leases.sql`, **run before deploying**, after 046): `org_leases` is
  the firm's lease record, a different noun from `broker_comps.lease_expiry`.
  Rules in the pure **`org-leases.js`**, RESTATED from broker-vault.js rather
  than shared (a different writer against a different table): a notice after
  the expiry is refused as transposed, a rent needs its basis and it is never
  guessed, an edit is validated as the whole row. `criticalDates` takes
  renewal-watch.js's `deadlineOf`/`daysUntil` INJECTED, never required.
  `GET|POST|PATCH|DELETE /api/org/leases` on the firm gate; the Leases section
  on the sheet and the Critical dates strip at the top of `/buildings` (the
  next twelve months, soonest first). **Nothing here sends mail**:
  `renewal_notified_at` ships unwritten, renewal-watch is display-only on
  this surface, and which member at a firm would get a reminder is an owner
  decision the plan defers. The run test asserts the mail stand-in stayed
  empty.
  **Discovery, unread, contacts, reports** (slice 8, 2026-09-02, no
  migration; spec §13 of the firm-messaging design). Four **Discuss** doors
  (a SHARED comp in the Vault's Firm column, a shelf report, a building
  sheet, a contact row) all land on `/messages?say=&comp=`, which seeds the
  composer and posts NOTHING by arriving. `GET /api/messages/unread` counts
  THREADS with something new (a boolean per thread; the member's `added_at`
  is the baseline for a never-opened thread) and feeds `#navMsgDot` on both
  rails from the after-paint hydration — never from `/api/config`; the send
  route stamps the author's own `last_read_at`. `#deskThreads` on the
  Workspace shows five, unread first; `/messages` sorts unread first. The
  contact door composes name and company and **never the email** (039), and
  the shelf door sends a report as its `/r/<id>` link, never a snapshot, so
  `report-access.js` stays the sole decider.
  **The Workspace read as one page (2026-09-02).** Slices 3–8 each placed
  their own section by local reasoning; this was the first look at the whole,
  and three things changed, each test-pinned. **Contacts is capped**: it was
  the one firm section with no overflow rule (Buildings shows 8 and sends the
  rest to `/buildings`, Conversations 5, the shelf grows a filter at 6), so
  an imported spreadsheet rendered every row on the front page, up to 2,000,
  with Membership, Sharing, Broker, Account and the search chamber below all
  of them. It now shows `COLLAPSE_AT` rows and folds the rest behind "Show N
  more" — `renderHistory`'s fold, not `/buildings`' subpage, because there is
  no `/firm/contacts` yet and `/contacts` is the owner's ADMIN_KEY rolodex
  that migration 007 says must never meet this list; the count line still
  describes the whole list. **Its add/import form ships CLOSED** behind one
  "+ Add or import" control, `setContactAddOpen` the single writer (the
  vault's `#addSec` rule). **It is labelled "Contacts"**: "Tenant contacts"
  was written for the tenant-rep shop kind, withdrawn 2026-08-31, and a broker
  or development shop keeps a contact list too; the `tenant_*` CSV aliases in
  `org-contacts.js` stay, since an old spreadsheet still has to import. And
  **Recent searches moved from the top of the workspace to directly under the
  Run-a-report chamber**, as that chamber's output — it was a personal list
  above "Your firm" on a page the 2026-08-28 decision made firm-first. It is
  its own `#historyDeck`, outside both `#deskView` (hidden wholesale on the
  home view and on a report) and `#searchSection` (hidden by the wall's boot
  CSS while the list still renders signed out), toggled at exactly the four
  seams that toggle `#searchDeckHead`; `test/index-html.test.js` counts
  them. Contacts keeps its place — after the deal board, last in the deck since Membership & settings moved into the account menu’s Firm account panel on 2026-09-03 —
  and Buildings stays first. Recorded for later, not built: a firm-level
  "needs attention" band (lease critical dates + unread conversations —
  `GET /api/org/leases` already returns `critical`) and a `/firm/contacts`
  page for the fold's "See all".
  **Contacts attach to buildings (2026-09-02).** The write half of
  `org_contacts.building_id`: slice 5 shipped the sheet's read
  (`buildingContacts`) with nothing filling it, so every sheet's Contacts
  section was permanently empty. `POST|DELETE /api/org/buildings/contacts?id=
  &building=&contact=` attaches and detaches, and it lives in the BUILDINGS
  route block rather than the contacts one because it must prove the building
  is on this firm's board with `findOrgBuilding` and
  `test/org-routes.test.js` refuses `org_buildings` anywhere else. Rules,
  all run against a real server in `test/building-sheet-run.test.js`: both
  halves are scoped by `org_id` (a contact from another firm and a building
  on another firm's board are both 404); a contact belongs to at most ONE
  building, so attaching elsewhere moves it and the answer says `moved`;
  DELETE detaches only from the building named and never deletes the contact;
  the ordinary contact PATCH cannot touch the column (it writes only
  `FIELDS`), so a name edit cannot silently detach; and attaching is
  activity (the building's `updated_at` moves). `orgContactRows` now names
  `building_id` and the list carries `buildingId`, which the desk row maps
  to an address off its own buildings read (awaited BEFORE contacts in
  `renderShares`). The sheet's Attach door reads the firm's list only when
  opened, leaves out what is already attached, and groups first the contacts
  whose company matches a lease's tenant on that building — the same match
  that marks a row "tenant" — which is where the lease record and the contact
  list meet. `org-contacts.js` is unchanged: `building_id` is a link the
  buildings routes own, not a contact field.
  **Auto-share** (`orgs.share_default` + `org_members.auto_share`, migration
  031, owner's yes 2026-08-16). An owner or admin can set the firm to share
  members' NEW reports automatically; `POST /api/org/settings` carries both
  switches. It ships with the safeguards the spec made a condition of building
  it at all, and each one is load-bearing:
  - **Off by default**, and an unrecognized `share_default` reads as `none`.
    The failure that matters is publishing work somebody did not mean to
    publish, and unlike a missing share it cannot be undone by trying again.
  - **Never retroactive.** It fires from the same three-part guard
    `saveHistory` uses (not sample, not `fromHistory`, not `shared`), so
    opening an old report never publishes it.
  - **The member has a veto that beats the firm.** `org_members.auto_share` is
    NULLABLE for three states — null follow, true always, false never — and
    `false` survives an admin switching the firm off and on again. A boolean
    with a default would collapse "has not chosen" into one of the other two,
    and a broker who said "not my client work" would start publishing again
    the next time an admin changed their mind.
  - **Disclosed before the accept, not after.** A pending invite carries the
    firm's `shareDefault`, because joining a firm whose default is on changes
    what happens to work not yet run.
  - **Per-report opt-out on the report itself.** `renderAutoShareNotice()`
    says it happened and offers Undo (which revokes), because the moment
    somebody wants this off is the moment they are looking at the report.
    Guarded on `meta.autoShared`, or every subject-field repaint would
    re-publish — including something just undone.
  **The shared vault** (§7, migration 032, 2026-08-16). A broker can opt one
  comp at a time into their firm; colleagues see it inside their OWN reports,
  attributed. `POST|DELETE /api/vault/firm`; the toggle is a column on
  `/vault`'s comps table, shown only to a broker who is in a firm. Rules in
  `blend-comps.js`, the read in `orgCompsForReport`. Seven things hold it up:
  - **`org_comps` is a separate table**, never a column on `broker_comps` and
    never a widened read — 013's rule a third time. The one-line version of
    this feature is `or=(user_id.eq.X,org_id.eq.Y)` on `vaultCompsForReport`,
    which looks right in review and fails silently because that path returns
    `[]` on error.
  - **A firm comp keeps `source_type: "broker_vault"` and `private: true`.**
    Whose it is, is ATTRIBUTION (`firm` + `shared_by` on the comp), not a
    provenance tier — so `/api/share` strips or anonymizes it, exports and the
    PNG and the print drop it, and the valuation weights it at 1, all by
    construction. A fifth tier would mean `TIER_WEIGHT` (twice, a pair that
    already carries a keep-in-step ⚠), `SOURCE_TIERS` and `eval-score.js` all
    agreeing about a weight that is 1 in every one of them.
  - **The stored payload comes from `FIELD_MAP` itself** (`firmCompPayload`),
    so `user_id`, `dedupe_key`, `address_key`, `upload_id` and the publish
    flags cannot reach another account's table by being forgotten — and a new
    per-type field needs no migration here, which is why 030 stores jsonb
    where 013 stores columns.
  - **One deal is one row.** `dedupeFirmComps` drops a colleague's copy of a
    deal the reader already holds, the caller's own winning. Two brokers at
    one firm are routinely on opposite sides of the same transaction, and
    without this it is counted twice in the valuation with nothing on screen
    explaining the shift. This is the one place a private comp IS deduped.
  - **The blend is gated on `canUseVault`, not on membership**, and excludes
    the caller's own shared comps (they already arrive through
    `vaultCompsForReport`). A free colleague reads the firm's shared REPORTS,
    like any invited viewer, but does not get a paid capability by invitation.
  - **The owner's edit refreshes the copy and their delete pulls it** —
    `refreshSharedComp` runs AFTER validation, the scar `retractPublishedComp`
    carries, so a rejected edit never disturbs what colleagues hold. Unlike a
    shared report (018's set-null rule) the copy CASCADES on delete: a report
    is a record of what was sent, a comp is a live copy of a row in the
    broker's book.
  - **"Visible only to you" corrects itself** (spec §2). `renderFirmPrivacy()`
    rewrites the deck subtitle and the trust line the moment something is
    actually shared — keyed on having shared, not on being in a firm, because
    a broker who has shared nothing really does have a vault visible only to
    them. The default text stays in the MARKUP so a page whose script failed
    still makes the true statement rather than none.
  **Per-seat billing** (migration 033, 2026-08-16). `STRIPE_PRICE_FIRM_MONTHLY`
  + `plan: "firm_monthly"` on `/api/checkout` (with `orgId` and `seats`), the
  firm's own Stripe customer, and `org_subscriptions` keyed on `org_id`.
  `POST /api/billing-portal` takes an optional `orgId` and opens the firm's
  portal. Unset price = the plan 503s and the buy control never renders, which
  is how seats stay hand-granted until somebody asks to pay. Six rules:
  - **`orgs.seats` is the one cap**, read only through `seatCapOf()`, which the
    invite gate and the entitlement read share — one refusing a colleague the
    other would have granted Pro to is a support ticket nobody can reproduce.
    An unreadable count falls back to `MAX_MEMBERS`, never to 0 or 1: a seat
    count is a COMMERCIAL limit (membership is the access gate, elsewhere), so
    the failure worth choosing is an unbilled invitation, not a paying firm
    locked out of adding the colleague they just hired.
  - **The webhook writes seats from the SUBSCRIPTION**, not from the checkout
    request, so the number a firm can use is always what Stripe bills them for
    — including after a portal change we never saw the request for.
  - **A firm session must reach `applyOrgSubscription` and RETURN before the
    user path.** Otherwise a firm checkout lands a row in `subscriptions` keyed
    on whoever clicked Buy: one person with a personal subscription their firm
    is paying for, and the firm with none. Pinned by test.
  - **Owner only** for checkout and the portal, deliberately narrower than
    `canManageMembers`: an admin manages people, committing a firm to a
    recurring charge is not the same act.
  - **Seats below the current headcount are refused by name and number**
    (`seats_below_headcount`), because buying too few drops named colleagues to
    free the moment the webhook lands — a downgrade applied to people who are
    not in the room. Pending invitations count toward the headcount.
  - **The firm is a FALLBACK in `getEntitlements`**, consulted only when
    nothing already grants Pro, and handed to `entitlements.js` as an ordinary
    subscription row — so that file still knows nothing about firms (spec §8)
    and the lapse, grace and renewal-slack rules apply unchanged. `viaFirm` on
    `/api/config` is presentation only, and exists for one concrete wrong
    answer: the plan card offers the Stripe portal off `status !== "none"`, and
    a colleague on a firm seat has a real status belonging to a customer record
    that is not theirs. Seats are held oldest-first by `joined_at`, so a portal
    downgrade has a defined, explicable result instead of an arbitrary one.
  Seats can still be granted by hand, the `vault_beta` precedent — a firm with
  no subscription has `seats` and a `status` of `"none"`, and everything works.
  `orgs.share_default` and `orgs.seats` ship as unwritten columns so both are
  code changes rather than migrations — the same reason `hub_items.status`
  shipped early in 024. The shelf needed **no** `org_shelf_items` table in the
  end: reports already live in `shared_reports` with `visibility='org'`, and a
  second copy would have been two sources of truth for one thing. That table
  becomes worth building when the shelf holds something a share cannot — a
  BOV pipeline row, or an individual vault comp.
  **Two shops, one architecture** (migration `036-org-shop-kind.sql`, **run
  before deploying**; Business Model Transition Plan v2 §6, 2026-08-17).
  `orgs.kind` is `'broker'` or `'development'` and decides two things: the
  nouns a firm reads (a development shop is told its shelf holds land comps,
  rent comps, absorption studies and feasibility packets, in the invite email
  and on the desk) and which property type the firm shelf opens on (Land for a
  development shop, everything for a broker shop). Nothing is gated on it and
  nothing is published by it.
  **A tenant rep shop was a third kind from 2026-08-21 and was WITHDRAWN on
  2026-08-31** (owner's call). Removing a kind needed no data migration and no
  SQL at all, which is worth understanding before adding or removing another:
  `kindOf` reads anything it does not recognize as `broker`, so a firm that
  had chosen it goes back to reading the incumbent vocabulary rather than
  losing a screen, and `validateShopKind` refusing the string is the only
  thing that keeps a new one from ever being written. **Migration 037 is
  deliberately NOT reverted** — its CHECK still accepts `'tenant_rep'`.
  Narrowing it back would fail on exactly the rows that make narrowing matter,
  and a value no code can send is a value no row can gain, so the module is
  the whole wall — which is why `test/org-run.test.js` executes that refusal
  against a real server and not only against the module. Five rules:
  - **Required at creation, not defaulted.** `POST /api/org` refuses without a
    valid kind (`ORG.validateShopKind`), because the creator is the only person
    who knows the answer and a default would be answered by silence. Changing
    it later is an owner/admin call on `POST /api/org/settings`, the same
    authority as `share_default` and for the same reason: it re-labels every
    colleague's desk, not one person's own work.
  - **036 is 030's hazard.** `orgsByIds()` and `findOrg()` name `kind` in
    their SELECTs and PostgREST 400s an unknown column, so deploying 036
    second takes down every firm surface at once. Migrate, then deploy. (037
    only widened the CHECK and has already run; withdrawing the third kind
    touches the database in neither direction.)
  - **An unrecognized kind reads as `broker`** (`ORG.kindOf`), which is
    incumbency rather than safety: every firm predating 036 has only ever been
    shown broker-shop words, so a typo must not re-label their desk. The write
    path normalizes case and padding; the read path stays strict.
  - **Only one kind has a saved view, and that is deliberate.** Land is a
    default VIEW rather than a claim about what a development shop may file,
    and it exists because exactly one entry in `VAULT.PROPERTY_TYPES` names
    that shop's subject. A broker shop's work spans every type, so its
    `shelfType` is `""` — a shelf that opens filtered on a type nobody chose
    reads as the record having lost rows. `test/org-access.test.js` asserts
    the empty string on purpose.
  - **The shelf's saved view never hides a row while its filter is off
    screen.** The filter row is furniture under six items, so below six the
    type is cleared rather than merely hidden, and a colleague's own choice of
    filter is never stomped by a re-render. The header count always describes
    the whole shelf.
  Enterprise is still deliberately not a kind: §6 rules it out as a target
  (a research department kills the deal internally) and names its real entry
  point as somebody who used CompNinja at their last shop. The bar a third
  kind has to clear is that test plus the one tenant rep failed in practice:
  a value nothing may select is a value that rots, and so is one nobody picks.
  The shops' words live in `ORG.SHOP_COPY` and are **mirrored** in index.html,
  which cannot require the module; `test/index-html.test.js` pins the two
  together, because drift there would invite a firm as a development shop and
  then greet it with a broker shop's desk. **Two** strings are mirrored, not
  one: the refusal `validateShopKind` returns is repeated in the browser (which
  declines to spend a round trip on a question it can answer) and it ENUMERATES
  the shops, so it goes stale the day a kind is added OR removed — the same
  suite pins it to the module's own words. The `/brokers-firms` page draws its
  shop row off `SHOP_KINDS` for the same reason, rather than typing the cards.
- `POST /api/geocode` (body `{address}`) — CORS pass-through to the free US
  Census geocoder. **POST, and there is no GET form** (2026-08-17): a query
  string lands in the platform's access logs and in every outbound Referer,
  and this route sees more addresses than any other — the subject plus every
  comp of every report — including the private vault comps that are geocoded
  here and deliberately nowhere else (GUARD 2 of the private-comp contract).
  The GET alias was removed rather than deprecated, because a door left open
  is one stale caller away from putting addresses back in URLs and nothing
  detects that. Comp pins are placed ENTIRELY from real geocoding — the model
  no longer returns per-comp `lat`/`lng` (dropped 2026-07-31 to shrink the slow
  report-writing burst; only `subject_lat`/`subject_lng` remain, for the
  map's first paint and the wrong-state sanity gate). Old cached reports
  still carry comp coords and render unchanged. The front-end places every
  pin from geocoding (this proxy, then browser-direct Nominatim as fallback,
  results cached in localStorage under `geoCache.v2`). Rate-limited per IP.
  The market pages' own comp map runs the same stack but caches under
  `mktGeoCache.v1`, and **the two stores must never be re-joined**: the market
  map needs pins only, so it stores no geocoder label, and a label-less entry
  read back by the app fails `geoLabelMatches` — the gate on subject photos
  and footprint sizing. They shared a key until 2026-08-04; a test in
  `test/routes.test.js` now holds the names apart.
- `GET /api/streetview?lat=&lng=` (an `?address=` form exists but the
  client no longer sends it — address aiming showed the road on unmapped
  parcels) — Street View photo proxy for the map pin popups. The client
  only asks for pins with a snapped OSM building footprint, aiming the
  camera at the footprint centroid. Metadata-checks first (free, cached
  in-memory), then streams the image with a 30-day cache header. No key /
  no imagery / any error → bare 404, which the popup img's `onerror` swaps
  for the keyless aerial (flag off = aerial directly, same footprint-only
  gate). Listing-site photos (Zillow/Redfin/Realtor.com) are OFF the
  table — copyrighted, scraping-banned, and litigated; Street View + Esri
  aerials are the licensed sources. Rate-limited per IP.
- `GET /api/corpus-comps?address=&type=` — the in-report "From CompNinja's
  records" offer: provenance-good corpus rows for the subject's market+type
  (never estimate/news, priced, deduped, max 20), served from the same
  `corpusRowsForMarket` read corpus-first retrieval uses. Pure DB read — no
  Anthropic call, no cap interaction. Rate-limited per IP. Logs a PII-free
  `corpus_offer` analytics event when rows are returned. Failure-safe: any
  error returns an empty list, never an error page.
- `GET /api/leads` — downloads captured leads as CSV; requires `ADMIN_KEY`.
- `POST /api/comp-submission` — stores a broker-submitted comp (broker contact +
  comp details, `status: "pending"`) in the Supabase `comp_submissions` table
  (file fallback: `comp-submissions.jsonl`). Review is manual: setting a row's
  `status` to `approved` in Supabase puts it in the verified comp layer — each
  search fetches approved comps of the matching property type and offers them
  to the model as trusted candidates; comps the model includes from that list
  carry `"verified": true` and the front-end shows a green Verified badge in
  the Address column. **Broker loop**: the server matches each returned verified
  comp back to its submission (by normalized address) and attaches
  `verified_by` (firm or broker name), which renders as "Verified · via
  <firm>" — visible credit for the contributor. And a BOV lead's owner email
  lists any brokers who've contributed approved comps in that same market
  (`findBrokersForMarket`), so the owner can connect them. Routing is
  owner-mediated: broker contact info goes only to the owner, never the
  reverse — owner PII is never auto-forwarded to a broker (also, Resend's free
  tier only delivers to the owner address anyway). Rate-limited per IP.
- `GET /api/comp-submissions` — downloads submitted comps as CSV; requires
  `ADMIN_KEY`.
- **Comp corpus** (not a route — a persistence layer): every search response
  (billed AND cached) has its comps harvested by `harvestComps()` into the
  Supabase `comp_corpus` table (file fallback `comp-corpus.jsonl`, git-ignored),
  deduped by a normalized address|date|price key (unique constraint +
  ignore-duplicates upsert; in-memory seen-set for the file path). Harvest
  keeps only `public_record` and `listing`; `estimate` and `news` stay in the
  report that found them and are not stored; an empty listing date is stored
  as `"Active"`. Fire-and-
  forget — a corpus failure never affects the request. This is the permanent
  raw-data layer that broker verification and future retrieval features build
  on; the DDL lives in `migrations/001-comp-corpus.sql` (+ `004` for the
  per-type columns).
  `GET /api/comp-corpus` downloads it as CSV (requires `ADMIN_KEY`).
  **Radius blend (2026-08-14).** At serialization, inside `gate()` and
  **before** `gateReport()`, `blendNearbyComps` folds in harvested deals of
  the same property type whose date is inside the lookback, that have
  coordinates, and that sit within **10 miles** of the subject for CRE —
  **1 mile for Residential** unless the market note names a radius in miles
  (a typed "2.5 miles" is the neighborhood for that search; shrinking it to
  one mile would fight the instruction the owner just gave). Houses trade by
  neighborhood; the 10-mile CRE circle priced a $2M home off cheaper sales
  from the next pocket over (19 comps, ~$1M headline). When the 19 comps
  already sit inside that named circle, distance cannot separate them —
  Residential extras more than 1.5× the subject's implied $/SF (ask ÷ size)
  are dropped, and `compWeight` floors the same miss so the IQR cannot be
  outvoted by the cheaper majority. Missing ask is neutral. They join
  the table and the Low / Likely / High math; a free report turns extras
  into `locked_basis` so the dollar range still matches Pro.
  Harvest Census-geocodes new rows before the insert (fire-and-forget with
  the rest of harvest); unlocated existing rows backfill up to 8 per request
  and join the *next* search. A deal with no point is skipped, not guessed as
  same-city. Cache, harvest, and market snapshots still see the search-only
  report, so a later search in the area picks up deals saved after the cache
  write. Rollback is `CORPUS_RADIUS=off`. Vault rows are never read. Spec:
  `docs/superpowers/specs/2026-08-14-radius-corpus-blend-design.md`.
  **Corpus health (`CORPUS_HEALTH` + `noteCorpusFailure()`).** Fire-and-forget
  means both the write (`harvestComps`) and the read (`corpusRowsForMarket`)
  swallow their errors, which once hid a total outage: ten per-comp columns
  were missing because the `ALTER TABLE` was never run, so every insert 400'd
  into the ephemeral file and every read returned empty. The corpus sat frozen
  at 65 rows for **weeks** while the log said `Comp corpus +8` on each search
  and `/admin` showed a 0% corpus hit rate with no explanation. So failures now
  accumulate in `CORPUS_HEALTH` (write fallbacks, read failures, last error +
  timestamp, and a `schemaMismatch` flag set when the message names a column or
  the schema cache — PostgREST's `PGRST204`). `/api/stats` returns it as
  `corpus.health` and `/admin` renders a red banner above the tiles whenever
  anything is non-zero, naming the missing-column case specifically because it
  has one concrete fix. Counters are in-memory and reset on restart — a smoke
  alarm, not accounting. The harvest log also distinguishes a durable insert
  from the ephemeral fallback; **a console line alone was not the fix** (one was
  already logged on every failure and nobody tails Render's logs), which is why
  this surfaces in the dashboard instead.
- **Upstream health (`UPSTREAM_HEALTH` + `upstreamError()` + `noteUpstreamFailure()`).**
  Anthropic's error text is written for *us*, not for a customer, so it is never
  passed through to the browser. On 2026-08-04 it was: the Console API credit
  balance hit zero and every visitor — including people who had just paid $39 —
  got "Anthropic API error (400). Your credit balance is too low ... purchase
  credits", which reads as *their* billing problem and names a vendor they never
  bought from. Both leak sites (the non-2xx at `callAnthropicOnce` and the
  mid-stream `error` frame) now throw `upstreamError()`, which carries
  `.message` for the log and `.userMessage` for the browser; `clientErrorMessage()`
  at the two handler catches (`/api/comps`, `/api/explore-market`) is the only
  thing that decides what a visitor reads. It deliberately passes `.message`
  through when there is no `.userMessage`, because most errors here are ours and
  are already good customer copy ("The search took too long and was stopped.").
  429/529 gets a "busy, try again in a minute" line; everything else gets
  "temporarily unavailable". The real cause goes to `/api/stats` as `upstream`,
  to a red `/admin` banner **above** the corpus one (when this fires nothing else
  on the page matters — no search is completing at all), and, for the billing
  class only, to one email per process. **API credits are prepaid and billed to
  the Console org that owns `ANTHROPIC_API_KEY`; no Claude Pro/Team subscription,
  comped or otherwise, funds them.** Recovery is buying credits — nothing to
  redeploy. Counters reset on restart: a smoke alarm, not accounting.
- **Corpus-first retrieval** (the cost saver, not a route): on a cache *miss*,
  before paying for a fresh web search, `retrieveCorpusComps()` pulls comps
  already harvested for that market+type. Rows count as *usable* when the
  provenance is better than `estimate`/`news`, a price parses, and
  `parseDealDate()` puts the deal inside the requested lookback.
  `corpusIsStrong()` — the single threshold shared by the search budget and the
  analytics tag so the two can't disagree — is `coverage >= 4 && fresh`, where
  fresh means the newest harvest for that market is under 75 days old
  (45 until 2026-07-31 — widened as a cost lever; see the comment above the
  constant before touching it again). When
  strong, the model is handed those comps and `searchBudgetFor()` cuts
  `max_uses` to a floor of 3 (or 2 when the subject size was supplied), vs
  10/8 for a full-budget 12-comp search — a
  deliberate floor rather than 0/1 — and the search is tagged
  `source: "corpus"` in `analytics_events`. Failure is always safe: any error
  returns zero coverage, i.e. today's normal full search.
  Because the key is `marketOf(address)` and matched with a **case-sensitive**
  `eq`, the write side (`harvestComps` files each comp under
  `marketOf(comp.address)`) and the read side (`marketOf(subject.address)`) must
  agree exactly — `marketOf()` canonicalizes to title-case city + uppercase
  state for precisely this reason; see the note above it before touching that
  parse. Verified end-to-end 2026-07-27 on both a 24-month and the default
  12-month lookback. Note the threshold is per market **and** property type, so
  it only pays off when traffic repeats in the same market.
  **Archive-first (2026-08-21).** Above the corpus sits the searcher's OWN
  vault: 4+ usable rows for the market+type (priced, or a lease with a rent —
  `archiveCoverage`/`archiveIsStrong` in blend-comps.js, threshold mirrors
  `corpusIsStrong`) floor the web budget exactly as corpus strength does.
  Three rules, all pinned by `test/archive-first.test.js` against a real
  server and a stub provider: **nothing vault-derived reaches the prompt**
  (the strength flag rides on the corpus object; `buildPrompt` only ever
  receives `corpus.comps`/`nearby`/`listed`); the budget and the
  `source: "archive"` analytics tag read ONE flag, set once in
  `runCompSearch`; and **a vault-subsidized report is never written to the
  shared cache** — `search_cache` is keyed by property, so a later visitor
  would be served the thinner report without the private rows that justified
  it (corpus-strong entries stay cacheable, because the comps that shrank
  THAT budget are in the cached body). Firm-shared comps deliberately do not
  count, and internal callers pass no vault rows. **It is also gated on
  `PROVIDER.capabilities.searchBudget`**, which means it is INERT on the
  default provider: Gemini's `google_search` takes no `max_uses`, so the
  floored budget is ignored and setting the flag would skip the cache write
  for no saving at all — worse than not having the feature, and invisible.
  It becomes a cost lever under `SEARCH_PROVIDER=anthropic`. Rollback is
  `ARCHIVE_FIRST=off`.
  **Metro matching (2026-08-10).** Corpus-first retrieval, and ONLY it, also
  reads the subject market's immediate neighbors from `market.js`'s curated
  `METRO_GROUPS`, so a Meridian search can draw on Boise's rows. Those come
  back as a separate `nearby` list and get their own prompt block, worded more
  narrowly than the exact-market one (use only when the target's own city is
  thin, report the address exactly as given, prefer a same-city comp when both
  are comparable). The exact-market block's "never include one clearly in a
  different city" rule stays intact and absolute. **`coverage` remains
  exact-market only**, so `corpusIsStrong` and the search budget cannot be
  moved by a nearby row; that is the whole safety property, and it is why the
  two counts are kept separate rather than summed. `corpusRowsForMarket` itself
  returns the same rows for its four other callers (watchlist feed, vault gut
  check, `/api/corpus-comps`, Address Explorer), now also carrying their own
  market value; retrieval calls the new `corpusRowsForMarkets` directly
  instead. Rollback is `CORPUS_METRO=off`. Adding
  a metro group is a data edit in `market.js`; the rule is adjacent suburbs
  sharing one submarket, never a whole statistical area, and a test pins every
  entry against `marketOf` because an exact-match key that never matches is
  invisible.
  **On-market listings (2026-08-13).** Unparseable listing dates (`Active`,
  `Listed Mar 2025`) come back as `listed` extra candidates with their own
  prompt block; they do not count toward `coverage` or shrink the budget;
  dated listing comps still do. Rollback is `CORPUS_LISTED=off`. The harvest
  filter has no flag.
  **An asking price is not a comparable sale, and `comp_corpus` now holds
  both** — so EVERY aggregate over corpus rows must exclude the on-market
  ones, and the test for "is this a closed deal" is that `parseDealDate`
  returns non-null (`Active` and `Listed Mon YYYY` are both deliberately
  unparseable). Most consumers got this free because they already required a
  parseable date — the radius blend (`blend-corpus.js`), the backtest, the
  market-page trend, and portfolio movement all filter on one, so the
  VALUATION was never exposed. **Two did not, and both were fixed in the
  shipping commit rather than found later**: `gut-check.js`'s `corpusStats`
  (the broker's own benchmark — measured, one listing at $160 against four
  closed sales near $100 moved the median 101 → 102 and Q3 102.5 → 104, so
  every book looked cheap against it) and `buildWatchlistFeed`'s
  `median_psf`, which windows on `ts` — when the row was HARVESTED, not when
  the deal closed — and so had nothing at all to exclude an asking price
  with; that median is quoted on My Desk and in the digest email. Both are
  test-pinned, and the gut-check gate only trusts an INJECTED parser because
  its fallback returns null for everything and would otherwise empty every
  benchmark. `/api/corpus-comps` deliberately still offers these rows: they
  carry a visible `date` of `Active`, and a comp a visitor reads and chooses
  to add is not a silent aggregate. This is the cost of one table holding two
  kinds of row — CLAUDE.md's own separate-tables rule (the vault privacy
  wall) is the alternative that was not taken here, so a new corpus reader
  must be checked against this rule by hand.
- `GET /how-it-works` — the account-wall front door, reached from the footer
  and, on the landing page, the line under the hero. It LEFT the Explore menu
  on 2026-08-25 (owner’s call), along with /brokers (which merged into
  /brokers-firms on 2026-09-01). Under the wall, `/` *is*
  this render (`renderHowItWorksHTML({ home: true })`). Holds a hero (claim +
  address field + one sample exhibit), the three-step Method, the FAQ, and a
  one-block Brokers path to `/brokers-firms`. There is no stat strip. The address
  field is not `#compForm`; it stores `pendingLandingAddress.v1` and opens
  `/?auth=signup` (signed-in: `/`). **Server-rendered and
  self-contained** like the market pages (`HOW_CSS` — the Research Desk `rd-*`
  system re-expressed as plain class names — so it does NOT depend on the purged
  `tailwind.css`). Two things live here and nowhere else: `HOW_FAQ`, the single
  Q/A array feeding both the visible accordions and the **FAQPage JSON-LD** (it
  moved off `index.html`'s `<head>` with the copy it describes), and the sample
  exhibit's illustrative figures. Listed in `sitemap.xml`.
  **It renders two variants, and the caching split between them is
  load-bearing** (2026-08-08). The page is linked from inside the signed-in
  app, and while it served one static body to everyone its "Log in / Create
  account" chrome read to a member as having been silently logged out
  mid-session. It now takes `signedIn` — decided on `cn_session` **presence**,
  the wall's own cheap rule, because this renders synchronously and
  `getSessionUser()` reads the database — and swaps all **three** signup
  surfaces (header nav, hero CTA, closing CTA) for `My Desk` / `Run a report`.
  Presentation only: a forged cookie buys different buttons and nothing else.
  The headers are the half a future editor will "simplify" and thereby
  reintroduce the bug: the signed-in variant is **`no-store`** (a cached copy
  would outlive a sign-out), while the anonymous variant keeps its hour cache
  for crawlers and carries **`vary: cookie`**. That `vary` looks redundant on
  a page whose body is static and is not — without it the hour-old signed-out
  copy is re-served after signing in, so the people who just created an
  account are exactly the ones who still get told to create one.
  `test/account-wall.test.js` pins all three (chrome swap, `no-store`,
  `vary`).
- **Signed-in header chrome on every server-rendered page** (2026-08-09;
  `ACCOUNT_NAV_CSS` / `accountNavSlots()` / `ACCOUNT_NAV_PRICING` /
  `ACCOUNT_NAV_JS`, declared just above `MARKET_CSS`). The /how-it-works
  complaint above, generalized: `MARKET_BAR` carried three links and nothing
  else, so leaving the home page dropped Pricing, My Desk and the account
  circle in one go — reading as a mid-browse logout on `/markets`, all
  `/market/<slug>` pages, `/brokers-firms`, `/1031-exchange`, `/terms`, `/privacy`.
  Fixed the OPPOSITE way from /how-it-works, on purpose: the markup is
  byte-identical for every visitor (hidden slots) and a client script asks
  `/api/config` + `/api/account/me` (both `no-store`) after paint, then
  unhides. Why not server-render like /how-it-works: it would drag ~38
  cached market pages onto the `no-store`/`vary: cookie` split, and the
  circle wants an email, which is `getSessionUser()`, a DB read on a
  synchronous render path. The cost is the chrome popping in a beat late.
  Visibility rules are index.html's `refreshBillingUI()` restated (that copy
  is locked in its module scope): Pricing/Upgrade = billing live && !isPro;
  vault = `canUseVault`, NOT gated on billing; Manage billing = status set,
  not "none", not admin. Pricing links to **`/#pricing`** (the modal lives
  only in index.html — the `/#submit-comp` idiom; consumed in
  `refreshBillingUI` once `live`/`pro` are known, cleared either way).
  Sign-out reloads the page rather than re-hydrating, because the page
  around the bar may itself be signed-in-shaped (the vault above all).
  Traps: `.hdr nav .dd a` sets
  `display:block`, which out-specifies `[hidden]`, so the
  `.hdr nav [hidden]{display:none!important}` line in ACCOUNT_NAV_CSS is
  load-bearing — without it every page shows both auth states at once.
  `test/routes.test.js` pins presence on all seven pages
  and the no-double-desk rule.
  **The headers unified (2026-08-20).** `/how-it-works`' hand-kept header is
  gone: `marketBar(signedIn, current)` is THE header for every server-rendered
  page (the two copies had drifted to within one `aria-current`, which is what
  the new `current` argument renders — pass the page's own path from its
  `marketShell` call and the Explore menu marks where the reader is). The
  Explore menu's browse links themselves live in **`NAV_LINKS`**, one list
  beside marketBar with three consumers: `navLinksHtml()` for marketBar,
  and `APP_NAV_LINKS_HTML`, which the `/` handler injects into index.html's
  `#exploreMenu` at serve time in place of the `<!--NAV_LINKS-->` marker —
  index.html authors no copy of the menu any more, so adding a nav link is a
  one-line edit to NAV_LINKS. **`/faq` joined it 2026-09-01** (design 3b),
  beside Brokers and For firms because it answers the same reader. The
  `<summary>` itself now takes an `.on` class when the page being rendered is
  one of these — the menu ITEM was already marked, but a closed dropdown hides
  that, so the bar said nothing on /brokers, /firms, /faq or /download. The
  class goes on the summary and **never** on the `<details>`:
  `test/routes.test.js` pins the literal string
  `<nav><a href="/">Home</a><details>` on every signed-out page.
  **A fourth marker, `<!--BULK_RUN-->`, carries bulk valuation's run view**
  (2026-08-25). `bulk-page.js` renders that table once; `/bulk` uses it
  directly and index.html receives the same bytes, which is what lets a list
  pasted into the main search render its run inline. Two copies would
  eventually quote two different portfolio values for one run. It brings its
  own `<style>` (index.html gets no `MARKET_CSS`) with a fallback on every
  colour; its DOM ids are prefixed `bk`, because index.html already owns
  `#gate` and `rows`/`msg`/`run` were one refactor from colliding; and
  `BULK_RUN_JS` reads no form at all — it reports state through an injected
  callback, since the homepage has no `#bulkText` to dereference.
  `test/bulk-inline.test.js` pins the marker on both sides, compiles what is
  actually served, and fails the build if index.html grows a hand-copy.
  Two traps: `APP_NAV_LINK_CLASS` must stay
  identical to `#pricingLink`'s class string, because tailwind.css is purged
  against index.html alone and a utility that existed only in the server-side
  string would silently stop styling on a regen; and the marker must survive
  in index.html, or the app quietly loses its browse links —
  `test/routes.test.js` pins both the replacement and link parity with the
  server-rendered headers. index.html's header ELEMENT still lives in
  index.html (its auth chrome, account menu and pricing button are SPA
  behavior owned by `refreshBillingUI()`); what is single-sourced is the
  markup every header shares.
- **Broker directory on market pages** (2026-08-06). A market page slug IS a
  (market, property type) pair — `industrial-boise-id` — the identical key
  `broker_coverage` uses, so "who covers Boise industrial" renders on
  `/market/<slug>` rather than on a directory page of its own. Rules in the
  pure, tested **`broker-directory.js`**; the cached read is
  `BROKER_DIRECTORY` / `refreshBrokerDirectory()` / `brokersCoveringMarket()`
  in server.js, stale-while-revalidate like `MARKET_CREDIT` and for the same
  reason — market pages render synchronously and must never wait on the DB.
  **TWO CONSENTS, NOT ONE.** `broker_coverage` is which markets a broker wants
  *leads* from (015) — a working preference, **not** permission to publish
  them. `broker_profiles.public` is the opt-in and is false by default. It is
  enforced **twice**, in the query (`public=is.true`) and again in the module,
  so a bug in either alone cannot publish somebody; only a literal `true`
  counts. **NO CONTACT DETAILS EVER** — name, company, and a link to the
  profile they opted into. Do not confuse `brokersCoveringMarket()` with
  `findBrokersForMarket()`: the latter carries broker email and phone and is
  OWNER-facing only. Routing is owner-mediated; a public directory is the
  reverse of that.
- `GET /` and `GET /faq` — **the home page and the FAQ, split apart
  2026-09-01** (designs 3a/3b, handed off as `design_handoff_home_and_faq`).
  Bodies in **`home-page.js`** and **`faq-page.js`**, both marketShell BODIES
  like `brokers-firms-page.js`; server.js owns the routes, the SEO metadata and the
  structured data.

  **What changed, and why it matters more than the pixels.** `/` and
  `/how-it-works` had been ONE render since 2026-08-08: `renderHowItWorksHTML`
  answered both, /how-it-works canonicalized to `/`, and the sitemap listed
  only one of them because a URL that declares itself a duplicate is a Search
  Console soft error. That arrangement existed because `/` had no page of its
  own. It has one now, so **all three of those facts reversed**: each page
  canonicalizes to itself, both are in the sitemap, and /how-it-works is the
  methodology page it is named after (Method steps and the sample-report
  anatomy — the vault hero, firm shelf and sharing panes went to the home
  page's bands and /brokers-firms; the FAQ went to /faq; the brokers ledger
  went to /brokers-firms, which lands the same day out of design 4a and whose
  own comment says its FAQ was dropped because "the questions belong on /faq"
  — these two branches are halves of one decision).

  Four things to know before editing either page:

  - **`.heroCta` is load-bearing beyond layout.** Three suites use its
    presence to decide WHICH page answered a URL — it is how the account-wall
    tests tell the home page from index.html. It has wrapped an address form,
    then an account CTA, and now the comp finder. Keep the class name whatever
    the contents become.
  - **Both pages carry their `<style>` in the BODY, not through
    `marketShell`'s `head`.** The head is emitted BEFORE `MARKET_CSS`, so a
    rule placed there loses on equal specificity — `bulk-page.js` already
    carries its own style for this reason, and it is what lets the home page
    neutralise `main.wrap` (it is full-bleed bands, not a 1120px column). The
    bands use HOW_CSS's `box-shadow: 0 0 0 100vmax` + `clip-path` device
    rather than `100vw`, which includes the scrollbar and overflows.
  - **Every colour is a TOKEN.** The design was drawn in the light palette and
    its literals ARE theme.js's light values, so the mapping was exact and
    dark mode came free. The one exception is the home page's closing band: it
    sits on `--slab`, which is dark in BOTH themes, so its text is literal the
    way `MARKET_FOOTER`'s is — and it takes a **dark-only top border**,
    because `--wash` and `--slab` are the same `#243044` in dark and the band
    above it would otherwise be one continuous charcoal.
  - **The comp finder hands off; it does not search.** The wall forces
    `GUEST_SEARCH_LIMIT` to 0, so an anonymous POST to `/api/comps` is refused
    by design. Address and type ride `pendingLandingAddress.v1` /
    **`pendingLandingType.v1`** (new) and index.html picks them up —
    `setTypeProgrammatic`, never a bare `.value =`, or the subject fields and
    the lookback hint keep the previous type's shape. Both keys are pinned
    against index.html's reads. The placeholder option submits an EMPTY value
    on purpose: "Property type" must never arrive as Industrial.

  **/faq's ten answers are public promises, and four were corrected off the
  design before they shipped** — the design file states things the product
  does not do, and `test/faq-page.test.js` asserts each by the fact it gets
  wrong, so "restoring the design copy" fails the build. (1) It named four
  source badges; the enum has five, News included. (2) It claimed the search
  runs "rather than against a stale cache" — the exact sentence deleted from
  the landing page on 2026-08-21, because `runCompSearch` reads the cache, the
  derivable window and the corpus before anything is billed. (3) It described
  only the anonymized share; `POST /api/share` has three outcomes, and a
  public link STRIPS vault comps rather than anonymizing them. (4) It offered
  branded exports to everybody; branding is Pro and free is five a month. The
  design's closing "Write to us — a person answers" was **dropped on the
  owner's call**: there is no contact route that guarantees a human reply, and
  the handoff README asked for one to be confirmed first.

  Two known losses, both deliberate and both worth revisiting if traffic says
  so: four HOW_FAQ answers were not carried over ("What is a comp in
  commercial real estate?", the broker-submission answer, "Can I find out what
  my building is worth?", "How accurate are the reports?"), and the home page
  no longer carries a broker-facing band — the 2026-08-12 decision that put
  one there is the one promise design 3a does not keep in the body of the
  page. The intro photograph (`boise-skyline.png`, on the `STATIC_FILES`
  allowlist) is a **client-supplied asset with unconfirmed licensing** and is
  612x395 against a 940px 3:1 frame, so it upscales ~1.5x (~3x on retina);
  `market-heroes/boise-id.jpg` is the licensed 3840x800 alternative.

- `GET /brokers-firms` — **the** public pitch to the professional audience
  (2026-09-01, design 4a). Body in **`brokers-firms-page.js`**; server.js owns
  the SEO metadata and the shell. It REPLACED `/brokers` and `/firms`, which
  both **301** here — they were two pages selling to one reader (a broker
  deciding whether to bring their comp book, and the same broker deciding
  whether to bring their office), sharing an audience, a price answer and a
  privacy argument while spending two of the four Explore slots saying it
  twice. One Explore entry, one footer link, one sitemap line; a sitemap must
  never list a URL that redirects, so the two old ones came out.
  Order: hero → **One · your book** (a static picture of the import) → **Two ·
  your vault** → **Three · your firm** → price pair → dark CTA → compliance.
  Unlike the pages it replaced it carries its **own stylesheet, in the BODY**
  (the `/faq` and `/bulk` rule): the design is full-bleed alternating bands,
  which needs `main.wrap{max-width:none}` to beat MARKET_CSS, and marketShell's
  `head` is emitted BEFORE MARKET_CSS so the same rule there would silently
  lose. It still does NOT depend on the purged `tailwind.css`.
  Five standing rules, all test-pinned: **the shop copy is PASSED IN** from
  `ORG.SHOP_COPY` (the same map the invite email and the create box read; the
  design's own wording on those cards is illustrative and this rule outranks
  it, and the muted "tell us which one you are" card is the SPARE COLUMN — it
  renders only while there are fewer than three kinds); **the prices are
  PASSED IN** from `PRICING`, which `/pricing` and the FAQ answer also read;
  **every privacy claim is a promise the code keeps** — the vault's closed list
  of exactly two exits, the never-retroactive auto-share guard, the member
  setting that beats the firm's (`org_members.auto_share`'s nullable third
  state) and `blend-comps.js` refusing a firm share the un-anonymized row;
  **the upload and vault panels are illustrative markup, not UI** (nothing
  posts or reads a file, and "Import 214 deals" is a `<span>` — a
  button-shaped link that goes nowhere is worse than a picture of one); and
  **the two dark bands carry literal colours** because `--slab` is dark in
  BOTH themes, so the ink ramp runs backwards on it (the trap FOOTER_DARK_CSS
  exists for, and the reasoning MARKET_CSS already records for `.mkt-hero`).
  **What did NOT survive the merge, deliberately:** `BROKERS_FAQ` and its
  FAQPage JSON-LD (owner's call — those questions belong on `/faq`, and only
  one page should carry FAQ structured data; the three answers not already
  covered there — submitting is free, who sees an owner's contact details, how
  long review takes — are owed to that page), the `MARKET_CREDIT` proof line,
  and the `#upgradeProLink` Pro card (the hook survives, guarded, in
  `ACCOUNT_NAV_JS` with no consumer). **What DID survive is the
  `/?submit=comp` door**, in the closing band: it is the site's only public
  entrance to the comp-submission modal, broker-contributed comps are the
  whole verified-comp layer, and design 4a drew no submission link at all.
  The hero PHOTOGRAPH the design shows is deliberately absent — the handoff
  asks for an industrial aerial cropped 3.4:1, supplies none, and says to ship
  without the band rather than with stock filler. Listed in `sitemap.xml`.
  Do not confuse this with `GET /broker/<slug>`, the per-contributor profile.
- `GET /pricing` — the rate card, at a URL for the first time (2026-08-28).
  Body in **`pricing-page.js`**. Pricing had lived ONLY in index.html's modal,
  which cannot be linked, indexed or emailed — and that modal carried Free /
  Pro / Founding and **no firm tier**, while the /how-it-works FAQ had been
  quoting the seat price in prose for weeks. The figures come from one
  **`PRICING`** constant in server.js (`monthly`, `foundingAnnual`, `firmSeat`,
  `minSeats` = `ORG.MIN_SEATS`) which the FAQ answer also reads, and
  `test/pricing-page.test.js` pins index.html's modal to the same numbers —
  that modal's own comment conceded "nothing catches a drift", which was true
  of a figure typed into three files. **The page never buys anything**: every
  control hands off to `/?pricing=1` or signup, because checkout needs the
  session, the entitlements and — for a firm — an orgId and an ownership check
  a cached page cannot make. The Firm tile's CTA is "how a firm works" for the
  same reason: a firm subscription is bought by an owner for a firm that
  already exists.
- `GET /1031-exchange` — public **1031 identification worksheet** (education
  page underneath; v4 slice 3 as amended 2026-08-14). Spec
  `docs/superpowers/specs/2026-08-14-1031-identification-worksheet-design.md`
  (amends `2026-08-08-1031-guide-design.md`). All content lives in the pure
  **`guide-1031.js`** — worksheet on top (relinquished property, closing date
  → 45/180 calendar dates, three replacement slots, each with a Value handoff
  through `pendingLandingAddress.v1`), then the explainer, FAQ array feeding
  both the accordions and the FAQPage JSON-LD, a **Choosing a qualified
  intermediary** vetting card, and the education-not-advice box. The date
  widget computes calendar dates only, never taxes or dollars, and hands both
  deadlines over as an `.ics` file built as a `data:` URI in the browser —
  deterministic for a given closing date, because its DTSTAMP derives from
  the closing rather than the clock. Sharing rides the URL fragment (`#p=`),
  so a street address never lands in a server log; reading stays free and
  unauthenticated. `renderGuide1031Body(signedIn)` picks the Value door (`/`
  vs `/?auth=signup`). The script also stamps localStorage `cnRef1031.v1`
  (guarded — no storage, no marker), which is how a later BOV request gets
  tagged `source: "1031"` — see `POST /api/lead`; the key is test-pinned
  because index.html reads the identical string. The route logs a PII-free
  `guide_1031` event per read (`source`: member/visitor on cookie presence;
  crawler UAs skipped via `isCrawlerUA`), feeding the "1031 guide funnel"
  card on `/admin`. server.js only dresses it in `marketShell` and spreads
  the module's JSON-LD nodes into the shared `brandGraph()` `@graph`.
  Education, never advice — the compliance strings are test-pinned in both
  directions (must-appear and must-never-appear), including that this is not
  a written identification and not an exchange CompNinja created, and that
  CompNinja is not a QI and holds no funds. Listed in `sitemap.xml`; linked
  from `MARKET_FOOTER`, `/how-it-works`'s footer, `/brokers-firms`, and a
  contextual one-liner after the CTA on every `/market/<slug>` page
  (`guide1031` in `renderMarketPageHTML`).
- **Brand entity** (not a route — `brandGraph()` in server.js). CompNinja is
  online-only, so it is **not eligible for a Google Business Profile** (Google
  requires face-to-face customer contact and video-verifies it against a real
  address; a listing filed anyway is suspended, not merely rejected). The
  structured-data brand entity is the substitute. `brandGraph()` returns one
  canonical `Organization` node (`@id` `<SITE_URL>/#organization`, legalName
  "CompNinja LLC", logo, public contact point) plus a `WebSite` node, spread
  into the `@graph` of every server-rendered page: `/market/<slug>`,
  `/markets`, `/brokers`, `/broker/<slug>`, `/how-it-works`. Those pages
  reference it via `ORG_ID` / `WEBSITE_ID` instead of restating it — **a new
  server-rendered page should do the same, never inline its own Organization
  or WebSite**. Two standing rules: the email is the public
  `info@compninja.co`, **never `LEAD_NOTIFY_EMAIL`** (the owner's personal
  inbox, and this is public output); and `sameAs` is deliberately absent
  because it means profiles the business actually controls, so add real URLs
  only when they exist. `index.html` needs no copy — under `ACCOUNT_WALL` a
  crawler at `/` gets the landing render, which spreads `brandGraph()` like
  every other server-rendered page.
- `GET /markets`, `GET /market/<slug>` — programmatic-SEO landing pages
  (directory + one page per market, e.g. `/market/industrial-ontario-ca`).
  The directory leads with the **momentum map** (see below) over its grid of
  cards; each card carries its market's momentum word beside the median.
  **Server-rendered, self-contained HTML** (own inline `<style>`, so they do
  NOT depend on the purged `tailwind.css`) built from `market-seed.json` —
  static data committed to the repo, so pages survive redeploys and serve
  instantly with no DB. **Every market page opens with a picture of its own
  city** (2026-08-21), resolved in `market-hero.js` in four steps: a curated
  Wikimedia Commons file, then a GENERATED one, then an Esri satellite aerial
  of the city's coordinates, then — only when there is not even a point —
  nothing. All photos are 3840×800, a 1920w `srcset` sibling, and a
  768×160 thumbnail for the `/markets` directory (a third stored size, because
  that page carries every market at once and scaling the 1920w files in the
  browser would make it a ~10 MB page). They are served from `market-heroes/`
  rather than hotlinked (Wikimedia asks not to be a CDN), with the credit and
  licence rendered on the photograph. `/admin/heroes` is the visual QA for BOTH
  photo layers, with a file-size/dimension grade in the tested
  `market-hero-quality.js`.

  **The grade skips a FILE, never a city** (`skipFilesFromRows` →
  `heroFor({ skipFiles })`, changed 2026-08-22). It was city-keyed while a city
  could only have one photograph; now that a curated pick and a generated one
  can both exist for one city, a city key would take the good one down with the
  bad. Not hypothetical: Ontario, CA's curated JPEG is an upscale of a 1600px
  original, so the generated layer is its understudy, and `/admin/heroes` marks
  a passing photograph that is not the live one **Standby**. The generator has
  the matching exception to "never generate for a curated city": it DOES run
  for one whose stored file fails the grade, measured off the bytes on disk
  (`curatedFileIsGood`), never configured. Commons has nothing better for
  Ontario as of 2026-08-22 — six HABS elevations of one packing house — so it
  stays on a satellite aerial, and the only remaining lever there is a decision
  nobody has made: whether a soft-but-real photograph beats a satellite tile
  (the 2026-08-15 rule says it does not).

  **The generated layer** is `market-heroes-auto.json` + `node
  scripts/auto-market-heroes.js` (`--city "Casper, WY"`, `--dry-run`,
  `--force`, `--limit N`, `--no-judge`). It exists because the Explorer
  publishes market pages from real searches, faster than anyone curates
  photographs for them: on the day it shipped, 21 cities were curated and 13
  live Explorer markets rendered with no picture at all. Per city it geocodes
  with Zippopotam (city-check.js's own service), gathers candidates from the
  English Wikipedia lead image, Commons categories, Commons geosearch and
  Commons search, ranks them on metadata (`market-hero-pick.js`), encodes the
  best, grades the encode, and **shows the finished crop to Claude**
  (`market-hero-judge.js`, ~a cent a city, `HERO_JUDGE_MODEL` to override) —
  the only step that can tell a skyline from a shopfront. Five rules:
  - **Its output is COMMITTED, like the curated files.** Render erases its
    disk on every deploy, so a photograph fetched at runtime would vanish; the
    script is run deliberately and its JPEGs and JSON go in the same commit.
    It is not part of `npm start` and requiring it starts nothing.
  - **Any verdict that is not a clear "good" ships no photograph.** A refusal,
    an unparseable answer, a failed call and an outright "bad" are one
    outcome: the satellite aerial, which is always right about WHERE the
    market is. A wrong good is a wrong city on a public page; a wrong bad
    costs a tile.
  - **Metadata cannot prove a city, so provenance does.** A Commons full-text
    hit must name the city in its title (searching "Casper Wyoming skyline"
    returns Skyline Drive, Virginia), and a geotagged photograph that does not
    name it must be within `NEAR_CITY_M` of the middle of it — the first run
    offered Agoura Hills a Library of Congress aerial of the Malibu coastline.
  - **The second crop is for a bad CROP, not a bad photograph.** A skyline is
    mostly sky, so the centred band can be mountains over a sliver of
    buildings while the picture itself is right (measured on Salt Lake City's
    lead image). A reviewer complaint about emptiness — and only that — earns
    one retry lower down the frame.
  - **Nothing in the generated file is believed on trust.** The file name
    becomes a URL under `/market-heroes/`, so it goes through the same
    `FILE_RE` the curated names do, and an entry missing its credit or its
    Commons title is unattributable and unused.

  **`.github/workflows/market-heroes.yml`** runs the generator monthly (and on
  a "Run workflow" button), then opens a PR with whatever it found rather than
  committing to main — a model approving a crop is not the same as somebody
  having looked at it. Unlike `ci.yml` it needs three repository secrets:
  `ANTHROPIC_API_KEY` for the reviewer, and the `SUPABASE_URL` /
  `SUPABASE_SERVICE_KEY` pair, without which it sees only the markets committed
  to the repo and would miss exactly the Explorer-published cities it exists
  for. It fails loudly on a missing secret rather than reporting "nothing to
  do". Setting them is Jacob's; the same command run locally needs nothing but
  the `.env` that is already there.

  **A market published since the last run of that script is still not blank**:
  `attachCityCoords` resolves the city's coordinates once at PUBLISH time (both
  the Explorer and the piggyback publisher) and stores them in the page's own
  payload, so the satellite aerial is available from the moment the page
  exists. It is deliberately resolved on the publish path and never on a
  render — a market page must never wait on a network call — and it fails
  open, leaving the page exactly as it was before this existed. Then: median/quartile $/SF, a cap-rate range, a
  market summary + `value_drivers` narrative, a recent-comps table (sortable,
  Sale/Lease filter; address links to `source_url` when the snapshot has a
  sanitized http(s) URL), and a CTA — owner valuation for anonymous visitors,
  Watch + CSV for signed-in ones. Op-ex, price trend, and a rent band render
  on a second ledger row when the snapshot earned them. Regenerate/expand with `node gen-market-seed.js`
  (edit its `TARGETS` list; it runs one cached search per market against a
  locally-running server and keeps only markets with ≥3 priced sale comps, so
  no thin pages). `sitemap.xml` lists `/`, `/markets`, and every market page.

  **The momentum map** (2026-08-25). `/markets` opens with a Leaflet map of
  the country, one pin per covered market coloured by that market's
  expanding / flat / contracting read; **clicking a pin** flies to the city,
  reveals its real municipal boundary washed in the city's momentum, and
  opens a card linking every market there. Each market page draws the same
  boundary under its comp pins, matching the "Momentum" badge already in that
  card's heading. The rules, in the order a future editor will trip over
  them:
  - **`freshDirection` (market-snapshot.js) is the ONE gate** for the
    three-word vocabulary and the 90-day expiry, on all FOUR surfaces: the
    Explorer dropdown badge, the `/markets` pins and cards, the market page's
    badge, and the wash under its comps. `test/routes.test.js` checks every
    one of them against `/api/markets` market by market — a second copy of
    the vocabulary or the age gate is what those tests exist to catch.
  - **Hollow/outlined is NOT flat.** No current read renders an outline
    making no colour claim, never grey's fill: "we don't know" and "the
    market is flat" are different statements. `market-area.js` decides the
    city-level claim when one shape holds several markets (see the
    pure-modules list above); `mixed` is grey inside an ink ring, and the
    legend swatch must keep matching what `areaStyle` actually DRAWS — it
    shipped as a green/red gradient that appeared nowhere on the map.
  - **`city-bounds.json` is COMMITTED**, like the market-hero JPEGs and for
    the same reason (Render wipes its disk on deploy, and a page surface must
    never wait on a network call at render time). `scripts/fetch-city-bounds.js`
    writes it deliberately — it enumerates seed + dynamic + Supabase markets,
    MERGES rather than clobbers, skips cities already stored, and takes
    `--city "Name, ST"` for one. The monthly `Market heroes` workflow runs it
    too, so an Explorer-published city gets its photograph and its boundary
    in the same reviewed PR.
  - **The two map surfaces make OPPOSITE trades on that file, deliberately.**
    `/markets` may eventually want every city's shape, so it lazy-fetches the
    whole ~110KB file on the FIRST PIN CLICK (never on page load). A market
    page wants exactly one city's shape, so it INLINES that geometry in its
    own blob (314 bytes for Ontario, ~6KB average) and fetches nothing.
  - **`areaStyle` (directory) and `boundaryStyle` (market page) are ⚠ MIRROR
    twins** — browser strings inside template literals cannot share code, so
    every number and token is a deliberate copy, and
    `test/markets-map-script.test.js` pins the two together plus the presence
    of every `DIRECTIONS` word in both.
  - **Every failure degrades to what existed before.** No boundary file, no
    entry for a city, a degenerate geometry, a blocked Leaflet CDN: the pins
    stand, the card still opens, and the comp pins still draw. A failed
    boundary fetch is never memoized (city-check's rule: ok and unknown
    memoize, an outage does not), so the next click retries.
  - **The reads expire on a CLIFF.** Every seeded page carries one
    `generatedAt`, so all of their momentum reads die on the same day
    (2026-10-12 for the current seed) and the map goes hollow at once.
    `scripts/check-market-freshness.js` reports the countdown and the weekly
    **`Market freshness`** workflow fails inside a 30-day window so somebody
    sees it coming; it needs no secrets. The only real fix is a regeneration
    (`npm start`, then `node gen-market-seed.js` — one billed search per
    market). **`scripts/derive-market-direction.js` cannot help**: it fills a
    MISSING direction from the page's existing trend sentence and never
    touches `generatedAt`, which is what the age is measured from. One
    consequence to know rather than fix: `/markets` is cached an hour for
    anonymous visitors, so on expiry day its pins can stay coloured for up to
    an hour after the badges elsewhere have gone dark.
- `POST /api/explore-market` — the **Market Explorer**: generates a
  `/market/<slug>` page on demand from the header search on the app page
  (one billed search per genuinely new market; results meeting the seed
  quality bar publish permanently to the Supabase `market_pages` table,
  thinner ones get a 30-minute in-memory `/market-preview/` page). Since
  2026-08-09 it **validates the city is real before the billed leg**:
  `city-check.js` (pure, tested) asks Zippopotam's keyless city endpoint
  and refuses unknown cities with a friendly 400 that never consumes the
  guest's free search or an `explore:` limiter slot. Three name variants
  are tried — as typed, punctuation-to-space, punctuation-stripped, each
  with leading "St "/"Ft "/"Mt " expanded — because measured GeoNames data
  is inconsistent about punctuation ("Coeur D Alene" answers 200 but "Lees
  Summit" is the stripped form); **do not "simplify" this to one variant**,
  strip-only shipped first and falsely refused Winston-Salem and Coeur
  d'Alene. Fails OPEN on validator outages (`DAILY_SEARCH_CAP` backstops);
  `ok`/`unknown` verdicts memoize per process, `unavailable` never does.
  Spec: `docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md`.
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
- `GET /api/accuracy` — the valuation-accuracy backtest card on `/admin`
  (added 2026-08-06; spec in
  `docs/superpowers/specs/2026-08-06-valuation-backtest-design.md`). Gated
  exactly like `/api/stats` (`isAdminRequest`: the `x-admin-key` header or the
  `cn_admin` cookie), and it is a full-corpus read, so it is kept OFF
  `/api/stats`'s critical path and memoized 15 minutes in-process
  (`?refresh=1` busts the memo). It hold-one-out scores every usable,
  ground-truth-provenance corpus sale against its own market+type peers using
  `valuation.js`'s real math (`backtest.js` — pure, requires nothing but
  `valuation.js`, so the harness can never quietly drift from what a customer's
  report actually computes) and reports median absolute error, band coverage,
  band width, and a per-type breakdown, with a skip-reason breakdown
  (`unusable`, `notGroundTruth`, `thinPeers`, `duplicateAddress`) so the
  figure is never read as more solid than its sample. Below a floor of 20
  scored subjects the card shows progress toward the floor instead of a
  number — a median over a handful of subjects swings too much to trust.
  **Fails safe with a 200** on any error or a missing corpus, same as
  `/api/corpus-audit`: `/admin` is the page opened when something else is
  already wrong, and this panel must never be what breaks it further. It
  measures the reconciliation MATH only (comps already in the corpus, not a
  fresh search) and runs untrended (corpus rows do not store the market trend
  a live search used), and the card says both of those things next to the
  numbers. Not a public accuracy claim — nothing from this ships to a
  marketing surface.
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
- **The watchlist digest** (2026-08-13; migration `025-watchlist-digest.sql`,
  **run before deploying**). `POST /api/watchlist/digest` mails each watcher
  the markets of theirs that have new comps. It is **the only thing this
  product sends on its own initiative** — everything else it mails answers
  something a person just did — and the whole file is written to that bar:
  when in doubt, send nothing.
  Copy and the "is this worth sending?" rule live in the pure, tested
  **`watchlist-digest.js`**; `buildDigest` returns **null** rather than an
  empty string when there is no news, so a caller cannot mail a blank digest
  by forgetting to check. The feed itself is `buildWatchlistFeed()` in
  server.js, **shared with `GET /api/watchlist/feed`** so the page and the
  email can never quote different numbers for the same market; the callers
  differ only in the cutoff they pass.
  Six rules a future editor will otherwise break:
  - **It is ADMIN_KEY-gated and manually triggered, never a timer.** A
    `setInterval` in this process would fire at an hour nobody chose, fire
    again after every deploy restart, and fire twice the day this runs on two
    instances — and the failure mode of all three is mailing real people the
    same comps again. A route makes the schedule an explicit decision (a
    Render cron, an Action, a person) and makes "run it and look" possible.
    **The trigger is the "Watchlist digest" card on `/admin`** — Preview
    (builds every email, sends none, marks nothing) and Send now (confirms
    first, and says the send cannot be recalled). "Manual" meant curl-only
    before that card existed, which is a feature nobody runs. One property is
    load-bearing and tested: **opening `/admin` must not send email.** Every
    other card there fetches on load, so the obvious way to write this one is
    the wrong way and the mistake is invisible — the page looks identical and
    the mail has already gone. `renderDigestCard()` takes no arguments and
    fetches nothing; the only call to the route lives inside the click
    handler. On a cadence, drive the same route from outside:
    `curl -fsS -X POST https://compninja.co/api/watchlist/digest -H
    "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' -d '{}'`.
    Nothing bad happens if that fires twice — the high-water marks make the
    second run a no-op — which is what makes an external scheduler safe here.
  - **The send cutoff is the LATER of `last_digest_at` and `last_seen_at`.**
    Two markers, deliberately: the digest reading only its own would mail
    comps the reader already saw in the app, and reading only `last_seen_at`
    would mail the same ones forever to somebody who never clicks the bell.
    The happy consequence is that an active user quietly stops receiving
    digests without ever unsubscribing.
  - **It refuses without a database (503) AND without outbound mail (503).**
    The second one is the subtle one: `sendOutboundEmail` is a silent no-op
    when `EMAIL_FROM`/`RESEND_API_KEY` are unset, so running blind would
    advance every high-water mark and DELETE a digest nobody received. This
    is the only caller for which that no-op is destructive, which is why the
    check is here and not there. `{ dryRun: true }` builds every email, sends
    none, marks nothing, and returns the copy — it skips the mail check on
    purpose, since inspecting copy should not need a verified domain.
  - **Mark AFTER the send, and only the markets that carried news.** A failed
    mark costs one duplicate next run; marking first would lose the digest
    outright on a failed send, and a lost digest is invisible where a
    duplicate is merely annoying. Markets with nothing new keep their old
    high-water mark, so the day one does get a comp the digest still reaches
    back to when the watch started.
  - **One bad account never stops the run** — the rest of the list is still
    owed its mail.
  - **Unsubscribe is a token link, and the GET only CONFIRMS.** `GET
    /watchlist/unsubscribe?u=&t=` renders a page whose button POSTs; the POST
    flips `users.digest_optout`. The second click is correctness, not
    politeness: corporate mail scanners and link-preview bots fetch every URL
    in an email, and a GET that unsubscribed would opt people out of mail they
    never opened. The token is an HMAC of the user id keyed on
    `SUPABASE_SERVICE_KEY` (guaranteed present, since the digest refuses
    without a database; domain-separated so it cannot collide with any other
    use of that key), so the link authenticates itself for somebody who is not
    signed in, months later, on a phone. `&on=1` is the same link in reverse —
    a one-way off switch with no way back is a support ticket.
- **Search demand on the desk** (2026-08-25). Each watched market on My Desk
  carries a line saying how many people searched it lately: "9 people ran 14
  searches here in the last 30 days, 6 of them Industrial." It reads
  `analytics_events`, which has logged every search since long before this
  shipped; nothing new is recorded and no hot path changed.
  **Pro-only**, via `canSeeSearchDemand` in `entitlements.js` — Pro, tester and
  comped-admin get it; a **single-report purchase does not** (the Address
  Explorer's argument: a $39 unlock buys one property's history, and a
  market's demand is not scoped to a property), and it is **false on a dark
  deployment** (the vault's argument, not the Explorer's: it never existed
  before the tier, and it reports this site's own traffic). A free account
  gets `demand_locked: true` on the feed item instead of a figure, which the
  card renders as the standard `.unlock-comps-btn` prompt.
  The RULES live in the pure, tested **`search-demand.js`**; server.js owns
  only the read (`demandRowsForMarkets`, filtered at the database — the
  `/admin` reducer's whole-table scan is right for a dashboard one person
  opens and wrong for a route every subscriber hits). Four of them exist
  because each is a way the number could flatter us, and the file's bar is
  under-claim, never over-:
  - **The broker's own searches are excluded** (`excludeUserId`). Without it
    the first thing a broker sees on their home market is themselves,
    reported as somebody else's interest.
  - **Explorer sweeps are excluded** (`source: "explore"`). One Pro
    subscriber walking a market address by address is not demand.
  - **A `signup_gate` counts** — a blocked visitor wanted the same answer —
    but is dropped when that visitor completed a search in the same market
    the same UTC day, because that is one attempt writing two rows.
  - **People and searches are separate numbers**, and where a row carries no
    `visitor_id` (anything before migration 026) they all collapse into ONE
    person rather than one each. Undercounting is the allowed error.
  Aggregate only: the payload is `{ window_days, searches, viewers, in_type }`
  and carries no address, email, visitor id or user id.
  `buildWatchlistFeed(user, ent, cutoffOf, { withDemand: true })` is
  **opt-in, and only the page opts in** — the digest does not, both because a
  search count is not news anybody asked to be mailed and because its loop
  over every account would fire one analytics query per watcher for a figure
  it discards.
  **It needs traffic to be worth reading.** At today's volume most markets
  answer "no one searched this market in the last 30 days", which is honest
  and is also the site telling a broker how quiet it is. The same
  prerequisite blocks routing real leads to contributors.
- `POST /api/redeem-passkey` — redeems `TESTER_PASSKEY` (comped Pro) or
  `VAULT_PASSKEY` (the broker vault) for the signed-in caller's account, on
  one route and one input: 401 if not signed in, rate-limited per IP, and the
  response's `granted` array names which door opened. 404s only when NEITHER
  passkey is configured. See both env bullets above for what each grant covers
  and why they are separate secrets.
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
- **Pro tier** (added 2026-07-31; launched to the public 2026-08-03). Paid plan
  holding free reports to a **36-month** lookback ceiling and
  **5 exports/month** (0 for anonymous visitors — exporting requires an
  account), against Pro's unlimited everything plus report branding.
  **The comp-list gate is GONE as of 2026-08-21**: `FREE_MAX_COMPS` is
  `"all"`, so a free account itemizes every comparable the search found,
  addresses and sources included. It went because the headline value range was
  already computed from the FULL comp set (comp-gate.js's `locked_basis`), so
  the gate was withholding the evidence for a number it had already published —
  and because the same "a crippled free report is not a demo of the paid one"
  argument had already widened the lookback. `gateReport()` is NOT dead code:
  it still caps whenever `maxComps` is a number, this tier just stops
  supplying one, and `test/comp-gate.test.js` keeps exercising the cap through
  an explicit `cappedEnt` so the machinery stays covered. **The consequence this had for the $20 single-report unlock resolved the same
  day**: with nothing locked its tile almost never surfaced, and the owner
  retired the sale outright (2026-08-21, see the single-report section below);
  purchases already made are honored forever.
  The free lookback was **12 months until 2026-08-04**. It was widened because
  at 12 months the free report often could not compute a valuation at all (the
  hero needs two priced sale comps and dense markets returned one), and because
  a window that short usually returned ≤4 comps, so the then-4-comp gate
  withheld nothing and the $39 tile never appeared. Not widened further: the window is
  clamped BEFORE the search and the model is asked for up to 12 comps
  regardless of plan, so a longer free window grows output — the cost and
  wall-clock driver — on the majority of traffic. The numbers live in
  `entitlements.js`; the pricing modal and both plan-card strings hard-code
  them in prose and must be edited together. The desk split belongs with
  those numbers: Free My Desk is an address list (cap 100), Pro is the book
  of values (cap 500), and the pricing compare table's Portfolio row restates
  it.
  **Bulk valuation** is Pro-only as well (`canBulkValue` / `bulkMaxAddresses`)
  — see its own section below.
  The **Address Explorer** is Pro-only too (`canExploreAddresses`) — see the
  amendment in its spec for why that gate needs a browser half AND a server
  half, and for the `proConfig` temporal-dead-zone trap that shapes the
  front-end code.
  **`entitlements.js`** holds the rules and is deliberately **pure** — no I/O,
  no clock reads (the caller passes `now`), no requires — which is what makes
  `npm test` able to exercise the whole decision table with no database.
  server.js owns the reads (`findSubscription`, `findReportPurchase`,
  `getExportUsage`, `findBrandingProfile`) and exposes the **only** sanctioned
  entry points: `getEntitlements(user, reportId)` and the request-shaped
  `entitlementsFor(req, reportId)`. **Never test a plan or subscription status
  anywhere else** — scattered plan checks are how a paywall grows holes.
  Everything **fails closed**: an unknown Stripe status, an unparseable
  period end, or a failed DB read resolves to the free tier, never to Pro.
  Two deliberate softenings of that, both tested: a **24h renewal slack** past
  `current_period_end` (Stripe renews at the boundary and the webhook lands
  seconds later — without slack a paying subscriber flickers to free), and a
  60s subscription cache that serves its last known answer if a DB read
  fails.
  **Comp gating** lives in **`comp-gate.js`** (also pure, also tested).
  `gateReport()` is applied at **serialization time only** — `/api/comps`
  gates at all three exits (cache hit, SSE `result`, plain JSON) while the
  cache, `harvestComps()`, and `maybePublishMarketSnapshot()` keep seeing
  **whole** reports, so one cached search serves free and Pro alike and the
  corpus never starves on free traffic. Selection is sales-before-leases
  (on a sales or mixed search the hero's range is sales-only, so a free list
  of leases would not support the number above it; a leases-only search
  headlines the rent range instead — see 3f) then best-first by a weight that **mirrors
  index.html's `compWeight()`** — a deliberate second copy that must stay in
  sync; there is a `⚠` comment on both.
  **`locked_basis`** is the load-bearing idea: one anonymized row per
  withheld comp carrying `date`/`transaction`/`size_sqft`/`price_per_sqft`/
  `source_type` (+`verified`, +`price_per_unit`/`price_per_acre`) and
  **nothing identifying**. Client-side `valuationComps()` =
  `includedComps()` + `lockedBasis()`, so the hero, the market comparison,
  the chart median and the stat tiles all read the FULL set — a free
  report's value range is identical to a Pro one (verified: the same report
  gated and ungated both produce $6,206,732–$6,529,080 from 14 sale comps).
  Basis rows must never reach the table, map, exports, or curation — they
  have no identity to render.
  Locked table rows are **redacted placeholders, not blurred real data**: a
  CSS blur would leave the values in the DOM, and the whole point is that
  the server never sent them.
  Two side doors are closed to match: `/api/corpus-comps` and
  `/api/watchlist/feed` return a `locked_count` instead of rows for free
  users (the feed keeps its aggregates — `new_count`, `median_psf`, trend —
  which are market figures, not comp data). `gen-market-seed.js` sends
  `x-admin-key` to bypass the gate and **throws if it gets a gated report
  back**, rather than silently seeding 4-comp market pages.
  **Billing (phases 3-7, done).** Stripe is spoken to over its REST API with
  plain fetch (`stripe.js`) — still zero npm deps. Server: `POST /api/checkout`,
  `POST /api/billing-portal`, `POST /api/stripe/webhook` (raw body, signature
  verified, acknowledged before the work), `handleStripeEvent()` for all six
  events with idempotent upserts, and `GET /api/pricing` (the founding counter,
  memoized 60s). Checkout, the portal and pricing all go dark while
  `PRO_ENABLED` is unset or the caller is outside `PRO_AUDIENCE`; **the webhook
  does not** — it carries no `PRO_ENABLED` check at all, because its gate is
  the Stripe signature and it must keep recording events regardless.
  Front-end, all in `index.html`: **one** pricing modal (`#pricingModal`), and
  every locked surface reaches it through the `.unlock-comps-btn` class →
  `openUpgradePrompt()`. Do not add a second upgrade prompt — give a new locked
  surface that class instead. `refreshBillingUI()` is the single owner of every
  billing control's visibility, driven entirely by `/api/config`; because
  entitlements are per-user, sign-in, sign-out, account deletion and the
  checkout return all call `refreshProConfig()` to re-read it. Checkout returns
  land on `/desk?checkout=success|cancelled` and the success banner **polls for
  the webhook** rather than assuming Pro is live, because Stripe redirects
  before the webhook arrives.
  **The `.pricing-buy` `data-plan` values must stay in step with the `PLANS`
  table in `/api/checkout`**, which is an explicit map with **no fallthrough** —
  an unrecognized plan is a 400. It used to map everything that wasn't the
  founding plan onto monthly, which is why a $39 button was unsafe to add;
  restoring any such default would re-arm exactly that mischarge.
  **The single-report unlock — RETIRED 2026-08-21** (shipped 2026-08-03 at
  $39, $20 from 2026-08-04). The one-off that bought every property-scoped Pro
  capability for one address + type. Retired by the owner the day
  `FREE_MAX_COMPS` went to `"all"`: with nothing locked inside the free
  window it was left selling only the ten-year window, and its tile — keyed on
  `lockedCount() > 0` — almost never surfaced. `single_report` is deleted
  from `/api/checkout`'s `PLANS` map, so buying it answers the same 400 as
  any unknown plan (the map's no-fallthrough design is what makes retirement
  one deletion, pinned by a source scan in `test/routes.test.js`), and
  `STRIPE_PRICE_SINGLE_REPORT` can be unset in Render and the price archived
  in Stripe. **Everything else stays, because purchases already made are
  honored FOREVER** — the unlock was sold as permanent for its address + type:
  - the `checkout.session.completed` and refund webhook branches still write
    and revoke `report_purchases` rows (an in-flight checkout can complete
    after the deploy, and a refund on an old purchase must still land);
  - `computeEntitlements` still grants per-property Pro (`reportUnlocked`:
    `maxComps: "all"`, `PRO_MAX_LOOKBACK_MONTHS`, unlimited exports,
    `canBrand`) when a purchase row matches;
  - `POST /api/report-access` still answers "do I own this report yet?", and
    `handlePurchaseReturn()` in index.html still handles a `?purchase=`
    return — with no seller writing `pendingUnlock.v1` these go quiet on
    their own, which is the point: the honoring side needs no trigger to
    remain correct;
  - `reportIdFor()` still **mirrors `exportReportKey()` byte for byte**
    (⚠ comment on both) — the purchase key and the export-tally key stay the
    same string, so an old buyer's report still never burns a free export;
  - `report_purchases.comp_snapshot` stays nullable and never written.
  Reselling a one-off later is an owner decision, not a merge accident: the
  source scan fails the build if `single_report` reappears in `PLANS`, so
  re-adding it means deleting that test deliberately. If it comes back,
  re-read this section first — the tile trigger (`lockedCount`), the
  `/?purchase` return path, and the id-excludes-lookback rule were each
  earned by a real mistake.
  **Report branding** (shipped 2026-08-08). `GET|PUT|DELETE /api/branding`
  lets a signed-in member save one profile (firm name, preparer, phone,
  email, license number, a short disclaimer, and a logo stored inline as a
  data URI — never a URL, because a cross-origin image taints the
  html2canvas canvas and silently breaks PNG export). Rules live in the
  pure, tested **`branding.js`**: `validateForSave` rejects an
  over-length field or a non-image logo rather than truncating it, and
  `brandForRender` decides what a given render is allowed to show. The mark
  appears everywhere a report does once entitled — the on-screen letterhead,
  the print footer, the PNG export, and the CSV, XLSX and PPTX exports — and
  the license number renders on all of those, not just the desk preview.
  **Co-branded, never white-label**: the surfaces (not `branding.js`) always
  add the CompNinja attribution and the automated-estimate line, on top of
  whatever the member's profile supplies; the owner is not a licensed
  broker, so a report carrying only a brokerage's mark would read as that
  brokerage's own appraisal. `/api/comps` carries `branding_allowed`
  (`ent.canBrand === true`) on every served report, computed per-report like
  `exports_remaining` — an existing $20 single-report buyer's `canBrand` is
  scoped to the property they bought (the sale is retired; the grants are
  not), not a live Pro subscription, so this cannot be folded into
  `/api/config`.
  **One profile, reused everywhere (2026-09-02).** The product asked for the
  same facts in five places — this card, the firm's branding, the vault's
  credit identity, the account, the comp-submission modal — and none read
  another. Now `GET /api/branding` also carries `suggested`
  (`BRANDING.suggestBrand`, pure: the vault's `broker_profiles` company,
  name and license first, then the member's oldest active firm's `orgs.name`,
  then the account's name and email; never `org_branding`, which already
  applies at render time and would freeze as a copy), and `fillBrandForm`
  pours it into EMPTY fields only, with `#brandSeedNote` saying where it
  came from and that it prints. The reverse door: `vaultReadPayload` sends
  `identitySuggest` from the member's saved branding ONLY while no credit is
  stated, and the identity form fills from it; the submission modal takes
  firm and phone from the saved branding; the create-a-firm box takes the
  firm name. **Every one of these is a prefill the member reads and saves,
  never a write** — that is what keeps the vault's "stated, never inherited"
  rule (`creditName`'s comment: a copied signup name was once published as
  somebody's firm) while the facts stop being retyped. Two honesty rules,
  test-pinned: the summary line reads "suggested, not saved yet" while the
  form holds a seed and no profile exists, and a delete blanks the form
  rather than re-seeding it.
  **A logo can be read off the firm's website (2026-09-02).** `POST
  /api/branding/logo-from-site { url }` fetches the page, picks its declared
  icon and answers a data URI; the branding card's "Import logo from website"
  control runs it through `resizeLogoDataUri` — the ONE resizer, which the
  chosen-file door now also calls — into the preview, kept only on Save.
  Rules in the pure `logo-import.js` (`test/logo-import.test.js`): the
  address must be public (localhost, IP literals, single-label hosts and
  embedded credentials are refused before any DNS); candidates are
  apple-touch-icon, then icons at least 64px, then the undeclared
  `/apple-touch-icon.png`, then og:image (measured on github.com: its declared
  icons are too small and its og:image is a homepage banner), then tiny
  icons, six at most, and
  `.ico`/`.svg`/`.gif` hrefs are never fetched; the BYTES decide, sniffed
  by account-avatar.js's `sniffImage`, a PNG narrower than 48px refused as a
  favicon, a PNG more than three times wider than tall refused as a banner,
  anything over 2MB skipped. server.js owns the fetch and it is the
  source-link check's discipline: every host resolved with
  `lookupWithTimeout` and refused on a private answer (`privateAddress`),
  redirects followed BY HAND with that guard re-run per hop, every body read
  under a byte cap (`readCapped`), a 6s timeout, our own UA. The site is
  fetched by our server only — no third-party logo service sees a firm's
  domain. `test/logo-import-run.test.js` runs it against a stub site
  (touch icon found; `.ico`-only and over-cap sites 404 naming the fix;
  redirect followed; unreachable 502; and, WITHOUT the test-only
  `LOGO_IMPORT_ALLOW_PRIVATE`, a loopback address refused before any fetch).
  **The firm fallback (2026-08-29; migration 041, `org_branding`).** A firm's
  owner/admin saves one profile for the org (`GET|PUT|DELETE
  /api/org/branding`, write gated on `ORG.canManageMembers`, validation
  shared with the personal editor), and a member's render falls back to it
  ONLY when their own profile normalizes to nothing — `brandForRender`'s
  `firmProfile` argument owns that ordering, own-always-wins, and
  `canBrand` still gates applying, so a free colleague stays unbranded.
  Oldest active membership wins if anyone is ever in two firms. The read is
  `findOrgBrandingFor` in server.js, deliberately fail-open (a failed org
  read must never cost a member their own letterhead or fail a share) and a
  SEPARATE table read by a separate function, never columns on `orgs` —
  `orgsByIds`/`findOrg` name their SELECT columns, the 030/036 hazard. It
  rides `GET /api/branding` as `firm` and the share snapshot inherits it
  (auto-share included). Two rules a future editor will otherwise break:
  - **A shared report renders the sender's snapshot and never the viewer's
    own profile.** `POST /api/share` looks up the sender's saved profile at
    share time (only when `user && ent.canBrand`) and writes it into
    `meta.branding` as a point-in-time snapshot, not a pointer — the report
    should look the way it looked when it was sent, and a share outlives its
    owner's subscription and even their account. `brandForRender`'s
    `isShared` branch returns `normalizeBrand(sharedBranding)`
    unconditionally and never falls through to the viewer's own profile: a
    Pro member opening a report their broker sent them must not see their
    own logo on someone else's work. `index.html`'s `normalizeBrandBlock()`
    is a deliberately narrower mirror of `branding.js`'s `normalizeBrand()`
    (camelCase/`logo` only) and must stay in step with it.
  - **Saving a profile is not the entitlement, applying it is.** `PUT
    /api/branding` is deliberately NOT gated on `canBrand` — any signed-in
    member can save one, because an unsaved-but-inert profile costs nothing
    (`brandForRender` returns null without the entitlement). The gate is on
    APPLYING a profile to a report, checked server-side at serialization
    (`/api/comps`'s `branding_allowed`) and again at share time (`POST
    /api/share`'s `ent.canBrand` check before the snapshot). This is what
    keeps the retired $20 unlock's branding promise fulfillable for the
    people who bought one: the
    entitlement it grants is scoped to one address+type, so a buyer with no
    Pro subscription can still save a profile in advance and have it apply
    the moment they unlock a report, without the editor itself needing to
    know which case it is.
- **The vault is part of Pro. There is ONE subscription** (decided and shipped
  2026-08-05; the vault itself is live). Ecosystem Plan v1 — design spec and
  the vault contract in
  `docs/superpowers/specs/2026-08-05-broker-tier-design.md`, which predates the
  decision and still describes two products; read it for the vault's design,
  not for how it is sold. The tier briefly existed as a second plan,
  `broker_monthly`, modelled as a superset of Pro. It was **removed rather than
  left unset**: it is gone from `/api/checkout`'s `PLANS` map,
  `STRIPE_PRICE_BROKER_MONTHLY` is deleted, and `entitlements.js` now reads
  `const broker = pro`. Nobody lost access, because that plan was never
  sellable — its Stripe price was never set, so checkout always 503'd for it
  and no subscription row in the wild can carry it. Four things to know:
  - **Vault routes test `ent.canUseVault`, never a plan name.** The result
    carries `broker` (identity, mirrors `pro`) and `canUseVault` (capability,
    mirrors `canBrand`); `/api/config` exposes both. The usual rule applies
    with more force than usual here — this gate guards private data.
  - **An unrecognized plan name now DOES open a vault**, matching `pro`, where
    status governs access and an unfamiliar plan on a paid row is treated
    generously. This reversed on 2026-08-05 and the test that pinned the old
    rule now pins the opposite. Failing closed on the name was right when an
    unnameable plan might have been a second product; with one product it would
    withhold half of what a paying customer bought.
  - **Access still lapses with the card.** `canUseVault` tracks `broker`, which
    tracks `pro`, so it goes false at the end of a cancelling period and at the
    end of the grace window. Nothing DELETES a lapsed vault — the only delete
    paths are the broker's own "remove this import" and account deletion — and
    the plan card says so, because a broker who uploaded their book and then
    finds the door shut will assume the worst otherwise.
  - **`PRO_ENABLED=off` grants no vault**, even though that branch grants every
    other capability. "Pre-Pro behavior" restores what visitors USED TO HAVE
    free; the vault was never free, it did not exist. The opposite would open
    an upload endpoint to every anonymous visitor on an un-launched deployment.
  **Selling it is copy, in three places, and they must agree**: the Pro tile's
  bullet list and the plan-card strings in `index.html`, and the vault page's
  own 403 in `vault-page.js`. All three say "Pro" and none of them may name a
  broker plan — a visitor sent looking for one finds a product that cannot be
  bought.
  The privacy wall is the product: no vault row may ever reach `harvestComps()`,
  `corpusRowsForMarket()`, a market snapshot, or another account's report.
  Enforce it with **separate tables read by separate functions**, not a
  `private` column filtered in the corpus queries — the corpus read path
  swallows its own errors, so one missed filter would leak silently.
- **Bulk valuation** (2026-08-21; migration `036-bulk-valuations.sql`, **run
  before deploying**; spec
  `docs/superpowers/specs/2026-08-21-bulk-valuation-design.md`). A Pro member
  pastes or uploads a list of addresses and gets a value on each, as one
  portfolio, at **`/bulk`**. Rules live in the pure, tested **`bulk.js`**; the
  page is **`bulk-page.js`** (a marketShell BODY, the /brokers-firms pattern, so it
  carries no chrome of its own); server.js owns the job tables and the worker.
  Routes: `GET|POST|DELETE /api/bulk`, `POST /api/bulk/cancel`,
  `GET /api/bulk/export.csv?id=`, all through **`openBulk`** — a deliberate
  THIRD copy of the vault's 401 → 403 → 503 ladder (`test/routes.test.js`
  catches the three drifting). Every finished row is also upserted into
  `portfolio_items`, so the valuation lands on My Desk as an ordinary saved
  property and **`?property=<id>`** on index.html opens it.
  Seven rules a future editor will otherwise break:
  - **One number, one place.** A bulk row runs `runCompSearch` and
    `finishReportForViewer` — the same two functions `/api/comps` runs — and
    values the result with `VALUATION.valueFromComps`. Those two came OUT of
    the /api/comps handler for this feature. A second path would make fifty
    rows disagree with the fifty reports behind them, and nothing on either
    screen could show it.
  - **A pasted line is ONE address, whatever commas it holds.** Splitting
    `123 Main St, Boise, ID 83702` searches for `123 Main St` in no city and
    reads `83702` as a square footage. Columns are read ONLY when a header row
    names an address column; then the vault's own `parseCsv` handles the BOM,
    the quotes and the `#` note lines.
  - **A job is an invoice.** Every address that misses the cache is its own
    billed search (~$0.36, 40-70s). Hence `BULK.MAX_ADDRESSES` = 50 as a hard
    ceiling, `bulkMaxAddresses` as the per-visitor half (the parser clamps the
    entitlement to its own ceiling, so entitlements can never widen a job),
    ONE live job per member read from the DATABASE, **`BULK_DAILY_ADDRESSES`
    as the per-member daily bound** (see its env bullet — one job at a time
    bounds concurrency, not spend, and without it a member could run ~$63/hour
    indefinitely), and the count and wall clock said BEFORE the button. There
    is deliberately **no header-only bypass** like `/api/comps`' `internal`: a
    bypass a browser was never meant to have must not grow one on a spend
    amplifier. The two caps split cleanly and should stay split: the per-job
    number is a PRODUCT limit and lives in `entitlements.js`, the per-day
    number is a SPEND backstop and lives in an env var, exactly as
    `maxComps` and `DAILY_SEARCH_CAP` do.
  - **`canBulkValue` is withheld on a dark deployment.** The vault's
    asymmetry sharpened: this is not merely an access surface but a SPEND
    surface, so `PRO_ENABLED=off` (the default) must not hand an unmetered
    invoice to every visitor. (It was withheld from a tester too until
    2026-09-01; testers are Pro outright now, and `BULK_DAILY_ADDRESSES` is
    the per-member backstop that bounds them exactly as it bounds a paying
    member.) The retired $20 unlock does not
    reach it either (the Address Explorer's argument: a tool for running fifty
    OTHER addresses cannot be scoped to one address+type).
  - **The worker outlives the request, so it holds no `req`/`res`.** That is
    why `vaultCompsForReport` takes a `user` (2026-08-21) and
    `orgCompsForReport` dropped the `req` it never read. The per-market vault
    and firm reads are memoized as PROMISES, not rows: caching rows and
    filling them in later hands the second and third concurrent rows in a
    market an empty vault, which is invisible because an empty vault is a
    normal state.
  - **A stalled job is decided at READ time**, never by a timer or a boot
    sweep (migration 025's argument): a worker writes `heartbeat_at` after
    every row, and a read older than `BULK.STALL_MS` marks the job
    `interrupted` once. Nothing is lost — finished rows are already written,
    and re-running the list serves them from cache for free. Reaping also runs
    before the one-job-at-a-time check, so a deploy mid-run cannot lock
    somebody out of their own tool for the stall window.
  - **Nothing is dropped silently, and a failure is not $0.** Places rather
    than properties, duplicates, unparseable sizes and truncation past the cap
    are each reported by line number; `BULK.summarize` sums only rows that
    produced a figure and says how many. `sale_comps` is what a row shows, not
    the comp count — the band comes from the sales.
  **The worker is proven end to end** by `test/bulk-run.test.js`, which
  stands a stub provider in front of `SEARCH_API_URL` and runs a whole job:
  the search, the valuation, the desk upsert, the harvest, the cache write,
  the job's completion, and a second run of the same list costing zero
  searches. It also pins that one failed address costs the row and not the
  run, and that the vendor's own error text never reaches the member.
  Deliberately not built (see the spec's §5): mixed types in one job,
  per-address lookback/details, an automatic resume (re-running IS the resume,
  free from cache), a shareable portfolio, and any scheduling.
- **Broker vault** (v1 server side 2026-08-05; the `/vault` page followed on
  2026-08-06 — see "The `/vault` PAGE lives in `vault-page.js`" below). `GET|POST|DELETE
  /api/vault*` — the broker's private comp store. DDL in
  `migrations/013-broker-vault.sql` (**run before deploying**); plan in
  `docs/superpowers/plans/2026-08-05-broker-vault-v1.md`. Routes:
  `GET /api/vault/template` (the CSV a broker fills in), `POST
  /api/vault/upload` (JSON `{filename, csv}` — deliberately not multipart,
  which would be hundreds of lines of hand-rolled parsing in a repo with no
  dependencies; also accepts `{filename, rows}` from the PDF confirm table,
  converted through `exportCsv` then `parseUpload` — the CSV path is
  unchanged), `POST /api/vault/extract` (JSON `{filename, file}` — base64 —
  sends the file to the extract vendor with no search tools, writes nothing,
  and returns `{ rows: [{ values, error }] }` for the confirm table),
  `GET /api/vault` (filters by `market` and `type`), and
  `DELETE /api/vault/upload?id=` (undo one import; comps cascade).
  All of these routes go through one `openVault()` helper: 401 not signed in →
  403 not a broker (`canUseVault`) → 503 no database.
  - **`/api/vault/extract` takes screenshots too** (2026-08-13). The file a
    broker actually has is often a screenshot of a CoStar table or a photo of
    a printed comp sheet rather than an exported PDF, and both providers read
    an image on the same call the PDF uses, so it is the same route, the same
    prompt, the same confirm table and the same "nothing is stored" promise.
    Four rules:
    - **The BYTES decide the media type, never the filename and never the
      browser's `type`.** `sniffExtractMedia` reads magic bytes and
      `checkExtractFile` (type + size, one place so the refusal copy cannot
      drift) is what the route calls; a `mediaType` taken off the request body
      would defeat the check that exists to stop a renamed `.xlsx` reaching a
      third-party vendor. A test pins that the route never reads one.
    - **`EXTRACT_MEDIA_TYPES` is the INTERSECTION of the two providers**
      (pdf/png/jpeg/webp), not the union: Anthropic reads GIF and Gemini does
      not, Gemini reads HEIC and Anthropic does not, and a file that imports
      on one deployment and refuses on another is a bug nobody can reproduce.
      Adding a type means checking both vendors.
    - **HEIC is recognized in order to be refused BY NAME.** An iPhone photo
      is the likeliest unsupported file to arrive here, and a generic "that
      file isn't something we can read" would send a broker looking for a
      fault in their comp sheet instead of exporting a JPEG.
    - **Only the Anthropic provider branches.** A PDF is a `document` block
      and an image is an `image` block there; Gemini's `inline_data` carries
      whichever `mime_type` it is handed. `buildExtractBody` takes
      `{ fileBase64, mediaType }` on both.
    The body field is `file` (`pdf` is still accepted, so a browser holding a
    cached copy of the old page still works). One ceiling covers both kinds,
    `MAX_EXTRACT_BYTES` = 4 MiB, sized against the handler's 8 MB body cap
    because base64 costs a third more than the bytes it carries. The
    `vault_extract` analytics event names the kind (`ok:image:5`), which is
    the only place "do brokers bring PDFs or screenshots?" can be counted.
  - **The confirm table carries a per-sheet rent basis** (2026-08-29). Lease
    sheets state a rate and never the word "annual"/"monthly" — within a
    market it goes without saying — which made them close to unimportable
    (4 refused rows in the 2026-08-28 extraction verdict). The basis stays
    required per ROW (migration 029: a guess is 12x wrong); the sheet-level
    answer is the broker's, chosen once on `#pdfBasisRow` (rendered only
    when a row has a rent and no basis — the Buy-button rule, and no
    default) and STAMPED visibly into exactly those rows' cells, curing the
    rows whose only blocker it was. A stated or hand-typed cell always wins
    (`stampedBasis` tracks the selector's own writes). The needle it cures
    by (`RENT_BASIS_NEEDLE` in vault-page.js) is a ⚠ mirror of
    broker-vault.js's refusal, pinned by test; the server re-validates every
    imported row regardless. The value travels IN the rows — zero server
    change. Three extract-prompt rules shipped with it, all pinned in
    test/routes.test.js: the `undated` sentinel scoped to
    document-has-no-date-column; rent_basis never inferred from market
    convention; and addresses street-verbatim with "City, ST" completion
    only when the document itself proves the state — the 2026-08-28
    verdict's dedupe-key instability, made deterministic.
  - **A bare address is offered its city, never handed one** (2026-09-02).
    A firm's own sheet writes "123 Main St" because everyone there knows
    which city, and both import doors refused every such row — the CSV by
    line number, the confirm table only AFTER Import, since
    `classifyExtractRows` never asked. Now `POST /api/vault/inspect` and
    `/api/vault/extract` answer `marketSuggest` (`count`, a `sample` of the
    bare rows, and `candidates` ranked **this file → the broker's vault →
    their coverage**, the order in which each is likely to be what the sheet
    left unsaid), and each door asks ONCE: the mapper's `#mapMarket` row
    (`CONST_ASK`'s shape) and the confirm table's `#pdfMarketRow`
    (`#pdfBasisRow`'s shape). Rules, all test-pinned
    (`test/vault-market-complete.test.js`, `-run.test.js`, the page suite):
    - **Nothing is applied until a person picks.** The blank option is
      today's behaviour (those rows are left out and named). The pure
      `suggestMarketCompletion` writes no address; `marketOf` is INJECTED
      beside `hasMarket`, and a market string that is not itself canonical
      is never offered back (a vault row misfiled before `hasMarket` existed
      must not become a completion).
    - **The CSV door completes on the SERVER**: `completeWith: "City, ST"`
      on `/api/vault/upload`, canonicalized by the route (`canonicalMarket`
      — "boise, id" files as "Boise, ID"; a non-market is 400 before any row
      is read), then composed inside `parseUpload` right where
      `composeAddress` runs — only onto an address that still fails
      `hasMarket` AFTER the mapped City/State columns had their say, so a
      row naming its own city keeps it — and the result still passes the
      ordinary `hasMarket` gate, so "Boise, Idaho" is refused with the
      ordinary message naming the string it produced. `completed` /
      `completedAs` ride the response and the result line says "N addresses
      completed as Boise, ID". The rows door never takes it: confirm-table
      rows carry their completed addresses in the cells, stamped visibly by
      the selector (`joinMarket`, a ⚠ mirror of `composeAddress`'s
      append-only rule, pinned on three shapes), a hand-typed address always
      winning and the blank option putting a stamped row back.
    - **`MARKET_NEEDLE` is a ⚠ mirror of `MARKET_REFUSAL`**, exported so the
      page test pins it — `RENT_BASIS_NEEDLE`'s reason.
    - **`POST /api/vault/confirm-market` is a badge, never a gate.** After a
      pick, and only then, ≤10 completed streets go to `geocodeCensus` — our
      own in-process call, never Nominatim, never the browser (migration
      017's wall) — and the row says "k of n found in Boise, ID". A miss on
      a rural or new address is ordinary, so "0 of n found" is information,
      not a refusal. Writes nothing, logs no address, through `openVault`.
    - **The mapper opens for a clean template that holds bare addresses**
      (every column already mapped, one question) — the deliberate bend of
      "the screen is shown only when a header is not ours": that rule's
      reason was that there was nothing to ask, and now there is. The
      mapper re-asks inspect only when the address trio of the mapping
      changes (`trioSig`), since a City column mapped onto `address_city`
      is what makes a bare street whole and the question then disappears.
    - **The extract prompt is untouched.** It still never guesses a city
      the document does not name; the completion is the broker's act.
    Not built: bulk valuation and the firm-buildings form still refuse a
    bare address with their own messages (owner's scope, 2026-09-02).
  - **Per-comp editing, adding and export** (2026-08-10). `PATCH|DELETE
    /api/vault/comp?id=` fixes or removes one stored comp; `POST
    /api/vault/comp` adds one by hand (a broker who closed a deal on Tuesday
    should not have to author a CSV); `GET /api/vault/export.csv` downloads
    the whole book. **Every cell on `/vault` is typed into directly**
    (2026-08-16): one field per cell, saved on leaving it, so Tab/Enter work
    like a spreadsheet and Esc restores the stored value. There is no Edit
    button — the compact table's own cells are the editor, and the inline
    edit form it used to open is gone. Three rules the compact table adds
    over the spreadsheet, all in `vault-page.js`. **`CELL_FIELDS` excludes
    the two derived columns**: `market` is parsed from the address by
    `marketOf()` server-side and `price_per_sqft` is computed by
    `normalizeRow` for priced sales only, so offering either as an input
    would let a broker type a figure the very next save silently overwrites;
    they render as `td.ro` cells and are **refreshed from the row the PATCH
    returns**, because a price edit that left the old $/SF sitting beside it
    is a wrong number in a priced column. **A cell shows the formatted figure
    and swaps to the raw one on focus** (`data-raw` + `cellDisplay`), since a
    book of business is read far more often than edited and every price
    becoming `1250000` is not an acceptable cost of making it editable; the
    value put back after a save is the SERVER's normalized one, never the
    string that was typed. And **a save that lands after the table was
    rebuilt** (a sort, a filter, a delete's reload) re-renders instead of
    writing into the detached input, or the row would show the pre-save value
    with a refreshed $/SF next to it. Spreadsheet mode (`Open spreadsheet`,
    or Open on that import) stays as the other door: it is the only place
    `cap_rate`/`tenancy`/`year_built`/`notes` and the per-type extras have
    columns, and its cells deliberately show STORED values with no
    formatting, because it is the view a broker opens to check what an import
    actually landed. **`EDITABLE_FIELDS` in `broker-vault.js` is an
    allowlist**, not a second validator — `validateEdit(existing, patch)`
    merges the patch over the stored row and reruns it through
    `normalizeRow`, the same function every imported row goes through, so a
    hand-typed "1.2M" or an Excel serial date fails an edit exactly as it
    fails an upload.
    **Editing or deleting a PUBLISHED comp retracts it** (`retractPublishedComp`)
    — deletes the `comp_submissions` row and clears `published`/
    `published_at`/`published_submission_id` — and **the retraction happens
    only AFTER validation succeeds**, never before. It shipped the other way
    round first: retracting ahead of `JSON.parse`/`validateEdit`/the
    collision check meant a broker's REJECTED edit (typing "1.2M", the exact
    input the vault exists to refuse) still pulled the comp from the public
    records and stripped its firm credit before the 400 was ever returned —
    the broker saw only a parse error and had no way to know what had
    happened, and if the submission had already been approved, republishing
    creates a fresh PENDING row needing manual owner re-approval, so the
    credit does not come back on its own. DELETE has no validation step that
    can fail, so it stays retract-first.
    **An address edit nulls `property_id`** before the write, specifically
    when `row.address_key !== comp.address_key`, never on an untouched
    address. `linkVaultProperties`' relink PATCH only ever fills a NULL
    `property_id` (`property_id=is.null`, so a re-import can't rewrite a
    link that already looks correct) — left non-null after an address
    change, a comp would keep pointing at the OLD building forever and
    `attachPropertyCoords` would stitch the old building's coordinates onto
    the corrected address in every future report.
    **The export must be complete or refuse.** It does NOT build on
    `vaultReadPayload`, which hard-caps at 1000 rows; it pages until an
    EMPTY page comes back, advancing the offset by the rows actually
    returned rather than by the page size, because PostgREST can honor a
    project-level Max Rows setting by returning fewer rows than requested
    with no error — treating a short page as "done" would silently truncate
    at whatever that cap is. It orders by `deal_date.desc,id.asc`
    specifically because `deal_date` alone is day-granularity and ties
    across many rows in an imported book; Postgres only guarantees stable
    OFFSET/LIMIT paging when the ORDER BY produces a unique row order, so a
    non-unique sort key can drop (or duplicate) a comp on a page boundary.
    It also JOINS `broker_properties` for `lat`/`lng` — those are not
    columns on `broker_comps` — and separately carries every populated
    per-type column (`clear_height`, `units`, `lot_acres`, etc.), which ARE
    columns on `broker_comps` and ride along for free because the paging
    query passes no `select=`; `VAULT.exportColumns` then appends only the
    ones actually populated. Omit either source and a re-import silently
    drops that comp's specs or sends a private address back out to a
    third-party geocoder, which migration 017 and `parseCoord` exist to
    prevent.
    No migration was needed for any of this: `broker_comps.upload_id` was
    already nullable (a hand-added comp belongs to no import, so it can only
    ever be removed per-comp, never by deleting an import), and every new
    field these routes touch already had a column.
  - **Blended comps** (server half, 2026-08-06). A broker's own vault comps
    appear inside **their own** reports, flagged `private: true` with
    `source_type: "broker_vault"`, plus a top-level `private_count`. Rules in
    the pure, tested **`blend-comps.js`**; the `user_id`-scoped read is
    `vaultCompsForReport()` in server.js. Spec:
    `docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md`.
    **Blending happens at SERIALIZATION only** — the exact mirror of
    `gateReport()`'s rule. It runs inside the `gate()` closure in `/api/comps`,
    which is the single funnel all four exits route through, and therefore
    downstream of `storeCachedSearch()`, `harvestComps()` and
    `maybePublishMarketSnapshot()`, all of which keep seeing the **public**
    report. Blend earlier and it fails silently twice over: before the cache
    write, one broker's private book is served to the next visitor who searches
    that address (`search_cache` is keyed by property, not by user); before the
    harvest, the rows enter the public corpus permanently with nothing alerting
    anyone, because that path swallows its own errors. **`POST /api/share`
    strips them** — it takes the report FROM the browser, and a broker's
    browser holds a blended one. A vault comp claims no public provenance: not
    `verified` (a public claim, earned by vouching in the public records) and
    not the enum default (which normalizes to `estimate` and would stamp a real
    closed transaction as guesswork). An empty vault returns the **same report
    object**, with no `private_count` key at all, so a non-broker's response is
    byte-identical to before the feature existed.
  - **The `/vault` PAGE lives in `vault-page.js`, not `server.js`** (moved
    2026-08-06). It is a web page, so it belongs to whoever owns the front end;
    as a 475-line block inside `server.js` it could not be edited without
    editing the server file, which made front-end and server work collide by
    accident. **Since 2026-08-30 it renders a BODY, not a document**
    (`renderVaultBody(boot)` — Task 9 of the rail plan): the doctype, head,
    header and footer are `marketShell`'s, exactly as for `/markets`,
    `/brokers-firms`, `/pricing` and `/bulk`. Its old twelve-key chrome
    object (`CN_LOGO`, `RAIL_CSS`, `ACCOUNT_NAV_*`, `FOOTER_*`, `THEME_*`,
    `NAV_SHELL_CLASS`) is gone — every key existed only to rebuild by hand
    what the shell already had, and rebuilding it is what made this the page
    that drifted. **The DATA is still resolved in `server.js` by
    `vaultReadPayload`, which owns the entitlement gate**; `vault-page.js`
    only decides how that data is drawn. Keep it that way — a read that
    happened there would be a read outside the gate.
    Two rules the fold leaves behind, both easy to undo by accident:
    - **The page's stylesheet is emitted in the BODY, after `MARKET_CSS`.**
      That is `bulk-page.js`'s pattern and it is load-bearing, not tidiness:
      this page redefines `body`, `a`, `.wrap`, `main.wrap`, `.card`,
      `.kicker`, `.ledger` and `.lcell`, so its rules must come later in
      document order to win on equal specificity. `marketShell`'s `head`
      parameter is emitted BEFORE `MARKET_CSS` and would lose.
    - **A shared selector leaks every property the vault does not set.** Both
      stylesheets use `.card`, `.ledger`, `.lcell`, `.btn`, `table`, `th` and
      `td` for entirely different components. Six declarations leaked on the
      first pass (margins on `.ledger`/`.card`, a right border and flex basis
      on `.lcell`, tabular figures and a 180px first column on the comps
      table) — found by rendering a populated vault before and after and
      diffing computed styles, not by reading. `test/vault-shell.test.js`
      COMPUTES that set from the two stylesheets and fails the build on a new
      one; the fix is to state the property on the vault's own rule.
    `INTER_FONT_HEAD` rides through `marketShell`'s `head` for this page
    alone: `MARKET_CSS` names Inter in `body{}` and no server-rendered page
    fetches it, so without that link the fold would silently have restyled
    the page brokers use daily.
  - **TWO DECKS, not ten peer sections** (Vault Direction U, approved and
    shipped 2026-08-10; card `vault/direction-u-two-decks.html`). The page is
    two products sharing one scroll, so it carries exactly two deck rules —
    serif label, ink rule, the deck's one action — and they are the level
    ABOVE `h2`. **Your book** holds the uploader, the market rollup and the
    comps; **Your pipeline** holds one table from a new lead through won or
    lost (leads and BOVs used to be two sections; they merged 2026-08-13).
    Five rules:
    - **`#addSec` is a panel, not a section, and ships CLOSED.** "Add comps"
      was a section above the comps table, so a broker with 200 comps opened
      their book and was handed an uploader. It is the book deck's action now.
      `setAddOpen()` is the single writer of its visibility (the label and
      `aria-expanded` ride with it); `applyFirstRun` only re-asserts the flag
      and deliberately does **not** force it shut, because `#res` lives inside
      the panel and an import that failed before it could raise the comp count
      would otherwise write its error into something invisible. `doImport`
      opens it for exactly that reason on the non-mapper path.
    - **Dragging a file anywhere over the page opens it.** `#drop` is inside
      that closed panel, so without the document-level `dragenter`/`dragover`
      handler drag-and-drop would silently stop existing. It is guarded on the
      book deck being visible (a 403 hides `#app`), not on a first-run page —
      the empty vault IS the two decks (2026-08-13).
    - **`.deck.hide` and `.strip.hide` are load-bearing.** Both classes set
      `display`, and both are declared BELOW `.hide` in the same stylesheet, so
      a plain `deck hide` loses the cascade and leaves a stray "Your book"
      rule. Found in a browser, not by reading. Same trap as
      `ACCOUNT_NAV_CSS`'s `[hidden]` line. Decks now ship visible; the line
      still matters if a future gate adds `hide`.
    - **The empty vault is the real vault** (2026-08-13). Both decks and the
      trust line (including zeros) always show. `#bookEmpty` / `#pipeEmpty`
      are invitations, not a numbered `#firstRun` page. Spec:
      `docs/superpowers/specs/2026-08-13-vault-empty-workspace-design.md`.
    - **One hidden-sibling CSS patch, `#rollupSec.hide + #compsSec`.** It
      replaced two others (`#firstRun.hide + #addSec`, `#addSec.hide +
      #mapSec`), which stopped being needed once those two became divs. Keep
      such rules scoped to the specific pair — a blanket hidden-sibling rule
      also strips dividers that are correct.
  - **The vault DASHBOARD** (2026-08-06, re-ranked 2026-08-10). `/vault` leads
    with a market rollup —
    one card per `market` + `property_type`, the same pair the lead coverage
    below it is keyed on — then a median-$/SF-by-year chart and a
    repeat-property list, all three scoped by one filter row. **Since Direction
    U those three are collapsed `<details class="dbox">` under a three-cell
    reading strip** (`renderStrip`), not three bordered panels in front of the
    table: measured on a seeded book the comps table moved from 4363px down
    the document to 1101px. Two rules for the strip. Its median comes from the
    same `psfList`/`median` pair that seals the table's own footer, so the two
    can never quote different figures. And a cell is a `<button>` **only** when
    the panel behind it is actually showing — an affordance over a hidden panel
    is a control that does nothing. `renderGutCheck` and `renderRepeats` feed it
    through the module-level `lastGut`/`lastReps` rather than a changed return
    type, because the return value is the outlier map the table reads. Four
    further rules:
    - **What publishing gave back** (2026-08-17). `comp_submissions.cited_count`
      has existed since migration 003 and `bumpCitedCounts` has incremented it
      on every earned badge ever since — and it was rendered in exactly one
      place, the "Report citations" tile on the PUBLIC `/broker/<slug>`, which
      exists at all only once a broker opts `broker_profiles.public` to true
      (false by default, per broker-directory.js's two-consents rule). So the
      one person who could not see the credit was the broker who earned it, and
      a vault-first broker published comps and got no signal back whatsoever.
      This surfaces the existing number: per comp beside the Published chip,
      and summed under the ledger's Published cell. **Nothing new is counted
      and no hot path changed** — `attachCitedCounts` is a read, chunked at 200
      ids because the in.() list would otherwise outgrow a URL, and it **never
      throws**, because a citation count is a reward and a vault that would not
      open without one would be a strictly worse trade. Two honesty rules: the
      count is **omitted at zero** rather than shown as "0" beside every
      freshly published comp, and the tooltip says it is counted **when a
      report is generated**, since a cache hit serves the stored report without
      re-running `attachVerifiedAttribution` and therefore does not bump it —
      the figure is a floor, not an impression count. `cited_count` reaches the
      browser through `vault-api.js`'s **`SUBMISSION_FIELDS`**, a third checked
      list beside `PROPERTY_FIELDS` for the same reason that one exists: it is
      not a `broker_comps` column, so putting it in `API_COMP_FIELDS` would
      correctly fail the both-ways schema test.
    - **Bulk publish** (`POST /api/vault/publish-many`, 2026-08-17). Publishing
      is how the public corpus grows and it was one button plus one identical
      confirm per comp, so in practice nobody published a book — they published
      a comp. The button counts the UNPUBLISHED comps in the current view and
      deliberately does not decide eligibility: `VAULT.canPublish` is the rule,
      a browser copy would be a second one, and the route reports what it
      skipped and why (naming the first reason, since they repeat). Its own
      route rather than an `ids` array on the single one — that contract's
      404/400 are right for one comp and wrong for fifty, where "some of these
      are not ready" is the normal answer. Same `openVault` gate, same
      `user_id` scoping, same credit-name refusal, asked ONCE before anything
      is written. Insert and PATCH stay **paired inside one task** at
      concurrency 6, never one bulk insert with ids read back positionally:
      repeat properties are real here, so returned rows could not be re-paired
      by address even in principle. A PATCH that fails after its insert
      **deletes the submission back out**, or the comp sits in the public
      records crediting a row the vault still calls unpublished and a re-run
      credits it twice. Capped at `VAULT_PUBLISH_BATCH` (100) per request,
      reporting `remaining` rather than refusing, which is safe because
      publishing is idempotent.
    - **Undo a delete** (2026-08-17). A hard delete behind one confirm sat
      oddly against a codebase that refuses a file fallback rather than risk
      losing a broker's book. The message now carries an Undo that re-posts the
      comp through **`POST /api/vault/comp`**, the ordinary add route, so a
      restore goes through `normalizeRow` like every other written comp and
      cannot put back something the vault would refuse to be told today.
      Three rules: it is held **in memory only** — this catches the misclick
      noticed immediately, not a deletion regretted tomorrow, and a store that
      emptied on reload would promise more than it keeps; the restore is a
      **new entry** belonging to no import, said plainly rather than left to be
      discovered; and a comp that was published **is not republished** by
      putting it back, because publishing is a deliberate public act and
      undoing a delete is not consent to repeat it. The confirm no longer says
      "this cannot be undone", since that stopped being true.
    - **Four filters, and only one of them is a search.** Market and Type
      narrow to a slice; Deal (Sale/Lease) exists because the two are priced
      in different units and a view holding both can state no median; and the
      Find box searches address, notes, market, type and tenancy, ANDing its
      terms so two words mean both rather than the phrase. All four compose,
      all four are cleared together, and **opening one import clears every one
      of them** — a search left over from the previous view would hide the
      comps that import just landed. **An empty result names which of the two
      empty states it is**: "No comps match this filter" with a Clear link
      when the book is non-empty, and the upload invitation only when it is
      genuinely empty. Telling a broker who searched for a deal they own that
      there is "nothing here yet" reads as the vault having lost their book —
      the same misreport-an-outage-as-absence trap the hub list and the lead
      inbox each had to fix.
    - **The page fetches `?limit=1000` and filters in the BROWSER.** It used to
      re-query with `market=`/`type=` params, which cannot work now: the rollup
      counts the whole book, and server-side filtering leaves the browser
      holding only the current slice. It also fixes a real bug — the route
      defaults to `limit=200`, so a broker with 400 comps was shown half their
      vault with nothing saying so. Past 1,000 the page says it is truncated
      rather than under-reporting silently.
    - **Every rate figure comes from a stored column, never derived here.**
      `broker-vault.js` writes `price_per_sqft` for **sales only** and leaves
      it null on a lease, because an annual rent ÷ size is $/SF/yr and would
      corrupt any median it entered; it writes `rent_psf_yr` for **leases
      only**, from the broker's `rent_psf` × their stated `rent_basis`. The
      page reads both and never recomputes either. A bucket with neither shows
      its comp count instead of a fabricated number.
    - **Lease rent (migration 029, 2026-08-17).** Until then the vault only
      really worked for investment sales: the template said to leave `price`
      blank on a lease and put the rent in `notes` as prose, so a leasing book
      carried no figure any median could read and every card said "no priced
      sales yet". Four rules.
      **`rent_basis` is required with a rent and has no default** — California
      industrial and retail quote rent MONTHLY while most of the country
      quotes annually, so $1.35/SF is an ordinary monthly rent and an
      impossible annual one; defaulting either way stores a figure 12× wrong
      in a broker's own records, which is the class of error this module
      refuses "1.2M" to avoid. **`lease_type` (NNN/FS/MG) is optional and
      disclosed**, the deliberate asymmetry: mixing bases makes a median
      WRONG, mixing structures makes it WEAKER, and those get different
      answers — the footer says "mixed lease types" rather than refusing.
      **Sales and leases are never averaged together**: a view holding both
      states no median and names the Deal filter, which is why that filter
      had to ship first, and the rate column heading changes with the unit
      rather than labelling annual rents "$/SF". **The gut check abstains on
      leases** — corpus quartiles and market-page figures are sale $/SF and
      there is no public rent benchmark — which holds by construction because
      leases carry no `price_per_sqft`; a rent fallback in `psfOf` would break
      it, and a test pins that.
      Rent is deliberately **not carried into the public corpus**:
      `comp_corpus` has no rent column and `submissionRowFrom` is an explicit
      allowlist, so a published lease carries what it always did. Giving the
      corpus a rent column is its own decision with its own provenance
      questions, not a side effect of this one.
    - **Repeat properties group on `market` + address, never address alone.**
      Street names repeat across a metro; on the first test book that merged a
      Boise building and a Meridian building at the same house number into one
      property with three deals.
    - **It reads none of `vault-api.js`'s `INTERNAL_FIELDS`** (`user_id`,
      `address_key`, `dedupe_key`) — it keeps its own copy of `addressKey`
      instead — so those can be dropped from the response whenever Owen wants.
      `test/vault-page.test.js` pins that, and pins the thing this file is
      uniquely able to break: the whole page, including ~550 lines of browser
      JS, is one template literal, so a stray `${` or a single-backslash escape
      emits broken JavaScript and a blank workspace rather than failing loudly.
      That test compiles what the page actually emits.
  - **The EMPTY VAULT is the real vault** (2026-08-13; spec
    `docs/superpowers/specs/2026-08-13-vault-empty-workspace-design.md`).
    When a broker has no comps *and* no imports, `applyFirstRun()` still
    hides the comps table and the imports list, but both decks and the
    trust line (zeros included) stay up. `#bookEmpty` is the book's body
    (upload invitation + privacy disclosure + template / Choose buttons);
    `#pipeEmpty` is the pipeline's (watch-market form, visible, not
    collapsed). `#firstRun` as a numbered two-card page is gone. Four
    rules:
    - **It keys on comps AND uploads, never comps alone.** A broker whose
      import was entirely rejected, or who deleted every comp out of one, has
      been through the door already; showing the book invitation again reads as
      their work having been thrown away. Pipeline empty is independent: a
      waiting lead must show even when the book is empty.
    - **The trust line shows zeros.** It exists to let a broker watch
      "0 published" stay at zero. Hidden until 2026-08-13 because it sat over
      numbered onboarding cards; with the workspace showing, the zeros are
      the honest empty state. Privacy copy still lives in `#bookEmpty`'s
      collapsed "Required columns & privacy details" disclosure, is restated
      on the trust line, and is made again at publish. Do not put the fine
      print back on the invitation face without asking.
    - **The one input takes MANY files (2026-09-02).** Choose or drop
      several: PDFs and screenshots are read one by one (each its own
      `/api/vault/extract` call, the route being rate-limited) and land in
      ONE confirm table with a `pdf-src` row naming each file above its
      rows — a row, never a column, because a cell rides into the upload as
      a field. Spreadsheets QUEUE through the ordinary path one at a time
      (the mapper is a screen a broker answers, and two cannot be open at
      once): the extract batch first, then each CSV, and the next starts
      only from `doImport`'s success with the previous rows STORED. A
      refusal or a cancel drops the rest of the queue BY NAME
      (`dropQueue`) rather than carrying on past a message the broker has
      not read. `#res` is one line everywhere else, so a batch keeps
      `batchLog` and every write during one starts with `batchPrefix()`
      — "Imported 12 comps" from a.csv survives "Reading b.csv". One file
      is the old path byte for byte (no source row, the plain name).
      `test/vault-page.test.js` runs all four shapes.
    - **Excel workbooks and pasted rows come in too (2026-09-02)**, and both
      become comma CSV TEXT before anything reads them, so `inspectCsv`, the
      mapper and `parseUpload` keep one input and the browser keeps posting
      one shape to `/api/vault/upload`. `POST /api/vault/inspect` takes
      `{ xlsx }` (base64, `MAX_EXTRACT_BYTES`' 4 MB cap, the same
      `xlsxGridFromBase64` helper the contacts import uses at 1 MB) and reads
      it with **`xlsx.js`'s typed mode**: a numeric cell is read THROUGH its
      style in `xl/styles.xml`, so a date-styled serial arrives as
      `YYYY-MM-DD` (both epochs, the Lotus 29-Feb-1900 gap, the time
      fraction dropped) and a percent-styled fraction as the percentage Excel
      shows — handed `0.0625`, `parsePercent` would store a cap rate 100x low
      and nothing would refuse it. A serial in a General cell stays a serial
      and is refused by name. The contacts caller stays untyped and
      byte-identical. A tab-separated body (cells copied from Excel, Outlook
      or a CoStar web table, the `#pasteSec` drawer) is detected on its first
      non-blank line and converted through `parseCsv({ delimiter })` +
      `gridToCsv` — never a tab-for-comma swap, since an address is one cell
      holding two commas. Three rules: the converted text rides BACK to the
      browser as `csv` (only when converted) and is what the upload carries,
      so the bytes the mapping was confirmed against are the bytes it is
      applied to; `gridToCsv` pads blank rows back in so "Line 5" still
      names Excel's row 5, and uses `quoteCsvCell`, never `csvCell`, because
      the formula guard would put an apostrophe into a broker's own note;
      and `.xls` is let through by the browser so the server can refuse it
      BY NAME. `test/vault-xlsx-run.test.js` runs the loop against the
      stand-in PostgREST.
    - **The confirm table triages (2026-09-02).** A row `normalizeRow`
      accepted renders as TEXT — the formatted figure, read against the page
      — with an Edit control (or a double-click) that opens just that row; a
      refused row stays inputs, tinted, followed by a `pdf-err` line naming
      its reason, and the cursor lands on the first one on open. The strip
      says "12 found · 12 ready · everything reads clean" and a second
      Import button (`#pdfGoTop`) sits above the table carrying the same
      state as the one below (`refreshPdfGo` writes both). "Review every
      cell" (`#pdfEditAll`) is the all-inputs table this used to be. The
      measured reason is the 4m51s in
      `docs/evals/extract-2026-08-28-verdict-final.md`. Document order
      (#217) is untouched; `r.editing` survives re-renders exactly as
      `checked` does; Edit is delegated on `#pdfBody` because the body is
      rebuilt on every re-render.
    - **There is exactly ONE `<input type=file>`.** Its `accept` includes
      `.pdf`, `.xlsx`/`.xls` and the image types as well as `.csv`. `#bookPick` and the
      ordinary "Add comps"
      button both call `$("file").click()`. Two inputs would mean two values
      and two change handlers, and an upload started from one would be
      invisible to the other's result message. Table PDFs and screenshots
      land in `#pdfSec`
      (the confirm table), not the CSV column mapper. A test pins this, and
      pins the accept list item by item — a missing image type greys the
      broker's own file out in the dialog with nothing on the page saying
      why. `isExtractFile()` in the browser is a courtesy check only (it
      reads the name and the browser's `type`, both caller-supplied); the
      server's byte sniff is the real one.
    - **The coverage form is ONE relocating node** (`#covForm`). Its home is
      `#pipeEmpty`; `renderPipeline` moves it into `#covBox` once a lead or
      BOV row exists, and walks it home when the pipeline is empty again.
      Never add a second copy — it would be a second thing to keep in step
      with the coverage rules in `broker-leads.js`.
    Empty tables are hidden throughout rather than shown with a header row and
    a "nothing here yet" line — three of those stacked up was the thing that
    made a new vault read as broken rather than new.
  - **That 503 is the opposite of the rest of the app, deliberately.**
    Everywhere else a Supabase failure falls back to a local file so nothing is
    lost. Here the file WOULD be the loss — Render erases its disk on every
    deploy, so a broker's uploaded book of business would silently vanish days
    later. The vault has **no file fallback**; it refuses instead.
  - **`market` is attached in server.js with `marketOf()`, never in
    `broker-vault.js`.** It has to agree byte for byte with `comp_corpus.market`
    so a comp published in step 2 needs no translation, and a second copy of
    that parse would be a second thing to keep in sync (the repo already has
    one such pair — `compWeight` — and it carries a ⚠).
  - **`dedupe_key` is an explicit column**, like `comp_corpus`'s, not a
    multi-column unique constraint. Postgres compares NULLs as DISTINCT, so
    `unique (user_id, address_key, deal_date, price)` would let an *unpriced*
    comp (explicitly allowed — brokers track undisclosed deals) re-import
    without limit on every upload.
  - **`broker-vault.js` rejects rather than guesses.** "1.2M", a bare number as
    a date (Excel's serial), and day-first dates are all refused with a line
    number rather than stored as a best effort — a wrong number in a broker's
    own records is worse than a rejected row, because nobody will notice it.
    Pure and tested (`npm test`, 64 cases).
  - **The one way past "deal_date is required" is the literal word `undated`**
    (2026-08-29; migration 042 dropped the column's NOT NULL — run before
    deploy, the 038 hazard shape). A blank stays refused (an accident); the
    word is a statement, for real documents that date none of their deals
    (the 2026-08-28 extraction verdict's capital-markets report lost all 9
    rows to the refusal). Stored as SQL null; excluded from every report
    blend and lookback by SQL semantics (`deal_date=gte.` is NULL-false);
    unpublishable; unshareable to a firm (`org_comps.deal_date` stays NOT
    NULL and `POST /api/vault/firm` refuses by name — and editing a shared
    comp to undated PULLS the firm copy rather than leaving it stale). The
    sentinel is contained by an opt-in flag on `parseDate` — only the
    deal_date call passes `{ undatedOk: true }`, so `lease_expiry`,
    `option_notice_date` and the hub's manual-comp date keep refusing the
    word. `validateEdit` presents a stored null back as `undated` (without
    that, an undated comp is permanently uneditable), the book export writes
    `undated` for the null so export → re-import round-trips (an option only
    that route passes — the confirm path must never turn a missing date into
    a statement), and the compact table's date cell shows AND holds the word.
    `test/vault-undated-run.test.js` proves the whole loop against a real
    server.
  - **Every read is scoped by `user_id`**, including the DELETE — without it,
    knowing another broker's upload id would be enough to delete their data.
  - **The property dimension** (`migrations/016-broker-comps-star.sql`, **run
    before deploying**). `broker_properties` holds one row per building per
    broker; `broker_comps.property_id` links to it. It exists because
    `address_key` was written on every row since 013 and read by **nothing** —
    no index, no table, no FK — and it is the one dimension a broker slices by.
    There is deliberately **no market dimension** (it would duplicate the
    corpus vocabulary and become a second thing to keep in sync) and **no date
    dimension** (`date_trunc()` answers everything without a fiscal calendar).
    Three rules: the migration is **purely additive** and a test fails the
    build if a destructive statement appears in it, because there is no staging
    database to rehearse against; `property_id` is **nullable on purpose**, so
    migrate-then-deploy and deploy-then-migrate both work with no window where
    an upload fails; and `linkVaultProperties()` **never throws** — the
    dimension is an index onto a broker's book, not part of it, so a failed
    link costs a join while a failed upload costs a broker their spreadsheet.
    Two brokers on the same building get **separate** property rows; sharing
    one would make each one's activity inferable from the other's.
    `broker_comps_reporting` is a view for the service role and direct SQL
    ONLY — it carries `user_id` and every private measure with no per-caller
    scoping, so it must never be exposed to the anon or authenticated roles.
  - **The vault API's shape is a contract, not the table's shape.**
    `vault-api.js` owns it and `toApiComp` is an **allowlist**, so a new
    storage column cannot reach the browser by default and a dropped one fails
    the build. `user_id`, `address_key`, `dedupe_key` and `property_id` are
    omitted as plumbing. Do not go back to answering `comps: rows`.
    `PROPERTY_FIELDS` is the second list: fields a comp inherits from its
    **building** rather than from `broker_comps` (`lat`/`lng`/`geo_source`).
    They are separate because the contract tests check `API_COMP_FIELDS`
    against the `broker_comps` schema **both ways**, and a `lat` in there would
    correctly fail — the fix was a second checked list against
    `broker_properties`, never loosening the first.
  - **Private-comp coordinates**
    (`migrations/017-broker-property-coordinates.sql`; spec
    `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`, AGREED
    2026-08-06). A broker's private comp used to be geocoded **by address, from
    their own browser**, on every report — so an off-market address left in a
    URL to the US Census geocoder and, on a miss, to OpenStreetMap with the
    broker's IP. `lat`/`lng`/`geo_source`/`geocoded_at` now live on
    `broker_properties`, filled from optional `lat`,`lng` columns in the vault
    CSV. Five things to know:
    - **This is only the STORAGE half. It fixes nothing on its own.**
      `renderMap()` in index.html still geocodes every comp unconditionally
      with no check for coordinates it already carries, so until the display
      guards land these columns are stored and ignored. Stated in §2 of the
      spec; it is why the work was contracted in two halves.
    - **`parseCoord()`, NOT `parseNumber()`.** The spec said to reuse
      `parseNumber`, which **rejects negatives** — it would refuse every US
      longitude, including the spec's own Boise example. Refuses DMS and
      bearings too: reject rather than guess, because a wrong coordinate puts
      a building on the wrong continent and nobody will recognise it as wrong.
    - **Coordinates ride on `_lat`/`_lng`, which are NOT columns.**
      `broker_comps` has no coordinate columns and PostgREST 400s on an unknown
      one, which on the upload path refuses the broker's whole spreadsheet.
      `PROPS.stripCarriedKeys()` removes them before the comp insert.
    - **They are written by a separate, guarded PATCH, never the property
      upsert.** That upsert is `resolution=merge-duplicates`, which replaces
      the columns in its payload — coordinates travelling in it would mean a
      later upload that omitted them **wiped** the ones already stored. The
      PATCH filters `lat=is.null`, so a located building is never rewritten.
    - **`geo_source` is `'broker'` from the spreadsheet, `'census'` from the
      import-time geocode — and the broker always wins.** Step 2 shipped
      2026-08-29 (the §7 deferral was "buy it with evidence"; the roadmap
      moved it to Next once the CSV mapper made `lat`/`lng` mappable):
      `scheduleVaultGeocode` in server.js runs at the tail of
      `linkVaultProperties`, fire-and-forget on `scheduleCorpusLocate`'s
      contract, and geocodes up to 25 of an import's unlocated buildings
      through `geocodeCensus` — our own in-process Census call, never
      Nominatim, never the browser. It reads AND patches with `lat=is.null`,
      and it runs after the broker-coordinate PATCHes, so a building the
      broker located is never even read, let alone rewritten. A miss or an
      outage is a skip, never a guess (outages are not cached in `GEO_MEM`,
      so the next trigger retries). Pre-existing books backfill 8 per vault
      read, riding `attachPropertyCoords` the way the corpus backfill rides
      its own read. The pure filter is
      `PROPS.propertiesNeedingGeocode` (`broker-properties.js`);
      `test/vault-geocode-run.test.js` proves the wall end to end against
      the fake PostgREST and a census stub on `CENSUS_API_URL` (test-only
      env, `RESEND_API_URL`'s precedent — decides where a private address is
      posted, so trusted config, unset in production).
  - **The building remembers** (2026-09-03; migration
    `050-broker-property-facts.sql`, **run before deploying**; spec
    `docs/superpowers/specs/2026-09-03-vault-building-facts-design.md`).
    Every fact in the vault is stored on the deal, but year built, clear
    height, units, lot acres, zoning and class are facts about the
    BUILDING, so a broker with three deals on one building typed them three
    times and a priced sale missing its size counted for nothing in any
    median. `broker_properties.facts` (jsonb) is what the broker's own
    deals on one building AGREE on, derived by the pure, dual-exported
    **`building-facts.js`** (browser global `BFACTS`, `max-age: 0` like
    `gut-check.js`) and recomputed by `deriveBuildingFacts` at the tail of
    `linkVaultProperties` on every upload, add and edit. Five rules, all
    test-pinned (`test/building-facts.test.js`,
    `test/vault-building-facts-run.test.js`):
    - **Inheritance is READ-TIME ONLY.** `applyFacts` runs in exactly two
      places, `vaultCompsForReport` and `vaultReadPayload`, and writes
      nothing: `broker_comps` keeps what was stated on each deal, so the
      export, the public records and the firm copy stay stated-only, and one
      correction moves every sibling's view with no second write. The comp
      carries `inherited` (vault-api.js's `DERIVED_FIELDS`, a fourth checked
      list whose tripwire is that it is a column on NO table) so the page
      can say a cell is a reading. On `/vault` an inherited cell shows the
      value muted and italic and HOLDS nothing (raw `""`, a placeholder in
      spreadsheet mode), so a blur that typed nothing is not a save.
    - **Disagreement is a CONFLICT, never a winner.** Two deals saying 12
      and 14 dock doors serve no value and name both; `anchor_tenant` is
      the one recent-wins exception. Blank is not a vote.
    - **`size_sqft` derives from SALES only and inherits onto SALES only.**
      On a lease it is the suite. A size inherited onto a priced sale gets a
      `$/SF` from THAT deal's own price, never copied from another deal.
    - **Every `broker_comps` column is on exactly one side** of
      `BUILDING_FIELDS` / `DEAL_FIELDS`, and the unit test fails the build on
      a column placed on neither — the `add-comp-field` skill's step 1c.
    - **The privacy wall is untouched.** Derived from the broker's own rows,
      read back onto the broker's own rows, user-scoped on both the read and
      the PATCH; `attachPropertyCoords` stitches `facts` but does not apply
      them, because it also serves `shareVaultCompsToOrg`. The add form and
      the confirm table prefill a known building's empty cells
      (`prefillFromBuilding` / `prefillPdfRow`, "Known building · 2 deals in
      your book · year built filled in from them") against rows the page
      already holds — nothing leaves the page to ask which building an
      address is — and a prefilled value is STATED when saved. A DELETE does
      not recompute (a lingering fact is still true of the building); a
      pre-050 book derives on its first vault read.
  - **Gut check** (v4 slice 1, 2026-08-08; spec
    `docs/superpowers/specs/2026-08-08-gut-check-design.md`). A panel on
    `/vault` compares the broker's per-bucket median $/SF and cap rates
    against two separately-labeled public benchmarks: corpus quartiles
    (floor 4 priced sales, same usability rules as retrieval) and the
    market page's model figures. Rules live in the pure, dual-export
    **`gut-check.js`** (browser global `GUTCHECK`, served with `max-age: 0`
    exactly like `valuation.js` and for the same reason). `POST
    /api/vault/benchmarks` serves the benchmarks and **reads no vault
    rows** — the broker's numbers stay in their browser, so this feature's
    server surface cannot leak a private comp even in principle. It still
    answers through `openVault` for gate consistency. Verdicts are
    untrended and framed "worth a look", never "your data is wrong";
    individual sale comps >25% outside the band get an outlier marker in
    the comps table. No migration.
  - **BOV tracker** (v4 slice 2, 2026-08-08; spec
    `docs/superpowers/specs/2026-08-08-bov-tracking-design.md`). The broker's
    private log of BOV engagements from any source, statuses
    open/delivered/won/lost (vocabulary validated, transitions deliberately
    unpoliced). Rules in the pure, tested **`bov-log.js`**;
    table `broker_bovs` (migration 019), vault-class private: DB-only, every
    read/write user-scoped, read by no owner surface (`/admin`'s
    intro-requests card is unchanged). Intro requests auto-create rows
    (non-blocking), and `GET /api/broker/bovs` seeds from
    `lead_intro_requests` only when the broker's log is EMPTY, mirroring
    `/api/broker/leads`'s own coverage-seeding rule: seeding on every open
    resurrected a row the broker had just Removed (status reset to open,
    notes gone), so it now runs only to recover history for a log with
    nothing in it yet, and `?noseed=1` skips it for one call the same way
    `/api/broker/leads` does, which is what the page's post-delete reload
    passes. From there the intro handler's auto-create is what keeps a
    non-empty log current. Idempotent via `unique (user_id, lead_id)`, and
    the reason migration 019 has no SQL backfill (`marketOf()` is JS).
    Routes go through `requireBroker`. Manual adds log a PII-free `bov`
    analytics event. Lapse locks the log, never deletes it.
    **On `/vault` those rows share one table with the lead inbox**
    (2026-08-13; spec
    `docs/superpowers/specs/2026-08-13-vault-pipeline-deck-design.md`). A
    lead is a `New` stage whose only action is requesting an introduction;
    a BOV keeps its status select and Remove. The four tiles became a
    five-cell stage strip (New / Open / Delivered / Won / Lost) plus a note
    line for this year and the win rate (dash under 3 decided). Coverage
    collapses under "Markets you watch". No new endpoint — the browser
    already had both payloads.
  - **The credit identity is STATED, never inherited** (2026-08-12).
    `POST /api/vault/identity` writes `broker_profiles.display_name` and
    `.company`, creating the row if needed; `vaultReadPayload` returns an
    `identity` block (`display_name`, `company`, `creditedTo`) so `/vault`
    can name the credit BEFORE a publish rather than after one. Four rules.
    **`creditName(profile)` reads the profile only** — the old `user.name`
    fallback is gone, and that fallback was the bug: the publish confirm
    promises "credited to your firm by name", a vault-first broker has no
    profile, so their comps were credited to whatever they typed at signup
    and `submissionRowFrom` copied that string into `broker_company`, which
    is published as their firm. Nobody chose it, so nobody could correct
    it. **An unstated identity now returns `""`**, the publish route
    refuses with `needs_credit_name`, and the vault opens the form in
    place — a one-time question instead of a silent wrong answer.
    **It never touches `public`**: broker-directory.js's TWO CONSENTS rule
    holds, so stating a firm name creates a row that is private by default
    (`public` defaults false in 003) and the opt-in stays on `POST
    /api/broker/profile`. Verified 2026-08-12 — after saving an identity,
    `/broker/<slug>` still 404s and the market page lists nobody. **The
    page prints `creditedTo` verbatim** and never recomputes the
    company-then-name preference, or it could promise a name the write
    would not produce; a test pins that by disagreeing the two on purpose.
    Rules in the pure, tested `validateIdentity` (at least one field must
    survive trimming; the two stay separate columns because a firm is not
    a person; control characters stripped since these strings reach a
    public page, formula shapes left to `guardFormula` at `csvCell` so a
    firm really called "+Plus Realty" keeps its name).
  - **The template carries its own rules, as `#` lines** (2026-08-10; spec
    `docs/superpowers/specs/2026-08-10-vault-template-self-documenting-design.md`).
    `isCommentRow` skips any body row whose FIRST cell starts with `#`, and
    `templateCsv` ships the required columns, the six property types, the
    date format, what the number parsers really accept, and the optional
    per-type columns as exactly those lines. They used to live in the single
    example row's `notes` cell, where the broker's first edit deleted them.
    Four rules. **Only the first cell decides**, which is what lets the three
    example rows sit fully populated under their correct headers with `#` in
    the address cell — so the file we hand a broker can never plant a fake
    comp in their own book, and they activate a row by typing an address over
    the `#`. **The skip is counted, never silent**: `parseUpload` returns
    `commented`, the route passes it through, and `/vault` says "N note lines
    ignored" — a broker's own export with a `#` row is refused today anyway
    (no street number), and this keeps that visible rather than trading a
    loud rejection for a silent drop. **`total` counts data rows only**
    (body minus comments), because it is what `imported` is compared
    against and "imported 3 of 16" reads as data loss. And **the guidance is
    pinned to the constants by a test** — every `PROPERTY_TYPES` value and
    every `OPTIONAL_SPEC_COLUMNS` name must appear in the template, so adding
    a per-type field through the `add-comp-field` skill fails the build until
    the template names it. Keep the text TRUE: `parseMoney` strips `$` and
    commas, `parseNumber` accepts `45,000 SF`, `parsePercent` accepts
    `6.25%`; the old template said "no $ signs" and was simply wrong.
    **Two columns get a sentence each because testers asked what they were
    (2026-09-02)**: `lat and lng are latitude and longitude` with a worked
    example, and a `tenancy:` line — it had NONE, only three example cells,
    and it is free text (`"NNN"` is stored in it elsewhere), so the line
    names the three usual answers and says it is never used in the math.
    The same two answers ride `vault-page.js`'s `FIELD_HINTS` as `title=`
    on every header that names the column (`headCell` and the confirm
    table) and on the add form, whose labels now read Latitude and
    Longitude; a hint explains a column and never names one, so it is not a
    fourth label map. Pinned in both test files.
  - **The CSV column mapper** (2026-08-10; spec
    `docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md`).
    A broker uploads their own export and maps its columns once. `POST
    /api/vault/inspect` reports headers, real sample values and a suggested
    mapping; `/api/vault/upload` takes an optional `mapping`, and absent it
    behaves byte for byte as before. **Since 2026-09-02 the screen has a
    summary mode**: when the pre-selection (suggested plus remembered) claims
    every required field, nothing is ambiguous and no two columns sit on one
    target, the dropdown table folds under `#mapDetails` ("6 of 6 columns
    matched · change how they match") and Import is the next thing on
    screen; the "Will be ignored" line moved ABOVE the fold so the rule below
    holds whether or not the dropdowns are showing. And the remembered
    mapping is **one per file SHAPE**, not one per broker (migration 049,
    run before deploying — the read names the column): `headerSignature`
    hashes the normalized header row, computed server-side from the CSV the
    route received; the exact shape wins and an unseen shape falls back to
    the most recent mapping, which is what one-per-broker always returned.
    Six rules a future editor will
    otherwise break: **a target is suggested only when exactly ONE column
    claims it**, which is how the old "we do not guess column names"
    decision survives (two columns aliasing to `price` suggest neither);
    **a rate-shaped header may claim nothing by ALIAS** (`isRateHeader`,
    2026-08-11, tested on the RAW header because the "/" carrying the
    meaning strips away in normalization) — "$/SF" normalizes to bare
    `sf`, which made it the sole claimant of the size alias on the first
    real broker file, so the mapper confidently suggested importing
    $68.11 as a 68 sq ft building; an exact target name still maps, so a
    literal "Price Per Unit" column keeps its real multifamily column;
    **the screen is always shown unless every header is already one of
    ours**, because only four fields are required per row, so a file with
    an unrecognised "Sq Ft" column imports today with every size null and
    nothing saying so; **unmapped columns are renamed `_ignored_<i>` rather
    than left alone**, or a literal `price` column the broker chose not to
    map would shadow the one they did; **the remembered mapping is only
    ever a pre-selection**, never auto-applied, which is what makes it safe
    to key on the broker rather than on a fingerprint of their header row
    (if the screen is ever made skippable on a remembered mapping, that
    stops being true and the header signature becomes necessary); and
    **the normalized header vector is produced in exactly one place**,
    `normalizedHeaderRow(rawHeaders)`, and `inspectCsv`, `validateMapping`
    and `parseUpload` all route through it rather than calling
    `normalizeHeader` directly. A header can be real and still normalize to
    nothing — `normalizeHeader` strips every non-alphanumeric character, so
    a column headed `$`, `#`, `%` or `($)` (the comment above
    `TEMPLATE_COLUMNS` already names `$` as a header brokers use for price)
    reduces to `""` and would vanish from the mapping screen entirely: not
    listed, not mappable, not even named in the "will be ignored" line. That
    is the exact silent-drop failure this feature exists to prevent, so such
    a header now gets a positional `column_<i>` key instead; a truly blank
    header still yields `""` and stays excluded, so trailing commas still
    cost nothing. Computing the vector separately in any one of the three
    call sites is what broke the round trip the first time this shipped: the
    inspection screen offered `column_0` as a mappable source, and the
    import route, keying its own copy off a bare `normalizeHeader` map,
    refused it as a column the file did not have. `suggestMapping`
    deliberately does NOT route through `normalizedHeaderRow` — it only
    produces optional suggestions, never a required key, and a synthetic
    `column_N` can never match a semantic alias like `sale_price`, so
    running it through the positional fallback would only manufacture
    suggestions nobody could recognise.
- **Broker lead inbox** (v1, 2026-08-05). DDL in
  `migrations/015-broker-lead-inbox.sql` (**run before deploying**). Rules
  live in the pure, tested **`broker-leads.js`** (coverage matching, the lead
  anonymization allowlist, coverage seeding, notify dedupe); server.js owns
  every read/write and computes `market` with `marketOf()` before calling in.
  **Metro matching (2026-08-17).** Coverage matching reads the same curated
  `METRO_GROUPS` corpus retrieval does, so a broker covering Boise industrial
  also sees Meridian industrial leads — those cities trade as one market, and
  until this shipped that table was read by retrieval and by nothing else.
  Four rules. **The adjacency function is INJECTED, never required**:
  `broker-leads.js` does not know what an address or a metro is (its header
  rule), so `filterLeadsForCoverage(leads, cov, siblingsOf)` takes it as an
  optional third argument and behaves exactly as it did before when omitted —
  which is what keeps every other caller and the whole test file safe by
  default. **The property type is never widened with the geography**: an
  industrial broker one suburb over is still an industrial broker, and
  crossing types would put a retail enquiry in their inbox on the strength of
  a shared postcode. **All THREE call sites move together or none do** — the
  inbox, the intro gate (`filterLeadsForCoverage` again, so a visible lead is
  always actionable) and the new-lead alert, which starts from one lead and
  therefore widens from the other end via `coverageMarketsFor` into a
  PostgREST `market=in.(...)`; a broker emailed about a lead the inbox hides,
  or shown one they were never told about, is a bug either way, and a test
  states the two as one rule. **And the reach is disclosed**: the API adds
  `nearby` per coverage row and the chip reads "+7 nearby", because a lead
  from a city the broker never typed otherwise reads as a bug in the one
  surface whose whole job is to be trusted about where their business is.
  Rollback is `LEAD_METRO=off`, deliberately separate from `CORPUS_METRO`:
  the two read one table but answer different questions — which comps a
  search may draw on, versus which PEOPLE see a stranger's enquiry.
  `GET|POST|DELETE /api/broker/coverage` — the broker's list of market +
  property-type pairs to watch. `GET` lists it; `POST` adds one pair
  (validated against `LEADSVC.isCanonicalMarket` and `VAULT.PROPERTY_TYPES`,
  capped at 200); `DELETE?id=` removes one, scoped by `user_id`.
  `GET /api/broker/leads` — the inbox itself: BOV leads from the last
  `LEAD_WINDOW_DAYS` (90) days matching the caller's coverage, anonymized to
  market/type/size/date only (`LEADSVC.anonymizeLead` — name, email, phone,
  company and street address never leave the handler). **DB-only, no file
  fallback**: any read error is a 503, because an empty inbox on error would
  misreport demand as zero. On first open with no coverage rows, seeds
  coverage from the broker's own approved comp submissions
  (`LEADSVC.seedCoverageFromSubmissions`); `?noseed=1` skips that reseed so a
  market a broker just removed stays removed for the rest of the page
  session. `POST /api/broker/leads/intro` — a broker raising a hand for one
  lead. Owner-mediated: emails the owner naming the broker, never contacts
  the property owner and never sends broker PII anywhere it didn't already
  go. Coverage-gated (mirrors the inbox's same source + window filters, so a
  broker cannot request an intro to a lead they cannot see) and deduped via
  `unique(lead_id, user_id)` on `lead_intro_requests` — a repeat request
  answers `{ ok: true, already: true }` rather than emailing the owner twice.
  All three routes go through **`requireBroker`**, a deliberate second copy
  of the vault's `openVault` gate (same three refusals, same order: 401 not
  signed in, 403 not a broker, 503 no database) — `test/routes.test.js`
  exists specifically to catch drift between the two copies.
- `GET /healthz` — health check for hosting platforms.
- `GET /robots.txt`, `GET /sitemap.xml` — SEO endpoints built from `SITE_URL`.
- `GET /` — serves `index.html`. **For a signed-in member `/` opens the
  WORKSPACE, not the search page** (2026-08-28) — the firm's shelf, the deal
  board and their own properties, with the real search desk above them. That
  is the whole firm-first reorganization, and three rules hold it up:
  - **The search desk stays visible on the workspace.** `showDeskView()` used
    to hide `#searchSection`; it now shows it. Landing a member on a home page
    with no address field would be worse than the page it replaced, so the
    route change was only made after this one. It is the REAL `#compForm`, not
    a compact copy — one form, one set of ids, read by `targetRange()`, the
    footprint estimate, every report restore and the confirm dialog. A second
    "launcher" would be a second address input to keep in step.
  - **A report yields the workspace** rather than rendering under it, at BOTH
    seams: `renderResults` and, up to a minute earlier, `beginAssembly`.
    Without both, comps stream in below the firm shelf.
  - **The boot decision reads `looksSignedIn()`, never `currentUser`** (it runs
    before the account bootstrap resolves, so every member would see the
    marketing stack for a beat), and **`/r/<id>` is excluded by name** — a
    shared report is somebody else's link and must never open the reader's own
    desk. `popstate` mirrors the same rule, so Back to `/` does not drop a
    member on marketing.
  **The workspace fills in ONE PAINT (2026-09-03).** It used to reveal itself
  a section at a time — `renderMyDesk` unhid `#myDesk` on entry, every
  renderer unhid its own section when its own fetch landed, and the fetches
  ran as a chain ten deep (portfolio → shares → firm → buildings →
  conversations → shelf → board → contacts). Filmed against the stand-in
  database with a 60ms round trip, sections appeared at 0.6s, 0.9s, 1.3s,
  1.8s, 2.3s, 2.6s, 2.9s and 3.2s; the owner described it as the page
  inserting parts. Now the FIRST fill for an identity is held: `#myDesk`
  stays hidden, `#deskLoading` (a `.skeleton` the shape of a deck) stands
  in, and the desk is revealed once when `renderDeskRest`'s batch settles —
  filmed the same way, everything appeared together at 1.7s, on the same 130
  database requests. Four rules, all in `test/desk-one-paint.test.js`, which
  EXECUTES `renderMyDesk` with renderers the test lands by hand: a later call
  for the same identity repaints in place and never re-hides a desk already
  on screen (`deskFilledFor`); a sign-out or a different sign-in mid-fill
  means the stale fill reveals nothing; `renderDeskRest` returns its batch
  and swallows a rejection, so a section added there is held for free and
  can never hold the desk forever; and `DESK_FILL_MAX_MS` (8s) races the
  batch, so a hung fetch shows what has landed rather than nothing. The
  concurrency is the other half of the speed-up: `renderShares` starts the
  membership read beside the shares read (every early exit awaits it before
  `hideAll()`, or the in-flight read undoes the hide), and the firm-scoped
  reads go out together — the shelf and the contacts wait for the buildings
  (the "Add to firm" doors and the building_id → address map) and for
  nothing else. `showDeskView` decides the sign-in card and the stand-in on
  `looksSignedIn()` for the boot rule's own reason: on `currentUser` a
  member's first frame was the "Sign in" card, filmed at 0.3s.
  **The workspace's data ships WITH the page (2026-09-04; `DESK_BOOT`).**
  One paint was still a paint AFTER the page: index.html ships one set of
  bytes to everybody and then asks for its account, its config and a dozen
  desk reads, so the desk could not exist before those round trips came
  back — 1.7s in the film above, and no client-side change could move it,
  because a browser cannot fetch what it has not yet been told to ask for.
  The owner's ask was "instantly". So for a cookie holder on `/` or
  `/desk` (never `/index.html`, never `/r/<id>`), `deskBootPayload` in
  server.js asks the server's OWN routes over loopback with the visitor's
  cookie — `DESK_BOOT_URLS`, then the six org-scoped URLs once `/api/org`
  has named the firm — and `deskBootScript` embeds the answers at the
  `<!--DESK_BOOT-->` marker in `<head>` as `window.DESK_BOOT`, keyed by the
  exact URL. In index.html, **`bootFetch(url, init)`** hands each entry to
  the first GET that would have fetched it and fetches live from then on;
  `acctApi`, `initGate`'s config read, the account bootstrap and every desk
  renderer read through it. Filmed at the same 60ms database delay: the
  first frame after the document IS the finished workspace, and the page
  makes no API request at all. Five rules, all in
  `test/desk-boot-run.test.js` (a real server behind the fake PostgREST)
  and `test/desk-boot.test.js` (bootFetch executed, the two URL lists held
  together): **it is never a second copy of a read** — the embedded body is
  the route's own answer to the same cookie, and the run test deep-equals
  every entry against a live GET, so the session, entitlements, `openOrg`,
  `memberOf` and every `user_id` scope apply by construction; **cookie
  presence decides whether to try, the routes decide what it is worth** — a
  dead session 401s on `/api/account/me` and the payload is dropped whole;
  **one deadline (`DESK_BOOT_DEADLINE_MS`, 1500ms, env-overridable so a
  test can prove the degrade) covers the whole fan-out**, past which the
  page ships without whatever has not answered, and any URL missing is
  simply fetched — every failure is the page as it was; **only status-200
  JSON GETs under `DESK_BOOT_MAX_BODY`**, with the visitor's IP on
  `x-forwarded-for` (so per-IP limiters see the person, not 127.0.0.1) and
  an `x-cn-desk-boot` header so a fan-out can never nest; and **`<` is
  escaped in the JSON** so a contact named `</script>` cannot close the
  script (exercised, not just asserted). The cost is TTFB: the page waits
  on the desk's reads instead of the browser waiting for them a beat later,
  which is the same wait moved earlier, minus a dozen browser round trips.
  Found on the way and fixed: `initGate` re-ran the desk fill "once the
  real Pro flag is in" although nothing the desk fills reads it any more,
  so every desk read went out TWICE on every boot; `refreshAccountUI`'s
  call is the fill now, and `refreshProConfig` keeps the checkout-return
  repaint.
  **`/desk` is kept working rather than redirected to `/`.** It is linked from
  Stripe checkout returns *with a query string*, the watchlist digest, org
  invite emails and `/bulk`; a 302 would drop the query and dead-end those.
  Home moved by opening the same view, not by moving the URL. The five desk
  decks now lead with **Your firm** (was third of five), and the label a person
  reads is **Workspace** everywhere — prose says "your workspace" lowercase.
  One duplicate is left undecided on purpose: for a member, `marketBar`'s
  `Home` and the new `Workspace` link are the same destination. Suppressing
  Home for members was tried and reverted — two tests defend that link for
  signed-in visitors by name. See the comment on that line.
  The same handler covers `/index.html`,
  `/desk`, and `/r/<id>`, and matches on the **path only** (`req.url` split at
  `?`). That matters: Stripe returns from checkout to `/desk?checkout=success`,
  and an exact `req.url` match 404'd it — along with every campaign link to
  `/?utm_source=…`. **Every page route now does the same** (2026-08-28):
  `pagePath` is declared beside `staticPath` and is what `/markets`,
  `/market/<slug>`, `/broker/<slug>`, `/market-preview/<slug>`,
  `/how-it-works`, `robots.txt` and `sitemap.xml` match on — the first three
  of those were still testing `req.url`, so Facebook's own `?fbclid=…` made
  every shared market page a 404 for whoever clicked it. A new PAGE route
  belongs on `pagePath`; the API routes deliberately keep their exact
  `req.url` matches, since a client calls those by an address it constructs
  rather than one a person shares. `test/routes.test.js` walks every public
  page with a tag on the end and checks the canonical still points at the
  clean URL, so the fix cannot trade a dead link for duplicate entries in
  Search Console.
  **It is templated three times at serve time**, and the third one varies by
  visitor: `NAV_LINKS`, `INAPP_BOOT`, and — since 2026-08-23 —
  **`authBoot()`** at an `<!--AUTH_BOOT-->` marker in `<head>`. That last one
  exists because this file ships one set of bytes to everybody and then
  corrects them from `/api/config` and `/api/account/me`, so until those
  landed a signed-in member saw a signed-OUT app: measured with the account
  read slowed, "Sign in" in the header at 78ms and — in the frame where
  config had answered and the account read had not — the search form replaced
  by the wall's signup card at 1170ms. A race, so it is worst when the
  database is slow. It carries two facts, both free of a database read on a
  route that runs on every page view: `ACCOUNT_WALL` (a server constant, so
  exact) and session-cookie **presence** (the wall's own cheap rule twenty
  lines above it). Four rules:
  - **Keying on a cookie is safe here ONLY because index.html is
    `no-store`.** `/how-it-works` does the same signed-in swap and has to
    carry `vary: cookie` and drop its hour cache to do it; there is no cached
    copy of this file to hand to the wrong visitor.
  - **It is a stand-in, and index.html retires it.** `refreshAccountUI()` —
    the one function that runs after `/api/account/me` on every path,
    including the failed one — drops `cn-in`/`cn-locked` and writes the truth
    itself. That is what makes the `!important` safe: left standing, an
    expired session would keep the "Sign in" button hidden by CSS the JS
    cannot reach, i.e. a member who cannot sign back in.
  - **`applySearchLock()` reads `looksSignedIn()`, never `currentUser`
    alone**, and `accountWall` is seeded from the boot object rather than
    defaulting to false. That pair is what fixes the big flash — the card
    appeared because that function ran once with the wall off and once with
    it on. The hint is consulted only until `authKnown` flips.
  - **Presentation only**, like everything else the wall drives: a forged
    cookie buys the sight of an account menu with nothing behind it, because
    every limit is still enforced server-side.
  `test/auth-boot.test.js` pins the server half (the right classes for the
  right visitor, in both wall states) and the index.html half (the marker,
  the retirement, and that every id the boot CSS names still exists).

**`index.html`** — the entire front-end (Tailwind vendored as `tailwind.css`,
html2canvas via CDN).
Holds the form, password gate, results rendering, sortable table, and the
CSV / PNG / Print-to-PDF exporters. The main form's controls row is **three
cells on one line** (`sm:grid-cols-3`): Focus, Lookback and **Property SF**.
Since 2026-08-23 that row sits **inside `<details id="searchSettings">`,
behind a line stating its current values** ("Sales & leases · last 24 months ·
size from public records", with a `Change` affordance), so the form asks for
an address and nothing else. The app already held an answer to all three: two
have defaults, the window's own caption says "Recommended for Industrial", and
the size is looked up from public records or the footprint on most searches —
asking is now stating. **The line is DERIVED, never written once**
(`refreshSearchSettingsLine`), and that is the whole cost of the change: three
visible controls explain themselves, while a stale summary describes a search
that is not the one about to run, with the controls it describes hidden. Only
the lookback has a funnel (`setLookbackControls`); focus and size are assigned
directly by `rerunHistory`, the shared-report restore, the record-backed size
autofill and `dropMachineSize`, none of which fire an event, so each calls the
refresh itself. The footprint estimate is the one machine write that needs no
call of its own, because it dispatches `input` on `#targetSize`. A test pins
every one of those seams and another executes the function, because the
failure is invisible on screen. Every field id is unchanged, so
`targetRange()`, the footprint estimate and every report restore are
untouched.
The row was briefly a 2x2 grid (2026-08-16) carrying the asking price as a
fourth cell; the price moved down into "Details for comps" on 2026-08-17
(owner's call) and the row went back to one line, so `.rd-row-2up` and its
wrapped-grid border rules are gone from the style block rather than left
sitting unused. Three is still the ceiling: the build chamber is ~552px, so a
fourth cell leaves ~106px of content and `.rd-lab`'s tracking wraps the label
to two lines — and `.rd-cell:last-child` cannot see a wrapped grid, which is
what the deleted rules existed to patch. **Asking price is a Refine field
now**, sitting immediately before `#subjectTypeFields` so it reads beside the
per-type facts about the subject (beds/baths on a house, unit count on a
multifamily) — same id, same single input, so `targetRange()`,
`askingRangeFrom` and every report restore are untouched; only its parent
element and its styling changed. The property
type is chosen at the verification step, and the confirm dialog blocks the run
until a type is resolved. Contains **no secrets**.
**The size field is one figure, not a range** (2026-08-16, owner's call).
`#targetSizeMax` no longer exists; `targetRange()` is called with a null
`maxId` for both size and price, so `meta.subject.sizeMax` now always equals
`sizeMin` on a new report. The key it is stored under is deliberately kept:
`sizeMax` survives in `meta.subject` exactly as `priceMax` has since
2026-08-10, so reports saved while the range existed still render it on the
subject row and in exports — the two restore paths (`loadSharedReport`,
`rerunHistory`) simply no longer write it into an input. Do not add a second
size box to Refine "to bring the range back": `#targetSize` is a single id
read by the footprint estimate, `targetRange()` and every report restore, and
a duplicate would either break those or silently disagree with the figure the
search actually sends.

**Private comps in the front end** (the display half of blended comps, 2026-08-06;
server half and spec are under the broker vault above). A comp the server flags
`private: true` renders as an ordinary comp everywhere — table, cards, map,
chart, tiles, curation and the valuation all read it without special-casing,
which is exactly what the one-flagged-array contract bought. It carries the
`broker_vault` tier in `SOURCE_TIERS`, badged **"From your vault"**: an
ownership statement, never the green Verified badge, which is a public claim a
private row has not earned. Two rules matter when editing anything down here:
- **Exports read `exportableComps()`, never `includedComps()`.** That is the
  only difference between the two, and it is the difference between a broker's
  private book staying private and being emailed to a client. Rows and cards
  also carry `no-print no-capture`, which drops them from the printed page and
  from the html2canvas PNG. `/api/share` strips them **server-side** and does
  not trust this file.
- **The valuation still counts them, so every export discloses the gap.** The
  file is short by N rows while the value above it is not, and an unexplained
  difference reads as lost data. `renderPrivateNotice()` says so on screen (and
  is deliberately NOT `no-print`/`no-capture`, so it survives into the very
  exports that dropped the rows); the CSV title row and the XLSX Valuation
  sheet repeat it. Change the filter and you have to change all four.
- **A private comp's ADDRESS is never sent to a third party** (2026-08-06; spec
  and Owen's §7 decision in
  `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`). Two guards,
  both in `renderMap()`'s geocoding, and both applied in **two** places — the
  main pass and the no-coordinates rescue loop above it, which is otherwise a
  second door straight past them:
  - **Skip.** A private comp with finite `lat`/`lng` is not geocoded at all.
    That pass otherwise geocodes EVERY comp unconditionally, treating supplied
    coordinates as a first-paint guess for the geocoder to refine — right for a
    public comp, wrong for a vault one. Without this guard, coordinates in a
    broker's upload would buy nothing.
  - **No third party.** `geocodeAddress(addr, { noThirdParty: true })` stops at
    our own `/api/geocode` proxy (US Census behind it) and never falls through
    to Nominatim, which is browser-direct and so would receive the address
    **and the broker's IP**. On a miss the comp gets no pin, deliberately —
    same rule as Street View's "the actual property or nothing".
  A refused lookup is **not cached**: `geoCache` is keyed by address alone, so
  storing that miss would deny the Nominatim fallback to the public callers
  still entitled to it. Public comps are untouched by all of this.
  Owen owns the other half (migration 017, `lat`/`lng` in the vault CSV,
  `toApiComp` lifting them onto the comp); **import-time geocoding shipped
  2026-08-29** — the rules live in the Private-comp coordinates bullet under
  the broker vault above. Moving `/api/geocode` to POST ranked above it and
  **shipped 2026-08-17** — see that route's entry above; the address a private
  comp sends to our own proxy no longer lands in a URL.

**PowerPoint export** (2026-09-02; `exportPptx` in index.html). One more
format of the same report, for the reason the others could not serve: the
PNG is one flat picture, the PDF is a print of the web page and the XLSX is
data with no story, and a broker who needed a deck screenshotted the hero into
one by hand. Five slides of NATIVE text and tables — value (the hero's
ledger, basis, trust line and approaches), market summary and drivers, the
comp table paginated ten rows a slide, the comp map and market-position chart
as images, and sources & method. Built in the browser by **PptxGenJS 4.0.1,
lazy-loaded from jsdelivr** on first click exactly as the Excel export loads
SheetJS from cdnjs (it is not on cdnjs; jsdelivr is named beside cdnjs in the
privacy policy's third-parties list, and `test/public-pages.test.js` pins
that line). The button is `#pptxBtn`, revealed for signed-in members only
with the Excel button. Five rules, all pinned in `test/index-html.test.js`:
it goes through `gatedExport` and so costs the same allowance slot as the
CSV of that report (`POST /api/export` takes no format); rows come from
`exportableComps()`, never the included set, and the deck says how many
private comps it left out with the CSV's reader-vs-owner wording; branding
rides `activeBrand()` and every slide's footer carries the CompNinja
attribution from `pptxFrame`, so no slide can omit it; the ledger is READ
OFF THE HERO'S DOM rather than recomputed, because `renderOwnerHero` already
resolved every branch (per-unit, income-only, the leases-only rent range, the
dashes) and a second computation would be a second answer; and it is always
light — `PPTX_CHART_VARS` mirrors theme.js's light tokens for the chart's
`var()` colours and a test holds the two together. The map slide is the
print/PNG raster (`ensureStaticMap`) re-encoded to PNG because PowerPoint
does not render WebP; building it is how the pinless-raster bug below was
found. Verified by opening the file in PowerPoint through its COM interface
and exporting each slide to PNG (a PowerShell one-liner, no dependency).

### Non-obvious flows to know before editing

1. **Web-search response parsing (`server.js`).** A web-search response is a mix
   of block types. The code keeps only `block.type === "text"`, joins them, then
   `parseCompJson` defensively strips ```` ```json ```` fences and slices the
   outer `{...}` before `JSON.parse`. The model is told to return raw JSON, but
   this guards against stray text. If you change the output shape, keep the
   "return ONLY JSON" instruction intact.
   Since 2026-08-04 a FAILED parse is rescued in layers before the expensive
   full retry: first the first BALANCED object is salvaged
   (`extractFirstJsonObject` — the observed failure mode is a complete report
   plus trailing junk containing a brace, which fools the first-{-to-last-}
   slice), then one no-tools repair call (`repairCompJson`) asks the model to
   re-emit the same JSON corrected; `solo()`'s full re-search only runs if
   both fail. Every layer logs (`salvaged` / `repaired` / `retrying`), so
   Render logs show which fires and how often.

2. **Property-type-aware reporting is split across both files.** `buildPrompt` in
   `server.js` switches guidance per type (Industrial/Office/Retail/Multifamily/
   Land/Residential). **Every type also requests its own extra per-comp fields**,
   declared once in the `TYPE_COMP_FIELDS` map above `buildPrompt` (field keys +
   the prompt sentence describing them), which widens that type's JSON comp
   shape: Industrial `clear_height`/`dock_doors`, Office `building_class`/
   `floor_plate`, Retail `center_type`/`anchor_tenant`, Multifamily `units`/
   `price_per_unit`, Land `lot_acres`/`price_per_acre`/`zoning`, Residential
   `beds_baths` (a paired `lot_size` field was tried and dropped — the model's
   search budget doesn't stretch to a per-comp assessor lookup, so it came back
   empty on every test comp; see the note above `TYPE_COMP_FIELDS.Residential`).
   The front-end mirrors it in the `TYPE_COLUMNS` map
   feeding `columnsForType()` in `index.html`, where each column's `after` key
   names the column it sits behind (specs follow **Size**, per-unit/per-acre
   pricing follows **$/SF**); the active `COLUMNS` array is rebuilt per search in
   `renderResults()`. **A per-type field now spans up to four maps** —
   `TYPE_COMP_FIELDS` (server.js, the source of truth), `TYPE_COLUMNS`
   (comp-table columns), `TYPE_SUBJECT_FIELDS` (the subject-property form
   inputs, see flow 4), and `ALT_BASIS` (only for a denominator the market
   quotes, like units or acres). **The `add-comp-field` skill is the checklist
   — use it rather than working from memory.**
   A further place matters for durability: `harvestComps()` writes one flat corpus
   row per comp using `ALL_TYPE_COMP_FIELDS`, so the Supabase `comp_corpus` table
   needs a column per field. **Write the ALTER TABLE as the next numbered file
   in `migrations/` and run it before
   deploying a new field** — PostgREST 400s on an unknown column, which makes
   harvesting fall back to the ephemeral file and quietly lose data.
   `ALL_TYPE_COMP_FIELDS` is also in the `select` of `corpusRowsForMarket()`,
   so a missing column breaks **reads** too: retrieval returns empty, every
   market looks uncovered, and the corpus hit rate pins at 0%. This has already
   happened once (2026-07-27) and went unnoticed for weeks because both paths
   swallow their errors; the corpus health alarm described under **Comp corpus**
   exists to make the next occurrence visible on `/admin` within one search.
   Verify after deploying a field:
   ```sql
   select c from unnest(array['clear_height','dock_doors','building_class',
     'floor_plate','center_type','anchor_tenant','units','price_per_unit',
     'lot_acres','price_per_acre','zoning','beds_baths']) as c
   where not exists (select 1 from information_schema.columns
                     where table_name='comp_corpus' and column_name = c);
   ```
   Zero rows means the schema is complete. Confirm harvesting actually resumed
   by watching `select count(*) from comp_corpus` rise after a search — the row
   count is the only unambiguous proof, since a fallback write still logs a
   `+N` line and still returns a normal-looking report.

3a. **Per-type vocabulary (`ASSET_NOUN` / `assetNoun` / `assetNounPlural` /
   `setHeroTitle` in index.html).** The report called every subject a
   "building", so a house got a hero reading "WHAT THIS BUILDING IS WORTH"
   and a pointer to "Building Size" beside a field labelled *Property size*
   (owner feedback 2026-08-10). Residential is a `home` (which also covers
   **condos and townhomes** — they have no type of their own, and a condo is a
   home); Land, **Multifamily** and **Retail** are a `property`; only
   Industrial and Office fall through to `building`, because only those two
   genuinely are one. Multifamily is deliberately NOT "apartment building" or
   "apartment community" (owner's call, 2026-08-10): the type spans duplexes
   and 300-unit garden communities and neither phrase is true across that
   range, while `property` is also the unit the report already prices on
   (`ALT_BASIS`). Retail is `property` for the same both-shapes reason —
   "building" fits only a single-tenant pad, "center" only an anchored center.
   Three rules: **`SIZE_LABELS` no longer names the FORM field at all**
   (changed 2026-08-16) — that input is labelled **"Property SF" for every
   type**, one term true of a warehouse, a parcel and a house alike, and
   `syncSubjectFieldsToType` deliberately does not touch `#targetSizeLabel`
   any more, so the label cannot shift under a visitor when detection resolves
   the type a moment after they start typing. `SIZE_LABELS` is NOT dead: it
   still names the hero's basis line ("Building size" / "Lot size" / "Living
   area"), which is where the per-type nuance now lives along with the hint
   under the input; adding a type still means adding its entry. Read the rest
   of this rule with that split in mind — the old wording had Multifamily and
   Retail keeping "Building size (SF)" as the field label while the asset above
   was called a property, and that reconciliation is now the basis line's job
   alone; **plurals come from
   `ASSET_NOUN_PLURAL`, never `noun + "s"`**
   (that shipped "propertys" on Land); and **the hero heading is set at TWO
   seams** — `renderOwnerHero` and `beginAssembly` — because assembly puts the
   hero on screen a minute before the real render repaints it, so without the
   second one a house sits under the previous report's noun for the whole
   search. `setHeroTitle` takes the transaction focus as well as the type for
   the same reason (2026-08-21): worded at only one seam, a leases-only search
   would read "What This Building Is Worth" for that whole minute and then
   flip to "Rents For". The basis line reads its field name from `SIZE_LABELS[meta.type]`
   and **not** from `#targetSizeLabel`, because a shared report renders
   somebody else's type into a form still labelled for whatever this visitor
   last searched.

3b. **The lookback hint is recomputed, never written once**
   (`refreshLookbackHint` in index.html). It used to be set only by
   `applyRecommendedLookback`, so moving the window off the recommendation
   left "Recommended for Industrial" under a 6-month selection — the label
   asserting that the reader's own override was our advice. It now derives
   from `selectedLookbackMonths()` and **clears entirely on any deviation**.
   A first pass reworded it instead ("24 months recommended for Industrial",
   which is at least true) and the owner rejected that: the complaint is about
   a recommendation label still sitting under a window the reader deliberately
   changed, and rewording leaves one sitting there. The note is a caption for
   the default, not standing advice. It hangs off **three** seams and needs all of them: the select's
   `change`, the custom box's `input` (which changes the window without
   touching the select), and `setLookbackControls`. It is also called from
   `syncSubjectFieldsToType`, because both startup restores (`?type=` and
   `lastPropertyType`) set the type through that function alone and would
   otherwise leave the hint naming the page-load default type. That call
   refreshes the HINT only and deliberately never applies the recommended
   WINDOW: a restore is not a fresh decision, and a deep link may carry its
   own lookback.

3c. **`subject_last_sale` — the subject's own prior sale** (2026-08-10). The
   report never looked up whether the subject itself had recently traded, so
   a Bensalem property that sold a year earlier for $12.45M got a report that
   never mentioned it. The model returns `{ date, price, source_url }` and
   `renderSubjectLastSale` draws one line under the approaches. Four rules.
   **It costs no extra search by construction**: the ask rides on the
   `SUBJECT SIZE` step, whose assessor/parcel/listing pages already carry the
   sale history, and when `wantsSize` is false the wording drops to
   opportunistic rather than buying a search out of the comp budget. **It is
   evidence, not a fourth figure** — never put it in the ledger, because a
   years-old price shown big reads as a current valuation. **It is normalized
   server-side** (`normalizeSubjectLastSale`): no date means the whole field
   is dropped (a price with no date is unplaceable in time), and a non-http
   `source_url` is discarded before it can become an anchor href. **It is not
   a comp** — the prompt forbids it appearing in `comps`, and it is never
   harvested into `comp_corpus`, which holds comps and not a property's own
   sale of itself.

3d. **`subject_assessed` — the county's assessed value** (2026-08-14). Same
   ride-along as last-sale: the SUBJECT SIZE assessor pages already print the
   taxable/assessed figure, so it costs no extra search (`wantsSize` first;
   opportunistic otherwise). The model returns `{ value, year, source_url }`.
   **It is a cross-check, never a headline** — Low/Likely/High stay sales-comp
   or income math, and it is not the cost approach (that row stays "not
   modeled"). `assessedApproachEntry` draws one **County assessment** row in
   `#ownerApproaches` before the cost row, on every hero branch including the
   dashes branch when a value is present. **Value is required, year is not**
   (the opposite of last-sale): `normalizeSubjectAssessed` in `report-parse.js`
   drops the key without a parseable positive value, keeps a 4-digit tax year
   in 1990…current+1 (caller passes `now`), and strips non-http URLs.
   **Whole parcel or nothing** — land-only or improvements-only is a prompt
   refusal, not a parser guess. Disagreement with a dollar headline uses
   `VALUATION.outlierOf` (the same 25% nearest-edge rule as the table chips
   and the vault gut check), so the three cannot drift. Not harvested, not in
   `summary`, kept in shares (public record, not NOI-class). Spec:
   `docs/superpowers/specs/2026-08-14-tax-assessed-approach-design.md`.

3e. **`subject_asking` and `subject_year_built` — the live list price and vintage**
   (2026-08-14). A 1994 Rosedale house listed at $1.25M ($454/SF, at the
   neighborhood median) was reported at $1.65M because the comps were the
   expensive tail ($486–$653/SF) and a +5.5%/yr trend was applied in a
   declining market. The listing was sitting on the same page the size was
   read from. Four rules, the last-sale pattern reused. **It costs no extra
   search**: both fields ride the SUBJECT SIZE step. **The list price is
   evidence, not a fourth figure** — `renderSubjectAsking` draws one line
   under the approaches; `askFit` (pure, in `valuation.js`, same 25% rule as
   `outlierOf`) names a gap of more than 25% on the trust line and never
   becomes a fourth ledger figure. On houses it IS a `compWeight` factor:
   more than 1.5× off the asking $/SF floors the weight, so cheaper sales
   inside a typed 2.5-mile circle cannot set a $2M home to $1M. **Vintage
   is a `compWeight` factor** — free pass
   within 15 years of `subject_year_built`, then halving per further 15
   years — so a 2024 teardown-rebuild does not price a 1994 resale at full
   weight. **Distance is the fifth** — free pass within 1 mile, then a
   4-mile half-life for CRE and a **2-mile half-life for Residential**, with
   the free pass widened to a market-note radius when one was typed (so a
   "2.5 miles" note does not then punish comps at 2.4 miles). `distance_mi`
   rides `locked_basis` (never lat/lng). `year_built` rides `locked_basis` so
   free and Pro ranges still match. When the estimate sits well below the
   ask, the trust line names a cheaper pocket (the 19-comp / $1M-vs-$2M
   failure), not an ambitious list price. **User-typed
   asking price wins** (`askingRangeFrom`); the looked-up listing is the
   fallback that lights the comparison card when the visitor never typed one.

3f. **A leases-only report headlines RENT, not a missing sale price**
   (2026-08-21). Until this, `txFocus: "leases"` produced a hero with three
   dashes, the line "No priced sale comps came back in this window", and a
   button offering to re-run the whole search as SALES. Nothing had failed —
   the comps were in the table — the report was answering a question nobody
   asked, and it cost a billed search to find that out. Five rules:
   - **The figure is `MARKETSNAP.rentFromComps`, the market pages' own
     function**, reached from the browser rather than copied. `market-snapshot.js`
     is dual-exported for this (browser global `MARKETSNAP`, `maxAge: 0`,
     exactly like `valuation.js`, `gut-check.js` and `explore-query.js`). It
     cannot be computed once on the server and shipped, because excluding a
     comp has to move it; and a second copy of `leaseRentPsfYr` would be a
     second answer to whether `$1.08/SF/month ($12.96/SF/yr)` is 1.08 or 12.96.
   - **Gated on the SEARCH being leases-only** (`meta.txFocus === "leases"`),
     not on "no sale comps came back", so a sales search that returned nothing
     usable still says so and still offers the wider re-run.
   - **Quoted in the market's own basis, off ONE annual figure.** The figure
     is always annual (`leaseRentPsfYr` normalizes on the way in,
     `rentFromComps` medians one canonical number) — that half is
     broker-vault.js 029's rule and never bends, because a book holding two
     bases quotes three rents for one lease. The DISPLAY is
     `MARKETSNAP.leaseQuoteBasis`, which reads the basis off the comps'
     own rate strings and divides by 12 for display only: California
     industrial and retail quote MONTHLY, so "$16.20/SF/yr" in Fontana is a
     number nobody there says out loud. **Evidence only, and the leading quote
     wins** — `$1.08/SF/month ($12.96/SF/yr)` is one monthly vote, not one
     each; a bare numeric `price_per_sqft` votes for neither; a tie is annual.
     Note the deliberate asymmetry with `parseRentBasis`, which REFUSES to
     default: that one writes a stored figure where a guess is 12x wrong
     forever, while this one only picks a display unit for a number that is
     already correct, so annual is at worst unidiomatic. The cost translation
     in the trust line stays a YEAR figure in both bases and says "a year".
   - **Under-claims like everything else here.** Two priced leases minimum,
     never a one-comp band. Unlike `robustPpsfRange` there is no `trimmed`
     flag to lean on — `rentFromComps` interpolates quartiles at any count —
     so below four leases the trust line says it is a rough guide itself.
   - **`lastValuation` and `currentPsfBand` stay null through this branch.**
     A rent is not a value, and everything downstream of those two (the
     asking-price check, the BOV, a portfolio save) means dollars of building.
   - **The furniture follows the noun.** The heading (`setHeroTitle`, which
     takes `txFocus` so BOTH seams word it the same), the scatter caption
     (`compNoun`), the estimate disclaimer (`#ownerEstimateNote`, reset every
     render), the no-range copy, and the widen button's re-run focus. Found by
     rendering one, not by reading the diff: the branch was right the first
     time and three pieces of furniture around it still said "sales".
   - **The mechanics half describes the math that actually ran.** The
     collapsed "How this range is calculated" explained the headline with
     `compWeight` and the trend index, and the rent range applies NEITHER —
     `rentFromComps` takes plain unweighted quartiles — so it was not odd
     phrasing but an untrue account of how the figure was reached. It is
     chosen off `leaseHero`, a flag set INSIDE the branch and never derived
     from `leaseRent` being non-null (a leases-only search where somebody
     typed an NOI and a cap rate still leads with the income approach). The
     Residential MLS sentence is **omitted rather than reworded** on a rent
     range: MLS, a CMA and an appraisal are all sale-price instruments, and
     residential rental listings are ordinarily web-visible in a way MLS sales
     are not, so there is no true lease version of that claim.
   - **Every $/SF figure on the page says which rate it is.** The hero may
     quote per MONTH while the comp table's `price_per_sqft` column and the
     Market Avg tile hold the ANNUAL figure, so an unlabelled 13.5 under a
     headline of $1.18 is the one number a reader could take for a monthly
     rate and be 12x out. `columnsForType(type, txFocus)` relabels that column
     `$/SF/yr` on a leases-only report and `renderStatTiles` does the same for
     the tile. **Label only, never convert**: that column is shared with sale
     reports and feeds sorting and the exports, and a column meaning different
     things on different reports is the two-bases hazard broker-vault.js
     refuses to take on. It relabels a COPY, or the first lease report would
     leave `$/SF/yr` on every sale report after it in the same session, and
     the test executes both column sets to prove nothing else moved.
   - **The lead ask follows the noun too, and the lead itself does not.**
     `bovCopy(meta)` gains a leases branch: "Get a free Broker Opinion of
     Value / Want a real number?" under a rent range offers a SALE price and
     reads as the report disowning the figure it just published. It is the
     Residential branch's fix one report type over, and the same rule — the
     words change, `openLeadModal("bov")` does not, so the broker inbox, the
     coverage-gated intro and the BOV tracker are untouched. **Residential is
     read FIRST**: a house that rents is a Residential report, and the trust
     line's screen-only pointer ("A local agent below can confirm it") is
     Residential-only and names that button by its noun, so a lease branch
     above it would say agent above and leasing broker below — the drift that
     block's own ⚠ warns about.

3. **All valuation math is client-side; the model only supplies market
   figures.** `renderOwnerHero()` in `index.html` computes the Low/Likely/High
   range from sale-comp $/SF (leases are excluded even on mixed searches) ×
   the subject SF — the user's entry wins over the looked-up
   `subject_size_sqft`, and a looked-up size is auto-filled into the form
   input as an editable override. Since 2026-08-04 the browser also pre-fills
   an OSM footprint-derived size estimate during the address-confirm dialog
   (`maybeEstimateSize` in index.html: shoelace area × building:levels,
   `fpSize.v2` cache, gated to verified street-numbered non-Land addresses,
   labeled by `#sizeEstimateNote` and editable) — which doubles as a
   search-budget cut, since a size that rides the request skips the model's
   2-search size lookup. An Overpass outage is deliberately NOT cached as a
   miss. The prompt's PRICED BUT UNSIZED COMPS rule is the server-side
   sibling: a priced sale comp missing its size is worth one dedicated
   search, verified to lift priced-comp counts on thin markets.
   **This is the most expensive number in the report, because the hero
   multiplies it, and it shipped for nine days willing to measure any
   building.** On 2026-08-13 a Boise mobile home listed on Zillow at $52,000
   was reported at $795,000: "biggest footprint within 120 m" chose Bob's
   Bicycles, 10,064 sq ft, 81 m up W Fairview Ave, and 10,100 SF × the comps'
   $78/SF median is $795,000 to the dollar. Nothing was wrong with the comps
   — the model returned eight manufactured homes at $61-158/SF and said so.
   Three rules now stand between that footprint and the size box, and all
   three matter because each catches a case the others miss.
   **The footprint must PROVE the address** (`addr:housenumber` +
   `addr:street`) — the same filter `detectPropertyType` has applied since
   the Phoenix "Mandarin Super Buffet" bug, which this estimate and the map
   photo simply never adopted even though the photo's own comment claimed
   they followed the same rule. **More than one proving footprint refuses**,
   which is the deliberate OPPOSITE of `detectPropertyType` preferring the
   main mass: every part of a campus shares one property TYPE, while only one
   of them is the building whose square footage the value hangs on (38
   footprints prove #6728 at Fairview). **And a unit designator refuses**
   before the query is even made (`unitDesignatorOf`, shared with the photo
   gate — see `GOOGLE_MAPS_API_KEY` above for its vocabulary and tests).
   A refusal is cheap and self-healing: the server then spends the two
   searches it saved looking the size up from public records, which is what
   it did before this estimate existed and is better data than a measurement
   of the wrong building. `fpSize` went to **v2** because entries are now
   keyed by address as well as coordinates, and the bump retires the wrong
   sizes already cached in browsers.
   The backstop for every OTHER way a wrong size arrives (a record lookup, a
   typo) is **`VALUATION.subjectSizeFit`** — pure and tested, and the single
   owner of "how does the subject's size compare to the comps'", so the trust
   line's "N comps are a different size class" count and this warning can
   never disagree. When EVERY sized comp falls outside `compWeight`'s 0.5x-2x
   window and the subject sits entirely past one end of their range, the odd
   one out is the SUBJECT SIZE, not the comps, and the trust line says which
   figure to doubt and how far the range is extrapolated. That report already
   whispered "8 comps are a different size class and count less", which reads
   as a footnote about the comps rather than a warning that the headline was
   extrapolated 6.8× past every one of them. It deliberately stays quiet when
   the comps STRADDLE the subject (one far smaller, one far larger): that is
   a scattered comp set, which the weighting already handles, not a size box
   holding a number from a different building.
   NOI **never reaches the model or any public
   surface**: the income-approach cross-check divides the browser-held NOI by
   the model's `market_cap_rate_range`, `/api/comps` never receives it, and
   `/api/share` strips it before publishing. The same rule covers **debt
   terms** (`meta.assumptions.debt` — loan amount/rate/amortization, powering
   the debt & refi card), the **rent roll** (`meta.assumptions.rentRoll` —
   tenant-level rents behind the rollover card), and the op-ex card's **gross
   income** (`meta.assumptions.opex.grossIncome` — the expense-ratio
   denominator; the market band `market_opex_range` itself is market data and
   stays): private finances, stripped from shares. The DCF's
   four assumptions (hold/growth/discount/exit cap) are opinions, not
   finances, and stay in shares. So is the owner's own **cap rate**
   (`meta.subject.capRate`, the Refine field that replaced Price max on
   2026-08-10): browser-only like the NOI it divides, never in the
   `/api/comps` body and so never in the cache key, but NOT stripped by
   `/api/share` — it discloses nothing alone, because every surface it drives
   needs the NOI that already is stripped. It adds a second income-approach
   line beside the market's (`incomeApproachEntries` — one builder, 0-2
   entries, every hero branch spreads it so the two lines cannot drift or be
   ordered differently), carries the income approach outright when the model
   returned no `market_cap_rate_range`, and seeds the DCF at seed time only.
   A single rate renders a single figure: it is deliberately never widened
   into a band, since an invented spread would be indistinguishable on
   screen from one the comps earned. The one deliberate exception for all of
   these private figures (NOI, debt, rent roll, gross income) is the
   signed-in **portfolio**: a saved report's `meta.subject`
   and `meta.assumptions` are stored in the owner's own authenticated
   `portfolio_items` row so the analysis re-renders cross-device — any future
   share-from-portfolio feature must strip them the way `/api/share` does.
   **Report curation** (`meta.curation` — excluded comp keys, user-added
   comps, the owner's price-discovery read) is the same class of opinion:
   it persists in saved reports/portfolio and stays in shares. Added comps
   live ONLY in `meta.curation.added`, never in `data.comps`, so no server
   path (share, portfolio, harvest) ever ingests a user-authored comp into
   the corpus. The valuation math reads `includedComps()`; the table shows
   excluded rows greyed as an audit trail. Since 2026-08-09 the curation cell
   also carries a screen-only outlier chip (`buildOutlierChip`): an included
   sale comp whose displayed $/SF sits more than 25% outside the hero's
   displayed band (`VALUATION.outlierOf`, the same 25% rule as the vault gut
   check, `⚠`-paired) reads "{pct}% above/below the range". Chips derive at
   render from `currentPsfBand` (stashed by `renderOwnerHero`, one computation
   for both surfaces), are never stored, never print or capture, and never
   render on shared views; below 4 sale comps the band is the full spread, so
   they cannot fire. The hero's **comp scatter** (`renderCompScatter`, shipped
   2026-08-09) reads the same stash: a hairline number line under the ledger
   with one tick per sale comp at its own displayed $/SF, a tint spanning
   Low-High and a red mark at Likely, so the agreement the trust line asserts
   in words is visible. Four rules. **The axis spans the comps, not the
   band** — the band is the weighted interquartile range, so with 4+ comps
   roughly half of them sit OUTSIDE it by construction and an axis clipped to
   Low-High would hide half the evidence; the band is drawn inside the axis as
   the tint instead. **Ticks use the DISPLAYED figure**, never the
   trend-indexed weighted one the band is computed from, which is what stops a
   tick sitting outside the tint while `buildOutlierChip` calls that same comp
   in-range. **It only draws where the ledger above quotes the same unit** (so
   the per-unit/per-acre branch passes its own values through the same generic
   renderer, and the income-approach branch draws nothing) and only when
   `band.trimmed`, the same 4-comp floor as the chips. **It prints and
   captures on purpose**, being the evidence for the figures above it: hence
   no flex gap and no transform anywhere inside it, `print-color-adjust:
   exact` (every mark on the line is a background colour, and paper drops
   those by default — the file's only use of that property), and
   `ownerScatter` in `beginAssembly`'s `asm-hidden` list so the previous
   report's line can't hang under the next report's placeholder. Spec:
   `docs/superpowers/specs/2026-08-09-hero-comp-scatter-design.md`.
   The "Avg $/SF" stat tile and the
   market comparison read the MODEL's market-level figure and deliberately
   do not change with curation. Subject inputs
   persist in each report's `meta` (saved reports re-render without the
   form), and editing size/price/NOI after a report re-renders the
   hero/comparison/chart in place — no new billed search.

4. **Per-type subject details (the user's own building).** The "Your property
   details" section adapts to the property type: `TYPE_SUBJECT_FIELDS` +
   `renderSubjectFields()` (`index.html`) rebuild the inputs whenever the type
   changes, `readSubjectDetails()` reads them into a flat object, and the
   values ride to `POST /api/comps` as `subjectDetails` and persist at
   `meta.subject.details`. Four things are easy to get wrong here:
   - **The subject keys must be a subset of that type's `TYPE_COMP_FIELDS`
     fields.** `sanitizeSubjectDetails()` whitelists against exactly that list,
     so an input whose key isn't a declared comp field is silently dropped.
   - **`cacheKeyFor` includes the details**, appended only when non-empty so
     existing cache entries keep their keys. Without this a 48-unit and a
     6-unit building at one address collide and are served each other's comps.
   - **The type dropdown is gone from the visible form** (2026-08-08): a hidden
     `#propertyType` select remains the single source of truth, and the type is
     resolved at verification — OSM detection, per-address memory
     (localStorage `addrType.v1`), or a required pick in the confirm dialog
     (`typeResolution` in index.html: null | "detected" | "remembered" |
     "explicit"). The three resolved values split on **who** decided, because
     only a human's decision may outlive the address it was made about:
     `"explicit"` (a picker, a chip, a saved or shared report) survives address
     edits, while `"detected"` (OSM tags) and `"remembered"` (recalled from
     `addrType.v1`) are machine states about ONE address and both reset to null
     on an address change, after which that address's own memory then its own
     detection are consulted. Marking a recall explicit let address A's type
     survive onto address B, suppress B's memory, and overwrite it at submit.
     Every programmatic type change must go through `setTypeProgrammatic()` (or
     call `syncSubjectFieldsToType()` and mark `typeResolution` itself), or the
     subject inputs keep the previous type's fields. That function is a
     **no-op when the type is unchanged** — it resets the lookback window and
     re-renders (i.e. empties) the subject inputs, which is right after a
     change and destructive without one; the confirm dialog's "change" door
     pre-selects the current type, so a plain confirm used to wipe a typed
     lookback and typed details moments before the billed search. The select
     fires no `change` events anymore; nothing may rely on them. The
     `lastPropertyType` restore at startup is likewise guarded on
     `typeResolution === null`: a repeat visitor's hint may not overrule a
     decision a deep link or a restored report already made.
   - **The subject-edit listener replaces `meta.subject` wholesale**, so it
     re-reads `details` from the DOM rather than merging — anything not
     re-read is lost on the next keystroke.
   Unlike NOI/debt/rent-roll these are public property attributes, so they are
   sent to the server and **kept** in shared reports. `units` and `lot_acres`
   also drive the $/unit and $/acre cross-checks via `ALT_BASIS` /
   `altBasisEntry`, which render as entries in the hero's `renderApproaches`
   list (min 3 comps carrying the metric). Land is quoted in acres but the
   valuation path is $/SF, so `renderOwnerHero` converts acres × 43,560 when no
   SF is given.

5. **Currency (non-US searches).** The model quotes a foreign target's prices
   in the LOCAL currency and returns top-level `currency` (ISO code) +
   `usd_rate` (value of 1 unit in USD, bounded to (0, 10) — anything larger
   is treated as an inverted rate and dropped), normalized by
   `normalizeCurrency()` in server.js. The front-end never converts the
   math — `formatUsd()` and `displayMoney()` convert at the formatting layer
   when the report-header "Show in USD" switch is on, and `displayMoney`
   REFUSES ambiguous strings (ranges, European grouping, shorthand like
   "1.2M", negative heads) rather than risk a wrong number — refused values
   render raw. `harvestComps()` skips non-USD reports entirely (corpus rows
   have no currency column, so foreign prices would masquerade as USD —
   skipping beats an ALTER TABLE for a rare case). Note `marketOf()` yields
   just "Canada" for Canadian addresses (it parses "City, ST"); harmless
   while non-USD reports skip the corpus, but fix it before ever harvesting
   them. International searches run long — the first Canadian test search
   timed out under the old fixed 100s call ceiling and succeeded on retry;
   the deadline has since become per-call (`searchTimeoutMsFor`, ~260s for
   a full-budget report), sized so a healthy slow search finishes instead
   of being aborted after it was already billed.

## Deployment

Standard Node web service. Push to a Git host and deploy on Render/Railway/Fly/etc.
with start command `npm start`. Set `ANTHROPIC_API_KEY` (and `APP_PASSWORD` for a
public link) as host environment variables — do not rely on `.env` in production.
Every search is billed to the owner's Anthropic account, which is why a public
deployment should set `APP_PASSWORD` and/or a spend cap in the Anthropic console.
