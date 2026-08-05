# Broker vault v1 — the plan, in plain English

**Date:** 2026-08-05
**Status:** Draft for the owner to approve or push back on. No code written yet.
**Design spec:** `docs/superpowers/specs/2026-08-05-broker-tier-design.md`
**Source:** CompNinja Ecosystem Plan §3 (v1: "data vault + dashboard").

This is written to be read by a person, not executed by an agent. Once the
shape below is agreed, it gets turned into the usual task-by-task plan.

---

## What we are building

A private page where a broker uploads their own comp data and gets it back
organized — sortable and filterable by property and by market.

That is the whole of step one. Not the leads, not the public directory, not
sharing anything. Just: put your data in, get it back tidy.

## Why this one first

Brokers currently have no login. Everything else we want to build for them —
showing them owners who want a broker, listing them in a directory, letting
them publish a comp for public credit — needs a place for them to log into.
This is that place.

It is also the cheapest honest test of whether brokers want any of this. If
nobody uploads anything, we learn that before building the harder parts.

---

## What it looks like

A broker signs in and sees a **Vault** link in the nav that nobody else sees.

**Top of the page**, one line, always visible:

> 428 comps · 0 published · visible only to you

That line is the product promise made checkable. A broker will not upload
their book of business because our terms say we cannot read it; they will
upload it because they can see a number that stays at zero.

**Upload box.** Drag in a spreadsheet, or click to browse. It reads the file,
shows what it found, and asks for confirmation before saving anything.

**The table.** Everything they have uploaded, sorted however they like:
address, market, property type, sale or lease, date, price, size, $/SF.
Filter by market, filter by property type. Those two filters are the
"by property and by market" promise from the plan.

**Uploads are batches.** Each import is one group they can see and delete in
one click. If a broker imports the wrong file, undoing it is one action, not
forty.

---

## What it touches, and what it does not

**New:** one page, a handful of routes behind it, and two new database tables.

**Unchanged:** the search, the report, the valuation, the map, exports, the
pricing modal, the market pages, the BOV button — everything a current
visitor touches. This step does not modify a single existing table.

That is the reason this is a safe first step. If the vault page were
completely broken, someone looking up what their building is worth would
never find out.

## How it stays hidden until we want it

The page is gated on the broker entitlement that already exists in the code
(`canUseVault`). Today that is false for everyone, because the broker plan has
no price attached and nobody can buy it.

The one exception is a signed-in admin, which is deliberate — it means you and
Jacob can open the page on the live site and use it for real, while no visitor
can reach it and no visitor's experience changes. Same way the Pro tier
shipped.

Turning it on later is: decide a price, create it in Stripe, set one
environment variable.

---

## Five decisions I have made, and the case against each

Push back on any of these. They are judgment calls, not facts.

### 1. Spreadsheets now, PDFs later

The plan says "CSV or PDF". I would ship the spreadsheet half first.

Reading a PDF comp report means asking the AI to pull numbers out of it. That
costs money on every upload, and it is sometimes wrong. A wrong number in a
broker's own private records is worse than no import feature — they will
check the first one, find an error, and never trust it again.

Spreadsheets are exact. Add PDF once a real broker asks for it and we can
watch it work on their actual documents.

*The case against:* brokers genuinely do receive comps as PDFs, and "email me
your PDF and I'll do it" may be the thing that wins the first few customers.
That is a fine answer too — it is just a manual service, not a feature.

### 2. A template to fill in, not clever column matching

Broker spreadsheets have whatever headings the broker felt like. "Sale
Price", "Price", "$", "Consideration" all mean the same thing.

Three ways to handle that: give them a template to paste into; build a screen
where they match their columns to ours; or have the AI guess. I would start
with the template. It costs an afternoon, it never guesses wrong, and it
never silently puts the sale price in the size column.

*The case against:* it puts work on the broker at the exact moment we are
asking them to trust us. If the first three brokers find it annoying, that is
a clear signal to build the matching screen, and we will have learned it
cheaply.

### 3. Broker data goes in its own tables

Not a "private" checkbox on the existing comp table.

The public comp lookup is deliberately built to ignore its own errors so that
a database hiccup can never break someone's search. That is correct, and it
means a missed filter would leak broker data into public reports **and
nothing would alert us** — this exact blindness once hid a total outage for
weeks. Separate tables make the leak impossible rather than unlikely.

*The case against:* two tables holding similar-looking data is more code.
Worth it here.

### 4. If the database is down, refuse the upload

Everywhere else on the site, when the database fails we quietly write to a
file so nothing is lost. Not here. Render erases its disk on every deploy, so
a broker's uploaded data would silently disappear days later.

Better to say "we could not save that, try again in a minute" than to accept
something we are going to lose.

### 5. Fix how the site decides who is a broker

Right now the site answers "is this person a broker?" by checking whether
their email address has ever submitted a comp through the form. Once brokers
can pay, that is the wrong question — someone who subscribes but has not
submitted anything would not count.

So: "is a broker" becomes "has a broker subscription", and the old fact keeps
working under a separate name for the green Verified badges.

This is small, and it belongs in this step rather than after it, because
every broker page we build from here on asks that question.

---

## What could go wrong, and what stops it

| Worry | What prevents it |
|---|---|
| Broker data shows up in a public report | Separate tables, read by separate code, plus a test that fails if the public lookup ever returns a vault row |
| One broker sees another broker's data | Every read filtered by account, with a test |
| A malformed spreadsheet breaks the site | Every row validated; a bad file is rejected with a readable message, never a crash |
| Someone uploads a million rows | A cap per upload and per account |
| We lose a broker's data | No writing to disk; if the database is unavailable the upload is refused, not half-saved |

---

## Explicitly not in this step

- Publishing a comp publicly for credit (that is step two, and it is where the
  real value is — but it needs the vault to exist first)
- Showing brokers the owners who want a BOV (step three)
- A public broker directory (step four)
- Broker comps feeding into their own valuation reports
- PDF import
- Ratings

---

## Who builds what

The natural split, based on what each of you already owns:

**Jacob:** the two new tables (the next migration file, `013`) and the page
itself — the upload box and the sortable table. This is the same work as the
`/hq` dashboard and the `/admin` restyle he shipped this week.

**Owen:** the routes behind the page, the access gating, spreadsheet
validation, and the tests — a continuation of the billing work already on the
`broker-tier-billing` branch.

**The migration is the contract.** Whoever writes it, writes it first and
pushes it on its own, before either of you writes code against it. Then both
halves can be built at once without colliding. `server.js` and `index.html`
are single enormous files, so the way this goes wrong is two long-running
branches, not disagreement about the design.

---

## What I need from you

1. **Approve or push back on the five decisions above.** Number 1
   (spreadsheets before PDFs) and number 2 (template before column matching)
   are the two most likely to be wrong, because they are guesses about how
   brokers actually work and you have talked to brokers.
2. **What does a broker's comp actually contain?** I would make the template
   match the fields the site already uses for comps, so that a published comp
   later drops straight into the public records with no translation. If
   brokers routinely track something we do not have a column for, now is the
   cheap moment to add it.
3. **Nothing else.** Pricing can stay open — it does not block this step.
