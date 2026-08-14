// ---------------------------------------------------------------------------
// The messaging hub page — the whole /hub/<id> screen.
//
// NOT the connection hub at /brokers. See the naming warning in
// docs/superpowers/specs/2026-08-13-messaging-hub-design.md.
//
// Pure like vault-page.js: it takes an id and the site's shared chrome and
// returns a string. No I/O, no requires, no clock reads.
//
// THIS PAGE SHIPS WITH NO DATA IN IT, and that is not an oversight. The invite
// token lives in the URL FRAGMENT (/hub/<id>#k=…), which browsers never send
// to a server, so at render time we genuinely do not know who is asking. The
// page boots, reads its own hash, exchanges the token for a cookie via POST
// /api/hub/access, and only then reads the hub. That is the same trade
// POST /api/report-access makes: one extra round trip, and the credential
// stays out of Render's access logs and out of every outbound Referer.
//
// esc() is duplicated rather than imported, matching vault-page.js and the
// four copies in server.js. It is three lines and pure.
// ---------------------------------------------------------------------------

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

function renderHubHTML(hubId, chrome) {
  chrome = chrome || {};
  const CN_LOGO = chrome.CN_LOGO || "";
  const THEME_CSS = chrome.THEME_CSS || "";
  const THEME_BOOT = chrome.THEME_BOOT || "";
  const ACCOUNT_NAV_CSS = chrome.ACCOUNT_NAV_CSS || "";
  const ACCOUNT_NAV_JS = chrome.ACCOUNT_NAV_JS || "";
  const ACCOUNT_NAV_SLOTS = chrome.ACCOUNT_NAV_SLOTS || "";
  const ACCOUNT_NAV_PRICING = chrome.ACCOUNT_NAV_PRICING || "";
  const id = String(hubId || "");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comp hub · CompNinja</title>
<meta name="robots" content="noindex, nofollow">
${THEME_BOOT}
<style>
${THEME_CSS}
${ACCOUNT_NAV_CSS}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit;text-decoration:none}
.hdr{position:sticky;top:0;z-index:1000;background:var(--bg);border-bottom:1px solid var(--line);
  padding:12px 20px;display:flex;align-items:center;gap:18px}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;font-size:13.5px;margin-left:auto}
.hdr nav a{color:var(--ink-2)}.hdr nav a:hover{color:var(--ink)}
.wrap{max-width:1000px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:22px;margin:0 0 4px;line-height:1.2}
.sub{color:var(--ink-2);font-size:13.5px;margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:20px}
.msg{padding:14px 16px;border:1px solid var(--line);border-radius:8px;background:var(--wash);
  color:var(--ink-body);font-size:14px}
.msg.bad{border-color:var(--bad,#b4433a)}
h2{font-size:15px;margin:0 0 12px;letter-spacing:.01em}
.tblwrap{overflow-x:auto}
table{width:100%;min-width:640px;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:600;color:var(--ink-2);border-bottom:1px solid var(--ink);
  padding:0 10px 7px 0;white-space:nowrap}
td{padding:9px 10px 9px 0;border-bottom:1px solid var(--line);vertical-align:top}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:999px;
  border:1px solid var(--line);color:var(--ink-2);white-space:nowrap}
.stream{display:flex;flex-direction:column;gap:14px;margin-bottom:18px}
.bub{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--card)}
.bub .who{font-size:12px;color:var(--ink-3);margin-bottom:3px}
.bub .txt{white-space:pre-wrap;word-break:break-word}
textarea{width:100%;min-height:76px;padding:10px;border:1px solid var(--line);border-radius:8px;
  background:var(--card);color:var(--ink);font:inherit;resize:vertical}
.btn{display:inline-block;border:1px solid var(--ink);background:var(--ink);color:var(--bg);
  border-radius:8px;padding:8px 14px;font-size:13.5px;cursor:pointer;font-weight:600}
.btn[disabled]{opacity:.5;cursor:default}
.foot{color:var(--ink-3);font-size:12px;margin-top:30px;line-height:1.5}
.hide{display:none!important}
</style></head><body>
<header class="hdr">
  <a href="/" aria-label="CompNinja">${CN_LOGO}</a>
  <nav>${ACCOUNT_NAV_PRICING}${ACCOUNT_NAV_SLOTS}</nav>
</header>${ACCOUNT_NAV_JS}
<div class="wrap">
  <div id="load" class="msg">Opening this hub…</div>
  <div id="err" class="msg bad hide"></div>

  <div id="hub" class="hide">
    <h1 id="title"></h1>
    <p class="sub" id="sub"></p>

    <div class="card">
      <h2>Comps in this hub</h2>
      <div id="noitems" class="msg hide">No comps have been sent into this hub yet.</div>
      <div class="tblwrap"><table id="tbl" class="hide">
        <thead><tr>
          <th>Address</th><th>Type</th><th>Deal</th><th>Date</th>
          <th class="num">Price</th><th class="num">Size</th><th class="num">$/SF</th><th></th>
        </tr></thead><tbody id="rows"></tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Notes</h2>
      <div class="stream" id="stream"></div>
      <div id="nomsg" class="msg hide">No notes yet.</div>
      <div id="composer" class="hide">
        <textarea id="body" maxlength="4000" placeholder="Add a note for everyone in this hub"></textarea>
        <div style="margin-top:8px"><button class="btn" id="send">Post note</button></div>
      </div>
      <div id="readonly" class="msg hide"></div>
    </div>

    <p class="foot">
      Every valuation on CompNinja is an automated estimate, not an appraisal.
      Comps in this hub were sent by the broker who created it.
    </p>
  </div>
</div>
<script>
(function(){
  var HUB_ID = ${JSON.stringify(id)};
  var el = function(x){ return document.getElementById(x); };
  var cursor = "";
  var poll = null;

  function show(n, on){ el(n).classList.toggle("hide", !on); }
  function fail(text){
    show("load", false); show("hub", false);
    el("err").textContent = text; show("err", true);
    stopPolling();
  }

  function money(v){
    var n = Number(v);
    if (!isFinite(n) || !n) return "";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function num(v){
    var n = Number(v);
    if (!isFinite(n) || !n) return "";
    return Math.round(n).toLocaleString("en-US");
  }

  // The token rides in the fragment, so it never reaches a server log. Strip
  // it from the address bar the moment it has been exchanged: a hub link is
  // often opened on a shared screen, and leaving a live credential visible in
  // the URL bar is the same mistake as putting it in the query string.
  function tokenFromHash(){
    var m = /(?:^|[#&])k=([A-Za-z0-9_-]+)/.exec(location.hash || "");
    return m ? m[1] : "";
  }

  function render(d){
    show("load", false); show("err", false); show("hub", true);
    el("title").textContent = d.hub.title || d.hub.subjectAddress || "Comp hub";
    var bits = [];
    if (d.hub.subjectAddress && d.hub.subjectAddress !== el("title").textContent) bits.push(d.hub.subjectAddress);
    if (d.hub.propertyType) bits.push(d.hub.propertyType);
    if (d.hub.status === "closed") bits.push("Closed");
    el("sub").textContent = bits.join(" · ");

    if (d.items) renderItems(d.items);
    addMessages(d.messages || [], true);

    show("composer", !!d.canWrite);
    if (!d.canWrite) {
      el("readonly").textContent = d.hub.closedAt
        ? "This hub is closed. You can still read everything in it, but no one can post."
        : "Sign in with the address this hub was shared with to post a note.";
      show("readonly", true);
    } else {
      show("readonly", false);
    }
  }

  function renderItems(items){
    var rows = el("rows");
    rows.textContent = "";
    if (!items.length){ show("noitems", true); show("tbl", false); return; }
    show("noitems", false); show("tbl", true);
    items.forEach(function(it){
      var c = it.snapshot || {};
      var tr = document.createElement("tr");
      function cell(text, cls){
        var td = document.createElement("td");
        if (cls) td.className = cls;
        td.textContent = text == null ? "" : String(text);
        tr.appendChild(td);
        return td;
      }
      cell(c.address || "");
      cell(c.property_type || "");
      cell(c.transaction || "");
      cell(c.deal_date || "");
      cell(money(c.price), "num");
      cell(num(c.size_sqft), "num");
      cell(c.price_per_sqft ? money(c.price_per_sqft) : "", "num");
      var last = cell("");
      if (it.private){
        var b = document.createElement("span");
        b.className = "badge";
        b.textContent = "From the broker's records";
        last.appendChild(b);
      }
      rows.appendChild(tr);
    });
  }

  function addMessages(list, replace){
    var stream = el("stream");
    if (replace) stream.textContent = "";
    list.forEach(function(m){
      var d = document.createElement("div");
      d.className = "bub";
      var who = document.createElement("div");
      who.className = "who";
      var when = "";
      try { when = new Date(m.createdAt).toLocaleString(); } catch(e){}
      who.textContent = m.author + (when ? " · " + when : "");
      var t = document.createElement("div");
      t.className = "txt";
      t.textContent = m.body;
      d.appendChild(who); d.appendChild(t);
      stream.appendChild(d);
    });
    show("nomsg", !stream.children.length);
  }

  function readHub(since){
    var u = "/api/hub?id=" + encodeURIComponent(HUB_ID) + (since ? "&since=" + encodeURIComponent(since) : "");
    return fetch(u, { headers: { accept: "application/json" } }).then(function(r){
      return r.json().then(function(j){ return { s: r.status, j: j }; });
    });
  }

  function first(){
    readHub("").then(function(o){
      if (o.s !== 200) return fail((o.j && o.j.error) || "This hub could not be opened.");
      cursor = o.j.cursor || "";
      render(o.j);
      startPolling();
    }).catch(function(){ fail("This hub could not be reached. Please check your connection."); });
  }

  // Polling, not SSE, and deliberately lazy: 15s while the tab is visible,
  // 60s when it is not. A hub is a minutes-apart conversation, and an SSE
  // stream would hold a connection open all day to deliver four events.
  function tick(){
    if (document.hidden) return;
    readHub(cursor).then(function(o){
      if (o.s !== 200) return;
      if (o.j.cursor) cursor = o.j.cursor;
      if (o.j.messages && o.j.messages.length) addMessages(o.j.messages, false);
    }).catch(function(){});
  }
  function startPolling(){
    stopPolling();
    poll = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", function(){ if (!document.hidden) tick(); });
  }
  function stopPolling(){ if (poll) { clearInterval(poll); poll = null; } }

  el("send").addEventListener("click", function(){
    var body = el("body").value.trim();
    if (!body) return;
    el("send").disabled = true;
    fetch("/api/hub/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: HUB_ID, body: body }),
    }).then(function(r){ return r.json().then(function(j){ return { s: r.status, j: j }; }); })
      .then(function(o){
        el("send").disabled = false;
        if (o.s === 401){
          // The account ask, and the only place it appears. They have already
          // read the comps; this is the first thing that needs an account.
          el("readonly").textContent = (o.j && o.j.error) || "Please sign in to post.";
          show("readonly", true);
          location.href = "/?auth=signup";
          return;
        }
        if (o.s !== 201){
          el("readonly").textContent = (o.j && o.j.error) || "That note could not be posted.";
          show("readonly", true);
          return;
        }
        el("body").value = "";
        addMessages([o.j.message], false);
        if (o.j.message && o.j.message.createdAt) cursor = o.j.message.createdAt;
      })
      .catch(function(){ el("send").disabled = false; });
  });

  var tok = tokenFromHash();
  if (tok){
    fetch("/api/hub/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: HUB_ID, token: tok }),
    }).then(function(r){ return r.json().then(function(j){ return { s: r.status, j: j }; }); })
      .then(function(o){
        // Whatever the answer, the credential comes out of the address bar.
        try { history.replaceState(null, "", location.pathname); } catch(e){}
        if (o.s !== 200) return fail((o.j && o.j.error) || "This invite link is not valid.");
        first();
      })
      .catch(function(){ fail("This hub could not be reached. Please check your connection."); });
  } else {
    first();
  }
})();
</script>
</body></html>`;
}

module.exports = { renderHubHTML };
