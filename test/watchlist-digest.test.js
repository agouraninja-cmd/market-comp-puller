const test = require("node:test");
const assert = require("node:assert");
const DIGEST = require("../watchlist-digest");

// The digest is the only email CompNinja sends on its own initiative, so most
// of these tests are about NOT sending, or about not overstating what was
// found. The copy assertions are deliberately about facts (a count, a
// figure, a disclosure) rather than exact wording, so the text can be
// reworded without a red suite — except where the wording IS the rule.

const item = (over) => ({
  market: "Boise, ID",
  property_type: "Industrial",
  new_count: 0,
  median_psf: null,
  comps: [],
  ...over,
});

const build = (items) => DIGEST.buildDigest({
  items,
  deskUrl: "https://compninja.co/desk",
  unsubscribeUrl: "https://compninja.co/u?t=abc",
});

test("nothing to say sends nothing", async (t) => {
  await t.test("an empty watchlist builds no email", () => {
    assert.equal(build([]), null);
    assert.equal(DIGEST.worthSending([]), false);
  });

  await t.test("watched markets with no new comps build no email", () => {
    // The reader has already seen this median. A digest that arrives to
    // restate it is the one that teaches them to ignore the next one.
    assert.equal(build([item({ median_psf: 84 }), item({ market: "Nampa, ID", median_psf: 91 })]), null);
  });

  await t.test("a market with new comps but no median still sends", () => {
    // "3 new comps" is the news; the median is the detail. A thin market
    // that cannot produce a median must not be silently dropped.
    const out = build([item({ new_count: 3 })]);
    assert.ok(out, "3 new comps is worth an email even with no median");
    assert.match(out.text, /3 new comps/);
  });
});

test("subject lines", async (t) => {
  await t.test("one market is named", () => {
    const out = build([item({ new_count: 2 })]);
    assert.equal(out.subject, "2 new comps in Boise, ID");
  });

  await t.test("several markets are counted, not listed", () => {
    const out = build([
      item({ new_count: 2 }),
      item({ market: "Meridian, ID", property_type: "Office", new_count: 1 }),
    ]);
    assert.equal(out.subject, "3 new comps across 2 markets on The Board");
  });

  await t.test("markets with no news are excluded from the subject's count", () => {
    // Otherwise the subject promises news the body does not contain.
    const out = build([item({ new_count: 2 }), item({ market: "Nampa, ID", new_count: 0, median_psf: 70 })]);
    assert.equal(out.subject, "2 new comps in Boise, ID");
    assert.equal(/Nampa/.test(out.text), false, "a market with no news must not appear in the body either");
  });

  await t.test("singular is singular", () => {
    assert.equal(build([item({ new_count: 1 })]).subject, "1 new comp in Boise, ID");
  });
});

// The line a comp is itemized on, found by its address.
const lineFor = (out, address) => out.text.split("\n").find((l) => l.includes(address)) || "";

test("what a market block claims", async (t) => {
  // Prices in the shape the corpus stores them and the feed passes on: the
  // text the report wrote, dollar sign and commas included.
  const withComps = item({
    new_count: 5,
    median_psf: 84.42,
    median_trend: { current: 84.42, prior: 79.1 },
    comps: [
      { address: "1234 Freight Way", transaction: "Sale", deal_date: "2026-07-14", price_or_rate: "$2,400,000", price_per_sqft: "$88" },
      { address: "88 Warehouse Rd", transaction: "Lease", deal_date: "2026-07-02", price_or_rate: "$14.50/SF/yr NNN", price_per_sqft: "$11" },
      { address: "5 Depot St", transaction: "Sale", deal_date: "2026-06-30", price_or_rate: "$990,000" },
      { address: "9 Rail Ave", transaction: "Sale", deal_date: "2026-06-01", price_or_rate: "$1,200,000" },
    ],
  });

  await t.test("the median is rounded to the dollar", () => {
    // Cents in a median of a dozen comps are noise, and a figure that moves
    // between digests should mean the market moved.
    const out = build([withComps]);
    assert.match(out.text, /median \$84\/SF/);
    assert.equal(/84\.42/.test(out.text), false);
  });

  await t.test("the trend names a direction and the prior figure, never a percent", () => {
    const out = build([withComps]);
    assert.match(out.text, /up from \$79\/SF the 6 months before/);
    assert.equal(/%/.test(out.text), false, "a percentage over a handful of comps reads as a market move");
  });

  await t.test("a flat median says flat rather than inventing a direction", () => {
    const out = build([item({ new_count: 2, median_psf: 80, median_trend: { current: 80.2, prior: 79.8 } })]);
    assert.match(out.text, /flat against the 6 months before/);
  });

  await t.test("no trend where the feed withheld one", () => {
    const out = build([item({ new_count: 2, median_psf: 80 })]);
    assert.equal(/up from|down from|flat against/.test(out.text), false);
    assert.match(out.text, /median \$80\/SF/, "with no trend the median is the feed's own");
  });

  await t.test("with a trend, the median quoted is the trend's own, so the direction matches the two numbers", () => {
    // median_psf is windowed on when a comp was FOUND, the trend on when it
    // CLOSED, so the two can sit either side of the prior figure. This read
    // "median $110/SF, up from $142/SF" until 2026-11-10.
    const up = build([item({ new_count: 4, median_psf: 110, median_trend: { current: 155, prior: 142 } })]);
    assert.match(up.text, /median \$155\/SF \(sales, last 6 months\), up from \$142\/SF the 6 months before/);
    assert.equal(/\$110\/SF/.test(up.text), false);
    const down = build([item({ new_count: 4, median_psf: 160, median_trend: { current: 140, prior: 150 } })]);
    assert.match(down.text, /median \$140\/SF \(sales, last 6 months\), down from \$150\/SF the 6 months before/);
    assert.equal(/\$160\/SF/.test(down.text), false);
    const flat = build([item({ new_count: 4, median_psf: 95, median_trend: { current: 80.2, prior: 79.8 } })]);
    assert.match(flat.text, /median \$80\/SF \(sales, last 6 months\), flat against the 6 months before/);
  });

  await t.test("a comp's price and $/SF are read from the text the corpus stores", () => {
    // "$2,400,000" and "$88" are not numbers to Number(), so every comp line
    // lost both until 2026-11-10.
    const line = lineFor(build([withComps]), "1234 Freight Way");
    assert.match(line, /\$2,400,000/);
    assert.match(line, /\$88\/SF/);
    assert.match(lineFor(build([withComps]), "5 Depot St"), /\$990,000/);
  });

  await t.test("a lease's quoted rate is never printed as a sale price", () => {
    const line = lineFor(build([withComps]), "88 Warehouse Rd");
    assert.match(line, /\$11\/SF/, "its $/SF still rides");
    assert.equal(/14\.50|\$14\b|\$15\b|\/yr/.test(line), false, line);
    // Nor is a figure half-read out of a range or a rate with its unit.
    const odd = build([item({ new_count: 2, comps: [
      { address: "7 Range Rd", transaction: "Sale", price_or_rate: "$1,000,000 - $1,200,000", price_per_sqft: "$100-$120" },
      { address: "8 Month Ct", transaction: "Lease", price_per_sqft: "$1.08/SF/mo" },
    ] })]);
    assert.equal(/\$/.test(lineFor(odd, "7 Range Rd")), false, lineFor(odd, "7 Range Rd"));
    assert.equal(/\$/.test(lineFor(odd, "8 Month Ct")), false, lineFor(odd, "8 Month Ct"));
  });

  await t.test("a bare number reads the same as the stored text", () => {
    // The other shape: a figure that arrives as a number, or as its digits.
    const out = build([item({ new_count: 2, comps: [
      { address: "1 Number Way", transaction: "Sale", deal_date: "2026-07-14", price_or_rate: 2400000, price_per_sqft: 88 },
      { address: "2 Digits Way", transaction: "Sale", deal_date: "2026-07-14", price_or_rate: "2400000", price_per_sqft: "88" },
    ] })]);
    assert.match(lineFor(out, "1 Number Way"), /\$2,400,000, \$88\/SF/);
    assert.match(lineFor(out, "2 Digits Way"), /\$2,400,000, \$88\/SF/);
  });

  await t.test("comps are itemized but capped, and the count above stays true", () => {
    const out = build([withComps]);
    assert.match(out.text, /5 new comps/, "the count must be the real one, not the number shown");
    assert.match(out.text, /1234 Freight Way/);
    assert.equal(/9 Rail Ave/.test(out.text), false, "the 4th comp is past the per-market cap");
    assert.match(out.text, /and 1 more in your desk/);
  });

  await t.test("a lease is labeled a lease", () => {
    const out = build([withComps]);
    assert.match(out.text, /88 Warehouse Rd \(lease/);
    assert.match(out.text, /1234 Freight Way \(sale/);
  });

  await t.test("a comp with no address is labeled, never blank", () => {
    const out = build([item({ new_count: 1, comps: [{ transaction: "Sale", deal_date: "2026-07-01", price_or_rate: 100000 }] })]);
    assert.match(out.text, /Address not stated/);
  });
});

test("the two kinds of withheld comp are never conflated", async (t) => {
  await t.test("locked_count offers Pro; the email's own cap does not", () => {
    // locked_count is what the reader's PLAN withheld — an upgrade prompt is
    // honest there. The per-email cap is just this email being short, and
    // selling Pro for it would be a lie.
    const out = build([item({
      new_count: 9,
      locked_count: 5,
      comps: [
        { address: "A St", transaction: "Sale" },
        { address: "B St", transaction: "Sale" },
        { address: "C St", transaction: "Sale" },
        { address: "D St", transaction: "Sale" },
      ],
    })]);
    assert.match(out.text, /1 more in your desk/, "the 4th comp is an email-length overflow");
    assert.match(out.text, /5 more comps were found and are itemized with Pro/);
  });

  await t.test("no Pro line when nothing was locked", () => {
    const out = build([item({ new_count: 2, comps: [{ address: "A St", transaction: "Sale" }] })]);
    assert.equal(/with Pro/.test(out.text), false);
  });

  await t.test("one locked comp reads as one, not as \"1 comps were\"", () => {
    const out = build([item({ new_count: 2, locked_count: 1, comps: [{ address: "A St" }] })]);
    assert.match(out.text, /1 more comp was found and is itemized with Pro/);
  });
});

test("every digest discloses why it arrived, how to stop it, and what the figures are", async (t) => {
  const out = build([item({ new_count: 1, comps: [{ address: "A St" }] })]);

  await t.test("the reason and the off switch are separate sentences", () => {
    // Months after adding a market, "why am I getting this" is a real
    // question, and one sentence carrying both facts reads as a marketing
    // footer and gets skimmed.
    assert.match(out.text, /because you added these markets to The Board on CompNinja/);
    assert.match(out.text, /Turn these emails off: https:\/\/compninja\.co\/u\?t=abc/);
  });

  await t.test("the automated-estimate line rides along", () => {
    // The standing rule for every surface that quotes a value: an automated
    // estimate, never an appraisal.
    assert.match(out.text, /automated estimates/);
    assert.match(out.text, /never an appraisal/);
  });

  await t.test("the desk link is present so the email is never the only copy", () => {
    assert.match(out.text, /https:\/\/compninja\.co\/desk/);
  });
});
