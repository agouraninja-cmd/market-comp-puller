# Live Report Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the model writes the report (the 40-70s stretch), the loading card shows the streamed market summary and a growing comp preview table, and pre-geocodes comp addresses so map pins paint instantly at render.

**Architecture:** Server side, two additive changes to the existing SSE progress path in server.js: richer `comp` events (size/date/transaction added) and a new one-shot `field` event carrying the top-level `summary` the moment its JSON value closes. Client side, the `#loadingComps` box on the loading card renders a summary paragraph plus a table instead of five text lines, and fires the existing `geocodeAddress()` helper per comp as a cache warmer. The final `result` event still drives the unchanged full `renderResults`, so reconciliation is automatic.

**Tech Stack:** Plain Node 18+ (no deps), vanilla JS in index.html, Tailwind (vendored; auto-regen hook covers new utility classes). No test suite covers these files (only entitlements.js is tested, per CLAUDE.md), so verification is a zero-cost fetch-shim harness that replays a canned Anthropic SSE stream against a locally running server.

**Spec:** `docs/superpowers/specs/2026-08-03-live-report-preview-design.md`

**Cautions for the implementer:**
- A second Claude session shares this working tree. Stage explicit paths only, and read the full staged diff before every commit. `tailwind.css` and `markets_api.json` may carry someone else's changes; only commit `tailwind.css` if the auto-regen hook changed it for THIS work and the diff shows only additions for the new classes.
- server.js edits need a server restart; index.html edits do not.
- No em dashes in any written output (devlog, comments, docs).

---

### Task 1: Server: enrich comp events and add the summary field event

**Files:**
- Modify: `server.js` (three spots: the extractor block near line 2749, the extractor wiring near line 2856, the delta loop near line 2945)

- [ ] **Step 1: Add `makeFieldExtractor` directly below `makeCompExtractor` (after its closing brace, ~line 2808)**

```js
// One-shot top-level string field extractor, same contract as the comp
// extractor above: watches the streamed text for `"<key>": "..."` and emits
// the decoded value once when its closing quote arrives. Purely additive,
// a bug can only cost a progress event, never the report. The key must be
// followed (whitespace aside) by ':' then '"' to count — the model prefaces
// the JSON with prose narration, and a bare mention of the key in prose
// must not trigger a garbage emit.
function makeFieldExtractor(key, onValue) {
  const needle = '"' + key + '"';
  let buf = "", mode = "seek", from = 0, valStart = -1, pos = 0, escaped = false;
  return {
    push(deltaText) {
      if (mode === "done" || typeof deltaText !== "string" || !deltaText) return;
      buf += deltaText;
      while (mode === "seek") {
        const keyAt = buf.indexOf(needle, from);
        if (keyAt === -1) {
          // Keep an overlap so the key can arrive split across two deltas.
          from = Math.max(from, buf.length - (needle.length - 1));
          return;
        }
        let i = keyAt + needle.length;
        while (i < buf.length && /\s/.test(buf[i])) i++;
        if (i >= buf.length) return;               // need more text to judge
        if (buf[i] !== ":") { from = keyAt + 1; continue; }
        i++;
        while (i < buf.length && /\s/.test(buf[i])) i++;
        if (i >= buf.length) return;
        if (buf[i] !== '"') { from = keyAt + 1; continue; }
        mode = "value";
        valStart = i + 1;
        pos = valStart;
      }
      for (; pos < buf.length; pos++) {
        const ch = buf[pos];
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') {
          mode = "done";
          let value = "";
          // JSON.parse decodes the escapes exactly the way the final report
          // parse will; a malformed slice just emits nothing.
          try { value = JSON.parse('"' + buf.slice(valStart, pos) + '"'); } catch (_) {}
          buf = "";
          if (value) onValue(value);
          return;
        }
      }
    },
  };
}
```

- [ ] **Step 2: Enrich the comp event payload and instantiate the summary extractor (in `callAnthropicOnce`, the `compExtractor` block at ~line 2856)**

Replace:

```js
  let compExtractor = (typeof onProgress === "function" && lane !== "records")
    ? makeCompExtractor((c, n) => say({
        phase: "comp", n,
        address: String((c && c.address) || ""),
        price: String((c && (c.price_or_rate || c.price_per_sqft)) || ""),
      }))
    : null;
```

with:

```js
  let compExtractor = (typeof onProgress === "function" && lane !== "records")
    ? makeCompExtractor((c, n) => say({
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
      }))
    : null;
  // The prompt orders "summary" before the comps array, so this lands in the
  // first seconds of the write phase. The records lane has no summary at all.
  let summaryExtractor = (typeof onProgress === "function" && lane !== "records")
    ? makeFieldExtractor("summary", (value) =>
        say({ phase: "field", key: "summary", value: stripEmDashes(value) }))
    : null;
```

- [ ] **Step 3: Feed the summary extractor in the delta loop (next to `compExtractor.push` at ~line 2945)**

Replace:

```js
            if (compExtractor) {
              try { compExtractor.push(d.text); } catch (_) { compExtractor = null; }
            }
```

with:

```js
            if (compExtractor) {
              try { compExtractor.push(d.text); } catch (_) { compExtractor = null; }
            }
            if (summaryExtractor) {
              try { summaryExtractor.push(d.text); } catch (_) { summaryExtractor = null; }
            }
```

- [ ] **Step 4: Confirm the gate needs no change**

Read the `guardComp` closure (~line 6315). It early-returns any event whose phase is not `"comp"`, so `field` events pass through untouched, and it forwards identified comp events as-is, so the enrichment flows automatically. Nothing to edit; this step is a check.

- [ ] **Step 5: Syntax check**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --check server.js
```

Expected: no output, exit 0.

---

### Task 2: Fetch-shim harness: prove the new events end-to-end at zero cost

**Files:**
- Create: `<scratchpad>/fake-anthropic.js` (session scratchpad, never committed)
- Create: `<scratchpad>/sse-client.js` (session scratchpad, never committed)

- [ ] **Step 1: Write the shim server wrapper**

`<scratchpad>/fake-anthropic.js` — overrides `global.fetch` BEFORE requiring server.js. Intercepts api.anthropic.com with a canned SSE stream (summary first, then 5 comps, matching real emission order) and blocks Supabase so nothing touches production data (file fallbacks engage instead).

```js
// Zero-cost harness: run server.js with a fake Anthropic that replays a
// canned SSE stream. Blocks Supabase so no production data is touched.
const realFetch = global.fetch;

const REPORT = {
  summary: "Industrial demand in Testville stays firm. Owners are seeing 6 to 8 percent annual gains, led by small bay product.",
  avg_price_per_sqft: "$142",
  currency: "USD",
  usd_rate: null,
  value_drivers: ["Port access", "Low vacancy"],
  market_trend: "rising",
  market_cap_rate_range: "5.5%-6.5%",
  comps: [1, 2, 3, 4, 5].map((i) => ({
    address: `${i}00 Test Industrial Way, Testville, TX`,
    date: `2026-0${i}-15`,
    transaction: "Sale",
    size_sqft: `${i}0,000`,
    price_or_rate: `$${i},${i}00,000`,
    price_per_sqft: "$140",
    source_type: "listing",
    source_url: "https://example.com/comp",
    notes: "Clean single tenant deal.",
  })),
  subject_size_sqft: "52,000",
  subject_size_source: "county assessor",
  subject_lat: "32.75",
  subject_lng: "-97.33",
};

function sseBody() {
  const text = "Here is the report.\n" + JSON.stringify(REPORT, null, 1);
  const frames = [];
  const push = (type, data) => frames.push(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  push("message_start", { type: "message_start", message: { usage: { input_tokens: 100 } } });
  push("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text" } });
  for (let i = 0; i < text.length; i += 80) {
    push("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 80) } });
  }
  push("content_block_stop", { type: "content_block_stop", index: 0 });
  push("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 900 } });
  push("message_stop", { type: "message_stop" });
  let n = 0;
  return new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => setTimeout(() => {
        if (n < frames.length) controller.enqueue(new TextEncoder().encode(frames[n++]));
        else controller.close();
        resolve();
      }, 120));   // ~120ms per frame: a fast-forward of the real write burst
    },
  });
}

global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    return new Response(sseBody(), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (u.includes(".supabase.co")) {
    return new Response("{}", { status: 500 });
  }
  return realFetch(url, opts);
};

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-shim-test";
require(String.raw`C:\Users\JacobAdler\OneDrive - Adler Realty\Documents\Market Comp puller web app\server.js`);
```

- [ ] **Step 2: Write the SSE client probe**

`<scratchpad>/sse-client.js` — POSTs a search with `stream: true` and prints every event. The address street number must change per run or the search cache serves plain JSON and no events flow.

```js
const addr = `${Date.now() % 100000} Test Industrial Way, Testville, TX`;
(async () => {
  const r = await fetch("http://localhost:3000/api/comps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: addr, type: "Industrial", stream: true }),
  });
  console.log("content-type:", r.headers.get("content-type"));
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      console.log(buf.slice(0, sep).replace(/\n/g, " | "));
      buf = buf.slice(sep + 2);
    }
  }
})();
```

- [ ] **Step 3: Run it**

Start the shim server in the background (kill any process already on port 3000 first), then:

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" sse-client.js
```

Expected output includes, in order:
- `event: progress | data: {"phase":"start",...}`
- a `{"phase":"field","key":"summary","value":"Industrial demand in Testville..."}` event BEFORE the first comp event
- five `{"phase":"comp",...}` events each carrying `size_sqft`, `date`, and `transaction`
- `event: result | data: {...}` whose `comps` match today's shape (proves the report itself is untouched)

- [ ] **Step 4: Commit the server half**

```powershell
git add server.js
git diff --cached -- server.js   # read it: only the three Task 1 edits
git commit -m "Stream the summary and richer comp fields as live progress events" -- server.js
```

---

### Task 3: Client: preview table, summary paragraph, geocode prefetch

**Files:**
- Modify: `index.html` (the `addLoadingCompLine` block at ~line 2280, `applyProgress` at ~line 2359, the `#loadingComps` div at ~line 964)

- [ ] **Step 1: Widen the preview box**

At ~line 964, change:

```html
        <div id="loadingComps" class="hidden w-full max-w-xs mt-4 text-left" aria-hidden="true"></div>
```

to (inline max-width dodges any Tailwind purge question):

```html
        <div id="loadingComps" class="hidden w-full mt-4 text-left" style="max-width:34rem" aria-hidden="true"></div>
```

- [ ] **Step 2: Replace the line renderer with the table + summary renderer**

Replace the whole `addLoadingCompLine` function (~lines 2280-2305) with:

```js
  function loadingCompTable(box) {
    let table = box.querySelector("table");
    if (!table) {
      table = document.createElement("table");
      table.className = "w-full text-sm";
      table.style.tableLayout = "fixed";
      const head = table.createTHead().insertRow();
      ["Address", "Price", "Size", "Date"].forEach((h, i) => {
        const th = document.createElement("th");
        th.textContent = h;
        th.className = "text-left font-medium text-slate-500 pb-1 pr-3 text-xs uppercase tracking-wide";
        if (i === 0) th.style.width = "45%";
        head.appendChild(th);
      });
      table.createTBody();
      // The lock line (if it ever arrives first) must stay below the table.
      box.insertBefore(table, box.querySelector("[data-locked]"));
    }
    return table;
  }
  function addLoadingCompLine(evt) {
    const box = document.getElementById("loadingComps");
    if (!box) return;
    if (evt.locked) {
      let lock = box.querySelector("[data-locked]");
      if (!lock) {
        lock = document.createElement("p");
        lock.dataset.locked = "1";
        lock.className = "text-sm text-slate-500 mt-2 truncate";
        box.appendChild(lock);
      }
      lock.textContent = `+ ${Math.max(1, Number(evt.n) - loadingCompsSeen)} more found · unlock with Pro`;
    } else {
      if (!evt.address) return;
      loadingCompsSeen++;
      const row = loadingCompTable(box).tBodies[0].insertRow();
      // Model-written text: textContent only, never innerHTML.
      [`${evt.n}. ${evt.address}`, evt.price || "", evt.size_sqft || "", evt.date || ""].forEach((v) => {
        const td = row.insertCell();
        td.textContent = v;
        td.className = "py-0.5 pr-3 text-slate-400 truncate align-top";
      });
      // Cache warmer: the same lookup renderResults' map will make, done now
      // during the wait so pins paint instantly. Failures are already
      // swallowed inside geocodeAddress.
      geocodeAddress(evt.address);
    }
    box.classList.remove("hidden");
  }
  function showLoadingSummary(text) {
    const box = document.getElementById("loadingComps");
    if (!box) return;
    let p = box.querySelector("[data-summary]");
    if (!p) {
      const label = document.createElement("p");
      label.className = "text-xs uppercase tracking-wide text-slate-500 mb-1";
      label.textContent = "Early market read";
      box.insertBefore(label, box.firstChild);
      p = document.createElement("p");
      p.dataset.summary = "1";
      p.className = "text-sm text-slate-600 mb-3";
      box.insertBefore(p, label.nextSibling);
    }
    // Model-written text: textContent only, never innerHTML.
    p.textContent = text;
    box.classList.remove("hidden");
  }
```

Note: `resetLoadingComps` already does `box.innerHTML = ""`, which clears summary, label, table, and lock line together; the `retry` phase already calls it. No change there.

- [ ] **Step 3: Route the `field` event in `applyProgress`**

After the `} else if (evt.phase === "comp") {` branch (~line 2386), add:

```js
    } else if (evt.phase === "field") {
      if (evt.key === "summary" && evt.value) showLoadingSummary(String(evt.value));
```

And extend the `lastPhase` guard at the end of `applyProgress` from:

```js
    if ((evt.phase !== "drafting" || evt.writing) && evt.phase !== "comp") ctx.lastPhase = evt.phase;
```

to:

```js
    if ((evt.phase !== "drafting" || evt.writing) && evt.phase !== "comp" && evt.phase !== "field") ctx.lastPhase = evt.phase;
```

- [ ] **Step 4: Update the stale comment**

The comment above `resetLoadingComps` (~line 2270) still describes "plain text rows... capped at the most recent 5". Rewrite it to describe the preview table + summary and that all rows are kept.

- [ ] **Step 5: Sanity-check hoisting**

`geocodeAddress` is declared at ~line 4157 in the same script scope as `addLoadingCompLine`; function declarations hoist, so the forward call is safe. Verify both are in the same `<script>` block (they are today; this step is a check).

---

### Task 4: Browser verification against the shim

- [ ] **Step 1: With the shim server still running, open the app in the preview browser** (`preview_start` on port 3000; create `.claude/launch.json` entry if missing, attaching to the running server via a url-only config).

- [ ] **Step 2: Run a search** (any new street number, type Industrial) and, during the ~15s simulated write, use `read_page` to confirm:
- the "Early market read" label and summary paragraph are present,
- the preview table has header Address/Price/Size/Date and rows filling in,
- after the final event, the normal full report replaced the card (loading card hidden, results section rendered).

Known quirk: the embedded pane cannot screenshot this app, so `read_page` text is the proof. Console must show no new errors (`read_console_messages`).

- [ ] **Step 3: Check the fallback layer still works**

Reload, run a second search with the shim stopped mid-stream (Ctrl+C the server after events start) and confirm the error card appears (the "connection dropped" path), not a hung card.

- [ ] **Step 4: Commit the client half + devlog**

Append to `devlog.json`:

```json
{ "date": "2026-08-03", "type": "feature", "title": "Live report preview while the search runs", "details": "The loading card now shows the market summary and a growing comp table (address, price, size, date) as the model writes the report, and pre-geocodes comp addresses so map pins appear instantly when the report lands. Preview shows only fields the final report will not correct: no $/SF, no provenance badges.", "commit": "" }
```

(Fill `commit` with the Task 2 short hash, or leave `""`.)

```powershell
git add index.html devlog.json
git diff --cached   # read it whole: other session shares this tree
git commit -m "Loading card renders a live report preview: summary, comp table, geocode warming" -- index.html devlog.json
```

If the tailwind auto-regen hook modified `tailwind.css` and the diff shows only additions for the new utility classes, include it in this commit; otherwise leave it out.

---

### Task 5: Real-search sanity check and deploy

- [ ] **Step 1: Kill the shim server, start the real one** (portable node path, real `.env`).

- [ ] **Step 2: Run one real billed search** (~$0.36) on a fresh address and watch the preview: summary should appear within ~10s of the write phase starting, comps stream at ~1/s, final report renders normally, map pins paint immediately.

- [ ] **Step 3: Deploy per the standing flow**: push `HEAD:main` (Render deploys from main), then verify on https://compninja.co without query strings.

---

## Self-review notes

- Spec coverage: enriched comp events (Task 1 Step 2), field event (Task 1 Steps 1-3), gate unchanged (Task 1 Step 4), preview table + summary + aria/textContent rules (Task 3), geocode prefetch (Task 3 Step 2), fallbacks untouched (verified Task 4 Step 3), harness verification (Task 2), devlog (Task 4 Step 4). No gaps.
- Type consistency: event shape `{ phase: "field", key, value }` matches between Task 1 Step 2 and Task 3 Step 3; comp extras `size_sqft`/`date`/`transaction` match between Task 1 Step 2 and Task 3 Step 2.
- The locked branch keeps `loadingCompsSeen` semantics identical to today's code.
