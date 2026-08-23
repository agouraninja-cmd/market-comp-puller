# CompNinja Developer Onboarding

Welcome. This guide gets you from zero to a running local copy of CompNinja,
and explains the handful of rules that keep the project safe to work on. It
assumes you have Claude Code installed but have never used git or run a
local web server before. Every term is explained the first time it appears.

**The single most useful thing to know:** Claude Code can do almost every
step in this guide for you. Whenever a step tells you to type a command,
you can instead open Claude Code and say what you want in plain English,
for example "clone the CompNinja repo from GitHub and start it locally."
The manual steps are here so you understand what is happening.

## What you are working on

CompNinja (compninja.co) is a commercial real estate comp and valuation
tool. A visitor enters a property address and type; the server asks Claude
(with web search) for recent comparable sales and returns a full valuation
report. The entire front end is one big HTML file, and the server is one
Node file that keeps the API key away from the browser.

The live site runs on a hosting service called Render, and Render
republishes the site automatically whenever the `main` branch changes.
That fact drives the most important rule in this document (rule 1 below).

## Words you will see constantly

| Term | What it means |
|---|---|
| **Repo** (repository) | The project's folder of code, hosted on GitHub so everyone shares one copy with full history. Ours is `agouraninja-cmd/market-comp-puller`. |
| **Clone** | Download the repo to your computer as a linked copy. Your copy knows where it came from, so it can pull updates down and push your work back up. You clone once; after that you just sync. |
| **Branch** | A parallel workspace inside the repo. `main` is the live-site branch. You work on your own branch so nothing you do touches the live site until it is reviewed. |
| **Pull request (PR)** | A request on GitHub to merge your branch into `main`. Jacob reviews and clicks merge. This is how your work goes live. |
| **Terminal** | The window where you type commands. On Windows: PowerShell (press Start, type "powershell"). On Mac: Terminal (Cmd+Space, type "terminal"). Claude Code also has one built in. |
| **`.env` file** | A small settings file that holds your secret API key. It lives only on your computer and must never be shared or committed. |
| **Commit** | A saved snapshot of your changes, with a message describing them. |

## 1. Access you need (ask Jacob)

- [ ] **A GitHub account.** Free, at github.com/signup, if you do not have one.
- [ ] **A collaborator invite** to the repo. Jacob sends it from GitHub;
      you get an email with an "accept invitation" button. Accept it while
      signed in to GitHub.
- [ ] **Your own search-provider API key.** The app runs on **Gemini**
      by default, so what you need is a `GEMINI_API_KEY` from
      aistudio.google.com/apikey, on a project with **billing enabled**
      (search grounding refuses on the free tier). Ask Jacob if you are
      unsure which project to use. Do not share keys; each person uses
      their own.

      (An `ANTHROPIC_API_KEY` is only needed if you deliberately switch
      to the Anthropic provider with `SEARCH_PROVIDER=anthropic`.)
- [ ] **Slack access** to the Compninja workspace (you likely have this).

You do NOT need accounts for Supabase, Stripe, Resend, or Google Maps.
The app detects they are missing and quietly uses local files instead.

## 2. Install the two tools (one time, 10 minutes)

**Node** is the program that runs the server. **Git** is the program that
talks to GitHub. Check whether you already have them: open a terminal and
type each line below, pressing Enter after each.

```bash
node --version
```

```bash
git --version
```

If a version number comes back (like `v22.1.0`), that tool is installed.
If you get "not recognized" or "command not found":

- **Node:** download the LTS installer from https://nodejs.org and run it,
  accepting all defaults. Anything version 18 or higher works.
- **Git:** download from https://git-scm.com/downloads and run it,
  accepting all defaults (the installer asks many questions; the defaults
  are all fine).

Close and reopen your terminal after installing, then run the two version
checks again to confirm.

## 3. Clone the repo (one time, 2 minutes)

"Cloning" downloads the project to your computer. In your terminal:

**Step 1.** Go to the folder where you want the project to live. For
example, your Documents folder:

```bash
cd Documents
```

(`cd` means "change directory," i.e. move into a folder.)

**Step 2.** Clone:

```bash
git clone https://github.com/agouraninja-cmd/market-comp-puller.git
```

Git may pop up a window asking you to sign in to GitHub; sign in with the
account that accepted the invite. When it finishes you will have a new
folder called `market-comp-puller` containing the whole project.

**Step 3.** Move into it:

```bash
cd market-comp-puller
```

Every command in the rest of this guide is typed from inside this folder.
If you close your terminal and come back later, `cd` back into it first
(e.g. `cd Documents\market-comp-puller` on Windows).

## 4. Create your `.env` file (one time, 2 minutes)

The server reads your API key from a file named exactly `.env` in the
project folder.

**Step 1.** Make a copy of the example file. In the terminal:

On Windows (PowerShell):
```bash
copy .env.example .env
```

On Mac:
```bash
cp .env.example .env
```

**Step 2.** Open the new `.env` file in any text editor (Notepad is fine:
type `notepad .env` in the terminal on Windows). Replace
`your-gemini-key-here` with your real key, so the line reads:

```
GEMINI_API_KEY=...your actual key...
```

Keep the key on one line with nothing after it, save, and close. That is
the only line you need; ignore the commented-out optional lines.

To confirm the key is being read, start the app (next section) and visit
http://localhost:3000/healthz — it should report `"hasKey":true`. The
startup banner also warns by name when the key is missing.

## 5. Run the app

In the terminal, from the project folder:

```bash
npm start
```

You should see a message that the server is listening on port 3000. Open
your web browser and go to:

```
http://localhost:3000
```

That is CompNinja, running entirely on your machine ("localhost" means
"this computer"). To stop the server, click on the terminal and press
Ctrl+C.

There is nothing else to install. No `npm install`, no build step, no
database. If `npm start` worked, setup is done.

Also run the test suite once to see it pass:

```bash
npm test
```

It finishes in about ten seconds and runs a couple of thousand checks.
They cover the pure rule modules (entitlements, the comp gate, the vault,
valuation math and so on) plus route-level wiring — but not the app as a
whole, so green tests do not mean the product works; they mean those rules
are intact. Trust the summary the run prints over any count written down
in a document.

## 6. Searches cost real money

Every fresh search you run locally bills the provider key in YOUR `.env`
roughly **$0.36**, and takes 40-70 seconds. Two things keep development
cheap:

- **Identical searches are cached for 30 days.** Re-running the same
  address + property type + settings is free and instant. Pick one test
  address and reuse it all day.
- If you are only working on how things look, you rarely need a fresh
  search at all: run one, then keep iterating against the cached result.

## 7. The codebase in sixty seconds

| File | What it is |
|---|---|
| `CLAUDE.md` | The project bible. Claude Code loads it automatically and it explains every non-obvious flow. Skim it once yourself. |
| `server.js` | The entire backend. If you edit it, stop the server (Ctrl+C) and `npm start` again or your change does nothing. |
| `index.html` | The entire front end. Edits show up with just a browser refresh; no restart needed. |
| `entitlements.js` | The paid tier's decision rules. If you touch it, run `npm test`. |
| `comp-gate.js` | How a report is trimmed for a plan. The free comp cap was retired in Aug 2026 (free reports now itemize every comp), but the machinery still runs whenever a cap applies. Also tested. |
| `stripe.js` | Payment plumbing. Owen owns the Stripe account side. |
| `tailwind.css` | Pre-built styling file, checked in. See rule 3 below. |
| `devlog.json` | The project changelog, shown at `/dev` on the site. See rule 4. |
| `market-seed.json` | Static data behind the public market pages. |

## 8. House rules

1. **Never push to `main`.** Render publishes `main` to the live site
   within minutes, with no review. Always work on your own branch:
   ```bash
   git checkout -b chuck/what-you-are-doing
   ```
   (`checkout -b` creates a new branch and switches to it.) When your work
   is ready, push the branch and open a pull request on GitHub; Jacob
   reviews and merges. Claude Code can do the branch, commit, push, and PR
   for you if you ask.
2. **`CLAUDE.md` is authoritative.** When it says something surprising,
   believe it; most paragraphs exist because something broke once. You can
   also just ask Claude Code questions about the project; it reads this
   file on its own.
3. **New styling classes need a regeneration step.** The styling file
   `tailwind.css` is pre-built. If you add a class name that is not
   already used somewhere in `index.html`, it silently will not style.
   Ask Claude Code to "regenerate tailwind.css" and commit the updated
   file together with your HTML change.
4. **The devlog rule.** Every shipped fix or feature gets an entry added
   to `devlog.json` in the same commit, like:
   ```json
   { "date": "2026-08-05", "type": "fix", "title": "What you fixed" }
   ```
5. **If you touch `entitlements.js`, `comp-gate.js`, or `stripe.js`, run
   `npm test`.** It takes 0.1 seconds.
6. **Never commit secrets or personal data.** `.env`, `leads.jsonl`,
   `account-store.json` and similar files are deliberately excluded from
   git. If `git status` ever lists a file you did not expect, stop and ask
   before committing.
7. **Copy rules for anything user-facing:** the site never claims to be a
   broker (we "connect you with a local broker"), every valuation is an
   "automated estimate" and never an "appraisal," and the Adler name
   appears nowhere.

## 9. Suggested first session

1. Run the app and do one search (Industrial, any Ontario CA address is a
   good choice) and click through the whole report. That is one well-spent
   dollar.
2. Skim `CLAUDE.md` with coffee. It is long because the app has real
   subtleties; it will save you a bad afternoon.
3. Ask Claude Code for a tour: "explain how a search request flows from
   index.html through server.js and back."
4. Pick something small for a first pull request, just to exercise the
   whole loop: branch, change, devlog entry, PR, Jacob merges.

## 10. When something looks broken

- You changed server behavior and nothing happened: you edited `server.js`
  without restarting the server (Ctrl+C, then `npm start`).
- A style is not applying: the class is missing from the pre-built
  `tailwind.css` (rule 3).
- A search fails once and works on retry: known behavior for slow
  international searches. The call deadline is derived per search (it
  scales with the search budget and output size), not a fixed 100 seconds.
- Anything else: ask in Slack, or ask Claude Code, which knows this
  codebase's failure modes.
