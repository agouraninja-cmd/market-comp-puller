// A PUBLIC share whose database write fails, actually run.
//
// Run: npm test
//
// storeSharedReport used to keep a file fallback for a public share ("the link
// still works through a database blip"). That stopped being true when
// getShareRecord became database-only for the ACL work: with a database
// configured it never looks in the file, so the sender was answered 200 with a
// link that 404'd from its first click. And on Render the file is erased by
// the next deploy anyway (never-break rule 4: where a local file would be the
// loss, refuse). Since 2026-11-10 the write refuses for every visibility, and
// the sender is told to try again.

const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const REPORT = {
  data: { comps: [{ address: "100 Main St", price: 1000000 }] },
  meta: { address: "500 Warehouse Way, Boise, ID", type: "Industrial" },
};
const share = (srv) => fetch(srv.base + "/api/share", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(REPORT),
});

async function bootWith(t, fakeOpts) {
  const db = await fake.start({ tables: { shared_reports: [], report_viewers: [], analytics_events: [] }, ...fakeOpts });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  return { db, srv };
}

test("a public share is stored, and its link opens", async (t) => {
  const { db, srv } = await bootWith(t);
  const r = await share(srv);
  assert.equal(r.status, 200);
  const { id } = await r.json();
  assert.equal(db.tables.shared_reports.length, 1);
  const read = await fetch(`${srv.base}/api/shared?id=${encodeURIComponent(id)}`);
  assert.equal(read.status, 200, "the link the sender was given opens");
});

test("a public share the database refuses is an error, never a link that cannot open", async (t) => {
  // The table is missing: every write to it fails, the way a blip or an unrun
  // migration would.
  const { srv } = await bootWith(t, { missingTables: ["shared_reports"] });
  const r = await share(srv);
  assert.equal(r.status, 500, "the sender is told, instead of handed a dead link");
  const j = await r.json();
  assert.match(j.error, /Could not create the share link/);
  assert.equal(j.id, undefined);
  assert.equal(j.url, undefined);
});
