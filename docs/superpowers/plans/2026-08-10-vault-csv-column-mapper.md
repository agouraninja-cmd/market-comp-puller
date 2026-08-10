# Vault CSV Column Mapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a broker upload their own CSV export (CoStar, MLS, CRM, anything) and map its columns onto our fields once, instead of being rejected for not using our template.

**Architecture:** A new `POST /api/vault/inspect` returns the file's headers, real sample values, a suggested mapping and the broker's remembered mapping. The browser shows a confirm screen, then posts to the existing `POST /api/vault/upload` with an added `mapping` object. Every decidable rule lives in the pure, tested `broker-vault.js`; `server.js` owns only the routes, the `openVault` gate and the rate limit.

**Tech Stack:** Plain Node (built-in `fetch`, no npm dependencies), `node:test` + `node:assert`, Supabase REST via `sbRequest`, browser JS inside the `vault-page.js` template literal.

**Spec:** `docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md`

## Global Constraints

- **Zero npm dependencies.** Node 18+ built-ins only. Never add a package.
- **Pure modules stay pure.** `broker-vault.js` takes no clock, no I/O, no `require` beyond Node built-ins. The caller passes everything in.
- **Reject rather than guess.** This module's stance: a wrong number in a broker's own records is worse than a refused row, because nobody will notice it. Every new rule refuses with a message naming the problem.
- **`openVault` order is 401 not signed in, 403 not entitled (`canUseVault`), 503 no database.** Any new vault route goes through the same helper, in that order.
- **No file fallback for vault data.** The vault refuses (503) where the rest of the app falls back to a local file, because Render erases its disk on deploy and the file would be the loss.
- **Devlog entry rides in the same commit as shipped work** (`devlog.json`, shape in CLAUDE.md). Save as clean UTF-8; never ASCII-escape em dashes or curly quotes.
- **Shared checkout.** Another Claude session and a human push to the same tree. Run `git status --short` immediately before staging, stage explicit paths only, and never `git add -A` or `git add .`.
- **Run `npm test` before every commit.** It is ~2 seconds and it gates the production deploy through `prestart`.
- **Migration 021 must be run in Supabase before the code that reads it deploys.** Project "Market comp puller" (`bqdgthxkdnpofgzfcyhl`). Log it in `migrations/APPLIED.md`.

## Refinement from the spec

The spec describes `applyMapping(csvText, mapping)` returning rewritten CSV text. This plan instead applies the mapping to the **header array inside `parseUpload`** (`applyHeaderMapping(headers, mapping)`), because rewriting the text would mean re-serializing every cell and parsing the file a second time for no gain. Same behavior, one pass. Everything else follows the spec as written.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `broker-vault.js` | All mapping rules: aliases, suggestion, validation, header application, inspection | Modify |
| `test/broker-vault.test.js` | Unit tests for those rules | Modify |
| `migrations/021-broker-csv-mappings.sql` | One remembered mapping per broker | Create |
| `migrations/APPLIED.md` | Record that 021 ran | Modify |
| `server.js` | `/api/vault/inspect` route, `mapping` on upload, mapping read/write | Modify |
| `test/routes.test.js` | The new route is behind the same gate | Modify |
| `vault-page.js` | The mapping screen | Modify |
| `test/vault-page.test.js` | The emitted page still compiles; panel present | Modify |
| `CLAUDE.md`, `devlog.json`, `docs/ROADMAP.md` | Documentation | Modify |

---

### Task 1: `suggestMapping` and the alias table

**Files:**
- Modify: `broker-vault.js` (add near `normalizeHeader`, around line 150)
- Test: `test/broker-vault.test.js`

**Interfaces:**
- Consumes: `normalizeHeader(name)` (existing), `TEMPLATE_COLUMNS`, `OPTIONAL_SPEC_COLUMNS` (existing)
- Produces: `suggestMapping(headers: string[]) -> { mapping: Record<string,string>, ambiguous: string[] }`. `mapping` keys are **normalized** source headers, values are target field names. `ambiguous` lists target names that two or more columns claimed.

- [ ] **Step 1: Write the failing test**

Add to `test/broker-vault.test.js`, and add `suggestMapping` to the `require` destructure at the top of that file:

```js
// --- column mapping: suggestions ------------------------------------------
//
// The module's standing rule is that we do not GUESS a broker's column names.
// Suggesting is different from guessing only because the broker confirms it
// against real sample values. The rule that keeps the difference real is the
// ambiguity rule: when two columns could be the same field, we suggest
// neither and make them choose.

test("an alias resolves to its template field", () => {
  const { mapping } = suggestMapping(["Property Address", "Sale Price", "SF"]);
  assert.equal(mapping.property_address, "address");
  assert.equal(mapping.sale_price, "price");
  assert.equal(mapping.sf, "size_sqft");
});

test("a literal template name maps to itself", () => {
  const { mapping } = suggestMapping(["address", "deal_date", "price"]);
  assert.equal(mapping.address, "address");
  assert.equal(mapping.deal_date, "deal_date");
  assert.equal(mapping.price, "price");
});

test("TWO columns claiming one field suggest NEITHER", () => {
  const { mapping, ambiguous } = suggestMapping(["Sale Price", "Purchase Price"]);
  assert.equal(mapping.sale_price, undefined);
  assert.equal(mapping.purchase_price, undefined);
  assert.ok(ambiguous.includes("price"),
    "the broker must be told which field was left for them to pick");
});

test("an exact template name beats an alias for the same field", () => {
  const { mapping, ambiguous } = suggestMapping(["price", "Sale Price"]);
  assert.equal(mapping.price, "price", "the literal column wins");
  assert.equal(mapping.sale_price, undefined);
  assert.equal(ambiguous.includes("price"), false,
    "an exact match resolves the tie rather than creating one");
});

test("an unrecognised header suggests nothing and is not an error", () => {
  const { mapping, ambiguous } = suggestMapping(["Broker Remarks 2", "address"]);
  assert.equal(mapping.broker_remarks_2, undefined);
  assert.deepEqual(ambiguous, []);
});

test("an empty header is ignored entirely", () => {
  const { mapping } = suggestMapping(["address", ""]);
  assert.equal(Object.keys(mapping).length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `suggestMapping is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `broker-vault.js`, immediately after `normalizeHeader`:

```js
// --- column mapping --------------------------------------------------------
//
// Aliases a broker's own export is likely to use, keyed on normalizeHeader
// output. This does NOT overturn the "we do not guess" decision above
// TEMPLATE_COLUMNS: nothing here is applied silently. A suggestion is shown
// beside two or three of that column's real values and the broker confirms it
// before anything is written.
const HEADER_ALIASES = {
  address:       ["property_address", "prop_address", "street_address", "site_address", "addr"],
  property_type: ["type", "prop_type", "asset_type", "product_type"],
  transaction:   ["deal_type", "transaction_type", "sale_or_lease", "lease_or_sale"],
  deal_date:     ["sale_date", "close_date", "closing_date", "transaction_date", "sold_date", "date"],
  price:         ["sale_price", "sales_price", "purchase_price", "sold_price"],
  size_sqft:     ["sf", "sq_ft", "sqft", "square_feet", "square_footage", "building_sf", "building_size", "size"],
  cap_rate:      ["cap", "going_in_cap", "cap_pct"],
  tenancy:       ["tenancy_type"],
  year_built:    ["yr_built", "built", "year_constructed"],
  notes:         ["comments", "remarks", "note"],
  lat:           ["latitude"],
  lng:           ["longitude", "long", "lon"],
};

// Every field a column may be mapped onto.
const MAPPABLE_TARGETS = [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS];

/**
 * Suggest a mapping from a file's headers onto our fields.
 *
 * The ambiguity rule is the load-bearing part: a target is suggested only when
 * exactly ONE column claims it. "Sale Price" and "Consideration" both mean
 * price, and breaking that tie ourselves is the failure the original decision
 * was written to prevent.
 */
function suggestMapping(headers) {
  const norm = (Array.isArray(headers) ? headers : []).map(normalizeHeader);

  // Which columns claim each target, exact matches tracked separately so a
  // literal `price` column can settle a tie an alias would otherwise create.
  const exact = new Map();   // target -> [normalized header]
  const alias = new Map();   // target -> [normalized header]
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (const h of norm) {
    if (!h) continue;
    if (MAPPABLE_TARGETS.includes(h)) { push(exact, h, h); continue; }
    for (const [target, list] of Object.entries(HEADER_ALIASES)) {
      if (list.includes(h)) push(alias, target, h);
    }
  }

  const mapping = {};
  const ambiguous = [];
  const used = new Set();

  for (const target of MAPPABLE_TARGETS) {
    const hits = exact.get(target) || alias.get(target) || [];
    const free = hits.filter((h) => !used.has(h));
    if (free.length === 1) {
      mapping[free[0]] = target;
      used.add(free[0]);
    } else if (free.length > 1) {
      ambiguous.push(target);
    }
  }

  return { mapping, ambiguous };
}
```

Add `HEADER_ALIASES`, `MAPPABLE_TARGETS` and `suggestMapping` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, total count up by 6.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- broker-vault.js test/broker-vault.test.js
git commit -m "Vault mapper: alias table and suggestMapping, with the ambiguity rule"
```

---

### Task 2: `validateMapping`

**Files:**
- Modify: `broker-vault.js`
- Test: `test/broker-vault.test.js`

**Interfaces:**
- Consumes: `normalizeHeader`, `MAPPABLE_TARGETS` (Task 1)
- Produces: `validateMapping(mapping, headers) -> { ok: boolean, errors: string[] }`. `mapping` keys are normalized source headers; `headers` is the file's raw header row.

- [ ] **Step 1: Write the failing test**

```js
// --- column mapping: refusals ---------------------------------------------
//
// These are the cases where a mapping could put a real number in the wrong
// column. Every one refuses with a message naming the problem, in keeping with
// the module's stance everywhere else.

const HEADERS = ["Property Address", "Type", "Deal", "Closed", "Sale Price"];
const GOOD = {
  property_address: "address", type: "property_type",
  deal: "transaction", closed: "deal_date", sale_price: "price",
};

test("a complete mapping is accepted", () => {
  assert.deepEqual(validateMapping(GOOD, HEADERS), { ok: true, errors: [] });
});

test("a missing required field is refused and named", () => {
  const { property_address, ...rest } = GOOD;
  const r = validateMapping(rest, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /address/);
});

test("two columns claiming one field is refused", () => {
  const r = validateMapping({ ...GOOD, type: "price" }, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /price/);
});

test("an unknown target is refused, not ignored", () => {
  const r = validateMapping({ ...GOOD, sale_price: "profit" }, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /profit/);
});

test("a column that is not in the file is refused", () => {
  const r = validateMapping({ ...GOOD, ghost_column: "notes" }, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /ghost_column/);
});

test("a column mapped to nothing is normal, not an error", () => {
  const r = validateMapping(GOOD, [...HEADERS, "Listing Broker", "MLS ID"]);
  assert.equal(r.ok, true);
});

test("a non-object mapping is refused rather than treated as empty", () => {
  assert.equal(validateMapping(null, HEADERS).ok, false);
  assert.equal(validateMapping("address", HEADERS).ok, false);
});
```

Add `validateMapping` to the file's `require` destructure.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `validateMapping is not a function`.

- [ ] **Step 3: Write the implementation**

```js
// The four fields normalizeRow refuses a row without. Kept here as one list so
// the mapper and the row parser cannot disagree about what "required" means.
const REQUIRED_TARGETS = ["address", "property_type", "transaction", "deal_date"];

/**
 * Validate a confirmed mapping before anything is imported. Refuses rather
 * than repairing: a mapping we quietly fixed is a mapping the broker did not
 * actually approve.
 */
function validateMapping(mapping, headers) {
  const errors = [];
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return { ok: false, errors: ["No column mapping was supplied."] };
  }

  const present = new Set(
    (Array.isArray(headers) ? headers : []).map(normalizeHeader).filter(Boolean)
  );
  const claimedBy = new Map();

  for (const [source, target] of Object.entries(mapping)) {
    if (!present.has(source)) {
      errors.push(`The file has no column called "${source}".`);
      continue;
    }
    if (!MAPPABLE_TARGETS.includes(target)) {
      errors.push(`"${target}" is not a field we store.`);
      continue;
    }
    if (claimedBy.has(target)) {
      errors.push(`Two columns are both mapped to ${target}: "${claimedBy.get(target)}" and "${source}". Pick one.`);
      continue;
    }
    claimedBy.set(target, source);
  }

  const missing = REQUIRED_TARGETS.filter((t) => !claimedBy.has(t));
  if (missing.length) {
    errors.push(`Still needed: ${missing.join(", ")}.`);
  }

  return { ok: errors.length === 0, errors };
}
```

Export `validateMapping` and `REQUIRED_TARGETS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, count up by 7.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- broker-vault.js test/broker-vault.test.js
git commit -m "Vault mapper: validateMapping refuses rather than repairs"
```

---

### Task 3: `applyHeaderMapping` and `parseUpload({ mapping })`

**Files:**
- Modify: `broker-vault.js` (new function, plus `parseUpload` at line 470)
- Test: `test/broker-vault.test.js`

**Interfaces:**
- Consumes: `validateMapping` (Task 2), `normalizeHeader`
- Produces: `applyHeaderMapping(normalizedHeaders: string[], mapping) -> string[]`, and `parseUpload(csvText, { maxRows, maxErrors, mapping })` where `mapping` defaults to `null` and `null` means today's behavior exactly.

- [ ] **Step 1: Write the failing test**

```js
// --- column mapping: applying it ------------------------------------------

test("mapped headers become template names and the rest are neutralised", () => {
  const out = applyHeaderMapping(
    ["property_address", "sale_price", "listing_broker"],
    { property_address: "address", sale_price: "price" }
  );
  assert.deepEqual(out, ["address", "price", "_ignored_2"]);
});

// The reason unmapped columns are RENAMED rather than left alone: a file can
// contain a literal `price` column that the broker deliberately did NOT map,
// having chosen a different one. Left as-is it would collide and the row
// builder would silently take whichever came last.
test("an unmapped column named like a field cannot shadow the mapped one", () => {
  const out = applyHeaderMapping(
    ["price", "sale_price"],
    { sale_price: "price" }
  );
  assert.deepEqual(out, ["_ignored_0", "price"]);
});

test("a mapped upload parses to the same rows as the template version", () => {
  const mapped = parseUpload(
    "Property Address,Type,Deal,Closed,Sale Price\n" +
    "1234 W Main St, Boise, ID,Industrial,Sale,2026-02-01,\"$2,450,000\"\n",
    { mapping: { property_address: "address", type: "property_type",
                 deal: "transaction", closed: "deal_date", sale_price: "price" } }
  );
  const template = parseUpload(
    "address,property_type,transaction,deal_date,price\n" +
    "1234 W Main St, Boise, ID,Industrial,Sale,2026-02-01,\"$2,450,000\"\n"
  );
  assert.equal(mapped.ok, true, mapped.errors.join(" | "));
  assert.deepEqual(mapped.rows, template.rows);
});

test("no mapping means byte-identical behaviour to before", () => {
  const csv = "address,property_type,transaction,deal_date\n1 A St, Boise, ID,Land,Sale,2026-01-01\n";
  assert.deepEqual(parseUpload(csv, { mapping: null }), parseUpload(csv));
});

test("an invalid mapping refuses the whole upload and writes nothing", () => {
  const r = parseUpload("Foo,Bar\n1,2\n", { mapping: { foo: "price" } });
  assert.equal(r.ok, false);
  assert.equal(r.rows.length, 0);
});
```

Add `applyHeaderMapping` to the `require` destructure.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `applyHeaderMapping is not a function`.

- [ ] **Step 3: Write the implementation**

Add the function:

```js
/**
 * Rename a header row per a confirmed mapping. Unmapped columns are renamed to
 * a name nothing matches, rather than left alone: a file may contain a literal
 * `price` column the broker chose NOT to map, and leaving it would collide
 * with the column they did map.
 */
function applyHeaderMapping(headers, mapping) {
  const m = mapping && typeof mapping === "object" ? mapping : {};
  return (Array.isArray(headers) ? headers : []).map((h, i) =>
    Object.prototype.hasOwnProperty.call(m, h) ? m[h] : `_ignored_${i}`
  );
}
```

Then in `parseUpload`, change the signature and the header line:

```js
function parseUpload(csvText, { maxRows = MAX_ROWS_PER_UPLOAD, maxErrors = 100, mapping = null } = {}) {
```

and replace the `const headers = table[0].map(normalizeHeader);` block with:

```js
  let headers = table[0].map(normalizeHeader);
  if (mapping) {
    // Validate BEFORE applying: an invalid mapping must refuse the upload, not
    // import a partial one. Same stance as every other refusal in this module.
    const check = validateMapping(mapping, table[0]);
    if (!check.ok) return { ...empty, errors: check.errors };
    headers = applyHeaderMapping(headers, mapping);
  }
  // `address` is the one column nothing works without, so it doubles as the
  // "is this even the template?" check. With a mapping applied it is always
  // present, because validateMapping requires it.
  if (!headers.includes("address")) {
```

Export `applyHeaderMapping`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, count up by 5, and every pre-existing `parseUpload` test still green (the no-mapping path is unchanged).

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- broker-vault.js test/broker-vault.test.js
git commit -m "Vault mapper: apply a mapping inside parseUpload, no re-serialisation"
```

---

### Task 4: `inspectCsv`

**Files:**
- Modify: `broker-vault.js`
- Test: `test/broker-vault.test.js`

**Interfaces:**
- Consumes: `parseCsv`, `normalizeHeader`, `suggestMapping` (Task 1), `MAPPABLE_TARGETS`, `REQUIRED_TARGETS` (Task 2)
- Produces: `inspectCsv(csvText, { samples = 3 }) -> { ok, error, headers, normalized, samples, suggested, ambiguous, cleanTemplate, rowCount }`. `headers` is raw for display, `normalized` is the mapping key, `samples` is `{ normalizedHeader: string[] }`.

- [ ] **Step 1: Write the failing test**

```js
// --- column mapping: inspection -------------------------------------------

const REAL_EXPORT =
  "Property Address,Type,Deal,Closed,Sale Price,SF,Listing Broker\n" +
  "1234 W Main St, Boise, ID,Industrial,Sale,2026-02-01,\"$2,450,000\",18400,Jane Doe\n" +
  "55 N 9th St, Boise, ID,Industrial,Sale,2026-01-14,\"$1,100,000\",9000,\n";

test("inspection returns raw headers for display and normalised keys for mapping", () => {
  const r = inspectCsv(REAL_EXPORT);
  assert.equal(r.ok, true);
  assert.equal(r.headers[0], "Property Address");
  assert.equal(r.normalized[0], "property_address");
  assert.equal(r.rowCount, 2);
});

test("samples are real values, skipping blanks, capped at the limit", () => {
  const r = inspectCsv(REAL_EXPORT, { samples: 3 });
  assert.deepEqual(r.samples.sale_price, ["$2,450,000", "$1,100,000"]);
  assert.deepEqual(r.samples.listing_broker, ["Jane Doe"], "the blank second value is skipped");
});

test("a real export is not a clean template", () => {
  assert.equal(inspectCsv(REAL_EXPORT).cleanTemplate, false);
});

// This is the SILENT failure the mapping screen exists to catch: only four
// fields are required, so this file imports today with every size null and
// nothing saying so.
test("a file with an unrecognised column is not clean even though it would import", () => {
  const r = inspectCsv("address,property_type,transaction,deal_date,Sq Ft\n1 A St, Boise, ID,Land,Sale,2026-01-01,900\n");
  assert.equal(r.cleanTemplate, false, "Sq Ft is unrecognised, so the broker must be asked");
});

test("our own template IS clean and skips the screen", () => {
  assert.equal(inspectCsv(templateCsv()).cleanTemplate, true);
});

test("a trailing empty header does not spoil cleanliness", () => {
  const r = inspectCsv("address,property_type,transaction,deal_date,\n1 A St, Boise, ID,Land,Sale,2026-01-01,\n");
  assert.equal(r.cleanTemplate, true);
});

test("duplicate column names are refused, because a mapping keys on the name", () => {
  const r = inspectCsv("Price,Price\n1,2\n");
  assert.equal(r.ok, false);
  assert.match(r.error, /Price/);
});

test("an empty file is refused with a sentence", () => {
  assert.equal(inspectCsv("").ok, false);
});

// Excel writes a UTF-8 BOM on "Save as CSV". parseCsv already strips it, and
// this pins that the mapper inherits that rather than offering the broker a
// first column mysteriously named "﻿Property Address".
test("a BOM-led file inspects normally", () => {
  const r = inspectCsv("﻿Property Address,Type\n1 A St, Boise, ID,Land\n");
  assert.equal(r.ok, true);
  assert.equal(r.normalized[0], "property_address");
  assert.equal(r.suggested.property_address, "address");
});

// A header with a comma in it only survives if it was quoted, and the mapping
// keys on the normalised name, so this pins that quoting is respected.
test("a quoted header carrying a comma is read as one column", () => {
  const r = inspectCsv('"Address, Full",Type\n"1 A St, Boise, ID",Land\n');
  assert.equal(r.headers.length, 2);
  assert.equal(r.normalized[0], "address_full");
});
```

Add `inspectCsv` to the `require` destructure.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `inspectCsv is not a function`.

- [ ] **Step 3: Write the implementation**

```js
/**
 * Read a CSV's shape without importing it: headers, a few real values per
 * column, and a suggested mapping. Writes nothing and decides nothing; the
 * broker confirms what this proposes.
 */
function inspectCsv(csvText, { samples = 3 } = {}) {
  const empty = {
    ok: false, error: "", headers: [], normalized: [], samples: {},
    suggested: {}, ambiguous: [], cleanTemplate: false, rowCount: 0,
  };
  const table = parseCsv(csvText);
  if (!table.length) return { ...empty, error: "That file is empty." };

  const headers = table[0];
  const normalized = headers.map(normalizeHeader);

  // A mapping is keyed on the normalised header name, so two columns sharing
  // one name have no way to be told apart. Refuse rather than pick.
  const seen = new Set();
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (!h) continue;
    if (seen.has(h)) {
      return { ...empty, error: `Two columns are both called "${headers[i]}". Rename one and upload again.` };
    }
    seen.add(h);
  }

  const body = table.slice(1);
  const sampleMap = {};
  for (let c = 0; c < normalized.length; c++) {
    if (!normalized[c]) continue;
    const vals = [];
    for (const row of body) {
      const v = String(row[c] == null ? "" : row[c]).trim();
      if (v) vals.push(v);
      if (vals.length >= samples) break;
    }
    sampleMap[normalized[c]] = vals;
  }

  const { mapping: suggested, ambiguous } = suggestMapping(headers);

  // Clean means every non-empty header is already one of ours AND the four
  // required fields are present. Requiring EVERY header to be known is what
  // catches the silent case: a file with an unknown "Sq Ft" column imports
  // today with no sizes and no explanation.
  const nonEmpty = normalized.filter(Boolean);
  const cleanTemplate =
    nonEmpty.every((h) => MAPPABLE_TARGETS.includes(h)) &&
    REQUIRED_TARGETS.every((t) => nonEmpty.includes(t));

  return {
    ok: true, error: "", headers, normalized, samples: sampleMap,
    suggested, ambiguous, cleanTemplate, rowCount: body.length,
  };
}
```

Export `inspectCsv`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, count up by 8.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- broker-vault.js test/broker-vault.test.js
git commit -m "Vault mapper: inspectCsv reports headers, samples and cleanliness"
```

---

### Task 5: Migration 021 and the mapping store

**Files:**
- Create: `migrations/021-broker-csv-mappings.sql`
- Modify: `migrations/APPLIED.md`
- Modify: `server.js` (add beside the other vault reads)

**Interfaces:**
- Consumes: `sbRequest(method, pathAndQuery, body, extraHeaders)`, `DB_CONFIGURED` (both existing in `server.js`)
- Produces: `getCsvMapping(userId) -> Promise<object|null>` and `saveCsvMapping(userId, mapping) -> Promise<void>`. Both swallow their own errors: a remembered mapping is a convenience, never a gate.

- [ ] **Step 1: Write the migration**

Create `migrations/021-broker-csv-mappings.sql`:

```sql
-- migrations/021-broker-csv-mappings.sql
-- 021 · Vault CSV column mapper: one remembered mapping per broker (2026-08-10)
-- Spec: docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md
-- Plan: docs/superpowers/plans/2026-08-10-vault-csv-column-mapper.md
--
-- RUN BEFORE DEPLOYING the /api/vault/inspect route.
--
-- Broker PRIVATE data, vault-class: read and written only by the vault
-- routes, always scoped by user_id, never read by an owner surface. It
-- holds column NAMES rather than comp values, but it is a broker's own
-- file structure and is treated the same way. Purely additive.
--
-- user_id is the primary key rather than a surrogate id alongside it,
-- unlike broker_bovs and broker_comps. Those are fact tables with many
-- rows per broker; this holds exactly one, so the key enforces that in
-- the schema instead of in a code path, gives the upsert an obvious
-- conflict target, and needs no separate index.

create table if not exists broker_csv_mappings (
  user_id    uuid primary key references users(id) on delete cascade,
  mapping    jsonb not null,
  updated_at timestamptz not null default now()
);

alter table broker_csv_mappings enable row level security;
```

- [ ] **Step 2: Run it in Supabase and log it**

Open the SQL editor for project **"Market comp puller"** at
https://supabase.com/dashboard/project/bqdgthxkdnpofgzfcyhl/sql
Paste the file, run it, then confirm:

```sql
select column_name, data_type from information_schema.columns
where table_name = 'broker_csv_mappings' order by ordinal_position;
```

Expected: three rows (`user_id` uuid, `mapping` jsonb, `updated_at` timestamptz).

Then add this row to the table in `migrations/APPLIED.md`, filling in what actually happened rather than copying the claim:

```markdown
| 021-broker-csv-mappings.sql | applied 2026-08-10 | Run in the SQL editor (project "Market comp puller") as the file's two executable statements (create table / alter enable RLS), comments stripped; buffer read back before running to catch a Monaco auto-close artifact. Verified in the same session by one query returning exactly 3 rows from `information_schema.columns`: `user_id` uuid, `mapping` jsonb, `updated_at` timestamptz. Purely additive and idempotent (`create table if not exists`). Table created empty. Deploy-order note: the read is failure-safe (no remembered mapping simply means none is offered), so deploy-then-migrate degrades rather than breaks, but migrate-first is still the documented order. |
```

- [ ] **Step 3: Write the store helpers**

In `server.js`, directly above the `/api/vault` route block (near line 10620):

```js
// The broker's last confirmed CSV column mapping. A convenience only: it
// pre-fills the mapping screen, which they still confirm, so a stale mapping
// can never import the wrong thing. Both halves swallow their errors for that
// reason — losing it costs a few seconds, and failing an upload over it would
// cost the broker their spreadsheet.
async function getCsvMapping(userId) {
  if (!DB_CONFIGURED || !userId) return null;
  try {
    const rows = await sbRequest("GET",
      `broker_csv_mappings?user_id=eq.${encodeURIComponent(userId)}&select=mapping&limit=1`);
    const m = rows && rows[0] && rows[0].mapping;
    return m && typeof m === "object" && !Array.isArray(m) ? m : null;
  } catch (e) {
    console.warn("csv mapping read failed:", e.message);
    return null;
  }
}

async function saveCsvMapping(userId, mapping) {
  if (!DB_CONFIGURED || !userId) return;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return;
  try {
    await sbRequest("POST", "broker_csv_mappings",
      [{ user_id: userId, mapping, updated_at: new Date().toISOString() }],
      { prefer: "resolution=merge-duplicates" });
  } catch (e) {
    console.warn("csv mapping write failed:", e.message);
  }
}
```

- [ ] **Step 4: Verify the server still boots and parses**

Run: `node --check server.js && npm test`
Expected: exit 0, suite green (no new tests yet; this proves nothing broke).

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- migrations/021-broker-csv-mappings.sql migrations/APPLIED.md server.js
git commit -m "Vault mapper: migration 021 and the remembered-mapping store"
```

---

### Task 6: `POST /api/vault/inspect`

**Files:**
- Modify: `server.js` (inside the vault route block, after `/api/vault/template`)
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `openVault()`, `rateLimited(key, max)`, `clientIp(req)`, `sendJson(res, status, body)`, `VAULT.inspectCsv` (Task 4), `getCsvMapping` (Task 5), `VAULT.MAPPABLE_TARGETS` (Task 1)
- Produces: the JSON contract the browser reads in Task 8.

- [ ] **Step 1: Write the failing test**

In `test/routes.test.js`, add `["POST", "/api/vault/inspect"]` to the existing route list in the "every vault route refuses an anonymous caller" test (around line 172). Then add:

```js
  // The mapper's own route. It reads no vault rows, but it answers through the
  // same gate as everything else here on purpose: a fifth route is a fifth
  // chance for openVault's three refusals to drift, which is what this file is
  // for. /api/vault/benchmarks set the precedent.
  await t.test("/api/vault/inspect is gated like the rest of the vault", async () => {
    const r = await fetch(srv.base + "/api/vault/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv: "address\n1 A St, Boise, ID\n" }),
    });
    assert.equal(r.status, 401, "an anonymous caller must not learn anything about a file");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, the route 404s so the status is 404 rather than 401.

- [ ] **Step 3: Write the route**

In `server.js`, immediately after the `/api/vault/template` handler:

```js
    // Read a broker's own CSV and report its shape, so they can map their
    // columns onto ours. Stores NOTHING: a broker who cancels leaves no trace.
    // The only persistence it touches is READING their remembered mapping.
    if (req.method === "POST" && path === "/api/vault/inspect") {
      let body = "";
      let tooBig = false;
      req.on("data", (c) => {
        body += c;
        if (body.length > 8e6 && !tooBig) { tooBig = true; req.destroy(); }
      });
      req.on("end", async () => {
        try {
          if (tooBig) return;
          const user = await openVault();
          if (!user) return;
          // Its own limiter key: inspecting is cheap and a broker may retry the
          // screen several times while an import is one deliberate act.
          if (rateLimited("vaultinspect:" + clientIp(req), 60)) {
            return sendJson(res, 429, { error: "Too many attempts. Please wait a moment." });
          }
          const { csv } = JSON.parse(body || "{}");
          const info = VAULT.inspectCsv(String(csv || ""));
          if (!info.ok) return sendJson(res, 400, { error: info.error });
          sendJson(res, 200, {
            headers: info.headers,
            normalized: info.normalized,
            samples: info.samples,
            suggested: info.suggested,
            ambiguous: info.ambiguous,
            remembered: await getCsvMapping(user.id),
            cleanTemplate: info.cleanTemplate,
            rowCount: info.rowCount,
            // Served rather than hard-coded in vault-page.js so the dropdown
            // cannot drift from TEMPLATE_COLUMNS + OPTIONAL_SPEC_COLUMNS.
            // Adding a per-type field stays a one-place change.
            targets: VAULT.MAPPABLE_TARGETS,
            required: VAULT.REQUIRED_TARGETS,
          });
        } catch (e) {
          console.error("vault inspect failed:", e.message);
          sendJson(res, 500, { error: "That file could not be read." });
        }
      });
      return;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including the anonymous-refusal list now covering six routes.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- server.js test/routes.test.js
git commit -m "Vault mapper: POST /api/vault/inspect behind the same gate"
```

---

### Task 7: `mapping` on the upload route

**Files:**
- Modify: `server.js` (the `/api/vault/upload` handler, around line 10650)

**Interfaces:**
- Consumes: `VAULT.parseUpload(csv, { mapping })` (Task 3), `saveCsvMapping` (Task 5)
- Produces: no new contract; the response shape is unchanged.

- [ ] **Step 1: Read the mapping from the body**

Change:

```js
          const { filename, csv } = JSON.parse(body || "{}");
          const parsed = VAULT.parseUpload(csv);
```

to:

```js
          const { filename, csv, mapping } = JSON.parse(body || "{}");
          // `mapping` absent means today's behaviour byte for byte, so
          // gen-market-seed.js and any existing caller are unaffected.
          // parseUpload validates it and refuses the whole file if it is
          // wrong, which is why nothing is checked here.
          const parsed = VAULT.parseUpload(csv, { mapping: mapping || null });
```

- [ ] **Step 2: Remember the mapping only after a successful import**

Immediately after the `broker_uploads` batch row is confirmed (just after the `if (!uploadId) throw ...` line), add:

```js
          // Saved only once the import actually succeeded, so a mapping that
          // produced nothing usable is never offered back to them next time.
          if (mapping) saveCsvMapping(user.id, mapping);
```

- [ ] **Step 3: Verify nothing regressed**

Run: `node --check server.js && npm test`
Expected: exit 0, suite green. The "no mapping is byte-identical" test from Task 3 covers the compatibility claim.

- [ ] **Step 4: Commit**

```bash
git status --short
git add -- server.js
git commit -m "Vault mapper: upload accepts and remembers a mapping"
```

---

### Task 8: The mapping screen on `/vault`

**Files:**
- Modify: `vault-page.js` (markup near the `#addSec` block, CSS near the other panel rules, JS near `upload()` at line 1177)
- Test: `test/vault-page.test.js`

**Interfaces:**
- Consumes: `/api/vault/inspect` (Task 6), `/api/vault/upload` with `mapping` (Task 7)
- Produces: nothing other tasks depend on.

**Warning:** the whole page is one template literal. A stray `${` or a single-backslash escape emits broken JavaScript and a blank workspace rather than failing loudly. `test/vault-page.test.js` compiles what the page emits, which is the check that catches it.

- [ ] **Step 1: Write the failing test**

In `test/vault-page.test.js`. That file already defines the helpers `comp(o)`, `boot(comps)`, `pageScript(html)` and the constant `CHROME`; use them rather than inventing fixtures:

```js
test("the mapping panel is present and hidden on first paint", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.match(html, /id="mapSec"/);
  assert.match(html, /<section id="mapSec" class="hide">/,
    "it must not flash before a file is chosen");
});

test("the mapping panel names the ignored columns", () => {
  // Silent dropping is half of what this feature fixes, so the page has to
  // say which columns are being left out.
  assert.match(renderVaultHTML(boot([comp({})]), CHROME), /id="mapIgnored"/);
});

test("the emitted script still parses with the mapper in it", () => {
  // The whole page is one template literal, so a stray `${` or a
  // single-backslash escape yields a blank workspace rather than a loud
  // failure. This compiles what the browser would actually receive.
  assert.doesNotThrow(() =>
    new Function(pageScript(renderVaultHTML(boot([comp({})]), CHROME))));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, no `mapSec` in the output.

- [ ] **Step 3: Add the markup**

Directly before the `#addSec` section:

```html
    <section id="mapSec" class="hide">
      <h2>Match your columns</h2>
      <p class="sub" style="margin-top:0">We found <span id="mapRows">0</span> rows.
        Tell us which of your columns is which, then import. Nothing is saved until you do.</p>
      <table id="mapTable">
        <thead><tr><th>Your column</th><th>Maps to</th><th>Sample values</th></tr></thead>
        <tbody id="mapBody"></tbody>
      </table>
      <p class="note" id="mapIgnored"></p>
      <p id="mapMsg" class="msg bad hide"></p>
      <button class="btn" id="mapGo">Import</button>
      <button class="btn ghost" id="mapCancel">Cancel</button>
    </section>
```

- [ ] **Step 4: Rewrite `upload()` to inspect first**

Replace the body of `upload(file)` so the `FileReader.onload` calls inspect, and add the panel logic. The existing import call becomes `doImport(name, csv, mapping)`:

```js
  var pending = null;   // {name, csv} held while the broker maps

  function doImport(name, csv, mapping){
    $("pick").disabled=true;
    $("res").innerHTML='<div class="msg ok">Importing&hellip;</div>';
    var payload={filename:name,csv:csv};
    if(mapping)payload.mapping=mapping;
    fetch("/api/vault/upload",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        $("pick").disabled=false;
        var j=o.j||{};
        var errs=(j.errors&&j.errors.length)?"<ul>"+j.errors.map(function(e){
          return "<li>"+esc(e)+"</li>"}).join("")+"</ul>":"";
        if(o.s!==200){
          $("res").innerHTML='<div class="msg bad">'+esc(j.error||"That file could not be imported.")+errs+"</div>";
          return;
        }
        var bits=["Imported "+j.imported+" comp"+(j.imported===1?"":"s")];
        if(j.skipped)bits.push(j.skipped+" row"+(j.skipped===1?"":"s")+" skipped");
        if(j.duplicates)bits.push(j.duplicates+" duplicate"+(j.duplicates===1?"":"s")+" in the file");
        $("res").innerHTML='<div class="msg '+(j.skipped?"bad":"ok")+'">'+esc(bits.join(" \\u00b7 "))+errs+"</div>";
        load();
      })
      .catch(function(){ $("pick").disabled=false;
        $("res").innerHTML='<div class="msg bad">The upload did not reach the server. Nothing was saved.</div>'; });
  }

  function upload(file){
    if(!file)return;
    $("pick").disabled=true; $("res").innerHTML='<div class="msg ok">Reading '+esc(file.name)+"&hellip;</div>";
    var fr=new FileReader();
    fr.onerror=function(){ $("pick").disabled=false; $("res").innerHTML='<div class="msg bad">Could not read that file.</div>'; };
    fr.onload=function(){
      var csv=String(fr.result||"");
      fetch("/api/vault/inspect",{method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify({csv:csv})})
        .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
        .then(function(o){
          $("pick").disabled=false;
          if(o.s!==200){
            $("res").innerHTML='<div class="msg bad">'+esc((o.j&&o.j.error)||"That file could not be read.")+"</div>";
            return;
          }
          // A file already in our own column names skips the screen entirely.
          if(o.j.cleanTemplate){ doImport(file.name,csv,null); return; }
          pending={name:file.name,csv:csv};
          openMapper(o.j);
        })
        // Deliberately NOT a silent fallback to a strict upload: that would
        // reintroduce the old rejection message under a different cause.
        .catch(function(){ $("pick").disabled=false;
          $("res").innerHTML='<div class="msg bad">Could not reach the server to read that file. Nothing was saved.</div>'; });
    };
    fr.readAsText(file);
  }
```

- [ ] **Step 5: Add `openMapper` and its handlers**

```js
  var mapInfo=null;

  function openMapper(info){
    mapInfo=info;
    $("res").innerHTML="";
    $("mapRows").textContent=String(info.rowCount);
    // Remembered beats suggested: it is the broker's own previous decision.
    var start={};
    Object.keys(info.suggested||{}).forEach(function(k){ start[k]=info.suggested[k] });
    Object.keys(info.remembered||{}).forEach(function(k){
      if(info.normalized.indexOf(k)>=0)start[k]=info.remembered[k];
    });
    var rows=info.normalized.map(function(n,i){
      if(!n)return "";
      var opts=['<option value="">&mdash; ignore &mdash;</option>'].concat(
        (info.targets||[]).map(function(t){
          return '<option value="'+esc(t)+'"'+(start[n]===t?" selected":"")+">"+esc(t)+"</option>";
        })).join("");
      var samp=(info.samples[n]||[]).map(esc).join("<br>");
      return "<tr><td>"+esc(info.headers[i])+'</td><td><select data-src="'+esc(n)+'">'+opts+
             '</select></td><td class="note">'+samp+"</td></tr>";
    }).join("");
    $("mapBody").innerHTML=rows;
    $("mapSec").classList.remove("hide");
    $("addSec").classList.add("hide");
    Array.prototype.forEach.call($("mapBody").querySelectorAll("select"),function(s){
      s.addEventListener("change",refreshMapper);
    });
    refreshMapper();
    $("mapSec").scrollIntoView({behavior:"smooth",block:"start"});
  }

  function currentMapping(){
    var m={};
    Array.prototype.forEach.call($("mapBody").querySelectorAll("select"),function(s){
      if(s.value)m[s.getAttribute("data-src")]=s.value;
    });
    return m;
  }

  function refreshMapper(){
    var m=currentMapping(), claimed=Object.keys(m).map(function(k){return m[k]});
    var missing=(mapInfo.required||[]).filter(function(t){return claimed.indexOf(t)<0});
    var ignored=(mapInfo.normalized||[]).filter(function(n){return n&&!m[n]});
    // Naming the ignored columns is half the point: importing while quietly
    // dropping a column is the silent failure this screen exists to end.
    $("mapIgnored").textContent=ignored.length
      ? "Will be ignored: "+ignored.join(", ")
      : "Every column is mapped.";
    if(missing.length){
      $("mapMsg").textContent="Still needed: "+missing.join(", ");
      $("mapMsg").classList.remove("hide");
      $("mapGo").disabled=true;
    }else{
      $("mapMsg").classList.add("hide");
      $("mapGo").disabled=false;
    }
  }

  function closeMapper(){
    $("mapSec").classList.add("hide");
    $("addSec").classList.remove("hide");
    pending=null; mapInfo=null;
  }

  $("mapGo").addEventListener("click",function(){
    if(!pending)return;
    var p=pending, m=currentMapping();
    closeMapper();
    doImport(p.name,p.csv,m);
  });
  $("mapCancel").addEventListener("click",function(){
    closeMapper();
    $("res").innerHTML='<div class="msg ok">Cancelled. Nothing was saved.</div>';
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including the "emitted script still parses" test.

- [ ] **Step 7: Drive it in a browser**

```bash
node -e "process.env.PORT='3170';require('./server.js')"
```

Add a `dev-mapper` entry to `.claude/launch.json` on port 3170 if using the preview tools. Sign in as a Pro account, open `/vault`, and upload this file saved as `test-export.csv`:

```
Property Address,Type,Deal,Closed,Sale Price,SF,Listing Broker
1234 W Main St, Boise, ID,Industrial,Sale,2026-02-01,"$2,450,000",18400,Jane Doe
```

Confirm: the mapping screen appears; Property Address, Type, Deal, Sale Price and SF are pre-selected; Closed is pre-selected to deal_date; Listing Broker is listed as ignored; Import works; re-uploading the same file pre-fills from the remembered mapping. Then upload the file downloaded from "Download the template" and confirm it imports with **no** mapping screen.

- [ ] **Step 8: Commit**

```bash
git status --short
git add -- vault-page.js test/vault-page.test.js
git commit -m "Vault mapper: the match-your-columns screen on /vault"
```

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md` (the broker vault section), `devlog.json`, `docs/ROADMAP.md`

- [ ] **Step 1: Document the rules in CLAUDE.md**

Under the broker vault bullets, add a sub-bullet. Keep it to the non-obvious constraints, which is what that file is for:

```markdown
  - **The CSV column mapper** (2026-08-10; spec
    `docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md`).
    A broker uploads their own export and maps its columns once. `POST
    /api/vault/inspect` reports headers, real sample values and a suggested
    mapping; `/api/vault/upload` takes an optional `mapping`, and absent it
    behaves byte for byte as before. Four rules a future editor will
    otherwise break: **a target is suggested only when exactly ONE column
    claims it**, which is how the old "we do not guess column names"
    decision survives (two columns aliasing to `price` suggest neither);
    **the screen is always shown unless every header is already one of
    ours**, because only four fields are required per row, so a file with
    an unrecognised "Sq Ft" column imports today with every size null and
    nothing saying so; **unmapped columns are renamed `_ignored_<i>` rather
    than left alone**, or a literal `price` column the broker chose not to
    map would shadow the one they did; and **the remembered mapping is only
    ever a pre-selection**, never auto-applied, which is what makes it safe
    to key on the broker rather than on a fingerprint of their header row.
    If the screen is ever made skippable on a remembered mapping, that last
    one stops being true and the header signature becomes necessary.
```

- [ ] **Step 2: Add the devlog entry**

Prepend one entry to `devlog.json` (clean UTF-8, no ASCII escaping):

```json
{"date":"2026-08-10","type":"feature","title":"The vault takes the broker's own spreadsheet","details":"Until now a vault upload had to use our exact column names, so a CoStar or MLS export whose first column is \"Property Address\" was rejected outright with an instruction to go copy the data into our template. That is homework, and it stood between the vault and its first real book of business. An upload now opens a matching screen: your column, our field, and two or three real values from that column so a wrong match is visible rather than silent. It also closes a quieter failure. Only four fields are required per row, so a file carrying \"Sq Ft\" instead of size_sqft imported perfectly happily with every size null, every price per square foot missing, and no explanation anywhere. Any file with a column we do not recognise now asks, and the screen names the columns it is going to ignore. Files already in our template import with no extra step. A confirmed mapping is remembered, but only ever as a pre-selection on a screen the broker still confirms, so a stale mapping can never quietly import the wrong thing. The suggestion rules keep the module's old promise not to guess: a field is pre-selected only when exactly one column claims it, so a file with both \"Sale Price\" and \"Consideration\" leaves the choice to the person who knows."}
```

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`, under **Next**, append these two sentences to the end of the existing "Import-time geocoding for vault comps" bullet, after the sentence ending "no migration change.":

```markdown
  **Unblocked 2026-08-10** by the CSV column mapper: real broker exports can
  now be imported, and `lat`/`lng` are mappable columns, so section 7's
  premise is finally measurable rather than estimated. Read it off the first
  few real books before deciding.
```

- [ ] **Step 4: Validate and run the suite**

Run:

```bash
node -e "const d=require('./devlog.json');console.log('entries:',d.length)"
npm test
```

Expected: the entry count rises by one and the suite is green. CI also greps `devlog.json` for mojibake, so confirm `grep -c 'Ã\|â€\|Â' devlog.json` prints `0`.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -- CLAUDE.md devlog.json docs/ROADMAP.md
git commit -m "Document the vault CSV column mapper"
```

---

## Deploy

Follow the `deploy` skill. The order that matters here: **migration 021 runs before the code deploys** (Task 5 step 2 already did this if executed in order). The change is otherwise additive, and the rollback is reverting `vault-page.js`, since an absent `mapping` leaves the upload route behaving exactly as it does today.

Verify live at https://compninja.co/vault with a Pro account: a template file imports with no screen, a real export opens the screen.
