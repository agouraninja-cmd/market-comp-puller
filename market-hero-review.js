// ---------------------------------------------------------------------------
// Market-hero review page — GET /admin/heroes.
//
// The machine can catch a wrong-size or suspiciously-small JPEG. Only a
// person can say "that is not Dallas" or "that is just clouds". This page
// shows every curated city at the same 340px cover crop the market header
// uses, with the technical grade beside it.
//
// Pure: chrome in, HTML string out. The grades are fetched after the admin
// gate, same pattern as /admin and /hq. A stray ${ in the template literal
// emits broken JavaScript rather than failing the build, so the test compiles
// the emitted script.
// ---------------------------------------------------------------------------

"use strict";

function renderHeroReviewHTML(chrome) {
  chrome = chrome || {};
  const CN_LOGO = chrome.CN_LOGO || "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>CompNinja Market heroes</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<style>
*{box-sizing:border-box}
:root{
  --ink:#1A2433;--ink-2:#4C5665;--ink-3:#68707E;--ink-4:#C7CBD2;
  --red:#B91C1C;--red-deep:#991B1B;--red-pale:#E8B4B4;--red-wash:#FCF3F2;
  --paper:#FBFBF9;--line:#E4E2DA;--hair:#F0EFE9;--wash:#F5F4EF;--edge:#D8D4C9;
  --foot-ink:#B8C0CC;--foot-link:#D5DAE2;
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
.wrap{max-width:1024px;margin:0 auto;padding:0 var(--s6)}
.hdr{border-bottom:1px solid var(--line);background:var(--paper)}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:var(--s4);padding-top:var(--s5);padding-bottom:var(--s5)}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink)}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:var(--t3);font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.wordmark b{color:var(--red);font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s4) var(--s5);font-size:var(--t5)}
.hdr nav a{color:var(--ink-2);white-space:nowrap}.hdr nav a:hover{color:var(--ink)}
main{flex:1;padding:var(--s8) 0 var(--s9)}
.kicker{font-size:var(--t6);letter-spacing:.16em;text-transform:uppercase;color:var(--red);font-weight:600}
h1.h{font-family:var(--serif);font-weight:500;letter-spacing:-.005em;color:var(--ink);margin:var(--s4) 0 0;font-size:var(--t1);line-height:1.15}
.sub{color:var(--ink-2);font-size:var(--t4);max-width:62ch;margin:var(--s4) 0 0}
.gate{background:#fff;border:1px solid var(--edge);border-radius:var(--r);padding:var(--s6);max-width:400px;margin:var(--s8) auto;text-align:center}
.gate .lab{display:block;font-size:var(--t5);color:var(--ink-3)}
.gate input{width:100%;padding:var(--s4);border:1px solid var(--edge);border-radius:var(--r);margin:var(--s4) 0;
  font-size:var(--t4);font-family:inherit;color:var(--ink);background:var(--paper)}
.gate input:focus{outline:none;border-color:var(--red)}
.gate button,.btn{background:var(--red);color:#fff;border:0;border-radius:var(--r);padding:var(--s4) var(--s6);font-weight:600;
  font-size:var(--t4);font-family:inherit;cursor:pointer}
.gate button:hover,.btn:hover{background:var(--red-deep)}
.btn.mute{background:transparent;color:var(--ink-2);border:1px solid var(--edge);padding:var(--s3) var(--s4);font-weight:600;font-size:var(--t5)}
.btn.mute.on{color:var(--ink);border-color:var(--ink)}
.err{color:var(--red);font-size:var(--t5);margin-top:var(--s3)}
.bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--s4);margin:var(--s6) 0}
.tally{font-size:var(--t4);color:var(--ink-2)}
.tally b{color:var(--ink);font-weight:600}
.card{border-top:1px solid var(--line);padding:var(--s6) 0}
.card-h{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:var(--s3) var(--s5);margin:0 0 var(--s4)}
.card-h h2{font-family:var(--serif);font-weight:500;font-size:var(--t2);letter-spacing:-.005em;color:var(--ink);margin:0}
.meta{font-size:var(--t5);color:var(--ink-3)}
.badge{font-size:var(--t6);letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--ink-2)}
.badge.look{color:var(--red)}
.frame{position:relative;height:340px;overflow:hidden;background:var(--ink);color:#fff}
.frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 40%}
.frame.full{height:auto;background:var(--wash)}
.frame.full img{position:static;width:100%;height:auto;object-fit:contain;display:block}
.reasons{color:var(--red);font-size:var(--t5);margin:var(--s3) 0 0}
.links{font-size:var(--t5);margin:var(--s3) 0 0}
.links a{margin-right:var(--s5)}
footer{background:var(--ink);color:var(--foot-ink);font-size:var(--t5)}
footer .wrap{padding:var(--s7) var(--s6);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--s4)}
footer .wordmark{color:#fff}
footer a{color:var(--foot-link);text-decoration:none}footer a:hover{color:#fff}
@media(max-width:700px){.frame{height:240px}}
</style></head><body>
<header class="hdr">
  <div class="wrap">
    <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
    <nav>
      <a href="/hq">HQ</a>
      <a href="/admin">Analytics</a>
      <a href="/dev">Dev hub</a>
      <a href="/contacts">Contacts</a>
      <a href="/">Run a report</a>
    </nav>
  </div>
</header>
<main>
<div class="wrap">
<div class="kicker">Internal</div>
<h1 class="h">Market heroes</h1>
<p class="sub">Each photograph as stored. The badge catches a wrong size or a file too small to be sharp; those live headers automatically switch to a satellite aerial of the same city. A technical OK still does not mean it is a good picture &mdash; look at the crop.</p>
<div id="gate" class="gate"><span class="lab">Enter admin key</span>
<input id="k" type="password" placeholder="ADMIN_KEY" autocomplete="off"/>
<button id="go">Review photos</button><div id="err" class="err"></div></div>
<div id="app" style="display:none">
  <div class="bar">
    <p class="tally" id="tally"></p>
    <div>
      <button class="btn mute on" id="viewCrop" type="button">Header crop</button>
      <button class="btn mute" id="viewFull" type="button">Whole photo</button>
    </div>
  </div>
  <div id="list"></div>
</div>
</div>
</main>
<footer><div class="wrap">
  <span class="wordmark">Comp<b style="color:#EF4444">Ninja</b></span>
  <span>Internal page &middot; <a href="/hq">HQ</a> &middot; <a href="/">Back to the app</a></span>
</div></footer>
<script>
var KEYK="cn_admin_key";
var FULL=false;
function grantAdminAccess(key){try{fetch("/api/admin-access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:key})}).catch(function(){});}catch(e){}}
function el(id){return document.getElementById(id);}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function render(d){
  var rows=d.rows||[];
  var look=rows.filter(function(r){return !r.ok;});
  el("tally").innerHTML=look.length
    ? "<b>"+look.length+"</b> of "+rows.length+" need a look"
    : "All <b>"+rows.length+"</b> pass the file checks &mdash; still look at the pictures";
  var ordered=look.concat(rows.filter(function(r){return r.ok;}));
  el("list").innerHTML=ordered.map(function(r){
    var badge=r.ok?'<span class="badge">OK</span>':'<span class="badge look">Needs a look</span>';
    var why=(r.reasons||[]).length?'<p class="reasons">'+r.reasons.map(esc).join(" · ")+"</p>":"";
    if(!r.ok) why+='<p class="reasons">Live pages show a satellite aerial of this city instead.</p>';
    var links=[];
    if(r.samplePath)links.push('<a href="'+esc(r.samplePath)+'" target="_blank" rel="noopener">Live page</a>');
    if(r.commonsUrl)links.push('<a href="'+esc(r.commonsUrl)+'" target="_blank" rel="noopener">Commons original</a>');
    var kb=r.bytes?Math.round(r.bytes/1024)+" KB":"no file";
    var dims=(r.width&&r.height)?(r.width+"×"+r.height):"unreadable";
    return '<div class="card">'+
      '<div class="card-h"><h2>'+esc(r.label)+'</h2>'+badge+'</div>'+
      '<div class="frame'+(FULL?" full":"")+'"><img src="'+esc(r.src)+'" alt="'+esc(r.alt||r.label)+'"/></div>'+
      '<p class="meta">'+esc(dims)+" · "+esc(kb)+(r.credit?" · "+esc(r.credit):"")+(r.license?" · "+esc(r.license):"")+"</p>"+
      why+
      (links.length?'<p class="links">'+links.join("")+"</p>":"")+
    "</div>";
  }).join("");
}
function setView(full){
  FULL=!!full;
  el("viewCrop").className="btn mute"+(FULL?"":" on");
  el("viewFull").className="btn mute"+(FULL?" on":"");
  var frames=document.querySelectorAll(".frame");
  for(var i=0;i<frames.length;i++) frames[i].className="frame"+(FULL?" full":"");
}
function load(key){
  fetch("/api/admin/heroes",{headers:{"x-admin-key":key}}).then(function(r){
    if(r.status===401){throw new Error(key?"Incorrect key.":"");}
    if(r.status===404){throw new Error("Hero review is disabled — set ADMIN_KEY on the server.");}
    if(!r.ok){throw new Error("Error "+r.status);}
    return r.json();
  }).then(function(d){
    if(key){try{sessionStorage.setItem(KEYK,key);}catch(e){} grantAdminAccess(key);}
    render(d);
    el("err").textContent="";el("gate").style.display="none";el("app").style.display="block";
  }).catch(function(e){
    el("err").textContent=e.message;
    el("gate").style.display="block";el("app").style.display="none";
  });
}
el("go").addEventListener("click",function(){load(el("k").value.trim());});
el("k").addEventListener("keydown",function(e){if(e.key==="Enter")load(e.target.value.trim());});
el("viewCrop").addEventListener("click",function(){setView(false);});
el("viewFull").addEventListener("click",function(){setView(true);});
try{var sk=sessionStorage.getItem(KEYK);load(sk||"");}catch(e){load("");}
</script>
</body></html>`;
}

module.exports = { renderHeroReviewHTML };
