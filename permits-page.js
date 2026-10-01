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
// ONE READ, FILTERED HERE. The boot carries the whole window (capped, and it
// says so), and the search box, property type, city and permit type filter
// it in the browser. The header count describes the whole window, never the
// filtered view — the shelf's rule.
//
// HONESTY (spec §7): the page names the cities it reads and when the sweep
// last ran, and says so when that run is more than a business day old. It
// never implies a city it does not read was checked.
//
// YOUR PERMITS (2026-09-27, owner's call). Above the public feed, a member's
// own tracked permits: add one by city and number (looked up on the city's
// portal as it is added, so a typo is caught on the spot), pick which of the
// five steps to hear about and how — email, CompNinja, or both — and read
// each permit's steps, status and history. The rules live in permit-watch.js;
// the boot carries them as `mine` beside the feed, read on its own so an
// unavailable section never costs the list. The page CLEARS the unread count
// with a POST once shown (a fetch, which instant-nav holds until the page is
// visible — CLAUDE.md rule 15), never in the server render.
//
// PROPERTY TYPE (2026-09-29, the owner's pick of Draft A): a menu in place of
// the old "Industrial only" box. Each filing arrives with its propertyType
// (permit-zoning.js owns the rule, read-time, nothing stored), the menu shows
// each type's count for the window, and a type with nothing in it says so in
// words rather than as a bare "no match".
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
.pt-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  border-bottom:1.5px solid var(--ink);padding-bottom:6px;margin-bottom:10px}
.pt-head h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:24px;color:var(--ink)}
.pt-count{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.pt-sub{font-size:13px;color:var(--ink-2);margin:0 0 14px}
.pt-sub.stale{color:var(--err-text)}
.pt-strip{display:flex;border:1px solid var(--edge);border-radius:8px;background:var(--card);margin:0 0 16px}
.pt-cell{flex:1 1 0;padding:10px 14px;border-right:1px solid var(--hair);min-width:0}
.pt-cell:last-child{border-right:0}
.pt-cell .n{font-family:Georgia,"Times New Roman",serif;font-size:22px;color:var(--ink);font-variant-numeric:tabular-nums}
.pt-cell .l{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.pt-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 12px}
.pt-tools input[type=search],.pt-tools select{font:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--edge);
  border-radius:8px;background:var(--card);color:var(--ink)}
.pt-tools input[type=search]{flex:1 1 220px;min-width:0}
.pt-tools label.chk{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-2);cursor:pointer}
.pt-shown{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.pt-row{display:flex;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--hair);font-size:13px}
.pt-row:last-child{border-bottom:0}
.pt-date{flex:0 0 6.5rem;font-variant-numeric:tabular-nums;color:var(--ink-3);font-size:12px}
.pt-main{flex:1 1 auto;min-width:0}
.pt-addr{color:var(--ink);font-family:Georgia,"Times New Roman",serif;font-size:14px}
.pt-meta{font-size:11.5px;color:var(--ink-3);margin-top:2px}
.pt-meta .ind{color:var(--ink-2);font-weight:600}
.pt-empty2{font-size:13px;color:var(--ink-2);margin:10px 0 0;padding:12px 14px;border:1px solid var(--hair);border-radius:8px;background:var(--wash)}
.pt-desc{font-size:11.5px;color:var(--ink-3);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pt-board{display:inline-block;margin-left:8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ok-text);text-decoration:none;font-family:inherit}
.pt-board:hover{text-decoration:underline}
.pt-num{flex:0 0 auto;font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.pt-num a{color:var(--red);text-decoration:none}
.pt-num a:hover{text-decoration:underline}
.pt-note{font-size:12.5px;color:var(--ink-3);margin:10px 0 0}
.pt-wall{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:18px 20px;margin:18px 0}
.pt-wall p{margin:0 0 8px;font-size:14px;color:var(--ink-body)}
.pt-wall a{color:var(--red);text-decoration:underline}
.pt-rm{appearance:none;border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--ink-3);text-decoration:underline;cursor:pointer}
.pt-head2{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:26px 0 6px}
.pt-head2 h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:18px;color:var(--ink)}
.pw{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:16px 18px;margin:0 0 8px}
.pw-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pw-head h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:18px;color:var(--ink)}
.pw-sub{font-size:13px;color:var(--ink-2);margin:4px 0 12px}
.pw-btn{appearance:none;font:inherit;font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid var(--edge);
  background:var(--card);color:var(--ink);cursor:pointer}
.pw-btn:hover{border-color:var(--ink)}
.pw-btn.pri{background:var(--red-fill);border-color:var(--red-fill);color:#fff}
.pw-btn.pri:hover{background:var(--red-fill-hover)}
.pw-btn[disabled]{opacity:.6;cursor:default}
.pw-form{border-top:1px solid var(--hair);padding-top:12px;margin:0 0 12px}
.pw-grid{display:flex;flex-wrap:wrap;gap:10px}
.pw-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ink-2);flex:1 1 160px;min-width:0}
.pw-grid input,.pw-grid select{font:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--edge);border-radius:8px;background:var(--card);color:var(--ink);min-width:0}
.pw-grid .opt{color:var(--ink-3)}
.pw-set{border:0;margin:12px 0 0;padding:0;min-width:0}
.pw-set legend{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);padding:0;margin:0 0 6px}
.pw-opts{display:flex;flex-wrap:wrap;gap:6px 16px}
.pw-set label.chk{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-body);cursor:pointer}
.pw-fine{font-size:12px;color:var(--ink-3);margin:6px 0 0}
.pw-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:14px}
.pw-msg{font-size:12.5px;color:var(--ink-2)}
.pw-msg.bad{color:var(--err-text)}
.pw-msg.ok{color:var(--ok-text)}
.pw-card{border-top:1px solid var(--hair);padding:12px 0}
.pw-card:first-child{border-top:0}
.pw-card.pw-focus{background:var(--wash);box-shadow:0 0 0 8px var(--wash);border-radius:2px}
.pw-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.pw-name{font-family:Georgia,"Times New Roman",serif;font-size:15px;color:var(--ink)}
.pw-new{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:9px;background:var(--red-fill);color:#fff;font-size:10.5px;font-weight:600;letter-spacing:.04em;vertical-align:2px}
.pw-meta{font-size:11.5px;color:var(--ink-3);margin-top:2px}
.pw-meta a{color:var(--red);text-decoration:none}
.pw-meta a:hover{text-decoration:underline}
.pw-status{font-size:12px;color:var(--ink-2);white-space:nowrap}
.pw-status.attention{color:var(--warn-text)}
.pw-status.ended{color:var(--err-text)}
.pw-steps{display:flex;list-style:none;margin:10px 0 6px;padding:0;gap:4px}
.pw-steps li{flex:1 1 0;min-width:0;font-size:11px;color:var(--ink-3);padding-top:8px;border-top:3px solid var(--hair);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pw-steps li.done{border-top-color:var(--ok-text);color:var(--ink-2)}
.pw-steps li.now{color:var(--ink);font-weight:600}
.pw-latest{font-size:12.5px;color:var(--ink-body);margin:6px 0 0}
.pw-latest.unread{background:var(--ok-bg);border-radius:6px;padding:6px 9px}
.pw-latest.unread.warn{background:var(--warn-bg)}
.pw-latest b{font-weight:600}
.pw-foot{font-size:11.5px;color:var(--ink-3);margin-top:6px}
.pw-foot .err{color:var(--warn-text)}
.pw-hist{margin-top:6px;font-size:12px;color:var(--ink-2)}
.pw-hist summary{cursor:pointer;color:var(--ink-3);font-size:11.5px}
.pw-hist ul{margin:6px 0 0;padding-left:18px}
.pw-hist li{margin:2px 0}
.pw-hist li.unread{font-weight:600;color:var(--ink)}
.pw-empty{font-size:13px;color:var(--ink-3);margin:0}
.pw-pro{font-size:13px;color:var(--ink-body);background:var(--wash);border-radius:8px;padding:10px 12px;margin:0 0 12px}
.pw-pro a{color:var(--red);text-decoration:none;font-weight:600}
.pw-pro a:hover{text-decoration:underline}
.pw-firm{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:9px;border:1px solid var(--edge);color:var(--ink-2);font-size:10.5px;letter-spacing:.02em;vertical-align:2px}
.pw-firm.muted{color:var(--ink-3);border-style:dashed}
@media (max-width:640px){.pt-row{flex-wrap:wrap}.pt-date{flex:1 1 100%}.pt-strip{flex-wrap:wrap}.pt-cell{flex:1 1 45%}
  .pw-steps li{font-size:10px}}
.pw-bulk textarea{display:block;width:100%;margin:10px 0 0;font:inherit;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;
  padding:8px 10px;border:1px solid var(--edge);border-radius:8px;background:var(--card);color:var(--ink);resize:vertical;min-height:110px}
.pw-bulk input[type=file]{font-size:12.5px;padding:6px 0;border:0;background:none}
.pw-review{margin:12px 0 0;font-size:12.5px;color:var(--ink-body)}
.pw-review ul,.pw-done ul{margin:4px 0 8px;padding-left:18px}
.pw-review li,.pw-done li{margin:2px 0}
.pw-review .why,.pw-done .why{color:var(--ink-3)}
.pw-review b,.pw-done b{font-weight:600}
.pw-done{font-size:12.5px;color:var(--ink-body);background:var(--ok-bg);border-radius:6px;padding:8px 10px;margin:0 0 10px}
.pw-done.warn{background:var(--warn-bg)}
.pw-btns{display:flex;gap:8px;flex-wrap:wrap}
.hide{display:none}
</style>
<main class="wrap pt-page">
  <div class="kicker">Tools</div>
  <div class="pt-head">
    <h1>Permit tracker</h1>
  </div>
  <section class="pw hide" id="pwSec" aria-labelledby="pwTitle">
    <div class="pw-head">
      <h2 id="pwTitle">Your permits</h2>
      <span class="pw-btns"><button type="button" class="pw-btn hide" id="pwBulkBtn">Add several</button><button type="button" class="pw-btn hide" id="pwAddBtn">Track a permit</button></span>
    </div>
    <p class="pw-sub" id="pwSub"></p>
    <p class="pw-pro hide" id="pwPro">Tracking a permit is part of CompNinja Pro: add a permit number, pick the steps you care about, and hear about them by email each weekday morning and here on CompNinja. <a href="/?pricing=1">See Pro →</a></p>
    <form class="pw-form hide" id="pwForm" novalidate>
      <div class="pw-grid">
        <label>City <select id="pwCity"></select></label>
        <label>Permit number <input id="pwNum" maxlength="40" autocomplete="off" placeholder="e.g. BLD26-02789"/></label>
        <label><span>Nickname <span class="opt">optional</span></span><input id="pwLabel" maxlength="80" autocomplete="off" placeholder="e.g. Federal Way warehouse"/></label>
      </div>
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
  <div class="pt-head2 hide" id="ptFeedHead">
    <h2>Every commercial filing</h2>
    <span class="pt-count" id="ptCount"></span>
  </div>
  <p class="pt-sub" id="ptSub"></p>
  <div class="pt-wall hide" id="ptWall"></div>
  <div id="ptBody" class="hide">
    <div class="pt-strip" id="ptStrip"></div>
    <div class="pt-tools">
      <input type="search" id="ptSearch" placeholder="Search address, applicant, contractor or description" aria-label="Search permits" autocomplete="off"/>
      <select id="ptProp" aria-label="Filter by property type"><option value="">All property types</option></select>
      <select id="ptCity" aria-label="Filter by city"><option value="">All cities</option></select>
      <select id="ptType" aria-label="Filter by permit type"><option value="">All permit types</option></select>
      <span class="pt-shown" id="ptShown"></span>
    </div>
    <div id="ptRows"></div>
    <p class="pt-empty2 hide" id="ptTypeNone"><span id="ptTypeNoneText"></span> <button type="button" class="pt-rm" id="ptTypeAll">Show every type</button></p>
    <p class="pt-note hide" id="ptNone">No permit matches. <button type="button" class="pt-rm" id="ptClear">Clear filters</button></p>
    <p class="pt-note hide" id="ptEmpty"></p>
    <p class="pt-note hide" id="ptTrunc"></p>
    <p class="pt-note">Public record, read from each city’s own permit portal on weekday mornings. A permit’s property type comes from how Ada County zones its parcel and what the permit says it is for. Industrial means the parcel is zoned industrial, or, where the county could not answer, the permit describes industrial work. Where the zoning allows several uses, the permit’s own words decide, and a permit that does not say is listed under Other.</p>
  </div>
</main>
<script>
(function(){
  var BOOT = ${bootJson};
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  var items=[], CITY_LINE="these cities", WIN=30;
  var PROP_TYPES=["Industrial","Office","Retail","Multifamily","Mixed use","Other"];
  function wall(html){ var w=$("ptWall"); w.innerHTML=html; w.className="pt-wall"; $("ptBody").className="hide"; $("ptFeedHead").className="pt-head2 hide"; }
  function day(iso){
    if(!iso)return "";
    var m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(iso));
    if(!m)return String(iso);
    return new Date(Number(m[1]),Number(m[2])-1,Number(m[3])).toLocaleDateString("en-US",{month:"short",day:"numeric"});
  }
  function ago(ts){
    var t=Date.parse(ts); if(isNaN(t))return "";
    var mins=Math.max(0,Math.round((Date.now()-t)/60000));
    if(mins<60)return mins<=1?"just now":mins+" minutes ago";
    var h=Math.round(mins/60); if(h<48)return h+(h===1?" hour ago":" hours ago");
    return Math.round(h/24)+" days ago";
  }
  function opts(sel,values){
    values.forEach(function(v){ var o=document.createElement("option"); o.value=v; o.textContent=v; sel.appendChild(o); });
  }
  function apply(o){
    if(!o||o.s===503){ wall("<p>Couldn\\u2019t load the permit tracker just now. Refresh in a moment.</p>"); return; }
    if(o.s===401){ wall('<p>Sign in to see the permit tracker.</p><p><a href="/?auth=signin">Sign in</a></p>'); return; }
    if(o.s!==200||!o.j){ wall("<p>Couldn\\u2019t load the permit tracker just now. Refresh in a moment.</p>"); return; }
    var j=o.j;
    items=Array.isArray(j.filings)?j.filings:[];
    CITY_LINE=j.cities||"these cities"; WIN=j.windowDays||30;
    var sub="Commercial building permits filed in "+(j.cities||"no city")+" in the last "+(j.windowDays||30)+" days \\u2014 the cities we read today.";
    if(j.never)sub+=" The sweep has not run yet.";
    else if(j.stale)sub+=" Last checked "+ago(j.lastSweptAt)+", more than a business day ago \\u2014 newer filings may be missing.";
    else sub+=" Checked "+ago(j.lastSweptAt)+".";
    $("ptSub").textContent=sub;
    $("ptSub").className="pt-sub"+(j.stale&&!j.never?" stale":"");
    $("ptBody").className="";
    $("ptFeedHead").className="pt-head2";
    $("ptCount").textContent=items.length+(items.length===1?" permit":" permits");
    var ind=items.filter(function(f){return f.isIndustrial}).length;
    var mine=items.filter(function(f){return f.onBoard}).length;
    var week=items.filter(function(f){return f.daysAgo!=null&&f.daysAgo<=7}).length;
    $("ptStrip").innerHTML=[[items.length,"filed, "+(j.windowDays||30)+" days"],[week,"in the last 7 days"],[ind,"on industrial land"],[j.inFirm?mine:"\\u2014",j.inFirm?"on your firm\\u2019s buildings":"no firm board"]]
      .map(function(c){return '<div class="pt-cell"><div class="n">'+esc(c[0])+'</div><div class="l">'+esc(c[1])+"</div></div>"}).join("");
    var cities={},types={};
    items.forEach(function(f){ if(f.city)cities[f.city]=1; if(f.type)types[f.type]=1; });
    opts($("ptCity"),Object.keys(cities).sort()); opts($("ptType"),Object.keys(types).sort());
    // Every type is offered with its count, a zero included, so an empty
    // type is visible before it is picked.
    var counts={}; PROP_TYPES.forEach(function(t){counts[t]=0});
    items.forEach(function(f){ var t=PROP_TYPES.indexOf(f.propertyType)>-1?f.propertyType:"Other"; f.propertyType=t; counts[t]++; });
    PROP_TYPES.forEach(function(t){ var o=document.createElement("option"); o.value=t; o.textContent=t+" ("+counts[t]+")"; $("ptProp").appendChild(o); });
    $("ptEmpty").textContent="No commercial permit filed in "+(j.cities||"these cities")+" in the last "+(j.windowDays||30)+" days"+(j.never?" \\u2014 the sweep has not run yet.":".");
    $("ptEmpty").className=items.length?"pt-note hide":"pt-note";
    $("ptTrunc").textContent=j.truncated?"Showing the "+items.length+" most recent filings; older ones in the window are not listed.":"";
    $("ptTrunc").className=j.truncated?"pt-note":"pt-note hide";
    render();
  }
  function render(){
    var q=$("ptSearch").value.toLowerCase().split(/\\s+/).filter(Boolean);
    var city=$("ptCity").value, type=$("ptType").value, prop=$("ptProp").value;
    var list=items.filter(function(f){
      if(city&&f.city!==city)return false;
      if(type&&f.type!==type)return false;
      if(prop&&f.propertyType!==prop)return false;
      if(!q.length)return true;
      var hay=[f.address,f.applicant,f.contractor,f.description,f.projectName,f.permitNumber,f.type,f.status,f.zoning].join(" ").toLowerCase();
      return q.every(function(t){return hay.indexOf(t)>-1});
    });
    var filtered=list.length!==items.length;
    $("ptShown").textContent=filtered?list.length+" of "+items.length+" shown":"";
    // A type with nothing in the window, and no other filter: say it in words.
    var typeEmpty=!!(prop&&!list.length&&items.length&&!q.length&&!city&&!type);
    $("ptTypeNoneText").textContent=typeEmpty?"No "+(prop==="Other"?"other":prop.toLowerCase())+" permit filed in "+CITY_LINE+" in the last "+WIN+" days.":"";
    $("ptTypeNone").className=typeEmpty?"pt-empty2":"pt-empty2 hide";
    $("ptNone").className=(items.length&&!list.length&&!typeEmpty)?"pt-note":"pt-note hide";
    $("ptRows").innerHTML=list.map(function(f){
      var addr=f.address||"(no address on the permit)";
      if(f.city&&addr.toLowerCase().indexOf(f.city.toLowerCase())<0)addr+=", "+f.city;
      var bits=[f.type,f.status,f.zoning?'zoned '+f.zoning:""].filter(Boolean).map(esc);
      bits.unshift('<span class="ind">'+esc(f.propertyType)+"</span>");
      var who=[f.applicant?"applicant "+f.applicant:"",f.contractor&&f.contractor!==f.applicant?"contractor "+f.contractor:""].filter(Boolean);
      var num=f.sourceUrl?'<a href="'+esc(f.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(f.permitNumber)+"</a>":esc(f.permitNumber);
      return '<div class="pt-row"><span class="pt-date">'+esc(day(f.appliedDate))+"</span>"+
        '<div class="pt-main"><span class="pt-addr">'+esc(addr)+"</span>"+
        (f.onBoard?'<a class="pt-board" href="/building/'+esc(encodeURIComponent(f.onBoard.id))+'">on your board \\u2192</a>':"")+
        '<div class="pt-meta">'+bits.join(" \\u00b7 ")+"</div>"+
        // Boise's descriptions run to whole paragraphs (seen on the first
        // live sweep): two lines here, the full text on hover.
        (f.description?'<div class="pt-desc" title="'+esc(f.description)+'">'+esc(f.description)+"</div>":"")+
        (who.length?'<div class="pt-meta">'+esc(who.join(" \\u00b7 "))+"</div>":"")+
        '</div><span class="pt-num">'+num+"</span></div>";
    }).join("");
  }
  // ---- Your permits (2026-09-27) ------------------------------------------
  var MINE=null, watches=[];
  function stepName(k){ var l=(MINE&&MINE.steps)||[]; for(var i=0;i<l.length;i++){ if(l[i].key===k)return l[i].label; } return k; }
  function words(list){ if(list.length<=1)return list[0]||""; return list.slice(0,-1).join(", ")+" and "+list[list.length-1]; }
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
  function watchName(w){ return w.label||(w.address?w.address.split(",")[0]:"")||w.permitNumber; }
  // The foot's controls depend on whose permit it is (2026-09-29, 055): your
  // own gets Change, the firm switch (owners) and Stop tracking; a permit a
  // colleague tracks for the firm gets Mute; and without Pro your own keeps
  // only Stop tracking, so a lapse never takes away the way out.
  function footControls(w){
    var b=function(attr,id,text){ return ' · <button type="button" class="pt-rm" '+attr+'="'+esc(id)+'">'+esc(text)+"</button>"; };
    if(!w.mine) return b("data-mute",w.id,w.muted?"Unmute":"Mute");
    var out="";
    if(MINE.canTrack) out+=b("data-edit",w.id,"Change");
    if(MINE.canTrack&&w.firmId) out+=b("data-firmoff",w.id,"Just me");
    else if(MINE.canTrack&&MINE.firm) out+=b("data-firmon",w.id,"Track for "+MINE.firm.name);
    return out+b("data-rm",w.id,"Stop tracking");
  }
  function firmTag(w){
    if(!w.firm) return "";
    var text=w.mine?"For "+w.firm:(w.muted?"Muted · ":"")+w.firm;
    return '<span class="pw-firm'+(w.muted?" muted":"")+'">'+esc(text)+"</span>";
  }
  function card(w){
    var num=w.sourceUrl?'<a href="'+esc(w.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(w.permitNumber)+"</a>":esc(w.permitNumber);
    var meta=[esc(w.city),num];
    if(w.label&&w.address)meta.push(esc(w.address));
    if(!w.mine&&w.sharedBy)meta.push("tracked by "+esc(w.sharedBy));
    var steps=w.steps.map(function(s){
      return '<li class="'+(s.done?"done":"")+(s.key===w.step?" now":"")+'">'+esc(s.label)+"</li>";
    }).join("");
    var latest=w.history.filter(function(h){return h.notice})[0];
    var warn=latest&&(latest.kind==="attention"||latest.kind==="ended");
    var latestHtml=latest?'<p class="pw-latest'+(latest.unread?" unread":"")+(warn?" warn":"")+'"><b>'+esc(latest.notice)+"</b> — now “"+esc(latest.to)+"”"+(latest.from?", was “"+esc(latest.from)+"”":"")+" · "+esc(day(latest.at))+"</p>":"";
    var checked=w.checkError?'<span class="err">'+esc(w.checkError)+"</span>":(w.lastCheckedAt?"Checked "+esc(ago(w.lastCheckedAt)):"Not checked yet");
    var hist=w.history.length?'<details class="pw-hist"><summary>Status history ('+w.history.length+")</summary><ul>"+w.history.map(function(h){
      return '<li class="'+(h.unread?"unread":"")+'">'+esc(day(h.at))+": "+(h.from?"“"+esc(h.from)+"” → ":"First read: ")+"“"+esc(h.to)+"”"+(h.notice?" — "+esc(h.notice):"")+"</li>";
    }).join("")+"</ul></details>":"";
    // id="pw-<id>" is a deep link to one permit (/permits#pw-<id>). The
    // Workspace linked here from 2026-09-29 until tracked permits came off
    // it on 2026-09-30; a saved link still lands.
    return '<div class="pw-card" id="pw-'+esc(w.id)+'" data-id="'+esc(w.id)+'">'+
      '<div class="pw-top"><div><span class="pw-name">'+esc(watchName(w))+"</span>"+firmTag(w)+(w.unread?'<span class="pw-new">New</span>':"")+
      '<div class="pw-meta">'+meta.join(" · ")+"</div></div>"+
      '<span class="pw-status'+(w.flag?" "+esc(w.flag):"")+'">'+(w.status?"“"+esc(w.status)+"”":"Status not read yet")+"</span></div>"+
      '<ol class="pw-steps" aria-label="Permit steps">'+steps+"</ol>"+latestHtml+
      '<div class="pw-foot">'+checked+" · "+esc(w.mine||!w.muted?notifyText(w.notify):"Muted: nothing from this permit reaches you")+footControls(w)+"</div>"+
      (w.mine&&MINE.canTrack?'<form class="pw-form hide" data-editform="'+esc(w.id)+'" style="margin-top:10px">'+
      '<div class="pw-grid"><label><span>Nickname <span class="opt">optional</span></span><input data-label maxlength="80" value="'+esc(w.label)+'"/></label></div>'+
      notifyFields(w.notify)+
      '<div class="pw-actions"><button type="submit" class="pw-btn pri">Save</button> <button type="button" class="pt-rm" data-cancel>Cancel</button> <span class="pw-msg" role="status"></span></div></form>':"")+
      hist+"</div>";
  }
  function ownCount(){ return watches.filter(function(w){return w.mine}).length; }
  function renderMine(){
    var list=$("pwList");
    var roomy=MINE.canTrack&&ownCount()<(MINE.max||25);
    var formOpen=$("pwForm").className.indexOf("hide")<0||$("pwBulk").className.indexOf("hide")<0;
    $("pwAddBtn").className=roomy&&!formOpen?"pw-btn":"pw-btn hide";
    $("pwBulkBtn").className=roomy&&!formOpen?"pw-btn":"pw-btn hide";
    $("pwPro").className=MINE.canTrack?"pw-pro hide":"pw-pro";
    var cities=(MINE.cities||[]).map(function(c){return c.label});
    var firmLine=MINE.firm?" As "+MINE.firm.name+"’s owner, you can track one for everyone at the firm.":"";
    $("pwSub").textContent=!MINE.canTrack
      ? (watches.length?"The permits you track are kept here. You can stop tracking any of them.":"")
      : watches.length
      ? "Read from each city’s own permit portal every weekday morning. You’re told when a permit reaches the steps you picked."+firmLine
      : "Filed a permit in "+words(cities)+"? Track it here: we read its status from the city’s portal every weekday morning and tell you — by email, here on CompNinja, or both — when it reaches the steps you pick."+firmLine;
    $("pwSub").className=$("pwSub").textContent?"pw-sub":"pw-sub hide";
    list.innerHTML=watches.length?watches.map(card).join(""):"";
  }
  function formMsg(el,text,kind){ el.textContent=text||""; el.className="pw-msg"+(kind?" "+kind:""); }
  function openAdd(){
    closeBulk();
    $("pwForm").className="pw-form";
    $("pwAddBtn").className="pw-btn hide"; $("pwBulkBtn").className="pw-btn hide";
    $("pwNum").focus();
  }
  function closeAdd(){
    $("pwForm").className="pw-form hide";
    formMsg($("pwMsg"),"");
    renderMine();
  }
  function applyMine(o){
    if(!o){ return; }
    $("pwSec").className="pw";
    if(o.s!==200||!o.j){
      $("pwSub").textContent="Your tracked permits couldn’t be loaded just now. Refresh in a moment.";
      return;
    }
    MINE=o.j;
    watches=Array.isArray(MINE.watches)?MINE.watches:[];
    var sel=$("pwCity");
    (MINE.cities||[]).forEach(function(c){ var op=document.createElement("option"); op.value=c.key; op.textContent=c.label; sel.appendChild(op); });
    $("pwFormNotify").innerHTML=notifyFields(MINE.defaults||{});
    $("pwBulkNotify").innerHTML=notifyFields(MINE.defaults||{});
    (MINE.cities||[]).forEach(function(c){ var op=document.createElement("option"); op.value=c.key; op.textContent=c.label; $("pwBulkCity").appendChild(op); });
    if(MINE.firm){ $("pwFirmSet").className="pw-set"; $("pwFirmText").textContent="Everyone at "+MINE.firm.name;
      $("pwBulkFirmSet").className="pw-set"; $("pwBulkFirmText").textContent="Everyone at "+MINE.firm.name; }
    renderMine();
    // Two deep links (2026-09-29, made for the Workspace's Tracked permits
    // card, which came off on 2026-09-30): ?track=1 opens the add form, and
    // #pw-<id> brings that permit's card into view.
    var hash=String(location.hash||"");
    var target=hash.indexOf("#pw-")===0?document.getElementById(decodeURIComponent(hash.slice(1))):null;
    if(target){ target.className+=" pw-focus"; target.scrollIntoView({block:"center"}); }
    else if(/(^|[?&])track=1(&|$)/.test(String(location.search||""))&&MINE.canTrack&&ownCount()<(MINE.max||25)){ openAdd(); }
    // Seen: clears the count on the nav dot. A fetch, so a prerendered copy
    // of this page does not send it until the page is actually shown.
    if(MINE.unread>0){
      fetch("/api/permits/seen",{method:"POST",credentials:"same-origin"}).then(function(r){
        if(r.ok){ var d=$("navPermitDot"); if(d)d.hidden=true; }
      }).catch(function(){});
    }
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
    $("pwAddBtn").className="pw-btn hide"; $("pwBulkBtn").className="pw-btn hide";
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
  function lineList(items,fn){ return "<ul>"+items.map(fn).join("")+"</ul>"; }
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
    var t=e.target;
    if(!t||!t.getAttribute)return;
    var ed=t.getAttribute("data-edit"), rm=t.getAttribute("data-rm");
    var fon=t.getAttribute("data-firmon"), foff=t.getAttribute("data-firmoff"), mu=t.getAttribute("data-mute");
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
    if(ed){
      var f=document.querySelector('form[data-editform="'+ed+'"]');
      if(f)f.className=f.className.indexOf("hide")>-1?"pw-form":"pw-form hide";
      return;
    }
    if(t.hasAttribute&&t.hasAttribute("data-cancel")){ renderMine(); return; }
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
        // Keep this page view's "New" marks: the server's copy was read after
        // the page cleared them.
        keepMarks(id,o.j.watch);
        renderMine();
      })
      .catch(function(){ formMsg(msg,"That didn’t reach the server. Nothing was changed.","bad"); });
  });

  $("ptSearch").addEventListener("input",render);
  $("ptCity").addEventListener("change",render);
  $("ptType").addEventListener("change",render);
  $("ptProp").addEventListener("change",render);
  $("ptTypeAll").addEventListener("click",function(){ $("ptProp").value=""; render(); });
  $("ptClear").addEventListener("click",function(){ $("ptSearch").value=""; $("ptCity").value=""; $("ptType").value=""; $("ptProp").value=""; render(); });
  apply(BOOT);
  if(BOOT&&BOOT.s===200)applyMine(BOOT.mine);
})();
</script>`;
}

module.exports = { renderPermitsBody };
