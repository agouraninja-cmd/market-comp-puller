# Private comps must stop being geocoded by address

**Date:** 2026-08-06
**Status:** AGREED 2026-08-06. Section 3's shape stands; section 7 is answered
in favour of step 1 plus the two display guards, with import-time geocoding
deferred. Both halves can be built against this. Scoped OUT of v2, which closed
2026-08-06 — this is the first piece of work after it.
**Owner of the storage + ingest half:** Owen · **Owner of the display half:** Jacob

This is the same shape as the blended-comps data contract: agree the seam, then
both halves get built against it without either waiting.

---

## The problem in one line

A broker's private vault comp is geocoded **by address, from the broker's own
browser**, on every report that includes it, so the address of an off-market
deal leaves in a URL query string and reaches a third party, purely to place a
map pin.

---

## 1. What actually leaves today

Traced through the code on `main`, not assumed. For **one** private comp on a
report:

| Hop | What is sent | To whom | In a URL? |
|---|---|---|---|
| `GET /api/geocode?address=` | full street address | our own server, so the platform's access logs | **yes** |
| forwarded by that route | full street address | US Census Bureau geocoder | yes |
| Nominatim fallback, only when Census misses | full street address **plus the broker's IP**, browser-direct | OpenStreetMap Foundation | yes |
| Overpass footprint snap | coordinates only | overpass-api.de | no (POST body) |
| Street View | coordinates only | Google, via our proxy | yes, but coords only |

Only the first three carry the **address**. The last two carry coordinates,
which is a materially smaller disclosure and is not what this spec is about.

`geocodeAddress()` caches into `localStorage` (`geoCache.v2`), so it is once
per address per browser rather than once per page view. That reduces the
frequency and changes nothing about the exposure itself.

### Why this is worth fixing rather than accepting

It is pre-existing behaviour that private comps *inherited* — user-added
curation comps have always been geocoded this way. But two things make it
different now:

1. **The promise is stronger and it is being paid for.** The vault's whole
   pitch is "nothing here is ever read into CompNinja's records." A broker
   reasonably reads that as covering the address of the deal, not just the
   price.
2. **This repo already treats an address in a URL as something to avoid.**
   `POST /api/report-access` is POST *specifically* so that a searched address
   "never lands in a URL, a log, or a Referer header" (CLAUDE.md). The same
   argument applies here with more force, because these addresses are private
   by contract rather than merely personal.

---

## 2. The load-bearing discovery

**Putting coordinates in the vault CSV does not, on its own, stop any of this.**

`renderMap()` in `index.html` geocodes **every included comp unconditionally**:

```js
(includedComps() || []).forEach((c) => {
  if (c.address) jobs.push(geocodeAddress(compQuery(String(c.address))).then(...));
});
```

There is no check for coordinates the comp already carries. Model-supplied
`lat`/`lng` are treated only as a first-paint approximation that geocoding then
refines, which is correct for public comps and wrong for private ones.

So supplying coordinates is necessary but not sufficient. **The guard in
`index.html` is the other half, and without it the storage work buys nothing.**
That is why this is a two-sided contract rather than a server task.

---

## 3. The shape

### Coordinates belong on the PROPERTY, not the comp

`broker_properties` (migration 016, Owen's) is already exactly the right table:
one row per building per broker, `unique (user_id, address_key)`, scoped by
`user_id` like everything else in the vault.

Two deals on the same building share one location. Putting `lat`/`lng` on
`broker_comps` would store the same pair N times and permit them to disagree,
which is the drift this repo puts ⚠ comments on elsewhere. It also means
**geocoding happens once per building, not once per deal** — a broker with
three deals on one property geocodes once, ever.

Migration 017, additive, in the style of 016:

```sql
alter table broker_properties
  add column if not exists lat numeric,
  add column if not exists lng numeric,
  -- How the coordinates were obtained. Not decoration: it is what lets the
  -- display half decide whether it may skip geocoding, and what makes a bad
  -- import correctable later without re-geocoding everything.
  add column if not exists geo_source text,      -- 'broker' | 'census' | null
  add column if not exists geocoded_at timestamptz;
```

Nullable, like `property_id` was, and for the same reason: migrations here are
applied by hand, minutes or hours from the deploy, and both orderings must work
with no window where a broker's upload fails.

### How they get filled, in priority order

1. **From the broker's own spreadsheet.** Add `lat` and `lng` to
   `OPTIONAL_SPEC_COLUMNS` in `broker-vault.js`. Many CRM and MLS exports
   already carry them. `geo_source = 'broker'`. This path contacts **nobody**,
   and the pin is more accurate than a geocode.
2. **Geocoded once at import, server-side**, for properties that arrive
   without them. `geo_source = 'census'`. The address still reaches Census,
   but: server to server rather than from the broker's browser, once per
   building rather than once per comp per browser, never in a URL the browser
   emitted, and **never to Nominatim**.
3. **Left null.** Then the display half falls back to today's behaviour for
   that comp, and nothing regresses.

### Validation

Reuse `parseNumber()`. Reject rather than guess, matching the module's existing
stance ("1.2M", Excel serial dates and day-first dates are all refused with a
line number rather than stored as a best effort"):

- `lat` in [-90, 90], `lng` in [-180, 180]
- **both or neither** — a lone `lat` is a mistake, not a partial answer
- `0,0` is refused. It is Null Island, and it is what a spreadsheet produces
  when a formula fails. A pin in the Gulf of Guinea is worse than no pin.

### How the coordinates reach the report

Through the seam, which is what `vault-api.js` was built for in #29.
`toApiComp()` lifts the property's coordinates onto the comp shape:

```jsonc
{
  "address": "1450 Mission Ave",
  "price_or_rate": 4250000,
  "private": true,
  "lat": 43.6150,          // <- from broker_properties, may be absent
  "lng": -116.2023,
  "geo_source": "broker"   // <- 'broker' | 'census', absent when unknown
}
```

`lat` and `lng` are names `index.html` already understands. `geo_source` is
new and is the field the display half's guard reads.

**This is the seam paying for itself:** storage moved in #31 and the dashboard
did not have to; now a property attribute becomes a comp field and the report
does not have to know a property table exists.

---

## 4. The rule that makes it safe

**A private comp is geocoded by address only when we have no coordinates for
it, and never by Nominatim.**

Two guards, both in `index.html`, both Jacob's:

1. **Skip.** A comp with `private: true` and finite `lat`/`lng` is excluded
   from the `renderMap()` geocode pass entirely. Its pin is placed from what it
   arrived with.
2. **No third-party fallback.** A private comp that still needs geocoding uses
   `/api/geocode` (our proxy, Census behind it) and stops there. On a miss it
   gets **no pin**, rather than falling through to Nominatim.

Guard 2 is a deliberate trade: some private comps in rural or unusual addresses
lose their map pin. That is the same call already made for Street View photos,
where the owner's standing rule is "the actual property or nothing" — and the
cost lands only on comps that arrived without coordinates, which the broker can
fix by supplying them.

### What must NOT change

- **Public comps keep today's behaviour exactly**, Nominatim fallback included.
  Nothing here is a general-purpose geocoding change, and a report with no
  private comps must be byte-identical to what it is now.
- **`/api/geocode` stays as it is for now.** Moving it to POST so the address
  leaves the URL is the right follow-on and has a precedent in
  `/api/report-access`, but it touches every caller (report map, market pages,
  the Explorer) and belongs in its own change, not bundled here.

---

## 5. What each half owns

| | Owen | Jacob |
|---|---|---|
| Migration 017 on `broker_properties` | ✅ | |
| `lat`/`lng` columns in the vault CSV template + `parseUpload` validation | ✅ | |
| Import-time geocoding, once per property, in `linkVaultProperties()` | ✅ | |
| `toApiComp()` lifting property coords onto the comp shape | ✅ | |
| `blend-comps.js` carrying `lat`/`lng`/`geo_source` through `FIELD_MAP` | ✅ | |
| Skip-geocoding guard for private comps with coordinates | | ✅ |
| Dropping the Nominatim fallback for private comps | | ✅ |
| Vault UI showing which properties lack coordinates | | ✅ |

### What Jacob can build against today

Same trick as the blended-comps contract. Take any report and append:

```js
report.comps.push({
  address: "1450 Mission Ave", date: "2026-03-14", transaction: "sale",
  price_or_rate: 4250000, size_sqft: 31000, price_per_sqft: 137,
  source_type: "broker_vault", private: true,
  lat: 43.6150, lng: -116.2023, geo_source: "broker"
});
```

If the guard works against that, it works against the real thing.

---

## 6. Test obligations

`broker-vault.js` and `vault-api.js` are pure and already tested, so all of
this is unit-testable with no database:

- A CSV row with valid `lat`/`lng` stores them; `geo_source` is `'broker'`.
- Out-of-range, `0,0`, and one-of-two coordinates are each **refused with a
  line number**, not silently dropped and not stored as a best effort.
- A property that already has broker-supplied coordinates is **not**
  re-geocoded at import, however many times its comps are re-uploaded.
- `toApiComp()` still answers byte-identically for a comp whose property has no
  coordinates. The feature is invisible until it has something to show, which
  is also what makes it testable.
- Import-time geocoding failure leaves `lat`/`lng` null and the upload
  **succeeds**. A geocoder outage must never fail a broker's import — the same
  stance `vaultCompsForReport()` already takes, where a vault read is an
  enrichment and never a reason to fail the thing someone is waiting on.

And the one that states the point:

- **No private comp's address appears in any outbound request** when its
  property has coordinates. That is the claim the whole change exists to make,
  so it should be asserted rather than reviewed.

---

## 7. The open question for Owen

**Is step 2 (import-time geocoding) worth building, or is step 1 enough?**

Step 1 alone is much smaller and contacts nobody, but it only helps brokers
whose export happens to carry coordinates, and we do not know what fraction
that is. Step 2 guarantees a pin for everyone at the cost of one server-side
Census call per building, which is also the point where a rate limit and a
retry policy have to be thought about.

Jacob's read: **build step 1 and the two display guards first**, ship them, and
add step 2 only if real vault uploads turn out to arrive without coordinates
often enough to matter. Step 1 plus guard 2 already removes the worst hop (a
private address going browser-direct to a third party with the broker's IP
attached), which is the part that is hardest to defend if anyone ever asks.

### ANSWERED 2026-08-06 (Owen): step 1 and the two guards. Step 2 is deferred.

Agreed with Jacob's read. Four reasons, recorded so the deferral is not
re-litigated from memory later:

1. **Almost the whole privacy win is in step 1 plus guard 2.** The worst hop is
   a private address going browser-direct to Nominatim with the broker's IP
   attached, and guard 2 removes it outright. What step 2 additionally buys is
   the address reaching Census from our server rather than from the broker's
   browser — real, but second-order, and not the claim this change exists to
   make.
2. **Section 7's own premise cannot be answered yet.** "We do not know what
   fraction of exports carry coordinates" is not resolvable today, because
   there are **no real vault uploads at all** — zero broker profiles, zero
   subscriptions as of 2026-08-06. The first genuine upload will say more than
   any estimate, and step 2 is exactly the kind of work that should be bought
   with evidence.
3. **Step 2 is where the operational cost lives.** A Census call per building
   at import means a rate limit, a retry policy, and a new failure path on the
   one action a paying broker is watching happen. Section 6 already requires
   that a geocoder outage must not fail an import; that is a real obligation to
   own, and it should be owned when it is earning something.
4. **Nothing is wasted by waiting.** `geo_source` is already
   `'broker' | 'census' | null` in migration 017, so step 2 lands later as a
   pure addition — no migration change, no rework, no renegotiating this
   contract.

**Higher priority than step 2 when this is revisited:** moving `/api/geocode`
to POST, which section 4 deliberately scopes out. It removes addresses from
URLs for *every* comp rather than only private ones, it has a precedent in
`POST /api/report-access` (which is POST for exactly this reason), and it is
the same class of fix at a wider blast radius. Put it above step 2 on the
roadmap, not below it.

**So the build list is:** Owen — migration 017, `lat`/`lng` in the CSV
template + `parseUpload` validation, `toApiComp()` lifting the property's
coordinates, `blend-comps.js` carrying the fields through. Jacob — the two
display guards. Import-time geocoding (row 3 of section 5) is **not** in this
piece of work.
