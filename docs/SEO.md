# SEO — State & Resume Point

Written 2026-08-06, updated 2026-08-08. **Read this first when picking organic
acquisition back up.** The short version: the 38 market pages went from
invisible and unmeasurable to indexed, measured and correctly labeled, and the
homepage stopped being a redirect (item 1, shipped 2026-08-08). What is left is
one small copy change and — the one that actually matters — **checking whether
any of it worked**, which needs Search Console and no code.

---

## Why this matters more than it looks

Measured against the live database on 2026-08-06, CompNinja had **9 accounts,
4 of them `@example.com` test accounts**, zero subscriptions, zero report
purchases, and 4 leads (all July, all dummy addresses). Search volume was ~5/day
and essentially all internal.

The account wall (live 2026-08-05) turned away **2 anonymous visitors in 36
hours**. So the wall is not costing conversions — nobody is arriving to convert.
Acquisition is the constraint, and the market pages are the only machine
currently pointed at it.

**Caveat worth keeping in view:** SEO on auto-generated pages for a
three-week-old domain, against CoStar and Crexi, is a months-long play that may
never pay. The owner's broker relationships are the better lever. This file
covers the machine that is already built, not a claim that it is the priority.

## What shipped 2026-08-06 (PR #32)

### Titles were truncated, and the cut part was the useful part

All 38 market pages carried **68–82 character titles**; Google renders ~60. Every
one was cut off mid-phrase. The two longest pieces were the two doing the least
work — the date range spent ~22 characters on something nobody searches for, and
`| CompNinja` another 12 on a brand with no search demand yet.

```
before  Industrial Property Values in Salt Lake City, UT (Dec 2024 – Jul 2026) | CompNinja   (82ch)
after   Industrial Comps in Salt Lake City, UT | $/SF & Cap Rates                            (57ch)
```

Now 44–57 characters across all 38. `marketPageTitle()` in server.js drops the
whole `| $/SF & Cap Rates` clause rather than cutting mid-word if the Explorer
ever generates a longer city name. `marketTitle()` is untouched and still
supplies on-page headings and related-market link text.

Also fixed: `/how-it-works` (the front door under `ACCOUNT_WALL`) was titled for
people who already knew the brand, with a 199-character description;
`/brokers` and `/markets` descriptions were over the ~160 Google renders.

### Search Console verification

`GOOGLE_SITE_VERIFICATION` (see CLAUDE.md for the full contract). **HTML file
method, not the meta tag** — meta-tag verification fetches the property root,
and at the time `/` was a 302, so a tag there was never seen and verification
failed without saying why. Since 2026-08-08 `/` serves 200, so a meta tag
*would* work now — but keep the file: the property is already verified by it,
and Google unverifies a property whose token stops answering.

## Current state

| Item | State |
|------|-------|
| Search Console property | **Verified** 2026-08-06 — URL-prefix `https://compninja.co/`, HTML-file method, under okb336@gmail.com |
| `GOOGLE_SITE_VERIFICATION` | Set on Render. **Leave it set** — Google re-fetches the file and unverifies when it stops answering |
| Sitemap | Submitted 2026-08-06, **last read 2026-08-07**, Success, **42 pages discovered**. That read predates the 2026-08-08 change, so Google's copy still lists `/how-it-works` and omits `/` |
| Market pages | **Indexed** — `/market/industrial-dallas-tx` returned "URL is on Google". Re-crawl requested so the new title is picked up |
| `/how-it-works` | **Indexed** — "URL is on Google". Last crawl **2026-08-06 12:32 PM**, referring sitemap present, HTTPS valid, 1 valid breadcrumb item. (This corrects the 2026-08-06 note that it had never been crawled; the indexing request that day worked.) |
| `/` | **Indexed** — "URL is on Google". But last crawl is **2026-07-30 11:11 PM**, which predates both the wall (08-05) and the fix (08-08), so Google is holding pre-wall content and has seen neither. No referring sitemap. **Indexing requested 2026-08-09** — added to the priority crawl queue |
| Search performance | **2 total web search clicks**, 2026-08-05 to 08-06. Tiny, but not zero |
| Everything else audited | Fine — 650-word average, 63% unique between siblings, canonicals present, one h1 per page, `/markets` links all 39, robots.txt correct, mobile viewport present |

## What is left, ranked

### 1. ~~The homepage is a 302 and out of the sitemap~~ — SHIPPED 2026-08-08

**Done**, in commit `1803936`. `/` now renders the landing content with a
**200** for logged-out visitors instead of 302ing to `/how-it-works`, and is in
`sitemap.xml` unconditionally. The wall itself did not change: `GUEST_SEARCH_LIMIT`
is still forced to 0 and `/api/comps` still refuses an anonymous search. A
logged-out visitor sees what they always saw — the same content, one redirect
earlier, at the URL they actually arrived on.

The canonical strategy was the real substance, and it follows `ACCOUNT_WALL`
rather than the route that served the render:

| | Wall ON (today) | Wall OFF (rollback) |
|---|---|---|
| `/` | landing content, 200, **canonical** | the app |
| `/how-it-works` | same bytes, canonical → `/` | standalone page, self-canonical |
| Sitemap | `/` only | both |

Mechanically that is `renderHowItWorksHTML({ home })`: `/` passes `home: true`,
`/how-it-works` passes `home: ACCOUNT_WALL`. Two URLs serving identical bytes
are duplicates unless exactly one is named canonical, and `/` wins because the
root domain is the strongest URL a site has. `ACCOUNT_WALL=off` therefore stays
a *complete* no-deploy rollback — routing, canonical and sitemap all revert
together. `test/account-wall.test.js` pins both directions.

**`/how-it-works` deliberately did NOT become a 301.** A 301 is cached
near-permanently by browsers and by Google, making it the one part of this that
could not be walked back. The canonical carries the same consolidation signal
reversibly. Convert it once `/` is confirmed indexed — it is a one-liner.

Internal nav/footer links stay pointed at `/how-it-works` on purpose: with the
wall off `/` is the app, and a "How it works" link there would land on the
search form. `/how-it-works` is the stable URL for this content in both states;
`/` is the front door only while the wall is up.

**This is not finished until Google says so, and that check is item 3.** The
whole point was that Search Console had never crawled the redirect's target;
nothing proves the fix worked except `/` actually getting crawled and indexed.

### 2. Market page h1s still say the old wording (small, but visible copy)

Titles now say "Comps"; the headings still say:

```html
<h1>Industrial Property Values in Dallas, TX</h1>
```

Google weights the h1 alongside the title, and right now they disagree about
what the page is about. Aligning them is a small change to `marketTitle()`'s use
at the h1 site in `renderMarketPageHTML`. Deliberately **not** done unprompted:
it changes copy people see, and the plainer wording genuinely reads better as a
heading. A real tradeoff, not an oversight.

### 3. Checked 2026-08-09 — the answer is "not yet knowable", for a good reason

Measured in Search Console rather than assumed. What it showed:

- **Both `/` and `/how-it-works` are indexed.** Neither is missing. The
  2026-08-06 worry that the front door was invisible is resolved — and the
  note that `/how-it-works` had "never been crawled" is simply out of date.
- **`/` was last crawled 2026-07-30.** That is the number that matters.
  It predates the wall (08-05) *and* the fix (08-08), so **Google has never
  seen either one.** It is holding a ten-day-old copy of the pre-wall app
  page. Nothing is broken; Google just has not looked.
- **That timing was lucky.** Between 08-05 and 08-08, `/` was a 302. Had
  Google re-crawled inside that window it would very likely have dropped `/`
  and folded it into `/how-it-works`. The fix landed before that happened.
- **One thing to watch on the next crawl.** Google currently records `/`'s
  user-declared canonical as `/how-it-works` — the *opposite* of the intended
  direction. The live page has declared `/` since 08-08, so a re-crawl should
  correct it. If it does not, that is the first real sign the canonical
  strategy needs revisiting.
- **Page Indexing has no data** — still "Processing data, check again in a day
  or so", so the site-wide report could not be read at all.

**Done on 2026-08-09:** indexing requested for `/` (added to the priority
crawl queue). The sitemap was deliberately **not** resubmitted — the owner's
call; Google's copy is still the 08-07 read, so `/` has no referring sitemap
until it is. That is the obvious next lever if the re-crawl alone does not
move things.

**Re-check in a few days:** URL-inspect `/` again and confirm the last-crawl
date has moved past 2026-08-08 and the canonical reads `/`. Then read Page
Indexing across all 43 URLs, which should have populated by then.

Worth holding on to while reading it: the caveat at the top of this file. Zero
real users is an acquisition problem, and SEO on auto-generated pages for a
three-week-old domain may simply never pay. If Page Indexing comes back thin
after a fair wait, that is **information**, not a prompt for more SEO work —
the broker relationships are the better lever.

### 4. Cosmetic leftover

`og-image.png` predates the current cut-card logo (file dated 2026-07-29). That
is the image shown when someone shares a link — it affects nothing Google ranks
on. Already tracked on the roadmap's engineering track.

## How to re-check any of this

```bash
# Titles and descriptions across every sitemap URL, against the live site
node -e '...'   # the audit used on 2026-08-06 measured: status, title length,
                # description length, h1 count, word count, and the share of
                # 6-word phrases each market page shares with its siblings
```

The quick version: fetch `/sitemap.xml`, walk every `<loc>`, and flag any title
over 60 characters or description over 160. Nothing in the repo automates this —
it was a one-off measurement, and re-running it is worth doing after any change
to `marketPageTitle()` or `marketShell()`.
