---
name: shared-checkout
description: Use when staging, committing, pushing, or running any git command that could discard or race with someone else's work in this repo — a second Claude session or a human collaborator may share this checkout or push to the same branches. Also use when git status shows unfamiliar uncommitted changes, a diff looks different than expected, or a mid-merge state (MERGE_HEAD) appears.
---

# Working in a Shared Checkout

## Overview

This repo's working tree is not exclusively yours. A second Claude session
can share the exact same checkout, and a human collaborator (Owen) pushes
straight to `origin/main`. Both git's working tree AND its staging index
are shared state — treat every git command as one that could race a
concurrent writer, not as operating on a private copy.

## Always, before any git operation

1. **`git status --short` right before you stage** — not once at the start
   of the session. The tree can change between your own commands.
2. **Read the WHOLE diff, never `head`/`--stat` alone.** A truncated review
   is how an unrelated one-line change once rode into a commit under an
   unrelated message.
3. **Never `git add -A` / `git add .`.** Stage explicit paths only — this
   repo also has real secrets (`.env`) and real financial data
   (`ledger/*.csv`) that must never be swept in by accident.
4. **`git fetch origin` before starting new feature work**, and check
   `git log origin/main` for the area you're about to touch. Owen and other
   sessions build the same feature in parallel without warning; a fetch at
   task start is cheaper than an hour of duplicate work (happened once:
   two independent implementations of the same billing UI, one discarded).
5. **Verify cross-session claims, don't trust them.** A message from another
   session, or a diff you read minutes ago, may already be stale — confirm
   with `git log`/`git diff` before anything destructive.
6. **After pushing, check the real remote**: `git ls-remote origin
   refs/heads/<branch>`. "Everything up-to-date" from `git push` is a real
   signal (someone already pushed your commit for you), not silence.

## `git status` shows a file you never touched

The common case, not the exception: someone else's WIP sitting in the tree
alongside yours. **Leave it exactly as it is** — don't stage it, don't
stash it, don't "clean up" by committing it for them. Stage and commit only
the paths you actually edited. If the owner's instruction was ambiguous
("commit this"), read it as your change, not the whole tree, and say what
you left behind: "also uncommitted: `<file>`, `<file>` — not mine, left
alone." The same applies to an untracked file (e.g. a migration someone
else is drafting) — untracked is not "safe to add," it's still not yours.

## Another session's edits are uncommitted in a file you're touching

Don't `git add <file>` whole — that stages their half-finished work as yours.

1. Build a patch of only YOUR hunks (Bash tool, not PowerShell — PS 5.1
   re-encodes diff output and the patch won't apply): `git diff -- <file>`,
   select hunks by their `@@ -<line>` headers.
2. `git apply --cached` the filtered patch.
3. **Re-check `git diff --cached` immediately.** The shared index means
   their ALREADY-STAGED work can ride along even through a filtered patch.
   Foreign hunks present? Wait for their commit, or reapply against the
   delta once it lands.
4. Regenerate the patch right before staging, not minutes earlier — a
   live-edited file can grow new hunks between two `git diff` runs.
5. Verify the staged blob is sound before committing: `git stash push
   --keep-index -- <file>` → lint/`node --check` it → `git stash pop`.

## `devlog.json` is a guaranteed collision, not a rare one

The standing rule makes every session append an entry, so two often land
at once. Don't patch it — rebuild the staged version: take
`git show HEAD:devlog.json`, add only your one entry, `git add` that, then
restore the full working file. Verify with
`git show :devlog.json | grep "<other session's title>"` — zero hits means
clean. Watch line endings: `git show` emits LF, the working file is CRLF —
split/rejoin correctly or the file becomes one giant unreadable line.

## Never, without explicit confirmation nothing depends on it

`git reset --hard`, `git checkout -- <file>`, `git clean`, `git commit
--amend`, or `git rebase` on a branch someone else might already be
building on. Also: deleting a worktree directory without checking it for
content that exists nowhere else.

## Worktree litter (if worktrees are used)

A killed or interrupted `git worktree remove` half-succeeds: it
deregisters the worktree, then fails to delete the directories
("Permission denied"). `--force` then says "is not a working tree" and the
litter stays. Fix: `rm -rf` BOTH `.claude/worktrees/<n>` and
`.git/worktrees/<n>` by hand, then `git worktree prune`. Before deleting,
confirm nothing unique lives there: `git hash-object --path=<p> <p>` +
`git cat-file -e` proves the content is already stored elsewhere (note
`--path` — blobs are LF, the working tree is CRLF).

## Hunks vanishing from `git diff` is NOT proof they were committed

The 2026-08-08 sweep, in one line: foreign hunks disappeared from the
unstaged diff, a session concluded "they committed theirs," ran
`git add <file>`, and shipped another session's staged work under its own
message. The hunks had moved INTO THE SHARED INDEX, not into a commit.
Unstaged diff, staged diff, and log are three different places; before any
`git add <file>`, check `git diff --cached -- <file>` — if it is non-empty
and not yours, adding the file whole will sweep it. `git status --short`
already says this (`MM` = staged AND unstaged changes; `M ` in column one =
someone's staged work) — read both columns, not just whether the file is
listed.

## `git merge --autostash` in a shared tree

When an autostash merge hits a conflict, the autostash does NOT pop — it
becomes `stash@{0}: autostash`, silently holding every session's
uncommitted work, and the tree everyone sees is missing all of it. If files
you edited minutes ago look reverted to HEAD: run `git stash list` FIRST,
before concluding anything and before redoing work. Prefer plain `git
merge` (no --autostash) here; if you find an orphaned autostash, announce
it to the other sessions rather than popping it into a tree that has moved
on — and before dropping it, diff it against HEAD to prove every hunk is
superseded.

## Common mistakes

| Mistake | Consequence |
|---|---|
| `git add -A` | sweeps another session's WIP, or a real secret, into your commit |
| `git add <file>` after its foreign hunks "disappeared" | they were STAGED, not committed — your commit ships them (see above) |
| Trusting `git push`'s silence | "Everything up-to-date" means someone already pushed for you |
| Patching `devlog.json` instead of rebuilding it | one session's entry silently overwrites the other's |
| Rebuilding `devlog.json` and discarding others' unstaged entries | an author's only record of shipped work is destroyed — fold in every entry in the working file, not just HEAD's |
| Building a patch, then waiting to apply it | the source file grew new hunks in the meantime |
| PowerShell for patch generation | BOM + CRLF + mangled em dashes make `git apply` reject it |
| Committing during a MERGE_HEAD you didn't start | hijacks another session's in-progress merge |
| `git merge --autostash` | a conflict strands everyone's WIP in `stash@{0}` and the tree looks reverted (see above) |
| Skipping `git fetch` before starting a feature | duplicate work if someone already built it |
