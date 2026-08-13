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
  for (const k of ["name", "logLabel", "defaultModel", "apiKeyEnv", "capabilities", "buildRequestBody",
                   "requestInit", "parseResponse", "normalizeUsage", "costOf", "deadlineTokens",
                   "buildExtractBody", "extractRequestInit", "parseExtractResponse"]) {
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

test("buildRequestBody nests the output cap under generation_config, never top-level", () => {
  const body = P.buildRequestBody({
    model: "gemini-3.6-flash", prompt: "PROMPT", maxComps: 12, searchUses: 10, stream: false,
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
  const cost = P.costOf(P.normalizeUsage(FIXTURE.usage));
  assert.ok(Math.abs(cost - 0.0618) < 0.01, `expected about $0.0618, got $${cost.toFixed(4)}`);
});

test("deadlineTokens returns a fixed figure, never max_output_tokens", () => {
  assert.equal(P.deadlineTokens(), 12000);
  // Must ignore the request body entirely: max_output_tokens (24k-32k) is
  // sized for thought tokens, not wall clock, and reading it here is the
  // exact bug this export exists to prevent.
  assert.equal(P.deadlineTokens({ max_output_tokens: 32000 }), 12000);
  assert.equal(P.deadlineTokens(undefined), 12000);
});

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
