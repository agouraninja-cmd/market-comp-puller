// ---------------------------------------------------------------------------
// The market ranking pages: the ledger, and one market's card.
//
// Spec: docs/superpowers/specs/2026-09-01-market-ranking-design.md
//
// PURE, like guide-1031.js and valuation.js: no requires, no I/O, no clock. The
// caller hands in scored rows and this returns a string. That is what lets the
// whole page be tested without a server, and it is why the scoring lives in
// market-score.js rather than here — this file decides what a number LOOKS
// like, never what it is.
//
// ---------------------------------------------------------------------------
// THE RULE THIS PAGE EXISTS TO KEEP: the public score is always visible beside
// the adjusted one.
//
// A ranking a firm cannot defend to a capital partner is worth nothing, and
// "here is the public data, here is our read, here is the difference" is the
// defence. The moment a narrative adjustment is folded into a single number the
// page stops being auditable, and auditability is the entire argument for
// replacing the word the model used to assert.
//
// So every row carries its components, and the card spells out the difference
// in words. Nothing here renders a composite without them.
// ---------------------------------------------------------------------------
//
// COVERAGE IS RENDERED, NOT HIDDEN. market-score.js reports what share of a
// block's weight was actually present, and a market scored on half its inputs
// says so on screen. A score with 40% coverage and one with 100% are different
// claims about the world and must not look identical.

const ASSET_CLASSES = ["industrial", "office", "retail", "multifamily", "land", "residential"];

const CLASS_LABEL = {
  industrial: "Industrial", office: "Office", retail: "Retail",
  multifamily: "Multifamily", land: "Land", residential: "Residential",
};

// Small additions on top of MARKET_CSS, which already styles h1/.sub/.card/
// .disc. Tokens, never hex: this sits inside marketShell, which is themed, and
// a hardcoded colour would be a light island in dark mode.
const RANK_CSS = `
.rk-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 18px}
.rk-tab{display:inline-block;padding:6px 12px;border:1px solid var(--edge);border-radius:4px;
  background:var(--card);color:var(--ink-2);font-size:14px;font-weight:500;text-decoration:none}
.rk-tab:hover{background:var(--wash);color:var(--ink)}
.rk-tab[aria-current="page"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.rk-scroll{overflow-x:auto;border:1px solid var(--edge);border-radius:6px;background:var(--card)}
table.rk{border-collapse:collapse;width:100%;min-width:760px;font-size:14px}
table.rk th,table.rk td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--hair)}
table.rk thead th{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);border-bottom:1px solid var(--line);white-space:nowrap;background:var(--wash)}
table.rk tbody tr:last-child td{border-bottom:0}
table.rk tbody tr:hover{background:var(--wash)}
table.rk td.num,table.rk th.num{text-align:right;font-variant-numeric:tabular-nums}
.rk-mkt{font-weight:600}
.rk-mkt a{color:var(--ink)}
.rk-mkt a:hover{color:var(--red)}
.rk-tier{font-size:11px;color:var(--ink-3);margin-left:6px;font-weight:400}
.rk-pill{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.04em;
  text-transform:uppercase;padding:2px 7px;border-radius:3px;white-space:nowrap}
.rk-exp{background:var(--ok-bg);color:var(--ok-text);border:1px solid var(--ok-rule)}
.rk-flat{background:var(--est-bg);color:var(--est-text);border:1px solid var(--edge)}
.rk-con{background:var(--err-bg);color:var(--err-text);border:1px solid var(--err-rule)}
.rk-none{background:var(--wash);color:var(--ink-3);border:1px solid var(--edge)}
/* Coverage as a bar rather than a number: a reader scanning 196 rows needs to
   SEE which scores rest on partial data, not read a percentage on each. */
.rk-cov{display:inline-block;width:46px;height:6px;border-radius:2px;background:var(--hair);
  overflow:hidden;vertical-align:middle}
.rk-cov i{display:block;height:100%;background:var(--ink-3)}
.rk-note{font-size:13px;color:var(--ink-2);margin:14px 0 0}
.rk-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:12px 0 0;font-size:12px;color:var(--ink-3)}
/* --- One market's component panels ------------------------------------- */
/* Head is a single flex row: title, score, band, weight, coverage. It wraps
   rather than shrinking, because the score must never be squeezed onto two
   characters per line on a phone. */
.rk-comp-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 10px}
.rk-comp-head h2{margin:0;flex:1 1 auto;min-width:8rem}
.rk-comp-score{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}
.rk-comp-w{font-size:12px;color:var(--ink-3);white-space:nowrap}
.rk-comp-story{font-size:14.5px;color:var(--ink-2);margin:0;max-width:68ch;line-height:1.55}
.rk-comp-story::first-letter{text-transform:uppercase}
/* The drill-down. Closed by default: the sentence above is the answer, this is
   the evidence, and a page that opens all its evidence at once is the flat
   table this replaced. */
.rk-dig{margin:14px 0 0;border-top:1px solid var(--hair);padding-top:12px}
.rk-dig summary{cursor:pointer;font-size:13.5px;font-weight:600;color:var(--ink-2);
  list-style:none;display:inline-flex;align-items:center;gap:6px}
.rk-dig summary::-webkit-details-marker{display:none}
.rk-dig summary::before{content:"▸";font-size:11px;color:var(--ink-3);transition:transform .12s}
.rk-dig[open] summary::before{transform:rotate(90deg)}
.rk-dig summary:hover{color:var(--ink)}
.rk-dig .rk-scroll{margin-top:12px}
/* Your read is the one panel a member can change, so it is the one panel that
   does not look like the others. */
.rk-yours{border-color:var(--ink-4)}
.rk-yours-act{margin:14px 0 0;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.rk-yours-act .rk-note{margin:0;flex:1 1 16rem;min-width:12rem}
.rk-export p{font-size:14px;color:var(--ink-2);margin:0 0 12px;max-width:62ch}
.rk-export-links{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0 0 10px}
.rk-export-alt{font-size:13.5px;color:var(--ink-mute);text-decoration:underline;
  text-decoration-color:var(--edge)}
.rk-export-alt:hover{color:var(--ink)}
/* --- The explorer's entry card (/markets) ------------------------------- */
/* Two columns on a wide screen: the explanation and the class links on the
   left, the live top three on the right. One column below 720px, where a
   side-by-side would squeeze every market name onto two lines. */
.rke{border:1px solid var(--edge);background:var(--card);border-radius:6px;
  padding:22px 24px;margin:0 0 26px;box-shadow:var(--lift);
  display:grid;grid-template-columns:1.35fr 1fr;gap:8px 30px;align-items:start}
.rke-head{grid-column:1}
.rke h2{font-family:var(--serif);font-weight:500;font-size:21px;color:var(--ink);
  margin:0 0 6px;letter-spacing:normal;text-transform:none}
.rke-head p{color:var(--ink-2);font-size:14px;margin:0;max-width:56ch}
.rke-tabs{grid-column:1;display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:14px}
.rke-lab{font-size:13px;color:var(--ink-2);font-weight:600;margin-right:2px}
/* The preview spans both left-hand rows so it sits beside the text, not under it. */
.rke-top{grid-column:2;grid-row:1 / span 2;border-left:1px solid var(--hair);padding-left:26px}
.rke-top h3{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);margin:0 0 9px}
.rke-list{list-style:none;margin:0;padding:0}
.rke-list li{display:flex;align-items:center;gap:8px;font-size:14px;padding:5px 0;
  border-bottom:1px solid var(--hair)}
.rke-list li:last-child{border-bottom:0}
.rke-n{color:var(--ink-3);font-size:12px;font-variant-numeric:tabular-nums;min-width:.9rem}
.rke-list a{color:var(--ink);font-weight:600;flex:1;min-width:0}
.rke-list a:hover{color:var(--red)}
.rke-s{font-variant-numeric:tabular-nums;color:var(--ink-2);font-size:13px}
.rke-more{margin:12px 0 0;font-size:13.5px}
.rke-foot{grid-column:1;font-size:12px;color:var(--ink-3);margin:12px 0 0}
@media(max-width:720px){
  .rke{grid-template-columns:1fr;padding:20px}
  .rke-top{grid-column:1;grid-row:auto;border-left:0;padding-left:0;
    border-top:1px solid var(--hair);padding-top:16px;margin-top:16px}
}
`;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function fmtScore(v) {
  if (typeof v !== "number" || !isFinite(v)) return "&mdash;";
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
}

function bandClass(band) {
  return band === "expanding" ? "rk-exp"
    : band === "contracting" ? "rk-con"
    : band === "flat" ? "rk-flat" : "rk-none";
}

function bandWord(band) {
  return band ? band.charAt(0).toUpperCase() + band.slice(1) : "No data";
}

// A market with no score at all renders "No data", never "Flat". Zero on a
// -1..+1 scale is a measurement and absence is not one; the distinction is the
// same one market-score.js draws in the arithmetic, carried through to the
// page so a reader cannot be told a market is steady when it is unknown.
function coverageBar(cov) {
  const pct = typeof cov === "number" && isFinite(cov) ? Math.round(cov * 100) : 0;
  return `<span class="rk-cov" role="img" aria-label="${pct}% of inputs present">`
    + `<i style="width:${pct}%"></i></span>`;
}

function assetTabs(current) {
  return `<div class="rk-controls"><span style="font-size:13px;color:var(--ink-2);font-weight:600">Asset class</span>`
    + ASSET_CLASSES.map((c) =>
      `<a class="rk-tab" href="/rankings/${c}"${c === current ? ' aria-current="page"' : ""}>`
      + `${CLASS_LABEL[c]}</a>`).join("")
    + `</div>`;
}

// rows: [{ market, state, tier, cbsa, score, publicScore, band, publicBand,
//          coverage, macro, class, narrative, bandMovedByNarrative }]
function renderRankingsBody(assetClass, rows, meta) {
  const cls = ASSET_CLASSES.includes(assetClass) ? assetClass : "industrial";
  const scored = rows.filter((r) => typeof r.score === "number");
  const unscored = rows.length - scored.length;

  // Only scored markets go in the table. An unscored one has nothing to show
  // and, when a whole tier is still loading, 146 identical "No data" rows would
  // bury the 50 that mean something — the reader would scroll past the answer
  // looking for it. The count is reported below the table instead, by tier, so
  // a market's absence is stated rather than merely felt.
  const pendingByTier = rows.filter((r) => typeof r.score !== "number")
    .reduce((a, r) => { a[r.tier] = (a[r.tier] || 0) + 1; return a; }, {});

  const body = scored.map((r, i) => {
    const moved = r.bandMovedByNarrative
      ? ` <span class="rk-tier" title="Your read changed which band this market is in">moved</span>` : "";
    return `<tr>`
      + `<td class="num">${i + 1}</td>`
      + `<td class="rk-mkt"><a href="/rankings/${cls}/${esc(r.cbsa)}">${esc(r.market)}, ${esc(r.state)}</a>`
      + `<span class="rk-tier">${esc(r.tier)}</span></td>`
      + `<td class="num">${fmtScore(r.macro)}</td>`
      + `<td class="num">${fmtScore(r.class)}</td>`
      + `<td class="num">${r.narrative === null || r.narrative === undefined ? "&mdash;" : fmtScore(r.narrative)}</td>`
      + `<td class="num"><strong>${fmtScore(r.score)}</strong></td>`
      + `<td><span class="rk-pill ${bandClass(r.band)}">${bandWord(r.band)}</span>${moved}</td>`
      + `<td>${coverageBar(r.coverage)}</td>`
      + `</tr>`;
  }).join("");

  // WHEN THE CLASS BLOCK IS EMPTY, SAY SO LOUDLY.
  //
  // With no class-specific readings, every asset class renders the SAME list —
  // the macro score alone — under six different headings. A member clicking
  // "Office" would get the industrial ranking wearing an office label, which is
  // worse than showing nothing because it looks like an answer. Observed on the
  // first wiring, 2026-09-02, when the readings file still held only macro
  // metrics.
  const withClass = rows.filter((r) => typeof r.class === "number").length;
  const classGap = withClass === 0
    ? `<div class="card" style="border-color:var(--est-text);background:var(--est-bg)">`
      + `<p style="margin:0;font-size:14px;color:var(--est-text)"><strong>No ${esc(CLASS_LABEL[cls].toLowerCase())}-specific `
      + `data has loaded yet.</strong> This ranking is the macro-economic score alone, which means it is `
      + `<em>identical for every asset class</em> right now — switching the tabs above will not change the order. `
      + `The class weighting is what makes an industrial ranking differ from an office one, and it is `
      + `not in effect until those readings arrive.</p></div>`
    : withClass < rows.length / 2
    ? `<div class="card" style="border-color:var(--edge)"><p style="margin:0;font-size:14px;color:var(--ink-2)">`
      + `Only ${withClass} of ${rows.length} markets have ${esc(CLASS_LABEL[cls].toLowerCase())}-specific readings. `
      + `The rest are scored on macro data alone and show it in the Data column.</p></div>`
    : "";

  // The way back. The market card has carried "All markets" to the ledger since
  // it shipped; the ledger had nothing to the page a reader arrives FROM, so
  // the step was one-way and the browser's back button was the only exit.
  return `<p style="margin:0 0 6px"><a href="/markets">&larr; Market explorer</a></p>`
    + `<h1>Market rankings</h1>`
    + `<p class="sub">${scored.length} markets ranked on macroeconomic fundamentals, weighted `
    + `for ${esc(CLASS_LABEL[cls].toLowerCase())}. Every score breaks out to its components.</p>`

    + assetTabs(cls)
    + classGap

    + `<div class="rk-scroll"><table class="rk">`
    + `<thead><tr>`
    + `<th class="num" style="width:3.4rem">Rank</th>`
    + `<th>Market</th>`
    + `<th class="num">Macro</th>`
    + `<th class="num">Class</th>`
    + `<th class="num">Your read</th>`
    + `<th class="num">Score</th>`
    + `<th>Direction</th>`
    + `<th style="width:4.5rem">Data</th>`
    + `</tr></thead><tbody>${body}</tbody></table></div>`

    + `<div class="rk-legend">`
    + `<span><span class="rk-pill rk-exp">Expanding</span> score at or above +0.25</span>`
    + `<span><span class="rk-pill rk-flat">Flat</span> between</span>`
    + `<span><span class="rk-pill rk-con">Contracting</span> at or below &minus;0.25</span>`
    + `<span>Data = share of this class&rsquo;s inputs actually present</span>`
    + `</div>`

    + `<p class="rk-note">Weights for ${esc(CLASS_LABEL[cls].toLowerCase())}: `
    + `${Math.round((meta.weights.macro || 0) * 100)}% macro, `
    + `${Math.round((meta.weights.class || 0) * 100)}% class-specific, `
    + `${Math.round((meta.weights.narrative || 0) * 100)}% your read. `
    + `Data as of ${esc(meta.generated || "unknown")}.</p>`

    + (unscored
        ? `<p class="rk-note">${unscored} further market${unscored === 1 ? "" : "s"} `
          + `(${Object.keys(pendingByTier).sort().map((t) => `${pendingByTier[t]} ${esc(t)}`).join(", ")}) `
          + `${unscored === 1 ? "has" : "have"} no readings loaded yet and ${unscored === 1 ? "is" : "are"} `
          + `not listed. They are not markets that scored badly &mdash; nothing has been measured for them.</p>`
        : "")

    + `<p class="disc">Rankings are computed from public government data and, where a firm has `
    + `written one, that firm&rsquo;s own read of the market. They are an automated indicator, not `
    + `an appraisal, not investment advice, and not a substitute for underwriting a specific `
    + `property. Every input and weight is shown so the number can be checked.</p>`;
}


// ---------------------------------------------------------------------------
// Saying what a component MEANS, not only what it scored.
//
// The card used to end in one flat table of every reading, sorted
// alphabetically: five to eight rows of metric / value / date / series id.
// That is an audit trail, it is the right thing to keep, and it was doing the
// wrong JOB. A reader opening a market wants to know which way it is moving
// and what is driving that; they were handed the raw inputs and left to do the
// blending in their head.
//
// So each component now leads with a sentence naming what pulls it up and what
// pulls it down, with the published figure beside each, and the table moves
// behind a disclosure for the reader who wants to check. Summary first,
// evidence one click away, nothing removed.
//
// WHAT THIS CANNOT SAY, and deliberately does not imply: whether a trend is
// accelerating. macro-readings.json holds exactly ONE observation per market
// and metric (919 readings, 919 distinct market-metric pairs, measured
// 2026-09-02), so there is no history to difference. Every figure quoted here
// is itself a year-over-year change, which is a direction; "faster than last
// quarter" is a second derivative and the points for it do not exist yet. The
// 045 table is append-only and accumulates exactly that history as the monthly
// refresh runs, and this is the function that should grow when it has.

// "Job growth (total nonfarm, YoY)" -> "job growth". The parenthetical names
// the series for the audit table, where it belongs; in a sentence it is noise.
function shortMetric(name) {
  return String(name == null ? "" : name)
    .replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// The published figure for one metric, as an analyst would quote it. Never the
// normalised -1..+1 score, which is ours and means nothing off this page.
//
// A LEVEL IS NOT A CHANGE, and this function got that wrong on first writing.
// Educational attainment is a STOCK - 51.2% of Boston adults hold a degree -
// and the refresh script stores it in `yoy_pct` because that is the field the
// scorer reads. Rendered by the old rule it came out as "educational
// attainment (+51.2%)", which reads as a metro whose graduate share grew by
// half in a year. Real number, right market, wrong quantity, and nothing
// throws: the same failure the CBSA verification and the discontinued-series
// filter exist to refuse, reintroduced in a sentence.
//
// Three cases, decided from the config rather than guessed from the name:
//
//   1. The threshold's unit says LEVEL      -> a stock. No sign, no "YoY".
//   2. No yoy_pct on the reading            -> we are showing `value`, which is
//                                              a level (unemployment: 3.9%).
//   3. Otherwise                            -> a genuine year-over-year change,
//                                              signed and labelled YoY.
//
// "YoY" is printed rather than implied. Two of these metrics are levels and
// the rest are changes; a reader should not have to know which is which.
function metricFigure(reading, unit) {
  const r = reading || {};
  const u = String(unit == null ? "" : unit);
  const pct = /percent/i.test(u) ? "%" : "";
  const isLevel = /\bLEVEL\b/.test(u);

  if (!isLevel && typeof r.yoy_pct === "number" && isFinite(r.yoy_pct)) {
    return (r.yoy_pct >= 0 ? "+" : "\u2212") + Math.abs(r.yoy_pct).toFixed(1) + pct + " YoY";
  }
  const level = isLevel && typeof r.yoy_pct === "number" && isFinite(r.yoy_pct)
    ? r.yoy_pct
    : (typeof r.value === "number" && isFinite(r.value) ? r.value : null);
  return level === null ? null : level.toFixed(1) + pct;
}

function nameWithFigure(name, readings, units) {
  const fig = metricFigure((readings || {})[name], (units || {})[name]);
  return esc(shortMetric(name)) + (fig ? " (" + fig + ")" : "");
}

// "a, b and c" - no Oxford comma, because this is prose rather than a list.
function joinList(items) {
  if (items.length <= 1) return items[0] || "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

// The band a component sits in, on the same edges the composite uses. Defined
// here rather than imported because this file may not require
// market-score.js - and the edges are printed in the ledger's legend, so a
// reader can check this against what they were told.
function componentBand(score) {
  if (typeof score !== "number" || !isFinite(score)) return null;
  return score >= 0.25 ? "expanding" : score <= -0.25 ? "contracting" : "flat";
}

// The sentence. Returns null when there is nothing to say, so the caller
// renders no paragraph rather than an empty one.
//
// The +/-0.1 dead zone is not a rounding tolerance, it is an editorial one: a
// metric scoring 0.04 sits at its neutral point, and naming it as a driver
// would be inventing a story out of noise. Those are counted, never named.
function narrateBlock(block, readings, opts) {
  const o = opts || {};
  const metrics = (block && block.metrics) || {};
  const present = Object.keys(metrics)
    .filter((k) => typeof metrics[k] === "number" && isFinite(metrics[k]));
  if (!present.length) return null;

  const byScore = present.slice().sort((a, b) => metrics[b] - metrics[a]);
  const upAll = byScore.filter((k) => metrics[k] > 0.1);
  const downAll = byScore.filter((k) => metrics[k] < -0.1);
  const ups = upAll.slice(0, 2).map((k) => nameWithFigure(k, readings, o.units));
  const downs = downAll.slice().reverse().slice(0, 2)
    .map((k) => nameWithFigure(k, readings, o.units));
  const flatCount = present.length - upAll.length - downAll.length;

  let sentence;
  if (ups.length && downs.length) {
    sentence = joinList(ups) + " " + (ups.length === 1 ? "leads" : "lead") + " the read; "
      + joinList(downs) + " " + (downs.length === 1 ? "pulls" : "pull") + " against "
      + (ups.length === 1 ? "it" : "them") + ".";
  } else if (ups.length) {
    sentence = "Nothing that reported is negative. " + joinList(ups) + " "
      + (ups.length === 1 ? "is the strongest input" : "are the strongest inputs") + ".";
  } else if (downs.length) {
    sentence = "Nothing that reported is positive. " + joinList(downs) + " "
      + (downs.length === 1 ? "is the weakest input" : "are the weakest inputs") + ".";
  } else {
    sentence = "All " + present.length + " indicator" + (present.length === 1 ? "" : "s")
      + " sit close to " + (present.length === 1 ? "its" : "their") + " neutral point "
      + "&mdash; there is no driver to name.";
  }

  const flat = (flatCount > 0 && (ups.length || downs.length))
    ? " " + flatCount + (flatCount === 1 ? " other sits" : " others sit") + " near neutral." : "";

  // What did NOT report is part of the read. The coverage bar is a shape; a
  // member deciding whether to trust a score needs the gap stated in words.
  const total = (typeof o.expected === "number" && o.expected > present.length)
    ? o.expected : present.length;
  const missing = total - present.length;
  const cover = missing
    ? " " + present.length + " of " + total + " indicators reported; the other "
      + missing + " " + (missing === 1 ? "is" : "are")
      + " not scored rather than scored as zero."
    : " All " + present.length + " indicator" + (present.length === 1 ? "" : "s") + " reported.";

  return sentence + flat + cover;
}

// One component: its score, its weight, what it means, and the evidence folded
// underneath. `readings` is the whole market's set; a block shows only the keys
// it actually weighs, so opening "Macro economic" gives macro rows and not the
// class rows as well.
function renderComponent(opts) {
  const o = opts || {};
  const block = o.block || {};
  const names = Object.keys(block.metrics || {});
  const story = narrateBlock(block, o.readings, { expected: o.expected, units: o.units });
  const bnd = componentBand(block.score);

  const rows = names.slice().sort().map((k) => {
    const r = (o.readings || {})[k] || {};
    const fig = metricFigure(r, (o.units || {})[k]);
    return "<tr><td>" + esc(k) + "</td>"
      + '<td class="num">' + (fig === null ? "&mdash;" : fig) + "</td>"
      + '<td class="num">' + fmtScore(block.metrics[k]) + "</td>"
      + "<td>" + esc(r.as_of || "") + "</td>"
      + '<td><span class="rk-tier">' + esc(r.source || "")
      + (r.series_id ? " \u00b7 " + esc(r.series_id) : "") + "</span></td></tr>";
  }).join("");

  return '<div class="card rk-comp">'
    + '<div class="rk-comp-head">'
    + "<h2>" + esc(o.title) + "</h2>"
    + '<span class="rk-comp-score">' + fmtScore(block.score) + "</span>"
    + '<span class="rk-pill ' + bandClass(bnd) + '">' + bandWord(bnd) + "</span>"
    + '<span class="rk-comp-w">' + Math.round((o.weight || 0) * 100) + "% of the score</span>"
    + (typeof block.coverage === "number" ? coverageBar(block.coverage) : "")
    + "</div>"
    + '<p class="rk-comp-story">'
    + (story || esc(o.emptyText || "No indicators have loaded for this component, so it carries "
        + "no score rather than a score of zero."))
    + "</p>"
    + (rows
      ? '<details class="rk-dig"><summary>Show the ' + names.length + " indicator"
        + (names.length === 1 ? "" : "s") + " behind this</summary>"
        + '<div class="rk-scroll"><table class="rk"><thead><tr>'
        + "<th>Indicator</th>"
        + '<th class="num">Published</th>'
        + '<th class="num">Scored</th>'
        + "<th>As of</th><th>Source</th>"
        + "</tr></thead><tbody>" + rows + "</tbody></table></div>"
        + '<p class="rk-note">Published is the figure the source released; scored is that figure '
        + "mapped onto the &minus;1 to +1 scale by market-thresholds.json. Dates differ because "
        + "the sources publish on different schedules &mdash; employment monthly, home prices "
        + "quarterly, census structure annually.</p></details>"
      : "")
    + "</div>";
}

// ---------------------------------------------------------------------------
// Your read: the one component a member can change.
//
// It rendered as a row in a table beside two components nobody can edit, worth
// 25% of the score, permanently showing an em dash. Nothing said it was
// EDITABLE, so the honest reading of that card was "a quarter of this score is
// broken" rather than "a quarter of this score is yours and you have not
// written it yet".
//
// So it gets its own panel, its own verb, and a state that says which of the
// two it is in. The weight is stated in both states, because the reason to
// write one is that it moves the number by a known amount.
function renderYourRead(m, cls) {
  const w = Math.round(((m.weights && m.weights.narrative) || 0) * 100);
  const has = typeof m.narrative === "number" && isFinite(m.narrative);
  const lens = m.lens || null;
  const href = "/rankings/" + cls + "/" + esc(m.cbsa) + "/read";

  return '<div class="card rk-comp rk-yours">'
    + '<div class="rk-comp-head">'
    + "<h2>Your read</h2>"
    + '<span class="rk-comp-score">' + (has ? fmtScore(m.narrative) : "&mdash;") + "</span>"
    + (has ? '<span class="rk-pill ' + bandClass(componentBand(m.narrative)) + '">'
             + bandWord(componentBand(m.narrative)) + "</span>" : "")
    + '<span class="rk-comp-w">' + w + "% of the score</span>"
    + "</div>"

    + (has
      ? '<p class="rk-comp-story">' + esc((lens && lens.name) || "Your read")
        + (lens && lens.updated ? ", updated " + esc(lens.updated) : "")
        + ". It moves this market from " + fmtScore(m.publicScore) + " to "
        + fmtScore(m.score) + (m.bandMovedByNarrative ? ", across a band boundary" : "")
        + ".</p>"
        + '<p class="rk-yours-act"><a class="btn sm" href="' + href + '">Edit your read</a> '
        + '<a class="rk-export-alt" href="' + href + '?clear=1">or remove it &rarr;</a></p>'
      : '<p class="rk-comp-story">Nothing is written for this market yet, so the score above is '
        + "the public data and nothing else. A read of your own is for the SPECIFIC, CHECKABLE "
        + "events that move a market before they reach a government series &mdash; a fabricator "
        + "breaking ground, a port expansion, a rail spur, an entitlement that just cleared, a "
        + "single tenant taking a million feet.</p>"
        + '<p class="rk-yours-act"><a class="btn sm" href="' + href + '">Write your read</a> '
        + '<span class="rk-note">Worth ' + w + "% here. It changes your firm&rsquo;s view of this "
        + "market and nothing else &mdash; the public score stays exactly as it is.</span></p>")
    + "</div>";
}

// ---------------------------------------------------------------------------
// One market, in full. The view a member opens from a row.
//
// This is where the public/adjusted distinction is stated in WORDS rather than
// implied by two columns. A reader who skims a table can miss that a number was
// moved by somebody's opinion; a sentence saying "the public data reads +0.27;
// your firm's read moves it to +0.34" cannot be missed, and it is the sentence
// a capital partner will ask about.
//
// m: { market, state, tier, cbsa, cbsaName, population, assetClass,
//      score, publicScore, band, publicBand, coverage, bandMovedByNarrative,
//      weights: {macro, class, narrative},
//      macro: {score, coverage, metrics:{name: score}},
//      class: {score, coverage, metrics:{...}},
//      narrative: number|null, lens: {name, updated}|null,
//      readings: {name: {value, yoy_pct, as_of, source, series_id}} }
function renderMarketCardBody(m) {
  const cls = ASSET_CLASSES.includes(m.assetClass) ? m.assetClass : "industrial";
  const label = CLASS_LABEL[cls];

  // `part` and `readingRows` lived here until the card was rebuilt around
  // renderComponent: one flat alphabetical table of every reading has become
  // three panels that each say what they mean and fold their own evidence
  // underneath. The audit trail is unchanged and is inside the disclosures -
  // it moved, it was not dropped, and the reason is in renderComponent's
  // header.

  const moved = m.bandMovedByNarrative && m.publicBand && m.band;

  return `<p style="margin:0 0 6px"><a href="/rankings/${cls}">&larr; All markets</a></p>`
    + `<h1>${esc(m.market)}, ${esc(m.state)}</h1>`
    + `<p class="sub">${esc(label)} &middot; ${esc(m.tier)} market &middot; `
    + `${esc(m.cbsaName || "")}${m.population ? " &middot; population " + Number(m.population).toLocaleString() : ""}</p>`

    + assetTabs(cls)

    + `<div class="card"><h2 style="margin-top:0">Score</h2>`
    + `<p style="font-size:34px;font-weight:600;margin:0 0 4px;font-variant-numeric:tabular-nums">`
    + `${fmtScore(m.score)} <span class="rk-pill ${bandClass(m.band)}" style="font-size:12px;vertical-align:middle">${bandWord(m.band)}</span></p>`

    // The sentence. Public first, always.
    + `<p class="rk-note" style="margin-top:10px">`
    + (m.narrative === null || m.narrative === undefined
        ? `Public data alone: <strong>${fmtScore(m.publicScore)}</strong>. No firm read has been written for this market, `
          + `so the score is the public data and nothing else.`
        : `Public data reads <strong>${fmtScore(m.publicScore)}</strong> (${bandWord(m.publicBand).toLowerCase()}). `
          + `${esc((m.lens && m.lens.name) || "Your read")} moves it to <strong>${fmtScore(m.score)}</strong>`
          + (moved ? ` &mdash; and across a band boundary, from ${bandWord(m.publicBand).toLowerCase()} to ${bandWord(m.band).toLowerCase()}.`
                   : `, within the same band.`))
    + `</p></div>`

    // The three components, each leading with what it MEANS and folding its
    // evidence underneath. Order is weight order for every class we ship, and
    // it is also reading order: the broad economy, then this asset class, then
    // the reader's own judgement on top.
    + renderComponent({
        title: "Macro economic",
        block: m.macro, weight: m.weights && m.weights.macro,
        readings: m.readings, units: m.units, expected: m.expected && m.expected.macro,
        emptyText: "No macro indicators resolved for this market, so this component carries no "
          + "score rather than a score of zero.",
      })
    + renderComponent({
        title: label + " specific",
        block: m.class, weight: m.weights && m.weights.class,
        readings: m.readings, units: m.units, expected: m.expected && m.expected.class,
        emptyText: "No " + label.toLowerCase() + "-specific indicators have loaded for this market "
          + "yet. Until they do, this market's " + label.toLowerCase() + " score is its macro score.",
      })
    + renderYourRead(m, cls)

    // Export sits between the analysis and the disclaimer, which is where a
    // reader who has finished reading and wants the numbers elsewhere looks
    // for it.
    + `<div class="card rk-export"><h2>Take this away</h2>`
    + `<p>Every indicator behind this market, with its published figure, its scored value, `
    + `its as-of date and the series it came from &mdash; as a spreadsheet.</p>`
    + `<p class="rk-export-links">`
    + `<a class="btn sm" href="/rankings/${cls}/${esc(m.cbsa)}.csv">Download this market (CSV)</a> `
    + `<a class="rk-export-alt" href="/rankings/${cls}.csv">or all ${esc(label.toLowerCase())} markets &rarr;</a>`
    + `</p>`
    + `<p class="rk-note">CSV opens directly in Excel, Google Sheets and Numbers. The file carries `
    + `its own provenance line, because a column of scores in a client email needs to say where it `
    + `came from.</p></div>`

    + `<p class="disc">An automated indicator built from public government data and, where written, `
    + `a firm&rsquo;s own read. Not an appraisal, not investment advice, and not a substitute for `
    + `underwriting a specific property. Every input, weight and source is shown above so the `
    + `number can be checked.</p>`;
}

// ---------------------------------------------------------------------------
// The door, on /markets. The spec's "hero card at the top of the market
// explorer - the primary route".
//
// The rankings shipped with no way in. /rankings, /rankings/<class> and the
// market card all render, all set `current: "/markets"` so the nav lights up
// Market explorer, and nothing on Market explorer linked to any of them. A
// feature nobody can reach is a feature that does not exist.
//
// WHY IT CARRIES DATA RATHER THAN BEING A BUTTON. A card that only says
// "market rankings ->" asks the reader to take a trip to find out whether the
// trip was worth taking. Three real rows answer that on the page they are
// already on, and they are the same three the ledger opens with because both
// read the same sorted array - the preview cannot drift from the thing it
// previews.
//
// The six class links are here for the reason they are on the ledger: the
// ranking is genuinely different per asset class (measured 2026-09-02: an
// average spread of 18.7 places out of 49, San Jose moving 7th to 46th), so a
// member who works one class steps straight into it rather than landing on
// industrial and re-navigating.
//
// PURE, like everything else in this file. The caller decides whether there is
// anything to show; an empty `rows` returns an empty string rather than a card
// promising a ranking that is not there.
function renderExplorerEntry(assetClass, rows, meta) {
  const cls = ASSET_CLASSES.includes(assetClass) ? assetClass : "industrial";
  const scored = (rows || []).filter((r) => typeof r.score === "number");
  if (!scored.length) return "";                  // no data, no door
  const m = meta || {};

  const preview = scored.slice(0, 3).map((r, i) =>
    `<li><span class="rke-n">${i + 1}</span>`
    + `<a href="/rankings/${cls}/${esc(r.cbsa)}">${esc(r.market)}, ${esc(r.state)}</a>`
    + `<span class="rke-s">${fmtScore(r.score)}</span>`
    + `<span class="rk-pill ${bandClass(r.band)}">${bandWord(r.band)}</span></li>`).join("");

  return `<div class="rke">`
    + `<div class="rke-head">`
    + `<h2>Market rankings</h2>`
    + `<p>${scored.length} US markets ranked on macroeconomic fundamentals &mdash; employment `
    + `and labor force growth, wage trends and home price appreciation &mdash; with weightings `
    + `calibrated to each asset class. Every score breaks out to its components, each traceable `
    + `to the published series behind it.</p>`
    + `</div>`

    // Not the ledger's tabs: nothing is aria-current here, because the reader
    // has not chosen a class yet. This is where they choose one.
    + `<div class="rke-tabs"><span class="rke-lab">Rank for</span>`
    + ASSET_CLASSES.map((c) =>
        `<a class="rk-tab" href="/rankings/${c}">${CLASS_LABEL[c]}</a>`).join("")
    + `</div>`

    + `<div class="rke-top">`
    + `<h3>Leading for ${esc(CLASS_LABEL[cls].toLowerCase())}</h3>`
    + `<ol class="rke-list">${preview}</ol>`
    + `<p class="rke-more"><a href="/rankings/${cls}">See all ${scored.length} markets &rarr;</a></p>`
    + `</div>`

    + (m.generated ? `<p class="rke-foot">Data as of ${esc(m.generated)}.</p>` : "")
    + `</div>`;
}

// ---------------------------------------------------------------------------
// The spreadsheet. Rows of raw values, NOT csv text.
//
// This module does not escape anything, on purpose: broker-vault.js's csvCell
// already carries the formula-injection guard (a cell beginning = + - or @ is
// a live payload when the file is opened in Excel), and a second escaper here
// would be a second thing to keep correct. server.js maps these rows through
// that one. So the split is: this decides what belongs in the file, that
// decides how a cell is written.
//
// A PROVENANCE LINE ABOVE THE HEADER, the pattern bulk.js's export already
// sets. The file outlives the screen that explained it, and a column of
// scores forwarded to a client with no source line is exactly how an
// automated indicator gets read as an appraisal.

function rankingsCsvRows(assetClass, rows, meta) {
  const cls = ASSET_CLASSES.includes(assetClass) ? assetClass : "industrial";
  const m = meta || {};
  const scored = (rows || []).filter((r) => typeof r.score === "number");
  const w = m.weights || {};
  const out = [];

  out.push(["CompNinja market rankings \u00b7 " + CLASS_LABEL[cls]
    + " \u00b7 " + scored.length + " markets"
    + " \u00b7 weights " + Math.round((w.macro || 0) * 100) + "% macro / "
    + Math.round((w.class || 0) * 100) + "% class / "
    + Math.round((w.narrative || 0) * 100) + "% your read"
    + " \u00b7 data as of " + (m.generated || "unknown")
    + " \u00b7 automated indicator built from public government data, not an appraisal"]);
  out.push(["Rank", "Market", "State", "Tier", "CBSA", "CBSA name", "Population",
    "Macro", "Class", "Your read", "Score", "Direction", "Coverage"]);

  scored.forEach((r, i) => {
    out.push([i + 1, r.market, r.state, r.tier, r.cbsa, r.cbsaName || "", r.population || "",
      numOrBlank(r.macro), numOrBlank(r.class), numOrBlank(r.narrative),
      numOrBlank(r.score), r.band || "",
      typeof r.coverage === "number" ? Math.round(r.coverage * 100) + "%" : ""]);
  });

  // Unscored markets are NAMED rather than dropped. On the page they are a
  // count under the table; in a spreadsheet a reader filters and sorts, and a
  // market silently absent from a 49-row file reads as a market that does not
  // exist. Blank score cells, so nothing averages them by accident.
  const unscored = (rows || []).filter((r) => typeof r.score !== "number");
  if (unscored.length) {
    out.push([]);
    out.push(["Not scored \u2014 no readings loaded yet. Absent from the ranking, not ranked last."]);
    unscored.forEach((r) => {
      out.push(["", r.market, r.state, r.tier, r.cbsa, r.cbsaName || "", r.population || "",
        "", "", "", "", "", "0%"]);
    });
  }
  return out;
}

// One market: every indicator behind it, which is the drill-down the card
// folds away, in the tool a reader would actually analyse it in.
function marketCsvRows(m) {
  const cls = ASSET_CLASSES.includes(m.assetClass) ? m.assetClass : "industrial";
  const w = m.weights || {};
  const out = [];

  out.push(["CompNinja market ranking \u00b7 " + (m.market || "") + ", " + (m.state || "")
    + " \u00b7 " + CLASS_LABEL[cls]
    + " \u00b7 CBSA " + (m.cbsa || "")
    + " \u00b7 score " + fmtPlain(m.score) + " (" + (m.band || "no data") + ")"
    + " \u00b7 automated indicator built from public government data, not an appraisal"]);
  out.push([]);

  out.push(["Component", "Score", "Weight", "Coverage"]);
  out.push(["Macro economic", numOrBlank(m.macro && m.macro.score),
    pct(w.macro), pct(m.macro && m.macro.coverage)]);
  out.push([CLASS_LABEL[cls] + " specific", numOrBlank(m.class && m.class.score),
    pct(w.class), pct(m.class && m.class.coverage)]);
  out.push(["Your read", numOrBlank(m.narrative), pct(w.narrative), ""]);
  out.push(["Composite", numOrBlank(m.score), "", pct(m.coverage)]);
  out.push(["Public only (no read)", numOrBlank(m.publicScore), "", ""]);
  out.push([]);

  out.push(["Indicator", "Component", "Published", "Scored", "As of", "Source", "Series"]);
  const blocks = [["Macro economic", m.macro], [CLASS_LABEL[cls] + " specific", m.class]];
  for (const [name, block] of blocks) {
    const metrics = (block && block.metrics) || {};
    for (const k of Object.keys(metrics).sort()) {
      const r = (m.readings || {})[k] || {};
      // Same level-vs-change rule as the page. A spreadsheet is read further
      // from its explanation than a page is, so "+51.2% YoY" in a cell is
      // worse here than it was there.
      out.push([k, name, metricFigure(r, (m.units || {})[k]) || "",
        numOrBlank(metrics[k]), r.as_of || "", r.source || "", r.series_id || ""]);
    }
  }
  return out;
}

// Plain numbers for a spreadsheet: no + sign, no unicode minus, no em dash.
// fmtScore's output is for a page - "\u22120.12" is a MINUS SIGN, which Excel
// reads as text and will not sum.
function numOrBlank(v) {
  return typeof v === "number" && isFinite(v) ? round2(v) : "";
}
function round2(v) { return Math.round(v * 100) / 100; }
function fmtPlain(v) { return typeof v === "number" && isFinite(v) ? round2(v) : "no data"; }
function pct(v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 100) + "%" : ""; }

module.exports = { ASSET_CLASSES, CLASS_LABEL, RANK_CSS, renderRankingsBody,
  fmtScore, bandClass, bandWord, coverageBar, assetTabs, renderMarketCardBody, renderExplorerEntry,
  narrateBlock, renderComponent, renderYourRead, componentBand,
  rankingsCsvRows, marketCsvRows };
