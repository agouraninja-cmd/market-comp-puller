---
name: design-drafts
description: Use when the owner asks for a draft, drafts, mockups, options, or a redesign of any CompNinja page or surface ("draft a design for…", "show me some options for the vault", "redesign the workspace"). Produces the standard drafts page, published as an Artifact, in the format of the Workspace drafts page.
---

# Design drafts for CompNinja

**Owner's standing rule (2026-09-25):** every design draft for CompNinja is
delivered as a published Artifact page in the format of the Workspace drafts
page, https://claude.ai/artifact/CqHmNs3iL5JWFDVmUJKT3c. `template.html`
beside this file is that page with its content swapped for `[placeholders]`.
Start from it, and do not redesign the wrapper for each draft. What changes
from one drafts page to the next is the content and the pictures.

This skill is for the step BEFORE building. Once the owner picks a draft,
build it into the real page with tests. The before-and-after pictures rule in
CLAUDE.md ("Design changes: before and after") then applies as usual.

## The page, top to bottom (keep this order)

1. **Header.** Kicker `CompNinja · <b>[Surface] redesign</b> · [Month Day]`,
   an H1 `Three drafts for the [Surface]`, and a lede with the problem in one
   or two plain sentences. The lede must also say in bold what the pictures
   are: the real page, on a test database, with a made-up firm, and nothing
   touches a real account.
2. **Draft cards** (A, B, C by default; two or four is fine), smallest change
   first. Each card has a short name, a one-sentence pitch, 3-4 bullets on what
   changes (including what an empty page gets), one honest **Trade-off:** line,
   and a `Show Draft X →` button.
3. **"See them on screen"** viewer:
   - a Situation switch with 2-4 states of the page;
   - a Screen switch: Desktop / Dark / Phone;
   - a "Next to today" checkbox;
   - thumbnail tabs for Today and each draft;
   - the ← → keys flip between them, and Phone mode shows all of them side by
     side.

   A one-line note under the switches says who each situation is.
4. **"Found while making these"**, a numbered list. It holds findings worth
   deciding on their own, plus the three confirmations: dark mode works, phone
   works, and these are prototypes that get built properly once picked.
5. **"How to pick".** Reply with a letter, like `Draft B`. Mixing is fine
   (give two concrete examples), and the page says what stays the same in
   every draft.
6. **Foot.** Capture widths, a note that the test data is made up, and any
   capture caveats (e.g. a stand-in font).

## The pictures

- **Real pictures of the real page, never hand-drawn mockups.** Each draft is a
  prototype layer on the running page: injected CSS/JS, or a throwaway
  worktree (`node scripts/worktree.js <name>`). Never build it on the shared
  checkout.
- **"Today" is always one of the sets.** It is the baseline every draft is
  judged against.
- **Situations** stress the design. Use first-run or empty, the typical state,
  and the busy state. For anything behind sign-in, boot `server.js` against
  `test/helpers/fake-supabase.js` and seed through the ordinary routes, the way
  `scripts/firm-sandbox.js` does. Then capture with a `cn_session` cookie,
  because `scripts/shot.js` cannot sign in. Spend nothing: blank the API keys,
  as the sandbox's boot helper does.
- **Screens.** Desktop is 1440px wide. Dark emulates
  `prefers-color-scheme: dark` at the same width. Phone is 390px wide. Always
  emulate `prefers-reduced-motion: reduce` (shot.js explains why: reveal
  animations otherwise leave blank bands). Open any `<details>` that holds
  copy. Find the browser with `desktop.js`'s exported `findBrowser`, the way
  shot.js does. Never keep a second copy of that lookup.
- **File names:** `img/<draft>-<situation>-<screen>.png`, where draft is one of
  `today`, `a`, `b`, `c` and screen is one of `desk`, `dark`, `phone`. The
  situation key must match the `SIT` keys and the `data-v` values in the
  template. Publish them with the Artifact tool's `files` map.
- Capture scripts are throwaway. Keep them in the scratchpad, not the repo,
  unless the owner asks to keep one.

## Writing the page

- **Plain English for a non-programmer.** Use short sentences and say what a
  person sees. Page copy never names a file, a class, a function or a route.
  Findings can name a URL a person can visit (e.g. /run-report).
- Use the site's own words: Workspace, firm, Comp report, Vault, Market
  explorer. Use its own colours, which are already the template's `:root`
  tokens (theme.js values, light and dark), so no draft needs a second palette.
- CLAUDE.md's copy rules hold in drafts too. We *connect you with* a local
  broker and never claim to be one. A valuation is an automated estimate, never
  an appraisal. A draft that breaks either rule is not a draft the owner can
  pick.
- Be honest about what is a prototype and what each draft costs to build.

## Publishing

- The Artifact tool's rules still apply: load `artifact-design` before writing
  the page, write it in the scratchpad, and give a first publish an `icon`
  (`layout`).
- **One artifact per design question.** A revision of the same drafts (new
  pictures, a Draft D, a mix the owner asked for) republishes to the same URL.
  A new surface gets a new artifact.
- Send the owner the link. Name the drafts in one line each and point at the
  finding that most needs their decision. Don't restate the page.
