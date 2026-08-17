-- 029 · Lease rent in the broker vault (2026-08-17)
--
-- Until now the vault only really worked for investment sales. normalizeRow
-- writes price_per_sqft for SALES ONLY — correctly, because an annual rent
-- divided by size is $/SF/yr and would corrupt every median it entered — and
-- nothing computed the rent figure either. The template told brokers to
-- "Leave price blank on a lease" and to put the rent in `notes` as prose, so
-- a leasing broker's whole book showed "no priced sales yet" on every rollup
-- card, no median in the table footer, and nothing on the year chart.
--
-- Four columns, three of them input and one derived:
--
--   rent_psf    the rent as the broker quotes it, per square foot
--   rent_basis  'annual' | 'monthly' — REQUIRED whenever rent_psf is given
--   lease_type  'NNN' | 'FS' | 'MG' — optional, disclosed when mixed
--   rent_psf_yr derived: rent_psf, or rent_psf * 12 when the basis is monthly
--
-- rent_basis is required rather than defaulted because the convention is not
-- national: California industrial and retail quote rent MONTHLY ($1.35/SF/mo)
-- while most of the country quotes annually. Defaulting to annual would take
-- a Los Angeles broker's 1.35 and store it as $1.35/SF/yr — a figure 12x low,
-- sitting in their own records looking perfectly plausible. That is exactly
-- the class of silent error broker-vault.js exists to refuse: it rejects
-- "1.2M" rather than guessing, on the grounds that a wrong number in a
-- broker's book is worse than a rejected row because nobody will catch it.
--
-- rent_psf_yr is derived and stored rather than computed on read, mirroring
-- price_per_sqft: one canonical column for every median, chart and filter to
-- agree on, produced by one piece of code instead of several that can drift.
--
-- lease_type is optional on purpose. Mixing NNN and full-service in one median
-- makes the figure WEAKER, which the page discloses; mixing annual and monthly
-- makes it WRONG, which is refused. Those are different problems and get
-- different answers.
--
-- MIGRATE BEFORE DEPLOY, unlike 027. (Filed as 028 until 2026-08-17, when a
-- concurrently-shipped 028-comp-condition.sql took the number; the SQL the
-- owner ran is byte-identical to what is below.) This is the broker_comps insert path:
-- normalizeRow puts these keys on the row it returns and server.js inserts
-- that row wholesale, so PostgREST would 400 on the unknown columns and refuse
-- the broker's entire spreadsheet. Same one-directional ordering as 013, 016
-- and 017, and for the same reason. Migrate-then-deploy is completely safe:
-- the columns sit unwritten until the code ships.
--
-- Purely additive and idempotent (add column if not exists throughout), so a
-- re-run is a no-op. Nothing is backfilled: every existing row is a comp whose
-- rent was never captured in a column, and inventing one is not available.
-- The check constraints are stated as vocabulary guards only — the parser is
-- the real validator, and these exist so a direct SQL insert cannot introduce
-- a basis the application has no rule for.
--
-- rent columns are deliberately NOT carried into comp_corpus by publishing.
-- comp_corpus has no rent column, and submissionRowFrom is an explicit
-- allowlist that never spreads its input, so a published lease carries what
-- it always did. Giving the public corpus a rent column is a separate
-- decision with its own provenance questions, not a side effect of this one.

begin;

alter table broker_comps add column if not exists rent_psf numeric;
alter table broker_comps add column if not exists rent_basis text;
alter table broker_comps add column if not exists lease_type text;
alter table broker_comps add column if not exists rent_psf_yr numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'broker_comps_rent_basis_chk'
  ) then
    alter table broker_comps add constraint broker_comps_rent_basis_chk
      check (rent_basis is null or rent_basis in ('annual', 'monthly'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'broker_comps_lease_type_chk'
  ) then
    alter table broker_comps add constraint broker_comps_lease_type_chk
      check (lease_type is null or lease_type in ('NNN', 'FS', 'MG'));
  end if;
end $$;

-- The rollup, the year chart and the table footer all read this column filtered
-- to one broker's leases in one market, which is the same shape the sales side
-- already indexes.
create index if not exists broker_comps_rent_idx
  on broker_comps (user_id, market, property_type)
  where rent_psf_yr is not null;

commit;

-- Verification (expects 4 rows for the columns, 2 for the constraints, 1 index):
--
-- select column_name from information_schema.columns
--  where table_name = 'broker_comps'
--    and column_name in ('rent_psf','rent_basis','lease_type','rent_psf_yr');
-- select conname from pg_constraint
--  where conname in ('broker_comps_rent_basis_chk','broker_comps_lease_type_chk');
-- select indexname from pg_indexes where indexname = 'broker_comps_rent_idx';
