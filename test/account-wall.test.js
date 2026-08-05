// The account wall — routing and the forced guest limit.
//
// Run: npm test
//
// Cost: zero. Nothing here calls Anthropic, Stripe or Supabase. One test boots
// with a FAKE api key so that /api/comps reaches the guest gate at all (see
// FAKE_KEY below); the gate refuses before any upstream call, so a passing run
// spends nothing and a failing one dies on an invalid key rather than a bill.
//
// Coverage gap: the wall-OFF state only proves PRESENTATION here (/api/config
// reports no wall and the configured limit). It does not prove enforcement —
// that a disabled wall really lets a guest search reach /api/comps — because
// that route checks for a missing ANTHROPIC_API_KEY before it ever reaches the
// guest gate (see the note on FAKE_KEY below), so a bare environment can't
// observe "passed the gate" without either a real network call or reordering
// the route. Left uncovered rather than faked.
//
// Spec: docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md

const test = require("node:test");
const assert = require("node:assert");
const { boot } = require("./helpers/boot");

// --- The lever ------------------------------------------------------------

// The POST /api/comps handler in server.js checks for a missing
// ANTHROPIC_API_KEY (the `if (!API_KEY)` guard right after the address/type
// validation) BEFORE it calls guestGateFor(), so a bare environment answers
// 500 and the gate is never observed. A syntactically plausible fake key gets
// past that check; the gate then returns 403 before any Anthropic call, so a
// passing test still costs nothing and touches no network. If the gate ever
// regresses, the request fails upstream on an invalid key rather than
// spending anything — which is the failure mode you want in a test suite.
const FAKE_KEY = "sk-ant-not-a-real-key";

test("the wall forces the guest search limit to zero", async (t) => {
  // GUEST_SEARCH_LIMIT deliberately set to something generous: the point is
  // that the wall overrides it rather than trusting two env vars to agree.
  const srv = await boot({ ACCOUNT_WALL: "on", GUEST_SEARCH_LIMIT: "5", ANTHROPIC_API_KEY: FAKE_KEY });
  t.after(() => srv.stop());

  await t.test("/api/config reports the wall and a zero limit", async () => {
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.accountWall, true);
    assert.equal(cfg.guestSearch.limit, 0, "GUEST_SEARCH_LIMIT=5 must not survive the wall");
  });

  await t.test("an anonymous report search is refused", async () => {
    const r = await fetch(srv.base + "/api/comps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "123 Main St, Boise, ID", type: "Industrial" }),
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    // The client keys off this flag, never off the status code.
    assert.equal(j.signin_required, true);
  });
});

test("the rollback lever restores the configured guest limit", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5" });
  t.after(() => srv.stop());

  await t.test("/api/config reports no wall and the real limit", async () => {
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.accountWall, false);
    assert.equal(cfg.guestSearch.limit, 5);
  });
});
