# Thin-Preview Free-Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only a permanently published market page spends an anonymous visitor's one free search; a thin-data preview costs them nothing, and previews become visible in analytics.

**Architecture:** Two edits in `server.js`'s `POST /api/explore-market`: gate the `consumeGuestSearchFor` call on `out.published === true`, and log a PII-free `explore_preview` event where the preview is stored. No new module, no migration, no client change.

**Tech Stack:** Plain Node 18+ (zero npm dependencies). Verification uses a hand-written `fetch` shim, no test framework.

**Spec:** `docs/superpowers/specs/2026-08-09-thin-preview-free-search-design.md`

## Global Constraints

- `server.js` and `devlog.json` only. No client change, no migration, no new module, no npm dependency.
- The covered-market short circuit must keep returning free and ungated from above the guest gate; do not move it.
- Do not touch the guest gate itself, the city check, either rate limiter, or the SSE-versus-JSON split.
- The `explore_preview` event must be PII-free and fit the fixed analytics columns: `prop_type`, `market` (city + state only), `source`.
- `devlog.json`: edit with the Edit tool, never PowerShell; clean UTF-8, raw em dashes are correct, never escape them.
- Shared checkout: another session works in this repo. `git status --short` before staging, stage explicit paths only, never `git add -A`.
- This code path is unreachable while `ACCOUNT_WALL` is on (the wall forces `GUEST_SEARCH_LIMIT` to 0, so anonymous visitors are blocked before the search). That is why Task 2 boots with `ACCOUNT_WALL=off` and `GUEST_SEARCH_LIMIT=1`.

---

### Task 1: The consume condition and the preview event

**Files:**
- Modify: `server.js` (two spots inside `POST /api/explore-market`: the preview return at ~line 9293, the consume line at ~line 9322)
- Modify: `devlog.json` (one new entry)

**Interfaces:**
- Consumes: existing `consumeGuestSearchFor(gate, req, res, headersOpen)` and `logEvent(kind, dims)`.
- Produces: `/api/explore-market` now consumes the guest allowance only when the served body carries `published: true`; a served preview emits an `explore_preview` analytics row.

Line numbers are as of commit `f3de052`; match on the quoted code, not the numbers.

- [ ] **Step 1: Log the preview**

Find (inside the `joinExploreJob` callback, at the end):

```js
            previewPagesMem.set(slug, { payload: snapshot, ts: Date.now() });
            return { status: 200, body: { url: `/market-preview/${slug}`, slug, published: false, pricedSaleCount } };
```

Replace with:

```js
            previewPagesMem.set(slug, { payload: snapshot, ts: Date.now() });
            // Thin markets are invisible in analytics otherwise: a preview and a
            // published page log the same `search` row. Since a preview no
            // longer spends the visitor's free search (see the consume line
            // below), the thin-market rate is what says whether previews are
            // becoming a spend sink, and whether MIN_PRICED_SALE_COMPS sits in
            // the right place. PII-free, same shape as `explore_reject`.
            logEvent("explore_preview", { prop_type: typeOk, market: address, source: "explore" });
            return { status: 200, body: { url: `/market-preview/${slug}`, slug, published: false, pricedSaleCount } };
```

- [ ] **Step 2: Gate the consume on a published page**

Find:

```js
        // Spent only when a result was actually served — a published page or a
        // thin-data preview, both of which cost a real search and return real
        // content. A 422 thin market, a 429 daily cap or an upstream failure
        // must never burn the visitor's free search.
        if (status === 200) consumeGuestSearchFor(guestGate, req, res, Boolean(sse));
```

Replace with:

```js
        // Spent only when a PERMANENT page was published. A thin-data preview
        // returns 200 with a URL, but it lives only in previewPagesMem behind a
        // 30-minute TTL and dies on every restart, so charging the visitor's one
        // free search for it handed them an artifact that was often already
        // gone. It is the same empty-handed outcome as a 422 thin market, a 429
        // daily cap or an upstream failure, none of which consume either.
        // Keeping the allowance also makes the preview self-healing: exploring
        // that market again is a search_cache hit, so it costs nothing upstream
        // and regenerates the page.
        // The covered-market short circuit never reaches this line — it returns
        // from above the guest gate, and serving an existing page stays free.
        if (status === 200 && out.published === true) {
          consumeGuestSearchFor(guestGate, req, res, Boolean(sse));
        }
```

- [ ] **Step 3: Devlog entry**

Add as the FIRST entry of the array in `devlog.json` (rebuild-don't-patch if another session's entry is in flight, per the shared-checkout skill):

```json
{
  "date": "2026-08-09",
  "type": "fix",
  "title": "A limited-data market preview stops spending the free search",
  "details": "When the Explorer finds too few priced sales to publish a market page, it shows a temporary preview that lives 30 minutes and does not survive a redeploy. That still counted as the one free search an account-less visitor gets, so they could spend their single allowance on a link that was already gone. Only a permanently published page counts now, matching every other empty-handed outcome (too little data, daily cap, upstream failure), and because the allowance survives, re-exploring that market is free and instant from cache and simply rebuilds the preview. Previews are also logged as their own analytics event, so the thin-market rate is finally visible rather than hiding inside the ordinary search count. Note this is a latent fix: the account wall currently blocks anonymous searches before this code runs, so it matters when the wall is rolled back."
}
```

- [ ] **Step 4: Syntax check and suite**

Run: `node --check server.js` then `npm test`
Expected: both clean. (The suite does not exercise this route's consume path; it is here to prove nothing else broke.)

- [ ] **Step 5: Commit**

```bash
git status --short
git add server.js devlog.json
git commit -m "Explorer: a thin-data preview no longer spends the guest's free search"
```

---

### Task 2: Fetch-shim verification, both directions

**Files:**
- Create: `<scratchpad>/shim-boot.js` (throwaway harness, NOT committed — the repo's precedent keeps these in session scratch)

**Interfaces:**
- Consumes: Task 1's behavior through the running server.
- Produces: a pass/fail transcript in the task report; no code, no commits.

The harness fakes the Anthropic API so nothing is billed and no API key is needed. It follows the repo's existing pattern: wrap `globalThis.fetch` before requiring `server.js`, run with `STREAM_ANTHROPIC=off`, and blank the Supabase variables with a **single space** so the built-in `.env` loader cannot override them (`SUPABASE_URL` is `.trim()`ed, so a space reads as unconfigured and `DB_CONFIGURED` is false).

- [ ] **Step 1: Write the harness**

Create `shim-boot.js` in this session's scratchpad directory. Replace `<WORKTREE>` with the absolute path of the worktree this plan is being executed in (forward slashes):

```js
// Throwaway harness: boots server.js against a FAKE Anthropic API so the
// Explorer's thin-preview path can be exercised with zero spend.
// FAKE_SALES controls how many priced sale comps the canned report carries:
// 2 => below MIN_PRICED_SALE_COMPS (3) => preview; 3 => published page.
const ROOT = "<WORKTREE>";
process.chdir(ROOT);

const sales = Number(process.env.FAKE_SALES || 2);
const comps = [];
for (let i = 0; i < sales; i++) {
  comps.push({
    address: `${100 + i} Main St, Twin Falls, ID 83301`,
    date: "Mar 2026",
    transaction: "Sale",
    size_sqft: "20000",
    price_or_rate: "$3,000,000",
    price_per_sqft: "150",
    // A bot-walled host on link-check.js's list: never fetched, never demoted,
    // so the link check makes no network call and cannot demote these comps.
    source_url: "https://www.loopnet.com/Listing/fake-harness",
    source_type: "listing",
    notes: "Canned harness comp.",
  });
}
const report = {
  summary: "Canned harness summary.",
  market_trend: "Flat.",
  value_drivers: ["Canned driver"],
  market_cap_rate_range: { low: "6.0%", high: "7.0%" },
  comps,
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("api.anthropic.com")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify(report) }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: "end_turn",
      }),
    };
  }
  // The city check only reads `.status`; 200 means "real city".
  if (u.includes("zippopotam.us")) return { ok: true, status: 200, json: async () => ({}) };
  return realFetch(url, opts);
};

process.env.ANTHROPIC_API_KEY = "harness-key";
process.env.STREAM_ANTHROPIC = "off";
process.env.ACCOUNT_WALL = "off";       // the wall would block before the search
process.env.GUEST_SEARCH_LIMIT = "1";   // the configuration this path needs
process.env.SUPABASE_URL = " ";         // single space: .env cannot override, trims to ""
process.env.SUPABASE_SERVICE_KEY = " ";
process.env.PORT = process.env.PORT || "3167";
require(ROOT + "/server.js");
```

- [ ] **Step 2: Run the preview case (allowance must survive)**

Start the harness with two priced sales, in the background:

```bash
FAKE_SALES=2 PORT=3167 node <scratchpad>/shim-boot.js
```

Then, in another shell:

```bash
curl -s -X POST http://localhost:3167/api/explore-market -H "content-type: application/json" -d '{"type":"Industrial","city":"Twin Falls","state":"ID"}'
curl -s -X POST http://localhost:3167/api/explore-market -H "content-type: application/json" -d '{"type":"Industrial","city":"Nampa","state":"ID"}'
```

Expected: the FIRST answers `"published":false` with a `/market-preview/` URL. The SECOND also answers `"published":false` and NOT a 403 — proving the first preview did not spend the allowance. Stop the server.

- [ ] **Step 3: Run the published case (allowance must be spent)**

Start a fresh process (the guest ledger is in-memory, so a restart is what resets it) with three priced sales:

```bash
FAKE_SALES=3 PORT=3168 node <scratchpad>/shim-boot.js
```

Then:

```bash
curl -s -X POST http://localhost:3168/api/explore-market -H "content-type: application/json" -d '{"type":"Industrial","city":"Twin Falls","state":"ID"}'
curl -s -X POST http://localhost:3168/api/explore-market -H "content-type: application/json" -d '{"type":"Industrial","city":"Nampa","state":"ID"}'
```

Expected: the FIRST answers `"published":true` with a `/market/` URL. The SECOND is refused with `"signin_required":true` — proving the gate still works and was not simply disabled. Stop the server.

If the second request instead succeeds, the fix is wrong (or the gate is broken) and the task is not done.

- [ ] **Step 4: Confirm the analytics event landed**

With no Supabase configured, `logEvent` appends to the git-ignored `analytics.jsonl` in the worktree. Check the preview run wrote its row:

```bash
grep -c explore_preview <WORKTREE>/analytics.jsonl
```

Expected: at least 2 (the two previews from Step 2). Confirm one row also shows `"source":"explore"` and a `"market"` of `"Twin Falls, ID"` with no other identifying fields.

- [ ] **Step 5: Record the transcript**

Write the observed output of Steps 2-4 into the task report. Both directions must pass; a partial pass is not done. Delete nothing from the repo — the harness lives in scratch and `analytics.jsonl` is git-ignored.

---

## Self-Review Notes

- Spec coverage: the consume condition (Task 1 Step 2, verbatim from the spec), the `explore_preview` event (Step 1), the devlog entry (Step 3), the latent-impact framing (devlog text and the plan's Global Constraints), and the two-direction verification with `ACCOUNT_WALL=off` / `GUEST_SEARCH_LIMIT=1` (Task 2). The spec's "what deliberately does not change" list maps to constraints, not tasks, which is correct: no task touches copy, previews stay in memory, and the publish bar is untouched.
- Names used are the existing `consumeGuestSearchFor`, `logEvent`, `previewPagesMem`, `MIN_PRICED_SALE_COMPS`; no new identifiers are introduced.
- No placeholders: every step carries its exact code or command. `<WORKTREE>` and `<scratchpad>` are path substitutions the executor knows, called out explicitly rather than left implicit.
