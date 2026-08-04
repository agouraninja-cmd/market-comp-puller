-- 007 · Contacts — the internal rolodex behind /contacts. ADMIN_KEY-gated;
-- PII lives here, so the file fallback (contacts.json) is git-ignored.

create table if not exists contacts (
  id text primary key,
  name text not null,
  company text,
  role text,
  phone text,
  email text,
  market text,
  category text not null default 'lead',
  status text not null default 'new',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
