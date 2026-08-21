-- 034 · A license number on the broker profile (2026-08-19)
--
-- The "Verified · via <firm>" badge is the strongest provenance a report
-- shows, and it is the entire currency the broker tier trades in: brokers who
-- publish a comp are paid in credit rather than cash. The badge's claim is
-- that a NAMED LICENSED BROKER vouched for this deal in public.
--
-- Nothing enforced the licensed half. Any account that reached the vault could
-- publish under any credit name it liked, which would make the badge say
-- something untrue -- including for the owner, who is not a licensed broker.
-- Decided 2026-08-12, built now because vault_beta is close and because
-- /api/vault/publish-many (2026-08-17) turned publishing from one comp behind
-- one dialog into a whole book behind one.
--
-- Deliberately ONE column, not a license/state pair. The point is a broker
-- putting a specific, checkable number against a public claim; which authority
-- issued it is not something this code can verify either way, and a second
-- required field is a second reason to abandon the form. State can be added
-- later as a pure addition if a real broker asks for it.
--
-- NOT NULL DEFAULT '' rather than nullable: every read of this column is
-- "is there a license here", and two flavours of absent (null and '') is how
-- that check grows a hole. Existing rows become '' and therefore cannot
-- publish until their owner fills it in, which is the intended effect and not
-- a regression -- there are no published vault comps to strand.
alter table broker_profiles
  add column if not exists license_number text not null default '';

comment on column broker_profiles.license_number is
  'Real estate license number. Non-empty is REQUIRED to publish a vault comp (server.js /api/vault/publish and /api/vault/publish-many). Never rendered publicly; it backs the Verified badge rather than appearing beside it.';
