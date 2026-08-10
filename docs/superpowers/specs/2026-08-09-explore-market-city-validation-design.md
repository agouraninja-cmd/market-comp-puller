# Market Explorer city validation — design

Approved by the owner 2026-08-09.

## Problem

`POST /api/explore-market` validates the city's *shape* only
(`/^[a-zA-Z][a-zA-Z .'\-]{1,39}$/`). "industrial Bosie ID" passes, spends a
billed Anthropic search (~$0.36) on a typo, and if the model scrapes together
enough priced sales anyway, publishes a permanently misspelled
`/market/industrial-bosie-id` page into the sitemap. Nothing detects it.

The existing `/api/geocode` proxy cannot do this job: it calls the Census
`onelineaddress` endpoint, which matches street addresses, and a bare
"Boise, ID" returns no match (this is why the Address Explorer's city-center
lookup leans on the browser's Nominatim fallback).

## What ships

A real-city check inside `/api/explore-market`, before the billed leg, using
the keyless Zippopotam city endpoint
(`GET https://api.zippopotam.us/us/{ST}/{city}`), a service this codebase
already trusts client-side for the Address Explorer's zip resolve.

- HTTP 200 means the city exists: proceed.
- HTTP 404 means it does not: answer 400 with friendly copy, never bill.
- Timeout / 5xx / network error means the validator is down: **fail open**,
  run the search exactly as today. `DAILY_SEARCH_CAP` still backstops spend
  (the same posture as the guest ledger's fail-open rule).

Validate-only, per the owner's decision: the visitor's spelling keeps naming
the slug and the page. Canonicalization ("Saint Louis" and "St. Louis" landing
on one slug) is deliberately out of scope for v1.

## Where the check runs (ordering is load-bearing)

Inside `POST /api/explore-market` only, ordered:

1. Existing-page short circuit (unchanged; covered markets stay free and
   validator-free).
2. Guest gate (unchanged; a blocked anonymous visitor never triggers a
   validator call).
3. **City validation** (new).
4. Explore rate limiter (`explore:` 3 per 15 min), API key check, shared job
   (all unchanged).

Validation sits *before* the explore limiter on purpose: a typo answers 400
without eating one of the visitor's three real-search slots. The validator
call is bounded by its own per-IP limiter (`exploreCheck:`, 10 per 15 min);
when that trips, validation is **skipped** (treated as `unavailable`, fail
open) rather than answering 429, because this is a guardrail, not a service.

A 400 never consumes the guest's free search: only a status-200 result does
(unchanged, `consumeGuestSearchFor` already keys on status).

One accepted consequence: a typo city that already has a `search_cache` entry
(billed before this shipped, or via a fail-open window) is now refused even
though serving it would be free. Correct: the point is not publishing junk
pages, and no cached *page* exists for it or step 1 would have answered.

## The validator: `city-check.js`

A new small pure module following the repo's pure-module pattern (no I/O of
its own; the caller passes `fetch`, the same dependency-injection style
`entitlements.js` uses for its reads). Exports roughly:

- `checkCity(fetchFn, city, state)` → `Promise<"ok" | "unknown" | "unavailable">`.
  Calls `https://api.zippopotam.us/us/{ST}/{city}` with a ~4s timeout per
  request. Maps: 200 → `ok`, 404 → `unknown` (after the variant retry below),
  anything else or a throw → `unavailable`.
- `cityVariants(city)` → the ordered, deduped list of names to try: as typed,
  then one normalized variant (periods and apostrophes stripped, a leading
  "St " expanded to "Saint "). Two outbound requests maximum, deterministic.
  The retry exists because a false 404 on a punctuation variant of a real
  city would refuse a legitimate market.

server.js owns the memo and the real fetch: an in-memory Map keyed
`ST|city.toLowerCase()` caches `ok` and `unknown` verdicts for the process
lifetime (a city does not pop into or out of existence; a restart clears any
data-gap mistake). `unavailable` is never cached.

## Error copy

400 body, in the route's existing style:

> We couldn't find a city called "Bosie" in ID. Check the spelling, or run a
> valuation for a specific property instead.

## Client changes: none

The dropdown's failure path already renders any non-OK `{error}` payload as
the red row plus the worked-example hint row, which is the right UX for a
typo. No index.html edit, no tailwind regen.

## Analytics

A refusal logs a PII-free `explore_reject` event
(`prop_type` + `market: "City, ST"` as typed), so `/admin` can show how often
the check fires and whether it is ever refusing legitimate cities. Failures
to log follow `logEvent`'s existing fire-and-forget rules.

## Testing

`city-check.js` joins `npm test` with a shimmed fetch (the zero-cost
fetch-shim pattern from the corpus-first work): all three verdict mappings,
the 404-then-variant-retry behavior, the two-request cap, and
`cityVariants` generation.

Deliberately **no** routes-test coverage: `test/routes.test.js` boots a real
server, and asserting on this route would hit a live third party from CI,
which is flaky by construction. Instead, one manual live check after deploy:
a garbage city ("industrial Zzzzz ID") must answer the 400 copy, and a real
city must still build a page.

## Out of scope

- `maybePublishMarketSnapshot` (report-path piggyback publishing) keeps its
  shape-only checks; report searches carry real street addresses.
- `gen-market-seed.js` (owner-curated TARGETS list) and the Address Explorer
  are untouched.
- "Did you mean" suggestions, and canonical-name adoption, are possible
  later; nothing here forecloses them.

## Files

- `city-check.js`: new pure module.
- `server.js`: verdict memo + wiring in `/api/explore-market`; new
  `exploreCheck:` rate-limit key.
- `test/city-check.test.js`: new test file.
- `devlog.json`: entry in the same commit (standing rule).
