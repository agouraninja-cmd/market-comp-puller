# 1031 identification worksheet — Design

Date: 2026-08-14
Status: agreed (owner: turn `/1031-exchange` into the tool; keep the explainer)
Touches: `guide-1031.js`, `test/guide-1031.test.js`, `server.js`
(`renderGuide1031Body(signedIn)`, brokers card one-liner),
`test/routes.test.js`, `test/public-pages.test.js`, `CLAUDE.md`,
`docs/ROADMAP.md`, `devlog.json`

Amends: `docs/superpowers/specs/2026-08-08-1031-guide-design.md`. That spec
shipped the public education page. This one keeps the URL, the FAQ JSON-LD,
the not-advice box, and the date-only widget, and puts a worksheet above them.

## Goal

A broker sends this URL so they do not re-explain the clock. An owner lining
up a sale lists the building they are selling and up to three replacements,
sees day 45 and day 180, and runs a CompNinja report on each address.

The page is an **identification worksheet**, not an exchange. CompNinja does
not create, run, or file a 1031.

## What ships

1. **Worksheet on top** — selling property (address + optional type), closing
   date → 45/180 calendar dates, three replacement slots. Each row has
   "Value this building", which hands the address to the app the same way
   the landing form does (`pendingLandingAddress.v1`, never a query string).
2. **Shareable without an account** — the packet rides in the URL fragment
   (`#p=`), which browsers do not send to servers. Same reason hub invite
   tokens and `POST /api/report-access` exist: a street address in a query
   string lands in access logs and Referer headers. Reading and the date
   math stay free and unauthenticated. localStorage `cn1031.v1` keeps a
   refresh from wiping a draft; a hash wins when both are present.
3. **Education stays on this URL**, below the worksheet. Do not move it to
   `/how-it-works` or a blog. People search "1031 exchange"; the FAQPage
   JSON-LD and the workflow are why the URL is in the sitemap.
4. **Print** hides chrome, education, FAQ, and the Value buttons; keeps the
   worksheet, the dates, and the compliance line.

Out of this slice: a saved packet in the database, generating a QI
identification notice, computing tax/boot/gain, recommending replacement
addresses (Address Explorer stays off this page), a hub-shaped workspace.

## Copy rules (test-pinned)

Must appear: educational / not tax, legal, or investment advice / qualified
intermediary / tax advisor / automated estimate / connect you with a local
broker / this is not a written identification (or equivalent: the page is
not the list delivered to a QI).

Must never appear: CompNinja is a broker / we are a qualified intermediary /
we provide tax advice / "your 1031 exchange" as something CompNinja created
/ "appraisal of your".

The widget script still computes **dates only** — no `$`, no gain, no basis,
no tax rate (existing pin).

Value destinations: anonymous `/?auth=signup` (the wall's door); signed-in
`/`. Type may ride the query (`&type=Industrial`); the address never does.
A signed-in render must not contain `/?auth=signup` anywhere, same rule as
every other `marketShell` page.

## Packet

JSON, then base64url, then `#p=`. Shape:

```
{ v: 1, s, st, c, r: [{a, t}, {a, t}, {a, t}] }
```

`s` / `a` are addresses (trimmed, control chars stripped, max 300). `st` /
`t` are a `PROPERTY_TYPES` value or `""`. `c` is `YYYY-MM-DD` or `""`.
Unknown `v`, a fourth replacement, or garbage decode to empty rather than
guess. Always three `r` slots so a missing key cannot look like a fourth
building.

## Rollback

Revert the commit. `/1031-exchange` is a cached `marketShell` page (`vary:
cookie`, hour cache for the anonymous body). Hard-refresh after deploy.
Hash links already in the wild stop filling the form; the education page
remains.
