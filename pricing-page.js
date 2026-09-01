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
// TWO RULES a future editor will otherwise break:
//
//   1. THE FIGURES ARE PASSED IN, from PRICING in server.js, which the FAQ
//      answer also reads. They are prose, never the charge — the charge comes
//      from the Stripe price IDs — so their only job is to agree with each
//      other. test/pricing-page.test.js pins the modal to the same constant.
//   2. THIS PAGE NEVER BUYS ANYTHING. Every control hands off to the app
//      (`/?pricing=1`) or to signup. Buying needs the session, the
//      entitlements and — for a firm — an orgId and an ownership check, none
//      of which a cached server-rendered page has. A second path to a charge
//      is the last thing this codebase needs; /api/checkout's no-fallthrough
//      PLANS map exists for exactly that reason.
// ---------------------------------------------------------------------------

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
  const buyLabel = signedIn ? "Upgrade to Pro" : "Create a free account";

  // Written as words rather than a numeral because it reads as a sentence in
  // the tile ("minimum two seats"), and matches the FAQ's own phrasing.
  const minSeatsWord = minSeats === 2 ? "two" : String(minSeats);

  // Thousands separator by regex rather than toLocaleString: this renders on a
  // server whose locale nobody controls, and a price is the last figure that
  // should change shape with an environment variable.
  const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // .tiles/.tile/.k/.v/.n are MARKET_CSS's own, the same set every market page
  // uses for a figure with a label under it. Deliberately NOT index.html's
  // .rd-ledger/.pr-* — those live in the app's stylesheet and in the purged
  // tailwind.css, neither of which a server-rendered page loads, so a class
  // borrowed from there would silently render unstyled. This page adds no CSS
  // at all, which is what keeps it from drifting from the rest of the site.
  const tile = ({ lab, fig, per, sum, cta, mid }) =>
    `<div class="tile"${mid ? ' style="border-color:var(--red)"' : ""}>` +
    `<div class="k"${mid ? ' style="color:var(--red)"' : ""}>${lab}</div>` +
    `<div class="v">${fig}</div>` +
    `<div class="n">${per}</div>` +
    `<p style="font-size:13.5px;color:var(--ink-body);margin:12px 0 0">${sum}</p>` +
    (cta || "") +
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
    cta: `<p style="font-size:13px;margin:12px 0 0">No card. ${signedIn ? "Your account starts here." : `<a href="/?auth=signup">Create an account &rarr;</a>`}</p>`,
  });

  const proTile = tile({
    lab: "Pro",
    fig: `$${monthly}`,
    per: "per month &middot; cancel any time",
    mid: true,
    sum: "Everything free, plus the ten-year window, unlimited exports, the private comp vault, bulk valuation, the Address Explorer, and your own branding on every report.",
    cta: billingLive
      ? `<p><a class="btn sm" href="${buyHref}">${buyLabel}</a></p>`
      : "",
  });

  // The tier this page was built for. Its CTA is "start a firm", NOT a buy
  // button: a firm subscription is bought by a firm's OWNER for a firm that
  // already exists, with a seat count checkout validates against the current
  // headcount. There is nothing here for somebody who has not made one yet.
  const firmTile = tile({
    lab: "Firm",
    fig: `$${firmSeat}`,
    per: `per seat, per month &middot; minimum ${minSeatsWord} seats`,
    sum: `Every seat gets Pro, plus the shared shelf: every report anyone shares lands on every colleague's workspace, attributed and searchable. One bill, held by the firm's owner.`,
    cta: `<p><a href="/brokers-firms">How a firm works &rarr;</a></p>`,
  });

  return (
    `<div class="kicker">Pricing</div>` +
    `<h1>Start alone, free. Bring the firm when it earns it.</h1>` +
    `<p class="sub">Every plan runs the same valuation on the same data, and every report cites its ` +
    `sources either way. Paying buys reach &mdash; a longer window, more exports, your own comp ` +
    `vault, and seats for the people you work with.</p>` +

    `<div class="tiles">${freeTile}${proTile}${firmTile}</div>` +

    // Founding is a footnote, not a fourth column: it is the same Pro plan at
    // an annual rate while seats remain, and giving a closing offer equal
    // visual weight to a standing tier misrepresents both.
    (foundingAnnual
      ? `<p class="disc" style="margin-top:18px">Founding member &mdash; Pro at $${money(foundingAnnual)} a year, ` +
        `against $${money(monthly * 12)} at the monthly rate, for as long as you stay subscribed, while seats remain. ` +
        `<a href="${signedIn ? "/?pricing=1" : "/?auth=signup"}">Claim a seat &rarr;</a></p>`
      : "") +

    `<div class="card" style="margin-top:26px">` +
    `<h2>What a firm adds</h2>` +
    `<p>A firm is a shared shelf. When somebody runs a report and shares it, it lands on every ` +
    `colleague's workspace &mdash; attributed, searchable, and still there for whoever joins next ` +
    `month. Colleagues see only what someone shares: your own reports, portfolio, watchlist and ` +
    `private vault stay yours.</p>` +
    `<p><a href="/brokers-firms">Read how firm accounts work &rarr;</a></p>` +
    `</div>` +

    `<p class="disc">Prices in US dollars, billed through Stripe; cancel any time from your own ` +
    `billing portal. A lapsed plan never deletes your vault or your firm's shelf &mdash; access ` +
    `returns when the plan does. Every valuation is an automated estimate, not an appraisal, and ` +
    `CompNinja is not a licensed brokerage: when you need a licensed opinion of value, we connect ` +
    `you with local brokers.</p>`
  );
}

module.exports = { renderPricingPageBody };
