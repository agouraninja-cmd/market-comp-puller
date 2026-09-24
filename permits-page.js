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
// says so), and the search box, city, type and industrial switch filter it
// in the browser. The header count describes the whole window, never the
// filtered view — the shelf's rule.
//
// HONESTY (spec §7): the page names the cities it reads and when the sweep
// last ran, and says so when that run is more than a business day old. It
// never implies a city it does not read was checked.
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
@media (max-width:640px){.pt-row{flex-wrap:wrap}.pt-date{flex:1 1 100%}.pt-strip{flex-wrap:wrap}.pt-cell{flex:1 1 45%}}
.hide{display:none}
</style>
<main class="wrap pt-page">
  <div class="kicker">Tools</div>
  <div class="pt-head">
    <h1>Permit tracker</h1>
    <span class="pt-count" id="ptCount"></span>
  </div>
  <p class="pt-sub" id="ptSub"></p>
  <div class="pt-wall hide" id="ptWall"></div>
  <div id="ptBody" class="hide">
    <div class="pt-strip" id="ptStrip"></div>
    <div class="pt-tools">
      <input type="search" id="ptSearch" placeholder="Search address, applicant, contractor or description" aria-label="Search permits" autocomplete="off"/>
      <select id="ptCity" aria-label="Filter by city"><option value="">All cities</option></select>
      <select id="ptType" aria-label="Filter by permit type"><option value="">All permit types</option></select>
      <label class="chk"><input type="checkbox" id="ptInd"/> Industrial only</label>
      <span class="pt-shown" id="ptShown"></span>
    </div>
    <div id="ptRows"></div>
    <p class="pt-note hide" id="ptNone">No permit matches. <button type="button" class="pt-rm" id="ptClear">Clear filters</button></p>
    <p class="pt-note hide" id="ptEmpty"></p>
    <p class="pt-note hide" id="ptTrunc"></p>
    <p class="pt-note">Public record, read from each city’s own permit portal on weekday mornings. “Industrial” means the parcel is zoned industrial by Ada County, or — where the county could not answer — the permit describes industrial work.</p>
  </div>
</main>
<script>
(function(){
  var BOOT = ${bootJson};
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  var items=[];
  function wall(html){ var w=$("ptWall"); w.innerHTML=html; w.className="pt-wall"; $("ptBody").className="hide"; }
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
    var sub="Commercial building permits filed in "+(j.cities||"no city")+" in the last "+(j.windowDays||30)+" days \\u2014 the cities we read today.";
    if(j.never)sub+=" The sweep has not run yet.";
    else if(j.stale)sub+=" Last checked "+ago(j.lastSweptAt)+", more than a business day ago \\u2014 newer filings may be missing.";
    else sub+=" Checked "+ago(j.lastSweptAt)+".";
    $("ptSub").textContent=sub;
    $("ptSub").className="pt-sub"+(j.stale&&!j.never?" stale":"");
    $("ptBody").className="";
    $("ptCount").textContent=items.length+(items.length===1?" permit":" permits");
    var ind=items.filter(function(f){return f.isIndustrial}).length;
    var mine=items.filter(function(f){return f.onBoard}).length;
    var week=items.filter(function(f){return f.daysAgo!=null&&f.daysAgo<=7}).length;
    $("ptStrip").innerHTML=[[items.length,"filed, "+(j.windowDays||30)+" days"],[week,"in the last 7 days"],[ind,"on industrial land"],[j.inFirm?mine:"\\u2014",j.inFirm?"on your firm\\u2019s buildings":"no firm board"]]
      .map(function(c){return '<div class="pt-cell"><div class="n">'+esc(c[0])+'</div><div class="l">'+esc(c[1])+"</div></div>"}).join("");
    var cities={},types={};
    items.forEach(function(f){ if(f.city)cities[f.city]=1; if(f.type)types[f.type]=1; });
    opts($("ptCity"),Object.keys(cities).sort()); opts($("ptType"),Object.keys(types).sort());
    $("ptEmpty").textContent="No commercial permit filed in "+(j.cities||"these cities")+" in the last "+(j.windowDays||30)+" days"+(j.never?" \\u2014 the sweep has not run yet.":".");
    $("ptEmpty").className=items.length?"pt-note hide":"pt-note";
    $("ptTrunc").textContent=j.truncated?"Showing the "+items.length+" most recent filings; older ones in the window are not listed.":"";
    $("ptTrunc").className=j.truncated?"pt-note":"pt-note hide";
    render();
  }
  function render(){
    var q=$("ptSearch").value.toLowerCase().split(/\\s+/).filter(Boolean);
    var city=$("ptCity").value, type=$("ptType").value, ind=$("ptInd").checked;
    var list=items.filter(function(f){
      if(city&&f.city!==city)return false;
      if(type&&f.type!==type)return false;
      if(ind&&!f.isIndustrial)return false;
      if(!q.length)return true;
      var hay=[f.address,f.applicant,f.contractor,f.description,f.projectName,f.permitNumber,f.type,f.status,f.zoning].join(" ").toLowerCase();
      return q.every(function(t){return hay.indexOf(t)>-1});
    });
    var filtered=list.length!==items.length;
    $("ptShown").textContent=filtered?list.length+" of "+items.length+" shown":"";
    $("ptNone").className=(items.length&&!list.length)?"pt-note":"pt-note hide";
    $("ptRows").innerHTML=list.map(function(f){
      var addr=f.address||"(no address on the permit)";
      if(f.city&&addr.toLowerCase().indexOf(f.city.toLowerCase())<0)addr+=", "+f.city;
      var bits=[f.type,f.status,f.zoning?'zoned '+f.zoning:""].filter(Boolean).map(esc);
      if(f.isIndustrial)bits.push('<span class="ind">industrial</span>');
      var who=[f.applicant?"applicant "+f.applicant:"",f.contractor&&f.contractor!==f.applicant?"contractor "+f.contractor:""].filter(Boolean);
      var num=f.sourceUrl?'<a href="'+esc(f.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(f.permitNumber)+"</a>":esc(f.permitNumber);
      return '<div class="pt-row"><span class="pt-date">'+esc(day(f.appliedDate))+"</span>"+
        '<div class="pt-main"><span class="pt-addr">'+esc(addr)+"</span>"+
        (f.onBoard?'<a class="pt-board" href="/building/'+esc(encodeURIComponent(f.onBoard.id))+'">on your board \\u2192</a>':"")+
        '<div class="pt-meta">'+bits.join(" \\u00b7 ")+(f.description?" \\u00b7 "+esc(f.description):"")+"</div>"+
        (who.length?'<div class="pt-meta">'+esc(who.join(" \\u00b7 "))+"</div>":"")+
        '</div><span class="pt-num">'+num+"</span></div>";
    }).join("");
  }
  $("ptSearch").addEventListener("input",render);
  $("ptCity").addEventListener("change",render);
  $("ptType").addEventListener("change",render);
  $("ptInd").addEventListener("change",render);
  $("ptClear").addEventListener("click",function(){ $("ptSearch").value=""; $("ptCity").value=""; $("ptType").value=""; $("ptInd").checked=false; render(); });
  apply(BOOT);
})();
</script>`;
}

module.exports = { renderPermitsBody };
