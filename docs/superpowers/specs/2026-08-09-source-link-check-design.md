# Source-link check at harvest (design)

Date: 2026-08-09
Status: AGREED

## Problem

Every comp's `source_url` is its proof, and nothing ever checks that the
link resolves. A hallucinated citation carries the same badge weight as a
real one, forever: in the served report, in the 30-day cache, in the
permanent corpus, and in the accuracy backtest's ground-truth set.

Two prior facts bound the design (both from the corpus-audit work,
2026-08-05):

1. **51% of corpus rows cite hosts that hard-block server-side fetching**
   (measured 403 list: loopnet.com, cityfeet.com, propertyshark.com,
   commercialsearch.com). Fetch-and-demote across the board would
   mass-punish live sources behind bot walls.
2. **A dead link is not a false comp.** Listings rot naturally once a deal
   closes. The trustworthy signal is a link that is dead AT BIRTH: a URL
   that fails minutes after the model cited it was probably never real.

## Decision (three owner calls, 2026-08-09)

1. **Dead-at-birth demotes.** A comp whose source URL is verifiably dead at
   report time has its `source_type` demoted to `"estimate"` before the
   report is served, cached, or harvested. Links that rot later change
   nothing (a future audit sweep may surface them admin-side; deferred).
2. **The served report is fixed too**, not just the corpus row. The check
   runs between parse and serving, inside a hard time budget riding the
   existing 40-70s report wait.
3. **The retro sweep of existing corpus rows is deferred**, along with any
   /admin audit-card surfacing of link rot.

"Verifiably dead" is deliberately narrow: DNS name-not-found, HTTP 404, or
HTTP 410, and only on hosts not known to bot-block. 403, 429, any 5xx,
timeouts, TLS and network errors are all "unknown" and change nothing.
Under-claiming death mirrors the badge doctrine (a badge may under-claim
provenance, never over-claim it).

## Mechanics

### `link-check.js` (new pure module, covered by `npm test`)

Pure like entitlements.js and corpus-audit.js: no I/O, no fetch, no clock.
Owns every rule so the tests exercise the whole decision table:

- `checkableUrl(url)`: true only for http/https URLs with no embedded
  credentials whose hostname is a real multi-label name. IP literals,
  `localhost`, single-label hosts, and non-http schemes are never checked.
- `hostClass(url)`: `"blocked"` for the measured bot-wall list (loopnet,
  cityfeet, propertyshark, commercialsearch, costar, crexi, zillow,
  redfin, realtor.com and subdomains). Blocked hosts are never fetched and
  never demoted. Everything else is `"fetchable"`.
- `verdictFor(outcome)`: maps a fetch outcome (`{ status }` or
  `{ dnsNotFound: true }` or `{ error: true }`) onto
  `"dead" | "unknown" | "live"`. Dead only for dnsNotFound, 404, 410.
- `applyLinkVerdicts(payload, verdictsByUrl)`: returns the demoted-comps
  count and mutates matching comps' `source_type` to `"estimate"`. Skips a
  comp when it is already `estimate` (nothing to demote), when it carries
  `verified: true` (a broker's vouching in our own records outranks a
  rotted URL), or when its URL has no verdict. `source_url` is kept on the
  demoted comp as the audit trail of what was claimed.

### The fetch half (server.js, thin and impure)

`checkSourceLinks(comps)`:

- Collects unique `source_url`s that are `checkableUrl` and not `blocked`,
  capped at 12 per report.
- SSRF guard: `dns.promises.lookup(host, { all: true })` first; if any
  resolved address is loopback, private (RFC 1918), link-local, or
  unique-local, the URL is skipped as unfetchable (verdict unknown). These
  are model-supplied URLs and this server holds secrets; it must never be
  steerable at an internal address. Residual DNS-rebinding risk is
  accepted: the response body is never read and only the status code is
  recorded.
- One attempt per URL: HEAD, then a single GET retry only on 405, honest
  User-Agent (`CompNinjaLinkCheck/1.0 (+https://compninja.co)`), all
  requests in parallel under ONE AbortController with a 2,500ms budget.
- Any helper-level error resolves to an empty verdict map: the report
  ships exactly as it would have before this feature existed.

### Placement

In `/api/comps`, immediately after the parse + `normalizeSourceTypes` step
and BEFORE `storeCachedSearch`, `harvestComps`,
`maybePublishMarketSnapshot`, and the `gate()` serialization funnel. One
check point means the visitor's badges, the cached copy, the corpus rows,
market snapshots, and shares all agree. Cache hits never reach it (their
payload was checked when stored). The retry/salvage/repair parse paths run
it only on the final successful parse. If the Market Explorer's pipeline
shares this normalization point it inherits the check; if it does not,
v1 is the report path only and the Explorer is noted as a follow-up
(confirmed at plan time).

## What deliberately does not change

- **No backtest change**: a demoted row is `estimate`, which
  `GROUND_TRUTH_TIERS` already excludes.
- **No retrieval change**: corpus-first usability already rejects
  `estimate` provenance.
- **No migration**: no new columns anywhere.
- **No UI change**: the existing badge system renders the demoted type.
- **The SSE preview is unaffected**: `comp` progress events deliberately
  carry no `source_type`, so nothing the preview showed gets walked back.

## Observability

- One log line per report with demotions:
  `🔗 N comp(s) demoted: source link dead at harvest (M checked, K blocked-host, J unknown)`.
- One PII-free `link_check` analytics event per report that had at least
  one checkable URL, carrying counts only (checked / dead / unknown /
  blocked). This is how the hallucinated-citation rate gets measured
  without tailing Render logs.

## Deferred (recorded, not designed)

- Background rot sweep over existing corpus rows + an /admin corpus-audit
  finding class for it.
- Any per-comp UI marker distinguishing "demoted for dead link" from an
  ordinary estimate.

## Testing

- `test/link-check.test.js` covers the pure module's whole decision table:
  checkable/uncheckable URL shapes, blocked vs fetchable hosts, every
  verdict mapping (404/410/dnsNotFound dead; 200/301-chain live; 403, 429,
  500, timeout, error unknown), and `applyLinkVerdicts` (demotes, keeps
  `source_url`, skips verified, skips existing estimates, count returned).
- The impure half is exercised by a small node script run manually at
  implementation time against known-answer URLs (a 200, a 404, a blocked
  host that must be skipped, a private-IP hostname that must be refused).
  It is kept thin enough that the pure tests carry the logic.
- `test/routes.test.js` is unaffected (the server boots with no network
  and no key; the check only runs inside a successful search).
- Live proof after deploy: one fresh billed search; the log line and the
  `link_check` analytics event appear, and any demoted comp renders with
  the Estimate badge.
