-- 003 · Broker network (run 2026-07-19) — citation tracking on submissions
-- plus public broker profiles (GET /broker/<slug>).

alter table comp_submissions
  add column if not exists cited_count integer not null default 0;

create table broker_profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,          -- always stored lowercased
  display_name text not null default '',
  company text default '',
  slug text not null unique,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table broker_profiles enable row level security;
