-- 009 · Subject-size memo (2026-07-31; run + verified in prod 2026-08-01).
-- A building's size doesn't change, so once any prior search has looked it up
-- the answer is reused and the search budget drops. Only public_record /
-- listing sources are remembered — model ESTIMATES are never persisted.

create table subject_sizes (
  address_norm text primary key,
  size_sqft    bigint not null,
  source       text,
  updated_at   timestamptz not null default now()
);
