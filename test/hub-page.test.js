// The /hub/<id> page renderer.
//
// renderHubHTML is pure — an id and the site's chrome in, a string out — so it
// needs no database, no session and no browser.
//
// The first test is the one that earns this file, and it is the same reason
// test/vault-page.test.js exists: the whole page, browser JavaScript included,
// is built inside ONE template literal. A stray `${`, or a regex written with
// one backslash instead of two, does not fail at require time — it silently
// emits broken JavaScript, and the page dies at its first line with an empty
// shell and a console error nobody is watching.
//
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
// NOT the connection hub at /brokers.

const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");

const { renderHubHTML } = require("../hub-page");
const { ITEM_STATUSES } = require("../hub-access.js");

const CHROME = { CN_LOGO: "<svg></svg>", THEME_CSS: "", ACCOUNT_NAV_JS: "<script>/*nav*/</script>" };
const html = renderHubHTML("abc123def", CHROME);

// The page's OWN inline script, which is the last one on the page. The shared
// account-nav script is a complete <script> element passed in as chrome, so
// this deliberately takes the final block rather than the first.
function pageScript(source) {
  const blocks = source.match(/<script>[\s\S]*?<\/script>/g) || [];
  assert.ok(blocks.length, "the page must carry an inline script");
  const own = blocks[blocks.length - 1];
  return own.replace(/^<script>/, "").replace(/<\/script>$/, "");
}

test("the emitted browser JavaScript actually parses", () => {
  // The whole point of this file. `new vm.Script` compiles without running,
  // which is what we want: the script expects a DOM.
  const js = pageScript(html);
  assert.doesNotThrow(() => new vm.Script(js), "the page emits broken JavaScript");
});

test("the page's own script is not nested inside the chrome's script", () => {
  // ACCOUNT_NAV_JS is a complete <script> element, not raw JS. Interpolating
  // it INSIDE this page's script closed the tag early on the first draft and
  // printed the entire script on screen as visible text, with a 200 and valid
  // HTML. Only looking at it caught that; this is the net.
  const i = html.indexOf("var HUB_ID");
  assert.ok(i > 0);
  assert.ok(html.lastIndexOf("<script>", i) > html.lastIndexOf("</script>", i),
    "the hub script must open after every prior script closes");
});

test("the page ships NO hub data, because the token is in the fragment", () => {
  // The invite token lives in the URL fragment, which browsers never send, so
  // at render time the server cannot know who is asking. If this ever fails,
  // someone has server-rendered a hub's contents into a page whose reader the
  // server has not authenticated.
  assert.doesNotMatch(html, /"snapshot":/);
  assert.doesNotMatch(html, /"messages":\s*\[/);
  assert.match(html, /location\.hash/);
  assert.match(html, /\/api\/hub\/access/);
});

test("the id is JSON-encoded into the script, never pasted raw", () => {
  const weird = renderHubHTML('a"b</script>', CHROME);
  assert.doesNotMatch(pageScript(weird), /var HUB_ID = "a"b/);
});

// --- the comp pipeline (slice 2) -----------------------------------------

test("the page's status vocabulary matches hub-access.js exactly", () => {
  // Three copies of this list exist by necessity: hub-access.js (which
  // requests are allowed), migration 024's CHECK (which rows are allowed),
  // and this page's <select> (what a person can pick). test/hub-access.test.js
  // pins the first two together; this pins the third to them. A page offering
  // a status the server refuses is a control that fails on click.
  const m = pageScript(html).match(/var STATUSES = \[([^\]]*)\]/);
  assert.ok(m, "the page must declare STATUSES");
  const onPage = m[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
  assert.deepEqual(onPage, ITEM_STATUSES);
});

test("every status has a label, and none of them is the raw key", () => {
  // "passed" on screen is a word a client reads about their own decision, so
  // the label table must cover the vocabulary rather than falling through to
  // the database value.
  const js = pageScript(html);
  const m = js.match(/var STATUS_LABEL = \{([^}]*)\}/);
  assert.ok(m, "the page must declare STATUS_LABEL");
  for (const s of ITEM_STATUSES) {
    assert.ok(new RegExp('["\']?' + s + '["\']?\\s*:').test(m[1]), `no label for ${s}`);
  }
  // "new" must not read as a verdict — a comp nobody has ruled on is not the
  // same as one that was passed on.
  assert.match(m[1], /"new": "Not decided"/);
});

test("a reader who cannot write gets a word, not a control", () => {
  // An observer and a tenant read the same table; only one of them can change
  // it. The branch is on the SERVER's canWrite, never on the role string.
  const js = pageScript(html);
  assert.match(js, /if \(canWriteHub\)\{/);
  assert.match(js, /createElement\("select"\)/);
  assert.match(js, /createElement\("span"\)/);
  assert.match(js, /canWriteHub = !!d\.canWrite/);
});

test("a refused status change reverts the control rather than keeping it", () => {
  // This column is a record of what the client decided, so a select showing
  // something the database does not hold is the one lie it must not tell.
  const js = pageScript(html);
  const fn = js.match(/function setStatus\(item, sel\)\{[\s\S]*?\n  \}/);
  assert.ok(fn, "the page must define setStatus");
  assert.ok((fn[0].match(/sel\.value = previous/g) || []).length >= 3,
    "every failure path must put the control back");
});

test("the tally counts decisions, never undecided comps", () => {
  // A tally including "new" would let a hub where nothing has happened read as
  // though something had.
  const js = pageScript(html);
  const fn = js.match(/function renderTally\(items\)\{[\s\S]*?\n  \}/);
  assert.ok(fn, "the page must define renderTally");
  assert.match(fn[0], /i\.status !== "new"/);
});

// --- per-comp note threads (slice 2) --------------------------------------

test("notes split on item_id and nothing else", () => {
  // A note filed against a comp belongs under that comp; a note about the
  // requirement belongs in the stream. One list, filtered at render, is what
  // lets a POLLED message land in the right place without knowing which view
  // is open.
  const js = pageScript(html);
  assert.match(js, /function msgsFor\(itemId\)\{/);
  assert.match(js, /itemId \? String\(m\.itemId\) === String\(itemId\) : !m\.itemId/);
});

test("one post path serves the hub stream and a comp thread", () => {
  // The only difference is whether an itemId rides along. Two paths would let
  // the account ask, the error copy or the cursor update drift between them.
  const js = pageScript(html);
  assert.match(js, /function postMessage\(field, btn, itemId\)\{/);
  assert.match(js, /if \(itemId\) payload\.itemId = itemId;/);
  // The account ask must exist exactly once, in that shared path.
  assert.equal((js.match(/auth=signup/g) || []).length, 1);
});

test("an empty note affordance is not offered to someone who cannot post", () => {
  // "Add note" on a row an observer cannot act on is noise in a table they
  // are trying to read.
  assert.match(pageScript(html), /if \(n \|\| canWriteHub\)\{/);
});

test("only one comp thread is open at a time", () => {
  // Several open threads push the comps apart until the list stops being
  // readable as a list, and the list is the page's primary surface.
  const js = pageScript(html);
  assert.match(js, /openThread = \(openThread === it\.id\) \? null : it\.id;/);
  assert.match(js, /if \(openThread === it\.id\) rows\.appendChild\(threadRow/);
});

test("a comp thread is rendered inside the table, under its own comp", () => {
  // The placement is the feature: the note and the building it is about have
  // to be readable together, which is the thing an email thread cannot do.
  const js = pageScript(html);
  assert.match(js, /function threadRow\(it, colspan\)\{/);
  assert.match(js, /td\.colSpan = colspan/);
  assert.match(js, /tr\.className = "thread"/);
});

test("a posted note is deduped against the poll that will replay it", () => {
  // The cursor is the server's, but an optimistic local add is not, so the
  // next poll can return a message the composer already appended.
  assert.match(pageScript(html), /allMsgs\.some\(function\(x\)\{ return x\.id && m\.id && x\.id === m\.id; \}\)/);
});

// --- comps a participant added themselves (slice 2, Q4) -------------------

test("the add-a-comp form is behind the same gate as the note composer", () => {
  // Adding a building you found and saying something about one are the same
  // class of act. A hub that lets you talk but not point at a building is
  // half a workspace.
  const js = pageScript(html);
  assert.match(js, /show\("addWrap", !!d\.canWrite\)/);
});

test("a participant's own comp is marked as theirs and never wears the vault badge", () => {
  // Two different claims. The vault badge says a broker's records vouch for
  // this; "Added by" says only who put the building on the page, because
  // nobody has vouched for the numbers.
  const js = pageScript(html);
  assert.match(js, /it\.source === "manual"/);
  assert.match(js, /"Added by " \+ \(it\.addedBy/);
  assert.match(js, /mb\.className = "badge mine"/);
  // The two branches must be exclusive, or a row could carry both.
  assert.match(js, /if \(it\.private\)\{[\s\S]*?\} else if \(it\.source === "manual"\)\{/);
});

test("a typed comp posts as { comp }, never as a vault send", () => {
  // The vault branch of POST /api/hub/items reads rows back from broker_comps
  // and is owner-only; this one is any participant's and carries a body. A
  // page that posted the wrong shape would silently hit the wrong gate.
  const js = pageScript(html);
  assert.match(js, /JSON\.stringify\(\{ id: HUB_ID, comp: payload \}\)/);
});

test("the account ask lives in exactly one function, reached by every write", () => {
  // Reading a hub needs no account; this is the moment that changes, so where
  // it sends someone must not differ by which button they pressed.
  const js = pageScript(html);
  assert.match(js, /function askForAccount\(message, into\)\{/);
  assert.equal((js.match(/auth=signup/g) || []).length, 1);
  // A note, a comp thread, a typed comp, and a status change.
  assert.ok((js.match(/askForAccount\(/g) || []).length >= 4,
    "every 401 path must route through it");
});

// --- staying in step (2026-08-14) ----------------------------------------

test("a poll repaints the comps only when something visibly differs", () => {
  // Rebuilding the table on every poll would close an open note thread four
  // times a minute. Compared on the fields a poll can actually change.
  const js = pageScript(html);
  assert.match(js, /function applyItems\(items\)\{/);
  assert.match(js, /if \(sameItems\(items, lastItems\)\) return;/);
  assert.match(js, /a\[i\]\.status !== b\[i\]\.status/);
});

test("a half-typed note survives a repaint", () => {
  // Once a poll repaints on somebody ELSE's activity, losing the draft stops
  // being a rare self-inflicted annoyance and becomes a thing other people do
  // to you.
  const js = pageScript(html);
  assert.match(js, /var threadDraft = \{\}/);
  assert.match(js, /ta\.value = threadDraft\[it\.id\] \|\| ""/);
  assert.match(js, /threadDraft\[it\.id\] = ta\.value/);
  // ...and a posted note stops being a draft, or the repaint would put it back.
  assert.match(js, /if \(itemId\) delete threadDraft\[itemId\]/);
});

test("polling goes dormant when nobody is there, and wakes on any sign of one", () => {
  // A hub left open on a second monitor would otherwise ask for the whole
  // comp list four times a minute forever.
  const js = pageScript(html);
  assert.match(js, /Date\.now\(\) - lastActive > IDLE_MS/);
  assert.match(js, /\["keydown", "pointerdown", "focus"\]/);
  // Waking must catch up in the same moment, or the wake is visible as a lag.
  assert.match(js, /if \(wasIdle\) tick\(\)/);
});

test("a reader who cannot post is given something to click", () => {
  // This shipped as a sentence with no control: the composer that carries the
  // account ask is hidden from exactly the people the line addresses, and the
  // header's signed-out slots do not render on this page. A client read their
  // broker's comps, went to reply, and hit a dead end — on the one path the
  // whole feature is justified by. Found by opening a real invite link.
  const js = pageScript(html);
  assert.match(js, /a\.href = "\/\?auth=signin"/);
  assert.match(js, /Sign in or create an account/);
  // Only for the signed-out case. A CLOSED hub is finished, and offering a
  // sign-in there would promise something signing in cannot deliver.
  assert.match(js, /if \(d\.hub\.closedAt\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?auth=signin/);
});

// --- the page's own chrome and colours (2026-08-14) ------------------------

test("every CSS variable the hub page uses is one the theme actually defines", () => {
  // The bug this pins: the page styled itself with `var(--bg)`, which does not
  // exist — the page colour is `--paper`. An undefined var with no fallback
  // makes the declaration invalid, so `.btn`'s `color: var(--bg)` fell back to
  // the inherited ink, which is the same value as the button's own background.
  // The primary action read as a blank rectangle: the label was present,
  // correct, and the same colour as what it sat on. `--bad` was undefined too
  // and only survived because it had a fallback.
  const THEME = require("../theme.js");
  const defined = new Set((THEME.rootCss().match(/--[a-z0-9-]+(?=\s*:)/g) || []));
  const used = new Set((html.match(/var\(\s*(--[a-z0-9-]+)/g) || [])
    .map((s) => s.replace(/var\(\s*/, "")));
  const missing = [...used].filter((v) => !defined.has(v));
  assert.deepEqual(missing, [], `hub-page.js uses undefined theme variables: ${missing.join(", ")}`);
});

test("the hub page's nav carries My Desk and Sign in", () => {
  // accountNavSlots({ desk: false }) strips BOTH, and exists for
  // /how-it-works, which renders its own My Desk link. The hub page renders
  // neither, so passing that flag left a client with no way back into the app
  // and no way to sign in. Both were reported on a real hub, from one flag.
  //
  // Asserted on what server.js actually passes, because the page cannot see
  // the flag — it only receives the rendered slots.
  const fs = require("node:fs");
  const path = require("node:path");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const call = server.match(/renderHubHTML\(hubPageMatch\[1\][\s\S]{0,2500}?\}\)\);/);
  assert.ok(call, "could not find the hub page's render call");
  assert.match(call[0], /accountNavSlots\(\{ desk: true[^}]*\}\)/);
});

test("a hub sells the client nothing", () => {
  // The tenant rule from the spec, which the page was breaking: "No comp gate,
  // no Pro prompt, no export tally. A tenant who hits a paywall inside their
  // own broker's hub is a lost acquisition and an embarrassed broker." The
  // page was showing Pricing to everyone and, once signed in as a free
  // account, an Upgrade to Pro button in the account menu — a pitch aimed at
  // somebody else's guest, inside the workspace that broker owns.
  //
  // Owner's call, 2026-08-14: hubs show nothing about Pro. Every other page
  // keeps both, which is why this asserts the HUB's own call rather than the
  // helper's default.
  const fs = require("node:fs");
  const path = require("node:path");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const call = server.match(/renderHubHTML\(hubPageMatch\[1\][\s\S]{0,2500}?\}\)\);/);
  assert.ok(call, "could not find the hub page's render call");
  assert.match(call[0], /upsell: false/);
  assert.match(call[0], /ACCOUNT_NAV_PRICING: ""/);
  // And the helper must still default to showing both, or every other page
  // silently loses its pricing link.
  assert.match(server, /function accountNavSlots\(\{ desk = true, upsell = true \} = \{\}\)/);
});

// --- sending comps out of the vault (2026-08-14) --------------------------

test("the vault picker is the OWNER's, not every writer's", () => {
  // A client can add a building they found; only the broker sends out of the
  // book of record. canAdd, not canWrite.
  const js = pageScript(html);
  assert.match(js, /show\("vaultWrap", !!d\.canAdd\)/);
  assert.match(js, /show\("addWrap", !!d\.canWrite\)/);
});

test("the vault is fetched once, lazily, and never on an ordinary hub visit", () => {
  // Most hub visits never open this. A broker's whole book is the largest
  // thing this page could ask for.
  const js = pageScript(html);
  assert.match(js, /if \(!open \|\| vaultBook\) return;/);
  assert.match(js, /\/api\/vault\?limit=1000/);
});

test("a refused vault read says so instead of showing an empty book", () => {
  // An empty list and a refused read look identical, and one of them is a
  // broker's whole book of business appearing to be gone.
  const js = pageScript(html);
  const fn = js.match(/el\("vaultToggle"\)\.addEventListener[\s\S]*?\n  \}\);/);
  assert.ok(fn, "the toggle handler must exist");
  assert.match(fn[0], /Your vault could not be loaded/);
});

test("the send reports what actually landed, not what was asked for", () => {
  // added can be fewer than requested when something was already here. A
  // broker told five were sent will not go looking for the two that were not.
  const js = pageScript(html);
  assert.match(js, /var n = o\.j\.added \|\| 0;/);
  assert.match(js, /already in this hub/);
});

test("already-sent comps cannot be selected", () => {
  // Matched on address, because the client item shape deliberately carries no
  // vault row id. A hint only — the server filters duplicates itself.
  const js = pageScript(html);
  assert.match(js, /function alreadySent\(\)\{/);
  assert.match(js, /cb\.disabled = isSent/);
});

test("hub-page.js and vault-page.js contain exactly two backticks", () => {
  // Each file is ONE template literal, so a backtick anywhere inside it — in a
  // comment, in a string, in a regex — ends the template early and emits
  // broken JavaScript. `node --check` catches it, but as a SyntaxError
  // pointing at whatever happened to follow, which reads as unrelated.
  //
  // This failed three times in one session, always in a comment quoting an
  // identifier. The count is the cheapest possible guard: two backticks, the
  // ones opening and closing the template.
  const fs = require("node:fs");
  const path = require("node:path");
  for (const f of ["hub-page.js", "vault-page.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const n = (src.match(/`/g) || []).length;
    assert.equal(n, 2,
      `${f} has ${n} backticks; it is one template literal, so it must have exactly 2. ` +
      `A backtick in a comment ends the string and ships a dead page.`);
  }
});

test("no single-backslash escape hides inside either template literal", () => {
  // The sibling of the backtick guard above, and the general form of the
  // invite-splitter bug. Inside a template literal JavaScript keeps \\n, \\t,
  // \\r, \\\\, \\", \\', \\`, \\x.., \\u.... and \\$ — every OTHER backslash is
  // dropped before the browser sees the source. So /\\s+/ ships as /s+/ and
  // /\\d/ as /d/: still valid JavaScript, still passes `node --check`, and
  // now matches a letter instead of a class.
  //
  // Escapes inside a ${} interpolation are ordinary code and are NOT at risk,
  // so those spans are skipped.
  const fs = require("node:fs");
  const path = require("node:path");
  const KEPT = new Set(["n", "t", "r", "\\", '"', "'", "`", "x", "u", "0", "$", "\n"]);
  for (const f of ["hub-page.js", "vault-page.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const found = [];
    let inTemplate = false, depth = 0, line = 1;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "\n") { line++; continue; }
      if (c === "\\") {
        if (inTemplate && depth === 0 && !KEPT.has(src[i + 1])) {
          found.push(`${f}:${line} eats \\${src[i + 1]}`);
        }
        i++;
        continue;
      }
      if (inTemplate && depth === 0 && c === "$" && src[i + 1] === "{") { depth = 1; i++; continue; }
      if (inTemplate && depth > 0) {
        if (c === "{") depth++;
        else if (c === "}") depth--;
        continue;
      }
      if (c === "`") inTemplate = !inTemplate;
    }
    assert.deepStrictEqual(found, [],
      `${f} carries an escape the template literal will eat before the browser sees it. ` +
      `Write it with TWO backslashes.`);
  }
});

// --- who is in a hub, and closing it (2026-08-14) -------------------------

test("the People card is the OWNER's, and its presence is the server's answer", () => {
  // `people` is only sent to the owner, so the page does not decide who may
  // manage a guest list — it renders what it was given. The other addresses in
  // a hub are that broker's client relationships and no fellow guest's
  // business.
  const js = pageScript(html);
  assert.match(js, /show\("peopleCard", !!d\.people\)/);
  assert.match(js, /if \(d\.people\) renderPeople\(d\.people, d\.hub\)/);
});

test("editing the guest list sends the WHOLE list, because the route replaces it", () => {
  // PUT /api/hub/participants is a wholesale replace — one state to reason
  // about instead of three. Inviting sends everyone plus the new ones;
  // removing sends everyone except one.
  const js = pageScript(html);
  assert.match(js, /var all = people\.map\(function\(p\)\{ return p\.email; \}\)\.concat\(typed\)/);
  assert.match(js, /people\.filter\(function\(p\)\{ return p\.email !== email; \}\)/);
});

test("the invite splitter survives the template literal, and keeps plus-addresses whole", () => {
  // The bug this test exists for, found by inviting a real address on
  // production 2026-08-19. The source said /[,;\\s]+/ with ONE backslash, so
  // the template literal ate it and the page shipped /[,;s]+/ — a class
  // matching the LETTER s. "okb336+hubtest@gmail.com" split at the s in
  // "hubtest" into "okb336+hubte" and "t@gmail.com"; normalizeEmail dropped
  // the first for having no @ and accepted the second, so the invitation went
  // to a stranger while the broker was told it was sent, with the link hidden
  // because emailed was true.
  //
  // The existing guard above compiles the script, and /[,;s]+/ compiles
  // perfectly. So this asserts BEHAVIOUR on the emitted regex, not that the
  // page parses: any escape the template eats changes what it matches.
  const js = pageScript(html);
  const m = js.match(/el\("peopleEmails"\)\.value\.split\((\/[^/]+\/)\)/);
  assert.ok(m, "the invite input must still be split before it is sent");

  const emitted = new RegExp(m[1].slice(1, -1));
  const split = (v) => v.split(emitted).filter(Boolean);

  assert.deepStrictEqual(split("okb336+hubtest@gmail.com"), ["okb336+hubtest@gmail.com"],
    "a plus-address is ONE recipient; splitting it invents a second one");
  assert.deepStrictEqual(split("sam@shore.com"), ["sam@shore.com"],
    "an address full of the letter s is still one address");
  assert.deepStrictEqual(split("a@x.com, b@y.com"), ["a@x.com", "b@y.com"]);
  assert.deepStrictEqual(split("a@x.com; b@y.com"), ["a@x.com", "b@y.com"]);
  assert.deepStrictEqual(split("a@x.com b@y.com"), ["a@x.com", "b@y.com"],
    "whitespace still separates, which is the whole reason for the escape");
});

test("invite links are shown only when the server could NOT email them", () => {
  // When it did email, the links are still secrets and there is no reason to
  // put them on screen.
  assert.match(pageScript(html), /if \(!list\.length \|\| j\.emailed\)\{ show\("peopleInvites", false\)/);
});

test("show() is never handed a DOM node", () => {
  // show(name, on) does getElementById(name). Passing an element makes that
  // return null and .classList throw — which, inside a fetch .then, surfaced
  // to the broker as "that did not reach the server" AFTER the invitation had
  // been saved. A failure message describing the opposite of what happened is
  // worse than none. Caught by clicking the button, not by reading it.
  const js = pageScript(html);
  assert.ok(!/show\(box,/.test(js), "show() takes an id string, not a node");
});

test("a closed hub hides the controls that would fail on click", () => {
  const js = pageScript(html);
  assert.match(js, /show\("peopleAdd", !closed\)/);
  assert.match(js, /show\("closeWrap", !closed\)/);
});
