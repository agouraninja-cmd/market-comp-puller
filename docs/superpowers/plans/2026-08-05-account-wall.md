# Account Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CompNinja account-only, with `/how-it-works` as the front door for anonymous visitors, reversible by a single environment variable.

**Architecture:** One new env var, `ACCOUNT_WALL` (default on), forces `GUEST_SEARCH_LIMIT` to 0 so the wall and the API gate can never disagree. A guard inside the existing SPA route in server.js 302s anonymous visitors to `/how-it-works`, deciding on `cn_session` cookie *presence* only so the home route stays free of a per-pageview database read. `/how-it-works` gains signup and login controls; index.html hides the search form behind the same flag. Enforcement stays server-side in `/api/comps`, exactly as it does today.

**Tech Stack:** Plain Node (no dependencies, no build step), `node --test`, vendored Tailwind, single-file front end.

**Spec:** `docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md`

---

## Before you start: read this

**1. The test suite is already RED on this checkout, and it is not your fault.**

Run the suite first so you can see the baseline:

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; npm test
```

(That is PowerShell. `node` is a portable, no-admin copy on this machine and is not on PATH in bash.)

Measured baseline on 2026-08-05, immediately before this plan was written: **217 tests, 213 pass, 4 fail.** The failures are `market explorer guest cap` and `market explorer with the guest gate disabled` (two blocks, two subtests). They belong to another session's in-flight Market Explorer work, and they also trip over a git-ignored `market-pages-dynamic.json` that local testing leaves behind. **Do not fix them and do not delete that file.** Your bar is: no *new* failures, every test you add passes, and the pass count rises.

**2. This checkout is shared, actively.** A second Claude session and a human collaborator write to the same working tree, and they rewrite branch history: while this plan was being written, that session's commits dropped an already-committed commit off `dev-hub`, which had to be restored. Before every `git add`: run `git status --short`, stage explicit paths only, never `git add -A`. After every commit, run `git log --oneline -3` and confirm your commit is actually there. `test/routes.test.js` was dirty while this plan was written and is committed now, so Task 2's procedure may be simpler than described; check the tree rather than trusting either claim.

**3. Restart rule.** Editing `server.js` requires restarting the server process. Editing `index.html` does not (it is read from disk per request). New Tailwind utility classes in `index.html` require `tailwind.css` to be regenerated; Task 9 covers it.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `server.js` | `ACCOUNT_WALL` constant, forced guest limit, the redirect guard, sitemap, startup log, `/api/config`, the `/how-it-works` page and its CSS | Modify |
| `index.html` | Locked search-form card, `?auth=` handler, strapline copy, remove the `WebApplication` JSON-LD | Modify |
| `test/helpers/boot.js` | Shared "boot a real server as a child process and wait for /healthz" harness | Create |
| `test/account-wall.test.js` | Every route-level assertion about the wall | Create |
| `test/routes.test.js` | One line: opt the existing bare boot out of the wall | Modify |
| `tailwind.css` | Vendored Tailwind build | Regenerate |
| `devlog.json` | Changelog entry | Modify |
| `CLAUDE.md` | Document the new env var | Modify |

A new test file rather than more of `test/routes.test.js`: that file is being edited by another session right now, and a whole new test block in it would collide. `test/helpers/boot.js` is not matched by the `test/*.test.js` glob in `package.json`, so it will not be run as a test.

---

### Task 1: `ACCOUNT_WALL` forces the guest limit to zero

**Files:**
- Create: `test/helpers/boot.js`
- Create: `test/account-wall.test.js`
- Modify: `server.js` (the guest-quota constant block near line 454, and `/api/config` near line 9856)

- [ ] **Step 1: Create the shared boot harness**

Create `test/helpers/boot.js`. This is lifted from the top of `test/routes.test.js` so the new file does not depend on it while it is being edited elsewhere:

```js
// Boot server.js as a child process and wait for /healthz. Shared by the
// route-level suites. Not named *.test.js on purpose: package.json runs
// `node --test "test/*.test.js"`, so this file is a helper, not a suite.
const { spawn } = require("node:child_process");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "..", "server.js");

// High ports, clear of the dev servers this repo uses (3000, 3117-3121) AND of
// the 39140 block routes.test.js allocates from. Each test FILE is its own
// process under `node --test`, so the two counters cannot see each other.
let nextPort = 39160;

// `env` REPLACES rather than extends the parent environment for the keys that
// matter, so a developer's local .env cannot change what these tests prove.
async function boot(env) {
  const port = nextPort++;
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      ANTHROPIC_API_KEY: "",
      ADMIN_KEY: "",
      APP_PASSWORD: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      STRIPE_SECRET_KEY: "",
      PRO_ENABLED: "",
      ...env,
    },
    stdio: "ignore",
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("server exited early, code " + child.exitCode);
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) return { base, stop: () => child.kill() };
    } catch (_) { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("server never became healthy on port " + port);
}

module.exports = { boot };
```

- [ ] **Step 2: Write the failing test**

Create `test/account-wall.test.js`:

```js
// The account wall — routing and the forced guest limit.
//
// Run: npm test
//
// Cost: zero. Nothing here calls Anthropic, Stripe or Supabase. Two tests boot
// with a FAKE api key so that /api/comps reaches the guest gate at all (see
// FAKE_KEY below); the gate refuses before any upstream call, so a passing run
// spends nothing and a failing one dies on an invalid key rather than a bill.
//
// Spec: docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md

const test = require("node:test");
const assert = require("node:assert");
const { boot } = require("./helpers/boot");

// --- The lever ------------------------------------------------------------

// /api/comps checks for a missing ANTHROPIC_API_KEY (server.js line 7946)
// BEFORE it reaches the guest gate (line 8025), so a bare environment answers
// 500 and the gate is never observed. A syntactically plausible fake key gets
// past that check; the gate then returns 403 before any Anthropic call, so a
// passing test still costs nothing and touches no network. If the gate ever
// regresses, the request fails upstream on an invalid key rather than
// spending anything — which is the failure mode you want in a test suite.
const FAKE_KEY = "sk-ant-not-a-real-key";

test("the wall forces the guest search limit to zero", async (t) => {
  // GUEST_SEARCH_LIMIT deliberately set to something generous: the point is
  // that the wall overrides it rather than trusting two env vars to agree.
  const srv = await boot({ ACCOUNT_WALL: "on", GUEST_SEARCH_LIMIT: "5", ANTHROPIC_API_KEY: FAKE_KEY });
  t.after(() => srv.stop());

  await t.test("/api/config reports the wall and a zero limit", async () => {
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.accountWall, true);
    assert.equal(cfg.guestSearch.limit, 0, "GUEST_SEARCH_LIMIT=5 must not survive the wall");
  });

  await t.test("an anonymous report search is refused", async () => {
    const r = await fetch(srv.base + "/api/comps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "123 Main St, Boise, ID", type: "Industrial" }),
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    // The client keys off this flag, never off the status code.
    assert.equal(j.signin_required, true);
  });
});

test("the rollback lever restores the configured guest limit", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5" });
  t.after(() => srv.stop());

  await t.test("/api/config reports no wall and the real limit", async () => {
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.accountWall, false);
    assert.equal(cfg.guestSearch.limit, 5);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; npm test
```

Expected: the four new subtests fail. `cfg.accountWall` is `undefined`, not `true`, and `cfg.guestSearch.limit` is `5`, not `0`.

- [ ] **Step 4: Add the constant**

In `server.js`, directly above the `GUEST_LIMIT_RAW` line (currently line 460), insert:

```js
// Account wall — ACCOUNT_WALL=on (the default) makes CompNinja account-only:
// an anonymous visitor is sent to /how-it-works, which is the front door and
// carries the signup controls. "off" is the instant rollback lever on Render
// (an env edit, no deploy) and restores the pre-wall app exactly, including
// GUEST_SEARCH_LIMIT's own configured value.
// Spec: docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md
const ACCOUNT_WALL = String(process.env.ACCOUNT_WALL ?? "on").trim().toLowerCase() !== "off";
```

Then change the `GUEST_LIMIT_RAW` line from:

```js
const GUEST_LIMIT_RAW = String(process.env.GUEST_SEARCH_LIMIT ?? "1").trim().toLowerCase();
```

to:

```js
// Under the wall the limit is 0, whatever GUEST_SEARCH_LIMIT says. The two are
// not allowed to disagree: a wall that is up while /api/comps still hands out
// a free search is the one inconsistent state worth designing out, and it
// would be invisible in testing because both halves look correct alone.
const GUEST_LIMIT_RAW = ACCOUNT_WALL
  ? "0"
  : String(process.env.GUEST_SEARCH_LIMIT ?? "1").trim().toLowerCase();
```

- [ ] **Step 5: Expose it on `/api/config`**

In the `/api/config` response object (currently around line 9857), add `accountWall` beside `authRequired`:

```js
      sendJson(res, 200, {
        authRequired: Boolean(APP_PASSWORD),
        accountWall: ACCOUNT_WALL,
        guestSearch,
```

- [ ] **Step 6: Run the tests**

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; npm test
```

Expected: all four new subtests PASS. The two pre-existing `market explorer` failures are still there; ignore them.

- [ ] **Step 7: Commit**

```bash
git status --short
git add server.js test/helpers/boot.js test/account-wall.test.js
git commit -m "ACCOUNT_WALL forces the guest search limit to zero"
```

---

### Task 2: Stop the wall breaking the existing route tests

`test/routes.test.js` asserts that `/`, `/index.html`, `/desk`, `/r/abc123`, `/?utm_source=newsletter` and `/desk?checkout=success` all return 200 (lines 82-92). Those tests are about **path matching**, not about the wall, so they need a wall-free server. Add the opt-out to the shared default environment in that file's `boot()`, where every other route-deciding key is already cleared.

**This file has uncommitted changes from another session.** Follow the procedure exactly.

**Files:**
- Modify: `test/routes.test.js` (the `env:` block inside `boot()`, near line 40)

- [ ] **Step 1: Confirm what is in the tree right now**

```bash
git status --short test/routes.test.js
git diff -- test/routes.test.js
```

Read the whole diff. The other session's hunks are far below, around lines 197-260 (a `uncoveredMarket()` helper and its two call sites). Your edit is at line ~40 and must not overlap them.

- [ ] **Step 2: Make the one-line edit**

In `boot()`'s `env:` object, in the block commented "Cleared unless a test opts in", add a line after `PRO_ENABLED: "",`:

```js
      PRO_ENABLED: "",
      // Off by default here: this file's SPA-routing tests prove that / and
      // /desk MATCH on path, which needs a server that is not walling them.
      // The wall's own routing lives in test/account-wall.test.js.
      ACCOUNT_WALL: "off",
```

- [ ] **Step 3: Stage only your hunk**

Do not `git add test/routes.test.js` whole; that would stage the other session's work as yours. Build a patch of your hunk only, using the Bash tool (PowerShell re-encodes diff output and the patch will not apply):

```bash
git diff -- test/routes.test.js > /tmp/rt.patch
```

Open `/tmp/rt.patch`, delete every hunk except the one whose `@@` header covers your `ACCOUNT_WALL: "off"` line, then:

```bash
git apply --cached /tmp/rt.patch
git diff --cached -- test/routes.test.js
```

Expected: the staged diff shows your four added lines and nothing else. If a foreign hunk rode along (the index is shared state), unstage with `git restore --staged test/routes.test.js` and wait for the other session's commit.

- [ ] **Step 4: Commit**

```bash
git commit -m "routes.test.js: the SPA path-matching tests opt out of the wall"
```

---

### Task 3: The redirect

**Files:**
- Create test in: `test/account-wall.test.js`
- Modify: `server.js` (the SPA route handler, currently line 10171)

- [ ] **Step 1: Write the failing test**

Append to `test/account-wall.test.js`:

```js
// --- Routing --------------------------------------------------------------

// The routing layer decides on cookie PRESENCE, never on a validated session:
// getSessionUser() reads the database and this route runs on every page view.
const FAKE_SESSION = { cookie: "cn_session=not-a-real-token" };

test("the wall routes anonymous visitors to /how-it-works", async (t) => {
  // Fake key for the same reason as above: the forged-cookie subtest below
  // needs /api/comps to get past its missing-key check and reach the gate.
  const srv = await boot({ ACCOUNT_WALL: "on", ANTHROPIC_API_KEY: FAKE_KEY });
  t.after(() => srv.stop());

  const get = (p, headers) =>
    fetch(srv.base + p, { redirect: "manual", headers: headers || {} });

  await t.test("the app redirects", async () => {
    for (const p of ["/", "/index.html", "/desk", "/?utm_source=newsletter", "/desk?checkout=success"]) {
      const r = await get(p);
      assert.equal(r.status, 302, p + " should send an anonymous visitor away");
      assert.equal(r.headers.get("location"), "/how-it-works", p + " should land on the front door");
      // A cached redirect would survive the visitor signing in.
      assert.match(r.headers.get("cache-control") || "", /no-store/, p + " redirect must not be cached");
    }
  });

  await t.test("shared reports stay public", async () => {
    const r = await get("/r/abc123");
    assert.equal(r.status, 200, "a shared link is the whole point of the share feature");
  });

  await t.test("the auth door serves the app", async () => {
    // Without this the signup buttons on /how-it-works point at a redirect
    // back to /how-it-works, and there is no way to reach the account modal.
    for (const p of ["/?auth=signup", "/?auth=signin"]) {
      assert.equal((await get(p)).status, 200, p + " must serve index.html");
    }
    // Anything else in that parameter is not a door.
    assert.equal((await get("/?auth=whatever")).status, 302);
  });

  await t.test("a session cookie is enough to reach the app", async () => {
    assert.equal((await get("/", FAKE_SESSION)).status, 200);
  });

  await t.test("but a forged cookie still cannot search", async () => {
    // Presentation versus enforcement: the routing layer is deliberately
    // cheap and fooled by any cookie; /api/comps is where the wall is real.
    const r = await fetch(srv.base + "/api/comps", {
      method: "POST",
      headers: { "content-type": "application/json", ...FAKE_SESSION },
      body: JSON.stringify({ address: "123 Main St, Boise, ID", type: "Industrial" }),
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).signin_required, true);
  });

  await t.test("the public pages are untouched", async () => {
    for (const p of ["/how-it-works", "/markets", "/brokers", "/terms", "/privacy", "/healthz"]) {
      assert.equal((await get(p)).status, 200, p + " must stay public");
    }
  });
});

test("with the wall off the app is open again", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());

  await t.test("/ serves the app to an anonymous visitor", async () => {
    const r = await fetch(srv.base + "/", { redirect: "manual" });
    assert.equal(r.status, 200);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; npm test
```

Expected: the redirect subtests fail with `200 == 302`. "shared reports stay public", "the auth door serves the app", "the public pages are untouched" and the wall-off test already pass, which is correct: they pin behaviour that must survive.

- [ ] **Step 3: Add the guard**

In `server.js`, inside the SPA route handler (currently line 10171), insert the guard as the first statement in the `if` body, above `fs.readFile`:

```js
  if (req.method === "GET" && (staticPath === "/" || staticPath === "/index.html" || staticPath === "/desk" || /^\/r\/[A-Za-z0-9_-]{6,32}$/.test(staticPath))) {
    // Account wall: an anonymous visitor meets /how-it-works, not the app.
    //
    // Cookie PRESENCE only, never getSessionUser() — that helper reads the
    // database and this route runs on every page view. A forged cookie buys
    // the sight of a locked search form and nothing else, because
    // GUEST_SEARCH_LIMIT is forced to 0 under the wall and /api/comps still
    // refuses the search. Presentation here, enforcement there, as everywhere
    // else in this codebase.
    //
    // Two exemptions. Shared reports are public by design — that is the whole
    // share feature. And ?auth= has to serve the app, or the signup buttons on
    // /how-it-works point straight back at /how-it-works and the account modal
    // (which lives only in index.html) becomes unreachable.
    //
    // 302, not 301: what lives at / genuinely depends on auth state, and a
    // permanent redirect would be cached past the point where the visitor has
    // an account. no-store for the same reason.
    if (ACCOUNT_WALL && !parseCookies(req)[SESSION_COOKIE]) {
      const auth = new URLSearchParams(req.url.split("?")[1] || "").get("auth");
      const shared = /^\/r\/[A-Za-z0-9_-]{6,32}$/.test(staticPath);
      if (!shared && auth !== "signup" && auth !== "signin") {
        res.writeHead(302, { location: "/how-it-works", "cache-control": "no-store" });
        return res.end();
      }
    }
    fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
```

- [ ] **Step 4: Run the tests**

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; npm test
```

Expected: every subtest in `test/account-wall.test.js` PASSES, and `test/routes.test.js`'s SPA-routing tests still pass because of Task 2. Only the two pre-existing `market explorer` failures remain.

- [ ] **Step 5: Commit**

```bash
git status --short
git add server.js test/account-wall.test.js
git commit -m "Wall the app: anonymous visitors land on /how-it-works"
```

---

### Task 4: Keep the sitemap honest

**Files:**
- Modify: `test/account-wall.test.js`
- Modify: `server.js` (sitemap, currently line 10600)

- [ ] **Step 1: Write the failing test**

Add to the `test("the wall routes anonymous visitors to /how-it-works", ...)` block, as another subtest:

```js
  await t.test("the sitemap does not advertise a redirect", async () => {
    const xml = await (await fetch(srv.base + "/sitemap.xml")).text();
    assert.ok(!/<loc>[^<]*\/<\/loc>/.test(xml), "the bare / redirects under the wall; do not list it");
    assert.match(xml, /how-it-works/, "the front door must still be listed");
  });
```

And to the `test("with the wall off the app is open again", ...)` block:

```js
  await t.test("the sitemap lists / again", async () => {
    const xml = await (await fetch(srv.base + "/sitemap.xml")).text();
    assert.match(xml, /<loc>[^<]*\/<\/loc>/, "with no wall, / is the landing page again");
  });
```

- [ ] **Step 2: Run it and watch the first one fail**

Expected: "the sitemap does not advertise a redirect" fails; "the sitemap lists / again" passes.

- [ ] **Step 3: Make the entry conditional**

In `server.js`, change the sitemap line:

```js
      `  <url><loc>${SITE_URL}/</loc></url>\n` +
```

to:

```js
      // Under the wall / is a 302 to /how-it-works, and listing a redirecting
      // URL is a soft error in Search Console. ACCOUNT_WALL=off restores it.
      (ACCOUNT_WALL ? "" : `  <url><loc>${SITE_URL}/</loc></url>\n`) +
```

- [ ] **Step 4: Run the tests**

Expected: both sitemap subtests PASS.

- [ ] **Step 5: Commit**

```bash
git status --short
git add server.js test/account-wall.test.js
git commit -m "Drop / from the sitemap while the wall is up"
```

---

### Task 5: Say so at startup

An env var that silently changes what every visitor sees needs to announce itself, the way the guest cap and `PRO_AUDIENCE` already do.

**Files:**
- Modify: `server.js` (startup banner, currently line 10645)

- [ ] **Step 1: Add the log line**

Directly above the existing `console.log(GUEST_GATE_ON ...)` call, insert:

```js
  console.log(ACCOUNT_WALL
    ? "🔐 Account wall ON — anonymous visitors are sent to /how-it-works, and GUEST_SEARCH_LIMIT is forced to 0. Set ACCOUNT_WALL=off to reverse."
    : "🔓 Account wall off (ACCOUNT_WALL=off) — the app is open to anonymous visitors.");
```

- [ ] **Step 2: See it**

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; node server.js
```

Expected: the banner shows the `🔐 Account wall ON` line, and the line below it reads `0 free search(es) per visitor`. Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git status --short
git add server.js
git commit -m "Log the account wall's state at startup"
```

---

### Task 6: `/how-it-works` becomes a front door

Four changes to `renderHowItWorksHTML()` plus three CSS rules. The page is served with `cache-control: public, max-age=3600`, so every link here must be a static href that is correct for any visitor. A signed-in visitor who follows one gets the app with no modal, because the modal only opens when there is no session.

**Files:**
- Modify: `test/account-wall.test.js`
- Modify: `server.js` (`HOW_CSS` line 4609-4730, `renderHowItWorksHTML` line 5013-5237)

- [ ] **Step 1: Write the failing test**

Append to `test/account-wall.test.js`:

```js
// --- The front door -------------------------------------------------------

test("/how-it-works carries the signup controls", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("both auth doors are linked", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    assert.match(html, /href="\/\?auth=signup"/, "a visitor sent here must be able to create an account");
    assert.match(html, /href="\/\?auth=signin"/, "and an existing customer must be able to log in");
  });

  await t.test("nothing on the page links back into a redirect", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    // The closing CTA used to point at "/", which under the wall bounces the
    // visitor straight back to the page they are standing on.
    assert.ok(!/href="\/"[^>]*class="btn"/.test(html), "the CTA must not point at the walled app");
  });

  await t.test("the redundant top kicker is gone", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    assert.ok(!/class="kicker">How it works</.test(html), "the page IS the front door; it need not label itself");
    assert.match(html, /class="kicker">Method</, "the other section kickers stay");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: all three subtests fail.

- [ ] **Step 3: Remove the kicker**

In `renderHowItWorksHTML()`, delete this line (currently 5120):

```js
      <div class="kicker">How it works</div>
```

- [ ] **Step 4: Add the header controls**

Replace the `<nav>` block in that function's `body` (currently lines 5084-5093) with:

```js
    <nav>
      <details>
        <summary>Explore<span class="car">▾</span></summary>
        <div class="dd">
          <a href="/markets">Markets</a>
          <a href="/brokers">Brokers</a>
          <a href="/how-it-works" class="on" aria-current="page">How it works</a>
        </div>
      </details>
      <a href="/?auth=signin">Log in</a>
      <a class="btn sm" href="/?auth=signup">Create account</a>
    </nav>
```

- [ ] **Step 5: Add the hero controls**

In the first `<section>` of `main`, after the `<p class="lead">...</p>` element, add:

```js
      <div class="heroCta">
        <a class="btn" href="/?auth=signup">Create a free account</a>
        <span class="alt">Already have an account? <a href="/?auth=signin">Log in</a></span>
      </div>
```

- [ ] **Step 6: Rewire the closing CTA**

Replace the `.cta` block's paragraph and link (currently lines 5180-5181):

```js
      <p>Reports are free and take about a minute. Create an account and run one on your own building.</p>
      <a class="btn" href="/?auth=signup">Create a free account &rarr;</a>
```

- [ ] **Step 7: Add the three CSS rules**

In `HOW_CSS`, directly below the existing `.btn:hover` rule (currently line 4697), add:

```css
/* Header signup control. .hdr nav a already sets a colour and out-specifies
   .btn, so the white has to be restated at that specificity. */
.hdr nav a.btn,.hdr nav a.btn:hover{color:#fff}
.btn.sm{padding:7px 14px;font-size:13px}
.heroCta{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin-top:24px}
.heroCta .alt{font-size:13.5px;color:#5A6473}
```

- [ ] **Step 8: Run the tests**

Expected: all three new subtests PASS.

- [ ] **Step 9: Look at it**

Start the server and open the page:

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; node server.js
```

Open `http://localhost:3000/how-it-works` in the browser pane. Check: no red "HOW IT WORKS" label above the headline; "Log in" and a red "Create account" button in the header; the hero pair below the lead paragraph; the closing button reads "Create a free account". Resize to 375px wide and confirm the header still wraps to one clean row per group rather than overflowing.

- [ ] **Step 10: Commit**

```bash
git status --short
git add server.js test/account-wall.test.js
git commit -m "/how-it-works: signup controls in, redundant kicker out"
```

---

### Task 7: Move the `WebApplication` structured data

`/` stops being the URL Google indexes, so the product's structured data follows the content onto the page that is crawlable.

**Files:**
- Modify: `index.html` (lines 25-38)
- Modify: `server.js` (`renderHowItWorksHTML`'s `jsonLd`, line 5050-5076)

- [ ] **Step 1: Write the failing test**

Add to the `test("/how-it-works carries the signup controls", ...)` block:

```js
  await t.test("it carries the product's structured data", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    // It moved off index.html, which no crawler reaches under the wall.
    assert.match(html, /"@type":"WebApplication"/);
    assert.match(html, /"@type":"FAQPage"/, "the FAQ markup that was already here must survive");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Expected: fails on the `WebApplication` assertion; the `FAQPage` one passes.

- [ ] **Step 3: Add it to the page's `@graph`**

In `renderHowItWorksHTML()`, add a third entry to the `@graph` array, after the `FAQPage` object:

```js
      {
        "@type": "WebApplication",
        name: "CompNinja",
        url: `${SITE_URL}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Free reports of recent comparable sales and lease transactions for any commercial property, " +
          "with maps, price per square foot, and PDF export.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        provider: { "@type": "Organization", name: "CompNinja" },
      },
```

- [ ] **Step 4: Remove it from index.html**

Delete lines 25-38 of `index.html` (the `<!-- Structured data for search engines -->` comment and the whole `<script type="application/ld+json">` block that follows it). Leave the comment below it about the FAQPage living on `/how-it-works`, and extend it:

```html
  <!-- The FAQPage and WebApplication structured data live on /how-it-works.
       Under the account wall no crawler reaches this file: / 302s to that page
       for anyone without a session, so it is the one indexable description of
       the product. -->
```

- [ ] **Step 5: Run the tests**

Expected: the new subtest PASSES.

- [ ] **Step 6: Commit**

```bash
git status --short
git add server.js index.html test/account-wall.test.js
git commit -m "Move the WebApplication JSON-LD onto the page crawlers can reach"
```

---

### Task 8: Lock the search form

The front end has no test harness, so this task is verified in the browser at Task 10. Write it carefully.

**Files:**
- Modify: `index.html` (markup near line 789, `initGate` near line 2382, `refreshAccountUI` near line 6371, `showDeskView`/`showHomeView` near lines 6726-6748, the bootstrap IIFE near line 6550)

- [ ] **Step 1: Add the locked card markup**

In `index.html`, directly above `<div id="searchSection" ...>` (line 790), insert:

```html
    <!-- Account wall: the signed-out stand-in for the search form. Shown by
         applySearchLock() when /api/config reports accountWall and there is no
         session. Presentation only, like everything else driven by that
         response: GUEST_SEARCH_LIMIT is 0 under the wall, so /api/comps
         refuses an anonymous search whatever this file does. A shared report
         still renders below this card, which turns a shared link into a signup
         funnel rather than a leak. -->
    <div id="searchLock" class="hidden relative z-10 mt-4 no-print rd-exhibit p-6">
      <h2 class="rd-h text-xl">Create a free account to run a report</h2>
      <p class="text-sm text-[#4C5665] mt-2 max-w-[52ch]">Reports are free and take about a minute. An account keeps
        your searches, your portfolio and your watchlist in one place.</p>
      <div class="mt-4 flex flex-wrap items-center gap-4">
        <button id="lockSignUpBtn" type="button"
          class="btn-live bg-[#B91C1C] hover:bg-[#991B1B] text-white font-semibold px-5 py-2.5 rounded">Create a free account</button>
        <button id="lockSignInBtn" type="button"
          class="text-sm text-[#5A6473] hover:text-[#1A2433] underline">Already have an account? Log in</button>
      </div>
      <p class="text-[12.5px] text-[#8A8577] mt-4">An automated estimate, not an appraisal.</p>
    </div>
```

- [ ] **Step 2: Fix the strapline under the form**

Line 914 currently reads "First report free · Free account for more · An automated estimate, not an appraisal", which is untrue once a report requires an account. Change that `<div>`'s text to:

```html
      <div class="text-[12.5px] text-[#8A8577] mt-3">Reports are free · An automated estimate, not an appraisal</div>
```

This wording is true with the wall up or down, which matters: the element is static markup and the rollback lever must not leave a lie on the page.

- [ ] **Step 3: Declare the flag**

Directly above `let currentUser = null;` (line 6355), add:

```js
  let accountWall = false;          // from /api/config; drives applySearchLock()
```

- [ ] **Step 4: Add the lock function**

Directly above `function refreshAccountUI() {` (line 6371), add:

```js
  // One owner of the search form's existence, called from the three places
  // that change it: the config load, sign-in/out, and the desk/home swap.
  //
  // Reads deskView's class rather than calling onDesk(): that helper is a
  // `const` arrow declared hundreds of lines below, and this runs from
  // initGate() near the top of the script, which would hit its temporal dead
  // zone. (The same trap the proConfig comment warns about.)
  function applySearchLock() {
    const lock = document.getElementById("searchLock");
    if (!lock) return;
    const onDeskView = !document.getElementById("deskView").classList.contains("hidden");
    if (onDeskView) { lock.classList.add("hidden"); return; }
    const locked = accountWall && !currentUser;
    lock.classList.toggle("hidden", !locked);
    document.getElementById("searchSection").classList.toggle("hidden", locked);
  }
```

- [ ] **Step 5: Call it from `refreshAccountUI`**

As the first line of `refreshAccountUI()`'s body, after `const on = Boolean(currentUser);`:

```js
    applySearchLock();
```

- [ ] **Step 6: Call it from the view swaps**

As the last line of `showDeskView()`'s body, and again as the last line of `showHomeView()`'s body:

```js
    applySearchLock();
```

`showHomeView()` un-hides `searchSection` unconditionally, so without this a signed-out visitor leaving the desk view would get the form back.

- [ ] **Step 7: Set the flag from config**

In `initGate()`, beside the other `cfg` reads (line 2382 area), add:

```js
    accountWall = Boolean(cfg.accountWall);
```

and directly after the existing `refreshBillingUI();` call in that function:

```js
    applySearchLock();
```

- [ ] **Step 8: Wire the two buttons**

Beside the other modal wiring (line 6435, next to the `signInLink` listener), add:

```js
  document.getElementById("lockSignUpBtn").addEventListener("click", () =>
    openAcctModal("signup", "Create a free account to run a report. It's free, no card needed."));
  document.getElementById("lockSignInBtn").addEventListener("click", () => openAcctModal("signin"));
```

- [ ] **Step 9: Open the modal from `?auth=`**

In the bootstrap IIFE (line 6551), directly after the existing `#reset=` handling:

```js
    // The auth door from /how-it-works. Skipped for a signed-in visitor, who
    // followed a static link from a page that is cached for everyone.
    const authParam = new URLSearchParams(location.search).get("auth");
    if (!currentUser && (authParam === "signup" || authParam === "signin")) {
      openAcctModal(authParam, authParam === "signup"
        ? "Create a free account to run a report. It's free, no card needed."
        : "");
    }
```

- [ ] **Step 10: Commit**

```bash
git status --short
git add index.html
git commit -m "Lock the search form behind an account"
```

---

### Task 9: Regenerate the vendored Tailwind

`index.html` gained utility classes. A class missing from `tailwind.css` silently does not style, and this repo serves a vendored, pre-generated build rather than the Play CDN.

**Files:**
- Modify: `tailwind.css`

- [ ] **Step 1: Check whether the hook already did it**

A Claude Code hook (`.claude/hooks/regen-tailwind.js`) regenerates the file when `index.html` is edited in a session. Do not also run it manually first.

```bash
git status --short tailwind.css
```

If it is modified, skip to Step 3.

- [ ] **Step 2: Regenerate manually (only if Step 1 showed nothing)**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
```

- [ ] **Step 3: Verify a new class actually landed**

```bash
grep -c "max-w-\[52ch\]" tailwind.css
```

Expected: at least 1. If it is 0, the regeneration did not pick up the new markup; do not proceed until it does.

- [ ] **Step 4: Commit**

```bash
git status --short
git add tailwind.css
git commit -m "Regenerate tailwind.css for the account-wall card"
```

---

### Task 10: Verify the whole flow in a browser

Nothing above proves the front end works. Do this before claiming the feature is done.

- [ ] **Step 1: Start the server**

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; node server.js
```

Confirm the banner shows `🔐 Account wall ON`.

- [ ] **Step 2: Walk the anonymous path**

In a fresh browser context with no cookies, visit `http://localhost:3000/`.

Expected, in order:
1. You land on `/how-it-works`, not the app.
2. The header shows "Log in" and a red "Create account".
3. There is no red "HOW IT WORKS" label above the headline.
4. Clicking "Create account" takes you to `/?auth=signup` and the account modal is open over a page whose search form is replaced by the "Create a free account to run a report" card.
5. Dismissing the modal leaves that card, not a dead page and not a usable form.

- [ ] **Step 3: Confirm the gate is real, not decorative**

This one request is the only step in the plan that can cost money. Your local
`.env` has a real `ANTHROPIC_API_KEY`, so if the gate is broken this POST runs
a real billed search (measured ~$0.36). That is the point: it is the cheapest
possible proof that the wall is enforced rather than drawn. Expect the 403.

With the modal dismissed, open the browser console and run:

```js
await (await fetch("/api/comps", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({address:"123 Main St, Boise, ID",type:"Industrial"})})).json()
```

Expected: `{ error: "...", signin_required: true }`. This is the assertion that matters. Everything else on the page is presentation.

- [ ] **Step 4: Walk the signed-in path**

Create an account through the modal. Expected: the modal closes, the locked card is replaced by the real search form, and the header shows the account avatar rather than "Sign in".

- [ ] **Step 5: Check the desk swap**

Click "My Desk", then navigate back home. Expected: the locked card does not appear on the desk view, and the search form is still there when you return (you are signed in).

- [ ] **Step 6: Check the rollback lever**

Stop the server and restart it with the wall off:

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
$env:ACCOUNT_WALL = "off"
node server.js
```

Visit `http://localhost:3000/` in a fresh context. Expected: the app loads directly with a working search form, the banner reads `🔓 Account wall off`, and `/sitemap.xml` lists `/` again. Then unset it: `Remove-Item Env:ACCOUNT_WALL`.

---

### Task 11: Documentation and changelog

**Files:**
- Modify: `devlog.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the devlog entry**

`devlog.json` is a guaranteed collision point in this shared checkout: the standing rule makes every session append one. Do not patch the working file. Rebuild the staged version from `HEAD`:

```bash
git show HEAD:devlog.json > /tmp/devlog-base.json
```

Add exactly this entry to `/tmp/devlog-base.json` (file order does not matter; the page groups by date):

```json
  {
    "date": "2026-08-05",
    "type": "feature",
    "title": "CompNinja is account-only; How it works is the front door",
    "details": "An anonymous visitor now lands on /how-it-works, which gained Log in and Create account controls, and the search form is locked until they have a free account. One lever runs it: ACCOUNT_WALL (default on) forces GUEST_SEARCH_LIMIT to 0 so the wall and the API gate can never disagree, and ACCOUNT_WALL=off reverses the whole thing in an env edit with no deploy. Shared report links stay public. The WebApplication structured data moved onto /how-it-works, which is now the page crawlers reach."
  }
```

Write em dashes, curly quotes and arrows raw as UTF-8 if you use any. Never ASCII-escape them, and never write this file from PowerShell without `-Encoding utf8`: CI fails the build on the double-encoding pattern that produces.

Then stage that version and restore your working file:

```bash
cp devlog.json /tmp/devlog-mine.json
cp /tmp/devlog-base.json devlog.json
git add devlog.json
cp /tmp/devlog-mine.json devlog.json
git show :devlog.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('valid JSON, '+JSON.parse(s).length+' entries')})"
```

Expected: `valid JSON, N entries`. If another session's entry is missing from your staged copy but present in the working file, that is correct and expected: they will commit theirs.

- [ ] **Step 2: Document the env var**

In `CLAUDE.md`, in the "Configuration (environment / `.env`)" list, insert an entry directly above the `GUEST_SEARCH_LIMIT` bullet:

```markdown
- `ACCOUNT_WALL` — optional `on`/`off`, **default ON** (live since 2026-08-05).
  Makes the app account-only: `GET /` and `/desk` 302 to `/how-it-works` for a
  visitor with no `cn_session` cookie, and `index.html` swaps the search form
  for a signup card. It decides on cookie **presence**, never
  `getSessionUser()`, because that reads the database and this route runs on
  every page load; the real gate is that the wall **forces
  `GUEST_SEARCH_LIMIT` to 0**, so `/api/comps` refuses an anonymous search
  whatever the browser does. The two settings are deliberately not allowed to
  disagree. Two exemptions: `/r/<id>` (shared reports are public by design)
  and `/?auth=signup|signin` (the account modal lives only in `index.html`, so
  the signup buttons on `/how-it-works` need a door that is not a redirect
  loop). While it is on, `sitemap.xml` drops `/` and the `WebApplication`
  JSON-LD lives on `/how-it-works` instead of `index.html`. `off` is the
  instant rollback lever and restores the pre-wall app exactly, including
  `GUEST_SEARCH_LIMIT`'s own configured value. Spec in
  `docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md`.
```

Also amend the `GUEST_SEARCH_LIMIT` bullet's first line to note it is overridden: add ", forced to 0 while `ACCOUNT_WALL` is on" after "(default 1, LIVE since 2026-08-03)".

- [ ] **Step 3: Run the full suite one last time**

```bash
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path; npm test
```

Expected: every test passes except the two pre-existing `market explorer` failures. Report the actual counts; do not claim green if it is not green.

- [ ] **Step 4: Commit**

```bash
git status --short
git add CLAUDE.md
git commit -m "Document ACCOUNT_WALL"
```

(`devlog.json` was staged in Step 1; commit it in the same commit if it is still staged, or separately if the shared index forced you to wait.)

---

## Deferred, deliberately

- **`test/routes.test.js` still has its own copy of `boot()`.** Once that file's working tree is clean (`git status --short test/routes.test.js` shows nothing), it should `require("./helpers/boot")` and drop the duplicate. Doing it now would mean editing 30 contended lines in a file another session is mid-change on.
- **The Market Explorer's guest hole.** `POST /api/explore-market` still runs a billed search with no account check. It has its own approved spec and plan (`docs/superpowers/plans/2026-08-05-explorer-guest-gate-and-progress.md`) and another session is on it. After this wall ships, that endpoint is the last anonymous way to spend money on this deployment.
- **`#guestSearchHint`** ("You've used your free search") is dead markup while the wall is up, since a signed-out visitor never sees the form it sits under. Left in place because `ACCOUNT_WALL=off` brings it straight back.

## Rollout

1. Merge and deploy to Render. The wall is live on arrival: `ACCOUNT_WALL` defaults to on and needs no env change.
2. Verify on the live URL without a query string, in a signed-out browser: `https://compninja.co/` must land on `/how-it-works`.
3. Watch `signup_gate` events and search volume on `/admin` over the following days.
4. If the trade lands badly, set `ACCOUNT_WALL=off` in the Render dashboard. No redeploy and no code change; the sitemap and the guest cap both return to their previous behaviour on restart.

---

## Outcome (executed 2026-08-05)

All eleven tasks shipped on `dev-hub`, pushed at `c8c5f29`. Suite went 217 → 238 tests, all passing. CI run #113 green on the tip. **Not merged to `main`**, so the wall is not live: the branch also carries a concurrent session's Market Explorer work, whose own plan records it as "part 1 shipped, part 2 paused," and that is the owner's call to ship.

Commits: `ef42691`, `90f8d7d`, `39d7540`, `989919a`, `bd0c3ed`, `30ad913`, `b39cc02`, `4071525`, `4a0b18b`, `e242427`, `081d337`, `c8c5f29`.

### What this plan got wrong

Worth reading before trusting a future plan of mine in this repo.

1. **It never considered CI.** `.github/workflows/ci.yml` boots a bare server and runs `curl -sf / | grep -qi compninja`. Under the wall `/` is a 302 with an empty body, and `curl -sf` without `-L` prints nothing while still exiting 0 on a 3xx, so the step failed reading "home page did not render". CI runs **#104 and #105 went red during execution** for exactly this. Caught only by the final whole-feature review, because every task-level review looked at the diff and the test suite and neither reaches outside the repo's runtime. Fixed in `c8c5f29`, which now asserts the redirect, the front door rendering, and the app rendering with a session cookie.
2. **Task 6's CTA assertion could never fail.** `/href="\/"[^>]*class="btn"/` does not match `<a class="btn" href="/">` — the real markup puts `class` first. Replaced with a check on `class="btn"\s+href="\/"` plus the old copy string.
3. **Task 9's Tailwind check gives a false negative.** `grep -c "max-w-\[52ch\]"` returns 0 because compiled Tailwind escapes the brackets (`.max-w-\[52ch\]`), and the pattern's `\[` is consumed as regex escaping. The class was present the whole time. Use a fixed-string search or verify a computed style instead.

### Still open

- **`test/routes.test.js` keeps its own copy of `boot()`.** The deferral condition (that file's tree being clean) is now met, so the dedupe is unblocked. Lower value than when written: the port ranges are 39140 and 39500 apart after a review fix, so the collision risk that motivated it is already gone. Tidiness only.
- **The Market Explorer widget is not covered by `applySearchLock()`.** A walled-out visitor who reaches `index.html` via `?auth=` and dismisses the modal sees a locked search form beside a live-looking Explorer input. `/api/explore-market` refuses them server-side and the client reopens the account modal, so it funnels rather than leaks, but the two surfaces disagree visually.
- **The search form flashes before `/api/config` resolves**, then swaps to the signup card. Fixing it properly means server-rendering the initial locked state.
- **The Explorer's own guest gate** was built by the concurrent session during this work, closing the spend hole this plan listed as a non-goal.
