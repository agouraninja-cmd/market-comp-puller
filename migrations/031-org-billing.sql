-- 031 · Per-seat firm billing (2026-08-16)
-- Spec: docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md §9
--
-- RUN BEFORE DEPLOYING the firm checkout. Purely additive: one new table.
-- Deploy-then-migrate costs the feature and nothing else — no existing read
-- names this table, and findSubscription's org lookup is wrapped so a missing
-- table resolves every member to their own plan rather than failing.
--
-- ---------------------------------------------------------------------------
-- A SEPARATE TABLE, NOT COLUMNS ON `orgs`, AND NOT ROWS IN `subscriptions`
-- ---------------------------------------------------------------------------
-- `subscriptions` is PRIMARY KEY (user_id) with a NOT NULL FK to users, so a
-- firm cannot live there without making that column nullable — which would
-- weaken the one constraint stopping a second rival row for a paying person.
-- 008's own comment says why that key is a key: "a second checkout by the same
-- person must UPDATE, never insert a rival row that could out-rank it." The
-- same guarantee is wanted here, keyed on the firm.
--
-- Columns on `orgs` were the other candidate and are worse for a duller
-- reason: `orgs` is read on nearly every firm request (membership, the shelf,
-- the badge on a blended comp) and billing state is read on none of them.
--
-- ---------------------------------------------------------------------------
-- SEATS LIVE ON `orgs`, NOT HERE
-- ---------------------------------------------------------------------------
-- Deliberately, and it is the one field that could plausibly have gone either
-- way. `orgs.seats` (028) is the enforced cap on how many people may be IN a
-- firm, and that question has an answer for a firm that has never paid us
-- anything — the hand-granted case, which is how the first firms arrive
-- (§9, the vault_beta precedent). Putting it here would mean a firm with no
-- subscription row had no seat count at all, and every caller would need a
-- default. The webhook writes `orgs.seats` from the subscription quantity;
-- everything else reads one column whether or not money is involved.

create table if not exists org_subscriptions (
  -- One row per firm, by primary key, for 008's reason restated above.
  org_id uuid primary key references orgs(id) on delete cascade,
  stripe_subscription_id text unique,
  stripe_customer_id text,
  plan text not null,                  -- firm_monthly
  status text not null,                -- active | past_due | grace | cancelled
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,             -- set when a payment fails (7 days)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The webhook's lookup when a subscription event carries no org metadata.
create index if not exists org_subscriptions_customer_idx
  on org_subscriptions (stripe_customer_id) where stripe_customer_id is not null;

alter table org_subscriptions enable row level security;

-- NO FILE FALLBACK, the stance 008 already takes for `subscriptions` and for
-- the same reason: Render's filesystem is ephemeral, and a subscription
-- written to disk would vanish on the next deploy, silently turning a paying
-- firm into a free one.

-- Verify (zero rows = applied):
--   select 'org_subscriptions' where not exists (select 1 from information_schema.tables
--                                                where table_schema='public' and table_name='org_subscriptions');
--   select 'column: org_subscriptions.' || c
--   from unnest(array['org_id','stripe_subscription_id','plan','status',
--                     'current_period_end','grace_until']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_schema='public' and table_name='org_subscriptions' and column_name=c);
