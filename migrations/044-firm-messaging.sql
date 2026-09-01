-- 044 — firm messaging: threads, messages, and the comps sent between them
--
-- Spec: docs/superpowers/specs/2026-09-01-firm-messaging-design.md
--
-- WHY. Colleagues at one firm already share a shelf (shared_reports with
-- visibility='org'), a vault opt-in (org_comps), a contact list (org_contacts)
-- and a letterhead (org_branding). They have nowhere to TALK. So the comp one
-- broker sends another goes out by text message and leaves no trace in the
-- firm's records — which is precisely the knowledge this product exists to
-- keep. These tables are where that conversation lives, and where the comps
-- inside it stay.
--
-- NOT the comp hub (024). That is broker↔client, gated on a hashed
-- per-participant token, pointed outward at one deal. This is
-- colleague↔colleague, gated on firm membership, and it is the whole firm's
-- correspondence rather than one deal's. Four things in this repo are called
-- "hub"; this one is called Messages everywhere a person can read it.
--
-- SEPARATE TABLES, read by their own functions — 013's rule (the vault privacy
-- wall) for the fifth time, after 030, 032, 039 and 043. Nothing in here is
-- ever read by harvestComps, corpusRowsForMarket, vaultCompsForReport,
-- orgCompsForReport, a market snapshot or a share. comp_corpus is the standing
-- cautionary tale for the alternative: once one table holds two kinds of row,
-- every aggregate over it has to remember to exclude the other kind, and the
-- ones that forget fail silently.
--
-- DEPLOY ORDER: MIGRATE FIRST. This is 030's hazard, not 043's soft one. Every
-- read below names its columns in a PostgREST `select=`, and PostgREST 400s an
-- unknown column, so deploying first makes /messages answer 503 for everybody
-- rather than degrading. Nothing ELSE breaks — no existing route reads these
-- tables — so a slip costs the new feature and never the site.

-- ---------------------------------------------------------------------------
-- msg_threads — one conversation, inside one firm.
-- ---------------------------------------------------------------------------
create table if not exists msg_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- 'dm' is exactly two people and has no title (the page renders the other
  -- person's name). 'channel' has a title and any number of members.
  kind text not null default 'dm' check (kind in ('dm', 'channel')),
  title text not null default '',

  -- The canonical sorted pair of user ids for a DM, so two colleagues cannot
  -- end up with two separate DM threads by both starting one. Null on a
  -- channel, which is why the unique index below is PARTIAL.
  --
  -- Postgres compares NULLs as DISTINCT, so a plain unique (org_id, dm_key)
  -- would let every channel through and still be correct — but it would also
  -- index a column that is null on most rows for nothing. The partial index is
  -- the same decision comp_corpus and broker_comps made with dedupe_key.
  dm_key text,

  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Denormalized so the thread LIST is one ordered read rather than a read
  -- plus a per-thread max(created_at). Written by the send route beside the
  -- message insert; a failed touch costs the list's ordering for one message,
  -- never the message.
  last_message_at timestamptz not null default now()
);

-- The list read: my firm's threads, newest activity first.
create index if not exists msg_threads_org_idx
  on msg_threads (org_id, last_message_at desc);

-- The DM identity. PARTIAL, so it covers no channel — and therefore
-- deliberately NOT usable with PostgREST `on_conflict`, which cannot infer a
-- partial index (42P10, the bug that once made every hub vault send fail).
-- server.js reads-then-inserts and catches the 23505 race instead.
create unique index if not exists msg_threads_dm_uidx
  on msg_threads (org_id, dm_key)
  where dm_key is not null;

-- ---------------------------------------------------------------------------
-- msg_thread_members — who is in a thread, and how far they have read.
-- ---------------------------------------------------------------------------
create table if not exists msg_thread_members (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references msg_threads(id) on delete cascade,

  -- Keyed on the USER, not the email — the deliberate departure from 018's
  -- identity rule that org_members and hub_participants both follow. Those two
  -- have to name somebody who may not have an account yet (an invitation is
  -- addressed to an address). A thread member is always an accepted member of
  -- the firm, which means the account already exists, and a user id is what
  -- makes dm_key stable when somebody changes the case of their email.
  --
  -- The email rides along anyway, denormalized at write time, so the list can
  -- render a name without a second query on every poll.
  user_id uuid not null references users(id) on delete cascade,
  email text not null,

  added_at timestamptz not null default now(),

  -- Null means "has never opened it", which reads as everything unread. That
  -- is the honest answer for somebody just added to a channel with history.
  last_read_at timestamptz,

  -- Leaving is soft, like org_members.removed_at: the messages a person wrote
  -- stay, and their name stays renderable beside them.
  left_at timestamptz,

  unique (thread_id, user_id)
);

create index if not exists msg_thread_members_user_idx
  on msg_thread_members (user_id)
  where left_at is null;

-- ---------------------------------------------------------------------------
-- msg_messages — one message.
-- ---------------------------------------------------------------------------
create table if not exists msg_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references msg_threads(id) on delete cascade,

  -- DENORMALIZED ON PURPOSE, and it is a wall rather than a convenience. A
  -- thread id always arrives from the browser and proves nothing; the
  -- membership check is what authorizes a read. Carrying the firm here means
  -- every query can ALSO say org_id=eq.<the caller's own firm>, so a bug in
  -- the membership check is not a cross-firm leak. Two independent walls,
  -- canReadShare's rule: require both, fail toward less access.
  org_id uuid not null references orgs(id) on delete cascade,

  -- The author is always resolved from the session, never from the body.
  -- Nullable for the same reason hub_messages.author_user_id is: a deleted
  -- account must not take the correspondence with it.
  user_id uuid references users(id) on delete set null,
  author_email text not null,

  -- NULLABLE, because a message may be comps and nothing else — "here, look at
  -- these" is a real message. messaging.js refuses one that is empty of both.
  body text,

  -- Denormalized count so the list preview can say "3 comps" without joining.
  comp_count integer not null default 0,

  created_at timestamptz not null default now(),

  -- Neither is written by anything today. They are here so that editing and
  -- deleting a message, when they land, need no migration — the same reason
  -- hub_items.status and orgs.share_default shipped as unwritten columns.
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists msg_messages_thread_idx
  on msg_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- msg_comps — THE SAVED COMP. The point of the whole feature.
-- ---------------------------------------------------------------------------
create table if not exists msg_comps (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references msg_messages(id) on delete cascade,
  thread_id uuid not null references msg_threads(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,

  shared_by uuid references users(id) on delete set null,
  shared_by_name text not null default '',

  source text not null default 'vault' check (source in ('vault', 'manual')),

  -- The broker_comps row this was copied from, and DELIBERATELY NOT A FOREIGN
  -- KEY.
  --
  -- This is the one decision in the file worth reading twice. org_comps (032)
  -- references broker_comps ON DELETE CASCADE, and that is right for what it
  -- is: a LIVE COPY of a row in a broker's book, which must track the original
  -- and vanish when it does. A message is not that. A message is a RECORD OF
  -- WHAT WAS SAID, and rewriting it later — or deleting it out from under the
  -- colleague it was said to — would be rewriting history. hub_items made the
  -- identical call for the identical reason (024's header says so): a live
  -- join lets a later vault edit silently change what somebody read last week.
  --
  -- So this is a bare uuid. It is used to offer the sender's own copy and for
  -- nothing else, and it is allowed to point at a row that no longer exists.
  source_comp_id uuid,

  -- Lifted out of the snapshot so the Comps tab can list, order and filter
  -- without parsing jsonb, and so a malformed snapshot renders as a row with
  -- an address rather than as a blank one.
  address text not null default '',
  address_key text,
  property_type text,
  deal_date date,

  -- VAULTAPI.toApiComp(row) — the vault's own API contract, which is already
  -- an allowlist, already schema-tested in both directions, and already what
  -- hub_items sends to a CLIENT. A colleague is a narrower audience than that,
  -- so a second list here would be a second thing to keep in step for no gain.
  -- jsonb rather than columns for 030's reason: a new per-type comp field
  -- needs no migration in this table.
  snapshot jsonb not null,

  created_at timestamptz not null default now()
);

create index if not exists msg_comps_thread_idx
  on msg_comps (thread_id, created_at desc);
create index if not exists msg_comps_message_idx
  on msg_comps (message_id);

-- ---------------------------------------------------------------------------
-- msg_comp_saves — who has already put a shared comp into their own vault.
--
-- Small, and it earns its place: without it the Save button is a control that
-- silently makes a second copy every time somebody presses it twice, and can
-- never say "already in your vault". The vault's own dedupe_key would refuse
-- the duplicate, but a refusal is not the same as an answer.
-- ---------------------------------------------------------------------------
create table if not exists msg_comp_saves (
  id uuid primary key default gen_random_uuid(),
  msg_comp_id uuid not null references msg_comps(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,

  -- The broker_comps row that was created. Bare uuid, same reasoning as
  -- source_comp_id above: the receipt outlives the row it points at, and
  -- somebody deleting the comp they saved must not delete the record that they
  -- once saved it.
  vault_comp_id uuid,

  saved_at timestamptz not null default now(),
  unique (msg_comp_id, user_id)
);

-- Every other table in this schema has RLS on and is reached only through the
-- service key; these are no different.
alter table msg_threads        enable row level security;
alter table msg_thread_members enable row level security;
alter table msg_messages       enable row level security;
alter table msg_comps          enable row level security;
alter table msg_comp_saves     enable row level security;
