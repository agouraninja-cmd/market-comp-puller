---
paths:
  - "bov-doc.js"
  - "bov-builder.js"
  - "bov-page.js"
  - "test/bov-doc.test.js"
  - "test/bov-page.test.js"
  - "test/bov-run.test.js"
---
# The Broker section and the BOV builder

> Shipped 2026-11-27 (the owner: "Create a tool in the pipeline section that
> creates a Professional BOV for the brokers. and change the pipeline named
> section to be called the broker section."). Built straight, not from
> drafts (the ask was to build, not for options). Not to be confused with
> the **BOV desk** (`bov-desk.md`): that is the owner's `/admin/bov`, which
> finds brokers for an owner who asked for a BOV. This is the page a broker
> writes the BOV on. The before-and-after pictures, and the four pages it
> prints, are at https://claude.ai/artifact/MXfgs8GsERQrocM2PfcfU2 (taken on
> the stand-in database with a seeded book; `scripts/shot.js` boots with no
> database and shows `/bov` only its sign-in wall).

## The Broker section

The rail row that read **Pipeline** reads **Broker** (the phone bar too). It
is a section of two tabs, the Comps section's shape:

- **`brokerSectionTabs(current)`** in server.js (`BROKER_TABS`: "Pipeline"
  `/pipeline`, then "BOV builder" `/bov`), a `<nav class="cs-tabs"
  aria-label="Broker">`: the Comps section's own segmented control
  (components.js), not a new family. Prepended to both pages' bodies for a
  member (cookie presence), never a stranger's.
- **Only the words changed.** The row is still `#navPipe`, still
  `href="/pipeline"`, still `NAV_ICONS.pipeline`, on both nav authors
  (marketBar and index.html), so `SHOP_NAV_CSS`, the phone bar and
  nav-parity's twin rules found it untouched. marketBar marks it current on
  both pages (`BROKER_PAGE_PATHS`). Routes, ids, tables and these notes
  still say "pipeline".
- **"Pipeline" is still a word in copy**, for the board: the tab, `/pipeline`'s
  heading, "Your BOV pipeline →" on Home, "Open your pipeline" in the
  new-request email. What must not come back is `<span class="nvl">Pipeline`
  on either rail (`test/nav-parity.test.js`).
- **A development firm** still reads Sites in this row's place, and `/bov`
  sends its member to `/sites` exactly as `/pipeline` does (never from a
  prerendered page).
- **Not renamed:** the iOS app's Pipeline tab (`ios/CompNinja`), which holds
  the board alone and has no builder.

## The BOV builder (`/bov`)

A broker fills in a form and reads the finished Broker Opinion of Value
beside it as they type: a cover on their own letterhead, their opinion of
value, the property, the comparables, their recommendation, a line to sign
and the conditions every BOV carries. "Print or save as PDF" is the
browser's own print. Four pages for an ordinary BOV, US Letter.

**Three files, and which decides what:**

| File | What it is |
|---|---|
| `bov-doc.js` | PURE, dual-exported (`BOVDOC`), `maxAge: 0`. How a typed figure is read, which comps are ticked to start, the range they support, the starting drafts, the document's HTML and its stylesheet. Its header is the contract (six rules). |
| `bov-builder.js` | BROWSER only, `maxAge: 0`. Binds the form to a draft, redraws the preview, keeps the draft in this browser, prints. Decides nothing `BOVDOC` can answer. |
| `bov-page.js` | The page's markup, walls and own stylesheet: a marketShell BODY like `sites-page.js`. Requires `bov-doc.js` for the option lists. |

**The rules a future editor will otherwise break:**

- **Nothing a broker types leaves the page (rule 6).** The draft holds an
  owner's name, an NOI, a value and which private comps were used. The
  builder's requests are four, listed in its header and pinned by
  `test/bov-page.test.js` (by source AND by running it): `GET /api/branding`,
  `GET /api/broker/bovs`, and two presses, `POST /api/building-photo` (the
  subject's address in the body, rule 7's door, for a street photo) and
  `POST /api/broker/bovs/update` (`{ id, status: "delivered" }`, the board's
  own write). A new request there fails the build. **There is no server-side
  store of a BOV**, on purpose: no table, no migration, no route.
- **The draft is kept in `localStorage`**, key `cnBov1:<tag>`, one draft per
  pipeline BOV (keyed by its id) plus one free-standing (`_`), twelve at
  most. `tag` is 16 hex of a hash of the account id, made in the `/bov`
  route, so two people sharing a browser do not read each other's drafts and
  the page's bytes never name the account. Nothing is written on load (rule
  15); a cover photo too large for storage is kept for the open page only,
  and the page says so. A draft does not follow the broker to another
  computer: that is the cost of the rule above.
- **The gate is the comps' own.** The route boots with `vaultReadPayload`
  (so 401, 403 without Pro, 503 with no database, said as walls by
  `bov-page.js`) and hands the page only `comps`, `identity` and `firm`.
  The page reads nothing else of the book.
- **The opinion is the broker's, stated.** The comps support a range and the
  builder offers it ("Use this range" fills Low and High, and List only when
  it is empty), but the document's "Opinion of value" is only what was
  typed, and the print button is off until a value reads. CompNinja's owner
  is not a licensed broker: nothing here may put a figure of ours on a
  broker's letterhead as their opinion. The comparables page states the
  sales' own arithmetic under its own heading.
- **Not an appraisal, on every copy.** `BOVDOC.limitingConditions()` cannot
  be switched off, and a broker's own disclaimer (their report branding) is
  added to it. The builder's own copy never says "appraisal" (test-pinned).
- **Refuse rather than guess.** "1.2M" is not read (the vault's rule). The
  field turns red, the reason is said under it, and the figure stays off
  the document.
- **One property type, one unit.** The range is over the chosen SALES of the
  subject's own type; land is per acre. A comp of another type is listed
  and the document says it was left out of the figures. Leases get their
  own table and enter no sale figure (`saleRate` reads the stored
  `price_per_sqft`, the comps page's rule).
- **Comps are the broker's own** (`/api/vault`'s, from the boot) or typed in
  ("Add a comparable sale by hand", held in the draft only, never saved to
  the book). The builder runs no comp report and reads no public corpus.
  Ticked to start: priced sales of the subject's type, its own market
  first, newest first, six at most, until the broker ticks one themselves
  (`touchedComps`).
- **The letterhead is the saved report branding**, own else firm's (the comp
  sheet's order), else the credit identity. It is edited at `/desk?firm=1`,
  not here. No license number on it is advice in the readiness line, never
  a refusal.
- **The preview and the paper are one function.** `documentHtml(draft,
  { preview })`: the preview shows amber hints where something is missing;
  the printed copy is drawn again without them into `#bovSheet`, moved under
  `body`, and shown alone by `body.bov-printing` (the comp sheet's way). The
  page title is set to `BOV-<street>` while printing, which is the PDF's
  offered file name.
- **The document's stylesheet is `BOVDOC.documentCss(accent)`**, written into
  `<style id="bbDocCss">`. Literal colours, never the site's tokens (paper is
  black on white in either theme), and five named accents, never a free
  colour. It restates what the site's stylesheet would leak onto it
  (`th`'s capitals, table widths). Each `.bvd-sheet` is a Letter page at 96
  to the inch on screen and starts a new page in print.
- **The last page is tight on purpose.** The signature and date share a row
  and the fine print is two columns: stacked, an ordinary BOV spilled six
  lines onto a fifth page. A long Market overview will still run over; that
  is content, not a bug.
- **Starting drafts** ("Write a first draft") are built from the draft's own
  facts by `starterSummary` / `starterStrategy`. No model is called. They
  ask before replacing words already typed.
- **From the board.** An open or delivered BOV's card on `/pipeline` links
  `/bov?from=<id>` ("Write the BOV →" / "Open the BOV →", `.pb-write`, ink,
  never red). The builder fills address, type and size from that row only
  for a draft it has not kept (`fresh`); an id that is not the account's own
  starts a plain draft. After printing an OPEN one, the page offers "Mark it
  delivered in your pipeline".

**Wiring:** `/bov` is in instant-nav.js's `TAB_PATHS`, in `CTA_FREE_PAGES`,
logs `bov_visit` through `logPageVisit`, passes `INTER_FONT_HEAD`, and both
scripts are in `STATIC_FILES` as JavaScript with `maxAge: 0`. The page's
stylesheet uses the shared `.btn` unrestyled (`test/components.test.js`
lists the file).

**Tests:** `test/bov-doc.test.js` (every rule of the module),
`test/bov-page.test.js` (the walls, the markup, the request list, and the
builder RUN against a stand-in document: the comps ticked to start, a draft
kept per account, a card's link, printing, the one write, a development
firm), `test/bov-run.test.js` (a real server: the gate, own comps only, the
tag, the scripts), and the board card in `test/vault-page.test.js`. Checked
in Chromium on the stand-in database with a seeded book, desktop and phone,
and printed to PDF.

**Not built, and the obvious next steps:** saving a BOV to the account (a
private table of its own, vault-class, stripped of nothing because it would
be the broker's own, but rule 4 applies: refuse without a database);
pulling public comps in from a comp report the member ran; a comp map on
the comparables page; a Word or PowerPoint copy; a market overview written
from the market page's figures.
