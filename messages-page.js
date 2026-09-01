// ---------------------------------------------------------------------------
// Firm messaging — the whole /messages screen.
//
// Spec: docs/superpowers/specs/2026-09-01-firm-messaging-design.md
// Rules: messaging.js   Schema: migrations/044-firm-messaging.sql
//
// ITS OWN PAGE, ITS OWN TAB. Not a panel on /vault and not a deck on the desk
// (owner's, 2026-09-01). The vault is a broker's private book; this is the
// firm's correspondence, and burying a communication surface inside a
// workspace is how it goes unread. It is a rail destination beside Workspace,
// and everything about it lives here.
//
// A marketShell BODY, the bulk-page.js / firms-page.js / vault-page.js
// pattern: no doctype, no head, no header, no footer. Pure — a boot payload in
// and a string out — so the whole page renders and diffs with no database and
// no browser.
//
// TWO RULES CARRIED OVER FROM vault-page.js, both easy to undo by accident:
//
//  1. The stylesheet is emitted in the BODY, after MARKET_CSS. This page
//     redefines .wrap, .card and a handful of shared selectors, so its rules
//     have to come later in document order to win on equal specificity.
//     marketShell's `head` parameter is emitted BEFORE MARKET_CSS and loses.
//
//  2. The whole page, including its client script, is ONE template literal, so
//     a stray `${` or a single-backslash escape emits broken JavaScript and a
//     blank workspace rather than failing loudly. The client script therefore
//     uses string CONCATENATION throughout and never a template literal of its
//     own. test/messages-page.test.js compiles what this actually emits.
//
// esc() is duplicated rather than imported, matching the copies in server.js,
// vault-page.js and hub-page.js. It is three lines and pure.
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function renderMessagesBody(boot) {
  // </script> can never appear in the payload: every "<" is escaped, which is
  // also what keeps a comp note like "<img onerror=…>" inert inside the tag.
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<style>
/* SCOPED box-sizing reset, and it is load-bearing. Without it a .msg-row is
   width:100% PLUS its 28px of horizontal padding, so every thread row hung
   28px past the card's right edge — which also defeated the preview's
   ellipsis, because the text had somewhere to overflow to. Visible only once
   the list is narrow, so it was found at 375px and not before.
   Scoped under .msg-page rather than declared on the universal selector: this
   stylesheet is emitted in the BODY, after MARKET_CSS, and a global reset here
   would silently restyle the shared header and footer around it. */
.msg-page,.msg-page *{box-sizing:border-box}
.msg-page{--rail:320px;--bubble-radius:14px}
.msg-page .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
/* One grid, two panes above 900px and one below it. The pane that shows on a
   phone is decided by a class on the wrapper, never by a media query alone —
   a query cannot know whether the reader has opened a thread yet. */
.msg-page{display:grid;grid-template-columns:var(--rail) 1fr;gap:0;
  border:1px solid var(--edge);border-radius:8px;overflow:hidden;
  background:var(--card);min-height:min(74vh,720px);margin:24px 0 48px}
.msg-side{border-right:1px solid var(--line);display:flex;flex-direction:column;min-width:0;background:var(--card)}
.msg-main{display:flex;flex-direction:column;min-width:0}
.msg-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);min-height:60px}
.msg-head h2{margin:0;font-size:15px;font-weight:600;color:var(--ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.msg-head .sub{font-size:12px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.msg-grow{flex:1;min-width:0}
.msg-btn{appearance:none;border:1px solid var(--edge);background:var(--card);color:var(--ink);
  border-radius:6px;padding:6px 11px;font-size:13px;font-weight:500;cursor:pointer;line-height:1.4}
.msg-btn:hover{background:var(--wash)}
.msg-btn.primary{background:var(--red-fill);border-color:var(--red-fill);color:#fff}
.msg-btn.primary:hover{background:var(--red-fill-hover);border-color:var(--red-fill-hover)}
.msg-btn:disabled{opacity:.5;cursor:default}
.msg-btn.sm{padding:4px 9px;font-size:12px}

/* --- the thread list --------------------------------------------------- */
/* The Chats / People switch. A tab, not a button: it says which of two lists
   this column is showing, so the pressed one reads as the current place. */
.msg-tab{appearance:none;border:0;background:transparent;cursor:pointer;font:inherit;
  font-size:13.5px;font-weight:600;color:var(--ink-3);padding:6px 2px;margin-right:16px;
  border-bottom:2px solid transparent;line-height:1.4}
.msg-tab:hover{color:var(--ink)}
.msg-tab[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--red)}
/* The firm, quietly, at the foot of the column. */
.msg-firm{border-top:1px solid var(--hair);padding:9px 14px;font-size:11.5px;
  color:var(--ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* A person in the People list. Same row furniture as a thread, so the two
   lists read as one column rather than as two designs. */
.msg-person{display:flex;gap:10px;align-items:center;width:100%;text-align:left;
  padding:11px 14px;border:0;border-bottom:1px solid var(--hair);background:transparent;
  cursor:pointer;font:inherit;color:var(--ink)}
.msg-person:hover{background:var(--wash)}
.msg-person.waiting{cursor:default;background:transparent}
.msg-person.waiting .msg-av{background:var(--wash-2);color:var(--ink-faint);border:1px solid var(--edge)}
.msg-person.waiting .msg-name,.msg-person.waiting .msg-sub{color:var(--ink-faint)}
.msg-sub{display:block;font-size:12px;color:var(--ink-3);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.msg-search{padding:10px 12px;border-bottom:1px solid var(--hair)}
.msg-search input{width:100%;box-sizing:border-box;border:1px solid var(--edge);border-radius:6px;
  padding:7px 10px;font:inherit;font-size:13px;background:var(--paper);color:var(--ink)}
.msg-threads{flex:1;overflow-y:auto;min-height:0}
.msg-row{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;
  padding:11px 14px;border:0;border-bottom:1px solid var(--hair);background:transparent;
  cursor:pointer;font:inherit;color:var(--ink)}
.msg-row:hover{background:var(--wash)}
.msg-row[aria-current="true"]{background:var(--wash-2);box-shadow:inset 3px 0 0 var(--red)}
.msg-av{flex:0 0 34px;width:34px;height:34px;border-radius:50%;background:var(--slab);color:#fff;
  font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;text-transform:uppercase}
.msg-av.chan{background:var(--wash-2);color:var(--ink-2);border:1px solid var(--edge)}
.msg-rowbody{min-width:0;flex:1}
.msg-rowtop{display:flex;align-items:baseline;gap:8px}
.msg-name{font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.msg-when{font-size:11px;color:var(--ink-faint);white-space:nowrap}
/* display:block is load-bearing, not tidiness: this is a <span> and it is not
   a flex item (its parent .msg-rowbody is, .msg-prev is not), so as an INLINE
   box overflow and text-overflow do nothing at all — a long preview was
   clipped mid-word at the card edge with no ellipsis. Found at 375px, where
   every preview is long enough to hit it. */
.msg-prev{display:block;font-size:12.5px;color:var(--ink-3);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.msg-unread{flex:0 0 auto;min-width:19px;height:19px;padding:0 6px;border-radius:10px;background:var(--red-fill);
  color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center}
.msg-row.is-unread .msg-name{font-weight:700}
.msg-row.is-unread .msg-prev{color:var(--ink-body)}

/* --- the stream --------------------------------------------------------- */
.msg-stream{flex:1;overflow-y:auto;min-height:0;padding:16px;display:flex;flex-direction:column;gap:2px}
.msg-day{align-self:center;font-size:11px;color:var(--ink-faint);background:var(--wash);
  border:1px solid var(--hair);border-radius:20px;padding:3px 12px;margin:14px 0 8px}
.msg-line{display:flex;gap:10px;padding:2px 0}
.msg-line .msg-av{margin-top:2px}
.msg-line.cont{padding-top:0}
.msg-line.cont .msg-av{visibility:hidden;height:0;margin:0}
.msg-body{min-width:0;flex:1}
.msg-meta{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.msg-author{font-weight:600;font-size:13px}
.msg-time{font-size:11px;color:var(--ink-faint)}
.msg-text{font-size:14px;color:var(--ink-body);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55}

/* --- a comp inside a message -------------------------------------------- */
.msg-comp{border:1px solid var(--edge);border-radius:8px;padding:10px 12px;margin:6px 0;
  background:var(--paper);max-width:520px}
.msg-comp h4{margin:0 0 2px;font-size:13.5px;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.msg-comp .facts{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink-3);margin:4px 0 8px}
.msg-comp .facts b{font-weight:600;color:var(--ink-body)}
.msg-comp .foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.msg-saved{font-size:12px;color:var(--ok-text);font-weight:500}
.msg-chip{display:inline-block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-3);border:1px solid var(--edge);border-radius:4px;padding:1px 6px}

/* --- composer ------------------------------------------------------------ */
.msg-comp-tray{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 8px}
.msg-tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;background:var(--wash);
  border:1px solid var(--edge);border-radius:20px;padding:3px 6px 3px 10px;color:var(--ink-body);max-width:100%}
.msg-tag span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg-tag button{appearance:none;border:0;background:transparent;cursor:pointer;color:var(--ink-3);
  font-size:14px;line-height:1;padding:0 2px}
.msg-composer{border-top:1px solid var(--line);padding:12px 16px 14px;background:var(--card)}
.msg-composer textarea{width:100%;box-sizing:border-box;resize:none;border:1px solid var(--edge);
  border-radius:8px;padding:10px 12px;font:inherit;font-size:14px;line-height:1.5;
  background:var(--paper);color:var(--ink);min-height:44px;max-height:180px}
.msg-actions{display:flex;align-items:center;gap:8px;margin-top:8px}
.msg-hint{font-size:11.5px;color:var(--ink-faint)}

/* --- empty states, notices ----------------------------------------------- */
.msg-empty{margin:auto;text-align:center;padding:40px 24px;max-width:44ch;color:var(--ink-3);font-size:13.5px}
.msg-empty h3{margin:0 0 6px;font-size:15px;color:var(--ink);font-weight:600}
.msg-empty p{margin:0 0 14px;line-height:1.6}
.msg-note{font-size:12.5px;padding:8px 16px;color:var(--ink-3)}
.msg-note.bad{color:var(--red);font-weight:500}

/* --- picker / new-thread panels ------------------------------------------ */
.msg-panel{border-top:1px solid var(--line);background:var(--wash);padding:12px 16px;max-height:280px;overflow-y:auto}
.msg-panel h3{margin:0 0 8px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.msg-pick{display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--hair);font-size:13px}
.msg-pick:last-child{border-bottom:0}
.msg-pick label{display:flex;gap:8px;align-items:center;cursor:pointer;min-width:0;flex:1}
.msg-pick .who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msg-pick .sub{color:var(--ink-faint);font-size:11.5px}
/* Selected people, as removable chips above the list. */
.msg-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.msg-chips:empty{margin-bottom:0}
.msg-panel input[type=text]{width:100%;box-sizing:border-box;border:1px solid var(--edge);border-radius:6px;
  padding:7px 10px;font:inherit;font-size:13px;margin-bottom:8px;background:var(--card);color:var(--ink)}
.msg-panelfoot{display:flex;gap:8px;align-items:center;margin-top:10px}

.msg-hide{display:none!important}

/* Below 900px the two panes become one. .msg-page.on-thread is what says
   which of them is showing — the reader's own navigation, not the viewport. */
@media (max-width:900px){
  .msg-page{grid-template-columns:1fr;min-height:min(80vh,640px)}
  .msg-side{border-right:0}
  .msg-page .msg-main{display:none}
  .msg-page.on-thread .msg-side{display:none}
  .msg-page.on-thread .msg-main{display:flex}
}
@media (min-width:901px){ #msgBack{display:none} }
</style>

<!-- THIS IS THE READER'S INBOX, not the firm's noticeboard (owner's, 2026-09-01).
     It shipped headed "Your firm's messages" with the firm's name above the
     thread list, and read as a company page somebody had been given access to
     rather than as their own. The firm is the CONTEXT for who you can reach;
     it is not whose page this is. Nothing about the access rules changed with
     the wording - a thread is still firm-scoped and still walled twice. -->
<section style="padding:28px 0 0">
  <div class="kicker">Messages</div>
  <h1 style="margin:6px 0 4px;font-size:26px;letter-spacing:-.01em">Messages</h1>
  <p style="margin:0;color:var(--ink-2);max-width:62ch;font-size:14px;line-height:1.6">
    Message the people you work with, and send them comps straight from your
    vault. Anything you send is kept in the conversation, so a deal you talk
    about stays on the record instead of in somebody's text messages.
  </p>
</section>

<div class="msg-page" id="msgPage" hidden>
  <aside class="msg-side">
    <!-- Chats and People, because a directory of colleagues is a thing you
         LOOK AT and not a step inside a dialog. It lived behind the New button
         before, which meant the only way to find out who you could message was
         to start doing it. -->
    <div class="msg-head">
      <button class="msg-tab" id="msgSideChats" type="button" aria-pressed="true">Chats</button>
      <button class="msg-tab" id="msgSidePeople" type="button" aria-pressed="false">People</button>
      <span class="msg-grow"></span>
      <button class="msg-btn sm" id="msgNewBtn" type="button">New</button>
    </div>
    <div class="msg-search"><input id="msgFilter" type="search" placeholder="Search" autocomplete="off"></div>
    <div class="msg-threads" id="msgThreads"></div>
    <div class="msg-threads msg-hide" id="msgPeople"></div>
    <!-- PEOPLE FIRST. The box searches colleagues; it used to be a channel
         name with "leave blank for a direct message" under it, so typing a
         label for a conversation with one person silently made a CHANNEL
         called that. What you get now follows from how many people you pick:
         one is a direct message, two or more is a group. The name field does
         not exist until there are two, so the input that caused that bug is
         unreachable. -->
    <div class="msg-panel msg-hide" id="msgNewPanel">
      <h3>New conversation</h3>
      <input id="msgNewSearch" type="text" placeholder="Search people" autocomplete="off">
      <div id="msgNewChips" class="msg-chips"></div>
      <div id="msgNewPeople"></div>
      <input id="msgNewTitle" class="msg-hide" type="text" placeholder="Group name (optional)" maxlength="80">
      <div class="msg-panelfoot">
        <button class="msg-btn primary sm" id="msgNewGo" type="button">Start</button>
        <button class="msg-btn sm" id="msgNewCancel" type="button">Cancel</button>
        <span class="msg-hint" id="msgNewMsg"></span>
      </div>
    </div>
    <!-- The firm, as CONTEXT rather than as the headline. It was the biggest
         thing on this column and it is not whose page this is. -->
    <div class="msg-firm" id="msgFirmLine"></div>
  </aside>

  <div class="msg-main" id="msgMain">
    <div class="msg-head">
      <button class="msg-btn sm" id="msgBack" type="button" aria-label="Back to conversations">‹</button>
      <div class="msg-grow" style="min-width:0">
        <h2 id="msgTitle">Select a conversation</h2>
        <div class="sub" id="msgSub"></div>
      </div>
      <button class="msg-btn sm" id="msgTabChat" type="button" aria-pressed="true">Conversation</button>
      <button class="msg-btn sm" id="msgTabComps" type="button" aria-pressed="false">Comps</button>
    </div>
    <div class="msg-note msg-hide" id="msgNote"></div>
    <div class="msg-stream" id="msgStream"></div>
    <div class="msg-panel msg-hide" id="msgPicker">
      <h3>Send a comp from your vault</h3>
      <input id="msgPickFilter" type="text" placeholder="Filter by address, market or type" autocomplete="off">
      <div id="msgPickList"></div>
      <div class="msg-panelfoot">
        <button class="msg-btn sm" id="msgPickDone" type="button">Done</button>
        <span class="msg-hint" id="msgPickMsg"></span>
      </div>
    </div>
    <div class="msg-comp-tray" id="msgTray"></div>
    <div class="msg-composer" id="msgComposer">
      <textarea id="msgInput" rows="1" placeholder="Write a message" maxlength="4000"></textarea>
      <div class="msg-actions">
        <button class="msg-btn sm msg-hide" id="msgAttach" type="button">Attach a comp</button>
        <span class="msg-grow"></span>
        <span class="msg-hint" id="msgSendMsg"></span>
        <button class="msg-btn primary sm" id="msgSend" type="button">Send</button>
      </div>
    </div>
  </div>
</div>

<div id="msgGate" class="msg-empty" style="margin:40px auto">Loading your messages…</div>

<script>
(function(){
  var BOOT = ${bootJson};
  var $ = function(id){ return document.getElementById(id); };
  var state = {
    me: "", firm: null, people: [], threads: [], canAttach: false,
    openId: "", cursor: "", messages: [], tab: "chat", side: "chats", picked: [],
    attach: [], vault: null, poll: null, lastActive: Date.now(), sending: false
  };

  // --- small helpers ------------------------------------------------------
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];
    });
  }
  function initial(s){ s = String(s || "").trim(); return s ? s.charAt(0).toUpperCase() : "?"; }
  function money(v){
    var n = Number(v);
    if (!isFinite(n) || !n) return "";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function num(v){
    var n = Number(v);
    return isFinite(n) && n ? Math.round(n).toLocaleString("en-US") : "";
  }
  function when(iso){
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = new Date(t), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    var year = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], year ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
  }
  function dayLabel(iso){
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = new Date(t), now = new Date();
    var yday = new Date(now.getTime() - 86400000);
    if (d.toDateString() === now.toDateString()) return "Today";
    if (d.toDateString() === yday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  }
  function api(method, url, body){
    var opts = { method: method, credentials: "same-origin", headers: { accept: "application/json" } };
    if (body !== undefined) {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){ return { s: r.status, j: j }; });
    });
  }
  function note(text, bad){
    var el = $("msgNote");
    el.textContent = text || "";
    el.className = "msg-note" + (bad ? " bad" : "") + (text ? "" : " msg-hide");
  }

  // --- the gate: signed out, no firm, or no database ----------------------
  function gate(html){
    $("msgPage").hidden = true;
    $("msgGate").innerHTML = html;
    $("msgGate").style.display = "";
  }
  function ungate(){
    $("msgGate").style.display = "none";
    $("msgPage").hidden = false;
  }

  // --- the thread list ----------------------------------------------------
  function threadMatches(t, q){
    if (!q) return true;
    q = q.toLowerCase();
    if (String(t.label || "").toLowerCase().indexOf(q) >= 0) return true;
    for (var i = 0; i < (t.members || []).length; i++) {
      if (String(t.members[i].email || "").toLowerCase().indexOf(q) >= 0) return true;
    }
    return String(t.preview || "").toLowerCase().indexOf(q) >= 0;
  }
  // --- Chats / People ------------------------------------------------------
  // Which of the two lists this column is showing. The thread list and the
  // directory share the column, the search box and the row furniture, so a
  // person and a conversation read as one place rather than two designs.
  function setSide(tab){
    state.side = tab;
    $("msgSideChats").setAttribute("aria-pressed", tab === "chats" ? "true" : "false");
    $("msgSidePeople").setAttribute("aria-pressed", tab === "people" ? "true" : "false");
    $("msgThreads").className = tab === "chats" ? "msg-threads" : "msg-threads msg-hide";
    $("msgPeople").className = tab === "people" ? "msg-threads" : "msg-threads msg-hide";
    $("msgFilter").placeholder = tab === "people" ? "Search people" : "Search";
    if (tab === "chats") renderThreads(); else renderPeople();
  }

  // Everyone at the firm except you, INCLUDING people who have been invited
  // and have not joined yet. Showing them is what turns "why isn't Sarah
  // here" from a bug report into a legible state: the firm knows about her,
  // she has not accepted. They are not clickable, because a thread member has
  // to be an account.
  function renderPeople(){
    var q = ($("msgFilter").value || "").trim().toLowerCase();
    var list = state.people.filter(function(p){
      if (!q) return true;
      return (p.name + " " + p.email).toLowerCase().indexOf(q) >= 0;
    });
    if (!state.people.length) {
      $("msgPeople").innerHTML = '<div class="msg-empty"><h3>Nobody else here yet</h3>' +
        '<p>Once colleagues join your firm they will show up here and you can message them.</p></div>';
      return;
    }
    if (!list.length) { $("msgPeople").innerHTML = '<div class="msg-empty">Nobody matches that.</div>'; return; }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var waiting = p.pending || !p.userId;
      html += '<' + (waiting ? "div" : "button") + ' class="msg-person' + (waiting ? " waiting" : "") + '"' +
        (waiting ? "" : ' type="button" data-person-dm="' + esc(p.userId) + '"') + '>' +
        '<span class="msg-av">' + esc(initial(p.name)) + '</span>' +
        '<span class="msg-rowbody">' +
          '<span class="msg-name">' + esc(p.name) + '</span>' +
          '<span class="msg-sub">' + esc(waiting ? "Invited, has not joined yet" : p.email) + '</span>' +
        '</span></' + (waiting ? "div" : "button") + '>';
    }
    $("msgPeople").innerHTML = html;
  }

  // Click a person, land in the conversation with them. The route is
  // idempotent on the pair, so this opens the existing thread when there is
  // one and makes it when there is not.
  function openDmWith(userId){
    api("POST", "/api/messages/thread", { kind: "dm", memberIds: [userId] }).then(function(o){
      if (o.s !== 201) { note((o.j && o.j.error) || "Couldn't open that conversation.", true); return; }
      var id = o.j.thread.id;
      refreshList(true).then(function(){ setSide("chats"); openThread(id, true); });
    });
  }

  function renderThreads(){
    var q = ($("msgFilter").value || "").trim();
    var list = state.threads.filter(function(t){ return threadMatches(t, q); });
    if (!state.threads.length) {
      $("msgThreads").innerHTML =
        '<div class="msg-empty"><h3>No conversations yet</h3>' +
        '<p>Start one with somebody at your firm. Everything you send stays here.</p></div>';
      return;
    }
    if (!list.length) {
      $("msgThreads").innerHTML = '<div class="msg-empty">Nothing matches that.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var chan = t.kind === "channel";
      html += '<button class="msg-row' + (t.unread ? " is-unread" : "") + '" type="button"' +
        ' data-thread="' + esc(t.id) + '"' + (t.id === state.openId ? ' aria-current="true"' : "") + '>' +
        '<span class="msg-av' + (chan ? " chan" : "") + '">' + esc(chan ? "#" : initial(t.label)) + '</span>' +
        '<span class="msg-rowbody">' +
          '<span class="msg-rowtop">' +
            '<span class="msg-name">' + esc(t.label) + '</span>' +
            '<span class="msg-when">' + esc(when(t.lastMessageAt)) + '</span>' +
          '</span>' +
          '<span class="msg-prev">' + esc(t.preview || "No messages yet") + '</span>' +
        '</span>' +
        (t.unread ? '<span class="msg-unread">' + (t.unread > 99 ? "99+" : t.unread) + '</span>' : "") +
        '</button>';
    }
    $("msgThreads").innerHTML = html;
  }

  // --- one comp card ------------------------------------------------------
  function compCard(c){
    var s = c.snapshot || {};
    var facts = [];
    if (s.transaction) facts.push('<span>' + esc(String(s.transaction).charAt(0).toUpperCase() + String(s.transaction).slice(1)) + '</span>');
    if (c.dealDate) facts.push('<span>' + esc(c.dealDate) + '</span>');
    else facts.push('<span>Undated</span>');
    if (s.price) facts.push('<span><b>' + esc(money(s.price)) + '</b></span>');
    if (s.size_sqft) facts.push('<span>' + esc(num(s.size_sqft)) + ' SF</span>');
    if (s.price_per_sqft) facts.push('<span>' + esc(money(s.price_per_sqft)) + '/SF</span>');
    else if (s.rent_psf_yr) facts.push('<span>' + esc(money(s.rent_psf_yr)) + '/SF/yr</span>');
    // A comp YOU sent came out of your own vault, so a Save button on it can
    // only be a no-op. It says so instead, and drops the "Sent by" line, which
    // would otherwise be your own name repeated back at you.
    var foot = c.mine
      ? '<span class="msg-hint">You sent this from your vault</span>'
      : (c.savedByMe
          ? '<span class="msg-saved">In your vault</span>'
          : (state.canAttach
              ? '<button class="msg-btn sm" type="button" data-save="' + esc(c.id) + '">Save to my vault</button>'
              : '<span class="msg-hint">A vault is part of Pro.</span>'));
    return '<div class="msg-comp">' +
      '<h4>' + esc(c.address || "Untitled comp") + '</h4>' +
      '<div class="facts">' +
        (c.propertyType ? '<span class="msg-chip">' + esc(c.propertyType) + '</span>' : "") +
        facts.join("") +
      '</div>' +
      '<div class="foot">' + foot +
        (!c.mine && c.sharedBy ? '<span class="msg-hint">Sent by ' + esc(c.sharedBy) + '</span>' : "") +
      '</div>' +
    '</div>';
  }

  // --- the stream ---------------------------------------------------------
  function renderStream(){
    if (state.tab === "comps") return;
    if (!state.openId) {
      $("msgStream").innerHTML = '<div class="msg-empty"><h3>Select a conversation</h3>' +
        '<p>Or start a new one with somebody at your firm.</p></div>';
      return;
    }
    if (!state.messages.length) {
      $("msgStream").innerHTML = '<div class="msg-empty"><h3>Nothing here yet</h3>' +
        '<p>Say something, or send a comp across.</p></div>';
      return;
    }
    var html = "", lastDay = "", lastWho = "", lastAt = 0;
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      var day = dayLabel(m.createdAt);
      if (day && day !== lastDay) {
        html += '<div class="msg-day">' + esc(day) + '</div>';
        lastDay = day;
        lastWho = "";
      }
      var t = Date.parse(m.createdAt || "") || 0;
      // Consecutive messages from one author inside five minutes collapse into
      // one block, the way every messenger does it — a name and a timestamp on
      // every line makes a short back-and-forth unreadable.
      var cont = m.author === lastWho && t - lastAt < 5 * 60 * 1000;
      lastWho = m.author; lastAt = t;
      // The server resolves this against the users table; the email local part
      // is the fallback it already uses, restated here for a payload written
      // before authorName existed.
      var name = m.mine ? "You" : (m.authorName || String(m.author || "").split("@")[0] || "A colleague");
      var comps = "";
      for (var k = 0; k < (m.comps || []).length; k++) comps += compCard(m.comps[k]);
      html += '<div class="msg-line' + (cont ? " cont" : "") + '">' +
        '<span class="msg-av">' + esc(initial(name)) + '</span>' +
        '<div class="msg-body">' +
          (cont ? "" : '<div class="msg-meta"><span class="msg-author">' + esc(name) + '</span>' +
            '<span class="msg-time">' + esc(when(m.createdAt)) + '</span></div>') +
          (m.body ? '<div class="msg-text">' + esc(m.body) + '</div>' : "") +
          comps +
        '</div></div>';
    }
    var el = $("msgStream");
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  // --- the Comps tab ------------------------------------------------------
  function renderComps(rows){
    if (!rows.length) {
      $("msgStream").innerHTML = '<div class="msg-empty"><h3>No comps in this conversation</h3>' +
        '<p>Anything sent from a vault is kept here for good.</p></div>';
      return;
    }
    var html = '<div class="msg-note">' + rows.length + (rows.length === 1 ? " comp has" : " comps have") +
      ' been sent in this conversation. They stay here whatever happens to the original.</div>';
    for (var i = 0; i < rows.length; i++) html += compCard(rows[i]);
    $("msgStream").innerHTML = html;
    $("msgStream").scrollTop = 0;
  }

  function setTab(tab){
    state.tab = tab;
    $("msgTabChat").setAttribute("aria-pressed", tab === "chat" ? "true" : "false");
    $("msgTabComps").setAttribute("aria-pressed", tab === "comps" ? "true" : "false");
    $("msgComposer").className = tab === "chat" ? "msg-composer" : "msg-composer msg-hide";
    $("msgTray").className = tab === "chat" ? "msg-comp-tray" : "msg-comp-tray msg-hide";
    if (tab === "chat") { renderStream(); return; }
    $("msgStream").innerHTML = '<div class="msg-empty">Loading…</div>';
    api("GET", "/api/messages/comps?thread=" + encodeURIComponent(state.openId)).then(function(o){
      if (state.tab !== "comps") return;
      if (o.s !== 200) { $("msgStream").innerHTML = '<div class="msg-empty">' + esc((o.j && o.j.error) || "Couldn't load these.") + '</div>'; return; }
      renderComps((o.j && o.j.comps) || []);
    });
  }

  // --- opening a thread ---------------------------------------------------
  // jump says whether to bring the THREAD PANE forward, which only means
  // anything below 901px where the two panes are one. It is separate from
  // loading the thread on purpose: deciding that from a media query at boot
  // raced the first layout — on a fresh navigation the pane can still be
  // measuring, so a desktop reader intermittently landed on "Select a
  // conversation" while a reload worked. Nothing now asks the viewport a
  // question the stylesheet already answers.
  function openThread(id, push, jump){
    state.openId = id;
    state.cursor = "";
    state.messages = [];
    state.attach = [];
    renderTray();
    setTab("chat");
    if (jump !== false) $("msgPage").className = "msg-page on-thread";
    renderThreads();
    if (push) {
      try { history.replaceState({}, "", "/messages?t=" + encodeURIComponent(id)); } catch (e) {}
    }
    $("msgStream").innerHTML = '<div class="msg-empty">Loading…</div>';
    readThread(true);
  }

  function readThread(first){
    if (!state.openId) return Promise.resolve();
    var url = "/api/messages/thread?id=" + encodeURIComponent(state.openId) +
      (state.cursor ? "&since=" + encodeURIComponent(state.cursor) : "");
    return api("GET", url).then(function(o){
      if (o.s !== 200) {
        if (first) {
          note((o.j && o.j.error) || "Couldn't load that conversation.", true);
          $("msgStream").innerHTML = "";
        }
        return;
      }
      note("");
      var j = o.j || {};
      if (first) {
        $("msgTitle").textContent = (j.thread && j.thread.label) || "Conversation";
        var members = ((j.thread && j.thread.members) || []).filter(function(m){ return !m.left; });
        $("msgSub").textContent = j.thread && j.thread.kind === "channel"
          ? members.length + (members.length === 1 ? " person" : " people")
          : ((members.filter(function(m){ return m.userId !== state.me; })[0] || {}).email || "");
      }
      var fresh = j.messages || [];
      if (fresh.length) {
        // Ids, not positions: an optimistic local echo and the server's own
        // copy of the same message must not both render.
        var have = {};
        for (var i = 0; i < state.messages.length; i++) have[state.messages[i].id] = true;
        for (var k = 0; k < fresh.length; k++) if (!have[fresh[k].id]) state.messages.push(fresh[k]);
        renderStream();
      } else if (first) {
        renderStream();
      }
      if (j.cursor) state.cursor = j.cursor;
      markRead();
    });
  }

  function markRead(){
    var id = state.openId;
    if (!id) return;
    api("POST", "/api/messages/read", { threadId: id }).then(function(){
      for (var i = 0; i < state.threads.length; i++) {
        if (state.threads[i].id === id) state.threads[i].unread = 0;
      }
      renderThreads();
    });
  }

  // --- polling ------------------------------------------------------------
  // The hub's rules, and they are the same rules for the same reason: a hidden
  // tab has nobody to show anything to, and an idle one has nobody looking.
  // The consequence is the hub's too — an automated browser reports
  // document.hidden === true, so no scripted pass can ever witness live sync
  // here. A person with a visible window is the only instrument for that.
  var IDLE_MS = 10 * 60 * 1000;
  function tick(){
    if (document.hidden) return;
    if (Date.now() - state.lastActive > IDLE_MS) return;
    if (state.tab !== "chat") return;
    readThread(false);
    refreshList(true);
  }
  function markActive(){
    var was = Date.now() - state.lastActive > IDLE_MS;
    state.lastActive = Date.now();
    if (was) tick();
  }
  function startPolling(){
    if (state.poll) clearInterval(state.poll);
    state.poll = setInterval(tick, 15000);
  }

  // --- the list read ------------------------------------------------------
  function refreshList(quiet){
    return api("GET", "/api/messages").then(function(o){
      if (o.s === 401) { gate('<h3>Please sign in</h3><p>Messages are part of your firm\\'s workspace.</p>' +
        '<p><a class="msg-btn" href="/?auth=signin">Sign in</a></p>'); return; }
      if (o.s === 403) { gate('<h3>Messages are for your firm</h3><p>' + esc((o.j && o.j.error) || "") + '</p>' +
        '<p><a class="msg-btn" href="/desk">Go to your workspace</a> <a class="msg-btn" href="/firms">How firms work</a></p>'); return; }
      if (o.s !== 200) {
        if (!quiet) gate('<h3>Messages are unavailable</h3><p>' + esc((o.j && o.j.error) || "Please try again in a minute.") + '</p>');
        return;
      }
      var j = o.j || {};
      state.me = (j.me && j.me.id) || "";
      state.firm = j.firm || null;
      // Everyone at the firm except the reader. Pending invitees ride along
      // and are marked; renderPeople draws them, and everything that needs a
      // real account filters on userId.
      state.people = (j.people || []).filter(function(p){ return p.userId !== state.me; });
      state.canAttach = j.canAttachComps === true;
      state.threads = j.threads || [];
      ungate();
      // The firm as a quiet line at the foot of the column, not as the
      // headline. Counts only people who have actually joined, because a
      // pending invitation is not somebody you can talk to.
      var joined = state.people.filter(function(p){ return !p.pending && p.userId; }).length;
      var waiting = state.people.length - joined;
      $("msgFirmLine").textContent = ((state.firm && state.firm.name) || "Your firm") + " · " +
        joined + (joined === 1 ? " colleague" : " colleagues") +
        (waiting ? ", " + waiting + " invited" : "");
      $("msgAttach").className = state.canAttach ? "msg-btn sm" : "msg-btn sm msg-hide";
      if (state.side === "people") renderPeople(); else renderThreads();
    });
  }

  // --- the composer -------------------------------------------------------
  function renderTray(){
    var html = "";
    for (var i = 0; i < state.attach.length; i++) {
      html += '<span class="msg-tag"><span>' + esc(state.attach[i].address) + '</span>' +
        '<button type="button" data-drop="' + esc(state.attach[i].id) + '" aria-label="Remove">×</button></span>';
    }
    $("msgTray").innerHTML = html;
  }
  function send(){
    if (state.sending || !state.openId) return;
    var text = $("msgInput").value;
    var ids = state.attach.map(function(c){ return c.id; });
    if (!text.trim() && !ids.length) return;
    state.sending = true;
    $("msgSend").disabled = true;
    $("msgSendMsg").textContent = "";
    api("POST", "/api/messages/send", { threadId: state.openId, body: text, compIds: ids })
      .then(function(o){
        state.sending = false;
        $("msgSend").disabled = false;
        if (o.s !== 201) { $("msgSendMsg").textContent = (o.j && o.j.error) || "Couldn't send that."; return; }
        $("msgInput").value = "";
        $("msgInput").style.height = "auto";
        state.attach = [];
        renderTray();
        // Close the vault picker and clear its ticks. It stayed open over the
        // message that had just been sent, with the comp still ticked while
        // the tray below it was empty, so the page showed a comp as selected
        // and as already gone at the same time. It also buried the composer,
        // which is what made a comp and the sentence about it land as two
        // messages instead of one.
        $("msgPicker").className = "msg-panel msg-hide";
        $("msgPickMsg").textContent = "";
        // Guarded: with no vault loaded yet renderPicker writes its empty-vault
        // invitation, and leaving that sitting inside a hidden panel would show
        // it to somebody who opens the picker before the fetch lands.
        if (state.vault) renderPicker();
        // Back to the box, so the next thing typed goes where the reader is
        // already looking.
        try { $("msgInput").focus(); } catch (e) {}
        // Read straight back rather than echoing locally: the server owns the
        // cursor, and one source for what is in a thread means an optimistic
        // bubble can never disagree with what everybody else sees.
        readThread(false).then(function(){ refreshList(true); });
      });
  }

  // --- the vault picker ---------------------------------------------------
  function renderPicker(){
    var q = ($("msgPickFilter").value || "").trim().toLowerCase();
    var rows = state.vault || [];
    if (!rows.length) {
      $("msgPickList").innerHTML = '<div class="msg-hint">Your vault is empty. ' +
        '<a href="/vault">Add comps</a> and they will show up here.</div>';
      return;
    }
    var shown = rows.filter(function(c){
      if (!q) return true;
      return [c.address, c.market, c.property_type, c.tenancy].join(" ").toLowerCase().indexOf(q) >= 0;
    }).slice(0, 60);
    if (!shown.length) { $("msgPickList").innerHTML = '<div class="msg-hint">Nothing matches that.</div>'; return; }
    var chosen = {};
    for (var i = 0; i < state.attach.length; i++) chosen[state.attach[i].id] = true;
    var html = "";
    for (var k = 0; k < shown.length; k++) {
      var c = shown[k];
      html += '<div class="msg-pick"><label>' +
        '<input type="checkbox" data-pick="' + esc(c.id) + '"' + (chosen[c.id] ? " checked" : "") + '>' +
        '<span class="who">' + esc(c.address) +
          '<span class="sub"> · ' + esc(c.property_type || "") +
          (c.deal_date ? " · " + esc(c.deal_date) : "") +
          (c.price ? " · " + esc(money(c.price)) : "") + '</span>' +
        '</span></label></div>';
    }
    $("msgPickList").innerHTML = html;
  }
  function openPicker(){
    $("msgPicker").className = "msg-panel";
    if (state.vault) { renderPicker(); return; }
    $("msgPickList").innerHTML = '<div class="msg-hint">Loading your vault…</div>';
    api("GET", "/api/vault?limit=1000").then(function(o){
      if (o.s !== 200) {
        $("msgPickList").innerHTML = '<div class="msg-hint">' + esc((o.j && o.j.error) || "Couldn't read your vault.") + '</div>';
        return;
      }
      state.vault = (o.j && o.j.comps) || [];
      renderPicker();
    });
  }

  // --- starting a channel --------------------------------------------------
  // CHANNELS ONLY since the People tab exists. A direct message is started by
  // clicking a person, which is where somebody looking for a person already
  // is, so this panel no longer has to guess which of the two you meant from
  // whether you typed a name.
  //
  // Only people who have actually joined can be picked: a thread member has to
  // be an account, so a pending invitee here would be a checkbox that fails on
  // submit.
  function joinedPeople(){
    return state.people.filter(function(p){ return !p.pending && p.userId; });
  }
  function pickedName(id){
    var p = joinedPeople().filter(function(x){ return x.userId === id; })[0];
    return p ? p.name : "Someone";
  }
  // Who is selected so far, as removable chips. Selection lives in state
  // rather than in the checkboxes, because the list below is FILTERED as you
  // type and a checkbox that scrolls out of the filter would take the
  // selection with it.
  function renderNewChips(){
    var html = "";
    for (var i = 0; i < state.picked.length; i++) {
      html += '<span class="msg-tag"><span>' + esc(pickedName(state.picked[i])) + '</span>' +
        '<button type="button" data-unpick="' + esc(state.picked[i]) + '" aria-label="Remove">×</button></span>';
    }
    $("msgNewChips").innerHTML = html;
    // The name field only exists once this is a GROUP. That is what makes the
    // old failure unreachable rather than merely discouraged.
    var group = state.picked.length > 1;
    $("msgNewTitle").className = group ? "" : "msg-hide";
    if (!group) $("msgNewTitle").value = "";
    $("msgNewGo").textContent = state.picked.length === 1
      ? "Message " + pickedName(state.picked[0])
      : (group ? "Start group" : "Start");
  }
  function renderNewPeople(){
    var people = joinedPeople();
    if (!people.length) {
      $("msgNewPeople").innerHTML = '<div class="msg-hint">Nobody else has joined your firm yet, ' +
        'so there is no one to message. Invitations are managed on your ' +
        '<a href="/desk">workspace</a>.</div>';
      return;
    }
    var q = ($("msgNewSearch").value || "").trim().toLowerCase();
    var list = people.filter(function(p){
      if (!q) return true;
      return (p.name + " " + p.email).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) { $("msgNewPeople").innerHTML = '<div class="msg-hint">Nobody matches that.</div>'; return; }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var on = state.picked.indexOf(p.userId) >= 0;
      html += '<div class="msg-pick"><label>' +
        '<input type="checkbox" data-person="' + esc(p.userId) + '"' + (on ? " checked" : "") + '>' +
        '<span class="who">' + esc(p.name) + '<span class="sub"> · ' + esc(p.email) + '</span></span>' +
        '</label></div>';
    }
    $("msgNewPeople").innerHTML = html;
  }
  function openNewPanel(){
    state.picked = [];
    $("msgNewSearch").value = "";
    $("msgNewTitle").value = "";
    $("msgNewMsg").textContent = "";
    $("msgNewPanel").className = "msg-panel";
    renderNewChips();
    renderNewPeople();
    try { $("msgNewSearch").focus(); } catch (e) {}
  }
  function startThread(){
    if (!state.picked.length) { $("msgNewMsg").textContent = "Pick somebody to message."; return; }
    // The title rides along only when it exists; the server ignores one on a
    // single-person pick anyway, so the two cannot disagree.
    var title = state.picked.length > 1 ? ($("msgNewTitle").value || "").trim() : "";
    $("msgNewGo").disabled = true;
    $("msgNewMsg").textContent = "";
    api("POST", "/api/messages/thread", { title: title, memberIds: state.picked }).then(function(o){
      $("msgNewGo").disabled = false;
      if (o.s !== 201) { $("msgNewMsg").textContent = (o.j && o.j.error) || "Couldn't start that."; return; }
      $("msgNewPanel").className = "msg-panel msg-hide";
      state.picked = [];
      refreshList(true).then(function(){ setSide("chats"); openThread(o.j.thread.id, true); });
    });
  }

  // --- wiring -------------------------------------------------------------
  $("msgThreads").addEventListener("click", function(e){
    var row = e.target.closest("[data-thread]");
    if (row) openThread(row.getAttribute("data-thread"), true);
  });
  $("msgStream").addEventListener("click", function(e){
    var btn = e.target.closest("[data-save]");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    api("POST", "/api/messages/comp/save", { compId: btn.getAttribute("data-save") }).then(function(o){
      if (o.s !== 200) { btn.disabled = false; btn.textContent = "Save to my vault"; note((o.j && o.j.error) || "Couldn't save that comp.", true); return; }
      // The vault list this page may already be holding is now stale.
      state.vault = null;
      if (state.tab === "comps") setTab("comps");
      else { state.cursor = ""; state.messages = []; readThread(true); }
    });
  });
  $("msgTray").addEventListener("click", function(e){
    var btn = e.target.closest("[data-drop]");
    if (!btn) return;
    var id = btn.getAttribute("data-drop");
    state.attach = state.attach.filter(function(c){ return c.id !== id; });
    renderTray();
    renderPicker();
  });
  $("msgPickList").addEventListener("change", function(e){
    var box = e.target.closest("input[data-pick]");
    if (!box) return;
    var id = box.getAttribute("data-pick");
    var comp = (state.vault || []).filter(function(c){ return String(c.id) === id; })[0];
    if (!comp) return;
    if (box.checked) {
      if (state.attach.length >= 10) { box.checked = false; $("msgPickMsg").textContent = "Up to 10 comps in one message."; return; }
      state.attach.push({ id: String(comp.id), address: comp.address });
      $("msgPickMsg").textContent = "";
    } else {
      state.attach = state.attach.filter(function(c){ return c.id !== id; });
    }
    renderTray();
  });
  $("msgFilter").addEventListener("input", function(){
    if (state.side === "people") renderPeople(); else renderThreads();
  });
  $("msgSideChats").addEventListener("click", function(){ setSide("chats"); });
  $("msgSidePeople").addEventListener("click", function(){ setSide("people"); });
  $("msgPeople").addEventListener("click", function(e){
    var row = e.target.closest("[data-person-dm]");
    if (row) openDmWith(row.getAttribute("data-person-dm"));
  });
  $("msgPickFilter").addEventListener("input", renderPicker);
  $("msgAttach").addEventListener("click", openPicker);
  $("msgPickDone").addEventListener("click", function(){ $("msgPicker").className = "msg-panel msg-hide"; });
  $("msgSend").addEventListener("click", send);
  $("msgTabChat").addEventListener("click", function(){ setTab("chat"); });
  $("msgTabComps").addEventListener("click", function(){ if (state.openId) setTab("comps"); });
  $("msgBack").addEventListener("click", function(){
    $("msgPage").className = "msg-page";
    state.openId = "";
    renderThreads();
    try { history.replaceState({}, "", "/messages"); } catch (e) {}
  });
  $("msgNewBtn").addEventListener("click", function(){
    var open = $("msgNewPanel").className.indexOf("msg-hide") < 0;
    if (open) { $("msgNewPanel").className = "msg-panel msg-hide"; return; }
    openNewPanel();
  });
  $("msgNewSearch").addEventListener("input", renderNewPeople);
  // Selection lives in state, not in the checkboxes: the list is filtered as
  // you type, so a box that leaves the filter would take its tick with it.
  $("msgNewPeople").addEventListener("change", function(e){
    var box = e.target.closest("input[data-person]");
    if (!box) return;
    var id = box.getAttribute("data-person");
    var at = state.picked.indexOf(id);
    if (box.checked && at < 0) state.picked.push(id);
    if (!box.checked && at >= 0) state.picked.splice(at, 1);
    $("msgNewMsg").textContent = "";
    renderNewChips();
  });
  $("msgNewChips").addEventListener("click", function(e){
    var btn = e.target.closest("[data-unpick]");
    if (!btn) return;
    var at = state.picked.indexOf(btn.getAttribute("data-unpick"));
    if (at >= 0) state.picked.splice(at, 1);
    renderNewChips();
    renderNewPeople();
  });
  $("msgNewCancel").addEventListener("click", function(){ $("msgNewPanel").className = "msg-panel msg-hide"; });
  $("msgNewGo").addEventListener("click", startThread);
  $("msgInput").addEventListener("input", function(){
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 180) + "px";
  });
  $("msgInput").addEventListener("keydown", function(e){
    // Enter sends, Shift+Enter is a newline — every messenger's contract, and
    // the textarea is deliberately multi-line so the other half works.
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); send(); }
  });
  document.addEventListener("visibilitychange", function(){
    if (!document.hidden) { state.lastActive = Date.now(); tick(); }
  });
  ["keydown", "pointerdown", "focus"].forEach(function(ev){
    document.addEventListener(ev, markActive, true);
  });

  // --- boot ---------------------------------------------------------------
  // The server hands the first answer down with the page (BOOT) so the list
  // paints without a round trip; the fetch below is what keeps it current and
  // is also the whole path when BOOT is null.
  function start(){
    var wanted = "";
    try { wanted = new URL(location.href).searchParams.get("t") || ""; } catch (e) {}
    refreshList(false).then(function(){
      if (!state.threads.length) return;
      // The newest conversation is always LOADED, on every width — the two
      // panes are one stylesheet decision and the data costs one request. What
      // the width decides is which pane a phone shows, and only a link that
      // named a thread (?t=) jumps straight into it; arriving at /messages on
      // a phone leaves the reader on the list they came for.
      openThread(wanted || state.threads[0].id, Boolean(wanted), Boolean(wanted));
    });
    startPolling();
  }
  if (BOOT && BOOT.s && BOOT.s !== 200) {
    // A refusal the server already knows about, rendered before any fetch —
    // so somebody with no firm is told so immediately rather than watching a
    // spinner resolve into a wall.
    if (BOOT.s === 401) gate('<h3>Please sign in</h3><p>Messages are part of your firm\\'s workspace.</p>' +
      '<p><a class="msg-btn" href="/?auth=signin">Sign in</a></p>');
    else if (BOOT.s === 403) gate('<h3>Messages are for your firm</h3>' +
      '<p>' + esc((BOOT.j && BOOT.j.error) || "") + '</p>' +
      '<p><a class="msg-btn" href="/desk">Go to your workspace</a> <a class="msg-btn" href="/firms">How firms work</a></p>');
    else gate('<h3>Messages are unavailable</h3><p>' + esc((BOOT.j && BOOT.j.error) || "Please try again in a minute.") + '</p>');
  } else {
    start();
  }
})();
</script>`;
}

module.exports = { renderMessagesBody };
