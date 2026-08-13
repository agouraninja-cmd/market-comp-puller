# Vault empty workspace: the real vault, empty

Date: 2026-08-13
Status: agreed
Touches: `vault-page.js`, `test/vault-page.test.js`,
`test/vault-first-run.test.js`, `devlog.json`, `CLAUDE.md`

Source: owner opened production `/vault` after the pipeline deck shipped and
the empty vault still showed the two numbered first-run cards. Those cards
are a different page; both decks hide until a comp or import exists, so the
pipeline table is invisible on day one. Asked to redesign the empty vault.
Decided: it is the real vault, empty — not a restyled onboarding page.

This supersedes two earlier empty-vault rules:

- Direction U / first-run (2026-08-10): hide both decks and the trust line
  until the first comp or import. The two numbered cards are the whole page.
- Pipeline deck spec (2026-08-13) §2 and §7: "Not a change to … the first
  run" and "`test/vault-first-run.test.js` — first run hides both decks."

The pipeline table, stage chips, `+ Log a BOV`, and coverage datalist are
unchanged. This spec only changes what an entitled vault looks like when
there is nothing in it yet.

## 1. The problem

An empty vault is a different product from a full one. Day one is two
numbered cards (`#firstRun`). "Your book" and "Your pipeline" do not exist
until a spreadsheet or a hand-typed comp lands. Watching a market from
card 2 still does not reveal the pipeline, so a lead waiting in that market
has nowhere to appear.

The 2026-08-10 reason was sound then: a "Your book" rule over an empty
table was a 0-0 scoreboard, and three empty tables stacked up read as
broken. The page now has two decks with empty tables already hidden. The
scoreboard argument no longer requires hiding the workspace.

## 2. What this is not

- Not a new endpoint, table, or migration.
- Not a change to the filled vault: returning brokers keep closed `+ Add
  comps`, closed `+ Log a BOV`, collapsed "Markets you watch", and the
  comps / pipeline tables they have today.
- Not a change to the 401 / 403 / 503 gates. `#app` still ships `hide` and
  `apply()` still reveals it only on a 200.
- Not a kanban, not a wizard, not a third deck.
- Not restoring "Start here" or putting the privacy fine print back on the
  card face. The disclosure stays a disclosure.

## 3. Decisions locked during brainstorming

1. **The empty vault is the real vault.** Both decks always show for an
   entitled broker. `#firstRun` as a separate page goes away.
2. **Empty states are invitations, not empty tables.** No header row over
   "nothing here yet."
3. **`+ Add comps` and `+ Log a BOV` stay closed** on day one, same as for
   a returning broker. The invitations in the body are the day-one actions.
4. **The watch-market form is the pipeline's empty-state body**, not a
   collapsed disclosure. Coverage only collapses once there is a pipeline
   row to put it under.
5. **The trust line shows zeros.** Comps 0 / Priced sales 0 / Median $/SF — /
   Published 0, plus the privacy sentence. The 2026-08-10 hide is reversed
   by this decision.

## 4. Architecture

All of it inside `vault-page.js`. `#firstRun` ceases to exist. `#app`
holds, in order:

```
#trustLine          ledger (visible, including zeros)
#deckBook           Your book                    + Add comps
#bookEmpty          invitation: copy, privacy disclosure, two buttons
#addSec             uploader, CLOSED
#compsSec           comps table — hidden while #bookEmpty is showing
#importsSec         imports disclosure — hidden while #bookEmpty is showing

#deckPipe           Your pipeline                + Log a BOV
#pipeStrip          five stage cells — hidden while the pipeline is empty
#bovAddSec          log-a-BOV form, CLOSED
#pipeEmpty          invitation + #covForm (the watch-market form)
#pipeSec            one table — hidden while #pipeEmpty is showing
#covBox             <details> Markets you watch — hidden while #pipeEmpty
                    is showing; holds #covForm once there are rows
```

Both invitations sit under their deck rule, matching a full vault: the
rule names the product, the body is either the table or the invitation.
`+ Add comps` / `+ Log a BOV` stay the deck actions; the empty-state
actions live in the body so day one does not open those panels.

### When each invitation hides

**Book.** Hide `#bookEmpty` (and show `#compsSec`) the moment there is a
comp **or** an import. Same key as today's `applyFirstRun`:
`compCount === 0 && uploadCount === 0`. An import that landed zero rows
has still been through the door; showing the invitation again would read
as their work having been thrown away.

**Pipeline.** Hide `#pipeEmpty` (and show `#pipeSec`, `#pipeStrip`,
`#covBox`) the moment any lead or BOV row actually arrived. Failures do
not count as rows. Coverage chips without a lead or BOV do not hide the
invitation: the form stays in the body with the chips on `#covRow`.

`placeCovForm()` is the single mover of `#covForm`:

- pipeline empty → append into `#pipeEmpty`
- pipeline has rows → append into `#covBox`

Called from the pipeline render after leads/BOVs settle, and from the book
apply path so deleting the last import does not strand the form. Still
exactly one node. Never a second copy.

### Shipping state (flash)

`#app` already ships `hide` until `apply()` gets a 200, so the workspace
cannot flash on a 401/403. Inside `#app`:

- `#trustLine` ships visible (`class="trust"`, not `trust hide`)
- both decks ship visible (`class="deck"`, not `deck hide`)
- `#bookEmpty` ships visible; `#compsSec` / `#importsSec` ship hidden
- `#pipeEmpty` ships visible; `#pipeTableWrap` / `#pipeStrip` / `#covBox`
  ship hidden

`applyFirstRun` keeps its name and its comps+uploads key. It no longer
toggles `#firstRun`, the decks, or the trust line. It toggles `#bookEmpty`
vs `#compsSec` / `#importsSec`. Pipeline empty vs table is owned by
`renderPipeline()`, which already knows whether any row arrived.

The mapper and the PDF confirm panel currently hide `#firstRun` so two UIs
do not stack. They hide `#bookEmpty` instead.

### Copy

Book invitation:

> Upload closed deals. They appear in your reports and stay private.

Disclosure summary unchanged: `Required columns & privacy details`. The
three fine-print paragraphs (four required columns; never public; PDF
extract vendor) move with it, word for word.

Buttons unchanged: `Download the template` (the existing
`/api/vault/template` link) and `Choose a spreadsheet or PDF`. Both drive
the one `#file` input. The first-run button id `#frPick` is renamed
`#bookPick`; the listener still calls `$("file").click()`.

Pipeline invitation:

> Watch a market to see owners requesting valuations. Nothing to upload.

Then the existing `#covForm` (City, ST / Type / Watch this market, plus
the seeding fine-print). No numbered "1" / "2". No three-bullet lists on
the face.

The pipeline's existing empty-table lines (no coverage / coverage but
nothing in 90 days) are replaced by this invitation for the zero-row
case. Partial-failure messages stay: a leads error still renders BOV
rows, and neither failure may blank the deck.

Trust line privacy sentence stays:

> Visible only to you. Nothing here is ever read into CompNinja's public
> records, and nothing is published unless you choose it.

## 5. What a future editor will otherwise break

- **One file input.** `#bookPick` and `#pick` both call `$("file").click()`.
  A second `<input type=file>` is two upload paths that cannot see each
  other's state.
- **One `#covForm`.** `placeCovForm` moves it; a copy in `#pipeEmpty` and
  another in `#covBox` would drift from `broker-leads.js`.
- **`.deck.hide` still sets `display` below `.hide`.** Decks no longer
  start hidden, but a lapse or a future gate that adds `hide` still needs
  that cascade line.
- **The whole page is one template literal.** A stray `${` or a
  single-backslash escape emits broken JavaScript. The existing parse
  test stays the guard.
- **Do not key pipeline empty on comps.** A watched market with a waiting
  lead must show the table even when the book is empty. That is the bug
  this page exists to close.

## 6. Tests

`test/vault-first-run.test.js` is retitled in comment to "empty workspace"
and rewritten:

- still exactly one `<input type=file>`
- `#bookPick` and `#pick` both open that input
- `#firstRun` is absent
- `#trustLine` ships without `hide`
- both decks ship without `hide`
- `#bookEmpty` ships visible; `#addSec` still ships closed
- `#pipeEmpty` ships visible; `#pipeTableWrap` ships hidden
- exactly one `#covForm`; `placeCovForm` or the equivalent mover exists
- `applyFirstRun` still keys on comps AND uploads
- the privacy disclosure still names the extract vendor (now under
  `#bookEmpty`, not `#firstRun`)
- picker copy still says "Choose a spreadsheet or PDF"
- emitted page script still parses

`test/vault-page.test.js`:

- a boot with comps hides `#bookEmpty` in the runtime path that the
  harness can see (string-assert `applyFirstRun` no longer assigns
  `deck hide` / `trust hide` / `firstRun`)
- `renderPipeline` hides `#pipeEmpty` when a lead or BOV is present
- coverage-only (chips, no rows) does not hide `#pipeEmpty`

No server tests. No new migration.

## 7. Out of scope

- Opening `+ Add comps` or `+ Log a BOV` by default on day one
- Showing the five-cell pipeline strip at all zeros (the trust line is
  the empty scoreboard; the strip waits for a row)
- Changing first-run key to include coverage, leads, or BOVs
- Any visual restyle of the filled vault
- Mobile layout beyond the existing `.form` / `.tw` behaviour
