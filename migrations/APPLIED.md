# Applied migrations (production Supabase)

One line per migration, added when it is run on the live database. A file in
this folder that is missing from this list has NOT been run.

**Full schema verified 2026-08-12 (through 023, via `node migrations/verify.js`: 29 tables, 36 columns, all present):** the 2026-08-05 pass below covered through 015; everything through 014 was
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
| 018-report-sharing.sql | applied 2026-08-06 | Run in the SQL editor (project "Market comp puller") as the executable statements of the file, comments stripped, editor content read back and diffed against the file before running: "Success. No rows returned". Verified in the same session by query, not by `verify.js` — the local `.env` carries no Supabase credentials (they live only on Render), so the script cannot run from this machine. The query confirmed: all four `shared_reports` columns present, `report_viewers` present, `relrowsecurity` **true on both** `shared_reports` (it was already enabled; the migration does not touch it) and `report_viewers`, and — the backward-compatibility check that mattered — all 4 pre-existing `shared_reports` rows backfilled to `visibility = 'public'`, with zero rows at any other visibility. Original note kept below because the ordering rule stays true for any future deployment of this schema. File written 2026-08-06 as Task 2 of client-sharing feature; migration adds columns to shared_reports and creates report_viewers table. **Deploy-before-migrate takes every existing share link offline, not just new ones.** Production auto-deploys from `main`, so merging the sharing routes IS the trigger. Once the new server.js is live and this migration has not yet run: `getShareRecord`'s Supabase read selects the new columns, PostgREST 400s on the unknown columns, and the deliberately fail-closed catch rethrows — so `GET /api/shared` answers 503 for EVERY share, including every legacy public link already mailed to property owners who have no CompNinja account and no way to know the link is temporarily broken. Meanwhile `POST /api/share` falls back to the ephemeral `shared-reports.json` file, which the host wipes on the next deploy, so shares created during the gap are also lost. Migrate-then-deploy is completely safe; the ordering is one-directional — run this migration BEFORE deploying the sharing routes, never after. |
| 020-search-cache-address.sql | applied 2026-08-08 | Run in the SQL editor (project "Market comp puller") as the file's five executable statements (begin/2×alter/create index/commit), comments stripped; the editor buffer was read back before running and matched the file byte for byte (no Monaco auto-close artifact this time): "Success. No rows returned". Verified in the same session by one query returning exactly 3 rows: columns `search_cache.address_key` and `search_cache.prop_type` in `information_schema.columns`, and `search_cache_address_key_idx` in `pg_indexes`. Purely additive and idempotent (add column if not exists / create index if not exists). Deploy-order-safe by design: the code writes these columns in a separate best-effort PATCH after the main cache insert, so either order costs at most the badge, never a cache row. Existing rows stay null and never badge; the 30-day TTL turns them over. |
| 019-broker-bovs.sql | applied 2026-08-08 | Run in the SQL editor (project "Market comp puller") as the file's three executable statements, comments stripped; the editor buffer was read back line by line before running and one Monaco auto-close artifact (a stray trailing `)`) was removed first: "Success. No rows returned". Verified in the same session by a single query returning exactly 16 rows: table `broker_bovs`, index `broker_bovs_user_id_idx`, `pg_class.relrowsecurity` true, and all 13 columns with expected types (`id` uuid, `user_id` uuid, `lead_id` bigint, `market`/`property_type`/`address`/`notes`/`source`/`status` text, `size_sqft` numeric, `received_on` date, `status_changed_at`/`created_at` timestamptz). No backfill by design: seeding happens in JS on first tracker open (see the file's header). Table created empty, so nothing existing could violate the check constraints. |
| 021-broker-csv-mappings.sql | applied 2026-08-10 | Run in the SQL editor (project "Market comp puller") **by the owner**, reported run before the merge was pushed. **Not independently verified from this machine**, unlike 019/020: the local `.env` carries no Supabase credentials (they live only on Render), and no code path exposes the table's existence to an unauthenticated caller, so there was nothing to probe. The file's own commented `information_schema.tables` trailer is the check to run if confirmation is ever wanted. Purely additive and idempotent (`create table if not exists`); table created empty, one row per broker, `user_id` as the primary key. **Deploy-order-safe by design** and the reason this was not blocking: both `getCsvMapping` and `saveCsvMapping` swallow their own errors, so on a deploy without the table a broker gets a fully working column mapper that simply does not remember their mapping, plus two `console.warn` lines. The failure mode is a lost convenience, never a lost upload. |
| 022-tester-passkey.sql | applied 2026-08-10 | Run in the SQL editor (project "Market comp puller") **by the owner**, who ran the file's single `alter table` plus its commented verification query. **Independently verified from this machine** by reading the production schema in the dashboard rather than taking the run on trust: `public.users` now reports **7 columns**, the seventh being `pro_tester` · `bool` · NON-NULLABLE. That check was chosen deliberately over reading the SQL editor result, because the editor had several unrun query tabs open and it was not possible to tell which one had been executed; the schema itself cannot be ambiguous. Purely additive and idempotent (`add column if not exists`), and `not null default false` backfilled all 12 existing rows to "not a tester" in the ALTER itself, so no account gained access from the migration. Was applied AFTER the route shipped, which the file explicitly allows: `getSessionUser` reads a missing column as `undefined` → `false`, so the only cost of the gap was that `/api/redeem-passkey` would have failed for anyone trying it, never a wrong grant. |
| 023-vault-beta.sql | applied 2026-08-12 | Run in the SQL editor (project "Market comp puller") **by the owner**, who ran the file's single `alter table`. **Independently verified from this machine** rather than taken on trust, the same standard 022 set: PostgREST was asked for `users.vault_beta` across all 15 rows and answered 200 with **15 false, 0 true, 0 null**, so the column exists and `not null default false` backfilled every existing account to "no grant" inside the ALTER itself. No account gained access from the migration. Purely additive and idempotent (`add column if not exists`). **The run immediately exposed a code bug rather than a schema one:** with the column present and the grant set on a test account, the vault still refused, because `getSessionUser` returns a deliberately NARROWED user object and `vault_beta` had never been added to it, so `getEntitlements` read `undefined` and every granted broker resolved to no vault with nothing failing anywhere. Fixed the same day, and `test/routes.test.js` now pins the pairing by reading both sides out of server.js. `migrations/verify.js` also gained checks for this column AND for 022's `pro_tester`, neither of which it had ever looked at, so a future unrun grant migration is caught by the tool instead of by a broker. |
| 024-messaging-hub.sql | applied 2026-08-13 | Run in the SQL editor (project "Market comp puller") **by the owner**. Creates the messaging hub's four tables (`hubs`, `hub_participants`, `hub_items`, `hub_messages`) plus their indexes. Purely additive and idempotent (`create table if not exists` throughout); it ALTERs nothing that already existed, so no live table was touched and nothing could be lost by running it. **Independently verified from this machine** rather than taken on trust, the standard 022 and 023 set: `node migrations/verify.js` answered "Everything present" against 33 tables and 42 columns, and that is a real check rather than a table-existence one, because 024's entry in `verify.js` names the load-bearing COLUMNS too (`hub_participants.token_hash`/`removed_at`/`role`, `hub_items.snapshot`/`private`/`source_ref`) and PostgREST answers a select for an unknown column with a 400 — the same signal the app itself would trip over. **Schema is live AHEAD of the code, which is the safe order:** the hub routes are still on `feat/messaging-hub` and unmerged, so nothing reads these tables in production yet. Until that branch lands, the tables simply sit empty. |

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
