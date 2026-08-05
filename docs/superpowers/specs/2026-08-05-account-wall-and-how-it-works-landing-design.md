# Account wall: /how-it-works becomes the front door

Date: 2026-08-05
Status: approved (owner, in-session)

## Problem

CompNinja is open to anonymous visitors. A new arrival lands on `/`, which is
the application itself: hero, search form, Market Explorer. Since 2026-08-03
`GUEST_SEARCH_LIMIT` gives that visitor one free report search and then asks for
a free account, which is a signup funnel rather than a paywall.

The owner wants the funnel moved to the front of the visit rather than one
search into it. A new customer should meet the explanation of the product
first, on `/how-it-works`, and should have an account before the application is
reachable at all.

Two smaller defects fall out of that goal:

1. `/how-it-works` has no authentication user interface of any kind. Its header
   carries only the Explore dropdown, so a visitor sent there has no way to
   create an account without navigating back into the application.
2. Its closing call to action links to `/`, which under a wall would bounce the
   visitor straight back to the page they are standing on.

The owner also asked to drop the red `HOW IT WORKS` kicker above that page's
headline, which is redundant once the page is the front door rather than a
destination reached from a nav item.

## Goal

An anonymous visitor to compninja.co sees `/how-it-works`, with clear controls
to create an account or log in, and cannot reach the search form or spend a
billed search until they have an account. One environment variable reverses the
whole thing.

## Non-goals

- **The Market Explorer's guest hole.** `POST /api/explore-market` runs the same
  billed pipeline with no account check. That is real and already has an
  approved design and plan
  (`docs/superpowers/plans/2026-08-05-explorer-guest-gate-and-progress.md`);
  it ships as its own change immediately after this one. Once `/` is walled the
  Explorer widget is unreachable anonymously, so what survives here is a
  direct-POST spend hole, not a funnel hole.
- **Pricing, plan gating, and entitlements.** Untouched. This changes who may
  reach the application, not what they get once inside.
- **The content of `/how-it-works`** beyond the kicker, the header, the hero
  buttons, and the closing call to action. The stat strip, sample exhibit,
  method steps, and FAQ stay exactly as written.

## Accepted trade-off

This trades all anonymous traffic for signups. Market page calls to action,
shared report links, and organic search results now funnel through a signup
form, and visitors who would have run one free search and been convinced will
bounce instead. The owner accepts this. `ACCOUNT_WALL=off` reverses it in one
environment change, and `/admin` already records a PII-free `signup_gate`
analytics event on every block, so the cost is measurable rather than guessed.

## Design

### 1. One lever: `ACCOUNT_WALL`

A new environment variable, `on`/`off`, **default on**, logged at startup beside
the existing guest-cap line and in the same style.

When on, it **forces `GUEST_SEARCH_LIMIT` to 0**. The two settings are not
allowed to disagree: a wall that is up while `/api/comps` still hands out a free
search is the one inconsistent state worth designing out, and it would be
invisible in testing because both halves would look correct in isolation. When
`ACCOUNT_WALL` is off, `GUEST_SEARCH_LIMIT` resumes its own configured value and
the deployment behaves exactly as it does today.

Existing bypasses are untouched: administrators and `x-admin-key` callers skip
the guest gate as they always have, so `gen-market-seed.js` keeps working.

### 2. Routing (server.js)

`GET /` and `GET /desk` with no `cn_session` cookie **present** return 302 to
`/how-it-works`.

Cookie presence only, never `getSessionUser()`. That helper performs a database
read, and putting one on the home route would add a query to every page view.
Presentation and enforcement are already separate in this codebase, and this
follows that split: a forged `cn_session` value buys the sight of a locked
search form and nothing else, because the guest gate in `/api/comps` still
refuses the search.

The redirect is **302, not 301**. The content at `/` genuinely depends on
authentication state, and a permanent redirect would be cached by browsers past
the point where the visitor has an account.

Exempt from the redirect:

- `/?auth=signup` and `/?auth=signin`, so the account modal has somewhere to
  live. index.html is the only place that modal exists.
- `/r/<id>`, the shared report viewer. Shared links staying public is the whole
  point of the share feature.
- Every server-rendered page: `/markets`, `/market/<slug>`, `/brokers`,
  `/how-it-works`, `/terms`, `/privacy`, `/broker/<slug>`, plus `/healthz`,
  `/robots.txt`, and `/sitemap.xml`. The administrative dashboards keep their own
  `ADMIN_KEY` gate and are unaffected.

The root handler already matches on the path with the query string split off,
which is what makes `/desk?checkout=success` and `/?utm_source=...` work. The
guard sits inside that same handler and reads `auth` off the query string, so
campaign parameters keep resolving.

### 3. `/how-it-works` (server.js, `renderHowItWorksHTML`)

- Remove the red `HOW IT WORKS` kicker above the `h1`. The `THE REPORT`,
  `METHOD`, and `QUESTIONS` kickers stay; only the one at the top goes.
- The header gains **Log in** as a text link and **Create account** as a red
  button, sitting to the right of the Explore dropdown. This mirrors
  index.html's header, where `Sign in` is a plain control rather than a button.
- The hero gains one primary **Create a free account** button below the lead
  paragraph, with an "Already have an account? Log in" text link beside it.
- The closing call to action changes from "Run a free report" to **Create a free
  account**, pointing at `/?auth=signup`.

Every one of these is a static `href`, which matters: the page is served with
`cache-control: public, max-age=3600`, so nothing on it may vary per visitor. A
signed-in visitor who follows one of these links simply gets the application
with no modal, because the modal only opens for a visitor without a session.

`HOW_CSS` gains a rule for the header button. It already carries `.btn` for the
closing call to action, so the new rule is a smaller variant of that, not a new
colour or type treatment.

### 4. The application lock (index.html)

`refreshAccountUI()` is already the single owner of what is visible to a
signed-in versus signed-out visitor, in the same way `refreshBillingUI()` owns
every billing control. The lock goes there and nowhere else.

With no `currentUser`, `#searchSection` is replaced by a short card carrying the
same two controls, following the existing `#deskSignIn` card's shape and copy
register. With a user, the form returns. This means:

- A visitor who reaches `/?auth=signup` and dismisses the modal sees a locked
  card explaining what to do, not a dead page.
- A shared report at `/r/<id>` renders in full for a signed-out viewer, with the
  locked card above it. A shared link becomes a signup funnel rather than a
  leak.

A new `?auth=signup|signin` query handler opens the account modal on load, in
the same bootstrap block that already honours `#reset=<token>`. It runs after
`/api/account/me` resolves, so an already-signed-in visitor gets no modal.

### 5. Search engines

`/` stops being the URL Google indexes, so its structured data and sitemap entry
follow the content:

- The `WebApplication` JSON-LD block in index.html's `<head>` moves into the
  `@graph` on `/how-it-works`, joining the `WebPage` and `FAQPage` entries
  already there. That page becomes the one crawlable description of the product.
- `sitemap.xml` drops `/` while the wall is on, conditionally, so
  `ACCOUNT_WALL=off` restores it. Listing a URL that redirects is a soft error
  in Search Console.

`/how-it-works` is already `index, follow` with a canonical, an Open Graph
block, and a description, so it needs no new metadata to carry this role.

## Testing

`test/routes.test.js` boots a real server as a child process, which makes it the
right home: the whole point of this change is that the gates are wired to the
routes, not correct in isolation.

With `ACCOUNT_WALL=on` and no cookie:

- `GET /` returns 302 with `location: /how-it-works`
- `GET /desk` returns 302
- `GET /?auth=signup` returns 200 and serves index.html
- `GET /r/<id>` returns 200
- `GET /how-it-works`, `/markets`, `/brokers`, `/terms`, `/privacy` return 200
- `GET /sitemap.xml` does not list the bare `/`
- `POST /api/comps` without a session is refused with `signin_required`, proving
  the forced `GUEST_SEARCH_LIMIT=0` took effect

With `ACCOUNT_WALL=off`:

- `GET /` returns 200 and serves index.html
- `GET /sitemap.xml` lists `/` again

A `cn_session` cookie of any value satisfies the routing layer by design, so one
test pins that too: a request carrying a junk cookie reaches index.html at `/`
and is still refused at `/api/comps`. That is the presentation-versus-
enforcement split written down as a test rather than a comment.

## Devlog

One entry in `devlog.json` in the same commit, type `feature`, recording that
the site became account-only and that `ACCOUNT_WALL=off` reverses it.

## Rollout

1. Merge and deploy. The wall is live on arrival, since `ACCOUNT_WALL` defaults
   to on.
2. Watch `signup_gate` events and search volume on `/admin` over the first
   days. Blocked visitors and completed signups are both visible there.
3. If the trade lands badly, set `ACCOUNT_WALL=off` in Render. No redeploy, no
   code change, and the sitemap and guest cap both return to their previous
   behaviour on restart.

### Pulling the lever re-opens a known race

`ACCOUNT_WALL=off` also restores a latent double-spend window in the guest cap.
`guestGateFor()` reads the visitor's `used` count at the *start* of a request,
but `consumeGuestSearchFor()` writes the incremented count only *after* the
billed Anthropic call returns, 40 to 70 seconds later. Concurrent anonymous
requests therefore all pass the gate before any consumption lands, and each
spends a billed search against a one-search allowance.

The wall does not fix this, it makes it unreachable: at a forced limit of 0,
`used >= 0` is always true, every anonymous request is refused at the gate, and
the consumption path never runs. The window exists only while the limit is 1 or
more, which is to say only with this lever off.

Judged not worth fixing on 2026-08-05, on these bounds:

- `rateLimited(clientIp(req))` runs *before* the gate on `/api/comps` and is
  synchronous (it pushes then checks), so a burst is capped at 10 per IP per 5
  minutes.
- Every winner writes `used = gate.used + 1 = 1` and sets `cn_guest`, so the
  burst is one-shot per IP rather than a repeatable well.
- `DAILY_SEARCH_CAP` still bounds total spend, unchanged.

**Do not fix it by reserving on gate pass and releasing on failure.** A durable
reservation held across a 40-to-70-second call leaks on any restart, redeploy,
or missed release path, and a leaked reservation permanently burns an honest
visitor's free search. That is the exact rule the guest cap is built to protect
("a failed or refused search must never burn the visitor's free one"), and
Render redeploys on every push to `main`, so the leak is not hypothetical. It
trades a rare overspend for a rare silent failure of the signup funnel, which is
the more expensive direction.

The shape that does fit, if it is ever wanted: an in-memory in-flight `Set`
keyed by `ipHash`, released in a `finally`. No durable write, so a crash
releases it by definition. It matches the existing `exploreInFlight` pattern and
the single-instance assumption already documented above `recordGuestSearch`. The
open question is user-facing rather than technical, since it changes the gate
from "have you used it" to "are you using it", and telling a second tab "You've
used your free search" when they have not yet is its own small wrong.
