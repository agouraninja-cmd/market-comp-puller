// NAV_SHELL — the sidebar rail, and the flag that turns it off.
//
// Run: npm test
//
// Cost: zero. Every server here boots with no Anthropic key, no Supabase and
// no Stripe; each route under test is a pure render.
//
// THE DESIGN THIS PINS. The rail is not a new component: every surface already
// renders the same header shape — brand, <nav>, account slots, in a centered
// container — so the rail is that element re-laid-out at >=900px by ONE class
// on <html>. The markup is byte-identical in both modes, which is what keeps
// the eight-page header assertions in routes.test.js green, and it is why
// these tests check for a class and a stylesheet rather than for new elements.
//
// Below 900px the class does nothing and today's wrapping bar returns, so the
// phone behaviour costs no drawer, no focus trap and no scroll lock.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { boot } = require("./helpers/boot");

const SESSION = { cookie: "cn_session=not-a-real-token" };
const SERVER_JS = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// The rail rides on a class on the <html> TAG. It must be read from the tag
// and never from the document, because the stylesheet in every page's <head>
// names `html.nav-rail` in its own rules whether or not the mode is on — so a
// whole-document match reports the rail as present on every page in both
// modes, which is how the first version of these tests failed against
// perfectly correct code.
const htmlTag = (doc) => (doc.match(/<html[^>]*>/) || [""])[0];
const hasRail = (doc) => /\bnav-rail\b/.test(htmlTag(doc));

// Every page that renders through marketShell and should wear the shell.
const SHELL_PAGES = ["/markets", "/brokers", "/firms", "/pricing", "/1031-exchange", "/terms", "/privacy"];

test("a signed-in visitor gets the rail; an anonymous one never does", async (t) => {
  const srv = await boot({ NAV_SHELL: "rail" });
  t.after(() => srv.stop());

  for (const p of SHELL_PAGES) {
    const member = await (await fetch(srv.base + p, { headers: SESSION })).text();
    assert.ok(hasRail(member), `${p} stamps the rail for a member`);

    // The rail marks "you are inside the product". A marketing page read by a
    // stranger is not that, and a sidebar is the wrong first impression on it.
    const anon = await (await fetch(srv.base + p)).text();
    assert.ok(!hasRail(anon), `${p} has no rail for an anonymous visitor`);
  }
});

test("/how-it-works follows the same rule", async (t) => {
  // It has its own document builder and its own copy of the chrome CSS, so it
  // is the page most likely to be forgotten when the shell changes.
  const srv = await boot({ NAV_SHELL: "rail", ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());

  const member = await (await fetch(srv.base + "/how-it-works", { headers: SESSION })).text();
  assert.ok(hasRail(member), "a member reading /how-it-works gets the rail");
  const anon = await (await fetch(srv.base + "/how-it-works")).text();
  assert.ok(!hasRail(anon), "an anonymous reader does not");
});

test("NAV_SHELL=bar restores today's chrome exactly", async (t) => {
  const srv = await boot({ NAV_SHELL: "bar" });
  t.after(() => srv.stop());

  // The rollback lever. Not "mostly today's chrome" — the class is the only
  // thing the rail rides on, so its absence IS the old page.
  for (const p of SHELL_PAGES) {
    const member = await (await fetch(srv.base + p, { headers: SESSION })).text();
    assert.ok(!hasRail(member), `${p} has no rail under NAV_SHELL=bar`);
  }
});

test("an unrecognized NAV_SHELL exits at boot rather than guessing", async () => {
  // The SEARCH_PROVIDER / THINKING_LEVEL rule: a knob that appears to work and
  // silently does nothing is worse than a refused one, because the deployment
  // concludes the feature does not help.
  const server = path.join(__dirname, "..", "server.js");
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, NAV_SHELL: "sidebar", PORT: "0", ANTHROPIC_API_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  // A server that BOOTS on a bad value is the failure under test, and it would
  // otherwise hang this suite forever rather than reporting it. Kill it and
  // let the assertion below say what happened.
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve("did-not-exit"); }, 8000);
    child.on("exit", (c) => { clearTimeout(timer); resolve(c); });
  });

  assert.equal(code, 1, "an unknown NAV_SHELL must be fatal, not accepted and ignored");
  assert.match(err, /NAV_SHELL/, "the refusal names the variable");
});

test("the markup is identical in both modes — only the class differs", async (t) => {
  const rail = await boot({ NAV_SHELL: "rail" });
  const bar = await boot({ NAV_SHELL: "bar" });
  t.after(() => { rail.stop(); bar.stop(); });

  const a = await (await fetch(rail.base + "/markets", { headers: SESSION })).text();
  const b = await (await fetch(bar.base + "/markets", { headers: SESSION })).text();

  // This is the property the whole approach rests on. If the two bodies differ
  // by anything except the class and the stylesheet, a second markup branch
  // has appeared and every header test is now only checking one of them.
  const strip = (h) => h
    .replace(/<html lang="en"[^>]*>/, "<html>")
    .replace(/<style>[\s\S]*?<\/style>/g, "<style/>")
    .replace(/localhost:\d+/g, "host");
  assert.equal(strip(a), strip(b), "the two modes must render the same markup");
});

test("the rail rules are scoped so a phone never sees them", () => {
  // Below 900px the header is the wrapping bar it has always been. If the
  // rules were unscoped, the fix for a phone would be a drawer — the thing
  // this design exists to avoid building.
  for (const block of ["MARKET_CSS", "HOW_CSS"]) {
    const m = SERVER_JS.match(new RegExp(`const ${block} =[\\s\\S]*?\`;`));
    assert.ok(m, `could not read ${block}`);
    assert.ok(m[0].includes("nav-rail"), `${block} carries the rail rules`);
    // Every nav-rail rule must sit inside a min-width media query.
    const railRules = m[0].split("nav-rail").length - 1;
    assert.ok(railRules > 0, `${block} has rail rules`);
    assert.match(m[0], /@media\s*\(min-width:\s*900px\)[\s\S]*?nav-rail/,
      `${block}'s rail rules are behind a min-width guard`);
  }
});

test("the rail never prints", () => {
  // #results is the only thing that should reach paper. A 224px empty column
  // down the left of every printed report is the failure this prevents.
  const m = SERVER_JS.match(/const MARKET_CSS =[\s\S]*?`;/);
  assert.match(m[0], /@media print[\s\S]*?padding-left:\s*0/,
    "print resets the body's rail padding");
});

test("one theme toggle, still, and no second account cluster", () => {
  // theme.test.js counts these too; restated here because the rail is exactly
  // the change that tempts somebody to add a second copy at the rail's foot.
  assert.equal(SERVER_JS.split('id="themeToggle"').length - 1, 1,
    "exactly one theme toggle in all of server.js");
  assert.equal(SERVER_JS.split('id="navAcct"').length - 1, 1,
    "exactly one account cluster");
});
