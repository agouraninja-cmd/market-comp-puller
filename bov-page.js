"use strict";
// ---------------------------------------------------------------------------
// /bov — the BOV builder (2026-11-27).
//
// The owner's ask: "Create a tool in the pipeline section that creates a
// Professional BOV for the brokers. and change the pipeline named section to
// be called the broker section." So the rail's Pipeline row is Broker, a
// section of two tabs (server.js brokerSectionTabs): Pipeline (/pipeline, the
// board vault-page.js draws) and BOV builder, this page.
//
// A broker fills in a form on the left and reads the finished document on the
// right as they type: a cover on their own letterhead, their opinion of value,
// the property, the comparables from their own comps (or typed in), their
// recommendation, and the conditions every BOV carries. Print, or save as a
// PDF, is the browser's own.
//
// THREE FILES, AND WHICH DECIDES WHAT.
//   bov-doc.js      PURE (the global BOVDOC, tested): how a figure is read,
//                   which comps suit a subject, the range they support, and
//                   the document's HTML and stylesheet.
//   bov-builder.js  BROWSER only: binds this form to a draft, keeps the draft
//                   in this browser, and prints. It decides nothing BOVDOC
//                   can answer.
//   this file       the page's markup and its own stylesheet. A marketShell
//                   BODY, like sites-page.js: no doctype, head, header or
//                   footer, no Tailwind classes, its <style> in the body after
//                   MARKET_CSS. Buttons are components.js's .btn, unrestyled.
//
// THE RULES THIS PAGE HOLDS.
//   1. NOTHING TYPED HERE IS SENT ANYWHERE (CLAUDE.md rule 6). The draft
//      holds an owner's name, an NOI and a broker's private comps; it lives
//      in this browser's storage and on the paper this browser prints. The
//      page's only requests are reads of the broker's own data (the comps in
//      the boot, GET /api/branding, GET /api/broker/bovs), plus two presses:
//      a street photo of the subject (POST /api/building-photo, the address
//      in the body: rule 7's own door) and "Mark it delivered", which moves
//      the BOV's card on the Pipeline board (POST /api/broker/bovs/update,
//      a status and nothing else).
//   2. NO WRITE ON LOAD, so a copy built ahead of the click (rule 15) is
//      harmless. The one read that seeds (/api/broker/bovs) is on
//      instant-nav.js's HOLD_PATHS already.
//   3. THE GATE IS THE COMPS' OWN. server.js boots this page with
//      vaultReadPayload, so the three refusals (401, 403 without Pro, 503
//      with no database) are /comps' and /pipeline's, said here as walls.
//
// The literal below interpolates the walls, the option lists and the boot
// JSON; the script lives in its own file so nothing here is subject to the
// one-backslash trap vault-page.js documents.
// ---------------------------------------------------------------------------

const BOVDOC = require("./bov-doc");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function wall(boot) {
  if (!boot) return `<div class="bb-wall"><p><strong>The BOV builder couldn&rsquo;t be loaded just now.</strong> Please try again in a minute.</p></div>`;
  if (boot.s === 401) return `<div class="bb-wall"><p>Please <a href="/desk">sign in</a> to write a BOV.</p></div>`;
  if (boot.s === 403) {
    return `<div class="bb-wall"><p><strong>The BOV builder is part of Pro.</strong>
      Turn your own comps into a Broker Opinion of Value on your letterhead, ready to print or send as a PDF.</p>
      <p style="margin:0"><a class="btn" href="/desk">See your plan</a></p></div>`;
  }
  const why = (boot.j && boot.j.error) || "The BOV builder is unavailable right now. Please try again in a minute.";
  return `<div class="bb-wall"><p>${esc(why)}</p></div>`;
}

function renderBovBody(boot) {
  const open = !!(boot && boot.s === 200);
  // </script> can never appear in the payload: every "<" is escaped.
  const bootJson = open ? JSON.stringify({ j: boot.j, tag: boot.tag || "" }).replace(/</g, "\\u003c") : "null";
  const types = BOVDOC.PROPERTY_TYPES.map((t) => `<option>${esc(t)}</option>`).join("");
  const accents = BOVDOC.ACCENTS.map(([key, label, hex]) =>
    `<button type="button" class="bb-sw" data-accent="${esc(key)}" aria-pressed="false" title="${esc(label)}" aria-label="${esc(label)}"><i style="background:${esc(hex)}"></i></button>`).join("");
  const app = !open ? wall(boot) : `
  <div class="bb-app" id="bbApp">
    <div class="bb-form">

      <section class="bb-card" aria-labelledby="bbH1">
        <h2 id="bbH1"><span class="bb-n">1</span>The property</h2>
        <label class="bb-f" id="bbFromRow" hidden><span>Start from a BOV in your pipeline</span>
          <select id="bbFrom"><option value="">A new BOV</option></select></label>
        <label class="bb-f"><span>Address</span>
          <input id="bbAddr" type="text" autocomplete="off" placeholder="8400 W Fairview Ave, Boise, ID 83704"/></label>
        <div class="bb-row">
          <label class="bb-f"><span>Property type</span><select id="bbType">${types}</select></label>
          <label class="bb-f" id="bbSizeRow"><span>Building size (SF)</span>
            <input id="bbSize" type="text" inputmode="decimal" autocomplete="off" placeholder="45,000"/></label>
          <label class="bb-f"><span id="bbAcresLab">Lot (acres)</span>
            <input id="bbAcres" type="text" inputmode="decimal" autocomplete="off" placeholder="optional"/></label>
        </div>
        <div class="bb-row">
          <label class="bb-f"><span>Year built</span>
            <input id="bbYear" type="text" inputmode="numeric" autocomplete="off" placeholder="optional"/></label>
          <label class="bb-f"><span>Occupancy</span>
            <input id="bbOcc" type="text" autocomplete="off" placeholder="100% leased"/></label>
          <label class="bb-f"><span>Zoning</span>
            <input id="bbZoning" type="text" autocomplete="off" placeholder="optional"/></label>
        </div>
        <label class="bb-f"><span>What stands out about it</span>
          <textarea id="bbHighlights" rows="3" placeholder="Dock-high loading, 28&rsquo; clear, new roof in 2023, two miles from I-84."></textarea></label>
        <p class="bb-err" id="bbPropErr" hidden></p>
      </section>

      <section class="bb-card" aria-labelledby="bbH2">
        <h2 id="bbH2"><span class="bb-n">2</span>Who it is for</h2>
        <div class="bb-row two">
          <label class="bb-f"><span>Owner&rsquo;s name</span><input id="bbClient" type="text" autocomplete="off"/></label>
          <label class="bb-f"><span>Company</span><input id="bbClientCo" type="text" autocomplete="off" placeholder="optional"/></label>
        </div>
      </section>

      <section class="bb-card" aria-labelledby="bbH3">
        <h2 id="bbH3"><span class="bb-n">3</span>Comparables <b class="bb-count" id="bbCompN"></b></h2>
        <p class="bb-note" id="bbCompLead">From your own comps. The closest matches are ticked to start; change them freely.</p>
        <div id="bbCompTools" hidden>
          <input id="bbFind" type="search" autocomplete="off" placeholder="Find in your comps: address, city or type" aria-label="Find in your comps"/>
        </div>
        <div class="bb-clist" id="bbCompList"></div>
        <button type="button" class="bb-link" id="bbCompMore" hidden></button>
        <p class="bb-note" id="bbCompEmpty" hidden>You have no comps saved yet. <a href="/comps">Add your comps</a> once and
          they are here for every BOV, or type the sales you are relying on below.</p>
        <div class="bb-clist" id="bbManualList"></div>
        <details class="bb-fold" id="bbManualBox">
          <summary>+ Add a comparable sale by hand</summary>
          <label class="bb-f"><span>Address</span><input id="bbmAddr" type="text" autocomplete="off" placeholder="123 Main St, Boise, ID"/></label>
          <div class="bb-row">
            <label class="bb-f"><span>Sold</span><input id="bbmDate" type="date"/></label>
            <label class="bb-f"><span id="bbmSizeLab">Size (SF)</span><input id="bbmSize" type="text" inputmode="decimal" autocomplete="off"/></label>
            <label class="bb-f"><span>Price</span><input id="bbmPrice" type="text" inputmode="decimal" autocomplete="off" placeholder="1,250,000"/></label>
          </div>
          <div class="bb-row">
            <label class="bb-f"><span>Cap rate (%)</span><input id="bbmCap" type="text" inputmode="decimal" autocomplete="off" placeholder="optional"/></label>
            <div class="bb-f bb-act"><button type="button" class="btn ghost" id="bbmAdd">Add it</button></div>
          </div>
          <p class="bb-err" id="bbmErr" hidden></p>
        </details>
      </section>

      <section class="bb-card" aria-labelledby="bbH4">
        <h2 id="bbH4"><span class="bb-n">4</span>Your opinion of value</h2>
        <div class="bb-suggest" id="bbSuggest" hidden>
          <p id="bbSuggestText"></p>
          <button type="button" class="btn ghost sm" id="bbUse">Use this range</button>
        </div>
        <div class="bb-row">
          <label class="bb-f"><span>Low</span><input id="bbLow" type="text" inputmode="decimal" autocomplete="off" placeholder="3,600,000"/></label>
          <label class="bb-f"><span>High</span><input id="bbHigh" type="text" inputmode="decimal" autocomplete="off" placeholder="4,100,000"/></label>
          <label class="bb-f"><span>List price</span><input id="bbList" type="text" inputmode="decimal" autocomplete="off" placeholder="3,950,000"/></label>
        </div>
        <p class="bb-err" id="bbValErr" hidden></p>
        <p class="bb-note">The value on the document is the one you type. It is your opinion, on your letterhead.</p>
        <details class="bb-fold" id="bbIncomeBox">
          <summary>+ Add an income cross-check</summary>
          <div class="bb-row two">
            <label class="bb-f"><span>Net operating income (a year)</span><input id="bbNoi" type="text" inputmode="decimal" autocomplete="off" placeholder="285,000"/></label>
            <label class="bb-f"><span>Cap rate (%)</span><input id="bbCap" type="text" inputmode="decimal" autocomplete="off" placeholder="6.75"/></label>
          </div>
          <p class="bb-note" id="bbIncomeOut"></p>
          <p class="bb-err" id="bbIncErr" hidden></p>
        </details>
      </section>

      <section class="bb-card" aria-labelledby="bbH5">
        <h2 id="bbH5"><span class="bb-n">5</span>In your words</h2>
        <div class="bb-f"><span class="bb-lab"><label for="bbSummary">How you reached the value</label>
          <button type="button" class="bb-link" id="bbSummaryDraft">Write a first draft</button></span>
          <textarea id="bbSummary" rows="5"></textarea></div>
        <label class="bb-f"><span>Market overview</span>
          <textarea id="bbMarket" rows="4" placeholder="Vacancy, rents, who is buying and what has changed this year. Optional."></textarea></label>
        <div class="bb-f"><span class="bb-lab"><label for="bbStrategy">Pricing and marketing</label>
          <button type="button" class="bb-link" id="bbStrategyDraft">Write a first draft</button></span>
          <textarea id="bbStrategy" rows="6"></textarea></div>
        <label class="bb-f"><span>About you and your firm</span>
          <textarea id="bbAbout" rows="3" placeholder="Optional. Recent sales nearby, years in the market, your team."></textarea></label>
      </section>

      <section class="bb-card" aria-labelledby="bbH6">
        <h2 id="bbH6"><span class="bb-n">6</span>Letterhead and look</h2>
        <p class="bb-brand" id="bbBrand">Loading your letterhead&hellip;</p>
        <p class="bb-note"><a href="/desk?firm=1">Edit your letterhead</a>: your logo, firm, license number and contact details. It is the
          branding your reports already carry.</p>
        <div class="bb-f"><span>Colour</span><div class="bb-sws" id="bbAccents">${accents}</div></div>
        <div class="bb-f"><span>Cover photo</span>
          <div class="bb-photo">
            <button type="button" class="btn ghost sm" id="bbPhotoPick">Upload a photo</button>
            <button type="button" class="btn ghost sm" id="bbPhotoStreet">Use a street photo</button>
            <button type="button" class="bb-link" id="bbPhotoRemove" hidden>Remove</button>
            <input id="bbPhotoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden/>
          </div>
          <p class="bb-note" id="bbPhotoMsg"></p></div>
      </section>

      <p class="bb-private">Nothing you type here is sent to CompNinja. This draft is kept in this browser only, so it is here when you
        come back on this computer. <button type="button" class="bb-link" id="bbReset">Start over</button></p>
    </div>

    <div class="bb-side">
      <div class="bb-bar">
        <div class="bb-ready" id="bbReady"></div>
        <button type="button" class="btn" id="bbPrint">Print or save as PDF</button>
      </div>
      <div class="bb-done" id="bbDone" hidden>
        <span>Sent it to the owner?</span>
        <button type="button" class="btn ghost sm" id="bbDelivered">Mark it delivered in your pipeline</button>
        <span id="bbDoneMsg"></span>
      </div>
      <div class="bb-prev" id="bbPrev"><div class="bb-zoom" id="bbZoom"></div></div>
    </div>
  </div>`;

  return `<style>
.bb-page,.bb-page *{box-sizing:border-box}
/* The footer starts below the first screen, as on /sites and /pipeline. The
   page is wider than the site's 1120px so the document beside the form is
   large enough to read. */
body>main.wrap{min-height:100vh;max-width:1320px}
.bb-page{margin:0 0 56px}
.bb-page [hidden]{display:none!important}
.bb-head h1{margin:0}
.bb-sub{font-size:var(--text-compact);line-height:1.55;color:var(--ink-3);margin:8px 0 0;max-width:80ch}
.bb-wall{margin-top:24px;padding:24px;border:1px solid var(--edge);border-radius:var(--r-xl);background:var(--card);max-width:640px;
  font-size:var(--text-compact);color:var(--ink-body)}
.bb-wall p{margin:0 0 14px}
.bb-wall p:last-child{margin-bottom:0}
.bb-wall strong{color:var(--ink)}
.bb-app{display:grid;grid-template-columns:minmax(0,460px) minmax(0,1fr);gap:28px;align-items:start;margin-top:24px}
.bb-form{display:flex;flex-direction:column;gap:14px;min-width:0}
.bb-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-xl);padding:18px 20px 20px;box-shadow:var(--lift);
  display:flex;flex-direction:column;gap:14px;min-width:0}
.bb-card h2{display:flex;align-items:center;gap:10px;margin:0;font-size:var(--text-lead);font-weight:600;letter-spacing:-.01em;
  line-height:1.3;color:var(--ink)}
.bb-n{flex:none;width:22px;height:22px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:var(--text-label);
  font-weight:600;line-height:22px;text-align:center}
.bb-count{margin-left:auto;font-size:var(--text-label);font-weight:500;color:var(--ink-3)}
.bb-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.bb-row.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.bb-f{display:flex;flex-direction:column;gap:5px;min-width:0;margin:0}
.bb-f>span,.bb-lab label{font-size:var(--text-label);font-weight:500;color:var(--ink-2);line-height:1.4}
.bb-lab{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.bb-act{justify-content:flex-end}
.bb-page input[type=text],.bb-page input[type=search],.bb-page input[type=date],.bb-page select,.bb-page textarea{
  width:100%;min-width:0;padding:8px 10px;border:1px solid var(--edge);border-radius:var(--r-md);background:var(--card);
  color:var(--ink);font:inherit;font-size:var(--text-compact);line-height:1.4}
.bb-page textarea{resize:vertical;min-height:64px;line-height:1.5}
.bb-page input:focus,.bb-page select:focus,.bb-page textarea:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink)}
.bb-page input.bad{border-color:var(--err-rule);background:var(--err-bg)}
.bb-note{margin:0;font-size:var(--text-small);line-height:1.5;color:var(--ink-3)}
.bb-err{margin:0;font-size:var(--text-small);line-height:1.5;color:var(--err-text)}
.bb-link{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:var(--text-small);color:var(--red);cursor:pointer;
  text-align:left}
.bb-link:hover{color:var(--red-deep);text-decoration:underline;text-underline-offset:3px}
.bb-fold>summary{cursor:pointer;font-size:var(--text-small);font-weight:500;color:var(--ink-2);list-style:none;padding:4px 0}
.bb-fold>summary::-webkit-details-marker{display:none}
.bb-fold>summary:hover{color:var(--ink)}
.bb-fold[open]{display:flex;flex-direction:column;gap:12px}
/* The comps: one line each, a tick, the address and what it sold for. */
.bb-clist{display:flex;flex-direction:column}
.bb-clist:empty{display:none}
.bb-c{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:9px 2px;
  border-top:1px solid var(--hair);cursor:pointer;min-height:44px}
.bb-c:first-child{border-top:0}
.bb-c input{width:16px;height:16px;margin:0;accent-color:var(--ink)}
.bb-c b{font-size:var(--text-small);font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bb-c i{grid-column:2;font-style:normal;font-size:var(--text-label);color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bb-c em{grid-column:3;grid-row:1 / span 2;font-style:normal;font-size:var(--text-small);font-weight:600;color:var(--ink);
  font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.bb-c em.none{font-weight:400;color:var(--ink-faint)}
.bb-c.off b,.bb-c.off em{color:var(--ink-3);font-weight:500}
.bb-c .bb-x{grid-column:3;grid-row:1 / span 2}
.bb-suggest{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:var(--r-lg);
  background:var(--wash);border:1px solid var(--line)}
.bb-suggest p{margin:0;font-size:var(--text-small);line-height:1.5;color:var(--ink-body)}
.bb-suggest b{color:var(--ink)}
.bb-suggest>:last-child{flex:none}
.bb-brand{margin:0;font-size:var(--text-compact);color:var(--ink);line-height:1.5}
.bb-brand span{display:block;font-size:var(--text-small);color:var(--ink-3)}
.bb-sws{display:flex;gap:8px;flex-wrap:wrap}
.bb-sw{appearance:none;width:36px;height:36px;border-radius:50%;border:1px solid var(--edge);background:var(--card);padding:4px;cursor:pointer}
.bb-sw i{display:block;width:100%;height:100%;border-radius:50%}
.bb-sw[aria-pressed="true"]{border:2px solid var(--ink);padding:3px}
.bb-photo{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}
.bb-private{margin:4px 2px 0;font-size:var(--text-small);line-height:1.55;color:var(--ink-3)}
/* The document, beside the form: it stays in view while the form scrolls. */
.bb-side{position:sticky;top:16px;display:flex;flex-direction:column;gap:12px;min-width:0;max-height:calc(100vh - 32px)}
.bb-bar{display:flex;align-items:center;justify-content:space-between;gap:16px}
.bb-ready{font-size:var(--text-small);line-height:1.5;color:var(--ink-3);min-width:0}
.bb-ready b{color:var(--ink);font-weight:600}
.bb-ready.ok b{color:var(--ok-text)}
.bb-bar>:last-child{flex:none}
.bb-done{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:10px 14px;border-radius:var(--r-lg);background:var(--ok-bg);
  border:1px solid var(--ok-rule);font-size:var(--text-small);color:var(--ok-text)}
.bb-prev{flex:1 1 auto;min-height:320px;overflow:auto;background:var(--wash);border:1px solid var(--line);border-radius:var(--r-xl);
  padding:20px 20px 0}
.bb-zoom{width:816px;transform-origin:0 0}
/* The printed copy. Filled and moved under body only while it is printed
   (bov-builder.js), the comp sheet's way; never on screen. */
#bovSheet{display:none}
@media print{
  body.bov-printing>*{display:none!important}
  body.bov-printing>#bovSheet{display:block!important;background:white}
  body.bov-printing{background:white!important;padding:0!important}
}
@media (max-width:1040px){
  .bb-app{grid-template-columns:minmax(0,1fr)}
  .bb-side{position:static;max-height:none;order:-1}
  .bb-prev{max-height:60vh}
}
@media (max-width:640px){
  .bb-row,.bb-row.two{grid-template-columns:minmax(0,1fr)}
  .bb-bar{flex-direction:column;align-items:stretch}
  .bb-suggest{flex-direction:column;align-items:flex-start}
  .bb-prev{padding:12px 12px 0;max-height:50vh}
}
</style>
<style id="bbDocCss">${open ? BOVDOC.documentCss("navy") : ""}</style>
<div class="bb-page">
  <div class="bb-head">
    <h1>BOV builder</h1>
    <p class="bb-sub">Write a Broker Opinion of Value on your own letterhead, from your own comps. The finished document builds
      beside the form as you type.</p>
  </div>
${app}
</div>
<div id="bovSheet"></div>
${open ? `<script>window.__BOV_BOOT__=${bootJson};</script>
<script src="/bov-doc.js"></script>
<script src="/bov-builder.js"></script>` : ""}`;
}

module.exports = { renderBovBody };
