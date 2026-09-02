# Market ranking: public data, class data, and the client's own read

**Date:** 2026-09-01
**Status:** **DRAFT — bones only.** Two committed config files and their
enforcing test ship with this. No scoring code, no FRED integration, no route,
no migration. Nothing reads either file yet, so merging it changes nothing that
runs.

**Supersedes** the bounded-adjustment model sketched earlier in the same work:
the narrative is a **weighted third component**, not a capped post-hoc nudge.
That was the owner's correction on 2026-09-01 and it is the better model —
easier to explain, easier to tune, and a firm that wants public data only sets
the narrative weight to zero.

---

## The model in one line

```
score = Wm × macro  +  Wc × class-specific  +  Wn × narrative
```

Every market scores −1 (contracting) to +1 (expanding) per asset class.
`Wm + Wc + Wn = 1.00`, and the three weights differ **by asset class**.

Three words out the other end — `contracting` / `flat` / `expanding` — which is
the vocabulary `market-snapshot.js` already speaks and the Explorer badge
already renders in three colours.

---

## Why this shape, and what it replaces

Today the market's momentum is a word the model asserts. `market-snapshot.js`
reads `price_discovery.direction` out of the LLM's search response; the prompt
pins it to three values; the file's own comment records that it fills "roughly
5 searches in 6," and `freshDirection()` expires it at 90 days.

Nothing is wrong with that code. The problem is that **an analyst cannot audit
it** — there is no series behind the word and no way to ask why it changed. The
page it renders on is otherwise built from measurements with their inputs on
display.

This replaces the assertion with three auditable parts, two of them public.

---

## 1. Macro (area 1)

Public government data at CBSA level, identical for every client. Weights in
`market-weights.json` under `macro`, summing to 1.

| Metric | Weight | Source |
|---|---|---|
| Job growth, total nonfarm YoY | 0.30 | BLS CES via FRED |
| Population growth YoY | 0.25 | Census PEP |
| Net domestic migration | 0.15 | Census PEP components |
| House price index change YoY | 0.15 | FHFA HPI |
| Real personal income per capita | 0.10 | BEA |
| Unemployment rate, level and direction | 0.05 | BLS LAUS via FRED |

Unemployment carries the least weight deliberately: it is a lagging confirmer.
Job growth and migration lead.

**On "median house price".** No free government source publishes a metro-level
median house *price*. Census publishes median new-home price nationally and by
region only; NAR's metro medians are a trade association's licensed product. So
this uses **FHFA's House Price Index** — government, metro, quarterly, free —
which measures change rather than a dollar level. If a dollar level is needed,
Zillow's ZHVI is free and metro-level but is a private company's series under
its own terms, and that is a product decision rather than a data one.

---

## 2. Class-specific (area 2)

Also public, also identical for everyone — but a different basket per asset
class, because CRE fundamentals are not public while their demand drivers are.
Weights under `class_specific`, each block summing to 1.

- **Industrial** — trade/transport employment, warehousing (NAICS 493),
  manufacturing, industrial permit valuation, port or air-freight volume.
- **Office** — professional and business services, information, financial
  activities, educational attainment.
- **Retail** — household count, median household income, retail trade
  employment, leisure and hospitality.
- **Multifamily** — 5+ unit permits, household formation, renter share and
  gross rent, net migration.
- **Land** — total permits, permit valuation, population, units authorised per
  1,000 residents.
- **Residential** — house price index, single-family permits, net migration,
  income growth.

---

## 3. Narrative (area 3) — the client's own read

**This is the product.** Areas 1 and 2 are the same numbers every competitor
can pull. Area 3 is the firm's accumulated judgment about a market, and it is
private to them.

The framing that settles storage, permissions and positioning at once: **the
context vault is to market knowledge what the comp vault is to transaction
data.** Private by default, compounds over time, shared inside the firm and
nowhere else, and it makes their analysis better than a stranger's running
identical public numbers.

Two levels per asset class, both written by the client:

1. **Trend over time** — lean, confidence, and prose. What has been happening
   here for the last few years, and why.
2. **Current snapshot** — sentiment, deal availability, and prose. Are people
   optimistic? Are deals hard to find?

Plus the two views a professional actually reads a market through:

- **Acquisition** — cap-rate pressure and why. Cap rates appear in no public
  dataset at any price; this and the corpus are the only sources.
- **Development** — entitlement friction and municipal posture. Permit
  *counts* are public (Census BPS); permit *difficulty* is not, and this is the
  only place it can live.

### Schema (draft, not written as a migration)

```sql
create table if not exists market_context (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  market       text not null,
  asset_class  text not null check (asset_class in
                 ('industrial','office','retail','multifamily','land','residential')),

  trend_lean         text check (trend_lean in ('expanding','flat','contracting')),
  trend_confidence   text check (trend_confidence in ('high','med','low')),
  trend_narrative    text,

  sentiment          text check (sentiment in ('optimistic','neutral','pessimistic')),
  deal_availability  text check (deal_availability in ('abundant','normal','scarce')),
  snapshot_narrative text,

  acq_cap_pressure text check (acq_cap_pressure in ('compressing','stable','expanding')),
  acq_narrative    text,
  dev_friction     text check (dev_friction in ('low','medium','high')),
  dev_narrative    text,

  score      numeric not null default 0,   -- -1..+1, the narrative's own reading
  rationale  text,

  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz,

  unique (org_id, market, asset_class)
);
alter table market_context enable row level security;
```

Org-scoped, not committed files — this is private business data and needs the
wall `broker_comps` already has. A firm must never be one `git log` away from a
competitor's read on Ontario.

### Three rules

1. **No score without a written reason.** Non-zero `score` requires
   `rationale`. Enforceable in a test. An unexplained thumb on the scale is
   indistinguishable from a mistake a year later, including to its author.
2. **It expires.** Default 180 days. Past `expires_at` the narrative
   contributes zero and renders greyed with its date. `freshDirection()` takes
   this position at 90 days because "expanding is a claim about RIGHT NOW"; a
   read on deal availability ages the same way, slower.
3. **Absence is never a penalty.** No row means the public score alone, with
   `Wm` and `Wc` re-normalised to sum to 1. A market nobody has written about
   must not rank below one somebody disliked.

---

## What the client sees

Three numbers, always: **public → your read → your ranking.** Plus the weights
in force and the market's tier.

The public score stays visible underneath, and that is the load-bearing
property of the whole design. A ranking a firm cannot defend to a capital
partner is worth nothing, and "here is the public data, here is our read, here
is the difference" is exactly the defence. The moment the adjustment is
invisible, the number becomes an opinion wearing arithmetic.

Tier belongs on screen too. A tertiary market's public score is a **weaker
claim** than a primary market's — BLS suppresses small-cell employment, ACS
5-year estimates carry wide margins — so the same score means less. That
asymmetry is also why narrative weight earns more of its keep in small markets.

---

## Monthly refresh of the public layer

The sources do not share a cadence, so the job runs monthly and takes what is
new: employment and permits nearly every run, house prices one in three,
population and BEA one in twelve.

A scheduled workflow following `market-heroes.yml`'s pattern (needs secrets,
runs on cron) rather than `ci.yml`'s (deliberately holds none).

```
.github/workflows/macro-refresh.yml   # cron, monthly
scripts/refresh-macro.js              # the pull
scripts/resolve-fred-series.js        # run once per new market, read by a human
```

**Four rules, each earned from a known failure mode:**

1. **Append, never update.** Rows keyed on `(cbsa_code, series_kind, as_of)` —
   the *observation* date, not the fetch date. FRED revises published figures
   months later, and a revision must arrive as a new row so the history of what
   was known when survives. A ranking that silently changes for a past month is
   one nobody can reproduce.
2. **Never resolve a series at runtime.** IDs come from the committed map a
   person read. See the next section — this is the dangerous one.
3. **A stale market is an alarm, not a gap.** If a tracked market's employment
   has not moved in two publication cycles, the job fails.
   `market-freshness.yml` already makes this argument: a failed scheduled
   workflow reaches somebody, a passing one that printed a warning does not.
4. **Partial success is success.** One market 404ing must not abandon the other
   174. Write what resolved, report what did not.

---

## The failure this design is most afraid of

**A wrong CBSA code does not error.** FRED answers it with real, well-formed
employment for whichever city actually owns that code. Every downstream number
is confidently wrong, no exception is thrown, and no test of the arithmetic can
detect it.

So all 175 codes in `market-tiers.json` ship with `verified: false`, and
`test/market-ranking-config.test.js` fails if any is flipped true — because the
resolver that is supposed to flip them does not exist yet. Nothing may pull
data for a market whose code a script has not confirmed against the Census
delineation files.

---

## The geography caveat, which does not go away

Client markets are submarkets. Government data is CBSA. "Ontario, CA" is an
industrial submarket; the only employment series covering it spans two counties
and roughly 4.6M people.

`METRO_GROUPS` in `market.js` is **not** a bridge to CBSAs and must not be made
into one — its own header rule is adjacent suburbs sharing one CRE submarket,
*never* a whole statistical area, and a Phoenix group was cut on review for
exactly that.

The defence is labeling: the economic panel names its CBSA in full, always. It
is a labeling defence, which a hurried reader can still defeat. It is also a
large part of why area 3 exists — a firm's read on the warehouse corridor is
the only thing in the system that knows the corridor is not the MSA.

---

## What ships in this branch

- `market-tiers.json` — 175 markets (25 / 50 / 100), CBSA name and code, all
  unverified, seeded flag for the 16 already in `market-seed.json`.
- `market-weights.json` — the three weights per asset class, the macro
  sub-weights, and the class sub-weights. Every block sums to 1.
- `test/market-ranking-config.test.js` — ten tests holding those invariants,
  in the spirit of `test/migrations.test.js`: a weight block summing to 0.97
  would quietly scale every score it touches by 3%, and nothing would raise.

Both files are committed rather than stored in a table because **weights are a
methodology**. A change to them should arrive as a pull request somebody reads,
not a form somebody edits at 2am. `market-seed.json` already makes this
argument for itself.

The workbook the weights were derived in stays local: `.gitignore` excludes
`CompNinja*.xlsx` as owner planning material, not app code.

---

## Slices

1. **This branch.** Config and its tests. Nothing reads them.
2. **Measured RE direction from the corpus**, shown beside the model's asserted
   word rather than replacing it. Needs typed corpus columns; no API key, no
   outbound dependency, no new table.
3. **Retire the asserted direction** once the two agree often enough.
4. **FRED integration**, read-only, no UI: resolver script, verified codes,
   `macro_readings`, monthly refresh.
5. **The public score** — areas 1 and 2 computed and rendered, tier shown.
6. **`market_context`** and the client's own read.
7. **Per-firm weights**, which are a copy of `market-weights.json` scoped to an
   org.

---

## Open questions

1. **Are the weights right?** Almost certainly not yet — they are a starting
   point and expected to move. Land at `Wn = 0.45` and residential at `0.20`
   are the two most arguable.
2. **Per-view narrative score, or one per asset class?** A market can be
   hostile to development and excellent for acquisition. Per-view is more
   precise and twice the writing.
3. **Can a firm share its narrative outward** — with a client, in a report?
   Same permission question the comp vault answers with `share_scope`, and the
   answer should probably match.
4. **Who inside a firm may write it?** Any seat, or an analyst role? The
   narrative moves every number the firm produces.
5. **Does CompNinja publish a house view** as a starting default, or ship only
   the public layers and the client's own? A house view is a product surface
   with an editorial cost and an opinion to defend.
