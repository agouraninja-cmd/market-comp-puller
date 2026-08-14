# Auto-save reports to Portfolio; Pro sees the book of values

Date: 2026-08-13
Status: agreed
Touches: `index.html`, `server.js`, `entitlements.js`,
`test/entitlements.test.js`, `test/routes.test.js`, `test/index-html.test.js`,
`devlog.json`, `CLAUDE.md`

Source: "Save comp reports permanently for pro users." Approach A
(client auto-save into the existing portfolio). The $20 single-report
unlock is unchanged and out of this spec.

## 1. The problem

A finished report is easy to lose.

- **Recent searches** live in this browser: 10 full reports, 25 rows, gone
  on a new device. Older rows become Re-run (a billed search).
- **Portfolio** is already server-side and permanent, but only if the
  visitor clicks **Save to portfolio**. The button always inserts a new
  row, so a second click on the same address duplicates the card.
- The shared **search cache** expires in 30 days. After that, reopening
  means paying for a new search even when they already ran this building.

Portfolio is the right store. The client-sharing spec already forbade a
third "saved reports" table that would duplicate `portfolio_items`.

## 2. What this is not

- Not a new table, route, or share visibility. `POST /api/portfolio` stays
  the write path.
- Not versioned full reports. One row per address + type; a re-run
  replaces the payload and appends a value snapshot (the shape Portfolio
  already has). January's comps are not kept beside June's.
- Not a change to the $20 single-report unlock, checkout, or
  `reportUnlocked`. A $20 buyer still clicks Save if they want the
  property on My Desk, and they still see the Free desk (no dollar
  columns).
- Not a change to browser Recent searches, sharing, the 30-day search
  cache, or vault blending. Auto-save sends the same `{meta, data}` the
  Save button already sends, private comps included, user-scoped.
- Not auto-save of a shared link, the sample report, or a report reopened
  from history / Portfolio (`fromHistory`). Those already skip
  `saveHistory`.

## 3. Decisions locked during brainstorming

1. **Every signed-in search auto-saves**, Free and Pro. Permanence is the
   account, not the plan.
2. **Pro's perk is the desk, not the save.** Free sees address, type,
   date, Open / Remove. Pro keeps today's table: likely value, sparkline,
   change, combined book total.
3. **Latest report + snapshots**, not a dated archive of every run.
4. **Approach A:** the client upserts after a successful render. Closing
   the tab before the POST can miss that one save; Recent searches and
   the 30-day cache still cover the recent ones.
5. **Remove deletes the row.** Searching that address again adds it back
   if there is room. No tombstone list.
6. **Lapse needs no special branch.** Auto-save keys on `currentUser`,
   not on `pro`. A lapsed Pro member is a Free member: items stay, new
   searches still auto-save up to the Free cap of 100, and the desk
   hides dollar figures. That is the same as any other Free account.
7. **Caps:** Free 100 properties, Pro 500. Cap applies to **insert** of a
   new address, never to updating an existing one. Admin and tester count
   as Pro. `$20` does not raise the cap. `PRO_ENABLED=off` keeps 100
   (pre-Pro).
8. **Save button** shows only when this report is not in the portfolio
   yet (signed out, or the auto-save failed / cap). After a successful
   upsert the button is hidden — it must not insert a second row.

## 4. Architecture

No new store. Three small changes around the store that exists.

```
signed-in search
  → renderResults
  → saveHistory          (already skips sample / fromHistory / shared)
      → localStorage     (unchanged)
      → if pendingPortfolioRefresh matches: POST with id (unchanged)
      → else if currentUser: POST /api/portfolio {payload, snapshot}
                           (no id; server upserts)
  → renderMyDesk
      → Free: Property + actions
      → Pro (or Pro dark): today's ledger + value columns
```

### Server: upsert

`POST /api/portfolio` without `id` currently always inserts. It must
**find the caller's most recently updated row for that address + type**
and `updatePortfolioItem` if one exists, else insert (cap permitting).

Address + type match is the exact strings already stored
(`payload.meta.address` / `payload.meta.type`, trimmed the way the
route already trims). Do not add a unique constraint this round:
duplicate rows already exist from double-clicks of Save; a unique index
would fail those accounts. Updating the newest row leaves older dupes
alone (YAGNI to merge them).

The 300KB body limit, rate limit, payload shape check, and
`cleanSnapshot` stay.

### Entitlements

Add two fields to **every** `computeEntitlements` return (the admin
early-return is the merge trap — a new key omitted there reads as
locked):

| Field | Free (tier on) | Pro / admin / tester | Tier dark (`enabled: false`) | `$20` unlock |
|---|---|---|---|---|
| `portfolioMaxItems` | 100 | 500 | 100 | 100 |
| `portfolioValues` | false | true | **true** | false |

`portfolioValues` is presentation: may My Desk show dollar figures.
Snapshots are still **written** for Free, so upgrading to Pro reveals a
book of values whose history already accumulated. Do not strip
`snapshots` from `GET /api/portfolio` for Free — same "presentation
only" rule as the rest of `/api/config`.

The dark-tier `true` is load-bearing. Today's desk already shows likely
value to everyone. `PRO_ENABLED=off` must restore that, the same way
`canExploreAddresses` stays true on the disabled branch because the
Explorer used to be free. Keying the desk on `isPro` alone would hide
the numbers from everyone while the tier is dark.

`/api/config`'s `pro` block carries both fields. The insert path in
`POST /api/portfolio` reads `portfolioMaxItems` from `getEntitlements`
instead of the `PORTFOLIO_MAX_ITEMS = 100` constant. Updating an
existing row never consults the cap.

### Client auto-save

Hook inside `saveHistory`, after the localStorage write, **outside**
that function's try (localStorage failure must not skip the server
write — the refresh hook already follows this rule).

- `pendingPortfolioRefresh` still wins when address + type match, so a
  desk Refresh does not double-POST.
- Otherwise, if `currentUser`, POST `{payload, snapshot: lastValuation}`
  with no `id`. Defer a tick so `renderOwnerHero` has set
  `lastValuation` (same reason the refresh hook already defers).
- Fire-and-forget: a failed POST does not break the report. Leave the
  Save button available to retry. On success, remember this address +
  type as in-portfolio so the button hides, and refresh My Desk.
- Cap error (`Portfolio is full (N properties).`): surface it once via
  `showStatus`; do not retry in a loop.

Empty desk copy: **"Run a report — it will show up here."** not "press
Save to portfolio."

### Desk split

`renderMyDesk` branches on `proConfig.portfolioValues` (not a raw
`isPro`, because of the dark-tier rule above).

**When false (signed-in Free, tier on):** table columns are Property and
actions (Open is the address click, plus Refresh / Remove). No History,
Likely value, or Change columns. `#deskLedger` stays hidden — a combined
book total over every curiosity search is the thing this split exists to
avoid.

**When true:** today's table and ledger, byte-for-byte.

Refresh and Remove stay on both. Opening a card still GETs the payload
and re-renders with no billed search.

### Pricing copy

The compare table in `#pricingCompare` gains one row, in step with
comps / exports / vault:

| | Free | Pro |
|---|---|---|
| Portfolio | Saved reports, address list | Saved reports, with estimated values |

The Pro tile's `pr-sum` and the shared capability strip each mention it
once, sell-only-what-ships. Do not claim "unlimited saved reports" —
the cap is 500.

## 5. Error handling

- Auto-save POST fails: report stays on screen; Save stays available;
  `showStatus` with the server's message (cap, 429, 500).
- Cap on a **new** address: 400, same sentence shape as today
  (`Portfolio is full (N properties).`), N from the entitlement.
- Cap on a **re-run** of an address already in the list: update
  succeeds.
- Unsigned-in search: no POST (Save still opens the account modal).
- File-fallback portfolio (no Supabase): same upsert logic against the
  in-memory / file store.

## 6. Tests

`test/entitlements.test.js` (pure):

- Free: `portfolioMaxItems === 100`, `portfolioValues === false`.
- Pro, admin, tester: 500 and `true`. Admin matches Pro on both keys
  (extend the existing "admin has every Pro field" loop).
- `$20` `reportUnlocked`: still 100 and `false`.
- `enabled: false`: 100 and `true` (pre-Pro desk).
- Anonymous: 100 / `false` (they cannot POST anyway).

`test/routes.test.js` (wired):

- Signed-in POST without `id` for an address already stored updates
  that row and appends a snapshot; item count stays 1.
- Insert at the Free cap of a *new* address 400s; updating one of the
  existing 100 still 200s.
- Pro entitlement is what raises the cap, not the presence of a
  session.

`test/index-html.test.js` (pins):

- Empty copy names "Run a report" / "show up here", and does not say
  "press Save to portfolio".
- `saveHistory` is the auto-save seam (it already guards sample /
  fromHistory / shared). Pin that the new POST is inside those same
  guards, not a second call from `renderResults`.
- Compare-table row for Portfolio is present with Free = address list
  and Pro = estimated values.

Manual, once, against a running server: signed-in Free search appears
on My Desk as an address with no dollar column; the same account after
a tester passkey (or admin cookie) shows likely value and the ledger
from the snapshots already stored.

## 7. Out of scope

- Raising or removing Recent searches' `HISTORY_MAX` / `PAYLOAD_MAX`.
- Unique `(user_id, address, property_type)` in a migration.
- Merging duplicate portfolio rows already in production.
- Auto-save for `$20` unlocks.
- Server-side write inside `/api/comps`.
- Changing share, cache TTL, or harvest.
)
