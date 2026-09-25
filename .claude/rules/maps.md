---
paths:
  - "index.html"
  - "streetview-aim.js"
  - "test/streetview-aim.test.js"
---
# Maps, geocoding and Street View

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `GOOGLE_MAPS_API_KEY` — optional; SET on Render since 2026-07-29 (key
  "CompNinja Street View" in the owner's Google Cloud project `compninja`,
  restricted to the Street View Static API only). When set, map pin popups
  show a street-level photo of the building via `GET /api/streetview` (a
  proxy so the key never reaches the browser; Google's free metadata check
  runs first so no-imagery spots cost nothing). Unset = the route 404s and
  popups use the keyless stitched-Esri-tile aerial close-up (`aerialThumb`
  in index.html) — which is also what a Street View 404 swaps in via the
  img's onerror.
  **A pin only gets a photo at all when its OSM building footprint exists
  AND its address starts with a street number AND that street number names a
  whole property rather than one unit of it** (`snapMarkersToBuildings` —
  one batched browser-direct Overpass query per report after pins settle,
  two public endpoints tried in order, cached in localStorage
  `bldgCache.v2`): the footprint is the one signal proving the photo shows
  the property. Geocoded points sit on the street centerline, so every
  unsnapped aiming strategy (raw point, Google address geocode) produced
  photos of roads/trees on rural reports — owner's rule is "the actual
  property or nothing," so no footprint = text-only popup. The street-
  number gate exists because submarket-estimate comps ("Financial District
  (general submarket estimate)") geocode to a district point and several
  snapped onto the SAME building — one Boston report showed one white
  column three times. It is deliberately NOT the shape-lenient
  `isAggregateAddress()` in server.js, which protects corpus DATA where
  numberless comps are still valid rows.
  Two further gates, both added 2026-08-13 after a Boise mobile-home report
  photographed a bike shop 81 m up the street (same incident as the $795,000
  valuation — see flow 3 under "Non-obvious flows"). **The footprint must
  PROVE the address** (`addr:housenumber` + `addr:street`, via the existing
  `osmNumberMatches`/`streetLooksSame` written for the type detector's
  Phoenix "Mandarin Super Buffet" bug): proximity cannot tell two sides of a
  street apart, let alone a shop from the trailer park beside it. Where
  NOTHING in range carries a house number the map cannot answer and the
  main-mass pick stands, so coverage holds in the suburbs where photos work.
  Among several footprints that all prove the address (one building mapped
  in parts) it still takes the main mass — a photo of the wrong wing is
  still a photo of the right building, which is why this is the PHOTO's rule
  and not the size estimate's. **And `unitDesignatorOf()` refuses outright**
  for an address naming one unit of a site (`Trailer 51`, `Apt 3B`, `SPC 12`,
  `#45`): geocoders silently drop the unit — Census answered "6728 W
  Fairview Ave Trailer 51" with "6728 FAIRVIEW AVE" — so no footprint at
  that point is provably the subject's, and 38 of them shared that number.
  It gates comps too, because the model returns unit addresses of its own.
  Its vocabulary is tested in both directions (`test/index-html.test.js`):
  loosened, wrong buildings return; tightened, ordinary streets lose their
  photos, and "Roomy", "Lotus" and "United Nations" all parsed as unit
  designators on the first pass.
  `bldgCache` went to **v2** with these: the snap now depends on the
  ADDRESS, not just the pin, so a key of coordinates alone held one answer
  for every unit of a park — and the bump retires the wrong-building snaps
  already sitting in browsers, the same reason `geoCache` went to v2.
  Spend guardrails: Google Maps API quotas are NO LONGER user-adjustable
  (the spec's 500/day quota-cap step is obsolete) — the backstops are the
  "CompNinja Street View cap" $5/month budget alert on the billing account
  (emails the owner at 50/90/100%), the route's per-IP rate limit, and the
  10k-photos/month free tier (a fully-hovered report uses ~6).

## Architecture

- `POST /api/geocode` (body `{address}`) — CORS pass-through to the free US
  Census geocoder. **POST, and there is no GET form** (2026-08-17): a query
  string lands in the platform's access logs and in every outbound Referer,
  and this route sees more addresses than any other — the subject plus every
  comp of every report — including the private vault comps that are geocoded
  here and deliberately nowhere else (GUARD 2 of the private-comp contract).
  The GET alias was removed rather than deprecated, because a door left open
  is one stale caller away from putting addresses back in URLs and nothing
  detects that. Comp pins are placed ENTIRELY from real geocoding — the model
  no longer returns per-comp `lat`/`lng` (dropped 2026-07-31 to shrink the slow
  report-writing burst; only `subject_lat`/`subject_lng` remain, for the
  map's first paint and the wrong-state sanity gate). Old cached reports
  still carry comp coords and render unchanged. The front-end places every
  pin from geocoding (this proxy, then browser-direct Nominatim as fallback,
  results cached in localStorage under `geoCache.v2`). Rate-limited per IP.
  The market pages' own comp map runs the same stack but caches under
  `mktGeoCache.v1`, and **the two stores must never be re-joined**: the market
  map needs pins only, so it stores no geocoder label, and a label-less entry
  read back by the app fails `geoLabelMatches` — the gate on subject photos
  and footprint sizing. They shared a key until 2026-08-04; a test in
  `test/routes.test.js` now holds the names apart.
- `GET /api/streetview?lat=&lng=` (an `?address=` form exists but the
  client no longer sends it — address aiming showed the road on unmapped
  parcels) — Street View photo proxy for the map pin popups. The client
  only asks for pins with a snapped OSM building footprint, aiming the
  camera at the footprint centroid. Metadata-checks first (free, cached
  in-memory), then streams the image with a 30-day cache header. No key /
  no imagery / any error → bare 404, which the popup img's `onerror` swaps
  for the keyless aerial (flag off = aerial directly, same footprint-only
  gate). Listing-site photos (Zillow/Redfin/Realtor.com) are OFF the
  table — copyrighted, scraping-banned, and litigated; Street View + Esri
  aerials are the licensed sources. Rate-limited per IP.
