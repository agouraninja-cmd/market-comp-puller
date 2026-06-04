# Project Handoff — Market Comp Puller

> Read this first if you're picking the project up in a new chat. It captures
> everything done so far, how to run it, the problems already solved, and the
> next step.

## What this is
A web app for a commercial real estate company. A user enters a property address
+ type; the server asks Claude (with web search) to find comparable sales/leases
and returns a structured comp report (summary, average $/SF, comp table, target
vs. market comparison). Single front-end file + a small Node proxy that holds the
API key.

## Current status (as of last session)

| Item | Status |
|------|--------|
| App fully built (front-end + backend proxy) | ✅ Done |
| Returns REAL comps from a live search | ✅ Verified working end-to-end |
| Password gate (optional) | ✅ Built & tested |
| Target-vs-market comparison | ✅ Built |
| CSV export / PNG image / Print-to-PDF | ✅ Built |
| Usable by the owner locally (localhost) | ✅ Yes, right now |
| **Hosted so OTHER people can reach it** | ❌ NOT done — this is the next step |

## The files
- `index.html` — front-end (form, results, comparison, export buttons, password gate UI).
- `server.js` — zero-dependency Node proxy. Serves the page + `POST /api/comps`.
- `package.json` — `npm start` runs the server.
- `.env` — holds the real API key (and optional APP_PASSWORD). **Git-ignored. Do not commit or share.**
- `.env.example` — template.
- `README.md` — run + deploy instructions.
- `.gitignore` — excludes `.env` and `node_modules`.

## How to run it locally (Windows, no admin needed)
Node was installed as a PORTABLE copy (no admin rights required) here:
```
C:\Users\JacobAdler\AppData\Local\node-portable\node-v24.16.0-win-x64\node.exe
```
Start the server from the project folder:
```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js
```
Then open http://localhost:3000

(If `npm start` / plain `node` is wanted instead, Node would need to be on PATH,
which requires the admin installer from nodejs.org. Not necessary — the portable
copy works.)

## Problems already solved (don't re-debug these)
1. **Node install needed admin** → worked around with a portable Node zip
   extracted to `%LOCALAPPDATA%\node-portable` (no admin prompt).
2. **API key got corrupted in .env** → when pasted in Notepad it merged with the
   comment line below it (and a smart "—" dash crashed the request). The key was
   cleaned to exactly 108 chars. If editing `.env` again, keep the key on ONE line
   with nothing after it.
3. **Model 404** → the originally-specified model `claude-sonnet-4-20250514` was
   retired. Now using **`claude-sonnet-4-6`** (current Sonnet). Set in `server.js`
   as the `MODEL` constant. If it 404s again, list available models with:
   `GET https://api.anthropic.com/v1/models` using the key.

## Key technical notes
- API key lives ONLY in `.env` (server-side). The browser never sees it.
- Web search responses have multiple block types; `server.js` extracts text via
  `data.content.filter(b => b.type === "text")`.
- JSON from the model is parsed defensively (strips ```json fences, grabs outer
  `{...}`).
- Optional password gate: set `APP_PASSWORD` in `.env`; the front-end shows a lock
  screen and sends the password as the `x-app-password` header.

## NEXT STEP: hosting / deployment
Goal: put the app on the internet so other people can reach it via a public URL.
Open decision still pending from the owner:
- **Password-protect the public site** (recommended — set `APP_PASSWORD` so randoms
  can't spend the API credits) vs. **open to anyone with the link**.

Likely path: deploy `server.js` + `index.html` to a host like **Render** or
**Railway** (Node web service, start command `npm start`), and set
`ANTHROPIC_API_KEY` (and optionally `APP_PASSWORD`) as environment variables in the
host's dashboard. See README.md "Deploy it so others can use it".

Reminder: whoever hosts it, every search is billed to the owner's Anthropic
account — hence the password recommendation and/or a spend cap in the Anthropic
console.
