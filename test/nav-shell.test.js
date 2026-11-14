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
// Below 900px the rail's rules do nothing. Until 2026-11-13 the wrapping bar
// of words returned there; since then the same class lays the same nav along
// the bottom of the screen (RAIL_CSS's phone bar), which still costs no
// drawer, no focus trap and no scroll lock.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { boot } = require("./helpers/boot");

const SESSION = { cookie: "cn_session=not-a-real-token" };
const SERVER_JS = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
// The vault draws its own document, so it is the surface most easily left
// behind when the shell changes — which is exactly what happened: it wore the
// top bar while every other signed-in page had moved to the rail.
const VAULT_JS = fs.readFileSync(path.join(__dirname, "..", "vault-page.js"), "utf8");

// The rail rides on a class on the <html> TAG. It must be read from the tag
// and never from the document, because the stylesheet in every page's <head>
// names `html.nav-rail` in its own rules whether or not the mode is on — so a
// whole-document match reports the rail as present on every page in both
// modes, which is how the first version of these tests failed against
// perfectly correct code.
const htmlTag = (doc) => (doc.match(/<html[^>]*>/) || [""])[0];
const hasRail = (doc) => /\bnav-rail\b/.test(htmlTag(doc));

// Every page that renders through marketShell and should wear the shell.
const SHELL_PAGES = ["/markets", "/brokers-firms", "/pricing", "/terms", "/privacy"];

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

// The rail's rules live in ONE const now (RAIL_CSS) with three consumers, so
// these read the definition rather than each stylesheet. What still has to be
// pinned per consumer is that each one actually interpolates it — a stylesheet
// that quietly stopped would lose the rail with nothing else looking wrong.
const railBlock = () => {
  const m = SERVER_JS.match(/const RAIL_CSS = `[\s\S]*?\n`;/);
  assert.ok(m, "could not read RAIL_CSS");
  return m[0];
};

test("the rail rules are scoped so a phone never sees them", () => {
  // Below 900px the rail's own rules do nothing. If they were unscoped, the
  // fix for a phone would be a drawer — the thing this design exists to
  // avoid building. (Since 2026-11-13 a phone has rules of its own, the phone
  // bar: the same nav along the bottom edge, in its own max-width block,
  // checked further down.)
  const css = railBlock();
  assert.ok(css.includes("nav-rail"), "RAIL_CSS carries the rail rules");
  assert.match(css, /@media\s*\(min-width:\s*900px\)[\s\S]*?nav-rail/,
    "the rail rules are behind a min-width guard");

  // Every nav-rail rule sits inside a min-width or print guard. Counted rather
  // than eyeballed, because one rule added below the closing brace is exactly
  // the edit that would put a 224px sidebar on a phone.
  const guarded = css.slice(css.indexOf("@media"));
  assert.equal(css.split("nav-rail").length - 1, guarded.split("nav-rail").length - 1,
    "a nav-rail rule was added before the first @media guard");
});

test("a phone gets the nav along the bottom, on screen only, and nothing rides under it", () => {
  // The phone bar (2026-11-13). Three things a tidy-up would undo with every
  // other suite green.
  const css = railBlock().replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = css.match(/@media screen and \(max-width:899px\)\{[\s\S]*?\n\}/g) || [];
  assert.equal(blocks.length, 1, "RAIL_CSS has exactly one phone block");
  const phone = blocks[0];
  // 1. screen only. A printed page is about 800px wide, which a bare
  //    max-width query calls a phone: the bar would be fixed to the foot of
  //    every sheet of a printed market page.
  assert.ok(!/@media \(max-width:\s*899px\)/.test(css), "the phone bar's query lost `screen`, so it prints");
  // 2. It meets the rail with no gap and no overlap: the rail starts at 900.
  assert.match(css, /@media \(min-width:900px\)\{\s*html\.nav-rail body\{padding-left:84px\}/);
  // 3. The nav is fixed to the bottom, and the body is padded by exactly the
  //    bar's height, so a page's last line clears it: 4 + 46 + 4.
  assert.match(phone, /html\.nav-rail \.hdr nav\{position:fixed;left:0;right:0;bottom:0;/);
  assert.match(phone, /html\.nav-rail body\{padding-bottom:calc\(54px \+ env\(safe-area-inset-bottom,0px\)\)\}/);
  assert.match(phone, /padding:4px 4px calc\(4px \+ env\(safe-area-inset-bottom,0px\)\)/);
  const row = phone.match(/html\.nav-rail \.hdr nav>a\{([^}]*)\}/)[1];
  assert.match(row, /padding:5px 2px 4px/);
  assert.match(row, /line-height:13px/);
  assert.match(phone, /html\.nav-rail \.hdr nav>a \.nvi\{display:block;width:24px;height:24px\}/);
  // 5 + 24 (icon) + 13 (word) + 4 = 46, and 4 + 46 + 4 = 54.
  // The two things that stand ON the bar say the same 54, plus 12 of air.
  const stands = /bottom:calc\(66px \+ env\(safe-area-inset-bottom,0px\)\)/;
  const badge = SERVER_JS.match(/const TESTER_BADGE_CSS = `[\s\S]*?\n`;/)[0];
  assert.match(badge, /@media screen and \(max-width:899px\)\{\s*html\.nav-rail \.tninja\{bottom:calc\(66px/,
    "the Feedback button no longer stands on the phone bar, so it covers the bar's last two places");
  assert.match(badge, stands);
  assert.match(VAULT_JS, /@media screen and \(max-width:899px\)\{\s*html\.nav-rail \.vd-tray\.on\{bottom:calc\(66px/,
    "/comps' selection tray no longer stands on the phone bar, so it sticks behind it");
  // And it stops short of the floating Feedback button in the same corner
  // (16px from the right, 44px wide): 44 + 12, in that same phone block.
  assert.match(badge, /\.tninja\{position:fixed;bottom:16px;right:16px;z-index:1000;width:44px;height:44px;/);
  assert.match(VAULT_JS, /@media screen and \(max-width:899px\)\{[^@]*\n  \.vd-tray\.on\{margin-right:56px\}\n\}/,
    "/comps' selection tray runs under the Feedback button again on a phone");
  // The page you are on is a border (forced colours keep it), as in the rail.
  assert.match(phone, /nav>a\[aria-current="page"\]::before\{[^}]*border-top:3px solid var\(--red\)/);
  // Above a map's controls (Leaflet's are 1000) and the Feedback button,
  // under the modals (1200).
  assert.match(phone, /html\.nav-rail \.hdr nav\{[^}]*z-index:1050/);
});

test("a stranger's phone header is two rows: the button beside the brand, Log in under it", () => {
  // 2026-11-14. Under about 407px the signed-out bar was three rows (brand;
  // Home, Explore, Tools, Log in; the red button alone), 138px before the
  // page began. The button is now placed beside the brand and Log in is
  // pushed to the right end of the links' row. All of it is four
  // declarations a tidy-up could drop with every other suite green.
  // The literal ends at its first "`;" (it closes on an interpolation, not
  // on a line of its own).
  const raw = SERVER_JS.match(/const MARKET_CSS = `[\s\S]*?`;/)[0];
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = css.match(/@media \(max-width:559\.98px\)\{([\s\S]*?)\n\}/);
  assert.ok(m, "MARKET_CSS lost the signed-out phone header block");
  const block = m[1];
  assert.match(block, /\.hdr nav>a\.btn\.sm\[href\$="=signup"\]\{position:absolute;top:11px;right:16px\}/,
    "the red button no longer stands beside the brand");
  assert.match(block, /\.hdr nav>a\[href\$="=signin"\]\{margin-left:auto\}/,
    "Log in no longer sits at the right end of the links' row");
  // The selectors name the END of each address, never the whole of it: this
  // stylesheet is sent to members too, and public-pages, pricing-page and
  // brokers-firms-page all refuse a member's page with either address in it.
  // (Read with its comments: they are served too.)
  assert.ok(!/auth=sign(in|up)/.test(raw),
    "MARKET_CSS spells out a signed-out address, which a member's page then contains");
  // Without this the links fit beside the brand from about 420px and run
  // under the placed button.
  assert.match(block, /\.hdr nav\{flex:1 1 100%\}/, "the nav no longer takes the whole second row");
  // 11px is the top padding plus half the brand less half the button.
  assert.match(block, /\.hdr \.wrap\{padding-top:14px;padding-bottom:12px\}/);
  // The button is placed against .wrap, which is the positioned box on a
  // phone because of the menus' rule, at a wider breakpoint than this one.
  assert.match(css, /@media \(max-width:639\.98px\)\{\s*\.hdr \.wrap\{position:relative\}/);
  // The two selectors name addresses marketBar really writes; a renamed
  // route would leave the rules matching nothing and the third row back.
  assert.ok(SERVER_JS.includes('`<a href="/?auth=signin">Log in</a><a class="btn sm" href="/?auth=signup">Create account</a>`'),
    "marketBar's signed-out links changed; the phone header's selectors must follow");
  // Nothing is hidden (Home stays, the owner's call), and a member's bar is
  // not touched: its rules are RAIL_CSS's, and nav-parity.test.js refuses
  // rail chrome styled anywhere else.
  assert.ok(!/display:none/.test(block), "the signed-out phone header hides something");
  assert.ok(!block.includes("nav-rail"), "the signed-out phone header names the member's shell");
});

test("the app page hides the four member places from a signed-out phone visitor, and from nobody else", () => {
  // 2026-11-14, the owner's call ("yes hide them"). Signed out, index.html
  // (the sign-up page, a shared report) showed eight links that no layout
  // fits on one line of a phone, so its bar was three rows.
  const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const style = INDEX.slice(0, INDEX.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const at = style.indexOf("@media (max-width: 639.98px) {\n      html:not(.cn-in)");
  assert.ok(at > -1, "index.html lost the signed-out phone header block");
  const block = style.slice(at, style.indexOf("\n    }", at));
  // Every rule in it asks three things: no cookie holder's boot class, no
  // member shell, and a Sign in button that is showing. Drop one and a
  // member's own bar loses its places (for good, or while the account read
  // is out).
  const SCOPE = "html:not(.cn-in):not(.nav-rail) .rd-appbar:has(> nav > #signInLink:not(.hidden))";
  const selectors = block.slice(block.indexOf("{") + 1).split("}").map((r) => r.split("{")[0]).join(",")
    .split(",").map((s) => s.trim()).filter(Boolean);
  assert.ok(selectors.length >= 8, "could not read the block's selectors");
  for (const sel of selectors) assert.ok(sel.startsWith(SCOPE), `a rule in the signed-out phone header is not scoped to a signed-out visitor: ${sel}`);
  // The four member places, by the ids and address the nav really carries.
  for (const [sel, markup] of [
    ["> nav > #navMessagesLink", '<a id="navMessagesLink" href="/messages"'],
    ["> nav > #navPipe", '<a id="navPipe" href="/pipeline"'],
    ["> nav > #navSites", '<a id="navSites" href="/sites"'],
    ["> nav > #navComps", '<a id="navComps" href="/comps"'],
    ['> nav > a[href="/permits"]', '<a href="/permits"'],
  ]) {
    assert.ok(selectors.includes(SCOPE + " " + sel), `the signed-out phone header no longer hides ${sel}`);
    assert.ok(INDEX.includes(markup), `index.html's nav no longer has ${markup}`);
  }
  // Home, Markets and Explore stay: they work without an account.
  assert.ok(!/#myDeskLink|\/markets|#exploreMenuWrap/.test(block), "the signed-out phone header hides a place a stranger can use");
  // What "signed out" is read from: refreshAccountUI hides the button for a
  // member, and authBoot stamps cn-in for a cookie holder before that.
  assert.match(INDEX, /getElementById\("signInLink"\)\.classList\.toggle\("hidden", on\)/);
  assert.match(SERVER_JS, /html\.cn-in #signInLink\{display:none!important\}/);
  // Sign in is placed beside the brand, with room for a thumb.
  assert.match(block, /#signInLink \{ position: absolute; top: 10px; right: 16px; padding: 8px 0;/);
});

test("both market stylesheets still take the rail, and the vault does too", () => {
  // The whole point of one definition is that consumers cannot drift apart.
  // The failure this catches is silent: a stylesheet that stops interpolating
  // RAIL_CSS renders a perfectly correct page with no sidebar on it.
  // ONE consumer since 2026-09-02: HOW_CSS was deleted with /how-it-works.
  // Still pinned as an exact count, because the failure this catches is a
  // stylesheet that QUIETLY stops interpolating it — and that is just as
  // possible with one consumer as with two.
  const uses = SERVER_JS.match(/\$\{RAIL_CSS\}/g) || [];
  assert.equal(uses.length, 1, "expected MARKET_CSS to interpolate RAIL_CSS");
  for (const block of ["MARKET_CSS"]) {
    const m = SERVER_JS.match(new RegExp(`const ${block} =[\\s\\S]*?\`;`));
    assert.ok(m, `could not read ${block}`);
    assert.ok(m[0].includes("${RAIL_CSS}"), `${block} no longer takes the rail`);
  }
  // vault-page.js used to take this same const through a chrome object,
  // because it drew its own stylesheet — which is what made two consumers
  // three. Task 9 (2026-08-30) retired that: it renders a body inside
  // marketShell, so the rail reaches it through MARKET_CSS like everything
  // else, and the count above is the whole story again. The served page is
  // checked for the rail further down this file, and in vault-shell.test.js.
  // Checked as a USE, not a mention: that file's header comment names the
  // twelve chrome keys it no longer takes, and the point of the comment is
  // that a future reader can see what was retired.
  assert.ok(!VAULT_JS.includes("chrome.RAIL_CSS") && !VAULT_JS.includes("${RAIL_CSS}"),
    "vault-page.js should get the rail from the shell, not through a chrome object");
});

test("the rail never prints", () => {
  // #results is the only thing that should reach paper. A 224px empty column
  // down the left of every printed report is the failure this prevents.
  assert.match(railBlock(), /@media print[\s\S]*?padding-left:\s*0/,
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
  // 84px since 2026-10-07: the rail is Draft C's strip of icons.
  assert.match(html, /html\.nav-rail body\s*\{[^}]*padding-left:\s*84px/,
    "the app pads the body for the rail");
  assert.match(html, /@media print\s*\{\s*html\.nav-rail body\s*\{\s*padding-left:\s*0/,
    "and takes that padding off on paper");
});

test("home is the workspace for a member, and the search desk comes with it", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  // The reorganization in one line: "/" opens the workspace for a signed-in
  // visitor. From 2026-08-28 to 2026-09-04 showDeskView kept the search desk
  // on the workspace, and this test held the two facts together. The owner
  // then took the chamber and the recent-searches deck OFF the workspace
  // (Bulk valuation is the comp-report tool), so the desk now HIDES the form
  // and the rail's Comp report row is the way to a report (the header's
  // #deskRunReport door came off on 2026-09-24). What survives here: the
  // boot rule, and that the desk view makes a decision about the form rather
  // than leaving whatever the previous view left showing.
  assert.match(
    html,
    /location\.pathname === "\/" && looksSignedIn\(\)/,
    'boot opens the workspace at "/" for a member',
  );
  assert.match(
    html,
    /function showDeskView\(\)[\s\S]{0,1400}?getElementById\("searchSection"\)\.classList\.add\("hidden"\)/,
    "showDeskView hides the search desk (2026-09-04)",
  );
  assert.doesNotMatch(
    html,
    /function showDeskView\(\)[\s\S]{0,1400}?getElementById\("searchSection"\)\.classList\.remove\("hidden"\)/,
    "the workspace must not reveal the chamber again",
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

test("no theme toggle in the chrome, and no second account cluster", () => {
  // theme.test.js counts these too; restated here because the rail is exactly
  // the change that tempts somebody to add a copy at the rail's foot. Zero
  // since 2026-08-30: the switch lives in index.html's settings panel, which
  // every page reaches through the account menu's Settings row.
  assert.equal(SERVER_JS.split('id="themeToggle"').length - 1, 0,
    "a theme toggle is back in server.js; the one control is in the settings panel");
  assert.equal(SERVER_JS.split('id="navAcct"').length - 1, 1,
    "exactly one account cluster");
});

test("the rail hides Explore without taking the account cluster with it", () => {
  // #navAcct is a <details> TOO, so a bare `nav>details{display:none}` matched
  // both. That took the email, Upgrade to Pro, Manage billing and Sign out off
  // EVERY server-rendered page in rail mode: there was no way to sign out of
  // /markets, /brokers-firms, /pricing, /bulk or a market page without navigating
  // back to the app first. No existing test saw it, because the MARKUP stayed
  // correct — only the computed style was wrong, which is the failure mode a
  // byte-identical-markup design is most exposed to.
  // Two since 2026-11-13: the rail's, and the phone bar's (the same nav along
  // the bottom of a phone, in RAIL_CSS's own max-width block). Both must
  // spare the account cluster, for the reason above: on a phone it is the
  // bar's last place, and the only way to Settings and Sign out.
  const hides = SERVER_JS.match(/html\.nav-rail \.hdr nav>details[^{]*\{display:none\}/g) || [];
  assert.equal(hides.length, 2,
    "the Explore hide is written once for the rail and once for the phone bar, both in RAIL_CSS; "
    + "another copy means the duplication came back");
  for (const hide of hides) {
    assert.ok(hide.includes(":not(#navAcct)"),
      `the Explore hide must spare the account cluster, got: ${hide}`);
  }
  assert.equal(railBlock().split("html.nav-rail .hdr nav>details").length - 1, 2,
    "both Explore hides live in RAIL_CSS");
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

test("/vault wears the rail too, and never for a stranger", async (t) => {
  // The vault was the last signed-in surface still wearing the top bar, which
  // is what made the chrome look like it changed at random: sign in, land on
  // the app, click Vault, and the sidebar vanished. It builds its own document
  // rather than going through marketShell, so nothing else here covered it.
  const srv = await boot({ NAV_SHELL: "rail" });
  t.after(() => srv.stop());

  const member = await (await fetch(srv.base + "/comps", { headers: SESSION })).text();
  assert.ok(hasRail(member), "/vault stamps the rail for a member");

  const anon = await (await fetch(srv.base + "/comps")).text();
  assert.ok(!hasRail(anon), "/vault has no rail for an anonymous visitor");

  // It varies on the cookie now, so it has to say so like every other page.
  const res = await fetch(srv.base + "/comps", { headers: SESSION });
  assert.match(String(res.headers.get("vary") || ""), /cookie/i,
    "/vault renders two different documents by cookie and must declare it");
});

test("NAV_SHELL=bar reaches the vault as well as everything else", async (t) => {
  // The rollback lever is only a lever if it covers every surface. A page that
  // keeps the rail after NAV_SHELL=bar is a page that cannot be rolled back.
  const srv = await boot({ NAV_SHELL: "bar" });
  t.after(() => srv.stop());
  for (const p of ["/comps", "/markets", "/"]) {
    const html = await (await fetch(srv.base + p, { headers: SESSION })).text();
    assert.ok(!hasRail(html), `${p} still wore the rail with NAV_SHELL=bar`);
  }
});
