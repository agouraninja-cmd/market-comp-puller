# SEO — State & Resume Point

Written 2026-08-06. **Read this first when picking organic acquisition back
up.** The short version: the 38 market pages went from invisible and
unmeasurable to indexed, measured, and correctly labeled. One structural
decision and one small copy change are left.

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
method, not the meta tag** — meta-tag verification fetches the property root, and
under `ACCOUNT_WALL` `/` is a 302, so a tag there is never seen and verification
fails without saying why.

## Current state

| Item | State |
|------|-------|
| Search Console property | **Verified** 2026-08-06 — URL-prefix `https://compninja.co/`, HTML-file method, under okb336@gmail.com |
| `GOOGLE_SITE_VERIFICATION` | Set on Render. **Leave it set** — Google re-fetches the file and unverifies when it stops answering |
| Sitemap | Resubmitted 2026-08-06. Google had auto-found it 2026-07-14 and **never re-read it**, so it only knew 29 pages; it now has all 43 |
| Market pages | **Indexed** — `/market/industrial-dallas-tx` returned "URL is on Google". Re-crawl requested so the new title is picked up |
| `/how-it-works` | **Never crawled** — "Discovered, currently not indexed", last crawl N/A. Indexing requested |
| Everything else audited | Fine — 650-word average, 63% unique between siblings, canonicals present, one h1 per page, `/markets` links all 39, robots.txt correct, mobile viewport present |

## What is left, ranked

### 1. The homepage is a 302 and out of the sitemap (product decision)

**This is the biggest remaining item and it is no longer hypothetical.** `/`
redirects to `/how-it-works`, which was dropped from `sitemap.xml` because
listing a redirecting URL is a soft error in Search Console. The consequence,
now confirmed: Google has never crawled the page that every brand search and
every anonymous arrival lands on.

The root domain is normally the strongest URL a site has, and inbound links
currently pass through a redirect to reach content. The fix is serving that
content **at `/` with a 200** for logged-out visitors instead of redirecting,
and putting `/` back in the sitemap. That reopens the account wall route in
server.js (the `ACCOUNT_WALL` branch of the static handler), so it needs a
decision about what a logged-out visitor sees at `/`, plus a canonical
strategy so `/` and `/how-it-works` are not duplicates.

`ACCOUNT_WALL=off` on Render is the instant, no-deploy alternative — it restores
`/` to a 200 and to the sitemap — but it also reopens free guest searches, which
is a different decision. The owner chose to **leave the wall on** on 2026-08-06.

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

### 3. Check the reports (no work, just look)

Performance and Page Indexing needed ~a day to populate after verification. The
Page Indexing report is what actually closes this loop — it says how many of the
43 are indexed versus sitting in the same never-crawled state as
`/how-it-works`. Two pages were spot-checked by hand; that report checks all of
them at once.

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
