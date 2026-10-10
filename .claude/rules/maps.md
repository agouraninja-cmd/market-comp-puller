---
paths:
  - "index.html"
  - "streetview-aim.js"
  - "building-photo.js"
  - "photo-token.js"
  - "test/photo-token.test.js"
  - "test/streetview-aim.test.js"
  - "test/streetview-run.test.js"
  - "test/building-photo.test.js"
---
# Maps, geocoding and Street View

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Street photos instead of the aerial (2026-10-09)

The owner: "show the actual pictures of buildings instead of the birds eye
view version ... make sure they are actual good pictures though", and then,
shown Home still almost all aerial, "it has to be a professional picture of
the building". Read this before the rest of the file, which it extends.

- **Home's thumbnails and map cards are looked up BY ADDRESS** (and The
  Board's deal cards were, until the deal wall left on 2026-10-09). The first build (PR #392, the same morning) found the building
  from OpenStreetMap footprints and failed most addresses: most US footprints
  carry no house number, and a big commercial building's middle sits beyond
  the 35 m camera rule. Google places an address on its parcel and, asked for
  an image with no heading, turns its nearest camera toward it, which frames
  the building where a point on the street in front of it framed the road.
  So the address goes to Google, **from our server only**: the owner's call
  ("Yes, all of them", 2026-10-09) for every property, deal and private comp,
  and CLAUDE.md rule 7 now names the route.
- **`POST /api/building-photo`** (signed in; up to 25 `{ address, lat?, lng? }`
  in the BODY; rate-limited) runs only Google's FREE metadata call per
  address (`location=<address>&source=outdoor&radius=75`, wider than
  Google's 50 because set-back buildings need it) and judges it with
  `SVAIM.judgeAddressPano`: Google's own camera (`copyright`), captured
  within 10 years, and, when the page sent our own geocode, within
  `ADDRESS_DRIFT_M` (250 m) of it, so the same street name elsewhere is
  refused. It answers `{ photos: [...] }`: a src, `null` (no good photo, or no
  street number, which never leaves the server), or `0` (Google refused US,
  a quota or key problem, which the page must not remember as "no photo").
  Judgments are cached per address HASH in memory (`STREETVIEW_ADDR_CACHE`).
- **The src is `GET /api/streetview?t=<token>`**: the address sealed with
  AES-256-GCM under a key derived from `GOOGLE_MAPS_API_KEY` (`photo-token.js`,
  deterministic so one address is one URL and one bill per browser for 30
  days; authenticated, so only a token this server minted opens). The route
  re-judges from the cache (or the free metadata again after a restart) and
  asks for the image with `location=<address>`, `radius=75`, no heading, and
  a fixed lens (`ADDRESS_FOV` 72°, `ADDRESS_PITCH` 8°, 640x384). Rotating the
  key invalidates every token: those cards fall back to the aerial and ask
  again.
- **`building-photo.js`** (browser global `BLDGPHOTO`, dual-exported,
  `maxAge: 0`, loaded by index.html; /vault loaded it for the deal wall until
  2026-10-09) asks
  the route a batch at a time, remembers each address's answer in
  `localStorage` `bldgPhoto.v2` (a src, `ok` once it has loaded, or a miss
  retried after 7 days; a refused call and a `0` are not remembered), and lays
  the photo into an empty card (`overlay`: fades in the first time, simply
  there once known, removes itself on an image error and the page draws the
  aerial). **The aerial is never drawn first and the photo over it**
  (2026-10-10, the owner: "it is showing birds eye view first, then the
  building make it just show the building"): Home's card is an empty box
  until the answer, and gets the aerial only when there is no photo to show
  (Google has none, the image will not load, or the route could not be asked;
  `pending` tells a card Home drew again mid-lookup to keep waiting instead).
  `test/building-photo.test.js` runs Home's photo code against stand-ins to
  hold this. An
  address qualifies only with a street number naming a whole property
  (`eligible`, `unitDesignatorOf`), the popup's rule. It replaced the
  footprint version outright, and drops its old `bldgPhoto.v1` /
  `bldgPhotoState.v1` keys.
- **Home** (`hmPhoto`) asks when a card scrolls into view (`hmPhotoSeen`) and
  a map card the moment it opens; a property with no coordinates yet can
  still have its photo, since the address is enough. (The Board's deal
  cards asked the same way until the deal wall left on 2026-10-09.)
- **The report map's pin popups are unchanged**: they still aim by the snapped
  OSM footprint (`judgePano`, below), because the report's own geocoder label
  check makes that route sound there.
- **Every street photo passes a quality gate.** By coordinates (the popups),
  `judgePano`: Google's own imagery, captured within `MAX_PANO_AGE_YEARS`
  (10), a camera 4-35 m (`MIN_PANO_M`, `MAX_PANO_M`) from the building, aimed
  at it, the lens fitted by `fovFor`. By address, `judgeAddressPano` above.
- **⚠ `building-photo.js` carries copies of index.html's `houseNumberOf` and
  `unitDesignatorOf`**, written when /vault (which cannot load index.html's
  script) drew deal cards; `test/building-photo.test.js` runs both copies
  over the same addresses.
- **`STREETVIEW_API_URL`** (test-only, unset in production) points both
  routes at a stand-in. `test/streetview-run.test.js` proves: signed out is
  refused, the URL names no address, a numberless address never leaves the
  server, only the free call runs until an img asks, the image is asked for by
  address with no heading, a forged token never reaches Google, and a camera
  far from our geocode is refused. `test/helpers/boot.js` blanks
  `GOOGLE_MAPS_API_KEY` so no suite can bill Google from a developer's `.env`.
- **Found while building it:** Home's 48px thumbnails were drawn from a 96px
  aerial crop, so the property sat in the thumbnail's bottom-right corner.
  They are now cropped to their own size, centred.

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
