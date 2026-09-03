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
  macro: { score: 0.30, coverage: 1 },
  class: { score: 0.22, coverage: 0.67 },
  readings: {
    "Job growth (total nonfarm, YoY)": { yoy_pct: 0.58, as_of: "2026-07-01", source: "fred", series_id: "BOIS216NA" },
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
  assert.match(txt, /public score above stays exactly as it is/,
    "a member must know their read changes only their own view");
});

test("every reading is traceable to a dated, named series", () => {
  const html = P.renderMarketCardBody({ ...CARD, narrative: null, score: 0.27,
    publicScore: 0.27, band: "expanding", publicBand: "expanding", bandMovedByNarrative: false });
  const txt = strip(html);
  assert.match(txt, /BOIS216NA/, "the FRED series id must be shown");
  assert.match(txt, /2026-07-01/, "with the observation date");
  assert.match(txt, /B25003/);
  assert.match(txt, /2023-12-31/);
  assert.match(txt, /publish on different schedules/,
    "differing dates need explaining, or they read as staleness");
});

test("a market with no readings says absence, not zero", () => {
  const html = P.renderMarketCardBody({ ...CARD, readings: {}, narrative: null,
    score: null, publicScore: null, band: null, publicBand: null });
  const txt = strip(html);
  assert.match(txt, /No public readings resolved/);
  assert.match(txt, /rather than a score of zero/);
  assert.match(html, /rk-none/, "and the pill must be the no-data one");
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
