# Applied migrations (production Supabase)

One line per migration, added when it is run on the live database. A file in
this folder that is missing from this list has NOT been run.

**Full schema verified 2026-08-05 (through 015):** everything through 014 was
confirmed by `node migrations/verify.js`; 015 was run and verified directly in
the SQL editor against `information_schema` and `pg_indexes` (see its row
below), because this machine's `.env` holds no Supabase credentials.

| File | Status on prod | Evidence |
|------|----------------|----------|
| 000-baseline-hand-created.sql | live (created by hand, pre-folder) | app has been storing leads/cache/shares/analytics/submissions since launch |
| 001-comp-corpus.sql | applied (original create, without per-type columns) | corpus rows exist since 2026-07 |
| 002-accounts.sql | applied | accounts live since 2026-07-19 |
| 003-broker-network.sql | applied 2026-07-19 | dated in the server.js comment it came from |
| 004-comp-corpus-per-type-columns.sql | applied late 2026-07 | run when the corpus outage was found; harvesting verified resumed |
| 005-dev-ideas.sql | applied | /dev ideas persist across deploys |
| 006-devlog-overrides.sql | applied | /dev entry edits persist across deploys |
| 007-contacts.sql | applied (verified 2026-08-04) | /contacts is live; table confirmed by the schema query |
| 008-pro-billing.sql | applied ~2026-07-31 (incl. the comp_snapshot drop-not-null) | test checkouts and the $39 unlock wrote rows |
| 009-subject-sizes.sql | applied 2026-08-01 | run + verified via Chrome, RLS on |
| 010-market-pages.sql | live (created by hand) | Address Explorer pages persist since 2026-08-03 |
| 011-guest-search-quota.sql | applied 2026-08-03 | "already run in prod" per server.js/CLAUDE.md |
| 012-search-timings.sql | applied 2026-08-04 | run + verified via Chrome (information_schema returned all 4 columns); re-confirmed 2026-08-05 by `verify.js` |
| 013-broker-vault.sql | applied 2026-08-05 | run in the SQL editor by the owner; `verify.js` reports the full schema present, and a probe insert confirmed all 28 columns and types are accepted by the live table |
| 014-vault-publish-link.sql | applied 2026-08-05 (logged after the fact) | verified via Chrome in the SQL editor: `published_submission_id` exists in `broker_comps` and `broker_comps_published_submission_idx` is in `pg_indexes` — both halves of the file |
| 015-broker-lead-inbox.sql | applied 2026-08-05 | pre-check (duplicate lowercased emails in `broker_profiles`) returned zero rows first; whole file pasted byte-identical (checksum-matched against the committed file) and run in the SQL editor, "Success. No rows returned", so the `leads.id` type guard did not raise. Verified by one `information_schema`/`pg_indexes` query returning all ten objects: tables `broker_coverage` + `lead_intro_requests`, columns `broker_profiles.user_id` (uuid), `leads.size_sqft` (numeric), `leads.id` (bigint), and indexes `broker_profiles_user_id_uidx`, `broker_coverage_market_type_idx`, `lead_intro_requests_user_id_idx`. Backfill matched 0 profiles because `broker_profiles` is still empty |
| 016-broker-comps-star.sql | applied 2026-08-06 | whole file pasted and run in the SQL editor, "Success. No rows returned"; the file is wrapped in begin/commit so a partial apply was not possible. RUN TWICE: the first run was missing `alter table broker_properties enable row level security`, which 013 sets on broker_uploads and broker_comps and 016 had omitted — without it the anon role could read every broker's buildings and markets through PostgREST. The corrected file was re-run whole (it is idempotent throughout: create-if-not-exists, on-conflict-do-nothing, create-or-replace, and enabling RLS twice is a no-op). Verified three ways: the information_schema/pg_indexes query returned all nine objects (table `broker_properties`, column `broker_comps.property_id`, view `broker_comps_reporting`, and the six indexes); `pg_class.relrowsecurity` reported LOCKED for all of broker_comps, broker_uploads and broker_properties; and `node migrations/verify.js` exited clean at 28 tables / 26 columns. The backfill matched 0 rows because the vault is still empty — 0 comps, 0 properties — which is why this was the cheap moment to run it. |
| 017-broker-property-coordinates.sql | applied 2026-08-06 | Run in the SQL editor as the four `add column if not exists` plus the three `add constraint` statements, wrapped in the file's own begin/commit — "Success. No rows returned". The comment blocks were not pasted; they do not execute, and the statements are byte-equivalent to the file with `--` lines stripped. **NOT IDEMPOTENT, unlike 016:** Postgres has no `add constraint if not exists`, so a second run aborts on `broker_properties_latlng_range` already existing and the whole transaction rolls back — harmless, but it is not the no-op the other files are. Verified twice: `node migrations/verify.js` went from naming all four columns as missing to clean at 28 tables / 30 columns; and the checks were proven to ENFORCE rather than merely exist by attempting an insert with `lat=91`, which PostgREST refused with 400 `violates check constraint`. broker_properties held 0 rows, so every existing row trivially satisfied the new constraints. |
| 018-report-sharing.sql | pending | File written 2026-08-06 as Task 2 of client-sharing feature; migration adds columns to shared_reports and creates report_viewers table. **Deploy-before-migrate takes every existing share link offline, not just new ones.** Production auto-deploys from `main`, so merging the sharing routes IS the trigger. Once the new server.js is live and this migration has not yet run: `getShareRecord`'s Supabase read selects the new columns, PostgREST 400s on the unknown columns, and the deliberately fail-closed catch rethrows — so `GET /api/shared` answers 503 for EVERY share, including every legacy public link already mailed to property owners who have no CompNinja account and no way to know the link is temporarily broken. Meanwhile `POST /api/share` falls back to the ephemeral `shared-reports.json` file, which the host wipes on the next deploy, so shares created during the gap are also lost. Migrate-then-deploy is completely safe; the ordering is one-directional — run this migration BEFORE deploying the sharing routes, never after. |

## Verification

```bash
node migrations/verify.js
```

Read-only, zero dependencies, needs `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in
`.env`. It asks PostgREST for zero rows from every expected table **and every
spot-checked column**, and exits non-zero listing whatever is absent, grouped
by the migration that creates it.

**Check columns, not just tables.** The 004 outage is invisible to a
table-existence check: `comp_corpus` existed throughout, ten *columns* were
missing, every insert 400'd for weeks. `verify.js` asks about both.

Last run 2026-08-05: everything through 014 present. 015 was applied after that
run and verified in the SQL editor instead, so the next `verify.js` (on a
machine that has the Supabase credentials) should report everything present
through 015.

Not in CI, deliberately — CI holds no secrets, by design, so that a fork PR
cannot exfiltrate one. This is a local command run around a schema deploy.

<details>
<summary>The hand-run SQL this replaced (still valid in the Supabase editor)</summary>

Last run 2026-08-04: zero rows. **Zero rows returned means the schema is
complete**:

```sql
select t as missing_table
from unnest(array[
  'leads','search_cache','shared_reports','analytics_events',
  'comp_submissions','comp_corpus','users','sessions','portfolio_items',
  'watchlist_items','password_resets','broker_profiles','dev_ideas',
  'devlog_overrides','contacts','subscriptions','branding_profiles',
  'report_purchases','export_usage','stripe_events','subject_sizes',
  'market_pages','guest_search_quota']) as t
where not exists (select 1 from information_schema.tables
                  where table_name = t)
union all
select 'column: ' || tc || '.' || c
from (values
  ('comp_corpus','beds_baths'), ('comp_corpus','zoning'),
  ('comp_submissions','cited_count'), ('dev_ideas','done_at'),
  ('users','stripe_customer_id'), ('leads','source')) as v(tc, c)
where not exists (select 1 from information_schema.columns
                  where table_name = tc and column_name = c);
```

</details>

After a re-run, update the date on the "Full schema verified" line above.
