---
paths:
  - "ship-board.js"
  - "scripts/ship-chat.js"
  - ".github/workflows/ship-chat.yml"
  - "test/ship-*.test.js"
---
# The nightly shipped post

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

### The nightly shipped post (Google Chat)

`.github/workflows/ship-chat.yml` posts to the **Developer thread** of the
team's CompNinja Chat space at midnight Boise time: Jacob's, Owen's and
Chuck's commits for the day that just ended, as Chat text, with a button to
the **shipped board at `/dev/shipped`** — the day, a line chart of the current
14-day period (fixed periods from Thursday 2026-09-24, the first post's day, so
it starts over every other Thursday) and the day's PRs. The post carried the
card as a PNG for one day; Chat shrinks a picture to a phone's width until it
is unreadable, so the board replaced it and a test now fails on `imageUrl`.
Every post replies into that one thread via `THREAD_KEY`; the thread's
opening message was posted once with the workflow's `start_thread` switch,
which must not be pressed again (`skip_post` saves a day without posting).
Rules and the page's markup live in the pure **`ship-board.js`**, shared by
**`scripts/ship-chat.js`** and server.js so the post and the board cannot
disagree; tested in `test/ship-chat.test.js`, and the route against a real
server in `test/ship-board-route.test.js`. The board is **team-only**, behind
`ADMIN_KEY` or its `cn_admin` cookie exactly like `/dev` (404 when the key is
unset), and it reads the day the job saved as `days/<YYYY-MM-DD>.json` on the
**`ship-charts` branch** through raw.githubusercontent.com — no GitHub token on
the server, since the repo is public. It steps back past a day not saved yet
and says so, and a failed read renders "unavailable", never zeros.
`SHIP_BOARD_BASE` is **test-only** (`RESEND_API_URL`'s precedent). `node
scripts/ship-chat.js build --out DIR --day YYYY-MM-DD` writes any day's
`model.json` and `board.html` locally with the `gh` sign-in you already have.
Three counting rules, each
there because the obvious version is wrong: credit goes to the **PR's author
login** (every one of us commits under several names, and cloud sessions
commit as "Claude"); a person's count is their PRs' **non-merge commits**, never
commits on main (Owen squash-merges, the owner merge-commits); and a day is a
**Boise day** (most merges land 01:00–06:00 UTC). The cron fires at both
candidate UTC hours and the script posts from the one matching the season; the
test walks two years of nights to hold that to one post each. Needs the
`GOOGLE_CHAT_WEBHOOK_URL` repository secret and fails loudly without it. The
day is saved BEFORE the post so the button never opens yesterday; a failed
save still posts, then fails the job. `ship-charts` is one parentless commit,
force-pushed nightly, newest 120 days. Never merge that branch. Adding a
person is one row in `PEOPLE` (in `ship-board.js`).
