// ---------------------------------------------------------------------------
// The bulk valuation workspace — the whole /bulk screen.
//
// Pure, like vault-page.js and guide-1031.js: it takes a boot payload and
// returns a string. No I/O, no requires, no clock reads. server.js owns the
// entitlement gate, the job tables and the worker; this file only decides how
// a run is drawn. Keep it that way — a read that happened here would be a read
// outside the gate.
//
// It renders a BODY, not a document: server.js dresses it in marketShell(), so
// the header, footer, theme boot and account chrome are the site's shared ones
// rather than a second copy. That is the /brokers and /1031-exchange pattern,
// and it is why this page needs no stylesheet of its own beyond the ~90 lines
// below — MARKET_CSS is already on the page.
//
// esc() is duplicated from server.js rather than imported, matching the copies
// in vault-page.js and hub-page.js. It is three lines and pure; a require would
// couple the page to the server for the sake of it.
// ---------------------------------------------------------------------------

"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

const BULK_CSS = `
.bulk{max-width:1100px}
.bulk .deck{margin:0 0 28px}
.bulk .deckrule{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
  border-bottom:1px solid var(--ink);padding-bottom:6px;margin:0 0 14px}
.bulk .deckrule h2{font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:400;margin:0;letter-spacing:.01em}
.bulk .lede{color:var(--ink-mute);font-size:13.5px;margin:0 0 18px;max-width:62ch}
.bulk label{display:block;font-size:11px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute);margin:0 0 5px}
.bulk textarea,.bulk input[type=text],.bulk select{width:100%;padding:9px 10px;font:inherit;font-size:14px;
  color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:6px}
.bulk textarea{min-height:150px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5}
.bulk .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin:14px 0}
.bulk .acts{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:14px}
.bulk button.go{background:var(--red);color:#fff;border:0;border-radius:6px;padding:10px 18px;
  font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.bulk button.go[disabled]{opacity:.45;cursor:default}
.bulk button.lnk{background:none;border:0;padding:0;font:inherit;font-size:13px;color:var(--red);cursor:pointer;text-decoration:underline}
.bulk .cost{color:var(--ink-mute);font-size:12.5px}
.bulk .msg{font-size:13px;margin:12px 0 0}
.bulk .msg.bad{color:var(--red-deep)}
.bulk .notes{margin:12px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:6px;
  font-size:12.5px;color:var(--ink-mute)}
.bulk .notes ul{margin:6px 0 0;padding-left:18px}
.bulk .strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:0 0 16px}
.bulk .strip div{background:var(--paper);padding:10px 12px}
.bulk .strip .k{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-mute)}
.bulk .strip .v{font-size:17px;font-variant-numeric:tabular-nums}
.bulk table{width:100%;border-collapse:collapse;font-size:13px}
.bulk th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-mute);
  font-weight:500;padding:6px 8px;border-bottom:1px solid var(--ink)}
.bulk td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.bulk td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.bulk .chip{display:inline-block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;
  padding:1px 7px;border:1px solid var(--line);border-radius:99px;color:var(--ink-mute)}
.bulk .chip.run{border-color:var(--red);color:var(--red)}
.bulk .chip.bad{border-color:var(--red-deep);color:var(--red-deep)}
.bulk .sub{color:var(--ink-mute);font-size:11.5px}
.bulk .runs li{padding:9px 0;border-top:1px solid var(--line);list-style:none;
  display:flex;justify-content:space-between;gap:14px;align-items:baseline}
.bulk .runs{padding:0;margin:0}
.bulk .runs li:first-child{border-top:0}
.bulk .foot{margin-top:22px;padding-top:12px;border-top:1px solid var(--line);
  color:var(--ink-mute);font-size:12px;max-width:70ch}
.bulk .hide{display:none}
`;

/**
 * The /bulk body.
 *
 * `boot` is server.js's own read, already through the entitlement gate:
 * `{ s: <status>, j: <body> }`. Rendering the refusals from it — rather than
 * fetching and then discovering them — is what stops a member who is not Pro
 * seeing a working paste box for the half-second before the fetch answers.
 */
function renderBulkPageBody(boot) {
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<style>${BULK_CSS}</style>
<div class="bulk">
  <div class="deck" id="gate" hidden>
    <div class="deckrule"><h2>Bulk valuation</h2></div>
    <p class="lede" id="gateMsg"></p>
    <p id="gateAct"></p>
  </div>

  <div id="app" hidden>
    <div class="deck">
      <div class="deckrule">
        <h2>Bulk valuation</h2>
        <span class="sub" id="capNote"></span>
      </div>
      <p class="lede">Paste a list of addresses — one per line — or upload a CSV with an
        <code>address</code> column. Every address gets its own search and its own value range,
        and each one lands on My&nbsp;Desk as a saved property.</p>

      <label for="bulkText">Addresses</label>
      <textarea id="bulkText" spellcheck="false" placeholder="1201 W Idaho St, Boise, ID 83702
4610 E Fairview Ave, Meridian, ID 83642
900 N Cole Rd, Boise, ID"></textarea>
      <p class="acts" style="margin-top:10px">
        <input type="file" id="bulkFile" accept=".csv,.txt,text/csv,text/plain" class="hide"/>
        <button type="button" class="lnk" id="pickFile">Upload a CSV or text file</button>
        <span class="cost" id="count"></span>
      </p>

      <div class="row">
        <div>
          <label for="bulkType">Property type</label>
          <select id="bulkType"></select>
        </div>
        <div>
          <label for="bulkMonths">Lookback</label>
          <select id="bulkMonths">
            <option value="12">12 months</option>
            <option value="24" selected>24 months</option>
            <option value="36">36 months</option>
            <option value="60">60 months</option>
            <option value="120">120 months</option>
          </select>
        </div>
        <div>
          <label for="bulkNote">Focus (optional)</label>
          <input type="text" id="bulkNote" maxlength="200" placeholder="e.g. within 2.5 miles"/>
        </div>
        <div>
          <label for="bulkLabel">Name this run (optional)</label>
          <input type="text" id="bulkLabel" maxlength="120" placeholder="e.g. Q3 portfolio review"/>
        </div>
      </div>

      <p class="acts">
        <button type="button" class="go" id="run" disabled>Run valuations</button>
        <span class="cost" id="cost"></span>
      </p>
      <p class="msg" id="msg"></p>
      <div class="notes hide" id="notes"></div>
    </div>

    <div class="deck hide" id="jobDeck">
      <div class="deckrule">
        <h2 id="jobTitle">This run</h2>
        <span class="sub" id="jobMeta"></span>
      </div>
      <div class="strip" id="totals"></div>
      <p class="acts">
        <button type="button" class="lnk hide" id="cancel">Cancel the rest</button>
        <a class="lnk" id="dl" href="#" style="display:none">Download CSV</a>
        <a class="lnk" href="/desk">Open My Desk</a>
      </p>
      <div style="overflow-x:auto"><table id="rows"></table></div>
    </div>

    <div class="deck hide" id="pastDeck">
      <div class="deckrule"><h2>Earlier runs</h2></div>
      <ul class="runs" id="past"></ul>
    </div>

    <p class="foot">Every figure here is an automated estimate produced from comparable sales,
      not an appraisal, and each one carries the same caveats as the report behind it — open a
      property on My&nbsp;Desk to see its comps and how the range was reached. Addresses with no
      priced sale comps in the window are reported as such rather than valued at zero.</p>
  </div>
</div>
<script>${BULK_JS.replace(/<\/script>/gi, "<\\/script>")}
BULKPAGE.start(${bootJson});
</script>`;
}

// ---------------------------------------------------------------------------
// The browser half.
//
// Written with string concatenation and no template literals on purpose: the
// whole page is one template literal in this file, so a backtick or a `${`
// down here emits broken JavaScript and a blank workspace rather than failing
// loudly. vault-page.js carries the same rule and a test that compiles what
// the page actually emits; this file has one too.
// ---------------------------------------------------------------------------
const BULK_JS = `
var BULKPAGE=(function(){
"use strict";
var $=function(i){return document.getElementById(i);};
var MAX=50,TYPES=[],job=null,items=[],timer=null,parsedCount=0,allJobs=[];
var LEFT=null,DAILY=null;

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function money(v){if(!(Number(v)>0))return "\\u2014";
  return "$"+Math.round(Number(v)).toLocaleString("en-US");}
function psf(v){if(!(Number(v)>0))return "\\u2014";
  return "$"+Number(v).toFixed(0);}
function num(v){return Number(v)>0?Number(v).toLocaleString("en-US"):"\\u2014";}

// The count in the button is the count the SERVER will accept, so nobody is
// told "42 addresses" and then handed 40 rows. It is the same rule the parser
// enforces, restated cheaply: blank lines and '#' notes do not count, and a
// line with no digit in it is not an address.
function countLines(text){
  var lines=String(text||"").split(/\\r\\n|\\r|\\n/),seen={},n=0;
  var first=lines.length?lines[0].toLowerCase():"";
  var header=first.indexOf("address")>=0&&first.indexOf(",")>=0;
  for(var i=header?1:0;i<lines.length;i++){
    var raw=lines[i].trim();
    if(!raw||raw.charAt(0)==="#")continue;
    var addr=header?raw.split(",")[0].trim():raw;
    if(addr.length<6||!/\\d/.test(addr))continue;
    var k=addr.toLowerCase().replace(/[^a-z0-9]+/g,"");
    if(seen[k])continue;
    seen[k]=1;n++;
  }
  return n;
}

function refreshCount(){
  parsedCount=Math.min(countLines($("bulkText").value),MAX);
  $("count").textContent=parsedCount?parsedCount+" address"+(parsedCount===1?"":"es")+" ready":"";
  // One run at a time, and the button says so rather than letting somebody
  // press it into a 409. The server enforces it either way; this is the
  // Buy-button rule — a control that can only fail is worse than none.
  var busy=Boolean(job&&job.status==="running");
  $("run").disabled=busy||parsedCount===0;
  $("run").textContent=parsedCount?"Run "+parsedCount+" valuation"+(parsedCount===1?"":"s"):"Run valuations";
  // Said BEFORE the button, not after: a run is up to fifty billed searches
  // and half an hour, and the moment to know that is while deciding.
  // The daily ceiling is said BEFORE the list is too long, not only when the
  // run is refused: somebody with 12 left should find that out while pasting,
  // not after deciding which forty addresses mattered.
  var overCap=LEFT!==null&&parsedCount>LEFT;
  if(overCap)$("run").disabled=true;
  $("cost").textContent=busy
    ? "A run is going below. Wait for it to finish, or cancel it first."
    : overCap
    ? (LEFT===0
        ? "You have valued "+DAILY+" addresses today — the daily limit. It resets at midnight UTC."
        : "Only "+LEFT+" left today (the daily limit is "+DAILY+"). Trim the list, or come back after midnight UTC.")
    : parsedCount
    ? "Roughly "+Math.max(1,Math.round(parsedCount*0.9))+"\\u2013"+Math.ceil(parsedCount*1.1)+
      " min. Addresses searched before are served from cache and finish instantly."
    : "";
}

// The per-run cap and the daily allowance in one line, because they answer
// the same question ("how much can I do") and two chips would compete.
function capNoteText(){
  var base="Up to "+MAX+" addresses per run";
  return LEFT===null?base:base+" · "+LEFT+" left today";
}

function statusChip(s){
  var cls=s==="running"?"chip run":(s==="failed"||s==="interrupted"||s==="cancelled")?"chip bad":"chip";
  return '<span class="'+cls+'">'+esc(s)+"</span>";
}

function renderTotals(sum){
  var cached=0;for(var i=0;i<items.length;i++)if(items[i].cached)cached++;
  var cells=[
    ["Portfolio value",money(sum.likely)],
    ["Range",money(sum.low)+" \\u2013 "+money(sum.high)],
    ["Valued",sum.valued+" of "+sum.total],
    ["From cache",String(cached)]
  ];
  if(sum.failed)cells.push(["Not valued",String(sum.failed)]);
  $("totals").innerHTML=cells.map(function(c){
    return '<div><div class="k">'+esc(c[0])+'</div><div class="v">'+c[1]+"</div></div>";}).join("");
}

function rowHtml(it,i){
  var val=it.status==="done"&&Number(it.value_likely)>0
    ? money(it.value_likely)+'<div class="sub">'+money(it.value_low)+" \\u2013 "+money(it.value_high)+"</div>"
    : '<span class="sub">\\u2014</span>';
  var note=it.error?'<div class="sub">'+esc(it.error)+"</div>":"";
  // The address opens the saved property when there is one: the row is a
  // summary, and the evidence for it — the comps, the weighting, the trust
  // line — lives in the report on the desk. ?property= is index.html's own
  // door and its read is user-scoped, so the link cannot open anything that
  // is not already this member's.
  var addr=it.portfolio_item_id
    ? '<a href="/?property='+encodeURIComponent(it.portfolio_item_id)+'">'+esc(it.address)+"</a>"
    : esc(it.address);
  var lbl=it.label?'<div class="sub">'+esc(it.label)+"</div>":"";
  var sz=Number(it.size_sqft)>0
    ? num(it.size_sqft)+'<div class="sub">'+esc(it.size_source||"you")+"</div>" : "\\u2014";
  // Sale comps, not the comp count: the band comes from the sales, and a
  // lease-heavy report showing "10" would imply ten deals behind the number.
  var comps=Number(it.sale_comps)>0
    ? String(it.sale_comps)+(it.trimmed?"":'<div class="sub">wide band</div>') : "\\u2014";
  return "<tr><td class=\\"n\\">"+(i+1)+"</td>"+
    "<td>"+addr+lbl+note+"</td>"+
    "<td class=\\"n\\">"+val+"</td>"+
    "<td class=\\"n\\">"+psf(it.psf_mid)+"</td>"+
    "<td class=\\"n\\">"+sz+"</td>"+
    "<td class=\\"n\\">"+comps+"</td>"+
    "<td>"+statusChip(it.status)+(it.cached?' <span class="sub">cached</span>':"")+"</td></tr>";
}

function renderJob(){
  if(!job){$("jobDeck").className="deck hide";return;}
  $("jobDeck").className="deck";
  $("jobTitle").textContent=job.label||"This run";
  $("jobMeta").innerHTML=esc(job.property_type)+" \\u00b7 "+esc(String(job.months))+"-month lookback \\u00b7 "+
    statusChip(job.status)+' <span class="sub">'+job.done_count+" of "+job.total+" done</span>";
  renderTotals(window.__bulkSummary||{total:items.length,valued:0,failed:0,low:0,likely:0,high:0});
  $("rows").innerHTML="<thead><tr><th></th><th>Address</th><th>Likely value</th><th>$/SF</th>"+
    "<th>Size</th><th>Sale comps</th><th>Status</th></tr></thead><tbody>"+
    items.map(rowHtml).join("")+"</tbody>";
  $("cancel").className=job.status==="running"?"lnk":"lnk hide";
  renderPast();
  refreshCount();
  var dl=$("dl");
  dl.href="/api/bulk/export.csv?id="+encodeURIComponent(job.id);
  dl.style.display=job.done_count>0?"":"none";
}

// The list a page load hands us, kept so renderJob() can re-render it: the
// open run is filtered OUT of "Earlier runs", and on first paint the job is
// not yet known — without this the run showing above is also listed below it
// as an earlier one.
function setJobs(list){allJobs=list||[];renderPast();}

function renderPast(){
  var rest=allJobs.filter(function(j){return !job||j.id!==job.id;});
  if(!rest.length){$("pastDeck").className="deck hide";return;}
  $("pastDeck").className="deck";
  $("past").innerHTML=rest.map(function(j){
    return "<li><span>"+'<a href="#" data-job="'+esc(j.id)+'">'+esc(j.label||j.property_type+" run")+"</a>"+
      ' <span class="sub">'+esc(String(j.created_at||"").slice(0,10))+" \\u00b7 "+j.total+" addresses</span></span>"+
      "<span>"+statusChip(j.status)+"</span></li>";}).join("");
  Array.prototype.forEach.call($("past").querySelectorAll("a[data-job]"),function(a){
    a.addEventListener("click",function(e){e.preventDefault();poll(a.getAttribute("data-job"),true);});});
}

function api(method,url,body){
  return fetch(url,{method:method,cache:"no-store",
    headers:body?{"content-type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined}).then(function(r){
    return r.json().catch(function(){return {};}).then(function(d){
      if(!r.ok){var e=new Error(d&&d.error||"Something went wrong.");e.data=d;e.status=r.status;throw e;}
      return d;});});
}

// One poll, and it re-arms ITSELF only while the job is still running — a
// setInterval left behind by a finished job keeps a tab requesting forever.
function poll(id,force){
  if(timer){clearTimeout(timer);timer=null;}
  return api("GET","/api/bulk?id="+encodeURIComponent(id)).then(function(d){
    job=d.job;items=d.items||[];window.__bulkSummary=d.summary;
    renderJob();
    if(force)loadList();
    if(job&&job.status==="running")timer=setTimeout(function(){poll(id);},4000);
    else loadList();
  }).catch(function(e){$("msg").textContent=e.message;$("msg").className="msg bad";});
}

function loadList(){
  return api("GET","/api/bulk").then(function(d){
    if(d.maxAddresses)MAX=d.maxAddresses;
    if(typeof d.leftToday==="number"){LEFT=d.leftToday;DAILY=d.dailyLimit;}
    if(d.types&&d.types.length&&!TYPES.length){TYPES=d.types;fillTypes();}
    $("capNote").textContent=capNoteText();
    setJobs(d.jobs||[]);
    refreshCount();
    // Resume whatever is going: a member who closed the tab mid-run and came
    // back should find the run, not an empty form suggesting it never
    // happened. Only auto-attaches to a LIVE job, so an old finished run does
    // not reopen itself every visit.
    if(!job){
      var live=(d.jobs||[]).filter(function(j){return j.status==="running";})[0];
      if(live)poll(live.id);
    }
    return d;
  });
}

function showNotes(d){
  var out=[];
  if(d.truncated)out.push(d.truncated+" address"+(d.truncated===1?" was":"es were")+
    " left out \\u2014 a run holds "+MAX+".");
  if(d.duplicates)out.push(d.duplicates+" duplicate"+(d.duplicates===1?"":"s")+" removed.");
  (d.skipped||[]).forEach(function(s){out.push("Line "+s.line+": "+s.reason+" ("+esc(s.address)+")");});
  (d.warnings||[]).forEach(function(w){out.push("Line "+w.line+": "+w.reason);});
  if(!out.length){$("notes").className="notes hide";return;}
  $("notes").className="notes";
  $("notes").innerHTML="<b>Before you read the totals:</b><ul><li>"+
    out.map(function(t){return esc(t).replace(/&amp;(\\w+;)/g,"&$1");}).join("</li><li>")+"</li></ul>";
}

function run(){
  var btn=$("run");btn.disabled=true;
  $("msg").textContent="Starting\\u2026";$("msg").className="msg";
  api("POST","/api/bulk",{
    text:$("bulkText").value,type:$("bulkType").value,
    months:Number($("bulkMonths").value),note:$("bulkNote").value,label:$("bulkLabel").value
  }).then(function(d){
    $("msg").textContent="Running. You can close this tab \\u2014 the valuations keep going and land on My Desk.";
    showNotes(d);
    job=d.job;items=d.items||[];window.__bulkSummary=null;
    renderJob();poll(job.id);
  }).catch(function(e){
    $("msg").textContent=e.message;$("msg").className="msg bad";
    // A refusal carries the fresh number, so the hint above corrects itself
    // rather than going on claiming an allowance the server just denied.
    if(e.data&&typeof e.data.left_today==="number"){
      LEFT=e.data.left_today;DAILY=e.data.daily_limit;$("capNote").textContent=capNoteText();}
    if(e.data)showNotes(e.data);
    if(e.data&&e.data.job){job=e.data.job;poll(job.id);}
  }).then(function(){refreshCount();});
}

function fillTypes(){
  $("bulkType").innerHTML=TYPES.map(function(t){
    return '<option value="'+esc(t)+'">'+esc(t)+"</option>";}).join("");
}

function gate(msg,actionHtml){
  $("gate").hidden=false;$("app").hidden=true;
  $("gateMsg").textContent=msg;
  $("gateAct").innerHTML=actionHtml||"";
}

function start(boot){
  if(!boot||boot.s===401)
    return gate("Sign in to run a bulk valuation.",'<a class="lnk" href="/?auth=signin">Sign in</a>');
  if(boot.s===403)
    return gate((boot.j&&boot.j.error)||"Bulk valuation is part of Pro.",
      '<a class="lnk" href="/?pricing=1">See Pro</a>');
  if(boot.s!==200)
    return gate((boot.j&&boot.j.error)||"Bulk valuation is unavailable right now.","");
  $("gate").hidden=true;$("app").hidden=false;
  var d=boot.j||{};
  if(d.maxAddresses)MAX=d.maxAddresses;
  if(typeof d.leftToday==="number"){LEFT=d.leftToday;DAILY=d.dailyLimit;}
  TYPES=d.types||[];fillTypes();
  $("capNote").textContent=capNoteText();
  setJobs(d.jobs||[]);
  var live=(d.jobs||[]).filter(function(j){return j.status==="running";})[0];
  if(live)poll(live.id);

  $("bulkText").addEventListener("input",refreshCount);
  $("run").addEventListener("click",run);
  $("pickFile").addEventListener("click",function(){$("bulkFile").click();});
  $("bulkFile").addEventListener("change",function(){
    var f=$("bulkFile").files&&$("bulkFile").files[0];if(!f)return;
    var fr=new FileReader();
    fr.onload=function(){$("bulkText").value=String(fr.result||"");refreshCount();};
    fr.onerror=function(){$("msg").textContent="That file could not be read.";$("msg").className="msg bad";};
    fr.readAsText(f);
  });
  $("cancel").addEventListener("click",function(){
    if(!job)return;
    // Says what a cancel actually does. Searches already in flight are billed
    // the moment they start, so promising to stop them would be a lie.
    if(!confirm("Stop the addresses that have not started yet? Searches already running will finish."))return;
    api("POST","/api/bulk/cancel",{id:job.id}).then(function(){poll(job.id,true);}).catch(function(){});
  });
  refreshCount();
}

return {start:start};
})();
`;

module.exports = { renderBulkPageBody, BULK_CSS, BULK_JS };
