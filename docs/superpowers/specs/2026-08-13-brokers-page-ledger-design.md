# /brokers as two stacked ledgers

Date: 2026-08-13
Status: agreed
Touches: `server.js` (`MARKET_CSS` + `renderBrokersPageHTML` and its
standing comment), `test/public-pages.test.js`, `devlog.json`, and the
`/brokers` bullet in `CLAUDE.md` so it names two stacked ledgers instead
of two cards.

Source: owner asked to redesign `https://compninja.co/brokers` (the whole
page, not one card). The How-it-works "What brokers get" ledger that shipped
in PR #74 was the wrong surface and is out of scope here; leave it.

## 1. The problem

`/brokers` is the broker-facing offer. It currently tells that offer as two
side-by-side cards with bullet lists: "What you get for submitting comps"
and "Pro: the Broker Vault". The Verified chip is in the first bullet, which
is the right instinct, but the rest of the page still reads as a feature
list rather than a statement of trades.

The landing's brokers block was redrawn as a hairline ledger for the same
reason. This page is where a broker actually lands. It should speak that
language, not keep the cards the landing just left behind.

## 2. What this is not

- Not a change to `/`, `/how-it-works`, `/vault`, or `/1031-exchange`.
- Not a second Submit door. The red button at the bottom remains the only
  link to `/?submit=comp`.
- Not a Method 3-up (`.steps`). These are trades, not a sequence.
- Not `class="badge v"` on this stylesheet. MARKET_CSS already documents
  that `.v` collides with tile/card stat styling; the chip stays an inline
  `style="color:var(--ok-text);background:var(--ok-bg)"` on `span.badge`.
- Not scroll choreography. `/brokers` has no `html.anim`. Rows must be
  visible on first paint. Do not copy the How-it-works opacity-0 observer.
- Not fake logos, not a new endpoint, not a copy rewrite of the hero, the
  1031 card, or the compliance sentence.

## 3. Decisions locked during brainstorming

1. **The whole page**, not the left card only.
2. **Two stacked ledgers**, not one long list (a single list makes the vault
   look like it comes with a submitted comp).
3. **Hero stays.** "Your comps, your name, on every report that uses them."
   plus the existing sub.
4. **Ledger 1 is contribute. Ledger 2 is Pro.** Labels, headlines, and body
   copy are locked in §5.
5. **Proof line under ledger 1.** Still omitted when `MARKET_CREDIT` is empty.
6. **Vault links under ledger 2 only.** Open your vault · Upgrade to Pro,
   including `#upgradeProLink` so ACCOUNT_NAV_JS can still hide the upgrade
   for members.
7. **Submit CTA, 1031 card, compliance sentence stay** in that order below
   the ledgers.

## 4. Architecture

All of it inside `renderBrokersPageHTML` and `MARKET_CSS`. The page still
renders through `marketShell`. No new file.

Markup, in order:

```
h1 + p.sub                         (unchanged)
h2  For submitting a comp.
div.bk                             (three .bkrow)
p.disc                             (proof, or omitted)
h2  With Pro.
div.bk                             (three .bkrow)
p                                  (vault links, #upgradeProLink)
div.cta                            (Submit a comp — the one door)
div.card                           (1031 guide)
p.disc                             (compliance)
```

Each `.bkrow` is the How-it-works shape: `.bklag` (uppercase label) + a
block with `h3`, optional chip, `p`. Two `.bk` elements, not one; tests
count rows per ledger so a future editor cannot merge them.

CSS: add `.bk` / `.bkrow` / `.bklag` / `.bk .badge` to `MARKET_CSS` next
to the existing card rules, with a comment that `/brokers` is the only
consumer. Unused on `/markets` is fine; do not invent a third stylesheet.
Desktop (`min-width: 640px`): `grid-template-columns: 7.5rem 1fr`. Mobile:
one column. Tokens only: `--edge`, `--hair`, `--red`, `--ok-text`,
`--ok-bg`, `--ink-mute`, `--card`.

`.grid` stays in MARKET_CSS. `/markets` still uses it. `/brokers` stops.

## 5. Copy (verbatim)

Hero, proof, CTA, 1031, and compliance are unchanged from today's
`renderBrokersPageHTML`.

**For submitting a comp**

| Label | Headline | Body |
|---|---|---|
| CREDIT | Submitted comps carry your name | Every report that uses one of your comps shows a green Verified badge and your firm's name. |
| INTROS | Owners in your markets | When an owner in your market wants a broker's opinion of value, we introduce them to you. |
| PROFILE | A public page with your comps | A public profile page with your verified comps. |

CREDIT's chip, between the headline and the body:
`Verified · via Your Firm` (`&middot;` in HTML), same inline green as today.

**With Pro**

| Label | Headline | Body |
|---|---|---|
| BOOK | Upload and organize your book | Upload and organize your comp book. |
| PIPELINE | Watch your markets | Watch your markets for leads. |
| PRIVATE | Exclusively yours | Exclusively private to you. |

Body lines that already exist as bullets stay those sentences. Do not
invent a longer vault pitch. No em dashes. Never "appraisal". Never claim
CompNinja is a broker.

## 6. Tests

In `test/public-pages.test.js`, a `/brokers`-only nested test (do not
reuse the How-it-works "What brokers get" assertions; that page is a
different surface):

- exactly two `class="bk"`
- first ledger's three labels are CREDIT, INTROS, PROFILE
- second ledger's three labels are BOOK, PIPELINE, PRIVATE
- `Verified &middot; via Your Firm` appears once in the contribute ledger
- `href="/?submit=comp"` appears exactly once
- no `class="steps"`
- no two-column `.grid` wrapping the offer
- 1031 heading and the compliance sentence still present
- existing tests stay: CTA is `/?submit=comp` not `/#submit-comp`;
  `#upgradeProLink` still exists; `/brokers?utm=` is still 200

## 7. Failure modes this exists to prevent

- Putting a Submit link in a ledger row (second door).
- Reusing `.steps` so the page clones Method.
- Using `class="badge v"` and inheriting the wrong green (or a stat `.v`).
- Hiding rows behind `html.anim` / `.bk.on` that this page never adds.
- Folding Pro rows into the contribute ledger so the vault reads as free.
- Changing How it works in the same commit.

## 8. Rollback

Revert the commit. `/brokers` is a cached marketShell page (`vary: cookie`,
hour cache for the anonymous body). After deploy, hard-refresh
`https://compninja.co/brokers` rather than trusting an open tab.
