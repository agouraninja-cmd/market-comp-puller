# v4 slice 2: BOV tracking, the broker's practice log

**Date:** 2026-08-08
**Status:** AGREED (owner-approved section by section in session)
**Source:** "CompNinja Ecosystem Plan" (2026-07-31) §3 v4 ("how many BOVs did
we get?"); `docs/ROADMAP.md` v4-remaining line; deferred list in
`docs/superpowers/specs/2026-08-08-gut-check-design.md`. Builds on the live
broker lead inbox and `lead_intro_requests` (migration 015).

## Scope decision

v4's remaining candidates are BOV tracking and 1031 workflow education. The
owner chose BOV tracking next; 1031 education follows later with its own
spec (a content slice; education, never advice). This spec covers only BOV
tracking.

Two scope calls made by the owner in session:

- **The tracker is the broker's own pipeline**, not market-demand
  analytics. Demand trends over today's lead volume would render mostly
  empty, and the vault taught us empty surfaces read as broken. The live
  inbox already shows demand.
- **It logs BOVs from any source**, not only CompNinja intros. CompNinja
  intro requests appear automatically; BOVs from the broker's own
  referrals and repeat clients are added by hand. That makes it the
  broker's complete practice log from day one, which is what the plan's
  phrase ("practice tool") is asking for.

## What the feature is

A "BOV tracker" section on `/vault`: one row per BOV engagement, each
moving through a simple lifecycle (open, delivered, won or lost), with
summary tiles answering the plan's question directly: BOVs this year, open
now, delivered, and win rate.

The trail today ends at the intro request: a broker raises a hand in the
inbox, the owner connects them by hand, and nothing records what became of
it. This closes that loop from the broker's side. Statuses past the intro
are entered by the broker themselves; CompNinja never observes the outcome.

## Data model

`broker_bovs` (migration `019-broker-bovs.sql`, star-style per the
Ecosystem Plan §6):

- `id` uuid PK default `gen_random_uuid()`; `user_id` uuid not null
  references `users(id)` on delete cascade; `created_at` timestamptz.
- `lead_id` bigint, nullable: set only when the row came from a CompNinja
  intro request, linking back to `leads`. No FK, matching
  `lead_intro_requests`' reasoning (migration 015 asserts the id type; a
  dangling id renders nothing). `unique (user_id, lead_id)` stops a repeat
  intro from creating a duplicate; NULLs compare distinct, so manual rows
  are unlimited (the same trick `dedupe_key`'s comment documents).
- `market` text not null, canonical `marketOf()` form; `property_type`
  text not null, the vault's vocabulary. Required: the tracker slices by
  them.
- `size_sqft` numeric, `address` text, `notes` text, `received_on` date:
  optional, broker-entered.
- `source` text: `'compninja' | 'referral' | 'repeat_client' | 'other'`,
  check-constrained, default `'other'`.
- `status` text: `'open' | 'delivered' | 'won' | 'lost'`,
  check-constrained, default `'open'`; `status_changed_at` timestamptz.
- Index on `user_id`; RLS enabled (service key bypasses, same as every
  broker table).

**Lifecycle is deliberately not policed.** Any status can be set at any
time; a BOV goes straight from open to lost when it dies quietly. This is
the broker's own log, not a workflow engine. `bov-log.js` validates the
vocabulary, never the transitions.

**Backfill.** The migration seeds one row per existing
`lead_intro_requests` entry (joined to `leads` for market, type, size), so
a broker who already requested intros opens the tracker to their real
history. Purely additive; precedent is 015's profile backfill. The
existing destructive-statement test guard covers the new file.

## Routes

All four go through `requireBroker` (the inbox's gate: 401 not signed in,
403 not a broker via `canUseVault`, 503 no database). DB-only, no file
fallback: the vault rule, for the vault reason. A practice log written to
Render's disk would vanish on the next deploy.

- `GET /api/broker/bovs`: the caller's rows, newest first, capped at 500,
  plus the rollup (`bov-log.js`: counts by status, this-year count, win
  rate) so the page needs one fetch.
- `POST /api/broker/bovs`: add a manual row. Validation in `bov-log.js`:
  market must pass `LEADSVC.isCanonicalMarket` (the coverage form's rule),
  type from `VAULT.PROPERTY_TYPES`, size and date cleaned the vault's way
  (reject, never guess), notes and address length-capped.
- `POST /api/broker/bovs/update`: `{ id, status?, notes? }`, scoped by
  `user_id`, stamps `status_changed_at` on a status change.
- `DELETE /api/broker/bovs?id=`: scoped by `user_id`. Knowing another
  broker's row id must never be enough to touch it.

**Auto-create.** In the existing `POST /api/broker/leads/intro` handler,
after a new intro request succeeds (the `already: true` path skips this),
insert a `broker_bovs` row: `source: 'compninja'`, the `lead_id`, and
market, type, size copied from the lead. Non-blocking: if the insert
fails, the intro still succeeds; the introduction is the primary action
and the log row is re-derivable by the backfill query. The unique
constraint makes a race harmless.

## Privacy

The log is the broker's private practice data and lives behind the wall
with the vault's exact treatment:

- Never read by any owner surface. `/admin`'s intro-requests card is
  unchanged: it keeps showing that a request was made, never what became
  of it.
- Never near `harvestComps()`, `corpusRowsForMarket()`, market snapshots,
  or another account's anything. Separate table, separate functions, the
  standing rule.
- One PII-free `logEvent` (`kind: "bov"`, market and type only) on manual
  adds, so `/admin`'s existing analytics show the feature is used, and
  nothing more.
- On subscription lapse the log locks but is never deleted, the same
  promise the plan card already makes for the vault.

## UI (on `/vault`, rendered by `vault-page.js`)

- The tracker section: four summary tiles (this year, open, delivered,
  win rate), then the log as a sortable table: date, market, type, size,
  source, status as a per-row `<select>`, notes, delete. A small "Log a
  BOV" form: market, type, source required; size, date, address, notes
  optional.
- **The empty state is a sentence, not an empty table** (the vault's own
  rule). With zero rows the section shows one line of prose plus the
  form, keeping the manual-add door visible.
- **First run:** the section hides with everything else `applyFirstRun()`
  hides. A broker who hasn't uploaded a book gets the two-step start
  page, not a third step.
- The win-rate tile shows a dash until at least 3 decided (won or lost)
  BOVs exist; a 100% win rate over one data point reads as a joke.
- The status `<select>` posts on change and reverts visually on failure,
  the intro button's optimistic-with-rollback pattern.

## Testing (`npm test`, no database)

- `test/bov-log.test.js`: the pure module. Validation vocabulary,
  rejection cases, rollup math including the win-rate floor and the
  this-year boundary. Caller passes `now`; no clock reads, no I/O, same
  contract as `entitlements.js`.
- `test/routes.test.js`: the wiring. All four routes refuse in
  `requireBroker`'s order (401, 403, 503); scoping proven the way the
  vault routes are.
- `test/vault-page.test.js`: still compiles the emitted page JS (the
  one-template-literal hazard), extended to pin the tracker's presence,
  its first-run hiding, and the sentence-not-table empty state.

## Rollout

- Migration `019-broker-bovs.sql`, run before deploying; includes the
  backfill.
- **Implementation waits for slice 1 (the gut check) to merge**: both
  slices edit `vault-page.js`. Writing this spec and its plan is the work
  that runs in parallel.
- No env var, no Stripe change, no copy outside `/vault`. Devlog entry in
  the shipping commit; `docs/ROADMAP.md`'s v4 line updates to leave only
  1031 education; CLAUDE.md gets a short tracker section under the broker
  vault.
- Final verification is a real browser drive of `/vault` by the primary
  session; the last three features' browser passes each caught something
  static review missed.
- Deferred, deliberately: market-demand analytics (revisit when lead
  volume supports a trend line), any owner-side funnel view of outcomes
  (it would read broker private data; if ever wanted, it must be a
  separate, explicit, aggregated design), reminders or notifications on
  stale open BOVs, and CSV export of the log.
