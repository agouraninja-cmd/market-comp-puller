# Report branding: the member's mark on their own reports

**Date:** 2026-08-07
**Status:** Design approved by the owner 2026-08-07. No code written yet.
**Source:** `docs/ROADMAP.md` "Now" → report branding UI. The last unbuilt Pro
entitlement.
**Builds on:** `migrations/008-pro-billing.sql` (`branding_profiles`, applied),
`entitlements.js` (`canBrand`), and the v3 sharing work in
`docs/superpowers/specs/2026-08-06-client-sharing-design.md`.

## The feature in one line

A paying member puts their firm's logo and details on the reports they hand to
clients, and CompNinja stays visibly the thing that computed the number.

## Why this one, and why it has been sitting

`canBrand` has been a real entitlement since the Pro tier shipped, and
`branding_profiles` has held seven columns waiting for it. Nothing draws them.
`findBrandingProfile()` exists in server.js and is called by **nothing**.

That gap is deliberate and is documented in three places in `index.html` under
one rule: **sell only what ships.** The Pro pricing tile and the plan card both
carry comments saying the branding bullet stays off the list until something
actually draws a logo, because promising it to someone who has just paid is
worse than promising it to a prospect. This spec is what lets those bullets come
back, and restoring them is part of the work rather than a follow-up.

It also lands at the right moment. v3 shipped permissioned sharing a day ago, so
a broker can now send a named client a report. Branding is what makes that
report look like it came from them.

## Co-branded, not white label

The member's firm leads. CompNinja remains present as the author of the
valuation, and the automated-estimate line stays on every surface.

That is not a compromise, it is the compliance position: the owner is not a
licensed broker, and every valuation on this site is labeled an automated
estimate and never an appraisal. A report that carried only a brokerage's mark
would read as that brokerage's own appraisal work. Full white label is a
separate ROADMAP item that rides on this profile; it is out of scope here and
should not be half-built into it.

## No migration

`branding_profiles` already has `user_id`, `logo_url`, `firm_name`,
`preparer_name`, `phone`, `email`, `license_number`, `disclaimer`,
`updated_at`. Nothing is added.

One note for whoever reads the column list later: **`logo_url` holds a data
URI, not a URL.** The name is now a slight misnomer and renaming it is not worth
a migration. The reason is in "The logo" below, and it is load bearing.

## Saving is not the entitlement. Applying is.

Any signed-in member may read, write and delete their own branding profile.
Nothing checks `canBrand` on the way in.

This is deliberate and it is not a hole:

- `canBrand` is `pro || reportUnlocked`, so a $20 single-report buyer holds it
  **only for the report they bought**. Gating the editor on Pro would make the
  $20 tile's own branding promise unfulfillable: they could never set up the
  brand the tile says they are buying.
- A saved profile with no entitlement does nothing. It is inert data in the
  member's own row.
- The entitlement is enforced where it matters, which is when a branded report
  **leaves the account**: `POST /api/share` decides server-side whether the
  brand travels. Applying it to the member's own screen and their own exports is
  a cosmetic self-application with no third party involved, so it is enforced
  client-side off `/api/config`, like every other presentation limit.

**Which client-side signal.** `/api/config` carries `pro.canBrand` computed with
no report scope, so it is true for Pro and false for a $20 buyer even on the
report they bought. The browser must therefore apply the brand when the visitor
is Pro **or** when the report on screen is one they have unlocked, reusing
whatever signal the client already holds for that (the same one that decides the
report is not comp-gated after a purchase return). Do not invent a second
notion of "unlocked" for branding. If no such signal turns out to be readily
available in the front end, surface that in the implementation plan rather than
working around it, because a $20 buyer silently getting no brand is the one
outcome this arrangement exists to prevent.

## Three routes

- `GET /api/branding` returns the caller's own profile, or `{}` when they have
  none. Signed in only. Never returns anyone else's.
- `PUT /api/branding` replaces the whole profile, mirroring `PUT
  /api/dev-ideas`. Whole-object replace has one state to reason about.
- `DELETE /api/branding` removes it.

All three are scoped by `user_id` in the query, never checked afterwards, the
same rule the vault and share routes follow. All three answer 401 when not
signed in and 503 with no database, in that order, so a stranger never learns
whether the database is up.

`PUT` validates: every text field trimmed and length capped (firm 80, preparer
80, phone 40, email 120, licence 40, disclaimer 300), and the logo must be a
`data:image/` URI under 150KB or the write is refused with a message naming the
limit. A URL in that field is rejected outright, for the reason below.

## The logo

A file picker accepting PNG and JPEG. The browser draws the image to a canvas,
downscales it to a maximum of 400px wide preserving aspect, and exports a PNG
data URI. The result goes in `logo_url`.

Two different numbers, on purpose, and they are not in conflict. **100KB is the
browser's re-encode threshold**: a PNG over it is re-encoded as JPEG at quality
0.85, which in practice lands a 400px logo well under. **150KB is the server's
hard refusal** in `PUT`, a backstop against a caller that is not our own form.
The gap between them is deliberate slack so an ordinary upload never trips the
hard limit.

Four things decided here, each for a concrete reason:

- **Embedded, never linked.** A cross-origin image taints the html2canvas
  canvas, and a tainted canvas makes the PNG export throw. One broker pasting a
  logo URL would silently break image export for every report they touch. A
  data URI cannot taint anything, and it also survives with no dependency on
  somebody else's hosting staying up.
- **The module refuses a non-`data:` logo at render time as well**, not only at
  write time. A row hand-edited in the SQL editor must not be able to make the
  browser fetch a third-party image.
- **SVG is rejected**, with a message saying to upload a PNG. SVG rasterizes
  unreliably in html2canvas and print, and a broken logo on a client-facing
  document is worse than a text firm name.
- **A logo that fails to load falls back to the firm name as text.** Never a
  broken-image icon on a document a broker is handing to a client.

## Where the brand renders

Four surfaces, all of which already exist. No new layout is invented.

| Surface | Anchor in `index.html` | What changes |
|---|---|---|
| Print letterhead | the `.print-only` block at the top of `#reportArea` | Member logo and firm lead the left; "Valuation by CompNinja" and the date move to the right |
| Screen report lockup | the `.rd-bcard` header, `.report-lockup` | Member's logo and firm replace the CompNinja lockup, with a small "via CompNinja" beneath. This is also what html2canvas captures for the PNG |
| Print footer | the `.print-only` footer block | Firm name and contact line, with the existing CompNinja line kept |
| CSV and XLSX | `exportCsv`'s title rows, the XLSX Valuation sheet | A "Prepared by" line carrying firm, preparer, phone, email, licence |

## The member's disclaimer is additive

`disclaimer` is a free-text line the member supplies. It is rendered **in
addition to** the automated-estimate language, never in place of it. We cannot
police what a broker types, but we can guarantee that no configuration removes
the sentence that says this is a comp-based estimate and not an appraisal.

## Shared reports carry the sender's brand

At share time `POST /api/share` reads the sharer's profile **server-side** and,
when `ent.canBrand` holds, snapshots it into the stored payload as
`meta.branding`. A snapshot rather than a lookup, for two reasons: the report
should look the way it looked when it was sent, and a share can outlive its
owner's subscription or its owner's account.

**The trap, and it is the one thing most likely to be got wrong here:** a
shared report must render `meta.branding` out of the payload and must never
consult the *viewer's* own profile. Get that backwards and a Pro member opening
a report their broker sent them sees their own logo on it. `brandForRender()`
below exists precisely so that decision is made in one place and can be tested.

Consequence worth stating: `meta.branding` carries the sender's phone, email
and licence number to whoever opens the link. That is the member's own contact
information and branding is an explicit act, so it is intended, but it is the
reason the snapshot happens only when the entitlement holds.

## The decision, in one pure module

`branding.js`, new, pure, no I/O and no clock reads, like `entitlements.js` and
`report-access.js`:

```js
brandForRender({ profile, canBrand, sharedBranding }) -> block | null
```

- `sharedBranding` present wins outright and is returned normalized. The
  sender's entitlement was already checked at share time; the viewer's is
  irrelevant and their own `profile` is ignored entirely.
- Otherwise, `canBrand` plus a profile with any usable field returns the
  normalized profile.
- Otherwise `null`, and every surface renders exactly as it does today.

Normalization trims, drops empty fields, enforces the field caps, and drops a
logo that is not a `data:image/` URI. It returns `null` rather than an empty
object when nothing usable survives, so callers have one falsy check.

## Invisible until configured

A member with no profile gets a report byte-identical to today's, the same rule
blended comps follows and for the same reason: it makes "no non-member sees any
change" a testable claim rather than a reviewed one.

## Where the editor lives

A "Report branding" card on `/desk`, below the plan card: the logo picker with
a preview, the five text fields, the disclaimer, Save and Remove. A live preview
of the letterhead sits beside it so the member sees the thing they are actually
buying before they export anything.

## Test obligations

- `branding.js`: the full decision table, including a shared report ignoring
  the viewer's profile, a non-`data:` logo being dropped, over-cap fields, and
  the null-when-nothing-usable case.
- All three routes refuse an anonymous caller with 401 before the 503 a
  database-less server would give (`test/routes.test.js`, bare boot).
- `PUT` rejects an oversized logo and a non-`data:` logo.
- A share created by a member with `canBrand` carries `meta.branding`; one
  created without it does not.
- A report with no profile is byte-identical to today's.

The happy paths that need a real session and database (a saved profile actually
appearing on a rendered report) are not coverable in `routes.test.js` by its own
no-external-service rule, and want a hand check against the deployment, exactly
as v3's invited paths did.

## Copy that ships with the feature

Both are currently written to exclude branding and both carry comments saying
to restore it when this lands:

- the Pro pricing tile's bullet list in `index.html`
- the plan card's `detail` string for an active Pro member

The $20 single-report tile already claims branding and needs no edit, which is
also why the editor is not gated on Pro.

## Out of scope

- Full white label. It is its own ROADMAP item and removing CompNinja's mark is
  a different decision from adding the member's.
- Per-report brand overrides, multiple brands, team brands.
- Custom colours, fonts, or layout. The brand is a logo and a set of facts.
- Branding on market pages, the vault, or any server-rendered page.
