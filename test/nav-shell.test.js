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

test("the app gets the same shell, from the same class", async (t) => {
  const srv = await boot({ NAV_SHELL: "rail", ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());

  // index.html is served as one set of bytes to everybody and corrected after
  // paint, so the rail rides authBoot's before-paint class exactly as cn-in
  // does — otherwise a member would see the bar for a frame and then the rail.
  const member = await (await fetch(srv.base + "/", { headers: SESSION })).text();
  assert.match(member, /classList\.className\+=|className\+=/, "authBoot stamps classes");
  const boot1 = member.match(/document\.documentElement\.className\+=("[^"]*")/);
  assert.ok(boot1, "could not find the boot class assignment");
  assert.match(boot1[1], /nav-rail/, "a member's app is stamped for the rail");

  const anon = await (await fetch(srv.base + "/")).text();
  const boot2 = anon.match(/document\.documentElement\.className\+=("[^"]*")/);
  assert.ok(!boot2 || !/nav-rail/.test(boot2[1]), "an anonymous app is not");
});

test("the app's rail survives the hint being retired", () => {
  // refreshAccountUI drops cn-in / cn-locked once the real answer lands: those
  // are stand-ins for something the page was waiting on. nav-rail is not — it
  // is a layout choice — so it must NOT be in that list, or the sidebar would
  // vanish a beat after the account resolves.
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/classList\.remove\(([^)]*)\)/g) || [];
  for (const call of m) {
    assert.ok(!call.includes("nav-rail"),
      `nav-rail must not be retired by ${call}`);
  }
  // And the rules it drives have to actually exist in the app's stylesheet.
  assert.match(html, /html\.nav-rail body\s*\{[^}]*padding-left:\s*224px/,
    "the app pads the body for the rail");
  assert.match(html, /@media print\s*\{\s*html\.nav-rail body\s*\{\s*padding-left:\s*0/,
    "and takes that padding off on paper");
});

test("home is the workspace for a member, and the search desk comes with it", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  // The reorganization in one line: "/" opens the workspace for a signed-in
  // visitor. It is only safe because showDeskView keeps the search desk —
  // landing on a home page with no address field would be worse than the page
  // it replaced, so these two facts are asserted together, deliberately.
  assert.match(
    html,
    /location\.pathname === "\/" && looksSignedIn\(\)/,
    'boot opens the workspace at "/" for a member',
  );
  assert.match(
    html,
    /showDeskView[\s\S]{0,900}?getElementById\("searchSection"\)\.classList\.remove\("hidden"\)/,
    "showDeskView leaves the search desk visible",
  );

  // Read from the boot hint, not currentUser: this runs before the account
  // bootstrap resolves, so currentUser is still null and every member would
  // get the marketing stack for a beat.
  assert.doesNotMatch(
    html,
    /location\.pathname === "\/" && currentUser\b/,
    "the boot decision must not read currentUser",
  );

  // A shared report is somebody else's link and must never open the reader's
  // own desk.
  assert.match(html, /_sharedPath[\s\S]{0,200}showDeskView/,
    "/r/<id> is excluded from the workspace-at-root rule");
});

test("/desk is kept alive rather than redirected", () => {
  // It is linked from Stripe checkout returns WITH a query string, the
  // watchlist digest, org invite emails and /bulk. A 302 to "/" would drop the
  // query and dead-end those, which is why home became the workspace by
  // opening the same view rather than by moving the URL.
  assert.match(SERVER_JS, /staticPath === "\/desk"/, "/desk still serves the app");
  const stillLinked = ['href="/desk"'];
  for (const s of stillLinked) {
    assert.ok(SERVER_JS.includes(s), `${s} is still a working link`);
  }
});

test("one theme toggle, still, and no second account cluster", () => {
  // theme.test.js counts these too; restated here because the rail is exactly
  // the change that tempts somebody to add a second copy at the rail's foot.
  assert.equal(SERVER_JS.split('id="themeToggle"').length - 1, 1,
    "exactly one theme toggle in all of server.js");
  assert.equal(SERVER_JS.split('id="navAcct"').length - 1, 1,
    "exactly one account cluster");
});

test("the rail hides Explore without taking the account cluster with it", () => {
  // #navAcct is a <details> TOO, so a bare `nav>details{display:none}` matched
  // both. That took the email, Upgrade to Pro, Manage billing and Sign out off
  // EVERY server-rendered page in rail mode: there was no way to sign out of
  // /markets, /brokers, /pricing, /bulk or a market page without navigating
  // back to the app first. No existing test saw it, because the MARKUP stayed
  // correct — only the computed style was wrong, which is the failure mode a
  // byte-identical-markup design is most exposed to.
  const hides = SERVER_JS.match(/html\.nav-rail \.hdr nav>details[^{]*\{display:none\}/g) || [];
  assert.equal(hides.length, 2,
    "MARKET_CSS and HOW_CSS are twins by design; both carry this rule or the two front doors drift");
  for (const rule of hides) {
    assert.ok(rule.includes(":not(#navAcct)"),
      `the Explore hide must spare the account cluster, got: ${rule}`);
  }
  // The rules that lay #navAcct out FOR the rail are what prove it was always
  // meant to show. If they ever go, this test would start passing for the
  // wrong reason, so it fails instead.
  assert.match(SERVER_JS, /html\.nav-rail \.hdr nav>#navAcct\{margin-top:auto/,
    "the account cluster is still pinned to the foot of the rail");
  assert.match(SERVER_JS, /html\.nav-rail \.hdr nav>#navAcct \.dd\{/,
    "its menu still opens upward, which it only needs to do if it renders");
});

test("the app re-decides the rail when identity changes in place", () => {
  // The account modal signs somebody in WITHOUT reloading the page, so a class
  // stamped only at serve time cannot follow them. Owner-reported: the app
  // kept the top bar after signing in and only switched to the rail on the
  // next click, because that click was the first server-rendered navigation.
  const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const fn = INDEX.slice(INDEX.indexOf("function refreshAccountUI()"));
  const body = fn.slice(0, fn.indexOf("\n  }\n"));
  assert.match(body, /classList\.toggle\("nav-rail", on\)/,
    "refreshAccountUI is the one function that runs after /api/account/me on every path, "
    + "which is why the shell is re-decided there rather than at each call site");

  // Toggled, never merely added. The sign-OUT direction is the half the rail's
  // own rule makes mandatory: anonymous visitors never get the rail, and
  // doSignOut does not reload either.
  assert.ok(!/classList\.add\("nav-rail"\)/.test(INDEX),
    "a one-way add would leave the product's sidebar standing for a signed-out visitor");

  // ...and the client must not undo the rollback lever. NAV_SHELL=bar means
  // bar everywhere, including on the one page that decides this after paint.
  assert.match(body, /if \(navRailMode\)/,
    "NAV_SHELL=bar must survive a client-side re-decide");
  assert.match(SERVER_JS, /rail: Boolean\(NAV_SHELL_CLASS\)/,
    "the deployment's shell choice has to reach the page for that guard to mean anything");
});
