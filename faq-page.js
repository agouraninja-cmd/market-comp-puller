// ---------------------------------------------------------------------------
// /faq — the questions a stranger asks before they sign up.
//
// Pure, like brokers-firms-page.js, bulk-page.js and guide-1031.js: it takes its
// inputs and returns a string. No I/O, no requires, no clock reads. server.js
// owns the route, the SEO metadata and the shell; this file decides what is
// asked and how it is drawn.
//
// It renders a BODY, not a document — server.js dresses it in marketShell(),
// so it does NOT depend on the purged tailwind.css. It carries its own
// <style> the way bulk-page.js does, in the BODY rather than through
// marketShell's `head`: the head is emitted BEFORE MARKET_CSS, so a rule
// placed there loses to MARKET_CSS on equal specificity and the column width
// below would silently not apply.
//
// WHY THIS PAGE EXISTS (2026-09-01, design 3a/3b). The FAQ was nine
// accordions at the bottom of the landing page, which is the page a stranger
// arrives on and the page that has to sell. The new home page (home-page.js)
// leads with the comp finder instead, and the questions move here — a URL
// that can be linked, indexed and sent in an email, the same argument that
// gave /pricing a page of its own.
//
// TWO RULES a future editor will otherwise break:
//
//   1. ONE ARRAY, TWO SURFACES. FAQ feeds both the visible blocks and the
//      FAQPage JSON-LD server.js emits. Google flags mismatched FAQ markup,
//      and the invisible copy is the one that reaches search results, so
//      never hand-write a question into the markup below.
//   2. EVERY ANSWER IS A PROMISE THE CODE KEEPS. These reach search engines
//      as structured data. Check each against the code before editing one,
//      the way BROKERS_FAQ's and HOW_FAQ's answers were before both were
//      retired into this one array (2026-09-01) — and see
//      the notes on the answers that were corrected off the design
//      before they shipped. `pricing` is passed IN rather than typed, for the
//      reason HOW_FAQ records: the monthly figure has been caught stale
//      twice, and the real charge comes from a Stripe price ID.
// ---------------------------------------------------------------------------

/**
 * The six questions, in the order they render. Read order is also the order
 * Google reads `mainEntity`, so what a stranger asks first comes first.
 *
 * TEN BECAME SIX (2026-09-02, owner's call). The ten included questions
 * nobody actually asks before signing up — how long a report takes, which
 * property types are covered, what "Verified" means — while the two that
 * genuinely gate the decision were missing: "is this an appraisal" and "how
 * accurate is it". Those two now lead.
 *
 * RETIRED, and where each went: What does "Verified" mean (the badge legend
 * on the home page says it in place), How long does a report take, Which
 * property types are covered, What is free and what needs Pro (folded into
 * the cost answer below), Can I use a report in a client deliverable (its
 * export allowance folded into the same answer), Do you cover my market.
 *
 * The SEO consequence was taken deliberately rather than worked around: FAQ
 * feeds the FAQPage JSON-LD, so those four leave the structured data with the
 * page. The owner chose that over keeping them in the array and hiding them,
 * which would break rule 1 above and ship FAQ markup that does not match the
 * visible page — the mismatch Google actually penalizes.
 *
 * @param {object} pricing  server.js's PRICING — { monthly, firmSeat, minSeats }.
 * @returns {Array<[string,string]>} [question, answer] pairs.
 */
function faqEntries(pricing = {}) {
  const monthly = pricing.monthly;
  const seat = pricing.firmSeat;
  const minSeats = pricing.minSeats === 2 ? "two" : pricing.minSeats;
  return [
    // Leads the page because it is the question the brand rule exists for.
    // BRAND.md §4: the owner is not a licensed broker, so "not an appraisal"
    // is a legal position and not a modest turn of phrase. It is also the
    // honest opening — a page that sells for four answers and concedes this
    // one at the bottom has buried it.
    ["Is this an appraisal?",
     "No, and we won’t pretend otherwise. A report is an automated estimate built from comparable " +
     "sales, and it says so on the page and in the export. A lender, a court or the IRS wants a " +
     "licensed appraisal — when you need one, or a licensed opinion of value, we connect you with " +
     "brokers who work that market. Everything short of that is what this is for: pricing a " +
     "listing, checking a seller’s number, deciding whether an offer is worth a drive."],

    // BOTH CLAUSES VERIFIED against the code before shipping (2026-09-02),
    // because the handoff asked for exactly that and offered to cut whichever
    // the code did not keep. Neither had to be cut:
    //   - "the range widens and the report tells you it is thin" is
    //     smallNNote() in index.html: under four sale comps the report says
    //     "Only N sale comps back this range, so it shows the full observed
    //     spread - treat it as a rough guide", and robustPpsfRange stops
    //     trimming, so the band really is the full spread rather than a
    //     narrower interquartile one.
    //   - "drop it and the range recalculates" is the curation path:
    //     includedComps() feeds the math, and excluding a comp moves the hero
    //     and re-renders the trust line with its "N of M" count.
    // Do not soften either sentence without re-checking those two.
    ["How accurate is it?",
     "As accurate as the comps underneath it, which is exactly why we show you all of them. Where " +
     "similar buildings have traded recently, the likely number lands close. Where they haven’t, " +
     "the range widens and the report tells you it is thin rather than hiding it behind a single " +
     "confident figure. If a comp doesn’t belong, drop it and the range recalculates."],

    // KEPT VERBATIM from the answer that shipped 2026-09-01, on the handoff's
    // own instruction. It was already corrected off the design once: the
    // design listed four badges and the enum has five. server.js's
    // normalizeSourceTypes puts every comp on
    // public_record / listing / news / estimate / verified, so an answer that
    // names four is telling a reader a News comp cannot happen. The design
    // said four again this time round; the code still says five.
    // The badge LEGEND on the home page still shows four — a legend is a
    // sample, not a closed list — but this sentence says "each line carries",
    // which is a claim about all of them.
    ["Where do the comps come from?",
     "County recorder and assessor records, active and closed listings, brokerage announcements " +
     "and news, and comps submitted by named local brokers. Each line carries a badge: Verified, " +
     "Public record, Listing, News or Estimate. Anything with unclear provenance is labeled an " +
     "estimate rather than dressed up as a sale."],

    // NEW (2026-09-02). The firm tier was sold on /pricing and explained on
    // /brokers-firms and asked about nowhere, which left the FAQ answering
    // for a single user only.
    //
    // The design closed this answer with "If your shop needs its own terms, a
    // security review or a bigger footprint than seats make sense for, talk
    // to us." CUT, and the handoff asked for exactly this test: the sentence
    // needs a real destination, and there is none. There is no /contact
    // route, no enterprise form and no inbox that guarantees a human reply —
    // info@compninja.co is a footer mailto on the legal pages, not a sales
    // channel anyone is staffing. This is the same rule that killed "Write to
    // us — a person answers" on 2026-09-01, applied to the same page a day
    // later. Restore it only alongside the route it promises.
    ["What changes when the whole firm is on it?",
     "A firm account is one shared shelf. Reports your people share land on it with their name " +
     "attached, searchable by address, market and property type, and still there for whoever joins " +
     "next year — so nobody has to remember to forward anything. Every seat is a Pro seat, the " +
     "owner holds billing and can add or drop seats at any time, and turning on automatic sharing " +
     "only ever covers new work, never reports already run."],

    // A MERGE of the old "Is my data private?" and "What happens to my comps
    // on a report I share?" — one reader's question asked twice.
    //
    // The share half is the REPO's answer, kept word for word, not the
    // design's. The design described only the anonymized case. POST
    // /api/share has three outcomes: a PUBLIC link runs stripPrivateComps and
    // the vault comps are gone entirely; an invited share runs
    // anonymizePrivateComps and they become basis rows; and `canPrivate` lets
    // a member deliberately send a NAMED client the whole comp. Promising
    // "$/SF, size and date only" as the universal answer under-describes the
    // first case and is simply wrong about the third.
    ["Who can see my numbers?",
     "Your price and NOI never leave your browser. Vault comps you upload are visible only to you " +
     "until you deliberately publish one or share it with your firm, and either can be withdrawn. " +
     "On a report you share it depends on the door: on a public link they are removed entirely; on " +
     "a share with a named client or with your firm they appear as $/SF, size and date only — no " +
     "address, no total price, no notes — unless you deliberately send that client the full comp. " +
     "Either way your client’s value range still matches yours to the dollar."],

    // Folds in the two retired money questions: "What is free and what needs
    // Pro" and the export allowance from "Can I use a report in a client
    // deliverable". Both were answering this one.
    //
    // Every figure is INTERPOLATED, including the seat minimum. The design
    // typed "a two-seat minimum" as prose; minSeats is a PRICING field that
    // MUST equal ORG.MIN_SEATS (checkout refuses a firm plan below it by name
    // and number), so a typed word here is the same stale-figure bug the rest
    // of this answer avoids — and test/faq-page.test.js proves it by feeding
    // in numbers the repo does not contain.
    //
    // "unlimited exports" is Pro's, never free's: entitlements.js caps free at
    // FREE_EXPORTS_PER_MONTH and canBrand follows the subscription. The
    // design offered branded exports to everybody once already.
    ["What does it cost, and what’s free?",
     "A free account runs a full report on any commercial address, three years back, with no card. " +
     `Individual Pro is $${monthly} a month and adds the vault, Address Explorer, a ten-year ` +
     `lookback, unlimited exports and your branding. Firms are $${seat} a seat with a ${minSeats}-seat ` +
     "minimum, and every seat is a Pro seat."],
  ];
}

// The page's own rules. Everything else (header, footer, .btn, .kicker) comes
// from MARKET_CSS. Colours are TOKENS, never the design's literal hexes: the
// design was drawn in the light palette, and a literal here is a page that
// does not follow the reader into dark mode. The mapping is exact —
// #FBFBF9 is --paper, #E4E2DA is --line, #D8D4C9 is --edge, #1A2433 is --ink,
// #374253 is --ink-body, #B91C1C is --red.
const FAQ_CSS = `
/* marketShell puts this body inside <main class="wrap">, which is 1120px with
   its own vertical padding. The design's column is 820px and owns its
   padding, so main is neutralised rather than fought with. */
main.wrap{max-width:none;padding:0}
.faqpg{max-width:820px;margin:0 auto;padding:52px 32px 60px}
/* The eyebrow is 18px here, not MARKET_CSS's 11.5px .kicker. It is the same
   size on all three of the design's eyebrows (this one, "Market comp finder"
   and "For firms — Pro version"), which is what makes them read as one
   family across two pages; a 11.5px version of it is a different device. */
.faqeye{font-size:18px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--red);line-height:1.35}
.faqpg h1{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:36px;line-height:1.16;
  color:var(--ink);margin:10px 0 18px}

/* --- The accordions -------------------------------------------------------
   These went the other way once. The blocks they replace were plain <div>s,
   introduced 2026-09-01 precisely BECAUSE closed drawers photograph as
   "nothing changed" in scripts/shot.js and hide answers from a reader
   scanning for one line. The owner asked for the drawers back on 2026-09-02,
   so the objection is defused rather than re-argued:

     - scripts/shot.js already opens every <details> before capture when
       passed --expand: it evaluates a querySelectorAll('details') loop that
       sets d.open = true, and its own --help text names the FAQ accordions
       as the reason. So the screenshot regression keeps its coverage, and
       this page is photographed with --expand.
     - the @media print rule below forces every drawer open on paper, so a
       printed or PDF'd FAQ is the whole document rather than six headings.
     - the FIRST entry ships 'open', so the page never renders as a wall of
       closed rows with nothing to read.
     - JSON-LD is unaffected either way: server.js reads the ARRAY, not the
       DOM, so every answer reaches search results whatever the drawer does.

   Native <details>/<summary> and no JavaScript: keyboard, find-in-page and
   print all work without us writing any of it. */
.faqq{border-top:1px solid var(--line)}
.faqq summary{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;
  padding:20px 0;cursor:pointer;list-style:none}
/* Both are needed: the pseudo-element is WebKit's, 'list-style' is everyone
   else's, and either one left behind puts a second marker beside our own. */
.faqq summary::-webkit-details-marker{display:none}
.faqq summary::marker{content:""}
.faqq summary:focus-visible{outline:2px solid var(--red);outline-offset:3px}
.faqq h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:20px;line-height:1.3;
  color:var(--ink);margin:0}
/* The + that becomes an ×. One glyph rotated 45deg, never two swapped: a
   swap needs a second element and gets the two out of step. */
.faqm{flex:0 0 auto;font-size:22px;line-height:1;color:var(--red);
  transition:transform .18s ease;transform-origin:50% 50%}
.faqq[open] > summary .faqm{transform:rotate(45deg)}
@media (prefers-reduced-motion:reduce){.faqm{transition:none}}
.faqa{padding:0 0 22px}
.faqa p{font-size:14.5px;line-height:1.65;color:var(--ink-body);margin:0;max-width:74ch}

/* Two CTAs, centered, with no sentence over them. The design's "Still have a
   question? Write to us" was dropped on 2026-09-01 and stays dropped: the
   site has no contact route that guarantees a human reply. */
.faqfoot{border-top:1px solid var(--edge);padding-top:26px;margin-top:8px;
  display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
/* Outlined, against MARKET_CSS's solid red .btn beside it. Declared here
   rather than borrowed because MARKET_CSS has no ghost button. */
.faqghost{display:inline-block;background:var(--paper);border:1px solid var(--edge);border-radius:4px;
  padding:10px 18px;font-size:14px;font-weight:600;color:var(--ink);text-decoration:none}
.faqghost:hover{border-color:var(--ink-body)}

/* Paper has no affordance to click, so a closed drawer on paper is content the
   reader simply does not get. Forced open for print and for anything that
   prints to PDF.

   THE OBVIOUS VERSION OF THIS RULE DOES NOTHING, and the handoff asked for the
   obvious version. A 'details > div{display:block!important}' was the correct
   fix when a closed <details> hid its content with display:none on the
   internal slot. Current engines do not: they set 'content-visibility:hidden'
   on the ::details-content pseudo-element, which a display rule on the CHILD
   cannot reach. Measured in Chrome 148 on 2026-09-02 — with only that rule the
   closed row stayed 67px and the answer reported checkVisibility() false; with
   the pseudo-element rule it went to 185px and visible. So the pseudo-element
   rule is the one doing the work here.

   The display rule is KEPT as the fallback for older engines that still use
   the slot, and it is harmless where it does nothing. Do not "simplify" this
   to one line without re-measuring both — the failure is silent, and the way
   it shows up is a printed FAQ that is six headings and no answers. */
@media print{
  .faqq{display:block}
  .faqq::details-content{content-visibility:visible!important;block-size:auto!important}
  .faqq > .faqa{display:block!important}
  /* The +/x marker is an affordance, and paper has nothing to click. */
  .faqm{display:none}
}
@media (max-width:639.98px){
  .faqpg{padding:40px 16px 48px}
  .faqpg h1{font-size:30px}
  .faqfoot{flex-direction:column}
  .faqghost,.faqfoot .btn{text-align:center}
}`;

/**
 * The body of /faq.
 *
 * @param {object} opts
 * @param {boolean} opts.signedIn  cookie presence — decides the CTA door only.
 * @param {object} opts.pricing    server.js's PRICING.
 * @param {function} opts.esc      server.js's escHtml.
 * @returns {string} HTML for marketShell's <main class="wrap">.
 */
function renderFaqPageBody({ signedIn = false, pricing = {}, esc = (s) => s } = {}) {
  // A member already has an account; sending them through a signup door is
  // the bug public-pages.test.js exists to catch on every other public page.
  const startHref = signedIn ? "/desk" : "/?auth=signup";
  // "Create an ACCOUNT", not "Create a FREE account" — the owner rejected the
  // longer string across the site (2026-09-02). pricing-page.js's buyLabel
  // moved with it.
  const startLabel = signedIn ? "Open your workspace" : "Create an account";

  // The first drawer ships open so the page is never a wall of closed rows.
  const blocks = faqEntries(pricing).map(([q, a], i) =>
    `<details class="faqq"${i === 0 ? " open" : ""}>` +
    `<summary><h2>${esc(q)}</h2><span class="faqm" aria-hidden="true">+</span></summary>` +
    `<div class="faqa"><p>${esc(a)}</p></div>` +
    `</details>`).join("");

  return (
    `<style>${FAQ_CSS}</style>` +
    `<div class="faqpg">` +
    `<div class="faqeye">FAQ</div>` +
    // The owner's wording and the owner's capitals (2026-09-02).
    `<h1>Important Clarifying Questions</h1>` +
    // No lead paragraph. The old one ("The ten we are asked most, answered
    // straight") counted the questions, so it was a second place the count
    // had to be kept in step — and it said nothing the H1 does not.
    `<div>${blocks}</div>` +
    // The design closed this row with "Still have a question? Write to us — a
    // person answers." That promise was DROPPED on the owner's call
    // (2026-09-01) rather than pointed at info@compninja.co: the site has no
    // contact route that guarantees a human reply, and the README that
    // shipped the design asked for the route to be confirmed before the
    // sentence shipped. Do not restore it without one. The 2026-09-02 handoff
    // asked the same question again about the firm answer's "talk to us", and
    // got the same answer.
    `<div class="faqfoot">` +
    `<a class="faqghost" href="/">Run a report &rarr;</a>` +
    `<a class="btn" href="${startHref}">${startLabel} &rarr;</a>` +
    `</div>` +
    `</div>`
  );
}

module.exports = { faqEntries, renderFaqPageBody, FAQ_CSS };
