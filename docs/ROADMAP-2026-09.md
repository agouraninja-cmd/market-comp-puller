# September 2026 — one goal a day

`docs/ROADMAP.md` states what the product needs next and in what order; this
states what gets done on which day. One main goal per day, written as a
finished thing rather than a topic. The daily rows are Jacob's; Owen and Chuck
have a line of their own under each week.

## Capacity

- **Jacob · 40 h** — the build. Eight hours a day, Monday to Friday — which is why the weekend rows say nothing and mean it.
- **Owen · 10 h** — self-contained engineering with no product decisions in it, so a week of his never waits on a week of mine.
- **Chuck · 2 h** — one hour is the Monday meeting, one hour is his own. He is an answer, not a pair of hands — spend it on the questions only he can close.

## The month goal

> Three brokers who are not Chuck have put their own book into the vault, and I watched each of them do it.

If every daily goal below were met and that sentence were still false,
September was spent on the wrong things. The product is built; what it does
not have is users, and no amount of engineering this month substitutes for
three strangers touching it.

## How it is planned

- **One goal.** Not a list. If two things are written on a day, the second is the one that will not happen — and the day reads as a failure when it was a success.
- **Write the finish line, not the subject.** “Vault” is a topic. “A forwarded email lands one comp in the vault behind the confirm table” is a goal: it can be true or false at 6pm.
- **Weekends and buffer days are goals too.** “Nothing” is a legitimate entry; leaving the row blank is what makes a week look like it collapsed.
- **A day that misses moves to the buffer.** Weeks 2–5 each carry one buffer day for exactly this. If the buffer is spent before the week is, cut a goal rather than doubling one up.
- **Measurements count as goals.** Several roadmap items are blocked on a stopwatch, not on code. Those are full days’ work with a written result, not chores to squeeze in beside a feature.
- At the end of the month, move what shipped into the Shipped log and append the devlog entries. This file is intent; the devlog is history.

Status key: `[ ]` planned · `[x]` done · `[>]` moved to a later day · `[-]` dropped

---

## Week 1 — Sep 1–6

*Answer the questions blocking the archive before building anything for it.*

| Date | The one goal | |
|---|---|---|
| Tue 1 | The hand-keying baseline exists: 12 comps typed into the vault by hand, stopwatch running, the number written into docs/evals/. (Monday meeting lands here — no Monday this week.) | `[ ]` |
| Wed 2 | A dated Search Console verdict in docs/SEO.md: has / been re-crawled, what does Page Indexing say across all 44 URLs, and is there a next lever or an explicit stop. | `[ ]` |
| Thu 3 | The confirm table names the property — business name beside the type, review-only, nothing stored. The smaller of the two options, costed first. | `[ ]` |
| Fri 4 | The confirm table shows only the columns the source document actually had, and still explains why a batch failed. | `[ ]` |
| Sat 5 | *(nothing)* | `[ ]` |
| Sun 6 | *(nothing)* | `[ ]` |

**Owen · 10 h:** Market pages onto the rd-* Research Desk tokens, /markets first. Before-and-after screenshots ship with the change.

**Chuck · 1 h + Monday meeting:** Name three brokers and make the introductions. Week 4 is booked off this one hour, so it happens first.

**What actually happened:**

---

## Week 2 — Sep 7–13

*Close the archive gate with a number, then build against it.*

| Date | The one goal | |
|---|---|---|
| Mon 7 | Correction time re-measured against the redesigned confirm table, and the archive go/no-go written beside Tuesday's by-hand baseline. Both halves of the comparison finally exist. | `[ ]` |
| Tue 8 | One real forwarded email received end to end, and Resend's SPF/DKIM verdict recorded — the spec's first open question, settled against a real message rather than a guess. | `[ ]` |
| Wed 9 | commitVaultBatch() is out of POST /api/vault/upload. Pure refactor, tests green, no behavior change anywhere. | `[ ]` |
| Thu 10 | A message from a verified sender creates a quarantined batch; an unverified one quarantines instead of importing. The wall is up before the feature is. | `[ ]` |
| Fri 11 | *(buffer — the week's slipped goal)* | `[ ]` |
| Sat 12 | *(nothing)* | `[ ]` |
| Sun 13 | *(nothing)* | `[ ]` |

**Owen · 10 h:** /market/<slug> onto the same tokens. MARKET_CSS stops being the older skin.

**Chuck · 1 h + Monday meeting:** Pricing: one answer on the Pro price and the firm seat price, against what he would actually pay.

**What actually happened:**

---

## Week 3 — Sep 14–20

*A forwarded email becomes comps a broker confirms.*

| Date | The one goal | |
|---|---|---|
| Mon 14 | Forward → extract → confirm table runs end to end in dev, on a real broker's real email. | `[ ]` |
| Tue 15 | Every refusal is loud and named: wrong sender, unsupported file, oversized attachment. Nothing fails silently. | `[ ]` |
| Wed 16 | test/archive-ingest-run.test.js proves the whole loop against the fake PostgREST, refusals included. | `[ ]` |
| Thu 17 | Shipped: migration run before the deploy, /healthz commit checked afterwards, devlog entry in the same commit. | `[ ]` |
| Fri 18 | *(buffer — the week's slipped goal)* | `[ ]` |
| Sat 19 | *(nothing)* | `[ ]` |
| Sun 20 | *(nothing)* | `[ ]` |

**Owen · 10 h:** A real 50-address bulk run, and a written answer to each of the spec's three §7 questions.

**Chuck · 1 h + Monday meeting:** The gut check's benchmark: what a broker would actually measure their own book against.

**What actually happened:**

---

## Week 4 — Sep 21–27

*Hand a broker the vault in the room. This has never once happened.*

| Date | The one goal | |
|---|---|---|
| Mon 21 | Three onboardings on the calendar with names, dates and addresses. No date means no week — everything below depends on this hour. | `[ ]` |
| Tue 22 | Broker 1 onboarded in the room: passkey redeemed, their own book imported, and I never touched the keyboard. | `[ ]` |
| Wed 23 | What broker 1 hit is written up, and the single worst blocker is fixed and shipped. | `[ ]` |
| Thu 24 | Brokers 2 and 3 onboarded the same way, with the same silence from me. | `[ ]` |
| Fri 25 | *(buffer — the week's slipped goal)* | `[ ]` |
| Sat 26 | *(nothing)* | `[ ]` |
| Sun 27 | *(nothing)* | `[ ]` |

**Owen · 10 h:** Whatever the first onboarding breaks in the vault or the coordinate path — his half, same week.

**Chuck · 1 h + Monday meeting:** Sit in on one onboarding, and afterwards say what the broker expected instead.

**What actually happened:**

---

## Week 5 — Sep 28–30

*Say what the month proved, and pick October's one thing.*

| Date | The one goal | |
|---|---|---|
| Mon 28 | One verdict from the three onboardings: does the vault survive contact with a stranger, and what is October's single goal. | `[ ]` |
| Tue 29 | The highest-value fix from those three sessions is shipped. | `[ ]` |
| Wed 30 | Close the month: Shipped log, devlog entries, October's template. | `[ ]` |

**Owen · 10 h:** Close out his open branch and write down what he wants to own in October.

**Chuck · 1 h + Monday meeting:** One sentence: what he would tell a broker CompNinja is for, now that three have used it.

**What actually happened:**

---

## Not scheduled — and why

Every one of these is real work that a busier-looking month would have picked
up. Each is here because it is not the binding constraint in September.

### Deliberately not scheduled this month

- [ ] Corpus browse page — gated on the density milestone (10+ buckets holding 8+ provenance-good comps from organic traffic).
- [ ] Rent-roll-drives-DCF, white-label exports, market digest pages — all real, none of them the binding constraint in September.
- [ ] Re-measuring PARALLEL_SEARCH — needs real traffic, which is what this month is trying to create.

### Still open, no date yet

- [ ] Attorney: referral fees, MLS re-share terms, broker-data privacy — the last of these gates launch, and three live vaults sharpen it.
- [ ] Search demand on the desk needs traffic before it says anything but “no one searched this market”.
- [ ] A real photographed scan through extract, at a realistic phone resolution — cheap, and still unmeasured.
