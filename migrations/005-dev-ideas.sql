-- 005 · Development hub ideas list (/dev, 2026-07-29). Whole-list replaced
-- via PUT /api/dev-ideas.

create table if not exists dev_ideas (
  id text primary key,
  text text not null,
  status text not null default 'open',
  priority text,
  notes text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tables created before priority/notes/done_at existed need:
alter table dev_ideas
  add column if not exists priority text,
  add column if not exists notes text,
  add column if not exists done_at timestamptz;
