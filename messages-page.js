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

// The bin on a firm row and in a conversation's header. One copy: the
// stylesheet's markup and the client script's row builder both draw it.
const BIN_SVG = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3.5 5.5h13"/><path d="M8 5.5V4h4v1.5"/><path d="M5.5 5.5l.8 10.5h7.4l.8-10.5"/>' +
  '<path d="M8.5 8.5v5M11.5 8.5v5"/></svg>';

// The More button on every chat and in the open chat's header, and the menu's
// own icons. One copy each, like the bin.
const DOTS_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' +
  '<circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>' +
  '<circle cx="12.5" cy="8" r="1.4" fill="currentColor"/></svg>';
const INFO_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7.25"/><path d="M10 9v5" stroke-linecap="round"/>' +
  '<circle cx="10" cy="6.4" r=".9" fill="currentColor" stroke="none"/></svg>';
const PEN_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 16l.8-3.2L13.3 4.3a1.5 1.5 0 012.1 0l.3.3a1.5 1.5 0 010 2.1l-8.5 8.5L4 16z"/></svg>';
const CHEV_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>';

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

/* --- who a chat is with (2026-10-02, Draft A with Draft C's names) -------- */
/* A deal room says which deal it is, on its own line under the person, and a
   room somebody else started says so. A chat you named shows your name, with
   who it is with underneath. */
.msg-deal{display:flex;align-items:center;gap:6px;min-width:0;margin-top:1px}
.msg-dealname{font-size:12px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.msg-from{flex:0 0 auto;font-size:10.5px;font-weight:600;color:var(--ink-3);border:1px solid var(--edge);
  border-radius:4px;padding:0 5px;line-height:16px;background:var(--card)}
/* Closed deal rooms, folded under one heading at the foot of the list. */
.msg-fold{display:flex;align-items:center;gap:6px;width:100%;padding:12px 14px 10px;border:0;
  border-top:1px solid var(--hair);background:none;font:inherit;font-size:10.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink-faint);font-weight:600;cursor:pointer;text-align:left}
.msg-fold:hover{color:var(--ink-2)}
.msg-fold .msg-count{letter-spacing:0;color:var(--ink-3);background:var(--wash);border-radius:9px;padding:0 6px;line-height:16px}
.msg-fold svg{margin-left:auto;color:var(--ink-3);transition:transform .12s}
.msg-fold[aria-expanded="true"] svg{transform:rotate(90deg)}

/* --- the More button on every chat (was the delete bin, 2026-09-26) ------- */
/* One door per row to one menu (About this chat, Rename, Delete for me), and
   right-clicking the row opens the same menu. The row is a <button>, and a
   button cannot hold another, so the More button is the row's SIBLING inside
   a wrapper and sits over its right edge. On a mouse it appears on hover,
   where the time was; keyboard focus shows it too, so Tab reaches it. A touch
   screen has no hover and no right-click, so there it is always drawn and the
   row keeps room for it. */
.msg-rowwrap{position:relative}
.msg-sect+.msg-rowwrap>.msg-row,.msg-sect+.msg-confirm{border-top:1px solid var(--hair)}
.msg-more{position:absolute;right:10px;top:50%;margin-top:-15px;width:30px;height:30px;
  display:flex;align-items:center;justify-content:center;padding:0;border:1px solid transparent;
  border-radius:6px;background:transparent;color:var(--ink-3);cursor:pointer;
  opacity:0;pointer-events:none}
.msg-more svg,.msg-btn.icon svg{display:block}
.msg-more:hover,.msg-rowwrap.is-menu .msg-more{color:var(--ink);border-color:var(--edge);background:var(--card)}
.msg-rowwrap:hover .msg-more,.msg-row:focus-visible+.msg-more,.msg-more:focus-visible,
.msg-rowwrap.is-menu .msg-more{opacity:1;pointer-events:auto}
.msg-rowwrap.is-menu>.msg-row{background:var(--wash)}
.msg-rowwrap:hover .msg-when,.msg-rowwrap:hover .msg-unread,.msg-rowwrap.is-menu .msg-when,.msg-rowwrap.is-menu .msg-unread,
.msg-rowwrap:has(:focus-visible) .msg-when,.msg-rowwrap:has(:focus-visible) .msg-unread{visibility:hidden}
@media (hover:none){
  .msg-more{opacity:1;pointer-events:auto}
  .msg-rowwrap .msg-row{padding-right:48px}
  .msg-rowwrap:hover .msg-when,.msg-rowwrap:hover .msg-unread{visibility:visible}
}

/* The menu, beside the pointer on a mouse and a sheet from the bottom on a
   phone. Fixed, so it is placed against the window it opened in. */
.msg-menu{position:fixed;z-index:60;width:236px;background:var(--card);border:1px solid var(--edge);
  border-radius:8px;box-shadow:0 14px 34px -12px rgba(15,23,42,.45);padding:5px}
.msg-mhead{padding:6px 10px 8px;font-size:11.5px;line-height:1.4;color:var(--ink-3);
  border-bottom:1px solid var(--hair);margin-bottom:4px;overflow-wrap:anywhere}
.msg-mi{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;background:none;
  border-radius:5px;font:inherit;font-size:13px;color:var(--ink);text-align:left;cursor:pointer}
.msg-mi:hover,.msg-mi:focus-visible{background:var(--wash);outline:none}
.msg-mi svg{flex:0 0 auto;color:var(--ink-3);display:block}
.msg-mi small{margin-left:auto;color:var(--ink-faint);font-size:11px}
.msg-mi.danger,.msg-mi.danger svg{color:var(--red)}
.msg-msep{height:1px;background:var(--hair);margin:4px 2px}
.msg-scrim{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:59}
.msg-menu.is-sheet,.msg-info.is-sheet{left:0!important;right:0;top:auto!important;bottom:0;width:auto;
  border-radius:16px 16px 0 0;padding:8px 14px calc(18px + env(safe-area-inset-bottom,0px));
  box-shadow:0 -10px 30px rgba(0,0,0,.22);max-height:80vh;overflow-y:auto}
.msg-menu.is-sheet:before,.msg-info.is-sheet:before{content:"";display:block;width:38px;height:4px;
  border-radius:2px;background:var(--edge);margin:2px auto 10px}
.msg-menu.is-sheet .msg-mhead{font-size:13px;padding:4px 6px 10px}
.msg-menu.is-sheet .msg-mi{padding:13px 6px;font-size:15px}

/* About this chat: who it is with, how you got here, and the deal. */
.msg-info{position:fixed;z-index:60;width:318px;background:var(--card);border:1px solid var(--edge);
  border-radius:10px;box-shadow:0 18px 40px -14px rgba(15,23,42,.45);padding:16px 16px 14px;
  max-height:min(80vh,560px);overflow-y:auto}
.msg-info-pp{display:flex;gap:12px;align-items:center;min-width:0}
.msg-info-pp+.msg-info-pp{margin-top:10px}
.msg-info-av{flex:0 0 42px;width:42px;height:42px;border-radius:50%;background:var(--slab);color:#fff;
  font-weight:600;font-size:16px;display:flex;align-items:center;justify-content:center;text-transform:uppercase}
.msg-info-pt{min-width:0}
.msg-info-name{font-weight:600;font-size:15px;color:var(--ink)}
.msg-info-mail{font-size:12.5px;color:var(--ink-3);overflow-wrap:anywhere}
.msg-info-state{font-size:11.5px;color:var(--ink-3);margin-top:1px}
.msg-info-state.ok{color:var(--ok-text)}
.msg-info-who{margin:10px 0 0;font-size:12.5px;line-height:1.5;color:var(--ink-2)}
.msg-info-lab{display:block;margin:16px 0 5px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--ink-faint);font-weight:600}
.msg-info-deal{font-size:14px;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.msg-info-meta{font-size:12.5px;color:var(--ink-3);margin-top:1px}
.msg-info-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.msg-btn.danger{color:var(--red)}
/* The rename box, in place of the row or under the header like the delete
   question. */
.msg-rename-in{width:100%;box-sizing:border-box;border:1px solid var(--edge);border-radius:6px;
  padding:7px 10px;font:inherit;font-size:13.5px;background:var(--card);color:var(--ink);margin:6px 0 0}
.msg-btn.icon{display:inline-flex;align-items:center;justify-content:center;padding:4px 6px;color:var(--ink-3)}
.msg-btn.icon:hover{color:var(--red)}
/* The question, asked where it was raised: in place of the row, or under the
   header. Never a browser dialog, which on a phone covers the very thing it
   is asking about. */
.msg-confirm{padding:11px 14px 12px;border-bottom:1px solid var(--hair);background:var(--wash);
  box-shadow:inset 3px 0 0 var(--red)}
.msg-delbar{padding:11px 16px 12px;border-bottom:1px solid var(--line);background:var(--wash)}
.msg-confirm-q{font-size:13.5px;font-weight:600;color:var(--ink)}
.msg-confirm-sub{font-size:12px;color:var(--ink-3);line-height:1.5;margin:2px 0 9px}
.msg-confirm-go{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.msg-confirm-go .msg-hint{color:var(--red)}

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
/* Unsend (2026-09-29, Draft A). Only a message you sent in the last fifteen
   minutes carries the button, so almost every line is untouched. The button
   shows on hover or focus with a mouse and is always drawn under (hover:none),
   the chat bin's rule. The negative margin and matching padding give the
   hover wash room without moving the text. */
.msg-line.can-unsend{position:relative;margin:0 -8px;padding:3px 8px;border-radius:6px}
.msg-line.can-unsend .msg-body{padding-right:74px}
.msg-line.can-unsend:hover,.msg-line.is-asking{background:var(--wash)}
.msg-unsend{position:absolute;right:8px;top:3px;opacity:0;pointer-events:none;font-size:12px;padding:3px 9px}
.msg-line.can-unsend:hover .msg-unsend,.msg-unsend:focus-visible,.msg-line.is-asking .msg-unsend{opacity:1;pointer-events:auto}
@media (hover:none){ .msg-unsend{opacity:1;pointer-events:auto} }
.msg-unsendq{margin:4px 0 10px 44px;max-width:560px;padding:11px 14px 12px;background:var(--wash);
  border:1px solid var(--edge);border-radius:8px}
.msg-unsent{align-self:center;font-size:12px;font-style:italic;color:var(--ink-3);padding:6px 0 4px}

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
/* The area and type row of an external conversation. Two controls, one
   line, sharing the text input's own box so the panel reads as one form. */
.msg-newmeta{display:flex;gap:8px}
.msg-newmeta input[type=text]{flex:1;min-width:0}
.msg-newmeta select{box-sizing:border-box;border:1px solid var(--edge);border-radius:6px;
  background:var(--card);color:var(--ink);font:inherit;font-size:13px;padding:0 8px;max-width:44%}
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
      <!-- The vault's hub form carried these two (2026-09-04, when that form
           came out and this became the only way to start a deal room).
           Optional, like the line above. The area becomes the room's market
           and subject address, the type its property type, and both show on
           the client's page under the title and on My Desk beside it.
           Without them a room started here was thinner than one started
           from the vault, which was the one thing removal would have lost. -->
      <div class="msg-newmeta msg-hide" id="msgNewMeta">
        <input id="msgNewArea" type="text" maxlength="300"
          placeholder="Property or area, like Boise, ID. Optional.">
        <select id="msgNewType" aria-label="Property type">
          <option value="">Type, optional</option>
          <option>Industrial</option><option>Office</option><option>Retail</option>
          <option>Multifamily</option><option>Land</option><option>Residential</option>
        </select>
      </div>
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
      <!-- The open chat's More menu: the same three things as a row's (About
           this chat, Rename, Delete for me), for both kinds of chat since
           2026-10-02. It replaced a delete bin that firm chats alone had. -->
      <button class="msg-btn sm icon msg-hide" id="msgMoreBtn" type="button" aria-haspopup="menu"
        aria-label="More for this conversation" title="More">${DOTS_SVG}</button>
    </div>
    <div class="msg-delbar msg-hide" id="msgDelBar" role="group" aria-label="Delete this conversation"></div>
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
      <h3>Send a comp from your Data</h3>
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

<!-- One menu and one About card for the whole page, placed by the script
     beside whatever opened them (2026-10-02). Outside the grid on purpose: they
     float over both panes. -->
<div class="msg-scrim msg-hide" id="msgScrim"></div>
<div class="msg-menu msg-hide" id="msgMenu" role="menu" aria-label="Conversation"></div>
<div class="msg-info msg-hide" id="msgInfo" role="dialog" aria-label="About this chat"></div>

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
    attach: [], vault: null, poll: null, lastActive: Date.now(), sending: false,
    // Deleting (2026-09-26): which row is asking "Delete this conversation?",
    // which delete is in flight, and what went wrong with the last one.
    confirmId: "", deleting: "", delErr: "",
    // Unsend (2026-09-29): which message is asking "Unsend this message?",
    // which unsend is in flight, its error, and the timer that takes the
    // button away when a message's fifteen minutes run out.
    unsendId: "", unsending: "", unsendErr: "", unsendTimer: null,
    // The open firm conversation as its own read described it, so it stays on
    // the list while it is open even when the list read leaves it out — a
    // conversation you deleted and then reopened has nothing in it yet, and
    // is off the list until somebody writes.
    openRow: null,
    // Every list read is numbered as it is SENT. A read sent before a delete
    // finished can land after it holding the deleted conversation, and would
    // put it straight back on the list; staleBefore is the last number that
    // can have done that, and such an answer is dropped (the next poll is
    // already correct).
    listSeq: 0, staleBefore: 0,
    // Which kind of chat the delete question is about (2026-10-02): a deal
    // room can be deleted for yourself too now, and its id is a different
    // kind of id read by a different route.
    confirmKind: "internal",
    // The More menu and the About card: { kind, id, from } while open, where
    // from is "row" or "head" (which door opened it).
    menu: null, info: null,
    // Renaming: "kind:id" of the chat being renamed, whether the box is under
    // the header (renameBar) or in place of its row, the save in flight, and
    // what went wrong with the last one.
    renameKey: "", renameBar: false, renaming: "", renErr: "",
    // Closed deal rooms are folded under one heading until this is true.
    showClosed: false
  };
  var BIN = ${JSON.stringify(BIN_SVG)};
  var DOTS = ${JSON.stringify(DOTS_SVG)};
  var ICON_INFO = ${JSON.stringify(INFO_SVG)};
  var ICON_PEN = ${JSON.stringify(PEN_SVG)};
  var CHEV = ${JSON.stringify(CHEV_SVG)};

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
    if (String(t.nickname || "").toLowerCase().indexOf(q) >= 0) return true;
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
    closeDelBar();
    state.openKind = "external";
    state.openId = id;
    // A closed room opened from a link is drawn on the list, not folded away.
    var was = findRoom(id);
    if (was && was.closed) state.showClosed = true;
    state.cursor = "";
    state.messages = [];
    state.unsendId = "";
    state.unsendErr = "";
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
    $("msgTitle").textContent = row ? (row.nickname || row.label) : "Conversation";
    $("msgSub").textContent = row ? extSub(row) : "";
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
      ? '<span class="msg-hint">You sent this from your Data</span>'
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
    // Every open chat has the More menu, a deal room included (2026-10-02).
    $("msgMoreBtn").className = state.openId ? "msg-btn sm icon" : "msg-btn sm icon msg-hide";
    if (!mine) $("msgPeoplePanel").className = "msg-panel msg-hide";
    if (closed) { $("msgPicker").className = "msg-panel msg-hide"; }
  }

  // --- what a chat is called, for this reader (2026-10-02) -----------------
  // Their own name for it if they gave it one (only they see it), otherwise
  // who it is with — the people-first rule every row followed before.
  function chatName(t){ return (t && (t.nickname || t.label)) || "Conversation"; }
  // A deal room's second line, shared by its row and the open chat's header:
  // the deal, and — once the reader has named the room — who it is with.
  function dealLine(x){
    var title = String(x.title || "").trim();
    if (title === x.label) title = "";
    if (x.nickname) return x.label + (title ? " \\u00b7 " + title : "");
    return title;
  }
  // The open deal room's subtitle. A room somebody else started says so,
  // which is the whole answer to "is that me?" when two accounts share a name.
  function extSub(x){
    var line = dealLine(x);
    var s = x.owner || x.nickname ? line : x.label + " invited you" + (line ? " \\u00b7 " + line : "");
    return s + (x.closed ? " \\u00b7 closed" : "");
  }
  // The open firm chat's subtitle: a direct message's address, a group's
  // headcount, and who it is with once the reader has named it.
  function threadSub(t){
    var members = (t.members || []).filter(function(m){ return !m.left; });
    var base = t.kind === "channel"
      ? members.length + (members.length === 1 ? " person" : " people")
      : ((members.filter(function(m){ return m.userId !== state.me; })[0] || {}).email || "");
    if (!t.nickname) return base;
    return t.label + (t.kind === "channel" || !base ? "" : " \\u00b7 " + base);
  }
  // The open chat's heading, after its name changed.
  function refreshHeader(){
    var t = state.openKind === "external" ? extRow() : findThread(state.openId);
    if (!t) return;
    $("msgTitle").textContent = chatName(t);
    $("msgSub").textContent = state.openKind === "external" ? extSub(t) : threadSub(t);
  }

  function threadRowHtml(t, attr, current, sub, line, side){
    var chan = t.kind === "channel";
    return '<button class="msg-row' + (t.unread ? " is-unread" : "") + '" type="button"' +
      ' ' + attr + '="' + esc(t.id) + '"' + (current ? ' aria-current="true"' : "") + '>' +
      '<span class="msg-av' + (chan ? " chan" : "") + '">' + esc(chan ? "#" : initial(t.label)) + '</span>' +
      '<span class="msg-rowbody">' +
        '<span class="msg-rowtop">' +
          '<span class="msg-name">' + esc(chatName(t)) + '</span>' +
          '<span class="msg-when">' + esc(when(t.lastMessageAt)) + '</span>' +
        '</span>' +
        (line || side
          ? '<span class="msg-deal"><span class="msg-dealname">' + esc(line || "") + '</span>' +
            (side ? '<span class="msg-from">' + esc(side) + '</span>' : "") + '</span>'
          : "") +
        '<span class="msg-prev">' + esc(sub) + '</span>' +
      '</span>' +
      (t.unread ? '<span class="msg-unread">' + (t.unread > 99 ? "99+" : t.unread) + '</span>' : "") +
      '</button>';
  }
  // Every row is the row itself and its More button, as siblings in a
  // wrapper (a button cannot hold another). The key says which kind of chat
  // it is, because the two kinds are read and written by different routes.
  function rowWrap(kind, t, inner){
    var key = kind + ":" + t.id;
    var open = state.menu && state.menu.from === "row" && state.menu.kind === kind && state.menu.id === t.id;
    return '<div class="msg-rowwrap' + (open ? " is-menu" : "") + '" data-key="' + esc(key) + '">' + inner +
      '<button class="msg-more" type="button" data-more="' + esc(key) + '" aria-haspopup="menu"' +
        ' aria-label="More for ' + esc(chatName(t)) + '" title="More">' + DOTS + '</button>' +
      '</div>';
  }
  // Only when the question came from THIS row. Asked from the header, it
  // lives under the header alone; drawn here too it would be the same
  // question twice on a desktop, where both panes show.
  function askingHere(kind, t){ return state.confirmId === t.id && state.confirmKind === kind && !state.delBar; }
  function renamingHere(kind, t){ return state.renameKey === kind + ":" + t.id && !state.renameBar; }
  // A firm row. Its More button replaced the delete bin (2026-10-02).
  function internalRowHtml(t, current){
    if (askingHere("internal", t)) return confirmHtml(t, "row", "internal");
    if (renamingHere("internal", t)) return renameHtml(t, "row", "internal");
    return rowWrap("internal", t, threadRowHtml(t, "data-thread", current,
      t.preview || "No messages yet", t.nickname ? t.label : "", ""));
  }
  // A deal room. It says which deal it is, and a room somebody else started
  // says "Invited you" (the owner's report, 2026-10-02: two rooms from the
  // same person read as two identical rows).
  function externalRowHtml(x, current){
    if (askingHere("external", x)) return confirmHtml(x, "row", "external");
    if (renamingHere("external", x)) return renameHtml(x, "row", "external");
    return rowWrap("external", x, threadRowHtml(x, "data-external", current,
      x.preview || "No messages yet", dealLine(x), x.owner ? "" : "Invited you"));
  }
  // The one question every door asks. It says whose copy goes, because that
  // is the thing a person pressing Delete on a shared conversation cannot
  // otherwise know: only theirs.
  function confirmHtml(t, where, kind){
    var busy = state.deleting === t.id;
    var name = chatName(t);
    var others;
    if (kind === "external") {
      // A deal room comes back WITH its history (messaging.js, roomListed):
      // it is a shared record of a deal, so nothing in it is cleared.
      var n = (t.people || []).length;
      others = n
        ? esc(t.label) + (n > 1 ? " still have" : " still has") +
          " it, and it comes back, with everything in it, if anyone writes in it again."
        : "It comes back, with everything in it, if anyone writes in it again.";
    } else {
      others = t.kind === "channel"
        ? "Everyone else still has it, and a new message brings it back."
        : esc(t.label) + " still has it, and a new message from them brings it back.";
    }
    return '<div class="' + (where === "row" ? "msg-confirm" : "") + '"' +
        (where === "row" ? ' role="group" aria-label="Delete conversation with ' + esc(name) + '"' : "") + '>' +
      '<div class="msg-confirm-q">Delete this conversation?</div>' +
      '<div class="msg-confirm-sub">It\\'s deleted for you only. ' + others + '</div>' +
      '<div class="msg-confirm-go">' +
        '<button class="msg-btn primary sm" type="button" data-del-yes="' + esc(t.id) + '" data-kind="' + kind + '"' +
          (busy ? " disabled" : "") + '>' + (busy ? "Deleting\\u2026" : "Delete") + '</button>' +
        '<button class="msg-btn sm" type="button" data-del-no="1"' + (busy ? " disabled" : "") + '>Cancel</button>' +
        (state.delErr && state.confirmId === t.id ? '<span class="msg-hint">' + esc(state.delErr) + '</span>' : "") +
      '</div>' +
    '</div>';
  }
  // Renaming, asked where it was raised like the delete question. The name is
  // the reader's alone (migration 059): it never reaches anybody else's list,
  // which is what keeps it clear of the 2026-09-01 rule that chats have no
  // shared names. Empty, or Remove your name, goes back to who it is with.
  function renameHtml(t, where, kind){
    return '<div class="' + (where === "row" ? "msg-confirm" : "") + '" role="group" aria-label="Rename this chat">' +
      '<div class="msg-confirm-q">Rename this chat</div>' +
      '<input class="msg-rename-in" type="text" maxlength="80" autocomplete="off" aria-label="Your name for this chat"' +
        ' value="' + esc(t.nickname || "") + '" placeholder="' + esc(t.label) + '">' +
      '<div class="msg-confirm-sub" style="margin-top:6px">Only you see this name. Nobody else\\'s list changes.</div>' +
      '<div class="msg-confirm-go">' +
        '<button class="msg-btn primary sm" type="button" data-ren-yes="1">Save</button>' +
        '<button class="msg-btn sm" type="button" data-ren-no="1">Cancel</button>' +
        (t.nickname ? '<button class="msg-btn sm" type="button" data-ren-clear="1">Remove your name</button>' : "") +
        '<span class="msg-hint msg-ren-err">' + esc(state.renErr || "") + '</span>' +
      '</div>' +
    '</div>';
  }
  function findThread(id){
    for (var i = 0; i < state.threads.length; i++) if (state.threads[i].id === id) return state.threads[i];
    return state.openRow && state.openRow.id === id ? state.openRow : null;
  }
  function findRoom(id){
    for (var i = 0; i < state.external.length; i++) if (state.external[i].id === id) return state.external[i];
    return null;
  }
  function rowOf(kind, id){ return kind === "external" ? findRoom(id) : findThread(id); }
  // The bar under the open chat's header: the delete question or the rename
  // box, when either was raised from the header's More menu. The question
  // opens where the eye already is, rather than over in the list, which a
  // phone is not showing.
  function renderDelBar(){
    var bar = $("msgDelBar");
    var live = bar.querySelector(".msg-rename-in");
    var typed = live ? live.value : null;
    var html = "";
    if (state.delBar && state.confirmId && state.confirmId === state.openId && state.confirmKind === state.openKind) {
      var t = rowOf(state.openKind, state.openId);
      if (t) html = confirmHtml(t, "bar", state.openKind);
    } else if (state.renameBar && state.renameKey === state.openKind + ":" + state.openId) {
      var r = rowOf(state.openKind, state.openId);
      if (r) html = renameHtml(r, "bar", state.openKind);
    }
    if (!html) { bar.className = "msg-delbar msg-hide"; bar.innerHTML = ""; return; }
    bar.innerHTML = html;
    bar.className = "msg-delbar";
    var again = bar.querySelector(".msg-rename-in");
    if (again && typed !== null) again.value = typed;
  }
  function closeDelBar(){
    if (!state.delBar && !state.renameBar) return;
    if (state.delBar) { state.delBar = false; state.confirmId = ""; state.delErr = ""; }
    if (state.renameBar) { state.renameBar = false; state.renameKey = ""; state.renErr = ""; }
    renderDelBar();
  }
  function askDelete(id, fromBar, kind){
    closeMenu();
    closeInfo();
    state.renameKey = "";
    state.renameBar = false;
    state.renErr = "";
    state.confirmId = id;
    state.confirmKind = kind === "external" ? "external" : "internal";
    state.delBar = !!fromBar;
    state.delErr = "";
    renderThreads();
    renderDelBar();
    var yes = document.querySelector((fromBar ? "#msgDelBar" : "#msgThreads") + ' [data-del-yes]');
    try { if (yes) yes.focus(); } catch (e) {}
  }
  function cancelDelete(){
    var id = state.confirmId, kind = state.confirmKind;
    var fromBar = state.delBar;
    state.confirmId = "";
    state.delBar = false;
    state.delErr = "";
    renderThreads();
    renderDelBar();
    // Focus goes back to the door it came from, so a keyboard user is not
    // dropped at the top of the page.
    var back = id && !fromBar ? document.querySelector('[data-more="' + (kind + ":" + id).replace(/"/g, "") + '"]') : null;
    try { (back || $("msgMoreBtn")).focus(); } catch (e) {}
  }
  function deleteThread(id, kind){
    if (state.deleting) return;
    var room = kind === "external";
    state.deleting = id;
    state.delErr = "";
    renderThreads();
    renderDelBar();
    api("POST", "/api/messages/delete", room ? { roomId: id } : { threadId: id }).then(function(o){
      state.deleting = "";
      if (o.s !== 200) {
        state.delErr = (o.j && o.j.error) || "Couldn't delete that. Please try again.";
        renderThreads();
        renderDelBar();
        return;
      }
      state.confirmId = "";
      state.delBar = false;
      state.staleBefore = state.listSeq;
      if (room) state.external = state.external.filter(function(x){ return x.id !== id; });
      else state.threads = state.threads.filter(function(t){ return t.id !== id; });
      if (state.openKind === (room ? "external" : "internal") && state.openId === id) {
        // The open conversation went, so the pane goes back to empty and a
        // phone goes back to the list, exactly as the Back button does.
        state.openId = "";
        state.openKind = "internal";
        state.openRow = null;
        state.messages = [];
        state.attach = [];
        renderTray();
        $("msgPeoplePanel").className = "msg-panel msg-hide";
        $("msgPage").className = "msg-page";
        $("msgTitle").textContent = "Select a conversation";
        $("msgSub").textContent = "";
        setTab("chat");
        applyComposerMode();
        try { history.replaceState({}, "", "/messages"); } catch (e) {}
      }
      renderThreads();
      renderDelBar();
    });
  }

  // --- the More menu (2026-10-02) ---------------------------------------------
  // One menu for every chat, opened from its row's More button, by
  // right-clicking the row, or from the open chat's header. On a mouse it
  // opens beside whatever opened it; on a touch screen or a phone-width
  // window it is a sheet from the bottom, because a pointer-sized menu is a
  // missed tap there (and a phone has no right-click at all).
  function sheetMode(){
    try { return window.matchMedia("(hover: none), (max-width: 900px)").matches; } catch (e) { return false; }
  }
  function splitKey(key){
    var s = String(key || ""), i = s.indexOf(":");
    return i > 0 ? { kind: s.slice(0, i), id: s.slice(i + 1) } : null;
  }
  function showScrim(){
    $("msgScrim").className = sheetMode() && (state.menu || state.info) ? "msg-scrim" : "msg-scrim msg-hide";
  }
  // Placed against the window: beside a point (a right-click) or under an
  // element (a More button), and pulled back inside the window either way.
  function place(el, at){
    if (sheetMode() || !at) { el.style.left = ""; el.style.top = ""; return; }
    var w = el.offsetWidth, h = el.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var x, y;
    if (at.getBoundingClientRect) {
      var r = at.getBoundingClientRect();
      x = r.right - w;
      y = r.bottom + 4;
      if (y + h > vh - 8) y = r.top - h - 4;
    } else {
      x = at.x;
      y = at.y;
      if (x + w > vw - 8) x = at.x - w;
      if (y + h > vh - 8) y = at.y - h;
    }
    el.style.left = Math.max(8, Math.min(x, vw - w - 8)) + "px";
    el.style.top = Math.max(8, Math.min(y, vh - h - 8)) + "px";
  }
  function openMenu(kind, id, from, at){
    var t = rowOf(kind, id);
    if (!t) return;
    closeInfo();
    state.menu = { kind: kind, id: id, from: from };
    var line = kind === "external" ? dealLine(t) : (t.nickname ? t.label : "");
    var el = $("msgMenu");
    el.innerHTML = '<div class="msg-mhead">' + esc(chatName(t)) + (line ? " \\u00b7 " + esc(line) : "") + '</div>' +
      '<button class="msg-mi" type="button" role="menuitem" data-mi="about">' + ICON_INFO + '<span>About this chat</span></button>' +
      '<button class="msg-mi" type="button" role="menuitem" data-mi="rename">' + ICON_PEN +
        '<span>Rename</span><small>only you see it</small></button>' +
      '<div class="msg-msep" role="separator"></div>' +
      '<button class="msg-mi danger" type="button" role="menuitem" data-mi="delete">' + BIN + '<span>Delete for me</span></button>';
    el.className = "msg-menu" + (sheetMode() ? " is-sheet" : "");
    place(el, at);
    showScrim();
    // Marks the row the menu belongs to; the anchor was measured above, so
    // the re-render cannot move the menu.
    if (from === "row") renderThreads();
    var first = el.querySelector(".msg-mi");
    try { if (first) first.focus(); } catch (e) {}
  }
  function closeMenu(){
    if (!state.menu) return;
    var was = state.menu;
    state.menu = null;
    $("msgMenu").className = "msg-menu msg-hide";
    $("msgMenu").innerHTML = "";
    showScrim();
    if (was.from === "row") renderThreads();
  }
  function rowEl(kind, id){
    return document.querySelector('#msgThreads [data-key="' + (kind + ":" + id).replace(/"/g, "") + '"]');
  }
  function menuPick(what){
    var m = state.menu;
    if (!m) return;
    closeMenu();
    if (what === "about") openInfo(m.kind, m.id, m.from);
    else if (what === "rename") startRename(m.kind, m.id, m.from === "head");
    else if (what === "delete") askDelete(m.id, m.from === "head", m.kind);
  }

  // --- About this chat ----------------------------------------------------------
  // Who it is with (name AND address, so two accounts with one name can be
  // told apart), how the reader got here, and the deal. Everything in it was
  // already on the list row the page holds: nothing is fetched to open it,
  // and opening it marks nothing as read.
  function fmtDay(iso){
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = new Date(t), now = new Date();
    return d.toLocaleDateString([], d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
  }
  function personHtml(p, extra){
    var name = p.name || p.email || "Somebody";
    return '<div class="msg-info-pp"><span class="msg-info-av">' + esc(initial(name)) + '</span>' +
      '<div class="msg-info-pt"><div class="msg-info-name">' + esc(name) + '</div>' +
      (p.email ? '<div class="msg-info-mail">' + esc(p.email) + '</div>' : "") +
      (extra || "") + '</div></div>';
  }
  function infoHtml(kind, t){
    var html = "";
    if (kind === "external") {
      var people = t.people || [];
      for (var i = 0; i < people.length; i++) {
        var p = people[i], extra = "";
        // Whether each guest has opened the room is sent to the owner alone,
        // the same answer the room's own People panel gives.
        if (t.owner) {
          extra = '<div class="msg-info-state' + (p.opened ? " ok" : "") + '">' +
            (p.opened ? "Has opened it" : "Hasn\\'t opened it yet") +
            (p.hasAccount === false ? " \\u00b7 no account yet" : "") + '</div>';
        }
        html += personHtml(p, extra);
      }
      if (!people.length) {
        html += '<p class="msg-info-who" style="margin-top:0">' +
          (t.owner ? "Nobody has been invited yet." : "The person who shared this no longer has an account.") + '</p>';
      }
      var who = t.owner
        ? "You started this" + (t.createdAt ? " on " + fmtDay(t.createdAt) : "") + "."
        : (people[0] ? people[0].name : "Somebody") + " invited you" + (t.invitedAt ? " on " + fmtDay(t.invitedAt) : "") + ".";
      var meta = [t.propertyType, t.market].filter(Boolean).join(" \\u00b7 ");
      html += '<p class="msg-info-who">' + esc(who) + '</p>' +
        '<span class="msg-info-lab">The deal</span>' +
        '<div class="msg-info-deal">' + esc(t.title || "No deal name") + '</div>' +
        '<div class="msg-info-meta">' + esc((meta ? meta + " \\u00b7 " : "") + (t.closed ? "Closed" : "Open")) + '</div>';
    } else {
      var others = (t.members || []).filter(function(m){ return m.userId !== state.me && !m.left; });
      for (var k = 0; k < others.length; k++) html += personHtml(others[k], "");
      if (!others.length) html += '<p class="msg-info-who" style="margin-top:0">Everyone else has left this chat.</p>';
      var firm = (state.firm && state.firm.name) || "your firm";
      html += '<p class="msg-info-who">' + esc((t.kind === "channel" ? "A group chat at " : "A chat at ") + firm +
        (t.createdAt ? ", started " + fmtDay(t.createdAt) : "") + ".") + '</p>';
    }
    if (t.nickname) {
      html += '<span class="msg-info-lab">Your name for it</span>' +
        '<div class="msg-info-deal">' + esc(t.nickname) + '</div>' +
        '<div class="msg-info-meta">Only you see this name.</div>';
    }
    return html + '<div class="msg-info-acts">' +
      '<button class="msg-btn sm" type="button" data-info="rename">Rename</button>' +
      '<button class="msg-btn sm danger" type="button" data-info="delete">Delete for me</button>' +
      '</div>';
  }
  function openInfo(kind, id, from){
    var t = rowOf(kind, id);
    if (!t) return;
    state.info = { kind: kind, id: id, from: from };
    var el = $("msgInfo");
    el.innerHTML = infoHtml(kind, t);
    el.className = "msg-info" + (sheetMode() ? " is-sheet" : "");
    var row = from === "row" ? rowEl(kind, id) : null;
    if (sheetMode()) {
      place(el, null);
    } else if (row) {
      // Beside the row it is about, over the conversation pane.
      var r = row.getBoundingClientRect();
      el.style.left = Math.max(8, Math.min(r.right + 10, window.innerWidth - el.offsetWidth - 8)) + "px";
      el.style.top = Math.max(8, Math.min(r.top - 6, window.innerHeight - el.offsetHeight - 8)) + "px";
    } else {
      place(el, $("msgMoreBtn"));
    }
    showScrim();
    var b = el.querySelector("button");
    try { if (b) b.focus(); } catch (e) {}
  }
  function closeInfo(){
    if (!state.info) return;
    state.info = null;
    $("msgInfo").className = "msg-info msg-hide";
    $("msgInfo").innerHTML = "";
    showScrim();
  }

  // --- renaming -------------------------------------------------------------------
  function renameInput(){
    return document.querySelector((state.renameBar ? "#msgDelBar" : "#msgThreads") + " .msg-rename-in");
  }
  function startRename(kind, id, fromBar){
    closeMenu();
    closeInfo();
    state.confirmId = "";
    state.delBar = false;
    state.delErr = "";
    state.renameKey = kind + ":" + id;
    state.renameBar = !!fromBar;
    state.renErr = "";
    renderThreads();
    renderDelBar();
    var inp = renameInput();
    try { if (inp) { inp.focus(); inp.select(); } } catch (e) {}
  }
  function cancelRename(){
    var k = splitKey(state.renameKey), fromBar = state.renameBar;
    state.renameKey = "";
    state.renameBar = false;
    state.renErr = "";
    renderThreads();
    renderDelBar();
    var back = k && !fromBar ? document.querySelector('[data-more="' + (k.kind + ":" + k.id).replace(/"/g, "") + '"]') : null;
    try { (back || $("msgMoreBtn")).focus(); } catch (e) {}
  }
  function saveRename(clear){
    var k = splitKey(state.renameKey);
    if (!k || state.renaming) return;
    var inp = renameInput();
    var name = clear ? "" : String((inp && inp.value) || "").replace(/\\s+/g, " ").trim();
    var box = inp ? inp.closest('[role="group"]') : null;
    var lock = function(on){
      if (box) box.querySelectorAll("button, input").forEach(function(b){ b.disabled = on; });
    };
    state.renaming = state.renameKey;
    state.renErr = "";
    lock(true);
    var body = { name: name };
    body[k.kind === "external" ? "roomId" : "threadId"] = k.id;
    api("POST", "/api/messages/name", body).then(function(o){
      state.renaming = "";
      if (o.s !== 200) {
        state.renErr = (o.j && o.j.error) || "Couldn't save that name. Please try again.";
        lock(false);
        var hint = box && box.querySelector(".msg-ren-err");
        if (hint) hint.textContent = state.renErr;
        return;
      }
      var saved = o.j && typeof o.j.nickname === "string" ? o.j.nickname : name;
      var t = rowOf(k.kind, k.id);
      if (t) t.nickname = saved;
      if (k.kind === "internal" && state.openRow && state.openRow.id === k.id) state.openRow.nickname = saved;
      state.renameKey = "";
      state.renameBar = false;
      state.renErr = "";
      // A list read sent before this save must not put the old name back.
      state.staleBefore = state.listSeq;
      if (state.openId === k.id && state.openKind === k.kind) refreshHeader();
      renderThreads();
      renderDelBar();
    });
  }
  function externalMatches(t, q){
    if (!q) return true;
    q = q.toLowerCase();
    if (String(t.label || "").toLowerCase().indexOf(q) >= 0) return true;
    if (String(t.nickname || "").toLowerCase().indexOf(q) >= 0) return true;
    if (String(t.title || "").toLowerCase().indexOf(q) >= 0) return true;
    for (var i = 0; i < (t.people || []).length; i++) {
      if (String(t.people[i].email || "").toLowerCase().indexOf(q) >= 0) return true;
    }
    return String(t.preview || "").toLowerCase().indexOf(q) >= 0;
  }
  function renderThreads(){
    var q = ($("msgFilter").value || "").trim();
    var all = state.threads.slice();
    if (state.openKind === "internal" && state.openRow && state.openRow.id === state.openId &&
        !all.some(function(t){ return t.id === state.openId; })) all.unshift(state.openRow);
    var list = all.filter(function(t){ return threadMatches(t, q); });
    var ext = state.external.filter(function(t){ return externalMatches(t, q); });
    if (!all.length && !state.external.length) {
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
    // The Internal / External labels say which side of the wall a row is on,
    // and they exist only once there are two groups to tell apart, judged on
    // what is actually being drawn: a member with no deal rooms sees the list
    // they always saw, and a reader whose only conversations are deal rooms
    // (a client) does not get a lone "External" heading over a firm they are
    // not in.
    var both = list.length > 0 && ext.length > 0;
    if (both) html += '<div class="msg-sect">Internal</div>';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      html += internalRowHtml(t, state.openKind === "internal" && t.id === state.openId);
    }
    if (both) html += '<div class="msg-sect">External</div>';
    // CLOSED deal rooms fold under one heading at the foot of the list
    // (2026-10-02). They used to look exactly like open ones until opened.
    // A search unfolds it, so a match is never hidden behind it.
    var shown = ext.filter(function(x){ return !x.closed; });
    var closed = ext.filter(function(x){ return x.closed; });
    var unfold = state.showClosed || !!q;
    for (var k = 0; k < shown.length; k++) {
      html += externalRowHtml(shown[k], state.openKind === "external" && shown[k].id === state.openId);
    }
    if (closed.length) {
      html += '<button class="msg-fold" type="button" data-fold="1" aria-expanded="' + (unfold ? "true" : "false") + '">' +
        'Closed <span class="msg-count">' + closed.length + '</span>' + CHEV + '</button>';
      for (var c = 0; unfold && c < closed.length; c++) {
        html += externalRowHtml(closed[c], state.openKind === "external" && closed[c].id === state.openId);
      }
    }
    // A rename box in a row keeps what was typed through a re-render (the
    // poll redraws this list every 15 seconds).
    var live = $("msgThreads").querySelector(".msg-rename-in");
    var typed = live ? live.value : null, focused = !!live && document.activeElement === live;
    $("msgThreads").innerHTML = html;
    var again = typed === null ? null : $("msgThreads").querySelector(".msg-rename-in");
    if (again) {
      again.value = typed;
      if (focused) { try { again.focus(); } catch (e) {} }
    }
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
      ? '<span class="msg-hint">You sent this from your Data</span>'
      : (c.savedByMe
          ? '<span class="msg-saved">In your Data</span>'
          : (state.canAttach
              ? '<button class="msg-btn sm" type="button" data-save="' + esc(c.id) + '">Save to my Data</button>'
              : '<span class="msg-hint">Saving comps to Data is part of Pro.</span>'));
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
      // The server resolves this against the users table; the email local part
      // is the fallback it already uses, restated here for a payload written
      // before authorName existed.
      var name = m.mine ? "You" : (m.authorName || String(m.author || "").split("@")[0] || "A colleague");
      // An unsent message is one quiet line where it was, for everybody. The
      // server sends it with no body and no comps. The next message starts a
      // block of its own, so it never reads as a continuation of nothing.
      if (m.unsent) {
        html += '<div class="msg-unsent">' +
          esc(m.mine ? "You unsent a message" : (firstName(name) + " unsent a message")) + '</div>';
        lastWho = "";
        continue;
      }
      // Consecutive messages from one author inside five minutes collapse into
      // one block, the way every messenger does it — a name and a timestamp on
      // every line makes a short back-and-forth unreadable.
      var cont = m.author === lastWho && t - lastAt < 5 * 60 * 1000;
      lastWho = m.author; lastAt = t;
      var comps = "";
      for (var k = 0; k < (m.comps || []).length; k++) comps += compCard(m.comps[k]);
      var canU = canUnsendNow(m);
      var asking = canU && state.unsendId === m.id;
      html += '<div class="msg-line' + (cont ? " cont" : "") + (canU ? " can-unsend" : "") + (asking ? " is-asking" : "") + '">' +
        '<span class="msg-av">' + esc(initial(name)) + '</span>' +
        '<div class="msg-body">' +
          (cont ? "" : '<div class="msg-meta"><span class="msg-author">' + esc(name) + '</span>' +
            '<span class="msg-time">' + esc(when(m.createdAt)) + '</span></div>') +
          (m.body ? '<div class="msg-text">' + esc(m.body) + '</div>' : "") +
          comps +
        '</div>' +
        (canU ? '<button class="msg-btn sm msg-unsend" type="button" data-unsend="' + esc(m.id) + '"' +
          ' title="Unsend (for 15 minutes after you send)">Unsend</button>' : "") +
        '</div>';
      if (asking) html += unsendQuestion(m);
    }
    var el = $("msgStream");
    el.innerHTML = html;
    var q = el.querySelector(".msg-unsendq");
    if (q) { try { q.scrollIntoView({ block: "nearest" }); } catch (e) {} }
    else el.scrollTop = el.scrollHeight;
    scheduleUnsendExpiry();
  }

  // --- unsending a message --------------------------------------------------
  // Your own message, for fifteen minutes, off everybody's screen (Draft A,
  // 2026-09-29). The server decides; unsendUntil is only present while it
  // would say yes, and this page takes the button away when it runs out.
  function firstName(s){ return String(s || "").trim().split(" ")[0] || "Someone"; }
  function canUnsendNow(m){
    if (!m || !m.mine || m.unsent || !m.unsendUntil) return false;
    return (Date.parse(m.unsendUntil) || 0) > Date.now();
  }
  function findMessage(id){
    for (var i = 0; i < state.messages.length; i++) if (state.messages[i].id === id) return state.messages[i];
    return null;
  }
  // Says whose screen it leaves: the one other person in a direct message,
  // everyone in a group.
  function unsendQuestion(m){
    var row = state.openRow, who = "";
    if (row && row.kind === "dm") {
      var other = (row.members || []).filter(function(p){ return p.userId !== state.me; })[0];
      if (other) who = firstName(other.name);
    }
    var busy = state.unsending === m.id;
    return '<div class="msg-unsendq" role="group" aria-label="Unsend this message">' +
      '<div class="msg-confirm-q">Unsend this message?</div>' +
      '<div class="msg-confirm-sub">' +
        (who ? "It comes off " + esc(who) + "\\u2019s screen too" : "It comes off everyone\\u2019s screen") +
        ", and the chat shows that you unsent something. You can unsend for 15 minutes after sending.</div>" +
      '<div class="msg-confirm-go">' +
        '<button class="msg-btn primary sm" type="button" data-unsend-yes="' + esc(m.id) + '"' + (busy ? " disabled" : "") + '>' +
          (busy ? "Unsending\\u2026" : "Unsend") + '</button>' +
        '<button class="msg-btn sm" type="button" data-unsend-no="1"' + (busy ? " disabled" : "") + '>Cancel</button>' +
        (state.unsendErr ? '<span class="msg-hint">' + esc(state.unsendErr) + '</span>' : "") +
      '</div>' +
    '</div>';
  }
  function askUnsend(id){
    state.unsendId = id;
    state.unsendErr = "";
    renderStream();
    var yes = document.querySelector('#msgStream [data-unsend-yes]');
    try { if (yes) yes.focus(); } catch (e) {}
  }
  function cancelUnsend(){
    var id = state.unsendId;
    state.unsendId = "";
    state.unsendErr = "";
    renderStream();
    // Back to the button it came from, so a keyboard user is not dropped at
    // the top of the page.
    var back = id ? document.querySelector('[data-unsend="' + id.replace(/"/g, "") + '"]') : null;
    try { if (back) back.focus(); } catch (e) {}
  }
  function markUnsent(m){
    m.unsent = true;
    m.body = "";
    m.comps = [];
    delete m.unsendUntil;
    if (state.unsendId === m.id) { state.unsendId = ""; state.unsendErr = ""; }
  }
  function doUnsend(id){
    if (state.unsending) return;
    state.unsending = id;
    state.unsendErr = "";
    renderStream();
    api("POST", "/api/messages/unsend", { messageId: id }).then(function(o){
      state.unsending = "";
      if (o.s !== 200) {
        state.unsendErr = (o.j && o.j.error) || "Couldn\\u2019t unsend that. Please try again.";
        renderStream();
        return;
      }
      var m = findMessage(id);
      if (m) markUnsent(m);
      state.unsendId = "";
      renderStream();
      refreshList(true);
    });
  }
  // One timer, for the soonest button to run out. It removes the button in
  // place rather than redrawing the conversation, which would scroll it. A
  // question already open stays: pressing Unsend then gets the server's
  // plain answer.
  function scheduleUnsendExpiry(){
    if (state.unsendTimer) { clearTimeout(state.unsendTimer); state.unsendTimer = null; }
    var soonest = 0;
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      if (!canUnsendNow(m)) continue;
      var at = Date.parse(m.unsendUntil);
      if (!soonest || at < soonest) soonest = at;
    }
    if (!soonest) return;
    state.unsendTimer = setTimeout(function(){
      state.unsendTimer = null;
      var btns = document.querySelectorAll("#msgStream [data-unsend]");
      for (var j = 0; j < btns.length; j++) {
        var mm = findMessage(btns[j].getAttribute("data-unsend"));
        if (canUnsendNow(mm) || (mm && state.unsendId === mm.id)) continue;
        var line = btns[j].parentNode;
        line.className = line.className.replace(" can-unsend", "");
        line.removeChild(btns[j]);
      }
      scheduleUnsendExpiry();
    }, Math.max(0, soonest - Date.now()) + 50);
  }

  // --- the Comps tab ------------------------------------------------------
  function renderComps(rows){
    if (!rows.length) {
      $("msgStream").innerHTML = '<div class="msg-empty"><h3>No comps in this conversation</h3>' +
        '<p>Comps sent here from anyone’s Data are kept for good.</p></div>';
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
        if (!comp) { $("msgSendMsg").textContent = "That comp isn't in your Data, so it wasn't attached."; return; }
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
    if (state.openId !== id) closeDelBar();
    if (!state.openRow || state.openRow.id !== id) state.openRow = null;
    state.openKind = "internal";
    state.openId = id;
    state.cursor = "";
    state.messages = [];
    state.unsendId = "";
    state.unsendErr = "";
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
        if (j.thread && j.thread.id === state.openId) { state.openRow = j.thread; renderThreads(); }
        // The reader's own name for it when they gave it one, with who it is
        // with underneath (2026-10-02).
        $("msgTitle").textContent = j.thread ? chatName(j.thread) : "Conversation";
        $("msgSub").textContent = j.thread ? threadSub(j.thread) : "";
      }
      var fresh = j.messages || [];
      // Messages their author took back since the last read: the poll only
      // brings NEW messages, so without this an open conversation would keep
      // showing one until it was reopened.
      var gone = j.unsent || [], changed = false;
      for (var g = 0; g < gone.length; g++) {
        var was = findMessage(gone[g]);
        if (was && !was.unsent) { markUnsent(was); changed = true; }
      }
      if (fresh.length) {
        // Ids, not positions: an optimistic local echo and the server's own
        // copy of the same message must not both render.
        var have = {};
        for (var i = 0; i < state.messages.length; i++) have[state.messages[i].id] = true;
        for (var k = 0; k < fresh.length; k++) if (!have[fresh[k].id]) state.messages.push(fresh[k]);
        renderStream();
      } else if (first || changed) {
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
    var seq = ++state.listSeq;
    return api("GET", "/api/messages").then(function(o){
      if (seq <= state.staleBefore) return;
      if (o.s === 401) { gate('<h3>Please sign in</h3><p>Messages are part of your firm\\'s account.</p>' +
        '<p><a class="msg-btn" href="/?auth=signin">Sign in</a></p>'); return; }
      if (o.s === 403) { gate('<h3>Messages are for your firm</h3><p>' + esc((o.j && o.j.error) || "") + '</p>' +
        '<p><a class="msg-btn" href="/desk">Go to Home</a> <a class="msg-btn" href="/brokers-firms">How firms work</a></p>'); return; }
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
      $("msgPickList").innerHTML = '<div class="msg-hint">Your Data has no comps yet. ' +
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
    $("msgPickList").innerHTML = '<div class="msg-hint">Loading your Data…</div>';
    api("GET", "/api/vault?limit=1000").then(function(o){
      if (o.s !== 200) {
        $("msgPickList").innerHTML = '<div class="msg-hint">' + esc((o.j && o.j.error) || "Couldn't read your Data.") + '</div>';
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
    $("msgNewMeta").className = external ? "msg-newmeta" : "msg-newmeta msg-hide";
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
    if (!people.length) {
      // A firm of one still has clients. This used to RETURN EARLY with this
      // line and the muted invite row, before the typed-email door above was
      // ever built — so a broker with no colleagues could type a client's
      // address and never be offered the row that starts the room. That was
      // a dead end while the vault's own form existed; on 2026-09-04 that
      // form came out and this became the only way to start a deal room, so
      // the door has to open here too. The sentence stays, as the list's
      // stand-in; the door is decided above, the same way for everyone.
      html = '<div class="msg-hint">Nobody else has joined your firm yet. ' +
        'Invitations to colleagues are managed on <a href="/desk">Home</a>.</div>';
    } else if (!html) {
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
    $("msgNewArea").value = "";
    $("msgNewType").value = "";
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
      api("POST", "/api/hubs", {
        title: ($("msgNewAbout").value || "").trim(),
        // Same field names the vault's form sent, so the create route's
        // marketOf() and property_type handling are untouched.
        subjectAddress: ($("msgNewArea").value || "").trim(),
        propertyType: $("msgNewType").value || "",
        participants: emails,
      })
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
      // Seeded so a conversation reopened after being deleted is on the list
      // from the moment it opens (see openRow).
      state.openRow = o.j.thread;
      refreshList(true).then(function(){ openThread(o.j.thread.id, true); });
    });
  }

  // --- wiring -------------------------------------------------------------
  $("msgThreads").addEventListener("click", function(e){
    // A row's More button opens its menu, and a second press closes it.
    var more = e.target.closest("[data-more]");
    if (more) {
      var mk = splitKey(more.getAttribute("data-more"));
      if (!mk) return;
      if (state.menu && state.menu.from === "row" && state.menu.kind === mk.kind && state.menu.id === mk.id) { closeMenu(); return; }
      openMenu(mk.kind, mk.id, "row", more);
      return;
    }
    if (e.target.closest("[data-fold]")) { state.showClosed = !state.showClosed; renderThreads(); return; }
    var yes = e.target.closest("[data-del-yes]");
    if (yes) { deleteThread(yes.getAttribute("data-del-yes"), yes.getAttribute("data-kind")); return; }
    if (e.target.closest("[data-del-no]")) { cancelDelete(); return; }
    if (e.target.closest("[data-ren-yes]")) { saveRename(false); return; }
    if (e.target.closest("[data-ren-clear]")) { saveRename(true); return; }
    if (e.target.closest("[data-ren-no]")) { if (!state.renaming) cancelRename(); return; }
    // A click anywhere else inside an open question does nothing, rather than
    // falling through to "open this conversation" underneath it.
    if (e.target.closest(".msg-confirm")) return;
    var ext = e.target.closest("[data-external]");
    if (ext) { openExternal(ext.getAttribute("data-external"), true); return; }
    var row = e.target.closest("[data-thread]");
    if (row) openThread(row.getAttribute("data-thread"), true);
  });
  $("msgStream").addEventListener("click", function(e){
    var un = e.target.closest("[data-unsend]");
    if (un) {
      var uid = un.getAttribute("data-unsend");
      if (state.unsendId === uid) cancelUnsend(); else askUnsend(uid);
      return;
    }
    var unYes = e.target.closest("[data-unsend-yes]");
    if (unYes) { doUnsend(unYes.getAttribute("data-unsend-yes")); return; }
    if (e.target.closest("[data-unsend-no]")) { if (!state.unsending) cancelUnsend(); return; }
    var btn = e.target.closest("[data-save]");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    api("POST", "/api/messages/comp/save", { compId: btn.getAttribute("data-save") }).then(function(o){
      if (o.s !== 200) { btn.disabled = false; btn.textContent = "Save to my Data"; note((o.j && o.j.error) || "Couldn't save that comp.", true); return; }
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
  // Right-clicking a chat opens the same menu as its More button (2026-10-02),
  // beside the pointer. A keyboard's menu key reports no pointer position, so
  // the menu then opens from the row's own More button.
  $("msgThreads").addEventListener("contextmenu", function(e){
    var w = e.target.closest("[data-key]");
    var k = w ? splitKey(w.getAttribute("data-key")) : null;
    if (!k) return;
    e.preventDefault();
    openMenu(k.kind, k.id, "row", (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : w.querySelector("[data-more]"));
  });
  // A menu placed against the window would float away from its row.
  $("msgThreads").addEventListener("scroll", function(){ closeMenu(); closeInfo(); });
  // Only on a mouse: a phone resizes the window whenever its address bar
  // hides on scroll, and a sheet is not placed against the window anyway.
  window.addEventListener("resize", function(){ if (!sheetMode()) { closeMenu(); closeInfo(); } });
  $("msgMoreBtn").addEventListener("click", function(){
    if (!state.openId) return;
    if (state.menu && state.menu.from === "head") { closeMenu(); return; }
    openMenu(state.openKind, state.openId, "head", $("msgMoreBtn"));
  });
  $("msgMenu").addEventListener("click", function(e){
    var b = e.target.closest("[data-mi]");
    if (b) menuPick(b.getAttribute("data-mi"));
  });
  // Up and down move between the menu's three choices.
  $("msgMenu").addEventListener("keydown", function(e){
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    var items = [].slice.call($("msgMenu").querySelectorAll(".msg-mi"));
    var i = items.indexOf(document.activeElement);
    var next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    try { if (next) next.focus(); } catch (err) {}
  });
  $("msgInfo").addEventListener("click", function(e){
    var b = e.target.closest("[data-info]");
    if (!b || !state.info) return;
    var i = state.info;
    closeInfo();
    if (b.getAttribute("data-info") === "rename") startRename(i.kind, i.id, i.from === "head");
    else askDelete(i.id, i.from === "head", i.kind);
  });
  $("msgScrim").addEventListener("click", function(){ closeMenu(); closeInfo(); });
  // A press anywhere else closes the menu and the card, the way every menu
  // does. Capture, so it runs before whatever that press then opens.
  document.addEventListener("pointerdown", function(e){
    if (!e.target.closest) return;
    if (state.menu && !e.target.closest("#msgMenu, [data-more], #msgMoreBtn")) closeMenu();
    if (state.info && !e.target.closest("#msgInfo")) closeInfo();
  }, true);
  $("msgDelBar").addEventListener("click", function(e){
    var yes = e.target.closest("[data-del-yes]");
    if (yes) { deleteThread(yes.getAttribute("data-del-yes"), yes.getAttribute("data-kind")); return; }
    if (e.target.closest("[data-del-no]")) { cancelDelete(); return; }
    if (e.target.closest("[data-ren-yes]")) { saveRename(false); return; }
    if (e.target.closest("[data-ren-clear]")) { saveRename(true); return; }
    if (e.target.closest("[data-ren-no]")) { if (!state.renaming) cancelRename(); }
  });
  // Enter in a rename box saves it, wherever the box is.
  ["msgThreads", "msgDelBar"].forEach(function(id){
    $(id).addEventListener("keydown", function(e){
      if (e.key !== "Enter" || !e.target.classList || !e.target.classList.contains("msg-rename-in")) return;
      e.preventDefault();
      saveRename(false);
    });
  });
  // Escape backs out of the question. In the CAPTURE phase and stopped there,
  // because the shared header's own Escape listener (server.js) goes back to
  // the previous page: without this, dismissing the question would also leave
  // Messages altogether.
  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape") return;
    // The menu, the About card and the rename box back out the same way, for
    // the same reason (2026-10-02).
    if (state.menu || state.info) {
      e.preventDefault();
      e.stopPropagation();
      var back = state.menu || state.info;
      closeMenu();
      closeInfo();
      var door = back.from === "head" ? $("msgMoreBtn")
        : document.querySelector('[data-more="' + (back.kind + ":" + back.id).replace(/"/g, "") + '"]');
      try { if (door) door.focus(); } catch (err) {}
      return;
    }
    if (state.renameKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!state.renaming) cancelRename();
      return;
    }
    // The Unsend question backs out the same way, for the same reason.
    if (state.unsendId) {
      e.preventDefault();
      e.stopPropagation();
      if (!state.unsending) cancelUnsend();
      return;
    }
    if (!state.confirmId) return;
    e.preventDefault();
    e.stopPropagation();
    if (!state.deleting) cancelDelete();
  }, true);
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
    closeDelBar();
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
    var wanted = "", wantedX = "", wantedTo = "";
    try {
      var qp = new URL(location.href).searchParams;
      wanted = qp.get("t") || "";
      wantedX = qp.get("x") || "";
      // ?to=<user id> is the profile card's Message door (2026-09-29): it
      // picks that colleague in the new-conversation panel and sends nothing
      // — the person still presses Start, the discovery doors' rule. Consumed
      // on arrival, so a reload does not reopen the panel.
      wantedTo = (qp.get("to") || "").trim();
      if (wantedTo) { try { history.replaceState({}, "", "/messages"); } catch (e) {} }
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
      if (wantedTo && state.firm && joinedPeople().some(function(p){ return p.userId === wantedTo; })) {
        openNewPanel();
        state.picked = [wantedTo];
        renderNewChips();
        renderNewPeople();
        $("msgNewMsg").textContent = "Press Start to message " + pickedName(wantedTo) + ".";
        return;
      }
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
    if (BOOT.s === 401) gate('<h3>Please sign in</h3><p>Messages are part of your firm\\'s account.</p>' +
      '<p><a class="msg-btn" href="/?auth=signin">Sign in</a></p>');
    else if (BOOT.s === 403) gate('<h3>Messages are for your firm</h3>' +
      '<p>' + esc((BOOT.j && BOOT.j.error) || "") + '</p>' +
      '<p><a class="msg-btn" href="/desk">Go to Home</a> <a class="msg-btn" href="/brokers-firms">How firms work</a></p>');
    else gate('<h3>Messages are unavailable</h3><p>' + esc((BOOT.j && BOOT.j.error) || "Please try again in a minute.") + '</p>');
  } else {
    start();
  }
})();
</script>`;
}

module.exports = { renderMessagesBody };
