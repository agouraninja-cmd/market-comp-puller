// The serve-time auth stand-in — index.html's first paint.
//
// Run: npm test
//
// Cost: zero. Nothing here calls Anthropic, Stripe or Supabase; every test is
// a GET of the app shell plus a few source scans.
//
// What it protects. index.html ships one set of bytes and corrects them from
// /api/config and /api/account/me, so before those land a signed-in member was
// looking at a signed-OUT app: "Sign in" in the header, and — in the frame
// where config had answered and the account read had not — the wall's "Create
// a free account" card standing where their search form should be. Measured
// 2026-08-23 on a scratch server with the account read delayed: wrong at 78ms,
// still wrong at 1170ms. It is a race, so it is worst when the database is
// slow, which is exactly when a member is least inclined to be charitable
// about it.
//
// authBoot() closes it by sending what the handler already knows. Two halves
// have to hold together, and this file pins both: the SERVER must stamp the
// right classes for the right visitor, and index.html must RETIRE them the
// moment the real answer lands. Only the second one makes `!important` safe —
// without it an expired session would leave the "Sign in" button hidden by a
// rule the JS cannot override, i.e. a member who cannot sign back in.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const SERVER_SRC = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// Presence is the whole rule, so the value need not be a real session — and
// deliberately is not one, which keeps this suite free of any account setup.
const FAKE_COOKIE = "cn_session=not-a-real-session";

// The classes are applied by the injected <script>; the <style> block names
// both of them in its selectors, so match the assignment, not the stylesheet.
function allBootClasses(html) {
  const m = html.match(/className\+="([^"]*)"/);
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
}

// Only the AUTH classes. This boot script stopped being auth's alone on
// 2026-08-28, when NAV_SHELL's `nav-rail` started riding the same vehicle —
// it needs the same before-paint timing, for the same reason (a sidebar drawn
// and then taken away is the flicker this whole mechanism exists to prevent).
// These tests are about what the page is told about the VISITOR, so they
// filter to `cn-` rather than pinning the whole list; otherwise every future
// use of the boot script breaks assertions that have nothing to do with it.
// The rail's own presence is asserted in test/nav-shell.test.js.
function bootClasses(html) {
  return allBootClasses(html).filter((c) => c.startsWith("cn-"));
}

// `rail` is a DEPLOYMENT fact (NAV_SHELL), not a per-visitor one, so it is
// true in every case below even where signedIn is false. index.html needs it
// because the app never reloads on sign-in: refreshAccountUI re-decides the
// nav-rail class from identity, and it must not re-add a class a NAV_SHELL=bar
// rollback deliberately withheld. The class itself is still signed-in only.
function bootData(html) {
  const m = html.match(/window\.CN_AUTH_BOOT=(\{[^}]*\})/);
  return m ? JSON.parse(m[1]) : null;
}

// --- index.html's side of the contract ------------------------------------

test("index.html carries the marker and retires what it is handed", () => {
  assert.ok(INDEX.includes("<!--AUTH_BOOT-->"),
    "the marker is how the boot block reaches the page; without it the app silently keeps the flash");

  // The retirement rule. refreshAccountUI() is the one function that runs
  // after /api/account/me on every path including the failed one, which is
  // why it is where the stand-in is dropped.
  const fn = INDEX.slice(INDEX.indexOf("function refreshAccountUI()"));
  const body = fn.slice(0, fn.indexOf("\n  }\n"));
  assert.match(body, /classList\.remove\("cn-in",\s*"cn-locked"\)/,
    "refreshAccountUI must drop both boot classes — they are !important, so a stand-in left "
    + "standing outranks the real answer and an expired session could not sign back in");
  assert.match(body, /authKnown\s*=\s*true/,
    "the cookie hint must stop being consulted once the real answer is in");
});

test("the search lock reads the hint, not currentUser alone", () => {
  // This is the half that fixes the big flash. applySearchLock() runs from
  // initGate(), i.e. as soon as /api/config lands — often before the account
  // read. Reading currentUser there answers "signed out" for a member and
  // swaps their search form for the signup card.
  const fn = INDEX.slice(INDEX.indexOf("function applySearchLock()"));
  const body = fn.slice(0, fn.indexOf("\n  }\n"));
  assert.match(body, /const locked = accountWall && !looksSignedIn\(\)/,
    "applySearchLock must go through looksSignedIn(), which falls back to the serve-time hint");

  // And the wall itself has to be seeded, or the same function runs once with
  // the wall off and once with it on — which is the flip that was seen.
  assert.match(INDEX, /let accountWall = Boolean\(AUTH_BOOT\.wall\)/,
    "accountWall is a server constant and must arrive with the page, not a fetch later");
});

test("every id the boot CSS hides is an id the page actually has", () => {
  // A renamed id fails silently and invisibly: the rule stops matching, the
  // flash comes back, and nothing errors anywhere.
  const start = SERVER_SRC.indexOf("const AUTH_BOOT_CSS =");
  assert.ok(start > -1, "AUTH_BOOT_CSS is gone");
  const css = SERVER_SRC.slice(start, SERVER_SRC.indexOf("const AUTH_BOOT_MARKER"));
  const ids = [...css.matchAll(/#([A-Za-z][\w-]*)\{/g)].map((m) => m[1]);
  assert.ok(ids.length >= 4, "expected the header pair and the search pair");
  for (const id of ids) {
    assert.ok(INDEX.includes(`id="${id}"`), `AUTH_BOOT_CSS styles #${id}, which index.html no longer has`);
  }
});

// --- the server's side ----------------------------------------------------

test("the wall up: the page is stamped for the visitor it is sent to", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("a session cookie gets the signed-in chrome at first paint", async () => {
    const html = await (await fetch(srv.base + "/", { headers: { cookie: FAKE_COOKIE } })).text();
    assert.deepEqual(bootClasses(html), ["cn-in"]);
    assert.deepEqual(bootData(html), { signedIn: true, wall: true, rail: true });
  });

  await t.test("an anonymous shared report gets the lock card, not a search form that vanishes", async () => {
    // /r/<id> and ?auth= are the only two doors the wall leaves open to the
    // app itself, so they are the only places an anonymous visitor can see
    // this file at all.
    const html = await (await fetch(srv.base + "/r/abcdef12")).text();
    assert.deepEqual(bootClasses(html), ["cn-locked"]);
    assert.deepEqual(bootData(html), { signedIn: false, wall: true, rail: true });
  });

  await t.test("the signup door is stamped the same way", async () => {
    const html = await (await fetch(srv.base + "/?auth=signup")).text();
    assert.deepEqual(bootClasses(html), ["cn-locked"]);
  });

  await t.test("cookie presence is the whole rule — the value is never trusted", async () => {
    // getSessionUser() reads the database and this runs on every page view;
    // the wall itself decides on presence for the same reason. A forged
    // cookie buys the sight of an account menu and nothing behind it, because
    // every limit is still enforced server-side.
    const html = await (await fetch(srv.base + "/desk", { headers: { cookie: "cn_session=x" } })).text();
    assert.deepEqual(bootClasses(html), ["cn-in"]);
  });

  await t.test("the marker never survives into a response", async () => {
    // The NAV_LINKS lesson: an unreplaced marker is invisible in the browser
    // and takes the feature with it.
    const cases = [["/", { headers: { cookie: FAKE_COOKIE } }], ["/r/abcdef12", {}]];
    for (const [url, opts] of cases) {
      const html = await (await fetch(srv.base + url, opts)).text();
      assert.ok(!html.includes("<!--AUTH_BOOT-->"), `${url} served the raw marker`);
      assert.ok(html.includes("window.CN_AUTH_BOOT="), `${url} served no boot data`);
    }
  });
});

test("the wall down: nothing is locked and the header still knows the visitor", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());

  await t.test("an anonymous visitor is stamped with no classes at all", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.deepEqual(bootClasses(html), [],
      "with the wall off the shipped markup is already right for a signed-out visitor");
    assert.deepEqual(bootData(html), { signedIn: false, wall: false, rail: true });
  });

  await t.test("cn-locked is never stamped without the wall", async () => {
    const html = await (await fetch(srv.base + "/r/abcdef12")).text();
    assert.ok(!bootClasses(html).includes("cn-locked"),
      "the lock card must not be painted over a search form the wall is not guarding");
  });

  await t.test("a member still gets their account menu immediately", async () => {
    const html = await (await fetch(srv.base + "/", { headers: { cookie: FAKE_COOKIE } })).text();
    assert.deepEqual(bootClasses(html), ["cn-in"]);
  });
});
