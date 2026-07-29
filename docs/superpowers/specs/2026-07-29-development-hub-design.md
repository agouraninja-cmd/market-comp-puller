# Development Hub — design spec

**Date:** 2026-07-29
**Status:** Approved (design settled with the owner in conversation; entry source,
page location, ideas storage, and gating all confirmed).

## What we're building

A **Development Hub** at `GET /dev` — an internal, admin-key-gated page in the
style of `/admin` with two halves:

1. **Changelog timeline** — every shipped fix / improvement / feature grouped
   under the date it shipped, newest first, with a type badge per entry.
2. **Future Ideas** — an editable list (add, mark done, delete) managed on the
   page itself.

## Decisions (and rejected alternatives)

- **Changelog source = repo-committed `devlog.json`, maintained by Claude.**
  CLAUDE.md gains a standing rule: whenever a fix/improvement/feature ships,
  append a dated entry to `devlog.json` in the same commit. Versioned with the
  code, deploys with it, survives Render's ephemeral filesystem. *Rejected:*
  deriving from `git log` (commit subjects aren't a readable changelog and the
  deploy host may lack history); a manual entry form (relies on remembering).
- **Ideas storage = Supabase table `dev_ideas`** with a git-ignored
  `dev-ideas.json` whole-file fallback — the same durable-with-fallback pattern
  as every other store in this app. Whole-list replace on save (delete + insert),
  like the recipients-style lists elsewhere. *Rejected:* file-only (wiped on
  redeploy); keeping ideas in `devlog.json` (server can't durably write the repo
  file in production).
- **Access = `ADMIN_KEY`**, exactly like `/admin`: the page is a public
  noindexed shell that renders nothing until the key is entered; the key rides
  the `x-admin-key` header and is remembered in sessionStorage under the same
  `cn_admin_key` key, so unlocking `/admin` unlocks `/dev` and vice versa. With
  `ADMIN_KEY` unset the APIs 404, same as `/api/stats`.
- **Styling** = the Research Desk system (`/admin`'s inline CSS duplicated and
  trimmed, per the deliberate self-contained-pages rule — no tailwind.css
  dependency).

## Data shapes

`devlog.json` (repo root, committed; seeded by curating the git history):

```json
[
  { "date": "2026-07-28", "type": "feature", "title": "Report curation", "details": "..." }
]
```

`date` = `YYYY-MM-DD`, `type` = `fix | improvement | feature`, `details`
optional. File order doesn't matter — the page groups by date, newest first.

`dev_ideas` rows / `dev-ideas.json` array items:

```json
{ "id": "uuid", "text": "...", "status": "open", "created_at": "ISO-8601" }
```

`status` = `open | done`; done ideas render struck-through (kept as a record of
what got promoted). DDL lives in a comment above the dev-hub routes in
server.js:

```sql
create table if not exists dev_ideas (
  id text primary key,
  text text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
```

## Server changes (`server.js`)

- `GET /dev` — serves `renderDevHubHTML()` with the same triple-noindex
  treatment as `/admin` (meta tag, `X-Robots-Tag`, robots.txt `Disallow: /dev`).
- `GET /api/devlog` — `ADMIN_KEY`-gated (404 when unset, 401 on bad key). Reads
  `devlog.json` from disk per request → `{ entries }`; unreadable/corrupt file
  → `{ entries: [] }` plus a console warning, never a 500.
- `GET /api/dev-ideas` — gated; returns `{ ideas }` (Supabase first, file rows
  merged/fallback on DB failure — failure-safe like every other read).
- `PUT /api/dev-ideas` — gated; body `{ ideas: [...] }`, max 100 items, each
  `text` non-empty ≤ 500 chars, `status` coerced to open/done, server assigns
  missing `id`/`created_at`. Replaces the whole list (DB: delete-all + insert;
  file: overwrite). A DB failure falls back to the file and still returns 200 —
  same durability posture as `storeRow`.
- `/admin`'s header nav gains a "Dev log" link; `/dev` links back to Analytics
  and the app.

## CLAUDE.md changes

New "Development Hub" bullet in the routes list + the standing devlog rule
(same commit as the change it describes; routine docs-only/refactor commits
don't need entries). Restart-rule note: `devlog.json` is read per-request, but
`server.js` (the page + routes) still needs a restart. Deployment note: run the
`dev_ideas` DDL in Supabase before deploying.

## Testing

No test suite exists (per CLAUDE.md). Manual verification: run locally with
`ADMIN_KEY` set, confirm the gate, the seeded timeline, ideas add/toggle/delete
round-tripping into `dev-ideas.json`, 404 with `ADMIN_KEY` unset, 401 with a
wrong key.

## Out of scope

- Editing changelog entries from the page (hand-edit `devlog.json`).
- Auto-promoting a done idea into the changelog.
- Any change to public pages, search flow, or analytics events.
