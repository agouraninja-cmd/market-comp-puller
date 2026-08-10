# A thin-market Explorer preview stops spending the free search

Approved by the owner 2026-08-09.

## Problem

`POST /api/explore-market` consumes an anonymous visitor's one free search
whenever it answers 200:

```js
if (status === 200) consumeGuestSearchFor(guestGate, req, res, Boolean(sse));
```

Two different outcomes return 200. A market meeting the quality bar
(`pricedSaleCount >= MIN_PRICED_SALE_COMPS`, i.e. 3) publishes a permanent
`/market/<slug>` page. A thinner one gets `/market-preview/<slug>`, which
lives only in `previewPagesMem` behind a 30-minute TTL and dies on every
process restart. Render redeploys several times on a busy day, so that TTL
is frequently more like seconds.

So the visitor spends their single allowance and receives a link that is
often dead before they can use it. The route already refuses to charge for
every other empty-handed outcome — the 422 no-snapshot market, the 429
daily cap, an upstream failure — and the comment above the consume line
says exactly that. The preview slips past the rule only because it carries
a URL and therefore a 200.

## What ships

One condition, plus one analytics event.

```js
if (status === 200 && out.published === true) {
  consumeGuestSearchFor(guestGate, req, res, Boolean(sse));
}
```

Only a genuinely new, permanently published market page spends the free
search. The thin preview joins 422/429/upstream in costing the visitor
nothing.

The covered-market short circuit is unaffected: it returns
`{ published: true, existing: true }` from *above* the guest gate and never
reaches this line, so serving an existing page stays free for everyone
including crawlers, exactly as today.

## Impact today: latent, and that is the honest framing

**No visitor can currently reach this bug in production.** `ACCOUNT_WALL`
has been on since 2026-08-05, and the wall forces `GUEST_SEARCH_LIMIT` to
0; `guestGateFor` then returns `blocked: true` for every anonymous visitor
(server.js, the `GUEST_SEARCH_LIMIT === 0` branch), so the search never
runs. A signed-in visitor resolves `guestGate` to null, which makes
`consumeGuestSearchFor` a no-op. The consume line is therefore unreachable
under the live configuration.

It becomes reachable the moment `ACCOUNT_WALL=off` is used — the documented
instant-rollback lever — or if the wall is ever retired in favour of the
guest cap. This ships so that pulling that lever does not also re-arm a
known defect, not because anyone is being harmed today.

The `explore_preview` event below is the part with immediate value: it
works regardless of the wall.

## Why this is safe on spend

It widens a hole that already exists rather than opening a new one. The 422
path has always billed an Anthropic search without consuming the allowance,
so an anonymous visitor could already trigger repeated billed thin searches.
Three bounds are unchanged:

- the `explore:` per-IP limiter, 3 per 15 minutes;
- the `exploreCheck:` limiter and the city check (2026-08-09), which refuse
  junk cities *before* the billed leg;
- `DAILY_SEARCH_CAP`, the global ceiling on billed searches per UTC day.

## It becomes self-healing

With the allowance intact, a visitor whose preview expired can explore that
market again. The re-run is a `search_cache` hit for the cache's 30-day TTL,
so it costs nothing upstream and regenerates the preview immediately. That
is why this change alone resolves the dead-link complaint without
persisting previews: an ephemeral artifact is fine when regenerating it is
free and unlimited.

## Analytics

A PII-free `explore_preview` event (`prop_type`, `market: "City, ST"`,
`source: "explore"`, `cached`) is logged when a preview is served, fitting
the fixed analytics columns. `cached` is the fourth dimension, and it is
not optional: without it a free cache-hit regeneration (which this design
deliberately makes common — see "It becomes self-healing" above) is
indistinguishable from a fresh billed thin search, so the spend-sink
question this event exists to answer could not be answered. `explore_reject`
is not the right template for this field, because it fires before billing
is even attempted, where `cached` would be meaningless.

It exists because this change makes previews free to guests, so the
thin-market rate becomes the number worth watching: it says whether
previews are turning into a spend sink, and whether the 3-priced-sale bar
is set in the right place. Today nothing in `analytics_events`
distinguishes a published explore from a thin one — both log the same
`search` row with `source: "explore"`.

## What deliberately does not change

- **No copy change.** The preview page's "Limited data preview" banner
  already states that the figures are indicative and "this page expires
  shortly", so the visitor is told what they have.
- **Previews stay in memory.** Persisting thin snapshots was considered and
  rejected for now: it needs a migration and an unpublished flag on
  `market_pages`, plus care to keep those rows out of `/markets` and
  `sitemap.xml`. Free regeneration makes it unnecessary.
- **The publish bar stays at 3** (`MIN_PRICED_SALE_COMPS`). The new event
  is what would justify moving it later.
- **The guest gate, the city check, both limiters, and the SSE/JSON split
  are untouched.**

## Testing

The consume condition lives inline in `server.js`, so `npm test` cannot
reach it without a booted server and a billed search. Verification uses the
repo's zero-cost fetch-shim harness pattern (from the corpus-first work):
boot the server with a shimmed global `fetch` that returns a canned
Anthropic report, drive one explore, and assert both directions.

- Canned report with fewer than 3 priced sales: the response carries
  `published: false`, and a second explore from the same visitor is still
  allowed (the allowance was not spent).
- Canned report with 3 or more priced sales: the response carries
  `published: true`, and a second explore is refused with
  `signin_required` (the allowance was spent).

The second case is the one that keeps the fix honest: it proves the gate
still works rather than that it was disabled.

Because the wall forces the limit to 0, the harness must boot with
`ACCOUNT_WALL=off` and `GUEST_SEARCH_LIMIT=1` — the configuration under
which this code path is reachable at all, and the one the rollback lever
restores.

## Files

- `server.js`: the consume condition and the `explore_preview` event.
- `devlog.json`: entry in the same commit.
