# September 2026 — daily goals, three people

`docs/ROADMAP.md` says what the product needs next and in what order.
`docs/ROADMAP-2026-09.md` says what Jacob does on which day. This file gives
**all three people a row on every day**: one column each, one goal each,
written as a finished thing that is true or false at 6pm.

## Capacity

| Person | Hours / week | Shape of a day |
|---|---|---|
| **Jacob** | 40 h | Eight hours, Monday to Friday. Weekends say *nothing* and mean it. |
| **Owen** | 10 h | About two hours a day, Monday to Friday. Self-contained engineering with no product decision inside it, so his day never waits on Jacob's. |
| **Chuck** | 2 h | One hour is the Monday meeting. One hour is his own, on one day of the week. Every other day of his reads *—*. He is an answer, not a pair of hands. |

## The month goal

> Three brokers who are not Chuck have put their own book into the vault, and Jacob watched each of them do it.

If every cell below were ticked and that sentence were still false, September
was spent on the wrong things.

## How to use the template

- **One goal per cell.** If two things are written in a cell, the second is the one that will not happen.
- **Write the finish line, not the subject.** “Market pages” is a topic. “/markets renders on rd-* tokens and the before/after PNGs are in the PR” is a goal.
- **A dash is a real entry.** Chuck’s week is two hours; four of his five weekdays are *—* on purpose. Blank is what makes a week look like it collapsed.
- **A missed day moves to Friday.** Weeks 2–5 each carry a Friday buffer for Jacob and Owen. If the buffer is spent before the week is, cut a goal rather than doubling one up.
- **Measurements count as goals.** Several roadmap items are blocked on a stopwatch, not on code.
- **Fill in “What actually happened” on Friday**, one line per person, before the next week is touched.
- At the end of the month, move what shipped into ROADMAP.md’s Shipped log and append the devlog entries. This file is intent; the devlog is history.

Status key: `[ ]` planned · `[x]` done · `[>]` moved · `[-]` dropped

---

## Week 1 — Sep 1–6

*Answer the questions blocking the archive before building anything for it. Owen starts the market-page restyle. Chuck names the three brokers.*

| Date | Jacob · 8 h | Owen · 2 h | Chuck |
|---|---|---|---|
| Tue 1 | `[ ]` The hand-keying baseline exists: 12 comps typed into the vault by hand, stopwatch running, the number written into docs/evals/. Monday meeting lands here — no Monday this week. | `[ ]` HOW_CSS and MARKET_CSS read side by side; the list of rd-* tokens /markets is missing is written down. | `[ ]` Monday meeting (moved to Tuesday). |
| Wed 2 | `[ ]` A dated Search Console verdict in docs/SEO.md: has / been re-crawled, what Page Indexing says across all 44 URLs, and a next lever or an explicit stop. | `[ ]` Before-pictures captured: `node scripts/shot.js /markets --before`. | — |
| Thu 3 | `[ ]` The confirm table names the property — business name beside the type, review-only, nothing stored. The smaller of the two options, costed first. | `[ ]` /markets header, cards and momentum-map chrome on rd-* tokens; nothing DB-driven touched. | `[ ]` Three brokers named and three introductions sent. Week 4 is booked off this hour, so it happens first. |
| Fri 4 | `[ ]` The confirm table shows only the columns the source document actually had, and still explains why a batch failed. | `[ ]` After-pictures captured, tests green, PR open with both PNGs attached. | — |
| Sat 5 | *(nothing)* | *(nothing)* | — |
| Sun 6 | *(nothing)* | *(nothing)* | — |

**What actually happened:**
- Jacob:
- Owen:
- Chuck:

---

## Week 2 — Sep 7–13

*Close the archive gate with a number, then build against it. Owen carries the restyle onto the per-market pages. Chuck answers pricing.*

| Date | Jacob · 8 h | Owen · 2 h | Chuck |
|---|---|---|---|
| Mon 7 | `[ ]` Correction time re-measured against the redesigned confirm table, and the archive go/no-go written beside Tuesday’s by-hand baseline. *(Labor Day — confirm the day holds before counting on it.)* | `[ ]` Before-pictures of three `/market/<slug>` pages, including industrial-boise-id. | `[ ]` Monday meeting *(Labor Day — confirm it holds)*. |
| Tue 8 | `[ ]` One real forwarded email received end to end, and Resend’s SPF/DKIM verdict recorded — the spec’s first open question settled against a real message. | `[ ]` Market-page hero band and ledger row on rd-* tokens. | — |
| Wed 9 | `[ ]` `commitVaultBatch()` is out of `POST /api/vault/upload`. Pure refactor, tests green, no behavior change anywhere. | `[ ]` Comps table and boundary-map chrome on the tokens; the areaStyle/boundaryStyle mirror test still green. | `[ ]` Pricing, in two sentences: the Pro price and the firm seat price, against what he would actually pay. |
| Thu 10 | `[ ]` A message from a verified sender creates a quarantined batch; an unverified one quarantines instead of importing. The wall is up before the feature is. | `[ ]` MARKET_CSS’s header no longer calls itself the older skin; after-pictures captured; PR open. | — |
| Fri 11 | `[ ]` *(buffer — the week’s slipped goal)* | `[ ]` *(buffer — review feedback on the two PRs)* | — |
| Sat 12 | *(nothing)* | *(nothing)* | — |
| Sun 13 | *(nothing)* | *(nothing)* | — |

**What actually happened:**
- Jacob:
- Owen:
- Chuck:

---

## Week 3 — Sep 14–20

*A forwarded email becomes comps a broker confirms. Owen runs bulk valuation for real. Chuck sets the gut-check benchmark.*

| Date | Jacob · 8 h | Owen · 2 h | Chuck |
|---|---|---|---|
| Mon 14 | `[ ]` Forward → extract → confirm table runs end to end in dev, on a real broker’s real email. | `[ ]` A 50-address list of real properties in one market assembled, and the day’s bulk allowance checked on /bulk before anything is pasted. | `[ ]` Monday meeting. |
| Tue 15 | `[ ]` Every refusal is loud and named: wrong sender, unsupported file, oversized attachment. Nothing fails silently. | `[ ]` The run executed; wall clock, cost, and every failed row written down. | — |
| Wed 16 | `[ ]` `test/archive-ingest-run.test.js` proves the whole loop against the fake PostgREST, refusals included. | `[ ]` Spec §7 question 1 answered in writing: is 50 the right cap. | `[ ]` The gut check’s benchmark: what a broker would actually measure their own book against, in one paragraph. |
| Thu 17 | `[ ]` Shipped: migration run before the deploy, /healthz commit checked afterwards, devlog entry in the same commit. | `[ ]` §7 questions 2 and 3 answered: should a firm share a run, and is per-address type worth the mixed-list case. | — |
| Fri 18 | `[ ]` *(buffer — the week’s slipped goal)* | `[ ]` The write-up lands in docs/evals/ and ROADMAP.md’s bulk bullet links to it. | — |
| Sat 19 | *(nothing)* | *(nothing)* | — |
| Sun 20 | *(nothing)* | *(nothing)* | — |

**What actually happened:**
- Jacob:
- Owen:
- Chuck:

---

## Week 4 — Sep 21–27

*Hand a broker the vault in the room. This has never once happened. Owen fixes what it breaks, the same week.*

| Date | Jacob · 8 h | Owen · 2 h | Chuck |
|---|---|---|---|
| Mon 21 | `[ ]` Three onboardings on the calendar with names, dates and addresses. No date means no week. | `[ ]` The vault upload, geocode and coordinate paths re-read so a break on Tuesday can be placed in minutes, not hours. | `[ ]` Monday meeting: the three onboarding dates confirmed in the room. |
| Tue 22 | `[ ]` Broker 1 onboarded in the room: passkey redeemed, their own book imported, and Jacob never touched the keyboard. | `[ ]` Whatever broker 1 hit reproduced against the fake PostgREST the same evening. | `[ ]` Sits in on broker 1, and afterwards says what the broker expected instead. |
| Wed 23 | `[ ]` What broker 1 hit is written up, and the single worst blocker is fixed and shipped. | `[ ]` Owen’s half of that blocker: fix with a test, PR up. | — |
| Thu 24 | `[ ]` Brokers 2 and 3 onboarded the same way, with the same silence. | `[ ]` Whatever brokers 2 and 3 hit, reproduced and placed. | — |
| Fri 25 | `[ ]` *(buffer — the week’s slipped goal)* | `[ ]` Fix shipped; /healthz commit checked. | — |
| Sat 26 | *(nothing)* | *(nothing)* | — |
| Sun 27 | *(nothing)* | *(nothing)* | — |

**What actually happened:**
- Jacob:
- Owen:
- Chuck:

---

## Week 5 — Sep 28–30

*Say what the month proved, and pick October’s one thing.*

| Date | Jacob · 8 h | Owen · 2 h | Chuck |
|---|---|---|---|
| Mon 28 | `[ ]` One verdict from the three onboardings: does the vault survive contact with a stranger, and what is October’s single goal. | `[ ]` The open branch closed out or explicitly parked, with a line saying which. | `[ ]` Monday meeting. |
| Tue 29 | `[ ]` The highest-value fix from those three sessions is shipped. | `[ ]` One paragraph: what he wants to own in October. | `[ ]` One sentence: what he would tell a broker CompNinja is for, now that three have used it. |
| Wed 30 | `[ ]` Close the month: Shipped log, devlog entries, October’s copy of this template. | *(nothing)* | — |

**What actually happened:**
- Jacob:
- Owen:
- Chuck:

---

## Not scheduled — and why

- Corpus browse page — gated on the density milestone (10+ buckets holding 8+ provenance-good comps from organic traffic).
- Rent-roll-drives-DCF, white-label exports, market digest pages — real, and none of them the binding constraint in September.
- Re-measuring `PARALLEL_SEARCH` — needs real traffic, which is what this month is trying to create.
- Attorney: referral fees, MLS re-share terms, broker-data privacy — the last gates launch, and three live vaults sharpen it. No date yet.
- Search demand on the desk — needs traffic before it says anything but “no one searched this market”.
- A real photographed scan through extract at phone resolution — cheap, still unmeasured, no date yet.
