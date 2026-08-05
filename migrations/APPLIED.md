# Applied migrations (production Supabase)

One line per migration, added when it is run on the live database. A file in
this folder that is missing from this list has NOT been run.

**Full schema verified 2026-08-05:** `node migrations/verify.js` reported
"Everything present" — every expected table and every spot-checked column
exists in production.

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

Last run 2026-08-05: everything through 012 present; only 013 outstanding.

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
