// ---------------------------------------------------------------------------
// The bulk valuation workspace — the whole /bulk screen, AND the run view that
// index.html shows inline when somebody pastes a list into the main search.
//
// Pure, like vault-page.js: it takes a boot payload and
// returns a string. No I/O, no requires, no clock reads. server.js owns the
// entitlement gate, the job tables and the worker; this file only decides how
// a run is drawn. Keep it that way — a read that happened here would be a read
// outside the gate.
//
// TWO PAGES, ONE SOURCE (2026-08-25). The run view — the totals strip, the
// rows table, the size inputs, the poll — is rendered by renderBulkRunMarkup()
// and driven by BULK_RUN_JS, and BOTH /bulk and index.html get those same
// bytes: /bulk through renderBulkPageBody(), index.html through
// renderBulkInlineBlock() injected at a <!--BULK_RUN--> marker in server.js's
// `/` handler. That is the NAV_LINKS / INAPP_BOOT / AUTH_BOOT pattern, and
// CLAUDE.md's rule about it is the reason: "never a hand-copy, THEME_BOOT
// being the cautionary tale." A second copy of this table would drift, and the
// drift would be two pages quoting different portfolio values for one run.
//
// Three consequences a future editor must keep:
//
//   1. RUN-VIEW IDS ARE PREFIXED `bk`. index.html already owns short generic
//      ids — `gate` is its password overlay — and `rows`/`msg`/`run` are one
//      refactor away from colliding. Because one function renders both pages
//      the prefix cannot drift, but it must not be dropped.
//   2. BULK_RUN_CSS CARRIES ITS OWN FALLBACKS. /bulk is dressed in
//      marketShell() and gets MARKET_CSS's :root vars; index.html never does.
//      So every colour is var(--ink, #1A2433) and not var(--ink). Plain CSS
//      only, never a Tailwind utility: tailwind.css is purged against
//      index.html alone, so a class that exists only in this server-side
//      string would silently stop styling (the APP_NAV_LINK_CLASS trap).
//   3. BULK_RUN_JS READS NO FORM. It used to call refreshCount(), which
//      dereferences $("bulkText") and $("run") unguarded — fine on /bulk,
//      a thrown error on a homepage that has neither. It now reports state
//      through an injected callback (BULKRUN.init({onState})) and each page
//      owns its own button and cap copy.
//
// ONE SCREEN (2026-11-15, the owner's pick of Draft D). The page shows the
// form or a run: the run view marks its own container .bk-open while a run is
// drawn, and /bulk's stylesheet folds the form on that class, so rule 3
// holds. .claude/rules/bulk.md, "One screen", has the rules.
//
// It renders a BODY, not a document: server.js dresses it in marketShell(), so
// the header, footer, theme boot and account chrome are the site's shared ones
// rather than a second copy. That is the /brokers-firms pattern.
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

// The run view's own styles. Scoped to .bk-run and fallback-complete, so this
// block paints correctly on /bulk (where MARKET_CSS supplies the vars) and on
// index.html (where nothing does) — see rule 2 in the header.
const BULK_RUN_CSS = `
/* The run view (2026-11-15, the owner's pick of Draft D, "One screen"):
   one line per address, the run's actions beside its name, the totals in one
   slim band, a three-dot menu for what is used least. Four rules here answer
   site-wide rules that reach this table on /bulk and were never meant for
   it: .sub's 22px bottom margin, the first column's 180px, the table's 640px
   floor (why it slid off a phone) and th's wash. State them here or they
   come back. */
.bk-run .deck{margin:26px 0 0}
.bk-run .deckrule{display:flex;align-items:baseline;gap:6px 14px;flex-wrap:wrap;
  border-bottom:1px solid var(--ink,#1A2433);padding-bottom:9px;margin:0 0 12px}
.bk-run .deckrule h2{font-size:18px;font-weight:600;margin:0;letter-spacing:-.01em;line-height:1.3;
  color:var(--ink,#1A2433)}
.bk-run .msg{font-size:var(--text-small,13px);margin:14px 0 0;color:var(--ink,#1A2433)}
.bk-run .msg:empty{display:none}
.bk-run .msg.bad{color:var(--red-deep,#991B1B)}
.bk-run .notes{margin:12px 0 0;padding:10px 12px;border:1px solid var(--line,#E4E2DA);border-radius:var(--r-md,6px);
  font-size:var(--text-small,13px);color:var(--ink,#1A2433)}
.bk-run .notes ul{margin:6px 0 0;padding-left:18px}
/* The open run is a two-column grid so its actions sit on the heading's line
   while staying after the totals in the markup (both pages share it). */
.bk-run #bkJobDeck{display:grid;grid-template-columns:minmax(0,1fr) auto}
.bk-run #bkJobDeck>*{grid-column:1 / -1;min-width:0}
.bk-run #bkJobDeck>.deckrule{grid-column:1;grid-row:1}
.bk-run #bkJobDeck>.acts{grid-column:2;grid-row:1}
.bk-run .acts{display:flex;align-items:flex-end;justify-content:flex-end;gap:8px;flex-wrap:wrap;
  margin:0 0 12px;padding:0 0 9px 14px;border-bottom:1px solid var(--ink,#1A2433)}
.bk-run .acts #bkCancel{color:var(--err-text,#7F1D1D);border-color:var(--err-rule,#F0C7C7)}
.bk-run button.lnk,.bk-run a.lnk{background:none;border:0;padding:0;font:inherit;font-size:var(--text-small,13px);
  color:var(--red,#B91C1C);cursor:pointer;text-decoration:underline}
.bk-run .sub{color:var(--ink,#1A2433);font-size:var(--text-label,12px);line-height:1.45;margin:2px 0 0;max-width:none}
.bk-run span.sub{margin:0}
/* The totals: one slim band, the range on one line. */
.bk-run .strip{display:flex;flex-wrap:wrap;background:var(--card,#fff);border:1px solid var(--edge,#D8D4C9);
  border-radius:var(--r-md,6px);overflow:hidden;margin:0 0 8px}
.bk-run .strip>div{flex:1 1 auto;padding:8px 16px 9px;border-left:1px solid var(--line,#E4E2DA);margin-left:-1px}
.bk-run .strip .k{font-size:var(--text-tiny,11px);letter-spacing:.08em;text-transform:uppercase;font-weight:600;
  margin-bottom:1px;color:var(--ink,#1A2433)}
.bk-run .strip .v{font-size:var(--text-lead,15px);font-weight:600;letter-spacing:-.02em;line-height:1.35;
  white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--ink,#1A2433)}
.bk-run .strip>div:first-child .v{font-size:var(--text-subhead,20px);line-height:1.2}
/* The tables. */
.bk-run table{width:100%;min-width:0;border-collapse:collapse;font-size:var(--text-small,13px);color:var(--ink,#1A2433)}
.bk-run th{text-align:left;font-size:var(--text-tiny,11px);letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink,#1A2433);font-weight:600;padding:7px 12px;background:none;white-space:nowrap;vertical-align:bottom;
  border-bottom:1px solid var(--ink,#1A2433)}
.bk-run td{padding:9px 12px;border-top:0;border-bottom:1px solid var(--line,#E4E2DA);vertical-align:top;
  line-height:1.45;color:var(--ink,#1A2433)}
.bk-run tbody tr:last-child td{border-bottom:0}
.bk-run td:first-child,.bk-run th:first-child{min-width:0}
.bk-run th.n,.bk-run td.n{text-align:right}
.bk-run td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.bk-run th.c-n,.bk-run td.c-n{width:30px;padding-left:4px;padding-right:0}
.bk-run td.c-a{width:36%}
.bk-run td.c-v,.bk-run .fig{font-weight:600}
.bk-run th.c-s{padding-right:106px}
.bk-run td.c-st,.bk-run td.r-st{white-space:nowrap}
.bk-run td.c-st .sub,.bk-run td.r-st .sub{margin-left:6px}
/* Red is for the button and for what needs you: an address and a run's name
   are the row's title, in ink. */
.bk-run td a{color:var(--ink,#1A2433);font-weight:600;text-decoration:none}
.bk-run td a:hover{text-decoration:underline;text-underline-offset:3px}
.bk-run td a.retry{color:var(--red,#B91C1C);font-weight:500;text-decoration:underline;text-underline-offset:3px;margin-left:8px}
/* Status: one small pill, a dot carrying its colour. A finished row is a
   tick instead, so a table of done rows is not a column of identical pills. */
.bk-run .chip{display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 8px;font-size:var(--text-label,12px);
  font-weight:500;line-height:1.5;text-transform:capitalize;white-space:nowrap;
  border:1px solid var(--line,#E4E2DA);border-radius:99px;color:var(--ink,#1A2433)}
.bk-run .chip::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
.bk-run .chip.run{border-color:var(--warn-rule,#EDDFB0);background:var(--warn-bg,#FBF3DC);color:var(--warn-text,#8A6D1A)}
.bk-run .chip.bad{border-color:var(--err-rule,#F0C7C7);background:var(--err-bg,#FCF1EF);color:var(--err-text,#7F1D1D)}
.bk-run .chip.ok{border-color:var(--ok-rule,#BFE5D2);background:var(--ok-bg,#E7F5EE);color:var(--ok-text,#06603A)}
.bk-run .tick{display:inline-block;width:16px;height:16px;vertical-align:-3px;background:var(--ok-text,#06603A);
  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E") center/contain no-repeat;
  mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E") center/contain no-repeat}
.bk-run .hide{display:none}
.bk-run #bkJobDeck.hide{display:none}
/* The size cell is an input rather than a button-then-field, because a bulk
   run's usual gap IS the size and one click should not stand between a member
   and fixing it. Borderless until hover so a table of them still reads as a
   table; where the figure came from sits beside it in a fixed width, so the
   figures line up. */
.bk-run input.szin{width:76px;padding:1px 4px;margin:-2px 0 0;font:inherit;font-size:var(--text-small,13px);text-align:right;
  color:var(--ink,#1A2433);background:transparent;border:1px solid transparent;border-radius:var(--r-sm,4px);
  font-variant-numeric:tabular-nums}
.bk-run input.szin:hover{border-color:var(--edge,#D8D4C9)}
.bk-run input.szin:focus{border-color:var(--red,#B91C1C);background:var(--paper,#FBFBF9);outline:none}
.bk-run input.szin::placeholder{color:var(--red,#B91C1C);opacity:1;font-weight:600}
.bk-run input.szin[disabled]{color:var(--ink,#1A2433)}
.bk-run td.c-s .src{display:inline-block;width:86px;margin-left:8px;text-align:left;font-size:var(--text-label,12px)}
/* Earlier runs: one line each. */
.bk-run .runs .dt{margin-left:10px}
.bk-run .runs .pn{display:none}
.bk-run .runs td.r-act{width:40px;padding-top:5px;padding-bottom:5px}
.bk-run .pasttg{display:inline-flex;align-items:center;gap:8px;margin:0;padding:0;border:0;background:none;
  font:inherit;color:inherit;letter-spacing:inherit;text-align:left;cursor:default}
.bk-run .pastn,.bk-run .chev{display:none}
/* Under an open run the ledger is one closed line, opened by a click. */
.bk-run .bk-open #bkJobDeck{margin-top:14px}
.bk-run .bk-open #bkPastDeck{margin-top:10px}
.bk-run .bk-open #bkPastDeck .deckrule{display:block;margin:0;padding:0;border:1px solid var(--line,#E4E2DA);
  border-radius:var(--r-md,6px);background:var(--card,#fff)}
.bk-run .bk-open .pasttg{display:flex;width:100%;padding:9px 14px;cursor:pointer;font-size:var(--text-compact,14px)}
.bk-run .bk-open .pastn{display:inline;font-size:var(--text-small,13px);font-weight:400}
.bk-run .bk-open .chev{display:block;margin-left:auto;width:8px;height:8px;border-right:1.5px solid var(--ink,#1A2433);
  border-bottom:1.5px solid var(--ink,#1A2433);transform:rotate(45deg) translate(-2px,-2px)}
.bk-run .bk-open.bk-past-open .chev{transform:rotate(225deg) translate(-2px,-2px)}
.bk-run .bk-open:not(.bk-past-open) #bkPastDeck .pastw{display:none}
.bk-run .bk-open.bk-past-open #bkPastDeck .deckrule{margin-bottom:6px}
/* The three-dot menu: what a run or a row is asked for least. */
.bk-run .mn{position:relative;display:inline-block}
.bk-run .mn-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;
  border:1px solid transparent;border-radius:var(--r-md,6px);background:none;color:var(--ink,#1A2433);cursor:pointer;
  vertical-align:middle}
.bk-run .mn-btn:hover,.bk-run .mn-btn[aria-expanded="true"]{background:var(--wash,#F5F4EF);border-color:var(--edge,#D8D4C9)}
.bk-run .mn-btn:focus-visible{outline:2px solid var(--red,#B91C1C);outline-offset:2px}
.bk-run .acts .mn-btn{width:32px;height:32px;border-color:var(--edge,#D8D4C9);border-radius:var(--r-lg,8px);
  background:var(--card,#fff)}
.bk-run .mn-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:172px;padding:4px;text-align:left;
  white-space:nowrap;background:var(--card,#fff);border:1px solid var(--edge,#D8D4C9);border-radius:var(--r-lg,8px);
  box-shadow:0 2px 6px rgba(15,23,42,.08),0 14px 30px -12px rgba(15,23,42,.38)}
.bk-run .mn-menu.hide{display:none}
.bk-run .mn-menu a{display:block;padding:7px 10px;border-radius:5px;font-size:var(--text-small,13px);font-weight:500;
  color:var(--ink,#1A2433);text-decoration:none}
.bk-run .mn-menu a.hide{display:none}
.bk-run .mn-menu a:hover,.bk-run .mn-menu a:focus-visible{background:var(--wash,#F5F4EF);text-decoration:none;outline:none}
.bk-run .mn-menu a.danger{color:var(--red-deep,#991B1B);border-top:1px solid var(--line,#E4E2DA);border-radius:0 0 5px 5px;
  margin-top:4px;padding-top:9px}
@media (pointer:coarse){
  .bk-run .mn-btn{width:34px;height:34px}
  .bk-run .mn-menu a{padding:10px 12px}
}
/* The time-left bar (2026-11-10). What it is doing on the left, how long is
   left on the right, the bar under both. Full ink like the rest of the run
   view, and no display on .prog itself, so .hide above still hides it. The
   fill moves for a second at a time because drawProgress() sets a new width
   every second; without motion it steps instead. */
.bk-run .prog{margin:0 0 12px;scroll-margin:96px 0}
.bk-run .prog-top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;
  margin:0 0 6px;font-size:var(--text-small,13px);line-height:1.4;color:var(--ink,#1A2433)}
.bk-run .prog-what{font-weight:600}
.bk-run .prog-left{font-variant-numeric:tabular-nums}
.bk-run .prog-track{height:8px;border-radius:99px;background:var(--line,#E4E2DA);overflow:hidden}
.bk-run .prog-fill{height:100%;width:0;border-radius:99px;background:var(--red,#B91C1C);transition:width 1s linear}
@media (prefers-reduced-motion:reduce){.bk-run .prog-fill{transition:none}}
/* A phone gets a card per address, never a table that scrolls sideways. */
@media (max-width:640px){
  .bk-run #bkJobDeck>.deckrule{grid-column:1 / -1;border-bottom:0;padding-bottom:0;margin-bottom:8px}
  .bk-run #bkJobDeck>.acts{grid-column:1 / -1;grid-row:2;justify-content:flex-start;padding:0 0 10px}
  .bk-run .strip>div{flex:1 1 40%;padding:8px 14px;border-top:1px solid var(--line,#E4E2DA);margin-top:-1px}
  .bk-run #bkRows thead,.bk-run .runs thead{display:none}
  .bk-run #bkRows,.bk-run #bkRows tbody,.bk-run .runs,.bk-run .runs tbody{display:block}
  .bk-run #bkRows tr{display:grid;grid-template-columns:22px 1fr 1fr 1fr;column-gap:10px;row-gap:5px;padding:11px 0;
    border-bottom:1px solid var(--line,#E4E2DA)}
  .bk-run #bkRows tr:last-child,.bk-run .runs tr:last-child{border-bottom:0}
  .bk-run #bkRows td{display:block;padding:0;border:0;width:auto;text-align:left;white-space:normal}
  .bk-run #bkRows td.c-n{grid-column:1;grid-row:1}
  .bk-run #bkRows td.c-a{grid-column:2 / 4;grid-row:1;font-size:var(--text-compact,14px)}
  .bk-run #bkRows td.c-st{grid-column:4;grid-row:1;text-align:right}
  .bk-run #bkRows td.c-v{grid-column:2;grid-row:2;font-size:var(--text-lead,15px);white-space:nowrap}
  .bk-run #bkRows td.c-r{grid-column:3 / 5;grid-row:2;align-self:end;white-space:nowrap}
  .bk-run #bkRows td.c-p{grid-column:2;grid-row:3}
  .bk-run #bkRows td.c-s{grid-column:3;grid-row:3}
  .bk-run #bkRows td.c-c{grid-column:4;grid-row:3}
  .bk-run #bkRows td.c-p::before,.bk-run #bkRows td.c-s::before,.bk-run #bkRows td.c-c::before{display:block;
    font-size:var(--text-tiny,11px);letter-spacing:.08em;text-transform:uppercase;font-weight:600;margin-bottom:2px}
  .bk-run #bkRows td.c-p::before{content:"$/SF"}
  .bk-run #bkRows td.c-s::before{content:"Size"}
  .bk-run #bkRows td.c-c::before{content:"Sale comps"}
  .bk-run input.szin{text-align:left;margin-left:-5px}
  .bk-run td.c-s .src{display:block;width:auto;margin:0}
  .bk-run .runs tr{display:grid;grid-template-columns:minmax(0,1fr) auto 34px;column-gap:10px;row-gap:3px;padding:10px 0;
    border-bottom:1px solid var(--line,#E4E2DA)}
  .bk-run .runs td{display:block;padding:0;border:0;width:auto;text-align:left;white-space:normal}
  .bk-run .runs td.r-name{grid-column:1;grid-row:1;font-size:var(--text-compact,14px)}
  .bk-run .runs td.r-val{grid-column:2;grid-row:1;text-align:right}
  .bk-run .runs td.r-type{grid-column:1;grid-row:2}
  .bk-run .runs td.r-n{display:none}
  .bk-run .runs td.r-st{grid-column:2;grid-row:2;text-align:right}
  .bk-run .runs td.r-act{grid-column:3;grid-row:1 / 3;width:auto;padding:0;align-self:center}
  .bk-run .runs .dt{display:block;margin-left:0}
  .bk-run .runs .pn{display:inline}
}
`;

// The /bulk form's own styles — the paste box, the settings row, the gate.
// index.html never receives these: it has its own form.
// The desk (owner's pick, 2026-09-04 evening, from the "ready to run" board of
// the design canvas): the report form's own chamber anatomy, restated here in
// plain CSS because this page never gets index.html's rd-* rules. One bordered
// card — a head row, the address box as the largest text on the form, four
// settings on one hairline row, and an actions footer on the wash with the
// cost said beside the button. Above it, a two-cell reading strip (the vault's
// .strip idiom) says the allowance as figures rather than a footnote.
const BULK_CSS = `
.bulk{max-width:1100px}
/* One screen (2026-11-15): the top of the page takes less room. These two
   reach outside .bulk on purpose and only this page ships them. */
.wrap>.cs-tabs{margin-bottom:14px}
@media (min-width:641px){body main.wrap{padding-top:24px}}
/* The footer starts below the first screen (2026-11-16, the owner: "when you
   first click on a tab the blue footer isn't in the frame"). marketShell's
   body is a flex column that pins the footer to the foot of a short page, so
   on this one-screen page it showed on arrival. */
body>main.wrap{min-height:100vh}
.bulk .lede{color:var(--ink);font-size:var(--text-small);line-height:1.55;margin:0}
.bulk .top>div{display:flex;align-items:baseline;gap:4px 18px;flex-wrap:wrap}
.bulk .top h1{margin:0}
/* The chamber. */
.bulk .desk{margin-top:14px;border:1px solid var(--edge);border-radius:var(--r-md);background:var(--card);
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -18px rgba(15,23,42,.25);display:flex;flex-direction:column}
.bulk .dlab{font-size:var(--text-tiny);letter-spacing:.12em;text-transform:uppercase;color:var(--ink);font-weight:600;line-height:1.5}
.bulk .count{font-size:var(--text-small);font-weight:600;color:var(--ink)}
/* The label's line also carries the ready count and the two links. They
   follow the box in the markup (Tab reaches the box first) and are placed
   on its first row here. */
.bulk .addr{padding:10px 16px;display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;gap:6px 12px}
.bulk .addr label{margin:0;grid-column:1;grid-row:1}
.bulk .addr .count{grid-column:2;grid-row:1}
.bulk .addr .links{grid-column:3;grid-row:1;justify-self:end}
.bulk .addr textarea{grid-column:1 / -1;grid-row:2}
.bulk label{display:block;font-size:var(--text-tiny);letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink);font-weight:600;margin:0 0 2px}
.bulk label .opt{font-weight:400;letter-spacing:0;text-transform:none}
/* Borderless fields: the card's hairlines draw the cells, so a box inside a
   box would be two borders for one input. Scoped to the form, so the run
   view's size box keeps its own outline. */
.bulk .desk textarea,.bulk .desk input[type=text],.bulk .desk input[type=number],.bulk .desk select{width:100%;box-sizing:border-box;padding:2px 0;
  font:inherit;font-size:var(--text-compact);color:var(--ink);background:transparent;border:0;outline:0}
.bulk .desk textarea{min-height:72px;resize:vertical;font-family:var(--mono);
  font-size:var(--text-compact);line-height:1.7;padding:0}
.bulk .links{display:flex;align-items:center;gap:18px;font-size:var(--text-small);flex-wrap:wrap;margin:0}
.bulk .row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--hair)}
.bulk .cell{padding:8px 16px;border-right:1px solid var(--hair)}
.bulk .cell:last-child{border-right:0}
.bulk .cell:focus-within{box-shadow:inset 0 0 0 2px var(--red)}
.bulk .go-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 16px;
  border-top:1px solid var(--hair);background:var(--wash);border-radius:0 0 6px 6px}
/* --red-fill, not --red: the link red lightens on a dark page and white
   words on it were pale pink. */
.bulk button.go{flex:0 0 auto;background:var(--red-fill);color:#fff;border:0;border-radius:var(--r-md);padding:10px 20px;
  font:inherit;font-size:var(--text-compact);font-weight:600;cursor:pointer;box-shadow:0 4px 12px -6px rgba(185,28,28,.55)}
/* Never dimmed (owner's call, 2026-09-04): "no parts of the bulk valuation
   dim". The button is solid red in every state; when it cannot run, the cost
   line beside it says why, and an empty box answers a click with a message
   (see run()) rather than with a control that looks switched off. The same
   call is why every muted colour in this file is full ink. */
.bulk button.go[disabled]{cursor:default}
.bulk .cost{color:var(--ink);font-size:var(--text-small);line-height:1.5;margin:0}
.bulk .foot{margin-top:14px;padding-top:10px;border-top:1px solid var(--line);
  color:var(--ink);font-size:var(--text-label);line-height:1.6}
/* The Tab hint's key cap. Inline in the button so the shortcut is named where
   the action is, rather than in a legend somebody has to go and find. */
.bulk .kbd{display:inline-block;font-family:var(--mono);
  font-size:var(--text-tiny);line-height:1.5;padding:0 5px;margin-left:4px;border:1px solid var(--line);
  border-radius:var(--r-sm);color:var(--ink);text-decoration:none;vertical-align:1px}
/* The folded details (2026-09-04). The summary is a row of the desk like the
   head row above it — label, the derived line, a red Change — and opens onto
   the same .row/.cell cells the visible settings use. */
.bulk details.more{border-top:1px solid var(--hair)}
.bulk details.more summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:14px;
  padding:8px 16px;user-select:none}
.bulk details.more summary::-webkit-details-marker{display:none}
.bulk details.more summary:hover{background:var(--wash)}
.bulk .moreline{flex:1;font-size:var(--text-small);color:var(--ink);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bulk .chg{font-size:var(--text-small);color:var(--red);text-decoration:underline;text-underline-offset:2px}
.bulk details.more[open] .chg{visibility:hidden}
.bulk details.more .row{border-top:1px solid var(--hair)}
.bulk .cell.wide{grid-column:1 / -1}
.bulk .listnote{margin:0;padding:11px 16px;border-top:1px solid var(--hair);font-size:var(--text-small);line-height:1.5;color:var(--ink)}
.bulk .listnote code{font-family:var(--mono);font-size:var(--text-label)}
/* A run on screen folds the form away (2026-11-15): the page shows the form
   or a run, so either fits one screen. .bk-open is the run view's own class,
   on #app while a run is drawn; .bk-form is this page's, set by New report,
   Run again and a handed-over address, and it keeps the form over the run. */
.bulk .bk-open:not(.bk-form) .desk,.bulk .bk-open:not(.bk-form) .lede{display:none}
.bulk .bk-form #bkNew{display:none}
@media (max-width:760px){
  .bulk .row{grid-template-columns:1fr}
  .bulk .cell{border-right:0;border-bottom:1px solid var(--hair)}
  .bulk .cell:last-child{border-bottom:0}
}
@media (max-width:640px){
  .bulk .top>div{display:block}
  .bulk .lede{margin-top:4px}
  .bulk .addr .links{grid-column:1 / -1;grid-row:3;justify-self:start}
}
/* Touch targets (2026-11-15). Under a finger the settings' fields are 36px
   tall (26 before: 2px of padding around one line), and the two links by
   the address box are reached 6px past their line, by an overlay that moves
   nothing: 6px is the gap between them and the address box, and the two
   links stand 18px apart, so no overlay lies over a neighbour. */
@media (pointer:coarse){
  .bulk input[type=text],.bulk input[type=number],.bulk select{padding-top:7px;padding-bottom:7px}
  .bulk .links .lnk{position:relative}
  .bulk .links .lnk::after{content:"";position:absolute;inset:-6px 0}
}
`;

// The three dots of a menu's button. One drawing, in the markup here and in
// the rows BULK_RUN_JS writes.
const MENU_DOTS = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
  '<circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>';

/**
 * The run view's markup — message line, notes, the job deck, and either the
 * "Earlier runs" list (/bulk) or a link to it (index.html).
 *
 * `opts.past` true renders the list; false renders the link. That is the only
 * difference between the two pages, and it lives here rather than in two
 * copies for the reason in this file's header.
 */
function renderBulkRunMarkup(opts) {
  const past = Boolean(opts && opts.past);
  return `<p class="msg" id="bkMsg"></p>
  <div class="notes hide" id="bkNotes"></div>

  <div class="deck hide" id="bkJobDeck">
    <div class="deckrule">
      <h2 id="bkJobTitle">This run</h2>
      <span class="sub" id="bkJobMeta"></span>
    </div>
    <div class="prog hide" id="bkProg">
      <div class="prog-top"><span class="prog-what" id="bkProgWhat"></span><span class="prog-left" id="bkProgLeft"></span></div>
      <div class="prog-track" id="bkProgTrack" role="progressbar" aria-label="How far along this run is"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="prog-fill" id="bkProgBar"></div></div>
    </div>
    <div class="strip" id="bkTotals"></div>
    <p class="acts">
      <button type="button" class="btn sm ghost hide" id="bkNew">New report</button>
      <button type="button" class="btn sm ghost hide" id="bkCancel">Cancel the rest</button>
      <a class="btn sm ghost" id="bkDl" href="#" style="display:none">Download CSV</a>
      <span class="mn"><button type="button" class="mn-btn" aria-haspopup="true" aria-expanded="false" aria-label="More for this run">${MENU_DOTS}</button><span class="mn-menu hide">
      <a class="hide" id="bkAddAll" href="#">Add valued rows to portfolio</a>
      <a class="lnk" href="/desk">Go to Home</a>${past ? "" : `
      <a class="lnk" href="/bulk">Earlier runs &rarr;</a>`}</span></span>
    </p>
    <div style="overflow-x:auto"><table id="bkRows"></table></div>
  </div>${past ? `

  <div class="deck hide" id="bkPastDeck">
    <div class="deckrule"><h2><button type="button" class="pasttg" id="bkPastTg" aria-expanded="true">Earlier runs
      <span class="pastn" id="bkPastN"></span><span class="chev" aria-hidden="true"></span></button></h2></div>
    <div class="pastw"><table class="runs"><thead><tr><th>Run</th><th>Type &middot; lookback</th>
      <th class="n">Addresses</th><th class="n">Portfolio value</th><th>Status</th><th class="n"></th></tr></thead>
      <tbody id="bkPast"></tbody></table></div>
  </div>` : ""}`;
}

/**
 * The block index.html receives at its <!--BULK_RUN--> marker.
 *
 * Self-contained — markup, CSS and JS in one string — because index.html gets
 * no MARKET_CSS and no bulk script of its own. Ships `hidden`: the entitlement
 * is enforced by /api/bulk server-side, so what is injected here is
 * presentation only and costs an anonymous visitor nothing but bytes.
 */
function renderBulkInlineBlock() {
  return `<style>${BULK_RUN_CSS}</style>
<div id="bkInline" class="bk-run" hidden>
  ${renderBulkRunMarkup({ past: false })}
</div>
<script>${BULK_RUN_JS.replace(/<\/script>/gi, "<\\/script>")}</script>`;
}

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
  return `<style>${BULK_RUN_CSS}${BULK_CSS}</style>
<div class="bulk bk-run">
  <div class="deck" id="gate" hidden>
    <div class="deckrule"><h2>Comp report</h2></div>
    <p class="lede" id="gateMsg"></p>
    <p id="gateAct"></p>
  </div>

  <div id="app" hidden>
    <!-- The desk (owner's pick from the design canvas, 2026-09-04 evening).
         Headed "Run a report" because that is the door every bar and the
         workspace header call this page by; the rail row keeps "Bulk
         valuation", the tool's name. One address or a list, the same box:
         this page is the comp-report tool, and the single-property form's
         Tools row is gone. A single address runs exactly as a row of one and
         then OPENS its comp report — see singleJob in BULK_JS — because a
         one-row table is a summary of a report nobody has read. -->
    <div class="top">
      <div>
        <h1>Run a report</h1>
        <!-- The one-line lede under the heading came off on 2026-11-23
             (owner's call). -->
      </div>
      <!-- The LEFT TODAY / PER RUN strip that sat here came off on 2026-10-09
           (owner's call): the limits still hold, and the cost line under the
           box still says so the moment a list runs past what is left. -->
    </div>

    <div class="desk">
      <!-- One screen (2026-11-15, the owner's pick of Draft D): no head row;
           the ready count and the two links share the label's line (placed
           there by the stylesheet; in the markup they follow the box, so Tab
           reaches the box first), and the box starts three lines tall and
           grows with a list (refreshCount). -->
      <div class="addr">
        <label for="bulkText">Address, or one per line</label>
        <span class="count" id="count"></span>
        <textarea id="bulkText" spellcheck="false" placeholder="1201 W Idaho St, Boise, ID 83702
4610 E Fairview Ave, Meridian, ID 83642
900 N Cole Rd, Boise, ID"></textarea>
        <p class="links">
          <input type="file" id="bulkFile" accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hide"/>
          <button type="button" class="lnk" id="pickFile">Upload a CSV, text or Excel file</button>
          <!-- A real button, not only a keyboard shortcut. Tab is the shortcut
               for somebody whose hands are already in the box; this is how it is
               DISCOVERED, and how anyone who cannot or would rather not press
               Tab reaches the same thing. Hidden the moment the box has content
               (refreshCount owns that), because the offer only applies to an
               empty one. -->
          <button type="button" class="lnk" id="useExample">Try it with example addresses <span class="kbd">Tab</span></button>
        </p>
      </div>

      <div class="row">
        <div class="cell">
          <label for="bulkType">Property type</label>
          <select id="bulkType"></select>
        </div>
        <div class="cell">
          <label for="bulkMonths">Lookback</label>
          <select id="bulkMonths">
            <option value="12">12 months</option>
            <option value="24" selected>24 months</option>
            <option value="36">36 months</option>
            <option value="60">60 months</option>
            <option value="120">120 months</option>
          </select>
        </div>
        <div class="cell">
          <label for="bulkFocus">Focus</label>
          <select id="bulkFocus">
            <option value="both" selected>Sales &amp; leases</option>
            <option value="sales">Sales only</option>
            <option value="leases">Leases only</option>
          </select>
        </div>
        <div class="cell">
          <label for="bulkNote">Market note <span class="opt">(optional)</span></label>
          <input type="text" id="bulkNote" maxlength="200" placeholder="e.g. within 2.5 miles"/>
        </div>
      </div>

      <!-- The single form's other inputs (2026-09-04, owner's: "all of the
           input options"), folded the way the form folds them — behind one
           line that STATES the current values, so a reader who never opens it
           still learns the size is looked up. #moreLine is derived by
           refreshMore(), never written once (the form's own rule for its
           settings line). The per-property fields describe ONE property, so
           they show for a one-address run; a list is told which upload
           columns carry the same facts per row, and the fields fold away. -->
      <details class="more" id="bulkMore">
        <summary>
          <span class="dlab">Details for comps</span>
          <span class="moreline" id="moreLine"></span>
          <span class="chg">Change</span>
        </summary>
        <div id="perAddress">
          <div class="row">
            <div class="cell">
              <label for="bulkSize">Property SF</label>
              <input type="number" id="bulkSize" min="0" step="any" placeholder="from public records"/>
            </div>
            <div class="cell">
              <label for="bulkAsking">Asking price <span class="opt">(optional)</span></label>
              <input type="number" id="bulkAsking" min="0" step="any" placeholder="e.g. 3125000"/>
            </div>
            <div class="cell">
              <label for="bulkNoi">NOI <span class="opt">(optional)</span></label>
              <input type="number" id="bulkNoi" min="0" step="any" placeholder="e.g. 210000"/>
            </div>
            <div class="cell">
              <label for="bulkCap">Cap rate % <span class="opt">(optional)</span></label>
              <input type="number" id="bulkCap" min="0" step="0.01" placeholder="e.g. 6.25"/>
            </div>
          </div>
          <!-- The type's own fields, rendered by renderSubjectFields() from
               BULK_SUBJECT_FIELDS whenever the type changes. -->
          <div class="row" id="bulkSubjectFields"></div>
        </div>
        <p class="listnote" id="listNote" hidden></p>
        <div class="row">
          <div class="cell wide">
            <label for="bulkLabel">Name this run <span class="opt">(optional)</span></label>
            <input type="text" id="bulkLabel" maxlength="120" placeholder="e.g. Q3 portfolio review"/>
          </div>
        </div>
      </details>

      <!-- The cost said beside the button, BEFORE the click. -->
      <div class="go-row">
        <p class="cost" id="cost">Each address is its own billed search; nothing runs until you press the button.</p>
        <button type="button" class="go" id="run">Run valuations</button>
      </div>
    </div>

    ${renderBulkRunMarkup({ past: true })}

    <!-- One sentence since 2026-11-15 (the owner's pick of Draft D). It must
         keep saying what a figure is: an automated estimate, never an
         appraisal. -->
    <p class="foot">Every figure is an automated estimate from comparable sales and, where there is one, the building's own recent sale, not an appraisal.
      Open a row to see its comps and how the range was reached.</p>
  </div>
</div>
<script>${BULK_RUN_JS.replace(/<\/script>/gi, "<\\/script>")}
${BULK_JS.replace(/<\/script>/gi, "<\\/script>")}
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
// the page actually emits; this file has one too — and since 2026-08-25 a
// second test compiles what index.html emits, because BULK_RUN_JS ships there
// as well.
// ---------------------------------------------------------------------------

// BULKRUN — the run view, and nothing else. Shared by /bulk and index.html.
//
// It reads NO form: everything it draws comes from GET /api/bulk?id=, and it
// reports back through the onState/onList callbacks a page registers with
// init(). That is what lets the homepage — which has no #bulkText and no #run
// — mount the same table without throwing.
const BULK_RUN_JS = `
var BULKRUN=(function(){
"use strict";
var $=function(i){return document.getElementById(i);};
var MAX=50,job=null,items=[],timer=null,allJobs=[],summary=null;
var onState=null,onList=null,onRunAgain=null;
// One screen (2026-11-15). openFor is the run on screen and pastOpen whether
// the ledger under it has been opened; wired says the view's own controls
// are bound; pastStale that the ledger was not redrawn under an open menu.
var openFor=null,pastOpen=false,wired=false,pastStale=false;
var DOTS='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">'+
  '<circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>';
var MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// The time-left bar's state (2026-11-10). prog is the server's last answer
// ({elapsed_ms,left_ms,late}, or null when it could not say) and progAt when
// it arrived; the rest is the bar's own bookkeeping.
var prog=null,progAt=0,progTick=null,progShown=0,progFor=null,progHide=null;

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function money(v){if(!(Number(v)>0))return "\\u2014";
  return "$"+Math.round(Number(v)).toLocaleString("en-US");}
function psf(v){if(!(Number(v)>0))return "\\u2014";
  return "$"+Number(v).toFixed(0);}

function msg(text,bad){
  var el=$("bkMsg");if(!el)return;
  el.textContent=text||"";el.className=bad?"msg bad":"msg";
}

// The count in the button is the count the SERVER will accept, so nobody is
// told "42 addresses" and then handed 40 rows.
//
// It reads the list the way bulk.js parseAddressList does, restated here
// because this runs in the browser. Until 2026-11-10 it guessed instead: a
// heading was a first line holding the word "address" and a comma, and the
// address was whatever came before a line's first comma. So a file headed
// Name,Address,SF counted 0 and the button answered "paste an address first"
// over a list the server reads perfectly well, and one street in two cities
// counted once.
//
// ⚠ MIRROR of bulk.js: LIST_HEADERS is its ADDRESS_HEADERS, CITY_HEADERS
// and STATE_HEADERS, and listAddresses is parseAddressList down to the
// address. test/bulk-inline.test.js compares the lists and runs both readers
// over the same text. Change them together.
var LIST_HEADERS={
  address:["address","property_address","site_address","street_address","property","location"],
  city:["city","town"],
  state:["state","st"]
};
// broker-vault.js normalizeHeader.
function normHeader(h){
  return String(h==null?"":h).trim().toLowerCase()
    .replace(/[\\s\\-]+/g,"_").replace(/[^a-z0-9_]/g,"")
    .replace(/_+/g,"_").replace(/^_+|_+$/g,"");
}
// broker-vault.js parseCsv: quoted cells, doubled quotes, a BOM, CRLF, blank
// rows dropped, and each row stamped with the line of the file it began on.
function csvGrid(text,delim){
  var src=String(text==null?"":text),rows=[],row=[],cell="",quoted=false,i=0,fileLine=1,rowLine=1;
  if(src.charCodeAt(0)===0xfeff)i=1;
  function endRow(){row.push(cell);cell="";row.line=rowLine;rows.push(row);row=[];}
  while(i<src.length){
    var c=src.charAt(i);
    if(quoted){
      if(c==='"'){
        if(src.charAt(i+1)==='"'){cell+='"';i+=2;continue;}
        quoted=false;i++;continue;
      }
      if(c==="\\n")fileLine++;
      cell+=c;i++;continue;
    }
    if(c==='"'&&cell===""){quoted=true;i++;continue;}
    if(c===delim){row.push(cell);cell="";i++;continue;}
    if(c==="\\r"){i++;continue;}
    if(c==="\\n"){endRow();fileLine++;rowLine=fileLine;i++;continue;}
    cell+=c;i++;
  }
  if(cell!==""||row.length)endRow();
  return rows.filter(function(r){return r.some(function(x){return String(x).trim()!=="";});});
}
// broker-vault.js delimiterOf: cells copied out of Excel are tab-separated.
function listDelim(text){
  var lines=String(text==null?"":text).replace(/^\\ufeff/,"").split(/\\r?\\n/),first="";
  for(var i=0;i<lines.length;i++){if(lines[i].trim()!==""){first=lines[i];break;}}
  var tabs=first.split("\\t").length-1,commas=first.split(",").length-1;
  return tabs>0&&tabs>=commas?"\\t":",";
}
// bulk.js withCityState over broker-vault.js composeAddress: a sheet's own
// City and State columns joined onto the street, only where missing.
function tidy(v,max){return String(v==null?"":v).trim().replace(/\\s+/g," ").slice(0,max);}
function joinParts(street,city,state){
  var parts=[tidy(street,200)];
  [city,state].forEach(function(raw){
    var v=tidy(raw,60);if(!v)return;
    var hay=","+parts.join(", ").toLowerCase().replace(/\\s*,\\s*/g,",")+",";
    if(hay.indexOf(","+v.toLowerCase().replace(/\\s*,\\s*/g,",")+",")<0)parts.push(v);
  });
  return parts.filter(function(p){return p;}).join(", ");
}
function withCityState(address,city,state){
  var street=address.replace(/\\s+\\d{5}(?:-\\d{4})?\\s*$/,"");
  var base=joinParts(street,"",""),joined=joinParts(street,city,state);
  return joined===base?address:address+joined.slice(base.length);
}
// Every address the server will read out of a list, in the file's order,
// before it drops the ones that are not addresses and the repeats.
function listAddresses(text){
  var src=String(text==null?"":text),tab=listDelim(src)==="\\t";
  var grid=csvGrid(src,tab?"\\t":",");
  var heads=(grid[0]||[]).map(normHeader);
  var col=function(names){
    for(var i=0;i<heads.length;i++){if(names.indexOf(heads[i])>=0)return i;}
    return -1;
  };
  var a=col(LIST_HEADERS.address),headed=a>=0&&grid.length>1;
  // One heading and nothing else is one column copied with its heading: the
  // lines under it are whole addresses, read like any paste.
  var lone=headed&&heads.filter(function(h){return h;}).length===1;
  var out=[];
  var take=function(v){
    var addr=String(v||"").trim();
    if(addr&&addr.charAt(0)!=="#")out.push(addr);
  };
  if(headed&&!lone){
    var ci=col(LIST_HEADERS.city),si=col(LIST_HEADERS.state);
    grid.slice(1).forEach(function(cells){
      var addr=String(cells[a]||"").trim();
      if(!addr||addr.charAt(0)==="#")return;
      if(ci>=0||si>=0)addr=withCityState(addr,ci>=0?cells[ci]:"",si>=0?cells[si]:"");
      out.push(addr);
    });
    return out;
  }
  var headLine=lone?(grid[0].line||1):0;
  src.split(/\\r\\n|\\r|\\n/).forEach(function(raw,i){
    if(i+1===headLine)return;
    if(!lone)return take(raw);
    var cell=tab?raw.split("\\t")[0]:raw;
    if(/^\\s*"/.test(cell)){var row=csvGrid(cell,",")[0];if(row&&row.length)cell=row[0];}
    take(cell);
  });
  return out;
}
// bulk.js looksLikeAddress; the key in countLines is its dedupeKey.
function looksLikeAddress(s){return s.length>=6&&/\\d/.test(s);}

// Shared with index.html's paste detector on purpose: two copies of this
// would let the homepage and /bulk disagree about what a list is.
function countLines(text){
  var seen={},n=0;
  listAddresses(text).forEach(function(addr){
    if(!looksLikeAddress(addr))return;
    var k=addr.toLowerCase().replace(/[^a-z0-9]+/g,"");
    if(seen[k])return;
    seen[k]=1;n++;
  });
  return n;
}

// The first address a paste holds, for the branch that cannot run a list and
// falls back to a single search rather than throwing the paste away.
function firstAddress(text){
  var list=listAddresses(text);
  for(var i=0;i<list.length;i++){if(looksLikeAddress(list[i]))return list[i];}
  return "";
}

// A row's status. A finished row is a tick, so a table of done rows is not a
// column of identical pills; anything else keeps its word.
function rowStatus(s){
  return s==="done"?'<span class="tick" role="img" aria-label="Done" title="Done"></span>':statusChip(s);
}

// "Nov 12" from a stored timestamp, with the year only when it is not this
// one. Read off the string, so the day is the one the server wrote.
function dayWords(iso){
  var m=/^(\\d{4})-(\\d\\d)-(\\d\\d)/.exec(String(iso||""));
  if(!m)return "";
  return MONTHS[Number(m[2])-1]+" "+Number(m[3])+(Number(m[1])!==new Date().getFullYear()?", "+m[1]:"");
}

// A three-dot menu: the button, and the items it opens. The click that opens
// and closes every one of them is bound once, on the document (wire()).
function menu(label,items){
  return '<span class="mn"><button type="button" class="mn-btn" aria-haspopup="true" aria-expanded="false" aria-label="'+
    esc(label)+'">'+DOTS+'</button><span class="mn-menu hide">'+items+"</span></span>";
}
function closeMenus(){
  Array.prototype.forEach.call(document.querySelectorAll('.bk-run .mn-btn[aria-expanded="true"]'),function(b){
    b.setAttribute("aria-expanded","false");
    if(b.nextElementSibling)b.nextElementSibling.className="mn-menu hide";
  });
  if(pastStale){pastStale=false;renderPast();}
}

// The view's own controls, bound once. From init() and from the first draw:
// index.html mounts this view without ever calling init(), and until
// 2026-11-15 its Cancel and Add to portfolio were therefore bound to nothing.
function wire(){
  if(wired)return;
  wired=true;
  var aa=$("bkAddAll");
  if(aa)aa.addEventListener("click",function(e){e.preventDefault();addAllToPortfolio();});
  var c=$("bkCancel");
  if(c)c.addEventListener("click",function(){
    if(!job)return;
    // Says what a cancel actually does. Searches already in flight are billed
    // the moment they start, so promising to stop them would be a lie.
    if(!confirm("Stop the addresses that have not started yet? Searches already running will finish."))return;
    api("POST","/api/bulk/cancel",{id:job.id}).then(function(){poll(job.id,true);}).catch(function(){});
  });
  // Under an open run the ledger is one closed line; its heading opens it.
  var tg=$("bkPastTg");
  if(tg)tg.addEventListener("click",function(){if(!job)return;pastOpen=!pastOpen;syncOpen();});
  if(!document.addEventListener)return;
  document.addEventListener("click",function(e){
    var t=e.target,btn=t&&t.closest?t.closest(".mn-btn"):null;
    if(btn&&btn.closest(".bk-run")){
      var was=btn.getAttribute("aria-expanded")==="true";
      closeMenus();
      if(!was){btn.setAttribute("aria-expanded","true");if(btn.nextElementSibling)btn.nextElementSibling.className="mn-menu";}
      return;
    }
    closeMenus();
  });
  // Escape closes an open menu and says it used the key: the site's header
  // sends an unclaimed Escape back a page. Capturing, because that listener
  // is on the document too and was bound first.
  document.addEventListener("keydown",function(e){
    if(e.key!=="Escape")return;
    if(!document.querySelectorAll('.bk-run .mn-btn[aria-expanded="true"]').length)return;
    e.preventDefault();
    closeMenus();
  },true);
}

// Says, on the view's own container, whether a run is on screen (.bk-open)
// and whether the ledger under it has been opened (.bk-past-open). /bulk
// folds its form on the first; this module still knows no form exists.
function syncOpen(){
  var deck=$("bkJobDeck"),root=deck&&deck.parentNode,id=job?job.id:null;
  if(id!==openFor){openFor=id;pastOpen=false;}
  if(root&&root.classList){
    root.classList.toggle("bk-open",Boolean(job));
    root.classList.toggle("bk-past-open",Boolean(job)&&pastOpen);
  }
  var tg=$("bkPastTg");
  if(tg&&tg.setAttribute)tg.setAttribute("aria-expanded",String(!job||pastOpen));
}

function statusChip(s){
  var cls=s==="running"?"chip run":(s==="failed"||s==="interrupted"||s==="cancelled")?"chip bad":s==="done"?"chip ok":"chip";
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
  $("bkTotals").innerHTML=cells.map(function(c){
    return '<div><div class="k">'+esc(c[0])+'</div><div class="v">'+c[1]+"</div></div>";}).join("");
}

function rowHtml(it,i){
  // One line per address (2026-11-15): the range has a column of its own.
  var valued=it.status==="done"&&Number(it.value_likely)>0;
  var val=valued?money(it.value_likely):"\\u2014";
  var rng=valued?money(it.value_low)+" \\u2013 "+money(it.value_high):"\\u2014";
  var note=it.error?'<div class="sub">'+esc(it.error)+"</div>":"";
  // A FAILED row can be retried alone (2026-09-04): one new search for that
  // address, into the same row, once the run has stopped. Not offered on a
  // done-but-unvalued row — that answer came from the same search parameters
  // and would come back from cache; its fix is a longer lookback, a new run.
  var retry=(it.status==="failed"&&job&&job.status!=="running")
    ? '<a href="#" class="retry" data-retry="'+esc(it.id)+'">Retry</a>':"";
  // The address opens the stored report when there is one: the row is a
  // summary, and the evidence for it — the comps, the weighting, the trust
  // line — lives in the report itself. ?recent= and ?property= are both
  // index.html's own doors and both reads are user-scoped, so neither can open
  // anything that is not already this member's. On the homepage that
  // navigation leaves the inline run behind; the job keeps going server-side
  // and /bulk resumes it.
  //
  // Recents first, then the desk: a run finished before 2026-08-31 filed its
  // report as a portfolio item, and those links must keep working.
  var openId=it.recent_item_id?'/?recent='+encodeURIComponent(it.recent_item_id)
    :it.portfolio_item_id?'/?property='+encodeURIComponent(it.portfolio_item_id):"";
  var addr=openId
    ? '<a href="'+openId+'">'+esc(it.address)+"</a>"
    : esc(it.address);
  var lbl=it.label?'<div class="sub">'+esc(it.label)+"</div>":"";
  // Editable on any FINISHED row — not only an unsized one. A looked-up size
  // that is wrong is the most expensive figure in the report (it is what put a
  // $52,000 mobile home at $795,000), so correcting one matters as much as
  // supplying a missing one. Nothing else in the row is editable: the comps
  // are evidence, and this is the one input that was ours to get wrong.
  // Where the size came from sits beside it, in a span every row has, so the
  // figures line up whether or not a row has one.
  var sz;
  if(it.status!=="done"){
    sz='\\u2014<span class="src"></span>';
  }else{
    var szv=Number(it.size_sqft)>0?Math.round(it.size_sqft).toLocaleString("en-US"):"";
    sz='<input class="szin" type="text" inputmode="numeric" data-id="'+esc(it.id)+'"'+
       ' value="'+esc(szv)+'" placeholder="add size" aria-label="Building size in square feet for '+esc(it.address)+'"/>'+
       '<span class="src">'+(szv?esc(it.size_source||"you"):"")+"</span>";
  }
  // Sale comps, not the comp count: the band comes from the sales, and a
  // lease-heavy report showing "10" would imply ten deals behind the number.
  var comps=Number(it.sale_comps)>0
    ? String(it.sale_comps)+(it.trimmed?"":' <span class="sub">wide band</span>') : "\\u2014";
  return '<tr><td class="n c-n">'+(i+1)+"</td>"+
    '<td class="c-a">'+addr+lbl+note+"</td>"+
    '<td class="n c-v">'+val+"</td>"+
    '<td class="n c-r">'+rng+"</td>"+
    '<td class="n c-p">'+psf(it.psf_mid)+"</td>"+
    '<td class="n c-s">'+sz+"</td>"+
    '<td class="n c-c">'+comps+"</td>"+
    '<td class="c-st">'+rowStatus(it.status)+(it.cached?'<span class="sub">cached</span>':"")+retry+"</td></tr>";
}

// Retry: one billed search, said before the click. The row goes back to the
// queue server-side and the job to running, so the ordinary poll draws it.
function bindRetryLinks(){
  Array.prototype.forEach.call(document.querySelectorAll("#bkRows a[data-retry]"),function(a){
    a.addEventListener("click",function(e){
      e.preventDefault();
      if(!confirm("Run this address again? It is one new search."))return;
      msg("Retrying\\u2026",false);
      api("POST","/api/bulk/item/retry",{id:a.getAttribute("data-retry")})
        .then(function(){if(job)poll(job.id,true);})
        .catch(function(err){msg(err.message,true);if(err.data&&err.data.job)poll(err.data.job.id,true);});
    });
  });
}

// A length of time in the words the bar and the page's cost line both use, so
// the time said before the button and the time counted down after it read as
// one estimate. Coarse on purpose: a figure that changes every second claims
// a precision the estimate does not have.
function span(ms){
  var s=Math.max(0,Number(ms)||0)/1000;
  if(s<10)return "a few seconds";
  if(s<=55)return (Math.ceil(s/5)*5)+" seconds";
  if(s<90)return "a minute";
  return Math.round(s/60)+" minutes";
}

// The one sentence a countdown says, for this bar and for index.html's
// loading card (which reads it off BULKRUN, so the two cannot word one wait
// two ways): "About 35 seconds left", "A few seconds left" at the end
// ("About a few seconds" is not a thing anyone says), and, once the search
// has outrun its usual time, that fact instead of another promise.
function leftWords(ms,late){
  if(late)return "Taking a little longer than usual";
  var w=span(ms);
  return w==="a few seconds"?"A few seconds left":"About "+w+" left";
}

function setProgress(p){
  prog=(p&&typeof p.left_ms==="number"&&typeof p.elapsed_ms==="number")?p:null;
  progAt=Date.now();
}
function stopProgressTick(){if(progTick){clearInterval(progTick);progTick=null;}}

// The time-left bar (owner's ask, 2026-11-10). The server says how long the
// run has been going and how long it has left (bulk.js runProgress) with every
// poll; this counts down in between, once a second, so the bar moves for the
// four seconds no answer arrives. Three rules:
//   - It never slides backwards. An estimate can grow (a slow search); a bar
//     that retreats reads as a crash, so the time is honest and the bar holds.
//   - It never reaches the end by itself. Only a finished job fills it.
//   - It never quotes a time it does not have. With no answer from the server
//     (a job this process is not working) it shows the count and no clock, and
//     past its estimate it says so instead of promising seconds again.
function drawProgress(){
  var box=$("bkProg");if(!box)return;
  var live=Boolean(job&&job.status==="running");
  if(!live){
    stopProgressTick();
    // A run that just finished under the reader's eyes fills the bar for a
    // moment before it goes; an old run opened from the list never shows one.
    if(job&&job.status==="done"&&progFor===job.id){
      paintProgress(box,100,"Done","");
      if(progHide)clearTimeout(progHide);
      progHide=setTimeout(function(){progHide=null;box.className="prog hide";},1500);
    }else if(!progHide){
      box.className="prog hide";
    }
    progFor=null;progShown=0;
    return;
  }
  if(progHide){clearTimeout(progHide);progHide=null;}
  if(progFor!==job.id){progFor=job.id;progShown=0;}
  if(!progTick)progTick=setInterval(drawProgress,1000);
  var total=Number(job.total)||0,done=Number(job.done_count)||0;
  var pct=total?done/total*100:0,left="";
  if(prog){
    var dt=Math.max(0,Date.now()-progAt);
    var spent=prog.elapsed_ms+dt,rest=Math.max(prog.left_ms-dt,1000);
    pct=spent/(spent+rest)*100;
    left=leftWords(rest,prog.late||prog.left_ms-dt<=0);
  }
  progShown=Math.max(progShown,Math.min(99,pct));
  paintProgress(box,progShown,
    total===1?"Searching for comps":"Valuing "+total+" addresses \\u00b7 "+done+" done",left);
}
function paintProgress(box,pct,what,left){
  box.className="prog";
  $("bkProgWhat").textContent=what;
  $("bkProgLeft").textContent=left;
  $("bkProgBar").style.width=(Math.round(pct*10)/10)+"%";
  var tr=$("bkProgTrack");
  tr.setAttribute("aria-valuenow",String(Math.round(pct)));
  tr.setAttribute("aria-valuetext",left?what+", "+left.charAt(0).toLowerCase()+left.slice(1):what);
}

function renderJob(){
  drawProgress();
  wire();
  syncOpen();
  if(!job){$("bkJobDeck").className="deck hide";return;}
  $("bkJobDeck").className="deck";
  $("bkJobTitle").textContent=job.label||"This run";
  var focus=job.tx_focus==="sales"?"Sales only \\u00b7 ":job.tx_focus==="leases"?"Leases only \\u00b7 ":"";
  $("bkJobMeta").innerHTML=esc(job.property_type)+" \\u00b7 "+focus+esc(String(job.months))+"-month lookback \\u00b7 "+
    statusChip(job.status)+' <span class="sub">'+job.done_count+" of "+job.total+" done</span>";
  renderTotals(summary||{total:items.length,valued:0,failed:0,low:0,likely:0,high:0});
  $("bkRows").innerHTML='<thead><tr><th class="c-n"></th><th>Address</th><th class="n">Likely value</th>'+
    '<th class="n">Range</th><th class="n">$/SF</th><th class="n c-s">Size</th><th class="n">Sale comps</th>'+
    "<th>Status</th></tr></thead><tbody>"+items.map(rowHtml).join("")+"</tbody>";
  $("bkCancel").className=job.status==="running"?"btn sm ghost":"btn sm ghost hide";
  bindSizeInputs();
  bindRetryLinks();
  renderPast();
  // The page's own copy — /bulk's button and cap line, or the homepage's.
  // Guarded rather than called directly: this module must not know that a
  // form exists, because on index.html one does not.
  if(onState)onState(job,items);
  var dl=$("bkDl");
  dl.href="/api/bulk/export.csv?id="+encodeURIComponent(job.id);
  dl.style.display=job.done_count>0?"":"none";
  // Offered only once the run has stopped and something was valued: an
  // affordance over nothing is a control that does nothing.
  var aa=$("bkAddAll");
  if(aa)aa.className=(job.status!=="running"&&portfolioCandidates().length)?"":"hide";
}

// "Add valued rows to portfolio" (owner's call, 2026-09-04). A portfolio is
// what you OWN, so this is an explicit act with a confirm naming the count,
// never something a run does on its own. It walks the one sanctioned door —
// GET the stored recent, POST /api/portfolio with its payload — so the match
// key, the 100/500 cap and the fill-never-rewrite verified key apply by
// construction, and a property already in the book is answered "existed"
// rather than duplicated. The snapshot is the row's own figure: the same
// arithmetic the report would open with.
function portfolioCandidates(){
  return items.filter(function(it){return it.status==="done"&&it.recent_item_id&&Number(it.value_likely)>0;});
}
function addAllToPortfolio(){
  var rows=portfolioCandidates();
  if(!rows.length)return;
  if(!confirm("Add "+rows.length+" valued address"+(rows.length===1?"":"es")+" to your portfolio? "+
    "A portfolio is what you own — each one becomes a tracked property."))return;
  var added=0,existed=0,i=0;
  msg("Adding to your portfolio\\u2026",false);
  function step(){
    if(i>=rows.length){
      msg("Added "+added+" of "+rows.length+" to your portfolio"+(existed?" \\u00b7 "+existed+" already there":"")+".",false);
      return;
    }
    var it=rows[i++];
    api("GET","/api/recents?id="+encodeURIComponent(it.recent_item_id)).then(function(rec){
      return api("POST","/api/portfolio",{
        payload:rec.payload,
        snapshot:{low:it.value_low,likely:it.value_likely,high:it.value_high},
        verifiedKey:""
      });
    }).then(function(d){
      if(d&&d.existed)existed++;else added++;
      msg("Adding to your portfolio\\u2026 "+(added+existed)+" of "+rows.length,false);
      step();
    }).catch(function(err){
      msg("Stopped at "+it.address+": "+err.message+" ("+added+" added).",true);
    });
  }
  step();
}

// The list a page load hands us, kept so renderJob() can re-render it: the
// open run is filtered OUT of "Earlier runs", and on first paint the job is
// not yet known — without this the run showing above is also listed below it
// as an earlier one.
function setJobs(list){allJobs=list||[];renderPast();}

// Save on Enter or on leaving the field, the spreadsheet behavior the vault's
// comps table already teaches; Escape restores what was there.
//
// Re-valuing costs nothing — it is arithmetic over comps we already hold — so
// there is no confirm and no spend warning. That is the whole point of it.
function bindSizeInputs(){
  Array.prototype.forEach.call(document.querySelectorAll("#bkRows input.szin"),function(el){
    var was=el.value;
    el.addEventListener("keydown",function(e){
      if(e.key==="Enter"){e.preventDefault();el.blur();}
      else if(e.key==="Escape"){e.preventDefault();el.value=was;el.blur();}
    });
    el.addEventListener("blur",function(){
      var v=el.value.trim();
      if(v===was.trim())return;             // nothing typed, nothing to do
      if(v===""){el.value=was;return;}      // clearing is not a way to unset a size
      saveSize(el,v,was);
    });
  });
}

function saveSize(el,value,was){
  el.disabled=true;
  msg("Re-valuing\\u2026",false);
  api("POST","/api/bulk/item/size",{id:el.getAttribute("data-id"),size_sqft:value})
    .then(function(){
      // Re-read the whole job rather than patching the row in place: the
      // totals strip above is a sum over every row and would otherwise go on
      // showing the old portfolio value beside a new one.
      msg("Re-valued from the comps already found \\u2014 no new search.",false);
      return poll(job.id,true);
    })
    .catch(function(e){
      el.disabled=false;el.value=was;
      msg(e.message,true);
    });
}

// Only /bulk renders the list; the homepage links to it instead, so this is a
// no-op there rather than a thrown error.
function renderPast(){
  if(!$("bkPast"))return;
  var rest=allJobs.filter(function(j){return !job||j.id!==job.id;});
  if(!rest.length){$("bkPastDeck").className="deck hide";return;}
  $("bkPastDeck").className="deck";
  var count=$("bkPastN");
  if(count)count.textContent=String(rest.length);
  // A menu open in the ledger is not redrawn from under the pointer (a
  // running job redraws every four seconds); closeMenus() redraws it after.
  var body=$("bkPast");
  if(body.querySelectorAll&&body.querySelectorAll('.mn-btn[aria-expanded="true"]').length){pastStale=true;return;}
  // A ledger row per run, on one line (2026-11-15): name and date, type and
  // lookback, the address count, the portfolio value (the list read's own
  // BULK.summarize over the run's done rows, 2026-09-04 — the same arithmetic
  // the strip shows, so the two cannot disagree; absent, not zero, when the
  // read failed; its low and high are on the run itself, a click away), the
  // status, and a three-dot menu: Download CSV, Run again, Rename, Delete.
  body.innerHTML=rest.map(function(j){
    var done=j.status==="done"||(j.status!=="running"&&j.done_count>=j.total&&j.total>0);
    var s=j.summary,name=j.label||j.address||j.property_type+" run";
    var val=s&&s.valued>0
      ? '<span class="fig">'+money(s.likely)+"</span>"+
        (s.valued<j.total?'<div class="sub">'+s.valued+" of "+j.total+" valued</div>":"")
      : '<span class="sub">\\u2014</span>';
    var acts=[];
    if(done||j.done_count>0)acts.push('<a href="/api/bulk/export.csv?id='+encodeURIComponent(j.id)+'">Download CSV</a>');
    if(onRunAgain&&j.status!=="running")acts.push('<a href="#" data-again="'+esc(j.id)+'">Run again</a>');
    acts.push('<a href="#" data-rename="'+esc(j.id)+'">Rename</a>');
    if(j.status!=="running")acts.push('<a href="#" class="danger" data-del="'+esc(j.id)+'">Delete</a>');
    // A one-address run opens its full report (the list read's report_href,
    // 2026-11-23); a list opens its run, where each address links to its own.
    var open=j.report_href&&/^[/][?](recent|property)=/.test(j.report_href)
      ? '<a href="'+esc(j.report_href)+'">'+esc(name)+"</a>"
      : '<a href="#" data-job="'+esc(j.id)+'">'+esc(name)+"</a>";
    return '<tr><td class="r-name">'+open+
      '<span class="sub dt">'+esc(dayWords(j.created_at))+"</span></td>"+
      '<td class="r-type">'+esc(j.property_type)+" \\u00b7 "+esc(String(j.months))+" months"+
      '<span class="pn"> \\u00b7 '+j.total+(j.total===1?" address":" addresses")+"</span></td>"+
      '<td class="n r-n">'+j.total+"</td>"+
      '<td class="n r-val">'+val+"</td>"+
      '<td class="r-st">'+rowStatus(j.status)+(j.status!=="running"&&j.done_count<j.total
        ?'<span class="sub">'+(j.total-j.done_count)+" not valued</span>":"")+"</td>"+
      '<td class="n r-act">'+menu("More for "+name,acts.join(""))+"</td></tr>";}).join("");
  var past=$("bkPast");
  Array.prototype.forEach.call(past.querySelectorAll("a[data-job]"),function(a){
    a.addEventListener("click",function(e){e.preventDefault();poll(a.getAttribute("data-job"),true);});});
  // Run again: the page's own handler (it fills the form), reached through
  // the callback because this module knows no form exists.
  Array.prototype.forEach.call(past.querySelectorAll("a[data-again]"),function(a){
    a.addEventListener("click",function(e){
      e.preventDefault();
      api("GET","/api/bulk?id="+encodeURIComponent(a.getAttribute("data-again")))
        .then(function(d){onRunAgain(d.job,d.items||[]);})
        .catch(function(err){msg(err.message,true);});
    });});
  // Rename: the run's own name, never shown publicly. Empty clears it.
  Array.prototype.forEach.call(past.querySelectorAll("a[data-rename]"),function(a){
    a.addEventListener("click",function(e){
      e.preventDefault();
      var id=a.getAttribute("data-rename");
      var cur=(allJobs.filter(function(j){return j.id===id;})[0]||{}).label||"";
      var next=prompt("Name this run:",cur);
      if(next===null)return;
      api("PATCH","/api/bulk",{id:id,label:next}).then(function(){
        if(job&&job.id===id){job.label=next.trim()||null;renderJob();}
        if(onList)onList();
      }).catch(function(err){msg(err.message,true);});
    });});
  // Delete: the receipt goes, the valuations stay (they are filed under
  // recent searches, where they belong to the property, not to the run).
  Array.prototype.forEach.call(past.querySelectorAll("a[data-del]"),function(a){
    a.addEventListener("click",function(e){
      e.preventDefault();
      var id=a.getAttribute("data-del");
      if(!confirm("Delete this run from the list? Its valuations stay in your recent searches."))return;
      api("DELETE","/api/bulk?id="+encodeURIComponent(id)).then(function(){
        if(job&&job.id===id){job=null;items=[];summary=null;renderJob();}
        if(onList)onList();
      }).catch(function(err){msg(err.message,true);});
    });});
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
    job=d.job;items=d.items||[];summary=d.summary;
    setProgress(d.progress);
    renderJob();
    if(force&&onList)onList();
    if(job&&job.status==="running")timer=setTimeout(function(){poll(id);},4000);
    else if(onList)onList();
  }).catch(function(e){
    msg(e.message,true);
    // The poll does not re-arm after a failed read, so the bar must not go on
    // counting down toward an answer nobody is asking for: it keeps its
    // place, drops its clock, and the message above says what happened.
    setProgress(null);drawProgress();stopProgressTick();
  });
}

// Stop polling without clearing what is drawn. index.html calls this when a
// single-address report takes the viewport, so a hidden run view does not go
// on requesting every four seconds for the life of the tab.
function stop(){if(timer){clearTimeout(timer);timer=null;}stopProgressTick();}

function showNotes(d){
  var el=$("bkNotes");if(!el)return;
  var out=[];
  if(d.truncated)out.push(d.truncated+" address"+(d.truncated===1?" was":"es were")+
    " left out \\u2014 a run holds "+MAX+".");
  if(d.duplicates)out.push(d.duplicates+" duplicate"+(d.duplicates===1?"":"s")+" removed.");
  (d.skipped||[]).forEach(function(s){out.push("Line "+s.line+": "+s.reason+" ("+esc(s.address)+")");});
  (d.warnings||[]).forEach(function(w){out.push("Line "+w.line+": "+w.reason);});
  if(!out.length){el.className="notes hide";return;}
  el.className="notes";
  el.innerHTML="<b>Before you read the totals:</b><ul><li>"+
    out.map(function(t){return esc(t).replace(/&amp;(\\w+;)/g,"&$1");}).join("</li><li>")+"</li></ul>";
}

// Paint a run from a POST answer, without waiting for the first poll.
function showRun(d){
  job=d.job;items=d.items||[];summary=null;
  setProgress(d.progress);
  renderJob();
}

function init(opts){
  opts=opts||{};
  onState=opts.onState||null;
  onList=opts.onList||null;
  onRunAgain=opts.onRunAgain||null;
  if(opts.max)MAX=opts.max;
  wire();
}

return {init:init,showRun:showRun,poll:poll,stop:stop,setJobs:setJobs,
  countLines:countLines,firstAddress:firstAddress,listHeaders:LIST_HEADERS,
  showNotes:showNotes,msg:msg,api:api,span:span,leftWords:leftWords,
  setMax:function(n){MAX=n;},state:function(){return {job:job,items:items};}};
})();
`;

// BULKPAGE — the /bulk form, gate, CSV upload and cap copy. Everything that is
// NOT the run view. It drives BULKRUN and owns nothing BULKRUN draws.
const BULK_JS = `
var BULKPAGE=(function(){
"use strict";
var $=function(i){return document.getElementById(i);};
var MAX=50,TYPES=[],parsedCount=0;
var LEFT=null,DAILY=null;
// What one address takes here lately and how many run at once (the list
// read's pace), or null until the server has said. The cost line reads it so
// the time promised before the button is the time the bar counts down after.
var PACE=null;
// The id of a ONE-address run started from this page load, or null. When it
// finishes with a report, the page opens that report instead of leaving a
// one-row table on screen (owner's, 2026-09-04: this page is the comp-report
// tool). Scoped to runs THIS page started: an earlier single run re-opened
// from the list below is being looked at as a row, not re-run, so it stays.
var singleJob=null;
// The Sites deal a one-address run was started from (2026-10-21): its id
// and the address it handed over. The report it opens writes its value back
// onto that deal (index.html's ?site=). Dropped if the address was changed,
// so a value never lands on the wrong deal.
var SITE=null,singleSite=null;

// The per-type subject fields, a MIRROR of index.html's TYPE_SUBJECT_FIELDS
// (this file cannot require index.html and index.html is not a module).
// test/bulk-inline.test.js evaluates both literals and fails the build if
// they differ, so a field added to the form through the add-comp-field skill
// fails here until it is added too. Keys are TYPE_COMP_FIELDS keys, which is
// what the server whitelists them against.
var BULK_SUBJECT_FIELDS={
  Industrial: [
    { key: "clear_height", label: "Clear height (ft)", type: "number", placeholder: "e.g. 32" },
    { key: "dock_doors",   label: "Dock doors",        type: "number", placeholder: "e.g. 6" },
  ],
  Office: [
    { key: "building_class", label: "Building class",   type: "select", options: ["", "Class A", "Class B", "Class C"] },
    { key: "floor_plate",    label: "Floor plate (SF)", type: "number", placeholder: "e.g. 18000" },
  ],
  Retail: [
    { key: "center_type",   label: "Center type",   type: "select", options: ["", "Neighborhood center", "Strip center", "Power center", "Single-tenant NNN", "Urban storefront"] },
    { key: "anchor_tenant", label: "Anchor tenant", type: "text",   placeholder: "e.g. Kroger" },
  ],
  Multifamily: [
    { key: "units", label: "Unit count", type: "number", placeholder: "e.g. 48" },
  ],
  Land: [
    { key: "lot_acres", label: "Acres",  type: "number", placeholder: "e.g. 2.4" },
    { key: "zoning",    label: "Zoning", type: "text",   placeholder: "e.g. M-1" },
  ],
  Residential: [
    { key: "beds_baths", label: "Beds / baths", type: "text", placeholder: "e.g. 4 bd / 3 ba" },
    { key: "condition", label: "Condition", type: "select",
      options: ["", "Needs work", "Original", "Updated", "Renovated"] },
  ],
};/*END_SUBJECT_FIELDS*/

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

// The type's own fields, as cells. Rebuilt on every type change, so the
// inputs never keep the previous type's shape (index.html's
// syncSubjectFieldsToType rule).
function renderSubjectFields(type){
  var host=$("bulkSubjectFields");if(!host)return;
  var fields=BULK_SUBJECT_FIELDS[type]||[];
  host.hidden=!fields.length;
  host.innerHTML=fields.map(function(f){
    var id="bulkSubj_"+f.key;
    var ctl=f.type==="select"
      ? '<select id="'+id+'" data-subject-key="'+esc(f.key)+'">'+(f.options||[]).map(function(o){
          return '<option value="'+esc(o)+'">'+(o?esc(o):"\\u2014")+"</option>";}).join("")+"</select>"
      : '<input type="'+(f.type==="number"?"number":"text")+'" id="'+id+'" data-subject-key="'+esc(f.key)+'"'+
        (f.type==="number"?' min="0" step="any"':' maxlength="40"')+' placeholder="'+esc(f.placeholder||"")+'"/>';
    return '<div class="cell"><label for="'+id+'">'+esc(f.label)+' <span class="opt">(optional)</span></label>'+ctl+"</div>";
  }).join("");
  Array.prototype.forEach.call(host.querySelectorAll("[data-subject-key]"),function(el){
    el.addEventListener("input",refreshMore);el.addEventListener("change",refreshMore);});
  refreshMore();
}

// What a one-address run sends beside the address: index.html's meta.subject
// shape (minus curation), read straight off the fields. Empty strings are
// left out so the server stores nothing for an untouched form.
function readSubject(){
  var n=function(id){var v=Number(($(id)||{}).value);return v>0?v:null;};
  var details={};
  Array.prototype.forEach.call(document.querySelectorAll("#bulkSubjectFields [data-subject-key]"),function(el){
    var v=String(el.value||"").trim();if(v)details[el.getAttribute("data-subject-key")]=v;});
  return {sizeSqft:n("bulkSize"),asking:n("bulkAsking"),noi:n("bulkNoi"),capRate:n("bulkCap"),details:details};
}

var FOCUS_WORDS={both:"Sales & leases",sales:"Sales only",leases:"Leases only"};

// The folded line, DERIVED every time (the form's settings-line rule): a
// summary written once describes a run that is not the one about to start.
function refreshMore(){
  var line=$("moreLine");if(!line)return;
  var list=parsedCount>1;
  if(list){
    line.textContent="per row, from your file's columns \\u00b7 "+(($("bulkLabel")||{}).value?"named":"unnamed run");
    return;
  }
  var s=readSubject();
  var parts=[];
  parts.push(s.sizeSqft?Math.round(s.sizeSqft).toLocaleString("en-US")+" SF":"size from public records");
  parts.push(s.asking?"asking $"+Math.round(s.asking).toLocaleString("en-US"):"no asking price");
  parts.push(s.noi&&s.capRate?"NOI and cap rate set":s.noi?"NOI set":s.capRate?"cap rate set":"no NOI");
  var dn=Object.keys(s.details).length;
  var type=($("bulkType")||{}).value||"";
  if(dn)parts.push(dn+" "+type+" detail"+(dn===1?"":"s"));
  line.textContent=parts.join(" \\u00b7 ");
}

// The per-property fields describe one property. Past one address they fold
// away and the note says which upload columns carry the same facts per row.
function refreshPerAddress(){
  var list=parsedCount>1;
  var per=$("perAddress"),note=$("listNote");
  if(per)per.hidden=list;
  if(note){
    note.hidden=!list;
    if(list){
      var type=($("bulkType")||{}).value||"";
      var keys=(BULK_SUBJECT_FIELDS[type]||[]).map(function(f){return f.key;});
      note.innerHTML="For a list, each row brings its own facts through the file's columns: "+
        "<code>size_sqft</code>, <code>asking_price</code>, <code>noi</code>, <code>cap_rate</code>"+
        (keys.length?" and "+keys.map(function(k){return "<code>"+esc(k)+"</code>";}).join(", "):"")+
        ". Rows without them are looked up as usual.";
    }
  }
  refreshMore();
}

// How long a run of n addresses should take, in BULKRUN's words, or "" when
// the server has not said how fast searches are running. The same sum the bar
// opens on: the addresses dealt across the lanes, each taking the usual time.
function runSpan(n){
  if(!PACE||!(Number(PACE.typical_ms)>0))return "";
  var lanes=Math.max(1,Number(PACE.concurrency)||1);
  return BULKRUN.span(Math.ceil(n/lanes)*Number(PACE.typical_ms));
}

// The box starts three lines tall and grows with the list, to a point, so
// a pasted list is read rather than scrolled. An EMPTY box grows to its
// example addresses too (2026-11-25, the owner, of a phone: "the suggested
// adress is cut off"): on a phone each example wraps to two lines, and three
// of them ran past the three-line box. A browser does not count placeholder
// text in scrollHeight, so the examples are measured by putting them in the
// box for that one read and taking them out again (no event fires, and the
// box is empty, so there is no caret or undo entry to lose).
function fitBox(){
  var box=$("bulkText");
  if(!box)return;
  box.style.height="";
  var empty=box.value==="";
  if(empty){if(!box.placeholder)return;box.value=box.placeholder;}
  if(box.scrollHeight>box.clientHeight)box.style.height=Math.min(box.scrollHeight+2,420)+"px";
  if(empty)box.value="";
}

function refreshCount(){
  parsedCount=Math.min(BULKRUN.countLines($("bulkText").value),MAX);
  fitBox();
  $("count").textContent=parsedCount?parsedCount+" address"+(parsedCount===1?"":"es")+" ready":"";
  // The offer applies to an empty box only, so it leaves once there is
  // anything to lose — a control that would overwrite nothing is noise, and
  // one that WOULD overwrite something should not be a stray keystroke.
  var ex=$("useExample");
  if(ex)ex.className=$("bulkText").value===""?"lnk":"lnk hide";
  refreshPerAddress();
  // One run at a time, and the button says so rather than letting somebody
  // press it into a 409. The server enforces it either way; this is the
  // Buy-button rule — a control that can only fail is worse than none.
  var st=BULKRUN.state();
  var busy=Boolean(st.job&&st.job.status==="running");
  // Not disabled on an empty box (owner's, 2026-09-04: nothing here is dim).
  // run() answers an empty click with a message and the caret instead. Busy
  // and over-cap still disable, with the cost line saying why.
  $("run").disabled=busy;
  // One address is a report, not a "valuation of one": the button says what
  // will actually happen, since a single run opens its report when it lands.
  $("run").textContent=parsedCount===1?"Run the report"
    :parsedCount?"Run "+parsedCount+" valuations":"Run valuations";
  // Said BEFORE the button, not after: a run is up to fifty billed searches
  // and half an hour, and the moment to know that is while deciding.
  // The daily ceiling is said BEFORE the list is too long, not only when the
  // run is refused: somebody with 12 left should find that out while pasting,
  // not after deciding which forty addresses mattered.
  var overCap=LEFT!==null&&parsedCount>LEFT;
  if(overCap)$("run").disabled=true;
  var took=parsedCount?runSpan(parsedCount):"";
  $("cost").textContent=busy
    ? "A run is going below. Wait for it to finish, or cancel it first."
    : overCap
    ? (LEFT===0
        ? "You have valued "+DAILY+" addresses today — the daily limit. It resets at midnight UTC."
        : "Only "+LEFT+" left today (the daily limit is "+DAILY+"). Trim the list, or come back after midnight UTC.")
    : parsedCount===1
    ? "About "+(took||"a minute")+"; the comp report opens when it finishes. An address searched before is served from cache and opens at once."
    : parsedCount
    ? "Roughly "+(took||Math.max(1,Math.round(parsedCount*0.9))+"\\u2013"+Math.ceil(parsedCount*1.1)+" min")+
      ". Addresses searched before come from cache and finish at once. Each address is its own billed search."
    : "Each address is its own billed search; nothing runs until you press the button.";
}

// BULKRUN's onState hook: the cap copy above, plus the single-address rule.
// A finished one-address run started here opens its report (the row's own
// ?recent= door, user-scoped like every other read of it); a failed one
// stays as a row with its reason, because a redirect to nothing would hide
// the one line that says what went wrong. ran=1 tells the report it was just
// run, so it is not introduced as a saved one being reopened (2026-10-21).
// The form folds away while a run is on screen (2026-11-15): the run view
// marks #app .bk-open and the stylesheet hides the form, so the page shows
// the form or a run and either fits one screen. .bk-form keeps the form over
// a run. formFor says for how long: a run's id (until another run is on
// screen), or "*" (until a run is started from the form).
var formFor=null;
function showForm(sticky){
  var st=BULKRUN.state();
  formFor=sticky||!st.job?"*":st.job.id;
  $("app").classList.add("bk-form");
}
function foldForm(){formFor=null;$("app").classList.remove("bk-form");}

function onRunState(job,items){
  if(formFor&&formFor!=="*"&&job&&job.id!==formFor)foldForm();
  refreshCount();
  if(!singleJob||!job||job.id!==singleJob||job.status==="running")return;
  singleJob=null;
  var it=items&&items[0];
  var id=it&&it.status==="done"&&it.recent_item_id;
  if(!id)return;
  BULKRUN.msg("Valued. Opening the report\\u2026",false);
  var site=singleSite;singleSite=null;
  location.href="/?recent="+encodeURIComponent(id)+"&ran=1"+(site?"&site="+encodeURIComponent(site):"");
}

// Fill the box with the example addresses.
//
// The examples live in the textarea's PLACEHOLDER and are read back out of it
// here, so there is one copy. Writing them twice would let the greyed text and
// the thing Tab inserts drift into disagreeing about what a valid list looks
// like, which is the one job this feature has.
//
// insertText rather than assigning .value, so Ctrl+Z / Cmd+Z undoes it like
// any other typing. It is a deprecated API and universally supported; the
// assignment is the fallback, and costs only the undo entry.
function fillExamples(){
  var ta=$("bulkText");
  if(ta.value!=="")return false;
  var text=ta.placeholder||"";
  if(!text)return false;
  ta.focus();
  var ok=false;
  try{ok=document.execCommand("insertText",false,text);}catch(e){ok=false;}
  if(!ok){ta.value=text;}
  refreshCount();
  return true;
}

// Real samples (owner's, 2026-11-18): buildings near this member that NOBODY
// has searched yet replace the fixed examples, so every sample somebody runs
// is a fresh search and fresh comps (GET /api/sample-addresses; the rules are
// sample-addresses.js's). They go INTO the placeholder, which stays the one
// source fillExamples reads. Per type, because the whole list runs as the one
// type the select holds; a type with none puts the fixed examples back.
var SAMPLES={},FIXED_SAMPLES=null;
function loadSamples(){
  var ta=$("bulkText"),type=$("bulkType").value||"";
  if(FIXED_SAMPLES===null)FIXED_SAMPLES=ta.placeholder||"";
  if(!type)return;
  function show(list){
    if($("bulkType").value!==type)return;   // the select moved on while this was loading
    ta.placeholder=list&&list.length?list.join("\\n"):FIXED_SAMPLES;
    fitBox();
  }
  if(SAMPLES[type]){show(SAMPLES[type]);return;}
  BULKRUN.api("GET","/api/sample-addresses?count=3&type="+encodeURIComponent(type)).then(function(d){
    var list=((d&&d.addresses)||[]).map(function(a){return a&&a.address;}).filter(Boolean);
    SAMPLES[type]=list;show(list);
  }).catch(function(){show(null);});
}

function loadList(){
  return BULKRUN.api("GET","/api/bulk").then(function(d){
    if(d.maxAddresses){MAX=d.maxAddresses;BULKRUN.setMax(MAX);}
    if(typeof d.leftToday==="number"){LEFT=d.leftToday;DAILY=d.dailyLimit;}
    if(d.pace)PACE=d.pace;
    if(d.types&&d.types.length&&!TYPES.length){TYPES=d.types;fillTypes();}
    BULKRUN.setJobs(d.jobs||[]);
    refreshCount();
    // Resume whatever is going: a member who closed the tab mid-run and came
    // back should find the run, not an empty form suggesting it never
    // happened. Only auto-attaches to a LIVE job, so an old finished run does
    // not reopen itself every visit.
    if(!BULKRUN.state().job){
      var live=(d.jobs||[]).filter(function(j){return j.status==="running";})[0];
      if(live)BULKRUN.poll(live.id);
    }
    return d;
  });
}

// The bar is the answer to "how long", and on a laptop it starts below the
// fold: the form above it is most of a screen. So a run started here brings
// it into view by the least scroll that shows it, and not at all when it is
// already on screen (block "nearest"; the bar's own scroll-margin keeps it off
// the edge).
function showBar(){
  var p=$("bkProg");
  if(!p||!p.scrollIntoView)return;
  var calm=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try{p.scrollIntoView({block:"nearest",behavior:calm?"auto":"smooth"});}catch(e){}
}

function run(){
  if(parsedCount===0){
    BULKRUN.msg("Type or paste at least one address first.",true);
    $("bulkText").focus();
    return;
  }
  var btn=$("run");btn.disabled=true;
  BULKRUN.msg("Starting\\u2026",false);
  // The subject rides ONLY for a one-address run: the fields describe a
  // property, and a list's rows carry their own through the upload's columns
  // (the server enforces the same rule, so this is a courtesy, not a gate).
  var body={
    text:$("bulkText").value,type:$("bulkType").value,
    months:Number($("bulkMonths").value),note:$("bulkNote").value,label:$("bulkLabel").value,
    txFocus:$("bulkFocus").value
  };
  if(parsedCount===1)body.subject=readSubject();
  var same=function(a){return String(a||"").trim().toLowerCase();};
  var siteFor=SITE&&parsedCount===1&&same($("bulkText").value)===same(SITE.address)?SITE.id:null;
  BULKRUN.api("POST","/api/bulk",body).then(function(d){
    foldForm();
    var one=Boolean(d.job&&d.job.total===1);
    singleJob=one?d.job.id:null;
    singleSite=one?siteFor:null;
    BULKRUN.msg(one
      ? "Running. The comp report opens here when it finishes; if you leave, the row below keeps its link."
      : "Running. You can close this tab \\u2014 the valuations keep going and land on Home.",false);
    BULKRUN.showNotes(d);
    BULKRUN.showRun(d);BULKRUN.poll(d.job.id);
    showBar();
  }).catch(function(e){
    BULKRUN.msg(e.message,true);
    // A refusal carries the fresh number, so the cost line corrects itself
    // rather than going on allowing a run the server just denied.
    if(e.data&&typeof e.data.left_today==="number"){
      LEFT=e.data.left_today;DAILY=e.data.daily_limit;}
    if(e.data)BULKRUN.showNotes(e.data);
    if(e.data&&e.data.job)BULKRUN.poll(e.data.job.id);
  }).then(function(){refreshCount();});
}

// Run again (2026-09-04): refill the form from an earlier run — its
// addresses, type, lookback, focus and market note — and scroll to it. It
// does NOT start the run: re-running is the documented resume (finished rows
// come from cache for free), but a run is still up to fifty billed searches
// and the button is where that decision is made. The label is left blank so
// the new run is not filed under the old name.
function runAgain(j,its){
  var text=(its||[]).slice().sort(function(a,b){return a.position-b.position;})
    .map(function(it){return it.address;}).filter(Boolean).join("\\n");
  var ta=$("bulkText");
  ta.value=text;
  var sel=$("bulkType");
  if(j&&j.property_type&&Array.prototype.some.call(sel.options,function(o){return o.value===j.property_type;})){
    sel.value=j.property_type;renderSubjectFields(sel.value);
  }
  var mo=$("bulkMonths");
  if(j&&Array.prototype.some.call(mo.options,function(o){return o.value===String(j.months);}))mo.value=String(j.months);
  $("bulkFocus").value=j&&j.tx_focus?j.tx_focus:"both";
  $("bulkNote").value=(j&&j.note)||"";
  $("bulkLabel").value="";
  // Over the run being looked at, until another run is on screen.
  showForm();
  refreshCount();
  BULKRUN.msg("Filled in from "+((j&&j.label)||"that run")+". Change anything, then run it.",false);
  window.scrollTo({top:0,behavior:"smooth"});
  ta.focus();
}

function fillTypes(){
  $("bulkType").innerHTML=TYPES.map(function(t){
    return '<option value="'+esc(t)+'">'+esc(t)+"</option>";}).join("");
  renderSubjectFields($("bulkType").value);
}

function gate(msg,actionHtml){
  $("gate").hidden=false;$("app").hidden=true;
  $("gateMsg").textContent=msg;
  $("gateAct").innerHTML=actionHtml||"";
}

function start(boot){
  if(!boot||boot.s===401)
    return gate("Sign in to run a comp report.",'<a class="lnk" href="/?auth=signin">Sign in</a>');
  if(boot.s===403)
    return gate((boot.j&&boot.j.error)||"The Comp report tool is part of Pro.",
      '<a class="lnk" href="/?pricing=1">See Pro</a>');
  if(boot.s!==200)
    return gate((boot.j&&boot.j.error)||"The Comp report tool is unavailable right now.","");
  $("gate").hidden=true;$("app").hidden=false;
  var d=boot.j||{};
  if(d.maxAddresses)MAX=d.maxAddresses;
  if(typeof d.leftToday==="number"){LEFT=d.leftToday;DAILY=d.dailyLimit;}
  if(d.pace)PACE=d.pace;
  TYPES=d.types||[];fillTypes();
  BULKRUN.init({max:MAX,onState:onRunState,onList:loadList,onRunAgain:runAgain});
  // New report: the run view's button, this page's to show and to answer,
  // because the run view knows no form. It brings the folded form back.
  var nw=$("bkNew");
  if(nw){
    nw.className="btn sm ghost";
    nw.addEventListener("click",function(){
      showForm();
      refreshCount();
      window.scrollTo({top:0,behavior:"smooth"});
      $("bulkText").focus();
    });
  }
  BULKRUN.setJobs(d.jobs||[]);
  var live=(d.jobs||[]).filter(function(j){return j.status==="running";})[0];
  if(live)BULKRUN.poll(live.id);

  $("bulkText").addEventListener("input",refreshCount);
  // A width change rewraps the lines (a phone turned sideways); a height-only
  // resize (Safari's toolbar sliding on a swipe) changes nothing here.
  var fitW=window.innerWidth;
  window.addEventListener("resize",function(){if(window.innerWidth!==fitW){fitW=window.innerWidth;fitBox();}});
  // A deal handed over from Sites' "Run a land report" (2026-10-21): ?type=
  // picks one of the offered types, and ?acres= / ?zoning= fill that type's
  // own fields where they are empty. Like ?address= below it fills once and
  // runs nothing.
  try{var qs=new URLSearchParams(location.search),qt=qs.get("type");
    if(qt&&TYPES.indexOf(qt)>=0&&$("bulkType").value!==qt){$("bulkType").value=qt;renderSubjectFields(qt);}
    [["acres","lot_acres"],["zoning","zoning"]].forEach(function(p){
      var v=qs.get(p[0]),el=$("bulkSubj_"+p[1]);
      if(v&&el&&!el.value)el.value=String(v).slice(0,40);});
    var qsite=qs.get("site");
    if(qsite&&/^[0-9a-f-]{36}$/i.test(qsite)&&qs.get("address"))SITE={id:qsite,address:String(qs.get("address")).slice(0,200)};
    refreshMore();}catch(e){}
  // An address handed over from Home's find box (2026-10-07): ?address= fills
  // an EMPTY box once and runs nothing, because every address is a billed
  // search and the member still presses the button.
  try{var pre=new URLSearchParams(location.search).get("address");
    if(pre&&!$("bulkText").value){showForm(true);$("bulkText").value=String(pre).slice(0,200);refreshCount();$("bulkText").focus();}}catch(e){}
  $("bulkType").addEventListener("change",function(){renderSubjectFields($("bulkType").value);refreshPerAddress();loadSamples();});
  // Only once the page is SEEN: this page is built ahead of the click on every
  // member page view (rule 15), and a page nobody opens should not spend a
  // corpus read and a cache probe on samples nobody will read.
  if(document.prerendering)document.addEventListener("prerenderingchange",loadSamples,{once:true});
  else loadSamples();
  ["bulkSize","bulkAsking","bulkNoi","bulkCap","bulkLabel"].forEach(function(id){
    $(id).addEventListener("input",refreshMore);});
  $("useExample").addEventListener("click",function(){fillExamples();});
  // Tab fills the box — but ONLY while it is empty, and never with a modifier.
  //
  // Tab is how a keyboard user leaves a field, so taking it is a real cost and
  // the guards are what keep it payable. An empty box is the one state where
  // Tab-to-leave and Tab-to-fill can be told apart by intent: there is nothing
  // to move on FROM. The moment there is any content the key does its ordinary
  // job again, so the surprise can happen at most once, is visible when it
  // does (three lines of text appear under the cursor), and is undone with
  // Ctrl+Z or one more Tab press to carry on.
  //
  // Shift+Tab is never intercepted: moving focus BACKWARDS out of an empty box
  // is unambiguous, and stealing it would trap somebody at the top of the form.
  $("bulkText").addEventListener("keydown",function(e){
    if(e.key!=="Tab"||e.shiftKey||e.ctrlKey||e.metaKey||e.altKey)return;
    if(!fillExamples())return;   // non-empty (or no placeholder): Tab moves focus, as it must
    e.preventDefault();
  });
  $("run").addEventListener("click",run);
  $("pickFile").addEventListener("click",function(){$("bulkFile").click();});
  $("bulkFile").addEventListener("change",function(){
    var f=$("bulkFile").files&&$("bulkFile").files[0];if(!f)return;
    var fr=new FileReader();
    fr.onerror=function(){BULKRUN.msg("That file could not be read.",true);};
    // An Excel workbook goes to the server to be read (xlsx.js, first sheet)
    // and comes back as CSV text into the same box, so the count, the cost
    // line and every parse rule run exactly as they do on a paste.
    if(/\\.xlsx$/i.test(f.name||"")){
      fr.onload=function(){
        BULKRUN.msg("Reading "+f.name+"\\u2026",false);
        BULKRUN.api("POST","/api/bulk/inspect",{xlsx:String(fr.result||"")}).then(function(d){
          $("bulkText").value=String(d.csv||"");
          BULKRUN.msg("Read the first sheet of "+f.name+".",false);
          refreshCount();
        }).catch(function(e){BULKRUN.msg(e.message,true);});
      };
      fr.readAsDataURL(f);
      return;
    }
    fr.onload=function(){$("bulkText").value=String(fr.result||"");refreshCount();};
    fr.readAsText(f);
  });
  refreshCount();
}

return {start:start};
})();
`;

module.exports = {
  renderBulkPageBody,
  renderBulkInlineBlock,
  renderBulkRunMarkup,
  BULK_CSS,
  BULK_RUN_CSS,
  BULK_JS,
  BULK_RUN_JS,
};
