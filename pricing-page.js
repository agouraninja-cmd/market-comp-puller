// ---------------------------------------------------------------------------
// /pricing — the linkable rate card.
//
// Pure, like firms-page.js and bulk-page.js: it takes its inputs and returns a
// string. No I/O, no requires, no clock reads. server.js owns the route, the
// SEO metadata and the shell.
//
// WHY THIS PAGE EXISTS. Pricing lived only in a modal inside index.html. A
// modal cannot be linked, indexed, or sent in an email — so the answer to
// "what does this cost" could not be given as a URL, and Google never saw a
// price at all. Worse, the modal carried Free / Pro / Founding and NO firm
// tier, while the /how-it-works FAQ had been quoting a seat price in prose for
// weeks: the product's own price was stated where a crawler could read it and
// nowhere a buyer could click.
//
// THREE RULES a future editor will otherwise break:
//
//   1. THE FIGURES ARE PASSED IN, from PRICING in server.js, which the FAQ
//      answer also reads. They are prose, never the charge — the charge comes
//      from the Stripe price IDs — so their only job is to agree with each
//      other. test/pricing-page.test.js pins the modal to the same constant.
//      The founding SAVING is COMPUTED (monthly*12 - foundingAnnual) and never
//      typed, or it goes stale the next time either figure moves.
//   2. THIS PAGE NEVER BUYS ANYTHING. Every control hands off to the app
//      (`/?pricing=1`) or to signup. Buying needs the session, the
//      entitlements and — for a firm — an orgId and an ownership check, none
//      of which a cached server-rendered page has. A second path to a charge
//      is the last thing this codebase needs; /api/checkout's no-fallthrough
//      PLANS map exists for exactly that reason.
//   3. THE FOUNDING COUNTER IS NEVER SERVER-RENDERED. See FOUNDING_JS below.
//
// The page carries its own <style>, in the BODY rather than through
// marketShell's `head` — the /faq and /bulk rule. The head is emitted BEFORE
// MARKET_CSS, so a rule placed there loses on equal specificity, and the tile
// overrides below would silently not apply. Every selector here is prefixed
// `prc-`: MARKET_CSS's `.card`, `.tile` and `.btn` are shared with every other
// market page, and redefining one of them from here is the leak
// test/vault-shell.test.js exists to catch.
// ---------------------------------------------------------------------------

// Colours are TOKENS, never the design's literal hexes: the design was drawn
// in the light palette, and a literal here is a page that does not follow the
// reader into dark mode.
//
// TWO CORRECTIONS to the handoff's token mapping, both load-bearing:
//
//   - It maps #F5F4EF to `--paper-alt`. THERE IS NO SUCH TOKEN. theme.js calls
//     that value `--wash`, and test/theme.test.js fails the build on a custom
//     property it does not define, so `var(--paper-alt)` would not merely
//     render unstyled, it would go red. faq-page.js's own shipped mapping
//     comment never mentions one either.
//   - It asks for the founding band on `--ink`. `--ink` is the INK ramp: it
//     is #1A2433 in light and #E4E9F0 in dark, so a panel painted with it is
//     near-white in dark mode with white text on top of it. The token for a
//     surface that is already dark in light mode is `--slab` (#1A2433 /
//     #243044), which is what MARKET_FOOTER and /brokers-firms' dark bands
//     use — and, for the same reason those do, the text ON it is LITERAL
//     rather than tokenized, because the ink ramp runs backwards on a surface
//     that is dark in both themes.
const PRICING_CSS = `
/* The three tiles, equal height, with each CTA pinned to the bottom so the
   buttons line up across tiles whose summaries are different lengths. That is
   the whole reason for the flex column; MARKET_CSS's .tile is a plain box. */
.prc-tiles{grid-template-columns:repeat(3,1fr);gap:16px;align-items:stretch}
.prc-tile{display:flex;flex-direction:column;position:relative;padding:20px}
.prc-tile .prc-k{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;
  color:var(--ink-3);font-weight:600}
.prc-tile .prc-v{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:32px;
  line-height:1.15;margin-top:6px;color:var(--ink);font-variant-numeric:tabular-nums}
.prc-tile .prc-n{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.prc-sum{font-size:13.5px;line-height:1.55;color:var(--ink-body);margin:12px 0 0}
/* The pin. Everything above it is content, this is what puts the button on
   the floor of the tile. */
.prc-cta{margin-top:auto;padding-top:16px}
.prc-cta .btn{display:inline-block}
/* Pro. The border is the emphasis and the tag names who it is for.
   The tag is --red-FILL, not --red: white text sits on it, and --red lightens
   in dark mode for use as TEXT. theme.js's split, and test/theme.test.js
   catches it — which it did, on the first run of this stylesheet. */
.prc-mid{border-color:var(--red)}
.prc-mid .prc-k{color:var(--red)}
.prc-tag{position:absolute;top:-9px;left:14px;background:var(--red-fill);color:#fff;
  font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  padding:3px 8px;border-radius:3px}

/* --- The founding band ----------------------------------------------------
   Replaces the .disc footnote this page carried, and sits directly under the
   tiles. It is a SLAB, not a fourth column: founding is the same Pro plan at
   an annual rate while seats remain, and giving a closing offer its own tile
   would misrepresent both it and the standing tiers.
   Text colours are literal for the reason given above the stylesheet. */
.prc-fm{background:var(--slab);border-radius:6px;padding:22px 26px;margin:20px 0 0;
  display:flex;flex-wrap:wrap;gap:22px;align-items:center;justify-content:space-between}
.prc-fm-lab{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#F87171}
.prc-fm-h{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:23px;line-height:1.25;
  color:#fff;margin:8px 0 6px;font-variant-numeric:tabular-nums}
.prc-fm-sub{font-size:13px;line-height:1.5;color:#B6C1CF;margin:0}
.prc-fm-right{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.prc-fm-count{font-size:12.5px;color:#B6C1CF;line-height:1.3}
.prc-fm-n{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:28px;color:#fff;
  display:block;font-variant-numeric:tabular-nums}
.prc-fm-btn{display:inline-block;background:#DC2626;color:#fff;text-decoration:none;
  border-radius:4px;padding:10px 18px;font-size:14px;font-weight:600;white-space:nowrap}
.prc-fm-btn:hover{background:#B91C1C;color:#fff}

/* --- "Is it worth it" -----------------------------------------------------
   Two cards with the SAME numbering and the same rhythm, which is the whole
   point of the section: the free column is what makes the paid column
   believable, so it gets equal structure rather than a shorter afterthought. */
.prc-worth{display:grid;grid-template-columns:1.15fr 1fr;gap:16px;margin:26px 0 0}
.prc-wc{border-radius:6px;padding:22px}
.prc-wc-pro{background:var(--wash);border:1px solid var(--line)}
.prc-wc-free{background:var(--card);border:1px solid var(--edge)}
.prc-wc h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:20px;line-height:1.3;
  color:var(--ink);margin:0 0 14px}
.prc-wl{list-style:none;margin:0;padding:0}
.prc-wl li{display:flex;gap:12px;padding:9px 0;font-size:13.5px;line-height:1.55;color:var(--ink-body)}
.prc-wl li + li{border-top:1px solid var(--line)}
.prc-wc-free .prc-wl li + li{border-top-color:var(--hair)}
.prc-num{flex:0 0 auto;color:var(--red);font-weight:600;font-size:12px;
  font-variant-numeric:tabular-nums;padding-top:1px}

@media (max-width:759.98px){
  .prc-tiles{grid-template-columns:1fr}
  .prc-worth{grid-template-columns:1fr}
  .prc-fm{flex-direction:column;align-items:flex-start}
}`;

// The founding counter, filled in AFTER paint and never server-rendered.
//
// This is the one thing on this page that needs care, and the reason is the
// caching. `foundingLeft` comes from GET /api/pricing, which is deliberately
// kept OUT of the server-rendered payload: it is a database read, it is
// memoized 60 seconds, and this page is served from an hour-long public cache
// to anonymous visitors. A number rendered into those bytes would be stale for
// up to an hour on a page whose whole claim is scarcity — it would still be
// saying "12 seats left" after the last one sold.
//
// Three states, and they are NOT the same:
//   - billing false, or foundingLeft 0  -> HIDE THE BAND. There is nothing on
//     sale for this visitor (PRO_ENABLED off, or they are outside
//     PRO_AUDIENCE, or the seats are gone), and checkout would refuse the
//     click. Never advertise a seat a checkout will 409.
//   - foundingLeft null                 -> band WITHOUT the counter. null means
//     "unknown" (the database is down or unconfigured), and checkout treats
//     unknown as closed for the CHECKOUT — but the offer itself is still real,
//     so the band stands and simply makes no claim about how many are left.
//     Saying nothing is the only honest option; a guess here is a lie.
//   - a positive number                 -> reveal the counter and fill it in.
//
// No backticks anywhere in this string: it is interpolated into a template
// literal, and one would close it and emit broken JavaScript into the page.
const FOUNDING_JS = `
(function(){
  var band=document.getElementById("prcFm");
  if(!band||!window.fetch)return;
  fetch("/api/pricing",{headers:{accept:"application/json"}})
    .then(function(r){return r.ok?r.json():null})
    .then(function(d){
      if(!d||d.billing===false){band.hidden=true;return;}
      var left=d.foundingLeft;
      if(left===0){band.hidden=true;return;}
      if(typeof left!=="number"||!(left>0))return;
      var n=document.getElementById("prcFmN");
      var lim=document.getElementById("prcFmLimit");
      var box=document.getElementById("prcFmCount");
      if(!n||!box)return;
      n.textContent=String(left);
      if(lim&&typeof d.foundingLimit==="number")lim.textContent=String(d.foundingLimit);
      box.hidden=false;
    })
    .catch(function(){});
})();`;

/**
 * The body of /pricing.
 *
 * @param {object} opts
 * @param {boolean} opts.signedIn   cookie presence — decides the CTA door only.
 * @param {object} opts.pricing     PRICING: monthly, foundingAnnual, firmSeat, minSeats.
 * @param {boolean} opts.billingLive  whether Stripe is configured at all.
 * @returns {string} HTML for marketShell's <main class="wrap">.
 */
function renderPricingPageBody({ signedIn = false, pricing = {}, billingLive = true } = {}) {
  const { monthly = 0, foundingAnnual = 0, firmSeat = 0, minSeats = 2 } = pricing;

  // One door, chosen once. A member already has an account, so sending them to
  // a signup is the bug public-pages.test.js exists to catch; they go to the
  // app's own pricing modal, where the checkout actually lives.
  const buyHref = signedIn ? "/?pricing=1" : "/?auth=signup";
  // "Create an ACCOUNT", not "Create a free account" — the owner rejected the
  // longer string (2026-09-02). faq-page.js's footer CTA moved with it. The
  // word "free" is not lost: the Free tile's own figure is $0 and its CTA says
  // "No card" directly above it, which is the same promise made by the thing
  // that proves it rather than by a button label.
  const buyLabel = signedIn ? "Upgrade to Pro" : "Create an account";

  // Written as words rather than a numeral because it reads as a sentence in
  // the tile ("minimum two seats"), and matches the FAQ's own phrasing.
  const minSeatsWord = minSeats === 2 ? "two" : String(minSeats);

  // Thousands separator by regex rather than toLocaleString: this renders on a
  // server whose locale nobody controls, and a price is the last figure that
  // should change shape with an environment variable.
  const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const tile = ({ lab, fig, per, sum, cta, mid }) =>
    `<div class="tile prc-tile${mid ? " prc-mid" : ""}">` +
    (mid ? `<span class="prc-tag">Most brokers</span>` : "") +
    `<div class="prc-k">${lab}</div>` +
    `<div class="prc-v">${fig}</div>` +
    `<div class="prc-n">${per}</div>` +
    `<p class="prc-sum">${sum}</p>` +
    `<div class="prc-cta">${cta || ""}</div>` +
    `</div>`;

  // Free anchors the comparison, and its summary makes the locked_basis
  // honesty claim: the value range a free account sees really is the number
  // Pro sees (comp-gate.js). That is what makes the paid cells read as an
  // upgrade rather than a paywall, and it is why Free is never omitted.
  const freeTile = tile({
    lab: "Free",
    fig: "$0",
    per: "forever",
    sum: "Every comparable itemized, the same value range Pro sees, a three-year window, five exports a month.",
    cta: `<p style="font-size:13px;margin:0">No card. ${signedIn ? "Your account starts here." : `<a href="/?auth=signup">Create an account &rarr;</a>`}</p>`,
  });

  const proTile = tile({
    lab: "Pro",
    fig: `$${money(monthly)}`,
    per: "per month &middot; cancel any time",
    mid: true,
    sum: "Everything free, plus the ten-year window, unlimited exports, the private comp vault, bulk valuation, the Address Explorer, and your own branding on every report.",
    cta: billingLive
      ? `<p style="margin:0"><a class="btn sm" href="${buyHref}">${buyLabel} &rarr;</a></p>`
      : "",
  });

  // A FULL TILE with its price at the top, not a card after the fold. The
  // "What a firm adds" card that used to close this page is DELETED (owner's
  // call, 2026-09-02): a tier explained three hundred pixels below the grid
  // that prices it is a tier a reader never scrolls to, and it is what buried
  // this one.
  //
  // Its CTA is still "how a firm works", NOT a buy button: a firm
  // subscription is bought by a firm's OWNER for a firm that already exists,
  // with a seat count checkout validates against the current headcount. There
  // is nothing here for somebody who has not made one yet.
  const firmTile = tile({
    lab: "Firm",
    fig: `$${money(firmSeat)}`,
    per: `per seat, per month &middot; minimum ${minSeatsWord} seats`,
    sum: "Everyone in the firm gets Pro, and the firm gets a shared shelf: when someone shares a report, " +
      "it appears in every colleague&rsquo;s workspace, with their name on it and searchable. One bill, paid by the owner.",
    cta: `<p style="margin:0"><a href="/brokers-firms">How a firm works &rarr;</a></p>`,
  });

  // The saving is COMPUTED. It read "$360 per year" in the design, which is
  // right at $100/mo against $840/yr and wrong the moment either figure moves.
  const foundingSaving = monthly * 12 - foundingAnnual;

  // The band is server-rendered only when there is an offer to make at all:
  // no annual rate configured, or no Stripe, and it is not drawn. Everything
  // else — whether seats remain, and how many — is decided after paint by
  // FOUNDING_JS, which can also take the whole band back down.
  const foundingBand = (foundingAnnual && billingLive)
    ? `<div class="prc-fm" id="prcFm">` +
      `<div>` +
      `<div class="prc-fm-lab">Founding member &middot; while seats remain</div>` +
      `<div class="prc-fm-h">Pro at $${money(foundingAnnual)} a year, held for as long as you stay subscribed.</div>` +
      (foundingSaving > 0
        ? `<p class="prc-fm-sub">Saves you $${money(foundingSaving)} per year. Same Pro plan, same features.</p>`
        : `<p class="prc-fm-sub">Same Pro plan, same features.</p>`) +
      `</div>` +
      `<div class="prc-fm-right">` +
      // Ships hidden and is revealed only once a real count comes back. The
      // limit is a placeholder until then for the same reason the count is:
      // FOUNDING_MEMBER_LIMIT is an env var, so it is the server's to state
      // and this page's to be told.
      `<div class="prc-fm-count" id="prcFmCount" hidden>` +
      `<span class="prc-fm-n" id="prcFmN"></span>of <span id="prcFmLimit"></span> seats left` +
      `</div>` +
      `<a class="prc-fm-btn" href="${signedIn ? "/?pricing=1" : "/?auth=signup"}">Claim a seat &rarr;</a>` +
      `</div>` +
      `</div>` +
      `<script>${FOUNDING_JS}</script>`
    : "";

  // The honest answer to "is $X a month worth it". The free column is kept
  // genuinely persuasive on purpose — a page that cannot name a reader who
  // should NOT pay is a page nobody believes about the reader who should.
  const worthRow = (n, text) =>
    `<li><span class="prc-num">${n}</span><span>${text}</span></li>`;

  const worth =
    `<div class="prc-worth">` +
    `<div class="prc-wc prc-wc-pro">` +
    `<h2>Upgrade to Pro if</h2>` +
    `<ul class="prc-wl">` +
    worthRow("01", "You price more than one building a month.") +
    worthRow("02", "You keep a comp book. The vault puts it in every report.") +
    worthRow("03", "You send work out under your own branding.") +
    `</ul></div>` +
    `<div class="prc-wc prc-wc-free">` +
    `<h2>Stay on free if</h2>` +
    `<ul class="prc-wl">` +
    worthRow("01", "You price a building now and then. Free values any address in full.") +
    worthRow("02", "You&rsquo;ve no comp book to upload yet. The vault is most of what you&rsquo;d pay for.") +
    worthRow("03", "You don&rsquo;t send reports out to clients.") +
    `</ul></div>` +
    `</div>`;

  return (
    `<style>${PRICING_CSS}</style>` +
    // No kicker. It shipped as an 18px "Pricing" eyebrow above the H1 and the
    // owner dropped it (2026-09-02): the word already appears in the nav, the
    // URL, the tab title and the first two words of the heading, and an
    // eyebrow that repeats its own headline is furniture.
    `<h1>What CompNinja Costs.</h1>` +
    `<p class="sub">Every plan runs the same valuation on the same data, and every report cites its ` +
    `sources either way. Paying buys a longer window, more exports, your own comp vault, and seats ` +
    `for the people you work with.</p>` +

    `<div class="tiles prc-tiles">${freeTile}${proTile}${firmTile}</div>` +

    foundingBand +
    worth +

    `<p class="disc">Prices in US dollars, billed through Stripe; cancel any time from your own ` +
    `billing portal. A lapsed plan never deletes your vault or your firm's shelf &mdash; access ` +
    `returns when the plan does. Every valuation is an automated estimate, not an appraisal, and ` +
    `CompNinja is not a licensed brokerage: when you need a licensed opinion of value, we connect ` +
    `you with local brokers.</p>`
  );
}

module.exports = { renderPricingPageBody, PRICING_CSS };
