"use strict";

// Gemini half of the provider seam. Same pure contract as
// search-provider-anthropic.js: no fetch, no timers, no env reads.
//
// Prices are per million tokens for gemini-3.7-flash. These are Google's
// INTRODUCTORY rate, in effect through 2026-12-31 ($0.75 in / $3.75 out);
// standard pricing ($1.50 / $7.50, the values this constant held until
// 2026-08-19) takes over 2027-01-01 and this must flip back then, or every
// report after that date will silently under-report cost by half. Google
// Search grounding is billed per query ($14/1,000) with 5,000 free per month
// across the Gemini 3 family, so at this volume grounding is free and is
// deliberately not modelled here. Revisit if report volume ever approaches
// that ceiling.
const USD_PER_MTOK = { input: 0.75, output: 3.75, cacheRead: 0.1875, cacheWrite: 0 };

const capabilities = {
  // google_search accepts NO max_uses. searchBudgetFor's 10-to-3 cut cannot be
  // applied, so a strong corpus still improves quality here but no longer
  // reduces spend. server.js must read this rather than assume a budget.
  searchBudget: false,
  // Verified against the live wire format 2026-08-29 with
  // `node scripts/verify-gemini-stream.js` (plain and --grounded). The first
  // guessed reader FAILED that run — the real stream is event_type-tagged
  // frames, not `{steps:[...]}` snapshots — which is exactly why this shipped
  // false behind a verifier instead of guessing on the default path. The
  // captured frames are committed as test/fixtures/gemini-stream-frames*.json
  // and the reader below is pinned against them.
  streaming: true,
  // Gemini caches implicitly and reports total_cached_tokens, but exposes no
  // breakpoint to place, so there is nothing for us to control.
  promptCaching: "implicit",
  // Thought tokens count toward OUTPUT here, and on this workload they dwarf
  // the report: a measured call spent 6,473 thought against 928 output, so
  // roughly seven of every eight tokens this provider generates are thinking.
  // Generation time scales with tokens generated, which makes this the single
  // largest wall-clock lever on the default provider - larger than everything
  // in the report JSON put together. It is exposed rather than pinned because
  // Google's own guidance calls the default level the best quality for
  // agentic work, so trading it down is a measurement (run-eval.js --compare),
  // not a hunch. server.js reads THINKING_LEVEL and validates against this
  // list; a provider with a null list is handed nothing.
  thinkingLevels: ["low", "medium", "high"],
  pdfExtract: true,
  // inline_data carries an image on the same call it carries a PDF.
  imageExtract: true,
};

function buildRequestBody({ model, prompt, maxComps, thinkingLevel, stream }) {
  return {
    model,
    input: prompt,
    tools: [{ type: "google_search" }],
    // Absent unless streaming, matching the Anthropic module's rule: an
    // explicit false would be a wire-level change to every existing call.
    ...(stream ? { stream: true } : {}),
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
    //
    // thinking_level is OMITTED unless the deployment set one, so the default
    // request stays byte-identical to what it was before the knob existed and
    // the vendor's own default (medium on 3.7 Flash) keeps applying. Lowering
    // it only ever reduces generated tokens, so deadlineTokens() below stays
    // a safe ceiling either way.
    generation_config: {
      max_output_tokens: maxComps > 8 ? 32000 : 24000,
      ...(thinkingLevel ? { thinking_level: thinkingLevel } : {}),
    },
  };
}

function requestInit({ apiKey, stream }) {
  return {
    // Streaming needs BOTH `?alt=sse` here and `stream: true` in the body; the
    // query parameter is what selects the SSE encoding of the response.
    url: "https://generativelanguage.googleapis.com/v1beta/interactions"
      + (stream ? "?alt=sse" : ""),
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
  };
}

// One shape for a PDF and for a screenshot: inline_data takes whichever media
// type the sniffed bytes reported, so there is nothing to branch on here.
function buildExtractBody({ model, prompt, fileBase64, mediaType }) {
  return {
    contents: [{
      parts: [
        { inline_data: { mime_type: mediaType || "application/pdf", data: fileBase64 } },
        { text: prompt },
      ],
    }],
    // Same smaller search-path cap: thought tokens count toward output, and
    // an Anthropic-sized 8k/10k truncates a table mid-array.
    generationConfig: { maxOutputTokens: 24000 },
  };
}

function extractRequestInit({ apiKey, model }) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
  };
}

function parseExtractResponse(data) {
  const cand = ((data || {}).candidates || [])[0] || {};
  const parts = ((cand.content || {}).parts) || [];
  const text = parts.filter((p) => p && typeof p.text === "string").map((p) => p.text).join("");
  const meta = (data && data.usageMetadata) || {};
  return {
    text: text.trim(),
    // generateContent uses finishReason (MAX_TOKENS); keep Interactions
    // `status: "incomplete"` in case that shape ever appears here.
    stopReason: cand.finishReason || (data && data.status) || "",
    usage: normalizeUsage({
      total_input_tokens: meta.promptTokenCount,
      total_output_tokens: meta.candidatesTokenCount,
      total_thought_tokens: meta.thoughtsTokenCount,
    }),
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

// ---------------------------------------------------------------------------
// Streaming reader — VERIFIED against the live wire format 2026-08-29
// (`node scripts/verify-gemini-stream.js`, plain and --grounded; the captured
// frames are committed as test/fixtures/gemini-stream-frames*.json). The
// stream is a sequence of event_type-tagged frames:
//
//   interaction.created        {interaction:{id, status:"in_progress", model}}
//   interaction.status_update  {interaction_id, status:"in_progress"}
//   step.start                 {index, step:{type}} — types observed: thought,
//                              model_output, google_search_call,
//                              google_search_result
//   step.delta                 {index, delta:{type, ...}} — thought_signature
//                              (opaque), text ({text}), google_search_call
//                              ({arguments:{queries:[...]}}),
//                              google_search_result ({result:[...]})
//   step.stop                  {index}
//   interaction.completed      {interaction:{status:"completed", usage:{...}}}
//
// The grounded call is where streaming BEATS the non-streaming body: the
// google_search_call delta carries the model's real query strings, so the
// browser's progress card can show them — parseResponse has nothing to read
// them from and honestly reports `searches: 0`.
//
// Three rules keep a shape drift survivable rather than silently wrong:
//   - report text is harvested ONLY from a model_output step's text deltas,
//     accumulated per step index. A thought delta that one day carries text
//     must never enter the report.
//   - text is accumulated per index and a re-sent superset REPLACES rather
//     than appends. No cumulative snapshot was observed live, but Google's
//     streaming APIs have historically sent both depending on the surface,
//     and appending a snapshot would duplicate the whole report — which
//     parses, and is wrong, which is the worst failure available here.
//   - every event_type, step type or delta type it does not understand is
//     recorded on `unknown()`, so the verifier can say WHICH frames were
//     missed instead of only that the text came out empty.
//
// Frames with no event_type fall through to the pre-verification handling
// (whole-or-partial interaction objects carrying a `steps` array), kept as a
// defensive fallback and still pinned by its own tests.
const STREAM_STEP_TYPES = new Set([
  "thought", "model_output", "google_search_call", "google_search_result",
]);

function createStreamReader() {
  const steps = new Map();        // index -> accumulated model_output text
  const stepTypes = new Map();    // index -> step type, from step.start
  const unknown = new Set();
  let stopReason = "";
  let started = false;

  const textOf = (step) => {
    if (!step || typeof step !== "object") return null;
    if (typeof step.text === "string") return step.text;
    if (!Array.isArray(step.content)) return null;
    return step.content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text).join("");
  };

  // Shared by the delta path and the legacy fallback. Snapshot vs delta: a
  // frame that already contains everything we hold is a resend, so replace and
  // emit only what it added. Otherwise it is new text, so append.
  const accumulate = (idx, t, out) => {
    const prev = steps.get(idx) || "";
    if (t.startsWith(prev) && t.length >= prev.length) {
      const added = t.slice(prev.length);
      steps.set(idx, t);
      if (added) out.push({ kind: "text", text: added });
    } else {
      steps.set(idx, prev + t);
      out.push({ kind: "text", text: t });
    }
  };

  return {
    push(ev) {
      const out = [];
      if (!ev || typeof ev !== "object") return out;

      // Vendor error, whatever it is wrapped in.
      const err = ev.error || (ev.type === "error" || ev.event_type === "error" ? ev : null);
      if (err && (err.message || err.code || err.status)) {
        const code = Number(err.code);
        out.push({ kind: "error", status: code === 429 || code === 503 ? 529 : "stream",
                   message: String(err.message || err.status || "unknown") });
        return out;
      }

      if (!started) { started = true; out.push({ kind: "start", usage: normalizeUsage(ev.usage) }); }

      const et = typeof ev.event_type === "string" ? ev.event_type : "";
      if (et) {
        if (et === "interaction.created" || et === "interaction.status_update"
          || et === "interaction.completed") {
          // Usage rides on the interaction object (the completed frame in
          // practice); a terminal status — anything but in_progress — is this
          // provider's stop_reason ("completed", or "incomplete" on
          // truncation, which downstream reads as Anthropic's "max_tokens").
          const it = ev.interaction || {};
          if (it.usage) out.push({ kind: "usage", usage: normalizeUsage(it.usage) });
          const status = String(it.status || ev.status || "");
          if (status && status !== "in_progress") {
            stopReason = status;
            out.push({ kind: "done", stopReason });
          }
          return out;
        }
        if (et === "step.start") {
          const type = String((ev.step && ev.step.type) || "");
          if (Number.isFinite(ev.index)) stepTypes.set(ev.index, type);
          if (!STREAM_STEP_TYPES.has(type)) unknown.add("step:" + (type || "?"));
          return out;
        }
        if (et === "step.stop") return out;
        if (et === "step.delta") {
          const d = (ev.delta && typeof ev.delta === "object") ? ev.delta : {};
          const stepType = stepTypes.get(ev.index) || "";
          if (d.type === "google_search_call" || stepType === "google_search_call") {
            const queries = (d.arguments && Array.isArray(d.arguments.queries))
              ? d.arguments.queries : [];
            for (const q of queries) {
              out.push({ kind: "search", query: typeof q === "string" ? q : "" });
            }
            return out;
          }
          if (d.type === "google_search_result" || stepType === "google_search_result") {
            out.push({ kind: "results", count: Array.isArray(d.result) ? d.result.length : null });
            return out;
          }
          // Reasoning is expected and carries no report text — and even if a
          // thought delta one day DOES carry text, it must not enter the
          // report, which is why the step type gates before the text check.
          if (d.type === "thought_signature" || stepType === "thought") return out;
          if (typeof d.text === "string" && (stepType === "model_output" || d.type === "text")) {
            accumulate(ev.index, d.text, out);
            return out;
          }
          unknown.add("delta:" + String(d.type || "?"));
          return out;
        }
        unknown.add(et);
        return out;
      }

      // ---- Legacy fallback: untagged frames, the pre-verification shapes ----
      if (ev.usage) out.push({ kind: "usage", usage: normalizeUsage(ev.usage) });
      if (typeof ev.status === "string" && ev.status) {
        stopReason = ev.status;
        out.push({ kind: "done", stopReason });
      }

      const incoming = Array.isArray(ev.steps) ? ev.steps
        : (ev.type === "model_output" || ev.content || typeof ev.text === "string") ? [ev]
        : null;
      if (!incoming) {
        if (ev.type) unknown.add(String(ev.type));
        else if (!ev.usage && !ev.status) unknown.add("(untyped frame: " + Object.keys(ev).join(",") + ")");
        return out;
      }

      incoming.forEach((step, i) => {
        if (!step || typeof step !== "object") return;
        if (step.type && step.type !== "model_output" && step.type !== "text") {
          // thought steps are expected and carry no report text.
          if (step.type !== "thought") unknown.add("step:" + String(step.type));
          return;
        }
        const t = textOf(step);
        if (t == null) return;
        accumulate(Number.isFinite(step.index) ? step.index : i, t, out);
      });
      return out;
    },
    // Must match parseResponse()'s join exactly — model_output steps in order,
    // joined with "\n", trimmed.
    text() {
      return [...steps.entries()].sort((a, b) => a[0] - b[0])
        .map(([, t]) => t).join("\n").trim();
    },
    unknown() { return [...unknown]; },
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
    // ...and reported SEPARATELY as well, because the fold above hides the one
    // number that explains this provider's wall clock: a measured call was 928
    // report tokens against 6,473 thought, so "output_tokens: 7,401" reads as a
    // gigantic report when it is a small report and a long think. Without the
    // split, a THINKING_LEVEL A/B cannot show WHY it got faster, only that it
    // did.
    // TRAP: this is a SUBSET of output_tokens, never an addition to it. Anyone
    // summing the two double-counts the thinking, and costOf would double the
    // bill. Report it as "of which", never as another column to add up.
    thought_tokens: n(u.total_thought_tokens),
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
// This figure is load-bearing beyond just sizing the deadline: on the
// non-streaming path (STREAM_ANTHROPIC=off — the default streams since
// 2026-08-29) STREAM_IDLE_MS, server.js's per-chunk idle watchdog, never
// applies, because that watchdog only exists inside the streaming branch. On
// that path the deadline derived from this number is the ONLY thing standing
// between a wedged call and a request that hangs forever.
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
  defaultModel: "gemini-3.7-flash",
  capabilities,
  buildRequestBody,
  requestInit,
  parseResponse,
  createStreamReader,
  normalizeUsage,
  costOf,
  deadlineTokens,
  buildExtractBody,
  extractRequestInit,
  parseExtractResponse,
  USD_PER_MTOK,
};
