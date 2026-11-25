---
paths:
  - "owner-lookup.js"
  - "org-contacts.js"
  - "migrations/066-contacts-and-owner-lookups.sql"
  - "test/owner-lookup*.test.js"
---

# Contacts for everyone, and the owner lookup

> Shipped 2026-11-23 (the owner, after a meeting with a broker whose "number
> one problem was finding the contact information to get in front of
> landlords": "Build a new Column for contacts, dont make people firm only,
> lets do web search for now, review the legealityes, yes do what you said
> with the cost control"). Built straight, not from drafts. Claude Code loads
> this file when it opens a file matching `paths` above; read it by hand
> before changing this area's code in `server.js` or `index.html`.
> Pictures: `solo-people`, `solo-owner`, `firm-people` before and after, taken
> on the stand-in database with a stand-in search provider.

## What changed

1. **A contact has a phone number, and says where it came from.** Migration
   066 adds `phone`, `source` and `source_url` to `org_contacts`.
   `org-contacts.js` owns the rules: a phone is kept as typed and refused
   only when it is not a number; `source` is `lookup` or null and can be
   written ONLY by the single typed add (`normalizeContact(src, {
   withSource: true })`), never by an import or an edit; `source_url` is kept
   only beside a source and only as an http(s) address.
2. **People is every member's tab.** It hid for a member in no firm, who
   therefore had no contact list. `user_contacts` (066) is a member's OWN
   list: `GET|POST|PATCH|DELETE /api/account/contacts`, any signed-in
   account, every call scoped by `user_id`, DB-only. A member of a firm has
   both lists and switches with `#contactsScope` ("The firm's" / "Only
   yours"); `contactsWhich(firm)` in index.html is the one place that decides
   which list a read, an add, an import, a delete or a saved owner goes to.
   An account with no building still reaches People: the start screen
   (`#hmFirst`) steps aside for `#people` and carries a door to it
   (`#hmFirstPeople`, `hmOpenPeople`).
3. **Find a property's owner.** `POST /api/owner-lookup { address, type,
   fresh }` runs ONE web search through the comp search's provider seam
   (`ownerLookupSearch`), reads each cited page to check the phone and email
   it was given (`ownerCheckPeople`), stores the answer on the member's
   account (`owner_lookups`) and returns it. `GET /api/owner-lookup` reads
   the month's allowance and the member's earlier lookups. Rules are the
   pure, tested `owner-lookup.js`.

## Doors

- **Home's People tab**, under the contacts (`#ownerFind`): an address box
  and "Find the owner".
- **A property's card on Home's map**: "Find the owner →" on a building the
  member does not own themselves (a firm building, a deal), never a
  Residential one. `hmFindOwner(address, type)` opens People with the box
  filled.
- **A firm building's sheet** (`/building/<id>`, Contacts): "Find the
  owner" writes `{ address, type }` to `sessionStorage` (`cnOwnerAsk`) and
  links `/desk#people`; `takeOwnerAsk()` reads it once and removes it.

**None of the three runs a search.** A search starts only from a press of
"Find the owner", "Look again", or an earlier lookup's row (which is free).

## Rules that must hold

`owner-lookup.js`'s header lists seven; the ones a person on the other end
pays for:

1. **Commercial property only.** `lookupRefusal` refuses a Residential type
   and a bare unit before any search; the prompt tells the model to answer
   `{"residential":true}` and nothing else for a home; `parseAnswer` keeps
   nothing beside that flag (a test stores a "homeowner" and looks for the
   name in the table).
2. **Public records and the owner's own pages. Never a people-search or
   data-broker site.** The prompt says so, and `PEOPLE_SEARCH_HOSTS` is the
   backstop: a person whose cited page is on one is dropped whole, a record
   link on one is dropped, and such a page is never fetched.
3. **A contact detail is copied or absent** (the BOV desk's rule 6). No http
   source page, no phone and no email. The 555-01xx range (reserved for
   fiction, which an inventing model reaches for) is dropped. Then the server
   READS the page: `phone_check` / `email_check` are `on_page`,
   `not_on_page` or `unchecked`, and the screen shows which. A failure of
   any kind is `unchecked`, never `on_page`. The fetcher is the BOV desk's
   (`fetchSite`, DNS-guarded, capped, 10 s budget; `BOV_PAGE_ORIGIN` is the
   same test-only stand-in).
4. **The answer is the member's own.** `owner_lookups` is read only by
   `user_id`. There is deliberately NO cache shared across accounts: which
   buildings a broker is chasing is their book (rule 3 of CLAUDE.md), and a
   shared file of owners' contact details that CompNinja serves to
   subscribers is what a data broker is (see the legal review). A second
   member looking up the same building runs, and is counted for, their own
   search.
5. **Nothing becomes a contact on its own.** A lookup writes `owner_lookups`
   and nothing else. "Save" is one person, pressed, through the contacts'
   ordinary typed add with `source: "lookup"`.
6. **Count a search only when it answered.** A provider error, a timeout or
   an unreadable answer stores nothing. "Nothing found" and "that is a home"
   are answers and count: the search ran and was billed.
7. **We contact nobody.** Nothing dials, texts or mails an owner. `USE_NOTE`
   rides with every answer.
8. **The address rides the POST body**, never a query string or a link, and
   the log line carries a market, a type and a count, never the address or a
   name.
9. **`source` cannot be forged or erased by an edit.** The PATCH writes only
   what `validateContactEdit` returns, which never includes it.

## Cost control

- **Part of Pro** (`requireOwnerLookup`: 401, 403 without `canUseVault`,
  503). `canUseVault` is the capability the Pipeline and a member's deals
  stand on; entitlements.js decides it (never-break rule 1), and a Pro-off
  deployment offers no lookup.
- **`OWNER_LOOKUPS_PER_MONTH`, default 100**, per member per UTC month,
  counted off the member's own rows this month. `0` or `off` switches the
  feature off (the rollback): both routes answer 503 `off`.
- **`OWNER_DAILY_SEARCHES`, default 150**, the whole site per UTC day, in
  memory (the BOV desk's kind of backstop).
- **Reopening a building is free for 90 days** (`CACHE_DAYS`): the member's
  own stored answer, matched on `addressKey`. "Look again" (`fresh: true`)
  spends a lookup.
- **One search per member at a time** (`OWNER_INFLIGHT`), and a per-IP rate
  limit.
- **The allowance is not derived from anything a member can delete.** There
  is no delete route for a lookup, on purpose: a row is the count. If one is
  ever added it must blank the answer and keep the row.

## Migration 066

`066-contacts-and-owner-lookups.sql`: three nullable columns on
`org_contacts`, and two new tables, `user_contacts` and `owner_lookups`.
Purely additive. **Deploy order is SOFT**: `contactsV2Ready()` probes for all
of it (061's and 063's pattern, re-checked every five minutes after a miss),
so code deployed ahead of the migration keeps the firm's contact list working
with its four old fields and answers `not_ready` for the member's own list
and the lookup. Tested with the stand-in's `missingColumns` and
`missingTables`.

## The legal review (2026-11-23)

Not legal advice: this is a reading of public guidance, written so the owner
can take the right questions to a lawyer before this is sold widely. The
sources are FTC and FCC pages and law-firm summaries found that day.

| Law | What it is | How the build answers it | What is left for a lawyer |
|---|---|---|---|
| **FCRA** (Fair Credit Reporting Act) | A company that assembles information on people for use in credit, tenant, employment or insurance decisions is a "consumer reporting agency". The FTC has treated people-search sites that way, and a disclaimer alone does not cure it. | The tool is about commercial property and business contact. It is never offered for screening, the use note says so on every answer, and no people-search or background-check site is a source. | Put the same restriction in the Terms of Service, so it is a condition of use and not only a note. |
| **Do Not Call / TCPA** | The National Do Not Call Registry covers personal numbers, including personal cell phones. Calls to a business to sell to that business are mostly exempt. The TCPA restricts auto-dialed and prerecorded calls and texts to cell phones. | We never dial or text. The prompt forbids a home number and asks only for a number published to reach the owner on business. The use note tells the member to check the Registry before calling a personal number and never to auto-dial or text. | A small landlord's "business" number is often their cell, and a broker's call can be telemarketing. Whether the member's calls are exempt is the member's question, state by state (Florida, Oklahoma, Washington and others have stricter rules). |
| **CAN-SPAM** | Applies to business-to-business email too. A marketing email needs a real postal address and a working opt-out, honored within 10 business days. | We send nothing to an owner. The use note says what a marketing email needs. | Nothing for CompNinja. It is the sender's duty. |
| **State data broker laws** (California, Vermont, Texas, Oregon, and from 2026 Connecticut and New Jersey) | A business that collects and sells personal information about people it has no relationship with may have to register, pay a fee and honor deletion requests. California's also depends on size thresholds. | The biggest design choice here: there is no shared file. Each lookup is a search a member ran, stored on that member's account only, from public records and the owner's own pages, about commercial property. | Ask whether that keeps CompNinja outside these definitions, especially Vermont's and Texas's, which have no size threshold. This is the question to ask before raising the allowance or adding a shared cache. |
| **Daniel's Law** (New Jersey) and laws like it | Judges, police and some other officials can demand that a business stop disclosing their HOME address and phone. Suits have reached real-estate data companies, not only data brokers. In August 2026 the state supreme court said damages need willful or reckless disregard. | Homes are refused three ways (rule 1), and only business contact is asked for. | There is no takedown process yet. See "Not built". A covered person can also own commercial property through their own name and home mailing address, which a county record shows. |
| **CCPA and other state privacy laws** | Rights to know and delete for consumers, with exemptions for public records and size thresholds. | Public records and business contact only; CompNinja is far under the thresholds today. | Add owner lookups to the Privacy Policy: what is stored, for how long, and how a person named in one asks for removal. |
| **Real estate licensing** | The owner is not a licensed broker (CLAUDE.md). | Nothing here says CompNinja is one or contacts an owner on anyone's behalf. | None. |
| **Source terms** | County and state sites and the search provider have their own terms. | Searches go through the provider's own web search; pages are read once, by our server, with the BOV desk's polite fetcher. | Read the search provider's terms on storing results. |

**The three things worth doing before this is marketed:** add permitted-use
language to the Terms; add owner lookups to the Privacy Policy with a removal
contact (info@compninja.co); and have a lawyer confirm the data-broker
question for the states sold into.

## What has NOT been measured

**The prompt has never been run against the live model** (no search key in
the session that wrote it). How often a county record is found, how often a
person behind an LLC is named, and how often a phone or email survives the
page check are all unknown. The `owner_lookup` analytics event (`source`:
`found:N`, `none`, `residential`, `unreadable`, `failed:<status>`,
`timeout`, `kept`) and the log line are where that evidence accumulates. Run
twenty buildings whose owners are known before telling a broker what to
expect. If web search finds too few phone numbers, the paid skip-trace API
priced in the 2026-11-23 research (about four cents a hit) is the next step,
and it brings the FCRA and data-broker questions with it.

## Not built

- **A takedown.** A person who asks for their details to be removed is
  handled by hand today: delete the rows naming them in `owner_lookups`,
  `user_contacts` and `org_contacts` in the SQL editor. A suppression list
  the lookup checks before answering is the proper version.
- **Deleting a lookup** from the member's history (see Cost control).
- **Attaching a saved owner to the firm's building** automatically. The
  sheet's Attach door still does that by hand.
- **A list of addresses at once.** One building per search.
- **The door on a deal's own pane** (`home-sites.js`). The map card and the
  People tab are the doors.
- **Terms and Privacy Policy wording** (above). Those pages were not edited.

## Tests

`test/owner-lookup.test.js` (the rules: homes, sources, copied-or-absent, the
page check, the allowance), `test/owner-lookup-run.test.js` (a real server:
the gate, one press one search, the answer is the asker's alone, free
reopening, failures cost nothing, the caps, the off switch, a member's own
contacts and their privacy, an unrun 066), `test/org-contacts.test.js` (the
phone and the source), `test/org-run.test.js` (the firm's routes with and
without 066), `test/org-desk.test.js` (the two lists on Home).
