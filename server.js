// ---------------------------------------------------------------------------
// Market Comp Puller — backend proxy
//
// Zero dependencies. Requires Node 18+ (for built-in fetch).
//   1. Serves index.html
//   2. POST /api/comps  -> calls the Anthropic API with the key held HERE,
//      server-side, so the browser never sees it.
//
// Set ANTHROPIC_API_KEY as an environment variable (or in a local .env file).
// ---------------------------------------------------------------------------

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Market-snapshot distillation, shared with gen-market-seed.js so on-demand
// Explorer pages are shaped exactly like the curated seed pages.
const { MIN_PRICED_SALE_COMPS, slugify: slugifyMarket, distillMarketSnapshot } = require("./market-snapshot");
// Pro-tier entitlement rules. Pure and dependency-free so `npm test` can
// exercise the whole decision table without a database — see the Pro section
// below for the reads that feed it.
const ENT = require("./entitlements");
// Comp gating — which comps leave the server, and the anonymized basis rows
// that keep a free report's valuation as accurate as a Pro one. Also pure.
const GATE = require("./comp-gate");
// Stripe over plain fetch — signature verification and the Stripe->our-row
// mapping are pure and tested; see stripe.js.
const STRIPE = require("./stripe");

// --- Tiny .env loader (so `npm start` works locally after copying .env.example) ---
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
} catch (_) { /* ignore */ }

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";

// Optional shared password. If set, visitors must enter it before searching.
// Leave it unset to keep the app open.
const APP_PASSWORD = process.env.APP_PASSWORD || "";

// Lead capture — when enabled, the front-end asks for contact info before
// unlocking exports (the lead-magnet flow). Defaults ON for open deployments
// and OFF when the app is password-gated (internal use); LEAD_CAPTURE=on|off
// overrides either way.
const LEAD_CAPTURE = process.env.LEAD_CAPTURE
  ? process.env.LEAD_CAPTURE.toLowerCase() !== "off"
  : !APP_PASSWORD;

// Pro tier master switch. OFF unless PRO_ENABLED=on, and off means the app
// behaves exactly as it did before the tier existed — no comp gating, no
// export cap, no lookback limit (see computeEntitlements' `enabled` branch).
// Everything Pro ships dark behind this until the whole flow is proven.
const PRO_ENABLED = String(process.env.PRO_ENABLED || "").toLowerCase() === "on";
// Optional comma-separated email allowlist narrowing WHO the switch above
// applies to. Unset = everyone (the launch setting). Set = only those
// signed-in accounts are gated and only they can reach checkout, so the paid
// tier can be proven against the live deployment without changing what the
// public sees. See the audience block in entitlements.js for why this exists.
// The webhook is deliberately NOT audience-scoped — it has no user, and it
// must keep writing subscription rows or the test proves nothing.
const PRO_AUDIENCE = ENT.parseAudience(process.env.PRO_AUDIENCE);
// The only place PRO_ENABLED should be read alongside a user. Everything that
// asks "is Pro on for this person" goes through here.
function proEnabledFor(user) {
  return PRO_ENABLED && ENT.inAudience(user, PRO_AUDIENCE);
}

// Stripe. Keys live only in the environment — never in the repo, never in a
// response, never in the browser. The price IDs are not secret (they identify
// a product, they do not authorize anything), but they are configured rather
// than hard-coded so test mode and live mode are one env change apart.
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_PRICES = {
  monthly: (process.env.STRIPE_PRICE_PRO_MONTHLY || "").trim(),
  annualFounding: (process.env.STRIPE_PRICE_PRO_ANNUAL_FOUNDING || "").trim(),
  singleReport: (process.env.STRIPE_PRICE_SINGLE_REPORT || "").trim(),
};
const STRIPE_CONFIGURED = Boolean(STRIPE_SECRET_KEY && STRIPE_PRICES.monthly);
// The founding-member offer closes at 50. See foundingSlotsLeft() for why the
// count is of subscriptions ever created rather than currently active.
const FOUNDING_MEMBER_LIMIT = Number(process.env.FOUNDING_MEMBER_LIMIT || 50);

// Durable lead storage — a Supabase (hosted Postgres) project, written to via
// its REST API with plain fetch, so the app stays dependency-free. When these
// are unset (or an insert fails), leads fall back to the local file below so
// no lead is ever dropped.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
const DB_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

// File fallbacks. NOTE: on hosts with an ephemeral filesystem (Render/Railway
// free tiers) these files are lost on redeploy — configure Supabase for
// anything you care about, or download via the admin endpoints before deploying.
const LEADS_FILE = path.join(__dirname, "leads.jsonl");
const COMP_SUBMISSIONS_FILE = path.join(__dirname, "comp-submissions.jsonl");
const SEARCH_CACHE_FILE = path.join(__dirname, "search-cache.json");
const SHARED_REPORTS_FILE = path.join(__dirname, "shared-reports.json");
const ANALYTICS_FILE = path.join(__dirname, "analytics.jsonl");
const DYNAMIC_MARKETS_FILE = path.join(__dirname, "market-pages-dynamic.json");
const COMP_CORPUS_FILE = path.join(__dirname, "comp-corpus.jsonl");
const DEVLOG_FILE = path.join(__dirname, "devlog.json");
const DEV_IDEAS_FILE = path.join(__dirname, "dev-ideas.json");
const DEVLOG_OVERRIDES_FILE = path.join(__dirname, "devlog-overrides.json");
// Internal contact book (/contacts). Holds PII — git-ignored, never commit.
const CONTACTS_FILE = path.join(__dirname, "contacts.json");

// Curated market landing pages (programmatic SEO). Static data committed to the
// repo — generated by gen-market-seed.js — so the pages survive redeploys and
// serve instantly, no DB needed. Keyed by slug (e.g. "industrial-ontario-ca").
let MARKET_PAGES = {};
try {
  MARKET_PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, "market-seed.json"), "utf8"));
} catch (_) {
  MARKET_PAGES = {}; // no seed file yet — /markets simply lists nothing
}

// Visitor-generated market pages (the Market Explorer). Same payload shape as
// MARKET_PAGES entries; persisted to the Supabase `market_pages` table (file
// fallback when unconfigured) and loaded at startup. Seeded pages win slug
// collisions everywhere.
let DYNAMIC_MARKET_PAGES = {};
function getMarketPage(slug) {
  return MARKET_PAGES[slug] || DYNAMIC_MARKET_PAGES[slug] || null;
}
function allMarketPages() {
  return { ...DYNAMIC_MARKET_PAGES, ...MARKET_PAGES };
}

// Optional key that unlocks GET /api/leads (the lead download). When unset,
// that endpoint is disabled entirely.
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Optional Google Maps key powering the Street View photos in map pin
// popups (served through GET /api/streetview so the key never reaches the
// browser). Unset = the route 404s and popups are text-only, as before.
const GOOGLE_MAPS_API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
// lat,lng -> boolean "imagery exists" from the free metadata endpoint, so
// repeat popup opens never re-ask Google. In-memory, capped, process-lifetime.
const STREETVIEW_META_CACHE = new Map();

// Optional email ping on every new lead / broker comp submission, sent via
// Resend's REST API (free tier, plain fetch — no dependency). Note: without a
// verified domain Resend only delivers to the address that owns the Resend
// account, so sign up with the notify address itself.
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const LEAD_NOTIFY_EMAIL = (process.env.LEAD_NOTIFY_EMAIL || "agouraninja@gmail.com").trim();
// From-address for mail to leads/brokers, e.g. `CompNinja <reports@domain.com>`.
// Leave UNSET until a custom domain is verified in Resend — the free tier only
// delivers to the account owner, so outbound mail silently no-ops without it.
const EMAIL_FROM = (process.env.EMAIL_FROM || "").trim();

// Public URL of this deployment, used in robots.txt/sitemap.xml. index.html's
// canonical/og:url tags are written against DEFAULT_SITE_URL and rewritten to
// SITE_URL at serve time, so moving to a custom domain is a single env change.
const DEFAULT_SITE_URL = "https://market-comp-puller.onrender.com";
const SITE_URL = (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");

// Two people searching the same address within a few days shouldn't both bill
// the Anthropic account for identical work. TTL is deliberately short — comp
// data goes stale — but long enough to absorb the common case of the same
// property being searched more than once in a short window.
const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Backstop against a runaway script or scraper burning the Anthropic budget
// overnight — the per-IP limiter above stops one connection, not a
// determined caller with rotating IPs. Counts only genuinely billed searches
// (cache hits are free and don't count). Override via env for more headroom.
const DAILY_SEARCH_CAP = Number(process.env.DAILY_SEARCH_CAP) > 0 ? Number(process.env.DAILY_SEARCH_CAP) : 150;

// Rough per-search API cost, used ONLY for the /admin spend estimate — nothing
// here reads a real invoice, so treat the tiles as a sanity check, not
// accounting. A market (Explorer) search costs more because it always runs the
// full 8-use web_search budget: the Explorer path never passes a corpus, so it
// can't take the corpus-assisted discount a report search can. Both are
// env-overridable as real Anthropic invoices come in.
// 0.75 is an ESTIMATE for the 12-comp default (measured $0.60 at 8 comps,
// scaled by the 8→10 search-budget rise) — recalibrate from a real invoice.
const COST_REPORT_SEARCH = Number(process.env.COST_REPORT_SEARCH) > 0 ? Number(process.env.COST_REPORT_SEARCH) : 0.75;
const COST_MARKET_SEARCH = Number(process.env.COST_MARKET_SEARCH) > 0 ? Number(process.env.COST_MARKET_SEARCH) : 0.75;
// A corpus-assisted report search drops max_uses 10→3 (see searchBudgetFor), and
// web_search is what costs money, so it lands near 3/10 of a full search.
const CORPUS_HIT_COST_FACTOR = 3 / 10;

// ---------------------------------------------------------------------------
// Lead storage — Supabase REST when configured, local file otherwise
// ---------------------------------------------------------------------------
function supabaseHeaders() {
  // Legacy service_role keys are JWTs and go in BOTH headers. New-style
  // sb_secret_... keys are not JWTs — sending one as an Authorization bearer
  // makes the gateway reject the whole request (401), so it gets apikey only.
  const headers = { "content-type": "application/json", apikey: SUPABASE_SERVICE_KEY };
  if (SUPABASE_SERVICE_KEY.startsWith("eyJ")) {
    headers.authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
  }
  return headers;
}

// Returns "db" or "file" depending on where the row landed. A DB failure
// falls back to the file rather than losing the submission.
async function storeRow(table, file, row) {
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...supabaseHeaders(), prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`Supabase insert failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
      return "db";
    } catch (err) {
      console.error(`${table} DB insert failed — falling back to file:`, err.message);
    }
  }
  await fs.promises.appendFile(file, JSON.stringify(row) + "\n");
  return "file";
}

async function readRowsFromFile(file) {
  let raw;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return raw.split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter(Boolean);
}

// A broken/unreachable DB must not take down the admin downloads — the file
// still holds everything that fell back there.
async function readRows(table, file, cols) {
  const fileRows = await readRowsFromFile(file);
  if (!DB_CONFIGURED) return fileRows;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=${cols.join(",")}&order=ts.asc&limit=10000`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) throw new Error(`Supabase read failed (${r.status}).`);
    const dbRows = await r.json();
    // Include any rows that fell back to the file during a DB outage.
    return [...dbRows, ...fileRows];
  } catch (err) {
    console.error(`${table} DB read failed — returning file rows only:`, err.message);
    return fileRows;
  }
}

// Serves an ADMIN_KEY-gated CSV download of a lead/submission store.
function sendCsvDownload(req, res, table, file, cols, filename) {
  if (!ADMIN_KEY) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("Not found");
  }
  const key = req.headers["x-admin-key"] ||
    new URL(req.url, "http://localhost").searchParams.get("key");
  if (!secretMatches(key, ADMIN_KEY)) {
    return sendJson(res, 401, { error: "Unauthorized." });
  }
  readRows(table, file, cols).then((rows) => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((o) => cols.map((c) => esc(o[c])).join(","));
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=${filename}`,
    });
    res.end([cols.join(","), ...lines].join("\r\n"));
  }).catch((err) => {
    console.error(`Failed to read ${table}:`, err);
    sendJson(res, 500, { error: `Could not read ${table}.` });
  });
}

// Constant-time string comparison (avoids leaking secrets via timing).
function secretMatches(candidate, secret) {
  const a = Buffer.from(String(candidate || ""));
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function passwordMatches(candidate) { return secretMatches(candidate, APP_PASSWORD); }

// ---------------------------------------------------------------------------
// Per-IP rate limit — every search is billed, so cap how fast one connection
// can burn the budget even when it has the password.
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_WINDOW_MAX_MS = 15 * 60 * 1000; // longest window any caller uses — bounds the purge below
const RATE_MAX = 10; // searches per IP per window
const rateHits = new Map();

function clientIp(req) {
  // Hosts like Render sit behind a proxy; the proxy APPENDS the real client to
  // x-forwarded-for, so the last entry is the trustworthy one (earlier entries
  // are client-supplied and spoofable — they'd let a scraper reset the limiter).
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",").pop().trim();
  return req.socket.remoteAddress || "unknown";
}

function rateLimited(ip, max = RATE_MAX, windowMs = RATE_WINDOW_MS) {
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  rateHits.set(ip, hits);
  if (rateHits.size > 1000) {
    for (const [k, v] of rateHits) {
      if (!v.some((t) => now - t < RATE_WINDOW_MAX_MS)) rateHits.delete(k);
    }
  }
  return hits.length > max;
}

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
//   -- (consider: create unique index on users (lower(email));)
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
      // A truncated stored hash (empty final segment) must never verify.
      if (expected.length !== SCRYPT_KEYLEN) return resolve(false);
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
    if (i > 0) {
      // Decode defensively: a third-party cookie with a raw % ("100%off") is
      // legal but throws in decodeURIComponent — keep it verbatim instead.
      const v = p.slice(i + 1).trim();
      try { out[p.slice(0, i).trim()] = decodeURIComponent(v); }
      catch (_) { out[p.slice(0, i).trim()] = v; }
    }
  });
  return out;
}
function setSessionCookie(res, req, token, maxAgeSec) {
  const secure = /^(localhost(:\d+)?$|127\.)/.test(String(req.headers.host || "")) ? "" : "; Secure";
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

// Cache the load PROMISE (not the value) so concurrent cold-start calls share
// one read and one store object instead of racing.
let accountStorePromise = null;
function accountStore() {
  if (!accountStorePromise) {
    accountStorePromise = (async () => {
      let store;
      try { store = JSON.parse(await fs.promises.readFile(ACCOUNT_STORE_FILE, "utf8")); }
      catch (err) {
        if (err.code !== "ENOENT") {
          // Corrupt store: sideline it loudly rather than silently wiping accounts.
          console.error("account-store.json unreadable — sidelining to .corrupt:", err.message);
          try { await fs.promises.rename(ACCOUNT_STORE_FILE, ACCOUNT_STORE_FILE + ".corrupt"); } catch (_) {}
        }
        store = {};
      }
      for (const k of ["users", "sessions", "portfolio", "watchlist"]) {
        if (!Array.isArray(store[k])) store[k] = [];
      }
      return store;
    })();
  }
  return accountStorePromise;
}
// Saves are chained so overlapping writes can't interleave, and go through a
// temp file + rename so a crash mid-write can't corrupt the store.
let accountSaveChain = Promise.resolve();
function saveAccountStore() {
  accountSaveChain = accountSaveChain.then(async () => {
    const store = await accountStore();
    const tmp = ACCOUNT_STORE_FILE + ".tmp";
    await fs.promises.writeFile(tmp, JSON.stringify(store));
    await fs.promises.rename(tmp, ACCOUNT_STORE_FILE);
  }).catch((e) => console.error("account store save failed:", e.message));
  return accountSaveChain;
}

// --- users ---
async function findUserByEmail(email) {
  email = String(email || "").trim().toLowerCase();
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
  email = String(email || "").trim().toLowerCase();
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
  if (sessionCache.size > 5000) sessionCache.clear(); // crude cap; repopulates on demand
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
  if (resetCache.size > 5000) resetCache.clear(); // crude cap; repopulates on demand
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
    // Await the used-flag write and fail closed: a fire-and-forget failure +
    // restart would let a consumed token be replayed.
    try {
      await sbRequest("PATCH", `password_resets?token_hash=eq.${encodeURIComponent(th)}`, { used: true });
    } catch (e) {
      console.error("Reset consume PATCH failed — rejecting token:", e.message);
      return null;
    }
  }
  return row.user_id;
}

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
// Guard route ids before they hit a Postgres uuid cast — a non-UUID id would
// 500 in DB mode while file mode 404s. File-mode ids are crypto.randomUUID(),
// so the same regex matches both modes.
function isUuidish(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "")); }

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

// ---------------------------------------------------------------------------
// Pro tier — subscriptions, single-report purchases, branding, export tallies.
//
// The RULES live in entitlements.js (pure, tested). This section owns the
// READS that feed them, and getEntitlements() is the only sanctioned way to
// ask what a visitor may do. Do not test a plan or a subscription status
// anywhere else — one function is the whole point.
//
// DELIBERATELY NO FILE FALLBACK. Every other store here degrades to a local
// JSON file when Supabase is unconfigured, which is right for leads and
// caches and wrong for money: Render's filesystem is ephemeral, so a
// subscription written to disk vanishes on the next deploy and a paying
// customer silently becomes a free user. Billing reads return "no
// subscription" without a database, and PRO_ENABLED without DB_CONFIGURED
// warns loudly at startup.
//
// DDL (run in the Supabase SQL editor BEFORE deploying with PRO_ENABLED=on):
//
//   alter table users add column if not exists stripe_customer_id text;
//   create unique index if not exists users_stripe_customer_id_idx
//     on users (stripe_customer_id) where stripe_customer_id is not null;
//
//   create table subscriptions (
//     user_id uuid primary key references users(id) on delete cascade,
//     stripe_subscription_id text unique,
//     stripe_customer_id text,
//     plan text not null,                  -- pro_monthly | pro_annual_founding
//     status text not null,                -- active | past_due | grace | cancelled
//     current_period_end timestamptz,
//     cancel_at_period_end boolean not null default false,
//     grace_until timestamptz,             -- set when a payment fails (7 days)
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );
//   -- One subscription per user by primary key: a second checkout by the same
//   -- person must UPDATE, never insert a rival row that could out-rank it.
//
//   create table branding_profiles (
//     user_id uuid primary key references users(id) on delete cascade,
//     logo_url text, firm_name text, preparer_name text,
//     phone text, email text, license_number text, disclaimer text,
//     updated_at timestamptz not null default now()
//   );
//
//   create table report_purchases (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null references users(id) on delete cascade,
//     report_id text not null,
//     stripe_payment_intent_id text unique,
//     comp_snapshot jsonb not null,        -- the comps AS SOLD, frozen
//     purchased_at timestamptz not null default now(),
//     unique (user_id, report_id)
//   );
//   create index on report_purchases (user_id, report_id);
//
//   -- One row per REPORT exported, not one per click. The primary key makes a
//   -- second export of the same report in the same month a no-op, so wanting a
//   -- report as both a CSV and a PDF costs one, not two. The tally is the row
//   -- COUNT for (user_id, period) — there is no counter column to race on.
//   create table export_usage (
//     user_id uuid not null references users(id) on delete cascade,
//     period text not null,                -- 'YYYY-MM', UTC
//     report_key text not null,            -- stable per report; see reportKeyOf()
//     created_at timestamptz not null default now(),
//     primary key (user_id, period, report_key)
//   );
//
//   -- Upgrading an existing (user_id, period, count) table instead:
//   --   drop table if exists export_usage;   -- nothing ever wrote to it
//   -- then create it as above.
//
//   -- Stripe retries webhooks; this is what makes handlers idempotent.
//   create table stripe_events (
//     id text primary key,                 -- Stripe's event id (evt_...)
//     type text,
//     received_at timestamptz not null default now()
//   );
//
// After running it, confirm nothing is missing:
//   select t from unnest(array['subscriptions','branding_profiles',
//     'report_purchases','export_usage','stripe_events']) as t
//   where not exists (select 1 from information_schema.tables
//                     where table_name = t);
// Zero rows means the schema is complete.
// ---------------------------------------------------------------------------

// Subscription reads sit in the hot path of every report, so they are cached
// briefly. The TTL is short because a fresh Stripe webhook must take effect
// quickly — a subscriber who just paid should not wait minutes for access.
const SUB_CACHE_TTL_MS = 60 * 1000;
const subCache = new Map(); // user_id -> { at, sub }

function cacheSub(userId, sub) {
  subCache.set(userId, { at: Date.now(), sub });
  if (subCache.size > 5000) subCache.clear(); // crude cap; repopulates on demand
  return sub;
}
// Called by the Stripe webhook after any subscription write, so the next
// request sees the new state instead of waiting out the TTL.
function invalidateSubCache(userId) {
  if (userId) subCache.delete(userId);
}

async function findSubscription(userId) {
  if (!userId || !DB_CONFIGURED) return null;
  const hit = subCache.get(userId);
  if (hit && Date.now() - hit.at < SUB_CACHE_TTL_MS) return hit.sub;
  try {
    const rows = await sbRequest("GET",
      `subscriptions?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    return cacheSub(userId, (rows && rows[0]) || null);
  } catch (e) {
    // A DB hiccup must not silently downgrade a paying customer, but it must
    // not mint free Pro either. Serve the last known answer if we have one
    // (even expired), otherwise fail closed to the free tier — and say so in
    // the log, because a burst of these means billing reads are broken.
    console.error("Subscription lookup failed (falling back):", e.message);
    return hit ? hit.sub : null;
  }
}

async function findReportPurchase(userId, reportId) {
  if (!userId || !reportId || !DB_CONFIGURED) return null;
  try {
    const rows = await sbRequest("GET",
      `report_purchases?user_id=eq.${encodeURIComponent(userId)}` +
      `&report_id=eq.${encodeURIComponent(reportId)}&limit=1`);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error("Report purchase lookup failed:", e.message);
    return null;
  }
}

// The tally is a row count, so computeEntitlements still receives the
// { period, count } shape it has always taken — the storage changed, the rule
// did not.
async function getExportUsage(userId, period) {
  if (!userId || !DB_CONFIGURED) return null;
  try {
    const rows = await sbRequest("GET",
      `export_usage?user_id=eq.${encodeURIComponent(userId)}` +
      `&period=eq.${encodeURIComponent(period)}&select=report_key`);
    const keys = (rows || []).map((r) => r.report_key);
    // `count` is what computeEntitlements reads; `keys` lets /api/export tell a
    // re-export of an already-counted report from a genuinely new one.
    return { period, count: keys.length, keys };
  } catch (e) {
    // Fail OPEN, unlike every other billing read. The rest of this file fails
    // closed so a DB hiccup can never hand out Pro; here the same hiccup would
    // WITHHOLD a deliverable someone is entitled to. Wrongly allowing an export
    // costs nothing; wrongly blocking one costs a customer their report.
    console.error("Export usage lookup failed (allowing the export):", e.message);
    return null;
  }
}

// Stable identity for "the same report". Address + type + the report's own
// timestamp: re-exporting the report on screen is free, while a fresh search of
// the same building next month is a new report. Hashed so no address is stored
// in a usage table.
function reportKeyOf(raw) {
  return sha256Hex(String(raw || "").trim().toLowerCase().replace(/\s+/g, " ")).slice(0, 32);
}

// Records one report-export. Idempotent by primary key, so the second format of
// the same report is a conflict we deliberately swallow.
async function recordExport(userId, period, reportKey) {
  if (!userId || !DB_CONFIGURED || !reportKey) return false;
  try {
    await sbRequest("POST", "export_usage",
      [{ user_id: userId, period, report_key: reportKey }],
      { prefer: "resolution=ignore-duplicates,return=minimal" });
    return true;
  } catch (e) {
    console.error("Export usage write failed (export still allowed):", e.message);
    return false;
  }
}

async function findBrandingProfile(userId) {
  if (!userId || !DB_CONFIGURED) return null;
  try {
    const rows = await sbRequest("GET",
      `branding_profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    return (rows && rows[0]) || null;
  } catch (e) {
    console.error("Branding profile lookup failed:", e.message);
    return null;
  }
}

/**
 * What may this user do? The single entitlement entry point.
 *
 * @param {object?} user      a row from getSessionUser(), or null (anonymous)
 * @param {string?} reportId  the report in question, for single-report unlocks
 */
async function getEntitlements(user, reportId) {
  // Skip every DB round trip when the tier is switched off — the flag must
  // cost nothing on the hot path while Pro ships dark. A visitor outside
  // PRO_AUDIENCE takes this same path, so during a test window the public
  // costs no more than it did before the tier existed.
  if (!proEnabledFor(user)) return ENT.computeEntitlements({ user, enabled: false });
  const now = Date.now();
  const [subscription, purchase, usage] = await Promise.all([
    findSubscription(user && user.id),
    findReportPurchase(user && user.id, reportId),
    getExportUsage(user && user.id, ENT.usagePeriod(now)),
  ]);
  return ENT.computeEntitlements({
    user, subscription, purchase, usage, reportId, now, enabled: true,
  });
}

// --- Stripe writes -----------------------------------------------------------

// Upsert on user_id: the table's primary key is the user, so a second checkout
// by the same person UPDATES their row instead of creating a rival one that
// could out-rank it.
async function upsertSubscription(row) {
  if (!DB_CONFIGURED || !row || !row.user_id) return false;
  await sbRequest("POST", "subscriptions?on_conflict=user_id", [row],
    { prefer: "resolution=merge-duplicates,return=minimal" });
  invalidateSubCache(row.user_id);
  return true;
}

// Find the user a Stripe customer belongs to. Checkout stamps our user id into
// the session metadata, but subscription.* events arrive with only a customer
// id, so the mapping has to be recoverable from the DB too.
async function userIdForStripeCustomer(customerId) {
  if (!customerId || !DB_CONFIGURED) return null;
  try {
    const subs = await sbRequest("GET",
      `subscriptions?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id&limit=1`);
    if (subs && subs[0]) return subs[0].user_id;
    const users = await sbRequest("GET",
      `users?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`);
    return (users && users[0]) ? users[0].id : null;
  } catch (e) {
    console.error("Stripe customer -> user lookup failed:", e.message);
    return null;
  }
}

async function setUserStripeCustomer(userId, customerId) {
  if (!userId || !customerId || !DB_CONFIGURED) return;
  try {
    await sbRequest("PATCH", `users?id=eq.${encodeURIComponent(userId)}`,
      { stripe_customer_id: customerId }, { prefer: "return=minimal" });
  } catch (e) { console.error("Could not store stripe_customer_id:", e.message); }
}

/**
 * Founding-member seats left.
 *
 * Counts subscriptions EVER created on the founding price, not currently
 * active ones: "the first 50 people" should mean exactly that, and a founder
 * who cancels does not quietly reopen a seat for someone else at a price we
 * stopped offering. Returns null when it cannot be determined — callers treat
 * that as "closed", because overselling a lifetime price is unwindable while
 * a wrongly-closed offer is a support email.
 */
// Memoized answer for GET /api/pricing only — never for the checkout seat
// check, which must always read live. { at, left } | null.
let foundingCountCache = null;

async function foundingSlotsLeft() {
  if (!DB_CONFIGURED) return null;
  try {
    const rows = await sbRequest("GET",
      "subscriptions?plan=eq.pro_annual_founding&select=user_id");
    return Math.max(0, FOUNDING_MEMBER_LIMIT - ((rows && rows.length) || 0));
  } catch (e) {
    console.error("Founding-member count failed:", e.message);
    return null;
  }
}

// Idempotency. Stripe retries on any non-2xx and on timeouts, and a sleeping
// Render instance guarantees some of those. Insert-first: the unique primary
// key makes a duplicate delivery a conflict, which is our signal to skip.
async function claimStripeEvent(evt) {
  if (!DB_CONFIGURED) return true;   // no store: process, best effort
  try {
    await sbRequest("POST", "stripe_events", [{ id: evt.id, type: evt.type }],
      { prefer: "return=minimal" });
    return true;
  } catch (e) {
    if (/duplicate key|23505|already exists/i.test(String(e.message))) {
      console.log(`Stripe event ${evt.id} already processed — skipping.`);
      return false;
    }
    // A real DB failure: process it rather than dropping a payment event on
    // the floor. Replaying our handlers is safe (every write is an upsert).
    console.error("stripe_events claim failed, processing anyway:", e.message);
    return true;
  }
}

/**
 * Apply one Stripe event to our subscription state.
 *
 * Every branch is an UPSERT keyed on user_id, so replaying an event is a
 * no-op rather than a second subscription — which is what makes the whole
 * handler safe to run twice when Stripe retries.
 *
 * Ordering is not guaranteed: `customer.subscription.created` can arrive
 * before `checkout.session.completed`, or after. Both paths therefore resolve
 * the user the same way and write the same row, so whichever lands first wins
 * and the second is a harmless rewrite.
 */
async function handleStripeEvent(evt) {
  const obj = evt && evt.data && evt.data.object;
  if (!obj) return;

  switch (evt.type) {
    case "checkout.session.completed": {
      // The one event that reliably carries our user id.
      const userId = (obj.metadata && obj.metadata.user_id) || obj.client_reference_id;
      if (obj.customer && userId) await setUserStripeCustomer(userId, obj.customer);
      if (obj.mode !== "subscription" || !obj.subscription) return;
      const sub = await STRIPE.stripeRequest(STRIPE_SECRET_KEY, "GET", `subscriptions/${obj.subscription}`);
      const row = STRIPE.subscriptionRowFrom(sub, STRIPE_PRICES, { userId, graceDays: ENT.GRACE_DAYS });
      if (!row) return console.error(`Checkout ${obj.id} completed for a price we don't sell — ignored.`);
      await upsertSubscription(row);
      console.log(`✅ Subscription active: ${row.plan} for user ${userId}`);
      if (row.plan === "pro_annual_founding") {
        const left = await foundingSlotsLeft();
        // A seat just went; refresh the memo rather than letting the pricing
        // page advertise the old count for up to another minute.
        foundingCountCache = { at: Date.now(), left };
        // The checkout-time check can be beaten by a simultaneous buyer. We
        // honour the sale (refunding a lifetime price is worse) but say so.
        if (left !== null && left < 0) {
          console.error(`⚠ Founding-member cap EXCEEDED by ${-left}. Honour the price and close the offer.`);
        } else {
          console.log(`🏅 Founding members: ${FOUNDING_MEMBER_LIMIT - (left || 0)}/${FOUNDING_MEMBER_LIMIT}`);
        }
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const userId = (obj.metadata && obj.metadata.user_id)
        || await userIdForStripeCustomer(typeof obj.customer === "string" ? obj.customer : obj.customer && obj.customer.id);
      if (!userId) return console.error(`Subscription ${obj.id} has no user we recognize — ignored.`);
      // A deletion is terminal regardless of what the object still says.
      const source = evt.type === "customer.subscription.deleted"
        ? { ...obj, status: "canceled" } : obj;
      const row = STRIPE.subscriptionRowFrom(source, STRIPE_PRICES, { userId, graceDays: ENT.GRACE_DAYS });
      if (!row) return;
      await upsertSubscription(row);
      console.log(`Subscription ${evt.type.split(".").pop()}: ${row.plan} -> ${row.status} (user ${userId})`);
      return;
    }

    case "invoice.payment_succeeded": {
      // A renewal. The subscription object carries the NEW period end, so read
      // it rather than trusting the invoice.
      const subId = obj.subscription || (obj.parent && obj.parent.subscription_details
        && obj.parent.subscription_details.subscription);
      if (!subId) return;
      const sub = await STRIPE.stripeRequest(STRIPE_SECRET_KEY, "GET", `subscriptions/${subId}`);
      const userId = (sub.metadata && sub.metadata.user_id) || await userIdForStripeCustomer(sub.customer);
      if (!userId) return;
      const row = STRIPE.subscriptionRowFrom(sub, STRIPE_PRICES, { userId, graceDays: ENT.GRACE_DAYS });
      if (row) {
        await upsertSubscription(row);
        console.log(`💳 Payment succeeded — ${row.plan} renewed to ${row.current_period_end} (user ${userId})`);
      }
      return;
    }

    case "invoice.payment_failed": {
      const subId = obj.subscription || (obj.parent && obj.parent.subscription_details
        && obj.parent.subscription_details.subscription);
      if (!subId) return;
      const sub = await STRIPE.stripeRequest(STRIPE_SECRET_KEY, "GET", `subscriptions/${subId}`);
      const userId = (sub.metadata && sub.metadata.user_id) || await userIdForStripeCustomer(sub.customer);
      if (!userId) return;
      const existing = await findSubscription(userId);
      const row = STRIPE.subscriptionRowFrom({ ...sub, status: "past_due" }, STRIPE_PRICES,
        { userId, graceDays: ENT.GRACE_DAYS });
      if (!row) return;
      // Don't restart the clock. A second failed attempt inside the window
      // must not buy another 7 days of access.
      if (existing && existing.status === "grace" && existing.grace_until) {
        row.grace_until = existing.grace_until;
      }
      await upsertSubscription(row);
      console.log(`⚠ Payment failed — grace until ${row.grace_until} (user ${userId})`);
      // Owner-facing only (sendEmail, not sendOutboundEmail): dunning mail to
      // the customer is Stripe's job and it does it better.
      sendEmail(LEAD_NOTIFY_EMAIL, "CompNinja: a subscription payment failed",
        `A Pro payment failed for user ${userId} (${row.plan}).\n` +
        `Access continues until ${row.grace_until}, then downgrades to free.\n` +
        `Stripe will retry automatically.`);
      return;
    }

    default:
      return;   // subscribed to six events; anything else is noise
  }
}

// Request-shaped convenience: resolve the session, then the entitlements.
// Never throws — an entitlement failure degrades to the free tier rather than
// 500ing a report that would otherwise render.
async function entitlementsFor(req, reportId) {
  try {
    const user = await getSessionUser(req);
    return await getEntitlements(user, reportId);
  } catch (e) {
    console.error("Entitlement resolution failed (defaulting to free):", e.message);
    // No user survived the failure, so proEnabledFor(null) is the honest input:
    // with PRO_AUDIENCE unset this still gates to free (never hand out Pro on
    // an error), and with an audience set it leaves the public ungated, which
    // is the whole point of a test window.
    return ENT.computeEntitlements({ user: null, now: Date.now(), enabled: proEnabledFor(null) });
  }
}
// ---------------------------------------------------------------------------
// Corpus health. The corpus is written and read by fire-and-forget calls that
// swallow their errors so a DB hiccup can never break a search — correct, but
// it made a real outage invisible: ten per-comp columns were missing (the
// ALTER TABLE was never run), so every insert 400'd into the ephemeral file
// and every read came back empty. The corpus sat frozen at 65 rows for weeks
// while the UI reported "+8 comps" on each search and the /admin corpus hit
// rate sat at 0% with no explanation.
//
// Console lines alone did not help — one was already being logged on every
// failure and nobody tails Render's logs. So failures accumulate here and
// render as a banner on /admin, which is where the owner actually looks.
// Counters are in-memory and reset on restart; this is a smoke alarm, not
// accounting.
// ---------------------------------------------------------------------------
const CORPUS_HEALTH = {
  writeFallbacks: 0,    // insert failed -> ephemeral file (rows die on redeploy)
  readFailures: 0,      // read failed  -> corpus-first retrieval sees nothing
  schemaMismatch: false, // the failure looks like a missing column
  lastError: null,
  lastErrorAt: null,
};
// PostgREST reports an unknown column as a 4xx naming the column or the schema
// cache (PGRST204). That is the one failure mode with a specific, actionable
// fix, so it gets called out by name instead of hiding in a generic message.
function noteCorpusFailure(kind, err) {
  const msg = String((err && err.message) || err || "");
  if (kind === "write") CORPUS_HEALTH.writeFallbacks += 1;
  else CORPUS_HEALTH.readFailures += 1;
  CORPUS_HEALTH.lastError = msg.slice(0, 300);
  CORPUS_HEALTH.lastErrorAt = new Date().toISOString();
  if (/column|schema cache|PGRST2\d\d/i.test(msg)) {
    CORPUS_HEALTH.schemaMismatch = true;
    console.error(
      `comp_corpus ${kind} failed on what looks like a MISSING COLUMN. The ALTER TABLE ` +
      `for a new per-comp field was probably never run — see the DDL comment above ` +
      `harvestComps(). Until it is, harvested comps land in an ephemeral file and ` +
      `corpus-first retrieval returns nothing. Detail: ${msg.slice(0, 200)}`);
  } else {
    console.error(`comp_corpus ${kind} failed: ${msg.slice(0, 200)}`);
  }
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
        `&select=ts,address,transaction,deal_date,size_sqft,price_or_rate,price_per_sqft,cap_rate,` +
        `${ALL_TYPE_COMP_FIELDS.join(",")},source_url,source_type,verified&order=ts.desc&limit=${limit}`) || [];
    } catch (e) { noteCorpusFailure("read", e); }
  }
  const fileRows = (await readRowsFromFile(COMP_CORPUS_FILE))
    .filter((r) => r && r.market === market && r.property_type === property_type);
  return [...dbRows, ...fileRows]
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Corpus-first retrieval (cost saver). On a cache miss, before paying for a
// fresh web search, pull comps we already harvested for this market+type. When
// coverage is good AND recent, the model reuses them and we cut the web-search
// budget hard (the expensive part of a call). Thin or stale coverage falls back
// to today's full search, which then refreshes the corpus. Best-effort: any
// failure returns empty coverage, i.e. unchanged behavior. Runs only after the
// exact-address search cache misses, so it never touches the cache key.
// ---------------------------------------------------------------------------
async function retrieveCorpusComps(market, type, months, maxComps) {
  try {
    const rows = await corpusRowsForMarket(market, type, 300);
    if (!rows.length) return { comps: [], coverage: 0, fresh: false };

    // Window filter in year-fraction space (parseDealDate returns e.g. 2024.5).
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const cutoffFrac = cutoff.getFullYear() + (cutoff.getMonth() + 0.5) / 12;

    const usable = rows.filter((r) => {
      // Only feed higher-confidence provenance; a rough guess ("estimate") or a
      // news mention shouldn't seed a report.
      const st = String(r.source_type || "").toLowerCase();
      if (st === "estimate" || st === "news") return false;
      const priced = corpusNum(r.price_or_rate) || corpusNum(r.price_per_sqft);
      const d = parseDealDate(r.deal_date);
      return Boolean(priced) && d != null && d >= cutoffFrac;
    });

    // corpusRowsForMarket returns newest-harvest-first, so rows[0].ts is the
    // freshest we hold for this market. Stale coverage → fall back to the web.
    // 75 days (was 45 until 2026-07-31): the 2026-07-30 speed work flagged
    // this gate as the top untested cost lever, and the exposure is narrow —
    // the only deals a corpus-assisted search can miss are ones that surfaced
    // during the staleness gap, the 2-3 fresh searches are aimed at exactly
    // that gap, and `usable` below is window-filtered, so a market whose
    // comps have aged out of the requested lookback stops qualifying no
    // matter what this constant says. Judge it by the /admin corpus hit rate
    // and spot-checks of corpus-tagged reports; it is one constant to revert.
    const newest = rows[0] && rows[0].ts ? new Date(rows[0].ts) : null;
    const fresh = Boolean(newest && (now - newest) < 75 * 24 * 3600 * 1000);

    return { comps: usable.slice(0, maxComps * 2), coverage: usable.length, fresh };
  } catch (e) {
    console.error("Corpus retrieval failed (falling back to full search):", e.message);
    return { comps: [], coverage: 0, fresh: false };
  }
}

// A market is "corpus-strong" when we hold enough recent, priced comps to lean
// on them instead of the web. One threshold, shared by the search budget and
// the analytics tag so the two can never disagree.
function corpusIsStrong(corpus) {
  return Boolean(corpus && corpus.fresh && corpus.coverage >= 4);
}

// How many web searches to allow. Corpus-strong requests drop to a small floor
// (a subject-size lookup still needs ~2 searches when the size is unknown).
// This is the actual cost lever. A 10-12 comp ask gets two extra searches over
// the old 6/8 — one search page usually yields several comps, so the budget
// grows slower than the comp count. The corpus floor stays put: known comps
// are handed to the model, so a bigger ask needs no extra fresh searches.
function searchBudgetFor(corpus, subjectSizeSqft, maxComps) {
  const big = maxComps > 8;
  if (!corpusIsStrong(corpus)) return subjectSizeSqft ? (big ? 8 : 6) : (big ? 10 : 8);
  return subjectSizeSqft ? 2 : 3;                               // conservative floor, not 0/1
}

// Two-lane parallel search — OFF by default. Measured on 2026-07-30 against a
// same-address control (3600 S High School Rd, Indianapolis, Industrial):
//
//   single lane   81.7s   9 searches   4 comps
//   two lanes     47.0s   10 searches  3 comps     (42% faster, one comp fewer)
//
// and on a dense market (2100 N Stemmons Fwy, Dallas): 67.9s, 8 comps, a good
// provenance mix (the records lane found 5 of the 8, including the only
// public_record) but almost no time saved, because wall clock is the SLOWER
// lane and the records lane ran long.
//
// So the speedup is real but not free and not reliable: a single deep call
// steers its later searches at the gaps it knows it still has, while two
// shallow lanes both rediscover the easy comps. Left switchable so the
// trade can be re-measured on real traffic rather than two test addresses.
const PARALLEL_SEARCH = /^(1|on|true|yes)$/i.test(String(process.env.PARALLEL_SEARCH || ""));

// Even with the flag on, only split when the budget is deep enough for halving
// to save wall clock. A corpus-strong search already runs on 2-3 searches, and
// each lane carries its own copy of the base prompt, so splitting a shallow
// budget costs tokens and buys no time.
const SPLIT_MIN_BUDGET = 6;

// Per-lane comp ask. Half the total plus a cushion, so overlap between the two
// lanes (or a thin lane) still leaves enough unique comps to fill the report,
// while keeping each lane's closing JSON burst well short of a full-size one.
function laneCompsFor(maxComps) {
  return Math.min(maxComps, Math.ceil(maxComps / 2) + 2);
}

// ---------------------------------------------------------------------------
// Daily search cap — a simple in-memory counter, reset at UTC midnight. It
// resets on redeploy/spin-down too, which is fine for this threat model:
// sustained abuse keeps a free instance warm rather than letting it spin down.
// ---------------------------------------------------------------------------
let dailySearchDay = "";
let dailySearchCount = 0;
let dailyCapEmailSent = false;

function todayUTC() { return new Date().toISOString().slice(0, 10); }

// Returns true and reserves a slot for a billed search, or false if today's
// cap is already spent. Emails the owner once per day the first time it bites.
function tryConsumeDailySearch() {
  const today = todayUTC();
  if (today !== dailySearchDay) {
    dailySearchDay = today;
    dailySearchCount = 0;
    dailyCapEmailSent = false;
  }
  if (dailySearchCount >= DAILY_SEARCH_CAP) {
    if (!dailyCapEmailSent) {
      dailyCapEmailSent = true;
      notifyByEmail(`CompNinja hit its daily search cap (${DAILY_SEARCH_CAP})`, [
        ["Date (UTC)", today],
        ["Cap", String(DAILY_SEARCH_CAP)],
        ["What this means", "New searches are being declined until UTC midnight."],
        ["To raise it", "Set DAILY_SEARCH_CAP to a higher number in Render's Environment settings."],
      ]);
    }
    return false;
  }
  dailySearchCount += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Search result cache — Supabase when configured, a keyed JSON file
// otherwise, mirrored in an in-memory Map so a warm process never touches
// disk for a repeat lookup. The key folds in everything that changes the
// prompt (including a signature of the verified comps offered to the model),
// so an approved broker comp naturally busts the cache for its property type.
// ---------------------------------------------------------------------------
const searchCacheMem = new Map();

function cacheKeyFor({ address, type, note, months, maxComps, txFocus, subjectSizeSqft, verifiedComps, subjectDetails }) {
  // Strips decorative punctuation ("St." vs "St", "City,IL" vs "City, IL")
  // so near-identical typing of the same address still hits the cache.
  const norm = (s) => String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  const verifiedSig = (verifiedComps || [])
    .map((c) => `${c.address}|${c.deal_date}|${c.price_or_rate}`)
    .sort()
    .join(";");
  // Two different buildings can share an address, type, and size — a 48-unit
  // and a 6-unit would otherwise collide and be served each other's comps.
  const detailsSig = Object.entries(subjectDetails || {})
    .map(([k, v]) => `${k}=${norm(v)}`)
    .sort()
    .join(",");
  const raw = [norm(address), type, norm(note), months, maxComps, txFocus, subjectSizeSqft || "", verifiedSig].join("::");
  // Appended only when present, so every existing cache entry keeps its key
  // instead of the whole 7-day cache invalidating on deploy.
  return crypto.createHash("sha256").update(detailsSig ? `${raw}::${detailsSig}` : raw).digest("hex");
}

async function loadSearchCacheFile() {
  try {
    return JSON.parse(await fs.promises.readFile(SEARCH_CACHE_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

async function getCachedSearch(key) {
  const now = Date.now();
  const mem = searchCacheMem.get(key);
  if (mem) {
    if (now - mem.ts < SEARCH_CACHE_TTL_MS) return mem.payload;
    searchCacheMem.delete(key);
  }
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/search_cache?cache_key=eq.${key}&select=payload,created_at&limit=1`,
        { headers: supabaseHeaders() }
      );
      if (r.ok) {
        const rows = await r.json();
        const hit = rows[0];
        if (hit) {
          const ts = new Date(hit.created_at).getTime();
          if (now - ts < SEARCH_CACHE_TTL_MS) {
            searchCacheMem.set(key, { payload: hit.payload, ts });
            return hit.payload;
          }
        }
      }
    } catch (err) {
      console.error("Search cache DB read failed:", err.message);
    }
  }
  const fileCache = await loadSearchCacheFile();
  const entry = fileCache[key];
  if (entry && now - entry.ts < SEARCH_CACHE_TTL_MS) {
    searchCacheMem.set(key, entry);
    return entry.payload;
  }
  return null;
}

async function storeCachedSearch(key, payload) {
  const now = Date.now();
  searchCacheMem.set(key, { payload, ts: now });
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/search_cache?on_conflict=cache_key`, {
        method: "POST",
        headers: { ...supabaseHeaders(), prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ cache_key: key, payload, created_at: new Date(now).toISOString() }),
      });
      if (r.ok) return;
      console.error(`Search cache DB write failed (${r.status}) — falling back to file.`);
    } catch (err) {
      console.error("Search cache DB write failed — falling back to file:", err.message);
    }
  }
  try {
    const fileCache = await loadSearchCacheFile();
    fileCache[key] = { payload, ts: now };
    // Trim to the most recent 500 entries so the file can't grow unbounded.
    const keys = Object.keys(fileCache);
    if (keys.length > 500) {
      keys.sort((a, b) => fileCache[a].ts - fileCache[b].ts)
        .slice(0, keys.length - 500)
        .forEach((k) => delete fileCache[k]);
    }
    await fs.promises.writeFile(SEARCH_CACHE_FILE, JSON.stringify(fileCache));
  } catch (err) {
    console.error("Search cache file write failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Lookback derivation (cost saver). A shorter-lookback request is a subset of
// a longer one: every comp a 12-month search could return is, by definition,
// inside a cached 24-month report for the same address/type/knobs. So on a
// cache miss, before paying for a fresh search, probe the preset ladder of
// LONGER windows under the same key and filter that report's comps down to
// the requested window. Undated comps are dropped — the parent search only
// promised they fall inside ITS window, so keeping one would over-claim
// recency, and this app's provenance rule is under-claim, never over.
// Served only when the filtered set is still a real report: a floor on total
// comps, plus at least 3 dated sales when the ask includes sales (the value
// hero's range is sales-only, so a saleless subset would put a number on top
// of nothing). Anything thinner falls through to the normal corpus/search
// path unchanged. The derived report is deliberately NOT re-cached: after the
// first probe the parent sits in the in-memory cache map, so a repeat costs
// one Map lookup — and re-caching under the short key would hand the subset a
// fresh 7-day TTL running past its parent's.
// Known soft edge: the parent's narrative fields (summary, value_drivers) may
// occasionally reference the longer window in prose. They are market-level
// commentary, kept for the same reason curation doesn't move the Avg $/SF
// tile; the comp table itself only ever shows in-window rows.
// ---------------------------------------------------------------------------
const LOOKBACK_LADDER = [12, 24, 36]; // the preset windows worth probing

function windowedComps(comps, months) {
  // Same year-fraction cutoff as retrieveCorpusComps — one definition of
  // "inside the window" across the whole cost-saving layer.
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const cutoffFrac = cutoff.getFullYear() + (cutoff.getMonth() + 0.5) / 12;
  return (comps || []).filter((c) => {
    // Report comps carry "date" (the model's comp shape); corpus rows use
    // "deal_date". Accept either so this also works on any future caller.
    const d = parseDealDate(c.date || c.deal_date);
    return d != null && d >= cutoffFrac;
  });
}

function deriveWindowedReport(parent, months, txFocus, maxComps) {
  if (!parent || !Array.isArray(parent.comps)) return null;
  const comps = windowedComps(parent.comps, months);
  if (comps.length < Math.min(6, maxComps)) return null;
  if (txFocus !== "leases" &&
      comps.filter((c) => String(c.transaction || "").toLowerCase().startsWith("sale")).length < 3) {
    return null;
  }
  // Shallow clone, never a mutation — the parent object is shared with the
  // in-memory cache map and must keep its full comp list.
  return { ...parent, comps };
}

async function findDerivableReport(keyParams, months, txFocus, maxComps) {
  for (const w of LOOKBACK_LADDER) {
    if (w <= months) continue;
    const parent = await getCachedSearch(cacheKeyFor({ ...keyParams, months: w }));
    if (!parent) continue;
    // Same read-time fix the direct cache-hit path applies (idempotent).
    reconcilePricePerSqft(parent);
    const derived = deriveWindowedReport(parent, months, txFocus, maxComps);
    if (derived) return { derived, parent, parentMonths: w };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Subject-size memo (cost saver). When the visitor leaves the SF field blank,
// the search budget carries two extra web searches just to look the building's
// size up (searchBudgetFor: 10 vs 8, and a corpus-strong floor of 3 vs 2). A
// building's size doesn't change, so once ANY prior search has looked it up
// the answer is reusable: hand it to the model up front and the budget drops,
// exactly as if the visitor had typed it. The visitor's own entry always wins;
// the memo only fills silence. Supabase table (run this DDL before deploying —
// absent, every read/write degrades safely to the git-ignored file below):
//
//   create table subject_sizes (
//     address_norm text primary key,
//     size_sqft    bigint not null,
//     source       text,
//     updated_at   timestamptz not null default now()
//   );
//
// Two deliberate rules. Model-ESTIMATED sizes are never remembered — a guess
// that quietly becomes "known" for every future search of this address is how
// a valuation drifts; only public_record / listing lookups persist, with the
// source kept VERBATIM so the hero's "from public records" phrasing stays
// truthful on reuse (index.html maps the source string exactly). And the memo
// is applied OUTSIDE cacheKeyFor, so cache keys stay a pure function of the
// request — a memo appearing later can never orphan existing cache entries.
// ---------------------------------------------------------------------------
const SUBJECT_SIZES_FILE = path.join(__dirname, "subject-sizes.json");
const subjectSizesMem = new Map();

// ⚠ Same normalization idea as the `norm` inside cacheKeyFor (one address,
// many typings) — if that ever changes shape, change this with it. Kept
// separate because this key must stay stable for the life of the TABLE, not
// just the 7-day cache.
function subjectSizeKey(address) {
  return String(address || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadSubjectSizesFile() {
  try {
    return JSON.parse(await fs.promises.readFile(SUBJECT_SIZES_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

async function findKnownSubjectSize(address) {
  const key = subjectSizeKey(address);
  if (!key) return null;
  const mem = subjectSizesMem.get(key);
  if (mem) return mem;
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/subject_sizes?address_norm=eq.${encodeURIComponent(key)}&select=size_sqft,source&limit=1`,
        { headers: supabaseHeaders() }
      );
      if (r.ok) {
        const row = (await r.json())[0];
        const size = row && Math.round(Number(row.size_sqft));
        if (size > 0) {
          const hit = { size, source: String(row.source || "") };
          subjectSizesMem.set(key, hit);
          return hit;
        }
      }
    } catch (err) {
      console.error("Subject-size read failed (continuing without):", err.message);
    }
  }
  const file = await loadSubjectSizesFile();
  const row = file[key];
  if (row && Math.round(Number(row.size)) > 0) {
    const hit = { size: Math.round(Number(row.size)), source: String(row.source || "") };
    subjectSizesMem.set(key, hit);
    return hit;
  }
  return null;
}

// Fire-and-forget, like the harvester: a failed save must never break the
// request that produced the report.
function rememberSubjectSize(address, payload) {
  (async () => {
    const key = subjectSizeKey(address);
    const size = Math.round(Number(String((payload && payload.subject_size_sqft) || "").replace(/[^0-9.]/g, "")));
    if (!key || !Number.isFinite(size) || size <= 0 || size > 20_000_000) return;
    const source = String((payload && payload.subject_size_source) || "").trim();
    // An estimated size is an answer for THIS report, not a fact about the
    // building — never let it masquerade as known on future searches.
    if (source !== "public_record" && source !== "listing") return;
    const row = { size, source };
    subjectSizesMem.set(key, row);
    if (DB_CONFIGURED) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/subject_sizes?on_conflict=address_norm`, {
          method: "POST",
          headers: { ...supabaseHeaders(), prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ address_norm: key, size_sqft: size, source, updated_at: new Date().toISOString() }),
        });
        if (r.ok) return;
        console.error(`Subject-size DB write failed (${r.status}) — falling back to file.`);
      } catch (err) {
        console.error("Subject-size DB write failed — falling back to file:", err.message);
      }
    }
    try {
      const file = await loadSubjectSizesFile();
      file[key] = row;
      await fs.promises.writeFile(SUBJECT_SIZES_FILE, JSON.stringify(file));
    } catch (err) {
      console.error("Subject-size file write failed:", err.message);
    }
  })().catch((err) => console.error("Subject-size save failed:", err.message));
}

// ---------------------------------------------------------------------------
// Shared reports — a report the visitor chose to publish under a short id so
// they can send the link to a partner, lender, or the property owner. Same
// storage shape as the search cache (Supabase table `shared_reports` keyed by
// id, in-memory Map + JSON file fallback) but with NO expiry: a shared
// valuation link that dies later is worse than a few stale KB in Postgres.
// ---------------------------------------------------------------------------
const sharedReportsMem = new Map();

function newShareId() {
  // 8 random bytes -> 11 url-safe chars. Ample against collision at this scale.
  return crypto.randomBytes(8).toString("base64url");
}

async function loadSharedReportsFile() {
  try {
    return JSON.parse(await fs.promises.readFile(SHARED_REPORTS_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

async function getSharedReport(id) {
  const mem = sharedReportsMem.get(id);
  if (mem) return mem;
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/shared_reports?id=eq.${encodeURIComponent(id)}&select=payload&limit=1`,
        { headers: supabaseHeaders() }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows[0]) {
          sharedReportsMem.set(id, rows[0].payload);
          return rows[0].payload;
        }
      }
    } catch (err) {
      console.error("Shared report DB read failed:", err.message);
    }
  }
  const fileStore = await loadSharedReportsFile();
  if (fileStore[id]) {
    sharedReportsMem.set(id, fileStore[id]);
    return fileStore[id];
  }
  return null;
}

async function storeSharedReport(id, payload) {
  sharedReportsMem.set(id, payload);
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_reports`, {
        method: "POST",
        headers: { ...supabaseHeaders(), prefer: "return=minimal" },
        body: JSON.stringify({ id, payload, created_at: new Date().toISOString() }),
      });
      if (r.ok) return;
      console.error(`Shared report DB write failed (${r.status}) — falling back to file.`);
    } catch (err) {
      console.error("Shared report DB write failed — falling back to file:", err.message);
    }
  }
  try {
    const fileStore = await loadSharedReportsFile();
    fileStore[id] = payload;
    await fs.promises.writeFile(SHARED_REPORTS_FILE, JSON.stringify(fileStore));
  } catch (err) {
    console.error("Shared report file write failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Dynamic market pages (Market Explorer) — same store idiom as shared reports:
// Supabase `market_pages` table when configured, JSON file fallback otherwise
// (file is lost on redeploy — ephemeral-filesystem hosts).
// ---------------------------------------------------------------------------
async function loadDynamicMarketsFile() {
  try {
    return JSON.parse(await fs.promises.readFile(DYNAMIC_MARKETS_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

// A malformed row must never crash renderMarketPageHTML, so only slugs/payloads
// that look renderable make it into the merged view.
function validDynamicMarket(slug, payload) {
  return /^[a-z0-9-]{3,80}$/.test(String(slug || "")) &&
    payload && Number.isFinite(Number(payload.ppsf && payload.ppsf.median));
}

async function loadDynamicMarketPages() {
  const merged = {};
  const fileStore = await loadDynamicMarketsFile();
  for (const [slug, payload] of Object.entries(fileStore)) {
    if (validDynamicMarket(slug, payload)) merged[slug] = payload;
  }
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/market_pages?select=slug,payload&limit=1000`, {
        headers: supabaseHeaders(),
      });
      if (r.ok) {
        for (const row of await r.json()) {
          if (validDynamicMarket(row.slug, row.payload)) merged[row.slug] = row.payload;
        }
      } else {
        console.error(`Dynamic market pages DB read failed (${r.status}) — file store only.`);
      }
    } catch (err) {
      console.error("Dynamic market pages DB read failed — file store only:", err.message);
    }
  }
  DYNAMIC_MARKET_PAGES = merged;
  return Object.keys(merged).length;
}

async function storeDynamicMarketPage(slug, payload) {
  DYNAMIC_MARKET_PAGES[slug] = payload;
  if (DB_CONFIGURED) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/market_pages?on_conflict=slug`, {
        method: "POST",
        headers: { ...supabaseHeaders(), prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ slug, payload, created_at: new Date().toISOString() }),
      });
      if (r.ok) return;
      console.error(`Dynamic market page DB write failed (${r.status}) — falling back to file.`);
    } catch (err) {
      console.error("Dynamic market page DB write failed — falling back to file:", err.message);
    }
  }
  try {
    const fileStore = await loadDynamicMarketsFile();
    fileStore[slug] = payload;
    await fs.promises.writeFile(DYNAMIC_MARKETS_FILE, JSON.stringify(fileStore));
  } catch (err) {
    console.error("Dynamic market page file write failed:", err.message);
  }
}

// Piggyback publisher: every billed /api/comps search already paid for fresh
// comp data, so distill it into the market-page layer too — coverage grows
// and refreshes as reports run, at zero extra API cost. Quietly skips
// anything that doesn't parse to a clean "City, ST", isn't one of the four
// page-proven property types, collides with a curated seed page, or misses
// the ≥MIN_PRICED_SALE_COMPS publish gate. Fire-and-forget: never blocks or
// fails the search that triggered it.
function maybePublishMarketSnapshot(type, address, data) {
  try {
    const typeOk = EXPLORE_TYPES.find((t) => t.toLowerCase() === String(type).trim().toLowerCase());
    if (!typeOk) return;
    // Same best-effort parse as marketOf(), but strict: publishable pages need
    // a real two-letter state and a plausible city, or we skip entirely.
    const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const state = (parts[parts.length - 1].match(/^([A-Za-z]{2})\b/) || [])[1];
    const cityRaw = parts[parts.length - 2].replace(/\s+/g, " ");
    if (!state || !US_STATES.has(state.toUpperCase())) return;
    if (!/^[a-zA-Z][a-zA-Z .'\-]{1,39}$/.test(cityRaw)) return;
    const city = cityRaw.toLowerCase().replace(/(^|[\s.'\-])[a-z]/g, (ch) => ch.toUpperCase());

    const slug = slugifyMarket(typeOk, city, state.toUpperCase());
    if (MARKET_PAGES[slug]) return; // curated seed page wins — don't write shadowed rows
    const { snapshot, pricedSaleCount } = distillMarketSnapshot(
      { type: typeOk, city, state: state.toUpperCase() }, data);
    if (!snapshot || pricedSaleCount < MIN_PRICED_SALE_COMPS) return;

    const isNew = !DYNAMIC_MARKET_PAGES[slug];
    storeDynamicMarketPage(slug, snapshot).then(() => {
      if (isNew) {
        console.log(`🧭 Market page published from a report search: ${slug} (${pricedSaleCount} priced sale comps)`);
        notifyByEmail(`New market page published from a report search: ${typeOk} — ${city}, ${state.toUpperCase()}`, [
          ["Market", `${city}, ${state.toUpperCase()}`], ["Type", typeOk],
          ["Priced sale comps", String(pricedSaleCount)],
          ["URL", `${SITE_URL}/market/${slug}`],
        ]);
      }
    }).catch((err) => console.error("Market snapshot piggyback store failed:", err.message));
  } catch (err) {
    console.error("Market snapshot piggyback failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Comp corpus — every search response is already-paid-for market data, so its
// comps persist permanently instead of dying with the 7-day cache. Harvested
// on cached hits too (dedupe makes repeats free, and it back-fills comps from
// pre-corpus cache entries). This raw layer is what broker verification and
// future retrieval features build on. Supabase table `comp_corpus`; file
// fallback comp-corpus.jsonl. Fire-and-forget: never blocks or fails the
// search that triggered it.
//
// Supabase DDL (run once in the SQL editor):
//   create table public.comp_corpus (
//     id bigint generated always as identity primary key,
//     ts timestamptz not null default now(),
//     dedupe_key text not null unique,
//     property_type text not null, market text not null, address text not null,
//     transaction text, deal_date text, size_sqft text, price_or_rate text,
//     price_per_sqft text, cap_rate text,
//     -- per-type specs (TYPE_COMP_FIELDS); each row carries every column,
//     -- and the ones its type doesn't use stay empty
//     clear_height text, dock_doors text,
//     building_class text, floor_plate text,
//     center_type text, anchor_tenant text,
//     units text, price_per_unit text,
//     lot_acres text, price_per_acre text, zoning text,
//     beds_baths text,
//     tenancy text, year_built text,
//     notes text, source_url text, source_type text, lat text, lng text,
//     verified boolean default false
//   );
//   alter table public.comp_corpus enable row level security;
//
// Existing table (added 2026-07-27) — run BEFORE deploying, or every corpus
// insert 400s on the unknown columns and harvesting silently falls back to
// the ephemeral file:
//   alter table public.comp_corpus
//     add column if not exists building_class text,
//     add column if not exists floor_plate text,
//     add column if not exists center_type text,
//     add column if not exists anchor_tenant text,
//     add column if not exists units text,
//     add column if not exists price_per_unit text,
//     add column if not exists lot_acres text,
//     add column if not exists price_per_acre text,
//     add column if not exists zoning text,
//     add column if not exists beds_baths text;
// ---------------------------------------------------------------------------
const corpusSeen = new Set();   // dedupe keys seen this process (file-seeded)
let corpusSeenSeeded = false;

// Does this "address" name a statistic rather than a property? In thin markets
// the model sometimes pads the comp list with rows like "Pittsburgh Metro
// Multifamily - Market Median Benchmark".
//
// Deliberately keyed on aggregate VOCABULARY, not on address shape: plenty of
// genuine small multifamily and retail comps are listed without a street
// number ("Highland Park Triplex, Pittsburgh, PA 15206", "Swissvale Triplex
// (near Edgewood Town Center)"), so requiring one would discard real data.
// Street names survive too — "123 Market St" has no aggregate word, while
// "Market Median" does.
const AGGREGATE_ADDRESS_RE =
  /\b(benchmark|median|average|avg|composite|index|market (report|data|summary|stats?|statistics)|year[\s-]end (summary|report))\b/i;

function isAggregateAddress(address) {
  return AGGREGATE_ADDRESS_RE.test(String(address || ""));
}

function corpusKeyOf(c) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return [norm(c.address), norm(c.date || c.deal_date), norm(c.price_or_rate)].join("|");
}

async function seedCorpusSeen() {
  if (corpusSeenSeeded) return;
  corpusSeenSeeded = true;
  try {
    (await readRowsFromFile(COMP_CORPUS_FILE)).forEach((r) => r && r.dedupe_key && corpusSeen.add(r.dedupe_key));
  } catch (_) { /* no file yet */ }
}

async function harvestComps(type, searchAddress, payload) {
  try {
    // Corpus rows have no currency column, so a foreign report's prices would
    // be stored indistinguishable from USD and poison retrieval/market pages.
    // Non-US markets are rare enough that skipping beats an ALTER TABLE (the
    // missing-column class of outage — see CLAUDE.md corpus health).
    // Missing currency = pre-feature cached payload that never saw
    // normalizeCurrency(); treat as USD so old cached reports still harvest.
    const cur = String((payload && payload.currency) || "USD").toUpperCase();
    if (cur !== "USD") {
      console.log(`🗃  Comp corpus skipped (non-USD report: ${cur} — ${marketOf(searchAddress)})`);
      return;
    }
    await seedCorpusSeen();
    const comps = payload && Array.isArray(payload.comps) ? payload.comps : [];
    const rows = [];
    for (const c of comps) {
      if (!c || !String(c.address || "").trim()) continue;
      // A comp with no price at all is not data worth keeping.
      if (!String(c.price_or_rate || "").trim() && !String(c.price_per_sqft || "").trim()) continue;
      // Backstop for the prompt's individual-property rule: a market median or
      // research benchmark formatted as a comp would otherwise sit in the
      // permanent corpus looking like a real transaction.
      if (isAggregateAddress(c.address)) {
        console.warn("Comp corpus: skipped market-aggregate row —", String(c.address).trim().slice(0, 80));
        continue;
      }
      const key = corpusKeyOf(c);
      if (corpusSeen.has(key)) continue;
      corpusSeen.add(key);
      rows.push({
        ts: new Date().toISOString(),
        dedupe_key: key,
        property_type: String(type),
        market: marketOf(c.address),
        address: String(c.address).trim(),
        transaction: String(c.transaction || ""),
        deal_date: String(c.date || ""),
        size_sqft: String(c.size_sqft || ""),
        price_or_rate: String(c.price_or_rate || ""),
        price_per_sqft: String(c.price_per_sqft || ""),
        cap_rate: String(c.cap_rate || ""),
        // Per-type specs (TYPE_COMP_FIELDS). One flat row per comp regardless
        // of type, so every key is always present — the columns a given type
        // doesn't use just stay empty.
        ...Object.fromEntries(ALL_TYPE_COMP_FIELDS.map((f) => [f, String(c[f] || "")])),
        tenancy: String(c.tenancy || ""),
        year_built: String(c.year_built || ""),
        notes: String(c.notes || ""),
        source_url: String(c.source_url || ""),
        source_type: String(c.source_type || ""),
        lat: String(c.lat || ""),
        lng: String(c.lng || ""),
        verified: Boolean(c.verified),
      });
    }
    if (!rows.length) return;
    let stored = false;
    if (DB_CONFIGURED) {
      try {
        // Batch insert; the unique dedupe_key + ignore-duplicates makes
        // cross-restart and cross-instance repeats a no-op.
        const r = await fetch(`${SUPABASE_URL}/rest/v1/comp_corpus?on_conflict=dedupe_key`, {
          method: "POST",
          headers: { ...supabaseHeaders(), prefer: "return=minimal,resolution=ignore-duplicates" },
          body: JSON.stringify(rows),
        });
        if (!r.ok) throw new Error(`Supabase insert failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
        stored = true;
      } catch (err) {
        noteCorpusFailure("write", err);
      }
    }
    if (!stored) {
      await fs.promises.appendFile(COMP_CORPUS_FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    // Say WHERE the rows landed. This line used to read the same whether the
    // batch reached Postgres or fell into the ephemeral file, which is how a
    // frozen corpus looked healthy for weeks.
    console.log(stored
      ? `🗃  Comp corpus +${rows.length} (${type} — ${marketOf(searchAddress)})`
      : `🗃  Comp corpus +${rows.length} (${type} — ${marketOf(searchAddress)}) — EPHEMERAL FILE, not the database; these rows are lost on the next redeploy`);
  } catch (err) {
    console.error("Comp corpus harvest failed:", err.message);
  }
}

// Thin-data Explorer previews: shown once to the visitor who generated them,
// in-memory only (losing them on restart is fine — the search cache makes a
// re-explore free for 7 days).
const previewPagesMem = new Map(); // slug -> { payload, ts }
const PREVIEW_TTL_MS = 30 * 60 * 1000;

// Two visitors exploring the same market at once should bill one search, not two.
const exploreInFlight = new Map(); // slug -> Promise<{status, body}>

const EXPLORE_TYPES = ["Industrial", "Office", "Retail", "Multifamily"];
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

// ---------------------------------------------------------------------------
// Email via Resend — all sends are fire-and-forget so a slow or failing email
// provider never delays or breaks the request that triggered them.
//
// Two tiers:
//   notifyByEmail     — internal notifications to the owner. Works on the
//                       Resend free tier (delivers to the account address).
//   sendOutboundEmail — mail to leads/brokers. Gated on EMAIL_FROM, which
//                       should only be set once a custom domain is verified
//                       in Resend; until then these calls silently no-op
//                       (with a console line so tests can see the skip).
// ---------------------------------------------------------------------------
function sendEmail(to, subject, text, { from, replyTo } = {}) {
  if (!RESEND_API_KEY) return;
  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: from || "CompNinja <onboarding@resend.dev>",
      to: [to],
      subject,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  })
    .then(async (r) => {
      if (!r.ok) console.error(`Email send failed (${subject}):`, r.status, (await r.text().catch(() => "")).slice(0, 300));
    })
    .catch((err) => console.error(`Email send failed (${subject}):`, err.message));
}

// Internal notification to the owner. Empty fields are dropped from the body.
function notifyByEmail(subject, fields) {
  const text = fields
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  sendEmail(LEAD_NOTIFY_EMAIL, subject, text);
}

// Outbound mail to a lead or broker. Replies route to the owner.
function sendOutboundEmail(to, subject, text) {
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    console.log(`Outbound email skipped (${!RESEND_API_KEY ? "RESEND_API_KEY" : "EMAIL_FROM"} unset): ${subject}`);
    return;
  }
  sendEmail(to, subject, text, { from: EMAIL_FROM, replyTo: LEAD_NOTIFY_EMAIL });
}

// ---------------------------------------------------------------------------
// Prompt builder — property-type aware
// ---------------------------------------------------------------------------
// Approved broker-submitted comps for this property type, offered to the model
// as trusted candidates. Empty when the DB is unconfigured or the fetch fails;
// the report then works exactly as before.
async function fetchVerifiedComps(type, txFocus) {
  if (!DB_CONFIGURED) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/comp_submissions` +
      `?status=eq.approved&property_type=eq.${encodeURIComponent(type)}` +
      // id/broker_email feed citation tracking + profile links. Deliberately
      // NOT cited_count: the cache signature hashes offered-comp fields, and a
      // count that changes on every citation would bust the search cache.
      `&select=id,broker_email,address,transaction,deal_date,size_sqft,price_or_rate,cap_rate,notes,broker_name,broker_company` +
      `&order=ts.desc&limit=25`;
    if (txFocus === "sales") url += `&transaction=eq.Sale`;
    else if (txFocus === "leases") url += `&transaction=eq.Lease`;
    const r = await fetch(url, { headers: supabaseHeaders() });
    if (!r.ok) throw new Error(`Supabase read failed (${r.status}).`);
    return await r.json();
  } catch (err) {
    console.error("Verified comp fetch failed; continuing without:", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Per-type comp fields. Each property type reports the two or three specs its
// buyers actually price on, beyond the shared address/date/size/price set.
// `fields` are added to the comp JSON shape and harvested into comp_corpus;
// `instruction` tells the model what each one means. The front-end mirrors
// this in TYPE_COLUMNS / columnsForType() (index.html) — a field added here
// with no matching column there is fetched, stored, and never displayed.
// ---------------------------------------------------------------------------
const TYPE_COMP_FIELDS = {
  Industrial: {
    fields: ["clear_height", "dock_doors"],
    instruction: `"clear_height" = the interior clear/ceiling height (e.g. "32 ft"), and "dock_doors" = the number and type of loading doors (e.g. "6 dock-high, 2 grade-level")`,
  },
  Office: {
    fields: ["building_class", "floor_plate"],
    instruction: `"building_class" = the building class, exactly one of "Class A", "Class B", or "Class C", and "floor_plate" = the typical floor size, formatted like "18,000 SF". Sources state a floor plate far less often than a floor count, so when no floor plate is stated but the number of stories is known, divide the building size by the story count and report that. Leave it empty only when neither is available`,
  },
  Retail: {
    fields: ["center_type", "anchor_tenant"],
    instruction: `"center_type" = the retail format (e.g. "Neighborhood center", "Strip center", "Power center", "Single-tenant NNN", "Urban storefront"), and "anchor_tenant" = the anchor or largest tenant by name (e.g. "Kroger"). Use "Unanchored" whenever the format itself implies no anchor (strip centers and unanchored inline retail usually have none) or the sources show a multi-tenant center with no anchor; leave it empty only when you cannot tell either way`,
  },
  Multifamily: {
    fields: ["units", "price_per_unit"],
    instruction: `"units" = the number of apartment units as a plain number (e.g. "48"), and "price_per_unit" = the sale price divided by that unit count, formatted like "$185,000". Price per unit is the primary multifamily metric, so compute it yourself whenever you have both a sale price and a unit count. Leave "price_per_unit" empty for lease comps`,
  },
  Land: {
    fields: ["lot_acres", "price_per_acre", "zoning"],
    instruction: `"lot_acres" = the parcel size in acres as a plain number (e.g. "2.4"), "price_per_acre" = the price divided by that acreage, formatted like "$410,000" (compute it whenever you have both), and "zoning" = the zoning code plus a two-or-three-word plain-English gloss, e.g. "M-1 light industrial" or "C2 general commercial". Keep it under 30 characters — it is a table cell, not a sentence, so put entitlement status, rezoning history, and planned use in "notes" instead`,
  },
  // lot_size was tried here and dropped (2026-07-27): 0/16 fill across two
  // test addresses even with an explicit assessor-record nudge — the model's
  // search budget (6-8 calls total) doesn't stretch to a per-comp assessor
  // lookup for a list this size, and general listing search rarely surfaces it.
  Residential: {
    fields: ["beds_baths"],
    instruction: `"beds_baths" = the bedroom and bathroom count formatted like "4 bd / 3 ba"`,
  },
};

// Subject details arrive from the browser, so they are untrusted input headed
// for a prompt. Keep only the keys this property type actually reports, force
// them to short strings, and drop blanks. Everything else is discarded rather
// than sanitized in place.
function sanitizeSubjectDetails(type, raw) {
  const spec = TYPE_COMP_FIELDS[type];
  if (!spec || !raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of spec.fields) {
    const v = String(raw[key] == null ? "" : raw[key]).trim().slice(0, 40);
    if (v) out[key] = v;
  }
  return out;
}

// Every per-type field key, for the storage layers that keep one flat row per
// comp regardless of type.
const ALL_TYPE_COMP_FIELDS = [...new Set(
  Object.values(TYPE_COMP_FIELDS).flatMap((t) => t.fields)
)];

// Display labels for the per-type comp fields, for the server-rendered market
// pages. Flat and keyed by field name — NOT a fifth per-type map. These must
// match index.html's TYPE_COLUMNS labels exactly, so the same field never
// reads one way in the report and another on a market page;
// .claude/skills/add-comp-field/check-field-maps.js enforces that.
const FIELD_LABELS = {
  clear_height: "Clear Height",
  dock_doors: "Dock Doors",
  building_class: "Class",
  floor_plate: "Floor Plate",
  center_type: "Center Type",
  anchor_tenant: "Anchor",
  units: "Units",
  price_per_unit: "$/Unit",
  lot_acres: "Acres",
  zoning: "Zoning",
  price_per_acre: "$/Acre",
  beds_baths: "Beds / Baths",
};

// ---------------------------------------------------------------------------
// Search lanes. A single call spends its whole search budget serially, and the
// model re-reads every prior search result each round, so BOTH latency and
// input tokens grow quadratically with the round count: one measured 8-round
// report took 67s and 154k input tokens to produce 3k of output. Splitting the
// budget across two CONCURRENT calls halves the serial depth, which roughly
// halves both (2 x 4 rounds accumulates ~76k input tokens, not 154k).
//
// The two lanes get disjoint source territory so they don't re-search the same
// pages — a split by SOURCE rather than by geography or transaction type, which
// also widens the provenance mix (the records lane is where public_record and
// news badges come from, the primary lane where listings do).
//
// "solo" is the original single-call prompt, still used when the budget is too
// small to be worth splitting (see splitLanes).
// The lanes are a STARTING BIAS, not a fence. An earlier version forbade each
// lane from touching the other's sources and told it not to pad the list; on a
// same-address A/B that cut comp yield from 4 to 1, because assessor and deed
// records are largely not web-searchable (sale prices aren't in indexed parcel
// pages), so the records lane returned nothing while the listing lane, barred
// from news, lost the largest comp in the market. Priority ordering plus an
// explicit "widen rather than come back short" restores the yield; the merge
// dedupes whatever overlap that costs.
const LANE_GUIDANCE = {
  primary: `SEARCH ANGLE - START WITH BROKERAGE AND LISTING SOURCES: a second analyst is working this same property from public records and news in parallel, and your results will be merged with theirs, so favour sources they are less likely to reach. Begin with brokerage and listing sources: LoopNet, Crexi, CommercialSearch, Brevitas, auction platforms, and brokerage sites and deal announcements (CBRE, JLL, Cushman and Wakefield, Colliers, Marcus and Millichap, Lee and Associates, Kidder Mathews, NAI, and local and regional firms). This is a preference, not a restriction: if those sources run dry before you have enough comparable properties, widen to any source you like rather than coming back short. A real comp from the "wrong" source is far more useful than a missing one.`,
  records: `SEARCH ANGLE - START WITH NEWS, PRESS AND PUBLIC RECORDS: a second analyst is working this same property from brokerage listing sites in parallel, and your results will be merged with theirs, so favour sources they are less likely to reach. Begin with transaction coverage and records: local business journals and trade press reporting sales and leases, brokerage and owner press releases, REIT and institutional investor disclosures, and county assessor, recorder, deed or property-tax records and open-data portals. This is a preference, not a restriction: if those sources run dry before you have enough comparable properties, widen to any source you like, including listing sites, rather than coming back short. A real comp from the "wrong" source is far more useful than a missing one.`,
};

function buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpusComps, subjectDetails, lane = "solo") {
  // The records lane contributes comps (and the subject size, which lives in
  // assessor data) only — the primary lane owns every market-level figure and
  // all of the narrative, so the report has one coherent voice and one set of
  // market numbers rather than two that have to be reconciled.
  const compsOnly = lane === "records";
  const typeGuidance = {
    Industrial:  "Focus on warehouse/distribution/flex space. Report price/SF for sales and NNN $/SF/yr for leases.",
    Office:      "Focus on office buildings/suites. Report price/SF for sales and full-service or NNN $/SF/yr for leases, building class (A/B/C) in notes.",
    Retail:      "Focus on retail/strip/single-tenant net lease. Report price/SF for sales and NNN $/SF/yr for leases, tenant/anchor and cap rate where relevant.",
    Multifamily: "Focus on apartment/multifamily. Report price per unit AND price/SF, cap rate, and unit count in notes.",
    Land:        "Focus on comparable land sales. Report price per acre and price/SF of land, zoning and entitlement notes.",
    Residential: "Focus on single-family homes, townhomes, and condos. Report sale price and price/SF for sales, or monthly rent for leases/rentals. Include beds/baths, year built, and lot size in notes. Leave cap_rate empty unless it is an investment/rental sale with a stated cap rate.",
  };

  // The subject-size lookup belongs to whichever lane searches assessor data:
  // the records lane on a split, the single call otherwise. Asking the primary
  // lane for it too would spend a second search re-finding the same number, and
  // listing sites are the weaker source for building SF anyway.
  const wantsSize = !subjectSizeSqft && lane !== "primary";

  // Anchor the lookback window to real dates — the model doesn't know "today",
  // so "last N months" alone drifts toward stale comps.
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const todayStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const cutoffStr = cutoff.toLocaleString("en-US", { month: "long", year: "numeric" });

  // Comp JSON shape: every building type carries tenancy + year-built (tenant
  // quality moves pricing); each type adds the two or three specs its buyers
  // price on (TYPE_COMP_FIELDS); Land has no building, so it carries neither
  // tenancy nor year built.
  const isLand = type === "Land";
  const typeSpec = TYPE_COMP_FIELDS[type];
  const typeFields = typeSpec ? typeSpec.fields.map((f) => `"${f}": "", `).join("") : ``;
  const buildingFields = isLand ? `` : `"tenancy": "", "year_built": "", `;
  const compShape = `{ "address": "", "date": "", "transaction": "", "size_sqft": "", ${typeFields}"price_or_rate": "", "price_per_sqft": "", "cap_rate": "", ${buildingFields}"notes": "", "source_url": "", "source_type": "", "verified": false }`;

  // Trusted internal comps get their own prompt section when any exist.
  const verifiedBlock = (verifiedComps && verifiedComps.length) ? [
    ``,
    `VERIFIED INTERNAL COMPS: the following ${verifiedComps.length === 1 ? "comp was" : "comps were"} submitted by local brokers and reviewed by our team. Treat the details as accurate.`,
    ...verifiedComps.map((c, i) =>
      `${i + 1}. ${c.address} | ${c.transaction || "transaction type unknown"} | ${c.deal_date || "date unknown"} | ${c.size_sqft ? c.size_sqft + " SF" : "size unknown"} | ${c.price_or_rate || "price unknown"}${c.cap_rate ? " | cap rate " + c.cap_rate : ""}${c.notes ? " | " + c.notes : ""}`),
    `Include each verified internal comp in the "comps" array IF it is genuinely comparable to the target property (reasonably near the target address and inside the date window). Set "verified": true on those and copy their details faithfully; compute "price_per_sqft" from the given size and price where possible. When a verified comp and a web result describe the same transaction, keep only the verified one. Verified comps count toward the comp total. Set "verified": false on every comp found via web search. Never include a verified comp that is clearly in a different city or market than the target.`,
  ].join("\n") : "";

  // Type-specific specs already stored on a corpus row. Passed through so a
  // reused comp keeps them, instead of coming back with those columns empty.
  const typeSpecsOf = (c) => (typeSpec ? typeSpec.fields : [])
    .map((f) => (c[f] ? ` | ${f.replace(/_/g, " ")} ${c[f]}` : "")).join("");

  // What the owner told us about their own building. Given to the model so it
  // matches on the attributes that actually drive comparability, not just
  // address and size.
  const detailEntries = Object.entries(subjectDetails || {});
  const subjectDetailBlock = detailEntries.length
    ? `SUBJECT DETAILS provided by the owner: ${detailEntries.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}. Prefer comps that match these attributes where the market offers them, and note in "summary" when the closest available comps differ materially from them.`
    : "";

  // Comps we already pulled for this market in earlier searches. Offered so the
  // model reuses them instead of paying to re-search the web for the same deals.
  const corpusBlock = (corpusComps && corpusComps.length) ? [
    ``,
    `KNOWN RECENT COMPS: our own prior research already surfaced the following ${corpusComps.length === 1 ? "transaction" : "transactions"} in this market. They are already sourced — reuse them rather than re-searching for the same deals.`,
    ...corpusComps.map((c, i) =>
      `${i + 1}. ${c.address} | ${c.transaction || "transaction type unknown"} | ${c.deal_date || "date unknown"} | ${c.size_sqft ? c.size_sqft + " SF" : "size unknown"} | ${c.price_or_rate || "price unknown"}${c.price_per_sqft ? " | " + c.price_per_sqft + "/SF" : ""}${c.cap_rate ? " | cap " + c.cap_rate : ""}${typeSpecsOf(c)}${c.source_url ? " | " + c.source_url : ""}`),
    `Include each one that is genuinely comparable to the target and inside the date window, copying its details faithfully (keep its source_url, and set "source_type" to match where it came from). Use web search only to (a) confirm the target's building size, (b) fill gaps if fewer than ${maxComps} of these are comparable, or (c) surface more recent transactions. When one of these and a fresh web result describe the same deal, keep only one. Set "verified": false on these unless they also appear in the verified list above. Never include one that is clearly in a different city or submarket than the target.`,
  ].join("\n") : "";

  return [
    `You are a commercial real estate analyst. Use web search to find recent comparable transactions.`,
    ``,
    `TARGET PROPERTY:`,
    `- Address: ${address}`,
    `- Property type: ${type}`,
    subjectSizeSqft ? `- Approximate building size: ${subjectSizeSqft.toLocaleString("en-US")} SF` : "",
    note ? `- Market note / radius: ${note}` : `- Market note / radius: (none specified — pick the radius to fit the market; see RADIUS below)`,
    // Calibrate the comp search radius to market density (a user suggestion):
    // "within 5 miles" means something very different in Dallas vs. Boise.
    `RADIUS: Scale how far "comparable" reaches to the market's size and density. In a large, dense metro (e.g. Dallas, Phoenix, Los Angeles), keep comps within the immediate submarket, a few miles out. In a smaller or rural market (e.g. Boise, Pocatello), widen the radius as needed to find enough genuinely comparable transactions, and note in "summary" when you reach beyond the immediate area.${note ? ' Respect the market note above where it specifies where to look.' : ''}`,
    ``,
    `TASK: Find 3 to ${maxComps} RECENT ${
      txFocus === "sales"  ? "comparable closed SALES" :
      txFocus === "leases" ? "comparable LEASE transactions or lease listings" :
                             "comparable sales or lease listings"
    } near this address that match the property type.`,
    `Today's date is ${todayStr}. Comps MUST be dated ${cutoffStr} or later (the last ${months === 1 ? "1 month" : months + " months"}). If you cannot find at least 3 comps inside that window, you may include older comps to reach 3, but you MUST state in "summary" that some comps fall outside the requested ${months}-month window.`,
    txFocus === "sales"  ? `Include ONLY sale transactions — do NOT include lease comps.` :
    txFocus === "leases" ? `Include ONLY lease transactions or active lease listings — do NOT include sale comps.` : "",
    // Thin markets tempt the model into padding the list with market medians
    // dressed up as comps. Those look authoritative, carry no property behind
    // them, and would land in the permanent corpus as fake transactions.
    `EVERY entry in "comps" must be ONE individual property at its own address that actually sold or is actively listed. Never enter a market median, submarket or metro average, research-report benchmark, index, or any other market-level statistic as a comp — market-level figures belong in "summary", "value_drivers", and "market_cap_rate_range" instead. A property whose address is partly withheld is still fine (e.g. "Highland Park Triplex, Pittsburgh, PA 15206"); a row named for a statistic is not. If you cannot find ${maxComps} genuine individual properties, return the smaller number you did find and say so in "summary" — a short honest list is worth more than a padded one.`,
    // The value hero multiplies this number straight into the valuation, so
    // the lookup must not be an afterthought: on corpus-assisted searches the
    // budget is only 3 (searchBudgetFor) and an unordered "also determine..."
    // let comp-hunting consume every search before the subject address was
    // ever looked up. Sequenced FIRST, with the places a size actually lives.
    // The neighbor guard matters: adjacent parcels' sizes surface readily in
    // search results, and a wrong "found" size is worse than an honest "".
    wantsSize
      ? `SUBJECT SIZE (do this FIRST): before searching for comps, spend your first web search on the TARGET address itself to determine its building size in square feet - county assessor or parcel records, a property-detail page (realtor.com, redfin.com, loopnet.com, crexi.com), or a current or past listing of the property. This is the BUILDING square footage, not the lot or land size. The report's entire value range is computed from this number, so finding it is worth a search that might otherwise go to one more comp. If that search and everything you see later genuinely yield no size for this exact address, use "" - do not guess, and never substitute a neighboring or similar property's size.`
      : "",
    typeGuidance[type] || "",
    // Size class moves $/SF (economies of scale) — steer comp selection
    // toward the subject's size band so the valuation range isn't set by
    // buildings of a wholly different scale.
    `SIZE FIT: Prefer comps between roughly half and twice the target building's size${
      subjectSizeSqft
        ? ` (${subjectSizeSqft.toLocaleString("en-US")} SF, so roughly ${Math.round(subjectSizeSqft / 2).toLocaleString("en-US")} to ${(subjectSizeSqft * 2).toLocaleString("en-US")} SF)`
        : ` (once you determine the target's size)`
    } where the market offers them - a small building and a very large one trade at different $/SF. If you must include comps materially larger or smaller to reach 3, keep them, but say so in "summary".`,
    subjectDetailBlock,
    typeSpec
      ? `For EACH comp, also report ${["one", "two", "three"][typeSpec.fields.length - 1]} ${type.toLowerCase()} specific${typeSpec.fields.length > 1 ? "s" : ""}: ${typeSpec.instruction}. Search listing pages, brokerage flyers, and property records for these. If one genuinely can't be found, use an empty string "" — do not guess.`
      : "",
    !isLand
      ? `For EACH comp, also report "tenancy" = who occupies the building and the lease structure, naming the tenant when it is a single-tenant property (e.g. "Single-tenant NNN - Starbucks", "Multi-tenant, 85% occupied", "Owner-user", "Vacant"). Tenant quality moves pricing, so name national or credit tenants specifically when a source shows one. Also report "year_built" = the year the building was constructed as a 4-digit year (e.g. "1998"). If either genuinely can't be found, use an empty string "" — do not guess.`
      : "",
    verifiedBlock,
    corpusBlock,
    ``,
    LANE_GUIDANCE[lane] || "",
    compsOnly ? `` : `Then compute or estimate an average price per square foot across the comps where it makes sense.`,
    `For every SALE comp, report BOTH "price_or_rate" (the total sale price as one number, e.g. "$6,400,000") and "size_sqft", and make "price_per_sqft" exactly equal the sale price divided by the building size, rounded to the nearest dollar, so the figure is verifiable from the row itself. If a source's stated $/SF does not match its own stated price and size, recheck the figures rather than copying the inconsistency. Never put a $/SF figure or a range in "price_or_rate". If the price or the size genuinely cannot be found, leave that field "" instead of guessing.`,
    `Do not use em dashes anywhere in your output text.`,
    ``,
    `OUTPUT FORMAT — return ONLY valid JSON, no markdown, no code fences, no preamble or explanation. Use this exact shape:`,
    `{`,
    // Currency rides in BOTH lanes: a foreign-property records lane must quote
    // its comps in the same local currency, and normalizeCurrency needs the
    // code to avoid silently treating those prices as USD on merge.
    ...(compsOnly ? [] : [`  "summary": "2-3 sentence plain-English takeaway about the local market, understandable to a non-professional - lead with the single thing an owner most needs to know",`]),
    ...(compsOnly ? [] : [`  "avg_price_per_sqft": "string or null",`]),
    `  "currency": "",`,
    `  "usd_rate": "",`,
    ...(compsOnly ? [] : [
      `  "subject_lat": "",`,
      `  "subject_lng": "",`,
      `  "market_cap_rate_range": { "low": "", "high": "" },`,
      ...(!isLand ? [`  "market_opex_range": { "low": "", "high": "", "note": "" },`] : []),
      `  "value_drivers": ["", ""],`,
      `  "market_trend": "",`,
      `  "annual_price_trend_pct": "",`,
      `  "search_radius": "",`,
      `  "transactions_reviewed": "",`,
      `  "price_discovery": { "direction": "", "note": "" },`,
    ]),
    ...(wantsSize ? [`  "subject_size_sqft": "",`, `  "subject_size_source": "",`] : []),
    `  "comps": [`,
    `    ${compShape}`,
    `  ]`,
    `}`,
    ``,
    `Rules: "address" = the comp property's FULL street address ending in its city and two-letter state (e.g. "4521 Maple Ave, Boise, ID") — never a street alone; a bare "4521 Maple Ave" geocodes to the wrong state on the map. "date" = when the sale closed or the lease/listing was signed or posted, as a short month-year like "Mar 2025". "transaction" = exactly "Sale" or "Lease". "source_url" = the URL of the specific web page where you found the comp (listing page, brokerage announcement, news article, or public record); use "" if you are not confident in the exact URL — do not invent one. "subject_lat"/"subject_lng" = the approximate decimal latitude and longitude of the TARGET property address (e.g. "32.7767", "-96.7970") — for plotting on a map, so a street-level approximation is fine; use "" if you cannot place it. If any other field is unknown, use an empty string "" (or null for avg_price_per_sqft). Do NOT wrap the JSON in backticks. Output the JSON object and nothing else.`,
    // "notes" was the single largest field in the output — measured at 18-28%
    // of a report, up to 316 characters per comp — and the report is slow
    // because of how long it takes to WRITE, not to search (see the streaming
    // note in CLAUDE.md). Almost all of that length was padding of two kinds:
    // the model narrating its own search ("Included as the closest listing
    // found; full details require CoStar"), and restating fields that already
    // have their own columns. Cutting both costs the reader nothing. The
    // price caveat is explicitly protected, because that one carries the
    // report's honesty about what a number actually represents.
    `"notes" = at most TWO short sentences, under about 200 characters. This is a table cell, not a paragraph. Include, in this order of priority: (a) any caveat that changes what the price MEANS - asking price rather than a closed sale, price not disclosed, portfolio or partial-interest sale, related-party transfer, distressed or auction sale; (b) the one or two facts that make this property comparable or not - tenant and lease structure, condition or build quality, distance or relation to the target. Then stop.`,
    `Do NOT put in "notes": anything already carried by another field (size, date, price, $/SF, cap rate, clear height, tenancy, year built, zoning) - never restate them; the name of the brokerage or website you found it on (that is what "source_url" and "source_type" are for); or ANY commentary about your own search process. Sentences like "Included as the nearest comparable found", "full transaction details require CoStar or broker access", or "no other listings were available" describe your research, not the property, and must never appear. If a price is not public, the whole caveat is "Price not disclosed."`,
    `"currency" = the ISO 4217 code of the currency ALL prices in this report are quoted in. For a target property in the United States use "USD". For a target property in any other country, quote EVERY price figure (each comp's "price_or_rate" and "price_per_sqft", any type-specific price fields like "price_per_unit" and "price_per_acre", plus "avg_price_per_sqft") in that country's local currency, set "currency" to its code (e.g. "CAD", "MXN", "GBP"), and set "usd_rate" to the current value of 1 unit of that currency in US dollars as a plain number string (e.g. "0.73" for CAD), using the exchange rate your web search finds. When currency is "USD", set "usd_rate" to "". Never mix currencies within one report.`,
    `"source_type" = where you found the comp, exactly one of: "public_record" (a county assessor, deed, or tax record), "listing" (an active or closed listing page, brokerage flyer, or brokerage announcement), "news" (a news article or press release), "estimate" (you could not tie the figures to one specific source). Choose the single best fit; never leave it empty.`,
    ...(compsOnly ? [] : [
    `"market_cap_rate_range" = your best estimate of the going-in capitalization rate range for stabilized ${type} properties in this submarket today, as short percent strings like "5.8%". This is a market-level figure, not a valuation of the target property. Use "" for both values if you cannot estimate it.`,
    ...(!isLand ? [`"market_opex_range" = typical total operating expenses for stabilized ${type} properties in this market, as a percent of effective gross income, as short percent strings like "32%". "note" = a few words naming the lease structure the range assumes (e.g. "assumes NNN, owner keeps roof and structure" or "full-service gross"), since expense ratios depend heavily on it. This is a market-level benchmark for the asset class, not a statement about the target property. Use "" for all three if you cannot estimate it.`] : []),
    `"value_drivers" = 2 to 3 short strings, each ONE concrete factor currently pushing values up or down for ${type} properties in this specific area, drawn from what your searches actually found - name the factor specifically (a vacancy shift, new construction, a rate change, scarcity of a size class), never generic real-estate advice. "market_trend" = one sentence on which direction ${type} sale prices in this area have moved over the search window; use "" if your searches did not show this - do not guess. "annual_price_trend_pct" = the same trend as ONE signed number: your best estimate of the average annual percent change in ${type} SALE prices in this area over the search window, as a plain number string like "-6.5" or "4" (no percent sign). It must agree in direction with "market_trend". Use "" if your searches did not show a clear trend - do not guess.`,
    `"search_radius" = a short phrase (a few words) naming the geographic scope you actually used to gather these comps and whether you widened it, e.g. "Immediate submarket, ~3 miles" or "Widened to ~20 miles, limited local activity". Keep it under about 10 words. Use "" if not applicable.`,
    `"transactions_reviewed" = your rough estimate, as a plain number, of how many recent ${type} transactions you came across in this market and window before narrowing to the most comparable ones above. An approximation is expected (e.g. 34) - it conveys how much market activity you weighed. It must be greater than the number of comps you returned. Use "" if you cannot reasonably estimate it; never invent a large number to look thorough.`,
    `"price_discovery" = a brief read on the market's momentum and its openness to price discovery, that is, whether recent activity suggests the market would support a seller pricing above what recent comps strictly prove. "direction" = exactly one of "expanding", "flat", or "contracting" based on recent momentum. "note" = 1 to 2 plain sentences on how open the market looks to pricing above recent comps and why, framed as an automated read of market conditions, never advice and never a promise about any specific price. Use "" for both if you cannot tell.`,
    ]),
    ...(wantsSize ? [`"subject_size_sqft" = the TARGET property's building size as a plain number string like "25000". Use "" if you cannot determine it from a real source; do not guess. "subject_size_source" = where the size came from, exactly one of: "public_record" (assessor or tax record), "listing" (a listing page or brokerage flyer), "estimate".`] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Safely extract a JSON object from Claude's text output
// ---------------------------------------------------------------------------
function parseCompJson(rawText) {
  let text = (rawText || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  return stripEmDashes(JSON.parse(text));
}

// Site style rule: no em dashes anywhere. The prompt already forbids them,
// but models slip, so scrub every string in the parsed report. Numeric
// ranges become hyphens; prose dashes become commas.
function stripEmDashes(value) {
  if (typeof value === "string") {
    return value
      .replace(/(\d)\s*—\s*(\$?\d)/g, "$1-$2")
      .replace(/\s*—\s*/g, ", ");
  }
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = stripEmDashes(value[k]);
  }
  return value;
}

// source_type drives a trust badge and lands in CSV exports, so stray model
// values are coerced onto the enum. Unknown maps to "estimate": the label may
// under-claim a comp's provenance, never over-claim it.
const SOURCE_TYPES = ["public_record", "listing", "news", "estimate"];
function normalizeSourceTypes(parsed) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  for (const c of parsed.comps) {
    if (!c || typeof c !== "object") continue;
    const raw = String(c.source_type || "").toLowerCase();
    c.source_type =
      SOURCE_TYPES.find((t) => raw === t) ||
      (/record|assessor|deed|tax|county|public/.test(raw) ? "public_record"
        : /list|broker|flyer|loopnet|crexi|costar/.test(raw) ? "listing"
        : /news|article|press|announc/.test(raw) ? "news"
        : "estimate");
    // ENFORCEMENT, not just prompting: the prompt already forbids market-
    // level rows as comps, but in thin markets the model pads anyway (a
    // Boston report shipped "Financial District (general submarket
    // estimate)" rows claiming listing provenance). A comp whose address
    // has no leading street number, or that names a statistic, cannot be
    // one verifiable transaction — force its badge to "estimate" so the
    // report can never present a submarket guess as a sourced deal. Same
    // under-claim principle as above; the Verified badge (broker-matched,
    // separate flag) is unaffected.
    if (c.source_type !== "estimate" &&
        (!/^\s*\d+\s+\S/.test(String(c.address || "")) || isAggregateAddress(c.address))) {
      c.source_type = "estimate";
    }
  }
  return parsed;
}

// currency/usd_rate drive the front-end's convert-to-USD toggle. Coerce to a
// safe pair: unknown/blank currency reads as USD (the pre-feature behavior),
// and a rate that isn't a positive finite number becomes null so the toggle
// simply doesn't render. Rates are sanity-bounded at 10: the strongest real
// currency is ~$3.3/unit, and anything larger is almost certainly an inverted
// rate (units-per-USD, e.g. MXN "18.7" or JPY "155") rather than a genuinely
// strong currency. This is a deliberate asymmetry: a bad rate keeps the
// currency label but drops the toggle (prices really are in that currency;
// relabeling them USD would be worse). usd_rate is left as a JS number (the
// front-end multiplies by it), unlike every other field, which stays a string.
function normalizeCurrency(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const code = String(parsed.currency || "").trim().toUpperCase();
  parsed.currency = /^[A-Z]{3}$/.test(code) ? code : "USD";
  const rate = Number(parsed.usd_rate);
  parsed.usd_rate =
    parsed.currency !== "USD" && Number.isFinite(rate) && rate > 0 && rate < 10
      ? rate
      : null;
  return parsed;
}

// annual_price_trend_pct powers the front-end's time adjustment of older
// comps, so a bad value multiplies straight into the valuation. Coerce to a
// plain number and refuse anything outside +/-30%/yr (almost certainly a
// monthly figure, a whole-window change, or noise) — null simply disables
// the adjustment. Zero also maps to null: no trend means no indexing.
function normalizeTrendPct(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const v = Number(String(parsed.annual_price_trend_pct ?? "").replace(/%/g, "").trim());
  parsed.annual_price_trend_pct =
    Number.isFinite(v) && v !== 0 && Math.abs(v) <= 30 ? v : null;
  return parsed;
}

// ---------------------------------------------------------------------------
// $/SF reconciliation — the model's per-comp price_per_sqft feeds the
// valuation math directly, so verify it against the comp's own stated
// price ÷ size instead of taking it on faith. Fill it when missing, replace
// it when it disagrees with the comp's own figures by more than 10%
// (rounding never trips that; rate-vs-price and order-of-magnitude slips
// blow far past it). All three parsers are strict whole-string matchers on
// the displayMoney philosophy: a value that could mean two things (a range,
// a per-unit rate, a parenthetical) is refused, and refusal always means
// "leave the comp untouched" — never a guessed number.
// ---------------------------------------------------------------------------
const GROUPED_INT = /^\d{1,3}(,\d{3})+$/; // "6,400,000" yes; "12,50" no

function moneyNumberFrom(numStr, suffix) {
  const intPart = numStr.split(".")[0];
  if (intPart.includes(",") && !GROUPED_INT.test(intPart)) return null;
  const n = Number(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[
    (suffix || "").toLowerCase()
  ] || 1;
  return n * mult;
}

// Total sale price: "$6,400,000", "$1.2M", "1.2 million", "850K". Refuses
// ranges (em-dash ranges are already hyphens via stripEmDashes), per-SF
// rates, parentheticals, negatives — anything beyond one plain figure.
function parseSalePrice(s) {
  const m = /^\s*~?\s*(?:US)?\$?\s*([\d,]+(?:\.\d+)?)\s*(mm?|million|k|thousand|b|billion)?\s*\.?\s*$/i
    .exec(String(s || ""));
  return m ? moneyNumberFrom(m[1], m[2]) : null;
}

// Building size: "48,000", "48,000 SF", "48000 sq ft".
function parseSizeSqft(s) {
  const m = /^\s*~?\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s?ft\.?|square\s+feet)?\s*$/i
    .exec(String(s || ""));
  return m ? moneyNumberFrom(m[1], "") : null;
}

// Stated $/SF: "$115", "115.50", "$115/SF". Unparseable reads as missing,
// which is safe — a fill only happens when price AND size parsed cleanly.
function parsePsf(s) {
  const m = /^\s*~?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s?sf)?\s*$/i.exec(String(s || ""));
  return m ? moneyNumberFrom(m[1], "") : null;
}

function reconcilePricePerSqft(parsed) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  // "$" only for USD reports — a foreign report's prices are local currency,
  // and a baked-in "$" would be a false label (must run after normalizeCurrency).
  // Legacy cached payloads may lack the currency field entirely; blank reads
  // as USD, matching normalizeCurrency's own convention.
  const prefix = (parsed.currency || "USD") === "USD" ? "$" : "";
  const fmtPsf = (v) => {
    const r = v >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
    return prefix + r.toLocaleString("en-US");
  };
  for (const c of parsed.comps) {
    try {
      if (!c || typeof c !== "object") continue;
      // Same sale test as the front-end hero: blank transaction counts as sale.
      if (String(c.transaction || "").toLowerCase().startsWith("lease")) continue;
      const price = parseSalePrice(c.price_or_rate);
      const size = parseSizeSqft(c.size_sqft);
      if (price === null || size === null) continue;
      const derived = price / size;
      // Same sane per-SF band the front-end uses for user-added comps.
      if (derived < 1 || derived > 100000) continue;
      const stated = parsePsf(c.price_per_sqft);
      if (stated === null || Math.abs(stated - derived) / derived > 0.10) {
        c.price_per_sqft = fmtPsf(derived);
        c.psf_reconciled = true; // front-end discloses the recompute
      }
    } catch (err) {
      // Never let a malformed comp break the report — leave it untouched.
    }
  }
  return parsed;
}

// Credit the contributing broker on any verified comp the model included, by
// matching its (faithfully-copied) address back to the submitted comp. Closes
// the loop: brokers who feed us data get visible credit in every report.
// Fire-and-forget +1 on each cited submission's cited_count — the broker
// dashboard's "your comp appeared in N reports" line. Read-modify-write is
// fine here: single server instance, and an occasional lost increment costs
// a vanity-counter tick, never data.
async function bumpCitedCounts(ids) {
  if (!DB_CONFIGURED || !ids.length) return;
  try {
    const rows = await sbRequest("GET",
      `comp_submissions?id=in.(${ids.join(",")})&select=id,cited_count`);
    for (const r of rows || []) {
      await sbRequest("PATCH", `comp_submissions?id=eq.${r.id}`,
        { cited_count: (Number(r.cited_count) || 0) + 1 });
    }
  } catch (err) {
    console.error("cited_count bump failed:", err.message);
  }
}

function attachVerifiedAttribution(parsed, verifiedComps) {
  if (!parsed || !Array.isArray(parsed.comps) || !verifiedComps || !verifiedComps.length) return parsed;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const offered = verifiedComps
    .map((v) => ({
      a: norm(v.address),
      by: String(v.broker_company || v.broker_name || "").trim(),
      id: Number(v.id) || null,
      email: String(v.broker_email || "").trim().toLowerCase(),
    }))
    .filter((v) => v.a && v.by);
  if (!offered.length) return parsed;
  const citedIds = new Set(); // two returned comps can match one submission
  for (const c of parsed.comps) {
    if (!c || c.verified !== true) continue;
    const ca = norm(c.address);
    if (!ca) continue;
    // The model copies the address faithfully, so an exact or prefix match
    // (either direction, guarded by length) reliably ties it to the submission.
    const m = offered.find((v) =>
      v.a === ca || (v.a.length >= 8 && ca.length >= 8 && (ca.startsWith(v.a) || v.a.startsWith(ca))));
    if (m) {
      c.verified_by = m.by;
      if (m.id) citedIds.add(m.id);
      // Public profile → the badge becomes a link. Cache holds only
      // public=true rows, so presence implies consent.
      const prof = BROKER_PROFILES.byEmail[m.email];
      if (prof) c.verified_by_slug = prof.slug;
    }
  }
  if (citedIds.size) bumpCitedCounts([...citedIds]).catch(() => {});
  return parsed;
}

// Brokers who have contributed approved comps in a given market ("City, ST"),
// for owner-mediated lead routing. Owner PII is never sent to brokers — the
// owner sees who covers the market and connects them.
async function findBrokersForMarket(market) {
  if (!DB_CONFIGURED || !market) return [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/comp_submissions?status=eq.approved` +
        `&select=broker_name,broker_company,broker_email,broker_phone,address&limit=200`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) return [];
    const rows = await r.json();
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      if (marketOf(row.address) !== market) continue;
      const key = String(row.broker_email || row.broker_name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Call the Anthropic Messages API with web search enabled
// ---------------------------------------------------------------------------
// Ceiling on a single Anthropic call. Raised 100s -> 150s on 2026-07-30: real
// searches were hitting the old ceiling and showing visitors "The search took
// too long", which reads as a broken site rather than a slow one. Writing the
// report alone is 40-70s (see the streaming note in CLAUDE.md), so 100s left
// almost no margin for a busy market.
// This is safe to raise ONLY because STREAM_IDLE_MS below fails a wedged
// upstream in 30s regardless — so the full 150s can now elapse only while the
// model is genuinely still producing output, never on a hang. The SSE
// heartbeat (openSse) keeps the browser connection alive across it.
// Note the ceiling is per CALL, and solo() retries once on a parse failure, so
// the true worst case a visitor can wait is about double this.
const SEARCH_TIMEOUT_MS = 150_000;
// No chunk at all for this long means a wedged upstream. Streaming is what
// makes an idle timeout possible in the first place (the non-streaming call
// has nothing to measure between "sent" and "done"), so take it.
const STREAM_IDLE_MS = 30_000;
// Escape hatch. Streaming changes nothing the caller sees — same parsed report,
// same timing log — so this exists only to rule it out if something odd shows up.
const STREAM_ANTHROPIC = !/^(0|off|false|no)$/i.test(String(process.env.STREAM_ANTHROPIC || "on"));

// ---------------------------------------------------------------------------
// Minimal SSE frame reader. Anthropic sends `event: <name>\ndata: <json>\n\n`;
// the data JSON repeats the event name in its own `type`, so we switch on that
// and ignore the event line. Yields one parsed object per frame.
// ---------------------------------------------------------------------------
async function* sseFrames(body, onIdleTimeout) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    // One watchdog per read, always cleared — an uncleared timer per chunk would
    // pile up thousands of pending timeouts over a long stream.
    let idleTimer;
    const idle = new Promise((_, rej) => { idleTimer = setTimeout(() => rej(new Error("__idle__")), STREAM_IDLE_MS); });
    let chunk;
    try {
      chunk = await Promise.race([reader.read(), idle]);
    } catch (e) {
      if (e && e.message === "__idle__") { try { await reader.cancel(); } catch (_) {} onIdleTimeout(); }
      throw e;
    } finally {
      clearTimeout(idleTimer);
    }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      // SSE allows a frame's data to span several `data:` lines; comments start with ':'.
      const data = frame.split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      try { yield JSON.parse(data); } catch (_) { /* a partial/garbled frame is not fatal */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Incremental comp extractor for live progress. Watches the streamed report
// text for the "comps" array and emits each comp object the moment its closing
// brace arrives — that is what lets the loading card list comps while the
// model is still writing the rest of the report. Purely additive: the
// authoritative report is still parseCompJson over the full joined text, so a
// bug here can only cost a progress line, never the report.
// Single pass — each character is scanned exactly once (pos never moves back);
// the only lookback is an 8-char overlap so the `"comps"` key can arrive split
// across two deltas. String/escape aware, so braces inside "notes" text or
// escaped quotes never confuse the depth count. A comp element that fails
// JSON.parse is skipped silently.
// ---------------------------------------------------------------------------
function makeCompExtractor(onComp) {
  let buf = "", pos = 0, mode = "seek", keyAt = -1;
  let depth = 0, inString = false, escaped = false, elemStart = -1, n = 0;
  return {
    push(deltaText) {
      if (mode === "done" || typeof deltaText !== "string" || !deltaText) return;
      if (mode === "seek") {
        const searchFrom = Math.max(0, buf.length - 8);
        buf += deltaText;
        if (keyAt === -1) {
          keyAt = buf.indexOf('"comps"', searchFrom);
          if (keyAt === -1) return;
        }
        // Only ':' and whitespace sit between the key and its array in valid
        // JSON, so the first '[' after the key is the array opener.
        const br = buf.indexOf("[", keyAt + 7);
        if (br === -1) return;
        mode = "array";
        pos = br + 1;
      } else {
        buf += deltaText;
      }
      for (; pos < buf.length; pos++) {
        const ch = buf[pos];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
        } else if (ch === '"') {
          inString = true;
        } else if (ch === "{") {
          if (depth === 0) elemStart = pos;
          depth++;
        } else if (ch === "}") {
          if (depth > 0) depth--;
          if (depth === 0 && elemStart !== -1) {
            try { onComp(JSON.parse(buf.slice(elemStart, pos + 1)), ++n); } catch (_) {}
            elemStart = -1;
          }
        } else if (ch === "]" && depth === 0) {
          mode = "done";
          buf = "";
          return;
        }
      }
    },
  };
}

async function callAnthropicOnce(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpus, subjectDetails, lane = "solo", maxUses = null, onProgress = null) {
  const body = {
    model: MODEL,
    // Shared budget for the WHOLE call — up to 8 rounds of web-search tool
    // text plus the final JSON. The per-comp schema has grown (clear_height/
    // dock_doors, tenancy, year_built, per-comp notes), so 3200 could
    // get cut off mid-array on a busy 8-comp Industrial report. Billing is by
    // actual tokens generated, not this cap, so raising it costs nothing on
    // the (much more common) shorter reports — and leaving it high is what
    // keeps the notes cap a QUALITY instruction rather than a hard truncation
    // that could sever the JSON mid-array.
    // A 10-12 comp report is a third longer than the 8-comp JSON this was
    // sized for — give it headroom so the closing brace never gets cut off.
    max_tokens: maxComps > 8 ? 10000 : 8000,
    // The subject-size lookup gets two extra searches so it doesn't crowd out
    // the comp searches themselves. When we already hold recent comps for this
    // market (corpus-strong), the budget drops hard — that reuse is the saving.
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses == null ? searchBudgetFor(corpus, subjectSizeSqft, maxComps) : maxUses }],
    // The web_search loop re-runs model inference on EVERY round — one per
    // search plus the final report — and each round re-reads this whole prompt
    // at full input price. Measured at ~3,300 tokens, an 8-search report paid
    // for it nine times over. cache_control makes rounds 2..N read it at ~0.1x.
    // It works because caching is a PREFIX match and the prompt is byte-
    // identical across a request's rounds: only the search results appended
    // AFTER it grow. Sonnet's minimum cacheable prefix is 1,024 tokens and this
    // prompt is ~3x that, so it always qualifies — but a future prompt trim
    // that took it under 1,024 would silently stop caching, with no error.
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpus && corpus.comps, subjectDetails, lane),
        cache_control: { type: "ephemeral" },
      }],
    }],
  };

  if (STREAM_ANTHROPIC) body.stream = true;
  const say = typeof onProgress === "function" ? onProgress : () => {};

  // Live comp lines for the loading card. Only calls that report progress get
  // one (the records lane never does), and any throw disables it for the rest
  // of the call — the report itself never depends on the extractor.
  let compExtractor = (typeof onProgress === "function" && lane !== "records")
    ? makeCompExtractor((c, n) => say({
        phase: "comp", n,
        address: String((c && c.address) || ""),
        price: String((c && (c.price_or_rate || c.price_per_sqft)) || ""),
      }))
    : null;

  const startedAt = Date.now();
  const controller = new AbortController();
  // NOTE: with stream:true, fetch() resolves at the HEADERS — so this timer must
  // NOT be cleared right after the await, or the whole read loop would run
  // unguarded and a wedged upstream would hang forever. It is cleared in the
  // finally that wraps the reading, further down.
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const timedOut = () => new Error("The search took too long and was stopped. Please try again.");
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") throw timedOut();
    throw err;
  }

  if (!r.ok) {
    clearTimeout(timer);
    let detail = "";
    try { detail = (await r.json())?.error?.message || ""; } catch (_) {}
    throw new Error(`Anthropic API error (${r.status}). ${detail}`.trim());
  }

  let text = "";
  let searches = 0;
  let usage = {};
  let stopReason = "";

  if (!STREAM_ANTHROPIC) {
    clearTimeout(timer);
    const data = await r.json();
    searches = (data.content || []).filter((b) => b.type === "server_tool_use").length;
    usage = data.usage || {};
    stopReason = data.stop_reason;
    // Web search responses contain multiple block types — keep ONLY text blocks.
    text = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  } else {
    // Rebuild exactly what the non-streaming branch above produces: the text
    // blocks, in index order, joined with "\n" and trimmed. Anything else and
    // parseCompJson starts seeing different input.
    const blocks = new Map();       // index -> { type, text, json }
    let wroteWriting = false;
    let lastDraft = 0;
    let textChars = 0;
    try {
      for await (const ev of sseFrames(r.body, () => controller.abort())) {
        if (ev.type === "error") {
          throw new Error(`Anthropic stream error: ${(ev.error && ev.error.message) || "unknown"}`);
        }
        if (ev.type === "message_start") {
          usage = (ev.message && ev.message.usage) || {};
          say({ phase: "start" });
        } else if (ev.type === "content_block_start") {
          const cb = ev.content_block || {};
          blocks.set(ev.index, { type: cb.type, text: "", json: "" });
          if (cb.type === "web_search_tool_result") {
            say({ phase: "results", n: searches, count: Array.isArray(cb.content) ? cb.content.length : null });
          }
        } else if (ev.type === "content_block_delta") {
          const b = blocks.get(ev.index);
          const d = ev.delta || {};
          if (!b) continue;
          // citations_delta also arrives on text blocks and carries no .text —
          // never let it fall through into the text branch.
          if (d.type === "text_delta" && typeof d.text === "string") {
            b.text += d.text;
            textChars += d.text.length;
            if (compExtractor) {
              try { compExtractor.push(d.text); } catch (_) { compExtractor = null; }
            }
            // Writing the report is the LONG stretch — measured, searches finish
            // in ~5s and the JSON burst then runs 60-70s. It must be detected as
            // it STARTS, not at content_block_stop (which is after the report is
            // already written and useless as progress). Match the opening brace
            // ANYWHERE in the block, not at its start: the model prefaces the
            // JSON with narration, which is exactly why parseCompJson has to
            // slice to the first "{" too.
            if (!wroteWriting && b.text.includes("{")) {
              wroteWriting = true;
              say({ phase: "writing" });
            }
            // Throttled heartbeat through the burst so the bar creeps instead of
            // sitting dead for a minute. Output runs ~78 tokens/sec (~4 chars a
            // token), which is what lets the client turn chars into a fraction.
            if (Date.now() - lastDraft > 900) {
              lastDraft = Date.now();
              say({ phase: "drafting", chars: textChars, writing: wroteWriting });
            }
          } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") b.json += d.partial_json;
        } else if (ev.type === "content_block_stop") {
          const b = blocks.get(ev.index);
          if (b && b.type === "server_tool_use") {
            searches += 1;
            let query = "";
            // The query only exists once the block is complete — content_block_start
            // carries input:{}. A truncated stream would throw here, and a raw
            // SyntaxError would make solo() think the REPORT failed to parse and
            // silently re-bill an entire search. Swallow it.
            try { query = String((JSON.parse(b.json || "{}") || {}).query || ""); } catch (_) {}
            say({ phase: "search", n: searches, query });
          }
        } else if (ev.type === "message_delta") {
          stopReason = (ev.delta && ev.delta.stop_reason) || stopReason;
          if (ev.usage) usage = { ...usage, ...ev.usage };
        }
      }
    } catch (err) {
      if ((err && err.name === "AbortError") || (err && err.message === "__idle__")) throw timedOut();
      throw err;
    } finally {
      clearTimeout(timer);
    }
    text = [...blocks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, b]) => b)
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  // Timing/usage line. Generation time scales with output_tokens, search time
  // with the number of web_search round-trips — logging both is what tells you
  // which half of a slow report to attack.
  // cache read/write is how you tell prompt caching is actually working: read
  // should land near (rounds - 1) x the prompt size. A run that logs 0 read AND
  // 0 write is a silent miss — the usual cause is the prompt slipping under the
  // 1,024-token cacheable minimum, which raises no error.
  console.log(`Anthropic call [${lane}]: ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${searches} search(es) · ${usage.output_tokens || 0} out / ${usage.input_tokens || 0} in tokens · cache ${usage.cache_read_input_tokens || 0} read / ${usage.cache_creation_input_tokens || 0} write · stop=${stopReason}`);

  if (!text) throw new Error("The model returned no text content to parse.");

  const parsed = reconcilePricePerSqft(normalizeTrendPct(normalizeCurrency(normalizeSourceTypes(parseCompJson(text)))));
  return attachVerifiedAttribution(parsed, verifiedComps);
}

// Fold the records lane's comps into the primary lane's report. The primary
// object IS the report — every market-level figure and all narrative stay
// exactly as that lane wrote them — so this only ever touches "comps" and the
// subject size the records lane was asked to look up.
function mergeLaneReports(primary, records, maxComps) {
  if (!records || !Array.isArray(records.comps) || !records.comps.length) return primary;

  // A foreign-property report quotes local currency. If the lanes somehow
  // disagree, the records prices cannot be trusted as the same unit — drop
  // them rather than merge two currencies into one table.
  if (String(records.currency || "USD") !== String(primary.currency || "USD")) {
    console.warn(`Lane merge: currency mismatch (${primary.currency} vs ${records.currency}) — records comps dropped.`);
    return primary;
  }

  const key = (c) => String((c && c.address) || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set((primary.comps || []).map(key).filter(Boolean));
  const fresh = records.comps.filter((c) => {
    const k = key(c);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Interleave rather than append. The comp list gets sliced to maxComps, and
  // appending would let a listing-heavy primary lane crowd out every public
  // record — the provenance mix is the point of splitting by source.
  const a = primary.comps || [];
  const merged = [];
  for (let i = 0; i < Math.max(a.length, fresh.length); i++) {
    if (i < a.length) merged.push(a[i]);
    if (i < fresh.length) merged.push(fresh[i]);
  }
  // The user picked the comp count, so honour it — the two lanes are asked for
  // a cushion each precisely so this slice has something to choose from.
  primary.comps = merged.slice(0, maxComps);

  // The records lane owns the subject-size lookup (assessor data is where SF
  // lives), so its answer is the only one — but never overwrite a real size
  // with a blank if the lane came back empty.
  if (records.subject_size_sqft && !primary.subject_size_sqft) {
    primary.subject_size_sqft = records.subject_size_sqft;
    primary.subject_size_source = records.subject_size_source || "";
  }

  console.log(`Lane merge: ${a.length} listing-lane + ${fresh.length} records-lane comp(s), ${records.comps.length - fresh.length} duplicate(s) dropped, ${primary.comps.length} kept.`);
  return primary;
}

async function getComps(address, type, note, months, maxComps, txFocus, subjectSizeSqft, verifiedComps, corpus = { comps: [], coverage: 0, fresh: false }, subjectDetails = {}, onProgress = null) {
  if (verifiedComps.length) {
    console.log(`Offering ${verifiedComps.length} verified comp(s) to the model for ${type}.`);
  }

  // Two-lane parallel search (see LANE_GUIDANCE). Same total web searches as a
  // single call, but half the serial depth — and because context grows
  // quadratically with round count, materially fewer input tokens too.
  const budget = searchBudgetFor(corpus, subjectSizeSqft, maxComps);
  if (PARALLEL_SEARCH && budget >= SPLIT_MIN_BUDGET) {
    const perLane = Math.ceil(budget / 2);
    const laneComps = laneCompsFor(maxComps);
    console.log(`Two-lane search: ${perLane} search(es) x 2 lanes, ${laneComps} comps asked per lane.`);

    // Verified and corpus comps go to the primary lane only: it owns the
    // report, and offering the same known deals to both lanes would just buy
    // duplicates the merge has to throw away.
    // Progress rides the PRIMARY lane only. Two concurrent streams would
    // interleave and double-count the search numbers the bar advances on.
    const primaryCall = solo((attempt) => callAnthropicOnce(address, type, note, months, laneComps, txFocus, verifiedComps, subjectSizeSqft, corpus, subjectDetails, "primary", perLane, progressFor(onProgress, attempt)), onProgress);
    const recordsCall = callAnthropicOnce(address, type, note, months, laneComps, txFocus, [], subjectSizeSqft, { comps: [] }, subjectDetails, "records", perLane)
      .catch((err) => {
        // The records lane is additive. Losing it costs comps and provenance
        // mix, never the report — no retry, since retrying serially here would
        // spend the very wall clock the split exists to save.
        console.warn("Records lane failed; continuing with listing lane only.", err.message);
        return null;
      });

    const [primary, records] = await Promise.all([primaryCall, recordsCall]);
    return mergeLaneReports(primary, records, maxComps);
  }

  return solo((attempt) => callAnthropicOnce(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpus, subjectDetails, "solo", null, progressFor(onProgress, attempt)), onProgress);
}

// Stamps every progress event with which attempt produced it, so the client can
// tell a fresh search from solo()'s silent retry and hold the bar instead of
// snapping it backwards.
function progressFor(onProgress, attempt) {
  if (typeof onProgress !== "function") return null;
  return (evt) => onProgress({ ...evt, attempt });
}

// The model occasionally wraps the JSON in stray text, or truncates it on a
// long busy report; one silent retry resolves most of those instead of
// surfacing a parse error to the user. If the retry ALSO fails to parse,
// never leak the raw JSON.parse error text to the client — it's meaningless
// to a visitor and reads like a broken site rather than a one-off hiccup.
async function solo(call, onProgress = null) {
  try {
    return await call(1);
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn("Comp JSON failed to parse; retrying once.", err.message);
      if (typeof onProgress === "function") onProgress({ phase: "retry", attempt: 2 });
      try {
        return await call(2);
      } catch (err2) {
        if (err2 instanceof SyntaxError) {
          console.warn("Comp JSON failed to parse on retry too; giving up.", err2.message);
          throw new Error("The search came back in an unexpected format. Please try again.");
        }
        throw err2;
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Server-Sent Events for the search progress bar. Opened only once we know we
// are about to do the slow thing, so every fast/failure path above it keeps
// answering plain JSON with a real status code.
// ---------------------------------------------------------------------------
function openSse(res) {
  let closed = false;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    // Render (and nginx generally) will otherwise buffer the whole response and
    // deliver it in one burst at the end, which looks exactly like no streaming.
    "x-accel-buffering": "no",
  });
  // Flush the headers immediately, and pad past any proxy buffer threshold.
  res.write(":" + " ".repeat(2048) + "\n\n");

  const send = (event, data) => {
    if (closed) return;
    // JSON.stringify escapes newlines, so any payload is always one data: line.
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { closed = true; }
  };
  // The final JSON burst is a long quiet stretch, and solo()'s retry can be
  // silent for a whole minute; intermediaries drop idle connections well before
  // that.
  const beat = setInterval(() => send("ping", {}), 15_000);
  const stop = () => { clearInterval(beat); };

  // If the visitor navigates away we stop writing, but deliberately do NOT
  // abort the upstream Anthropic call — it is already paid for, so let it land
  // in the cache and the corpus.
  res.on("close", () => { closed = true; stop(); });

  return {
    send,
    finish(event, data) { send(event, data); stop(); if (!closed) { closed = true; res.end(); } },
  };
}

// ---------------------------------------------------------------------------
// Market landing pages — server-rendered, self-contained HTML (own inline CSS
// so they don't depend on the purged tailwind.css). Real market data + a
// valuation CTA, built for search intent like "industrial values in <city>".
// ---------------------------------------------------------------------------
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function marketTitle(p) { return `${p.type} Property Values in ${p.city}, ${p.state}`; }
function marketUrl(slug) { return `${SITE_URL}/market/${slug}`; }
function usd0(n) { return "$" + Math.round(Number(n) || 0).toLocaleString(); }

// Brand mark, shared by every server-rendered page (market pages, /markets,
// /broker, /how-it-works, /admin). Declared HERE, above MARKET_BAR: that
// constant is built at module load, so a logo defined further down the file
// would still be in its temporal dead zone and crash the process at startup.
const CN_LOGO =
  `<svg viewBox="0 0 30 30" aria-hidden="true">` +
  `<rect x="2" y="4" width="26" height="22" rx="2" fill="#1A2433"/>` +
  `<polygon points="3.5,26 28,5.5 28,10 8,26" fill="#B91C1C"/></svg>`;
// Same mark inverted for the ink footer.
const CN_LOGO_LIGHT =
  `<svg viewBox="0 0 30 30" aria-hidden="true">` +
  `<rect x="2" y="4" width="26" height="22" rx="2" fill="#FFFFFF"/>` +
  `<polygon points="3.5,26 28,5.5 28,10 8,26" fill="#B91C1C"/></svg>`;

// Research Desk system — the same palette and type as the landing page and
// /how-it-works, so a visitor arriving from search lands on something that
// looks like the app they are being sent to. Self-contained by design: no
// dependency on the purged tailwind.css.
const MARKET_CSS = `
*{box-sizing:border-box}
/* Flex column so the ink footer sits at the bottom of a short page. */
body{margin:0;background:#FBFBF9;color:#1A2433;line-height:1.6;min-height:100vh;display:flex;flex-direction:column;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:#B91C1C;text-decoration:none}a:hover{color:#991B1B}
.wrap{max-width:1024px;margin:0 auto;padding:0 16px;width:100%}
main.wrap{flex:1;padding-top:32px;padding-bottom:64px}
/* Header — mirrors index.html's bar so arriving from search feels continuous. */
.hdr{border-bottom:1px solid #E4E2DA;background:#FBFBF9}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:10px;padding-top:16px;padding-bottom:16px}
.brand{display:flex;align-items:center;gap:10px;color:#1A2433}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#1A2433}
.wordmark b{color:#B91C1C;font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;font-size:13.5px}
.hdr nav a{color:#5A6473;white-space:nowrap}.hdr nav a:hover{color:#1A2433}
/* Explore dropdown — mirrors index.html's header menu, as a no-JS <details>
   (a tiny script in MARKET_BAR adds close-on-outside-click). */
.hdr nav details{position:relative}
.hdr nav summary{list-style:none;cursor:pointer;color:#5A6473;white-space:nowrap;user-select:none}
.hdr nav summary::-webkit-details-marker{display:none}
.hdr nav summary:hover,.hdr nav details[open] summary{color:#1A2433}
.hdr nav summary .car{display:inline-block;font-size:9px;margin-left:3px;color:#8A93A0}
.hdr nav .dd{position:absolute;right:0;top:calc(100% + 10px);z-index:1100;background:#fff;
  border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);
  padding:4px 0;min-width:176px}
.hdr nav .dd a{display:block;padding:8px 12px;color:#374253}
.hdr nav .dd a:hover{background:#F8FAFC;color:#1A2433}
.hdr nav .dd a.on{color:#1A2433;font-weight:500}
/* Type */
h1{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:28px;line-height:1.15;
  letter-spacing:-.005em;color:#1A2433;margin:10px 0 6px}
.sub{color:#5A6473;font-size:14px;margin:0 0 22px;max-width:70ch}
.sub a{color:#5A6473;text-decoration:underline;text-decoration-color:#D8D4C9}
.sub a:hover{color:#1A2433}
/* Tiles — bordered cards rather than the landing page's hairline mesh: pages
   render 2-4 of these depending on the data, so a fixed column count that
   divides evenly (which the mesh needs to avoid a half-empty row) is out. */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:22px 0}
.tile{background:#fff;border:1px solid #E4E2DA;border-radius:6px;padding:16px 18px}
.tile .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:#8A93A0;font-weight:600}
.tile .v{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:25px;line-height:1.2;margin-top:4px;
  color:#1A2433;font-variant-numeric:tabular-nums}
.tile .n{font-size:12.5px;color:#8A93A0;margin-top:2px}
/* Cards. Headings stay serif at reading size rather than the uppercase
   micro-label used elsewhere — these are sentence-length ("What's driving
   Industrial prices in Ontario"), which uppercase 10px would make unreadable. */
.card{background:#fff;border:1px solid #D8D4C9;border-radius:6px;padding:22px;margin:18px 0}
.card h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:19px;color:#1A2433;
  margin:0 0 12px;letter-spacing:normal;text-transform:none}
.card h3{font-size:14.5px;font-weight:600;color:#1A2433;margin:16px 0 4px}
.card p{margin:0 0 10px;color:#374253;font-size:14.5px}
.card ul{margin:8px 0 0;padding-left:20px}.card li{margin:6px 0;color:#374253;font-size:14.5px}
/* min-width is what makes the .scroll wrapper actually work: a width:100%
   table always shrinks to its container, so overflow-x had nothing to overflow.
   Invisible at 6 columns; a multifamily page renders 8 and would otherwise
   crush to ~40px per column on a phone. */
table{width:100%;min-width:640px;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
td:first-child,th:first-child{min-width:180px}
th{background:#F5F4EF;color:#8A93A0;text-align:left;padding:9px 10px;font-weight:600;font-size:10.5px;
  text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid #D8D4C9}
td{padding:10px;border-top:1px solid #F0EFE9;color:#374253;vertical-align:top}
.scroll{overflow-x:auto;border:1px solid #E4E2DA;border-radius:6px;margin:18px 0;background:#fff}
/* Source badges use the report's own colour language: green Verified, amber
   Listing, neutral for public record / news / estimate. */
.badge{display:inline-block;font-size:10.5px;font-weight:600;border-radius:3px;padding:1.5px 7px;
  white-space:nowrap;line-height:1.4;color:#46536A;background:#EAEEF4}
.badge.v{color:#06603A;background:#E3F2EA}
.badge.li{color:#7A5B12;background:#F7EFDC}
/* CTA — the calm bordered block from the landing page, not the old gradient. */
.cta{border:1px solid #D8D4C9;background:#fff;border-radius:6px;padding:28px;margin:26px 0;text-align:center}
.cta h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:22px;color:#1A2433;
  margin:0 0 8px;letter-spacing:normal;text-transform:none}
.cta p{color:#4C5665;font-size:14px;margin:8px auto 20px;max-width:52ch}
.cta .alt{display:inline-block;margin-top:14px;font-size:13.5px;color:#5A6473;text-decoration:underline;text-decoration-color:#D8D4C9}
.cta .alt:hover{color:#1A2433}
.btn{display:inline-block;background:#B91C1C;color:#fff;font-weight:600;padding:11px 26px;border-radius:4px;font-size:14.5px}
.btn:hover{background:#991B1B;color:#fff}
.related{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.related a{background:#fff;border:1px solid #D8D4C9;border-radius:4px;padding:6px 14px;font-size:13px;color:#374253}
.related a:hover{border-color:#8A93A0;color:#1A2433}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:20px}
.mcard{display:block;background:#fff;border:1px solid #D8D4C9;border-radius:6px;padding:18px 20px;color:inherit}
.mcard:hover{border-color:#8A93A0}
.mcard .t{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:17px;color:#1A2433}
.mcard .s{color:#5A6473;font-size:13px;margin-top:6px;font-variant-numeric:tabular-nums}
.disc{color:#8A93A0;font-size:12.5px;margin-top:26px}
/* Footer — the navy ink footer from the home page. */
footer{background:#1A2433;color:#B8C0CC;font-size:13px}
footer .wrap{padding:36px 16px;display:flex;flex-direction:column;justify-content:space-between;gap:28px}
footer .wordmark{color:#fff}
footer p{color:#8F99A8;margin:12px 0 0;max-width:68ch;line-height:1.6}
footer a{color:#D5DAE2;text-decoration:underline;text-decoration-color:#46536A}
footer a:hover{color:#fff}
footer ul{list-style:none;margin:12px 0 0;padding:0}
footer li{margin-bottom:8px}
footer li a{text-decoration:none;color:#B8C0CC}
@media (min-width:640px){
  .hdr nav{gap:24px}
  h1{font-size:34px}
  footer .wrap{flex-direction:row}
  footer .right{text-align:right;flex-shrink:0}
}
`;

const MARKET_BAR =
  `<header class="hdr"><div class="wrap">` +
  `<a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>` +
  `<nav><details><summary>Explore<span class="car">▾</span></summary>` +
  `<div class="dd"><a href="/markets">Markets</a><a href="/brokers">Brokers</a>` +
  `<a href="/how-it-works">How it works</a></div></details>` +
  `<a href="/">Run a report</a></nav>` +
  `</div></header>` +
  // Close the dropdown when the visitor clicks anywhere else (scoped to the
  // header nav so it can never touch other <details> on a page, e.g. FAQs).
  `<script>document.addEventListener("click",function(e){` +
  `document.querySelectorAll(".hdr nav details[open]").forEach(function(d){` +
  `if(!d.contains(e.target))d.open=false;});});</script>`;

// ---------------------------------------------------------------------------
// Public broker credit — which firms have approved comps in each market, so
// market pages can credit contributors (the visible payoff of the broker
// loop). Cached in-process with stale-while-revalidate so pages keep serving
// synchronously with no per-request DB call; empty when Supabase is
// unconfigured, so the credit line simply never renders. Only the display
// name (firm or broker name — the same string already public as verified_by
// in reports) is ever exposed; never email or phone.
// ---------------------------------------------------------------------------
const MARKET_CREDIT = { byMarket: {}, fetchedAt: 0, refreshing: false };
const MARKET_CREDIT_TTL_MS = 10 * 60 * 1000;
async function refreshMarketCredit() {
  if (!DB_CONFIGURED || MARKET_CREDIT.refreshing) return;
  MARKET_CREDIT.refreshing = true;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/comp_submissions?status=eq.approved` +
      `&select=broker_name,broker_company,address&order=ts.desc&limit=500`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) throw new Error(`Supabase read failed (${r.status}).`);
    const byMarket = {};
    for (const row of await r.json()) {
      const market = marketOf(row.address).toLowerCase();
      const name = String(row.broker_company || row.broker_name || "").trim();
      if (!market || !name) continue;
      if (!byMarket[market]) byMarket[market] = [];
      if (!byMarket[market].includes(name)) byMarket[market].push(name);
    }
    MARKET_CREDIT.byMarket = byMarket;
    MARKET_CREDIT.fetchedAt = Date.now();
  } catch (err) {
    console.error("Market credit refresh failed; keeping previous:", err.message);
  } finally {
    MARKET_CREDIT.refreshing = false;
  }
}

// ---------------------------------------------------------------------------
// Broker profiles — opt-in public pages (/broker/<slug>) for verified
// contributors, the visibility currency of the broker loop. Cached in-process
// like MARKET_CREDIT (public rows only); the page itself shows name/firm and
// contribution stats ONLY — never email or phone. Contact is owner-mediated.
// ---------------------------------------------------------------------------
const BROKER_PROFILES = { byEmail: {}, bySlug: {}, fetchedAt: 0, refreshing: false };
const BROKER_PROFILES_TTL_MS = 10 * 60 * 1000;
async function refreshBrokerProfiles() {
  if (!DB_CONFIGURED || BROKER_PROFILES.refreshing) return;
  BROKER_PROFILES.refreshing = true;
  try {
    const rows = await sbRequest("GET",
      "broker_profiles?public=eq.true&select=email,slug,display_name,company&limit=500");
    const byEmail = {}, bySlug = {};
    for (const p of rows || []) {
      const email = String(p.email || "").toLowerCase();
      if (!email || !p.slug) continue;
      byEmail[email] = p;
      bySlug[p.slug] = p;
    }
    BROKER_PROFILES.byEmail = byEmail;
    BROKER_PROFILES.bySlug = bySlug;
    BROKER_PROFILES.fetchedAt = Date.now();
  } catch (err) {
    console.error("Broker profile refresh failed; keeping previous:", err.message);
  } finally {
    BROKER_PROFILES.refreshing = false;
  }
}

// Same char rules as the market-page slugs; source is firm-first.
function brokerSlugOf(company, name) {
  let s = String(company || name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (s.length < 3) s = ("broker-" + s).replace(/-$/, ""); // route regex needs >=3 chars
  return s.slice(0, 60);
}

// All submissions for one broker email (lowercased match on both sides).
// Fetch-then-filter like findBrokersForMarket — PostgREST ilike would treat
// "_" in emails as a wildcard. Powers the dashboard and the public page.
async function fetchSubmissionsForEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return [];
  let rows = [];
  if (DB_CONFIGURED) {
    try {
      rows = await sbRequest("GET",
        "comp_submissions?order=ts.desc&limit=500" +
        "&select=id,ts,status,broker_email,broker_name,broker_company,address," +
        "property_type,transaction,deal_date,price_or_rate,cited_count") || [];
    } catch (err) {
      console.error("Submission fetch for broker failed:", err.message);
      rows = [];
    }
  } else {
    rows = await readRowsFromFile(COMP_SUBMISSIONS_FILE);
  }
  return rows.filter((r) => String(r.broker_email || "").trim().toLowerCase() === target);
}

function renderBrokerProfileHTML(profile, subs) {
  const display = String(profile.display_name || "").trim() || "Verified contributor";
  const firm = String(profile.company || "").trim();
  const headline = firm || display;
  const approved = subs.filter((s) => s.status === "approved");
  const citations = approved.reduce((n, s) => n + (Number(s.cited_count) || 0), 0);
  const markets = [...new Set(approved.map((s) => marketOf(s.address)).filter(Boolean))];
  const canonical = `${SITE_URL}/broker/${profile.slug}`;
  const title = `${headline} · Verified Comp Contributor | CompNinja`;
  const description = `${headline} contributes broker-verified commercial comp data to CompNinja` +
    (markets.length ? ` in ${markets.slice(0, 3).join("; ")}` : "") +
    ". Every comp is reviewed before it appears in a report.";

  const tiles = [
    ["Verified comps", String(approved.length), "approved by our review team"],
    ["Report citations", String(citations), "times used in valuation reports"],
    ["Markets", String(markets.length || 1), "metro areas covered"],
  ].map(([k, v, n]) =>
    `<div class="tile"><div class="k">${escHtml(k)}</div><div class="v">${escHtml(v)}</div><div class="n">${escHtml(n)}</div></div>`).join("");

  const marketChips = markets.map((m) => {
    const [city, state] = m.split(",").map((s) => s.trim());
    const types = [...new Set(approved.filter((s) => marketOf(s.address) === m).map((s) => s.property_type).filter(Boolean))];
    const linked = city && state && types
      .map((t) => ({ t, slug: slugifyMarket(t, city, state) }))
      .find((x) => getMarketPage(x.slug));
    return linked
      ? `<a href="/market/${linked.slug}">${escHtml(m)}</a>`
      : `<span class="badge">${escHtml(m)}</span>`;
  }).join("");

  const introHref = `mailto:${LEAD_NOTIFY_EMAIL}?subject=${encodeURIComponent(`Broker introduction: ${headline}`)}`;
  const body =
    `<h1>${escHtml(headline)}</h1>` +
    `<p class="sub">Verified comp contributor${firm && display && display !== firm ? " · " + escHtml(display) : ""}: ` +
    `every comp below the green badge was submitted by this contributor and hand-reviewed by CompNinja.</p>` +
    `<div class="tiles">${tiles}</div>` +
    (marketChips ? `<div class="card"><h2>Markets contributed to</h2><div class="related">${marketChips}</div></div>` : "") +
    `<div class="card"><h2>What &quot;Verified&quot; means</h2>` +
    `<p>Comps carrying a <strong>Verified · via ${escHtml(headline)}</strong> badge were submitted by this contributor ` +
    `and reviewed by our team before joining the comp layer, the highest provenance tier in a CompNinja report.</p></div>` +
    `<div class="cta"><h2>Work with ${escHtml(headline)}</h2>` +
    `<p>CompNinja connects property owners with the brokers who know their market. Introductions go through our team.</p>` +
    `<a class="btn" href="${introHref}">Request an introduction</a>` +
    `<p style="margin:0"><a class="alt" href="/">Or run a free valuation of your building &rarr;</a></p></div>` +
    `<p class="disc">CompNinja is not a licensed brokerage; introductions are made by our team. Stats update as new reports run.</p>`;

  return marketShell({
    title, description, canonical, body,
    jsonLd: JSON.stringify({ "@context": "https://schema.org", "@type": "ProfilePage", name: title, url: canonical }),
  });
}

// ---------------------------------------------------------------------------
// Market intelligence — the corpus as visible data. Trends key on parsed DEAL
// dates (harvesting only began 2026-07-17, so harvest ts can't draw a trend);
// unparseable dates drop out of trends but stay in counts. Cached in-process
// like MARKET_CREDIT: one corpus query per TTL, no per-request DB reads.
// ---------------------------------------------------------------------------
const MONTHS_IDX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "2025" | "Q1 2025" | "Apr 2026" | "April 2026" | "04/2026" | "2026-04(-15)"
// -> fractional year (mid-period), else null.
function parseDealDate(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(19|20)\d{2}$/))) return Number(t) + 0.5;
  if ((m = t.match(/^q([1-4])\s*((19|20)\d{2})$/))) return Number(m[2]) + (Number(m[1]) * 3 - 1.5) / 12;
  if ((m = t.match(/^([a-z]{3,9})\.?\s+((19|20)\d{2})$/))) {
    const mo = MONTHS_IDX[m[1].slice(0, 3)];
    return mo ? Number(m[2]) + (mo - 0.5) / 12 : null;
  }
  if ((m = t.match(/^(\d{1,2})\/((19|20)\d{2})$/))) {
    const mo = Number(m[1]);
    return mo >= 1 && mo <= 12 ? Number(m[2]) + (mo - 0.5) / 12 : null;
  }
  if ((m = t.match(/^((19|20)\d{2})-(\d{2})(-\d{2})?$/))) {
    const mo = Number(m[3]);
    return mo >= 1 && mo <= 12 ? Number(m[1]) + (mo - 0.5) / 12 : null;
  }
  return null;
}
// Sale rows with a parseable date and numeric $/SF — the trendable subset.
function saleRowsWithDates(rows) {
  return (rows || [])
    .filter((r) => String(r.transaction || "").toLowerCase().startsWith("sale"))
    .map((r) => ({ yearFrac: parseDealDate(r.deal_date), psf: corpusNum(r.price_per_sqft), dealText: String(r.deal_date || "") }))
    .filter((r) => r.yearFrac != null && r.psf > 0);
}
function medianPsfOf(nums) { // upper-middle, matching the feed's formula
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
}
function halfYearBuckets(dated) {
  const by = {};
  dated.forEach((d) => {
    const y = Math.floor(d.yearFrac);
    const k = `${y} ${d.yearFrac - y < 0.5 ? "H1" : "H2"}`;
    (by[k] = by[k] || []).push(d.psf);
  });
  return Object.keys(by).sort().map((k) => ({ label: k, count: by[k].length, medianPsf: medianPsfOf(by[k]) }));
}

const MARKET_INTEL = { byKey: {}, fetchedAt: 0, refreshing: false };
const MARKET_INTEL_TTL_MS = 10 * 60 * 1000;
async function refreshMarketIntel() {
  if (MARKET_INTEL.refreshing) return;
  MARKET_INTEL.refreshing = true;
  try {
    let rows = [];
    if (DB_CONFIGURED) {
      // 5000-row headroom note: revisit when the corpus approaches it.
      rows = await sbRequest("GET",
        "comp_corpus?select=market,property_type,address,transaction,deal_date,price_per_sqft,ts&order=ts.desc&limit=5000") || [];
    } else {
      rows = await readRowsFromFile(COMP_CORPUS_FILE);
    }
    const byKey = {};
    for (const r of rows) {
      const k = `${String(r.market || "").toLowerCase()}|${r.property_type || ""}`;
      (byKey[k] = byKey[k] || []).push({
        address: r.address, transaction: r.transaction, deal_date: r.deal_date,
        price_per_sqft: r.price_per_sqft, ts: r.ts,
      });
    }
    MARKET_INTEL.byKey = byKey;
    MARKET_INTEL.fetchedAt = Date.now();
  } catch (err) {
    console.error("Market intel refresh failed; keeping previous:", err.message);
  } finally {
    MARKET_INTEL.refreshing = false;
  }
}
// Stale-while-revalidate accessor — callers get the current cache instantly.
function marketIntelRows(market, propertyType) {
  if (Date.now() - MARKET_INTEL.fetchedAt > MARKET_INTEL_TTL_MS) refreshMarketIntel();
  return MARKET_INTEL.byKey[`${String(market).toLowerCase()}|${propertyType}`] || [];
}

const MARKET_FOOTER =
  `<footer><div class="wrap">` +
  `<div><div class="brand">${CN_LOGO_LIGHT}<span class="wordmark">Comp<b style="color:#EF4444">Ninja</b></span></div>` +
  `<p>Every valuation is an automated estimate, not an appraisal. CompNinja is not a licensed brokerage; we ` +
  `connect you with local brokers for opinions of value. Comparables derive from publicly available data; ` +
  `verify independently before underwriting.</p>` +
  `<p>&copy; 2026 CompNinja</p></div>` +
  `<div class="right"><a href="mailto:info@compninja.co">info@compninja.co</a>` +
  `<ul><li><a href="/markets">Markets</a></li><li><a href="/brokers">Brokers</a></li>` +
  `<li><a href="/how-it-works">How it works</a></li>` +
  `<li><a href="/how-it-works#faq">FAQ</a></li><li><a href="/">Run a report</a></li></ul></div>` +
  `</div></footer>`;

function marketShell({ title, description, canonical, body, jsonLd, noindex }) {
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
    `<meta charset="UTF-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1.0"/>\n` +
    `<title>${escHtml(title)}</title>\n` +
    `<meta name="description" content="${escHtml(description)}"/>\n` +
    (noindex
      ? `<meta name="robots" content="noindex, nofollow"/>\n`
      : `<meta name="robots" content="index, follow"/>\n<link rel="canonical" href="${canonical}"/>\n`) +
    `<meta property="og:type" content="website"/>\n<meta property="og:site_name" content="CompNinja"/>\n` +
    `<meta property="og:title" content="${escHtml(title)}"/>\n` +
    `<meta property="og:description" content="${escHtml(description)}"/>\n` +
    `<meta property="og:url" content="${canonical}"/>\n` +
    `<meta property="og:image" content="${SITE_URL}/og-image.png"/>\n` +
    `<meta name="twitter:card" content="summary_large_image"/>\n` +
    `<link rel="icon" href="/favicon.ico" sizes="48x48"/>\n` +
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>\n` +
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>\n` +
    (jsonLd ? `<script type="application/ld+json">${jsonLd}</script>\n` : "") +
    `<style>${MARKET_CSS}</style>\n</head>\n<body>\n${MARKET_BAR}\n<main class="wrap">\n${body}\n</main>\n${MARKET_FOOTER}\n</body>\n</html>\n`;
}

function renderMarketPageHTML(slug, p, opts = {}) {
  const title = marketTitle(p);
  const canonical = marketUrl(slug);
  const rangeTxt = p.ppsf.low === p.ppsf.high ? usd0(p.ppsf.median) : `${usd0(p.ppsf.low)}–${usd0(p.ppsf.high)}`;
  const description =
    `Recent ${p.type.toLowerCase()} sale comps in ${p.city}, ${p.state}: about ${usd0(p.ppsf.median)}/SF ` +
    `(typical ${rangeTxt}/SF) across ${p.ppsf.count} recent sales. Get a free instant valuation of your property.`;

  const tiles = [
    ["Median price / SF", usd0(p.ppsf.median), `across ${p.ppsf.count} recent sales`],
    ["Typical range", `${rangeTxt}`, "middle of the market, $/SF"],
    (p.cap_rate_low && p.cap_rate_high) ? ["Cap rate range", `${escHtml(p.cap_rate_low)}–${escHtml(p.cap_rate_high)}`, "stabilized deals"] : null,
    p.date_range ? ["Comps window", escHtml(p.date_range), "most recent sales & leases"] : null,
  ].filter(Boolean).map(([k, v, n]) =>
    `<div class="tile"><div class="k">${escHtml(k)}</div><div class="v">${v}</div><div class="n">${escHtml(n)}</div></div>`).join("");

  const drivers = (p.value_drivers || []).length
    ? `<div class="card"><h2>What's driving ${escHtml(p.type)} prices in ${escHtml(p.city)}</h2>` +
      (p.market_trend ? `<p><strong>${escHtml(p.market_trend)}</strong></p>` : "") +
      `<ul>${p.value_drivers.map((d) => `<li>${escHtml(d)}</li>`).join("")}</ul></div>`
    : "";

  // Market intelligence — the live corpus view (plus this page's own seeded
  // comps, deduped). Under-claim rule: a trend renders only with >=6 dated
  // sale comps across >=2 half-years; thin markets get the tracking line.
  const normAddr = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const corpusRows = marketIntelRows(`${p.city}, ${p.state}`, p.type);
  const seenKeys = new Set(corpusRows.map((r) => `${normAddr(r.address)}|${String(r.deal_date || "").toLowerCase()}`));
  const mergedRows = [
    ...corpusRows,
    ...(p.comps || [])
      .filter((c) => !seenKeys.has(`${normAddr(c.address)}|${String(c.date || "").toLowerCase()}`))
      .map((c) => ({ address: c.address, transaction: c.transaction, deal_date: c.date, price_per_sqft: c.price_per_sqft, ts: null })),
  ];
  const dated = saleRowsWithDates(mergedRows);
  const buckets = halfYearBuckets(dated).slice(-6); // label crowding cap
  let trendSvg = "";
  if (dated.length >= 6 && buckets.length >= 2) {
    const w = 640, hgt = 120, pad = 34;
    const meds = buckets.map((b) => b.medianPsf);
    const lo = Math.min(...meds), hi = Math.max(...meds);
    const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, buckets.length - 1);
    const y = (v) => (hi === lo ? hgt / 2 : hgt - pad - ((v - lo) * (hgt - 2 * pad)) / (hi - lo));
    const pts = buckets.map((b, i) => `${Math.round(x(i))},${Math.round(y(b.medianPsf))}`).join(" ");
    trendSvg =
      `<svg viewBox="0 0 ${w} ${hgt + 30}" style="width:100%;height:auto;margin-top:6px" role="img" aria-label="Median price per square foot by half-year">` +
      `<polyline fill="none" stroke="#1A2433" stroke-width="2" points="${pts}"/>` +
      buckets.map((b, i) => {
        const cx = Math.round(x(i)), cy = Math.round(y(b.medianPsf));
        return `<circle cx="${cx}" cy="${cy}" r="4" fill="${i === buckets.length - 1 ? "#B91C1C" : "#1A2433"}"/>` +
          `<text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="12" font-weight="600" fill="#1A2433">${usd0(b.medianPsf)}</text>` +
          `<text x="${cx}" y="${hgt + 18}" text-anchor="middle" font-size="11" fill="#8A93A0">${escHtml(b.label)} &middot; ${b.count}</text>`;
      }).join("") +
      `</svg>`;
  }
  const nowD = new Date();
  const nowFrac = nowD.getFullYear() + (nowD.getMonth() + 0.5) / 12;
  const last12 = dated.filter((d) => nowFrac - d.yearFrac <= 1.0).map((d) => d.psf);
  const median12 = last12.length >= 3 ? medianPsfOf(last12) : null;
  const tsList = corpusRows.map((r) => Date.parse(r.ts)).filter((n) => n > 0);
  const since = tsList.length ? new Date(Math.min(...tsList)) : null;
  const latestDeal = dated.length ? dated.reduce((a, b) => (a.yearFrac >= b.yearFrac ? a : b)).dealText : null;
  const statsBits = [
    since ? `Tracking this market since ${since.toLocaleString("en-US", { month: "short", year: "numeric" })}` : `Tracking this market`,
    `${mergedRows.length} comp${mergedRows.length === 1 ? "" : "s"}`,
    median12 ? `12-month median ${usd0(median12)}/SF` : null,
    latestDeal ? `latest deal ${escHtml(latestDeal)}` : null,
  ].filter(Boolean).join(" &middot; ");
  const qNum = Math.floor(nowD.getMonth() / 3) + 1;
  const qStartTs = new Date(nowD.getFullYear(), (qNum - 1) * 3, 1).getTime();
  const addedThisQ = corpusRows.filter((r) => Date.parse(r.ts) >= qStartTs).length;
  const qLo = nowD.getFullYear() + ((qNum - 1) * 3) / 12, qHi = nowD.getFullYear() + (qNum * 3) / 12;
  const pLo = qNum === 1 ? nowD.getFullYear() - 1 + 0.75 : nowD.getFullYear() + ((qNum - 2) * 3) / 12;
  const pHi = qLo;
  const curQ = dated.filter((d) => d.yearFrac >= qLo && d.yearFrac < qHi).map((d) => d.psf);
  const priQ = dated.filter((d) => d.yearFrac >= pLo && d.yearFrac < pHi).map((d) => d.psf);
  const priorQLabel = qNum === 1 ? `Q4 ${nowD.getFullYear() - 1}` : `Q${qNum - 1}`;
  const quarterBits = [
    `${addedThisQ} comp${addedThisQ === 1 ? "" : "s"} added to our corpus in Q${qNum} ${nowD.getFullYear()}`,
    curQ.length >= 3 && priQ.length >= 3
      ? `deals closed in Q${qNum}: median ${usd0(medianPsfOf(curQ))}/SF ${medianPsfOf(curQ) >= medianPsfOf(priQ) ? "&#9650;" : "&#9660;"} vs ${usd0(medianPsfOf(priQ))} in ${priorQLabel}`
      : null,
  ].filter(Boolean).join(" &middot; ");
  const intelCard =
    `<div class="card"><h2>Market intelligence</h2>` +
    trendSvg +
    `<p${trendSvg ? ' style="margin-top:10px"' : ""}>${statsBits}.</p>` +
    `<p class="disc" style="margin-top:6px">This quarter: ${quarterBits}. Trend medians use closed-deal dates from our growing comp corpus; automated estimates, not an appraisal.</p>` +
    `</div>`;

  // Columns are derived, not hardcoded: this type's TYPE_COMP_FIELDS specs slot
  // in after Size (SF), matching the report table's ordering convention.
  // A spec column that is empty on EVERY comp is dropped, which is what lets
  // the pre-#5 seed markets render exactly as they always have instead of
  // sprouting blank columns until they are backfilled.
  const marketComps = p.comps || [];
  const typeCols = ((TYPE_COMP_FIELDS[p.type] || { fields: [] }).fields)
    .filter((key) => marketComps.some((c) => String(c[key] || "").trim()))
    .map((key) => ({ key, label: FIELD_LABELS[key] || key }));
  // Same split as the report table (TYPE_COLUMNS' `after` anchors): physical
  // specs sit behind Size, while per-unit / per-acre pricing sits with the
  // other price columns. Lumping them all behind Size would separate $/Acre
  // from $/SF, which reads wrong for the types that price that way.
  const isPricing = (c) => c.key.startsWith("price_per_");
  const specCols = typeCols.filter((c) => !isPricing(c));
  const priceCols = typeCols.filter(isPricing);
  const compCols = [
    { key: "address", label: "Address" },
    { key: "date", label: "Date" },
    { key: "transaction", label: "Type" },
    { key: "size_sqft", label: "Size (SF)" },
    ...specCols,
    { key: "price_or_rate", label: "Price / Rate" },
    { key: "price_per_sqft", label: "$/SF" },
    ...priceCols,
  ];
  const compRows = marketComps.map((c) => {
    // Same badge tiers the report table uses; anything else stays neutral, so
    // provenance can be under-claimed but never over-claimed.
    const tier = { verified: " v", listing: " li" }[String(c.source_type || "").toLowerCase()] || "";
    const badge = c.source_type
      ? `<span class="badge${tier}">${escHtml(c.source_type.replace("_", " "))}</span>` : "";
    return "<tr>" + compCols.map((col) => (col.key === "address"
      ? `<td>${escHtml(c.address)} ${badge}</td>`
      : `<td>${escHtml(c[col.key] || "")}</td>`)).join("") + "</tr>";
  }).join("");
  const compsTable = compRows
    ? `<div class="card"><h2>Recent ${escHtml(p.type)} comps in ${escHtml(p.city)}, ${escHtml(p.state)}</h2>` +
      `<div class="scroll"><table><thead><tr>` +
      compCols.map((col) => `<th>${escHtml(col.label)}</th>`).join("") +
      `</tr></thead><tbody>${compRows}</tbody></table></div></div>`
    : "";

  // Quiet contributor credit — the public half of the broker loop.
  const creditNames = (MARKET_CREDIT.byMarket[`${p.city}, ${p.state}`.toLowerCase()] || []).slice(0, 6);
  const creditLine = creditNames.length
    ? `<p class="disc">Our verified comp layer for this market includes comps contributed by local brokers: ` +
      `${creditNames.map(escHtml).join(", ")}. Are you a broker in ${escHtml(p.city)}? <a href="/">Submit a comp</a>.</p>`
    : "";

  // One Q/A array feeds both the visible FAQ block and the FAQPage JSON-LD,
  // so the two can never drift (Google flags mismatched FAQ markup).
  const typeLc = p.type.toLowerCase();
  const faq = [
    [`What is the average price per square foot for ${typeLc} space in ${p.city}, ${p.state}?`,
     `Recent sale comps put the median around ${usd0(p.ppsf.median)}/SF, with a typical range of ` +
     `${rangeTxt}/SF across ${p.ppsf.count} recent sales${p.date_range ? " (" + p.date_range + ")" : ""}.`],
    ...(p.cap_rate_low && p.cap_rate_high ? [[
      `What cap rates are ${typeLc} properties trading at in ${p.city}?`,
      `Recent market data suggests roughly ${p.cap_rate_low}–${p.cap_rate_high} for stabilized ${typeLc} deals in the ${p.city} area.`]] : []),
    [`How are these numbers calculated?`,
     `They are automated estimates built from recent comparable sales found in public listings, property records, ` +
     `and brokerage announcements. They are not an appraisal or a broker opinion of value.`],
    [`How do I find out what my ${p.city} ${typeLc} property is worth?`,
     `Run a free valuation on CompNinja: enter the address and property type and you get an estimated value range ` +
     `from recent comps in under a minute. For a real opinion of value, we connect you with a licensed local broker at no cost.`],
  ];
  const faqCard =
    `<div class="card"><h2>Frequently asked questions</h2>` +
    faq.map(([q, a]) => `<h3>${escHtml(q)}</h3><p>${escHtml(a)}</p>`).join("") +
    `</div>`;

  const merged = allMarketPages();
  const others = Object.keys(merged).filter((s) => s !== slug).slice(0, 6);
  const related = others.length
    ? `<div class="card"><h2>Other markets</h2><div class="related">` +
      others.map((s) => `<a href="/market/${s}">${escHtml(marketTitle(merged[s]).replace(" Property Values in", " ·"))}</a>`).join("") +
      `<a href="/markets">All markets &rarr;</a></div></div>`
    : "";

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: title,
        description,
        url: canonical,
        isPartOf: { "@type": "WebSite", name: "CompNinja", url: `${SITE_URL}/` },
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Markets", item: `${SITE_URL}/markets` },
            { "@type": "ListItem", position: 2, name: title, item: canonical },
          ],
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  });

  // Explorer previews: thin-data snapshots shown only to the visitor who
  // requested them — banner up top, robots noindex, no structured data.
  const previewBanner = opts.preview
    ? `<div class="card"><h2>Limited data preview</h2><p>We found only ${p.ppsf.count} priced sale comp${p.ppsf.count === 1 ? "" : "s"} ` +
      `for this market, below our bar for a published page. The figures below are indicative only, and this page expires shortly. ` +
      `For a specific property, <a href="/">run a free valuation</a> instead.</p></div>`
    : "";

  const body =
    `<p class="sub"><a href="/markets">Markets</a> &rsaquo; ${escHtml(p.city)}, ${escHtml(p.state)}</p>` +
    `<h1>${escHtml(title)}</h1>` +
    `<p class="sub">Automated market snapshot from recent comparable sales${p.date_range ? " · " + escHtml(p.date_range) : ""}. Updated ${escHtml(p.generatedAt)}.</p>` +
    previewBanner +
    `<div class="tiles">${tiles}</div>` +
    (p.summary ? `<div class="card"><h2>${escHtml(p.city)}, ${escHtml(p.state)} ${escHtml(p.type.toLowerCase())} market</h2><p>${escHtml(p.summary)}</p></div>` : "") +
    drivers +
    intelCard +
    compsTable +
    creditLine +
    faqCard +
    `<div class="cta"><h2>What's your ${escHtml(p.type.toLowerCase())} property worth?</h2>` +
    `<p>Get a free, instant estimate from recent comps, then a no-cost Broker Opinion of Value from a licensed local broker.</p>` +
    `<a class="btn" href="/">Get my free valuation &rarr;</a></div>` +
    related +
    `<p class="disc">Figures are automated estimates derived from public listings, records, and brokerage announcements for ${escHtml(p.city)}, ${escHtml(p.state)}, not an appraisal or a broker opinion of value. Verify independently before relying on them. CompNinja connects owners with licensed local brokers; it is not a brokerage.</p>`;

  return marketShell({
    title: `${title} (${p.date_range || "recent comps"}) | CompNinja`,
    description, canonical, body,
    jsonLd: opts.preview ? null : jsonLd,
    noindex: Boolean(opts.preview),
  });
}

function renderMarketDirectoryHTML() {
  const merged = allMarketPages();
  // Curated seed pages first (in seed-file order), explorer-generated after,
  // alphabetically — the hand-picked markets stay the face of the directory.
  const slugs = [
    ...Object.keys(MARKET_PAGES),
    ...Object.keys(merged).filter((s) => !MARKET_PAGES[s]).sort(),
  ];
  const title = "Commercial Real Estate Market Snapshots by City";
  const canonical = `${SITE_URL}/markets`;
  const description =
    "Recent commercial real estate price-per-square-foot snapshots by city and property type (industrial, office, retail, and multifamily) with a free instant valuation tool.";
  const cards = slugs.map((s) => {
    const p = merged[s];
    return `<a class="mcard" href="/market/${s}"><div class="t">${escHtml(p.type)} · ${escHtml(p.city)}, ${escHtml(p.state)}</div>` +
      `<div class="s">Median ${usd0(p.ppsf.median)}/SF · ${p.ppsf.count} recent comps</div></a>`;
  }).join("");
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonical,
    hasPart: slugs.map((s) => ({ "@type": "WebPage", name: marketTitle(merged[s]), url: marketUrl(s) })),
  });
  const body =
    `<h1>Commercial Real Estate Market Snapshots</h1>` +
    `<p class="sub">Recent price-per-square-foot and cap-rate snapshots by market, built from real comparable sales. Pick a market, or run a free valuation for your own building.</p>` +
    (cards ? `<div class="grid">${cards}</div>` : `<p>Market snapshots are being prepared. <a href="/">Run a live valuation &rarr;</a></p>`) +
    `<div class="cta"><h2>Have a specific property?</h2><p>Skip the averages, get an instant estimate for your exact building.</p>` +
    `<a class="btn" href="/">Get my free valuation &rarr;</a></div>`;
  return marketShell({ title: `${title} | CompNinja`, description, canonical, body, jsonLd });
}


// ---------------------------------------------------------------------------
// How It Works — the standalone proof page. The landing page sells; this page
// explains. It holds the four blocks that used to live below the fold on the
// home page (stat strip, sample report exhibit, the three-step method, FAQ),
// reached from the header nav and the footer.
//
// Server-rendered and SELF-CONTAINED like the market pages: its own inline
// <style>, so it does NOT depend on the purged tailwind.css and never breaks
// when a utility class is missing from that build. The CSS below is the
// Research Desk system copied from index.html's rd-* block, so the page reads
// as the same site rather than the older market-page skin.
// ---------------------------------------------------------------------------
const HOW_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#FBFBF9;color:#1A2433;line-height:1.6;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:#B91C1C;text-decoration:none}a:hover{color:#991B1B}
.wrap{max-width:1024px;margin:0 auto;padding:0 16px}
/* Header — mirrors index.html's bar so navigating here feels continuous. */
.hdr{border-bottom:1px solid #E4E2DA;background:#FBFBF9}
/* Wraps on narrow screens: the nav drops to its own row rather than squeezing
   each link into a two-line column (which overflowed the viewport at 375px). */
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:10px;padding-top:16px;padding-bottom:16px}
.hleft{display:flex;align-items:center;gap:18px}
/* Red back link, top-left corner of the page — also wired to the Escape key.
   Deliberately plain (no border/pill): the owner rolled back a boxed version
   as too heavy. Absolute against the page, not the centered column; below
   ~1140px the corner collides with the column, so it drops back into the
   header flow beside the logo. */
.backbtn{position:absolute;top:21px;left:18px;display:inline-flex;align-items:center;gap:6px;color:#B91C1C;font-size:13.5px;font-weight:500;white-space:nowrap}
.backbtn:hover{color:#991B1B}
.backbtn svg{width:15px;height:15px;flex-shrink:0}
@media (max-width:1139px){.backbtn{position:static}}
.brand{display:flex;align-items:center;gap:10px;color:#1A2433}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#1A2433}
.wordmark b{color:#B91C1C;font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;font-size:13.5px}
.hdr nav a{color:#5A6473;white-space:nowrap}.hdr nav a:hover{color:#1A2433}
.hdr nav a.on{color:#1A2433;font-weight:500}
/* Explore dropdown — same pattern as MARKET_CSS; keep the two in step. The
   FAQ accordions below are also <details>, which is why every rule (and the
   close-on-outside-click script) is scoped to ".hdr nav". */
.hdr nav details{position:relative}
.hdr nav summary{list-style:none;cursor:pointer;color:#5A6473;white-space:nowrap;user-select:none}
.hdr nav summary::-webkit-details-marker{display:none}
.hdr nav summary:hover,.hdr nav details[open] summary{color:#1A2433}
.hdr nav summary .car{display:inline-block;font-size:9px;margin-left:3px;color:#8A93A0}
.hdr nav .dd{position:absolute;right:0;top:calc(100% + 10px);z-index:1100;background:#fff;
  border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);
  padding:4px 0;min-width:176px}
.hdr nav .dd a{display:block;padding:8px 12px;color:#374253}
.hdr nav .dd a:hover{background:#F8FAFC;color:#1A2433}
.hdr nav .dd a.on{color:#1A2433;font-weight:500}
/* Type + section furniture */
.kicker{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:#B91C1C;font-weight:600}
.h{font-family:Georgia,'Times New Roman',serif;font-weight:500;letter-spacing:-.005em;color:#1A2433;margin:0}
h1.h{font-size:38px;line-height:1.12;margin:12px 0 0;max-width:20ch}
h2.h{font-size:27px;margin:8px 0 0}
h3{font-size:15px;font-weight:600;color:#1A2433;margin:0 0 6px}
.lead{color:#4C5665;font-size:16.5px;max-width:58ch;margin:16px 0 0}
.sub{color:#4C5665;font-size:14px;max-width:60ch;margin:4px 0 20px}
section{padding:48px 0}
.band{background:#F5F4EF;box-shadow:0 0 0 100vmax #F5F4EF;clip-path:inset(0 -100vmax)}
.lab{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#8A93A0;font-weight:600;margin-bottom:2px}
/* Stat strip */
.stats{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid #E4E2DA;border-bottom:1px solid #E4E2DA}
.stat{padding:18px}
.stat:nth-child(1),.stat:nth-child(3){border-right:1px solid #E4E2DA}
.stat .n{font-size:22px;font-weight:600;color:#1A2433;font-variant-numeric:tabular-nums}
.stat .l{font-size:11.5px;color:#8A93A0;letter-spacing:.06em;text-transform:uppercase;margin-top:2px}
/* Sample-report exhibit */
.exhibit{border:1px solid #D8D4C9;background:#fff;border-radius:6px;overflow:hidden}
.cap{padding:12px 20px;border-bottom:1px solid #ECEAE3;font-size:11.5px;color:#8A93A0;letter-spacing:.06em;text-transform:uppercase;display:flex;justify-content:space-between}
.exrow{display:flex;flex-direction:column}
.exside{padding:24px;border-bottom:1px solid #ECEAE3}
.exmain{padding:24px;flex:1;overflow-x:auto}
.big{font-family:Georgia,'Times New Roman',serif;font-weight:500;color:#1A2433;font-size:32px;margin-top:2px;font-variant-numeric:tabular-nums}
.psf{font-size:13px;color:#5A6473;margin-bottom:16px}
.drv{font-size:13px;color:#374253;padding:7px 0;border-top:1px solid #F0EFE9;display:flex;gap:8px}
.drv b{color:#B91C1C;font-weight:700}
table.comps{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
table.comps th{text-align:left;color:#8A93A0;font-weight:600;padding:7px 8px 7px 0;border-bottom:1px solid #D8D4C9;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase}
table.comps td{padding:9px 8px 9px 0;border-bottom:1px solid #F0EFE9;white-space:nowrap}
.badge{display:inline-block;font-size:10.5px;font-weight:600;border-radius:3px;padding:1.5px 7px;white-space:nowrap;line-height:1.4}
.badge.v{color:#06603A;background:#E3F2EA}
.badge.p{color:#46536A;background:#EAEEF4}
.badge.li{color:#7A5B12;background:#F7EFDC}
.legend{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:16px;font-size:13px;color:#4C5665;align-items:center}
.legend span.i{display:flex;align-items:center;gap:8px}
/* Method steps */
.steps{border:1px solid #D8D4C9;border-radius:6px;overflow:hidden;background:#fff;display:grid;grid-template-columns:1fr;margin-top:20px}
.step{padding:22px 24px;border-bottom:1px solid #ECEAE3}
.step:last-child{border-bottom:0}
.num{font-family:Georgia,serif;font-size:13px;color:#B91C1C;margin-bottom:8px}
.step p{font-size:13.5px;color:#5A6473;margin:0}
/* FAQ accordions — chevron marker, matching the home page's disclosure style */
details.q{background:#fff;border:1px solid #D8D4C9;border-radius:6px;padding:16px 20px;margin-bottom:12px}
details.q summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;font-weight:600;color:#1A2433}
details.q summary::-webkit-details-marker{display:none}
details.q summary::after{content:"";width:16px;height:16px;flex-shrink:0;transition:transform .25s ease;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") center/contain no-repeat}
details.q[open] summary::after{transform:rotate(180deg)}
details.q p{font-size:14px;color:#5A6473;margin:8px 0 0;max-width:80ch}
/* Closing CTA */
.cta{border:1px solid #D8D4C9;background:#fff;border-radius:6px;padding:28px;text-align:center;margin:8px 0 48px}
.cta p{color:#4C5665;font-size:14px;margin:8px auto 20px;max-width:52ch}
.btn{display:inline-block;background:#B91C1C;color:#fff;font-weight:600;padding:11px 26px;border-radius:4px;font-size:14.5px}
.btn:hover{background:#991B1B;color:#fff}
/* Footer — the navy ink footer from the home page */
footer{background:#1A2433;color:#B8C0CC;font-size:13px}
footer .wrap{padding:40px 16px;display:flex;flex-direction:column;justify-content:space-between;gap:32px}
footer .wordmark{color:#fff}
footer p{color:#8F99A8;margin:12px 0 0;max-width:68ch;line-height:1.6}
footer a{color:#D5DAE2;text-decoration:underline;text-decoration-color:#46536A}
footer a:hover{color:#fff}
footer ul{list-style:none;margin:12px 0 0;padding:0}
footer li{margin-bottom:8px}
footer li a{text-decoration:none;color:#B8C0CC}
@media (min-width:640px){
  .hdr nav{gap:24px}
  .stats{grid-template-columns:repeat(4,1fr)}
  .stat{padding:20px}
  .stat:nth-child(3){border-right:1px solid #E4E2DA}
  .steps{grid-template-columns:repeat(3,1fr)}
  .step{border-bottom:0;border-right:1px solid #ECEAE3}
  .step:last-child{border-right:0}
  h1.h{font-size:42px}
  footer .wrap{flex-direction:row}
  footer .right{text-align:right;flex-shrink:0}
}
@media (min-width:1024px){
  .exrow{flex-direction:row}
  .exside{width:38%;border-bottom:0;border-right:1px solid #ECEAE3}
}
`;

// One Q/A array feeds both the visible FAQ block and the FAQPage JSON-LD, so
// the two can never drift (Google flags mismatched FAQ markup). This is the
// canonical copy — it moved off index.html when the FAQ moved to this page.
const HOW_FAQ = [
  ["What is a comp in commercial real estate?",
   "A comp (short for comparable) is a recent sale or lease of a property similar to yours. Brokers, lenders, and appraisers use comps to estimate what a property is worth or what rent it can command."],
  ["How much does a comp report cost?",
   "Nothing. Reports are free and there is no subscription. We only ask for your contact details when you export a report, so we can follow up about your property and market."],
  ["Where does the data come from?",
   "Every search runs live against public listings, property records, and brokerage announcements, and every comp is labeled by source: Verified (submitted by a local broker and reviewed by our team), Public record, Listing, News, or Estimate, so you always know how much weight to give it."],
  ["Can I find out what my building is worth?",
   "Yes. Enter your address and property type. We pull the building's square footage from public records automatically (you can override it), and every report opens with an estimated value range based on recent comparable sales. Add NOI for an income-approach cross-check. It's an automated estimate, not an appraisal. For a real opinion of value we'll connect you with a licensed local broker, free."],
  ["What property types are covered?",
   "Industrial, office, retail, multifamily, land, and residential. Each type reports the specifics its buyers price on: clear height and dock doors for industrial, building class for office, center type and anchor tenant for retail, unit count and price per unit for multifamily, acreage and zoning for land, and bedroom and bathroom counts for residential."],
  ["How accurate are the reports?",
   "Comps are a starting point, not an appraisal. The data comes from public sources and can contain errors, so verify anything important before relying on it. For a true opinion of value, talk to a licensed local broker. Reach out and we can connect you with one."],
];

// ---------------------------------------------------------------------------
// /brokers — the broker side of the product on its own indexable URL. This
// content used to be a two-card section low on the landing page reachable only
// by a scroll-to button ("For Brokers"); it moved here so it has a title, a
// canonical URL, and room to grow into a real contributor hub.
// Rendered through marketShell (MARKET_CSS/BAR/FOOTER) like /markets and
// /broker/<slug>, so it does NOT depend on the purged tailwind.css.
// The "Submit a comp" CTA points at /#submit-comp: the submission form is the
// modal that lives in index.html, and one form beats two copies of it.
// ---------------------------------------------------------------------------
function renderBrokersPageHTML() {
  const title = "For Commercial Real Estate Brokers | CompNinja";
  const canonical = `${SITE_URL}/brokers`;
  const description =
    "Submit a comp to CompNinja and it carries your firm's name on every report that uses it. " +
    "Contributing brokers also get introduced to owners asking what their building is worth.";
  const introHref = `mailto:${LEAD_NOTIFY_EMAIL}?subject=${encodeURIComponent("Broker introduction: CompNinja")}`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Brokers",
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "CompNinja", url: `${SITE_URL}/` },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "CompNinja", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Brokers", item: canonical },
      ],
    },
  });

  const body =
    `<h1>The comps get better because brokers make them better.</h1>` +
    `<p class="sub">CompNinja reports are built from public records, listings, and live search. ` +
    `The comps brokers confirm are the ones buyers and owners trust most. Those comps carry ` +
    `the contributor's name wherever they appear.</p>` +
    `<div class="grid">` +
    `<div class="card"><h2>Submit a comp, get the credit.</h2>` +
    `<p>Approved comps appear with a green Verified badge and your firm's name on every report ` +
    `that uses them. That badge is visible proof you know your market.</p>` +
    `<p style="margin:0"><a href="/#submit-comp">Submit a comp &rarr;</a></p></div>` +
    `<div class="card"><h2>Meet owners already asking about value.</h2>` +
    `<p>Owners requesting a Broker Opinion of Value are matched with brokers active in that ` +
    `market. These are not cold leads; they are owners in the middle of a decision.</p>` +
    `<p style="margin:0"><a href="${introHref}">Get introduced &rarr;</a></p></div>` +
    `</div>` +
    `<div class="card"><h2>What &quot;Verified&quot; means</h2>` +
    `<p>Every submitted comp is hand-reviewed by our team before it joins the comp layer. ` +
    `Verified is the highest provenance tier in a CompNinja report, above public record, ` +
    `listing, news, and estimate. Once approved, the comp is offered to every matching search ` +
    `in that market and property type, badged <strong>Verified &middot; via your firm</strong>.</p>` +
    `<p style="margin:0">Contributors with a public profile get a page of their own listing their ` +
    `verified comps, the markets they cover, and how often their comps have been cited.</p></div>` +
    `<div class="cta"><h2>Have a comp we should know about?</h2>` +
    `<p>It takes about a minute: the address, date, price, and size. We handle the review.</p>` +
    `<a class="btn" href="/#submit-comp">Submit a comp</a>` +
    `<p style="margin:0"><a class="alt" href="/">Or run a free valuation of a building &rarr;</a></p></div>` +
    `<p class="disc">CompNinja is not a licensed brokerage. Introductions are made by our team, and ` +
    `broker contact details are never passed on without asking first.</p>`;

  return marketShell({ title, description, canonical, body, jsonLd });
}

function renderHowItWorksHTML() {
  const title = "How CompNinja Works";
  const canonical = `${SITE_URL}/how-it-works`;
  const description =
    "How a CompNinja report is built: live searches of public records and listings, a source-confidence badge on every comp, " +
    "and a value range for your building. Plus answers to the most common questions.";

  const stats = [
    ["Free", "Every report"],
    ["3&ndash;6", "Cited comps per report"],
    ["~40s", "Search to report"],
    ["100%", "Sources disclosed"],
  ].map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");

  // Illustrative sample, clearly captioned as such — the same exhibit that
  // used to sit on the home page. Figures are representative, not a live pull.
  const sampleComps = [
    ["9020 Center Ave", "May 26", "21,400", "$238", `<span class="badge v">Verified &middot; via Ridgeline CRE</span>`],
    ["11215 4th St", "Mar 26", "18,750", "$226", `<span class="badge p">Public record</span>`],
    ["8933 Utica Ave", "Feb 26", "24,100", "$219", `<span class="badge li">Listing</span>`],
    ["10722 Arrow Route", "Dec 25", "19,900", "$214", `<span class="badge p">Public record</span>`],
    ["12190 6th St", "Nov 25", "26,300", "$208", `<span class="badge li">Listing</span>`],
  ].map((r) => `<tr>${r.map((c, i) => `<td>${i === 4 ? c : escHtml(c)}</td>`).join("")}</tr>`).join("");

  const steps = [
    ["I.", "Search live",
     "Public records, listings, and news are searched at request time, not read from a stale database."],
    ["II.", "Cite everything",
     "Each comp carries its source and a confidence badge. Unknown provenance is labeled an estimate, never dressed up."],
    ["III.", "Value the subject",
     "Building size comes from public records; the range comes from sale comps. Your price and NOI stay in your browser."],
  ].map(([n, h, p]) =>
    `<div class="step"><div class="num">${n}</div><h3>${escHtml(h)}</h3><p>${escHtml(p)}</p></div>`).join("");

  const faqBlock = HOW_FAQ.map(([q, a]) =>
    `<details class="q"><summary>${escHtml(q)}</summary><p>${escHtml(a)}</p></details>`).join("");

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: title,
        description,
        url: canonical,
        isPartOf: { "@type": "WebSite", name: "CompNinja", url: `${SITE_URL}/` },
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "CompNinja", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: title, item: canonical },
          ],
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: HOW_FAQ.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  });

  const body = `
<header class="hdr">
  <div class="wrap">
    <div class="hleft">
      <a class="backbtn" id="howBack" href="/" aria-label="Go back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>Back</a>
      <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
    </div>
    <nav>
      <details>
        <summary>Explore<span class="car">▾</span></summary>
        <div class="dd">
          <a href="/markets">Markets</a>
          <a href="/brokers">Brokers</a>
          <a href="/how-it-works" class="on" aria-current="page">How it works</a>
        </div>
      </details>
    </nav>
  </div>
</header>
<script>document.addEventListener("click",function(e){
  document.querySelectorAll(".hdr nav details[open]").forEach(function(d){
    if(!d.contains(e.target))d.open=false;});});
(function(){
  // Back = the page you came from when that was CompNinja; otherwise home.
  function goBack(){
    try{
      if(document.referrer&&new URL(document.referrer).origin===location.origin&&history.length>1){history.back();return;}
    }catch(err){}
    location.href="/";
  }
  document.getElementById("howBack").addEventListener("click",function(e){e.preventDefault();goBack();});
  document.addEventListener("keydown",function(e){
    if(e.key!=="Escape")return;
    var dd=document.querySelector(".hdr nav details[open]");
    if(dd){dd.open=false;return;}
    goBack();
  });
})();</script>

<main>
  <div class="wrap">
    <section style="padding-bottom:32px">
      <div class="kicker">How it works</div>
      <h1 class="h">A report you can hand to someone who will argue with it.</h1>
      <p class="lead">Every CompNinja report answers the question and then shows its work: a value range for the
        subject, the comps behind it, and where each comp came from. Here is exactly how that gets built.</p>
    </section>
    <div class="stats">${stats}</div>
  </div>

  <div class="wrap">
    <section>
      <div class="kicker">The Report</div>
      <h2 class="h">One page that answers, then proves.</h2>
      <p class="sub">A value range for the subject, what's driving prices in the market, and the comp table behind
        both, with a confidence badge on every source.</p>
      <div class="exhibit">
        <div class="cap"><span>Sample report &middot; Industrial &middot; Rancho Cucamonga, CA</span><span>Illustrative</span></div>
        <div class="exrow">
          <div class="exside">
            <div class="lab">Estimated value</div>
            <div class="big">$4.6M&ndash;$5.3M</div>
            <div class="psf">$212&ndash;$245 / SF &middot; 21,600 SF (public record)</div>
            <div class="lab" style="margin-bottom:4px">What's driving prices</div>
            <div class="drv"><b>&#9650;</b> Inland Empire vacancy tightening near the I-15 corridor</div>
            <div class="drv"><b>&#9650;</b> Sub-25K SF buildings trade at a premium: scarce supply</div>
            <div class="drv"><b>&ndash;</b> Rate environment holding cap rates near 5.9–6.4%</div>
          </div>
          <div class="exmain">
            <table class="comps">
              <thead><tr><th>Address</th><th>Sold</th><th>SF</th><th>$/SF</th><th>Source</th></tr></thead>
              <tbody>${sampleComps}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="legend">
        <span class="i"><span class="badge v">Verified</span> confirmed by a local broker</span>
        <span class="i"><span class="badge p">Public record</span> county recorder / assessor</span>
        <span class="i"><span class="badge li">Listing</span> active or closed listing</span>
        <span style="color:#8A93A0">Badges under-claim, never over-claim.</span>
      </div>
    </section>
  </div>

  <div class="band"><div class="wrap">
    <section>
      <div class="kicker">Method</div>
      <h2 class="h">How a report comes together.</h2>
      <div class="steps">${steps}</div>
    </section>
  </div></div>

  <div class="wrap">
    <section id="faq">
      <div class="kicker">Questions</div>
      <h2 class="h" style="margin-bottom:20px">FAQ</h2>
      ${faqBlock}
    </section>

    <div class="cta">
      <h2 class="h" style="font-size:22px">See it on your own building.</h2>
      <p>Enter an address and property type; the report takes about a minute and costs nothing.</p>
      <a class="btn" href="/">Run a free report &rarr;</a>
    </div>
  </div>
</main>

<footer>
  <div class="wrap">
    <div>
      <div class="brand">${CN_LOGO_LIGHT}<span class="wordmark">Comp<b style="color:#EF4444">Ninja</b></span></div>
      <p>Every valuation is an automated estimate, not an appraisal. CompNinja is not a licensed brokerage; we
        connect you with local brokers for opinions of value. Comparables derive from publicly available data;
        verify independently before underwriting.</p>
      <p>&copy; 2026 CompNinja</p>
    </div>
    <div class="right">
      <a href="mailto:info@compninja.co">info@compninja.co</a>
      <ul>
        <li><a href="/markets">Markets</a></li>
        <li><a href="/brokers">Brokers</a></li>
        <li><a href="/how-it-works">How it works</a></li>
        <li><a href="/how-it-works#faq">FAQ</a></li>
        <li><a href="/">Run a report</a></li>
      </ul>
    </div>
  </div>
</footer>`;

  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
    `<meta charset="UTF-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1.0"/>\n` +
    `<title>${escHtml(title)} | CompNinja</title>\n` +
    `<meta name="description" content="${escHtml(description)}"/>\n` +
    `<meta name="robots" content="index, follow"/>\n<link rel="canonical" href="${canonical}"/>\n` +
    `<meta name="theme-color" content="#FBFBF9"/>\n` +
    `<meta property="og:type" content="website"/>\n<meta property="og:site_name" content="CompNinja"/>\n` +
    `<meta property="og:title" content="${escHtml(title)}"/>\n` +
    `<meta property="og:description" content="${escHtml(description)}"/>\n` +
    `<meta property="og:url" content="${canonical}"/>\n` +
    `<meta property="og:image" content="${SITE_URL}/og-image.png"/>\n` +
    `<meta name="twitter:card" content="summary_large_image"/>\n` +
    `<link rel="icon" href="/favicon.ico" sizes="48x48"/>\n` +
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>\n` +
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>\n` +
    `<script type="application/ld+json">${jsonLd}</script>\n` +
    `<style>${HOW_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}


// ---------------------------------------------------------------------------
// Analytics — a PII-free event log so the owner can see volume, popular
// markets, and conversion. Writes are fire-and-forget; the /admin view
// aggregates on read. No name/email/street address is ever logged.
// ---------------------------------------------------------------------------
// Best-effort "City, ST" from a freeform address. Aggregate market interest
// only — never the street address.
//
// This key is load-bearing, not just a label: harvestComps() files each comp
// under marketOf(comp.address) while corpus-first retrieval looks rows up under
// marketOf(subject.address), and corpusRowsForMarket() matches it with an exact
// (case-sensitive) eq. Any drift between the write and the read silently costs
// corpus hits, so the parse is canonicalized here — title-cased city, uppercase
// state — rather than left to whatever the source string happened to look like.
//
// Two things break the naive "last two comma segments" read, both common in
// model-supplied comp addresses:
//   - Parentheticals carry their own commas. "Ontario, CA (Orden acquisition,
//     257,000 SF industrial/office)" makes "257,000 SF industrial/office)" the
//     final segment, whose first two-letter run is "SF" — square feet silently
//     read as a state code.
//   - Trailing descriptors push the state out of the final segment entirely,
//     as in "Ontario, CA - Airport Area Submarket Warehouse".
// So: drop parentheticals, then walk backwards for the first segment that
// STARTS with a real US state code, and take the segment before it as the city.
function marketOf(address) {
  const cleaned = String(address || "")
    .replace(/\([^)]*\)/g, " ")                       // and the commas inside them
    .replace(/,\s*(?:USA|U\.S\.A\.|United States)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const st = (parts[i].match(/^([A-Za-z]{2})\b/) || [])[1];
    if (!st || !US_STATES.has(st.toUpperCase())) continue;
    // "Ontario/San Bernardino County" -> "Ontario": one city per key, so a
    // dual-named submarket doesn't fragment into its own bucket.
    const city = parts[i - 1].split("/")[0].trim();
    if (!city) continue;
    return `${city.toLowerCase().replace(/(^|[\s.'\-])[a-z]/g, (ch) => ch.toUpperCase())}, ${st.toUpperCase()}`;
  }
  // No recognizable state: fall back to the trailing segment rather than the
  // whole string, which keeps the leading street number out of the key. (A
  // comma-less input has no trailing segment to fall back to and still returns
  // as-is — same as the previous behavior.)
  return (parts[parts.length - 1] || "").slice(0, 60);
}

// An analytics market is "City, ST" or it is unknown — never free text.
//
// marketOf() ends with a fallback to the trailing comma-separated segment, and
// an address typed WITHOUT a comma has no trailing segment, so the whole thing
// comes back and lands in a column that is supposed to hold city + state. Found
// in production 2026-07-31: a real search for "1394 North 28th st washougal"
// was sitting in `market` verbatim. Every event kind that carries a market
// (search, lead, portfolio_add/refresh, comp, comp_review, share,
// type_autofill) reaches this one function, so guarding here covers all of
// them at once.
//
// Deliberately NOT fixed inside marketOf(): that function is also the comp
// corpus key — harvestComps() files rows under marketOf(comp.address) and
// corpusRowsForMarket() looks them up with an exact, case-sensitive match — so
// changing its fallback would silently re-key the corpus and pin the hit rate
// at zero. See the note above marketOf() before touching it.
//
// Dropping an unparseable market loses nothing real: it was never a market,
// and the event itself is still counted.
const MARKET_SHAPE = /^[^,]+,\s[A-Z]{2}$/;
function marketForLog(value) {
  const s = String(value == null ? "" : value).trim();
  return MARKET_SHAPE.test(s) ? s : "";
}

function logEvent(kind, dims) {
  const row = {
    ts: new Date().toISOString(),
    kind: String(kind),
    prop_type: (dims && dims.prop_type) || "",
    market: marketForLog(dims && dims.market),
    source: (dims && dims.source) || "",
    cached: Boolean(dims && dims.cached),
  };
  // Analytics must never delay or break a real request.
  storeRow("analytics_events", ANALYTICS_FILE, row).catch((e) =>
    console.error("Analytics log failed:", e.message));
}

function aggregateStats(rows) {
  const searches = rows.filter((r) => r.kind === "search");
  const leads = rows.filter((r) => r.kind === "lead");
  const ymd = (d) => d.toISOString().slice(0, 10);
  const byDay = {};
  searches.forEach((r) => {
    const d = String(r.ts || "").slice(0, 10);
    if (!d) return;
    byDay[d] = byDay[d] || { billed: 0, cached: 0 };
    byDay[d][r.cached ? "cached" : "billed"] += 1;
  });
  const today = new Date();
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const k = ymd(new Date(today.getTime() - i * 86400000));
    const v = byDay[k] || { billed: 0, cached: 0 };
    daily.push({ date: k, billed: v.billed, cached: v.cached, total: v.billed + v.cached });
  }
  const countBy = (arr, field) => {
    const m = {};
    arr.forEach((r) => { const k = (r[field] || "").trim() || "(unknown)"; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  };
  // Corpus-first cost saver: of the searches we actually PAID for (billed report
  // searches — excludes cache hits, which cost nothing, and Explorer, which
  // runs the full search), how many reused the corpus and ran the reduced
  // web-search budget. Forward-looking: the source:"corpus" tag only exists from
  // the corpus-first-retrieval commit onward, so this reads low/empty at first.
  const billedReport = searches.filter((r) => !r.cached && (r.source || "") !== "explore");
  const corpusHits = billedReport.filter((r) => (r.source || "") === "corpus").length;
  // Estimated API spend. Report searches blend two prices because a corpus hit
  // runs a much smaller web_search budget, so this average genuinely falls as
  // corpus coverage grows — it is not just COST_REPORT_SEARCH restated. Market
  // (Explorer) searches never take that discount, so theirs stays flat.
  const billedMarket = searches.filter((r) => !r.cached && (r.source || "") === "explore").length;
  const fullPriceReports = billedReport.length - corpusHits;
  const reportSpend = fullPriceReports * COST_REPORT_SEARCH +
    corpusHits * COST_REPORT_SEARCH * CORPUS_HIT_COST_FACTOR;
  const marketSpend = billedMarket * COST_MARKET_SEARCH;
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    totals: {
      searches: searches.length,
      billed: searches.filter((r) => !r.cached).length,
      cached: searches.filter((r) => r.cached).length,
      leads: leads.length,
      shares: rows.filter((r) => r.kind === "share").length,
      comps: rows.filter((r) => r.kind === "comp").length,
    },
    conversionPct: searches.length ? Math.round((leads.length / searches.length) * 1000) / 10 : 0,
    daily,
    byType: countBy(searches, "prop_type"),
    topMarkets: countBy(searches, "market").slice(0, 12),
    leadsBySource: countBy(leads, "source"),
    // Property-type autofill. `applied` is the only outcome the visitor ever
    // sees; the rest explain the silence. Read `failed` as an infrastructure
    // signal (Overpass down or rate-limiting us) rather than as OSM coverage —
    // they are indistinguishable from the UI, which is why this exists.
    typeAutofill: (() => {
      const a = rows.filter((r) => r.kind === "type_autofill");
      const n = (o) => a.filter((r) => (r.source || "") === o).length;
      return {
        attempts: a.length,
        applied: n("applied"),
        agreed: n("agreed"),
        noAddressMatch: n("no_address_match"),
        ambiguous: n("ambiguous"),
        failed: n("failed"),
        pct: a.length ? Math.round((n("applied") / a.length) * 1000) / 10 : 0,
      };
    })(),
    corpus: {
      hits: corpusHits,
      billedReport: billedReport.length,
      pct: billedReport.length ? Math.round((corpusHits / billedReport.length) * 1000) / 10 : 0,
      // Persistence failures since the last restart. A 0% hit rate means
      // something very different depending on whether this is clean.
      health: { ...CORPUS_HEALTH },
    },
    // Estimates from COST_REPORT_SEARCH / COST_MARKET_SEARCH, not billed amounts.
    spend: {
      reportSearches: billedReport.length,
      marketSearches: billedMarket,
      avgReport: round2(billedReport.length ? reportSpend / billedReport.length : COST_REPORT_SEARCH),
      avgMarket: round2(COST_MARKET_SEARCH),
      reportTotal: round2(reportSpend),
      marketTotal: round2(marketSpend),
      total: round2(reportSpend + marketSpend),
      listPriceReport: round2(COST_REPORT_SEARCH),
    },
    eventCount: rows.length,
    capped: rows.length >= 10000,
  };
}

// Self-contained admin dashboard (own inline CSS/JS). Public shell, but shows
// nothing until a valid ADMIN_KEY is entered; the key is sent as a header to
// /api/stats (kept out of the URL) and remembered in sessionStorage.
//
// Styled with the same Research Desk palette/type as the landing page and
// /how-it-works (off-white ground, cream hairlines, Georgia headings, the one
// red accent) rather than the old slate/blue dashboard skin. The CSS is
// duplicated rather than shared with HOW_CSS on purpose: these are different
// components (tiles, chart, gate) that merely share tokens, and each page
// staying self-contained is what keeps them independent of tailwind.css.
function renderAdminHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>CompNinja Analytics</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<style>
*{box-sizing:border-box}
/* Flex column so the ink footer sits at the bottom even on the short key gate. */
body{margin:0;background:#FBFBF9;color:#1A2433;line-height:1.6;min-height:100vh;display:flex;flex-direction:column;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:#B91C1C;text-decoration:none}a:hover{color:#991B1B}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:#F5F4EF;border-radius:3px;padding:1px 5px}
.wrap{max-width:1024px;margin:0 auto;padding:0 16px}
/* Header — same bar as the landing page, so /admin reads as the same site. */
.hdr{border-bottom:1px solid #E4E2DA;background:#FBFBF9}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:10px;padding-top:16px;padding-bottom:16px}
.brand{display:flex;align-items:center;gap:10px;color:#1A2433}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#1A2433}
.wordmark b{color:#B91C1C;font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;font-size:13.5px}
.hdr nav a{color:#5A6473;white-space:nowrap}.hdr nav a:hover{color:#1A2433}
main{flex:1;padding:36px 0 64px}
.kicker{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:#B91C1C;font-weight:600}
.h{font-family:Georgia,'Times New Roman',serif;font-weight:500;letter-spacing:-.005em;color:#1A2433;margin:0}
h1.h{font-size:32px;line-height:1.15;margin:10px 0 0}
.sub{color:#4C5665;font-size:14px;max-width:62ch;margin:8px 0 0}
/* Key gate */
.gate{background:#fff;border:1px solid #D8D4C9;border-radius:6px;padding:26px;max-width:420px;margin:48px auto;text-align:center}
.gate .lab{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#8A93A0;font-weight:600}
.gate input{width:100%;padding:10px 12px;border:1px solid #D8D4C9;border-radius:4px;margin:12px 0;font-size:14px;
  font-family:inherit;color:#1A2433;background:#FBFBF9}
.gate input:focus{outline:none;border-color:#B91C1C}
.gate button,.btn{background:#B91C1C;color:#fff;border:0;border-radius:4px;padding:10px 22px;font-weight:600;
  font-size:14px;font-family:inherit;cursor:pointer}
.gate button:hover,.btn:hover{background:#991B1B}
.err{color:#B91C1C;font-size:13px;margin-top:8px}
/* Tile strip — hairline grid on white, like the landing page's stat strip.
   The 1px gaps show the container's cream background, so a partly-filled last
   row would render as a grey block. render() emits exactly 9 tiles, hence the
   fixed 1-or-3 column counts (both divide 9) instead of auto-fit: add or drop
   a tile and this needs a column count that divides the new total. */
.tiles{display:grid;grid-template-columns:1fr;gap:1px;background:#E4E2DA;
  border:1px solid #E4E2DA;border-radius:6px;overflow:hidden;margin:22px 0}
@media (min-width:560px){.tiles{grid-template-columns:repeat(3,1fr)}}
.tile{background:#fff;padding:16px 18px}
.tile .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:#8A93A0;font-weight:600}
.tile .v{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:27px;line-height:1.2;margin-top:4px;
  color:#1A2433;font-variant-numeric:tabular-nums}
.card{background:#fff;border:1px solid #D8D4C9;border-radius:6px;padding:20px 22px;margin:16px 0}
.card h2{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:#8A93A0;font-weight:600;margin:0 0 14px}
.card p{margin:0 0 8px;font-size:14px;color:#374253}
.chart{display:flex;align-items:flex-end;gap:3px;height:130px}
.chart .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-width:0}
.chart .b{background:#1A2433;border-radius:2px 2px 0 0}.chart .c{background:#D8D4C9}
.xax{display:flex;gap:3px;margin-top:6px;font-size:10px;color:#8A93A0}.xax div{flex:1;text-align:center;overflow:hidden;white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
td{padding:9px 8px 9px 0;border-top:1px solid #F0EFE9;color:#374253}
td:last-child{text-align:right;font-weight:600;padding-right:0}
.leg{font-size:12.5px;color:#5A6473;margin-top:10px}
.leg span{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 12px;vertical-align:middle}
.muted{color:#8A93A0;font-size:12.5px}
/* Footer — the navy ink footer from the home page, trimmed for a private page. */
footer{background:#1A2433;color:#B8C0CC;font-size:13px}
footer .wrap{padding:28px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
footer .wordmark{color:#fff}
footer a{color:#D5DAE2;text-decoration:none}footer a:hover{color:#fff}
</style></head><body>
<header class="hdr">
  <div class="wrap">
    <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
    <nav>
      <a href="/dev">Dev log</a>
      <a href="/contacts">Contacts</a>
      <a href="/markets">Markets</a>
      <a href="/how-it-works">How it works</a>
      <a href="/">Run a report</a>
    </nav>
  </div>
</header>
<main>
<div class="wrap">
<div class="kicker">Internal</div>
<h1 class="h">Analytics</h1>
<p class="sub">Searches, corpus coverage, estimated spend, and lead conversion. Events are PII-free &mdash;
  city and state only, never a street address.</p>
<div id="gate" class="gate"><span class="lab">Enter admin key</span>
<input id="k" type="password" placeholder="ADMIN_KEY" autocomplete="off"/>
<button id="go">View analytics</button><div id="err" class="err"></div></div>
<div id="dash" style="display:none"></div>
<div id="subs" style="display:none"></div>
</div>
</main>
<footer><div class="wrap">
  <span class="wordmark">Comp<b style="color:#EF4444">Ninja</b></span>
  <span>Internal dashboard &middot; <a href="/">Back to the app</a></span>
</div></footer>
<script>
var KEYK="cn_admin_key";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function rows(a){return a.length?a.map(function(x){return "<tr><td>"+esc(x.label)+"</td><td>"+x.count+"</td></tr>";}).join(""):"<tr><td class=muted colspan=2>No data yet</td></tr>";}
function render(d){
  var t=d.totals, hit=t.searches?Math.round(t.cached/t.searches*100):0;
  var c=d.corpus||{hits:0,billedReport:0,pct:0,health:{}};
  // Absent on a stale /api/stats from before this tile existed.
  var ta=d.typeAutofill||{attempts:0,applied:0,agreed:0,noAddressMatch:0,ambiguous:0,failed:0,pct:0};
  // null only on a stale /api/stats response from before the cost tiles existed.
  // Render an em-dash rather than $0.00, which would read as "searches are free".
  var sp=d.spend||null;
  var money=function(n){return "$"+Number(n||0).toFixed(2);};
  var max=Math.max(1,Math.max.apply(null,d.daily.map(function(x){return x.total;})));
  var bars=d.daily.map(function(x){var bh=Math.round(x.billed/max*120),ch=Math.round(x.cached/max*120);
    return "<div class=col title='"+x.date+": "+x.billed+" billed, "+x.cached+" cached'><div class=c style='height:"+ch+"px'></div><div class=b style='height:"+bh+"px'></div></div>";}).join("");
  var xax=d.daily.map(function(x,i){return "<div>"+((i%5===0)?x.date.slice(5):"")+"</div>";}).join("");
  // Corpus persistence alarm. Sits above the tiles because a 0% corpus hit
  // rate is meaningless until you know whether the corpus is even being
  // written — the failure this catches froze the corpus for weeks unnoticed.
  var h=c.health||{}, broken=(h.writeFallbacks||0)+(h.readFailures||0);
  var alarm = broken ? (
    "<div class=card style='border:1px solid #B91C1C;background:#FCF3F2'>"+
    "<h2 style='color:#B91C1C;margin-bottom:8px;font-family:Georgia,serif;font-weight:500;"+
    "font-size:19px;text-transform:none;letter-spacing:normal'>Comp corpus is not persisting</h2>"+
    (h.schemaMismatch
      ? "<p><b>This looks like a missing column.</b> The <code>alter table</code> for a new per-comp "+
        "field was probably never run &mdash; the DDL is in the comment above <code>harvestComps()</code> "+
        "in server.js. Until it runs, harvested comps land in an ephemeral file and corpus-first "+
        "retrieval returns nothing, so the hit rate below is pinned at 0%.</p>"
      : "<p>Supabase writes or reads for <code>comp_corpus</code> are failing, so harvested comps "+
        "are going to an ephemeral file that is wiped on every redeploy.</p>")+
    "<p class=muted>"+esc(h.writeFallbacks||0)+" write fallback(s), "+esc(h.readFailures||0)+
    " read failure(s) since the last restart"+(h.lastErrorAt?" &middot; last at "+esc(h.lastErrorAt):"")+".</p>"+
    (h.lastError?"<p class=muted style='word-break:break-word'>"+esc(h.lastError)+"</p>":"")+
    "</div>") : "";
  document.getElementById("dash").innerHTML=
    alarm+
    "<div class=tiles>"+
    "<div class=tile><div class=k>Searches</div><div class=v>"+t.searches+"</div></div>"+
    "<div class=tile><div class=k>Billed</div><div class=v>"+t.billed+"</div></div>"+
    "<div class=tile><div class=k>Cache hit rate</div><div class=v>"+hit+"%</div></div>"+
    "<div class=tile><div class=k>Corpus hit rate</div><div class=v>"+c.pct+"%</div><div class=muted style='margin-top:2px'>"+c.hits+" of "+c.billedReport+" billed</div></div>"+
    "<div class=tile title='applied = set the type. agreed = already correct. no match = OpenStreetMap has no building at that house number. ambiguous = building mapped but untyped. failed = Overpass down or rate-limiting us.'>"+
      "<div class=k>Type autofill</div><div class=v>"+ta.pct+"%</div>"+
      "<div class=muted style='margin-top:2px'>"+ta.applied+" applied of "+ta.attempts+"</div>"+
      (ta.attempts?"<div class=muted style='margin-top:2px'>"+ta.agreed+" agreed &middot; "+ta.noAddressMatch+
        " no match &middot; "+ta.ambiguous+" ambiguous &middot; "+ta.failed+" failed</div>":"")+
    "</div>"+
    "<div class=tile><div class=k>Avg comp search</div><div class=v>"+(sp?money(sp.avgReport):"&mdash;")+"</div><div class=muted style='margin-top:2px'>"+
      (sp ? sp.reportSearches+" billed · "+money(sp.reportTotal)+" est"+
            (sp.avgReport < sp.listPriceReport ? " · corpus saving" : "")
          : "no cost data")+"</div></div>"+
    "<div class=tile><div class=k>Avg market search</div><div class=v>"+(sp?money(sp.avgMarket):"&mdash;")+"</div><div class=muted style='margin-top:2px'>"+
      (sp ? sp.marketSearches+" billed · "+money(sp.marketTotal)+" est" : "no cost data")+"</div></div>"+
    "<div class=tile><div class=k>Leads</div><div class=v>"+t.leads+"</div></div>"+
    "<div class=tile><div class=k>Conversion</div><div class=v>"+d.conversionPct+"%</div></div>"+
    "<div class=tile><div class=k>Shares</div><div class=v>"+t.shares+"</div></div>"+
    "</div>"+
    "<div class=card><h2>Searches per day (last 30 days)</h2><div class=chart>"+bars+"</div><div class=xax>"+xax+"</div>"+
    "<div class=leg><span style='background:#1A2433'></span>Billed<span style='background:#D8D4C9'></span>Cache hit</div></div>"+
    "<div class=card><h2>Searches by property type</h2><table>"+rows(d.byType)+"</table></div>"+
    "<div class=card><h2>Top markets searched</h2><table>"+rows(d.topMarkets)+"</table></div>"+
    "<div class=card><h2>Leads by source</h2><table>"+rows(d.leadsBySource)+"</table>"+
    "<div class=muted style='margin-top:10px'>bov = Broker Opinion of Value request · export = export unlock. "+t.comps+" broker comp submission(s). "+d.eventCount+" events logged"+(d.capped?" (capped at 10k)":"")+".</div></div>"+
    (!sp ? "" :
    "<div class=card><h2>About the cost tiles</h2><div class=muted>Estimates, not billed amounts &mdash; no invoice is read. "+
    "A comp (report) search is assumed "+money(sp.listPriceReport)+"; a corpus-assisted one runs a much smaller web-search budget, so the "+
    "average falls below that as corpus coverage grows. A market (Explorer) search is assumed "+money(sp.avgMarket)+" and never takes that "+
    "discount, because the Explorer path always runs the full budget. Cache hits are free and excluded from both. "+
    "Tune with the COST_REPORT_SEARCH and COST_MARKET_SEARCH env vars once real Anthropic invoices land. "+
    "Estimated total to date: "+money(sp.total)+".</div></div>");
  document.getElementById("gate").style.display="none";
  document.getElementById("dash").style.display="block";
}
// Broker comp submissions: everything broker-supplied is attacker-controlled
// text rendered into the admin's page, so every value goes through esc() and
// buttons carry only a numeric data-id (no inline handlers built from data).
function subRow(x){
  var who=esc(x.broker_name)+(x.broker_company?" ("+esc(x.broker_company)+")":"")+" · "+esc(x.broker_email);
  var comp=esc(x.address)+" — "+esc(x.property_type||"?")+(x.transaction?" · "+esc(x.transaction):"")+" · "+esc(x.price_or_rate)+(x.deal_date?" · "+esc(x.deal_date):"");
  var notes=x.notes?"<div class=muted>"+esc(String(x.notes).slice(0,160))+"</div>":"";
  return "<tr><td style='text-align:left'><div style='font-weight:600'>"+comp+"</div><div class=muted>"+who+"</div>"+notes+"</td>"+
    "<td style='white-space:nowrap'><button class='btn ap' data-id='"+Number(x.id)+"'>Approve</button> "+
    "<button class='btn rj' data-id='"+Number(x.id)+"' style='background:#5A6473'>Reject</button></td></tr>";
}
function renderSubs(d,key){
  var el=document.getElementById("subs"), inner;
  if(!d.db){inner="<div class=muted>Approval requires Supabase (DB not configured on this server).</div>";}
  else if(!d.rows.length){inner="<div class=muted>No pending submissions.</div>";}
  else{inner="<table>"+d.rows.map(subRow).join("")+"</table>";}
  el.innerHTML="<div class=card><h2>Pending comp submissions</h2>"+inner+"</div>";
  el.style.display="block";
  el.querySelectorAll("button.ap,button.rj").forEach(function(b){
    b.addEventListener("click",function(){
      var approve=b.classList.contains("ap");
      if(!approve&&!confirm("Reject this submission? The broker is not notified."))return;
      b.disabled=true;
      fetch("/api/admin/submission-status",{method:"POST",headers:{"x-admin-key":key,"content-type":"application/json"},
        body:JSON.stringify({id:Number(b.getAttribute("data-id")),status:approve?"approved":"rejected"})})
      .then(function(r){if(!r.ok){throw new Error("Error "+r.status);}return r.json();})
      .then(function(){loadSubs(key);})
      .catch(function(e){alert(e.message);b.disabled=false;});
    });
  });
}
function loadSubs(key){
  fetch("/api/admin/submissions",{headers:{"x-admin-key":key}})
    .then(function(r){if(!r.ok){throw new Error("subs "+r.status);}return r.json();})
    .then(function(d){renderSubs(d,key);})
    .catch(function(e){console.error(e);});
}
function load(key){
  fetch("/api/stats",{headers:{"x-admin-key":key}}).then(function(r){
    if(r.status===401){throw new Error("Incorrect key.");}
    if(r.status===404){throw new Error("Analytics is disabled — set ADMIN_KEY on the server.");}
    if(!r.ok){throw new Error("Error "+r.status);}
    return r.json();
  }).then(function(d){try{sessionStorage.setItem(KEYK,key);}catch(e){} render(d); loadSubs(key);})
  .catch(function(e){document.getElementById("err").textContent=e.message;
    document.getElementById("gate").style.display="block";document.getElementById("dash").style.display="none";});
}
document.getElementById("go").addEventListener("click",function(){load(document.getElementById("k").value.trim());});
document.getElementById("k").addEventListener("keydown",function(e){if(e.key==="Enter")load(e.target.value.trim());});
try{var sk=sessionStorage.getItem(KEYK);if(sk){load(sk);}}catch(e){}
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Development hub (/dev) — internal changelog + future-ideas list, gated by
// the same ADMIN_KEY as /admin. The changelog is the repo-committed
// devlog.json (see the standing rule in CLAUDE.md: every shipped
// fix/improvement/feature appends an entry in the same commit). Ideas live in
// the Supabase dev_ideas table with a whole-file dev-ideas.json fallback
// (git-ignored; ephemeral on most hosts). Run this DDL in Supabase before
// deploying:
//   create table if not exists dev_ideas (
//     id text primary key,
//     text text not null,
//     status text not null default 'open',
//     priority text,
//     notes text,
//     done_at timestamptz,
//     created_at timestamptz not null default now()
//   );
// Tables created before priority/notes/done_at existed need (run before
// deploying — PostgREST 400s on unknown columns, the comp-corpus lesson):
//   alter table dev_ideas
//     add column if not exists priority text,
//     add column if not exists notes text,
//     add column if not exists done_at timestamptz;
// ---------------------------------------------------------------------------
async function readDevIdeas() {
  let fileIdeas = [];
  try {
    const parsed = JSON.parse(await fs.promises.readFile(DEV_IDEAS_FILE, "utf8"));
    if (Array.isArray(parsed)) fileIdeas = parsed;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("dev-ideas.json unreadable:", err.message);
  }
  if (!DB_CONFIGURED) return fileIdeas;
  try {
    const rows = await sbRequest("GET", "dev_ideas?select=id,text,status,priority,notes,done_at,created_at&order=created_at.asc");
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("dev_ideas DB read failed — returning file ideas:", err.message);
    return fileIdeas;
  }
}
// Whole-list replace, like the other admin-managed lists. Upsert first, prune
// second — the previous DELETE-all-then-POST could leave the table empty when
// the POST half failed. Ids are server-validated UUIDs (the PUT normalizer
// regenerates anything else), so they are safe inside the not.in.() filter.
// A DB failure falls back to the file so a save is never lost outright
// (though the file is ephemeral on most hosts — the DDL above is the durable
// path).
async function writeDevIdeas(ideas) {
  if (DB_CONFIGURED) {
    try {
      if (ideas.length) {
        await sbRequest("POST", "dev_ideas?on_conflict=id", ideas, { Prefer: "resolution=merge-duplicates" });
        await sbRequest("DELETE", `dev_ideas?id=not.in.(${ideas.map((i) => i.id).join(",")})`);
      } else {
        await sbRequest("DELETE", "dev_ideas?id=not.is.null");
      }
      return "db";
    } catch (err) {
      console.error("dev_ideas DB write failed — falling back to file:", err.message);
    }
  }
  await fs.promises.writeFile(DEV_IDEAS_FILE, JSON.stringify(ideas, null, 2));
  return "file";
}

// ---------------------------------------------------------------------------
// Contacts — the internal rolodex behind /contacts. Leads, brokers, owners,
// vendors: whoever the team wants to keep a number for. ADMIN_KEY-gated like
// /admin and /dev, and deliberately NOT wired to the public lead funnel —
// POST /api/lead still writes to `leads`; this is the hand-curated book the
// team maintains itself.
//
// Unlike dev_ideas (whole-list PUT) this saves ONE contact at a time, because
// several people share the key and a whole-list replace would let one person's
// stale tab silently wipe a colleague's new entry. Cost is one extra route.
//
// PII lives here, so contacts.json is git-ignored and the CSV export is
// ADMIN_KEY-gated. Run this DDL in Supabase before deploying — PostgREST 400s
// on unknown columns and the write would fall back to the ephemeral file
// (the comp-corpus lesson):
//   create table if not exists contacts (
//     id text primary key,
//     name text not null,
//     company text,
//     role text,
//     phone text,
//     email text,
//     market text,
//     category text not null default 'lead',
//     status text not null default 'new',
//     notes text,
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );
// ---------------------------------------------------------------------------
const CONTACT_COLS = ["id", "name", "company", "role", "phone", "email",
  "market", "category", "status", "notes", "created_at", "updated_at"];
const CONTACT_CATEGORIES = ["lead", "broker", "owner", "investor", "vendor", "other"];
const CONTACT_STATUSES = ["new", "contacted", "following-up", "client", "dead"];

async function readContactsFile() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(CONTACTS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code !== "ENOENT") console.error("contacts.json unreadable:", err.message);
    return [];
  }
}

async function readContacts() {
  const fileContacts = await readContactsFile();
  if (!DB_CONFIGURED) return fileContacts;
  try {
    const rows = await sbRequest("GET",
      `contacts?select=${CONTACT_COLS.join(",")}&order=updated_at.desc&limit=5000`);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("contacts DB read failed — returning file contacts:", err.message);
    return fileContacts;
  }
}

// Upsert by id. Returns "db" or "file" so the caller can warn when a save
// landed somewhere a redeploy will wipe.
async function saveContact(contact) {
  if (DB_CONFIGURED) {
    try {
      await sbRequest("POST", "contacts?on_conflict=id", [contact],
        { Prefer: "resolution=merge-duplicates" });
      return "db";
    } catch (err) {
      console.error("contacts DB write failed — falling back to file:", err.message);
    }
  }
  const all = await readContactsFile();
  const i = all.findIndex((c) => c.id === contact.id);
  if (i >= 0) all[i] = contact; else all.push(contact);
  await fs.promises.writeFile(CONTACTS_FILE, JSON.stringify(all, null, 2));
  return "file";
}

async function deleteContact(id) {
  if (DB_CONFIGURED) {
    try {
      await sbRequest("DELETE", `contacts?id=eq.${encodeURIComponent(id)}`);
      return "db";
    } catch (err) {
      console.error("contacts DB delete failed — falling back to file:", err.message);
    }
  }
  const all = await readContactsFile();
  await fs.promises.writeFile(CONTACTS_FILE,
    JSON.stringify(all.filter((c) => c.id !== id), null, 2));
  return "file";
}

// Trims, length-caps and whitelists a submitted contact. Everything except a
// name is optional — a scribbled name and number has to be a valid entry, or
// people stop using the book.
function sanitizeContact(body, existing) {
  const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  const name = str(body.name, 120);
  if (!name) return null;
  const category = CONTACT_CATEGORIES.includes(body.category) ? body.category : "lead";
  const status = CONTACT_STATUSES.includes(body.status) ? body.status : "new";
  const now = new Date().toISOString();
  return {
    id: existing ? existing.id : crypto.randomUUID(),
    name,
    company: str(body.company, 120),
    role: str(body.role, 120),
    phone: str(body.phone, 60),
    email: str(body.email, 160),
    market: str(body.market, 120),
    category,
    status,
    notes: str(body.notes, 2000),
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
}

// Click-to-edit overlay for the changelog. devlog.json stays the
// repo-committed source of truth, and the host filesystem is ephemeral, so
// UI edits and notes live in the Supabase devlog_overrides table — keyed by
// the FILE entry's original date+title — and are merged over the file at
// read time. An override row stores the full {title, details, notes}
// snapshot; deleting the row restores the committed text. Run in Supabase
// before deploying:
//   create table if not exists devlog_overrides (
//     key text primary key,
//     title text,
//     details text,
//     notes text,
//     updated_at timestamptz not null default now()
//   );
function devlogKey(e) { return String((e && e.date) || "") + "|" + String((e && e.title) || ""); }

function readDevlogFileEntries() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DEVLOG_FILE, "utf8")); // per-request: devlog edits need no restart
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    console.error("devlog.json unreadable:", err.message);
  }
  return [];
}

async function readOverridesFileMap() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(DEVLOG_OVERRIDES_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("devlog-overrides.json unreadable:", err.message);
  }
  return {};
}

async function readDevlogOverrides() {
  const map = await readOverridesFileMap();
  if (!DB_CONFIGURED) return map;
  try {
    const rows = await sbRequest("GET", "devlog_overrides?select=key,title,details,notes");
    (Array.isArray(rows) ? rows : []).forEach((r) => { map[r.key] = { title: r.title, details: r.details, notes: r.notes }; });
  } catch (err) {
    console.error("devlog_overrides DB read failed — using file overrides:", err.message);
  }
  return map;
}

// patch = {title, details, notes} to upsert, or null to delete the override.
// Returns "db" or "file" so the caller can tell the admin when an edit only
// landed in the ephemeral file (i.e. the DDL above hasn't been run yet).
async function writeDevlogOverride(key, patch) {
  if (DB_CONFIGURED) {
    try {
      if (patch) {
        await sbRequest("POST", "devlog_overrides?on_conflict=key",
          [{ key, title: patch.title, details: patch.details, notes: patch.notes, updated_at: new Date().toISOString() }],
          { Prefer: "resolution=merge-duplicates" });
      } else {
        await sbRequest("DELETE", `devlog_overrides?key=eq.${encodeURIComponent(key)}`);
      }
      return "db";
    } catch (err) {
      console.error("devlog_overrides DB write failed — falling back to file:", err.message);
    }
  }
  const map = await readOverridesFileMap();
  if (patch) map[key] = patch; else delete map[key];
  await fs.promises.writeFile(DEVLOG_OVERRIDES_FILE, JSON.stringify(map, null, 2));
  return "file";
}

// The merged view the hub renders: file entries with any override applied.
// `overridden` marks changed text (drives the "edited" tag + restore link);
// a notes-only override keeps the committed text but still shows the note.
async function readDevlogMerged() {
  const entries = readDevlogFileEntries();
  const ov = await readDevlogOverrides();
  return entries.map((e) => {
    const key = devlogKey(e);
    const o = ov[key];
    if (!o) return { ...e, key, notes: "", overridden: false };
    const title = String(o.title || e.title);
    const details = o.details === null || o.details === undefined ? String(e.details || "") : String(o.details);
    return {
      ...e, key, title, details,
      notes: String(o.notes || ""),
      overridden: title !== String(e.title || "") || details !== String(e.details || ""),
    };
  });
}

// Self-contained dev-hub page: same public-shell + key-gate pattern and
// Research Desk skin as /admin (CSS deliberately duplicated — self-contained
// pages stay independent of tailwind.css). Shares /admin's sessionStorage key
// so unlocking either page unlocks both.
function renderDevHubHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>CompNinja Development Hub</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<style>
/* Editorial release-notes layout. Same CompNinja tokens as the rest of the
   site; the discipline is in the restraint. Five rules hold it together and
   each erodes one convenience at a time:
     1. ONE type scale (--t1..--t6). No ad-hoc px sizes — the old page had
        twelve, which is the single most reliable "generated" tell.
     2. ONE spacing scale (--s1..--s9). No ad-hoc px margins/padding/gaps.
        This page shipped once with the type scale done and TWENTY-FIVE
        spacing values, which is the same defect wearing a different hat.
     3. ONE radius (--r), on controls only. Content is never boxed: days are
        separated by hairlines, not cards floating on a tint.
     4. UPPERCASE is reserved for the page kicker and the wordmark. Every
        other label reads in sentence case. Nine competing caps labels are
        what made this look machine-assembled rather than designed.
     5. RED means interaction, never content. Links, buttons, focus, errors,
        the active filter. The changelog's own entries must not compete with
        the page's controls for the same accent.
   Colours are tokens only. The single exception below :root is plain #fff,
   which is a primitive rather than a brand colour. Everything else that was
   a loose hex — the fix dot, the note grey, both footer greys — is a token. */
*{box-sizing:border-box}
:root{
  --ink:#1A2433;--ink-2:#4C5665;--ink-3:#8A93A0;--ink-4:#C7CBD2;
  --red:#B91C1C;--red-deep:#991B1B;--red-pale:#E8B4B4;
  --paper:#FBFBF9;--line:#E4E2DA;--hair:#F0EFE9;--wash:#F5F4EF;--edge:#D8D4C9;
  --note:#5F5E5A;--foot-ink:#B8C0CC;--foot-link:#D5DAE2;
  --serif:Georgia,'Times New Roman',serif;
  --r:4px;
  --t1:32px;--t2:19px;--t3:15px;--t4:14px;--t5:12.5px;--t6:11px;
  --s1:2px;--s2:4px;--s3:8px;--s4:12px;--s5:16px;--s6:24px;--s7:32px;--s8:48px;--s9:80px;
  /* The spine: a fixed measure, not rhythm. Deliberately NOT on the spacing
     scale — the changelog's dates and the ideas list's bucket names share
     this exact column, and it is the one thing aligning the two halves. */
  --spine:104px;--spine-gap:30px;
}
body{margin:0;background:var(--paper);color:var(--ink);line-height:1.65;min-height:100vh;
  display:flex;flex-direction:column;font-size:var(--t4);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--red);text-decoration:none}a:hover{color:var(--red-deep)}
.wrap{max-width:820px;margin:0 auto;padding:0 var(--s6)}
.hdr{border-bottom:1px solid var(--line);background:var(--paper)}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:var(--s4);padding-top:var(--s5);padding-bottom:var(--s5)}
.brand{display:flex;align-items:center;gap:var(--s4);color:var(--ink)}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:var(--t3);font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.wordmark b{color:var(--red);font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s4) var(--s5);font-size:var(--t5)}
.hdr nav a{color:var(--ink-2);white-space:nowrap}.hdr nav a:hover{color:var(--ink)}
main{flex:1;padding:var(--s8) 0 var(--s9)}
.kicker{font-size:var(--t6);letter-spacing:.16em;text-transform:uppercase;color:var(--red);font-weight:600}
.h{font-family:var(--serif);font-weight:500;letter-spacing:-.005em;color:var(--ink);margin:0}
h1.h{font-size:var(--t1);line-height:1.15;margin:var(--s4) 0 0}
.sub{color:var(--ink-2);font-size:var(--t4);max-width:60ch;margin:var(--s4) 0 0}
.gate{background:#fff;border:1px solid var(--edge);border-radius:var(--r);padding:var(--s6);max-width:400px;margin:var(--s8) auto;text-align:center}
.gate .lab{display:block;font-size:var(--t5);color:var(--ink-3)}
.gate input{width:100%;padding:var(--s4);border:1px solid var(--edge);border-radius:var(--r);margin:var(--s4) 0;
  font-size:var(--t4);font-family:inherit;color:var(--ink);background:var(--paper)}
.gate input:focus{outline:none;border-color:var(--red)}
.gate button,.btn{background:var(--red);color:#fff;border:0;border-radius:var(--r);padding:var(--s4) var(--s6);font-weight:600;
  font-size:var(--t4);font-family:inherit;cursor:pointer}
.gate button:hover,.btn:hover{background:var(--red-deep)}
.err{color:var(--red);font-size:var(--t5);margin-top:var(--s3)}

/* Sections are typographic, not boxed: a serif heading and a rule. */
#hub{margin-top:var(--s8)}
.card{background:none;border:0;border-radius:0;padding:0;margin:0}
.card+.card{margin-top:var(--s8);border-top:1px solid var(--line);padding-top:var(--s7)}
.card h2{font-family:var(--serif);font-weight:500;font-size:var(--t2);letter-spacing:-.005em;color:var(--ink);
  text-transform:none;margin:0 0 var(--s6)}

/* A day is one grid row: the date sits in the margin, its entries stack in
   the text column. This is the whole look — it reads as a dated document
   rather than a list of status pills. */
.day{display:grid;grid-template-columns:var(--spine) minmax(0,1fr);column-gap:var(--spine-gap);padding:var(--s6) 0}
.day+.day{border-top:1px solid var(--hair)}
.day-date{grid-column:1;grid-row:1;font-family:var(--serif);font-size:var(--t3);color:var(--ink);
  line-height:1.35;margin:0;padding-top:var(--s1)}
.day-date .dd-y{display:block;font-size:var(--t5);color:var(--ink-3)}
.entry{grid-column:2;display:block;padding:0}
.entry+.entry{margin-top:var(--s6)}
.entry-title{font-weight:600;font-size:var(--t3);line-height:1.45;color:var(--ink)}
.entry-details{color:var(--ink-2);font-size:var(--t4);margin-top:var(--s2);max-width:66ch}
/* Type reads as a marked word, not a filled chip. One shape in three weights
   rather than three colours — red is reserved for interaction (rule 5), so
   the changelog's own entries never compete with the page's controls. */
.badge{display:inline-flex;align-items:center;gap:var(--s3);background:none;border:0;padding:0;min-width:0;
  border-radius:0;text-align:left;font-size:var(--t5);font-weight:500;letter-spacing:0;
  text-transform:capitalize;color:var(--ink-2);white-space:nowrap}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ink-3);flex:none}
.badge.feature::before{background:var(--ink)}                                    /* filled  */
.badge.improvement::before{background:none;box-shadow:inset 0 0 0 1.5px var(--ink-3)}  /* ring */
.badge.fix::before{background:var(--ink-4)}                                      /* pale    */
/* Ideas share the changelog's spine: one .bucket per group, gridded on the
   SAME --spine column, so "Now / Next / Later" sit exactly where the dates
   do and the two halves of the page line up. Needs the wrapper emitted by
   renderIdeas() — a flat sibling list cannot do this (auto-placement would
   put the second heading beside the first bucket's rows). */
.bucket{display:grid;grid-template-columns:var(--spine) minmax(0,1fr);column-gap:var(--spine-gap);padding:var(--s6) 0}
.bucket+.bucket{border-top:1px solid var(--hair)}
.bucket-h{grid-column:1;grid-row:1;font-family:var(--serif);font-size:var(--t3);letter-spacing:0;
  text-transform:none;color:var(--ink);font-weight:500;margin:0;padding-top:var(--s1)}
.bucket-body{grid-column:2;min-width:0}
/* Rows stay flex INSIDE the text column: checkbox / text / priority / actions
   is a row of controls, not a second grid. */
.idea{display:flex;align-items:flex-start;gap:var(--s4);padding:var(--s4) 0;border-top:1px solid var(--hair);font-size:var(--t4)}
.bucket-body>.idea:first-child{border-top:none;padding-top:0}
.idea input[type=checkbox]{width:15px;height:15px;accent-color:var(--red);flex:none;cursor:pointer;margin-top:var(--s2)}
.idea .tx{flex:1;min-width:0}
.idea .t{overflow-wrap:anywhere;color:var(--ink)}
.idea .n{color:var(--ink-3);font-size:var(--t5);margin-top:var(--s1);overflow-wrap:anywhere}
.idea .n-edit{display:block;width:100%;margin-top:var(--s2);padding:var(--s3);border:1px solid var(--edge);border-radius:var(--r);
  font-family:inherit;font-size:var(--t5);color:var(--ink);background:var(--paper)}
.idea .n-edit:focus{outline:none;border-color:var(--red)}
.idea.done .t{color:var(--ink-3);text-decoration:line-through}
.idea .d{color:var(--ink-3);font-size:var(--t5);white-space:nowrap}
.idea .rm,.idea .nt{background:none;border:0;color:var(--ink-3);font-size:var(--t5);cursor:pointer;font-family:inherit;padding:var(--s1) var(--s2)}
.idea .rm:hover{color:var(--red);text-decoration:underline}.idea .nt:hover{color:var(--ink);text-decoration:underline}
.idea .rm.armed{color:var(--red);font-weight:600;text-decoration:underline}
.idea .pr{flex:none;background:none;border:1px solid var(--edge);border-radius:var(--r);color:var(--ink-2);
  font-size:var(--t5);font-weight:500;letter-spacing:0;text-transform:none;padding:var(--s1) var(--s3);cursor:pointer;
  font-family:inherit;margin-top:var(--s1)}
.idea .pr:hover{border-color:var(--ink-3)}
.idea .pr.now{border-color:var(--red-pale);color:var(--red)}
.idea .pr.later{color:var(--ink-3)}
#ideas.busy{opacity:.55;pointer-events:none}
/* Filters read as a line of links, not a raised widget — the active one is
   simply the one set in ink, underlined. */
.logbar{display:flex;align-items:baseline;gap:var(--s4);flex-wrap:wrap;margin:0 0 var(--s2)}
.seg{display:inline-flex;flex-wrap:wrap;background:none;border:0;border-radius:0;padding:0;gap:var(--s5)}
.seg button{background:none;border:0;border-radius:0;padding:0 0 var(--s1);font-family:inherit;font-size:var(--t5);
  color:var(--ink-3);cursor:pointer;display:inline-flex;align-items:baseline;gap:var(--s2);white-space:nowrap;
  border-bottom:1px solid transparent}
.seg button:hover{color:var(--ink)}
.seg button .n{font-size:var(--t6);color:var(--ink-3);font-variant-numeric:tabular-nums}
.seg button.on{background:none;color:var(--ink);font-weight:600;box-shadow:none;border-bottom-color:var(--red)}
.seg button.on .n{color:var(--red)}
.logsearch{flex:1;min-width:160px;max-width:240px;padding:var(--s2) 0;border:0;border-bottom:1px solid var(--edge);
  border-radius:0;font-size:var(--t5);font-family:inherit;color:var(--ink);background:none}
.logsearch::placeholder{color:var(--ink-3)}
.logsearch:focus{outline:none;border-bottom-color:var(--red)}
.logmeta{color:var(--ink-3);font-size:var(--t5);margin:0 0 var(--s5)}
.cmt{font-size:var(--t5);font-weight:400;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;margin-left:var(--s3)}
/* The negative margin must stay the exact inverse of the padding, or the
   hover background sits off the text it belongs to. Kept literal for that
   reason — this is a mirror, not rhythm. */
.ebody{min-width:0;border-radius:var(--r);padding:3px 9px;margin:-3px -9px;cursor:pointer}
.ebody:hover{background:var(--wash)}
.ebody.editing{cursor:default;background:none;padding:0;margin:0}
.edited-tag{font-size:var(--t5);font-weight:400;letter-spacing:0;text-transform:none;color:var(--ink-3);
  border:0;border-radius:0;padding:0;margin-left:var(--s3);font-style:italic}
.entry-note{color:var(--note);font-size:var(--t5);margin-top:var(--s2);overflow-wrap:anywhere;max-width:66ch;
  border-left:2px solid var(--edge);padding-left:var(--s4)}
.entry-note::before{content:"Note ";font-weight:600;color:var(--ink-3)}
.ed{display:flex;flex-direction:column;gap:var(--s3);padding:var(--s5);border:1px solid var(--edge);border-radius:var(--r);background:#fff}
.ed label{font-size:var(--t5);letter-spacing:0;text-transform:none;color:var(--ink-3);font-weight:500}
.ed input,.ed textarea{width:100%;padding:var(--s3);border:1px solid var(--edge);border-radius:var(--r);
  font-family:inherit;font-size:var(--t5);color:var(--ink);background:var(--paper);margin-top:calc(var(--s2) * -1)}
.ed textarea{resize:vertical;min-height:52px;line-height:1.6}
.ed input:focus,.ed textarea:focus{outline:none;border-color:var(--red)}
.ed .row{display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap;margin-top:var(--s1)}
.ed .btn.sm{padding:var(--s3) var(--s5);font-size:var(--t5)}
.ed .lnk{background:none;border:0;color:var(--ink-3);font-size:var(--t5);cursor:pointer;font-family:inherit;padding:var(--s1) 0}
.ed .lnk:hover{color:var(--red);text-decoration:underline}
.ed .spacer{flex:1}
details.month{border-top:1px solid var(--line);margin-top:0;padding-top:0}
summary.month-sum{cursor:pointer;font-family:var(--serif);font-size:var(--t3);color:var(--ink-2);padding:var(--s5) 0;
  list-style:none;display:flex;align-items:baseline;gap:var(--s3)}
summary.month-sum::-webkit-details-marker{display:none}
/* Literal + / − glyphs: a CSS \\2212 escape would be read as an octal escape
   by the template literal this stylesheet lives inside. */
summary.month-sum::after{content:"+";color:var(--ink-3);font-family:inherit}
details.month[open] summary.month-sum::after{content:"−"}
summary.month-sum:hover{color:var(--red)}
details.month .day:first-of-type{border-top:1px solid var(--hair);margin-top:0}
.add{display:flex;gap:var(--s4);margin-top:var(--s6)}
.add input{flex:1;min-width:0;padding:var(--s3) var(--s4);border:1px solid var(--edge);border-radius:var(--r);font-size:var(--t4);
  font-family:inherit;color:var(--ink);background:var(--paper)}
.add input:focus{outline:none;border-color:var(--red)}
.muted{color:var(--ink-3);font-size:var(--t5)}
/* LAST in the sheet on purpose. Both spined grids (.day, .bucket) are defined
   above at the same specificity, so an earlier media block loses to whichever
   rule is declared later — .bucket kept its two columns on a phone until this
   moved down here. */
@media (max-width:640px){
  .day,.bucket{grid-template-columns:minmax(0,1fr);row-gap:var(--s4);padding:var(--s6) 0}
  .day-date,.bucket-h{grid-column:1;grid-row:auto;padding-top:0}
  .day-date .dd-y{display:inline;font-size:inherit;color:var(--ink-3)}
  .day-date .dd-y::before{content:", "}
  .entry,.bucket-body{grid-column:1}
}
footer{background:var(--ink);color:var(--foot-ink);font-size:var(--t5)}
footer .wrap{padding:var(--s7) var(--s6);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--s4)}
footer .wordmark{color:#fff}
footer a{color:var(--foot-link);text-decoration:none}footer a:hover{color:#fff}
</style></head><body>
<header class="hdr">
  <div class="wrap">
    <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
    <nav>
      <a href="/admin">Analytics</a>
      <a href="/contacts">Contacts</a>
      <a href="/">Run a report</a>
    </nav>
  </div>
</header>
<main>
<div class="wrap">
<div class="kicker">Internal</div>
<h1 class="h">Development Hub</h1>
<p class="sub">The ideas queue for what might come next &mdash; plus every shipped fix and improvement, by date.</p>
<div id="gate" class="gate"><span class="lab">Enter admin key</span>
<input id="k" type="password" placeholder="ADMIN_KEY" autocomplete="off"/>
<button id="go">Open the hub</button><div id="err" class="err"></div></div>
<div id="hub" style="display:none">
  <div class="card"><h2>Future ideas</h2>
    <div id="ideas-err" class="err" style="display:none"></div>
    <div id="idea-nudge" class="muted" style="display:none">Shipped &#10003; &mdash; remember to add the matching devlog entry.</div>
    <div id="ideas"></div>
    <div class="add"><input id="idea-in" placeholder="e.g. Email a weekly market digest to watchlist users" maxlength="500"/>
    <button class="btn" id="idea-add">Add idea</button></div>
  </div>
  <div class="card"><h2>Changelog</h2>
    <div id="log-meta" class="logmeta"></div>
    <div class="logbar">
      <div class="seg" id="log-chips" role="group" aria-label="Filter by entry type"></div>
      <input id="log-q" class="logsearch" type="search" placeholder="Search the changelog&hellip;" autocomplete="off" aria-label="Search the changelog"/>
    </div>
    <div id="log-err" class="err" style="display:none"></div>
    <div id="log"></div>
  </div>
</div>
</div>
</main>
<footer><div class="wrap">
  <span class="wordmark">Comp<b style="color:#EF4444">Ninja</b></span>
  <span>Internal page &middot; <a href="/admin">Analytics</a> &middot; <a href="/">Back to the app</a></span>
</div></footer>
<script>
var KEYK="cn_admin_key",KEY="",IDEAS=[],IDEAS_OK=false,SAVING=false;
var LOG=[],LOG_TYPE="all",LOG_Q="";
var COMMIT_URL="https://github.com/agouraninja-cmd/market-comp-puller/commit/";
var PRIORITIES=["now","next","later"],PR_LABEL={now:"Now",next:"Next",later:"Later"};
var MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function fmtMonth(ym){var m=/^([0-9]{4})-([0-9]{2})/.exec(String(ym||""));
  if(!m)return esc(ym);return MONTHS[Number(m[2])-1]+" "+m[1];}
// The margin column sets the year on its own line under the month and day;
// on narrow screens CSS re-joins them with a comma. Malformed dates fall
// back to the flat escaped string.
function fmtDateMargin(ymd){var m=/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(ymd||""));
  if(!m)return esc(ymd);
  return MONTHS[Number(m[2])-1]+" "+Number(m[3])+'<span class="dd-y">'+m[1]+"</span>";}
function normType(t){return ["fix","improvement","feature"].indexOf(t)>=0?t:"improvement";}

// ---- Changelog: meta line, type chips, text filter, collapsible months ----
function renderLogMeta(){
  var el=document.getElementById("log-meta");
  if(!LOG.length){el.textContent="";return;}
  var dates=LOG.map(function(e){return String(e.date||"");}).filter(Boolean).sort();
  var newest=dates[dates.length-1],oldest=dates[0];
  var days=Math.floor((Date.now()-new Date(newest+"T12:00:00").getTime())/864e5);
  var ago=days<=0?"today":days===1?"yesterday":days+" days ago";
  el.textContent="Last shipped "+ago+" · "+LOG.length+(LOG.length===1?" entry":" entries")+" since "+fmtMonth(oldest);
}
function renderChips(){
  var counts={all:LOG.length,feature:0,improvement:0,fix:0};
  LOG.forEach(function(e){counts[normType(e.type)]++;});
  var el=document.getElementById("log-chips");el.innerHTML="";
  [["all","All"],["feature","Features"],["improvement","Improvements"],["fix","Fixes"]].forEach(function(p){
    var on=LOG_TYPE===p[0];
    var b=document.createElement("button");b.type="button";
    b.className=on?"on":"";
    b.setAttribute("aria-pressed",on?"true":"false");
    // Count as its own muted element — a quieter read than "Features (23)".
    b.innerHTML=esc(p[1])+'<span class="n">'+counts[p[0]]+'</span>';
    b.addEventListener("click",function(){LOG_TYPE=p[0];renderChips();renderLog();});
    el.appendChild(b);
  });
}
var RENDER_KEYS=[];
function entryHTML(e){
  var t=normType(e.type);
  var cm=e.commit&&/^[0-9a-f]{7,40}$/i.test(String(e.commit))?String(e.commit):"";
  var k=RENDER_KEYS.push(e.key)-1;
  return '<div class="entry"><span class="badge '+t+'">'+t+'</span>'+
    '<div class="ebody" data-k="'+k+'" title="Click to edit this entry or add a note">'+
    '<div class="entry-title">'+esc(e.title)+
    (cm?'<a class="cmt" href="'+COMMIT_URL+cm+'" target="_blank" rel="noopener">'+cm.slice(0,7)+'</a>':"")+
    (e.overridden?'<span class="edited-tag">edited</span>':"")+'</div>'+
    (e.details?'<div class="entry-details">'+esc(e.details)+'</div>':"")+
    (e.notes?'<div class="entry-note">'+esc(e.notes)+'</div>':"")+
    '</div></div>';
}
function renderLog(){
  RENDER_KEYS=[];
  var q=LOG_Q.toLowerCase();
  var entries=LOG.filter(function(e){
    if(LOG_TYPE!=="all"&&normType(e.type)!==LOG_TYPE)return false;
    if(q&&(String(e.title||"")+" "+String(e.details||"")+" "+String(e.notes||"")).toLowerCase().indexOf(q)<0)return false;
    return true;
  });
  var by={},dates=[];
  entries.forEach(function(e){if(!by[e.date]){by[e.date]=[];dates.push(e.date);}by[e.date].push(e);});
  dates.sort();dates.reverse();
  var months=[],byMonth={};
  dates.forEach(function(d){var m=String(d).slice(0,7);if(!byMonth[m]){byMonth[m]=[];months.push(m);}byMonth[m].push(d);});
  var filtering=LOG_TYPE!=="all"||!!q;
  document.getElementById("log").innerHTML=months.length?months.map(function(m,mi){
    var body=byMonth[m].map(function(d){
      return '<div class="day"><div class="day-date">'+fmtDateMargin(d)+'</div>'+by[d].map(entryHTML).join("")+'</div>';
    }).join("");
    var n=byMonth[m].reduce(function(s,d){return s+by[d].length;},0);
    // Newest month stays expanded; older months collapse — except while
    // filtering, when hiding matches inside a closed month would be confusing.
    if(mi===0||filtering)return body;
    return '<details class="month"><summary class="month-sum">'+fmtMonth(m)+
      ' <span class="muted">&middot; '+n+(n===1?" entry":" entries")+'</span></summary>'+body+'</details>';
  }).join(""):'<div class="muted">'+(LOG.length?"Nothing matches this filter.":"No entries yet.")+'</div>';
}
function renderLogUI(){renderLogMeta();renderChips();renderLog();}
document.getElementById("log-q").addEventListener("input",function(e){LOG_Q=e.target.value.trim();renderLog();});

// Click-to-edit: any entry's text opens an inline editor (title, details,
// notes). Edits save to a server-side overlay — devlog.json itself is never
// rewritten, and "Remove edits & note" restores the committed text.
function logWarn(msg){
  var e=document.getElementById("log-err");
  e.textContent=msg||"";e.style.display=msg?"block":"none";
}
document.getElementById("log").addEventListener("click",function(ev){
  if(ev.target.closest("a"))return;                      // commit links stay links
  var body=ev.target.closest(".ebody");
  if(!body||body.classList.contains("editing"))return;
  openEditor(body);
});
function openEditor(body){
  var key=RENDER_KEYS[Number(body.dataset.k)];
  var entry=null;
  LOG.forEach(function(e){if(e.key===key)entry=e;});
  if(!entry)return;
  if(document.querySelector(".ebody.editing")){
    // One editor at a time. The re-render closes the open one but also
    // rebuilds #log, detaching the clicked node — find its replacement.
    renderLog();
    body=null;
    document.querySelectorAll("#log .ebody").forEach(function(el){
      if(RENDER_KEYS[Number(el.dataset.k)]===key)body=el;
    });
    if(!body)return;
  }
  body.classList.add("editing");
  body.innerHTML='<div class="ed">'+
    '<label>Title</label><input class="ed-t" maxlength="200"/>'+
    '<label>Details</label><textarea class="ed-d" maxlength="2000"></textarea>'+
    '<label>Note (yours, shown with the entry)</label><textarea class="ed-n" maxlength="2000" placeholder="e.g. broke Safari exports once — watch this area"></textarea>'+
    '<div class="err ed-err" style="display:none"></div>'+
    '<div class="row"><button class="btn sm ed-save" type="button">Save</button>'+
    '<button class="lnk ed-cancel" type="button">Cancel</button><span class="spacer"></span>'+
    ((entry.overridden||entry.notes)?'<button class="lnk ed-reset" type="button">Remove edits &amp; note</button>':"")+
    '</div></div>';
  body.querySelector(".ed-t").value=entry.title||"";
  body.querySelector(".ed-d").value=entry.details||"";
  body.querySelector(".ed-n").value=entry.notes||"";
  body.querySelector(".ed-t").focus();
  function setBusyEd(b){
    body.querySelectorAll("button,input,textarea").forEach(function(el){el.disabled=b;});
  }
  function fail(msg){
    var e=body.querySelector(".ed-err");e.textContent=msg;e.style.display="block";
    setBusyEd(false);
  }
  function send(payload){
    setBusyEd(true);
    fetch("/api/devlog-edit",{method:"PUT",headers:{"x-admin-key":KEY,"content-type":"application/json"},
      body:JSON.stringify(payload)})
    .then(function(r){return r.json().then(function(d){if(!r.ok){throw new Error(d.error||"Error "+r.status);}return d;});})
    .then(function(d){
      LOG=d.entries||[];
      logWarn(d.storage==="file"
        ?"Saved locally only — run the devlog_overrides DDL in Supabase so edits survive deploys."
        :"");
      renderLogUI();
    })
    .catch(function(e){fail("Save failed: "+e.message);});
  }
  body.querySelector(".ed-save").addEventListener("click",function(){
    send({key:key,
      title:body.querySelector(".ed-t").value,
      details:body.querySelector(".ed-d").value,
      notes:body.querySelector(".ed-n").value});
  });
  body.querySelector(".ed-cancel").addEventListener("click",function(){renderLog();});
  var reset=body.querySelector(".ed-reset");
  if(reset)reset.addEventListener("click",function(){send({key:key,reset:true});});
  body.querySelector(".ed").addEventListener("keydown",function(e){
    if(e.key==="Escape")renderLog();
  });
}

// ---- Ideas: priority buckets, notes, shipped history ----
// Every mutation goes through saveIdeas (whole-list PUT). IDEAS_OK guards the
// silent-wipe failure mode: if the ideas GET didn't succeed, editing stays
// disabled so an empty snapshot can never be PUT back over the real list.
function withProps(x,p){
  var o={id:x.id,text:x.text,status:x.status,priority:x.priority,notes:x.notes,done_at:x.done_at,created_at:x.created_at};
  for(var k in p)o[k]=p[k];
  return o;
}
function mutateIdea(id,fn){
  saveIdeas(IDEAS.map(function(x){return x.id===id?fn(x):x;}));
}
var nudgeTimer=null;
function showNudge(){
  var n=document.getElementById("idea-nudge");n.style.display="block";
  clearTimeout(nudgeTimer);nudgeTimer=setTimeout(function(){n.style.display="none";},8000);
}
function ideasErr(msg){
  var e=document.getElementById("ideas-err");
  e.textContent=msg||"";e.style.display=msg?"block":"none";
}
function setBusy(b){
  SAVING=b;
  document.getElementById("ideas").className=b?"busy":"";
  document.getElementById("idea-add").disabled=b||!IDEAS_OK;
  document.getElementById("idea-in").disabled=b||!IDEAS_OK;
}
function ideaRow(idea){
  var done=idea.status==="done";
  var row=document.createElement("div");
  row.className="idea"+(done?" done":"");
  var when=done&&idea.done_at?idea.done_at:idea.created_at;
  var pr=PRIORITIES.indexOf(idea.priority)>=0?idea.priority:"next";
  row.innerHTML='<input type="checkbox"'+(done?" checked":"")+' title="'+(done?"Reopen":"Mark shipped")+'"/>'+
    '<div class="tx"><span class="t">'+esc(idea.text)+'</span>'+
    (idea.notes?'<div class="n">'+esc(idea.notes)+'</div>':"")+'</div>'+
    (done?"":'<button class="pr '+pr+'" title="Cycle priority">'+PR_LABEL[pr]+'</button>')+
    '<span class="d">'+(when?esc(new Date(when).toLocaleDateString()):"")+'</span>'+
    '<button class="nt">Notes</button>'+
    '<button class="rm">Delete</button>';
  row.querySelector("input").addEventListener("change",function(){
    if(done){mutateIdea(idea.id,function(x){return withProps(x,{status:"open",done_at:null});});}
    else{mutateIdea(idea.id,function(x){return withProps(x,{status:"done"});});showNudge();}
  });
  var prBtn=row.querySelector(".pr");
  if(prBtn)prBtn.addEventListener("click",function(){
    mutateIdea(idea.id,function(x){
      return withProps(x,{priority:PRIORITIES[(PRIORITIES.indexOf(pr)+1)%PRIORITIES.length]});
    });
  });
  row.querySelector(".nt").addEventListener("click",function(){
    if(row.querySelector(".n-edit"))return;
    var inp=document.createElement("input");
    inp.className="n-edit";inp.maxLength=500;inp.value=idea.notes||"";inp.placeholder="Add a note…";
    var nEl=row.querySelector(".n");if(nEl)nEl.style.display="none";
    row.querySelector(".tx").appendChild(inp);
    inp.focus();
    var closed=false;
    function commit(save){
      if(closed)return;closed=true;
      var v=inp.value.trim();
      if(save&&v!==(idea.notes||"")){mutateIdea(idea.id,function(x){return withProps(x,{notes:v||null});});}
      else{renderIdeas();}
    }
    inp.addEventListener("keydown",function(e){
      if(e.key==="Enter")commit(true);
      else if(e.key==="Escape")commit(false);
    });
    inp.addEventListener("blur",function(){commit(true);});
  });
  // Two-step inline confirm — window.confirm() is suppressed (returns false
  // with no dialog) in some embedded browsers, which made Delete a silent
  // no-op. First click arms the button, second click deletes, 4s to revert.
  var rmBtn=row.querySelector(".rm"),rmTimer=null;
  rmBtn.addEventListener("click",function(){
    if(rmBtn.dataset.armed){
      clearTimeout(rmTimer);
      saveIdeas(IDEAS.filter(function(x){return x.id!==idea.id;}));
      return;
    }
    rmBtn.dataset.armed="1";rmBtn.textContent="Confirm?";rmBtn.className="rm armed";
    rmTimer=setTimeout(function(){
      delete rmBtn.dataset.armed;rmBtn.textContent="Delete";rmBtn.className="rm";
    },4000);
  });
  return row;
}
function renderIdeas(){
  var el=document.getElementById("ideas");el.innerHTML="";
  if(!IDEAS.length){el.innerHTML='<div class="muted">No ideas yet &mdash; add the first one below.</div>';return;}
  var open={now:[],next:[],later:[]},shipped=[];
  IDEAS.forEach(function(x){
    if(x.status==="done")shipped.push(x);
    else open[PRIORITIES.indexOf(x.priority)>=0?x.priority:"next"].push(x);
  });
  shipped.sort(function(a,b){return String(b.done_at||"").localeCompare(String(a.done_at||""));});
  // One .bucket per group so the heading can sit in the SAME 104px margin
  // column the changelog's dates use. As a flat sibling list it could not:
  // grid auto-placement would slot the second heading beside the first
  // bucket's rows instead of starting a new row.
  function bucket(label,items){
    var b=document.createElement("div");b.className="bucket";
    var h=document.createElement("div");h.className="bucket-h";h.textContent=label;
    var body=document.createElement("div");body.className="bucket-body";
    items.forEach(function(x){body.appendChild(ideaRow(x));});
    b.appendChild(h);b.appendChild(body);
    el.appendChild(b);
  }
  PRIORITIES.forEach(function(p){ if(open[p].length) bucket(PR_LABEL[p],open[p]); });
  if(shipped.length) bucket("Shipped",shipped);
}
function saveIdeas(next){
  if(!IDEAS_OK||SAVING)return;
  setBusy(true);ideasErr("");
  fetch("/api/dev-ideas",{method:"PUT",headers:{"x-admin-key":KEY,"content-type":"application/json"},
    body:JSON.stringify({ideas:next})})
  .then(function(r){return r.json().then(function(d){if(!r.ok){throw new Error(d.error||"Error "+r.status);}return d;});})
  .then(function(d){IDEAS=d.ideas;})
  .catch(function(e){ideasErr("Save failed: "+e.message+" Nothing was changed.");})
  .then(function(){setBusy(false);renderIdeas();});
}
document.getElementById("idea-add").addEventListener("click",addIdea);
document.getElementById("idea-in").addEventListener("keydown",function(e){if(e.key==="Enter")addIdea();});
function addIdea(){
  if(!IDEAS_OK||SAVING)return;
  var v=document.getElementById("idea-in").value.trim();
  if(!v)return;
  document.getElementById("idea-in").value="";
  saveIdeas(IDEAS.concat([{text:v,status:"open"}]));
}

// ---- Load: the two cards fail independently. A dead ideas endpoint shows an
// inline error with editing disabled (never "No ideas yet"), and the
// changelog still renders — and vice versa. Only a bad key re-shows the gate.
function gateErr(msg){
  document.getElementById("err").textContent=msg;
  document.getElementById("gate").style.display="block";
  document.getElementById("hub").style.display="none";
}
function load(key){
  Promise.all([
    fetch("/api/devlog",{headers:{"x-admin-key":key}}).catch(function(){return null;}),
    fetch("/api/dev-ideas",{headers:{"x-admin-key":key}}).catch(function(){return null;}),
  ]).then(function(rs){
    var rl=rs[0],ri=rs[1];
    if((rl&&rl.status===401)||(ri&&ri.status===401))return gateErr("Incorrect key.");
    if((rl&&rl.status===404)||(ri&&ri.status===404))return gateErr("The hub is disabled — set ADMIN_KEY on the server.");
    if(!rl&&!ri)return gateErr("Network error — is the server reachable?");
    KEY=key;try{sessionStorage.setItem(KEYK,key);}catch(e){}
    document.getElementById("gate").style.display="none";
    document.getElementById("hub").style.display="block";
    var logFail=function(){
      var e=document.getElementById("log-err");
      e.textContent="Couldn't load the changelog. Reload to retry.";e.style.display="block";
    };
    if(rl&&rl.ok){rl.json().then(function(d){LOG=d.entries||[];renderLogUI();}).catch(logFail);}
    else logFail();
    var ideasFail=function(){
      IDEAS_OK=false;setBusy(false);
      ideasErr("Couldn't load the ideas list — editing is disabled so a stale view can't overwrite it. Reload to retry.");
    };
    if(ri&&ri.ok){
      ri.json().then(function(d){IDEAS=d.ideas||[];IDEAS_OK=true;setBusy(false);renderIdeas();}).catch(ideasFail);
    }else ideasFail();
  });
}
document.getElementById("go").addEventListener("click",function(){load(document.getElementById("k").value.trim());});
document.getElementById("k").addEventListener("keydown",function(e){if(e.key==="Enter")load(e.target.value.trim());});
try{var sk=sessionStorage.getItem(KEYK);if(sk){load(sk);}}catch(e){}
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// /contacts — the team's internal rolodex. Same Research Desk skin, same
// ADMIN_KEY gate and sessionStorage key as /admin and /dev, so unlocking one
// unlocks all three. Self-contained CSS (no tailwind.css dependency), same
// triple-noindex treatment. The CSV export is built in the BROWSER from the
// already-loaded list, so no key ever rides in a URL.
// ---------------------------------------------------------------------------
function renderContactsHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>CompNinja Contacts</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<style>
*{box-sizing:border-box}
body{margin:0;background:#FBFBF9;color:#1A2433;line-height:1.6;min-height:100vh;display:flex;flex-direction:column;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:#B91C1C;text-decoration:none}a:hover{color:#991B1B}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
.hdr{border-bottom:1px solid #E4E2DA;background:#FBFBF9}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:10px;padding-top:16px;padding-bottom:16px}
.brand{display:flex;align-items:center;gap:10px;color:#1A2433}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#1A2433}
.wordmark b{color:#B91C1C;font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;font-size:13.5px}
.hdr nav a{color:#5A6473;white-space:nowrap}.hdr nav a:hover{color:#1A2433}
main{flex:1;padding:36px 0 64px}
.kicker{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:#B91C1C;font-weight:600}
.h{font-family:Georgia,'Times New Roman',serif;font-weight:500;letter-spacing:-.005em;color:#1A2433;margin:0}
h1.h{font-size:32px;line-height:1.15;margin:10px 0 0}
.sub{color:#4C5665;font-size:14px;max-width:62ch;margin:8px 0 0}
.gate{background:#fff;border:1px solid #D8D4C9;border-radius:6px;padding:26px;max-width:420px;margin:48px auto;text-align:center}
.gate .lab{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#8A93A0;font-weight:600}
.gate input{width:100%;padding:10px 12px;border:1px solid #D8D4C9;border-radius:4px;margin:12px 0;font-size:14px;
  font-family:inherit;color:#1A2433;background:#FBFBF9}
.gate input:focus{outline:none;border-color:#B91C1C}
.gate button,.btn{background:#B91C1C;color:#fff;border:0;border-radius:4px;padding:10px 22px;font-weight:600;
  font-size:14px;font-family:inherit;cursor:pointer}
.gate button:hover,.btn:hover{background:#991B1B}
.btn[disabled]{opacity:.55;cursor:default}
.btn.ghost{background:#fff;color:#4C5665;border:1px solid #D8D4C9}
.btn.ghost:hover{background:#F4F2EC;color:#1A2433}
.btn.sm{padding:6px 12px;font-size:12.5px}
.err{color:#B91C1C;font-size:13px;margin-top:8px}
.card{background:#fff;border:1px solid #D8D4C9;border-radius:6px;padding:20px 22px;margin:16px 0}
.card h2{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:#8A93A0;font-weight:600;margin:0 0 14px}
.muted{color:#8A93A0;font-size:12.5px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 16px}
.bar input[type=search]{flex:1;min-width:200px;padding:9px 12px;border:1px solid #D8D4C9;border-radius:4px;
  font-size:14px;font-family:inherit;color:#1A2433;background:#fff}
.bar input[type=search]:focus{outline:none;border-color:#B91C1C}
.seg{display:flex;flex-wrap:wrap;gap:6px}
.seg button{background:#fff;border:1px solid #D8D4C9;color:#5A6473;border-radius:999px;padding:5px 12px;
  font-size:12.5px;font-family:inherit;cursor:pointer;text-transform:capitalize}
.seg button[aria-pressed=true]{background:#1A2433;border-color:#1A2433;color:#fff}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
.grid label{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#8A93A0;font-weight:600;margin-bottom:4px}
.grid input,.grid select,.grid textarea{width:100%;padding:9px 12px;border:1px solid #D8D4C9;border-radius:4px;
  font-size:14px;font-family:inherit;color:#1A2433;background:#FBFBF9}
.grid input:focus,.grid select:focus,.grid textarea:focus{outline:none;border-color:#B91C1C}
.grid textarea{min-height:74px;resize:vertical}
.grid .full{grid-column:1/-1}
.formact{display:flex;gap:10px;align-items:center;margin-top:14px}
.row{border-top:1px solid #EDEBE3;padding:14px 0;display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.row:first-child{border-top:0}
.row .who{flex:1 1 220px;min-width:0}
.row .nm{font-weight:600;font-size:15px;color:#1A2433;word-break:break-word}
.row .co{font-size:13px;color:#5A6473;word-break:break-word}
.row .reach{flex:1 1 220px;min-width:0;font-size:13.5px}
.row .reach a{display:block;word-break:break-word}
.row .meta{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.row .acts{display:flex;gap:6px}
.note{flex:1 1 100%;font-size:13px;color:#4C5665;background:#FBFBF9;border-left:2px solid #E4E2DA;
  padding:6px 10px;white-space:pre-wrap;word-break:break-word}
.tag{display:inline-block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;
  border-radius:3px;padding:2px 7px;white-space:nowrap}
.tag.cat{background:#EEF1F5;color:#4C5665}
.st-new{background:#E8F0FE;color:#1A4FA0}
.st-contacted{background:#FEF3C7;color:#8A6100}
.st-following-up{background:#FFE8D9;color:#9A4A12}
.st-client{background:#DCFCE7;color:#166534}
.st-dead{background:#F1F0EC;color:#8A93A0}
.empty{text-align:center;color:#8A93A0;font-size:14px;padding:28px 0}
footer{background:#1A2433;color:#B8C0CC;font-size:13px}
footer .wrap{padding:28px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
footer .wordmark{color:#fff}
footer a{color:#D5DAE2;text-decoration:none}footer a:hover{color:#fff}
@media(max-width:620px){.grid{grid-template-columns:1fr}.row .meta{align-items:flex-start}}
</style></head><body>
<header class="hdr">
  <div class="wrap">
    <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
    <nav>
      <a href="/admin">Analytics</a>
      <a href="/dev">Dev hub</a>
      <a href="/">Run a report</a>
    </nav>
  </div>
</header>
<main>
<div class="wrap">
<div class="kicker">Internal</div>
<h1 class="h">Contacts</h1>
<p class="sub">The team's shared book of leads, brokers, owners and vendors &mdash; names, numbers and where each one stands. Visible only with the admin key.</p>
<div id="gate" class="gate"><span class="lab">Enter admin key</span>
<input id="k" type="password" placeholder="ADMIN_KEY" autocomplete="off"/>
<button id="go">Open contacts</button><div id="err" class="err"></div></div>

<div id="app" style="display:none">
  <div class="card">
    <h2 id="form-title">Add a contact</h2>
    <div id="save-err" class="err" style="display:none"></div>
    <div class="grid">
      <div><label for="f-name">Name *</label><input id="f-name" maxlength="120" placeholder="Jane Alvarez"/></div>
      <div><label for="f-company">Company</label><input id="f-company" maxlength="120" placeholder="Lee &amp; Associates"/></div>
      <div><label for="f-role">Role / title</label><input id="f-role" maxlength="120" placeholder="Principal, Industrial"/></div>
      <div><label for="f-market">Market</label><input id="f-market" maxlength="120" placeholder="Long Beach, CA"/></div>
      <div><label for="f-phone">Phone</label><input id="f-phone" maxlength="60" placeholder="(562) 555-0134"/></div>
      <div><label for="f-email">Email</label><input id="f-email" maxlength="160" placeholder="jane@example.com"/></div>
      <div><label for="f-category">Category</label><select id="f-category"></select></div>
      <div><label for="f-status">Status</label><select id="f-status"></select></div>
      <div class="full"><label for="f-notes">Notes</label><textarea id="f-notes" maxlength="2000" placeholder="Met at the Long Beach ULI panel. Owns two multi-tenant industrial parks off Alameda; wants a BOV in the spring."></textarea></div>
    </div>
    <div class="formact">
      <button class="btn" id="save">Save contact</button>
      <button class="btn ghost" id="cancel" style="display:none">Cancel</button>
      <span class="muted" id="save-hint"></span>
    </div>
  </div>

  <div class="card">
    <h2>The book</h2>
    <div class="bar">
      <input id="q" type="search" placeholder="Search name, company, phone, market, notes&hellip;" autocomplete="off" aria-label="Search contacts"/>
      <button class="btn ghost sm" id="export">Export CSV</button>
    </div>
    <div class="bar">
      <div class="seg" id="cat-chips" role="group" aria-label="Filter by category"></div>
    </div>
    <div class="bar">
      <div class="seg" id="st-chips" role="group" aria-label="Filter by status"></div>
    </div>
    <div id="list-err" class="err" style="display:none"></div>
    <div id="count" class="muted"></div>
    <div id="list"></div>
  </div>
</div>
</div>
</main>
<footer><div class="wrap">
  <span class="wordmark">Comp<b style="color:#EF4444">Ninja</b></span>
  <span>Internal page &middot; <a href="/admin">Analytics</a> &middot; <a href="/dev">Dev hub</a> &middot; <a href="/">Back to the app</a></span>
</div></footer>
<script>
var KEYK="cn_admin_key",KEY="",ROWS=[],EDIT=null,SAVING=false;
var Q="",CAT="all",ST="all";
var CATS=${JSON.stringify(CONTACT_CATEGORIES)},STATUSES=${JSON.stringify(CONTACT_STATUSES)};
var FIELDS=["name","company","role","market","phone","email","category","status","notes"];
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function el(id){return document.getElementById(id);}

// ---- Form ----
function fillSelects(){
  el("f-category").innerHTML=CATS.map(function(c){return '<option value="'+c+'">'+c+'</option>';}).join("");
  el("f-status").innerHTML=STATUSES.map(function(s){return '<option value="'+s+'">'+s.replace("-"," ")+'</option>';}).join("");
}
function readForm(){
  var o={};FIELDS.forEach(function(f){o[f]=el("f-"+f).value.trim();});
  if(EDIT)o.id=EDIT;
  return o;
}
function clearForm(){
  FIELDS.forEach(function(f){el("f-"+f).value="";});
  el("f-category").value="lead";el("f-status").value="new";
  EDIT=null;el("form-title").textContent="Add a contact";
  el("cancel").style.display="none";el("save").textContent="Save contact";
  el("save-err").style.display="none";el("save-hint").textContent="";
}
function loadIntoForm(c){
  FIELDS.forEach(function(f){el("f-"+f).value=c[f]||"";});
  EDIT=c.id;el("form-title").textContent="Editing "+(c.name||"contact");
  el("cancel").style.display="";el("save").textContent="Update contact";
  el("save-err").style.display="none";el("save-hint").textContent="";
  window.scrollTo({top:0,behavior:"smooth"});
}
function saveErr(m){var e=el("save-err");if(!m){e.style.display="none";return;}e.textContent=m;e.style.display="block";}

function save(){
  if(SAVING)return;
  var body=readForm();
  if(!body.name){saveErr("A name is required — everything else is optional.");return;}
  SAVING=true;el("save").disabled=true;saveErr("");
  fetch("/api/contacts",{method:"POST",headers:{"x-admin-key":KEY,"content-type":"application/json"},
    body:JSON.stringify(body)})
  .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||"Error "+r.status);return d;});})
  .then(function(d){
    ROWS=d.contacts;clearForm();render();
    if(d.stored==="file")el("save-hint").textContent="Saved to the local file — configure Supabase to survive a redeploy.";
  })
  .catch(function(e){saveErr("Save failed: "+e.message+" Nothing was changed.");})
  .then(function(){SAVING=false;el("save").disabled=false;});
}

function removeContact(id,name){
  if(!window.confirm("Delete "+name+"? This can't be undone."))return;
  fetch("/api/contacts?id="+encodeURIComponent(id),{method:"DELETE",headers:{"x-admin-key":KEY}})
  .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||"Error "+r.status);return d;});})
  .then(function(d){ROWS=d.contacts;if(EDIT===id)clearForm();render();})
  .catch(function(e){var l=el("list-err");l.textContent="Delete failed: "+e.message;l.style.display="block";});
}

// ---- List ----
function chips(host,vals,cur,onPick){
  var all=["all"].concat(vals);
  el(host).innerHTML=all.map(function(v){
    return '<button type="button" data-v="'+v+'" aria-pressed="'+(v===cur)+'">'+esc(v.replace("-"," "))+'</button>';
  }).join("");
  Array.prototype.forEach.call(el(host).querySelectorAll("button"),function(b){
    b.addEventListener("click",function(){onPick(b.getAttribute("data-v"));});
  });
}
function matches(c){
  if(CAT!=="all"&&c.category!==CAT)return false;
  if(ST!=="all"&&c.status!==ST)return false;
  if(!Q)return true;
  var hay=[c.name,c.company,c.role,c.market,c.phone,c.email,c.notes].join(" ").toLowerCase();
  return hay.indexOf(Q.toLowerCase())>=0;
}
function rowHTML(c){
  var reach="";
  if(c.phone)reach+='<a href="tel:'+esc(c.phone.replace(/[^0-9+]/g,""))+'">'+esc(c.phone)+'</a>';
  if(c.email)reach+='<a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>';
  if(c.market)reach+='<span class="muted">'+esc(c.market)+'</span>';
  if(!reach)reach='<span class="muted">No contact details</span>';
  return '<div class="row">'+
    '<div class="who"><div class="nm">'+esc(c.name)+'</div>'+
      (c.company?'<div class="co">'+esc(c.company)+(c.role?' &middot; '+esc(c.role):'')+'</div>':
        (c.role?'<div class="co">'+esc(c.role)+'</div>':''))+'</div>'+
    '<div class="reach">'+reach+'</div>'+
    '<div class="meta">'+
      '<span class="tag cat">'+esc(c.category)+'</span>'+
      '<span class="tag st-'+esc(c.status)+'">'+esc(String(c.status).replace("-"," "))+'</span>'+
      '<div class="acts"><button class="btn ghost sm" data-edit="'+esc(c.id)+'">Edit</button>'+
      '<button class="btn ghost sm" data-del="'+esc(c.id)+'">Delete</button></div>'+
    '</div>'+
    (c.notes?'<div class="note">'+esc(c.notes)+'</div>':'')+
  '</div>';
}
function render(){
  chips("cat-chips",CATS,CAT,function(v){CAT=v;render();});
  chips("st-chips",STATUSES,ST,function(v){ST=v;render();});
  var shown=ROWS.filter(matches);
  el("count").textContent=shown.length===ROWS.length
    ? ROWS.length+(ROWS.length===1?" contact":" contacts")
    : shown.length+" of "+ROWS.length+" contacts";
  el("list").innerHTML=shown.length
    ? shown.map(rowHTML).join("")
    : '<div class="empty">'+(ROWS.length?"Nothing matches those filters.":"No contacts yet — add the first one above.")+'</div>';
  Array.prototype.forEach.call(el("list").querySelectorAll("[data-edit]"),function(b){
    b.addEventListener("click",function(){
      var c=ROWS.filter(function(x){return x.id===b.getAttribute("data-edit");})[0];
      if(c)loadIntoForm(c);
    });
  });
  Array.prototype.forEach.call(el("list").querySelectorAll("[data-del]"),function(b){
    b.addEventListener("click",function(){
      var c=ROWS.filter(function(x){return x.id===b.getAttribute("data-del");})[0];
      if(c)removeContact(c.id,c.name);
    });
  });
}

// Built here rather than server-side so the admin key never rides in a URL.
function exportCsv(){
  var cols=["name","company","role","phone","email","market","category","status","notes","created_at","updated_at"];
  var esq=function(v){return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';};
  var rows=ROWS.filter(matches).map(function(c){return cols.map(function(k){return esq(c[k]);}).join(",");});
  var blob=new Blob([[cols.join(",")].concat(rows).join("\\r\\n")],{type:"text/csv;charset=utf-8"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="compninja-contacts.csv";
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
}

// ---- Gate ----
function gateErr(msg){
  el("err").textContent=msg;
  el("gate").style.display="block";el("app").style.display="none";
}
function load(key){
  fetch("/api/contacts",{headers:{"x-admin-key":key}})
  .then(function(r){
    if(r.status===401)throw new Error("Incorrect key.");
    if(r.status===404)throw new Error("Contacts are disabled — set ADMIN_KEY on the server.");
    if(!r.ok)throw new Error("Error "+r.status);
    return r.json();
  })
  .then(function(d){
    KEY=key;try{sessionStorage.setItem(KEYK,key);}catch(e){}
    ROWS=d.contacts||[];
    el("gate").style.display="none";el("app").style.display="block";
    fillSelects();clearForm();render();
  })
  .catch(function(e){gateErr(e.message||"Network error — is the server reachable?");});
}

el("go").addEventListener("click",function(){load(el("k").value.trim());});
el("k").addEventListener("keydown",function(e){if(e.key==="Enter")load(e.target.value.trim());});
el("save").addEventListener("click",save);
el("cancel").addEventListener("click",clearForm);
el("export").addEventListener("click",exportCsv);
el("q").addEventListener("input",function(e){Q=e.target.value.trim();render();});
try{var sk=sessionStorage.getItem(KEYK);if(sk){load(sk);}}catch(e){}
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  // --- API endpoint ---
  if (req.method === "POST" && req.url === "/api/comps") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e5) req.destroy(); // guard against huge payloads
    });
    req.on("end", async () => {
      let sse = null;
      let wantsStream = false;
      try {
        // Password gate (only enforced when APP_PASSWORD is set).
        if (APP_PASSWORD && !passwordMatches(req.headers["x-app-password"])) {
          return sendJson(res, 401, { error: "Unauthorized: incorrect or missing password." });
        }
        if (rateLimited(clientIp(req))) {
          return sendJson(res, 429, {
            error: "Too many searches from this connection. Please wait a few minutes and try again.",
          });
        }
        const { address, type, note, months, maxComps, txFocus, subjectSizeSqft, subjectDetails, stream } = JSON.parse(body || "{}");
        // Entitlements are resolved BEFORE anything else reads the body's
        // knobs: the lookback ceiling below depends on them, and every exit
        // from here on serializes through gateReport().
        const ent = await entitlementsFor(req);
        // The seed generator and the Explorer are internal callers with no
        // session; they must keep receiving whole reports or market pages
        // would publish four comps. ADMIN_KEY is the existing internal
        // credential (same one the leads/corpus CSV downloads use).
        const internal = ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY;
        // Opt in via the body, not Accept: the body is already parsed, and
        // gen-market-seed.js (the other /api/comps caller) simply never sends
        // the flag, so it keeps getting one plain JSON body.
        wantsStream = stream === true;
        if (!address || !type) {
          return sendJson(res, 400, { error: "address and property type are required." });
        }
        if (!API_KEY) {
          return sendJson(res, 500, {
            error: "Server is missing the ANTHROPIC_API_KEY environment variable.",
          });
        }
        // Validated/clamped so arbitrary client values can't reshape the prompt.
        // The ceiling is also the entitlement's: free tops out at 12 months,
        // Pro gets the full 120. Clamped rather than rejected so an over-long
        // ask still returns a report — and because the clamp feeds the cache
        // key, a free 24-month ask and a free 12-month ask share one entry.
        const monthsOk = ENT.clampLookback(months, internal ? null : ent);
        // Default 12 (was 8): more comps = steadier percentiles in the value
        // hero. The anti-padding prompt rule keeps thin markets honest — the
        // model returns fewer rather than inventing. Explorer/seed searches
        // stay pinned at 8 (see /api/explore-market + gen-market-seed.js,
        // which must stay in lockstep with each other, not with this default).
        const maxCompsOk = [4, 6, 8, 10, 12].includes(Number(maxComps)) ? Number(maxComps) : 12;
        const txFocusOk = ["both", "sales", "leases"].includes(String(txFocus)) ? String(txFocus) : "both";
        const sizeNum = Math.round(Number(subjectSizeSqft));
        const sizeOk = Number.isFinite(sizeNum) && sizeNum > 0 ? Math.min(20_000_000, sizeNum) : null;
        const addressOk = String(address).trim();
        const typeOk = String(type);
        const noteOk = note ? String(note).trim() : "";
        const detailsOk = sanitizeSubjectDetails(typeOk, subjectDetails);

        // Verified comps are fetched once, both for the model and as part of
        // the cache key — approving a new broker comp naturally invalidates
        // any cached report for that property type.
        const verifiedComps = await fetchVerifiedComps(typeOk, txFocusOk);
        const cacheKey = cacheKeyFor({
          address: addressOk, type: typeOk, note: noteOk, months: monthsOk,
          maxComps: maxCompsOk, txFocus: txFocusOk, subjectSizeSqft: sizeOk, verifiedComps,
          subjectDetails: detailsOk,
        });

        // Gating happens at SERIALIZATION, never at generation: the cache, the
        // corpus harvest, and the market-snapshot publisher all keep seeing
        // whole reports, so one cached search serves free and Pro visitors
        // alike and the corpus never starves on free traffic.
        const gate = (rep) => {
          if (internal) return rep;
          const subjectSqft = sizeOk || GATE.numericValue(rep && rep.subject_size_sqft) || 0;
          return GATE.gateReport(rep, ent, { asOfMs: Date.now(), subjectSqft });
        };

        // The gate's principle applied to live progress: a limited visitor
        // never receives more identified comps than the report itself will
        // show them. Streamed "comp" events past the entitlement become
        // anonymous { locked: true } markers — the card can still count them
        // ("+N more found"), it just never learns their addresses. Note the
        // first N streamed are not necessarily the N the gate later picks
        // (it selects sales-first/best-first); the invariant that matters is
        // the QUANTITY of identified comp intelligence, and that holds.
        const maxIdentified = (internal || ent.maxComps === "all") ? Infinity : Number(ent.maxComps);
        let compAttempt = 0, identifiedSent = 0;
        const guardComp = (evt) => {
          if (!evt || evt.phase !== "comp") return evt;
          if (evt.attempt !== compAttempt) { compAttempt = evt.attempt; identifiedSent = 0; }
          identifiedSent++;
          return identifiedSent <= maxIdentified
            ? evt
            : { phase: "comp", n: evt.n, locked: true, attempt: evt.attempt };
        };

        const cached = await getCachedSearch(cacheKey);
        if (cached) {
          // Legacy cache entries predate $/SF reconciliation — correct them at
          // read time (idempotent, so re-hitting the in-memory object is fine).
          reconcilePricePerSqft(cached);
          console.log(`Cache hit (no Anthropic call): ${addressOk} — ${typeOk}`);
          logEvent("search", { prop_type: typeOk, market: marketOf(addressOk), cached: true, plan: ent.plan });
          maybePublishMarketSnapshot(typeOk, addressOk, cached);
          harvestComps(typeOk, addressOk, cached);
          return sendJson(res, 200, gate(cached));
        }

        // Exact key missed — but a shorter lookback is a subset of a longer
        // one, so a cached longer-window report for the same request can be
        // filtered down to this window instead of paying for a fresh search
        // (see findDerivableReport for the quality floors).
        const dw = await findDerivableReport({
          address: addressOk, type: typeOk, note: noteOk,
          maxComps: maxCompsOk, txFocus: txFocusOk, subjectSizeSqft: sizeOk,
          verifiedComps, subjectDetails: detailsOk,
        }, monthsOk, txFocusOk, maxCompsOk);
        if (dw) {
          console.log(`Cache hit (derived from ${dw.parentMonths}-month entry, no Anthropic call): ${addressOk} — ${typeOk} at ${monthsOk} months`);
          // Side effects mirror a direct cache hit, fed the PARENT payload —
          // the harvester dedupes, and the fuller comp list is the better feed.
          logEvent("search", { prop_type: typeOk, market: marketOf(addressOk), cached: true, source: "derived", plan: ent.plan });
          maybePublishMarketSnapshot(typeOk, addressOk, dw.parent);
          harvestComps(typeOk, addressOk, dw.parent);
          return sendJson(res, 200, gate(dw.derived));
        }

        // A paying subscriber must never be told the site is out of searches
        // for the day — the cap is a scraper backstop, not a product limit.
        if (!ent.pro && !internal && !tryConsumeDailySearch()) {
          return sendJson(res, 429, {
            error: "This site has reached its daily search limit. Please try again after midnight UTC.",
          });
        }

        // A blank SF field costs two extra searches for the size lookup — but
        // if any previous search already looked this building up, reuse the
        // answer and shrink the budget (see the subject-size memo). The
        // visitor's own entry (sizeOk) always wins over the memo.
        const knownSize = sizeOk ? null : await findKnownSubjectSize(addressOk);
        if (knownSize) {
          console.log(`Subject size remembered from a previous search: ${knownSize.size.toLocaleString("en-US")} SF — ${addressOk}`);
        }
        const searchSize = sizeOk || (knownSize ? knownSize.size : null);

        // Cache missed — see what we already hold for this market before paying
        // for a fresh web search. Corpus-strong markets reuse known comps and
        // run a much smaller search budget (see searchBudgetFor).
        const corpus = await retrieveCorpusComps(marketOf(addressOk), typeOk, monthsOk, maxCompsOk);
        if (corpusIsStrong(corpus)) {
          console.log(`Corpus-assisted search: ${corpus.coverage} known comp(s) for ${marketOf(addressOk)} — ${typeOk}`);
        }

        // Everything above this line answers in plain JSON — the password gate,
        // the rate limiters, validation, and (the fast path that matters) a
        // 43ms cache hit. Only the genuinely slow leg streams. The client picks
        // how to read the response off its content-type, never off what it asked
        // for, so all of those keep working untouched.
        if (wantsStream) {
          sse = openSse(res);
          if (corpusIsStrong(corpus)) {
            sse.send("progress", { phase: "corpus", coverage: corpus.coverage, market: marketOf(addressOk) });
          }
        }

        const result = await getComps(addressOk, typeOk, noteOk, monthsOk, maxCompsOk, txFocusOk, searchSize, verifiedComps, corpus, detailsOk,
          sse ? (evt) => sse.send("progress", guardComp(evt)) : null);
        // With the size supplied (memo hit), the prompt skips the lookup and
        // the payload has no subject_size_sqft — carry the remembered size
        // into the report so the client's hero math and size autofill still
        // work for a visitor who typed nothing. Source is kept verbatim so
        // the hero's provenance phrasing stays accurate.
        if (knownSize && !result.subject_size_sqft) {
          result.subject_size_sqft = String(knownSize.size);
          if (knownSize.source) result.subject_size_source = knownSize.source;
        }
        // A fresh lookup (no memo, no typed size) is worth remembering for
        // every future search of this address. Fire-and-forget.
        if (!sizeOk && !knownSize) rememberSubjectSize(addressOk, result);
        await storeCachedSearch(cacheKey, result);
        logEvent("search", { prop_type: typeOk, market: marketOf(addressOk), cached: false, source: corpusIsStrong(corpus) ? "corpus" : undefined, plan: ent.plan });
        maybePublishMarketSnapshot(typeOk, addressOk, result);
        harvestComps(typeOk, addressOk, result);
        if (sse) return sse.finish("result", gate(result));
        return sendJson(res, 200, gate(result));
      } catch (err) {
        console.error("Error handling /api/comps:", err);
        const msg = err && err.message ? err.message : "Unknown server error.";
        // Once the SSE headers are out there is no status code left to send —
        // deliver the SAME {error} shape as the JSON path so the client's
        // existing catch/retry card handles it with no new error UI.
        if (sse) return sse.finish("error", { error: msg });
        return sendJson(res, 502, { error: msg });
      }
    });
    return;
  }

  // --- Market Explorer: generate a /market/<slug> page on demand. One billed
  // search per genuinely new market (same cache/caps as /api/comps); results
  // meeting the seed quality bar are published permanently, thinner ones get
  // an ephemeral noindexed preview. ---
  if (req.method === "POST" && req.url === "/api/explore-market") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e4) req.destroy();
    });
    req.on("end", async () => {
      try {
        if (APP_PASSWORD && !passwordMatches(req.headers["x-app-password"])) {
          return sendJson(res, 401, { error: "Unauthorized: incorrect or missing password." });
        }
        const parsed = JSON.parse(body || "{}");
        // Explorer is limited to the four types the market-page format is
        // proven on; Land/Residential stay on the valuation-form path.
        const typeIn = String(parsed.type || "").trim().toLowerCase();
        const typeOk = EXPLORE_TYPES.find((t) => t.toLowerCase() === typeIn);
        const stateOk = String(parsed.state || "").trim().toUpperCase();
        const cityRaw = String(parsed.city || "").trim().replace(/\s+/g, " ");
        if (!typeOk) return sendJson(res, 400, { error: "Pick a property type: Industrial, Office, Retail, or Multifamily." });
        if (!US_STATES.has(stateOk)) return sendJson(res, 400, { error: "That doesn't look like a US state; use the two-letter code, e.g. TX." });
        if (!/^[a-zA-Z][a-zA-Z .'\-]{1,39}$/.test(cityRaw)) return sendJson(res, 400, { error: "That doesn't look like a city name." });
        // Title-case so "los angeles" and "Los Angeles" land on one slug/page.
        const cityOk = cityRaw.toLowerCase().replace(/(^|[\s.'\-])[a-z]/g, (ch) => ch.toUpperCase());

        const slug = slugifyMarket(typeOk, cityOk, stateOk);
        // Existing page (seeded or dynamic) — free, and before the limiter so
        // repeat visits to covered markets never eat anyone's explore budget.
        if (getMarketPage(slug)) {
          return sendJson(res, 200, { url: `/market/${slug}`, slug, published: true, existing: true });
        }

        if (rateLimited("explore:" + clientIp(req), 3, 15 * 60 * 1000)) {
          return sendJson(res, 429, {
            error: "Market generation is limited to a few per visitor per 15 minutes. Try again shortly, or run a valuation for a specific property instead.",
          });
        }
        if (!API_KEY) {
          return sendJson(res, 500, { error: "Server is missing the ANTHROPIC_API_KEY environment variable." });
        }

        let job = exploreInFlight.get(slug);
        if (!job) {
          job = (async () => {
            // Mirrors the /api/comps pipeline with EXACTLY gen-market-seed.js's
            // parameters (address "City, ST", note "", months 24, maxComps 8,
            // txFocus "both", size null) so the two share cache entries — a
            // mismatch here would silently double-bill seed regeneration.
            const address = `${cityOk}, ${stateOk}`;
            const verifiedComps = await fetchVerifiedComps(typeOk, "both");
            const cacheKey = cacheKeyFor({
              address, type: typeOk, note: "", months: 24,
              maxComps: 8, txFocus: "both", subjectSizeSqft: null, verifiedComps,
            });
            let result = await getCachedSearch(cacheKey);
            if (result) reconcilePricePerSqft(result); // legacy cache entries
            const cached = Boolean(result);
            if (!result) {
              if (!tryConsumeDailySearch()) {
                return { status: 429, body: { error: "This site has reached its daily search limit. Please try again after midnight UTC." } };
              }
              result = await getComps(address, typeOk, "", 24, 8, "both", null, verifiedComps);
              await storeCachedSearch(cacheKey, result);
            }
            logEvent("search", { prop_type: typeOk, market: address, cached, source: "explore" });
            harvestComps(typeOk, address, result);

            const { snapshot, pricedSaleCount } = distillMarketSnapshot({ type: typeOk, city: cityOk, state: stateOk }, result);
            if (!snapshot) {
              return { status: 422, body: { error: `We couldn't find enough recent priced ${typeOk.toLowerCase()} sales in ${address} to build a market snapshot. Try a valuation for a specific property instead.` } };
            }
            if (pricedSaleCount >= MIN_PRICED_SALE_COMPS) {
              await storeDynamicMarketPage(slug, snapshot);
              notifyByEmail(`New market page published via Explorer: ${typeOk} — ${address}`, [
                ["Market", address], ["Type", typeOk], ["Priced sale comps", String(pricedSaleCount)],
                ["URL", `${SITE_URL}/market/${slug}`],
              ]);
              return { status: 200, body: { url: `/market/${slug}`, slug, published: true } };
            }
            previewPagesMem.set(slug, { payload: snapshot, ts: Date.now() });
            return { status: 200, body: { url: `/market-preview/${slug}`, slug, published: false, pricedSaleCount } };
          })().finally(() => exploreInFlight.delete(slug));
          exploreInFlight.set(slug, job);
        }
        const { status, body: out } = await job;
        return sendJson(res, status, out);
      } catch (err) {
        console.error("Error handling /api/explore-market:", err);
        const msg = err && err.message ? err.message : "Unknown server error.";
        return sendJson(res, 502, { error: msg });
      }
    });
    return;
  }

  // --- Lead capture: stores contact info submitted to unlock exports ---
  if (req.method === "POST" && req.url === "/api/lead") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e4) req.destroy();
    });
    req.on("end", async () => {
      try {
        // Separate quota from searches ("lead:" prefix) so filling the form
        // never eats into a visitor's search allowance — but the store can't
        // be spammed full either.
        if (rateLimited("lead:" + clientIp(req))) {
          return sendJson(res, 429, { error: "Too many submissions. Please try again later." });
        }
        const { name, email, phone, company, address, type, source, report_url } = JSON.parse(body || "{}");
        const clean = (v, max) => String(v || "").trim().slice(0, max);
        const lead = {
          ts: new Date().toISOString(),
          name: clean(name, 120),
          email: clean(email, 200),
          phone: clean(phone, 60),
          company: clean(company, 120),
          address: clean(address, 300),
          type: clean(type, 40),
          // "bov" = the owner-mode Broker Opinion of Value request; anything
          // else is the export-unlock form.
          source: ["export", "bov"].includes(source) ? source : "export",
        };
        // Share link for the lead's report. Validated hard against our own
        // /r/<id> shape so this endpoint can't be abused to email arbitrary
        // attacker-supplied links. NOT stored in the lead row (the Supabase
        // leads table has no such column) — email/notification only.
        const reportUrl = (() => {
          const u = clean(report_url, 300);
          for (const origin of new Set([SITE_URL, DEFAULT_SITE_URL])) {
            if (new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/r/[A-Za-z0-9_-]{6,32}$`).test(u)) return u;
          }
          return "";
        })();
        if (!lead.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
          return sendJson(res, 400, { error: "A name and a valid email are required." });
        }
        const dest = await storeRow("leads", LEADS_FILE, lead);
        console.log(`Lead captured (${dest}): ${lead.name} <${lead.email}>${lead.address ? " — " + lead.address : ""}`);
        logEvent("lead", { source: lead.source, prop_type: lead.type, market: marketOf(lead.address) });
        // For a BOV request, surface any brokers who've contributed comps in
        // this market so the owner can connect them — the loop's payoff for the
        // broker. Owner-mediated: the broker isn't contacted automatically.
        let brokerField = [];
        if (lead.source === "bov") {
          const brokers = await findBrokersForMarket(marketOf(lead.address));
          if (brokers.length) {
            brokerField = [["Brokers active in this market", brokers.map((b) =>
              `${b.broker_name}${b.broker_company ? " (" + b.broker_company + ")" : ""} — ${b.broker_email}${b.broker_phone ? ", " + b.broker_phone : ""}`).join("; ")]];
          }
        }
        notifyByEmail(
          `${lead.source === "bov" ? "New BOV request" : "New export lead"}: ${lead.name}${lead.address ? " — " + lead.address : ""}`,
          [
            ["Name", lead.name],
            ["Email", lead.email],
            ["Phone", lead.phone],
            ["Company", lead.company],
            ["Property", lead.address],
            ["Property type", lead.type],
            ["Came from", lead.source === "bov" ? "Broker Opinion of Value request" : "Export unlock form"],
            ["Report link", reportUrl],
            ...brokerField,
            ["Stored in", dest],
            ["Time", lead.ts],
          ]
        );
        // Follow-up to the lead: their report link + what happens next.
        // Dormant until EMAIL_FROM is set (custom domain verified in Resend).
        if (lead.source === "bov") {
          sendOutboundEmail(
            lead.email,
            "Your CompNinja report + what happens next",
            [
              `Hi ${lead.name},`,
              ``,
              `Thanks for requesting a free Broker Opinion of Value${lead.address ? " for " + lead.address : ""}.`,
              ...(reportUrl ? [
                ``,
                `Your comp report: ${reportUrl}`,
                `That link is yours to keep or forward.`,
              ] : []),
              ``,
              `What happens next:`,
              `1. We review your request.`,
              `2. We connect you with a licensed local broker who knows your market,`,
              `   usually within a couple of business days.`,
              `3. The broker prepares a no-cost opinion of value. No obligation.`,
              ``,
              `A note on the numbers: everything in the report is an automated estimate`,
              `built from recent comparable sales. It is not an appraisal and not a`,
              `broker opinion of value.`,
              ``,
              `Questions? Just reply to this email.`,
              ``,
              `CompNinja · ${LEAD_NOTIFY_EMAIL}`,
            ].join("\n")
          );
        }
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("Failed to store lead:", err);
        return sendJson(res, 500, { error: "Could not save your details. Please try again." });
      }
    });
    return;
  }

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
          if (existing) return sendJson(res, 409, { error: "An account with this email already exists; sign in instead." });
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
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
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

  // --- Password reset: request a link, then set the new password -----------
  if (req.method === "POST" && req.url === "/api/account/forgot") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (rateLimited("acctf:" + clientIp(req), 10, 15 * 60 * 1000)) {
          return sendJson(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
        }
        const email = String((JSON.parse(body || "{}").email) || "").trim().toLowerCase();
        const user = email ? await findUserByEmail(email) : null;
        if (user) {
          const token = await createPasswordReset(user.id);
          const link = `${SITE_URL}/#reset=${token}`;
          // Gate on BOTH vars: sendOutboundEmail silently no-ops without a
          // RESEND_API_KEY, which would swallow the reset link entirely.
          if (EMAIL_FROM && RESEND_API_KEY) {
            sendOutboundEmail(user.email, "Reset your CompNinja password",
              `Someone (hopefully you) asked to reset the password for this CompNinja account.\n\n` +
              `Reset it here (link works for 1 hour):\n${link}\n\n` +
              `If this wasn't you, ignore this email; your password is unchanged.`);
          } else {
            console.log(`Password reset link for ${user.email} (outbound email not configured, not emailed): ${link}`);
          }
        }
        // Same answer either way — never confirms whether an account exists.
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
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
        if (rateLimited("acct:" + clientIp(req), 10, 15 * 60 * 1000)) {
          return sendJson(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
        }
        const { token, password } = JSON.parse(body || "{}");
        if (String(password || "").length < 8) {
          return sendJson(res, 400, { error: "Password must be at least 8 characters." });
        }
        const userId = await consumePasswordReset(String(token || ""));
        if (!userId) return sendJson(res, 400, { error: "That reset link is invalid or has expired; request a new one." });
        await updateUserPassword(userId, await hashPassword(password));
        await deleteSessionsForUser(userId); // every device must sign in again
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("reset error:", err);
        return sendJson(res, 500, { error: "Could not reset the password." });
      }
    });
    return;
  }

  // --- Portfolio: the signed-in user's saved properties --------------------
  if (req.url === "/api/portfolio" || req.url.startsWith("/api/portfolio?")) {
    if (req.method === "GET") {
      (async () => {
        const user = await requireUser(req, res);
        if (!user) return;
        const id = new URL(req.url, "http://localhost").searchParams.get("id");
        if (id) {
          if (!isUuidish(id)) return sendJson(res, 404, { error: "Not found." });
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
      req.setEncoding("utf8"); // decode per chunk — += on raw buffers mangles a multibyte char split across chunks
      req.on("data", (c) => { body += c; if (body.length > 3e5) req.destroy(); }); // a report is a few KB; 300KB is plenty
      req.on("end", async () => {
        try {
          if (rateLimited("pf:" + clientIp(req), 60)) {
            return sendJson(res, 429, { error: "Too many requests. Please slow down." });
          }
          const user = await requireUser(req, res);
          if (!user) return;
          const { id, payload, snapshot } = JSON.parse(body || "{}");
          if (!payload || typeof payload !== "object" || !payload.meta || !payload.data || !Array.isArray(payload.data.comps)) {
            return sendJson(res, 400, { error: "A report payload ({meta, data}) is required." });
          }
          const address = String(payload.meta.address || "").trim().slice(0, 300);
          const property_type = String(payload.meta.type || "").trim().slice(0, 40);
          if (!address || !property_type) return sendJson(res, 400, { error: "The report is missing its address or type." });
          const snap = cleanSnapshot(snapshot);
          if (id) {
            if (!isUuidish(String(id))) return sendJson(res, 404, { error: "Not found." });
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
          if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
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
        if (!isUuidish(id)) return sendJson(res, 200, { ok: true }); // same no-op as deleting a nonexistent scoped row
        await deletePortfolioItem(user.id, id);
        return sendJson(res, 200, { ok: true });
      })().catch((err) => { console.error("portfolio DELETE error:", err); sendJson(res, 500, { error: "Portfolio delete failed." }); });
      return;
    }
  }

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
      req.setEncoding("utf8"); // decode per chunk — += on raw buffers mangles a multibyte char split across chunks
      req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on("end", async () => {
        try {
          if (rateLimited("wl:" + clientIp(req), 30)) {
            return sendJson(res, 429, { error: "Too many requests. Please slow down." });
          }
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
          if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
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
        if (!isUuidish(id)) return sendJson(res, 200, { ok: true });
        await deleteWatchlistItem(user.id, id);
        return sendJson(res, 200, { ok: true });
      })().catch((err) => { console.error("watchlist DELETE error:", err); sendJson(res, 500, { error: "Watchlist delete failed." }); });
      return;
    }
  }

  if (req.method === "GET" && req.url === "/api/watchlist/feed") {
    (async () => {
      if (rateLimited("wlf:" + clientIp(req), 60)) {
        return sendJson(res, 429, { error: "Too many requests. Please slow down." });
      }
      const user = await requireUser(req, res);
      if (!user) return;
      // The feed is an existing FREE feature, so it is capped rather than
      // taken away: the market aggregates below (new_count, median_psf, the
      // trend arrows) are market-level figures, not comp data, and they are
      // most of why the feed is useful. Only the itemized rows are gated,
      // the same rule the report itself follows.
      const ent = await getEntitlements(user);
      const feedRowCap = ent.maxComps === "all" ? 20 : Number(ent.maxComps);
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
        // Direction: deal-date medians, last 6 months vs the 6 before —
        // >=3 comps each side or the field is omitted entirely.
        const datedSales = saleRowsWithDates(rows);
        const nowFrac = new Date().getFullYear() + (new Date().getMonth() + 0.5) / 12;
        const curWin = datedSales.filter((d) => nowFrac - d.yearFrac >= 0 && nowFrac - d.yearFrac <= 0.5).map((d) => d.psf);
        const priWin = datedSales.filter((d) => nowFrac - d.yearFrac > 0.5 && nowFrac - d.yearFrac <= 1.0).map((d) => d.psf);
        const median_trend = curWin.length >= 3 && priWin.length >= 3
          ? { current: medianPsfOf(curWin), prior: medianPsfOf(priWin) } : null;
        out.push({
          id: w.id, market: w.market, property_type: w.property_type,
          median_psf, new_count: fresh.length,
          ...(median_trend ? { median_trend } : {}),
          // new_count above stays the TRUE number of new comps — the visitor
          // is told what they are missing, they just don't receive it.
          ...(fresh.length > feedRowCap ? { locked_count: fresh.length - feedRowCap } : {}),
          comps: fresh.slice(0, feedRowCap).map((r) => ({
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

  // --- Broker dashboard: the signed-in view of a contributor's submissions.
  // Linkage is by email match (account email == submission broker_email) —
  // no separate broker auth. Only the user's OWN rows ever come back. ---
  if (req.method === "GET" && req.url === "/api/broker/me") {
    (async () => {
      const user = await requireUser(req, res);
      if (!user) return;
      const subs = await fetchSubmissionsForEmail(user.email);
      if (!subs.length) return sendJson(res, 200, { isBroker: false });
      const approved = subs.filter((s) => s.status === "approved");
      let profile = null;
      if (DB_CONFIGURED) {
        try {
          const rows = await sbRequest("GET",
            `broker_profiles?email=eq.${encodeURIComponent(user.email)}&limit=1`);
          const p = rows && rows[0];
          if (p) {
            profile = {
              exists: true, public: Boolean(p.public), slug: p.slug,
              display_name: p.display_name || "", company: p.company || "",
              url: `/broker/${p.slug}`,
            };
          }
        } catch (err) { console.error("broker profile read failed:", err.message); }
      }
      return sendJson(res, 200, {
        isBroker: true,
        db: DB_CONFIGURED,
        stats: {
          total: subs.length,
          approved: approved.length,
          citations: approved.reduce((n, s) => n + (Number(s.cited_count) || 0), 0),
        },
        submissions: subs.map((s) => ({
          id: s.id, ts: s.ts, address: s.address, property_type: s.property_type,
          transaction: s.transaction, deal_date: s.deal_date, price_or_rate: s.price_or_rate,
          status: s.status || "pending", cited_count: Number(s.cited_count) || 0,
        })),
        profile,
      });
    })().catch((err) => { console.error("broker me error:", err); sendJson(res, 500, { error: "Broker lookup failed." }); });
    return;
  }

  if (req.method === "POST" && req.url === "/api/broker/profile") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (rateLimited("bprof:" + clientIp(req), 20)) {
          return sendJson(res, 429, { error: "Too many requests. Please slow down." });
        }
        const user = await requireUser(req, res);
        if (!user) return;
        const wantPublic = Boolean(JSON.parse(body || "{}").public);
        if (!DB_CONFIGURED) return sendJson(res, 400, { error: "Public profiles require the database." });
        const subs = await fetchSubmissionsForEmail(user.email);
        const approved = subs.filter((s) => s.status === "approved");
        if (wantPublic && !approved.length) {
          return sendJson(res, 403, { error: "You need at least one approved comp before enabling a public profile." });
        }
        const existing = (await sbRequest("GET",
          `broker_profiles?email=eq.${encodeURIComponent(user.email)}&limit=1`) || [])[0];
        let row = existing;
        if (!existing) {
          // First enable creates the row; identity comes from their latest
          // submission (what the credit string already shows publicly).
          const latest = subs[0];
          const base = brokerSlugOf(latest.broker_company, latest.broker_name);
          let created = null;
          for (let n = 0; !created && n <= 20; n++) {
            const slug = n === 0 ? base : `${base}-${n + 1}`;
            try {
              const ins = await sbRequest("POST", "broker_profiles", {
                email: user.email,
                display_name: String(latest.broker_name || "").trim(),
                company: String(latest.broker_company || "").trim(),
                slug, public: wantPublic,
              }, { prefer: "return=representation" });
              created = ins && ins[0];
            } catch (err) {
              // Unique-slug collision → try the next suffix; anything else rethrows.
              if (!/409|23505|duplicate/i.test(String(err.message))) throw err;
            }
          }
          if (!created) {
            // 20 collisions — punt to a random suffix (unique constraint still backstops).
            const slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
            const ins = await sbRequest("POST", "broker_profiles", {
              email: user.email,
              display_name: String(subs[0].broker_name || "").trim(),
              company: String(subs[0].broker_company || "").trim(),
              slug, public: wantPublic,
            }, { prefer: "return=representation" });
            created = ins && ins[0];
          }
          row = created;
        } else {
          await sbRequest("PATCH", `broker_profiles?email=eq.${encodeURIComponent(user.email)}`,
            { public: wantPublic, updated_at: new Date().toISOString() });
          row = { ...existing, public: wantPublic };
        }
        BROKER_PROFILES.fetchedAt = 0; // bust so the next refresh isn't debounced
        refreshBrokerProfiles();
        logEvent("broker_profile", { source: wantPublic ? "on" : "off" });
        return sendJson(res, 200, { ok: true, public: Boolean(row.public), slug: row.slug, url: `/broker/${row.slug}` });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("broker profile error:", err);
        return sendJson(res, 500, { error: "Could not update the profile." });
      }
    });
    return;
  }

  // --- Geocode proxy. The model's lat/lng values are block-level guesses, so
  // the front-end re-places map pins from the free US Census geocoder — which
  // has no CORS headers, hence this pass-through. Failures return {} so the
  // browser can fall back to Nominatim (which it can reach directly). ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/geocode") {
    const address = (new URL(req.url, "http://localhost").searchParams.get("address") || "").trim().slice(0, 200);
    if (!address) return sendJson(res, 400, { error: "address is required." });
    // Generous cap: one report geocodes the subject plus up to 8 comps.
    if (rateLimited("geo:" + clientIp(req), 120)) {
      return sendJson(res, 429, { error: "Too many geocode requests. Please wait a few minutes." });
    }
    (async () => {
      try {
        const r = await fetch(
          "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" +
            encodeURIComponent(address),
          { signal: AbortSignal.timeout(6000) }
        );
        const j = await r.json();
        const m = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
        if (m && m.coordinates && isFinite(m.coordinates.y) && isFinite(m.coordinates.x)) {
          return sendJson(res, 200, { lat: m.coordinates.y, lng: m.coordinates.x, matchedAddress: m.matchedAddress || undefined, source: "census" });
        }
        return sendJson(res, 200, {});
      } catch (_) {
        return sendJson(res, 200, {}); // soft failure — the client falls back
      }
    })();
    return;
  }

  // --- Street View photo proxy. Powers the click-to-load building photo in
  // map pin popups (docs/superpowers/specs/2026-07-28-streetview-photos-
  // design.md). Key stays server-side; the FREE metadata endpoint is asked
  // first (cached) so a spot with no imagery never bills an image request.
  // Dark when GOOGLE_MAPS_API_KEY is unset. Every failure path is a bare
  // 404 — the popup <img>'s onerror removes it and the popup stays text-only. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/streetview") {
    const params = new URL(req.url, "http://localhost").searchParams;
    // Prefer an address: Google geocodes it rooftop-accurate and aims the
    // camera at the building's front — noticeably better for houses, whose
    // OSM footprints are often missing so the coordinate path could only aim
    // at the street centerline. Coordinates remain the fallback.
    const address = String(params.get("address") || "").trim().slice(0, 200);
    // Number(null) is 0, so missing params must not masquerade as 0,0.
    const lat = params.get("lat") === null ? NaN : Number(params.get("lat"));
    const lng = params.get("lng") === null ? NaN : Number(params.get("lng"));
    const hasCoords = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (!address && !hasCoords) {
      return sendJson(res, 400, { error: "address or lat and lng are required." });
    }
    if (!GOOGLE_MAPS_API_KEY) { res.writeHead(404); return res.end(); }
    // A report has <= ~9 pins; 60/window is generous for a human reader.
    if (rateLimited("streetview:" + clientIp(req), 60)) {
      return sendJson(res, 429, { error: "Too many photo requests. Please wait a few minutes." });
    }
    (async () => {
      try {
        const loc = address ? encodeURIComponent(address) : lat.toFixed(5) + "," + lng.toFixed(5);
        let hasImagery = STREETVIEW_META_CACHE.get(loc);
        if (hasImagery === undefined) {
          const mr = await fetch(
            "https://maps.googleapis.com/maps/api/streetview/metadata?location=" + loc +
              "&source=outdoor&key=" + GOOGLE_MAPS_API_KEY,
            { signal: AbortSignal.timeout(6000) }
          );
          const mj = await mr.json();
          hasImagery = Boolean(mj && mj.status === "OK");
          if (STREETVIEW_META_CACHE.size >= 500) {
            STREETVIEW_META_CACHE.delete(STREETVIEW_META_CACHE.keys().next().value);
          }
          STREETVIEW_META_CACHE.set(loc, hasImagery);
        }
        if (!hasImagery) { res.writeHead(404); return res.end(); }
        // No `heading` param: Google then aims the camera at the given point
        // from the nearest pano — the "look at the building" behavior.
        // fov=100 + a slight upward pitch: in dense downtowns the pano sits
        // right against tall buildings, and the old fov=80 straight-on shot
        // came back as a slice of wall or one storefront window (Boston
        // Financial District report). The wider, slightly raised frame
        // shows a recognizable building there while barely changing the
        // suburban/industrial shots taken from across a parking lot.
        const ir = await fetch(
          "https://maps.googleapis.com/maps/api/streetview?size=600x360&location=" + loc +
            "&source=outdoor&fov=100&pitch=6&key=" + GOOGLE_MAPS_API_KEY,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!ir.ok) { res.writeHead(404); return res.end(); }
        const buf = Buffer.from(await ir.arrayBuffer());
        res.writeHead(200, {
          "Content-Type": ir.headers.get("content-type") || "image/jpeg",
          "Content-Length": buf.length,
          "Cache-Control": "public, max-age=2592000",
        });
        return res.end(buf);
      } catch (_) {
        res.writeHead(404);
        return res.end();
      }
    })();
    return;
  }

  // --- Corpus comps offer: pure DB read powering the in-report "From
  // CompNinja's records" section (see docs/superpowers/specs/2026-07-28-
  // corpus-offer-design.md). Same provenance bar as corpus-first retrieval —
  // never estimate/news, must be priced, no aggregate addresses. Zero
  // Anthropic cost, no DAILY_SEARCH_CAP interaction. Failure-safe: any
  // internal error still answers 200 with an empty list so a report page
  // never breaks over this. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/corpus-comps") {
    const params = new URL(req.url, "http://localhost").searchParams;
    const address = (params.get("address") || "").trim().slice(0, 300);
    const typeIn = String(params.get("type") || "");
    const typeOk = Object.keys(TYPE_COMP_FIELDS).includes(typeIn) ? typeIn : "";
    if (!address || !typeOk) {
      return sendJson(res, 400, { error: "address and a valid property type are required." });
    }
    if (rateLimited("corpusoffer:" + clientIp(req), 30)) {
      return sendJson(res, 429, { error: "Too many requests." });
    }
    (async () => {
      try {
        const market = marketOf(address);
        const rows = await corpusRowsForMarket(market, typeOk, 100);
        const seen = new Set();
        const comps = [];
        for (const r of rows) {
          const st = String(r.source_type || "").toLowerCase();
          // Provenance must be known and good — same tier corpus-first
          // retrieval trusts; estimate/news (and anything unrecognized)
          // don't get offered back to a visitor as "CompNinja's records".
          if (!["verified", "public_record", "listing"].includes(st)) continue;
          if (!(corpusNum(r.price_or_rate) || corpusNum(r.price_per_sqft))) continue;
          if (isAggregateAddress(r.address)) continue;
          const key = corpusKeyOf(r);
          if (seen.has(key)) continue;
          seen.add(key);
          const comp = {
            address: r.address,
            transaction: r.transaction || "",
            date: r.deal_date || "",
            size_sqft: r.size_sqft || "",
            price_or_rate: r.price_or_rate || "",
            price_per_sqft: r.price_per_sqft || "",
            cap_rate: r.cap_rate || "",
          };
          for (const f of ALL_TYPE_COMP_FIELDS) {
            if (r[f]) comp[f] = r[f];
          }
          comp.source_type = st;
          comp.verified = r.verified === true || r.verified === "true";
          comps.push(comp);
          if (comps.length >= 20) break;
        }
        if (comps.length) {
          logEvent("corpus_offer", { prop_type: typeOk, market, cached: false, source: String(comps.length) });
        }
        // This panel offers comps to ADD to a report, so leaving it open would
        // hand a free visitor exactly the rows the comp gate just withheld —
        // addresses included, no login required. Free users get the COUNT
        // instead: a locked number converts better than an absent panel, and
        // it is the same conversion logic as the locked comp rows.
        const ent = await entitlementsFor(req);
        if (ent.maxComps !== "all") {
          return sendJson(res, 200, { market, comps: [], locked_count: comps.length });
        }
        return sendJson(res, 200, { market, comps });
      } catch (e) {
        console.error("corpus-comps error:", e.message);
        return sendJson(res, 200, { market: "", comps: [] });
      }
    })();
    return;
  }

  // --- Lead download (CSV). Disabled unless ADMIN_KEY is set. ---
  // referred_to is filled in manually (Supabase table editor) when a lead is
  // handed to a contributing broker; new leads arrive with it empty.
  if (req.method === "GET" && req.url.split("?")[0] === "/api/leads") {
    return sendCsvDownload(req, res, "leads", LEADS_FILE,
      ["ts", "name", "email", "phone", "company", "address", "type", "source", "referred_to"], "leads.csv");
  }

  // --- Broker comp submission: stores a comp offered by an outside broker ---
  if (req.method === "POST" && req.url === "/api/comp-submission") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 2e4) req.destroy();
    });
    req.on("end", async () => {
      try {
        if (rateLimited("comp:" + clientIp(req))) {
          return sendJson(res, 429, { error: "Too many submissions. Please try again later." });
        }
        const b = JSON.parse(body || "{}");
        const clean = (v, max) => String(v || "").trim().slice(0, max);
        const submission = {
          ts: new Date().toISOString(),
          status: "pending",
          broker_name: clean(b.broker_name, 120),
          broker_email: clean(b.broker_email, 200),
          broker_company: clean(b.broker_company, 120),
          broker_phone: clean(b.broker_phone, 60),
          address: clean(b.address, 300),
          property_type: ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"].includes(b.property_type) ? b.property_type : "",
          transaction: ["Sale", "Lease"].includes(b.transaction) ? b.transaction : "",
          deal_date: clean(b.deal_date, 40),
          size_sqft: clean(b.size_sqft, 40),
          price_or_rate: clean(b.price_or_rate, 80),
          cap_rate: clean(b.cap_rate, 40),
          notes: clean(b.notes, 1000),
        };
        if (!submission.broker_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.broker_email)) {
          return sendJson(res, 400, { error: "Your name and a valid email are required." });
        }
        if (!submission.address || !submission.price_or_rate) {
          return sendJson(res, 400, { error: "The comp's address and price/rate are required." });
        }
        const dest = await storeRow("comp_submissions", COMP_SUBMISSIONS_FILE, submission);
        console.log(`Comp submitted (${dest}): ${submission.address} — ${submission.broker_name} <${submission.broker_email}>`);
        logEvent("comp", { prop_type: submission.property_type, market: marketOf(submission.address) });
        notifyByEmail(
          `New broker comp submitted: ${submission.address}`,
          [
            ["Broker", submission.broker_name],
            ["Email", submission.broker_email],
            ["Comp", submission.address],
            ["Price/rate", submission.price_or_rate],
            ["Next step", 'Review it in Supabase (comp_submissions, status "pending") and set status to "approved" to add it to the verified layer.'],
          ]
        );
        // Confirmation to the broker. Dormant until EMAIL_FROM is set
        // (custom domain verified in Resend).
        const firm = submission.broker_company || submission.broker_name;
        sendOutboundEmail(
          submission.broker_email,
          `We got your comp: ${submission.address}`,
          [
            `Hi ${submission.broker_name},`,
            ``,
            `Thanks for submitting a comp:`,
            `${submission.address}${submission.transaction ? ", " + submission.transaction : ""}, ${submission.price_or_rate}` +
              `${submission.deal_date ? ", closed " + submission.deal_date : ""}${submission.size_sqft ? ", " + submission.size_sqft + " SF" : ""}`,
            ``,
            `What happens next:`,
            `1. Our team reviews every submission by hand, usually within a couple`,
            `   of business days.`,
            `2. Once approved, your comp joins the verified layer: it shows up in`,
            `   matching reports with a "Verified - via ${firm}" credit, and your`,
            `   firm is credited on our public market page for that area.`,
            `3. When an owner in your market requests a Broker Opinion of Value`,
            `   through CompNinja, contributing brokers are who we reach out to first.`,
            ``,
            `Need to correct anything? Just reply to this email.`,
            ``,
            `CompNinja · ${LEAD_NOTIFY_EMAIL}`,
          ].join("\n")
        );
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("Failed to store comp submission:", err);
        return sendJson(res, 500, { error: "Could not save the comp. Please try again." });
      }
    });
    return;
  }

  // --- Comp submission download (CSV). Disabled unless ADMIN_KEY is set. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/comp-submissions") {
    return sendCsvDownload(req, res, "comp_submissions", COMP_SUBMISSIONS_FILE,
      ["ts", "status", "broker_name", "broker_email", "broker_phone", "broker_company",
       "address", "property_type", "transaction", "deal_date", "size_sqft",
       "price_or_rate", "cap_rate", "notes"], "comp-submissions.csv");
  }

  // --- Admin: broker submission review — list + approve/reject. The whole
  // verified layer keys off comp_submissions.status, so this replaces the
  // manual Supabase table edit with one click in /admin. Broker-network DDL
  // (run 2026-07-19, alongside the hand-created comp_submissions table which
  // already carries "id bigint generated always as identity"):
  //
  //   alter table comp_submissions
  //     add column if not exists cited_count integer not null default 0;
  //   create table broker_profiles (
  //     id uuid primary key default gen_random_uuid(),
  //     email text not null unique,          -- always stored lowercased
  //     display_name text not null default '',
  //     company text default '',
  //     slug text not null unique,
  //     public boolean not null default false,
  //     created_at timestamptz not null default now(),
  //     updated_at timestamptz not null default now()
  //   );
  //   alter table broker_profiles enable row level security;
  // ---------------------------------------------------------------------------
  if (req.method === "GET" && req.url.split("?")[0] === "/api/admin/submissions") {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    const key = req.headers["x-admin-key"] || new URL(req.url, "http://localhost").searchParams.get("key");
    if (!secretMatches(key, ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });
    (async () => {
      // The verified layer is DB-only, so review is too — file mode just tells
      // the admin UI to render its "requires Supabase" note.
      if (!DB_CONFIGURED) return sendJson(res, 200, { db: false, rows: [] });
      const statusIn = new URL(req.url, "http://localhost").searchParams.get("status") || "pending";
      const statusOk = ["pending", "approved", "rejected", "all"].includes(statusIn) ? statusIn : "pending";
      const rows = await sbRequest("GET",
        "comp_submissions?order=ts.desc&limit=200" +
        (statusOk === "all" ? "" : `&status=eq.${statusOk}`) +
        "&select=id,ts,status,broker_name,broker_email,broker_phone,broker_company," +
        "address,property_type,transaction,deal_date,size_sqft,price_or_rate,cap_rate,notes,cited_count");
      return sendJson(res, 200, { db: true, rows: rows || [] });
    })().catch((err) => { console.error("admin submissions error:", err); sendJson(res, 500, { error: "Could not load submissions." }); });
    return;
  }

  if (req.method === "POST" && req.url === "/api/admin/submission-status") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
        if (!secretMatches(req.headers["x-admin-key"], ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });
        if (rateLimited("astat:" + clientIp(req), 60)) return sendJson(res, 429, { error: "Too many requests. Please slow down." });
        const { id, status } = JSON.parse(body || "{}");
        const idOk = Number.isInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
        if (!idOk || !["approved", "rejected"].includes(status)) {
          return sendJson(res, 400, { error: "id and a status of approved/rejected are required." });
        }
        if (!DB_CONFIGURED) return sendJson(res, 409, { error: "Approval requires Supabase; set SUPABASE_URL + SUPABASE_SERVICE_KEY." });
        const rows = await sbRequest("PATCH", `comp_submissions?id=eq.${idOk}`, { status }, { prefer: "return=representation" });
        const row = rows && rows[0];
        if (!row) return sendJson(res, 404, { error: "Not found." });
        logEvent("comp_review", { prop_type: row.property_type, market: marketOf(row.address), source: status });
        if (status === "approved") {
          refreshMarketCredit(); // self-catching; public market-page credit updates ahead of its TTL
          const firm = row.broker_company || row.broker_name;
          sendOutboundEmail(
            row.broker_email,
            `Your comp is live: ${row.address}`,
            [
              `Hi ${row.broker_name},`,
              ``,
              `Good news: your comp was approved and is now part of CompNinja's`,
              `verified layer:`,
              `${row.address}${row.transaction ? ", " + row.transaction : ""}, ${row.price_or_rate}` +
                `${row.deal_date ? ", closed " + row.deal_date : ""}`,
              ``,
              `It now appears in matching reports with a "Verified - via ${firm}"`,
              `credit, and your firm is credited on our public market page for that`,
              `area.`,
              ``,
              `Track your impact: create a free CompNinja account at ${SITE_URL}`,
              `using this same email address to see your submissions, watch when`,
              `reports cite your comps, and turn on a public broker profile.`,
              ``,
              `CompNinja · ${LEAD_NOTIFY_EMAIL}`,
            ].join("\n")
          );
        }
        return sendJson(res, 200, { ok: true, id: row.id, status: row.status });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("submission-status error:", err);
        return sendJson(res, 500, { error: "Could not update the submission." });
      }
    });
    return;
  }

  // --- Comp corpus download (CSV). Disabled unless ADMIN_KEY is set. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/comp-corpus") {
    return sendCsvDownload(req, res, "comp_corpus", COMP_CORPUS_FILE,
      ["ts", "property_type", "market", "address", "transaction", "deal_date",
       "size_sqft", "price_or_rate", "price_per_sqft", "cap_rate",
       ...ALL_TYPE_COMP_FIELDS,
       "tenancy", "year_built", "notes", "source_url", "source_type",
       "verified"], "comp-corpus.csv");
  }

  // --- Tells the front-end whether a password is required ---
  // --- Stripe: create a Checkout Session ---
  // Subscribing requires an account (a subscription has to attach to a user).
  // The $39 single-report path is deliberately different — see phase 8.
  if (req.method === "POST" && req.url === "/api/checkout") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (!PRO_ENABLED || !STRIPE_CONFIGURED) {
          return sendJson(res, 503, { error: "Billing isn't enabled on this deployment yet." });
        }
        if (rateLimited("checkout:" + clientIp(req), 20)) {
          return sendJson(res, 429, { error: "Too many attempts. Please wait a moment." });
        }
        const user = await requireUser(req, res);
        if (!user) return;
        // Audience is checked AFTER the user resolves — it is per-account, so
        // there is nothing to test until we know who is asking. During a test
        // window this is what stops a stranger buying Pro with a published
        // test card.
        if (!proEnabledFor(user)) {
          return sendJson(res, 503, { error: "Billing isn't enabled on this deployment yet." });
        }
        const { plan } = JSON.parse(body || "{}");
        const wantsFounding = plan === "pro_annual_founding";
        let priceId = wantsFounding ? STRIPE_PRICES.annualFounding : STRIPE_PRICES.monthly;
        if (!priceId) return sendJson(res, 503, { error: "That plan isn't configured." });

        // Seat check at checkout CREATION. There is a small race here — two
        // people can pass the check within the same second and both reach 51 —
        // so the webhook re-checks and logs loudly. Deliberate: a hard
        // reservation would need a lock, and honouring one extra founder is a
        // cheaper failure than a checkout that dies mid-payment.
        if (wantsFounding) {
          const left = await foundingSlotsLeft();
          if (left === null || left <= 0) {
            return sendJson(res, 409, {
              error: "The founding-member offer has closed.",
              code: "founding_closed",
              fallbackPlan: "pro_monthly",
            });
          }
        }

        const existing = await findSubscription(user.id);
        const session = await STRIPE.stripeRequest(STRIPE_SECRET_KEY, "POST", "checkout/sessions", {
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${SITE_URL}/desk?checkout=success`,
          cancel_url: `${SITE_URL}/desk?checkout=cancelled`,
          client_reference_id: user.id,
          // Both: metadata rides on the session, and subscription_data's copy
          // lands on the subscription itself so later lifecycle events can be
          // traced back to a user without a DB round trip.
          metadata: { user_id: user.id },
          subscription_data: { metadata: { user_id: user.id } },
          ...(existing && existing.stripe_customer_id
            ? { customer: existing.stripe_customer_id }
            : { customer_email: user.email }),
        });
        return sendJson(res, 200, { url: session.url, id: session.id });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("Checkout session failed:", err.message);
        return sendJson(res, 502, { error: "Could not start checkout. Please try again." });
      }
    });
    return;
  }

  // --- Stripe: Customer Portal (cancel, payment method, invoices) ---
  if (req.method === "POST" && req.url === "/api/billing-portal") {
    req.on("data", () => {});
    req.on("end", async () => {
      try {
        if (!PRO_ENABLED || !STRIPE_CONFIGURED) {
          return sendJson(res, 503, { error: "Billing isn't enabled on this deployment yet." });
        }
        const user = await requireUser(req, res);
        if (!user) return;
        if (!proEnabledFor(user)) {
          return sendJson(res, 503, { error: "Billing isn't enabled on this deployment yet." });
        }
        const sub = await findSubscription(user.id);
        const customer = sub && sub.stripe_customer_id;
        if (!customer) return sendJson(res, 400, { error: "No billing account found for you yet." });
        const portal = await STRIPE.stripeRequest(STRIPE_SECRET_KEY, "POST", "billing_portal/sessions", {
          customer,
          return_url: `${SITE_URL}/desk`,
        });
        return sendJson(res, 200, { url: portal.url });
      } catch (err) {
        console.error("Billing portal failed:", err.message);
        return sendJson(res, 502, { error: "Could not open the billing portal." });
      }
    });
    return;
  }

  // --- Stripe: webhook ---
  // The RAW body is the signed payload. It must NOT be parsed before
  // verification: re-serializing changes byte order and the HMAC stops
  // matching, which is the classic way this check gets silently disabled.
  if (req.method === "POST" && req.url === "/api/stripe/webhook") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      const verdict = STRIPE.verifyWebhookSignature(raw, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
      if (!verdict.ok) {
        console.error("Rejected Stripe webhook:", verdict.reason);
        return sendJson(res, 400, { error: "Invalid signature." });
      }
      let evt;
      try { evt = JSON.parse(raw); } catch (_) { return sendJson(res, 400, { error: "Bad payload." }); }

      // Acknowledge FIRST, then work. Stripe times out at 20 seconds and a
      // cold Render instance can eat most of that; a slow handler would earn
      // an endless retry storm for work we already did.
      sendJson(res, 200, { received: true });

      try {
        if (!(await claimStripeEvent(evt))) return;   // duplicate delivery
        await handleStripeEvent(evt);
      } catch (err) {
        console.error(`Stripe webhook ${evt && evt.type} failed:`, err.message);
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/config") {
    // Entitlements ride along so the UI can show locked states without a
    // second round trip. This is presentation only — every limit it describes
    // is already enforced server-side, so a visitor editing this response in
    // dev tools unlocks nothing but their own disabled buttons.
    entitlementsFor(req).then((ent) => {
      // Per-visitor, not global: computeEntitlements reports status "disabled"
      // exactly when it was handed enabled:false, which is the case both when
      // PRO_ENABLED is off and when this visitor sits outside PRO_AUDIENCE.
      // Reading it back here keeps the UI in step with the routes without
      // resolving the session user a second time.
      const on = ent.status !== "disabled";
      sendJson(res, 200, {
        authRequired: Boolean(APP_PASSWORD),
        leadCapture: LEAD_CAPTURE,
        streetview: Boolean(GOOGLE_MAPS_API_KEY),
        pro: {
          enabled: on,
          // Checkout and the portal both 503 unless Stripe is configured too,
          // so the UI needs BOTH flags — `enabled` alone would render a Buy
          // button that can only fail.
          billing: on && STRIPE_CONFIGURED,
          isPro: ent.pro,
          plan: ent.plan,
          // "none" = never subscribed; anything else means a Stripe customer
          // exists, which is what decides whether "Manage billing" is offered.
          status: ent.status,
          maxComps: ent.maxComps,
          maxLookbackMonths: ent.maxLookbackMonths,
          exportsRemaining: ent.exportsRemaining,
          graceUntil: ent.graceUntil,
        },
      });
    }).catch(() => sendJson(res, 200, { authRequired: Boolean(APP_PASSWORD), leadCapture: LEAD_CAPTURE, streetview: Boolean(GOOGLE_MAPS_API_KEY) }));
    return;
  }

  // --- Pricing, for the upgrade surface ---
  // Deliberately NOT folded into /api/config: the founding count is a DB read
  // and /api/config runs on every page load. This one is fetched lazily, the
  // first time someone opens the pricing modal.
  //
  // `foundingLeft: null` means "unknown" — foundingSlotsLeft() returns null
  // both when the DB is unconfigured and when the query fails, and checkout
  // treats null as closed. The UI therefore hides the counter and the founding
  // tile rather than advertising an offer that would 409 on click.
  if (req.method === "GET" && req.url === "/api/pricing") {
    if (rateLimited("pricing:" + clientIp(req), 60)) {
      return sendJson(res, 429, { error: "Too many requests. Please wait a moment." });
    }
    const closed = { billing: false, foundingLeft: null, foundingLimit: FOUNDING_MEMBER_LIMIT };
    // Audience-scoped like checkout: outside it there is nothing on sale, so
    // don't hand back a seat count that implies otherwise.
    getSessionUser(req).then((user) => {
      if (!proEnabledFor(user) || !STRIPE_CONFIGURED) return sendJson(res, 200, closed);
      // 60s memo so a burst of modal opens can't turn into a burst of queries.
      if (foundingCountCache && Date.now() - foundingCountCache.at < 60_000) {
        return sendJson(res, 200, { billing: true, foundingLeft: foundingCountCache.left, foundingLimit: FOUNDING_MEMBER_LIMIT });
      }
      return foundingSlotsLeft().then((left) => {
        foundingCountCache = { at: Date.now(), left };
        sendJson(res, 200, { billing: true, foundingLeft: left, foundingLimit: FOUNDING_MEMBER_LIMIT });
      });
    }).catch(() => sendJson(res, 200, closed));
    return;
  }

  // --- Claim one report-export against the monthly allowance ---
  //
  // This is a HONOUR-SYSTEM counter and should be read as one. Every export is
  // produced in the browser — CSV built in JS, PNG by html2canvas, PDF by
  // window.print — so the server never sees the file and cannot withhold it.
  // All this route can do is answer "may I?" and record the answer. Someone
  // with dev tools open walks straight past it, exactly as they can past the
  // lead-capture gate. It is a conversion nudge, not a security boundary, and
  // nothing of value is protected by it.
  //
  // Replies:
  //   200 { allowed:true, remaining }   — go ahead
  //   401 { code:"signin_required" }    — exporting needs an account
  //   403 { code:"export_limit" }       — allowance spent this month
  if (req.method === "POST" && req.url === "/api/export") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", async () => {
      try {
        if (rateLimited("export:" + clientIp(req), 60)) {
          return sendJson(res, 429, { error: "Too many exports. Please wait a moment." });
        }
        const { report } = JSON.parse(body || "{}");
        const user = await getSessionUser(req);
        const ent = await getEntitlements(user);

        // Pro, a purchased report, or the whole tier switched off: no ceiling,
        // so nothing to count and nothing to store.
        if (ent.exportsRemaining === "unlimited") {
          return sendJson(res, 200, { allowed: true, remaining: "unlimited" });
        }
        if (!user) {
          return sendJson(res, 401, {
            code: "signin_required",
            error: "Create a free account to export reports.",
          });
        }

        const now = Date.now();
        const period = ENT.usagePeriod(now);
        const key = reportKeyOf(report);
        const usage = await getExportUsage(user.id, period);
        // A failed read returns null and we let it through — see getExportUsage.
        if (!usage) return sendJson(res, 200, { allowed: true, remaining: ent.exportsRemaining });

        const cap = usage.count + Number(ent.exportsRemaining);
        // Already exported THIS report this month: free, and no second row.
        if (key && usage.keys.includes(key)) {
          return sendJson(res, 200, { allowed: true, remaining: Math.max(0, cap - usage.count), repeat: true });
        }
        if (usage.count >= cap) {
          return sendJson(res, 403, {
            code: "export_limit",
            error: `You've exported ${cap} reports this month. Pro removes the limit.`,
            remaining: 0,
          });
        }
        await recordExport(user.id, period, key);
        return sendJson(res, 200, { allowed: true, remaining: Math.max(0, cap - usage.count - 1) });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        // Never let a bug here block an export.
        console.error("Export claim failed (allowing the export):", err.message);
        return sendJson(res, 200, { allowed: true, remaining: "unlimited" });
      }
    });
    return;
  }

  // --- Validate a password (so the UI can confirm before searching) ---
  if (req.method === "POST" && req.url === "/api/login") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e4) req.destroy();
    });
    req.on("end", () => {
      if (!APP_PASSWORD) return sendJson(res, 200, { ok: true }); // no gate configured
      try {
        const { password } = JSON.parse(body || "{}");
        if (passwordMatches(password)) return sendJson(res, 200, { ok: true });
        return sendJson(res, 401, { error: "Incorrect password." });
      } catch (_) {
        return sendJson(res, 400, { error: "Bad request." });
      }
    });
    return;
  }

  // --- Publish a report under a short id so the visitor can share the link ---
  // --- Property-type autofill: outcome ping -------------------------------
  // The autofill is otherwise invisible: when it stays quiet you cannot tell
  // whether OSM had no match, Overpass was down, or it agreed with the type
  // already selected. This records which, so /admin can show whether the
  // feature works in the field instead of just failing safe in silence.
  //
  // The client supplies only an address and an outcome. Everything stored is
  // derived or whitelisted here — never trusted from the body — so a hostile
  // caller can add rows but cannot choose what they say or write PII into the
  // analytics table. The address is used to derive the market and discarded.
  if (req.method === "POST" && req.url === "/api/type-autofill") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 4e3) req.destroy();   // an address and two short words
    });
    req.on("end", () => {
      // Always 204: this is telemetry, and a client must never learn anything
      // from it or change behaviour on its result.
      res.writeHead(204).end();
      try {
        if (rateLimited("tafill:" + clientIp(req), 60)) return;
        const p = JSON.parse(body || "{}");
        const OUTCOMES = ["applied", "agreed", "no_address_match", "ambiguous", "failed"];
        const outcome = OUTCOMES.indexOf(String(p.outcome || "")) >= 0 ? String(p.outcome) : null;
        if (!outcome) return;
        const TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];
        const type = TYPES.indexOf(String(p.type || "")) >= 0 ? String(p.type) : "";
        logEvent("type_autofill", { prop_type: type, market: marketOf(p.address), source: outcome });
      } catch (_) { /* malformed ping — drop it, never surface it */ }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/share") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 3e5) req.destroy(); // a report is a few KB; 300KB is plenty
    });
    req.on("end", async () => {
      try {
        if (rateLimited("share:" + clientIp(req), 30)) {
          return sendJson(res, 429, { error: "Too many shares from this connection. Please wait a few minutes." });
        }
        const parsed = JSON.parse(body || "{}");
        const report = parsed && parsed.data, meta = parsed && parsed.meta;
        // Only publish something that actually looks like a rendered report.
        if (!report || !Array.isArray(report.comps) || !meta || !meta.address) {
          return sendJson(res, 400, { error: "A complete report is required to share." });
        }
        // NOI, loan terms, and the op-ex card's gross income are the owner's
        // private finances — never let them ride along on a link that can be
        // forwarded. The sales-comparison value still shows; the income-
        // approach cross-check and the debt module drop out. DCF assumptions
        // (hold/growth/discount/exit cap) stay: they're opinions, not finances.
        const safeMeta = { ...meta };
        if (safeMeta.subject) {
          safeMeta.subject = { ...safeMeta.subject, noi: null };
        }
        if (safeMeta.assumptions && typeof safeMeta.assumptions === "object") {
          safeMeta.assumptions = { ...safeMeta.assumptions };
          delete safeMeta.assumptions.debt;
          delete safeMeta.assumptions.rentRoll;
          delete safeMeta.assumptions.opex;
        }
        delete safeMeta.sample;
        delete safeMeta.fromHistory;
        delete safeMeta.portfolioId;
        safeMeta.shared = true;
        safeMeta.generatedAt = meta.generatedAt || Date.now();
        const id = newShareId();
        await storeSharedReport(id, { data: report, meta: safeMeta });
        logEvent("share", { prop_type: safeMeta.type, market: marketOf(safeMeta.address) });
        return sendJson(res, 200, { id, url: `${SITE_URL}/r/${id}` });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("Failed to store shared report:", err);
        return sendJson(res, 500, { error: "Could not create the share link. Please try again." });
      }
    });
    return;
  }

  // --- Fetch a published report by id (public: anyone with the link) ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/shared") {
    const id = (new URL(req.url, "http://localhost").searchParams.get("id") || "").trim();
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
      return sendJson(res, 400, { error: "Invalid share id." });
    }
    getSharedReport(id).then((payload) => {
      if (!payload) return sendJson(res, 404, { error: "This shared report was not found." });
      return sendJson(res, 200, payload);
    }).catch((err) => {
      console.error("Shared report lookup failed:", err);
      return sendJson(res, 500, { error: "Could not load the shared report." });
    });
    return;
  }

  // --- Static: serve index.html for "/", "/index.html", a /r/<id> share link,
  // or /desk (the SPA's My Desk view — the client reads the path and shows the
  // desk instead of the home stack). ---
  //
  // Matched on the PATH, not the raw url: Stripe Checkout returns to
  // /desk?checkout=success|cancelled, and an exact-string match would 404 the
  // page someone lands on straight after paying. Same fix covers a campaign
  // link to /?utm_source=…, which used to 404 for the same reason.
  const staticPath = req.url.split("?")[0];
  if (req.method === "GET" && (staticPath === "/" || staticPath === "/index.html" || staticPath === "/desk" || /^\/r\/[A-Za-z0-9_-]{6,32}$/.test(staticPath))) {
    fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end("index.html not found");
      }
      // no-store: the whole front-end is this one file, so a stale cached copy
      // means users silently miss every update. It's small; always fetch fresh.
      // /desk is a personal workspace — noindex it (header only; the shared
      // index.html meta robots tag stays index,follow for "/").
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...(staticPath === "/desk" ? { "x-robots-tag": "noindex, nofollow" } : {}),
      });
      // Canonical/og/JSON-LD URLs in index.html are written against the default
      // origin; rewrite them when SITE_URL is overridden (custom domain).
      res.end(SITE_URL === DEFAULT_SITE_URL ? data : data.toString("utf8").split(DEFAULT_SITE_URL).join(SITE_URL));
    });
    return;
  }

  // --- Static assets: allowlisted files only, never arbitrary paths. The CSS
  // gets a short max-age so a redeploy with new classes reaches browsers fast;
  // images are stable and can cache for a day.
  const STATIC_FILES = {
    "/tailwind.css": { file: "tailwind.css", type: "text/css; charset=utf-8", maxAge: 300 },
    "/og-image.png": { file: "og-image.png", type: "image/png", maxAge: 86400 },
    "/apple-touch-icon.png": { file: "apple-touch-icon.png", type: "image/png", maxAge: 86400 },
    "/favicon.ico": { file: "favicon.ico", type: "image/x-icon", maxAge: 86400 },
    "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml", maxAge: 86400 },
    "/favicon.png": { file: "favicon.png", type: "image/png", maxAge: 86400 },
  };
  if (req.method === "GET" && STATIC_FILES[req.url]) {
    const { file, type, maxAge } = STATIC_FILES[req.url];
    fs.readFile(path.join(__dirname, file), (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Not found");
      }
      res.writeHead(200, { "content-type": type, "cache-control": `public, max-age=${maxAge}` });
      res.end(data);
    });
    return;
  }

  // --- Health check (handy for hosting platforms + uptime pingers, which
  // typically probe with HEAD to save bandwidth) ---
  if ((req.method === "GET" || req.method === "HEAD") && req.url === "/healthz") {
    if (req.method === "HEAD") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end();
    }
    return sendJson(res, 200, { ok: true, hasKey: Boolean(API_KEY) });
  }

  // --- Market list for the landing page's market-search box (seed + explorer
  // pages, never a billed search). Short max-age so newly explored markets
  // show up in the search box promptly. ---
  if (req.method === "GET" && req.url === "/api/markets") {
    const merged = allMarketPages();
    const list = Object.keys(merged).map((slug) => {
      const p = merged[slug];
      return { slug, type: p.type, city: p.city, state: p.state };
    });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=300" });
    return res.end(JSON.stringify(list));
  }

  // --- How It Works — the standalone proof/FAQ page (header + footer nav).
  // Static content, so it caches for an hour like the market pages. ---
  if (req.method === "GET" && req.url.split("#")[0] === "/how-it-works") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(renderHowItWorksHTML());
  }

  // --- Brokers — the contributor-facing page (header + footer nav). Static
  // content, same hour-long cache as /how-it-works. Sits above the
  // /broker/<slug> profile matcher below so the two stay adjacent. ---
  if (req.method === "GET" && req.url.split("#")[0] === "/brokers") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(renderBrokersPageHTML());
  }

  // --- Market landing pages (programmatic SEO) ---
  if (req.method === "GET" && req.url === "/markets") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(renderMarketDirectoryHTML());
  }
  const marketMatch = req.method === "GET" && req.url.match(/^\/market\/([a-z0-9-]{3,80})$/);
  if (marketMatch) {
    const page = getMarketPage(marketMatch[1]);
    if (!page) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Market not found"); }
    // Stale-while-revalidate: serve from the current credit cache and kick a
    // background refresh when it's old — the response never waits on the DB.
    if (Date.now() - MARKET_CREDIT.fetchedAt > MARKET_CREDIT_TTL_MS) refreshMarketCredit();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(renderMarketPageHTML(marketMatch[1], page));
  }

  // --- Public broker profiles — opt-in pages for verified contributors ---
  const brokerMatch = req.method === "GET" && req.url.match(/^\/broker\/([a-z0-9-]{3,80})$/);
  if (brokerMatch) {
    (async () => {
      if (rateLimited("bpage:" + clientIp(req), 60)) {
        res.writeHead(429, { "content-type": "text/plain" });
        return res.end("Too many requests.");
      }
      if (!DB_CONFIGURED) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
      const rows = await sbRequest("GET",
        `broker_profiles?slug=eq.${encodeURIComponent(brokerMatch[1])}&public=eq.true&limit=1`);
      const profile = rows && rows[0];
      if (!profile) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
      const subs = await fetchSubmissionsForEmail(profile.email);
      // Short max-age so toggling a profile off propagates within minutes.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" });
      return res.end(renderBrokerProfileHTML(profile, subs));
    })().catch((err) => {
      console.error("broker page error:", err);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Something went wrong.");
    });
    return;
  }

  // --- Explorer previews: thin-data market snapshots, visible only to whoever
  // generated them. In-memory with a short TTL, noindexed at every layer
  // (meta tag, X-Robots-Tag, robots.txt) and never linked from indexed pages.
  const previewMatch = req.method === "GET" && req.url.match(/^\/market-preview\/([a-z0-9-]{3,80})$/);
  if (previewMatch) {
    const entry = previewPagesMem.get(previewMatch[1]);
    if (!entry || Date.now() - entry.ts > PREVIEW_TTL_MS) {
      previewPagesMem.delete(previewMatch[1]);
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Preview expired; explore the market again from the homepage.");
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    });
    return res.end(renderMarketPageHTML(previewMatch[1], entry.payload, { preview: true }));
  }

  // --- Development hub: repo-committed changelog + editable future ideas.
  // Same gate as /api/stats: 404 with ADMIN_KEY unset, 401 on a bad key. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/devlog") {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    // Header-only on the dev endpoints: the page always sends the header, and
    // a ?key= form would leak the admin key into URLs and access logs. (The
    // CSV downloads keep ?key= — browser download links can't set headers.)
    if (!secretMatches(req.headers["x-admin-key"], ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });
    readDevlogMerged()
      .then((entries) => sendJson(res, 200, { entries }))
      .catch((err) => { console.error("devlog read failed:", err); sendJson(res, 500, { error: "Could not load the changelog." }); });
    return;
  }
  // Click-to-edit: upsert (or reset) one entry's override. The key must match
  // a real file entry, so junk rows can't accumulate in the overlay.
  if (req.method === "PUT" && req.url.split("?")[0] === "/api/devlog-edit") {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    if (!secretMatches(req.headers["x-admin-key"], ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 256 * 1024) req.destroy(); });
    req.on("end", async () => {
      try {
        const { key, reset, title, details, notes } = JSON.parse(body || "{}");
        const original = readDevlogFileEntries().find((e) => devlogKey(e) === key);
        if (!original) return sendJson(res, 400, { error: "Unknown changelog entry." });
        let storage;
        if (reset) {
          storage = await writeDevlogOverride(key, null);
        } else {
          const t = String(title || "").trim();
          const d = String(details || "").trim();
          const n = String(notes || "").trim();
          if (!t) return sendJson(res, 400, { error: "The entry needs a title." });
          if (t.length > 200 || d.length > 2000 || n.length > 2000) {
            return sendJson(res, 400, { error: "Too long (title max 200, details/notes max 2000 characters)." });
          }
          // Identical to the committed text with no note = no override needed.
          const same = t === String(original.title || "") && d === String(original.details || "");
          storage = same && !n
            ? await writeDevlogOverride(key, null)
            : await writeDevlogOverride(key, { title: t, details: d, notes: n });
        }
        return sendJson(res, 200, { entries: await readDevlogMerged(), storage });
      } catch (err) {
        console.error("devlog-edit save failed:", err.message);
        return sendJson(res, 400, { error: "Invalid JSON body." });
      }
    });
    return;
  }
  if ((req.method === "GET" || req.method === "PUT") && req.url.split("?")[0] === "/api/dev-ideas") {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    if (!secretMatches(req.headers["x-admin-key"], ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });
    if (req.method === "GET") {
      readDevIdeas()
        .then((ideas) => sendJson(res, 200, { ideas }))
        .catch((err) => { console.error("dev-ideas read failed:", err); sendJson(res, 500, { error: "Could not load ideas." }); });
      return;
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 256 * 1024) req.destroy(); });
    req.on("end", async () => {
      try {
        const { ideas } = JSON.parse(body || "{}");
        if (!Array.isArray(ideas)) return sendJson(res, 400, { error: "Body must be { ideas: [...] }." });
        if (ideas.length > 100) return sendJson(res, 400, { error: "Too many ideas (max 100)." });
        const clean = [];
        for (const raw of ideas) {
          const text = String((raw && raw.text) || "").trim();
          if (!text) return sendJson(res, 400, { error: "Every idea needs text." });
          if (text.length > 500) return sendJson(res, 400, { error: "Idea text is too long (max 500 characters)." });
          const notes = String((raw && raw.notes) || "").trim();
          if (notes.length > 500) return sendJson(res, 400, { error: "Idea notes are too long (max 500 characters)." });
          const done = !!raw && raw.status === "done";
          clean.push({
            // Ids stricter than before (UUID shape only): they now ride inside
            // writeDevIdeas' not.in.() filter, so free-form ids are regenerated.
            id: raw && typeof raw.id === "string" && /^[0-9a-fA-F-]{36}$/.test(raw.id) ? raw.id : crypto.randomUUID(),
            text,
            status: done ? "done" : "open",
            priority: raw && ["now", "next", "later"].includes(raw.priority) ? raw.priority : "next",
            notes: notes || null,
            // Stamped when an idea first flips to done, kept on later saves,
            // cleared when it reopens — feeds the dated Shipped section.
            done_at: done ? (raw && typeof raw.done_at === "string" && raw.done_at ? raw.done_at : new Date().toISOString()) : null,
            created_at: raw && typeof raw.created_at === "string" && raw.created_at ? raw.created_at : new Date().toISOString(),
          });
        }
        await writeDevIdeas(clean);
        return sendJson(res, 200, { ideas: clean });
      } catch (err) {
        console.error("dev-ideas save failed:", err.message);
        return sendJson(res, 400, { error: "Invalid JSON body." });
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/dev") {
    // Same triple-noindex treatment as /admin (its own meta tag, this header,
    // and the robots.txt Disallow).
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    });
    return res.end(renderDevHubHTML());
  }

  // --- Contacts: the internal rolodex. Every response returns the FULL list so
  // a save or delete refreshes other people's view on their next action. ---
  if (req.url.split("?")[0] === "/api/contacts" &&
      (req.method === "GET" || req.method === "POST" || req.method === "DELETE")) {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    if (!secretMatches(req.headers["x-admin-key"], ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });

    if (req.method === "GET") {
      readContacts()
        .then((contacts) => sendJson(res, 200, { contacts }))
        .catch((err) => { console.error("Contacts read failed:", err); sendJson(res, 500, { error: "Could not load contacts." }); });
      return;
    }

    if (req.method === "DELETE") {
      const id = new URL(req.url, "http://localhost").searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "Missing contact id." });
      deleteContact(id)
        .then(() => readContacts())
        .then((contacts) => sendJson(res, 200, { contacts }))
        .catch((err) => { console.error("Contact delete failed:", err); sendJson(res, 500, { error: "Could not delete the contact." }); });
      return;
    }

    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        // An edit keeps the original id and created_at; a new contact gets both.
        let existing = null;
        if (parsed.id) {
          existing = (await readContacts()).find((c) => c.id === parsed.id) || null;
          if (!existing) return sendJson(res, 404, { error: "That contact no longer exists." });
        }
        const contact = sanitizeContact(parsed, existing);
        if (!contact) return sendJson(res, 400, { error: "A name is required." });
        const stored = await saveContact(contact);
        return sendJson(res, 200, { contacts: await readContacts(), stored });
      } catch (err) {
        console.error("Contact save failed:", err.message);
        return sendJson(res, 400, { error: "Invalid JSON body." });
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/contacts") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    });
    return res.end(renderContactsHTML());
  }

  // --- Analytics: PII-free aggregates (ADMIN_KEY-gated) + a self-contained
  // admin dashboard. Logging happens regardless; only the view is gated. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/stats") {
    if (!ADMIN_KEY) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    const key = req.headers["x-admin-key"] || new URL(req.url, "http://localhost").searchParams.get("key");
    if (!secretMatches(key, ADMIN_KEY)) return sendJson(res, 401, { error: "Unauthorized." });
    readRows("analytics_events", ANALYTICS_FILE, ["ts", "kind", "prop_type", "market", "source", "cached"])
      .then((rows) => sendJson(res, 200, aggregateStats(rows)))
      .catch((err) => { console.error("Stats read failed:", err); return sendJson(res, 500, { error: "Could not load stats." }); });
    return;
  }
  if (req.method === "GET" && req.url === "/admin") {
    // Third noindex layer alongside the page's own meta tag and the
    // robots.txt Disallow — belt-and-suspenders against a crawler that
    // ignores one of the other two (same pattern as /market-preview/).
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    });
    return res.end(renderAdminHTML());
  }

  // --- SEO: robots.txt + sitemap (homepage + market directory + every market
  // page) so crawlers discover and index the whole landing-page set ---
  if (req.method === "GET" && req.url === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /contacts\nDisallow: /desk\nDisallow: /dev\nDisallow: /market-preview/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  }
  if (req.method === "GET" && req.url === "/sitemap.xml") {
    const merged = allMarketPages();
    const marketUrls = Object.keys(merged).map((slug) => {
      const lastmod = merged[slug].generatedAt;
      return `  <url><loc>${marketUrl(slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
    }).join("\n");
    if (Date.now() - BROKER_PROFILES.fetchedAt > BROKER_PROFILES_TTL_MS) refreshBrokerProfiles();
    const brokerUrls = Object.keys(BROKER_PROFILES.bySlug).map((slug) =>
      `  <url><loc>${SITE_URL}/broker/${slug}</loc></url>`).join("\n");
    res.writeHead(200, { "content-type": "application/xml" });
    return res.end(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${SITE_URL}/</loc></url>\n` +
      `  <url><loc>${SITE_URL}/how-it-works</loc></url>\n` +
      `  <url><loc>${SITE_URL}/brokers</loc></url>\n` +
      `  <url><loc>${SITE_URL}/markets</loc></url>\n` +
      (marketUrls ? marketUrls + "\n" : "") +
      (brokerUrls ? brokerUrls + "\n" : "") +
      `</urlset>\n`
    );
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Market Comp Puller running at http://localhost:${PORT}`);
  refreshMarketCredit();   // warm the broker-credit cache for market pages
  refreshBrokerProfiles(); // warm the public-profile cache (badge links + sitemap)
  refreshMarketIntel();    // warm the corpus-intelligence cache (market pages + feed)
  loadDynamicMarketPages().then((n) => {
    console.log(`🧭 Market Explorer: ${n} visitor-generated page(s) loaded (${DB_CONFIGURED ? "Supabase market_pages" : path.basename(DYNAMIC_MARKETS_FILE) + " — EPHEMERAL on most hosts; run the market_pages DDL in Supabase for durable storage"}).`);
  });
  if (!API_KEY) {
    console.warn("⚠  ANTHROPIC_API_KEY is not set — /api/comps will return an error until you set it.");
  }
  console.log(APP_PASSWORD
    ? "🔒 Password gate ENABLED (APP_PASSWORD is set)."
    : "🔓 Password gate disabled — anyone with the URL can run searches. Set APP_PASSWORD to require a password.");
  console.log(LEAD_CAPTURE
    ? `🧲 Lead capture ENABLED — exports require contact info; leads go to ${DB_CONFIGURED ? "Supabase" : path.basename(LEADS_FILE) + " (EPHEMERAL on most hosts — set SUPABASE_URL + SUPABASE_SERVICE_KEY for durable storage)"}.`
    : "Lead capture disabled (set LEAD_CAPTURE=on to enable).");
  if (LEAD_CAPTURE && !ADMIN_KEY) {
    console.warn("⚠  ADMIN_KEY is not set — GET /api/leads (lead download) is disabled.");
  }
  console.log(RESEND_API_KEY
    ? `📧 Lead notifications ENABLED — new leads and comp submissions email ${LEAD_NOTIFY_EMAIL}.`
    : "Lead notifications disabled — set RESEND_API_KEY (free at resend.com) to get an email for every new lead.");
  console.log(`🌐 Market SEO pages: ${Object.keys(MARKET_PAGES).length} seeded at /markets (regenerate with: node gen-market-seed.js) + Market Explorer pages on demand.`);
  console.log(ADMIN_KEY
    ? "📈 Analytics ENABLED — view at /admin (enter ADMIN_KEY). Events log regardless of this key."
    : "📈 Analytics logging on; the /admin dashboard needs ADMIN_KEY set to view it.");
  console.log(`🗄  Search cache: ${DB_CONFIGURED ? "Supabase" : path.basename(SEARCH_CACHE_FILE) + " (EPHEMERAL on most hosts)"}, ${SEARCH_CACHE_TTL_MS / 3600000}h TTL.`);
  console.log(`💵 Daily search cap: ${DAILY_SEARCH_CAP} billed searches/day (set DAILY_SEARCH_CAP to change).`);
  if (PRO_ENABLED) {
    console.log(`⭐ Pro tier ENABLED — free reports show ${ENT.FREE_MAX_COMPS} comps, ` +
      `${ENT.FREE_MAX_LOOKBACK_MONTHS}-month lookback, ${ENT.FREE_EXPORTS_PER_MONTH} exports/month.`);
    // Loud on purpose: an audience left set is a launch that silently reaches
    // nobody, and it looks exactly like a working deployment.
    if (PRO_AUDIENCE.length) {
      console.log(`🔬 PRO_AUDIENCE is set — Pro applies to ${PRO_AUDIENCE.length} account(s) only ` +
        `(${PRO_AUDIENCE.join(", ")}). Everyone else sees the pre-Pro app and cannot reach checkout. ` +
        `UNSET PRO_AUDIENCE to go live.`);
    }
    if (!DB_CONFIGURED) {
      console.error("⛔ PRO_ENABLED is on but Supabase is NOT configured. Billing tables have no " +
        "file fallback (a subscription on an ephemeral disk is a lost customer), so EVERY visitor " +
        "resolves to the free tier. Set SUPABASE_URL + SUPABASE_SERVICE_KEY and run the Pro DDL.");
    }
  } else {
    console.log("⭐ Pro tier disabled (set PRO_ENABLED=on once the Pro DDL has been run).");
  }
});
