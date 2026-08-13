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

// CN_LOGO and the account-nav pieces are the site's shared chrome: one
// definition in server.js, used by the other server-rendered pages. They are
// passed IN rather than copied here, because a second copy would drift from
// the first (server.js already carries a "keep the two in step" warning about
// exactly that hazard elsewhere). Passing them keeps one source of truth and
// means this file never has to reach back into server.js. The vault keeps its
// own sticky header and stylesheet; it lifts the circle, Pricing slot, and
// hydration script so a member leaving /desk does not appear to have signed
// out.
function renderVaultHTML(boot, chrome) {
  chrome = chrome || {};
  const CN_LOGO = chrome.CN_LOGO || "";
  // MARKET_CSS is accepted so the page keeps taking the site's shared chrome
  // object; the vault draws its own stylesheet and only lifts the account-nav
  // pieces from it, because a second copy of MARKET_BAR would drift.
  const ACCOUNT_NAV_CSS = chrome.ACCOUNT_NAV_CSS || "";
  const ACCOUNT_NAV_JS = chrome.ACCOUNT_NAV_JS || "";
  const ACCOUNT_NAV_SLOTS = chrome.ACCOUNT_NAV_SLOTS || "";
  const ACCOUNT_NAV_PRICING = chrome.ACCOUNT_NAV_PRICING || "";
  // </script> can never appear in the payload: every "<" is escaped, which is
  // also what keeps a comp note like "<img onerror=…>" inert inside the tag.
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Broker Vault · CompNinja</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box}
:root{
  --ink:#1A2433;--ink-2:#4C5665;--ink-3:#68707E;--ink-4:#C7CBD2;
  --red:#B91C1C;--red-deep:#991B1B;
  --green:#15803D;--green-ink:#06603A;
  --paper:#FBFBF9;--line:#E4E2DA;--hair:#F0EFE9;--wash:#F5F4EF;--edge:#D8D4C9;
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
.wrap{max-width:1120px;margin:0 auto;padding:0 var(--s6);width:100%}
.hdr{border-bottom:1px solid var(--line);background:rgba(251,251,249,.92);
  position:sticky;top:0;z-index:20;-webkit-backdrop-filter:saturate(1.2) blur(10px);
  backdrop-filter:saturate(1.2) blur(10px)}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:var(--s4);padding:14px var(--s6)}
/* 10px rather than --s4: the logo/wordmark lockup is a fixed brand
   relationship shared with index.html's header and MARKET_CSS, not this
   page's spacing scale, so it stays literal and identical everywhere. */
.brand{display:flex;align-items:center;gap:10px;color:var(--ink)}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:var(--t3);font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.wordmark b{color:var(--red);font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;font-size:13.5px}
.hdr nav a{color:var(--ink-2);padding:4px 0;white-space:nowrap}.hdr nav a:hover{color:var(--ink)}
.hdr nav a[aria-current="page"]{color:var(--ink);font-weight:600}
/* Explore + account circle, matching MARKET_BAR so the vault is not the one
   signed-in page whose bar drops Pricing and the circle. Load-bearing:
   .hdr nav .dd a sets display:block, which out-specifies [hidden], so the
   injected ACCOUNT_NAV_CSS (and the copy below) must keep slots hidden. */
.hdr nav [hidden]{display:none!important}
.hdr nav details{position:relative}
.hdr nav summary{list-style:none;cursor:pointer;color:var(--ink-2);white-space:nowrap;user-select:none}
.hdr nav summary::-webkit-details-marker{display:none}
.hdr nav summary:hover,.hdr nav details[open] summary{color:var(--ink)}
.hdr nav summary .car{display:inline-block;font-size:9px;margin-left:3px;color:var(--ink-3)}
.hdr nav .dd{position:absolute;right:0;top:calc(100% + 10px);z-index:1100;background:#fff;
  border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);
  padding:4px 0;min-width:176px}
.hdr nav .dd a{display:block;padding:8px 12px;color:#374253}
.hdr nav .dd a:hover{background:#F8FAFC;color:var(--ink)}
main{flex:1;padding:40px 0 72px}
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
.ledger{border:1px solid var(--edge);border-top:2px solid var(--ink);border-radius:var(--r);
  background:#fff;display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden;
  box-shadow:var(--shadow)}
.lcell{padding:18px 20px;border-left:1px solid var(--hair)}
.lcell:first-child{border-left:0}
.lcell.mid{background:#F7FBF8}
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
  background:#fff;box-shadow:var(--shadow)}
section{margin-top:var(--s8)}
section+section{border-top:1px solid var(--line);padding-top:var(--s7)}
h2{font-family:var(--serif);font-weight:500;font-size:var(--t2);margin:0 0 6px;letter-spacing:-.01em}
section > .sub{margin-top:0;margin-bottom:var(--s5)}
.drop{border:1px dashed var(--edge);border-radius:var(--r);padding:36px var(--s6);text-align:center;
  background:#fff;transition:border-color .15s,background .15s,box-shadow .15s}
.drop.over{border-color:var(--red);border-style:solid;background:#FDF8F8;box-shadow:inset 0 0 0 1px var(--red)}
.drop-k{margin:0 0 var(--s4);font-family:var(--serif);font-size:17px;font-weight:500;color:var(--ink)}
.drop p{margin:var(--s4) 0 0;color:var(--ink-2);font-size:var(--t5)}
.btn{background:var(--red);color:#fff;border:0;border-radius:var(--r);padding:9px 16px;
  font-weight:600;font-size:13.5px;font-family:inherit;cursor:pointer;line-height:1.3}
.btn:hover{background:var(--red-deep)}
.btn[disabled]{background:var(--ink-4);cursor:default}
.btn.ghost{background:#fff;color:var(--ink-2);border:1px solid var(--edge)}
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
.row label,.form label,.editrow label{display:flex;flex-direction:column;gap:5px;font-size:var(--t6);letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-3);font-weight:600}
select,input[type=text],input[type=date]{padding:8px 10px;border:1px solid var(--edge);border-radius:var(--r);
  font-family:inherit;font-size:16px;background:#fff;color:var(--ink);min-height:40px}
select:focus,input[type=text]:focus,input[type=date]:focus{outline:none;border-color:var(--ink);
  box-shadow:0 0 0 3px rgba(26,36,51,.08)}
/* 16px, not var(--t5): iOS Safari zooms on focus for any input under 16px
   and stays zoomed — on a data-entry page that means every filter tap. */
.filters{padding:14px 16px;margin-top:var(--s4);background:#fff;border:1px solid var(--edge);
  border-radius:var(--r);align-items:flex-end}
.filters .btn{min-height:40px}
.filters .note{margin:0 0 10px;align-self:flex-end}
.filters .exp{margin-left:auto}
table{width:100%;min-width:720px;border-collapse:collapse;font-size:13px;margin:0}
/* Statement tables (approved as "Vault B", 2026-08-08): an ink rule closes
   every header on this page — the broker's own book of record earns the same
   audited-statement vocabulary the report's comp table shipped. */
th{text-align:left;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
  font-weight:600;padding:12px 14px;border-bottom:2px solid var(--ink);white-space:nowrap;background:#fff}
th[data-k],th[data-bk]{cursor:pointer}
th[data-k]:hover,th[data-bk]:hover{color:var(--ink)}
th .ar{color:var(--red)}
td{padding:12px 14px;border-bottom:1px solid var(--hair);vertical-align:top;color:#374253}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tbody tr:hover td{background:#FCFBF8}
.addr{color:var(--ink);font-weight:500}
.tag{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-2);background:var(--wash);border-radius:3px;padding:2px 7px}
/* The comps table seals with a median row under a double rule. The last body
   row's hairline is dropped explicitly: with collapsed borders two same-width
   rules at that boundary would otherwise fight, and which one wins is
   browser-defined — the ink top rule must never lose to a hairline. */
#tbl tbody tr:last-child td{border-bottom:0}
tfoot td{padding:12px 14px;border-top:1px solid var(--ink);
  border-bottom:3px double var(--ink);font-weight:600;color:var(--ink);background:#fff}
tfoot .lab{font-size:var(--t6);letter-spacing:.07em;text-transform:uppercase;color:var(--ink-2)}
.tw{overflow-x:auto;border:1px solid var(--edge);border-radius:var(--r);background:#fff;
  margin-top:var(--s4);box-shadow:var(--shadow)}
.msg{margin-top:var(--s4);padding:12px 16px;border-radius:var(--r);font-size:var(--t5);border:1px solid}
.msg.ok{background:#F0FAF3;border-color:#BFE3CB;color:#14532D}
.msg.bad{background:#FDF2F2;border-color:#F0C7C7;color:#7F1D1D}
.msg ul{margin:var(--s3) 0 0;padding-left:var(--s6)}
.msg li{margin-top:var(--s1);font-variant-numeric:tabular-nums}
#gate .msg{max-width:44ch;margin-top:var(--s7)}
.load{margin-top:var(--s7);max-width:420px}
.loadbar{height:3px;background:var(--hair);border-radius:2px;overflow:hidden;margin-bottom:var(--s4)}
.loadbar i{display:block;height:100%;width:38%;background:var(--red);
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
.pubbtn{background:#fff;border:1px solid var(--edge);border-radius:4px;padding:5px 10px;
  font-family:inherit;font-size:var(--t6);font-weight:600;line-height:1.4;color:var(--ink-2);
  cursor:pointer;white-space:nowrap}
.pubbtn:hover{border-color:var(--ink-3);color:var(--ink)}
.pubbtn.on{border-color:transparent;background:#E3F2EA;color:var(--green-ink)}
.pubbtn[disabled]{opacity:.5;cursor:default}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--edge);border-radius:999px;
  padding:5px 8px 5px 12px;font-size:12.5px;background:#fff;color:var(--ink-2);font-weight:600;
  letter-spacing:0;text-transform:none}
.chip button{background:none;border:0;color:var(--ink-3);cursor:pointer;font-size:16px;line-height:1;
  padding:0 2px;font-family:inherit}
.chip button:hover{color:var(--red)}
/* Row actions: plain text links, not buttons. The row already carries one
   button (Publish); giving Edit/Delete the same weight would put three
   competing calls to action on one line. */
.lnk{background:none;border:0;padding:0;font-family:inherit;font-size:inherit;
  color:var(--ink-3);cursor:pointer;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.lnk:hover{color:var(--ink)}
.lnk.danger{color:var(--red)}
.lnk.danger:hover{color:var(--red-deep)}
td.rowact{white-space:nowrap}
/* The inline edit row: one form spanning every column, not per-cell inputs —
   a comp carries fields (cap_rate, tenancy, year_built, notes) the table has
   no column for at all, so a per-cell form could not hold them. Same grid as
   the add-by-hand and BOV forms, so the three data-entry surfaces read as
   one vocabulary. */
.editrow td{background:var(--wash);padding:16px 18px}
.editk{margin:0 0 12px;font-size:var(--t6);letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600}
.editrow .form{max-width:920px}
.editrow input,.editrow select{padding:8px 10px;border:1px solid var(--edge);border-radius:var(--r);
  font-family:inherit;font-size:16px;background:#fff;color:var(--ink);width:100%;min-height:40px}
/* ---- The market rollup: the page's lead view ----------------------------
   A broker with 400 comps learns nothing from 400 rows. This is the index to
   their own book: one card per market + property type, which is the same pair
   their lead coverage is keyed on, so the two sections describe the world the
   same way. Whole-book always, never narrowed by the filter below it: it is
   the map, and a map that hides everything but your current street is not a
   map. Clicking one drives the filter instead. */
.cards{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.card{border:1px solid var(--edge);border-radius:var(--r);background:#fff;padding:16px 18px;
  text-align:left;font-family:inherit;font-size:var(--t5);color:var(--ink);cursor:pointer;
  display:flex;flex-direction:column;gap:2px;transition:border-color .15s,background .15s,box-shadow .15s;
  box-shadow:var(--shadow)}
.card:hover{border-color:var(--ink-4);background:#fff}
.card.on{border-color:var(--red);background:#fff;box-shadow:inset 0 0 0 1px var(--red),var(--shadow)}
.card .mk{font-weight:600;font-size:15px;line-height:1.3;color:var(--ink)}
.card .ty{color:var(--ink-3);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600}
.card .big{font-family:var(--serif);font-size:22px;font-weight:500;margin-top:8px;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.card .big span{font-family:Inter,system-ui,sans-serif;font-size:var(--t5);color:var(--ink-3);
  letter-spacing:0;margin-left:6px}
.card .fine{color:var(--ink-3);font-size:var(--t6);font-weight:400;letter-spacing:0;text-transform:none}
.card .fine.pub{color:var(--green);font-weight:600}
.card.stat{cursor:default;box-shadow:none}
.card.stat:hover{border-color:var(--edge);background:#fff}
#bovCards{margin-top:var(--s4)}
/* ---- Chart + repeat-property blocks ---- */
/* Capped at the viewBox width so one SVG unit is one CSS pixel: the columns
   are drawn at a 24px maximum, and letting the chart stretch to a 1120px
   container would render them at ~40px, which is the heavy-saturated-block
   look the rest of this page avoids. Below 600px it scales down as normal. */
.chart svg{display:block;width:100%;max-width:600px;height:auto}
.rep{border-top:1px solid var(--hair);padding:10px 0;font-size:var(--t5)}
.rep:first-child{border-top:0;padding-top:0}
.rep .addr{font-weight:600}
.rep .deal{color:var(--ink-2);font-variant-numeric:tabular-nums;font-size:13px;margin-top:2px}
.note{color:var(--ink-3);font-size:var(--t5)}
/* ---- Gut check ----------------------------------------------------------
   Verdict chips stay in the page's existing voice: the pubbtn border style,
   ink for facts, green only for "in line" (the calm state), never red for a
   divergence — above/below is "worth a look", not an error. */
.gc{border:1px solid var(--edge);border-radius:var(--r);background:#fff;
  padding:16px 18px;font-size:var(--t5);display:flex;
  flex-direction:column;gap:4px;box-shadow:var(--shadow)}
.gc .mk{font-weight:600;font-size:15px}
.gc .ty{color:var(--ink-3);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600}
.gcv{display:inline-block;border:1px solid var(--edge);border-radius:999px;
  padding:2px 10px;font-size:var(--t6);color:var(--ink-2);font-weight:600;
  align-self:flex-start;margin-top:6px}
.gcv.ok{border-color:#BFE3CB;background:#F0FAF3;color:var(--green)}
.gc .fine{color:var(--ink-3);font-size:var(--t6)}
.gcOut{display:inline-block;margin-left:var(--s2);font-size:10px;
  letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);
  border-bottom:1px dotted var(--ink-3);cursor:help}
/* ---- First run ----------------------------------------------------------
   Deliberately quiet: two numbered steps on the page's own type scale, no
   illustration, no coloured callout box. A broker arriving here has just paid
   for something, and a loud empty state reads as a product apologising for
   itself. The numbers carry the sequence; everything else is ordinary text.
   The cards are the same white panel the rest of the workspace uses, not a
   coloured empty-state. */
.steps{display:grid;gap:var(--s5);margin-top:var(--s7)}
@media (min-width:760px){.steps{grid-template-columns:1fr 1fr;gap:var(--s5)}}
.step{display:flex;gap:var(--s4);align-items:flex-start;background:#fff;border:1px solid var(--edge);
  border-radius:var(--r);padding:22px 22px 20px;box-shadow:var(--shadow)}
.stepn{flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:var(--ink);color:#fff;
  font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;margin-top:1px}
.step h3{font-family:var(--serif);font-weight:500;font-size:18px;margin:0 0 6px;letter-spacing:-.01em}
.step p{margin:0 0 var(--s4);color:var(--ink-2)}
.step .fine{color:var(--ink-3);font-size:var(--t5)}
/* The owner's 2026-08-10 restructure: cards carry three short bullets and
   fold their fine print into a collapsed disclosure. Same vars as .fine so
   the disclosure reads as the fine print it replaced. */
.step ul{margin:0 0 var(--s4);padding-left:18px;color:var(--ink-2)}
.step ul li{margin:3px 0}
.step details{margin:0 0 var(--s4)}
.step details summary{cursor:pointer;color:var(--ink-3);font-size:var(--t5);user-select:none;list-style-position:inside}
.step details summary:hover{color:var(--ink-2)}
.step details .fine{margin:var(--s3) 0 0}
/* When first-run is the page, a lead TABLE can still appear under the two
   cards if a watched market already has owners waiting — that is the one
   leftover that earns its place. The empty inbox, the heading over nothing,
   and the BOV tracker stay hidden. A hairline keeps a real table from
   reading as a leftover empty section. */
#firstRun:not(.hide) ~ #leads:not(.hide){margin-top:var(--s8);padding-top:var(--s7);border-top:1px solid var(--line)}
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
.dact{background:#fff;border:1px solid var(--red);border-radius:var(--r);padding:6px 12px;
  font-family:inherit;font-size:13px;font-weight:600;color:var(--red);cursor:pointer;white-space:nowrap}
.dact:hover{background:var(--red);color:#fff}
/* The uploader and the column mapper stopped being sections when they moved
   under the book deck: a section would draw the section+section divider, and
   both of these are transient panels that a returning broker opens on
   purpose. Being divs also means the sections after them are never "a section
   after a hidden section", which is what the two adjacency patches this
   replaced were for. */
.addpanel,.mappanel{margin-top:var(--s5);padding:20px;border:1px solid var(--edge);border-radius:var(--r);
  background:#fff;box-shadow:var(--shadow)}
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
.strip{border:1px solid var(--edge);border-radius:var(--r);background:#fff;
  display:grid;grid-template-columns:repeat(3,1fr);overflow:hidden;margin-top:var(--s4);
  box-shadow:var(--shadow)}
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
.dbox{border:1px solid var(--edge);border-radius:var(--r);background:#fff;
  padding:12px 18px;margin-top:var(--s4);box-shadow:var(--shadow)}
.dbox>summary{cursor:pointer;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;user-select:none;list-style-position:inside}
.dbox>summary:hover{color:var(--ink)}
.dbox[open]>summary{margin-bottom:var(--s4);color:var(--ink)}
footer{background:var(--ink);color:#B8C0CC;font-size:13px;padding:0;border:0;margin-top:auto}
footer .wrap{padding:36px var(--s6)}
footer .wordmark{color:#fff}
footer p{color:#8F99A8;margin:10px 0 0;max-width:62ch;line-height:1.6}
${ACCOUNT_NAV_CSS}
</style></head><body>
<header class="hdr"><div class="wrap">
  <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
  <nav>
    <details>
      <summary>Explore<span class="car">▾</span></summary>
      <div class="dd">${ACCOUNT_NAV_PRICING}<a href="/brokers">Brokers</a>
      <a href="/markets">Markets</a><a href="/how-it-works">How it works</a>
      <a href="/1031-exchange">1031 Guide</a><a href="/">Run a report</a></div>
    </details>
    <a href="/desk">My Desk</a>
    <a href="/vault" aria-current="page">Vault</a>
    ${ACCOUNT_NAV_SLOTS}
  </nav>
</div></header>${ACCOUNT_NAV_JS}
<script>document.addEventListener("click",function(e){
document.querySelectorAll(".hdr nav details[open]").forEach(function(d){
if(!d.contains(e.target))d.open=false;});});
document.addEventListener("keydown",function(e){
if(e.key!=="Escape")return;
var dd=document.querySelector(".hdr nav details[open]");
if(dd)dd.open=false;});</script>
<main><div class="wrap">
  <p class="kicker">Private workspace</p>
  <h1 class="h">Broker Vault</h1>
  <p class="sub">Closed deals, leads, and BOVs. Visible only to you.</p>

  <!-- Visible from the first paint. Everything below the title waits on
       /api/vault (session -> entitlements -> two reads), and with both panes
       hidden the page spent that window looking half-rendered before the
       workspace popped in. The fetch's three outcomes each replace this:
       success hides #gate, a refusal rewrites it, so it can never linger. -->
  <div id="gate"><div class="load"><div class="loadbar"><i></i></div>
    <p class="empty" style="padding:0">Loading your vault&hellip;</p></div></div>

  <div id="app" class="hide">
    <!-- The trust line's job is to prove a number stays at zero, which only
         works once there is something it could have counted. On day one it is
         a scoreboard reading 0-0 above an empty page, so it is hidden until
         the first import lands. The empty vault's privacy promise lives in
         step 1's collapsed "Required columns & privacy details" disclosure
         (the owner's 2026-08-10 restructure: off the card face, one click
         away rather than gone); this line restates it the moment there is a
         comp, and the publish flow makes it again where it can be acted on.
         See applyFirstRun(). -->
    <div class="trust hide" id="trustLine">
      <div class="ledger">
        <div class="lcell"><span class="llab">Comps</span>
          <div class="lfig" id="cCount">0</div><div class="lsub" id="cImports"></div></div>
        <div class="lcell"><span class="llab">Priced sales</span>
          <div class="lfig" id="cPriced">0</div><div class="lsub" id="cPricedPct"></div></div>
        <div class="lcell"><span class="llab">Median $/SF</span>
          <div class="lfig" id="cMed">&mdash;</div><div class="lsub" id="cMedSub">sales only</div></div>
        <div class="lcell mid"><span class="llab">Published</span>
          <div class="lfig" id="cPub">0</div><div class="lsub">only if you choose it</div></div>
      </div>
      <p class="note">Visible only to you. Nothing here is ever read into CompNinja&rsquo;s
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
          <div class="formact">
            <button class="btn" id="idSave">Save</button>
            <button class="btn ghost" id="idCancel">Cancel</button>
          </div>
        </div>
        <p class="fine" style="margin-top:var(--s3)">Published comps are credited to your firm
          when you have one, otherwise to your name. This is not a public listing &mdash; it only
          names the credit on comps you choose to publish.</p>
        <p class="msg bad hide" id="idMsg"></p>
      </div>
    </div>
    <p id="trunc" class="note hide" style="margin-top:var(--s3)">Showing the most recent 1,000 comps.
      The figures below are drawn from those, so your full book may be larger.</p>


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
      <div class="steps">
        <div class="step">
          <span class="stepn">1</span>
          <div>
            <h3>Build your own comp set</h3>
            <p>Upload closed deals.</p>
            <ul>
              <li>Appears in your reports</li>
              <li>Transforms data into an organized set</li>
              <li>Never visible to others</li>
            </ul>
            <!-- The friction the disclosure removes is fear, not typing: a broker
                 looking at a ten-column template assumes all ten are mandatory and
                 that a deal with an undisclosed price cannot go in. Neither is
                 true — but at the owner's request (2026-08-10) the reassurance is
                 folded away until asked for, so the card itself stays three lines. -->
            <details>
              <summary>Required columns &amp; privacy details</summary>
              <p class="fine">Four columns are required: address, property type, sale or
                lease, and the date. Everything else is optional, so undisclosed deals
                still count.</p>
              <p class="fine">Your comps are never read into CompNinja&rsquo;s public
                records, never included in an export or a shared link, and never shown
                to another broker.</p>
            </details>
            <div class="row" style="margin-top:var(--s4)">
              <a class="btn" href="/api/vault/template" id="frTpl">Download the template</a>
              <button class="btn ghost" id="frPick">Choose a spreadsheet</button>
            </div>
          </div>
        </div>

        <div class="step">
          <span class="stepn">2</span>
          <div>
            <h3>Or watch your markets for leads</h3>
            <p>Nothing to upload. Works on an empty vault.</p>
            <ul>
              <li>See owners requesting valuations in your markets</li>
              <li>Identities stay anonymous until you request an intro</li>
              <li>CompNinja makes the introduction by hand</li>
            </ul>
            <details>
              <summary>How markets work</summary>
              <p class="fine">Add the markets you cover. You&rsquo;ll start seeing property
                owners there who&rsquo;ve asked for a valuation. Their details stay
                anonymous until you ask for an introduction.</p>
            </details>
            <!-- The ONE market-adding form on the page. applyFirstRun moves this
                 node down into #leads once the vault has content, because this
                 whole card hides then and a broker must always have somewhere to
                 add a market. One node, relocated — never a second copy that
                 would drift from the coverage rules. -->
            <div id="covFormHome"><div id="covForm">
              <div class="form">
                <label class="span2">Market <input id="covMarket" type="text" placeholder="City, ST"/></label>
                <label>Type <select id="covType"></select></label>
                <div class="formact"><button class="btn" id="covAdd">Watch this market</button></div>
              </div>
              <div class="row" id="covRow"></div>
              <div id="leadMsg"></div>
              <!-- Plain-language rewrite (2026-08-12). The old line read
                   "Removing every market re-fills earned ones on your next
                   visit", which assumes the reader knows markets can be
                   "earned". They can: seedCoverageFromSubmissions refills
                   coverage from a broker's approved comps, but only when the
                   list is empty and only on a visit that does not pass
                   noseed=1. Say the trade, not the mechanism. -->
              <p class="fine" style="margin-top:var(--s3)">Remove all of them and any market
                where you have submitted a comp comes back on your next visit.</p>
            </div></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ------------------------------------------------------------------
         The book deck. Everything from here to the pipeline rule is the
         broker's own data: what they have, and where it came from.

         "Add comps" used to be a full section ABOVE the comps table, so a
         broker with 200 comps opened their book and was shown an uploader
         first. It is the deck's action now, and the panel opens on click (or
         on dragging a file anywhere over the page). The first-run panel is
         deliberately OUTSIDE this deck: on day one there is no book, and a
         rule reading "Your book" over an empty one is the same 0-0 scoreboard
         the trust line is hidden to avoid.
         ------------------------------------------------------------------ -->
    <div class="deck hide" id="deckBook">
      <span class="dlab">Your book</span><span class="dln"></span>
      <button class="dact" id="addToggle" aria-expanded="false" aria-controls="addSec">+ Add comps</button>
    </div>

    <div id="addSec" class="addpanel hide">
      <div class="drop" id="drop">
        <p class="drop-k">Import a spreadsheet</p>
        <button class="btn" id="pick">Choose a spreadsheet</button>
        <p>or drop a .csv here &middot; <a href="/api/vault/template" id="tpl">download the template</a></p>
        <input type="file" id="file" accept=".csv,text/csv" class="hide"/>
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
          <label>Tenancy <input id="addComp_tenancy" type="text" placeholder="optional"/></label>
          <label>Year built <input id="addComp_year_built" type="text" placeholder="optional"/></label>
          <label class="span-all">Notes <input id="addComp_notes" type="text" placeholder="optional"/></label>
          <label>Lat <input id="addComp_lat" type="text" placeholder="optional"/></label>
          <label>Lng <input id="addComp_lng" type="text" placeholder="optional"/></label>
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
      <p id="mapMsg" class="msg bad hide"></p>
      <div class="formact mapact">
        <button class="btn" id="mapGo">Import</button>
        <button class="btn ghost" id="mapCancel">Cancel</button>
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
        <button class="btn ghost hide" id="fClear">Clear</button>
        <span class="note" id="shown"></span>
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
      <div class="tw"><table id="tbl">
        <thead><tr>
          <th data-k="address">Address</th><th data-k="market">Market</th>
          <th data-k="property_type">Type</th><th data-k="transaction">Deal</th>
          <th data-k="deal_date">Date</th><th data-k="price" class="num">Price</th>
          <th data-k="size_sqft" class="num">Size</th><th data-k="price_per_sqft" class="num">$/SF</th>
          <th data-k="published">Public</th><th></th>
        </tr></thead><tbody id="tbody"></tbody><tfoot id="tblFoot"></tfoot>
      </table></div>
      <!-- "above" used to point at a section in plain view. The uploader is a
           closed panel now, so this names the control that opens it. -->
      <div class="empty hide" id="none">Nothing here yet. Use &ldquo;Add comps&rdquo; above to upload a spreadsheet.</div>
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
         The pipeline deck: work coming IN, rather than work already done.
         Deliberately no action on this rule — the market-adding form
         (#covForm) is relocated to the top of the leads section directly
         beneath it, so a control here would point at something already on
         screen. (The approved Direction U card drew one; it was redundant
         once the form landed a line below it.)
         ------------------------------------------------------------------ -->
    <div class="deck hide" id="deckPipe">
      <span class="dlab">Your pipeline</span><span class="dln"></span>
    </div>

    <!-- Display only since 2026-08-10: the market-adding form (#covForm) lives
         in Start-here step 2 on a first run and is moved to the top of this
         section by applyFirstRun once the vault has content. Do not add a
         second form here — one node, relocated, is the rule. Ships hidden so
         an empty vault does not flash the inbox under the two first-run cards
         before applyFirstRun runs; revealed when there is a book, or when a
         watched market already has leads waiting. -->
    <section id="leads" class="hide">
      <h2>Leads in your markets</h2>
      <p class="sub" style="margin-top:0">Property owners requesting a Broker Opinion of Value
        show up here for any market you&rsquo;re watching.</p>
      <div id="covFormSlot"></div>
      <div class="tw hide" id="leadTableWrap"><table>
        <thead><tr><th>Received</th><th>Market</th><th>Type</th><th class="num">Size</th><th></th></tr></thead>
        <tbody id="leadRows"></tbody>
      </table></div>
      <div class="empty hide" id="noLeads">No leads in your markets in the last 90 days.</div>
    </section>

    <section id="bovSec" class="hide">
      <h2>BOV tracker</h2>
      <p class="sub" style="margin-top:0">Every Broker Opinion of Value you&rsquo;re working,
        from any source. Introductions you request above land here automatically; log the
        rest yourself. This is your private log: only you can see it.</p>
      <div class="cards" id="bovCards"></div>
      <div class="form" style="margin-top:var(--s4)">
        <label>Market <input id="bovMarket" type="text" placeholder="City, ST"/></label>
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
      <div class="tw hide" id="bovTableWrap"><table id="bovTbl">
        <thead><tr>
          <th data-bk="received_on">Received</th><th data-bk="market">Market</th>
          <th data-bk="property_type">Type</th><th data-bk="size_sqft" class="num">Size</th>
          <th data-bk="source">Source</th><th data-bk="status">Status</th>
          <th>Notes</th><th></th>
        </tr></thead><tbody id="bovRows"></tbody>
      </table></div>
      <div class="empty hide" id="noBovs">Nothing logged yet. Request an introduction above,
        or log a BOV you got elsewhere.</div>
    </section>
  </div>
</div></main>
<footer><div class="wrap">
  <span class="wordmark">Comp<b>Ninja</b></span>
  <p>Private broker workspace. Your comps are never read into public records unless you choose to publish them.</p>
</div></footer>
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
  // The one comp row currently swapped for an inline edit form, or null. Only
  // one at a time: two open forms would double the "only changed fields
  // travel" bookkeeping in saveComp for no real benefit.
  var editingId=null;

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
  function view(){
    var m=$("fMarket").value,t=$("fType").value;
    if(!m&&!t)return comps;
    return comps.filter(function(c){
      return (!m||c.market===m)&&(!t||c.property_type===t);
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
      return '<option value="'+esc(v)+'"'+(v===cur?" selected":"")+">"+esc(v)+"</option>"}).join("");
  }

  function compById(id){
    for(var i=0;i<comps.length;i++){ if(String(comps[i].id)===String(id))return comps[i]; }
    return null;
  }

  // Every field PATCH /api/vault/comp accepts. The whole row becomes one form
  // spanning the table's colspan, not ten per-cell inputs: a comp carries
  // fields (cap_rate, tenancy, year_built, notes) the table itself has no
  // column for, so a per-cell form could never reach them.
  var EDIT_FIELDS=["address","property_type","transaction","deal_date",
                   "price","size_sqft","cap_rate","tenancy","year_built","notes"];
  var EDIT_LABELS={address:"Address",property_type:"Type",transaction:"Sale/lease",
    deal_date:"Date",price:"Price",size_sqft:"Size (SF)",cap_rate:"Cap rate",
    tenancy:"Tenancy",year_built:"Year built",notes:"Notes"};

  function editRow(c){
    var fields=EDIT_FIELDS.map(function(f){
      var v=c[f]==null?"":c[f];
      var wide=(f==="address"||f==="notes")?' class="span2"':"";
      return "<label"+wide+">"+esc(EDIT_LABELS[f]||f)+
        '<input type="text" id="edit_'+f+'" value="'+escA(v)+'"/></label>';
    }).join("");
    return '<tr class="editrow"><td colspan="10"><p class="editk">Editing this comp</p><div class="form">'+fields+
      '<div class="formact span-all"><button class="btn" type="button" data-save-edit="'+esc(c.id)+'">Save</button>'+
      '<button class="btn ghost" type="button" data-cancel-edit="1">Cancel</button></div>'+
      "</div></td></tr>";
  }

  function render(){
    var rows=view().slice().sort(function(a,b){
      var x=a[sortK],y=b[sortK];
      if(x==null&&y==null)return 0; if(x==null)return 1; if(y==null)return -1;
      if(typeof x==="number"&&typeof y==="number")return sortAsc?x-y:y-x;
      return sortAsc?String(x).localeCompare(String(y)):String(y).localeCompare(String(x));
    });
    var gutOutliers=renderGutCheck(rows);
    $("none").className=rows.length?"empty hide":"empty";
    // Say "of N" whenever a filter is narrowing, so the number on screen can
    // never be mistaken for the size of the book.
    $("shown").textContent=rows.length
      ? (rows.length===comps.length?rows.length+" shown":rows.length+" of "+comps.length+" shown")
      : "";
    renderChart(rows);
    renderRepeats(rows);
    $("tbody").innerHTML=rows.map(function(c){
      // A row being edited replaces itself with the form, rather than the
      // form appearing beside it: two representations of the same comp on
      // screen at once is what "only changed fields travel" was written to
      // avoid confusion about.
      if(editingId===c.id)return editRow(c);
      // Published state is a two-way toggle, never a checkbox that could be
      // flipped by a stray click: publishing is a one-way-ish public act, so
      // it goes through a button and a confirm.
      var pub=c.published
        ? '<button class="pubbtn on" data-pub="'+esc(c.id)+'" data-on="1">Published</button>'
        : '<button class="pubbtn" data-pub="'+esc(c.id)+'">Publish</button>';
      var flag=gutOutliers[c.id]
        ? ' <span class="gcOut" title="'+escA(Math.abs(gutOutliers[c.id].pct)+"% "+
            (gutOutliers[c.id].dir==="above"?"above":"below")+" the market band")+'">outlier</span>'
        : "";
      var actions='<td class="rowact"><button class="lnk" data-edit="'+esc(c.id)+
        '">Edit</button> <button class="lnk danger" data-del-comp="'+esc(c.id)+'">Delete</button></td>';
      return '<tr><td class="addr">'+esc(c.address)+"</td><td>"+esc(c.market)+"</td><td>"+esc(c.property_type)+
        '</td><td><span class="tag">'+esc(c.transaction)+"</span></td><td>"+esc(c.deal_date)+
        '</td><td class="num">'+money(c.price)+'</td><td class="num">'+num(c.size_sqft)+
        '</td><td class="num">'+psf(c.price_per_sqft)+flag+"</td><td>"+pub+"</td>"+actions+"</tr>";
    }).join("");
    // The statement's closing rule: the median of the priced sales in the
    // current view, sealed under a double rule — the same figure the market
    // cards and the year chart lead with, so the three views read against
    // each other. No priced sales = no row; a double rule over a blank would
    // claim a figure that does not exist.
    var vst=psfStats(rows),vps=vst.values,vmed=median(vps);
    renderStrip(rows,vps,vmed,vst);
    // Three states, two of which still draw the closing rule: a view spanning
    // several property types says why there is no figure rather than sealing
    // the column with one, because the $/SF it would average is measured in
    // different units row to row.
    //
    // ONE row template with the label and the number varying, deliberately
    // not two branches emitting their own <tr>: the footer's column count is
    // checked by finding a single label cell with a colspan in this file and
    // counting the cells after it, so a second copy silently breaks that
    // check (it did, on the first attempt at this change). No backticks in
    // this block either — the whole page is one template literal.
    $("tblFoot").innerHTML=!vps.length ? "" :
      '<tr><td class="lab" colspan="7">'+
      (vst.mixed
        ? "No single median across "+vst.types+" property types \\u2014 filter by type to compare"
        : "Median of "+vps.length+" priced sale"+(vps.length===1?"":"s")+
          (rows.length===comps.length?"":" in this view"))+
      '</td><td class="num">'+(vst.mixed?"\\u2014":psf(vmed))+"</td><td></td><td></td></tr>";
    Array.prototype.forEach.call(document.querySelectorAll("th[data-k]"),function(th){
      var on=th.getAttribute("data-k")===sortK;
      th.innerHTML=th.textContent.replace(/[ \\u25b2\\u25bc]+$/,"")+(on?' <span class="ar">'+(sortAsc?"\\u25b2":"\\u25bc")+"</span>":"");
    });
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
      return {market:g.market,type:g.type,n:g.comps.length,pub:g.pub,
        med:median(ps),psfN:ps.length,
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
      // take one from, and the comp count where there are not. A book of
      // leases has no $/SF and must not be shown a blank space where every
      // other card has a figure.
      var head=g.med!=null
        ? '<div class="big">'+psf0(g.med)+'<span>/SF median</span></div>'
        : '<div class="big">'+g.n+'<span> comp'+(g.n===1?"":"s")+'</span></div>';
      var line=g.med!=null
        ? g.n+" comp"+(g.n===1?"":"s")+" \\u00b7 "+g.psfN+" priced sale"+(g.psfN===1?"":"s")
        : "no priced sales yet";
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
    rows.forEach(function(c){
      var y=yearOf(c),v=psfOf(c);
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
    if(pts.length<2||total<3){
      box.className="dbox chart";
      $("chartTitle").textContent="Median $/SF by year";
      $("chartWrap").innerHTML='<p class="note">A price trend needs priced sales in at least two years. '+
        (total?"There "+(total===1?"is 1":"are "+total)+" here so far.":"There are none in this view yet.")+"</p>";
      if(!rows.length)box.className="dbox chart hide";
      return;
    }
    box.className="dbox chart";
    $("chartTitle").textContent="Median $/SF by year \\u00b7 "+total+" priced sales";

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
    [0,max/2,max].forEach(function(v){
      s+='<line x1="'+L+'" y1="'+y(v).toFixed(1)+'" x2="'+(W-R)+'" y2="'+y(v).toFixed(1)+
        '" stroke="#E4E2DA" stroke-width="1"/>';
      s+='<text x="'+(L-8)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end" font-size="11" fill="#68707E" '+
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
      s+='<path d="'+bar(cx-bw/2,y(p.med),bw,h,4)+'" fill="'+(last?"#B91C1C":"#5A6473")+
        '" fill-opacity="'+(last?"1":"0.85")+'" pointer-events="none"/>';
      s+='<text x="'+cx.toFixed(1)+'" y="'+(H-12)+'" text-anchor="middle" font-size="11" fill="#68707E" '+
        'font-family="Inter, sans-serif">'+esc(p.year)+"</text>";
      // The endpoint is the one worth reading without hovering.
      if(last){
        s+='<text x="'+cx.toFixed(1)+'" y="'+(y(p.med)-7).toFixed(1)+'" text-anchor="middle" font-size="12" '+
          'font-weight="600" fill="#1A2433" font-family="Inter, sans-serif">'+psf0(p.med)+"</text>";
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
  function stripCell(lab,fig,sub,target,ok){
    var tag=target?"button":"div",
        cls="scell"+(target?" act":""),
        attr=target?' type="button" data-open="'+target+'"':"";
    return "<"+tag+' class="'+cls+'"'+attr+'><span class="slab">'+lab+"</span>"+
      '<div class="sfig'+(ok?" ok":"")+'">'+fig+"</div>"+
      (sub?'<div class="ssub">'+sub+"</div>":"")+"</"+tag+">";
  }
  function renderStrip(rows,vps,vmed,vst){
    var box=$("readStrip");
    // Nothing on screen means nothing to summarise. The empty-table line below
    // says what is going on; a strip of dashes above it would not.
    if(!rows.length){box.className="strip hide";box.innerHTML="";return;}
    var cells=[];
    // Reads the same psfStats the footer does, so the two cannot quote
    // different things — the rule this strip has carried since it shipped.
    var mixed=!!(vst&&vst.mixed);
    cells.push(stripCell("Median $/SF",(vps.length&&!mixed)?psf(vmed):"&mdash;",
      mixed?vst.types+" property types":
        (vps.length?vps.length+" priced sale"+(vps.length===1?"":"s"):"no priced sales"),
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
    $("firstRun").className=first?"":"hide";
    // Both decks stand down on a first run: there is no book to head, and the
    // pipeline rule over a single section reads as furniture. The two cards
    // are the whole page then — leads and the BOV tracker hide with the decks
    // unless a watched market already has owners waiting.
    $("deckBook").className=first?"deck hide":"deck";
    $("deckPipe").className=first?"deck hide":"deck";
    // The market form is ONE node, placed wherever the broker can see it:
    // its home (#covFormHome) in Start-here step 2 on a first run, the slot
    // at the top of the leads section otherwise (step 2 is hidden then, and
    // a broker with a full book must still be able to add a market).
    // appendChild MOVES an attached node, so no copy ever exists — and
    // deleting the last import walks it home again, since this function
    // re-applies both ways. Chips and the form's own error line travel
    // inside #covForm, so they cannot be stranded in a hidden section.
    if(first)$("covFormHome").appendChild($("covForm"));
    else $("covFormSlot").appendChild($("covForm"));
    // The uploader is step 1's job on a first run and the book deck's action
    // otherwise, so it is closed by default in BOTH cases and this only
    // re-asserts whatever the broker last chose. It deliberately does not
    // force it shut on a first run: #res lives inside this panel, so an import
    // that failed before it could raise the comp count would have written its
    // error into something invisible. doImport opens it for exactly that.
    setAddOpen(addOpen);
    $("trustLine").className=first?"trust hide":"trust";
    $("compsSec").className=first?"hide":"";
    $("importsSec").className=first?"dbox hide":"dbox";
    $("leads").className=first?"hide":"";
    $("bovSec").className=first?"hide":"";
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
  var identity={display_name:"",company:"",creditedTo:""};

  function renderIdentity(idn){
    identity=idn||{display_name:"",company:"",creditedTo:""};
    var to=identity.creditedTo||"";
    $("creditLine").innerHTML=to
      ? "Comps you publish are credited to <strong>"+esc(to)+"</strong>. "+
        '<button class="pubbtn" id="idEdit">Change</button>'
      : "Comps you publish need a name to credit them to. "+
        '<button class="pubbtn" id="idEdit">Add your firm</button>';
  }

  // The single writer of the form's visibility, like setAddOpen: the fields
  // are refilled from the last known identity on every open, so a cancelled
  // edit never leaves a half-typed firm name waiting to be saved later.
  function setIdOpen(open){
    if(open){
      $("idCompany").value=identity.company||"";
      $("idName").value=identity.display_name||"";
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
    var body={company:$("idCompany").value,display_name:$("idName").value};
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
          company:o.j.identity.company,creditedTo:o.j.creditedTo});
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
    var emptyHint='<span class="empty" style="padding:0">No markets yet. Add a market above to start seeing leads here, or submit comps to earn markets automatically.</span>';
    $("covRow").innerHTML=cov.length?cov.map(function(c){
      var label=escA(c.market)+" "+escA(c.property_type);
      return '<span class="chip">'+esc(c.market)+" \\u00b7 "+esc(c.property_type)+
        ' <button type="button" data-cov="'+escA(c.id)+'" aria-label="Stop watching '+label+'" title="Stop watching '+label+
        '">&times;</button></span>';
    }).join(" "):((firstRunCounts[0]===0&&firstRunCounts[1]===0)?"":emptyHint);
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
    // On a genuine empty vault the inbox is hidden with the pipeline. If a
    // watched market already has owners waiting, surface the table under the
    // two first-run cards — that is the one leftover that is not furniture.
    if(firstRunCounts[0]===0&&firstRunCounts[1]===0){
      $("leads").className=leads.length?"":"hide";
    }
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

  // ---- BOV tracker ----------------------------------------------------------
  var bovs=[],bovRollup=null,bovSortK="received_on",bovSortAsc=false;
  var BOV_STATUSES=["open","delivered","won","lost"];
  var BOV_SOURCE_LABEL={compninja:"CompNinja intro",referral:"Referral",repeat_client:"Repeat client",other:"Other"};
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
          $("bovCards").innerHTML=""; $("bovRows").innerHTML="";
          $("bovTableWrap").className="tw hide"; $("noBovs").className="empty hide";
          // Panel-scoped copy: requireBroker's strings name the lead inbox
          // (that copy is load-bearing for the leads panel above this one),
          // so a 403/503 here is reworded rather than shown verbatim.
          var msg=o.s===403?"The BOV tracker is part of Pro."
            :o.s===503?"The BOV tracker is unavailable right now. Please try again in a minute."
            :(o.j.error||"Couldn't load your BOV log.");
          $("bovMsg").innerHTML='<div class="msg bad">'+esc(msg)+"</div>";
          return;
        }
        $("bovMsg").innerHTML="";
        bovs=o.j.bovs||[];
        bovRollup=o.j.rollup||null;
        renderBovs(bovRollup);
      })
      .catch(function(){
        $("bovCards").innerHTML=""; $("bovRows").innerHTML="";
        $("bovTableWrap").className="tw hide"; $("noBovs").className="empty hide";
        $("bovMsg").innerHTML='<div class="msg bad">Couldn\\'t load your BOV log. Please try again.</div>';
      });
  }
  function bovTile(label,val){
    return '<div class="card stat"><span class="ty">'+esc(label)+'</span>'+
      '<div class="big">'+esc(String(val))+"</div></div>";
  }
  function renderBovs(ru){
    // Tiles only once there is anything to count: four zeros over an empty
    // section is the 0-0 scoreboard the first-run work removed elsewhere.
    if(!ru||!ru.total){ $("bovCards").innerHTML=""; }
    else{
      // The dash under the floor is deliberate: a win rate over one or two
      // decided BOVs reads as a joke (bov-log.js holds the floor).
      var wr=ru.winRate==null?"\\u2014":Math.round(ru.winRate*100)+"%";
      $("bovCards").innerHTML=bovTile("This year",ru.thisYear)+bovTile("Open",ru.open)+
        bovTile("Delivered",ru.delivered)+bovTile("Win rate",wr);
    }
    $("noBovs").className=bovs.length?"empty hide":"empty";
    $("bovTableWrap").className=bovs.length?"tw":"tw hide";
    var rows=bovs.slice().sort(function(a,b){
      var av=a[bovSortK],bv=b[bovSortK];
      if(av==null&&bv==null)return 0;
      if(av==null)return 1;
      if(bv==null)return -1;
      var c=typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv));
      return bovSortAsc?c:-c;
    });
    $("bovRows").innerHTML=rows.map(function(b){
      var sel='<select data-bov="'+escA(b.id)+'" data-prev="'+escA(b.status)+'">'+
        BOV_STATUSES.map(function(s){
          return '<option value="'+s+'"'+(b.status===s?" selected":"")+">"+
            s.charAt(0).toUpperCase()+s.slice(1)+"</option>";
        }).join("")+"</select>";
      return "<tr><td>"+esc(b.received_on||String(b.created_at||"").slice(0,10))+"</td>"+
        "<td>"+esc(b.market)+(b.address?' <span class="note">'+esc(b.address)+"</span>":"")+"</td>"+
        "<td>"+esc(b.property_type)+"</td>"+
        '<td class="num">'+(b.size_sqft?num(b.size_sqft)+" SF":"")+"</td>"+
        "<td>"+esc(BOV_SOURCE_LABEL[b.source]||b.source)+"</td>"+
        "<td>"+sel+"</td>"+
        "<td>"+esc(b.notes||"")+"</td>"+
        '<td><button class="pubbtn" data-bovdel="'+escA(b.id)+'">Remove</button></td></tr>';
    }).join("");
  }
  document.querySelector("#bovTbl thead").addEventListener("click",function(e){
    var th=e.target.closest("th[data-bk]"); if(!th)return;
    var k=th.getAttribute("data-bk");
    if(k===bovSortK)bovSortAsc=!bovSortAsc; else{bovSortK=k;bovSortAsc=false;}
    // The kept rollup means a sort click redraws in place and never clears
    // the tiles or costs a refetch.
    renderBovs(bovRollup);
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
          $("bovMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't save that change.")+"</div>";
          return;
        }
        sel.setAttribute("data-prev",next);
        loadBovs();   // the tiles moved
      })
      .catch(function(){
        sel.disabled=false; sel.value=prev;
        $("bovMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>';
      });
  });
  document.addEventListener("click",function(e){
    var del=e.target.getAttribute&&e.target.getAttribute("data-bovdel");
    if(!del)return;
    if(!confirm("Remove this BOV from your log?"))return;
    fetch("/api/broker/bovs?id="+encodeURIComponent(del),{method:"DELETE",credentials:"same-origin"})
      .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
      .then(function(o){
        if(o.s!==200){ $("bovMsg").innerHTML='<div class="msg bad">'+esc(o.j.error||"Couldn't remove that BOV.")+"</div>"; return; }
        // noseed: the row just removed must not be re-seeded from intro
        // requests by this same reload if the delete emptied the log. A
        // full page visit still reseeds it.
        loadBovs(true);
      })
      .catch(function(){ $("bovMsg").innerHTML='<div class="msg bad">That didn\\'t reach the server. Nothing was changed.</div>'; });
  });

  var pending = null;   // {name, csv} held while the broker maps

  function doImport(name, csv, mapping, onOk){
    // Whether this import came from the mapping screen decides where its
    // result can be SEEN: #res lives inside #addSec, which is hidden while
    // the panel is open, so a failure written there would be invisible.
    var viaMapper=!!mapInfo;
    // Not via the mapper means every word about this import — "Importing", the
    // row counts, the line-numbered errors — is written into #res, which lives
    // inside the uploader panel. Open it, or the broker watches nothing happen.
    if(!viaMapper)setAddOpen(true);
    $("pick").disabled=true;
    if(viaMapper){ $("mapGo").disabled=true; $("mapGo").textContent="Importing\\u2026"; }
    $("res").innerHTML='<div class="msg ok">Importing&hellip;</div>';
    var payload={filename:name,csv:csv};
    if(mapping)payload.mapping=mapping;
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
      if(viaMapper&&mapInfo){
        $("mapGo").textContent="Import";
        $("mapGo").disabled=false;
        $("mapMsg").innerHTML=esc(msg)+errs;
        $("mapMsg").classList.remove("hide");
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
        if(viaMapper)setAddOpen(true);
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
        $("res").innerHTML='<div class="msg '+(j.skipped?"bad":"ok")+'">'+esc(bits.join(" \\u00b7 "))+errList(j)+"</div>";
        load();
      })
      .catch(function(){ failed("The upload did not reach the server. Nothing was saved.",""); });
  }

  function upload(file){
    if(!file)return;
    $("pick").disabled=true; $("res").innerHTML='<div class="msg ok">Reading '+esc(file.name)+"&hellip;</div>";
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

  var mapInfo=null;

  // The dropdown's LIST is served by /api/vault/inspect (targets), so it can
  // never drift from TEMPLATE_COLUMNS + OPTIONAL_SPEC_COLUMNS. This only
  // decides how each served value is SPOKEN: a broker meeting this screen for
  // the first time should not have to read twenty-four database identifiers.
  // Anything without a label falls back to its raw value, so a per-type field
  // added later still appears rather than vanishing.
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
    beds_baths:"Beds / baths"
  };
  function tLabel(t){ return TARGET_LABELS[t]||t }
  // A required field can be unclaimable rather than merely unclaimed: a CoStar
  // or MLS SALE-comps export carries no deal-type column at all, because every
  // row is a sale. Value transformation is deliberately out of scope, so no
  // dropdown rescues that file and "Still needed: Sale or lease" with a dead
  // Import button and a Cancel button is the whole conversation. These say
  // what is wrong and what to do about it, in the broker's own words.
  var NO_COLUMN_HELP={
    transaction:"Your file has no column saying whether each deal was a sale or a lease. Add one with values Sale or Lease, then upload again."
  };
  // The raw header the broker actually sees in their spreadsheet, for a
  // normalized key. column_4 is our own synthetic name for a header that
  // normalizes to nothing (a "$" price column); it exists nowhere in their
  // world, so it may key a <select> but must never be shown to them.
  function rawHeader(n){
    var i=(mapInfo.normalized||[]).indexOf(n);
    return i<0?n:String((mapInfo.headers||[])[i]);
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
    $("addSec").classList.add("hide");
    // Hidden too, or a first-run broker — which the FIRST broker through this
    // door is by definition — keeps the first-run steps on screen above the
    // panel that replaced step 1. closeMapper puts it back.
    $("firstRun").classList.add("hide");
    Array.prototype.forEach.call($("mapBody").querySelectorAll("select"),function(s){
      s.addEventListener("change",refreshMapper);
    });
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
    var missing=(mapInfo.required||[]).filter(function(t){return claimed.indexOf(t)<0});
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
      var stuck=anyFree?[]:missing;
      stuck.filter(function(t){return NO_COLUMN_HELP[t]}).forEach(function(t){
        lines.push(NO_COLUMN_HELP[t]);
      });
      // The rest share one sentence rather than one each: three near-identical
      // lines under a dead button is noise, not help.
      var rest=stuck.filter(function(t){return !NO_COLUMN_HELP[t]});
      if(rest.length){
        lines.push("Nothing in your file looks like the "+
          rest.map(function(t){return tLabel(t).toLowerCase()}).join(" or ")+", so "+
          (rest.length===1?"that column has":"those columns have")+
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
    // NOT an unconditional un-hide of #addSec: applyFirstRun deliberately
    // hides it on a first run, where step 1 owns the uploader, and restoring
    // it there leaves "Choose a spreadsheet" twice on one page. Re-applying
    // the same function is what keeps that rule in one place.
    applyFirstRun(firstRunCounts[0],firstRunCounts[1]);
    pending=null; mapInfo=null;
  }

  $("mapGo").addEventListener("click",function(){
    if(!pending)return;
    var p=pending;
    // The panel closes on SUCCESS only. Closing here would clear the mapping,
    // the held file and every dropdown before knowing whether the import
    // worked, leaving a re-pick and a full re-map as the only way back.
    doImport(p.name,p.csv,currentMapping(),closeMapper);
  });
  $("mapCancel").addEventListener("click",function(){
    closeMapper();
    $("res").innerHTML='<div class="msg ok">Cancelled. Nothing was saved.</div>';
  });

  $("pick").addEventListener("click",function(){ $("file").click() });
  // Step 1's button is the same door as #pick — one file input on the whole
  // page, so an upload started here lands in the same handler and the same
  // result message.
  $("frPick").addEventListener("click",function(){ $("file").click() });
  $("file").addEventListener("change",function(e){ upload(e.target.files[0]); e.target.value=""; });
  ["dragenter","dragover"].forEach(function(ev){ $("drop").addEventListener(ev,function(e){
    e.preventDefault(); $("drop").classList.add("over"); })});
  ["dragleave","drop"].forEach(function(ev){ $("drop").addEventListener(ev,function(e){
    e.preventDefault(); $("drop").classList.remove("over"); })});
  $("drop").addEventListener("drop",function(e){ upload(e.dataTransfer.files[0]) });
  // The dropzone now sits in a panel that is closed by default, so a file
  // dragged at the page would have nowhere to land and the feature would look
  // deleted. Dragging a FILE anywhere over the window opens the panel; from
  // there #drop's own handlers above behave exactly as they always have.
  // Guarded on the deck being visible: on a first run step 1 owns the
  // uploader, and a second one appearing mid-drag is the duplicate this page
  // has always refused.
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
                   "price","size_sqft","cap_rate","tenancy","year_built",
                   "notes","lat","lng"];
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
    $("fClear").className=($("fMarket").value||$("fType").value)?"btn ghost":"btn ghost hide";
    renderRollup();
    render();
  }
  $("fMarket").addEventListener("change",redraw);
  $("fType").addEventListener("change",redraw);
  $("fClear").addEventListener("click",function(){
    $("fMarket").value=""; $("fType").value=""; redraw();
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
          if(o.j.code==="needs_credit_name")setIdOpen(true);
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

  function openEditor(id){
    if(!compById(id))return;
    editingId=id;
    render();
  }

  function closeEditor(){
    editingId=null;
    render();
  }

  async function deleteComp(id){
    // Hard delete, no undo: confirm by name rather than with a generic prompt.
    if(!confirm("Delete this comp? This cannot be undone."))return;
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
    compMsg(j.unpublished
      ? "Deleted, and withdrawn from the public records."
      : "Deleted.");
  }

  // Sends only CHANGED fields, so an untouched input can never overwrite a
  // value with a stale copy the page happened to be holding.
  async function saveComp(id,before){
    var patch={},any=false;
    EDIT_FIELDS.forEach(function(f){
      var el=$("edit_"+f); if(!el)return;
      var v=el.value.trim();
      var was=before[f]==null?"":String(before[f]);
      if(v!==was){patch[f]=v;any=true;}
    });
    if(!any){closeEditor();return;}
    var r;
    try{
      r=await fetch("/api/vault/comp?id="+encodeURIComponent(id),{
        method:"PATCH",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify(patch)});
    }catch(err){
      return compMsg("That didn't reach the server. Nothing was changed.",true);
    }
    var j=await r.json().catch(function(){return{};});
    // 400 and 409 both carry a sentence written for the broker, and a 400
    // lists EVERY problem with the row rather than just the first. Show it
    // whole: "You already have this comp." tells them what to do, "Could not
    // save" does not.
    if(!r.ok)return compMsg(j.error||"Could not save that change.",true);
    closeEditor();
    load();
    compMsg(j.unpublished
      ? "Saved. This comp was published, so it has been withdrawn from the public records \\u2014 publish it again when you are happy with it."
      : "Saved.");
  }

  // A second delegated listener beside the publish one above, rather than a
  // rewrite of it: each early-returns when the click was not its own kind of
  // button, so the two coexist safely on the same element.
  $("tbody").addEventListener("click",function(e){
    var d=e.target.closest("button[data-del-comp]");
    if(d)return deleteComp(d.getAttribute("data-del-comp"));
    var s=e.target.closest("button[data-save-edit]");
    if(s)return saveComp(s.getAttribute("data-save-edit"),compById(s.getAttribute("data-save-edit"))||{});
    var c=e.target.closest("button[data-cancel-edit]");
    if(c)return closeEditor();
    var b=e.target.closest("button[data-edit]");
    if(b)return openEditor(b.getAttribute("data-edit"));
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
