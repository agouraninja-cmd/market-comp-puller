# Market Explorer City Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/explore-market` refuses a typo'd or nonexistent city with a friendly 400 before spending a billed Anthropic search or publishing a junk market page.

**Architecture:** A new pure module `city-check.js` (dependency-injected fetch, no I/O of its own) maps Zippopotam's `GET /us/{ST}/{city}` responses onto three verdicts: `ok` / `unknown` / `unavailable`. server.js owns the real fetch, a process-lifetime verdict memo, a dedicated rate-limit key, and the route wiring: `unknown` answers 400, `unavailable` fails open (the search runs as today).

**Tech Stack:** Plain Node 18+ (built-in `fetch`, `AbortSignal.timeout`), `node --test`. Zero npm dependencies — do not add any.

**Spec:** `docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md`

## Global Constraints

- Zero npm dependencies; plain Node 18+ only.
- No client (index.html) changes; no tailwind.css regen needed.
- Validate-only: the visitor's spelling keeps naming the slug and page. No canonicalization.
- Fail open on validator outage (timeout / 5xx / network / own rate limit). `DAILY_SEARCH_CAP` backstops spend.
- Two outbound requests maximum per check (as-typed, then one normalized variant).
- A 400 must never consume the guest's free search (already true: `consumeGuestSearchFor` only fires on status 200 — do not move it).
- `devlog.json` entry in the same commit as the feature; save as clean UTF-8, em dashes raw, never escaped. Follow the shared-checkout devlog collision protocol (rebuild from `git show HEAD:devlog.json` + working-file entries, never blind-patch).
- server.js edits require restarting any locally running server to test manually; `npm test` needs no server.
- This checkout may be shared with another session: `git status --short` before staging, stage explicit paths only, never `git add -A`.

---

### Task 1: `city-check.js` pure module (TDD)

**Files:**
- Create: `city-check.js`
- Test: `test/city-check.test.js`

**Interfaces:**
- Consumes: nothing from this codebase. The caller injects `fetchFn(url) -> Promise<{status}>`.
- Produces (Task 2 relies on these exact names):
  - `CITYCHECK.cityVariants(city)` → `string[]` — ordered, deduped names to try: as typed, then one normalized variant (periods and apostrophes stripped, whitespace collapsed, a leading "St " expanded to "Saint "). Length 1 when the variant equals the input case-insensitively.
  - `CITYCHECK.checkCity(fetchFn, city, state)` → `Promise<"ok" | "unknown" | "unavailable">`. Calls `https://api.zippopotam.us/us/{ST}/{variant}` per variant: 200 → `"ok"` (stop), 404 → next variant, any other status or a throw → `"unavailable"` (stop). All variants 404 → `"unknown"`.

- [ ] **Step 1: Write the failing test**

Create `test/city-check.test.js`:

```js
// test/city-check.test.js
// The Market Explorer's real-city check. Pure like bov-log.js: no I/O of its
// own — the caller injects fetch, which is what lets npm test cover every
// verdict with no network.
// Spec: docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md

const test = require("node:test");
const assert = require("node:assert");

const CITYCHECK = require("../city-check");

// A recording fetch stub: `plan` is an array of {status} or Error, consumed
// in order; `calls` records every URL asked for.
function stubFetch(plan) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const next = plan.shift();
    if (next instanceof Error) throw next;
    return { status: next.status };
  };
  fn.calls = calls;
  return fn;
}

test("cityVariants: plain city has no variant", () => {
  assert.deepEqual(CITYCHECK.cityVariants("Boise"), ["Boise"]);
  assert.deepEqual(CITYCHECK.cityVariants("Los Angeles"), ["Los Angeles"]);
});

test("cityVariants: punctuation and St-expansion produce ONE normalized variant", () => {
  assert.deepEqual(CITYCHECK.cityVariants("St. Louis"), ["St. Louis", "Saint Louis"]);
  assert.deepEqual(CITYCHECK.cityVariants("St Louis"), ["St Louis", "Saint Louis"]);
  assert.deepEqual(CITYCHECK.cityVariants("Coeur d'Alene"), ["Coeur d'Alene", "Coeur dAlene"]);
});

test("cityVariants: variant equal to the input (case-insensitive) is deduped", () => {
  assert.deepEqual(CITYCHECK.cityVariants("Saint Louis"), ["Saint Louis"]);
});

test("checkCity: 200 on the first try is ok, one call, correct URL", async () => {
  const f = stubFetch([{ status: 200 }]);
  assert.equal(await CITYCHECK.checkCity(f, "Boise", "ID"), "ok");
  assert.deepEqual(f.calls, ["https://api.zippopotam.us/us/ID/Boise"]);
});

test("checkCity: spaces are URL-encoded", async () => {
  const f = stubFetch([{ status: 200 }]);
  await CITYCHECK.checkCity(f, "Los Angeles", "CA");
  assert.deepEqual(f.calls, ["https://api.zippopotam.us/us/CA/Los%20Angeles"]);
});

test("checkCity: 404 then 200 on the normalized variant is ok, two calls", async () => {
  const f = stubFetch([{ status: 404 }, { status: 200 }]);
  assert.equal(await CITYCHECK.checkCity(f, "St. Louis", "MO"), "ok");
  assert.deepEqual(f.calls, [
    "https://api.zippopotam.us/us/MO/St.%20Louis",
    "https://api.zippopotam.us/us/MO/Saint%20Louis",
  ]);
});

test("checkCity: every variant 404 is unknown, capped at two calls", async () => {
  const f = stubFetch([{ status: 404 }, { status: 404 }]);
  assert.equal(await CITYCHECK.checkCity(f, "St. Bosie", "ID"), "unknown");
  assert.equal(f.calls.length, 2);
});

test("checkCity: a single-variant city that 404s is unknown after one call", async () => {
  const f = stubFetch([{ status: 404 }]);
  assert.equal(await CITYCHECK.checkCity(f, "Bosie", "ID"), "unknown");
  assert.equal(f.calls.length, 1);
});

// Fail open: anything that is not a clean yes/no answer must never refuse a
// legitimate market. 5xx, weird statuses, and thrown network errors all map
// to "unavailable" — including a throw AFTER a 404, where the truth is unknown.
test("checkCity: 500 is unavailable", async () => {
  const f = stubFetch([{ status: 500 }]);
  assert.equal(await CITYCHECK.checkCity(f, "Boise", "ID"), "unavailable");
});

test("checkCity: a thrown fetch (timeout/network) is unavailable", async () => {
  const f = stubFetch([new Error("aborted")]);
  assert.equal(await CITYCHECK.checkCity(f, "Boise", "ID"), "unavailable");
});

test("checkCity: 404 then a throw is unavailable, not unknown", async () => {
  const f = stubFetch([{ status: 404 }, new Error("aborted")]);
  assert.equal(await CITYCHECK.checkCity(f, "St. Louis", "MO"), "unavailable");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/city-check.test.js`
Expected: FAIL — `Cannot find module '../city-check'`.

- [ ] **Step 3: Write the implementation**

Create `city-check.js`:

```js
// city-check.js — the Market Explorer's real-city check.
//
// A typo'd city used to spend a billed search and could publish a permanently
// misspelled /market/ page. This module decides whether a (city, state) pair
// names a real US city, using Zippopotam's keyless city endpoint — the same
// service the Address Explorer already trusts client-side for zip resolve.
//
// Pure on purpose: no I/O of its own (the caller injects fetch), which is
// what lets npm test cover every verdict with no network. server.js owns the
// real fetch, the timeout, the verdict memo, and the rate limit.
//
// Spec: docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md

// Ordered, deduped list of names to try: as typed, then ONE normalized
// variant (periods and apostrophes stripped, whitespace collapsed, a leading
// "St " expanded to "Saint "). The retry exists because a false 404 on a
// punctuation variant of a real city would refuse a legitimate market —
// worse than the typo pages this module exists to stop.
function cityVariants(city) {
  const typed = String(city || "").trim();
  const normalized = typed
    .replace(/[.']/g, "")
    .replace(/\s+/g, " ")
    .replace(/^st /i, "Saint ")
    .trim();
  if (!normalized || normalized.toLowerCase() === typed.toLowerCase()) return [typed];
  return [typed, normalized];
}

// "ok" | "unknown" | "unavailable". Two outbound requests maximum.
// 200 = the city exists. 404 = this name doesn't; try the next variant.
// Anything else — 5xx, a weird status, a thrown timeout/network error —
// is "unavailable", INCLUDING a throw after a 404: the truth is unknown,
// and fail-open must never refuse a legitimate market.
async function checkCity(fetchFn, city, state) {
  for (const variant of cityVariants(city)) {
    let res;
    try {
      res = await fetchFn(
        `https://api.zippopotam.us/us/${encodeURIComponent(state)}/${encodeURIComponent(variant)}`
      );
    } catch (_) {
      return "unavailable";
    }
    if (res.status === 200) return "ok";
    if (res.status !== 404) return "unavailable";
  }
  return "unknown";
}

module.exports = { cityVariants, checkCity };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/city-check.test.js`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Run the whole suite and syntax check**

Run: `npm test` and `node --check city-check.js`
Expected: everything green (the suite auto-discovers `test/*.test.js`).

- [ ] **Step 6: Commit**

```bash
git status --short
git add city-check.js test/city-check.test.js
git commit -m "Add city-check.js: pure real-city verdicts for the Market Explorer"
```

(Per shared-checkout: stage exactly these two paths; leave anything else in the tree alone.)

---

### Task 2: Wire the check into `/api/explore-market`

**Files:**
- Modify: `server.js` (three spots: requires at top ~line 103, a helper near the explore route, the route body at ~line 9082)
- Modify: `devlog.json` (one new entry)

**Interfaces:**
- Consumes: `CITYCHECK.checkCity(fetchFn, city, state)` from Task 1; existing `rateLimited(key, max, windowMs)`, `clientIp(req)`, `logEvent(kind, dims)`, `sendJson(res, status, body)`.
- Produces: nothing later tasks rely on (this is the last task).

- [ ] **Step 1: Add the require**

In `server.js`, with the other pure-module requires (after line ~103, `const BRANDING = require("./branding.js");`):

```js
const CITYCHECK = require("./city-check");
```

- [ ] **Step 2: Add the memoized server-side helper**

Place it directly above the `/api/explore-market` route (search for `// --- Market Explorer: generate a /market/<slug> page on demand`, ~line 9020):

```js
// Real-city verdicts for the Explorer, memoized for the process lifetime:
// a city doesn't pop into or out of existence, and a restart clears any
// data-gap mistake. "unavailable" is deliberately never cached — the next
// request retries the service. The memo is consulted BEFORE the rate
// limiter so repeat lookups of known cities stay free; the limiter only
// bounds outbound Zippopotam calls, and tripping it fails OPEN (this is a
// guardrail on our own spend, not a service the visitor is owed).
const cityVerdictMem = new Map(); // "ST|city" -> "ok" | "unknown"
async function checkExploreCity(req, city, state) {
  const key = `${state}|${city.toLowerCase()}`;
  if (cityVerdictMem.has(key)) return cityVerdictMem.get(key);
  if (rateLimited("exploreCheck:" + clientIp(req), 10, 15 * 60 * 1000)) return "unavailable";
  const verdict = await CITYCHECK.checkCity(
    (url) => fetch(url, { signal: AbortSignal.timeout(4000) }), city, state);
  if (verdict !== "unavailable") cityVerdictMem.set(key, verdict);
  return verdict;
}
```

- [ ] **Step 3: Wire it into the route**

In the `/api/explore-market` handler, the current code reads (immediately after the guest-gate block that ends with `signin_required: true });` + closing brace, and immediately before `if (rateLimited("explore:" + clientIp(req), 3, 15 * 60 * 1000)) {`):

Insert between those two blocks:

```js
        // Real-city check, BEFORE the explore limiter so a typo answers 400
        // without eating one of the visitor's three real-search slots — and
        // before the billed job, which is the whole point: "industrial Bosie
        // ID" must never spend ~$0.36 or publish a misspelled /market/ page.
        // "unavailable" (service down or exploreCheck limiter tripped) falls
        // through and the search runs exactly as before this check existed;
        // DAILY_SEARCH_CAP still backstops spend. A 400 here never consumes
        // the guest's free search (consumeGuestSearchFor keys on status 200).
        // Spec: docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md
        const cityVerdict = await checkExploreCity(req, cityOk, stateOk);
        if (cityVerdict === "unknown") {
          logEvent("explore_reject", { prop_type: typeOk, market: `${cityOk}, ${stateOk}` });
          return sendJson(res, 400, {
            error: `We couldn't find a city called "${cityOk}" in ${stateOk}. Check the spelling, or run a valuation for a specific property instead.`,
          });
        }
```

Do NOT touch the existing-page short circuit, the guest gate, the `explore:` limiter, or anything inside `joinExploreJob`.

- [ ] **Step 4: Syntax check and full suite**

Run: `node --check server.js` and `npm test`
Expected: both green. `test/routes.test.js` boots the real server; it must still pass untouched (nothing in it explores an uncovered market, so no network call fires).

- [ ] **Step 5: Manual smoke test (live behavior, one time)**

Start the server (Windows portable Node):

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js
```

Then in a second terminal:

```bash
curl -s -X POST http://localhost:3000/api/explore-market -H "content-type: application/json" -d "{\"type\":\"Industrial\",\"city\":\"Zzzzz\",\"state\":\"ID\"}"
```

Expected: `{"error":"We couldn't find a city called \"Zzzzz\" in ID. Check the spelling, or run a valuation for a specific property instead."}` and no `Anthropic call` line in the server log. Then confirm a real covered city still short-circuits free:

```bash
curl -s -X POST http://localhost:3000/api/explore-market -H "content-type: application/json" -d "{\"type\":\"Industrial\",\"city\":\"Boise\",\"state\":\"ID\"}"
```

Expected: `{"url":"/market/industrial-boise-id",...,"existing":true}` if that page exists locally, with no validator involvement (the short circuit runs first). Do NOT explore a genuinely new market locally — that would bill a real search. Stop the server afterward.

- [ ] **Step 6: Devlog entry**

Add to `devlog.json` (rebuild-don't-patch if another session's entries are in flight, per shared-checkout; keep UTF-8, raw em dashes fine):

```json
{
  "date": "2026-08-09",
  "type": "improvement",
  "title": "Market Explorer checks the city is real before billing a search",
  "details": "A typo'd or nonexistent city (\"industrial Bosie ID\") now gets a friendly error instead of spending a billed search and potentially publishing a misspelled market page. Keyless Zippopotam check with a punctuation-variant retry; fails open if the service is down.",
  "commit": ""
}
```

Fill `commit` after the commit exists, or leave it out (the field is optional).

- [ ] **Step 7: Commit**

```bash
git status --short
git add server.js devlog.json
git commit -m "Market Explorer: validate the city exists before the billed search"
```

---

## Self-Review Notes

- Spec coverage: ordering (Task 2 Step 3), validator + variants (Task 1), fail-open + memo semantics (Task 2 Step 2), error copy (Task 2 Step 3, verbatim), analytics event (Task 2 Step 3), no-client-changes (no task touches index.html), testing stance (Task 1 tests + no routes-test additions + manual live check in Task 2 Step 5). Out-of-scope items have no tasks, correctly.
- Names used in Task 2 (`CITYCHECK.checkCity`, verdict strings) match Task 1's exports exactly.
- No placeholders; every step carries its code or command.
