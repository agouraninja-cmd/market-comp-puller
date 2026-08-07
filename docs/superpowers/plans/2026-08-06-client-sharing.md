# Client Sharing (broker tier v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member send a valuation report to named clients instead of to a public URL, with a revocable per-report viewer list, and make the client's valuation match the broker's by folding private vault comps into the anonymized basis.

**Architecture:** One new pure module (`report-access.js`) answers "may this user read this share?" with no I/O, the way `entitlements.js` answers "what may this user do". `server.js` owns every read and write. `shared_reports` gains an owner, a visibility, a revoke stamp and a `report_viewers` child table (migration 018). The share route grows three optional body fields; the read route grows a viewer check that fails closed. The front end grows a share panel, a sign-in card on `/r/<id>`, and two `/desk` lists.

**Tech Stack:** Plain Node (built-in `fetch`, `node:test`), zero npm dependencies, Supabase over PostgREST, vanilla JS in a single `index.html`.

**Spec:** `docs/superpowers/specs/2026-08-06-client-sharing-design.md`. Read it before Task 1; this plan implements it and does not restate its reasoning.

## Global Constraints

- **Zero npm dependencies.** Node 18+ built-ins only. No build step.
- **Pure modules stay pure:** no I/O, no `require` of impure code, no clock reads (callers pass `now`). This is what lets `npm test` run with no database.
- **`npm test` must pass after every task.** It takes about 1.5 seconds; there is no excuse for skipping it.
- **Never test a plan or subscription status outside `entitlements.js`.** Use `entitlementsFor(req)` / `getEntitlements(user)`.
- **The privacy wall:** no vault row may reach `harvestComps()`, `corpusRowsForMarket()`, a market snapshot, the search cache, or another account's report.
- **Fail closed.** Any error resolving an owner, a visibility or a viewer list refuses the read.
- **Devlog rule:** shipping work appends an entry to `devlog.json` in the same commit. Save it as clean UTF-8; em dashes and curly quotes are correct raw, never ASCII-escaped.
- **Migrations:** new DDL is the next numbered file in `migrations/`, must be taught to `migrations/verify.js`, and must be run before deploy.
- **Tailwind:** any NEW utility class added to `index.html` needs the vendored `tailwind.css` regenerated (a Claude Code hook does it in-session; do not also regen by hand).
- **Restart rule:** editing `index.html` needs no restart; editing `server.js` does.

---

### Task 1: `report-access.js`, the decision

**Files:**
- Create: `report-access.js`
- Test: `test/report-access.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `canReadShare({ share, viewers, user }) -> { ok: boolean, reason: string }` where `reason` is one of `"public"`, `"owner"`, `"invited"`, `"revoked"`, `"not_invited"`, `"signin_required"`. Also `normalizeEmail(s) -> string`. Task 6 calls both; Task 5 and Task 7 call `normalizeEmail`.

- [ ] **Step 1: Write the failing test**

Create `test/report-access.test.js`:

```js
// The share access decision, exhaustively. Pure like entitlements.test.js:
// no server, no database, no clock.
const test = require("node:test");
const assert = require("node:assert");
const { canReadShare, normalizeEmail } = require("../report-access.js");

const OWNER = { id: "u1", email: "broker@firm.com" };
const CLIENT = { id: "u2", email: "client@acme.com" };
const STRANGER = { id: "u3", email: "nobody@else.com" };

const pub = { id: "s1", user_id: "u1", visibility: "public", revoked_at: null };
const inv = { id: "s2", user_id: "u1", visibility: "invited", revoked_at: null };
const viewers = [{ email: "client@acme.com" }];

test("a public share is readable by anyone, signed in or not", () => {
  assert.deepEqual(canReadShare({ share: pub, viewers: [], user: null }), { ok: true, reason: "public" });
  assert.equal(canReadShare({ share: pub, viewers: [], user: STRANGER }).ok, true);
});

test("an invited share refuses an anonymous reader with signin_required", () => {
  const d = canReadShare({ share: inv, viewers, user: null });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "signin_required");
});

test("an invited share admits an invited email", () => {
  assert.deepEqual(canReadShare({ share: inv, viewers, user: CLIENT }), { ok: true, reason: "invited" });
});

test("the invite matches on email case-insensitively and ignores surrounding space", () => {
  const messy = [{ email: "  Client@Acme.COM " }];
  assert.equal(canReadShare({ share: inv, viewers: messy, user: CLIENT }).ok, true);
});

test("a signed-in stranger is refused with not_invited, not signin_required", () => {
  // signin_required would send them to a sign-in card they are already past.
  const d = canReadShare({ share: inv, viewers, user: STRANGER });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "not_invited");
});

test("the owner always reads their own invited share", () => {
  assert.deepEqual(canReadShare({ share: inv, viewers: [], user: OWNER }), { ok: true, reason: "owner" });
});

test("revocation beats everything, including the owner and a public link", () => {
  const dead = { ...pub, revoked_at: "2026-08-06T00:00:00Z" };
  assert.equal(canReadShare({ share: dead, viewers: [], user: OWNER }).reason, "revoked");
  assert.equal(canReadShare({ share: dead, viewers: [], user: null }).reason, "revoked");
  const deadInv = { ...inv, revoked_at: "2026-08-06T00:00:00Z" };
  assert.equal(canReadShare({ share: deadInv, viewers, user: CLIENT }).ok, false);
});

test("an unknown visibility is treated as invited, never as public", () => {
  // Fails closed: a typo in a column must not publish a report.
  const weird = { ...inv, visibility: "sort-of-public" };
  assert.equal(canReadShare({ share: weird, viewers, user: STRANGER }).ok, false);
  assert.equal(canReadShare({ share: weird, viewers, user: CLIENT }).ok, true);
});

test("a missing share is refused rather than thrown at", () => {
  assert.equal(canReadShare({ share: null, viewers: [], user: OWNER }).ok, false);
});

test("an ownerless legacy row is still public", () => {
  // Every row written before migration 018 has user_id null.
  const legacy = { id: "s0", user_id: null, visibility: "public", revoked_at: null };
  assert.equal(canReadShare({ share: legacy, viewers: [], user: null }).ok, true);
});

test("normalizeEmail lowercases and trims, and rejects junk to empty", () => {
  assert.equal(normalizeEmail("  Foo@Bar.com "), "foo@bar.com");
  assert.equal(normalizeEmail("not-an-email"), "");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail("a@b.co"), "a@b.co");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/report-access.test.js`
Expected: FAIL, `Cannot find module '../report-access.js'`.

- [ ] **Step 3: Write the module**

Create `report-access.js`:

```js
// ---------------------------------------------------------------------------
// Who may read a shared report.
//
// Spec: docs/superpowers/specs/2026-08-06-client-sharing-design.md
//
// PURE, like entitlements.js and comp-gate.js: no I/O, no requires, no clock
// reads. server.js owns the reads (the share row, its viewer rows, the
// session) and hands them in. That is what lets `npm test` prove the gate
// holds with no database.
//
// One function answers the question, and nothing else in the codebase may
// answer it. Scattered checks are how a paywall grows holes, and this one
// guards a broker's private comps rather than a comp count.
//
// EVERYTHING FAILS CLOSED. An unrecognized visibility is treated as invited,
// not as public: a typo in a column must never publish a report.
// ---------------------------------------------------------------------------

// A share id in a URL is public knowledge; an email is not. Matching is done
// on the normalized form so "Client@Acme.COM " on the invite and
// "client@acme.com" on the account are the same person.
function normalizeEmail(s) {
  const v = String(s == null ? "" : s).trim().toLowerCase();
  // Deliberately loose: one @, something either side, no whitespace. Real
  // deliverability is Resend's problem; this only has to stop junk becoming a
  // viewer row that can never match.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

/**
 * @param {object|null} share    a shared_reports row: { user_id, visibility, revoked_at }
 * @param {Array}       viewers  report_viewers rows for that share: [{ email }]
 * @param {object|null} user     from getSessionUser(): { id, email } or null
 * @returns {{ok: boolean, reason: string}}
 */
function canReadShare({ share, viewers, user }) {
  if (!share || typeof share !== "object") return { ok: false, reason: "not_invited" };

  // Checked first, above every other rule: revocation is the one control a
  // broker has after a link has left their hands, and it has to beat their own
  // ownership too, or "revoked" would mean "revoked for other people".
  if (share.revoked_at) return { ok: false, reason: "revoked" };

  if (share.visibility === "public") return { ok: true, reason: "public" };

  // Invited from here down (including any unrecognized visibility).
  if (user && share.user_id && String(user.id) === String(share.user_id)) {
    return { ok: true, reason: "owner" };
  }
  if (!user) return { ok: false, reason: "signin_required" };

  const mine = normalizeEmail(user.email);
  const list = Array.isArray(viewers) ? viewers : [];
  const invited = mine && list.some((v) => normalizeEmail(v && v.email) === mine);
  return invited ? { ok: true, reason: "invited" } : { ok: false, reason: "not_invited" };
}

module.exports = { canReadShare, normalizeEmail };
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/report-access.test.js` then `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add report-access.js test/report-access.test.js
git commit -m "Who may read a shared report, as one pure decision"
```

---

### Task 2: Migration 018

**Files:**
- Create: `migrations/018-report-sharing.sql`
- Modify: `migrations/verify.js`
- Modify: `migrations/APPLIED.md`

**Interfaces:**
- Produces: `shared_reports.user_id | visibility | include_private | revoked_at`, and table `report_viewers (id, share_id, email, invited_at, first_viewed_at, last_viewed_at)`. Tasks 4 through 7 read and write exactly these names.

- [ ] **Step 1: Know the two lists you must edit**

`migrations/verify.js` keeps `TABLES` (a table plus the migration that creates it) and `COLUMNS` (a table, the columns an ALTER added, and the migration). Step 3 adds one line to each. Do not invent a second mechanism; that file exists so the expected schema lives in exactly one place.

- [ ] **Step 2: Write the migration**

Create `migrations/018-report-sharing.sql`:

```sql
-- 018 · Permissioned report sharing (broker tier v3, 2026-08-06)
-- Spec: docs/superpowers/specs/2026-08-06-client-sharing-design.md
-- Plan: docs/superpowers/plans/2026-08-06-client-sharing.md
--
-- RUN BEFORE DEPLOYING the sharing routes.
--
-- ---------------------------------------------------------------------------
-- EVERY DEFAULT HERE IS A BACKWARD-COMPATIBILITY PROMISE
-- ---------------------------------------------------------------------------
-- shared_reports has been an unowned, public, permanent link since the feature
-- shipped, and those links are already in the world: the BOV follow-up email
-- has mailed /r/<id> to property owners who have no account and never will.
-- So visibility defaults to 'public' and user_id is nullable. An existing row
-- must keep behaving EXACTLY as it does today.

alter table shared_reports
  add column if not exists user_id uuid references users(id) on delete set null,
  add column if not exists visibility text not null default 'public',
  add column if not exists include_private boolean not null default false,
  add column if not exists revoked_at timestamptz;

-- set null, NOT cascade: a member deleting their account must not silently
-- break a link their client is relying on. The share loses its owner and
-- becomes unmanageable, which is the honest outcome rather than a vanishing.

-- "My shared reports" on /desk, and nothing else, reads by owner.
create index if not exists shared_reports_user_idx
  on shared_reports (user_id, created_at desc)
  where user_id is not null;

-- The viewer list. Identity is the EMAIL, not a user id: a client invited
-- before they have an account gets access the moment they sign up with that
-- address, with nothing to reconcile.
create table if not exists report_viewers (
  id uuid primary key default gen_random_uuid(),
  share_id text not null references shared_reports(id) on delete cascade,
  email text not null,                 -- normalized (lowercased, trimmed) by report-access.js at write time
  invited_at timestamptz not null default now(),
  first_viewed_at timestamptz,         -- stamped once, on the first successful read
  last_viewed_at timestamptz,
  unique (share_id, email)
);

-- "Shared with me" on /desk reads by email.
create index if not exists report_viewers_email_idx on report_viewers (email);

alter table report_viewers enable row level security;

-- Verify (zero rows = applied):
--   select c from unnest(array['user_id','visibility','include_private','revoked_at']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name='shared_reports' and column_name = c)
--   union all
--   select 'report_viewers' where not exists (select 1 from information_schema.tables
--                                             where table_name='report_viewers');
```

- [ ] **Step 3: Teach verify.js about it**

In `TABLES`, after the `broker_properties` line:

```js
  ["report_viewers",      "018-report-sharing.sql"],
```

In `COLUMNS`, after the 017 entry:

```js
  // 018 makes a share ownable and revocable. Without these columns every
  // sharing route 400s at PostgREST, and the read path would fall back to
  // treating a permissioned share as a public one — the one failure this
  // feature must never have.
  ["shared_reports",    ["user_id", "visibility", "include_private", "revoked_at"],
                                                                "018-report-sharing.sql"],
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: pass. (`vault-api.test.js` cross-checks migrations against the API contract; if it complains about an unknown table, follow its message rather than weakening the test.)

- [ ] **Step 5: Note it as NOT yet applied**

Add a line to `migrations/APPLIED.md` in the file's existing format recording that 018 is pending, to be flipped when it is run against production.

- [ ] **Step 6: Commit**

```bash
git add migrations/018-report-sharing.sql migrations/verify.js migrations/APPLIED.md
git commit -m "018: an owner, an audience and a revoke for shared reports"
```

---

### Task 3: `anonymizePrivateComps`

**Files:**
- Modify: `blend-comps.js`
- Test: `test/blend-comps.test.js`

**Interfaces:**
- Consumes: `basisRow` from `comp-gate.js`, `isPrivateComp` (already in this file).
- Produces: `anonymizePrivateComps(report) -> report`. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

Append to `test/blend-comps.test.js`:

```js
const { anonymizePrivateComps } = require("../blend-comps.js");

function blended() {
  return {
    comps: [
      { address: "1 Public St", date: "2026-01-05", transaction: "sale",
        price_or_rate: 1000000, size_sqft: 10000, price_per_sqft: 100, source_type: "listing" },
      { address: "2 Private Rd", date: "2026-03-14", transaction: "sale",
        price_or_rate: 4250000, size_sqft: 31000, price_per_sqft: 137,
        source_type: "broker_vault", notes: "off market, my seller", private: true },
    ],
    locked_count: 0,
    locked_basis: [],
    private_count: 1,
  };
}

test("anonymize removes the private comp from the table", () => {
  const out = anonymizePrivateComps(blended());
  assert.equal(out.comps.length, 1);
  assert.equal(out.comps[0].address, "1 Public St");
});

test("anonymize keeps the private comp in the valuation basis", () => {
  const out = anonymizePrivateComps(blended());
  assert.equal(out.locked_basis.length, 1);
  assert.equal(out.locked_basis[0].price_per_sqft, "137");
  assert.equal(out.locked_basis[0].size_sqft, 31000);
});

test("no address, price, or note survives into the basis", () => {
  const json = JSON.stringify(anonymizePrivateComps(blended()));
  assert.equal(json.includes("2 Private Rd"), false);
  assert.equal(json.includes("4250000"), false);
  assert.equal(json.includes("my seller"), false);
});

test("private_count survives so the page can say how many are folded in", () => {
  assert.equal(anonymizePrivateComps(blended()).private_count, 1);
});

test("an existing locked_basis is appended to, never replaced", () => {
  const r = blended();
  r.locked_basis = [{ date: "2025-12-01", transaction: "sale", size_sqft: 5000, source_type: "public_record" }];
  const out = anonymizePrivateComps(r);
  assert.equal(out.locked_basis.length, 2);
});

test("a report with no private comps comes back untouched, same object", () => {
  const plain = { comps: [{ address: "1 Public St" }] };
  assert.equal(anonymizePrivateComps(plain), plain);
});

test("junk in, junk out, without throwing", () => {
  assert.equal(anonymizePrivateComps(null), null);
  assert.deepEqual(anonymizePrivateComps({ comps: "nope" }), { comps: "nope" });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/blend-comps.test.js`
Expected: FAIL, `anonymizePrivateComps is not a function`.

- [ ] **Step 3: Implement it**

In `blend-comps.js`, add the require at the top (below the header comment) and the function beside `stripPrivateComps`:

```js
// The ONE exception to this file's no-requires rule, and it is a pure module
// requiring a pure module (backtest.js already does the same with
// valuation.js). Taking basisRow from comp-gate rather than copying it means
// the anonymized shape a client sees is the same one a free visitor's locked
// comps use, provably, instead of by review.
const { basisRow } = require("./comp-gate.js");
```

```js
// Replace every private comp with its anonymized basis row.
//
// This is what an INVITED share does by default, where stripPrivateComps is
// what a PUBLIC share does. The difference matters to the number on the page:
// the browser computes the valuation from includedComps() plus lockedBasis(),
// so a stripped report shows the client a DIFFERENT range than the broker saw,
// while an anonymized one matches to the dollar.
//
// What travels: date, transaction, size, $/SF, provenance. What does not:
// address, total price, notes, source url, coordinates. A basis row is a bar
// on a histogram — it cannot be resold, cited, or tied to a property.
//
// private_count is deliberately KEPT. The client is told how many of their
// broker's own deals are inside the number; hiding that would make the range
// unexplainable.
function anonymizePrivateComps(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  if (!Array.isArray(report.comps)) return report;
  const priv = report.comps.filter(isPrivateComp);
  if (!priv.length) return report;      // untouched, same object — see blendPrivateComps
  const basis = Array.isArray(report.locked_basis) ? report.locked_basis : [];
  return {
    ...report,
    comps: report.comps.filter((c) => !isPrivateComp(c)),
    locked_basis: [...basis, ...priv.map(basisRow)],
  };
}
```

Add `anonymizePrivateComps` to `module.exports`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass, including the existing blend-comps and comp-gate suites.

- [ ] **Step 5: Commit**

```bash
git add blend-comps.js test/blend-comps.test.js
git commit -m "A private comp can travel as basis: the number without the identity"
```

---

### Task 4: Storage layer for the ACL

**Files:**
- Modify: `server.js` (the "Shared reports" section, near `getSharedReport` / `storeSharedReport`)

**Interfaces:**
- Consumes: `sbRequest`, `DB_CONFIGURED`, `supabaseHeaders`.
- Produces, all used by Tasks 5 through 7:
  - `getShareRecord(id) -> { payload, share, viewers } | null` where `share` is `{ id, user_id, visibility, include_private, revoked_at, created_at }`.
  - `storeSharedReport(id, payload, opts)` with `opts = { userId, visibility, includePrivate, viewers }`.
  - `stampShareView(shareId, email)` (fire and forget, returns nothing).
  - `setShareViewers(shareId, emails)` where `emails` are already normalized.
  - `revokeShare(shareId, userId)` returning the updated rows, empty if the caller does not own it.
  - `listSharesForOwner(userId)`, `listSharesForViewer(email)`.

- [ ] **Step 1: Read what exists**

Read `server.js` around `getSharedReport`. Note that `sharedReportsMem` caches payloads by id for the life of the process and that `storeSharedReport` currently takes `(id, payload)`.

- [ ] **Step 2: Split the cache, deliberately**

Replace `getSharedReport` with `getShareRecord`, keeping the file fallback for public rows only:

```js
// The PAYLOAD may cache; the ACL may NOT.
//
// sharedReportsMem holds a report body for the life of the process, which is
// right for a body and catastrophic for an access rule: a revoked share would
// keep serving out of memory until the next deploy, and the broker would have
// been told it was off. So visibility, revoked_at and the viewer list are read
// every single time, and only the payload is remembered.
async function getShareRecord(id) {
  if (DB_CONFIGURED) {
    try {
      const rows = await sbRequest("GET",
        `shared_reports?id=eq.${encodeURIComponent(id)}` +
        `&select=id,payload,user_id,visibility,include_private,revoked_at,created_at&limit=1`);
      const row = rows && rows[0];
      if (!row) return null;
      const share = {
        id: row.id, user_id: row.user_id, visibility: row.visibility,
        include_private: row.include_private, revoked_at: row.revoked_at,
        created_at: row.created_at,
      };
      // Only an invited share needs its viewer list, and only then is the
      // extra round trip worth paying on a page load.
      let viewers = [];
      if (share.visibility !== "public") {
        viewers = (await sbRequest("GET",
          `report_viewers?share_id=eq.${encodeURIComponent(id)}&select=email`)) || [];
      }
      sharedReportsMem.set(id, row.payload);
      return { payload: row.payload, share, viewers };
    } catch (err) {
      console.error("Shared report DB read failed:", err.message);
      // FAIL CLOSED. The old code fell through to the file here; that is now a
      // refusal, because falling through would answer an invited share out of
      // a store that has no idea who was invited.
      throw err;
    }
  }
  // No database configured: the file fallback holds legacy PUBLIC shares only.
  // Task 5 refuses to CREATE an invited share without a database, so nothing
  // permissioned can ever be in here.
  const mem = sharedReportsMem.get(id);
  const payload = mem || (await loadSharedReportsFile())[id];
  if (!payload) return null;
  sharedReportsMem.set(id, payload);
  return { payload, share: { id, user_id: null, visibility: "public", revoked_at: null }, viewers: [] };
}
```

- [ ] **Step 3: Widen the writer**

```js
async function storeSharedReport(id, payload, opts = {}) {
  const { userId = null, visibility = "public", includePrivate = false, viewers = [] } = opts;
  sharedReportsMem.set(id, payload);
  if (DB_CONFIGURED) {
    const row = {
      id, payload, created_at: new Date().toISOString(),
      user_id: userId, visibility, include_private: includePrivate,
    };
    await sbRequest("POST", "shared_reports", [row], { prefer: "return=minimal" });
    if (viewers.length) {
      await sbRequest("POST", "report_viewers?on_conflict=share_id,email",
        viewers.map((email) => ({ share_id: id, email })),
        { prefer: "resolution=ignore-duplicates,return=minimal" });
    }
    return;
  }
  // File fallback, PUBLIC shares only (Task 5 refuses invited without a DB).
  const fileStore = await loadSharedReportsFile();
  fileStore[id] = payload;
  await fs.promises.writeFile(SHARED_REPORTS_FILE, JSON.stringify(fileStore));
}
```

Note the change of stance: the DB write no longer falls back to the file on error, it throws. A share that silently became file-only would lose its viewer list.

- [ ] **Step 4: Add the four small helpers**

```js
// Fire and forget: a failed stamp must never cost the client their report.
function stampShareView(shareId, email) {
  if (!DB_CONFIGURED || !email) return;
  const now = new Date().toISOString();
  (async () => {
    const q = `report_viewers?share_id=eq.${encodeURIComponent(shareId)}&email=eq.${encodeURIComponent(email)}`;
    await sbRequest("PATCH", q, { last_viewed_at: now }, { prefer: "return=minimal" });
    // first_viewed_at only when it is still null, so it keeps meaning "first".
    await sbRequest("PATCH", `${q}&first_viewed_at=is.null`, { first_viewed_at: now }, { prefer: "return=minimal" });
  })().catch((err) => console.error("Share view stamp failed:", err.message));
}

// Whole-list replace, mirroring PUT /api/dev-ideas: one state to reason about
// instead of three. Callers pass already-normalized emails.
async function setShareViewers(shareId, emails) {
  await sbRequest("DELETE", `report_viewers?share_id=eq.${encodeURIComponent(shareId)}`, undefined,
    { prefer: "return=minimal" });
  if (emails.length) {
    await sbRequest("POST", "report_viewers?on_conflict=share_id,email",
      emails.map((email) => ({ share_id: shareId, email })),
      { prefer: "resolution=ignore-duplicates,return=minimal" });
  }
}

async function revokeShare(shareId, userId) {
  // Scoped by user_id in the QUERY, not checked after the fact: knowing an id
  // must never be enough to touch a row. Same rule every vault read follows.
  return sbRequest("PATCH",
    `shared_reports?id=eq.${encodeURIComponent(shareId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { revoked_at: new Date().toISOString() }, { prefer: "return=representation" });
}

async function listSharesForOwner(userId) {
  return (await sbRequest("GET",
    `shared_reports?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,payload,visibility,include_private,revoked_at,created_at,report_viewers(email,invited_at,first_viewed_at,last_viewed_at)` +
    `&order=created_at.desc&limit=200`)) || [];
}

async function listSharesForViewer(email) {
  return (await sbRequest("GET",
    `report_viewers?email=eq.${encodeURIComponent(email)}` +
    `&select=share_id,invited_at,shared_reports(id,payload,visibility,revoked_at,created_at)` +
    `&order=invited_at.desc&limit=200`)) || [];
}
```

- [ ] **Step 5: Prove the server still boots and the old path still works**

Run: `node --check server.js && npm test`
Expected: pass, including the SPA-routing and share tests already in `routes.test.js`.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "Shared reports gain an ACL, and the ACL is never cached"
```

---

### Task 5: `POST /api/share` accepts an audience

**Files:**
- Modify: `server.js` (the `/api/share` handler)

**Interfaces:**
- Consumes: `canReadShare`'s sibling `normalizeEmail` from Task 1, `anonymizePrivateComps` from Task 3, `storeSharedReport` from Task 4, existing `entitlementsFor(req)`, `getSessionUser(req)`, `BLEND.stripPrivateComps`.
- Produces: the response `{ id, url, visibility }`.

- [ ] **Step 1: Require the new modules**

At the top of `server.js`, beside the other module requires:

```js
const SHAREACCESS = require("./report-access.js");
```

- [ ] **Step 2: Replace the body handling in `/api/share`**

Keep everything the handler already does to `safeMeta` (NOI, debt, rent roll, op-ex, `sample`, `fromHistory`, `portfolioId`). Replace the single `stripPrivateComps` line and the store call with:

```js
        const user = await getSessionUser(req);
        // Read once, used by both the invited gate and the private-comp
        // decision below. Never cached across requests: entitlements are
        // per-user and lapse with a card.
        const ent = await entitlementsFor(req);
        const visibility = parsed.visibility === "invited" ? "invited" : "public";
        const includePrivate = parsed.includePrivate === true;

        // A public link that carries private comps is the one mistake this
        // route must never make quietly. 400, not a silent strip: a client bug
        // should be loud on the first attempt rather than correct on every
        // attempt by luck.
        if (visibility === "public" && includePrivate) {
          return sendJson(res, 400, { error: "A public link cannot include private comps." });
        }

        let viewers = [];
        if (visibility === "invited") {
          if (!user) return sendJson(res, 401, { error: "Please sign in to share a report with named people." });
          if (!ent.pro) {
            return sendJson(res, 403, { error: "Sharing with named clients is part of the paid plan.", upgrade: true });
          }
          if (!DB_CONFIGURED) {
            // The vault's refusal, for the vault's reason: an access-control
            // list in a JSON file on an ephemeral disk is not one.
            return sendJson(res, 503, { error: "Private sharing is unavailable right now. Please try again in a minute." });
          }
          const asked = Array.isArray(parsed.viewers) ? parsed.viewers : [];
          if (asked.length > 20) return sendJson(res, 400, { error: "Up to 20 people per report." });
          viewers = [...new Set(asked.map(SHAREACCESS.normalizeEmail).filter(Boolean))];
          if (asked.length && !viewers.length) {
            return sendJson(res, 400, { error: "Those email addresses could not be read. Check them and try again." });
          }
        }

        // Private comps: stripped for a public link; anonymized into the
        // valuation basis for an invited one; carried whole only when the
        // owner explicitly asked and may. Never trusted from the browser.
        const canPrivate = includePrivate && visibility === "invited" && ent.canUseVault;
        const safeReport = visibility === "public"
          ? BLEND.stripPrivateComps(report)
          : canPrivate ? report : BLEND.anonymizePrivateComps(report);

        const id = newShareId();
        await storeSharedReport(id, { data: safeReport, meta: safeMeta }, {
          userId: user ? user.id : null, visibility, includePrivate: canPrivate, viewers,
        });
        logEvent("share", { prop_type: safeMeta.type, market: marketOf(safeMeta.address), source: visibility });
        return sendJson(res, 200, { id, url: `${SITE_URL}/r/${id}`, visibility });
```

- [ ] **Step 3: Check it compiles and the suite is green**

Run: `node --check server.js && npm test`
Expected: pass.

- [ ] **Step 4: Prove the anonymize path by hand**

Start the server (`npm start`), then:

```bash
curl -s -X POST localhost:3000/api/share -H 'content-type: application/json' -d '{"data":{"comps":[{"address":"1 Public St","date":"2026-01-05","transaction":"sale","price_or_rate":1000000,"size_sqft":10000,"price_per_sqft":100},{"address":"2 Private Rd","date":"2026-03-14","transaction":"sale","price_or_rate":4250000,"size_sqft":31000,"price_per_sqft":137,"source_type":"broker_vault","private":true}],"private_count":1},"meta":{"address":"9 Test Ave","type":"Industrial"},"visibility":"public","includePrivate":true}'
```

Expected: `{"error":"A public link cannot include private comps."}`. Repeat without `includePrivate` and confirm a 200 whose stored report has no `2 Private Rd`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "A share can have an audience, and the server decides who"
```

---

### Task 6: `GET /api/shared` checks the viewer list

**Files:**
- Modify: `server.js` (the `/api/shared` handler)

**Interfaces:**
- Consumes: `getShareRecord`, `stampShareView` (Task 4), `canReadShare` (Task 1).

- [ ] **Step 1: Replace the handler body**

```js
  if (req.method === "GET" && req.url.split("?")[0] === "/api/shared") {
    const id = (new URL(req.url, "http://localhost").searchParams.get("id") || "").trim();
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
      return sendJson(res, 400, { error: "Invalid share id." });
    }
    (async () => {
      const user = await getSessionUser(req);
      const rec = await getShareRecord(id);
      if (!rec) return sendJson(res, 404, { error: "This shared report was not found." });
      const decision = SHAREACCESS.canReadShare({ share: rec.share, viewers: rec.viewers, user });
      if (!decision.ok) {
        if (decision.reason === "revoked") {
          // NOT 404 (a client would hunt for a typo in a link that was
          // correct) and NOT signin_required (signing in cannot help, and the
          // card would loop them).
          return sendJson(res, 403, { error: "This report link was turned off by the person who sent it." });
        }
        if (decision.reason === "signin_required") {
          return sendJson(res, 403, {
            error: "This report was shared with specific people. Please sign in to view it.",
            signin_required: true,
          });
        }
        return sendJson(res, 403, { error: "This report was shared with specific people, and this account is not one of them." });
      }
      if (decision.reason === "invited") stampShareView(id, SHAREACCESS.normalizeEmail(user.email));
      return sendJson(res, 200, rec.payload);
    })().catch((err) => {
      console.error("Shared report lookup failed:", err.message);
      // Fails CLOSED: an error resolving the audience refuses the read. The
      // opposite would serve a permissioned report during a database blip.
      return sendJson(res, 503, { error: "Could not load the shared report. Please try again in a minute." });
    });
    return;
  }
```

- [ ] **Step 2: Compile and test**

Run: `node --check server.js && npm test`
Expected: pass.

- [ ] **Step 3: Prove the public path is unchanged**

With the server running and no Supabase configured, create a public share with the curl from Task 5, then `curl -s "localhost:3000/api/shared?id=<id>"` and confirm the full report comes back with no session.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "A shared report now asks who is reading it"
```

---

### Task 7: The management routes

**Files:**
- Modify: `server.js` (beside `/api/shared`)

**Interfaces:**
- Produces: `GET /api/shares`, `PUT /api/shares/viewers`, `POST /api/shares/revoke`. Task 12 consumes all three.

- [ ] **Step 1: Write the three handlers**

```js
  // --- The member's own shares, and the ones shared with them -------------
  // Both halves in ONE call: /desk needs both and it is a page-load path.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/shares") {
    (async () => {
      const user = await getSessionUser(req);
      if (!user) return sendJson(res, 401, { error: "Please sign in." });
      if (!DB_CONFIGURED) return sendJson(res, 503, { error: "Sharing is unavailable right now." });
      const [owned, invited] = await Promise.all([
        listSharesForOwner(user.id),
        listSharesForViewer(SHAREACCESS.normalizeEmail(user.email)),
      ]);
      const brief = (payload) => ({
        address: (payload && payload.meta && payload.meta.address) || "",
        type: (payload && payload.meta && payload.meta.type) || "",
      });
      return sendJson(res, 200, {
        mine: owned.map((r) => ({
          id: r.id, ...brief(r.payload), visibility: r.visibility,
          includePrivate: r.include_private, revokedAt: r.revoked_at, createdAt: r.created_at,
          url: `${SITE_URL}/r/${r.id}`,
          viewers: (r.report_viewers || []).map((v) => ({
            email: v.email, invitedAt: v.invited_at,
            firstViewedAt: v.first_viewed_at, lastViewedAt: v.last_viewed_at,
          })),
        })),
        sharedWithMe: invited
          .filter((r) => r.shared_reports && !r.shared_reports.revoked_at)
          .map((r) => ({
            id: r.share_id, ...brief(r.shared_reports.payload),
            invitedAt: r.invited_at, url: `${SITE_URL}/r/${r.share_id}`,
          })),
      });
    })().catch((err) => {
      console.error("Shares list failed:", err.message);
      return sendJson(res, 503, { error: "Couldn't load your shared reports. Please try again in a minute." });
    });
    return;
  }

  // --- Replace a share's viewer list wholesale ----------------------------
  if (req.method === "PUT" && req.url.split("?")[0] === "/api/shares/viewers") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        const user = await getSessionUser(req);
        if (!user) return sendJson(res, 401, { error: "Please sign in." });
        if (!DB_CONFIGURED) return sendJson(res, 503, { error: "Sharing is unavailable right now." });
        const { id, emails } = JSON.parse(body || "{}");
        if (!/^[A-Za-z0-9_-]{6,32}$/.test(String(id || ""))) return sendJson(res, 400, { error: "Invalid share id." });
        const asked = Array.isArray(emails) ? emails : [];
        if (asked.length > 20) return sendJson(res, 400, { error: "Up to 20 people per report." });
        const clean = [...new Set(asked.map(SHAREACCESS.normalizeEmail).filter(Boolean))];
        // Ownership proven by a scoped READ before any write: a stranger with
        // an id must not be able to add themselves as a viewer.
        const owned = await sbRequest("GET",
          `shared_reports?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`);
        if (!owned || !owned[0]) return sendJson(res, 404, { error: "That shared report was not found." });
        await setShareViewers(id, clean);
        return sendJson(res, 200, { ok: true, viewers: clean });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("Viewer update failed:", err.message);
        return sendJson(res, 503, { error: "Couldn't update that list. Please try again in a minute." });
      }
    });
    return;
  }

  // --- Turn a link off. One way, on purpose ------------------------------
  if (req.method === "POST" && req.url.split("?")[0] === "/api/shares/revoke") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        const user = await getSessionUser(req);
        if (!user) return sendJson(res, 401, { error: "Please sign in." });
        if (!DB_CONFIGURED) return sendJson(res, 503, { error: "Sharing is unavailable right now." });
        const { id } = JSON.parse(body || "{}");
        if (!/^[A-Za-z0-9_-]{6,32}$/.test(String(id || ""))) return sendJson(res, 400, { error: "Invalid share id." });
        const rows = await revokeShare(id, user.id);
        if (!rows || !rows.length) return sendJson(res, 404, { error: "That shared report was not found." });
        // The in-process payload cache must forget it too, or this very
        // server would keep answering the link it was just told to kill.
        sharedReportsMem.delete(id);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("Share revoke failed:", err.message);
        return sendJson(res, 503, { error: "Couldn't turn that link off. Please try again in a minute." });
      }
    });
    return;
  }
```

- [ ] **Step 2: Compile and test**

Run: `node --check server.js && npm test`
Expected: pass.

- [ ] **Step 3: Prove the refusals by hand**

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/shares
```

Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "List, re-invite and revoke: the three things an owner can do"
```

---

### Task 8: The invitation email

**Files:**
- Modify: `server.js` (`/api/share` and `PUT /api/shares/viewers`)

**Interfaces:**
- Consumes: `sendOutboundEmail(to, subject, text)`.

- [ ] **Step 1: Add the sender**

Beside the other outbound mail in `server.js`:

```js
// The invitation. Rides the existing EMAIL_FROM gate, so with a custom domain
// unverified it logs "Outbound email skipped" and the sharer copies the link
// by hand — exactly how password reset behaves today.
//
// Fire and forget, ALWAYS: the share row is already written when this runs. A
// mail provider having a bad minute must never mean the link does not exist.
function sendShareInvites(emails, { url, address, fromName }) {
  for (const to of emails) {
    const who = fromName ? `${fromName} has` : "Someone has";
    sendOutboundEmail(to, `A property valuation was shared with you`,
      `${who} shared a CompNinja valuation for ${address} with you.\n\n` +
      `View it here: ${url}\n\n` +
      `This report was shared with specific people. Sign in with this email address (${to}) to open it. ` +
      `A free account is all it takes.\n\n` +
      `Every CompNinja valuation is an automated estimate, not an appraisal.`);
  }
}
```

The "sign in with this email address" line is load-bearing: identity is the email, so a client who signs up with a different address will be refused with no idea why.

- [ ] **Step 2: Call it from both writers**

In `/api/share`, after `storeSharedReport` succeeds and only when `visibility === "invited" && viewers.length`:

```js
        if (visibility === "invited" && viewers.length) {
          sendShareInvites(viewers, { url: `${SITE_URL}/r/${id}`, address: safeMeta.address, fromName: user.name || "" });
        }
```

In `PUT /api/shares/viewers`, send only to emails that are NEW relative to the previous list. Read the old list before `setShareViewers` and diff, so re-saving an unchanged list does not re-mail everybody.

- [ ] **Step 3: Compile and test**

Run: `node --check server.js && npm test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Tell the client their report is waiting, and which address opens it"
```

---

### Task 9: Wiring tests

**Files:**
- Modify: `test/routes.test.js`

- [ ] **Step 1: Add the block**

Add beside the existing vault-gate block, inside the bare-server test (no Supabase, no admin key):

```js
  // Sharing's gate, wired.
  //
  // report-access.js proves the DECISION exhaustively. This proves it is
  // ATTACHED: that an anonymous caller cannot create a permissioned share and
  // cannot list anyone's shares, and that the refusal arrives as 401 BEFORE
  // the 503 a database-less server would otherwise give — the same ordering
  // rule openVault follows, so a stranger never learns whether the DB is up.
  await t.test("permissioned sharing refuses an anonymous caller, 401 before 503", async () => {
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { comps: [{ address: "1 A St" }] }, meta: { address: "1 A St", type: "Industrial" },
        visibility: "invited", viewers: ["client@acme.com"],
      }),
    });
    assert.equal(r.status, 401, "an invited share must require a session");
  });

  await t.test("a public share still needs no account at all", async () => {
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { comps: [{ address: "1 A St" }] }, meta: { address: "1 A St", type: "Industrial" } }),
    });
    assert.equal(r.status, 200, "the pre-v3 share path must be untouched");
    const body = await r.json();
    assert.match(body.url, /\/r\/[A-Za-z0-9_-]+$/);
  });

  await t.test("a public link may never carry private comps", async () => {
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { comps: [{ address: "1 A St" }] }, meta: { address: "1 A St", type: "Industrial" },
        includePrivate: true,
      }),
    });
    assert.equal(r.status, 400, "this must be loud on the first attempt, not silently corrected");
  });

  await t.test("every share-management route refuses an anonymous caller and exists", async () => {
    const routes = [
      ["GET", "/api/shares", null],
      ["PUT", "/api/shares/viewers", { id: "abcdefgh", emails: [] }],
      ["POST", "/api/shares/revoke", { id: "abcdefgh" }],
    ];
    for (const [method, p, body] of routes) {
      const r = await fetch(srv.base + p, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(r.status, 401, `${method} ${p} must refuse an anonymous caller`);
      assert.notEqual(r.status, 404, `${method} ${p} should exist and refuse, not be absent`);
    }
  });

  // NOT COVERED HERE, deliberately, and for the reason the vault block already
  // gives: the 200-for-an-invited-client and 403-for-a-stranger paths need a
  // real session, which needs a database, and nothing in this file may touch
  // an external service. They rest on report-access.js plus one manual check
  // against the deployment.
```

- [ ] **Step 2: Run it**

Run: `npm test`
Expected: all pass. The count moves; trust the summary, not the number in CLAUDE.md.

- [ ] **Step 3: Commit**

```bash
git add test/routes.test.js
git commit -m "Prove the sharing gate is wired to the sharing routes"
```

---

### Task 10: The share panel

**Files:**
- Modify: `index.html` (the `shareBtn` handler and `publishCurrentReport`, around lines 9556-9605)

- [ ] **Step 1: Fix the memo trap FIRST**

`publishCurrentReport()` memoizes per report object in `lastPublished`, and the memo knows nothing about visibility. Left alone, a member who shares a public link and then invites a client is handed back the PUBLIC url and believes it is permissioned. Change the memo to key on the options too:

```js
  let lastPublished = { parsed: null, key: "", url: "" };
  async function publishCurrentReport(opts = {}) {
    if (!currentParsed || !currentMeta) throw new Error("No report to share.");
    if (currentMeta.shared && /^\/r\/[A-Za-z0-9_-]+$/.test(location.pathname)) return location.href;
    // The memo exists so Share-then-BOV does not publish twice. It must key on
    // the AUDIENCE as well as the report, or an invited share silently returns
    // the public link created a moment earlier.
    const key = JSON.stringify([opts.visibility || "public", opts.viewers || [], !!opts.includePrivate]);
    if (lastPublished.parsed === currentParsed && lastPublished.key === key && lastPublished.url) return lastPublished.url;
    const r = await fetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: currentParsed, meta: currentMeta, ...opts }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || "Share failed.");
    const { url } = await r.json();
    lastPublished = { parsed: currentParsed, key, url };
    return url;
  }
```

The BOV caller passes nothing, so it keeps getting the public link it needs.

- [ ] **Step 2: Add the panel markup**

Beside the existing `#shareBtn` (line ~1158), add a hidden panel with: two radios named `shareVisibility` (`public` default, `invited`), a textarea `#shareEmails` (placeholder `client@company.com, partner@company.com`), a checkbox `#shareIncludePrivate` shown only when `proConfig.canUseVault` and the report has `private_count > 0`, a `#shareCreateBtn`, and a `#shareResult` line. Follow the existing modal markup in the file (the comp-submission modal is the closest model) and reuse its Tailwind classes so no new utilities are introduced.

- [ ] **Step 3: Wire it**

The Share button opens the panel instead of publishing immediately. Replace the body of the existing `shareBtn` listener with `openSharePanel()`, and add:

```js
  function readShareEmails() {
    return document.getElementById("shareEmails").value
      .split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  }

  document.getElementById("shareCreateBtn").addEventListener("click", async () => {
    const btn = document.getElementById("shareCreateBtn");
    const out = document.getElementById("shareResult");
    const visibility = document.querySelector('input[name="shareVisibility"]:checked').value;
    const viewers = visibility === "invited" ? readShareEmails() : [];
    const privEl = document.getElementById("shareIncludePrivate");
    const includePrivate = visibility === "invited" && !!privEl && privEl.checked;
    if (visibility === "invited" && !viewers.length) {
      out.textContent = "Add at least one email address, or choose a public link.";
      return;
    }
    if (includePrivate && !confirm(SHARE_PRIVATE_CONFIRM)) return;
    btn.disabled = true;
    out.textContent = "Creating link…";
    try {
      const url = await publishCurrentReport({ visibility, viewers, includePrivate });
      try { await navigator.clipboard.writeText(url); } catch (_) {}
      out.textContent = visibility === "invited"
        ? `Link copied. ${viewers.length} ${viewers.length === 1 ? "person" : "people"} invited.`
        : "Link copied.";
    } catch (err) {
      // A paywall refusal is an offer, not an error message.
      if (String(err.message || "").includes("paid plan")) { closeSharePanel(); openUpgradePrompt(); }
      else out.textContent = err.message || "That didn't go through. Please try again.";
    } finally {
      btn.disabled = false;
    }
  });
```

`publishCurrentReport` throws the server's own `error` string, which is what the `paid plan` test reads. If that copy is reworded in Task 5, reword it here too.

- [ ] **Step 4: The include-private confirm**

Define the constant Step 3 referenced, beside the other report-level constants:

```js
  // Said before the fact, in the interface, rather than buried in terms: this
  // is the one action that sends vault addresses to someone outside the
  // account, and whether that is allowed depends on a licence we do not hold.
  const SHARE_PRIVATE_CONFIRM =
    "Include your private comps in full?\n\n" +
    "The people you invite will see the full address and price of the comps from your vault. " +
    "Everything else in your vault stays private, and this applies only to this link.\n\n" +
    "Sharing MLS-sourced data is subject to your own licence terms.";
```

- [ ] **Step 5: Verify in the browser**

Start the preview server, run any report, open the panel, and confirm: public is preselected; choosing "Only people I invite" while signed out shows the sign-in prompt rather than a raw 401; the private-comps checkbox is absent on a report with no private comps.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "The Share button asks who it is for"
```

---

### Task 11: `/r/<id>` handles a refusal

**Files:**
- Modify: `index.html` (the `/api/shared` fetch, around line 2483)

- [ ] **Step 1: Read the current handler**

It currently fetches `/api/shared?id=` and renders. A non-200 needs three outcomes, not one.

- [ ] **Step 2: Branch on the refusal**

```js
    const r = await fetch("/api/shared?id=" + encodeURIComponent(m[1]));
    if (r.status === 403) {
      const body = await r.json().catch(() => ({}));
      // signin_required means signing in CAN help; a revoked link means it
      // cannot, and offering a sign-in card there would loop them.
      showSharedNotice(body.error || "This report is private.", { offerSignIn: body.signin_required === true });
      return;
    }
```

`showSharedNotice(message, { offerSignIn })` renders a card in place of the report carrying the message and, when `offerSignIn`, a button that opens the existing account modal. After a successful sign-in the page reloads the same URL, which is now readable.

- [ ] **Step 3: Say what the basis holds**

Where the report renders, when `meta.shared` and `data.private_count > 0` and no comp carries `private: true`, show one line under the comp table:

> N comps from the sender's own records are included in this valuation but are not shown.

- [ ] **Step 4: Verify in the browser**

Open a public `/r/<id>` and confirm it is unchanged. Then temporarily have the server return the 403 shape for that id and confirm the sign-in card renders instead of a broken page.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "A private link explains itself instead of breaking"
```

---

### Task 12: The two desk lists

**Files:**
- Modify: `index.html` (the `/desk` view, beside `#deskWatch` and `#deskBroker`)

- [ ] **Step 1: Add the markup**

Two sections after `#deskBroker`: `#deskShares` ("Reports you have shared") and `#deskSharedWithMe` ("Shared with you"), each with a heading, a list container and a hidden empty-state line, matching the classes `#deskWatch` already uses.

- [ ] **Step 2: Load them**

Where the desk loads the portfolio and watchlist, add one `GET /api/shares` call. Render each `mine` row as: address and type, a visibility label ("Anyone with the link" or "N invited"), each viewer with "opened Aug 7" from `firstViewedAt` or "not opened yet", an "Edit people" control calling `PUT /api/shares/viewers`, and a "Turn off link" control calling `POST /api/shares/revoke` behind a confirm that says the link stops working permanently. Render each `sharedWithMe` row as address, type, who invited them if known, and a link to `/r/<id>`.

A 401 hides both sections silently (a signed-out desk already shows its sign-in card); a 503 shows one line, "Couldn't load your shared reports", and leaves the rest of the desk alone.

- [ ] **Step 3: Verify in the browser**

Sign in, share a report publicly, reload `/desk`, confirm the row appears with "Anyone with the link" and a working "Turn off link" that makes the URL answer the revoked message.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "My Desk shows what you have shared, and what was shared with you"
```

---

### Task 13: Documentation and the shipping record

**Files:**
- Modify: `CLAUDE.md`, `devlog.json`, `docs/ROADMAP.md`

- [ ] **Step 1: CLAUDE.md**

Add `POST /api/share`'s new body fields, the three new routes, and `report-access.js` to the tested-pure-modules list in the opening section. State the two rules a future editor will otherwise break: the ACL is never cached, and an unrecognized visibility is treated as invited.

- [ ] **Step 2: devlog.json**

Append one entry. Save as clean UTF-8; em dashes raw, never escaped:

```json
{ "date": "2026-08-06", "type": "feature",
  "title": "Reports can be shared with named people instead of the whole internet",
  "details": "A share now has an owner, an audience and an off switch. Invited clients sign in with the address they were invited at; the link can be revoked. A broker's private vault comps travel as anonymized basis rows, so the client's valuation matches the broker's to the dollar without an address leaving the vault, and full detail is a per-share opt-in." }
```

- [ ] **Step 3: ROADMAP.md**

Move v3 out of "Later" and into the Shipped log with the date. Leave v4 and hub ratings where they are.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md devlog.json docs/ROADMAP.md
git commit -m "Document permissioned sharing, and record it as shipped"
```

---

## Before this is deployed

1. `npm test` green.
2. **Run migration 018 against production**, then `node migrations/verify.js`, then flip its line in `APPLIED.md`. The routes 503 without it, which is loud rather than silent, but still broken.
3. Manually prove, against the deployment, the two paths `routes.test.js` cannot: an invited client reads the report, and a signed-in stranger gets the 403.
4. Confirm one pre-v3 `/r/<id>` link still opens with no account.
