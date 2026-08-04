# Parse Rescue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a report's JSON fails to parse, salvage the first balanced object (free) or repair it with one small no-tools call (~$0.05/~40s), instead of silently re-running the full ~$0.35/~90s search.

**Architecture:** Layer A lives inside `parseCompJson`'s catch (server.js). Layer B wraps the finish chain at the end of `callAnthropicOnce` with a `repairCompJson` helper. `solo()`'s full retry stays untouched as the final net. Verified end-to-end with three canned fetch-shim scenarios selected by the searched address.

**Tech Stack:** Plain Node 18+, zero deps. No client changes.

**Spec:** `docs/superpowers/specs/2026-08-04-parse-rescue-design.md`

**Cautions:** shared working tree (stage explicit paths, read staged diffs); server.js needs restart; grep for anchors, line numbers drift; no em dashes in written output.

---

### Task 1: Layer A — salvage the first balanced object

**Files:**
- Modify: `server.js` (`parseCompJson` at ~line 2642, helper directly above it)

- [ ] **Step 1: Add the helper directly above `parseCompJson`**

```js
// The first balanced {...} in a text, found with the same string- and
// escape-aware walk the live-preview comp extractor uses — because the
// captured parse failure was a COMPLETE report followed by stray text
// containing a brace, which fools a first-{-to-last-} slice.
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
```

- [ ] **Step 2: Add the salvage to `parseCompJson`'s catch, BEFORE the diagnostic**

Replace the catch body's opening (keep the existing diagnostic + `throw err` after it):

```js
  } catch (err) {
    // Layer A rescue (2026-08-04): try the first BALANCED object before
    // giving up — the comps sanity check keeps a stray early object from
    // being mistaken for the report (both lanes always return comps).
    const inner = extractFirstJsonObject(text);
    if (inner && inner.length < text.length) {
      try {
        const salvaged = JSON.parse(inner);
        if (salvaged && Array.isArray(salvaged.comps)) {
          console.warn(`Comp JSON salvaged: first balanced object parsed, ${text.length - inner.length} trailing chars discarded`);
          return stripEmDashes(salvaged);
        }
      } catch (_) { /* fall through to the diagnostic + rethrow */ }
    }
    // Evidence for the recurring "unexpected format" flake ... (existing diagnostic unchanged)
```

- [ ] **Step 3: Syntax check** — `node --check server.js`, exit 0.

---

### Task 2: Layer B — the repair call

**Files:**
- Modify: `server.js` (new `repairCompJson` above `callAnthropicOnce`; finish chain at ~line 3320)

- [ ] **Step 1: Add `repairCompJson` directly above `callAnthropicOnce`**

```js
// One no-tools follow-up call that asks the model to re-emit a malformed
// report as valid JSON — rescuing the ~$0.35 search already paid for at the
// price of a small completion (~$0.05, ~40s) instead of solo()'s full
// ~$0.35/~90s re-search. Every failure path here surfaces to the caller,
// which falls back to that full retry, so this can only ever save.
async function repairCompJson(brokenText, maxTokens) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{
          role: "user",
          content: `The text below was supposed to be exactly one valid JSON object but fails to parse. Return ONLY the corrected JSON object. Preserve every field and every value exactly as written; fix only the syntax. Do not add, remove, reorder, or invent anything, and output nothing outside the object.\n\n${brokenText}`,
        }],
      }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`repair call HTTP ${r.status}`);
    const data = await r.json();
    return (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Wrap the finish chain at the end of `callAnthropicOnce`**

Replace:

```js
  const parsed = reconcilePricePerSqft(normalizeTrendPct(normalizeCurrency(normalizeSourceTypes(expandCompKeys(parseCompJson(text), type)))));
  return attachVerifiedAttribution(parsed, verifiedComps);
```

with:

```js
  const finishReport = (raw) =>
    attachVerifiedAttribution(
      reconcilePricePerSqft(normalizeTrendPct(normalizeCurrency(normalizeSourceTypes(expandCompKeys(parseCompJson(raw), type))))),
      verifiedComps);
  try {
    return finishReport(text);
  } catch (err) {
    // Layer B rescue (2026-08-04): one repair attempt before solo()'s full
    // re-search. Only for substantial text — a garbage response deserves
    // the full retry — and only for parse failures.
    if (!(err instanceof SyntaxError) || text.length <= 500) throw err;
    let repaired;
    try {
      repaired = await repairCompJson(text, body.max_tokens);
    } catch (repairErr) {
      console.warn("Comp JSON repair call failed; falling back to the full retry.", repairErr && repairErr.message);
      throw err;
    }
    const report = finishReport(repaired);   // still broken -> SyntaxError -> solo() retries as today
    console.warn("Comp JSON repaired by follow-up call.");
    return report;
  }
```

- [ ] **Step 3: Syntax check** — `node --check server.js`, exit 0.

---

### Task 3: Shim verification — three scenarios, zero cost

**Files:**
- Modify: `<scratchpad>/fake-anthropic.js` (scenario by searched address; tool-less requests get corrected JSON)
- Modify: `<scratchpad>/sse-client.js` (address from argv)

- [ ] **Step 1: Rework the shim's fetch handler**

Replace the `global.fetch` assignment and `sseBody()` plumbing so the streamed text depends on the address found in the request body, and a request WITHOUT `"tools"` (the repair call) gets a plain JSON response with the corrected report:

```js
const GOOD = "Here is the report.\n" + JSON.stringify(REPORT, null, 1);
const scenarios = {
  Junkville: GOOD + "\n\nNote: search metadata {cached: false}",   // trailing junk WITH a brace
  Brokenton: GOOD.replace('"transaction": "Sale",', '"transaction": "Sale"'),  // comma removed: broken mid-JSON
};
function textFor(reqBody) {
  for (const [town, text] of Object.entries(scenarios)) {
    if (reqBody.includes(town)) return text;
  }
  return GOOD;
}

global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    const reqBody = String((opts && opts.body) || "");
    if (!reqBody.includes('"tools"')) {
      // The repair call: no web-search tools. Return the corrected report.
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(REPORT, null, 1) }], usage: {} }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(sseBody(textFor(reqBody)), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (u.includes(".supabase.co")) return new Response("{}", { status: 500 });
  return realFetch(url, opts);
};
```

(`sseBody` takes the text as a parameter now instead of building it inline.)

- [ ] **Step 2: Parameterize the probe address**

In `sse-client.js`: `const addr = `${Date.now() % 100000} ${process.argv[2] || "Test"} Industrial Way, ${process.argv[2] || "Testville"}, TX`;` — passing `Junkville` or `Brokenton` selects the scenario.

- [ ] **Step 3: Run all three probes** (re-add the `shim` launch.json entry, `preview_start`, then):

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" sse-client.js Junkville
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" sse-client.js Brokenton
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" sse-client.js
```

Expected, per probe:
- Junkville: `result` event arrives, NO `retry` progress event; server log shows `Comp JSON salvaged: ... trailing chars discarded`.
- Brokenton: `result` event arrives, NO `retry` event; server log shows `Comp JSON repaired by follow-up call.`
- plain: `result` event, no salvage/repair/retry lines (healthy path byte-identical).

Then `preview_stop`, remove the shim launch entry, strip Testville/Junkville/Brokenton rows from `search-cache.json` and `comp-corpus.jsonl`.

---

### Task 4: Docs, devlog, ship

- [ ] **Step 1: CLAUDE.md** — in the "Web-search response parsing" flow note, after the sentence about `parseCompJson` stripping fences, add: "Since 2026-08-04 a failed parse is rescued in layers before the full retry: first the first BALANCED object is salvaged (the observed failure is a complete report plus trailing junk), then one no-tools repair call re-emits the JSON; `solo()`'s full re-search only runs if both fail."

- [ ] **Step 2: devlog.json entry** (top):

```json
{ "date": "2026-08-04", "type": "fix", "title": "A garbled report gets rescued instead of re-searched", "details": "When the model's report failed to parse, the server used to throw the whole attempt away and silently re-run the entire search: another 90 seconds and another billed call, which is how a 90-second search became the 3-minute-40 wait measured on a real test, and how one Phoenix search burned two full attempts and still showed an error. Now a failed parse is rescued in two steps before any re-search: the server first extracts the report itself from around any stray text the model tacked on (the one failure captured byte-for-byte was exactly that, a complete valid report with junk after it), free and instant; failing that, one small no-search follow-up call asks the model to re-emit the same JSON corrected, at about a seventh of the cost and half the wait of a full retry. The full retry still exists as the last resort, every rescue is logged so the live logs show which layer fires and how often, and the streamed preview from the first attempt stays on screen through a rescue since its comps were real.", "commit": "" }
```

- [ ] **Step 3: Commit, merge origin/main if moved, push, health-check**

```powershell
git add server.js CLAUDE.md devlog.json
git diff --cached
git commit -m "Rescue a malformed report (salvage, then repair call) before re-searching" -- server.js CLAUDE.md devlog.json
git push origin HEAD:main
```

Background: `sleep 150 && curl -s -o /dev/null -w "healthz HTTP %{http_code}\n" https://compninja.co/healthz`.

---

## Self-review notes

- Spec coverage: Layer A (T1), sanity comps check (T1S2), Layer B + guards + same finish chain (T2), solo() untouched (no task touches it), logging all layers (T1S2/T2S2 + existing diagnostic), three shim scenarios (T3), docs/devlog (T4). No gaps.
- Type consistency: `extractFirstJsonObject(text)` returns string|null, consumed in T1S2; `repairCompJson(brokenText, maxTokens)` returns string, consumed in T2S2 with `body.max_tokens` in scope at that call site.
- The healthy-path probe guards against a regression in the common case.
