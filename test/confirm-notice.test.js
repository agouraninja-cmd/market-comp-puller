// confirm-notice.js: the "Confirm your email" notice, and that both shells
// are wired to it. The module's header states its rules; this holds them.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const CN = require("../confirm-notice");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("it shows on a literal emailVerified === false and on nothing else", () => {
  assert.equal(CN.needs({ email: "a@b.com", emailVerified: false }), true);
  // A confirmed account, an older server that sends no field, a failed read
  // and a signed-out visitor all show nothing: a notice nobody can act on is
  // worse than none.
  for (const me of [{ emailVerified: true }, { email: "a@b.com" }, { emailVerified: null },
    { emailVerified: 0 }, { emailVerified: "false" }, null, undefined, "x"]) {
    assert.equal(CN.needs(me), false, JSON.stringify(me));
  }
});

test("the words say what opens, name the address, and never say 'verified'", () => {
  const c = CN.copy("client@acme.com");
  assert.equal(c.title, "Confirm your email");
  assert.ok(c.body.includes("client@acme.com"));
  assert.match(c.body, /Reports, firm invitations and deal rooms sent to this address/);
  assert.equal(c.send, "Send it again");
  // CLAUDE.md rule 8: that word is the badge the server awards a comp.
  assert.doesNotMatch(JSON.stringify(c) + JSON.stringify(CN.copy("")), /verif/i);
  // Nothing in it says whether anything is waiting (the server never tells
  // an unconfirmed account that, and a notice that did would be the leak).
  assert.doesNotMatch(c.body, /waiting|you have|has been shared/i);
  assert.ok(CN.copy("").body.startsWith("We sent you a link."), "no address, no blank where one would be");
});

test("after Send it again it tells the truth about what happened", () => {
  assert.deepEqual(CN.sendResult(200, { ok: true, sent: true }),
    { tone: "ok", text: "Sent. Check your inbox and your spam folder." });
  // Mail is off, or the provider refused: never "sent".
  assert.equal(CN.sendResult(200, { ok: true, sent: false }).tone, "bad");
  assert.equal(CN.sendResult(200, { ok: true, already: true }).confirmed, true);
  assert.equal(CN.sendResult(429, { error: "We just sent that." }).text, "We just sent that.");
  assert.equal(CN.sendResult(401, {}).tone, "bad");
  assert.equal(CN.sendResult(503, null).tone, "bad");
});

test("the link comes back to a shared report's page, or to nowhere in particular", () => {
  assert.equal(CN.nextFor("/r/AbC123_-xyz"), "/r/AbC123_-xyz");
  for (const p of ["/", "/desk", "/messages", "/r/", "/r/abcdefgh/x", "", null, undefined]) {
    assert.equal(CN.nextFor(p), "", String(p));
  }
});

test("with no document (a require, a test) it does nothing and does not throw", () => {
  assert.equal(CN.sync({ email: "a@b.com", emailVerified: false }), null);
  assert.equal(CN.say("x"), false);
  CN.confirmed();
  CN.remove();
});

test("it is built with textContent and writes only through fetch", () => {
  const src = read("confirm-notice.js");
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /sendBeacon|XMLHttpRequest/, "CLAUDE.md rule 15");
  assert.match(src, /root\.fetch\("\/api\/account\/confirm\/send"/);
});

test("the app loads it, follows identity with it, and finishes a confirm link", () => {
  const html = read("index.html");
  assert.ok(html.includes('<script src="/confirm-notice.js"></script>'));
  // refreshAccountUI is the one function that runs after /api/account/me on
  // every path, sign-out included, so the notice comes down with the session.
  const refresh = html.slice(html.indexOf("function refreshAccountUI()"));
  assert.ok(refresh.slice(0, 4000).includes("syncConfirmNotice();"));
  // The token is read from the FRAGMENT and POSTed with the session.
  assert.match(html, /location\.hash\.match\(\/\^#confirm=/);
  assert.match(html, /fetch\("\/api\/account\/confirm", \{\s*method: "POST"/);
  // A shared report refused for an unconfirmed address brings the notice up.
  assert.match(html, /body\.verify_required === true && typeof CONFIRMNOTICE !== "undefined"/);
  // Every use is guarded, so a failed load costs the notice and nothing else.
  const uses = html.split("CONFIRMNOTICE.").length - 1;
  const guards = html.split('typeof CONFIRMNOTICE').length - 1;
  assert.ok(uses > 0 && guards >= 4, `${uses} uses, ${guards} guards`);
});

test("server-rendered pages fetch it only for an account that has not confirmed", () => {
  const server = read("server.js");
  assert.ok(server.includes('"/confirm-notice.js": { file: "confirm-notice.js"'));
  const nav = server.slice(server.indexOf("const ACCOUNT_NAV_JS ="));
  const guard = nav.indexOf("`if(!me)return;`");
  const load = nav.indexOf('if(me.emailVerified===false){var cfn=document.createElement("script");cfn.src="/confirm-notice.js";');
  assert.ok(guard > 0 && load > guard,
    "under the signed-in guard and behind a literal false, so a public market page never requests it");
});
