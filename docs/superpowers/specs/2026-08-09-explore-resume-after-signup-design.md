# Market Explorer — resume the explore after signup

Approved by the owner 2026-08-09.

## Problem

The Market Explorer's guest gate interrupts an anonymous visitor's typed
market search with the account modal (403 `signin_required` from
`/api/explore-market`), and the typed `{type, city, state}` is dropped on
the floor. After creating the account — exactly what the site asked them to
do — the visitor lands back on a page with an empty Explorer and has to
retype and re-trigger the search. The interruption happens at the exact
moment of conversion, and the product forgets why it interrupted them.

## What ships

A pending intent, using the account modal's existing pattern
(`pendingPortfolioSave` / `pendingCheckoutPlan` / `pendingSharedReload` in
index.html): the refused explore parks itself, survives the signup, and
fires automatically once the visitor is signed in.

Client-only. No server change, no new route behavior, no migration.

## Behavior

1. **Set.** In `explore()`'s `signin_required` branch (the one that opens
   the account modal), park `pendingMarketExplore = { type, city, state }`
   — the exact object the route just refused — before `openAcctModal`.
2. **Clear.** `closeAcctModal()` clears it, one line beside its three
   siblings. A cancelled or dismissed modal must never fire a surprise
   billed search on a later sign-in; this is the same rule the portfolio
   save, the checkout, and the shared-report reload already follow.
3. **Fire.** In the auth-success path of the account form handler, capture
   it BEFORE `closeAcctModal` (which clears it), like the others. Firing
   sets the Market Explorer input's value to the parked query text (visual
   context only — `explore()` takes the object, not the input) and calls
   `explore()` with the parked object. Progress, the redirect to the built
   page, and any failure row are all the existing code paths, unchanged.
4. **Precedence**, matching the file's documented rules:
   - A pending **checkout** wins over a pending explore: the next thing
     that happens is a redirect to Stripe, which abandons everything else
     anyway. If both are set, the explore is dropped, not deferred.
   - A pending **explore** wins over the saved-reports import prompt (the
     `acctImport` branch): the explore ends in a redirect to the market
     page, which would abandon the prompt mid-question. Same reasoning the
     checkout precedence comment already states. When a pending explore
     fires, the modal closes instead of showing the import offer.
5. **Scope seam.** `explore()` is private to the Market Explorer IIFE; the
   modal handler is not inside it. The IIFE assigns a resume function to a
   top-level `let` declared before it (e.g.
   `runPendingMarketExplore = (q) => { input.value = ...; explore(q); }`) —
   the same seam shape `runPendingExplore` already uses for the Address
   Explorer's deep link. The pending OBJECT lives at top level with the
   other pending flags so `closeAcctModal` can clear it.

## What deliberately does not change

- Sign-in (not just signup) fires the intent too: a signed-out member who
  hits the gate gets the same resume. If their account turns out to be
  gated differently (e.g. Pro vs free), `/api/explore-market` re-decides
  server-side on the re-run — the client never pre-judges entitlements.
- No sessionStorage / reload survival. This modal flow never reloads the
  page, with one corner: on a gated shared report (`/r/<id>`),
  `pendingSharedReload` and a parked explore CAN co-occur, and the reload
  path returns first — the explore is dropped with the rest of the page's
  state. Accepted: the visitor's primary intent there is the report they
  were sent, and a search that auto-fires on a later page load is the
  class of surprise the file's one-shot rules exist to prevent.
- The Address Explorer's `runPendingExplore` deep-link machinery is
  untouched.
- The server's guest gate, city check, and limiter behavior are untouched.

## Failure handling

If the re-run fails (rate limit, thin market, network), the existing
`exploreFail` red row renders — same as a signed-in visitor whose explore
failed. The pending intent is one-shot: it is consumed when fired,
whatever the outcome.

## Testing

`npm test` deliberately does not execute index.html's inline script, so:
- CI's existing syntax gates still apply to the file as served.
- Verification is a scripted local browser pass against a real boot with
  `ACCOUNT_WALL=on` (the live configuration): anonymous visitor types a
  market, gets the modal, signs up with a throwaway account (file-fallback
  store, no Supabase needed), and the explore resumes and reaches the
  progress state without retyping. A second pass confirms the cancel rule:
  dismiss the modal, sign in later from the header, and no search fires.

## Files

- `index.html`: the pending flag, the clear line, the capture/fire block,
  the IIFE seam. Nothing else.
- `devlog.json`: entry in the same commit.
