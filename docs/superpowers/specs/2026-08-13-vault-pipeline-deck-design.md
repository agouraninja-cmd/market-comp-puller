# Vault pipeline deck: one table from lead to won

Date: 2026-08-13
Status: agreed
Touches: `vault-page.js`, `test/vault-page.test.js`,
`test/vault-first-run.test.js`, `devlog.json`, `CLAUDE.md`

Source: owner review of `/vault` on 2026-08-13 — "leads and the BOV tracker
feel bolted on." Scoped to the pipeline deck only. The book deck and the
visual language established by Direction U (2026-08-10) are unchanged and
liked; this spec inherits them rather than revisiting them.

## 1. The problem

The pipeline deck holds two sections that describe one flow and share no
structure.

Seen with real rows, the first lead is Boise Industrial at 34,000 SF and the
second BOV row is Boise Industrial at 34,000 SF marked delivered. That is one
engagement at two stages — `POST /api/broker/leads/intro` auto-creates the BOV
row — but the two live in separate tables 500px apart, and nothing on screen
connects them. Both tables repeat the same four columns: received, market,
type, size.

Three further symptoms, all structural:

- **Each section opens with a form.** The BOV form is seven fields between the
  tiles and the table. The book deck settled the opposite rule three days
  earlier: one deck, one action, behind a closed panel. The pipeline deck's
  rule carries no action at all and the deck holds two permanently open forms.
- **Market is typed from memory, twice.** A `City, ST` box for coverage and
  another for a BOV, neither offering the markets the broker already watches or
  already holds comps in — both of which the page has in memory.
- **The four tiles summarise half the deck.** They count `broker_bovs` only,
  while sitting in the middle of a deck whose first table they say nothing
  about.

## 2. What this is not

- Not a new endpoint, table, or migration. The browser already receives both
  payloads; this is a presentation change.
- Not a change to the status vocabulary (`open`/`delivered`/`won`/`lost`) or to
  the deliberate decision not to police transitions.
- Not a change to lead anonymization. No name, email, phone, company, or street
  address enters this deck, and nothing here widens what
  `LEADSVC.anonymizeLead` allows.
- Not a kanban. Considered and rejected: no drag-and-drop exists in the repo,
  status would still change through a select, and columns of cards contradict
  the page's typographic language and collapse badly when narrow.
- Not a change to the book deck or the file input. The empty first-run
  page was later replaced (2026-08-13, spec
  `docs/superpowers/specs/2026-08-13-vault-empty-workspace-design.md`):
  both decks now show on day one.

## 3. Decisions locked during brainstorming

1. **A pipeline, not an inbox or a scoreboard.** The deck's job is every
   engagement from new lead through won or lost, in one place.
2. **One table, with a stage column.** Option A of three.
3. **A lead is a stage, not a separate product.** It renders as a `New` chip
   whose only action is requesting an introduction.
4. **The deck earns its one action**, `+ Log a BOV`, closed by default.
5. **Coverage is setup, not the daily view.** It collapses.

## 4. Architecture

All of it inside `vault-page.js`. `#leads` and `#bovSec` cease to exist as
sections; `#deckPipe` holds, in order:

```
rule: Your pipeline                        + Log a BOV   (#bovToggle)
#pipeStrip    five stage cells + one note line
#bovAddSec    the log-a-BOV form, CLOSED   (panel, mirrors #addSec)
#pipeSec      one table (#pipeTbl)
#covBox       <details class="dbox"> Markets you watch
```

### The deck action

`#bovToggle` / `#bovAddSec` mirror `#addToggle` / `#addSec`, including the rule
that a single writer (`setBovOpen()`) owns the panel's visibility and carries
the label and `aria-expanded` with it. `#bovMsg` lives INSIDE the panel for the
same reason `#res` lives inside `#addSec`: a log that failed must not write its
error into something invisible, so a failed submit leaves the panel open.

### The table

Eight columns — no wider than today's BOV table, since Stage replaces Status:

| Stage | Received | Market | Type | Size | Source | Notes | (action) |

Rows are the merge of two sources, distinguished by an internal `kind`:

- `kind: "lead"` — Stage is a `New` chip (a `<span class="stg new">`, never a
  button: there is no other stage a lead can be moved to from here). Source
  reads "CompNinja lead". Notes is empty. The action is
  `Request introduction`, or a disabled `Intro requested` when
  `intro_requested`.
- `kind: "bov"` — today's row unchanged: the status `<select>`, the source
  label map, notes, and `Remove`.

Sorted together, newest received first, through the existing sortable
`th[data-bk]` headers. A lead's received date is `ts.slice(0, 10)`; a BOV's is
`received_on`.

A lead has no address under its market, by design. Rather than five repetitions
of an explanation, one line under the table says it once (see Copy).

### The strip

`#pipeStrip` uses the same `.strip` component as `#readStrip`, and keeps its
rule: **a cell is a `<button>` only when there is something behind it.** Five
cells — New, Open, Delivered, Won, Lost — each counting merged rows in that
stage. Clicking filters the table to that stage; clicking the active cell
clears it. The filter is view state only and is never sent anywhere.

The four tiles are removed, which would lose two facts that are not stage
counts, so one `.note` line under the strip carries them: this year's count and
the win rate. The win rate keeps `bov-log.js`'s floor — below three decided
BOVs it is a dash, not a number.

The strip counts **what actually arrived** (see Partial failure), never what
was asked for.

### Coverage

`#covBox` is a collapsed `<details class="dbox">` titled "Markets you watch",
holding the coverage chips and `#covForm`.

`#covForm` remains **exactly one relocating node**. Its home is first-run step
2; `applyFirstRun` still moves it away when the vault has content and walks it
home when the last import is deleted. Only the away position changes, from
`#leads` to inside `#covBox`. A second copy would be a second thing to keep in
step with `broker-leads.js`'s coverage rules.

`#covMarket` and `#bovMarket` both gain a shared `<datalist>` of the markets the
broker already watches or already holds comps in, sourced from the coverage
rows and the boot payload's `markets`. It is a suggestion list, not a
constraint: a broker's next BOV may be in a market they have never touched, so
free text still submits and the server's own validation stays the gate.

### Partial failure

One table, two endpoints, so this is stated rather than left to chance:

- Leads fail, BOVs load → the table renders BOV rows; a `.msg bad` line reports
  that leads could not be loaded.
- BOVs fail, leads load → the mirror image.
- Both fail → the two messages and no table.

Neither failure may blank the deck, and neither may leave stale rows of the
other kind on screen. Each panel's existing 403/503 rewording is kept: the
lead inbox's copy names the inbox, and a BOV failure is reworded rather than
shown verbatim, because `requireBroker`'s strings name the lead inbox.

## 5. Copy

Deck action: `+ Log a BOV`.

Under the strip: `N this year · win rate NN%` (`—` for the win rate below the
floor of three decided).

Under the table, once:

> A lead's address and contact details stay with CompNinja until an
> introduction is made.

Empty states collapse from two lines to one, and say which situation it is:

- No coverage at all → "No markets yet — add one under Markets you watch to
  start seeing leads."
- Coverage, but nothing in either source → "Nothing in your markets in the last
  90 days, and nothing logged yet."

## 6. What a future editor will otherwise break

- **`.strip.hide` and `.deck.hide` set `display` and are declared below
  `.hide`.** A plain `strip hide` loses the cascade. Same trap as
  `ACCOUNT_NAV_CSS`'s `[hidden]` line.
- **The whole page is one template literal.** A stray `${` or a
  single-backslash escape emits broken JavaScript and a blank workspace rather
  than failing loudly. `test/vault-page.test.js` compiles what the page emits;
  that test is the guard.
- **`?noseed=1` on both loaders.** `loadLeads(noseed)` must not re-earn a market
  the broker just removed, and `loadBovs(noseed)` must not resurrect a row they
  just removed. Merging the two views must not merge away either escape.

## 7. Tests

`test/vault-page.test.js` — the thirteen existing references to `#leadRows`,
`#bovRows`, `#leadTableWrap`, `#bovTableWrap`, `#noLeads`, `#noBovs`,
`#bovCards` and `#covRow` are rewritten against the new markup, plus:

- one pipeline table exists and neither old wrapper does
- a lead row renders the `New` chip and an intro button, and no status select
- a BOV row renders its status select and a Remove button
- a stage cell with a zero count is not a `<button>`
- leads failing still renders BOV rows, and vice versa
- the lead-privacy line appears exactly once
- the win rate is a dash below three decided BOVs

`test/vault-first-run.test.js` — empty workspace (2026-08-13): exactly one
`#covForm`, exactly one `<input type=file>`, both decks and the trust line
ship visible. `#firstRun` is gone.

## 8. Out of scope

- Any server change, including a merged endpoint
- Editing a BOV's market, size, or notes in place (Remove and re-log today)
- Linking a BOV row back to the lead it came from by id (the auto-created row
  carries no visible pointer, and inventing one is a data change)
- Mobile layout beyond what the existing `.tw` scroll wrapper already gives
- Notifications of any kind
