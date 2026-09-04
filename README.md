# CompNinja

A commercial real estate comp and valuation tool, live at
[compninja.co](https://compninja.co). A visitor enters a property address and
type; the server asks a model (with web search) for recent comparable sales
and leases and returns one report that both answers and proves: a value
range, a plain-English market summary, a comp map, and the full sortable comp
table with a source-confidence badge on every row. Brokers get a private
vault for their own comp book, a lead inbox, and a shared shelf for their
firm.

Every valuation is an automated estimate, never an appraisal. CompNinja is
not a licensed broker; the site connects visitors with one.

The model API key lives **only on the server**. The browser never sees it.

## Run it locally

Requires Node.js 18 or newer. There is no build step and no `npm install`:
the server is plain Node with zero dependencies.

```bash
cp .env.example .env      # then paste your real API key into .env
npm start                 # http://localhost:3000
```

`npm start` first runs `node --check server.js` and refuses to boot on a
syntax error. That is the production deploy gate, so keep it.

Most features degrade to local JSON files when no database is configured.
The broker vault, permissioned shares and the watchlist digest deliberately
do not (a local file would be the data loss), so those refuse instead.
CLAUDE.md's "Configuration" section lists every environment variable and
what turning each one on changes.

## Test it

```bash
npm test                                  # the whole suite, about a minute
node --test test/entitlements.test.js     # one suite, under two seconds
```

Nothing needs a real database or mail provider. `test/helpers/fake-supabase.js`
stands in for both where a suite needs them. CI runs the same suite on every
push, and a green `test` check is required to merge into `main`.

## Deploy it

`main` deploys to compninja.co automatically on Render, within minutes, with
no review. Work on a branch and open a pull request. Supabase migrations in
`migrations/` are run by hand, and several must run **before** the code
that reads them deploys; `migrations/README.md` and `migrations/APPLIED.md`
say which, and `migrations/verify.js` checks the live schema.

## Where the real documentation is

| You want | Read |
|---|---|
| Your first local copy, step by step | [ONBOARDING.md](ONBOARDING.md) |
| How anything works, and why it is that way | [CLAUDE.md](CLAUDE.md), the project bible and the authoritative one |
| What shipped, and when | `devlog.json`, rendered at `/dev` on the site |
| What is planned or waiting on a decision | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Design specs and plans for shipped and pending work | `docs/superpowers/specs/`, `docs/superpowers/plans/` |
| Billing and Stripe setup | [PRO-BILLING-SETUP.md](PRO-BILLING-SETUP.md) |
| The design system and brand | [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md), [docs/BRAND.md](docs/BRAND.md) |
| The downloadable desktop app | `desktop-app/` (an Electron shell around the live site, the one folder with npm dependencies) |

If a document and the code disagree, the code is right and the document is
a bug. Fix it in the same commit that made it wrong.

## Disclaimer

Comps come from publicly available data found by web search, plus comps
brokers have chosen to contribute. They are a starting point, not a system
of record. Verify before use in underwriting.
