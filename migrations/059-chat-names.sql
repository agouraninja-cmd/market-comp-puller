-- 059 — your own name for a chat, and deleting a deal room for yourself
-- (2026-10-02, the owner's pick of the "who am I messaging" drafts: Draft A
-- with Draft C's private names, https://claude.ai/artifact/3sk3nK5VLG43d73TxEuZJA)
-- Rules:  messaging.js (validateNickname, roomListed)
-- Writers: POST /api/messages/name (a name), POST /api/messages/delete with a
--          roomId (hiding a deal room for the caller)
--
-- ---------------------------------------------------------------------------
-- A NAME ONLY YOU SEE
-- ---------------------------------------------------------------------------
-- Chats have no shared names (owner's call, 2026-09-01): a name one person
-- types would sit on everybody else's screen. This is the other kind, a label
-- on YOUR copy, read only by the person who wrote it and never sent to anyone
-- else. NULL means no name, and the chat is called after its people as before.
-- The route trims it and refuses anything over 80 characters (MAX_TITLE).
--
--   msg_thread_members.nickname  a firm chat: the caller's own member row
--   hub_notify.nickname          a deal room: the caller's own row in the
--                                per-person table 040 made, keyed by email,
--                                which already covers the owner and the guests
--
-- ---------------------------------------------------------------------------
-- DELETE FOR ME, FOR A DEAL ROOM
-- ---------------------------------------------------------------------------
-- hub_notify.hidden_at: the caller took the room off their own list. It stays
-- off until somebody writes in it after this moment (roomListed), and nothing
-- else about the room changes for anybody: not the messages, not the comps,
-- not the other people's lists. The firm half of this already exists (the
-- caller's msg_thread_members.added_at, no migration, 2026-09-26).
--
-- ---------------------------------------------------------------------------
-- DEPLOY ORDER: HARD. Run this BEFORE the code merges.
-- ---------------------------------------------------------------------------
-- GET /api/messages names msg_thread_members.nickname in the caller's own
-- membership read, and PostgREST 400s on an unknown column (CLAUDE.md rule 9),
-- so an unrun 059 turns the whole Messages list into "Couldn't load your
-- messages". Purely additive and idempotent.

alter table msg_thread_members add column if not exists nickname text;

alter table hub_notify add column if not exists nickname text;
alter table hub_notify add column if not exists hidden_at timestamptz;
