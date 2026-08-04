# Narrative Field Caps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap `summary`, `value_drivers`, `market_trend`, and `price_discovery.note` in the prompt, notes-style, cutting ~1,000 chars (~16%) from every fresh report's write phase.

**Architecture:** Prompt-text-only change inside `buildPrompt` (server.js). No parsing, normalization, client, or cache changes. Verification is one real billed search with length assertions, since a prompt-quality change cannot be proven with the fetch shim.

**Tech Stack:** Plain Node 18+. `npm test` does not cover the prompt; the billed search is the test.

**Spec:** `docs/superpowers/specs/2026-08-03-narrative-field-caps-design.md`

**Cautions:**
- A second Claude session shares this tree: stage explicit paths, read the staged diff before committing.
- server.js edits need a server restart before the verification search.
- No em dashes in any written output.
- Grep for the anchor strings rather than trusting line numbers; the file moves.

---

### Task 1: The four prompt edits

**Files:**
- Modify: `server.js` (`buildPrompt` only)

- [ ] **Step 1: Slim the summary schema line and write its cap rule**

Replace the schema line:

```js
    ...(compsOnly ? [] : [`  "summary": "2-3 sentence plain-English takeaway about the local market, understandable to a non-professional - lead with the single thing an owner most needs to know",`]),
```

with:

```js
    ...(compsOnly ? [] : [`  "summary": "",`]),
```

Then, directly after the two existing `"notes"` rule lines (the block that starts `"notes" = at most TWO short sentences`), add one new rule line (inside the same array of prompt lines, same string style):

```js
    // Same treatment as "notes" above, same reasoning: summary was measured at
    // 941 chars / 14.7% of a real report, and the excess was the same two
    // patterns - restating comp figures the table already carries, and
    // narrating the search the "search_radius" field already carries. The
    // honesty caveats other rules REQUIRE in summary keep a designated slot.
    ...(compsOnly ? [] : [`"summary" = plain English a non-professional understands: at most THREE short sentences, under about 450 characters total, in this order: (1) the single thing an owner most needs to know about this market right now; (2) the market-level read your comps support - market-level figures like a $/SF spread or a vacancy rate are welcome; (3) only if a rule above requires it, that caveat in ONE compact clause (comps beyond the window, a widened radius, a size mismatch, scarce verified data). Do NOT put in "summary": any individual comp's address, price, size, or date (the comp table carries those); lists of tenant or company names; or any account of your search process beyond that single caveat clause.`]),
```

- [ ] **Step 2: Cap value_drivers and market_trend**

In the long rule line that begins `"value_drivers" = 2 to 3 short strings`, replace:

```
"value_drivers" = 2 to 3 short strings, each ONE concrete factor currently pushing values up or down for ${type} properties in this specific area, drawn from what your searches actually found - name the factor specifically (a vacancy shift, new construction, a rate change, scarcity of a size class), never generic real-estate advice. "market_trend" = one sentence on which direction ${type} sale prices in this area have moved over the search window; use "" if your searches did not show this - do not guess.
```

with:

```
"value_drivers" = 2 to 3 short strings, each ONE concrete factor currently pushing values up or down for ${type} properties in this specific area, drawn from what your searches actually found - name the factor specifically (a vacancy shift, new construction, a rate change, scarcity of a size class), never generic real-estate advice. Each entry must stay under about 80 characters: the named factor and its direction, then stop - no explanations, no tenant or company name lists. "market_trend" = one SHORT sentence, under about 140 characters, on which direction ${type} sale prices in this area have moved over the search window; use "" if your searches did not show this - do not guess.
```

(The rest of that line, `"annual_price_trend_pct" = ...`, is untouched.)

- [ ] **Step 3: Cap the price_discovery note**

In the `"price_discovery"` rule line, replace:

```
"note" = 1 to 2 plain sentences on how open the market looks to pricing above recent comps and why,
```

with:

```
"note" = 1 to 2 short sentences, under about 200 characters total, on how open the market looks to pricing above recent comps and why,
```

- [ ] **Step 4: Syntax check**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --check server.js
```

Expected: exit 0.

---

### Task 2: Verification search (one real billed search, ~$0.36)

- [ ] **Step 1: Start the real server** (`preview_start` name `dev`; restart if already running so the new prompt loads).

- [ ] **Step 2: Run one search on a fresh address** (not in cache; e.g. an industrial address in a different market than today's Boise test). Drive via `javascript_tool` (read_page is blind on this app); the CONFIRM PROPERTY modal button is "Yes, run the report" (verified address) or "Run anyway" (unverified) - poll for either.

- [ ] **Step 3: Assert on the returned report** (read it from `search-cache.json` or the rendered page):
- `summary.length <= ~500` and no individual comp address/price restated
- every `value_drivers` entry `<= ~90` chars
- `market_trend.length <= ~160`
- `price_discovery.note.length <= ~220`
- any required caveat (window/radius/size/scarce data) still present when applicable
- total JSON size vs the 6,417-char Boise baseline

If a bound is blown by a small margin once, judge whether the content is tight (a 470-char summary with no banned patterns is a pass; a 700-char one is a fail requiring prompt wording iteration).

---

### Task 3: Docs, devlog, ship

- [ ] **Step 1: Update CLAUDE.md's output-composition note**

In the `STREAM_ANTHROPIC` section, replace the sentence:

```
Top-level, `summary` is 7-15% and
  `value_drivers` 6-12%, both still uncut if more is ever needed.
```

with:

```
Top-level, the four narrative fields (`summary`,
  `value_drivers`, `market_trend`, `price_discovery.note`) measured a
  combined 33% of one real report and were capped notes-style on
  2026-08-03 (~450/80-per-entry/140/200 chars), with the summary's required
  honesty caveats given a protected slot.
```

- [ ] **Step 2: Append the devlog entry** (top of `devlog.json`):

```json
{ "date": "2026-08-03", "type": "improvement", "title": "The report's narrative fields stop rambling", "details": "The market summary, value drivers, trend line, and price-discovery note were measured at a combined third of a real report's length, and the excess was the same two patterns the comp-notes cap killed last week: restating figures that already have their own column, and the model narrating its own search. All four now carry notes-style caps (three short sentences for the summary, one named factor per value driver, one short trend sentence, two short price-discovery sentences) with the bloat banned by name and the honesty caveats (comps beyond the window, a widened radius, scarce verified data) given a protected slot in the summary. Reports get several seconds faster to write and slightly cheaper; nothing the reader needs is lost because everything banned already lives elsewhere in the report.", "commit": "" }
```

- [ ] **Step 3: Commit** (explicit paths, read the staged diff first):

```powershell
git add server.js CLAUDE.md devlog.json
git diff --cached
git commit -m "Notes-style caps for summary, value_drivers, market_trend, price_discovery" -- server.js CLAUDE.md devlog.json
```

- [ ] **Step 4: Deploy and confirm**

```powershell
git push origin HEAD:main
```

Then confirm the live site picks it up. The prompt is server-side and invisible in HTML, so live proof is Render's deploy finishing; a `curl https://compninja.co/healthz` plus the Render deploy of the pushed commit is sufficient. (Do not run a live billed search just to re-prove what Task 2 proved locally.)

---

## Self-review notes

- Spec coverage: all four caps (Task 1), no max_tokens change (nothing touches it), honesty caveats protected (summary rule clause 3), CLAUDE.md update + devlog (Task 3), real-search verification with bounds (Task 2). No gaps.
- The summary rule is gated `compsOnly ? [] :` exactly like the schema line it describes, so the records lane (which has no summary) never sees it.
