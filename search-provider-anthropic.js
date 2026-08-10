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
  apiKeyEnv: "ANTHROPIC_API_KEY",
  defaultModel: "claude-sonnet-4-6",
  capabilities,
  buildRequestBody,
  requestInit,
  parseResponse,
  normalizeUsage,
  costOf,
  USD_PER_MTOK,
};
