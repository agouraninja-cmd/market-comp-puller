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
    input_tokens: 3300, output_tokens: 4100, thought_tokens: 0,
    cache_read_tokens: 26400, cache_write_tokens: 3300,
  });
});

test("normalizeUsage is total about missing fields rather than returning undefined", () => {
  assert.deepEqual(P.normalizeUsage(undefined), {
    input_tokens: 0, output_tokens: 0, thought_tokens: 0,
    cache_read_tokens: 0, cache_write_tokens: 0,
  });
});

test("costOf prices cache reads far below fresh input", () => {
  const cheap = P.costOf({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 1e6, cache_write_tokens: 0 });
  const dear = P.costOf({ input_tokens: 1e6, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  assert.ok(cheap < dear / 5, `cache read ${cheap} should be far under input ${dear}`);
  assert.ok(Math.abs(P.costOf({ input_tokens: 0, output_tokens: 1e6, cache_read_tokens: 0, cache_write_tokens: 0 }) - 15) < 0.001);
});

test("deadlineTokens reads the real max_tokens cap off the body", () => {
  assert.equal(P.deadlineTokens({ max_tokens: 10000 }), 10000);
  assert.equal(P.deadlineTokens({ max_tokens: 8000 }), 8000);
});

test("deadlineTokens falls back to 8000 when the body is missing or has no cap", () => {
  assert.equal(P.deadlineTokens(undefined), 8000);
  assert.equal(P.deadlineTokens({}), 8000);
});

test("declares pdfExtract and buildExtractBody has no tools", () => {
  assert.equal(P.capabilities.pdfExtract, true);
  const body = P.buildExtractBody({
    model: "claude-sonnet-4-6", prompt: "EXTRACT",
    fileBase64: "AAA", mediaType: "application/pdf",
  });
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

test("declares imageExtract and sends a screenshot as an image block, not a document", () => {
  assert.equal(P.capabilities.imageExtract, true);
  for (const media of ["image/png", "image/jpeg", "image/webp"]) {
    const body = P.buildExtractBody({
      model: "claude-sonnet-4-6", prompt: "EXTRACT",
      fileBase64: "AAA", mediaType: media,
    });
    const blocks = body.messages[0].content;
    assert.equal(blocks[0].type, "image",
      `${media} in a document block is a 400 from the vendor, not a read table`);
    assert.equal(blocks[0].source.media_type, media);
    assert.equal(blocks[0].source.data, "AAA");
    assert.equal(blocks[1].text, "EXTRACT");
    assert.equal("tools" in body, false);
  }
});

test("parseExtractResponse keeps text, usage, and stop_reason", () => {
  const out = P.parseExtractResponse(FIXTURE);
  assert.equal(out.text, "Here is the report.\n{\"comps\":[]}");
  assert.equal(out.stopReason, "end_turn");
  assert.equal(out.usage.input_tokens, 3300);
  assert.equal(out.usage.output_tokens, 4100);
});

test("parseExtractResponse surfaces stop_reason max_tokens so truncation is visible", () => {
  const out = P.parseExtractResponse({
    stop_reason: "max_tokens",
    content: [{ type: "text", text: "[{\"address\":\"1 Main\"}" }],
    usage: { input_tokens: 100, output_tokens: 8000 },
  });
  assert.equal(out.stopReason, "max_tokens");
});

// --- streaming reader -------------------------------------------------------
// Extracted from server.js 2026-08-21, where it had never had a test. The
// invariant worth pinning is not "does it parse events" but "do the streaming
// and non-streaming paths hand parseCompJson the SAME STRING" — a drift there
// shows up as "the report is fine unless streaming is on", which is close to
// undebuggable from a bug report.

// One realistic conversation: search block, its result, then two text blocks.
const STREAM_FRAMES = [
  { type: "message_start", message: { usage: { input_tokens: 3300, cache_read_input_tokens: 26400 } } },
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use" } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"industrial ' } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'sales Dallas TX"}' } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", content: [1, 2, 3] } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: '{"summary":"ok",' } },
  // citations_delta rides on text blocks and carries no .text — it must not
  // fall through into the text branch and emit undefined.
  { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: { url: "https://x" } } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: '"comps":[]}' } },
  { type: "content_block_stop", index: 2 },
  { type: "content_block_start", index: 3, content_block: { type: "text" } },
  { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: "trailing" } },
  { type: "content_block_stop", index: 3 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4100 } },
];

function drain(frames) {
  const r = P.createStreamReader();
  const events = [];
  for (const f of frames) events.push(...r.push(f));
  return { reader: r, events };
}

test("the streamed text is byte-identical to the non-streaming text", () => {
  const { reader } = drain(STREAM_FRAMES);
  // The same conversation as a non-streaming body.
  const nonStreaming = P.parseResponse({
    stop_reason: "end_turn",
    content: [
      { type: "server_tool_use", input: { query: "industrial sales Dallas TX" } },
      { type: "web_search_tool_result", content: [1, 2, 3] },
      { type: "text", text: '{"summary":"ok","comps":[]}' },
      { type: "text", text: "trailing" },
    ],
  });
  assert.equal(reader.text(), nonStreaming.text,
    "streaming and non-streaming must feed parseCompJson the same string");
  assert.equal(reader.text(), '{"summary":"ok","comps":[]}\ntrailing');
});

test("the reader emits the progress vocabulary the loading card runs on", () => {
  const { events } = drain(STREAM_FRAMES);
  const kinds = events.map((e) => e.kind);
  assert.deepEqual([...new Set(kinds)].sort(),
    ["done", "results", "search", "start", "text", "usage"]);
  // The query is only knowable once the tool block CLOSES — content_block_start
  // carries input:{}, so reading it early yields "".
  assert.deepEqual(events.filter((e) => e.kind === "search"),
    [{ kind: "search", query: "industrial sales Dallas TX" }]);
  assert.equal(events.find((e) => e.kind === "results").count, 3);
  assert.equal(events.find((e) => e.kind === "done").stopReason, "end_turn");
  // Only real text deltas; the citations_delta must not have produced one.
  assert.deepEqual(events.filter((e) => e.kind === "text").map((e) => e.text),
    ['{"summary":"ok",', '"comps":[]}', "trailing"]);
});

test("a truncated tool block yields an empty query, never a thrown SyntaxError", () => {
  // A raw throw here would make solo() conclude the REPORT failed to parse and
  // silently re-bill an entire search.
  const { events } = drain([
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"half' } },
    { type: "content_block_stop", index: 0 },
  ]);
  assert.deepEqual(events, [{ kind: "search", query: "" }]);
});

test("a mid-stream error is normalized, and overloaded becomes a 529", () => {
  const plain = P.createStreamReader().push({ type: "error", error: { type: "api_error", message: "boom" } });
  assert.deepEqual(plain, [{ kind: "error", status: "stream", message: "boom" }]);
  const over = P.createStreamReader().push({ type: "error", error: { type: "overloaded_error" } });
  assert.equal(over[0].status, 529, "the 529 that never got a status line");
});

test("junk frames and unknown types are ignored rather than fatal", () => {
  const r = P.createStreamReader();
  for (const junk of [null, undefined, "nope", 42, {}, { type: "ping" },
                      { type: "content_block_delta", index: 99, delta: { type: "text_delta", text: "orphan" } }]) {
    assert.deepEqual(r.push(junk), [], `frame ${JSON.stringify(junk)} should emit nothing`);
  }
  assert.equal(r.text(), "", "an orphan delta for an unopened block contributes no text");
});
