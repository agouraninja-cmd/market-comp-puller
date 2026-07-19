# CompNinja Accounts + My Desk (Portfolio & Watchlist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email+password accounts with a server-synced property portfolio (value-snapshot history) and an in-app market watchlist fed by the existing comp corpus.

**Architecture:** All server work goes into `server.js` following its existing zero-dependency patterns (Supabase via REST `fetch`, file fallback, `sendJson`, `rateLimited`, `logEvent`). All UI goes into `index.html` following its existing patterns (leadModal-style modals, `renderResults`, `savedReports`). Auth = scrypt password hashes + random session tokens (stored hashed) in an httpOnly cookie.

**Tech Stack:** Plain Node 18+ (built-in `crypto`, `fetch`), Supabase REST, Resend REST, vanilla JS + vendored Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-18-accounts-portfolio-watchlist-design.md`

**Testing note (overrides the default TDD flow):** This repo has no test suite, no test runner, and CLAUDE.md documents that as deliberate. Per the approved spec, verification is endpoint-level: after each server task run `node --check`, restart the dev server, and drive the new routes with `curl`, comparing against the expected output written into each step. Front-end tasks are verified in the browser preview. Do not introduce a test framework.

**Dev commands used throughout (Git Bash):**

```bash
NODE="$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe"
"$NODE" --check server.js          # syntax gate after every server.js edit
```

Restart the dev server after every `server.js` change (index.html changes need only a browser refresh). Kill whatever listens on port 3000, then relaunch `server.js` with the portable node (run it in the background). Run curl tests WITHOUT Supabase env vars so the file/memory fallback is exercised (`.env` on the dev machine has no SUPABASE_* set — if it does, temporarily comment them out).

---

## File Structure

- **Modify `server.js`** — one new "Accounts" section (constants, DDL comment, crypto/cookie helpers, data-access layer) placed after the existing rate-limit section (~line 251), and new route blocks inserted after the `/api/lead` route block (~line 1770). The repo's style is one big file; follow it.
- **Modify `index.html`** — header nav (~line 580), report toolbar (~line 779), account modal (after leadModal, ~line 471), My Desk section (after `#savedWrap`'s parent block, ~line 706), and new JS (account state, My Desk rendering) inside the existing main `<script>`.
- **Modify `.gitignore`** — add `account-store.json` (PII).
- **New file `account-store.json`** — created at runtime by the file fallback; never committed.

---

### Task 1: Server foundation — auth helpers + account data layer

**Files:**
- Modify: `server.js` (insert one new section after the `rateLimited` function, i.e. after line ~251, before the "Daily search cap" section)

- [ ] **Step 1: Insert the Accounts section**

Paste this entire block into `server.js` between the rate-limit section and the "Daily search cap" section:

```js
// ---------------------------------------------------------------------------
// Accounts — email+password users, hashed session tokens, portfolio +
// watchlist stores. Supabase when configured, one local JSON file otherwise.
// DDL (run in the Supabase SQL editor; legacy service_role key already works):
//
//   create table users (
//     id uuid primary key default gen_random_uuid(),
//     email text not null unique,
//     password_hash text not null,
//     name text,
//     created_at timestamptz not null default now()
//   );
//   create table sessions (
//     token_hash text primary key,
//     user_id uuid not null references users(id) on delete cascade,
//     created_at timestamptz not null default now(),
//     expires_at timestamptz not null
//   );
//   create table portfolio_items (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null references users(id) on delete cascade,
//     address text not null,
//     property_type text not null,
//     payload jsonb not null,
//     snapshots jsonb not null default '[]',
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );
//   create table watchlist_items (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null references users(id) on delete cascade,
//     market text not null,
//     property_type text not null,
//     last_seen_at timestamptz not null default now(),
//     created_at timestamptz not null default now(),
//     unique (user_id, market, property_type)
//   );
//   create table password_resets (
//     token_hash text primary key,
//     user_id uuid not null references users(id) on delete cascade,
//     expires_at timestamptz not null,
//     used boolean not null default false,
//     created_at timestamptz not null default now()
//   );
// ---------------------------------------------------------------------------
const ACCOUNT_STORE_FILE = path.join(__dirname, "account-store.json");
const SESSION_COOKIE = "cn_session";
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;   // stay signed in ~90 days
const RESET_TTL_MS = 60 * 60 * 1000;               // reset links live 1 hour

function sha256Hex(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, dk) => {
      if (err) return reject(err);
      resolve(`scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("base64")}$${dk.toString("base64")}`);
    });
  });
}
function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    try {
      const [algo, params, saltB64, hashB64] = String(stored || "").split("$");
      if (algo !== "scrypt") return resolve(false);
      const opts = {};
      params.split(",").forEach((kv) => { const [k, v] = kv.split("="); opts[k] = Number(v); });
      const salt = Buffer.from(saltB64, "base64");
      const expected = Buffer.from(hashB64, "base64");
      crypto.scrypt(String(password), salt, expected.length, { N: opts.N, r: opts.r, p: opts.p }, (err, dk) => {
        if (err) return resolve(false);
        resolve(dk.length === expected.length && crypto.timingSafeEqual(dk, expected));
      });
    } catch (_) { resolve(false); }
  });
}
// Equalizes login timing whether or not the email exists.
let DUMMY_HASH = "";
hashPassword("dummy-timing-equalizer").then((h) => { DUMMY_HASH = h; }).catch(() => {});

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSessionCookie(res, req, token, maxAgeSec) {
  const secure = /^(localhost|127\.)/.test(String(req.headers.host || "")) ? "" : "; Secure";
  res.setHeader("set-cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
}

// --- storage: Supabase REST when configured, account-store.json otherwise ---
async function sbRequest(method, pathAndQuery, body, extraHeaders) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { ...supabaseHeaders(), ...(extraHeaders || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase ${method} ${pathAndQuery.split("?")[0]} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

let accountStoreCache = null;
async function accountStore() {
  if (accountStoreCache) return accountStoreCache;
  try {
    accountStoreCache = JSON.parse(await fs.promises.readFile(ACCOUNT_STORE_FILE, "utf8"));
  } catch (_) {
    accountStoreCache = { users: [], sessions: [], portfolio: [], watchlist: [] };
  }
  for (const k of ["users", "sessions", "portfolio", "watchlist"]) {
    if (!Array.isArray(accountStoreCache[k])) accountStoreCache[k] = [];
  }
  return accountStoreCache;
}
async function saveAccountStore() {
  await fs.promises.writeFile(ACCOUNT_STORE_FILE, JSON.stringify(accountStoreCache));
}

// --- users ---
async function findUserByEmail(email) {
  if (DB_CONFIGURED) {
    const rows = await sbRequest("GET", `users?email=eq.${encodeURIComponent(email)}&limit=1`);
    return rows && rows[0] ? rows[0] : null;
  }
  return (await accountStore()).users.find((u) => u.email === email) || null;
}
async function findUserById(id) {
  if (DB_CONFIGURED) {
    const rows = await sbRequest("GET", `users?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows && rows[0] ? rows[0] : null;
  }
  return (await accountStore()).users.find((u) => u.id === id) || null;
}
async function createUser({ email, password_hash, name }) {
  const row = { email, password_hash, name: name || "", created_at: new Date().toISOString() };
  if (DB_CONFIGURED) {
    const rows = await sbRequest("POST", "users", row, { prefer: "return=representation" });
    return rows[0];
  }
  row.id = crypto.randomUUID();
  (await accountStore()).users.push(row);
  await saveAccountStore();
  return row;
}
async function updateUserPassword(id, password_hash) {
  if (DB_CONFIGURED) {
    return sbRequest("PATCH", `users?id=eq.${encodeURIComponent(id)}`, { password_hash });
  }
  const u = (await accountStore()).users.find((x) => x.id === id);
  if (u) { u.password_hash = password_hash; await saveAccountStore(); }
}
async function deleteUserCascade(id) {
  if (DB_CONFIGURED) {
    // FK "on delete cascade" wipes sessions/portfolio/watchlist rows.
    return sbRequest("DELETE", `users?id=eq.${encodeURIComponent(id)}`);
  }
  const s = await accountStore();
  s.users = s.users.filter((u) => u.id !== id);
  s.sessions = s.sessions.filter((x) => x.user_id !== id);
  s.portfolio = s.portfolio.filter((x) => x.user_id !== id);
  s.watchlist = s.watchlist.filter((x) => x.user_id !== id);
  await saveAccountStore();
}

// --- sessions (raw token only ever lives in the cookie; we store its hash) ---
const sessionCache = new Map(); // token_hash -> { user_id, expires_at }
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const row = {
    token_hash: sha256Hex(token),
    user_id: userId,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  if (DB_CONFIGURED) {
    await sbRequest("POST", "sessions", row, { prefer: "return=minimal" });
  } else {
    (await accountStore()).sessions.push(row);
    await saveAccountStore();
  }
  sessionCache.set(row.token_hash, { user_id: row.user_id, expires_at: row.expires_at });
  return token;
}
async function findSessionByHash(tokenHash) {
  if (DB_CONFIGURED) {
    const rows = await sbRequest("GET", `sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`);
    return rows && rows[0] ? rows[0] : null;
  }
  return (await accountStore()).sessions.find((x) => x.token_hash === tokenHash) || null;
}
async function deleteSessionByToken(token) {
  const th = sha256Hex(token);
  sessionCache.delete(th);
  if (DB_CONFIGURED) return sbRequest("DELETE", `sessions?token_hash=eq.${encodeURIComponent(th)}`);
  const s = await accountStore();
  s.sessions = s.sessions.filter((x) => x.token_hash !== th);
  await saveAccountStore();
}
async function deleteSessionsForUser(userId) {
  for (const [k, v] of sessionCache) { if (v.user_id === userId) sessionCache.delete(k); }
  if (DB_CONFIGURED) return sbRequest("DELETE", `sessions?user_id=eq.${encodeURIComponent(userId)}`);
  const s = await accountStore();
  s.sessions = s.sessions.filter((x) => x.user_id !== userId);
  await saveAccountStore();
}
async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const th = sha256Hex(token);
  let sess = sessionCache.get(th);
  if (!sess) {
    try { sess = await findSessionByHash(th); } catch (e) { console.error("Session lookup failed:", e.message); return null; }
    if (sess) {
      sessionCache.set(th, { user_id: sess.user_id, expires_at: sess.expires_at });
      if (sessionCache.size > 5000) sessionCache.clear(); // crude cap; repopulates on demand
    }
  }
  if (!sess || new Date(sess.expires_at).getTime() < Date.now()) { sessionCache.delete(th); return null; }
  try {
    const user = await findUserById(sess.user_id);
    return user ? { id: user.id, email: user.email, name: user.name || "" } : null;
  } catch (e) { console.error("User lookup failed:", e.message); return null; }
}
// Route guard: replies 401 itself; callers bail on null.
async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) { sendJson(res, 401, { error: "Not signed in." }); return null; }
  return user;
}

// --- password resets (memory + best-effort DB, 1-hour tokens) ---
const resetCache = new Map(); // token_hash -> { user_id, expires_at, used }
async function createPasswordReset(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const row = {
    token_hash: sha256Hex(token),
    user_id: userId,
    expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    used: false,
    created_at: new Date().toISOString(),
  };
  resetCache.set(row.token_hash, row);
  if (DB_CONFIGURED) {
    sbRequest("POST", "password_resets", row, { prefer: "return=minimal" })
      .catch((e) => console.error("Reset row DB insert failed (memory copy still works):", e.message));
  }
  return token;
}
async function consumePasswordReset(token) {
  const th = sha256Hex(token);
  let row = resetCache.get(th);
  if (!row && DB_CONFIGURED) {
    try {
      const rows = await sbRequest("GET", `password_resets?token_hash=eq.${encodeURIComponent(th)}&limit=1`);
      row = rows && rows[0] ? rows[0] : null;
    } catch (_) { row = null; }
  }
  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) return null;
  row.used = true;
  resetCache.set(th, row);
  if (DB_CONFIGURED) {
    sbRequest("PATCH", `password_resets?token_hash=eq.${encodeURIComponent(th)}`, { used: true }).catch(() => {});
  }
  return row.user_id;
}
```

- [ ] **Step 2: Syntax check**

Run: `"$NODE" --check server.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Add account foundation: scrypt hashing, hashed sessions, user/portfolio/watchlist storage layer"
```

---

### Task 2: Account routes — signup / login / logout / me / delete

**Files:**
- Modify: `server.js` — insert one route block right AFTER the closing of the `/api/lead` route (find it with `grep -n '"/api/lead"' server.js`; the block ends at the `return;` before the next `if (req.method`).

- [ ] **Step 1: Insert the route block**

```js
  // --- Accounts: signup / login / logout / me / delete ---------------------
  if (req.method === "POST" && (req.url === "/api/account/signup" || req.url === "/api/account/login")) {
    const isSignup = req.url === "/api/account/signup";
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (rateLimited("acct:" + clientIp(req), 10, 15 * 60 * 1000)) {
          return sendJson(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
        }
        const { email, password, name } = JSON.parse(body || "{}");
        const emailOk = String(email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailOk)) {
          return sendJson(res, 400, { error: "A valid email is required." });
        }
        if (isSignup && String(password || "").length < 8) {
          return sendJson(res, 400, { error: "Password must be at least 8 characters." });
        }
        const existing = await findUserByEmail(emailOk);
        if (isSignup) {
          if (existing) return sendJson(res, 409, { error: "An account with this email already exists — sign in instead." });
          const user = await createUser({
            email: emailOk,
            password_hash: await hashPassword(password),
            name: String(name || "").trim().slice(0, 120),
          });
          const token = await createSession(user.id);
          setSessionCookie(res, req, token, Math.floor(SESSION_TTL_MS / 1000));
          logEvent("signup", {});
          console.log(`Account created: ${emailOk}`);
          return sendJson(res, 200, { email: user.email, name: user.name || "" });
        }
        // login — identical 401 for unknown email and wrong password.
        const ok = await verifyPassword(password, existing ? existing.password_hash : DUMMY_HASH);
        if (!existing || !ok) return sendJson(res, 401, { error: "Incorrect email or password." });
        const token = await createSession(existing.id);
        setSessionCookie(res, req, token, Math.floor(SESSION_TTL_MS / 1000));
        logEvent("login", {});
        return sendJson(res, 200, { email: existing.email, name: existing.name || "" });
      } catch (err) {
        console.error(`Error handling ${req.url}:`, err);
        return sendJson(res, 500, { error: "Account request failed. Please try again." });
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/account/logout") {
    req.on("data", () => {});
    req.on("end", async () => {
      try {
        const token = parseCookies(req)[SESSION_COOKIE];
        if (token) await deleteSessionByToken(token);
      } catch (err) { console.error("Logout error:", err.message); }
      setSessionCookie(res, req, "", 0);
      return sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/account/me") {
    getSessionUser(req).then((user) => {
      if (!user) return sendJson(res, 401, { error: "Not signed in." });
      return sendJson(res, 200, { email: user.email, name: user.name });
    }).catch((err) => {
      console.error("me error:", err);
      sendJson(res, 500, { error: "Account lookup failed." });
    });
    return;
  }

  if (req.method === "DELETE" && req.url === "/api/account") {
    (async () => {
      const user = await requireUser(req, res);
      if (!user) return;
      await deleteUserCascade(user.id);
      setSessionCookie(res, req, "", 0);
      console.log(`Account deleted: ${user.email}`);
      return sendJson(res, 200, { ok: true });
    })().catch((err) => {
      console.error("Account delete error:", err);
      sendJson(res, 500, { error: "Could not delete the account." });
    });
    return;
  }
```

- [ ] **Step 2: Syntax check, restart server**

Run: `"$NODE" --check server.js` → exit 0. Restart the dev server.

- [ ] **Step 3: Verify with curl (file-fallback mode)**

```bash
CJ=/tmp/cn-cookies
curl -s -c $CJ -X POST localhost:3000/api/account/signup -H "content-type: application/json" \
  -d '{"email":"qa@example.com","password":"password123","name":"QA"}'
# Expected: {"email":"qa@example.com","name":"QA"}   (and $CJ now holds cn_session)
curl -s -b $CJ localhost:3000/api/account/me
# Expected: {"email":"qa@example.com","name":"QA"}
curl -s -X POST localhost:3000/api/account/signup -H "content-type: application/json" \
  -d '{"email":"qa@example.com","password":"password123"}'
# Expected: 409 {"error":"An account with this email already exists — sign in instead."}
curl -s -X POST localhost:3000/api/account/login -H "content-type: application/json" \
  -d '{"email":"qa@example.com","password":"WRONG-pass"}'
# Expected: 401 {"error":"Incorrect email or password."}
curl -s -b $CJ -X POST localhost:3000/api/account/logout
# Expected: {"ok":true}; a following /api/account/me with $CJ returns 401
```

Also verify `account-store.json` exists and `git status` does NOT list it as tracked (it will show untracked until Task 10 adds it to .gitignore — that's fine, just never `git add` it).

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add account routes: signup, login, logout, me, delete"
```

---

### Task 3: Password reset — forgot / reset routes

**Files:**
- Modify: `server.js` — insert immediately after the Task 2 route block.

- [ ] **Step 1: Insert the routes**

```js
  // --- Password reset: request a link, then set the new password -----------
  if (req.method === "POST" && req.url === "/api/account/forgot") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (rateLimited("acct:" + clientIp(req), 10, 15 * 60 * 1000)) {
          return sendJson(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
        }
        const email = String((JSON.parse(body || "{}").email) || "").trim().toLowerCase();
        const user = email ? await findUserByEmail(email) : null;
        if (user) {
          const token = await createPasswordReset(user.id);
          const link = `${SITE_URL}/#reset=${token}`;
          if (EMAIL_FROM) {
            sendOutboundEmail(user.email, "Reset your CompNinja password",
              `Someone (hopefully you) asked to reset the password for this CompNinja account.\n\n` +
              `Reset it here (link works for 1 hour):\n${link}\n\n` +
              `If this wasn't you, ignore this email — your password is unchanged.`);
          } else {
            console.log(`Password reset link for ${user.email} (EMAIL_FROM unset, not emailed): ${link}`);
          }
        }
        // Same answer either way — never confirms whether an account exists.
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        console.error("forgot error:", err);
        return sendJson(res, 500, { error: "Could not process the request." });
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/account/reset") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        const { token, password } = JSON.parse(body || "{}");
        if (String(password || "").length < 8) {
          return sendJson(res, 400, { error: "Password must be at least 8 characters." });
        }
        const userId = await consumePasswordReset(String(token || ""));
        if (!userId) return sendJson(res, 400, { error: "That reset link is invalid or has expired — request a new one." });
        await updateUserPassword(userId, await hashPassword(password));
        await deleteSessionsForUser(userId); // every device must sign in again
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        console.error("reset error:", err);
        return sendJson(res, 500, { error: "Could not reset the password." });
      }
    });
    return;
  }
```

- [ ] **Step 2: Syntax check, restart, verify with curl**

```bash
"$NODE" --check server.js
# restart server, then:
curl -s -X POST localhost:3000/api/account/forgot -H "content-type: application/json" -d '{"email":"qa@example.com"}'
# Expected: {"ok":true} AND the server console logs "Password reset link for qa@example.com ... /#reset=<TOKEN>"
curl -s -X POST localhost:3000/api/account/forgot -H "content-type: application/json" -d '{"email":"nobody@example.com"}'
# Expected: {"ok":true} and NO console log — identical answer, no enumeration
# Copy <TOKEN> from the console log:
curl -s -X POST localhost:3000/api/account/reset -H "content-type: application/json" -d '{"token":"<TOKEN>","password":"newpass456"}'
# Expected: {"ok":true}
curl -s -X POST localhost:3000/api/account/reset -H "content-type: application/json" -d '{"token":"<TOKEN>","password":"newpass456"}'
# Expected: 400 (token already used)
curl -s -X POST localhost:3000/api/account/login -H "content-type: application/json" -d '{"email":"qa@example.com","password":"newpass456"}'
# Expected: {"email":"qa@example.com","name":"QA"}
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Add password reset routes (Resend email, 1-hour single-use tokens)"
```

---

### Task 4: Portfolio routes

**Files:**
- Modify: `server.js` — data-access helpers go at the end of the Task 1 Accounts section; routes go after the Task 3 block.

- [ ] **Step 1: Add portfolio data-access helpers (end of the Accounts section)**

```js
// --- portfolio ---
const PORTFOLIO_MAX_ITEMS = 100;
const PORTFOLIO_MAX_SNAPSHOTS = 60;
async function listPortfolio(userId) {
  if (DB_CONFIGURED) {
    return sbRequest("GET",
      `portfolio_items?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=id,address,property_type,snapshots,created_at,updated_at&order=updated_at.desc&limit=200`) || [];
  }
  return (await accountStore()).portfolio.filter((x) => x.user_id === userId)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map(({ payload, ...rest }) => rest);
}
async function getPortfolioItem(userId, id) {
  if (DB_CONFIGURED) {
    const rows = await sbRequest("GET",
      `portfolio_items?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows && rows[0] ? rows[0] : null;
  }
  return (await accountStore()).portfolio.find((x) => x.user_id === userId && x.id === id) || null;
}
async function insertPortfolioItem(userId, { address, property_type, payload, snapshot }) {
  const now = new Date().toISOString();
  const row = {
    user_id: userId, address, property_type, payload,
    snapshots: snapshot ? [snapshot] : [],
    created_at: now, updated_at: now,
  };
  if (DB_CONFIGURED) {
    const rows = await sbRequest("POST", "portfolio_items", row, { prefer: "return=representation" });
    return rows[0];
  }
  row.id = crypto.randomUUID();
  (await accountStore()).portfolio.push(row);
  await saveAccountStore();
  return row;
}
async function updatePortfolioItem(userId, id, { payload, snapshot }) {
  const existing = await getPortfolioItem(userId, id);
  if (!existing) return null;
  const snapshots = Array.isArray(existing.snapshots) ? existing.snapshots.slice() : [];
  if (snapshot) snapshots.push(snapshot);
  while (snapshots.length > PORTFOLIO_MAX_SNAPSHOTS) snapshots.shift();
  const patch = { payload, snapshots, updated_at: new Date().toISOString() };
  if (DB_CONFIGURED) {
    await sbRequest("PATCH",
      `portfolio_items?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}`, patch);
  } else {
    Object.assign(existing, patch);
    await saveAccountStore();
  }
  return { ...existing, ...patch };
}
async function deletePortfolioItem(userId, id) {
  if (DB_CONFIGURED) {
    return sbRequest("DELETE",
      `portfolio_items?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}`);
  }
  const s = await accountStore();
  s.portfolio = s.portfolio.filter((x) => !(x.user_id === userId && x.id === id));
  await saveAccountStore();
}
// Client-computed snapshot -> sanitized {ts, low, likely, high, median_psf} or null.
function cleanSnapshot(snap) {
  if (!snap || typeof snap !== "object") return null;
  const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null; };
  const out = { ts: new Date().toISOString(), low: n(snap.low), likely: n(snap.likely), high: n(snap.high), median_psf: n(snap.median_psf) };
  return out.likely ? out : null; // a snapshot with no likely value is noise
}
```

- [ ] **Step 2: Add the routes (after the Task 3 block)**

```js
  // --- Portfolio: the signed-in user's saved properties --------------------
  if (req.url === "/api/portfolio" || req.url.startsWith("/api/portfolio?")) {
    if (req.method === "GET") {
      (async () => {
        const user = await requireUser(req, res);
        if (!user) return;
        const id = new URL(req.url, "http://localhost").searchParams.get("id");
        if (id) {
          const item = await getPortfolioItem(user.id, id);
          if (!item) return sendJson(res, 404, { error: "Not found." });
          return sendJson(res, 200, item);
        }
        return sendJson(res, 200, { items: await listPortfolio(user.id) });
      })().catch((err) => { console.error("portfolio GET error:", err); sendJson(res, 500, { error: "Portfolio read failed." }); });
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 2e6) req.destroy(); }); // full reports are big
      req.on("end", async () => {
        try {
          const user = await requireUser(req, res);
          if (!user) return;
          const { id, payload, snapshot } = JSON.parse(body || "{}");
          if (!payload || typeof payload !== "object" || !payload.meta || !payload.data) {
            return sendJson(res, 400, { error: "A report payload ({meta, data}) is required." });
          }
          const address = String(payload.meta.address || "").trim().slice(0, 300);
          const property_type = String(payload.meta.type || "").trim().slice(0, 40);
          if (!address || !property_type) return sendJson(res, 400, { error: "The report is missing its address or type." });
          const snap = cleanSnapshot(snapshot);
          if (id) {
            const updated = await updatePortfolioItem(user.id, String(id), { payload, snapshot: snap });
            if (!updated) return sendJson(res, 404, { error: "Not found." });
            logEvent("portfolio_refresh", { prop_type: property_type, market: marketOf(address) });
            return sendJson(res, 200, { id: updated.id, snapshots: updated.snapshots });
          }
          if ((await listPortfolio(user.id)).length >= PORTFOLIO_MAX_ITEMS) {
            return sendJson(res, 400, { error: `Portfolio is full (${PORTFOLIO_MAX_ITEMS} properties).` });
          }
          const item = await insertPortfolioItem(user.id, { address, property_type, payload, snapshot: snap });
          logEvent("portfolio_add", { prop_type: property_type, market: marketOf(address) });
          return sendJson(res, 200, { id: item.id, snapshots: item.snapshots });
        } catch (err) {
          console.error("portfolio POST error:", err);
          return sendJson(res, 500, { error: "Portfolio save failed." });
        }
      });
      return;
    }
    if (req.method === "DELETE") {
      (async () => {
        const user = await requireUser(req, res);
        if (!user) return;
        const id = new URL(req.url, "http://localhost").searchParams.get("id");
        if (!id) return sendJson(res, 400, { error: "id is required." });
        await deletePortfolioItem(user.id, id);
        return sendJson(res, 200, { ok: true });
      })().catch((err) => { console.error("portfolio DELETE error:", err); sendJson(res, 500, { error: "Portfolio delete failed." }); });
      return;
    }
  }
```

- [ ] **Step 3: Syntax check, restart, verify with curl**

```bash
"$NODE" --check server.js
# restart server, sign in fresh:
CJ=/tmp/cn-cookies
curl -s -c $CJ -X POST localhost:3000/api/account/login -H "content-type: application/json" -d '{"email":"qa@example.com","password":"newpass456"}'
curl -s -b $CJ -X POST localhost:3000/api/portfolio -H "content-type: application/json" \
  -d '{"payload":{"meta":{"address":"123 Main St, Ontario, CA","type":"Industrial"},"data":{"comps":[]}},"snapshot":{"low":900000,"likely":1000000,"high":1100000,"median_psf":210}}'
# Expected: {"id":"<uuid>","snapshots":[{"ts":"...","low":900000,"likely":1000000,"high":1100000,"median_psf":210}]}
curl -s -b $CJ localhost:3000/api/portfolio
# Expected: {"items":[{ id, address, property_type, snapshots, created_at, updated_at }]}  (no payload field)
curl -s -b $CJ "localhost:3000/api/portfolio?id=<uuid>"
# Expected: the full row INCLUDING payload
curl -s -b $CJ -X POST localhost:3000/api/portfolio -H "content-type: application/json" \
  -d '{"id":"<uuid>","payload":{"meta":{"address":"123 Main St, Ontario, CA","type":"Industrial"},"data":{"comps":[]}},"snapshot":{"low":950000,"likely":1050000,"high":1150000,"median_psf":215}}'
# Expected: snapshots now has 2 entries
curl -s -X POST localhost:3000/api/portfolio -H "content-type: application/json" -d '{"payload":{"meta":{"address":"x","type":"y"},"data":{}}}'
# Expected: 401 {"error":"Not signed in."}
curl -s -b $CJ -X DELETE "localhost:3000/api/portfolio?id=<uuid>"
# Expected: {"ok":true}; list is empty again
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add portfolio routes: list/get/save/refresh/delete with snapshot history"
```

---

### Task 5: Watchlist routes + updates feed

**Files:**
- Modify: `server.js` — helpers at the end of the Accounts section, routes after the Task 4 block.

- [ ] **Step 1: Add watchlist/feed data-access helpers**

```js
// --- watchlist + feed (feed reads the existing comp_corpus) ---
const WATCHLIST_MAX_ITEMS = 20;
async function listWatchlist(userId) {
  if (DB_CONFIGURED) {
    return sbRequest("GET",
      `watchlist_items?user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=50`) || [];
  }
  return (await accountStore()).watchlist.filter((x) => x.user_id === userId);
}
async function upsertWatchlistItem(userId, market, property_type) {
  const now = new Date().toISOString();
  const row = { user_id: userId, market, property_type, last_seen_at: now, created_at: now };
  if (DB_CONFIGURED) {
    const rows = await sbRequest("POST",
      "watchlist_items?on_conflict=user_id,market,property_type", row,
      { prefer: "resolution=ignore-duplicates,return=representation" });
    return rows && rows[0] ? rows[0] : (await listWatchlist(userId)).find((x) => x.market === market && x.property_type === property_type);
  }
  const s = await accountStore();
  const dup = s.watchlist.find((x) => x.user_id === userId && x.market === market && x.property_type === property_type);
  if (dup) return dup;
  row.id = crypto.randomUUID();
  s.watchlist.push(row);
  await saveAccountStore();
  return row;
}
async function deleteWatchlistItem(userId, id) {
  if (DB_CONFIGURED) {
    return sbRequest("DELETE",
      `watchlist_items?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}`);
  }
  const s = await accountStore();
  s.watchlist = s.watchlist.filter((x) => !(x.user_id === userId && x.id === id));
  await saveAccountStore();
}
async function markWatchlistSeen(userId) {
  const now = new Date().toISOString();
  if (DB_CONFIGURED) {
    return sbRequest("PATCH", `watchlist_items?user_id=eq.${encodeURIComponent(userId)}`, { last_seen_at: now });
  }
  const s = await accountStore();
  s.watchlist.forEach((x) => { if (x.user_id === userId) x.last_seen_at = now; });
  await saveAccountStore();
}
function corpusNum(v) { const n = Number(String(v || "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; }
// Corpus rows for one watched market: DB rows (when configured) + any rows
// that fell back to the file, newest first.
async function corpusRowsForMarket(market, property_type, limit) {
  let dbRows = [];
  if (DB_CONFIGURED) {
    try {
      dbRows = await sbRequest("GET",
        `comp_corpus?market=eq.${encodeURIComponent(market)}&property_type=eq.${encodeURIComponent(property_type)}` +
        `&select=ts,address,transaction,deal_date,price_or_rate,price_per_sqft,cap_rate,source_url&order=ts.desc&limit=${limit}`) || [];
    } catch (e) { console.error("corpus feed read failed:", e.message); }
  }
  const fileRows = (await readRowsFromFile(COMP_CORPUS_FILE))
    .filter((r) => r && r.market === market && r.property_type === property_type);
  return [...dbRows, ...fileRows]
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, limit);
}
```

- [ ] **Step 2: Add the routes (after the Task 4 block)**

```js
  // --- Watchlist: watched markets + the in-app updates feed ----------------
  if (req.url === "/api/watchlist" || req.url.startsWith("/api/watchlist?")) {
    if (req.method === "GET") {
      (async () => {
        const user = await requireUser(req, res);
        if (!user) return;
        return sendJson(res, 200, { items: await listWatchlist(user.id) });
      })().catch((err) => { console.error("watchlist GET error:", err); sendJson(res, 500, { error: "Watchlist read failed." }); });
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on("end", async () => {
        try {
          const user = await requireUser(req, res);
          if (!user) return;
          const { market, property_type } = JSON.parse(body || "{}");
          const marketOk = String(market || "").trim().slice(0, 60);
          const typeOk = String(property_type || "").trim().slice(0, 40);
          if (!/^[A-Za-z .'\-]{2,40}, [A-Z]{2}$/.test(marketOk)) {
            return sendJson(res, 400, { error: 'Market must look like "City, ST".' });
          }
          if (!typeOk) return sendJson(res, 400, { error: "A property type is required." });
          if ((await listWatchlist(user.id)).length >= WATCHLIST_MAX_ITEMS) {
            return sendJson(res, 400, { error: `Watchlist is full (${WATCHLIST_MAX_ITEMS} markets).` });
          }
          const item = await upsertWatchlistItem(user.id, marketOk, typeOk);
          logEvent("watchlist_add", { prop_type: typeOk, market: marketOk });
          return sendJson(res, 200, { id: item.id });
        } catch (err) {
          console.error("watchlist POST error:", err);
          return sendJson(res, 500, { error: "Watchlist save failed." });
        }
      });
      return;
    }
    if (req.method === "DELETE") {
      (async () => {
        const user = await requireUser(req, res);
        if (!user) return;
        const id = new URL(req.url, "http://localhost").searchParams.get("id");
        if (!id) return sendJson(res, 400, { error: "id is required." });
        await deleteWatchlistItem(user.id, id);
        return sendJson(res, 200, { ok: true });
      })().catch((err) => { console.error("watchlist DELETE error:", err); sendJson(res, 500, { error: "Watchlist delete failed." }); });
      return;
    }
  }

  if (req.method === "GET" && req.url === "/api/watchlist/feed") {
    (async () => {
      const user = await requireUser(req, res);
      if (!user) return;
      const items = await listWatchlist(user.id);
      const sixMonthsAgo = Date.now() - 183 * 24 * 60 * 60 * 1000;
      let unseen = 0;
      const out = [];
      for (const w of items) {
        const rows = await corpusRowsForMarket(w.market, w.property_type, 500);
        const fresh = rows.filter((r) => String(r.ts) > String(w.last_seen_at)).slice(0, 20);
        unseen += fresh.length;
        // Median $/SF: sale rows only, trailing ~6 months — matches the
        // client-side rule that lease $/SF never mixes into valuation.
        const salePsf = rows
          .filter((r) => new Date(r.ts).getTime() > sixMonthsAgo)
          .filter((r) => !String(r.transaction || "").toLowerCase().startsWith("lease"))
          .map((r) => corpusNum(r.price_per_sqft))
          .filter(Boolean)
          .sort((a, b) => a - b);
        const median_psf = salePsf.length
          ? Math.round(salePsf[Math.floor(salePsf.length / 2)] * 100) / 100 : null;
        out.push({
          id: w.id, market: w.market, property_type: w.property_type,
          median_psf, new_count: fresh.length,
          comps: fresh.map((r) => ({
            ts: r.ts, address: r.address, transaction: r.transaction, deal_date: r.deal_date,
            price_or_rate: r.price_or_rate, price_per_sqft: r.price_per_sqft,
            cap_rate: r.cap_rate, source_url: r.source_url,
          })),
        });
      }
      logEvent("feed_view", {});
      return sendJson(res, 200, { unseen, items: out });
    })().catch((err) => { console.error("feed error:", err); sendJson(res, 500, { error: "Feed read failed." }); });
    return;
  }

  if (req.method === "POST" && req.url === "/api/watchlist/seen") {
    req.on("data", () => {});
    req.on("end", async () => {
      try {
        const user = await requireUser(req, res);
        if (!user) return;
        await markWatchlistSeen(user.id);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        console.error("seen error:", err);
        return sendJson(res, 500, { error: "Could not update the watchlist." });
      }
    });
    return;
  }
```

**Route-order caveat:** `/api/watchlist/feed` and `/api/watchlist/seen` must be dispatched — the `/api/watchlist` block above only matches exact `/api/watchlist` or `/api/watchlist?...`, never the `/feed`/`/seen` sub-paths, so ordering between these blocks doesn't matter. Verify that's true after pasting.

- [ ] **Step 3: Syntax check, restart, verify with curl**

```bash
"$NODE" --check server.js
# Seed two corpus rows the feed can find (file fallback):
cat >> comp-corpus.jsonl <<'EOF'
{"ts":"2099-01-01T00:00:00.000Z","dedupe_key":"qa-seed-1","property_type":"Industrial","market":"Ontario, CA","address":"100 Test Ave, Ontario, CA","transaction":"Sale","deal_date":"2026-06-01","size_sqft":"10000","price_or_rate":"$2,100,000","price_per_sqft":"$210","cap_rate":"5.5%","source_url":"https://example.com"}
{"ts":"2099-01-02T00:00:00.000Z","dedupe_key":"qa-seed-2","property_type":"Industrial","market":"Ontario, CA","address":"200 Test Ave, Ontario, CA","transaction":"Lease","deal_date":"2026-06-15","size_sqft":"8000","price_or_rate":"$14/SF/yr","price_per_sqft":"$14","cap_rate":"","source_url":"https://example.com"}
EOF
# restart server, sign in (reuse $CJ), then:
curl -s -b $CJ -X POST localhost:3000/api/watchlist -H "content-type: application/json" \
  -d '{"market":"Ontario, CA","property_type":"Industrial"}'
# Expected: {"id":"<uuid>"}
curl -s -b $CJ localhost:3000/api/watchlist/feed
# Expected: {"unseen":2,"items":[{"market":"Ontario, CA","new_count":2,"median_psf":210,...}]}
#   NOTE: median_psf is 210 (the lease row's $14 is excluded), but the lease appears in comps.
#   (2099 timestamps make the seeds "new" and inside the 6-month window relative to last_seen.)
curl -s -b $CJ -X POST localhost:3000/api/watchlist/seen
# Expected: {"ok":true}
# NOTE: the seeds' ts is 2099 (deliberately future so they land in the 6-month window),
# which also means they stay "unseen" even after /seen — that's expected for this seed
# data. Verify /seen worked via the watchlist row instead:
curl -s -b $CJ localhost:3000/api/watchlist
# Expected: the item's last_seen_at is ~now (it advanced from its created_at value).
curl -s -b $CJ -X POST localhost:3000/api/watchlist -H "content-type: application/json" -d '{"market":"nope","property_type":"Industrial"}'
# Expected: 400 {"error":"Market must look like \"City, ST\"."}
# Cleanup: remove the two qa-seed lines from comp-corpus.jsonl when done.
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add watchlist routes and corpus-backed updates feed"
```

---

### Task 6: Front-end — auth UI (header, modal, session bootstrap, reset flow)

**Files:**
- Modify: `index.html` — header nav (~line 580), new modal after `#leadModal`'s closing `</div>` (~line 471), new JS near the saved-reports section (~line 2729).

- [ ] **Step 1: Extend the header nav**

Replace the `<nav>...</nav>` block (lines ~580–584) with:

```html
      <nav class="flex items-center gap-6 text-[13.5px] text-[#5A6473]">
        <a href="/markets" class="hover:text-[#1A2433]">Markets</a>
        <button type="button" data-scroll-to="for-brokers" class="hover:text-[#1A2433]">For Brokers</button>
        <button type="button" data-scroll-to="method" class="hover:text-[#1A2433] hidden sm:inline">Methodology</button>
        <button id="bellBtn" type="button" class="hidden relative hover:text-[#1A2433]" title="Watchlist updates" aria-label="Watchlist updates">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          <span id="bellBadge" class="hidden absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#B91C1C] text-white text-[10px] font-semibold leading-4 text-center"></span>
        </button>
        <button id="myDeskLink" type="button" class="hidden hover:text-[#1A2433] font-medium">My Desk</button>
        <button id="signInLink" type="button" class="hover:text-[#1A2433]">Sign in</button>
        <div id="acctMenuWrap" class="hidden relative">
          <button id="acctMenuBtn" type="button" aria-label="Account menu"
            class="w-7 h-7 rounded-full bg-[#1A2433] text-white text-[11px] font-semibold leading-7 text-center"></button>
          <div id="acctMenu" class="hidden absolute right-0 top-9 z-[1100] bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-44 text-left">
            <div id="acctMenuEmail" class="px-3 py-1.5 text-xs text-slate-400 truncate"></div>
            <button id="signOutBtn" type="button" class="block w-full text-left px-3 py-1.5 hover:bg-slate-50">Sign out</button>
            <button id="deleteAcctBtn" type="button" class="block w-full text-left px-3 py-1.5 text-red-700 hover:bg-red-50">Delete account…</button>
          </div>
        </div>
      </nav>
```

- [ ] **Step 2: Add the account modal**

Insert directly after `#leadModal`'s closing `</div>` (the one closing the `fixed inset-0` wrapper — verify with the surrounding indentation):

```html
  <!-- Account: one modal, four modes (signin / signup / forgot / reset) -->
  <div id="acctModal" class="hidden fixed inset-0 z-[1200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 no-print">
    <div class="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6">
      <h2 id="acctTitle" class="text-lg font-semibold text-slate-900">Sign in</h2>
      <p id="acctNudge" class="hidden text-sm text-slate-500 mt-1"></p>
      <div id="acctTabs" class="flex gap-4 mt-3 mb-4 text-sm border-b border-slate-200">
        <button id="acctTabIn" type="button" class="pb-2 border-b-2 border-brand-600 font-medium text-slate-900">Sign in</button>
        <button id="acctTabUp" type="button" class="pb-2 border-b-2 border-transparent text-slate-500 hover:text-slate-800">Create account</button>
      </div>
      <form id="acctForm" class="space-y-3">
        <input id="acctName" type="text" autocomplete="name" placeholder="Name (optional)" aria-label="Name"
          class="hidden w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-brand-600 focus:border-brand-600 outline-none" />
        <input id="acctEmail" type="email" autocomplete="email" placeholder="Email" aria-label="Email"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-brand-600 focus:border-brand-600 outline-none" />
        <input id="acctPassword" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-brand-600 focus:border-brand-600 outline-none" />
        <p id="acctError" class="hidden text-sm text-red-600"></p>
        <p id="acctInfo" class="hidden text-sm text-slate-600"></p>
        <button id="acctSubmit" type="submit"
          class="btn-live w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-60">Sign in</button>
        <div class="flex items-center justify-between text-sm">
          <button id="acctForgotLink" type="button" class="text-slate-500 hover:text-slate-700">Forgot password?</button>
          <button id="acctCancel" type="button" class="text-slate-500 hover:text-slate-700">Not now</button>
        </div>
      </form>
      <div id="acctImport" class="hidden">
        <p class="text-sm text-slate-600 mt-1">You're in. <span id="acctImportCount"></span> saved report(s) live only in this browser — import them into your portfolio?</p>
        <div class="flex gap-2 mt-3">
          <button id="acctImportYes" type="button" class="btn-live flex-1 bg-brand-600 hover:bg-brand-700 text-white font-semibold px-4 py-2 rounded-lg">Import</button>
          <button id="acctImportNo" type="button" class="flex-1 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg">Skip</button>
        </div>
      </div>
      <p class="text-xs text-slate-400 mt-3">Free account. Your portfolio and watchlist sync across devices. No spam.</p>
    </div>
  </div>
```

- [ ] **Step 3: Add the account JS**

Insert this block in the main `<script>`, just BEFORE the `// Saved reports` comment block (~line 2729):

```js
  // ----------------------------------------------------------------------------
  // Account state — cookie-backed session; the browser sends cn_session
  // automatically on same-origin fetches.
  // ----------------------------------------------------------------------------
  let currentUser = null;           // { email, name } | null
  let pendingPortfolioSave = false; // "Save to portfolio" clicked while signed out
  let acctMode = "signin";          // signin | signup | forgot | reset
  let resetToken = "";

  async function acctApi(method, url, bodyObj) {
    const r = await fetch(url, {
      method,
      headers: bodyObj ? { "content-type": "application/json" } : undefined,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status}).`);
    return data;
  }

  function refreshAccountUI() {
    const on = Boolean(currentUser);
    document.getElementById("signInLink").classList.toggle("hidden", on);
    document.getElementById("acctMenuWrap").classList.toggle("hidden", !on);
    document.getElementById("myDeskLink").classList.toggle("hidden", !on);
    document.getElementById("bellBtn").classList.toggle("hidden", !on);
    if (on) {
      const label = (currentUser.name || currentUser.email).trim();
      document.getElementById("acctMenuBtn").textContent = label.slice(0, 1).toUpperCase();
      document.getElementById("acctMenuEmail").textContent = currentUser.email;
    }
    const pb = document.getElementById("portfolioBtn");
    if (pb) pb.classList.remove("hidden");
    if (typeof renderMyDesk === "function") renderMyDesk();
  }

  function setAcctMode(mode) {
    acctMode = mode;
    const t = { signin: "Sign in", signup: "Create your account", forgot: "Reset your password", reset: "Choose a new password" }[mode];
    document.getElementById("acctTitle").textContent = t;
    document.getElementById("acctSubmit").textContent =
      { signin: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Set new password" }[mode];
    document.getElementById("acctName").classList.toggle("hidden", mode !== "signup");
    document.getElementById("acctEmail").classList.toggle("hidden", mode === "reset");
    document.getElementById("acctPassword").classList.toggle("hidden", mode === "forgot");
    document.getElementById("acctPassword").placeholder = mode === "reset" ? "New password (8+ characters)" : "Password";
    document.getElementById("acctPassword").autocomplete = mode === "signin" ? "current-password" : "new-password";
    document.getElementById("acctTabs").classList.toggle("hidden", mode === "reset");
    document.getElementById("acctForgotLink").classList.toggle("hidden", mode !== "signin");
    document.getElementById("acctTabIn").className = "pb-2 border-b-2 " +
      (mode === "signin" ? "border-brand-600 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800");
    document.getElementById("acctTabUp").className = "pb-2 border-b-2 " +
      (mode === "signup" ? "border-brand-600 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800");
    document.getElementById("acctError").classList.add("hidden");
    document.getElementById("acctInfo").classList.add("hidden");
  }

  function openAcctModal(mode, nudge) {
    setAcctMode(mode || "signin");
    const n = document.getElementById("acctNudge");
    n.textContent = nudge || "";
    n.classList.toggle("hidden", !nudge);
    document.getElementById("acctImport").classList.add("hidden");
    document.getElementById("acctForm").classList.remove("hidden");
    document.getElementById("acctModal").classList.remove("hidden");
    document.getElementById(acctMode === "reset" ? "acctPassword" : "acctEmail").focus();
  }
  function closeAcctModal() { document.getElementById("acctModal").classList.add("hidden"); }

  document.getElementById("signInLink").addEventListener("click", () => openAcctModal("signin"));
  document.getElementById("acctTabIn").addEventListener("click", () => setAcctMode("signin"));
  document.getElementById("acctTabUp").addEventListener("click", () => setAcctMode("signup"));
  document.getElementById("acctForgotLink").addEventListener("click", () => setAcctMode("forgot"));
  document.getElementById("acctCancel").addEventListener("click", closeAcctModal);
  document.getElementById("acctMenuBtn").addEventListener("click", () =>
    document.getElementById("acctMenu").classList.toggle("hidden"));
  document.addEventListener("click", (e) => {
    if (!document.getElementById("acctMenuWrap").contains(e.target)) {
      document.getElementById("acctMenu").classList.add("hidden");
    }
  });

  document.getElementById("acctForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("acctError");
    const info = document.getElementById("acctInfo");
    err.classList.add("hidden"); info.classList.add("hidden");
    const email = document.getElementById("acctEmail").value.trim();
    const password = document.getElementById("acctPassword").value;
    const btn = document.getElementById("acctSubmit");
    btn.disabled = true;
    try {
      if (acctMode === "forgot") {
        await acctApi("POST", "/api/account/forgot", { email });
        info.textContent = "If an account exists for that email, a reset link is on its way (check spam too).";
        info.classList.remove("hidden");
        return;
      }
      if (acctMode === "reset") {
        await acctApi("POST", "/api/account/reset", { token: resetToken, password });
        resetToken = "";
        history.replaceState(null, "", location.pathname + location.search);
        setAcctMode("signin");
        info.textContent = "Password updated — sign in with it below.";
        info.classList.remove("hidden");
        return;
      }
      const isUp = acctMode === "signup";
      currentUser = await acctApi("POST", `/api/account/${isUp ? "signup" : "login"}`, {
        email, password, name: document.getElementById("acctName").value.trim(),
      });
      refreshAccountUI();
      const saved = loadSavedReports();
      if (isUp && saved.length) {
        document.getElementById("acctImportCount").textContent = String(saved.length);
        document.getElementById("acctForm").classList.add("hidden");
        document.getElementById("acctImport").classList.remove("hidden");
      } else {
        closeAcctModal();
      }
      if (pendingPortfolioSave) { pendingPortfolioSave = false; savePortfolioCurrent(); }
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("signOutBtn").addEventListener("click", async () => {
    try { await acctApi("POST", "/api/account/logout"); } catch (_) {}
    currentUser = null;
    document.getElementById("acctMenu").classList.add("hidden");
    refreshAccountUI();
  });
  document.getElementById("deleteAcctBtn").addEventListener("click", async () => {
    if (!confirm("Delete your CompNinja account, portfolio, and watchlist? This can't be undone.")) return;
    try { await acctApi("DELETE", "/api/account"); } catch (_) {}
    currentUser = null;
    document.getElementById("acctMenu").classList.add("hidden");
    refreshAccountUI();
  });

  // Bootstrap: who am I? Then honor a /#reset=<token> link.
  (async () => {
    try { currentUser = await acctApi("GET", "/api/account/me"); } catch (_) { currentUser = null; }
    refreshAccountUI();
    const m = location.hash.match(/^#reset=([A-Za-z0-9_-]{20,})$/);
    if (m) { resetToken = m[1]; openAcctModal("reset"); }
  })();
```

Note: `savePortfolioCurrent` and `renderMyDesk` arrive in Tasks 7–8; the `typeof` guard and the call order (script bottom) keep this task standalone — but to keep the page error-free NOW, add this temporary stub directly above the block, and REMOVE it in Task 7:

```js
  function savePortfolioCurrent() {} // replaced in the portfolio task
```

- [ ] **Step 4: Verify in the browser**

Refresh localhost:3000 (no server restart needed). Check: "Sign in" appears in the header; the modal opens with working tabs; creating an account (fresh email) flips the header to the initials menu + My Desk + bell (bell/My Desk do nothing yet); sign out flips it back; sign in works; wrong password shows the inline error; Forgot password shows the confirmation line; the console shows no JS errors.

- [ ] **Step 5: Commit** (include `tailwind.css` if the auto-regen hook changed it)

```bash
git add index.html tailwind.css
git commit -m "Add account UI: header states, sign-in/signup/forgot/reset modal, session bootstrap"
```

---

### Task 7: Front-end — Save to portfolio + import + valuation snapshot capture

**Files:**
- Modify: `index.html` — toolbar (~line 779), `renderOwnerHero` (~line 1724 and ~1814), `saveReport` (~line 2739), account JS from Task 6.

- [ ] **Step 1: Add the toolbar button**

Insert after the `#shareBtn` closing `</button>` (before `#imgBtn`):

```html
        <button id="portfolioBtn"
          class="btn-live inline-flex items-center gap-1.5 text-sm font-medium text-[#5A6473] bg-white hover:text-[#1A2433] border border-[#D8D4C9] rounded px-3 py-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
          <span id="portfolioBtnLabel">Save to portfolio</span>
        </button>
```

- [ ] **Step 2: Capture the hero valuation for snapshots**

(a) Find the module-scope declaration of `currentComps` (grep `let currentComps`) and add beside it:

```js
  let lastValuation = null;          // {low, likely, high, median_psf} from the last hero render
  let pendingPortfolioRefresh = null; // portfolio item id awaiting a fresh billed report
```

(b) In `renderOwnerHero` (line ~1724), add `lastValuation = null;` as the FIRST line of the function body (before the `card` lookup), so hidden/insufficient-data renders clear it.

(c) Inside the `if (sizeR && ppsfs.length >= 2) {` branch, immediately after the three `animateValue(...)` calls (~line 1814), add:

```js
      lastValuation = {
        low: Math.round(rr.low * sizeR.min),
        likely: Math.round(rr.mid * midSize),
        high: Math.round(rr.high * sizeR.max),
        median_psf: Math.round(rr.mid * 100) / 100,
      };
```

- [ ] **Step 3: Replace the Task-6 stub with the real save + import + refresh hook**

Delete the `function savePortfolioCurrent() {}` stub and add (same location):

```js
  // Save the on-screen report into the server-side portfolio. currentMeta /
  // currentParsed are the same objects the local savedReports flow uses.
  async function savePortfolioCurrent() {
    if (!currentParsed || !currentMeta) return;
    if (!currentUser) {
      pendingPortfolioSave = true;
      openAcctModal("signup", "Create a free account to keep this report in your portfolio on any device.");
      return;
    }
    const label = document.getElementById("portfolioBtnLabel");
    label.textContent = "Saving…";
    try {
      const meta = {
        address: currentMeta.address, type: currentMeta.type, note: currentMeta.note || "",
        months: currentMeta.months, txFocus: currentMeta.txFocus, subject: currentMeta.subject || null,
      };
      await acctApi("POST", "/api/portfolio", {
        payload: { meta, data: currentParsed },
        snapshot: lastValuation,
      });
      label.textContent = "Saved ✓";
      renderMyDesk();
      setTimeout(() => { label.textContent = "Save to portfolio"; }, 2500);
    } catch (ex) {
      label.textContent = "Save to portfolio";
      showStatus(ex.message, "error");
    }
  }
  document.getElementById("portfolioBtn").addEventListener("click", savePortfolioCurrent);

  document.getElementById("acctImportYes").addEventListener("click", async () => {
    const btn = document.getElementById("acctImportYes");
    btn.disabled = true; btn.textContent = "Importing…";
    for (const r of loadSavedReports()) {
      try {
        await acctApi("POST", "/api/portfolio", { payload: { meta: r.meta, data: r.data }, snapshot: null });
      } catch (_) { /* duplicates/failures — keep going */ }
    }
    btn.disabled = false; btn.textContent = "Import";
    closeAcctModal();
    renderMyDesk();
  });
  document.getElementById("acctImportNo").addEventListener("click", closeAcctModal);
```

- [ ] **Step 4: Hook fresh billed reports into a pending portfolio refresh**

In `saveReport(meta, data)` (~line 2739), add immediately before the final `renderSavedChips();` line:

```js
    // A pending "Refresh valuation" also updates the portfolio item. Deferred a
    // tick so renderOwnerHero (called during the same render pass) has already
    // computed lastValuation.
    if (currentUser && pendingPortfolioRefresh) {
      const refreshId = pendingPortfolioRefresh;
      pendingPortfolioRefresh = null;
      setTimeout(() => {
        acctApi("POST", "/api/portfolio", {
          id: refreshId, payload: { meta, data }, snapshot: lastValuation,
        }).then(() => renderMyDesk()).catch(() => {});
      }, 0);
    }
```

- [ ] **Step 5: Verify in the browser**

Signed out: run the sample report (or a real search), click "Save to portfolio" → the account modal opens with the nudge; create an account → the save completes automatically ("Saved ✓"). Confirm with `curl -s -b $CJ localhost:3000/api/portfolio` (log in with that account via curl first) that the item exists and, when the hero was visible, its snapshot has low/likely/high. Sign up in a browser profile that has saved reports → the import prompt appears and importing creates the items.

- [ ] **Step 6: Commit**

```bash
git add index.html tailwind.css
git commit -m "Add Save-to-portfolio flow, saved-report import, and valuation snapshot capture"
```

---

### Task 8: Front-end — My Desk portfolio grid

**Files:**
- Modify: `index.html` — new section after the `#savedWrap` element's closing `</div>` (~line 706), new JS after the Task 7 block.

- [ ] **Step 1: Add the My Desk section markup**

```html
    <!-- My Desk — the signed-in home: portfolio, watchlist, updates feed -->
    <section id="myDesk" class="hidden mt-10 no-print">
      <div class="flex items-center justify-between border-b rd-hairline pb-2">
        <h2 class="font-brand uppercase tracking-wide text-base font-semibold text-slate-800">My Desk</h2>
        <span id="deskHello" class="text-[13.5px] text-[#5A6473]"></span>
      </div>
      <div class="mt-4">
        <div class="flex items-center gap-2">
          <span class="rd-lab">Portfolio</span>
          <span id="deskCount" class="text-xs text-[#8A93A0]"></span>
        </div>
        <p id="deskEmpty" class="hidden text-sm text-[#5A6473] mt-2">Run a report and press "Save to portfolio" to start tracking a property here.</p>
        <div id="portfolioGrid" class="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"></div>
      </div>
      <div id="deskWatch" class="mt-8"><!-- watchlist + feed land here in the next task --></div>
    </section>
```

- [ ] **Step 2: Add the My Desk JS** (after the Task 7 block)

```js
  // ----------------------------------------------------------------------------
  // My Desk — portfolio grid. Fetches summaries; opening a card pulls the full
  // payload and re-renders the report locally (free). "Refresh" re-runs the
  // live search through the normal form path (billed, cached, capped).
  // ----------------------------------------------------------------------------
  const fmtDeskUsd = (v) => "$" + Math.round(v).toLocaleString();

  async function openPortfolioItem(id) {
    try {
      const item = await acctApi("GET", "/api/portfolio?id=" + encodeURIComponent(id));
      hideLoadingCard();
      showStatus(`Reopened from your portfolio (saved ${new Date(item.updated_at).toLocaleDateString()}). Refresh valuation for fresh data.`, "info");
      renderResults(item.payload.data, { ...item.payload.meta, fromHistory: true, generatedAt: Date.parse(item.updated_at) });
    } catch (ex) { showStatus(ex.message, "error"); }
  }

  function refreshPortfolioItem(item) {
    // Replay the stored inputs through the real form so every rule (validation,
    // cache, caps, type-specific columns) applies, then Task 7's saveReport
    // hook writes the result + snapshot back onto this portfolio item.
    const meta = item.payload.meta;
    document.getElementById("address").value = meta.address || "";
    const typeSel = document.getElementById("propertyType");
    if ([...typeSel.options].some((o) => o.value === meta.type)) typeSel.value = meta.type;
    if (meta.subject && meta.subject.sizeMin) document.getElementById("targetSize").value = meta.subject.sizeMin;
    pendingPortfolioRefresh = item.id;
    document.getElementById("compForm").requestSubmit();
  }

  async function renderMyDesk() {
    const desk = document.getElementById("myDesk");
    if (!currentUser) { desk.classList.add("hidden"); return; }
    desk.classList.remove("hidden");
    document.getElementById("deskHello").textContent = currentUser.name ? `Signed in as ${currentUser.name}` : currentUser.email;
    let items = [];
    try { items = (await acctApi("GET", "/api/portfolio")).items || []; } catch (_) {}
    document.getElementById("deskCount").textContent = items.length ? `${items.length} propert${items.length === 1 ? "y" : "ies"}` : "";
    document.getElementById("deskEmpty").classList.toggle("hidden", items.length > 0);
    const grid = document.getElementById("portfolioGrid");
    grid.innerHTML = "";
    items.forEach((item) => {
      const snaps = Array.isArray(item.snapshots) ? item.snapshots : [];
      const last = snaps[snaps.length - 1] || null;
      const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
      const card = document.createElement("div");
      card.className = "border border-[#D8D4C9] rounded-lg bg-white p-3 flex flex-col gap-1";
      const addr = document.createElement("button");
      addr.type = "button";
      addr.className = "text-left text-sm font-medium text-[#1A2433] hover:text-[#B91C1C] truncate";
      addr.textContent = item.address;
      addr.title = "Open this report (no new search, no cost)";
      addr.addEventListener("click", () => openPortfolioItem(item.id));
      card.appendChild(addr);
      const sub = document.createElement("div");
      sub.className = "text-xs text-[#8A93A0]";
      sub.textContent = `${item.property_type} · updated ${new Date(item.updated_at).toLocaleDateString()}`;
      card.appendChild(sub);
      const val = document.createElement("div");
      val.className = "text-lg font-semibold text-[#1A2433]";
      val.textContent = last && last.likely ? fmtDeskUsd(last.likely) : "—";
      card.appendChild(val);
      if (last && prev && last.likely && prev.likely) {
        const pct = ((last.likely - prev.likely) / prev.likely) * 100;
        const d = document.createElement("div");
        d.className = "text-xs font-medium " + (pct >= 0 ? "text-emerald-700" : "text-red-700");
        d.textContent = `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% since ${new Date(prev.ts).toLocaleDateString()}`;
        card.appendChild(d);
      }
      const row = document.createElement("div");
      row.className = "flex items-center gap-3 mt-1 text-xs";
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "text-[#5A6473] hover:text-[#1A2433] underline";
      refresh.textContent = "Refresh valuation";
      refresh.title = "Runs a new live search for this property";
      refresh.addEventListener("click", async () => {
        const full = await acctApi("GET", "/api/portfolio?id=" + encodeURIComponent(item.id)).catch(() => null);
        if (full) refreshPortfolioItem(full);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "text-[#8A93A0] hover:text-red-700";
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        if (!confirm(`Remove ${item.address} from your portfolio?`)) return;
        try { await acctApi("DELETE", "/api/portfolio?id=" + encodeURIComponent(item.id)); } catch (_) {}
        renderMyDesk();
      });
      row.appendChild(refresh); row.appendChild(del);
      card.appendChild(row);
      grid.appendChild(card);
    });
  }

  document.getElementById("myDeskLink").addEventListener("click", () => {
    renderMyDesk();
    smoothScrollTo(document.getElementById("myDesk"));
  });
```

(`smoothScrollTo` already exists — it's used at line ~2915. `renderMyDesk` is a function declaration, so the Task 6 `typeof renderMyDesk === "function"` bootstrap call finds it via hoisting regardless of file order — but keep this block BELOW the Task 6 block anyway, matching reading order.)

- [ ] **Step 3: Verify in the browser**

Signed in with a saved item: My Desk appears below the search area with the property card (address, type, likely value). Card click re-renders the report with correct columns and badges, and the network tab shows NO `/api/comps` call. "Refresh valuation" fills the form, fires a real search (watch for the cache-hit path if repeated), and afterward the card shows two snapshots' delta. Remove works. Signed out: the section hides.

- [ ] **Step 4: Commit**

```bash
git add index.html tailwind.css
git commit -m "Add My Desk portfolio grid: open, refresh with snapshot delta, remove"
```

---

### Task 9: Front-end — watchlist manager, updates feed, bell

**Files:**
- Modify: `index.html` — fill `#deskWatch` (Task 8 markup), add JS after the Task 8 block, wire `#bellBtn`.

- [ ] **Step 1: Replace the `#deskWatch` placeholder div with**

```html
      <div id="deskWatch" class="mt-8">
        <span class="rd-lab">Watchlist</span>
        <form id="watchForm" class="mt-2 flex flex-wrap items-center gap-2">
          <input id="watchCity" type="text" placeholder="City" aria-label="City"
            class="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-600 focus:border-brand-600 outline-none" />
          <input id="watchState" type="text" placeholder="ST" maxlength="2" aria-label="State (two letters)"
            class="w-14 rounded-lg border border-slate-300 px-3 py-1.5 text-sm uppercase focus:ring-2 focus:ring-brand-600 focus:border-brand-600 outline-none" />
          <select id="watchType" aria-label="Property type"
            class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-brand-600 focus:border-brand-600 outline-none"></select>
          <button type="submit"
            class="btn-live text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5">Watch market</button>
          <span id="watchError" class="hidden text-sm text-red-600"></span>
        </form>
        <div id="feedWrap" class="mt-3 space-y-4"></div>
      </div>
```

- [ ] **Step 2: Add the watchlist/feed JS** (after the Task 8 block)

```js
  // ----------------------------------------------------------------------------
  // Watchlist + updates feed. The bell badge shows unseen comp count; opening
  // My Desk marks everything seen.
  // ----------------------------------------------------------------------------
  (function initWatchTypeOptions() {
    const src = document.getElementById("propertyType");
    const dst = document.getElementById("watchType");
    [...src.options].forEach((o) => { if (o.value) dst.appendChild(new Option(o.textContent, o.value)); });
  })();

  function setBell(unseen) {
    const badge = document.getElementById("bellBadge");
    badge.textContent = unseen > 99 ? "99+" : String(unseen);
    badge.classList.toggle("hidden", !unseen);
  }

  async function renderWatchFeed({ markSeen } = {}) {
    if (!currentUser) return;
    let feed = null;
    try { feed = await acctApi("GET", "/api/watchlist/feed"); } catch (_) { return; }
    setBell(feed.unseen);
    const wrap = document.getElementById("feedWrap");
    wrap.innerHTML = "";
    if (!feed.items.length) {
      const p = document.createElement("p");
      p.className = "text-sm text-[#5A6473]";
      p.textContent = "Watch a market above and new comps will show up here as they're found.";
      wrap.appendChild(p);
    }
    feed.items.forEach((w) => {
      const box = document.createElement("div");
      box.className = "border border-[#D8D4C9] rounded-lg bg-white p-3";
      const head = document.createElement("div");
      head.className = "flex items-center justify-between gap-2";
      const title = document.createElement("div");
      title.className = "text-sm font-medium text-[#1A2433]";
      title.textContent = `${w.property_type} · ${w.market}`;
      const right = document.createElement("div");
      right.className = "flex items-center gap-3 text-xs text-[#8A93A0]";
      if (w.median_psf) {
        const m = document.createElement("span");
        m.textContent = `median $${w.median_psf}/SF (6 mo)`;
        right.appendChild(m);
      }
      const un = document.createElement("button");
      un.type = "button";
      un.className = "hover:text-red-700";
      un.textContent = "Unwatch";
      un.addEventListener("click", async () => {
        try { await acctApi("DELETE", "/api/watchlist?id=" + encodeURIComponent(w.id)); } catch (_) {}
        renderWatchFeed();
      });
      right.appendChild(un);
      head.appendChild(title); head.appendChild(right);
      box.appendChild(head);
      if (w.comps.length) {
        const label = document.createElement("div");
        label.className = "text-xs font-medium text-[#B91C1C] mt-2";
        label.textContent = `${w.new_count} new comp${w.new_count === 1 ? "" : "s"} since your last visit`;
        box.appendChild(label);
        const ul = document.createElement("ul");
        ul.className = "mt-1 space-y-1";
        w.comps.forEach((c) => {
          const li = document.createElement("li");
          li.className = "text-xs text-[#4C5665] flex flex-wrap gap-x-2";
          const bits = [c.address, c.transaction, c.deal_date, c.price_or_rate,
            c.price_per_sqft ? c.price_per_sqft + "/SF" : "", c.cap_rate].filter(Boolean);
          li.textContent = bits.join(" · ");
          ul.appendChild(li);
        });
        box.appendChild(ul);
      } else {
        const q = document.createElement("div");
        q.className = "text-xs text-[#8A93A0] mt-2";
        q.textContent = "Quiet since your last visit.";
        box.appendChild(q);
      }
      wrap.appendChild(box);
    });
    if (markSeen && feed.unseen) {
      try { await acctApi("POST", "/api/watchlist/seen"); } catch (_) {}
      setBell(0);
    }
  }

  document.getElementById("watchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("watchError");
    errEl.classList.add("hidden");
    const city = document.getElementById("watchCity").value.trim();
    const st = document.getElementById("watchState").value.trim().toUpperCase();
    try {
      await acctApi("POST", "/api/watchlist", {
        market: `${city}, ${st}`,
        property_type: document.getElementById("watchType").value,
      });
      document.getElementById("watchCity").value = "";
      document.getElementById("watchState").value = "";
      renderWatchFeed();
    } catch (ex) {
      errEl.textContent = ex.message;
      errEl.classList.remove("hidden");
    }
  });

  document.getElementById("bellBtn").addEventListener("click", () => {
    renderMyDesk();
    renderWatchFeed({ markSeen: true });
    smoothScrollTo(document.getElementById("myDesk"));
  });
```

- [ ] **Step 3: Wire the feed into existing entry points**

The rule: rendering never marks seen by itself — only the two explicit user actions (clicking My Desk or the bell) do. Otherwise the page-load render (via `refreshAccountUI` → `renderMyDesk`) would silently clear the badge.

(a) In Task 8's `renderMyDesk`, add `renderWatchFeed();` (NO markSeen) as the LAST line of the function — every desk render also refreshes the feed and badge.
(b) The `#bellBtn` handler in Step 2 above already calls `renderWatchFeed({ markSeen: true })`. Update the Task 8 `myDeskLink` handler to match it:

```js
  document.getElementById("myDeskLink").addEventListener("click", () => {
    renderMyDesk();
    renderWatchFeed({ markSeen: true });
    smoothScrollTo(document.getElementById("myDesk"));
  });
```

- [ ] **Step 4: Verify in the browser**

Signed in: watch "Ontario, CA · Industrial" (with the QA corpus seeds from Task 5 still present, or run a real Ontario search first). The feed box lists the comps, the bell badges with the count on a fresh page load, and clicking the bell (or My Desk) scrolls down and clears the badge; a reload keeps it cleared (last_seen advanced). Unwatch removes the box. Bad state input ("Ontario" / "California") shows the inline error.

- [ ] **Step 5: Commit**

```bash
git add index.html tailwind.css
git commit -m "Add watchlist manager, corpus updates feed, and header bell"
```

---

### Task 10: Hygiene, full QA pass, DDL + deploy

**Files:**
- Modify: `.gitignore`
- Owner action: Supabase SQL editor

- [ ] **Step 1: Git-ignore the fallback store**

Add to `.gitignore` (alongside the other PII files):

```
account-store.json
```

Commit: `git add .gitignore && git commit -m "Ignore account-store.json (local account fallback, PII)"`

- [ ] **Step 2: Clean QA seeds**

Remove the two `qa-seed-*` lines from `comp-corpus.jsonl` (dev machine only, file is git-ignored). Delete `/tmp/cn-cookies`.

- [ ] **Step 3: Run the spec's full manual QA checklist**

Work through all 8 items in the spec's "Verification plan" section end-to-end on localhost, including item 8 (a signed-out visitor sees zero behavior change on search/share/BOV/exports). Fix anything that fails before proceeding.

- [ ] **Step 4: Create the production tables**

Run the DDL from the Task 1 comment block (all five `create table` statements) in the Supabase SQL editor. Verify each table exists under Table Editor.

- [ ] **Step 5: Deploy and smoke-test**

```bash
git push origin main   # Render auto-deploys from main
```

Then on https://compninja.co: sign up with a real mailbox, save the sample report to the portfolio, watch a market, sign out/in, and run the forgot-password flow end-to-end (EMAIL_FROM is live, so the reset email should arrive). Check `/admin` shows the new event kinds coming in.

- [ ] **Step 6: Sync the primary checkout** (if work happened in a worktree)

`git pull --ff-only` in the primary checkout per the deploy-flow memory.

---

## Self-Review Notes (already applied)

- **Spec coverage:** users/sessions/portfolio/watchlist/password_resets tables → Task 1; all 16 routes → Tasks 2–5; header/modal/import → Tasks 6–7; My Desk grid + refresh + snapshots → Tasks 7–8; watchlist/feed/bell + sales-only median → Tasks 5, 9; analytics kinds → inline in Tasks 2, 4, 5; gitignore + DDL + rollout → Task 10. Deliberate v1 exclusions honored (no caps, no watchlist email, no changes to logged-out flows).
- **Type consistency:** `acctApi(method, url, body)`, `renderMyDesk()`, `renderWatchFeed({markSeen})`, `pendingPortfolioRefresh` (item id string), snapshot shape `{ts, low, likely, high, median_psf}` — used identically across tasks; portfolio POST body `{id?, payload:{meta,data}, snapshot}` matches server route, client save, import, and refresh hook.
- **Known judgment calls:** feed marks seen only on explicit My Desk/bell clicks (Task 9 Step 3 supersedes the earlier line in Task 8 — the plan text calls this out); session cache is cleared wholesale past 5000 entries (fine at this scale); `refreshPortfolioItem` replays only address/type/size (note/months/txFocus fall back to current form state — acceptable v1 simplification, the fresh meta is what gets stored back).
