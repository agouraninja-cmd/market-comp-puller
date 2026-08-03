# CompNinja financial ledger

One command produces an Excel workbook showing revenue in, money out, and net
profit per month — with the Anthropic search cost pulled straight from your
Anthropic bill rather than typed in by hand.

```bash
node ledger/ledger.js
```

Writes `CompNinja-Ledger.xlsx` at the repo root. Zero npm dependencies, like the
rest of the repo.

---

## First: the honest limitation

**The Claude Console dashboard page you linked (`platform.claude.com/dashboard`)
cannot be linked to a spreadsheet.** It is a web page behind a browser login —
there is nothing for Excel to connect to, and screen-scraping a login-gated
console would break the first time the page changed.

What *is* automatable is the same data through the **Admin Usage & Cost API**
(`GET /v1/organizations/cost_report`), which returns the exact billed amounts
the Cost page displays. That is what this ledger uses.

That API needs an **Admin API key**, and there are two conditions:

1. The key is an `sk-ant-admin01-…` key — **not** the `sk-ant-api03-…` key the
   app runs on. Create it at **Console → Settings → API keys → Admin keys**.
2. **The Admin API is not available to individual Anthropic accounts.** If your
   account is a personal one, you first need to create an organization at
   **Console → Settings → Organization**. It's free, and you can be its only
   member.
3. **Only the `admin` role can create one.** If you belong to someone else's
   organization as a `developer` or `user`, the Admin keys section is hidden
   from you entirely and an org admin has to create the key.

### No admin key? Read the Console instead (the recommended path)

You do not need the API to get real billed numbers. The **Cost** page at
[platform.claude.com/cost](https://platform.claude.com/cost) shows the same
figures, and typing them in once a month is a 30-second job with no credentials
to manage.

1. Set **Range** to the completed month.
2. Leave the **API key** filter on **All**. Every key in this organization
   belongs to CompNinja — four people build it — so all of that spend is
   genuinely yours. This is the total-burn reading.
3. Read **Total token cost** and **Total web search cost** as two separate
   numbers — keeping them apart is what shows you the real cost mix.
4. Record them:

```bash
node ledger/add-month.js 2026-08 --tokens 4.32 --search 1.05
```

That writes the correctly-formatted rows into `manual-entries.csv` — right date,
right categories (the em dash is easy to get wrong by hand), right sign.

**Re-running the same month replaces its rows rather than adding more**, so a
month-to-date figure is safe to record and correct later:

```bash
node ledger/add-month.js 2026-08 --tokens 4.32 --search 1.05 --partial   # mid-month
node ledger/add-month.js 2026-08 --tokens 61.80 --search 9.40            # after it closes
```

`node ledger/add-month.js --list` shows every month recorded so far and flags
any still marked month-to-date. `--help` covers `--code`, `--session` and
`--note`.

Only rows this tool wrote are ever touched — anything you typed yourself, and
the file's comments, are left alone.

The estimator knows to stand down for any month that already has a hand-entered
Anthropic cost, so these two paths never double-count each other.

### Cost per search is blended, and that is deliberate

The organization has roughly **10 API keys**, covering both the production
server and four developers' own Claude tooling, and the Cost page cannot tell
them apart in practice. So the ledger books all AI spend as cost of revenue and
divides it by customer searches.

That figure therefore **includes R&D and runs high** — every hour the team spends
building lands in the numerator. The Summary sheet labels it
*"AI cost per billed search (blended)"* for exactly this reason.

**Treat it as an upper bound on the cost of serving a search, never as the
marginal cost to price against.** The real marginal cost is lower, and the error
is in the safe direction: it makes the business look worse than it is, not
better.

The cleanest way to get a true marginal figure, if it ever matters enough, is a
dedicated production key used by nothing else. `add-month.js` already accepts
`--prod-tokens` / `--prod-search` to split a month once that exists; the
difference books to `AI — development` under operating costs.

### If CompNinja ever shares an organization with another project

Not the situation today — every key here is CompNinja's. But the cost report
covers the **whole organization**, so if another project were ever added, its
spend would land in this ledger indistinguishably.

The ledger detects this and warns when it sees more than one workspace billing
costs. To scope it properly:

```bash
node ledger/ledger.js --list-workspaces      # find CompNinja's workspace id
node ledger/ledger.js --workspace wrkspc_01…  # count only that workspace
```

For this to mean anything, CompNinja's API key must live in its own workspace.
If it sits in the org's shared default workspace alongside other projects, the
Cost API cannot separate them and the estimate mode is the more honest number.

If you can do both, add the key and you get billed figures. If you can't, the
ledger still works — it falls back to **estimating** Anthropic cost from the
app's own analytics, and labels every one of those rows `estimate` so a guess is
never mistaken for an invoice.

---

## Setup

Everything is read from `.env` (already git-ignored) or the real environment.

| Variable | What it unlocks | Required? |
|---|---|---|
| `ANTHROPIC_ADMIN_KEY` | Billed Anthropic cost, split into tokens vs web search | No — falls back to estimates |
| `STRIPE_SECRET_KEY` | Subscription revenue + Stripe processing fees | No — no revenue imported without it |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Search volume for the unit-economics rows | No — falls back to `analytics.jsonl` |

```bash
# .env
ANTHROPIC_ADMIN_KEY=sk-ant-admin01-...
```

### The data files are NOT in git

This repository is **public**. The ledger's inputs carry CompNinja's actual
costs, the LLC fee, and — once Stripe is live — revenue and customer payment
descriptions, so they are git-ignored. Only the tooling and the `*.example.csv`
templates are tracked, the same split as `.env` / `.env.example`.

On a fresh clone, start from the templates:

```bash
cp ledger/manual-entries.example.csv ledger/manual-entries.csv
cp ledger/recurring.example.csv ledger/recurring.csv
```

Share the real files with teammates outside git — the generated workbooks are
ignored for the same reason.

Then fill in the two CSVs, which cover everything no API can see:

- **`ledger/recurring.csv`** — fixed monthly costs (Render, Supabase, the
  domain). One line each; the ledger expands it across every month in the
  window. **The shipped file has `0.00` placeholders — replace them with your
  real numbers**, otherwise the operating-cost rows read zero.
- **`ledger/manual-entries.csv`** — one-offs: an annual invoice, a payment taken
  outside Stripe, a contractor, a hardware purchase.

In both files, enter costs as **positive** numbers. The script forces the sign
by category, because a cost typed as `7` instead of `-7` would otherwise quietly
become revenue.

---

## Usage

```bash
node ledger/ledger.js                              # last 12 months
node ledger/ledger.js --from 2026-01 --to 2026-08  # explicit window
node ledger/ledger.js --daily                      # one Anthropic row per DAY
node ledger/ledger.js --out ~/Desktop/ledger.xlsx  # somewhere else
```

`--daily` is for hunting a spend spike. By default Anthropic cost is rolled up to
one row per month per cost type per model — a year of daily token rows is about
1,500 lines of noise and the totals are identical either way.

Re-run it whenever you want fresh numbers; it overwrites the workbook. Anthropic
cost data appears within about five minutes of a request completing.

---

## What you get

**Summary** — a month-by-month P&L:

```
REVENUE                Subscriptions · One-time sales · Refunds
COST OF REVENUE        AI tokens · AI web search · AI code execution ·
                       AI session usage · Payment processing · Maps
GROSS PROFIT           + gross margin %
OPERATING COSTS        AI development (team tooling) · Hosting · Database ·
                       Email · Domain · Other
NET PROFIT / (LOSS)    + a running cumulative line
VOLUME                 Billed searches · cached searches · cost per billed
                       search · leads · break-even searches per month of revenue
```

**Transactions** — every line item, filterable, with a `Source` column
(`anthropic-cost-api`, `stripe`, `stripe-test`, `recurring`, `manual`,
`estimate`) so you can always see where a number came from.

**Rates** — the published Anthropic prices the estimate uses, plus a worked
sanity check of what a 10-search report should cost, so an estimate is auditable
rather than a black box.

### Two things worth knowing

**Costs are negative, revenue positive.** Every subtotal is therefore a plain
`SUM` and net profit is the sum of the column. Excel renders the negatives in
red.

**The Summary sheet is live formulas, not pasted values.** Every figure is a
`SUMIFS` over the Transactions sheet, and 200 blank rows are left inside the
range. Type a new transaction directly into Excel and the whole P&L updates —
you do not have to come back and re-run the script.

---

## Reconciling with `/admin`

The `/admin` dashboard's cost tiles are *estimates* built from
`COST_REPORT_SEARCH` (default `$0.75` per billed comp search). This ledger uses
the same constant for its fallback mode, so the two agree by construction.

Once you have real invoice numbers here, that's the moment to tune
`COST_REPORT_SEARCH` — compare the ledger's **"Cost per billed search"** row
against the assumption on the **Rates** sheet and set the env var to the real
figure. `/admin` and the ledger's fallback both improve at once.

## Current list prices

Verified against platform.claude.com on 2026-08-03. Also on the Rates sheet.

| Item | Price |
|---|---|
| Claude Sonnet 4.6 input | $3.00 / 1M tokens |
| Claude Sonnet 4.6 output | $15.00 / 1M tokens |
| Cache write | 1.25× input |
| Cache read | 0.10× input |
| Web search | $10.00 / 1,000 searches ($0.01 each) |

A search that errors is not billed. Web search is charged **in addition to**
tokens — the search results themselves land in the context window as input
tokens, which is why the token line is usually larger than the search line even
though the search fee is the more visible number.

---

## Files

| File | Role |
|---|---|
| `ledger.js` | Fetches everything and writes the workbook |
| `xlsx.js` | Minimal zero-dependency `.xlsx` writer |
| `recurring.csv` | Your fixed monthly costs — **edit this** |
| `manual-entries.csv` | Your one-off entries — **edit this** |

Both CSVs are yours; the script only ever reads them.

**Do not commit `CompNinja-Ledger.xlsx`** — it contains revenue figures and, if
you use a live Stripe key, customer payment descriptions. It is git-ignored.
