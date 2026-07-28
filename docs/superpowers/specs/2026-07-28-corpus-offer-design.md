# Corpus comps in-report ("From CompNinja's records") — Design + Plan

Date: 2026-07-28
Status: approved by owner (design approved in chat; this doc records it and
carries the implementation plan)

Roadmap #9, second half — reframed. The standalone browse-the-database page
stays deferred behind the data-density milestone (corpus ~80 durable rows as
of 2026-07-27). This slice delivers the friend's "browse comps, build your own
comp set" ask at the density the data actually supports: each report offers
the corpus's other comps for that market + type, one click adds them to the
curated set. Where data is thin the section renders nothing — graceful by
construction, and it grows automatically with organic traffic.

## Decisions (owner-approved)

- **Report-embedded, market-scoped, capped at 20 rows.** Not a browse page,
  not bulk access — the "report with sources" posture.
- **Zero AI cost.** The endpoint is a pure corpus read via the existing
  `corpusRowsForMarket()`; no billing, no `DAILY_SEARCH_CAP` interaction.
- **Provenance-good rows only**: `source_type` never `estimate`/`news`, must
  carry a parseable price. Same bar corpus-first retrieval uses.
- **Corpus-added comps keep their real badge** (Public record / Listing /
  Verified) — they genuinely are CompNinja data. Manual adds keep "Added by
  you". The curation note distinguishes: "2 comps added by you (1 from
  CompNinja's records)". (Broker `verified_by` credit is NOT available — the
  corpus doesn't store it — so Verified renders without the "via firm" tail.)
- **Hidden for shared viewers and on the sample** (viewers can't curate; the
  demo stays deterministic).
- **Analytics**: one PII-free `corpus_offer` event per fetch that returns
  rows, so /admin shows real-visitor usage — the milestone gauge for the
  someday browse page.

## Server (server.js)

**`GET /api/corpus-comps?address=<subject address>&type=<Type>`**

- Validate: `address` non-empty (cap 300 chars), `type` in the six-type
  whitelist; else 400.
- Rate limit: `rateLimited("corpusoffer:" + clientIp(req), 30)` (default 5-min
  window); 429 on trip.
- `market = marketOf(address)` — server-side, so the lookup matches how
  harvest filed the rows. Junk market keys can't match a real canonicalized
  market, so they are invisible here.
- Rows: `corpusRowsForMarket(market, type, 100)`. **Add `verified` to that
  function's Supabase `select`** (retrieval ignores the extra field; the
  browse rows need it for the badge). File-fallback rows already carry it.
- Filter: drop `estimate`/`news` source types; drop rows where neither
  `price_or_rate` nor `price_per_sqft` parses via `corpusNum`; drop aggregate
  addresses (`isAggregateAddress`); dedupe by `corpusKeyOf`; cap 20.
- Respond `{ market, comps: [...] }` where each comp carries: `address`,
  `transaction`, `date` (from `deal_date`), `size_sqft`, `price_or_rate`,
  `price_per_sqft`, `cap_rate`, every `ALL_TYPE_COMP_FIELDS` key present,
  `source_type` (normalized to the known enum, else "listing"→ no: else drop
  the row — provenance must be known to pass the filter anyway), `verified`
  (boolean). Nothing else (no ts, no source_url — URLs weren't verified for
  this surface; keep lean).
- `logEvent("corpus_offer", { prop_type: type, market, cached: false,
  source: String(comps.length) })` only when `comps.length > 0`.
- Failure-safe: any internal error returns `{ market, comps: [] }` with 200 —
  the section simply doesn't render; never breaks a report.

## Client (index.html)

**Markup** — inside the comps card, directly after `#addCompWrap`:

```
#corpusOffer (hidden, no-print no-capture)
  heading: "From CompNinja's records"
  sub-line: "Comps CompNinja has gathered for this market. Add any that fit —
             they join your report's math and stay marked with their source."
  #corpusOfferRows (stacked rows)
```

Each row: address + source badge (existing `sourceBadge`) on the left; a meta
line (transaction · date · size · price · $/SF where present); an **Add to
report** button on the right. Calm styling, existing utilities/classes only.

**Fetch** — at the end of `renderResults`, when `!meta.shared && !meta.sample`:
`fetch("/api/corpus-comps?address=...&type=...")`, store rows in a
module-level `corpusOfferRows`, then `renderCorpusOffer()`. Fire-and-forget
with a `.catch` that hides the section. Re-fetched per `renderResults` (cheap,
rate-limited); NOT re-fetched by `applyCuration()`.

**`renderCorpusOffer()`** — renders `corpusOfferRows` minus any row whose
`compKeyOf` matches a comp already in `currentComps` (model, added, or
excluded — an excluded model comp is still "in the report"). Hides the whole
section when nothing remains, when controls aren't allowed
(`curationControlsAllowed()`), or when there are no rows. Also called from
`applyCuration()` so a just-added row disappears from the offer list.

**Add handler** — builds the comp from the corpus row: all served fields,
plus `date: r.date`, `user_added: true`, `from_corpus: true`, `verified:
r.verified === true`, `source_type: r.source_type`. Then exactly the manual
add path: duplicate-key guard, push to `cur.added` + `currentComps`, `_num`
= max+1, `applyCuration()`.

**`ensureCuration` refinement** — the re-stamp rule becomes:

- every added entry: `user_added = true`
- entries WITHOUT `from_corpus`: force `source_type = "user"`,
  `verified = false` (unchanged rule for manual adds)
- entries WITH `from_corpus: true`: sanitize `source_type` against the known
  tier enum (unknown → "listing"? no — unknown → treat as manual: strip
  `from_corpus`, force "user"); coerce `verified` to boolean.

Trust note: a hand-edited share/save payload could claim `from_corpus` — the
same trust level already extended to `data.comps`' own `source_type` in every
stored payload. Accepted, documented here.

**Curation note** — `updateCurationNote` gains the split: "2 comps added by
you (1 from CompNinja's records)." — counts via `from_corpus`.

**Remove** — corpus-added comps carry `user_added` so the existing Remove
control works unchanged; removing one makes it reappear in the offer list
(the dedupe recomputes in `renderCorpusOffer`).

## What this deliberately does not touch

Harvesting, the corpus schema (the `verified` column already exists in the
DDL), `/api/comps`, the cache key, corpus-first retrieval behavior (the
shared `select` gains one field retrieval ignores), share/portfolio payloads
(corpus adds ride `meta.curation.added` exactly like manual adds), exports
(added comps already flow), the standalone browse page (deferred).

## Plan

- **S1 (server)**: endpoint + `verified` in the shared select + analytics
  event + CLAUDE.md route bullet. Checks: `node --check`, a curl walk against
  a locally-seeded `comp-corpus.jsonl` (file fallback), rate-limit trip, bad
  input 400s. Commit.
- **S2 (client)**: markup + fetch + `renderCorpusOffer` + add handler +
  `ensureCuration` refinement + note split + `applyCuration` wiring. Checks:
  inline-script parse, live browser walk on the seeded server. Commit.
- **S3 (controller)**: end-to-end verification (sample-as-real report against
  seeded corpus: section renders, add joins math with real badge, note splits,
  remove restores the offer, persistence + share round-trip, shared/sample
  hidden, zero AI calls), final whole-branch review, deploy on the owner's
  word.

## Verification walk (S3)

1. Seed `comp-corpus.jsonl` in the worktree with ~6 Dallas, TX Industrial
   rows (mixed tiers incl. one estimate row that must NOT appear, one junk
   aggregate address that must NOT appear).
2. Render the sample-as-real report (Dallas Industrial) → section appears
   with only the provenance-good rows, each with its real badge.
3. Add one → joins table/math/map with its corpus badge; offer row vanishes;
   note reads "1 comp added by you (1 from CompNinja's records)"; trust line
   counts its tier honestly.
4. Remove it → reappears in the offer.
5. Persistence: reload + saved-chip reopen → added corpus comp restored with
   badge; offer list deduped correctly.
6. Share: viewer sees the comp in the table with its real badge, NO offer
   section, no controls.
7. `curl` the endpoint directly: bad type → 400; 31 rapid calls → 429; an
   address in a market with no rows → `{ comps: [] }`.
8. Confirm zero Anthropic calls anywhere (it's all corpus reads).
