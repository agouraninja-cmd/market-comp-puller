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

// Optional key that unlocks GET /api/leads (the lead download). When unset,
// that endpoint is disabled entirely.
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Optional email ping on every new lead / broker comp submission, sent via
// Resend's REST API (free tier, plain fetch — no dependency). Note: without a
// verified domain Resend only delivers to the address that owns the Resend
// account, so sign up with the notify address itself.
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const LEAD_NOTIFY_EMAIL = (process.env.LEAD_NOTIFY_EMAIL || "agouraninja@gmail.com").trim();

// Public URL of this deployment, used in robots.txt/sitemap.xml and best kept
// in sync with the canonical/og:url tags in index.html. Override with SITE_URL
// when the site moves to a custom domain.
const SITE_URL = (process.env.SITE_URL || "https://market-comp-puller.onrender.com").replace(/\/+$/, "");

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
const RATE_MAX = 10; // searches per IP per window
const rateHits = new Map();

function clientIp(req) {
  // Hosts like Render sit behind a proxy; the real client is in x-forwarded-for.
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function rateLimited(ip, max = RATE_MAX) {
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(ip, hits);
  if (rateHits.size > 1000) {
    for (const [k, v] of rateHits) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) rateHits.delete(k);
    }
  }
  return hits.length > max;
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

function cacheKeyFor({ address, type, note, months, maxComps, txFocus, subjectSizeSqft, verifiedComps }) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const verifiedSig = (verifiedComps || [])
    .map((c) => `${c.address}|${c.deal_date}|${c.price_or_rate}`)
    .sort()
    .join(";");
  const raw = [norm(address), type, norm(note), months, maxComps, txFocus, subjectSizeSqft || "", verifiedSig].join("::");
  return crypto.createHash("sha256").update(raw).digest("hex");
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
// Lead email notification — fire-and-forget so a slow or failing email
// provider never delays or breaks the request that captured the lead.
// Empty fields are dropped from the body.
// ---------------------------------------------------------------------------
function notifyByEmail(subject, fields) {
  if (!RESEND_API_KEY) return;
  const text = fields
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "CompNinja <onboarding@resend.dev>",
      to: [LEAD_NOTIFY_EMAIL],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(8000),
  })
    .then(async (r) => {
      if (!r.ok) console.error("Lead notification failed:", r.status, (await r.text().catch(() => "")).slice(0, 300));
    })
    .catch((err) => console.error("Lead notification failed:", err.message));
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
      `&select=address,transaction,deal_date,size_sqft,price_or_rate,cap_rate,notes` +
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

function buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft) {
  const typeGuidance = {
    Industrial:  "Focus on warehouse/distribution/flex space. Report price/SF for sales and NNN $/SF/yr for leases.",
    Office:      "Focus on office buildings/suites. Report price/SF for sales and full-service or NNN $/SF/yr for leases, building class (A/B/C) in notes.",
    Retail:      "Focus on retail/strip/single-tenant net lease. Report price/SF for sales and NNN $/SF/yr for leases, tenant/anchor and cap rate where relevant.",
    Multifamily: "Focus on apartment/multifamily. Report price per unit AND price/SF, cap rate, and unit count in notes.",
    Land:        "Focus on comparable land sales. Report price per acre and price/SF of land, zoning and entitlement notes.",
    Residential: "Focus on single-family homes, townhomes, and condos. Report sale price and price/SF for sales, or monthly rent for leases/rentals. Include beds/baths, year built, and lot size in notes. Leave cap_rate empty unless it is an investment/rental sale with a stated cap rate.",
  };

  const isIndustrial = type === "Industrial";

  // Anchor the lookback window to real dates — the model doesn't know "today",
  // so "last N months" alone drifts toward stale comps.
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const todayStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const cutoffStr = cutoff.toLocaleString("en-US", { month: "long", year: "numeric" });

  // Industrial comps carry two extra physical-spec fields.
  const compShape = isIndustrial
    ? `{ "address": "", "date": "", "transaction": "", "size_sqft": "", "clear_height": "", "dock_doors": "", "price_or_rate": "", "price_per_sqft": "", "cap_rate": "", "notes": "", "source_url": "", "source_type": "", "lat": "", "lng": "", "verified": false }`
    : `{ "address": "", "date": "", "transaction": "", "size_sqft": "", "price_or_rate": "", "price_per_sqft": "", "cap_rate": "", "notes": "", "source_url": "", "source_type": "", "lat": "", "lng": "", "verified": false }`;

  // Trusted internal comps get their own prompt section when any exist.
  const verifiedBlock = (verifiedComps && verifiedComps.length) ? [
    ``,
    `VERIFIED INTERNAL COMPS: the following ${verifiedComps.length === 1 ? "comp was" : "comps were"} submitted by local brokers and reviewed by our team. Treat the details as accurate.`,
    ...verifiedComps.map((c, i) =>
      `${i + 1}. ${c.address} | ${c.transaction || "transaction type unknown"} | ${c.deal_date || "date unknown"} | ${c.size_sqft ? c.size_sqft + " SF" : "size unknown"} | ${c.price_or_rate || "price unknown"}${c.cap_rate ? " | cap rate " + c.cap_rate : ""}${c.notes ? " | " + c.notes : ""}`),
    `Include each verified internal comp in the "comps" array IF it is genuinely comparable to the target property (reasonably near the target address and inside the date window). Set "verified": true on those and copy their details faithfully; compute "price_per_sqft" from the given size and price where possible, and estimate "lat"/"lng" from the address. When a verified comp and a web result describe the same transaction, keep only the verified one. Verified comps count toward the comp total. Set "verified": false on every comp found via web search. Never include a verified comp that is clearly in a different city or market than the target.`,
  ].join("\n") : "";

  return [
    `You are a commercial real estate analyst. Use web search to find recent comparable transactions.`,
    ``,
    `TARGET PROPERTY:`,
    `- Address: ${address}`,
    `- Property type: ${type}`,
    subjectSizeSqft ? `- Approximate building size: ${subjectSizeSqft.toLocaleString("en-US")} SF` : "",
    note ? `- Market note / radius: ${note}` : `- Market note / radius: (none specified — use the immediate submarket)`,
    ``,
    `TASK: Find 3 to ${maxComps} RECENT ${
      txFocus === "sales"  ? "comparable closed SALES" :
      txFocus === "leases" ? "comparable LEASE transactions or lease listings" :
                             "comparable sales or lease listings"
    } near this address that match the property type.`,
    `Today's date is ${todayStr}. Comps MUST be dated ${cutoffStr} or later (the last ${months === 1 ? "1 month" : months + " months"}). If you cannot find at least 3 comps inside that window, you may include older comps to reach 3, but you MUST state in "summary" that some comps fall outside the requested ${months}-month window.`,
    txFocus === "sales"  ? `Include ONLY sale transactions — do NOT include lease comps.` :
    txFocus === "leases" ? `Include ONLY lease transactions or active lease listings — do NOT include sale comps.` : "",
    !subjectSizeSqft
      ? `Also determine the TARGET property's building size in square feet from public records, assessor data, or listing pages for the target address. This is the BUILDING square footage, not the lot or land size.`
      : "",
    typeGuidance[type] || "",
    isIndustrial
      ? `For EACH industrial comp, also report two building specs: "clear_height" = the interior clear/ceiling height (e.g. "32 ft"), and "dock_doors" = the number and type of loading doors (e.g. "6 dock-high, 2 grade-level"). Search listing pages, brokerage flyers, and property records for these. If a spec genuinely can't be found, use an empty string "" — do not guess.`
      : "",
    verifiedBlock,
    ``,
    `Then compute or estimate an average price per square foot across the comps where it makes sense.`,
    `Do not use em dashes anywhere in your output text.`,
    ``,
    `OUTPUT FORMAT — return ONLY valid JSON, no markdown, no code fences, no preamble or explanation. Use this exact shape:`,
    `{`,
    `  "summary": "2-4 sentence plain-English takeaway about the local market, understandable to a non-professional",`,
    `  "avg_price_per_sqft": "string or null",`,
    `  "subject_lat": "",`,
    `  "subject_lng": "",`,
    `  "market_cap_rate_range": { "low": "", "high": "" },`,
    `  "value_drivers": ["", ""],`,
    `  "market_trend": "",`,
    ...(!subjectSizeSqft ? [`  "subject_size_sqft": "",`, `  "subject_size_source": "",`] : []),
    `  "comps": [`,
    `    ${compShape}`,
    `  ]`,
    `}`,
    ``,
    `Rules: "date" = when the sale closed or the lease/listing was signed or posted, as a short month-year like "Mar 2025". "transaction" = exactly "Sale" or "Lease". "source_url" = the URL of the specific web page where you found the comp (listing page, brokerage announcement, news article, or public record); use "" if you are not confident in the exact URL — do not invent one. "lat"/"lng" = the approximate decimal latitude and longitude of the comp property (e.g. "32.7767", "-96.7970") estimated from its address — these are for plotting on a map, so a street-level approximation is fine; use "" only if you cannot place the address at all. "subject_lat"/"subject_lng" = the same for the TARGET property address. If any other field is unknown, use an empty string "" (or null for avg_price_per_sqft). Keep notes concise. Do NOT wrap the JSON in backticks. Output the JSON object and nothing else.`,
    `"source_type" = where you found the comp, exactly one of: "public_record" (a county assessor, deed, or tax record), "listing" (an active or closed listing page, brokerage flyer, or brokerage announcement), "news" (a news article or press release), "estimate" (you could not tie the figures to one specific source). Choose the single best fit; never leave it empty.`,
    `"market_cap_rate_range" = your best estimate of the going-in capitalization rate range for stabilized ${type} properties in this submarket today, as short percent strings like "5.8%". This is a market-level figure, not a valuation of the target property. Use "" for both values if you cannot estimate it.`,
    `"value_drivers" = 2 to 4 short strings, each ONE concrete factor currently pushing values up or down for ${type} properties in this specific area, drawn from what your searches actually found - name the factor specifically (a vacancy shift, new construction, a rate change, scarcity of a size class), never generic real-estate advice. "market_trend" = one sentence on which direction ${type} sale prices in this area have moved over the search window; use "" if your searches did not show this - do not guess.`,
    ...(!subjectSizeSqft ? [`"subject_size_sqft" = the TARGET property's building size as a plain number string like "25000". Use "" if you cannot determine it from a real source; do not guess. "subject_size_source" = where the size came from, exactly one of: "public_record" (assessor or tax record), "listing" (a listing page or brokerage flyer), "estimate".`] : []),
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
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Call the Anthropic Messages API with web search enabled
// ---------------------------------------------------------------------------
const SEARCH_TIMEOUT_MS = 100_000; // a hung upstream call fails cleanly instead of spinning forever

async function callAnthropicOnce(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft) {
  const body = {
    model: MODEL,
    max_tokens: 3200,
    // The subject-size lookup gets two extra searches so it doesn't crowd out
    // the comp searches themselves.
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: !subjectSizeSqft ? 8 : 6 }],
    messages: [{ role: "user", content: buildPrompt(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft) }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
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
    if (err && err.name === "AbortError") {
      throw new Error("The search took too long and was stopped. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json())?.error?.message || ""; } catch (_) {}
    throw new Error(`Anthropic API error (${r.status}). ${detail}`.trim());
  }

  const data = await r.json();

  // Web search responses contain multiple block types — keep ONLY text blocks.
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("The model returned no text content to parse.");

  return normalizeSourceTypes(parseCompJson(text));
}

async function getComps(address, type, note, months, maxComps, txFocus, subjectSizeSqft, verifiedComps) {
  if (verifiedComps.length) {
    console.log(`Offering ${verifiedComps.length} verified comp(s) to the model for ${type}.`);
  }
  // The model occasionally wraps the JSON in stray text; one silent retry
  // resolves most of those instead of surfacing a parse error to the user.
  try {
    return await callAnthropicOnce(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft);
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn("Comp JSON failed to parse; retrying once.", err.message);
      return await callAnthropicOnce(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft);
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

const server = http.createServer((req, res) => {
  // --- API endpoint ---
  if (req.method === "POST" && req.url === "/api/comps") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e5) req.destroy(); // guard against huge payloads
    });
    req.on("end", async () => {
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
        const { address, type, note, months, maxComps, txFocus, subjectSizeSqft } = JSON.parse(body || "{}");
        if (!address || !type) {
          return sendJson(res, 400, { error: "address and property type are required." });
        }
        if (!API_KEY) {
          return sendJson(res, 500, {
            error: "Server is missing the ANTHROPIC_API_KEY environment variable.",
          });
        }
        // Validated/clamped so arbitrary client values can't reshape the prompt.
        const monthsNum = Math.round(Number(months));
        const monthsOk = Number.isFinite(monthsNum) ? Math.min(120, Math.max(1, monthsNum)) : 24;
        const maxCompsOk = [4, 6, 8].includes(Number(maxComps)) ? Number(maxComps) : 8;
        const txFocusOk = ["both", "sales", "leases"].includes(String(txFocus)) ? String(txFocus) : "both";
        const sizeNum = Math.round(Number(subjectSizeSqft));
        const sizeOk = Number.isFinite(sizeNum) && sizeNum > 0 ? Math.min(20_000_000, sizeNum) : null;
        const addressOk = String(address).trim();
        const typeOk = String(type);
        const noteOk = note ? String(note).trim() : "";

        // Verified comps are fetched once, both for the model and as part of
        // the cache key — approving a new broker comp naturally invalidates
        // any cached report for that property type.
        const verifiedComps = await fetchVerifiedComps(typeOk, txFocusOk);
        const cacheKey = cacheKeyFor({
          address: addressOk, type: typeOk, note: noteOk, months: monthsOk,
          maxComps: maxCompsOk, txFocus: txFocusOk, subjectSizeSqft: sizeOk, verifiedComps,
        });

        const cached = await getCachedSearch(cacheKey);
        if (cached) {
          console.log(`Cache hit (no Anthropic call): ${addressOk} — ${typeOk}`);
          return sendJson(res, 200, cached);
        }

        if (!tryConsumeDailySearch()) {
          return sendJson(res, 429, {
            error: "This site has reached its daily search limit. Please try again after midnight UTC.",
          });
        }

        const result = await getComps(addressOk, typeOk, noteOk, monthsOk, maxCompsOk, txFocusOk, sizeOk, verifiedComps);
        await storeCachedSearch(cacheKey, result);
        return sendJson(res, 200, result);
      } catch (err) {
        console.error("Error handling /api/comps:", err);
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
        const { name, email, phone, company, address, type, source } = JSON.parse(body || "{}");
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
        if (!lead.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
          return sendJson(res, 400, { error: "A name and a valid email are required." });
        }
        const dest = await storeRow("leads", LEADS_FILE, lead);
        console.log(`Lead captured (${dest}): ${lead.name} <${lead.email}>${lead.address ? " — " + lead.address : ""}`);
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
            ["Stored in", dest],
            ["Time", lead.ts],
          ]
        );
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof SyntaxError) return sendJson(res, 400, { error: "Bad request." });
        console.error("Failed to store lead:", err);
        return sendJson(res, 500, { error: "Could not save your details. Please try again." });
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
          return sendJson(res, 200, { lat: m.coordinates.y, lng: m.coordinates.x, source: "census" });
        }
        return sendJson(res, 200, {});
      } catch (_) {
        return sendJson(res, 200, {}); // soft failure — the client falls back
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

  // --- Tells the front-end whether a password is required ---
  if (req.method === "GET" && req.url === "/api/config") {
    return sendJson(res, 200, { authRequired: Boolean(APP_PASSWORD), leadCapture: LEAD_CAPTURE });
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

  // --- Static: serve index.html for "/" or "/index.html" ---
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end("index.html not found");
      }
      // no-store: the whole front-end is this one file, so a stale cached copy
      // means users silently miss every update. It's small; always fetch fresh.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(data);
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

  // --- Health check (handy for hosting platforms) ---
  if (req.method === "GET" && req.url === "/healthz") {
    return sendJson(res, 200, { ok: true, hasKey: Boolean(API_KEY) });
  }

  // --- SEO: robots.txt + a one-page sitemap so crawlers index the site ---
  if (req.method === "GET" && req.url === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  }
  if (req.method === "GET" && req.url === "/sitemap.xml") {
    res.writeHead(200, { "content-type": "application/xml" });
    return res.end(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${SITE_URL}/</loc></url>\n` +
      `</urlset>\n`
    );
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Market Comp Puller running at http://localhost:${PORT}`);
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
  console.log(`🗄  Search cache: ${DB_CONFIGURED ? "Supabase" : path.basename(SEARCH_CACHE_FILE) + " (EPHEMERAL on most hosts)"}, ${SEARCH_CACHE_TTL_MS / 3600000}h TTL.`);
  console.log(`💵 Daily search cap: ${DAILY_SEARCH_CAP} billed searches/day (set DAILY_SEARCH_CAP to change).`);
});
