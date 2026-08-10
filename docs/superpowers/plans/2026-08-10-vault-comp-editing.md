# Vault Comp Editing, Adding and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a broker correct one comp, delete one comp, add one comp by hand, and export their whole vault as a CSV that re-imports cleanly.

**Architecture:** Four new routes on the existing `/api/vault*` prefix, all behind the same `openVault()` gate and all `user_id`-scoped. Every validation rule goes in the pure, tested `broker-vault.js`; `server.js` owns the database reads and writes; `vault-page.js` owns the browser. The edit path reuses the existing `normalizeRow` on a merged row rather than writing a second validator, which is what guarantees a hand-typed comp faces the same rejections a CSV row does.

**Tech Stack:** Plain Node (no dependencies, Node 18+), `node --test`, PostgREST via `sbRequest`, one giant template literal for the vault page.

## Global Constraints

- **No npm dependencies. Ever.** This repo runs on plain Node built-ins.
- **No migration.** `broker_comps.upload_id` is already nullable. Do not write one.
- **Every vault read and write is `user_id`-scoped**, including deletes. Without it, knowing another broker's comp id is enough to read, edit or delete their data.
- **Every new route goes through `openVault()`**, giving 401 not signed in → 403 not a broker (`canUseVault`) → 503 no database, in that order.
- **The vault has no file fallback.** A Supabase failure is a 503, never a local file. A broker's book must not silently land somewhere Render erases on deploy.
- **Rules live in `broker-vault.js`** (pure, no I/O, no requires). `market` is still computed in `server.js` with `marketOf()`, never in the module.
- **Node on this machine is portable:** `& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe"`. `npm test` works once that directory is on PATH.
- **Devlog entry rides in the same commit as the work** (`devlog.json`, clean UTF-8, never ASCII-escaped).
- Spec: `docs/superpowers/specs/2026-08-10-vault-comp-editing-design.md`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `broker-vault.js` | All validation and CSV shaping rules | Add `validateEdit`, `exportColumns`, `exportCsv` |
| `test/broker-vault.test.js` | Rules under test, no database | Add cases for the three new functions |
| `server.js` | Routes, database, entitlement gate | Add 4 routes + `retractPublishedComp` helper |
| `test/routes.test.js` | Proves the gates are wired to the routes | Add gate-order tests for the 4 routes |
| `vault-page.js` | The `/vault` page | Row actions, add form, export button |
| `test/vault-page.test.js` | Compiles the emitted script; pins page rules | Add cases for the new UI |
| `devlog.json` | Changelog | One entry |

---

### Task 1: `validateEdit` in broker-vault.js

The edit path must not become a second validator. It merges the patch over the existing comp's template-shaped fields and runs the **existing** `normalizeRow`, so every parser rejection, the `price_per_sqft` sales-only rule, and the `dedupe_key` format come along for free.

**Files:**
- Modify: `broker-vault.js` (add function + export near `normalizeRow`, line ~594)
- Test: `test/broker-vault.test.js`

**Interfaces:**
- Consumes: existing `normalizeRow(raw)`, `TEMPLATE_COLUMNS`, `OPTIONAL_SPEC_COLUMNS`
- Produces: `validateEdit(existing, patch)` returning `{ ok: true, row }` or `{ ok: false, errors: string[] }`. `row` is a full normalized row ready for a PostgREST PATCH, carrying recomputed `address_key`, `dedupe_key` and `price_per_sqft`, and possibly `_lat`/`_lng`.

- [ ] **Step 1: Write the failing tests**

```js
// in test/broker-vault.test.js
const VAULT = require("../broker-vault.js");

test("validateEdit merges a patch over the existing comp", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1000000,
    size_sqft: 10000, notes: "keep me",
  };
  const r = VAULT.validateEdit(existing, { price: "$1,250,000" });
  assert.equal(r.ok, true);
  assert.equal(r.row.price, 1250000);
  assert.equal(r.row.notes, "keep me", "unpatched fields survive");
  assert.equal(r.row.price_per_sqft, 125, "$/SF recomputed from the new price");
});

test("validateEdit refuses shorthand exactly as the importer does", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14",
  };
  const r = VAULT.validateEdit(existing, { price: "1.2M" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.join(" ").includes("price"), "the error names the field");
});

test("validateEdit recomputes the dedupe key when the price changes", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1000000,
  };
  const before = VAULT.normalizeRow(existing).row.dedupe_key;
  const after = VAULT.validateEdit(existing, { price: 1250000 }).row.dedupe_key;
  assert.notEqual(after, before);
  assert.equal(after, VAULT.normalizeRow({ ...existing, price: 1250000 }).row.dedupe_key,
    "the edit path must produce the same key the import path would");
});

test("validateEdit leaves price_per_sqft null when a sale becomes a lease", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Office",
    transaction: "sale", deal_date: "2025-03-14", price: 500000, size_sqft: 5000,
  };
  const r = VAULT.validateEdit(existing, { transaction: "lease" });
  assert.equal(r.ok, true);
  assert.equal(r.row.price_per_sqft, null,
    "an annual rent over size is $/SF/yr and must never enter that column");
});

test("validateEdit ignores keys that are not template fields", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14",
  };
  const r = VAULT.validateEdit(existing, { user_id: "someone-else", published: true });
  assert.equal(r.ok, true);
  assert.equal(r.row.user_id, undefined, "a patch may never set user_id");
  assert.equal(r.row.published, undefined, "a patch may never set published");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/broker-vault.test.js`
Expected: FAIL with `VAULT.validateEdit is not a function`

- [ ] **Step 3: Implement `validateEdit`**

Add directly below `normalizeRow` in `broker-vault.js`:

```js
// The fields a broker may change. Deliberately an ALLOWLIST built from the
// two column constants rather than "everything on the row": a patch that
// could set user_id would be an account-takeover primitive, and one that
// could set `published` would put a row in the public corpus without the
// submission that credits it.
const EDITABLE_FIELDS = Object.freeze([...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS]);

/**
 * Validate an edit to one stored comp.
 *
 * NOT a second validator. It rebuilds the row's template-shaped input, applies
 * the patch over it, and runs `normalizeRow` — the same function every
 * imported row goes through. That is what makes a hand-typed "1.2M" or an
 * Excel serial date fail here exactly as it fails on import, and what keeps
 * `dedupe_key`, `address_key` and the sales-only `price_per_sqft` rule
 * produced by one piece of code instead of two that can drift.
 *
 * `existing` is the stored row (or anything with the same field names).
 * `patch` is the browser's partial; keys outside EDITABLE_FIELDS are dropped.
 */
function validateEdit(existing, patch) {
  const base = existing && typeof existing === "object" ? existing : {};
  const p = patch && typeof patch === "object" ? patch : {};
  const merged = {};
  for (const f of EDITABLE_FIELDS) {
    merged[f] = Object.prototype.hasOwnProperty.call(p, f) ? p[f] : base[f];
  }
  return normalizeRow(merged);
}
```

Add `validateEdit` and `EDITABLE_FIELDS` to the `module.exports` block (~line 1077).

**`normalizeRow`'s return shape is already confirmed:** `{ ok: true, row }` or `{ ok: false, errors: [string] }`, carrying **every** problem with the row rather than the first, so a broker gets one complete list. `validateEdit` returns it unchanged; do not translate between two shapes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/broker-vault.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add broker-vault.js test/broker-vault.test.js
git commit -m "Vault: validateEdit, one comp through the importer's own rules"
```

---

### Task 2: Export shaping in broker-vault.js

**Files:**
- Modify: `broker-vault.js` (below `templateCsv`, ~line 895)
- Test: `test/broker-vault.test.js`

**Interfaces:**
- Consumes: `TEMPLATE_COLUMNS`, `OPTIONAL_SPEC_COLUMNS`, `csvCell`, `parseUpload`
- Produces: `exportColumns(rows) -> string[]` and `exportCsv(rows) -> string`. `rows` are objects carrying comp fields plus `lat`/`lng` already lifted from the joined property.

- [ ] **Step 1: Write the failing tests**

```js
test("an export with no per-type data is exactly the template columns", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1250000, size_sqft: 10000,
  }];
  assert.deepEqual(VAULT.exportColumns(rows), VAULT.TEMPLATE_COLUMNS);
});

test("an export carries the per-type columns that hold data, and only those", () => {
  const rows = [
    { address: "1 A St, Boise, ID", property_type: "Industrial",
      transaction: "sale", deal_date: "2025-01-02", clear_height: "32'" },
    { address: "2 B St, Boise, ID", property_type: "Industrial",
      transaction: "sale", deal_date: "2025-01-03", dock_doors: null },
  ];
  const cols = VAULT.exportColumns(rows);
  assert.ok(cols.includes("clear_height"), "a populated per-type column must survive the round trip");
  assert.ok(!cols.includes("dock_doors"), "an empty per-type column must not add a dead column");
  assert.deepEqual(cols.slice(0, VAULT.TEMPLATE_COLUMNS.length), VAULT.TEMPLATE_COLUMNS,
    "the template columns lead, in their own order");
});

test("the export round-trips back through the importer", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1250000,
    size_sqft: 10000, cap_rate: 5.75, tenancy: "Single tenant",
    year_built: "1998", notes: "Sold, fully leased", clear_height: "32'",
    lat: 43.6150, lng: -116.2023,
  }];
  const parsed = VAULT.parseUpload(VAULT.exportCsv(rows));
  assert.equal(parsed.rows.length, 1, parsed.errors && parsed.errors.join("; "));
  const r = parsed.rows[0];
  assert.equal(r.address, "100 Main St, Boise, ID");
  assert.equal(r.price, 1250000);
  assert.equal(r.size_sqft, 10000);
  assert.equal(r.clear_height, "32'");
  assert.equal(r._lat, 43.6150, "coordinates must survive, or a re-import sends the address to a geocoder");
  assert.equal(r._lng, -116.2023);
});

test("a note containing a comma survives the export", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Retail",
    transaction: "sale", deal_date: "2025-03-14", notes: 'Sold "as is", quickly',
  }];
  const parsed = VAULT.parseUpload(VAULT.exportCsv(rows));
  assert.equal(parsed.rows[0].notes, 'Sold "as is", quickly');
});

test("the export emits no comment lines", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Retail",
    transaction: "sale", deal_date: "2025-03-14",
  }];
  assert.ok(!VAULT.exportCsv(rows).split("\n").some((l) => l.startsWith("#")),
    "the template teaches; an export carries data");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/broker-vault.test.js`
Expected: FAIL with `VAULT.exportColumns is not a function`

- [ ] **Step 3: Implement the two functions**

```js
/**
 * The columns one export needs.
 *
 * TEMPLATE_COLUMNS alone is NOT the answer, and assuming it was is the bug
 * this function exists to prevent. The optional per-type columns
 * (clear_height, units, lot_acres and nine more) are importable and stored, so
 * an export without them would hand a broker a book with every clear height
 * gone — silently, which is the failure mode the whole vault is written
 * against. They are appended only when something actually carries data, so a
 * book with no per-type fields gets no trailing empty columns.
 */
function exportColumns(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const used = OPTIONAL_SPEC_COLUMNS.filter((c) =>
    list.some((r) => r && r[c] != null && String(r[c]).trim() !== ""));
  return [...TEMPLATE_COLUMNS, ...used];
}

/**
 * A broker's own comps as CSV, in the shape our own importer reads.
 *
 * The round trip is the requirement: export, fix fifty rows in Excel,
 * re-import with no mapping screen (a file already in our column names skips
 * it). A test runs the output of this function back through parseUpload.
 *
 * `lat`/`lng` must already be lifted onto each row from the joined property —
 * they are not columns on broker_comps. Omitting them would strip a private
 * address's coordinates on re-import and send it out to a third-party
 * geocoder on the next report.
 */
function exportCsv(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = exportColumns(list);
  return [
    cols.map(csvCell).join(","),
    ...list.map((r) => cols.map((c) => csvCell(r ? r[c] : "")).join(",")),
  ].join("\n") + "\n";
}
```

Export `exportColumns`, `exportCsv` and (if not already exported) `TEMPLATE_COLUMNS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/broker-vault.test.js`
Expected: PASS. If the round-trip test fails on `cap_rate` or a date, fix the SHAPING to match what `parseUpload` accepts; do not relax the test.

- [ ] **Step 5: Commit**

```bash
git add broker-vault.js test/broker-vault.test.js
git commit -m "Vault: export shaping that round-trips through the importer"
```

---

### Task 3: The retraction helper in server.js

Shared by edit and delete. Extracted first so both routes call one copy.

**Files:**
- Modify: `server.js` (near the `/api/vault/publish` route, ~line 11263)

**Interfaces:**
- Produces: `async retractPublishedComp(userId, comp) -> boolean` (true when something was retracted). Never throws on a missing submission row.

- [ ] **Step 1: Implement the helper**

```js
/**
 * Take a published comp back out of the public corpus.
 *
 * Editing or deleting a comp privately has a public consequence: publishing
 * wrote a comp_submissions row credited to the broker's firm. This is the same
 * retraction the unpublish branch of /api/vault/publish performs, and it
 * DELETES rather than marks rejected for the reason recorded there —
 * fetchVerifiedComps selects on status, and a retracted comp should leave no
 * public row at all.
 *
 * What it cannot undo: if the submission was already approved, the comp may
 * already have been served in reports and harvested into comp_corpus.
 * Retracting does not un-harvest those rows, and no caller should imply it
 * does.
 */
async function retractPublishedComp(userId, comp) {
  if (!comp || !comp.published) return false;
  if (comp.published_submission_id) {
    await sbRequest("DELETE",
      `comp_submissions?id=eq.${encodeURIComponent(comp.published_submission_id)}`,
      undefined, { prefer: "return=minimal" });
  }
  await sbRequest("PATCH",
    `broker_comps?id=eq.${encodeURIComponent(comp.id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { published: false, published_at: null, published_submission_id: null },
    { prefer: "return=minimal" });
  console.log(`Vault comp ${comp.id} retracted by user ${userId}`);
  return true;
}
```

- [ ] **Step 2: Point the existing unpublish branch at it**

In `/api/vault/publish`, replace the inline `publish === false` body with:

```js
if (publish === false) {
  await retractPublishedComp(user.id, comp);
  return sendJson(res, 200, { ok: true, published: false });
}
```

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS, unchanged count. This step only moves code.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Vault: one retraction path, shared by unpublish and the edit routes"
```

---

### Task 4: `PATCH` and `DELETE /api/vault/comp`

**Files:**
- Modify: `server.js` (inside the `/api/vault` block, beside `/api/vault/publish`)
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `openVault()`, `VAULT.validateEdit`, `retractPublishedComp`, `marketOf`, `linkVaultProperties`, `PROPS.stripCarriedKeys`
- Produces: `PATCH /api/vault/comp?id=` → `{ ok: true, comp, unpublished: boolean }`; `DELETE /api/vault/comp?id=` → `{ ok: true, unpublished: boolean }`

- [ ] **Step 1: Write the failing gate tests**

```js
// in test/routes.test.js, in the bare-environment suite
await t.test("the comp edit routes refuse an anonymous caller", async () => {
  for (const method of ["PATCH", "DELETE"]) {
    const r = await fetch(srv.base + "/api/vault/comp?id=00000000-0000-0000-0000-000000000000", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ price: 1 }) : undefined,
    });
    assert.equal(r.status, 401, method + " must refuse before it reads anything");
  }
});

await t.test("the add-comp route refuses an anonymous caller", async () => {
  const r = await fetch(srv.base + "/api/vault/comp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: "1 A St, Boise, ID" }),
  });
  assert.equal(r.status, 401);
});

await t.test("the vault export refuses an anonymous caller", async () => {
  const r = await fetch(srv.base + "/api/vault/export.csv");
  assert.equal(r.status, 401);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/routes.test.js`
Expected: FAIL with 404 rather than 401 (the routes do not exist yet).

- [ ] **Step 3: Implement both routes**

Inside the `path.startsWith("/api/vault")` block:

```js
// Edit or delete ONE comp. Both are user_id-scoped in the read AND in the
// write: without it, knowing another broker's comp id is enough to change
// their data.
if ((req.method === "PATCH" || req.method === "DELETE") && path === "/api/vault/comp") {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
  req.on("end", async () => {
    try {
      const user = await openVault();
      if (!user) return;
      if (rateLimited("vaultedit:" + clientIp(req), 120)) {
        return sendJson(res, 429, { error: "Too many requests. Please wait a moment." });
      }
      const id = new URL(req.url, "http://localhost").searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "Which comp?" });

      const rows = await sbRequest("GET",
        `broker_comps?id=eq.${encodeURIComponent(id)}` +
        `&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      const comp = rows && rows[0];
      if (!comp) return sendJson(res, 404, { error: "That comp isn't in your vault." });

      // A published comp is retracted before either operation. Owner's
      // decision: an edit leaves it unpublished so republishing is a
      // deliberate act by someone looking at the corrected row.
      const unpublished = await retractPublishedComp(user.id, comp);

      if (req.method === "DELETE") {
        await sbRequest("DELETE",
          `broker_comps?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
          undefined, { prefer: "return=minimal" });
        return sendJson(res, 200, { ok: true, unpublished });
      }

      const result = VAULT.validateEdit(comp, JSON.parse(body || "{}"));
      if (!result.ok) return sendJson(res, 400, { error: result.errors.join("; ") });

      const row = result.row;
      // marketOf lives in server.js and must agree byte for byte with
      // comp_corpus.market, so a comp published later needs no translation.
      row.market = marketOf(row.address);

      // A collision is answered by name rather than surfaced as a 500 from
      // the unique (user_id, dedupe_key) constraint. `id=neq` excludes the
      // comp being edited, or every no-op save would collide with itself.
      const clash = await sbRequest("GET",
        `broker_comps?user_id=eq.${encodeURIComponent(user.id)}` +
        `&dedupe_key=eq.${encodeURIComponent(row.dedupe_key)}` +
        `&id=neq.${encodeURIComponent(id)}&limit=1`);
      if (clash && clash.length) {
        return sendJson(res, 409, { error: "You already have this comp." });
      }

      // Exactly the upload route's order and argument shapes: the PATCH gets
      // the STRIPPED row (`_lat`/`_lng` are carried between functions and are
      // not columns on broker_comps — PostgREST 400s the whole write on an
      // unknown column), while linkVaultProperties gets the row that still
      // carries them, because PROPS.propertyRowsFrom reads them off it.
      const saved = await sbRequest("PATCH",
        `broker_comps?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
        PROPS.stripCarriedKeys({ ...row }), { prefer: "return=representation" });
      // Two arguments, never three, and it never throws: the property
      // dimension is an index onto a broker's book, not part of it. A failed
      // link costs a join, a failed edit costs the broker their correction.
      await linkVaultProperties(user.id, [row]);
      return sendJson(res, 200, {
        ok: true, unpublished,
        comp: VAULTAPI.toApiComp((saved && saved[0]) || null),
      });
    } catch (err) {
      console.error("vault comp edit failed:", err.message);
      sendJson(res, 502, { error: "Could not save that change. Please try again." });
    }
  });
  return;
}
```

**Signatures already confirmed against the code**, so match them exactly: `normalizeRow(raw)` returns `{ ok: true, row }` or `{ ok: false, errors }`; `linkVaultProperties(userId, comps)` takes **two** arguments and returns nothing useful; `PROPS.stripCarriedKeys(row)` is applied per row (the upload route calls `rows.map(PROPS.stripCarriedKeys)`); `VAULTAPI.toApiComp` and `toApiComps` are both exported from `vault-api.js`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, including the new 401 assertions.

- [ ] **Step 5: Commit**

```bash
git add server.js test/routes.test.js
git commit -m "Vault: edit and delete one comp"
```

---

### Task 5: `POST /api/vault/comp`

**Files:**
- Modify: `server.js` (beside the routes from Task 4)
- Test: `test/routes.test.js` (the POST 401 test is already written in Task 4 Step 1)

**Interfaces:**
- Consumes: `openVault()`, `VAULT.normalizeRow`, `marketOf`, `linkVaultProperties`
- Produces: `POST /api/vault/comp` → `201 { ok: true, comp }`

- [ ] **Step 1: Implement**

```js
// Add ONE comp by hand. A broker who closed a deal on Tuesday should not
// have to author a CSV to record it.
//
// Runs the IDENTICAL row parser the upload path uses. Two entry doors, one
// set of rules — a form handler with its own validation would quietly accept
// the "1.2M" and the Excel serial dates that broker-vault.js exists to
// refuse.
if (req.method === "POST" && path === "/api/vault/comp") {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
  req.on("end", async () => {
    try {
      const user = await openVault();
      if (!user) return;
      if (rateLimited("vaultadd:" + clientIp(req), 60)) {
        return sendJson(res, 429, { error: "Too many requests. Please wait a moment." });
      }
      const result = VAULT.normalizeRow(JSON.parse(body || "{}"));
      if (!result.ok) return sendJson(res, 400, { error: result.errors.join("; ") });

      const row = result.row;
      row.user_id = user.id;
      // upload_id stays null: this comp belongs to no import. The column is
      // nullable already, which is why this feature needs no migration.
      row.market = marketOf(row.address);

      const clash = await sbRequest("GET",
        `broker_comps?user_id=eq.${encodeURIComponent(user.id)}` +
        `&dedupe_key=eq.${encodeURIComponent(row.dedupe_key)}&limit=1`);
      if (clash && clash.length) {
        return sendJson(res, 409, { error: "You already have this comp." });
      }

      // Same split as the upload and edit routes: the insert gets the
      // stripped row, the property link gets the one still carrying
      // `_lat`/`_lng`.
      const saved = await sbRequest("POST", "broker_comps",
        [PROPS.stripCarriedKeys({ ...row })], { prefer: "return=representation" });
      await linkVaultProperties(user.id, [row]);
      return sendJson(res, 201, { ok: true, comp: VAULTAPI.toApiComp((saved && saved[0]) || null) });
    } catch (err) {
      console.error("vault comp add failed:", err.message);
      sendJson(res, 502, { error: "Could not save that comp. Please try again." });
    }
  });
  return;
}
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Vault: add one comp by hand, through the importer's own parser"
```

---

### Task 6: `GET /api/vault/export.csv`

**Files:**
- Modify: `server.js`
- Test: `test/routes.test.js` (the 401 test is already written in Task 4 Step 1)

**Interfaces:**
- Consumes: `openVault()`, `VAULT.exportCsv`
- Produces: a `text/csv` download of every comp the caller owns

- [ ] **Step 1: Implement**

```js
// The whole book, as the file our own importer reads.
//
// NOT built from vaultReadPayload. That path hard-caps at 1000 rows
// (Math.min(..., 1000)) and the dashboard already fetches ?limit=1000 and
// filters in the browser — so an export built from it would silently
// truncate exactly the large books that most need exporting. This pages
// until the vault is exhausted.
//
// It also JOINS broker_properties for lat/lng. Those are template columns but
// they are not columns on broker_comps; emitting them empty would strip a
// private address's coordinates on re-import and send it back out to a
// third-party geocoder on the next report.
if (req.method === "GET" && path === "/api/vault/export.csv") {
  (async () => {
    const user = await openVault();
    if (!user) return;
    if (rateLimited("vaultexp:" + clientIp(req), 20)) {
      return sendJson(res, 429, { error: "Too many requests. Please wait a moment." });
    }
    const PAGE = 1000;
    const comps = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await sbRequest("GET",
        `broker_comps?user_id=eq.${encodeURIComponent(user.id)}` +
        `&order=deal_date.desc&limit=${PAGE}&offset=${offset}`);
      if (!page || !page.length) break;
      comps.push(...page);
      if (page.length < PAGE) break;
    }

    // Coordinates in TWO plain queries rather than a PostgREST embed.
    // The embed's relationship name depends on how the FK was declared in
    // migration 016 and would have to be discovered against a live database;
    // a wrong guess makes the whole export 400 rather than degrade. This is
    // one extra round trip on a download that already pages, and it is
    // obvious what it does.
    const propIds = [...new Set(comps.map((c) => c.property_id).filter(Boolean))];
    const coords = new Map();
    for (let i = 0; i < propIds.length; i += 200) {
      const slice = propIds.slice(i, i + 200);
      const props = await sbRequest("GET",
        `broker_properties?user_id=eq.${encodeURIComponent(user.id)}` +
        `&id=in.(${slice.map(encodeURIComponent).join(",")})&select=id,lat,lng`);
      for (const p of props || []) coords.set(p.id, p);
    }
    const rows = comps.map((c) => {
      const p = coords.get(c.property_id) || {};
      return { ...c, lat: p.lat, lng: p.lng };
    });

    const csv = VAULT.exportCsv(rows);
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="compninja-vault.csv"',
      "cache-control": "no-store",
    });
    res.end(csv);
  })().catch((err) => {
    console.error("vault export failed:", err.message);
    sendJson(res, 502, { error: "Could not build your export. Please try again." });
  });
  return;
}
```

**One thing to watch:** `property_id` is nullable on purpose (migration 016 was written so migrate-then-deploy and deploy-then-migrate both work), and `linkVaultProperties` never throws, so some comps legitimately have no property row. Those export with empty `lat`/`lng`, which is correct: they never had coordinates to lose. Do not "fix" this by falling back to geocoding here.

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Vault: export the whole book as a CSV that re-imports"
```

---

### Task 7: The page, part one — row actions

**Files:**
- Modify: `vault-page.js`
- Test: `test/vault-page.test.js`

**Interfaces:**
- Consumes: `PATCH`/`DELETE /api/vault/comp`
- Produces: an Edit and a Delete control on each comp row

- [ ] **Step 1: Write the failing tests**

```js
// in test/vault-page.test.js, alongside the existing cases
test("each comp row offers an edit and a delete", () => {
  const html = renderVaultHTML(BOOT, CHROME);
  assert.ok(html.includes("compEdit"), "rows need an edit control");
  assert.ok(html.includes("compDelete"), "rows need a delete control");
});

test("deleting a comp is confirmed before it is sent", () => {
  const html = renderVaultHTML(BOOT, CHROME);
  assert.ok(/confirm\(/.test(html), "a hard delete with no undo must be confirmed");
});

test("the page warns that editing a published comp unpublishes it", () => {
  const html = renderVaultHTML(BOOT, CHROME);
  assert.ok(/unpublish/i.test(html),
    "a broker must not discover the retraction later");
});

test("the emitted script still parses with the row actions in it", () => {
  // The whole page is one template literal, so a stray ${ or a single
  // backslash emits broken JavaScript and a blank workspace rather than
  // failing loudly. This compiles what the page actually emits.
  const html = renderVaultHTML(BOOT, CHROME);
  const script = extractScript(html);   // the helper the existing tests use
  assert.doesNotThrow(() => new Function(script));
});
```

Reuse the existing suite's `BOOT`, `CHROME` and script-extraction helpers rather than inventing new ones.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/vault-page.test.js`
Expected: FAIL on the missing controls.

- [ ] **Step 3: Implement**

In the comps table row builder, add a trailing actions cell with `compEdit`/`compDelete` buttons carrying `data-id`. Add handlers:

```js
async function deleteComp(id){
  if(!confirm("Delete this comp? This cannot be undone."))return;
  var r=await fetch("/api/vault/comp?id="+encodeURIComponent(id),{method:"DELETE"});
  var j=await r.json().catch(function(){return{};});
  if(!r.ok)return msg(j.error||"Could not delete that comp.");
  // ?noseed=1 for the same reason the BOV list passes it after a delete:
  // a reload that reseeds would resurrect the row just removed.
  load({noseed:true});
  msg(j.unpublished?"Deleted, and withdrawn from the public corpus.":"Deleted.");
}
```

The edit control swaps the row for an inline form pre-filled from the comp, and sends **only changed fields** so an untouched field cannot be rewritten by a stale value the page happened to be holding:

```js
// The fields the inline editor exposes. Same names as the CSV columns, which
// is what lets the server hand the patch straight to validateEdit.
var EDIT_FIELDS=["address","property_type","transaction","deal_date",
                 "price","size_sqft","cap_rate","tenancy","year_built","notes"];

async function saveComp(id,before){
  var patch={},any=false;
  EDIT_FIELDS.forEach(function(f){
    var el=$("edit_"+f); if(!el)return;
    var v=el.value.trim();
    var was=before[f]==null?"":String(before[f]);
    if(v!==was){patch[f]=v;any=true;}
  });
  if(!any){closeEditor();return;}
  var r=await fetch("/api/vault/comp?id="+encodeURIComponent(id),{
    method:"PATCH",headers:{"content-type":"application/json"},
    body:JSON.stringify(patch)});
  var j=await r.json().catch(function(){return{};});
  // 409 and 400 both carry a sentence written for the broker. Show it as it
  // is rather than replacing it with a generic failure — "You already have
  // this comp." tells them what to do and "Could not save" does not.
  if(!r.ok)return msg(j.error||"Could not save that change.");
  closeEditor();
  load({noseed:true});
  msg(j.unpublished
    ? "Saved. This comp was published, so it has been withdrawn from the public corpus — publish it again when you are happy with it."
    : "Saved.");
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vault-page.js test/vault-page.test.js
git commit -m "Vault page: fix or remove one comp without touching the import"
```

---

### Task 8: The page, part two — add form and export button

**Files:**
- Modify: `vault-page.js`
- Test: `test/vault-page.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test("the page offers an add-one-comp form with the four required fields", () => {
  const html = renderVaultHTML(BOOT, CHROME);
  for (const f of ["address", "property_type", "transaction", "deal_date"]) {
    assert.ok(html.includes("addComp_" + f), "the add form needs " + f);
  }
});

test("there is still exactly one file input on the page", () => {
  const html = renderVaultHTML(BOOT, CHROME);
  const inputs = (html.match(/type=["']?file/g) || []).length;
  assert.equal(inputs, 1,
    "two inputs would mean two values and two change handlers");
});

test("the export button says it exports everything", () => {
  const html = renderVaultHTML(BOOT, CHROME);
  assert.ok(/Export all comps/.test(html),
    "the label must remove any ambiguity about the dashboard filter");
});

test("the emitted script still parses with the add form in it", () => {
  const script = extractScript(renderVaultHTML(BOOT, CHROME));
  assert.doesNotThrow(() => new Function(script));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/vault-page.test.js`
Expected: FAIL on the missing form fields.

- [ ] **Step 3: Implement**

Add the form inside the existing `#addSec` section. Do **not** add a second `<input type=file>`: step 1's button and "Add comps" both already call `$("file").click()`, and two inputs would mean two values and two change handlers, with an upload started from one invisible to the other's result message.

Field ids are `addComp_<column>`, so the submit handler can build the row generically and the server can hand it straight to `normalizeRow`:

```js
// Per-type columns, mirroring TYPE_COMP_FIELDS in server.js. A field the
// chosen type does not use is not rendered, so a broker is never asked for an
// Industrial clear height on a Multifamily deal.
var TYPE_FIELDS={
  Industrial:["clear_height","dock_doors"],
  Office:["building_class","floor_plate"],
  Retail:["center_type","anchor_tenant"],
  Multifamily:["units","price_per_unit"],
  Land:["lot_acres","price_per_acre","zoning"],
  Residential:["beds_baths"],
};
var BASE_FIELDS=["address","property_type","transaction","deal_date",
                 "price","size_sqft","cap_rate","tenancy","year_built",
                 "notes","lat","lng"];

async function addComp(){
  var body={};
  BASE_FIELDS.concat(TYPE_FIELDS[$("addComp_property_type").value]||[])
    .forEach(function(f){var el=$("addComp_"+f); if(el&&el.value.trim())body[f]=el.value.trim();});
  var r=await fetch("/api/vault/comp",{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  var j=await r.json().catch(function(){return{};});
  // The server returns EVERY problem with the row, not just the first, so a
  // broker fixing a form gets one complete list. Show it whole.
  if(!r.ok)return msg(j.error||"Could not save that comp.");
  BASE_FIELDS.forEach(function(f){var el=$("addComp_"+f); if(el)el.value="";});
  load({noseed:true});
  msg("Added.");
}
```

Export is a plain anchor. The session cookie rides along and the browser handles the download with no JavaScript, which also means it keeps working if the page's script has failed:

```html
<a class="btn" href="/api/vault/export.csv">Export all comps (CSV)</a>
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vault-page.js test/vault-page.test.js
git commit -m "Vault page: add one comp, and take the whole book with you"
```

---

### Task 9: Drive it in a browser, then devlog

The vault page is ~550 lines of browser JS inside a template literal. A green suite does not prove the page works; the tests compile the script, they do not run the flows.

- [ ] **Step 1: Start a server**

Add a `.claude/launch.json` entry on a free port with `ACCOUNT_WALL=off`, `PRO_ENABLED=on`, and a real `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` pointing at a disposable project. **The vault has no file fallback, so without a database every route here answers 503 and nothing can be exercised.**

- [ ] **Step 2: Walk the four flows**

Sign in, then confirm each by observation, not by assumption:

1. Upload the template's own examples (edit the `#` out of one address so it imports), then edit that comp's price. The table shows the new price and the new $/SF.
2. Publish a comp, then edit it. The response says it was unpublished, the page says so, and the comp shows as unpublished.
3. Delete a comp. It is gone after the reload, and it does not come back.
4. Export. Open the CSV, confirm the per-type and coordinate columns are present, then re-import that exact file and confirm the mapping screen does not appear and the row count matches.

- [ ] **Step 3: Add the devlog entry**

Append one entry to `devlog.json` (clean UTF-8, em dashes raw, never escaped), shape `{"date":"YYYY-MM-DD","type":"feature","title":"...","details":"..."}`. Say what a broker can now do, and name the two rules worth remembering: a published comp is retracted when it is edited or deleted, and the export carries the per-type and coordinate columns so it re-imports whole.

- [ ] **Step 4: Full suite plus syntax check**

```bash
node --check server.js && npm test
```

- [ ] **Step 5: Commit**

```bash
git add devlog.json
git commit -m "Devlog: vault comp editing, adding and export"
```

---

## Notes for whoever executes this

- **`main` in this checkout is diverged from `origin/main`.** Branch off `origin/main`, not off local `main`. A second session shares this working tree: stage explicit paths, never `git add -A`, and read the whole diff before every commit.
- **Do not add a migration.** If you find yourself wanting one, re-read section 6 of the spec: `upload_id` is already nullable.
- **Do not widen `API_COMP_FIELDS` to make something easier.** The tests check it against the `broker_comps` schema in both directions, and that tripwire is load-bearing. Coordinates belong to `PROPERTY_FIELDS` for exactly this reason.
- **The 1000-row cap in `vaultReadPayload` is not a bug to fix.** It is the dashboard's cap. The export route is separate precisely so it can ignore it.
