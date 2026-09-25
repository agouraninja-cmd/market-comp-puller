---
paths:
  - "org-access.js"
  - "org-buildings.js"
  - "org-contacts.js"
  - "org-leases.js"
  - "buildings-page.js"
  - "messaging.js"
  - "messages-page.js"
  - "renewal-watch.js"
  - "deal-board.js"
  - "test/org-*.test.js"
  - "test/building-sheet-run.test.js"
  - "test/buildings-page*.test.js"
  - "test/messag*.test.js"
  - "test/renewal-watch*.test.js"
  - "test/deal-board.test.js"
  - "test/contacts-import-browser.test.js"
---
# Firms

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Architecture

- **Firms — enterprise accounts, slice 1** (2026-08-16; migration
  `030-enterprise-orgs.sql`, **run before deploying — see below**; spec
  `docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md`).
  Colleagues at one brokerage share a shelf: a report shared with the firm
  lands on every member's desk, while each of them keeps their own reports,
  portfolio, watchlist, BOV pipeline and private vault. Rules live in the
  pure, tested **`org-access.js`**; server.js owns the reads.
  `GET|POST /api/org` (my firms + pending invites / create one),
  `GET /api/org/members?id=`, `GET /api/org/shelf?id=`, `POST /api/org/invite`,
  `POST /api/org/accept`,
  `DELETE /api/org/member?org=&id=` (removing somebody and leaving are the
  SAME route under different permissions, so the last-owner rule has one
  home). `POST /api/share` takes `visibility: "org"` + `orgId`; `/desk`
  renders the shelf plus the firm section.
  **The shelf** (`GET /api/org/shelf`) is every report anybody has shared with
  the firm, up to 1000, fetched WHOLE and filtered in the browser — `/vault`'s
  rule, for its reasons: the header count describes the whole shelf, so a
  server-side filter would leave the page unable to say how much it was not
  showing, and a search box that re-queries per keystroke is a request per
  keystroke. Past 1000 it SAYS it is truncated rather than under-reporting.
  It includes **the caller's own** shares, attributed and marked "shared by
  you" — slice 1 excluded them, which is right for a "shared with you" list
  and wrong for a shelf, since a record missing your own work cannot answer
  "has anybody here valued this building". `market` is computed with
  `marketOf()` so the filter matches the corpus and vault vocabulary.
  `GET /api/shares` is otherwise back to its pre-firm shape; its `mine` rows
  gained `firm` so a firm share's status line can say "Shared with Colliers
  Boise" and never "Anyone with the link" (it read as the latter before that
  field existed, which is the one wrong answer there that could make somebody
  forward a firm-only report).
  **The reader's half of that same rule**: `GET /api/shared` adds
  `meta.firmShare` (`firm`, `sharedBy`, `mine`, `sharedAt`) so a colleague
  opening the link is told it is a firm link and by whom —
  `renderFirmShareNotice()` in index.html, `no-print`/`no-capture` because it
  is context about the LINK, not report content, and a printed copy handed to
  a client has no business carrying a firm's routing. Three rules: it is sent
  ONLY to a reader entitled by the firm or its owner (an outside client named
  on a firm share's viewer list is not owed the firm's internals); the payload
  is **copied, never mutated**, because `sharedReportsMem` holds that object
  for the life of the process and writing into it would stamp one reader's
  context onto every later reader's copy; and the two extra reads are paid
  only on that path.
  **"org" is the internal noun and "firm" is the word on screen** — tables,
  columns, routes and identifiers all say org, every string a person reads
  says firm. One translation point, at the copy layer.
  Rules a future editor will otherwise break:
  - **No existing `user_id=eq.` read is ever widened to an org.** There are
    60-odd of them in server.js and they are the wall; a firm read is a new
    query against the new tables, migration 013's separate-tables rule. The
    one-line version of the shared vault is `or=(user_id.eq.X,org_id.eq.Y)`
    on `vaultCompsForReport`, which looks correct in review and fails
    silently because that path returns `[]` on error. `test/org-routes.test.js`
    fails the build if that pattern appears.
  - **No auto-join by email domain, ever.** `gmail.com` is a company by that
    logic, and even a real corporate domain proves only that somebody can
    receive mail there. A domain may one day SUGGEST an invite to an admin;
    it may never grant one, which is why `orgs` has no domain column.
    `broker_profiles.company` is free text a broker typed about themselves —
    two people typing "Colliers" are not verified colleagues.
  - **An invite is not a membership.** `joined_at` is null until the invited
    person accepts. Identity is the EMAIL (018's decision, adopted by 024 and
    again here), so anyone can type anyone's address into their own firm;
    without the accept step that would put a firm's reports on a stranger's
    desk and offer their next report a "share with my firm" button for a firm
    they have never heard of.
  - **`canReadShare` requires BOTH `visibility === "org"` AND a non-null
    `org_id`** before it consults membership, so a mistake in either column
    fails toward the viewer list — toward LESS access. The firm branch sits
    INSIDE the invited path, below revocation and below the sign-in check, so
    a firm share inherits every protection an invited one has.
  - **A firm share can never carry whole vault comps** (400, not a silent
    strip). Private comps are anonymized into the valuation basis exactly as
    on an invited share, so a colleague's range matches to the dollar with no
    address or price travelling. Opting an INDIVIDUAL comp into the firm is a
    different act and it shipped on 2026-08-16 as the spec's §7 — see "The
    shared vault" below; the three things it was waiting on (the opt-in, the
    attribution, and the vault's "Visible only to you" copy rewritten to
    match) all landed with it. This bullet is unaffected either way: a firm
    SHARE still never carries a whole vault comp.
  - **`canUseOrg` gates creating and inviting, never accepting or reading.**
    It tracks `broker` (one subscription), so it is false on a dark
    deployment. (It was also withheld from a tester without `vault_beta`
    until 2026-09-01, when testers became Pro outright — see the
    `TESTER_PASSKEY` bullet.) A colleague on the
    receiving end needs no plan at all: they are exactly an invited share's
    viewer, and a firm that could only share with people who had already
    bought the product would not solve the problem it exists for.
  - **Migration 030 must be run BEFORE the code deploys**, like 018 and 026
    and unlike most: it adds `shared_reports.org_id`, which `getShareRecord`
    SELECTs by name on EVERY share read, and PostgREST 400s an unknown
    column. Deploy-first breaks every legacy public link — including ones
    already mailed to property owners with no account — not just the new
    feature.
  **The firm's buildings** (Three Spaces slice 3, 2026-09-01; migration
  `046-org-buildings.sql`, **run before deploying**; spec
  `docs/superpowers/specs/2026-09-01-three-spaces-design.md`). `org_buildings`
  is the firm's index: one row per building a member CHOSE to put on the board,
  keyed on `(org_id, address_key)` with a nullable `verified_key` so a
  portfolio row can be matched. `GET|POST|DELETE /api/org/buildings?id=<org>`
  on the existing `openOrg` + `memberOf` gate; rules in the pure
  **`org-buildings.js`**; the desk section `#deskBuildings` sits at the top of
  the firm deck with an "Add to firm" door on the firm shelf's rows, and the
  Vault's portfolio rows carry the same door (`firmDoorCell` in
  vault-page.js — the portfolio moved there in slice 1), each reading the
  board off the server's own rows so neither page grows an address key. Four
  rules: **nothing creates a building as a side effect** — `linkVaultProperties`
  never touches the table and `test/org-routes.test.js` fails the build if the
  table is named outside its read function and route block (a row appearing
  from an upload would let a colleague read another's book by watching the
  list); **POST is idempotent** on the key and a repeat add only ever FILLS a
  missing `verified_key`, never rewrites (035's rule); **the whole set is
  returned, never a server-side `?limit=8`** (the shelf's rule; slice 4 slices
  in the browser); and **`org_contacts.building_id` is written ONLY by
  `POST|DELETE /api/org/buildings/contacts`** (2026-09-02, see below) —
  naming it in `orgContactRows`' `select=` before 046 has run 400s every
  contacts read. The plan numbered this migration 044; messaging took it.
  **The overflow rule and `/buildings`** (slice 4, 2026-09-02, no migration):
  the desk shows at most `COLLAPSE_AT` (8) rows and past that — only past
  that — `#buildingsMore` links to `/buildings`, a marketShell body in
  **`buildings-page.js`** whose boot payload is the SAME `/api/org/buildings`
  answer the desk reads (one read, one count), filtered in the browser with
  the header count always describing the whole set. `CTA_FREE_PAGES` gains
  `/buildings`. `org-buildings.js`'s `OVERFLOW_AT` mirrors index.html's
  `COLLAPSE_AT` and `test/org-desk.test.js` holds them together.
  **Each building has a sheet** (slice 5, 2026-09-02; migration
  `047-org-building-notes.sql`, **run before deploying**): `GET /building/<id>`
  (`renderBuildingSheetBody`), composed by the pure `composeSheet` from reads
  `buildingSheetPayload` makes SEPARATELY — the firm's `org_comps` filtered on
  the vault's address key, the viewer's own `broker_comps` through a
  user-scoped read, the shelf as metadata (`orgShelfMetaRows`, a
  `payload->meta` projection that falls back to the full read on any error),
  the viewer's own portfolio snapshots plus the firm's matching shared reports
  priced with `BULK.valueFromReport`, contacts by `building_id`, and notes.
  Two rules, tested: a colleague's private vault comp can never appear
  (composeSheet drops anything in the viewer's arrays not carrying their
  user_id), and valuations are the viewer's own plus the firm's shared reports,
  never a colleague's portfolio. `PATCH /api/org/buildings` edits type, size and
  year and never the address; `POST|DELETE /api/org/buildings/notes` are
  appended, attributed, author-deletable, and a note counts as activity.
  `test/building-sheet-run.test.js` runs the two-account isolation case.
  **Leases, and the dates that matter** (slice 6, 2026-09-02; migration
  `048-org-leases.sql`, **run before deploying**, after 046): `org_leases` is
  the firm's lease record, a different noun from `broker_comps.lease_expiry`.
  Rules in the pure **`org-leases.js`**, RESTATED from broker-vault.js rather
  than shared (a different writer against a different table): a notice after
  the expiry is refused as transposed, a rent needs its basis and it is never
  guessed, an edit is validated as the whole row. `criticalDates` takes
  renewal-watch.js's `deadlineOf`/`daysUntil` INJECTED, never required.
  `GET|POST|PATCH|DELETE /api/org/leases` on the firm gate; the Leases section
  on the sheet and the Critical dates strip at the top of `/buildings` (the
  next twelve months, soonest first). **Nothing here sends mail**:
  `renewal_notified_at` ships unwritten, renewal-watch is display-only on
  this surface, and which member at a firm would get a reminder is an owner
  decision the plan defers. The run test asserts the mail stand-in stayed
  empty.
  **Discovery, unread, contacts, reports** (slice 8, 2026-09-02, no
  migration; spec §13 of the firm-messaging design). Four **Discuss** doors
  (a SHARED comp in the Vault's Firm column, a shelf report, a building
  sheet, a contact row) all land on `/messages?say=&comp=`, which seeds the
  composer and posts NOTHING by arriving. `GET /api/messages/unread` counts
  THREADS with something new (a boolean per thread; the member's `added_at`
  is the baseline for a never-opened thread) and feeds `#navMsgDot` on both
  rails from the after-paint hydration — never from `/api/config`; the send
  route stamps the author's own `last_read_at`. `#deskThreads` on the
  Workspace shows five, unread first; `/messages` sorts unread first. The
  contact door composes name and company and **never the email** (039), and
  the shelf door sends a report as its `/r/<id>` link, never a snapshot, so
  `report-access.js` stays the sole decider.
  **Contacts attach to buildings (2026-09-02).** The write half of
  `org_contacts.building_id`: slice 5 shipped the sheet's read
  (`buildingContacts`) with nothing filling it, so every sheet's Contacts
  section was permanently empty. `POST|DELETE /api/org/buildings/contacts?id=
  &building=&contact=` attaches and detaches, and it lives in the BUILDINGS
  route block rather than the contacts one because it must prove the building
  is on this firm's board with `findOrgBuilding` and
  `test/org-routes.test.js` refuses `org_buildings` anywhere else. Rules,
  all run against a real server in `test/building-sheet-run.test.js`: both
  halves are scoped by `org_id` (a contact from another firm and a building
  on another firm's board are both 404); a contact belongs to at most ONE
  building, so attaching elsewhere moves it and the answer says `moved`;
  DELETE detaches only from the building named and never deletes the contact;
  the ordinary contact PATCH cannot touch the column (it writes only
  `FIELDS`), so a name edit cannot silently detach; and attaching is
  activity (the building's `updated_at` moves). `orgContactRows` now names
  `building_id` and the list carries `buildingId`, which the desk row maps
  to an address off its own buildings read (awaited BEFORE contacts in
  `renderShares`). The sheet's Attach door reads the firm's list only when
  opened, leaves out what is already attached, and groups first the contacts
  whose company matches a lease's tenant on that building — the same match
  that marks a row "tenant" — which is where the lease record and the contact
  list meet. `org-contacts.js` is unchanged: `building_id` is a link the
  buildings routes own, not a contact field.
  **Auto-share** (`orgs.share_default` + `org_members.auto_share`, migration
  031, owner's yes 2026-08-16). An owner or admin can set the firm to share
  members' NEW reports automatically; `POST /api/org/settings` carries both
  switches. It ships with the safeguards the spec made a condition of building
  it at all, and each one is load-bearing:
  - **Off by default**, and an unrecognized `share_default` reads as `none`.
    The failure that matters is publishing work somebody did not mean to
    publish, and unlike a missing share it cannot be undone by trying again.
  - **Never retroactive.** It fires from the same three-part guard
    `saveHistory` uses (not sample, not `fromHistory`, not `shared`), so
    opening an old report never publishes it.
  - **The member has a veto that beats the firm.** `org_members.auto_share` is
    NULLABLE for three states — null follow, true always, false never — and
    `false` survives an admin switching the firm off and on again. A boolean
    with a default would collapse "has not chosen" into one of the other two,
    and a broker who said "not my client work" would start publishing again
    the next time an admin changed their mind.
  - **Disclosed before the accept, not after.** A pending invite carries the
    firm's `shareDefault`, because joining a firm whose default is on changes
    what happens to work not yet run.
  - **Per-report opt-out on the report itself.** `renderAutoShareNotice()`
    says it happened and offers Undo (which revokes), because the moment
    somebody wants this off is the moment they are looking at the report.
    Guarded on `meta.autoShared`, or every subject-field repaint would
    re-publish — including something just undone.
  **The shared vault** (§7, migration 032, 2026-08-16). A broker can opt one
  comp at a time into their firm; colleagues see it inside their OWN reports,
  attributed. `POST|DELETE /api/vault/firm`; the toggle is a column on
  `/vault`'s comps table, shown only to a broker who is in a firm. Rules in
  `blend-comps.js`, the read in `orgCompsForReport`. Seven things hold it up:
  - **`org_comps` is a separate table**, never a column on `broker_comps` and
    never a widened read — 013's rule a third time. The one-line version of
    this feature is `or=(user_id.eq.X,org_id.eq.Y)` on `vaultCompsForReport`,
    which looks right in review and fails silently because that path returns
    `[]` on error.
  - **A firm comp keeps `source_type: "broker_vault"` and `private: true`.**
    Whose it is, is ATTRIBUTION (`firm` + `shared_by` on the comp), not a
    provenance tier — so `/api/share` strips or anonymizes it, exports and the
    PNG and the print drop it, and the valuation weights it at 1, all by
    construction. A fifth tier would mean `TIER_WEIGHT` (twice, a pair that
    already carries a keep-in-step ⚠), `SOURCE_TIERS` and `eval-score.js` all
    agreeing about a weight that is 1 in every one of them.
  - **The stored payload comes from `FIELD_MAP` itself** (`firmCompPayload`),
    so `user_id`, `dedupe_key`, `address_key`, `upload_id` and the publish
    flags cannot reach another account's table by being forgotten — and a new
    per-type field needs no migration here, which is why 030 stores jsonb
    where 013 stores columns.
  - **One deal is one row.** `dedupeFirmComps` drops a colleague's copy of a
    deal the reader already holds, the caller's own winning. Two brokers at
    one firm are routinely on opposite sides of the same transaction, and
    without this it is counted twice in the valuation with nothing on screen
    explaining the shift. This is the one place a private comp IS deduped.
  - **The blend is gated on `canUseVault`, not on membership**, and excludes
    the caller's own shared comps (they already arrive through
    `vaultCompsForReport`). A free colleague reads the firm's shared REPORTS,
    like any invited viewer, but does not get a paid capability by invitation.
  - **The owner's edit refreshes the copy and their delete pulls it** —
    `refreshSharedComp` runs AFTER validation, the scar `retractPublishedComp`
    carries, so a rejected edit never disturbs what colleagues hold. Unlike a
    shared report (018's set-null rule) the copy CASCADES on delete: a report
    is a record of what was sent, a comp is a live copy of a row in the
    broker's book.
  - **"Visible only to you" corrects itself** (spec §2). `renderFirmPrivacy()`
    rewrites the deck subtitle and the trust line the moment something is
    actually shared — keyed on having shared, not on being in a firm, because
    a broker who has shared nothing really does have a vault visible only to
    them. The default text stays in the MARKUP so a page whose script failed
    still makes the true statement rather than none.
  **Per-seat billing** (migration 033, 2026-08-16). `STRIPE_PRICE_FIRM_MONTHLY`
  + `plan: "firm_monthly"` on `/api/checkout` (with `orgId` and `seats`), the
  firm's own Stripe customer, and `org_subscriptions` keyed on `org_id`.
  `POST /api/billing-portal` takes an optional `orgId` and opens the firm's
  portal. Unset price = the plan 503s and the buy control never renders, which
  is how seats stay hand-granted until somebody asks to pay. Six rules:
  - **`orgs.seats` is the one cap**, read only through `seatCapOf()`, which the
    invite gate and the entitlement read share — one refusing a colleague the
    other would have granted Pro to is a support ticket nobody can reproduce.
    An unreadable count falls back to `MAX_MEMBERS`, never to 0 or 1: a seat
    count is a COMMERCIAL limit (membership is the access gate, elsewhere), so
    the failure worth choosing is an unbilled invitation, not a paying firm
    locked out of adding the colleague they just hired.
  - **The webhook writes seats from the SUBSCRIPTION**, not from the checkout
    request, so the number a firm can use is always what Stripe bills them for
    — including after a portal change we never saw the request for.
  - **A firm session must reach `applyOrgSubscription` and RETURN before the
    user path.** Otherwise a firm checkout lands a row in `subscriptions` keyed
    on whoever clicked Buy: one person with a personal subscription their firm
    is paying for, and the firm with none. Pinned by test.
  - **Owner only** for checkout and the portal, deliberately narrower than
    `canManageMembers`: an admin manages people, committing a firm to a
    recurring charge is not the same act.
  - **Seats below the current headcount are refused by name and number**
    (`seats_below_headcount`), because buying too few drops named colleagues to
    free the moment the webhook lands — a downgrade applied to people who are
    not in the room. Pending invitations count toward the headcount.
  - **The firm is a FALLBACK in `getEntitlements`**, consulted only when
    nothing already grants Pro, and handed to `entitlements.js` as an ordinary
    subscription row — so that file still knows nothing about firms (spec §8)
    and the lapse, grace and renewal-slack rules apply unchanged. `viaFirm` on
    `/api/config` is presentation only, and exists for one concrete wrong
    answer: the plan card offers the Stripe portal off `status !== "none"`, and
    a colleague on a firm seat has a real status belonging to a customer record
    that is not theirs. Seats are held oldest-first by `joined_at`, so a portal
    downgrade has a defined, explicable result instead of an arbitrary one.
  Seats can still be granted by hand, the `vault_beta` precedent — a firm with
  no subscription has `seats` and a `status` of `"none"`, and everything works.
  `orgs.share_default` and `orgs.seats` ship as unwritten columns so both are
  code changes rather than migrations — the same reason `hub_items.status`
  shipped early in 024. The shelf needed **no** `org_shelf_items` table in the
  end: reports already live in `shared_reports` with `visibility='org'`, and a
  second copy would have been two sources of truth for one thing. That table
  becomes worth building when the shelf holds something a share cannot — a
  BOV pipeline row, or an individual vault comp.
  **Two shops, one architecture** (migration `036-org-shop-kind.sql`, **run
  before deploying**; Business Model Transition Plan v2 §6, 2026-08-17).
  `orgs.kind` is `'broker'` or `'development'` and decides two things: the
  nouns a firm reads (a development shop is told its shelf holds land comps,
  rent comps, absorption studies and feasibility packets, in the invite email
  and on the desk) and which property type the firm shelf opens on (Land for a
  development shop, everything for a broker shop). Nothing is gated on it and
  nothing is published by it.
  **A tenant rep shop was a third kind from 2026-08-21 and was WITHDRAWN on
  2026-08-31** (owner's call). Removing a kind needed no data migration and no
  SQL at all, which is worth understanding before adding or removing another:
  `kindOf` reads anything it does not recognize as `broker`, so a firm that
  had chosen it goes back to reading the incumbent vocabulary rather than
  losing a screen, and `validateShopKind` refusing the string is the only
  thing that keeps a new one from ever being written. **Migration 037 is
  deliberately NOT reverted** — its CHECK still accepts `'tenant_rep'`.
  Narrowing it back would fail on exactly the rows that make narrowing matter,
  and a value no code can send is a value no row can gain, so the module is
  the whole wall — which is why `test/org-run.test.js` executes that refusal
  against a real server and not only against the module. Five rules:
  - **Required at creation, not defaulted.** `POST /api/org` refuses without a
    valid kind (`ORG.validateShopKind`), because the creator is the only person
    who knows the answer and a default would be answered by silence. Changing
    it later is an owner/admin call on `POST /api/org/settings`, the same
    authority as `share_default` and for the same reason: it re-labels every
    colleague's desk, not one person's own work.
  - **036 is 030's hazard.** `orgsByIds()` and `findOrg()` name `kind` in
    their SELECTs and PostgREST 400s an unknown column, so deploying 036
    second takes down every firm surface at once. Migrate, then deploy. (037
    only widened the CHECK and has already run; withdrawing the third kind
    touches the database in neither direction.)
  - **An unrecognized kind reads as `broker`** (`ORG.kindOf`), which is
    incumbency rather than safety: every firm predating 036 has only ever been
    shown broker-shop words, so a typo must not re-label their desk. The write
    path normalizes case and padding; the read path stays strict.
  - **Only one kind has a saved view, and that is deliberate.** Land is a
    default VIEW rather than a claim about what a development shop may file,
    and it exists because exactly one entry in `VAULT.PROPERTY_TYPES` names
    that shop's subject. A broker shop's work spans every type, so its
    `shelfType` is `""` — a shelf that opens filtered on a type nobody chose
    reads as the record having lost rows. `test/org-access.test.js` asserts
    the empty string on purpose.
  - **The shelf's saved view never hides a row while its filter is off
    screen.** The filter row is furniture under six items, so below six the
    type is cleared rather than merely hidden, and a colleague's own choice of
    filter is never stomped by a re-render. The header count always describes
    the whole shelf.
  Enterprise is still deliberately not a kind: §6 rules it out as a target
  (a research department kills the deal internally) and names its real entry
  point as somebody who used CompNinja at their last shop. The bar a third
  kind has to clear is that test plus the one tenant rep failed in practice:
  a value nothing may select is a value that rots, and so is one nobody picks.
  The shops' words live in `ORG.SHOP_COPY` and are **mirrored** in index.html,
  which cannot require the module; `test/index-html.test.js` pins the two
  together, because drift there would invite a firm as a development shop and
  then greet it with a broker shop's desk. **Two** strings are mirrored, not
  one: the refusal `validateShopKind` returns is repeated in the browser (which
  declines to spend a round trip on a question it can answer) and it ENUMERATES
  the shops, so it goes stale the day a kind is added OR removed — the same
  suite pins it to the module's own words. The `/brokers-firms` page draws its
  shop row off `SHOP_KINDS` for the same reason, rather than typing the cards.
