# Complete the Pair + Footprint Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model spends a search completing the size on priced sale comps, and the browser pre-fills the subject's size from its OSM footprint during the confirm modal — feeding the hero and cutting the search budget by two.

**Architecture:** One prompt rule in `buildPrompt` (server.js). Client side: a footprint-area estimator reusing `overpassQuery` and the photo-snap scoring, hooked into `openConfirmModal`, filling `#targetSize` under an "estimated" note with `isTrusted`-gated clearing. No server route changes.

**Tech Stack:** Plain Node 18+, vanilla JS, Overpass API (browser-direct, two mirrors, fails free). Tailwind classes reused (no regen expected).

**Spec:** `docs/superpowers/specs/2026-08-04-complete-the-pair-design.md`

**Cautions:** shared tree (explicit paths, read staged diffs); server.js needs restart, index.html doesn't; grep anchors, don't trust line numbers; no em dashes.

---

### Task 1: Server — the complete-the-pair prompt rule

**Files:**
- Modify: `server.js` (`buildPrompt`, directly after the `SIZE FIT:` rule line)

- [ ] **Step 1: Add the rule line after the SIZE FIT line**

Find the prompt line starting `` `SIZE FIT: Prefer comps between roughly half and twice`` and add after that whole template-literal entry:

```js
    `PRICED BUT UNSIZED COMPS: a sale comp that has a price but no building size cannot support the valuation math. If a sale comp you are including has a price but you could not find its size, spend one of your searches specifically on that building's size (an assessor or listing page) before finalizing. Completing the size on 2-3 priced sale comps matters more than adding one more marginal comp.`,
```

- [ ] **Step 2: Syntax check** — `node --check server.js`, exit 0.

---

### Task 2: Client — footprint estimator + confirm-modal hook

**Files:**
- Modify: `index.html` (size-input markup ~line 865; new functions beside the `bldgCache` block ~line 4840; hook in `openConfirmModal` ~line 8746; note-clear listener)

- [ ] **Step 1: Add the note element under the size input row**

Read the container around `#targetSizeMax` (~line 869) and insert directly after the input row's wrapper:

```html
                <p id="sizeEstimateNote" class="hidden text-xs text-slate-500 mt-1">Estimated from the building's footprint - edit if it's off.</p>
```

- [ ] **Step 2: Add the estimator beside the bldgCache block (~line 4840)**

```js
  // Pre-search footprint sizing: while the visitor reads the confirm modal,
  // estimate the building's SF from its OSM footprint and fill the editable
  // size field. A filled size gives the hero its denominator on buildings
  // public records miss AND shrinks the server's search budget by the two
  // searches it would have spent looking the size up. Same honesty gate as
  // the map photos (verified geocode + street-numbered address), and the
  // value lands in the USER-EDITABLE field under a visible "estimated"
  // note - never presented as a record.
  const FP_SIZE_CACHE_KEY = "fpSize.v1";
  let fpSizeCache = (() => { try { return JSON.parse(localStorage.getItem(FP_SIZE_CACHE_KEY)) || {}; } catch (_) { return {}; } })();
  function fpSizeStore(key, val) {
    fpSizeCache[key] = val;
    try {
      const keys = Object.keys(fpSizeCache);
      if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete fpSizeCache[k]);
      localStorage.setItem(FP_SIZE_CACHE_KEY, JSON.stringify(fpSizeCache));
    } catch (_) { /* private mode - the cache is a nicety */ }
  }
  // Shoelace area of an OSM way's geometry in square feet, computed on
  // meter offsets from a local origin so float cancellation stays tame.
  function footprintSqft(geometry, lat0, lng0) {
    const mLat = 111320, mLng = 111320 * Math.cos(lat0 * Math.PI / 180);
    const pts = geometry.map((p) => ({ x: (p.lon - lng0) * mLng, y: (p.lat - lat0) * mLat }));
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area / 2) * 10.7639;
  }
  async function estimateSizeFromFootprint(geo) {
    const key = `${geo.lat.toFixed(6)},${geo.lng.toFixed(6)}`;
    if (key in fpSizeCache) return fpSizeCache[key] || null;
    const j = await overpassQuery(`[out:json][timeout:10];way(around:120,${geo.lat.toFixed(6)},${geo.lng.toFixed(6)})["building"];out geom;`);
    let best = null, bestScore = 0;
    for (const w of (j && j.elements) || []) {
      if (!Array.isArray(w.geometry) || w.geometry.length < 3) continue;
      const cLat = w.geometry.reduce((s, p) => s + p.lat, 0) / w.geometry.length;
      const cLng = w.geometry.reduce((s, p) => s + p.lon, 0) / w.geometry.length;
      const dLat = (cLat - geo.lat) * 111320;
      const dLng = (cLng - geo.lng) * 111320 * Math.cos(geo.lat * Math.PI / 180);
      const dist = Math.hypot(dLat, dLng);
      if (dist > 120) continue;
      // Biggest footprint near the pin, distance-discounted - the same idea
      // the photo snap uses, so both features pick the same main building.
      const sqft = footprintSqft(w.geometry, geo.lat, geo.lng);
      const score = Math.max(sqft, 100) / (dist + 25);
      if (score > bestScore) { bestScore = score; best = { sqft, tags: w.tags || {} }; }
    }
    let est = null;
    if (best) {
      const levels = Math.min(6, Math.max(1, parseInt(best.tags["building:levels"] || "1", 10) || 1));
      const total = best.sqft * levels;
      if (total >= 800 && total <= 2000000) est = Math.round(total / 100) * 100;
    }
    fpSizeStore(key, est || 0);   // 0 = known miss, cached so repeats are free
    return est;
  }
  async function maybeEstimateSize(typed, geo) {
    const sizeInput = document.getElementById("targetSize");
    if (!geo || !isFinite(geo.lat) || !isFinite(geo.lng)) return;
    if (sizeInput.value.trim() !== "") return;
    if (!/^\s*\d+\s+\S/.test(typed)) return;   // a submarket point must never size a random building
    if (document.getElementById("propertyType").value === "Land") return;
    try {
      const est = await estimateSizeFromFootprint(geo);
      // Fill only if nothing changed while we looked: no typed size, no
      // search already in flight (a fast confirm just runs sizeless, as
      // today, and the estimate waits for the next run).
      if (est && sizeInput.value.trim() === "" && !searchInFlight) {
        sizeInput.value = est;
        sizeInput.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("sizeEstimateNote").classList.remove("hidden");
      }
    } catch (_) { /* Overpass down - no estimate, exactly today */ }
  }
```

- [ ] **Step 3: Hook it into `openConfirmModal`**

Directly before the focus line (`document.getElementById(noMatch ? "confirmEditBtn" : "confirmRunBtn").focus();`), add:

```js
    // Footprint sizing runs while the visitor reads the modal; it never
    // blocks the confirm. noMatch means geo is null, which the helper skips.
    maybeEstimateSize(typed, geo);
```

- [ ] **Step 4: Clear the note on a real user edit and on a model-lookup autofill**

Beside the existing `#targetSize` listeners (~line 2151), add:

```js
  // The "estimated from footprint" note stops applying the moment the
  // visitor types their own number (isTrusted) or a report's looked-up
  // size overwrites the field.
  document.getElementById("targetSize").addEventListener("input", (e) => {
    if (e.isTrusted) document.getElementById("sizeEstimateNote").classList.add("hidden");
  });
```

And in the report-render autofill of the looked-up size (~line 2880, `const sizeInput = document.getElementById("targetSize");` block), add after the value is set:

```js
        document.getElementById("sizeEstimateNote").classList.add("hidden");
```

(Read that block first; add the line only where the input's value is actually assigned.)

---

### Task 3: Zero-cost client verification

- [ ] **Step 1: Start the local server** (`preview_start` name `dev-noguest`; port 3000 conflicts with the other session's server — if taken, add a temporary port-3117 variant).

- [ ] **Step 2: Walgreens positive case** — type "3263 North Eagle Road, Meridian, ID", type Retail, empty size, submit; when the confirm modal opens, wait ~3-8s (Overpass), then assert `#targetSize` filled with roughly 13,000-16,000 and `#sizeEstimateNote` visible. Cancel the modal (no billed search).

- [ ] **Step 3: Negative cases** — same address with type Land: no fill. A numberless address ("Financial District, Boston, MA"): no fill (geo may resolve; the street-number gate must catch it). A pre-typed size (25000): untouched, no note.

- [ ] **Step 4: isTrusted clear** — after a fill, simulate typing via the real keyboard path if possible; otherwise verify by code inspection that only trusted events hide the note (dispatched events must not).

---

### Task 4: Billed end-to-end + ship

- [ ] **Step 1: The Walgreens re-run (~$0.35, local)** — same address/type with the footprint-filled size riding along (new cache key). Assert: the report renders a value (total range via the subject size), and check whether the complete-the-pair rule got the Garden City comp its size (fill rates on priced sale comps). Report honestly if the market still yields only one priced comp — the hero should then at least show the per-SF fallback path with the size present.

- [ ] **Step 2: Docs + devlog** — devlog entry (top of devlog.json):

```json
{ "date": "2026-08-04", "type": "improvement", "title": "The valuation stops dying for want of one number", "details": "The Meridian Walgreens test showed the two ways a report starves: a $4M comp with no square footage (useless to the math), and no square footage for the searched building itself. Both are now attacked. The prompt tells the model that a priced sale comp without a size is worth one dedicated search to complete, because completing two or three priced comps matters more than finding one more. And while the visitor reads the address-confirmation dialog, the browser now measures the building's footprint on OpenStreetMap and pre-fills the size field with a clearly labeled, editable estimate. That fill also makes searches faster and cheaper: a search that already knows the building's size skips the two web searches the model would have spent looking it up. The estimate only appears for verified, street-numbered addresses with a building type, never for Land or submarket searches, and typing your own number replaces it.", "commit": "" }
```

CLAUDE.md: in flow 3 (valuation math), after the sentence about the looked-up size being auto-filled, add: "Since 2026-08-04 the browser also pre-fills an OSM footprint-derived size estimate during the address-confirm dialog (labeled, editable, `fpSize.v1` cache; gated to verified street-numbered non-Land addresses), which doubles as a search-budget cut since a known size skips the model's 2-search size lookup."

- [ ] **Step 3: Commit + deploy**

```powershell
git add server.js index.html CLAUDE.md devlog.json
git diff --cached
git commit -m "Complete priced-but-unsized comps, and pre-fill size from the OSM footprint" -- server.js index.html CLAUDE.md devlog.json
git fetch origin
git merge origin/main   # if moved; resolve devlog by keeping both sides
git push origin HEAD:main
```

Background health check: `sleep 150 && curl -s -o /dev/null -w "healthz HTTP %{http_code}\n" https://compninja.co/healthz`.

---

## Self-review notes

- Spec coverage: prompt rule (T1), estimator + gates + cache + note (T2), non-blocking + fast-confirm race guard (`searchInFlight`, T2S2), zero-cost checks incl. negatives (T3), billed Walgreens proof + docs (T4). No gaps.
- Type consistency: `estimateSizeFromFootprint(geo)` returns number|null; `maybeEstimateSize(typed, geo)` matches the `openConfirmModal({ typed, key, geo })` fields; `footprintSqft(geometry, lat0, lng0)` matches its call.
- All Tailwind classes in the note (`hidden text-xs text-slate-500 mt-1`) already exist in index.html.
