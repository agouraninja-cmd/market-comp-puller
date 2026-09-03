"use strict";

const test = require("node:test");
const assert = require("node:assert");
const P = require("../search-provider-gemini");
const A = require("../search-provider-anthropic");
const FIXTURE = require("./fixtures/gemini-response.json");

test("defaults to gemini-3.8-flash", () => {
  assert.equal(P.defaultModel, "gemini-3.8-flash",
    "comp and market searches both take PROVIDER.defaultModel");
});

test("declares that it cannot cap the search budget", () => {
  assert.equal(P.name, "gemini");
  assert.equal(P.capabilities.searchBudget, false,
    "google_search takes no max_uses; server.js must branch on this");
  assert.equal(P.capabilities.streaming, true, "wire format verified live 2026-08-29");
  assert.equal(P.capabilities.promptCaching, "implicit");
});

test("exports the same surface as the Anthropic module", () => {
  for (const k of ["name", "logLabel", "defaultModel", "apiKeyEnv", "capabilities", "buildRequestBody",
                   "requestInit", "parseResponse", "normalizeUsage", "costOf", "deadlineTokens",
                   "buildExtractBody", "extractRequestInit", "parseExtractResponse"]) {
    assert.ok(k in P, `missing export: ${k}`);
    assert.equal(typeof P[k], typeof A[k], `export ${k} differs in type from anthropic`);
  }
});

test("buildRequestBody sends google_search and never sends max_uses", () => {
  const body = P.buildRequestBody({
    model: "gemini-3.7-flash", prompt: "PROMPT", maxComps: 12, searchUses: 10, stream: false,
  });
  assert.equal(body.model, "gemini-3.7-flash");
  assert.equal(body.input, "PROMPT");
  assert.deepEqual(body.tools, [{ type: "google_search" }]);
  assert.equal(JSON.stringify(body).includes("max_uses"), false,
    "google_search rejects max_uses; sending it would be a silent lie about the budget");
});

test("buildRequestBody nests the output cap under generation_config, never top-level", () => {
  const body = P.buildRequestBody({
    model: "gemini-3.7-flash", prompt: "PROMPT", maxComps: 12, searchUses: 10, stream: false,
  });
  assert.equal(body.generation_config.max_output_tokens, 32000,
    "the Interactions API only accepts the cap nested under generation_config");
  assert.equal("max_output_tokens" in body, false,
    "a top-level max_output_tokens 400s with Unknown parameter; this is the assertion " +
    "that would have caught the live-pipeline defect before it shipped");
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
  // $0.0618 was USD_PER_MTOK's standard rate ($1.50/$7.50); the constant now
  // holds Google's introductory rate ($0.75/$3.75, in effect through
  // 2026-12-31), which is exactly half.
  const cost = P.costOf(P.normalizeUsage(FIXTURE.usage));
  assert.ok(Math.abs(cost - 0.0309) < 0.01, `expected about $0.0309, got $${cost.toFixed(4)}`);
});

test("deadlineTokens returns a fixed figure, never max_output_tokens", () => {
  assert.equal(P.deadlineTokens(), 12000);
  // Must ignore the request body entirely: max_output_tokens (24k-32k) is
  // sized for thought tokens, not wall clock, and reading it here is the
  // exact bug this export exists to prevent.
  assert.equal(P.deadlineTokens({ max_output_tokens: 32000 }), 12000);
  assert.equal(P.deadlineTokens(undefined), 12000);
});

test("buildExtractBody carries a screenshot on the same inline_data part as a PDF", () => {
  assert.equal(P.capabilities.imageExtract, true);
  for (const media of ["image/png", "image/jpeg", "image/webp"]) {
    const body = P.buildExtractBody({
      model: "gemini-3.6-flash", prompt: "EXTRACT",
      fileBase64: "AAA", mediaType: media,
    });
    assert.equal(body.contents[0].parts[0].inline_data.mime_type, media);
    assert.equal(body.contents[0].parts[0].inline_data.data, "AAA");
    assert.equal("tools" in body, false);
  }
});

test("declares pdfExtract and buildExtractBody has no google_search", () => {
  assert.equal(P.capabilities.pdfExtract, true);
  const body = P.buildExtractBody({
    model: "gemini-3.6-flash", prompt: "EXTRACT",
    fileBase64: "AAA", mediaType: "application/pdf",
  });
  assert.equal("tools" in body, false);
  const wire = JSON.stringify(body);
  assert.equal(wire.includes("google_search"), false);
  assert.equal(wire.includes("web_search"), false);
  assert.equal(body.contents[0].parts[0].inline_data.mime_type, "application/pdf");
  assert.equal(body.contents[0].parts[0].inline_data.data, "AAA");
  assert.equal(body.contents[0].parts[1].text, "EXTRACT");
  assert.equal(body.generationConfig.maxOutputTokens, 24000,
    "thought tokens count toward output; 8192 truncates a table mid-array");
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
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 20 },
  });
  assert.equal(out.text, "[{\"address\":\"1 Main\"}]");
  assert.equal(out.usage.input_tokens, 10);
  assert.equal(out.usage.output_tokens, 4 + 20,
    "thought tokens fold into output, same as search");
  assert.equal(out.stopReason, "");
});

test("parseExtractResponse surfaces generateContent finishReason, including MAX_TOKENS", () => {
  const out = P.parseExtractResponse({
    candidates: [{
      finishReason: "MAX_TOKENS",
      content: { parts: [{ text: "[{\"address\":\"1 Main\"}" }] },
    }],
  });
  assert.equal(out.stopReason, "MAX_TOKENS");
});

test("parseExtractResponse also reads Interactions-style incomplete status", () => {
  const out = P.parseExtractResponse({
    status: "incomplete",
    candidates: [{ content: { parts: [{ text: "[" }] } }],
  });
  assert.equal(out.stopReason, "incomplete");
});

// --- thinking level ----------------------------------------------------------
// Thought tokens are billed and generated as OUTPUT here, and on this workload
// they are roughly seven of every eight tokens the model produces (a measured
// call: 928 output against 6,473 thought). That makes this the biggest
// wall-clock setting the deployment has, so the two properties worth pinning
// are that it reaches the wire in the one place Google accepts it, and that
// leaving it unset changes nothing at all.

test("an unset thinking level leaves the request byte-identical", () => {
  const args = { model: "gemini-3.7-flash", prompt: "PROMPT", maxComps: 8 };
  const before = P.buildRequestBody(args);
  for (const level of ["", null, undefined]) {
    const body = P.buildRequestBody({ ...args, thinkingLevel: level });
    assert.deepEqual(body, before,
      `thinkingLevel=${JSON.stringify(level)} must not add a field; the vendor default has to keep applying`);
    assert.equal("thinking_level" in body.generation_config, false);
  }
});

test("a thinking level rides in generation_config, beside max_output_tokens", () => {
  const body = P.buildRequestBody({
    model: "gemini-3.7-flash", prompt: "PROMPT", maxComps: 8, thinkingLevel: "low",
  });
  // Same nesting trap max_output_tokens has: every top-level spelling 400s.
  assert.equal(body.thinking_level, undefined, "top-level thinking_level is rejected by the API");
  assert.equal(body.generation_config.thinking_level, "low");
  assert.equal(body.generation_config.max_output_tokens, 24000,
    "the output ceiling must survive alongside it");
});

test("the tunable levels are declared so server.js never branches on the name", () => {
  assert.deepEqual(P.capabilities.thinkingLevels, ["low", "medium", "high"]);
  assert.equal(A.capabilities.thinkingLevels, null,
    "anthropic declares null so a THINKING_LEVEL set against it is refused, not ignored");
});

test("lowering the thinking level cannot outrun the deadline budget", () => {
  // deadlineTokens is sized from a measured thought+output total. Thinking less
  // only ever generates fewer tokens, so the ceiling stays safe in the one
  // direction this knob moves.
  assert.equal(P.deadlineTokens(), 12000);
});

test("thought tokens are reported alongside output, not instead of or on top of it", () => {
  const u = P.normalizeUsage(FIXTURE.usage);
  assert.equal(u.thought_tokens, 6473, "the split is what explains this provider's wall clock");
  assert.equal(u.output_tokens, 928 + 6473, "output still folds them in, because they bill as output");
  // The trap: thought_tokens is a SUBSET of output_tokens. Adding them would
  // double the bill and double-count the thinking in any scorecard.
  assert.ok(u.thought_tokens < u.output_tokens);
  assert.equal(u.output_tokens - u.thought_tokens, 928, "the remainder is the report itself");
});

test("both providers normalize to the same keys, so a scorecard can average them", () => {
  assert.deepEqual(Object.keys(P.normalizeUsage({})).sort(),
                   Object.keys(A.normalizeUsage({})).sort(),
                   "a key present on one provider and undefined on the other poisons an average");
});

// --- streaming reader (wire format VERIFIED live 2026-08-29) -----------------
// scripts/verify-gemini-stream.js passed plain and --grounded, and the frames
// those calls actually sent are committed as fixtures below — the new ground
// truth. The earlier guessed-shape tests stay: untagged frames still fall
// through to that handling, and the invariants they pin (snapshot replaces,
// only new characters emitted) hold on the verified delta path too.
const STREAM_FRAMES = require("./fixtures/gemini-stream-frames.json");
const STREAM_FRAMES_GROUNDED = require("./fixtures/gemini-stream-frames-grounded.json");

test("streaming is ON, and the unverified opt-in flag is gone", () => {
  assert.equal(P.capabilities.streaming, true,
    "verified live 2026-08-29; server.js streams this provider by default");
  assert.equal(P.capabilities.streamingUnverified, undefined,
    "the flag must be GONE, not false — a lingering flag invites the STREAM_UNVERIFIED branch back");
});

test("the live plain-call frames replay into the expected text and events", () => {
  const r = P.createStreamReader();
  const kinds = {};
  for (const f of STREAM_FRAMES) {
    for (const ev of r.push(f)) kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
  }
  assert.equal(r.text(), '{"ok":true,"n":[1,2,3],"note":"streaming works"}');
  assert.deepEqual(r.unknown(), [], "every live frame type must be recognized");
  assert.equal(kinds.start, 1);
  assert.equal(kinds.done, 1,
    "in_progress status updates must NOT emit done; only the completed frame does");
  assert.equal(kinds.usage, 1, "usage rides the interaction.completed frame");
});

test("the live grounded frames yield search queries, a result count, and the text", () => {
  const r = P.createStreamReader();
  const out = [];
  for (const f of STREAM_FRAMES_GROUNDED) out.push(...r.push(f));
  const searches = out.filter((e) => e.kind === "search");
  assert.equal(searches.length, 2, "google_search_call deltas carry the real query list");
  for (const s of searches) assert.match(s.query, /Boise/);
  const results = out.filter((e) => e.kind === "results");
  assert.equal(results.length, 1);
  assert.ok(Number.isFinite(results[0].count));
  assert.equal(r.text(), '{"ok":true,"population":238429}');
  assert.deepEqual(r.unknown(), [],
    "tool and thought frames are expected, not unrecognized");
  const done = out.filter((e) => e.kind === "done");
  assert.deepEqual(done.map((e) => e.stopReason), ["completed"]);
});

test("the completed frame's usage folds thought tokens the same way parseResponse does", () => {
  const r = P.createStreamReader();
  let usage = null;
  for (const f of STREAM_FRAMES) {
    for (const ev of r.push(f)) if (ev.kind === "usage") usage = ev.usage;
  }
  assert.equal(usage.input_tokens, 28);
  assert.equal(usage.thought_tokens, 147);
  assert.equal(usage.output_tokens, 18 + 147,
    "thought folds into output — same rule as normalizeUsage everywhere else");
});

test("a thought delta carrying text never enters the report", () => {
  // Not observed live — thought deltas carry only opaque signatures today —
  // but reasoning text leaking into parseCompJson's input would be a report
  // built partly from the model talking to itself, so the step type gates
  // before the text check does.
  const r = P.createStreamReader();
  r.push({ index: 0, step: { type: "thought" }, event_type: "step.start" });
  const out = r.push({ index: 0, delta: { text: "let me think about comps" }, event_type: "step.delta" });
  assert.deepEqual(out, []);
  assert.equal(r.text(), "");
  assert.deepEqual(r.unknown(), [], "a thought delta is expected, not unrecognized");
});

test("an unrecognized event_type or delta type is RECORDED, not silently dropped", () => {
  const r = P.createStreamReader();
  r.push({ event_type: "interaction.some_future_event", payload: 1 });
  r.push({ index: 0, step: { type: "url_context_call" }, event_type: "step.start" });
  r.push({ index: 1, step: { type: "model_output" }, event_type: "step.start" });
  r.push({ index: 1, delta: { type: "some_future_delta" }, event_type: "step.delta" });
  assert.deepEqual(r.unknown().sort(), [
    "delta:some_future_delta",
    "interaction.some_future_event",
    "step:url_context_call",
  ]);
});

test("streaming is requested in BOTH places the API needs it", () => {
  // Either one alone silently yields ordinary JSON, which the reader cannot
  // parse and which looks like a broken model rather than a bad request.
  assert.equal(P.requestInit({ apiKey: "k", stream: true }).url.endsWith("?alt=sse"), true);
  assert.equal(P.buildRequestBody({ model: "m", prompt: "p", maxComps: 8, stream: true }).stream, true);
  // ...and absent entirely when not streaming, so every existing call is
  // byte-identical to before this shipped.
  assert.equal(P.requestInit({ apiKey: "k" }).url.includes("alt=sse"), false);
  assert.equal("stream" in P.buildRequestBody({ model: "m", prompt: "p", maxComps: 8 }), false);
});

test("the streamed text matches what parseResponse would produce", () => {
  const r = P.createStreamReader();
  r.push({ steps: [{ type: "thought", signature: "x" }] });
  r.push({ steps: [{ type: "model_output", content: [{ type: "text", text: '{"ok":' }] }] });
  r.push({ steps: [{ type: "model_output", content: [{ type: "text", text: "true}" }] }] });
  const nonStreaming = P.parseResponse({
    steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text: '{"ok":true}' }] }],
  });
  assert.equal(r.text(), nonStreaming.text);
  assert.deepEqual(r.unknown(), [], "a thought step is expected, not unrecognized");
});

test("a re-sent snapshot replaces rather than appends", () => {
  // Google's streaming surfaces have historically sent both deltas and
  // cumulative snapshots. Appending a snapshot duplicates the whole report —
  // which still PARSES, and is wrong, which is the worst failure available.
  const r = P.createStreamReader();
  r.push({ steps: [{ type: "model_output", index: 0, content: [{ type: "text", text: '{"a":1' }] }] });
  r.push({ steps: [{ type: "model_output", index: 0, content: [{ type: "text", text: '{"a":1,"b":2}' }] }] });
  assert.equal(r.text(), '{"a":1,"b":2}', "must not become {\"a\":1{\"a\":1,\"b\":2}");
});

test("only the newly-arrived characters are emitted as text events", () => {
  // The live comp extractor is fed these; re-emitting a snapshot whole would
  // make it re-scan and double-count every comp it had already seen.
  const r = P.createStreamReader();
  const a = r.push({ steps: [{ type: "model_output", index: 0, content: [{ type: "text", text: "abc" }] }] });
  const b = r.push({ steps: [{ type: "model_output", index: 0, content: [{ type: "text", text: "abcdef" }] }] });
  assert.deepEqual(a.filter((e) => e.kind === "text").map((e) => e.text), ["abc"]);
  assert.deepEqual(b.filter((e) => e.kind === "text").map((e) => e.text), ["def"]);
});

test("an unrecognized frame is RECORDED, not silently dropped", () => {
  // The whole point: when the guess is wrong, the verifier must be able to say
  // WHICH frames were missed, not merely that the text came out empty.
  const r = P.createStreamReader();
  r.push({ type: "some_future_event", payload: 1 });
  r.push({ steps: [{ type: "tool_call", name: "google_search" }] });
  assert.deepEqual(r.unknown().sort(), ["some_future_event", "step:tool_call"]);
  assert.equal(r.text(), "");
});

test("usage and a terminal status surface as normalized events", () => {
  const r = P.createStreamReader();
  const out = r.push({ usage: { total_input_tokens: 10, total_output_tokens: 5, total_thought_tokens: 3 },
                       status: "completed" });
  assert.equal(out.find((e) => e.kind === "start").kind, "start");
  assert.equal(out.find((e) => e.kind === "usage").usage.thought_tokens, 3);
  assert.equal(out.find((e) => e.kind === "done").stopReason, "completed");
});

test("a vendor error frame maps onto the shared error contract", () => {
  const r = P.createStreamReader();
  const out = r.push({ error: { code: 429, message: "rate limited" } });
  assert.equal(out[0].kind, "error");
  assert.equal(out[0].status, 529, "429/503 become the busy status the handler knows");
  assert.equal(out[0].message, "rate limited");
});

test("both providers expose the same reader contract", () => {
  for (const mod of [P, A]) {
    const r = mod.createStreamReader();
    assert.equal(typeof r.push, "function");
    assert.equal(typeof r.text, "function");
    assert.deepEqual(r.push(null), [], "junk must never throw out of a read loop");
    assert.equal(r.text(), "");
  }
});
