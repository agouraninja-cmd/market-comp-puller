# Compact Comp Encoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model writes comps under 1-3 char keys and omits empty fields; the server re-expands to today's exact long-key shape at parse time. ~17-20% smaller model output, no downstream changes.

**Architecture:** One new map (`SHORT_COMP_KEYS`) + one expansion/backfill function pair in server.js, wired at the single parse site and inside the live-preview extractor callback. Prompt gets a short-key template, a legend line, and an omit-empties line. Everything downstream of the parse site is untouched, by construction.

**Tech Stack:** Plain Node 18+. Deterministic end-to-end proof via the fetch-shim harness (canned SHORT-KEY report), then two real billed searches for the model-reliability question the shim cannot answer.

**Spec:** `docs/superpowers/specs/2026-08-03-compact-comp-encoding-design.md`

**Cautions:**
- Shared working tree: stage explicit paths, read staged diffs.
- server.js edits need a restart. Grep for anchors, don't trust line numbers.
- No em dashes in written output.

---

### Task 1: Server: map, expansion, prompt, extractor

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add `SHORT_COMP_KEYS` + expansion helpers directly after `ALL_TYPE_COMP_FIELDS`**

```js
// Compact comp encoding (2026-08-03): the model writes each comp under these
// SHORT keys and the server re-expands immediately after parse — the long key
// names alone measured 20-23% of a real report, and model OUTPUT is the wall
// clock. Long -> short. A NEW COMP FIELD NEEDS AN ENTRY HERE (the
// add-comp-field skill has the step). Shorts must stay unique and must never
// collide with a long name.
const SHORT_COMP_KEYS = {
  address: "a", date: "d", transaction: "t", size_sqft: "sf",
  price_or_rate: "p", price_per_sqft: "psf", cap_rate: "cap",
  tenancy: "ten", year_built: "yr", notes: "n", source_url: "u",
  source_type: "st", verified: "v",
  clear_height: "ch", dock_doors: "dd", building_class: "bc",
  floor_plate: "fp", center_type: "ct", anchor_tenant: "at",
  units: "un", price_per_unit: "ppu", lot_acres: "ac",
  price_per_acre: "ppa", zoning: "z", beds_baths: "bb",
};
const LONG_COMP_KEYS = Object.fromEntries(
  Object.entries(SHORT_COMP_KEYS).map(([l, s]) => [s, l])
);

// Re-expand one short-keyed comp. Tolerant by design: long keys pass through
// (a model that ignores the encoding produces exactly the old behavior),
// unknown keys survive, and a long key wins over its short twin if both
// arrive. Never throws on junk — returns it unchanged.
function expandComp(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return c;
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    const long = LONG_COMP_KEYS[k];
    if (long) { if (!(long in c)) out[long] = v; }
    else out[k] = v;
  }
  return out;
}

// Expand every comp in a parsed report, then backfill omitted fields to ""
// for the base shape + this type's fields (+ tenancy/year_built unless Land),
// and coerce `verified` to a boolean — so the stored/served report is
// byte-shaped exactly like the pre-encoding output and nothing downstream
// (normalization, gate, cache, harvest, market pages) can meet undefined.
function expandCompKeys(parsed, type) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  const base = ["address", "date", "transaction", "size_sqft", "price_or_rate",
    "price_per_sqft", "cap_rate", "notes", "source_url", "source_type"];
  const spec = TYPE_COMP_FIELDS[type];
  const fill = [...base, ...(spec ? spec.fields : []),
    ...(type === "Land" ? [] : ["tenancy", "year_built"])];
  parsed.comps = parsed.comps.map((c) => {
    const e = expandComp(c);
    if (!e || typeof e !== "object" || Array.isArray(e)) return e;
    for (const k of fill) if (e[k] == null) e[k] = "";
    e.verified = e.verified === true;
    return e;
  });
  return parsed;
}
```

- [ ] **Step 2: Wire the parse site**

Find the single line `parseCompJson(text)` is consumed on (currently `const parsed = reconcilePricePerSqft(normalizeTrendPct(normalizeCurrency(normalizeSourceTypes(parseCompJson(text)))));`). Confirm `type` is in scope in that function (it is an argument of the enclosing call path); insert the expansion innermost:

```js
const parsed = reconcilePricePerSqft(normalizeTrendPct(normalizeCurrency(normalizeSourceTypes(expandCompKeys(parseCompJson(text), type)))));
```

- [ ] **Step 3: Rebuild `compShape` from the map and add the legend + omit lines**

Replace the `typeFields`/`buildingFields`/`compShape` block with:

```js
  const S = SHORT_COMP_KEYS;
  const typeFields = typeSpec ? typeSpec.fields.map((f) => `"${S[f]}": "", `).join("") : ``;
  const buildingFields = isLand ? `` : `"${S.tenancy}": "", "${S.year_built}": "", `;
  const compShape = `{ "${S.address}": "", "${S.date}": "", "${S.transaction}": "", "${S.size_sqft}": "", ${typeFields}"${S.price_or_rate}": "", "${S.price_per_sqft}": "", "${S.cap_rate}": "", ${buildingFields}"${S.notes}": "", "${S.source_url}": "", "${S.source_type}": "", "${S.verified}": false }`;
  // Legend for the compact keys, restricted to the fields this type's shape
  // actually carries so the prompt never teaches keys the shape doesn't use.
  const legendFields = ["address", "date", "transaction", "size_sqft",
    ...(typeSpec ? typeSpec.fields : []),
    "price_or_rate", "price_per_sqft", "cap_rate",
    ...(isLand ? [] : ["tenancy", "year_built"]),
    "notes", "source_url", "source_type", "verified"];
  const compKeyLegend = legendFields.map((f) => `"${S[f]}"=${f}`).join(", ");
```

Then add ONE prompt line immediately before the `Rules:` line:

```js
    `COMPACT COMP KEYS: in "comps", write every field under its SHORT key exactly as the template shows: ${compKeyLegend}. The rules in this prompt refer to these fields by their FULL names - apply each rule to its short key. Also, in "comps", OMIT any field you have no value for instead of writing an empty string (top-level fields outside "comps" keep "" when unknown, exactly as stated elsewhere).`,
```

- [ ] **Step 4: Remap streamed comps in the extractor callback**

In `callAnthropicOnce`, change the `makeCompExtractor` callback to expand first:

```js
  let compExtractor = (typeof onProgress === "function" && lane !== "records")
    ? makeCompExtractor((c0, n) => {
        const c = expandComp(c0);   // short-keyed mid-stream; events keep long names
        say({
          phase: "comp", n,
          address: String((c && c.address) || ""),
          price: String((c && (c.price_or_rate || c.price_per_sqft)) || ""),
          // Preview-safe extras only. Deliberately NOT price_per_sqft (corrected
          // post-parse by reconcilePricePerSqft) and NOT source_type (demoted
          // post-parse by normalizeSourceTypes): the preview must never show a
          // figure or badge the final report walks back.
          size_sqft: String((c && c.size_sqft) || ""),
          date: String((c && c.date) || ""),
          transaction: String((c && c.transaction) || ""),
        });
      })
    : null;
```

- [ ] **Step 5: Syntax check** — `node --check server.js`, exit 0.

---

### Task 2: Deterministic proof via the fetch shim (free)

- [ ] **Step 1: Rewrite the shim's canned report to the NEW encoding** — short keys, empties omitted, one comp deliberately using LONG keys (tolerance check), one comp omitting `v`:

In `<scratchpad>/fake-anthropic.js`, replace `REPORT.comps` with:

```js
  comps: [
    { a: "100 Test Industrial Way, Testville, TX", d: "2026-01-15", t: "Sale", sf: "10,000", p: "$1,100,000", psf: "$110", ch: "24 ft", dd: "1", n: "Clean single tenant deal.", u: "https://example.com/comp", st: "listing" },
    { a: "200 Test Industrial Way, Testville, TX", d: "2026-02-15", t: "Sale", sf: "20,000", p: "$2,200,000", psf: "$110", n: "Clean single tenant deal.", u: "https://example.com/comp", st: "listing", v: true },
    { address: "300 Test Industrial Way, Testville, TX", date: "2026-03-15", transaction: "Sale", size_sqft: "30,000", price_or_rate: "$3,300,000", price_per_sqft: "$110", source_url: "https://example.com/comp", source_type: "listing", notes: "Long-keyed comp, tolerance check." },
    { a: "400 Test Industrial Way, Testville, TX", d: "2026-04-15", t: "Sale", sf: "40,000", p: "$4,400,000", psf: "$110", ten: "Single tenant", yr: "2019", st: "public_record", u: "https://example.com/comp" },
    { a: "500 Test Industrial Way, Testville, TX", d: "2026-05-15", t: "Sale", sf: "50,000", p: "$5,500,000", psf: "$110", st: "listing", u: "https://example.com/comp" },
  ],
```

- [ ] **Step 2: Run the shim + SSE probe** (re-add the `shim` launch.json entry, `preview_start`, run `sse-client.js`, then remove the entry). Assert from the probe output:
- every `comp` progress event carries a long-name `address`/`price`/`size_sqft`/`date` (extractor remap works on short keys AND on the long-keyed comp 3)
- the final `result` comps ALL have long keys, include `cap_rate: ""`/`tenancy: ""` etc. backfilled, `verified` boolean (true only on comp 2), and no `a:`/`sf:` short keys anywhere.

- [ ] **Step 3: Strip Testville rows from `search-cache.json` and `comp-corpus.jsonl`** (same cleanup as before).

- [ ] **Step 4: Commit the server half**

```powershell
git add server.js
git diff --cached -- server.js
git commit -m "Compact comp encoding: short keys + omitted empties, re-expanded at parse" -- server.js
```

---

### Task 3: Model-reliability verification (two real searches, ~$0.72)

- [ ] **Step 1: Restart the real `dev` server.**

- [ ] **Step 2: Search 1 — Industrial, fresh market** (e.g. "1801 E Overland Rd, Meridian, ID"). Watch the live preview fill (proves extractor remap against the real model). After completion, assert on the cached report: all long keys, no short keys, no `undefined` in the serialized JSON, `price_per_sqft` populated on most comps, total size vs the ~5,600-6,400 char 7-comp baselines.

- [ ] **Step 3: Search 2 — Multifamily, fresh market** (e.g. "1002 W Franklin St, Boise, ID"). Additionally assert `units`/`price_per_unit` populate (the `un`/`ppu` mapping worked).

- [ ] **Step 4: Judge.** Pass = long-key shape perfect, field-population comparable to baselines, size down. Fumble = missing/misfiled values traceable to the encoding → delete the legend line, restore the long-key `compShape` (keep omit-empties + expansion layer), re-verify with one more search.

---

### Task 4: Docs, devlog, ship

- [ ] **Step 1: add-comp-field skill** (`.claude/skills/add-comp-field/SKILL.md`): add the step "give the field a short key in `SHORT_COMP_KEYS` (server.js) — unique, no collision with any long name; the legend line picks it up automatically."

- [ ] **Step 2: CLAUDE.md** — in the measured-composition paragraph, after the narrative-caps sentence, add:

```
  The comps array itself got compact encoding on 2026-08-03: the model
  writes 1-3 char keys (`SHORT_COMP_KEYS`) and omits empty fields;
  `expandCompKeys` restores the long-keyed, ""-backfilled shape at parse
  time, so only the MODEL OUTPUT is smaller — every stored and served
  report keeps the classic shape. A new comp field needs a short key too
  (the add-comp-field skill has the step).
```

- [ ] **Step 3: devlog entry** (top of devlog.json), commit all with explicit paths, push `HEAD:main` (merge origin/main first if it moved), background health check on the live site.

---

## Self-review notes

- Spec coverage: map+helpers (T1S1), parse site (T1S2), prompt template/legend/omit (T1S3), extractor (T1S4), tolerance + backfill proven deterministically (T2), reliability on the real model incl. type fields (T3), docs/skill/devlog (T4), fallback path (T3S4). No gaps.
- `verified` coercion to boolean happens in `expandCompKeys` for every comp, including long-keyed ones — today's shape has `"verified": false` from the template, so backfill preserves the contract.
- The records lane parses through the same site, so its comps expand too before `mergeLaneReports`.
