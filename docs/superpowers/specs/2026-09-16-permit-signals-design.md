# Permit signals: what the permit tracker gives CompNinja, and what it does not

**Date:** 2026-09-16
**Status:** APPROVED 2026-09-16. Slices 1 and 2 (§8) BUILT the same day on
`feat/permit-signals`: `permit-portals.js`, `permit-zoning.js`,
`permit-filings.js`, migration `052-permit-filings.sql`, `POST
/api/permits/sweep` and the /admin card. Slices 3 and 4 not started. Three
amendments from the build are marked **[built]** below: the match key is
the street line (§4), the stored shape (§5), and Nampa is switched off (§3).
**Owner:** unassigned
**Source project:** the private GitHub repo `agouraninja-cmd/adler-permit-tracker`
(created 2026-07-17, last pushed 2026-08-10). It is not checked out on any
machine this repo is developed on; every claim below about it was read off
GitHub on 2026-09-12.

This complements the market-ranking spec
(`2026-09-01-market-ranking-design.md`), which names permit counts and permit
valuation as demand signals for four of the six property types and has no
source for any of them. It does not replace that spec's Census BPS plan:
BPS is county-level counts for the whole country, and this is permit-level
detail for three cities. They answer different questions.

---

## The decision in one line

Bring the permit tracker's DATA into CompNinja through two narrow doors —
the firm's building sheet and the development shop's morning — and leave the
tracker itself running for Adler exactly as it is. Do not merge the app.

---

## 1. What the tracker is

Traced off the repo, not remembered.

- **A permit-status watcher** for Boise, Meridian and Nampa. A hand-kept list
  of permit record numbers is checked hourly on business days against each
  city's public portal — Boise and Meridian on Accela CitizenAccess
  (`scrapers/accela.js`), Nampa on Tyler EnerGov Self Service
  (`scrapers/energov.js`) — and the team is emailed when a status changes.
  Two statuses are high priority by default (Review Complete, Prep for
  Issuance), configurable per status.
- **A competitor watch** (`discovery.js`). Once per business day it scans the
  same three portals for NEWLY FILED commercial permits (Accela: a fixed list
  of permit-type dropdown values per city; EnerGov: a CaseType regex),
  resolves each Boise/Meridian parcel's ZONING DISTRICT from the Ada County
  ArcGIS parcel layer (`zoning.js` — one GET per parcel number, no geocoding),
  decides "industrial" from the zoning where known and from a keyword regex
  where not (Nampa is Canyon County, which has no parcel service wired up),
  captures the applicant and contractor company where the portal exposes it,
  stores each filing exactly once (`competitor_permits`, unique on
  jurisdiction + permit number), and emails one digest.
- **Zero dependencies, plain Node 18+, Supabase with a `data.json` fallback,
  a tiny `.env` loader that runs before the other modules, hand-written CSS
  with no Tailwind.** The same shape as this repo, which is why porting a
  module is a copy rather than a rewrite.
- **No AI call anywhere.** A check costs nothing per run. The whole thing is
  HTTP against public government portals plus one public county GIS service.

Three facts about it that shape everything below:

1. **It is Adler-shaped.** The page is titled "Adler's Competitors", the
   watched permits are Adler's own projects, and the notify address is the
   team's. None of that belongs in CompNinja (CLAUDE.md: do not reintroduce
   Adler anywhere). The scraping and zoning LOGIC is not Adler-shaped.
2. **It is three cities.** CompNinja sells nationally. Anything built on this
   data lights up in one metro and is dark everywhere else, and the product
   has to say so or it reads as broken.
3. **Scrapers rot.** Accela and EnerGov change their markup, and the tracker's
   own comments record tuning against live CaseType strings "after week 1".
   Standalone, a broken scraper costs Adler a check. Inside CompNinja it is a
   support ticket from a paying firm.

---

## 2. Where permit data earns a place in CompNinja

Two homes, ranked. Both already exist; neither needs a new noun.

### 2a. The firm's building sheet (first)

`GET /building/<id>` (Three Spaces slice 5) already composes a building's
comps, valuations, contacts, notes and LEASES, and the desk strip's Critical
dates cell already counts the lease dates due in the next twelve months
(`criticalDates` in `org-leases.js`, read through `GET /api/org/leases`). A
permit filed on that building — a tenant improvement, a shell, an addition,
a status moving to Prep for Issuance — is the same kind of fact as a lease
expiry: something happening to a building the firm has chosen to watch, with
a date on it. The shelf's whole pitch is that the firm's record is in one
place.

What it would look like: a **Permits** section on the building sheet listing
filings matched to that building, each with type, status, applied date,
applicant/contractor company where the portal gave one, zoning, and a link to
the portal record; and a status change inside the window joining the
Critical dates strip beside the lease dates.

### 2b. The development shop's morning (second)

`orgs.kind = 'development'` is a firm kind CompNinja supports and gives
almost nothing to: a Land default on the shelf and a different set of nouns.
The competitor watch IS the development shop feature — newly filed commercial
permits on industrial-zoned land, with the applicant named, once a day. It
would render as a **New filings** section on the workspace for a development
shop whose coverage includes a supported city, and nowhere else.

### What is deliberately NOT a home

- **The public market pages.** Permit-filing volume is a real momentum
  signal, but the market-ranking spec's area 1 is "public, identical for
  everyone, national", and three cities of scraped detail is none of those.
  When Census BPS lands under that spec, permit COUNTS reach every market
  page from the same source; this data does not need to get there first.
- **The comp report.** A permit is not a comparable and never enters the
  valuation, the corpus, or the model's prompt.

---

## 3. What ports, and what stays behind

**Ports, as pure tested modules** (the `broker-vault.js` shape: no I/O, the
fetch injected):

- `scrapers/accela.js` and `scrapers/energov.js` — the two portal clients.
  The HTTP goes behind an injected `fetch` so `npm test` replays captured
  portal responses the way `test/fixtures/gemini-stream-frames*.json` replays
  a vendor stream, and a markup change is diagnosed by re-capturing rather
  than guessed.
- `zoning.js` — `baseZone`, `isIndustrialZone`, the Ada County parcel lookup.
  Already written never to throw.
- `jurisdictions.js` — the registry. Renamed and the Adler-specific comments
  dropped; the three entries and their verified permit-type values are the
  asset.
- The industrial keyword fallback and the EnerGov include/exclude regexes
  from `discovery.js`.

**Stays behind, in the tracker:**

- The hand-kept watch list of Adler's own permits, the per-status notify
  levels, `checker.js`, `mailer.js`, `notification-rules.js`, both pages, and
  every email. CompNinja's version watches BUILDINGS a firm put on its board,
  not permit numbers somebody typed.
- The `competitor_permits` table and `data.json`. CompNinja gets its own
  table (§5), scoped the way every firm table is.

**[built] What the live capture taught the port** (2026-09-16,
`scripts/capture-permit-fixtures.js` against the real portals): Meridian
pages its result grid at ten rows and a 7-day tenant-improvement search
overflowed it, so the client follows the pager's Next postback up to five
pages rather than reading page one; a single exact hit's detail page prints
the address with a footnote asterisk and no comma before the city, both now
normalized so the detail path keys like the grid path; and **Nampa's Tyler
host answers 403 to any non-browser user agent** (an AWS load balancer in
front of it; the tracker's own agent string is refused too). It ships
`sweep: false` in the registry with the reason recorded. Disguising the
sweep as a browser to pass a filter the operator chose is not a call the
code makes; it is the owner's, and it is added to §9.

**Runs nowhere in CompNinja's process on a timer.** The tracker piggybacks
discovery on an hourly cron hitting its own `/api/run-check`. This repo's
rule for the only other self-initiated job, the watchlist digest, is the one
to copy: an `ADMIN_KEY`-gated `POST /api/permits/sweep` that a Render cron or
an Action drives from outside, idempotent so a double fire is a no-op, with
a Preview that stores nothing. A `setInterval` fires at an hour nobody chose,
again after every deploy, and twice on two instances.

---

## 4. Matching a filing to a building

This is the part with a real rule in it, and it is the vault's rule.

A filing arrives with a portal address string. A building on a firm's board
has the vault's `addressKey` (the same key `org_buildings` is unique on, per
`org-buildings.js`). **[built] The key is the STREET LINE, not the whole
address**: a portal prints "8000 S FEDERAL WAY" (or "8000 S FEDERAL WAY,
Boise ID 83716") and a board row carries "8000 S Federal Way, Boise, ID
83716", so the two whole-address keys never agree. `permit-filings.js`'s
`streetKey` is `addressKey` over everything before the first comma, stored
on the filing as `street_key` and computed on the building side by the SAME
function at read time. The match is **`streetKey(filing) ===
streetKey(building)`, within the same market**, and nothing looser:

- **Miss rather than guess** (portfolio-match.js's argument). A missed
  permit costs a firm one row they can find on the portal themselves; a
  permit attached to the wrong building tells a firm somebody is building on
  their client's site when nobody is.
- **No geocoding on the match path.** The portal address is public record,
  so sending it to Census would not breach the private-comp wall — but a
  proximity match is a guess with extra steps, and two buildings on one
  parcel are routine in industrial. The parcel number is a better second key
  where the portal exposes it; that is a follow-on once the first slice has
  shown how often the address key alone misses.
- **A filing that matches no building is still stored** (it is the
  development shop's feed), and it is matched again on every sweep, so a
  building added to the board on Tuesday picks up Monday's filing.

Coverage is decided the way the lead inbox decides it: a firm sees permit
sections only when one of its buildings is in a supported city, or (2b) when
its coverage names one. `METRO_GROUPS` already knows Boise, Meridian and
Nampa trade as one market; reuse it, do not widen it.

---

## 5. Storage

One additive migration, next free number.

```
permit_filings                       -- [built] as migration 052
  id, jurisdiction, permit_number   -- unique together (the tracker's dedupe)
  permit_type, description, project_name
  address, street_key, market       -- street_key via streetKey (§4), market = the JURISDICTION's "City, ST" via marketOf
  parcel_number, zoning, is_industrial
  applicant_company, contractor_company
  applied_date, status, status_changed_at, source_url
  first_seen_at, last_seen_at

permit_filing_events                 -- one row per status move (the tracker's permit_events)
  id, filing_id, old_status, new_status, detected_at
```

Filings are **public record and not scoped to a firm** — every firm covering
Boise sees the same Boise filings, which is honest and is also why this is
not a vault-class table (no `user_id`, no privacy wall to defend). What IS
per-firm is the match, and that is a read, not a column:
`org_buildings.address_key` joined at read time inside the buildings route
block, the way contacts are joined by `building_id`. **Nothing writes to
`org_buildings`** — `test/org-routes.test.js` already fails the build if that
table is named outside its read function and route block, and a sweep that
created buildings would be the exact side-effect that rule exists to refuse.

Status history is the tracker's `permit_events` shape, one row per change,
because "when did it move to Prep for Issuance" is the question the Critical
dates strip asks.

---

## 6. Mail

**None in the first slice.** The watchlist digest is deliberately the only
thing this product sends on its own initiative, and CLAUDE.md's leases
section already records that which member at a firm gets a reminder is an
owner decision the plan defers. A permit status change is the same decision
with a different noun. The building sheet and the strip show it; nobody is
mailed. If the owner later wants the alert, it rides the existing digest's
machinery and its "is this worth sending?" bar, not a second sender.

---

## 7. Honesty on the page

Three cities means the product must say where the feature is dark, or the
absence of a section reads as a bug.

- The building sheet's Permits section renders **only** for a building in a
  supported city. Elsewhere it does not render at all — an empty "Permits:
  none" on a Dallas building would claim we looked.
- Where it does render, the section names its source and its last sweep:
  "From the City of Boise permit portal · checked 2h ago". A sweep that has
  not run in a business day says so rather than showing yesterday's list as
  current.
- The development shop's New filings section carries the supported-city list
  in its own header, so a shop covering Salt Lake reads "Boise, Meridian and
  Nampa today" and not an empty feed.

---

## 8. Slices

1. **Port and test** the four modules (§3) with captured fixtures. No routes,
   no table, no UI. Half a day, and it is the half that proves the scrapers
   still work against the live portals a month after their last commit.
   **[built 2026-09-16]** — and it did prove exactly that: two of three
   portals answered, the third had grown a bot wall, and the two that
   answered had two parsing gaps the tracker never saw (§3).
2. **Sweep and store**: migration, `POST /api/permits/sweep` behind
   `ADMIN_KEY` with Preview, the `permit_filings` table, an external cron.
   Verified by `/admin` showing a row count rising, the corpus-health lesson.
   **[built 2026-09-16]**, minus the cron, which is a Render or Actions
   setting the owner adds once migration 052 has run; until then the
   /admin card's "Sweep now" is the trigger.
3. **The building sheet**: the Permits section and the Critical dates join,
   Boise metro only, labeled. Run test in the building-sheet suite against
   the fake PostgREST, including the two-firm isolation case (both firms see
   the filing; neither sees the other's board).
4. **The development shop's New filings**, once slice 3 has a user.

Slices 1 and 2 are worth doing on their own even if 3 waits: a month of
stored filings is the evidence for whether 3 is worth building, and the
sweep costs nothing to run.

---

## 9. Owner calls this defers

- **Whether a broker shop gets New filings too.** A leasing broker wants to
  know about a new shell in their submarket as much as a developer does. The
  spec starts with the development shop because it has nothing else, not
  because the broker shop should not have it.
- **A fourth city.** Adding one is a registry entry plus, for a new platform,
  a new scraper client. Which city is a question about where the next paying
  firm is, not an engineering one.
- **The parcel number as a second match key** (§4), once the miss rate of the
  address key is measured rather than guessed.
- **Any alert email** (§6).
- **Whether to read Nampa's portal as a browser.** Its load balancer refuses
  a named agent and serves a browser one (§3). Passing that filter is a
  choice about someone else's terms, so the city stays off until the owner
  makes it — or until the portal answers a named agent again, which the
  capture script will show on its next run.

---

## 10. What was rejected

- **Merging the tracker's app into CompNinja.** Two pages, a watch list of
  one company's permits and a notifier, all Adler-branded. The code that is
  worth having is four modules; the rest is a different product for a
  different user.
- **Running the tracker's hourly loop inside server.js.** The digest rule.
- **A permit count on the public market pages from this data.** Three cities
  of scraped detail is not a national public signal; BPS is, and the
  market-ranking spec already owns it.
- **Matching filings to buildings by proximity.** A guess that puts a
  stranger's project on a client's site.
