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

// The /vault BODY. Everything around it — the doctype, the head, the header,
// the footer, the theme boot — is marketShell's, exactly as it is for
// /markets, /brokers, /firms, /pricing and /bulk. (Task 9 of the rail plan,
// 2026-08-30.)
//
// This file used to build a whole HTML document, and that is what made it the
// surface that drifted. Its header was a third hand-written copy of a nav list
// two other files already render. Its Escape script closed the dropdown and
// never stepped back, which every other page does. Its footer had no links in
// it until days ago. And ~34 lines of its stylesheet were chrome — .hdr,
// .brand, .wordmark, .hleft, the dropdown — that MARKET_CSS already defines.
// All of that is gone. What is left is the page.
//
// The stylesheet moved INTO the body, which is bulk-page.js's pattern and is
// load-bearing here rather than a matter of taste: marketShell emits
// MARKET_CSS in the head, and this page redefines body, a, .wrap, main.wrap,
// .card, .kicker, .ledger and .lcell — so its rules have to come AFTER that
// stylesheet in document order to win on equal specificity. marketShell's
// head parameter is emitted BEFORE MARKET_CSS and would lose.
//
// Still pure — a boot payload in, a string out — which is what lets the whole
// page be rendered and diffed with no database and no browser. It now takes
// NOTHING but that payload: the twelve-key chrome object it used to be handed
// (CN_LOGO, RAIL_CSS, ACCOUNT_NAV_*, FOOTER_*, THEME_*, NAV_SHELL_CLASS)
// existed only to rebuild by hand what marketShell already had.
function renderVaultBody(boot) {
  // </script> can never appear in the payload: every "<" is escaped, which is
  // also what keeps a comp note like "<img onerror=…>" inert inside the tag.
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<style>
*{box-sizing:border-box}
:root{
  --serif:Georgia,'Times New Roman',serif;
  --r:6px;
  --t1:34px;--t2:20px;--t3:15px;--t4:14px;--t5:12.5px;--t6:11px;
  --s1:2px;--s2:4px;--s3:8px;--s4:12px;--s5:16px;--s6:24px;--s7:32px;--s8:48px;--s9:80px;
  --shadow:0 1px 2px rgba(26,36,51,.04),0 8px 24px rgba(26,36,51,.04);
}
/* .hide must sit above every later rule that sets display, or a more
   specific display:flex/grid on .deck/.strip/.ledger beats it and a hidden
   block still paints. .deck.hide and .strip.hide restated below are the
   cascade trap Direction U documented. */
.hide{display:none}
body{margin:0;background:var(--paper);color:var(--ink);line-height:1.6;min-height:100vh;
  display:flex;flex-direction:column;font-size:var(--t4);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--red);text-decoration:none}a:hover{color:var(--red-deep)}
/* .wrap is redefined rather than inherited: MARKET_CSS pads it 0 16px and
   this page has always used its own --s6 (24px) gutter. Later in document
   order, same specificity, so this wins -- which is the whole reason the
   stylesheet is emitted in the body. */
.wrap{max-width:1120px;margin:0 auto;padding:0 var(--s6);width:100%}
/* The header, the brand lockup, the nav and the dropdown used to be redeclared
   here -- ~34 lines of chrome in a file whose own comments argue that copies
   are what drift. MARKET_CSS owns all of it now, and marketBar owns the markup.
   The .cn-logo dark-mode override went with them for the same reason.

   What has to stay is this one rule. marketShell wraps the body in a single
   main.wrap element, where this page used to have a main around a separate
   wrap div -- so the vertical padding, which lived on the element selector,
   would now lose to .wrap's own padding shorthand on the very same element.
   MARKET_CSS states its own values the identical way
   (main.wrap{flex:1;padding-top:32px;padding-bottom:64px}); these are the
   vault's, unchanged, so the fold moves nothing on screen.
   No literal tag syntax in here: this comment ships inside the stylesheet, and
   the served page is counted for exactly one of each landmark element. */
main.wrap{flex:1;padding-top:40px;padding-bottom:72px}
.kicker{margin:0 0 var(--s3);font-size:var(--t6);font-weight:600;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink-3)}
h1.h{font-family:var(--serif);font-weight:500;margin:0;font-size:var(--t1);line-height:1.12;
  letter-spacing:-.02em}
.sub{color:var(--ink-2);max-width:54ch;margin:var(--s4) 0 0;font-size:15px;line-height:1.55}
/* The trust line. A broker does not hand over their book of business because
   our terms promise we cannot read it — they do it because they can watch this
   number stay at zero. It is deliberately the most prominent thing on the page
   after the title. */
/* The book ledger (approved as "Vault A", 2026-08-08): the report hero's
   ruled-cell geometry applied to the trust line. Green is spent on exactly
   one cell — Published — because zero staying zero is the number this page
   exists to prove. */
.trust{margin:var(--s7) 0 0}
/* margin, flex, min-width and border-right are stated here because MARKET_CSS
   declares .ledger and .lcell too — a DIFFERENT component that happens to share
   the name (a flex row of bordered-right cells with a 22px margin, where this
   is a grid of bordered-left ones). Since 2026-08-30 this page is rendered
   inside marketShell, so that stylesheet is on the document: any property this
   rule leaves unset falls through to it. test/vault-shell.test.js computes the
   full set and fails the build on a new one. */
.ledger{border:1px solid var(--edge);border-top:2px solid var(--ink);border-radius:var(--r);
  background:var(--card);display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden;
  margin:0;box-shadow:var(--shadow),var(--lift)}
.lcell{padding:18px 20px;border-left:1px solid var(--hair);border-right:0;flex:0 1 auto;min-width:auto}
.lcell:first-child{border-left:0}
/* #F7FBF8 is the redesign's published-cell green wash; folded to --ok-bg
   (ΔRGB ~20, within the approved 25 bound) so the cell stays green in both
   themes instead of flattening to --wash. */
.lcell.mid{background:var(--ok-bg)}
.llab{display:block;font-size:var(--t6);letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;margin-bottom:6px}
.lcell.mid .llab{color:var(--green)}
.lfig{font-family:var(--serif);font-weight:500;letter-spacing:-.02em;font-size:28px;
  line-height:1.15;color:var(--ink);font-variant-numeric:tabular-nums}
.lcell.mid .lfig{color:var(--green)}
.lsub{color:var(--ink-3);font-size:var(--t5);margin-top:4px}
/* Exactly four cells, so the 2x2 wrap can place its dividers by position. */
@media (max-width:640px){
  .ledger{grid-template-columns:1fr 1fr}
  .lcell{border-left:0;padding:16px}
  .lcell:nth-child(even){border-left:1px solid var(--hair)}
  .lcell:nth-child(-n+2){border-bottom:1px solid var(--hair)}
}
.trust .note{color:var(--ink-3);font-size:var(--t5);margin:var(--s4) 0 0;max-width:62ch}
#creditLine{margin-top:var(--s3)}
#creditLine strong{color:var(--ink);font-weight:600}
#idForm{margin-top:var(--s4);padding:18px 20px;border:1px solid var(--edge);border-radius:var(--r);
  background:var(--card);box-shadow:var(--shadow),var(--lift)}
section{margin-top:var(--s8)}
section+section{border-top:1px solid var(--line);padding-top:var(--s7)}
h2{font-family:var(--serif);font-weight:500;font-size:var(--t2);margin:0 0 6px;letter-spacing:-.01em}
section > .sub{margin-top:0;margin-bottom:var(--s5)}
.drop{border:1px dashed var(--edge);border-radius:var(--r);padding:36px var(--s6);text-align:center;
  background:var(--card);transition:border-color .15s,background .15s,box-shadow .15s}
.drop.over{border-color:var(--red);border-style:solid;background:var(--err-bg);box-shadow:inset 0 0 0 1px var(--red)}
.drop-k{margin:0 0 var(--s4);font-family:var(--serif);font-size:17px;font-weight:500;color:var(--ink)}
.drop p{margin:var(--s4) 0 0;color:var(--ink-2);font-size:var(--t5)}
/* display is stated for the .ledger reason above. MARKET_CSS's .btn is an
   inline-block anchor; these are real <button>s, and the a.btn rule further
   down restores inline-block for the two that are links. */
.btn{background:var(--red-fill);color:#fff;border:0;border-radius:var(--r);padding:9px 16px;
  display:inline-block;font-weight:600;font-size:13.5px;font-family:inherit;cursor:pointer;line-height:1.3}
/* color is stated for the .ledger reason: MARKET_CSS's .btn:hover sets it too.
   Same value the button already has, so nothing moves -- but the leak test
   compares declarations, not outcomes, and a silent match today is a silent
   mismatch the day either file changes its red. */
.btn:hover{background:var(--red-fill-hover);color:#fff}
.btn[disabled]{background:var(--ink-4);cursor:default}
.btn.ghost{background:var(--card);color:var(--ink-2);border:1px solid var(--edge)}
.btn.ghost:hover{background:var(--wash);color:var(--ink);border-color:var(--ink-4)}
.row{display:flex;flex-wrap:wrap;gap:12px 14px;align-items:flex-end}
.form{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px 16px;align-items:end}
.form .span2{grid-column:1/-1}
.form .span-all{grid-column:1/-1}
.formact{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.form input,.form select{width:100%}
@media (min-width:720px){.form .span2{grid-column:span 2}}
#addTypeFields{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px 16px}
#covRow{align-items:center;margin-top:8px;gap:8px}
#covRow .empty{padding:4px 0;text-align:left}
.addpanel .tw,.mappanel .tw{box-shadow:none}
.row label,.form label{display:flex;flex-direction:column;gap:5px;font-size:var(--t6);letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-3);font-weight:600}
select,input[type=text],input[type=date]{padding:8px 10px;border:1px solid var(--edge);border-radius:var(--r);
  font-family:inherit;font-size:16px;background:var(--card);color:var(--ink);min-height:40px}
select:focus,input[type=text]:focus,input[type=date]:focus{outline:none;border-color:var(--ink);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--ink) 8%, transparent)}
/* 16px, not var(--t5): iOS Safari zooms on focus for any input under 16px
   and stays zoomed — on a data-entry page that means every filter tap. */
.filters{padding:14px 16px;margin-top:var(--s4);background:var(--card);border:1px solid var(--edge);
  border-radius:var(--r);align-items:flex-end}
.filters .btn{min-height:40px}
.filters .note{margin:0 0 10px;align-self:flex-end}
.filters input[type=search]{padding:8px 10px;border:1px solid var(--edge);border-radius:var(--r);
  font-family:inherit;font-size:14px;background:var(--card);color:var(--ink);min-height:40px;min-width:190px}
/* WebKit paints its own clear affordance inside the field; the box is already
   cleared by Escape and by Clear filters, and the native gutter clipped the
   placeholder on the market field once already (see the market page note). */
.filters input[type=search]::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.filters .exp{margin-left:auto}
/* font-variant-numeric is stated for the same reason .ledger states margin:
   MARKET_CSS is on this document now and sets tabular-nums on every table. The
   vault wants it on NUMERIC CELLS only (td.num below) -- lining figures across
   an address column widens the letterforms for nothing. The first-child rule
   below neutralises its 180px minimum, which squared this table's first
   column; the row rule is a border-BOTTOM here, so MARKET_CSS's border-top
   would draw both. */
table{width:100%;min-width:720px;border-collapse:collapse;font-size:13px;margin:0;
  font-variant-numeric:normal}
td:first-child,th:first-child{min-width:0}
/* Statement tables (approved as "Vault B", 2026-08-08): an ink rule closes
   every header on this page — the broker's own book of record earns the same
   audited-statement vocabulary the report's comp table shipped. */
th{text-align:left;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
  font-weight:600;padding:12px 14px;border-bottom:2px solid var(--ink);white-space:nowrap;background:var(--card)}
th[data-k],th[data-bk]{cursor:pointer}
th[data-k]:hover,th[data-bk]:hover{color:var(--ink)}
th .ar{color:var(--red)}
td{padding:12px 14px;border-top:0;border-bottom:1px solid var(--hair);vertical-align:top;color:var(--ink-body)}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tbody tr:hover td{background:var(--wash)}
.addr{color:var(--ink);font-weight:500}
.tag{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-2);background:var(--wash);border-radius:3px;padding:2px 7px}
/* The comps table seals with a median row under a double rule. The last body
   row's hairline is dropped explicitly: with collapsed borders two same-width
   rules at that boundary would otherwise fight, and which one wins is
   browser-defined — the ink top rule must never lose to a hairline. */
#tbl tbody tr:last-child td{border-bottom:0}
tfoot td{padding:12px 14px;border-top:1px solid var(--ink);
  border-bottom:3px double var(--ink);font-weight:600;color:var(--ink);background:var(--card)}
tfoot .lab{font-size:var(--t6);letter-spacing:.07em;text-transform:uppercase;color:var(--ink-2)}
/* Scrolling shadows, the same CSS-only pair the market pages' comps table
   uses (MARKET_CSS's .scroll). The comp table is ~1200px wide inside a
   ~1070px scroller on an ordinary laptop, and macOS
   draws no scrollbar until something is already scrolling, so the last two
   columns — Firm (the Share control that is the shared vault's ONLY entry
   point) and the trash — were off the right-hand edge with nothing on screen
   saying the table went any further. The two attachment:local layers are
   opaque card-coloured patches pinned to the content, so each edge shadow is
   covered while that end is in view and uncovered as it scrolls away: the
   hint appears only when there is really more to see, with no script and no
   scroll listener.

   The shade is --edge rather than the 13%-black literal this pair shipped
   with, because 13% black over a #1A2433 card is invisible and both pages
   have a dark theme. --edge is right in both directions by construction — it
   is the colour a border of this card already is, darker than the card in
   light and lighter in dark — and in light mode it lands within a hair of
   the literal it replaces. The patches need no such treatment: they are
   var(--card) already. Keep the two copies in step. */
.tw{overflow-x:auto;border:1px solid var(--edge);border-radius:var(--r);background:var(--card);
  margin-top:var(--s4);box-shadow:var(--shadow),var(--lift);
  background-image:linear-gradient(to right,var(--card),rgba(0,0,0,0)),linear-gradient(to left,var(--card),rgba(0,0,0,0)),
    radial-gradient(farthest-side at 0 50%,var(--edge),rgba(0,0,0,0)),radial-gradient(farthest-side at 100% 50%,var(--edge),rgba(0,0,0,0));
  background-position:left center,right center,left center,right center;
  background-repeat:no-repeat;
  background-size:28px 100%,28px 100%,13px 100%,13px 100%;
  background-attachment:local,local,scroll,scroll}
.msg{margin-top:var(--s4);padding:12px 16px;border-radius:var(--r);font-size:var(--t5);border:1px solid}
.msg.ok{background:var(--ok-bg);border-color:var(--ok-rule);color:var(--ok-text)}
.msg.bad{background:var(--err-bg);border-color:var(--err-rule);color:var(--err-text)}
#pdfTable tbody tr.need-fix td,#pdfTable tbody tr.need-fix:hover td{background:var(--err-bg)}
#pdfTable tbody tr.pdf-src td,#pdfTable tbody tr.pdf-src:hover td{padding-top:12px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);background:none;border-bottom:0}
.msg ul{margin:var(--s3) 0 0;padding-left:var(--s6)}
.msg li{margin-top:var(--s1);font-variant-numeric:tabular-nums}
#gate .msg{max-width:44ch;margin-top:var(--s7)}
.load{margin-top:var(--s7);max-width:420px}
.loadbar{height:3px;background:var(--hair);border-radius:2px;overflow:hidden;margin-bottom:var(--s4)}
.loadbar i{display:block;height:100%;width:38%;background:var(--red-fill);
  animation:load 1.15s ease-in-out infinite}
@keyframes load{0%{transform:translateX(-120%)}100%{transform:translateX(360%)}}
.empty{color:var(--ink-3);padding:36px 20px;text-align:center}
.fine{color:var(--ink-3);font-size:var(--t5);font-weight:400;letter-spacing:0;text-transform:none}
.up{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s4);
  padding:12px 0;border-bottom:1px solid var(--hair);font-size:var(--t5)}
.up:last-child{border-bottom:0}
.up .meta{color:var(--ink-3)}
/* Padding + offsetting negative margin: a real tap target on the one control
   that DELETES an import, without moving the row's baseline layout. */
.up button{background:none;border:0;color:var(--ink-3);cursor:pointer;font-family:inherit;font-size:var(--t5);
  padding:var(--s3) var(--s3);margin:calc(-1 * var(--s3)) calc(-1 * var(--s3))}
.up button:hover{color:var(--red)}
/* Publish state as the statement's badge chip (Vault B): green tint only once
   published — the deliberate act, not the default. The tints are the report
   table's own Verified-badge pair, so one green means one thing site-wide. */
.pubbtn{background:var(--card);border:1px solid var(--edge);border-radius:4px;padding:5px 10px;
  font-family:inherit;font-size:var(--t6);font-weight:600;line-height:1.4;color:var(--ink-2);
  cursor:pointer;white-space:nowrap}
.pubbtn:hover{border-color:var(--ink-3);color:var(--ink)}
.pubbtn.on{border-color:transparent;background:var(--ok-bg);color:var(--ok-text)}
.pubbtn[disabled]{opacity:.5;cursor:default}
/* A result, not a control: no border, no hover, and the same quiet ink the
   row's other secondary figures use. */
.cites{display:inline-block;margin-left:6px;color:var(--ink-3);font-size:12px;
  font-weight:600;font-variant-numeric:tabular-nums;cursor:default}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--edge);border-radius:999px;
  padding:5px 8px 5px 12px;font-size:12.5px;background:var(--card);color:var(--ink-2);font-weight:600;
  letter-spacing:0;text-transform:none}
.chip button{background:none;border:0;color:var(--ink-3);cursor:pointer;font-size:16px;line-height:1;
  padding:0 2px;font-family:inherit}
.chip button:hover{color:var(--red)}
/* Quieter than the market it qualifies: it is a footnote on the chip, not a
   second fact competing with the market name. */
.chip .near{margin-left:6px;color:var(--ink-3);font-weight:500;font-size:11.5px;letter-spacing:.02em}
/* Row actions: Delete is a trash icon — quiet ink that goes red on hover, the
   same pattern as removing an import. A red "Delete" word next to Publish was
   a second shout on the row. Edit used to sit beside it as a text link; the
   cells are typed into directly now, so the row's only control is the trash. */
.lnk{background:none;border:0;padding:0;font-family:inherit;font-size:inherit;
  color:var(--ink-3);cursor:pointer;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.lnk:hover{color:var(--ink)}
.lnk.trash{text-decoration:none;padding:8px;margin:-8px 0 -8px 2px;
  display:inline-flex;align-items:center;justify-content:center;line-height:0;
  color:var(--ink-3)}
.lnk.trash:hover,.lnk.trash:focus{color:var(--red)}
.lnk.trash svg{display:block}
td.rowact{white-space:nowrap}
/* Addresses in the properties table. a{} paints this page's links red, and a
   column of red rows reads as a list of warnings -- red is this page's accent
   and is spent on the one thing that matters per surface. Ink at rest, red on
   hover, which is the desk's rule for the same table stated in this page's
   own tokens. Inter, not the desk's Georgia: every other table here is Inter,
   and consistency within one page beats consistency with another one. */
.paddr{color:var(--ink);font-weight:500}
.paddr:hover,.paddr:focus{color:var(--red)}
/* Editable cells in the compact table. There is no Edit button: a broker
   fixing a typo types over it, exactly as they would in the spreadsheet they
   exported this book from.
   Borderless at rest, because the table is a statement about a book of
   business first and a form second — a grid of ten visible input boxes per
   row reads as data entry and buries the numbers. The edge appears on hover
   and focus, which is where the affordance lives. Keep this input's font
   inherited: a cell that changes size or weight when touched makes the whole
   row jump, and the row is what the broker is reading. */
#tbl input.cell{width:100%;box-sizing:border-box;border:1px solid transparent;border-radius:var(--r);
  padding:6px 8px;margin:-6px -8px;font-family:inherit;font-size:inherit;line-height:inherit;
  font-weight:inherit;letter-spacing:inherit;
  background:transparent;color:inherit;min-height:34px}
#tbl input.cell:hover{border-color:var(--edge)}
#tbl input.cell:focus{border-color:var(--ink-3);background:var(--card);outline:none}
#tbl td.num input.cell{text-align:right}
/* Save state rides on the input, never on a re-render: rebuilding the table
   on every blur would steal the focus the broker just Tabbed into. Shared
   with spreadsheet mode below, which is the same save on the same PATCH. */
#tbl input.cell.saving{opacity:.65}
#tbl input.cell.err{border-color:var(--red);background:var(--err-bg)}
#tbl input.cell.saved{border-color:var(--ok-rule)}
/* Derived, and so never typed into: market is parsed from the address by the
   server (it has to agree byte for byte with comp_corpus.market) and $/SF is
   computed for priced sales only. Both are refreshed from the server's own
   saved row after an edit rather than recomputed here. */
#tbl td.ro{color:var(--ink-2)}
/* Spreadsheet mode: the uploaded book, as a grid. Cells are real inputs so
   Tab/Enter move the way they do in Excel; a saving/error state rides on
   the input rather than replacing the row, because rebuilding the table
   on every blur would steal the next cell's focus. */
#tbl.sheet td{padding:4px 6px;vertical-align:middle}
#tbl.sheet th{padding:10px 8px}
#tbl.sheet input[type=text]{width:100%;min-width:4.5rem;padding:7px 8px;border:1px solid var(--edge);
  border-radius:var(--r);font-family:inherit;font-size:13px;background:var(--card);color:var(--ink);
  min-height:36px}
#tbl.sheet input.saving{opacity:.65}
#tbl.sheet input.err{border-color:var(--red);background:var(--err-bg)}
#tbl.sheet input.saved{border-color:var(--ok-rule)}
#sheetBar{margin:var(--s4) 0 0}
/* ---- The market rollup: the page's lead view ----------------------------
   A broker with 400 comps learns nothing from 400 rows. This is the index to
   their own book: one card per market + property type, which is the same pair
   their lead coverage is keyed on, so the two sections describe the world the
   same way. Whole-book always, never narrowed by the filter below it: it is
   the map, and a map that hides everything but your current street is not a
   map. Clicking one drives the filter instead. */
.cards{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
/* margin:0 for the .ledger reason above — MARKET_CSS's .card is a 22px-padded
   article card with an 18px vertical margin, this is a compact clickable tile. */
.card{border:1px solid var(--edge);border-radius:var(--r);background:var(--card);padding:16px 18px;
  text-align:left;font-family:inherit;font-size:var(--t5);color:var(--ink);cursor:pointer;
  display:flex;flex-direction:column;gap:2px;margin:0;transition:border-color .15s,background .15s,box-shadow .15s;
  box-shadow:var(--shadow),var(--lift)}
.card:hover{border-color:var(--ink-4);background:var(--card)}
.card.on{border-color:var(--red);background:var(--card);box-shadow:inset 0 0 0 1px var(--red),var(--shadow),var(--lift)}
.card .mk{font-weight:600;font-size:15px;line-height:1.3;color:var(--ink)}
.card .ty{color:var(--ink-3);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600}
.card .big{font-family:var(--serif);font-size:22px;font-weight:500;margin-top:8px;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.card .big span{font-family:Inter,system-ui,sans-serif;font-size:var(--t5);color:var(--ink-3);
  letter-spacing:0;margin-left:6px}
.card .fine{color:var(--ink-3);font-size:var(--t6);font-weight:400;letter-spacing:0;text-transform:none}
.card .fine.pub{color:var(--green);font-weight:600}
.card.stat{cursor:default;box-shadow:none}
.card.stat:hover{border-color:var(--edge);background:var(--card)}
#bovCards{margin-top:var(--s4)}
/* ---- Chart + repeat-property blocks ---- */
/* Capped at the viewBox width so one SVG unit is one CSS pixel: the columns
   are drawn at a 24px maximum, and letting the chart stretch to a 1120px
   container would render them at ~40px, which is the heavy-saturated-block
   look the rest of this page avoids. Below 600px it scales down as normal. */
.chart svg{display:block;width:100%;max-width:600px;height:auto}
/* The year chart is generated SVG (renderChart, further down this file), not
   markup here -- so these classes are the only place its colours live now.
   Fixed 2026-08-10 fix round 2: they used to be inline fill/stroke hex on
   the generated elements, which is invisible to the raw-hex regression test
   (that test only scans THIS block) and, worse, a presentation ATTRIBUTE
   like fill="var(--ink)" is not reliably honoured -- only a stylesheet rule
   or a style="" attribute is. Putting them here is what makes the endpoint
   label (the one number this panel exists to show) actually themed instead
   of staying ink-on-white at 1.14:1 against a dark card. */
.chart-grid{stroke:var(--line)}
.chart-axis{fill:var(--ink-3)}
.chart-bar{fill:var(--ink-mute)}
.chart-bar.hi{fill:var(--red-fill)}
.chart-endpoint{fill:var(--ink)}
.rep{border-top:1px solid var(--hair);padding:10px 0;font-size:var(--t5)}
.rep:first-child{border-top:0;padding-top:0}
.rep .addr{font-weight:600}
.rep .deal{color:var(--ink-2);font-variant-numeric:tabular-nums;font-size:13px;margin-top:2px}
.note{color:var(--ink-3);font-size:var(--t5)}
/* ---- Gut check ----------------------------------------------------------
   Verdict chips stay in the page's existing voice: the pubbtn border style,
   ink for facts, green only for "in line" (the calm state), never red for a
   divergence — above/below is "worth a look", not an error. */
.gc{border:1px solid var(--edge);border-radius:var(--r);background:var(--card);
  padding:16px 18px;font-size:var(--t5);display:flex;
  flex-direction:column;gap:4px;box-shadow:var(--shadow),var(--lift)}
.gc .mk{font-weight:600;font-size:15px}
.gc .ty{color:var(--ink-3);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600}
.gcv{display:inline-block;border:1px solid var(--edge);border-radius:999px;
  padding:2px 10px;font-size:var(--t6);color:var(--ink-2);font-weight:600;
  align-self:flex-start;margin-top:6px}
.gcv.ok{border-color:var(--ok-rule);background:var(--ok-bg);color:var(--green)}
.gc .fine{color:var(--ink-3);font-size:var(--t6)}
.gcOut{display:inline-block;margin-left:var(--s2);font-size:10px;
  letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);
  border-bottom:1px dotted var(--ink-3);cursor:help}
/* ---- Empty invitations ---------------------------------------------------
   The empty vault is the real vault: both decks show, and each empty body
   is a short invitation rather than a numbered onboarding page. Quiet on
   purpose — same type as the rest of the workspace, no panel, no 1/2. */
.invite{margin:8px 0 var(--s6);max-width:36em}
.invite > p{margin:0 0 var(--s4);color:var(--ink-2)}
.invite details{margin:0 0 var(--s4)}
.invite details summary{cursor:pointer;color:var(--ink-3);font-size:var(--t5);user-select:none;list-style-position:inside}
.invite details summary:hover{color:var(--ink-2)}
.invite details .fine{margin:var(--s3) 0 0;color:var(--ink-3);font-size:var(--t5)}
/* The template link is an <a> styled as a button, so it needs the same box the
   <button>s get — .btn alone leaves it inline and underlined. */
a.btn{display:inline-block;text-decoration:none;color:#fff}
a.btn:hover{color:#fff}
a.btn.ghost{color:var(--ink-2)}
a.btn.ghost:hover{color:var(--ink)}
/* ---- Deck rules (Vault Direction U, approved 2026-08-10) -----------------
   This page is two products sharing one scroll: the book a broker keeps, and
   the pipeline they work. As ten peer sections every heading was the same
   19px serif over the same hairline, so nothing said where one ended and the
   other began, and the uploader carried the same weight as 200 comps. A deck
   rule is the level ABOVE h2 — serif label, ink rule, and the deck's one
   action on the right — and there are exactly two of them.
   (No backticks in this file's comments: the whole page is one template
   literal, so a backtick here ends it and the module stops parsing.) */
.deck{display:flex;align-items:baseline;gap:var(--s4);margin:56px 0 0}
/* Load-bearing, and the reason is pure cascade order: .hide is declared far
   above this block, so a later single-class rule that sets display BEATS it.
   Without this line applyFirstRun's "deck hide" leaves a stray "Your book"
   rule across the top of an empty vault — verified in a browser, not
   reasoned about. Same trap, same fix, on .strip below. */
.deck.hide{display:none}
.dlab{font-family:var(--serif);font-weight:500;font-size:22px;white-space:nowrap;letter-spacing:-.015em}
.dln{flex:1;height:0;border-top:2px solid var(--ink);transform:translateY(-6px)}
.dact{background:var(--card);border:1px solid var(--red);border-radius:var(--r);padding:6px 12px;
  font-family:inherit;font-size:13px;font-weight:600;color:var(--red);cursor:pointer;white-space:nowrap}
.dact:hover{background:var(--red-fill);color:#fff}
/* The uploader and the column mapper stopped being sections when they moved
   under the book deck: a section would draw the section+section divider, and
   both of these are transient panels that a returning broker opens on
   purpose. Being divs also means the sections after them are never "a section
   after a hidden section", which is what the two adjacency patches this
   replaced were for. */
.addpanel,.mappanel{margin-top:var(--s5);padding:20px;border:1px solid var(--edge);border-radius:var(--r);
  background:var(--card);box-shadow:var(--shadow),var(--lift)}
.mappanel h2{margin-bottom:var(--s3)}
#mapTable td:first-child{font-weight:500;color:var(--ink)}
#mapTable select{width:100%;min-width:160px}
.samp{display:inline-block;background:var(--wash);border-radius:3px;padding:2px 7px;
  margin:0 4px 4px 0;font-size:11px;color:var(--ink-2);line-height:1.4}
.mapact{margin-top:var(--s5);padding-top:var(--s4);border-top:1px solid var(--hair)}
/* The one hidden-sibling pair left. #rollupSec hides itself when the book has
   no markets to roll up, and the divider above #compsSec would then be drawn
   under nothing. Scoped to this pair on purpose, exactly like the two rules
   this replaced: a blanket hidden-sibling rule would also strip the divider
   above BOV, where the section above it is always visible. */
#rollupSec.hide + #compsSec{border-top:0;padding-top:0}
/* ---- The reading strip --------------------------------------------------
   Gut check, the year chart and the repeat-property list used to be three
   bordered panels between the filter row and the comps, so roughly 260px of
   analysis stood in front of the data being analysed. Their three headline
   figures come up here in the trust line's own ledger geometry, and each cell
   opens the full panel it summarises. Nothing was deleted; it stopped being
   mandatory reading. */
.strip{border:1px solid var(--edge);border-radius:var(--r);background:var(--card);
  display:grid;grid-template-columns:repeat(3,1fr);overflow:hidden;margin-top:var(--s4);
  box-shadow:var(--shadow),var(--lift)}
/* The pipeline's strip is five stages wide. Declared after .strip so it wins
   the column count, and BEFORE .strip.hide so hiding still beats it. */
.strip.s5{grid-template-columns:repeat(5,1fr)}
.strip.hide{display:none}   /* see the .deck.hide note above */
.scell{padding:16px 18px;border:0;border-left:1px solid var(--hair);
  background:none;font-family:inherit;text-align:left;color:inherit}
.scell:first-child{border-left:0}
.scell.act{cursor:pointer}
.scell.act:hover{background:var(--wash)}
.slab{display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;margin-bottom:6px}
.sfig{font-family:var(--serif);font-weight:500;font-size:24px;line-height:1.15;color:var(--ink);
  letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.sfig.ok{color:var(--green)}
.ssub{color:var(--ink-3);font-size:var(--t5);margin-top:4px}
.scell.act .ssub{color:var(--red)}
@media (max-width:640px){
  .strip{grid-template-columns:1fr}
  .scell{border-left:0;border-top:1px solid var(--hair)}
  .scell:first-child{border-top:0}
  .filters .exp{margin-left:0}
  h1.h{font-size:28px}
}
/* The three panels the strip summarises, collapsed. A details/summary carries
   its own open state, so the strip only has to set .open — there is no second
   copy of "is this panel showing" to drift. */
/* A lead's stage. A CHIP, never a select: New is not a status a broker can
   move a lead into or out of from here — the only move is requesting an
   introduction, which is the row's own action. The green .pubbtn.on is
   deliberately not reused; that means "published", a public claim. */
.stg{display:inline-block;font-size:var(--t6);letter-spacing:.08em;text-transform:uppercase;
  font-weight:600;color:var(--ink-2);background:var(--wash);border:1px solid var(--edge);
  border-radius:3px;padding:3px 7px;white-space:nowrap}
.dbox{border:1px solid var(--edge);border-radius:var(--r);background:var(--card);
  padding:12px 18px;margin-top:var(--s4);box-shadow:var(--shadow),var(--lift)}
.dbox>summary{cursor:pointer;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;user-select:none;list-style-position:inside}
.dbox>summary:hover{color:var(--ink)}
.dbox[open]>summary{margin-bottom:var(--s4);color:var(--ink)}
/* The footer is MARKET_FOOTER's now, and so are its rules: the four this file
   used to declare, the shared link columns, the dark ink, the account-nav
   block and the rail all arrive with MARKET_CSS. This page's own prose
   footer -- and the four-lines-and-no-links dead end it had been -- is gone.
   Its privacy sentence stayed, as the page's own closing line. */
.vfoot{color:var(--ink-3);font-size:var(--t5);margin:var(--s8) 0 0;max-width:62ch}
</style>
  <p class="kicker">Private workspace</p>
  <h1 class="h">Broker Vault</h1>
  <p class="sub" id="deckSub">Closed deals, leads, and BOVs. Visible only to you.</p>

  <!-- Visible from the first paint. Everything below the title waits on
       /api/vault (session -> entitlements -> two reads), and with both panes
       hidden the page spent that window looking half-rendered before the
       workspace popped in. The fetch's three outcomes each replace this:
       success hides #gate, a refusal rewrites it, so it can never linger. -->
  <div id="gate"><div class="load"><div class="loadbar"><i></i></div>
    <p class="empty" style="padding:0">Loading your vault&hellip;</p></div></div>

  <div id="app" class="hide">
    <!-- Shown in place of the three decks that ARE the vault -- the book, the
         pipeline, the hubs -- when this page's own read refuses. The other two
         decks below it ("Your properties", "Your watchlist") are a member's own
         portfolio and watchlist, which moved here off /desk on 2026-09-01 and
         were never part of Pro, so they render regardless. A member must not
         open their own space and find their own saved properties behind a
         paywall.

         "Part of Pro", never "part of the broker plan". There is one
         subscription and the vault is a capability of it; naming a broker plan
         sends somebody off to look for a product that cannot be bought. This
         string is one of three that have to agree -- the other two are the Pro
         tile's bullets and the plan-card copy in index.html. -->
    <div id="vaultLocked" class="invite hide">
      <p><strong>Your book, your pipeline and your hubs are part of Pro.</strong>
        Upload closed deals, keep them private, and see them inside your own reports.</p>
      <p>Your properties and your watchlist are below either way &mdash; those are yours.</p>
      <p style="margin:0"><a class="btn" href="/desk">See your plan</a></p>
    </div>
    <!-- The trust line's job is to prove a number stays at zero, including
         on day one. Hidden until 2026-08-13 because a 0-0 scoreboard over
         numbered onboarding cards read as broken; the empty vault is now
         the real workspace, so the zeros are the honest empty state.
         Privacy copy is restated here AND in #bookEmpty's disclosure AND
         at publish. See applyFirstRun(). -->
    <div class="trust" id="trustLine">
      <div class="ledger">
        <div class="lcell"><span class="llab">Comps</span>
          <div class="lfig" id="cCount">0</div><div class="lsub" id="cImports"></div></div>
        <div class="lcell"><span class="llab">Priced sales</span>
          <div class="lfig" id="cPriced">0</div><div class="lsub" id="cPricedPct"></div></div>
        <div class="lcell"><span class="llab">Median $/SF</span>
          <div class="lfig" id="cMed">&mdash;</div><div class="lsub" id="cMedSub">sales only</div></div>
        <div class="lcell mid"><span class="llab">Published</span>
          <div class="lfig" id="cPub">0</div><div class="lsub" id="cPubSub">only if you choose it</div></div>
      </div>
      <!-- Rewritten by renderFirmPrivacy() the moment a comp is shared with a
           firm (migration 032). The default text is the promise this whole
           tier rests on, so it is in the markup rather than built in JS: a
           page whose script failed must still make the true statement, not
           no statement. -->
      <p class="note" id="trustNote">Visible only to you. Nothing here is ever read into CompNinja&rsquo;s
        public records, and nothing is published unless you choose it.</p>
      <!-- The credit identity, stated once and shown BEFORE any publish.
           It sits with the trust line because it answers the same question
           that line does — what leaves here, and under whose name — and
           because it is meaningless until there is a book to publish from.
           #creditLine is written by renderIdentity() from the server's own
           creditedTo, never assembled here, so the page cannot promise a
           name the publish route would not actually use. -->
      <p class="note" id="creditLine"></p>
      <div id="idForm" class="hide">
        <div class="form">
          <label>Firm <input id="idCompany" type="text" placeholder="Hawkins Ridge CRE" maxlength="60"/></label>
          <label>Your name <input id="idName" type="text" placeholder="optional" maxlength="60"/></label>
          <label>License number <input id="idLicense" type="text" placeholder="01899123" maxlength="60"/></label>
          <div class="formact">
            <button class="btn" id="idSave">Save</button>
            <button class="btn ghost" id="idCancel">Cancel</button>
          </div>
        </div>
        <p class="fine" style="margin-top:var(--s3)">Published comps are credited to your firm
          when you have one, otherwise to your name. This is not a public listing &mdash; it only
          names the credit on comps you choose to publish.</p>
        <p class="fine">Your license number is required to publish, because the Verified badge on a
          published comp tells a reader that a licensed broker vouched for the deal. It is never
          shown to anyone: it backs that badge rather than appearing beside it.</p>
        <p class="msg bad hide" id="idMsg"></p>
      </div>
    </div>
    <p id="trunc" class="note hide" style="margin-top:var(--s3)">Showing the most recent 1,000 comps.
      The figures below are drawn from those, so your full book may be larger.</p>


    <!-- ------------------------------------------------------------------
         The book deck. Everything from here to the pipeline rule is the
         broker's own data: what they have, and where it came from.

         "Add comps" used to be a full section ABOVE the comps table, so a
         broker with 200 comps opened their book and was shown an uploader
         first. It is the deck's action now, and the panel opens on click (or
         on dragging a file anywhere over the page). An empty book is still
         this deck: #bookEmpty is the body until a comp or import lands.
         ------------------------------------------------------------------ -->
    <div class="deck" id="deckBook">
      <span class="dlab">Your book</span><span class="dln"></span>
      <button class="dact" id="addToggle" aria-expanded="false" aria-controls="addSec">+ Add comps</button>
    </div>

    <div id="bookEmpty" class="invite">
      <p>Upload closed deals. They appear in your reports and stay private.</p>
      <details>
        <summary>Required columns &amp; privacy details</summary>
        <p class="fine">Four columns are required: address, property type, sale or
          lease, and the date. Everything else is optional, so undisclosed deals
          still count.</p>
        <p class="fine">Your comps are never read into CompNinja&rsquo;s public
          records, never included in an export or a shared link, and never shown
          to another broker.</p>
        <p class="fine">A PDF or screenshot is sent to our extract vendor to read the table. CompNinja does not store the file. Rows land in your vault only after you confirm.</p>
      </details>
      <div class="row">
        <a class="btn" href="/api/vault/template" id="frTpl">Download the template</a>
        <button class="btn ghost" id="bookPick">Choose a spreadsheet, PDF or screenshot</button>
      </div>
    </div>

    <div id="addSec" class="addpanel hide">
      <div class="drop" id="drop">
        <p class="drop-k">Import a spreadsheet, PDF or screenshot</p>
        <button class="btn" id="pick">Choose a spreadsheet, PDF or screenshot</button>
        <p>or drop files here &mdash; several at once is fine &middot; <a href="/api/vault/template" id="tpl">download the template</a></p>
        <p class="fine">A PDF or screenshot is sent to our extract vendor to read the table. CompNinja does not store the file. Rows land in your vault only after you confirm.</p>
        <input type="file" id="file" accept=".csv,.pdf,.png,.jpg,.jpeg,.webp,text/csv,application/pdf,image/png,image/jpeg,image/webp" multiple class="hide"/>
      </div>
      <div id="res"></div>

      <!-- One comp at a time, through the SAME route the importer's own rows
           land on (POST /api/vault/comp -> normalizeRow), so a hand-typed
           comp is held to the exact rules a CSV row is: same required
           fields, same number parsing, same duplicate check. Collapsed by
           default beside the uploader — most brokers get here with a
           spreadsheet, and this is the fallback for the one comp that
           isn't in one. -->
      <details class="dbox" id="addOneSec">
        <summary>Or add one comp by hand</summary>
        <div class="form" style="margin-top:var(--s4)">
          <label class="span2">Address <input id="addComp_address" type="text"/></label>
          <label>Type <select id="addComp_property_type"></select></label>
          <label>Sale/lease <select id="addComp_transaction">
            <option value="sale">Sale</option>
            <option value="lease">Lease</option>
          </select></label>
          <label>Date <input id="addComp_deal_date" type="date"/></label>
          <label>Price <input id="addComp_price" type="text"/></label>
          <label>Size (SF) <input id="addComp_size_sqft" type="text"/></label>
          <label>Cap rate <input id="addComp_cap_rate" type="text" placeholder="optional"/></label>
          <label title="Who occupies the building: Single tenant, Multi-tenant or Owner-user. Optional.">Tenancy <input id="addComp_tenancy" type="text" placeholder="Single tenant, Multi-tenant or Owner-user"/></label>
          <label>Year built <input id="addComp_year_built" type="text" placeholder="optional"/></label>
          <label class="span-all">Notes <input id="addComp_notes" type="text" placeholder="optional"/></label>
          <!-- Spelled out (2026-09-02): "Lat" and "Lng" were the question. -->
          <label title="Latitude in decimal degrees. Optional; with longitude, it keeps this address off third-party geocoders.">Latitude <input id="addComp_lat" type="text" placeholder="43.6187 (optional)"/></label>
          <label title="Longitude in decimal degrees. Optional; with latitude, it keeps this address off third-party geocoders.">Longitude <input id="addComp_lng" type="text" placeholder="-116.2146 (optional)"/></label>
          <div class="span-all" id="addTypeFields"></div>
          <div class="formact span-all">
            <button class="btn" id="addCompBtn" type="button">Add comp</button>
          </div>
        </div>
        <!-- Its own message, NOT #compMsg. #compMsg sits at the top of
             #compsSec, well below this panel in document order — for a
             broker who already has a book, the market rollup and gut-check
             cards render in between, so a message written there can land
             out of view of the button that was just clicked, with no
             scroll and nothing on screen to say the click did anything.
             aria-live announces it without moving focus. -->
        <p id="addCompMsg" class="msg hide" aria-live="polite"></p>
      </details>
    </div>

    <div id="mapSec" class="mappanel hide">
      <h2>Match your columns</h2>
      <p class="sub" style="margin-top:0">We found <span id="mapRows">0</span> rows.
        Tell us which of your columns is which, then import. Nothing is saved until you do.</p>
      <p class="note hide" id="mapAmbig"></p>
      <div class="tw"><table id="mapTable">
        <thead><tr><th>Your column</th><th>Maps to</th><th>Sample values</th></tr></thead>
        <tbody id="mapBody"></tbody>
      </table></div>
      <p class="note" id="mapIgnored"></p>
      <!-- The whole-file answers. A developer's or owner-operator's own sheet
           names no property type and no deal type anywhere, because every row
           is the one thing they build and nobody writes that down. Shown only
           for a required field no column is giving us, with nothing chosen:
           a pre-selected "Industrial" would stamp forty rows on a guess, and
           the rows most likely to be wrong are the ones nobody would check.
           Same shape as #pdfBasisRow, for the same reason. -->
      <div id="mapConst" class="hide" style="margin:10px 0"></div>
      <p id="mapMsg" class="msg bad hide"></p>
      <div class="formact mapact">
        <button class="btn" id="mapGo">Import</button>
        <button class="btn ghost" id="mapCancel">Cancel</button>
      </div>
    </div>

    <div id="pdfSec" class="mappanel hide">
      <h2>Review these comps</h2>
      <p class="sub" style="margin-top:0"><span id="pdfCount">0</span> deals in <span id="pdfName"></span>.
        Uncheck any that aren't yours. Fix a cell if we misread it. Nothing is saved until you import.</p>
      <p class="note" id="pdfStrip"></p>
      <!-- The per-sheet rent basis (2026-08-29). Lease sheets routinely state
           a rate and never the word "annual" or "monthly" because within a
           market it goes without saying — measured at 4 refused rows in the
           2026-08-28 extraction verdict. The basis stays required per ROW
           (migration 029: a guess is 12x wrong), so the sheet-level answer is
           STAMPED into the rows where the broker can see it, cell by cell,
           and a hand-edited cell always wins. Rendered only when a row
           actually needs it — the Buy-button rule. No default, on purpose. -->
      <p class="note hide" id="pdfBasisRow">This sheet's rents are quoted
        <select id="pdfBasis" aria-label="Rent basis for this sheet">
          <option value="">choose…</option>
          <option value="annual">annually</option>
          <option value="monthly">monthly</option>
        </select>
        — filled into rows that don't say.
      </p>
      <div class="tw"><table id="pdfTable">
        <thead id="pdfHead"></thead>
        <tbody id="pdfBody"></tbody>
      </table></div>
      <p id="pdfMsg" class="msg bad hide"></p>
      <div class="row">
        <button class="btn" id="pdfGo">Import</button>
        <button class="btn ghost" id="pdfCancel">Cancel</button>
      </div>
    </div>

    <section id="rollupSec" class="hide">
      <h2>Your markets</h2>
      <div class="cards" id="rollup"></div>
    </section>

    <section id="compsSec">
      <h2>Your comps</h2>
      <!-- One filter row above everything it scopes: the chart, the repeat-
           property list and the table all read the same slice, so they can
           never disagree about which comps are on screen. The export sits
           here rather than inside the closed uploader, and its label says
           "all" on purpose: this row is a FILTER, and a button reading just
           "Export" beside a filtered view would leave a broker guessing
           whether it exports the slice on screen or the whole book. It does
           not: it always exports everything. It is a plain href, not a
           fetch, so the session cookie rides along and the download still
           works even if the page's own script has failed. -->
      <div class="row filters">
        <label>Market <select id="fMarket"><option value="">All</option></select></label>
        <label>Type <select id="fType"><option value="">All</option></select></label>
        <!-- Static options, unlike Market and Type: the vocabulary is the two
             values parseTransaction accepts and cannot grow from the data. It
             is also load-bearing rather than a convenience — a sale is priced
             in $/SF and a lease in $/SF/yr, so a view holding both has no
             single median to seal the table with, and this is how a broker
             resolves that into a figure. -->
        <label>Deal <select id="fTrans"><option value="">All</option><option value="sale">Sales</option><option value="lease">Leases</option></select></label>
        <!-- Shown only to a broker who is in a firm (apply() unhides it). The
             one question the Firm column could not answer: a broker could
             see THAT a comp was shared but could not ask what they have not
             pushed yet, which is exactly the question a vault that is "yours,
             pushed to the firm when you are comfortable" produces. One clause
             in view(), nothing on the wire: sharedIds is already here. -->
        <label id="fFirmLab" class="hide">Firm <select id="fFirm"><option value="">All</option><option value="shared">Shared with firm</option><option value="unshared">Not shared</option></select></label>
        <!-- Two dropdowns narrow to a SLICE of the book; this finds one deal
             in it. A broker hunting the Fairview comp among 400 rows had only
             scrolling, and the market/type pair they would have to guess at is
             exactly what they are trying to remember. Searches address and
             notes: the address is what they know, and notes is where the
             tenant name or the "sold with the adjacent parcel" detail lives. -->
        <label>Find <input type="search" id="fText" placeholder="address or note" autocomplete="off"/></label>
        <button class="btn ghost hide" id="fClear">Clear</button>
        <span class="note" id="shown"></span>
        <button class="btn ghost" type="button" id="sheetToggle">Open spreadsheet</button>
        <!-- Counts the UNPUBLISHED comps in the current view, and deliberately
             does not try to work out which of them are publishable: that rule
             is VAULT.canPublish on the server, and a second copy here is
             exactly the kind of pair this repo already carries warnings about.
             The server reports what it skipped and why. -->
        <button class="btn ghost hide" type="button" id="pubAll"></button>
        <!-- The push. refreshPublishAll's three rules verbatim: it counts the
             comps in the CURRENT VIEW that are not on the firm's shelf, it
             does not decide eligibility (firmCompPayload in blend-comps.js
             is the rule, and the route reports what it skipped and why), and
             it is hidden at zero rather than disabled. Only for a broker in a
             firm, and the label names the firm, because this is the one
             control whose entire meaning is who sees it. -->
        <button class="btn ghost hide" type="button" id="firmAll"></button>
        <a class="btn ghost exp" href="/api/vault/export.csv">Export all comps (CSV)</a>
      </div>
      <!-- Three readings, then the data. Each cell that has a panel behind it
           is a button that opens it; a cell with nothing behind it renders as
           a plain figure, so the affordance is never a lie. -->
      <div class="strip hide" id="readStrip"></div>
      <details class="dbox hide" id="gutBox">
        <summary>Gut check &middot; your numbers vs the market</summary>
        <div class="cards" id="gutCards"></div>
        <p class="note" id="gutNote"></p>
      </details>
      <details class="dbox chart hide" id="chartBox">
        <summary id="chartTitle">Median $/SF by year</summary>
        <div id="chartWrap"></div>
      </details>
      <details class="dbox hide" id="repBox">
        <summary>Properties you have more than one deal on</summary>
        <div id="repRows"></div>
      </details>
      <!-- #res, the obvious message target for a row action, lives inside
           #addSec, a panel that ships CLOSED — a message written there is
           invisible to a broker who never opened the uploader. Edit and
           Delete get their own target instead. -->
      <p id="compMsg" class="msg hide" aria-live="polite"></p>
      <p id="sheetBar" class="note hide"></p>
      <div class="tw"><table id="tbl">
        <thead id="tblHead"><tr>
          <th data-k="address">Address</th><th data-k="market">Market</th>
          <th data-k="property_type">Type</th><th data-k="transaction">Deal</th>
          <th data-k="deal_date">Date</th><th data-k="price" class="num">Price</th>
          <th data-k="size_sqft" class="num">Size</th><th data-k="price_per_sqft" class="num">$/SF</th>
          <th data-k="published">Public</th><th></th>
        </tr></thead><tbody id="tbody"></tbody><tfoot id="tblFoot"></tfoot>
      </table></div>
      <!-- "above" used to point at a section in plain view. The uploader is a
           closed panel now, so this names the control that opens it. -->
      <div class="empty hide" id="none">Nothing here yet. Use &ldquo;Add comps&rdquo; above to upload a spreadsheet, PDF or screenshot.</div>
      <!-- Imports is provenance for the table it now sits under, not a tenth
           peer section at the foot of the page. Collapsed, because the one
           thing a broker does here (remove an import) is rare and destructive,
           and the one thing it told them at a glance (how many files) is
           already on the ledger's Comps cell. -->
      <details class="dbox" id="importsSec">
        <summary>Imports</summary>
        <div id="ups"></div>
      </details>
    </section>

    <!-- ------------------------------------------------------------------
         Your properties, and Your watchlist. Moved off /desk on 2026-09-01
         ("Three Spaces"): the workspace is the FIRM's record, and a
         portfolio and a watchlist are yours, so they belong in the space
         that is yours.

         Three things are deliberately different from the desk versions.

         They are NOT gated on canUseVault. The page's own read -- the book,
         the pipeline, the hubs -- still is, and apply() locks those three
         decks alone. A member must never open their own space and find
         their own saved properties behind a paywall.

         A property row is a LINK to /?property=<id>, not a button that opens
         the report in place. The whole report engine lives in index.html;
         this page cannot render one, and a row that silently did nothing
         would be worse than a row that navigates. Refresh is the same door
         with &amp;refresh=1 on it, for the same reason: replaying a search
         needs the real form.

         And they are drawn in this page's own idiom -- .strip, .tw, table,
         .lnk -- never the desk's dk-* classes or its Tailwind utilities.
         tailwind.css is purged against index.html alone, so a utility used
         only in a server-side string silently stops styling.
         ------------------------------------------------------------------ -->
    <div class="deck" id="deckProps">
      <span class="dlab">Your properties</span><span class="dln"></span>
      <a class="dact" href="/">+ Run a report</a>
    </div>

    <section id="propsSec">
      <p class="sub hide" id="propsIntro" style="margin-top:0">The buildings you own or track.
        Each keeps the value from every report you have run on it. Only you can see this.</p>
      <div class="strip hide" id="propsStrip"></div>
      <p class="note hide" id="propsAttn"></p>
      <!-- The "Add to firm" door's answer (Three Spaces, slice 3). Its own
           line, not #propsErr: that one means the portfolio could not be
           read, and a building landing on the firm's board is not that. -->
      <p class="msg hide" id="propsMsg" aria-live="polite"></p>
      <!-- Two empty states, two elements, on purpose -- and the wording of the
           failure one is the desk's model: a bare "couldn't load" on a section
           holding saved work reads as data loss to the person most likely to
           be looking at it. What failed, then that nothing is gone. -->
      <div class="msg bad hide" id="propsErr">Couldn&rsquo;t load your properties just now.
        Nothing has been lost. Refresh in a moment.</div>
      <div class="invite hide" id="propsEmpty">
        <p>Nothing here yet. Your portfolio holds the properties you own. Run a report and
          use <strong>Save to portfolio</strong>, or add one from your recent searches.</p>
      </div>
      <div class="tw hide" id="propsWrap"><table id="propsTbl">
        <thead><tr id="propsHead"></tr></thead>
        <tbody id="propsRows"></tbody><tfoot id="propsFoot"></tfoot>
      </table></div>
    </section>

    <!-- ------------------------------------------------------------------
         Your watchlist. Same move, same rules.

         NOT "Your markets": that heading is already taken on this page by
         #rollupSec, which breaks a broker's own COMPS down by market, and
         #covBox's "Markets you watch" is a third thing again (the markets
         they want LEADS from). Three market-ish labels is what this page has
         and two of them are pre-existing; naming this one after either would
         put two identical headings on one screen meaning different things.

         The feed is
         read from /api/watchlist/feed, which gates ITEMISED comps on the
         plan but leaves the market-level figures (new count, median, trend)
         free, so a free member sees a real feed rather than a locked one.
         ------------------------------------------------------------------ -->
    <div class="deck" id="deckMarkets">
      <span class="dlab">Your watchlist</span><span class="dln"></span>
    </div>

    <section id="mktSec">
      <p class="sub hide" id="mktIntro" style="margin-top:0">Markets you follow for new deals.
        Comps other people search turn up here first.</p>
      <div class="form" id="watchForm" style="margin-top:var(--s4)">
        <label>City <input id="wCity" type="text" placeholder="Boise"/></label>
        <label>State <input id="wState" type="text" maxlength="2" placeholder="ID"/></label>
        <label>Type <select id="wType"></select></label>
        <div class="formact">
          <button class="btn" id="wAdd">Watch market</button>
        </div>
      </div>
      <div id="mktMsg"></div>
      <div class="msg bad hide" id="mktErr">Couldn&rsquo;t load your markets just now.
        Nothing has been lost. Refresh in a moment.</div>
      <div class="invite hide" id="mktEmpty">
        <p>You are not watching any markets yet. Add one above and new comps in it will show up here.</p>
      </div>
      <div id="mktRows"></div>
    </section>

    <!-- ------------------------------------------------------------------
         The pipeline deck: work coming IN, rather than work already done.
         ONE table, from a lead nobody has claimed through to won or lost —
         see docs/superpowers/specs/2026-08-13-vault-pipeline-deck-design.md.
         It used to be two sections, "Leads in your markets" and "BOV
         tracker", which described one flow with no shared structure: an
         intro request auto-creates the BOV row, so the same engagement sat
         in two tables 500px apart, repeating four columns, with nothing on
         screen connecting them.

         The rule now carries the deck's one action, like the book deck's
         "+ Add comps". An empty pipeline is still this deck: #pipeEmpty
         holds the watch-market form until a lead or BOV row arrives.
         ------------------------------------------------------------------ -->
    <div class="deck" id="deckPipe">
      <span class="dlab">Your pipeline</span><span class="dln"></span>
      <button class="dact" id="bovToggle" aria-expanded="false" aria-controls="bovAddSec">+ Log a BOV</button>
    </div>

    <!-- No h2: the deck rule above is the level ABOVE h2, and with one
         section under it a heading would only restate the rule. -->
    <section id="pipeSec">
      <p class="sub hide" id="pipeIntro" style="margin-top:0">Every engagement, from a property owner
        requesting a Broker Opinion of Value in a market you watch through to won or
        lost. Only you can see this.</p>
      <div class="strip s5 hide" id="pipeStrip"></div>
      <p class="note hide" id="pipeNote"></p>

      <!-- A panel, not a section, and it ships CLOSED — the same rule #addSec
           carries. #bovMsg lives INSIDE it for the same reason #res lives
           inside #addSec: a log that failed must not write its error into
           something invisible. -->
      <div id="bovAddSec" class="addpanel hide">
        <div class="form">
          <label>Market <input id="bovMarket" type="text" placeholder="City, ST" list="mktList"/></label>
          <label>Type <select id="bovType"></select></label>
          <label>Source <select id="bovSource">
            <option value="referral">Referral</option>
            <option value="repeat_client">Repeat client</option>
            <option value="other" selected>Other</option>
          </select></label>
          <label>Size (SF) <input id="bovSize" type="text"/></label>
          <label>Received <input id="bovDate" type="date"/></label>
          <label class="span2">Address <input id="bovAddr" type="text" placeholder="optional"/></label>
          <label class="span2">Notes <input id="bovNotes" type="text" placeholder="optional"/></label>
          <div class="formact span-all">
            <button class="btn" id="bovAdd">Log a BOV</button>
          </div>
        </div>
        <div id="bovMsg"></div>
      </div>

      <!-- Suggestions for both market inputs, from the markets this broker
           already watches or already holds comps in. A list, never a
           constraint: the next BOV may be in a market they have never
           touched, so free text still submits and the server stays the gate. -->
      <datalist id="mktList"></datalist>

      <div id="pipeMsg"></div>
      <div id="pipeEmpty" class="invite">
        <p>Watch a market to see owners requesting valuations. Nothing to upload.</p>
        <!-- The ONE market-adding form on the page. renderPipeline moves this
             node into #covBox once a lead or BOV exists. One node, relocated
             — never a second copy that would drift from the coverage rules. -->
        <div id="covForm">
          <div class="form">
            <label class="span2">Market <input id="covMarket" type="text" placeholder="City, ST" list="mktList"/></label>
            <label>Type <select id="covType"></select></label>
            <div class="formact"><button class="btn" id="covAdd">Watch this market</button></div>
          </div>
          <div class="row" id="covRow"></div>
          <div id="leadMsg"></div>
          <div id="covMsg"></div>
          <p class="fine" style="margin-top:var(--s3)">Remove all of them and any market
            where you have submitted a comp comes back on your next visit.</p>
        </div>
      </div>
      <!-- Hidden while there are no rows: a header row with nothing under it is
           the same "is this broken?" signal the empty comps table gave. -->
      <div class="tw hide" id="pipeTableWrap"><table id="pipeTbl">
        <thead><tr>
          <th data-bk="stageRank">Stage</th><th data-bk="received">Received</th>
          <th data-bk="market">Market</th><th data-bk="property_type">Type</th>
          <th data-bk="size_sqft" class="num">Size</th><th data-bk="source">Source</th>
          <th>Notes</th><th></th>
        </tr></thead><tbody id="pipeRows"></tbody>
      </table></div>
      <!-- Said once, under the table, rather than in every unclaimed lead's
           empty Market cell. A lead is anonymized to five facts by
           broker-leads.js; the blank is the privacy wall, not missing data. -->
      <p class="note hide" id="leadPrivacy">A lead&rsquo;s address and contact details stay
        with CompNinja until an introduction is made.</p>

      <!-- Choosing markets is setup, not the daily job, so it collapses once
           there is a row. #covForm is still exactly ONE node, relocated here
           by renderPipeline. Never add a second copy. -->
      <details class="dbox hide" id="covBox">
        <summary>Markets you watch</summary>
      </details>
    </section>

    <!-- ------------------------------------------------------------------
         The hubs deck: work going OUT to a client, where the pipeline deck
         above is work coming in. Third and last, because a hub only exists
         once there is a client to send comps to.

         Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
         NOT the connection hub at /brokers.

         The invite links are the delivery mechanism, not a convenience.
         Outbound email is off (EMAIL_FROM is unset until a domain is
         verified in Resend), so a link that is not copied out of this panel
         reaches nobody, and it cannot be recovered later: only the hash of
         each token is stored. #hubInvites therefore says so out loud rather
         than rendering a link and trusting the broker to notice it.
         ------------------------------------------------------------------ -->
    <div class="deck" id="deckHubs">
      <span class="dlab">Your hubs</span><span class="dln"></span>
      <button class="dact" id="hubToggle" aria-expanded="false" aria-controls="hubAddSec">+ New hub</button>
    </div>

    <section id="hubSec">
      <p class="sub hide" id="hubIntro" style="margin-top:0">A hub is where you and a client
        work one requirement: send comps, keep notes on each one, and skip the email thread.
        Only the people you invite can open it.</p>

      <div id="hubAddSec" class="addpanel hide">
        <div class="form">
          <label class="span2">What is this hub for
            <input id="hubTitle" type="text" placeholder="Warehouse requirement, 20k to 40k SF"/></label>
          <label class="span2">Property or area
            <input id="hubAddr" type="text" placeholder="City, ST"/></label>
          <label>Type <select id="hubType"></select></label>
          <label class="span2">Invite by email
            <input id="hubEmails" type="text" placeholder="client@firm.com, colleague@firm.com"/></label>
          <div class="formact span-all">
            <button class="btn" id="hubAdd">Create hub</button>
          </div>
        </div>
      </div>

      <!-- OUTSIDE the panel, unlike #addSec's #res, and on purpose: this one
           is never hidden, so a create that failed cannot write its error into
           something the broker just closed. -->
      <div id="hubMsg"></div>

      <!-- Shown once, right after a hub is created, and never fetched back:
           the raw tokens exist only in this response. -->
      <div id="hubInvites" class="hide"></div>

      <div id="hubEmpty" class="invite hide">
        <p>No hubs yet. Create one when you have comps to put in front of a client.</p>
      </div>

      <div class="tw hide" id="hubTableWrap"><table id="hubTbl">
        <thead><tr>
          <th>Hub</th><th>Market</th><th>Type</th>
          <th class="num">People</th><th>Opened</th><th>Updated</th><th></th>
        </tr></thead><tbody id="hubRows"></tbody>
      </table></div>
    </section>
  </div>
  <!-- The privacy sentence the old footer carried. It is page CONTENT, not
       chrome -- the one promise this page exists to make -- so it stays with
       the page rather than leaving with the footer that happened to hold it.
       MARKET_FOOTER's own disclaimer is about valuations and says nothing
       about a broker's book. -->
  <p class="vfoot">Private broker workspace. Your comps are never read into CompNinja's public records unless you choose to publish them.</p>
<script>window.__VAULT_BOOT__=${bootJson};</script>
<script src="/gut-check.js"></script>
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
  var comps=[],sortK="deal_date",sortAsc=false,leadsLoaded=false,bovsLoaded=false;
  var bench=null,benchFailed=false,benchLoaded=false;
  // Spreadsheet mode: the uploaded book as a grid of inputs. sheetUploadId
  // narrows to one import (Open on that file); null means the current view.
  // Kept across load() so a cell save that refetches, or a delete, does not
  // dump the broker back into the compact table mid-edit.
  var sheetMode=false,sheetUploadId=null,uploads=[];
  // The firm this broker belongs to, if any, and which of their comps are on
  // its shelf (migration 032). null firm = the ordinary case, and the whole
  // feature renders as nothing: no column, no toggle, no changed copy.
  // sharedIds is a lookup rather than a flag on each comp because shelf
  // membership is a property of the RELATIONSHIP, not of the comp — and
  // because vault-api.js's allowlist is a contract this page must not widen.
  var myFirm=null,sharedIds={};

  var money=function(n){return n==null?"":"$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:0})};
  var num=function(n){return n==null?"":Number(n).toLocaleString("en-US",{maximumFractionDigits:0})};
  var psf=function(n){return n==null?"":"$"+Number(n).toFixed(2)};
  var psf0=function(n){return n==null?"":"$"+Math.round(Number(n))};

  // The whole book is fetched once and narrowed HERE, not by re-querying with
  // market/type params as this page used to. Three reasons, in order of how
  // much they matter:
  //   1. The rollup has to count the WHOLE book. Server-side filtering means
  //      the browser only ever holds the current slice, so "42 comps in Boise"
  //      would silently become "42 of the ones you are already looking at".
  //   2. GET /api/vault defaults to limit=200. A broker with 400 comps was
  //      being shown half their vault, and the trust line said 200 with no
  //      hint that anything was missing. Asking for the server's own maximum
  //      fixes that up to 1000; past it, the #trunc line in apply() says so
  //      out loud rather than quietly under-reporting someone's book.
  //   3. Filtering is now instant and costs no round trip.
  // Every term must appear somewhere in the row, in any order and any field:
  // a broker types "fairview industrial" or "8400 mission" and means both
  // words, not the phrase. Case-folded, and matched on a substring rather than
  // a word boundary so "fair" finds Fairview -- this is a find box over one
  // person's own records, where being generous costs nothing and a miss costs
  // them the scroll they were trying to avoid.
  function matchesText(c,terms){
    if(!terms.length)return true;
    var hay=((c.address||"")+" "+(c.notes||"")+" "+(c.market||"")+" "+
             (c.property_type||"")+" "+(c.tenancy||"")).toLowerCase();
    for(var i=0;i<terms.length;i++){ if(hay.indexOf(terms[i])<0)return false; }
    return true;
  }
  function searchTerms(){
    return String(($("fText")&&$("fText").value)||"").toLowerCase().split(" ")
      .filter(function(w){return w});
  }
  function view(){
    var m=$("fMarket").value,t=$("fType").value,x=$("fTrans").value,q=searchTerms();
    var f=$("fFirm").value;
    return comps.filter(function(c){
      if(sheetUploadId&&String(c.upload_id)!==String(sheetUploadId))return false;
      // "shared" keeps what is on the firm's shelf, "unshared" what is not;
      // an empty value is every comp. sharedIds is the lookup the Firm
      // column already reads, so the filter and the column cannot disagree.
      if(f&&(f==="shared")!==Boolean(sharedIds[c.id]))return false;
      return (!m||c.market===m)&&(!t||c.property_type===t)&&(!x||c.transaction===x)&&
        matchesText(c,q);
    });
  }

  var median=function(list){
    if(!list.length)return null;
    var s=list.slice().sort(function(a,b){return a-b}),h=s.length>>1;
    return s.length%2?s[h]:(s[h-1]+s[h])/2;
  };
  // price_per_sqft is written server-side for SALES ONLY and left null on a
  // lease, deliberately: dividing an annual rent by size is $/SF/yr, a
  // different metric that would corrupt every median it touched. So reading
  // the stored field (rather than deriving price/size here) is what keeps
  // every number on this page sales-only. Do not "improve" this by computing
  // a fallback.
  var psfOf=function(c){
    var v=c.price_per_sqft;
    return (v==null||!isFinite(Number(v)))?null:Number(v);
  };
  var psfList=function(list){
    return list.map(psfOf).filter(function(v){return v!=null});
  };
  // The $/SF values a median would be taken over, AND how many property types
  // they span.
  //
  // $/SF IS NOT COMPARABLE ACROSS PROPERTY TYPES, so a median that mixes them
  // is an artifact rather than a statistic: on the first realistic test book
  // industrial (~$78), office (~$157) and retail (~$230) blended into a
  // headline "$117/SF", a figure describing no building in the book and
  // sitting in the largest type on the page. Counted over the PRICED SALES
  // only — the rows that actually feed the median — so an unpriced lease in a
  // second type never suppresses a figure it could not have moved.
  //
  // Same instinct as the rollup card that shows its comp count when it has no
  // priced sales: where a number would be fabricated, say what is true
  // instead. Every caller (the ledger tile, the reading strip, the table
  // footer) reads this one helper, which is also what keeps the strip and the
  // footer quoting the same thing — a rule this file is required to hold.
  //
  // The dominant field is the type most of the priced sales are in, and it
  // exists for the LEDGER TILE ALONE — see the tile's own note in apply() for
  // why that one surface narrows where the other two decline. (No backticks
  // anywhere in this file, comments included: the whole page is one template
  // literal, and a pair of them around a word closes it.)
  var psfStats=function(list){
    var vals=[],byType={},types=0;
    (list||[]).forEach(function(c){
      var v=psfOf(c);
      if(v==null)return;
      vals.push(v);
      var t=c&&c.property_type;
      if(!t)return;
      if(!byType[t]){byType[t]=[];types++;}
      byType[t].push(v);
    });
    // Ties break on the type NAME, not on object key order: key order follows
    // whatever order the rows arrived in, so two loads of the same book could
    // otherwise name different types on the same figure and read as the page
    // changing its mind.
    var dom=null;
    Object.keys(byType).sort().forEach(function(t){
      if(!dom||byType[t].length>dom.values.length)dom={type:t,values:byType[t]};
    });
    return {values:vals,types:types,mixed:types>1,dominant:dom};
  };
  // The lease half, and the exact mirror of psfOf above: the stored, canonical
  // ANNUAL figure, never rent_psf itself. rent_psf is what the broker typed
  // and means nothing without rent_basis beside it — a Californian 1.35/mo and
  // a Midwestern 16.20/yr are the same rent, and taking a median over the raw
  // column would average those two into a number describing neither. The
  // server does that multiplication once, in normalizeRow, and this reads the
  // result. Do not "improve" this by multiplying here.
  var rentOf=function(c){
    var v=c.rent_psf_yr;
    return (v==null||!isFinite(Number(v)))?null:Number(v);
  };
  // Same shape as psfStats, and same property-type rule: office at $28/SF/yr
  // and industrial at $9 are no more averageable than their sale prices are.
  // The extra field is structures: how many distinct lease_types the values
  // span, counting "not stated" as one of them. Mixing NNN with full-service
  // does not make the median WRONG the way mixing annual with monthly would,
  // so it is disclosed beside the figure rather than refused: a tenant paying
  // $28.50 net and one paying $28.50 gross are different deals, and a broker
  // reading one median over both should know that is what they are looking at.
  var rentStats=function(list){
    var vals=[],byType={},types=0,st={},structures=0;
    (list||[]).forEach(function(c){
      var v=rentOf(c);
      if(v==null)return;
      vals.push(v);
      var k=(c&&c.lease_type)||"unstated";
      if(!st[k]){st[k]=1;structures++;}
      var t=c&&c.property_type;
      if(!t)return;
      if(!byType[t]){byType[t]=[];types++;}
      byType[t].push(v);
    });
    return {values:vals,types:types,mixed:types>1,structures:structures};
  };
  // Which unit the rows on screen are priced in. A view holding both priced
  // sales and rents has no single median — they are different measures, not a
  // wider spread of one — so it reports "both" and every surface says to filter
  // rather than sealing the table with a figure that means nothing. This is
  // the same instinct as psfStats' own mixed-types rule one level up: where a number
  // would be fabricated, say what is true instead.
  var unitOf=function(rows){
    var s=psfStats(rows),r=rentStats(rows);
    if(s.values.length&&r.values.length)return {kind:"both",sale:s,rent:r};
    if(r.values.length)return {kind:"lease",sale:s,rent:r};
    return {kind:"sale",sale:s,rent:r};
  };
  var yearOf=function(c){
    var m=/^(\\d{4})/.exec(String(c.deal_date||""));
    return m?m[1]:null;
  };
  // Matches broker-vault.js's addressKey (lowercase, strip . , #, collapse
  // whitespace) rather than reading the row's stored address_key. That field
  // is on vault-api.js's INTERNAL_FIELDS list, kept in the response only until
  // the dashboard confirms it does not read it — so grouping on a local copy
  // is what lets that cleanup happen. Same conservative rule as the server's:
  // it does not expand "Blvd", because merging two genuinely different
  // properties is worse than showing one duplicate a broker can delete.
  var addrKey=function(v){
    return String(v==null?"":v).toLowerCase().replace(/[.,#]/g,"").replace(/\\s+/g," ").trim();
  };

  function gate(html){ $("gate").innerHTML=html; $("gate").className=""; $("app").className="hide"; }

  // The three decks that ARE the vault. Hidden, not emptied: an upsell where a
  // comps table should be is a table that is not there, and #vaultLocked above
  // says the same thing once, in one place.
  var VAULT_DECKS=["trustLine","deckBook","bookEmpty","addSec","rollupSec","compsSec",
    "deckPipe","pipeSec","deckHubs","hubSec"];

  function lockVaultDecks(msg){
    VAULT_DECKS.forEach(function(id){
      var el=$(id); if(!el) return;
      // Appended rather than assigned: .deck and .strip each restate .hide
      // below their own display rule, and a class list rebuilt from scratch
      // would drop whatever else the element was carrying.
      if(el.className.indexOf("hide")<0) el.className=(el.className+" hide").trim();
    });
    $("vaultLocked").className="invite";
    // The page subtitle describes the book, the pipeline and the hubs. With
    // all three locked it would be describing a page that is not on screen.
    $("deckSub").textContent="Your properties and your watchlist. Only you can see this.";
    if(msg) $("vaultLocked").insertAdjacentHTML("afterbegin",
      '<p class="note">'+esc(msg)+"</p>");
  }

  function apply(o){
    // The one whole-page refusal left: with nobody signed in there is no
    // portfolio, no watchlist and no book to show, so the gate still stands.
    if(o.s===401) return gate('<div class="msg bad">Please <a href="/desk">sign in</a> to open your vault.</div>');

    // Everything past this line renders the workspace. A refusal from this
    // page's own read locks THREE decks and leaves the two personal ones
    // alone -- see #vaultLocked's comment for why that asymmetry exists.
    $("gate").className="hide"; $("app").className="";

    // Free My Desk is an address list, Pro is the book of values. Stated on
    // all three of vaultReadPayload's exits so it survives the 403, which is
    // exactly the case that needs it. Presentation only: /api/portfolio
    // enforces its own caps.
    showValues=Boolean(o.j&&o.j.portfolioValues);
    // Once per page visit, not on every filter change or post-import refresh
    // that re-runs load() -- those hit /api/vault, a different endpoint, and
    // re-reading the portfolio on each would be work with no new information.
    if(!personalLoaded){ personalLoaded=true; loadProps(); loadMarkets(); }
    else { renderProps(); }

    // 403 (not Pro) and 503 (no database) lock the same three decks. The 503
    // says which it was, because "unavailable right now" and "part of Pro"
    // are different problems with different fixes.
    if(o.s===403) return lockVaultDecks("");
    if(o.s!==200) return lockVaultDecks((o.j&&o.j.error)||"Could not load your vault.");
    // A read that succeeds after one that failed has to put them back.
    $("vaultLocked").className="invite hide";
    comps=o.j.comps||[];
    $("cCount").textContent=(o.j.counts&&o.j.counts.returned)||0;
    $("cPub").textContent=(o.j.counts&&o.j.counts.published)||0;
    // What publishing gave back. Until now a broker published a comp, saw a
    // green chip, and learned nothing further — while the very same figure was
    // already on their public profile page, if they had one, under "Report
    // citations". Publishing is compensated in credit rather than cash, so a
    // credit nobody can see is not compensation.
    //
    // Summed over the rows on screen, like every other figure in this ledger,
    // so it cannot disagree with the per-comp counts in the table; the page
    // already says when a book is truncated past 1,000.
    var cites=comps.reduce(function(n,c){return n+(Number(c.cited_count)||0)},0);
    $("cPubSub").textContent=cites
      ? cites+" report citation"+(cites===1?"":"s")
      : "only if you choose it";
    // The ledger's other figures come from the returned rows — the same book
    // the rollup and chart read, so the strip can never disagree with the
    // panels below it. Whole-book always; the filter never narrows it.
    var ups=o.j.uploads||[];
    var st=psfStats(comps),ps=st.values,med=median(ps);
    $("cImports").textContent=ups.length?ups.length+" import"+(ups.length===1?"":"s"):"";
    $("cPriced").textContent=ps.length;
    $("cPricedPct").textContent=comps.length?Math.round(ps.length*100/comps.length)+"% of book":"";
    // A book spanning several property types has no single $/SF — industrial,
    // office and retail are priced in what amount to different units. This
    // tile NARROWS rather than declining: the figure is the median of the type
    // most of the priced sales are in, and the sub-line names that type and
    // how much of the book it covers.
    //
    // The reading strip and the table footer decline the same figure outright,
    // and the difference is deliberate (owner's call, 2026-08-12). Those two
    // seal the ROWS ON SCREEN, so a dominant-type median under a mixed table
    // would describe a subset the reader can see they did not filter to. This
    // tile describes the BOOK, is the page's headline number, and most real
    // books span types — so declining here would leave a permanent dash in the
    // largest slot on the page rather than answering a narrower question
    // honestly. Both surfaces still come from the one psfStats helper, so
    // neither can quote a figure the other contradicts.
    var dom=st.dominant,domMed=dom?median(dom.values):null;
    if(st.mixed&&domMed!=null){
      $("cMed").textContent=psf0(domMed);
      $("cMedSub").textContent=dom.type+" \\u00b7 "+dom.values.length+" of "+ps.length+" sales";
    }else{
      $("cMed").textContent=med!=null?psf0(med):"\\u2014";
      // Naming the type on a single-type book too, so the figure never sits
      // there unqualified — and so the mixed case reads as the same tile
      // answering a narrower question, not as a different tile.
      $("cMedSub").textContent=(dom&&med!=null)?dom.type+" \\u00b7 sales only":"sales only";
    }
    fillFilter("fMarket",o.j.markets||[]); fillFilter("fType",o.j.types||[]);
    // Also the pipeline's market suggestions: a broker's next BOV is usually in
    // a market they already hold comps in, and this is where that list arrives.
    allMarkets=o.j.markets||[];
    uploads=o.j.uploads||[];
    myFirm=o.j.firm||null;
    loadFirmBuildings();
    sharedIds={};
    (o.j.sharedWithFirm||[]).forEach(function(id){sharedIds[id]=true});
    // The firm filter is furniture for a broker in no firm, so it is not
    // there at all — and a value left in it by a broker who has since left
    // their firm would be narrowing the book from behind a hidden control.
    $("fFirmLab").className=myFirm?"":"hide";
    if(!myFirm)$("fFirm").value="";
    renderFirmPrivacy();
    renderIdentity(o.j.identity);
    renderRollup();
    // GET /api/vault caps at 1000 rows. Past that the rollup really is
    // counting part of the book, and a broker reading "42 comps in Boise"
    // deserves to know it might be more. Said out loud rather than absorbed.
    $("trunc").className=comps.length>=1000?"note":"note hide";
    renderUploads(o.j.uploads||[]);
    applyFirstRun(comps.length,(o.j.uploads||[]).length);
    // Loaded once per page visit, not on every filter change/publish/
    // import-delete that re-runs load() — those all hit /api/vault, a
    // different endpoint, and re-querying /api/broker/leads on each one
    // would be wasted work with no new information. It lives in apply()
    // rather than load() so the baked-in boot payload path (which never
    // calls load()) still populates the Leads section on first paint.
    if(!leadsLoaded){ leadsLoaded=true; loadLeads(); }
    if(!bovsLoaded){ bovsLoaded=true; loadBovs(); }
    // Benchmarks are asked for PER BUCKET, so an empty vault has nothing to
    // ask about and loadBenchmarks bails. Marking it loaded anyway is what
    // broke the first run: a broker who imported into an empty vault got the
    // early return, kept benchLoaded=true, and never saw a gut check until
    // they happened to reload the page. The comps.length guard leaves the
    // flag false until there is actually a bucket, so the apply() that
    // follows the first import is the one that loads them. This is why the
    // gut check looked like it was failing in thin markets when it was not.
    if(!benchLoaded && comps.length){ benchLoaded=true; loadBenchmarks(); }
    render();
  }

  // No market/type params: the whole book comes down once and view() narrows
  // it in the browser. See view() for why. limit is the server's own maximum.
  function load(){
    fetch("/api/vault?limit=1000",{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(apply)
      .catch(function(){ gate('<div class="msg bad">Could not reach the server. Please try again.</div>'); });
  }

  // Rebuild the options without losing what the broker had selected.
  function fillFilter(id,vals){
    var el=$(id),cur=el.value;
    if(cur&&vals.indexOf(cur)<0)vals=vals.concat([cur]);
    el.innerHTML='<option value="">All</option>'+vals.map(function(v){
      // escA, not esc, for the ATTRIBUTE: esc() leaves a literal double quote
      // untouched (it is innerHTML-safe only), and these values are markets and
      // types derived from addresses a broker typed. marketOf() takes the
      // comma-segment before the state verbatim, so a crafted import could
      // break out of value="...". The label after it stays on esc(), which is
      // correct for text content.
      return '<option value="'+escA(v)+'"'+(v===cur?" selected":"")+">"+esc(v)+"</option>"}).join("");
  }

  function compById(id){
    for(var i=0;i<comps.length;i++){ if(String(comps[i].id)===String(id))return comps[i]; }
    return null;
  }

  // Every field PATCH /api/vault/comp accepts. Spreadsheet mode shows all of
  // them; the compact table shows the six it has columns for (CELL_FIELDS
  // below), which is why the spreadsheet still exists as the other door — a
  // comp carries cap_rate/tenancy/year_built/notes that the compact table has
  // nowhere to put.
  var EDIT_FIELDS=["address","property_type","transaction","deal_date",
                   "price","size_sqft","cap_rate","rent_psf","rent_basis","lease_type",
                   "lease_expiry","option_notice_date",
                   "tenancy","year_built","notes"];
  var EDIT_LABELS={address:"Address",property_type:"Type",transaction:"Sale/lease",
    deal_date:"Date",price:"Price",size_sqft:"Size (SF)",cap_rate:"Cap rate",
    rent_psf:"Rent $/SF",rent_basis:"Rent per",lease_type:"Lease type",
    lease_expiry:"Lease expires",option_notice_date:"Option notice by",
    tenancy:"Tenancy",year_built:"Year built",notes:"Notes"};

  function sheetLabel(k){
    return EDIT_LABELS[k]||(typeof TARGET_LABELS!=="undefined"&&TARGET_LABELS[k])||k;
  }
  // One-line hints for the columns brokers stall on (owner's wishlist,
  // 2026-09-02: "what is lat and lng", "what does tenancy mean"). Rendered as
  // title= on every header that names the column — the spreadsheet, the
  // compact table, the confirm table — and on the add form's labels, so the
  // answer is wherever the question is asked. Not a fourth label map: a hint
  // explains a column, it never names one.
  var FIELD_HINTS={
    tenancy:"Who occupies the building: Single tenant, Multi-tenant or Owner-user. Free text, optional; never used in the math.",
    lat:"Latitude in decimal degrees, e.g. 43.6187. Optional. With longitude, it keeps this address off third-party geocoders.",
    lng:"Longitude in decimal degrees, e.g. -116.2146. Optional. With latitude, it keeps this address off third-party geocoders.",
    cap_rate:"The sale cap rate as a percentage, e.g. 5.75.",
    rent_basis:"Whether the rent is quoted per year or per month. Required with a rent; never guessed, because the wrong one is 12x off.",
    lease_type:"NNN, FS (full service) or MG (modified gross).",
    option_notice_date:"The date by which the tenant must give notice to renew \\u2014 the deadline that matters."
  };
  function fieldHint(k){ return FIELD_HINTS[k]||""; }

  // The compact table's editable columns: its own columns, minus the two it
  // derives. market is parsed from the address BY THE SERVER (marketOf, which
  // must agree byte for byte with comp_corpus.market), and price_per_sqft is
  // computed by normalizeRow for priced sales only — typing into either would
  // let a broker set a figure the next save would silently overwrite, which is
  // worse than not offering it. Both are refreshed after an edit from the row
  // the server sends back. Every entry here must be in EDIT_FIELDS, or the
  // PATCH would reject the field it just offered.
  // The renewal watch's two dates (038) are deliberately NOT here. They are
  // spreadsheet-mode fields for the reason stated above: the compact table has
  // six columns and a stated budget, they apply to leases only, and 029's rent
  // fields took the same door. A broker fills them in through the spreadsheet,
  // the CSV template, or the extract confirm table.
  var CELL_FIELDS=["address","property_type","transaction","deal_date","price","size_sqft"];

  // A cell shows the FORMATTED figure and holds the raw one, swapping to raw
  // on focus (cellFocus below). A book of business is read far more often than
  // it is edited, and "$1,250,000" is the number the broker is reading; making
  // every price cell editable is not a reason to show them all as 1250000.
  // parseMoney/parseNumber would in fact accept the formatted string back, but
  // that is a happy accident of the parsers, not something to lean the display
  // on — the raw value is what gets compared and sent.
  function cellDisplay(k,v){
    // A stored null deal_date IS the undated sentinel (042), and the word is
    // what the parser accepts back — so it is both the display AND the raw
    // value (cellInput below), letting a broker type a real date over it and
    // have the edit land through the ordinary cell PATCH.
    if(k==="deal_date"&&(v==null||v===""))return "undated";
    if(v==null||v==="")return "";
    if(k==="price")return money(v);
    if(k==="size_sqft")return num(v);
    return String(v);
  }
  // A table column used to size itself to the text in it, because a <td> of
  // text reports how wide its content is and wraps when it cannot have it. An
  // <input> does neither: it has its own default width of about twenty
  // characters and never wraps, so the moment these cells became inputs a long
  // address rendered clipped inside a box narrower than the address — the
  // column had stopped being told what it was holding.
  //
  // min-width in ch puts that back. A column's min-content width is the widest
  // of its cells, so sizing each cell to its own value sizes the column to the
  // longest one in it, which is what the text did before. Capped per field
  // because a 400-character note must not produce a 400-character column; past
  // the cap the table's own wrapper scrolls, as it already does.
  var CELL_MAX_CH={address:46,notes:64,deal_date:14,price:16,size_sqft:14,
    property_type:16,transaction:12,cap_rate:12,tenancy:20,year_built:12};
  function cellWidth(k,shown){
    var n=String(shown==null?"":shown).length;
    // +3 covers the input's own padding and border, which sit inside the
    // width and would otherwise eat the last characters back off again.
    return Math.max(7,Math.min(CELL_MAX_CH[k]||24,n+3));
  }
  function cellInput(c,k){
    // deal_date's raw mirrors its display for the undated case — "undated" is
    // a real input value the server accepts, unlike "" which it refuses.
    var raw=c[k]==null?(k==="deal_date"?"undated":""):c[k],shown=cellDisplay(k,c[k]);
    return '<input type="text" class="cell" data-id="'+escA(c.id)+'" data-k="'+escA(k)+
      '" data-raw="'+escA(raw)+'" value="'+escA(shown)+
      '" style="min-width:'+cellWidth(k,shown)+'ch" aria-label="'+escA(sheetLabel(k))+'"/>';
  }
  // Derived cells carry their own id/key so a save can refresh just them,
  // without the re-render that would steal focus from the next cell.
  // One rate column, two measures, decided per ROW rather than per view: a
  // sale shows its $/SF and a lease shows its annual rent. Both are server-
  // derived and only one of them is ever set, so this cannot show two figures
  // for one comp.
  // The publish control, and beside it what publishing earned. One builder for
  // the compact table and the spreadsheet, which showed the identical chip in
  // two places and would otherwise grow the citation count in only one.
  //
  // The count is deliberately NOT on the button: the button is a toggle with a
  // confirm behind it, and a number that grows inside a control reads as part
  // of the action rather than a result of it.
  function publishCell(c){
    var btn=c.published
      ? '<button class="pubbtn on" data-pub="'+esc(c.id)+'" data-on="1">Published</button>'
      : '<button class="pubbtn" data-pub="'+esc(c.id)+'">Publish</button>';
    var n=Number(c.cited_count)||0;
    if(!c.published||!n)return btn;
    // "cited in N reports" rather than "seen N times": the count rises when a
    // report is GENERATED citing this comp, and a cached re-run of the same
    // report does not bump it, so it is a floor on how often the broker's name
    // has actually been in front of somebody.
    return btn+' <span class="cites" title="'+escA("Cited in "+n+" report"+(n===1?"":"s")+
      " so far. Counted when a report is generated; a cached re-run of the same report is not counted again.")+
      '">'+n+"</span>";
  }

  function rateCell(c){
    if(c.transaction==="lease")return psf(c.rent_psf_yr);
    return psf(c.price_per_sqft);
  }
  function roCell(c,k,html,isNum){
    return '<td class="ro'+(isNum?" num":"")+'" data-ro-id="'+escA(c.id)+
      '" data-ro-k="'+escA(k)+'">'+html+"</td>";
  }
  // Preserves whatever base class the input carries (.cell in the compact
  // table, none in the spreadsheet) while swapping the save state, so a
  // className assignment cannot quietly strip the styling off the cell.
  // split(" "), NOT a regex: this whole page is one template literal, where a
  // single-backslash escape is eaten before the browser ever sees it — a
  // whitespace class written with one emits as the LETTER s, which would
  // split "saving" into ["", "aving"] and leave the state class stuck on the
  // cell forever. Class names here are written by this file and are
  // single-space separated, so a plain split is both correct and immune to
  // that.
  function cellState(el,state){
    var base=String(el.className||"").split(" ").filter(function(c){
      return c&&c!=="saving"&&c!=="saved"&&c!=="err";
    }).join(" ");
    el.className=state?(base?base+" "+state:state):base;
  }
  // Columns the spreadsheet shows. Core fields always (they are the template);
  // per-type extras only when at least one row on screen carries them, matching
  // exportCsv so a book with no clear heights does not grow empty columns.
  // lat/lng are omitted: GET /api/vault does not stitch property coordinates
  // today, so those cells would always look blank even when the building is
  // located. The compact Edit form still reaches them via add-by-hand.
  function sheetKeys(rows){
    var extra=[];
    (typeof PDF_KEYS!=="undefined"?PDF_KEYS:[]).forEach(function(k){
      if(EDIT_FIELDS.indexOf(k)>=0)return;
      if(k==="lat"||k==="lng")return;
      var used=rows.some(function(c){return c[k]!=null&&String(c[k]).trim()!=="";});
      if(used)extra.push(k);
    });
    return EDIT_FIELDS.concat(extra);
  }
  function uploadName(id){
    if(!id)return "";
    for(var i=0;i<uploads.length;i++){
      if(String(uploads[i].id)===String(id))return uploads[i].filename||"Untitled import";
    }
    return "this import";
  }
  function headCell(k,label,num){
    var on=k===sortK;
    var arrow=on?' <span class="ar">'+(sortAsc?"\\u25b2":"\\u25bc")+"</span>":"";
    return '<th data-k="'+k+'"'+(num?' class="num"':"")+(fieldHint(k)?' title="'+escA(fieldHint(k))+'"':"")+">"+esc(label)+arrow+"</th>";
  }
  // The bar is on in BOTH views now. Cells that can be typed into but look
  // like text need one line saying so — there is no Edit button left to make
  // it obvious, and a broker who never discovers the cells are live would
  // conclude the vault had simply stopped letting them fix anything. It also
  // carries the warning about published comps, which is the one consequence a
  // save can have that the broker cannot see from the row.
  var CELL_HINT="Type in any cell to change it \\u00b7 changes save when you leave the cell, Esc undoes. "+
    "Editing a published comp withdraws it from the public records.";
  function setSheetChrome(){
    $("tbl").className=sheetMode?"sheet":"";
    $("sheetToggle").textContent=sheetMode?"Done":"Open spreadsheet";
    var bar=$("sheetBar");
    bar.className="note";
    if(!sheetMode){
      bar.textContent=CELL_HINT+" Open the spreadsheet for cap rate, tenancy, year built and notes.";
      return;
    }
    var name=uploadName(sheetUploadId);
    bar.textContent=(name?"Editing "+name+" \\u00b7 ":"Spreadsheet \\u00b7 ")+CELL_HINT;
  }
  function openSheet(uploadId){
    sheetMode=true;
    sheetUploadId=uploadId||null;
    if(uploadId){ $("fMarket").value=""; $("fType").value=""; $("fTrans").value=""; $("fFirm").value=""; $("fText").value=""; }
    render();
    $("tbl").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function closeSheet(){
    sheetMode=false;
    sheetUploadId=null;
    render();
  }

  // Quiet trash, not a red "Delete" word. Same control in the compact table
  // and the spreadsheet. The confirm still names the action.
  var TRASH_SVG='<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M3.5 4.2h9M6.2 4.2V3h3.6v1.2M5.2 4.2l.55 9.1h4.5l.55-9.1M7.2 6.4v5M8.8 6.4v5"/></svg>';
  function trashBtn(id){
    return '<button type="button" class="lnk trash" data-del-comp="'+esc(id)+
      '" aria-label="Delete this comp" title="Delete">'+TRASH_SVG+'</button>';
  }

  function render(){
    var rows=view().slice().sort(function(a,b){
      var x=a[sortK],y=b[sortK];
      if(x==null&&y==null)return 0; if(x==null)return 1; if(y==null)return -1;
      if(typeof x==="number"&&typeof y==="number")return sortAsc?x-y:y-x;
      return sortAsc?String(x).localeCompare(String(y)):String(y).localeCompare(String(x));
    });
    var gutOutliers=renderGutCheck(rows);
    // Two different empty states, and telling them apart matters: a broker who
    // searched for a deal they own and got "Nothing here yet, upload a
    // spreadsheet" would reasonably think the vault had lost their book. Same
    // rule the hub list and the lead inbox already hold -- never report a
    // filtered-out view as an absent one.
    var narrowed=comps.length>0;
    // Single-quoted with plain double quotes inside, and HTML entities for the
    // curly quotes: this page is ONE template literal, so a backslash escape
    // written here is eaten before the browser ever sees it -- \" would reach
    // the emitted script as a bare " and end the string mid-attribute.
    $("none").innerHTML=narrowed
      ? 'No comps match this filter. <button type="button" class="lnk" id="noneClear">Clear filters</button>'
      : 'Nothing here yet. Use &ldquo;Add comps&rdquo; above to upload a spreadsheet, PDF or screenshot.';
    $("none").className=rows.length?"empty hide":"empty";
    // Say "of N" whenever a filter is narrowing, so the number on screen can
    // never be mistaken for the size of the book.
    $("shown").textContent=rows.length
      ? (rows.length===comps.length?rows.length+" shown":rows.length+" of "+comps.length+" shown")
      : "";
    renderChart(rows);
    renderRepeats(rows);
    setSheetChrome();
    // The two batch buttons count the CURRENT VIEW, and the spreadsheet is a
    // view too — an import opens as one. They sit above the sheet branch
    // because that branch returns early, and below it they went stale the
    // moment a broker opened the spreadsheet: the push offered under an
    // import result counted the compact table from before the upload.
    refreshPublishAll(rows);
    refreshFirmAll(rows);
    if(sheetMode){
      renderSheet(rows);
      // The strip summarises whatever is on screen, in whichever unit that
      // turns out to be — the spreadsheet shows the same comps as the compact
      // table, so it reads the same decision rather than a sales-only copy.
      var sunit=unitOf(rows);
      renderStrip(rows,sunit,footFigure(sunit));
      $("tblFoot").innerHTML="";
      return;
    }
    // The rate column names the unit it is actually showing. Left reading
    // "$/SF" over a column of annual rents it would be a wrong label on a real
    // figure, which is worse than no column: $28.50 under a "$/SF" heading
    // reads as a building worth twenty-eight dollars a foot. In a mixed view
    // each row still shows its own measure and the heading says so, which the
    // Deal column beside it disambiguates row by row.
    var unit=unitOf(rows);
    var rateHead=unit.kind==="lease"?"Rent $/SF/yr"
      :unit.kind==="both"?"$/SF or rent/yr":"$/SF";
    $("tblHead").innerHTML="<tr>"+
      headCell("address","Address")+headCell("market","Market")+
      headCell("property_type","Type")+headCell("transaction","Deal")+
      headCell("deal_date","Date")+headCell("price","Price",true)+
      headCell("size_sqft","Size",true)+headCell("price_per_sqft",rateHead,true)+
      headCell("published","Public")+(myFirm?"<th>Firm</th>":"")+"<th></th></tr>";
    $("tbody").innerHTML=rows.map(function(c){
      // Published state is a two-way toggle, never a checkbox that could be
      // flipped by a stray click: publishing is a one-way-ish public act, so
      // it goes through a button and a confirm.
      var pub=publishCell(c);
      var flag=gutOutliers[c.id]
        ? ' <span class="gcOut" title="'+escA(Math.abs(gutOutliers[c.id].pct)+"% "+
            (gutOutliers[c.id].dir==="above"?"above":"below")+" the market band")+'">outlier</span>'
        : "";
      // Firm sharing (migration 032 here → renumbered at merge; see the
      // migrations folder). A SECOND, separate two-way toggle rather than a
      // third state on Publish, because they are different acts with
      // different audiences and collapsing them would let one confirm dialog
      // cover both: Publish puts a comp in CompNinja's PUBLIC records under
      // the broker's name, this shows it to named colleagues and to nobody
      // else. The column only exists for a broker who is in a firm — a
      // control that can only fail is worse than no control.
      var firm="";
      if(myFirm){
        firm=sharedIds[c.id]
          ? '<td><button class="pubbtn on" data-firm="'+esc(c.id)+'" data-on="1">Shared</button> '+
            '<a class="lnk" href="/messages?say='+escA(encodeURIComponent("About "+c.address))+'&amp;comp='+escA(encodeURIComponent(c.id))+
            '" title="Start a conversation about this comp, with it attached">Discuss</a></td>'
          : '<td><button class="pubbtn" data-firm="'+esc(c.id)+'">Share</button></td>';
      }
      // Six typed cells, two derived ones, then the public toggle, the firm
      // toggle and the trash. The transaction cell loses its .tag chip by
      // becoming an input: a chip a broker cannot correct in place was the
      // thing being fixed.
      return '<tr><td class="addr">'+cellInput(c,"address")+"</td>"+
        roCell(c,"market",esc(c.market))+
        "<td>"+cellInput(c,"property_type")+"</td><td>"+cellInput(c,"transaction")+"</td>"+
        "<td>"+cellInput(c,"deal_date")+'</td><td class="num">'+cellInput(c,"price")+
        '</td><td class="num">'+cellInput(c,"size_sqft")+"</td>"+
        roCell(c,"price_per_sqft",rateCell(c)+flag,true)+
        "<td>"+pub+"</td>"+firm+'<td class="rowact">'+trashBtn(c.id)+"</td></tr>";
    }).join("");
    // The statement's closing rule: the median of the priced sales in the
    // current view, sealed under a double rule — the same figure the market
    // cards and the year chart lead with, so the three views read against
    // each other. No priced sales = no row; a double rule over a blank would
    // claim a figure that does not exist.
    // The unit was already decided above for the column heading; the footer
    // seals the table in that same unit, so the heading and the median under
    // it can never name different measures.
    var foot=footFigure(unit);
    renderStrip(rows,unit,foot);
    // ONE row template with the label and the number varying, deliberately
    // not a branch per case emitting its own <tr>: the footer's column count
    // is checked by finding a single label cell with a colspan in this file
    // and counting the cells after it, so a second copy silently breaks that
    // check (it did, on the first attempt at the change that added this). No
    // backticks in this block either — the whole page is one template literal.
    $("tblFoot").innerHTML=!foot.show ? "" :
      '<tr><td class="lab" colspan="7">'+foot.label+
      (foot.value==null||rows.length===comps.length?"":" in this view")+
      '</td><td class="num">'+(foot.value==null?"\\u2014":psf(foot.value))+
      "</td><td></td><td></td></tr>";
  }

  // What seals the table, in one place, because the reading strip quotes the
  // same figure and the two are required never to disagree.
  //
  // Four outcomes, and three of them decline to state a median. A view holding
  // both sales and leases has two different measures in it rather than a wider
  // spread of one, and a view spanning property types has the artifact
  // psfStats' own note describes. In both cases the honest thing is to name
  // the filter that resolves it — the reason the Deal filter exists at all.
  function footFigure(unit){
    if(unit.kind==="both"){
      return {show:true,value:null,
        label:"Sales and leases are priced differently \\u2014 filter by deal to compare"};
    }
    var lease=unit.kind==="lease",st=lease?unit.rent:unit.sale,vals=st.values;
    if(!vals.length)return {show:false,value:null,label:""};
    if(st.mixed){
      return {show:true,value:null,
        label:"No single median across "+st.types+" property types \\u2014 filter by type to compare"};
    }
    if(!lease){
      return {show:true,value:median(vals),
        label:"Median of "+vals.length+" priced sale"+(vals.length===1?"":"s")};
    }
    // Stated, never refused: see rentStats on why a mixed lease structure
    // weakens this figure rather than invalidating it.
    return {show:true,value:median(vals),
      label:"Median rent of "+vals.length+" lease"+(vals.length===1?"":"s")+" \\u00b7 $/SF/yr"+
        (st.structures>1?" \\u00b7 mixed lease types":"")};
  }

  // The unpublished comps in the current view, in view order, which is what
  // "publish these" means to the person looking at the screen.
  var pubCandidates=[];
  function refreshPublishAll(rows){
    pubCandidates=(rows||[]).filter(function(c){return !c.published});
    var b=$("pubAll");
    if(!b)return;
    // Hidden rather than disabled at zero: a permanently greyed control on a
    // fully-published book is a thing to wonder about, not an affordance.
    if(!pubCandidates.length){ b.className="btn ghost hide"; b.textContent=""; return; }
    b.className="btn ghost";
    b.textContent="Publish "+pubCandidates.length+" comp"+(pubCandidates.length===1?"":"s");
  }

  // The push's candidates: what is on screen and not yet on the firm's
  // shelf. refreshPublishAll's three rules, for the same reasons, plus a
  // fourth: for a broker in no firm the control does not exist at all,
  // since a control that can only fail is worse than no control. The label
  // names the firm — this is the one button whose whole meaning is who sees
  // the comps.
  var firmCandidates=[];
  function refreshFirmAll(rows){
    var b=$("firmAll");
    if(!b)return;
    firmCandidates=myFirm?(rows||[]).filter(function(c){return !sharedIds[c.id]}):[];
    if(!firmCandidates.length){ b.className="btn ghost hide"; b.textContent=""; return; }
    b.className="btn ghost";
    b.textContent="Share "+firmCandidates.length+" with "+myFirm.name;
  }

  function renderSheet(rows){
    var keys=sheetKeys(rows);
    var numK={price:1,size_sqft:1,cap_rate:1,units:1,price_per_unit:1,lot_acres:1,price_per_acre:1};
    $("tblHead").innerHTML="<tr>"+keys.map(function(k){
      return headCell(k,sheetLabel(k),!!numK[k]);
    }).join("")+headCell("published","Public")+'<th></th></tr>';
    $("tbody").innerHTML=rows.map(function(c){
      var pub=publishCell(c);
      var cells=keys.map(function(k){
        var v=c[k]==null?"":c[k];
        // Same width rule as the compact table (see cellWidth): a notes cell
        // holding two sentences must not render as a twenty-character box
        // with the rest of the sentence scrolled out of sight.
        return '<td><input type="text" data-id="'+escA(c.id)+'" data-k="'+escA(k)+
          '" value="'+escA(v)+'" style="min-width:'+cellWidth(k,v)+'ch"/></td>';
      }).join("");
      return "<tr>"+cells+"<td>"+pub+'</td><td class="rowact">'+trashBtn(c.id)+"</td></tr>";
    }).join("");
  }

  // ---- The market rollup ---------------------------------------------------
  // Keyed on market + property type, the same pair the lead coverage below is
  // keyed on, so a broker reading "Boise, ID · Industrial" here and watching
  // "Boise, ID · Industrial" there is looking at one thing, not two.
  // Ordered by size: the biggest part of the book is the part worth opening.
  function groups(list){
    var by={},order=[];
    list.forEach(function(c){
      var mk=c.market||"Unknown market",ty=c.property_type||"",k=mk+"|"+ty;
      if(!by[k]){by[k]={market:mk,type:ty,comps:[],pub:0};order.push(k);}
      by[k].comps.push(c);
      if(c.published)by[k].pub++;
    });
    return order.map(function(k){
      var g=by[k],dates=g.comps.map(function(c){return c.deal_date}).filter(Boolean).sort();
      var ps=psfList(g.comps);
      // A leasing bucket has no priced sales and led with its comp count,
      // which is how a book of 200 leases showed no figure anywhere. It has a
      // median, just in a different unit — so the card carries the unit rather
      // than assuming one. Sales still win the headline where a bucket has
      // both: $/SF is the figure the rest of the page and the market
      // benchmarks are denominated in.
      var rents=g.comps.map(rentOf).filter(function(v){return v!=null});
      return {market:g.market,type:g.type,n:g.comps.length,pub:g.pub,
        med:median(ps),psfN:ps.length,
        rentMed:median(rents),rentN:rents.length,
        first:dates[0]||"",last:dates[dates.length-1]||""};
    }).sort(function(a,b){return b.n-a.n});
  }

  function renderRollup(){
    var gs=groups(comps);
    $("rollupSec").className=gs.length?"":"hide";
    var m=$("fMarket").value,t=$("fType").value;
    $("rollup").innerHTML=gs.map(function(g){
      // A card reads as selected only when the filter is exactly this card.
      var on=(m===g.market&&t===g.type)?" on":"";
      // The headline number is the median $/SF where there are priced sales to
      // take one from, the median RENT where the bucket is leases, and the comp
      // count where it is neither. A leasing bucket used to fall straight to
      // the count and read "no priced sales yet" — true, and useless, since the
      // median it does have was simply in another unit.
      var head=g.med!=null
        ? '<div class="big">'+psf0(g.med)+'<span>/SF median</span></div>'
        : g.rentMed!=null
        ? '<div class="big">'+psf0(g.rentMed)+'<span>/SF/yr rent</span></div>'
        : '<div class="big">'+g.n+'<span> comp'+(g.n===1?"":"s")+'</span></div>';
      var line=g.med!=null
        ? g.n+" comp"+(g.n===1?"":"s")+" \\u00b7 "+g.psfN+" priced sale"+(g.psfN===1?"":"s")
        : g.rentMed!=null
        ? g.n+" comp"+(g.n===1?"":"s")+" \\u00b7 "+g.rentN+" lease"+(g.rentN===1?"":"s")
        : "no priced deals yet";
      var span=g.first?(g.first.slice(0,4)===g.last.slice(0,4)
        ? g.first.slice(0,4)
        : g.first.slice(0,4)+"\\u2013"+g.last.slice(0,4)):"";
      return '<button type="button" class="card'+on+'" data-mk="'+escA(g.market)+'" data-ty="'+escA(g.type)+'">'+
        '<span class="ty">'+esc(g.type||"Unspecified")+"</span>"+
        '<span class="mk">'+esc(g.market)+"</span>"+
        head+
        '<span class="fine">'+esc(line)+"</span>"+
        (span?'<span class="fine">'+esc(span)+" \\u00b7 latest "+esc(g.last)+"</span>":"")+
        (g.pub?'<span class="fine pub">'+g.pub+" published</span>":"")+
        "</button>";
    }).join("");
  }

  // ---- The gut check --------------------------------------------------------
  function loadBenchmarks(){
    if(typeof GUTCHECK==="undefined")return;      // script failed to load: panel stays hidden
    var bk={},list=[];
    comps.forEach(function(c){
      var k=(c.market||"")+"|"+(c.property_type||"");
      if(!bk[k]&&c.market&&c.property_type){bk[k]=1;list.push({market:c.market,type:c.property_type});}
    });
    if(!list.length)return;
    fetch("/api/vault/benchmarks",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({buckets:list.slice(0,50)})})
      .then(function(r){if(!r.ok)throw new Error("bench "+r.status);return r.json()})
      .then(function(j){bench=(j&&j.buckets)||[];render();})
      .catch(function(){benchFailed=true;render();});
  }

  // The verdict chip's label is plain English; the deltas are stated, the
  // sample sizes and dates ride on every number, and the whole panel says
  // "untrended" once at the bottom. Divergence copy is "worth a look" —
  // never a claim the broker's data is wrong.
  // What the reading strip's middle cell says, set by whichever branch of
  // renderGutCheck actually ran. Deliberately a side effect rather than a
  // changed return type: the return value is the outlier map the table reads,
  // and widening it would touch the one caller for no gain.
  //   null            = no verdict to show (strip cell renders a dash)
  //   {unavailable:1} = benchmarks did not load
  //   {inLine,total}  = how many buckets sit inside the band
  var lastGut=null;
  function renderGutCheck(rows){
    var box=$("gutBox");
    lastGut=null;
    if(typeof GUTCHECK==="undefined"){box.className="dbox hide";return {};}
    if(benchFailed){
      lastGut={unavailable:true};
      // Only worth saying over comps it would have described: with the
      // current filter showing nothing, an "unavailable" line above an empty
      // table reads as a second breakage rather than a degraded extra.
      if(!rows.length){lastGut=null;box.className="dbox hide";$("gutCards").innerHTML="";return {};}
      box.className="dbox";
      $("gutCards").innerHTML="";
      $("gutNote").textContent="Market benchmarks are unavailable right now. Your comps are unaffected.";
      return {};
    }
    if(!bench){box.className="dbox hide";return {};}
    var gc=GUTCHECK.gutCheck(rows,bench);
    var withData=gc.buckets.filter(function(b){return b.verdict!=="no_data"});
    // An all-"no data" panel reads as broken; hide it entirely instead.
    if(!withData.length){box.className="dbox hide";$("gutCards").innerHTML="";return gc.outliers;}
    lastGut={total:withData.length,
      inLine:withData.filter(function(b){return b.verdict==="in_line"}).length};
    box.className="dbox";
    var V={in_line:"In line with the market",above:"Above the market band",below:"Below the market band"};
    $("gutCards").innerHTML=withData.map(function(b){
      var chip='<span class="gcv'+(b.verdict==="in_line"?" ok":"")+'">'+V[b.verdict]+
        (b.delta_pct!=null?" \\u00b7 "+(b.delta_pct>0?"+":"")+b.delta_pct+"%":"")+"</span>";
      var lines=['<span class="fine">Your median '+psf0(b.broker.median_ppsf)+"/SF \\u00b7 "+
        b.broker.pricedSales+" priced sale"+(b.broker.pricedSales===1?"":"s")+"</span>"];
      if(b.corpus&&b.corpus.count>=GUTCHECK.MIN_CORPUS_PPSF){
        lines.push('<span class="fine">Public records: '+psf0(b.corpus.q1_ppsf)+"\\u2013"+
          psf0(b.corpus.q3_ppsf)+"/SF \\u00b7 "+b.corpus.count+" comps"+
          (b.corpus.newest_deal_date?" \\u00b7 newest "+esc(b.corpus.newest_deal_date):"")+"</span>");
      }
      if(b.snapshot&&b.snapshot.ppsf){
        lines.push('<span class="fine">Model market figures: '+psf0(b.snapshot.ppsf.low)+"\\u2013"+
          psf0(b.snapshot.ppsf.high)+"/SF"+
          (b.snapshot.generatedAt?" \\u00b7 "+esc(b.snapshot.generatedAt):"")+"</span>");
      }
      if(b.cap){
        lines.push('<span class="fine">Cap rate: your median '+b.cap.median+"% vs market "+
          b.cap.low+"\\u2013"+b.cap.high+"%"+
          (b.cap.corpus_median!=null?" (records median "+b.cap.corpus_median+"%)":"")+"</span>");
      }
      if(b.outlierIds.length){
        lines.push('<span class="fine">'+b.outlierIds.length+" comp"+
          (b.outlierIds.length===1?"":"s")+" priced well outside the band \\u2014 marked in the table, worth a look</span>");
      }
      return '<div class="gc"><span class="ty">'+esc(b.type)+'</span><span class="mk">'+
        esc(b.market)+"</span>"+chip+lines.join("")+"</div>";
    }).join("");
    $("gutNote").textContent="Compared untrended against public-web records and model market figures. "+
      "A divergence is worth a look, not a verdict \\u2014 your own records may be the better data.";
    return gc.outliers;
  }

  // ---- Median $/SF by year -------------------------------------------------
  // One series, so one hue and no legend: the heading says what is plotted.
  // Gray columns with the most recent year in the brand red, which is the same
  // emphasis language index.html's market chart already speaks (gray comp
  // dots, red for the one that matters). The latest year is the only one
  // direct-labelled — a number over every column is noise, and the axis plus
  // the per-column tooltip carry the rest.
  function bar(x,y,w,h,r){
    r=Math.min(r,w/2,h);
    return "M"+x+","+(y+h)+"V"+(y+r)+"a"+r+","+r+" 0 0 1 "+r+",-"+r+
      "h"+(w-2*r)+"a"+r+","+r+" 0 0 1 "+r+","+r+"V"+(y+h)+"Z";
  }
  function renderChart(rows){
    var box=$("chartBox"),by={},order=[];
    // One axis, so one measure. A view holding both sales and leases charts
    // the SALES and says so in its title: two units on one axis would draw
    // rents as a collapse in prices, and an axis tall enough for both makes
    // the rents a flat line along the bottom. Filtering to Leases charts the
    // rents on their own axis, which is the whole point of the filter.
    var lease=unitOf(rows).kind==="lease";
    var valOf=lease?rentOf:psfOf;
    rows.forEach(function(c){
      var y=yearOf(c),v=valOf(c);
      if(!y||v==null)return;
      if(!by[y]){by[y]=[];order.push(y);}
      by[y].push(v);
    });
    var years=order.sort();
    var pts=years.map(function(y){return {year:y,med:median(by[y]),n:by[y].length}});
    var total=pts.reduce(function(s,p){return s+p.n},0);
    // Two years and three priced sales is the floor for calling anything a
    // trend. Below it the honest thing is to say so, not to draw one column
    // and let it imply a direction. Silence would read as a broken panel.
    var noun=lease?"lease":"priced sale";
    var title=lease?"Median rent $/SF/yr by year":"Median $/SF by year";
    if(pts.length<2||total<3){
      box.className="dbox chart";
      $("chartTitle").textContent=title;
      $("chartWrap").innerHTML='<p class="note">A trend needs '+noun+'s in at least two years. '+
        (total?"There "+(total===1?"is 1":"are "+total)+" here so far.":"There are none in this view yet.")+"</p>";
      if(!rows.length)box.className="dbox chart hide";
      return;
    }
    box.className="dbox chart";
    $("chartTitle").textContent=title+" \\u00b7 "+total+" "+noun+(total===1?"":"s");

    var W=600,H=190,L=44,R=8,T=16,B=34;               // B leaves room for the year band
    var plotW=W-L-R,plotH=H-T-B;
    var top=Math.max.apply(null,pts.map(function(p){return p.med}));
    // Round the axis up to a clean number so the ticks read 0 / 60 / 120.
    var step=Math.pow(10,Math.floor(Math.log(top)/Math.LN10))/2;
    var max=Math.ceil(top/step)*step||1;
    var band=plotW/pts.length;
    var bw=Math.min(24,Math.max(6,band-10));          // capped; the leftover is air
    var y=function(v){return T+plotH-(v/max)*plotH};

    var s='<svg viewBox="0 0 '+W+" "+H+'" role="img" aria-label="Median price per square foot by year">';
    // Recessive hairline grid, solid (never dashed), one step off the surface.
    // Colours ride on CSS classes (.chart-grid / .chart-axis / .chart-bar /
    // .chart-endpoint, declared in the <style> block above), not inline
    // fill/stroke hex -- a presentation ATTRIBUTE like fill="var(--ink)" is
    // not reliably supported, and more importantly, a hex literal sitting in
    // THIS generated markup is exactly what the raw-hex regression test
    // cannot see (it only scans the <style> block). Classes put the colour
    // back inside what that test — and any future one like it — covers.
    [0,max/2,max].forEach(function(v){
      s+='<line class="chart-grid" x1="'+L+'" y1="'+y(v).toFixed(1)+'" x2="'+(W-R)+'" y2="'+y(v).toFixed(1)+
        '" stroke-width="1"/>';
      s+='<text class="chart-axis" x="'+(L-8)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end" font-size="11" '+
        'font-family="Inter, sans-serif" style="font-variant-numeric:tabular-nums">'+psf0(v)+"</text>";
    });
    pts.forEach(function(p,i){
      var cx=L+band*i+band/2,last=i===pts.length-1;
      var h=Math.max(2,y(0)-y(p.med));
      var tip=p.year+" \\u00b7 median "+psf0(p.med)+"/SF \\u00b7 "+p.n+" sale"+(p.n===1?"":"s");
      // Full-band transparent hit rect first: a 24px column is a small target,
      // and the tooltip should not require landing on the mark itself.
      s+='<rect x="'+(L+band*i).toFixed(1)+'" y="'+T+'" width="'+band.toFixed(1)+'" height="'+plotH+
        '" fill="transparent"><title>'+esc(tip)+"</title></rect>";
      s+='<path class="chart-bar'+(last?" hi":"")+'" d="'+bar(cx-bw/2,y(p.med),bw,h,4)+
        '" fill-opacity="'+(last?"1":"0.85")+'" pointer-events="none"/>';
      s+='<text class="chart-axis" x="'+cx.toFixed(1)+'" y="'+(H-12)+'" text-anchor="middle" font-size="11" '+
        'font-family="Inter, sans-serif">'+esc(p.year)+"</text>";
      // The endpoint is the one worth reading without hovering.
      if(last){
        s+='<text class="chart-endpoint" x="'+cx.toFixed(1)+'" y="'+(y(p.med)-7).toFixed(1)+'" text-anchor="middle" font-size="12" '+
          'font-weight="600" font-family="Inter, sans-serif">'+psf0(p.med)+"</text>";
      }
    });
    s+="</svg>";
    $("chartWrap").innerHTML=s;
  }

  // ---- Repeat properties ---------------------------------------------------
  // The "group them by building" half of the task, in the only form that adds
  // information: a property you have transacted more than once. Grouping every
  // property would be the same table with extra chrome, since most addresses
  // appear exactly once. Hidden entirely when there are no repeats, rather
  // than shown empty.
  // ---- The reading strip ---------------------------------------------------
  // Three headline figures over the comps table, each one already computed by
  // the panel it summarises — the median comes from the same psfList/median
  // pair that seals the table's own footer, so the strip and the closing row
  // can never quote different numbers.
  //
  // A cell is a BUTTON only when there is a panel behind it to open. Rendering
  // an affordance over a hidden panel would be a control that does nothing,
  // which is worse than a plain figure.
  // The title argument is optional and only the properties strip passes one.
  // because "Between checks" needs to say outright what the figure is not --
  // see the call site.
  function stripCell(lab,fig,sub,target,ok,title){
    var tag=target?"button":"div",
        cls="scell"+(target?" act":""),
        attr=(target?' type="button" data-open="'+target+'"':"")+
             (title?' title="'+escA(title)+'"':"");
    return "<"+tag+' class="'+cls+'"'+attr+'><span class="slab">'+lab+"</span>"+
      '<div class="sfig'+(ok?" ok":"")+'">'+fig+"</div>"+
      (sub?'<div class="ssub">'+sub+"</div>":"")+"</"+tag+">";
  }
  function renderStrip(rows,unit,foot){
    var box=$("readStrip");
    // Nothing on screen means nothing to summarise. The empty-table line below
    // says what is going on; a strip of dashes above it would not.
    if(!rows.length){box.className="strip hide";box.innerHTML="";return;}
    var cells=[];
    // Takes the footer's OWN computed figure rather than recomputing one, so
    // the strip and the seal under the table cannot quote different numbers —
    // the rule this strip has carried since it shipped, now enforced by there
    // being a single computation instead of two that happen to agree.
    var lease=unit.kind==="lease",st=lease?unit.rent:unit.sale;
    var head=unit.kind==="both"?"Median rate":lease?"Median rent/yr":"Median $/SF";
    var sub=unit.kind==="both"?"sales and leases"
      :st.mixed?st.types+" property types"
      :st.values.length?st.values.length+(lease?" lease":" priced sale")+(st.values.length===1?"":"s")
      :lease?"no rents":"no priced sales";
    cells.push(stripCell(head,foot.value==null?"&mdash;":psf(foot.value),sub,
      $("chartBox").className.indexOf("hide")<0?"chartBox":""));
    var gv="&mdash;",gs="",gok=false;
    if(lastGut&&lastGut.unavailable){ gs="benchmarks unavailable"; }
    else if(lastGut){
      gok=lastGut.inLine===lastGut.total;
      gv=lastGut.total===1
        ? (lastGut.inLine?"In line":"Off band")
        : lastGut.inLine+" of "+lastGut.total;
      gs=lastGut.total===1?"with the market":"markets in line";
    }
    cells.push(stripCell("vs market",gv,gs,
      $("gutBox").className.indexOf("hide")<0?"gutBox":"",gok));
    cells.push(stripCell("Repeat properties",lastReps.props||"&mdash;",
      lastReps.props?lastReps.deals+" deals":"none in this view",
      lastReps.props?"repBox":""));
    box.innerHTML=cells.join("");
    box.className="strip";
  }

  var lastReps={props:0,deals:0};
  function renderRepeats(rows){
    var by={},order=[];
    rows.forEach(function(c){
      var a=addrKey(c.address);
      if(!a)return;
      // Keyed on MARKET + address, never address alone. Street names repeat
      // across a metro: on the first test book, 4 of 6 "repeat properties"
      // were a Boise building and a Meridian building at the same house
      // number, presented as one property with three deals. A broker's own
      // records inventing a transaction history is worse than showing no
      // repeats at all, and the same instinct is already written into
      // broker-vault.js's addressKey: merging two genuinely different
      // properties is worse than keeping one duplicate. The market never
      // differs between two deals on the SAME building, so this can only
      // split false groups, never true ones.
      var k=(c.market||"")+"|"+a;
      if(!by[k]){by[k]={address:c.address,market:c.market||"",deals:[]};order.push(k);}
      by[k].deals.push(c);
    });
    var reps=order.map(function(k){return by[k]}).filter(function(g){return g.deals.length>1})
      .sort(function(a,b){return b.deals.length-a.deals.length});
    lastReps={props:reps.length,
      deals:reps.reduce(function(s,g){return s+g.deals.length},0)};
    $("repBox").className=reps.length?"dbox":"dbox hide";
    // Cleared, not just hidden: a filtered-out market's rows left in the DOM
    // are the wrong answer waiting for whatever un-hides this next.
    if(!reps.length){ $("repRows").innerHTML=""; return; }
    $("repRows").innerHTML=reps.slice(0,10).map(function(g){
      var deals=g.deals.slice().sort(function(a,b){
        return String(b.deal_date||"").localeCompare(String(a.deal_date||""));
      }).map(function(d){
        return '<div class="deal">'+esc(d.deal_date||"undated")+" \\u00b7 "+esc(d.transaction||"")+
          (d.price!=null?" \\u00b7 "+money(d.price):"")+
          (psfOf(d)!=null?" \\u00b7 "+psf(psfOf(d))+"/SF":"")+"</div>";
      }).join("");
      // The market is named on the row, not just used as a grouping key: two
      // same-numbered addresses in neighbouring cities are exactly the pair a
      // reader would otherwise assume had been merged.
      return '<div class="rep"><div class="addr">'+esc(g.address)+" <span class=\\"note\\">"+
        (g.market?esc(g.market)+" \\u00b7 ":"")+g.deals.length+" deals</span></div>"+deals+"</div>";
    }).join("")+(reps.length>10?'<p class="note">'+(reps.length-10)+" more not shown.</p>":"");
  }

  // ---- First run vs the real workspace --------------------------------------
  // Keyed on comps AND uploads, not comps alone. A broker whose only import was
  // entirely rejected, or who has deleted every comp out of an import, has
  // already been through the door once — showing them the first-run steps again
  // would read as their work having been thrown away.
  //
  // Everything hidden here is hidden because it is EMPTY, not because it is
  // unimportant: an empty table with a header row and a "nothing here yet" line
  // reads as a broken page, and the vault had three of them stacked up.
  //
  // It also remembers the counts it was last called with, so closeMapper can
  // put the page back by RE-APPLYING this function rather than keeping a
  // second copy of the first-run rule that would drift from it.
  var firstRunCounts=[0,0];
  // Whether the broker has OPENED the uploader this visit. It starts closed
  // for a returning broker (the deck's action opens it) and is a plain flag
  // rather than a class read back off the DOM, because the mapping panel
  // hides #addSec out from under it and reading the class there would report
  // "closed" and lose the broker's intent when the mapper is cancelled.
  var addOpen=false;
  function applyFirstRun(compCount,uploadCount){
    firstRunCounts=[compCount,uploadCount];
    var first=compCount===0&&uploadCount===0;
    $("bookEmpty").className=first?"invite":"invite hide";
    // The uploader is closed by default in BOTH cases and this only
    // re-asserts whatever the broker last chose. It deliberately does not
    // force it shut on an empty book: #res lives inside this panel, so an
    // import that failed before it could raise the comp count would have
    // written its error into something invisible. doImport opens it for
    // exactly that.
    setAddOpen(addOpen);
    setBovOpen(bovOpen);
    $("compsSec").className=first?"hide":"";
    $("importsSec").className=first?"dbox hide":"dbox";
  }

  // The single writer of the uploader's visibility. The deck action's label
  // and aria-expanded ride with it so the control can never describe a state
  // the panel is not in.
  function setAddOpen(open){
    addOpen=!!open;
    $("addSec").className=addOpen?"addpanel":"addpanel hide";
    $("addToggle").textContent=addOpen?"Close":"+ Add comps";
    $("addToggle").setAttribute("aria-expanded",addOpen?"true":"false");
  }

  // The pipeline deck's equivalent, and the single writer of the log-a-BOV
  // panel's visibility. Ships closed: a deck should open with the work, not
  // with a seven-field form.
  var bovOpen=false;
  function setBovOpen(open){
    bovOpen=!!open;
    $("bovAddSec").className=bovOpen?"addpanel":"addpanel hide";
    $("bovToggle").textContent=bovOpen?"Close":"+ Log a BOV";
    $("bovToggle").setAttribute("aria-expanded",bovOpen?"true":"false");
  }

  // ---- The credit identity --------------------------------------------
  //
  // Who a published comp is credited to, stated once. It is shown BEFORE any
  // publish rather than discovered after one, because a credit is a public
  // claim about who someone is: "Verified &middot; via <firm>" on every report the
  // comp reaches. Until 2026-08-12 an unstated identity silently became the
  // account's signup name, so a broker could not have corrected it — they
  // were never told it had happened.
  //
  // identity.creditedTo is the SERVER's answer, from the same creditName()
  // the publish route calls. Never recomputed here: a page that guessed the
  // credit could promise a name the write would not produce.
  // (No backticks anywhere in this block: the whole page is one template
  // literal, and one stray backtick ends it — see the file's header note.)
  var identity={display_name:"",company:"",license_number:"",creditedTo:"",canPublish:false};

  function renderIdentity(idn){
    identity=idn||{display_name:"",company:"",license_number:"",creditedTo:"",canPublish:false};
    var to=identity.creditedTo||"";
    // Three states, not two. A broker with a credit name but no license is
    // ready in every way the old copy could describe and would still be
    // refused on click, so the line says which of the two is missing BEFORE
    // the Publish button is pressed rather than after.
    if(!to){
      $("creditLine").innerHTML="Comps you publish need a name to credit them to. "+
        '<button class="pubbtn" id="idEdit">Add your firm</button>';
    }else if(!identity.canPublish){
      $("creditLine").innerHTML="Comps you publish are credited to <strong>"+esc(to)+"</strong>, "+
        "and publishing needs your license number. "+
        '<button class="pubbtn" id="idEdit">Add it</button>';
    }else{
      $("creditLine").innerHTML="Comps you publish are credited to <strong>"+esc(to)+"</strong>. "+
        '<button class="pubbtn" id="idEdit">Change</button>';
    }
  }

  // The single writer of the form's visibility, like setAddOpen: the fields
  // are refilled from the last known identity on every open, so a cancelled
  // edit never leaves a half-typed firm name waiting to be saved later.
  function setIdOpen(open){
    if(open){
      $("idCompany").value=identity.company||"";
      $("idName").value=identity.display_name||"";
      $("idLicense").value=identity.license_number||"";
      $("idMsg").className="msg bad hide";
    }
    $("idForm").className=open?"":"hide";
    if(open)$("idCompany").focus();
  }

  $("creditLine").addEventListener("click",function(e){
    if(e.target&&e.target.id==="idEdit")setIdOpen(true);
  });
  $("idCancel").addEventListener("click",function(){ setIdOpen(false); });
  $("idSave").addEventListener("click",function(){
    var body={company:$("idCompany").value,display_name:$("idName").value,
      license_number:$("idLicense").value};
    $("idSave").disabled=true; $("idSave").textContent="Saving\\u2026";
    fetch("/api/vault/identity",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        $("idSave").disabled=false; $("idSave").textContent="Save";
        if(o.s!==200){
          $("idMsg").textContent=o.j.error||"That didn't save.";
          $("idMsg").className="msg bad";
          return;
        }
        renderIdentity({display_name:o.j.identity.display_name,
          company:o.j.identity.company,license_number:o.j.identity.license_number,
          creditedTo:o.j.creditedTo,canPublish:o.j.canPublish});
        setIdOpen(false);
      })
      .catch(function(){
        $("idSave").disabled=false; $("idSave").textContent="Save";
        $("idMsg").textContent="That didn't reach the server. Nothing was changed.";
        $("idMsg").className="msg bad";
      });
  });

  function renderUploads(ups){
    $("ups").innerHTML=ups.length?ups.map(function(u){
      var editing=sheetMode&&sheetUploadId&&String(sheetUploadId)===String(u.id);
      return '<div class="up"><span>'+esc(u.filename||"Untitled import")+
        ' <span class="meta">&middot; '+u.row_count+" comps"+
        (u.skipped_count?", "+u.skipped_count+" skipped":"")+
        " &middot; "+esc(String(u.created_at||"").slice(0,10))+'</span></span>'+
        '<span><button class="lnk" type="button" data-open-sheet="'+esc(u.id)+'">'+
        (editing?"Editing":"Open")+"</button> "+
        '<button data-del="'+esc(u.id)+'">Remove</button></span></div>';
    }).join(""):'<p class="empty">No imports yet.</p>';
  }

  var PROP_TYPES=["Industrial","Office","Retail","Multifamily","Land","Residential"];
  // The pipeline's two sources, each with its own arrival state. A row is only
  // ever drawn from what actually arrived: leadsOk/bovsOk false means that half
  // reports a failure and contributes nothing, while the other half still
  // renders. One table fed by two endpoints must never let either failure blank
  // the deck or leave the other half's stale rows under an error message.
  var leads=[],coverage=[],leadsOk=false,leadsErr="",allMarkets=[];
  // noseed=true after a delete: that call must NOT re-earn the market the
  // broker just removed. A plain page visit (no arg) always reseeds, which is
  // what the section's own copy promises.
  function loadLeads(noseed){
    fetch("/api/broker/leads"+(noseed?"?noseed=1":""),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){
          leads=[]; coverage=[]; leadsOk=false;
          leadsErr=o.j.error||"Couldn't load leads.";
          renderCoverage(coverage); renderPipeline();
          return;
        }
        leadsOk=true; leadsErr="";
        coverage=o.j.coverage||[];
        leads=o.j.leads||[];
        renderCoverage(coverage);
        renderPipeline();
      })
      .catch(function(){
        leads=[]; coverage=[]; leadsOk=false;
        leadsErr="Couldn\\'t load leads. Please try again.";
        renderCoverage(coverage); renderPipeline();
      });
  }
  function renderCoverage(cov){
    var emptyHint='<span class="empty" style="padding:0">No markets yet. Add a market above to start seeing leads here, or submit comps to earn markets automatically.</span>';
    $("covRow").innerHTML=cov.length?cov.map(function(c){
      var label=escA(c.market)+" "+escA(c.property_type);
      // Cities that trade as one market are matched together (the server's
      // METRO_GROUPS), so a chip reading "Boise, ID" can legitimately pull in
      // a Meridian lead. Said out loud here, because a lead from a city the
      // broker never typed otherwise reads as a bug in the thing whose whole
      // job is to be trusted about where their business is.
      var near=Number(c.nearby||0);
      var nearTip=near?" Also matches "+near+" nearby market"+(near===1?"":"s")+" that trade as one with it.":"";
      return '<span class="chip">'+esc(c.market)+" \\u00b7 "+esc(c.property_type)+
        (near?'<span class="near" title="'+escA(nearTip.trim())+'">+'+near+" nearby</span>":"")+
        ' <button type="button" data-cov="'+escA(c.id)+'" aria-label="Stop watching '+label+nearTip+'" title="Stop watching '+label+
        '">&times;</button></span>';
    }).join(" "):(($("covForm").parentNode&&$("covForm").parentNode.id==="pipeEmpty")?"":emptyHint);
    var seen={},opts=[];
    coverage.concat().forEach(function(c){ if(c&&c.market&&!seen[c.market]){seen[c.market]=1;opts.push(c.market);} });
    (allMarkets||[]).forEach(function(m){ if(m&&!seen[m]){seen[m]=1;opts.push(m);} });
    $("mktList").innerHTML=opts.sort().map(function(m){
      return '<option value="'+escA(m)+'"></option>';
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
        if(o.s!==200){ $("covMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't add that market.")+"</div>"; return; }
        $("covMsg").innerHTML=""; $("covMarket").value=""; loadLeads();
      })
      .catch(function(){ b.disabled=false;
        $("covMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was added.</div>'; });
  });
  document.addEventListener("click",function(e){
    var cov=e.target.getAttribute&&e.target.getAttribute("data-cov");
    if(cov){
      fetch("/api/broker/coverage?id="+encodeURIComponent(cov),{method:"DELETE",credentials:"same-origin"})
        .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
        .then(function(o){
          if(o.s!==200){ $("covMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't remove that market.")+"</div>"; return; }
          // noseed: the market just removed must not be re-earned by this
          // same reload. A full page visit still reseeds it.
          $("covMsg").innerHTML=""; loadLeads(true);
        })
        .catch(function(){ $("covMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>'; });
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
            $("pipeMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't send that request.")+"</div>";
            return;
          }
          // Both halves: the intro marks the lead requested AND auto-creates the
          // open BOV row, and since 2026-08-13 those are two stages of one
          // table, so refreshing only the leads would show the request landing
          // with no sign of the engagement it just opened.
          loadLeads(); loadBovs();
        })
        .catch(function(){
          var again=document.querySelector('[data-intro="'+intro+'"]');
          if(again){ again.disabled=false; again.textContent="Request introduction"; }
          $("pipeMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was sent.</div>';
        });
    }
  });

  // ---- The pipeline ---------------------------------------------------------
  //
  // One table, two sources. A lead is an anonymized market signal that belongs
  // to nobody yet; a BOV is this broker's own engagement. They are two STAGES
  // of one thing, and requesting an introduction is the move between them, so
  // they are drawn as one list rather than as two products.
  //
  // Nothing here widens what a lead exposes: the five facts broker-leads.js
  // allows are the five facts drawn, and a lead's empty Market and Notes cells
  // are the privacy wall doing its job (#leadPrivacy says so once, below).
  var bovs=[],bovRollup=null,bovsOk=false,bovsErr="";
  var pipeSortK="received",pipeSortAsc=false,pipeStage="";
  var BOV_STATUSES=["open","delivered","won","lost"];
  var BOV_SOURCE_LABEL={compninja:"CompNinja intro",referral:"Referral",repeat_client:"Repeat client",other:"Other"};
  // New first, then the log's own order. The rank is what the Stage column
  // sorts on: sorting five stage NAMES alphabetically would read as random.
  var STAGES=["new","open","delivered","won","lost"];
  $("bovType").innerHTML=PROP_TYPES.map(function(t){return "<option>"+t+"</option>"}).join("");
  // noseed=true after a delete: that call must NOT let the GET's own-empty-
  // log reseed bring back a row the broker just Removed. A plain page visit
  // (no arg) always leaves the seed check in place, same escape as
  // loadLeads(noseed) above.
  function loadBovs(noseed){
    fetch("/api/broker/bovs"+(noseed?"?noseed=1":""),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){
          bovs=[]; bovRollup=null; bovsOk=false;
          // Reworded rather than shown verbatim: requireBroker's strings name
          // the lead inbox, and this half of the table is the broker's own log.
          bovsErr=o.s===403?"Your BOV log is part of Pro."
            :o.s===503?"Your BOV log is unavailable right now. Please try again in a minute."
            :(o.j.error||"Couldn't load your BOV log.");
          renderPipeline();
          return;
        }
        bovsOk=true; bovsErr="";
        bovs=o.j.bovs||[];
        bovRollup=o.j.rollup||null;
        renderPipeline();
      })
      .catch(function(){
        bovs=[]; bovRollup=null; bovsOk=false;
        bovsErr="Couldn\\'t load your BOV log. Please try again.";
        renderPipeline();
      });
  }

  // Both sources, normalized onto one row shape so the table, the sort and the
  // strip all read the same fields. kind is the only thing downstream needs
  // to know about where a row came from.
  function pipeRows(){
    var out=[];
    if(leadsOk){
      leads.forEach(function(l){
        out.push({kind:"lead",id:l.id,stage:"new",stageRank:0,
          received:String(l.ts||"").slice(0,10),market:l.market||"",address:"",
          property_type:l.type||"",size_sqft:l.size_sqft||null,
          source:"lead",sourceLabel:l.is_1031?"CompNinja lead · 1031 exchange":"CompNinja lead",notes:"",
          intro_requested:!!l.intro_requested,status:""});
      });
    }
    if(bovsOk){
      bovs.forEach(function(b){
        var st=STAGES.indexOf(b.status);
        out.push({kind:"bov",id:b.id,stage:b.status,stageRank:st<0?9:st,
          received:b.received_on||String(b.created_at||"").slice(0,10),
          market:b.market||"",address:b.address||"",
          property_type:b.property_type||"",size_sqft:b.size_sqft||null,
          source:b.source,sourceLabel:BOV_SOURCE_LABEL[b.source]||b.source||"",
          notes:b.notes||"",intro_requested:false,status:b.status});
      });
    }
    return out;
  }

  // A stage cell. Same rule as the book deck's reading strip: it is a BUTTON
  // only when there is something behind it, because an affordance over an empty
  // stage is a control that does nothing.
  function stageCell(stage,label,count,active){
    var live=count>0,tag=live?"button":"div",
        cls="scell"+(live?" act":""),
        attr=live?' type="button" data-stage="'+stage+'"':"";
    return "<"+tag+' class="'+cls+'"'+attr+'><span class="slab">'+label+"</span>"+
      '<div class="sfig'+(active?" ok":"")+'">'+count+"</div>"+
      (active?'<div class="ssub">filtering</div>':"")+"</"+tag+">";
  }

  function renderPipeline(){
    // Whichever halves failed, said once, above the table. Neither failure may
    // blank the deck: the other half's rows still render underneath.
    var errs=[];
    if(!leadsOk&&leadsErr)errs.push(leadsErr);
    if(!bovsOk&&bovsErr)errs.push(bovsErr);
    $("pipeMsg").innerHTML=errs.map(function(m){
      return '<div class="msg bad">'+esc(m)+"</div>";
    }).join("");

    var all=pipeRows();
    // Counted from what ARRIVED, never from what was asked for — a strip that
    // counted a failed half would report zero as if it were the answer.
    var counts={};
    all.forEach(function(r){ counts[r.stage]=(counts[r.stage]||0)+1; });
    if(pipeStage&&!counts[pipeStage])pipeStage="";   // the stage being filtered emptied out
    var strip=$("pipeStrip");
    if(all.length){
      strip.innerHTML=STAGES.map(function(s){
        return stageCell(s,s.charAt(0).toUpperCase()+s.slice(1),counts[s]||0,pipeStage===s);
      }).join("");
      strip.className="strip s5";
    } else { strip.innerHTML=""; strip.className="strip s5 hide"; }

    // The two rollup facts that are not stage counts. They come from the
    // server's own rollup, so the win rate keeps bov-log.js's floor of three
    // decided BOVs, under which it is a dash rather than a punchline.
    var note=$("pipeNote");
    if(bovRollup&&bovRollup.total){
      var wr=bovRollup.winRate==null?"\\u2014":Math.round(bovRollup.winRate*100)+"%";
      note.innerHTML=esc(bovRollup.thisYear)+" this year &middot; win rate "+wr;
      note.className="note";
    } else { note.innerHTML=""; note.className="note hide"; }

    var rows=all.filter(function(r){ return !pipeStage||r.stage===pipeStage; });
    rows.sort(function(a,b){
      var av=a[pipeSortK],bv=b[pipeSortK];
      if(av==null&&bv==null)return 0;
      if(av==null)return 1;
      if(bv==null)return -1;
      var c=typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv));
      return pipeSortAsc?c:-c;
    });

    $("pipeTableWrap").className=rows.length?"tw":"tw hide";
    // Only shown when an unclaimed lead is actually on screen to explain.
    var anyLead=rows.some(function(r){ return r.kind==="lead"; });
    $("leadPrivacy").className=anyLead?"note":"note hide";
    $("pipeRows").innerHTML=rows.map(pipeRow).join("");

    // Invitation vs table: a header row over nothing is the empty table this
    // page used to open with. Failures do not count as empty — "nothing here"
    // would be a claim we cannot make — so an error with no rows hides the
    // invitation too and leaves the messages in #pipeMsg.
    var pipeInvite=!all.length&&!errs.length;
    $("pipeEmpty").className=pipeInvite?"invite":"invite hide";
    $("pipeIntro").className=pipeInvite?"sub hide":"sub";
    $("covBox").className=pipeInvite?"dbox hide":"dbox";
    if(pipeInvite)$("pipeEmpty").appendChild($("covForm"));
    else $("covBox").appendChild($("covForm"));
    renderCoverage(coverage);
  }

  function pipeRow(r){
    var stage,action;
    if(r.kind==="lead"){
      stage='<span class="stg new">New</span>';
      action=r.intro_requested
        ? '<button class="pubbtn on" disabled>Intro requested</button>'
        : '<button class="pubbtn" data-intro="'+escA(r.id)+'">Request introduction</button>';
    } else {
      stage='<select data-bov="'+escA(r.id)+'" data-prev="'+escA(r.status)+'">'+
        BOV_STATUSES.map(function(s){
          return '<option value="'+s+'"'+(r.status===s?" selected":"")+">"+
            s.charAt(0).toUpperCase()+s.slice(1)+"</option>";
        }).join("")+"</select>";
      action='<button class="pubbtn" data-bovdel="'+escA(r.id)+'">Remove</button>';
    }
    return "<tr><td>"+stage+"</td><td>"+esc(r.received)+"</td>"+
      "<td>"+esc(r.market)+(r.address?' <span class="note">'+esc(r.address)+"</span>":"")+"</td>"+
      "<td>"+esc(r.property_type)+"</td>"+
      '<td class="num">'+(r.size_sqft?num(r.size_sqft)+" SF":"")+"</td>"+
      "<td>"+esc(r.sourceLabel)+"</td>"+
      "<td>"+esc(r.notes)+"</td>"+
      "<td>"+action+"</td></tr>";
  }

  document.querySelector("#pipeTbl thead").addEventListener("click",function(e){
    var th=e.target.closest("th[data-bk]"); if(!th)return;
    var k=th.getAttribute("data-bk");
    if(k===pipeSortK)pipeSortAsc=!pipeSortAsc; else{pipeSortK=k;pipeSortAsc=false;}
    // Redraws from the rows already held: a sort costs no refetch and cannot
    // clear the strip.
    renderPipeline();
  });
  // A stage cell is the filter, and clicking the active one clears it — a
  // toggle, never a trap you can only leave by reloading.
  $("pipeStrip").addEventListener("click",function(e){
    var cell=e.target.closest("button[data-stage]"); if(!cell)return;
    var s=cell.getAttribute("data-stage");
    pipeStage=pipeStage===s?"":s;
    renderPipeline();
  });
  $("bovAdd").addEventListener("click",function(){
    var b=$("bovAdd");
    b.disabled=true;
    fetch("/api/broker/bovs",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        market:$("bovMarket").value, property_type:$("bovType").value,
        source:$("bovSource").value, size_sqft:$("bovSize").value,
        received_on:$("bovDate").value, address:$("bovAddr").value,
        notes:$("bovNotes").value })})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        b.disabled=false;
        if(o.s!==200){ $("bovMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't log that BOV.")+"</div>"; return; }
        $("bovMsg").innerHTML="";
        $("bovMarket").value=""; $("bovSize").value=""; $("bovDate").value="";
        $("bovAddr").value=""; $("bovNotes").value="";
        loadBovs();
      })
      .catch(function(){ b.disabled=false;
        $("bovMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was logged.</div>'; });
  });
  // Status changes post immediately and revert on failure: the intro
  // button's optimistic-with-rollback pattern, applied to a <select>.
  document.addEventListener("change",function(e){
    var id=e.target.getAttribute&&e.target.getAttribute("data-bov");
    if(!id)return;
    var sel=e.target,prev=sel.getAttribute("data-prev"),next=sel.value;
    sel.disabled=true;
    fetch("/api/broker/bovs/update",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({id:id,status:next})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        sel.disabled=false;
        if(o.s!==200){
          sel.value=prev;
          // #pipeMsg, not #bovMsg: this select is in a table ROW, while #bovMsg
          // lives inside the log-a-BOV panel, which is closed. An error written
          // there would be invisible to the broker who just changed a stage.
          $("pipeMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't save that change.")+"</div>";
          return;
        }
        sel.setAttribute("data-prev",next);
        loadBovs();   // the stage counts moved
      })
      .catch(function(){
        sel.disabled=false; sel.value=prev;
        $("pipeMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>';
      });
  });
  document.addEventListener("click",function(e){
    var del=e.target.getAttribute&&e.target.getAttribute("data-bovdel");
    if(!del)return;
    if(!confirm("Remove this BOV from your log?"))return;
    fetch("/api/broker/bovs?id="+encodeURIComponent(del),{method:"DELETE",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){ $("pipeMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't remove that BOV.")+"</div>"; return; }
        // noseed: the row just removed must not be re-seeded from intro
        // requests by this same reload if the delete emptied the log. A
        // full page visit still reseeds it.
        loadBovs(true);
      })
      .catch(function(){ $("pipeMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>'; });
  });

  var pending = null;   // {name, csv} held while the broker maps
  var pdfPending = null; // extract result held while the broker confirms

  function doImport(name, csv, mapping, onOk, rows, constants){
    // Whether this import came from the mapping screen decides where its
    // result can be SEEN: #res lives inside #addSec, which is hidden while
    // the panel is open, so a failure written there would be invisible.
    var viaMapper=!!mapInfo;
    var viaPdf=!!rows;
    // Not via the mapper means every word about this import — "Importing", the
    // row counts, the line-numbered errors — is written into #res, which lives
    // inside the uploader panel. Open it, or the broker watches nothing happen.
    if(!viaMapper&&!viaPdf)setAddOpen(true);
    $("pick").disabled=true;
    if(viaMapper){ $("mapGo").disabled=true; $("mapGo").textContent="Importing\\u2026"; }
    if(viaPdf){ $("pdfGo").disabled=true; $("pdfGo").textContent="Importing\\u2026"; }
    $("res").innerHTML='<div class="msg ok">Importing&hellip;</div>';
    var payload={filename:name};
    if(rows){ payload.rows=rows; }
    else {
      payload.csv=csv;
      if(mapping) payload.mapping=mapping;
      // Omitted entirely when nothing was answered, so a file that needed none
      // of this sends byte for byte what it always did.
      if(constants&&Object.keys(constants).length) payload.constants=constants;
    }
    // Line-numbered problems are the point: a broker fixing a spreadsheet
    // needs to know WHICH row, in the numbering Excel shows them.
    function errList(j){
      return (j.errors&&j.errors.length)?"<ul>"+j.errors.map(function(e){
        return "<li>"+esc(e)+"</li>"}).join("")+"</ul>":"";
    }
    // A failed import must never cost the broker their mapping. parseUpload
    // refuses the whole file only when NOT ONE row survived, which is exactly
    // the mismapped-column case (a text column onto price, a day-first date
    // onto deal_date), so this is the moment the screen is most needed. The
    // panel stays open with every dropdown as they left it.
    function failed(msg,errs){
      $("pick").disabled=false;
      // A refused import stops the batch: the rest are named, not attempted
      // past a message the broker has not read yet.
      var more=dropQueue(); if(more)msg=msg+" "+more;
      if(viaMapper&&mapInfo){
        $("mapGo").textContent="Import";
        $("mapGo").disabled=false;
        $("mapMsg").innerHTML=esc(msg)+errs;
        $("mapMsg").classList.remove("hide");
        $("res").innerHTML="";
      }else if(viaPdf&&pdfPending){
        refreshPdfGo();
        $("pdfMsg").innerHTML=esc(msg)+errs;
        $("pdfMsg").classList.remove("hide");
        $("res").innerHTML="";
      }else{
        $("res").innerHTML='<div class="msg bad">'+esc(msg)+errs+"</div>";
      }
    }
    fetch("/api/vault/upload",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        var j=o.j||{};
        if(o.s!==200){ failed(j.error||"That file could not be imported.",errList(j)); return; }
        $("pick").disabled=false;
        if(viaMapper)$("mapGo").textContent="Import";
        // Only now, with rows actually stored, is it safe to throw the
        // mapping away — and it has to happen BEFORE the summary is written,
        // since closing the panel is what makes #res visible again.
        if(onOk)onOk();
        // Closing the mapper is not enough: #res lives inside #addSec, which
        // ships closed, and on the mapper path nothing above has opened it —
        // so the summary, including the line-numbered skips, was being
        // written into a hidden panel and a broker never learned rows were
        // dropped (found on the first real mapper import, 2026-08-10). Same
        // rule as the non-mapper open at the top of doImport: a result must
        // be written somewhere that is showing.
        if(viaMapper||viaPdf)setAddOpen(true);
        // "Imported N" counts what the vault actually STORED. A re-uploaded
        // book is the ordinary case, not an error, so the rows it already
        // had are stated plainly beside it rather than folded into the
        // imported count — which is what used to happen, and which told a
        // broker 16 comps had landed when none had.
        var bits=["Imported "+j.imported+" comp"+(j.imported===1?"":"s")];
        if(j.already)bits.push(j.already+(j.already===1?" was":" were")+" already in your vault");
        if(j.skipped)bits.push(j.skipped+" row"+(j.skipped===1?"":"s")+" skipped");
        if(j.duplicates)bits.push(j.duplicates+" duplicate"+(j.duplicates===1?"":"s")+" in the file");
        // The template's own # notes, normally. Said out loud anyway: a broker
        // whose export happens to have a # row needs to see it did not import,
        // and a skip nobody is told about is the one thing this module does
        // not do.
        if(j.commented)bits.push(j.commented+" note line"+(j.commented===1?"":"s")+" ignored");
        var line=bits.join(" \\u00b7 ");
        if(batchOn)batchLog.push(name+": "+line);
        $("res").innerHTML=batchPrefix()+(batchOn&&!j.skipped?"":'<div class="msg '+(j.skipped?"bad":"ok")+'">'+(batchOn?"":esc(line))+errList(j)+"</div>");
        // Offered only where there is a firm to push to and something new
        // landed. The button carries the import's id so the click can put
        // exactly that import on screen before the ordinary Share-N path
        // runs; see the #res click handler.
        if(myFirm&&j.uploadId&&j.imported>0){
          $("res").innerHTML+='<p class="note"><button type="button" class="lnk" id="resFirm" data-upload="'+escA(j.uploadId)+'">Share this import with '+esc(myFirm.name)+'</button></p>';
        }
        // Open the imported book as a spreadsheet so the next step is
        // fixing a cell, not hunting for Edit on each row. uploadId is
        // already on the upload response; imported:0 means nothing new
        // landed (a re-upload of an existing book) and those rows still
        // belong to the earlier import.
        if(j.uploadId&&j.imported>0){
          sheetMode=true;
          sheetUploadId=j.uploadId;
        }
        load();
        // The next spreadsheet in a batch starts only now, with these rows
        // actually stored.
        drainCsvQueue();
      })
      .catch(function(){ failed("The upload did not reach the server. Nothing was saved.",""); });
  }

  // Anything the extract route reads: a table PDF, or a screenshot or photo of
  // one. This is a courtesy check only, so a broker learns in the browser
  // rather than after a 4 MB round trip; the file the vendor actually sees is
  // decided by the server sniffing its bytes, never by this name or this type.
  function isExtractFile(file){
    var n=String(file&&file.name||"").toLowerCase();
    var t=String(file&&file.type||"");
    return t==="application/pdf" || /\\.pdf$/.test(n) ||
           t==="image/png" || t==="image/jpeg" || t==="image/webp" ||
           /\\.(png|jpe?g|webp)$/.test(n);
  }
  function isCsvFile(file){
    var n=String(file&&file.name||"").toLowerCase();
    var t=String(file&&file.type||"");
    return t==="text/csv" || /\\.csv$/.test(n);
  }

  function upload(file){
    if(!file)return;
    if(!isExtractFile(file) && !isCsvFile(file)){
      $("res").innerHTML='<div class="msg bad">Use a .csv, a .pdf, or a screenshot (PNG, JPEG or WebP).</div>';
      return;
    }
    if(file.size>4*1024*1024){
      $("res").innerHTML='<div class="msg bad">That file is too large to read. The limit is 4 MB.</div>';
      return;
    }
    if(isExtractFile(file)){ extractFile(file); return; }
    $("pick").disabled=true; $("res").innerHTML=batchPrefix()+'<div class="msg ok">Reading '+esc(file.name)+"&hellip;</div>";
    var fr=new FileReader();
    fr.onerror=function(){ $("pick").disabled=false; $("res").innerHTML='<div class="msg bad">Could not read that file.</div>'; };
    fr.onload=function(){
      var csv=String(fr.result||"");
      fetch("/api/vault/inspect",{method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify({csv:csv})})
        .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
        .then(function(o){
          $("pick").disabled=false;
          if(o.s!==200){
            $("res").innerHTML='<div class="msg bad">'+esc((o.j&&o.j.error)||"That file could not be read.")+"</div>";
            return;
          }
          // A file already in our own column names skips the screen entirely.
          if(o.j.cleanTemplate){ doImport(file.name,csv,null); return; }
          pending={name:file.name,csv:csv};
          openMapper(o.j);
        })
        // Deliberately NOT a silent fallback to a strict upload: that would
        // reintroduce the old rejection message under a different cause.
        .catch(function(){ $("pick").disabled=false;
          $("res").innerHTML='<div class="msg bad">Could not reach the server to read that file. Nothing was saved.</div>'; });
    };
    fr.readAsText(file);
  }

  // One file to the extract route: resolves {s,j}, rejects on an unreadable
  // file or an unreachable server. Shared by the single-file path and the
  // batch below so the two cannot post different shapes.
  function readExtract(file){
    return new Promise(function(resolve,reject){
      var fr=new FileReader();
      fr.onerror=function(){ reject(new Error("read")); };
      fr.onload=function(){
        var url=String(fr.result||"");
        var b64=url.indexOf(",")>=0?url.split(",")[1]:url;
        fetch("/api/vault/extract",{method:"POST",credentials:"same-origin",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({filename:file.name,file:b64})})
          .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
          .then(resolve,reject);
      };
      fr.readAsDataURL(file);
    });
  }

  function extractFile(file){
    setAddOpen(true);
    $("pick").disabled=true;
    $("res").innerHTML=batchPrefix()+'<div class="msg ok">Reading the table in '+esc(file.name)+"&hellip;</div>";
    readExtract(file)
      .then(function(o){
        $("pick").disabled=false;
        if(o.s!==200){
          $("res").innerHTML=batchPrefix()+'<div class="msg bad">'+esc((o.j&&o.j.error)||"Could not read that file. Nothing was saved.")+"</div>";
          return;
        }
        $("res").innerHTML=batchPrefix();
        openPdfPreview(o.j);
      })
      .catch(function(){ $("pick").disabled=false;
        $("res").innerHTML=batchPrefix()+'<div class="msg bad">Could not reach the server to read that file. Nothing was saved.</div>'; });
  }

  // ---------------------------------------------------------------------------
  // Several files at once (2026-09-02).
  //
  // The one file input takes many, and so does the drop zone. PDFs and
  // screenshots are read one after another — each its own /extract call,
  // because that route is rate-limited and a merged upload is not a thing it
  // takes — and land in ONE confirm table, with a row naming each file above
  // its rows. Spreadsheets QUEUE and go through the ordinary path one at a
  // time, because the mapper is a screen a broker answers and two of them
  // cannot be open at once. Order: the extract batch first, then the CSVs,
  // and the next CSV starts only when the previous import has STORED its
  // rows (doImport's success) — never on a failure or a cancel, which drop
  // the rest of the queue by name rather than carrying on past a refusal
  // the broker has not read yet.
  //
  // #res is one line at a time everywhere else, and a batch would overwrite
  // "Imported 12 comps" from a.csv with "Reading b.csv…". So a batch keeps a
  // log, and every write to #res during one starts with it (batchPrefix).
  // ---------------------------------------------------------------------------
  var csvQueue=[], batchOn=false, batchLog=[];
  function batchPrefix(){
    return batchOn&&batchLog.length?batchLog.map(function(l){return '<div class="msg ok">'+esc(l)+"</div>"}).join(""):"";
  }
  function drainCsvQueue(){
    var next=csvQueue.shift();
    if(next)upload(next);
  }
  // Drops what is still waiting and says which files those were, so a stop
  // in the middle of a batch is never a silent one.
  function dropQueue(){
    if(!csvQueue.length)return "";
    var names=csvQueue.map(function(f){return f.name});
    csvQueue=[];
    return names.length+" more file"+(names.length===1?"":"s")+" you chose "+(names.length===1?"was":"were")+" not imported: "+names.join(", ")+".";
  }
  function uploadMany(list){
    var all=Array.prototype.slice.call(list||[]).filter(Boolean);
    if(!all.length)return;
    csvQueue=[]; batchLog=[];
    if(all.length===1){ batchOn=false; upload(all[0]); return; }
    batchOn=true;
    var bad=[],big=[],ex=[],csvs=[];
    all.forEach(function(f){
      if(!isExtractFile(f)&&!isCsvFile(f))bad.push(f.name);
      else if(f.size>4*1024*1024)big.push(f.name);
      else if(isExtractFile(f))ex.push(f);
      else csvs.push(f);
    });
    if(bad.length)batchLog.push("Skipped "+bad.join(", ")+" \\u2014 use a .csv, a .pdf, or a screenshot (PNG, JPEG or WebP).");
    if(big.length)batchLog.push("Skipped "+big.join(", ")+" \\u2014 over the 4 MB limit.");
    setAddOpen(true);
    $("res").innerHTML=batchPrefix();
    csvQueue=csvs;
    if(ex.length){ extractMany(ex); return; }
    drainCsvQueue();
  }
  function extractMany(list){
    setAddOpen(true);
    $("pick").disabled=true;
    var rows=[],names=[],failed=[],i=0;
    function done(){
      $("pick").disabled=false;
      if(failed.length)batchLog.push("Could not read "+failed.join(", ")+". Nothing was saved from "+(failed.length===1?"it":"them")+".");
      $("res").innerHTML=batchPrefix();
      if(!names.length){ drainCsvQueue(); return; }
      openPdfPreview({filename:names.length===1?names[0]:names.length+" files: "+names.join(", "),rows:rows,files:names.length});
    }
    function step(){
      if(i>=list.length){ done(); return; }
      var file=list[i++];
      $("res").innerHTML=batchPrefix()+'<div class="msg ok">Reading the table in '+esc(file.name)+" ("+i+" of "+list.length+")&hellip;</div>";
      readExtract(file)
        .then(function(o){
          if(o.s!==200){ failed.push(file.name+((o.j&&o.j.error)?" ("+o.j.error+")":"")); }
          else{
            ((o.j&&o.j.rows)||[]).forEach(function(r){ r.source=file.name; rows.push(r); });
            names.push(file.name);
          }
          step();
        })
        .catch(function(){ failed.push(file.name); step(); });
    }
    step();
  }

  var mapInfo=null;

  // The dropdown's LIST is served by /api/vault/inspect (targets), so it can
  // never drift from TEMPLATE_COLUMNS + OPTIONAL_SPEC_COLUMNS. This only
  // decides how each served value is SPOKEN: a broker meeting this screen for
  // the first time should not have to read twenty-four database identifiers.
  // Anything without a label falls back to its raw value, so a per-type field
  // added later still appears rather than vanishing.
  // Keep in step with broker-vault.js REQUIRED_TARGETS / TEMPLATE_COLUMNS /
  // OPTIONAL_SPEC_COLUMNS. This page cannot require that module.
  var PDF_REQUIRED=["address","property_type","transaction","deal_date"];
  var PDF_KEYS=["address","property_type","transaction","deal_date","price","size_sqft","cap_rate","rent_psf","rent_basis","lease_type","lease_expiry","option_notice_date","tenancy","year_built","notes","lat","lng","clear_height","dock_doors","building_class","floor_plate","center_type","anchor_tenant","units","price_per_unit","lot_acres","price_per_acre","zoning","beds_baths"];
  var TARGET_LABELS={
    address:"Address", property_type:"Property type", transaction:"Sale or lease",
    deal_date:"Deal date", price:"Price", size_sqft:"Size (SF)", cap_rate:"Cap rate",
    tenancy:"Tenancy", year_built:"Year built", notes:"Notes",
    lat:"Latitude", lng:"Longitude",
    clear_height:"Clear height", dock_doors:"Dock doors",
    building_class:"Building class", floor_plate:"Floor plate",
    center_type:"Center type", anchor_tenant:"Anchor tenant",
    units:"Units", price_per_unit:"Price per unit",
    lot_acres:"Lot (acres)", price_per_acre:"Price per acre", zoning:"Zoning",
    beds_baths:"Beds / baths",
    // Migration 029's lease fields reached PDF_KEYS and never reached here, so
    // a lease sheet headed its columns "rent_psf" and "rent_basis" — our own
    // column names, printed at a broker as though they were words. tLabel
    // falls back to the key, which is why nothing failed and nobody saw it
    // until a lease row was actually photographed. A test now pins every
    // PDF_KEYS entry to a label.
    rent_psf:"Rent ($/SF)", rent_basis:"Rent basis", lease_type:"Lease type",
    lease_expiry:"Lease expiry", option_notice_date:"Option notice date",
    // Not fields we store. A sheet that keeps the address in three columns can
    // point at the other two, and parseUpload builds one address out of them
    // and drops them. Labelled so nobody reads them as somewhere a city gets
    // filed — there is no city column in the vault.
    address_city:"City (joins the address)", address_state:"State (joins the address)"
  };
  function tLabel(t){ return TARGET_LABELS[t]||t }
  // NO_COLUMN_HELP lived here until 2026-09-01. It explained the dead end a
  // CoStar or MLS sale-comps export reached — no deal-type column at all,
  // because every row is a sale — and told the broker to go add one, on the
  // grounds that value transformation was out of scope and no dropdown could
  // rescue that file. A dropdown rescues it now: both fields it covered are
  // answerable once for the whole file, right above the Import button, so
  // every word of that advice had become obsolete. The two required fields
  // that can still be genuinely unclaimable are the address and the deal
  // date, which are per-row by nature and can never be answered once — those
  // fall to the single generic sentence below, which is what it was always
  // for.
  // The raw header the broker actually sees in their spreadsheet, for a
  // normalized key. column_4 is our own synthetic name for a header that
  // normalizes to nothing (a "$" price column); it exists nowhere in their
  // world, so it may key a <select> but must never be shown to them.
  function rawHeader(n){
    var i=(mapInfo.normalized||[]).indexOf(n);
    return i<0?n:String((mapInfo.headers||[])[i]);
  }

  // The only two fields a broker may answer once for a whole file, and the
  // limit is the point: both are small closed lists, so one answer is either
  // right for every row or obviously wrong for all of them. A price or a date
  // answered once would be wrong per row and invisible. The server holds the
  // same list (SHEET_CONSTANT_TARGETS) and serves it as constantTargets; these
  // are the words and the options, which only exist here.
  var CONST_OPTIONS={
    property_type:["Industrial","Office","Retail","Multifamily","Land","Residential"],
    transaction:["Sale","Lease"],
    rent_basis:["Annual","Monthly"]
  };
  var CONST_ASK={
    property_type:"Your file doesn't say what kind of property these are. What are they?",
    transaction:"Your file doesn't say whether these were sales or leases. Which are they?",
    // No default, and the reason is the sharpest of the three: California
    // industrial and retail quote rent MONTHLY while most of the country
    // quotes annually, so $1.35/SF is an ordinary monthly rent and an
    // impossible annual one. A guess either way stores a figure 12x wrong.
    rent_basis:"Your file gives a rent but doesn't say whether it's per year or per month. Which is it?"
  };
  // The answers live HERE rather than being read back off the DOM. The set of
  // questions changes as columns are mapped, so the row is rebuilt when that
  // set changes — and a rebuild would throw away a half-made choice if the
  // <select> were the only place it was kept. Reset per file by openMapper: a
  // new spreadsheet must never inherit the last one's answers.
  var constAnswers={}, constShown="";
  function syncConstants(wants){
    var key=wants.join(",");
    if(key!==constShown){
      constShown=key;
      $("mapConst").innerHTML=wants.map(function(t){
        var chosen=constAnswers[t]||"";
        return '<div class="crow" style="margin:6px 0">'+
          '<label for="mc_'+esc(t)+'">'+esc(CONST_ASK[t])+"</label> "+
          '<select data-cval="'+esc(t)+'" id="mc_'+esc(t)+'">'+
          '<option value=""'+(chosen?"":" selected")+">&mdash; choose &mdash;</option>"+
          CONST_OPTIONS[t].map(function(v){
            return '<option value="'+esc(v)+'"'+(chosen===v?" selected":"")+">"+esc(v)+"</option>";
          }).join("")+"</select></div>";
      }).join("");
      Array.prototype.forEach.call($("mapConst").querySelectorAll("select"),function(s){
        s.addEventListener("change",function(){
          constAnswers[s.getAttribute("data-cval")]=s.value;
          refreshMapper();
        });
      });
    }
    if(wants.length)$("mapConst").classList.remove("hide");
    else $("mapConst").classList.add("hide");
  }
  // Only a question currently ON SCREEN counts. A field a column has since
  // claimed must not still be sending an answer the broker can no longer see:
  // the server refuses that as a contradiction, correctly but bafflingly. The
  // answer is remembered, though, so re-unmapping the column brings it back.
  function currentConstants(){
    var c={};
    (constShown?constShown.split(","):[]).forEach(function(t){
      if(constAnswers[t])c[t]=constAnswers[t];
    });
    return c;
  }

  function openMapper(info){
    mapInfo=info;
    $("res").innerHTML="";
    $("mapRows").textContent=String(info.rowCount);
    // Remembered beats suggested: it is the broker's own previous decision.
    var start={};
    Object.keys(info.suggested||{}).forEach(function(k){ start[k]=info.suggested[k] });
    Object.keys(info.remembered||{}).forEach(function(k){
      if(info.normalized.indexOf(k)>=0)start[k]=info.remembered[k];
    });
    var rows=info.normalized.map(function(n,i){
      if(!n)return "";
      var opts=['<option value="">&mdash; ignore &mdash;</option>'].concat(
        (info.targets||[]).map(function(t){
          return '<option value="'+esc(t)+'"'+(start[n]===t?" selected":"")+">"+esc(tLabel(t))+"</option>";
        })).join("");
      var samp=(info.samples[n]||[]).map(function(v){
        return '<span class="samp">'+esc(v)+"</span>";
      }).join(" ");
      return "<tr><td>"+esc(info.headers[i])+'</td><td><select data-src="'+esc(n)+'">'+opts+
             '</select></td><td class="note">'+samp+"</td></tr>";
    }).join("");
    $("mapBody").innerHTML=rows;
    // Ambiguity is a decision we deliberately did NOT make for them (two
    // columns could each be the price, so neither is pre-selected). Saying so
    // is the difference between a considered blank and an oversight.
    var preset=Object.keys(start).map(function(k){return start[k]});
    var amb=(info.ambiguous||[]).filter(function(t){return preset.indexOf(t)<0});
    if(amb.length){
      $("mapAmbig").textContent="More than one of your columns could be the "+
        amb.map(function(t){return tLabel(t).toLowerCase()}).join(", ")+
        ", so we left "+(amb.length===1?"that one":"those")+" for you to choose.";
      $("mapAmbig").classList.remove("hide");
    }else{
      $("mapAmbig").textContent="";
      $("mapAmbig").classList.add("hide");
    }
    $("mapSec").classList.remove("hide");
    $("pdfSec").classList.add("hide");
    $("addSec").classList.add("hide");
    // Hidden too, or an empty vault keeps the book invitation on screen
    // above the panel that replaced it. closeMapper puts it back.
    $("bookEmpty").classList.add("hide");
    Array.prototype.forEach.call($("mapBody").querySelectorAll("select"),function(s){
      s.addEventListener("change",refreshMapper);
    });
    // A new file starts with no answers, and no question row rendered.
    constAnswers={}; constShown=""; $("mapConst").innerHTML="";
    refreshMapper();
    $("mapSec").scrollIntoView({behavior:"smooth",block:"start"});
  }

  function currentMapping(){
    var m={};
    Array.prototype.forEach.call($("mapBody").querySelectorAll("select"),function(s){
      if(s.value)m[s.getAttribute("data-src")]=s.value;
    });
    return m;
  }

  function refreshMapper(){
    var m=currentMapping(), claimed=Object.keys(m).map(function(k){return m[k]});
    var unclaimed=(mapInfo.required||[]).filter(function(t){return claimed.indexOf(t)<0});
    // Offer the whole-file answer for any required field no column is giving
    // us, and deliberately NOT gated on every other column being mapped the
    // way NO_COLUMN_HELP is. A real sheet always leaves something unmapped
    // (Tenant, Suite), so that gate would mean this never appears on exactly
    // the files it exists for.
    // rent_basis is not required in general — it is required of any row that
    // carries a rent, and whether the file has rents is decided by whether a
    // rent column was mapped. So it is asked exactly when a rent column is
    // mapped and no basis column is, which is the ordinary shape of a leasing
    // book: the rate is stated and the basis goes without saying.
    var askable=(mapInfo.constantTargets||[]).filter(function(t){return CONST_OPTIONS[t]});
    var offering=unclaimed.filter(function(t){return askable.indexOf(t)>=0});
    if(askable.indexOf("rent_basis")>=0&&
       claimed.indexOf("rent_psf")>=0&&claimed.indexOf("rent_basis")<0){
      offering.push("rent_basis");
    }
    syncConstants(offering);
    var answered=currentConstants();
    var missing=unclaimed.filter(function(t){return !answered[t]});
    // Naming the ignored columns is half the point: importing while quietly
    // dropping a column is the silent failure this screen exists to end. It
    // names the RAW header, never the normalized key — "column_4" is our
    // internal name for their "$" column and means nothing to them.
    var ignored=(mapInfo.normalized||[]).filter(function(n){return n&&!m[n]}).map(rawHeader);
    $("mapIgnored").textContent=ignored.length
      ? "Will be ignored: "+ignored.join(", ")
      : "Every column is mapped.";

    // The second half of validateMapping's contract, which the server enforces
    // and this screen used not to mirror: two columns claiming one field is
    // refused server-side, and openMapper can produce it without the broker
    // doing anything odd (suggested and remembered are each duplicate-free,
    // their union is not). Import must not be offered for a mapping we know
    // will be refused.
    var by={}, dupes=[];
    Object.keys(m).forEach(function(k){
      var t=m[k];
      if(!by[t]){ by[t]=[]; } else if(dupes.indexOf(t)<0){ dupes.push(t); }
      by[t].push(rawHeader(k));
    });

    var lines=[];
    dupes.forEach(function(t){
      lines.push(by[t].join(" and ")+" are both mapped to "+tLabel(t)+". Pick one.");
    });
    if(missing.length){
      lines.push("Still needed: "+missing.map(tLabel).join(", ")+".");
      // Unclaimable, not merely unclaimed. The question is whether the BROKER
      // has a column left to give this field, not whether WE managed to guess
      // one: a file can carry a perfectly good "Deal" column that no alias
      // recognises. While any column is still unmapped, a dropdown above fixes
      // this, and the extra sentence would be a confidently wrong instruction
      // to go edit a spreadsheet that was already fine.
      var anyFree=(mapInfo.normalized||[]).some(function(n){ return n&&!m[n] });
      // A field we are offering to answer above is never "go edit your
      // spreadsheet": the fix is the dropdown sitting right there, and telling
      // them to add a column instead would be advice we just made obsolete.
      var stuck=(anyFree?[]:missing).filter(function(t){return offering.indexOf(t)<0});
      // One sentence for whatever is left rather than one each: three
      // near-identical lines under a dead button is noise, not help.
      if(stuck.length){
        lines.push("Nothing in your file looks like the "+
          stuck.map(function(t){return tLabel(t).toLowerCase()}).join(" or ")+", so "+
          (stuck.length===1?"that column has":"those columns have")+
          " to be added before this file can be imported.");
      }
    }
    if(lines.length){
      $("mapMsg").textContent=lines.join(" ");
      $("mapMsg").classList.remove("hide");
      $("mapGo").disabled=true;
    }else{
      $("mapMsg").textContent="";
      $("mapMsg").classList.add("hide");
      $("mapGo").disabled=false;
    }
  }

  function closeMapper(){
    $("mapSec").classList.add("hide");
    // NOT an unconditional un-hide of #addSec: applyFirstRun keeps it
    // closed on an empty book, where #bookEmpty owns the Choose button,
    // and restoring the panel there leaves Choose twice on one page.
    applyFirstRun(firstRunCounts[0],firstRunCounts[1]);
    pending=null; mapInfo=null;
  }

  $("mapGo").addEventListener("click",function(){
    if(!pending)return;
    var p=pending;
    // The panel closes on SUCCESS only. Closing here would clear the mapping,
    // the held file and every dropdown before knowing whether the import
    // worked, leaving a re-pick and a full re-map as the only way back.
    doImport(p.name,p.csv,currentMapping(),closeMapper,null,currentConstants());
  });
  $("mapCancel").addEventListener("click",function(){
    closeMapper();
    var more=dropQueue();
    $("res").innerHTML=batchPrefix()+'<div class="msg ok">Cancelled. Nothing was saved.'+(more?" "+esc(more):"")+'</div>';
  });

  // The confirm table's own display rule, and it is cellDisplay's CONVENTION
  // rather than a second one: show the formatted figure, hold the raw one,
  // swap to raw on focus. It exists because this table is read against the
  // source document — a page printing $410,000.00 beside a cell reading
  // 410000 makes a person translate every figure before they can agree with
  // it, which is most of what made verifying twelve correct rows take four
  // minutes fifty-one (docs/evals/extract-2026-08-28-verdict-final.md).
  //
  // The GUARD is why this is not a bare cellDisplay call. The comps table's
  // values come from the server already through normalizeRow, so they are
  // numeric and money() can have them unconditionally. These have not been
  // normalized yet — and the rows a broker most needs to read are exactly the
  // ones holding something normalizeRow REFUSED, like "1.2M" or "call for
  // price" — where Number() yields NaN and money() would render "$NaN",
  // erasing the very string they need in order to fix it. So format only what
  // is genuinely a number, and show everything else exactly as it was read.
  function pdfDisplay(k,v){
    if(v==null||v==="")return "";
    var s=String(v);
    var bare=s.replace(/,/g,"");
    if(!/^-?\\d+(\\.\\d+)?$/.test(bare))return s;
    return cellDisplay(k,bare);
  }

  function pdfColumns(rows){
    var cols=PDF_REQUIRED.slice();
    PDF_KEYS.forEach(function(k){
      if(cols.indexOf(k)>=0)return;
      var used=(rows||[]).some(function(r){
        var v=r.values&&r.values[k];
        return v!=null && String(v)!=="";
      });
      if(used)cols.push(k);
    });
    return cols;
  }

  function refreshPdfGo(){
    var n=0;
    ((pdfPending&&pdfPending.rows)||[]).forEach(function(r){ if(r.checked)n++; });
    $("pdfGo").textContent="Import "+n+" comps";
    $("pdfGo").disabled=n===0;
  }

  function collectPdfRows(){
    var out=[];
    ((pdfPending&&pdfPending.rows)||[]).forEach(function(r){
      if(!r.checked)return;
      var row={};
      Object.keys(r.values||{}).forEach(function(k){
        var v=r.values[k];
        if(v!=null && String(v)!=="")row[k]=String(v);
      });
      out.push(row);
    });
    return out;
  }

  // ⚠ MIRROR of broker-vault.js's refusal copy ("rent_basis is required with
  // a rent — …"). The needle is how the basis selector knows which part of a
  // row's error IT can cure; pinned by test against the module's own message,
  // because a reworded refusal would silently stop curing anything. The
  // server re-validates every imported row regardless (normalizeRow's verdict
  // is recomputed at import, never trusted from this screen).
  var RENT_BASIS_NEEDLE="rent_basis is required with a rent";
  function stripBasisError(err){
    if(err==null)return null;
    var parts=String(err).split("; ").filter(function(p){
      return p.indexOf(RENT_BASIS_NEEDLE)<0;
    });
    return parts.length?parts.join("; "):null;
  }
  // A row the sheet-level basis may write into: it has a rent, and its basis
  // is either absent or something THIS selector wrote earlier (stampedBasis),
  // so re-choosing corrects a mis-pick without ever touching a cell a person
  // typed into.
  function pdfNeedsBasis(r){
    var v=r&&r.values?r.values:{};
    var hasRent=v.rent_psf!=null&&String(v.rent_psf)!=="";
    var hasBasis=v.rent_basis!=null&&String(v.rent_basis)!=="";
    return hasRent&&(!hasBasis||r.stampedBasis===true);
  }

  function openPdfPreview(info){
    pdfPending=info||{filename:"",rows:[]};
    var rows=pdfPending.rows||[];
    rows.forEach(function(r){
      r.values=r.values||{};
      // Derived only the FIRST time this row is drawn: the basis selector
      // re-renders the table, and a checkbox the broker set by hand must
      // survive that.
      if(typeof r.checked!=="boolean")r.checked=r.error==null;
    });
    var cols=pdfColumns(rows);
    $("pdfCount").textContent=String(rows.length);
    $("pdfName").textContent=pdfPending.filename||"";
    $("pdfHead").innerHTML="<tr><th></th>"+cols.map(function(k){return "<th"+(fieldHint(k)?' title="'+escA(fieldHint(k))+'"':"")+">"+esc(tLabel(k))+"</th>";}).join("")+"</tr>";
    var multi=(pdfPending.files||0)>1, lastSrc=null;
    $("pdfBody").innerHTML=rows.map(function(r,i){
      // A merged batch names each file above its rows. Not a column: a cell
      // would ride into the upload as a field, and the file is not a fact
      // about the deal.
      var head="";
      if(multi&&r.source&&r.source!==lastSrc){ lastSrc=r.source; head='<tr class="pdf-src"><td colspan="'+(cols.length+1)+'">'+esc(r.source)+"</td></tr>"; }
      var tint=r.error!=null?' class="need-fix"':"";
      var cb='<input type="checkbox" data-i="'+i+'"'+(r.checked?" checked":"")+"/>";
      var cells=cols.map(function(k){
        var raw=r.values[k]==null?"":String(r.values[k]);
        return '<td><input type="text" data-i="'+i+'" data-k="'+escA(k)+
          '" data-raw="'+escA(raw)+'" value="'+escA(pdfDisplay(k,raw))+'"/></td>';
      }).join("");
      return head+"<tr"+tint+"><td>"+cb+"</td>"+cells+"</tr>";
    }).join("");
    var n=rows.length, ready=0, fail=0, allDate=true;
    rows.forEach(function(r){
      if(r.error==null)ready++;
      else { fail++; if(!/date/i.test(String(r.error)))allDate=false; }
    });
    var failBit=fail?(allDate?fail+" need a date":fail+" need a fix"):"";
    $("pdfStrip").textContent=n+" found \\u00b7 "+ready+" ready"+(failBit?" \\u00b7 "+failBit:"");
    // The sheet-level basis row, only when a row can actually take it, with
    // the current choice surviving a re-render.
    var needsBasis=rows.some(pdfNeedsBasis);
    $("pdfBasisRow").classList.toggle("hide",!needsBasis);
    $("pdfBasis").value=pdfPending.rentBasis||"";
    $("pdfMsg").innerHTML="";
    $("pdfMsg").classList.add("hide");
    // Re-renders (the basis selector) must not smooth-scroll the page back to
    // a section the broker is already looking at.
    var alreadyOpen=!$("pdfSec").classList.contains("hide");
    $("mapSec").classList.add("hide");
    $("pdfSec").classList.remove("hide");
    $("addSec").classList.add("hide");
    $("bookEmpty").classList.add("hide");
    Array.prototype.forEach.call($("pdfBody").querySelectorAll("input"),function(inp){
      var i=Number(inp.getAttribute("data-i"));
      if(inp.type==="checkbox"){
        inp.addEventListener("change",function(){
          if(pdfPending.rows[i])pdfPending.rows[i].checked=inp.checked;
          refreshPdfGo();
        });
      }else{
        // data-raw is what the row actually holds and what gets imported; the
        // value attribute is only ever what is being SHOWN. Focus swaps to raw
        // so a broker edits 410000 rather than deciding whether the $ and the
        // commas in front of them are part of what they are about to retype;
        // blur puts the formatted reading back.
        inp.addEventListener("focus",function(){
          inp.value=inp.getAttribute("data-raw")||"";
        });
        inp.addEventListener("input",function(){
          inp.setAttribute("data-raw",inp.value);
          if(pdfPending.rows[i])pdfPending.rows[i].values[inp.getAttribute("data-k")]=inp.value;
        });
        inp.addEventListener("blur",function(){
          inp.value=pdfDisplay(inp.getAttribute("data-k"),inp.getAttribute("data-raw")||"");
        });
      }
    });
    refreshPdfGo();
    if(!alreadyOpen)$("pdfSec").scrollIntoView({behavior:"smooth",block:"start"});
  }

  // Choosing a basis writes it into every row that needs one — visibly, cell
  // by cell — and cures the rows whose ONLY blocker it was: their error
  // clears and they check themselves. A row with other problems keeps its
  // remaining errors and its tint. Registered once; the selector lives
  // outside #pdfBody so it survives the re-render it triggers.
  $("pdfBasis").addEventListener("change",function(){
    if(!pdfPending)return;
    var chosen=$("pdfBasis").value;
    if(chosen!=="annual"&&chosen!=="monthly")return;
    pdfPending.rentBasis=chosen;
    (pdfPending.rows||[]).forEach(function(r){
      if(!pdfNeedsBasis(r))return;
      r.values.rent_basis=chosen;
      r.stampedBasis=true;
      var left=stripBasisError(r.error);
      if(left!==r.error){
        r.error=left;
        if(left==null)r.checked=true;
      }
    });
    openPdfPreview(pdfPending);
  });

  function closePdfPreview(){
    $("pdfSec").classList.add("hide");
    pdfPending=null;
    applyFirstRun(firstRunCounts[0],firstRunCounts[1]);
  }

  $("pdfGo").addEventListener("click",function(){
    if(!pdfPending)return;
    var rows=collectPdfRows();
    if(!rows.length)return;
    doImport(pdfPending.filename,null,null,closePdfPreview,rows);
  });
  $("pdfCancel").addEventListener("click",function(){
    closePdfPreview();
    var more=dropQueue();
    $("res").innerHTML=batchPrefix()+'<div class="msg ok">Cancelled. Nothing was saved.'+(more?" "+esc(more):"")+'</div>';
  });

  $("pick").addEventListener("click",function(){ $("file").click() });
  // Step 1's button is the same door as #pick — one file input on the whole
  // page, so an upload started here lands in the same handler and the same
  // result message.
  $("bookPick").addEventListener("click",function(){ $("file").click() });
  $("file").addEventListener("change",function(e){ uploadMany(e.target.files); e.target.value=""; });
  ["dragenter","dragover"].forEach(function(ev){ $("drop").addEventListener(ev,function(e){
    e.preventDefault(); $("drop").classList.add("over"); })});
  ["dragleave","drop"].forEach(function(ev){ $("drop").addEventListener(ev,function(e){
    e.preventDefault(); $("drop").classList.remove("over"); })});
  $("drop").addEventListener("drop",function(e){ uploadMany(e.dataTransfer.files) });
  // The dropzone now sits in a panel that is closed by default, so a file
  // dragged at the page would have nowhere to land and the feature would look
  // deleted. Dragging a FILE anywhere over the window opens the panel; from
  // there #drop's own handlers above behave exactly as they always have.
  // Guarded on the deck being visible: a 403 gate hides #app, and opening
  // the panel behind a hidden deck is a control that does nothing.
  ["dragenter","dragover"].forEach(function(ev){
    document.addEventListener(ev,function(e){
      var t=e.dataTransfer&&e.dataTransfer.types;
      if(!t||Array.prototype.indexOf.call(t,"Files")<0)return;
      e.preventDefault();
      if(!addOpen&&$("deckBook").className.indexOf("hide")<0)setAddOpen(true);
    });
  });
  $("addToggle").addEventListener("click",function(){
    setAddOpen(!addOpen);
    if(addOpen)$("addSec").scrollIntoView({behavior:"smooth",block:"nearest"});
  });
  $("bovToggle").addEventListener("click",function(){
    setBovOpen(!bovOpen);
    if(bovOpen)$("bovAddSec").scrollIntoView({behavior:"smooth",block:"nearest"});
  });

  // ---- Add one comp by hand ----------------------------------------------
  // Per-type columns, mirroring TYPE_COMP_FIELDS in server.js. A field the
  // chosen type does not use is not rendered, so a broker is never asked for
  // an Industrial clear height on a Multifamily deal. The map's own keys are
  // also the property-type list the select offers, so there is one list to
  // keep in step rather than two.
  // ⚠ A FOURTH copy of the per-type field map. TYPE_COMP_FIELDS in
  // server.js is the source of truth (VAULT.PROPERTY_TYPES/
  // OPTIONAL_SPEC_COLUMNS in broker-vault.js are its mirror for the vault); a
  // field added there through the add-comp-field skill will import, store,
  // export and display correctly but never appear on this form unless this
  // map is updated too. test/vault-page.test.js pins Object.keys(TYPE_FIELDS)
  // against VAULT.PROPERTY_TYPES and the union of its values against
  // VAULT.OPTIONAL_SPEC_COLUMNS, so drift here fails the build instead of
  // shipping silently.
  var TYPE_FIELDS={
    Industrial:["clear_height","dock_doors"],
    Office:["building_class","floor_plate"],
    Retail:["center_type","anchor_tenant"],
    Multifamily:["units","price_per_unit"],
    Land:["lot_acres","price_per_acre","zoning"],
    Residential:["beds_baths"],
  };
  var TYPE_FIELD_LABELS={clear_height:"Clear height",dock_doors:"Dock doors",
    building_class:"Building class",floor_plate:"Floor plate",
    center_type:"Center type",anchor_tenant:"Anchor tenant",
    units:"Units",price_per_unit:"Price/unit",
    lot_acres:"Lot acres",price_per_acre:"Price/acre",zoning:"Zoning",
    beds_baths:"Beds/baths"};
  // Everything TEMPLATE_COLUMNS/normalizeRow in broker-vault.js accepts
  // outside the per-type fields above. Field ids are "addComp_"+this, so the
  // submit handler below builds the row generically instead of naming every
  // input twice.
  var BASE_FIELDS=["address","property_type","transaction","deal_date",
                   "price","size_sqft","cap_rate","rent_psf","rent_basis","lease_type",
                   "tenancy","year_built","notes","lat","lng"];
  $("addComp_property_type").innerHTML=Object.keys(TYPE_FIELDS)
    .map(function(t){return "<option>"+t+"</option>"}).join("");
  function renderAddTypeFields(){
    var fs=TYPE_FIELDS[$("addComp_property_type").value]||[];
    $("addTypeFields").innerHTML=fs.map(function(f){
      return "<label>"+esc(TYPE_FIELD_LABELS[f]||f)+
        ' <input id="addComp_'+f+'" type="text" placeholder="optional"/></label>';
    }).join("");
  }
  $("addComp_property_type").addEventListener("change",renderAddTypeFields);
  renderAddTypeFields();

  // A second message channel, deliberately not compMsg. compMsg sits at the
  // top of #compsSec, and the add form lives inside #addSec, well above it
  // in document order with the market rollup and gut-check panels between
  // them for any broker who already has a book — exactly the broker "add
  // one by hand" is for. Writing the result there would leave it below the
  // fold with no scroll, no focus move and nothing on screen to say the
  // click did anything. This one lives right under the button that caused
  // it instead, and carries aria-live so a screen reader still announces it
  // without a focus jump. compMsg itself is untouched: it is still exactly
  // right for the row-level edit/delete controls a few pixels above it.
  function addCompMsg(text,bad){
    var el=$("addCompMsg");
    el.className=text?("msg "+(bad?"bad":"ok")):"msg hide";
    el.textContent=text||"";
  }

  async function addComp(){
    var typeFields=TYPE_FIELDS[$("addComp_property_type").value]||[];
    var body={};
    BASE_FIELDS.concat(typeFields).forEach(function(f){
      var el=$("addComp_"+f);
      // An untouched field is omitted rather than sent as "": normalizeRow
      // treats "left blank" and "explicitly cleared" the same way already,
      // and sending every empty string would just be noise on the wire.
      if(el&&el.value.trim())body[f]=el.value.trim();
    });
    var b=$("addCompBtn"); b.disabled=true;
    var r;
    try{
      r=await fetch("/api/vault/comp",{method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    }catch(err){
      // A rejected fetch (offline, DNS, a dropped connection) never reaches
      // the r.ok check below, and without this the button was left disabled
      // forever — the form was dead until reload.
      b.disabled=false;
      return addCompMsg("That didn't reach the server. Nothing was changed.",true);
    }
    var j=await r.json().catch(function(){return{};});
    b.disabled=false;
    // The server returns EVERY problem with the row, not just the first, so
    // a broker fixing the form gets one complete list. Show it whole.
    if(!r.ok)return addCompMsg(j.error||"Could not save that comp.",true);
    // property_type and transaction are left alone: a broker adding several
    // comps of the same type/deal kind in a row should not have to reselect
    // them each time. Re-rendering the type fields for the still-selected
    // type is what clears them, rather than a second field list to keep in
    // step with TYPE_FIELDS.
    BASE_FIELDS.forEach(function(f){
      if(f==="property_type"||f==="transaction")return;
      var el=$("addComp_"+f); if(el)el.value="";
    });
    renderAddTypeFields();
    load();
    addCompMsg("Added.");
  }
  $("addCompBtn").addEventListener("click",addComp);

  // One delegated handler for the strip: a cell that carries data-open owns a
  // panel, and opening it is all it does. The details element holds its own
  // state, so there is nothing here to keep in step with it.
  $("readStrip").addEventListener("click",function(e){
    var el=e.target,t=null;
    while(el&&el!==this){ if(el.getAttribute&&el.getAttribute("data-open")){t=el.getAttribute("data-open");break;} el=el.parentNode; }
    if(!t)return;
    var d=$(t);
    if(!d)return;
    d.open=true;
    d.scrollIntoView({behavior:"smooth",block:"nearest"});
  });
  // Filtering is local now, so these redraw rather than refetch. renderRollup
  // is included only to move the selected ring; its numbers are whole-book and
  // do not change with the filter.
  function redraw(){
    $("fClear").className=($("fMarket").value||$("fType").value||$("fTrans").value||$("fFirm").value||$("fText").value)?"btn ghost":"btn ghost hide";
    renderRollup();
    render();
  }
  $("fMarket").addEventListener("change",redraw);
  $("fType").addEventListener("change",redraw);
  $("fTrans").addEventListener("change",redraw);
  $("fFirm").addEventListener("change",redraw);
  // "input", not "change": filtering as they type is the whole point, and the
  // work is a substring scan over at most 1000 rows the page already holds.
  // Escape clears, which is the one thing every search box on the web does.
  $("fText").addEventListener("input",redraw);
  // Delegated: #none's contents are rewritten on every render, so a handler
  // bound to the button itself would be lost on the next draw.
  $("none").addEventListener("click",function(e){
    if(!e.target||e.target.id!=="noneClear")return;
    $("fMarket").value=""; $("fType").value=""; $("fTrans").value=""; $("fFirm").value=""; $("fText").value="";
    redraw();
  });
  $("fText").addEventListener("keydown",function(e){
    if(e.key==="Escape"&&$("fText").value){ $("fText").value=""; redraw(); }
  });
  $("fClear").addEventListener("click",function(){
    $("fMarket").value=""; $("fType").value=""; $("fTrans").value=""; $("fFirm").value=""; $("fText").value=""; redraw();
  });
  // Bulk publish. The confirm is the single-comp one's promise, scaled: it
  // names the count, the credit, and the one thing that cannot be taken back.
  // Publishing is a public act on somebody else's behalf as much as the
  // broker's, so the dialog stays specific rather than becoming "Publish 23
  // comps?" now that it covers more of them.
  $("pubAll").addEventListener("click",function(){
    var ids=pubCandidates.map(function(c){return c.id}),n=ids.length;
    if(!n)return;
    var who=(identity&&identity.creditedTo)?identity.creditedTo:"your firm";
    if(!confirm("Publish "+n+" comp"+(n===1?"":"s")+"?\\n\\nThey become part of CompNinja's public records, credited to "+
      who+" by name in every report they appear in. Everything else in your vault stays private.\\n\\n"+
      "Comps that are not ready — no price, no size, no street number — are skipped and named afterwards.\\n\\n"+
      "You can stop publishing any of them later, but reports that already used them will keep them."))return;
    var b=$("pubAll");
    b.disabled=true; b.textContent="Publishing\\u2026";
    fetch("/api/vault/publish-many",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},body:JSON.stringify({ids:ids})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        b.disabled=false;
        if(o.s!==200){
          compMsg(o.j.error||"That didn't go through.",true);
          // The one refusal a broker can fix on this page, same as the single
          // publish: open the form that supplies the missing credit name.
          if(o.j.code==="needs_credit_name"||o.j.code==="needs_license")setIdOpen(true);
          load();
          return;
        }
        var parts=[o.j.published+" published"];
        if(o.j.skippedCount)parts.push(o.j.skippedCount+" skipped");
        if(o.j.remaining)parts.push(o.j.remaining+" left \u2014 run it again");
        // Name the FIRST reason rather than a bare count: "5 skipped" sends a
        // broker hunting through their book, and the reasons repeat, so one
        // example usually explains all five.
        var why=(o.j.skipped&&o.j.skipped.length)?o.j.skipped[0].reason:"";
        compMsg(parts.join(" \\u00b7 ")+(why?" \\u00b7 "+why:""),!o.j.published);
        load();
      })
      .catch(function(){
        b.disabled=false;
        compMsg("That didn't reach the server. Nothing was changed.",true);
      });
  });
  // Bulk firm share — the push. ONE function, reached from the button in
  // the filter row and from the line under an import result, so there is
  // exactly one confirm on the way to the route and no second path. The
  // confirm is the single-comp one scaled, and it says four things. The
  // third is what makes this a push rather than a release: unlike
  // publishing, whose dialog rightly says reports keep what they used,
  // every one of these can be taken back.
  function shareAllWithFirm(){
    var ids=firmCandidates.map(function(c){return c.id}),n=ids.length;
    if(!n||!myFirm)return;
    if(!confirm("Share "+n+" comp"+(n===1?"":"s")+" with "+myFirm.name+"?\\n\\n"+
      "Colleagues at "+myFirm.name+" will see them inside their own reports, with your name on them.\\n\\n"+
      "They do NOT go into CompNinja's public records, and they are left out of every export, PNG, print and client link.\\n\\n"+
      "You can take any of them back at any time.\\n\\n"+
      "Comps with no deal date can't be shared \\u2014 colleagues' reports pick comps by date, so one would never reach a report. Those are skipped and named afterwards."))return;
    var b=$("firmAll");
    b.disabled=true; b.textContent="Sharing\\u2026";
    fetch("/api/vault/firm-many",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},body:JSON.stringify({orgId:myFirm.id,ids:ids})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        b.disabled=false;
        if(o.s!==200){ compMsg(o.j.error||"That didn't go through.",true); render(); return; }
        var parts=[o.j.shared+" shared"];
        if(o.j.skippedCount)parts.push(o.j.skippedCount+" skipped");
        if(o.j.remaining)parts.push(o.j.remaining+" left \\u2014 run it again");
        // The first reason, not a bare count, pubAll's rule: the reasons
        // repeat, so one example usually explains all of them.
        var why=(o.j.skipped&&o.j.skipped.length)?o.j.skipped[0].reason:"";
        compMsg(parts.join(" \\u00b7 ")+(why?" \\u00b7 "+why:""),!o.j.shared);
        // The shelf lookup, the Firm column, the filter and the privacy line
        // all read sharedIds, so it is re-read from the server rather than
        // patched here from what the page believes it sent.
        load();
      })
      .catch(function(){
        b.disabled=false;
        compMsg("That didn't reach the server. Nothing was changed.",true);
        render();
      });
  }
  $("firmAll").addEventListener("click",shareAllWithFirm);
  // The follow-on line under an import result. It sets the view to that
  // import and runs the button's own function — confirm included — and it
  // never calls the route itself. The moment somebody has just poured their
  // book in is when they are least careful, so the path must be the one
  // with the confirm on it.
  $("res").addEventListener("click",function(e){
    var t=e.target;
    if(!t||t.id!=="resFirm"||!myFirm)return;
    sheetMode=true;
    sheetUploadId=t.getAttribute("data-upload")||null;
    $("fMarket").value=""; $("fType").value=""; $("fTrans").value=""; $("fFirm").value=""; $("fText").value="";
    render();
    shareAllWithFirm();
  });
  $("sheetToggle").addEventListener("click",function(){
    if(sheetMode)closeSheet(); else openSheet(null);
  });
  // A rollup card is the filter. Clicking the one already selected clears it,
  // so a card is a toggle and never a trap you can only leave via the dropdowns.
  $("rollup").addEventListener("click",function(e){
    var card=e.target.closest("button.card"); if(!card)return;
    var mk=card.getAttribute("data-mk"),ty=card.getAttribute("data-ty");
    var same=$("fMarket").value===mk&&$("fType").value===ty;
    $("fMarket").value=same?"":mk;
    $("fType").value=same?"":ty;
    redraw();
    if(!same)$("tbl").scrollIntoView({behavior:"smooth",block:"start"});
  });
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
  // Spec §2's rule, in one function: the moment a vault stops being only
  // yours, the copy has to say so. "Visible only to you" was true of every
  // vault until a comp could be shared with a firm, and a promise that
  // quietly stops being true is worse than one that was never made.
  //
  // It keys on having actually SHARED something, not on merely being in a
  // firm: a broker who has shared nothing really does have a vault visible
  // only to them, and rewriting their copy would frighten them about a thing
  // that has not happened.
  function renderFirmPrivacy(){
    var n=Object.keys(sharedIds).length;
    var deck=$("deckSub"),trust=$("trustNote");
    var sharedLine=myFirm&&n
      ? n+" "+(n===1?"comp is":"comps are")+" shared with "+myFirm.name+
        ". Everything else is visible only to you, and nothing here is ever read "+
        "into CompNinja\u2019s public records unless you publish it."
      : null;
    if(deck)deck.textContent=sharedLine
      ? "Closed deals, leads, and BOVs. "+n+" shared with "+myFirm.name+"; the rest visible only to you."
      : "Closed deals, leads, and BOVs. Visible only to you.";
    if(trust)trust.innerHTML=sharedLine
      ? esc(sharedLine)
      : "Visible only to you. Nothing here is ever read into CompNinja\u2019s "+
        "public records, and nothing is published unless you choose it.";
  }

  // The firm toggle. A SEPARATE handler from Publish, deliberately: the two
  // are different acts with different audiences, and one confirm dialog
  // covering both is how a broker ends up publishing to the world when they
  // meant to show a colleague.
  $("tbody").addEventListener("click",function(e){
    var b=e.target.closest("button[data-firm]"); if(!b||!myFirm)return;
    var on=b.getAttribute("data-on")==="1";
    var id=b.getAttribute("data-firm");
    if(!on&&!confirm("Share this comp with "+myFirm.name+"?\\n\\nColleagues at your firm will see it inside their own reports, with your name on it. It does NOT go into CompNinja's public records, it is left out of every download and client link, and you can take it back at any time."))return;
    b.disabled=true; b.textContent=on?"Removing\u2026":"Sharing\u2026";
    fetch("/api/vault/firm",{method:on?"DELETE":"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({orgId:myFirm.id,compIds:[id]})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){compMsg(o.j.error||"That didn't go through.",true);b.disabled=false;b.textContent=on?"Shared":"Share";return}
        if(on)delete sharedIds[id]; else sharedIds[id]=true;
        renderFirmPrivacy();
        render();
      })
      .catch(function(){b.disabled=false;b.textContent=on?"Shared":"Share";compMsg("That didn't go through.",true)});
  });

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
          compMsg(o.j.error||"That didn't go through.",true);
          // The one refusal a broker can fix right here. Opening the form
          // turns "you need a name" into the field that supplies it, instead
          // of sending them off to find where identity is set — which, until
          // this shipped, was nowhere.
          if(o.j.code==="needs_credit_name"||o.j.code==="needs_license")setIdOpen(true);
        }else if(o.j.published&&o.j.creditedTo){
          compMsg("Published, credited to "+o.j.creditedTo+".");
        }else{
          compMsg("");
        }
        load();
      })
      .catch(function(){ b.disabled=false;
        compMsg("That didn't reach the server. Nothing was changed.",true); });
  });

  // ---- Row edit / delete -----------------------------------------------
  // #compMsg carries every result from here: #res, the natural-looking
  // target, lives inside #addSec, a panel that ships CLOSED, so a message
  // written there would be invisible to a broker who never opened it.
  function compMsg(text,bad){
    var el=$("compMsg");
    el.className=text?("msg "+(bad?"bad":"ok")):"msg hide";
    el.textContent=text||"";
  }

  // The comp a broker just deleted, held for as long as the message offering
  // to put it back is on screen. Nothing persists it: this catches the misclick
  // that is noticed immediately, which is the case worth catching, and NOT a
  // deletion regretted tomorrow -- for that the honest answer is that it is
  // gone, and pretending otherwise with a store that empties on reload would
  // be worse than saying so.
  var lastDeleted=null;

  // Everything the add-one-comp route accepts, taken off the row the page was
  // already holding. Reusing that route rather than adding an undelete
  // endpoint is what keeps the restore honest: it goes through normalizeRow
  // like every other written comp, so an undo cannot put back something the
  // vault would refuse to be told today.
  function restorePayload(c){
    var out={},fields=BASE_FIELDS.concat(TYPE_FIELDS[c.property_type]||[]);
    fields.forEach(function(f){
      var v=c[f];
      if(v!=null&&String(v).trim()!=="")out[f]=String(v);
    });
    return out;
  }

  async function deleteComp(id){
    var comp=compById(id);
    // Still a confirm, and still specific: undo is a safety net for the
    // misclick, not a reason to make the destructive click cheap. What the
    // wording no longer claims is that this cannot be undone -- it can, for
    // as long as the message below is on screen.
    if(!confirm("Delete this comp?"))return;
    var r;
    try{
      r=await fetch("/api/vault/comp?id="+encodeURIComponent(id),
        {method:"DELETE",credentials:"same-origin"});
    }catch(err){
      // On a flaky connection this used to give the broker no signal at all —
      // the click just went nowhere.
      return compMsg("That didn't reach the server. Nothing was changed.",true);
    }
    var j=await r.json().catch(function(){return{};});
    if(!r.ok)return compMsg(j.error||"Could not delete that comp.",true);
    load();
    lastDeleted=comp?{payload:restorePayload(comp),
      address:comp.address,wasPublished:!!j.unpublished}:null;
    if(!lastDeleted)return compMsg("Deleted.");
    compMsgUndo((lastDeleted.wasPublished
      ? "Deleted, and withdrawn from the public records."
      : "Deleted."));
  }

  // A message with a way back. Separate from compMsg because that one sets
  // textContent, which is right for every other caller and cannot carry a
  // button.
  function compMsgUndo(text){
    var el=$("compMsg");
    el.className="msg ok";
    el.innerHTML=esc(text)+' <button type="button" class="lnk" id="undoDel">Undo</button>';
  }

  // Delegated: #compMsg's contents are rewritten by every other message on the
  // page, so a handler bound to the button itself would outlive its button.
  $("compMsg").addEventListener("click",function(e){
    if(!e.target||e.target.id!=="undoDel")return;
    var d=lastDeleted;
    lastDeleted=null;
    if(!d)return;
    compMsg("Putting it back\u2026");
    fetch("/api/vault/comp",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},body:JSON.stringify(d.payload)})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200)return compMsg(o.j.error||"Could not put that comp back.",true);
        load();
        // Said plainly rather than left to be discovered. The restore is a new
        // entry: it belongs to no import, so deleting that import will not
        // remove it, and a comp that was published is NOT republished by
        // putting it back -- publishing is a deliberate public act and undoing
        // a delete is not consent to make it public again.
        compMsg("Put back."+(d.wasPublished?" It is not published again — publish it when you are ready.":""));
      })
      .catch(function(){ compMsg("That didn't reach the server. Nothing was changed.",true); });
  });

  // One field of one row, on blur — from a compact-table cell or a spreadsheet
  // one, which are the same input saved the same way. Only the changed field
  // travels, so an untouched cell can never overwrite a value with a stale
  // copy the page happened to be holding.
  //
  // Does NOT re-render the table: rebuilding the inputs would steal focus from
  // the cell the broker just Tabbed into. Everything the save changes on
  // screen is therefore patched in place below.
  async function saveCell(id, key, el){
    var before=compById(id); if(!before||!el)return;
    var v=String(el.value||"").trim();
    var was=before[key]==null?"":String(before[key]);
    if(v===was){ cellState(el,""); showCell(el,key,before[key]); return; }
    var patch={}; patch[key]=v;
    cellState(el,"saving");
    var r;
    try{
      r=await fetch("/api/vault/comp?id="+encodeURIComponent(id),{
        method:"PATCH",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify(patch)});
    }catch(err){
      cellState(el,"err");
      return compMsg("That didn't reach the server. Nothing was changed.",true);
    }
    var j=await r.json().catch(function(){return{};});
    // 400 and 409 both carry a sentence written for the broker, and a 400
    // lists EVERY problem with the row rather than just the first. Show it
    // whole: "You already have this comp." tells them what to do, "Could not
    // save" does not. The cell keeps what they typed, so the correction is
    // one keystroke away rather than something to retype from memory.
    if(!r.ok){
      cellState(el,"err");
      return compMsg(j.error||"Could not save that change.",true);
    }
    var row=compById(id);
    if(row){
      row[key]=v;
      if(j.comp){
        Object.keys(j.comp).forEach(function(k){ row[k]=j.comp[k]; });
      }
    }
    // Sorting a column, changing the filter or a delete's reload all rebuild
    // the table, and any of them can land while this save is still in flight —
    // leaving us holding a detached input over a freshly-drawn row that still
    // shows the PRE-save value. Patching the dead node would leave the new row
    // stale with a refreshed $/SF beside it, so redraw the whole table
    // instead. Focus has already moved on by definition here, so the usual
    // reason not to re-render does not apply.
    if(el.isConnected===false){ render(); }
    else{
      cellState(el,"saved");
      // The server's own saved row is what goes back on screen, never the
      // string the broker typed: normalizeRow is what turns "45,000 SF" into
      // 45000 and re-derives market and $/SF, and a cell still showing the raw
      // typing while the row behind it holds something else is how a broker
      // ends up trusting a figure the vault never stored.
      showCell(el,key,row?row[key]:v);
      refreshDerived(id,row);
    }
    if(j.unpublished){
      compMsg("Saved. This comp was published, so it has been withdrawn from the public records \\u2014 publish it again when you are happy with it.");
    }else{
      compMsg("Saved.");
    }
  }

  // Put the formatted figure back in a cell that is no longer focused, and
  // keep data-raw in step so the next focus offers the stored value.
  // Only compact-table cells carry data-raw. A spreadsheet cell is deliberately
  // left alone: that view is the book as a grid of stored values, and quietly
  // formatting "1000000" into "$1,000,000" there would make the one screen a
  // broker opens to check what was actually imported stop showing it.
  function showCell(el,key,v){
    var hasRaw=el.getAttribute&&el.getAttribute("data-raw")!==null;
    var shown=hasRaw?cellDisplay(key,v):(v==null?"":String(v));
    if(hasRaw){
      // deal_date's raw mirrors cellInput's rule: a stored null IS the
      // undated sentinel, and "undated" is the input the server accepts —
      // "" would be refused on the next save of this cell.
      var raw=v==null?(key==="deal_date"?"undated":""):String(v);
      if(el.setAttribute)el.setAttribute("data-raw",raw);
      el.value=shown;
    }
    // Re-widen for what is now in the cell. Typing a longer address than the
    // one the column was built around would otherwise leave the new value
    // clipped until the next full render — which, since saves deliberately do
    // not re-render, could be a long time.
    if(el.style)el.style.minWidth=cellWidth(key,shown)+"ch";
  }

  // market and $/SF are the server's to compute, so after a save they are read
  // from the row it sent back. Without this, editing a price left the $/SF
  // beside it reading the old figure until the next full render — a wrong
  // number sitting in a priced column, which is the one thing this table
  // cannot do.
  function refreshDerived(id,row){
    if(!row)return;
    var tb=$("tbody");
    if(!tb||!tb.querySelectorAll)return;
    var cells=tb.querySelectorAll('td[data-ro-id="'+id+'"]')||[];
    for(var i=0;i<cells.length;i++){
      var k=cells[i].getAttribute&&cells[i].getAttribute("data-ro-k");
      if(k==="market")cells[i].innerHTML=esc(row.market);
      else if(k==="price_per_sqft")cells[i].innerHTML=rateCell(row);
    }
  }

  // A second delegated listener beside the publish one above, rather than a
  // rewrite of it: each early-returns when the click was not its own kind of
  // button, so the two coexist safely on the same element.
  $("tbody").addEventListener("click",function(e){
    var d=e.target.closest("button[data-del-comp]");
    if(d)return deleteComp(d.getAttribute("data-del-comp"));
  });
  // focusout bubbles (blur does not). One listener for every cell in either
  // view, attached once: render() and renderSheet() rebuild the inputs on
  // every draw and must not re-bind.
  //
  // Deliberately NOT gated on sheetMode any more — the compact table's cells
  // are the same input saved by the same PATCH, and the gate was what made an
  // Edit button necessary in the first place.
  $("tbody").addEventListener("focusout",function(e){
    var el=e.target;
    if(!el||!el.getAttribute)return;
    var k=el.getAttribute("data-k"), id=el.getAttribute("data-id");
    if(!k||!id)return;
    saveCell(id,k,el);
  });
  // Focus shows the stored value rather than the formatted one, so a broker
  // edits 1250000 and never has to work out whether the $ and commas they can
  // see are part of what they are about to retype.
  $("tbody").addEventListener("focusin",function(e){
    var el=e.target;
    if(!el||!el.getAttribute)return;
    var raw=el.getAttribute("data-raw");
    if(raw===null||!el.getAttribute("data-k"))return;
    el.value=raw;
  });
  $("tbody").addEventListener("keydown",function(e){
    var el=e.target;
    if(!el||!el.getAttribute||!el.getAttribute("data-k"))return;
    // Enter commits by blurring, which is what fires the save. Escape puts the
    // stored value back and leaves without saving — the cell IS the editor
    // now, so it needs the Cancel that the edit form used to carry.
    if(e.key==="Enter"){ e.preventDefault(); el.blur(); }
    else if(e.key==="Escape"){
      // A spreadsheet cell carries no data-raw (it already shows the stored
      // value), so its undo comes from the row the page is holding.
      var raw=el.getAttribute("data-raw");
      if(raw===null){
        var row=compById(el.getAttribute("data-id"));
        if(row)raw=row[el.getAttribute("data-k")]==null?"":String(row[el.getAttribute("data-k")]);
      }
      if(raw!==null)el.value=raw;
      cellState(el,"");
      el.blur();
    }
  });

  $("ups").addEventListener("click",function(e){
    var open=e.target.closest("button[data-open-sheet]");
    if(open)return openSheet(open.getAttribute("data-open-sheet"));
    var b=e.target.closest("button[data-del]"); if(!b)return;
    if(!confirm("Remove this import and all the comps that came in with it?"))return;
    removeUpload(b.getAttribute("data-del"));
  });

  // Removing an import ALWAYS ends in load(). It used to end in closeSheet()
  // INSTEAD of load() whenever the import being removed was the one open in
  // spreadsheet mode -- which is the ordinary way to get here, since the other
  // button on that row is "Open" and a broker opens an import to check it
  // before removing it. closeSheet() only re-renders from the arrays the page
  // is already holding, so the server deleted the comps and the screen went on
  // showing them: the import still listed, its comp count unchanged, its rows
  // still in the table. The button read as broken until the page was reloaded.
  // It closes the sheet AND reloads now -- the close is the immediate repaint,
  // load() is the truth.
  //
  // The status is checked for the same reason. Every refusal -- a lapsed
  // subscription (403), a Supabase outage (502) -- took the success path, so a
  // delete that removed nothing looked exactly like one that worked.
  async function removeUpload(id){
    var r;
    try{
      r=await fetch("/api/vault/upload?id="+encodeURIComponent(id),
        {method:"DELETE",credentials:"same-origin"});
    }catch(err){
      return compMsg("That didn't reach the server. Nothing was removed.",true);
    }
    var j=await r.json().catch(function(){return{};});
    if(!r.ok)return compMsg(j.error||"Could not remove that import.",true);
    if(sheetUploadId&&String(sheetUploadId)===String(id))closeSheet();
    load();
    compMsg("Import removed.");
  }

  // ---- The hubs deck --------------------------------------------------------
  //
  // Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
  // NOT the connection hub at /brokers.
  //
  // Fetched rather than booted, unlike the comps above. The boot payload is
  // built by vaultReadPayload, which reads the vault and nothing else; adding a
  // second query to it would make every /vault paint wait on a table most
  // brokers have no rows in. A hub list arriving a beat late is invisible; a
  // slower vault is not.
  var hubs=[];
  // This page has no page-wide show() helper: everything else toggles .hide
  // directly or reassigns className. One local, named so it cannot be mistaken
  // for a shared utility that does not exist.
  var hubShow=function(el,on){ if(el)el.classList.toggle("hide",!on); };
  function hubMsg(t,bad){
    var n=$("hubMsg");
    n.innerHTML=t?'<div class="msg'+(bad?" bad":"")+'">'+esc(t)+"</div>":"";
  }

  function renderHubs(){
    var rows=$("hubRows");
    hubShow($("hubIntro"),true);
    if(!hubs.length){
      hubShow($("hubEmpty"),true);hubShow($("hubTableWrap"),false);rows.innerHTML="";return;
    }
    hubShow($("hubEmpty"),false);hubShow($("hubTableWrap"),true);
    rows.innerHTML=hubs.map(function(h){
      // A hub nobody has opened yet is the one fact a broker acts on: it means
      // the link never got sent, or got sent and ignored. Counting participants
      // who have a first_viewed_at answers it without a second column.
      var people=(h.participants||[]).length;
      var seen=(h.participants||[]).filter(function(p){return p.firstViewedAt}).length;
      return "<tr>"+
        "<td>"+esc(h.title||h.subjectAddress||"Untitled hub")+
          (h.status==="closed"?' <span class="chip">Closed</span>':"")+"</td>"+
        "<td>"+esc(h.market||"")+"</td>"+
        "<td>"+esc(h.propertyType||"")+"</td>"+
        '<td class="num">'+seen+" of "+people+"</td>"+
        "<td>"+esc(dateShort(h.createdAt))+"</td>"+
        "<td>"+esc(dateShort(h.updatedAt))+"</td>"+
        '<td><a class="btn ghost" href="/hub/'+encodeURIComponent(h.id)+'">Open</a></td>'+
      "</tr>";
    }).join("");
  }

  // UTC, not local. Every other date on this page is a UTC calendar day (the
  // pipeline slices its timestamps to ten characters), and these arrive as
  // midnight-UTC stamps, so a local render puts a hub created on the 11th
  // under "Aug 10" for every broker west of Greenwich. Caught in a browser:
  // the seeded 2026-08-11 hub read Aug 10.
  function dateShort(s){
    if(!s)return "";
    var d=new Date(s);
    return isNaN(d.getTime())?"":d.toLocaleDateString("en-US",
      {month:"short",day:"numeric",timeZone:"UTC"});
  }

  function loadHubs(){
    fetch("/api/hubs",{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        // 401/403 stay silent: the whole page is already gated, and a member
        // who cannot see hubs gets nothing to act on from a refusal here.
        if(o.s===401||o.s===403){hubs=[];renderHubs();return;}
        // EVERYTHING ELSE SAYS SO. This used to fall into the same branch, so
        // a 503 rendered "No hubs yet. Create one when you have comps to put in
        // front of a client." — an outage reading as "you have none", to the
        // one person who would know it was wrong. It happened for real during
        // a deploy on 2026-08-14 and cost a confused ten minutes.
        //
        // It is also backwards from this repo's own rule: the lead inbox
        // refuses with a 503 rather than showing an empty inbox, "because an
        // empty inbox on error would misreport demand as zero". Same argument,
        // same answer.
        if(o.s!==200){hubsFailed((o.j&&o.j.error)||"Your hubs could not be loaded.");return;}
        hubs=o.j.mine||[];renderHubs();
      })
      .catch(function(){hubsFailed("Your hubs could not be reached.");});
  }

  // A failed load is NOT an empty list. The invitation stays hidden, because
  // "create your first hub" is the wrong thing to say to somebody whose hubs
  // we simply could not fetch.
  function hubsFailed(text){
    hubs=[];
    var rows=$("hubRows"); if(rows)rows.innerHTML="";
    hubShow($("hubTableWrap"),false);
    hubShow($("hubEmpty"),false);
    hubShow($("hubIntro"),true);
    hubMsg(text,true);
  }

  $("hubType").innerHTML='<option value=""></option>'+
    PROP_TYPES.map(function(t){return "<option>"+t+"</option>"}).join("");

  $("hubToggle").addEventListener("click",function(){
    var open=$("hubAddSec").classList.contains("hide");
    hubShow($("hubAddSec"),open);
    $("hubToggle").setAttribute("aria-expanded",open?"true":"false");
  });

  $("hubAdd").addEventListener("click",function(){
    var title=$("hubTitle").value.trim();
    var addr=$("hubAddr").value.trim();
    if(!title&&!addr)return hubMsg("Give the hub a name or an address first.",true);
    var emails=$("hubEmails").value.split(/[,;\\s]+/).filter(Boolean);
    $("hubAdd").disabled=true;
    fetch("/api/hubs",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({title:title,subjectAddress:addr,
        propertyType:$("hubType").value,participants:emails})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        $("hubAdd").disabled=false;
        if(o.s!==201)return hubMsg(o.j.error||"That hub could not be created.",true);
        $("hubTitle").value="";$("hubAddr").value="";$("hubEmails").value="";
        hubShow($("hubAddSec"),false);
        $("hubToggle").setAttribute("aria-expanded","false");
        hubMsg("");
        showInvites(o.j);
        loadHubs();
      })
      .catch(function(){$("hubAdd").disabled=false;
        hubMsg("That didn't reach the server. No hub was created.",true);});
  });

  // The one place a raw invite token is ever visible. It is not stored and
  // cannot be shown again, so this says that plainly instead of leaving a
  // broker to discover it by closing the panel.
  function showInvites(j){
    var list=(j.invites||[]);
    var box=$("hubInvites");
    // The copy depends on whether the server actually MAILED them, which it
    // reports as the emailed flag. This used to hard-code "CompNinja does not email
    // them yet" — true when hubs shipped, and a lie the day a domain is
    // verified in Resend, told to the one person relying on it.
    // THREE cases, because "we did not try" and "we tried and it failed" are
    // different things to tell a broker. emailed is now the send's own answer
    // rather than a restatement of the configuration, so a partial failure is
    // reportable and names who still needs a link.
    var failed = Array.isArray(j.emailFailed) ? j.emailFailed : [];
    var head = j.emailed
      ? '<p class="note">Your hub is ready, and each person has been emailed their link. '+
        'The links are below if you would rather send them yourself; they cannot be shown again.</p>'
      : failed.length && failed.length < list.length
        ? '<p class="note">Your hub is ready, but '+esc(failed.join(", "))+
          ' could not be emailed. Copy their link below and send it yourself; '+
          'these links cannot be shown again.</p>'
        : '<p class="note">Your hub is ready. Copy each link and send it to that '+
          'person yourself: CompNinja could not email them, '+
          'and these links cannot be shown again.</p>';
    if(!list.length){
      box.innerHTML=head+'<p class="note"><a href="/hub/'+encodeURIComponent(j.id)+
        '">Open the hub</a> and add people to it when you are ready.</p>';
      hubShow(box,true);return;
    }
    box.innerHTML=head+list.map(function(i,n){
      return '<div class="row" style="align-items:center;gap:var(--s2)">'+
        "<span>"+esc(i.email)+"</span>"+
        '<input type="text" readonly value="'+escA(i.url)+'" '+
          'id="inv'+n+'" style="flex:1;min-width:240px"/>'+
        '<button class="btn ghost" data-copy="inv'+n+'">Copy</button>'+
      "</div>";
    }).join("");
    hubShow(box,true);
  }

  $("hubInvites").addEventListener("click",function(e){
    var b=e.target.closest("button[data-copy]");if(!b)return;
    var inp=$(b.getAttribute("data-copy"));if(!inp)return;
    // select() first, and it is the fallback rather than the decoration:
    // clipboard.writeText needs a secure context and a permission that can be
    // refused, and a broker who cannot copy the link cannot send it at all.
    inp.focus();inp.select();
    var done=function(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy"},1500)};
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(inp.value).then(done).catch(function(){
        try{document.execCommand("copy");done();}catch(_){}
      });
    }else{
      try{document.execCommand("copy");done();}catch(_){}
    }
  });

  // ---------------------------------------------------------------------
  // YOUR PROPERTIES -- the portfolio, moved off /desk on 2026-09-01.
  //
  // Not a port of renderMyDesk(): that one is built out of the desk's dk-*
  // classes and Tailwind utilities, neither of which exists on this page
  // (tailwind.css is purged against index.html alone, so a utility used
  // only in a server-side string silently stops styling). This is the same
  // RULES in this page's own idiom -- .strip, .tw, table, .lnk.
  //
  // Four of those rules are load-bearing and were each earned on the desk:
  //   * A failed read renders as a FAILURE, never as an empty portfolio.
  //     Two elements, never one. "Nothing here yet" shown to somebody with
  //     sixteen properties reads as their book having been thrown away.
  //   * "Checked" is the last time a VALUE was produced -- the last
  //     snapshot's ts, falling back to updated_at only when there is none.
  //     A save that produced no valuation moves updated_at without anybody
  //     having checked the property, and this date has to agree with the
  //     attention line above the table.
  //   * Figures are gated on portfolioValues. A free portfolio is an address
  //     list; every number here, the market-movement line included, is a
  //     dollar figure and stays out of it.
  //   * The strip and the table footer close on the SAME combined figure and
  //     the SAME between-checks percentage, computed once, so the two can
  //     never disagree.
  // ---------------------------------------------------------------------

  // A year, and not a number picked here. portfolio-delta.js draws the same
  // line for the same reason (MAX_WINDOW_YEARS = 1): past it, a property's
  // figure is not a stale-ish reading of the market, it is a different
  // question.
  // MIRRORED CONSTANT: portfolio-delta.js is a server module and cannot be
  // required here, and index.html keeps its own copy too. If that one moves,
  // move both.
  var STALE_MS=365*24*60*60*1000;
  var propItems=[],propsOk=false,showValues=false;
  var personalLoaded=false;

  function loadProps(){
    fetch("/api/portfolio",{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        // A 401 is silent: the whole page is already gated behind a sign-in
        // and a second refusal under the deck would only repeat it.
        if(o.s===401){propItems=[];propsOk=true;renderProps();return;}
        if(o.s!==200){propsOk=false;renderProps();return;}
        propsOk=true;propItems=o.j.items||[];renderProps();
      })
      .catch(function(){propsOk=false;renderProps();});
  }

  function sparkline(snaps){
    var vals=snaps.map(function(s){return Number(s.likely)}).filter(function(v){return v>0}).slice(-12);
    if(vals.length<2)return "";
    var w=72,h=18,pad=3;
    var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
    var x=function(i){return pad+(i*(w-2*pad))/(vals.length-1)};
    var y=function(v){return hi===lo?h/2:h-pad-((v-lo)*(h-2*pad))/(hi-lo)};
    var pts=vals.map(function(v,i){return x(i).toFixed(1)+","+y(v).toFixed(1)}).join(" ");
    // --ink-4 and --red-fill, this page's own tokens, so the line follows the
    // theme. The desk's copy of this sparkline hard-codes a grey for the
    // polyline because that file has no token for it; the reading is the same.
    // No literal colour value in this comment either -- it ships inside the
    // emitted script, and test/theme.test.js scans the generated markup, not
    // only the stylesheet.
    return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+" "+h+'" aria-label="'+
      vals.length+' valuations tracked" style="display:block">'+
      '<polyline points="'+pts+'" fill="none" stroke="var(--ink-4)" stroke-width="1.4"/>'+
      '<circle cx="'+x(vals.length-1).toFixed(1)+'" cy="'+y(vals[vals.length-1]).toFixed(1)+
      '" r="2.2" fill="var(--red-fill)"/></svg>';
  }

  function pctSpan(p){
    return '<span style="color:var(--'+(p>=0?"green":"red")+')">'+
      (p>=0?"▲":"▼")+" "+Math.abs(p).toFixed(1)+"%</span>";
  }

  function renderProps(){
    var err=$("propsErr"),empty=$("propsEmpty"),wrap=$("propsWrap"),
        strip=$("propsStrip"),attn=$("propsAttn"),intro=$("propsIntro");
    err.className=propsOk?"msg bad hide":"msg bad";
    if(!propsOk){
      // Everything below this line describes a portfolio we could not read.
      // The count would say zero and the invitation would say the book is
      // empty -- two confident statements about data we do not have. The
      // rows and the strip are left exactly as they were rather than wiped.
      empty.className="invite hide";
      return;
    }
    var items=propItems;
    intro.className=items.length?"sub":"sub hide";
    empty.className=items.length?"invite hide":"invite";
    wrap.className=items.length?"tw":"tw hide";
    if(!items.length){strip.className="strip hide";attn.className="note hide";return;}

    var combined=0,curPaired=0,prevPaired=0,pairedN=0,staleN=0,nowMs=Date.now();
    var typeCounts={};
    items.forEach(function(item){
      var snaps=Array.isArray(item.snapshots)?item.snapshots:[];
      var last=snaps[snaps.length-1]||null,prev=snaps.length>1?snaps[snaps.length-2]:null;
      if(last&&last.likely)combined+=Number(last.likely);
      if(last&&prev&&last.likely&&prev.likely){
        curPaired+=Number(last.likely);prevPaired+=Number(prev.likely);pairedN+=1;
      }
      // Off the last CHECK, not off updated_at -- see the header note. An
      // unparseable or missing timestamp is not counted: silence beats
      // calling a property stale on a bad date.
      var ts=last&&last.ts?Date.parse(last.ts):NaN;
      if(isFinite(ts)&&nowMs-ts>STALE_MS)staleN+=1;
      var t=String(item.property_type||"").toLowerCase();
      if(t)typeCounts[t]=(typeCounts[t]||0)+1;
    });
    var bookPct=prevPaired>0?((curPaired-prevPaired)/prevPaired)*100:null;

    // Three cells, which is exactly .strip's own grid -- no new CSS. The
    // desk's version is four because it lends one to the watchlist; here the
    // watchlist is its own deck below and needs no room borrowed.
    if(showValues){
      var typeNote=Object.keys(typeCounts).map(function(t){
        return typeCounts[t]+" "+t;
      }).join(" · ")||"&nbsp;";
      // "Between checks", and the note names its own sample. This is not a
      // return: it compares each property's last two check-ins, over only
      // the properties checked at least twice, with no time window at all.
      // Said outright, because the label alone reads as a portfolio return and
      // the figure is not one: it compares each property's last two check-ins,
      // over only the properties checked at least twice, with no time window at
      // all -- one pair may be a day apart and another eight months.
      var BETWEEN_TITLE="Change in combined likely value between the last two checks of each "+
        "property checked at least twice. Checks happen when you re-run a report, "+
        "so this is not a return over any period of time.";
      var betweenNote=bookPct==null?"re-run a property to start the trail"
        :(pairedN===items.length?"all "+items.length+" properties"
          :pairedN+" of "+items.length+" properties")+", last check vs the one before";
      strip.className="strip";
      strip.innerHTML=
        stripCell("Properties",String(items.length),typeNote,"")+
        stripCell("Combined likely value",combined?money(combined):"&mdash;",
          "from each property's last run","")+
        stripCell("Between checks",bookPct==null?"&mdash;":pctSpan(bookPct),betweenNote,"",false,
          bookPct==null?"":BETWEEN_TITLE);
    }else{
      strip.className="strip hide";strip.innerHTML="";
    }

    // Gated on showValues along with the strip above it: a free portfolio is
    // an address list with no figures on it, so telling somebody their values
    // are a year out would answer a question they were never asked.
    var showAttn=showValues&&staleN>0;
    attn.className=showAttn?"note":"note hide";
    if(showAttn){
      attn.textContent=staleN===1
        ? "1 property was last checked over a year ago. Refresh it below to bring its value up to date."
        : staleN+" properties were last checked over a year ago. Refresh them below to bring their values up to date.";
    }

    $("propsHead").innerHTML=showValues
      ? '<th>Property</th><th>History</th><th class="num">Likely value</th>'+
        '<th class="num">Change</th><th></th>'
      : "<th>Property</th><th></th>";

    $("propsRows").innerHTML=items.map(function(item){
      var snaps=Array.isArray(item.snapshots)?item.snapshots:[];
      var last=snaps[snaps.length-1]||null,prev=snaps.length>1?snaps[snaps.length-2]:null;
      var href="/?property="+encodeURIComponent(item.id);
      var lastTs=last&&last.ts?last.ts:item.updated_at;
      var sub=esc(item.property_type||"")+" · checked "+
        esc(new Date(lastTs).toLocaleDateString());
      // The standing market page for this property's market + type. The
      // server attaches market_page only when one exists, so absence renders
      // nothing; the slug is shape-checked before it becomes an href, like
      // the report's own market-page link.
      if(item.market_page&&typeof item.market_page.slug==="string"
         &&/^[a-z0-9-]{1,120}$/.test(item.market_page.slug)){
        sub+=' · <a href="/market/'+escA(item.market_page.slug)+'">market page</a>';
      }
      var cells='<td><a class="paddr" href="'+escA(href)+
        '" title="Open this report (no new search, no cost)">'+
        esc(item.address)+'</a><div class="note" style="margin-top:2px">'+sub+"</div>";
      // What the MARKET did since this property was last checked -- the one
      // number here that moves without the owner re-running anything.
      // Deliberately NOT coloured like the Change column: painting a market
      // statistic green would read as this building being worth more, which
      // is a search nobody has run.
      if(showValues&&item.movement&&item.movement.line){
        cells+='<div class="note" style="margin-top:2px" title="Market median $/SF from '+
          'comps others have searched. Not a new valuation of this property.">'+
          esc(item.movement.line)+"</div>";
      }
      cells+="</td>";
      if(showValues){
        cells+="<td>"+sparkline(snaps)+"</td>";
        cells+='<td class="num">'+(last&&last.likely?money(last.likely):"&mdash;")+"</td>";
        var chg="&mdash;";
        if(last&&prev&&last.likely&&prev.likely){
          chg=pctSpan(((last.likely-prev.likely)/prev.likely)*100);
        }
        cells+='<td class="num">'+chg+"</td>";
      }
      // Refresh is the same door with refresh=1 on it. Replaying a search
      // needs the real #compForm, and every rule that hangs off it
      // (validation, the cache, the caps, the per-type columns) -- all of
      // which live in index.html and nowhere else. So this navigates rather
      // than pretending to run a search here.
      cells+='<td class="rowact num">'+firmDoorCell(item)+'<a href="'+escA(href+"&refresh=1")+
        '" title="Runs a new live search for this property">Refresh</a> '+
        '<button class="lnk trash" type="button" data-prop-del="'+escA(item.id)+
        '" data-prop-addr="'+escA(item.address)+
        '" aria-label="Remove '+escA(item.address)+' from your portfolio" '+
        'title="Remove from your portfolio">'+TRASH_SVG+"</button></td>";
      return "<tr>"+cells+"</tr>";
    }).join("");

    // The closing total only earns its rule with something to sum, and it
    // repeats the strip's own two figures rather than recomputing them.
    $("propsFoot").innerHTML=(showValues&&items.length>1&&combined)
      ? '<tr><td colspan="2">Combined · '+items.length+" properties</td>"+
        '<td class="num">'+money(combined)+"</td>"+
        '<td class="num">'+(bookPct==null?"":pctSpan(bookPct))+"</td><td></td></tr>"
      : "";
  }

  // Delegated, because #propsRows is rewritten on every render.
  // The firm's buildings (Three Spaces, slice 3), read ONLY to decide which
  // portfolio rows may offer "Add to firm": null until the read has answered
  // (no door is offered on a list we could not read), then the wire rows.
  // Same route the Workspace reads; index.html holds the twin of this door
  // for the firm shelf, and the on-board check below mirrors its heuristic —
  // the verified key first, then the exact address — both read off the
  // SERVER's own rows, so neither page grows an address key of its own.
  var firmBldgs=null;
  function loadFirmBuildings(){
    firmBldgs=null;
    if(!myFirm){ if(propsOk)renderProps(); return; }
    fetch("/api/org/buildings?id="+encodeURIComponent(myFirm.id),{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        firmBldgs=(o.s===200&&Array.isArray(o.j.buildings))?o.j.buildings:null;
        if(propsOk)renderProps();
      })
      .catch(function(){ firmBldgs=null; });
  }
  function onFirmBoard(item){
    if(!firmBldgs)return true;
    var vk=String(item.verified_key||""),addr=String(item.address||"").trim().toLowerCase();
    return firmBldgs.some(function(b){
      return (vk&&b.verifiedKey&&b.verifiedKey===vk)||
        (addr&&String(b.address||"").trim().toLowerCase()===addr);
    });
  }
  function firmDoorCell(item){
    if(!myFirm||!firmBldgs||onFirmBoard(item))return "";
    return '<button class="lnk" type="button" data-firm-bldg="'+escA(item.id)+
      '" title="'+escA("Add this building to "+myFirm.name+"’s list")+'">Add to firm</button> ';
  }
  function propsMsg(text,bad){
    var el=$("propsMsg");
    el.textContent=text||"";
    el.className="msg"+(bad?" bad":" ok")+(text?"":" hide");
  }
  $("propsRows").addEventListener("click",function(e){
    var b=e.target.closest("button[data-firm-bldg]");if(!b||!myFirm)return;
    var id=b.getAttribute("data-firm-bldg");
    var item=propItems.filter(function(p){return String(p.id)===String(id)})[0];
    if(!item)return;
    b.disabled=true;b.textContent="Adding\u2026";
    // The identity travels as the verified key the portfolio already holds
    // (035), so nobody retypes an address and the same building typed two
    // ways still meets one row on the board.
    fetch("/api/org/buildings?id="+encodeURIComponent(myFirm.id),{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({address:item.address,propertyType:item.property_type,verifiedKey:item.verified_key||""})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){b.disabled=false;b.textContent="Add to firm";propsMsg(o.j.error||"That didn't go through.",true);return;}
        propsMsg(o.j.existed
          ? item.address+" was already on "+myFirm.name+"'s list."
          : "Added "+item.address+" to "+myFirm.name+"'s buildings.");
        loadFirmBuildings();
      })
      .catch(function(){b.disabled=false;b.textContent="Add to firm";propsMsg("That didn't reach the server. Nothing was changed.",true);});
  });

  $("propsRows").addEventListener("click",function(e){
    var b=e.target.closest("button[data-prop-del]");if(!b)return;
    var id=b.getAttribute("data-prop-del"),addr=b.getAttribute("data-prop-addr")||"this property";
    if(!confirm("Remove "+addr+" from your portfolio?"))return;
    fetch("/api/portfolio?id="+encodeURIComponent(id),
      {method:"DELETE",credentials:"same-origin"})
      .then(function(){loadProps()})
      .catch(function(){loadProps()});
  });

  // ---------------------------------------------------------------------
  // YOUR MARKETS -- the watchlist, moved off /desk the same day.
  //
  // The feed's own route already draws the line this deck needs: the
  // market-level figures (new count, median, trend) are free, and only the
  // ITEMISED comp rows are gated, arriving as locked_count instead. So a
  // free member sees a real feed here rather than a locked one, and nothing
  // in this file has to decide that.
  // ---------------------------------------------------------------------
  var mktItems=[],mktOk=false;

  function loadMarkets(){
    fetch("/api/watchlist/feed",{credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s===401){mktItems=[];mktOk=true;renderMarkets();return;}
        if(o.s!==200){mktOk=false;renderMarkets();return;}
        mktOk=true;mktItems=o.j.items||[];renderMarkets();
        // Mark the feed read, exactly as the workspace does when a member
        // opens it. This is not cosmetic: last_seen_at is one of the two
        // high-water marks the watchlist digest takes its cutoff from (the
        // later of last_digest_at and last_seen_at), so without it somebody
        // who reads their new comps here would still be MAILED about them.
        // That is the one thing this product sends on its own initiative, and
        // its bar is "is this worth interrupting a person for".
        //
        // Guarded on unseen, so a page visit with no news writes nothing, and
        // fire-and-forget: a failed stamp costs one duplicate line in the next
        // digest, where letting it fail the deck would cost the feed itself.
        if(o.j.unseen){
          fetch("/api/watchlist/seen",{method:"POST",credentials:"same-origin"})
            .catch(function(){});
        }
      })
      .catch(function(){mktOk=false;renderMarkets();});
  }

  function renderMarkets(){
    $("mktErr").className=mktOk?"msg bad hide":"msg bad";
    if(!mktOk){$("mktEmpty").className="invite hide";return;}
    var items=mktItems;
    $("mktIntro").className=items.length?"sub":"sub hide";
    $("mktEmpty").className=items.length?"invite hide":"invite";
    $("mktRows").innerHTML=items.map(function(it){
      var title=esc(it.market)+" · "+esc(it.property_type);
      if(it.market_page&&typeof it.market_page.slug==="string"
         &&/^[a-z0-9-]{1,120}$/.test(it.market_page.slug)){
        title='<a href="/market/'+escA(it.market_page.slug)+'">'+title+"</a>";
      }
      var facts=[];
      facts.push((it.new_count||0)+" new comp"+((it.new_count||0)===1?"":"s"));
      if(it.median_psf!=null)facts.push("median "+psf0(it.median_psf)+"/SF");
      if(it.median_trend&&it.median_trend.current!=null&&it.median_trend.prior!=null
         &&Number(it.median_trend.prior)>0){
        var d=((it.median_trend.current-it.median_trend.prior)/it.median_trend.prior)*100;
        facts.push((d>=0?"▲":"▼")+" "+Math.abs(d).toFixed(1)+"% vs the six months before");
      }
      // Aggregate only -- the payload carries no address, email or visitor
      // id, and the member's own searches are excluded server-side, so this
      // is other people's interest and never their own reflected back.
      if(it.demand&&it.demand.viewers){
        facts.push(it.demand.viewers+" "+(it.demand.viewers===1?"person":"people")+
          " searched here in "+(it.demand.window_days||30)+" days");
      }
      var rows="";
      if(it.comps&&it.comps.length){
        rows='<div class="tw" style="margin-top:8px"><table>'+
          "<thead><tr><th>Address</th><th>Deal</th><th>Date</th>"+
          '<th class="num">Price or rate</th><th class="num">$/SF</th></tr></thead><tbody>'+
          it.comps.map(function(c){
            var a=esc(c.address||"");
            if(c.source_url&&/^https?:\\/\\//.test(c.source_url)){
              a='<a href="'+escA(c.source_url)+'" rel="nofollow noopener" target="_blank">'+a+"</a>";
            }
            return "<tr><td>"+a+"</td><td>"+esc(c.transaction||"")+"</td><td>"+
              esc(c.deal_date||"")+'</td><td class="num">'+esc(c.price_or_rate||"")+
              '</td><td class="num">'+esc(c.price_per_sqft==null?"":psf(c.price_per_sqft))+
              "</td></tr>";
          }).join("")+"</tbody></table></div>";
      }
      // The gated remainder, said out loud rather than silently dropped.
      if(it.locked_count){
        rows+='<p class="note" style="margin-top:8px">'+it.locked_count+" more comp"+
          (it.locked_count===1?"":"s")+" in this market. "+
          '<a href="/desk">See your plan</a> to itemise them.</p>';
      }
      return '<div class="dbox" style="margin-top:var(--s4);padding:14px 16px">'+
        '<div style="font-family:var(--serif);font-size:17px">'+title+"</div>"+
        '<p class="note" style="margin:4px 0 0">'+facts.join(" · ")+"</p>"+rows+
        '<p style="margin:10px 0 0"><button class="lnk" type="button" data-unwatch="'+
        escA(it.id)+'" data-mkt="'+escA(it.market+" "+it.property_type)+
        '">Stop watching</button></p></div>';
    }).join("");
  }

  $("mktRows").addEventListener("click",function(e){
    var b=e.target.closest("button[data-unwatch]");if(!b)return;
    if(!confirm("Stop watching "+(b.getAttribute("data-mkt")||"this market")+"?"))return;
    fetch("/api/watchlist?id="+encodeURIComponent(b.getAttribute("data-unwatch")),
      {method:"DELETE",credentials:"same-origin"})
      .then(function(){loadMarkets()}).catch(function(){loadMarkets()});
  });

  $("wType").innerHTML=PROP_TYPES.map(function(t){return "<option>"+t+"</option>"}).join("");
  $("wAdd").addEventListener("click",function(){
    var city=$("wCity").value.trim(),st=$("wState").value.trim().toUpperCase();
    var msg=$("mktMsg");
    if(!city||!/^[A-Z]{2}$/.test(st)){
      msg.innerHTML='<div class="msg bad">Enter a city and a two-letter state.</div>';return;
    }
    msg.innerHTML="";
    fetch("/api/watchlist",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({market:city+", "+st,property_type:$("wType").value})})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200&&o.s!==201){
          msg.innerHTML='<div class="msg bad">'+
            esc((o.j&&o.j.error)||"Couldn’t add that market.")+"</div>";
          return;
        }
        $("wCity").value="";$("wState").value="";
        loadMarkets();
      })
      .catch(function(){
        msg.innerHTML='<div class="msg bad">Couldn’t reach the server. Please try again.</div>';
      });
  });

  loadHubs();

  // The server bakes the first answer into the page (window.__VAULT_BOOT__)
  // so the workspace renders in the same paint as the title, with no fetch
  // and no pop-in. load() remains the path for filter changes, post-upload
  // refreshes, and the fallback when the boot payload could not be built.
  var boot=window.__VAULT_BOOT__;
  if(boot&&typeof boot.s==="number"){apply(boot);}else{load();}
})();
</script>`;
}

module.exports = { renderVaultBody };
