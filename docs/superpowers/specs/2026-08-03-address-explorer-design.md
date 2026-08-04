# Address Explorer — design

Approved by the owner 2026-08-03 (name is owner-chosen; deliberately distinct
from Market Explorer, which analyzes whole markets — this hands out specific
addresses to value).

## Problem

The tool is useless until a visitor types an address. Customers scouting a
market they don't own in, and employees running demos, often have none handy
and bounce before seeing a report.

## What it does

On the main app, under the address field, a quiet link: "Not sure what to
value? Explore addresses in a market." It opens a small inline panel:

- One text input accepting either `City, ST` or a 5-digit zip.
- A property-type select (defaults to the form's current type).
- "Find addresses" returns a stable list of up to 8 real, street-numbered
  addresses for that market as clickable entries.
- Clicking an address fills the search form (address + type), closes the
  panel, and submits the normal valuation flow. Nothing about the search
  path changes.

## Address sources (in order)

1. **Comp corpus** (server, $0): new `GET /api/explore-addresses?city=&state=&type=`
   reusing the `corpusRowsForMarket` read. Server filters to addresses with a
   leading street number, dedupes by normalized address, sorts newest deal
   first then alphabetically (deterministic), caps at 8. Rate-limited per IP;
   any error returns `{ addresses: [] }`, never an error page. Logs a
   PII-free `explore_addresses` analytics event (market + type only).
2. **OSM Overpass** (browser-direct, top-up only): when the corpus returns
   fewer than 8, the client geocodes the city center (existing `/api/geocode`
   proxy, then Nominatim fallback) and queries Overpass for buildings of the
   matching type carrying `addr:housenumber` + `addr:street` within ~8 km.
   Same two public endpoints and localStorage-cache pattern as
   `snapMarkersToBuildings`. Results sorted by OSM id so every visitor sees
   the same list. Type→tag map: Industrial → industrial/warehouse, Office →
   office/commercial, Retail → retail, Multifamily → apartments, Residential
   → house/detached/residential. Land has no Overpass fallback (parcels
   rarely carry addresses); corpus only.
3. **Zip resolve**: a 5-digit input resolves to city/state client-side via
   the free keyless `api.zippopotam.us`, then proceeds as above.

## Why stable lists (economics)

Every visitor exploring the same market+type sees the same addresses, so
clicks concentrate: the first click on an address bills one normal search
(~$0.36), and every repeat click within the 30-day search-cache TTL is a free
instant cache hit. No new billable paths: the only Anthropic call remains the
standard search the visitor explicitly triggers, still behind the per-IP
limiter and `DAILY_SEARCH_CAP`.

## Deep link

`/?explore=City,%20ST&type=Industrial` opens the panel prefilled and fetches
the list (does NOT auto-run a search). Lets market pages and campaigns adopt
the explorer later without new server work. Handled client-side; `GET /`
already matches on path only, so the query string is safe.

## Out of scope for v1

- "Instant report" badge on already-cached addresses (needs per-address
  cache probes; possible later).
- Market-page integration beyond the deep link.
- Any change to Market Explorer, the prompt, or search pipeline.

## Files

- `server.js`: one new route, placed with the other API routes; no new deps.
- `index.html`: panel markup + JS (`exploreAddresses` section), reusing
  existing utility classes so no tailwind.css regen is needed.
- `devlog.json`: feature entry.
