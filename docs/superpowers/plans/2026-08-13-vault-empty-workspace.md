# Vault Empty Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an empty `/vault` the same two-deck workspace as a full one, with invitations instead of numbered first-run cards.

**Architecture:** Delete `#firstRun`. Both decks and the trust line ship visible. `#bookEmpty` / `#pipeEmpty` are the empty bodies. `applyFirstRun` still keys on comps+uploads but only toggles the book invitation vs the comps table. `renderPipeline` owns pipeline invitation vs table and moves the one `#covForm` node.

**Tech Stack:** `vault-page.js` (one HTML+CSS+JS template literal), `node:test`, zero npm deps.

## Global Constraints

- Zero npm dependencies; `npm test` is `node --test`.
- The whole vault page is one template literal — no stray `${`, no single-backslash JS escapes.
- Exactly one `<input type=file>` and exactly one `#covForm`.
- No new endpoint, table, or migration.
- Copy locked in the spec: book “Upload closed deals…”, pipeline “Watch a market…”, privacy disclosure unchanged.
- `+ Add comps` and `+ Log a BOV` stay closed on day one.
- Trust line shows zeros. Pipeline strip stays hidden until a row exists.
- Shared checkout: never `git add -A`; new work on a branch off `origin/main`.

---

### Task 1: Failing tests for the empty workspace

**Files:**
- Modify: `test/vault-first-run.test.js`
- Modify: `test/vault-page.test.js` (pipeline empty-state + mapper first-run tests)

- [ ] Rewrite `test/vault-first-run.test.js` so it pins: no `#firstRun`; `#trustLine` and both decks ship without `hide`; `#bookEmpty` / `#pipeEmpty` visible; `#bookPick` and `#pick` open the one file input; `applyFirstRun` still keys on comps AND uploads; extract-vendor copy lives under `#bookEmpty`; script still parses.
- [ ] In `test/vault-page.test.js`: drop `#noPipe` assertions; empty pipeline shows `#pipeEmpty` not an empty table; a BOV/lead hides `#pipeEmpty`; coverage-only does not; mapper cancel restores `#bookEmpty`; applyFirstRun no longer assigns `pipeSec` / `deck hide` / `firstRun`.
- [ ] Run `npm test` — those tests FAIL.

### Task 2: Markup, CSS, applyFirstRun, renderPipeline

**Files:**
- Modify: `vault-page.js`

- [ ] Remove `#firstRun` / `.steps` / the dead `#firstRun ~ #leads` CSS. Add `.invite`. Ship `#trustLine` as `class="trust"`, decks as `class="deck"`. Insert `#bookEmpty` under `#deckBook` and `#pipeEmpty` (with `#covForm` inside) under the pipeline rule. `#covBox` ships `dbox hide`. Remove `#noPipe`. Rename `#frPick` → `#bookPick`. Give the pipeline subtitle `id="pipeIntro"`.
- [ ] `applyFirstRun` only toggles `#bookEmpty` vs `#compsSec`/`#importsSec`. No deck/trust/`pipeSec`/`#covForm` moves.
- [ ] `renderPipeline`: `pipeInvite = !all.length && !errs.length`. Toggle `#pipeEmpty`, `#covBox`, `#pipeIntro`. `placeCovForm` appends `#covForm` into `#pipeEmpty` or `#covBox`. Hide `#noPipe` path by deleting it.
- [ ] Mapper/PDF hide `#bookEmpty` instead of `#firstRun`. `$("bookPick").click` → `$("file").click()`.
- [ ] Run `npm test` — green.

### Task 3: Docs

**Files:**
- Modify: `CLAUDE.md` (Direction U first-run bullets → empty workspace)
- Modify: `devlog.json` (one 2026-08-13 entry)
- Modify: `docs/superpowers/specs/2026-08-13-vault-pipeline-deck-design.md` §2/§7 first-run lines, point at the new spec

- [ ] Update those three files to match the shipped empty vault.
- [ ] Run `npm test` again.
