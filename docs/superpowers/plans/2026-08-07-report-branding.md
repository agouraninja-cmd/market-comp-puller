# Report Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a paying member put their firm's logo and details on the reports they hand to clients, co-branded with CompNinja, including on a report they share with a named client.

**Architecture:** One new pure module (`branding.js`) decides what brand block renders and validates what may be saved. `server.js` owns three CRUD routes, one new serialization-time field on the report, and a share-time snapshot. `index.html` gains an editor card on `/desk` and applies the brand to four surfaces that already exist. No migration: `branding_profiles` has held every column since migration 008.

**Tech Stack:** Plain Node (built-in `fetch`, `node:test`), zero npm dependencies, Supabase over PostgREST, vanilla JS in one `index.html`, html2canvas (already vendored via CDN) for the PNG export.

**Spec:** `docs/superpowers/specs/2026-08-07-report-branding-design.md`. Read it before Task 1; this plan implements it and does not restate its reasoning.

## Global Constraints

- **Zero npm dependencies.** Node 18+ built-ins only. No build step.
- **Pure modules stay pure:** no I/O, no `require` of impure code, no clock reads. This is what lets `npm test` run with no database.
- **`npm test` must pass after every task.** It runs in about 1.5 seconds.
- **Never test a plan or subscription status outside `entitlements.js`.** Use `entitlementsFor(req, reportId)` / `getEntitlements(user, reportId)`.
- **Co-branded, never white label.** CompNinja remains the stated author of the valuation on every surface.
- **The automated-estimate line is never removed by any configuration.** The member's own `disclaimer` is additive. CompNinja never claims to be a broker, and a valuation is never called an appraisal.
- **Invisible until configured:** a member with no profile gets a report byte-identical to today's.
- **A shared report renders the sender's snapshotted brand and never the viewer's own profile.**
- **Reuse existing Tailwind classes only.** A new utility class needs the vendored `tailwind.css` regenerated; if one is genuinely unavoidable, say so loudly rather than adding it silently.
- **`index.html` has ONE inline `<script>`.** A syntax error there kills the whole front end while the page still renders. Prove it parses by extracting the block and running `node --check`.
- **Restart rule:** editing `index.html` needs no restart; editing `server.js` does.

---

### Task 1: `branding.js`, the decision and the validator

**Files:**
- Create: `branding.js`
- Test: `test/branding.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, used by every later task:
  - `brandForRender({ profile, canBrand, sharedBranding, isShared }) -> block | null`
  - `validateForSave(raw) -> { error: string } | { row: object }`
  - `normalizeBrand(raw) -> block | null`
  - Constants `TEXT_LIMITS`, `LOGO_SAVE_MAX`, `LOGO_RENDER_MAX`.
  - A `block` is `{ logo?, firmName?, preparerName?, phone?, email?, licenseNumber?, disclaimer? }` with empty fields omitted.
  - A `row` is snake_case for PostgREST: `{ logo_url, firm_name, preparer_name, phone, email, license_number, disclaimer }`.

- [ ] **Step 1: Write the failing test**

Create `test/branding.test.js`:

```js
// What brand renders, and what may be saved. Pure like entitlements.test.js:
// no server, no database, no clock.
const test = require("node:test");
const assert = require("node:assert");
const { brandForRender, validateForSave, normalizeBrand, LOGO_SAVE_MAX } = require("../branding.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const ROW = {
  logo_url: PNG, firm_name: "Adler Industrial", preparer_name: "Jacob Adler",
  phone: "208-555-0100", email: "jacob@example.com", license_number: "SP12345",
  disclaimer: "Prepared for discussion purposes.",
};

test("a DB row normalizes to camelCase with every field carried", () => {
  const b = normalizeBrand(ROW);
  assert.equal(b.firmName, "Adler Industrial");
  assert.equal(b.preparerName, "Jacob Adler");
  assert.equal(b.licenseNumber, "SP12345");
  assert.equal(b.logo, PNG);
});

test("empty fields are omitted rather than carried as empty strings", () => {
  const b = normalizeBrand({ firm_name: "Adler Industrial", phone: "  " });
  assert.equal("phone" in b, false);
  assert.equal(b.firmName, "Adler Industrial");
});

test("a brand needs a logo or a firm name; contact details alone are not a brand", () => {
  assert.equal(normalizeBrand({ phone: "208-555-0100", email: "a@b.co" }), null);
  assert.notEqual(normalizeBrand({ firm_name: "Adler Industrial" }), null);
  assert.notEqual(normalizeBrand({ logo_url: PNG }), null);
});

test("a logo that is not a data: image URI is dropped, and the text survives", () => {
  // A URL here would taint the html2canvas canvas and break PNG export.
  const b = normalizeBrand({ ...ROW, logo_url: "https://example.com/logo.png" });
  assert.equal("logo" in b, false);
  assert.equal(b.firmName, "Adler Industrial");
});

test("junk in, null out, without throwing", () => {
  assert.equal(normalizeBrand(null), null);
  assert.equal(normalizeBrand("nope"), null);
  assert.equal(normalizeBrand([]), null);
  assert.equal(normalizeBrand({}), null);
});

test("over-long text is truncated at render, not dropped", () => {
  const b = normalizeBrand({ firm_name: "x".repeat(200) });
  assert.equal(b.firmName.length, 80);
});

// --- brandForRender: the decision ------------------------------------------

test("no entitlement means no brand, however complete the profile", () => {
  assert.equal(brandForRender({ profile: ROW, canBrand: false }), null);
});

test("an entitled member with a profile gets their brand", () => {
  const b = brandForRender({ profile: ROW, canBrand: true });
  assert.equal(b.firmName, "Adler Industrial");
});

test("an entitled member with no profile gets null, not an empty block", () => {
  assert.equal(brandForRender({ profile: null, canBrand: true }), null);
});

test("a SHARED report renders the sender's brand", () => {
  const b = brandForRender({ isShared: true, sharedBranding: { firmName: "Sender Co" } });
  assert.equal(b.firmName, "Sender Co");
});

test("a shared report NEVER falls back to the viewer's own profile", () => {
  // The trap this module exists to make impossible: a Pro client opening their
  // broker's report must not see their own logo on it.
  const b = brandForRender({
    isShared: true, sharedBranding: null,
    profile: ROW, canBrand: true,
  });
  assert.equal(b, null);
});

test("a shared report with junk branding is unbranded, not viewer-branded", () => {
  const b = brandForRender({
    isShared: true, sharedBranding: { phone: "208-555-0100" },
    profile: ROW, canBrand: true,
  });
  assert.equal(b, null);
});

// --- validateForSave -------------------------------------------------------

test("a good profile saves as a snake_case row", () => {
  const r = validateForSave({
    logo: PNG, firmName: "Adler Industrial", preparerName: "Jacob Adler",
    phone: "208-555-0100", email: "jacob@example.com", licenseNumber: "SP12345",
    disclaimer: "Prepared for discussion purposes.",
  });
  assert.equal(r.error, undefined);
  assert.equal(r.row.firm_name, "Adler Industrial");
  assert.equal(r.row.license_number, "SP12345");
  assert.equal(r.row.logo_url, PNG);
});

test("saving rejects rather than truncates an over-long field, and names it", () => {
  const r = validateForSave({ firmName: "x".repeat(200) });
  assert.match(r.error, /firm/i);
  assert.equal(r.row, undefined);
});

test("saving rejects a logo that is not a data: image URI", () => {
  const r = validateForSave({ firmName: "A", logo: "https://example.com/logo.png" });
  assert.match(r.error, /PNG or JPEG/i);
});

test("saving rejects an oversized logo and names the limit", () => {
  const big = "data:image/png;base64," + "A".repeat(LOGO_SAVE_MAX + 10);
  const r = validateForSave({ firmName: "A", logo: big });
  assert.match(r.error, /150/);
});

test("an empty profile saves as an all-empty row, which is how a member clears it", () => {
  const r = validateForSave({});
  assert.equal(r.error, undefined);
  assert.equal(r.row.firm_name, "");
  assert.equal(r.row.logo_url, "");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/branding.test.js`
Expected: FAIL, `Cannot find module '../branding.js'`.

- [ ] **Step 3: Write the module**

Create `branding.js`:

```js
// ---------------------------------------------------------------------------
// Report branding — what mark goes on a member's own report.
//
// Spec: docs/superpowers/specs/2026-08-07-report-branding-design.md
//
// PURE, like entitlements.js, comp-gate.js and report-access.js: no I/O, no
// requires, no clock reads. server.js owns the reads and writes and hands the
// data in. That is what lets `npm test` exercise the whole decision table with
// no database.
//
// CO-BRANDED, NEVER WHITE LABEL. This module returns the MEMBER's mark. The
// CompNinja attribution and the automated-estimate line are rendered by the
// surfaces themselves and are not this module's to remove. The owner is not a
// licensed broker; a report carrying only a brokerage's mark would read as that
// brokerage's own appraisal work.
// ---------------------------------------------------------------------------

// camelCase (API + render) -> snake_case (PostgREST column) -> max length.
const FIELDS = [
  ["firmName", "firm_name", 80],
  ["preparerName", "preparer_name", 80],
  ["phone", "phone", 40],
  ["email", "email", 120],
  ["licenseNumber", "license_number", 40],
  ["disclaimer", "disclaimer", 300],
];

const TEXT_LIMITS = Object.fromEntries(FIELDS.map(([k, , max]) => [k, max]));

// The logo is stored INLINE as a data URI, never as a URL, and this regex is
// what enforces it. A cross-origin image taints the html2canvas canvas, and a
// tainted canvas makes the PNG export throw — so one pasted logo URL would
// silently break image export for every report that member touches.
const LOGO_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

// Two limits, deliberately different. Saving refuses above 150KB. Rendering
// tolerates a little more, so a logo saved under some earlier cap is still
// drawn rather than silently vanishing from a member's letterhead; render only
// refuses things that are not images at all.
const LOGO_SAVE_MAX = 150000;
const LOGO_RENDER_MAX = 200000;

function clean(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * A stored row or an API body -> the block the surfaces render, or null.
 * Accepts either shape, so the same function serves a PostgREST row and a
 * `meta.branding` snapshot that has already been camelCased.
 */
function normalizeBrand(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [camel, snake, max] of FIELDS) {
    const v = clean(raw[camel] !== undefined ? raw[camel] : raw[snake], max);
    if (v) out[camel] = v;
  }
  const logo = String(raw.logo !== undefined ? raw.logo : (raw.logo_url || "")).trim();
  if (logo && logo.length <= LOGO_RENDER_MAX && LOGO_RE.test(logo)) out.logo = logo;

  // Contact details alone are not a brand. Without a logo or a firm name there
  // is nothing that makes the page look like anyone's document, and a
  // letterhead consisting of a bare phone number reads as a bug.
  if (!out.logo && !out.firmName) return null;
  return out;
}

/**
 * What mark does THIS render use?
 *
 * @param {object|null} profile        the viewer's own stored profile
 * @param {boolean}     canBrand       report-scoped entitlement (never a plan test)
 * @param {object|null} sharedBranding meta.branding from a shared report
 * @param {boolean}     isShared       is the thing on screen someone else's share?
 */
function brandForRender({ profile, canBrand, sharedBranding, isShared } = {}) {
  // A shared report is decided ENTIRELY by its own snapshot, and returns here
  // whatever the answer is. Never fall through to the viewer's profile: a Pro
  // member opening a report their broker sent them must not see their own logo
  // on it. The sender's entitlement was checked when the share was created.
  if (isShared) return normalizeBrand(sharedBranding);
  if (!canBrand) return null;
  return normalizeBrand(profile);
}

/**
 * An API body -> a PostgREST row, or an error message for the member.
 * Rejects rather than truncates: silently shortening someone's firm name on
 * their own letterhead is worse than telling them it is too long.
 */
function validateForSave(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Bad request." };
  }
  const row = {};
  for (const [camel, snake, max] of FIELDS) {
    const s = String(raw[camel] == null ? "" : raw[camel]).replace(/\s+/g, " ").trim();
    if (s.length > max) {
      const label = camel.replace(/([A-Z])/g, " $1").toLowerCase();
      return { error: `Your ${label} is too long (limit ${max} characters).` };
    }
    row[snake] = s;
  }
  const logo = String(raw.logo == null ? "" : raw.logo).trim();
  if (logo) {
    if (!LOGO_RE.test(logo)) {
      return { error: "The logo must be a PNG or JPEG image." };
    }
    if (logo.length > LOGO_SAVE_MAX) {
      return { error: "That logo is too large. Please use an image under 150KB." };
    }
  }
  row.logo_url = logo;
  return { row };
}

module.exports = { brandForRender, normalizeBrand, validateForSave, TEXT_LIMITS, LOGO_SAVE_MAX, LOGO_RENDER_MAX };
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/branding.test.js` then `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add branding.js test/branding.test.js
git commit -m "What mark goes on a report, as one pure decision"
```

---

### Task 2: The three branding routes

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `validateForSave` (Task 1), `getSessionUser`, `sbRequest`, `DB_CONFIGURED`, `findBrandingProfile` (already in server.js, currently called by nothing).
- Produces: `GET|PUT|DELETE /api/branding`. Task 5 consumes all three.

- [ ] **Step 1: Require the module**

At the top of `server.js`, beside the other module requires:

```js
const BRANDING = require("./branding.js");
```

- [ ] **Step 2: Add the routes**

Place them beside the other account-scoped routes. Read `/api/broker/coverage` in the same file first: it is the house model for body reading, size caps, refusal order and error copy.

```js
  // --- Report branding: the member's own mark -------------------------------
  //
  // Saving is deliberately NOT gated on canBrand. That entitlement is
  // per-report (`pro || reportUnlocked`), so a $20 single-report buyer holds it
  // only for the report they bought — gating this editor on Pro would make the
  // $20 tile's own branding promise unfulfillable. A saved profile with no
  // entitlement is inert: brandForRender returns null for it, and POST
  // /api/share refuses to snapshot it. The gate is on APPLYING, not on saving.
  if (req.url.split("?")[0] === "/api/branding") {
    if (req.method === "GET") {
      (async () => {
        const user = await getSessionUser(req);
        if (!user) return sendJson(res, 401, { error: "Please sign in." });
        if (!DB_CONFIGURED) return sendJson(res, 503, { error: "Branding is unavailable right now." });
        const row = await findBrandingProfile(user.id);
        // Answer the API shape, not the table shape, so the column names stay
        // ours to change. An absent profile is {}, not 404: "you have no
        // branding yet" is a normal state, not an error.
        return sendJson(res, 200, { branding: BRANDING.normalizeBrand(row) || {} });
      })().catch((err) => {
        console.error("Branding read failed:", err.message);
        return sendJson(res, 503, { error: "Couldn't load your branding. Please try again in a minute." });
      });
      return;
    }

    if (req.method === "PUT") {
      let body = "";
      // 300KB: a 150KB logo is ~200KB as base64 inside JSON, plus the fields.
      req.on("data", (c) => { body += c; if (body.length > 3e5) req.destroy(); });
      req.on("end", async () => {
        try {
          const user = await getSessionUser(req);
          if (!user) return sendJson(res, 401, { error: "Please sign in." });
          if (!DB_CONFIGURED) return sendJson(res, 503, { error: "Branding is unavailable right now." });
          const parsed = JSON.parse(body || "{}");
          const checked = BRANDING.validateForSave(parsed);
          if (checked.error) return sendJson(res, 400, { error: checked.error });
          await sbRequest("POST", "branding_profiles?on_conflict=user_id",
            [{ ...checked.row, user_id: user.id, updated_at: new Date().toISOString() }],
            { prefer: "resolution=merge-duplicates,return=minimal" });
          return sendJson(res, 200, { branding: BRANDING.normalizeBrand(checked.row) || {} });
        } catch (err) {
          if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
          console.error("Branding save failed:", err.message);
          return sendJson(res, 503, { error: "Couldn't save your branding. Please try again in a minute." });
        }
      });
      return;
    }

    if (req.method === "DELETE") {
      (async () => {
        const user = await getSessionUser(req);
        if (!user) return sendJson(res, 401, { error: "Please sign in." });
        if (!DB_CONFIGURED) return sendJson(res, 503, { error: "Branding is unavailable right now." });
        // Scoped by user_id in the QUERY, never checked afterwards — the same
        // rule every vault, share and coverage route follows.
        await sbRequest("DELETE",
          `branding_profiles?user_id=eq.${encodeURIComponent(user.id)}`, undefined,
          { prefer: "return=minimal" });
        return sendJson(res, 200, { ok: true });
      })().catch((err) => {
        console.error("Branding delete failed:", err.message);
        return sendJson(res, 503, { error: "Couldn't remove your branding. Please try again in a minute." });
      });
      return;
    }
  }
```

- [ ] **Step 3: Compile and test**

Run: `node --check server.js && npm test`
Expected: pass.

- [ ] **Step 4: Prove the refusals by hand**

Start the server (`npm start`), then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/branding
```

Expected: `401`. Kill the server afterwards; do not leave it running.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "A member can save the mark that goes on their reports"
```

---

### Task 3: `branding_allowed` on the report

**Files:**
- Modify: `server.js` (the `gate` closure inside `POST /api/comps`)

**Interfaces:**
- Produces: `report.branding_allowed`, a per-visitor boolean. Task 6 reads it in the browser.

- [ ] **Step 1: Understand why it goes here and nowhere else**

`/api/comps` resolves entitlements **with the report id**, so `ent.canBrand` there already accounts for a single-report purchase. `/api/config` cannot: it takes no report id. The `gate` closure already decorates the response with `exports_remaining` for exactly this reason, and this field sits beside it.

The front end's existing "is this unlocked" signal, `lockedCount() === 0`, is **not** usable: a free visitor whose thin-market report had four or fewer comps also has zero locked comps, and branding would apply to people who never paid.

- [ ] **Step 2: Add the field**

In the `gate` closure, on the line after `exports_remaining` is added:

```js
          // Per-visitor and per-REPORT, for the same reason exports_remaining is:
          // `ent` was resolved with this report's id, so it knows a $20
          // single-report unlock carries branding for this property. The
          // browser cannot work this out for itself — /api/config's canBrand
          // takes no report id, and lockedCount() === 0 is also true for a free
          // visitor whose thin market simply returned fewer comps than the gate.
          // Serialization-time like everything else here, so the cached object
          // never carries one visitor's entitlement to the next.
          const withExports = { ...gated, exports_remaining: ent.exportsRemaining, branding_allowed: ent.canBrand === true };
```

(Replace the existing `const withExports = { ...gated, exports_remaining: ent.exportsRemaining };` line.)

- [ ] **Step 3: Compile and test**

Run: `node --check server.js && npm test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "The report says whether this visitor may brand it"
```

---

### Task 4: A shared report carries the sender's brand

**Files:**
- Modify: `server.js` (`POST /api/share`)

**Interfaces:**
- Consumes: `findBrandingProfile`, `BRANDING.normalizeBrand`, the `ent` already resolved in that handler (Task 5 of the client-sharing plan added it).
- Produces: `meta.branding` on a stored share. Task 6 renders it.

- [ ] **Step 1: Snapshot the brand at share time**

In `POST /api/share`, after `safeMeta` is built and before `storeSharedReport` is called:

```js
        // The sender's mark travels with the report, as a SNAPSHOT rather than
        // a lookup: the report should look the way it looked when it was sent,
        // and a share outlives its owner's subscription and even their account.
        //
        // This is the real gate on branding. Saving a profile is open to any
        // signed-in member because an unapplied profile is inert; this is the
        // moment a brand leaves the account and reaches other people, so it is
        // checked server-side and never trusted from the browser.
        if (user && ent.canBrand) {
          const brandRow = await findBrandingProfile(user.id);
          const brand = BRANDING.normalizeBrand(brandRow);
          if (brand) safeMeta.branding = brand;
        } else {
          // Never let a browser hand us one. A visitor could otherwise publish
          // a report under someone else's firm name.
          delete safeMeta.branding;
        }
```

Note the `delete` runs on every unentitled path, including anonymous shares, so a hand-crafted request body cannot inject a brand.

- [ ] **Step 2: Compile and test**

Run: `node --check server.js && npm test`
Expected: pass.

- [ ] **Step 3: Prove the strip by hand**

Start the server with no database configured, then post a share whose meta already contains a branding block:

```bash
curl -s -X POST localhost:3000/api/share -H 'content-type: application/json' -d '{"data":{"comps":[{"address":"1 A St"}]},"meta":{"address":"1 A St","type":"Industrial","branding":{"firmName":"Not My Firm"}}}'
```

Then fetch the returned id from `/api/shared?id=` and confirm the payload has no `branding`. Record the transcript in your report. Kill the server afterwards.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "A shared report carries the sender's mark, snapshotted and server-checked"
```

---

### Task 5: Wiring tests

**Files:**
- Modify: `test/routes.test.js`

- [ ] **Step 1: Add the block**

Add inside the bare-server test (no Supabase, no admin key, no Stripe), beside the existing share-gate block:

```js
  // Branding's gate, wired.
  //
  // branding.js proves the DECISION. This proves it is ATTACHED: that all three
  // routes exist and refuse an anonymous caller with 401 BEFORE the 503 this
  // database-less server would otherwise give — the ordering rule openVault
  // established, so a stranger never learns whether the database is up.
  await t.test("every branding route refuses an anonymous caller, 401 before 503", async () => {
    const routes = [
      ["GET", "/api/branding", null],
      ["PUT", "/api/branding", { firmName: "Adler Industrial" }],
      ["DELETE", "/api/branding", null],
    ];
    for (const [method, p, body] of routes) {
      const r = await fetch(srv.base + p, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(r.status, 401, `${method} ${p} must refuse an anonymous caller`);
      assert.notEqual(r.status, 404, `${method} ${p} should exist and refuse, not be absent`);
    }
  });

  await t.test("a share from an anonymous visitor cannot carry a brand it supplied", async () => {
    // The browser hands /api/share its own meta. Without the server-side strip
    // a visitor could publish a report under someone else's firm name.
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { comps: [{ address: "1 A St" }] },
        meta: { address: "1 A St", type: "Industrial", branding: { firmName: "Not My Firm" } },
      }),
    });
    assert.equal(r.status, 200);
    const { id } = await r.json();
    const got = await (await fetch(srv.base + "/api/shared?id=" + encodeURIComponent(id))).json();
    assert.equal(got.meta.branding, undefined, "an unentitled share must carry no branding");
  });

  // NOT COVERED HERE, deliberately, for the reason the vault and sharing blocks
  // already give: a saved profile actually appearing on a rendered report needs
  // a real session and database, and nothing in this file may touch an external
  // service. That rests on branding.js plus a manual check against the
  // deployment.
```

- [ ] **Step 2: Run it**

Run: `npm test`
Expected: all pass. Report the new count; do not edit any count written in documentation.

- [ ] **Step 3: Commit**

```bash
git add test/routes.test.js
git commit -m "Prove the branding gate is wired, and that a share cannot carry a brand it was handed"
```

---

### Task 6: The editor card on My Desk

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `GET|PUT|DELETE /api/branding`.
- Produces: element ids `#deskBranding`, `#brandLogo`, `#brandLogoFile`, `#brandLogoPreview`, `#brandLogoRemove`, `#brandFirm`, `#brandPreparer`, `#brandPhone`, `#brandEmail`, `#brandLicense`, `#brandDisclaimer`, `#brandSave`, `#brandDelete`, `#brandMsg`, `#brandPreview`. Task 7 reads the saved profile through `currentBranding`.

- [ ] **Step 1: Add the markup**

A section after `#deskSharedWithMe`, matching the classes `#deskWatch` and `#deskShares` already use: a heading, one `<input type="file" accept="image/png,image/jpeg" class="hidden" id="brandLogoFile">` with a visible "Choose a logo" button, an `<img id="brandLogoPreview">`, a "Remove logo" button, five text inputs, a textarea for the disclaimer, Save and Remove buttons, a `#brandMsg` line, and a `#brandPreview` box that draws the letterhead as it will print.

There must be exactly ONE file input. Two would mean two values and two change handlers, and an upload started from one would be invisible to the other's result message. The vault's first-run panel carries the same rule and a test pins it.

- [ ] **Step 2: The logo pipeline**

```js
  // Downscale in the browser and embed the result. Never store a URL: a
  // cross-origin image taints the html2canvas canvas, and a tainted canvas
  // makes the PNG export throw — one pasted logo URL would silently break
  // image export for every report that member touches.
  const BRAND_LOGO_MAX_W = 400;      // plenty for a letterhead at print DPI
  const BRAND_LOGO_TARGET = 100000;  // re-encode above this; the server refuses above 150KB

  function readLogoFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("No file chosen."));
      if (!/^image\/(png|jpeg)$/.test(file.type)) {
        // SVG rasterizes unreliably in html2canvas and print, and a broken
        // logo on a document a broker hands a client is worse than plain text.
        return reject(new Error("Please choose a PNG or JPEG image."));
      }
      if (file.size > 5e6) return reject(new Error("That image is very large. Please choose one under 5MB."));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Could not read that file."));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("That file is not an image we can read."));
        img.onload = () => {
          const scale = Math.min(1, BRAND_LOGO_MAX_W / (img.width || 1));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, c.width, c.height);
          let out = c.toDataURL("image/png");
          if (out.length > BRAND_LOGO_TARGET) out = c.toDataURL("image/jpeg", 0.85);
          resolve(out);
        };
        img.src = String(fr.result || "");
      };
      fr.readAsDataURL(file);
    });
  }
```

- [ ] **Step 3: Load, save, remove**

```js
  let currentBranding = null;   // the member's own saved profile, or null
  let pendingLogo = "";         // data URI chosen but not yet saved

  const brandFields = () => ({
    logo: pendingLogo,
    firmName: $("brandFirm").value,
    preparerName: $("brandPreparer").value,
    phone: $("brandPhone").value,
    email: $("brandEmail").value,
    licenseNumber: $("brandLicense").value,
    disclaimer: $("brandDisclaimer").value,
  });

  async function loadBranding() {
    const wrap = document.getElementById("deskBranding");
    try {
      const r = await fetch("/api/branding", { credentials: "same-origin" });
      if (r.status === 401) { wrap.classList.add("hidden"); return; }
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 503 and anything else: one line, and the rest of the desk keeps working.
        wrap.classList.remove("hidden");
        document.getElementById("brandMsg").textContent = body.error || "Couldn't load your branding.";
        return;
      }
      wrap.classList.remove("hidden");
      currentBranding = (body.branding && Object.keys(body.branding).length) ? body.branding : null;
      pendingLogo = (currentBranding && currentBranding.logo) || "";
      fillBrandForm(currentBranding);
      renderBrandPreview();
    } catch (_) {
      wrap.classList.remove("hidden");
      document.getElementById("brandMsg").textContent = "Couldn't reach the server.";
    }
  }

  document.getElementById("brandSave").addEventListener("click", async () => {
    const btn = document.getElementById("brandSave");
    const msg = document.getElementById("brandMsg");
    btn.disabled = true; msg.textContent = "Saving…";
    try {
      const r = await fetch("/api/branding", {
        method: "PUT", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brandFields()),
      });
      const body = await r.json().catch(() => ({}));
      // The server's own 400 names the offending field and its limit. Show it
      // rather than inventing a vaguer one.
      if (!r.ok) { msg.textContent = body.error || "That didn't save."; return; }
      currentBranding = (body.branding && Object.keys(body.branding).length) ? body.branding : null;
      msg.textContent = "Saved. It will appear on your next report.";
      renderBrandPreview();
    } catch (_) {
      msg.textContent = "That didn't reach the server. Nothing was saved.";
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("brandDelete").addEventListener("click", async () => {
    if (!confirm("Remove your branding?\n\nReports you have already shared keep the mark they were sent with.")) return;
    const msg = document.getElementById("brandMsg");
    try {
      const r = await fetch("/api/branding", { method: "DELETE", credentials: "same-origin" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = body.error || "That didn't go through."; return; }
      currentBranding = null; pendingLogo = "";
      fillBrandForm(null); renderBrandPreview();
      msg.textContent = "Removed.";
    } catch (_) {
      msg.textContent = "That didn't reach the server. Nothing was changed.";
    }
  });
```

`fillBrandForm(brand)` writes each field's value (empty string when `brand` is null) and shows or hides `#brandLogoPreview`. Call `loadBranding()` from wherever the desk loads its other sections, alongside the `GET /api/shares` call.

The confirm text names the one thing a member would otherwise be surprised by: removing branding does not reach back into reports already shared, because those carry a snapshot.

- [ ] **Step 4: The preview**

`#brandPreview` renders the same block Task 7 draws on the report letterhead, so a member sees the thing they are buying before exporting anything. It must include the CompNinja attribution line, or the preview promises a white label the product does not offer.

- [ ] **Step 5: Verify it parses**

Extract the single inline `<script>` block and run `node --check` on it, then `npm test`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "My Desk: set the mark that goes on your reports"
```

---

### Task 7: The brand on the report and in print

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `brandForRender` semantics from Task 1 (reimplemented as a small browser-side reader over `currentBranding` / `currentParsed.branding_allowed` / `currentMeta.branding`), `currentMeta.shared`.
- Produces: `activeBrand()`, read by Task 8.

- [ ] **Step 1: One reader, mirroring the module**

```js
  // Mirrors branding.js's brandForRender. The rule that matters: a SHARED
  // report renders the sender's snapshot and NEVER the viewer's own profile —
  // otherwise a Pro member opening a report their broker sent them sees their
  // own logo on it.
  function activeBrand() {
    if (currentMeta && currentMeta.shared) return normalizeBrandBlock(currentMeta.branding);
    if (!currentParsed || currentParsed.branding_allowed !== true) return null;
    return normalizeBrandBlock(currentBranding);
  }
```

`normalizeBrandBlock` is the browser's copy of the module's normalization: trim, drop empties, drop a logo that is not a `data:image/` URI, and return null unless a logo or a firm name survives. Give it a `⚠` comment naming `branding.js` as its pair, following the convention `compWeight` and `compKeyOf`/`corpusKeyOf` already use.

- [ ] **Step 2: The print letterhead**

Rewrite the `.print-only` block at the top of `#reportArea` so that when `activeBrand()` returns a block, the member's logo and firm lead the left, and the right carries "Valuation by CompNinja" above the existing date. With no brand it renders exactly as it does today, byte for byte.

- [ ] **Step 3: The screen lockup**

In the `.rd-bcard` header, replace the CompNinja `.report-lockup` with the member's logo and firm name when branded, and add a small "via CompNinja" beneath it. This is also what html2canvas captures for the PNG, so use an `<img>` with the data URI and no external reference.

Every `<img>` that draws a member logo, here and in the letterhead and the preview, must carry a fallback:

```js
    img.onerror = function () {
      // A stored logo can be corrupt, or truncated by an older save. A broken
      // image icon on a document a broker is handing to a client is the worst
      // available outcome, so the firm name takes over silently.
      this.remove();
      if (firmEl) firmEl.classList.remove("hidden");
    };
```

Where `firmEl` is the firm-name text node for that surface, rendered hidden when a logo is present. With neither a logo nor a firm name `activeBrand()` already returned null, so this cannot leave an empty letterhead.

- [ ] **Step 4: The print footer**

Add the firm name and contact line above the existing CompNinja footer line. The CompNinja line stays.

- [ ] **Step 5: The disclaimer is additive**

Where the member's `disclaimer` renders, it goes **alongside** the automated-estimate language, never instead of it. Verify by branding a report with a disclaimer and confirming the estimate-not-an-appraisal sentence is still present on screen and in print.

- [ ] **Step 6: Verify it parses, and that an unbranded report is unchanged**

Extract the inline script and `node --check` it. Then confirm that with `currentBranding` null the letterhead markup is identical to before this task.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "The member's mark on the report, co-branded, on screen and in print"
```

---

### Task 8: The brand in the file exports

**Files:**
- Modify: `index.html` (`exportCsv`, the XLSX Valuation sheet)

- [ ] **Step 1: The CSV**

`exportCsv` already builds a title row and a subject line. Add a "Prepared by" line above them when `activeBrand()` returns a block:

```js
    const brand = activeBrand();
    const preparedBy = brand
      ? esc("Prepared by " + [brand.firmName, brand.preparerName, brand.phone, brand.email,
          brand.licenseNumber ? "Lic. " + brand.licenseNumber : ""].filter(Boolean).join(" · ")
          + (brand.disclaimer ? " | " + brand.disclaimer : "")
          + " | Valuation by CompNinja")
      : "";
```

Prepend it to the `csv` array ahead of the existing title. The trailing "Valuation by CompNinja" is the co-branding rule in the one export that has no letterhead to carry it.

- [ ] **Step 2: The XLSX Valuation sheet**

The XLSX builder is a different function from `exportCsv`, so it needs its own
`const brand = activeBrand();` near where `cc` and `capR` are computed. Then add
the same facts as rows at the top of `vRows`, before `["Property", ...]`:

```js
        ...(brand ? [
          ["Prepared by", [brand.firmName, brand.preparerName].filter(Boolean).join(" · ")],
          ...(brand.phone || brand.email ? [["Contact", [brand.phone, brand.email].filter(Boolean).join(" · ")]] : []),
          ...(brand.licenseNumber ? [["Licence", brand.licenseNumber]] : []),
          ...(brand.disclaimer ? [["Note", brand.disclaimer]] : []),
          ["Valuation by", "CompNinja"],
          [],
        ] : []),
```

- [ ] **Step 3: Verify**

Extract the inline script and `node --check` it, then `npm test`. Confirm an unbranded export is byte-identical to today's.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Exports carry the member's mark, and still say who computed the number"
```

---

### Task 9: Copy, documentation and the shipping record

**Files:**
- Modify: `index.html` (the Pro pricing tile, the plan card), `CLAUDE.md`, `devlog.json`, `docs/ROADMAP.md`

- [ ] **Step 1: Restore the two branding claims**

Both places carry comments saying to restore the bullet when the feature ships. Find them by searching `index.html` for "sell only what ships" and "name only what ships".

- In the Pro tile's `<ul>`, add a bullet: `Your firm's logo and details on every report you send`.
- In the plan card's `detail` string for an active Pro member, add branding to the list.
- Update BOTH comments so they no longer say the feature has no UI. They should now say what the rule cost and that it was paid: the bullet is back because the feature ships.

- [ ] **Step 2: CLAUDE.md**

Add the three routes, `branding.js` in the tested-pure-modules list, `branding_allowed` on the report, and the `meta.branding` snapshot. State the two rules a future editor will otherwise break: **a shared report renders the sender's snapshot and never the viewer's own profile**, and **saving a profile is not the entitlement, applying it is** (with the $20-buyer reason).

- [ ] **Step 3: devlog.json**

Append one entry. Clean UTF-8; em dashes and curly quotes raw, never ASCII-escaped. Verify `git diff devlog.json` shows only your addition.

```json
{ "date": "2026-08-07", "type": "feature",
  "title": "Your firm's mark on the reports you send",
  "details": "Pro members can put a logo, firm name, preparer, phone, email, licence number and their own note on every report, on screen, in print, in the PNG and in both file exports. A report shared with a client carries the sender's mark, snapshotted when it was sent. CompNinja stays named as the author of the valuation, and the automated-estimate line survives every configuration." }
```

- [ ] **Step 4: ROADMAP.md**

Move report branding out of "Now" into the Shipped log with the date. Leave white-label exports where it is; it is the separate later item this was deliberately not built into.

- [ ] **Step 5: Commit**

```bash
git add index.html CLAUDE.md devlog.json docs/ROADMAP.md
git commit -m "Sell the branding that now ships, and write down its two rules"
```

---

## Before this is deployed

1. `npm test` green.
2. No migration to run. `branding_profiles` has existed since 008 and is confirmed applied.
3. Manually prove, against the deployment, what `routes.test.js` cannot: save a profile, run a report, and confirm the letterhead, the PNG, the print view, the CSV and the XLSX all carry it, and that the automated-estimate line is still on every one of them.
4. Share that branded report with a second account and confirm the client sees the **sender's** brand, not their own.
5. Confirm a free signed-in account with a saved profile gets **no** brand on a thin-market report where nothing was gated.
