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

// Constant-time string comparison (avoids leaking the password via timing).
function passwordMatches(candidate) {
  const a = Buffer.from(String(candidate || ""));
  const b = Buffer.from(APP_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Prompt builder — property-type aware
// ---------------------------------------------------------------------------
function buildPrompt(address, type, note) {
  const typeGuidance = {
    Industrial:  "Focus on warehouse/distribution/flex space. Report price/SF for sales and NNN $/SF/yr for leases.",
    Office:      "Focus on office buildings/suites. Report price/SF for sales and full-service or NNN $/SF/yr for leases, building class (A/B/C) in notes.",
    Retail:      "Focus on retail/strip/single-tenant net lease. Report price/SF for sales and NNN $/SF/yr for leases, tenant/anchor and cap rate where relevant.",
    Multifamily: "Focus on apartment/multifamily. Report price per unit AND price/SF, cap rate, and unit count in notes.",
    Land:        "Focus on comparable land sales. Report price per acre and price/SF of land, zoning and entitlement notes.",
  };

  const isIndustrial = type === "Industrial";

  // Industrial comps carry two extra physical-spec fields.
  const compShape = isIndustrial
    ? `{ "address": "", "size_sqft": "", "clear_height": "", "dock_doors": "", "price_or_rate": "", "price_per_sqft": "", "cap_rate": "", "notes": "" }`
    : `{ "address": "", "size_sqft": "", "price_or_rate": "", "price_per_sqft": "", "cap_rate": "", "notes": "" }`;

  return [
    `You are a commercial real estate analyst. Use web search to find recent comparable transactions.`,
    ``,
    `TARGET PROPERTY:`,
    `- Address: ${address}`,
    `- Property type: ${type}`,
    note ? `- Market note / radius: ${note}` : `- Market note / radius: (none specified — use the immediate submarket)`,
    ``,
    `TASK: Find 3 to 6 RECENT (prefer last 24 months) comparable sales or lease listings near this address that match the property type.`,
    typeGuidance[type] || "",
    isIndustrial
      ? `For EACH industrial comp, also report two building specs: "clear_height" = the interior clear/ceiling height (e.g. "32 ft"), and "dock_doors" = the number and type of loading doors (e.g. "6 dock-high, 2 grade-level"). Search listing pages, brokerage flyers, and property records for these. If a spec genuinely can't be found, use an empty string "" — do not guess.`
      : "",
    ``,
    `Then compute or estimate an average price per square foot across the comps where it makes sense.`,
    ``,
    `OUTPUT FORMAT — return ONLY valid JSON, no markdown, no code fences, no preamble or explanation. Use this exact shape:`,
    `{`,
    `  "summary": "2-3 sentence written takeaway about the local market",`,
    `  "avg_price_per_sqft": "string or null",`,
    `  "comps": [`,
    `    ${compShape}`,
    `  ]`,
    `}`,
    ``,
    `Rules: If a field is unknown, use an empty string "" (or null for avg_price_per_sqft). Keep notes concise. Do NOT wrap the JSON in backticks. Output the JSON object and nothing else.`,
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
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Call the Anthropic Messages API with web search enabled
// ---------------------------------------------------------------------------
async function getComps(address, type, note) {
  const body = {
    model: MODEL,
    max_tokens: 2500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    messages: [{ role: "user", content: buildPrompt(address, type, note) }],
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

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

  return parseCompJson(text);
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
          return sendJson(res, 401, { error: "Unauthorized — incorrect or missing password." });
        }
        const { address, type, note } = JSON.parse(body || "{}");
        if (!address || !type) {
          return sendJson(res, 400, { error: "address and property type are required." });
        }
        if (!API_KEY) {
          return sendJson(res, 500, {
            error: "Server is missing the ANTHROPIC_API_KEY environment variable.",
          });
        }
        const result = await getComps(String(address).trim(), String(type), note ? String(note).trim() : "");
        return sendJson(res, 200, result);
      } catch (err) {
        console.error("Error handling /api/comps:", err);
        const msg = err && err.message ? err.message : "Unknown server error.";
        return sendJson(res, 502, { error: msg });
      }
    });
    return;
  }

  // --- Tells the front-end whether a password is required ---
  if (req.method === "GET" && req.url === "/api/config") {
    return sendJson(res, 200, { authRequired: Boolean(APP_PASSWORD) });
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
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  // --- Health check (handy for hosting platforms) ---
  if (req.method === "GET" && req.url === "/healthz") {
    return sendJson(res, 200, { ok: true, hasKey: Boolean(API_KEY) });
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
});
