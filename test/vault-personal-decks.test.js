const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const vm = require("node:vm");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { renderVaultBody } = require("../vault-page.js");

// What a member reaches without Pro on the pages vault-page.js draws.
//
// The vault became a per-DECK gate on 2026-09-01 ("Three Spaces"), when a
// member's own portfolio and watchlist moved onto it: a free member must not
// open their own space and find their own saved properties behind a paywall.
// The watchlist left for the Markets page on 2026-10-09 (The Board) and the
// portfolio for Home on 2026-10-13, when the vault itself was taken apart
// into /comps and /pipeline (the owner: "remove the vault"). The seam is
// still here, with one deck on the free side of it: Contributions, the comps
// a member handed to the public records, which was never Pro. Everything in
// this file is about that seam.

const DAY = 86400000;
const TOKEN = "vault-decks-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

// The free deck. The Board's ids and the portfolio's (deckProps, propsSec)
// were on this list until they left; neither may come back onto either page.
const PERSONAL = ["deckContribs", "contribSec"];
const GONE = ["deckProps", "propsSec", "deckMarkets", "mktSec"];
// The decks the lock hides. The hubs deck left for /messages on 2026-09-04,
// and its ids must NOT come back into this list, or the lock would name
// elements that no longer exist and the test would prove nothing about them.
const GATED = ["trustLine", "deckBook", "compsSec", "deckPipe", "pipeSec"];
const PAGES = ["comps", "pipeline"];

// The page is ONE template literal emitting ~3,000 lines of browser JS, so a
// stray ${ or a single backslash ships a blank page silently rather than
// failing loudly. test/vault-page.test.js compiles the 200 case; these are the
// refusals, on both pages.
test("the emitted script compiles in every boot state, refusals included, on both pages", () => {
  for (const page of PAGES) {
    for (const boot of [
      { s: 200, j: { comps: [], uploads: [], counts: {}, markets: [], types: [],
        identity: {}, firm: null, sharedWithFirm: [] } },
      { s: 403, j: { error: "The private vault is part of Pro.", code: "broker_required" } },
      { s: 503, j: { error: "The vault is unavailable right now." } },
      { s: 401, j: { error: "Not signed in." } },
    ]) {
      const html = renderVaultBody(boot, { page });
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      assert.ok(scripts.length, `${page} boot ${boot.s} emitted no script`);
      for (const src of scripts) {
        assert.doesNotThrow(() => new vm.Script(src),
          `${page} boot ${boot.s}: the emitted browser JS does not compile`);
      }
    }
  }
});

test("the free deck is in the markup for every visitor, and the decks that left are not", () => {
  // The markup is one set of bytes whatever the boot says; which decks SHOW is
  // decided by the script. So a refusal must not be able to drop the elements
  // the free deck renders into, or a later 200 would have nowhere to draw.
  for (const page of PAGES) {
    for (const s of [200, 403, 503, 401]) {
      const html = renderVaultBody({ s, j: {} }, { page });
      for (const id of PERSONAL) assert.ok(html.includes(`id="${id}"`), `${page} boot ${s} lost #${id}`);
      for (const id of GONE) assert.ok(!html.includes(`id="${id}"`), `${page} boot ${s}: #${id} is back`);
      assert.ok(html.includes('id="vaultLocked"'), `${page} boot ${s} lost the locked panel`);
    }
  }
});

test("the lock list is the book and the pipeline, and NOTHING free", () => {
  const html = renderVaultBody({ s: 403, j: {} });
  const m = html.match(/var VAULT_DECKS=\[([\s\S]*?)\];/);
  assert.ok(m, "VAULT_DECKS moved or was renamed — the per-deck gate's one list");
  const ids = m[1].match(/"[^"]+"/g).map((s) => s.replace(/"/g, ""));
  // Every gated surface is named. A missing one leaves a comps table or a BOV
  // log on screen for somebody with no subscription.
  for (const id of GATED) {
    assert.ok(ids.includes(id), `${id} is not locked — a Pro surface would render for a free member`);
  }
  for (const id of PERSONAL) {
    assert.ok(!ids.includes(id), `${id} is in the lock list — contributions were never part of Pro`);
  }
});

test("401 is the only whole-page gate left", () => {
  const html = renderVaultBody({ s: 403, j: {} });
  const script = html.match(/<script>([\s\S]*?)<\/script>\s*$/)[1];
  const apply = script.slice(script.indexOf("function apply(o)"),
    script.indexOf("function apply(o)") + 2000);
  // Signed out means there is nothing of the member's to show either, so the
  // page-wide gate is still right there and nowhere else.
  assert.match(apply, /o\.s===401\) return gate\(/, "the signed-out gate must stay");
  assert.ok(!/o\.s===403\) return gate\(/.test(apply), "403 must lock decks, not the page");
  assert.ok(!/o\.s!==200\) return gate\(/.test(apply), "a non-200 must lock decks, not the page");
  assert.match(apply, /o\.s===403\) return lockVaultDecks/, "403 goes to the deck lock");
  assert.match(apply, /o\.s!==200\) return lockVaultDecks/, "so does every other refusal");
});

test("no heading collides with the two market-ish ones this page already had", () => {
  for (const page of PAGES) {
    const html = renderVaultBody({ s: 200, j: {} }, { page });
    // #rollupSec's h2 "Your markets" is where this broker's COMPS are, and
    // #covBox's summary "Markets you watch" is where they want LEADS from. A
    // deck called either would put two identical headings on one screen
    // meaning different things. (The Board is on the Markets page since
    // 2026-10-09.)
    const labels = [...html.matchAll(/<span class="dlab">([^<]+)</g)].map((m) => m[1]);
    assert.equal(new Set(labels).size, labels.length, `duplicate deck labels: ${labels}`);
    assert.ok(!labels.includes("The Board"), "The Board is back on this page");
    assert.ok(!labels.includes("Your markets"),
      "'Your markets' is #rollupSec's h2 — a deck by that name is a collision");
    assert.ok(!labels.includes("Your properties"), "the Properties deck is back");
  }
});

// ---------------------------------------------------------------------------
// The seam that matters, against a real server: a free member reaches both
// pages, each tells them what they cannot reach, and /vault forwards.
// ---------------------------------------------------------------------------
function tables({ pro }) {
  return {
    users: [{ id: "u1", email: "m@example.com", vault_beta: pro, pro_tester: pro }],
    sessions: [{ id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
      expires_at: new Date(Date.now() + 30 * DAY).toISOString() }],
    broker_comps: [], broker_uploads: [], broker_profiles: [], org_members: [],
    portfolio_items: [], watchlist_items: [], comp_corpus: [], analytics_events: [],
  };
}

async function withServer(pro, fn) {
  const db = await fake.start({ tables: tables({ pro }) });
  const srv = await shared.boot({
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "k",
    PRO_ENABLED: "on", ACCOUNT_WALL: "off",
  });
  try { await fn(srv, db); } finally { await srv.stop(); await db.stop(); }
}

test("a free member's vault read refuses the book, and carries no portfolio flag", async () => {
  await withServer(false, async (srv) => {
    const r = await fetch(srv.base + "/api/vault", { headers: { cookie: `cn_session=${TOKEN}` } });
    assert.equal(r.status, 403, "the vault's own read still refuses a free member");
    const j = await r.json();
    assert.equal(j.code, "broker_required");
    // portfolioValues rode on every exit from 2026-09-01 for the Properties
    // deck; it left with the deck (2026-10-13). Home reads /api/config's.
    assert.ok(!("portfolioValues" in j), "the read still carries a flag nothing reads");
  });
});

test("both pages answer 200 to a free member, locked, with the free deck intact", async () => {
  await withServer(false, async (srv) => {
    for (const [path, h1] of [["/comps", "Your comps"], ["/pipeline", "Pipeline"]]) {
      const r = await fetch(srv.base + path, { headers: { cookie: `cn_session=${TOKEN}` } });
      // 200 HTML always -- the page renders its own refusal, which is what
      // makes it exempt from ACCOUNT_WALL and what lets the free deck through.
      assert.equal(r.status, 200, path);
      const html = await r.text();
      for (const id of PERSONAL) assert.ok(html.includes(`id="${id}"`), `${path} lost #${id}`);
      assert.ok(html.includes('id="vaultLocked"'), `${path}: and the refusal it will show instead`);
      assert.ok(html.includes(`<h1 class="h">${h1}</h1>`), `${path} is not headed ${h1}`);
      assert.ok(html.includes('"s":403'), `${path}: the boot payload must carry the refusal`);
    }
  });
});

test("/vault forwards to /comps, query kept; the fragment rides along in the browser", async () => {
  await withServer(true, async (srv) => {
    for (const [from, to] of [["/vault", "/comps"], ["/vault?add=own", "/comps?add=own"]]) {
      const r = await fetch(srv.base + from, { headers: { cookie: `cn_session=${TOKEN}` }, redirect: "manual" });
      assert.equal(r.status, 302, from);
      assert.equal(r.headers.get("location"), to, from);
    }
  });
});

test("a free member's own properties are reached from Home, not from a gated rail row", async () => {
  // Draft C (2026-10-07) took the Data row out of the rail; a member's
  // properties are Home's Properties tab, open to every signed-in member.
  // What must not come back is a row gated on Pro.
  await withServer(false, async (srv) => {
    const html = await (await fetch(srv.base + "/comps", {
      headers: { cookie: `cn_session=${TOKEN}` },
    })).text();
    assert.ok(!html.includes('id="navVault"'), "the rail grew a Data row back");
    assert.ok(!html.includes(`show($("navVault"),Boolean(pro.canUseVault))`),
      "and must never come back gated on the entitlement");
    assert.match(html, /<a href="\/desk">/, "the way home is still a row");
  });
});
