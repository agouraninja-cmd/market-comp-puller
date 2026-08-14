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
