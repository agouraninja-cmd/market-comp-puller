# Applied migrations (production Supabase)

One line per migration, added when it is run on the live database. A file in
this folder that is missing from this list has NOT been run.

**Full schema verified 2026-08-04:** the query below was run in the Supabase
SQL editor and returned zero rows, confirming every table and every
spot-checked column exists in production.

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

## Verification query

Last run 2026-08-04: zero rows. Re-run any time schema drift is suspected;
**zero rows returned means the schema is complete**:

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

After a re-run, update the date on the "Full schema verified" line above.
