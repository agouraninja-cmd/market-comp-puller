# Multi-provider comp search, phases 1 and 2, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Anthropic search call behind a provider interface with zero behavior change, then add Gemini 3.6 Flash as a second provider so real searches can run through the full product pipeline and be measured.

**Architecture:** One pure module per provider exporting request building, response parsing, usage normalization and cost math. `server.js` keeps every piece of I/O it already owns (fetch, abort timer, SSE loop, retry ladder). A capability descriptor lets `server.js` branch on what a provider can do rather than on its name.

**Tech Stack:** Plain Node (no dependencies, `node --test`), CommonJS modules, existing `test/*.test.js` layout.

**Spec:** `docs/superpowers/specs/2026-08-10-multi-provider-search-design.md`

## Global Constraints

- Zero npm dependencies. Node 18+ built-ins only.
- CommonJS (`require` / `module.exports`), matching every other module in the repo.
- Provider modules are **pure**: no `fetch`, no timers, no `process.env` reads, no clock reads. `server.js` owns all I/O.
- `server.js` must branch on `provider.capabilities.*`, **never** on `provider.name`.
- Tests run with no API key and no network. Fixtures are committed.
- Editing `server.js` requires restarting the process; editing `index.html` does not.
- Run `npm test` before every commit. It must stay green.
- Another Claude session shares this checkout. **Stage explicit paths, never `git add -A`.**
- No em dashes in any documentation written by this plan.
- Phases 3 to 5 (cost accounting, streaming parity, fallback) are out of scope and get their own plan after the phase 2 gate.

---

## File Structure

**Create:**
- `search-provider-anthropic.js`: Anthropic request/parse/usage/cost, pure
- `search-provider-gemini.js`: Gemini equivalent, pure
- `test/search-provider-anthropic.test.js`
- `test/search-provider-gemini.test.js`
- `test/fixtures/anthropic-response.json`: recorded non-streaming response
- `test/fixtures/gemini-response.json`: recorded Interactions API response
- `docs/evals/2026-08-10-gemini-pipeline-validation.md`: phase 2 findings

**Modify:**
- `server.js`: provider registry, `SEARCH_PROVIDER` flag, capability branching inside `callAnthropicOnce`
- `test/routes.test.js`: wiring proof that the flag reaches the request
- `CLAUDE.md`: document `SEARCH_PROVIDER` alongside the other env vars

---

## Task 1: Anthropic provider module

**Files:**
- Create: `search-provider-anthropic.js`
- Create: `test/search-provider-anthropic.test.js`
- Create: `test/fixtures/anthropic-response.json`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a module exporting `name`, `defaultModel`, `logLabel`, `capabilities`,
  `buildRequestBody({model, prompt, maxComps, searchUses, stream})`,
  `requestInit({apiKey})`, `parseResponse(data)`, `normalizeUsage(raw)`, `costOf(usage)`.
  Normalized usage shape is `{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens}`.

- [ ] **Step 1: Record the fixture**

Create `test/fixtures/anthropic-response.json`. This is the shape `server.js:3963` already parses (a web-search response mixes block types; only `text` blocks are kept):

```json
{
  "id": "msg_fixture",
  "stop_reason": "end_turn",
  "content": [
    { "type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": { "query": "industrial sales Dallas TX" } },
    { "type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": [{ "type": "web_search_result", "url": "https://example.com/a" }] },
    { "type": "text", "text": "Here is the report." },
    { "type": "text", "text": "{\"comps\":[]}" }
  ],
  "usage": {
    "input_tokens": 3300,
    "output_tokens": 4100,
    "cache_read_input_tokens": 26400,
    "cache_creation_input_tokens": 3300
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/search-provider-anthropic.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const P = require("../search-provider-anthropic");
const FIXTURE = require("./fixtures/anthropic-response.json");

test("declares the capabilities server.js branches on", () => {
  assert.equal(P.name, "anthropic");
  assert.equal(P.capabilities.searchBudget, true);
  assert.equal(P.capabilities.streaming, true);
  assert.equal(P.capabilities.promptCaching, "explicit");
});

test("buildRequestBody keeps the cache_control breakpoint and the search budget", () => {
  const body = P.buildRequestBody({
    model: "claude-sonnet-4-6", prompt: "PROMPT", maxComps: 12, searchUses: 10, stream: true,
  });
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.max_tokens, 10000);
  assert.equal(body.stream, true);
  assert.deepEqual(body.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }]);
  const block = body.messages[0].content[0];
  assert.equal(block.text, "PROMPT");
  assert.deepEqual(block.cache_control, { type: "ephemeral" });
});

test("buildRequestBody drops max_tokens to 8000 at or below 8 comps", () => {
  const body = P.buildRequestBody({ model: "m", prompt: "p", maxComps: 8, searchUses: 6, stream: false });
  assert.equal(body.max_tokens, 8000);
  assert.equal("stream" in body, false, "stream must be absent, not false, when not streaming");
});

test("parseResponse keeps only text blocks, joined with newline and trimmed", () => {
  const out = P.parseResponse(FIXTURE);
  assert.equal(out.text, "Here is the report.\n{\"comps\":[]}");
  assert.equal(out.searches, 1);
  assert.equal(out.stopReason, "end_turn");
});

test("normalizeUsage maps Anthropic's four token fields", () => {
  const u = P.normalizeUsage(FIXTURE.usage);
  assert.deepEqual(u, {
    input_tokens: 3300, output_tokens: 4100,
    cache_read_tokens: 26400, cache_write_tokens: 3300,
  });
});

test("normalizeUsage is total about missing fields rather than returning undefined", () => {
  assert.deepEqual(P.normalizeUsage(undefined), {
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
  });
});

test("costOf prices cache reads far below fresh input", () => {
  const cheap = P.costOf({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 1e6, cache_write_tokens: 0 });
  const dear = P.costOf({ input_tokens: 1e6, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  assert.ok(cheap < dear / 5, `cache read ${cheap} should be far under input ${dear}`);
  assert.ok(Math.abs(P.costOf({ input_tokens: 0, output_tokens: 1e6, cache_read_tokens: 0, cache_write_tokens: 0 }) - 15) < 0.001);
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../search-provider-anthropic'`

- [ ] **Step 4: Write the module**

Create `search-provider-anthropic.js`:

```js
"use strict";

// Anthropic half of the provider seam. PURE on purpose: no fetch, no timers,
// no env reads. server.js owns every piece of I/O, exactly the way
// entitlements.js holds the rules while server.js owns the reads.
//
// Prices are per million tokens, list rates for claude-sonnet-4-6.
const USD_PER_MTOK = { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 };

const capabilities = {
  // web_search takes max_uses, which is what lets searchBudgetFor turn a
  // strong corpus into a smaller bill. A provider without this cannot.
  searchBudget: true,
  streaming: true,
  // cache_control is an explicit breakpoint we place ourselves.
  promptCaching: "explicit",
};

function buildRequestBody({ model, prompt, maxComps, searchUses, stream }) {
  const body = {
    model,
    // A 10-12 comp report is a third longer than the 8-comp JSON this was
    // sized for. Billing is by tokens actually generated, so headroom is free
    // and is what keeps the notes cap a QUALITY instruction rather than a hard
    // truncation that severs the JSON mid-array.
    max_tokens: maxComps > 8 ? 10000 : 8000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: searchUses }],
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: prompt,
        // The web_search loop re-runs inference on EVERY round and re-reads
        // this whole prompt at full input price each time. cache_control makes
        // rounds 2..N read it at ~0.1x. It relies on a PREFIX match, so the
        // prompt must stay byte-identical across a request's rounds.
        cache_control: { type: "ephemeral" },
      }],
    }],
  };
  // Absent, not false: the previous code only ever set this key when
  // streaming, and an explicit false would be a wire-level change.
  if (stream) body.stream = true;
  return body;
}

function requestInit({ apiKey }) {
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  };
}

// Non-streaming branch only. The streaming branch stays in server.js for now;
// moving it is phase 4's streaming-parity work.
function parseResponse(data) {
  const content = (data && data.content) || [];
  return {
    // Web search responses mix block types. Keep ONLY text, joined with "\n"
    // and trimmed, because that is exactly what parseCompJson expects.
    text: content.filter((b) => b && b.type === "text").map((b) => b.text).join("\n").trim(),
    searches: content.filter((b) => b && b.type === "server_tool_use").length,
    stopReason: (data && data.stop_reason) || "",
    usage: normalizeUsage(data && data.usage),
  };
}

function normalizeUsage(raw) {
  const u = raw || {};
  const n = (v) => Number(v) || 0;
  return {
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_read_tokens: n(u.cache_read_input_tokens),
    cache_write_tokens: n(u.cache_creation_input_tokens),
  };
}

function costOf(usage) {
  const u = usage || {};
  const n = (v) => Number(v) || 0;
  return (
    n(u.input_tokens) * USD_PER_MTOK.input +
    n(u.output_tokens) * USD_PER_MTOK.output +
    n(u.cache_read_tokens) * USD_PER_MTOK.cacheRead +
    n(u.cache_write_tokens) * USD_PER_MTOK.cacheWrite
  ) / 1e6;
}

module.exports = {
  name: "anthropic",
  logLabel: "Anthropic",
  defaultModel: "claude-sonnet-4-6",
  capabilities,
  buildRequestBody,
  requestInit,
  parseResponse,
  normalizeUsage,
  costOf,
  USD_PER_MTOK,
};
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, and every pre-existing test still green.

- [ ] **Step 6: Commit**

```bash
git add search-provider-anthropic.js test/search-provider-anthropic.test.js test/fixtures/anthropic-response.json
git commit -m "Add pure Anthropic search-provider module (not yet wired)"
```

---

## Task 2: Wire server.js to the Anthropic module, zero behavior change

**Files:**
- Modify: `server.js` (the `MODEL` constant near line 135; `callAnthropicOnce` at 3817-3874, 3933-3972, 4074-4075)

**Interfaces:**
- Consumes: Task 1's module.
- Produces: a module-level `PROVIDER` binding and a `usageOf` normalized-usage variable that Task 4 reuses.

**This task must not change a single byte of report output.** It is the only task whose correctness is independently checkable, which is why it is separate from Task 4.

- [ ] **Step 1: Require the module and derive MODEL from it**

In `server.js`, near the existing `MODEL` constant:

```js
const PROVIDER = require("./search-provider-anthropic");
// MODEL still overrides, so an existing MODEL=... deployment is unaffected.
const MODEL = (process.env.MODEL || PROVIDER.defaultModel).trim();
```

Delete the old hardcoded `"claude-sonnet-4-6"` default from that line.

- [ ] **Step 2: Replace the inline body literal**

In `callAnthropicOnce`, replace the whole `const body = { ... }` literal (server.js:3821-3874) plus the `if (STREAM_ANTHROPIC) body.stream = true;` line with:

```js
  const body = PROVIDER.buildRequestBody({
    model: MODEL,
    prompt: buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps,
                        subjectSizeSqft, corpus && corpus.comps, corpus && corpus.nearby,
                        subjectDetails, lane),
    maxComps,
    searchUses,
    stream: STREAM_ANTHROPIC,
  });
```

- [ ] **Step 3: Replace the fetch URL and headers**

Replace the `fetch("https://api.anthropic.com/v1/messages", {...})` call (server.js:3933) with:

```js
    const init = PROVIDER.requestInit({ apiKey: API_KEY });
    r = await fetch(init.url, {
      method: "POST",
      headers: init.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
```

- [ ] **Step 4: Route the non-streaming branch through parseResponse**

Replace the body of the `if (!STREAM_ANTHROPIC) { ... }` branch (server.js:3961-3972) with:

```js
  if (!STREAM_ANTHROPIC) {
    clearTimeout(timer);
    const parsed = PROVIDER.parseResponse(await r.json());
    text = parsed.text;
    searches = parsed.searches;
    usage = parsed.usage;
    stopReason = parsed.stopReason;
  } else {
```

- [ ] **Step 5: Normalize usage in the streaming branch too**

The streaming branch assigns raw Anthropic usage in two places. Change `usage = (ev.message && ev.message.usage) || {};` to:

```js
          usage = PROVIDER.normalizeUsage(ev.message && ev.message.usage);
```

and change `if (ev.usage) usage = { ...usage, ...ev.usage };` to:

```js
          if (ev.usage) usage = { ...usage, ...PROVIDER.normalizeUsage(ev.usage) };
```

Note `message_delta` carries only `output_tokens`, so normalizing it zeroes the other three. Spreading over the existing object is what preserves the input and cache counts from `message_start`, which is why the spread stays.

- [ ] **Step 6: Update the log line to the normalized field names**

Replace the `console.log` at server.js:4074 and the `stats` line under it with:

```js
  console.log(`${PROVIDER.logLabel} call [${lane}]: ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${searches} search(es) · ${usage.output_tokens || 0} out / ${usage.input_tokens || 0} in tokens · cache ${usage.cache_read_tokens || 0} read / ${usage.cache_write_tokens || 0} write · stop=${stopReason}`);
  if (stats) { stats.searches = searches; stats.out_tokens = usage.output_tokens || 0; }
```

The rendered text is byte-identical for Anthropic, because the normalized values equal the raw ones. Only the field names it reads changed.

- [ ] **Step 7: Verify the suite is still green**

Run: `npm test`
Expected: PASS. No test should need editing. If one does, the refactor changed behavior and must be corrected rather than the test.

- [ ] **Step 8: Verify a real report is unchanged**

Start the server, run one search, and confirm the log line renders in the old format with non-zero cache numbers:

```bash
node server.js
```

Then in a second shell:

```bash
curl -s -X POST http://localhost:3000/api/comps -H 'content-type: application/json' -d '{"address":"1200 W Industrial Blvd, Dallas, TX","type":"Industrial","months":24,"maxComps":12}' > /tmp/after.json
```

Expected: the server log shows `Anthropic call [solo]: ...s · N search(es) · N out / N in tokens · cache N read / N write · stop=end_turn`, with cache read well above zero. A run logging `cache 0 read / 0 write` means the `cache_control` breakpoint was lost and Step 2 is wrong.

- [ ] **Step 9: Commit**

```bash
git add server.js
git commit -m "Wire Anthropic search through the provider module, no behavior change"
```

---

## Task 3: Gemini provider module

**Files:**
- Create: `search-provider-gemini.js`
- Create: `test/search-provider-gemini.test.js`
- Create: `test/fixtures/gemini-response.json`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime, but must export the identical surface so `server.js` can hold either.
- Produces: the same nine exports as Task 1.

- [ ] **Step 1: Record the fixture**

Create `test/fixtures/gemini-response.json`. This is the verified live shape of the Interactions API. Note `content` is an **array** of blocks, and `thought` steps carry only an opaque signature:

```json
{
  "id": "v1_fixture",
  "status": "completed",
  "object": "interaction",
  "model": "gemini-3.6-flash",
  "usage": {
    "total_tokens": 11608,
    "total_input_tokens": 4207,
    "total_output_tokens": 928,
    "total_thought_tokens": 6473,
    "total_cached_tokens": 1251
  },
  "steps": [
    { "type": "thought", "signature": "EvYCCvMCARFNMg9SjPBY6ueuuk2S3tgw" },
    { "type": "model_output", "content": [{ "type": "text", "text": "Here is the report." }] },
    { "type": "model_output", "content": [{ "type": "text", "text": "{\"comps\":[]}" }] }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `test/search-provider-gemini.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const P = require("../search-provider-gemini");
const A = require("../search-provider-anthropic");
const FIXTURE = require("./fixtures/gemini-response.json");

test("declares that it cannot cap the search budget", () => {
  assert.equal(P.name, "gemini");
  assert.equal(P.capabilities.searchBudget, false,
    "google_search takes no max_uses; server.js must branch on this");
  assert.equal(P.capabilities.streaming, false, "phase 2 is non-streaming");
  assert.equal(P.capabilities.promptCaching, "implicit");
});

test("exports the same surface as the Anthropic module", () => {
  for (const k of ["name", "logLabel", "defaultModel", "capabilities", "buildRequestBody",
                   "requestInit", "parseResponse", "normalizeUsage", "costOf"]) {
    assert.ok(k in P, `missing export: ${k}`);
    assert.equal(typeof P[k], typeof A[k], `export ${k} differs in type from anthropic`);
  }
});

test("buildRequestBody sends google_search and never sends max_uses", () => {
  const body = P.buildRequestBody({
    model: "gemini-3.6-flash", prompt: "PROMPT", maxComps: 12, searchUses: 10, stream: false,
  });
  assert.equal(body.model, "gemini-3.6-flash");
  assert.equal(body.input, "PROMPT");
  assert.deepEqual(body.tools, [{ type: "google_search" }]);
  assert.equal(JSON.stringify(body).includes("max_uses"), false,
    "google_search rejects max_uses; sending it would be a silent lie about the budget");
});

test("parseResponse collects text across every model_output step and skips thoughts", () => {
  const out = P.parseResponse(FIXTURE);
  assert.equal(out.text, "Here is the report.\n{\"comps\":[]}");
  assert.equal(out.stopReason, "completed");
});

test("parseResponse tolerates content being an array, which is the shape that broke the first harness", () => {
  const out = P.parseResponse({
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }],
  });
  assert.equal(out.text, "ab");
});

test("normalizeUsage folds thought tokens into output, because Gemini bills them as output", () => {
  const u = P.normalizeUsage(FIXTURE.usage);
  assert.equal(u.input_tokens, 4207);
  assert.equal(u.output_tokens, 928 + 6473, "thought tokens are billed as output");
  assert.equal(u.cache_read_tokens, 1251);
  assert.equal(u.cache_write_tokens, 0, "no explicit cache writes on Gemini");
});

test("costOf reproduces the measured per-report figure within a cent", () => {
  const cost = P.costOf(P.normalizeUsage(FIXTURE.usage));
  assert.ok(Math.abs(cost - 0.0618) < 0.01, `expected about $0.0618, got $${cost.toFixed(4)}`);
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '../search-provider-gemini'`

- [ ] **Step 4: Write the module**

Create `search-provider-gemini.js`:

```js
"use strict";

// Gemini half of the provider seam. Same pure contract as
// search-provider-anthropic.js: no fetch, no timers, no env reads.
//
// Prices are per million tokens for gemini-3.6-flash. Google Search grounding
// is billed per query ($14/1,000) with 5,000 free per month across the Gemini
// 3 family, so at this volume grounding is free and is deliberately not
// modelled here. Revisit if report volume ever approaches that ceiling.
const USD_PER_MTOK = { input: 1.50, output: 7.50, cacheRead: 0.375, cacheWrite: 0 };

const capabilities = {
  // google_search accepts NO max_uses. searchBudgetFor's 10-to-3 cut cannot be
  // applied, so a strong corpus still improves quality here but no longer
  // reduces spend. server.js must read this rather than assume a budget.
  searchBudget: false,
  // Phase 2 is non-streaming on purpose: it gets the validation signal without
  // waiting on the Interactions API streaming format, which is unverified.
  streaming: false,
  // Gemini caches implicitly and reports total_cached_tokens, but exposes no
  // breakpoint to place, so there is nothing for us to control.
  promptCaching: "implicit",
};

function buildRequestBody({ model, prompt, maxComps }) {
  return {
    model,
    input: prompt,
    tools: [{ type: "google_search" }],
    // Thought tokens count toward output on Gemini and this prompt asks for a
    // large JSON array, so the ceiling has to cover reasoning AND the report.
    // A measured eval call spent 6,473 thought against 928 output, so the
    // Anthropic-sized 10,000 would truncate mid-array: the exact failure that
    // nearly faked a much worse Sonnet 5 result.
    max_output_tokens: maxComps > 8 ? 32000 : 24000,
  };
}

function requestInit({ apiKey }) {
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/interactions",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
  };
}

// VERIFIED against live calls 2026-08-10. Response shape:
//   { steps: [ {type:"thought", signature}, {type:"model_output", content:[{type:"text", text}]} ] }
// `content` is an ARRAY of blocks, not an object. Assuming otherwise is what
// made the first scratch harness fail with "unrecognized response shape".
// There can be more than one model_output step, so collect across all of them.
function parseResponse(data) {
  const steps = (data && Array.isArray(data.steps)) ? data.steps : [];
  const text = steps
    .filter((s) => s && s.type === "model_output" && Array.isArray(s.content))
    .flatMap((s) => s.content)
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
  return {
    text: text.trim(),
    // Grounding query counts are not reported per call. Zero is honest here;
    // inventing a number would corrupt the searches figure in the log and in
    // the analytics event.
    searches: 0,
    stopReason: (data && data.status) || "",
    usage: normalizeUsage(data && data.usage),
  };
}

function normalizeUsage(raw) {
  const u = raw || {};
  const n = (v) => Number(v) || 0;
  return {
    input_tokens: n(u.total_input_tokens),
    // Thought tokens are billed at the output rate, so folding them in here is
    // what makes costOf correct and makes the log line comparable across
    // providers.
    output_tokens: n(u.total_output_tokens) + n(u.total_thought_tokens),
    cache_read_tokens: n(u.total_cached_tokens),
    cache_write_tokens: 0,
  };
}

function costOf(usage) {
  const u = usage || {};
  const n = (v) => Number(v) || 0;
  return (
    n(u.input_tokens) * USD_PER_MTOK.input +
    n(u.output_tokens) * USD_PER_MTOK.output +
    n(u.cache_read_tokens) * USD_PER_MTOK.cacheRead
  ) / 1e6;
}

module.exports = {
  name: "gemini",
  logLabel: "Gemini",
  defaultModel: "gemini-3.6-flash",
  capabilities,
  buildRequestBody,
  requestInit,
  parseResponse,
  normalizeUsage,
  costOf,
  USD_PER_MTOK,
};
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add search-provider-gemini.js test/search-provider-gemini.test.js test/fixtures/gemini-response.json
git commit -m "Add pure Gemini search-provider module (not yet wired)"
```

---

## Task 4: Provider registry, SEARCH_PROVIDER flag, capability branching

**Files:**
- Modify: `server.js` (the `PROVIDER` binding from Task 2; `callAnthropicOnce`'s deadline and API-key selection)
- Modify: `CLAUDE.md` (document the new env var)

**Interfaces:**
- Consumes: Task 1 and Task 3 modules, both satisfying the same nine-export contract.
- Produces: `SEARCH_PROVIDER` env var; `PROVIDER` now resolved from a registry.

- [ ] **Step 1: Replace the fixed require with a registry**

Replace Task 2's `const PROVIDER = require("./search-provider-anthropic");` with:

```js
const SEARCH_PROVIDERS = {
  anthropic: require("./search-provider-anthropic"),
  gemini: require("./search-provider-gemini"),
};
// Explicit map with NO fallthrough: an unrecognized value must fail loudly at
// boot rather than silently serve a provider nobody chose. Same rule the
// /api/checkout PLANS table follows, and for the same reason.
const SEARCH_PROVIDER_NAME = (process.env.SEARCH_PROVIDER || "anthropic").trim().toLowerCase();
const PROVIDER = SEARCH_PROVIDERS[SEARCH_PROVIDER_NAME];
if (!PROVIDER) {
  console.error(`⛔ SEARCH_PROVIDER="${SEARCH_PROVIDER_NAME}" is not one of: ${Object.keys(SEARCH_PROVIDERS).join(", ")}`);
  process.exit(1);
}
const MODEL = (process.env.MODEL || PROVIDER.defaultModel).trim();
```

- [ ] **Step 2: Select the API key by provider capability, not by name**

`API_KEY` is currently the Anthropic key. Add, next to it:

```js
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
// Each provider authenticates with its own key. Reading this off the provider
// object keeps the choice in one place.
const providerApiKey = () => (PROVIDER.name === "gemini" ? GEMINI_API_KEY : API_KEY);
```

Then change Task 2's `PROVIDER.requestInit({ apiKey: API_KEY })` to `PROVIDER.requestInit({ apiKey: providerApiKey() })`.

This is the one place a provider name is legitimately read, because it is choosing a credential rather than a behavior. Everything else must branch on `capabilities`.

- [ ] **Step 3: Branch the deadline on the capability**

`searchTimeoutMsFor(searchUses, ...)` derives the call deadline from a search budget that a no-budget provider never applied. Replace the `callDeadlineMs` line:

```js
  // A provider that cannot cap search rounds never honored searchUses, so a
  // deadline derived from it would be arbitrary. Budget the worst case (a full
  // 10-search run) instead of a number that was silently ignored.
  const deadlineUses = PROVIDER.capabilities.searchBudget ? searchUses : 10;
  const callDeadlineMs = searchTimeoutMsFor(deadlineUses, body.max_tokens);
```

- [ ] **Step 4: Force the non-streaming path for providers that cannot stream**

`STREAM_ANTHROPIC` is read in two places (building the body, choosing the branch). Introduce one derived value just above the body build and use it in both:

```js
  const useStream = STREAM_ANTHROPIC && PROVIDER.capabilities.streaming;
```

Pass `stream: useStream` into `buildRequestBody`, and change the `if (!STREAM_ANTHROPIC)` branch test to `if (!useStream)`.

- [ ] **Step 5: Announce the provider at boot**

Next to the existing `🤖 Model overridden by MODEL:` banner, add:

```js
console.log(`🔀 Search provider: ${PROVIDER.name} (model ${MODEL}${PROVIDER.capabilities.searchBudget ? "" : ", no search-budget cap"})`);
```

- [ ] **Step 5b: Report the provider on /healthz**

The boot banner alone is untestable: `test/helpers/boot.js` spawns the child with
`stdio: "ignore"`, so no suite can read the child's stdout. Task 5 needs an
observable surface, and `/healthz` is the ops-status endpoint that already
reports `hasKey` and `boot_id`.

In the `/healthz` handler (server.js:13513), add two fields to the JSON body
alongside the existing `ok` and `hasKey`:

```js
      provider: PROVIDER.name,
      search_budget: PROVIDER.capabilities.searchBudget,
```

`search_budget` is read straight off the capability object, so a `server.js`
that stopped consulting capabilities would report the wrong value here and fail
Task 5. That is the whole point of exposing it.

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS. Default behavior is unchanged because `SEARCH_PROVIDER` is unset.

- [ ] **Step 7: Prove the Gemini path boots and refuses a bad value**

```bash
SEARCH_PROVIDER=gemini GEMINI_API_KEY=x node -e "require('./server.js')" 2>&1 | head -3
SEARCH_PROVIDER=nope node -e "require('./server.js')" 2>&1 | head -2
```

Expected: the first prints `🔀 Search provider: gemini (model gemini-3.6-flash, no search-budget cap)`. The second prints the `⛔` line and exits non-zero.

- [ ] **Step 8: Document the env var in CLAUDE.md**

Add to the configuration list, in the same voice as the surrounding entries:

```markdown
- `SEARCH_PROVIDER`: optional `anthropic` (default) or `gemini`. Picks which
  vendor runs the comp search. An unrecognized value **exits at boot** rather
  than silently falling back, the same no-fallthrough rule `/api/checkout`'s
  `PLANS` map follows. `MODEL` still overrides the chosen provider's default
  model, so existing `MODEL=` deployments are unaffected. Gemini authenticates
  with `GEMINI_API_KEY` and needs a **paid-tier** Google project: search
  grounding 429s on the free tier, and the error names no project. Gemini
  cannot cap its search rounds (`google_search` takes no `max_uses`), so
  corpus-first retrieval remains a quality lever there but stops being a cost
  lever. Server code must branch on `PROVIDER.capabilities.*`, never on
  `PROVIDER.name`.
```

- [ ] **Step 9: Commit**

```bash
git add server.js CLAUDE.md
git commit -m "Add SEARCH_PROVIDER registry with capability-based branching"
```

---

## Task 5: Wiring test

**Files:**
- Modify: `test/routes.test.js`

**Interfaces:**
- Consumes: Task 4's `SEARCH_PROVIDER` handling.
- Produces: nothing consumed downstream.

`test/routes.test.js` exists specifically because a rule can be correct in its module and never actually wired to a route. The capability descriptor has exactly that hazard: right in `search-provider-gemini.js`, ignored by `server.js`, and every unit test still green.

- [ ] **Step 1: Write the failing test**

Append to `test/routes.test.js`. Use that file's own `boot(env)` wrapper, which
delegates to `test/helpers/boot.js`. That helper returns `{ base, stop }` and
**throws** `"server exited early"` when the child exits before answering
`/healthz`, which is exactly what the bad-value case needs. Do not read stdout:
the helper spawns with `stdio: "ignore"`.

```js
test("SEARCH_PROVIDER wiring", async (t) => {
  await t.test("gemini boots and reports it cannot cap the search budget", async () => {
    const srv = await boot({ SEARCH_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
    try {
      const body = await (await fetch(srv.base + "/healthz")).json();
      assert.equal(body.provider, "gemini");
      // Read off PROVIDER.capabilities, so a server.js that stopped consulting
      // the descriptor reports the wrong value and fails here.
      assert.equal(body.search_budget, false);
    } finally { srv.stop(); }
  });

  await t.test("the default is anthropic, with a search budget", async () => {
    const srv = await boot({});
    try {
      const body = await (await fetch(srv.base + "/healthz")).json();
      assert.equal(body.provider, "anthropic");
      assert.equal(body.search_budget, true);
    } finally { srv.stop(); }
  });

  await t.test("an unrecognized SEARCH_PROVIDER refuses to boot", async () => {
    // boot() throws "server exited early" when the child exits before /healthz.
    // A silent fallback to anthropic would boot healthy and fail this test.
    await assert.rejects(
      () => boot({ SEARCH_PROVIDER: "bogus" }),
      /exited early/,
      "must exit rather than silently pick a provider",
    );
  });
});
```

Note the third case costs a full 6-second boot timeout only if the server
wrongly stays up; on the correct implementation the child exits immediately and
the helper throws on its first loop iteration.

- [ ] **Step 2: Run, then prove the test can actually fail**

Run: `npm test`
Expected: PASS.

Then temporarily change Task 4 Step 5b to hardcode `search_budget: true` instead
of reading the capability, re-run, and confirm the gemini case fails. Revert.
A wiring test that cannot fail proves nothing.

- [ ] **Step 3: Commit**

```bash
git add test/routes.test.js
git commit -m "Prove SEARCH_PROVIDER capability branching is wired to the server"
```

---

## Task 6: The phase 2 validation gate

**Files:**
- Create: `docs/evals/2026-08-10-gemini-pipeline-validation.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the go/no-go evidence for phases 3 to 5. **No code.**

This is the task the whole plan exists to reach. Run Gemini through the real pipeline and measure the two things the scratch harness could not.

- [ ] **Step 1: Run the eval against a Gemini-backed server**

Follow the isolation rules in the search-eval-harness notes exactly: a separate worktree, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` blank, and only the API key lines copied into that worktree's `.env`. In PowerShell `$env:SUPABASE_URL = ""` deletes rather than empties the variable, so use a `node -e` launcher that sets `process.env` explicitly.

```bash
SEARCH_PROVIDER=gemini GEMINI_API_KEY=... ADMIN_KEY=local node run-eval.js --label gemini-pipeline
```

- [ ] **Step 2: Measure the link-check demotion rate**

The offline audit found 30% of Gemini's `source_url` values were bare domains. `applySourceLinkCheck` demotes dead-linked comps to `estimate`. Count how many it demoted:

```bash
grep -c "link_check" <server log>
```

Compare `estimateRate` in the new summary against the 0.000 the offline harness reported. **A large gap means the offline provenance score was inflated.**

- [ ] **Step 3: Measure the listing-versus-closed-sale rate**

For every comp whose `date` falls in the current month AND whose `source_url` host is a listing site (crexi, loopnet, commercialsearch), count it as a suspected active listing rather than a closed sale. Report the count and the percentage of `pricedSales`.

- [ ] **Step 4: Write the findings**

Create `docs/evals/2026-08-10-gemini-pipeline-validation.md` recording: the comparison against `docs/evals/2026-08-10-sonnet-4-6-1786376928210.json`, the demotion rate from Step 2, the suspected-listing rate from Step 3, the real cost per report from the `Gemini call [solo]` log lines, and an explicit **go or no-go for phases 3 to 5**.

- [ ] **Step 5: Commit**

```bash
git add docs/evals/2026-08-10-gemini-pipeline-validation.md
git commit -m "Record Gemini full-pipeline validation results"
```

---

## Self-Review

**Spec coverage.** Provider modules pure with `server.js` owning I/O: Tasks 1 and 3. Capability descriptor and the never-branch-on-name rule: Tasks 1, 3, 4, enforced by Task 5. `SEARCH_PROVIDER` flag: Task 4. Phase 1 zero-behavior-change with identical-report check: Task 2 Steps 7 and 8. Phase 2 validation gate with both required measurements: Task 6. Recorded fixtures so CI needs no key: Tasks 1 and 3. Wiring test in the `routes.test.js` style: Task 5. `maxOutputTokens` truncation risk from the spec's risk list: Task 3 Step 4, sized at 32000/24000 against the measured 6,473 thought tokens.

**Deliberately deferred**, per the spec's own phasing: `costOf` is exported and unit-tested in Tasks 1 and 3 but not yet wired into the analytics event or the `/admin` tile, which is phase 3. Streaming parity is phase 4, which is why `search-provider-gemini.js` declares `streaming: false` and Task 4 Step 4 forces the non-streaming path. Fallback is phase 5 and appears nowhere here.

**Type consistency.** Both modules export the identical nine-name surface, asserted directly by the second test in Task 3. Normalized usage is `{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens}` in Tasks 1, 2, 3 and 4 consistently. `parseResponse` returns `{text, searches, stopReason, usage}` in both.

**Two defects found and fixed during this review, worth recording because they
were both in the plan rather than in the code.** Task 5 originally asserted on
the child server's stdout; `test/helpers/boot.js` spawns with `stdio: "ignore"`,
so those tests could never have passed. The fix was to give the capability an
observable surface (`/healthz`, Task 4 Step 5b) and assert against that. The
same task also assumed a `bootServer` helper that does not exist; the real
entry point is `boot(env)` in `test/routes.test.js` delegating to
`test/helpers/boot.js`, returning `{ base, stop }`.

**One risk that remains.** Task 2's identical-report check (Step 8) is a manual
eyeball of one live search, not an automated assertion, because a real search
costs money and calls a paid API. If the refactor changes report output subtly,
`npm test` will not catch it. Run Step 8 carefully and compare against a report
for the same address from before the change.
