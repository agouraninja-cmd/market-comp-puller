-- 036 · What kind of shop a firm is (2026-08-21)
-- Plan:  Business Model Transition Plan v2 §6 ("Broker Shops and Development
--        Shops"), Chuck Dickinson, 2026-08-17.
-- Rules: org-access.js (kindOf, SHOP_KINDS, SHOP_COPY)
--
-- RUN BEFORE DEPLOYING the shop-type UI. This is 030's hazard, not 031's:
-- orgsByIds() and findOrg() name their columns in the SELECT, and PostgREST
-- 400s on an unknown column, so the deploy that adds `kind` to those selects
-- takes down EVERY firm surface until this runs. Migrate first, then deploy.
--
-- Purely additive: one column with a default, no DROP, no destructive ALTER,
-- no existing row's meaning rewritten. Same rule as 030 and 031, and for the
-- same reason - there is no staging database to rehearse against.
--
-- ---------------------------------------------------------------------------
-- TWO KINDS, NOT THREE
-- ---------------------------------------------------------------------------
-- §6: the hub serves two customer types with the same architecture and
-- different saved views. A broker shop loses a producer's book when they
-- resign; a development shop loses the assumptions behind a pro forma nobody
-- can reconstruct. Same failure, different nouns.
--
-- Enterprise is deliberately NOT a third value. The same section rules it out
-- as a target ("a research department that will kill the deal internally and a
-- governance process measured in quarters"), and names its real entry point as
-- someone who used CompNinja at their last shop. A value nothing may select is
-- a value that rots.
--
-- ---------------------------------------------------------------------------
-- WHY 'broker' IS THE DEFAULT
-- ---------------------------------------------------------------------------
-- Every firm that exists when this runs was created by the slice-1 flow, which
-- had no such question, and every string those firms have already read is
-- broker-shop vocabulary. The default is therefore what they have been shown
-- all along rather than a guess about them. New firms do not take it: the
-- create route REQUIRES an explicit choice (org-access.js validateShopKind),
-- so this default only ever describes rows written before the column existed.
--
-- The CHECK is the same fail-closed posture org-access.js takes in code: an
-- unrecognized kind reads as 'broker' there, and cannot be written here.

alter table orgs
  add column if not exists kind text not null default 'broker';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orgs_kind_check') then
    alter table orgs add constraint orgs_kind_check
      check (kind in ('broker', 'development'));
  end if;
end $$;

-- Verify (zero rows = applied):
--   select 'orgs.kind'
--   where not exists (select 1 from information_schema.columns
--                     where table_schema = 'public'
--                       and table_name = 'orgs'
--                       and column_name = 'kind');
