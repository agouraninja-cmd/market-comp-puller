// The home page's sample report — its figures are the product's own answer.
//
// Run: npm test
//
// Cost: zero. Pure: it renders home-page.js's body and runs valuation.js on
// the same five comps. No server, no clock.
//
// WHY THIS FILE EXISTS. home-page.js's rule 4 promised that the sample's
// arithmetic holds, and until 2026-10-07 it did not: the page
// showed a plain median and the dearest comp as High ($5,140,000 at $238/SF),
// while valueFromComps on those same comps returned a weighted interquartile
// band ($4,975,000 at ~$231/SF), and two of the three totals were off
// heroRound's $25,000 grid. Nothing ran the real function against the page,
// so nothing noticed. This does, and it fails the build the next time a comp
// is edited without re-deriving all three figures.

const test = require("node:test");
const assert = require("node:assert");
const VALUATION = require("../valuation");
const {
  renderHomePageBody, SAMPLE_ADDRESS, SAMPLE_SIZE_SQFT, SAMPLE_COMPS, SAMPLE_RANGE,
} = require("../home-page");

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// The badge class on each row IS the source tier compWeight reads. A class
// missing here is a new badge on the sample, and this file has to learn what
// it weighs before the page may claim the arithmetic holds.
const TIER_OF_BADGE = {
  v: { verified: true },
  p: { source_type: "public_record" },
  li: { source_type: "listing" },
  n: { source_type: "news" },
  est: { source_type: "estimate" },
};
const num = (s) => Number(String(s).replace(/[$,]/g, ""));
const usd = (n) => "$" + n.toLocaleString("en-US");
const SF = num(SAMPLE_SIZE_SQFT);

// "May 26" is shown; mid-month is what it is taken to mean.
function compOf([address, sold, sf, psf, cls]) {
  const [mon, yy] = sold.split(" ");
  assert.ok(mon in MONTHS && /^\d\d$/.test(yy), "unreadable sale date on the sample: " + sold);
  assert.ok(cls in TIER_OF_BADGE, "the sample uses a badge this test does not weigh: " + cls);
  const date = new Date(Date.UTC(2000 + Number(yy), MONTHS[mon], 15)).toISOString().slice(0, 10);
  return { address, date, size_sqft: num(sf), price_per_sqft: num(psf), transaction: "Sale", ...TIER_OF_BADGE[cls] };
}

const comps = SAMPLE_COMPS.map(compOf);
const valueAt = (asOf) => VALUATION.valueFromComps(comps, { subjectSF: SF, asOf, propertyType: "Industrial" });

test("the sample's Low, Likely and High are what valueFromComps returns", () => {
  const r = valueAt(Date.parse("2026-10-07"));
  assert.ok(r && r.trimmed, "five comps take the weighted trimmed band, not the full spread");
  for (const [key, total, psf] of [["low", r.low, r.psfLow], ["mid", r.mid, r.psfMid], ["high", r.high, r.psfHigh]]) {
    assert.equal(SAMPLE_RANGE[key].value, usd(total), key + ": the page's total is not the product's");
    assert.equal(SAMPLE_RANGE[key].psf, usd(Math.round(psf)), key + ": the page's $/SF is not the product's");
  }
});

test("each figure checks: its whole-dollar $/SF times the size, rounded, is the total", () => {
  for (const key of ["low", "mid", "high"]) {
    const { value, psf } = SAMPLE_RANGE[key];
    assert.equal(VALUATION.heroRound(num(psf) * SF), num(value),
      key + ": " + psf + " x " + SAMPLE_SIZE_SQFT + " SF does not round to " + value);
  }
});

// rule 4 says the as-of date does not move the answer. Relative weights hold
// still once every comp is in the past, until the oldest nears compWeight's
// five-year cap and 0.15 floor, so two dates a year apart must agree.
test("the answer does not depend on the day the page is read", () => {
  const a = valueAt(Date.parse("2026-10-07"));
  const b = valueAt(Date.parse("2027-10-07"));
  assert.deepStrictEqual([b.low, b.mid, b.high], [a.low, a.mid, a.high]);
});

test("the subject is not one of its own comparables", () => {
  const street = SAMPLE_ADDRESS.split(",")[0].trim().toLowerCase();
  for (const [addr] of SAMPLE_COMPS) {
    assert.notEqual(addr.trim().toLowerCase(), street, "the subject appears as its own comp: " + addr);
  }
});

test("the rendered card shows those figures, says weighted, and stays Illustrative", () => {
  const html = renderHomePageBody({ pricing: { minSeats: 2, firmSeat: 0, monthly: 0 } });
  const card = html.slice(html.indexOf('class="hmcard"'), html.indexOf('class="hmband wash hmfirms"'));
  assert.ok(card.length > 0, "the sample card is missing");
  assert.ok(card.includes(SAMPLE_ADDRESS), "the subject address is not on the card");
  for (const key of ["low", "mid", "high"]) {
    const { value, psf } = SAMPLE_RANGE[key];
    assert.ok(card.includes(`<div class="hmfig">${value}</div><div class="hmpsf">at ${psf}/SF`),
      key + " is not rendered as " + value + " at " + psf + "/SF");
  }
  assert.match(card, /Weighted median of 5 sale comps/, "the median row must say it is weighted");
  assert.doesNotMatch(card, />Median of 5/, "a plain 'Median' label is the claim this file exists to stop");
  assert.ok(card.includes(`&asymp; ${SAMPLE_RANGE.mid.value}`), "the working beside the median must match Likely");
  assert.match(card, /<span class="ill">Illustrative<\/span>/, "keep the Illustrative label");
});

// The phone layout (2026-11-18, "Improve the landing page for Mobile"). Every
// rule below lives inside a media query, so on the desktop a review is done on
// it changes nothing, and that is exactly how a tidy-up deletes it. Each pin
// is a thing a phone visitor lost before it: the sample's $/SF and source
// badge were off the right edge of the card behind an unmarked sideways
// scroll, and the value range was a 420px tower with Likely in the middle.
test("on a phone the sample's tables are rows, not a sideways scroll, and Likely leads", () => {
  const { HOME_CSS } = require("../home-page");
  const css = HOME_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (q) => {
    const at = css.indexOf("@media (" + q + "){");
    assert.ok(at > -1, "the " + q + " block is gone");
    let depth = 0, i = css.indexOf("{", at);
    const start = i + 1;
    for (; i < css.length; i++) { if (css[i] === "{") depth++; else if (css[i] === "}" && --depth === 0) break; }
    return css.slice(start, i);
  };
  const phone = block("max-width:659.98px");
  // 620px of comp table plus the page's two 16px gutters: a smaller
  // breakpoint leaves a sliver of sideways scroll between it and 652px.
  assert.match(css, /\.hmtable\{min-width:620px\}/, "the table's desktop width moved; re-derive the phone breakpoint from it");
  assert.match(phone, /\.hmtable,\.hmvtable\{min-width:0\}/, "the tables must stop forcing their desktop width");
  assert.match(phone, /\.hmscroll\{overflow-x:visible\}/, "no sideways scroll on a phone");
  assert.match(phone, /\.hmtr\.head,\.hmvr\.head\{display:none\}/, "the column heads give way to labelled rows");
  // The words the hidden heads said come back on each row.
  for (const word of ['"Sold "', '"Closed "', '" SF"', '"/SF"']) assert.ok(phone.includes("content:" + word), "a row lost its " + word + " label");
  // The badge is what the page sells; it stays on screen.
  assert.match(phone, /\.hmtr:not\(\.med\)>:nth-child\(5\)\{order:6;margin-left:auto/, "the source badge must stay on the row");
  assert.ok(!/nth-child\(5\)\{[^}]*display:none/.test(phone), "never hide the source badge on a phone");
  // Likely first, Low and High under it (order only: the DOM still reads
  // Low, Likely, High, which the card test above pins).
  const tablet = block("max-width:899.98px");
  assert.match(tablet, /\.hmrcell\.mid\{order:-1;grid-column:1 \/ -1/, "Likely must lead the range under 900px");
  assert.match(tablet, /\.hmrange\{grid-template-columns:1fr 1fr\}/, "Low and High sit side by side");
  // Buttons a thumb can hit: the intro's and the closing band's doors stack full width.
  assert.match(phone, /\.hmctas,\.hmbtns\{flex-direction:column;align-items:stretch/, "the doors stack full width on a phone");
});
