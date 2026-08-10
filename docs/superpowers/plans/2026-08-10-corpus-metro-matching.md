# Corpus Metro Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a search in one city draw on comps already harvested in its neighboring cities, as extra candidates only, never as a reason to search less.

**Architecture:** A curated `METRO_GROUPS` table plus `metroOf`/`siblingMarkets` in the pure `market.js`. `retrieveCorpusComps` makes one extra read for the sibling markets and returns them in a separate `nearby` list, leaving `coverage` (and therefore the search budget) exact-market only. `buildPrompt` gains a second, separately-worded corpus block for those rows. Spec: `docs/superpowers/specs/2026-08-10-corpus-metro-matching-design.md`.

**Tech Stack:** Plain Node, `node --test`, PostgREST query strings, zero npm dependencies.

## Global Constraints

- **`coverage` keeps its exact-market meaning.** `corpusIsStrong` and `searchBudgetFor` are untouched, so nearby rows can never shrink the search budget. This is by construction, not by anyone remembering to check.
- **`corpusRowsForMarket`'s behavior must not change for its existing callers.** It has FIVE call sites — corpus-first retrieval, the watchlist feed, the vault gut check's benchmarks, `/api/corpus-comps` (the in-report "From CompNinja's records" offer), and the Address Explorer. Only retrieval widens. Widening the shared function would silently put nearby-city comps into four user-facing surfaces the spec says do not change.
- **The single-market query stays byte-identical** (`market=eq.<x>`). Local dev has no database, so the widened `in.()` form can only ever be exercised in production; keeping the existing path untouched means a malformed widened query costs the feature and breaks nothing.
- **Nearby rows pass the same usability bar as exact ones**: provenance better than `estimate`/`news`, a parseable price, and a deal date inside the requested lookback.
- Rollback is `CORPUS_METRO=off` (default ON), matching the `PARALLEL_SEARCH` env-flag pattern: `/^(1|on|true|yes)$/i` against the env value, but defaulting to on when unset.
- The `source: "corpus"` analytics tag, the 75-day freshness gate, `harvestComps`, and all UI are unchanged. No migration.
- Zero npm dependencies; no em dashes in new prose or comments; shared checkout: explicit paths only, never `git add -A`.
- Portable node if off PATH: `C:\Users\JacobAdler\AppData\Local\node-portable\node-v24.16.0-win-x64\node.exe`.

---

### Task 1: `METRO_GROUPS` in market.js (TDD)

**Files:**
- Modify: `market.js` (add the table and two functions above the `module.exports` line; extend the exports)
- Test: `test/market.test.js` (append)

**Interfaces:**
- Produces: `metroOf(marketKey) -> string | null`, `siblingMarkets(marketKey) -> string[]`, and `METRO_GROUPS`. Task 2 consumes `siblingMarkets` via the existing `require("./market")`.

- [ ] **Step 1: Write the failing tests** (append to `test/market.test.js`, matching that file's existing style)

```js
test("metroOf returns the metro for a member city and null otherwise", () => {
  assert.equal(MARKET.metroOf("Meridian, ID"), "Boise, ID");
  assert.equal(MARKET.metroOf("Boise, ID"), "Boise, ID");
  assert.equal(MARKET.metroOf("Pocatello, ID"), null);
  assert.equal(MARKET.metroOf("Nowhere, XX"), null);
  assert.equal(MARKET.metroOf(""), null);
  assert.equal(MARKET.metroOf(null), null);
});

test("metroOf tolerates casing and spacing variants of a real key", () => {
  assert.equal(MARKET.metroOf("meridian, id"), "Boise, ID");
  assert.equal(MARKET.metroOf("  Meridian,ID "), "Boise, ID");
});

test("siblingMarkets excludes the market itself and is empty when ungrouped", () => {
  const sibs = MARKET.siblingMarkets("Meridian, ID");
  assert.ok(sibs.includes("Boise, ID"));
  assert.ok(sibs.includes("Nampa, ID"));
  assert.ok(!sibs.includes("Meridian, ID"));
  assert.deepEqual(MARKET.siblingMarkets("Pocatello, ID"), []);
  assert.deepEqual(MARKET.siblingMarkets(null), []);
});

// The trap this catches: the corpus is keyed by marketOf's output, and the
// lookup is an exact string match. A typo or a lowercase city in the table
// simply never matches, and the feature looks like it works while doing
// nothing at all.
test("every METRO_GROUPS entry is exactly what marketOf produces for it", () => {
  for (const [metro, members] of Object.entries(MARKET.METRO_GROUPS)) {
    assert.equal(MARKET.marketOf(metro), metro, `metro key ${metro}`);
    for (const m of members) {
      assert.equal(MARKET.marketOf(m), m, `member ${m} of ${metro}`);
    }
  }
});

test("no city belongs to two metros", () => {
  const seen = new Set();
  for (const members of Object.values(MARKET.METRO_GROUPS)) {
    for (const m of members) {
      assert.ok(!seen.has(m), `${m} appears in two groups`);
      seen.add(m);
    }
  }
});
```

If `test/market.test.js` imports the module under a different name than `MARKET`, use that file's existing name instead of adding a second import.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/market.test.js`
Expected: FAIL on `MARKET.metroOf is not a function`.

- [ ] **Step 3: Implement** (in `market.js`, above `module.exports`)

```js
// ---------------------------------------------------------------------------
// Metro groups. Corpus-first retrieval uses these to offer a thin market the
// comps we already hold in its immediate neighbors: a Meridian search sees
// Boise's rows rather than starting cold ten miles away.
//
// THE RULE FOR ADDING A GROUP: adjacent suburbs that genuinely share one CRE
// submarket, never a whole census statistical area. A group that is too wide
// hands a search comps from thirty miles away, which is worse than no corpus
// help at all. Every key and member must be exactly what marketOf() produces
// (title-cased city, uppercase state); a test pins that, because an exact
// string match that never matches is invisible.
//
// Deliberately short. Grow it when traffic shows a market that needs it, one
// reviewed group at a time.
// ---------------------------------------------------------------------------
const METRO_GROUPS = {
  // The owner's home market: small adjacent cities that trade as one.
  "Boise, ID": ["Boise, ID", "Meridian, ID", "Nampa, ID", "Caldwell, ID",
    "Eagle, ID", "Garden City, ID", "Star, ID", "Kuna, ID"],
  // Inland Empire warehouse corridor: one industrial market in practice, and
  // the site's deepest seeded coverage. Riverside is deliberately NOT here;
  // it is its own submarket and has its own seeded page.
  "Ontario, CA": ["Ontario, CA", "Rancho Cucamonga, CA", "Fontana, CA",
    "Rialto, CA", "Jurupa Valley, CA", "Eastvale, CA", "Mira Loma, CA"],
  // The Valley. The widest group here and so the first one to trim if
  // marketMatchRate drops after this ships.
  "Phoenix, AZ": ["Phoenix, AZ", "Tempe, AZ", "Mesa, AZ", "Chandler, AZ",
    "Glendale, AZ", "Tolleson, AZ", "Goodyear, AZ", "Avondale, AZ"],
};

// Reverse index, built once: "Meridian, ID" -> "Boise, ID".
const METRO_OF = {};
for (const [metro, members] of Object.entries(METRO_GROUPS)) {
  for (const m of members) METRO_OF[m] = metro;
}

// Normalizes through marketOf so a caller's casing or spacing cannot miss.
function metroOf(marketKey) {
  const key = marketOf(marketKey);
  return METRO_OF[key] || null;
}

// The other members of this market's metro. Empty for an ungrouped market,
// which is what keeps the caller's behavior identical to today.
function siblingMarkets(marketKey) {
  const key = marketOf(marketKey);
  const metro = METRO_OF[key];
  if (!metro) return [];
  return METRO_GROUPS[metro].filter((m) => m !== key);
}
```

Change the export line to:

```js
module.exports = { marketOf, marketForLog, US_STATES, METRO_GROUPS, metroOf, siblingMarkets };
```

- [ ] **Step 4: Run green, then the whole suite**

Run: `node --test test/market.test.js`, then `npm test`. All pass.

- [ ] **Step 5: Commit**

```bash
git status --short
git add market.js test/market.test.js
git commit -m "market.js: metro groups, so a thin market can see its neighbors"
```

---

### Task 2: widened retrieval (server.js), prompt untouched

**Files:**
- Modify: `server.js` (the `require("./market")` destructure near line 70; a new `CORPUS_METRO` const beside `PARALLEL_SEARCH` at ~line 1802; `corpusRowsForMarket` at ~line 1628; `retrieveCorpusComps` at ~line 1728; the log line at ~line 9096)

**Interfaces:**
- Consumes: Task 1's `siblingMarkets`.
- Produces: `retrieveCorpusComps` returning `{ comps, coverage, fresh, nearby, nearbyCount }`, where `coverage` counts EXACT-market usable rows only and `nearby` is an array of usable nearby rows. Task 3 reads `corpus.nearby`.

- [ ] **Step 1: Import the new helper**

The existing line is:

```js
const { marketOf, marketForLog, US_STATES } = require("./market");
```

Change to:

```js
const { marketOf, marketForLog, US_STATES, siblingMarkets } = require("./market");
```

- [ ] **Step 2: Add the flag** (immediately below the `PARALLEL_SEARCH` const)

```js
// Corpus metro matching: offer a thin market the comps we hold in its
// immediate neighbors (market.js's METRO_GROUPS). Candidates only, never a
// reason to search less. Default ON; `off` restores exact-market matching.
const CORPUS_METRO = !/^(0|off|false|no)$/i.test(String(process.env.CORPUS_METRO || ""));
```

- [ ] **Step 3: Split `corpusRowsForMarket` into a multi-market form**

Replace the existing function with these two, keeping the surrounding comment:

```js
async function corpusRowsForMarkets(markets, property_type, limit) {
  const wanted = (Array.isArray(markets) ? markets : [markets]).filter(Boolean);
  if (!wanted.length) return [];
  let dbRows = [];
  if (DB_CONFIGURED) {
    try {
      // The single-market form stays byte-identical to what has always
      // shipped. Local dev has no database, so the in.() form below can only
      // be exercised in production; keeping the common path untouched means a
      // malformed widened query costs the nearby rows and nothing else.
      // Market keys CONTAIN A COMMA ("Boise, ID"), which is also PostgREST's
      // in.() separator, so each value is quoted and percent-encoded while the
      // separators stay literal.
      const filter = wanted.length === 1
        ? `market=eq.${encodeURIComponent(wanted[0])}`
        : `market=in.(${wanted.map((m) => `"${encodeURIComponent(String(m))}"`).join(",")})`;
      dbRows = await sbRequest("GET",
        `comp_corpus?${filter}&property_type=eq.${encodeURIComponent(property_type)}` +
        `&select=ts,address,transaction,deal_date,size_sqft,price_or_rate,price_per_sqft,cap_rate,` +
        `${ALL_TYPE_COMP_FIELDS.join(",")},market,source_url,source_type,verified&order=ts.desc&limit=${limit}`) || [];
    } catch (e) { noteCorpusFailure("read", e); }
  }
  const want = new Set(wanted);
  const fileRows = (await readRowsFromFile(COMP_CORPUS_FILE))
    .filter((r) => r && want.has(r.market) && r.property_type === property_type);
  return [...dbRows, ...fileRows]
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, limit);
}

// One watched market. Unchanged contract: every existing caller (the
// watchlist feed, the vault gut check, /api/corpus-comps, the Address
// Explorer) gets exactly the rows it always did.
async function corpusRowsForMarket(market, property_type, limit) {
  return corpusRowsForMarkets([market], property_type, limit);
}
```

Note the added `market` column in the `select`: the caller needs each row's own market to tell exact from nearby, and to name the cities in the prompt. It is an existing column, so no migration.

- [ ] **Step 4: Split retrieval into exact and nearby**

In `retrieveCorpusComps`, the body currently starts:

```js
    const rows = await corpusRowsForMarket(market, type, 300);
    if (!rows.length) return { comps: [], coverage: 0, fresh: false };
```

Replace with:

```js
    const sibs = CORPUS_METRO ? siblingMarkets(market) : [];
    const rows = await corpusRowsForMarket(market, type, 300);
    // A second, separate read so the shared single-market helper keeps its
    // exact contract for its four other callers.
    const nearbyRows = sibs.length ? await corpusRowsForMarkets(sibs, type, 300) : [];
    if (!rows.length && !nearbyRows.length) return { comps: [], coverage: 0, fresh: false, nearby: [], nearbyCount: 0 };
```

The `usable` filter stays exactly as written. Below it, add the same filter over the nearby rows by extracting the predicate first. Replace:

```js
    const usable = rows.filter((r) => {
```

with:

```js
    const isUsable = (r) => {
```

and close that function with `};` instead of `});`, then immediately after it:

```js
    const usable = rows.filter(isUsable);
    // Nearby rows clear the identical bar: provenance better than estimate or
    // news, a parseable price, and a deal date inside the requested window.
    const nearbyUsable = nearbyRows.filter(isUsable);
```

Then the freshness line stays as-is (it reads `rows[0]`, i.e. the exact market's newest harvest, which is correct: nearby rows must never make a stale market look fresh). Finally, replace the return with:

```js
    return {
      comps: usable.slice(0, maxComps * 2),
      // coverage stays EXACT-market only: corpusIsStrong and the search budget
      // read it, and nearby rows must never buy a smaller budget.
      coverage: usable.length,
      fresh,
      nearby: nearbyUsable.slice(0, maxComps),
      nearbyCount: nearbyUsable.length,
    };
```

Also update the two early-return shapes at the top of the function and in the `catch` so every exit carries the same keys: add `nearby: [], nearbyCount: 0` to both.

- [ ] **Step 5: Log the nearby count**

The existing log line reads:

```js
        if (corpusIsStrong(corpus)) {
          console.log(`Corpus-assisted search: ${corpus.coverage} known comp(s) for ${marketOf(addressOk)} — ${typeOk}`);
        }
```

Add, immediately after that block:

```js
        if (corpus.nearbyCount) {
          console.log(`Corpus metro: offering ${corpus.nearbyCount} nearby comp(s) from ${[...new Set(corpus.nearby.map((r) => r.market))].join(", ")} (candidates only, budget unchanged)`);
        }
```

- [ ] **Step 6: Syntax + suite**

Run: `node --check server.js`, then `npm test`.

- [ ] **Step 7: Prove retrieval widened, for free**

The `!API_KEY` guard sits BEFORE corpus retrieval, so a blank key cannot reach it. Use an INVALID key instead: the request passes validation, runs corpus retrieval and logs, then fails at Anthropic's auth check, which bills nothing.

Seed a local corpus file in the worktree, `comp-corpus.jsonl`, with three Boise Industrial rows (one JSON object per line, no trailing comma):

```json
{"ts":"2026-08-01T00:00:00.000Z","dedupe_key":"seed1","property_type":"Industrial","market":"Boise, ID","address":"3000 S Federal Way, Boise, ID","transaction":"Sale","deal_date":"2026-05-01","size_sqft":"40,000","price_or_rate":"$5,200,000","price_per_sqft":"$130","source_type":"public_record","source_url":"https://example.gov/1","verified":false}
{"ts":"2026-08-01T00:00:00.000Z","dedupe_key":"seed2","property_type":"Industrial","market":"Boise, ID","address":"1450 W Amity Rd, Boise, ID","transaction":"Sale","deal_date":"2026-04-01","size_sqft":"22,000","price_or_rate":"$2,900,000","price_per_sqft":"$132","source_type":"listing","source_url":"https://example.com/2","verified":false}
{"ts":"2026-08-01T00:00:00.000Z","dedupe_key":"seed3","property_type":"Industrial","market":"Boise, ID","address":"600 E 42nd St, Garden City, ID","transaction":"Sale","deal_date":"2026-03-01","size_sqft":"15,000","price_or_rate":"$1,950,000","price_per_sqft":"$130","source_type":"public_record","source_url":"https://example.gov/3","verified":false}
```

Start the server from the worktree with an invalid key and no database:

```
ANTHROPIC_API_KEY=sk-ant-invalid-for-local-check
SUPABASE_URL=""  SUPABASE_SERVICE_KEY=""
ACCOUNT_WALL=off  GUEST_SEARCH_LIMIT=off  PORT=3172
```

(Use a `node -e` launcher that sets `process.env` explicitly, as `.claude/launch.json` does; in PowerShell `$env:X = ""` deletes the variable rather than emptying it, which would let the worktree `.env` refill it.)

POST a Meridian Industrial search and read the server log:

```bash
curl -s -X POST localhost:3172/api/comps -H 'content-type: application/json' \
  -d '{"address":"1500 E Fairview Ave, Meridian, ID","type":"Industrial","months":24,"maxComps":12}'
```

Record in the report: the `Corpus metro: offering 3 nearby comp(s) from Boise, ID, Garden City, ID` line appears; NO `Corpus-assisted search:` line appears (exact coverage is 0, so the budget is not cut, which is the whole point); and the request ends at the Anthropic auth failure with no billed call. Then repeat with `CORPUS_METRO=off` and confirm the nearby line is gone. Delete the seeded `comp-corpus.jsonl` and stop the server.

- [ ] **Step 8: Commit**

```bash
git status --short
git add server.js
git commit -m "Corpus retrieval reads neighboring markets as separate candidates"
```

---

### Task 3: the nearby prompt block

**Files:**
- Modify: `server.js` (`buildPrompt`'s signature and its `corpusBlock` region at ~line 3010; the two `buildPrompt(...)` call sites inside `callAnthropicOnce` at ~line 3693)

**Interfaces:**
- Consumes: Task 2's `corpus.nearby` (array of corpus rows, each carrying `market`, `address`, `transaction`, `deal_date`, `size_sqft`, `price_or_rate`, `price_per_sqft`, `cap_rate`, `source_url`).
- Produces: the report's prompt gains a second corpus block when nearby rows exist.

- [ ] **Step 1: Add the parameter**

`buildPrompt`'s signature currently reads:

```js
function buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpusComps, subjectDetails, lane = "solo") {
```

Add `corpusNearby` directly after `corpusComps` (a new positional keeps every existing parameter's meaning unchanged):

```js
function buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpusComps, corpusNearby, subjectDetails, lane = "solo") {
```

- [ ] **Step 2: Add the block**

Immediately after the existing `const corpusBlock = ... : "";` add:

```js
  // Nearby-metro rows get their OWN block rather than joining the list above,
  // so that block's closing rule ("never include one that is clearly in a
  // different city or submarket") stays intact and absolute for exact-market
  // comps. Widening retrieval without this would hand the model rows and then
  // tell it to discard them.
  const nearbyBlock = (corpusNearby && corpusNearby.length) ? [
    ``,
    `NEARBY COMPS (${[...new Set(corpusNearby.map((c) => c.market).filter(Boolean))].join(", ")}): our prior research surfaced these in cities immediately neighboring the target, in the same metro area. They are already sourced.`,
    ...corpusNearby.map((c, i) =>
      `${i + 1}. ${c.address} | ${c.transaction || "transaction type unknown"} | ${c.deal_date || "date unknown"} | ${c.size_sqft ? c.size_sqft + " SF" : "size unknown"} | ${c.price_or_rate || "price unknown"}${c.price_per_sqft ? " | " + c.price_per_sqft + "/SF" : ""}${c.cap_rate ? " | cap " + c.cap_rate : ""}${typeSpecsOf(c)}${c.source_url ? " | " + c.source_url : ""}`),
    `Use these only when the target's own city is thin on genuinely comparable transactions, and only for ones a buyer would actually weigh against the target. Report each address exactly as given so the report shows the city the comp is really in; never restate it as the target's city. Set "verified": false on these, and keep the source_url. Prefer a comp in the target's own city over one of these whenever both are comparable.`,
  ].join("\n") : "";
```

- [ ] **Step 3: Place the block in the returned prompt**

Find `corpusBlock` in the returned array (inside the `return [ ... ].join("\n")` at the end of `buildPrompt`) and add `nearbyBlock` on the line immediately after it, so the nearby list always follows the exact-market list.

- [ ] **Step 4: Update both call sites**

Inside `callAnthropicOnce` there are two `buildPrompt(...)` calls (the lane-aware one used by the parallel split, and the solo one). Both currently pass `corpus && corpus.comps` in the `corpusComps` position. In each, add the nearby argument directly after it:

```js
corpus && corpus.comps, corpus && corpus.nearby,
```

The records lane is called with `{ comps: [] }` as its corpus, so `corpus.nearby` is `undefined` there and the block is correctly omitted. Verify by reading both call sites that the argument order after the insertion still lines up with the signature (`subjectDetails` then `lane`).

- [ ] **Step 5: Syntax + suite**

Run: `node --check server.js`, then `npm test`.

- [ ] **Step 6: Prove it end to end (ONE billed search, about $0.36)**

This is the one check that shows the model actually uses a nearby comp and reports its true city, which is the whole risk of the prompt change. Re-seed the same three Boise rows into the worktree's `comp-corpus.jsonl`, start the server from the worktree with the REAL key from its `.env` and no database (`SUPABASE_URL`/`SUPABASE_SERVICE_KEY` blank, `ACCOUNT_WALL=off`, `GUEST_SEARCH_LIMIT=off`, `PORT=3172`), then run the same Meridian Industrial search from Task 2 Step 7 and save the JSON response.

Record in the report: whether any returned comp matches one of the three seeded Boise/Garden City addresses; that any such comp's `address` still says Boise or Garden City rather than Meridian; the total comp count; and the `Corpus metro:` log line. A run where the model used none of them is an acceptable outcome to record, not a failure to fix: the prompt says to prefer the target's own city, and Meridian may simply have had enough of its own. Do not re-run to chase a better result. Delete the seeded corpus file and stop the server afterward.

- [ ] **Step 7: Commit**

```bash
git status --short
git add server.js
git commit -m "Prompt: a separate, narrower block for nearby-metro comps"
```

---

### Task 4: docs + devlog + spec correction

**Files:**
- Modify: `CLAUDE.md` (the corpus-first retrieval paragraph, which states the exact-match rule as absolute)
- Modify: `docs/superpowers/specs/2026-08-10-corpus-metro-matching-design.md` (one paragraph)
- Modify: `devlog.json` (append one entry)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1-3.

- [ ] **Step 1: CLAUDE.md**

That paragraph currently says: "Because the key is `marketOf(address)` and matched with a **case-sensitive** `eq`, the write side (`harvestComps` files each comp under `marketOf(comp.address)`) and the read side (`marketOf(subject.address)`) must agree exactly". Keep that sentence (it is still true of the write side and of every other reader) and append:

> **Metro matching (2026-08-10).** Corpus-first retrieval, and ONLY it, also reads the subject market's immediate neighbors from `market.js`'s curated `METRO_GROUPS`, so a Meridian search can draw on Boise's rows. Those come back as a separate `nearby` list and get their own prompt block, worded more narrowly than the exact-market one (use only when the target's own city is thin, report the address exactly as given, prefer a same-city comp when both are comparable) — the exact-market block's "never include one clearly in a different city" rule stays intact and absolute. **`coverage` remains exact-market only**, so `corpusIsStrong` and the search budget cannot be moved by a nearby row; that is the whole safety property, and it is why the two counts are kept separate rather than summed. `corpusRowsForMarket` itself is UNCHANGED for its four other callers (watchlist feed, vault gut check, `/api/corpus-comps`, Address Explorer) — retrieval calls the new `corpusRowsForMarkets` directly instead. Rollback is `CORPUS_METRO=off`. Adding a metro group is a data edit in `market.js`; the rule is adjacent suburbs sharing one submarket, never a whole statistical area, and a test pins every entry against `marketOf` because an exact-match key that never matches is invisible.

- [ ] **Step 2: Correct the spec**

The spec's "### `corpusRowsForMarket` (server.js)" subsection says that function widens. It does not: it has five callers and only retrieval may widen. Replace that subsection's body with:

> A new `corpusRowsForMarkets(markets, property_type, limit)` does the widened read (`market=in.(…)`, values quoted and percent-encoded because a market key contains a comma), and `corpusRowsForMarket` becomes a one-line delegate so its four other callers — the watchlist feed, the vault gut check, `/api/corpus-comps`, and the Address Explorer — keep exactly the rows they always got. The single-market path still emits the identical `market=eq.` query, so the widened form, which local dev cannot exercise without a database, can only ever cost the nearby rows and never the existing behavior.

- [ ] **Step 3: devlog entry**

Append to `devlog.json` (surgical edit, clean UTF-8, validate it parses and the mojibake-pattern count is unchanged):

```json
{ "date": "2026-08-10", "type": "improvement",
  "title": "A thin market can borrow its neighbors' comps",
  "details": "Searches in a small city now draw on comps already gathered in the cities immediately around it, so a Meridian report can start from what we know about Boise instead of from nothing. They are offered as candidates only: the model is told to prefer a comp in the target's own city, to use a neighbor only when the target is thin, and to report each address exactly as it stands, so the report always shows where a comp really is. The number of live searches a report runs is unchanged." }
```

- [ ] **Step 4: Verify + commit**

Run `npm test`, the devlog JSON parse check, then:

```bash
git status --short
git add CLAUDE.md devlog.json docs/superpowers/specs/2026-08-10-corpus-metro-matching-design.md
git commit -m "Document corpus metro matching"
```

---

## Post-merge (owner-triggered)

Deploy via the `deploy` skill. `CORPUS_METRO` needs no Render change (it defaults on). The live signal is the `Corpus metro:` log line appearing on searches in grouped markets; the risk signal is comps from a neighboring city showing up where the target's own city had plenty, which is what the prompt's "prefer a same-city comp" rule exists to prevent. If it misbehaves, `CORPUS_METRO=off` in Render reverts it without a deploy.

## Self-review notes

- Spec coverage: the table and its discipline plus the round-trip test (Task 1), the widened read without disturbing the four other callers (Task 2 Step 3), the exact/nearby split with `coverage` unchanged (Task 2 Step 4), the flag (Task 2 Step 2), the separate prompt block and its narrower wording (Task 3), unchanged budget/analytics/freshness/harvest/UI (nothing in the plan touches them), rollback and measurement notes (Post-merge, CLAUDE.md), testing including the free retrieval proof and the single billed end-to-end check (Task 2 Step 7, Task 3 Step 6).
- Type consistency: `siblingMarkets(marketKey) -> string[]` and `corpusRowsForMarkets(markets, property_type, limit)` used identically across tasks; `retrieveCorpusComps`'s returned keys (`comps`, `coverage`, `fresh`, `nearby`, `nearbyCount`) match what Task 3 reads and what the log line uses; every early return carries all five keys.
- Placeholder scan: clean.
- Two judgment calls a reviewer should weigh: the three metro groups are my curation, and the Phoenix group is the widest and least defensible (the table's own comment says to trim it first); and Task 3's billed check has no guaranteed outcome, which the step states explicitly so nobody re-runs it chasing a nicer answer.
