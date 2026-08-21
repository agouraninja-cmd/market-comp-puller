#!/usr/bin/env node
// ---------------------------------------------------------------------------
// A firm you can click through, on this machine, with no database.
//
//   node scripts/firm-sandbox.js
//
// WHY THIS EXISTS: the enterprise system is the one part of this app with no
// file fallback — every firm route answers 503 without Supabase — so there has
// never been a way to LOOK at it without pointing a server at a real database.
// That is a bad trade for an access-control surface: the safe way to try a
// thing is not "try it on production", and a firm's failure modes (a colleague
// who should not see a report, a promise on the vault page that has quietly
// stopped being true) are visual before they are anything else.
//
// So this boots the REAL server.js against test/helpers/fake-supabase — the
// same stand-in PostgREST the route suites use, which refuses a query shape it
// does not understand rather than matching everything — seeds a firm through
// the ordinary routes, and hands you a URL.
//
// Three things it is NOT:
//   - It is not a test. Nothing here asserts; `npm test` is what proves the
//     rules, and test/org-run.test.js walks this same flow with assertions.
//   - It is not a database. State lives in one process's memory and is gone
//     when you stop it, which is the point: nothing you click can reach
//     anybody's real book.
//   - It never spends money. ANTHROPIC_API_KEY and GEMINI_API_KEY are blanked
//     by the boot helper, so a search on the sandbox fails instead of billing.
//
// Outbound mail is pointed at the fake too, so invitations are captured rather
// than sent, and printed here — the invitation copy is a surface like any
// other and reads differently in a mailbox than in a template literal.
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");
const http = require("node:http");
const fake = require("../test/helpers/fake-supabase");
const { boot, freePort } = require("../test/helpers/boot");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

// Three people, chosen to put every state of the firm section on screen at
// once: a paying owner, a FREE colleague who has accepted (the case the
// entitlement split exists for — a firm that could only share with people who
// had already bought the product would not solve the problem it exists for),
// and somebody with an invitation they have not accepted.
const PEOPLE = [
  { id: "u-brad", email: "brad@colliers.com", name: "Brad", pro: true,
    note: "owner · Pro · has a vault" },
  { id: "u-mike", email: "mike@colliers.com", name: "Mike", pro: false,
    note: "colleague · free plan · accepted the invitation" },
  { id: "u-dana", email: "dana@colliers.com", name: "Dana", pro: false,
    note: "invited, has NOT accepted — the disclosure state" },
];
const BRAD = PEOPLE[0], MIKE = PEOPLE[1], DANA = PEOPLE[2];

function seedTables() {
  return {
    users: PEOPLE.map((p) => ({
      id: p.id, email: p.email, name: p.name,
      pro_tester: false, vault_beta: false, digest_optout: false,
    })),
    sessions: PEOPLE.map((p) => ({
      token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT,
    })),
    subscriptions: PEOPLE.filter((p) => p.pro).map((p) => ({
      user_id: p.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    })),
    // One comp in Brad's vault, so the Firm column on /vault has something to
    // toggle. Same shape the vault suite seeds.
    broker_comps: [{
      id: "11111111-1111-4111-8111-111111111111",
      user_id: BRAD.id, market: "Boise, ID", property_type: "Industrial",
      address: "100 Main St", address_key: "100 main st", deal_date: "2026-05-01",
      transaction: "sale", price: 1000000, size_sqft: 10000, price_per_sqft: 100,
      dedupe_key: "k1", published: false, notes: "off market",
    }],
    broker_properties: [], org_comps: [], orgs: [], org_members: [],
    org_subscriptions: [], shared_reports: [], report_viewers: [],
    analytics_events: [], export_usage: [], report_purchases: [],
  };
}

const as = (person, init = {}) => Object.assign({}, init, {
  headers: Object.assign({
    "content-type": "application/json",
    cookie: `cn_session=tok-${person.id}`,
  }, init.headers || {}),
});

const report = (address) => ({
  data: {
    comps: [{ address: "1 Comp Way, Boise, ID", price: 900000, size_sqft: 9000,
              transaction: "sale", date: "2026-04-02", source_type: "public_record" }],
    summary: "A sandbox report. None of these figures came from a real search.",
  },
  meta: { address, type: "Industrial" },
});

// Seeded through the ORDINARY ROUTES, never by writing rows: a sandbox that
// hand-built its own state could put the app in a shape the app itself cannot
// produce, and then everything you learn from clicking around is about the
// sandbox rather than the product.
async function seedFirm(base, log) {
  const post = async (path, person, body) => {
    const res = await fetch(base + path, as(person, {
      method: "POST", body: JSON.stringify(body || {}),
    }));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) log(`  ! ${path} answered ${res.status}: ${json.error || "(no message)"}`);
    return { status: res.status, json };
  };

  const org = await post("/api/org", BRAD, { name: "Colliers Boise" });
  if (org.status !== 200) throw new Error("could not create the firm");
  const orgId = org.json.id;
  log(`  firm "${org.json.name}" created by ${BRAD.email}`);

  const inv = await post("/api/org/invite", BRAD, { orgId, emails: [MIKE.email, DANA.email] });
  log(`  invited ${inv.json.invited} colleagues`);

  const acc = await post("/api/org/accept", MIKE, { orgId });
  if (acc.status === 200) log(`  ${MIKE.email} accepted — ${DANA.email} has not`);

  for (const [who, address] of [[BRAD, "500 Warehouse Way, Boise, ID"],
                                [MIKE, "88 Chinden Blvd, Meridian, ID"]]) {
    const sh = await post("/api/share", who, {
      data: report(address).data, meta: report(address).meta,
      visibility: "org", orgId,
    });
    if (sh.status === 200) log(`  ${who.name} put ${address} on the firm's shelf`);
  }
  return orgId;
}

// A front door. Cookies are not port-specific (RFC 6265), so a tiny server on
// its own port can set cn_session for localhost and the app on another port
// will receive it — which is what turns "paste this into devtools" into a
// link. Nothing here is a real credential: the tokens are the fake database's
// own seeded session rows.
function startSwitcher(port, appBase, orgId) {
  const page = `<!doctype html><meta charset="utf-8"><title>Firm sandbox</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;color:#1A2433}
h1{font-size:1.3rem}a{color:#B91C1C}li{margin:.6rem 0}code{background:#F3F4F6;padding:.1rem .3rem;border-radius:3px}
.n{color:#68707E;font-size:.9em}</style>
<h1>Firm sandbox</h1>
<p>Sign in as anybody. Nothing here touches a real database, and no search will
run — this is the firm surfaces only.</p>
<ul>${PEOPLE.map((p) => `<li><a href="/as/${p.id}">${p.email}</a> <span class="n">— ${p.note}</span></li>`).join("")}</ul>
<p class="n">App: <a href="${appBase}/desk">${appBase}/desk</a> · firm id <code>${orgId}</code><br>
Worth opening: <a href="${appBase}/desk">/desk</a> (the firm section, the shelf,
seats) and <a href="${appBase}/vault">/vault</a> as Brad (the Firm column, and the
&ldquo;Visible only to you&rdquo; line correcting itself the moment a comp is shared).</p>
<p class="n">Sign out again by opening this page and picking somebody else — the
cookie is replaced, not added to.</p>`;
  const srv = http.createServer((req, res) => {
    const m = req.url.match(/^\/as\/([a-z0-9-]+)$/i);
    if (m && PEOPLE.some((p) => p.id === m[1])) {
      res.writeHead(302, {
        // Deliberately NOT httpOnly: this is a development front door, and a
        // readable cookie is one less thing to explain when somebody wants to
        // clear it by hand.
        "set-cookie": `cn_session=tok-${m[1]}; Path=/; Max-Age=86400; SameSite=Lax`,
        location: `${appBase}/desk`,
      });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  });
  return new Promise((resolve) => srv.listen(port, () => resolve(srv)));
}

async function main() {
  const log = (s) => console.log(s);
  const tables = seedTables();
  const db = await fake.start({ tables });

  // The port is chosen HERE rather than by the boot helper, because SITE_URL
  // is read once at startup and every link the app builds — a shelf row, a
  // share url, the invitation email — comes from it. A server that learned its
  // own port afterwards would hand out links to port 80.
  const appPort = await freePort();
  const appBase = `http://localhost:${appPort}`;

  const srv = await boot({
    PORT: String(appPort),
    // The account wall off, so a signed-out browser can still see the app
    // rather than the landing page — this is a workspace tour.
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: appBase,
    // Mail is captured by the fake, never sent. Both vars are required or
    // sendOutboundEmail is a silent no-op.
    EMAIL_FROM: "CompNinja <reports@example.invalid>",
    RESEND_API_KEY: "sandbox",
    RESEND_API_URL: db.resendUrl,
    // Seat billing is visible but unbuyable without a price, which is exactly
    // how a firm looks before anybody has bought seats.
    STRIPE_SECRET_KEY: "",
  });

  log("\nSeeding a firm through the ordinary routes:");
  const orgId = await seedFirm(srv.base, log);

  const switcherPort = await freePort();
  const switcher = await startSwitcher(switcherPort, srv.base, orgId);
  const front = `http://localhost:${switcherPort}/`;

  if (db.sent.length) {
    log(`\nInvitations captured (not sent) — ${db.sent.length}:`);
    log("  " + db.sent.map((m) => m.to.join(", ")).join("\n  "));
    log("\n" + db.sent[0].text.split("\n").map((l) => "  | " + l).join("\n"));
  }

  log(`\n  Open:  ${front}\n`);
  log("  Ctrl-C to stop. Everything is in memory and goes with it.\n");

  const stop = async () => {
    switcher.close();
    srv.stop();
    await db.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("firm-sandbox failed:", err.message);
    process.exit(1);
  });
}
