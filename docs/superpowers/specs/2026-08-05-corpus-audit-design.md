# Corpus audit: a free structural integrity check over the comp corpus

Date: 2026-08-05
Status: approved (owner, in-session)

## Problem

The comp corpus is the permanent data layer that broker verification,
corpus-first retrieval, the in-report "From CompNinja's records" offer and
the future corpus browse page all build on. Nothing has ever measured
whether the rows in it are sound. Three specific gaps, all confirmed
against the 134 rows in the local `comp-corpus.jsonl` on 2026-08-05:

1. **Citations that do not point at the property.** A large share of rows
   claiming `listing` provenance cite a search-results page, a category
   page or a market flyer PDF rather than the specific building. Real
   examples: `322 Griffith St, Pocatello` cites
   `realmo.com/warehouses/for-lease/id/pocatello/`, and two different
   Pocatello comps both cite the same LoopNet search URL. The `source_url`
   is the proof a comp offers, and on those rows it proves nothing.

2. **Rows harvested under superseded rules.** Eight rows carry a `listing`
   badge that today's `normalizeSourceTypes` would force to `estimate`.
   These are not a bug: all eight predate commit aa878f3 (2026-07-30),
   which added the enforcement. They are a structural issue instead.
   Nothing re-examines old rows when a rule tightens, yet corpus-first
   retrieval serves them to customers today.

3. **Silent data loss.** A row whose `deal_date` will not parse under
   `parseDealDate` is invisible to retrieval, because retrieval filters on
   a parsed date. Such a row costs storage and returns nothing, and no
   counter anywhere would show it.

A fourth constraint shapes the whole design. Roughly half the corpus
(51% of local rows) cites hosts that hard-block server-side fetching:
LoopNet, CityFeet, PropertyShark and CommercialSearch all answered 403 to
a browser-User-Agent curl on 2026-08-05, and LoopNet alone is the single
most common source. Any audit built on "fetch the page and compare" is
therefore blind on half the data, and would report a bot-detection rate
while calling it an accuracy rate.

## Goal

An internal data-quality alarm: find and list corpus rows whose structure
is unsound, so they can be fixed or the rules that produced them can be
tightened. Free, deterministic, and honest about what it does not know.

Explicitly NOT the 90% accuracy figure that the marketing principle gates
on. That claim needs ground truth this project does not have, and half the
sources cannot be read to establish it. The number this produces is a
**citation integrity** score and the UI must label it that way, so it can
never be mistaken for a measured accuracy rate.

## Non-goals

- No network fetches of `source_url`. Blocked half the time, slow, and
  unnecessary for an alarm.
- No model calls. Every check here is deterministic.
- No mutation of corpus rows, and no change to what customers see.
  Report-only was chosen deliberately so the scale of the problem is known
  before any policy (badge downgrade, retrieval exclusion) is set.
- No cron or scheduler. On demand is enough for an owner-facing dashboard.

## Design

### `corpus-audit.js`, a pure module

A new module beside `entitlements.js` and `comp-gate.js`, following the
same discipline: no I/O, no clock reads, no requires. That is what lets
`npm test` exercise the entire rule set with no database, and it matches
the roadmap's engineering track item about extracting tested pure modules
from `server.js` as they are touched.

Single entry point:

```js
auditCorpus(rows, { now, parseDealDate }) -> {
  total, clean, score,
  findings: { weak_citation, badge_drift, shared_citation,
              unparseable_date, no_price },
  hosts: { fetchable, blocked, unknown },
  worst: [ { address, market, property_type, source_type,
             source_url, findings: [...] } ]   // up to 15
}
```

`parseDealDate` is injected rather than reimplemented. The audit must
agree exactly with what retrieval considers a usable date, and injection
guarantees that agreement instead of hoping two copies stay in step.

`clean` counts rows with zero findings and `score` is `clean / total`.
Rows are never dropped from the denominator for being unreachable, so the
score cannot be flattered by excluding the sources it cannot read.

### Check 1: `weak_citation`

Does the `source_url` identify this specific property? Three signals:

- **idMatch**: the URL path contains a bounded numeric segment of 5 or
  more digits, i.e. a listing id.
- **numberMatch**: the address's leading street number appears in the URL
  as a bounded digit token (not as a substring of a longer number).
- **tokenMatch**: at least one distinctive token from the address appears
  in the URL path. Distinctive means 4 or more characters and not a
  directional or street-type suffix, reusing the `STREET_STOPWORDS` idea
  already in `index.html`.

A row is specific when `idMatch`, or `numberMatch && tokenMatch`, or
(`source_type === "news" && tokenMatch`). Otherwise it is flagged.

The compound `numberMatch && tokenMatch` rule exists to defeat a real
false positive: a four-digit year in a URL path (`/2025-05/`) would
otherwise match the street number of an address like "2025 Main St".
Requiring a street-name token alongside it removes that. The 5-digit
floor on `idMatch` protects the same case from the other direction.

News gets the looser rule because a legitimate article URL
(`cbre-arranges-sale-of-59-7-acre-industrial-site-in-pocatello-ida`)
names the deal without carrying the street number. An early draft of this
heuristic flagged exactly that URL, so it is a required test case.

Wording matters here. The finding says the citation does not identify the
property. It does not say the comp is wrong. Whether the deal is real is
unknowable without reading the page, which is the thing this audit
deliberately does not do.

### Check 2: `badge_drift`

Recompute what today's rules would assign, and flag the row when the
stored `source_type` is *stronger* than the recomputed one, ranking
`public_record` > `listing` > `news` > `estimate`.

To avoid a second copy of the rule, the enforcement predicate moves into
this module as `enforcedSourceType(claimed, address)`, and
`normalizeSourceTypes` in `server.js` is refactored to call it. This
removes duplication rather than creating it, and brings the rule under
test for the first time.

Known consequence to record rather than fix here: the street-number test
`/^\s*\d+\s+\S/` rejects hyphenated ranges such as `7657-7695 S 5th Ave`,
so genuine address-range comps are forced to `estimate`. That is
under-claiming, which is the codebase's stated safe direction, so it is
not a defect. The audit will surface these rows and the count will show
whether the pattern is common enough to justify widening the regex.

### Check 3: `shared_citation`

Group rows by normalized `source_url`. When one URL is cited by more than
one distinct normalized address, flag every row in that group. Two comps
sharing one URL is the strongest available tell that the model padded a
thin market from a single listing page, and it needs no page fetch to
detect.

### Check 4: `unparseable_date` and `no_price`

`unparseable_date`: `parseDealDate(row.deal_date)` returns null, so
retrieval can never surface the row. `no_price`: neither `price_or_rate`
nor `price_per_sqft` yields a number. `harvestComps` already refuses
priceless comps, so a nonzero `no_price` count means the harvest rule
changed or something wrote around it; either way it is worth seeing.

### Check 5: host class, reported and never scored

Hosts are classified `blocked` (a measured 403 list: loopnet.com,
cityfeet.com, propertyshark.com, commercialsearch.com), `fetchable`, or
`unknown`, and returned as context only. No finding is raised from it and
it never moves the score. Its whole purpose is to stop a future reader
mistaking a blocked host for a bad comp.

The measurement date belongs in a comment above the list. It is a snapshot
of bot policy, not a fact.

### Route: `GET /api/corpus-audit`

Gated by `isAdminRequest(req)`, exactly like `/api/stats`, so both the
`x-admin-key` header and the `cn_admin` cookie work. Memoized 60 seconds,
following `/api/pricing`. Reads at most the 2,000 most recent
`comp_corpus` rows through the existing `readRows` helper, so the Supabase
and file-fallback paths are both covered with no new storage code.

Fails safe. Any read error returns `{ error: "unavailable" }` with a 200,
and the panel renders an explanatory line. This endpoint must never be
able to break `/admin`, which is the page the owner opens when something
else is already wrong.

### `/admin` panel

A "Corpus integrity" section below the existing corpus-health banner:

- the score, labeled as citation integrity, with the row count it covers
- one line per finding type with its count
- the host split, worded as context ("51% of rows cite hosts that block
  automated reading; this does not affect the score")
- the worst rows, up to 15, each showing address, property type, stored
  badge, the findings it triggered, and a truncated URL

Styling reuses the existing internal tokens with no new colors. Red stays
reserved for the two outright-failure banners already on the page, per the
calm UI principle. This panel is neutral ink even at a low score, because
it reports a standing condition rather than an outage.

## Error handling

Every layer degrades to silence rather than noise. `auditCorpus` is pure
and total: a malformed row yields findings, never a throw. The route
catches everything and answers `unavailable`. The panel renders nothing
but an explanatory line when the payload carries `error`. Nothing in this
feature is on a customer path, so no failure here can affect a search, a
report or a purchase.

## Testing

`test/corpus-audit.test.js` under the existing `node --test "test/*.test.js"`
runner, no database and no network. Cases drawn from real corpus rows:

- `weak_citation` fires on the realmo and LoopNet search-page URLs
- it does NOT fire on the rebusinessonline news article (the false
  positive found while designing this)
- it does NOT fire on a URL carrying a 5-or-more-digit listing id
- a four-digit year in the path does not satisfy `numberMatch` alone
- `badge_drift` fires on a pre-2026-07-30 unnumbered `listing` row
- `enforcedSourceType` matches the behavior `normalizeSourceTypes` had
  before the refactor, including the hyphenated-range under-claim
- `shared_citation` fires on two distinct addresses citing one URL, and
  not on one address appearing twice with different formatting
- `unparseable_date` uses the injected `parseDealDate`, proving the audit
  and retrieval agree
- an empty corpus scores cleanly instead of dividing by zero

## Future, explicitly out of scope now

Once the numbers are known, three follow-ups become decidable: correcting
a drifted badge at read time, excluding weak-citation rows from retrieval,
and a sampled model pass over the rows whose URLs are actually fetchable.
All three change what customers see, so none should be chosen before this
report has run against the production corpus.
