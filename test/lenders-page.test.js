// /lenders — the public page to send a lender (Draft C: "Try it on the page").
//
// Run: npm test
//
// Cost: zero. The server boots with no keys and no database; the route is a
// pure render, and the page's working check makes no request at all.
//
// The page's five rules are in lenders-page.js's header. Each has a test
// here, written against what a VISITOR receives where that is possible, the
// way brokers-firms-page.test.js is. The ones that matter most are the two a
// reader cannot see being broken: that the page never offers to stand in for
// an appraisal (the Terms say an estimate must not be relied on for lending),
// and that the check on the page is the report's own arithmetic and words
// rather than a copy that will drift from them.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { boot } = require("./helpers/boot");
const COLLATERAL = require("../collateral-check");
const LENDERS = require("../lenders-page");

// Presence is the whole rule for the shared chrome. Same fixture as
// public-pages.test.js.
const SESSION = { cookie: "cn_session=not-a-real-token" };
const root = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// The body alone, for the tests that are about the page and not the shell.
const BODY_OUT = LENDERS.renderLendersPageBody({ signedIn: false });
const BODY_IN = LENDERS.renderLendersPageBody({ signedIn: true });
// The readable page: everything before the scripts, tags removed.
const textOf = (html) => html.slice(0, html.indexOf("<script"))
  .replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&middot;/g, "·").replace(/&rarr;/g, "→").replace(/&#39;/g, "'").replace(/\s+/g, " ");

test("/lenders is reachable, indexable, and survives a tagged link", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  const res = await fetch(srv.base + "/lenders");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>For Lenders: Check the Collateral Before the Appraisal \| CompNinja<\/title>/);
  assert.match(html, /<link rel="canonical" href="[^"]*\/lenders"/, "canonical points at itself");
  assert.doesNotMatch(html, /noindex/, "the page is meant to be found");
  // The description is what a pasted link shows, so it carries rule 1 itself.
  const desc = html.match(/<meta name="description" content="([^"]*)"/);
  assert.ok(desc && desc[1].length <= 160, "the description must fit what Google renders");
  assert.match(desc[1], /before you order the appraisal/);
  assert.match(desc[1], /automated estimate/);

  // It is a page the owner SENDS, and a link pasted into an email or a chat
  // arrives with a tracking query (never-break rule 14).
  const tagged = await fetch(srv.base + "/lenders?utm_source=email&fbclid=abc123");
  assert.equal(tagged.status, 200, "a tagged link to /lenders must not 404");
  assert.match(await tagged.text(), /<link rel="canonical" href="[^"?]*\/lenders"/,
    "and it still canonicalizes to the clean URL");

  const sitemap = await (await fetch(srv.base + "/sitemap.xml")).text();
  assert.ok(sitemap.includes("/lenders</loc>"), "sitemap lists /lenders");
});

test("the footer is the page's one standing door, in both footers, and the menu is left alone", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  // The footer is the only surface every public page shares, so a page
  // missing from it is a page nothing links to. Two footers draw that
  // column: the server's (every server-rendered page) and index.html's own.
  for (const p of ["/pricing", "/brokers-firms", "/lenders"]) {
    const html = await (await fetch(srv.base + p)).text();
    const foot = html.slice(html.lastIndexOf("<footer"));
    assert.match(foot, /<li><a href="\/lenders">For lenders<\/a><\/li>/, p + "'s footer does not reach /lenders");
    // Deliberately NOT in the Explore menu (the drafts' finding 3).
    const header = html.slice(0, html.indexOf("<main"));
    assert.doesNotMatch(header, /href="\/lenders"/, p + " lists /lenders in the top menu");
  }
  const index = root("index.html");
  const appFoot = index.slice(index.indexOf("<footer"));
  assert.match(appFoot, /<a href="\/lenders"[^>]*>For lenders<\/a>/, "the app's own footer does not reach /lenders");
});

test("it is a first look before the appraisal, and says what it is not", () => {
  const text = textOf(BODY_OUT);
  // Rule 1. The Terms say an estimate must not be relied on for lending, so
  // the page sells the step BEFORE the appraisal and never the appraisal.
  assert.match(text, /Know before you order the appraisal\./);
  assert.match(text, /decide which deals are worth an appraisal/);
  assert.ok(text.includes(
    "Every valuation is an automated estimate, not an appraisal and not a bank evaluation. " +
    "Use it to decide whether to order one, never in place of one."),
  "the fine print lost the sentence that says what this is not");
  // The owner is not a licensed broker or appraiser, and says so.
  assert.match(text, /CompNinja is not a licensed brokerage or appraiser/);
  assert.match(text, /we connect you with local brokers/);
  assert.match(text, /verify independently before underwriting/);

  // "Evaluation" is a term of art for a bank. The page may say it exactly
  // once, to say it is not one.
  const evals = text.match(/evaluation/gi) || [];
  assert.equal(evals.length, 1, "the page offers something it calls an evaluation");
  // And nothing here is a lending rule: the limit is the reader's own.
  assert.match(text, /set your own limit/);
  assert.match(BODY_OUT, /<label for="lnLimit">Your LTV limit %<\/label>/);
  for (const banned of [/\bappraised\b/i, /\bcertified\b/i, /\bguarantee/i, /\bcompliant\b/i, /\bapproved\b/i, /USPAP/i]) {
    assert.doesNotMatch(text, banned, "the page makes a claim it cannot keep: " + banned);
  }
});

test("it names no bank", () => {
  // Rule 2. A lender's name on a public page reads as their endorsement.
  // Checked on what is served, both ways it is served. The one use of the
  // word is the fine print's "not a bank evaluation".
  for (const html of [BODY_OUT, BODY_IN]) {
    assert.doesNotMatch(html, /Live Oak/i);
    assert.doesNotMatch(html.replace(/bank evaluation/gi, ""), /\bbanks?\b/i, "the page names or addresses a bank");
  }
});

test("a member is not sold a signup, and a visitor is not sent into the app", () => {
  // The signed-out copy asks for an account, twice (hero and closing band).
  assert.equal((BODY_OUT.match(/<a class="btn lg" href="\/\?auth=signup">Create a free account &rarr;<\/a>/g) || []).length, 2);
  assert.doesNotMatch(BODY_OUT, /href="\/bulk"/);
  // A member already has one. Their door is the Comp report tool.
  assert.equal((BODY_IN.match(/<a class="btn lg" href="\/bulk">Run a comp report &rarr;<\/a>/g) || []).length, 2);
  assert.doesNotMatch(BODY_IN, /auth=signup|Create a free account/, "a signed-in member is being sold a signup");
  // Both carry the rate card, and the same check.
  for (const b of [BODY_OUT, BODY_IN]) assert.match(b, /<a class="bfalt" href="\/pricing">See pricing<\/a>/);
});

test("the check the page opens with is the report's own answer, word for word", () => {
  // Rule 3, the server's half. The first state is rendered with
  // collateral-check.js's own two functions, so the page is complete with no
  // script and can never open on a figure the product would not show.
  const r = COLLATERAL.summarize({ loan: LENDERS.START.loan, limitPct: LENDERS.START.limitPct, value: LENDERS.SAMPLE });
  const d = COLLATERAL.describe(r, { whose: LENDERS.WHOSE });
  assert.equal(r.verdict, "depends", "the page opens on the case the card exists for: the appraisal decides");
  assert.ok(BODY_OUT.includes(`<span id="lnBasis">${d.basis}</span>`));
  for (const [id, t] of [["lnLow", d.low], ["lnLikely", d.likely], ["lnHigh", d.high]]) {
    assert.ok(BODY_OUT.includes(`<div class="lnpct ${t.tone}" id="${id}">${t.figure}</div>`), id + " is not the module's figure and tone");
    assert.ok(BODY_OUT.includes(`<div class="lnsub" id="${id}Sub">${t.sub}</div>`), id + "'s line is not the module's");
  }
  assert.ok(BODY_OUT.includes(`<div class="lnfig" id="lnNeed">${d.need.figure}</div>`));
  assert.ok(BODY_OUT.includes(`<div class="lnsub" id="lnNeedSub">${d.need.sub}</div>`));
  assert.ok(BODY_OUT.includes(`<p class="lnread" id="lnRead" role="status">${d.read.join(" ")}</p>`));
  // The boxes hold what that answer was computed from.
  assert.match(BODY_OUT, /id="lnLoan"[^>]*value="6,500,000"/);
  assert.match(BODY_OUT, new RegExp(`id="lnLimit"[^>]*value="${COLLATERAL.DEFAULT_LIMIT_PCT}"`));
  assert.doesNotMatch(BODY_OUT, /id="lnPrice"[^>]*value=/, "the price box opens empty");
});

test("the page script holds no arithmetic and no wording of its own", () => {
  // Rule 3, the browser's half. If the script computed an LTV or worded a
  // verdict, the public page and the product would be two copies, and the
  // page's promise ("the same one every report runs") would be a hope.
  const js = LENDERS.liveScript();
  new vm.Script(js, { filename: "lenders-page.js liveScript" });      // it parses
  assert.match(js, /COLLATERAL\.summarize\(/);
  assert.match(js, /COLLATERAL\.describe\(/);
  assert.doesNotMatch(js, /[*/]\s*100|toFixed|Math\.|toLocaleString/, "the script does arithmetic or formats a figure itself");
  for (const phrase of ["appraisal decides", "Covered", "A stretch", "over your limit", "of room", "limit allows", "price is what binds"]) {
    assert.ok(!js.includes(phrase), `the script words an answer itself: "${phrase}"`);
  }
  // Rule 5: nothing typed here goes anywhere.
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|location\b/,
    "the page script sends or stores what a visitor types");
  // The script and the server read ONE building.
  assert.ok(js.includes(`RANGE={low:${LENDERS.SAMPLE.low},likely:${LENDERS.SAMPLE.likely},high:${LENDERS.SAMPLE.high}}`));
  assert.ok(js.includes(JSON.stringify(LENDERS.WHOSE)));
  // And the page loads the module the script calls, before the script.
  assert.match(BODY_OUT, /<script src="\/collateral-check\.js"><\/script><script>\(function\(\)\{/);
});

test("typing in the boxes redraws the check from the module, every time", () => {
  // Executed against stand-in elements, with the REAL collateral-check.js.
  // No fetch, no storage and no location exist in this context, so a script
  // that reached for one would throw here.
  const ids = ["lnLoan", "lnPrice", "lnLimit", "lnBasis", "lnLow", "lnLowSub", "lnLikely", "lnLikelySub",
    "lnHigh", "lnHighSub", "lnNeed", "lnNeedSub", "lnRead"];
  const els = {};
  for (const id of ids) els[id] = { value: "", textContent: "", className: "", on: {}, addEventListener(ev, fn) { this.on[ev] = fn; } };
  els.lnLoan.value = "6,500,000"; els.lnLimit.value = "80";
  const ctx = vm.createContext({ COLLATERAL, document: { getElementById: (id) => els[id] } });
  new vm.Script(LENDERS.liveScript()).runInContext(ctx);
  for (const id of ["lnLoan", "lnPrice", "lnLimit"]) assert.equal(typeof els[id].on.input, "function", id + " is not wired");

  const expect = (loan, price, limit) => COLLATERAL.describe(
    COLLATERAL.summarize({ loan, price, limitPct: limit, value: LENDERS.SAMPLE }), { whose: LENDERS.WHOSE });
  const type = (id, v) => { els[id].value = v; els[id].on.input(); };
  const check = (d, label) => {
    assert.equal(els.lnBasis.textContent, d.basis, label);
    for (const [id, t] of [["lnLow", d.low], ["lnLikely", d.likely], ["lnHigh", d.high]]) {
      assert.equal(els[id].textContent, t.figure || "—", label + " " + id);
      assert.equal(els[id].className, "lnpct" + (t.tone ? " " + t.tone : ""), label + " " + id + " tone");
      assert.equal(els[id + "Sub"].textContent, t.sub, label + " " + id + " line");
    }
    assert.equal(els.lnRead.textContent, d.read.join(" "), label + " read");
  };

  type("lnLoan", "7,400,000");
  check(expect("7,400,000", "", "80"), "a bigger loan");
  assert.equal(els.lnNeed.textContent, "$9,250,000");
  assert.equal(els.lnLow.className, "lnpct over");

  type("lnPrice", "7,000,000"); type("lnLoan", "6,000,000");
  const bound = expect("6,000,000", "7,000,000", "80");
  check(bound, "a price that binds");
  assert.match(els.lnRead.textContent, /^The price is what binds here, not the value\./);
  assert.equal(els.lnNeedSub.textContent, bound.need.sub);

  type("lnLimit", "90");
  check(expect("6,000,000", "7,000,000", "90"), "the reader's own limit");
  assert.equal(els.lnLow.className, "lnpct ok");
  assert.equal(els.lnBasis.textContent, "Value $8,025,000 to $8,625,000 · 90% limit");

  // Shorthand is refused, and the page says so instead of showing 0.0%.
  type("lnLoan", "1.6M");
  assert.equal(els.lnLikely.textContent, "—");
  assert.equal(els.lnNeed.textContent, "—");
  assert.equal(els.lnNeedSub.textContent, "That loan amount could not be read. Type it in full, like 1,600,000.");
  // An emptied box is asked for, not complained about.
  type("lnLoan", "");
  assert.equal(els.lnNeedSub.textContent, "Type a loan amount to read it against this range.");
  // With no loan the tiles still say what each value supports.
  assert.equal(els.lnLikelySub.textContent, expect("", "7,000,000", "90").likely.sub);
});

test("the building is a sample, and the page says so three times", () => {
  // Rule 4. Somebody will read the warehouse's value as a real number, so it
  // is labelled under the heading, on the building's card, and under the check.
  const text = textOf(BODY_OUT);
  assert.match(text, /A sample warehouse and the value range its report came back with/);
  assert.match(text, /from four recent sales nearby\. Sample figures\./);
  assert.match(text, /A sample building with sample figures, so you can try the check\./);
  // The card's figures are the sample's own, never typed a second time.
  for (const v of [LENDERS.SAMPLE.low, LENDERS.SAMPLE.likely, LENDERS.SAMPLE.high]) {
    assert.ok(text.includes("$" + v.toLocaleString("en-US")), "the building's card lost a figure of the sample's range");
  }
  // And the sentences that name the range name it as the sample's.
  const priced = COLLATERAL.describe(
    COLLATERAL.summarize({ loan: 6000000, price: 8200000, value: LENDERS.SAMPLE }), { whose: LENDERS.WHOSE });
  assert.ok(priced.read.some((s) => s.includes("this sample's range")));
  assert.ok(!priced.read.some((s) => s.includes("this report's")), "a sentence on the public page speaks of a report the visitor never ran");
});

test("the page draws with the site's bands and tokens, and with no colour of its own", () => {
  const src = root("lenders-page.js");
  // One set of bands for both pitch pages: read from the sibling, not copied.
  assert.match(src, /const \{ BF_CSS \} = require\("\.\/brokers-firms-page"\);/);
  assert.match(BODY_OUT, /^<style>/);
  // Every colour in the check's own stylesheet is a token, so dark mode
  // needs nothing here (the dark bands are the sibling's, with its literals).
  assert.doesNotMatch(LENDERS.LN_CSS, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "the check's panel carries a literal colour");
  assert.match(LENDERS.LN_CSS, /\.lnpct\.ok\{color:var\(--ok-text\)\}/);
  assert.match(LENDERS.LN_CSS, /\.lnpct\.over\{color:var\(--red\)\}/);
  // Fields are labelled, and the answer is announced when it changes.
  for (const id of ["lnLoan", "lnPrice", "lnLimit"]) {
    assert.match(BODY_OUT, new RegExp(`<label for="${id}">`), id + " has no label");
  }
  assert.match(BODY_OUT, /id="lnRead" role="status"/);
});
