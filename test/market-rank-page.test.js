// The ranking page's promises, made into build failures.
//
// Two of these are compliance rather than correctness, and both are the kind of
// thing a later redesign quietly drops because the page looks cleaner without
// them.
const test = require("node:test");
const assert = require("node:assert");
const P = require("../market-rank-page.js");

const META = { weights: { macro: 0.30, class: 0.45, narrative: 0.25 }, generated: "2026-09-02" };

const ROWS = [
  { market: "Raleigh", state: "NC", tier: "primary", cbsa: "39580",
    macro: 0.84, class: 0.61, narrative: null, score: 0.76, publicScore: 0.76,
    band: "expanding", publicBand: "expanding", coverage: 1, bandMovedByNarrative: false },
  { market: "Boise City", state: "ID", tier: "secondary", cbsa: "14260",
    macro: 0.30, class: 0.22, narrative: 0.5, score: 0.34, publicScore: 0.27,
    band: "expanding", publicBand: "expanding", coverage: 0.8, bandMovedByNarrative: true },
  { market: "Hartford", state: "CT", tier: "secondary", cbsa: "25540",
    macro: -1, class: -0.4, narrative: null, score: -0.73, publicScore: -0.73,
    band: "contracting", publicBand: "contracting", coverage: 0.6, bandMovedByNarrative: false },
  // No data at all — the row that must not lie.
  { market: "Eagle Pass", state: "TX", tier: "tertiary", cbsa: "20580",
    macro: null, class: null, narrative: null, score: null, publicScore: null,
    band: null, publicBand: null, coverage: 0, bandMovedByNarrative: false },
];

const render = (cls = "industrial") => P.renderRankingsBody(cls, ROWS, META);

// THE ONE THAT MATTERS MOST.
//
// Zero on a -1..+1 scale is a measurement: it means flat. Absence is not a
// measurement. A market with no readings that rendered as "Flat" would be
// telling a reader the market is steady when the truth is that nothing is
// known about it — and tertiary markets, where data is thinnest, are exactly
// where a reader is least able to check. market-score.js draws this line in
// the arithmetic; this test carries it through to the page.
test("no scored row is ever labelled from an absent number", () => {
  const html = render();
  // Every pill in the ledger belongs to a market that actually scored, so none
  // of them may be the no-data pill: an unscored market leaves the table
  // entirely (see the pending-tier test below) rather than sitting in it
  // wearing a band. The rule the ledger used to carry — absence must never
  // render as "Flat" — now lives on the card, which is the only surface that
  // still shows an unmeasured market.
  const pills = [...html.matchAll(/rk-pill (rk-\w+)">([^<]+)</g)];
  const inTable = pills.filter((m) => m[2] !== "Expanding" || true).map((m) => m[2]);
  assert.ok(!inTable.includes("No data"),
    "the ledger lists only scored markets, so no row should carry the no-data pill");
  assert.ok(inTable.length >= 3, "the scored markets should still render their bands");
});

test("bandWord never turns an absent score into a measurement", () => {
  // The rule itself, tested directly rather than through a surface, so it
  // survives either page being redesigned.
  assert.strictEqual(P.bandWord(null), "No data");
  assert.strictEqual(P.bandWord(undefined), "No data");
  assert.strictEqual(P.bandClass(null), "rk-none");
  assert.notStrictEqual(P.bandClass(null), P.bandClass("flat"));
});

// The page's whole defensibility argument. A firm has to be able to show a
// capital partner what the public data said before their own judgement moved
// it; a composite with its parts hidden cannot be checked by anyone.
test("every row shows its components beside the composite", () => {
  const html = render();
  for (const header of ["Macro", "Class", "Your read", "Score"]) {
    assert.ok(html.includes(">" + header + "<"), "missing column: " + header);
  }
});

test("the weights in force are stated on the page", () => {
  const html = render();
  assert.match(html, /30% macro/);
  assert.match(html, /45% class-specific/);
  assert.match(html, /25% your read/);
});

// Coverage is the difference between a score built on everything and one built
// on half. Rendering them identically would make a thin score look like a
// confident one.
test("coverage is rendered per row, not summarised away", () => {
  const html = render();
  const bars = html.match(/class="rk-cov"/g) || [];
  const scored = ROWS.filter((r) => typeof r.score === "number").length;
  assert.strictEqual(bars.length, scored, "one coverage bar per SCORED market");
  assert.match(html, /width:100%/, "full coverage should render a full bar");
  assert.match(html, /width:60%/, "partial coverage should render a partial bar");
});

test("a narrative that changed the band is flagged", () => {
  const html = render();
  const boise = html.slice(html.indexOf("Boise City"), html.indexOf("Hartford"));
  assert.match(boise, /moved/, "a lens that moved a market across a band boundary should say so");
  const raleigh = html.slice(html.indexOf("Raleigh"), html.indexOf("Boise City"));
  assert.ok(!/moved/.test(raleigh), "a market with no lens must not be flagged");
});

test("the disclaimer says what this is and is not", () => {
  const html = render();
  for (const must of ["not an appraisal", "not investment advice", "automated indicator"]) {
    assert.ok(html.toLowerCase().includes(must.toLowerCase()), "disclaimer must say: " + must);
  }
});

test("every asset class renders and marks itself current", () => {
  for (const cls of P.ASSET_CLASSES) {
    const html = P.renderRankingsBody(cls, ROWS, META);
    assert.match(html, new RegExp(`href="/rankings/${cls}"[^>]*aria-current="page"`),
      cls + " should mark its own tab current");
  }
});

test("an unknown asset class falls back rather than rendering an empty page", () => {
  const html = P.renderRankingsBody("datacenter", ROWS, META);
  assert.match(html, /Market rankings/);
  assert.match(html, /href="\/rankings\/industrial"[^>]*aria-current/);
});

test("market names are escaped", () => {
  const nasty = [{ ...ROWS[0], market: '<script>alert("x")</script>', state: "NC" }];
  const html = P.renderRankingsBody("industrial", nasty, META);
  assert.ok(!html.includes("<script>alert"), "a market name must not become markup");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("junk rows do not throw", () => {
  assert.doesNotThrow(() => P.renderRankingsBody("industrial", [], META));
  assert.doesNotThrow(() => P.renderRankingsBody("industrial", [{}], { weights: {} }));
});

test("scores render with an explicit sign, so a minus cannot be missed", () => {
  assert.strictEqual(P.fmtScore(0.5), "+0.50");
  assert.strictEqual(P.fmtScore(-0.5), "−0.50");
  assert.strictEqual(P.fmtScore(0), "+0.00");
  assert.strictEqual(P.fmtScore(null), "&mdash;");
  assert.strictEqual(P.fmtScore(NaN), "&mdash;");
});

// ---------------------------------------------------------------------------
// The market card
// ---------------------------------------------------------------------------

const CARD = {
  market: "Boise City", state: "ID", tier: "secondary", cbsa: "14260",
  cbsaName: "Boise City, ID", population: 790640, assetClass: "industrial",
  weights: { macro: 0.30, class: 0.45, narrative: 0.25 },
  // `metrics` is what market-score.js actually returns on each block, and the
  // card reads it to decide which indicators belong to which component. It
  // KEEPS null-scored keys deliberately (measured: one present reading of five
  // still returns five keys), so an indicator that failed to resolve is a row
  // saying so rather than a row that is simply not there.
  macro: { score: 0.30, coverage: 1, metrics: {
    "Job growth (total nonfarm, YoY)": 0.58,
    "Labor force growth (YoY)": null,
  } },
  class: { score: 0.22, coverage: 0.67, metrics: {
    "Manufacturing employment growth": 0.22,
  } },
  units: {
    "Job growth (total nonfarm, YoY)": "percent",
    "Manufacturing employment growth": "percent",
    "Renter-occupied share": "percent of occupied units, LEVEL",
  },
  expected: { macro: 5, class: 3 },
  readings: {
    "Job growth (total nonfarm, YoY)": { yoy_pct: 0.58, as_of: "2026-07-01", source: "fred", series_id: "BOIS216NA" },
    "Manufacturing employment growth": { yoy_pct: 1.4, as_of: "2026-07-01", source: "fred", series_id: "SMU16" },
    // Held for this market but NOT weighted for industrial - it is a
    // multifamily input. Present so the test below can prove an unweighted
    // reading stays off this card.
    "Renter-occupied share": { yoy_pct: null, value: 31.4, as_of: "2023-12-31", source: "census", series_id: "B25003" },
  },
};
const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

// The sentence this page exists to print. A reader skimming a table can miss
// that a number was moved by somebody's opinion; a sentence cannot be missed,
// and it is the one a capital partner will ask about.
test("the card states the public score and the adjustment in words", () => {
  const html = P.renderMarketCardBody({ ...CARD, narrative: -0.9, score: 0.05,
    publicScore: 0.27, band: "flat", publicBand: "expanding",
    bandMovedByNarrative: true, lens: { name: "Jacob's read", updated: "12 Aug" } });
  const txt = strip(html);
  assert.match(txt, /Public data reads \+0\.27/);
  assert.match(txt, /moves it to \+0\.05/);
  assert.match(txt, /across a band boundary/,
    "a lens that changed the band must say so, not merely change the number");
});

test("a lens that moved the number but not the band says which", () => {
  const html = P.renderMarketCardBody({ ...CARD, narrative: 0.2, score: 0.30,
    publicScore: 0.27, band: "expanding", publicBand: "expanding",
    bandMovedByNarrative: false, lens: { name: "Your read" } });
  assert.match(strip(html), /within the same band/);
});

test("with no lens, the card says so and reassures what writing one does", () => {
  const html = P.renderMarketCardBody({ ...CARD, narrative: null, score: 0.27,
    publicScore: 0.27, band: "expanding", publicBand: "expanding",
    bandMovedByNarrative: false, lens: null });
  const txt = strip(html);
  assert.match(txt, /No firm read has been written/);
  assert.match(txt, /public score stays exactly as it is/,
    "a member must know their read changes only their own view");
  // The panel replaced a table row so a member can see this component is
  // theirs. It names the weight rather than offering a button, because the
  // editor is not built - see "the panel links nowhere" below.
  assert.match(txt, /Worth 25% here/,
    "the one member-owned component must say what it is worth");
});

test("every reading is traceable to a dated, named series", () => {
  const html = P.renderMarketCardBody({ ...CARD, narrative: null, score: 0.27,
    publicScore: 0.27, band: "expanding", publicBand: "expanding", bandMovedByNarrative: false });
  const txt = strip(html);
  assert.match(txt, /BOIS216NA/, "the FRED series id must be shown");
  assert.match(txt, /2026-07-01/, "with the observation date");
  assert.match(txt, /SMU16/, "the class block's series too, not only macro's");
  assert.match(txt, /publish on different schedules/,
    "differing dates need explaining, or they read as staleness");
  // The audit trail MOVED behind a disclosure when the card was rebuilt; it
  // was not dropped. If this ever fails, the evidence has gone off the page.
  assert.match(html, /<details/, "the evidence must still be reachable");

  // Renter-occupied share is a multifamily input. We hold a reading for it
  // here, and it is deliberately absent from an INDUSTRIAL card: a component
  // shows the indicators it actually weighs, because an indicator contributing
  // nothing to this score would read as though it did. It is on the
  // multifamily card, where it counts.
  assert.ok(!txt.includes("B25003"),
    "an indicator this asset class does not weigh must not appear on its card");
});

test("a market with no readings says absence, not zero", () => {
  // Empty blocks as well as empty readings: a market nothing resolved for gets
  // {score: null, coverage: 0} with no metrics, which is what the server hands
  // over when rankReadingsFor finds nothing.
  const html = P.renderMarketCardBody({ ...CARD, readings: {}, narrative: null,
    macro: { score: null, coverage: 0 }, class: { score: null, coverage: 0 },
    score: null, publicScore: null, band: null, publicBand: null });
  const txt = strip(html);
  // Said per component now, rather than once at the foot of the page: each one
  // is separately absent or present, and one sentence for both could only be
  // true of a market where nothing at all resolved.
  assert.match(txt, /no score rather than a score of zero/);
  assert.match(html, /rk-none/, "and the pill must be the no-data one");
  assert.ok(!/<details/.test(html),
    "nothing resolved means nothing to fold away either");
});

test("the card shows the weight beside each component", () => {
  const html = P.renderMarketCardBody({ ...CARD, narrative: null, score: 0.27,
    publicScore: 0.27, band: "expanding", publicBand: "expanding", bandMovedByNarrative: false });
  const txt = strip(html);
  // Weight is per row because "macro is -0.4" means something different at
  // 0.20 than at 0.45, and land runs at 0.20 while industrial runs at 0.30.
  assert.match(txt, /30%/);
  assert.match(txt, /45%/);
  assert.match(txt, /25%/);
});

test("the card carries the same disclaimer as the ledger", () => {
  const html = P.renderMarketCardBody({ ...CARD, narrative: null, score: 0.27,
    publicScore: 0.27, band: "expanding", publicBand: "expanding", bandMovedByNarrative: false });
  for (const must of ["not an appraisal", "not investment advice", "automated indicator"]) {
    assert.ok(html.toLowerCase().includes(must), "card disclaimer must say: " + must);
  }
});

test("the card never throws on a half-built market", () => {
  assert.doesNotThrow(() => P.renderMarketCardBody({}));
  assert.doesNotThrow(() => P.renderMarketCardBody({ assetClass: "nonsense", readings: null }));
});

// Caught on the first route wiring, 2026-09-02: with no class-specific
// readings every asset class rendered an IDENTICAL list under six different
// headings. A member clicking "Office" got the industrial ranking wearing an
// office label — worse than an empty page, because it looks like an answer.
test("an empty class block says the ranking is identical across classes", () => {
  const noClass = ROWS.map((r) => ({ ...r, class: null }));
  const html = P.renderRankingsBody("office", noClass, META);
  const txt = strip(html);
  assert.match(txt, /No office-specific data has loaded yet/);
  assert.match(txt, /identical for every asset class/,
    "the page must say the tabs will not change the order");
});

test("a partly-covered class block reports how many markets have it", () => {
  const some = ROWS.map((r, i) => ({ ...r, class: i === 0 ? 0.4 : null }));
  const html = P.renderRankingsBody("industrial", some, META);
  assert.match(strip(html), /Only 1 of 4 markets have industrial-specific readings/);
});

test("a fully-covered class block shows no warning at all", () => {
  const html = P.renderRankingsBody("industrial", ROWS, META);
  const txt = strip(html);
  assert.ok(!/has loaded yet/.test(txt));
  assert.ok(!/Only \d+ of \d+ markets/.test(txt));
});

// With a tier still loading, 146 identical "No data" rows would bury the 50
// that mean something. The distinction that must survive: a market absent from
// the table has NOT scored badly, it has not been measured.
test("unscored markets leave the table but are counted by tier below it", () => {
  const html = P.renderRankingsBody("industrial", ROWS, META);
  const txt = strip(html);
  assert.ok(!txt.includes("Eagle Pass"), "an unscored market should not take a table row");
  assert.match(txt, /1 further market \(1 tertiary\)/);
  assert.match(txt, /not markets that scored badly/,
    "absence must be distinguished from a low score in words");
});

test("with every market scored, no pending line appears", () => {
  const all = ROWS.filter((r) => typeof r.score === "number");
  const txt = strip(P.renderRankingsBody("industrial", all, META));
  assert.ok(!/further market/.test(txt));
});


// ---------------------------------------------------------------------------
// The explorer entry card — the only door into any of this.
//
// The ranking pages shipped complete and UNREACHABLE: nothing on the site
// linked to /rankings, so the whole feature was live and invisible. These tests
// are about the door staying open and staying honest, because a hero card is
// exactly the kind of thing a later redesign of /markets removes for looking
// busy.

const entry = (cls = "industrial", rows = ROWS) =>
  P.renderExplorerEntry(cls, rows, { generated: "2026-09-02" });

test("the entry card links into the ranking, and into every asset class", () => {
  const html = entry();
  assert.match(html, /href="\/rankings\/industrial"/,
    "no link to the ledger — the card would be decoration");
  for (const c of P.ASSET_CLASSES) {
    assert.ok(html.includes(`href="/rankings/${c}"`),
      `${c} has no link, so a member who works it lands on industrial instead`);
  }
});

// The guard that stops the door leading nowhere. server.js 404s /rankings when
// RANK_CONFIGURED is false, and an install with no readings file scores nothing
// — in both cases the card must not appear at all.
test("no scored markets means no card, never an empty one", () => {
  assert.strictEqual(entry("industrial", []), "");
  assert.strictEqual(entry("industrial", ROWS.filter((r) => r.score === null)), "",
    "a list of unscored markets is not a ranking to advertise");
});

// The preview and the ledger read the same sorted array, so this pins that they
// cannot disagree — a card claiming a different leader than the page it opens
// would be worse than no preview.
test("the preview shows the top three of the list it links to", () => {
  const html = entry();
  const scored = ROWS.filter((r) => typeof r.score === "number");
  const top = scored.slice(0, 3);
  for (const r of top) assert.ok(html.includes(`${r.market}, ${r.state}`), `${r.market} missing`);
  assert.ok(!html.includes("Eagle Pass"),
    "an unscored market must never appear in a leaderboard preview");
});

test("the count is the scored markets, not the row count", () => {
  const html = entry();
  const scored = ROWS.filter((r) => typeof r.score === "number").length;
  assert.ok(html.includes(`See all ${scored} markets`),
    "the card must not count markets it has no score for");
  assert.ok(!html.includes(`See all ${ROWS.length} markets`));
});

test("an unknown asset class falls back rather than rendering an empty heading", () => {
  const html = entry("datacenter");
  assert.match(html, /Leading for industrial/);
  assert.ok(!html.includes("datacenter"));
});

test("the card escapes what it prints", () => {
  const html = P.renderExplorerEntry("industrial", [{
    market: '<script>x</script>', state: "XX", tier: "primary", cbsa: "99999",
    score: 0.5, band: "expanding",
  }], { generated: '"onload="' });
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(!html.includes('"onload="'));
});

// Both directions. The card is the way in; without this the way out is the
// browser's back button, which is not a way out a page may rely on.
test("the ledger links back to the explorer it is entered from", () => {
  assert.match(render(), /href="\/markets"/,
    "the ledger must offer the way back to /markets");
});

// The card reuses the ledger's classes rather than restating them, which is
// only safe while server.js ships RANK_CSS on /markets too. If this ever fails,
// the class links have gone back to looking like bare underlined text.
test("the card reuses the ledger's styles, so /markets must carry RANK_CSS", () => {
  const html = entry();
  assert.ok(html.includes('class="rk-tab"'), "class links use the ledger's tab style");
  assert.match(html, /class="rk-pill rk-(exp|flat|con)"/, "band pills use the ledger's colours");
  for (const cls of ["rk-tab", "rk-pill", "rk-exp"]) {
    assert.ok(P.RANK_CSS.includes("." + cls), `RANK_CSS does not define .${cls}`);
  }
  assert.ok(P.RANK_CSS.includes(".rke"), "RANK_CSS must carry the entry card's own styles");
});


// ---------------------------------------------------------------------------
// The component panels: what a score MEANS, with the evidence folded under it.

const UNITS = {
  "Job growth (total nonfarm, YoY)": "percent",
  "Unemployment rate (level and direction)": "percent",
  "Educational attainment (bachelor's or higher)": "percent of adults, LEVEL",
  "Renter-occupied share": "percent of occupied units, LEVEL",
};
const READS = {
  "Job growth (total nonfarm, YoY)": { yoy_pct: 2.62, value: 2747.2, as_of: "2026-07-01", source: "fred", series_id: "SMS25" },
  "Unemployment rate (level and direction)": { yoy_pct: null, value: 3.9, as_of: "2026-06-01", source: "fred" },
  "Educational attainment (bachelor's or higher)": { yoy_pct: 51.2, value: 51.2, as_of: "2023-12-31", source: "census" },
};

// THE ONE THAT MATTERS MOST IN THIS BLOCK, and a bug that shipped in the first
// draft of it.
//
// Educational attainment is a STOCK: 51.2% of Boston adults hold a degree. The
// refresh script stores it in `yoy_pct` because that is the field the scorer
// reads, so a renderer that treats every yoy_pct as a change prints
// "educational attainment (+51.2%)" -- a metro whose graduate share grew by
// half in a year. Real number, right market, wrong quantity, nothing thrown.
// Exactly the failure the CBSA verification and the discontinued-series filter
// exist to refuse.
test("a level is never printed as a year-over-year change", () => {
  const block = { score: 0.5, coverage: 1, metrics: {
    "Educational attainment (bachelor's or higher)": 1,
    "Job growth (total nonfarm, YoY)": -0.9,
  } };
  const story = P.narrateBlock(block, READS, { units: UNITS, expected: 2 });
  assert.ok(story.includes("educational attainment (51.2%)"),
    "a LEVEL must print bare: got " + story);
  assert.ok(!story.includes("+51.2"), "a level must carry no + sign");
  assert.ok(!/51\.2%\s*YoY/.test(story), "a level must not be labelled YoY");
  assert.ok(story.includes("job growth (+2.6% YoY)"),
    "a genuine change keeps its sign and its YoY label: got " + story);
});

test("a metric with no yoy_pct prints its level, with the unit", () => {
  const block = { score: 0.4, coverage: 1,
    metrics: { "Unemployment rate (level and direction)": 0.4 } };
  const story = P.narrateBlock(block, READS, { units: UNITS, expected: 1 });
  assert.ok(story.includes("unemployment rate (3.9%)"), "got " + story);
});

test("the sentence names what pulls up and what pulls down", () => {
  const block = { score: 0.1, coverage: 1, metrics: {
    "Job growth (total nonfarm, YoY)": 0.8,
    "Unemployment rate (level and direction)": -0.7,
  } };
  const story = P.narrateBlock(block, READS, { units: UNITS, expected: 2 });
  assert.match(story, /leads the read/);
  assert.match(story, /pulls against it/);
});

// Absence is the thing this whole feature refuses to round off, and the
// coverage bar is a shape rather than a fact. The gap has to be in words.
test("the sentence states what did not report, not just what did", () => {
  const block = { score: 0.5, coverage: 0.4,
    metrics: { "Job growth (total nonfarm, YoY)": 0.8 } };
  const story = P.narrateBlock(block, READS, { units: UNITS, expected: 5 });
  assert.ok(story.includes("1 of 5 indicators reported"), "got " + story);
  assert.ok(story.includes("not scored rather than scored as zero"),
    "the reason must be stated, not just the count");
});

test("nothing to say returns null, so no empty paragraph is rendered", () => {
  assert.strictEqual(P.narrateBlock({ metrics: {} }, READS, {}), null);
  assert.strictEqual(P.narrateBlock(null, null, null), null);
  assert.strictEqual(P.narrateBlock({ metrics: { a: null, b: undefined } }, {}, {}), null);
});

// Grammar, because the sentence is read by people who will judge the number by
// how it is written. "1 other sit near neutral" shipped in the first draft.
test("counts agree with their verbs", () => {
  const one = P.narrateBlock({ metrics: { a: 0.9, b: 0.01, c: -0.9 } },
    { a: {}, b: {}, c: {} }, { expected: 3 });
  assert.ok(one.includes("1 other sits near neutral"), "got " + one);
  const two = P.narrateBlock({ metrics: { a: 0.9, b: 0.01, c: 0.02, d: -0.9 } },
    { a: {}, b: {}, c: {}, d: {} }, { expected: 4 });
  assert.ok(two.includes("2 others sit near neutral"), "got " + two);
});

// The +/-0.1 dead zone is editorial: naming a metric at 0.04 as a driver
// invents a story out of noise.
test("a metric sitting at neutral is counted, never named as a driver", () => {
  const story = P.narrateBlock({ metrics: { "Job growth (total nonfarm, YoY)": 0.04 } },
    READS, { units: UNITS, expected: 1 });
  assert.ok(!story.includes("job growth ("), "a neutral metric must not be named: " + story);
  assert.match(story, /neutral point/);
});

test("the component panel folds its evidence rather than dropping it", () => {
  const html = P.renderComponent({
    title: "Macro economic", weight: 0.35, expected: 5, units: UNITS, readings: READS,
    block: { score: 0.2, coverage: 0.6, metrics: {
      "Job growth (total nonfarm, YoY)": 0.5,
      "Unemployment rate (level and direction)": -0.4,
    } },
  });
  assert.match(html, /<details/, "the audit trail must still be on the page");
  assert.ok(html.includes("Show the 2 indicators behind this"));
  assert.ok(html.includes("SMS25"), "the series id is the point of the audit trail");
  assert.ok(html.includes("2026-07-01"), "and so is the as-of date");
  assert.ok(!/<details[^>]*\sopen/.test(html),
    "closed by default -- open evidence is the flat table this replaced");
});

test("an empty component says so instead of rendering a bare zero", () => {
  const html = P.renderComponent({ title: "Office specific", weight: 0.4, block: {} });
  assert.ok(html.includes("no score rather than a score of zero"));
  assert.ok(!html.includes("<details"), "nothing to fold means no disclosure");
});

// ---------------------------------------------------------------------------
// Your read: the one component a member can change.

test("an unwritten read says what it is and what it is worth", () => {
  const html = P.renderYourRead(
    { cbsa: "14460", narrative: null, weights: { narrative: 0.25 } }, "office");
  assert.ok(html.includes("25%"), "the weight is what makes the em dash legible");
  assert.ok(html.includes("public score stays exactly as it is"),
    "a member must know their read does not alter the public number");
  assert.ok(html.includes("not open yet"),
    "and must be told why there is nothing to click");
});

// THE ONE THAT KEEPS THIS HONEST. The panel shipped for one commit with a
// "Write your read" button pointing at /rankings/<class>/<cbsa>/read, a route
// that does not exist -- a 404 behind the button naming the thing a member
// most wants to do. Nothing here may link anywhere until the editor is real,
// and this fails the moment somebody adds an href back without the route.
test("the panel links nowhere while the editor does not exist", () => {
  for (const m of [
    { cbsa: "14460", narrative: null, weights: { narrative: 0.25 } },
    { cbsa: "14460", narrative: 0.6, score: 0.4, publicScore: 0.25,
      bandMovedByNarrative: true, lens: { name: "Q3 fabricator build" },
      weights: { narrative: 0.25 } },
  ]) {
    const html = P.renderYourRead(m, "office");
    assert.ok(!/<a\s/.test(html),
      "no anchor may ship in this panel until /rankings/<class>/<cbsa>/read answers");
    assert.ok(!html.includes("/read"), "and no route may be named that 404s");
  }
});

test("a written read says what it moved", () => {
  const html = P.renderYourRead({
    cbsa: "14460", narrative: 0.6, score: 0.4, publicScore: 0.25,
    bandMovedByNarrative: true, lens: { name: "Q3 fabricator build", updated: "2026-09-01" },
    weights: { narrative: 0.25 },
  }, "office");
  assert.ok(html.includes("Q3 fabricator build"));
  assert.ok(html.includes("across a band boundary"),
    "crossing a band is the change worth naming");
});

// ---------------------------------------------------------------------------
// The spreadsheet.

test("the ledger export leads with its provenance", () => {
  const rows = P.rankingsCsvRows("industrial", ROWS,
    { weights: { macro: 0.3, class: 0.45, narrative: 0.25 }, generated: "2026-09-02" });
  const title = String(rows[0][0]);
  assert.match(title, /CompNinja market rankings/);
  assert.match(title, /not an appraisal/,
    "the file outlives the screen that explained it");
  assert.match(title, /2026-09-02/, "and must date itself");
  assert.deepStrictEqual(rows[1][0], "Rank", "the header follows the title row");
});

// On the page an unscored market is a count under the table. In a spreadsheet
// a reader sorts and filters, and a market simply absent from the file reads as
// a market that does not exist.
test("unscored markets are named in the export, with blank scores", () => {
  const rows = P.rankingsCsvRows("industrial", ROWS, { weights: {}, generated: "x" });
  const flat = rows.map((r) => r.join("|")).join("\n");
  assert.ok(flat.includes("Eagle Pass"), "an unscored market must still be listed");
  const eagle = rows.find((r) => r[1] === "Eagle Pass");
  assert.strictEqual(eagle[10], "", "its score cell must be blank, never 0");
});

// fmtScore's minus is U+2212, which Excel reads as text and will not sum.
test("export numbers are plain, so a spreadsheet can add them up", () => {
  const rows = P.rankingsCsvRows("industrial", ROWS, { weights: {}, generated: "x" });
  const hartford = rows.find((r) => r[1] === "Hartford");
  assert.strictEqual(typeof hartford[10], "number", "a score cell must be a number");
  assert.ok(hartford[10] < 0, "and keep its sign as an ASCII minus");

  // fmtScore's output is for a page: "\u22120.12" leads with a MINUS SIGN,
  // which Excel reads as text and will not sum, and "\u2014" is the page's
  // stand-in for a blank. Neither may reach a numeric cell. Checked on the
  // SCORE COLUMNS only - the provenance line and the "not scored" heading are
  // prose, and an em dash is correct English there.
  const numeric = rows.filter((r) => typeof r[0] === "number")
    .flatMap((r) => r.slice(7, 11));
  assert.ok(numeric.length, "expected some scored rows to check");
  for (const cell of numeric) {
    const t = String(cell);
    assert.ok(!t.includes("\u2212"), "unicode minus in a numeric cell: " + t);
    assert.ok(!t.includes("\u2014"), "em dash in a numeric cell: " + t);
    assert.ok(cell === "" || typeof cell === "number",
      "a score cell must be a number or blank, never a string: " + t);
  }
});

test("one market's export carries every indicator and its series", () => {
  const rows = P.marketCsvRows({
    market: "Boston", state: "MA", cbsa: "14460", assetClass: "office",
    score: 0.54, publicScore: 0.54, band: "expanding", coverage: 0.75,
    weights: { macro: 0.35, class: 0.4, narrative: 0.25 }, units: UNITS, readings: READS,
    macro: { score: 0.01, coverage: 0.65, metrics: { "Job growth (total nonfarm, YoY)": -0.09 } },
    class: { score: 1, coverage: 0.2, metrics: { "Educational attainment (bachelor's or higher)": 1 } },
  });
  const flat = rows.map((r) => r.join("|")).join("\n");
  assert.ok(flat.includes("SMS25"), "the series id must ride in the file");
  assert.ok(flat.includes("Public only (no read)"),
    "the public score must be in the file beside the adjusted one");
  // The level-vs-change rule holds in the spreadsheet too -- further from its
  // explanation than the page is, so it matters more here.
  assert.ok(flat.includes("51.2%"), "a level keeps its unit");
  assert.ok(!flat.includes("+51.2"), "and never gains a + sign");
});


// ---------------------------------------------------------------------------
// Switching asset class must not lose the market you are reading.

// A member on Salt Lake City who wants its office read was thrown back to a
// list of fifty markets and had to find Salt Lake City again. The class is the
// thing the control names; the market is not, and a control should only change
// what it names.
test("the class tabs on a market card keep that market", () => {
  const html = P.renderMarketCardBody({ ...CARD, cbsa: "41620", narrative: null,
    score: 0.27, publicScore: 0.27, band: "expanding", publicBand: "expanding" });
  for (const c of P.ASSET_CLASSES) {
    assert.ok(html.includes(`href="/rankings/${c}/41620"`),
      `${c} tab dropped the market and points at the ledger`);
  }
});

// The ledger has no market to keep, so its tabs stay class-only. Passing a
// cbsa there would be a link to a market the reader has not chosen.
test("the ledger's class tabs carry no market", () => {
  const html = render();
  for (const c of P.ASSET_CLASSES) {
    assert.ok(html.includes(`href="/rankings/${c}"`), `${c} tab missing from the ledger`);
  }
  assert.ok(!/rk-tab" href="\/rankings\/[a-z]+\/\d/.test(html),
    "a ledger tab must not point at some particular market");
});

// ---------------------------------------------------------------------------
// The ledger's tier filter.

test("every scored row carries its tier and its true rank", () => {
  const html = render();
  const rows = html.match(/<tr data-tier="[a-z]+" data-rank="\d+">/g) || [];
  const scored = ROWS.filter((r) => typeof r.score === "number");
  assert.equal(rows.length, scored.length, "one data-tier row per scored market");
  assert.ok(html.includes('data-tier="primary"'));
  assert.ok(html.includes('data-tier="secondary"'));
});

// THE ONE THAT MATTERS MOST HERE. Renumbering the visible rows 1..n inside a
// filter would say Boise is the 2nd best industrial market in the country when
// it is the 61st -- the filter would be quietly rewriting the ranking it
// exists to look through.
test("the rank column is the place in the FULL ranking, not the filtered view", () => {
  const html = render();
  const ranks = (html.match(/data-rank="(\d+)"/g) || []).map((m) => Number(m.match(/\d+/)[0]));
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b), "ranks must ascend");
  assert.equal(ranks[0], 1, "and start at the top of the whole ranking");
  // The Hartford row is 3rd overall and 2nd among secondary markets. Its
  // printed rank must be 3 either way.
  const hartford = html.slice(html.indexOf("Hartford") - 200, html.indexOf("Hartford"));
  assert.match(hartford, /data-rank="3"/);
});

test("the tier control offers every tier and counts each honestly", () => {
  const html = render();
  for (const t of ["all", "primary", "secondary", "tertiary"]) {
    assert.ok(html.includes(`id="rkt-${t}"`), `no ${t} option`);
  }
  const counts = (html.match(/rk-tab-n">(\d+)/g) || []).map((m) => Number(m.match(/\d+/)[0]));
  const scored = ROWS.filter((r) => typeof r.score === "number");
  assert.equal(counts[0], scored.length, "All must count every scored market");
  // Tertiary holds only the unscored Eagle Pass, so it must read 0 rather than
  // being omitted: a tier offering nothing is a fact about the data.
  assert.equal(counts[3], 0, "a tier with nothing measured must show 0, not vanish");
});

// The counts come from SCORED rows. An unscored market is not in the table, so
// counting it would promise a row the filter cannot show.
test("the tier counts exclude markets that are not in the table", () => {
  const html = render();
  const counts = (html.match(/rk-tab-n">(\d+)/g) || []).map((m) => Number(m.match(/\d+/)[0]));
  assert.ok(counts[0] < ROWS.length, "Eagle Pass is unscored and must not be counted");
});

// Progressive enhancement, and the reason the filter is client-side at all:
// every row is already in the HTML, so with no JavaScript the full table is
// still the answer.
test("the whole table ships in the HTML, so no-JS still reads it", () => {
  const html = render();
  for (const r of ROWS.filter((x) => typeof x.score === "number")) {
    assert.ok(html.includes(`${r.market}, ${r.state}`), `${r.market} missing from the markup`);
  }
});

// A "/" inside an inline <script> is a hazard this repo has met before (the
// 1031 widget's regex). Both scripts here are plain string work.
test("the ledger's inline scripts carry no regex literal", () => {
  const html = render();
  const scripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  assert.ok(scripts.length >= 1, "expected the tier filter's script on the ledger");
  for (const sc of scripts) {
    // The BODY, stripped of the wrapper the match itself carries. Without
    // this the closing-tag check below is trivially true of every script,
    // which is exactly the shape of test that passes forever and guards
    // nothing.
    const src = sc.slice("<script>".length, -"</script>".length);
    assert.ok(!/=\s*\/[^/*\s][^\n]*\/[gimsuy]*[;.,)]/.test(src),
      "a regex literal in an inline script: " + src.slice(0, 120));
    assert.ok(!src.includes("</script"),
      "a script body must not contain a closing tag -- it would end the block early");
  }
});
