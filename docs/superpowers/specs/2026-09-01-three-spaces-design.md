# Three Spaces — the workspace/vault split and the building entity

**Status:** living spec for the Three Spaces program (plan:
`~/.claude/plans/could-you-help-me-mighty-crane.md`). Slices 1 and 2 shipped
on `feat/three-spaces-vault` (PR #246); this document is written at slice 3
and grows with the slices that build on the building entity. The firm
messaging half of the program has its own spec,
`2026-09-01-firm-messaging-design.md`, and shipped ahead as migration 044.

## The three spaces

| Tab | Whose data | What it answers |
|---|---|---|
| **Workspace** (`/desk`, and `/` for a member) | the **firm's** | What has this company transacted on, what buildings do we work on, what leases do we hold |
| **Vault** (`/vault`) | **yours** | What am I researching, what have I collected, what am I ready to push to the firm |
| **Messages** (`/messages`) | **shared, deliberately** | Talking to colleagues about a specific deal |

Two things are genuinely new in the data model and this program builds them:
a **firm-scoped building entity** (this document) and a **firm-scoped lease
record** (slice 6). Everything else is composition and relocation of things
that already exist.

## The building entity (migration 045, slice 3)

### Why a table and not a derived list

A building sheet must be **linkable** — from a message, a lease reminder, a
colleague's note — and an address string is not an id: `1210N17th st` versus
`1210 N 17th st Boise Idaho 83702` is the incident that produced
`portfolio-match.js`. And `org_comps` stores the address inside its `comp`
jsonb, so filtering a firm's comps by building without a table means pulling
the firm's entire comp set on every sheet open.

### Why it does not breach the privacy wall

Migration 016's rule is untouched: two brokers on one building get
**separate** `broker_properties` rows, because deduplicating them would make
one broker's activity inferable from the other's. An `org_buildings` row is a
different act — a member *choosing* to put a building on the firm's board.
Structurally it is the third opt-in of the same shape as
`POST /api/share {visibility:"org"}` and `POST /api/vault/firm`: a new table,
read and written by new functions, so no `user_id=eq.` read is widened and
`test/org-routes.test.js`'s `or=(user_id\.eq` scan stays satisfied by
construction.

**The rule that keeps that true: nothing creates a building as a side
effect.** A row is created only by an explicit route call carrying a member's
session. `linkVaultProperties()` never touches the table, and
`test/org-routes.test.js` fails the build if the table is named anywhere in
`server.js` outside its read function and its route block. If a row appeared
from an upload, a colleague could read another's book by watching the list.

### Two keys, deliberately, and no third

- `address_key` — the natural key; it is what `broker_comps` and
  `broker_properties` already carry (`broker-vault.js`'s `addressKey`), and
  comps are the sheet's largest section.
- `verified_key` — nullable; `portfolio-match.js`'s `verifiedKeyFor`, so a
  `portfolio_items` / `recent_searches` row can be matched to a building.

Both functions are **injected** into the pure `org-buildings.js` rather than
required, and the browser's "already on the board" check reads the keys the
server sends rather than computing one. No third key exists anywhere.

### What may be stored (`org-buildings.js`, pure)

`normalizeBuilding(input, { addressKey, verifiedKeyFor, marketOf, hasMarket,
types, year })` refuses rather than guesses, broker-vault.js's rule: a
building with no street number is a city; an address the market parser cannot
place is refused rather than filed under nothing; the type is the vault's
vocabulary; size is square feet or nothing ("1.2M" is refused); year built is
a four-digit year in a sane window; a location is a lat/lng pair or nothing.
`market` is attached with `marketOf()` so it agrees byte for byte with
`comp_corpus.market`.

`toBuilding(row, viewerId)` is an allowlist (vault-api.js's rule).
`summarize(rows)` produces the one line the desk and the subpage both quote
("14 buildings · 6 Industrial · 5 Retail · 3 Office"), always for the whole
set. `OVERFLOW_AT = 8` and `MAX_BUILDINGS = 1000` are the plan's thresholds.

### Routes

`GET|POST|DELETE /api/org/buildings?id=<org>` (delete takes `&building=<id>`),
on the existing `openOrg` + `memberOf` gate — no fourth copy of the
401/403/503 ladder. The whole set is returned (≤1000, `truncated` said);
there is deliberately **no server-side `?limit=8`** — the shelf's rule that a
page must always be able to say how much it is not showing.

`POST` is **idempotent** on `(org_id, address_key)`: a repeat add answers with
the existing row and `existed: true`. The one thing a repeat may change is a
`verified_key` the stored row never had, which is **filled, never rewritten**
(035's rule). Attribution stays with the first adder.

Any member may remove a building. The delete is scoped by `org_id` as well as
`id`, so knowing a building's id is not enough to take it off another firm's
board.

### On screen

`#deskBuildings` sits at the **top** of the firm deck — buildings are the
firm's index, the shelf is its output. It fills from work already visible:
an "Add to firm" door on a firm shelf row, plus an address form. The
portfolio moved to the Vault in slice 1, so its rows carry the same door
there (`firmDoorCell` in vault-page.js), carrying the row's verified key. The door renders only for a member
of a firm and only for an address not already on the board (the Buy-button
rule). A failed read hides the section rather than rendering an empty list —
"no buildings" and "could not reach the database" must never look the same.

### Deploy order

Migration 045 must run **before** the code deploys. Every read names its
columns in a PostgREST `select=`, so an unrun migration makes the buildings
routes answer 503 — and *only* them; nothing else reads the table
(`test/org-buildings-run.test.js` proves the blast radius). The migration
also adds a nullable `org_contacts.building_id` that **no code reads yet**;
naming it in `orgContactRows`' `select=` before the migration has run would
take every contacts read down with it.

## The buildings subpage (slice 4, no migration)

**The owner's overflow rule.** The Workspace's buildings section always
states the count for the **whole** set, then renders at most **eight** rows,
most-recent-activity first (the server's `updated_at desc`). Past eight, and
only past eight, one control renders: `#buildingsMore`, a link reading
"See all 14 buildings →" to `/buildings`. Under eight it does not render at
all (the Buy-button rule). The threshold is `index.html`'s existing
`COLLAPSE_AT`, and `org-buildings.js`'s `OVERFLOW_AT` mirrors it — a test
holds the two together, because index.html cannot require the module.

**`/buildings`** (`buildings-page.js`, `renderBuildingsBody(boot)`) is a
marketShell body like `/bulk` and `/messages`: no Tailwind utilities, its
stylesheet in the body after `MARKET_CSS`, every custom property a theme
token. The route follows the messages route's boot pattern — the first
answer rides down with the page (401 sign in / 403 no firm / 503 outage /
200 the list), `no-store`, `vary: cookie`, `noindex`, matched on
`pagePath` — and the boot payload is the **same** `GET /api/org/buildings`
answer the Workspace reads: one read, one count, so the two pages can never
disagree. The page filters in the browser (search box + type select,
revealed at six rows, the shelf's number), states the filtered count
separately ("3 of 7"), and never lets the header count follow the filter.
Remove works here too, through the same DELETE. `CTA_FREE_PAGES` gains
`/buildings`: it is a page a member works in.

**Deliberate asymmetry.** The portfolio (now on the Vault) gets the other
idiom, the history list's fold. A firm's buildings are a shared record with
search needs and earn a page; one member's portfolio is a short personal
list and earns a fold.

### Deliberately not in slice 3

- ~~The overflow rule and the subpage~~ — shipped as slice 4, above.
- The building sheet (`composeSheet`) and building notes (046) — slice 5.
- An "Add to firm" door on a **comp row** inside a report — deferred with the
  sheet, where a comp's building becomes something to look at.
- Editing a building's fields after it is on the board — the sheet's job.
