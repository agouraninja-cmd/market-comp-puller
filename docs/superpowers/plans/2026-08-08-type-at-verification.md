# Type at Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The property type is resolved at the address-verification step (OSM detection, per-address memory, or a six-button pick in the confirm dialog) instead of silently defaulting to Industrial; the freed main-form slot gets the Building size (SF) field.

**Architecture:** `#propertyType` stays in the DOM as a hidden `<select>` and remains the single source of truth every existing reader keeps using. A new `typeResolution` state (null | "detected" | "explicit") decides whether the confirm dialog must ask. Server changes are one analytics outcome word plus its stats counter and admin tile cell.

**Tech Stack:** Plain Node (no deps), vanilla JS in index.html, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-08-type-at-verification-design.md`

## Global Constraints

- Zero changes to the search flow, cache keys, corpus, entitlements, or gating. The type still rides the POST body.
- No em dashes in any user-facing copy or devlog text (owner rule).
- `devlog.json` must stay clean UTF-8; follow the shared-checkout skill's rebuild-staged-version procedure when committing it.
- **Shared checkout:** another session has uncommitted work in `server.js`, `report-parse.js`, and `test/report-parse.test.js`. Before every stage, run `git status --short`; if a file you must modify carries foreign hunks, stage only your hunks via the shared-checkout skill's filtered-patch procedure (`git diff -- <file>`, select your `@@` hunks, `git apply --cached`, then verify `git diff --cached` contains only your work). Never `git add -A`.
- Editing `server.js` requires restarting the local process; `index.html` does not.
- The tailwind regen hook runs when index.html is edited in a session; if `tailwind.css` changed, verify any genuinely new utility class landed in it and commit it alongside. Prefer already-used utilities so no new ones are needed.
- Never trigger a real billed search during verification. Boot the local server with `ANTHROPIC_API_KEY=` (empty) so a stray click cannot bill anything.
- **Line numbers in this plan are stale by 40-60 lines in `index.html`.** They were captured before commits `ccfbe9a` and `996ff15` landed. **Locate every edit by symbol name, not by line number** (`grep -n "userChoseType" index.html`, etc.). The symbols themselves are current and verified.
- **Two landed commits interact with this work, both benignly:**
  - `ccfbe9a` moved the test server boot into `test/helpers/boot.js`; `test/routes.test.js` now does `const shared = require("./helpers/boot")`. Task 1's test uses the existing `boot` binding in that file, not a new spawn.
  - `996ff15` added machine-size provenance (`noteMachineSize` / `dropStaleMachineSize` / `sizeAddrKey`, tagging `#targetSize`'s dataset with the address a machine-written size belongs to, dropped at submit). It is **compatible with Task 3 by design** — its own comment says the provenance "travels with the element if the field is ever moved," which is exactly what Task 3 does. Moving `#targetSize` requires **no change** to that logic; just do not drop the `id`, and leave `dropStaleMachineSize(address)` where it sits at the top of the submit handler.

---

### Task 1: Server accepts and counts `dialog_pick`

**Files:**
- Modify: `server.js` (route `POST /api/type-autofill` OUTCOMES list; the `typeAutofill:` stats block; the admin tile's `var ta=` default and its breakdown line — find each by those strings)
- Test: `test/routes.test.js`, inside the existing `test("admin gating", …)` block (its key constant is `ADMIN`, its server is `srv`)

**Interfaces:**
- Consumes: existing `logEvent("type_autofill", …)` plumbing; nothing new.
- Produces: `/api/type-autofill` accepts `outcome: "dialog_pick"`; `/api/stats` `typeAutofill` object gains `dialogPick: <number>`. Task 2's client sends `"dialog_pick"`.

- [ ] **Step 1: Write the failing test**

In `test/routes.test.js`, inside `test("admin gating", async (t) => {…})`, add this subtest immediately after the existing `"the header form is accepted"` subtest. The surrounding block already defines `ADMIN` and `srv`; use them as-is.

```js
  // The confirm dialog's type picker logs outcome "dialog_pick". The route's
  // allowlist and the stats aggregation are two separate places, and a word
  // accepted by one but uncounted by the other is invisible: /admin's tile
  // would under-report while the events pile up correctly in the table.
  await t.test("the type-autofill block counts the confirm dialog's picks", async () => {
    const r = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": ADMIN } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.typeAutofill, "typeAutofill block missing");
    assert.equal(typeof body.typeAutofill.dialogPick, "number");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `typeAutofill.dialogPick` being `undefined`, everything else green.

- [ ] **Step 3: Implement**

In `server.js`:

1. Route allowlist (~11497):
```js
const OUTCOMES = ["applied", "agreed", "no_address_match", "ambiguous", "failed", "dialog_pick"];
```

2. Stats block (~5938), add one line beside the other counters:
```js
        applied: n("applied"),
        agreed: n("agreed"),
        dialogPick: n("dialog_pick"),
```

3. Admin tile (~6219 default and ~6303 render). Extend the stale-response default:
```js
  var ta=d.typeAutofill||{attempts:0,applied:0,agreed:0,dialogPick:0,noAddressMatch:0,ambiguous:0,failed:0,pct:0};
```
and in the tile's breakdown line add the count (and extend the `title` attribute's legend with `dialog_pick = the visitor picked it in the confirm dialog.`):
```js
      (ta.attempts?"<div class=muted style='margin-top:2px'>"+ta.agreed+" agreed &middot; "+(ta.dialogPick||0)+" dialog &middot; "+ta.noAddressMatch+
        " no match &middot; "+ta.ambiguous+" ambiguous &middot; "+ta.failed+" failed</div>":"")+
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all suites; the new subtest included).

- [ ] **Step 5: Commit (filtered staging — server.js may carry foreign hunks)**

```bash
git status --short
# If server.js shows foreign uncommitted work, follow shared-checkout:
git diff -- server.js            # identify YOUR three hunks by @@ headers
# build a patch containing only those hunks, then:
# git apply --cached your-hunks.patch
# otherwise plain:
git add test/routes.test.js      # always clean to add whole
git diff --cached                # read the WHOLE staged diff; foreign hunks = stop
git commit -m "Accept and count the confirm dialog's type pick in type-autofill analytics"
```

---

### Task 2: Type resolution state, per-address memory, and the confirm dialog's type row

The select stays visible in this task; every commit leaves working software. The dialog only asks when nothing has resolved the type.

**Files:**
- Modify: `index.html`
  - confirm modal markup (~line 796, between `#confirmMap` and the button row)
  - type-autofill block (~lines 5389-5464: `userChoseType`, `applyDetectedType`, the address `change` listener)
  - explorer chip click (~5130), explorer deep link (~5229), `rerunHistory` (~6540), shared-report restore (~2689)
  - `openConfirmModal` / `closeConfirmModal` / `confirmRunBtn` handler (~10912-10990)
  - submit handler confirm gate (~11109) and the `lastPropertyType` write (~11130)

**Interfaces:**
- Consumes: Task 1's server acceptance of `outcome: "dialog_pick"` (via the existing `logTypeAutofill(addr, outcome, type)` helper).
- Produces, for Task 3:
  - `let typeResolution = null | "detected" | "explicit"` (module-scope, same scope as `userChoseType` today, which it replaces)
  - `function setTypeProgrammatic(next)` — sets the select, `applyRecommendedLookback()`, `renderSubjectFields(next)`
  - `function buildTypeButtons(wrap, selected, onPick)` — renders the six type buttons into `wrap`
  - `function renderTypeStatus(customNodes)` — no-op until Task 3 adds the element (guarded on `document.getElementById("typeAutoNote")` existing wherever it lives)
  - `function addrTypeStore(addr, type)` / `function addrTypeFor(addr)` — localStorage `addrType.v1`

- [ ] **Step 1: Confirm modal markup**

After the `#confirmMap` div (~line 796), insert:

```html
      <div id="confirmTypeWrap" class="mt-4">
        <p class="text-sm text-slate-500">Property type:</p>
        <div id="confirmTypeResolved" class="hidden text-sm font-medium text-slate-900 mt-0.5"></div>
        <div id="confirmTypeButtons" class="hidden mt-1.5 flex flex-wrap gap-1.5"></div>
        <p id="confirmTypeHint" class="hidden text-xs text-[#B91C1C] mt-1.5">Pick the property type to run the report.</p>
      </div>
```

And on `#confirmRunBtn` (~line 799) add the disabled classes so gating is visible:
`disabled:opacity-60 disabled:cursor-not-allowed` appended to its class list.

- [ ] **Step 2: Replace `userChoseType` with `typeResolution` and add the helpers**

At ~line 5389, replace `let userChoseType = false;` with:

```js
  // Where the current type came from. null = nobody has decided for this
  // address yet, so the confirm dialog will ask. "detected" (OSM) is
  // evidence about ONE address and resets when the address changes;
  // "explicit" (any human choice) survives address edits — their call
  // stands until they change it.
  let typeResolution = null;

  // Mirrors the manual-change path: a type change without its recommended
  // lookback and its own subject fields was the bug applyDetectedType fixed.
  function setTypeProgrammatic(next) {
    propertyTypeSel.value = next;
    applyRecommendedLookback();
    renderSubjectFields(next);
  }

  // Task 3 adds the status element; until then this is a guarded no-op.
  function renderTypeStatus(customNodes) {
    const el = document.getElementById("typeStatusLine");
    if (!el) return;
    el.textContent = "";
    if (customNodes) { customNodes.forEach((n) => el.appendChild(n)); return; }
    const label = document.createElement("span");
    label.textContent = typeResolution === null
      ? "Property type: chosen when you run the report."
      : "Property type: " + propertyTypeSel.value + (typeResolution === "detected" ? " (detected)." : ".");
    el.appendChild(label);
    if (typeResolution !== null) el.appendChild(makeTypeChangeButton());
  }

  // Per-address type memory: re-runs never re-ask. Bounded like fpSize.v1.
  const ADDR_TYPE_KEY = "addrType.v1";
  let addrTypeCache = (() => { try { return JSON.parse(localStorage.getItem(ADDR_TYPE_KEY)) || {}; } catch (_) { return {}; } })();
  function addrTypeStore(addr, type) {
    addrTypeCache[String(addr || "").trim().toLowerCase()] = type;
    try {
      const keys = Object.keys(addrTypeCache);
      if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete addrTypeCache[k]);
      localStorage.setItem(ADDR_TYPE_KEY, JSON.stringify(addrTypeCache));
    } catch (_) { /* private mode — a nicety */ }
  }
  function addrTypeFor(addr) {
    const t = addrTypeCache[String(addr || "").trim().toLowerCase()];
    return t && [...propertyTypeSel.options].some((o) => o.value === t) ? t : null;
  }
```

`makeTypeChangeButton` is defined in Task 3; until then `renderTypeStatus` never reaches it (no `#typeStatusLine` element exists). Keep the existing select `change` listener at ~5391 but change its body to:

```js
  propertyTypeSel.addEventListener("change", () => {
    typeResolution = "explicit";      // their call from here on
    typeAutoNote.textContent = "";
    renderTypeStatus();
  });
```

(The other `change` listener at ~2315 that applies lookback + fields is untouched in this task.)

Then update every `userChoseType` reference:
- `applyDetectedType`'s Undo handler (~5420): `userChoseType = true;` → `typeResolution = "explicit"; renderTypeStatus();`
- Address-change listener guard (~5446): `if (userChoseType) return;` → handled in Step 4's rewrite below.
- Race re-check (~5455): `if (userChoseType || searchInFlight) return;` → `if (typeResolution === "explicit" || searchInFlight) return;`

In `applyDetectedType` (~5396): replace the three lines that set the value, lookback and fields with `setTypeProgrammatic(next)` (keeping `prevType`/`prevMonths` capture above it), and after the note is built add `typeResolution = "detected";`.

- [ ] **Step 3: Mark the four explicit programmatic sites**

Each site keeps its current behavior and gains resolution marking:

1. Explorer chip click (~5133):
```js
          if (sel.value !== listType) {
            sel.value = listType;
            applyRecommendedLookback();
            syncSubjectFieldsToType();   // programmatic set fires no "change"
          }
          typeResolution = "explicit";   // the chip names its type; nothing to ask
          renderTypeStatus();
```
2. Explorer deep link (~5231), after `syncSubjectFieldsToType();` inside the `if (t && …)` block: add the same two lines.
3. `rerunHistory` (~6543), after `syncSubjectFieldsToType();`: add the same two lines (it `requestSubmit()`s immediately; without this the dialog would re-ask a type the saved report already carries).
4. Shared-report restore (~2689), after `syncSubjectFieldsToType();`: add the same two lines, guarded: `if (meta.type) { typeResolution = "explicit"; renderTypeStatus(); }`.

The `lastPropertyType` restore (~8069) is deliberately NOT marked: last session's asset class is a hint, not a decision about this address.

- [ ] **Step 4: Rewrite the address-change listener (memory first, then detection)**

Replace the body of the `document.getElementById("address").addEventListener("change", …)` handler (~5444) with:

```js
  document.getElementById("address").addEventListener("change", async () => {
    typeAutoNote.textContent = "";
    const addr = document.getElementById("address").value.trim();
    // A detection made for the previous address is not evidence about this one.
    if (typeResolution === "detected") { typeResolution = null; renderTypeStatus(); }
    if (typeResolution === "explicit") return;
    const remembered = addrTypeFor(addr);
    if (remembered) {
      if (remembered !== propertyTypeSel.value) setTypeProgrammatic(remembered);
      typeResolution = "explicit";   // it was their choice when they ran it
      renderTypeStatus();
      return;
    }
    if (Object.keys(readSubjectDetails()).length) return;
    if (!/^\d/.test(addr)) return;
    const guess = await detectPropertyType(addr);
    // Re-check every guard: the await gave the visitor a second or two to pick
    // a type, start typing details, edit the address, or fire the search.
    // A race is NOT logged — nothing was decided, so counting it would dilute
    // the very ratio the log exists to measure.
    if (typeResolution === "explicit" || searchInFlight) return;
    if (Object.keys(readSubjectDetails()).length) return;
    if (document.getElementById("address").value.trim() !== addr) return;
    if (!guess || !guess.type) return logTypeAutofill(addr, (guess && guess.outcome) || "failed", "");
    if (guess.type === propertyTypeSel.value) {
      // Right answer already selected. Under type-at-verification this IS a
      // resolution: the building's own OSM tag agrees, so the dialog need
      // not ask.
      typeResolution = "detected";
      renderTypeStatus();
      return logTypeAutofill(addr, "agreed", guess.type);
    }
    applyDetectedType(guess.type, guess.label);
    logTypeAutofill(addr, "applied", guess.type);
  });
```

- [ ] **Step 5: The dialog's type row and run gating**

Near the confirm-modal code (~10907), add state and helpers:

```js
  let dialogTypePick = null;

  function setConfirmRunEnabled(on) {
    document.getElementById("confirmRunBtn").disabled = !on;
    document.getElementById("confirmTypeHint").classList.toggle("hidden", on);
  }

  function buildTypeButtons(wrap, selected, onPick) {
    wrap.textContent = "";
    [...propertyTypeSel.options].forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.value;
      b.className = o.value === selected
        ? "text-sm font-medium rounded border border-[#1A2433] bg-[#1A2433] text-white px-2.5 py-1.5"
        : "text-sm rounded border border-slate-300 text-slate-700 hover:border-[#1A2433] px-2.5 py-1.5";
      b.addEventListener("click", () => onPick(o.value));
      wrap.appendChild(b);
    });
  }

  function showConfirmTypeButtons(preselected) {
    dialogTypePick = preselected || null;
    document.getElementById("confirmTypeResolved").classList.add("hidden");
    const wrap = document.getElementById("confirmTypeButtons");
    wrap.classList.remove("hidden");
    buildTypeButtons(wrap, dialogTypePick, (v) => {
      dialogTypePick = v;
      buildTypeButtons(wrap, v, arguments.callee ? undefined : undefined); // see note
      setConfirmRunEnabled(true);
    });
    setConfirmRunEnabled(!!dialogTypePick);
  }
```

Note on the builder: `arguments.callee` is a placeholder failure — do NOT write that. Write it as a named inner function instead:

```js
  function showConfirmTypeButtons(preselected) {
    dialogTypePick = preselected || null;
    document.getElementById("confirmTypeResolved").classList.add("hidden");
    const wrap = document.getElementById("confirmTypeButtons");
    wrap.classList.remove("hidden");
    const repaint = () => buildTypeButtons(wrap, dialogTypePick, (v) => {
      dialogTypePick = v;
      repaint();
      setConfirmRunEnabled(true);
    });
    repaint();
    setConfirmRunEnabled(!!dialogTypePick);
  }
```

In `openConfirmModal`, after the `matchedWrap` block and before the map code, add:

```js
    // Property type: resolved shows a passive line with a change door;
    // unresolved shows the six buttons and holds the run button until one
    // is picked — the whole point is that nothing silently runs Industrial.
    dialogTypePick = null;
    const typeResolvedEl = document.getElementById("confirmTypeResolved");
    const typeButtonsEl = document.getElementById("confirmTypeButtons");
    typeButtonsEl.classList.add("hidden");
    if (typeResolution === null) {
      showConfirmTypeButtons(null);
    } else {
      typeResolvedEl.classList.remove("hidden");
      typeResolvedEl.textContent = "";
      const t = document.createElement("span");
      t.textContent = propertyTypeSel.value + (typeResolution === "detected" ? " (detected from the building's map data) " : " ");
      const change = document.createElement("button");
      change.type = "button";
      change.textContent = "change";
      change.className = "text-sm text-[#5A6473] underline hover:text-[#1A2433]";
      change.addEventListener("click", () => showConfirmTypeButtons(propertyTypeSel.value));
      typeResolvedEl.appendChild(t);
      typeResolvedEl.appendChild(change);
      setConfirmRunEnabled(true);
    }
```

In the `confirmRunBtn` click handler (~10978), before `closeConfirmModal()`:

```js
    if (dialogTypePick) {
      setTypeProgrammatic(dialogTypePick);
      typeResolution = "explicit";
      renderTypeStatus();
      logTypeAutofill(document.getElementById("address").value.trim(), "dialog_pick", dialogTypePick);
    }
```

In `closeConfirmModal`, add `dialogTypePick = null;` so Escape/edit leaves the type unresolved and the next submit asks again.

- [ ] **Step 6: Submit-handler gate and per-address memory write**

At ~11109 change the confirm gate so an unresolved type always gets the dialog, even for a session-confirmed address:

```js
    if (!confirmedAddresses.has(confirmKey) || typeResolution === null) {
```

At ~11130, beside the `lastPropertyType` write, add:

```js
    try { localStorage.setItem("lastPropertyType", type); } catch (_) {}
    addrTypeStore(address, type);   // re-runs of this address never re-ask
```

- [ ] **Step 7: Syntax check and hand-verify in the browser**

Run: `node --check server.js` (unchanged but cheap) and load the page. Boot for verification without a billable key and without the wall:

```bash
ANTHROPIC_API_KEY= ACCOUNT_WALL=off PORT=3117 node server.js
```

Open `http://localhost:3117` in the preview pane. Verify:
1. Type an address with no OSM coverage (e.g. a made-up numbered address), submit: the dialog shows six buttons, Run disabled, hint visible; picking one enables Run.
2. Escape the dialog; submit again: it asks again.
3. Pick a type via the still-visible select, submit: the dialog shows the passive "Office change" line, Run enabled.
4. `localStorage.getItem("addrType.v1")` in the console after a run attempt shows the address key (the actual search 503s with the empty key; the memory write happens before the fetch — if it does not, move `addrTypeStore` accordingly and re-verify).
5. No console errors on load.

- [ ] **Step 8: Commit**

```bash
git status --short          # index.html only ours; tailwind.css may have regen'd
git add index.html
git add tailwind.css        # only if the regen hook changed it
git diff --cached           # read the whole diff
git commit -m "Confirm dialog resolves the property type; per-address memory; typeResolution state"
```

---

### Task 3: Swap the form slot: size up, select hidden, status line in

**Files:**
- Modify: `index.html`
  - form row 1 (~lines 892-918), subject-details section (~966-998)
  - `renderTypeStatus` gains its element; add `makeTypeChangeButton` + inline picker
  - the two select `change` listeners (~2315, ~5391)

**Interfaces:**
- Consumes: `typeResolution`, `setTypeProgrammatic`, `buildTypeButtons`, `renderTypeStatus` from Task 2.
- Produces: `#typeStatusLine` + `#typeInlinePicker` elements; `makeTypeChangeButton()`.

- [ ] **Step 1: Form markup**

Replace the type cell (~906-917) with the size cell, moving the existing inputs (IDs unchanged so `renderSubjectFields`' relabeling, `maybeEstimateSize`, submit reads, and all restores keep working):

```html
          <div class="rd-cell">
            <label id="targetSizeLabel" class="rd-lab" for="targetSize">Building size (SF)</label>
            <div class="flex items-center gap-2">
              <input id="targetSize" type="number" min="0" step="any" placeholder="auto from records" class="rd-in" />
              <span class="text-sm text-slate-400 shrink-0">to</span>
              <input id="targetSizeMax" type="number" min="0" step="any" placeholder="max (optional)" class="rd-in" />
            </div>
            <p id="sizeEstimateNote" class="hidden text-xs text-slate-500 mt-1">Estimated from the building's footprint - edit if it's off.</p>
          </div>
```

Inside the address cell, after the `<input id="address" …>` line, add:

```html
            <div id="typeStatusLine" class="text-xs text-[#8A93A0] mt-1"></div>
            <div id="typeInlinePicker" class="hidden mt-1.5 flex flex-wrap gap-1.5"></div>
            <div id="typeAutoNote" class="text-xs text-[#8A93A0] mt-1"></div>
```

(`typeAutoNote` moves here from the old type cell; it keeps carrying the detection message + Undo exactly as today.)

Add the hidden select just above the closing of row 1's grid div (any spot inside the form works; keep it adjacent to the address cell for findability):

```html
          <select id="propertyType" class="hidden" tabindex="-1" aria-hidden="true">
            <option>Industrial</option>
            <option>Office</option>
            <option>Retail</option>
            <option>Multifamily</option>
            <option>Land</option>
            <option>Residential</option>
          </select>
```

In the subject-details section: delete the size `<div>` (~973-981, now promoted), change the summary (~968) to:

```html
            <span id="subjectSummary">+ Your property details <span class="text-[#8A93A0] font-normal">(price, NOI: optional, sharpens the estimate)</span></span>
```

and the hint (~971) to:

```html
            <p id="subjectHint" class="text-xs text-[#8A93A0] mb-3">Add a price to compare against the comp average, or NOI for an income-approach cross-check plus a DCF hold-or-sell analysis. Size is up top; it's pulled from public records automatically when left blank.</p>
```

- [ ] **Step 2: The status line's change door**

Next to `renderTypeStatus` (Task 2), add:

```js
  function makeTypeChangeButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "change";
    b.className = "underline text-[#5A6473] hover:text-[#1A2433] ml-1";
    b.addEventListener("click", () => {
      const wrap = document.getElementById("typeInlinePicker");
      if (!wrap.classList.contains("hidden")) { wrap.classList.add("hidden"); return; }
      wrap.classList.remove("hidden");
      buildTypeButtons(wrap, propertyTypeSel.value, (v) => {
        setTypeProgrammatic(v);
        typeResolution = "explicit";
        wrap.classList.add("hidden");
        typeAutoNote.textContent = "";
        renderTypeStatus();
      });
    });
    return b;
  }
```

Also make the unresolved state offer a door (people who want to pick up front still can). In `renderTypeStatus`, when `typeResolution === null`, append a button built the same way but labeled `pick it now`:

```js
    // inside renderTypeStatus, replacing the bare label-only branch:
    el.appendChild(label);
    const door = makeTypeChangeButton();
    if (typeResolution === null) door.textContent = "pick it now";
    el.appendChild(door);
```

(Adjust the Task 2 version of `renderTypeStatus` to this final form: label + door always, door text varies. Picking via the inline picker marks explicit, so `renderTypeStatus` then shows "Property type: Office. change".)

Call `renderTypeStatus()` once at startup, right after the `lastPropertyType` restore block (~8074), so the line is never blank.

- [ ] **Step 3: Retire the select's change listeners**

The select is hidden; no user event can change it, and every programmatic path now goes through `setTypeProgrammatic` or sets resolution itself. Delete both listeners:
- ~2315 (`applyRecommendedLookback` + `renderSubjectFields` on change) — its work is `setTypeProgrammatic`'s body.
- ~5391 (`typeResolution = "explicit"` on change, as rewritten in Task 2) — explicit marking now happens at each picker site.

Keep `syncSubjectFieldsToType()` and the initial-paint calls (~2319-2322) untouched.

Search for any remaining `dispatchEvent(new Event("change"` on the select; there should be none (the only `dispatchEvent` near the form is `targetSize`'s `input` event in `maybeEstimateSize`, which stays).

- [ ] **Step 4: Verify in the browser**

Same boot as Task 2 Step 7 (`ANTHROPIC_API_KEY= ACCOUNT_WALL=off PORT=3117 node server.js`). Verify:
1. Row 1 shows Address + Building size; no visible type dropdown anywhere.
2. Status line reads "Property type: chosen when you run the report. pick it now"; clicking "pick it now" shows six buttons; picking Office flips the line to "Property type: Office. change", applies Office's recommended lookback, and the details section shows Office fields (building class, floor plate).
3. Type a real address with OSM coverage (e.g. `350 5th Ave, New York, NY`), blur: detection fires, status shows Office detected with the OSM message and Undo in `typeAutoNote`; Undo reverts and the line shows the reverted type as explicit.
4. Submit with an unresolved type: dialog asks (six buttons). Submit after picking via "pick it now": dialog shows the passive line.
5. Subject details section: no size inputs inside, price/NOI/type fields intact; entering a size up top and running to the dialog carries it (check the request body would include it: `targetRange` reads the same IDs).
6. Mobile width (resize to 375px): row 1 stacks, size cell full-width, dialog buttons wrap.
7. No console errors.

- [ ] **Step 5: Commit**

```bash
git status --short
git add index.html
git add tailwind.css        # if the regen hook changed it
git diff --cached
git commit -m "Main form: size replaces the type dropdown; type status line with inline picker"
```

---

### Task 4: End-to-end verification, docs, devlog

**Files:**
- Modify: `CLAUDE.md` (flow 4's programmatic-type-change bullet; the index.html description)
- Modify: `devlog.json` (one new entry; rebuild-staged procedure)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new; ships the record.

- [ ] **Step 1: Full flow verification**

Boot `ANTHROPIC_API_KEY= ACCOUNT_WALL=off PORT=3117 node server.js` and walk, in one session:
1. Fresh visitor (clear localStorage): unresolved status line → submit → dialog demands a pick → pick → run (503s harmlessly on the empty key) → `addrType.v1` now remembers the address.
2. Re-enter the same address (blur): status flips to the remembered type with no dialog interrogation on next submit (passive line only).
3. Explorer deep link `http://localhost:3117/?explore=Dallas,%20TX&type=Industrial` (needs Pro; if gated locally, verify instead via the recent-search chip path): type resolves explicit, no dialog ask.
4. `npm test` passes.
5. `node --check server.js` passes.

- [ ] **Step 2: CLAUDE.md updates**

In flow 4's bullet list, replace the `#propertyType.value`/`syncSubjectFieldsToType` bullet with:

```markdown
   - **The type dropdown is gone from the visible form** (2026-08-08): a hidden
     `#propertyType` select remains the single source of truth, and the type is
     resolved at verification — OSM detection, per-address memory
     (localStorage `addrType.v1`), or a required pick in the confirm dialog
     (`typeResolution` in index.html: null | "detected" | "explicit"). Every
     programmatic type change must go through `setTypeProgrammatic()` (or call
     `syncSubjectFieldsToType()` and mark `typeResolution` itself), or the
     subject inputs keep the previous type's fields. The select fires no
     `change` events anymore; nothing may rely on them.
```

In the index.html architecture paragraph, after the sentence describing the form, add one sentence: the main form's second slot is the Building size (SF) field; the property type is chosen at the verification step and the confirm dialog blocks the run until a type is resolved.

- [ ] **Step 3: Devlog entry (rebuild-staged procedure)**

Entry to add (adjust the commit hash after Task 3's commit):

```json
{"date":"2026-08-08","type":"feature","title":"The property type is now chosen at verification, never silently defaulted","details":"Forgetting the property-type dropdown used to mean a confident Industrial report on an office building, because the dropdown defaulted to Industrial and nothing forced a look at it. The dropdown is gone from the form. The type now resolves at the address-verification step: the existing OpenStreetMap detection pre-fills it when the building's own map data names it, a per-address memory recalls what you ran last time, and when neither decides, the confirm dialog asks with six tap-to-pick buttons and refuses to run until one is chosen. A status line under the address always says what will run and offers a one-click change, which is also how a rendered report gets re-run under a different type. The freed slot in the form went to the building size field, promoted from the collapsed details section, because a typed size skips the model's records lookup and directly cuts search cost. Model-side type detection was considered and rejected: the prompt, cache, corpus and purchase records are all keyed per type before the search starts, so detection would need an extra classification call of roughly two to three cents and three to eight seconds per search, against zero for asking at the moment the visitor is already confirming the address. Costs and generation time are unchanged; the admin type-autofill tile now also counts dialog picks."}
```

Per shared-checkout: `git show HEAD:devlog.json`, insert only this entry, `git add` that staged version, restore the working file, verify with `git show :devlog.json | grep "chosen at verification"` and confirm no other session's entry was dropped. Watch CRLF.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md
git diff --cached
git commit -m "Docs + devlog for type-at-verification"
```

- [ ] **Step 5: Hand back for deploy**

Do NOT push or deploy in this plan. Report to the owner: feature complete locally, `npm test` green, and the deploy skill is the next step when they say ship it. Note for the deploy: no migration, no new env vars, server restart required (server.js changed).

---

## Self-Review Notes

- Spec coverage: form swap (Task 3), resolution order incl. memory (Task 2), hidden-select trick (Tasks 2-3), `dialog_pick` analytics (Task 1), edge cases (Escape re-asks: Task 2 Step 5; explicit survives address edits: Task 2 Step 4; Explorer/shared/rerun marked explicit: Task 2 Step 3; unverified-address dialog variant carries the same type row: the row renders regardless of `noMatch`).
- The `arguments.callee` snippet is explicitly flagged as a wrong version with the correct named-closure version beside it; implementers use the second form.
- Type names consistent: `typeResolution`, `setTypeProgrammatic`, `buildTypeButtons`, `renderTypeStatus`, `makeTypeChangeButton`, `addrTypeStore`/`addrTypeFor`, `dialogTypePick`, `showConfirmTypeButtons`, `setConfirmRunEnabled`.
- Working software at every commit: Task 1 server-only; Task 2 keeps the visible select; Task 3 completes the swap.
