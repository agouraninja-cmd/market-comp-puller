# Portfolio Auto-Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every signed-in search lands in Portfolio automatically; Pro (and a dark Pro-off deployment) keep the book-of-values desk, Free sees an address list; the $20 unlock is unchanged.

**Architecture:** No new table or route. `computeEntitlements` grows `portfolioMaxItems` and `portfolioValues`. `POST /api/portfolio` without `id` upserts on exact address + type and applies the cap only on insert. The browser auto-saves from `saveHistory` (the same three guards that already skip sample / fromHistory / shared). `renderMyDesk` hides dollar columns unless `portfolioValues` is true.

**Tech Stack:** Plain Node 18+ (no npm deps), `node --test`, existing `server.js` / `index.html` / `entitlements.js`. File-fallback portfolio store is enough for route tests.

## Global Constraints

- Zero npm dependencies; Node 18+ `fetch` / `node --test` only.
- Never `git add -A`. Stage explicit paths. Leave untracked files you did not create.
- `$20` single-report unlock is out of scope: no auto-save special case, no value columns, cap stays 100.
- Do not add a unique constraint or a new table. Duplicate portfolio rows already exist; update the newest match and leave older dupes.
- Auto-save keys on `currentUser`, not `pro`. A lapsed Pro member is Free: they keep auto-saving up to 100; the desk hides dollars.
- `PRO_ENABLED=off` restores the pre-Pro desk (`portfolioValues: true`) and keeps the cap at 100.
- Sell-only-what-ships: do not claim "unlimited saved reports". Caps are 100 Free / 500 Pro.
- Public contact copy never calls us a broker; valuations stay automated estimates.
- Node on this machine is portable: prepend `$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64` to PATH before `node` / `npm test`.

## File map

| File | Responsibility |
|---|---|
| `entitlements.js` | `FREE_PORTFOLIO_MAX_ITEMS` (100), `PRO_PORTFOLIO_MAX_ITEMS` (500), `portfolioMaxItems`, `portfolioValues` on every return |
| `test/entitlements.test.js` | Decision table for those two fields |
| `server.js` | `findPortfolioMatch`, upsert in POST without id, cap from entitlements, `listPortfolio` limit 500, `/api/config` exposes both fields |
| `test/routes.test.js` | Wired upsert, Free cap, Pro-past-100, config payload |
| `index.html` | Auto-save in `saveHistory`, Save button hide, empty copy, desk split, pricing row |
| `test/index-html.test.js` | Pins for copy, seam, compare table, desk branch |
| `devlog.json` | One feature entry, rebuilt from HEAD + this entry only |
| `CLAUDE.md` | Portfolio auto-save, desk split, caps |

---

### Task 1: Entitlement fields

**Files:**
- Modify: `entitlements.js` (constants near line 66; every `computeEntitlements` return: admin ~236, disabled ~269, tester ~325, main ~398)
- Modify: `test/entitlements.test.js`
- Test: `test/entitlements.test.js`

**Interfaces:**
- Consumes: existing `computeEntitlements({ user, subscription, purchase, usage, reportId, now, enabled, admin, tester, vaultBeta })`
- Produces: every return includes `portfolioMaxItems: number` (`100` or `500`) and `portfolioValues: boolean`. Exports `FREE_PORTFOLIO_MAX_ITEMS` and `PRO_PORTFOLIO_MAX_ITEMS`.

- [ ] **Step 1: Write the failing tests**

Add these to `test/entitlements.test.js`. Import the two new constants next to `FREE_MAX_COMPS`. Extend the existing admin-matches-Pro key list.

```js
const {
  // ...existing imports...
  FREE_PORTFOLIO_MAX_ITEMS,
  PRO_PORTFOLIO_MAX_ITEMS,
} = require("../entitlements");

test("Free signed-in: 100 properties, no dollar figures on the desk", () => {
  const e = ent({ user: USER });
  assert.equal(e.portfolioMaxItems, FREE_PORTFOLIO_MAX_ITEMS);
  assert.equal(e.portfolioMaxItems, 100);
  assert.equal(e.portfolioValues, false);
});

test("anonymous: same cap as Free, no desk dollars (they cannot POST anyway)", () => {
  const e = ent({ user: null });
  assert.equal(e.portfolioMaxItems, 100);
  assert.equal(e.portfolioValues, false);
});

test("Pro, admin, and tester get 500 and the book of values", () => {
  const cases = [
    ent({ user: USER, subscription: activeSub() }),
    ent({ user: USER, admin: true }),
    ent({ user: USER, tester: true }),
  ];
  for (const e of cases) {
    assert.equal(e.pro, true, e.plan);
    assert.equal(e.portfolioMaxItems, PRO_PORTFOLIO_MAX_ITEMS);
    assert.equal(e.portfolioMaxItems, 500);
    assert.equal(e.portfolioValues, true, e.plan);
  }
});

test("a $20 unlock does not raise the portfolio cap or show desk dollars", () => {
  const e = ent({
    user: USER,
    reportId: "r_1",
    purchase: { report_id: "r_1" },
  });
  assert.equal(e.reportUnlocked, true);
  assert.equal(e.portfolioMaxItems, 100);
  assert.equal(e.portfolioValues, false);
});

test("a dark deployment keeps the pre-Pro desk (values on) and the old cap of 100", () => {
  for (const user of [null, USER]) {
    const e = computeEntitlements({ user, now: NOW, enabled: false });
    assert.equal(e.portfolioMaxItems, 100);
    assert.equal(e.portfolioValues, true, "today's desk already shows likely value to everyone");
  }
});
```

In the existing test `"admin: every Pro field is present on the comped branch"` (the loop over `Object.keys(pro)` plus the named-key list around line 93), add `"portfolioMaxItems"` and `"portfolioValues"` to the named list:

```js
for (const key of ["pro", "maxComps", "canBrand", "maxLookbackMonths", "exportsRemaining", "canExploreAddresses", "portfolioMaxItems", "portfolioValues"]) {
  assert.deepEqual(admin[key], pro[key], `admin should match Pro on "${key}"`);
}
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/entitlements.test.js
```

Expected: FAIL — `FREE_PORTFOLIO_MAX_ITEMS is not exported` and/or `portfolioMaxItems` is `undefined`.

- [ ] **Step 3: Add the constants and fields**

In `entitlements.js`, after `PRO_MAX_LOOKBACK_MONTHS`:

```js
const FREE_PORTFOLIO_MAX_ITEMS = 100;
const PRO_PORTFOLIO_MAX_ITEMS = 500;
```

On **every** `computeEntitlements` return object, add the two fields. Values:

| Return | `portfolioMaxItems` | `portfolioValues` |
|---|---|---|
| admin (`enabled && admin && user`) | `PRO_PORTFOLIO_MAX_ITEMS` | `true` |
| `!enabled` | `FREE_PORTFOLIO_MAX_ITEMS` | `true` |
| tester (`!pro && tester && user`) | `PRO_PORTFOLIO_MAX_ITEMS` | `true` |
| main, when `pro` | `PRO_PORTFOLIO_MAX_ITEMS` | `true` |
| main, otherwise (Free, anonymous, `$20` only) | `FREE_PORTFOLIO_MAX_ITEMS` | `false` |

Do not key `portfolioValues` on `reportUnlocked`. A comment on the disabled branch: this is the `canExploreAddresses` pattern — today's desk already showed likely value, so dark restores that, unlike the vault.

Export both constants from `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/entitlements.test.js
```

Expected: PASS. If admin is missing a key the `Object.keys(pro)` loop will say which return to fix.

- [ ] **Step 5: Commit**

```powershell
git add -- entitlements.js test/entitlements.test.js
git commit -m "Give Portfolio a Free/Pro cap and a desk-values flag."
```

---

### Task 2: Server upsert, cap, config

**Files:**
- Modify: `server.js` — `listPortfolio` (~1180), new `findPortfolioMatch` next to it, POST `/api/portfolio` (~11934), GET `/api/config` pro block (~14688)
- Modify: `test/routes.test.js`
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `ENT.FREE_PORTFOLIO_MAX_ITEMS`, `ENT.PRO_PORTFOLIO_MAX_ITEMS`, `getEntitlements(user).portfolioMaxItems`, `getEntitlements(user).portfolioValues`
- Produces: `findPortfolioMatch(userId, address, property_type) -> {id, ...} | null` (newest match; exact string equality on the already-trimmed address + type). POST without `id` updates that row or inserts. `listPortfolio` `limit=500`. `/api/config` `pro.portfolioMaxItems` and `pro.portfolioValues`.

- [ ] **Step 1: Write the failing route tests**

Add a new top-level `test("portfolio upsert and cap", ...)` in `test/routes.test.js`, modelled on the tester-passkey signup at ~998. Tiny payload helper:

```js
function reportPayload(address, type) {
  return {
    meta: { address, type },
    data: { comps: [{ address, transaction: "sale", source_type: "listing" }] },
  };
}

test("portfolio upsert and cap", async (t) => {
  const srv = await boot({ PRO_ENABLED: "on", ADMIN_KEY: "k", TESTER_PASSKEY: "tcode" });
  t.after(() => srv.stop());

  const email = `pf-${Date.now()}@example.com`;
  const signup = await fetch(srv.base + "/api/account/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery" }),
  });
  assert.equal(signup.status, 200);
  const cookie = String(signup.headers.get("set-cookie") || "").split(";")[0];

  const post = (body) => fetch(srv.base + "/api/portfolio", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

  await t.test("/api/config carries the two new fields for a Free account", async () => {
    const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(cfg.pro.portfolioMaxItems, 100);
    assert.equal(cfg.pro.portfolioValues, false);
  });

  await t.test("POST without id inserts once, then updates the same address+type", async () => {
    const payload = reportPayload("100 Main St, Boise, ID", "Industrial");
    const a = await post({ payload, snapshot: { likely: 1000000, low: 900000, high: 1100000, median_psf: 80 } });
    assert.equal(a.status, 200, await a.text());
    const first = await a.json();
    const b = await post({ payload, snapshot: { likely: 1100000, low: 1000000, high: 1200000, median_psf: 88 } });
    assert.equal(b.status, 200);
    const second = await b.json();
    assert.equal(second.id, first.id, "same row, not a second card");
    assert.equal(second.snapshots.length, 2);

    const list = await (await fetch(srv.base + "/api/portfolio", { headers: { cookie } })).json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].address, "100 Main St, Boise, ID");
  });

  await t.test("a new address at the Free cap of 100 is refused; updating one of the 100 still works", async () => {
    // 1 already inserted above; add 99 more to hit 100.
    for (let i = 1; i <= 99; i++) {
      const r = await post({ payload: reportPayload(`${i} Oak St, Boise, ID`, "Industrial") });
      assert.equal(r.status, 200, "insert " + i);
    }
    const full = await post({ payload: reportPayload("Overflow Ave, Boise, ID", "Industrial") });
    assert.equal(full.status, 400);
    assert.match((await full.json()).error, /Portfolio is full \(100 properties\)\./);

    const update = await post({
      payload: reportPayload("100 Main St, Boise, ID", "Industrial"),
      snapshot: { likely: 1200000, low: 1100000, high: 1300000, median_psf: 90 },
    });
    assert.equal(update.status, 200, "updating an existing address must not consult the cap");
  });

  await t.test("Pro (tester) can insert past 100", async () => {
    const redeem = await fetch(srv.base + "/api/redeem-passkey", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passkey: "tcode" }),
    });
    assert.equal(redeem.status, 200);
    const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(cfg.pro.isPro, true);
    assert.equal(cfg.pro.portfolioMaxItems, 500);
    assert.equal(cfg.pro.portfolioValues, true);

    const r = await post({ payload: reportPayload("Overflow Ave, Boise, ID", "Industrial") });
    assert.equal(r.status, 200, "the 101st property is allowed for Pro");
  });
});
```

Do **not** fill 500 rows. Pro-past-100 is the cap-raise proof.

- [ ] **Step 2: Run the new tests to verify they fail**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/routes.test.js
```

Expected: FAIL on `cfg.pro.portfolioMaxItems` undefined, and/or the second POST creating a second item (`list.items.length === 2`).

- [ ] **Step 3: Implement**

1. In `listPortfolio`'s Supabase query, change `limit=200` to `limit=500`. Comment: must be ≥ `PRO_PORTFOLIO_MAX_ITEMS` or the cap count and the upsert match both go blind past 200.

2. Next to `getPortfolioItem`, add:

```js
async function findPortfolioMatch(userId, address, property_type) {
  const items = await listPortfolio(userId);
  return items.find((x) => x.address === address && x.property_type === property_type) || null;
}
```

Match is exact string equality on the same trimmed values the POST route already computes. Do not query PostgREST with `address=eq.` — addresses contain commas and that filter would split. `listPortfolio` is already newest-first, so `find` returns the newest duplicate.

3. Replace the no-`id` branch of POST `/api/portfolio` (the cap check + `insertPortfolioItem` around 11960) with:

```js
const items = await listPortfolio(user.id);
const existing = items.find((x) => x.address === address && x.property_type === property_type);
if (existing) {
  const updated = await updatePortfolioItem(user.id, existing.id, { payload, snapshot: snap });
  if (!updated) return sendJson(res, 404, { error: "Not found." });
  logEvent("portfolio_refresh", { prop_type: property_type, market: marketOf(address) });
  return sendJson(res, 200, { id: updated.id, snapshots: updated.snapshots });
}
const ent = await getEntitlements(user);
const cap = Number(ent.portfolioMaxItems) || ENT.FREE_PORTFOLIO_MAX_ITEMS;
if (items.length >= cap) {
  return sendJson(res, 400, { error: `Portfolio is full (${cap} properties).` });
}
const item = await insertPortfolioItem(user.id, { address, property_type, payload, snapshot: snap });
logEvent("portfolio_add", { prop_type: property_type, market: marketOf(address) });
return sendJson(res, 200, { id: item.id, snapshots: item.snapshots });
```

Keep the `id` branch unchanged. Keep the 300KB limit, rate limit, payload shape check, and `cleanSnapshot`.

Delete or stop using `const PORTFOLIO_MAX_ITEMS = 100` once the route reads entitlements. Leave `PORTFOLIO_MAX_SNAPSHOTS = 60`.

4. In GET `/api/config`'s `pro` object, add:

```js
portfolioMaxItems: ent.portfolioMaxItems,
portfolioValues: ent.portfolioValues === true,
```

Presentation only, same comment family as `canUseVault`.

- [ ] **Step 4: Run tests to verify they pass**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/routes.test.js
```

Expected: PASS. The 100-insert loop talks to the file store and should finish in well under the file's existing ~0.6–2s budget; if it is slow, that is acceptable — do not skip the cap proof.

- [ ] **Step 5: Commit**

```powershell
git add -- server.js test/routes.test.js
git commit -m "Upsert Portfolio by address and type; cap comes from entitlements."
```

---

### Task 3: Client auto-save, Save button, empty copy

**Files:**
- Modify: `index.html` — `saveHistory` (~8527), `savePortfolioCurrent` (~9199), `#deskEmpty` (~1710), `#portfolioBtn` (~1964)
- Modify: `test/index-html.test.js`
- Test: `test/index-html.test.js`

**Interfaces:**
- Consumes: `POST /api/portfolio` without `id` (Task 2 upsert), `currentUser`, `lastValuation`, `pendingPortfolioRefresh`, existing `saveHistory` guards (`!sample && !fromHistory && !shared`)
- Produces: `portfolioKeys` (`Set` of `address + "\0" + type`), `markPortfolioSaved(address, type)`, `syncPortfolioButton()`, auto-save POST inside `saveHistory` after the refresh hook.

- [ ] **Step 1: Write the failing pins**

Add to `test/index-html.test.js`:

```js
test("empty desk copy no longer tells them to press Save", () => {
  assert.match(html, /id="deskEmpty"[^>]*>Run a report — it will show up here\./);
  assert.doesNotMatch(html, /press "Save to portfolio"/);
});

test("auto-save lives inside saveHistory, behind the same three guards", () => {
  const start = html.indexOf("function saveHistory(");
  const end = html.indexOf("function dropLegacyHistoryKeys");
  assert.ok(start >= 0 && end > start, "saveHistory / dropLegacyHistoryKeys moved");
  const fn = html.slice(start, end);
  assert.match(fn, /pendingPortfolioRefresh/);
  assert.match(fn, /else if \(currentUser\)/);
  assert.match(fn, /acctApi\("POST", "\/api\/portfolio"/);

  const guarded = html.match(/if \(!\w+\.sample && !\w+\.fromHistory && !\w+\.shared\)[\s\S]{0,80}saveHistory/g) || [];
  assert.ok(guarded.length >= 2, "every renderResults saveHistory call must keep the sample/fromHistory/shared guard");
});
```

- [ ] **Step 2: Run pins to verify they fail**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/index-html.test.js
```

Expected: FAIL on the empty-copy assertion.

- [ ] **Step 3: Implement**

Replace `#deskEmpty` text:

```html
<p id="deskEmpty" class="hidden text-sm text-[#5A6473] mt-2">Run a report — it will show up here.</p>
```

Near `pendingPortfolioSave`, add:

```js
const portfolioKeys = new Set(); // "address\0type" currently on My Desk
function portfolioKey(address, type) { return String(address || "") + "\0" + String(type || ""); }
function markPortfolioSaved(address, type) { portfolioKeys.add(portfolioKey(address, type)); }
function syncPortfolioButton() {
  const btn = document.getElementById("portfolioBtn");
  if (!btn) return;
  const saved = Boolean(currentUser && currentMeta && portfolioKeys.has(portfolioKey(currentMeta.address, currentMeta.type)));
  btn.classList.toggle("hidden", saved);
}
```

In `saveHistory`, after the `pendingPortfolioRefresh` block and **still outside** the localStorage try, add an `else if (currentUser)` branch. Do not POST twice when refresh already fired.

```js
    if (currentUser && pendingPortfolioRefresh &&
        pendingPortfolioRefresh.address === meta.address &&
        pendingPortfolioRefresh.type === meta.type) {
      const refreshId = pendingPortfolioRefresh.id;
      pendingPortfolioRefresh = null;
      setTimeout(() => {
        acctApi("POST", "/api/portfolio", {
          id: refreshId, payload: { meta, data }, snapshot: lastValuation,
        }).then(() => {
          markPortfolioSaved(meta.address, meta.type);
          syncPortfolioButton();
          if (typeof renderMyDesk === "function") renderMyDesk();
        }).catch(() => {});
      }, 0);
    } else if (currentUser) {
      const payloadMeta = {
        address: meta.address, type: meta.type, note: meta.note || "",
        months: meta.months, txFocus: meta.txFocus, subject: meta.subject || null,
        assumptions: meta.assumptions || null,
        curation: meta.curation || null,
      };
      setTimeout(() => {
        acctApi("POST", "/api/portfolio", {
          payload: { meta: payloadMeta, data }, snapshot: lastValuation,
        }).then(() => {
          markPortfolioSaved(meta.address, meta.type);
          syncPortfolioButton();
          if (typeof renderMyDesk === "function") renderMyDesk();
        }).catch((ex) => {
          showStatus(ex.message, "error");
        });
      }, 0);
    }
```

The tick exists so `renderOwnerHero` has set `lastValuation`, same as the refresh hook.

In `savePortfolioCurrent`, on success call `markPortfolioSaved(currentMeta.address, currentMeta.type); syncPortfolioButton();` instead of resetting the label to "Save to portfolio" after 2.5s. On failure leave the button visible.

Call `syncPortfolioButton()` at the end of `renderResults` (after `currentMeta` is set) so a reopened report hides Save when it is already in the set, and a brand-new unsigned-in report shows it.

In `renderMyDesk`, after `items` loads:

```js
portfolioKeys.clear();
items.forEach((item) => markPortfolioSaved(item.address, item.property_type));
syncPortfolioButton();
```

That is what makes Remove then a desk re-render show Save again for that address.

- [ ] **Step 4: Run tests**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/index-html.test.js
```

Expected: PASS, including the inline-script parse test (a stray `${` in the new JS would fail that).

- [ ] **Step 5: Commit**

```powershell
git add -- index.html test/index-html.test.js
git commit -m "Auto-save a signed-in search to Portfolio from saveHistory."
```

---

### Task 4: Free vs Pro desk

**Files:**
- Modify: `index.html` — `renderMyDesk` (~9292), `initGate` proConfig default (~3442)
- Modify: `test/index-html.test.js`
- Test: `test/index-html.test.js`

**Interfaces:**
- Consumes: `proConfig.portfolioValues` (Task 2). Fallback if the field is missing: `!proConfig.enabled || proConfig.isPro` so an old `/api/config` cannot blank a Pro desk.
- Produces: `portfolioValuesOn()` boolean. When false: Property + actions only, `#deskLedger` hidden. When true: today's table and ledger unchanged.

- [ ] **Step 1: Write the failing pin**

```js
test("the desk branches on portfolioValues, not a raw isPro", () => {
  const start = html.indexOf("async function renderMyDesk");
  const end = html.indexOf("// /desk — My Desk lives on its own URL");
  assert.ok(start >= 0 && end > start);
  const fn = html.slice(start, end);
  assert.match(fn, /portfolioValuesOn\(\)/);
  assert.match(fn, /History/);
  assert.match(fn, /Likely value/);
  // Free path: the value columns are gated, not deleted from the file.
  assert.match(fn, /if \(showValues\)/);
});
```

- [ ] **Step 2: Run the pin to verify it fails**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/index-html.test.js
```

Expected: FAIL — `portfolioValuesOn` is not defined.

- [ ] **Step 3: Implement**

Add next to `syncPortfolioButton`:

```js
function portfolioValuesOn() {
  if (!proConfig) return false;
  if (typeof proConfig.portfolioValues === "boolean") return proConfig.portfolioValues;
  return !proConfig.enabled || Boolean(proConfig.isPro);
}
```

In `renderMyDesk`:

- `const showValues = portfolioValuesOn();`
- Ledger: `ledger.classList.toggle("hidden", items.length === 0 || !showValues);` and skip filling `ledger.innerHTML` when `!showValues`.
- Table header: if `showValues`, keep `<th>Property</th><th>History</th><th class="num">Likely value</th><th class="num">Change</th><th></th>`. Else `<th>Property</th><th></th>`.
- Per row: wrap the History, Likely, Change `<td>`s in `if (showValues)`. Always render Property and the Refresh/Remove cell.
- Combined tfoot: only when `showValues && items.length > 1 && combined`.

Do not strip `snapshots` from the GET. Free still stores them so upgrading reveals history.

Call `syncPortfolioButton` from Task 3 stays.

- [ ] **Step 4: Run tests**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/index-html.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- index.html test/index-html.test.js
git commit -m "Hide Portfolio dollar columns unless the visitor may see them."
```

---

### Task 5: Pricing copy, CLAUDE.md, devlog

**Files:**
- Modify: `index.html` — Pro `pr-sum` (~1033), capability strip (~1064), `#pricingCompare` tbody (~1093)
- Modify: `test/index-html.test.js`
- Modify: `CLAUDE.md` (Accounts + My Desk / Pro tier)
- Modify: `devlog.json` (rebuild staged file from `git show HEAD:devlog.json` plus one new entry — never patch the working file into the index)
- Test: `test/index-html.test.js`

**Interfaces:**
- Consumes: none
- Produces: compare-table row `Portfolio` / `Saved reports, address list` / `Saved reports, with estimated values`. Capability strip span `Portfolio with estimated values`. `pr-sum` mentions the book of values. No "unlimited saved reports".

- [ ] **Step 1: Write the failing pin**

```js
test("pricing states the Portfolio split in the compare table", () => {
  assert.match(html, /<tr><td>Portfolio<\/td><td class="c">Saved reports, address list<\/td><td class="c">Saved reports, with estimated values<\/td><\/tr>/);
  assert.doesNotMatch(html, /unlimited saved reports/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/index-html.test.js
```

Expected: FAIL — no Portfolio row.

- [ ] **Step 3: Implement copy and docs**

In `#pricingCompare` tbody, after the branding row:

```html
<tr><td>Portfolio</td><td class="c">Saved reports, address list</td><td class="c">Saved reports, with estimated values</td></tr>
```

Pro tile `pr-sum` (keep one sentence):

```html
<p class="pr-sum">Every comp itemized with sources, the 10-year window, unlimited exports, the vault, Address Explorer, your branding, a portfolio with estimated values.</p>
```

Capability strip, add `<span>Portfolio with estimated values</span>` after Report branding.

In `CLAUDE.md`, in the Accounts + My Desk paragraph, add: signed-in searches auto-save to `portfolio_items` (upsert on address + type); Free desk is an address list; Pro desk is the book of values; caps 100 / 500 live in `entitlements.js` as `portfolioMaxItems` / `portfolioValues`; `$20` does not auto-save. In the Pro-tier section, mention the desk split next to the other Free-vs-Pro numbers that must move together.

Devlog: this checkout is shared. Before touching `devlog.json`, run `git status --short -- devlog.json` and `git diff --cached -- devlog.json`. If someone else has staged or unstaged entries, fold theirs in rather than overwriting.

Rebuild the staged blob from HEAD plus this one entry (and any other unstaged entries already in the working file). Do not `git add` a temp path. Write UTF-8 with Node, then `git add -- devlog.json`. Verify with `git show :devlog.json` that the other sessions' titles still appear.

Entry:

```json
{
  "date": "2026-08-13",
  "type": "feature",
  "title": "A signed-in search lands in Portfolio on its own",
  "details": "Free and Pro alike keep every report they run, on any device, without pressing Save. The same address updates the existing row and appends a value snapshot. Free My Desk is an address list; Pro keeps the likely-value ledger and sparklines, and upgrading reveals history Free already stored. Caps are 100 and 500, enforced on insert only. The Save button remains as a retry when the auto-save fails or the list is full. The $20 unlock is unchanged."
}
```

UTF-8, raw em dashes, no `\u` escapes.

- [ ] **Step 4: Run the full suite**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
npm test
```

Expected: PASS (the suite summary, not a remembered count). Then `git diff --cached -- devlog.json` and confirm it contains only this entry vs HEAD.

- [ ] **Step 5: Commit**

```powershell
git add -- index.html test/index-html.test.js CLAUDE.md devlog.json
git commit -m "Say the Portfolio split on the pricing table and in the docs."
```

Do not stage `.env`, `ledger/*.csv`, or the homepage-look files.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Every signed-in search auto-saves | 3 |
| Latest report + snapshots, not versioned comps | 2 (upsert) + 3 |
| Approach A, client POST after render | 3 (`saveHistory` + tick) |
| Skip sample / fromHistory / shared | 3 (existing guards, pinned) |
| Remove deletes; search again re-adds | 3 (`portfolioKeys` rebuilt from GET) |
| Lapse = Free auto-save + hidden dollars | 1 + 3 + 4 (no special branch) |
| Caps 100 / 500, insert only | 1 + 2 |
| Admin/tester = Pro; `$20` does not | 1 + 2 |
| Dark tier: values on, cap 100 | 1 |
| Save hidden when saved | 3 |
| Fire-and-forget; cap error via `showStatus` | 3 |
| Empty copy | 3 |
| Free desk vs Pro desk | 4 |
| Snapshots still written for Free | 2 (unchanged payload) + 4 (display only) |
| `/api/config` fields | 2 |
| Pricing row + no "unlimited" | 5 |
| No new table / unique index / `$20` / server write in `/api/comps` | all tasks omit them |
| `listPortfolio` must see all 500 or upsert/cap go blind | 2 (`limit=500`) — not named in the spec, required by it |

Manual check after Task 5, against a running server (not a substitute for `npm test`): signed-in Free search appears on My Desk as an address with no dollar column; redeeming the tester passkey on that account shows likely value and the ledger from snapshots already stored.
