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
/* The one thing an unsigned reader can act on. Underlined rather than a
   button: it sits inside a sentence, and a button would read as the primary
   act of a page whose primary act is reading the comps. */
a.signin{text-decoration:underline;font-weight:600;white-space:nowrap}
h2{font-size:15px;margin:0 0 12px;letter-spacing:.01em}
.tblwrap{overflow-x:auto}
table{width:100%;min-width:640px;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:600;color:var(--ink-2);border-bottom:1px solid var(--ink);
  padding:0 10px 7px 0;white-space:nowrap}
td{padding:9px 10px 9px 0;border-bottom:1px solid var(--line);vertical-align:top}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:999px;
  border:1px solid var(--line);color:var(--ink-2);white-space:nowrap}
.tally{color:var(--ink-2);font-size:13px;margin:0 0 10px}
/* The per-comp note affordance. Quiet until a comp actually has notes, so a
   column of "Add note" does not compete with the numbers beside it. */
.notes{background:none;border:0;padding:0;font:inherit;font-size:12px;cursor:pointer;
  color:var(--ink-3);text-decoration:underline;white-space:nowrap}
.notes:hover{color:var(--ink)}
.notes.has{color:var(--ink-2);font-weight:600;text-decoration:none}
/* A comp's thread sits in the table, under its own row: the note and the
   building it is about have to be readable together. */
tr.thread td{background:var(--wash);padding:12px 10px}
.link{background:none;border:0;padding:0;font:inherit;font-size:13px;cursor:pointer;
  color:var(--ink-2);text-decoration:underline}
.link:hover{color:var(--ink)}
.addbox{border:1px solid var(--line);border-radius:8px;padding:14px;margin-top:10px;background:var(--card)}
.addbox label{display:block;font-size:12.5px;color:var(--ink-2);margin-top:8px}
.addbox input,.addbox select{width:100%;margin-top:3px;padding:7px 8px;border:1px solid var(--line);
  border-radius:6px;background:var(--card);color:var(--ink);font:inherit;font-size:13.5px}
.mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 12px}
/* A client's own find is marked as theirs and never wears the vault badge:
   the two are different claims and must not look alike. */
.mine{border-color:var(--ink-3);color:var(--ink-2)}
.threadbox{max-width:640px}
.threadbox .stream{margin-bottom:10px}
/* The status control and the read-only chip are sized alike on purpose, so a
   tenant who can act and an observer who cannot see the same table shape. */
select.st{font:inherit;font-size:12.5px;padding:2px 4px;border:1px solid var(--line);
  border-radius:6px;background:var(--card);color:var(--ink)}
.st-new{color:var(--ink-3)}
.st-shortlist{color:var(--ink);font-weight:600}
.st-passed{color:var(--ink-3);text-decoration:line-through}
tr.passed td:not(:nth-last-child(-n+2)){opacity:.55}
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
      <!-- The one-line answer to "where are we", above the detail rather than
           below them. It counts only what somebody actually decided: comps
           still at "new" are absent, because a count of undecided things is
           not progress. -->
      <p class="tally hide" id="tally"></p>
      <!-- Adding a building the CLIENT found. Behind a toggle, and below the
           table, because it is the rarer act and the list is what people come
           here to read. Shown only to someone who may post. -->
      <div id="addWrap" class="hide">
        <button class="link" id="addToggle" aria-expanded="false" aria-controls="addBox">Add a comp you found</button>
        <div id="addBox" class="hide addbox">
          <p class="who">Anything you add is marked as yours. It stays in this hub and never
            enters CompNinja's public records.</p>
          <label>Address or building name
            <input id="mAddr" type="text" maxlength="300" placeholder="30833 Agoura Rd"/></label>
          <div class="mgrid">
            <label>Type <select id="mType"></select></label>
            <label>Sale or lease <select id="mTx">
              <option value="">Not sure</option><option value="sale">Sale</option><option value="lease">Lease</option>
            </select></label>
            <label>Date <input id="mDate" type="text" placeholder="2026-05-14"/></label>
            <label>Price <input id="mPrice" type="text" placeholder="2850000"/></label>
            <label>Size (SF) <input id="mSize" type="text" placeholder="24500"/></label>
            <label>Link <input id="mUrl" type="text" placeholder="https://"/></label>
          </div>
          <label>Note <input id="mNotes" type="text" maxlength="500" placeholder="optional"/></label>
          <div style="margin-top:10px"><button class="btn" id="mAdd">Add to this hub</button></div>
          <div id="mMsg"></div>
        </div>
      </div>

      <div class="tblwrap"><table id="tbl" class="hide">
        <thead><tr>
          <th>Address</th><th>Type</th><th>Deal</th><th>Date</th>
          <th class="num">Price</th><th class="num">Size</th><th class="num">$/SF</th>
          <th>Where it stands</th><th></th>
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
  // The server's answer to "may this person post", never the browser's guess
  // from the role string. Held so the item table can ask it while rendering.
  var canWriteHub = false;
  // The last item list the server sent, kept so a status change can re-render
  // the tally without a round trip for the rows that did not change.
  var lastItems = [];
  // Which comp's note thread is expanded, or null. ONE at a time on purpose:
  // the table is the page's primary surface, and several open threads push
  // the comps apart until the list stops being readable as a list.
  var openThread = null;
  // Half-typed notes, kept by comp id across repaints.
  //
  // The table is rebuilt whenever anything changes — a status, a new comp, an
  // arriving note bumping a count — and rebuilding an open thread destroys the
  // textarea inside it. That was survivable while only the person typing could
  // trigger a repaint; once a poll repaints on somebody ELSE's activity, a
  // tenant writing a careful note about clear height loses it because the
  // broker shortlisted something in another tab. Drafts are held here and put
  // back after every render.
  var threadDraft = {};

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

    // Set BEFORE renderItems, which reads it to decide whether each row gets a
    // control or a word.
    canWriteHub = !!d.canWrite;
    if (d.items) { lastItems = d.items; renderItems(d.items); }
    addMessages(d.messages || [], true);

    show("composer", !!d.canWrite);
    // The same gate as the note composer, deliberately: adding a building you
    // found and saying something about one are the same class of act, and a
    // hub that lets you talk but not point at a building is half a workspace.
    show("addWrap", !!d.canWrite);
    if (!d.canWrite) {
      // TWO different read-only states, and only one of them is a thing the
      // reader can act on.
      //
      // A closed hub is finished; there is nothing to offer. But "sign in to
      // post" shipped as a sentence with NOTHING TO CLICK — the composer that
      // carries the account ask is hidden from exactly the people this line is
      // addressed to, and the header's signed-out slots do not render here. So
      // a client read their broker's comps, went to reply, and hit a dead end
      // on the one path this whole feature is justified by. Found by opening a
      // real invite link as a real client.
      var ro = el("readonly");
      ro.textContent = "";
      if (d.hub.closedAt) {
        ro.textContent = "This hub is closed. You can still read everything in it, but no one can post.";
      } else {
        ro.appendChild(document.createTextNode(
          "Sign in with the address this hub was shared with to post a note. "));
        var a = document.createElement("a");
        // The same door askForAccount() uses, so there is one destination for
        // the account ask however a person reaches it. Their invite token is
        // already exchanged into a cookie by this point, so coming back to
        // this URL after signing in works with or without the link.
        a.href = "/?auth=signin";
        a.className = "signin";
        a.textContent = "Sign in or create an account";
        ro.appendChild(a);
      }
      show("readonly", true);
    } else {
      show("readonly", false);
    }
  }

  // The pipeline, in the order it is shown. Must agree with hub-access.js's
  // ITEM_STATUSES and with migration 024's CHECK; a test pins the three.
  var STATUSES = ["new", "shortlist", "toured", "passed"];
  var STATUS_LABEL = { "new": "Not decided", shortlist: "Shortlisted", toured: "Toured", passed: "Passed" };

  // Counts what somebody DECIDED. "new" is deliberately excluded: a tally of
  // undecided comps is not progress, and putting it here would let a hub where
  // nothing has happened read as though something had.
  function renderTally(items){
    var live = items.filter(function(i){ return i.status && i.status !== "new"; });
    if (!live.length){ show("tally", false); return; }
    var counts = {};
    live.forEach(function(i){ counts[i.status] = (counts[i.status] || 0) + 1; });
    var parts = STATUSES.filter(function(s){ return s !== "new" && counts[s]; })
      .map(function(s){ return counts[s] + " " + STATUS_LABEL[s].toLowerCase(); });
    el("tally").textContent = parts.join(" · ") + " of " + items.length;
    show("tally", true);
  }

  function renderItems(items){
    var rows = el("rows");
    rows.textContent = "";
    if (!items.length){ show("noitems", true); show("tbl", false); show("tally", false); return; }
    show("noitems", false); show("tbl", true);
    renderTally(items);
    items.forEach(function(it){
      var c = it.snapshot || {};
      var tr = document.createElement("tr");
      if (it.status === "passed") tr.className = "passed";
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

      // Where it stands. A control for anyone who may write, a plain word for
      // anyone who may not, in the same column either way: an observer and a
      // tenant should read the same table, not two different ones.
      var stCell = document.createElement("td");
      var current = it.status || "new";
      if (canWriteHub){
        var sel = document.createElement("select");
        sel.className = "st st-" + current;
        sel.setAttribute("aria-label", "Where " + (c.address || "this comp") + " stands");
        STATUSES.forEach(function(s){
          var o = document.createElement("option");
          o.value = s;
          o.textContent = STATUS_LABEL[s];
          if (s === current) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function(){ setStatus(it, sel); });
        stCell.appendChild(sel);
      } else {
        var span = document.createElement("span");
        span.className = "st-" + current;
        span.textContent = STATUS_LABEL[current] || current;
        stCell.appendChild(span);
      }
      tr.appendChild(stCell);

      var last = cell("");
      if (it.private){
        var b = document.createElement("span");
        b.className = "badge";
        b.textContent = "From the broker's records";
        last.appendChild(b);
      } else if (it.source === "manual"){
        // A different claim from the vault badge, and it must not look like
        // one. This says who put the building here; it asserts nothing about
        // the numbers, because nobody has vouched for them.
        var mb = document.createElement("span");
        mb.className = "badge mine";
        mb.textContent = "Added by " + (it.addedBy || "a client");
        last.appendChild(mb);
      }
      // The comp's own notes. A count when there are any, an invitation when
      // there are none and this reader may post, and NOTHING when there are
      // none and they may not: an empty affordance on a row an observer
      // cannot act on is just noise in a table they are trying to read.
      var n = msgsFor(it.id).length;
      if (n || canWriteHub){
        var nb = document.createElement("button");
        nb.type = "button";
        nb.className = "notes" + (n ? " has" : "");
        nb.setAttribute("data-notes", it.id);
        nb.setAttribute("aria-expanded", openThread === it.id ? "true" : "false");
        nb.textContent = n ? (n + (n === 1 ? " note" : " notes")) : "Add note";
        nb.addEventListener("click", function(){
          openThread = (openThread === it.id) ? null : it.id;
          renderItems(lastItems);
        });
        last.appendChild(nb);
      }
      rows.appendChild(tr);

      // The thread itself, as a row under its comp rather than a panel
      // somewhere else on the page. That placement IS the feature: the note
      // and the building it is about have to be readable together, which is
      // the thing an email thread cannot do.
      if (openThread === it.id) rows.appendChild(threadRow(it, tr.children.length));
    });
  }

  // One expanded comp thread: its notes, and a composer when this reader may
  // post. Rebuilt on every render rather than kept alive, so a polled message
  // cannot land in a stale node.
  function threadRow(it, colspan){
    var tr = document.createElement("tr");
    tr.className = "thread";
    tr.setAttribute("data-thread", it.id);
    var td = document.createElement("td");
    td.colSpan = colspan;
    var wrap = document.createElement("div");
    wrap.className = "threadbox";

    var msgs = msgsFor(it.id);
    if (msgs.length){
      var st = document.createElement("div");
      st.className = "stream";
      msgs.forEach(function(m){ st.appendChild(bubble(m)); });
      wrap.appendChild(st);
    } else {
      var none = document.createElement("p");
      none.className = "who";
      none.textContent = "No notes on this comp yet.";
      wrap.appendChild(none);
    }

    if (canWriteHub){
      var ta = document.createElement("textarea");
      ta.maxLength = 4000;
      ta.setAttribute("aria-label", "Note on " + ((it.snapshot && it.snapshot.address) || "this comp"));
      ta.placeholder = "Add a note about this comp";
      // Put back whatever they had typed before the last repaint, and record
      // every keystroke so the next one does not lose it either.
      ta.value = threadDraft[it.id] || "";
      ta.addEventListener("input", function(){ threadDraft[it.id] = ta.value; });
      wrap.appendChild(ta);
      var act = document.createElement("div");
      act.style.marginTop = "8px";
      var btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Post note";
      btn.addEventListener("click", function(){ postMessage(ta, btn, it.id); });
      act.appendChild(btn);
      wrap.appendChild(act);
    }
    td.appendChild(wrap);
    tr.appendChild(td);
    return tr;
  }

  function renderThreads(){
    // The counts live in the item table, so the cheapest correct answer is to
    // repaint it. The table is a handful of rows by nature.
    if (lastItems.length) renderItems(lastItems);
  }

  // One bubble, used by both the hub-level stream and a comp's own thread, so
  // a note reads the same wherever it is attached.
  function bubble(m){
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
    return d;
  }

  // Every note in the hub, both kinds. The SPLIT is by item_id and nothing
  // else: a note filed against a comp belongs under that comp, and a note
  // about the requirement belongs in the stream. Keeping one list and
  // filtering at render time is what lets a polled message land in the right
  // place without knowing which view is open.
  var allMsgs = [];

  function msgsFor(itemId){
    return allMsgs.filter(function(m){
      return itemId ? String(m.itemId) === String(itemId) : !m.itemId;
    });
  }

  function addMessages(list, replace){
    if (replace) allMsgs = [];
    // Guard against a poll replaying a message the composer already appended:
    // the cursor is the server's, but an optimistic local add is not.
    list.forEach(function(m){
      if (!allMsgs.some(function(x){ return x.id && m.id && x.id === m.id; })) allMsgs.push(m);
    });
    renderStream();
    // Any open comp thread, and every row's note count, must follow.
    renderThreads();
  }

  function renderStream(){
    var stream = el("stream");
    stream.textContent = "";
    msgsFor(null).forEach(function(m){ stream.appendChild(bubble(m)); });
    show("nomsg", !stream.children.length);
  }

  // Moving a comp along the pipeline. The select is disabled for the round
  // trip and REVERTS on failure rather than keeping the value the server
  // refused: this column is a record of what the client decided, so a status
  // showing something the database does not hold is the one lie it must not
  // tell.
  function setStatus(item, sel){
    var previous = item.status || "new";
    var wanted = sel.value;
    if (wanted === previous) return;
    sel.disabled = true;
    fetch("/api/hub/item", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: HUB_ID, itemId: item.id, status: wanted }),
    }).then(function(r){ return r.json().then(function(j){ return { s: r.status, j: j }; }); })
      .then(function(o){
        sel.disabled = false;
        if (o.s === 401){
          sel.value = previous;
          askForAccount((o.j && o.j.error) || "Please sign in to change this.");
          return;
        }
        if (o.s !== 200 || !o.j.item){
          sel.value = previous;
          el("readonly").textContent = (o.j && o.j.error) || "That change could not be saved.";
          show("readonly", true);
          return;
        }
        show("readonly", !canWriteHub);
        item.status = o.j.item.status;
        sel.className = "st st-" + item.status;
        // Re-render the row's own styling and the tally, without refetching
        // the whole hub: the server already told us what it stored.
        renderItems(lastItems);
      })
      .catch(function(){
        sel.disabled = false;
        sel.value = previous;
        el("readonly").textContent = "That change did not reach the server.";
        show("readonly", true);
      });
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
    if (Date.now() - lastActive > IDLE_MS) return;
    readHub(cursor).then(function(o){
      if (o.s !== 200) return;
      if (o.j.cursor) cursor = o.j.cursor;
      // Comps first, so a note arriving in the same tick renders against the
      // list it belongs to rather than the previous one.
      if (o.j.items) applyItems(o.j.items);
      if (o.j.messages && o.j.messages.length) addMessages(o.j.messages, false);
    }).catch(function(){});
  }

  // The server's item list is the truth, but a repaint is not free to a person
  // MID-EDIT: rebuilding the table closes an open note thread and throws away
  // whatever they were typing in it. So this repaints only when something
  // actually differs, compared on the fields that are visible.
  function applyItems(items){
    if (sameItems(items, lastItems)) return;
    lastItems = items;
    renderItems(items);
  }

  function sameItems(a, b){
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++){
      // id and status are what a poll can change; addedAt catches a comp that
      // was removed and re-sent, which reuses neither.
      if (a[i].id !== b[i].id || a[i].status !== b[i].status || a[i].addedAt !== b[i].addedAt) return false;
    }
    return true;
  }
  // A hub left open on a second monitor all day would otherwise ask the
  // server for the whole comp list four times a minute forever. After ten
  // quiet minutes the timer keeps running but does nothing, and the first
  // sign of a person — a key, a click, coming back to the tab — both wakes it
  // and catches up in the same moment, so waking is invisible.
  //
  // Going dormant rather than clearing the interval is deliberate: one timer
  // that no-ops has no restart path to get wrong, and this page has already
  // shipped one claim about its own polling that the code did not honour.
  var IDLE_MS = 10 * 60 * 1000;
  var lastActive = Date.now();
  function markActive(){
    var wasIdle = (Date.now() - lastActive) > IDLE_MS;
    lastActive = Date.now();
    if (wasIdle) tick();
  }
  function startPolling(){
    stopPolling();
    poll = setInterval(tick, 15000);
    // A hidden tab is skipped entirely rather than polled more slowly: there
    // is nobody to show it to, and returning to the tab catches up at once.
    document.addEventListener("visibilitychange", function(){
      if (!document.hidden) { lastActive = Date.now(); tick(); }
    });
    ["keydown", "pointerdown", "focus"].forEach(function(ev){
      document.addEventListener(ev, markActive, true);
    });
  }
  function stopPolling(){ if (poll) { clearInterval(poll); poll = null; } }

  // THE ACCOUNT ASK, in one place, reached by every write a participant can
  // make: a note on the hub, a note on a comp, a comp they found, a status.
  // Reading this hub needed no account and that is the whole tenant-access
  // decision; this is the moment it changes, so where it sends them and what
  // it says must not differ by which button they happened to press.
  function askForAccount(message, into){
    var say = message || "Please sign in to post.";
    if (into) { into(say); } else { el("readonly").textContent = say; show("readonly", true); }
    location.href = "/?auth=signup";
  }

  // ONE post path for both kinds of note. The only difference is whether an
  // itemId rides along, so the error copy and the cursor update cannot drift
  // between the hub stream and a comp's own thread.
  function postMessage(field, btn, itemId){
    var body = field.value.trim();
    if (!body) return;
    btn.disabled = true;
    var payload = { id: HUB_ID, body: body };
    if (itemId) payload.itemId = itemId;
    fetch("/api/hub/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function(r){ return r.json().then(function(j){ return { s: r.status, j: j }; }); })
      .then(function(o){
        btn.disabled = false;
        if (o.s === 401){ askForAccount(o.j && o.j.error); return; }
        if (o.s !== 201){
          el("readonly").textContent = (o.j && o.j.error) || "That note could not be posted.";
          show("readonly", true);
          return;
        }
        field.value = "";
        // A posted note is no longer a draft. Without this the repaint that
        // follows would put the text straight back into the box under it.
        if (itemId) delete threadDraft[itemId];
        addMessages([o.j.message], false);
        if (o.j.message && o.j.message.createdAt) cursor = o.j.message.createdAt;
      })
      .catch(function(){
        btn.disabled = false;
        el("readonly").textContent = "That note did not reach the server.";
        show("readonly", true);
      });
  }

  el("send").addEventListener("click", function(){
    postMessage(el("body"), el("send"), null);
  });

  // Adding a building the client found. The server validates with the vault
  // importer's own parsers, so the copy it sends back is written for whoever
  // typed the value ("write 1200000, not 1.2M") — shown verbatim rather than
  // replaced with something vaguer.
  el("mType").innerHTML = '<option value=""></option>' +
    ["Industrial","Office","Retail","Multifamily","Land","Residential"]
      .map(function(t){ return "<option>" + t + "</option>"; }).join("");

  el("addToggle").addEventListener("click", function(){
    var open = el("addBox").classList.contains("hide");
    show("addBox", open);
    el("addToggle").setAttribute("aria-expanded", open ? "true" : "false");
  });

  function manualMsg(text, bad){
    var n = el("mMsg");
    n.textContent = text || "";
    n.className = text ? ("msg" + (bad ? " bad" : "")) : "";
    n.style.marginTop = text ? "10px" : "0";
  }

  el("mAdd").addEventListener("click", function(){
    var payload = {
      address: el("mAddr").value,
      property_type: el("mType").value,
      transaction: el("mTx").value,
      deal_date: el("mDate").value,
      price: el("mPrice").value,
      size_sqft: el("mSize").value,
      source_url: el("mUrl").value,
      notes: el("mNotes").value,
    };
    if (!String(payload.address).trim()) return manualMsg("Give the building an address or a name.", true);
    el("mAdd").disabled = true;
    manualMsg("");
    fetch("/api/hub/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: HUB_ID, comp: payload }),
    }).then(function(r){ return r.json().then(function(j){ return { s: r.status, j: j }; }); })
      .then(function(o){
        el("mAdd").disabled = false;
        if (o.s === 401){
          askForAccount((o.j && o.j.error) || "Please sign in to add a comp.",
            function(m){ manualMsg(m, true); });
          return;
        }
        if (o.s !== 201 || !o.j.item) return manualMsg((o.j && o.j.error) || "That comp could not be added.", true);
        ["mAddr","mDate","mPrice","mSize","mUrl","mNotes"].forEach(function(f){ el(f).value = ""; });
        el("mType").value = ""; el("mTx").value = "";
        manualMsg("Added.");
        lastItems = lastItems.concat([o.j.item]);
        renderItems(lastItems);
      })
      .catch(function(){
        el("mAdd").disabled = false;
        manualMsg("That did not reach the server. Nothing was added.", true);
      });
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
