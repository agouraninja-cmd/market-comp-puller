-- 063: a deal room guest's name (2026-11-17)
--
-- Why: a guest invited to a deal room by address, with no account, was named
-- everywhere by the start of that address ("jordan"): nothing else about
-- them was stored. This is the name the BROKER types for them, when inviting
-- or later from the People panel in Messages. A guest's own account name,
-- once they have one, still comes first.
--
--   name   What the broker calls this guest. NULL is "not given": the page
--          falls back to the account's name, then to the start of the
--          address. Written only by the room's owner (PUT
--          /api/hub/participants, POST /api/hubs), at most 80 characters,
--          one line (messaging.js validateNickname).
--
-- Deploy order: SOFT, in both directions. server.js probes for the column
-- (hubNamesReady) and names it in no read or write until it has seen it, so
-- code deployed first keeps every deal room working and offers no names;
-- old code ignores the column. Purely additive and idempotent.

alter table public.hub_participants add column if not exists name text;
