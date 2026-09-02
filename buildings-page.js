"use strict";
// ---------------------------------------------------------------------------
// /buildings — the firm's whole list of buildings (Three Spaces, slice 4).
//
// A marketShell BODY, like bulk-page.js and messages-page.js: no doctype,
// head, header or footer, no Tailwind utility classes (tailwind.css is purged
// against index.html alone), and its <style> emitted in the BODY after
// MARKET_CSS so its rules win on equal specificity. server.js owns the route,
// the gate and the read; this file only decides how the list is drawn.
//
// WHY A PAGE. The Workspace shows at most OVERFLOW_AT (8) buildings and
// always states the count for the WHOLE set; past eight, one control links
// here. A firm's buildings are a shared record with search needs and earn a
// page; one member's portfolio is a short personal list and earns a fold —
// the deliberate asymmetry the plan names.
//
// ONE READ, ONE COUNT. The boot payload carries the whole set (≤1000, the
// same GET /api/org/buildings answer the Workspace reads), and the search box
// and type select filter it in the browser. The header count always
// describes the whole set, never the filtered view — the shelf's rule.
//
// The page literal below contains exactly ONE backtick, its own opener, and
// interpolates exactly two values, the boot JSON and FILTER_AT. A stray backtick in
// it closes the page early and ships a page that renders and does nothing;
// test/buildings-page.test.js guards both.
// ---------------------------------------------------------------------------

// A filter box over three rows is furniture. Six is the firm shelf's number
// for the same question, and it is the shelf's search box this page copies.
const FILTER_AT = 6;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function renderBuildingsBody(boot) {
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<style>
.bl-page,.bl-page *{box-sizing:border-box}
.bl-page{margin:24px 0 48px}
.bl-page .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.bl-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  border-bottom:1.5px solid var(--ink);padding-bottom:6px;margin-bottom:10px}
.bl-head h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:24px;color:var(--ink)}
.bl-count{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bl-sub{font-size:13px;color:var(--ink-2);margin:0 0 14px}
.bl-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 12px}
.bl-tools input,.bl-tools select{font:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--edge);
  border-radius:8px;background:var(--card);color:var(--ink)}
.bl-tools input{flex:1 1 220px;min-width:0}
.bl-shown{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.bl-row{display:flex;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1px solid var(--hair);font-size:13.5px}
.bl-row:last-child{border-bottom:0}
.bl-addr{flex:1 1 auto;min-width:0;color:var(--ink);font-family:Georgia,"Times New Roman",serif;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bl-meta{flex:0 0 auto;font-size:11px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bl-rm{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:11px;color:var(--ink-3);
  text-decoration:underline;cursor:pointer}
.bl-rm:hover{color:var(--red)}
.bl-note{font-size:12.5px;color:var(--ink-3);margin:10px 0 0}
.bl-msg{font-size:13px;color:var(--ink-2);margin:10px 0 0}
.bl-msg.bad{color:var(--err-text)}
.bl-wall{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:18px 20px;margin:18px 0}
.bl-wall p{margin:0 0 8px;font-size:14px;color:var(--ink-body)}
.bl-wall a{color:var(--red);text-decoration:underline}
.hide{display:none}
</style>
<main class="wrap bl-page">
  <div class="kicker">Your firm</div>
  <div class="bl-head">
    <h1 id="blTitle">Buildings</h1>
    <span class="bl-count" id="blCount"></span>
  </div>
  <p class="bl-sub" id="blSub">The buildings your firm works on, shared with everyone in it. Add one from the <a href="/desk">Workspace</a>, from a property in your <a href="/vault">Vault</a>, or from a report on the shelf.</p>
  <div class="bl-wall hide" id="blWall"></div>
  <div class="bl-tools hide" id="blTools">
    <input type="search" id="blSearch" placeholder="Search by address, market or type" aria-label="Search your firm's buildings" autocomplete="off"/>
    <select id="blType" aria-label="Filter by property type"><option value="">All types</option></select>
    <span class="bl-shown" id="blShown"></span>
  </div>
  <div id="blRows"></div>
  <p class="bl-note hide" id="blNone">No buildings match. <button type="button" class="bl-rm" id="blClear">Clear filters</button></p>
  <p class="bl-note hide" id="blEmpty">No buildings yet. Add one from the Workspace, from a property in your Vault, or from a report on the shelf.</p>
  <p class="bl-note hide" id="blTrunc">Showing the 1,000 most recently touched buildings. Older ones are not in this list.</p>
  <p class="bl-msg hide" id="blMsg" aria-live="polite"></p>
</main>
<script>
(function(){
  var BOOT = ${bootJson};
  var FILTER_AT = ${FILTER_AT};
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  var firm=null,items=[],truncated=false,summary="";

  // The three refusals, each its own sentence: a signed-out reader is told to
  // sign in, a member of no firm is told what a firm is, and an outage is
  // reported as an outage — never as an empty list.
  function wall(html){
    var w=$("blWall"); w.innerHTML=html; w.className="bl-wall";
    $("blTools").className="bl-tools hide"; $("blRows").innerHTML="";
    $("blEmpty").className="bl-note hide"; $("blNone").className="bl-note hide"; $("blTrunc").className="bl-note hide";
    $("blCount").textContent="";
  }
  function apply(o){
    if(!o||o.s===503){ wall("<p>Couldn't load your firm's buildings just now. Nothing has been lost. Refresh in a moment.</p>"); return; }
    if(o.s===401){ wall('<p>Sign in to see your firm\\u2019s buildings.</p><p><a href="/?auth=signin">Sign in</a></p>'); return; }
    if(o.s!==200||!o.j){ wall('<p>Buildings belong to a firm, and this account is not in one yet.</p><p><a href="/desk">Create a firm or accept an invitation on the Workspace</a>.</p>'); return; }
    $("blWall").className="bl-wall hide";
    firm=o.j.firm||null; items=Array.isArray(o.j.buildings)?o.j.buildings:[];
    truncated=Boolean(o.j.truncated); summary=o.j.summary||"";
    $("blTitle").textContent=firm&&firm.name?firm.name+"\\u2019s buildings":"Buildings";
    fillTypes();
    render();
  }
  function fillTypes(){
    var sel=$("blType"),cur=sel.value,seen={},opts='<option value="">All types</option>';
    items.forEach(function(b){ if(b.type&&!seen[b.type]){seen[b.type]=1; opts+='<option value="'+esc(b.type)+'"'+(b.type===cur?" selected":"")+'>'+esc(b.type)+"</option>";} });
    sel.innerHTML=opts;
  }
  function terms(){ return $("blSearch").value.toLowerCase().split(/\\s+/).filter(Boolean); }
  function matches(b,q,t){
    if(t&&b.type!==t)return false;
    if(!q.length)return true;
    var hay=[b.address,b.market,b.type].join(" ").toLowerCase();
    return q.every(function(w){return hay.indexOf(w)>=0});
  }
  function meta(b){
    var bits=[];
    if(b.type)bits.push(b.type);
    if(b.market)bits.push(b.market);
    if(b.sizeSqft)bits.push(Number(b.sizeSqft).toLocaleString("en-US")+" SF");
    if(b.yearBuilt)bits.push("built "+b.yearBuilt);
    bits.push(b.mine?"added by you":(b.addedBy?"added by "+b.addedBy:"added by a colleague"));
    return bits.join(" \\u00b7 ");
  }
  function render(){
    // The header count is the WHOLE set's line, whatever the filter shows.
    $("blCount").textContent=summary;
    $("blTrunc").className=truncated?"bl-note":"bl-note hide";
    $("blEmpty").className=items.length?"bl-note hide":"bl-note";
    // The search box appears only once there is enough to need one.
    $("blTools").className=items.length>=FILTER_AT?"bl-tools":"bl-tools hide";
    var q=terms(),t=$("blType").value;
    var shown=items.filter(function(b){return matches(b,q,t)});
    var filtering=Boolean(q.length||t);
    $("blShown").textContent=filtering?shown.length+" of "+items.length:"";
    $("blNone").className=(items.length&&!shown.length)?"bl-note":"bl-note hide";
    $("blRows").innerHTML=shown.map(function(b){
      return '<div class="bl-row"><span class="bl-addr">'+esc(b.address)+'</span>'+
        '<span class="bl-meta">'+esc(meta(b))+'</span>'+
        '<button type="button" class="bl-rm" data-rm="'+esc(b.id)+'" data-addr="'+esc(b.address)+'">Remove</button></div>';
    }).join("");
  }
  function msg(text,bad){ var el=$("blMsg"); el.textContent=text||""; el.className="bl-msg"+(bad?" bad":"")+(text?"":" hide"); }
  function reload(){
    if(!firm)return;
    fetch("/api/org/buildings?id="+encodeURIComponent(firm.id),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s===200){ o.j.firm=firm; apply(o); } })
      .catch(function(){});
  }
  $("blSearch").addEventListener("input",render);
  $("blType").addEventListener("change",render);
  $("blClear").addEventListener("click",function(){ $("blSearch").value=""; $("blType").value=""; render(); });
  $("blRows").addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("button[data-rm]"):null; if(!b||!firm)return;
    // No confirm: removing a building from the index is undone by adding it
    // again — the Workspace's rule for the same control.
    b.disabled=true;
    fetch("/api/org/buildings?id="+encodeURIComponent(firm.id)+"&building="+encodeURIComponent(b.getAttribute("data-rm")),
      {method:"DELETE",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){ b.disabled=false; msg(o.j.error||"That didn't go through.",true); return; }
        msg("Removed "+b.getAttribute("data-addr")+".");
        reload();
      })
      .catch(function(){ b.disabled=false; msg("That didn't reach the server. Nothing was changed.",true); });
  });
  apply(BOOT);
})();
</script>`;
}

module.exports = { renderBuildingsBody, FILTER_AT };
