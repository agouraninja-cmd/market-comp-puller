---
paths:
  - "search-provider-*.js"
  - "report-parse.js"
  - "link-check.js"
  - "run-eval.js"
  - "eval-score.js"
  - "eval-set.json"
  - "scripts/compare-thinking.js"
  - "scripts/verify-gemini-stream.js"
  - "test/search-provider-*.test.js"
  - "test/report-parse.test.js"
  - "test/link-check.test.js"
  - "test/eval-score.test.js"
  - "docs/evals/**"
---
# The search pipeline

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `DAILY_SEARCH_CAP` — optional (default 150). Hard ceiling on *billed*
  Anthropic searches per UTC day; cache hits don't count. On the (cap+1)th
  search the server returns 429 to visitors and emails the owner once (via the
  same Resend notifier). An in-memory counter reset at UTC midnight and on
  process restart — a backstop against a rotating-IP scraper the per-IP limiter
  can't stop, not precise accounting.
- `STREAM_ANTHROPIC` — optional `on`/`off`, **default ON**. Streams the
  Anthropic call (`stream: true` + a hand-rolled SSE reader, `sseFrames` in
  server.js) instead of awaiting one JSON body. The parsed report is identical
  either way — the streaming branch rebuilds the text by concatenating
  `text_delta`s per block index and joining with `"\n"`, deliberately matching
  the non-streaming `content.filter(type==="text").map(.text).join("\n")` so
  `parseCompJson` sees the same input. Set it to `off` only to rule streaming
  out while debugging. **Careful if you touch the timeout**: with `stream:true`
  `fetch` resolves at the HEADERS, so `clearTimeout` must stay wrapped around
  the whole read loop or the call deadline silently stops guarding anything.
  The deadline is DERIVED per call (`searchTimeoutMsFor`: 30s slack + 10s per
  allowed search + 13ms per allowed output token — ~260s for a full 10-search
  10k-token report) so it always sits above the wall clock of a healthy call;
  a fixed constant was outgrown twice (100s, then 150s), and each time it
  aborted alive, already-billed calls into "took too long" errors.
  There is also a `STREAM_IDLE_MS` (30s) per-chunk watchdog, which only becomes
  possible once the response is streamed.
- **Live search progress** (no env var — always on for the browser). `POST
  /api/comps` **and `POST /api/explore-market`** take an optional `stream:
  true` in the body; when set, and only once the slow leg is actually about
  to run, the response switches to
  `text/event-stream` (`openSse` in server.js) emitting `progress` events then
  a final `result` (or `error`) event. **Everything fast or failed stays plain
  JSON with a real status code** — the password gate, both rate limiters,
  validation, and a 43ms cache hit — so the client chooses how to read the body
  from the response's `content-type`, *never* from the fact that it asked to
  stream. `gen-market-seed.js` simply omits the flag and is unaffected.
  Progress phases: `corpus` (coverage, before the call), `start`, `search`
  (n + the model's real query text), `results` (count), `writing`, `drafting`
  (chars, ~1/s), `comp` (one per finished comp as the model writes the array —
  `makeCompExtractor` in server.js scans the streamed text incrementally, and
  the handler's `guardComp` closure anonymizes events past the visitor's
  `maxComps` entitlement to `{ locked: true }` so gated comp identities never
  reach a free browser, even transiently), `retry`. Front-end:
  `readProgressStream` + `applyProgress` in index.html. Since 2026-08-09 the
  streamed events assemble the REAL report surfaces (`beginAssembly` /
  `assemblyComp` / `assemblySummary` / `resetAssembly`): the first `comp` or
  summary `field` event reveals `#results` with only the `data-assemble` cards
  visible (hero as a counts-only placeholder, never a dollar figure; summary;
  core-column comp table + "+ N more found · unlock with Pro" lock line),
  everything else hidden under `.asm-hidden` until `renderResults` repaints
  wholesale.
  Assembly never touches the `hidden` class except on
  `#results`/`#ownerHero`/`#loadingSkeletons`;
  every exit (result, error, `retry`) funnels through `resetAssembly` riding on
  `hideLoadingCard`. Three fallback layers, all
  load-bearing — the old wall-clock simulation still starts on submit and is
  cancelled by the first real event; a non-SSE content-type falls back to
  `res.json()`; and an 8-second silence watchdog restarts the simulation,
  which is what saves the card if Render's edge buffers the stream despite
  `x-accel-buffering: no`.
  **What the measurement showed** (worth knowing before optimizing anything
  here): the web searches finish in the first ~5 seconds; the model then spends
  **40-70 seconds writing the report**. Wall clock is roughly
  `4s x searches + output_tokens / 78`. Cutting *searches* therefore buys far
  less than it looks like it should — a corpus-strong 2-search run still took
  74s because it still had to write 4,700 tokens. **The lever is OUTPUT size.**
  Measured composition of a report: the `comps` array is 69-76% of it, and
  within that `notes` was by far the largest field (18-28% of the whole
  report, up to 466 chars on one comp), followed by `source_url` (~8-11%,
  not cuttable — it is the proof). Top-level, the four narrative fields
  (`summary`, `value_drivers`, `market_trend`, `price_discovery.note`)
  measured a combined 33% of one real report and got the same notes-style
  caps on 2026-08-03 (~450 chars / 80-per-entry / 140 / 200, banned
  patterns named, the summary's REQUIRED honesty caveats given a protected
  third-sentence slot — don't tighten further without protecting them
  again). Verified same day: summary 941 → 559, report 13% shorter.
  The comps array itself got compact encoding the same day: the model
  writes 1-3 char keys (`SHORT_COMP_KEYS`) and omits empty fields;
  `expandCompKeys` restores the long-keyed, ""-backfilled shape at parse
  time, so only the MODEL OUTPUT is smaller — every stored and served
  report keeps the classic shape. A new comp field needs a short key too
  (the add-comp-field skill has the step). Measured with caps + encoding
  together: a 7-comp report fell from 6,111 to 3,111 output tokens.
  `notes` is now capped in the prompt at two short sentences with the two
  real sources of bloat banned by name — the model narrating its own search
  ("Included as the nearest comparable found; details require CoStar") and
  restating fields that have their own columns. Result: average note
  139 → 104 chars, longest 188 → 115, report 13% shorter, price caveats
  preserved and promoted. Keep `max_tokens` generous — the cap is a quality
  instruction, and a low `max_tokens` would truncate the JSON mid-array
  instead.
  **FIELD ORDER is the other half of that lever** (2026-08-21). The model
  writes the JSON top to bottom, and `comps` is the only part the browser
  can paint while it is still writing, so every field above the array is
  dead air on screen. The shape now writes `summary` (the one field the
  loading card can show), currency, and the tiny subject lookups, then
  **`comps`**, then every market-level field — `avg_price_per_sqft`,
  `subject_lat`/`lng`, `market_cap_rate_range`, `market_opex_range`,
  `value_drivers`, `market_trend`, `annual_price_trend_pct`,
  `search_radius`, `transactions_reviewed`, `price_discovery`. That is
  ~800 characters (~200 output tokens, ~2.5s at the measured 78 tok/s) the
  live comp table no longer waits through, and it is a quality change in
  the same direction: every one of those fields is a read OF the comps
  (`avg_price_per_sqft` averages them, `transactions_reviewed` must exceed
  their count), so the model now describes rows it has committed to
  instead of rows it still intends to write. A new top-level field belongs
  BELOW `comps` unless the browser can render it mid-stream or a later
  figure depends on it; `test/routes.test.js` evaluates the taught shape
  and fails the build otherwise.
  Also dropped that day: `price_per_sqft` on any SALE comp carrying both a
  price and a size. `reconcilePricePerSqft` already derived that number
  server-side and already overrode the model's figure when the two
  disagreed by more than 10%, so the field was tokens spent restating
  arithmetic. The source cross-check it was really performing survives as
  a prompt instruction; the field is still asked for where it is NOT
  derivable (lease rates, and sales missing a price or a size). One
  consequence: `psf_reconciled` now fires only on a real CORRECTION, never
  on a fill, because a "calc" mark on every row would drain the meaning
  out of a mark that says "we did not trust the figure we were handed".
  **The default provider streams too, since 2026-08-29.** Gemini's wire
  format was confirmed live that day with
  **`node scripts/verify-gemini-stream.js`** (~$0.001 a run; plain and
  `--grounded`), and the first run FAILED — the real stream is
  `event_type`-tagged frames (`interaction.created`, `step.start`/`.delta`/
  `.stop`, `interaction.completed`), not the `{steps:[...]}` snapshots the
  reader was guessed from — which is exactly why it shipped dark behind a
  verifier instead of guessing on the default path. The reader was rewritten
  from the frames the script printed; the captured frames are committed as
  `test/fixtures/gemini-stream-frames*.json` and replayed by
  `test/search-provider-gemini.test.js`, the new ground truth. Keep the
  script: it is how a vendor-side frame change gets diagnosed, and how a
  future provider earns `streaming: true` the same way. The
  `STREAM_UNVERIFIED` env opt-in and `capabilities.streamingUnverified` are
  deleted, not just off — a test pins the flag as GONE so the branch cannot
  quietly return. **Reading a stream lives behind
  the provider seam**: `PROVIDER.createStreamReader()` takes one decoded SSE
  frame and returns normalized events (`start` / `text` / `results` /
  `search` / `usage` / `error` / `done`), and owns rebuilding the final
  text. server.js's read loop names no vendor event type. The rule that
  makes it safe, and the first test this code ever had: a reader's `text()`
  must be **byte-identical** to what that provider's `parseResponse()`
  produces from the equivalent non-streaming body, or `parseCompJson` sees
  different input depending on a setting nobody thinks about. (One
  deliberate asymmetry survives: streamed Gemini calls emit real `search`
  events — the `google_search_call` delta carries the model's query strings
  — while `parseResponse` still honestly reports `searches: 0`, because the
  non-streaming body has nothing to count them from.) The request FORM
  needs `?alt=sse` **and** `stream: true`; either alone silently returns
  ordinary JSON. Three traps the reader guards, all test-pinned: a re-sent
  cumulative snapshot must REPLACE rather than append (appending duplicates
  the whole report, which still parses and is wrong — the worst failure
  available); only newly-arrived characters may be emitted as `text`
  events or the comp extractor re-scans and double-counts every comp; and
  report text is harvested ONLY from a `model_output` step's deltas, so a
  thought delta that one day carries text can never leak reasoning into
  `parseCompJson`'s input. And thought tokens count toward OUTPUT there: a
  measured call spent **4,207 in / 928 out / 6,473 thought**, so the report
  JSON is about one eighth of what the model generates and reasoning is the
  other seven eighths. That makes `THINKING_LEVEL` (see its bullet under
  Configuration) a larger wall-clock lever than everything in the report
  JSON put together — and makes it the one to MEASURE first, since Google's
  guidance calls the default depth the best quality for agentic work.
  The Explorer reaches the same rule from the other side: its cache lookup
  lives inside the shared in-flight job, so it cannot decide up front whether
  the request is fast. Its SSE opens on the FIRST progress event instead, and
  a cache hit (which emits nothing) therefore answers as plain JSON with no
  special-casing. `exploreInFlight` carries a listener set and a bounded
  replay log so two visitors sharing one billed search both see it.
- `PARALLEL_SEARCH` — optional `on`/`off`, **default OFF**. When on, a report
  search that would run a 6+ search budget is split into two CONCURRENT
  Anthropic calls (`LANE_GUIDANCE` in server.js): a `primary` lane that starts
  from brokerage/listing sources and owns every market-level figure and all
  narrative, plus a `records` lane that starts from news/press/public records,
  returns comps + the subject-size lookup only, and is folded in by
  `mergeLaneReports` (address-normalized dedupe, interleaved so the slice to
  `maxComps` can't drop one lane's provenance wholesale, currency-mismatch
  guard). The records lane is additive and never retried — if it fails the
  report still renders from the primary lane.
  **Why it is off**: measured 2026-07-30 against a same-address control
  (Indianapolis Industrial), the split ran 81.7s → 47.0s (42% faster) but
  returned 3 comps instead of 4; on a dense market (Dallas) it returned a
  healthy 8 comps with a better provenance mix but saved almost no time,
  because wall clock is the SLOWER lane. A single deep call steers its later
  searches at the gaps it knows it still has; two shallow lanes rediscover
  the same easy comps. Re-measure on real traffic before flipping it on.
  Each search logs `Anthropic call [lane]: Ns · N search(es) · N out / N in
  tokens`, which is how any of this gets re-measured.
- `SEARCH_PROVIDER` — optional `gemini` (**default since 2026-08-10**) or `anthropic`. Picks which
  vendor runs the comp search. An unrecognized value **exits at boot** rather
  than silently falling back, the same no-fallthrough rule `/api/checkout`'s
  `PLANS` map follows. `MODEL` still overrides the chosen provider's default
  model, so existing `MODEL=` deployments are unaffected. Gemini authenticates
  with `GEMINI_API_KEY` and needs a **paid-tier** Google project: search
  grounding 429s on the free tier, and the error names no project. Gemini
  cannot cap its search rounds (`google_search` takes no `max_uses`), so
  corpus-first retrieval remains a quality lever there but stops being a cost
  lever. Server code must branch on `PROVIDER.capabilities.*`, never on
  `PROVIDER.name`.
  **`GET /healthz` reports the live `provider`, `model`, `commit` and
  `started`** — ask the deployment, never the repo. `commit` is the deployed
  SHA (`RENDER_GIT_COMMIT`, falling back to a `.git` read locally, `""` when
  unknown) and it is how a deploy is verified from outside when the change has
  no anonymous-visible byte — a server-side rule, a budget, a cache decision.
  Grepping a served page proves nothing for those, and on 2026-08-09 two
  deploys failed back to back while every page answered 200. `MODEL` is read once at startup from an env var
  nobody can see from here, and a provider's `defaultModel` moves with the
  code, so a checkout only proves what the source says. The Gemini default is
  `gemini-3.7-flash` (moved from 3.6 on 2026-08-13). Rollback is
  `SEARCH_PROVIDER=anthropic` or `MODEL=gemini-3.6-flash`.
- `THINKING_LEVEL` — optional `low`/`medium`/`high`. **Production runs
  `low`** as of 2026-08-22, set in Render's environment rather than in code,
  so rollback is unsetting it with no deploy. Unset means the request is
  byte-identical to what it was before this knob existed and the vendor's own
  default applies (`medium` on gemini-3.7-flash).
  **It is the largest wall-clock setting this deployment has**, and the
  reason is that on Gemini thought tokens are generated and billed as
  OUTPUT: a measured call spent 4,207 in / **928 out / 6,473 thought**, so
  about seven of every eight tokens the model produces are reasoning and
  only one in eight is the report. Every trim to the report JSON is
  attacking that one eighth; this is the other seven.
  **It was measured before it was set** (four runs, ~$1.36, full record in
  `docs/evals/2026-08-22-thinking-level-decision.md`). `low` made reports
  **3x faster (34.3s → ~10s) and 3x cheaper ($29.56 → ~$9.50 per 1,000)**,
  and every delta is 3-5x the run-to-run noise floor. It returned about a
  third fewer comps — but the shorter list was BETTER sourced: provenance
  up, market match up, and the unsourced-`estimate` rate down from as high
  as 14% to **2%**, the best this eval has recorded. Valuation stayed
  possible on 100% of targets in every run, and 8 of 10 kept enough priced
  sales (4+) for the hero's trimmed band. The cost paid is real and worth
  knowing: ~20% of reports fall back to a full-spread value range, and the
  comp table is visibly shorter.
  **Two things to re-check on real traffic**, both in that record: the 2%
  estimate rate is the prize, so a climb means re-running the comparison;
  and comp counts should drift back UP on their own as the radius blend
  folds saved corpus deals into new reports.
  **`COMP_FLOOR` was the attempt to buy those comps back, and it failed** —
  see its own note in server.js. It moved comps by less than the arm's own
  wobble while more than doubling the estimate rate, and `thoughtTokens`
  went 0 → 309: telling a model you have deliberately told to reason less to
  "try harder" spends the saving on deliberation, not on searching. Kept in
  the tree and off, because a recorded negative result is worth more than a
  deleted one.
  **`node scripts/compare-thinking.js` runs that whole pair as one command**
  (boot → score → restart at the candidate depth → score → compare). Prefer
  it over doing the steps by hand: it spawns the server with an EXPLICIT
  env, which makes the PowerShell `$env:SUPABASE_URL = ""` delete-vs-empty
  trap in run-eval.js's header impossible rather than merely documented; it
  enforces the restart, refuses to run against the main checkout, verifies
  via `/healthz` that the server is at the depth asked for BEFORE spending,
  and prints the bill and stops without `--yes`.
  The run summary records `thinkingLevel` beside `model` and `--compare`
  prints it, so a pair that differs only in this can never be misread as
  model noise. The scorecard also carries **spend** as of 2026-08-21 —
  `costUsd`, `billedCalls`, `inputTokens`, `outputTokens`, `thoughtTokens`,
  `reportTokens`, `thoughtShare` — because until then it measured quality
  and wall clock and nothing about cost, which is the half of this question
  that decides it. Those ride on a `_call` block that `gate()` attaches for
  an INTERNAL caller only and only on a billed leg: never cached, never
  harvested, never served to a customer, and absent (not zero) on a cache
  hit, so a run that hit the cache reports "no cost data" rather than
  halving its own average. `thought_tokens` is a **subset** of
  `output_tokens`, never an addition — summing them double-counts the
  thinking and doubles the bill; `reportTokens` is the remainder, and it is
  the figure every prompt trim in this project has actually been aiming at. `GET /healthz` reports the live value for the same reason it
  reports `model` — ask the deployment, never the repo; `""` there means the
  vendor default, and an absent field means a build older than this.
  Three rules, all pinned by tests. It is read through
  `PROVIDER.capabilities.thinkingLevels`, never a provider name. An
  unrecognized level **exits at boot** (the `SEARCH_PROVIDER` /
  `/api/checkout` `PLANS` no-fallthrough rule). And a level set against a
  provider that declares `thinkingLevels: null` — Anthropic, which has no
  tunable depth on this path — **also exits at boot** rather than being
  accepted and dropped: a knob that appears to work and changes nothing is
  worse than either a working knob or a refused one, because the deployment
  would conclude that thinking less does not help. Lowering it only ever
  generates fewer tokens, so Gemini's `deadlineTokens()` ceiling stays safe
  in the one direction this moves.
`MODEL` is set in `server.js`, overridable by a `MODEL` environment variable (unset in production, so the constant is the live value). If the API returns a
404 for the model, list available models via `GET https://api.anthropic.com/v1/models`
with the key and update the constant — an earlier model ID was retired.

**Measuring a model or prompt change** (2026-08-09, contamination doors closed and a database refusal added 2026-08-10). `run-eval.js` puts the 12 fixed targets in `eval-set.json` through real searches and scores each report with the pure, tested `eval-score.js` (priced sale comps and whether a valuation was possible at all, provenance weighted with `valuation.js`'s own `TIER_WEIGHT`, aggregate-address and out-of-window and off-market rates, narrative lengths against the 2026-08-03 caps, wall clock). It is a SCORECARD, not an assertion suite: nothing has a pass/fail threshold, because a dozen stochastic searches are noisy, and the product is `--compare` between two runs. Summaries land in `docs/evals/`, timestamped in the filename so a same-day, same-label rerun can never silently clobber a possibly-good baseline (committed, so history accumulates); raw reports go to the git-ignored `eval-runs/`. Several things make it trustworthy and must not be undone. The run sends `fresh: true`, an internal-only flag that skips BOTH cache read paths (the exact hit and the derivable-window one), because a cached report would score the model that wrote it and report a false "no difference". Before every run the runner also wipes two local files and records both in the summary: `comp-corpus.jsonl` (`corpusWiped`), because `corpusRowsForMarket` reads that file fallback even with no database configured, so a previous run's harvest would otherwise hand the next run corpus coverage and a smaller search budget; and `subject-sizes.json` (`subjectSizesWiped`), because no eval target supplies `subjectSizeSqft`, so a previous run's building-size lookup would otherwise be found by `findKnownSubjectSize`, again shrinking the search budget and also silently backfilling `subject_size_sqft` regardless of what the run's own model did. The subject-size wipe is not the whole fix: `findKnownSubjectSize` also keeps an in-memory `subjectSizesMem` Map that a file delete cannot clear, so **the server must be restarted, not just have its files wiped, between two runs that are being compared** (the corpus read hits disk on every call with no in-memory layer, so it does not need this). A model comparison already forces a restart because `MODEL` is read once at server startup; this restart rule mainly matters for an A/A run pair meant to measure noise, where nothing else would force one. Before spending anything, the runner also probes the target with `GET /api/stats` (the admin key) and reads `introRequests.db`: a confirmed `true`, a failed probe, or the field simply missing all refuse the run and name the risk, because isolation (`SUPABASE_URL` blank on the server under test) is enforced only by however that server was launched, and a database the runner can see is a database it would both write into and read stale corpus coverage from; only a confirmed `false` proceeds. `EVAL_SKIP_DB_CHECK=1` is the deliberate override for someone who has already verified the database really is disposable. And the runner must target a server started from a separate worktree with `SUPABASE_URL` blank, so every write lands in that worktree's own fallback files instead of production's corpus, market pages, and cache: on Windows this is a documented trap, because in PowerShell `$env:SUPABASE_URL = ""` DELETES the variable rather than emptying it, so server.js's `.env` loader (which only fills vars that are `undefined`) silently restores whatever the worktree's own `.env` holds. Copy ONLY the `ANTHROPIC_API_KEY` line into the eval worktree's `.env`, never the whole file, and prefer a `node -e` launcher that sets `process.env.SUPABASE_URL = ""` (and `SUPABASE_SERVICE_KEY`) explicitly before requiring `./server.js`. A full run costs about $4.30, a model comparison about $8.60. The accuracy backtest (`/api/accuracy`) is the other half of the picture and answers a different question: it scores the reconciliation math over comps already harvested, never what a search found.

## Architecture

- `POST /api/comps` — the core endpoint. Enforces the password gate (if set),
  builds the prompt, calls Anthropic with the `web_search` tool enabled, and
  returns parsed JSON. **Its two halves are module-level functions, shared
  with the bulk worker since 2026-08-21**: `runCompSearch()` (cache →
  derivable window → daily cap → size memo → corpus retrieval → the billed
  call, plus every side effect that must see the UNGATED report) and
  `finishReportForViewer()` (the old `gate()` closure). Nothing about
  either changed in the move, and the ordering rules inside them are
  pinned by source-scanning tests that name them. Body takes optional `maxComps` (allowed 4/6/8/10/12,
  default 12 — the Explorer/seed pipeline stays pinned at 8) and optional
  `subjectSizeSqft`; when absent the prompt also asks the model to look up
  the building's size (returned as `subject_size_sqft` +
  `subject_size_source`) and `max_uses` rises 8 → 10 to budget the lookup
  (6 → 8 for a ≤8-comp ask). Body also takes optional `subjectDetails` — the per-type
  facts about the user's own building (see flow 4), whitelisted by
  `sanitizeSubjectDetails` against that type's `TYPE_COMP_FIELDS` keys and
  shown to the model so comp selection matches the subject. Every response carries `market_cap_rate_range`,
  `value_drivers`, `market_trend`, and a per-comp `source_type` that the
  server normalizes onto its enum (unknown → `estimate`, so badges can
  under-claim provenance but never over-claim). Normalization also ENFORCES
  the prompt's individual-property rule: a comp whose address lacks a
  leading street number, or that names a statistic
  (`isAggregateAddress`), is forced to `estimate` no matter what the model
  claimed — thin markets make the model pad with submarket rows despite
  the prompt telling it not to, and prompt rules are requests while
  normalization is a guarantee.
  **Market-page cross-link (2026-08-20).** Every served report also carries
  `market_page` (`{ slug, market }`) when a standing `/market/<slug>` page
  covers the subject's market + type — attached at SERIALIZATION inside
  `gate()` via `marketPageInfo()` (pure in-memory reads of the loaded page
  stores, so it costs nothing and a page published later lights up older
  cached reports), never written into the cache. index.html renders it as
  the "See the {market} market page →" line under the Market Summary
  (`renderMarketPageLink`; `no-print`/`no-capture` — navigation, not report
  content). The reverse door is the market page's own CTA: a "value a
  property here" mini-form (`vform` / `MARKET_VALUE_FORM_JS`) that stores
  the typed address under `pendingLandingAddress.v1` — the landing form's
  exact mechanism, already consumed at startup — and navigates to
  `/?type=<type>` (member) or `/?auth=signup&type=<type>` (anonymous, the
  wall-honored door). The same `marketPageInfo` decorates `GET
  /api/portfolio` items and the watchlist feed, so My Desk links each saved
  property and watched market to its market page.
  **"Verified" is a reserved word (2026-08-10).** It names a badge only the
  server awards (a broker vouched, our team reviewed), so the model must
  never write it. Two layers, the same requests-vs-guarantee split: the
  `verified` field is **only in the comp shape when broker comps were
  actually offered** (`hasVerified` in `buildPrompt`) — with none offered it
  could only ever be false, and asking for it made the model award itself the
  badge, measured live at 4 of 5 comps on a market with zero submissions; and
  `scrubUnearnedVerifiedClaims` (pure, tested, in report-parse.js) rewrites
  the verified word family in `summary`/`value_drivers`/`market_trend`/
  `price_discovery`/comp `notes` whenever the finished report carries no
  verified comp. `enforceVerifiedFlags` always kept the BADGES honest; what
  was broken was that nothing revisited the prose the model wrote around
  them, so a summary described verified comps while every badge read
  Estimate/News/Listing. Three rules: the scrub is **outermost** in
  `finishReport` because it counts the FINAL flags (inside
  `attachVerifiedAttribution` it would read the model's own claims); it fires
  **only at zero** verified comps, since one real badge makes the word
  accurate; and it **rewrites rather than deletes**, because cutting a clause
  can take the summary's required honesty caveat with it. Keep the summary
  rule's own caveat examples free of the word too — they said "scarce
  verified data" and contradicted this rule on the same prompt.
  **Source-link check (2026-08-09).** After the
  report is parsed and normalized, and before the cache write, harvest, market
  snapshot, and the `gate()` funnel, `applySourceLinkCheck` (server.js) checks
  each comp's `source_url`: max 12 unique URLs in parallel under one 2.5s
  budget, HEAD with a GET-on-405 fallback, redirects never followed (one hop
  could steer past the DNS guard; a 3xx counts as live), DNS resolved first and
  private/loopback answers refused (the URLs are model-supplied, so this is an
  SSRF guard, not a nicety). Rules live in the pure, tested **`link-check.js`**:
  bot-walled hosts (loopnet, cityfeet, propertyshark, commercialsearch, costar,
  crexi, zillow, redfin, realtor) are never fetched and never demoted; only
  DNS-gone/404/410 count as dead; a dead-linked comp is demoted to `estimate`
  (dead at birth usually means the citation was never real), keeping its
  `source_url` as the audit trail; broker-`verified` comps are exempt. It runs
  inside `getComps`, so the Explorer inherits it and the served report, cache,
  corpus, and shares all agree; the backtest and corpus retrieval need no
  changes because `estimate` is already excluded from both. Fails open on any
  error. Counts ride a `link_check` analytics event packed into the `source`
  column (the analytics schema is fixed). Link rot on existing corpus rows
  deliberately does nothing; the sweep is deferred (see the spec).
  **Cached**: identical requests
  within a 30-day TTL (7 days until 2026-08-03 — widened as a cost lever) are
  served from the `search_cache` layer (Supabase table
  `search_cache`, keyed by a SHA-256 of address+type+note+window+size+a
  signature of the offered verified comps — so approving a broker comp busts
  the cache for that type — plus a signature of `subjectDetails`, appended only
  when non-empty so pre-existing cache entries keep their keys; in-memory Map +
  file fallback when Supabase is unconfigured). Since 2026-08-08 each DB entry
  also records `address_key` + `prop_type` (nullable columns, migration 020) —
  written by a separate best-effort PATCH after the main insert, never in it
  (an unknown column in the insert would divert the whole cache to the
  ephemeral file, the 004 outage's shape) — feeding the Address Explorer's
  "Instant" badge via `cachedAddressKeys()`; presence-based, failure-safe,
  and an approximation by design (the true hit still needs the exact key).
  A cache hit does NOT call Anthropic and does NOT count against
  `DAILY_SEARCH_CAP`.
- **Upstream health (`UPSTREAM_HEALTH` + `upstreamError()` + `noteUpstreamFailure()`).**
  Anthropic's error text is written for *us*, not for a customer, so it is never
  passed through to the browser. On 2026-08-04 it was: the Console API credit
  balance hit zero and every visitor — including people who had just paid $39 —
  got "Anthropic API error (400). Your credit balance is too low ... purchase
  credits", which reads as *their* billing problem and names a vendor they never
  bought from. Both leak sites (the non-2xx at `callAnthropicOnce` and the
  mid-stream `error` frame) now throw `upstreamError()`, which carries
  `.message` for the log and `.userMessage` for the browser; `clientErrorMessage()`
  at the two handler catches (`/api/comps`, `/api/explore-market`) is the only
  thing that decides what a visitor reads. It deliberately passes `.message`
  through when there is no `.userMessage`, because most errors here are ours and
  are already good customer copy ("The search took too long and was stopped.").
  429/529 gets a "busy, try again in a minute" line; everything else gets
  "temporarily unavailable". The real cause goes to `/api/stats` as `upstream`,
  to a red `/admin` banner **above** the corpus one (when this fires nothing else
  on the page matters — no search is completing at all), and, for the billing
  class only, to one email per process. **API credits are prepaid and billed to
  the Console org that owns `ANTHROPIC_API_KEY`; no Claude Pro/Team subscription,
  comped or otherwise, funds them.** Recovery is buying credits — nothing to
  redeploy. Counters reset on restart: a smoke alarm, not accounting.

## Non-obvious flows

1. **Web-search response parsing (`server.js`).** A web-search response is a mix
   of block types. The code keeps only `block.type === "text"`, joins them, then
   `parseCompJson` defensively strips ```` ```json ```` fences and slices the
   outer `{...}` before `JSON.parse`. The model is told to return raw JSON, but
   this guards against stray text. If you change the output shape, keep the
   "return ONLY JSON" instruction intact.
   Since 2026-08-04 a FAILED parse is rescued in layers before the expensive
   full retry: first the first BALANCED object is salvaged
   (`extractFirstJsonObject` — the observed failure mode is a complete report
   plus trailing junk containing a brace, which fools the first-{-to-last-}
   slice), then one no-tools repair call (`repairCompJson`) asks the model to
   re-emit the same JSON corrected; `solo()`'s full re-search only runs if
   both fail. Every layer logs (`salvaged` / `repaired` / `retrying`), so
   Render logs show which fires and how often.

5. **Currency (non-US searches).** The model quotes a foreign target's prices
   in the LOCAL currency and returns top-level `currency` (ISO code) +
   `usd_rate` (value of 1 unit in USD, bounded to (0, 10) — anything larger
   is treated as an inverted rate and dropped), normalized by
   `normalizeCurrency()` in server.js. The front-end never converts the
   math — `formatUsd()` and `displayMoney()` convert at the formatting layer
   when the report-header "Show in USD" switch is on, and `displayMoney`
   REFUSES ambiguous strings (ranges, European grouping, shorthand like
   "1.2M", negative heads) rather than risk a wrong number — refused values
   render raw. `harvestComps()` skips non-USD reports entirely (corpus rows
   have no currency column, so foreign prices would masquerade as USD —
   skipping beats an ALTER TABLE for a rare case). Note `marketOf()` yields
   just "Canada" for Canadian addresses (it parses "City, ST"); harmless
   while non-USD reports skip the corpus, but fix it before ever harvesting
   them. International searches run long — the first Canadian test search
   timed out under the old fixed 100s call ceiling and succeeded on retry;
   the deadline has since become per-call (`searchTimeoutMsFor`, ~260s for
   a full-budget report), sized so a healthy slow search finishes instead
   of being aborted after it was already billed.
