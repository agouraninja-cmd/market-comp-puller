# Market Comp Puller

A small web app for pulling commercial real estate comps. A user enters a
property address and type; the server asks Claude (with web search enabled) to
find recent comparable sales/leases and returns a clean, structured report.

The Anthropic API key lives **only on the server** — the browser never sees it,
so this is safe to share with other people.

## How it's put together

```
Browser (index.html)  ──POST /api/comps──>  server.js  ──>  Anthropic API + web search
        ^                                       │
        └──────────── JSON comps ───────────────┘
```

- **index.html** — the front-end (form, summary card, target-vs-market
  comparison, sortable comp table, CSV export). No API key, no secrets.
- **server.js** — zero-dependency Node server. Serves the page and exposes
  `POST /api/comps`, which holds the key and calls Anthropic server-side.

## Run it locally

Requires **Node.js 18 or newer** (for built-in `fetch`).

```bash
# 1. Add your key
cp .env.example .env
#    then edit .env and paste your real ANTHROPIC_API_KEY

# 2. Start the server
npm start

# 3. Open the app
#    http://localhost:3000
```

On Windows PowerShell, step 1 is:

```powershell
Copy-Item .env.example .env
# then edit .env
```

There are no `npm install` dependencies — it runs on plain Node.

## Deploy it so others can use it

The app is a standard Node web server, so it runs on most hosts. The only
required setting is the `ANTHROPIC_API_KEY` environment variable.

**Render (simple option):**
1. Push this folder to a GitHub repo.
2. In Render: **New → Web Service**, point it at the repo.
3. Build command: *(leave blank)* · Start command: `npm start`
4. Add an environment variable `ANTHROPIC_API_KEY` = your key.
5. Deploy. Render gives you a public URL to share.

The same pattern works on Railway, Fly.io, Azure App Service, a small VM, etc.
Set `ANTHROPIC_API_KEY` in the host's environment settings — **do not** commit
your `.env` file (it's already in `.gitignore`).

## ⚠️ Important: a public app spends your API budget

Because the key is shared by everyone who visits, **every search anyone runs is
billed to your Anthropic account.**

### Password gate (built in)

Set an `APP_PASSWORD` environment variable and visitors must enter that password
before they can run searches:

```
APP_PASSWORD=choose-a-shared-password
```

- If `APP_PASSWORD` is **set**, the app shows a lock screen and every
  `/api/comps` request is checked against it.
- If it's **unset**, the app is open to anyone with the URL (fine for local use;
  risky for a public link).

This is a lightweight shared-password gate to protect your budget — not a
full per-user login system. For extra protection on a public URL you can also
set a monthly spend cap in the Anthropic console, or put the app behind your
host's access controls.

## Features

- Property-type-aware prompt (Industrial / Office / Retail / Multifamily / Land).
- Summary card with the market takeaway and average $/SF.
- **Target vs. Market**: enter your subject property's size + price to see its
  $/SF and the delta (absolute and %) against the comp average.
- Sortable comp table (click any column header; numeric columns sort by value).
- Export to **CSV**, download the report as a **PNG image**, or **Print / save
  as PDF** — handy for sharing a clean, branded report.
- Optional **password gate** (see above).

## Disclaimer

Comps are based on publicly available data pulled via web search. They are a
starting point, not a system of record (this is **not** CoStar or MLS). Verify
before use in underwriting.
