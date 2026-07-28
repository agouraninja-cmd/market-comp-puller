# Report curation (Curate This Report) — Design + Plan

Date: 2026-07-28
Status: approved by owner (plan-mode session; this doc is both the design
record and the implementation plan — the task list at the bottom is the plan)

Roadmap item #9, curation slice. The browse-the-database half of #9 remains
deferred behind a corpus-density milestone (see the friend-feedback roadmap
memory); this doc covers only report curation.

## Context

The friend's #9 ask was "browse the comp database, build your own comp set, generate a report, encode your own price-discovery read." The browse half is data-gated (corpus had ~80 rows as of 2026-07-27) and deferred behind a density milestone. This slice ships the half that needs no database: **curating the report you just ran** — exclude/restore comps, add your own comp, and record your own price-discovery read alongside the automated one. All $0-marginal client-side math, reusing the existing render pipeline.

**Owner-approved decisions:** free for everyone (no account gate); excluded comps stay visible greyed-out with a restore control (audit trail); user-added comps are client-only (never sent to the server, never harvested into comp_corpus). Curation is an *opinion* like the DCF assumptions: it persists in saved reports/portfolio and **stays in shares** (viewer sees the curated report + notes, but no curation controls). Calm UI; copy never advice; no "Adler".

**Zero server changes.** The share scrub (server.js:4329) is a denylist so `meta.curation` flows into shares by default — desired, and it can carry nothing private (content keys, user-authored comps, a direction/note pair).

## State shape + helpers (index.html, near `ensureAssumptions` ~2418)

```js
meta.curation = {
  excluded: ["addr|date|price", ...],   // content keys of MODEL comps only
  added:    [{ address, transaction, date, size_sqft, price_or_rate,
               price_per_sqft, notes, source_type: "user", user_added: true }],
  read:     { direction: "expanding"|"flat"|"contracting"|null, note: "" } | null
}
```

- `compKeyOf(c)` — mirrors server `corpusKeyOf` (server.js:1210): lowercased `address|date|price_or_rate`.
- `ensureCuration(meta)` — init/sanitize (re-stamp `source_type:"user"` on added comps so a hand-edited payload can't claim Verified).
- `includedComps()` — `currentComps.filter(c => !isExcluded(c))` — the single math accessor.
- **Merge point** in `renderResults` (3473-3477): `currentComps = parsed.comps.concat(cur.added)`, then stamp `_num`. Added comps ride ONLY in `meta.curation.added`, never in `data.comps` — that's the client-only enforcement. Model comp objects stay shared so the geocode write-back still persists.

## Which comp readers switch to `includedComps()`

Switch: hero saleComps (2109), `sellTodayEstimate` (2377 — feeds debt card + XLSX), chart (3008), map initial/rescue/refine (3185/3202/3353 — don't geocode ghosts), stat tiles sizes/spread/count (3408/3413/3427), `exportCsv` (4951), `exportXlsx` (4997).

Stay raw: `visibleComps()` (4514) and its consumers — table, mobile cards, legend, count, sort FLIP — so excluded rows render greyed. `renderComparison` + the "Avg $/SF" tile (3426) deliberately unchanged: they show the MODEL's market-level `avg_price_per_sqft`, not comp-set math (add a code comment saying curation doesn't move it).

## UI

- **Row control**: a trailing actions cell appended at render time in `renderTableBody` (NOT a COLUMNS entry — exports map over COLUMNS). Model comps: quiet "Exclude" / brand-colored "Restore"; added comps: "Remove" (deletes from `curation.added` — `excluded` holds model keys only). Mobile cards mirror it. Excluded rows get `.comp-excluded { opacity:.45 }` (new inline CSS beside `.rd-badge` variants — survives print + html2canvas).
- **Note**: `#curationNote` near the comp table (pattern of `#reviewedNote`): "Based on 4 of 6 comps — 2 excluded by you." / "1 comp added by you." NOT no-print (it's the audit trail). Shared copy: "…by the report owner."
- **Add-comp form**: `+ Add your own comp` button (clone `#rrAdd` styling), `no-print no-capture`, inline form: address*, Sale/Lease*, date*, size SF, price/rate*, $/SF (derived from price÷size when blank + sane), notes. Duplicate content-key blocked. Submit → push to `curation.added` + `currentComps`, stamp `_num`, `applyCuration()`.
- **Badge**: new LAST `SOURCE_TIERS` entry `user: { label: "Added by you", cls: "u", legend: "entered manually; not from CompNinja's sources" }` — `compTier` picks it up free. Shared label: "Owner-added". Hero trust line counts it separately (", N added by you").
- **Price read**: in `#driversCard` after `#priceDiscovery`: display block (label "Your read" / shared "Owner's read", prints/exports) + `no-print no-capture` controls (three direction chips in the `#txFilter` segmented pattern, click-active-to-clear, optional ≤140-char note). `renderValueDrivers(parsed)` → `(parsed, meta)`; one call site (3534). Direction whitelist mirrors 2967; textContent only.

## Recompute + persistence

`applyCuration()`: invalidate `lastPublished` (the share memo at 5267 is object-identity-keyed — must reset or re-shares serve the pre-curation URL), then renderOwnerHero, renderAnalysisCluster(false), renderMarketChart, renderStatTiles, renderTableHead/Body(false), updateCompCount, updateCurationNote, renderMap, persistCuration. No debounce (discrete clicks; map teardown is clean, geocache cushions).

Persistence: extend `persistAssumptions` (2454) to also sync `meta.curation` (+ add `if (currentMeta.shared) return;` — fixes a pre-existing hazard where shared viewers could touch a same-address local record). Extend the two meta whitelists: `saveReport` (4153) and portfolio save (3799-3803) gain `curation`. Recent-search chips and portfolio Refresh discard curation (re-searches; matches assumptions behavior — comment it).

## Edge cases (planned behavior)

Exclude below 2 sale ppsfs → hero falls through existing branches with new copy ("restore an excluded comp or add your own"); chart's own ≥2 guard hides it. Exclude all → recovery copy, all-grey table, subject-only map. Unparseable added price → stays in table/map, drops from math. Two identical model comps toggle together (matches server dedupe; comment). Alt-basis (units/acres): lean added comps contribute to $/SF only — honest. Legacy payloads normalize via `ensureCuration`. Sample report: controls live (harmless playground; persistence already skips sample).

## Exports

CSV/XLSX from `includedComps()`; confidence column shows "Added by you" automatically; CSV title row + XLSX Valuation sheet gain "4 of 6 — 2 excluded by report owner" and the owner's read row. PNG: extend `downloadImage`'s `ignoreElements` with a `no-capture` class convention; chrome excluded, greyed rows + note captured.

## Task order (each a focused edit; tasks 1–4 land invisibly, 5 is the first visible slice)

1. Helpers + merge point in `renderResults`.
2. CSS (`.comp-excluded`, `.card-excluded`, `.rd-badge.u`) + `no-capture` predicate in PNG export.
3. `SOURCE_TIERS.user` + shared-label switch + trust-line phrase.
4. Math consumers → `includedComps()`.
5. Table/cards actions cell + handlers + `#curationNote`.
6. Add-comp form.
7. `applyCuration()` + share-memo invalidation + persistence (extend persistAssumptions + 2 whitelists).
8. Price-read override.
9. Hero/empty-state copy.
10. Exports.
11. Shared-gating sweep (`!meta.shared`) + verification walk.

Also: write the spec + plan docs into `docs/superpowers/{specs,plans}/` per the #6–#8 convention, and add a CLAUDE.md note (curation-as-opinion boundary; Avg-$/SF-doesn't-curate).

## Verification (manual, local server + browser)

1. Baseline regression after tasks 1–4 (identical render).
2. Exclude/restore: hero range, trust line, chart, map pin, tiles all move; sort stays FLIP-stable.
3. Boundaries: down to 1 sale comp; exclude all; restore recovery.
4. Add comp: derived $/SF, badge last in legend, joins math/chart/map, duplicate blocked, Remove works, **DevTools Network shows zero requests on add**.
5. Read override renders beside automated read; chip-clear removes.
6. Persistence: reload + saved-chip reopen; portfolio round-trip; localStorage meta carries curation.
7. Share: curated numbers + greyed rows + owner labels, zero controls in private window; re-share after further curation mints a NEW url.
8. Exports: CSV/XLSX/PNG/print per above.
9. Alt-basis (Multifamily) and legacy saved report.

## Files

- `index.html` — all implementation (state ~2418, renderResults 3469, hero 2109/2244, chart 3008, map 3185, tiles 3406, table 4661, exports 4945, share memo 5267, persistence 2454/3799/4153, drivers 1165/2939).
- `server.js` — no edits (reference: corpusKeyOf 1210, share scrub 4329).
- `CLAUDE.md` — document the boundary decisions.
