const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const { renderVaultBody } = require("../vault-page.js");

// The Vault as the member's own space (2026-09-01, "Three Spaces").
//
// The workspace at /desk became the FIRM's record and a member's own portfolio
// and watchlist moved here, which forced the page's single canUseVault gate to
// become a per-DECK one. The failure this file exists to prevent is the obvious
// way to get that wrong: a free member opening their own space and finding
// their own saved properties behind a paywall.
//
// Everything here is about that seam. The decks' contents are the portfolio and
// watchlist routes, which have their own tests and did not change.

const DAY = 86400000;
const TOKEN = "vault-decks-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

const PERSONAL = ["deckProps", "propsSec", "deckMarkets", "mktSec"];
const GATED = ["trustLine", "deckBook", "compsSec", "deckPipe", "pipeSec",
  "deckHubs", "hubSec"];

function bootBody(boot) {
  return renderVaultBody(boot);
}

// The page is ONE template literal emitting ~3,000 lines of browser JS, so a
// stray ${ or a single backslash ships a blank workspace silently rather than
// failing loudly. test/vault-page.test.js compiles the 200 case; these are the
// two refusals, which is where the new branch lives.
test("the emitted script compiles in every boot state, refusals included", () => {
  for (const boot of [
    { s: 200, j: { comps: [], uploads: [], counts: {}, markets: [], types: [],
      identity: {}, firm: null, sharedWithFirm: [], portfolioValues: true } },
    { s: 403, j: { error: "The private vault is part of Pro.",
      code: "broker_required", portfolioValues: false } },
    { s: 503, j: { error: "The vault is unavailable right now.", portfolioValues: true } },
    { s: 401, j: { error: "Not signed in." } },
  ]) {
    const html = bootBody(boot);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length, `boot ${boot.s} emitted no script`);
    for (const src of scripts) {
      assert.doesNotThrow(() => new vm.Script(src),
        `boot ${boot.s}: the emitted browser JS does not compile`);
    }
  }
});

test("both personal decks are in the markup for every visitor", () => {
  // The markup is one set of bytes whatever the boot says; which decks SHOW is
  // decided by the script. So a refusal must not be able to drop the elements
  // the personal decks render into, or a later 200 would have nowhere to draw.
  for (const s of [200, 403, 503, 401]) {
    const html = bootBody({ s, j: { portfolioValues: false } });
    for (const id of PERSONAL) {
      assert.ok(html.includes(`id="${id}"`), `boot ${s} lost #${id}`);
    }
    assert.ok(html.includes('id="vaultLocked"'), `boot ${s} lost the locked panel`);
  }
});

test("the lock list is the three vault decks and NOTHING personal", () => {
  const html = bootBody({ s: 403, j: { portfolioValues: false } });
  const m = html.match(/var VAULT_DECKS=\[([\s\S]*?)\];/);
  assert.ok(m, "VAULT_DECKS moved or was renamed — the per-deck gate's one list");
  const ids = m[1].match(/"[^"]+"/g).map((s) => s.replace(/"/g, ""));

  // Every gated surface is named. A missing one leaves a comps table or a BOV
  // log on screen for somebody with no subscription.
  for (const id of GATED) {
    assert.ok(ids.includes(id), `${id} is not locked — a Pro surface would render for a free member`);
  }
  // And the personal ones are NOT, which is the whole point of the slice.
  for (const id of PERSONAL) {
    assert.ok(!ids.includes(id),
      `${id} is in the lock list — a member's own portfolio/watchlist is not part of Pro`);
  }
});

test("401 is the only whole-page gate left", () => {
  const html = bootBody({ s: 403, j: { portfolioValues: false } });
  const script = html.match(/<script>([\s\S]*?)<\/script>\s*$/)[1];
  const apply = script.slice(script.indexOf("function apply(o)"),
    script.indexOf("function apply(o)") + 2000);
  // Signed out means there is no portfolio and no watchlist either, so the
  // page-wide gate is still right there and nowhere else.
  assert.match(apply, /o\.s===401\) return gate\(/, "the signed-out gate must stay");
  assert.ok(!/o\.s===403\) return gate\(/.test(apply),
    "403 must lock decks, not the page");
  assert.ok(!/o\.s!==200\) return gate\(/.test(apply),
    "a non-200 must lock decks, not the page");
  assert.match(apply, /o\.s===403\) return lockVaultDecks/, "403 goes to the deck lock");
  assert.match(apply, /o\.s!==200\) return lockVaultDecks/, "so does every other refusal");
});

test("a property row navigates, because this page cannot render a report", () => {
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  // The whole report engine lives in index.html. A row that opened one in
  // place would do nothing at all, which is worse than a row that navigates.
  assert.ok(html.includes('"/?property="+encodeURIComponent(item.id)'),
    "the address must link to /?property=<id>");
  assert.ok(html.includes('href="\'+escA(href+"&refresh=1")'),
    "Refresh must be the same door with refresh=1 — replaying a search needs the real form");
});

test("the free portfolio is an address list, with no figure anywhere on it", () => {
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  // Every figure on this deck -- the strip, the value column, the change
  // column, the footer total and the market-movement line -- is a dollar
  // figure, and Free My Desk is an address list. One flag, read from the boot
  // payload, guards all five.
  assert.match(html, /showValues=Boolean\(o\.j&&o\.j\.portfolioValues\)/,
    "showValues must come from the boot payload");
  assert.ok(html.includes("if(showValues&&item.movement&&item.movement.line)"),
    "the market-movement line is a dollar figure and must be gated too");
  assert.ok(html.includes("var showAttn=showValues&&staleN>0"),
    "the stale-value warning must not fire on a desk that shows no values");
});

test("a failed read renders as a failure, never as an empty portfolio", () => {
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  // The desk's own scar: "Nothing here yet" shown to somebody with sixteen
  // properties reads as their book having been thrown away. Two elements, and
  // the failure path must return before it can touch the count or the rows.
  assert.ok(html.includes('id="propsErr"') && html.includes('id="propsEmpty"'),
    "the two empty states must stay two elements");
  assert.match(html, /Nothing has been lost/,
    "the failure copy must say nothing was lost — an outage is not an absence");
  const fail = html.indexOf("if(!propsOk){");
  const rows = html.indexOf('$("propsRows").innerHTML');
  const ret = html.indexOf("return;", fail);
  assert.ok(fail > -1 && rows > -1, "the failure branch or the row builder moved");
  assert.ok(ret > fail && ret < rows,
    "the failed read must return before anything writes rows, a count or a strip");
});

test("no heading collides with the two market-ish ones this page already had", () => {
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  // #rollupSec's h2 "Your markets" is where this broker's COMPS are, and
  // #covBox's summary "Markets you watch" is where they want LEADS from. Both
  // predate the watchlist. A third called either would put two identical
  // headings on one screen meaning different things.
  const labels = [...html.matchAll(/<span class="dlab">([^<]+)</g)].map((m) => m[1]);
  assert.equal(new Set(labels).size, labels.length, `duplicate deck labels: ${labels}`);
  assert.ok(labels.includes("Your watchlist"), "the watchlist deck lost its name");
  assert.ok(!labels.includes("Your markets"),
    "'Your markets' is #rollupSec's h2 — a deck by that name is a collision");
});

// ---------------------------------------------------------------------------
// Rules that came WITH the portfolio from /desk on 2026-09-01. Each was earned
// on the workspace and pinned in test/index-html.test.js; the surface moved,
// so these moved with it rather than lapsing. See that file's retirement note
// for the ones that genuinely died with the desk's reading strip.
// ---------------------------------------------------------------------------

test("the empty copy names the way properties actually get there", () => {
  // The premise of this reversed on 2026-08-31 and the reversal is the point.
  // It used to assert the copy did NOT mention Save, because every signed-in
  // search auto-saved itself and naming a button that had already fired was
  // the bug. The portfolio is opt-in now -- it holds what a member says they
  // OWN -- so Save IS the mechanism. "Run a report and it will show up here"
  // became untrue the same day, which is why it is pinned as FORBIDDEN rather
  // than dropped: it reads perfectly well and would promise the old behaviour.
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  assert.doesNotMatch(html, /Run a report and it will show up here/,
    "a report does not land in the portfolio by itself");
  const m = html.match(/id="propsEmpty"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, "#propsEmpty must exist");
  const copy = m[1];
  assert.match(copy, /Save to portfolio/, "it has to name the control that does it");
  assert.match(copy, /recent searches/i, "and the other door, for a report already run");
  // Owner's standing copy rule (2026-08-22): no em dashes in copy.
  assert.ok(!copy.includes("\u2014") && !copy.includes("&mdash;"), "no em dashes in copy");
});

test("the between-checks cell names its sample and cannot read as a return", () => {
  // "Since last checks" read as a portfolio return, and the figure is not one:
  // it compares each property's last two check-ins, over only the properties
  // checked at least twice, with no time window at all. The arithmetic stays;
  // the caption must not over-claim.
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  assert.ok(html.includes('stripCell("Between checks"'), "the cell is labelled Between checks");
  assert.ok(html.includes("last check vs the one before"), "the note names the basis");
  assert.ok(html.includes('pairedN+" of "+items.length+" properties"'),
    "the note names its sample");
  assert.ok(html.includes("not a return over any period of time"),
    "the title says outright what the figure is not");
  assert.ok(!html.includes('stripCell("Since last checks"'),
    "the return-shaped label must not come back");
  // One figure, computed once: the same bookPct feeds the strip cell and the
  // table's footer, so the two can never disagree.
  assert.ok((html.match(/bookPct/g) || []).length >= 4, "bookPct must feed both surfaces");
});

test("the attention line says nothing when nothing is waiting", () => {
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  // It ships hidden. A standing "you're all caught up" banner is the vault's
  // own 0-0 scoreboard lesson.
  assert.match(html, /id="propsAttn" class="note hide"|class="note hide" id="propsAttn"/,
    "it ships hidden");
  assert.ok(html.includes("var showAttn=showValues&&staleN>0"),
    "shown only when something is actually stale, and never on a values-free desk");
  assert.ok(html.includes("1 property was last checked over a year ago"), "singular copy");
  assert.ok(html.includes("properties were last checked over a year ago"), "plural copy");
  // textContent only: this states a fact about somebody's own properties and
  // never interpolates one of their addresses.
  assert.ok(!/propsAttn[\s\S]{0,300}innerHTML/.test(html), "textContent only");
});

test("stale is a year, and it is not a number invented here", () => {
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  assert.ok(html.includes("var STALE_MS=365*24*60*60*1000"), "one year");
  // portfolio-delta.js already draws this line and says why: past a year a
  // window "stops being 'since you last looked' and becomes market history".
  // It is a server module and cannot be required from a browser script, so the
  // mirror is marked -- the treatment compWeight and SHOP_COPY get.
  assert.ok(html.includes("portfolio-delta.js"), "the source of the threshold is named");
  assert.ok(html.includes("MIRRORED CONSTANT"), "the duplication is flagged, not silent");
  const delta = fs.readFileSync(path.join(__dirname, "..", "portfolio-delta.js"), "utf8");
  assert.match(delta, /MAX_WINDOW_YEARS = 1/, "the constant this mirrors still says a year");
});

test("the checked date and the attention line count the same fact", () => {
  // The table said "checked {updated_at}" -- when the ROW was last written by
  // anything -- while the line counts the last time a VALUE was produced. Two
  // dates for one word, thirty pixels apart, contradicted each other on screen
  // (caught in a browser against an aged store, not by reading).
  const html = bootBody({ s: 200, j: { portfolioValues: true } });
  assert.ok(html.includes("var lastTs=last&&last.ts?last.ts:item.updated_at"),
    "the row reads the last snapshot, falling back only when there is none");
  assert.ok(!html.includes("checked \"+esc(new Date(item.updated_at)"),
    "the row must not go back to the row-written date");
  assert.ok(html.includes("var ts=last&&last.ts?Date.parse(last.ts):NaN"),
    "the count reads the same field");
});

// ---------------------------------------------------------------------------
// The seam that matters, against a real server: a free member must reach their
// own portfolio, and be told what they cannot reach.
// ---------------------------------------------------------------------------
function tables({ pro }) {
  return {
    users: [{ id: "u1", email: "m@example.com", vault_beta: pro, pro_tester: pro }],
    sessions: [{ id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
      expires_at: new Date(Date.now() + 30 * DAY).toISOString() }],
    broker_comps: [], broker_uploads: [], broker_profiles: [], org_members: [],
    portfolio_items: [{ id: "11111111-1111-4111-8111-111111111111", user_id: "u1",
      address: "1210 N 17th St, Boise, ID 83702", property_type: "Industrial",
      snapshots: [], created_at: new Date().toISOString(),
      updated_at: new Date().toISOString() }],
    watchlist_items: [], comp_corpus: [], analytics_events: [],
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

test("a free member's vault refuses the book but still carries portfolioValues", async () => {
  await withServer(false, async (srv) => {
    const r = await fetch(srv.base + "/api/vault", {
      headers: { cookie: `cn_session=${TOKEN}` },
    });
    assert.equal(r.status, 403, "the vault's own read still refuses a free member");
    const j = await r.json();
    assert.equal(j.code, "broker_required");
    // The personal decks need exactly one fact and there is no other payload
    // on this path to carry it. Without it the portfolio would render as an
    // address list for a Pro member, or as values for a free one.
    assert.equal(typeof j.portfolioValues, "boolean",
      "the 403 body must still tell the personal decks which desk this is");
    assert.equal(j.portfolioValues, false, "a free desk is an address list");
  });
});

test("a Pro member's vault opens and says the same thing", async () => {
  await withServer(true, async (srv) => {
    const r = await fetch(srv.base + "/api/vault", {
      headers: { cookie: `cn_session=${TOKEN}` },
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.portfolioValues, true, "a Pro desk is the book of values");
  });
});

test("the vault page answers 200 to a free member, book locked and decks intact", async () => {
  await withServer(false, async (srv) => {
    const r = await fetch(srv.base + "/vault", {
      headers: { cookie: `cn_session=${TOKEN}` },
    });
    // 200 HTML always -- the page renders its own refusal, which is what makes
    // it exempt from ACCOUNT_WALL and what lets the personal decks through.
    assert.equal(r.status, 200);
    const html = await r.text();
    for (const id of PERSONAL) {
      assert.ok(html.includes(`id="${id}"`),
        `a free member's page lost #${id} — their own portfolio must render`);
    }
    assert.ok(html.includes('"portfolioValues":false'),
      "the boot payload must carry the free answer");
    assert.ok(html.includes('id="vaultLocked"'), "and the refusal it will show instead");
  });
});

test("the vault link is a nav row for a free member, not just for Pro", async () => {
  await withServer(false, async (srv) => {
    const html = await (await fetch(srv.base + "/vault", {
      headers: { cookie: `cn_session=${TOKEN}` },
    })).text();
    // Their portfolio lives behind this link now. Gated on canUseVault it
    // would be reachable by typing the URL and no other way -- the per-deck
    // gate's own failure, moved into the navigation.
    assert.ok(html.includes('id="navVault"'), "the rail lost its vault row");
    assert.ok(html.includes(`show($("navVault"),true)`),
      "the vault row must open to every signed-in member");
    assert.ok(!html.includes(`show($("navVault"),Boolean(pro.canUseVault))`),
      "and must not go back to being gated on the entitlement");
  });
});
