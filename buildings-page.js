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
.bl-crit{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:12px 16px;margin:0 0 18px}
.bl-crit .kicker{margin:0 0 6px}
.bl-crit-row{display:flex;align-items:baseline;gap:10px;padding:5px 0;border-bottom:1px solid var(--hair);font-size:13px}
.bl-crit-row:last-child{border-bottom:0}
.bl-crit-row .d{flex:0 0 7.5rem;font-variant-numeric:tabular-nums;color:var(--ink);font-weight:600}
.bl-crit-row .d.soon{color:var(--red)}
.bl-crit-row .k{flex:0 0 4.5rem;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.bl-crit-row .t{flex:1 1 auto;min-width:0;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bl-crit-row .t a{color:var(--ink);text-decoration:underline}
.bl-crit-row .m{flex:0 0 auto;font-size:11px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
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
  <!-- Critical dates (slice 6): the firm's leases with a date to act on in
       the next twelve months, soonest first, the earlier of option notice
       and expiry. Rendered only when there is one — a strip announcing "no
       deadlines" would be furniture. Display only; nothing here mails. -->
  <div class="bl-crit hide" id="blCrit">
    <div class="kicker">Critical dates \u00b7 next 12 months</div>
    <div id="blCritRows"></div>
  </div>
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
    renderCritical(Array.isArray(o.j.critical)?o.j.critical:[]);
    fillTypes();
    render();
  }
  function renderCritical(list){
    var box=$("blCrit");
    if(!list.length){ box.className="bl-crit hide"; $("blCritRows").innerHTML=""; return; }
    box.className="bl-crit";
    $("blCritRows").innerHTML=list.map(function(c){
      var when=c.days===0?"today":c.days===1?"tomorrow":"in "+c.days+" days";
      return '<div class="bl-crit-row"><span class="d'+(c.days<=30?" soon":"")+'">'+esc(when)+'</span>'+
        '<span class="k">'+(c.kind==="notice"?"notice":"expiry")+'</span>'+
        '<span class="t">'+esc(c.tenant)+(c.suite?" \u00b7 "+esc(c.suite):"")+' \u00b7 <a href="/building/'+esc(encodeURIComponent(c.buildingId))+'">'+esc(c.address||"building")+'</a></span>'+
        '<span class="m">'+esc(c.date)+"</span></div>";
    }).join("");
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
      return '<div class="bl-row"><a class="bl-addr" href="/building/'+esc(encodeURIComponent(b.id))+'">'+esc(b.address)+'</a>'+
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

// ---------------------------------------------------------------------------
// /building/<id> — one building's sheet (Three Spaces, slice 5).
//
// The same body pattern as the list above, and the same single-value boot:
// server.js composes everything through org-buildings.js's composeSheet and
// this file only draws it. Every composed row is read-only and attributed;
// the only editable things are the building's three descriptive fields and
// the notes. The "spreadsheet" convention is /vault's: a formatted figure for
// reading, the raw value on data-raw, swapped in on focus, saved on blur.
//
// This literal too contains exactly ONE backtick and interpolates the boot
// JSON alone; test/buildings-page.test.js guards both.
// ---------------------------------------------------------------------------
function renderBuildingSheetBody(boot) {
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<style>
.bs-page,.bs-page *{box-sizing:border-box}
.bs-page{margin:24px 0 48px}
.bs-page .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.bs-page .kicker a{color:var(--ink-3)}
.bs-head{border-bottom:1.5px solid var(--ink);padding-bottom:8px;margin-bottom:6px}
.bs-head h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:26px;color:var(--ink)}
.bs-sub{font-size:12.5px;color:var(--ink-3);margin:0 0 18px}
.bs-id{display:flex;flex-wrap:wrap;gap:14px 28px;margin:0 0 22px}
.bs-id label{display:flex;flex-direction:column;gap:4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.bs-id input,.bs-id select{font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--edge);border-radius:6px;
  background:var(--card);color:var(--ink);min-width:9rem}
.bs-id .ro{font-size:14px;color:var(--ink);padding:6px 0;text-transform:none;letter-spacing:0}
.bs-sec{margin:0 0 26px}
.bs-rule{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  border-bottom:1.5px solid var(--ink);padding-bottom:4px;margin-bottom:6px}
.bs-rule .lab{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink);font-weight:600}
.bs-rule .n{font-size:11.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.bs-row{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-bottom:1px solid var(--hair);font-size:13px}
.bs-row:last-child{border-bottom:0}
.bs-row .a{flex:1 1 auto;min-width:0;color:var(--ink)}
.bs-row .m{flex:0 0 auto;font-size:11px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.bs-row .fig{font-variant-numeric:tabular-nums;color:var(--ink)}
.bs-note{font-size:12.5px;color:var(--ink-3);margin:6px 0 0}
.bs-lnk{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:11px;color:var(--ink-3);text-decoration:underline;cursor:pointer}
.bs-lnk:hover{color:var(--red)}
.bs-lnk.on{color:var(--ok-text);text-decoration:none}
.bs-notes .body{white-space:pre-wrap;font-size:13.5px;color:var(--ink-body);margin:0}
.bs-lease{display:grid;grid-template-columns:repeat(auto-fill,minmax(9rem,1fr));gap:8px 12px;margin:10px 0 12px}
.bs-lease label{display:flex;flex-direction:column;gap:3px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.bs-lease input,.bs-lease select{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--edge);border-radius:6px;background:var(--card);color:var(--ink);min-width:0}
.bs-lease .wide{grid-column:1/-1}
.bs-lease-act{display:flex;gap:10px;align-items:center;margin:0 0 12px}
.bs-attach{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0 12px}
.bs-attach select{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--edge);border-radius:6px;background:var(--card);color:var(--ink);min-width:0;flex:1 1 14rem;max-width:26rem}
.bs-row .st{font:inherit;font-size:11px;padding:2px 4px;border:1px solid var(--edge);border-radius:4px;background:var(--card);color:var(--ink)}
.bs-row .due{color:var(--red)}
.bs-notes form{display:flex;flex-direction:column;gap:8px;margin:10px 0 14px}
.bs-notes textarea{font:inherit;font-size:13.5px;padding:8px 10px;border:1px solid var(--edge);border-radius:8px;
  background:var(--card);color:var(--ink);min-height:64px;resize:vertical}
.bs-btn{appearance:none;align-self:flex-start;border:0;border-radius:8px;padding:7px 12px;font:inherit;font-size:13px;font-weight:600;
  color:#fff;background:var(--red-fill);cursor:pointer}
.bs-btn:hover{background:var(--red-fill-hover)}
.bs-msg{font-size:13px;color:var(--ink-2);margin:8px 0 0}
.bs-msg.bad{color:var(--err-text)}
.bs-wall{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:18px 20px;margin:18px 0}
.bs-wall p{margin:0 0 8px;font-size:14px;color:var(--ink-body)}
.bs-wall a{color:var(--red);text-decoration:underline}
.hide{display:none}
</style>
<main class="wrap bs-page">
  <div class="kicker"><a href="/desk">Your firm</a> \u00b7 <a href="/buildings">Buildings</a></div>
  <div class="bs-wall hide" id="bsWall"></div>
  <div id="bsSheet" class="hide">
    <div class="bs-head" id="bsHead"><h1 id="bsAddr"></h1></div>
    <p class="bs-sub" id="bsSub"></p>
    <div class="bs-id">
      <label>Type <select id="bsType"><option value="">Any type</option><option>Industrial</option><option>Office</option><option>Retail</option><option>Multifamily</option><option>Land</option><option>Residential</option></select></label>
      <label>Size (SF) <input id="bsSize" type="text" inputmode="numeric" placeholder="12,500"/></label>
      <label>Year built <input id="bsYear" type="text" inputmode="numeric" placeholder="1994"/></label>
      <label>Market <span class="ro" id="bsMarket"></span></label>
    </div>
    <p class="bs-msg hide" id="bsMsg" aria-live="polite"></p>

    <section class="bs-sec" id="bsTxFirm">
      <div class="bs-rule"><span class="lab">Transactions \u00b7 the firm\u2019s</span><span class="n" id="bsTxFirmN"></span></div>
      <div id="bsTxFirmRows"></div>
      <p class="bs-note hide" id="bsTxFirmNone">No colleague has shared a comp on this building yet.</p>
    </section>

    <section class="bs-sec" id="bsTxMine">
      <div class="bs-rule"><span class="lab">Transactions \u00b7 yours</span><span class="n" id="bsTxMineN"></span></div>
      <div id="bsTxMineRows"></div>
      <p class="bs-note hide" id="bsTxMineNone">Nothing in your vault on this building. Comps you add to your vault at this address show up here, and you can share each one with the firm from here.</p>
    </section>

    <section class="bs-sec" id="bsReports">
      <div class="bs-rule"><span class="lab">Reports</span><span class="n" id="bsReportsN"></span></div>
      <div id="bsReportsRows"></div>
      <p class="bs-note hide" id="bsReportsNone">No report on the firm\u2019s shelf is about this building yet.</p>
    </section>

    <section class="bs-sec" id="bsValues">
      <div class="bs-rule"><span class="lab">Valuations</span><span class="n" id="bsValuesN"></span></div>
      <div id="bsValuesRows"></div>
      <p class="bs-note hide" id="bsValuesNone">No valuation yet \u2014 your own portfolio checks and the firm\u2019s shared reports land here. A colleague\u2019s portfolio never does.</p>
    </section>

    <section class="bs-sec" id="bsLeases">
      <div class="bs-rule"><span class="lab">Leases</span><span class="n" id="bsLeasesN"></span></div>
      <div id="bsLeasesRows"></div>
      <p class="bs-note hide" id="bsLeasesNone">No lease on this building yet. A lease the firm holds or manages goes here \u2014 the tenant, the term, and the option notice, which is the date that matters.</p>
      <form id="bsLeaseForm" class="bs-lease hide">
        <input type="hidden" id="bsLeaseId" value=""/>
        <label>Tenant <input id="bsLeaseTenant" type="text" maxlength="120" required/></label>
        <label>Suite <input id="bsLeaseSuite" type="text" maxlength="40"/></label>
        <label>Size (SF) <input id="bsLeaseSize" type="text" inputmode="numeric"/></label>
        <label>Term start <input id="bsLeaseStart" type="date"/></label>
        <label>Lease expiry <input id="bsLeaseExpiry" type="date" required/></label>
        <label>Option notice <input id="bsLeaseNotice" type="date"/></label>
        <label>Rent $/SF <input id="bsLeaseRent" type="text" inputmode="decimal"/></label>
        <label>Rent basis <select id="bsLeaseBasis"><option value="">\u2014</option><option value="annual">annual</option><option value="monthly">monthly</option></select></label>
        <label>Lease type <select id="bsLeaseType"><option value="">\u2014</option><option>NNN</option><option>FS</option><option>MG</option></select></label>
        <label>Status <select id="bsLeaseStatus"><option>active</option><option>month-to-month</option><option>renewed</option><option>expired</option><option>vacated</option></select></label>
        <label class="wide">Notes <input id="bsLeaseNotes" type="text" maxlength="2000"/></label>
        <div class="wide bs-lease-act"><button type="submit" class="bs-btn" id="bsLeaseSave">Save lease</button><button type="button" class="bs-lnk" id="bsLeaseCancel">Cancel</button></div>
      </form>
      <p class="bs-lease-act"><button type="button" class="bs-lnk" id="bsLeaseAdd">Add a lease</button></p>
    </section>

    <section class="bs-sec" id="bsContacts">
      <div class="bs-rule"><span class="lab">Contacts</span><span class="n" id="bsContactsN"></span></div>
      <div id="bsContactsRows"></div>
      <p class="bs-note hide" id="bsContactsNone">No contact is attached to this building yet. Attach one from the firm\u2019s list \u2014 a contact whose company holds a lease here is offered first.</p>
      <!-- The attach door (2026-09-02). The firm's list is read when the
           door is opened, not with the sheet: a sheet is opened far more
           often than a contact is attached. Contacts already attached here
           are left out; those whose company matches a lease's tenant on this
           building are grouped first, which is the "tenant info" the
           building is meant to hold. Ships closed. -->
      <form id="bsAttachForm" class="bs-attach hide">
        <select id="bsAttachPick" aria-label="A contact to attach"><option value="">Choose a contact</option></select>
        <button type="submit" class="bs-btn" id="bsAttachSave">Attach</button>
        <button type="button" class="bs-lnk" id="bsAttachCancel">Cancel</button>
      </form>
      <p class="bs-lease-act"><button type="button" class="bs-lnk" id="bsAttachAdd">Attach a contact</button></p>
    </section>

    <section class="bs-sec bs-notes" id="bsNotes">
      <div class="bs-rule"><span class="lab">Notes</span><span class="n" id="bsNotesN"></span></div>
      <form id="bsNoteForm">
        <textarea id="bsNoteBody" maxlength="2000" placeholder="Something the next colleague to open this building should know"></textarea>
        <button type="submit" class="bs-btn">Add note</button>
      </form>
      <div id="bsNotesRows"></div>
      <p class="bs-note hide" id="bsNotesNone">No notes yet. Everyone at the firm reads what is written here, with the writer\u2019s name on it.</p>
    </section>
  </div>
</main>
<script>
(function(){
  var BOOT = ${bootJson};
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  var money=function(n){return n==null?"":"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:0})};
  var num=function(n){return n==null?"":Number(n).toLocaleString("en-US",{maximumFractionDigits:0})};
  var when=function(ts){
    if(!ts)return "";
    var m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(ts));
    var d=m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3])):new Date(ts);
    return isNaN(d)?String(ts).slice(0,10):d.toLocaleDateString();
  };
  var org=null,sheet=null,building=null;

  function wall(html){
    var w=$("bsWall"); w.innerHTML=html; w.className="bs-wall"; $("bsSheet").className="hide";
  }
  function apply(o){
    if(!o||o.s===503){ wall("<p>Couldn't load this building just now. Nothing has been lost. Refresh in a moment.</p>"); return; }
    if(o.s===401){ wall('<p>Sign in to see this building.</p><p><a href="/?auth=signin">Sign in</a></p>'); return; }
    if(o.s===404){ wall('<p>That building is not on your firm\u2019s list \u2014 it may have been removed, or it belongs to another firm.</p><p><a href="/buildings">Back to your firm\u2019s buildings</a></p>'); return; }
    if(o.s!==200||!o.j||!o.j.building){ wall('<p>Buildings belong to a firm, and this account is not in one yet.</p><p><a href="/desk">Create a firm or accept an invitation on the Workspace</a>.</p>'); return; }
    $("bsWall").className="bs-wall hide"; $("bsSheet").className="";
    org=o.j.org||null; sheet=o.j; building=o.j.building;
    render();
  }
  function msg(text,bad){ var el=$("bsMsg"); el.textContent=text||""; el.className="bs-msg"+(bad?" bad":"")+(text?"":" hide"); }
  function count(id,n,word){ $(id).textContent=n?n+" "+(n===1?word:word+"s"):""; }
  function none(id,show){ $(id).className=show?"bs-note":"bs-note hide"; }

  function render(){
    var b=building;
    $("bsAddr").textContent=b.address;
    $("bsSub").innerHTML=esc([org&&org.name?org.name+"\u2019s board":"",b.mine?"added by you":(b.addedBy?"added by "+b.addedBy:"")].filter(Boolean).join(" \u00b7 "))+
      ' \u00b7 <a href="/messages?say='+esc(encodeURIComponent("About "+b.address+": "+((typeof location!=="undefined"&&location.origin)||"")+"/building/"+b.id))+'">Discuss this building</a>';
    $("bsType").value=b.type||"";
    // /vault's cell convention: the formatted figure for reading, the raw one
    // on data-raw and swapped in on focus, the server's normalized value put
    // back after a save.
    $("bsSize").value=b.sizeSqft?num(b.sizeSqft):""; $("bsSize").setAttribute("data-raw",b.sizeSqft==null?"":String(b.sizeSqft));
    $("bsYear").value=b.yearBuilt?String(b.yearBuilt):""; $("bsYear").setAttribute("data-raw",b.yearBuilt==null?"":String(b.yearBuilt));
    $("bsMarket").textContent=b.market||"\u2014";

    var firm=sheet.firmComps||[];
    count("bsTxFirmN",firm.length,"comp"); none("bsTxFirmNone",!firm.length);
    $("bsTxFirmRows").innerHTML=firm.map(function(c){
      return '<div class="bs-row"><span class="a">'+esc(when(c.date)||"undated")+' \u00b7 '+esc(c.transaction||"")+
        (c.price!=null?' \u00b7 <span class="fig">'+esc(money(c.price))+"</span>":"")+
        (c.sizeSqft?' \u00b7 '+esc(num(c.sizeSqft))+" SF":"")+
        (c.pricePerSqft!=null?' \u00b7 $'+esc(Number(c.pricePerSqft).toFixed(2))+"/SF":"")+
        '</span><span class="m">shared by '+esc(c.sharedBy)+"</span></div>";
    }).join("");

    var mine=sheet.mineComps||[];
    count("bsTxMineN",mine.length,"comp"); none("bsTxMineNone",!mine.length);
    $("bsTxMineRows").innerHTML=mine.map(function(c){
      return '<div class="bs-row"><span class="a">'+esc(when(c.date)||"undated")+' \u00b7 '+esc(c.transaction||"")+
        (c.price!=null?' \u00b7 <span class="fig">'+esc(money(c.price))+"</span>":"")+
        (c.rentPsfYr!=null?' \u00b7 $'+esc(Number(c.rentPsfYr).toFixed(2))+"/SF/yr":"")+
        (c.sizeSqft?' \u00b7 '+esc(num(c.sizeSqft))+" SF":"")+
        (c.pricePerSqft!=null?' \u00b7 $'+esc(Number(c.pricePerSqft).toFixed(2))+"/SF":"")+
        '</span><span class="m">'+(c.published?"published \u00b7 ":"")+'from your vault \u00b7 '+
        '<button type="button" class="bs-lnk'+(c.shared?" on":"")+'" data-firm="'+esc(c.id)+'" data-on="'+(c.shared?"1":"0")+'">'+
        (c.shared?"Shared with the firm":"Share with the firm")+"</button></span></div>";
    }).join("");

    var reps=sheet.reports||[];
    count("bsReportsN",reps.length,"report"); none("bsReportsNone",!reps.length);
    $("bsReportsRows").innerHTML=reps.map(function(r){
      return '<div class="bs-row"><a class="a" href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.type||"Report")+" report</a>"+
        '<span class="m">'+(r.mine?"shared by you":"shared by "+esc(r.sharedBy))+(r.createdAt?" \u00b7 "+esc(when(r.createdAt)):"")+"</span></div>";
    }).join("");

    var vals=sheet.valuations||[];
    count("bsValuesN",vals.length,"valuation"); none("bsValuesNone",!vals.length);
    $("bsValuesRows").innerHTML=vals.map(function(v){
      var band=(v.low!=null&&v.high!=null)?esc(money(v.low))+" \u2013 "+esc(money(v.high)):"";
      return '<div class="bs-row"><span class="a"><span class="fig">'+esc(money(v.likely))+"</span> likely"+(band?" \u00b7 "+band:"")+"</span>"+
        '<span class="m">'+(v.source==="yours"?"your portfolio":"from "+(v.sharedBy?esc(v.sharedBy)+"\u2019s":"a colleague\u2019s")+" shared report")+
        (v.ts?" \u00b7 "+esc(when(v.ts)):"")+"</span></div>";
    }).join("");

    var leases=sheet.leases||[];
    count("bsLeasesN",leases.length,"lease"); none("bsLeasesNone",!leases.length);
    $("bsLeasesRows").innerHTML=leases.map(function(l){
      var bits=[];
      if(l.suite)bits.push("Suite "+l.suite);
      if(l.sizeSqft)bits.push(num(l.sizeSqft)+" SF");
      if(l.rentPsf!=null)bits.push("$"+Number(l.rentPsf).toFixed(2)+"/SF"+(l.rentBasis==="monthly"?"/mo":l.rentBasis==="annual"?"/yr":"")+(l.leaseType?" "+l.leaseType:""));
      if(l.leaseExpiry)bits.push("expires "+when(l.leaseExpiry));
      if(l.optionNoticeDate)bits.push('<span class="due">notice by '+esc(when(l.optionNoticeDate))+"</span>");
      return '<div class="bs-row"><span class="a"><span class="fig">'+esc(l.tenant)+"</span>"+(bits.length?" \u00b7 "+bits.map(function(b){return /^<span/.test(b)?b:esc(b)}).join(" \u00b7 "):"")+"</span>"+
        '<span class="m"><select class="st" data-lease-status="'+esc(l.id)+'">'+
        ["active","month-to-month","renewed","expired","vacated"].map(function(st){return '<option'+(st===l.status?" selected":"")+">"+st+"</option>"}).join("")+
        "</select> \u00b7 "+(l.mine?"you":esc(l.addedBy||"a colleague"))+
        ' \u00b7 <button type="button" class="bs-lnk" data-lease-edit="'+esc(l.id)+'">Edit</button>'+
        ' \u00b7 <button type="button" class="bs-lnk" data-lease-rm="'+esc(l.id)+'">Remove</button></span></div>';
    }).join("");

    var cons=sheet.contacts||[];
    count("bsContactsN",cons.length,"contact"); none("bsContactsNone",!cons.length);
    // A contact whose company holds a lease on this building is the tenant,
    // and the row says so — the lease record and the contact list meet here.
    var tenantCos={}; leases.forEach(function(l){ if(l.tenant)tenantCos[String(l.tenant).trim().toLowerCase()]=true; });
    $("bsContactsRows").innerHTML=cons.map(function(c){
      var isTenant=!!(c.company&&tenantCos[String(c.company).trim().toLowerCase()]);
      return '<div class="bs-row"><span class="a">'+esc(c.name)+(c.company?" \u00b7 "+esc(c.company):"")+(isTenant?" \u00b7 tenant":"")+(c.email?" \u00b7 "+esc(c.email):"")+"</span>"+
        '<span class="m">'+(c.mine?"added by you":(c.addedBy?"added by "+esc(c.addedBy):"added by a colleague"))+
        ' \u00b7 <button type="button" class="bs-lnk" data-contact-rm="'+esc(c.id)+'">Detach</button></span></div>';
    }).join("");

    var notes=sheet.notes||[];
    count("bsNotesN",notes.length,"note"); none("bsNotesNone",!notes.length);
    $("bsNotesRows").innerHTML=notes.map(function(n){
      return '<div class="bs-row"><p class="body a">'+esc(n.body)+"</p>"+
        '<span class="m">'+(n.mine?"you":esc(n.addedBy))+(n.createdAt?" \u00b7 "+esc(when(n.createdAt)):"")+
        (n.mine?' \u00b7 <button type="button" class="bs-lnk" data-note-rm="'+esc(n.id)+'">Remove</button>':"")+"</span></div>";
    }).join("");
  }

  function reload(){
    if(!org||!building)return Promise.resolve();
    return fetch("/api/org/buildings/sheet?id="+encodeURIComponent(org.id)+"&building="+encodeURIComponent(building.id),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ apply(o); })
      .catch(function(){});
  }

  // Identity cells: focus shows the raw figure, blur saves the whole edit.
  function saveIdentity(patch){
    if(!org||!building)return;
    fetch("/api/org/buildings?id="+encodeURIComponent(org.id)+"&building="+encodeURIComponent(building.id),{
      method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(patch)})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){ msg(o.j.error||"That didn't go through.",true); return; }
        msg("Saved."); building=o.j.building||building; render();
      })
      .catch(function(){ msg("That didn't reach the server. Nothing was changed.",true); });
  }
  $("bsType").addEventListener("change",function(){ saveIdentity({propertyType:$("bsType").value}); });
  ["bsSize","bsYear"].forEach(function(id){
    var el=$(id);
    el.addEventListener("focus",function(){ el.value=el.getAttribute("data-raw")||""; });
    el.addEventListener("blur",function(){
      var raw=el.getAttribute("data-raw")||"",v=el.value.trim();
      if(v===raw){ render(); return; }
      saveIdentity(id==="bsSize"?{sizeSqft:v}:{yearBuilt:v});
    });
    el.addEventListener("keydown",function(e){ if(e.key==="Enter"){e.preventDefault();el.blur();} if(e.key==="Escape"){el.value=el.getAttribute("data-raw")||"";el.blur();} });
  });

  // The firm-share toggle on your own comps: the SAME route /vault's toggle
  // posts to, one comp per click, taking it back needs no confirm.
  $("bsTxMineRows").addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("button[data-firm]"):null; if(!b||!org)return;
    var on=b.getAttribute("data-on")==="1",id=b.getAttribute("data-firm");
    if(!on&&!confirm("Share this comp with "+org.name+"?\\n\\nColleagues at your firm will see it inside their own reports, with your name on it. It does NOT go into CompNinja's public records, it is left out of every download and client link, and you can take it back at any time."))return;
    b.disabled=true;
    fetch("/api/vault/firm",{method:on?"DELETE":"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
      body:JSON.stringify({orgId:org.id,compIds:[id]})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){b.disabled=false;msg(o.j.error||"That didn't go through.",true);return;} reload(); })
      .catch(function(){ b.disabled=false; msg("That didn't go through.",true); });
  });

  // Leases (slice 6). One form for add and edit: the hidden id decides which
  // route the save takes. Every refusal is org-leases.js's and is shown by
  // name — a notice after the expiry is the one this form most invites.
  function leaseForm(open,l){
    var f=$("bsLeaseForm"); f.className=open?"bs-lease":"bs-lease hide";
    $("bsLeaseAdd").className=open?"bs-lnk hide":"bs-lnk";
    if(!open)return;
    l=l||{};
    $("bsLeaseId").value=l.id||""; $("bsLeaseTenant").value=l.tenant||""; $("bsLeaseSuite").value=l.suite||"";
    $("bsLeaseSize").value=l.sizeSqft?String(l.sizeSqft):""; $("bsLeaseStart").value=l.termStart||"";
    $("bsLeaseExpiry").value=l.leaseExpiry||""; $("bsLeaseNotice").value=l.optionNoticeDate||"";
    $("bsLeaseRent").value=l.rentPsf!=null?String(l.rentPsf):""; $("bsLeaseBasis").value=l.rentBasis||"";
    $("bsLeaseType").value=l.leaseType||""; $("bsLeaseStatus").value=l.status||"active"; $("bsLeaseNotes").value=l.notes||"";
    $("bsLeaseSave").textContent=l.id?"Save changes":"Save lease";
  }
  function leaseBody(){
    return { tenant:$("bsLeaseTenant").value, suite:$("bsLeaseSuite").value, sizeSqft:$("bsLeaseSize").value,
      termStart:$("bsLeaseStart").value, leaseExpiry:$("bsLeaseExpiry").value, optionNoticeDate:$("bsLeaseNotice").value,
      rentPsf:$("bsLeaseRent").value, rentBasis:$("bsLeaseBasis").value, leaseType:$("bsLeaseType").value,
      status:$("bsLeaseStatus").value, notes:$("bsLeaseNotes").value };
  }
  function leaseUrl(leaseId){
    return "/api/org/leases?id="+encodeURIComponent(org.id)+"&building="+encodeURIComponent(building.id)+(leaseId?"&lease="+encodeURIComponent(leaseId):"");
  }
  $("bsLeaseAdd").addEventListener("click",function(){ leaseForm(true,null); });
  $("bsLeaseCancel").addEventListener("click",function(){ leaseForm(false); });
  $("bsLeaseForm").addEventListener("submit",function(e){
    e.preventDefault();
    if(!org||!building)return;
    var id=$("bsLeaseId").value;
    fetch(leaseUrl(id),{method:id?"PATCH":"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(leaseBody())})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){msg(o.j.error||"That didn't go through.",true);return;} msg(id?"Lease saved.":"Lease added."); leaseForm(false); reload(); })
      .catch(function(){ msg("That didn't reach the server. Nothing was changed.",true); });
  });
  $("bsLeasesRows").addEventListener("click",function(e){
    var t=e.target;
    var ed=t&&t.closest?t.closest("button[data-lease-edit]"):null;
    if(ed){ var l=(sheet.leases||[]).filter(function(x){return String(x.id)===ed.getAttribute("data-lease-edit")})[0]; if(l)leaseForm(true,l); return; }
    var rm=t&&t.closest?t.closest("button[data-lease-rm]"):null;
    if(!rm||!org)return;
    if(!confirm("Remove this lease from the firm\u2019s record?"))return;
    rm.disabled=true;
    fetch(leaseUrl(rm.getAttribute("data-lease-rm")),{method:"DELETE",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){rm.disabled=false;msg(o.j.error||"That didn't go through.",true);return;} msg("Lease removed."); reload(); })
      .catch(function(){ rm.disabled=false; msg("That didn't go through.",true); });
  });
  // The status select saves on change: a status is the one field that
  // changes on its own timetable, and a form for one word is a chore.
  $("bsLeasesRows").addEventListener("change",function(e){
    var sel=e.target&&e.target.closest?e.target.closest("select[data-lease-status]"):null; if(!sel||!org)return;
    fetch(leaseUrl(sel.getAttribute("data-lease-status")),{method:"PATCH",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({status:sel.value})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){msg(o.j.error||"That didn't go through.",true);reload();return;} msg("Saved."); reload(); })
      .catch(function(){ msg("That didn't reach the server. Nothing was changed.",true); });
  });

  $("bsNoteForm").addEventListener("submit",function(e){
    e.preventDefault();
    if(!org||!building)return;
    var body=$("bsNoteBody").value;
    fetch("/api/org/buildings/notes?id="+encodeURIComponent(org.id)+"&building="+encodeURIComponent(building.id),{
      method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({body:body})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){msg(o.j.error||"That didn't go through.",true);return;} $("bsNoteBody").value=""; msg(""); reload(); })
      .catch(function(){ msg("That didn't reach the server. Nothing was changed.",true); });
  });
  $("bsNotesRows").addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("button[data-note-rm]"):null; if(!b||!org)return;
    b.disabled=true;
    fetch("/api/org/buildings/notes?id="+encodeURIComponent(org.id)+"&building="+encodeURIComponent(building.id)+"&note="+encodeURIComponent(b.getAttribute("data-note-rm")),
      {method:"DELETE",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){b.disabled=false;msg(o.j.error||"That didn't go through.",true);return;} reload(); })
      .catch(function(){ b.disabled=false; msg("That didn't go through.",true); });
  });

  // Contacts: attach from the firm's list, detach from this building.
  function contactUrl(contactId){
    return "/api/org/buildings/contacts?id="+encodeURIComponent(org.id)+"&building="+encodeURIComponent(building.id)+"&contact="+encodeURIComponent(contactId);
  }
  function attachForm(open){ $("bsAttachForm").className="bs-attach"+(open?"":" hide"); $("bsAttachAdd").className="bs-lnk"+(open?" hide":""); }
  $("bsAttachAdd").addEventListener("click",function(){
    if(!org||!building)return;
    fetch("/api/org/contacts?id="+encodeURIComponent(org.id),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){msg((o.j&&o.j.error)||"Couldn\u2019t load the firm\u2019s contacts.",true);return;}
        var here={}; (sheet.contacts||[]).forEach(function(c){here[String(c.id)]=true});
        var tenants={}; (sheet.leases||[]).forEach(function(l){ if(l.tenant)tenants[String(l.tenant).trim().toLowerCase()]=true; });
        var all=(o.j.contacts||[]).filter(function(c){return !here[String(c.id)]});
        var likely=all.filter(function(c){return !!(c.company&&tenants[String(c.company).trim().toLowerCase()])});
        var rest=all.filter(function(c){return likely.indexOf(c)<0});
        if(!all.length){ msg(o.j.contacts&&o.j.contacts.length?"Every contact on the firm\u2019s list is already attached here.":"The firm\u2019s contact list is empty. Add contacts on the Workspace first.",true); return; }
        var opt=function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name+(c.company?" \u00b7 "+c.company:""))+"</option>"};
        $("bsAttachPick").innerHTML='<option value="">Choose a contact</option>'+
          (likely.length?'<optgroup label="Tenants on this building\u2019s leases">'+likely.map(opt).join("")+"</optgroup>":"")+
          (rest.length?(likely.length?'<optgroup label="Everyone else">':"")+rest.map(opt).join("")+(likely.length?"</optgroup>":""):"");
        msg(""); attachForm(true);
      })
      .catch(function(){ msg("That didn\u2019t reach the server.",true); });
  });
  $("bsAttachCancel").addEventListener("click",function(){ attachForm(false); });
  $("bsAttachForm").addEventListener("submit",function(e){
    e.preventDefault();
    if(!org||!building)return;
    var id=$("bsAttachPick").value; if(!id)return;
    fetch(contactUrl(id),{method:"POST",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){msg(o.j.error||"That didn\u2019t go through.",true);return;} msg(o.j.moved?"Attached \u2014 moved here from another building.":"Attached."); attachForm(false); reload(); })
      .catch(function(){ msg("That didn\u2019t reach the server. Nothing was changed.",true); });
  });
  $("bsContactsRows").addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("button[data-contact-rm]"):null; if(!b||!org)return;
    b.disabled=true;
    fetch(contactUrl(b.getAttribute("data-contact-rm")),{method:"DELETE",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){ if(o.s!==200){b.disabled=false;msg(o.j.error||"That didn\u2019t go through.",true);return;} msg("Detached. The contact stays on the firm\u2019s list."); reload(); })
      .catch(function(){ b.disabled=false; msg("That didn\u2019t go through.",true); });
  });

  apply(BOOT);
})();
</script>`;
}

module.exports = { renderBuildingsBody, renderBuildingSheetBody, FILTER_AT };
