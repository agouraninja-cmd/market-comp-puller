# Workspace drafts (2026-09-25)

Three drafts for making the Workspace (`/desk`, `/` for a member) better to
look at, above all when it is empty. The owner picks one; nothing here ships
until then.

**The comparison page:** https://claude.ai/artifact/CqHmNs3iL5JWFDVmUJKT3c
(private to the owner until shared). It shows today's page and each draft for
three accounts — a new free account, a Pro member with an empty firm, and a
busy firm — at desktop width, in dark mode, and at phone width.

## What is in this folder

These are **prototypes, not product code.** Each draft is a script injected
into the real page before its own scripts run: it copies the page's boot
payload (`window.DESK_BOOT`), waits for the desk's one paint, then adds a
stylesheet and rearranges the DOM. That made it possible to photograph the
real Workspace with real data under each draft without editing `index.html`.
The chosen draft gets rebuilt inside `index.html` properly, with tests and the
standing before/after pictures.

| File | What it is |
|---|---|
| `common.js` | Shared helpers: the boot-payload copy, the greeting, line icons, `whenDesk()`. |
| `draft-a.js` | **A, Welcome desk.** Same layout. Greeting over the date and firm; a setup checklist that ticks itself off from real data and goes away when done; empty sections as an icon, a headline and one button; zeros in the strip step back. |
| `draft-b.js` | **B, The navy band.** A `--slab` band (dark in both themes, like the footer) with the logo's red stripe: greeting, one sentence on what needs you, and the four figures in large white type. An empty workspace gets three large doors on the band; section heads get colour chips; empty sections are dashed slots. |
| `draft-c.js` | **C, Your city, pictured.** The firm's home market photograph (the licensed, credited `market-heroes/` files) with the greeting on it and the figures as cards on its lower edge. No market yet means a drawn contour banner, never another city's skyline. Empty sections show a faint preview of their rows. Type tags in the buildings table. |
| `capture.js` | Boots `server.js` against `test/helpers/fake-supabase`, seeds a made-up firm through the routes, and captures `/desk` signed in, with or without a draft. |

## Regenerating the pictures

```bash
cd docs/designs/2026-09-25-workspace-drafts
node capture.js --out ../../../screenshots/ws-today
node capture.js --out ../../../screenshots/ws-a --draft draft-a.js
node capture.js --out ../../../screenshots/ws-b --draft draft-b.js --dark
node capture.js --out ../../../screenshots/ws-c --draft draft-c.js --sizes 390x844
```

It spends nothing (no search runs; mail is off) and writes only to the
git-ignored `screenshots/`. On Linux, install Inter and a Georgia look-alike
(Gelasio, aliased to Georgia in fontconfig) first, or the pictures render in
DejaVu and do not look like the site.

## Found while making these

A free member has no visible way to run a report: `/bulk` answers "The Comp
report tool is part of Pro", and `/run-report` is linked from nowhere. The
new-account versions of all three drafts point to Market explorer and Permit
tracker for that reason. It is a product decision separate from the pick.
