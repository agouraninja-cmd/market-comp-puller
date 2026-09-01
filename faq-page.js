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
//      the notes on the four answers that were corrected off the design
//      before they shipped. `pricing` is passed IN rather than typed, for the
//      reason HOW_FAQ records: the monthly figure has been caught stale
//      twice, and the real charge comes from a Stripe price ID.
// ---------------------------------------------------------------------------

/**
 * The ten questions, in the order they render. Read order is also the order
 * Google reads `mainEntity`, so what a stranger asks first comes first.
 *
 * @param {object} pricing  server.js's PRICING — { monthly, firmSeat, minSeats }.
 * @returns {Array<[string,string]>} [question, answer] pairs.
 */
function faqEntries(pricing = {}) {
  const monthly = pricing.monthly;
  const seat = pricing.firmSeat;
  const minSeats = pricing.minSeats === 2 ? "two" : pricing.minSeats;
  return [
    ["What exactly do I get from a report?",
     "An estimated value range — low, likely, high — built from the median of recent comparable " +
     "sales, plus every comparable itemized with its date, size, $/SF and a disclosed source. It " +
     "is an automated estimate, not an appraisal."],

    // CORRECTED off the design: it listed four badges and the enum has five.
    // server.js's normalizeSourceTypes puts every comp on
    // public_record / listing / news / estimate / verified, so an answer that
    // names four is telling a reader a News comp cannot happen. The badge
    // LEGEND on the home page still shows four — a legend is a sample, not a
    // closed list — but this sentence says "each line carries", which is a
    // claim about all of them.
    ["Where do the comps come from?",
     "County recorder and assessor records, active and closed listings, brokerage announcements " +
     "and news, and comps submitted by named local brokers. Each line carries a badge: Verified, " +
     "Public record, Listing, News or Estimate. Anything with unclear provenance is labeled an " +
     "estimate rather than dressed up as a sale."],

    ["What does “Verified” mean?",
     "A named local broker submitted the comp and we reviewed it before publishing. Their firm’s " +
     "name travels with the comp on every report that uses it."],

    // CORRECTED off the design, which said the search "runs live rather than
    // against a stale cache". That is the exact sentence deleted from the
    // landing page on 2026-08-21, and for the same reason: it is no longer
    // true. runCompSearch checks the report cache, then the derivable window,
    // then retrieveCorpusComps — every search reads what we already hold
    // before anything is billed. The stored comps are the asset; an answer
    // that calls reading them shoddy is selling against the product.
    ["How long does a report take?",
     "About a minute. We check what we already hold, then search live for anything missing, so a " +
     "sale recorded last week can appear in today’s report."],

    ["Which property types are covered?",
     "Industrial, office, retail, multifamily, land and residential — each priced on its own " +
     "specifics rather than a single generic model."],

    ["Is my data private?",
     "Your price and NOI never leave your browser. Vault comps you upload are visible only to you " +
     "until you deliberately publish one or share it with your firm, and either can be withdrawn."],

    // CORRECTED off the design, which described only the anonymized case.
    // POST /api/share has three outcomes, not one: a PUBLIC link runs
    // stripPrivateComps and the vault comps are gone entirely; an invited
    // share runs anonymizePrivateComps and they become basis rows; and
    // `canPrivate` lets a member deliberately send a NAMED client the whole
    // comp. Promising "$/SF, size and date only" as the universal answer
    // under-describes the first case and is simply wrong about the third.
    ["What happens to my comps on a report I share?",
     "On a public link they are removed entirely. On a share with a named client or with your " +
     "firm they appear as $/SF, size and date only — no address, no total price, no notes — " +
     "unless you deliberately send that client the full comp. Either way your client’s value " +
     "range still matches yours to the dollar."],

    ["What is free and what needs Pro?",
     "A free account runs a full report on any address with a three-year lookback. Pro adds the " +
     "vault, Address Explorer, a ten-year lookback, unlimited exports and your firm’s branding."],

    ["What does it cost?",
     `Individual Pro is $${monthly} a month. Firms are $${seat} a seat with a ${minSeats}-seat ` +
     "minimum. Reports stay free."],

    // CORRECTED off the design, which offered branded exports to everybody.
    // entitlements.js: FREE_EXPORTS_PER_MONTH is 5 and branding is Pro-only
    // (canBrand follows the subscription), so the design's answer sold a Pro
    // feature as part of the free tier.
    ["Can I use a report in a client deliverable?",
     "Yes. Export it as PDF or CSV — five reports a month on a free account, unlimited on Pro, " +
     "which also puts your own branding on them. It carries a line stating it is an automated " +
     "estimate and not an appraisal, which you should leave in place."],
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
  color:var(--ink);margin:10px 0 6px}
.faqlead{font-size:15px;line-height:1.6;color:var(--ink-body);margin:0 0 12px}
/* Plain blocks, not <details>. The accordions they replace hid the answers
   from scripts/shot.js (a closed drawer photographs as "nothing changed") and
   from a reader scanning for one line, and this page has nothing else on it
   to make room for. */
.faqq{border-top:1px solid var(--line);padding:20px 0}
.faqq h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:20px;line-height:1.3;
  color:var(--ink);margin:0 0 8px}
.faqq p{font-size:14.5px;line-height:1.65;color:var(--ink-body);margin:0;max-width:74ch}
.faqfoot{border-top:1px solid var(--edge);padding-top:22px;margin-top:8px}
@media (max-width:639.98px){
  .faqpg{padding:40px 16px 48px}
  .faqpg h1{font-size:30px}
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
  const startLabel = signedIn ? "Open your workspace" : "Create a free account";

  const blocks = faqEntries(pricing).map(([q, a]) =>
    `<div class="faqq"><h2>${esc(q)}</h2><p>${esc(a)}</p></div>`).join("");

  return (
    `<style>${FAQ_CSS}</style>` +
    `<div class="faqpg">` +
    `<div class="faqeye">FAQ</div>` +
    `<h1>Questions we get before people sign up.</h1>` +
    `<p class="faqlead">The ten we are asked most, answered straight.</p>` +
    `<div>${blocks}</div>` +
    // The design closed this row with "Still have a question? Write to us — a
    // person answers." That promise was DROPPED on the owner's call
    // (2026-09-01) rather than pointed at info@compninja.co: the site has no
    // contact route that guarantees a human reply, and the README that
    // shipped the design asked for the route to be confirmed before the
    // sentence shipped. Do not restore it without one.
    `<div class="faqfoot"><a class="btn" href="${startHref}">${startLabel} &rarr;</a></div>` +
    `</div>`
  );
}

module.exports = { faqEntries, renderFaqPageBody, FAQ_CSS };
