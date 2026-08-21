# Archive-first retrieval — design

**Date:** 2026-08-21
**Status:** shipped (C5 of the divide-and-conquer plan; §4.3 of the Business
Model Transition Plan — "the change that inverts the economics")
**Modules:** `blend-comps.js` (`archiveCoverage` / `archiveIsStrong`, pure),
`server.js` (`ARCHIVE_FIRST`, `searchBudgetFor`, `runCompSearch`)
**Tests:** `test/blend-comps.test.js` (the threshold),
`test/archive-first.test.js` (the wiring, against a real server, the fake
PostgREST and a stub provider that records every request body)
**Rollback:** `ARCHIVE_FIRST=off` — corpus-then-web for everyone, byte for byte

---

## 1. What it is

Retrieval order was corpus → web. It is now **archive → corpus → web**: a
broker whose own vault holds four or more usable comps for the searched
market + type runs their web search on the corpus-strong floor (3 searches,
2 with a typed size) instead of the full 8–10. Their book subsidizes their
search — the transition plan's whole economic argument, mechanized on the
pattern `corpusIsStrong()` proved.

"Usable" is the one question the vault read cannot answer from a WHERE
clause: does the row carry a figure a valuation can lean on? A priced deal
counts, a lease counts through its rent, an undisclosed deal (allowed —
brokers track them) is real but supports no number. Market, type and lookback
are already applied by `vaultCompsForReport`'s user-scoped query, and the
lookback IS the freshness rule — there is deliberately no second clock.

## 2. The three constraints, and how each is preserved

The plan named them; the tests read them off the wire.

1. **Blending stays at serialization only.** The vault rows move the search
   *budget* and nothing else. Nothing vault-derived reaches the prompt — not
   a row, not an address, not a count — because the model's output is cached
   and harvested, and a prompt that had seen a private row would leak it
   through both. Structurally enforced: the strength flag rides on the corpus
   object, and `buildPrompt` is only ever handed `corpus.comps` /
   `corpus.nearby` / `corpus.listed`, never the object itself. The e2e test
   asserts no vault address, price, or the words vault/archive appear in the
   recorded prompt.
2. **The budget and the analytics tag read the same threshold.**
   `corpus.archiveStrong` is set once, in `runCompSearch`, from
   `blend-comps.js`'s tested predicate; `searchBudgetFor` and the
   `logEvent("search", { source: "archive" })` tag both read that flag. The
   test asserts exactly the floored search is tagged and exactly the control
   is not.
3. **The floor stays 2–3, never 0.** Same literals corpus-strong uses, same
   line of code.

## 3. The finding the plan did not have: the cache

`search_cache` is keyed by property, not by user. A corpus-strong search is
safe to cache because the comps that shrank its budget were handed to the
model and are IN the cached body. A vault-subsidized search has no such
compensation: the cached body would be a 3-search report, and every later
visitor would be served it without the private rows that justified the
thinness.

So a search whose budget was cut on vault strength alone **is not written to
the shared cache** (or the derivable-window store, which reads it). The cost
lands where it belongs: the broker's own repeat search re-runs at the floored
budget — cheap, by construction — and the public cache gains nothing rather
than gaining something worse. When the corpus is *also* strong, the entry is
cached exactly as before, because corpus strength alone justified the budget.

Cache **reads** are unchanged: a broker searching an address somebody already
paid full price for still gets the free hit.

## 3b. The provider must be able to honor the budget

**`archiveStrong` is gated on `PROVIDER.capabilities.searchBudget`, and that
gate is load-bearing rather than tidy.** Gemini's `google_search` takes no
`max_uses`, so on the default provider the floored number is silently ignored
and the billed call is byte-identical to a full-budget one. Without the gate
the feature would buy nothing there and still skip the cache write — strictly
worse than not existing, and invisible, because the report looks perfectly
normal.

This shipped wrong on the first pass, on the provider production actually
runs. `test/archive-first.test.js` boots the same seeded vault against Gemini
and asserts the flag never fires: full budget, normal cache write, no
`archive` tag. The capability is read, never the provider name.

The consequence worth stating plainly: **on Gemini this feature is currently
inert.** It becomes a cost lever the moment `SEARCH_PROVIDER=anthropic`, or
whenever Gemini's grounding tool gains a round cap.

## 4. What deliberately does not count

- **Firm-shared comps** (`org_comps`). They blend into the broker's report,
  but an admin toggling `share_default` must not silently change what
  colleagues' searches cost or find. Own vault only.
- **The Explorer and the seed generator.** Market pages are public surfaces
  built from public searches; internal callers pass no vault rows and are
  unaffected.
- **The model's knowledge.** No "N private comps will be added later" hint —
  even a count shapes output, and the safe amount of vault-derived prompt
  content is none.

## 5. What a broker gives up, honestly

The model writes its market narrative from fewer web comps; the vault rows
compensate the comp table and the valuation (they blend at full weight, and
the browser computes the range from the full set), not the prose. That is the
trade the plan priced in. If narrative quality on floored searches measures
worse than it is worth, the lever is `ARCHIVE_FIRST=off`, not a wider floor.

## 6. Wiring

`runCompSearch` gains `vaultRows = []`, passed by both callers from the rows
they already held for serialization — one read feeds the budget AND the
blend, so the floored report always carries the comps that justified it.
`/api/comps` passes the handler's `vaultRows`; the bulk worker passes
`priv.vault` from its per-market memoized read. `[]` for everyone else, which
restores the pre-feature pipeline byte for byte.
