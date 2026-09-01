// ---------------------------------------------------------------------------
// /brokers-firms — "For brokers & firms", the one public page for the
// professional audience (design 4a, 2026-09-01).
//
// It REPLACES /brokers and /firms, which both 301 here. Those were two pitches
// to the same reader: a broker deciding whether to bring their comp book, and
// a broker deciding whether to bring their office. They shared an audience, a
// price answer and a privacy argument, and split the Explore menu in two.
//
// Pure, like firms-page.js before it, bulk-page.js and guide-1031.js: it takes
// its inputs and returns a string. No I/O, no requires, no clock reads.
// server.js owns the route, the SEO metadata and the shell; this file decides
// only how the pitch is drawn.
//
// It renders a BODY, not a document — server.js dresses it in marketShell(),
// so the header, footer, theme boot and account chrome are the site's shared
// ones. Unlike firms-page.js it DOES carry a stylesheet: the design is built
// from full-bleed alternating bands and two illustrative panels that have no
// equivalent in MARKET_CSS, and reusing .card/.grid for them would have meant
// redrawing the design rather than implementing it. The block ships in the
// BODY rather than through marketShell's `head`, which is the /faq and /bulk
// rule and the reason is mechanical: `head` is emitted BEFORE MARKET_CSS, so
// `main.wrap{max-width:none}` placed there would lose on equal specificity
// and every band would stay boxed inside the 1120px column.
//
// FIVE RULES a future editor will otherwise break:
//
//   1. THE SHOP COPY IS PASSED IN, NEVER RETYPED. `shopCopy` comes from
//      org-access.js's SHOP_COPY, the same map the invite email and the
//      create box read. Hand-copying those sentences here would make this the
//      fourth copy and the first to go stale — test/brokers-firms-page.test.js
//      fails the build if any `arrivals` string appears in this file as a
//      literal. The design drew two shop cards with wording of its own; that
//      wording is illustrative and this rule outranks it (the handoff says so).
//      The muted "tell us which one you are" card is the SPARE COLUMN, not a
//      fourth message: it renders only while there are fewer than three kinds,
//      and a third kind takes its place. A kind was added and withdrawn inside
//      ten days (tenant rep, 2026-08-21 to 2026-08-31), so the row's shape is
//      read off the list rather than typed.
//   2. THE PRICES ARE PASSED IN. `pricing` is server.js's PRICING, which
//      /pricing and the FAQ read too. The monthly figure has been caught stale
//      twice; the real charge comes from a Stripe price ID and nothing in the
//      repo can see it, so the least this page can do is not be a third copy.
//   3. EVERY PRIVACY CLAIM IS A PROMISE THE CODE KEEPS. The vault section's
//      "exactly two exits" and the firm ledger's three cells restate
//      org-access.js's never-retroactive auto-share guard, the member veto
//      (`org_members.auto_share`'s nullable third state) and blend-comps.js
//      refusing a firm share the un-anonymized row. These reach search
//      engines. Check each against the code before editing one.
//   4. THE UPLOAD AND VAULT PANELS ARE ILLUSTRATIVE MARKUP, NOT UI. Nothing in
//      them posts, uploads or reads a file, and "Import 214 deals" is a SPAN
//      for that reason — a button-shaped link that goes nowhere is worse than
//      a picture of one. If the real import flow ever differs from what is
//      drawn here, match the real flow; the two claims under it ("nothing is
//      published", "only you can see it") are the part that must survive.
//   5. THE DARK BANDS CARRY LITERAL COLOURS ON PURPOSE. --slab is dark in BOTH
//      themes, so the ink ramp runs backwards on it and a token chosen for
//      light is unreadable in dark (the trap FOOTER_DARK_CSS exists for). The
//      same reasoning MARKET_CSS records for .mkt-hero: a surface that never
//      inverts gets colours that never invert.
//
// The hero PHOTOGRAPH the design shows is deliberately absent. The handoff
// asks for an industrial-park aerial cropped 3.4:1, does not supply one, and
// says to ship without the band rather than with stock filler. Add the band
// back with a real photograph, never with a placeholder.
// ---------------------------------------------------------------------------

"use strict";

// The page's own rules. Everything else — header, footer, .btn, .badge —
// comes from MARKET_CSS.
//
// Colours are TOKENS, never the design's literal hexes, except on the two
// surfaces that are dark in both themes (see rule 5). The mapping is exact:
// #FBFBF9 is --paper, #F5F4EF is --wash, #E4E2DA is --line, #D8D4C9 is --edge,
// #F0EFE9 is --hair, #1A2433 is --ink (or --slab as a surface), #374253 is
// --ink-body, #5A6473 is --ink-mute, #68707E is --ink-3, #8A8F98 is
// --ink-faint, #B91C1C is --red (--red-fill as a button), and the two badges
// are --ok-* and --bv-*, which already hold the design's exact values.
const BF_CSS = `
/* marketShell puts this body inside <main class="wrap">, which is 1120px and
   carries its own vertical padding. The design is full-bleed alternating
   bands, so main is neutralised rather than fought with and each band owns
   its own padding — the /faq rule, for the same reason. */
main.wrap{max-width:none;padding:0}
.bfband{padding:52px 32px}
.bfband.wash{background:var(--wash);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
/* Consecutive bands would otherwise draw a doubled 2px rule. */
.bfband.wash + .bfband.wash{border-top:0}
.bfin{max-width:940px;margin:0 auto}
/* The SMALL eyebrow. /faq's .faqeye is the 18px variant from the same design
   set; this page uses the 10.5px one throughout, and mixing them reads as two
   different devices rather than one family. */
.bfeye{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--red);line-height:1.4}
.bfhero{padding:56px 32px 48px}
.bfhero h1{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:42px;line-height:1.14;
  letter-spacing:-.005em;color:var(--ink);margin:20px 0 0;max-width:20ch}
.bflede{font-size:16px;line-height:1.62;color:var(--ink-body);margin:20px 0 0;max-width:64ch}
.bfacts{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin:24px 0 0}
.bfacts .btn{font-size:15px;padding:12px 24px}
.bfalt{font-size:14px;color:var(--ink-mute);text-decoration:underline;text-decoration-color:var(--edge)}
.bfalt:hover{color:var(--ink)}
/* Section headers. The band's h2 is the serif 29px of the design; .card h2 in
   MARKET_CSS is 19px and belongs to a card, not to a band. */
.bfband h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:29px;line-height:1.2;
  color:var(--ink);margin:8px 0 0;letter-spacing:normal;text-transform:none}
.bfsub{font-size:14.5px;line-height:1.6;color:var(--ink-body);margin:12px 0 0}
.bfhead{display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
.bfhnote{font-size:14.5px;line-height:1.6;color:var(--ink-body);margin:0 0 3px;max-width:38ch}
.bfcard{background:var(--card);border:1px solid var(--edge);border-radius:6px;overflow:hidden;
  margin-top:24px;box-shadow:var(--lift)}

/* --- One - the upload panel (illustrative; see rule 4) --------------------- */
.bfuptop{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 20px;
  border-bottom:1px solid var(--line)}
.bffile{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px;color:var(--ink)}
.bfmeta{font-size:12.5px;color:var(--ink-3);margin-left:12px}
.bffaint{font-size:12px;color:var(--ink-faint)}
.bfupbody{display:grid;grid-template-columns:1fr}
.bfmap{border-bottom:1px solid var(--hair)}
.bfrowhd{padding:9px 20px;background:var(--wash);font-size:10.5px;font-weight:600;letter-spacing:.07em;
  text-transform:uppercase;color:var(--ink-3)}
.bfmap .bfrowhd,.bfmaprow{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.bfmaprow{padding:11px 20px;border-top:1px solid var(--hair);font-size:13.5px;align-items:center;color:var(--ink)}
.bfsrc{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--ink-mute)}
/* The skipped column. --ink-faint is a whisper token, below AA by design,
   which is the correct weight for a row that is being told it was ignored. */
.bfmaprow.skip .bfsrc,.bfmaprow.skip span{color:var(--ink-faint)}
.bfprevrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 20px;
  border-top:1px solid var(--hair)}
.bfprevrow .a{font-size:14px;color:var(--ink)}
.bfprevrow .m{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.bffig{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:18px;color:var(--ink);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.bfmore{padding:11px 20px;border-top:1px solid var(--hair);font-size:12.5px;color:var(--ink-3)}
.bfupfoot{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 20px;
  border-top:1px solid var(--line);background:var(--wash)}
.bfupfoot span:first-child{font-size:13px;color:var(--ink-mute)}
/* A picture of a button, never a link (rule 4). */
.bfghost{background:var(--red-fill);color:#fff;font-size:13px;font-weight:600;padding:8px 16px;
  border-radius:4px;white-space:nowrap}

/* --- Two - the vault --------------------------------------------------- */
.bfvault{display:grid;grid-template-columns:1fr;gap:20px;align-items:start;margin-top:22px}
.bfvcard{background:var(--card);border:1px solid var(--edge);border-radius:6px;box-shadow:var(--lift)}
.bfvhd{padding:11px 18px;border-bottom:1px solid var(--hair);font-size:10.5px;font-weight:600;
  letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.bfvrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 18px;
  border-bottom:1px solid var(--hair)}
.bfvrow .a{font-size:14.5px;color:var(--ink)}
.bfvrow .m{font-size:12.5px;color:var(--ink-3);margin-top:3px}
.bfvrow .bffig{font-size:20px}
.bfvfoot{background:var(--wash);border-top:1px solid var(--hair);padding:12px 18px;font-size:12.5px;
  line-height:1.55;color:var(--ink-mute)}
.bfvfoot strong{color:var(--ink);font-weight:600}
.bfexits{display:flex;flex-direction:column;gap:10px}
.bfexit{background:var(--card);border:1px solid var(--edge);border-radius:6px;padding:16px 18px;box-shadow:var(--lift)}
.bfexit .k{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);
  margin-bottom:6px}
.bfexit p{font-size:13.5px;line-height:1.6;color:var(--ink-body);margin:0}
.bfpro{display:flex;align-items:flex-start;gap:12px;border-top:1px solid var(--line);padding-top:18px;
  margin-top:22px;font-size:13.5px;line-height:1.6;color:var(--ink-mute)}
.bfpro strong{color:var(--ink);font-weight:600}

/* --- Three - the firm ledger and the shops ------------------------------- */
/* NOT .bk/.bkrow. That ledger is a VERTICAL stack of label-beside-body rows;
   this one is three columns side by side with the label above the body, and
   forcing the shared class here would have meant redrawing the design. */
.bfled{background:var(--card);border:1px solid var(--edge);border-radius:6px;display:grid;
  grid-template-columns:1fr;margin-top:22px;overflow:hidden;box-shadow:var(--lift)}
.bfledcell{padding:22px;border-bottom:1px solid var(--hair)}
.bfledcell:last-child{border-bottom:0}
.bfledcell.mid{background:var(--wash)}
.bfledcell .k{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--red);
  margin-bottom:8px}
.bfledcell h3{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:19px;color:var(--ink);
  line-height:1.28;margin:0 0 8px}
.bfledcell p{font-size:13.5px;line-height:1.6;color:var(--ink-body);margin:0}
.bfshops{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
.bfshop{background:var(--card);border:1px solid var(--edge);border-radius:6px;padding:16px 18px;box-shadow:var(--lift)}
.bfshop h3{font-size:13.5px;font-weight:600;color:var(--ink);margin:0 0 4px}
.bfshop p{font-size:13px;line-height:1.55;color:var(--ink-body);margin:0}
.bfshop.spare{display:flex;flex-direction:column;justify-content:center}
.bfshop.spare p{color:var(--ink-3)}

/* --- Price pair ---------------------------------------------------------- */
.bfprice{display:grid;grid-template-columns:1fr;gap:16px}
.bfplan{border:1px solid var(--edge);border-radius:6px;background:var(--card);padding:22px 24px;box-shadow:var(--lift)}
.bfplan .k{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.bfplan .f{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:30px;color:var(--ink);
  font-variant-numeric:tabular-nums;margin:8px 0}
.bfplan .f span{font-family:Inter,system-ui,sans-serif;font-size:15px;color:var(--ink-3)}
.bfplan p{font-size:13.5px;line-height:1.6;color:var(--ink-body);margin:0}

/* --- The two surfaces that are dark in BOTH themes (rule 5) -------------- */
/* --slab is #1A2433 in light and lifts to #243044 in dark, so the SURFACE
   still follows the theme; only the ink on it is pinned, exactly as
   .mkt-hero's caption is. --ink-body's dark value is #B6C1CF and --red's is
   #F87171, so these literals are the tokens' own dark values rather than new
   colours. */
.bfplan.firm{background:var(--slab);border-color:var(--slab)}
.bfplan.firm .k{color:#F87171}
.bfplan.firm .f{color:#fff}
.bfplan.firm .f span,.bfplan.firm p{color:#B6C1CF}
.bfcta{background:var(--slab);padding:44px 32px}
.bfcta .bfin{display:flex;align-items:center;justify-content:space-between;gap:32px;flex-wrap:wrap}
.bfcta h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:28px;color:#fff;margin:0 0 8px}
.bfcta p{font-size:14.5px;color:#B6C1CF;margin:0}
/* The one door onto the comp-submission modal that survived the merge. It is
   a QUERY, never a /#submit-comp fragment: ACCOUNT_WALL decides what "/"
   serves on the server and a fragment never reaches it, which is what left
   every logged-out broker on the landing page with no modal and no anchor. */
.bfcta .sub{display:inline-block;margin-top:12px;font-size:13.5px;color:#B6C1CF;text-decoration:underline;
  text-decoration-color:rgba(182,193,207,.45)}
.bfcta .sub:hover{color:#fff}
.bfcta .btn{background:#DC2626;font-size:15px;padding:12px 26px;white-space:nowrap}
.bfcta .btn:hover{background:#B91C1C}
.bffine{padding:20px 32px 26px}
/* --ink-3, not the --ink-faint the design's #8A8F98 sits nearest. --ink-faint
   is a WHISPER token, deliberately below AA in both themes (2.58:1 light,
   2.80:1 dark), and this paragraph is the page's legal disclosure — the one
   run of small print that has to survive being read. --ink-3 is what the
   site's own .disc already uses for exactly this text. */
.bffine p{max-width:940px;margin:0 auto;font-size:11.5px;line-height:1.6;color:var(--ink-3)}

/* The handoff's breakpoint: below ~900px every 2- and 3-column grid collapses
   and the upload panel stacks with the MAPPING first, because checking the
   mapping is the step the panel is about. Written mobile-first, so the rules
   above are already the stacked case and this is the wide one. */
@media (min-width:900px){
  .bfupbody{grid-template-columns:1fr 1fr}
  .bfmap{border-bottom:0;border-right:1px solid var(--hair)}
  .bfvault{grid-template-columns:1fr 1fr}
  .bfled{grid-template-columns:1fr 1fr 1fr}
  .bfledcell{border-bottom:0;border-right:1px solid var(--hair)}
  .bfledcell:last-child{border-right:0}
  .bfshops{grid-template-columns:repeat(var(--bfshopn,3),minmax(0,1fr))}
  .bfprice{grid-template-columns:1fr 1fr}
}
@media (max-width:639.98px){
  .bfband{padding:40px 16px}
  .bfhero{padding:40px 16px 36px}
  .bfhero h1{font-size:30px}
  .bfhead{display:block}
  .bfhnote{margin-top:14px;max-width:none}
  .bfuptop{flex-wrap:wrap;gap:6px}
  .bfmeta{margin-left:0}
  .bfupfoot{flex-wrap:wrap;gap:12px}
  .bfcta{padding:36px 16px}
  .bffine{padding:20px 16px 26px}
}`;

/**
 * The body of /brokers-firms.
 *
 * @param {object} opts
 * @param {boolean} opts.signedIn   cookie presence — decides the CTA doors only.
 * @param {string[]} opts.shopKinds ORG.SHOP_KINDS, in the order they render.
 * @param {object} opts.shopCopy    ORG.SHOP_COPY — label/arrivals per kind.
 * @param {object} opts.pricing     server.js's PRICING — { monthly, firmSeat, minSeats }.
 * @param {function} opts.esc       server.js's escHtml.
 * @returns {string} HTML for marketShell's <main class="wrap">.
 */
function renderBrokersFirmsPageBody({
  signedIn = false,
  shopKinds = [],
  shopCopy = {},
  pricing = {},
  esc = (s) => s,
} = {}) {
  // The doors that change with auth state. A member already has an account;
  // selling them a signup is the bug public-pages.test.js exists to catch, so
  // the signed-in variant points at their own workspace instead. The
  // signed-out copy is the design's, approved verbatim.
  const startHref = signedIn ? "/desk" : "/?auth=signup";
  const startLabel = signedIn ? "Open your workspace" : "Create an account";

  // Prices, never typed (rule 2). minSeats is spelled in the running prose the
  // design wrote — "min. two" — and falls back to the numeral past two, which
  // is a sentence nobody has had to write yet.
  const minSeats = pricing.minSeats === 2 ? "two" : String(pricing.minSeats);

  // --- One: the upload panel. Illustrative markup (rule 4). ---------------
  const mapRows = [
    ["PROP_ADDR", "Address", false],
    ["CLOSE_DT", "Sale date", false],
    ["BLDG_SQFT", "Building SF", false],
    ["CONSID", "Sale price", false],
    ["INT_NOTES", "Skipped", true],
  ]
    .map(([src, to, skipped]) =>
      `<div class="bfmaprow${skipped ? " skip" : ""}">` +
      `<span class="bfsrc">${src}</span><span>${to}</span></div>`)
    .join("");

  // The same three deals as the vault panel below, on purpose: this is one
  // book being carried from an upload into a report, not two sample datasets.
  const DEALS = [
    ["4130 E Airport Dr", "Mar 26", "19,400 SF", "$218/SF"],
    ["2255 S Vineyard Ave", "Jan 26", "31,200 SF", "$204/SF"],
    ["8710 Rochester Ave", "Sep 25", "44,600 SF", "$186/SF"],
  ];
  const previewRows = DEALS.map(([addr, when, sf, psf]) =>
    `<div class="bfprevrow"><div><div class="a">${addr}</div>` +
    `<div class="m">${when} &middot; ${sf}</div></div>` +
    `<span class="bffig">${psf}</span></div>`).join("");
  const vaultRows = DEALS.map(([addr, when, sf, psf]) =>
    `<div class="bfvrow"><div><div class="a">${addr}</div>` +
    `<div class="m">Closed ${when} &middot; ${sf}</div></div>` +
    `<div class="bffig">${psf}</div></div>`).join("");

  // --- Three: the privacy ledger. Every cell restates a rule enforced in
  // code — see rule 3 in this file's header before editing any of them. -----
  const ledger = [
    ["Yours", "Your own work stays yours",
     "Colleagues see what somebody shares, and nothing else. Your reports, portfolio and " +
     "watchlist never land on the shelf on their own."],
    ["Never retroactive", "Sharing only applies going forward",
     "Turn on automatic sharing and it covers new reports only, never work already run. Your " +
     "own setting beats the firm&#39;s either way."],
    ["The vault stays a vault", "A private book is shared one comp at a time",
     "You share a vault comp one at a time. It never enters CompNinja&#39;s public records, and " +
     "it doesn&#39;t travel whole in a report sent outside the firm."],
  ]
    .map(([lab, head, body], i) =>
      `<div class="bfledcell${i === 1 ? " mid" : ""}">` +
      `<div class="k">${lab}</div><h3>${head}</h3><p>${body}</p></div>`)
    .join("");

  // --- Three: the shop row. Copy from ORG.SHOP_COPY (rule 1). The spare
  // column explains the choice while there is room for it, and a third kind
  // takes its place rather than pushing the row to four. ------------------
  const shopCards = shopKinds
    .map((kind) => {
      const copy = shopCopy[kind] || {};
      return `<div class="bfshop"><h3>${esc(copy.label || "")}</h3>` +
        `<p>Your shelf holds ${esc(copy.arrivals || "")}.</p></div>`;
    })
    .join("");
  const spare = shopKinds.length < 3
    ? `<div class="bfshop spare"><p>Tell us which one you are at signup and the shelf uses ` +
      `your words for it.</p></div>`
    : "";
  const shopCols = shopKinds.length + (spare ? 1 : 0);

  return (
    `<style>${BF_CSS}</style>` +

    // --- Hero. No photograph: see the note at the top of this file. --------
    `<div class="bfband bfhero"><div class="bfin">` +
    `<div class="bfeye">For brokers &amp; firms</div>` +
    `<h1>Your closed deals are comps. Put them to work.</h1>` +
    `<p class="bflede">Upload the comp book you already keep. It stays private, and your deals ` +
    `show up in every report you run. Bring the office and everyone works off one shelf.</p>` +
    `<p class="bfacts"><a class="btn" href="${startHref}">${startLabel} &rarr;</a>` +
    `<a class="bfalt" href="/pricing">See pricing</a></p>` +
    `</div></div>` +

    // --- One - your book --------------------------------------------------
    `<div class="bfband wash"><div class="bfin">` +
    `<div class="bfhead"><div>` +
    `<div class="bfeye">One &middot; your book</div>` +
    `<h2>Bring it in the shape it&#39;s already in.</h2></div>` +
    `<p class="bfhnote">A CSV out of your system, an old comp sheet as a PDF, even a screenshot. ` +
    `We read the columns, you check the mapping, and it&#39;s in.</p></div>` +
    `<div class="bfcard">` +
    `<div class="bfuptop"><div><span class="bffile">comp-book-2026.csv</span>` +
    `<span class="bfmeta">214 rows &middot; 9 columns</span></div>` +
    `<span class="bffaint">CSV &middot; XLSX &middot; PDF &middot; screenshot</span></div>` +
    `<div class="bfupbody">` +
    `<div class="bfmap"><div class="bfrowhd"><span>Your column</span><span>Maps to</span></div>` +
    mapRows + `</div>` +
    `<div class="bfprev"><div class="bfrowhd">Preview &middot; first rows in</div>` +
    previewRows + `<div class="bfmore">+ 211 more</div></div>` +
    `</div>` +
    `<div class="bfupfoot"><span>Nothing here is published. Only you can see it.</span>` +
    `<span class="bfghost">Import 214 deals</span></div>` +
    `</div></div></div>` +

    // --- Two - your vault -------------------------------------------------
    `<div class="bfband"><div class="bfin">` +
    `<div class="bfeye">Two &middot; your vault</div>` +
    `<h2>Your own deals, in your own reports.</h2>` +
    `<p class="bfsub" style="max-width:66ch">Your deals sit next to public records and verified ` +
    `broker submissions, badged <em>From your vault</em>. Send the report out and only the ` +
    `numbers go with it.</p>` +
    `<div class="bfvault">` +
    `<div class="bfvcard">` +
    `<div class="bfvhd">Your vault &middot; 214 deals &middot; visible only to you</div>` +
    vaultRows +
    `<div class="bfvfoot">On a report you share: <strong>$218/SF &middot; 19,400 SF &middot; ` +
    `Mar 26</strong>. No address, no total price, no notes &mdash; and your client&#39;s range ` +
    `still matches yours to the dollar.</div>` +
    `</div>` +
    `<div class="bfexits">` +
    `<div class="bfexit"><div class="k">Exit one &middot; publish</div>` +
    `<p>Publish a comp to CompNinja&#39;s records and it carries a green ` +
    `<span class="badge" style="color:var(--ok-text);background:var(--ok-bg)">Verified</span> ` +
    `badge with your firm&#39;s name on every report that uses it.</p></div>` +
    `<div class="bfexit"><div class="k">Exit two &middot; your firm</div>` +
    `<p>Send a comp to the firm&#39;s shelf, one at a time, with your name on it. Automatic ` +
    `sharing is off unless someone turns it on.</p></div>` +
    // The third card is the CLOSED LIST, which is the claim the two above are
    // only worth anything beside. It is drawn on the dark surface for that
    // reason and carries rule 5's literals.
    `<div class="bfexit bfplan firm" style="padding:16px 18px">` +
    `<div class="k">And that is the whole list</div>` +
    `<p>Both take a deliberate click, and you can take either back. Nothing else leaves the ` +
    `vault.</p></div>` +
    `</div></div>` +
    `<div class="bfpro">` +
    `<span class="badge" style="color:var(--bv-text);background:var(--bv-bg)">Pro</span>` +
    `<span><strong>Address Explorer</strong> needs a paid seat. Drop a pin, set a radius, and ` +
    `see every sale, listing and vault comp we hold around it, yours badged. A free account ` +
    `still runs a full report on one address at a time.</span>` +
    `</div>` +
    `</div></div>` +

    // --- Three - your firm ------------------------------------------------
    `<div class="bfband wash"><div class="bfin">` +
    `<div class="bfeye">Three &middot; your firm</div>` +
    `<h2>Your colleague values a building at 2pm. The firm has it by 2:01.</h2>` +
    `<p class="bfsub" style="max-width:68ch">A firm account gives the office one shelf. Reports ` +
    `people share land on it with their name attached, searchable by address, market and ` +
    `property type, and still there for whoever joins next year. Nobody has to remember to ` +
    `forward anything.</p>` +
    `<div class="bfled">${ledger}</div>` +
    `<div class="bfshops" style="--bfshopn:${shopCols}">${shopCards}${spare}</div>` +
    `</div></div>` +

    // --- The price pair. Figures from PRICING (rule 2). --------------------
    `<div class="bfband" style="border-top:1px solid var(--line);padding:44px 32px 40px">` +
    `<div class="bfin bfprice">` +
    `<div class="bfplan"><div class="k">Individual Pro</div>` +
    `<div class="f">$${pricing.monthly}<span> / month</span></div>` +
    `<p>Unlimited reports, ten years back, the vault, Address Explorer, exports and your ` +
    `branding on them.</p></div>` +
    `<div class="bfplan firm"><div class="k">Firm &middot; every seat gets Pro</div>` +
    `<div class="f">$${pricing.firmSeat}<span> / seat, min. ${minSeats}</span></div>` +
    `<p>Everything in Pro, plus the shelf and the deal board. Whoever owns the account holds ` +
    `billing and can add or drop seats any time.</p></div>` +
    `</div></div>` +

    // --- Closing CTA. Carries the site's only public door onto the
    // comp-submission modal, kept when /brokers was retired. ---------------
    `<div class="bfcta"><div class="bfin">` +
    `<div><h2>Try it before you upload a single row.</h2>` +
    `<p>A free account values any commercial address, three years back.</p>` +
    `<a class="sub" href="/?submit=comp">Have a comp to submit? &rarr;</a></div>` +
    `<a class="btn" href="${startHref}">${startLabel} &rarr;</a>` +
    `</div></div>` +

    // --- Compliance. Not decoration: the owner is not a licensed broker. ---
    `<div class="bffine"><p>Every valuation is an automated estimate, not an appraisal. ` +
    `CompNinja is not a licensed brokerage; when you or a client need a licensed opinion of ` +
    `value, we connect you with local brokers. Comparables derive from publicly available data; ` +
    `verify independently before underwriting.</p></div>`
  );
}

module.exports = { renderBrokersFirmsPageBody, BF_CSS };
