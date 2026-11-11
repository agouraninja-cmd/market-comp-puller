// Removing an import, actually run.
//
// Run: npm test
//
// "Remove" on an import deletes the broker_uploads row and the database
// cascades its comps away. Until 2026-11-10 that was all it did, so any of
// those comps the broker had PUBLISHED left its public copy behind in
// comp_submissions: still approved, still offered to every report as
// "Verified · via <firm>", and with the vault row that held its submission id
// gone, nothing left that could take it back. Deleting one comp has always
// retracted first; removing forty at once did not.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const TOKEN = "test-session-token";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const UPLOAD = "9c1e9a1e-0000-4000-8000-0000000000a1";
const OTHER_UPLOAD = "9c1e9a1e-0000-4000-8000-0000000000a2";
const THEIR_UPLOAD = "9c1e9a1e-0000-4000-8000-0000000000b1";

const comp = (id, over) => ({
  id, user_id: "u1", upload_id: UPLOAD, address: `${id} Main St, Boise, ID`, transaction: "sale",
  published: false, published_at: null, published_submission_id: null, ...over,
});

function tables() {
  return {
    users: [
      { id: "u1", email: "broker@example.com", name: "Brad", vault_beta: true },
      { id: "u2", email: "rival@example.com", name: "Rival", vault_beta: true },
    ],
    sessions: [{ id: "s1", user_id: "u1", token_hash: sha256(TOKEN), expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }],
    broker_uploads: [
      { id: UPLOAD, user_id: "u1", filename: "q3.xlsx" },
      { id: OTHER_UPLOAD, user_id: "u1", filename: "q2.xlsx" },
      { id: THEIR_UPLOAD, user_id: "u2", filename: "theirs.xlsx" },
    ],
    broker_comps: [
      comp("c1", { published: true, published_submission_id: 501 }),
      comp("c2", { published: true, published_submission_id: 502 }),
      comp("c3"),
      // Published, but from an import that is staying.
      comp("c4", { upload_id: OTHER_UPLOAD, published: true, published_submission_id: 777 }),
      // Another broker's published comp.
      comp("c5", { user_id: "u2", upload_id: THEIR_UPLOAD, published: true, published_submission_id: 888 }),
    ],
    comp_submissions: [501, 502, 777, 888, 900].map((id) => ({ id, status: "approved", address: `${id} Public Rd` })),
    broker_properties: [], broker_profiles: [], orgs: [], org_members: [], org_comps: [], subscriptions: [],
    analytics_events: [],
  };
}

const as = (init = {}) => ({ ...init, headers: { cookie: `cn_session=${TOKEN}`, ...(init.headers || {}) } });

test("removing an import takes its published comps out of the public records too", async (t) => {
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  const left = () => db.tables.comp_submissions.map((s) => s.id).sort((a, b) => a - b);

  // Somebody else's import: refused quietly, and nothing public moves.
  const theirs = await fetch(`${srv.base}/api/vault/upload?id=${THEIR_UPLOAD}`, as({ method: "DELETE" }));
  assert.equal(theirs.status, 200);
  assert.deepEqual(left(), [501, 502, 777, 888, 900], "another broker's published comps are untouched");
  assert.ok(db.tables.broker_uploads.some((u) => u.id === THEIR_UPLOAD), "and so is their import");

  const r = await fetch(`${srv.base}/api/vault/upload?id=${UPLOAD}`, as({ method: "DELETE" }));
  assert.equal(r.status, 200);
  assert.deepEqual(left(), [777, 888, 900],
    "the removed import's two public copies are gone; every other one stays");
  assert.ok(!db.tables.broker_uploads.some((u) => u.id === UPLOAD), "and the import itself is removed");
});
