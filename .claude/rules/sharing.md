---
paths:
  - "report-access.js"
  - "test/report-access.test.js"
---
# Sharing reports

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

> **Where a member's shares are listed (2026-10-08): Messages' Reports
> view**, not Home. Sent to you, the firm's shelf and the links they sent
> moved there from Home's Reports tab (firms.md, "Reports in Messages";
> rules in `report-inbox.js`). Nothing about the routes changed:
> `GET /api/shares`, `GET /api/org/shelf`, `PUT /api/shares/viewers`,
> `POST /api/shares/revoke` and a deal room from a share (`POST /api/hubs
> {fromShare}`) answer exactly as before; only the page asking moved, and
> Home's boot no longer embeds `/api/shares`. Where the notes below say
> "the card", "the desk" or "Home", read Messages' Reports view.

## Architecture

- `POST /api/share` — publishes the current report (`{ data, meta }`) under a
  short random id so the visitor can share the link; returns
  `{ id, url, visibility, invited }`. Strips `meta.subject.noi` and
  `meta.assumptions` `debt`/`rentRoll`/`opex` (private finances) before
  storing. Stored in the Supabase `shared_reports` table
  (id/payload/created_at, plus the four columns migration 018 adds — see
  below), in-memory Map + `shared-reports.json` file fallback (the file
  fallback only ever holds the original three columns' worth of data — see
  the permissioned-sharing rules below), **no expiry**. Rate-limited per IP.
  **Permissioned sharing** (v3, 2026-08-06; migration
  `018-report-sharing.sql`, **applied to production 2026-08-06**; spec
  `docs/superpowers/specs/2026-08-06-client-sharing-design.md`). The body
  also takes `visibility` (`"public"`, the default, or `"invited"`) and, for
  an invited share, `viewers` (up to 20 emails) and `includePrivate`. An
  invited share requires a signed-in Pro account and a database — there is
  no file fallback for a viewer list, so `storeSharedReport` **refuses to
  create one without Supabase** rather than silently writing it as an
  ordinary public entry; see the rule below. A public share may never carry
  `includePrivate` (400) — a link anyone can open is the one place a
  broker's private comps must never ride along.
  What a broker's own vault comps become depends on visibility:
  `blend-comps.js`'s `stripPrivateComps()` removes them entirely from a
  public link; `anonymizePrivateComps()` (the invited default) replaces them
  with anonymized `locked_basis` rows — the same shape a free visitor's
  gated comps use — so the client's valuation range matches the broker's to
  the dollar with no address, price, or notes traveling; and the whole
  private comp travels only when the owner explicitly set
  `includePrivate: true` on an invited share **and** their entitlements
  still carry `canUseVault` at share time. Three routes manage an invited
  share afterward: `GET /api/shares` (both "my shares" and "shared with me,"
  in one call, for My Desk), `PUT /api/shares/viewers` (whole-list replace,
  ownership proven by a scoped read before the write, mails only the
  newly-added addresses), and `POST /api/shares/revoke` (one-way — there is
  no un-revoke, matching the vault's stance that access lapsing is safer
  than access silently returning).
  **What `GET /api/shares` says about a sender (2026-10-06, Home's Sharing
  card).** Each `sharedWithMe` row carries `from`, the sharer's display name
  (`MSG.displayName`: their name, else their address's local part, never the
  whole address), stitched through `usersByIds` the way the shelf's "shared
  by" is, and `viewedAt`, THIS member's own `first_viewed_at` (null = not
  opened, which turns the card's Sent to you count red). The sharer's
  `user_id` is read only to look the name up and never leaves the server.
  `mine` rows carry `orgId` so the page can list a firm share once, on the
  shelf. `GET /api/hubs`' `theirs` rows carry `from` the same way, from the
  room's `owner_user_id`, which stays on the server as before.
  `test/sharing-card-run.test.js` holds all of it; the stand-in database does
  not resolve PostgREST embeds, so that suite seeds the rows pre-joined.
  **Three rules a future editor will otherwise break:**
  - **The ACL is never cached.** `sharedReportsMem` caches a share's
    *payload* for the life of the process — right for a report body, and
    catastrophic for an access rule. `getShareRecord()` re-reads
    `visibility`, `revoked_at`, and the viewer list from the database on
    every single call, so a revoked link stops working immediately rather
    than at the next deploy. Never let a share's access decision ride on the
    memoized payload.
  - **An unrecognized `visibility` is treated as invited, never public.**
    `report-access.js`'s `canReadShare()` treats every value other than the
    literal string `"public"` as invited (falling through to the viewer-list
    check). A typo in a database column, or a new visibility value added
    later without updating this function, must fail toward *less* access, not
    publish a report to the whole internet.
  - **A public share may never carry a private comp, and `storeSharedReport`
    enforces that itself** rather than trusting the route to have checked.
    With no database configured, storing a share whose visibility is not
    `"public"` **throws** instead of falling back to the
    `shared-reports.json` file store — the file has no column for
    `visibility`, `user_id`, or viewers, so an invited share written there
    would come back out of `getShareRecord` as `{ visibility: "public" }`,
    publishing exactly what the member asked to restrict. This is the same
    rule the broker vault's 503 already carries (see "Broker vault" below):
    everywhere else in this app a Supabase failure falls back to a local
    file so nothing is lost, but here the file WOULD be the loss, so the
    write refuses instead. A **public** share keeps the fallback it has
    always had — the file store still holds its body and the link still
    works through a database blip, exactly as before this feature shipped;
    the asymmetry between the two visibilities is the point. `POST
    /api/share` also refuses this case at the route level (503, before
    storage is ever reached), but that check protects one caller — this one
    protects every future caller of `storeSharedReport`, which is why it
    stays even though the route should make it unreachable in practice.
- `GET /api/shared?id=` — returns a published report's `{ data, meta }`.
  For a public share, anyone with the link can view it (the original
  behavior, unchanged for every pre-v3 link already in the world). For an
  invited share, only the owner or a viewer on the list — `report-access.js`
  is the single, sole decider, returning one of `revoked` (403, the link was
  turned off), `signin_required` (403 + `signin_required: true`, which the
  client turns into a sign-in card), or `not_invited` (403, signed in but
  not on the list). `meta.shared` is
  true so the front-end renders it without saving to the viewer's history.
- `GET /r/<id>` — serves `index.html`; the SPA reads the id off the path and
  fetches the report from `/api/shared`. (server.js allow-lists this path
  alongside `/` and `/index.html`.)
