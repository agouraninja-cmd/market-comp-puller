// The app as a browser assembles it.
//
// Since 2026-11-14 the served app page no longer carries its megabyte of
// script inline: it points at /app.<hash>.js (app-page.js). A test that asks
// "does the served app do X" by reading the page's text would now be reading
// the markup alone, and the ones phrased as "the app must NOT contain X", or
// that loop over what they find, would keep passing while checking nothing.
//
// servedApp() fetches the page, fetches the script it names, and puts the
// script back where the tag is, which is the document the browser ends up
// running. With EXTERNAL_APP_SCRIPT=off there is no tag and the page comes
// back as served.
//
// Not named *.test.js on purpose: it is a helper, not a suite.

const APP_SCRIPT_TAG = /<script src="(\/app\.[0-9a-f]{16}\.js)"><\/script>/;

async function servedApp(base, path, init) {
  const res = await fetch(base + (path || "/"), init);
  const page = await res.text();
  const m = APP_SCRIPT_TAG.exec(page);
  if (!m) return page;
  const js = await (await fetch(base + m[1])).text();
  // A function replacer: the script is full of `$`, and a replacement STRING
  // is read for $ patterns (the DESK_BOOT bug of 2026-11-10).
  return page.replace(m[0], () => "<script>" + js + "</script>");
}

module.exports = { servedApp, APP_SCRIPT_TAG };
