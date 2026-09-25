---
paths:
  - "test/**"
---
# Writing tests

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Setup and standing rules

Nothing needs a real database or a real mail provider, only the route-level
files start a server, nothing calls anything external, and the whole run
finishes in a couple of seconds, so there is
no excuse for not running it after touching any of those rules.
**`test/helpers/fake-supabase.js`** is how the second half of that stays true
(2026-08-13): a stand-in PostgREST + Resend that lets a suite exercise the
paths which exist ONLY with a database. Most of this app degrades to a local
JSON file when Supabase is unconfigured, which is what makes the rest of the
suite free — but the features that deliberately have NO file fallback (the
vault, permissioned shares, the watchlist digest) are exactly the ones where a
mistake costs a broker their book or mails a stranger twice, and before this
they could only be tested up to "it refuses without a database".
`test/watchlist-digest-run.test.js` is the first user. Two rules: the fake
implements only the query shapes server.js actually sends and **400s on
anything else rather than matching everything** (a fake that matches
everything reports a user-scoped read as working while it returns another
account's rows); and it is a stand-in, not a Postgres, so a new query shape
means teaching it that shape deliberately, never loosening its parser.
It also owns **`waitForMail(db, want)`**, and every suite that reads its
`sent` array must go through it: the routes that mail hand the send to
`sendOutboundEmail` WITHOUT awaiting it, so `sent` fills in after the response
and a test reading it on the next line is asserting on a race it usually wins.
There were four hand-copied versions of that loop with three different budgets
(1.5s, 1.5s, 2s, 10s), and the short ones were the ones written first rather
than a decision about those routes. The one exception is the hub invitation,
whose sends ARE awaited (`emailed` is their own answer) — `test/hub-run.test.js`
says so where it reads `sent` with no wait. A wait is only half of it: the
suites must also assert that the REQUEST which should have caused the mail
succeeded, or an unrelated failure — a 503, a child server dying mid-run —
arrives as an empty recipient list and reads as a broken notifier.
**A subtest that touches the test context must DECLARE one** — write
`async (t) => {}`, never `async () => {}`. The argument-less form has no
context of its own, so a `t.after()` inside it (or a fixture helper it hands
`t` to) registers on the PARENT, and every server the block boots stays alive
until its LAST subtest ends, then shuts down in one burst. Nothing goes red;
the suite just runs with eleven idle server.js children and eleven stand-in
databases where it uses one, which is the load that makes boot.js's
spontaneous child death likelier and the burst a hung `node --test` was found
sitting in. Fixed once in PR #239 and again the next day in four more files
(2026-09-01, after `test/org-run.test.js` went intermittently red under load),
so it is a check now rather than a convention: **`test/subtest-teardown.test.js`**
scans every suite and fails the build on either shape. The difference between
right and wrong is one character and the suite is green either way, so a
person is the wrong detector for it.
Nothing beyond those modules and that route wiring is tested; do not assume a
green suite means the app works. CI (`.github/workflows/ci.yml`) runs on
every push: `node --check` on
the entry points, the test suite, and a bare-environment boot smoke against
`/healthz` — advisory on GitHub, but since 2026-08-08 the same checks also
gate the deploy itself: `npm start` runs a `prestart` script (`node --check
server.js`), so on Render an unparseable server.js exits before the server
listens and the previous green deploy keeps serving. That gate holds even
when Actions is down.

**`npm test` was removed from `prestart` on 2026-08-20**, after it broke
production deploys. It was written when the suite was about two seconds; it is
now 1731 tests taking **63 seconds on Render**, and several suites spawn real
child servers. On a 0.5-CPU Starter instance that is 63 seconds of saturated
CPU before the port is ever bound, re-run from scratch on every restart and by
every concurrent instance. Three deploys in a row died on
`Timed out after waiting for internal health check ... /healthz` while the
health checker fought the test suite for a core — and each failure restarted
the instance, which re-ran the suite, which made the next one likelier to fail.
`node --check` stays, because that is the failure the gate was actually
protecting against: a syntax error in server.js takes the whole site down at
boot. Correctness is CI's job, on every push, where it costs nothing to run it
twice. A red X on
GitHub Actions still means fix or revert now. **No result at all is not the same as
green**, and it happens: during a 7-hour Actions incident on 2026-08-06 GitHub
throttled webhooks to ~15% and four branches merged with no CI run ever
created. So the workflow also carries **`workflow_dispatch`** — a "Run
workflow" button on any branch, which is a direct API call rather than a
webhook delivery and therefore still works when pushes are being dropped. Use
it to get a verdict on a commit already on main without pushing an empty commit
to manufacture a webhook. The four checks can also be run locally in about two
seconds; that is what to do when Actions is down, rather than assuming.
