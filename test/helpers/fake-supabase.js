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
const crypto = require("node:crypto");

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
  // `neq.` is taught deliberately, not guessed at (see the header): server.js
  // sends it — the vault's per-comp collision check is one — and a fake that
  // 400s on it cannot exercise those paths at all. PostgREST's semantics here
  // are unambiguous, it is `eq.` negated, and a null column is NOT equal to a
  // value so it matches, which is the one place this could have been wrong.
  if (expr.startsWith("neq.")) return String(val) !== decodeValue(expr.slice(4));
  if (expr.startsWith("in.(")) return parseInList(expr).some((v) => String(val) === v);
  // `gte.` is taught deliberately, like `neq.` above and for the same reason:
  // server.js sends it (every date-windowed read — the vault blend, the firm
  // blend, bulk's daily ceiling), and a fake that 400s on it cannot exercise
  // those paths at all.
  //
  // STRING comparison, which is correct for exactly the values this app sends
  // through it: ISO-8601 UTC timestamps and yyyy-mm-dd dates both sort
  // lexicographically in the same order they sort chronologically. It is NOT
  // Postgres's comparison — a mixed-offset timestamp or a numeric column would
  // be wrong here — so a new `gte.` on anything but an ISO date or timestamp
  // needs this taught properly rather than reused.
  if (expr.startsWith("gte.")) return String(val) >= decodeValue(expr.slice(4));
  // `lte.` is `gte.`'s mirror and is taught for the same reason and with the
  // same caveat: server.js sends it (the renewal watch windows a lease
  // deadline BETWEEN two dates, so it sends both on one column), and the
  // comparison is a STRING one, correct only for the ISO dates and timestamps
  // this app puts through it. A numeric column would be wrong here.
  //
  // Note the two arrive as separate entries under one key and applyFilters
  // ANDs every entry, which is PostgREST's own semantics — a fake that read
  // params into an object would keep only the last and silently widen the
  // window to everything before the horizon.
  if (expr.startsWith("lte.")) return String(val) <= decodeValue(expr.slice(4));
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
          // The STORED rows are returned, not the payload — PostgREST's
          // `return=representation` answers with what the table now holds,
          // including a generated id. Returning the payload instead meant a
          // caller that reads `row.id` back (createOrgWithOwner does, to
          // insert the owner's membership) got undefined and every later
          // scoped read silently missed.
          const prefer = String(req.headers.prefer || "");
          // `on_conflict=a,b` names the unique key an upsert resolves against,
          // and it is a shape server.js sends all over (report_viewers,
          // comp_corpus, broker_properties, org_members). Taught deliberately
          // rather than ignored: without it a re-invite that PostgREST would
          // have ignored became a SECOND membership row here, and the test
          // that caught it was asserting a real rule about the server.
          //
          // Only the two resolutions server.js actually asks for. Anything
          // else is left to the plain-insert path rather than guessed at.
          const conflict = (url.searchParams.get("on_conflict") || "")
            .split(",").map((s) => s.trim()).filter(Boolean);
          // A NULL in any part of the key means the row can never conflict,
          // which is Postgres's own rule for a unique index and NOT what a
          // naive String(r[c]) does — that turns two nulls into "null" and
          // "null" and silently drops the second row.
          //
          // Taught 2026-08-22, found while building `org_contacts` (039),
          // where a contact with no email is an ordinary and explicitly
          // allowed row: two of them upserted here and only the first was
          // stored, so a test would have proved the second was rejected while
          // production accepted it. The divergence ran the WRONG way round
          // for once — the fake was stricter than the database — which is
          // exactly the shape that makes a green suite untrustworthy.
          const nullKey = (r) => conflict.some((c) => r[c] === null || r[c] === undefined);
          const keyOf = (r) => conflict.map((c) => String(r[c])).join("\u0000");
          const stored = [];
          for (const r of rows) {
            const existing = (conflict.length && !nullKey(r))
              ? tables[table].find((t) => !nullKey(t) && keyOf(t) === keyOf(r))
              : null;
            if (existing) {
              if (prefer.includes("resolution=merge-duplicates")) {
                Object.assign(existing, r);
                stored.push(existing);
              }
              // ignore-duplicates: the row stays exactly as it was, and is
              // not returned as inserted.
              continue;
            }
            // A UUID, because every table server.js inserts into declares
            // `id uuid primary key default gen_random_uuid()` — and because
            // several routes guard an id with isUuidish() before it reaches a
            // Postgres uuid cast. A `${table}-1` id sails through the insert
            // and is then 404'd by the caller's own guard on the very next
            // read, which looks like a broken feature and is only a broken
            // fake. Seeded rows keep whatever id the test gave them.
            const row = { id: crypto.randomUUID(), ...r };
            tables[table].push(row);
            stored.push(row);
          }
          return json(201, prefer.includes("return=minimal") ? undefined : stored);
        }
        if (req.method === "PATCH") {
          const patch = JSON.parse(body || "{}");
          const hit = applyFilters(tables[table], params);
          hit.forEach((r) => Object.assign(r, patch));
          // `return=representation` answers with the rows that were actually
          // updated, and callers use the EMPTY case as a verdict: accepting a
          // firm invitation matches on the caller's own email and a null
          // joined_at, so "no rows" is how the route knows there was no open
          // invitation to accept. Answering [] unconditionally made that
          // route look permanently broken while the write had already
          // succeeded. Only when the header asks — an unqualified PATCH here
          // stays as it was.
          const prefer = String(req.headers.prefer || "");
          return json(200, prefer.includes("return=representation") ? hit : []);
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
