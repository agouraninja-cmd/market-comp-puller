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
/* Internal / External group labels. Labels, not tabs: both groups are always
   on screen, and the label exists so you always know which side of the wall a
   row is on before you click it. */
.msg-sect{padding:12px 14px 4px;font-size:10.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink-faint);font-weight:600}
.msg-sect+.msg-row{border-top:1px solid var(--hair)}
/* A note written about one specific comp, tagged with the building it is
   about. */
.msg-about{font-size:11px;color:var(--ink-faint);margin-bottom:1px}

/* The firm, quietly, at the foot of the column. */
.msg-firm{border-top:1px solid var(--hair);padding:9px 14px;font-size:11.5px;
  color:var(--ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Used by the New panel's people rows. */
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
.msg-door{margin:4px 0 8px}
/* The always-there invite row. Muted until a real email is typed, at which
   point renderNewPeople replaces it with the ordinary checkbox row. It is a
   button because it does something (focuses the box and says what to type),
   not because it is a link somewhere. */
.msg-invite{display:block;width:100%;text-align:left;background:none;border:0;
  border-top:1px solid var(--hair);padding:8px 4px;margin-top:2px;
  color:var(--ink-faint);font:inherit;font-size:12.5px;cursor:pointer}
.msg-invite:hover{color:var(--ink)}
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
  <!-- ONE heading. The eyebrow above this said Messages too, directly over an
       h1 saying Messages, under a rail row saying Messages. -->
  <h1 style="margin:0 0 4px;font-size:26px;letter-spacing:-.01em">Messages</h1>
  <p style="margin:0;color:var(--ink-2);max-width:62ch;font-size:14px;line-height:1.6">
    Message the people you work with, and the people outside your firm you
    share comps with. Anything you send is kept in the conversation, so a deal
    you talk about stays on the record instead of in somebody's text messages.
  </p>
</section>

<div class="msg-page" id="msgPage" hidden>
  <aside class="msg-side">
    <!-- ONE list (owner's, 2026-09-01). There was a People tab beside this
         one, listing the firm; it went because New already searches the same
         people and a directory you have to switch views to reach is a second
         answer to the same question. Chats is a LABEL now, not a tab — a tab
         with one option is a button that does nothing. -->
    <div class="msg-head">
      <h2 id="msgSideChats">Chats</h2>
      <span class="msg-grow"></span>
      <button class="msg-btn sm" id="msgNewBtn" type="button">New</button>
    </div>
    <div class="msg-search"><input id="msgFilter" type="search" placeholder="Search" autocomplete="off"></div>
    <div class="msg-threads" id="msgThreads"></div>
    <!-- PEOPLE FIRST. The box searches colleagues; it used to be a channel
         name with "leave blank for a direct message" under it, so typing a
         label for a conversation with one person silently made a CHANNEL
         called that. What you get now follows from how many people you pick:
         one is a direct message, two or more is a group. THERE IS NO NAME
         FIELD AT ALL now (owner's, 2026-09-01): every conversation is called
         after the people in it, so the input that caused that bug does not
         exist anywhere to be typed into. -->
    <div class="msg-panel msg-hide" id="msgNewPanel">
      <h3>New conversation</h3>
      <input id="msgNewSearch" type="text" placeholder="Search people" autocomplete="off">
      <!-- The panel does TWO jobs and only ever advertised one. The invite
           row below appears only once a COMPLETE email has been typed, so
           until this line existed the only way to learn the door was there
           was to already know, or to type something that matched nobody and
           read the failure. Owner found it by hunting, 2026-09-02.
           Written by JS (setNewDoorCopy) rather than here, because the
           second half of it is only true for a member with a vault. -->
      <div class="msg-hint msg-door" id="msgNewDoor"></div>
      <div id="msgNewChips" class="msg-chips"></div>
      <div id="msgNewPeople"></div>
      <!-- Only for an EXTERNAL conversation, and optional. Internal
           conversations have no names (owner's rule) and that stands; this is
           not a name for you, it is the subject line the CLIENT sees in their
           invite email and on their page. Left empty, the email says "shared a
           set of comps with you", which reads fine. -->
      <input id="msgNewAbout" class="msg-hide" type="text" maxlength="200"
        placeholder="What's this about? Optional. They see it.">
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
      <button class="msg-btn sm msg-hide" id="msgPeopleBtn" type="button">People</button>
    </div>
    <div class="msg-note msg-hide" id="msgNote"></div>
    <div class="msg-stream" id="msgStream"></div>
    <!-- The guest list of an EXTERNAL conversation: who is in it, whether
         they have opened it, inviting somebody, removing somebody, and closing
         the deal out. This panel is what lets the vault's hubs deck retire —
         every job that deck did is reachable from the conversation itself. -->
    <div class="msg-panel msg-hide" id="msgPeoplePanel">
      <h3>People in this conversation</h3>
      <div id="msgPeopleList"></div>
      <input id="msgPeopleAdd" type="text" placeholder="Invite somebody by email" autocomplete="off">
      <div class="msg-panelfoot">
        <button class="msg-btn primary sm" id="msgPeopleGo" type="button">Send invite</button>
        <button class="msg-btn sm" id="msgPeopleDone" type="button">Done</button>
        <span class="msg-hint" id="msgPeopleMsg"></span>
        <span class="msg-grow"></span>
        <button class="msg-btn sm" id="msgCloseHub" type="button">Close conversation</button>
      </div>
      <div id="msgLinks"></div>
    </div>
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
        <span class="msg-hint msg-hide" id="msgMailNote">They get an email about new messages</span>
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
    openId: "", openKind: "internal", cursor: "", messages: [], tab: "chat", picked: [],
    external: [], extItems: [], extPeopleList: [], canWriteExt: false,
    pickedExt: [], extLinks: null,
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
  // --- External conversations (deal rooms) --------------------------------
  // A deal room is read and written through the hub API that already runs the
  // client's own page, so the two sides can never disagree about what was
  // said. This page is a second WINDOW onto that room, not a second room.
  function extRow(){
    for (var i = 0; i < state.external.length; i++) {
      if (state.external[i].id === state.openId) return state.external[i];
    }
    return null;
  }
  function extName(email){
    var e = String(email || "").toLowerCase();
    if (state.me2 && e === state.me2) return "You";
    var row = extRow();
    if (row) {
      for (var i = 0; i < (row.people || []).length; i++) {
        if (row.people[i].email === e) return row.people[i].name;
      }
    }
    return e.split("@")[0] || "Someone";
  }
  function openExternal(id, push, jump){
    state.openKind = "external";
    state.openId = id;
    state.cursor = "";
    state.messages = [];
    state.extItems = [];
    state.extPeopleList = [];
    state.attach = [];
    state.canWriteExt = false;
    $("msgPeoplePanel").className = "msg-panel msg-hide";
    renderTray();
    setTab("chat");
    if (jump !== false) $("msgPage").className = "msg-page on-thread";
    renderThreads();
    if (push) {
      try { history.replaceState({}, "", "/messages?x=" + encodeURIComponent(id)); } catch (e) {}
    }
    var row = extRow();
    $("msgTitle").textContent = row ? row.label : "Conversation";
    $("msgSub").textContent = row ? (row.title + (row.closed ? " · closed" : "")) : "";
    $("msgStream").innerHTML = '<div class="msg-empty">Loading…</div>';
    applyComposerMode();
    readExternal(true);
  }
  function readExternal(first){
    if (state.openKind !== "external" || !state.openId) return Promise.resolve();
    var url = "/api/hub?id=" + encodeURIComponent(state.openId) +
      (state.cursor ? "&since=" + encodeURIComponent(state.cursor) : "");
    return api("GET", url).then(function(o){
      if (state.openKind !== "external") return;
      if (o.s !== 200) {
        if (first) {
          note((o.j && o.j.error) || "Couldn't load that conversation.", true);
          $("msgStream").innerHTML = "";
        }
        return;
      }
      note("");
      var j = o.j || {};
      // Items arrive WHOLE on every read (the hub route's own rule), so they
      // replace; messages arrive incrementally past the cursor, so they
      // append, deduped by id against an optimistic double-read.
      state.extItems = j.items || [];
      state.extPeopleList = j.people || [];
      state.canWriteExt = j.canWrite === true;
      if ($("msgPeoplePanel").className.indexOf("msg-hide") < 0) renderPeoplePanel();
      var fresh = j.messages || [];
      if (fresh.length) {
        var have = {};
        for (var i = 0; i < state.messages.length; i++) have[state.messages[i].id] = true;
        for (var k = 0; k < fresh.length; k++) if (!have[fresh[k].id]) state.messages.push(fresh[k]);
      }
      if (j.cursor) state.cursor = j.cursor;
      if (state.tab === "chat") renderExternalStream();
      applyComposerMode();
      // The server stamped this read as seen, so the badge is already off on
      // its side; this clears the local copy without waiting for the poll.
      var row = extRow();
      if (row) { row.unread = 0; renderThreads(); }
    });
  }
  function extCompCard(item){
    var s = item.snapshot || {};
    var facts = [];
    if (s.transaction) facts.push('<span>' + esc(String(s.transaction).charAt(0).toUpperCase() + String(s.transaction).slice(1)) + '</span>');
    if (s.deal_date) facts.push('<span>' + esc(s.deal_date) + '</span>');
    if (s.price) facts.push('<span><b>' + esc(money(s.price)) + '</b></span>');
    if (s.size_sqft) facts.push('<span>' + esc(num(s.size_sqft)) + ' SF</span>');
    if (s.price_per_sqft) facts.push('<span>' + esc(money(s.price_per_sqft)) + '/SF</span>');
    else if (s.rent_psf_yr) facts.push('<span>' + esc(money(s.rent_psf_yr)) + '/SF/yr</span>');
    var who = extName(item.addedBy);
    var foot = who === "You"
      ? '<span class="msg-hint">You sent this from your vault</span>'
      : '<span class="msg-hint">Added by ' + esc(who) + '</span>';
    return '<div class="msg-comp">' +
      '<h4>' + esc(s.address || "Untitled comp") + '</h4>' +
      '<div class="facts">' +
        (s.property_type ? '<span class="msg-chip">' + esc(s.property_type) + '</span>' : "") +
        facts.join("") +
      '</div>' +
      '<div class="foot">' + foot + '</div>' +
    '</div>';
  }
  function renderExternalStream(){
    if (!state.messages.length && !state.extItems.length) {
      $("msgStream").innerHTML = '<div class="msg-empty"><h3>Nothing here yet</h3>' +
        '<p>Say something, or send a comp across.</p></div>';
      return;
    }
    // One stream: what was said AND what was sent, in the order it happened.
    // The deal room's own page draws comps as a list above the notes; an
    // inbox reads top to bottom, so a comp lands inline at the moment it was
    // added.
    var entries = [];
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      entries.push({ at: m.createdAt, kind: "msg", m: m });
    }
    for (var k = 0; k < state.extItems.length; k++) {
      var it = state.extItems[k];
      if (it.kind !== "comp") continue;
      entries.push({ at: it.addedAt, kind: "comp", it: it });
    }
    entries.sort(function(a, b){ return String(a.at || "").localeCompare(String(b.at || "")); });

    var byId = {};
    for (var q = 0; q < state.extItems.length; q++) byId[state.extItems[q].id] = state.extItems[q];

    var html = "", lastDay = "", lastWho = "", lastAt = 0;
    for (var e = 0; e < entries.length; e++) {
      var it2 = entries[e];
      var day = dayLabel(it2.at);
      if (day && day !== lastDay) {
        html += '<div class="msg-day">' + esc(day) + '</div>';
        lastDay = day;
        lastWho = "";
      }
      var t = Date.parse(it2.at || "") || 0;
      var authorEmail = it2.kind === "msg" ? it2.m.author : it2.it.addedBy;
      var name = extName(authorEmail);
      var cont = authorEmail === lastWho && t - lastAt < 5 * 60 * 1000;
      lastWho = authorEmail; lastAt = t;
      var body = "";
      if (it2.kind === "msg") {
        // A note written on one specific comp says which one, so the thread
        // reads whole without opening the deal room.
        var about = it2.m.itemId && byId[it2.m.itemId] && byId[it2.m.itemId].snapshot
          ? '<div class="msg-about">about ' + esc(byId[it2.m.itemId].snapshot.address || "a comp") + '</div>'
          : "";
        body = about + (it2.m.body ? '<div class="msg-text">' + esc(it2.m.body) + '</div>' : "");
      } else {
        body = extCompCard(it2.it);
      }
      html += '<div class="msg-line' + (cont ? " cont" : "") + '">' +
        '<span class="msg-av">' + esc(initial(name)) + '</span>' +
        '<div class="msg-body">' +
          (cont ? "" : '<div class="msg-meta"><span class="msg-author">' + esc(name) + '</span>' +
            '<span class="msg-time">' + esc(when(it2.at)) + '</span></div>') +
          body +
        '</div></div>';
    }
    var el = $("msgStream");
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }
  // --- The guest list ------------------------------------------------------
  function currentPeopleEmails(){
    return state.extPeopleList.map(function(p){ return String(p.email || "").toLowerCase(); }).filter(Boolean);
  }
  function renderPeoplePanel(){
    var row = extRow();
    var closed = !state.canWriteExt || (row && row.closed);
    var html = "";
    if (!state.extPeopleList.length) {
      html = '<div class="msg-hint" style="margin-bottom:8px">Nobody has been invited yet. ' +
        'Add an email below and they get a private link — no account needed.</div>';
    }
    for (var i = 0; i < state.extPeopleList.length; i++) {
      var p = state.extPeopleList[i];
      html += '<div class="msg-pick"><span class="who">' + esc(p.email) +
        '<span class="sub"> · ' + (p.opened ? "has opened it" : "hasn't opened it yet") + '</span></span>' +
        (closed ? "" : '<button class="msg-btn sm" type="button" data-remove-person="' + esc(p.email) + '">Remove</button>') +
        '</div>';
    }
    $("msgPeopleList").innerHTML = html;
    $("msgPeopleAdd").disabled = closed;
    $("msgPeopleGo").disabled = closed;
    $("msgCloseHub").className = closed ? "msg-btn sm msg-hide" : "msg-btn sm";
    renderInviteLinks();
  }
  // Links that could not be emailed, shown ONCE: only the hash of each token
  // is stored, so a link not copied out of this panel reaches nobody and can
  // never be shown again. The vault's old panel made the same promise; it
  // moved here with the job.
  function renderInviteLinks(){
    var l = state.extLinks;
    // One-time links belong to the room whose create or invite produced them.
    // Rendering them inside any other room would hand one client's private
    // door to a different conversation's panel.
    if (l && l.id && l.id !== state.openId) l = null;
    var failed = l ? (l.emailFailed || []) : [];
    var show = l && (l.invites || []).filter(function(i){
      return !l.emailed && (failed.length === 0 || failed.indexOf(i.email) >= 0);
    });
    if (!l || !show || !show.length) { $("msgLinks").innerHTML = ""; return; }
    var html = '<div class="msg-hint" style="margin:8px 0 6px">' +
      (failed.length ? esc(failed.join(", ")) + ' could not be emailed. ' : '') +
      'Copy each link and send it yourself — these cannot be shown again.</div>';
    for (var i = 0; i < show.length; i++) {
      html += '<div class="msg-pick" style="gap:6px">' +
        '<span class="sub" style="flex:0 0 auto">' + esc(show[i].email) + '</span>' +
        '<input type="text" readonly value="' + esc(show[i].url) + '" id="msgLnk' + i + '" style="flex:1;min-width:200px;margin:0">' +
        '<button class="msg-btn sm" type="button" data-copy-link="msgLnk' + i + '">Copy</button></div>';
    }
    $("msgLinks").innerHTML = html;
  }
  function openPeoplePanel(){
    $("msgPicker").className = "msg-panel msg-hide";
    $("msgPeoplePanel").className = "msg-panel";
    $("msgPeopleMsg").textContent = "";
    renderPeoplePanel();
  }
  function invitePerson(){
    var email = ($("msgPeopleAdd").value || "").trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { $("msgPeopleMsg").textContent = "That doesn't look like an email address."; return; }
    if (currentPeopleEmails().indexOf(email) >= 0) { $("msgPeopleMsg").textContent = "They're already in this conversation."; return; }
    $("msgPeopleGo").disabled = true;
    $("msgPeopleMsg").textContent = "";
    // WHOLESALE, the route's contract: the full list plus the newcomer.
    // Re-sending the people already on it re-mails nobody (the route's own
    // rule), so add costs exactly one invitation.
    api("PUT", "/api/hub/participants", { id: state.openId, emails: currentPeopleEmails().concat([email]) })
      .then(function(o){
        $("msgPeopleGo").disabled = false;
        if (o.s !== 200) { $("msgPeopleMsg").textContent = (o.j && o.j.error) || "Couldn't invite them."; return; }
        $("msgPeopleAdd").value = "";
        state.extLinks = o.j;
        state.extLinks.id = state.openId;
        $("msgPeopleMsg").textContent = o.j.emailed ? "Invited — they've been emailed their link." : "";
        readExternal(false).then(function(){ renderPeoplePanel(); refreshList(true); });
      });
  }
  function removePerson(email){
    api("PUT", "/api/hub/participants", { id: state.openId, emails: currentPeopleEmails().filter(function(e){ return e !== email; }) })
      .then(function(o){
        if (o.s !== 200) { $("msgPeopleMsg").textContent = (o.j && o.j.error) || "Couldn't remove them."; return; }
        // Removal revokes their link immediately, server-side; the panel just
        // has to catch up.
        readExternal(false).then(function(){ renderPeoplePanel(); refreshList(true); });
      });
  }
  function closeConversation(){
    api("POST", "/api/hub/close", { id: state.openId }).then(function(o){
      if (o.s !== 200) { $("msgPeopleMsg").textContent = (o.j && o.j.error) || "Couldn't close it."; return; }
      var row = extRow();
      if (row) row.closed = true;
      state.canWriteExt = false;
      applyComposerMode();
      renderPeoplePanel();
      renderThreads();
      $("msgSub").textContent = row ? (row.title ? row.title + " · closed" : "closed") : "closed";
    });
  }

  // What the composer is allowed to do depends on which side of the wall the
  // open conversation is on, and — outside it — on whether the room is
  // closed. One writer, so a closed room and an internal thread cannot
  // disagree about what shows.
  function applyComposerMode(){
    var external = state.openKind === "external";
    var row = external ? extRow() : null;
    // WHOSE room this is. External used to mean "mine", so the two questions
    // were one; a guest's room joined the list on 2026-09-02 and they came
    // apart. The server answers it (owner, on the row) rather than the page
    // guessing from an email match.
    var mine = external && !!row && row.owner === true;
    var closed = external && (!state.canWriteExt || (row && row.closed));
    $("msgInput").disabled = closed;
    $("msgInput").placeholder = closed ? "This conversation is closed" : "Write a message";
    $("msgSend").disabled = closed;
    $("msgMailNote").className = external && !closed ? "msg-hint" : "msg-hint msg-hide";
    // Sending comps into a deal room is the BROKER'S act — POST /api/hub/items
    // is owner-only — so a guest's room gets no Attach button rather than one
    // whose only outcome is "Only the broker who created this hub can send
    // comps into it". Inside the firm it stays exactly as it was.
    $("msgAttach").className = state.canAttach && !closed && (!external || mine)
      ? "msg-btn sm" : "msg-btn sm msg-hide";
    // The guest list is the OWNER'S panel — closed rooms included, since who
    // was in a closed deal is still worth reading; the panel disables its own
    // write controls. A guest never sees it, because the other addresses in
    // the room are the broker's client relationships and none of theirs: the
    // same wall GET /api/hub draws, which simply sends them no people.
    $("msgPeopleBtn").className = mine ? "msg-btn sm" : "msg-btn sm msg-hide";
    if (!mine) $("msgPeoplePanel").className = "msg-panel msg-hide";
    if (closed) { $("msgPicker").className = "msg-panel msg-hide"; }
  }

  function threadRowHtml(t, attr, current, sub){
    var chan = t.kind === "channel";
    return '<button class="msg-row' + (t.unread ? " is-unread" : "") + '" type="button"' +
      ' ' + attr + '="' + esc(t.id) + '"' + (current ? ' aria-current="true"' : "") + '>' +
      '<span class="msg-av' + (chan ? " chan" : "") + '">' + esc(chan ? "#" : initial(t.label)) + '</span>' +
      '<span class="msg-rowbody">' +
        '<span class="msg-rowtop">' +
          '<span class="msg-name">' + esc(t.label) + '</span>' +
          '<span class="msg-when">' + esc(when(t.lastMessageAt)) + '</span>' +
        '</span>' +
        '<span class="msg-prev">' + esc(sub) + '</span>' +
      '</span>' +
      (t.unread ? '<span class="msg-unread">' + (t.unread > 99 ? "99+" : t.unread) + '</span>' : "") +
      '</button>';
  }
  function externalMatches(t, q){
    if (!q) return true;
    q = q.toLowerCase();
    if (String(t.label || "").toLowerCase().indexOf(q) >= 0) return true;
    if (String(t.title || "").toLowerCase().indexOf(q) >= 0) return true;
    for (var i = 0; i < (t.people || []).length; i++) {
      if (String(t.people[i].email || "").toLowerCase().indexOf(q) >= 0) return true;
    }
    return String(t.preview || "").toLowerCase().indexOf(q) >= 0;
  }
  function renderThreads(){
    var q = ($("msgFilter").value || "").trim();
    var list = state.threads.filter(function(t){ return threadMatches(t, q); });
    var ext = state.external.filter(function(t){ return externalMatches(t, q); });
    if (!state.threads.length && !state.external.length) {
      $("msgThreads").innerHTML =
        '<div class="msg-empty"><h3>No conversations yet</h3>' +
        '<p>' + (state.firm
          ? "Start one with somebody at your firm. Everything you send stays here."
          : "Everything shared with you shows up here.") + '</p></div>';
      return;
    }
    if (!list.length && !ext.length) {
      $("msgThreads").innerHTML = '<div class="msg-empty">Nothing matches that.</div>';
      return;
    }
    var html = "";
    // The group labels exist only once there are two groups: a member with no
    // deal rooms sees exactly the list they saw yesterday, and the labels are
    // what says which side of the wall a row is on. Internal is the firm;
    // External is the people outside it that this member shares comps with.
    // The group labels exist only once there are two groups to tell apart,
    // and that is judged on what is actually being drawn: a reader whose
    // only conversations are deal rooms (a client, now that a guest's rooms
    // list) would otherwise get a lone "External" heading over the whole
    // list, external to a firm they are not in.
    var both = list.length > 0 && ext.length > 0;
    if (both) html += '<div class="msg-sect">Internal</div>';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      html += threadRowHtml(t, "data-thread",
        state.openKind === "internal" && t.id === state.openId,
        t.preview || "No messages yet");
    }
    if (both) html += '<div class="msg-sect">External</div>';
    for (var k = 0; k < ext.length; k++) {
      var x = ext[k];
      // The deal's title is the second line when nothing has been said yet;
      // once there is a conversation, the conversation wins the row.
      html += threadRowHtml(x, "data-external",
        state.openKind === "external" && x.id === state.openId,
        x.preview || x.title || "No messages yet");
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
        (state.firm ? '<p>Or start a new one with somebody at your firm.</p>' : "") + '</div>';
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
    if (tab === "chat") {
      if (state.openKind === "external") renderExternalStream(); else renderStream();
      return;
    }
    if (state.openKind === "external") {
      // A deal room's comps are already in hand — the hub read carries its
      // items whole on every poll — so the tab renders from state rather than
      // fetching.
      var live = state.extItems.filter(function(it){ return it.kind === "comp"; });
      if (!live.length) {
        $("msgStream").innerHTML = '<div class="msg-empty"><h3>No comps in this conversation</h3>' +
          '<p>Anything sent here is kept for good.</p></div>';
        return;
      }
      var html = '<div class="msg-note">' + live.length + (live.length === 1 ? " comp has" : " comps have") +
        ' been sent in this conversation.</div>';
      for (var i = 0; i < live.length; i++) html += extCompCard(live[i]);
      $("msgStream").innerHTML = html;
      $("msgStream").scrollTop = 0;
      return;
    }
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
  // A discovery door (slice 8) lands here with ?say=<text>&comp=<id>: the
  // Vault's Firm column, a shelf row, a building sheet or a contact row
  // seeding a conversation. The draft is held until a thread is open and
  // then put in the composer — text into the box, the comp into the tray —
  // and the person still picks who to say it to and still presses Send.
  // Nothing is posted by arriving. The comp goes through the same picker
  // rule as a hand-picked one (it must be in the sender's own vault), so a
  // comp id in a URL buys nothing that the button could not.
  state.draft = null;
  function applyDraft(){
    var d = state.draft;
    if (!d) return;
    state.draft = null;
    if (d.text) $("msgInput").value = d.text;
    if (d.compId && state.canAttach) {
      var seed = function(){
        var comp = (state.vault || []).filter(function(c){ return String(c.id) === d.compId; })[0];
        if (!comp) { $("msgSendMsg").textContent = "That comp isn't in your vault, so it wasn't attached."; return; }
        if (!state.attach.some(function(c){ return c.id === String(comp.id); })) {
          state.attach.push({ id: String(comp.id), address: comp.address });
        }
        renderTray();
      };
      if (state.vault) { seed(); return; }
      api("GET", "/api/vault?limit=1000").then(function(o){
        if (o.s !== 200) return;
        state.vault = (o.j && o.j.comps) || [];
        seed();
      });
    }
  }
  function openThread(id, push, jump){
    state.openKind = "internal";
    state.openId = id;
    state.cursor = "";
    state.messages = [];
    state.extItems = [];
    state.attach = [];
    renderTray();
    applyComposerMode();
    applyDraft();
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
    if (state.openKind !== "internal" || !state.openId) return Promise.resolve();
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
    if (state.openKind === "external") readExternal(false); else readThread(false);
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
        '<p><a class="msg-btn" href="/desk">Go to your workspace</a> <a class="msg-btn" href="/brokers-firms">How firms work</a></p>'); return; }
      if (o.s !== 200) {
        if (!quiet) gate('<h3>Messages are unavailable</h3><p>' + esc((o.j && o.j.error) || "Please try again in a minute.") + '</p>');
        return;
      }
      var j = o.j || {};
      state.me = (j.me && j.me.id) || "";
      state.me2 = String((j.me && j.me.email) || "").toLowerCase();
      state.firm = j.firm || null;
      state.external = j.external || [];
      // Everyone at the firm except the reader. Pending invitees ride along
      // and are marked; the New panel filters them out, because everything
      // that needs a real account filters on userId.
      state.people = (j.people || []).filter(function(p){ return p.userId !== state.me; });
      state.canAttach = j.canAttachComps === true;
      state.threads = j.threads || [];
      // Unread first, then most recent (slice 8): a conversation with
      // something new is the one the reader came for. A boolean per thread —
      // the count is the badge, never the sort key.
      state.threads.sort(function(a, b){
        var ua = a.unread ? 1 : 0, ub = b.unread ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || ""));
      });
      ungate();
      // NO FIRM, AND STILL A PAGE (2026-09-02): a client who was invited into
      // a deal room by email and signed up with that address belongs here,
      // and everything on this column that only makes sense inside a firm
      // goes quiet rather than failing when pressed. New opens firm threads,
      // so it is the first thing to go.
      if (!state.firm) {
        $("msgNewBtn").className = "msg-btn sm msg-hide";
        $("msgFirmLine").textContent = "Deal rooms shared with you";
      } else {
        $("msgNewBtn").className = "msg-btn sm";
        // The firm as a quiet line at the foot of the column, not as the
        // headline. Counts only people who have actually joined, because a
        // pending invitation is not somebody you can talk to.
        var joined = state.people.filter(function(p){ return !p.pending && p.userId; }).length;
        var waiting = state.people.length - joined;
        $("msgFirmLine").textContent = ((state.firm && state.firm.name) || "Your firm") + " · " +
          joined + (joined === 1 ? " colleague" : " colleagues") +
          (waiting ? ", " + waiting + " invited" : "");
      }
      applyComposerMode();
      renderThreads();
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
  function afterSend(){
    $("msgInput").value = "";
    $("msgInput").style.height = "auto";
    state.attach = [];
    renderTray();
    $("msgPicker").className = "msg-panel msg-hide";
    $("msgPickMsg").textContent = "";
    if (state.vault) renderPicker();
    try { $("msgInput").focus(); } catch (e) {}
  }
  // A deal room is written through the hub's own routes — comps as items,
  // words as a note — so what this sends is byte-identical to what the deal
  // room's own page would have sent, and the client's page, their email
  // nudge and the audit trail all fire exactly as they always have.
  function sendExternal(text, ids){
    var id = state.openId;
    var sendItems = ids.length
      ? api("POST", "/api/hub/items", { id: id, items: ids.map(function(ref){ return { source: "vault", ref: ref }; }) })
      : Promise.resolve({ s: 201, j: {} });
    sendItems.then(function(o){
      if (o.s !== 201) {
        state.sending = false;
        $("msgSend").disabled = false;
        $("msgSendMsg").textContent = (o.j && o.j.error) || "Couldn't send those comps.";
        return;
      }
      var sendNote = text.trim()
        ? api("POST", "/api/hub/message", { id: id, body: text })
        : Promise.resolve({ s: 201, j: {} });
      sendNote.then(function(o2){
        state.sending = false;
        $("msgSend").disabled = false;
        if (o2.s !== 201) { $("msgSendMsg").textContent = (o2.j && o2.j.error) || "Couldn't send that."; return; }
        afterSend();
        readExternal(false).then(function(){ refreshList(true); });
      });
    });
  }
  function send(){
    if (state.sending || !state.openId) return;
    var text = $("msgInput").value;
    var ids = state.attach.map(function(c){ return c.id; });
    if (!text.trim() && !ids.length) return;
    state.sending = true;
    $("msgSend").disabled = true;
    $("msgSendMsg").textContent = "";
    if (state.openKind === "external") { sendExternal(text, ids); return; }
    api("POST", "/api/messages/send", { threadId: state.openId, body: text, compIds: ids })
      .then(function(o){
        state.sending = false;
        $("msgSend").disabled = false;
        if (o.s !== 201) { $("msgSendMsg").textContent = (o.j && o.j.error) || "Couldn't send that."; return; }
        // afterSend owns the cleanup — the box, the tray, the picker and its
        // ticks (which once stayed open over the message they had just sent),
        // and the focus. One copy, shared with the deal-room path.
        afterSend();
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
    for (var k = 0; k < state.pickedExt.length; k++) {
      html += '<span class="msg-tag" title="Outside your firm — invited by email">' +
        '<span>' + esc(state.pickedExt[k]) + '</span>' +
        '<button type="button" data-unpick-ext="' + esc(state.pickedExt[k]) + '" aria-label="Remove">×</button></span>';
    }
    $("msgNewChips").innerHTML = html;
    // The button says what this is about to be, since that is the only thing
    // the selection decides: any outside email makes the whole thing an
    // external conversation, because a room holding a client is a client
    // room whoever else is in it.
    var external = state.pickedExt.length > 0;
    $("msgNewAbout").className = external ? "" : "msg-hide";
    $("msgNewGo").textContent = external
      ? "Start external conversation"
      : (state.picked.length === 1
          ? "Message " + pickedName(state.picked[0])
          : (state.picked.length > 1 ? "Start group" : "Start"));
  }
  // The panel's standing line, and the placeholder above it. Both name BOTH
  // jobs the box does, and the second half is stated only for a member who
  // has a vault — POST /api/hubs refuses without one, so promising the door
  // to somebody who cannot walk through it is the Buy-button rule inverted.
  function setNewDoorCopy(){
    var ext = state.canAttach === true;
    $("msgNewSearch").placeholder = ext
      ? "Search colleagues, or type an email address"
      : "Search people";
    $("msgNewDoor").textContent = ext
      ? "Search your firm, or type an email address to invite someone outside it."
      : "";
  }
  // The invite row, always present once a member has a vault. It is the same
  // door the typed-email row opens; this is what tells you the door is there
  // before you have typed anything at all.
  function inviteRowHtml(){
    return '<button type="button" class="msg-invite" id="msgInviteRow">' +
      '+ Invite someone outside your firm by email</button>';
  }
  function renderNewPeople(){
    var people = joinedPeople();
    if (!people.length) {
      // A firm of one still has clients. This used to end at "there is no one
      // to message", which is the wrong sentence for the broker who most
      // wants a deal room.
      $("msgNewPeople").innerHTML = '<div class="msg-hint">Nobody else has joined your firm yet. ' +
        'Invitations to colleagues are managed on your <a href="/desk">workspace</a>.</div>' +
        (state.canAttach ? inviteRowHtml() : "");
      return;
    }
    var q = ($("msgNewSearch").value || "").trim().toLowerCase();
    var list = people.filter(function(p){
      if (!q) return true;
      return (p.name + " " + p.email).toLowerCase().indexOf(q) >= 0;
    });
    // Colleague rows and the invite row are built SEPARATELY, because the
    // "nobody matches that" line is about the colleague half alone. Summed
    // into one string, the always-present invite row would make the search
    // look like it had found something every time.
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var on = state.picked.indexOf(p.userId) >= 0;
      html += '<div class="msg-pick"><label>' +
        '<input type="checkbox" data-person="' + esc(p.userId) + '"' + (on ? " checked" : "") + '>' +
        '<span class="who">' + esc(p.name) + '<span class="sub"> · ' + esc(p.email) + '</span></span>' +
        '</label></div>';
    }
    var door = "";
    // Typed something shaped like an email that is not a colleague? That is
    // the door OUT of the firm: offer to invite them to an external
    // conversation. Only when the member has a vault, because a deal room is
    // a broker surface and the create route refuses without one — a row that
    // can only fail must not render.
    var typed = q.trim();
    var emailish = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(typed);
    var isColleague = joinedPeople().some(function(p){ return p.email === typed; });
    if (emailish && !isColleague && state.canAttach) {
      var on2 = state.pickedExt.indexOf(typed) >= 0;
      door = '<div class="msg-pick"><label>' +
        '<input type="checkbox" data-extpick="' + esc(typed) + '"' + (on2 ? " checked" : "") + '>' +
        '<span class="who">Invite ' + esc(typed) +
        '<span class="sub"> · outside your firm, by email</span></span>' +
        '</label></div>';
    } else if (state.canAttach) {
      // Nothing invitable typed yet, so the row stands in its muted form.
      // One row, two states, ONE input: an invite box of its own would be a
      // second place to type the same thing.
      door = inviteRowHtml();
    }
    if (!html) {
      html = '<div class="msg-hint">Nobody in your firm matches that.' +
        (state.canAttach ? ' A full email address invites somebody outside it.' : '') + '</div>';
    }
    $("msgNewPeople").innerHTML = html + door;
  }
  function openNewPanel(){
    state.picked = [];
    state.pickedExt = [];
    $("msgNewSearch").value = "";
    $("msgNewAbout").value = "";
    $("msgNewMsg").textContent = "";
    $("msgNewPanel").className = "msg-panel";
    setNewDoorCopy();
    renderNewChips();
    renderNewPeople();
    try { $("msgNewSearch").focus(); } catch (e) {}
  }
  function startThread(){
    if (!state.picked.length && !state.pickedExt.length) { $("msgNewMsg").textContent = "Pick somebody to message."; return; }
    $("msgNewGo").disabled = true;
    $("msgNewMsg").textContent = "";
    if (state.pickedExt.length) {
      // ANY outside email makes the whole selection a deal room, colleagues
      // included — they become participants by their email, exactly as if
      // they had been invited from the room itself. The create route mints
      // the tokens and sends the invites; this page only names the people.
      var emails = state.pickedExt.slice();
      for (var i = 0; i < state.picked.length; i++) {
        var pplList = joinedPeople();
        for (var k = 0; k < pplList.length; k++) {
          if (pplList[k].userId === state.picked[i] && emails.indexOf(pplList[k].email) < 0) emails.push(pplList[k].email);
        }
      }
      api("POST", "/api/hubs", { title: ($("msgNewAbout").value || "").trim(), participants: emails })
        .then(function(o){
          $("msgNewGo").disabled = false;
          if (o.s !== 201) { $("msgNewMsg").textContent = (o.j && o.j.error) || "Couldn't start that."; return; }
          $("msgNewPanel").className = "msg-panel msg-hide";
          state.picked = [];
          state.pickedExt = [];
          // The links in this response exist NOWHERE else. Kept so the People
          // panel can show them if the emails did not go.
          state.extLinks = o.j;
          var failed = !o.j.emailed;
          refreshList(true).then(function(){
            openExternal(o.j.id, true, true);
            if (failed) openPeoplePanel();
          });
        });
      return;
    }
    api("POST", "/api/messages/thread", { memberIds: state.picked }).then(function(o){
      $("msgNewGo").disabled = false;
      if (o.s !== 201) { $("msgNewMsg").textContent = (o.j && o.j.error) || "Couldn't start that."; return; }
      $("msgNewPanel").className = "msg-panel msg-hide";
      state.picked = [];
      refreshList(true).then(function(){ openThread(o.j.thread.id, true); });
    });
  }

  // --- wiring -------------------------------------------------------------
  $("msgThreads").addEventListener("click", function(e){
    var ext = e.target.closest("[data-external]");
    if (ext) { openExternal(ext.getAttribute("data-external"), true); return; }
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
    renderThreads();
  });
  $("msgPickFilter").addEventListener("input", renderPicker);
  $("msgAttach").addEventListener("click", openPicker);
  $("msgPickDone").addEventListener("click", function(){ $("msgPicker").className = "msg-panel msg-hide"; });
  $("msgPeopleBtn").addEventListener("click", function(){
    var open = $("msgPeoplePanel").className.indexOf("msg-hide") < 0;
    if (open) { $("msgPeoplePanel").className = "msg-panel msg-hide"; return; }
    openPeoplePanel();
  });
  $("msgPeopleDone").addEventListener("click", function(){ $("msgPeoplePanel").className = "msg-panel msg-hide"; });
  $("msgPeopleGo").addEventListener("click", invitePerson);
  $("msgPeopleAdd").addEventListener("keydown", function(e){
    if (e.key === "Enter") { e.preventDefault(); invitePerson(); }
  });
  $("msgPeopleList").addEventListener("click", function(e){
    var btn = e.target.closest("[data-remove-person]");
    if (!btn) return;
    var email = btn.getAttribute("data-remove-person");
    // Their link stops working the moment this lands — worth a confirm.
    if (!window.confirm("Remove " + email + "? Their link stops working immediately.")) return;
    removePerson(email);
  });
  $("msgCloseHub").addEventListener("click", function(){
    if (!window.confirm("Close this conversation? Everyone keeps reading it, and nobody can post. This cannot be reopened.")) return;
    closeConversation();
  });
  $("msgLinks").addEventListener("click", function(e){
    var b = e.target.closest("button[data-copy-link]");
    if (!b) return;
    var inp = $(b.getAttribute("data-copy-link"));
    if (!inp) return;
    // select() first and as the fallback, the vault panel's own reasoning:
    // clipboard.writeText needs a secure context and a grantable permission,
    // and a broker who cannot copy the link cannot send it at all.
    inp.focus(); inp.select();
    var done = function(){ b.textContent = "Copied"; setTimeout(function(){ b.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value).then(done).catch(function(){
        try { document.execCommand("copy"); done(); } catch (err) {}
      });
    } else {
      try { document.execCommand("copy"); done(); } catch (err) {}
    }
  });
  $("msgSend").addEventListener("click", send);
  $("msgTabChat").addEventListener("click", function(){ setTab("chat"); });
  $("msgTabComps").addEventListener("click", function(){ if (state.openId) setTab("comps"); });
  $("msgBack").addEventListener("click", function(){
    $("msgPage").className = "msg-page";
    state.openId = "";
    state.openKind = "internal";
    renderThreads();
    try { history.replaceState({}, "", "/messages"); } catch (e) {}
  });
  $("msgNewBtn").addEventListener("click", function(){
    var open = $("msgNewPanel").className.indexOf("msg-hide") < 0;
    if (open) { $("msgNewPanel").className = "msg-panel msg-hide"; return; }
    openNewPanel();
  });
  // Typing restores the standing line, so the row's "type their email above"
  // prompt lasts exactly as long as it is still the instruction.
  $("msgNewSearch").addEventListener("input", function(){
    setNewDoorCopy();
    renderNewPeople();
  });
  // The muted invite row does not open anything of its own — it points at the
  // box that is already there and says what to put in it. A second input for
  // the same job is the trap the vault's ONE file input rule names.
  $("msgNewPeople").addEventListener("click", function(e){
    if (!e.target.closest("#msgInviteRow")) return;
    $("msgNewDoor").textContent = "Type their email address above, then tick the row that appears.";
    try { $("msgNewSearch").focus(); } catch (err) {}
  });
  // Selection lives in state, not in the checkboxes: the list is filtered as
  // you type, so a box that leaves the filter would take its tick with it.
  $("msgNewPeople").addEventListener("change", function(e){
    var extBox = e.target.closest("input[data-extpick]");
    if (extBox) {
      var email = extBox.getAttribute("data-extpick");
      var atx = state.pickedExt.indexOf(email);
      if (extBox.checked && atx < 0) state.pickedExt.push(email);
      if (!extBox.checked && atx >= 0) state.pickedExt.splice(atx, 1);
      $("msgNewMsg").textContent = "";
      renderNewChips();
      return;
    }
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
    var ext = e.target.closest("[data-unpick-ext]");
    if (ext) {
      var atx = state.pickedExt.indexOf(ext.getAttribute("data-unpick-ext"));
      if (atx >= 0) state.pickedExt.splice(atx, 1);
      renderNewChips();
      renderNewPeople();
      return;
    }
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
    var wanted = "", wantedX = "";
    try {
      var qp = new URL(location.href).searchParams;
      wanted = qp.get("t") || "";
      wantedX = qp.get("x") || "";
      var say = (qp.get("say") || "").slice(0, 4000), compId = (qp.get("comp") || "").trim();
      if (say || compId) {
        state.draft = { text: say, compId: compId };
        // The seed is consumed on arrival: a reload must not re-seed a
        // message somebody already sent or discarded.
        try { history.replaceState({}, "", wanted ? "/messages?t=" + encodeURIComponent(wanted) : "/messages"); } catch (e) {}
      }
    } catch (e) {}
    refreshList(false).then(function(){
      // The newest conversation is always LOADED, on every width — the two
      // panes are one stylesheet decision and the data costs one request. What
      // the width decides is which pane a phone shows, and only a link that
      // named a conversation (?t= internal, ?x= a deal room) jumps straight
      // into it; arriving bare on a phone leaves the reader on the list.
      if (wantedX) { openExternal(wantedX, true, true); return; }
      if (wanted) { openThread(wanted, true, true); return; }
      // A draft needs somebody to say it to, and the picker only searches a
      // firm. A reader with none keeps the draft and lands on their rooms
      // instead of on a panel that can find nobody.
      if (state.draft && state.firm) {
        // A draft with nobody to say it to yet (a discovery door, slice 8):
        // pick the colleague first. The draft survives into the thread that
        // opens, and the person still presses Send.
        openNewPanel();
        $("msgNewMsg").textContent = "Pick who to tell \u2014 your message is ready to send.";
        return;
      }
      if (state.threads.length) { openThread(state.threads[0].id, false, false); return; }
      // A broker whose only conversations are deal rooms still gets one open
      // rather than an empty pane telling them to select something.
      if (state.external.length) openExternal(state.external[0].id, false, false);
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
      '<p><a class="msg-btn" href="/desk">Go to your workspace</a> <a class="msg-btn" href="/brokers-firms">How firms work</a></p>');
    else gate('<h3>Messages are unavailable</h3><p>' + esc((BOOT.j && BOOT.j.error) || "Please try again in a minute.") + '</p>');
  } else {
    start();
  }
})();
</script>`;
}

module.exports = { renderMessagesBody };
