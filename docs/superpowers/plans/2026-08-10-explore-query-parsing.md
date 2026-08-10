# Market Explorer Query Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Market Explorer understands full state names, zip codes, type synonyms and filler words, instead of accepting only "industrial Boise ID".

**Architecture:** A new pure module `explore-query.js` (dual Node/browser export, like `valuation.js` and `gut-check.js`) owns the parse and its tables, so `npm test` can cover them. It performs no I/O: a zip is returned as an intent that `index.html` resolves through Zippopotam behind a debounce and a per-session cache. The server is untouched apart from one `STATIC_FILES` entry.

**Tech Stack:** Plain Node 18+ and browser JS, zero npm dependencies, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-10-explore-query-parsing-design.md`

## Global Constraints

- Zero npm dependencies; plain Node 18+ and plain browser JS.
- `explore-query.js` is PURE: no I/O, no clock, no `fetch`. A zip is returned as an intent, never resolved inside the module.
- Served with `maxAge: 0` in `STATIC_FILES`, the same rule `valuation.js` and `gut-check.js` carry, because a stale copy against a newer `index.html` is the failure nobody detects.
- The state must be resolved BEFORE fillers are stripped: IN, OR, OK, ME, HI, DE, LA and PA are both state abbreviations and English words.
- Two-word type synonyms must be matched BEFORE the exact single-token type match.
- Nothing auto-runs: a resolved query still renders the explore row for the visitor to click. Parsing more generously must never turn a keystroke into a billed search.
- No server route, prompt, or validation change. The client still posts `{type, city, state}`.
- `devlog.json`: edit with the Edit tool, never PowerShell; clean UTF-8, raw em dashes are correct and must never be escaped.
- Shared checkout: another session is actively editing `index.html`. Run `git status --short` before staging, stage explicit paths only, never `git add -A`, and match edits on quoted code rather than line numbers.

---

### Task 1: `explore-query.js` pure module (TDD)

**Files:**
- Create: `explore-query.js`
- Test: `test/explore-query.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 2 relies on these exact names):
  - Browser global `EXPLOREQ` / Node `module.exports`, both carrying `parseExploreQuery`, `EXPLORE_TYPES`, `STATE_NAMES`, `TYPE_SYNONYMS`, `FILLERS`.
  - `parseExploreQuery(raw)` → one of `{type, city, state}`, `{reason: "no-type", city, state}`, `{reason: "zip", zip, type}` (type may be null), or `{reason: "no-city" | "no-state" | "unsupported-type"}`.
  - `EXPLORE_TYPES` is `["Industrial", "Office", "Retail", "Multifamily"]` in canonical capitalization.

- [ ] **Step 1: Write the failing test**

Create `test/explore-query.test.js`:

```js
// test/explore-query.test.js
// What someone types into the Market Explorer. Pure like city-check.js: no
// I/O, so npm test covers every table and every ordering trap with no
// network. A zip is returned as an intent for index.html to resolve.
// Spec: docs/superpowers/specs/2026-08-10-explore-query-parsing-design.md

const test = require("node:test");
const assert = require("node:assert");

const EQ = require("../explore-query");
const parse = EQ.parseExploreQuery;

test("the classic shape still parses", () => {
  assert.deepEqual(parse("industrial Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("office Dallas, TX"), { type: "Office", city: "Dallas", state: "TX" });
});

test("full state names resolve, including two-word ones", () => {
  assert.deepEqual(parse("industrial Boise Idaho"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("retail Santa Fe New Mexico"), { type: "Retail", city: "Santa Fe", state: "NM" });
  assert.deepEqual(parse("office Brooklyn New York"), { type: "Office", city: "Brooklyn", state: "NY" });
});

// The whole reason the state is resolved BEFORE fillers are stripped: eight
// abbreviations are also English words. Strip "in" first and Indiana is gone.
test("a trailing state abbreviation that is also a filler word survives", () => {
  assert.deepEqual(parse("warehouse in Gary IN"), { type: "Industrial", city: "Gary", state: "IN" });
  assert.deepEqual(parse("retail in Portland OR"), { type: "Retail", city: "Portland", state: "OR" });
});

test("filler words are dropped from the city", () => {
  assert.deepEqual(parse("industrial market in Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("office properties for sale in Tampa FL"), { type: "Office", city: "Tampa", state: "FL" });
});

// "Kansas City Kansas" is the case where the city CONTAINS a state word.
test("a city whose name contains a state word keeps it", () => {
  assert.deepEqual(parse("industrial Kansas City Kansas"), { type: "Industrial", city: "Kansas City", state: "KS" });
  assert.deepEqual(parse("office New York NY"), { type: "Office", city: "New York", state: "NY" });
});

// The empty-city guard: consuming the state must never leave a blank city.
test("a state name with no city left is no-city, not a blank city", () => {
  assert.deepEqual(parse("office New York"), { reason: "no-city" });
  assert.deepEqual(parse("industrial Idaho"), { reason: "no-city" });
});

test("two-word type synonyms win over the bare type token", () => {
  assert.deepEqual(parse("office building Boise ID"), { type: "Office", city: "Boise", state: "ID" });
  assert.deepEqual(parse("industrial park Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("shopping center Boise ID"), { type: "Retail", city: "Boise", state: "ID" });
});

test("one-word type synonyms, including the hyphenated one", () => {
  assert.deepEqual(parse("warehouse Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("apartments Boise ID"), { type: "Multifamily", city: "Boise", state: "ID" });
  assert.deepEqual(parse("multi-family Boise ID"), { type: "Multifamily", city: "Boise", state: "ID" });
});

test("a zip becomes an intent, carrying a type when one was typed", () => {
  assert.deepEqual(parse("83301"), { reason: "zip", zip: "83301", type: null });
  assert.deepEqual(parse("warehouse 83301"), { reason: "zip", zip: "83301", type: "Industrial" });
  assert.deepEqual(parse("industrial 83301"), { reason: "zip", zip: "83301", type: "Industrial" });
});

test("unchanged refusals and hint reasons", () => {
  assert.deepEqual(parse("land Boise ID"), { reason: "unsupported-type" });
  assert.deepEqual(parse("residential Boise ID"), { reason: "unsupported-type" });
  assert.deepEqual(parse("Boise ID"), { reason: "no-type", city: "Boise", state: "ID" });
  assert.deepEqual(parse("industrial Boise"), { reason: "no-state" });
  assert.deepEqual(parse(""), { reason: "no-city" });
  assert.deepEqual(parse("   "), { reason: "no-city" });
});

test("city capitalization matches what the server expects", () => {
  // server.js title-cases after punctuation too, and city-check.js sends the
  // typed spelling to Zippopotam, so "coeur d'alene idaho" must come back
  // as "Coeur D'Alene", not "Coeur d'alene".
  assert.deepEqual(parse("industrial coeur d'alene idaho"),
    { type: "Industrial", city: "Coeur D'Alene", state: "ID" });
});

test("tables are exported and canonical", () => {
  assert.deepEqual(EQ.EXPLORE_TYPES, ["Industrial", "Office", "Retail", "Multifamily"]);
  assert.equal(EQ.STATE_NAMES.idaho, "ID");
  assert.equal(EQ.STATE_NAMES["new mexico"], "NM");
  assert.equal(Object.keys(EQ.STATE_NAMES).length, 50);   // DC rides the abbreviation list only
  assert.equal(EQ.TYPE_SYNONYMS.warehouse, "Industrial");
  assert.ok(EQ.FILLERS.includes("market"));
  assert.ok(!EQ.FILLERS.includes("the"));  // "The Dalles OR" is a real city
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/explore-query.test.js`
Expected: FAIL — `Cannot find module '../explore-query'`.

- [ ] **Step 3: Write the implementation**

Create `explore-query.js`:

```js
// explore-query.js — what someone types into the Market Explorer, parsed.
//
// The Explorer used to accept exactly one shape, "<type> <city> <ST>", so a
// full state name, a zip code, a synonym ("warehouse") or an ordinary filler
// word ("industrial market in Boise ID") all dead-ended in a hint row at the
// very top of the funnel.
//
// Pure and dual-exported (Node for npm test, a browser global for
// index.html), like valuation.js and gut-check.js — and served with the same
// maxAge: 0 rule, because a stale copy against a newer index.html is the
// failure nobody detects. NO I/O lives here: a zip is returned as an intent
// for index.html to resolve, which is what keeps every table testable with
// no network.
//
// Spec: docs/superpowers/specs/2026-08-10-explore-query-parsing-design.md
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EXPLOREQ = api;
})(typeof self !== "undefined" ? self : this, function () {

  // The four types the market-page format is proven on. Canonical
  // capitalization: this is what gets posted to /api/explore-market.
  const EXPLORE_TYPES = ["Industrial", "Office", "Retail", "Multifamily"];
  // Valid report types the Explorer deliberately refuses.
  const NON_EXPLORE_TYPES = ["land", "residential"];

  const STATE_ABBRS = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA " +
    "ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX " +
    "UT VT VA WA WV WI WY").split(" ");

  // Full names to abbreviations. Deliberately 50 entries: "district of
  // columbia" is three words, which the one- and two-token lookups below
  // cannot reach, and "Washington DC" already works through STATE_ABBRS.
  const STATE_NAMES = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
    colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
    kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
    missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
    oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
    wyoming: "WY",
  };

  // How people describe these property types when they aren't reading our
  // dropdown. Two-word entries are matched against adjacent token pairs.
  const TYPE_SYNONYMS = {
    warehouse: "Industrial", warehouses: "Industrial", distribution: "Industrial",
    "industrial park": "Industrial",
    apartment: "Multifamily", apartments: "Multifamily", apts: "Multifamily",
    "multi-family": "Multifamily",
    offices: "Office", "office building": "Office",
    shops: "Retail", "shopping center": "Retail", "strip mall": "Retail",
    "retail center": "Retail",
  };

  // Words that are never part of a city name here. "the" and "a" are
  // deliberately absent: The Dalles OR is a real market.
  const FILLERS = ["market", "markets", "comps", "comp", "properties",
    "property", "for", "sale", "in", "near"];

  // Match server.js's own city casing, which upper-cases after spaces,
  // periods, apostrophes and hyphens — so "coeur d'alene" becomes
  // "Coeur D'Alene", the spelling city-check.js then validates.
  function titleCase(s) {
    return s.replace(/(^|[\s.'\-])[a-z]/g, (ch) => ch.toUpperCase());
  }

  function parseExploreQuery(raw) {
    let tokens = String(raw || "").toLowerCase().replace(/,/g, " ")
      .split(/\s+/).filter(Boolean);
    if (!tokens.length) return { reason: "no-city" };
    if (tokens.some((t) => NON_EXPLORE_TYPES.includes(t))) return { reason: "unsupported-type" };

    // Type. Two-word synonyms FIRST: "office building" must not match the
    // bare "office" and leave "building" glued to the city.
    let type = null;
    for (let i = 0; i < tokens.length - 1 && !type; i++) {
      const pair = tokens[i] + " " + tokens[i + 1];
      if (TYPE_SYNONYMS[pair]) {
        type = TYPE_SYNONYMS[pair];
        tokens.splice(i, 2);
      }
    }
    if (!type) {
      const exact = tokens.find((t) => EXPLORE_TYPES.some((e) => e.toLowerCase() === t));
      if (exact) {
        type = EXPLORE_TYPES.find((e) => e.toLowerCase() === exact);
        tokens = tokens.filter((t) => t !== exact);
      }
    }
    if (!type) {
      const syn = tokens.find((t) => TYPE_SYNONYMS[t]);
      if (syn) {
        type = TYPE_SYNONYMS[syn];
        tokens = tokens.filter((t) => t !== syn);
      }
    }

    // Zip, after the type so the intent can carry one ("warehouse 83301").
    const zip = tokens.find((t) => /^\d{5}$/.test(t));
    if (zip) return { reason: "zip", zip, type };

    // State BEFORE fillers are stripped. IN, OR, OK, ME, HI, DE, LA and PA
    // are abbreviations AND English words; stripping fillers first would eat
    // the "IN" in "warehouse in Gary IN" and lose Indiana.
    let state = null;
    const pair = tokens.slice(-2).join(" ");
    if (tokens.length >= 2 && STATE_NAMES[pair]) {
      state = STATE_NAMES[pair];
      tokens = tokens.slice(0, -2);
    } else {
      const last = tokens[tokens.length - 1] || "";
      if (STATE_NAMES[last]) {
        state = STATE_NAMES[last];
        tokens = tokens.slice(0, -1);
      } else if (STATE_ABBRS.indexOf(last.toUpperCase()) !== -1) {
        state = last.toUpperCase();
        tokens = tokens.slice(0, -1);
      }
    }

    tokens = tokens.filter((t) => FILLERS.indexOf(t) === -1);
    const city = tokens.map(titleCase).join(" ");

    // Empty-city guard: a state name that consumed everything ("office New
    // York") must ask for a city, never offer to build a page for "".
    if (!city) return { reason: "no-city" };
    if (!state) return { reason: "no-state" };
    if (!type) return { reason: "no-type", city, state };
    return { type, city, state };
  }

  return { parseExploreQuery, EXPLORE_TYPES, NON_EXPLORE_TYPES, STATE_NAMES, TYPE_SYNONYMS, FILLERS };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/explore-query.test.js`
Expected: PASS, all 12 tests. If any case fails, fix `explore-query.js`, never the test's expectations — they are the spec's stated behavior.

- [ ] **Step 5: Full suite and syntax check**

Run: `node --check explore-query.js` then `npm test`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git status --short
git add explore-query.js test/explore-query.test.js
git commit -m "Add explore-query.js: forgiving Market Explorer query parsing"
```

---

### Task 2: Wire the module into the page and the server

**Files:**
- Modify: `server.js` (the `STATIC_FILES` map)
- Modify: `index.html` (script tag near `/valuation.js`; the Market Explorer IIFE)
- Modify: `devlog.json` (one new entry)

**Interfaces:**
- Consumes: `EXPLOREQ.parseExploreQuery(raw)` and `EXPLOREQ.EXPLORE_TYPES` from Task 1.
- Produces: the live behavior Task 3 verifies in a browser.

- [ ] **Step 1: Serve the module**

In `server.js`, find:

```js
    "/gut-check.js": { file: "gut-check.js", type: "text/javascript; charset=utf-8", maxAge: 0 },
```

Add directly below:

```js
    // Same maxAge: 0 rule again: index.html's Market Explorer calls the
    // global EXPLOREQ, so this file must never be stale relative to it.
    "/explore-query.js": { file: "explore-query.js", type: "text/javascript; charset=utf-8", maxAge: 0 },
```

- [ ] **Step 2: Load it in the page**

In `index.html`, find:

```html
  <script src="/valuation.js"></script>
```

Replace with:

```html
  <script src="/valuation.js"></script>
  <script src="/explore-query.js"></script>
```

- [ ] **Step 3: Use the module in the Explorer IIFE**

In `index.html`, find the whole local parser and its comment:

```js
    // "industrial Boise ID" -> {type, city, state}; otherwise {reason} for a hint row.
    const parseExploreQuery = (q) => {
      let tokens = q.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
      if (tokens.some((t) => NON_EXPLORE_TYPES.includes(t))) return { reason: "unsupported-type" };
      const type = EXPLORE_TYPES.find((t) => tokens.includes(t));
      tokens = tokens.filter((t) => t !== type);
      const last = tokens[tokens.length - 1] || "";
      const state = US_STATES.includes(last.toUpperCase()) ? last.toUpperCase() : null;
      const city = (state ? tokens.slice(0, -1) : tokens).map(cap).join(" ");
      if (!city) return { reason: "no-city" };
      if (!state) return { reason: "no-state" };
      if (!type) return { reason: "no-type", city, state };
      return { type: cap(type), city, state };
    };
```

Replace with:

```js
    // Parsing lives in the pure, tested explore-query.js (served maxAge: 0).
    // Read defensively: if that file ever fails to load, only this dropdown
    // degrades, and it degrades to the old exact-shape behavior rather than
    // throwing inside a keystroke handler.
    const parseExploreQuery = (q) => {
      const mod = typeof EXPLOREQ !== "undefined" ? EXPLOREQ : null;
      if (mod) return mod.parseExploreQuery(q);
      const tokens = q.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
      const type = EXPLORE_TYPES.find((t) => tokens.includes(t));
      const rest = tokens.filter((t) => t !== type);
      const last = rest[rest.length - 1] || "";
      const state = US_STATES.includes(last.toUpperCase()) ? last.toUpperCase() : null;
      const city = (state ? rest.slice(0, -1) : rest).map(cap).join(" ");
      if (!city) return { reason: "no-city" };
      if (!state) return { reason: "no-state" };
      if (!type) return { reason: "no-type", city, state };
      return { type: cap(type), city, state };
    };
    // Zip lookups: one per settled zip, cached for the page's life (a miss
    // caches as null, so a bad zip is asked once). Resolved here rather than
    // in the module, which stays pure and testable with no network.
    const zipCache = new Map();
    let zipTimer = null;
    const resolveZip = (zip) => {
      if (zipTimer) clearTimeout(zipTimer);
      zipTimer = setTimeout(() => {
        fetch("https://api.zippopotam.us/us/" + encodeURIComponent(zip), { signal: AbortSignal.timeout(7000) })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            const p = j && j.places && j.places[0];
            zipCache.set(zip, p ? { city: p["place name"], state: p["state abbreviation"] } : null);
          })
          .catch(() => zipCache.set(zip, null))
          .then(() => { if (!exploring) render(); });
      }, 400);
    };
```

Note `render` is referenced before its `const render = () => {...}` declaration appears below; that is fine because `resolveZip` only runs from an event, long after the whole IIFE has executed.

- [ ] **Step 4: Resolve the zip intent inside render()**

In `index.html`, find:

```js
      // Explorer rows — only when the query doesn't resolve to a covered page.
      const p = parseExploreQuery(input.value.trim());
```

Replace with:

```js
      // Explorer rows — only when the query doesn't resolve to a covered page.
      let p = parseExploreQuery(input.value.trim());
      // A zip is an intent: swap in the resolved market, or ask for it once.
      if (p.reason === "zip") {
        if (zipCache.has(p.zip)) {
          const hit = zipCache.get(p.zip);
          p = hit
            ? (p.type ? { type: p.type, city: hit.city, state: hit.state }
                      : { reason: "no-type", city: hit.city, state: hit.state })
            : { reason: "bad-zip", zip: p.zip };
        } else {
          resolveZip(p.zip);
          p = { reason: "zip-pending", zip: p.zip };
        }
      }
```

- [ ] **Step 5: Add the two zip hint rows**

In `index.html`, find:

```js
      } else if (p.reason === "no-city" && !matches.length) {
        html += `<div class="px-3 py-1.5 text-[#68707E]">Search a market like “industrial Boise ID”</div>`;
      }
```

Replace with:

```js
      } else if (p.reason === "no-city" && !matches.length) {
        html += `<div class="px-3 py-1.5 text-[#68707E]">Search a market like “industrial Boise ID”</div>`;
      } else if (p.reason === "zip-pending" && !matches.length) {
        html += `<div class="px-3 py-1.5 text-[#68707E]">Looking up ${escq(p.zip)}…</div>`;
      } else if (p.reason === "bad-zip" && !matches.length) {
        html += `<div class="px-3 py-1.5 text-[#68707E]">We couldn't place the zip ${escq(p.zip)}. Try a market like “industrial Boise ID”</div>`;
      }
```

- [ ] **Step 6: Devlog entry**

Add as the FIRST element of the array in `devlog.json` (rebuild-don't-patch if another session's entry is in flight, per the shared-checkout skill):

```json
{
  "date": "2026-08-10",
  "type": "improvement",
  "title": "The Market Explorer stops demanding one exact phrasing",
  "details": "It used to accept only \"industrial Boise ID\", so a full state name, a zip code, an ordinary word like market or in, and the way most people name a property type all dead-ended in a hint row at the very top of the funnel. It now reads full state names including two-word ones, resolves a five-digit zip to its city, understands warehouse, apartments, multi-family, office building, shopping center and their neighbours, and ignores filler words. The state is resolved before filler words are dropped, which matters more than it sounds: eight state abbreviations are also English words, so stripping \"in\" first would quietly lose Indiana. Nothing auto-runs and the parsed market is still spelled out on the button before anything is searched, so a wrong guess is visible rather than expensive. The parsing moved into its own tested module, which is the first time any of this logic has had test coverage."
}
```

- [ ] **Step 7: Syntax checks and suite**

Run: `node --check server.js` then `npm test`
Expected: both clean. `test/index-html.test.js` vm-compiles index.html's inline script and is the syntax net for the edits above.

- [ ] **Step 8: Commit**

```bash
git status --short
git add server.js index.html devlog.json
git commit -m "Market Explorer: parse state names, zips, synonyms and filler words"
```

---

### Task 3: Browser verification

**Files:**
- None committed. This task produces a transcript only.

**Interfaces:**
- Consumes: Tasks 1 and 2 through a running server.
- Produces: a pass/fail transcript in the task report.

- [ ] **Step 1: Boot a local server**

Use the Browser pane's `preview_start`. If `.claude/launch.json` has no entry for this worktree, add one following the existing pattern (worktree `chdir`, blank `ANTHROPIC_API_KEY`, blank Supabase, `ACCOUNT_WALL=off`, `GUEST_SEARCH_LIMIT=off`, its own port). Blanking the API key is deliberate: nothing in this task may reach a billed search.

- [ ] **Step 2: Check five queries in the dropdown**

Open the app page, type each of these into the Market Explorer input (`#marketSearch`), and read the dropdown (`#marketSearchResults`) after each:

| Typed | Expected dropdown |
|---|---|
| `industrial Boise Idaho` | explore row reading "Industrial · Boise, ID" |
| `warehouse in Gary IN` | explore row reading "Industrial · Gary, IN" |
| `office building Tampa FL` | explore row reading "Office · Tampa, FL" |
| `83301` | briefly "Looking up 83301…", then the four type chips for "Twin Falls, ID" |
| `00000` | "We couldn't place the zip 00000" |

The zip rows are the ones that need real waiting: the debounce is 400ms plus the network round trip.

- [ ] **Step 3: Confirm nothing auto-ran**

Read the browser's network log for the whole session: there must be ZERO `POST /api/explore-market` requests. Typing must never start a search; only clicking the explore row does. If any appear, the task fails.

- [ ] **Step 4: Confirm one explore row still works end to end**

Click the explore row for `industrial Boise Idaho`. With the API key blank, the expected result is the red failure row reading that the server is missing the ANTHROPIC_API_KEY environment variable, which proves the click posted the parsed market and reached the server. Confirm exactly one `POST /api/explore-market` in the network log at that point.

- [ ] **Step 5: Record the transcript**

Write the observed dropdown text for all five queries, the network-log counts from Steps 3 and 4, and any console errors into the task report. Stop the server when finished.

---

## Self-Review Notes

- Spec coverage: the module and its exports (Task 1), the parse order including pairs-before-exact and state-before-fillers (Task 1 Step 3, pinned by tests in Step 1), the empty-city guard (both), the zip flow with debounce and null-caching (Task 2 Steps 3-5), `STATIC_FILES` at `maxAge: 0` (Task 2 Step 1), the untouched server contract (no task changes a route), "nothing auto-runs" (Task 3 Step 3 verifies it), and the devlog entry (Task 2 Step 6).
- Names are consistent across tasks: `EXPLOREQ`, `parseExploreQuery`, `EXPLORE_TYPES`, `zipCache`, `resolveZip`, and the reasons `zip` / `zip-pending` / `bad-zip`.
- The two new reasons (`zip-pending`, `bad-zip`) are created and consumed entirely in Task 2, never returned by the module, which is why they are absent from Task 1's tests.
- No placeholders: every step carries its exact code, command, or expected output.
