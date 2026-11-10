// The app's stylesheet link is versioned (2026-11-10).
//
// index.html is served no-store and /tailwind.css is cached for five minutes,
// so on a deploy a browser could pair NEW markup with an OLD stylesheet. Since
// the app's colours became token classes (text-ink-3, bg-card, bg-red-fill),
// an old copy lacks all of them: the app would load without its colours until
// the cache ran out. The served link carries a version that changes whenever
// the file does, so the pairing cannot happen.
//
// Run: npm test   (node --test, no dependencies, no network)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");

const root = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("index.html links the stylesheet once, by the plain path the server versions", () => {
  const index = root("index.html");
  assert.equal(index.split('href="/tailwind.css"').length - 1, 1,
    "the server rewrites this exact link; a second or a differently written one would go out unversioned");
  const server = root("server.js");
  assert.match(server, /const TAILWIND_LINK = 'href="\/tailwind\.css"';/);
  assert.match(server, /\.replace\(TAILWIND_LINK, tailwindLink\)/);
});

test("the served app names the stylesheet by a version, and that URL serves the file", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/")).text();
  assert.equal(html.includes('href="/tailwind.css"'), false, "the app was served with an unversioned stylesheet link");
  const m = html.match(/href="(\/tailwind\.css\?v=[a-z0-9]+-[a-z0-9]+)"/);
  assert.ok(m, "no versioned stylesheet link in the served app");

  // The version is the file's own size and modified time, so it moves when
  // the file does and only then.
  const st = fs.statSync(path.join(__dirname, "..", "tailwind.css"));
  assert.equal(m[1], `/tailwind.css?v=${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}`);

  // The static route matches on the path without its query.
  const css = await fetch(srv.base + m[1]);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") || "", /^text\/css/);
  assert.equal(await css.text(), root("tailwind.css"));
});
