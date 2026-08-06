// ---------------------------------------------------------------------------
// The broker vault page — the whole server-rendered /vault screen.
//
// Moved out of server.js on 2026-08-06. It is a WEB PAGE, so it is Jacob's to
// edit, but it was living inside server.js, which is Owen's. That made two of
// the four vault tasks collide with the server work by accident rather than by
// design. Nothing about the code changed in the move; only where it lives.
//
// Pure like the other extracted modules: it takes a boot payload and returns a
// string. No I/O, no requires, no clock reads. The DATA is still resolved in
// server.js by vaultReadPayload, which owns the entitlement gate; this file
// only decides how that data is drawn. Keep it that way — a read that happens
// here would be a read outside the gate.
//
// esc() is duplicated from server.js rather than imported, matching the four
// existing copies there. It is three lines and pure; a require would couple
// the page to the server for the sake of it.
// ---------------------------------------------------------------------------

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

// CN_LOGO and MARKET_CSS are the site's shared chrome: one definition in
// server.js, used by seven other server-rendered pages. They are passed IN
// rather than copied here, because a second copy would drift from the first
// (server.js already carries a "keep the two in step" warning about exactly
// that hazard elsewhere). Passing them keeps one source of truth and means
// this file never has to reach back into server.js.
function renderVaultHTML(boot, { CN_LOGO, MARKET_CSS }) {
  // </script> can never appear in the payload: every "<" is escaped, which is
  // also what keeps a comp note like "<img onerror=…>" inert inside the tag.
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Your vault · CompNinja</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<style>
*{box-sizing:border-box}
:root{
  --ink:#1A2433;--ink-2:#4C5665;--ink-3:#8A93A0;--ink-4:#C7CBD2;
  --red:#B91C1C;--red-deep:#991B1B;
  --green:#15803D;
  --paper:#FBFBF9;--line:#E4E2DA;--hair:#F0EFE9;--wash:#F5F4EF;--edge:#D8D4C9;
  --serif:Georgia,'Times New Roman',serif;
  --r:4px;
  --t1:32px;--t2:19px;--t3:15px;--t4:14px;--t5:12.5px;--t6:11px;
  --s1:2px;--s2:4px;--s3:8px;--s4:12px;--s5:16px;--s6:24px;--s7:32px;--s8:48px;--s9:80px;
}
body{margin:0;background:var(--paper);color:var(--ink);line-height:1.65;min-height:100vh;
  display:flex;flex-direction:column;font-size:var(--t4);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--red);text-decoration:none}a:hover{color:var(--red-deep)}
.wrap{max-width:1040px;margin:0 auto;padding:0 var(--s6);width:100%}
.hdr{border-bottom:1px solid var(--line);background:var(--paper)}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:var(--s4);padding:var(--s5) var(--s6)}
/* 10px rather than --s4: the logo/wordmark lockup is a fixed brand
   relationship shared with index.html's header and MARKET_CSS, not this
   page's spacing scale, so it stays literal and identical everywhere. */
.brand{display:flex;align-items:center;gap:10px;color:var(--ink)}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:var(--t3);font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.wordmark b{color:var(--red);font-weight:600}
.hdr nav{display:flex;gap:var(--s5);font-size:var(--t5)}
.hdr nav a{color:var(--ink-2)}.hdr nav a:hover{color:var(--ink)}
main{flex:1;padding:var(--s7) 0 var(--s9)}
.kicker{font-size:var(--t6);letter-spacing:.16em;text-transform:uppercase;color:var(--red);font-weight:600}
h1.h{font-family:var(--serif);font-weight:500;margin:var(--s4) 0 0;font-size:var(--t1);line-height:1.15}
.sub{color:var(--ink-2);max-width:62ch;margin:var(--s4) 0 0}
/* The trust line. A broker does not hand over their book of business because
   our terms promise we cannot read it — they do it because they can watch this
   number stay at zero. It is deliberately the most prominent thing on the page
   after the title. */
.trust{margin:var(--s7) 0 0;padding:var(--s5) var(--s6);background:var(--wash);
  border:1px solid var(--line);border-radius:var(--r);display:flex;flex-wrap:wrap;
  align-items:baseline;gap:var(--s3) var(--s5);font-size:var(--t4)}
.trust b{font-size:var(--t2);font-family:var(--serif);font-weight:500}
.trust .pub{color:var(--green);font-weight:600}
.trust .note{color:var(--ink-3);font-size:var(--t5)}
section{margin-top:var(--s8)}
section+section{border-top:1px solid var(--line);padding-top:var(--s7)}
h2{font-family:var(--serif);font-weight:500;font-size:var(--t2);margin:0 0 var(--s5)}
.drop{border:1px dashed var(--edge);border-radius:var(--r);padding:var(--s7);text-align:center;
  background:#fff;transition:border-color .12s,background .12s}
.drop.over{border-color:var(--red);background:var(--wash)}
.drop p{margin:var(--s3) 0 0;color:var(--ink-2);font-size:var(--t5)}
.btn{background:var(--red);color:#fff;border:0;border-radius:var(--r);padding:var(--s3) var(--s5);
  font-weight:600;font-size:var(--t4);font-family:inherit;cursor:pointer}
.btn:hover{background:var(--red-deep)}
.btn[disabled]{background:var(--ink-4);cursor:default}
.btn.ghost{background:none;color:var(--ink-2);border:1px solid var(--edge)}
.btn.ghost:hover{background:var(--wash);color:var(--ink)}
.row{display:flex;flex-wrap:wrap;gap:var(--s4);align-items:center}
select,input[type=text]{padding:var(--s2) var(--s3);border:1px solid var(--edge);border-radius:var(--r);
  font-family:inherit;font-size:var(--t5);background:#fff;color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:var(--t5);margin-top:var(--s5)}
th{text-align:left;font-size:var(--t6);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
  font-weight:600;padding:var(--s3) var(--s4) var(--s3) 0;border-bottom:1px solid var(--line);white-space:nowrap}
th[data-k]{cursor:pointer}
th[data-k]:hover{color:var(--ink)}
th .ar{color:var(--red)}
td{padding:var(--s3) var(--s4) var(--s3) 0;border-bottom:1px solid var(--hair);vertical-align:top}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tw{overflow-x:auto}
.msg{margin-top:var(--s5);padding:var(--s4) var(--s5);border-radius:var(--r);font-size:var(--t5);border:1px solid}
.msg.ok{background:#F0FAF3;border-color:#BFE3CB;color:#14532D}
.msg.bad{background:#FDF2F2;border-color:#F0C7C7;color:#7F1D1D}
.msg ul{margin:var(--s3) 0 0;padding-left:var(--s6)}
.msg li{margin-top:var(--s1);font-variant-numeric:tabular-nums}
.empty{color:var(--ink-3);padding:var(--s7) 0;text-align:center}
.up{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s4);
  padding:var(--s4) 0;border-bottom:1px solid var(--hair);font-size:var(--t5)}
.up .meta{color:var(--ink-3)}
.up button{background:none;border:0;color:var(--ink-3);cursor:pointer;font-family:inherit;font-size:var(--t5);padding:0}
.up button:hover{color:var(--red)}
.pubbtn{background:none;border:1px solid var(--edge);border-radius:var(--r);padding:1px var(--s3);
  font-family:inherit;font-size:var(--t6);color:var(--ink-2);cursor:pointer;white-space:nowrap}
.pubbtn:hover{border-color:var(--ink-3);color:var(--ink)}
.pubbtn.on{border-color:#BFE3CB;background:#F0FAF3;color:var(--green);font-weight:600}
.pubbtn[disabled]{opacity:.5;cursor:default}
.hide{display:none}
/* ---- First run ----------------------------------------------------------
   Deliberately quiet: two numbered steps on the page's own type scale, no
   illustration, no coloured callout box. A broker arriving here has just paid
   for something, and a loud empty state reads as a product apologising for
   itself. The numbers carry the sequence; everything else is ordinary text. */
.steps{display:grid;gap:var(--s6);margin-top:var(--s6)}
@media (min-width:760px){.steps{grid-template-columns:1fr 1fr;gap:var(--s7)}}
.step{display:flex;gap:var(--s4);align-items:flex-start}
.stepn{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--wash);
  border:1px solid var(--edge);color:var(--ink-2);font-size:var(--t5);font-weight:600;
  display:flex;align-items:center;justify-content:center;margin-top:2px}
.step h3{font-family:var(--serif);font-weight:500;font-size:var(--t3);margin:0 0 var(--s3)}
.step p{margin:0 0 var(--s3);color:var(--ink-2)}
.step .fine{color:var(--ink-3);font-size:var(--t5)}
/* The template link is an <a> styled as a button, so it needs the same box the
   <button>s get — .btn alone leaves it inline and underlined. */
a.btn{display:inline-block;text-decoration:none;color:#fff}
a.btn:hover{color:#fff}
/* The section+section divider is drawn from DOM adjacency, which does not know
   about display:none. With #firstRun hidden, #addSec became "a section after a
   section" for the first time and picked up a rule above it — a stray line
   across the top of a returning broker's workspace. Scoped to this one pair on
   purpose: a blanket hidden-sibling rule would also strip the divider above
   Leads on first run, where two hidden sections sit between it and #firstRun
   and the divider is correct.
   (No backticks in this file's comments: the whole page is one template
   literal, so a backtick here ends it and the module stops parsing.) */
#firstRun.hide + #addSec{border-top:0;padding-top:0}
footer{border-top:1px solid var(--line);padding:var(--s6) 0;color:var(--ink-3);font-size:var(--t6)}
</style></head><body>
<header class="hdr"><div class="wrap">
  <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
  <nav><a href="/">Search</a><a href="/desk">My Desk</a><a href="/brokers">Brokers</a></nav>
</div></header>
<main><div class="wrap">
  <p class="kicker">Broker workspace</p>
  <h1 class="h">Your vault</h1>
  <p class="sub">Your own comp data, private to you. Upload a spreadsheet and it comes back
    organized &mdash; sortable and filterable by property and by market.</p>

  <!-- Visible from the first paint. Everything below the title waits on
       /api/vault (session -> entitlements -> two reads), and with both panes
       hidden the page spent that window looking half-rendered before the
       workspace popped in. The fetch's three outcomes each replace this:
       success hides #gate, a refusal rewrites it, so it can never linger. -->
  <div id="gate"><p class="empty">Loading your vault&hellip;</p></div>

  <div id="app" class="hide">
    <!-- The trust line's job is to prove a number stays at zero, which only
         works once there is something it could have counted. On day one it is
         a scoreboard reading 0-0 above an empty page, so it is hidden until
         the first import lands and #firstRun carries the privacy promise in
         words instead. See applyFirstRun(). -->
    <div class="trust hide" id="trustLine">
      <span><b id="cCount">0</b> comps</span>
      <span class="pub"><b id="cPub">0</b> published</span>
      <span class="note">Visible only to you. Nothing here is ever read into CompNinja&rsquo;s
        public records, and nothing is published unless you choose it.</span>
    </div>

    <!-- ------------------------------------------------------------------
         First run. Shown only when the vault is genuinely empty (no comps
         AND no imports), and replaced by the real workspace the moment
         anything lands.

         What it is fixing: the empty vault used to be a count of zero, an
         uploader, and three empty tables. The only route forward was
         "download a template, map your book into it, come back", which is
         homework with no visible payoff, and the one thing a broker could
         do immediately was at the bottom of the page under a heading about
         something else. This is where people quietly give up.

         So it says what the payoff is, states the effort honestly, and
         offers the ten-second path as a real alternative rather than a
         consolation prize.
         ------------------------------------------------------------------ -->
    <section id="firstRun" class="hide">
      <h2>Start here</h2>
      <p class="sub" style="margin-top:0">Two ways to get something out of this today. The
        second one takes about ten seconds and needs no spreadsheet.</p>

      <div class="steps">
        <div class="step">
          <span class="stepn">1</span>
          <div>
            <h3>Bring your own comps</h3>
            <p>Your closed deals become a private comp set that only you can see. They
              appear inside your own valuation reports, badged &ldquo;From your vault&rdquo;,
              and they count toward the number at the top of the report. They are never
              read into CompNinja&rsquo;s public records, never included in an export or a
              shared link, and never shown to another broker.</p>
            <!-- The friction this removes is fear, not typing: a broker looking at a
                 ten-column template assumes all ten are mandatory and that a deal with
                 an undisclosed price cannot go in. Neither is true, and saying so is
                 what makes the first upload feel possible. -->
            <p class="fine">Four columns are required: address, property type, sale or
              lease, and the date. Everything else is optional, so undisclosed deals
              still count.</p>
            <div class="row" style="margin-top:var(--s4)">
              <a class="btn" href="/api/vault/template" id="frTpl">Download the template</a>
              <button class="btn ghost" id="frPick">Choose a spreadsheet</button>
            </div>
          </div>
        </div>

        <div class="step">
          <span class="stepn">2</span>
          <div>
            <h3>Or just tell us where you work</h3>
            <p>Add the markets you cover and you will start seeing property owners in them
              who have asked for a valuation. Their details stay anonymous until you ask
              for an introduction, and CompNinja makes the introduction by hand.</p>
            <p class="fine">Nothing to upload. This works on an empty vault.</p>
            <div class="row" style="margin-top:var(--s4)">
              <button class="btn ghost" id="frCoverage">Choose your markets</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="addSec">
      <h2>Add comps</h2>
      <div class="drop" id="drop">
        <button class="btn" id="pick">Choose a spreadsheet</button>
        <p>or drop a .csv here &middot; <a href="/api/vault/template" id="tpl">download the template</a></p>
        <input type="file" id="file" accept=".csv,text/csv" class="hide"/>
      </div>
      <div id="res"></div>
    </section>

    <section id="compsSec">
      <h2>Your comps</h2>
      <div class="row">
        <label>Market <select id="fMarket"><option value="">All</option></select></label>
        <label>Type <select id="fType"><option value="">All</option></select></label>
        <span class="note" id="shown"></span>
      </div>
      <div class="tw"><table id="tbl">
        <thead><tr>
          <th data-k="address">Address</th><th data-k="market">Market</th>
          <th data-k="property_type">Type</th><th data-k="transaction">Deal</th>
          <th data-k="deal_date">Date</th><th data-k="price" class="num">Price</th>
          <th data-k="size_sqft" class="num">Size</th><th data-k="price_per_sqft" class="num">$/SF</th>
          <th data-k="published">Public</th>
        </tr></thead><tbody id="tbody"></tbody>
      </table></div>
      <div class="empty hide" id="none">Nothing here yet. Upload a spreadsheet above.</div>
    </section>

    <section id="leads">
      <h2>Leads in your markets</h2>
      <p class="sub" style="margin-top:0">Property owners requesting a Broker Opinion of Value
        in markets you cover. Details are anonymized; request an introduction and the
        CompNinja team connects you. Removing every market re-fills the earned ones on your next visit.</p>
      <div class="row" id="covRow"></div>
      <div class="row" style="margin-top:var(--s4)">
        <label>Market <input id="covMarket" type="text" placeholder="City, ST"/></label>
        <label>Type <select id="covType"></select></label>
        <button class="btn ghost" id="covAdd">Watch this market</button>
      </div>
      <div id="leadMsg"></div>
      <!-- Hidden while there are no rows: a header row with nothing under it is
           the same "is this broken?" signal the empty comps table gave, and a
           broker sent here by step 1 of the first run lands on it directly. -->
      <div class="tw hide" id="leadTableWrap"><table>
        <thead><tr><th>Received</th><th>Market</th><th>Type</th><th class="num">Size</th><th></th></tr></thead>
        <tbody id="leadRows"></tbody>
      </table></div>
      <div class="empty hide" id="noLeads">No leads in your markets in the last 90 days.</div>
    </section>

    <section id="importsSec">
      <h2>Imports</h2>
      <div id="ups"></div>
    </section>
  </div>
</div></main>
<footer><div class="wrap">Private broker workspace &middot; CompNinja</div></footer>
<script>window.__VAULT_BOOT__=${bootJson};</script>
<script>
(function(){
  var $=function(id){return document.getElementById(id)};
  var esc=function(s){var d=document.createElement("div");d.textContent=s==null?"":String(s);return d.innerHTML};
  // esc() is only innerHTML-safe: it leaves a literal " untouched, which
  // breaks out of a quoted attribute. Attribute values built from free text
  // (the coverage chip's aria-label/title) must go through this instead.
  // Order matters: esc() first (so a literal & in the text becomes &amp;),
  // then &quot; the remaining bare double quotes.
  var escA=function(s){return esc(s).replace(/"/g,"&quot;")};
  var comps=[],sortK="deal_date",sortAsc=false,leadsLoaded=false;

  var money=function(n){return n==null?"":"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:0})};
  var num=function(n){return n==null?"":Number(n).toLocaleString("en-US",{maximumFractionDigits:0})};
  var psf=function(n){return n==null?"":"$"+Number(n).toFixed(2)};

  function gate(html){ $("gate").innerHTML=html; $("gate").className=""; $("app").className="hide"; }

  function apply(o){
    if(o.s===401) return gate('<div class="msg bad">Please <a href="/desk">sign in</a> to open your vault.</div>');
    // "Part of Pro", not "part of the broker plan". There is one subscription
    // as of 2026-08-05 and the vault is a capability of it, so naming a broker
    // plan sends someone off to look for a product that cannot be bought.
    // The link goes to the plan card on /desk rather than /brokers: /brokers
    // explains contributing comps for a Verified badge, which is a different
    // thing entirely and is free.
    if(o.s===403) return gate('<div class="msg bad">The private vault is part of Pro. '+
      '<a href="/desk">See your plan</a></div>');
    if(o.s!==200) return gate('<div class="msg bad">'+esc((o.j&&o.j.error)||"Could not load your vault.")+'</div>');
    $("gate").className="hide"; $("app").className="";
    comps=o.j.comps||[];
    $("cCount").textContent=(o.j.counts&&o.j.counts.returned)||0;
    $("cPub").textContent=(o.j.counts&&o.j.counts.published)||0;
    fillFilter("fMarket",o.j.markets||[]); fillFilter("fType",o.j.types||[]);
    renderUploads(o.j.uploads||[]);
    applyFirstRun(comps.length,(o.j.uploads||[]).length);
    // Loaded once per page visit, not on every filter change/publish/
    // import-delete that re-runs load() — those all hit /api/vault, a
    // different endpoint, and re-querying /api/broker/leads on each one
    // would be wasted work with no new information. It lives in apply()
    // rather than load() so the baked-in boot payload path (which never
    // calls load()) still populates the Leads section on first paint.
    if(!leadsLoaded){ leadsLoaded=true; loadLeads(); }
    render();
  }

  function load(){
    var q=[],m=$("fMarket").value,t=$("fType").value;
    if(m)q.push("market="+encodeURIComponent(m));
    if(t)q.push("type="+encodeURIComponent(t));
    fetch("/api/vault"+(q.length?"?"+q.join("&"):""),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(apply)
      .catch(function(){ gate('<div class="msg bad">Could not reach the server. Please try again.</div>'); });
  }

  // Rebuild the options without losing what the broker had selected.
  function fillFilter(id,vals){
    var el=$(id),cur=el.value;
    if(cur&&vals.indexOf(cur)<0)vals=vals.concat([cur]);
    el.innerHTML='<option value="">All</option>'+vals.map(function(v){
      return '<option value="'+esc(v)+'"'+(v===cur?" selected":"")+">"+esc(v)+"</option>"}).join("");
  }

  function render(){
    var rows=comps.slice().sort(function(a,b){
      var x=a[sortK],y=b[sortK];
      if(x==null&&y==null)return 0; if(x==null)return 1; if(y==null)return -1;
      if(typeof x==="number"&&typeof y==="number")return sortAsc?x-y:y-x;
      return sortAsc?String(x).localeCompare(String(y)):String(y).localeCompare(String(x));
    });
    $("none").className=rows.length?"empty hide":"empty";
    $("shown").textContent=rows.length?rows.length+" shown":"";
    $("tbody").innerHTML=rows.map(function(c){
      // Published state is a two-way toggle, never a checkbox that could be
      // flipped by a stray click: publishing is a one-way-ish public act, so
      // it goes through a button and a confirm.
      var pub=c.published
        ? '<button class="pubbtn on" data-pub="'+esc(c.id)+'" data-on="1">Published</button>'
        : '<button class="pubbtn" data-pub="'+esc(c.id)+'">Publish</button>';
      return "<tr><td>"+esc(c.address)+"</td><td>"+esc(c.market)+"</td><td>"+esc(c.property_type)+
        "</td><td>"+esc(c.transaction)+"</td><td>"+esc(c.deal_date)+
        '</td><td class="num">'+money(c.price)+'</td><td class="num">'+num(c.size_sqft)+
        '</td><td class="num">'+psf(c.price_per_sqft)+"</td><td>"+pub+"</td></tr>";
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll("th[data-k]"),function(th){
      var on=th.getAttribute("data-k")===sortK;
      th.innerHTML=th.textContent.replace(/[ \\u25b2\\u25bc]+$/,"")+(on?' <span class="ar">'+(sortAsc?"\\u25b2":"\\u25bc")+"</span>":"");
    });
  }

  // ---- First run vs the real workspace --------------------------------------
  // Keyed on comps AND uploads, not comps alone. A broker whose only import was
  // entirely rejected, or who has deleted every comp out of an import, has
  // already been through the door once — showing them "Start here" again would
  // read as their work having been thrown away.
  //
  // Everything hidden here is hidden because it is EMPTY, not because it is
  // unimportant: an empty table with a header row and a "nothing here yet" line
  // reads as a broken page, and the vault had three of them stacked up.
  function applyFirstRun(compCount,uploadCount){
    var first=compCount===0&&uploadCount===0;
    $("firstRun").className=first?"":"hide";
    // The uploader lives in both places on first run, so the plain "Add comps"
    // section stands down and step 1 owns it. Both buttons drive the same
    // <input type=file>, so there is still only one upload path.
    $("addSec").className=first?"hide":"";
    $("trustLine").className=first?"trust hide":"trust";
    $("compsSec").className=first?"hide":"";
    $("importsSec").className=first?"hide":"";
  }

  function renderUploads(ups){
    $("ups").innerHTML=ups.length?ups.map(function(u){
      return '<div class="up"><span>'+esc(u.filename||"Untitled import")+
        ' <span class="meta">&middot; '+u.row_count+" comps"+
        (u.skipped_count?", "+u.skipped_count+" skipped":"")+
        " &middot; "+esc(String(u.created_at||"").slice(0,10))+'</span></span>'+
        '<button data-del="'+esc(u.id)+'">Remove</button></div>';
    }).join(""):'<p class="empty">No imports yet.</p>';
  }

  var PROP_TYPES=["Industrial","Office","Retail","Multifamily","Land","Residential"];
  // noseed=true after a delete: that call must NOT re-earn the market the
  // broker just removed. A plain page visit (no arg) always reseeds, which is
  // what the section's own copy promises.
  function loadLeads(noseed){
    fetch("/api/broker/leads"+(noseed?"?noseed=1":""),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){
          // No stale rows left on screen under an error message.
          $("covRow").innerHTML=""; $("leadRows").innerHTML=""; $("leadTableWrap").className="tw hide"; $("noLeads").className="empty hide";
          $("leadMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't load leads.")+"</div>";
          return;
        }
        $("leadMsg").innerHTML="";
        var cov=o.j.coverage||[];
        renderCoverage(cov);
        renderLeads(o.j.leads||[],cov.length);
      })
      .catch(function(){
        $("covRow").innerHTML=""; $("leadRows").innerHTML=""; $("leadTableWrap").className="tw hide"; $("noLeads").className="empty hide";
        $("leadMsg").innerHTML='<div class="msg bad">Couldn\\'t load leads. Please try again.</div>';
      });
  }
  function renderCoverage(cov){
    $("covRow").innerHTML=cov.length?cov.map(function(c){
      var label=escA(c.market)+" "+escA(c.property_type);
      return '<span class="pubbtn" style="cursor:default">'+esc(c.market)+" \\u00b7 "+esc(c.property_type)+
        ' <button data-cov="'+escA(c.id)+'" aria-label="Stop watching '+label+'" title="Stop watching '+label+
        '" style="background:none;border:0;color:var(--ink-3);cursor:pointer;font-size:inherit;padding:0 0 0 4px">&times;</button></span>';
    }).join(" "):'<span class="empty" style="padding:0">No markets yet. Add one below, or submit comps to earn them.</span>';
  }
  // covCount lets an empty inbox tell two situations apart: nothing to show
  // because there is no coverage yet (the covRow hint above already says so,
  // so #noLeads stays hidden) vs. coverage exists but nothing has come in
  // (that's the case #noLeads is for).
  function renderLeads(leads,covCount){
    var showEmpty=leads.length===0&&covCount>0;
    $("noLeads").className=showEmpty?"empty":"empty hide";
    $("leadTableWrap").className=leads.length?"tw":"tw hide";
    $("leadRows").innerHTML=leads.map(function(l){
      var btn=l.intro_requested
        ? '<button class="pubbtn on" disabled>Intro requested</button>'
        : '<button class="pubbtn" data-intro="'+escA(l.id)+'">Request introduction</button>';
      return "<tr><td>"+esc(String(l.ts||"").slice(0,10))+"</td><td>"+esc(l.market)+"</td><td>"+esc(l.type)+
        '</td><td class="num">'+(l.size_sqft?num(l.size_sqft)+" SF":"")+"</td><td>"+btn+"</td></tr>";
    }).join("");
  }
  $("covType").innerHTML=PROP_TYPES.map(function(t){return "<option>"+t+"</option>"}).join("");
  $("covMarket").addEventListener("keydown",function(e){
    if(e.key==="Enter"){ e.preventDefault(); $("covAdd").click(); }
  });
  $("covAdd").addEventListener("click",function(){
    var b=$("covAdd");
    b.disabled=true;
    fetch("/api/broker/coverage",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({market:$("covMarket").value,property_type:$("covType").value})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        b.disabled=false;
        if(o.s!==200){ $("leadMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't add that market.")+"</div>"; return; }
        $("covMarket").value=""; loadLeads();
      })
      .catch(function(){ b.disabled=false;
        $("leadMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was added.</div>'; });
  });
  document.addEventListener("click",function(e){
    var cov=e.target.getAttribute&&e.target.getAttribute("data-cov");
    if(cov){
      fetch("/api/broker/coverage?id="+encodeURIComponent(cov),{method:"DELETE",credentials:"same-origin"})
        .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
        .then(function(o){
          if(o.s!==200){ $("leadMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't remove that market.")+"</div>"; return; }
          // noseed: the market just removed must not be re-earned by this
          // same reload. A full page visit still reseeds it.
          loadLeads(true);
        })
        .catch(function(){ $("leadMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>'; });
      return;
    }
    var intro=e.target.getAttribute&&e.target.getAttribute("data-intro");
    if(intro){
      e.target.disabled=true; e.target.textContent="Sending\\u2026";
      fetch("/api/broker/leads/intro",{method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify({lead_id:intro})})
        .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
        .then(function(o){
          if(o.s!==200){
            // Re-query by selector: loadLeads may have re-rendered this row
            // (a concurrent click elsewhere) and detached the captured node.
            var again=document.querySelector('[data-intro="'+intro+'"]');
            if(again){ again.disabled=false; again.textContent="Request introduction"; }
            $("leadMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't send that request.")+"</div>";
            return;
          }
          loadLeads();
        })
        .catch(function(){
          var again=document.querySelector('[data-intro="'+intro+'"]');
          if(again){ again.disabled=false; again.textContent="Request introduction"; }
          $("leadMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was sent.</div>';
        });
    }
  });

  function upload(file){
    if(!file)return;
    $("pick").disabled=true; $("res").innerHTML='<div class="msg ok">Reading '+esc(file.name)+"&hellip;</div>";
    var fr=new FileReader();
    fr.onerror=function(){ $("pick").disabled=false; $("res").innerHTML='<div class="msg bad">Could not read that file.</div>'; };
    fr.onload=function(){
      fetch("/api/vault/upload",{method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({filename:file.name,csv:String(fr.result||"")})})
        .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
        .then(function(o){
          $("pick").disabled=false;
          var j=o.j||{};
          // Line-numbered problems are the point: a broker fixing a spreadsheet
          // needs to know WHICH row, in the numbering Excel shows them.
          var errs=(j.errors&&j.errors.length)?"<ul>"+j.errors.map(function(e){
            return "<li>"+esc(e)+"</li>"}).join("")+"</ul>":"";
          if(o.s!==200){
            $("res").innerHTML='<div class="msg bad">'+esc(j.error||"That file could not be imported.")+errs+"</div>";
            return;
          }
          var bits=["Imported "+j.imported+" comp"+(j.imported===1?"":"s")];
          if(j.skipped)bits.push(j.skipped+" row"+(j.skipped===1?"":"s")+" skipped");
          if(j.duplicates)bits.push(j.duplicates+" duplicate"+(j.duplicates===1?"":"s")+" in the file");
          $("res").innerHTML='<div class="msg '+(j.skipped?"bad":"ok")+'">'+esc(bits.join(" \\u00b7 "))+errs+"</div>";
          load();
        })
        .catch(function(){ $("pick").disabled=false;
          $("res").innerHTML='<div class="msg bad">The upload did not reach the server. Nothing was saved.</div>'; });
    };
    fr.readAsText(file);
  }

  $("pick").addEventListener("click",function(){ $("file").click() });
  // Step 1's button is the same door as #pick — one <input type=file>, so an
  // upload started here lands in the same handler and the same result message.
  $("frPick").addEventListener("click",function(){ $("file").click() });
  // Step 2 does not duplicate the coverage form; it takes the broker to the one
  // that already exists and puts the cursor in it. A second copy of that input
  // would be a second thing to keep in step with the coverage rules.
  $("frCoverage").addEventListener("click",function(){
    $("leads").scrollIntoView({behavior:"smooth",block:"start"});
    // After the scroll settles, so focus does not fight the animation.
    setTimeout(function(){ $("covMarket").focus(); },420);
  });
  $("file").addEventListener("change",function(e){ upload(e.target.files[0]); e.target.value=""; });
  ["dragenter","dragover"].forEach(function(ev){ $("drop").addEventListener(ev,function(e){
    e.preventDefault(); $("drop").classList.add("over"); })});
  ["dragleave","drop"].forEach(function(ev){ $("drop").addEventListener(ev,function(e){
    e.preventDefault(); $("drop").classList.remove("over"); })});
  $("drop").addEventListener("drop",function(e){ upload(e.dataTransfer.files[0]) });
  $("fMarket").addEventListener("change",load);
  $("fType").addEventListener("change",load);
  document.querySelector("#tbl thead").addEventListener("click",function(e){
    var th=e.target.closest("th[data-k]"); if(!th)return;
    var k=th.getAttribute("data-k");
    if(k===sortK)sortAsc=!sortAsc; else{sortK=k;sortAsc=false;}
    render();
  });
  // Publish / unpublish. The confirm text is deliberately specific about what
  // publishing DOES and about the one thing it cannot undo: once a published
  // comp has been served inside a report, that report is cached and the public
  // corpus has already harvested it. Unpublishing stops future offers; it
  // cannot reach back into reports already delivered. A broker who finds that
  // out afterwards would be right to feel misled, so it is said up front.
  $("tbody").addEventListener("click",function(e){
    var b=e.target.closest("button[data-pub]"); if(!b)return;
    var on=b.getAttribute("data-on")==="1";
    if(on){
      if(!confirm("Stop publishing this comp?\\n\\nIt will no longer be offered in new reports. Reports that already included it keep it, and it stays in the public records it has already reached."))return;
    }else{
      if(!confirm("Publish this comp?\\n\\nIt becomes part of CompNinja's public records, credited to your firm by name in every report it appears in. Everything else in your vault stays private.\\n\\nYou can stop publishing it later, but reports that already used it will keep it."))return;
    }
    b.disabled=true; b.textContent=on?"Removing\\u2026":"Publishing\\u2026";
    fetch("/api/vault/publish",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({id:b.getAttribute("data-pub"),publish:!on})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){
          $("res").innerHTML='<div class="msg bad">'+esc(o.j.error||"That didn\\'t go through.")+"</div>";
        }else if(o.j.published&&o.j.creditedTo){
          $("res").innerHTML='<div class="msg ok">Published, credited to '+esc(o.j.creditedTo)+".</div>";
        }else{
          $("res").innerHTML="";
        }
        load();
      })
      .catch(function(){ b.disabled=false;
        $("res").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>'; });
  });

  $("ups").addEventListener("click",function(e){
    var b=e.target.closest("button[data-del]"); if(!b)return;
    if(!confirm("Remove this import and all the comps that came in with it?"))return;
    fetch("/api/vault/upload?id="+encodeURIComponent(b.getAttribute("data-del")),
      {method:"DELETE",credentials:"same-origin"}).then(load).catch(load);
  });

  // The server bakes the first answer into the page (window.__VAULT_BOOT__)
  // so the workspace renders in the same paint as the title, with no fetch
  // and no pop-in. load() remains the path for filter changes, post-upload
  // refreshes, and the fallback when the boot payload could not be built.
  var boot=window.__VAULT_BOOT__;
  if(boot&&typeof boot.s==="number"){apply(boot);}else{load();}
})();
</script></body></html>`;
}

module.exports = { renderVaultHTML };
