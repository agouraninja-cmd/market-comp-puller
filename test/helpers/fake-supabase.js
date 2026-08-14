// A stand-in for Supabase (PostgREST) and Resend, so route-level tests can
// exercise the paths that only exist WITH a database.
//
// Why this exists: almost everything in this app degrades to a local JSON file
// when Supabase is unconfigured, which is what lets the rest of the suite run
// for free — but a handful of features deliberately have NO file fallback (the
// vault, permissioned shares, the watchlist digest), and those are exactly the
// features where a mistake costs a broker their book or mails a stranger the
// same email twice. Before this, the digest's send path could be tested up to
// "it refuses without a database" and no further: the cutoff arithmetic, the
// marking, the opt-out and the no-duplicates rule were all argued in comments
// and never executed. This runs them.
//
// It is NOT a Postgres. It understands only the query shapes server.js
// actually sends, and it should stay that way: the moment it starts guessing
// at PostgREST semantics it becomes a second implementation to be wrong in,
// and a test that passes against a fake nobody trusts is worse than no test.
// If server.js sends a filter this cannot parse, the request FAILS LOUDLY
// (400 with the offending query) rather than silently matching everything —
// silently matching everything is how a fake reports that a scoped delete
// works.
//
// Not named *.test.js on purpose: package.json runs `node --test
// "test/*.test.js"`, so this is a helper, not a suite.

const http = require("node:http");

// PostgREST filter values arrive percent-encoded and, for in.(), quoted.
function decodeValue(raw) {
  return decodeURIComponent(String(raw)).replace(/^"|"$/g, "");
}

// Parses `in.("a","b")`. Note this runs on the value AFTER standard query
// percent-decoding, exactly as PostgREST's own parser does, so it cannot tell
// a separator comma from a comma that arrived encoded inside a value — and
// neither can the real thing. That is the whole reason pgInList() in server.js
// encodes each value and leaves the separators literal.
function parseInList(raw) {
  const inner = String(raw).replace(/^in\.\(/, "").replace(/\)$/, "");
  if (!inner) return [];
  return inner.split(",").map(decodeValue);
}

function matches(row, key, expr) {
  const val = row[key];
  if (expr.startsWith("eq.")) return String(val) === decodeValue(expr.slice(3));
  if (expr.startsWith("in.(")) return parseInList(expr).some((v) => String(val) === v);
  if (expr === "is.null") return val === null || val === undefined;
  if (expr === "not.is.null") return !(val === null || val === undefined);
  const err = new Error(`fake-supabase cannot parse filter ${key}=${expr}`);
  err.unparsed = true;
  throw err;
}

const NON_FILTERS = new Set(["select", "order", "limit", "offset", "on_conflict"]);

function applyFilters(rows, params) {
  return rows.filter((row) => {
    for (const [key, expr] of params) {
      if (NON_FILTERS.has(key)) continue;
      if (!matches(row, key, expr)) return false;
    }
    return true;
  });
}

function applyOrder(rows, order) {
  if (!order) return rows;
  // Only the single-key forms server.js uses. Multi-key ordering is not
  // implemented rather than approximated.
  const [col, dir] = String(order).split(".");
  const sorted = rows.slice().sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")));
  return dir === "desc" ? sorted.reverse() : sorted;
}

// `tables` is a plain object of arrays and is MUTATED in place, so a test can
// read it back after a run and see what the server actually wrote.
function start({ tables = {}, resendStatus = 200 } = {}) {
  const sent = [];        // every email posted to the Resend stand-in
  const requests = [];    // every PostgREST call, for asserting what was asked
  const unparsed = [];    // filters this fake refused, so a test can fail loudly

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const json = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };

      // --- Resend stand-in ---
      if (url.pathname === "/emails") {
        sent.push(JSON.parse(body || "{}"));
        return json(resendStatus, resendStatus === 200 ? { id: "fake-" + sent.length } : { message: "nope" });
      }

      // --- PostgREST stand-in ---
      const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
      if (!m) return json(404, { message: "no such route: " + url.pathname });
      const table = m[1];
      tables[table] = tables[table] || [];
      const params = [...url.searchParams.entries()];
      requests.push({ method: req.method, table, query: url.search, body: body || null });

      try {
        if (req.method === "GET") {
          let rows = applyFilters(tables[table], params);
          rows = applyOrder(rows, url.searchParams.get("order"));
          const limit = Number(url.searchParams.get("limit"));
          if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
          return json(200, rows);
        }
        if (req.method === "POST") {
          const payload = JSON.parse(body || "{}");
          const rows = Array.isArray(payload) ? payload : [payload];
          rows.forEach((r) => tables[table].push({ id: `${table}-${tables[table].length + 1}`, ...r }));
          const prefer = String(req.headers.prefer || "");
          return json(201, prefer.includes("return=minimal") ? undefined : rows);
        }
        if (req.method === "PATCH") {
          const patch = JSON.parse(body || "{}");
          const hit = applyFilters(tables[table], params);
          hit.forEach((r) => Object.assign(r, patch));
          return json(200, []);
        }
        if (req.method === "DELETE") {
          const doomed = new Set(applyFilters(tables[table], params));
          tables[table] = tables[table].filter((r) => !doomed.has(r));
          return json(200, []);
        }
        return json(405, { message: "method not allowed" });
      } catch (err) {
        if (err.unparsed) {
          // Loud on purpose. A fake that answers "everything matched" to a
          // filter it did not understand would report a user-scoped read as
          // working while it returned another account's rows.
          unparsed.push({ table, query: url.search, message: err.message });
          return json(400, { message: err.message });
        }
        return json(500, { message: String(err && err.message) });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: `http://localhost:${port}`,
        resendUrl: `http://localhost:${port}/emails`,
        tables, sent, requests, unparsed,
        stop: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { start };
