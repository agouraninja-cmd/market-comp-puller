#!/usr/bin/env node
// Photograph the signed-in Workspace for three personas, optionally with one
// of the drafts in this folder layered on top. Boots the real server.js
// against the stand-in PostgREST (scripts/firm-sandbox.js's pattern), seeds a
// made-up firm through the ordinary routes, and captures /desk over the
// DevTools protocol with a cn_session cookie (scripts/shot.js cannot sign in).
// Spends nothing: no search runs, and mail is off.
//
//   node capture.js --out ../../../screenshots/ws                       today's page
//   node capture.js --out ../../../screenshots/ws-b --draft draft-b.js  Draft B
//   flags: --dark  --sizes 1440x900,390x844  --who u-new,u-emptyfirm,u-brad
//          --path /desk  --fold  --browser /path/to/chrome
//
// Personas: u-new (free, no firm), u-emptyfirm (Pro, a firm with nothing in
// it), u-brad (Pro, a firm with buildings, leases, a shelf, contacts and an
// unread message). Output lands wherever --out says; keep it in the
// git-ignored screenshots/ folder.
"use strict";
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const crypto = require("node:crypto");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const fake = require(REPO + "/test/helpers/fake-supabase");
const { boot, freePort } = require(REPO + "/test/helpers/boot");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const ymd = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

const PEOPLE = [
  { id: "u-new", email: "jordan@example.com", name: "Jordan", pro: false },
  { id: "u-emptyfirm", email: "sam@summitcre.com", name: "Sam", pro: true },
  { id: "u-brad", email: "brad@colliers.com", name: "Brad Keller", pro: true },
  { id: "u-mike", email: "mike@colliers.com", name: "Mike Ortega", pro: true },
];
const P = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));

function tables() {
  return {
    users: PEOPLE.map((p) => ({ id: p.id, email: p.email, name: p.name, pro_tester: false, vault_beta: p.pro, digest_optout: false })),
    sessions: PEOPLE.map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
    subscriptions: PEOPLE.filter((p) => p.pro).map((p) => ({ user_id: p.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    broker_comps: [], broker_properties: [], org_comps: [], orgs: [], org_members: [], org_subscriptions: [],
    shared_reports: [], report_viewers: [], analytics_events: [], export_usage: [], report_purchases: [],
    org_buildings: [], org_building_notes: [], org_leases: [], org_contacts: [], org_branding: [],
    portfolio_items: [], recent_searches: [], msg_threads: [], msg_thread_members: [], msg_messages: [], msg_comps: [],
    watchlist_items: [], permit_filings: [], permit_filing_events: [],
  };
}

const as = (id, init = {}) => Object.assign({}, init, {
  headers: Object.assign({ "content-type": "application/json", cookie: `cn_session=tok-${id}` }, init.headers || {}),
});

async function seed(base) {
  const call = async (method, p, who, body) => {
    const r = await fetch(base + p, as(who, { method, body: body ? JSON.stringify(body) : undefined }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) console.log(`  ! ${method} ${p} ${r.status} ${j.error || ""}`);
    return j;
  };
  // Empty firm for Sam.
  await call("POST", "/api/org", "u-emptyfirm", { name: "Summit Commercial", kind: "broker" });
  // Populated firm for Brad.
  const org = await call("POST", "/api/org", "u-brad", { name: "Colliers Boise", kind: "broker" });
  const id = org.id;
  await call("POST", "/api/org/invite", "u-brad", { orgId: id, emails: ["mike@colliers.com"] });
  await call("POST", "/api/org/accept", "u-mike", { orgId: id });
  const bl = [
    ["1210 N 17th St, Boise, ID", "Industrial", "12,500", "1994"],
    ["500 Warehouse Way, Boise, ID", "Industrial", "40,000", "2006"],
    ["88 Chinden Blvd, Meridian, ID", "Retail", "9,800", "2012"],
    ["450 W Main St, Boise, ID", "Office", "22,000", "1981"],
    ["2750 S Cole Rd, Boise, ID", "Industrial", "64,200", "2019"],
  ];
  const b = [];
  for (const [address, propertyType, sizeSqft, yearBuilt] of bl) {
    const r = await call("POST", `/api/org/buildings?id=${id}`, "u-brad", { address, propertyType, sizeSqft, yearBuilt });
    b.push(r.building && r.building.id);
  }
  await call("POST", `/api/org/leases?id=${id}&building=${b[0]}`, "u-brad", { tenant: "Acme Logistics", suite: "200", sizeSqft: "12,500", leaseExpiry: ymd(200), optionNoticeDate: ymd(38), rentPsf: "9.60", rentBasis: "annual", leaseType: "NNN" });
  await call("POST", `/api/org/leases?id=${id}&building=${b[1]}`, "u-brad", { tenant: "Treasure Valley Supply", leaseExpiry: ymd(74), rentPsf: "0.82", rentBasis: "monthly", leaseType: "NNN" });
  await call("POST", `/api/org/leases?id=${id}&building=${b[3]}`, "u-brad", { tenant: "Ridgeline Law Group", suite: "310", leaseExpiry: ymd(290), rentPsf: "24.00", rentBasis: "annual", leaseType: "FS" });
  const rep = (address, type, size) => ({
    data: { comps: [{ address: "1 Comp Way, Boise, ID", price: 900000, size_sqft: 9000, transaction: "sale", date: "2026-04-02", source_type: "public_record" }], summary: "Sandbox report." },
    meta: { address, type, subject: { sizeMin: size } },
  });
  for (const [who, a, t, s] of [["u-brad", "500 Warehouse Way, Boise, ID", "Industrial", 40000], ["u-mike", "88 Chinden Blvd, Meridian, ID", "Retail", 9800], ["u-mike", "3100 E Franklin Rd, Meridian, ID", "Industrial", 18000]]) {
    const r = rep(a, t, s);
    await call("POST", "/api/share", who, { data: r.data, meta: r.meta, visibility: "org", orgId: id });
  }
  for (const c of [{ name: "Dana Whitfield", company: "Acme Logistics", email: "dana@acmelogistics.com" }, { name: "Luis Parra", company: "Treasure Valley Supply" }, { name: "Karen Holt", company: "Ridgeline Law Group", email: "kholt@ridgelinelaw.com" }]) {
    await call("POST", `/api/org/contacts?id=${id}`, "u-brad", c);
  }
  const th = await call("POST", "/api/messages/thread", "u-mike", { memberIds: ["u-brad"] });
  const tid = th.thread && th.thread.id || th.id;
  if (tid) await call("POST", "/api/messages/send", "u-mike", { threadId: tid, body: "Acme's notice date on 17th St is coming up — want me to call Dana this week?" });
  return id;
}

class Devtools {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
    const dt = new Devtools(ws);
    ws.addEventListener("message", (ev) => dt.on(ev.data));
    return dt;
  }
  on(raw) {
    const m = JSON.parse(raw);
    if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result || {}); return; }
    if (m.method) { const l = this.handlers.get(m.method) || []; for (const fn of l.splice(0)) fn(m.params); }
  }
  send(method, params, sessionId) {
    const id = ++this.id; const p = { id, method, params: params || {} }; if (sessionId) p.sessionId = sessionId;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify(p)); });
  }
  once(method) { return new Promise((r) => { const l = this.handlers.get(method) || []; l.push(r); this.handlers.set(method, l); }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browserBin(explicit) {
  if (explicit) return explicit;
  if (process.env.CN_SHOT_BROWSER) return process.env.CN_SHOT_BROWSER;
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw && fs.existsSync(pw)) {
    for (const dir of fs.readdirSync(pw).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      const full = path.join(pw, dir, "chrome-linux", "chrome");
      if (fs.existsSync(full)) return full;
    }
  }
  const { chromiumCandidates, findBrowser } = require(REPO + "/desktop.js");
  const found = findBrowser(chromiumCandidates(process.platform, process.env), process.env);
  if (!found) throw new Error("No Chromium found; pass --browser /path/to/chrome");
  return found;
}

async function launch(explicit) {
  const bin = browserBin(explicit);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-"));
  const child = spawn(bin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${prof}`, "--no-first-run", "--hide-scrollbars", "--disable-gpu", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--force-prefers-reduced-motion", ...(process.getuid && process.getuid() === 0 ? ["--no-sandbox"] : [])], { stdio: ["ignore", "ignore", "pipe"] });
  const f = path.join(prof, "DevToolsActivePort");
  for (let i = 0; i < 200 && !fs.existsSync(f); i++) await sleep(100);
  await sleep(200);
  const [port, wsPath] = fs.readFileSync(f, "utf8").split("\n");
  return { child, dt: await Devtools.attach(`ws://127.0.0.1:${port.trim()}${wsPath.trim()}`) };
}

async function shoot(dt, url, who, size, opts) {
  const { targetId } = await dt.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await dt.send("Target.attachToTarget", { targetId, flatten: true });
  await dt.send("Page.enable", {}, sessionId);
  await dt.send("Network.enable", {}, sessionId);
  await dt.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: opts.scale || 1, mobile: size.width < 700 }, sessionId);
  await dt.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
  const u = new URL(url);
  await dt.send("Network.setCookie", { name: "cn_session", value: `tok-${who}`, domain: u.hostname, path: "/" }, sessionId);
  if (opts.dark) await dt.send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("theme","dark")}catch(e){}` }, sessionId);
  else await dt.send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("theme","light")}catch(e){}` }, sessionId);
  if (opts.draft) await dt.send("Page.addScriptToEvaluateOnNewDocument", { source: opts.draft }, sessionId);
  const loaded = dt.once("Page.loadEventFired");
  await dt.send("Page.navigate", { url }, sessionId);
  await Promise.race([loaded, sleep(20000)]);
  await sleep(1800);
  const m = await dt.send("Page.getLayoutMetrics", {}, sessionId);
  const c = m.cssContentSize || m.contentSize;
  let h = opts.fold ? size.height : Math.min(Math.max(Math.ceil(c.height), size.height), 9000);
  if (!opts.fold) {
    const r = await dt.send("Runtime.evaluate", { expression: "(function(){var f=document.querySelector('footer');if(!f)return 0;return Math.round(f.getBoundingClientRect().top+window.scrollY)})()", returnByValue: true }, sessionId);
    const ft = r.result && r.result.value;
    if (ft && ft > 400) h = Math.max(Math.min(ft, h), Math.min(size.height, ft));
  }
  const shot = await dt.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !opts.fold, clip: { x: 0, y: 0, width: size.width, height: h, scale: 1 } }, sessionId);
  await dt.send("Target.closeTarget", { targetId });
  return Buffer.from(shot.data, "base64");
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const out = get("--out") || "./shots";
  const draftFile = get("--draft");
  const draft = draftFile ? fs.readFileSync(path.join(path.dirname(draftFile), "common.js"), "utf8") + "\n" + fs.readFileSync(draftFile, "utf8") : null;
  const dark = args.includes("--dark");
  const who = (get("--who") || "u-new,u-emptyfirm,u-brad").split(",");
  const sizes = (get("--sizes") || "1440x900").split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { width: w, height: h }; });
  fs.mkdirSync(out, { recursive: true });
  const db = await fake.start({ tables: tables() });
  const port = await freePort();
  const srv = await boot({ PORT: String(port), ACCOUNT_WALL: "on", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: `http://localhost:${port}`, EMAIL_FROM: "", RESEND_API_KEY: "", STRIPE_SECRET_KEY: "" });
  try {
    await seed(srv.base);
    if (args.includes("--dump")) {
      for (const w of who) {
        const html = await (await fetch(srv.base + "/desk", as(w))).text();
        const at = html.indexOf("window.DESK_BOOT=");
        const raw = html.slice(at + 17, html.indexOf("</script>", at)).replace(/;\s*$/, "");
        fs.writeFileSync(path.join(out, w + "-boot.json"), JSON.stringify(JSON.parse(raw), null, 1));
      }
      return;
    }
    const { child, dt } = await launch(get("--browser"));
    try {
      for (const w of who) for (const s of sizes) {
        const buf = await shoot(dt, `http://localhost:${port}${get("--path") || "/desk"}`, w, s, { draft, dark, fold: args.includes("--fold"), scale: Number(get("--scale") || 1) });
        const f = path.join(out, `${w.replace("u-", "")}-${s.width}${dark ? "-dark" : ""}.png`);
        fs.writeFileSync(f, buf);
        console.log("wrote", f);
      }
    } finally { child.kill(); }
  } finally { srv.stop(); await db.stop(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
