// test/permit-watch-bulk-run.test.js
// Tracking several permits at once (2026-09-30), actually run: a real
// server.js against the stand-in PostgREST and the shared portal stub.
//
// What this proves that the parser's unit tests cannot: the preview asks no
// portal and writes nothing; the second pass looks each permit up exactly as
// the one-permit form does (a number the portal does not know is named and
// not added, a portal that is down is stored unchecked); the 25 cap and the
// member's existing permits are counted; the Pro gate and the owner-only firm
// switch hold; and an Excel file arrives as the same list.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { startPortal } = require("./helpers/permit-portal-stub");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const BRAD = { id: "5a1e9a1e-0000-4000-8000-00000000b1a1", email: "brad@colliers.com", name: "Brad" };
const FREE = { id: "5a1e9a1e-0000-4000-8000-00000000b1a2", email: "free@nowhere.com", name: "Free" };
const tables = () => ({
  users: [{ ...BRAD, pro_tester: true }, { ...FREE, pro_tester: false }].map((u) => ({ vault_beta: false, digest_optout: false, ...u })),
  sessions: [BRAD, FREE].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
  subscriptions: [], orgs: [], org_members: [],
  permit_filings: [], permit_filing_events: [], permit_watches: [], permit_watch_events: [], permit_watch_mutes: [], analytics_events: [],
});

const as = (u) => (u ? { cookie: `cn_session=tok-${u.id}` } : {});
const bulk = (srv, user, body) => fetch(srv.base + "/api/permits/watch/bulk", {
  method: "POST", headers: { "content-type": "application/json", ...as(user) }, body: JSON.stringify(body),
});

// The smallest .xlsx xlsx.js reads: one sheet, inline strings.
function tinyXlsx(rows) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const col = (i) => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join("")}</row>`).join("")
  }</sheetData></worksheet>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
  };
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"); const data = zlib.deflateRawSync(raw); const nm = Buffer.from(name, "utf8"); const crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("tracking several permits at once", async (t) => {
  const portal = await startPortal();
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: "k", PRO_ENABLED: "on",
    PERMIT_PORTAL_ORIGIN: portal.url, PERMIT_SWEEP_PAUSE_MS: "0",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); await portal.stop(); });
  portal.statusOf["BLD26-00011"] = "In Review";
  portal.statusOf["BLD26-00012"] = "Issued";
  portal.statusOf["C-TI-2026-0001"] = "Received";
  portal.statusOf["BLD26-00013"] = "In Review";
  portal.down.add("BLD26-00013");
  const LIST = "BLD26-00011, Federal Way warehouse\nbld26-00012\nMeridian, C-TI-2026-0001\nBLD26-99999\nBLD26-00013\nNampa, NP-26-1\nnot a permit";

  await t.test("signed out is refused, and a free account meets the Pro gate before anything is read", async (t) => {
    assert.equal((await bulk(srv, null, { text: LIST, preview: true })).status, 401);
    const r = await bulk(srv, FREE, { text: LIST, preview: true });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, "pro_required");
  });

  await t.test("the preview names every row and why, asks no portal and writes nothing", async (t) => {
    const before = portal.hits.length;
    const r = await bulk(srv, BRAD, { text: LIST, jurisdiction: "boise", preview: true });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.deepEqual(j.permits.map((p) => `${p.city} ${p.permit_number}`),
      ["Boise BLD26-00011", "Boise BLD26-00012", "Meridian C-TI-2026-0001", "Boise BLD26-99999", "Boise BLD26-00013"]);
    assert.equal(j.permits[0].label, "Federal Way warehouse");
    assert.deepEqual(j.skipped.map((s) => s.line), [6, 7]);
    assert.match(j.skipped[0].reason, /can't track Nampa permits by number/);
    assert.equal(portal.hits.length, before, "no portal was asked");
    assert.equal(db.tables.permit_watches.length, 0);
  });

  await t.test("adding looks each one up: a known number is stored with what the portal read, an unknown one is named, a down portal is not a refusal", async (t) => {
    const r = await bulk(srv, BRAD, { text: LIST, jurisdiction: "boise", notify: { steps: ["issued"], alerts: true, email: true, app: true } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.deepEqual(j.watches.map((w) => w.permitNumber).sort(), ["BLD26-00011", "BLD26-00012", "BLD26-00013", "C-TI-2026-0001"]);
    assert.deepEqual(j.notFound.map((n) => n.permitNumber), ["BLD26-99999"]);
    assert.equal(j.unchecked, 1);
    const rows = db.tables.permit_watches;
    assert.equal(rows.length, 4);
    assert.ok(rows.every((w) => w.user_id === BRAD.id && !w.org_id));
    const issued = rows.find((w) => w.permit_number === "BLD26-00012");
    assert.equal(issued.status, "Issued");
    assert.deepEqual(issued.passed_steps, ["submitted", "review", "approved", "issued"]);
    assert.deepEqual(issued.notify_steps, ["issued"]);
    assert.equal(rows.find((w) => w.permit_number === "BLD26-00011").label, "Federal Way warehouse");
    assert.equal(rows.find((w) => w.permit_number === "C-TI-2026-0001").jurisdiction, "meridian");
    const down = rows.find((w) => w.permit_number === "BLD26-00013");
    assert.equal(down.status, null);
    assert.match(down.check_error, /next weekday sweep/);
    assert.equal(db.tables.permit_watch_events.length, 0, "adding announces nothing");
  });

  await t.test("a second pass counts what is already tracked and the 25 cap", async (t) => {
    const lines = ["BLD26-00011"];
    for (let i = 0; i < 30; i++) lines.push("BLD26-5" + String(i).padStart(4, "0"));
    const r = await bulk(srv, BRAD, { text: lines.join("\n"), jurisdiction: "boise", preview: true });
    const j = await r.json();
    assert.equal(j.permits.length, 21, "25 minus the 4 already tracked");
    assert.match(j.skipped[0].reason, /already tracking BLD26-00011/);
    assert.equal(j.skipped.filter((s) => /25-permit limit/.test(s.reason)).length, 9);
  });

  await t.test("a firm switch from somebody who owns no firm is refused and adds nothing", async (t) => {
    portal.statusOf["BLD26-00020"] = "In Review";
    const r = await bulk(srv, BRAD, { text: "BLD26-00020", jurisdiction: "boise", firm: true });
    assert.equal(r.status, 403);
    assert.ok(!db.tables.permit_watches.some((w) => w.permit_number === "BLD26-00020"));
  });

  await t.test("an Excel file with a header row is read into the same list", async (t) => {
    const xlsx = tinyXlsx([["City", "Permit number", "Nickname"], ["Boise", "BLD26-00020", "Shell"], ["Meridian", "C-TI-2026-0002", ""]]);
    const r = await bulk(srv, BRAD, { xlsx: xlsx.toString("base64"), jurisdiction: "boise", preview: true });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.deepEqual(j.permits.map((p) => [p.jurisdiction, p.permit_number, p.label]),
      [["boise", "BLD26-00020", "Shell"], ["meridian", "C-TI-2026-0002", null]]);
    assert.match(j.text, /BLD26-00020/, "the file comes back as the list the second pass sends");
  });

  await t.test("an empty list and a bad body are 400s", async (t) => {
    assert.equal((await bulk(srv, BRAD, { text: "  \n ", preview: true })).status, 400);
    const r = await fetch(srv.base + "/api/permits/watch/bulk", { method: "POST", headers: { "content-type": "application/json", ...as(BRAD) }, body: "{nope" });
    assert.equal(r.status, 400);
  });
});
