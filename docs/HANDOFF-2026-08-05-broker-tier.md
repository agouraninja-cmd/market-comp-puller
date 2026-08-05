# Handoff: broker tier v1 — 2026-08-05

Written for whoever picks this up next. Everything below is **merged to `main`
and live on compninja.co**. Both migrations are applied to production.

Design spec: `docs/superpowers/specs/2026-08-05-broker-tier-design.md`
Plan: `docs/superpowers/plans/2026-08-05-broker-vault-v1.md`

---

## What shipped

| PR | What |
|----|------|
| #17 | Broker plan on the Stripe rails, the private vault (store + routes + page), and `migrations/verify.js` |
| #18 | A Broker vault card on My Desk |
| #19 | The publish button — one comp into the public records, for credit |
| #20 | Fix: the Verified badge can no longer be claimed by a comp no broker vouched for |

**170 tests** (`npm test`), up from 90. CI green on every push.

## Live state right now

**Nothing is buyable and nothing is customer-visible.** `STRIPE_PRICE_BROKER_MONTHLY`
is unset, so `/api/checkout` answers 503 for `broker_monthly`. `canUseVault` is
false for every visitor except a signed-in admin. Search, reports, pricing and
exports are untouched.

To turn the tier on: create the Stripe price → set the env var → then ship the
pricing-tile copy. **In that order** — the price lives in Stripe, the copy lives
in `index.html`, they can disagree, and nothing detects it.

## Database

Both applied to prod and verified:

- `013-broker-vault.sql` — `broker_uploads`, `broker_comps`
- `014-vault-publish-link.sql` — `broker_comps.published_submission_id`

```bash
node migrations/verify.js
```

New: read-only, checks every expected table **and column** against the live
database, exits non-zero listing what is missing and which migration creates it.
Column checking is the point — the 004 outage is invisible to a table check,
because `comp_corpus` existed the whole time and ten columns did not.

`APPLIED.md` is now a claim you can verify in ten seconds instead of trust.

---

## Scope note: the star schema is NOT this

`013` is deliberately **v1 storage, not the analytics model** — two flat tables,
no dimension tables, no joins. The broker data model proper (Ecosystem Plan §6)
is Jacob and Chuck's, and nothing here is meant to pre-empt it.

**The one thing that work needs to know:** the vault writes to `broker_comps`
with the columns in `013`. Adopt it, read from it, or replace it — replacing it
is cheap right now, because the table holds **zero rows**.

---

## Design decisions worth not undoing

**The privacy wall is structural, not a filter.** `broker_comps` is a separate
table read only by the `/api/vault*` routes, every read scoped by `user_id`
including the DELETE. It is *not* a `private` flag on a shared table, because
the public corpus read path swallows its own errors by design — a missed filter
would leak a broker's book of business with nothing alerting anyone. That
blindness already hid a total corpus outage for weeks.

**Publishing is a copy, not a shared read.** `POST /api/vault/publish` writes a
row into `comp_submissions` — the table `fetchVerifiedComps()` already reads —
so a published comp inherits the whole existing pipeline: offered to the model,
badged, citation-counted, and the broker joins `findBrokersForMarket()` for BOV
leads. No public query gains a read on `broker_comps`.

**The vault has no file fallback.** Everywhere else a Supabase failure falls
back to disk; here that would *be* the loss, since Render erases its disk on
every deploy. It refuses the upload instead — 503, nothing half-saved.

**The importer rejects rather than guesses.** `1.2M`, a bare number where a date
belongs (Excel's serial), and day-first dates all come back with a spreadsheet
line number. A wrong number in a broker's own records is the one error nobody
ever catches. A file with some bad rows still imports the good ones.

**`market` is attached in `server.js` with `marketOf()` and nowhere else**, so
`broker_comps.market` agrees byte for byte with `comp_corpus.market` and a
published comp needs no translation. `broker-vault.js` deliberately does not
compute it — a second copy of that parse is a second thing to keep in sync.

**`dedupe_key` is an explicit column**, like `comp_corpus`'s, not a multi-column
unique constraint: Postgres compares NULLs as distinct, so a constraint over a
nullable price would let unpriced comps re-import forever.

---

## Two real bugs found and fixed today

**1. Published comps would never have appeared.** `fetchVerifiedComps` filters
`transaction=eq.Sale` — capitalised. The vault stores `sale`. Copying verbatim
meant a published comp was silently never offered to a sales-focused search. No
error anywhere. Tested now.

**2. The Verified badge could be claimed by nobody.** `attachVerifiedAttribution`
only ever *added* attribution and returned early when no broker comps were
offered — so a `verified: true` the model invented passed through into reports
and then into `comp_corpus`. Found live: **15 corpus rows badged verified against
one broker submission ever**, mostly Boise/Eagle addresses nobody submitted,
including aggregate-shaped ones.

The rule is now absolute and lives in `broker-vault.js` so `npm test` covers it:
a comp is verified iff it matches a comp we offered, enforcement runs even on an
empty offered list (the hole), and clearing a badge strips its `verified_by`.
Same principle as the `source_type` enforcement above it — **prompt rules are
requests, normalization is a guarantee.** Cleared badges are logged.

Existing data repaired: the 15 rows kept their comps and lost the badge.

Also removed: a fake test comp (`777 Postgres Pl, Dallas, TX` / "Verification
Realty") that had been `status='approved'` since 2026-07-06 — offered to every
Industrial search as trusted, and already harvested into `comp_corpus`. Both
copies gone, both backed up.

---

## Not built — the actual next steps

In the order I'd argue for:

1. **The broker lead inbox.** This is what brokers would actually *pay* for, and
   nothing exists for it. Today a BOV lead goes only to the owner's inbox and
   the broker never learns it happened; `findBrokersForMarket()` pastes their
   contact details into an email for a manual introduction. Ecosystem Plan §5
   says referral fees are probably barred (the owner is unlicensed), and the
   fallback — lead visibility as a subscription benefit — is the *better*
   business: recurring revenue, no licensing exposure. Start owner-mediated:
   the broker sees market/type/size/date of demand, the owner still makes the
   connection, owner PII never auto-forwards.
2. **The broker directory.** `/brokers` is a pitch page, not a listing. Most of
   the data model already exists — `broker_profiles` (slug, public, company),
   `cited_count`, and `/broker/<slug>` pages already render and are in
   `sitemap.xml`. What's missing is the list.
3. **PDF import.** Deferred on purpose: it needs an AI call per upload, costs
   money, and is sometimes wrong. Add it when a real broker asks and you can
   watch it work on their documents.
4. **Blended reports (v2)** — needs vault volume before it means anything.
5. **Ratings** — last, per §5. A thin rating is worse than none.

## Known gaps

- **Broker identity is still two systems.** `/api/broker/me` decides "is a
  broker" by *"has this email ever submitted a comp"*, and `broker_profiles` is
  keyed on `email` with no `user_id`. The paid tier keys on a subscription
  against `user_id`. A broker who pays but has never submitted reads
  `isBroker: false`, and an email change orphans a profile. Fix before more
  broker surfaces are built: add `user_id` to `broker_profiles`, make
  `canUseVault` the answer to "is a paying broker", keep "has contributed" as a
  separate weaker fact.
- **Unpublish is not fully retroactive.** It stops future offers; reports already
  delivered keep the comp, and the corpus retains what it harvested. The confirm
  dialog says so before the broker clicks.
- **What happens to vault data when a subscription lapses** is undecided.
  `canUseVault` only answers "may they open it today". Retention/deletion is a
  product and privacy decision the policy will have to state.
- **No upload size or row cap beyond 5,000 rows per file.** Uncapped upload to a
  paid tier is a cost and abuse surface; it travels with pricing.
- **`docs/ROADMAP.md` is stale** — still lists broker v1 under "Now" with nothing
  in the shipped log, and still says "New tables get the star schema", which this
  work deliberately did not do.

## Open questions (not code)

**Chuck:** broker-tier monthly price; which dashboard views matter day one.
**Attorney:** terms for storing broker private data — processing limits,
deletion rights, liability for data a broker wasn't licensed to hold. **This
gates launch, not development.**
