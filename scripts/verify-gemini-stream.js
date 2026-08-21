#!/usr/bin/env node
"use strict";

// Confirm — or disprove — the Gemini streaming reader against the LIVE wire
// format, with one real call costing a fraction of a cent.
//
// It exists because the frame shape is documented only as "each event includes
// a type and JSON data", so search-provider-gemini.js's createStreamReader is
// written from the non-streaming body shape and is explicitly UNVERIFIED. A
// guessed parser fails closed (no text recovered, report errors out), which is
// safe but useless, and "paste me a curl transcript" puts a human in the loop
// of reading SSE frames. This runs the actual reader over the actual bytes and
// answers the only question that matters: did it recover the text?
//
// On failure it prints every frame type the reader did not recognize, plus the
// first raw frames, which is exactly what fixing the reader needs.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/verify-gemini-stream.js
//   ... --grounded     also enable google_search, so tool frames appear too
//   ... --dump         print every raw frame, not just the unrecognized ones
//
// When it passes: set capabilities.streaming = true in
// search-provider-gemini.js, delete streamingUnverified there and the
// STREAM_UNVERIFIED branch in server.js, and commit the frame sample it prints
// as a test fixture.

const P = require("../search-provider-gemini");

const args = process.argv.slice(2);
const GROUNDED = args.includes("--grounded");
const DUMP = args.includes("--dump");
const KEY = (process.env.GEMINI_API_KEY || "").trim();
const MODEL = (process.env.MODEL || P.defaultModel).trim();

if (!KEY) {
  console.error("GEMINI_API_KEY is required. This makes one real (tiny) API call.");
  process.exit(1);
}

// Deliberately a prompt that forces a JSON object of a known shape: the point
// is to prove the reader reassembles text faithfully, and a shape we can assert
// on is worth more than free-form prose.
const PROMPT = 'Return ONLY this JSON, no code fences: {"ok":true,"n":[1,2,3],"note":"streaming works"}';

// Same SSE framing server.js uses, inlined so this script depends on nothing.
async function* frames(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data); } catch (_) { yield { __unparseable: data.slice(0, 200) }; }
    }
  }
}

(async () => {
  const body = P.buildRequestBody({ model: MODEL, prompt: PROMPT, maxComps: 8, stream: true });
  if (!GROUNDED) delete body.tools;
  const init = P.requestInit({ apiKey: KEY, stream: true });

  console.log(`POST ${init.url}`);
  console.log(`model ${MODEL}${GROUNDED ? " (grounded)" : ""}\n`);

  const res = await fetch(init.url, {
    method: "POST", headers: init.headers, body: JSON.stringify(body),
  });
  const ctype = res.headers.get("content-type") || "";
  console.log(`HTTP ${res.status}  content-type: ${ctype}`);
  if (!res.ok) {
    console.error("\n⛔ Request failed:\n" + (await res.text()).slice(0, 1200));
    process.exit(1);
  }
  // The first thing to check, and easy to miss: if the server answered ordinary
  // JSON, `?alt=sse` / `stream:true` did not take and there is nothing to parse.
  if (!/event-stream/.test(ctype)) {
    console.error("\n⛔ Not an SSE response — the stream request was not honored.");
    console.error("   Body starts: " + (await res.text()).slice(0, 400));
    process.exit(1);
  }

  const reader = P.createStreamReader();
  const raw = [];
  const kinds = {};
  let events = 0;
  for await (const f of frames(res.body)) {
    raw.push(f);
    if (DUMP) console.log("  frame " + JSON.stringify(f).slice(0, 300));
    for (const ev of reader.push(f)) {
      events++;
      kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
      if (ev.kind === "error") console.error("  stream error event: " + ev.message);
    }
  }

  const text = reader.text();
  const missed = reader.unknown();

  console.log(`\nframes: ${raw.length}   normalized events: ${events}   ${JSON.stringify(kinds)}`);
  console.log(`unrecognized: ${missed.length ? missed.join(", ") : "none"}`);
  console.log(`\nrecovered text (${text.length} chars):\n${text.slice(0, 500) || "(EMPTY)"}\n`);

  let ok = false;
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    ok = parsed && parsed.ok === true && Array.isArray(parsed.n) && parsed.n.length === 3;
  } catch (_) { /* ok stays false */ }

  if (ok && !missed.length) {
    console.log("✅ PASS — the reader reassembled the model's JSON from the live stream.");
    console.log("   Next: set capabilities.streaming = true in search-provider-gemini.js,");
    console.log("   drop streamingUnverified and the STREAM_UNVERIFIED branch in server.js,");
    console.log("   and commit a frame sample as a fixture.");
    process.exit(0);
  }

  console.error("❌ FAIL — the reader did not recover the expected JSON.");
  if (missed.length) console.error("   Unrecognized frame types: " + missed.join(", "));
  console.error("\nFirst frames, verbatim — this is what a fix needs:");
  for (const f of raw.slice(0, 6)) console.error("  " + JSON.stringify(f).slice(0, 400));
  process.exit(1);
})().catch((e) => {
  console.error("⛔ " + (e && e.message));
  if (e && e.cause && e.cause.code) console.error("   cause: " + e.cause.code);
  process.exit(1);
});
