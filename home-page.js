// ---------------------------------------------------------------------------
// The home page — what an anonymous visitor gets at `/` under ACCOUNT_WALL.
//
// Pure, like firms-page.js, faq-page.js and guide-1031.js: it takes its inputs
// and returns a string. No I/O, no requires, no clock reads. server.js owns
// the route, the SEO metadata and the shell.
//
// It renders a BODY, not a document — server.js dresses it in marketShell().
// Its <style> ships in the BODY rather than through marketShell's `head`,
// because the head is emitted BEFORE MARKET_CSS and a rule placed there loses
// on equal specificity (bulk-page.js carries its own style for the same
// reason). That is also what lets `main.wrap` be neutralised below: this page
// is bands, not a 1120px column.
//
// WHY THIS PAGE EXISTS (2026-09-01, design 3a). `/` and /how-it-works were ONE
// render — the same bytes, with /how-it-works canonicalizing to `/`. That page
// opened on the vault, which is a Pro feature, and closed with a nine-question
// FAQ. The new order is the owner's: what the company is, then the thing the
// product does, then proof it did it, then the firm pitch. The methodology
// stayed behind at /how-it-works, which is a page of its own again; the FAQ
// moved to /faq.
//
// FOUR RULES a future editor will otherwise break:
//
//   1. `.heroCta` IS LOAD-BEARING BEYOND LAYOUT. Three suites use its presence
//      to decide WHICH page answered a URL — it is how the account-wall tests
//      tell this page from index.html. It has wrapped an address form, then an
//      account CTA, and now the comp finder. Keep the class name whatever the
//      contents become.
//   2. COLOURS ARE TOKENS, NEVER THE DESIGN'S LITERAL HEXES. The design was
//      drawn in the light palette and its values ARE theme.js's light values
//      (#FBFBF9 --paper, #F5F4EF --wash, #D8D4C9 --edge, #E4E2DA --line,
//      #F0EFE9 --hair, #1A2433 --ink, #374253 --ink-body, #68707E --ink-3,
//      #B91C1C --red). A literal here is a page that does not follow the
//      reader into dark mode. The one exception is the CLOSING BAND, which
//      sits on --slab: that surface is dark in BOTH themes, so the ink ramp
//      runs backwards on it and its text is written literally, exactly as
//      MARKET_FOOTER's is.
//   3. THE SEARCH ROW HANDS OFF, IT DOES NOT SEARCH. The wall forces
//      GUEST_SEARCH_LIMIT to 0, so an anonymous POST to /api/comps is refused
//      by design. The address and the type are stashed in sessionStorage
//      (pendingLandingAddress.v1 / pendingLandingType.v1) and index.html picks
//      them up — the same handoff /1031-exchange and the market pages use. The
//      input carries NO name attribute on purpose: a named field would put a
//      street address on GET /?auth=signup.
//   4. THE SAMPLE REPORT IS ILLUSTRATIVE AND ITS ARITHMETIC HOLDS. The median
//      of the five $/SF values IS $219, "Likely" is that median times 21,600
//      SF, and Low and High are the cheapest and dearest comp times the same
//      size. A visitor who checks it finds it holds, which is the entire pitch
//      of the page it sits on. Keep the "Illustrative" label.
// ---------------------------------------------------------------------------

// The property types the report actually supports, in the design's order.
// Mirrors index.html's hidden #propertyType options — the app is where the
// handoff lands, so a type offered here that it does not know would be
// silently dropped on arrival.
const HOME_TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];

// One illustrative comp set. The figures are internally honest; see rule 4.
const SAMPLE_SIZE_SQFT = "21,600";
const SAMPLE_MEDIAN = "$219";
const SAMPLE_COMPS = [
  ["9020 Center Ave", "May 26", "21,400", "$238", "v", "Verified &middot; via Ridgeline CRE"],
  ["11215 4th St", "Mar 26", "18,750", "$226", "p", "Public record"],
  ["8933 Utica Ave", "Feb 26", "24,100", "$219", "li", "Listing"],
  ["10722 Arrow Route", "Dec 25", "19,900", "$214", "p", "Public record"],
  ["12190 6th St", "Nov 25", "26,300", "$208", "li", "Listing"],
];

// The vault ledger under "For firms". Three rows, the first badged, because
// the badge is here to TEACH the chip a broker meets inside their own report;
// on all three rows it just restates the caption above it three times.
const VAULT_ROWS = [
  ["4130 E Airport Dr", "Mar 26", "19,400", "$218", true],
  ["2255 S Vineyard Ave", "Jan 26", "31,200", "$204", false],
  ["8710 Rochester Ave", "Sep 25", "44,600", "$186", false],
];

const HOME_CSS = `
/* marketShell puts this body inside <main class="wrap">, 1120px with its own
   vertical padding. This page is full-bleed bands that carry their own, so
   main is neutralised rather than fought with. */
main.wrap{max-width:none;padding:0}
/* Full-bleed background, content still in a column. box-shadow + clip-path
   rather than 100vw: 100vw includes the scrollbar and overflows the document
   by its width, which is a horizontal scrollbar on every page that has a
   vertical one. Same device as HOW_CSS's .band. */
.hmband{padding:52px 32px 44px}
.hmband.wash{background:var(--wash);box-shadow:0 0 0 100vmax var(--wash);clip-path:inset(0 -100vmax)}
.hmcol{max-width:900px;margin:0 auto}
/* The one eyebrow style, used identically on all three bands here and on /faq.
   18px, not MARKET_CSS's 11.5px .kicker — at that size it reads as a caption
   rather than as the line that opens a band. */
.hmeye{font-size:18px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--red);line-height:1.35}
.hmh{font-family:Georgia,'Times New Roman',serif;font-weight:500;letter-spacing:-.005em;color:var(--ink);margin:0}

/* --- Band 0: intro ------------------------------------------------------ */
.hmintro{padding:56px 32px 48px;border-bottom:1px solid var(--line)}
.hmintro .hmcol{max-width:940px;display:flex;flex-direction:column;gap:28px}
.hmintro .hmeye{text-align:center}
.hmtwo{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.hmtwo h1,.hmtwo h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:34px;line-height:1.18;
  letter-spacing:-.005em;color:var(--ink);margin:0 0 8px}
.hmtwo p{font-size:15.5px;line-height:1.6;color:var(--ink-body);margin:0}
/* The photo. aspect-ratio holds the 3:1 frame at every width, so the band
   cannot collapse while the image decodes and shove the page down. */
.hmphoto{position:relative;border:1px solid var(--edge);border-radius:6px;overflow:hidden;
  aspect-ratio:3/1;background:var(--wash)}
.hmphoto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 62%;display:block}

/* --- Band 1: market comp finder ----------------------------------------- */
.hmfind{display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center}
.hmfind h2{font-size:38px;line-height:1.14;max-width:22ch}
.hmfind .hmsub{font-size:16px;line-height:1.6;color:var(--ink-body);margin:0;max-width:58ch}
.heroCta{width:100%;max-width:720px;margin-top:10px}
.hmrow{display:flex;gap:8px;width:100%}
/* 16px, not smaller: iOS Safari zooms the page when a field under that size
   takes focus, and this is the one field the page exists to get typed into. */
.hmrow input,.hmrow select{font-size:16px;padding:13px 14px;border:1px solid var(--edge);border-radius:6px;
  background:var(--card);color:var(--ink);font-family:inherit}
.hmrow input{flex:1;min-width:0}
.hmrow input::placeholder{color:var(--ink-3)}
.hmrow select{padding:13px 12px;flex-shrink:0}
/* The placeholder option is greyed while it is the one selected, and only
   then — a chosen type is real text. Driven by a class the script toggles,
   because :has() on a select's own value is not something CSS can ask. */
.hmrow select.ph{color:var(--ink-3)}
.hmrow .btn{border-radius:6px;padding:13px 26px;font-size:15px;flex-shrink:0}
.hmfine{font-size:12.5px;color:var(--ink-3);margin:0}
.hmlegend{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px}
/* Two badge variants MARKET_CSS does not carry (it has .v and .li, and its
   bare .badge already IS public record's neutral). Same tokens index.html's
   own chips use, so the page and the product agree. .bv is an OWNERSHIP
   statement, never provenance — it must never become .badge.v, which is a
   public claim the server awards when a named broker vouches. */
.badge.est{color:var(--est-text);background:var(--est-bg)}
.badge.bv{color:var(--bv-text);background:var(--bv-bg)}
/* Labels the search row needs for its two fields and the design does not
   draw: the placeholder is the visible label, and a placeholder is not one. */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);
  white-space:nowrap;border:0}

/* --- Band 2: sample report ---------------------------------------------- */
.hmreport{padding:8px 32px 56px;display:flex;justify-content:center}
.hmcard{width:100%;max-width:900px;background:var(--card);border:1px solid var(--edge);border-radius:6px;
  box-shadow:var(--lift);overflow:hidden}
.hmcap{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 22px;
  border-bottom:1px solid var(--hair);font-size:10.5px;font-weight:600;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-3)}
.hmcap .ill{color:var(--ink-faint)}
.hmsubj{padding:22px 22px 18px}
.hmaddr{font-family:Georgia,'Times New Roman',serif;font-size:22px;color:var(--ink)}
.hmchips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;font-size:12.5px;color:var(--ink-mute)}
.hmchips span{background:var(--wash);padding:3px 9px;border-radius:4px}
.hmlab{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.hmrange{margin:0 22px;border:1px solid var(--edge);border-radius:6px;display:grid;grid-template-columns:1fr 1fr 1fr}
.hmrcell{padding:20px;border-right:1px solid var(--hair);text-align:center}
.hmrcell:last-child{border-right:0}
.hmrcell.mid{background:var(--wash-2)}
.hmrcell.mid .hmlab{color:var(--red)}
.hmfig{font-family:Georgia,'Times New Roman',serif;font-size:26px;color:var(--ink);font-variant-numeric:tabular-nums;
  margin-top:8px}
.hmrcell.mid .hmfig{font-size:32px}
.hmpsf{font-size:12.5px;color:var(--ink-3);margin-top:4px}
.hmdrv{display:flex;gap:10px;font-size:13.5px;line-height:1.55;color:var(--ink-body)}
.hmdrv .up{color:var(--green)}
.hmdrv .flat{color:var(--ink-3)}
/* The comp table scrolls rather than crushing its columns — five columns at
   375px would put "Ridgeline CRE" on four lines. */
.hmscroll{overflow-x:auto}
.hmtable{min-width:620px}
.hmtr{display:grid;grid-template-columns:2.2fr 1fr 1fr .8fr 1.8fr;padding:10px 22px;border-top:1px solid var(--hair);
  font-size:13.5px;color:var(--ink-body);font-variant-numeric:tabular-nums;align-items:center}
.hmtr.head{padding:9px 22px;background:var(--wash);font-size:10.5px;font-weight:600;letter-spacing:.07em;
  text-transform:uppercase;color:var(--ink-3);border-top:0}
.hmtr.med{border-top:2px solid var(--ink);font-weight:600;color:var(--ink)}
.hmfoot{background:var(--wash);border-top:1px solid var(--hair);padding:14px 22px;font-size:12.5px;
  line-height:1.55;color:var(--ink-mute)}

/* --- Band 3: for firms -------------------------------------------------- */
.hmfirms{border-top:1px solid var(--line);padding:56px 32px 60px}
.hmfirms .hmcol{display:flex;flex-direction:column;gap:32px}
.hmfhead{display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center}
.hmfhead h2{font-size:32px;line-height:1.18;max-width:24ch}
.hmfhead p{font-size:15px;line-height:1.6;color:var(--ink-body);margin:0;max-width:60ch}
/* Hairline mesh: 1px gaps over the border colour, white cells on top. One
   grid rather than three bordered cards, so the rules between them are single
   hairlines instead of doubled borders. */
.hmmesh{display:grid;gap:1px;background:var(--edge);border:1px solid var(--edge);border-radius:6px;overflow:hidden}
.hmmesh>div{background:var(--card)}
.hmsteps{grid-template-columns:1fr 1fr 1fr}
.hmsteps>div{padding:22px}
.hmstep{font-family:Georgia,'Times New Roman',serif;font-size:15px;color:var(--red);margin-bottom:8px}
.hmsteph{font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.25;color:var(--ink);margin-bottom:8px}
.hmstepp{font-size:13.5px;line-height:1.6;color:var(--ink-body)}
.hmvault{background:var(--card);border:1px solid var(--edge);border-radius:6px;overflow:hidden;box-shadow:var(--lift)}
.hmvault .hmcap{padding:12px 20px;letter-spacing:.08em}
.hmvtable{min-width:600px}
.hmvr{display:grid;grid-template-columns:2.4fr 1fr 1fr .9fr 1.5fr;padding:11px 20px;border-top:1px solid var(--hair);
  font-size:13.5px;color:var(--ink-body);font-variant-numeric:tabular-nums;align-items:center}
.hmvr.head{padding:9px 20px;background:var(--wash);font-size:10.5px;font-weight:600;letter-spacing:.07em;
  text-transform:uppercase;color:var(--ink-3);border-top:0}
.hmvr .who{display:flex;gap:6px;align-items:center;white-space:nowrap}
.hmvr .shown{font-size:12.5px;color:var(--ink-3)}
.hmvfoot{background:var(--wash);border-top:1px solid var(--hair);padding:12px 20px;font-size:12.5px;
  line-height:1.55;color:var(--ink-mute)}
.hmmore h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:22px;color:var(--ink);margin:0 0 12px}
.hmtiles{grid-template-columns:repeat(3,1fr)}
.hmtiles>div{padding:18px}
.hmtlab{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--red);margin-bottom:6px}
.hmtp{font-size:13.5px;line-height:1.6;color:var(--ink-body)}
.hmprice{display:flex;align-items:center;justify-content:space-between;gap:24px;border-top:1px solid var(--edge);
  padding-top:20px;font-size:14.5px;line-height:1.6;color:var(--ink-body)}
.hmprice b{color:var(--ink);font-weight:600}
.hmprice a{font-size:14.5px;font-weight:600;white-space:nowrap}

/* --- Closing band ------------------------------------------------------- */
/* --slab is dark in BOTH themes, so the ink ramp runs backwards on it and
   every colour below is written literally — the same rule MARKET_FOOTER and
   CN_LOGO_LIGHT follow, and the trap FOOTER_DARK_CSS exists for. */
.hmclose{background:var(--slab);box-shadow:0 0 0 100vmax var(--slab);clip-path:inset(0 -100vmax);
  padding:48px 32px;text-align:center}
/* Dark only, and not decoration: --wash and --slab are the SAME value in dark
   (#243044 both, theme.js), so this band and the For-firms band above it are
   one continuous charcoal there while in light they are #F5F4EF against
   #1A2433. Measured on the rendered page. A border rather than a token change
   because these two tokens are deliberately equal in dark — they lift for
   different reasons — and the ramp is Jacob's. --edge is #333E4F in dark, a
   step up from the fill, so it reads as a rule and not as a line. */
[data-theme="dark"] .hmclose{border-top:1px solid var(--edge)}
.hmclose h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:27px;color:#fff;margin:0 0 10px}
.hmclose p{font-size:14.5px;line-height:1.6;color:#B6C1CF;margin:0 auto 20px;max-width:52ch}
.hmbtns{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}
.hmclose .btn{background:#DC2626;padding:12px 26px;font-size:15px;border-radius:4px}
.hmclose .btn:hover{background:#B91C1C}
.hmclose .btn2{display:inline-block;border:1px solid #3D4B5F;color:#D5DDE8;font-size:15px;font-weight:600;
  padding:11px 22px;border-radius:4px}
.hmclose .btn2:hover{color:#fff;border-color:#5A6980}

/* --- Below ~900px every 2- and 3-column grid becomes one column, the search
       row stacks, and the photo goes 16:9 so a 3:1 strip does not become a
       60px sliver on a phone. ---------------------------------------------- */
@media (max-width:899.98px){
  .hmband,.hmintro,.hmfirms{padding-left:16px;padding-right:16px}
  .hmreport{padding-left:16px;padding-right:16px}
  .hmtwo,.hmsteps,.hmtiles{grid-template-columns:1fr}
  .hmphoto{aspect-ratio:16/9}
  .hmrow{flex-direction:column}
  .hmrow .btn{width:100%;text-align:center}
  .hmfind h2{font-size:30px}
  .hmtwo h1,.hmtwo h2{font-size:28px}
  .hmfhead h2{font-size:26px}
  .hmrange{grid-template-columns:1fr}
  .hmrcell{border-right:0;border-bottom:1px solid var(--hair)}
  .hmrcell:last-child{border-bottom:0}
  .hmprice{flex-direction:column;align-items:flex-start;gap:12px}
}`;

/**
 * The body of `/`.
 *
 * @param {object} opts
 * @param {boolean} opts.signedIn  cookie presence — decides the CTA doors only.
 * @param {object} opts.pricing    server.js's PRICING — the seat and monthly
 *                                 figures are never typed here.
 * @param {string} opts.photo      URL of the intro band's photograph.
 * @param {string} opts.photoAlt   its alt text.
 * @param {function} opts.esc      server.js's escHtml.
 * @returns {string} HTML for marketShell's <main class="wrap">.
 */
function renderHomePageBody({ signedIn = false, pricing = {}, photo = "", photoAlt = "", esc = (s) => s } = {}) {
  // A member already has an account; sending them through a signup door is the
  // bug public-pages.test.js exists to catch on every other public page. The
  // search row is the exception — it goes to `/` for a member, which is the
  // app, and to the signup door for everyone else.
  const searchDest = signedIn ? "/" : "/?auth=signup";
  const minSeats = pricing.minSeats === 2 ? "two" : pricing.minSeats;

  const typeOptions = [`<option value="">Property type</option>`]
    .concat(HOME_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`)).join("");

  const legend = [
    ["v", "Verified &middot; a local broker vouched"],
    ["p", "Public record &middot; recorder / assessor"],
    ["li", "Listing &middot; active or closed"],
    ["est", "Estimate &middot; provenance unclear"],
  ].map(([cls, label]) => `<span class="badge ${cls}">${label}</span>`).join("");

  const compRows = SAMPLE_COMPS.map(([addr, sold, sf, psf, cls, label]) =>
    `<div class="hmtr"><span>${esc(addr)}</span><span>${esc(sold)}</span><span>${esc(sf)}</span>` +
    `<span>${esc(psf)}</span><span><span class="badge ${cls}">${label}</span></span></div>`).join("");

  const drivers = [
    ["up", "&#9650;", "Inland Empire vacancy tightening near the I-15 corridor"],
    ["up", "&#9650;", "Sub-25K SF buildings trade at a premium: scarce supply"],
    // The en dash in the RANGE is the character, not the entity: this string
    // goes through esc(), which turns "&ndash;" into visible "&ndash;". The
    // MARK beside it is interpolated raw, so it stays an entity.
    ["flat", "&ndash;", "Rate environment holding cap rates near 5.9\u20136.4%"],
  ].map(([cls, mark, text]) =>
    `<div class="hmdrv"><span class="${cls}">${mark}</span><span>${esc(text)}</span></div>`).join("");

  const steps = [
    ["I. Upload", "The book you already keep",
     "A CSV out of your own system, a comp sheet as a PDF, or a screenshot. Confirm the column " +
     "mapping once and 214 deals are in."],
    ["II. Store", "It becomes your vault",
     "Your closed deals appear in your own reports, badged as yours, beside public records and " +
     "verified submissions. Nobody else sees them."],
    ["III. Share", "Ask a colleague directly",
     "Message anyone at the firm from inside a report: request a comp on an address, answer with " +
     "one from your vault, and the thread stays attached to that property. Sharing is per comp, " +
     "off by default, and withdrawable."],
  ].map(([n, h, p]) =>
    `<div><div class="hmstep">${esc(n)}</div><div class="hmsteph">${esc(h)}</div>` +
    `<div class="hmstepp">${esc(p)}</div></div>`).join("");

  const vaultRows = VAULT_ROWS.map(([addr, closed, sf, psf, badged]) =>
    `<div class="hmvr"><span class="who">${esc(addr)}` +
    (badged ? ` <span class="badge bv">Your vault</span>` : "") + `</span>` +
    `<span>${esc(closed)}</span><span>${esc(sf)}</span><span>${esc(psf)}</span>` +
    `<span class="shown">$/SF, size, date only</span></div>`).join("");

  // Six tiles, every one of them a feature that ships today: the Explorer is
  // canExploreAddresses, the lookback is PRO_MAX_LOOKBACK_MONTHS, branding is
  // branding.js, Verified credit is the green badge a published comp earns,
  // the board is deal-board.js and the introductions are the BOV lead route.
  const tiles = [
    ["Address Explorer", "Set a pin and a radius, see every comp we hold around it — yours included."],
    ["Ten-year lookback", "Free reports look back three years. Pro widens the search to ten."],
    ["Your branding", "Reports go out under your firm’s name, with unlimited exports."],
    ["Verified credit", "Publish a comp and it carries your firm’s name on every report that uses it."],
    ["Deal board", "Counts what each member contributed to the shelf — not who is closing what."],
    ["Owner introductions", "When an owner in a market you watch asks for a BOV, we make the introduction by hand."],
  ].map(([lab, p]) =>
    `<div><div class="hmtlab">${esc(lab)}</div><div class="hmtp">${esc(p)}</div></div>`).join("");

  return (
    `<style>${HOME_CSS}</style>` +

    // --- Band 0: what the company is ---------------------------------------
    `<section class="hmband hmintro">` +
    `<div class="hmcol">` +
    `<div class="hmeye">Enterprise software for commercial real estate</div>` +
    `<div class="hmtwo">` +
    `<div><h1>Data storage</h1><p>Your firm’s comp book in one private vault, not eleven ` +
    `spreadsheets. Upload once and your closed deals sit inside every report you run, badged ` +
    `as yours.</p></div>` +
    `<div><h2>Research</h2><p>A cited comp report on any commercial address in about a minute ` +
    `— public records, listings and verified broker submissions, with the source disclosed on ` +
    `every line.</p></div>` +
    `</div>` +
    // width/height are the asset's own pixels: they give the browser the
    // aspect ratio before the bytes arrive, so nothing reflows around it.
    // loading is eager and fetchpriority high — this is the LCP image.
    `<div class="hmphoto"><img src="${esc(photo)}" alt="${esc(photoAlt)}" width="612" height="395" ` +
    `fetchpriority="high" decoding="async"></div>` +
    `</div></section>` +

    // --- Band 1: the thing the product does --------------------------------
    `<section class="hmband hmfind">` +
    `<div class="hmeye">Market comp finder</div>` +
    `<h2 class="hmh">Build a Comp Report</h2>` +
    `<p class="hmsub">Type any commercial address. We search live, pull the comparable sales ` +
    `behind it, and put a source on every line.</p>` +
    // See rule 1: the class is what three suites use to identify this page.
    `<div class="heroCta">` +
    `<form id="homeSearch" class="hmrow" action="${searchDest}" method="get">` +
    `<label class="sr-only" for="homeAddress">Address</label>` +
    `<input id="homeAddress" type="text" required autocomplete="street-address" placeholder="Enter an address">` +
    `<label class="sr-only" for="homeType">Property type</label>` +
    `<select id="homeType" class="ph">${typeOptions}</select>` +
    `<button class="btn" type="submit">Run a report</button>` +
    `</form></div>` +
    `<p class="hmfine">Free account &middot; about a minute &middot; an automated estimate, not an appraisal.</p>` +
    `<div class="hmlegend">${legend}</div>` +
    `</section>` +

    // --- Band 2: proof it did it -------------------------------------------
    `<section class="hmreport"><div class="hmcard">` +
    `<div class="hmcap"><span>Sample report &middot; Industrial &middot; Rancho Cucamonga, CA</span>` +
    `<span class="ill">Illustrative</span></div>` +
    `<div class="hmsubj">` +
    `<div class="hmaddr">9020 Center Ave, Rancho Cucamonga, CA</div>` +
    `<div class="hmchips"><span>Industrial</span><span>${SAMPLE_SIZE_SQFT} SF &middot; public record</span>` +
    `<span>24-month lookback</span><span>5 comparables</span></div>` +
    `</div>` +
    `<div style="padding:0 22px 6px" class="hmlab">What this building is worth &middot; from 5 comparable sales</div>` +
    `<div class="hmrange">` +
    `<div class="hmrcell"><div class="hmlab">Low</div><div class="hmfig">$4,580,000</div>` +
    `<div class="hmpsf">at $212/SF</div></div>` +
    `<div class="hmrcell mid"><div class="hmlab">Likely</div><div class="hmfig">$4,730,000</div>` +
    `<div class="hmpsf">at ${SAMPLE_MEDIAN}/SF &middot; comp median</div></div>` +
    `<div class="hmrcell"><div class="hmlab">High</div><div class="hmfig">$5,140,000</div>` +
    `<div class="hmpsf">at $238/SF</div></div>` +
    `</div>` +
    `<div style="padding:22px">` +
    `<div class="hmlab" style="margin-bottom:10px">What&#39;s driving prices here</div>` +
    `<div style="display:flex;flex-direction:column;gap:8px">${drivers}</div>` +
    `</div>` +
    `<div style="border-top:1px solid var(--edge)">` +
    `<div class="hmcap" style="border-bottom:0;padding-bottom:8px"><span>Comparable properties</span>` +
    `<span class="ill">source badged per comp</span></div>` +
    `<div class="hmscroll"><div class="hmtable">` +
    `<div class="hmtr head"><span>Address</span><span>Sold</span><span>SF</span><span>$/SF</span><span>Source</span></div>` +
    compRows +
    `<div class="hmtr med"><span>Median of 5 sale comps</span><span></span><span></span>` +
    `<span>${SAMPLE_MEDIAN}</span><span></span></div>` +
    `</div></div></div>` +
    `<div class="hmfoot">Your price and NOI never leave your browser.</div>` +
    `</div></section>` +

    // --- Band 3: the firm pitch --------------------------------------------
    `<section class="hmband wash hmfirms"><div class="hmcol">` +
    `<div class="hmfhead">` +
    `<div class="hmeye">For firms — Pro version</div>` +
    `<h2 class="hmh">Your shop’s comp book, working inside every report.</h2>` +
    `<p>Brokerage and development shops run on deals they closed themselves. Upload that book ` +
    `once and it becomes a private vault — yours on every report, shared only where you say so.</p>` +
    `</div>` +
    `<div class="hmmesh hmsteps">${steps}</div>` +
    `<div class="hmvault">` +
    `<div class="hmcap"><span>Your vault &middot; 214 deals &middot; visible only to you</span>` +
    `<span class="ill">Illustrative</span></div>` +
    `<div class="hmscroll"><div class="hmvtable">` +
    `<div class="hmvr head"><span>Address</span><span>Closed</span><span>SF</span><span>$/SF</span>` +
    `<span>On a shared report</span></div>` +
    vaultRows +
    `</div></div>` +
    `<div class="hmvfoot">No address, no total price, no notes leave the vault — and your ` +
    `client’s value range still matches yours to the dollar.</div>` +
    `</div>` +
    `<div class="hmmore"><h2>Additional features offered</h2>` +
    `<div class="hmmesh hmtiles">${tiles}</div></div>` +
    // The figures come from PRICING, never typed here. This line, /pricing and
    // the FAQ's cost answer are three public statements of one number, and the
    // monthly figure has been caught stale twice.
    `<div class="hmprice"><div>Put the whole office on one plan — <b>$${pricing.firmSeat} a seat</b>, ` +
    `minimum ${minSeats}. Individual Pro is $${pricing.monthly} a month.</div>` +
    `<a href="/firms">For firms &rarr;</a></div>` +
    `</div></section>` +

    // --- Closing band, its own section, NOT inside For firms ---------------
    `<section class="hmclose">` +
    `<h2>Start with a free account.</h2>` +
    `<p>Full report on any property, no card. Pro adds the vault, a ten-year lookback, exports ` +
    `and your branding.</p>` +
    `<div class="hmbtns">` +
    (signedIn
      ? `<a class="btn" href="/desk">Open your workspace &rarr;</a>`
      : `<a class="btn" href="/?auth=signup">Create a free account &rarr;</a>` +
        `<a class="btn2" href="/?auth=signin">Sign in</a>`) +
    `</div></section>`
  );
}

// The form's handoff. Not a search: the wall forces GUEST_SEARCH_LIMIT to 0,
// so an anonymous POST to /api/comps is refused by design (rule 3). The typed
// address and the chosen type are stashed and index.html picks them up on the
// other side, which is the same route /1031-exchange and the market pages
// take. Both keys are test-pinned against index.html's reads, because a
// rename on one side alone just quietly stops carrying the visitor's typing.
//
// The type is written ONLY when one was chosen. The placeholder option has an
// empty value on purpose — "Property type" must never submit as Industrial,
// which is what a plain first option would have meant.
const HOME_SEARCH_JS = `<script>
(function(){
  var f=document.getElementById("homeSearch");
  if(!f)return;
  var sel=document.getElementById("homeType");
  if(sel)sel.addEventListener("change",function(){sel.classList.toggle("ph",!sel.value);});
  f.addEventListener("submit",function(e){
    e.preventDefault();
    var el=document.getElementById("homeAddress");
    var addr=((el&&el.value)||"").trim();
    if(!addr)return;
    try{
      sessionStorage.setItem("pendingLandingAddress.v1",addr);
      if(sel&&sel.value)sessionStorage.setItem("pendingLandingType.v1",sel.value);
      else sessionStorage.removeItem("pendingLandingType.v1");
    }catch(err){}
    location.href=f.getAttribute("action");
  });
})();
</script>`;

module.exports = {
  renderHomePageBody,
  HOME_CSS,
  HOME_SEARCH_JS,
  HOME_TYPES,
  SAMPLE_MEDIAN,
};
