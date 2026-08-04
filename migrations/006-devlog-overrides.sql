-- 006 · Devlog overrides — click-to-edit overlay for /dev's changelog.
-- devlog.json stays the repo-committed source of truth; UI edits and notes
-- live here, keyed by the FILE entry's original date+title, merged at read
-- time. Deleting a row restores the committed text.

create table if not exists devlog_overrides (
  key text primary key,
  title text,
  details text,
  notes text,
  updated_at timestamptz not null default now()
);
