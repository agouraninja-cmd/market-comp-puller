# Vault PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a broker drop a table PDF (CoStar / ARGUS / CMA) onto "Build your own comp set," confirm the extracted rows, and import them through today's vault write path.

**Architecture:** Same file picker, two readers. A PDF posts to a new `POST /api/vault/extract` that sends the file to the live search vendor as a document with **no search tools**, classifies each candidate through `normalizeRow`, and returns a confirm table. Checked rows post to today's `POST /api/vault/upload` as `{ filename, rows }`, which runs them through `exportCsv` then `parseUpload`. CSV is unchanged. The PDF is never stored.

**Tech Stack:** Plain Node (built-in `fetch`, no npm dependencies), `node:test` + `node:assert`, Anthropic Messages `document` blocks / Gemini `generateContent` `inline_data`, browser JS inside the `vault-page.js` template literal.

**Spec:** `docs/superpowers/specs/2026-08-13-vault-pdf-import-design.md`

## Global Constraints

- **Zero npm dependencies.** Node 18+ built-ins only. Never add a package. Never add pdf.js, pdf-parse, or a CDN PDF reader.
- **Pure modules stay pure.** `broker-vault.js` takes no clock, no I/O, no `require` beyond Node built-ins.
- **Reject rather than guess.** A wrong number in a broker's own records is worse than a refused row.
- **`openVault` order is 401 not signed in, 403 not entitled (`canUseVault`), 503 no database.** The new extract route goes through the same helper, in that order.
- **No file fallback for vault data.** Extract writes nothing; confirm writes through today's upload, which already refuses without a database.
- **Extract is not a search.** Never reuse `buildRequestBody`. Never attach `web_search` or `google_search`. Never send the PDF to a vendor this deployment did not choose.
- **Still exactly one `<input type=file>`.** First-run and the deck action both call `$("file").click()`.
- **Devlog entry rides in the same commit as shipped work** (`devlog.json`, shape in CLAUDE.md). Save as clean UTF-8.
- **Shared checkout.** `git status --short` immediately before staging, explicit paths only, never `git add -A`.
- **Run `npm test` before every commit.**

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `broker-vault.js` | PDF magic, extract JSON parse, classify candidates, `uploadPayloadToCsv` | Modify |
| `test/broker-vault.test.js` | Unit tests for those rules | Modify |
| `search-provider-anthropic.js` | `pdfExtract` capability, `buildExtractBody`, `extractRequestInit`, `parseExtractResponse` | Modify |
| `search-provider-gemini.js` | Same surface; Gemini body hits `generateContent`, not Interactions | Modify |
| `test/search-provider-anthropic.test.js` | No-tools extract body, document block | Modify |
| `test/search-provider-gemini.test.js` | No-tools extract body, generateContent URL, shared export list | Modify |
| `server.js` | `POST /api/vault/extract`, `rows` on upload, `extractPdfOnce` | Modify |
| `test/routes.test.js` | Extract is vault-gated like upload | Modify |
| `vault-page.js` | Picker copy, PDF branch, `#pdfSec` confirm table | Modify |
| `test/vault-page.test.js` | PDF does not open the mapper; Import posts checked rows | Modify |
| `test/vault-first-run.test.js` | Still one file input; accept includes pdf; privacy sentence | Modify |
| `CLAUDE.md`, `devlog.json` | Document the new route and the confirm table | Modify |
| `docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md` | One-line supersession of "PDF ingestion out of scope" | Modify |

---

### Task 1: Pure extract helpers in `broker-vault.js`

**Files:**
- Modify: `broker-vault.js` (new section above `module.exports`, and add the names to the export object around line 1333)
- Test: `test/broker-vault.test.js` (add to the destructure at the top)

**Interfaces:**
- Consumes: `normalizeRow(raw)`, `exportCsv(rows)`, `TEMPLATE_COLUMNS`, `OPTIONAL_SPEC_COLUMNS` (existing)
- Produces:
  - `MAX_PDF_BYTES = 4 * 1024 * 1024`
  - `VAULT_FIELD_KEYS = [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS]`
  - `looksLikePdf(bytes: Uint8Array|Buffer) -> boolean` — true iff the first four bytes are `%PDF`
  - `parseExtractJson(text: string) -> { ok, rows, error }` — strips fences, finds the first balanced JSON array, `JSON.parse`s it; not-an-array is a failure
  - `classifyExtractRows(candidates: object[]) -> { values, error }[]` — drops unknown keys, stringifies surviving values, runs `normalizeRow`; on failure `values` is still present and `error` is `errors.join("; ")`
  - `uploadPayloadToCsv({ csv, rows }) -> { ok, csv, error }` — `rows` and `csv` together is a failure; a non-empty `rows` array becomes `exportCsv(rows)`

- [ ] **Step 1: Write the failing tests**

Add to the `require("../broker-vault")` destructure at the top of `test/broker-vault.test.js`: `looksLikePdf`, `parseExtractJson`, `classifyExtractRows`, `uploadPayloadToCsv`, `MAX_PDF_BYTES`, `VAULT_FIELD_KEYS`.

Add at the bottom of the file:

```js
// --- PDF extract helpers -------------------------------------------------
//
// A PDF has to be read, so a price can come out wrong. These helpers never
// store anything: they decide whether the bytes are a PDF, turn the model's
// text into an array, and classify each candidate through normalizeRow so
// the confirm table can tint a bad row without dropping the values the
// broker needs to edit.

test("looksLikePdf accepts a %PDF header and refuses anything else", () => {
  assert.equal(looksLikePdf(Buffer.from("%PDF-1.4\n")), true);
  assert.equal(looksLikePdf(Buffer.from("%PDF")), true);
  assert.equal(looksLikePdf(Buffer.from("PK\x03\x04")), false, "xlsx zip magic");
  assert.equal(looksLikePdf(Buffer.from("")), false);
  assert.equal(looksLikePdf(null), false);
});

test("MAX_PDF_BYTES is 4 MiB", () => {
  assert.equal(MAX_PDF_BYTES, 4 * 1024 * 1024);
});

test("parseExtractJson takes a fenced array and ignores trailing junk", () => {
  const text = "```json\n[{\"address\":\"1 Main St\"}]\n```\nThanks!";
  const out = parseExtractJson(text);
  assert.equal(out.ok, true);
  assert.equal(out.rows[0].address, "1 Main St");
});

test("parseExtractJson refuses an object, a truncated array, and empty text", () => {
  assert.equal(parseExtractJson("{\"rows\":[]}").ok, false,
    "the prompt asks for an array; do not guess a wrapping object");
  assert.equal(parseExtractJson("[{\"a\":").ok, false);
  assert.equal(parseExtractJson("").ok, false);
});

test("classifyExtractRows keeps values on a failed row and drops unknown keys", () => {
  const out = classifyExtractRows([
    {
      address: "4100 W Franklin Rd, Boise ID",
      property_type: "Industrial",
      transaction: "sale",
      deal_date: "2026-03-12",
      price: "$4,250,000",
      verified: true,
      source_url: "https://example.com",
    },
    {
      address: "Meridian industrial (submarket)",
      property_type: "Industrial",
      transaction: "sale",
      price: "68.11",
    },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].error, null);
  assert.equal(out[0].values.address, "4100 W Franklin Rd, Boise ID");
  assert.equal(out[0].values.verified, undefined);
  assert.equal(out[0].values.source_url, undefined);
  assert.ok(out[1].error, "a numberless address must fail normalizeRow");
  assert.equal(out[1].values.address, "Meridian industrial (submarket)",
    "the confirm table cannot edit a value we dropped");
});

test("uploadPayloadToCsv turns confirm rows into a parseUpload-clean CSV", () => {
  const rows = [{
    address: "4100 W Franklin Rd, Boise ID",
    property_type: "Industrial",
    transaction: "sale",
    deal_date: "2026-03-12",
    price: "$4,250,000",
    size_sqft: "50000",
  }];
  const made = uploadPayloadToCsv({ rows });
  assert.equal(made.ok, true);
  const parsed = parseUpload(made.csv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].price, 4250000);
});

test("uploadPayloadToCsv refuses csv and rows together, and an empty rows array", () => {
  assert.equal(uploadPayloadToCsv({ csv: "address\n", rows: [{ address: "1 Main" }] }).ok, false);
  assert.equal(uploadPayloadToCsv({ rows: [] }).ok, false);
  assert.equal(uploadPayloadToCsv({ csv: "address,property_type,transaction,deal_date\n1 Main St,Industrial,sale,2026-01-05\n" }).ok, true);
});

test("VAULT_FIELD_KEYS is template plus optional spec, nothing else", () => {
  assert.deepEqual(VAULT_FIELD_KEYS, [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern "looksLikePdf|parseExtractJson|classifyExtractRows|uploadPayloadToCsv|MAX_PDF_BYTES|VAULT_FIELD_KEYS"`

Expected: FAIL with `looksLikePdf is not a function` (or the destructure throws).

- [ ] **Step 3: Implement the helpers**

In `broker-vault.js`, add `VAULT_FIELD_KEYS` next to `MAPPABLE_TARGETS` (around line 258):

```js
const VAULT_FIELD_KEYS = [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS];
```

Add `MAX_PDF_BYTES` next to `MAX_ROWS_PER_UPLOAD` (around line 80):

```js
const MAX_PDF_BYTES = 4 * 1024 * 1024;
```

Add this section just above `module.exports`:

```js
// --- PDF extract -----------------------------------------------------------
//
// Table PDFs are read by a model, then classified here, then confirmed in
// the browser. Nothing in this section writes. looksLikePdf is a magic-byte
// check so a renamed .xlsx cannot reach the vendor. parseExtractJson only
// accepts an array — wrapping objects are a guess we refuse.

function looksLikePdf(bytes) {
  if (!bytes || bytes.length < 4) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function parseExtractJson(rawText) {
  const empty = { ok: false, rows: [], error: "We couldn't find a deals table in that PDF." };
  let text = String(rawText || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("[");
  if (start === -1) return empty;
  let depth = 0, inString = false, escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
    } else if (ch === "\"") inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return empty;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return empty;
    return { ok: true, rows: parsed, error: "" };
  } catch (err) {
    return empty;
  }
}

function vaultValues(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const k of VAULT_FIELD_KEYS) {
    if (src[k] == null) continue;
    const s = String(src[k]).trim();
    if (s) out[k] = s;
  }
  return out;
}

function classifyExtractRows(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.map((raw) => {
    const values = vaultValues(raw);
    const result = normalizeRow(values);
    return {
      values,
      error: result.ok ? null : (result.errors || []).join("; "),
    };
  });
}

function uploadPayloadToCsv({ csv, rows } = {}) {
  const hasRows = rows != null;
  const hasCsv = csv != null && csv !== "";
  if (hasRows && hasCsv) {
    return { ok: false, csv: "", error: "Send csv or rows, not both." };
  }
  if (hasRows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, csv: "", error: "Nothing to import." };
    }
    return { ok: true, csv: exportCsv(rows), error: "" };
  }
  if (typeof csv === "string") return { ok: true, csv, error: "" };
  return { ok: false, csv: "", error: "Nothing to import." };
}
```

Export the new names from `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern "looksLikePdf|parseExtractJson|classifyExtractRows|uploadPayloadToCsv|MAX_PDF_BYTES|VAULT_FIELD_KEYS"`

Expected: PASS. Then `npm test` for the whole suite.

- [ ] **Step 5: Commit**

```bash
git add broker-vault.js test/broker-vault.test.js
git commit -m "Add vault helpers that classify PDF-extracted rows without storing them."
```

---

### Task 2: Provider extract surface (no search tools)

**Files:**
- Modify: `search-provider-anthropic.js`, `search-provider-gemini.js`
- Test: `test/search-provider-anthropic.test.js`, `test/search-provider-gemini.test.js`

**Interfaces:**
- Consumes: existing `requestInit` (Anthropic can reuse its URL/headers)
- Produces, on **both** provider modules:
  - `capabilities.pdfExtract: true`
  - `buildExtractBody({ model, prompt, pdfBase64 }) -> object` — **no `tools` key**
  - `extractRequestInit({ apiKey, model }) -> { url, headers }`
  - `parseExtractResponse(data) -> { text, usage }` (`usage` via existing `normalizeUsage`)

Anthropic body:

```js
{
  model,
  max_tokens: 8000,
  messages: [{
    role: "user",
    content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
      { type: "text", text: prompt },
    ],
  }],
}
```

Gemini body (generateContent REST, **not** Interactions):

```js
{
  contents: [{
    parts: [
      { inline_data: { mime_type: "application/pdf", data: pdfBase64 } },
      { text: prompt },
    ],
  }],
  generationConfig: { maxOutputTokens: 8192 },
}
```

Gemini `extractRequestInit` URL: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` with headers `{ "content-type": "application/json", "x-goog-api-key": apiKey }`.

Anthropic `extractRequestInit` reuses `requestInit({ apiKey })` (same Messages URL). `model` is unused for the URL.

Gemini `parseExtractResponse` reads `candidates[0].content.parts` text (generateContent shape), **not** Interactions `steps`. Anthropic `parseExtractResponse` can wrap existing `parseResponse` and return `{ text, usage }`.

- [ ] **Step 1: Write the failing tests**

In `test/search-provider-anthropic.test.js`:

```js
test("declares pdfExtract and buildExtractBody has no tools", () => {
  assert.equal(P.capabilities.pdfExtract, true);
  const body = P.buildExtractBody({ model: "claude-sonnet-4-6", prompt: "EXTRACT", pdfBase64: "AAA" });
  assert.equal("tools" in body, false);
  const wire = JSON.stringify(body);
  assert.equal(wire.includes("web_search"), false);
  assert.equal(wire.includes("google_search"), false);
  const blocks = body.messages[0].content;
  assert.equal(blocks[0].type, "document");
  assert.equal(blocks[0].source.media_type, "application/pdf");
  assert.equal(blocks[0].source.data, "AAA");
  assert.equal(blocks[1].text, "EXTRACT");
});
```

In `test/search-provider-gemini.test.js`, extend the shared-export loop:

```js
for (const k of ["name", "logLabel", "defaultModel", "apiKeyEnv", "capabilities", "buildRequestBody",
                 "requestInit", "parseResponse", "normalizeUsage", "costOf", "deadlineTokens",
                 "buildExtractBody", "extractRequestInit", "parseExtractResponse"]) {
```

And add:

```js
test("declares pdfExtract and buildExtractBody has no google_search", () => {
  assert.equal(P.capabilities.pdfExtract, true);
  const body = P.buildExtractBody({ model: "gemini-3.6-flash", prompt: "EXTRACT", pdfBase64: "AAA" });
  assert.equal("tools" in body, false);
  const wire = JSON.stringify(body);
  assert.equal(wire.includes("google_search"), false);
  assert.equal(wire.includes("web_search"), false);
  assert.equal(body.contents[0].parts[0].inline_data.mime_type, "application/pdf");
  assert.equal(body.contents[0].parts[0].inline_data.data, "AAA");
  assert.equal(body.contents[0].parts[1].text, "EXTRACT");
  assert.equal(body.generationConfig.maxOutputTokens, 8192);
});

test("extractRequestInit hits generateContent, not Interactions", () => {
  const init = P.extractRequestInit({ apiKey: "k", model: "gemini-3.6-flash" });
  assert.match(init.url, /models\/gemini-3\.6-flash:generateContent/);
  assert.equal(init.url.includes("interactions"), false);
  assert.equal(init.headers["x-goog-api-key"], "k");
});

test("parseExtractResponse reads generateContent candidates, not Interactions steps", () => {
  const out = P.parseExtractResponse({
    candidates: [{ content: { parts: [{ text: "[{\"address\":\"1 Main\"}]" }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
  });
  assert.equal(out.text, "[{\"address\":\"1 Main\"}]");
});
```

If Gemini `normalizeUsage` does not read `usageMetadata`, return `{ text, usage: P.normalizeUsage({}) }` rather than inventing a mapping — cost logging can stay zero until a real call shows the field names. Do not guess token field names.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern "pdfExtract|buildExtractBody|extractRequestInit|parseExtractResponse"`

Expected: FAIL (`pdfExtract` undefined / `buildExtractBody` missing).

- [ ] **Step 3: Implement on both providers**

`search-provider-anthropic.js` — add to `capabilities`: `pdfExtract: true`. Add the three functions. Export them. `parseExtractResponse` can be:

```js
function parseExtractResponse(data) {
  const parsed = parseResponse(data);
  return { text: parsed.text, usage: parsed.usage };
}
```

`search-provider-gemini.js` — same capability flag. `buildExtractBody` as the Gemini object above. `extractRequestInit` as the generateContent URL. `parseExtractResponse`:

```js
function parseExtractResponse(data) {
  const parts = ((((data || {}).candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.filter((p) => p && typeof p.text === "string").map((p) => p.text).join("");
  return { text: text.trim(), usage: normalizeUsage(data && data.usage) };
}
```

- [ ] **Step 4: Live probe (only if `GEMINI_API_KEY` is set in `.env`)**

Search is Gemini in production. Before Task 3 wires the route, confirm generateContent accepts this body. From the repo root, with the portable Node on PATH:

```powershell
node -e "const fs=require('fs'); for (const line of fs.readFileSync('.env','utf8').split(/\r?\n/)) { const i=line.indexOf('='); if(i>0 && process.env[line.slice(0,i)]===undefined) process.env[line.slice(0,i)]=line.slice(i+1); } const P=require('./search-provider-gemini'); const pdf=Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64'); const init=P.extractRequestInit({ apiKey: process.env.GEMINI_API_KEY, model: P.defaultModel }); const body=P.buildExtractBody({ model: P.defaultModel, prompt: 'Reply with [] and nothing else.', pdfBase64: pdf }); fetch(init.url,{ method:'POST', headers: init.headers, body: JSON.stringify(body) }).then(async r => { console.log(r.status); console.log((await r.text()).slice(0,500)); });"
```

Expected: HTTP 200, or 400 whose body names a field to fix. If 400, fix `buildExtractBody` / `extractRequestInit` and re-run this step before continuing. If `GEMINI_API_KEY` is unset, skip — the unit tests are the gate.

Do **not** check `.env` into git. Do not log the key.

- [ ] **Step 5: Run the provider tests and the full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add search-provider-anthropic.js search-provider-gemini.js test/search-provider-anthropic.test.js test/search-provider-gemini.test.js
git commit -m "Give both search providers a no-tools PDF extract body."
```

---

### Task 3: `POST /api/vault/extract`

**Files:**
- Modify: `server.js` (new route next to `/api/vault/inspect` / `/api/vault/upload`, around line 11600)
- Test: `test/routes.test.js` (add `["POST", "/api/vault/extract"]` to the anonymous-caller list around line 246)

**Interfaces:**
- Consumes: `openVault`, `VAULT.looksLikePdf`, `VAULT.parseExtractJson`, `VAULT.classifyExtractRows`, `VAULT.MAX_PDF_BYTES`, `PROVIDER.buildExtractBody`, `PROVIDER.extractRequestInit`, `PROVIDER.parseExtractResponse`, `PROVIDER.capabilities.pdfExtract`, `providerApiKey()`, `MODEL`, `rateLimited`, `logEvent`
- Produces: `POST /api/vault/extract` JSON `{ filename, pdf }` → `{ rows: [{ values, error }] }` or 4xx/5xx. Writes nothing.

- [ ] **Step 1: Write the failing route test**

In `test/routes.test.js`, add to the `routes` array inside `"every vault route refuses an anonymous caller"`:

```js
["POST",   "/api/vault/extract"],
```

The POST body already sent by that loop (`{ filename: "x.csv", csv: "a,b" }`) is fine — the gate must fire before the body is interpreted.

Add a sibling of the inspect test:

```js
await t.test("/api/vault/extract is gated like the rest of the vault", async () => {
  const r = await fetch(srv.base + "/api/vault/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: "book.pdf", pdf: "AAAA" }),
  });
  assert.equal(r.status, 401, "an anonymous caller must not send a file to the extract vendor");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/routes.test.js`

Expected: FAIL — `POST /api/vault/extract must refuse an anonymous caller` with status 404.

- [ ] **Step 3: Implement `extractPdfOnce` and the route**

Place `EXTRACT_PROMPT` near `buildPrompt` (a constant, not a function — the vault field lists do not change per request):

```js
const EXTRACT_PROMPT = `You extract commercial real estate comparable transactions from a table PDF (CoStar, ARGUS, CMA, or similar). Return ONLY a JSON array of objects. No markdown, no keys wrapping the array.

Each object may only use these keys: ${[...VAULT.TEMPLATE_COLUMNS, ...VAULT.OPTIONAL_SPEC_COLUMNS].join(", ")}.
property_type must be one of: ${VAULT.PROPERTY_TYPES.join(", ")}.
transaction must be "sale" or "lease".
deal_date must be YYYY-MM-DD.

Rules:
- Extract every deal row from tables. Omit header rows, totals, averages, and submarket-summary rows.
- Omit a field rather than invent it. Never invent a price, date, or size.
- address must be a specific property with a street number, not a district or "general submarket estimate".
- Do not include a verified flag or a source_url.`;
```

`VAULT` is already required in `server.js`. If `TEMPLATE_COLUMNS` is not currently used there, this is the first reader — that is fine.

Add `extractPdfOnce` next to `repairCompJson` (around line 3853). 90 s timeout, no stream, no tools:

```js
async function extractPdfOnce(pdfBase64) {
  if (!PROVIDER.capabilities.pdfExtract) {
    const err = new Error("PDF import isn't available on this deployment.");
    err.statusCode = 503;
    throw err;
  }
  const apiKey = providerApiKey();
  if (!apiKey) {
    const err = new Error(`Server is missing the ${PROVIDER.apiKeyEnv} environment variable.`);
    err.statusCode = 503;
    throw err;
  }
  const init = PROVIDER.extractRequestInit({ apiKey, model: MODEL });
  const body = PROVIDER.buildExtractBody({ model: MODEL, prompt: EXTRACT_PROMPT, pdfBase64 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const startedAt = Date.now();
  try {
    const r = await fetch(init.url, {
      method: "POST",
      headers: init.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).slice(0, 200);
      throw upstreamError(r.status, detail);
    }
    const parsed = PROVIDER.parseExtractResponse(await r.json());
    console.log(`${PROVIDER.logLabel} pdf-extract: ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${(parsed.usage && parsed.usage.output_tokens) || 0} out / ${(parsed.usage && parsed.usage.input_tokens) || 0} in tokens`);
    return parsed.text || "";
  } catch (err) {
    if (err && err.name === "AbortError") {
      const e = new Error("Could not read that PDF. Nothing was saved.");
      e.statusCode = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

`upstreamError` already maps vendor failures to a visitor-safe `userMessage`. The handler catch should use `clientErrorMessage(err)` the way `/api/comps` does, so a billing 400 never names Anthropic/Gemini to the broker.

Route, same JSON-body pattern as upload (8e6 runaway guard), immediately after the inspect route (or immediately before upload):

```js
if (req.method === "POST" && path === "/api/vault/extract") {
  let body = "";
  let tooBig = false;
  req.on("data", (c) => {
    body += c;
    if (body.length > 8e6 && !tooBig) { tooBig = true; req.destroy(); }
  });
  req.on("end", async () => {
    try {
      if (tooBig) return;
      const user = await openVault();
      if (!user) return;
      if (rateLimited("vaultex:" + clientIp(req), 8)) {
        return sendJson(res, 429, { error: "Too many uploads. Please wait a moment." });
      }
      const { filename, pdf } = JSON.parse(body || "{}");
      const b64 = String(pdf || "").replace(/^data:application\/pdf;base64,/i, "");
      let bytes;
      try { bytes = Buffer.from(b64, "base64"); }
      catch (err) { return sendJson(res, 400, { error: "That doesn't look like a PDF." }); }
      if (!VAULT.looksLikePdf(bytes)) {
        return sendJson(res, 400, { error: "That doesn't look like a PDF." });
      }
      if (bytes.length > VAULT.MAX_PDF_BYTES) {
        return sendJson(res, 400, { error: "That file is too large to read." });
      }
      const text = await extractPdfOnce(b64);
      const parsed = VAULT.parseExtractJson(text);
      if (!parsed.ok || parsed.rows.length === 0) {
        logEvent("vault_extract", { source: "empty:0" });
        return sendJson(res, 400, { error: parsed.error || "We couldn't find a deals table in that PDF." });
      }
      const rows = VAULT.classifyExtractRows(parsed.rows);
      logEvent("vault_extract", { source: `ok:${rows.length}` });
      sendJson(res, 200, {
        filename: String(filename || "").trim().slice(0, 200),
        rows,
      });
    } catch (err) {
      console.error("vault extract error:", err.message);
      const status = err.statusCode || 500;
      sendJson(res, status, { error: clientErrorMessage(err) || "Could not read that PDF. Nothing was saved." });
    }
  });
  return;
}
```

Do not insert into `broker_uploads` or `broker_comps` on this path.

- [ ] **Step 4: Run the route tests and the full suite**

Run: `npm test`

Expected: PASS. The new extract tests return 401, not 404.

- [ ] **Step 5: Commit**

```bash
git add server.js test/routes.test.js
git commit -m "Add POST /api/vault/extract, gated like the rest of the vault."
```

---

### Task 4: Upload accepts confirmed `rows`

**Files:**
- Modify: `server.js` (`POST /api/vault/upload`, around line 11681 where it currently does `const { filename, csv, mapping } = JSON.parse(body || "{}")`)

**Interfaces:**
- Consumes: `VAULT.uploadPayloadToCsv` (Task 1), existing `VAULT.parseUpload`
- Produces: upload body may be `{ filename, csv, mapping? }` (unchanged) or `{ filename, rows }` (new). Both present → 400.

- [ ] **Step 1: Write a failing unit test that the handler will rely on**

Already landed in Task 1 (`uploadPayloadToCsv` refuses both). Add one more in `test/broker-vault.test.js` if it is not already there: mapping is irrelevant to `uploadPayloadToCsv` (it does not take `mapping`). No new test required if Task 1 passed.

This task's failing signal is the handler still ignoring `rows`. Add a comment test in `test/broker-vault.test.js` only if you need a red bar — otherwise go to Step 3 and prove the branch with a one-line assertion that `uploadPayloadToCsv({ rows: [...] }).csv` is what `parseUpload` already accepts.

- [ ] **Step 2: Confirm the helper still passes**

Run: `npm test -- --test-name-pattern "uploadPayloadToCsv"`

Expected: PASS.

- [ ] **Step 3: Wire the handler**

Replace the parse of the upload body:

```js
const parsedBody = JSON.parse(body || "{}");
const { filename, mapping } = parsedBody;
const made = VAULT.uploadPayloadToCsv({ csv: parsedBody.csv, rows: parsedBody.rows });
if (!made.ok) {
  return sendJson(res, 400, { error: made.error || "Nothing to import." });
}
const csv = made.csv;
const parsed = VAULT.parseUpload(csv, { mapping: parsedBody.rows ? null : (mapping || null) });
```

When `rows` is set, `mapping` is ignored (spec). `filename` is still `String(filename || "").trim().slice(0, 200)` on the `broker_uploads` insert — for a PDF confirm this is the PDF's name.

Leave the rest of the handler (batch insert, `linkVaultProperties`, skip counts) untouched.

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: PASS. Existing mapper/upload page tests still post `{ filename, csv }` and must keep working.

- [ ] **Step 5: Commit**

```bash
git add server.js test/broker-vault.test.js
git commit -m "Let vault upload accept confirmed rows, still parsed as CSV."
```

---

### Task 5: Confirm table on `/vault`

**Files:**
- Modify: `vault-page.js` (picker copy around lines 428–497; `upload` around 1792; new `#pdfSec` next to `#mapSec` around 542)
- Test: `test/vault-page.test.js`, `test/vault-first-run.test.js`

**Interfaces:**
- Consumes: `POST /api/vault/extract` `{ filename, pdf }`, `POST /api/vault/upload` `{ filename, rows }`
- Produces: `#pdfSec` confirm table (layout A). CSV path still inspect → mapper / `doImport`.

- [ ] **Step 1: Write the failing page tests**

In `test/vault-first-run.test.js`:

```js
test("the file input accepts csv and pdf", () => {
  assert.match(html(), /id="file"[^>]*accept="[^"]*\.pdf/);
});

test("the first-run disclosure names the extract vendor", () => {
  assert.match(html(), /extract vendor/);
});

test("picker copy mentions PDF", () => {
  assert.match(html(), /Choose a spreadsheet or PDF/);
});
```

The existing "exactly one file input" test must still pass — do not add a second input.

In `test/vault-page.test.js`, extend `stubFileReader`:

```js
function stubFileReader() {
  return function FakeFileReader() {
    this.readAsText = (file) => { this.result = file.text; if (this.onload) this.onload(); };
    this.readAsDataURL = (file) => {
      this.result = file.dataUrl || "data:application/pdf;base64,JVBERi0x";
      if (this.onload) this.onload();
    };
  };
}
```

Extend `runPage`'s `fakeFetch` to answer `/api/vault/extract`:

```js
if (u.indexOf("/api/vault/extract") === 0) {
  return opts.extract
    ? opts.extract(init)
    : Promise.resolve(jsonResponse(200, { filename: "book.pdf", rows: [] }));
}
```

Add helpers next to `chooseFile`:

```js
async function choosePdf(doc, name) {
  doc.getElementById("file").fire("change", {
    target: { files: [{ name: name || "book.pdf", type: "application/pdf", size: 1200, dataUrl: "data:application/pdf;base64,JVBERi0x" }], value: "x" },
  });
  await tick();
  await tick();
}
```

Add tests:

```js
test("a PDF does not call inspect and does not open the mapper", async () => {
  const { doc, calls } = await runPage([], null, {
    extract: () => Promise.resolve(jsonResponse(200, {
      filename: "Q2.pdf",
      rows: [{
        values: { address: "4100 W Franklin Rd, Boise ID", property_type: "Industrial", transaction: "sale", deal_date: "2026-03-12", price: "4250000" },
        error: null,
      }],
    })),
  });
  await choosePdf(doc, "Q2.pdf");
  assert.equal(calls.filter((c) => c.url.indexOf("/api/vault/inspect") === 0).length, 0);
  assert.ok(doc.getElementById("mapSec").classList.contains("hide"));
  assert.ok(!doc.getElementById("pdfSec").classList.contains("hide"));
});

test("a CSV still goes through inspect", async () => {
  const { doc, calls } = await runPage([]);
  await chooseFile(doc, CLEAN_CSV);
  assert.ok(calls.some((c) => c.url.indexOf("/api/vault/inspect") === 0),
    "spreadsheets must not start taking the PDF path");
});

```js
test("Import posts only checked rows under the PDF filename", async () => {
  const { doc, calls } = await runPage([], null, {
    extract: () => Promise.resolve(jsonResponse(200, {
      filename: "Q2.pdf",
      rows: [
        { values: { address: "4100 W Franklin Rd, Boise ID", property_type: "Industrial", transaction: "sale", deal_date: "2026-03-12" }, error: null },
        { values: { address: "Meridian industrial (submarket)", property_type: "Industrial", transaction: "sale" }, error: "no street number" },
      ],
    })),
    upload: () => Promise.resolve(jsonResponse(200, { ok: true, imported: 1 })),
  });
  await choosePdf(doc, "Q2.pdf");
  doc.getElementById("pdfGo").click();
  await tick();
  const up = calls.filter((c) => c.url.indexOf("/api/vault/upload") === 0);
  assert.equal(up.length, 1);
  assert.equal(up[0].body.filename, "Q2.pdf");
  assert.equal(up[0].body.csv, undefined);
  assert.equal(up[0].body.rows.length, 1);
  assert.equal(up[0].body.rows[0].address, "4100 W Franklin Rd, Boise ID");
});

test("a non-csv non-pdf file never hits inspect", async () => {
  const { doc, calls } = await runPage([]);
  doc.getElementById("file").fire("change", {
    target: { files: [{ name: "book.xlsx", type: "application/vnd.ms-excel", text: "PK" }], value: "x" },
  });
  await tick();
  assert.equal(calls.filter((c) => c.url.indexOf("/api/vault/inspect") === 0).length, 0);
  assert.match(doc.getElementById("res").innerHTML, /Use a \.csv or \.pdf/);
});
```

The stub DOM's `classList.contains` must work. If `stubElement` does not implement `classList`, assert on `className` the way neighboring tests already do (`assert.match(html, /id="pdfSec"/)` on the rendered HTML for presence; `className.indexOf("hide")` for visibility after `choosePdf`).

Also pin `#pdfSec` ships hidden in the markup, same as `#mapSec`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern "accepts csv and pdf|extract vendor|spreadsheet or PDF|does not call inspect|checked rows|non-csv non-pdf"`

Expected: FAIL (no `pdfSec`, copy still says "Choose a spreadsheet").

- [ ] **Step 3: Implement the page**

Copy:

- `#pick` and `#frPick` labels: `Choose a spreadsheet or PDF`
- Drop line: `or drop a .csv or .pdf here`
- `#file` `accept=".csv,.pdf,text/csv,application/pdf"`
- First-run disclosure, new paragraph after the existing privacy paragraph: `A PDF is sent to our extract vendor to read the table. CompNinja does not store the file. Rows land in your vault only after you confirm.`
- Empty comps line: `upload a spreadsheet or PDF`

Markup, sibling of `#mapSec` (same `.mappanel` class is fine, or reuse it — do not reuse `#mapSec` itself):

```html
<div id="pdfSec" class="mappanel hide">
  <h2>Review these comps</h2>
  <p class="sub" style="margin-top:0"><span id="pdfCount">0</span> deals in <span id="pdfName"></span>.
    Uncheck any that aren't yours. Fix a cell if we misread it. Nothing is saved until you import.</p>
  <p class="note" id="pdfStrip"></p>
  <div class="tw"><table id="pdfTable">
    <thead id="pdfHead"></thead>
    <tbody id="pdfBody"></tbody>
  </table></div>
  <p id="pdfMsg" class="msg bad hide"></p>
  <div class="row">
    <button class="btn" id="pdfGo">Import</button>
    <button class="btn ghost" id="pdfCancel">Cancel</button>
  </div>
</div>
```

Script (next to `upload` / mapper):

```js
function isPdfFile(file){
  var n=String(file&&file.name||"").toLowerCase();
  var t=String(file&&file.type||"");
  return t==="application/pdf" || /\.pdf$/.test(n);
}
function isCsvFile(file){
  var n=String(file&&file.name||"").toLowerCase();
  var t=String(file&&file.type||"");
  return t==="text/csv" || /\.csv$/.test(n);
}

function upload(file){
  if(!file)return;
  if(file.size>4*1024*1024){
    $("res").innerHTML='<div class="msg bad">That file is too large to read.</div>';
    return;
  }
  if(isPdfFile(file)){ extractPdf(file); return; }
  if(!isCsvFile(file)){
    $("res").innerHTML='<div class="msg bad">Use a .csv or .pdf.</div>';
    return;
  }
  // existing inspect path, unchanged from here
  ...
}

function extractPdf(file){
  setAddOpen(true);
  $("pick").disabled=true;
  $("res").innerHTML='<div class="msg ok">Reading the table in '+esc(file.name)+"&hellip;</div>";
  var fr=new FileReader();
  fr.onerror=function(){ $("pick").disabled=false; $("res").innerHTML='<div class="msg bad">Could not read that file.</div>'; };
  fr.onload=function(){
    var url=String(fr.result||"");
    var b64=url.indexOf(",")>=0?url.split(",")[1]:url;
    fetch("/api/vault/extract",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({filename:file.name,pdf:b64})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        $("pick").disabled=false;
        if(o.s!==200){
          $("res").innerHTML='<div class="msg bad">'+esc((o.j&&o.j.error)||"Could not read that PDF. Nothing was saved.")+"</div>";
          return;
        }
        $("res").innerHTML="";
        openPdfPreview(o.j);
      })
      .catch(function(){ $("pick").disabled=false;
        $("res").innerHTML='<div class="msg bad">Could not reach the server to read that file. Nothing was saved.</div>'; });
  };
  fr.readAsDataURL(file);
}
```

`openPdfPreview(info)`:

- Hide `#mapSec`, show `#pdfSec`, hide first-run if it was showing (same `firstRun` hide the mapper uses).
- Columns: `REQUIRED_TARGETS` (`address`, `property_type`, `transaction`, `deal_date`) always, then any other key in `VAULT_FIELD_KEYS` order that has a value on at least one row. Hard-code the required four plus the rest of `TEMPLATE_COLUMNS` / a local copy of the optional names — the page cannot `require` `broker-vault.js`. Duplicate the two arrays as `PDF_REQUIRED` and `PDF_KEYS` next to `TARGET_LABELS`, with a comment that they must stay in step with `broker-vault.js`. A test pins `PDF_REQUIRED` equals `address,property_type,transaction,deal_date` in the emitted script.
- Each body row: checkbox (`checked` when `error==null`), one `<input>` per column bound to `values[key]`. Problem rows get `style="background:#FDF2F2"` (the `.msg.bad` wash).
- `#pdfStrip`: `N found · R ready · F need a fix` (or `F need a date` when every errored row's `error` matches `/date/i` and nothing else).
- `#pdfGo` text: `Import N comps` with N = checked count; disable when N is 0. Update N on checkbox change.
- Hold `pdfPending = info` (the rows array, mutated by input events).

`#pdfGo` click: collect checked rows' current input values into `rows`, then reuse `doImport`'s fetch — either extend `doImport` with an optional `rows` argument:

```js
function doImport(name, csv, mapping, onOk, rows){
  ...
  var payload={filename:name};
  if(rows){ payload.rows=rows; }
  else { payload.csv=csv; if(mapping) payload.mapping=mapping; }
  ...
}
```

On success, `closePdfPreview()` (hide `#pdfSec`, clear `pdfPending`) then the existing imported-count `#res` message. On failure, keep `#pdfSec` open and write into `#pdfMsg` (mapper `failed()` rule). `#pdfCancel` hides the panel and writes `Cancelled. Nothing was saved.` into `#res`.

Do not live-revalidate on input. Tint stays from extract time. A broker who fixes a date still has to check the box.

- [ ] **Step 4: Run the page tests and the full suite**

Run: `npm test`

Expected: PASS. Watch `test/vault-page.test.js` — the page is one template literal; a stray `${` or a single-backslash escape ships a blank workspace. The existing "emitted page script still parses" tests must stay green.

- [ ] **Step 5: Commit**

```bash
git add vault-page.js test/vault-page.test.js test/vault-first-run.test.js
git commit -m "Let the vault confirm table-PDF extracts before importing them."
```

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (broker vault upload bullet, around the `POST /api/vault/upload` paragraph near line 1338)
- Modify: `devlog.json` (one `feature` entry, date `2026-08-13`)
- Modify: `docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md` (the "PDF ingestion" out-of-scope bullet)

**Interfaces:** none. Copy only.

- [ ] **Step 1: Update CLAUDE.md**

In the broker vault routes list, after the upload bullet, add that `POST /api/vault/extract` takes `{ filename, pdf }` (base64), sends the file to the extract vendor with no search tools, writes nothing, and returns `{ rows: [{ values, error }] }` for the confirm table. Upload now also accepts `{ filename, rows }` from that table, converted through `exportCsv` then `parseUpload`. Same `openVault` gate. CSV path unchanged.

In the first-run / one-file-input notes, mention `accept` includes `.pdf` and the confirm panel is `#pdfSec`, not the mapper.

- [ ] **Step 2: Append a devlog entry**

Rebuild staged `devlog.json` from `git show HEAD:devlog.json` plus this one entry (shared-checkout rule — do not patch a working file that may hold another session's unstaged entry). Working-file extra entries stay in the working tree.

```json
{
  "date": "2026-08-13",
  "type": "feature",
  "title": "Vault PDF import for table exports",
  "details": "A broker can drop a CoStar/ARGUS/CMA PDF onto Build your own comp set. The file is sent to the extract vendor with no search tools, never stored, and the rows land only after a confirm table. Spreadsheets are unchanged."
}
```

- [ ] **Step 3: Footnote the mapper spec**

Replace the out-of-scope bullet:

```
- PDF ingestion, despite the Ecosystem Plan's "CSV/PDF" phrasing. Same reason,
  larger.
```

with:

```
- PDF ingestion of **flyers / offering memos** (one property per file). Table
  PDFs (CoStar / ARGUS / CMA) shipped separately in
  `docs/superpowers/specs/2026-08-13-vault-pdf-import-design.md`.
```

Leave `.xlsx` out of scope as written.

- [ ] **Step 4: Run the full suite (docs-only, but `devlog.json` encoding is CI-gated)**

Run: `npm test`

Expected: PASS. If CI's mojibake check is local in `ci.yml`, a `node --check` is enough; do not ASCII-escape the entry.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md devlog.json docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md
git commit -m "Document vault PDF extract and the confirm table."
```

Also add the new spec and this plan if they are not already on the branch:

```bash
git add docs/superpowers/specs/2026-08-13-vault-pdf-import-design.md docs/superpowers/plans/2026-08-13-vault-pdf-import.md
```

only when those files are part of this work and not already committed. Do not stage `.superpowers/`, `.env`, or anyone else's WIP.

---

## Spec coverage (self-review)

| Spec section | Task |
| --- | --- |
| Table PDFs only; flyers out of scope | Task 5 `isPdfFile` + extract prompt; Task 6 mapper footnote |
| Model extract, no npm PDF parser | Task 2 + Task 3 |
| No search tools; no `buildRequestBody` | Task 2 tests |
| No silent vendor fallback | Task 3 `capabilities.pdfExtract` / missing key → 503 |
| Layout A confirm table | Task 5 `#pdfSec` |
| CSV path unchanged | Task 5 `isCsvFile` branch; existing tests |
| Confirm → `exportCsv` → `parseUpload` | Task 1 `uploadPayloadToCsv`, Task 4 handler |
| Unchecked rows never leave the browser | Task 5 Import collects checked only |
| PDF never stored | Task 3 writes nothing |
| Privacy copy names the vendor | Task 5 + Task 6, first-run test |
| 4 MB / 8 extract / 90 s | Task 1 `MAX_PDF_BYTES`, Task 3 rate limit + timeout |
| One file input | Task 5, existing first-run test |
| `.xlsx` refused with "Use a .csv or .pdf" | Task 5 page test |
| Extract 401/403/503 | Task 3 `routes.test.js` |
| Gemini generateContent, not Interactions | Task 2 |
