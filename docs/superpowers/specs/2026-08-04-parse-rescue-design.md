# Parse rescue: salvage or repair a malformed report instead of re-searching

Date: 2026-08-04
Status: approved (owner, in-session)

## Problem

When the model's report fails JSON.parse, `solo()` throws the whole attempt
away and silently re-runs the FULL search: another ~90 seconds and another
~$0.35, billed twice for one report. Measured on prod 2026-08-03: a Phoenix
search burned both attempts (308s, ~$0.70, error card); the owner's Meridian
Walgreens search ran 3m40s, consistent with one silent retry. The one failure
whose bytes were captured (local, 2026-08-03) was a COMPLETE valid report
followed by stray text containing a brace, which breaks parseCompJson's
first-`{`-to-last-`}` slice because the last `}` belongs to the junk.

## Goal

Rescue the already-paid-for attempt instead of re-searching. Two layers, each
degrading to today's behavior; the full retry in `solo()` stays as the final
net. Worst case drops from ~3m40s to ~100s; the observed common case becomes
invisible (no added latency, no added cost).

## Design

### Layer A: salvage the first balanced JSON object (free)

`extractFirstJsonObject(text)`: from the first `{`, walk with a string- and
escape-aware depth counter (the live-preview comp extractor's proven
technique) to the true matching `}`. In `parseCompJson`'s catch: salvage,
`JSON.parse`, and sanity-check `Array.isArray(result.comps)` — the report is
the only object either lane ever returns, so an early non-report object must
not be mistaken for it. On success: log
`Comp JSON salvaged: first balanced object parsed, N trailing chars discarded`
and return it (through `stripEmDashes`, as ever). Otherwise fall through to
the existing diagnostic log + rethrow.

### Layer B: repair call instead of re-search

In `callAnthropicOnce`, wrap the finish chain (parse -> expandCompKeys ->
normalize -> reconcile -> attachVerifiedAttribution). On SyntaxError, ONE
repair attempt:

- Guard: raw text longer than 500 chars (garbage deserves the full retry).
- Plain non-streaming Anthropic call: same MODEL, NO tools, its own timeout
  (90s), `max_tokens` matching the original call's cap.
- Prompt: the text was supposed to be one valid JSON object; return ONLY the
  corrected JSON object; preserve every field and value exactly; add nothing,
  invent nothing, output nothing outside the object.
- The repaired text runs through the SAME finish chain, so a repaired report
  is indistinguishable from a clean one (encoding expansion included).
- Log `Comp JSON repaired by follow-up call` on success. On ANY failure
  (fetch error, timeout, still unparseable), rethrow the ORIGINAL error so
  `solo()`'s full retry runs exactly as today.

Cost when triggered: roughly $0.05-0.08 and ~30-45s, versus ~$0.35 and ~90s
for the full retry it replaces.

### Unchanged

- `solo()`'s one full retry, and the "unexpected format" terminal error.
- The parse-failure byte-snippet diagnostic (2026-08-03) stays; all three
  layers log, so Render logs show which layer fires and how often.
- Client: nothing. Attempt 1's preview (summary + streamed comps) stays on
  screen through a rescue — those comps were real — and the 8s watchdog
  already covers the quiet repair stretch.

## Root-cause honesty

The Render log lines for the owner's failed searches are still unread (Render
was signed out). Layer A targets the one confirmed failure shape; Layer B
covers shapes not yet seen; the diagnostic keeps collecting evidence. If the
logs later reveal a different dominant mode, the layers still stand — they
are ordered cheapest-first and all degrade to today's behavior.

## Verification (zero cost)

Fetch-shim harness, three canned streams:
1. Complete report + trailing junk containing braces -> Layer A rescues:
   report renders, no retry event, "salvaged" log line.
2. Broken mid-JSON (comma removed) -> shim recognizes the tool-less repair
   request (no `tools` in body) and returns corrected JSON -> Layer B
   rescues: report renders, "repaired" log line, no full retry.
3. Healthy stream -> byte-identical behavior to today.
The failure cannot be forced on a live search; real-world confirmation is
the new log lines on prod traffic. Devlog entry ships with the change.
