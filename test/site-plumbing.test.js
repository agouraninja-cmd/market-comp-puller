// Site plumbing: routing, robots, and 404 behavior.
//
// Run: npm test
//
// Cost: zero. Nothing here calls Anthropic, Stripe or Supabase. These are
// the live-site defects from 2026-08-31: /how-it-works was a homepage clone,
// /admin /dev /hq answered 200 with an admin-key form, robots.txt advertised
// those paths, and /login /signup /about /app /contact 404'd.

const test = require("node:test");
const assert = require("node:assert");
const { boot } = require("./helpers/boot");

const FAKE_SESSION = { cookie: "cn_session=not-a-real-token" };

function get(srv, path, headers) {
  return fetch(srv.base + path, { redirect: "manual", headers: headers || {} });
}

test("under the wall, /how-it-works is not a homepage clone", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("anonymous /how-it-works 302s onto the Method anchor", async () => {
    const r = await get(srv, "/how-it-works");
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/#how-it-works");
    assert.match(r.headers.get("cache-control") || "", /no-store/);
  });

  await t.test("the homepage actually has that Method anchor, and FAQ", async () => {
    const html = await (await get(srv, "/")).text();
    assert.match(html, /id="how-it-works"/);
    assert.match(html, /id="faq"/);
    assert.match(html, /<h1[^>]*>Your closed deals/);
  });

  await t.test("a tagged /how-it-works still redirects, not 404s", async () => {
    const r = await get(srv, "/how-it-works?utm_source=newsletter");
    assert.equal(r.status, 302, "a campaign link must still reach the Method section");
    assert.equal(r.headers.get("location"), "/#how-it-works");
  });

  await t.test("a signed-in visitor still gets a distinct methodology page", async () => {
    const r = await get(srv, "/how-it-works", FAKE_SESSION);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<link rel="canonical" href="[^"]*\/how-it-works"\/>/,
      "members keep a real /how-it-works page, not a redirect onto the workspace");
    assert.match(html, /How Commercial Property Valuation Works/,
      "the title must not be the homepage's head-term title");
  });

  await t.test("the footer FAQ does not point at the old clone", async () => {
    const html = await (await get(srv, "/markets")).text();
    const explore = html.slice(html.indexOf('aria-label="Explore"'), html.indexOf("</ul>", html.indexOf('aria-label="Explore"')));
    assert.match(explore, /href="\/#faq"/, "FAQ should land on the homepage FAQ");
    assert.doesNotMatch(explore, /href="\/how-it-works#faq"/,
      "FAQ must not send anyone through the old clone URL");
    assert.match(explore, /href="\/#how-it-works"/, "How it works should land on the Method section");
  });

  await t.test("a signed-in footer still points at the real methodology page", async () => {
    const html = await (await get(srv, "/markets", FAKE_SESSION)).text();
    const explore = html.slice(html.indexOf('aria-label="Explore"'), html.indexOf("</ul>", html.indexOf('aria-label="Explore"')));
    assert.match(explore, /href="\/how-it-works">How it works/,
      "How it works should open the methodology page, not the workspace");
    assert.match(explore, /href="\/how-it-works#faq"/);
    assert.doesNotMatch(explore, /href="\/#how-it-works"/,
      "a member's / is the workspace; those anchors are not there");
  });
});

test("with the wall off, /how-it-works stays its own page", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());
  const r = await get(srv, "/how-it-works");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<link rel="canonical" href="[^"]*\/how-it-works"\/>/);
});

test("unauthenticated /admin /dev /hq look like a 404, not an admin-key form", async (t) => {
  const ADMIN = "plumbing-admin-key";
  const srv = await boot({ ACCOUNT_WALL: "on", ADMIN_KEY: ADMIN });
  t.after(() => srv.stop());

  for (const p of ["/admin", "/dev", "/hq", "/contacts", "/admin/heroes"]) {
    await t.test(p + " without a key is the public 404", async () => {
      const r = await get(srv, p);
      assert.equal(r.status, 404, p + " must not 200 an admin-key prompt");
      assert.match(r.headers.get("content-type") || "", /text\/html/);
      const html = await r.text();
      assert.match(html, /This page doesn(?:'|&#39;)t exist/);
      assert.doesNotMatch(html, /Enter admin key/);
      assert.doesNotMatch(html, /ADMIN_KEY/);
      assert.doesNotMatch(html, /ideas queue/i);
    });

    await t.test(p + " with the key still serves the tool", async () => {
      const r = await get(srv, p, { "x-admin-key": ADMIN });
      assert.equal(r.status, 200, p + " must keep working for a legitimate key");
      assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    });

    await t.test(p + " with the admin cookie still serves the tool", async () => {
      const grant = await fetch(srv.base + "/api/admin-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: ADMIN }),
      });
      assert.equal(grant.status, 200);
      const cookie = String(grant.headers.get("set-cookie") || "").split(";")[0];
      const r = await get(srv, p, { cookie });
      assert.equal(r.status, 200, p + " must keep working once the cookie is set");
    });
  }

  await t.test("a browser Accept header gets a password wall, not the dashboard", async () => {
    const r = await get(srv, "/admin", { accept: "text/html" });
    assert.equal(r.status, 401);
    const html = await r.text();
    assert.match(html, /This page isn(?:'|&#39;)t public/);
    assert.match(html, /<input[^>]*type="password"/);
    assert.doesNotMatch(html, /Enter admin key/);
    assert.doesNotMatch(html, /ADMIN_KEY/);
    assert.doesNotMatch(html, /ideas queue/i);
  });
});

test("when ADMIN_KEY is unset the dashboards are ordinary 404s", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());
  for (const p of ["/admin", "/dev", "/hq"]) {
    const r = await get(srv, p);
    assert.equal(r.status, 404, p);
    const html = await r.text();
    assert.match(html, /This page doesn(?:'|&#39;)t exist/);
    assert.doesNotMatch(html, /Enter admin key/);
  }
});

test("robots.txt no longer advertises internal dashboards", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());
  const txt = await (await fetch(srv.base + "/robots.txt")).text();
  assert.match(txt, /User-agent: \*/);
  assert.match(txt, /Disallow: \/desk/);
  assert.match(txt, /Disallow: \/market-preview\//);
  for (const p of ["/admin", "/dev", "/hq", "/contacts"]) {
    assert.doesNotMatch(txt, new RegExp("Disallow: " + p.replace("/", "\\/") + "(?:\\s|$)"),
      "robots.txt must not list " + p);
  }
});

test("common URLs resolve instead of 404", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("/login → /?auth=signin", async () => {
    const r = await get(srv, "/login");
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/?auth=signin");
  });

  await t.test("/signup → /?auth=signup", async () => {
    const r = await get(srv, "/signup");
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/?auth=signup");
  });

  await t.test("/about → /leadership", async () => {
    const r = await get(srv, "/about");
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/leadership");
  });

  await t.test("/app → /desk", async () => {
    const r = await get(srv, "/app");
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/desk");
  });

  await t.test("/contact is a one-line email page", async () => {
    const r = await get(srv, "/contact");
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<h1>Contact<\/h1>/);
    assert.match(html, /mailto:info@compninja\.co/);
    assert.match(html, /info@compninja\.co/);
    assert.doesNotMatch(html, /waitlist/i);
    assert.doesNotMatch(html, /book a demo/i);
  });

  await t.test("query strings on those aliases still resolve", async () => {
    const r = await get(srv, "/login?next=/desk");
    assert.equal(r.status, 302, "/login?next= must not 404");
    assert.equal(r.headers.get("location"), "/?auth=signin");
    const about = await get(srv, "/about?utm_source=x");
    assert.equal(about.status, 302);
    const contact = await get(srv, "/contact?utm_source=x");
    assert.equal(contact.status, 200);
  });

  await t.test("/blog stays 404", async () => {
    const r = await get(srv, "/blog");
    assert.equal(r.status, 404);
  });
});
