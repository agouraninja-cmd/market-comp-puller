# Market Explorer Resume-After-Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guest whose typed market search hits the signup gate gets that search run automatically the moment they sign in, instead of finding an empty Explorer.

**Architecture:** Pure client change in index.html's inline script, using the account modal's existing pending-intent pattern (`pendingPortfolioSave` / `pendingCheckoutPlan` / `pendingSharedReload`): park the refused `{type, city, state}` when the gate fires, clear it on modal close, capture-and-fire it on auth success. `explore()` is private to the Market Explorer IIFE, so the IIFE assigns a resume function to a top-level `let` (the `runPendingExplore` seam shape).

**Tech Stack:** Plain browser JS inside index.html's one inline script. No server change, no migration, no tailwind regen (no new classes).

**Spec:** `docs/superpowers/specs/2026-08-09-explore-resume-after-signup-design.md`

## Global Constraints

- index.html only (plus devlog.json). No server.js change, no new route behavior.
- A cancelled/dismissed modal must never fire a surprise search later: `closeAcctModal` clears the pending intent, exactly like its three siblings.
- Precedence: pending checkout wins over pending explore; pending explore wins over the saved-reports import prompt; the `pendingSharedReload` path returns first and drops everything (accepted, per spec).
- The pending intent is one-shot: consumed when fired, whatever the outcome.
- `npm test` must stay green — `test/index-html.test.js` vm-compiles the inline script, so a syntax slip in these edits fails the suite (that is the net; use it).
- Shared checkout: another session has uncommitted index.html WIP near line 2363 in the PRIMARY checkout. Work in the feature worktree (branched from committed HEAD), never in the primary checkout.
- devlog.json entry rides the feature commit; clean UTF-8, raw em dashes fine.

---

### Task 1: The pending intent, all four edits + devlog

**Files:**
- Modify: `index.html` (four spots: top-level declarations ~line 7251, `closeAcctModal` ~line 7343, the auth-success handler ~line 7439, the Market Explorer IIFE ~line 8942)
- Modify: `devlog.json` (one entry)

**Interfaces:**
- Consumes: existing `explore({type, city, state})` (private to the Market Explorer IIFE), `openAcctModal`, `closeAcctModal`, the auth-success handler's pending-flag block.
- Produces: top-level `let pendingMarketExplore` (null or `{type, city, state}`) and `let runPendingMarketExplore` (null or `(q) => void`), which Task 2 exercises in a browser.

All line numbers are as of commit `347c92b`; match on the quoted code, not the numbers.

- [ ] **Step 1: Declare the two top-level lets**

Find (~line 7251):

```js
  let pendingPortfolioSave = false; // "Save to portfolio" clicked while signed out
  let pendingSharedReload = false;  // signin_required on /r/<id>: reload this URL once signed in
```

Append directly below:

```js
  let pendingMarketExplore = null;  // {type, city, state} the guest gate refused; resumes after sign-in
  let runPendingMarketExplore = null; // assigned by the Market Explorer IIFE (explore() is private to it)
```

- [ ] **Step 2: Clear on modal close**

Find (~line 7343):

```js
  function closeAcctModal() {
    pendingPortfolioSave = false; // a cancelled nudge must not fire a surprise save later
    pendingCheckoutPlan = null;   // ...and must not open Stripe Checkout later either
    pendingSharedReload = false;  // ...and a cancelled sign-in must not reload the page later
```

Append after the `pendingSharedReload` line:

```js
    pendingMarketExplore = null;  // ...and a cancelled gate must not fire a surprise market search later
```

- [ ] **Step 3: Capture and fire on auth success**

Find (~line 7439):

```js
      // Capture the pending flags BEFORE closing: closeAcctModal clears them
      // (so a cancelled nudge can't fire a surprise save, or a surprise
      // checkout, after a later sign-in).
      const firePendingSave = pendingPortfolioSave;
      const firePendingPlan = pendingCheckoutPlan;
      pendingPortfolioSave = false;
      pendingCheckoutPlan = null;
      // Only rows that still hold their report can be imported.
      const saved = historyWithReports();
      // A pending checkout wins over the import offer: the next thing that
      // happens is a redirect to Stripe, which would abandon the import prompt
      // mid-question anyway.
      if (isUp && saved.length && !firePendingPlan) {
```

Replace with:

```js
      // Capture the pending flags BEFORE closing: closeAcctModal clears them
      // (so a cancelled nudge can't fire a surprise save, a surprise
      // checkout, or a surprise market search, after a later sign-in).
      const firePendingSave = pendingPortfolioSave;
      const firePendingPlan = pendingCheckoutPlan;
      const firePendingExplore = pendingMarketExplore;
      pendingPortfolioSave = false;
      pendingCheckoutPlan = null;
      pendingMarketExplore = null;
      // Only rows that still hold their report can be imported.
      const saved = historyWithReports();
      // A pending checkout wins over the import offer: the next thing that
      // happens is a redirect to Stripe, which would abandon the import prompt
      // mid-question anyway. A pending explore wins over it for the same
      // reason — it ends in a redirect to the market page it builds.
      if (isUp && saved.length && !firePendingPlan && !firePendingExplore) {
```

Then find, a few lines below:

```js
      if (firePendingSave) savePortfolioCurrent();
      if (firePendingPlan) {
        // Reopen pricing so the button can show "Opening checkout…" and any
        // error has somewhere visible to land.
        openPricingModal();
        startCheckout(firePendingPlan,
          document.querySelector('.pricing-buy[data-plan="' + firePendingPlan + '"]'));
      }
```

Replace with:

```js
      if (firePendingSave) savePortfolioCurrent();
      if (firePendingPlan) {
        // Reopen pricing so the button can show "Opening checkout…" and any
        // error has somewhere visible to land.
        openPricingModal();
        startCheckout(firePendingPlan,
          document.querySelector('.pricing-buy[data-plan="' + firePendingPlan + '"]'));
      } else if (firePendingExplore && runPendingMarketExplore) {
        // Checkout wins when both are set — the Stripe redirect abandons
        // everything else anyway. Otherwise the search the guest gate
        // interrupted resumes now, through the Explorer IIFE's seam.
        runPendingMarketExplore(firePendingExplore);
      }
```

- [ ] **Step 4: Park the refused search at the gate**

Find, inside the Market Explorer IIFE's `explore()` (~line 9057):

```js
          if (payload && payload.signin_required) {
            exploring = false;
            input.readOnly = false;
            // hide() empties the dropdown but leaves attributes behind, and a
            // stale aria-busy would mute every later match list to a reader.
            resultsEl.removeAttribute("aria-busy");
```

Append directly after the `removeAttribute` line (BEFORE the `guestSearch` lines that follow):

```js
            // Park the refused search: it resumes automatically after the
            // sign-in this modal asks for. closeAcctModal clears it, so a
            // dismissed modal can never fire it later.
            pendingMarketExplore = { type, city, state };
```

- [ ] **Step 5: Assign the IIFE seam**

Find the end of the Market Explorer IIFE (~line 9142):

```js
    document.addEventListener("mousedown", (e) => {
      if (!resultsEl.contains(e.target) && e.target !== input) hide();
    });
  })();
```

Replace with:

```js
    document.addEventListener("mousedown", (e) => {
      if (!resultsEl.contains(e.target) && e.target !== input) hide();
    });
    // The account modal fires a gate-interrupted search back through this
    // seam once the visitor signs in — explore() is private to this IIFE.
    // The input refill is context only; explore() reads the object.
    runPendingMarketExplore = (q) => {
      input.value = `${q.type.toLowerCase()} ${q.city} ${q.state}`;
      explore(q);
    };
  })();
```

- [ ] **Step 6: Devlog entry**

Add to `devlog.json` at the top of the array (rebuild-don't-patch if another entry is in flight, per shared-checkout):

```json
{
  "date": "2026-08-09",
  "type": "improvement",
  "title": "The Market Explorer remembers what you asked for through signup",
  "details": "When the free-account gate interrupts a typed market search, the search now resumes automatically the moment the account exists, instead of dumping the new member back on an empty Explorer to retype it. Same one-shot pending-intent rules as the portfolio save and checkout: dismissing the modal cancels it, and it can never fire on a later unrelated sign-in."
}
```

- [ ] **Step 7: Suite green**

Run: `npm test`
Expected: all pass — `test/index-html.test.js` vm-compiles the inline script and is the syntax net for these edits.

- [ ] **Step 8: Commit**

```bash
git status --short
git add index.html devlog.json
git commit -m "Market Explorer: resume the gated search after signup"
```

---

### Task 2: Browser verification (zero-billing boot)

**Files:**
- Modify: `.claude/launch.json` in the PRIMARY checkout (add one entry; do not commit it with this feature — it is local tooling)

**Interfaces:**
- Consumes: Task 1's behavior end to end.
- Produces: a written pass/fail transcript in the task report; no code.

- [ ] **Step 1: Add the verification server entry**

Append to `.claude/launch.json`'s `configurations` (primary checkout), following the existing worktree-entry pattern:

```json
{
  "name": "explore-resume",
  "runtimeExecutable": "C:/Users/JacobAdler/AppData/Local/node-portable/node-v24.16.0-win-x64/node.exe",
  "runtimeArgs": [
    "-e",
    "process.chdir('C:/dev/compninja/.claude/worktrees/explore-resume');process.env.ANTHROPIC_API_KEY='';process.env.SUPABASE_URL='';process.env.SUPABASE_SERVICE_KEY='';process.env.ACCOUNT_WALL='on';process.env.PORT='3166';require('C:/dev/compninja/.claude/worktrees/explore-resume/server.js')"
  ],
  "port": 3166,
  "autoPort": true
}
```

(Adjust the worktree path to the actual feature worktree name. `ANTHROPIC_API_KEY=''` means nothing can bill; no Supabase means accounts use the file-fallback store; `ACCOUNT_WALL='on'` is the live configuration and forces the guest gate.)

- [ ] **Step 2: Resume path**

Start the `explore-resume` server, open `http://localhost:3166/?auth=signup` (the wall serves the LANDING page at `/` to anonymous visitors; `?auth=signup` is the door that serves the app), close the auto-opened modal, and in the Market Explorer input type `industrial Twin Falls ID` (a real city with no seeded page). Click the "Explore this market…" row.

Expected sequence, each step checked:
1. The account modal opens with the server's guest-gate sentence (the 403 fired; no progress bar ran).
2. Sign up with a throwaway account (any name/email/password — file store).
3. The modal closes, the Explorer input reads `industrial Twin Falls ID`, the dropdown shows build progress, and then the red failure row appears saying the server is missing the ANTHROPIC_API_KEY environment variable.

That exact error is the PROOF: the resumed request passed the guest gate (signed in), passed the live city check, and reached the API-key guard — the whole pipeline ran without retyping, and without a billable key in the process. Also confirm via the browser's network log that exactly TWO `POST /api/explore-market` requests exist (the 403 and the resumed one), and the console shows no uncaught errors.

- [ ] **Step 3: Cancel rule**

Reload `http://localhost:3166/?auth=signup`, close the modal, type `industrial Twin Falls ID`, click the explore row, and when the account modal opens press **Cancel**. Then sign in from the header with the Step 2 account.

Expected: sign-in succeeds, NO new `POST /api/explore-market` appears in the network log, no progress or failure row renders. The dismissed gate fired nothing.

- [ ] **Step 4: Record the transcript**

Write the observed results of Steps 2-3 into the task report. If either expectation failed, the task is not done — fix and re-verify.

---

## Self-Review Notes

- Spec coverage: set (Task 1 Step 4), clear (Step 2), fire + both precedence rules (Step 3), seam (Step 5), one-shot semantics (capture-then-null in Step 3), failure handling (existing `exploreFail`, exercised by Task 2's missing-key red row), testing stance (Task 1 Step 7 syntax net + Task 2 browser pass), devlog (Step 6). The `/r/<id>` reload corner needs no code — `pendingSharedReload` already returns before the fire block Task 1 edits, which is exactly the spec's accepted behavior.
- Names consistent across tasks: `pendingMarketExplore`, `runPendingMarketExplore`, `firePendingExplore`.
- No placeholders; every edit carries its exact before/after code.
