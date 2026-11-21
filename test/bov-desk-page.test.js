// test/bov-desk-page.test.js
// The BOV desk's two pages (bov-desk-page.js): the owner's desk, whose browser
// script is RUN here against a stand-in document, and the page a broker sees
// behind the link in the email.
//
// What is worth a build failure on the desk: opening it must do one read and
// nothing else; a draft's Send button must come after its full text; only a
// press sends; and nothing a stranger typed or a search returned may reach
// the page as markup.

const test = require("node:test");
const assert = require("node:assert/strict");

const PAGE = require("../bov-desk-page");

// ---------------------------------------------------------------------------
// A stand-in document: just enough of the DOM for deskClient, and no HTML
// parser at all, so anything set as text stays text by construction.
// ---------------------------------------------------------------------------
function makeDom() {
  const byId = new Map();
  function node(tag) {
    const el = {
      tag, children: [], attrs: {}, listeners: {}, style: {}, className: "", value: "", parent: null,
      _text: "",
      get childNodes() { return el.children; },
      get textContent() {
        return el._text + el.children.map((c) => c.textContent).join("");
      },
      set textContent(v) { el._text = String(v == null ? "" : v); el.children.forEach((c) => { c.parent = null; }); el.children = []; },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === "id") byId.set(String(v), el); if (k === "value") el.value = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
      appendChild(c) { c.parent = el; el.children.push(c); return c; },
      fire(type, extra) { (el.listeners[type] || []).forEach((fn) => fn({ target: el, key: "", ...(extra || {}) })); },
    };
    return el;
  }
  const document = {
    body: node("body"),
    createElement: (tag) => node(tag),
    createTextNode: (text) => { const t = node("#text"); t._text = String(text); return t; },
    getElementById: (id) => byId.get(id) || null,
  };
  // The page's own static elements.
  for (const [id, tag] of [["gate", "div"], ["app", "div"], ["err", "div"], ["k", "input"], ["go", "button"],
    ["refresh", "button"], ["status", "div"], ["warn", "div"], ["topmsg", "div"], ["list", "div"], ["tally", "p"]]) {
    const el = node(tag);
    el.setAttribute("id", id);
    document.body.appendChild(el);
  }
  function walk(el, out = []) { out.push(el); el.children.forEach((c) => walk(c, out)); return out; }
  return { document, all: () => walk(document.body), node };
}

const draft = (over) => ({
  id: "m1", name: "Avery Stone", firm: "Stone CRE", email: "avery@stonecre.test", phone: "(401) 555-0101",
  fit: null, license: null, source_url: "https://www.stonecre.test/team/avery", email_check: "match",
  origin: "search", status: "draft", subject: "BOV request: office building, 982 Warwick Avenue",
  body: "Hi Avery,\n\nThe full text of the email.", sent_at: null, answered_at: null,
  gmail_url: "https://mail.google.com/mail/?view=cm&to=avery%40stonecre.test", ...over,
});
const payload = (over) => ({
  ready: true, automation: true, autopilot: false,
  mail: { ready: true, from: "Sam Sender <sam@site.test>", replyTo: "sam@site.test" },
  search: { ready: true, left: 19, perDay: 20 },
  attention: { toSend: 2, toIntroduce: 0 },
  requests: [{
    lead: { id: 41, ts: new Date().toISOString(), name: "Olive Owner", email: "olive@owner.test", phone: "401-555-0142",
      company: "", address: "982 Warwick Avenue, Warwick, RI", type: "Office", size_sqft: 12000, is_1031: false },
    market: "Warwick, RI", state: "ready", note: null, report_url: "https://site.test/r/abc123XYZ",
    introduced_match_id: null, busy: false,
    matches: [draft(), draft({ id: "m2", name: "Blake Rivers", email: "blake@riversgroup.test", body: "Hi Blake,\n\nText." })],
  }],
  ...over,
});

// Runs the real browser script. `answers` is what each POST gets back.
async function runDesk(data, { confirmAnswer = true, posts = () => ({ ok: true, sent: 1 }) } = {}) {
  const dom = makeDom();
  const calls = [];
  const opened = [];
  // Everything the page asks of the server. `calls` is the desk's own route;
  // `other` is anything else, which should only ever be the key-for-cookie
  // trade every admin page makes once on a successful open.
  const other = [];
  const fetchStub = (url, init) => {
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    if (url !== "/api/admin/bov") {
      other.push({ url, method, body });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ admin: true }) });
    }
    calls.push({ url, method, body });
    const answer = method === "GET" ? { status: 200, json: data } : (() => {
      const a = posts(body);
      return { status: a.status || 200, json: a.status ? a : a };
    })();
    return Promise.resolve({ ok: answer.status < 400, status: answer.status, json: () => Promise.resolve(answer.json) });
  };
  const sandbox = {
    document: dom.document,
    sessionStorage: { getItem: () => "the-key", setItem: () => {} },
    fetch: fetchStub,
    confirm: () => confirmAnswer,
    window: { open: (u) => opened.push(u) },
    Date, JSON, Object, String, Number, Math, isFinite, Promise, Error, encodeURIComponent, Boolean, Array,
  };
  const fn = new Function(...Object.keys(sandbox), `(${PAGE.deskClient.toString()})();`);
  fn(...Object.values(sandbox));
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  await settle();
  const find = (pred) => dom.all().filter(pred);
  const button = (text) => find((e) => e.tag === "button" && e.textContent === text)[0];
  return { dom, calls, other, opened, settle, find, button };
}

test("the emitted page compiles, and its script is the function this module exports", () => {
  const html = PAGE.renderBovDeskHTML({ CN_LOGO: "<svg></svg>" });
  const m = /<script>([\s\S]*)<\/script>/.exec(html);
  assert.ok(m, "the page carries its script");
  assert.doesNotThrow(() => new Function(m[1]));
  assert.ok(m[1].includes(PAGE.deskClient.toString()));
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
  // The shell holds no request and no broker: everything arrives behind the key.
  assert.doesNotMatch(html, /Olive|Avery/);
});

test("nothing a stranger typed or a search returned can reach the page as markup", () => {
  const src = PAGE.deskClient.toString();
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  // A link is used only when it is http(s): a search could return javascript:.
  assert.match(src, /function safeHref\(u\) \{ return \/\^https\?:/);
});

test("opening the desk is one read: no send, no search, nothing else", async () => {
  const { calls, other, dom } = await runDesk(payload());
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [["GET", "/api/admin/bov"]]);
  // The one other request is the key traded for the cn_admin cookie, as on
  // /admin: it sends no mail and runs no search.
  assert.deepEqual(other.map((c) => [c.method, c.url]), [["POST", "/api/admin-access"]]);
  assert.equal(dom.document.getElementById("app").style.display, "block");
  assert.equal(dom.document.getElementById("gate").style.display, "none");
  assert.equal(dom.document.getElementById("tally").textContent, "2 drafts to send · 0 brokers to introduce");
  assert.match(dom.document.getElementById("status").textContent, /Nothing is sent to a broker until you press Send under its full text\./);
});

test("a draft's Send button comes after its full, editable text", async () => {
  const { dom, find } = await runDesk(payload());
  const order = dom.all();
  const bodies = find((e) => e.tag === "textarea");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].value, "Hi Avery,\n\nThe full text of the email.");
  const send = find((e) => e.tag === "button" && e.textContent === "Send to Avery")[0];
  assert.ok(send, "there is a Send button for the draft");
  assert.ok(order.indexOf(send) > order.indexOf(bodies[0]), "Send is below the text it sends");
  // The text is on the page itself, not behind a fold.
  for (let p = bodies[0].parent; p; p = p.parent) assert.notEqual(p.tag, "details");
});

test("only a press sends, and it sends what was edited and nothing that was not", async () => {
  const { calls, other, button, find, settle } = await runDesk(payload());
  const body = find((e) => e.tag === "textarea")[0];
  body.value = "Hello Avery,\n\nEdited.";
  body.fire("input");
  button("Send to Avery").fire("click");
  await settle();
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  // The address and subject were not touched, so they do not ride along (an
  // untouched address keeps the check it earned).
  assert.deepEqual(posts[0].body, { action: "send", match_id: "m1", body: "Hello Avery,\n\nEdited." });
  // The desk is read again after the action, and nothing else is posted:
  // the cookie trade happened once, on the open, not again on the redraw.
  assert.deepEqual(calls.map((c) => c.method), ["GET", "POST", "GET"]);
  assert.equal(other.length, 1);
});

test("Send all asks first, and a no sends nothing", async () => {
  const no = await runDesk(payload(), { confirmAnswer: false });
  no.button("Send all 2 drafts").fire("click");
  await no.settle();
  assert.equal(no.calls.filter((c) => c.method === "POST").length, 0);

  const yes = await runDesk(payload());
  yes.button("Send all 2 drafts").fire("click");
  await yes.settle();
  assert.deepEqual(yes.calls.filter((c) => c.method === "POST").map((c) => c.body),
    [{ action: "send", match_id: "m1" }, { action: "send", match_id: "m2" }]);
});

test("Send all stops at the first refusal instead of sending past it", async () => {
  const run = await runDesk(payload(), { posts: () => ({ status: 502, error: "The mail provider did not take that email." }) });
  run.button("Send all 2 drafts").fire("click");
  await run.settle();
  assert.equal(run.calls.filter((c) => c.method === "POST").length, 1);
});

test("with no outbound mail there is no Send, only the owner's own mailbox", async () => {
  const data = payload({ mail: { ready: false, from: "", replyTo: "owner@site.test" } });
  const { find, button, dom } = await runDesk(data);
  assert.equal(button("Send to Avery"), undefined);
  assert.equal(button("Send all 2 drafts"), undefined);
  const gmail = find((e) => e.tag === "a" && e.textContent === "Open in Gmail")[0];
  assert.equal(gmail.attrs.href, "https://mail.google.com/mail/?view=cm&to=avery%40stonecre.test");
  assert.ok(button("Mark as sent"));
  assert.match(dom.document.getElementById("status").textContent, /Outbound mail is not set up/);
});

test("an unrun migration is said in words, and the requests are still listed", async () => {
  const data = payload({ ready: false });
  data.requests[0].matches = [];
  data.requests[0].state = "new";
  const { dom, button } = await runDesk(data);
  assert.equal(dom.document.getElementById("warn").style.display, "block");
  assert.match(dom.document.getElementById("warn").textContent, /Migration 065 has not been run/);
  assert.ok(button("Find brokers"));
});

test("a broker who said yes is one press from an introduction, and the press asks first", async () => {
  const data = payload({ attention: { toSend: 0, toIntroduce: 1 } });
  data.requests[0].matches = [draft({ status: "accepted", origin: "platform", answered_at: new Date().toISOString() })];
  const no = await runDesk(data, { confirmAnswer: false });
  no.button("Introduce Avery to Olive").fire("click");
  await no.settle();
  assert.equal(no.calls.filter((c) => c.method === "POST").length, 0);
  const yes = await runDesk(data);
  yes.button("Introduce Avery to Olive").fire("click");
  await yes.settle();
  assert.deepEqual(yes.calls.filter((c) => c.method === "POST").map((c) => c.body), [{ action: "introduce", match_id: "m1" }]);
});

// Found in a browser, not by reading: the caution beside a free-mail address
// was a span classed "check warn", and ".warn" is the migration notice's box,
// display:none until needed. The one line telling the owner to check an
// address before sending was in the page and invisible.
test("the caution beside an unproven address is not hidden by another rule's class", async () => {
  const html = PAGE.renderBovDeskHTML({});
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const hidden = new Set();
  for (const m of css.matchAll(/\.([a-z][\w-]*)\s*\{[^}]*display\s*:\s*none/g)) hidden.add(m[1]);
  assert.ok(hidden.has("warn"), "the migration notice is still the hidden box this test is about");
  const data = payload();
  data.requests[0].matches = [
    draft({ email: "casey.moor@gmail.com", email_check: "free" }),
    draft({ id: "m2", email_check: "differs" }),
    draft({ id: "m3", email: null, email_check: "none", body: null, subject: null }),
    draft({ id: "m4", email_check: "match" }),
  ];
  const { find } = await runDesk(data);
  const checks = find((e) => e.tag === "span" && /(^| )check( |$)/.test(e.className));
  assert.deepEqual(checks.map((e) => e.textContent), [
    "Free-mail address: check it before sending",
    "Address is not on the page's own site: check it",
    "No email address was stated",
    "Address is on the firm's own site",
  ]);
  for (const e of checks) {
    for (const cls of e.className.split(/\s+/).filter(Boolean)) {
      assert.ok(!hidden.has(cls), `"${e.textContent}" carries .${cls}, which the stylesheet hides`);
    }
  }
});

test("a member broker's address is called their account's, not one the owner typed", async () => {
  const data = payload();
  data.requests[0].matches = [draft({ status: "accepted", origin: "platform", email_check: "manual" })];
  const { find } = await runDesk(data);
  const [check] = find((e) => e.tag === "span" && /(^| )check( |$)/.test(e.className));
  assert.equal(check.textContent, "Their CompNinja account's address");
});

test("a link from a search is a link only when it is http", async () => {
  const data = payload();
  data.requests[0].matches = [draft({ source_url: "javascript:alert(1)" })];
  const { find } = await runDesk(data);
  assert.equal(find((e) => e.tag === "a" && e.textContent === "Where this came from").length, 0);
  assert.ok(!find((e) => e.tag === "a").some((a) => /^javascript:/i.test(a.attrs.href || "")));
});

// ---------------------------------------------------------------------------
// What a broker sees
// ---------------------------------------------------------------------------
const OFFER = {
  action: "/bov/accept?m=abc&t=def", address: "982 Warwick Avenue, Warwick, RI", type: "Office",
  size_sqft: 12000, reportUrl: "https://site.test/r/abc123XYZ", residential: false,
};

test("the offer is two POST forms, and says what CompNinja is", () => {
  const v = PAGE.acceptView({ kind: "open", ...OFFER });
  assert.equal(v.title, "Take on this Broker Opinion of Value?");
  assert.match(v.body, /<b>982 Warwick Avenue, Warwick, RI<\/b><br>Office &middot; 12,000 SF/);
  assert.match(v.body, /<form method="POST" action="\/bov\/accept\?m=abc&amp;t=def"/);
  assert.match(v.body, /<form method="POST" action="\/bov\/accept\?m=abc&amp;t=def&amp;no=1"/);
  assert.match(v.body, /not a brokerage/);
  assert.match(v.body, /an automated estimate, not an appraisal/);
  // Accepting is never a link: a GET must not be able to accept.
  assert.doesNotMatch(v.body, /<a [^>]*href="\/bov\/accept/);
});

test("everything on the offer page is escaped", () => {
  const v = PAGE.acceptView({ kind: "open", ...OFFER, address: `<img src=x onerror=alert(1)> "A&B"`, type: "<b>Office</b>",
    reportUrl: "javascript:alert(1)" });
  assert.doesNotMatch(v.body, /<img|<b>Office/);
  assert.match(v.body, /&lt;img src=x onerror=alert\(1\)&gt; &quot;A&amp;B&quot;/);
  assert.doesNotMatch(v.body, /javascript:/);
});

test("a home's offer says agent; a lost one shows no property", () => {
  const home = PAGE.acceptView({ kind: "open", ...OFFER, type: "Residential", residential: true });
  assert.equal(home.title, "Take on this home value request?");
  assert.match(home.body, /connect them with a local agent/);
  assert.doesNotMatch(home.body, /Broker Opinion of Value/);
  for (const kind of ["taken", "declined_now", "invalid", "gone", "busy"]) {
    const v = PAGE.acceptView({ kind, ...OFFER });
    assert.ok(!v.body.includes("982 Warwick"), `${kind} shows the address`);
    assert.doesNotMatch(v.body, /<form/);
  }
  assert.equal(PAGE.acceptView({ kind: "done", ...OFFER }).title, "You're introduced");
  assert.equal(PAGE.acceptView({}).title, "This link is not recognized");
});
