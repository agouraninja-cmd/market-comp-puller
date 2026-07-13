# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A commercial real estate comp + valuation tool, branded **CompNinja** (the
owner's independent brand — it previously carried Adler Industrial branding;
do not reintroduce Adler anywhere). A user enters a property address + type;
the server asks Claude (with web search) for recent comparable sales/leases
and returns one unified report that both answers and proves: a "What This
Building Is Worth" value hero (the building's SF is looked up from public
records when not entered), a plain-English market summary, a "What's Driving
Prices Here" card (model-supplied `value_drivers` + `market_trend`), a market
position chart, a comp map, and the full sortable comp table with per-comp
source-confidence badges (Verified / Public record / Listing / News /
Estimate). There is deliberately **no mode toggle** — an earlier owner-mode /
comps-mode split was merged (commit 87095aa); `#owner` survives only as a
deep link that pre-opens the property-details section. The hero carries a
"Get a free Broker Opinion of Value" button — the site's lead funnel; those
leads are stored with `source: "bov"` (vs `"export"` for export unlocks).
The front-end is a single HTML file; a small Node proxy holds the API key so
the browser never sees it. The public contact email across the site is
agouraninja@gmail.com. The owner is not a licensed broker: site copy must say
we "connect you with a local broker", never that we are one, and every
valuation is labeled an automated estimate, never an appraisal.

There is no build step, no test suite, no linter, and **no npm dependencies** — it
runs on plain Node (uses the built-in `fetch`, so **Node 18+ is required**).

The one build-*ish* artifact is **`tailwind.css`**: a vendored, pre-generated
Tailwind build (checked in, served by `server.js`) that replaced the Play CDN.
It is NOT regenerated automatically — see the rule under "Restart rule".

## Running it

```bash
npm start          # = node server.js  -> serves http://localhost:3000
```

`npm start` only works if `node` is on PATH. On the owner's Windows machine Node is
a **portable (no-admin) copy**, so it's launched by full path instead:

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js
```

### Restart rule (important)

- Editing **`index.html`** needs no restart — `server.js` reads it from disk on
  every request, so just refresh the browser.
- Editing **`server.js`** (e.g. the prompt) **requires restarting the process** —
  it's loaded once at startup. Kill the process listening on port 3000 and
  relaunch.
- Adding **new Tailwind utility classes** to `index.html` requires regenerating
  the vendored **`tailwind.css`** — a class missing from it silently won't
  style. With node on PATH, run from the project root:

  ```powershell
  $env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
  npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
  ```

  Classes already used anywhere in `index.html` (including inside JS strings)
  are covered; only genuinely new utilities need a regen. Commit the updated
  `tailwind.css` alongside the HTML change.

## Configuration (environment / `.env`)

`server.js` has a tiny built-in `.env` loader, so a local `.env` works without any
dependency. `.env` is git-ignored — never commit it.

- `ANTHROPIC_API_KEY` — **required.** Keep the key on ONE line with nothing after
  it; a stray comment or a smart `—` dash on the same line will corrupt it.
- `APP_PASSWORD` — optional shared password. When set, the front-end shows a lock
  screen and every `/api/comps` call must carry the matching `x-app-password`
  header (checked server-side with a constant-time compare). When unset, the app
  is fully open.
- `LEAD_CAPTURE` — optional `on`/`off`. When on, the CSV/PNG/print exports are
  unlocked by a one-time contact form (the lead-magnet flow). Defaults to ON when
  `APP_PASSWORD` is unset (public deployment) and OFF when it is set (internal).
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — optional pair. When both are set,
  leads are stored durably in a Supabase Postgres table named `leads` (written
  via its REST API with plain fetch — still zero npm deps). When unset, or if a
  DB insert fails, leads append to `leads.jsonl` (git-ignored — contains PII,
  never commit). `GET /api/leads` merges both sources.
- `ADMIN_KEY` — optional. When set, `GET /api/leads` returns the captured leads
  as CSV (send the key via `x-admin-key` header or `?key=`). Unset = that
  endpoint is disabled. Without Supabase configured, leads live only in
  `leads.jsonl`, which ephemeral-filesystem hosts wipe on every redeploy.
- `SITE_URL` — optional. Public URL used in `robots.txt`/`sitemap.xml`; defaults
  to the Render URL. If the site moves to a custom domain, set this AND update
  the canonical/`og:url` tags in `index.html` (they are hard-coded).
- `PORT` — defaults to 3000. Hosts set this themselves.

`MODEL` is hard-coded in `server.js` as `claude-sonnet-4-6`. If the API returns a
404 for the model, list available models via `GET https://api.anthropic.com/v1/models`
with the key and update the constant — an earlier model ID was retired.

## Architecture

```
Browser (index.html)  --POST /api/comps-->  server.js  -->  Anthropic Messages API
        ^                                       |              (+ web_search tool)
        +-------------- JSON comps --------------+
```

**`server.js`** — zero-dependency Node HTTP server. Routes:
- `POST /api/comps` — the core endpoint. Enforces the password gate (if set),
  builds the prompt, calls Anthropic with the `web_search` tool enabled, and
  returns parsed JSON. Body takes optional `subjectSizeSqft`; when absent the
  prompt also asks the model to look up the building's size (returned as
  `subject_size_sqft` + `subject_size_source`) and `max_uses` rises 6 → 8 to
  budget the lookup. Every response carries `market_cap_rate_range`,
  `value_drivers`, `market_trend`, and a per-comp `source_type` that the
  server normalizes onto its enum (unknown → `estimate`, so badges can
  under-claim provenance but never over-claim).
- `GET /api/config` — tells the front-end whether a password is required and
  whether lead capture is on (`{ authRequired, leadCapture }`).
- `POST /api/login` — validates a password so the UI can confirm before searching.
- `POST /api/lead` — stores a lead-capture submission (name/email/phone/company
  + the searched address/type + `source`: `"export"` for export unlocks,
  `"bov"` for Broker Opinion of Value requests; the Supabase `leads` table has
  a matching `source` column). Rate-limited per IP.
- `GET /api/geocode?address=` — CORS pass-through to the free US Census
  geocoder. The model's per-comp `lat`/`lng` are block-level guesses used only
  for the map's first paint; the front-end re-places every pin from real
  geocoding (this proxy, then browser-direct Nominatim as fallback, results
  cached in localStorage under `geoCache.v1`). Rate-limited per IP.
- `GET /api/leads` — downloads captured leads as CSV; requires `ADMIN_KEY`.
- `POST /api/comp-submission` — stores a broker-submitted comp (broker contact +
  comp details, `status: "pending"`) in the Supabase `comp_submissions` table
  (file fallback: `comp-submissions.jsonl`). Review is manual: setting a row's
  `status` to `approved` in Supabase puts it in the verified comp layer — each
  search fetches approved comps of the matching property type and offers them
  to the model as trusted candidates; comps the model includes from that list
  carry `"verified": true` and the front-end shows a green Verified badge in
  the Address column. Rate-limited per IP.
- `GET /api/comp-submissions` — downloads submitted comps as CSV; requires
  `ADMIN_KEY`.
- `GET /healthz` — health check for hosting platforms.
- `GET /robots.txt`, `GET /sitemap.xml` — SEO endpoints built from `SITE_URL`.
- `GET /` — serves `index.html`.

**`index.html`** — the entire front-end (Tailwind vendored as `tailwind.css`,
html2canvas via CDN).
Holds the form, password gate, results rendering, sortable table, and the
CSV / PNG / Print-to-PDF exporters. Contains **no secrets**.

### Non-obvious flows to know before editing

1. **Web-search response parsing (`server.js`).** A web-search response is a mix
   of block types. The code keeps only `block.type === "text"`, joins them, then
   `parseCompJson` defensively strips ```` ```json ```` fences and slices the
   outer `{...}` before `JSON.parse`. The model is told to return raw JSON, but
   this guards against stray text. If you change the output shape, keep the
   "return ONLY JSON" instruction intact.

2. **Property-type-aware reporting is split across both files.** `buildPrompt` in
   `server.js` switches guidance per type (Industrial/Office/Retail/Multifamily/
   Land). **Industrial** additionally requests two extra per-comp fields
   (`clear_height`, `dock_doors`) and uses a wider JSON comp shape. The front-end
   mirrors this: `columnsForType()` in `index.html` inserts the matching
   **Clear Height** / **Dock Doors** columns only for Industrial reports, and the
   active `COLUMNS` array is rebuilt per search in `renderResults()`. **Any new
   type-specific field must be changed in both places** — the prompt's comp shape
   and the front-end column set — or it won't display/export.

3. **All valuation math is client-side; the model only supplies market
   figures.** `renderOwnerHero()` in `index.html` computes the Low/Likely/High
   range from sale-comp $/SF (leases are excluded even on mixed searches) ×
   the subject SF — the user's entry wins over the looked-up
   `subject_size_sqft`, and a looked-up size is auto-filled into the form
   input as an editable override. NOI is **never sent to the server**: the
   income-approach cross-check divides the browser-held NOI by the model's
   `market_cap_rate_range`. Subject inputs persist in each report's `meta`
   (saved reports re-render without the form), and editing size/price/NOI
   after a report re-renders the hero/comparison/chart in place — no new
   billed search.

## Deployment

Standard Node web service. Push to a Git host and deploy on Render/Railway/Fly/etc.
with start command `npm start`. Set `ANTHROPIC_API_KEY` (and `APP_PASSWORD` for a
public link) as host environment variables — do not rely on `.env` in production.
Every search is billed to the owner's Anthropic account, which is why a public
deployment should set `APP_PASSWORD` and/or a spend cap in the Anthropic console.
