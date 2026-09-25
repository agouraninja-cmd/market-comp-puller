---
paths:
  - "market-*.js"
  - "market-*.json"
  - "city-check.js"
  - "city-bounds.json"
  - "gen-market-seed.js"
  - "explore-*.js"
  - "broker-directory.js"
  - "scripts/*market*.js"
  - "scripts/fetch-city-bounds.js"
  - ".github/workflows/market-*.yml"
  - "test/market-*.test.js"
  - "test/markets-map-script.test.js"
  - "test/city-check.test.js"
  - "test/gen-market-seed.test.js"
  - "test/explore-*.test.js"
  - "test/broker-directory.test.js"
---
# Market pages and the Market Explorer

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Architecture

- **Broker directory on market pages** (2026-08-06). A market page slug IS a
  (market, property type) pair — `industrial-boise-id` — the identical key
  `broker_coverage` uses, so "who covers Boise industrial" renders on
  `/market/<slug>` rather than on a directory page of its own. Rules in the
  pure, tested **`broker-directory.js`**; the cached read is
  `BROKER_DIRECTORY` / `refreshBrokerDirectory()` / `brokersCoveringMarket()`
  in server.js, stale-while-revalidate like `MARKET_CREDIT` and for the same
  reason — market pages render synchronously and must never wait on the DB.
  **TWO CONSENTS, NOT ONE.** `broker_coverage` is which markets a broker wants
  *leads* from (015) — a working preference, **not** permission to publish
  them. `broker_profiles.public` is the opt-in and is false by default. It is
  enforced **twice**, in the query (`public=is.true`) and again in the module,
  so a bug in either alone cannot publish somebody; only a literal `true`
  counts. **NO CONTACT DETAILS EVER** — name, company, and a link to the
  profile they opted into. Do not confuse `brokersCoveringMarket()` with
  `findBrokersForMarket()`: the latter carries broker email and phone and is
  OWNER-facing only. Routing is owner-mediated; a public directory is the
  reverse of that.
- `GET /markets`, `GET /market/<slug>` — programmatic-SEO landing pages
  (directory + one page per market, e.g. `/market/industrial-ontario-ca`).
  The directory leads with the **momentum map** (see below) over its grid of
  cards; each card carries its market's momentum word beside the median.
  **Server-rendered, self-contained HTML** (own inline `<style>`, so they do
  NOT depend on the purged `tailwind.css`) built from `market-seed.json` —
  static data committed to the repo, so pages survive redeploys and serve
  instantly with no DB. **Every market page opens with a picture of its own
  city** (2026-08-21), resolved in `market-hero.js` in four steps: a curated
  Wikimedia Commons file, then a GENERATED one, then an Esri satellite aerial
  of the city's coordinates, then — only when there is not even a point —
  nothing. All photos are 3840×800, a 1920w `srcset` sibling, and a
  768×160 thumbnail for the `/markets` directory (a third stored size, because
  that page carries every market at once and scaling the 1920w files in the
  browser would make it a ~10 MB page). They are served from `market-heroes/`
  rather than hotlinked (Wikimedia asks not to be a CDN), with the credit and
  licence rendered on the photograph. `/admin/heroes` is the visual QA for BOTH
  photo layers, with a file-size/dimension grade in the tested
  `market-hero-quality.js`.

  **The grade skips a FILE, never a city** (`skipFilesFromRows` →
  `heroFor({ skipFiles })`, changed 2026-08-22). It was city-keyed while a city
  could only have one photograph; now that a curated pick and a generated one
  can both exist for one city, a city key would take the good one down with the
  bad. Not hypothetical: Ontario, CA's curated JPEG is an upscale of a 1600px
  original, so the generated layer is its understudy, and `/admin/heroes` marks
  a passing photograph that is not the live one **Standby**. The generator has
  the matching exception to "never generate for a curated city": it DOES run
  for one whose stored file fails the grade, measured off the bytes on disk
  (`curatedFileIsGood`), never configured. Commons has nothing better for
  Ontario as of 2026-08-22 — six HABS elevations of one packing house — so it
  stays on a satellite aerial, and the only remaining lever there is a decision
  nobody has made: whether a soft-but-real photograph beats a satellite tile
  (the 2026-08-15 rule says it does not).

  **The generated layer** is `market-heroes-auto.json` + `node
  scripts/auto-market-heroes.js` (`--city "Casper, WY"`, `--dry-run`,
  `--force`, `--limit N`, `--no-judge`). It exists because the Explorer
  publishes market pages from real searches, faster than anyone curates
  photographs for them: on the day it shipped, 21 cities were curated and 13
  live Explorer markets rendered with no picture at all. Per city it geocodes
  with Zippopotam (city-check.js's own service), gathers candidates from the
  English Wikipedia lead image, Commons categories, Commons geosearch and
  Commons search, ranks them on metadata (`market-hero-pick.js`), encodes the
  best, grades the encode, and **shows the finished crop to Claude**
  (`market-hero-judge.js`, ~a cent a city, `HERO_JUDGE_MODEL` to override) —
  the only step that can tell a skyline from a shopfront. Five rules:
  - **Its output is COMMITTED, like the curated files.** Render erases its
    disk on every deploy, so a photograph fetched at runtime would vanish; the
    script is run deliberately and its JPEGs and JSON go in the same commit.
    It is not part of `npm start` and requiring it starts nothing.
  - **Any verdict that is not a clear "good" ships no photograph.** A refusal,
    an unparseable answer, a failed call and an outright "bad" are one
    outcome: the satellite aerial, which is always right about WHERE the
    market is. A wrong good is a wrong city on a public page; a wrong bad
    costs a tile.
  - **Metadata cannot prove a city, so provenance does.** A Commons full-text
    hit must name the city in its title (searching "Casper Wyoming skyline"
    returns Skyline Drive, Virginia), and a geotagged photograph that does not
    name it must be within `NEAR_CITY_M` of the middle of it — the first run
    offered Agoura Hills a Library of Congress aerial of the Malibu coastline.
  - **The second crop is for a bad CROP, not a bad photograph.** A skyline is
    mostly sky, so the centred band can be mountains over a sliver of
    buildings while the picture itself is right (measured on Salt Lake City's
    lead image). A reviewer complaint about emptiness — and only that — earns
    one retry lower down the frame.
  - **Nothing in the generated file is believed on trust.** The file name
    becomes a URL under `/market-heroes/`, so it goes through the same
    `FILE_RE` the curated names do, and an entry missing its credit or its
    Commons title is unattributable and unused.

  **`.github/workflows/market-heroes.yml`** runs the generator monthly (and on
  a "Run workflow" button), then opens a PR with whatever it found rather than
  committing to main — a model approving a crop is not the same as somebody
  having looked at it. Unlike `ci.yml` it needs three repository secrets:
  `ANTHROPIC_API_KEY` for the reviewer, and the `SUPABASE_URL` /
  `SUPABASE_SERVICE_KEY` pair, without which it sees only the markets committed
  to the repo and would miss exactly the Explorer-published cities it exists
  for. It fails loudly on a missing secret rather than reporting "nothing to
  do". Setting them is Jacob's; the same command run locally needs nothing but
  the `.env` that is already there.

  **A market published since the last run of that script is still not blank**:
  `attachCityCoords` resolves the city's coordinates once at PUBLISH time (both
  the Explorer and the piggyback publisher) and stores them in the page's own
  payload, so the satellite aerial is available from the moment the page
  exists. It is deliberately resolved on the publish path and never on a
  render — a market page must never wait on a network call — and it fails
  open, leaving the page exactly as it was before this existed. Then: median/quartile $/SF, a cap-rate range, a
  market summary + `value_drivers` narrative, a recent-comps table (sortable,
  Sale/Lease filter; address links to `source_url` when the snapshot has a
  sanitized http(s) URL), and a CTA — owner valuation for anonymous visitors,
  Watch + CSV for signed-in ones. Op-ex, price trend, and a rent band render
  on a second ledger row when the snapshot earned them. Regenerate/expand with `node gen-market-seed.js`
  (edit its `TARGETS` list; it runs one cached search per market against a
  locally-running server and keeps only markets with ≥3 priced sale comps, so
  no thin pages). `sitemap.xml` lists `/`, `/markets`, and every market page.

  **The momentum map** (2026-08-25). `/markets` opens with a Leaflet map of
  the country, one pin per covered market coloured by that market's
  expanding / flat / contracting read; **clicking a pin** flies to the city,
  reveals its real municipal boundary washed in the city's momentum, and
  opens a card linking every market there. Each market page draws the same
  boundary under its comp pins, matching the "Momentum" badge already in that
  card's heading. The rules, in the order a future editor will trip over
  them:
  - **`freshDirection` (market-snapshot.js) is the ONE gate** for the
    three-word vocabulary and the 90-day expiry, on all FOUR surfaces: the
    Explorer dropdown badge, the `/markets` pins and cards, the market page's
    badge, and the wash under its comps. `test/routes.test.js` checks every
    one of them against `/api/markets` market by market — a second copy of
    the vocabulary or the age gate is what those tests exist to catch.
  - **Hollow/outlined is NOT flat.** No current read renders an outline
    making no colour claim, never grey's fill: "we don't know" and "the
    market is flat" are different statements. `market-area.js` decides the
    city-level claim when one shape holds several markets (see the
    pure-modules list above); `mixed` is grey inside an ink ring, and the
    legend swatch must keep matching what `areaStyle` actually DRAWS — it
    shipped as a green/red gradient that appeared nowhere on the map.
  - **`city-bounds.json` is COMMITTED**, like the market-hero JPEGs and for
    the same reason (Render wipes its disk on deploy, and a page surface must
    never wait on a network call at render time). `scripts/fetch-city-bounds.js`
    writes it deliberately — it enumerates seed + dynamic + Supabase markets,
    MERGES rather than clobbers, skips cities already stored, and takes
    `--city "Name, ST"` for one. The monthly `Market heroes` workflow runs it
    too, so an Explorer-published city gets its photograph and its boundary
    in the same reviewed PR.
  - **The two map surfaces make OPPOSITE trades on that file, deliberately.**
    `/markets` may eventually want every city's shape, so it lazy-fetches the
    whole ~110KB file on the FIRST PIN CLICK (never on page load). A market
    page wants exactly one city's shape, so it INLINES that geometry in its
    own blob (314 bytes for Ontario, ~6KB average) and fetches nothing.
  - **`areaStyle` (directory) and `boundaryStyle` (market page) are ⚠ MIRROR
    twins** — browser strings inside template literals cannot share code, so
    every number and token is a deliberate copy, and
    `test/markets-map-script.test.js` pins the two together plus the presence
    of every `DIRECTIONS` word in both.
  - **Every failure degrades to what existed before.** No boundary file, no
    entry for a city, a degenerate geometry, a blocked Leaflet CDN: the pins
    stand, the card still opens, and the comp pins still draw. A failed
    boundary fetch is never memoized (city-check's rule: ok and unknown
    memoize, an outage does not), so the next click retries.
  - **The reads expire on a CLIFF.** Every seeded page carries one
    `generatedAt`, so all of their momentum reads die on the same day
    (2026-10-12 for the current seed) and the map goes hollow at once.
    `scripts/check-market-freshness.js` reports the countdown and the weekly
    **`Market freshness`** workflow fails inside a 30-day window so somebody
    sees it coming; it needs no secrets. The only real fix is a regeneration
    (`npm start`, then `node gen-market-seed.js` — one billed search per
    market). **`scripts/derive-market-direction.js` cannot help**: it fills a
    MISSING direction from the page's existing trend sentence and never
    touches `generatedAt`, which is what the age is measured from. One
    consequence to know rather than fix: `/markets` is cached an hour for
    anonymous visitors, so on expiry day its pins can stay coloured for up to
    an hour after the badges elsewhere have gone dark.
- `POST /api/explore-market` — the **Market Explorer**: generates a
  `/market/<slug>` page on demand from the header search on the app page
  (one billed search per genuinely new market; results meeting the seed
  quality bar publish permanently to the Supabase `market_pages` table,
  thinner ones get a 30-minute in-memory `/market-preview/` page). Since
  2026-08-09 it **validates the city is real before the billed leg**:
  `city-check.js` (pure, tested) asks Zippopotam's keyless city endpoint
  and refuses unknown cities with a friendly 400 that never consumes the
  guest's free search or an `explore:` limiter slot. Three name variants
  are tried — as typed, punctuation-to-space, punctuation-stripped, each
  with leading "St "/"Ft "/"Mt " expanded — because measured GeoNames data
  is inconsistent about punctuation ("Coeur D Alene" answers 200 but "Lees
  Summit" is the stripped form); **do not "simplify" this to one variant**,
  strip-only shipped first and falsely refused Winston-Salem and Coeur
  d'Alene. Fails OPEN on validator outages (`DAILY_SEARCH_CAP` backstops);
  `ok`/`unknown` verdicts memoize per process, `unavailable` never does.
  Spec: `docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md`.
