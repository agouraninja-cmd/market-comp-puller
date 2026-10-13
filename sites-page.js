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
.sp-page{margin:24px 0 48px}
.sp-page .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.sp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;border-bottom:1.5px solid var(--ink);padding-bottom:8px;margin-top:4px}
.sp-head h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:28px;line-height:1.15;color:var(--ink)}
.sp-sub{font-size:13px;color:var(--ink-3);margin:10px 0 0;max-width:88ch}
.sp-figs{display:flex;flex-wrap:wrap;gap:6px 22px;margin:14px 0 0;font-size:13px;color:var(--ink-3)}
.sp-figs b{display:block;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:22px;color:var(--ink);font-variant-numeric:tabular-nums}
.sp-wall{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:18px 20px;margin:18px 0}
.sp-wall p{margin:0 0 8px;font-size:14px;color:var(--ink-body)}
.sp-wall p:last-child{margin-bottom:0}
.sp-wall a{color:var(--red);text-decoration:underline}
.sp-page .hm-btn{flex:none;display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border:1px solid var(--edge);border-radius:8px;background:var(--card);font:inherit;font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;cursor:pointer;text-decoration:none}
.sp-page .hm-btn:hover{border-color:var(--ink-3)}
.sp-page .hm-btn.red{background:var(--red-fill);border-color:var(--red-fill);color:#fff}
.sp-page .hm-btn.red:hover{background:var(--red-fill-hover)}
.sp-page .dk-msg{font-size:13px;color:var(--ink-2);margin-top:8px}
.sp-page .dk-msg.bad{color:var(--red)}
.sp-msg{margin:12px 0 0;font-size:13.5px;color:var(--ink-2)}
.sp-addbox .hs-add{margin:14px 0 0}
/* The board: one column per buying stage. Four across on a desktop, two on a
   tablet, one stack on a phone (each column's head stays, so an empty stage
   still says it is empty). */
.sp-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:20px}
.sp-col{min-width:0;border-radius:12px;background:var(--wash);padding:10px 8px 8px}
.sp-ch{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:2px 4px 8px}
.sp-ch h2{margin:0;font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2)}
.sp-ch .n{font-size:12.5px;font-weight:600;color:var(--ink-3);font-variant-numeric:tabular-nums}
.sp-cf{padding:0 4px 8px;font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums;min-height:15px}
.sp-cards{display:flex;flex-direction:column;gap:8px}
.sp-card{display:block;width:100%;text-align:left;font:inherit;color:inherit;padding:10px 11px;border:1px solid var(--edge);border-radius:10px;background:var(--card);cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.05)}
.sp-card:hover{border-color:var(--ink-3)}
.sp-card:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.sp-card[aria-expanded="true"]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.sp-ca{display:block;font-size:14px;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.sp-cc{display:block;margin-top:1px;font-size:12.5px;color:var(--ink-3);overflow-wrap:anywhere}
.sp-cn{display:block;margin-top:6px;font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.sp-cd{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:7px;font-size:12px;color:var(--ink-3)}
.sp-cd .w{min-width:0;overflow-wrap:anywhere}
.sp-none{padding:14px 6px 12px;font-size:12.5px;color:var(--ink-3);text-align:center}
/* The open deal, worked under the board with Home's pane (home-sites.css). */
.sp-open{margin-top:18px;scroll-margin-top:16px}
.sp-oh{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px;padding:14px 14px 10px;border:1px solid var(--edge);border-bottom:0;border-radius:12px 12px 0 0;background:var(--card)}
.sp-oh h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:21px;color:var(--ink);overflow-wrap:anywhere}
.sp-oh .c{font-size:13px;color:var(--ink-3)}
.sp-oh button{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:13px;color:var(--ink-2);cursor:pointer}
.sp-oh button:hover{color:var(--ink);text-decoration:underline}
.sp-open .hs-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.sp-empty{margin-top:20px;padding:26px 22px;border:1px dashed var(--edge);border-radius:12px;background:var(--card);text-align:center}
.sp-empty h2{margin:0 0 6px;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:21px;color:var(--ink)}
.sp-empty p{margin:0 auto 14px;max-width:52ch;font-size:13.5px;line-height:1.5;color:var(--ink-3)}
.sp-fold{margin-top:22px;border-top:1px solid var(--line)}
.sp-fold>summary{padding:12px 0;cursor:pointer;font-size:13.5px;font-weight:600;color:var(--ink-2)}
.sp-fold>summary span{margin-left:4px;color:var(--ink-3)}
.sp-fold .sp-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.sp-foot{margin-top:22px;font-size:13px;color:var(--ink-3)}
.sp-foot a{color:var(--ink-2)}
.sp-foot a:hover{color:var(--ink)}
@media (max-width:1000px){.sp-board,.sp-fold .sp-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.sp-open .hs-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:600px){.sp-board,.sp-fold .sp-cards{grid-template-columns:minmax(0,1fr)}.sp-head h1{font-size:24px}.sp-head{flex-wrap:wrap;align-items:baseline}}
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
      <h2>No sites yet</h2>
      <p>Add a property you're looking at and follow it from Prospect through LOI, Under contract and Entitlements, with its terms, key dates and notes.</p>
      <button type="button" id="spEmptyAdd" class="hm-btn red">+ Add your first site</button>
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
  var today = BOOT.today || new Date().toISOString().slice(0, 10);
  var openKey = "";       // the open card: "site:<id>", or "a:<address>" until the read that names it
  var passedOpen = false;

  function el(tag, cls, text){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function norm(a){ return String(a || "").trim().toLowerCase().replace(/\\s+/g, " "); }
  function cityOf(a){ var p = String(a || "").split(","); return p.slice(1).join(",").trim(); }
  function isDeal(s){ return s && s.portfolio_item_id == null; }
  function buying(){ return sites.filter(function(s){ return isDeal(s) && SITES.isBuying(s.stage); }); }
  function passed(){ return sites.filter(function(s){ return isDeal(s) && s.stage === "passed"; }); }
  function byId(id){ for (var i = 0; i < sites.length; i++) if (sites[i].id === id) return sites[i]; return null; }

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
    data: function(){ return { sites: sites, portfolio: [], buildings: [], firm: null, showValues: false, today: today }; },
    reload: reload,
    open: function(key){ openKey = key || ""; },
    keyOf: function(address){ return "a:" + norm(address); },
    say: say,
    closeAdd: function(){ $("spAdd").textContent = ""; },
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
      if (j && Array.isArray(j.sites)) { sites = j.sites; if (j.today) today = j.today; }
    }, function(){ /* the last read stands: an outage is never an absence */ }).then(draw);
  }
  function openAdd(){
    var box = $("spAdd");
    box.replaceChildren(view.addForm("buy"));
    var f = box.querySelector("input[name=address]");
    if (f) f.focus();
  }
  $("spAddBtn").addEventListener("click", openAdd);
  $("spEmptyAdd").addEventListener("click", openAdd);
  $("spPassed").addEventListener("toggle", function(){ passedOpen = $("spPassed").open; });

  function card(s){
    var key = "site:" + s.id, on = key === openKey;
    var b = el("button", "sp-card");
    b.type = "button";
    b.setAttribute("aria-expanded", on ? "true" : "false");
    b.setAttribute("aria-controls", "spOpen");
    b.append(el("span", "sp-ca", HOMESITES.street(s.address) || "Untitled site"));
    var city = cityOf(s.address);
    if (city) b.append(el("span", "sp-cc", city));
    var bits = [];
    if (s.acres != null) bits.push(HOMESITES.acres(s.acres) + " ac");
    if (s.asking_price != null) bits.push(HOMESITES.short(s.asking_price));
    var per = HOMESITES.perAcre(s);
    if (per) bits.push(HOMESITES.short(per) + "/ac");
    if (!bits.length && s.property_type) bits.push(s.property_type);
    if (bits.length) b.append(el("span", "sp-cn", bits.join(" · ")));
    var next = s.stage === "passed" ? null : SITES.nextDeadline(s.dates, today);
    if (next) {
      var c = HOMESITES.countdown(next.on, today), d = el("span", "sp-cd");
      d.append(el("span", "w", next.label + " · " + HOMESITES.dayLabel(next.on, today)));
      if (c) d.append(el("span", "hs-chip" + (c.hot ? " hot" : ""), c.text));
      b.append(d);
    } else if (s.stage_dates && s.stage_dates[s.stage]) {
      b.append(el("span", "sp-cd", (s.stage === "passed" ? "Passed " : "Since ") + HOMESITES.dayLabel(s.stage_dates[s.stage], today)));
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
    var deals = buying(), gone = passed(), f = HOMESITES.figures(deals, today);
    $("spApp").hidden = false;
    $("spAddBtn").hidden = false;

    // The figures across every deal in play.
    var figs = $("spFigs");
    figs.textContent = "";
    [[String(f.count), f.count === 1 ? "deal in play" : "deals in play"],
      [f.acres ? HOMESITES.acres(f.acres) : "—", "acres"],
      [f.asking ? HOMESITES.short(f.asking) : "—", "asking"],
      [f.next ? HOMESITES.dayLabel(f.next.on, today) : "—", f.next ? "next: " + f.next.label : "no deadlines"]]
      .forEach(function(x){ var d = el("div"); d.append(el("b", null, x[0]), x[1]); figs.append(d); });
    figs.hidden = !deals.length;
    $("spEmpty").hidden = deals.length > 0 || gone.length > 0;

    // The board.
    var board = $("spBoard");
    board.textContent = "";
    board.hidden = !deals.length && !gone.length;
    SITES.BUYING.forEach(function(stage){
      var list = deals.filter(function(s){ return s.stage === stage; });
      var col = el("section", "sp-col");
      col.setAttribute("aria-label", SITES.labelOf(stage));
      var head = el("div", "sp-ch");
      head.append(el("h2", null, SITES.labelOf(stage)), el("span", "n", String(list.length)));
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
      var oh = el("div", "sp-oh"), t = el("div");
      t.append(el("h2", null, HOMESITES.street(s.address) || "Untitled site"));
      var c = cityOf(s.address);
      if (c) t.append(el("span", "c", c));
      var x = el("button", null, "Close");
      x.type = "button";
      x.addEventListener("click", function(){ openKey = ""; draw(); });
      oh.append(t, x);
      box.replaceChildren(oh, pane);
      box.hidden = false;
      if (focused && pane.contains(focused) && focused !== document.activeElement) focused.focus({ preventScroll: true });
    }

    // Closed deals live with what the member owns.
    var owned = sites.filter(function(s){ return s && s.stage === "owned"; }).length;
    var foot = $("spFoot");
    foot.textContent = "";
    foot.append(owned
      ? (owned === 1 ? "1 closed deal is" : owned + " closed deals are") + " with what you own, on "
      : "A deal you close moves to what you own, on ");
    var a = el("a", null, "Home");
    a.href = "/desk#properties";
    foot.append(a, ".");
  }

  draw();
})();
</script>`;
}

module.exports = { renderSitesBody };
