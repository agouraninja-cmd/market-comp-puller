-- 041: a firm's own branding profile — the org-level fallback for report
-- branding (2026-08-29).
--
-- One profile per firm, saved by an owner/admin, applied to a member's report
-- only when that member has no personal branding_profiles row of their own
-- (branding.js's brandForRender owns that rule; the member's own profile
-- always wins). Columns mirror branding_profiles deliberately, so
-- BRANDING.normalizeBrand / validateForSave serve both tables unchanged.
--
-- A SEPARATE TABLE, not columns on orgs: orgsByIds() and findOrg() name their
-- SELECT columns and PostgREST 400s an unknown one, so widening orgs would
-- repeat the 030/036 deploy-order hazard on every firm surface at once. This
-- table is read only by its own fail-open function (findOrgBrandingFor in
-- server.js), so deploy order cannot take anything down — reads degrade to
-- "no firm brand", and only the new PUT/DELETE routes 503 until this runs.
--
-- Purely additive. Run before deploying the code that writes it.

create table if not exists org_branding (
  org_id uuid primary key references orgs(id) on delete cascade,
  firm_name text not null default '',
  preparer_name text not null default '',
  phone text not null default '',
  email text not null default '',
  license_number text not null default '',
  disclaimer text not null default '',
  logo_url text not null default '',
  updated_at timestamptz not null default now()
);

alter table org_branding enable row level security;
