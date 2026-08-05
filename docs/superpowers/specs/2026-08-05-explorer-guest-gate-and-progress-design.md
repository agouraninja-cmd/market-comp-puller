# Market Explorer: close the guest-cap bypass, stream the build

Date: 2026-08-05
Status: approved (owner, in-session)

## Problem

Two independent defects in the Market Explorer (`POST /api/explore-market`,
server.js; the dropdown widget in index.html), both traced 2026-08-05.

### 1. The Explorer bypasses the guest search cap

`GUEST_SEARCH_LIMIT` (live since 2026-08-03) gives an anonymous visitor one
free report search, after which a free account is required. It is enforced in
`/api/comps` and reported by `/api/config`, and nowhere else.

`/api/explore-market` runs the same billed Anthropic pipeline through the same
`getComps()`, at roughly the same measured cost per search ($0.36), and has no
guest check at all. Its only protections are a 3-per-15-minutes per-IP limiter
and the shared `DAILY_SEARCH_CAP`.

The consequence is both a spend hole and a funnel hole. An anonymous visitor
who has spent their one free report can stay on the homepage and keep
triggering billed searches, three per fifteen-minute window, indefinitely. The
Explorer is also the most discoverable way around the signup gate: it sits on
the same page, it is free, and it answers the same underlying question about a
market. A gate that the page it lives on routes around is not a gate.

Note what is *not* broken: `getMarketPage(slug)` short-circuits an
already-covered market before any limiter, so browsing existing pages is free
and costs nothing upstream. That behavior is correct and must survive.

### 2. The 30 to 60 second build is silent

`explore()` in index.html writes one static line ("Building the ... snapshot,
checking recent sales. Usually 30-60 seconds."), disables the input, and then
shows nothing at all until the fetch resolves and the browser hard-navigates.

Meanwhile `/api/comps` has full live progress: `openSse` + `sseFrames` on the
server, `readProgressStream` + `applyProgress` on the client, driving a loading
card that shows the model's real search queries, result counts, drafting
progress and comps as they are written. The measurement behind that work
applies unchanged here, because it is the same call: the web searches finish in
the first few seconds and the model then spends 40 to 70 seconds writing. The
Explorer asks a visitor to stare at a frozen dropdown for that entire stretch.

Disabling the input is a second, smaller defect: it moves focus off a disabled
element mid-flow, and the `exploring` flag that guards `hide()` and `render()`
is carrying accessibility weight it was not designed for.

## Goal

Bring `/api/explore-market` to parity with `/api/comps` on the two axes where
it silently diverged: who is allowed to spend money, and what the visitor sees
while it is being spent. No change to what the Explorer produces, to market
page content, or to how covered markets are browsed.

## Non-goals

The other Explorer improvements identified in the same review are explicitly
out of scope here: query-parsing synonyms and full state names, the 422
dead-end, putting the widget on `/markets`, market page staleness, in-memory
preview durability, near-duplicate market slugs, and dropdown keyboard
navigation. Each is separable and several are larger than these two combined.

## Part 1: the guest gate

### Decision

An Explorer build consumes the **same single allowance** as a report. An
anonymous visitor gets one free billed search in total, report or market page,
and then sees the free-account modal. Rejected alternatives: requiring sign-in
before any build (strictest on spend, but it removes the anonymous taste of the
feature that earns the account), and a separate per-feature allowance (gentler,
but it doubles worst-case anonymous spend per IP and adds a second ledger).

### Placement

Inside the route, in this order. Only step 3 and step 5 are new.

1. Password gate, body parse, type/state/city validation. Unchanged.
2. `getMarketPage(slug)` short circuit for an already-covered market.
   Unchanged, and deliberately still **above** the gate: browsing a market page
   that already exists is a database read, costs nothing upstream, and must
   never burn an allowance, show the modal, or block a crawler.
3. **New:** `const guestGate = await guestGateFor(req)`. When
   `guestGate.blocked`, log a `signup_gate` analytics event carrying
   `prop_type` and `market` (city + state only, PII-free, as today) plus
   `source: "explore"` to distinguish it from the report gate, set the
   `cn_guest` cookie when it is not already spent, and answer
   `403 { error, signin_required: true }`.
4. Per-IP explore limiter, `API_KEY` presence check, the in-flight job.
   Unchanged.
5. **New:** consume the allowance after the job resolves, and **only when the
   job actually served a result** (HTTP 200, whether the outcome was a
   published page or a thin-data preview). A 422 thin market, a 429 daily cap,
   or an upstream failure must not burn the free search. This mirrors
   `/api/comps`, where consumption sits at each serving exit rather than at
   the top of the handler.

### Why the three bypasses come for free

`guestGateFor` already returns `null` when the gate is off
(`GUEST_SEARCH_LIMIT=off`), when any account is signed in, or when the caller
is an admin by `x-admin-key` header or `cn_admin` cookie. Reusing it rather
than re-deriving the checks is the same rule the codebase applies to
entitlements: one resolver, no scattered copies.

### Concurrency

`exploreInFlight` deduplicates concurrent requests for one slug into a single
job, so two visitors can share one billed search. Each must still spend their
own quota, because each has their own IP hash. This falls out of the structure
rather than needing special handling: the gate is read per request before the
join, and consumption happens per request in its own scope after `await job`.

### Cookie and status code

The 403 is always plain JSON with a real status code, never an SSE frame. It
is a fast, failed exit, and the existing rule is that everything fast or failed
answers as JSON so the client picks its reader off the response content-type.

`setGuestCookie` can only run while headers are unsent. On the streaming path
the headers are already open by the time a build succeeds, so the cookie is not
set there; `/api/config` syncs it on the next page load, exactly as it does for
`/api/comps`. The ledger keyed by `sha256(IP)` is the durable half either way.

### Client

`explore()` in index.html gains the `signin_required` branch the report path
already has: on a 403 carrying that flag, clear the exploring state, re-enable
the input, mark the local `guestSearch` state spent so the form hint updates,
and call `openAcctModal("signup", ...)` with Explorer-appropriate copy. It is
an ask, not an error, so it must not render in the red error row.

## Part 2: streaming the build

### When the stream opens

`POST /api/explore-market` accepts an optional `stream: true` in the body, the
same convention `/api/comps` uses.

Everything fast or failed stays plain JSON with a real status code: the
password gate, validation, the covered-market short circuit, the guest gate,
the per-IP limiter, the missing-API-key error, and a **cache hit**.

The cache hit is the one that shapes the design. Its lookup lives inside the
shared in-flight job, so at the moment the response headers must be chosen the
handler cannot yet know whether this request is fast or slow. Rather than
restructure the job or duplicate the cache read, the SSE opens **lazily on the
first progress event**:

- The job emits progress only once it is genuinely about to make the billed
  Anthropic call.
- The handler's progress forwarder calls `openSse(res)` on the first event it
  receives, and forwards every event after that.
- A job that resolves without ever emitting (a cache hit) finds `sse` still
  null and answers with `sendJson`.

So the existing "only once the slow leg is actually about to run" rule is
enforced by the structure rather than asserted by a comment.

### Fan-out to concurrent explorers

`exploreInFlight` currently maps slug to a bare promise. It becomes an object
holding the promise, a `Set` of listener callbacks, and a bounded `log` of
events already emitted. The job pushes each event to the log and forwards it to
every current listener; a request joining an in-progress job replays the log
first, so a late joiner sees a coherent stream rather than starting mid-build.
The log is capped so a long build cannot grow it without bound. Listeners are
removed when their request ends.

### Events

`getComps()` already accepts an `onProgress` callback, so no new server
plumbing is needed. The Explorer passes one where it currently passes nothing,
and reuses the existing phases unchanged: `start`, `search`, `results`,
`writing`, `drafting`, `comp`, `retry`.

No `guardComp` equivalent is required. That closure exists in `/api/comps` to
anonymize comps past a free visitor's entitlement so gated identities never
reach the browser. Market pages publish their comps publicly by design, and the
Explorer's output is not comp-gated, so there is nothing to withhold.

### Terminal frames

Once the SSE is open there is no status code left to send, so the job's outcome
is delivered as a frame instead: a 200 finishes with a `result` event carrying
the same `{ url, slug, published, ... }` body the JSON path returns, and any
non-200 finishes with an `error` event carrying `{ error }`. The client's
existing error row handles the latter with no new UI.

### Client rendering

`readProgressStream` is refactored to take an `onProgress` handler, defaulting
to today's `applyProgress`. One SSE frame parser, two appliers. This repo
already carries two hand-synchronized duplicate pairs (`compWeight` and
`exportReportKey`), each with a warning comment explaining the cost; a third
copy of a frame parser is not worth adding.

The Explorer's applier renders into the existing dropdown, not into the report
loading card, and stays deliberately calm:

- A headline line that moves through the phases in plain language ("Searching
  recent sales", then "Building the page").
- A detail line carrying the model's real search text. It is model output, so
  it is written with `textContent`, never `innerHTML`, and truncated the way
  `applyProgress` truncates it.
- A thin progress bar.
- No per-comp lines. A `comp` event advances a found-count in the detail line
  at most; it does not add rows. The dropdown is small and the owner's standing
  preference is against busy, decorative UI.

The input is no longer disabled during a build. The `exploring` flag continues
to hold the dropdown open and suppress re-render, which is what it is actually
for.

### Fallbacks

The client branches on the response `content-type`, never on the fact that it
asked to stream. A non-SSE content type is read with `res.json()` as today.

No silence watchdog is needed. The dropdown's initial state is already the
static "Usually 30-60 seconds" line, so a stream that never produces an event,
because Render's edge buffered it despite `x-accel-buffering: no`, degrades to
exactly today's behavior with no extra code. This is a meaningful difference
from `/api/comps`, whose loading card animates and therefore needed an 8-second
watchdog to restart its simulation.

## Testing

`test/routes.test.js` boots a real server as a child process specifically to
prove gates are wired to routes rather than merely correct in isolation, which
is exactly the failure being fixed. Three cases, none of which touches
Anthropic (the bare environment has no API key, so passing the gate is
observable as the distinct "missing ANTHROPIC_API_KEY" 500):

1. With `GUEST_SEARCH_LIMIT=0`, an anonymous `POST /api/explore-market` for an
   uncovered market answers 403 with `signin_required: true`.
2. With the gate on, a request for a market page that already exists still
   answers 200 with its URL, proving the short circuit stays above the gate.
3. With `GUEST_SEARCH_LIMIT=off`, the same anonymous request gets past the
   gate.

`npm test` must stay green; nothing here touches the five pure modules, so the
existing suite is a regression check rather than a target.

## Risks

**A false 403 blocks a real visitor.** `guestGateFor` fails open on a ledger
read error by design, and that behavior is inherited unchanged, so a Supabase
outage widens access rather than blocking anyone. `DAILY_SEARCH_CAP` remains
the backstop on spend.

**Double-charging one visitor's allowance.** A visitor whose build fails must
not lose their free search. Consumption is placed at the served-result exit
only, and the thin-data preview counts as served because it cost a real search
and returns real content.

**The stream opening on a cache hit.** Guarded structurally: the SSE cannot
open before an event exists, and a cache hit produces none.

**Tailwind.** Any genuinely new utility class in the dropdown progress markup
needs `tailwind.css` regenerated, which the session hook does on an index.html
edit. Verify the new classes actually landed in the vendored file and commit it
alongside. Preferring classes already present in index.html avoids the issue.

## Devlog

Per the standing rule, both parts get a `devlog.json` entry in the same commit:
one `fix` for the bypass, one `improvement` for the live progress.
