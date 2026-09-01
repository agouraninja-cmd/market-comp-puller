-- 037 · Tenant rep is the third kind of shop (2026-08-21)
--
-- WITHDRAWN IN CODE 2026-08-31. The owner dropped the tenant rep shop, so
-- SHOP_KINDS holds two values again and validateShopKind refuses this string.
-- THIS FILE IS NOT REVERTED AND MUST NOT BE: the constraint stays wide, and
-- APPLIED.md's row for it says why (narrowing would fail on the only rows
-- that make narrowing matter, and nothing can write the value any more). It
-- is kept as the applied history of a column that still allows three values
-- while the product offers two.
-- Plan:  Business Model Transition Plan v2 §6 ("Broker Shops and Development
--        Shops"), Chuck Dickinson, 2026-08-17, extended by Owen 2026-08-21.
-- Rules: org-access.js (kindOf, SHOP_KINDS, SHOP_COPY)
-- Widens: 036-org-shop-kind.sql
--
-- RUN BEFORE DEPLOYING the tenant rep option. 036's hazard does not repeat
-- here (`kind` already exists, so no SELECT names an unknown column and no
-- firm surface goes down), but a narrower one does: the deploy puts a third
-- option in two dropdowns, and until this runs the database refuses the value
-- those dropdowns send. The owner who picks it gets a 503 from a route that
-- looks like it should have worked. Migrate first, then deploy.
--
-- Strictly WIDENING: every row that satisfied the old constraint satisfies the
-- new one, so there is no row to rewrite and nothing to back out. That is the
-- whole reason this is safe to run against production with no staging database
-- to rehearse against - the same rule 030, 031 and 036 were held to.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A THIRD KIND AND ENTERPRISE STILL IS NOT
-- ---------------------------------------------------------------------------
-- 036 argued that a value nothing may select is a value that rots, and refused
-- 'enterprise' on exactly that ground. Tenant rep passes the test enterprise
-- fails: it is a shop that signs up the same way the other two do, one person
-- at a time, and it reads different nouns off the same shelf. Nothing is gated
-- on it and nothing is published by it, same as the other two.
--
-- ---------------------------------------------------------------------------
-- NO DEFAULT CHANGES
-- ---------------------------------------------------------------------------
-- 'broker' stays the column default and stays what kindOf() reads an
-- unrecognized value as. Both for 036's reason, unchanged: the default only
-- ever describes rows written before the column existed, and the fallback is
-- incumbency rather than safety. No existing firm becomes a tenant rep shop by
-- this migration; the only way into the new value is somebody choosing it.
--
-- One DO block rather than a DROP statement and an ADD statement, because a
-- DO block is one statement and therefore one transaction. Run loose, the two
-- would leave a window with no constraint at all, and the SQL editor is not a
-- place to be relying on somebody pasting both halves.

do $$
begin
  alter table orgs drop constraint if exists orgs_kind_check;
  alter table orgs add constraint orgs_kind_check
    check (kind in ('broker', 'development', 'tenant_rep'));
end $$;

-- Verify (zero rows = applied):
--   select 'orgs_kind_check accepts tenant_rep'
--   where not exists (select 1 from pg_constraint
--                     where conname = 'orgs_kind_check'
--                       and pg_get_constraintdef(oid) like '%tenant_rep%');
