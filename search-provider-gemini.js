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
    //
    // Must be NESTED under generation_config, not top-level. Verified against
    // the live API on 2026-08-10: all four top-level spellings
    // (max_output_tokens, maxOutputTokens, max_tokens, output_config) 400
    // with "Unknown parameter"; only generation_config.max_output_tokens is
    // accepted, and it is genuinely honored (a cap of 40 truncated the reply
    // to status "incomplete" with 2 output + 34 thought tokens; a cap of
    // 4,000 completed normally at 691 output + 130 thought).
    generation_config: { max_output_tokens: maxComps > 8 ? 32000 : 24000 },
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
    .map((s) => s.content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join(""))
    .join("\n");
  return {
    text: text.trim(),
    // Grounding query counts are not reported per call. Zero is honest here;
    // inventing a number would corrupt the searches figure in the log and in
    // the analytics event.
    searches: 0,
    // Gemini has no stop_reason field. It signals truncation through
    // `status: "incomplete"` instead of a completed status, so that value is
    // this provider's equivalent of Anthropic's stop_reason "max_tokens".
    // Verified live 2026-08-10: a generation_config.max_output_tokens cap of
    // 40 produced status "incomplete" with the text visibly cut off. Without
    // reading this, a truncated report looks identical to a model that
    // simply found nothing to report, a failure mode this project has
    // already been burned by once.
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

// NOT max_output_tokens. That ceiling (24k-32k) is sized to cover thought
// tokens, not wall clock, so deriving a deadline from it gives about 9 minutes
// on a model measured at roughly 37 seconds per report. A measured call spent
// 4,207 in / 928 out / 6,473 thought, so about 7,400 output-equivalent tokens
// is the real figure; 12,000 leaves headroom without inventing a 9 minute
// ceiling.
//
// This figure is load-bearing beyond just sizing the deadline: this provider
// has no streaming capability, so STREAM_IDLE_MS (server.js's per-chunk idle
// watchdog) never applies to it, that watchdog only exists inside the
// streaming branch. On Gemini's non-streaming path, the deadline derived from
// this number is the ONLY thing standing between a wedged call and a request
// that hangs forever.
function deadlineTokens() {
  return 12000;
}

module.exports = {
  name: "gemini",
  logLabel: "Gemini",
  apiKeyEnv: "GEMINI_API_KEY",
  // See the note on the Anthropic module. Gemini's failure mode is different
  // enough to be worth spelling out: a free-tier key authenticates and runs the
  // model fine, then 429s on every GROUNDED search, so the site looks half alive.
  billingHelp:
    "aistudio.google.com/apikey, and the Google Cloud billing account behind the project " +
    "that owns GEMINI_API_KEY. Search grounding requires a PAID-tier project: a free-tier " +
    "key authenticates and runs the model but 429s on every grounded search.",
  defaultModel: "gemini-3.6-flash",
  capabilities,
  buildRequestBody,
  requestInit,
  parseResponse,
  normalizeUsage,
  costOf,
  deadlineTokens,
  USD_PER_MTOK,
};
