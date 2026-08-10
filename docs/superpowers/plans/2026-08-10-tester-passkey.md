# Tester Passkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner hand out a single shared passkey that a signed-in visitor can redeem for free ("comped") Pro access, without also handing out `ADMIN_KEY` and its internal dashboards.

**Architecture:** A new `pro_tester` boolean column on `users`, set by a new signed-in-only `POST /api/redeem-passkey` route that constant-time-compares a submitted code against a new `TESTER_PASSKEY` env var. `entitlements.js` grows a comped-tester branch parallel to the existing comped-admin one, but placed as a *fallback after* the real subscription state is computed so a tester who later subscribes gets their real Stripe status. The pricing modal grows a "Have a code?" disclosure that posts to the route and re-reads `/api/config`.

**Tech Stack:** Plain Node (no npm dependencies, `node --test`), Supabase REST via `fetch` with a local `account-store.json` file fallback, vanilla JS in `index.html`.

**Spec:** `docs/superpowers/specs/2026-08-10-tester-passkey-design.md`

## Global Constraints

- **No npm dependencies.** Node 18+ built-ins only. Do not add a package for anything in this plan.
- **`entitlements.js` stays pure** — no I/O, no `require()`, no clock reads (the caller passes `now`). All new rules go there; all new reads go in `server.js`.
- **Never test a plan or subscription status outside `entitlements.js`.** Route code asks `entitlementsFor(req)` / `getEntitlements(user, ...)` and reads the resulting flags.
- **Fail closed.** An unreadable flag, a failed DB read, or an unknown state resolves to the free tier, never to Pro.
- **Editing `server.js` requires restarting the process** to see the change. Editing `index.html` does not (it is read from disk per request).
- **Adding a new Tailwind utility class to `index.html` requires regenerating `tailwind.css`.** A Claude Code hook does this automatically when `index.html` is edited in-session — do not also regen by hand. Verify any genuinely new class actually landed in the vendored file, and commit `tailwind.css` alongside the HTML change. (This plan's HTML deliberately reuses classes already present in the file, so a regen should be a no-op.)
- **Devlog rule:** every shipped fix/improvement/feature appends an entry to `devlog.json` in the same commit. Save that file as clean UTF-8 — never escape em dashes or curly quotes to ASCII.
- **Run `npm test` after touching any rule.** It is `node --test`, needs no database, and finishes in about a second.
- **Copy rule:** the site never claims to be a broker and every valuation is an "automated estimate", never an appraisal. Nothing in this plan should introduce brand or valuation copy.
- **This checkout may be shared with another Claude session.** Stage explicit paths (`git add <path>`), never `git add -A` or `git add .`, and read the diff before committing.

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `migrations/022-tester-passkey.sql` | The `users.pro_tester` column | Create |
| `migrations/APPLIED.md` | Log of what has run on prod | Modify (add a row) |
| `entitlements.js` | The comped-tester rule | Modify |
| `test/entitlements.test.js` | Pins that rule | Modify |
| `server.js` | `TESTER_PASSKEY` config, `setUserTester()`, the `pro_tester` field on the session user, the tester flag into `getEntitlements`, the `POST /api/redeem-passkey` route, `tester` in `/api/config` | Modify |
| `test/routes.test.js` | Pins the route is actually wired | Modify |
| `index.html` | The "Have a code?" UI, `isTesterPro()`, the plan-card copy, the `hasBillingHistory()` exclusion | Modify |
| `.env.example` | Documents the new var | Modify |
| `CLAUDE.md` | Documents the new var and the rule | Modify |
| `devlog.json` | Changelog entry | Modify |

Five tasks, in dependency order: the rule (pure, testable alone) → the storage → the route → the UI → the docs. Each ends with a green `npm test` and a commit.

---

### Task 1: The comped-tester entitlement rule

Pure logic only. No server, no database, no UI. This task is complete and reviewable on its own.

**Files:**
- Modify: `entitlements.js`
- Test: `test/entitlements.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `computeEntitlements({ ..., tester })` — a new optional boolean parameter. When it grants, the returned object has `plan: "tester"`, `status: "tester"`, `tester: true`, `pro: true`, `broker: false`, `canUseVault: false`. **Every** returned object from every branch now carries a `tester` boolean.

- [ ] **Step 1: Write the failing tests**

Add to `test/entitlements.test.js`, immediately after the existing comped-team-access block (after the `"non-admins carry admin:false, so the UI can read one field"` test, currently ending around line 131):

```js
// --- comped tester access --------------------------------------------------
//
// "Tester" is a persistent per-account flag (users.pro_tester), set by
// redeeming TESTER_PASSKEY. Unlike admin — which is possession of a key, i.e.
// a staff signal — a tester is an ordinary person who may well go on to
// actually subscribe, so these tests pin that the flag YIELDS to a real
// subscription instead of masking it.

test("tester: comped Pro from the account flag alone", () => {
  const e = ent({ user: USER, tester: true });
  assert.equal(e.plan, "tester");
  assert.equal(e.pro, true);
  assert.equal(e.tester, true);
  assert.equal(e.maxComps, "all");
  assert.equal(e.maxLookbackMonths, PRO_MAX_LOOKBACK_MONTHS);
  assert.equal(e.exportsRemaining, "unlimited");
  assert.equal(e.canBrand, true);
  assert.equal(e.canExploreAddresses, true);
});

test("tester status is never a Stripe status — there is no customer to manage", () => {
  assert.equal(ent({ user: USER, tester: true }).status, "tester");
});

test("a tester does NOT get the broker vault", () => {
  // The vault is a private-data workspace with an upload endpoint. A passkey
  // shared with a wider group is a bigger surface than "try Pro's reports",
  // so the vault stays admin/paid-only. This is the one place a tester is
  // deliberately NOT equal to Pro.
  const e = ent({ user: USER, tester: true });
  assert.equal(e.broker, false);
  assert.equal(e.canUseVault, false);
});

test("a real subscription always wins over the tester flag", () => {
  // The trap this closes: if the tester branch short-circuited like admin's
  // does, a tester who later subscribes would be stuck reading as "comped"
  // forever — no billing portal, no real status — while being charged.
  const e = ent({ user: USER, tester: true, subscription: activeSub() });
  assert.equal(e.plan, "pro_monthly");
  assert.equal(e.status, "active");
  assert.equal(e.tester, false, "a paying subscriber is not labelled comped");
  assert.equal(e.canUseVault, true, "and their subscription's vault is not withheld");
});

test("an expired subscription falls back to the tester flag", () => {
  // The other side of the same rule: comped access resumes when the paid
  // subscription lapses, rather than the lapse stripping a tester of access
  // they had before they ever subscribed.
  const dead = activeSub({ current_period_end: iso(NOW - 30 * DAY) });
  const e = ent({ user: USER, tester: true, subscription: dead });
  assert.equal(e.pro, true);
  assert.equal(e.status, "tester");
});

test("tester without an account gets nothing — the flag lives on a user row", () => {
  const e = ent({ user: null, tester: true });
  assert.equal(e.plan, "anonymous");
  assert.equal(e.pro, false);
  assert.equal(e.maxComps, FREE_MAX_COMPS);
});

test("tester cannot switch a dark deployment back on", () => {
  const e = computeEntitlements({ user: USER, tester: true, now: NOW, enabled: false });
  assert.equal(e.plan, "free");
  assert.equal(e.tester, false);
  assert.equal(e.status, "disabled");
});

test("non-testers carry tester:false, so the UI can read one field", () => {
  assert.equal(ent({ user: USER }).tester, false);
  assert.equal(ent({ user: USER, admin: true }).tester, false);
  assert.equal(ent({ user: USER, subscription: activeSub() }).tester, false);
  assert.equal(computeEntitlements({ user: USER, now: NOW, enabled: false }).tester, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/entitlements.test.js
```

Expected: FAIL. The first assertion to blow up is `assert.equal(e.plan, "tester")` receiving `"free"` — `computeEntitlements` ignores the unknown `tester` parameter today.

- [ ] **Step 3: Add the `tester` parameter and the comped branch**

In `entitlements.js`, extend the `computeEntitlements` signature (currently line ~202) to accept `tester`:

```js
function computeEntitlements({ user, subscription, purchase, usage, reportId, now, enabled, admin, tester } = {}) {
```

Add `tester` to the JSDoc block just above it, after the `@param` line for `admin`:

```js
 * @param {boolean} o.tester       this account's users.pro_tester flag — comps
 *                                 Pro, but only alongside `enabled`, a signed-in
 *                                 user, and NO live paid subscription
```

Add `tester: false` to the object returned by the **admin** branch (alongside its existing `admin: true`), and `tester: false` to the object returned by the **`!enabled`** branch (alongside its existing `admin: false`). Every branch must answer the field or `undefined` reads as an accidental grant/lock at the call site.

Then, in the main resolution path, insert the comped-tester branch immediately after `pro` is computed and **before** `planName`/`plan` are derived (currently around line 288, right after `const pro = PRO_STATES.includes(state);`):

```js
  // --- Comped Pro for a beta tester -----------------------------------------
  //
  // A persistent flag on the user row (users.pro_tester), set by redeeming
  // TESTER_PASSKEY. Deliberately NOT an early short-circuit like the admin
  // branch above, and the difference is the whole design:
  //
  //   Admin is possession of a KEY — a staff signal, and staff are not
  //   customers, so it is right for it to win outright and skip the
  //   subscription reads entirely.
  //
  //   A tester is an ordinary person who may go on to actually subscribe. If
  //   this branch won outright, that person would be stuck reading as
  //   "comped" forever — no real status, no billing portal — while their card
  //   was being charged. So it is checked only when there is no live paid
  //   subscription to prefer, which also means comped access resumes if that
  //   subscription later lapses.
  //
  // `enabled` is already guaranteed true here (the !enabled branch returned
  // above), so this cannot switch a dark deployment on. `user` is required for
  // the same reason the admin branch requires it: the grant lives on an
  // account, and there is no account on an anonymous request.
  if (!pro && tester && user) {
    return {
      plan: "tester",
      pro: true,
      // Not "active": nothing here came from Stripe, and the UI must not offer
      // a billing portal to an account with no customer record.
      status: "tester",
      maxComps: "all",
      canBrand: true,
      maxLookbackMonths: PRO_MAX_LOOKBACK_MONTHS,
      exportsRemaining: "unlimited",
      reportUnlocked: false,
      canExploreAddresses: true,
      // The ONE place a tester is deliberately not equal to Pro. The vault is
      // a private-data workspace with an upload endpoint; a passkey shared
      // with a wider group is a bigger surface than "try Pro's reports", so
      // vault access stays admin/paid-only.
      broker: false,
      canUseVault: false,
      graceUntil: null,
      admin: false,
      tester: true,
      reason: "Pro is comped for a beta tester.",
    };
  }
```

Finally add `tester: false` to the main return object at the end of the function (alongside its existing `admin: false`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, with a higher total than before. Watch specifically that the pre-existing test `"every Pro-granting branch answers every Pro question"` still passes — it iterates `Object.keys(pro)` and asserts each key exists on the admin result, so the new `tester` key on the Pro branch is exactly what the `tester: false` addition to the admin branch satisfies.

- [ ] **Step 5: Commit**

```bash
git add entitlements.js test/entitlements.test.js
git commit -m "Add comped-Pro entitlement branch for beta testers"
```

---

### Task 2: Storage — the `pro_tester` column and its reads/writes

The migration plus the three `server.js` seams that persist and surface the flag. No route yet, so nothing is reachable from the outside after this task — but `getEntitlements` will honor a flag that is already on a user row.

**Files:**
- Create: `migrations/022-tester-passkey.sql`
- Modify: `migrations/APPLIED.md`
- Modify: `server.js` (config constant, `getSessionUser`, `setUserTester`, `getEntitlements`)

**Interfaces:**
- Consumes: `computeEntitlements({ ..., tester })` from Task 1.
- Produces:
  - `TESTER_PASSKEY` — module-scope string constant, `""` when unset.
  - `async setUserTester(id)` → `Promise<void>`. Sets `pro_tester = true` for that user id, via Supabase PATCH when `DB_CONFIGURED`, else via the `account-store.json` fallback. Throws on a Supabase failure (the caller must not report success for a write that did not land).
  - `getSessionUser(req)` now resolves to `{ id, email, name, pro_tester }`.

- [ ] **Step 1: Write the migration**

Create `migrations/022-tester-passkey.sql`:

```sql
-- migrations/022-tester-passkey.sql
-- 022 · Comped Pro for beta testers: one flag per account (2026-08-10)
-- Spec: docs/superpowers/specs/2026-08-10-tester-passkey-design.md
-- Plan: docs/superpowers/plans/2026-08-10-tester-passkey.md
--
-- RUN BEFORE DEPLOYING the /api/redeem-passkey route.
--
-- Purely additive and idempotent. `not null default false` means every
-- existing row is backfilled to "not a tester" by the ALTER itself, which is
-- the fail-closed direction: no account gains access from this migration.
--
-- Deploy-order-safe in BOTH directions, deliberately:
--   migrate-then-deploy — the column sits unread until the route ships.
--   deploy-then-migrate — getSessionUser reads `user.pro_tester` as undefined
--   (PostgREST returns the row without the column rather than erroring on a
--   SELECT *), which Boolean()s to false, so every visitor is simply not a
--   tester until the column exists. The redeem route's PATCH would 400 on the
--   unknown column and surface as a redeem failure — a broken feature, never
--   a wrong grant.
--
-- Revoking one tester is a one-row UPDATE here, which is the whole reason the
-- grant is stored per-account rather than carried in a cookie:
--   update users set pro_tester = false where email = 'someone@example.com';

alter table users add column if not exists pro_tester boolean not null default false;

-- Verify (zero rows = schema complete):
--   select c from unnest(array['pro_tester']) as c
--   where not exists (select 1 from information_schema.columns
--                     where table_name = 'users' and column_name = c);
```

- [ ] **Step 2: Log the migration as not-yet-applied**

Append one row to the table in `migrations/APPLIED.md`, after the `021-broker-csv-mappings.sql` row:

```markdown
| 022-tester-passkey.sql | **NOT YET APPLIED** | Adds `users.pro_tester`. Purely additive and idempotent (`add column if not exists`, `not null default false` backfills every existing row to false). Deploy-order-safe in both directions: unread until the route ships, and a missing column reads as `undefined` → `false`, so the failure mode is "nobody is a tester", never a wrong grant. Run before deploying `/api/redeem-passkey`, then update this row with the evidence. |
```

- [ ] **Step 3: Add the config constant**

In `server.js`, immediately after the `PRO_AUDIENCE` / `proEnabledFor` block (currently ending around line 168), add:

```js
// Optional shared passkey that comps Pro to a signed-in account (the beta
// tester door). Deliberately NOT ADMIN_KEY: that key also unlocks /admin,
// /dev and /contacts, so handing it to testers would hand out the analytics,
// the lead list and the dev tools along with it. Unset = POST
// /api/redeem-passkey does not exist (404), which is what keeps this inert on
// any deployment that never configured it.
//
// Redeeming sets users.pro_tester, so the grant follows the ACCOUNT across
// devices and survives a passkey rotation — and revoking one tester is a
// one-row UPDATE, without changing the passkey for everyone else. See the
// comped-tester branch in entitlements.js for what it grants (everything Pro
// except the broker vault) and what it cannot override (PRO_ENABLED, and a
// real paid subscription).
const TESTER_PASSKEY = (process.env.TESTER_PASSKEY || "").trim();
```

- [ ] **Step 4: Carry `pro_tester` on the session user**

In `server.js`'s `getSessionUser` (currently line ~939), the row is narrowed to three fields before being returned. Extend that projection — **this is the single line most likely to be missed, and missing it makes the whole feature silently inert**:

```js
    return user ? {
      id: user.id,
      email: user.email,
      name: user.name || "",
      // The comped-tester flag. Narrowing this object is deliberate (it is what
      // stops a password hash reaching a caller), which means a new entitlement
      // input has to be added HERE or it never reaches computeEntitlements at
      // all — the feature would be silently inert with nothing failing.
      // Boolean() so a missing column (deploy-then-migrate) reads as false.
      pro_tester: Boolean(user.pro_tester),
    } : null;
```

- [ ] **Step 5: Add the write function**

In `server.js`, in the `// --- users ---` section, immediately after `updateUserPassword` (currently ending around line 868):

```js
// Grants comped Pro to one account (the redeemed tester passkey).
//
// THROWS on a Supabase failure rather than returning false, unlike the
// fire-and-forget writes elsewhere in this file: the caller answers the
// visitor with "you're in", and a swallowed failure there means someone is
// told they have Pro that they do not have and cannot get by trying again.
async function setUserTester(id) {
  if (DB_CONFIGURED) {
    await sbRequest("PATCH", `users?id=eq.${encodeURIComponent(id)}`, { pro_tester: true });
    return;
  }
  const u = (await accountStore()).users.find((x) => x.id === id);
  if (u) { u.pro_tester = true; await saveAccountStore(); }
}
```

- [ ] **Step 6: Pass the flag into the entitlement decision**

In `server.js`'s `getEntitlements` (currently line ~1279), leave the admin short-circuit and the `!proEnabledFor` branch exactly as they are, and pass `tester` into the final call. Replace the trailing `return ENT.computeEntitlements({...})` with:

```js
  // Deliberately NOT a short-circuit above the DB reads, unlike the admin
  // branch: a tester may also be a paying subscriber, and entitlements.js
  // resolves the comped branch only when there is no live subscription to
  // prefer. Reading the subscription is what makes that possible.
  const tester = Boolean(user && user.pro_tester);
  return ENT.computeEntitlements({
    user, subscription, purchase, usage, reportId, now, enabled: true, tester,
  });
```

- [ ] **Step 7: Verify nothing regressed**

```bash
node --check server.js && npm test
```

Expected: syntax clean, all tests PASS. (No new tests here — the rule is already covered by Task 1 and the route is not wired until Task 3.)

- [ ] **Step 8: Commit**

```bash
git add migrations/022-tester-passkey.sql migrations/APPLIED.md server.js
git commit -m "Store comped-tester access as a per-account flag"
```

---

### Task 3: The redeem route

**Files:**
- Modify: `server.js` (the route, and `tester` in `/api/config`)
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `TESTER_PASSKEY`, `setUserTester(id)`, `getSessionUser(req)` from Task 2; `secretMatches(candidate, secret)`, `rateLimited(ip, max, windowMs)`, `clientIp(req)`, `sendJson(res, status, body)` — all pre-existing helpers in `server.js`.
- Produces: `POST /api/redeem-passkey`, body `{ passkey: string }`, answering `{ ok: true }` / `{ ok: true, already: true }` / an `{ error }` with status 404, 401, 429 or 500. And `/api/config`'s `pro.tester` boolean.

- [ ] **Step 1: Write the failing tests**

Add to `test/routes.test.js`, as a new top-level `test(...)` block at the end of the file:

```js
// --- The tester passkey -----------------------------------------------------
//
// A shared code that comps Pro to a SIGNED-IN account, separate from
// ADMIN_KEY (which also unlocks /admin, /dev and /contacts). entitlements.js
// already proves what the flag grants; this proves the door is wired: that it
// does not exist when unconfigured, that it refuses an anonymous caller and a
// wrong code, and that a correct code actually reaches /api/config.
//
// No Supabase in this environment, so accounts and the pro_tester flag live in
// the git-ignored account-store.json fallback — which is exactly why this can
// run for free with no database.

test("tester passkey", async (t) => {
  await t.test("the route does not exist when TESTER_PASSKEY is unset", async () => {
    const srv = await boot({});
    t.after(() => srv.stop());
    const r = await fetch(srv.base + "/api/redeem-passkey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passkey: "anything" }),
    });
    assert.equal(r.status, 404, "an unconfigured deployment must not answer this route");
  });

  await t.test("configured: refuses anonymous and wrong codes, accepts the right one", async () => {
    const PASSKEY = "let-me-in-please";
    const srv = await boot({ PRO_ENABLED: "on", TESTER_PASSKEY: PASSKEY });
    t.after(() => srv.stop());

    const redeem = (passkey, cookie) => fetch(srv.base + "/api/redeem-passkey", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
      body: JSON.stringify({ passkey }),
    });

    // Anonymous, even with the right code: the grant lives on an account.
    const anon = await redeem(PASSKEY);
    assert.equal(anon.status, 401);

    // Make a real account and keep its session cookie.
    const email = `tester-${Date.now()}@example.com`;
    const signup = await fetch(srv.base + "/api/account/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    assert.equal(signup.status, 200, "signup should succeed against the file store");
    const cookie = String(signup.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("cn_session="), "expected a session cookie, got " + cookie);

    // Signed in but wrong code.
    const wrong = await redeem("not-the-passkey", cookie);
    assert.equal(wrong.status, 401);

    // Not a tester yet.
    const before = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(before.pro.tester, false);
    assert.equal(before.pro.isPro, false);

    // The right code, signed in.
    const ok = await redeem(PASSKEY, cookie);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);

    // ...and it reaches the entitlements the UI reads.
    const after = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(after.pro.tester, true);
    assert.equal(after.pro.isPro, true);
    assert.equal(after.pro.status, "tester");
    // The one capability a tester is deliberately denied.
    assert.equal(after.pro.canUseVault, false);

    // Redeeming twice is idempotent, not an error.
    const again = await redeem(PASSKEY, cookie);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).already, true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/routes.test.js
```

Expected: FAIL. The unset case may already pass incidentally (an unknown path 404s), but the configured case fails — `POST /api/redeem-passkey` 404s instead of 401ing the anonymous caller.

- [ ] **Step 3: Write the route**

In `server.js`, add the route beside the other account routes — immediately after the `POST /api/account/reset` handler's closing `return;` (currently around line 10230):

```js
  // --- Redeem the tester passkey: comped Pro for a signed-in account --------
  //
  // Refusal order mirrors the vault's openVault() and requireBroker(): the
  // feature not existing, then the caller, then the secret.
  //
  // Deliberately NOT ADMIN_KEY. That key also unlocks /admin, /dev and
  // /contacts, so it can never be the thing handed to testers; this grants
  // Pro and nothing else, and touches neither the dashboards nor the
  // header-only `internal` bypass in /api/comps.
  if (req.method === "POST" && req.url === "/api/redeem-passkey") {
    // Unset = the feature does not exist on this deployment. 404 rather than
    // 403, matching how the ADMIN_KEY-gated routes go dark when unconfigured:
    // a probe cannot tell a wrong code from a deployment that has no code.
    if (!TESTER_PASSKEY) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        // Tighter than the account routes' 10: this guards a SHARED secret,
        // and legitimate use is one redemption per person, ever.
        if (rateLimited("passkey:" + clientIp(req), 5, 15 * 60 * 1000)) {
          return sendJson(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
        }
        const user = await getSessionUser(req);
        // The grant is stored on an account, so there is nothing to store it
        // on for an anonymous caller. Checked BEFORE the secret compare so a
        // signed-out prober cannot use this route to test codes at all.
        if (!user) return sendJson(res, 401, { error: "Sign in first, then redeem your code." });
        // Idempotent: a second redemption is a no-op, not an error. Also
        // checked before the compare, so someone who already has access
        // cannot be told "incorrect code" by a rotated passkey.
        if (user.pro_tester) return sendJson(res, 200, { ok: true, already: true });
        const passkey = String(JSON.parse(body || "{}").passkey || "").trim();
        if (!secretMatches(passkey, TESTER_PASSKEY)) {
          return sendJson(res, 401, { error: "That code isn't right." });
        }
        await setUserTester(user.id);
        console.log(`Tester passkey redeemed by ${user.email}`);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        // setUserTester throws on a failed write — never report success for a
        // grant that did not land.
        console.error("redeem-passkey error:", err);
        return sendJson(res, 500, { error: "Could not redeem that code. Please try again." });
      }
    });
    return;
  }
```

- [ ] **Step 4: Surface it on `/api/config`**

In the `/api/config` handler's `pro` block (currently line ~12299), add one field directly after the existing `admin:` line:

```js
          // Comped tester access. Presentation only, like every field here —
          // the routes re-resolve entitlements server-side, so editing this
          // response relabels a plan card and unlocks nothing.
          tester: ent.tester === true,
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --check server.js && npm test
```

Expected: all PASS, including the new `tester passkey` block.

- [ ] **Step 6: Commit**

```bash
git add server.js test/routes.test.js
git commit -m "Add POST /api/redeem-passkey for comped tester access"
```

---

### Task 4: The pricing-modal UI

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `POST /api/redeem-passkey` and `/api/config`'s `pro.tester` from Task 3; the pre-existing `refreshProConfig()`, `closePricingModal()`, `currentUser`, `proConfig`, and `openPricingModal()`.
- Produces: `isTesterPro()` → boolean. New element ids: `#passkeyToggle`, `#passkeyRow`, `#passkeyInput`, `#passkeySubmit`, `#passkeyMsg`.

- [ ] **Step 1: Add the markup**

In `index.html`, inside `#pricingModal`, insert this between the `#pricingError` paragraph and the "Prices in USD" paragraph (currently lines 882-885). Every class used here already appears elsewhere in the file, so this needs no new Tailwind utilities:

```html
      <!-- Comped access for beta testers. Hidden until /api/config resolves,
           and shown only to a signed-in non-Pro visitor: the grant is stored
           on an account, so there is nothing to attach it to signed out. -->
      <div id="passkeyRow" class="hidden mt-4 pt-4 border-t border-[#E4E2DA]">
        <button id="passkeyToggle" type="button" aria-expanded="false"
          class="text-sm text-[#68707E] hover:text-[#374253] underline">
          Have a code?
        </button>
        <div id="passkeyForm" class="hidden mt-3 flex flex-col sm:flex-row gap-2">
          <input id="passkeyInput" type="text" autocomplete="off" placeholder="Enter your code" aria-label="Access code"
            class="w-full min-w-0 rounded-lg border border-[#D8D4C9] px-3 py-2 focus:ring-2 focus:ring-brand-600 focus:border-brand-600 outline-none" />
          <button id="passkeySubmit" type="button"
            class="shrink-0 w-full sm:w-auto bg-[#1A2433] text-white font-semibold text-sm px-4 py-2.5 rounded-lg disabled:opacity-60">
            Redeem
          </button>
        </div>
        <p id="passkeyMsg" class="hidden mt-2 text-sm"></p>
      </div>
```

- [ ] **Step 2: Add the `isTesterPro` helper and the billing-history exclusion**

In `index.html`, directly after the existing `isAdminPro()` (currently line 9833):

```js
  function isTesterPro() { return Boolean(proConfig && proConfig.tester); }
```

Then extend `hasBillingHistory()` (currently line ~9846). A comped tester's `status` is `"tester"`, not `"none"`, so without this they would be offered a "Manage billing" button that 400s at Stripe — the same trap admins are already excluded from:

```js
  function hasBillingHistory() {
    return Boolean(currentUser) && proConfig && proConfig.status
      && proConfig.status !== "none" && !isAdminPro() && !isTesterPro();
  }
```

- [ ] **Step 3: Add the plan-card copy**

In `billingStatusCopy()` (currently line ~10008), add a branch immediately after the existing `if (p.admin) { ... }` block and before the Stripe-status branches — same position, same reason: a tester has none of those states either.

```js
    if (p.tester) {
      return {
        title: "Pro — comped (beta tester)",
        detail: "Full Pro access as a beta tester. Nothing is billed, and there's no subscription behind it. The private broker vault isn't included.",
      };
    }
```

- [ ] **Step 4: Show and wire the redeem row**

In `refreshBillingUI()` (currently line ~10061), add this beside the other visibility toggles — put it directly after the `pricingLink` toggle line:

```js
    // The redeem row: signed-in, not already Pro. Deliberately NOT gated on
    // billingLive() — a code is exactly what someone uses on a deployment
    // with no Stripe keys, the same exception the vault link makes.
    document.getElementById("passkeyRow")
      .classList.toggle("hidden", !currentUser || pro);
```

Then add the handlers next to the other pricing-modal listeners, right after the `pricingCancel` listener (currently line ~10452):

```js
  document.getElementById("passkeyToggle").addEventListener("click", (e) => {
    const form = document.getElementById("passkeyForm");
    const open = form.classList.toggle("hidden");
    e.currentTarget.setAttribute("aria-expanded", String(!open));
    if (!open) document.getElementById("passkeyInput").focus();
  });

  async function submitPasskey() {
    const input = document.getElementById("passkeyInput");
    const btn = document.getElementById("passkeySubmit");
    const msg = document.getElementById("passkeyMsg");
    const code = input.value.trim();
    if (!code) return;
    msg.classList.add("hidden");
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Checking…";
    try {
      const r = await fetch("/api/redeem-passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passkey: code }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Could not redeem that code.");
      input.value = "";
      // Re-read /api/config so every entitlement-driven surface updates in
      // place — the same seam used after a checkout return and a sign-in.
      await refreshProConfig();
      closePricingModal();
    } catch (ex) {
      msg.textContent = ex.message;
      msg.className = "mt-2 text-sm text-red-700";
      msg.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  document.getElementById("passkeySubmit").addEventListener("click", submitPasskey);
  document.getElementById("passkeyInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitPasskey(); }
  });
```

- [ ] **Step 5: Verify in a browser**

Start the app and drive it — do not report this task done on a code read alone.

```bash
npm start
```

With `PRO_ENABLED=on` and `TESTER_PASSKEY=<something>` set in `.env`, in the browser:
1. Open the pricing modal signed out → the "Have a code?" row must be **absent**.
2. Create an account, reopen the modal → the row must be **present**.
3. Enter a wrong code → an inline red "That code isn't right." with the modal still open.
4. Enter the right code → the modal closes, and the plan card on My Desk reads "Pro — comped (beta tester)" with **no** "Manage billing" button and **no** vault link.
5. Reload the page → still Pro (the grant is persisted, not in-memory).

- [ ] **Step 6: Verify the vendored CSS did not drift**

The markup above reuses existing classes, so the Tailwind hook's regen should be a no-op. Confirm:

```bash
git status --short tailwind.css
```

Expected: no output. If `tailwind.css` *did* change, read the diff — a genuinely new utility must be committed alongside the HTML; an unrelated wholesale rewrite means the regen picked up someone else's in-flight edit and should not be committed here.

- [ ] **Step 7: Run the tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add a redeem-a-code row to the pricing modal"
```

---

### Task 5: Documentation and changelog

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `devlog.json`

**Interfaces:**
- Consumes: everything above. Produces nothing consumed by code.

- [ ] **Step 1: Document the variable in `.env.example`**

Append:

```bash
# Optional shared passkey that comps Pro to a signed-in account (beta testers).
# Unset = POST /api/redeem-passkey 404s and the "Have a code?" row never shows.
# NOT the same as ADMIN_KEY, which also unlocks /admin, /dev and /contacts.
# Revoke one tester without changing the code for everyone else:
#   update users set pro_tester = false where email = 'someone@example.com';
# TESTER_PASSKEY=pick-something-long
```

- [ ] **Step 2: Document it in `CLAUDE.md`**

In the "Configuration (environment / `.env`)" list, add an entry immediately after the `ADMIN_KEY` bullet (it is the closest relative and the one it must not be confused with):

```markdown
- `TESTER_PASSKEY` — optional shared passkey that comps Pro to a **signed-in**
  account (the beta-tester door). Unset = `POST /api/redeem-passkey` 404s and
  the pricing modal's "Have a code?" row never renders, so this is inert on any
  deployment that never configured it. **It is not `ADMIN_KEY`**: that key also
  unlocks `/admin`, `/dev` and `/contacts`, so it can never be the thing handed
  to testers. Redeeming sets `users.pro_tester` (migration 022), so the grant
  follows the ACCOUNT across devices, survives a passkey rotation, and is
  revoked one tester at a time with a one-row `update users set pro_tester =
  false where email = …` rather than by rotating the code for everyone.
  Rules live in `entitlements.js`, so `npm test` covers them; four of them
  matter. It grants everything Pro **except the broker vault** — the vault is a
  private-data workspace with an upload endpoint, and a passkey shared with a
  wider group is a bigger surface than "try Pro's reports". It **cannot switch
  a dark deployment on** (`PRO_ENABLED` still wins, same as the admin branch).
  Its `status` is `"tester"`, never `"active"`, so the UI never offers a
  billing portal to an account with no Stripe customer. And unlike the admin
  branch it is **checked as a fallback after the subscription**, not as an
  early short-circuit: a tester who later subscribes gets their real Stripe
  status and their billing portal, and comped access resumes if that
  subscription lapses. A tester is also NOT the `internal` bypass in
  `/api/comps`, which stays header-only.
```

Also, in the "Admin access — comped Pro for the team" section, add a closing line so a future editor does not mistake one door for the other:

```markdown
This is not the only comped-Pro door: `TESTER_PASSKEY` (above) comps Pro to a
signed-in account without any dashboard access, and stores the grant on the
user row rather than in a cookie. Admin wins outright and skips the billing
reads; a tester deliberately yields to a real subscription.
```

- [ ] **Step 3: Add the devlog entry**

Append to `devlog.json` (save as clean UTF-8, and do not escape the em dash):

```json
{
  "date": "2026-08-10",
  "type": "feature",
  "title": "Comped Pro for beta testers with a shared passkey",
  "details": "A signed-in visitor can redeem a code in the pricing modal for full Pro access — everything except the private broker vault. Separate from the admin key, which also unlocks the internal dashboards. The grant is stored on the account, so it follows a tester across devices and one tester can be revoked without changing the code for everyone."
}
```

- [ ] **Step 4: Verify the devlog is still valid UTF-8 JSON**

```bash
node -e "const d=require('./devlog.json'); const s=require('fs').readFileSync('devlog.json','utf8'); if(/Ã|â€|Â/.test(s)) throw new Error('mojibake in devlog.json'); console.log('ok', d.length, 'entries')"
```

Expected: `ok <n> entries`. A thrown mojibake error means the file was written in the wrong encoding — rewrite it as UTF-8 rather than ASCII-escaping the punctuation. (CI runs the same check.)

- [ ] **Step 5: Run the full check locally**

```bash
node --check server.js && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .env.example CLAUDE.md devlog.json
git commit -m "Document the tester passkey"
```

---

## Deploying

**Run migration 022 before deploying**, then update its row in `migrations/APPLIED.md` with the evidence. The migration is additive, idempotent and safe in both orders (see the file's own header), so this is a should, not a must — but the log must reflect reality either way.

Then set `TESTER_PASSKEY` in the Render environment. Until it is set, the feature is fully dark: the route 404s and the UI row never renders. Confirm after deploying by opening the pricing modal signed in and checking the "Have a code?" row appears.

Use the `deploy` skill for the push itself.

## Self-Review

**Spec coverage:** `TESTER_PASSKEY` → Task 2 Step 3. `users.pro_tester` + migration → Task 2 Steps 1-2. `POST /api/redeem-passkey` with its five-step refusal order → Task 3 Step 3. The `getSessionUser` projection trap → Task 2 Step 4. The subscription-wins fallback placement → Task 1 Step 3. No vault for testers → Task 1 (rule) + Task 1 Step 1 (test). `/api/config`'s `tester` → Task 3 Step 4. Pricing-modal row → Task 4 Steps 1, 4. Plan-card copy → Task 4 Step 3. `hasBillingHistory()` exclusion → Task 4 Step 2. Rate limiting → Task 3 Step 3. Tests → Tasks 1 and 3. Docs → Task 5. No gaps.

**Placeholders:** none — every step carries the literal code or command to run.

**Type consistency:** `tester` is the parameter name in `computeEntitlements` and the field name on every returned object, on `/api/config`'s `pro` block, and behind `isTesterPro()`; `pro_tester` is the database column and the field on the session user, used consistently in `setUserTester`, `getSessionUser`, `getEntitlements` and the SQL. `setUserTester(id)` is defined in Task 2 and called in Task 3 with `user.id`.
