# Corpus Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, deterministic structural audit of the comp corpus that reports weak citations, badge drift, shared citations and unparseable rows on `/admin`, without fetching any page or calling any model.

**Architecture:** A new pure module `corpus-audit.js` (no I/O, no clock, no requires) holds every rule, exactly like `entitlements.js` and `comp-gate.js`. The badge-enforcement rule moves out of `server.js` into that module so `normalizeSourceTypes` and the audit share one copy instead of two. `server.js` owns the reads and exposes `GET /api/corpus-audit`, gated by `isAdminRequest`, memoized 60 seconds. `/admin` renders a neutral panel from a second fetch, mirroring the existing `loadSubs` pattern.

**Tech Stack:** Plain Node (no dependencies), CommonJS modules, `node --test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-05-corpus-audit-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `corpus-audit.js` (create) | Every audit rule. Pure and total: no throw on malformed input. Also the single home of `AGGREGATE_ADDRESS_RE`, `isAggregateAddress` and the new `enforcedSourceType`. |
| `test/corpus-audit.test.js` (create) | Rule coverage, including the false positives found while designing. |
| `server.js` (modify) | Delete the local aggregate-address and badge-enforcement code, require the module, add the corpus read helper, the route, and the `/admin` panel. |
| `devlog.json` (modify) | One entry, per the standing rule. |

A note on why the refactor is in scope: check 2 needs the badge rule, and a second copy of it is exactly the failure mode CLAUDE.md warns about for `compWeight` and `exportReportKey`. Moving it removes a duplication risk rather than adding one, and brings the rule under test for the first time.

---

## Task 1: Module skeleton and `enforcedSourceType`

This is the rule `server.js` will delegate to in Task 4, so it comes first and must reproduce today's behavior exactly.

**Files:**
- Create: `corpus-audit.js`
- Create: `test/corpus-audit.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/corpus-audit.test.js`:

```js
// Corpus audit — the structural integrity rules for the comp corpus.
//
// Run: npm test
//
// Every case here is drawn from a real corpus row or a real false positive
// found while designing the feature. Nothing touches a database or a network.

const test = require("node:test");
const assert = require("node:assert");

const { enforcedSourceType, isAggregateAddress } = require("../corpus-audit");

test("enforcedSourceType coerces unknown values onto the enum", () => {
  assert.equal(enforcedSourceType("costar flyer", "100 Main St, Dallas, TX"), "listing");
  assert.equal(enforcedSourceType("county assessor", "100 Main St, Dallas, TX"), "public_record");
  assert.equal(enforcedSourceType("press release", "100 Main St, Dallas, TX"), "news");
  assert.equal(enforcedSourceType("who knows", "100 Main St, Dallas, TX"), "estimate");
});

test("enforcedSourceType keeps an exact enum value", () => {
  assert.equal(enforcedSourceType("listing", "100 Main St, Dallas, TX"), "listing");
});

test("enforcedSourceType forces estimate when the address has no street number", () => {
  assert.equal(enforcedSourceType("listing", "Pocatello, ID (43,000 SF warehouse)"), "estimate");
});

test("enforcedSourceType forces estimate on an aggregate address", () => {
  assert.equal(enforcedSourceType("public_record", "100 Main St Market Median"), "estimate");
});

test("enforcedSourceType under-claims a hyphenated address range (known, recorded)", () => {
  // "7657-7695 S 5th Ave" is a genuine address range, but the street-number
  // test requires digits followed by whitespace. Under-claiming is the safe
  // direction, so this is pinned as current behavior, not fixed here.
  assert.equal(enforcedSourceType("listing", "7657-7695 S 5th Ave, Pocatello, ID"), "estimate");
});

test("isAggregateAddress catches statistic vocabulary, not bare street names", () => {
  assert.equal(isAggregateAddress("Market Median, Dallas, TX"), true);
  assert.equal(isAggregateAddress("123 Market St, Dallas, TX"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../corpus-audit'`

- [ ] **Step 3: Write the module**

Create `corpus-audit.js`:

```js
// ---------------------------------------------------------------------------
// Corpus audit — the structural integrity rules for the comp corpus.
//
// Deliberately PURE, like entitlements.js and comp-gate.js: no I/O, no fetch,
// no clock reads (the caller passes `now`), no require()s. That is what makes
// `npm test` able to exercise every rule with no database and no network.
//
// This module is also the ONE home of the badge-enforcement rule. It used to
// live inline in server.js's normalizeSourceTypes; the audit needs the same
// rule to detect drift, and a second copy is exactly the hazard CLAUDE.md
// flags for compWeight and exportReportKey.
//
// Scope note: nothing here reads a source_url over the network. Roughly half
// the corpus cites hosts that hard-block server-side fetching (measured
// 2026-08-05), so every check is structural on purpose.
// ---------------------------------------------------------------------------

"use strict";

const SOURCE_TYPES = ["public_record", "listing", "news", "estimate"];

// Keyed on aggregate VOCABULARY, not on address shape: plenty of genuine small
// multifamily and retail comps are listed without a street number ("Highland
// Park Triplex, Pittsburgh, PA"), so requiring one would discard real data.
// Street names survive too: "123 Market St" has no aggregate word, while
// "Market Median" does.
const AGGREGATE_ADDRESS_RE =
  /\b(benchmark|median|average|avg|composite|index|market (report|data|summary|stats?|statistics)|year[\s-]end (summary|report))\b/i;

function isAggregateAddress(address) {
  return AGGREGATE_ADDRESS_RE.test(String(address || ""));
}

// The street-number test, kept byte-identical to the regex that shipped in
// server.js on 2026-07-30. It rejects hyphenated ranges ("7657-7695 S 5th
// Ave"), which under-claims a real address. Under-claiming is the safe
// direction, so the audit COUNTS these rather than widening the rule here.
const STREET_NUMBERED_RE = /^\s*\d+\s+\S/;

// The single badge rule. Coerces a model-supplied source_type onto the enum,
// then enforces the individual-property requirement. Unknown maps to
// "estimate": the label may under-claim provenance, never over-claim it.
function enforcedSourceType(claimed, address) {
  const raw = String(claimed || "").toLowerCase();
  let type =
    SOURCE_TYPES.find((t) => raw === t) ||
    (/record|assessor|deed|tax|county|public/.test(raw) ? "public_record"
      : /list|broker|flyer|loopnet|crexi|costar/.test(raw) ? "listing"
      : /news|article|press|announc/.test(raw) ? "news"
      : "estimate");
  if (type !== "estimate" &&
      (!STREET_NUMBERED_RE.test(String(address || "")) || isAggregateAddress(address))) {
    type = "estimate";
  }
  return type;
}

module.exports = {
  enforcedSourceType,
  isAggregateAddress,
  AGGREGATE_ADDRESS_RE,
  SOURCE_TYPES,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all six new tests green, the existing 170 still green.

- [ ] **Step 5: Commit**

```bash
git add corpus-audit.js test/corpus-audit.test.js
git commit -m "corpus-audit: the badge rule, extracted and under test"
```

---

## Task 2: Citation specificity

**Files:**
- Modify: `corpus-audit.js`
- Modify: `test/corpus-audit.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/corpus-audit.test.js`:

```js
const { urlIdentifiesProperty } = require("../corpus-audit");

test("a listing id of five or more digits identifies the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "322 Griffith St, Pocatello, ID", source_url: "https://realmo.com/listing/12172862", source_type: "listing" }), true);
});

test("a search-results page does not identify the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "322 Griffith St, Pocatello, ID",
      source_url: "https://realmo.com/warehouses/for-lease/id/pocatello/", source_type: "listing" }), false);
});

test("a LoopNet market search page does not identify the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "Pocatello, ID (43,000 SF warehouse, built 1980)",
      source_url: "https://loopnet.com/idaho/pocatello_warehouses-for-lease", source_type: "listing" }), false);
});

test("street number plus a street-name token identifies the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "4502 Airport Dr, Ontario, CA",
      source_url: "https://example.com/listings/4502-airport-dr", source_type: "listing" }), true);
});

test("a four-digit year in the path is not a street-number match on its own", () => {
  // The Ontario flyer PDF sits under /2025-05/ and would otherwise "match"
  // the street number of an address like 2025 Main St.
  assert.equal(urlIdentifiesProperty(
    { address: "2025 Main St, Ontario, CA",
      source_url: "https://content.ontarioca.gov/sites/default/files/2025-05/For%20Lease.pdf",
      source_type: "listing" }), false);
});

test("a news article naming the market identifies its subject (looser rule)", () => {
  // Found as a false positive while designing: a legitimate article names the
  // deal without carrying the street number.
  assert.equal(urlIdentifiesProperty(
    { address: "1800 River Park Way, Pocatello, ID 83201",
      source_url: "https://rebusinessonline.com/cbre-arranges-sale-of-59-7-acre-industrial-site-in-pocatello-ida/",
      source_type: "news" }), true);
});

test("a missing or malformed url never throws and never counts as specific", () => {
  assert.equal(urlIdentifiesProperty({ address: "100 Main St", source_url: "" }), false);
  assert.equal(urlIdentifiesProperty({ address: "100 Main St", source_url: "not a url" }), false);
  assert.equal(urlIdentifiesProperty({}), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `urlIdentifiesProperty is not a function`

- [ ] **Step 3: Implement**

Add to `corpus-audit.js` above `module.exports`:

```js
// Directionals and street-type suffixes differ too often between a URL slug
// and what a broker types to be worth matching on.
const STREET_STOPWORDS = new Set(["north", "south", "east", "west", "northeast", "northwest",
  "southeast", "southwest", "street", "road", "avenue", "boulevard", "drive", "lane", "way",
  "court", "place", "parkway", "highway", "circle", "terrace", "trail", "loop", "suite", "unit"]);

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "") : "";
}

// Path only, lowercased, punctuation flattened to spaces so slug tokens and
// address tokens compare on equal terms.
function pathWordsOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(String(url || ""));
  if (!m) return "";
  return safeDecode(m[1] || "").toLowerCase();
}

function leadingNumber(address) {
  const m = /^\s*(\d+)/.exec(String(address || ""));
  return m ? m[1] : null;
}

function tokensOf(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((t) => t.length >= 4 && !STREET_STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// Does the citation point at THIS property? Three signals, combined so that
// no single weak one can pass:
//   idMatch     a bounded run of 5+ digits, i.e. a listing id
//   numberMatch the street number as a bounded digit token in the path
//   tokenMatch  a distinctive word from the address in the path
// The compound (numberMatch && street tokenMatch) defeats a real false
// positive: a four-digit year in a path would otherwise match the street
// number of "2025 Main St". News gets a looser rule because a legitimate
// article names the deal without carrying the street number.
function urlIdentifiesProperty(row) {
  const r = row || {};
  const path = pathWordsOf(r.source_url);
  if (!path) return false;
  const flat = path.replace(/[^a-z0-9]+/g, " ");

  if (/(^|[^0-9])\d{5,}([^0-9]|$)/.test(path)) return true;

  const streetLine = String(r.address || "").split(",")[0];
  const streetTokens = tokensOf(streetLine);
  const streetTokenMatch = streetTokens.some((t) => flat.indexOf(t) >= 0);

  const num = leadingNumber(r.address);
  const numberMatch = !!num && new RegExp("(^|[^0-9])" + num + "([^0-9]|$)").test(path);
  if (numberMatch && streetTokenMatch) return true;

  if (String(r.source_type || "").toLowerCase() === "news") {
    return tokensOf(r.address).some((t) => flat.indexOf(t) >= 0);
  }
  return false;
}
```

Add `urlIdentifiesProperty` and `hostOf` to `module.exports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add corpus-audit.js test/corpus-audit.test.js
git commit -m "corpus-audit: does the citation actually name the property"
```

---

## Task 3: `auditCorpus` and the remaining checks

**Files:**
- Modify: `corpus-audit.js`
- Modify: `test/corpus-audit.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/corpus-audit.test.js`:

```js
const { auditCorpus } = require("../corpus-audit");

// Stand-in for server.js's parseDealDate: a year, or null. Injected so the
// audit and retrieval can never disagree about what counts as a usable date.
const parseDealDate = (s) => (/^(19|20)\d{2}$/.test(String(s || "").trim()) ? Number(s) : null);
const OPTS = { now: Date.parse("2026-08-05T00:00:00Z"), parseDealDate };

const goodRow = {
  address: "4502 Airport Dr, Ontario, CA", market: "Ontario, CA", property_type: "Industrial",
  source_url: "https://example.com/listings/4502-airport-dr", source_type: "listing",
  deal_date: "2025", price_or_rate: "$4,000,000", price_per_sqft: "$120",
};

test("a clean corpus scores 1", () => {
  const out = auditCorpus([goodRow], OPTS);
  assert.equal(out.total, 1);
  assert.equal(out.clean, 1);
  assert.equal(out.score, 1);
  assert.equal(out.worst.length, 0);
});

test("an empty corpus scores cleanly instead of dividing by zero", () => {
  const out = auditCorpus([], OPTS);
  assert.equal(out.total, 0);
  assert.equal(out.score, 1);
  assert.deepEqual(out.worst, []);
});

test("badge_drift fires on a pre-enforcement unnumbered listing row", () => {
  const out = auditCorpus([{ ...goodRow, address: "Pocatello, ID (43,000 SF warehouse)" }], OPTS);
  assert.equal(out.findings.badge_drift, 1);
  assert.equal(out.worst[0].findings.includes("badge_drift"), true);
});

test("badge_drift does not fire when the stored badge is already estimate", () => {
  const out = auditCorpus([{ ...goodRow, address: "Pocatello, ID (warehouse)", source_type: "estimate" }], OPTS);
  assert.equal(out.findings.badge_drift, 0);
});

test("shared_citation fires when two distinct addresses cite one url", () => {
  const url = "https://loopnet.com/idaho/pocatello_warehouses-for-lease";
  const out = auditCorpus([
    { ...goodRow, address: "100 A St, Pocatello, ID", source_url: url },
    { ...goodRow, address: "200 B St, Pocatello, ID", source_url: url },
  ], OPTS);
  assert.equal(out.findings.shared_citation, 2);
});

test("shared_citation ignores one address repeated with different formatting", () => {
  const url = "https://example.com/listings/100-a-st";
  const out = auditCorpus([
    { ...goodRow, address: "100 A St, Pocatello, ID", source_url: url },
    { ...goodRow, address: "100 a st,  Pocatello,  ID", source_url: url },
  ], OPTS);
  assert.equal(out.findings.shared_citation, 0);
});

test("unparseable_date uses the injected parser", () => {
  const out = auditCorpus([{ ...goodRow, deal_date: "sometime last spring" }], OPTS);
  assert.equal(out.findings.unparseable_date, 1);
});

test("no_price fires only when neither price field carries a number", () => {
  const out = auditCorpus([{ ...goodRow, price_or_rate: "undisclosed", price_per_sqft: "" }], OPTS);
  assert.equal(out.findings.no_price, 1);
});

test("host classes are reported and never affect the score", () => {
  const out = auditCorpus([
    { ...goodRow, source_url: "https://www.loopnet.com/listings/98765432" },
    goodRow,
  ], OPTS);
  assert.equal(out.hosts.blocked, 1);
  assert.equal(out.hosts.fetchable, 1);
  assert.equal(out.score, 1, "a blocked host is context, not a finding");
});

test("worst is capped at 15 and ordered by finding count", () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ ...goodRow, address: "Nowhere " + i, source_url: "https://x.com/p", deal_date: "?" });
  }
  const out = auditCorpus(rows, OPTS);
  assert.equal(out.worst.length, 15);
  assert.ok(out.worst[0].findings.length >= out.worst[14].findings.length);
});

test("a malformed row yields findings instead of throwing", () => {
  const out = auditCorpus([null, {}, { address: 5, source_url: {} }], OPTS);
  assert.equal(out.total, 3);
  assert.ok(out.score < 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `auditCorpus is not a function`

- [ ] **Step 3: Implement**

Add to `corpus-audit.js` above `module.exports`:

```js
// Measured 2026-08-05: each of these answered 403 to a browser-User-Agent
// request. This is a snapshot of bot policy, not a fact about the data, which
// is why it is reported as context and never scored.
const BLOCKED_HOSTS = new Set([
  "loopnet.com", "cityfeet.com", "propertyshark.com", "commercialsearch.com",
]);

function normAddress(a) {
  return String(a == null ? "" : a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normUrl(u) {
  return String(u == null ? "" : u).trim().toLowerCase().replace(/\/+$/, "");
}

function hasPrice(row) {
  const num = (s) => {
    const t = String(s == null ? "" : s).replace(/[^0-9.]/g, "");
    return t !== "" && isFinite(Number(t)) && Number(t) > 0;
  };
  return num(row.price_or_rate) || num(row.price_per_sqft);
}

const FINDING_KEYS = ["weak_citation", "badge_drift", "shared_citation", "unparseable_date", "no_price"];

// Report-only by design: this returns findings and never mutates a row.
function auditCorpus(rows, opts) {
  const list = Array.isArray(rows) ? rows : [];
  const parseDealDate = (opts && opts.parseDealDate) || (() => null);

  // Pre-pass: how many DISTINCT addresses cite each url. Two comps sharing one
  // url is the strongest available tell of padding from a single page.
  const addressesPerUrl = new Map();
  for (const raw of list) {
    const r = raw || {};
    const u = normUrl(r.source_url);
    if (!u) continue;
    if (!addressesPerUrl.has(u)) addressesPerUrl.set(u, new Set());
    addressesPerUrl.get(u).add(normAddress(r.address));
  }

  const findings = {};
  FINDING_KEYS.forEach((k) => { findings[k] = 0; });
  const hosts = { fetchable: 0, blocked: 0, unknown: 0 };
  const flagged = [];
  let clean = 0;

  for (const raw of list) {
    const r = raw || {};
    const found = [];

    if (!urlIdentifiesProperty(r)) found.push("weak_citation");

    const stored = String(r.source_type || "").toLowerCase();
    const rank = (t) => {
      const i = SOURCE_TYPES.indexOf(t);
      return i === -1 ? SOURCE_TYPES.length : i;
    };
    // Lower index is stronger. Drift means the row claims more than today's
    // rule would grant it.
    if (SOURCE_TYPES.includes(stored) &&
        rank(stored) < rank(enforcedSourceType(stored, r.address))) {
      found.push("badge_drift");
    }

    const u = normUrl(r.source_url);
    if (u && (addressesPerUrl.get(u) || new Set()).size > 1) found.push("shared_citation");

    if (parseDealDate(r.deal_date) == null) found.push("unparseable_date");
    if (!hasPrice(r)) found.push("no_price");

    const host = hostOf(r.source_url);
    if (!host) hosts.unknown++;
    else if (BLOCKED_HOSTS.has(host)) hosts.blocked++;
    else hosts.fetchable++;

    if (found.length === 0) { clean++; continue; }
    found.forEach((k) => { findings[k]++; });
    flagged.push({
      address: String(r.address == null ? "" : r.address).slice(0, 120),
      market: String(r.market == null ? "" : r.market).slice(0, 60),
      property_type: String(r.property_type == null ? "" : r.property_type).slice(0, 30),
      source_type: String(r.source_type == null ? "" : r.source_type).slice(0, 20),
      source_url: String(r.source_url == null ? "" : r.source_url).slice(0, 160),
      findings: found,
    });
  }

  // Deterministic ordering: worst first, then by address so repeated runs on
  // unchanged data produce an identical list.
  flagged.sort((a, b) => (b.findings.length - a.findings.length) || a.address.localeCompare(b.address));

  return {
    total: list.length,
    clean,
    score: list.length ? clean / list.length : 1,
    findings,
    hosts,
    worst: flagged.slice(0, 15),
  };
}
```

Add `auditCorpus`, `BLOCKED_HOSTS` and `FINDING_KEYS` to `module.exports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add corpus-audit.js test/corpus-audit.test.js
git commit -m "corpus-audit: assemble the report"
```

---

## Task 4: Point `server.js` at the shared rule

Behavior-preserving refactor. No feature change, and the existing suite plus the new one is the proof.

**Files:**
- Modify: `server.js` (the require block near line 32; `AGGREGATE_ADDRESS_RE` and `isAggregateAddress` near lines 2090-2101; `normalizeSourceTypes` near lines 2753-2783)

- [ ] **Step 1: Add the require**

After the existing `const VAULT = require("./broker-vault");` line, add:

```js
// The corpus audit module also owns the badge-enforcement rule, so the audit
// and the live normalization can never drift apart.
const AUDIT = require("./corpus-audit");
const { isAggregateAddress } = AUDIT;
```

- [ ] **Step 2: Delete the now-duplicated definitions**

Remove the `AGGREGATE_ADDRESS_RE` constant and the `isAggregateAddress` function (near lines 2090-2101), keeping the explanatory comment block with the module instead. The other two call sites (`harvestComps` and the `mappable` filter) keep working through the destructured import.

- [ ] **Step 3: Replace the body of `normalizeSourceTypes`**

```js
// source_type drives a trust badge and lands in CSV exports, so stray model
// values are coerced onto the enum, and a comp that cannot be one verifiable
// transaction is forced to "estimate". Both halves live in corpus-audit.js so
// the audit can detect rows that predate a tightening of this rule.
function normalizeSourceTypes(parsed) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  for (const c of parsed.comps) {
    if (!c || typeof c !== "object") continue;
    c.source_type = AUDIT.enforcedSourceType(c.source_type, c.address);
  }
  return parsed;
}
```

Leave the `SOURCE_TYPES` constant in `server.js` only if another call site uses it. Check with:

```bash
grep -n "SOURCE_TYPES" server.js
```

If `normalizeSourceTypes` was its only consumer, delete it and rely on `AUDIT.SOURCE_TYPES` where needed.

- [ ] **Step 4: Verify nothing broke**

```bash
node --check server.js
npm test
```

Expected: no syntax errors, all tests pass.

- [ ] **Step 5: Verify the server still boots in a bare environment**

This is the same smoke CI runs, and it catches a bad require immediately.

```bash
PORT=3199 node -e "require('./server.js')" &
sleep 3 && curl -s localhost:3199/healthz && kill %1
```

Expected: `{"ok":true,...}`

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "One home for the badge rule: server.js delegates to corpus-audit"
```

---

## Task 5: `GET /api/corpus-audit`

**Files:**
- Modify: `server.js` (a read helper near `corpusRowsForMarket` at line 1439; the route beside `/api/stats` at line 10286)

- [ ] **Step 1: Add the read helper**

Place it directly after `corpusRowsForMarket`:

```js
// Whole-corpus read for the audit: no market or type filter, newest first,
// hard-capped. Selects only the columns the audit reads, so a missing per-type
// column cannot break it the way a `select *` would.
async function readCorpusRowsForAudit(limit) {
  let dbRows = [];
  if (DB_CONFIGURED) {
    try {
      dbRows = await sbRequest("GET",
        "comp_corpus?select=ts,market,property_type,address,deal_date," +
        `price_or_rate,price_per_sqft,source_url,source_type&order=ts.desc&limit=${limit}`) || [];
    } catch (e) { noteCorpusFailure("read", e); }
  }
  const fileRows = await readRowsFromFile(COMP_CORPUS_FILE);
  return [...dbRows, ...fileRows].slice(0, limit);
}

// Memoized 60s, following /api/pricing: this is a whole-table read and /admin
// is refreshed by hand.
const CORPUS_AUDIT_LIMIT = 2000;
let CORPUS_AUDIT_CACHE = { at: 0, data: null };
async function corpusAuditReport() {
  if (CORPUS_AUDIT_CACHE.data && Date.now() - CORPUS_AUDIT_CACHE.at < 60_000) {
    return CORPUS_AUDIT_CACHE.data;
  }
  const rows = await readCorpusRowsForAudit(CORPUS_AUDIT_LIMIT);
  const data = AUDIT.auditCorpus(rows, { now: Date.now(), parseDealDate });
  CORPUS_AUDIT_CACHE = { at: Date.now(), data };
  return data;
}
```

- [ ] **Step 2: Add the route**

Directly after the `/api/stats` route block:

```js
  // Corpus integrity, ADMIN_KEY-gated like /api/stats. Report-only: it reads
  // rows and changes nothing. Fails SAFE — any error answers "unavailable"
  // with a 200 so /admin still renders, since /admin is the page the owner
  // opens when something else is already wrong.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/corpus-audit") {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    const key = new URL(req.url, "http://localhost").searchParams.get("key");
    if (!isAdminRequest(req) && !secretMatches(key, ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });
    return corpusAuditReport()
      .then((data) => sendJson(res, 200, data))
      .catch((e) => { console.warn("Corpus audit failed:", e && e.message); sendJson(res, 200, { error: "unavailable" }); });
  }
```

- [ ] **Step 3: Verify by hand**

```bash
ADMIN_KEY=test-key-123 PORT=3117 node -e "require('./server.js')" &
sleep 3
curl -s -H "x-admin-key: test-key-123" localhost:3117/api/corpus-audit | head -c 400
echo; curl -s -o /dev/null -w "unauthorized gives %{http_code}\n" localhost:3117/api/corpus-audit
kill %1
```

Expected: a JSON body carrying `total`, `clean`, `score`, `findings`, `hosts`, `worst`; and `401` without the key. With the local `comp-corpus.jsonl` present, `total` should be 134.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "GET /api/corpus-audit: the integrity report, admin-gated and fail-safe"
```

---

## Task 6: The `/admin` panel

**Files:**
- Modify: `server.js` (the admin page script near lines 5547 and 5699-5713)

- [ ] **Step 1: Add the container**

Beside `<div id="dash" style="display:none"></div>` (line 5547), add:

```html
<div id="auditPanel"></div>
```

- [ ] **Step 2: Add the loader and renderer**

Next to `loadSubs` (line 5699), add:

```js
function pct(x){return Math.round(x*100);}
function renderAudit(d){
  var el=document.getElementById("auditPanel");
  if(!d||d.error){el.innerHTML="<div class=card><h2>Corpus integrity</h2>"+
    "<p class=muted>Unavailable right now. The corpus could not be read; nothing else on this page is affected.</p></div>";return;}
  if(!d.total){el.innerHTML="<div class=card><h2>Corpus integrity</h2>"+
    "<p class=muted>No corpus rows yet.</p></div>";return;}
  var f=d.findings||{},h=d.hosts||{};
  var labels={weak_citation:"Citation does not name the property",
    badge_drift:"Badge stronger than today's rule allows",
    shared_citation:"Same source cited by different addresses",
    unparseable_date:"Date will not parse, so retrieval cannot see it",
    no_price:"No usable price"};
  var lines=Object.keys(labels).map(function(k){
    return "<p class=muted>"+esc(f[k]||0)+" &middot; "+esc(labels[k])+"</p>";}).join("");
  var rows=(d.worst||[]).map(function(w){
    return "<p class=muted style='word-break:break-word'><b>"+esc(w.address)+"</b> ("+
      esc(w.property_type||"?")+", badge "+esc(w.source_type||"?")+")<br>"+
      esc(w.findings.join(", "))+"<br>"+esc(w.source_url)+"</p>";}).join("");
  el.innerHTML="<div class=card><h2>Corpus integrity</h2>"+
    "<p><b>"+pct(d.score)+"%</b> of "+esc(d.total)+" rows carry no structural finding.</p>"+
    "<p class=muted>This measures CITATION quality, not accuracy. It checks that a comp's "+
    "source link names the property; it does not read the page, and it is not the 90% accuracy gate.</p>"+
    lines+
    "<p class=muted>"+esc(h.blocked||0)+" of "+esc(d.total)+" rows cite hosts that block automated reading. "+
    "That is context only and does not affect the score.</p>"+
    (rows?"<h2 style='margin-top:12px'>Worst rows</h2>"+rows:"");
}
function loadAudit(key){
  fetch("/api/corpus-audit",{headers:{"x-admin-key":key}})
    .then(function(r){if(!r.ok){throw new Error("audit "+r.status);}return r.json();})
    .then(renderAudit)
    .catch(function(e){console.error(e);});
}
```

- [ ] **Step 3: Call it**

In `load()` (line 5713), change the `.then` body so the audit loads alongside the submissions:

```js
  }).then(function(d){if(key){try{sessionStorage.setItem(KEYK,key);}catch(e){} grantAdminAccess(key);} render(d); loadSubs(key); loadAudit(key);})
```

- [ ] **Step 4: Verify in the browser**

Start the server, open `/admin`, unlock with the key, and confirm the panel renders below the tiles with a percentage, five finding lines, the host context line, and a worst-rows list. Confirm no red styling is used: red stays reserved for the two outright-failure banners.

```bash
ADMIN_KEY=test-key-123 PORT=3117 node -e "require('./server.js')" &
```

Then use the preview tools against `http://localhost:3117/admin`, and check the console for errors.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "/admin: a corpus integrity panel, reported not enforced"
```

---

## Task 7: Devlog and ship

**Files:**
- Modify: `devlog.json`

- [ ] **Step 1: Add the entry**

`devlog.json` is a guaranteed collision in this shared checkout. Rebuild rather than patch: take `git show HEAD:devlog.json`, add only this entry, stage that, then restore the full working file (see `.claude/skills/shared-checkout`).

```json
{"date": "2026-08-05", "type": "feature", "title": "The corpus now gets audited for structural integrity", "details": "Nothing had ever measured whether the rows in the comp corpus are sound, even though broker verification, corpus-first retrieval and the in-report records offer all build on them. A new Corpus integrity panel on Analytics reports five structural findings per row: a source link that does not name the property, a badge stronger than today's rule would grant, one source cited by several different addresses, a date that will not parse (so retrieval can never surface the row), and a missing price. Measured against the real corpus first, which changed the design: roughly half the rows cite hosts that hard-block automated reading (LoopNet, CityFeet, PropertyShark and CommercialSearch all refuse), so an audit built on fetching each page would have reported a bot-detection rate and called it accuracy. Every check is therefore structural, costs nothing, calls no model and fetches no page. Blocked hosts are reported as context and deliberately never affect the score, and unreachable rows stay in the denominator so the number cannot be flattered. The panel is explicit that this measures citation quality rather than accuracy, and it is not the 90% gate. Report-only for now: no row is changed, no badge is downgraded and nothing is withheld from retrieval, because the scale of the problem should be known before any of that is decided. One real cleanup rode along: the badge-enforcement rule moved out of server.js into the new pure module, so the live normalization and the audit share one copy instead of two, and the rule is under test for the first time."}
```

- [ ] **Step 2: Validate the file still parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('devlog.json','utf8')); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Full verification before shipping**

```bash
node --check server.js && npm test
```

Expected: all tests pass, including the new corpus-audit suite.

- [ ] **Step 4: Commit and deploy**

Use the `deploy` skill for the push itself. Note that `main` may hold commits `dev-hub` lacks and that a second session shares this checkout, so stage explicit paths and re-read the diff immediately before committing.

- [ ] **Step 5: Verify live**

After Render redeploys, unlock `/admin` on compninja.co and read the real numbers. This is the first time the production corpus has been measured, so record the score and the finding split; they decide the follow-ups the spec deliberately left out of scope (badge correction at read time, retrieval exclusion, sampled model verification).

---

## Self-Review

**Spec coverage:** All five checks map to tasks (checks 1 and 2 in Tasks 1-2, checks 3-5 in Task 3). Purity and injection are enforced by Task 3's tests. The route, its gate, memoization, row cap and fail-safe behavior are Task 5. The `/admin` panel with the citation-not-accuracy label and the non-scoring host line is Task 6. The `normalizeSourceTypes` refactor is Task 4. The recorded hyphenated-range under-claim is pinned by a test in Task 1.

**Placeholders:** None. Every step carries the code or command it needs.

**Type consistency:** `auditCorpus` returns `{ total, clean, score, findings, hosts, worst }` in Task 3, and Task 5 passes it through unchanged while Task 6 reads exactly those keys. `enforcedSourceType(claimed, address)` keeps one signature across Tasks 1, 3 and 4. `urlIdentifiesProperty(row)` takes a whole row in Tasks 2 and 3.
