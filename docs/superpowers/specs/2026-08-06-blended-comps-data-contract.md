# Blended comps — the data contract

**Date:** 2026-08-06
**Status:** PROPOSAL — needs ten minutes of agreement between Owen and Jacob before either half is built.
**Owner of the server half:** Owen · **Owner of the display half:** Jacob

This is the "agree what the blended-comps data looks like" step. It exists so
Jacob can build against a stand-in of the right shape while Owen builds the
real thing, and neither waits on the other.

---

## The feature in one line

A broker uploads private comps into their vault. Those comps should appear
inside **that broker's own valuation reports**, alongside the public ones,
clearly marked as theirs — and nowhere else, ever.

---

## 1. The shape

Private comps arrive as **ordinary comp objects in `report.comps`**, carrying
one extra field:

```jsonc
{
  "address": "1450 Mission Ave",
  "date": "2026-03-14",
  "transaction": "sale",
  "price": 4250000,
  "size_sqft": 31000,
  "price_per_sqft": 137,
  "source_type": "verified",
  "notes": "…",

  "private": true          // <- the only new field
}
```

Every other key is exactly what a public comp already carries, including the
per-type spec fields (`clear_height`, `units`, `lot_acres`, …). `broker_comps`
was deliberately given the same column names as `comp_corpus`, so no
translation layer is needed.

The report also gains one top-level counter, beside the existing
`locked_count`:

```jsonc
{ "private_count": 3 }
```

### Why one array and not two

The alternative — a separate `report.private_comps` array — was considered and
rejected. The front end loops over `report.comps` in the table, the map, the
chart, the stat tiles, curation, and both exporters. A second array doubles
every one of those loops, and each one is a place to forget it. One array with
a flag means Jacob's existing rendering works unchanged and he adds styling,
not plumbing.

It also means private comps flow into the valuation math for free:
`valuationComps()` already reads `includedComps()`, so the broker's own deals
move the hero's number, which is the point of the feature.

---

## 2. The rule that makes it safe

**Blending happens at serialization time only.** This is not a detail — it is
the whole design, and it mirrors the rule `comp-gate.js` already follows:

> `gateReport()` is applied at serialization time only — the cache,
> `harvestComps()`, and `maybePublishMarketSnapshot()` keep seeing **whole**
> reports.

Blending is that rule's mirror image. The cache, the harvest and the snapshot
keep seeing **public** reports; private comps are added to the response and
nowhere upstream of it.

```
search → parse → harvestComps()          ← public report only
              → cache write              ← public report only
              → maybePublishMarketSnapshot()  ← public report only
              → gateReport()
              → blendPrivateComps()      ← private comps enter HERE
              → response
```

Get this order wrong in either direction and the wall fails silently:

- Blend **before** the cache write, and one broker's private comps are served
  to the next visitor who searches that address — the cache is keyed by
  property, not by user.
- Blend **before** `harvestComps()`, and private comps enter the public corpus
  permanently. The corpus write path swallows its own errors by design, so
  nothing would alert anyone. That exact blindness already hid a total corpus
  outage for weeks.

---

## 3. The five exits, and what each must do

| Exit | Behaviour | Owner |
|---|---|---|
| `/api/comps` response | private comps present, flagged | Owen |
| `search_cache` | never — cache stores the public report | Owen |
| `comp_corpus` (`harvestComps`) | never | Owen |
| Market snapshots | never | Owen |
| `POST /api/share` | **must strip `private: true` server-side** | Owen |
| CSV / PNG / print exports | must exclude | Jacob |

### `/api/share` is the non-obvious one

`/api/share` accepts `{ data, meta }` **from the browser**. The browser is
holding a blended report, so a naive share publishes the broker's private book
of business at a public URL.

The server must therefore strip `private: true` comps from the payload on the
way in — the same way it already strips `meta.subject.noi` and the debt/rent-
roll assumptions. **Do not rely on the client to send a clean report.** A
shared report is public by design and has no viewer check to fall back on.

### The cache key must NOT change

`cacheKeyFor()` stays as it is. Adding the user or their vault contents to the
key would give every broker their own cache entry, multiplying billed searches
by the number of brokers and defeating the cache for the exact users who search
most. The cached artefact is the public report; the blend is applied after the
read.

---

## 4. What Jacob can build against today

A stand-in that needs no server work — take any report and append:

```js
report.comps.push({
  address: "1450 Mission Ave", date: "2026-03-14", transaction: "sale",
  price: 4250000, size_sqft: 31000, price_per_sqft: 137,
  source_type: "verified", private: true
});
report.private_count = 1;
```

That is the whole contract. If the display half works against this, it works
against the real thing.

### Open questions for the ten minutes

1. **Badge wording.** "Your comp"? "From your vault"? It must not read as a
   provenance claim like the Verified badge — it is an ownership statement.
2. **Does a private comp outrank a public one in the table's default sort?**
   Proposal: no. Sort stays as-is; the flag is styling, not ranking.
3. **What if a private comp duplicates a public one at the same address?**
   Proposal: show both, flag the private one. Silently dropping either is a
   broker seeing their own deal vanish, which reads as data loss.
4. **Empty state.** A broker with an empty vault gets `private_count: 0` and no
   change to the report. Confirm that is what the first-five-minutes work
   expects.

---

## 5. Test obligations

The server half is not done until `npm test` covers, at minimum:

- A blended report's `comps` contains the private rows; the report handed to
  `harvestComps()` does not.
- The object written to `search_cache` contains no `private: true` comp.
- `/api/share` strips private comps from a payload that contains them.
- A second user searching the same address gets no trace of the first user's
  vault.
- `private_count` is 0 and the report is byte-identical to today's when the
  vault is empty.

The last one matters most: **the feature must be invisible to every
non-broker.**
