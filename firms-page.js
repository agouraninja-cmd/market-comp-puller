// ---------------------------------------------------------------------------
// /firms — the public front door for firm accounts.
//
// Pure, like bulk-page.js, vault-page.js and guide-1031.js: it takes its
// inputs and returns a string. No I/O, no requires, no clock reads. server.js
// owns the route, the SEO metadata and the shell; this file only decides how
// the pitch is drawn.
//
// It renders a BODY, not a document — server.js dresses it in marketShell(),
// so it carries no CSS of its own and does NOT depend on the purged
// tailwind.css. Every class here already exists in MARKET_CSS (.kicker, .sub,
// .card, .grid, .bk/.bkrow, .cta, .btn, .disc), which is deliberate: a page
// that needs no new rules cannot drift from the rest of the site's chrome.
//
// WHY THIS PAGE EXISTS. The firm feature has been complete on the backend
// since migration 030 — orgs, the shared shelf, invites, auto-share, shared
// vault comps, per-seat billing, the shop kinds — and had NO public surface
// at all: nothing in the nav, nothing in the footer, no tier on the pricing
// modal. The only door was an invite email, which only reaches somebody a
// member already knows. A broker asking "what does this cost for my team"
// could not be sent a link.
//
// TWO RULES a future editor will otherwise break:
//
//   1. THE SHOP COPY IS PASSED IN, NEVER RETYPED. `shopCopy` comes from
//      org-access.js's SHOP_COPY, the same map the invite email and the
//      create box read. Hand-copying those sentences here would make this the
//      fourth copy and the first to go stale — test/firms-page.test.js fails
//      the build if any of the `arrivals` strings appears in this file as a
//      literal. The HEADING over those cards counts them the same way, off
//      shopKinds.length rather than a typed numeral: a kind was added and
//      withdrawn inside ten days (tenant rep, 2026-08-21 to 2026-08-31), and
//      a page that says "three" over two cards is the drift this rule is
//      about.
//   2. EVERY PRIVACY CLAIM BELOW IS A PROMISE THE CODE KEEPS. "Never
//      retroactive" is org-access.js's auto-share guard; the member veto that
//      beats the firm is `org_members.auto_share`'s nullable third state; "no
//      whole vault comp travels" is blend-comps.js refusing a firm share the
//      un-anonymized row. These reach search engines. Check each against the
//      code before editing one, the way the /brokers FAQ answers are checked.
// ---------------------------------------------------------------------------

/**
 * The body of /firms.
 *
 * @param {object} opts
 * @param {boolean} opts.signedIn  cookie presence — decides the CTA door only.
 * @param {string[]} opts.shopKinds  ORG.SHOP_KINDS, in the order they render.
 * @param {object} opts.shopCopy   ORG.SHOP_COPY — label/arrivals per kind.
 * @returns {string} HTML for marketShell's <main class="wrap">.
 */
function renderFirmsPageBody({ signedIn = false, shopKinds = [], shopCopy = {} } = {}) {
  // The one door that changes with auth state. A member already has an
  // account; sending them to a signup is the bug public-pages.test.js exists
  // to catch, so the signed-in variant points at their own workspace instead.
  const startHref = signedIn ? "/desk" : "/?auth=signup";

  // What each shop is told its shelf will hold. The sentence is dropped
  // mid-clause, which is why `arrivals` is lower case with no final stop.
  //
  // The count in the heading below is read off this same list. Spelled rather
  // than digits (it sits in running prose); past four it falls back to the
  // numeral, which is a heading nobody has had to write yet.
  const COUNT_WORDS = ["no", "one", "two", "three", "four"];
  const shopCount = COUNT_WORDS[shopKinds.length] || String(shopKinds.length);
  const shopCards = shopKinds
    .map((kind) => {
      const copy = shopCopy[kind] || {};
      return (
        `<div class="card">` +
        `<h2>${copy.label || ""}</h2>` +
        `<p>Your shelf holds ${copy.arrivals || ""}.</p>` +
        `</div>`
      );
    })
    .join("");

  // The privacy ledger. Three rows, each restating a rule enforced in code —
  // see rule 2 in this file's header before editing any of them.
  const privacyRows = [
    [
      "YOURS",
      "Your own work stays yours",
      "Colleagues see only what someone shares with the firm. Your own reports, " +
        "portfolio and watchlist never appear on the shelf uninvited.",
    ],
    [
      "NEVER RETROACTIVE",
      "Sharing only ever applies going forward",
      "If a firm turns on automatic sharing, it applies to new reports only — never " +
        "to work already run. Every member also holds a personal setting that beats " +
        "the firm's.",
    ],
    [
      "THE VAULT STAYS A VAULT",
      "A private book is shared one comp at a time",
      "A broker shares a vault comp deliberately, with their name on it. Nothing " +
        "shared with a firm enters CompNinja's public records, and no whole private " +
        "comp travels in a report sent outside the firm.",
    ],
  ];
  const privacyLedger =
    `<div class="bk">` +
    privacyRows
      .map(
        ([lab, head, body]) =>
          `<div class="bkrow">` +
          `<div class="kicker">${lab}</div>` +
          `<h3 style="font-size:15px;font-weight:600;color:var(--ink);margin:0">${head}</h3>` +
          `<p style="margin:0;color:var(--ink-body);font-size:14px">${body}</p>` +
          `</div>`,
      )
      .join("") +
    `</div>`;

  return (
    // --- Hero ---------------------------------------------------------------
    `<div class="kicker">Firm accounts</div>` +
    `<h1>Your colleague values a building at 2pm.<br/>The whole firm has it by 2:01.</h1>` +
    `<p class="sub">Real estate is a community business — a deal moves on the parallel work of ` +
    `many professionals. A firm on CompNinja is one shared shelf where that work lands: every ` +
    `report anyone shares, organized, attributed, and searchable by the whole shop.</p>` +
    `<p style="margin:0 0 30px"><a class="btn" href="${startHref}">Start a firm &rarr;</a>` +
    `<a class="alt" style="display:inline-block;margin-left:18px;font-size:13.5px;color:var(--ink-mute);text-decoration:underline;text-decoration-color:var(--edge)" href="/pricing">See pricing</a></p>` +

    // --- What a shelf is ----------------------------------------------------
    `<div class="card">` +
    `<h2>One shelf, and everyone is looking at it</h2>` +
    `<p>When somebody runs a report and shares it with the firm, it lands on every colleague's ` +
    `workspace — attributed, searchable by address, market and property type, and still there ` +
    `for the person who joins next month. The shelf is the firm's record of what it has valued ` +
    `and on what evidence.</p>` +
    `<p>Nobody has to remember to forward anything, and market expectations stop living in one ` +
    `person's inbox.</p>` +
    `</div>` +

    // --- The shops ----------------------------------------------------------
    `<div class="kicker" style="margin-top:34px">One shelf, ${shopCount} kinds of shop</div>` +
    `<h2 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:22px;color:var(--ink);margin:10px 0 4px">` +
    `Tell us what kind of shop you are, and the shelf speaks your language.</h2>` +
    `<div class="grid">${shopCards}</div>` +

    // --- What stays private -------------------------------------------------
    `<div class="kicker" style="margin-top:34px">What stays private</div>` +
    `<h2 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:22px;color:var(--ink);margin:10px 0 4px">` +
    `A shared shelf is not a shared account.</h2>` +
    privacyLedger +

    // --- Seats --------------------------------------------------------------
    `<div class="cta"><h2>Every seat gets Pro</h2>` +
    `<p>Unlimited reports, a ten-year lookback, exports and report branding — plus the shared ` +
    `shelf, the deal board, and the firm's own record of its work. The firm's owner holds the ` +
    `billing and can add or remove seats at any time.</p>` +
    `<a class="btn" href="/pricing">See pricing &rarr;</a></div>` +

    // --- Compliance. Not decoration: the owner is not a licensed broker. -----
    `<p class="disc">Every valuation on the shelf is an automated estimate, not an appraisal. ` +
    `CompNinja is not a licensed brokerage — when you or a client need a licensed opinion of ` +
    `value, we connect you with local brokers. Comparables derive from publicly available data; ` +
    `verify independently before underwriting.</p>`
  );
}

module.exports = { renderFirmsPageBody };
