# Street View photos in map pin popups — Design

Date: 2026-07-28
Status: approved by owner (Approach A — server proxy — chosen in chat; this
doc records it)

Clicking a map pin shows a street-level photo of that building above the
existing popup text. Photos come from Google's Street View Static API — the
one photo source licensed for exactly this use. Listing photos from the
comps' cited `source_url`s are copyrighted by their brokerages and are NOT
used, ever. The feature is popup-only (owner's choice): no photos in the
hero, the comp table, or anywhere else — the report stays calm and photos
cost nothing until someone clicks a pin.

## Decisions (owner-approved)

- **Approach A: server proxy.** The Google key lives only in the environment;
  the browser calls our own `/api/streetview` route, matching the
  `/api/geocode` pattern and the project's browser-never-sees-a-key rule.
- **Popups only.** Comp pins and the red subject pin alike. Zero requests
  until a pin is clicked (Leaflet builds popup DOM on open).
- **Graceful off switch.** `GOOGLE_MAPS_API_KEY` unset = route 404s, config
  flag is false, popups render exactly as today. Deploying before the key
  exists is safe — the feature is simply dark.
- **Failure-safe everywhere.** No imagery, Google error, rate limit — the
  photo just doesn't appear; the popup text always renders.

## Server (server.js)

**Env: `GOOGLE_MAPS_API_KEY`** — optional. Documented in CLAUDE.md's config
list. `GET /api/config` gains `streetview: !!GOOGLE_MAPS_API_KEY`.

**`GET /api/streetview?lat=&lng=`**

- Validate: `lat`/`lng` parse as finite numbers in [-90,90]/[-180,180];
  else 400.
- Rate limit: `rateLimited("streetview:" + clientIp(req), 60)`; 429 on trip.
  (A report has ≤ ~9 pins; 60 per window is generous for a human, tight for
  a scraper.)
- No key configured → 404 immediately.
- **Metadata first (free):** `GET maps.googleapis.com/maps/api/streetview/
  metadata?location=<lat>,<lng>&source=outdoor&key=…`. Anything but
  `status: "OK"` → 404. Result cached in an in-memory Map keyed by
  `lat,lng` rounded to 5 decimals (~1 m), so repeat clicks never re-ask;
  the map is capped (~500 entries, drop-oldest) since it lives for the
  process lifetime.
- **Image:** `GET maps.googleapis.com/maps/api/streetview?size=600x360&
  location=<lat>,<lng>&source=outdoor&fov=80&key=…`. Omitting `heading`
  makes Google aim the camera at the given point from the nearest pano —
  the "look at the building" behavior. `source=outdoor` skips indoor panos.
- Respond 200 `image/jpeg` with the fetched bytes and
  `Cache-Control: public, max-age=2592000` — repeat views of a report hit
  the browser cache, not Google.
- Any fetch error or non-200 from Google → 404, empty body. Never 500,
  never HTML.
- No analytics event: Google's console already meters usage, and pin clicks
  aren't a funnel we track. (Revisit only if quota questions ever come up.)

## Client (index.html)

- The config fetch already runs at boot; store the new `streetview` flag
  with the existing config state.
- `renderMap`'s two popup bindings (`addSubjMarker`, `addCompMarker`) switch
  from static strings to **function content** — `bindPopup(() => html)` —
  built at open time from `marker.getLatLng()`. This matters because
  `refinePins()` moves pins after first paint; the photo must show the
  final geocoded spot, not the model's block-level guess.
- When the flag is on, the popup HTML gains, above the existing text:
  `<img src="/api/streetview?lat=…&lng=…" width="260" height="156"
  style="display:block;border-radius:4px;margin-bottom:6px;object-fit:cover"
  alt="" onerror="this.remove()">`. `onerror` removal collapses the popup
  back to today's text-only look when the route 404s. Coordinates are
  numbers from `getLatLng()` — nothing user-authored, no escaping concern.
- Inline styles only (like the pin divIcons) — no new Tailwind utilities,
  no `tailwind.css` regen.
- Shared reports and the sample report use the same path untouched: the
  route is public and the sample's comps are real DFW addresses.

## Owner setup (one-time, before the feature lights up)

1. https://console.cloud.google.com/ → create a project (any name).
2. Enable **Street View Static API** (APIs & Services → Library).
3. Billing must be enabled (required even inside the free tier — currently
   10k Street View Static requests/month free).
4. Create an API key (APIs & Services → Credentials) and **restrict it to
   the Street View Static API only** (API restriction; no referrer
   restriction — the key is server-side).
5. Set a daily quota cap as a hard backstop (APIs & Services → Street View
   Static API → Quotas), e.g. 500/day — the same role the Anthropic spend
   cap plays.
6. Set `GOOGLE_MAPS_API_KEY` in Render's environment and in the local
   `.env`.

## What this deliberately does not touch

The comps prompt/response shape, the search cache key, the corpus, exports
(photos are popup-only, so CSV/PNG/print are unchanged), `/api/share`
payloads (photos are derived from coordinates at view time, nothing stored),
lead capture, and the map's tile layers.

## Plan

- **S1 (server):** env var + config flag + route + CLAUDE.md bullets.
  Checks: `node --check`; curl without key → 404; with a key → JPEG bytes,
  cache header present; bad coords → 400; ocean coords → 404; rapid calls
  → 429.
- **S2 (client):** config flag plumbing + function popup content + img
  markup. Checks: popups text-only when flag off; with key, popup img
  `naturalWidth > 0` for a known-covered address; `onerror` path leaves a
  clean popup.
- **S3:** end-to-end walk on the sample report (click every pin), shared-
  report spot check, commit, deploy on the owner's word — safe to deploy
  before the key exists.
