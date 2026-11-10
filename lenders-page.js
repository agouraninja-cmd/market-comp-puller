// ---------------------------------------------------------------------------
// /lenders — "For lenders", the public page to send a lender (2026-11-10).
//
// Draft C of the lender page drafts, the owner's pick ("Try it on the
// page"): https://claude.ai/artifact/4mb99gNEuPNgt7gdohzAxH. A short page
// with a WORKING Collateral Check on a sample building in the middle of it,
// so a lender sees what the product does to a loan before making an account.
//
// The reader is somebody lending on a building its owner works out of (the
// owner's example was an SBA lender): the business repays the loan and the
// building is collateral, so there is no NOI and the report's Debt & Refi
// card never opens for them. The Collateral Check does, and this page is the
// one place that says so in their words.
//
// It renders a BODY, not a document, like brokers-firms-page.js: server.js
// owns the route, the SEO metadata and the shell (marketShell). It draws
// with that page's own bands (BF_CSS, required below) so the two read as one
// site, and adds only the check's panel (LN_CSS).
//
// FIVE RULES a future editor will otherwise break:
//
//   1. IT IS A PRE-SCREEN, AND SAYS SO. The Terms say an estimate must not be
//      relied on for lending. So the page sells a first look BEFORE the
//      appraisal and its fine print says "not an appraisal and not a bank
//      evaluation ... never in place of one". "Evaluation" is a regulatory
//      term for a bank; the page must never offer to be one, and must never
//      state or imply a lending limit (80% is only where the box starts).
//      test/lenders-page.test.js pins the sentences.
//   2. IT NAMES NO BANK. A lender's name on a public page reads as their
//      endorsement.
//   3. THE CHECK IS THE REPORT'S OWN, NOT A COPY. The arithmetic is
//      collateral-check.js's summarize() and the words are its describe():
//      the same two functions the report's card calls. The server renders
//      the first state with them (so the page is complete with no script),
//      and the page script calls them again on every keystroke. Nothing here
//      may compute an LTV or word a verdict itself; a test fails on it.
//   4. THE BUILDING IS A SAMPLE, AND SAYS SO THREE TIMES: under the heading,
//      in "The building" card, and under the check. Its figures are
//      illustrative (the app's sample report's building). Nothing about a
//      real property may ever be shown here.
//   5. NOTHING TYPED HERE GOES ANYWHERE. The script reads three boxes and
//      writes text into the page. It makes no request at all, which is also
//      what keeps it inside never-break rule 15 (a page writes only through
//      fetch): there is nothing to hold back.
//
// The two requires are pure modules (a stylesheet string and arithmetic), so
// this file is still a pure function of its inputs: no I/O, no clock.
// ---------------------------------------------------------------------------

"use strict";

const { BF_CSS } = require("./brokers-firms-page");
const COLLATERAL = require("./collateral-check");

// The sample building: the app's own sample report's address, with the range
// that report shows. Illustrative, and labelled so on the page (rule 4).
const SAMPLE = {
  address: "1200 W Industrial Blvd, Dallas, TX",
  facts: "Industrial &middot; 74,000 SF",
  low: 8025000, likely: 8325000, high: 8625000,
  sales: "four",
};

// What the check opens holding, so the page shows an answer before anyone
// types. A loan that fits at the likely value and not at the low one: the
// case the card exists for ("the appraisal decides").
const START = { loan: 6500000, limitPct: COLLATERAL.DEFAULT_LIMIT_PCT };

// The words name whose range it is; on this page it is the sample's.
const WHOSE = "this sample's";

// The check's panel. Everything else on the page is BF_CSS's bands.
// Colours are tokens and sizes are theme.js's scale (test/theme.test.js
// refuses an off-scale size); the card inherits the page's .bfcard.
const LN_CSS = `
.lntop{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:14px 20px;
  border-bottom:1px solid var(--line)}
.lntop b{font-weight:600;color:var(--ink);font-size:var(--text-compact)}
.lntop span{font-size:var(--text-small);color:var(--ink-3)}
.lnk{font-size:var(--text-tiny);font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.lnfig{font-family:var(--serif);font-weight:500;font-size:var(--text-figure);color:var(--ink);margin-top:4px;
  font-variant-numeric:tabular-nums}
.lnsub{font-size:var(--text-small);color:var(--ink-3);margin-top:3px;line-height:1.5}
.lnin{display:grid;grid-template-columns:1fr;gap:12px;padding:18px 20px 0}
.lnin label{display:block;font-size:var(--text-tiny);font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3)}
.lnin input{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid var(--edge);
  border-radius:var(--r-md);padding:8px 10px;font-family:inherit;font-size:var(--text-compact);color:var(--ink);
  background:var(--card)}
.lnin input:focus{outline:2px solid var(--red);outline-offset:1px}
.lntiles{display:grid;grid-template-columns:1fr;gap:12px;padding:16px 20px 0}
.lntile{background:var(--wash);border:1px solid var(--line);border-radius:var(--r-md);padding:14px 16px}
.lnpct{font-size:var(--text-heading);font-weight:600;margin-top:4px;color:var(--ink);font-variant-numeric:tabular-nums}
.lnpct.ok{color:var(--ok-text)}
.lnpct.over{color:var(--red)}
.lnneed{margin:14px 20px 0;border:1px solid var(--red);border-radius:var(--r-md);padding:14px 16px}
.lnneed .lnk{color:var(--red)}
.lnread{margin:0;padding:14px 20px 0;font-size:var(--text-compact);line-height:1.6;color:var(--ink-body);min-height:1.6em}
.lnnote{margin:0;padding:12px 20px 16px;font-size:var(--text-label);line-height:1.55;color:var(--ink-3)}
.lnsplit{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;margin-top:24px;align-items:start}
.lnsplit .bfcard{margin-top:0}
.lnside{display:grid;gap:12px}
.lnside strong{color:var(--ink);font-weight:600}
@media (min-width:900px){
  .lnin{grid-template-columns:1fr 1fr 1fr}
  .lntiles{grid-template-columns:1fr 1fr 1fr}
  .lnsplit{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
}
`;

const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

// The page script. It holds NO arithmetic and NO wording (rule 3): it reads
// the three boxes, asks collateral-check.js, and writes the answer into the
// elements the server already filled. The one sentence of its own is the
// prompt for an EMPTY loan box, which is this page's to say.
//
// Two things it must do besides redraw, both found by Cursor Bugbot on
// PR #416. A dollar box holding text that is not a figure is SAID, for the
// price as well as the loan: refused in silence, "7M" typed as a price
// leaves the check reading value alone, as if no price had been given, and
// can show "the appraisal decides" where the price would bind. And the limit
// box is put back to the limit actually in use when it is left: an emptied
// or out-of-range limit computes at the default, and a box showing 150 over
// a line reading "80% limit" is two answers on one card.
//
// The range is interpolated from SAMPLE, so the script and the server's
// first render can never be reading two different buildings.
function liveScript() {
  return `(function(){
if(typeof COLLATERAL==="undefined")return;
var RANGE={low:${SAMPLE.low},likely:${SAMPLE.likely},high:${SAMPLE.high}};
function $(id){return document.getElementById(id)}
function tile(id,t){var el=$(id);el.className="lnpct"+(t&&t.tone?" "+t.tone:"");
el.textContent=t&&t.figure?t.figure:"\\u2014";$(id+"Sub").textContent=t?t.sub:""}
function draw(){
var loan=$("lnLoan").value,price=$("lnPrice").value;
var r=COLLATERAL.summarize({loan:loan,price:price,limitPct:$("lnLimit").value,value:RANGE});
var d=COLLATERAL.describe(r,{whose:${JSON.stringify(WHOSE)}});
$("lnBasis").textContent=d.basis;
tile("lnLow",d.low);tile("lnLikely",d.likely);tile("lnHigh",d.high);
$("lnNeed").textContent=d.need?d.need.figure:"\\u2014";
$("lnNeedSub").textContent=d.need?d.need.sub:
(COLLATERAL.unreadable(loan)?COLLATERAL.UNREAD.loan:"Type a loan amount to read it against this range.");
$("lnRead").textContent=d.read.concat(COLLATERAL.unreadable(price)?[COLLATERAL.UNREAD.price]:[]).join(" ");
}
["lnLoan","lnPrice","lnLimit"].forEach(function(id){$(id).addEventListener("input",draw)});
$("lnLimit").addEventListener("blur",function(){var el=$("lnLimit");el.value=COLLATERAL.limitPct(el.value);draw()});
})();`;
}

/**
 * The body of /lenders.
 *
 * @param {object} opts
 * @param {boolean} opts.signedIn  cookie presence: decides the two doors only.
 * @returns {string} HTML for marketShell's <main class="wrap">.
 */
function renderLendersPageBody({ signedIn = false } = {}) {
  // A member already has an account, and selling them a signup is the bug
  // public-pages.test.js exists to catch. Their door is the Comp report tool.
  const startHref = signedIn ? "/bulk" : "/?auth=signup";
  const startLabel = signedIn ? "Run a comp report" : "Create a free account";

  // The first state, from the report's own two functions (rule 3).
  const d = COLLATERAL.describe(
    COLLATERAL.summarize({ loan: START.loan, limitPct: START.limitPct, value: SAMPLE }),
    { whose: WHOSE });

  const tile = (id, label, t) =>
    `<div class="lntile"><div class="lnk">${label}</div>` +
    `<div class="lnpct${t.tone ? " " + t.tone : ""}" id="${id}">${t.figure}</div>` +
    `<div class="lnsub" id="${id}Sub">${t.sub}</div></div>`;

  const check =
    `<div class="bfcard">` +
    `<div class="lntop"><b>Collateral Check</b><span id="lnBasis">${d.basis}</span></div>` +
    `<div class="lnin">` +
    `<div><label for="lnLoan">Loan amount ($)</label>` +
    `<input id="lnLoan" type="text" inputmode="numeric" autocomplete="off" ` +
    `value="${Math.round(START.loan).toLocaleString("en-US")}" placeholder="e.g. 1,600,000"></div>` +
    `<div><label for="lnPrice">Purchase price ($)</label>` +
    `<input id="lnPrice" type="text" inputmode="numeric" autocomplete="off" placeholder="if it is a purchase"></div>` +
    `<div><label for="lnLimit">Your LTV limit %</label>` +
    `<input id="lnLimit" type="text" inputmode="decimal" autocomplete="off" value="${START.limitPct}"></div>` +
    `</div>` +
    `<div class="lntiles">` +
    tile("lnLow", "LTV at the low value", d.low) +
    tile("lnLikely", "LTV at the likely value", d.likely) +
    tile("lnHigh", "LTV at the high value", d.high) +
    `</div>` +
    `<div class="lnneed"><div class="lnk">Value this loan needs</div>` +
    `<div class="lnfig" id="lnNeed">${d.need.figure}</div>` +
    `<div class="lnsub" id="lnNeedSub">${d.need.sub}</div></div>` +
    // role=status: the sentence is the answer, and it changes as they type.
    `<p class="lnread" id="lnRead" role="status">${d.read.join(" ")}</p>` +
    `<p class="lnnote">A sample building with sample figures, so you can try the check. ` +
    `The arithmetic is the same one every report runs.</p>` +
    `</div>`;

  const ledger = [
    ["The value", "A range, with every comp shown",
     "Low, Likely and High from recent sales of similar buildings nearby. Each comp carries its " +
     "source and a badge for how far to trust it."],
    ["The loan", "Your loan, read against that range",
     "Loan-to-value at all three figures, and the value the loan needs to sit inside your own " +
     "limit. Add a purchase price and it counts the lesser of the two."],
    ["Yours alone", "Your figures stay with you",
     "The loan and the price stay in your browser and your own account. A report you share " +
     "carries the comps and the value, never your numbers."],
  ]
    .map(([lab, head, body], i) =>
      `<div class="bfledcell${i === 1 ? " mid" : ""}">` +
      `<div class="k">${lab}</div><h3>${head}</h3><p>${body}</p></div>`)
    .join("");

  return (
    `<style>${BF_CSS}${LN_CSS}</style>` +

    // --- Hero ---------------------------------------------------------------
    `<div class="bfband bfhero"><div class="bfin">` +
    `<div class="bfeye">For lenders</div>` +
    `<h1 style="max-width:22ch">Is the building worth the loan? Know before you order the appraisal.</h1>` +
    `<p class="bflede">CompNinja finds recent comparable sales for any commercial address, estimates what the ` +
    `building is worth, and reads your loan against it. Use it to decide which deals are worth an appraisal, ` +
    `before you spend the weeks and the fee.</p>` +
    `<p class="bfacts"><a class="btn lg" href="${startHref}">${startLabel} &rarr;</a>` +
    `<a class="bfalt" href="/pricing">See pricing</a></p>` +
    `</div></div>` +

    // --- Try it here: the working check (rules 3, 4 and 5) -------------------
    `<div class="bfband wash"><div class="bfin">` +
    `<div class="bfhead"><div>` +
    `<div class="bfeye">Try it here</div>` +
    `<h2>Type a loan. See where it lands.</h2></div>` +
    `<p class="bfhnote">A sample warehouse and the value range its report came back with. Change the loan, ` +
    `add a price, or set your own limit.</p></div>` +
    `<div class="lnsplit"><div>${check}</div>` +
    `<div class="lnside">` +
    `<div class="bfexit"><div class="k">The building</div><p><strong>${SAMPLE.address}</strong><br>` +
    `${SAMPLE.facts}. Low ${usd(SAMPLE.low)}, likely ${usd(SAMPLE.likely)}, high ${usd(SAMPLE.high)}, from ` +
    `${SAMPLE.sales} recent sales nearby. Sample figures.</p></div>` +
    `<div class="bfexit"><div class="k">Lesser of price and value</div><p>Add a purchase price and each figure ` +
    `is read on whichever is lower, the way a lender counts it.</p></div>` +
    `<div class="bfexit"><div class="k">On a real report</div><p>The same check sits under the value on every ` +
    `report you run, on that building&#39;s own comps.</p></div>` +
    `</div></div>` +
    `</div></div>` +

    // --- What you get -------------------------------------------------------
    `<div class="bfband"><div class="bfin">` +
    `<div class="bfeye">What you get</div>` +
    `<h2>The value, the loan against it, and your figures kept to yourself.</h2>` +
    `<div class="bfled">${ledger}</div>` +
    `</div></div>` +

    // --- Closing CTA --------------------------------------------------------
    `<div class="bfcta"><div class="bfin">` +
    `<div><h2>Now run it on your own address.</h2>` +
    `<p>A free account values any commercial address, three years back.</p></div>` +
    `<a class="btn lg" href="${startHref}">${startLabel} &rarr;</a>` +
    `</div></div>` +

    // --- Compliance. Not decoration: rule 1. --------------------------------
    `<div class="bffine"><p>Every valuation is an automated estimate, not an appraisal and not a bank ` +
    `evaluation. Use it to decide whether to order one, never in place of one. CompNinja is not a licensed ` +
    `brokerage or appraiser; when you need a licensed opinion of value, we connect you with local brokers. ` +
    `Comparables derive from publicly available data; verify independently before underwriting.</p></div>` +

    // The report's own arithmetic and words, then the few lines that wire the
    // boxes to them. Served max-age 0, like every page that calls COLLATERAL.
    `<script src="/collateral-check.js"></script><script>${liveScript()}</script>`
  );
}

module.exports = { renderLendersPageBody, LN_CSS, SAMPLE, START, WHOSE, liveScript };
