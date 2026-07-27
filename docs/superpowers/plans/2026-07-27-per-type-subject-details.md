# Per-Type Subject Property Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each property type its own 1-3 subject-property detail inputs, send them to the model so comp selection matches the subject, and use unit count / acreage to add a $/unit and $/acre valuation line.

**Architecture:** Subject fields mirror `TYPE_COMP_FIELDS` (server.js) minus the derived price metrics. A new `TYPE_SUBJECT_FIELDS` map in index.html renders the inputs per type, the same way `TYPE_COLUMNS`/`columnsForType()` renders per-type comp columns. Values persist at `meta.subject.details`, ride to `/api/comps` as `subjectDetails`, and fold into the search cache key.

**Tech Stack:** Plain Node HTTP server (no deps, Node 18+), single-file HTML front-end, vendored `tailwind.css`.

**Spec:** `docs/superpowers/specs/2026-07-27-per-type-subject-details-design.md`

---

## Read this before Task 1

**There is no test suite, no build step, and no linter in this repo.** Do not
look for `npm test` — it does not exist. The TDD loop below is preserved in
spirit using the tools this project actually has:

- `node --check server.js` for syntax.
- **Source-extraction checks**: pure functions are pulled out of the real
  `server.js` text with a regex and `eval`'d in a throwaway node process. This
  runs the actual shipped source, not a hand-copied duplicate, and costs
  nothing.
- **Browser console assertions** via the running dev server for front-end
  logic.
- Live billed searches only in Task 7, which states its own cost.

**Node is a portable copy.** Every `node` invocation below uses:
`"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe"`

**Restart rule:** editing `server.js` requires restarting the dev server
(it is loaded once at startup). Editing `index.html` does not — the server
reads it from disk per request, so just reload the page.

**Commit by explicit path. Never `git add -A` or `git add server.js` blind.**
Another session shares this working directory and edits the same files. On
2026-07-27 a commit here silently swept up an unrelated change because the
diff was reviewed through `head -20`. Before each commit run
`git --no-pager diff --stat` and read the **whole** diff, then stage the exact
paths.

**No Tailwind regeneration is needed.** Every utility class used below already
appears in `index.html`, so the vendored `tailwind.css` already covers it.

---

### Task 1: Server sanitizes `subjectDetails`

**Files:**
- Modify: `server.js` (add function after `TYPE_COMP_FIELDS`, which ends ~line 1366)

- [ ] **Step 1: Write the failing check**

Create `/tmp/check-sanitize.js`:

```js
const fs = require("fs");
const src = fs.readFileSync("server.js", "utf8");
const mapSrc = src.match(/const TYPE_COMP_FIELDS = \{[\s\S]*?\n\};/);
const fnSrc = src.match(/function sanitizeSubjectDetails[\s\S]*?\n\}/);
if (!mapSrc) throw new Error("TYPE_COMP_FIELDS not found");
if (!fnSrc) throw new Error("sanitizeSubjectDetails not found");
eval(mapSrc[0]);
eval(fnSrc[0]);

const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  console.log((g === w ? "PASS " : "FAIL ") + label + "  got=" + g + " want=" + w);
  if (g !== w) process.exitCode = 1;
};

eq("keeps a known key, trims it",
   sanitizeSubjectDetails("Multifamily", { units: "  48  " }), { units: "48" });
eq("drops keys not in this type",
   sanitizeSubjectDetails("Multifamily", { units: "48", zoning: "M-1" }), { units: "48" });
eq("drops blanks",
   sanitizeSubjectDetails("Retail", { center_type: "", anchor_tenant: "Kroger" }),
   { anchor_tenant: "Kroger" });
eq("caps value length at 40",
   sanitizeSubjectDetails("Retail", { anchor_tenant: "x".repeat(60) }),
   { anchor_tenant: "x".repeat(40) });
eq("unknown type -> empty", sanitizeSubjectDetails("Nope", { units: "48" }), {});
eq("array input -> empty", sanitizeSubjectDetails("Multifamily", ["units"]), {});
eq("null input -> empty", sanitizeSubjectDetails("Multifamily", null), {});
eq("nested object value is stringified, not passed through",
   sanitizeSubjectDetails("Multifamily", { units: { a: 1 } }), { units: "[object Object]" });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" /tmp/check-sanitize.js
```

Expected: throws `Error: sanitizeSubjectDetails not found`.

- [ ] **Step 3: Implement**

In `server.js`, immediately after the closing `};` of `TYPE_COMP_FIELDS`
(before `ALL_TYPE_COMP_FIELDS`), add:

```js
// Subject details arrive from the browser, so they are untrusted input headed
// for a prompt. Keep only the keys this property type actually reports, force
// them to short strings, and drop blanks. Everything else is discarded rather
// than sanitized in place.
function sanitizeSubjectDetails(type, raw) {
  const spec = TYPE_COMP_FIELDS[type];
  if (!spec || !raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of spec.fields) {
    const v = String(raw[key] == null ? "" : raw[key]).trim().slice(0, 40);
    if (v) out[key] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run the check to verify it passes**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" /tmp/check-sanitize.js
```

Expected: eight `PASS` lines, exit code 0.

- [ ] **Step 5: Syntax check**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check server.js
```

Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git --no-pager diff --stat
git --no-pager diff server.js
git add server.js
git commit -m "Sanitize subject details server-side"
```

---

### Task 2: Fold subject details into the search cache key

Without this, a 48-unit and a 6-unit building at the same address, type, and
size share a cache entry and are served each other's comps.

**Files:**
- Modify: `server.js:807` (`cacheKeyFor`)
- Modify: `server.js:2829` and `server.js:2853` (request handler)

- [ ] **Step 1: Write the failing check**

Create `/tmp/check-cachekey.js`:

```js
const fs = require("fs");
const crypto = require("crypto");
const src = fs.readFileSync("server.js", "utf8");
const fnSrc = src.match(/function cacheKeyFor\([\s\S]*?\n\}/);
if (!fnSrc) throw new Error("cacheKeyFor not found");
eval(fnSrc[0]);

const base = {
  address: "1 Main St, Boise, ID", type: "Multifamily", note: "",
  months: 12, maxComps: 8, txFocus: "both", subjectSizeSqft: 20000,
  verifiedComps: [],
};
const k = (extra) => cacheKeyFor({ ...base, ...extra });

const check = (label, cond) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

// Legacy keys must not move: a search with no details keeps the key it had
// before this change, so the existing 7-day cache is not mass-invalidated.
const legacyRaw = ["1 main st, boise, id", "Multifamily", "", 12, 8, "both", 20000, ""].join("::");
const legacyKey = crypto.createHash("sha256").update(legacyRaw).digest("hex");
check("no details -> legacy key unchanged", k({}) === legacyKey);
check("undefined details -> legacy key unchanged", k({ subjectDetails: undefined }) === legacyKey);
check("empty details -> legacy key unchanged", k({ subjectDetails: {} }) === legacyKey);

check("details change the key", k({ subjectDetails: { units: "48" } }) !== legacyKey);
check("different unit counts differ",
      k({ subjectDetails: { units: "48" } }) !== k({ subjectDetails: { units: "6" } }));
check("same details are stable",
      k({ subjectDetails: { units: "48" } }) === k({ subjectDetails: { units: "48" } }));
check("key order does not matter",
      k({ subjectDetails: { lot_acres: "2", zoning: "M1" } }) ===
      k({ subjectDetails: { zoning: "M1", lot_acres: "2" } }));
check("case and padding do not matter",
      k({ subjectDetails: { zoning: "M-1" } }) === k({ subjectDetails: { zoning: " m-1 " } }));
```

- [ ] **Step 2: Run it to verify it fails**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" /tmp/check-cachekey.js
```

Expected: the three "legacy key unchanged" lines PASS (current code already
ignores details) and every line from "details change the key" onward FAILs.

- [ ] **Step 3: Implement in `cacheKeyFor`**

Replace the body of `cacheKeyFor` (server.js:807) with:

```js
function cacheKeyFor({ address, type, note, months, maxComps, txFocus, subjectSizeSqft, verifiedComps, subjectDetails }) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const verifiedSig = (verifiedComps || [])
    .map((c) => `${c.address}|${c.deal_date}|${c.price_or_rate}`)
    .sort()
    .join(";");
  // Two different buildings can share an address, type, and size — a 48-unit
  // and a 6-unit would otherwise collide and be served each other's comps.
  const detailsSig = Object.entries(subjectDetails || {})
    .map(([k, v]) => `${k}=${norm(v)}`)
    .sort()
    .join(",");
  const raw = [norm(address), type, norm(note), months, maxComps, txFocus, subjectSizeSqft || "", verifiedSig].join("::");
  // Appended only when present, so every existing cache entry keeps its key
  // instead of the whole 7-day cache invalidating on deploy.
  return crypto.createHash("sha256").update(detailsSig ? `${raw}::${detailsSig}` : raw).digest("hex");
}
```

- [ ] **Step 4: Run the check to verify it passes**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" /tmp/check-cachekey.js
```

Expected: nine `PASS` lines, exit code 0.

- [ ] **Step 5: Wire the handler**

In `server.js:2829`, add `subjectDetails` to the destructure:

```js
        const { address, type, note, months, maxComps, txFocus, subjectSizeSqft, subjectDetails } = JSON.parse(body || "{}");
```

Then after the `noteOk` line (server.js:2847) add:

```js
        const detailsOk = sanitizeSubjectDetails(typeOk, subjectDetails);
```

And pass it into `cacheKeyFor` (server.js:2853):

```js
        const cacheKey = cacheKeyFor({
          address: addressOk, type: typeOk, note: noteOk, months: monthsOk,
          maxComps: maxCompsOk, txFocus: txFocusOk, subjectSizeSqft: sizeOk, verifiedComps,
          subjectDetails: detailsOk,
        });
```

- [ ] **Step 6: Syntax check and restart**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check server.js
```

Expected: no output. Then restart the dev server (preview_stop + preview_start
on the `dev` config) and confirm `GET /healthz` returns 200.

- [ ] **Step 7: Commit**

```bash
git --no-pager diff server.js
git add server.js
git commit -m "Include subject details in the search cache key"
```

---

### Task 3: Pass subject details into the prompt

**Files:**
- Modify: `server.js:1369` (`buildPrompt` signature and body)
- Modify: `server.js:1687` (`getComps` signature and its `buildPrompt` call)
- Modify: `server.js:2881` (the `getComps` call site)

- [ ] **Step 1: Add the parameter to `buildPrompt`**

Change the signature at server.js:1369 to end with `subjectDetails`:

```js
function buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpusComps, subjectDetails) {
```

- [ ] **Step 2: Build the block**

Inside `buildPrompt`, directly after the `typeSpecsOf` helper definition, add:

```js
  // What the owner told us about their own building. Given to the model so it
  // matches on the attributes that actually drive comparability, not just
  // address and size.
  const detailEntries = Object.entries(subjectDetails || {});
  const subjectDetailBlock = detailEntries.length
    ? `SUBJECT DETAILS provided by the owner: ${detailEntries.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}. Prefer comps that match these attributes where the market offers them, and note in "summary" when the closest available comps differ materially from them.`
    : "";
```

- [ ] **Step 3: Emit it**

In the returned array, insert `subjectDetailBlock,` on its own line
immediately after `typeGuidance[type] || "",`. When the block is `""` it
contributes a blank line to the joined prompt — harmless, and exactly what the
neighbouring `txFocus` and `!isLand` conditionals already do.

- [ ] **Step 4: Thread it through `getComps`**

Change the signature at server.js:1687 to end with `subjectDetails = {}`:

```js
async function getComps(address, type, note, months, maxComps, txFocus, subjectSizeSqft, verifiedComps, corpus = { comps: [], coverage: 0, fresh: false }, subjectDetails = {}) {
```

Find the `buildPrompt(` call inside `getComps` and append `, subjectDetails`
as its final argument.

- [ ] **Step 5: Pass it at the call site**

At server.js:2881, append `detailsOk` as the final argument:

```js
        const result = await getComps(addressOk, typeOk, noteOk, monthsOk, maxCompsOk, txFocusOk, sizeOk, verifiedComps, corpus, detailsOk);
```

- [ ] **Step 6: Verify structurally**

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" --check server.js
grep -c "subjectDetailBlock" server.js
```

Expected: no output from `--check`; `grep` prints `2` (definition + emission).

Restart the dev server and confirm `GET /healthz` returns 200. Behavioural
proof that the block reaches the model is Task 7.

- [ ] **Step 7: Commit**

```bash
git --no-pager diff server.js
git add server.js
git commit -m "Send subject property details to the model"
```

---

### Task 4: Per-type subject inputs in the form

**Files:**
- Modify: `index.html:663` (size label), `index.html:683` (add container)
- Modify: `index.html` after `columnsForType()` ends (~line 1435) — add map + renderer
- Modify: `index.html:1509` (type-change listener)

- [ ] **Step 1: Add the container to the form**

In `index.html`, inside `#subjectDetails`, the inputs sit in a
`<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">` that closes at line 683.
Immediately **before** that closing `</div>`, add:

```html
              <div id="subjectTypeFields" class="contents"></div>
```

`contents` makes the wrapper vanish from layout so its children become direct
grid items, keeping the existing two-column rhythm.

- [ ] **Step 2: Add the map and renderer**

In the `<script>` section, immediately after the closing `}` of
`columnsForType()`, add:

```js
  // Subject-property detail inputs, mirroring TYPE_COMP_FIELDS in server.js
  // minus the derived price metrics a user cannot type (price_per_unit,
  // price_per_acre). Rendered into #subjectTypeFields whenever the type
  // changes, the same way columnsForType() drives the comp table.
  const TYPE_SUBJECT_FIELDS = {
    Industrial: [
      { key: "clear_height", label: "Clear height (ft)", type: "number", placeholder: "e.g. 32" },
      { key: "dock_doors",   label: "Dock doors",        type: "number", placeholder: "e.g. 6" },
    ],
    Office: [
      { key: "building_class", label: "Building class",   type: "select", options: ["", "Class A", "Class B", "Class C"] },
      { key: "floor_plate",    label: "Floor plate (SF)", type: "number", placeholder: "e.g. 18000" },
    ],
    Retail: [
      { key: "center_type",   label: "Center type",   type: "select", options: ["", "Neighborhood center", "Strip center", "Power center", "Single-tenant NNN", "Urban storefront"] },
      { key: "anchor_tenant", label: "Anchor tenant", type: "text",   placeholder: "e.g. Kroger" },
    ],
    Multifamily: [
      { key: "units", label: "Unit count", type: "number", placeholder: "e.g. 48" },
    ],
    Land: [
      { key: "lot_acres", label: "Acres",  type: "number", placeholder: "e.g. 2.4" },
      { key: "zoning",    label: "Zoning", type: "text",   placeholder: "e.g. M-1" },
    ],
    Residential: [
      { key: "beds_baths", label: "Beds / baths", type: "text", placeholder: "e.g. 4 bd / 3 ba" },
    ],
  };

  // "Building size" is wrong for two types; Land has no income to report.
  const SIZE_LABELS = { Land: "Lot size (SF)", Residential: "Living area (SF)" };
  const SUBJ_INPUT_CLASS = "w-full min-w-0 rounded border border-[#D8D4C9] px-2.5 py-1.5 text-sm text-[#1A2433] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C] outline-none";

  function renderSubjectFields(type) {
    const wrap = document.getElementById("subjectTypeFields");
    wrap.innerHTML = "";                       // switching type discards stale values
    (TYPE_SUBJECT_FIELDS[type] || []).forEach((f) => {
      const cell = document.createElement("div");
      const label = document.createElement("label");
      label.className = "rd-lab";
      label.setAttribute("for", "subj_" + f.key);
      label.textContent = f.label;
      cell.appendChild(label);
      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        f.options.forEach((o) => {
          const opt = document.createElement("option");
          opt.value = o;
          opt.textContent = o || "—";
          input.appendChild(opt);
        });
      } else {
        input = document.createElement("input");
        input.type = f.type;
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.type === "number") { input.min = "0"; input.step = "any"; }
      }
      input.id = "subj_" + f.key;
      input.dataset.subjectKey = f.key;
      input.className = SUBJ_INPUT_CLASS;
      cell.appendChild(input);
      wrap.appendChild(cell);
    });
    document.getElementById("targetSizeLabel").textContent = SIZE_LABELS[type] || "Building size (SF)";
    document.getElementById("noiWrap").classList.toggle("hidden", type === "Land");
  }

  // Read the visible detail inputs into a flat object, dropping blanks so an
  // untouched form yields {}.
  function readSubjectDetails() {
    const out = {};
    document.querySelectorAll("#subjectTypeFields [data-subject-key]").forEach((el) => {
      const v = String(el.value || "").trim();
      if (v) out[el.dataset.subjectKey] = v;
    });
    return out;
  }
```

- [ ] **Step 3: Render on type change and at startup**

At `index.html:1509`, replace:

```js
  propertyTypeSel.addEventListener("change", applyRecommendedLookback);
```

with:

```js
  propertyTypeSel.addEventListener("change", () => {
    applyRecommendedLookback();
    renderSubjectFields(propertyTypeSel.value);
  });
  renderSubjectFields(propertyTypeSel.value);   // initial paint (type may be restored from localStorage)
```

- [ ] **Step 4: Verify in the browser**

Reload `http://localhost:3000` (no restart needed for index.html) and run in
the console:

```js
["Industrial","Office","Retail","Multifamily","Land","Residential"].map(t => {
  renderSubjectFields(t);
  return t + ": [" + Object.keys(readSubjectDetails()).length + " filled] " +
    [...document.querySelectorAll("#subjectTypeFields [data-subject-key]")].map(e => e.dataset.subjectKey).join(",") +
    " | size='" + document.getElementById("targetSizeLabel").textContent +
    "' noiHidden=" + document.getElementById("noiWrap").classList.contains("hidden");
}).join("\n")
```

Expected exactly:

```
Industrial: [0 filled] clear_height,dock_doors | size='Building size (SF)' noiHidden=false
Office: [0 filled] building_class,floor_plate | size='Building size (SF)' noiHidden=false
Retail: [0 filled] center_type,anchor_tenant | size='Building size (SF)' noiHidden=false
Multifamily: [0 filled] units | size='Building size (SF)' noiHidden=false
Land: [0 filled] lot_acres,zoning | size='Lot size (SF)' noiHidden=true
Residential: [0 filled] beds_baths | size='Living area (SF)' noiHidden=false
```

Then confirm values are dropped on type switch:

```js
renderSubjectFields("Multifamily");
document.getElementById("subj_units").value = "48";
JSON.stringify(readSubjectDetails());              // {"units":"48"}
renderSubjectFields("Retail");
JSON.stringify(readSubjectDetails());              // {}
```

- [ ] **Step 5: Commit**

```bash
git --no-pager diff index.html
git add index.html
git commit -m "Per-type subject detail inputs in the search form"
```

---

### Task 5: Persist details and send them with the search

The subject-edit listener at `index.html:1570` rebuilds `currentMeta.subject`
wholesale from five hardcoded ids. Reading the details straight from the DOM
inside that rebuild is what stops every keystroke from wiping them.

**Files:**
- Modify: `index.html:1562-1584` (subject-edit listener)
- Modify: `index.html:5284` (fetch body) and `index.html:5307` (`meta.subject`)

- [ ] **Step 1: Extend the subject-edit listener**

Replace the `currentMeta.subject = { ... }` assignment inside the listener
(index.html:1570-1576) with:

```js
        currentMeta.subject = {
          sizeMin: sizeR ? sizeR.min : null,
          sizeMax: sizeR ? sizeR.max : null,
          priceMin: priceR ? priceR.min : null,
          priceMax: priceR ? priceR.max : null,
          noi: noiVal > 0 ? noiVal : null,
          // Read from the DOM, not merged from the old object — this rebuild
          // replaces subject wholesale, so anything not re-read is lost.
          details: readSubjectDetails(),
        };
```

- [ ] **Step 2: Make the dynamic inputs trigger the same recompute**

The detail inputs are rebuilt on every type change, so bind once to the
container by delegation. Immediately after the existing
`["targetSize", ...].forEach(...)` block closes (index.html:1584), add:

```js
  // Delegated: #subjectTypeFields children are replaced whenever the property
  // type changes, so per-element listeners would go stale.
  document.getElementById("subjectTypeFields").addEventListener("input", () => {
    document.getElementById("targetSize").dispatchEvent(new Event("input"));
  });
```

- [ ] **Step 3: Send details with the search**

At `index.html:5284`, add `subjectDetails` to the POST body:

```js
        body: JSON.stringify({
          address, type, note, months, txFocus,
          subjectSizeSqft: sizeR ? Math.round((sizeR.min + sizeR.max) / 2) : undefined,
          subjectDetails: readSubjectDetails(),
        }),
```

At `index.html:5307`, add `details` to the persisted subject:

```js
        subject: {
          sizeMin: sizeR ? sizeR.min : null,
          sizeMax: sizeR ? sizeR.max : null,
          priceMin: priceR ? priceR.min : null,
          priceMax: priceR ? priceR.max : null,
          noi: noiVal > 0 ? noiVal : null,
          details: readSubjectDetails(),
        },
```

- [ ] **Step 4: Verify the wipe-on-keystroke trap is closed**

Reload the page, run a search or open the sample report so `currentMeta`
exists, then in the console:

```js
renderSubjectFields("Multifamily");
document.getElementById("subj_units").value = "48";
document.getElementById("subj_units").dispatchEvent(new Event("input"));
await new Promise(r => setTimeout(r, 500));
console.log("after detail edit:", JSON.stringify(currentMeta.subject.details));
// now type in the SIZE box, which is what used to clobber details
document.getElementById("targetSize").value = "25000";
document.getElementById("targetSize").dispatchEvent(new Event("input"));
await new Promise(r => setTimeout(r, 500));
console.log("after size edit:", JSON.stringify(currentMeta.subject.details));
```

Expected: both lines print `{"units":"48"}`. If the second prints `{}`, the
details are being dropped — Step 1 was not applied correctly.

- [ ] **Step 5: Commit**

```bash
git --no-pager diff index.html
git add index.html
git commit -m "Persist subject details and send them with the search"
```

---

### Task 6: $/unit and $/acre valuation lines

**Files:**
- Modify: `index.html` (add an element next to `#ownerBasis`)
- Modify: `index.html:1909` (`renderOwnerHero`)

- [ ] **Step 1: Add the output element**

Find the element with `id="ownerBasis"` in the hero markup and add
immediately after it:

```html
            <p id="ownerAltBasis" class="hidden text-[13px] text-[#5A6473] mt-1"></p>
```

- [ ] **Step 2: Bridge Land acreage to square feet**

Land is quoted in acres but the whole valuation path is $/SF. Without this, a
Land user who enters only acres gets no valuation at all.

In `renderOwnerHero`, the size fallback chain starts at index.html:1924 with
`let sizeR = subjectRangeFromMeta("size");`. Insert immediately after that
line, **before** the `if (!sizeR && parsed)` block, so a user-entered acreage
outranks the model's looked-up size:

```js
    // Land is quoted in acres; convert so the existing $/SF path still works.
    // SF stays the canonical unit internally — acres is an input concept only.
    if (!sizeR && meta.type === "Land") {
      const acres = numericValue((s.details || {}).lot_acres);
      if (acres > 0) {
        const sf = Math.round(acres * 43560);
        sizeR = { min: sf, max: sf };
      }
    }
```

Also extend the "did the user signal building intent" test at index.html:1919
so a Land search with only acres entered still shows the hero:

```js
    const hasUserSubject = [s.sizeMin, s.sizeMax, s.priceMin, s.priceMax, s.noi].some((v) => v > 0)
      || numericValue((s.details || {}).lot_acres) > 0;
```

Verify in the console after reloading:

```js
currentMeta.type = "Land";
currentMeta.subject = { sizeMin: null, sizeMax: null, priceMin: null, priceMax: null, noi: null, details: { lot_acres: "2.5" } };
currentComps = [
  { transaction: "Sale", price_per_sqft: "$10", price_per_acre: "$430,000" },
  { transaction: "Sale", price_per_sqft: "$12", price_per_acre: "$500,000" },
  { transaction: "Sale", price_per_sqft: "$11", price_per_acre: "$460,000" },
];
renderOwnerHero(currentParsed, currentMeta);
console.log("hero hidden:", document.getElementById("ownerHero").classList.contains("hidden"));
console.log("likely:", lastValuation && Math.round(lastValuation.likely));
```

Expected: `hero hidden: false` and `likely: 1197900` — 2.5 acres is 108,900 SF
at the $11 median $/SF. Before this step the hero hides entirely, because
neither a size nor a street number is present.

Note the bridge sets the internal `sizeR` only; it deliberately does not write
into the `#targetSize` input, since that box is labelled in SF and the user
typed acres.

- [ ] **Step 3: Add the secondary-basis computation**

Inside `renderOwnerHero`, after `const ppsfs = saleComps.map((x) => x.v);`
(index.html:1944), add:

```js
    // Secondary basis: $/unit for multifamily, $/acre for land. Both reuse the
    // per-comp metrics added in #5 and only render with enough comps to be
    // worth stating — one data point is not a range.
    const altEl = document.getElementById("ownerAltBasis");
    altEl.classList.add("hidden");
    altEl.textContent = "";
    const details = s.details || {};
    const ALT = {
      Multifamily: { compKey: "price_per_unit", subjKey: "units",     noun: "unit" },
      Land:        { compKey: "price_per_acre", subjKey: "lot_acres", noun: "acre" },
    }[meta.type];
    if (ALT) {
      const qty = numericValue(details[ALT.subjKey]);
      const per = saleComps
        .map((x) => numericValue(x.comp[ALT.compKey]))
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
      if (qty > 0 && per.length >= 3) {
        const median = per[Math.floor(per.length / 2)];
        altEl.textContent =
          `Cross-check: ${qty.toLocaleString()} ${ALT.noun}${qty === 1 ? "" : "s"} x ` +
          `${formatUsd(median, { maximumFractionDigits: 0 })} median per ${ALT.noun} ` +
          `across ${per.length} sale comps = ${formatUsd(qty * median, { maximumFractionDigits: 0 })}.`;
        altEl.classList.remove("hidden");
      }
    }
```

- [ ] **Step 4: Verify with stubbed comps (free, no search)**

Reload, open the sample report so the hero renders, then in the console:

```js
currentComps = [
  { transaction: "Sale", price_per_sqft: "$200", price_per_unit: "$150,000" },
  { transaction: "Sale", price_per_sqft: "$210", price_per_unit: "$160,000" },
  { transaction: "Sale", price_per_sqft: "$190", price_per_unit: "$170,000" },
];
currentMeta.type = "Multifamily";
currentMeta.subject = { ...currentMeta.subject, details: { units: "48" } };
renderOwnerHero(currentParsed, currentMeta);
document.getElementById("ownerAltBasis").textContent;
```

Expected: `Cross-check: 48 units x $160,000 median per unit across 3 sale comps = $7,680,000.`

Then confirm the guards hold:

```js
currentComps = currentComps.slice(0, 2);          // only 2 comps
renderOwnerHero(currentParsed, currentMeta);
document.getElementById("ownerAltBasis").classList.contains("hidden");   // true
```

```js
currentMeta.type = "Industrial";                   // type without an alt basis
renderOwnerHero(currentParsed, currentMeta);
document.getElementById("ownerAltBasis").classList.contains("hidden");   // true
```

- [ ] **Step 5: Commit**

```bash
git --no-pager diff index.html
git add index.html
git commit -m "Add \$/unit and \$/acre cross-check to the value hero"
```

---

### Task 7: Live end-to-end verification

**Cost: 3 billed searches, roughly $1.80.** Every earlier task was free.
Use addresses that have never been searched, or the 7-day cache will serve a
pre-change payload and prove nothing.

**Files:** none modified — this task only verifies.

- [ ] **Step 1: Restart and confirm the server is on current code**

Restart the dev server, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/healthz
```

Expected: `200`.

- [ ] **Step 2: Search with subject details (billed #1)**

```bash
curl -s --max-time 300 -X POST http://localhost:3000/api/comps \
  -H 'content-type: application/json' \
  -d '{"address":"1801 E 6th St, Austin, TX","type":"Multifamily","note":"","months":12,"txFocus":"both","subjectDetails":{"units":"48"}}' \
  -o /tmp/mf-a.json -w "http=%{http_code} %{time_total}s\n"
```

Expected: `http=200`. Then confirm the comps skew toward similar-size
properties rather than triplexes:

```bash
"$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" -e '
const c=require("/tmp/mf-a.json").comps||[];
console.log("comps:", c.length);
c.forEach(x=>console.log("  units="+JSON.stringify(x.units)+"  "+String(x.address).slice(0,50)));'
```

Expected: most comps report a unit count within roughly an order of magnitude
of 48. This is a judgement call, not a hard assertion — record what you see.

- [ ] **Step 3: Repeat the identical request — must be a CACHE HIT (free)**

Run the exact same curl from Step 2, writing to `/tmp/mf-b.json`.

Expected: `http=200` returning in **under ~2 seconds** (a billed search takes
40-90s). Confirm the payloads match:

```bash
diff <(jq -S . /tmp/mf-a.json) <(jq -S . /tmp/mf-b.json) && echo "IDENTICAL (cache hit confirmed)"
```

If this takes 40+ seconds, the cache key is unstable across identical
requests — Task 2 Step 3 is wrong.

- [ ] **Step 4: Same address, different unit count — must MISS (billed #2)**

```bash
curl -s --max-time 300 -X POST http://localhost:3000/api/comps \
  -H 'content-type: application/json' \
  -d '{"address":"1801 E 6th St, Austin, TX","type":"Multifamily","note":"","months":12,"txFocus":"both","subjectDetails":{"units":"6"}}' \
  -o /tmp/mf-c.json -w "http=%{http_code} %{time_total}s\n"
```

Expected: `http=200` taking 40-90s — a genuine miss. **If this returns in
under 2 seconds the cache-key fix is not working and the two buildings are
sharing comps.** That is the single most important assertion in this task.

- [ ] **Step 5: Confirm details survive a share, and NOI does not (billed #0)**

In the browser, run a Multifamily search with a unit count and an NOI entered,
click Share link, then fetch the published report:

```bash
curl -s "http://localhost:3000/api/shared?id=<ID_FROM_THE_SHARE_URL>" \
  | "$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const m=JSON.parse(d).meta||{};
  console.log("details:", JSON.stringify((m.subject||{}).details));
  console.log("noi:", JSON.stringify((m.subject||{}).noi));});'
```

Expected: `details: {"units":"48"}` and `noi: null`. Public attributes travel;
private finances do not.

- [ ] **Step 6: Confirm no regression for types without details**

```bash
curl -s -X POST http://localhost:3000/api/comps -H 'content-type: application/json' \
  -d '{"address":"2801 S Great Southwest Pkwy, Grand Prairie, TX","type":"Industrial","note":"","months":12,"txFocus":"both"}' \
  -o /dev/null -w "no-details Industrial: http=%{http_code} %{time_total}s\n"
```

Expected: `http=200`. Whether it is fast (cached) or slow (billed) is fine —
the point is that omitting `subjectDetails` entirely still works.

- [ ] **Step 7: Record results and commit nothing**

This task changes no files. Write the observed comp-unit spread from Step 2
and the Step 4 timing into the PR/commit description for the feature.

---

## Deployment notes

- **No Supabase migration is required.** Subject details live inside the
  existing `meta` JSON blob in `portfolio_items.payload` and
  `shared_reports.payload`; no new columns. (Contrast with #5, which did need
  an `ALTER TABLE`.)
- **The search cache is preserved.** Task 2 appends to the key only when
  details are present, so existing cached searches keep their keys and are not
  mass-invalidated on deploy.
- **Restart required on deploy** as always for `server.js` changes; Render
  handles this automatically.
