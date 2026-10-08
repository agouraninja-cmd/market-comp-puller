"use strict";
// ---------------------------------------------------------------------------
// /permits — the Permit tracker (permit signals, 2026-09-24; the owner's
// "it should be under tools"). Every commercial permit the sweep has stored
// for the last thirty days in the cities it reads, searchable, with the ones
// at a building on the reader's firm board marked and linked to that
// building's sheet.
//
// A marketShell BODY, like buildings-page.js: no doctype, head, header or
// footer, no Tailwind utility classes (tailwind.css is purged against
// index.html alone), and its <style> emitted in the BODY after MARKET_CSS so
// its rules win on equal specificity. server.js owns the route, the gate and
// the read (permitTrackerPayload); this file only decides how it is drawn.
//
// THREE TABS (2026-10-02, the owner's pick of Draft C from the Permit Tracker
// Drafts, https://claude.ai/artifact/762RCzFWGbnb7PrwcshtkA). The page had
// grown one feature at a time into three stacked boxes; it is now Filings,
// Your permits and Alerts, each its own view, and it opens on Your permits
// when one of them has unread news, on Filings otherwise. A bare hash names a
// tab (#filings, #your-permits, #alerts) and a tab click keeps it there, so a
// reload stays put.
//  - FILINGS: filters down the left, each with its count for the whole window
//    (city, property type, work, status, permit type, your firm's buildings;
//    OR within a group, AND across groups), and the list grouped by the day
//    each permit was filed. On a phone the groups are buttons that open.
//  - YOUR PERMITS: each tracked permit as a timeline of its five steps with
//    the day we saw it reach each one (permit-watch.js's stepSeenAt; a step it
//    had reached before we were watching has no date), its unread news under
//    it, and one Manage box for everything else.
//  - ALERTS: each alert with the newest permits it found, and "See all N in
//    Filings" to filter the list to it.
//
// ONE READ, FILTERED HERE. The boot carries the whole window (capped, and it
// says so), and the search box and filters work in the browser. The counts
// describe the whole window, never the filtered view — the shelf's rule.
//
// HONESTY (spec §7): the page names the cities it reads and when the sweep
// last ran, and says so when that run is more than a business day old. It
// never implies a city it does not read was checked.
//
// YOUR PERMITS (2026-09-27, owner's call). A member's own tracked permits:
// add one by city and number (looked up on the city's portal as it is added,
// so a typo is caught on the spot), pick which of the five steps to hear
// about and how — email, CompNinja, or both — and read each permit's steps,
// status and history. The rules live in permit-watch.js; the boot carries
// them as `mine` beside the feed, read on its own so an unavailable section
// never costs the list. The page CLEARS the unread count with a POST once the
// Your permits tab is shown (a fetch, which instant-nav holds until the page
// is visible — CLAUDE.md rule 15), never in the server render.
//
// PROPERTY TYPE (2026-09-29). Each filing arrives with its propertyType
// (permit-zoning.js owns the rule, read-time, nothing stored); every type is
// offered with its count, a zero included, and a type with nothing in it says
// so in words rather than as a bare "no match".
//
// YOUR ALERTS (2026-10-01; migration 057; rules in permit-alerts.js). A
// member saves what they follow — a city, a property type, a kind and
// optional words — and gets the new permits that fit it by email each weekday
// morning. Pro to add or change; deleting is open. The counts, the tags and
// the form's preview are drawn here from the feed the page already has
// (alertMatches, a ⚠ pair with permit-alerts.js's matches).
//
// AREAS (2026-10-01). An alert may also follow a circle: within ½, 1, 2 or 5
// miles of an address. The form checks the address as it is typed (the site's
// own /api/geocode, Census behind it) and draws the circle and the list's
// permits on a map; a saved area alert has "Show on map". Leaflet loads only
// when a map opens; the tiles are the market pages' (CNBASE, sent in this
// page's head). A permit with no place on the map can never match an area,
// and the page says how many there are.
//
// The page literal below contains exactly ONE backtick, its own opener, and
// interpolates the boot JSON alone; test/permits-page.test.js guards both.
// ---------------------------------------------------------------------------

function renderPermitsBody(boot) {
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<style>
.pt-page,.pt-page *{box-sizing:border-box}
.pt-page{margin:24px 0 48px}
.pt-page .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.pt-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1.5px solid var(--ink);padding-bottom:8px;margin-top:4px}
.pt-head h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:28px;line-height:1.15;color:var(--ink)}
.pt-cmp{font-size:13px;color:var(--ink-2);white-space:nowrap}
.pt-cmp:hover{color:var(--ink)}
.pt-sub{font-size:13px;color:var(--ink-3);margin:10px 0 0;max-width:88ch}
.pt-sub.stale{color:var(--err-text)}
.pt-wall{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:18px 20px;margin:18px 0}
.pt-wall p{margin:0 0 8px;font-size:14px;color:var(--ink-body)}
.pt-wall a{color:var(--red);text-decoration:underline}
.pt-rm{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:13px;color:var(--ink-2);cursor:pointer;white-space:nowrap}
.pt-rm:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.pt-rm:focus-visible,.pt-tab:focus-visible,.pt-fgh:focus-visible{outline:2px solid var(--red);outline-offset:2px}
/* The three tabs. The underline is an inset shadow, so the row can scroll on a phone without clipping it. */
.pt-tabs{display:flex;gap:28px;margin-top:20px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.pt-tab{appearance:none;border:0;background:none;font:inherit;padding:10px 0 11px;font-size:14.5px;color:var(--ink-2);cursor:pointer;display:inline-flex;align-items:baseline;gap:6px;white-space:nowrap}
.pt-tab:hover{color:var(--ink)}
.pt-tab[aria-selected="true"]{color:var(--ink);font-weight:600;box-shadow:inset 0 -2px 0 var(--ink)}
.pt-tab .n{font-size:12.5px;font-weight:400;color:var(--ink-3);font-variant-numeric:tabular-nums}
.pt-badge{align-self:center;font-size:11.5px;font-weight:600;color:#fff;background:var(--red-fill);border-radius:4px;padding:2px 6px}
.pt-protag{align-self:center;font-size:11px;font-weight:500;color:var(--ink-3);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.pt-panel{padding-top:22px}
/* A status tag: the portal's own words, coloured by what they mean (permit-watch.js's stageOf). */
.st{display:inline-block;font-size:12px;line-height:1;padding:5px 8px;border-radius:4px;white-space:nowrap;font-weight:500;background:var(--wash);color:var(--ink-2)}
.st.approved{background:none;color:var(--ok-text);box-shadow:inset 0 0 0 1px var(--ok-rule)}
.st.issued{background:var(--ok-bg);color:var(--ok-text)}
.st.attention{background:var(--warn-bg);color:var(--warn-text)}
.st.ended{background:var(--err-bg);color:var(--err-text)}
.st.none{background:none;color:var(--ink-3);box-shadow:inset 0 0 0 1px var(--line)}
/* Filings */
.pt-two{display:grid;grid-template-columns:200px minmax(0,1fr);gap:40px;align-items:start}
.pt-fac{display:flex;flex-direction:column;gap:20px;font-size:13px;min-width:0}
.pt-fgh{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink);margin:0 0 6px;cursor:default;display:flex;align-items:baseline;gap:6px;text-align:left}
.pt-fgh .c{font-weight:600;color:var(--red)}
.pt-fgl label{display:flex;align-items:center;gap:8px;padding:3px 0;color:var(--ink-body);cursor:pointer}
.pt-fgl label.zero{color:var(--ink-3)}
.pt-fgl input{margin:0;width:14px;height:14px;flex:0 0 14px;accent-color:var(--ink)}
.pt-fgl .t{flex:1;min-width:0}
.pt-fgl .n{color:var(--ink-3);font-variant-numeric:tabular-nums}
.pt-list{min-width:0}
.pt-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;margin:0 0 4px}
.pt-tools input[type=search]{flex:1 1 260px;min-width:0;font:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--edge);border-radius:6px;background:var(--card);color:var(--ink)}
.pt-shown{font-size:13px;color:var(--ink-3);white-space:nowrap;font-variant-numeric:tabular-nums}
.pt-shown b{color:var(--ink);font-weight:600}
.pt-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}
.pt-chip{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink);background:var(--card);border:1px solid var(--edge);border-radius:6px;padding:4px 6px 4px 10px}
.pt-chip button{appearance:none;border:0;background:none;padding:0 4px;font:inherit;font-size:14px;line-height:1;color:var(--ink-3);cursor:pointer}
.pt-chip button:hover{color:var(--ink)}
.pt-day h3{display:flex;justify-content:space-between;gap:12px;margin:18px 0 0;padding:0 0 6px;border-bottom:1px solid var(--line);font-family:inherit;font-size:12.5px;font-weight:600;color:var(--ink)}
.pt-day h3 span{font-weight:400;color:var(--ink-3);font-variant-numeric:tabular-nums}
.pt-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start;padding:10px 0;border-bottom:1px solid var(--hair)}
.pt-main{min-width:0}
.pt-addr{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;font-size:14px}
.pt-addr .a{font-weight:500;color:var(--ink)}
.pt-addr .c{font-size:13px;color:var(--ink-3)}
.pt-board{font-size:12px;font-weight:500;color:var(--ok-text)}
.pt-board:hover{color:var(--ok-text);text-decoration:underline;text-underline-offset:3px}
.pt-hit{display:inline-flex;align-items:baseline;gap:5px;font-size:12px;color:var(--ink-2)}
.pt-hit::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ink-4);transform:translateY(-1px)}
.pt-l2{font-size:12.5px;color:var(--ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-right{display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.pt-num{font-size:12.5px;color:var(--ink-2);white-space:nowrap}
a.pt-num:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.pt-note{font-size:12.5px;color:var(--ink-3);margin:12px 0 0}
.pt-empty2{font-size:13px;color:var(--ink-2);margin:12px 0 0;padding:12px 14px;border:1px solid var(--hair);border-radius:8px;background:var(--wash)}
.pt-foot{font-size:12px;color:var(--ink-3);margin:22px 0 0;max-width:100ch}
/* Your permits and Your alerts */
.pw-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 0 8px}
.pw-sub{flex:1 1 320px;margin:0;font-size:13.5px;color:var(--ink-2)}
.pw-btns{display:flex;gap:8px}
.pw-btn{appearance:none;font:inherit;font-size:13px;line-height:1.2;padding:7px 12px;border-radius:6px;border:1px solid var(--edge);background:var(--card);color:var(--ink);cursor:pointer;white-space:nowrap;display:inline-block}
.pw-btn:hover{border-color:var(--ink-3)}
.pw-btn.pri{background:var(--red-fill);border-color:var(--red-fill);color:#fff}
.pw-btn.pri:hover{background:var(--red-fill-hover);border-color:var(--red-fill-hover);color:#fff}
.pw-btn[disabled]{opacity:.6;cursor:default}
.pw-pro{max-width:560px;padding:4px 0 16px}
.pw-pro h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:20px;color:var(--ink)}
.pw-pro p{margin:6px 0 14px;font-size:14px;color:var(--ink-2)}
.pw-form{border-top:1px solid var(--line);padding:16px 0 18px}
.pw-grid{display:flex;flex-wrap:wrap;gap:10px}
.pw-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ink-2);flex:1 1 160px;min-width:0}
.pw-grid input,.pw-grid select{font:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--edge);border-radius:6px;background:var(--card);color:var(--ink);min-width:0}
.pw-grid .opt{color:var(--ink-3)}
.pw-set{border:0;margin:14px 0 0;padding:0;min-width:0}
.pw-set legend{font-size:12.5px;font-weight:600;color:var(--ink);padding:0;margin:0 0 6px}
.pw-opts{display:flex;flex-wrap:wrap;gap:6px 16px}
.pw-set label.chk{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-body);cursor:pointer}
.pw-fine{font-size:12px;color:var(--ink-3);margin:6px 0 0}
.pw-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:16px}
.pw-msg{font-size:12.5px;color:var(--ink-2)}
.pw-msg.bad{color:var(--err-text)}
.pw-msg.ok{color:var(--ok-text)}
.pw-card,.pa-item{padding:18px 0 20px;border-top:1px solid var(--line)}
.pw-card.pw-focus{background:var(--wash);box-shadow:0 0 0 12px var(--wash);border-radius:2px}
.pw-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.pw-id{min-width:0}
.pw-name{margin:0;font-family:inherit;font-size:16px;font-weight:600;color:var(--ink)}
.pw-meta{margin:2px 0 0;font-size:12.5px;color:var(--ink-3)}
.pw-meta a{color:var(--ink-2)}
.pw-meta a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.pw-right{display:flex;align-items:center;gap:14px;flex-shrink:0}
/* The five steps, as a line: done steps green, the furthest ringed, each dated by the day we saw it. */
.pw-tl{list-style:none;margin:16px 0 0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));max-width:760px}
.pw-tl li{position:relative;padding-top:20px;font-size:12.5px;color:var(--ink-3);min-width:0}
.pw-tl li::before{content:"";position:absolute;left:0;top:3px;width:11px;height:11px;border-radius:50%;background:var(--paper);box-shadow:inset 0 0 0 2px var(--ink-4);z-index:1}
.pw-tl li::after{content:"";position:absolute;left:11px;right:0;top:8px;height:2px;background:var(--line)}
.pw-tl li:last-child::after{display:none}
.pw-tl li.done::before{background:var(--ok-text);box-shadow:none}
.pw-tl li.done::after{background:var(--ok-text)}
.pw-tl li.now::after{background:var(--line)}
.pw-tl li.now::before{box-shadow:0 0 0 3px var(--ok-bg)}
.pw-tl b{display:block;font-weight:500;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pw-tl li.done b{color:var(--ink)}
.pw-tl li.now b{font-weight:600}
.pw-tl time{display:block;font-size:12px;color:var(--ink-3)}
.pw-latest{margin:14px 0 0;max-width:760px;padding:8px 12px;border-radius:6px;background:var(--ok-bg);font-size:13px;color:var(--ink-body)}
.pw-latest.warn{background:var(--warn-bg)}
.pw-latest.err{background:none;padding:0;color:var(--warn-text)}
.pw-latest b{font-weight:600;color:var(--ink)}
.pw-box{margin-top:14px;max-width:760px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
.pw-foot{margin:0;font-size:12.5px;color:var(--ink-3)}
.pw-foot .err{color:var(--warn-text)}
.pw-acts{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:10px}
.pw-box .pw-form{border-top:1px solid var(--hair);margin-top:12px;padding-bottom:4px}
.pw-hist{margin:12px 0 0;font-size:12.5px;color:var(--ink-2)}
.pw-hist b{display:block;font-weight:600;color:var(--ink);margin-bottom:2px}
.pw-hist ul{margin:0;padding-left:18px}
.pw-hist li{margin:2px 0}
.pw-hist li.unread{font-weight:600;color:var(--ink)}
.pw-bulk textarea{display:block;width:100%;margin:10px 0 0;font:inherit;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;
  padding:8px 10px;border:1px solid var(--edge);border-radius:6px;background:var(--card);color:var(--ink);resize:vertical;min-height:110px}
.pw-bulk input[type=file]{font-size:12.5px;padding:6px 0;border:0;background:none}
.pw-review{margin:12px 0 0;font-size:12.5px;color:var(--ink-body)}
.pw-review ul,.pw-done ul{margin:4px 0 8px;padding-left:18px}
.pw-review li,.pw-done li{margin:2px 0}
.pw-review .why,.pw-done .why{color:var(--ink-3)}
.pw-review b,.pw-done b{font-weight:600}
.pw-done{font-size:12.5px;color:var(--ink-body);background:var(--ok-bg);border-radius:6px;padding:8px 10px;margin:0 0 10px}
.pw-done.warn{background:var(--warn-bg)}
.pa-week{font-size:13px;color:var(--ink-3);white-space:nowrap}
.pa-week b{color:var(--ink);font-weight:600}
.pa-mini{list-style:none;margin:12px 0 0;padding:0;max-width:860px}
.pa-mini li{display:grid;grid-template-columns:52px minmax(0,200px) minmax(0,1fr) auto;gap:14px;align-items:center;padding:7px 0;border-top:1px solid var(--hair);font-size:13px}
.pa-mini time{font-size:12.5px;color:var(--ink-3)}
.pa-mini .a{font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-mini .w{color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pa-all{margin-top:8px}
.pa-none{margin:10px 0 0;font-size:13px;color:var(--ink-3)}
.pa-area{margin-top:14px}
.pa-area .lab{display:block;font-size:12.5px;font-weight:600;color:var(--ink);margin:0 0 6px}
.pa-opts{display:flex;flex-direction:column;gap:8px}
.pa-opts label{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13.5px;color:var(--ink-body);cursor:pointer}
.pa-opts select,.pa-opts input[type=text]{font:inherit;font-size:13px;padding:7px 9px;border:1px solid var(--edge);border-radius:6px;background:var(--card);color:var(--ink);min-width:0}
.pa-opts input[type=text]{flex:1 1 220px}
.pa-found{font-size:12px;color:var(--ink-3);margin:6px 0 0}
.pa-found.ok{color:var(--ok-text)}
.pa-found.bad{color:var(--err-text)}
.pa-map{height:260px;border:1px solid var(--edge);border-radius:8px;margin-top:12px;overflow:hidden;background:var(--wash);max-width:860px}
.pa-mapnote{font-size:12px;color:var(--ink-3);margin:6px 0 4px}
.leaflet-tooltip.pa-count,[data-theme="dark"] .leaflet-tooltip.pa-count{background:none;border:0;box-shadow:none;color:#fff;font-weight:700;font-size:11px;padding:0}
.leaflet-tooltip.pa-count:before{display:none}
.pa-h{margin:0 0 10px;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:18px;color:var(--ink)}
.hide{display:none}
@media (max-width:760px){
  .pt-tabs{gap:20px}
  .pt-tab{font-size:14px}
  .pt-two{grid-template-columns:minmax(0,1fr);gap:14px}
  /* On a phone each filter group is a button that opens its list. */
  .pt-fac{flex-direction:row;flex-wrap:wrap;gap:8px}
  .pt-fg{border:1px solid var(--edge);border-radius:6px;background:var(--card)}
  .pt-fgh{margin:0;padding:6px 10px;font-weight:500;cursor:pointer}
  .pt-fgl{display:none;padding:0 10px 6px}
  .pt-fg.open{flex-basis:100%}
  .pt-fg.open .pt-fgl{display:block}
  .pt-shown{width:100%}
  .pw-top{flex-direction:column;gap:8px}
  .pw-tl li,.pw-tl time{font-size:11px}
  .pw-btns{flex-wrap:wrap}
  .pa-mini li{grid-template-columns:44px minmax(0,1fr) auto}
  .pa-mini .w{display:none}
  .pa-map{height:220px}
}
</style>
<main class="wrap pt-page">
  <div class="kicker">Tools</div>
  <div class="pt-head">
    <h1>Permit tracker</h1>
    <a class="pt-cmp" href="/permits/compare">Compare cities &rarr;</a>
  </div>
  <p class="pt-sub" id="ptSub"></p>
  <div class="pt-wall hide" id="ptWall"></div>
  <div id="ptApp" class="hide">
    <div class="pt-tabs" role="tablist" aria-label="Permit tracker" id="ptTabs">
      <button type="button" role="tab" class="pt-tab" id="tabFilings" aria-controls="ptFilings" aria-selected="true">Filings <span class="n" id="tabFilingsN"></span></button>
      <button type="button" role="tab" class="pt-tab" id="tabMine" aria-controls="pwSec" aria-selected="false" tabindex="-1">Your permits <span class="n" id="tabMineN"></span><span class="pt-badge hide" id="tabMineNew"></span><span class="pt-protag hide" id="tabMinePro">Pro</span></button>
      <button type="button" role="tab" class="pt-tab" id="tabAlerts" aria-controls="paSec" aria-selected="false" tabindex="-1">Alerts <span class="n" id="tabAlertsN"></span><span class="pt-protag hide" id="tabAlertsPro">Pro</span></button>
    </div>

    <section class="pt-panel" id="ptFilings" role="tabpanel" aria-labelledby="tabFilings">
      <div class="pt-two">
        <aside class="pt-fac" id="ptFac" aria-label="Filter the list"></aside>
        <div class="pt-list">
          <div class="pt-tools">
            <input type="search" id="ptSearch" placeholder="Search address, applicant, contractor or work" aria-label="Search permits" autocomplete="off"/>
            <span class="pt-shown" id="ptShown"></span>
            <button type="button" class="pt-rm hide" id="ptClearAll">Clear filters</button>
          </div>
          <div class="pt-chips hide" id="ptChips"></div>
          <div id="ptRows"></div>
          <p class="pt-empty2 hide" id="ptTypeNone"><span id="ptTypeNoneText"></span> <button type="button" class="pt-rm" id="ptTypeAll">Show every type</button></p>
          <p class="pt-note hide" id="ptNone">No permit matches. <button type="button" class="pt-rm" id="ptClear">Clear filters</button></p>
          <p class="pt-note hide" id="ptEmpty"></p>
          <p class="pt-note hide" id="ptTrunc"></p>
          <p class="pt-foot">Public record, read from each city’s own permit portal on weekday mornings. A permit’s property type comes from how Ada County zones its parcel and what the permit says it is for. Industrial means the parcel is zoned industrial, or, where the county could not answer, the permit describes industrial work. Where the zoning allows several uses, the permit’s own words decide, and a permit that does not say is listed under Other.</p>
        </div>
      </div>
    </section>

    <section class="pt-panel hide" id="pwSec" role="tabpanel" aria-labelledby="tabMine">
      <div class="pw-bar">
        <p class="pw-sub hide" id="pwSub"></p>
        <span class="pw-btns"><button type="button" class="pw-btn hide" id="pwBulkBtn">Add several</button><button type="button" class="pw-btn pri hide" id="pwAddBtn">Track a permit</button></span>
      </div>
      <div class="pw-pro hide" id="pwPro">
        <h2>Track the permits you filed</h2>
        <p id="pwProText">Tracking a permit is part of CompNinja Pro. Add a permit number and we read it from the city’s portal every weekday morning, then tell you, by email and here, when it reaches the steps you pick.</p>
        <a class="pw-btn pri" href="/?pricing=1">See Pro</a>
      </div>
      <form class="pw-form hide" id="pwForm" novalidate>
        <h3 class="pa-h">Track a permit</h3>
        <div class="pw-grid">
          <label>City <select id="pwCity"></select></label>
          <label>Permit number <input id="pwNum" maxlength="40" autocomplete="off" placeholder="e.g. BLD26-02789"/></label>
          <label><span>Nickname <span class="opt">optional</span></span><input id="pwLabel" maxlength="80" autocomplete="off" placeholder="e.g. Federal Way warehouse"/></label>
        </div>
        <p class="pw-fine hide" id="pwLate"></p>
        <div id="pwFormNotify"></div>
        <fieldset class="pw-set hide" id="pwFirmSet"><legend>Who</legend><div class="pw-opts">
          <label class="chk"><input type="checkbox" id="pwFirm"/> <span id="pwFirmText">Everyone at your firm</span></label></div>
          <p class="pw-fine">Everyone at the firm on Pro gets this permit’s notices, the way you set them above. Each of them can mute it.</p></fieldset>
        <div class="pw-actions">
          <button type="submit" class="pw-btn pri" id="pwSave">Track this permit</button>
          <button type="button" class="pt-rm" id="pwCancel">Cancel</button>
          <span class="pw-msg" id="pwMsg" role="status"></span>
        </div>
      </form>
      <form class="pw-form pw-bulk hide" id="pwBulk" novalidate>
        <h3 class="pa-h">Add several permits</h3>
        <p class="pw-fine" style="margin:0 0 10px">Paste permit numbers, one per line, or choose a CSV or Excel file. A sheet can have City, Permit number and Nickname columns; a row without a city uses the city picked here. Each permit is looked up on its city’s portal as it is added.</p>
        <div class="pw-grid">
          <label>City, when a row doesn’t say <select id="pwBulkCity"></select></label>
          <label><span>Or choose a file <span class="opt">CSV or Excel</span></span><input type="file" id="pwBulkFile" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain"/></label>
        </div>
        <textarea id="pwBulkText" rows="6" spellcheck="false" aria-label="Permit numbers" placeholder="BLD26-02789&#10;BLD26-02790, Federal Way warehouse&#10;Meridian, C-NEW-2026-0052"></textarea>
        <div id="pwBulkNotify"></div>
        <fieldset class="pw-set hide" id="pwBulkFirmSet"><legend>Who</legend><div class="pw-opts">
          <label class="chk"><input type="checkbox" id="pwBulkFirm"/> <span id="pwBulkFirmText">Everyone at your firm</span></label></div></fieldset>
        <div class="pw-review hide" id="pwBulkReview"></div>
        <div class="pw-actions">
          <button type="submit" class="pw-btn pri" id="pwBulkGo">Check the list</button>
          <button type="button" class="pt-rm" id="pwBulkCancel">Cancel</button>
          <span class="pw-msg" id="pwBulkMsg" role="status"></span>
        </div>
      </form>
      <div class="pw-done hide" id="pwBulkDone" role="status"></div>
      <div id="pwList"></div>
    </section>

    <section class="pt-panel hide" id="paSec" role="tabpanel" aria-labelledby="tabAlerts">
      <div class="pw-bar">
        <p class="pw-sub hide" id="paSub"></p>
        <button type="button" class="pw-btn pri hide" id="paAdd">New alert</button>
      </div>
      <div class="pw-pro hide" id="paPro">
        <h2>Get new permits by email</h2>
        <p>Permit alerts are part of CompNinja Pro. Save what you follow, like industrial in Boise or tenant build-outs in Meridian, and get its new permits by email each weekday morning.</p>
        <a class="pw-btn pri" href="/?pricing=1">See Pro</a>
      </div>
      <form class="pw-form hide" id="paForm" novalidate>
        <h3 class="pa-h" id="paFormTitle">New alert</h3>
        <div class="pw-grid">
          <label>City <select id="paCity"><option value="">Every city we read</option></select></label>
          <label>Property type <select id="paProp"><option value="">Every type</option></select></label>
          <label>Kind <select id="paKind"><option value="">Every kind</option></select></label>
          <label><span>Words <span class="opt">optional</span></span><input id="paWords" maxlength="60" autocomplete="off" placeholder="a street, applicant or contractor"/></label>
        </div>
        <div class="pa-area"><span class="lab">Area</span><div class="pa-opts">
          <label><input type="radio" name="paWhere" id="paAnywhere" value="" checked/> Anywhere in the city</label>
          <label><input type="radio" name="paWhere" id="paWithin" value="within"/> Within <select id="paMiles" aria-label="Distance"></select> of <input type="text" id="paAddr" maxlength="120" autocomplete="off" placeholder="an address, e.g. 8000 S Federal Way" aria-label="Address"/></label></div>
          <p class="pa-found hide" id="paFound" role="status"></p>
          <div class="pa-map hide" id="paFormMap"></div>
        </div>
        <div class="pw-grid" style="margin-top:12px">
          <label><span>Name <span class="opt">optional</span></span><input id="paName" maxlength="80" autocomplete="off" placeholder="Named from the filters if left blank"/></label>
        </div>
        <fieldset class="pw-set"><legend>How</legend><div class="pw-opts">
          <label class="chk"><input type="checkbox" id="paEmail" checked/> <span id="paEmailText">Email me its new permits each weekday morning</span></label></div>
          <p class="pw-fine" id="paFine">It is always listed here, and its permits are marked in the Filings list.</p></fieldset>
        <div class="pw-actions">
          <button type="submit" class="pw-btn pri" id="paSave">Save alert</button>
          <button type="button" class="pt-rm" id="paCancel">Cancel</button>
          <span class="pw-msg" id="paMsg" role="status"></span>
        </div>
      </form>
      <div id="paList"></div>
    </section>
  </div>
</main>
<script>
(function(){
  var BOOT = ${bootJson};
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  var items=[], CITY_LINE="these cities", WIN=30;
  var PROP_TYPES=["Industrial","Office","Retail","Multifamily","Mixed use","Other"];
  var KIND_NAMES={ti:"Tenant build-outs","new":"New buildings & additions",other:"Other work"};
  // ⚠ Home's map card names a stage with home-map.js PERMIT_STAGES, a copy
  // of this; test/home-map.test.js holds the two together.
  var STAGE_NAMES={open:"Open",attention:"Needs attention",approved:"Approved",issued:"Issued or finaled",ended:"Ended"};
  var LONG_DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  function wall(html){ var w=$("ptWall"); w.innerHTML=html; w.className="pt-wall"; $("ptApp").className="hide"; }
  function day(iso){
    if(!iso)return "";
    var m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(iso));
    if(!m)return String(iso);
    return new Date(Number(m[1]),Number(m[2])-1,Number(m[3])).toLocaleDateString("en-US",{month:"short",day:"numeric"});
  }
  function longDay(iso){
    var m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(iso||""));
    if(!m)return "No date on the permit";
    var d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
    return LONG_DAYS[d.getDay()]+", "+d.toLocaleDateString("en-US",{month:"long",day:"numeric"});
  }
  function ago(ts){
    var t=Date.parse(ts); if(isNaN(t))return "";
    var mins=Math.max(0,Math.round((Date.now()-t)/60000));
    if(mins<60)return mins<=1?"just now":mins+" minutes ago";
    var h=Math.round(mins/60); if(h<48)return h+(h===1?" hour ago":" hours ago");
    return Math.round(h/24)+" days ago";
  }
  // The portals and the map lookup print some addresses in capitals
  // ("8000 S FEDERAL WAY"). Shown in ordinary case; directions, the state and
  // anything with a digit in it (83716, 5TH) keep their own form.
  // ⚠ home-map.js tidyCaps is a copy, for Home's permit cards;
  // test/home-map.test.js runs both on the same inputs.
  function tidy(s){
    s=String(s==null?"":s);
    if(!s||/[a-z]/.test(s))return s;
    return s.replace(/[A-Z0-9][A-Z0-9'.&-]*/g,function(w){
      if(/^(N|S|E|W|NE|NW|SE|SW|ID|PO|US)$/.test(w))return w;
      if(/[0-9]/.test(w))return w.toLowerCase();
      return w.charAt(0)+w.slice(1).toLowerCase();
    });
  }
  function street(addr){ return tidy(String(addr||"").split(",")[0].trim()); }
  function stTag(status,stage){
    return status?'<span class="st '+esc(stage||"open")+'">'+esc(status)+"</span>":'<span class="st none">Not read yet</span>';
  }
  function words(list){ if(list.length<=1)return list[0]||""; return list.slice(0,-1).join(", ")+" and "+list[list.length-1]; }

  // ---- The tabs (2026-10-02, Draft C) --------------------------------------
  var TABS={filings:{tab:"tabFilings",panel:"ptFilings",hash:"filings"},mine:{tab:"tabMine",panel:"pwSec",hash:"your-permits"},alerts:{tab:"tabAlerts",panel:"paSec",hash:"alerts"}};
  var TAB_ORDER=["filings","mine","alerts"], current="filings";
  function showTab(name,remember){
    current=name;
    TAB_ORDER.forEach(function(k){
      var on=k===name;
      $(TABS[k].tab).setAttribute("aria-selected",String(on));
      $(TABS[k].tab).tabIndex=on?0:-1;
      $(TABS[k].panel).className=on?"pt-panel":"pt-panel hide";
    });
    if(remember){ try{ history.replaceState(null,"",location.pathname+location.search+"#"+TABS[name].hash); }catch(e){} }
    if(name==="mine")markSeen();
    // A map drawn into a hidden panel has no size: draw it again once shown.
    if(name==="alerts"&&AL){ if(alMapOpen)renderAlerts(); if(alFormOpen())alShowArea(); }
  }
  $("ptTabs").addEventListener("click",function(e){
    var b=e.target.closest?e.target.closest(".pt-tab"):null; if(!b)return;
    for(var k in TABS){ if(TABS[k].tab===b.id){ showTab(k,true); return; } }
  });
  $("ptTabs").addEventListener("keydown",function(e){
    if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft")return;
    var i=TAB_ORDER.indexOf(current), n=TAB_ORDER[(i+(e.key==="ArrowRight"?1:TAB_ORDER.length-1))%TAB_ORDER.length];
    showTab(n,true); $(TABS[n].tab).focus(); e.preventDefault();
  });
  function tabCounts(){
    $("tabFilingsN").textContent=String(items.length);
    var mt=!!(MINE&&(MINE.canTrack||watches.length));
    $("tabMineN").textContent=mt?String(watches.length):"";
    $("tabMinePro").className=MINE&&!mt?"pt-protag":"pt-protag hide";
    var un=MINE&&MINE.unread>0?MINE.unread:0;
    $("tabMineNew").textContent=un?un+" new":"";
    $("tabMineNew").className=un?"pt-badge":"pt-badge hide";
    var at=!!(AL&&(AL.canTrack||alerts.length));
    $("tabAlertsN").textContent=at?String(alerts.length):"";
    $("tabAlertsPro").className=AL&&!at?"pt-protag":"pt-protag hide";
  }
  // Seen: clears the count on the nav dot, once the Your permits tab is shown.
  // A fetch, so a prerendered copy of this page does not send it until the
  // page is actually shown (rule 15).
  var seenSent=false;
  function markSeen(){
    if(seenSent||!MINE||!(MINE.unread>0))return;
    seenSent=true;
    fetch("/api/permits/seen",{method:"POST",credentials:"same-origin"}).then(function(r){
      if(r.ok){ var d=$("navPermitDot"); if(d)d.hidden=true; }
    }).catch(function(){});
  }

  // ---- Filings --------------------------------------------------------------
  // Each filter group's values and counts are for the whole window; ticking
  // several in one group shows any of them, and the groups narrow each other.
  var GROUPS=[
    {g:"city",label:"City",val:function(f){return f.city||"Other"}},
    {g:"prop",label:"Property type",val:function(f){return f.propertyType},order:PROP_TYPES,zeros:true},
    {g:"kind",label:"Work",val:function(f){return f.kind==="ti"||f.kind==="new"?f.kind:"other"},names:KIND_NAMES,order:["ti","new","other"]},
    {g:"stage",label:"Status",val:function(f){return f.stage||"open"},names:STAGE_NAMES,order:["open","attention","approved","issued","ended"]},
    {g:"type",label:"Permit type",val:function(f){return f.type||"Other"}}
  ];
  var SEL={}, BOARD=false, ALERT=null;
  GROUPS.forEach(function(G){ SEL[G.g]={}; });
  function picked(g){ return Object.keys(SEL[g]).filter(function(k){return SEL[g][k]}); }
  function filtering(){
    if(BOARD||ALERT||$("ptSearch").value.trim())return true;
    return GROUPS.some(function(G){return picked(G.g).length>0});
  }
  function facetGroup(g,label,rows){
    return '<div class="pt-fg" data-g="'+g+'"><button type="button" class="pt-fgh" aria-expanded="false">'+esc(label)+'<span class="c"></span></button><div class="pt-fgl">'+rows+"</div></div>";
  }
  function facetRow(g,value,text,n){
    return "<label"+(n?"":' class="zero"')+'><input type="checkbox" data-g="'+g+'" value="'+esc(value)+'"/> <span class="t">'+esc(text)+'</span><span class="n">'+n+"</span></label>";
  }
  function buildFacets(j){
    var html=GROUPS.map(function(G){
      var counts={};
      items.forEach(function(f){ var v=G.val(f); counts[v]=(counts[v]||0)+1; });
      // Every property type is offered with its count, a zero included, so an
      // empty type is visible before it is picked.
      var keys=G.order?G.order.filter(function(k){return G.zeros||counts[k]})
        :Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]||a.localeCompare(b)});
      if(!keys.length)return "";
      return facetGroup(G.g,G.label,keys.map(function(k){ return facetRow(G.g,k,G.names?G.names[k]:k,counts[k]||0); }).join(""));
    }).join("");
    if(j.inFirm){
      var nb=items.filter(function(f){return f.onBoard}).length;
      html+=facetGroup("board","Yours",facetRow("board","1","On your firm’s buildings",nb));
    }
    $("ptFac").innerHTML=html;
  }
  function facetMarks(){
    [].forEach.call($("ptFac").querySelectorAll(".pt-fg"),function(el){
      var g=el.getAttribute("data-g"), n=g==="board"?(BOARD?1:0):picked(g).length;
      el.querySelector(".pt-fgh .c").textContent=n?String(n):"";
    });
  }
  function clearFilters(){
    GROUPS.forEach(function(G){ SEL[G.g]={}; });
    BOARD=false; ALERT=null; $("ptSearch").value="";
    [].forEach.call($("ptFac").querySelectorAll("input[type=checkbox]"),function(i){ i.checked=false; });
    facetMarks();
  }
  $("ptFac").addEventListener("change",function(e){
    var i=e.target; if(!i||!i.getAttribute||!i.getAttribute("data-g"))return;
    var g=i.getAttribute("data-g");
    if(g==="board")BOARD=i.checked; else SEL[g][i.value]=i.checked;
    facetMarks(); render();
  });
  $("ptFac").addEventListener("click",function(e){
    var h=e.target.closest?e.target.closest(".pt-fgh"):null; if(!h)return;
    var fg=h.parentNode, open=fg.className.indexOf(" open")<0;
    fg.className=open?"pt-fg open":"pt-fg";
    h.setAttribute("aria-expanded",String(open));
  });
  function apply(o){
    if(!o||o.s===503){ wall("<p>Couldn’t load the permit tracker just now. Refresh in a moment.</p>"); return; }
    if(o.s===401){ wall('<p>Sign in to see the permit tracker.</p><p><a href="/?auth=signin">Sign in</a></p>'); return; }
    if(o.s!==200||!o.j){ wall("<p>Couldn’t load the permit tracker just now. Refresh in a moment.</p>"); return; }
    var j=o.j;
    items=Array.isArray(j.filings)?j.filings:[];
    CITY_LINE=j.cities||"these cities"; WIN=j.windowDays||30;
    items.forEach(function(f){ if(PROP_TYPES.indexOf(f.propertyType)<0)f.propertyType="Other"; });
    var sub="Commercial building permits filed in "+(j.cities||"no city")+" in the last "+WIN+" days, read from each city’s portal on weekday mornings.";
    if(j.never)sub+=" The sweep has not run yet.";
    else if(j.stale)sub+=" Last checked "+ago(j.lastSweptAt)+", more than a business day ago, so newer filings may be missing.";
    else sub+=" Checked "+ago(j.lastSweptAt)+".";
    // A city read from its published reports (Nampa) is a month behind, so
    // its window is the last days its reports cover, and the page says so.
    (j.reportCities||[]).forEach(function(c){ sub+=" "+c.city+"’s permits come from the city’s published reports, which run about a month behind, so its "+WIN+" days end "+day(c.through)+"."; });
    $("ptSub").textContent=sub;
    $("ptSub").className="pt-sub"+(j.stale&&!j.never?" stale":"");
    $("ptApp").className="";
    buildFacets(j);
    $("ptEmpty").textContent="No commercial permit filed in "+CITY_LINE+" in the last "+WIN+" days"+(j.never?". The sweep has not run yet.":".");
    $("ptEmpty").className=items.length?"pt-note hide":"pt-note";
    $("ptTrunc").textContent=j.truncated?"Showing the "+items.length+" most recent filings; older ones in the window are not listed.":"";
    $("ptTrunc").className=j.truncated?"pt-note":"pt-note hide";
    render();
  }
  function row(f){
    var addr=f.address?street(f.address):"(no address on the permit)";
    var work=f.description||f.projectName||f.type||"";
    var bits=[work,f.propertyType,f.applicant,f.contractor&&f.contractor!==f.applicant?f.contractor:""].filter(Boolean);
    var num=f.sourceUrl?'<a class="pt-num" href="'+esc(f.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(f.permitNumber)+"</a>":'<span class="pt-num">'+esc(f.permitNumber)+"</span>";
    return '<div class="pt-row"><div class="pt-main"><div class="pt-addr"><span class="a">'+esc(addr)+'</span><span class="c">'+esc(f.city)+"</span>"+
      (f.onBoard?'<a class="pt-board" href="/building/'+esc(encodeURIComponent(f.onBoard.id))+'">Your firm’s building →</a>':"")+alertTag(f)+"</div>"+
      // Boise's descriptions run to whole paragraphs: one line here, the
      // full text on hover.
      '<div class="pt-l2"'+(f.description?' title="'+esc(f.description)+'"':"")+">"+esc(bits.join(" · "))+"</div></div>"+
      '<div class="pt-right">'+stTag(f.status,f.stage)+num+"</div></div>";
  }
  function render(){
    var q=$("ptSearch").value.toLowerCase().split(/\\s+/).filter(Boolean);
    var list=items.filter(function(f){
      for(var i=0;i<GROUPS.length;i++){ var G=GROUPS[i]; if(picked(G.g).length&&!SEL[G.g][G.val(f)])return false; }
      if(BOARD&&!f.onBoard)return false;
      if(ALERT&&!alertMatches(ALERT,f))return false;
      if(!q.length)return true;
      var hay=[f.address,f.applicant,f.contractor,f.description,f.projectName,f.permitNumber,f.type,f.status,f.zoning].join(" ").toLowerCase();
      return q.every(function(t){return hay.indexOf(t)>-1});
    });
    var filtered=filtering();
    $("ptShown").innerHTML=filtered?"<b>"+list.length+"</b> of "+items.length+" permits":"<b>"+items.length+"</b> "+(items.length===1?"permit":"permits")+", newest first";
    $("ptClearAll").className=filtered?"pt-rm":"pt-rm hide";
    $("ptChips").innerHTML=ALERT?'<span class="pt-chip">Fits your alert “'+esc(alName(ALERT))+'” <button type="button" id="ptAlertOff" aria-label="Show every permit">×</button></span>':"";
    $("ptChips").className=ALERT?"pt-chips":"pt-chips hide";
    // One property type picked and nothing else: say it in words.
    var props=picked("prop");
    var onlyProp=props.length===1&&!q.length&&!BOARD&&!ALERT&&GROUPS.every(function(G){return G.g==="prop"||!picked(G.g).length});
    var typeEmpty=!!(onlyProp&&!list.length&&items.length);
    $("ptTypeNoneText").textContent=typeEmpty?"No "+(props[0]==="Other"?"other":props[0].toLowerCase())+" permit filed in "+CITY_LINE+" in the last "+WIN+" days.":"";
    $("ptTypeNone").className=typeEmpty?"pt-empty2":"pt-empty2 hide";
    $("ptNone").className=(items.length&&!list.length&&!typeEmpty)?"pt-note":"pt-note hide";
    // The list by the day each permit was filed, newest first.
    var html="", last=null, group=[];
    function flush(){ if(group.length)html+='<section class="pt-day"><h3>'+esc(longDay(last))+"<span>"+group.length+"</span></h3>"+group.join("")+"</section>"; group=[]; }
    list.forEach(function(f){ if(f.appliedDate!==last){ flush(); last=f.appliedDate; } group.push(row(f)); });
    flush();
    $("ptRows").innerHTML=html;
  }

  // ---- Your permits (2026-09-27) ------------------------------------------
  var MINE=null, watches=[], OPEN={}, EDITING={};
  function stepName(k){ var l=(MINE&&MINE.steps)||[]; for(var i=0;i<l.length;i++){ if(l[i].key===k)return l[i].label; } return k; }
  function notifyText(n){
    var what=(n.steps||[]).map(stepName);
    if(n.alerts)what.push("problems");
    if(n.any)what.push("every other change");
    var how=[n.email?"by email":"",n.app?"on CompNinja":""].filter(Boolean);
    if(!what.length||!how.length)return "Notifications off";
    return "Tells you about "+words(what)+", "+how.join(" and ");
  }
  // One builder for the add form and each permit's Change form, so the two
  // cannot offer different choices.
  function notifyFields(n){
    var steps=(MINE.notifySteps||[]).map(function(k){
      return '<label class="chk"><input type="checkbox" data-step="'+esc(k)+'"'+((n.steps||[]).indexOf(k)>-1?" checked":"")+"/> "+esc(stepName(k))+"</label>";
    }).join("");
    var mailOff=MINE.emailLive?"":'<p class="pw-fine">Email isn’t switched on for CompNinja yet, so for now updates show here on the Permit tracker.</p>';
    return '<fieldset class="pw-set"><legend>Tell me when it reaches</legend><div class="pw-opts">'+steps+"</div>"+
      '<div class="pw-opts" style="margin-top:6px"><label class="chk"><input type="checkbox" data-opt="alerts"'+(n.alerts?" checked":"")+"/> It needs attention or ends (returned for corrections, on hold, denied, expired)</label>"+
      '<label class="chk"><input type="checkbox" data-opt="any"'+(n.any?" checked":"")+"/> Any other status change</label></div></fieldset>"+
      '<fieldset class="pw-set"><legend>How</legend><div class="pw-opts">'+
      '<label class="chk"><input type="checkbox" data-opt="email"'+(n.email?" checked":"")+"/> Email"+(MINE.email?" ("+esc(MINE.email)+")":"")+"</label>"+
      '<label class="chk"><input type="checkbox" data-opt="app"'+(n.app?" checked":"")+"/> On CompNinja</label></div>"+mailOff+"</fieldset>";
  }
  function readNotify(root){
    var n={steps:[]};
    [].forEach.call(root.querySelectorAll("input[data-step]"),function(i){ if(i.checked)n.steps.push(i.getAttribute("data-step")); });
    [].forEach.call(root.querySelectorAll("input[data-opt]"),function(i){ n[i.getAttribute("data-opt")]=!!i.checked; });
    return n;
  }
  function watchName(w){ return w.label||street(w.address)||w.permitNumber; }
  // The Manage box's controls depend on whose permit it is (2026-09-29, 055):
  // your own gets Change, the firm switch (owners) and Stop tracking, and
  // without Pro only Stop tracking, so a lapse never takes away the way out.
  // A permit a colleague tracks for the firm gets Mute beside its status.
  function manageActions(w){
    if(!w.mine)return "";
    var b=function(attr,text){ return '<button type="button" class="pt-rm" '+attr+'="'+esc(w.id)+'">'+esc(text)+"</button>"; };
    var out="";
    if(MINE.canTrack)out+=b("data-edit","Change notifications");
    if(MINE.canTrack&&w.firmId)out+=b("data-firmoff","Just me");
    else if(MINE.canTrack&&MINE.firm)out+=b("data-firmon","Track for "+MINE.firm.name);
    return out+b("data-rm","Stop tracking");
  }
  function timeline(w){
    return '<ol class="pw-tl" aria-label="Permit steps">'+w.steps.map(function(s){
      return '<li class="'+(s.done?"done":"")+(s.key===w.step?" now":"")+'"><b>'+esc(s.label)+"</b>"+
        (s.at?'<time datetime="'+esc(s.at)+'" title="Seen on the portal '+esc(day(s.at))+'">'+esc(day(s.at))+"</time>":"")+"</li>";
    }).join("")+"</ol>";
  }
  function card(w){
    var num=w.sourceUrl?'<a href="'+esc(w.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(w.permitNumber)+"</a>":esc(w.permitNumber);
    var meta=[w.label&&w.address?esc(street(w.address))+", "+esc(w.city):esc(w.city),num];
    if(w.firm)meta.push(w.mine?"for "+esc(w.firm):"tracked by "+esc(w.sharedBy||"a colleague")+" for "+esc(w.firm)+(w.muted?" · muted":""));
    var latest=w.history.filter(function(h){return h.notice})[0], news="";
    if(w.checkError)news='<p class="pw-latest err">'+esc(w.checkError)+"</p>";
    else if(latest&&latest.unread){
      var warn=latest.kind==="attention"||latest.kind==="ended";
      news='<p class="pw-latest'+(warn?" warn":"")+'"><b>'+esc(latest.notice)+"</b> on "+esc(day(latest.at))+"."+(latest.from?" The portal said “"+esc(latest.from)+"” before.":"")+"</p>";
    }
    var right=stTag(w.status,w.stage)+
      (w.mine?'<button type="button" class="pt-rm" data-manage="'+esc(w.id)+'" aria-expanded="'+(OPEN[w.id]?"true":"false")+'">Manage</button>'
        :'<button type="button" class="pt-rm" data-mute="'+esc(w.id)+'">'+(w.muted?"Unmute":"Mute")+"</button>"+
          (w.history.length?'<button type="button" class="pt-rm" data-manage="'+esc(w.id)+'" aria-expanded="'+(OPEN[w.id]?"true":"false")+'">History</button>':""));
    var checked=w.checkError?'<span class="err">Not read yet</span>':(w.lastCheckedAt?"Checked "+esc(ago(w.lastCheckedAt)):"Not checked yet");
    var hist=w.history.length?'<div class="pw-hist"><b>Status history</b><ul>'+w.history.map(function(h){
      return '<li class="'+(h.unread?"unread":"")+'">'+esc(day(h.at))+": "+(h.from?"“"+esc(h.from)+"” → ":"First read: ")+"“"+esc(h.to)+"”"+(h.notice?" — "+esc(h.notice):"")+"</li>";
    }).join("")+"</ul></div>":"";
    var acts=manageActions(w);
    var edit=w.mine&&MINE.canTrack?'<form class="pw-form'+(EDITING[w.id]?"":" hide")+'" data-editform="'+esc(w.id)+'">'+
      '<div class="pw-grid"><label><span>Nickname <span class="opt">optional</span></span><input data-label maxlength="80" value="'+esc(w.label)+'"/></label></div>'+
      notifyFields(w.notify)+
      '<div class="pw-actions"><button type="submit" class="pw-btn pri">Save</button> <button type="button" class="pt-rm" data-cancel="'+esc(w.id)+'">Cancel</button> <span class="pw-msg" role="status"></span></div></form>':"";
    var box='<div class="pw-box'+(OPEN[w.id]?"":" hide")+'">'+
      '<p class="pw-foot">'+checked+" · "+esc(w.mine||!w.muted?notifyText(w.notify):"Muted: nothing from this permit reaches you")+"</p>"+
      (acts?'<div class="pw-acts">'+acts+"</div>":"")+edit+hist+"</div>";
    // id="pw-<id>" is a deep link to one permit (/permits#pw-<id>). The
    // Workspace linked here from 2026-09-29 until tracked permits came off
    // it on 2026-09-30; a saved link still lands, on this tab.
    return '<article class="pw-card" id="pw-'+esc(w.id)+'" data-id="'+esc(w.id)+'">'+
      '<div class="pw-top"><div class="pw-id"><h3 class="pw-name">'+esc(watchName(w))+'</h3><p class="pw-meta">'+meta.join(" · ")+"</p></div>"+
      '<div class="pw-right">'+right+"</div></div>"+timeline(w)+news+box+"</article>";
  }
  function ownCount(){ return watches.filter(function(w){return w.mine}).length; }
  function renderMine(){
    var list=$("pwList");
    var roomy=MINE.canTrack&&ownCount()<(MINE.max||25);
    var formOpen=$("pwForm").className.indexOf("hide")<0||$("pwBulk").className.indexOf("hide")<0;
    $("pwAddBtn").className=roomy&&!formOpen?"pw-btn pri":"pw-btn pri hide";
    $("pwBulkBtn").className=roomy&&!formOpen?"pw-btn":"pw-btn hide";
    $("pwPro").className=MINE.canTrack?"pw-pro hide":"pw-pro";
    var cities=(MINE.cities||[]).map(function(c){return c.label});
    var n=watches.length;
    $("pwSub").textContent=!MINE.canTrack
      ? (n?"The permits you track are kept here. You can stop tracking any of them.":"")
      : n
      ? n+(n===1?" permit, read from its city’s portal every weekday morning.":" permits, read from each city’s portal every weekday morning.")
      : "Track a permit you filed in "+words(cities)+". We read it from the city’s portal every weekday morning and tell you, by email, here, or both, when it reaches the steps you pick.";
    $("pwSub").className=$("pwSub").textContent?"pw-sub":"pw-sub hide";
    list.innerHTML=n?watches.map(card).join(""):"";
    if(AL)tabCounts();
  }
  function formMsg(el,text,kind){ el.textContent=text||""; el.className="pw-msg"+(kind?" "+kind:""); }
  function openAdd(){
    closeBulk();
    $("pwForm").className="pw-form";
    $("pwAddBtn").className="pw-btn pri hide"; $("pwBulkBtn").className="pw-btn hide";
    $("pwNum").focus();
  }
  function closeAdd(){
    $("pwForm").className="pw-form hide";
    formMsg($("pwMsg"),"");
    renderMine();
  }
  function applyMine(o){
    if(!o){ return; }
    if(o.s!==200||!o.j){
      $("pwSub").textContent="Your tracked permits couldn’t be loaded just now. Refresh in a moment.";
      $("pwSub").className="pw-sub";
      return;
    }
    MINE=o.j;
    watches=Array.isArray(MINE.watches)?MINE.watches:[];
    var cities=(MINE.cities||[]).map(function(c){return c.label});
    (MINE.cities||[]).forEach(function(c){ var op=document.createElement("option"); op.value=c.key; op.textContent=c.label; $("pwCity").appendChild(op); });
    (MINE.cities||[]).forEach(function(c){ var op=document.createElement("option"); op.value=c.key; op.textContent=c.label; $("pwBulkCity").appendChild(op); });
    if(cities.length)$("pwProText").textContent="Tracking a permit is part of CompNinja Pro. Add a permit number from "+words(cities).replace(/ and /," or ")+" and we read it from the city’s portal every weekday morning, then tell you, by email and here, when it reaches the steps you pick.";
    $("pwFormNotify").innerHTML=notifyFields(MINE.defaults||{});
    $("pwBulkNotify").innerHTML=notifyFields(MINE.defaults||{});
    if(MINE.firm){ $("pwFirmSet").className="pw-set"; $("pwFirmText").textContent="Everyone at "+MINE.firm.name;
      $("pwBulkFirmSet").className="pw-set"; $("pwBulkFirmText").textContent="Everyone at "+MINE.firm.name; }
    // Nampa is read from its published reports, which cannot look up one
    // permit: the form says so where the city is picked.
    var late=((BOOT&&BOOT.j&&BOOT.j.reportCities)||[]).map(function(c){return c.city});
    if(late.length){ $("pwLate").textContent=words(late)+" permits can’t be tracked by number yet: we read "+(late.length===1?"that city":"those cities")+" from published reports, which can’t look up one permit."; $("pwLate").className="pw-fine"; }
    renderMine();
  }
  $("pwAddBtn").addEventListener("click",openAdd);
  // ---- Adding several at once (2026-09-30) ---------------------------------
  // Two passes over one list, the bulk valuation's rule that the count is
  // said before the button: "Check the list" asks the server which rows are
  // permits (no portal is asked), then "Track N permits" adds them, each
  // looked up on its city's portal. Editing the list or the city sends it
  // back to the first pass, so what is added is always what was shown.
  var bulkChecked=null;
  function openBulk(){
    $("pwForm").className="pw-form hide"; formMsg($("pwMsg"),"");
    $("pwBulk").className="pw-form pw-bulk";
    $("pwAddBtn").className="pw-btn pri hide"; $("pwBulkBtn").className="pw-btn hide";
    $("pwBulkDone").className="pw-done hide";
    $("pwBulkText").focus();
  }
  function bulkReset(){
    bulkChecked=null;
    $("pwBulkGo").textContent="Check the list"; $("pwBulkGo").disabled=false;
    $("pwBulkReview").className="pw-review hide"; $("pwBulkReview").innerHTML="";
  }
  function closeBulk(){
    $("pwBulk").className="pw-form pw-bulk hide";
    $("pwBulkText").value=""; $("pwBulkFile").value=""; $("pwBulkFirm").checked=false;
    formMsg($("pwBulkMsg"),""); bulkReset();
  }
  function lineList(list,fn){ return "<ul>"+list.map(fn).join("")+"</ul>"; }
  function skippedHtml(sk){
    if(!sk||!sk.length)return "";
    return "<b>Left out ("+sk.length+")</b>"+lineList(sk,function(x){
      return "<li>Row "+esc(x.line)+": "+esc(x.text)+' <span class="why">— '+esc(x.reason)+"</span></li>";
    });
  }
  function showReview(j){
    var p=j.permits||[];
    var html=p.length?"<b>Ready to track ("+p.length+")</b>"+lineList(p,function(x){
      return "<li>"+esc(x.permit_number)+' <span class="why">· '+esc(x.city)+(x.label?" · "+esc(x.label):"")+"</span></li>";
    }):"<b>Nothing in this list can be added.</b>";
    $("pwBulkReview").innerHTML=html+skippedHtml(j.skipped);
    $("pwBulkReview").className="pw-review";
    bulkChecked=p.length?j:null;
    $("pwBulkGo").textContent=p.length?"Track "+p.length+(p.length===1?" permit":" permits"):"Check the list";
  }
  function bulkPost(payload){
    return fetch("/api/permits/watch/bulk",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {s:r.status,j:j}})});
  }
  function bulkPreview(payload){
    var msg=$("pwBulkMsg");
    $("pwBulkGo").disabled=true; formMsg(msg,"Reading the list…");
    payload.preview=true; payload.jurisdiction=$("pwBulkCity").value;
    return bulkPost(payload).then(function(o){
      $("pwBulkGo").disabled=false;
      if(o.s!==200||!o.j.preview){ formMsg(msg,(o.j&&o.j.error)||"Couldn’t read that list. Please try again.","bad"); return; }
      if(payload.xlsx&&typeof o.j.text==="string")$("pwBulkText").value=o.j.text;
      formMsg(msg,"");
      showReview(o.j);
    }).catch(function(){ $("pwBulkGo").disabled=false; formMsg(msg,"That didn’t reach the server. Nothing was added.","bad"); });
  }
  function bulkDone(j){
    var added=j.watches||[], nf=j.notFound||[];
    added.slice().reverse().forEach(function(w){ watches.unshift(w); });
    closeBulk(); renderMine();
    var html="<b>Tracking "+added.length+(added.length===1?" permit":" permits")+".</b>";
    if(j.unchecked)html+=" "+j.unchecked+(j.unchecked===1?" wasn’t":" weren’t")+" read from the portal just now; we’ll read "+(j.unchecked===1?"it":"them")+" on the next weekday sweep.";
    if(nf.length)html+="<br>Not added: the city’s portal has no permit with "+(nf.length===1?"this number":"these numbers")+". Check the letters at the start."+
      lineList(nf,function(x){return "<li>"+esc(x.permitNumber)+' <span class="why">· '+esc(x.city)+"</span></li>";});
    $("pwBulkDone").innerHTML=html;
    $("pwBulkDone").className="pw-done"+(nf.length?" warn":"");
  }
  $("pwBulkBtn").addEventListener("click",openBulk);
  $("pwBulkCancel").addEventListener("click",function(){ closeBulk(); renderMine(); });
  $("pwBulkText").addEventListener("input",bulkReset);
  $("pwBulkCity").addEventListener("change",bulkReset);
  $("pwBulkFile").addEventListener("change",function(){
    var file=this.files&&this.files[0]; if(!file)return;
    bulkReset();
    var msg=$("pwBulkMsg");
    if(file.size>1024*1024){ formMsg(msg,"That file is larger than 1 MB. Save just the permit numbers as CSV.","bad"); return; }
    var rd=new FileReader();
    rd.onerror=function(){ formMsg(msg,"That file couldn’t be read.","bad"); };
    if(file.name.toLowerCase().slice(-5)===".xlsx"){
      rd.onload=function(){ bulkPreview({xlsx:String(rd.result||"")}); };
      rd.readAsDataURL(file);
    }else{
      rd.onload=function(){ $("pwBulkText").value=String(rd.result||""); bulkPreview({text:$("pwBulkText").value}); };
      rd.readAsText(file);
    }
  });
  $("pwBulk").addEventListener("submit",function(e){
    e.preventDefault();
    var msg=$("pwBulkMsg"), text=$("pwBulkText").value;
    if(!text.trim()){ formMsg(msg,"Paste some permit numbers, or choose a file.","bad"); $("pwBulkText").focus(); return; }
    if(!bulkChecked){ bulkPreview({text:text}); return; }
    var n=bulkChecked.permits.length;
    $("pwBulkGo").disabled=true;
    formMsg(msg,"Looking up "+n+(n===1?" permit":" permits")+" on the city portals, one at a time. This can take a minute.");
    bulkPost({text:text,jurisdiction:$("pwBulkCity").value,notify:readNotify($("pwBulk")),firm:!!(MINE.firm&&$("pwBulkFirm").checked)})
      .then(function(o){
        $("pwBulkGo").disabled=false;
        if(o.s!==200||!o.j.watches){ formMsg(msg,(o.j&&o.j.error)||"Couldn’t add those permits. Refresh to see what was added.","bad"); if(o.j&&o.j.permits)showReview(o.j); return; }
        bulkDone(o.j);
      })
      .catch(function(){ $("pwBulkGo").disabled=false; formMsg(msg,"That didn’t reach the server. Refresh to see what was added.","bad"); });
  });
  $("pwCancel").addEventListener("click",closeAdd);
  $("pwForm").addEventListener("submit",function(e){
    e.preventDefault();
    var btn=$("pwSave"), msg=$("pwMsg");
    var city=$("pwCity").value, cityLabel=$("pwCity").options[$("pwCity").selectedIndex]?$("pwCity").options[$("pwCity").selectedIndex].textContent:"the city";
    var num=$("pwNum").value.trim();
    if(!num){ formMsg(msg,"Enter the permit number exactly as the city prints it.","bad"); $("pwNum").focus(); return; }
    btn.disabled=true;
    formMsg(msg,"Looking it up on the "+cityLabel+" permit portal…");
    fetch("/api/permits/watch",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
      body:JSON.stringify({jurisdiction:city,permitNumber:num,label:$("pwLabel").value,notify:readNotify($("pwForm"))})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {s:r.status,j:j}})})
      .then(function(o){
        btn.disabled=false;
        if(o.s!==200||!o.j.watch){ formMsg(msg,(o.j&&o.j.error)||"Couldn’t add that permit. Please try again.","bad"); return; }
        var w=o.j.watch;
        watches.unshift(w);
        if(MINE.firm&&$("pwFirm").checked){ setFirm(w.id,true); }
        $("pwFirm").checked=false;
        $("pwNum").value=""; $("pwLabel").value="";
        $("pwFormNotify").innerHTML=notifyFields(MINE.defaults||{});
        $("pwForm").className="pw-form hide";
        renderMine();
        var top=$("pwList").firstChild;
        var note=document.createElement("p"); note.className="pw-msg ok";
        note.textContent=o.j.checked
          ? "Tracking "+w.permitNumber+". The portal reads “"+w.status+"” today."
          : "Added "+w.permitNumber+". The "+cityLabel+" portal didn’t answer just now, so we’ll read it on the next weekday sweep.";
        if(top)top.appendChild(note);
      })
      .catch(function(){ btn.disabled=false; formMsg(msg,"That didn’t reach the server. Nothing was added.","bad"); });
  });
  function watchIndex(id){ for(var i=0;i<watches.length;i++){ if(String(watches[i].id)===String(id))return i; } return -1; }
  function keepMarks(id,fresh){
    var i=watchIndex(id);
    if(i>-1){ fresh.unread=watches[i].unread; fresh.history=watches[i].history; watches[i]=fresh; }
  }
  function setFirm(id,on){
    return fetch("/api/permits/watch?id="+encodeURIComponent(id),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({firm:on})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200||!o.j.watch){ alert((o.j&&o.j.error)||"Couldn’t change that just now. Please try again."); return; }
        keepMarks(id,o.j.watch); renderMine();
      })
      .catch(function(){ alert("That didn’t reach the server. Nothing was changed."); });
  }
  $("pwList").addEventListener("click",function(e){
    var t=e.target&&e.target.closest?e.target.closest("button"):null;
    if(!t)return;
    var mg=t.getAttribute("data-manage"), ed=t.getAttribute("data-edit"), rm=t.getAttribute("data-rm"), cn=t.getAttribute("data-cancel");
    var fon=t.getAttribute("data-firmon"), foff=t.getAttribute("data-firmoff"), mu=t.getAttribute("data-mute");
    if(mg){ OPEN[mg]=!OPEN[mg]; if(!OPEN[mg])EDITING[mg]=false; renderMine(); return; }
    if(ed){ EDITING[ed]=!EDITING[ed]; renderMine(); return; }
    if(cn){ EDITING[cn]=false; renderMine(); return; }
    if(fon){
      if(!confirm("Track this permit for everyone at "+MINE.firm.name+"? Everyone there on Pro gets its notices the way you set them, and each can mute it."))return;
      setFirm(fon,true); return;
    }
    if(foff){ setFirm(foff,false); return; }
    if(mu){
      var mi=watchIndex(mu); if(mi<0)return;
      var want=!watches[mi].muted;
      fetch("/api/permits/mute",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({id:mu,muted:want})})
        .then(function(r){ if(!r.ok)throw new Error("x"); var k=watchIndex(mu); if(k>-1){ watches[k].muted=want; if(want)watches[k].unread=0; } renderMine(); })
        .catch(function(){ alert("Couldn’t change that just now. Please try again."); });
      return;
    }
    if(rm){
      var i=watchIndex(rm); if(i<0)return;
      if(!confirm("Stop tracking "+watches[i].permitNumber+"? Its status history goes with it."))return;
      fetch("/api/permits/watch?id="+encodeURIComponent(rm),{method:"DELETE",credentials:"same-origin"})
        .then(function(r){
          if(!r.ok)throw new Error("x");
          var k=watchIndex(rm); if(k>-1)watches.splice(k,1);
          renderMine();
        })
        .catch(function(){ alert("Couldn’t stop tracking that permit just now. Please try again."); });
    }
  });
  $("pwList").addEventListener("submit",function(e){
    var f=e.target;
    if(!f||!f.getAttribute||!f.getAttribute("data-editform"))return;
    e.preventDefault();
    var id=f.getAttribute("data-editform"), msg=f.querySelector(".pw-msg");
    var lab=f.querySelector("input[data-label]");
    formMsg(msg,"Saving…");
    fetch("/api/permits/watch?id="+encodeURIComponent(id),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},
      body:JSON.stringify({label:lab?lab.value:"",notify:readNotify(f)})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200||!o.j.watch){ formMsg(msg,(o.j&&o.j.error)||"Couldn’t save that. Please try again.","bad"); return; }
        // Keep this page view's "new" marks: the server's copy was read after
        // the page cleared them.
        keepMarks(id,o.j.watch);
        EDITING[id]=false;
        renderMine();
      })
      .catch(function(){ formMsg(msg,"That didn’t reach the server. Nothing was changed.","bad"); });
  });

  // ---- Your alerts (2026-10-01) -------------------------------------------
  var AL=null, alerts=[], alEditing=null, alMapOpen=null, alArea=null, alGeoTimer=null, alMaps={};
  function alUnplaced(){ return items.filter(function(f){return f.lat==null||f.lng==null}).length; }
  // ---- Maps (2026-10-01, areas) --------------------------------------------
  // Leaflet loads once, when the first map opens; with the CDN blocked the
  // form still works and the map simply stays closed.
  function withLeaflet(cb){
    if(window.L)return cb();
    if(!document.getElementById("paLeafCss")){
      var l=document.createElement("link"); l.id="paLeafCss"; l.rel="stylesheet"; l.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(l);
    }
    var sc=document.createElement("script"); sc.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    sc.onload=function(){ if(window.L)cb(); }; document.head.appendChild(sc);
  }
  function cssVar(n,fb){ var v=getComputedStyle(document.documentElement).getPropertyValue(n); return (v&&v.trim())||fb; }
  function drawAreaMap(id,area){
    var el=$(id); if(!el||!area)return;
    withLeaflet(function(){
      if(alMaps[id]){ alMaps[id].remove(); delete alMaps[id]; }
      var map=L.map(el,{scrollWheelZoom:false}); alMaps[id]=map;
      // Framed from the point and the distance FIRST: a circle cannot measure
      // itself on a map that has no view yet.
      map.fitBounds(L.latLng(area.lat,area.lng).toBounds(area.miles*1609.34*2),{padding:[24,24]});
      if(window.CNBASE)CNBASE.add(map);
      var red=cssVar("--red-fill","#B91C1C"), grey=cssVar("--ink-3","#68707E"), card=cssVar("--card","#fff");
      L.circle([area.lat,area.lng],{radius:area.miles*1609.34,color:red,weight:2,fillColor:red,fillOpacity:0.06}).addTo(map);
      // Several permits at one address (a campus) are one dot with a count.
      var spots={};
      items.forEach(function(f){ if(f.lat==null||f.lng==null)return; var k=f.lat.toFixed(5)+","+f.lng.toFixed(5); (spots[k]=spots[k]||{lat:f.lat,lng:f.lng,n:0}).n++; });
      Object.keys(spots).forEach(function(k){
        var sp=spots[k], inside=alMiles(area.lat,area.lng,sp.lat,sp.lng)<=area.miles;
        var mk=L.circleMarker([sp.lat,sp.lng],{radius:sp.n>1?6+Math.min(6,sp.n):(inside?5:3.5),color:card,weight:1.5,fillColor:inside?red:grey,fillOpacity:inside?0.95:0.55}).addTo(map);
        if(sp.n>1)mk.bindTooltip(String(sp.n),{permanent:true,direction:"center",className:"pa-count"});
      });
    });
  }
  function alWithin(){ return $("paWithin").checked; }
  function alAreaNow(){ return alWithin()&&alArea&&alArea.lat!=null?{lat:alArea.lat,lng:alArea.lng,miles:Number($("paMiles").value)}:null; }
  function alShowArea(){
    var within=alWithin();
    $("paMiles").disabled=!within; $("paAddr").disabled=!within;
    var area=alAreaNow();
    $("paFormMap").className=area?"pa-map":"pa-map hide";
    if(area)drawAreaMap("paFormMap",area);
    alPreview();
  }
  // The address, checked as it is typed: the site's own geocoder, with the
  // alert's city added to a bare street line (the route does the same).
  function alLookup(){
    var text=$("paAddr").value.trim();
    alArea=null;
    if(!alWithin()||!text){ $("paFound").className="pa-found hide"; alShowArea(); return; }
    var city=$("paCity").options[$("paCity").selectedIndex];
    var line=text.indexOf(",")>-1?text:text+", "+(city&&city.value?city.textContent+", ID":"ID");
    $("paFound").className="pa-found"; $("paFound").textContent="Looking for it on the map…";
    fetch("/api/geocode",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({address:line})})
      .then(asJson).then(function(o){
        if($("paAddr").value.trim()!==text)return;
        if(o.s===200&&o.j&&o.j.lat!=null){
          alArea={lat:o.j.lat,lng:o.j.lng,matched:o.j.matchedAddress||line};
          $("paFound").className="pa-found ok"; $("paFound").textContent="✓ Found on the map: "+tidy(alArea.matched);
        }else{
          $("paFound").className="pa-found bad"; $("paFound").textContent="We couldn’t find that address on the map. Try the full street address, with the city.";
        }
        alShowArea();
      }).catch(function(){ $("paFound").className="pa-found bad"; $("paFound").textContent="Couldn’t check that address just now."; });
  }
  // ⚠ PAIR with permit-alerts.js's matches(): one rule in two places, since
  // the browser cannot require the module. test/permit-alerts.test.js runs the
  // two over the same permits; change both or neither.
  function alertMatches(a,p){
    if(!a||!p)return false;
    if(a.jurisdiction&&p.jurisdiction!==a.jurisdiction)return false;
    if(a.propertyType&&p.propertyType!==a.propertyType)return false;
    if(a.kind&&p.kind!==a.kind)return false;
    if(a.words){
      var hay=[p.address,p.description,p.projectName,p.applicant,p.contractor,p.permitNumber].join(" ").toLowerCase();
      if(hay.indexOf(String(a.words).toLowerCase())<0)return false;
    }
    if(a.area){
      if(p.lat==null||p.lng==null)return false;
      if(alMiles(a.area.lat,a.area.lng,p.lat,p.lng)>a.area.miles)return false;
    }
    return true;
  }
  function alMiles(lat1,lng1,lat2,lng2){
    var t=function(x){return x*Math.PI/180}, dl=t(lat2-lat1), dn=t(lng2-lng1);
    var h=Math.pow(Math.sin(dl/2),2)+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.pow(Math.sin(dn/2),2);
    return 2*3958.8*Math.asin(Math.sqrt(h));
  }
  // An area alert's name and summary carry the map lookup's capitals
  // ("8000 S FEDERAL WAY"); shown in ordinary case.
  function alCaps(a,s){
    s=String(s||"");
    var raw=a&&a.area&&a.area.address?String(a.area.address).split(",")[0].trim():"";
    return raw?s.split(raw).join(tidy(raw)):s;
  }
  function alName(a){ return alCaps(a,a.name); }
  function alertTag(f){
    for(var i=0;i<alerts.length;i++){ if(alertMatches(alerts[i],f))return '<span class="pt-hit">'+esc(alName(alerts[i]))+"</span>"; }
    return "";
  }
  function alMatching(a){ return items.filter(function(f){return alertMatches(a,f)}); }
  function alIndex(id){ for(var i=0;i<alerts.length;i++){ if(String(alerts[i].id)===String(id))return i; } return -1; }
  // Each alert with the newest permits it found: what its email will hold.
  function alLine(a){
    var all=alMatching(a), week=all.filter(function(f){return f.daysAgo!=null&&f.daysAgo<=6}).length;
    var how=a.email?"emailed each weekday"+(a.lastEmailedAt?", last sent "+day(a.lastEmailedAt):""):"shown here only";
    var top=all.slice(0,3);
    return '<article class="pa-item"><div class="pw-top"><div class="pw-id"><h3 class="pw-name">'+esc(alName(a))+'</h3><p class="pw-meta">'+esc(alCaps(a,a.describe))+" · "+esc(how)+"</p></div>"+
      '<div class="pw-right"><span class="pa-week">'+(week?"<b>"+week+"</b> new this week":"Nothing new this week")+"</span>"+
      (a.area?'<button type="button" class="pt-rm" data-almap="'+esc(a.id)+'">'+(alMapOpen===a.id?"Hide map":"Show on map")+"</button>":"")+
      (AL.canTrack?'<button type="button" class="pt-rm" data-aledit="'+esc(a.id)+'">Change</button>':"")+
      '<button type="button" class="pt-rm" data-aldel="'+esc(a.id)+'">Delete</button></div></div>'+
      (a.area&&alMapOpen===a.id?'<div class="pa-map" id="paLineMap"></div><p class="pa-mapnote">'+all.length+" of the last "+WIN+" days’ permits "+(all.length===1?"is":"are")+" inside this circle."+(alUnplaced()?" "+alUnplaced()+" permits in the list couldn’t be placed on the map.":"")+"</p>":"")+
      (top.length?'<ul class="pa-mini">'+top.map(function(f){
        return "<li><time>"+esc(day(f.appliedDate))+'</time><span class="a">'+esc(f.address?street(f.address):f.permitNumber)+'</span><span class="w">'+esc(f.description||f.projectName||f.type)+"</span>"+stTag(f.status,f.stage)+"</li>";
      }).join("")+"</ul>"+(all.length>3?'<button type="button" class="pt-rm pa-all" data-alshow="'+esc(a.id)+'">See all '+all.length+" in Filings →</button>":"")
        :'<p class="pa-none">No permit in the last '+WIN+" days fits this alert.</p>")+"</article>";
  }
  function alFormOpen(){ return $("paForm").className.indexOf("hide")<0; }
  function renderAlerts(){
    $("paAdd").className=AL.canTrack&&alerts.length<(AL.max||10)&&!alFormOpen()?"pw-btn pri":"pw-btn pri hide";
    $("paPro").className=AL.canTrack?"pw-pro hide":"pw-pro";
    $("paSub").textContent=!AL.canTrack
      ? (alerts.length?"Your alerts are kept here. You can delete any of them.":"")
      : alerts.length
      ? "New permits that fit an alert come by email each weekday morning, after the city portals are read. Nothing is sent on a day with no match."
      : "Save what you follow, like industrial permits in Boise or tenant build-outs in Meridian, and get its new permits by email each weekday morning and here.";
    $("paSub").className=$("paSub").textContent?"pw-sub":"pw-sub hide";
    $("paList").innerHTML=alerts.map(alLine).join("");
    // An open map is drawn again into its new box.
    if(alMapOpen){ var k=alIndex(alMapOpen); if(k>-1&&alerts[k].area)drawAreaMap("paLineMap",alerts[k].area); else alMapOpen=null; }
    tabCounts();
  }
  function alPreview(){
    if(alWithin()&&!alAreaNow()){ formMsg($("paMsg"),$("paAddr").value.trim()?"":"Type an address to see the area."); return; }
    var a={jurisdiction:$("paCity").value,propertyType:$("paProp").value,kind:$("paKind").value,words:$("paWords").value.trim(),area:alAreaNow()};
    var n=items.filter(function(f){return alertMatches(a,f)}).length;
    formMsg($("paMsg"),n+(n===1?" permit":" permits")+" in the last "+WIN+" days "+(n===1?"matches.":"match.")+(a.area&&alUnplaced()?" "+alUnplaced()+" couldn’t be placed on the map.":""));
  }
  function openAlertForm(a){
    alEditing=a&&a.id?a.id:null;
    $("paFormTitle").textContent=alEditing?"Change alert":"New alert";
    $("paSave").textContent=alEditing?"Save":"Save alert";
    $("paCity").value=(a&&a.jurisdiction)||""; $("paProp").value=(a&&a.propertyType)||"";
    $("paKind").value=(a&&a.kind)||""; $("paWords").value=(a&&a.words)||"";
    $("paName").value=alEditing?a.name:""; $("paEmail").checked=!a||a.email!==false;
    var ar=a&&a.area;
    $("paWithin").checked=Boolean(ar); $("paAnywhere").checked=!ar;
    $("paMiles").value=String(ar?ar.miles:1); $("paAddr").value=ar?tidy(ar.address):"";
    alArea=ar?{lat:ar.lat,lng:ar.lng,matched:ar.address}:null;
    $("paFound").className=ar?"pa-found ok":"pa-found hide"; $("paFound").textContent=ar?"✓ Found on the map: "+tidy(ar.address):"";
    $("paForm").className="pw-form";
    renderAlerts(); alShowArea();
  }
  function closeAlertForm(){ alEditing=null; $("paForm").className="pw-form hide"; formMsg($("paMsg"),""); }
  function asJson(r){ return r.json().catch(function(){return {}}).then(function(j){return {s:r.status,j:j}}); }
  function applyAlerts(o){
    if(!o)return;
    if(o.s!==200||!o.j){
      $("paSub").textContent="Your alerts couldn’t be loaded just now. Refresh in a moment.";
      $("paSub").className="pw-sub";
      return;
    }
    AL=o.j; alerts=Array.isArray(AL.alerts)?AL.alerts:[];
    (AL.cities||[]).forEach(function(c){ var op=document.createElement("option"); op.value=c.key; op.textContent=c.label; $("paCity").appendChild(op); });
    (AL.propertyTypes||[]).forEach(function(t){ var op=document.createElement("option"); op.value=t; op.textContent=t; $("paProp").appendChild(op); });
    (AL.kinds||[]).forEach(function(k){ var op=document.createElement("option"); op.value=k.key; op.textContent=k.label; $("paKind").appendChild(op); });
    (AL.areaMiles||[0.5,1,2,5]).forEach(function(m){ var op=document.createElement("option"); op.value=String(m); op.textContent=m===0.5?"½ mile":m===1?"1 mile":m+" miles"; $("paMiles").appendChild(op); });
    $("paMiles").value="1";
    if(MINE&&MINE.email)$("paEmailText").textContent="Email me its new permits each weekday morning ("+MINE.email+")";
    if(MINE&&!MINE.emailLive)$("paFine").textContent="Email isn’t switched on for CompNinja yet, so for now new permits show here on the Permit tracker.";
    renderAlerts();
    render();
  }
  // "See all N in Filings": the list, filtered to that alert alone.
  function showAlertInList(a){
    clearFilters(); ALERT=a; render();
    showTab("filings",true);
    var t=$("ptTabs"); if(t&&t.scrollIntoView)t.scrollIntoView({block:"start"});
  }
  $("paAdd").addEventListener("click",function(){ openAlertForm(null); });
  $("paCancel").addEventListener("click",function(){ closeAlertForm(); renderAlerts(); });
  ["paCity","paProp","paKind"].forEach(function(id){ $(id).addEventListener("change",alPreview); });
  $("paWords").addEventListener("input",alPreview);
  $("paAnywhere").addEventListener("change",function(){ alShowArea(); });
  $("paWithin").addEventListener("change",function(){ if($("paAddr").value.trim()&&!alArea)alLookup(); else alShowArea(); $("paAddr").focus(); });
  $("paMiles").addEventListener("change",alShowArea);
  $("paAddr").addEventListener("input",function(){ clearTimeout(alGeoTimer); alGeoTimer=setTimeout(alLookup,700); });
  $("paCity").addEventListener("change",function(){ if(alWithin()&&$("paAddr").value.trim()&&$("paAddr").value.indexOf(",")<0)alLookup(); });
  $("paForm").addEventListener("submit",function(e){
    e.preventDefault();
    var body={jurisdiction:$("paCity").value,propertyType:$("paProp").value,kind:$("paKind").value,
      words:$("paWords").value,name:$("paName").value,email:$("paEmail").checked,
      areaAddress:alWithin()?$("paAddr").value.trim():"",areaMiles:Number($("paMiles").value)};
    if(alWithin()&&!$("paAddr").value.trim()){ formMsg($("paMsg"),"Type the address the area is around, or pick Anywhere in the city.","bad"); $("paAddr").focus(); return; }
    var url="/api/permits/alerts"+(alEditing?"?id="+encodeURIComponent(alEditing):"");
    $("paSave").disabled=true; formMsg($("paMsg"),"Saving…");
    fetch(url,{method:alEditing?"PATCH":"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
      .then(asJson)
      .then(function(o){
        $("paSave").disabled=false;
        if(o.s!==200||!o.j.alert){ formMsg($("paMsg"),(o.j&&o.j.error)||"Couldn’t save that alert. Please try again.","bad"); return; }
        var i=alIndex(o.j.alert.id); if(i>-1)alerts[i]=o.j.alert; else alerts.push(o.j.alert);
        if(ALERT&&String(ALERT.id)===String(o.j.alert.id))ALERT=o.j.alert;
        closeAlertForm(); renderAlerts(); render();
      })
      .catch(function(){ $("paSave").disabled=false; formMsg($("paMsg"),"That didn’t reach the server. Nothing was saved.","bad"); });
  });
  $("paList").addEventListener("click",function(e){
    var t=e.target&&e.target.closest?e.target.closest("button"):null; if(!t)return;
    var ed=t.getAttribute("data-aledit"), del=t.getAttribute("data-aldel"), mp=t.getAttribute("data-almap"), sh=t.getAttribute("data-alshow");
    if(mp){
      alMapOpen=alMapOpen===mp?null:mp; renderAlerts();
      return;
    }
    if(sh){ var s=alIndex(sh); if(s>-1)showAlertInList(alerts[s]); return; }
    if(ed){ var i=alIndex(ed); if(i>-1){ openAlertForm(alerts[i]); $("paForm").scrollIntoView({block:"nearest"}); } return; }
    if(del){
      var k=alIndex(del); if(k<0)return;
      if(!confirm("Delete the alert “"+alName(alerts[k])+"”? Its emails stop."))return;
      fetch("/api/permits/alerts?id="+encodeURIComponent(del),{method:"DELETE",credentials:"same-origin"})
        .then(function(r){ if(!r.ok)throw new Error("x"); var j=alIndex(del); if(j>-1)alerts.splice(j,1); if(alEditing===del)closeAlertForm(); if(ALERT&&String(ALERT.id)===String(del))ALERT=null; renderAlerts(); render(); })
        .catch(function(){ alert("Couldn’t delete that alert just now. Please try again."); });
    }
  });

  $("ptSearch").addEventListener("input",render);
  $("ptTypeAll").addEventListener("click",function(){ SEL.prop={}; [].forEach.call($("ptFac").querySelectorAll('input[data-g="prop"]'),function(i){ i.checked=false; }); facetMarks(); render(); });
  $("ptClear").addEventListener("click",function(){ clearFilters(); render(); });
  $("ptClearAll").addEventListener("click",function(){ clearFilters(); render(); });
  $("ptChips").addEventListener("click",function(e){ if(e.target&&e.target.id==="ptAlertOff"){ ALERT=null; render(); } });

  // Which tab the page opens on. Two deep links come first (made for the
  // Workspace's Tracked permits card, which came off on 2026-09-30, and kept so
  // a saved link still lands): #pw-<id> brings that permit's card into view,
  // and ?track=1 opens the add form. Then a tab named in the hash; then Your
  // permits when one has unread news, Filings otherwise.
  function startTab(){
    var hash=String(location.hash||"");
    var target=hash.indexOf("#pw-")===0?document.getElementById(decodeURIComponent(hash.slice(1))):null;
    if(target){ showTab("mine"); target.className+=" pw-focus"; target.scrollIntoView({block:"center"}); return; }
    if(/(^|[?&])track=1(&|$)/.test(String(location.search||""))&&MINE&&MINE.canTrack&&ownCount()<(MINE.max||25)){ showTab("mine"); openAdd(); return; }
    for(var i=0;i<TAB_ORDER.length;i++){ if(hash==="#"+TABS[TAB_ORDER[i]].hash){ showTab(TAB_ORDER[i]); return; } }
    showTab(MINE&&MINE.unread>0?"mine":"filings");
  }
  apply(BOOT);
  if(BOOT&&BOOT.s===200){
    applyMine(BOOT.mine);
    applyAlerts(BOOT.alerts);
    tabCounts();
    startTab();
  }
})();
</script>`;
}

module.exports = { renderPermitsBody };
