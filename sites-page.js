"use strict";
// ---------------------------------------------------------------------------
// /sites — a development firm's deals, by stage (2026-10-12).
//
// WHY A PAGE. The rail's Sites row (a development firm's, in Pipeline's place
// under Messages, 2026-10-09) opened Home's Properties tab, so it was the
// same screen as Home with another row lit (the owner: "Sites is the exact
// same thing as home, this is a problem", and the pick of a page of its own
// over removing the row). Home is everything on one map; this page is the
// deals alone, as a pipeline: one column per buying stage (Prospect, LOI,
// Under contract, Entitlements), each deal a card with its acres, asking
// price and next deadline, and the one opened worked under the board with
// Home's own pane. Passed deals fold away at the foot. What a member OWNS
// stays on Home (a closed deal moves there), and the add form here takes
// deals only (HOMESITES' buyOnly).
//
// A marketShell BODY, like permits-page.js and buildings-page.js: no
// doctype, head, header or footer, no Tailwind utility classes (tailwind.css
// is purged against index.html alone), and its <style> emitted in the BODY
// after MARKET_CSS so its rules win on equal specificity. server.js owns the
// route, the gate (requireSites' three refusals, read once at render) and the
// read; this file only decides how it is drawn.
//
// NOTHING IS DECIDED TWICE. The stage names, order and deadline rule are
// SITES (sites.js), the pane, its writes and the add form are HOMESITES
// (home-sites.js) with their styles in /home-sites.css, the same three files
// Home loads. Every write is one of those files' fetches to /api/sites, which
// re-checks it; this page re-reads GET /api/sites after each, and a failed
// read keeps what was on screen (an outage is never an absence). No write
// happens on load, so a prerendered copy (CLAUDE.md rule 15) is harmless.
//
// Built with createElement/textContent: every address, note and seller is
// text a person typed. The page literal below interpolates exactly one value,
// the boot JSON; test/sites-page.test.js compiles the script it emits.
// ---------------------------------------------------------------------------

function renderSitesBody(boot) {
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<style>
.sp-page,.sp-page *{box-sizing:border-box}
/* The footer starts below the first screen (2026-11-16, the owner: "when you
   first click on a tab the blue footer isn't in the frame"). marketShell's
   outer main is the one that pushes it; a short board left it on screen. */
body>main.wrap{min-height:100vh}
.sp-page{margin:24px 0 56px}
.sp-page .kicker{font-size:var(--text-tiny);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.sp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;border-bottom:1.5px solid var(--ink);padding-bottom:8px;margin-top:4px}
.sp-head h1{margin:0;font-weight:600;font-size:var(--text-h1);line-height:1.2143;letter-spacing:-.02em;color:var(--ink)}
.sp-sub{font-size:var(--text-small);line-height:1.55;color:var(--ink-3);margin:10px 0 0;max-width:88ch}
/* One small line icon, drawn by the script (icon()) or written inline in the
   empty invitation. currentColor, so it takes each place's ink in both themes. */
.sp-i{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
/* Each buying stage's accent, a ramp from light to full ink: the column's top
   edge, the empty invitation's preview and the open deal's top edge. */
.sp-page [data-stage="prospect"]{--sc:var(--ink-4)}
.sp-page [data-stage="loi"]{--sc:var(--ink-faint)}
.sp-page [data-stage="contract"]{--sc:var(--ink-3)}
.sp-page [data-stage="entitle"]{--sc:var(--ink)}
.sp-page [data-stage="passed"]{--sc:var(--line)}
/* The figures across every deal in play: four tiles (2026-11-17). */
.sp-figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0 0}
.sp-fig{position:relative;min-width:0;padding:14px 16px 13px;border:1px solid var(--line);border-radius:var(--r-2xl);background:var(--card);font-size:var(--text-small);line-height:1.4;color:var(--ink-3);box-shadow:0 1px 2px rgba(15,23,42,.04)}
.sp-figs b{display:block;margin:0 22px 3px 0;font-weight:600;font-size:var(--text-heading);line-height:1.2;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-fig .sp-i{position:absolute;top:15px;right:15px;width:16px;height:16px;color:var(--ink-faint)}
.sp-fig.hot .sp-i{color:var(--red)}
/* The countdown takes the icon's corner. */
.sp-fig .hs-chip{position:absolute;top:13px;right:13px}
.sp-fig.chip .sp-i{display:none}
.sp-fig.chip b{margin-right:76px}
/* The script hides these two with the hidden attribute, and each sets a
   display, which out-ranks the browser's own rule for it: until 2026-11-13 an
   empty Sites page drew a row of dashes and four empty columns around its
   "No sites yet" card. (The buttons and tabs say theirs in components.js.) */
.sp-figs[hidden],.sp-board[hidden]{display:none}
.sp-wall{border:1px solid var(--edge);border-left:3px solid var(--ink-3);border-radius:var(--r-2xl);background:var(--card);padding:18px 20px;margin:20px 0}
.sp-wall p{margin:0 0 8px;font-size:var(--text-compact);line-height:1.5;color:var(--ink-body)}
.sp-wall p:last-child{margin-bottom:0}
.sp-wall a{color:var(--red);text-decoration:underline}
.sp-page .dk-msg{font-size:var(--text-small);color:var(--ink-2);margin-top:8px}
.sp-page .dk-msg.bad{color:var(--red)}
.sp-msg{margin:12px 0 0;font-size:var(--text-compact);color:var(--ink-2)}
/* The add form, in a card of its own with a title over HOMESITES' form. */
.sp-addbox{margin-top:20px;padding:18px 18px 16px;border:1px solid var(--edge);border-radius:var(--r-2xl);background:var(--card);box-shadow:0 18px 40px -28px rgba(15,23,42,.45)}
.sp-addbox:empty{display:none}
.sp-addh{margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid var(--hair)}
.sp-addh h2{margin:0;font-weight:600;font-size:var(--text-subhead);letter-spacing:-.01em;color:var(--ink)}
.sp-addh p{margin:3px 0 0;font-size:var(--text-small);color:var(--ink-3)}
.sp-addbox .hs-add{margin:0;padding:0;border:0;border-radius:0;background:none}
/* The board: one column per buying stage. Four across on a desktop, two on a
   tablet, one stack on a phone (each column's head stays, so an empty stage
   still says it is empty). */
.sp-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:22px}
.sp-col{min-width:0;border:1px solid var(--line);border-top:3px solid var(--sc,var(--line));border-radius:var(--r-2xl);background:var(--wash);padding:10px 9px 9px}
.sp-ch{display:flex;align-items:center;gap:8px;padding:2px 3px 0}
.sp-step{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:50%;background:var(--card);box-shadow:inset 0 0 0 1px var(--edge);font-size:var(--text-tiny);font-weight:600;color:var(--ink-2);font-variant-numeric:tabular-nums}
.sp-ch h2{flex:1;min-width:0;margin:0;font-size:var(--text-label);font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-ch .n{flex:none;min-width:24px;padding:2px 7px;border-radius:var(--r-pill);background:var(--card);box-shadow:inset 0 0 0 1px var(--line);text-align:center;font-size:var(--text-label);font-weight:600;color:var(--ink-2);font-variant-numeric:tabular-nums}
.sp-cf{padding:3px 3px 10px 31px;font-size:var(--text-label);color:var(--ink-3);font-variant-numeric:tabular-nums;min-height:28px}
.sp-cards{display:flex;flex-direction:column;gap:8px}
.sp-card{position:relative;display:block;width:100%;text-align:left;font:inherit;color:inherit;padding:12px 12px 11px;border:1px solid var(--line);border-radius:var(--r-xl);background:var(--card);cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.06);transition:box-shadow .15s ease,border-color .15s ease,transform .15s ease}
.sp-card:hover{border-color:var(--edge);box-shadow:0 8px 18px -10px rgba(15,23,42,.3);transform:translateY(-1px)}
.sp-card:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.sp-card[aria-expanded="true"]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
/* A deadline inside a week marks the card's left edge, beside its chip. */
.sp-card.urgent::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:2px;background:var(--red-fill)}
.sp-ct{display:flex;align-items:flex-start;gap:8px}
.sp-ca{display:block;flex:1;min-width:0;font-size:var(--text-compact);font-weight:600;line-height:1.3;color:var(--ink);overflow-wrap:anywhere}
.sp-ty{flex:none;margin-top:1px;padding:2px 6px;border-radius:var(--r-sm);background:var(--wash);box-shadow:inset 0 0 0 1px var(--hair);font-size:var(--text-tiny);font-weight:600;letter-spacing:.02em;color:var(--ink-3);white-space:nowrap}
.sp-cc{display:block;margin-top:2px;font-size:var(--text-small);color:var(--ink-3);overflow-wrap:anywhere}
.sp-cn{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin-top:10px;font-variant-numeric:tabular-nums}
.sp-cp{font-size:var(--text-input);font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.sp-cs{font-size:var(--text-small);color:var(--ink-3)}
.sp-cd{display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:9px;border-top:1px solid var(--hair);font-size:var(--text-label);color:var(--ink-2)}
.sp-cd .sp-i{color:var(--ink-3)}
.sp-cd .w{flex:1;min-width:0;overflow-wrap:anywhere}
/* A deadline is what it is over the day it falls (the ' · ' between them
   is for the text alone), so a long name never splits its date. */
.sp-cd .dl{display:block;font-weight:500}
.sp-cd .dd{display:block;margin-top:1px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.sp-cd .sep{display:none}
.sp-card.urgent .sp-cd .sp-i{color:var(--red)}
.sp-co{display:inline-flex;align-items:center;gap:5px;margin-top:8px;padding:2px 8px 2px 6px;border-radius:var(--r-pill);background:var(--wash);box-shadow:inset 0 0 0 1px var(--line);font-size:var(--text-tiny);font-weight:600;color:var(--ink-2)}
.sp-co .sp-i{width:12px;height:12px}
.sp-co.who{padding-left:3px}
.sp-co.who::before{content:attr(data-i);display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--ink);color:var(--card);font-size:9px;font-weight:600}
.sp-card.theirs{background:var(--paper,var(--card))}
.sp-none{margin:0;padding:18px 8px;border:1px dashed var(--edge);border-radius:var(--r-xl);font-size:var(--text-small);color:var(--ink-3);text-align:center}
/* The open deal, worked under the board with Home's pane (home-sites.css),
   in one card with its stage's accent along the top. */
.sp-open{margin-top:22px;scroll-margin-top:16px;border:1px solid var(--edge);border-top:3px solid var(--sc,var(--edge));border-radius:var(--r-2xl);background:var(--card);box-shadow:0 18px 40px -28px rgba(15,23,42,.45);overflow:hidden}
.sp-open[hidden]{display:none}
.sp-oh{display:flex;align-items:flex-start;justify-content:space-between;gap:6px 12px;padding:16px 18px 14px;border-bottom:1px solid var(--hair)}
.sp-ot{min-width:0}
.sp-oh .k{display:block;margin-bottom:3px;font-size:var(--text-tiny);font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.sp-oh h2{margin:0;font-weight:600;font-size:var(--text-subhead);letter-spacing:-.01em;color:var(--ink);overflow-wrap:anywhere}
.sp-oh .c{display:block;margin-top:2px;font-size:var(--text-small);color:var(--ink-3)}
.sp-open .hs-pane{margin:0;padding:16px 18px 14px;border:0;border-radius:0;box-shadow:none}
.sp-open .hs-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
/* The invitation before a first deal (2026-11-17): a preview of the board it
   fills, what it says, the button, and what each deal keeps. */
.sp-empty{margin-top:22px;padding:32px 28px 28px;border:1px solid var(--line);border-radius:var(--r-2xl);background:var(--card);text-align:center;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.sp-demo{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;max-width:560px;margin:0 auto 26px}
.sp-dc{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;padding:8px 7px 9px;border-top:3px solid var(--sc);border-radius:var(--r-lg);background:var(--wash)}
.sp-dc+.sp-dc::before{content:"";position:absolute;left:-11px;top:42%;width:6px;height:6px;border-top:1.5px solid var(--ink-4);border-right:1.5px solid var(--ink-4);transform:rotate(45deg)}
.sp-dl{font-size:var(--text-tiny);font-weight:600;color:var(--ink-3);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-dg{position:relative;display:block;height:34px;border-radius:var(--r-md);background:var(--card);box-shadow:0 0 0 1px var(--line)}
.sp-dg::before,.sp-dg::after{content:"";position:absolute;left:7px;height:5px;border-radius:2px}
.sp-dg::before{top:9px;width:62%;background:var(--ink-4)}
.sp-dg::after{top:20px;width:36%;background:var(--line)}
.sp-dnew{display:flex;align-items:center;justify-content:center;background:var(--err-bg);box-shadow:none;border:1.5px dashed var(--red);color:var(--red);font-size:var(--text-lead);font-weight:600}
.sp-dnew::before,.sp-dnew::after{display:none}
.sp-empty h2{margin:0 0 6px;font-weight:600;font-size:var(--text-heading);letter-spacing:-.02em;color:var(--ink)}
.sp-empty p{margin:0 auto 18px;max-width:52ch;font-size:var(--text-compact);line-height:1.55;color:var(--ink-3)}
.sp-feats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;max-width:780px;margin:28px auto 0;padding:22px 0 0;border-top:1px solid var(--hair);list-style:none;text-align:left}
.sp-feats li{display:grid;grid-template-columns:34px minmax(0,1fr);column-gap:12px;align-content:start}
.sp-feats .sp-i{grid-row:span 2;width:34px;height:34px;padding:8px;border-radius:var(--r-lg);background:var(--wash);color:var(--ink-2)}
.sp-feats b{font-size:var(--text-compact);font-weight:600;color:var(--ink)}
.sp-feats span{margin-top:2px;font-size:var(--text-small);line-height:1.45;color:var(--ink-3)}
/* Passed, folded away in a card of its own. */
.sp-fold{margin-top:22px;border:1px solid var(--line);border-radius:var(--r-2xl);background:var(--card);padding:0 14px}
.sp-fold>summary{display:flex;align-items:center;gap:10px;padding:13px 0;list-style:none;cursor:pointer;font-size:var(--text-compact);font-weight:600;color:var(--ink-2)}
.sp-fold>summary::-webkit-details-marker{display:none}
.sp-fold>summary::before{content:"";flex:none;width:7px;height:7px;margin:0 2px 0 1px;border-right:1.5px solid var(--ink-3);border-bottom:1.5px solid var(--ink-3);transform:rotate(-45deg);transition:transform .15s ease}
.sp-fold[open]>summary::before{transform:rotate(45deg)}
.sp-fold>summary:hover{color:var(--ink)}
.sp-fold>summary span{padding:1px 8px;border-radius:var(--r-pill);background:var(--wash);box-shadow:inset 0 0 0 1px var(--line);font-size:var(--text-label);color:var(--ink-3);font-variant-numeric:tabular-nums}
.sp-fold>summary span:empty{display:none}
.sp-fold .sp-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:0 0 14px}
.sp-foot{display:flex;align-items:center;gap:8px;margin-top:22px;font-size:var(--text-small);color:var(--ink-3)}
.sp-foot .sp-i{color:var(--ink-faint)}
.sp-foot a{color:var(--ink-2);text-decoration:underline;text-underline-offset:2px}
.sp-foot a:hover{color:var(--ink)}
@media (prefers-reduced-motion:reduce){.sp-card,.sp-fold>summary::before{transition:none}.sp-card:hover{transform:none}}
@media (max-width:1000px){.sp-board,.sp-fold .sp-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.sp-figs{grid-template-columns:repeat(2,minmax(0,1fr))}.sp-open .hs-grid{grid-template-columns:minmax(0,1fr)}.sp-feats{grid-template-columns:minmax(0,1fr);max-width:420px}}
@media (max-width:600px){.sp-board,.sp-fold .sp-cards{grid-template-columns:minmax(0,1fr)}.sp-head h1{font-size:var(--text-heading)}.sp-head{flex-wrap:wrap;align-items:baseline}
.sp-figs{gap:8px}.sp-fig{padding:12px 12px 11px}.sp-figs b{font-size:var(--text-subhead)}.sp-fig .sp-i{top:13px;right:12px}
.sp-fig .hs-chip{position:static;display:table;margin-top:6px}.sp-fig.chip b{margin-right:0}
.sp-empty{padding:24px 16px 20px}.sp-demo{gap:10px;margin-bottom:20px}.sp-dc{padding:7px 5px 7px}.sp-dc+.sp-dc::before{left:-8px}.sp-dl{white-space:normal;line-height:1.2;min-height:2.4em}.sp-dg{height:28px}.sp-empty h2{font-size:var(--text-subhead)}
.sp-oh,.sp-open .hs-pane{padding-left:14px;padding-right:14px}}
</style>
<link rel="stylesheet" href="/home-sites.css">
<main class="wrap sp-page">
  <div class="kicker">Your deals</div>
  <div class="sp-head"><h1>Sites</h1><button type="button" id="spAddBtn" class="hm-btn red" hidden>+ Add a site</button></div>
  <p class="sp-sub" id="spSub">The land and buildings you're buying, by stage. Only you can see them.</p>
  <div id="spWall" class="sp-wall" hidden></div>
  <div id="spApp" hidden>
    <div class="sp-figs" id="spFigs"></div>
    <div class="sp-addbox" id="spAdd"></div>
    <p class="sp-msg" id="spMsg" role="status" hidden></p>
    <div id="spEmpty" class="sp-empty" hidden>
      <div class="sp-demo" aria-hidden="true">
        <div class="sp-dc" data-stage="prospect"><span class="sp-dl">Prospect</span><span class="sp-dg sp-dnew">+</span><span class="sp-dg"></span></div>
        <div class="sp-dc" data-stage="loi"><span class="sp-dl">LOI</span><span class="sp-dg"></span><span class="sp-dg"></span></div>
        <div class="sp-dc" data-stage="contract"><span class="sp-dl">Under contract</span><span class="sp-dg"></span></div>
        <div class="sp-dc" data-stage="entitle"><span class="sp-dl">Entitle&shy;ments</span><span class="sp-dg"></span></div>
      </div>
      <h2>No sites yet</h2>
      <p>Add a property you're looking at and follow it from Prospect through LOI, Under contract and Entitlements, with its terms, key dates and notes.</p>
      <button type="button" id="spEmptyAdd" class="hm-btn red">+ Add your first site</button>
      <ul class="sp-feats">
        <li><svg class="sp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 16h5"/></svg><b>Key terms</b><span>Asking price, acres, price per acre and zoning, side by side.</span></li>
        <li><svg class="sp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg><b>Deadlines that count down</b><span>LOI, due diligence and closing dates, flagged once they're a week out.</span></li>
        <li><svg class="sp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4ZM12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4ZM19 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4Z"/><path d="M7 12h3M14 12h3"/></svg><b>Every stage dated</b><span>See when each deal moved, with your notes beside it.</span></li>
      </ul>
    </div>
    <div class="sp-board" id="spBoard"></div>
    <section class="sp-open" id="spOpen" hidden></section>
    <details class="sp-fold" id="spPassed" hidden><summary>Passed<span id="spPassedN"></span></summary><div class="sp-cards" id="spPassedRows"></div></details>
    <p class="sp-foot" id="spFoot"></p>
  </div>
</main>
<script src="/sites.js"></script>
<script src="/home-sites.js"></script>
<script>
(function(){
  "use strict";
  var BOOT = ${bootJson};
  var $ = function(id){ return document.getElementById(id); };
  function wall(lines){
    var w = $("spWall");
    w.textContent = "";
    lines.forEach(function(l){
      var p = document.createElement("p");
      l.forEach(function(part){
        if (typeof part === "string") { p.append(part); return; }
        var a = document.createElement("a"); a.href = part[1]; a.textContent = part[0]; p.append(a);
      });
      w.append(p);
    });
    w.hidden = false;
  }
  // The three refusals, in requireSites' order, and the one this page adds:
  // deals are a development firm's (HOMEMAP.dealsOn's rule on Home).
  if (!BOOT) { wall([["Your sites couldn't be loaded just now. Please try again in a minute."]]); return; }
  if (BOOT.s === 401) { wall([["Sign in to see your sites. ", ["Sign in", "/?auth=signin"]]]); return; }
  if (BOOT.s === 403) { wall([["Tracking the sites you're buying is part of Pro. ", ["See Pro", "/pricing"]]]); return; }
  if (BOOT.s !== 200) { wall([["Your sites are unavailable right now. Please try again in a minute."]]); return; }
  // A firm read that failed is said as such, never as "not a development firm".
  if (BOOT.firmFailed || (BOOT.firm && !BOOT.firm.kind)) {
    wall([["Your firm couldn't be loaded just now, so your sites can't be shown. ", ["Try again", "/sites"], "."]]);
    return;
  }
  if (!BOOT.firm || BOOT.firm.kind !== "development") {
    wall([["Sites is for development firms: the land and buildings a developer is buying, by stage."],
      ["Your properties are on ", ["Home", "/desk#properties"], "."]]);
    return;
  }
  if (typeof SITES === "undefined" || typeof HOMESITES === "undefined") {
    wall([["This page didn't finish loading. ", ["Reload it", "/sites"], " to see your sites."]]);
    return;
  }

  var sites = Array.isArray(BOOT.sites) ? BOOT.sites : [];
  // The deals colleagues shared with the firm (2026-10-21, migration 061):
  // on the board beside the member's own, read-only. null: that read failed,
  // and the page says so rather than showing the firm none.
  var firmSites = BOOT.firmSites === null ? null : (Array.isArray(BOOT.firmSites) ? BOOT.firmSites : []);
  var share = BOOT.share || null;
  var FIRM_FAILED = "Your team's shared deals couldn't be loaded just now. Yours are all here.", firmSaid = false;
  // The member's own calendar day, Home's rule (index.html's hmLocalDay), read
  // again at every draw. Until 2026-11-10 it was the server's UTC day (the
  // boot's and GET /api/sites' today), so every evening in the US tomorrow's
  // deadline read "Today" and today's read as past, while Home said otherwise.
  function localDay(){
    var d = new Date(), p = function(n){ return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  var today = localDay();
  var openKey = "";       // the open card: "site:<id>", or "a:<address>" until the read that names it
  var passedOpen = false;

  function el(tag, cls, text){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // The page's few line icons (24-unit paths, stroked in currentColor by .sp-i).
  var ICONS = {
    deals: ["M12 3 3 7.5l9 4.5 9-4.5L12 3Z", "m3 12 9 4.5 9-4.5", "m3 16.5 9 4.5 9-4.5"],
    acres: ["m9 4-5.5 2v14L9 18l6 2 5.5-2V4L15 6 9 4Z", "M9 4v14M15 6v14"],
    money: ["M12 3v18", "M16.5 7.5c0-1.9-2-3-4.5-3s-4.5 1.2-4.5 3.2c0 4.6 9.5 2.2 9.5 7 0 2-2 3.3-5 3.3s-4.8-1.3-4.8-3.3"],
    cal: ["M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "M3.5 9.5h17M8 3v4M16 3v4"],
    clock: ["M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17Z", "M12 7.5V12l3 2"],
    team: ["M9 4.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4Z", "M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5", "M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.6.6 2.7 2.2 3 4.7"],
    home: ["M4 10.5 12 4l8 6.5V20h-5v-5.5H9V20H4z"],
  };
  function icon(name){
    var ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg");
    s.setAttribute("class", "sp-i");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    ICONS[name].forEach(function(d){ var p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.append(p); });
    return s;
  }
  function norm(a){ return String(a || "").trim().toLowerCase().replace(/\\s+/g, " "); }
  function cityOf(a){ var p = String(a || "").split(","); return p.slice(1).join(",").trim(); }
  function isDeal(s){ return s && s.portfolio_item_id == null; }
  function all(){ return sites.concat(firmSites || []); }
  function buying(){ return all().filter(function(s){ return isDeal(s) && SITES.isBuying(s.stage); }); }
  function passed(){ return all().filter(function(s){ return isDeal(s) && s.stage === "passed"; }); }
  function byId(id){ var l = all(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

  // An add or a stage move names the deal by its address (keyOf) before the
  // read that carries its id: the next draw turns that into the card's key.
  function resolveOpen(){
    if (openKey.indexOf("a:") !== 0) return;
    var want = openKey.slice(2), hit = buying().filter(function(s){ return norm(s.address) === want; })[0];
    openKey = hit ? "site:" + hit.id : "";
  }

  var view = HOMESITES.mount({
    propTypes: HOMESITES.PROP_TYPES,
    buyOnly: true,
    data: function(){ return { sites: sites, portfolio: [], buildings: [], firm: null, showValues: false, today: today,
      share: share, firmSites: firmSites || [] }; },
    reload: reload,
    open: function(key){ openKey = key || ""; },
    keyOf: function(address){ return "a:" + norm(address); },
    say: say,
    // The invitation steps aside while the form is open (it offered the same
    // button), and comes back if the form is cancelled with nothing added.
    closeAdd: function(){ $("spAdd").textContent = ""; $("spEmpty").hidden = buying().length > 0 || passed().length > 0; },
    addToFirm: function(){ return Promise.reject(new Error("Add it to your firm from Home.")); },
  });

  function say(text){
    var m = $("spMsg");
    m.textContent = text || "";
    m.hidden = !text;
  }
  function reload(){
    return fetch("/api/sites", { credentials: "same-origin" }).then(function(r){
      return r.ok ? r.json() : null;
    }).then(function(j){
      if (j && Array.isArray(j.sites)) {
        sites = j.sites;
        firmSites = j.firmSites === null ? null : (Array.isArray(j.firmSites) ? j.firmSites : []);
        share = j.share || null;
      }
    }, function(){ /* the last read stands: an outage is never an absence */ }).then(draw);
  }
  function openAdd(){
    var box = $("spAdd"), head = el("div", "sp-addh");
    head.append(el("h2", null, "Add a site"), el("p", null, "It goes on the board in the stage you pick."));
    box.replaceChildren(head, view.addForm("buy"));
    $("spEmpty").hidden = true;
    var f = box.querySelector("input[name=address]");
    if (f) f.focus();
  }
  $("spAddBtn").addEventListener("click", openAdd);
  $("spEmptyAdd").addEventListener("click", openAdd);
  $("spPassed").addEventListener("toggle", function(){ passedOpen = $("spPassed").open; });

  function card(s){
    var key = "site:" + s.id, on = key === openKey;
    var b = el("button", "sp-card" + (s.owner ? " theirs" : ""));
    b.type = "button";
    b.setAttribute("aria-expanded", on ? "true" : "false");
    b.setAttribute("aria-controls", "spOpen");
    // The street, with the property type tagged beside it, then the city.
    var top = el("span", "sp-ct");
    top.append(el("span", "sp-ca", HOMESITES.street(s.address) || "Untitled site"));
    if (s.property_type) top.append(el("span", "sp-ty", s.property_type));
    b.append(top);
    var city = cityOf(s.address);
    if (city) b.append(el("span", "sp-cc", city));
    // The asking price leads (the acres when there is none), and the acres
    // and price per acre follow it in a quieter line (2026-11-17).
    var lead = s.asking_price != null ? HOMESITES.short(s.asking_price) : s.acres != null ? HOMESITES.acres(s.acres) + " ac" : "";
    var bits = [];
    if (s.asking_price != null && s.acres != null) bits.push(HOMESITES.acres(s.acres) + " ac");
    var per = HOMESITES.perAcre(s);
    if (per) bits.push(HOMESITES.short(per) + "/ac");
    if (lead) {
      var n = el("span", "sp-cn");
      n.append(el("span", "sp-cp", lead));
      if (bits.length) n.append(el("span", "sp-cs", bits.join(" · ")));
      b.append(n);
    }
    var next = s.stage === "passed" ? null : SITES.nextDeadline(s.dates, today);
    if (next) {
      var c = HOMESITES.countdown(next.on, today), d = el("span", "sp-cd");
      var w = el("span", "w");
      w.append(el("span", "dl", next.label), el("span", "sep", " · "), el("span", "dd", HOMESITES.dayLabel(next.on, today)));
      d.append(icon("cal"), w);
      if (c) d.append(el("span", "hs-chip" + (c.hot ? " hot" : ""), c.text));
      if (c && c.hot) b.className += " urgent";
      b.append(d);
    } else if (s.stage_dates && s.stage_dates[s.stage]) {
      var since = el("span", "sp-cd");
      since.append(icon("clock"), el("span", "w", (s.stage === "passed" ? "Passed " : "Since ") + HOMESITES.dayLabel(s.stage_dates[s.stage], today)));
      b.append(since);
    }
    // Whose it is: a colleague's shared deal names them; the member's own
    // shared one says so, the rest are theirs alone (the switch is in the pane).
    if (s.owner) {
      var who = String(s.owner.name || "A colleague"), o = el("span", "sp-co who", who + "'s deal");
      o.setAttribute("data-i", who.charAt(0).toUpperCase());
      b.append(o);
    } else if (share && s.org_id != null && String(s.org_id) === String(share.orgId)) {
      var sh = el("span", "sp-co");
      sh.append(icon("team"), "Shared");
      b.append(sh);
    }
    b.addEventListener("click", function(){
      openKey = openKey === key ? "" : key;
      draw();
      if (openKey) $("spOpen").scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return b;
  }

  function draw(){
    resolveOpen();
    today = localDay();
    var deals = buying(), gone = passed(), f = HOMESITES.figures(deals, today);
    $("spApp").hidden = false;
    $("spAddBtn").hidden = false;
    // Who can see what: the line under the heading says it in a sentence.
    $("spSub").textContent = share
      ? "The land and buildings your team is buying, by stage. A deal you add is shared with " + share.name +
        " unless you untick the box, and only its owner can change it."
      : "The land and buildings you're buying, by stage. Only you can see them.";
    // Said when the team's read fails, not on every draw (it would cover the
    // line a write just said), and taken down once a read comes back.
    if (firmSites === null && !firmSaid) { firmSaid = true; say(FIRM_FAILED); }
    else if (firmSites !== null && firmSaid) { firmSaid = false; if ($("spMsg").textContent === FIRM_FAILED) say(""); }

    // The figures across every deal in play.
    // Four tiles, each with its icon; the next deadline's tile carries its
    // countdown, in the warning colour inside a week.
    var figs = $("spFigs");
    var soon = f.next ? HOMESITES.countdown(f.next.on, today) : null;
    figs.textContent = "";
    [["deals", String(f.count), f.count === 1 ? "deal in play" : "deals in play"],
      ["acres", f.acres ? HOMESITES.acres(f.acres) : "—", "acres"],
      ["money", f.asking ? HOMESITES.short(f.asking) : "—", "asking"],
      ["cal", f.next ? HOMESITES.dayLabel(f.next.on, today) : "—", f.next ? "next: " + f.next.label : "no deadlines"]]
      .forEach(function(x, i){
        var d = el("div", "sp-fig" + (i === 3 && soon ? " chip" : "") + (i === 3 && soon && soon.hot ? " hot" : ""));
        d.append(icon(x[0]), el("b", null, x[1]), x[2]);
        if (i === 3 && soon) d.append(el("span", "hs-chip" + (soon.hot ? " hot" : ""), soon.text));
        figs.append(d);
      });
    figs.hidden = !deals.length;
    $("spEmpty").hidden = deals.length > 0 || gone.length > 0 || $("spAdd").children.length > 0;

    // The board.
    var board = $("spBoard");
    board.textContent = "";
    board.hidden = !deals.length && !gone.length;
    SITES.BUYING.forEach(function(stage, i){
      var list = deals.filter(function(s){ return s.stage === stage; });
      var col = el("section", "sp-col");
      col.setAttribute("aria-label", SITES.labelOf(stage));
      col.setAttribute("data-stage", stage);
      var head = el("div", "sp-ch"), step = el("span", "sp-step", String(i + 1));
      step.setAttribute("aria-hidden", "true");
      head.append(step, el("h2", null, SITES.labelOf(stage)), el("span", "n", String(list.length)));
      col.append(head, el("div", "sp-cf", HOMESITES.figuresLine(list, today)));
      var cards = el("div", "sp-cards");
      if (list.length) list.forEach(function(s){ cards.append(card(s)); });
      else cards.append(el("p", "sp-none", "Nothing here"));
      col.append(cards);
      board.append(col);
    });

    // Passed, folded away.
    var fold = $("spPassed"), rows = $("spPassedRows");
    rows.textContent = "";
    gone.forEach(function(s){ rows.append(card(s)); });
    fold.hidden = !gone.length;
    $("spPassedN").textContent = gone.length ? String(gone.length) : "";
    fold.open = passedOpen || gone.some(function(s){ return openKey === "site:" + s.id; });

    // The open deal, with Home's pane. The pane is the same element while its
    // data has not changed, so a redraw keeps whatever is half typed in it.
    var box = $("spOpen"), focused = document.activeElement;
    var s = openKey.indexOf("site:") === 0 ? byId(openKey.slice(5)) : null;
    if (s && !(SITES.isBuying(s.stage) || s.stage === "passed")) s = null;  // closed: it is Home's now
    var pane = s ? view.pane({ key: openKey, siteId: s.id }) : null;
    if (!pane) {
      if (openKey.indexOf("site:") === 0) openKey = "";
      box.textContent = "";
      box.hidden = true;
    } else {
      var oh = el("div", "sp-oh"), t = el("div", "sp-ot");
      var kick = [SITES.labelOf(s.stage), s.property_type].filter(Boolean).join(" · ");
      if (kick) t.append(el("span", "k", kick));
      t.append(el("h2", null, HOMESITES.street(s.address) || "Untitled site"));
      var c = cityOf(s.address);
      if (c) t.append(el("span", "c", c));
      var x = el("button", "hm-btn", "Close");
      x.type = "button";
      x.addEventListener("click", function(){ openKey = ""; draw(); });
      oh.append(t, x);
      box.replaceChildren(oh, pane);
      box.setAttribute("data-stage", s.stage);
      box.hidden = false;
      if (focused && pane.contains(focused) && focused !== document.activeElement) focused.focus({ preventScroll: true });
    }

    // Closed deals live with what the member owns.
    var owned = sites.filter(function(s){ return s && s.stage === "owned"; }).length;
    var foot = $("spFoot"), line = el("span");
    foot.textContent = "";
    line.append(owned
      ? (owned === 1 ? "1 closed deal is" : owned + " closed deals are") + " with what you own, on "
      : "A deal you close moves to what you own, on ");
    var a = el("a", null, "Home");
    a.href = "/desk#properties";
    line.append(a, ".");
    foot.append(icon("home"), line);
  }

  draw();
})();
</script>`;
}

module.exports = { renderSitesBody };
