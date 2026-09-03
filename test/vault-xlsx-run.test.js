// The Excel and paste doors into the vault, actually run (2026-09-02): a real
// workbook through the real /api/vault/inspect against the stand-in
// PostgREST, then the CSV it hands back through /api/vault/upload. The pure
// tests prove the reader's verdicts cell by cell; only a boot proves that a
// date-styled serial lands in broker_comps.deal_date as a day, that a percent
// lands as the figure Excel shows, that the refusals reach the broker with
// the reader's own words, and that a remembered mapping is now keyed on the
// file's shape rather than on the broker.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { xlsxFromRows } = require("./helpers/make-xlsx.js");

const DAY = 86400000;
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

function baseTables() {
  return {
    users: [{ id: "u1", email: "broker@example.com", name: "Brad", vault_beta: true }],
    sessions: [
      { id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
    ],
    broker_comps: [], broker_uploads: [], broker_properties: [],
    broker_csv_mappings: [],
    broker_profiles: [
      { id: "p1", user_id: "u1", email: "broker@example.com",
        display_name: "Brad", company: "Test & Co", public: false },
    ],
    orgs: [], org_members: [], org_comps: [],
  };
}

const as = (init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=${TOKEN}`, ...(init.headers || {}) },
});

test("an Excel book through the vault, end to end", async (t) => {
  const tables = baseTables();
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    CENSUS_API_URL: db.url + "/census-stub",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  const inspect = (body) => fetch(srv.base + "/api/vault/inspect", as({ method: "POST", body: JSON.stringify(body) }));
  const upload = (body) => fetch(srv.base + "/api/vault/upload", as({ method: "POST", body: JSON.stringify(body) }));

  // xfs: 0 General, 1 a date, 2 a percent.
  const styles = { xfs: [0, 14, 9] };
  const book = xlsxFromRows([
    ["address", "property_type", "transaction", "deal_date", "price", "size_sqft", "cap_rate"],
    ["4100 W Franklin Rd, Boise, ID", "Industrial", "sale", { n: 45730, s: 1 }, { n: 1250000, s: 0 }, { n: 45000, s: 0 }, { n: 0.0625, s: 2 }],
  ], { styles });

  let converted = "";
  await t.test("inspect reads the workbook typed and hands back the CSV", async () => {
    const r = await inspect({ xlsx: book.toString("base64"), filename: "book.xlsx" });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const body = JSON.parse(text);
    assert.deepEqual(body.headers, ["address", "property_type", "transaction", "deal_date", "price", "size_sqft", "cap_rate"]);
    assert.equal(body.cleanTemplate, true);
    assert.equal(typeof body.csv, "string", "the converted text rides back, since only the server saw the workbook");
    assert.match(body.csv, /2025-03-14/, "the date-styled serial is a day");
    assert.match(body.csv, /,6\.25\n/, "the percent-styled fraction is the percentage Excel shows");
    assert.match(body.csv, /,1250000,/);
    converted = body.csv;
  });

  await t.test("the CSV it handed back imports, and the stored row carries real figures", async () => {
    const r = await upload({ filename: "book.xlsx", csv: converted });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.imported, 1, JSON.stringify(body));
    const row = tables.broker_comps.find((c) => c.address_key.startsWith("4100 w franklin"));
    assert.ok(row, "the comp landed");
    assert.equal(row.deal_date, "2025-03-14");
    assert.equal(row.cap_rate, 6.25, "0.0625 would have passed validation as 0.0625% — 100x low");
    assert.equal(row.price, 1250000);
    assert.equal(row.size_sqft, 45000);
  });

  await t.test("a plain CSV inspect is byte-for-byte what it was: no csv field", async () => {
    const r = await inspect({ csv: "address,property_type,transaction,deal_date\n1 Main St, Boise, ID,Industrial,sale,2026-01-05\n" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(Object.prototype.hasOwnProperty.call(body, "csv"), false);
  });

  await t.test("a tab-separated paste is converted with the address quoted", async () => {
    const r = await inspect({ csv: "address\tproperty_type\ttransaction\tdeal_date\n120 Main St, Boise, ID\tIndustrial\tsale\t2026-01-05\n" });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const body = JSON.parse(text);
    assert.match(body.csv, /"120 Main St, Boise, ID",Industrial,sale,2026-01-05/);
    assert.equal(body.cleanTemplate, true);
    const up = await upload({ filename: "Pasted rows", csv: body.csv });
    assert.equal(up.status, 200);
    assert.equal((await up.json()).imported, 1);
    assert.ok(tables.broker_comps.some((c) => c.address === "120 Main St, Boise, ID"), "the commas survived");
  });

  await t.test("a serial in a General column is refused at import, naming the row and the fix", async () => {
    const bad = xlsxFromRows([
      ["address", "property_type", "transaction", "deal_date"],
      ["900 Bad Date Rd, Boise, ID", "Industrial", "sale", { n: 45730, s: 0 }],
    ], { styles });
    const r = await inspect({ xlsx: bad.toString("base64"), filename: "bad.xlsx" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.match(body.csv, /,45730\n/, "not a date Excel shows as one, so not a date we guess at");
    const up = await upload({ filename: "bad.xlsx", csv: body.csv });
    assert.equal(up.status, 400);
    const verdict = await up.json();
    assert.match(verdict.error, /^Line 2:/, "Excel's row, not the compacted index");
    assert.match(verdict.error, /YYYY-MM-DD/);
  });

  await t.test("an older .xls is refused by name; an empty file and junk are refused too", async () => {
    const xls = Buffer.alloc(64); xls[0] = 0xd0; xls[1] = 0xcf; xls[2] = 0x11; xls[3] = 0xe0;
    let r = await inspect({ xlsx: xls.toString("base64"), filename: "book.xls" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /older \.xls/);
    r = await inspect({ xlsx: "", filename: "empty.xlsx" });
    assert.equal(r.status, 400);
    r = await inspect({ xlsx: Buffer.from("hello there, not a zip").toString("base64"), filename: "x.xlsx" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /does not look like a spreadsheet/);
  });

  await t.test("a workbook over 4 MB is refused with the size named", async () => {
    const big = Buffer.alloc(4 * 1024 * 1024 + 1, 0x41);
    big[0] = 0x50; big[1] = 0x4b; big[2] = 0x03; big[3] = 0x04;
    const r = await inspect({ xlsx: big.toString("base64"), filename: "huge.xlsx" });
    assert.equal(r.status, 413);
    assert.match((await r.json()).error, /4 MB/);
  });

  await t.test("a remembered mapping is keyed on the file's shape, so two shapes keep two mappings", async () => {
    const shapeA = 'Property Address,Type,Deal Type,Sale Date\n"1 Shape A St, Boise, ID",Industrial,Sale,2026-01-05\n';
    const mapA = { property_address: "address", type: "property_type", deal_type: "transaction", sale_date: "deal_date" };
    const shapeB = 'Site,Kind,Sale or Lease,Closed\n"2 Shape B Ave, Boise, ID",Office,Sale,2026-02-05\n';
    const mapB = { site: "address", kind: "property_type", sale_or_lease: "transaction", closed: "deal_date" };
    let r = await upload({ filename: "a.csv", csv: shapeA, mapping: mapA });
    assert.equal(r.status, 200, await r.text());
    r = await upload({ filename: "b.csv", csv: shapeB, mapping: mapB });
    assert.equal(r.status, 200, await r.text());
    // The write is fire-and-forget; give it a beat.
    for (let i = 0; i < 20 && tables.broker_csv_mappings.length < 2; i++) await new Promise((res) => setTimeout(res, 25));
    assert.equal(tables.broker_csv_mappings.length, 2, "one row per shape, not one per broker");

    r = await inspect({ csv: shapeA });
    assert.deepEqual((await r.json()).remembered, mapA, "shape A gets A's mapping back, not the later B");
    r = await inspect({ csv: shapeB });
    assert.deepEqual((await r.json()).remembered, mapB);
    // A shape never seen falls back to the most recent, as one-per-broker always did.
    r = await inspect({ csv: 'Where,What,How,When\n"3 New Rd, Boise, ID",Retail,Sale,2026-03-05\n' });
    assert.deepEqual((await r.json()).remembered, mapB);
  });
});
