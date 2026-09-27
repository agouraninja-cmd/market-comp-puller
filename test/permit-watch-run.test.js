// test/permit-watch-run.test.js
// Tracking your own permit (2026-09-27), actually run: a real server.js
// against the stand-in PostgREST + Resend and a stub standing in for the
// Boise and Meridian portals (through the test-only PERMIT_PORTAL_ORIGIN, the
// sweep suite's precedent). The stub serves the detail page captured from the
// live Boise portal on 2026-09-16 with the permit number and status swapped
// for whatever the test says the city now reads.
//
// What this proves that permit-watch.test.js cannot: the routes are scoped to
// the signed-in member; a number the portal does not know is refused at add
// time and a portal that is down is not; the weekday sweep re-reads tracked
// permits, writes the event, mails the member and stamps emailed_at only
// after the send; a second sweep sends nothing; a switched-off mailer leaves
// the notice due instead of marking it sent; a dry run writes nothing; and
// the page's own POST clears the unread count.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const http = require("node:http");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const FIX = path.join(__dirname, "fixtures", "permit-portals");
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIX, f))).toString("utf8");
const KEY = "admin-test-key";
const NUM_FIELD = "ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitNumber";

// `statusOf` is what each city's portal reads for a permit number right now;
// `down` lists numbers whose search the portal answers with a 500.
function startPortal() {
  const statusOf = {};
  const down = new Set();
  const hits = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      hits.push({ method: req.method, path: url.pathname, body });
      const html = (s) => { res.writeHead(200, { "content-type": "text/html" }); res.end(s); };
      const city = url.pathname.startsWith("/CitizenAccess/") ? "boise"
        : url.pathname.startsWith("/MERIDIAN/") ? "meridian" : null;
      if (!city) { res.writeHead(404); return res.end("no such portal"); }
      const root = city === "boise" ? "/CitizenAccess" : "/MERIDIAN";
      if (/CapDetail\.aspx$/.test(url.pathname)) {
        const num = url.searchParams.get("watch") || "";
        return html(readGz(`${city}.detail.html.gz`)
          .replace(/(id="ctl00_PlaceHolderMain_lblRecordStatus"[^>]*>)[^<]*</, `$1${statusOf[num] || ""}<`)
          .replace(/(id="ctl00_PlaceHolderMain_lblPermitNumber"[^>]*>)[^<]*</, `$1${num}<`));
      }
      if (/CapHome\.aspx$/.test(url.pathname)) {
        if (req.method === "GET") return html(readGz(`${city}.search.html.gz`));
        const num = (new URLSearchParams(body).get(NUM_FIELD) || "").trim().toUpperCase();
        if (num && down.has(num)) { res.writeHead(500); return res.end("portal down"); }
        if (num && statusOf[num]) {
          res.writeHead(302, { location: `${root}/Cap/CapDetail.aspx?watch=${encodeURIComponent(num)}` });
          return res.end();
        }
        // An unknown number, or the city sweep's own type searches: nothing.
        return html("<html><body><span>Your search returned no results.</span></body></html>");
      }
      res.writeHead(404); res.end("no route");
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${srv.address().port}`, statusOf, down, hits,
    stop: () => new Promise((r) => srv.close(r)),
  })));
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const BRAD = { id: "5a1e9a1e-0000-4000-8000-00000000b0a1", email: "brad@colliers.com", name: "Brad" };
const SOLO = { id: "5a1e9a1e-0000-4000-8000-00000000b0a2", email: "solo@nowhere.com", name: "Solo" };
const tables = () => ({
  users: [BRAD, SOLO].map((u) => ({ ...u, pro_tester: false, vault_beta: false, digest_optout: false })),
  sessions: [BRAD, SOLO].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
  subscriptions: [], orgs: [], org_members: [],
  permit_filings: [], permit_filing_events: [], permit_watches: [], permit_watch_events: [], analytics_events: [],
});

async function bootWith(extraEnv) {
  const portal = await startPortal();
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY,
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key", EMAIL_FROM: "CompNinja <reports@compninja.co>", RESEND_API_URL: db.resendUrl,
    SITE_URL: "https://compninja.co",
    ...extraEnv,
  });
  return { portal, db, srv, stop: async () => { srv.stop(); await db.stop(); await portal.stop(); } };
}

const as = (u) => (u ? { cookie: `cn_session=tok-${u.id}` } : {});
const api = (srv, method, url, user, body) => fetch(srv.base + url, {
  method, headers: { "content-type": "application/json", ...as(user) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const sweep = (srv, body) => fetch(srv.base + "/api/permits/sweep", {
  method: "POST", headers: { "content-type": "application/json", "x-admin-key": KEY }, body: JSON.stringify(body || {}),
});
const unread = async (srv, user) => (await (await api(srv, "GET", "/api/permits/unread", user)).json()).count;

test("tracking your own permit, end to end", async (t) => {
  const ctx = await bootWith({});
  t.after(() => ctx.stop());
  const { portal, db, srv } = ctx;
  portal.statusOf["BLD26-00001"] = "In Review";
  portal.statusOf["BLD26-00002"] = "Prep for Issuance";
  portal.down.add("BLD26-00002");
  let watchId = null;

  await t.test("signed out, every route is refused", async () => {
    for (const [m, u] of [["GET", "/api/permits/mine"], ["GET", "/api/permits/unread"], ["POST", "/api/permits/watch"], ["POST", "/api/permits/seen"]]) {
      const r = await api(srv, m, u, null, m === "POST" ? {} : undefined);
      assert.equal(r.status, 401, `${m} ${u}`);
    }
  });

  await t.test("adding a permit looks it up on the portal and stores what it read", async () => {
    const r = await api(srv, "POST", "/api/permits/watch", BRAD, {
      jurisdiction: "boise", permitNumber: "bld26-00001",
      notify: { steps: ["approved", "issued"], alerts: true, any: false, email: true, app: true },
    });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.checked, true);
    assert.equal(j.watch.permitNumber, "BLD26-00001");
    assert.equal(j.watch.status, "In Review");
    assert.equal(j.watch.address, "8000 S FEDERAL WAY, Boise ID");
    assert.deepEqual(j.watch.steps.filter((s) => s.done).map((s) => s.key), ["submitted", "review"]);
    assert.match(j.watch.sourceUrl, /CapDetail\.aspx\?watch=BLD26-00001$/);
    watchId = j.watch.id;
    const row = db.tables.permit_watches.find((w) => w.id === watchId);
    assert.equal(row.user_id, BRAD.id);
    assert.deepEqual(row.passed_steps, ["submitted", "review"]);
    assert.deepEqual(row.notify_steps, ["approved", "issued"]);
    assert.ok(portal.hits.some((h) => h.method === "POST" && h.body.includes("BLD26-00001")), "the portal was searched by number");
    assert.equal(db.tables.permit_watch_events.length, 0, "adding announces nothing");
  });

  await t.test("a repeat is refused, a number the portal does not know is refused, a city we do not read is refused", async () => {
    const dup = await api(srv, "POST", "/api/permits/watch", BRAD, { jurisdiction: "boise", permitNumber: "BLD26-00001" });
    assert.equal(dup.status, 409);
    const nope = await api(srv, "POST", "/api/permits/watch", BRAD, { jurisdiction: "boise", permitNumber: "BLD26-99999" });
    assert.equal(nope.status, 400);
    const nj = await nope.json();
    assert.equal(nj.code, "not_found");
    assert.match(nj.error, /Boise's permit portal has no permit numbered BLD26-99999/);
    const nampa = await api(srv, "POST", "/api/permits/watch", BRAD, { jurisdiction: "nampa", permitNumber: "X-1" });
    assert.equal(nampa.status, 400);
    assert.match((await nampa.json()).error, /Boise or Meridian/);
    assert.equal(db.tables.permit_watches.length, 1);
  });

  await t.test("a portal that is down does not refuse the permit; the sweep reads it first", async () => {
    const r = await api(srv, "POST", "/api/permits/watch", BRAD, { jurisdiction: "boise", permitNumber: "BLD26-00002", label: "Warehouse" });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.checked, false);
    assert.equal(j.watch.status, "");
    assert.match(j.watch.checkError, /did not answer/);
    portal.down.delete("BLD26-00002");
  });

  await t.test("another member cannot see, change or remove it", async () => {
    const mine = await (await api(srv, "GET", "/api/permits/mine", SOLO)).json();
    assert.deepEqual(mine.watches, []);
    assert.equal((await api(srv, "PATCH", `/api/permits/watch?id=${watchId}`, SOLO, { label: "mine now" })).status, 404);
    assert.equal((await api(srv, "DELETE", `/api/permits/watch?id=${watchId}`, SOLO)).status, 404);
    assert.equal(db.tables.permit_watches.find((w) => w.id === watchId).label, null);
  });

  await t.test("the owner renames it", async () => {
    const r = await api(srv, "PATCH", `/api/permits/watch?id=${watchId}`, BRAD, { label: "Federal Way walkway" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).watch.label, "Federal Way walkway");
  });

  await t.test("the weekday sweep reads the move, mails the member once, and marks it after the send", async () => {
    portal.statusOf["BLD26-00001"] = "Issued";
    const r = await sweep(srv, { days: 1 });
    const s = await r.json();
    assert.equal(r.status, 200, JSON.stringify(s));
    assert.deepEqual(s.errors, [], "the city sweep is clean");
    assert.equal(s.watches.checked, 2);
    assert.equal(s.watches.notices, 1, "the first read of the down permit announces nothing");
    assert.equal(s.watches.emailed, 1);
    assert.deepEqual(s.watches.errors, []);

    const sent = await fake.waitForMail(db, 1);
    assert.equal(sent.length, 1);
    assert.ok(JSON.stringify(sent[0].to).includes(BRAD.email), "mailed to the member who tracks it");
    assert.equal(sent[0].subject, "Steps complete: Approved and Issued · Boise permit BLD26-00001");
    assert.match(sent[0].text, /Federal Way walkway/);
    assert.match(sent[0].text, /now reads “Issued” \(it read “In Review”\)/);
    assert.match(sent[0].text, /https:\/\/compninja\.co\/permits/);

    const events = db.tables.permit_watch_events;
    const step = events.find((e) => e.watch_id === watchId);
    assert.equal(step.notice, "Steps complete: Approved and Issued");
    assert.equal(step.app, true);
    assert.ok(step.emailed_at, "stamped after the send");
    assert.equal(step.user_id, BRAD.id);
    const first = events.find((e) => e.watch_id !== watchId);
    assert.equal(first.kind, "first");
    assert.equal(first.notice, null);
    const row = db.tables.permit_watches.find((w) => w.id === watchId);
    assert.equal(row.status, "Issued");
    assert.deepEqual(row.passed_steps, ["submitted", "review", "approved", "issued"]);
    assert.ok(row.last_checked_at);
    assert.equal(await unread(srv, BRAD), 1);
    assert.equal(await unread(srv, SOLO), 0);
  });

  await t.test("a second sweep with nothing new sends nothing", async () => {
    const before = db.sent.length;
    const s = await (await sweep(srv, { days: 1 })).json();
    assert.equal(s.watches.notices, 0);
    assert.equal(s.watches.emailed, 0);
    await fake.waitForMail(db, before + 1, { timeoutMs: 300 });
    assert.equal(db.sent.length, before, "nobody is mailed twice");
    assert.equal(db.tables.permit_watch_events.length, 2);
  });

  await t.test("a dry run reads the portal and writes nothing", async () => {
    portal.statusOf["BLD26-00001"] = "Finaled";
    const s = await (await sweep(srv, { days: 1, dryRun: true })).json();
    assert.equal(s.watches.changed, 1);
    assert.equal(db.tables.permit_watches.find((w) => w.id === watchId).status, "Issued");
    assert.equal(db.tables.permit_watch_events.length, 2);
    portal.statusOf["BLD26-00001"] = "Issued";
  });

  await t.test("the page carries the notice, and its own POST clears the count", async () => {
    const r = await fetch(srv.base + "/permits", { headers: as(BRAD) });
    const html = await r.text();
    const boot = JSON.parse(html.match(/var BOOT = (.*);\n/)[1]);
    assert.equal(boot.mine.s, 200);
    assert.equal(boot.mine.j.unread, 1);
    const w = boot.mine.j.watches.find((x) => x.id === watchId);
    assert.equal(w.unread, 1);
    assert.equal(w.history[0].notice, "Steps complete: Approved and Issued");
    assert.equal(await unread(srv, BRAD), 1, "rendering the page clears nothing (it may be a prerender)");
    assert.equal((await api(srv, "POST", "/api/permits/seen", BRAD)).status, 200);
    assert.equal(await unread(srv, BRAD), 0);
  });

  await t.test("stopping tracking removes the permit and its history", async () => {
    const r = await api(srv, "DELETE", `/api/permits/watch?id=${watchId}`, BRAD);
    assert.equal(r.status, 200);
    assert.equal(db.tables.permit_watches.some((w) => w.id === watchId), false);
    assert.equal(db.tables.permit_watch_events.some((e) => e.watch_id === watchId), false);
  });

  await t.test("the stand-in understood every query", async () => {
    assert.deepEqual(db.unparsed, []);
  });
});

test("with outbound mail off, the notice is kept due rather than marked sent", async (t) => {
  const ctx = await bootWith({ EMAIL_FROM: "", RESEND_API_KEY: "" });
  t.after(() => ctx.stop());
  const { portal, db, srv } = ctx;
  portal.statusOf["C-NEW-2026-0052"] = "In Progress";
  const add = await api(srv, "POST", "/api/permits/watch", BRAD, { jurisdiction: "meridian", permitNumber: "C-NEW-2026-0052" });
  assert.equal(add.status, 200);
  const mine = await (await api(srv, "GET", "/api/permits/mine", BRAD)).json();
  assert.equal(mine.emailLive, false, "the page is told, so it can say so beside the email box");

  portal.statusOf["C-NEW-2026-0052"] = "Approved";
  const s = await (await sweep(srv, { days: 1 })).json();
  assert.equal(s.watches.notices, 1);
  assert.equal(s.watches.emailed, 0);
  assert.equal(s.watches.emailsPending, 1);
  assert.equal(s.watches.mailOff, true);
  const e = db.tables.permit_watch_events[0];
  assert.equal(e.email_due, true);
  assert.ok(!e.emailed_at, "never marked sent when nothing was sent");
  assert.equal(e.app, true, "the CompNinja notice still lands");
  await fake.waitForMail(db, 1, { timeoutMs: 300 });
  assert.equal(db.sent.length, 0);
  assert.deepEqual(db.unparsed, []);
});

test("without a database the routes refuse rather than keep a list that would vanish", async (t) => {
  // CLAUDE.md rule 4: Render erases its disk on every deploy, so a watch list
  // kept in a local file would quietly stop notifying people. A local-file
  // account (no Supabase) is signed in, and every route still says 503.
  const srv = await shared.boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());
  assert.equal((await fetch(srv.base + "/api/permits/mine")).status, 401, "signed out is still 401 first");
  const signup = await fetch(srv.base + "/api/account/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `permits-${Date.now()}@example.com`, password: "correct-horse-battery", name: "Pat" }),
  });
  assert.equal(signup.status, 200);
  const cookie = String(signup.headers.get("set-cookie") || "").split(";")[0];
  for (const [m, u, b] of [["GET", "/api/permits/mine"], ["GET", "/api/permits/unread"], ["POST", "/api/permits/seen"],
    ["POST", "/api/permits/watch", { jurisdiction: "boise", permitNumber: "BLD26-1" }]]) {
    const r = await fetch(srv.base + u, { method: m, headers: { "content-type": "application/json", cookie }, body: b ? JSON.stringify(b) : (m === "POST" ? "{}" : undefined) });
    assert.equal(r.status, 503, `${m} ${u}`);
  }
});
