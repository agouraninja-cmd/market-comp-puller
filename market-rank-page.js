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

  return `<h1>Market rankings</h1>`
    + `<p class="sub">${scored.length} markets scored for ${esc(CLASS_LABEL[cls].toLowerCase())}, `
    + `from public government data. Every score shows its parts.</p>`

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
    + `Readings as of ${esc(meta.generated || "unknown")}.</p>`

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

  // The three components, each with the weight that produced it. Weight is
  // shown per row because "macro is -0.4" means something different at 0.20
  // than at 0.45, and land runs at 0.20 while industrial runs at 0.30.
  const part = (name, score, weight, cov) =>
    `<tr><td>${esc(name)}</td>`
    + `<td class="num">${fmtScore(score)}</td>`
    + `<td class="num">${Math.round((weight || 0) * 100)}%</td>`
    + `<td>${cov === undefined ? "" : coverageBar(cov)}</td></tr>`;

  // Every underlying reading, with its date and where it came from. This is the
  // audit trail: a number a reader cannot trace to a published series is a
  // number they have to take on trust, and the whole point of replacing the
  // model's asserted direction was that nobody could trace that either.
  const readingRows = Object.keys(m.readings || {}).sort().map((k) => {
    const r = m.readings[k] || {};
    const shown = (r.yoy_pct === null || r.yoy_pct === undefined)
      ? (typeof r.value === "number" ? r.value.toFixed(1) : "&mdash;")
      : (r.yoy_pct >= 0 ? "+" : "−") + Math.abs(r.yoy_pct).toFixed(2) + "%";
    return `<tr><td>${esc(k)}</td>`
      + `<td class="num">${shown}</td>`
      + `<td>${esc(r.as_of || "")}</td>`
      + `<td><span class="rk-tier">${esc(r.source || "")}${r.series_id ? " · " + esc(r.series_id) : ""}</span></td></tr>`;
  }).join("");

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

    + `<div class="card"><h2>How it is made up</h2>`
    + `<div class="rk-scroll"><table class="rk"><thead><tr>`
    + `<th>Component</th><th class="num">Score</th><th class="num">Weight</th><th style="width:4.5rem">Data</th>`
    + `</tr></thead><tbody>`
    + part("Macro economic", m.macro && m.macro.score, m.weights && m.weights.macro, m.macro && m.macro.coverage)
    + part(label + " specific", m.class && m.class.score, m.weights && m.weights.class, m.class && m.class.coverage)
    + part("Your read", m.narrative, m.weights && m.weights.narrative)
    + `</tbody></table></div>`
    + (m.narrative === null || m.narrative === undefined
        ? `<p class="rk-note">Nothing is written for this market yet. A read of your own changes only `
          + `your firm&rsquo;s view of it &mdash; the public score above stays exactly as it is.</p>`
        : `<p class="rk-note">${esc((m.lens && m.lens.name) || "Your read")}`
          + (m.lens && m.lens.updated ? `, updated ${esc(m.lens.updated)}` : "") + `.</p>`)
    + `</div>`

    + (readingRows
        ? `<div class="card"><h2>Every reading behind this</h2>`
          + `<div class="rk-scroll"><table class="rk"><thead><tr>`
          + `<th>Metric</th><th class="num">Value</th><th>As of</th><th>Source</th>`
          + `</tr></thead><tbody>${readingRows}</tbody></table></div>`
          + `<p class="rk-note">Each figure is the published series named beside it. Dates differ `
          + `because the sources publish on different schedules &mdash; employment monthly, house `
          + `prices quarterly, census structure annually.</p></div>`
        : `<div class="card"><h2>Every reading behind this</h2>`
          + `<p class="rk-note">No public readings resolved for this market, so it carries no `
          + `score rather than a score of zero.</p></div>`)

    + `<p class="disc">An automated indicator built from public government data and, where written, `
    + `a firm&rsquo;s own read. Not an appraisal, not investment advice, and not a substitute for `
    + `underwriting a specific property. Every input, weight and source is shown above so the `
    + `number can be checked.</p>`;
}

module.exports = { ASSET_CLASSES, CLASS_LABEL, RANK_CSS, renderRankingsBody,
  fmtScore, bandClass, bandWord, coverageBar, assetTabs, renderMarketCardBody };
