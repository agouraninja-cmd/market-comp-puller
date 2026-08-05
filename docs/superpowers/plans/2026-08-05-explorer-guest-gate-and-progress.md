# Market Explorer: Guest Gate + Live Build Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `POST /api/explore-market` to parity with `/api/comps` on two axes it silently diverged from: it must spend an anonymous visitor's single free search allowance rather than bypassing it, and it must stream live progress during the 30 to 60 second build instead of showing a frozen line.

**Architecture:** Server side, reuse the existing `guestGateFor()` resolver rather than re-deriving the checks, placed below the covered-market short circuit so browsing stays free; and open the SSE lazily on the first progress event so a cache hit stays plain JSON without restructuring the shared in-flight job. Client side, refactor `readProgressStream` to take a progress applier so one SSE frame parser serves both the report loading card and a new compact applier that renders into the Explorer dropdown.

**Tech Stack:** Plain Node (no dependencies, no build step), `node --test`, vanilla browser JS in a single `index.html`, Tailwind vendored as a pre-generated `tailwind.css`.

**Spec:** `docs/superpowers/specs/2026-08-05-explorer-guest-gate-and-progress-design.md`

---

## STATUS as of 2026-08-05: part 1 shipped, part 2 paused

Tasks 1 through 6 are done and committed. `npm test` is green at 222.

**Tasks 7 and 8 are DEFERRED**, not abandoned. A second Claude session shares
this checkout and had uncommitted `server.js` work in flight (a timeout /
idle-watchdog split in `callAnthropicOnce`) at the moment Task 7 needed to edit
and commit `server.js`. `git add server.js` stages the whole file, so
committing the streaming work would have swept their half-finished change into
it. The owner's call was to ship the guest gate on its own and resume streaming
when the branch is quiet.

Three things to know when you pick this back up:

- **The client half of streaming is already shipped and dormant** (commit
  `e0310fe`): `readProgressStream` takes an applier, `applyExploreProgress`
  and the dropdown progress markup exist, and `explore()` already sends
  `stream: true` and branches on the response content-type. The server simply
  never answers `text/event-stream` yet, so the JSON branch is always taken.
  Task 7 is therefore server-only now. Do not redo Tasks 4-6.
- **Two extra tasks were inserted** and are done: Task 1b fixed `server.js`'s
  `.env` loader, which was refilling deliberately-cleared env vars and had let
  `test/routes.test.js` bill two real Anthropic searches; and the rollback test
  was adapted to `ACCOUNT_WALL`.
- **`ACCOUNT_WALL` landed on this branch from the other session** (`ef42691`,
  default ON) and forces the guest limit to 0 regardless of
  `GUEST_SEARCH_LIMIT`, making `ACCOUNT_WALL` the outer rollback lever. Task 9's
  CLAUDE.md edit must not contradict whatever that session documents.

---

## Before you start

Read `CLAUDE.md`. Three rules govern almost every step below:

1. **Editing `server.js` requires restarting the process.** It is loaded once at startup. Editing `index.html` does not: `server.js` reads it from disk per request.
2. **Node is a portable copy on this machine.** If `node` is not on PATH, prefix commands with:
   ```powershell
   $env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
   ```
3. **A second Claude session may share this checkout.** Always `git add` explicit paths, never `git add -A` or `git add .`, and read `git status --porcelain` before every commit.

Baseline check before touching anything:

```bash
npm test
```

Expected: all tests pass (212 as of 2026-08-05; trust the summary over the number).

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `server.js` | Modify | The guest gate, the shared consumption helper, the fan-out in-flight job, lazy SSE |
| `index.html` | Modify | `readProgressStream` refactor, the Explorer's `signin_required` branch, the dropdown progress applier and markup |
| `test/routes.test.js` | Modify | Three new route-wiring tests proving the gate is wired, and that the covered-market short circuit still sits above it |
| `tailwind.css` | Regenerate | Any genuinely new utility class used by the progress markup |
| `devlog.json` | Modify | One `fix` entry, one `improvement` entry (standing rule) |
| `CLAUDE.md` | Modify | The guest-cap section and the live-progress section both name only `/api/comps` today |

No new files. `server.js` and `index.html` are already very large, but this repo's established pattern is a single server file and a single front-end file; splitting either is out of scope and would swamp the change.

---

## Task 1: Prove the gate is missing

TDD red step. These tests boot a real server as a child process, which is the entire point of `test/routes.test.js`: the rules can be right while the wiring is wrong, and here the wiring is the bug.

Cost is zero. The bare environment has no `ANTHROPIC_API_KEY`, so a request that gets *past* the gate stops at the missing-key check and answers 500 without calling anything external. That distinct 500 is what proves the gate was passed.

**Files:**
- Modify: `test/routes.test.js` (append at end of file, after the "admin gating" block ending at line 187)

- [ ] **Step 1: Write the failing tests**

Append to `test/routes.test.js`:

```js
// --- The Market Explorer spends the same free search as a report ------------
//
// /api/explore-market runs the same billed getComps() pipeline as /api/comps.
// It carried no guest-cap check at all until 2026-08-05, so an anonymous
// visitor who had spent their free report could keep triggering billed
// searches from the homepage. These prove the gate is WIRED to the route, and
// that it did not swallow the free covered-market path on its way in.
//
// No Anthropic call is possible here: the bare environment has no API key, so
// a request that clears the gate stops at the missing-key 500. That distinct
// status is exactly how "got past the gate" is observed.
test("market explorer guest cap", async (t) => {
  // limit 0 = every anonymous visitor is blocked before any search, which
  // makes the gate observable without having to spend a quota first.
  const { base, stop } = await boot({ GUEST_SEARCH_LIMIT: "0" });
  t.after(stop);

  const explore = (body) => fetch(base + "/api/explore-market", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  await t.test("an anonymous visitor cannot bill a new market search", async () => {
    const r = await explore({ type: "Industrial", city: "Nampa", state: "ID" });
    assert.equal(r.status, 403);
    const j = await r.json();
    // The client keys off this flag, never off the status code — it decides
    // account modal vs red error row.
    assert.equal(j.signin_required, true);
  });

  await t.test("browsing a market page that already exists stays free", async () => {
    // industrial-ontario-ca is the first entry in the committed market-seed.json.
    // The covered-market short circuit must stay ABOVE the gate: it is a DB
    // read, it costs nothing upstream, and gating it would wall off the SEO
    // surface and every crawler.
    const r = await explore({ type: "Industrial", city: "Ontario", state: "CA" });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.url, "/market/industrial-ontario-ca");
    assert.equal(j.existing, true);
  });
});

test("market explorer with the guest gate disabled", async (t) => {
  const { base, stop } = await boot({ GUEST_SEARCH_LIMIT: "off" });
  t.after(stop);

  await t.test("the rollback lever really disables the gate", async () => {
    const r = await fetch(base + "/api/explore-market", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "Industrial", city: "Nampa", state: "ID" }),
    });
    // Past the gate, stopped by the absent API key — never 403.
    assert.equal(r.status, 500);
    const j = await r.json();
    assert.match(j.error, /ANTHROPIC_API_KEY/);
  });
});
```

- [ ] **Step 2: Run the tests to verify the first one fails**

```bash
npm test
```

Expected: `an anonymous visitor cannot bill a new market search` FAILS with `Expected values to be strictly equal: 500 !== 403` (the request sails past the absent gate and dies on the missing key). The other two tests PASS already; they are regression guards for behavior that must survive the change.

- [ ] **Step 3: Commit the red tests**

```bash
git add test/routes.test.js
git commit -m "Test: the Market Explorer must spend the guest search allowance

/api/explore-market runs the same billed pipeline as /api/comps but has
never carried a guest-cap check, so an anonymous visitor who spent their
free report can keep triggering billed searches from the homepage. Red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Extract the shared consumption helper

`/api/comps` defines `consumeGuestSearch` as a local closure at `server.js:8037`. The Explorer needs identical behavior. Copying it would create a third hand-synchronized duplicate pair in a codebase that already carries two (`compWeight`, `exportReportKey`), each with a warning comment about the cost. Extract it once instead.

**Files:**
- Modify: `server.js` (add helper after `guestGateFor`, which ends at line 538; then change `/api/comps` at 8036-8043)

- [ ] **Step 1: Add the helper next to `guestGateFor`**

In `server.js`, immediately after the closing brace of `guestGateFor` (line 538), add. Note the name is `consumeGuestSearchFor`, deliberately not `consumeGuestSearch`: the `/api/comps` handler keeps a local binding under the shorter name so its four existing call sites stay byte-identical, and two things called `consumeGuestSearch` in one file would shadow confusingly.

```js
// Spend one guest search. Call ONLY at an exit that actually served a result:
// a failed or refused search must never burn the visitor's free one.
// `headersOpen` is true on an SSE exit, where the headers are already
// streaming and no cookie can be set — /api/config syncs it on the next page
// load, and the sha256(IP) ledger is the durable half regardless.
function consumeGuestSearchFor(gate, req, res, headersOpen) {
  if (!gate) return;
  const used = gate.used + 1;
  recordGuestSearch(gate.ipHash, used);
  if (!headersOpen && used >= GUEST_SEARCH_LIMIT) setGuestCookie(res, req);
}
```

- [ ] **Step 2: Point `/api/comps` at it**

In `server.js`, replace the local closure at lines 8036-8043:

```js
        // Runs on every serve exit below. The cookie is set only once the
        // quota is now spent, and never on the SSE exit — those headers are
        // already streaming, so /api/config sets it on the next page load.
        const consumeGuestSearch = (headersOpen) => {
          if (!guestGate) return;
          const used = guestGate.used + 1;
          recordGuestSearch(guestGate.ipHash, used);
          if (!headersOpen && used >= GUEST_SEARCH_LIMIT) setGuestCookie(res, req);
        };
```

with a call-through binding, so the four existing call sites in this handler stay byte-identical:

```js
        // Runs on every serve exit below (see consumeGuestSearch — shared with
        // the Market Explorer, which spends the same single allowance).
        const consumeGuestSearch = (headersOpen) =>
          consumeGuestSearchFor(guestGate, req, res, headersOpen);
```

The four call sites below it (`consumeGuestSearch(false)` at the cache hit, `consumeGuestSearch(false)` at the derived-window hit, and `consumeGuestSearch(Boolean(sse))` at the billed exit) are untouched.

- [ ] **Step 3: Verify nothing changed**

```bash
node --check server.js
npm test
```

Expected: `node --check` silent, `npm test` unchanged from the baseline (the one Explorer test still red, everything else green). This step is a pure refactor and must not move any test.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Lift consumeGuestSearch out of the /api/comps handler

The Market Explorer needs the same spend-one-guest-search behavior, and
this repo already carries two hand-synced duplicate pairs that each needed
a warning comment. One helper, two callers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Gate the Explorer

**Files:**
- Modify: `server.js:8185-8199` (between the covered-market short circuit and the per-IP limiter), plus the job-resolution exit at 8243-8245

- [ ] **Step 1: Insert the gate below the short circuit**

In `server.js`, find the covered-market short circuit and the limiter that follows it:

```js
        if (getMarketPage(slug)) {
          return sendJson(res, 200, { url: `/market/${slug}`, slug, published: true, existing: true });
        }

        if (rateLimited("explore:" + clientIp(req), 3, 15 * 60 * 1000)) {
```

Insert between them:

```js
        if (getMarketPage(slug)) {
          return sendJson(res, 200, { url: `/market/${slug}`, slug, published: true, existing: true });
        }

        // Guest search cap. This route runs the SAME billed getComps() pipeline
        // as /api/comps, so it spends the SAME single free search — one free
        // billed search per anonymous visitor, report or market page, then a
        // free account. Until 2026-08-05 it had no check at all, which made the
        // homepage's own Explorer the easiest way around the homepage's signup
        // gate.
        //
        // Deliberately BELOW the covered-market short circuit above: serving a
        // page that already exists is a database read, costs nothing upstream,
        // and must stay free for everyone including crawlers.
        //
        // guestGateFor() is the single resolver — it already returns null for a
        // disabled gate, any signed-in account, and an admin by header or
        // cookie, so none of those need re-deriving here.
        const guestGate = await guestGateFor(req);
        if (guestGate && guestGate.blocked) {
          logEvent("signup_gate", { prop_type: typeOk, market: `${cityOk}, ${stateOk}`, source: "explore" });
          if (!guestGate.cookieSpent) setGuestCookie(res, req);
          return sendJson(res, 403, {
            error: "You've used your free search. Create a free account to explore any market. It's free, no card needed.",
            signin_required: true,
          });
        }

        if (rateLimited("explore:" + clientIp(req), 3, 15 * 60 * 1000)) {
```

Note `market: \`${cityOk}, ${stateOk}\`` is already the canonical "Title-case City, UPPER ST" shape `marketOf()` produces, because `cityOk` was title-cased and `stateOk` uppercased during validation above. It stays PII-free: city and state only, exactly like every other analytics event.

- [ ] **Step 2: Consume only on a served result**

In `server.js`, replace the job-resolution exit:

```js
        const { status, body: out } = await job;
        return sendJson(res, status, out);
```

with:

```js
        const { status, body: out } = await job;
        // Spent only when a result was actually served — a published page or a
        // thin-data preview, both of which cost a real search and return real
        // content. A 422 thin market, a 429 daily cap or an upstream failure
        // must never burn the visitor's free search.
        if (status === 200) consumeGuestSearchFor(guestGate, req, res, false);
        return sendJson(res, status, out);
```

Two visitors sharing one in-flight job each spend their own quota correctly, and this needs no special handling: the gate is read per request before the join, and this line runs per request in its own scope.

- [ ] **Step 3: Run the tests**

```bash
node --check server.js
npm test
```

Expected: all three Task 1 tests PASS, and the rest of the suite is unchanged. If `browsing a market page that already exists stays free` went red, the gate was inserted above the short circuit instead of below it.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Fix: the Market Explorer bypassed the guest search cap

/api/explore-market runs the same billed pipeline as /api/comps at roughly
the same cost per search, but carried no guest check, so an anonymous
visitor who had spent their free report could keep triggering billed
searches three per fifteen minutes, indefinitely. It was also the most
discoverable way around the signup gate on the very page it sits on.

An Explorer build now spends the same single allowance a report does.
Browsing a market page that already exists stays free and ungated: it is a
DB read, and gating it would wall off the SEO surface. Spent only on a
served result, so a thin market or an upstream failure costs nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Client — handle `signin_required` in the Explorer

The report path already does this at `index.html:9613`: a 403 carrying the flag is an ask, not an error, so it opens the account modal instead of the red row.

**Files:**
- Modify: `index.html:7136-7160` (the `explore` function)

- [ ] **Step 1: Rewrite `explore` as an async function with the branch**

In `index.html`, replace the whole `const explore = ({ type, city, state }) => { ... };` function (starting line 7136, ending at the `.catch(...)` close on line 7160) with:

```js
    // Re-shown on every failure, so the visitor always has a worked example.
    const exploreHintRow =
      `<div class="px-3 py-1.5 text-[#8A93A0]">Adjust the search and try again, e.g. “industrial Boise ID”</div>`;
    const exploreFail = (msg) => {
      exploring = false;
      input.readOnly = false;
      resultsEl.removeAttribute("aria-busy");
      resultsEl.innerHTML =
        `<div class="fade-in px-3 py-1.5 text-[#B91C1C]">${escq(msg)}</div>` + exploreHintRow;
    };
    const explore = async ({ type, city, state }) => {
      exploring = false; // allow the swap below, then lock
      resultsEl.innerHTML = exploreProgressHtml(type, city, state);
      resultsEl.classList.remove("hidden");
      resultsEl.setAttribute("aria-busy", "true");
      exploring = true;
      // readOnly, not disabled: a disabled element loses focus mid-flow and
      // drops the screen reader's place. This keeps both while still refusing
      // edits that the `exploring` guard would silently swallow anyway.
      input.readOnly = true;
      try {
        const res = await fetch("/api/explore-market", {
          method: "POST",
          headers: { "content-type": "application/json", "x-app-password": getStoredPassword() },
          body: JSON.stringify({ type, city, state, stream: true }),
        });
        if (!res.ok) {
          let payload = null;
          try { payload = await res.json(); } catch (_) {}
          // The guest cap answers signin_required — an ask, not an error, so it
          // gets the account modal rather than the red row (same as /api/comps).
          if (payload && payload.signin_required) {
            exploring = false;
            input.readOnly = false;
            guestSearch = guestSearch || { limit: 1, used: 1 };
            guestSearch.used = guestSearch.limit;
            renderGuestSearchHint();
            hide();
            openAcctModal("signup",
              "You've used your free search. Create a free account to explore any market. It's free, no card needed.");
            return;
          }
          throw new Error((payload && payload.error) || `Request failed (${res.status}).`);
        }
        // Read the body off the response's content-type, NEVER off the fact we
        // asked to stream: a cache hit answers as plain JSON on purpose.
        const ct = res.headers.get("content-type") || "";
        const data = ct.includes("text/event-stream") && res.body && res.body.getReader
          ? await readProgressStream(res, { sawProgress: false, lastAt: Date.now() }, applyExploreProgress,
              "The connection dropped before the market page finished. Please try again.")
          : await res.json();
        if (data && data.url) { window.location.href = data.url; return; }
        throw new Error("Something went wrong. Please try again.");
      } catch (err) {
        console.error(err);
        // A dropped connection surfaces as a TypeError from fetch, whose
        // message ("Failed to fetch") is browser jargon — keep the old copy.
        exploreFail(err instanceof TypeError
          ? "Connection lost. Please try again."
          : (err.message || "Something went wrong. Please try again."));
      }
    };
```

This references `exploreProgressHtml` and `applyExploreProgress`, both added in Task 6, and the fourth argument to `readProgressStream`, added in Task 5. The code will not run correctly until those land; that is why this task's verification is `node --check` only and the browser check comes at the end of Task 6.

Scope note: this IIFE (opening at `index.html:7100`) sits at the same nesting level as `openAcctModal` (6419), `readProgressStream` (2738) and `guestSearch` (9064), so all of them resolve. `guestSearch` is a `let` declared *after* this IIFE runs, but `explore` is only ever called from a click handler long after page load, so it is never touched in its temporal dead zone. This is the same trap CLAUDE.md documents for `proConfig` in the Address Explorer.

- [ ] **Step 2: Confirm the old fetch chain is fully gone**

```bash
grep -n "input.disabled" index.html
```

Expected: no match anywhere in the file. `input.disabled` appeared only in the Explorer's old `explore()`, so a surviving match means the replacement did not cover the whole old function.

- [ ] **Step 3: Syntax-check the page's script**

`node --check` cannot read HTML. Extract the inline script and check that instead:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('index.html','utf8');const m=[...s.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(x=>!/\ssrc=/.test(x[1])&&!/\stype=/.test(x[1]));let n=0;for(const x of m){try{new Function(x[2]);n++}catch(e){console.error('script block '+(n+1)+' failed: '+e.message);process.exit(1)}}console.log(n+' inline script block(s) parse')"
```

Expected: `1 inline script block(s) parse`, no error. Verified against the unmodified file on 2026-08-05, so a failure here is your edit, not the harness. This catches a mismatched brace from the replacement, which is the realistic failure. The filter skips `src=` (the html2canvas CDN tag) and `type=` (the JSON-LD blocks, which are not JavaScript and will not parse as it).

- [ ] **Step 4: Do not commit yet**

This task leaves `index.html` referencing two functions that do not exist yet. Commit it together with Task 6.

---

## Task 5: Client — refactor `readProgressStream` to take an applier

One SSE frame parser, two appliers. Both new parameters are defaulted, so the existing call site at `index.html:9638` needs no change at all.

**Files:**
- Modify: `index.html:2738-2774`

- [ ] **Step 1: Change the signature and the two report-specific lines**

In `index.html`, change line 2738 from:

```js
  async function readProgressStream(res, ctx) {
```

to:

```js
  // Parses the SSE frames from a streaming endpoint and returns the final
  // `result` payload. Both optional arguments are defaulted to the report
  // path's behavior, so /api/comps' call site is untouched; the Market
  // Explorer passes its own compact applier and its own drop message. One
  // parser, two callers — a second copy would be a third hand-synced pair in
  // a file that already carries two.
  async function readProgressStream(res, ctx, onProgress = applyProgress,
    dropMessage = "The connection dropped before the report finished. Please try again.") {
```

Then change the progress dispatch at line 2762 from:

```js
          applyProgress(payload, ctx);
```

to:

```js
          onProgress(payload, ctx);
```

And the terminal throw at line 2772 from:

```js
    if (!result) throw new Error("The connection dropped before the report finished. Please try again.");
```

to:

```js
    if (!result) throw new Error(dropMessage);
```

Leave `stopFakeProgress()` on line 2760 exactly where it is. It is `clearInterval(loadingMsgTimer); loadingMsgTimer = null;` (line 2666), which is a harmless no-op when no report simulation is running, and the Explorer never starts one.

- [ ] **Step 2: Confirm the report call site was not disturbed**

```bash
grep -n "readProgressStream(res, ctx)" index.html
```

Expected: exactly one match, at roughly line 9638. The report path must still call it with two arguments and get the old behavior by default.

- [ ] **Step 3: Do not commit yet**

Commit with Task 6.

---

## Task 6: Client — the dropdown progress applier and markup

**Files:**
- Modify: `index.html` (add inside the Explorer IIFE, after the `hide` definition at line 7120 and before `parseExploreQuery` at 7122)

- [ ] **Step 1: Add the markup builder, the counter and the applier**

In `index.html`, inside the Explorer IIFE, immediately after:

```js
    const hide = () => {
      if (exploring) return; // generation in progress — keep the status row up
      resultsEl.classList.add("hidden");
      resultsEl.innerHTML = "";
    };
```

add:

```js
    // Live build progress, rendered into the dropdown itself rather than the
    // report loading card: this is a small surface and the owner's standing
    // preference is against busy UI. A headline, one detail line, a hairline
    // bar. No per-comp rows.
    const exploreProgressHtml = (type, city, state) =>
      `<div class="fade-in px-3 py-2">` +
      `<div id="exploreProgHead" class="text-[#46536A]">Building the ${escq(type)} · ${escq(city)}, ${escq(state)} snapshot…</div>` +
      `<div id="exploreProgDetail" class="mt-0.5 truncate text-[12.5px] text-[#8A93A0]">Usually 30–60 seconds.</div>` +
      `<div class="mt-2 h-0.5 overflow-hidden rounded bg-slate-200">` +
      `<div id="exploreProgBar" class="h-full bg-[#B91C1C] transition-all duration-700" style="width:6%"></div></div>` +
      `</div>`;
    // The Explorer asks for 8 comps over 24 months, a shorter payload than the
    // report path's 12, so the bar is scaled to its own draft size.
    const EXPLORE_DRAFT_CHARS = 7500;
    let exploreComps = 0;
    const applyExploreProgress = (evt) => {
      if (!evt || !evt.phase) return;
      const head = document.getElementById("exploreProgHead");
      const detail = document.getElementById("exploreProgDetail");
      const bar = document.getElementById("exploreProgBar");
      if (!head || !detail) return;   // dropdown was replaced mid-stream
      const aim = (pct) => { if (bar) bar.style.width = Math.max(6, Math.min(97, pct)) + "%"; };
      if (evt.phase === "start") {
        head.textContent = "Searching recent sales…";
        aim(12);
      } else if (evt.phase === "search") {
        head.textContent = "Searching recent sales…";
        // Model-written text: textContent only, never innerHTML.
        detail.textContent = String(evt.query || "").replace(/\s+/g, " ").trim().slice(0, 70) || `search ${evt.n}`;
        aim(20 + evt.n * 5);
      } else if (evt.phase === "results") {
        if (evt.count) detail.textContent = `${evt.count} results to review`;
        aim(48);
      } else if (evt.phase === "writing") {
        head.textContent = "Building the page…";
        detail.textContent = "Reading sale prices and sizes";
        aim(55);
      } else if (evt.phase === "drafting") {
        aim(50 + Math.min(45, (evt.chars / EXPLORE_DRAFT_CHARS) * 45));
      } else if (evt.phase === "comp") {
        exploreComps++;
        detail.textContent = `${exploreComps} recent sale${exploreComps === 1 ? "" : "s"} found`;
      } else if (evt.phase === "retry") {
        head.textContent = "The results came back oddly, rechecking…";
        detail.textContent = "";
        exploreComps = 0;   // attempt 2 finds its own comps
      }
    };
```

- [ ] **Step 2: Reset the counter when a build starts**

In the `explore` function added in Task 4, add the counter reset immediately after the `exploring = false; // allow the swap below, then lock` line:

```js
    const explore = async ({ type, city, state }) => {
      exploring = false; // allow the swap below, then lock
      exploreComps = 0;
      resultsEl.innerHTML = exploreProgressHtml(type, city, state);
```

- [ ] **Step 3: Let the Tailwind hook regenerate, then verify the new classes landed**

The session hook regenerates `tailwind.css` when `index.html` is edited. Do not run the generator manually inside a session. Confirm the classes the new markup needs are actually present in the vendored build:

```bash
grep -c "truncate\|duration-700\|bg-slate-200" tailwind.css
```

Expected: a non-zero count. Then check the two most likely to be genuinely new:

```bash
grep -o "\.h-0\\\\.5" tailwind.css; grep -o "\.duration-700" tailwind.css
```

Expected: both print a match. If either is missing, the hook did not run; regenerate manually from the project root:

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
```

- [ ] **Step 4: Commit the client half**

```bash
git status --porcelain
git add index.html tailwind.css
git commit -m "Market Explorer: account modal on the cap, groundwork for live progress

Handles the new signin_required 403 the way the report path does: it is an
ask, not an error, so it opens the account modal rather than the red row.

readProgressStream grows an optional applier and drop message, both
defaulted, so /api/comps' call site is untouched and the Explorer can
render into its own dropdown instead of the report loading card. One SSE
parser, two appliers.

The input is readOnly rather than disabled during a build: disabling moves
focus off the element mid-flow and drops the screen reader's place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Server — stream the build

This is the only structurally interesting change. `exploreInFlight` currently maps a slug to a bare promise, so a shared job has nowhere to send progress. It becomes a record carrying the promise, a listener set, and a bounded replay log.

**Files:**
- Modify: `server.js:2244-2245` (the map declaration)
- Modify: `server.js:8167` and `8201-8248` (the handler and the job)

- [ ] **Step 1: Widen the in-flight record**

In `server.js`, replace lines 2244-2245:

```js
// Two visitors exploring the same market at once should bill one search, not two.
const exploreInFlight = new Map(); // slug -> Promise<{status, body}>
```

with:

```js
// Two visitors exploring the same market at once should bill one search, not
// two — and both should still SEE it happen. The record carries the shared
// promise, the live listener set, and a bounded replay log so a visitor who
// joins mid-build gets a coherent stream instead of starting halfway through.
const exploreInFlight = new Map(); // slug -> { promise, listeners:Set<fn>, log:[] }
const EXPLORE_LOG_MAX = 300;       // a full build emits well under this; the cap is a runaway guard

// Create the job for `slug`, or join the one already running. `start(emit)`
// must return the job's promise; every event it passes to `emit` is logged and
// fanned out to whoever is listening at that moment.
function joinExploreJob(slug, start) {
  let job = exploreInFlight.get(slug);
  if (job) return job;
  job = { listeners: new Set(), log: [] };
  const emit = (evt) => {
    if (job.log.length < EXPLORE_LOG_MAX) job.log.push(evt);
    for (const fn of job.listeners) {
      try { fn(evt); } catch (_) { /* one dead listener must not stop the others */ }
    }
  };
  job.promise = start(emit).finally(() => exploreInFlight.delete(slug));
  exploreInFlight.set(slug, job);
  return job;
}
```

- [ ] **Step 2: Declare `sse` and read the stream flag**

In `server.js`, the handler opens at line 8167 with `req.on("end", async () => {` followed by `try {`. Mirror `/api/comps` (which declares its `sse` at line 7909, outside the `try`, precisely so the `catch` can see it). Change:

```js
    req.on("end", async () => {
      try {
```

to:

```js
    req.on("end", async () => {
      // Declared outside the try so the catch below can tell whether headers
      // are already streaming — once they are, there is no status code left.
      let sse = null;
      try {
```

Then, just after `const parsed = JSON.parse(body || "{}");`, add:

```js
        const wantsStream = parsed.stream === true;
```

- [ ] **Step 3: Feed progress from the job**

In `server.js`, replace the job block. The old code reads:

```js
        let job = exploreInFlight.get(slug);
        if (!job) {
          job = (async () => {
```

and its tail reads:

```js
          })().finally(() => exploreInFlight.delete(slug));
          exploreInFlight.set(slug, job);
        }
```

Replace the head with:

```js
        const job = joinExploreJob(slug, (emit) => (async () => {
```

and the tail with:

```js
        })());
```

Then, inside the job body, pass `emit` into the billed call. Change:

```js
              result = await getComps(address, typeOk, "", 24, 8, "both", null, verifiedComps);
```

to:

```js
              // Progress rides only the billed leg. A cache hit emits nothing,
              // which is exactly what keeps that path answering as plain JSON
              // (see the lazy openSse below). Arguments 9 and 10 are getComps'
              // corpus and subjectDetails defaults, spelled out because the
              // progress callback sits behind them.
              result = await getComps(address, typeOk, "", 24, 8, "both", null, verifiedComps,
                { comps: [], coverage: 0, fresh: false }, {}, emit);
```

- [ ] **Step 4: Subscribe, and open the SSE lazily**

In `server.js`, replace the exit added in Task 3:

```js
        const { status, body: out } = await job;
        if (status === 200) consumeGuestSearchFor(guestGate, req, res, false);
        return sendJson(res, status, out);
```

with:

```js
        // The SSE opens on the FIRST progress event, not up front. At this
        // point the cache lookup still lives inside the shared job, so we
        // cannot yet know whether this request is fast or slow — and a cache
        // hit must answer as plain JSON with a real status code, like every
        // other fast or failed exit. A job that never emits never opens a
        // stream, so that rule is enforced by the structure rather than
        // asserted. (With STREAM_ANTHROPIC=off nothing emits either, and the
        // route degrades cleanly to the old single-response behavior.)
        const onEvent = (evt) => {
          if (!sse) sse = openSse(res);
          sse.send("progress", evt);
        };
        if (wantsStream) {
          for (const evt of job.log) onEvent(evt);   // catch a late joiner up
          job.listeners.add(onEvent);
        }
        let status, out;
        try {
          ({ status, body: out } = await job.promise);
        } finally {
          job.listeners.delete(onEvent);
        }
        // Spent only when a result was actually served — a published page or a
        // thin-data preview, both of which cost a real search and return real
        // content. A 422 thin market, a 429 daily cap or an upstream failure
        // must never burn the visitor's free search.
        if (status === 200) consumeGuestSearchFor(guestGate, req, res, Boolean(sse));
        if (sse) return sse.finish(status === 200 ? "result" : "error",
          status === 200 ? out : { error: out.error });
        return sendJson(res, status, out);
```

- [ ] **Step 5: Deliver thrown errors as a frame once headers are open**

In `server.js`, replace the handler's catch:

```js
      } catch (err) {
        console.error("Error handling /api/explore-market:", err);
        return sendJson(res, 502, { error: clientErrorMessage(err) });
      }
```

with:

```js
      } catch (err) {
        console.error("Error handling /api/explore-market:", err);
        // Once the SSE headers are out there is no status code left to send —
        // deliver the SAME {error} shape as the JSON path so the client's
        // existing failure row handles it with no new error UI.
        const msg = clientErrorMessage(err);
        if (sse) return sse.finish("error", { error: msg });
        return sendJson(res, 502, { error: msg });
      }
```

- [ ] **Step 6: Verify**

```bash
node --check server.js
npm test
```

Expected: `node --check` silent; all Task 1 tests still PASS along with the rest of the suite. The gate sits above the job, so streaming must not have moved any of them.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "Market Explorer: stream the build instead of freezing for a minute

The Explorer ran the same 30-60s billed call as a report while showing one
static line, where /api/comps has had live progress since the streaming
work. It now takes the same optional stream:true and emits the same phases.

The SSE opens lazily on the first progress event rather than up front: the
cache lookup lives inside the shared in-flight job, so at header-writing
time the handler cannot know whether this request is fast or slow. A job
that never emits never opens a stream, so a cache hit keeps answering as
plain JSON with a real status code without restructuring the job or
duplicating the cache read.

exploreInFlight grows a listener set and a bounded replay log so two
visitors sharing one billed search both see it, including a late joiner.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Verify the stream end to end without spending money

`npm test` proves the gate is wired. It cannot prove the stream renders, because that needs a real Anthropic response. The repo's established answer is a fetch-shim harness: a preload script that wraps `globalThis.fetch` and answers the Anthropic endpoint with canned frames, so a full search runs at zero cost. Keep the harness in the scratchpad; it is not committed.

**Files:**
- Create: `<scratchpad>/fake-anthropic.js` (not committed)

- [ ] **Step 1: Write the shim**

Create `fake-anthropic.js` in the scratchpad directory:

```js
// Zero-cost Anthropic stand-in. Preload with `node --require ./fake-anthropic.js
// server.js`. Wraps globalThis.fetch, passes everything that is not the
// Messages API straight through, and answers that one endpoint with canned
// Anthropic SSE frames so the whole streaming path runs without billing.
//
// Two traps this repo has hit with this harness before: blank the Supabase env
// with a single SPACE (not empty) so server.js's .env loader cannot refill it,
// and keep the fake comps in the SUBJECT's own city or the market keying will
// not line up.
const realFetch = globalThis.fetch;

// A small but complete report: 4 priced sale comps, above MIN_PRICED_SALE_COMPS,
// all in Nampa so marketOf() agrees on both the write and read side. Compact
// comp keys (SHORT_COMP_KEYS) are what the model really emits; expandCompKeys
// restores the long shape at parse time.
const comp = (a, p, s, d) =>
  `{"a":"${a}, Nampa, ID","p":"${p}","s":"${s}","d":"${d}","t":"Sale","st":"public_record",` +
  `"u":"https://example.gov/records/${encodeURIComponent(a)}"}`;
const REPORT = `{"summary":"Nampa industrial sales have been steady over the last two years. ` +
  `Pricing clusters tightly around $110 per square foot. This is an automated estimate, not an appraisal.",` +
  `"value_drivers":"Interstate 84 access; limited new supply.","market_trend":"Flat to modestly up.",` +
  `"market_cap_rate_range":"6.5% - 7.5%","comps":[` +
  [comp("1200 N Franklin Blvd", "$4,200,000", "38,000", "2026-02-14"),
    comp("905 E Karcher Rd", "$2,750,000", "25,000", "2025-11-03"),
    comp("3410 Garrity Blvd", "$6,900,000", "63,500", "2025-08-22"),
    comp("77 S Kings Rd", "$1,980,000", "18,200", "2025-05-09")].join(",") +
  `]}`;

// Anthropic streams one SSE frame per line pair. These are the frame types
// server.js's sseFrames reader actually branches on.
function frames() {
  const out = [
    { type: "message_start", message: { usage: { input_tokens: 4000, output_tokens: 0 } } },
    // Two search round trips, so the dropdown shows real query text twice.
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"Nampa Idaho industrial building sales 2025"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", content: [1, 2, 3, 4, 5, 6, 7] } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "server_tool_use", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"query":"Nampa ID warehouse price per square foot recent"}' } },
    { type: "content_block_stop", index: 2 },
    { type: "content_block_start", index: 3, content_block: { type: "web_search_tool_result", content: [1, 2, 3, 4, 5] } },
    { type: "content_block_stop", index: 3 },
    { type: "content_block_start", index: 4, content_block: { type: "text", text: "" } },
  ];
  // Chunk the report so `drafting` fires repeatedly and the bar actually moves.
  for (let i = 0; i < REPORT.length; i += 120) {
    out.push({ type: "content_block_delta", index: 4, delta: { type: "text_delta", text: REPORT.slice(i, i + 120) } });
  }
  out.push({ type: "content_block_stop", index: 4 });
  out.push({ type: "message_delta", usage: { output_tokens: 900 } });
  out.push({ type: "message_stop" });
  return out;
}

globalThis.fetch = async (url, opts) => {
  const href = String(url && url.url ? url.url : url);
  if (!href.includes("api.anthropic.com")) return realFetch(url, opts);
  console.log("🧪 fake-anthropic: intercepted", href);
  const evs = frames();
  const body = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      for (const ev of evs) {
        controller.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
        // Paced so progress is observably incremental rather than one burst.
        await new Promise((r) => setTimeout(r, 60));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
```

If `sseFrames` in `server.js` turns out to branch on a frame shape this does not produce, read it at `server.js:3440-3500` and adjust the canned frames rather than the server. The shim exists to match the real API, not the other way round.

- [ ] **Step 2: Boot the server against the shim**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
$env:ANTHROPIC_API_KEY = "test-key"; $env:SUPABASE_URL = " "; $env:SUPABASE_SERVICE_KEY = " "
$env:STREAM_ANTHROPIC = "on"; $env:GUEST_SEARCH_LIMIT = "off"; $env:PORT = "3117"
node --require "<scratchpad>/fake-anthropic.js" server.js
```

- [ ] **Step 3: Confirm the server streams**

In a second shell:

```bash
curl -N -s -X POST http://localhost:3117/api/explore-market -H "content-type: application/json" -d "{\"type\":\"Industrial\",\"city\":\"Nampa\",\"state\":\"ID\",\"stream\":true}"
```

Expected: `event: progress` frames arriving over several seconds, phases `start` then `search` then `results` then `drafting`, and a final `event: result` carrying `{"url":"/market/industrial-nampa-id", ...}`.

- [ ] **Step 4: Confirm a cache hit stays plain JSON**

Run the exact same curl a second time. Expected: no SSE frames at all, one JSON object, because the second request hits the search cache and the job resolves without emitting. This is the single most important assertion in this task; it is what the lazy-open design exists to guarantee.

- [ ] **Step 5: Confirm the browser renders it**

Open `http://localhost:3117`, type `industrial Nampa ID` into the Market Explorer box, and click the explore row. Expected: the headline moves from "Building the ... snapshot" through "Searching recent sales" to "Building the page", the detail line shows real search text, the hairline bar advances, and the page navigates to the built market page. Take a screenshot for the commit message evidence.

Note the browser check must be done in a real browser: per the verification-quirks memory, the embedded pane cannot screenshot this app.

- [ ] **Step 6: Confirm the gate renders as a modal, not an error**

Restart the server with `GUEST_SEARCH_LIMIT=0`, reload, and explore an uncovered market while signed out. Expected: the account modal opens with the free-account nudge; no red error row appears; the dropdown closes.

- [ ] **Step 7: Stop the server**

The shim harness is scratch. Nothing to commit from this task.

---

## Task 9: Devlog and CLAUDE.md

The standing devlog rule: every shipped fix, improvement or feature gets an entry in the same commit. Both parts here qualify.

**Files:**
- Modify: `devlog.json`
- Modify: `CLAUDE.md` (the `GUEST_SEARCH_LIMIT` bullet and the live-search-progress bullet)

- [ ] **Step 1: Add both devlog entries**

Append to `devlog.json`. Save as clean UTF-8; em dashes and arrows are correct raw and must never be ASCII-escaped. CI fails the build on the `Ã` / `â€` / `Â` mojibake pattern.

```json
{
  "date": "2026-08-05",
  "type": "fix",
  "title": "The Market Explorer no longer bypasses the free-search cap",
  "details": "/api/explore-market runs the same billed search pipeline as a report but carried no guest check, so an anonymous visitor who had used their free search could keep triggering billed searches from the homepage. It now spends the same single allowance. Browsing a market page that already exists stays free and ungated."
},
{
  "date": "2026-08-05",
  "type": "improvement",
  "title": "Live progress while the Market Explorer builds a page",
  "details": "Building a new market page takes 30-60 seconds and used to show one frozen line. It now streams the same live progress a valuation search does, rendered compactly in the search dropdown: the real searches running, sales found, and a progress bar."
}
```

- [ ] **Step 2: Update the `GUEST_SEARCH_LIMIT` bullet in CLAUDE.md**

That bullet currently reads `Enforced in /api/comps (403 + signin_required: true, which the client turns into the account modal)`. Change it to name both routes:

```
  Enforced in `/api/comps` **and `/api/explore-market`** (403 +
  `signin_required: true`, which the client turns into the account modal) —
  the Explorer runs the same billed pipeline, so it spends the same single
  allowance; a market page that already exists is served free and ungated
  above the check.
```

- [ ] **Step 3: Update the live-progress bullet in CLAUDE.md**

That bullet opens `**Live search progress** (no env var — always on for the browser). POST /api/comps takes an optional stream: true in the body`. Change the first sentence to:

```
  **Live search progress** (no env var — always on for the browser). `POST
  /api/comps` **and `POST /api/explore-market`** take an optional `stream:
  true` in the body; when set, and only once the slow leg is actually about
  to run, the response switches to `text/event-stream`
```

Then add, at the end of that bullet:

```
  The Explorer reaches the same rule from the other side: its cache lookup
  lives inside the shared in-flight job, so it cannot decide up front whether
  the request is fast. Its SSE opens on the FIRST progress event instead, and
  a cache hit (which emits nothing) therefore answers as plain JSON with no
  special-casing. `exploreInFlight` carries a listener set and a bounded
  replay log so two visitors sharing one billed search both see it.
```

- [ ] **Step 4: Verify the devlog is not mojibake'd**

```bash
node -e "JSON.parse(require('fs').readFileSync('devlog.json','utf8')); console.log('devlog parses')"
grep -c "Ã\|â€\|Â" devlog.json
```

Expected: `devlog parses`, and a count of `0`.

- [ ] **Step 5: Commit**

```bash
git status --porcelain
git add devlog.json CLAUDE.md
git commit -m "Devlog + CLAUDE.md for the Explorer gate and live progress

Both sections named only /api/comps: the guest-cap bullet described the
enforcement point, and the live-progress bullet described the stream: true
convention. Both are now true of two routes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full suite**

```bash
npm test
```

Expected: green, with three more tests than the baseline.

- [ ] **Step 2: Entry-point syntax, the same check CI runs**

```bash
node --check server.js
node --check gen-market-seed.js
```

Expected: both silent.

- [ ] **Step 3: Bare-environment boot smoke, the other check CI runs**

Confirm the server still boots with nothing configured and answers `/healthz`. The routes tests already do this as a side effect of `boot()`, so a green suite in Step 1 covers it.

- [ ] **Step 4: Read the whole diff before proposing a merge**

```bash
git --no-pager diff main...HEAD --stat
git --no-pager diff main...HEAD
```

Confirm the diff touches only `server.js`, `index.html`, `tailwind.css`, `test/routes.test.js`, `devlog.json`, `CLAUDE.md`, and the two `docs/superpowers/` files. A second session shares this checkout, so anything else in the diff belongs to someone else and must not be swept in.

- [ ] **Step 5: Stop here**

Do not push or deploy. Merging deploys, and this branch needs no migration but does need the owner's call on timing. Report completion and hand back.

---

## Notes for the implementer

**No migration is required.** This change adds no table and no column. `guest_search_quota` (migration 011) is already applied in production, and this reuses it unchanged.

**`PRO_AUDIENCE` is irrelevant here.** The guest gate is about anonymous visitors, not the paid tier. Do not add an entitlements read to this route.

**Do not gate the covered-market path.** If you find yourself moving the `getMarketPage(slug)` short circuit below the gate, stop: that path is a database read, it is what the SEO surface depends on, and one of the Task 1 tests exists specifically to catch this.

**Do not add a silence watchdog on the client.** `/api/comps` needs one because its loading card animates and would sit dead if Render's edge buffered the stream. The Explorer's dropdown starts on the static "Usually 30-60 seconds" line, so a stream that never produces an event degrades to exactly today's behavior with no extra code.
