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
  const THEME_CSS = chrome.THEME_CSS || "";
  const THEME_BOOT = chrome.THEME_BOOT || "";
  // </script> can never appear in the payload: every "<" is escaped, which is
  // also what keeps a comp note like "<img onerror=…>" inert inside the tag.
  const bootJson = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Broker Vault · CompNinja</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9" media="(prefers-color-scheme: light)"/>
<meta name="theme-color" content="#121826" media="(prefers-color-scheme: dark)"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box}
${THEME_CSS}
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
.wrap{max-width:1120px;margin:0 auto;padding:0 var(--s6);width:100%}
.hdr{border-bottom:1px solid var(--line);background:color-mix(in srgb, var(--paper) 92%, transparent);
  position:sticky;top:0;z-index:20;-webkit-backdrop-filter:saturate(1.2) blur(10px);
  backdrop-filter:saturate(1.2) blur(10px)}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:var(--s4);padding:14px var(--s6)}
/* 10px rather than --s4: the logo/wordmark lockup is a fixed brand
   relationship shared with index.html's header and MARKET_CSS, not this
   page's spacing scale, so it stays literal and identical everywhere. */
.brand{display:flex;align-items:center;gap:10px;color:var(--ink)}
.brand svg{height:28px;width:28px;flex-shrink:0}
/* Dark-mode fix (2026-08-10, fix round 1): CN_LOGO's rect/polygon carry a
   literal fallback fill= (see its declaration in server.js), overridden here
   the same way MARKET_CSS and HOW_CSS override it. This file does not
   interpolate MARKET_CSS despite taking it as a parameter -- the page has
   always carried its own copy of .hdr/.brand/.wordmark -- so the rule has
   to be repeated here or /vault's header logo stays unthemed. */
.cn-logo rect{fill:var(--ink)}
.cn-logo polygon{fill:var(--red-fill)}
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
.hdr nav .dd{position:absolute;right:0;top:calc(100% + 10px);z-index:1100;background:var(--card);
  border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);
  padding:4px 0;min-width:176px}
.hdr nav .dd a{display:block;padding:8px 12px;color:var(--ink-body)}
.hdr nav .dd a:hover{background:var(--wash);color:var(--ink)}
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
  background:var(--card);display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden;
  box-shadow:var(--shadow)}
.lcell{padding:18px 20px;border-left:1px solid var(--hair)}
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
  background:var(--card);box-shadow:var(--shadow)}
section{margin-top:var(--s8)}
section+section{border-top:1px solid var(--line);padding-top:var(--s7)}
h2{font-family:var(--serif);font-weight:500;font-size:var(--t2);margin:0 0 6px;letter-spacing:-.01em}
section > .sub{margin-top:0;margin-bottom:var(--s5)}
.drop{border:1px dashed var(--edge);border-radius:var(--r);padding:36px var(--s6);text-align:center;
  background:var(--card);transition:border-color .15s,background .15s,box-shadow .15s}
.drop.over{border-color:var(--red);border-style:solid;background:var(--err-bg);box-shadow:inset 0 0 0 1px var(--red)}
.drop-k{margin:0 0 var(--s4);font-family:var(--serif);font-size:17px;font-weight:500;color:var(--ink)}
.drop p{margin:var(--s4) 0 0;color:var(--ink-2);font-size:var(--t5)}
.btn{background:var(--red-fill);color:#fff;border:0;border-radius:var(--r);padding:9px 16px;
  font-weight:600;font-size:13.5px;font-family:inherit;cursor:pointer;line-height:1.3}
.btn:hover{background:var(--red-fill-hover)}
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
.row label,.form label,.editrow label{display:flex;flex-direction:column;gap:5px;font-size:var(--t6);letter-spacing:.08em;
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
.filters .exp{margin-left:auto}
table{width:100%;min-width:720px;border-collapse:collapse;font-size:13px;margin:0}
/* Statement tables (approved as "Vault B", 2026-08-08): an ink rule closes
   every header on this page — the broker's own book of record earns the same
   audited-statement vocabulary the report's comp table shipped. */
th{text-align:left;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
  font-weight:600;padding:12px 14px;border-bottom:2px solid var(--ink);white-space:nowrap;background:var(--card)}
th[data-k],th[data-bk]{cursor:pointer}
th[data-k]:hover,th[data-bk]:hover{color:var(--ink)}
th .ar{color:var(--red)}
td{padding:12px 14px;border-bottom:1px solid var(--hair);vertical-align:top;color:var(--ink-body)}
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
.tw{overflow-x:auto;border:1px solid var(--edge);border-radius:var(--r);background:var(--card);
  margin-top:var(--s4);box-shadow:var(--shadow)}
.msg{margin-top:var(--s4);padding:12px 16px;border-radius:var(--r);font-size:var(--t5);border:1px solid}
.msg.ok{background:var(--ok-bg);border-color:var(--ok-rule);color:var(--ok-text)}
.msg.bad{background:var(--err-bg);border-color:var(--err-rule);color:var(--err-text)}
#pdfTable tbody tr.need-fix td,#pdfTable tbody tr.need-fix:hover td{background:var(--err-bg)}
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
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--edge);border-radius:999px;
  padding:5px 8px 5px 12px;font-size:12.5px;background:var(--card);color:var(--ink-2);font-weight:600;
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
  font-family:inherit;font-size:16px;background:var(--card);color:var(--ink);width:100%;min-height:40px}
/* ---- The market rollup: the page's lead view ----------------------------
   A broker with 400 comps learns nothing from 400 rows. This is the index to
   their own book: one card per market + property type, which is the same pair
   their lead coverage is keyed on, so the two sections describe the world the
   same way. Whole-book always, never narrowed by the filter below it: it is
   the map, and a map that hides everything but your current street is not a
   map. Clicking one drives the filter instead. */
.cards{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.card{border:1px solid var(--edge);border-radius:var(--r);background:var(--card);padding:16px 18px;
  text-align:left;font-family:inherit;font-size:var(--t5);color:var(--ink);cursor:pointer;
  display:flex;flex-direction:column;gap:2px;transition:border-color .15s,background .15s,box-shadow .15s;
  box-shadow:var(--shadow)}
.card:hover{border-color:var(--ink-4);background:var(--card)}
.card.on{border-color:var(--red);background:var(--card);box-shadow:inset 0 0 0 1px var(--red),var(--shadow)}
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
  flex-direction:column;gap:4px;box-shadow:var(--shadow)}
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
  background:var(--card);box-shadow:var(--shadow)}
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
  box-shadow:var(--shadow)}
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
  padding:12px 18px;margin-top:var(--s4);box-shadow:var(--shadow)}
.dbox>summary{cursor:pointer;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;user-select:none;list-style-position:inside}
.dbox>summary:hover{color:var(--ink)}
.dbox[open]>summary{margin-bottom:var(--s4);color:var(--ink)}
footer{background:var(--slab);color:var(--ink-4);font-size:13px;padding:0;border:0;margin-top:auto}
footer .wrap{padding:36px var(--s6)}
footer .wordmark{color:#fff}
footer p{color:var(--ink-faint);margin:10px 0 0;max-width:62ch;line-height:1.6}
${ACCOUNT_NAV_CSS}
</style>
${THEME_BOOT}
</head><body>
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
        <p>or drop a .csv, .pdf or an image here &middot; <a href="/api/vault/template" id="tpl">download the template</a></p>
        <p class="fine">A PDF or screenshot is sent to our extract vendor to read the table. CompNinja does not store the file. Rows land in your vault only after you confirm.</p>
        <input type="file" id="file" accept=".csv,.pdf,.png,.jpg,.jpeg,.webp,text/csv,application/pdf,image/png,image/jpeg,image/webp" class="hide"/>
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

    <div id="pdfSec" class="mappanel hide">
      <h2>Review these comps</h2>
      <p class="sub" style="margin-top:0"><span id="pdfCount">0</span> deals in <span id="pdfName"></span>.
        Uncheck any that aren't yours. Fix a cell if we misread it. Nothing is saved until you import.</p>
      <p class="note" id="pdfStrip"></p>
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
    // Also the pipeline's market suggestions: a broker's next BOV is usually in
    // a market they already hold comps in, and this is where that list arrives.
    allMarkets=o.j.markets||[];
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
      return '<span class="chip">'+esc(c.market)+" \\u00b7 "+esc(c.property_type)+
        ' <button type="button" data-cov="'+escA(c.id)+'" aria-label="Stop watching '+label+'" title="Stop watching '+label+
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
          source:"lead",sourceLabel:"CompNinja lead",notes:"",
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

  function doImport(name, csv, mapping, onOk, rows){
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
    else { payload.csv=csv; if(mapping) payload.mapping=mapping; }
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
        $("res").innerHTML='<div class="msg '+(j.skipped?"bad":"ok")+'">'+esc(bits.join(" \\u00b7 "))+errList(j)+"</div>";
        load();
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

  function extractFile(file){
    setAddOpen(true);
    $("pick").disabled=true;
    $("res").innerHTML='<div class="msg ok">Reading the table in '+esc(file.name)+"&hellip;</div>";
    var fr=new FileReader();
    fr.onerror=function(){ $("pick").disabled=false; $("res").innerHTML='<div class="msg bad">Could not read that file.</div>'; };
    fr.onload=function(){
      var url=String(fr.result||"");
      var b64=url.indexOf(",")>=0?url.split(",")[1]:url;
      fetch("/api/vault/extract",{method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({filename:file.name,file:b64})})
        .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
        .then(function(o){
          $("pick").disabled=false;
          if(o.s!==200){
            $("res").innerHTML='<div class="msg bad">'+esc((o.j&&o.j.error)||"Could not read that file. Nothing was saved.")+"</div>";
            return;
          }
          $("res").innerHTML="";
          openPdfPreview(o.j);
        })
        .catch(function(){ $("pick").disabled=false;
          $("res").innerHTML='<div class="msg bad">Could not reach the server to read that file. Nothing was saved.</div>'; });
    };
    fr.readAsDataURL(file);
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
  var PDF_KEYS=["address","property_type","transaction","deal_date","price","size_sqft","cap_rate","tenancy","year_built","notes","lat","lng","clear_height","dock_doors","building_class","floor_plate","center_type","anchor_tenant","units","price_per_unit","lot_acres","price_per_acre","zoning","beds_baths"];
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
    $("pdfSec").classList.add("hide");
    $("addSec").classList.add("hide");
    // Hidden too, or an empty vault keeps the book invitation on screen
    // above the panel that replaced it. closeMapper puts it back.
    $("bookEmpty").classList.add("hide");
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
    doImport(p.name,p.csv,currentMapping(),closeMapper);
  });
  $("mapCancel").addEventListener("click",function(){
    closeMapper();
    $("res").innerHTML='<div class="msg ok">Cancelled. Nothing was saved.</div>';
  });

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

  function openPdfPreview(info){
    pdfPending=info||{filename:"",rows:[]};
    var rows=pdfPending.rows||[];
    rows.forEach(function(r){
      r.values=r.values||{};
      r.checked=r.error==null;
    });
    var cols=pdfColumns(rows);
    $("pdfCount").textContent=String(rows.length);
    $("pdfName").textContent=pdfPending.filename||"";
    $("pdfHead").innerHTML="<tr><th></th>"+cols.map(function(k){return "<th>"+esc(tLabel(k))+"</th>";}).join("")+"</tr>";
    $("pdfBody").innerHTML=rows.map(function(r,i){
      var tint=r.error!=null?' class="need-fix"':"";
      var cb='<input type="checkbox" data-i="'+i+'"'+(r.checked?" checked":"")+"/>";
      var cells=cols.map(function(k){
        return '<td><input type="text" data-i="'+i+'" data-k="'+escA(k)+'" value="'+escA(r.values[k]||"")+'"/></td>';
      }).join("");
      return "<tr"+tint+"><td>"+cb+"</td>"+cells+"</tr>";
    }).join("");
    var n=rows.length, ready=0, fail=0, allDate=true;
    rows.forEach(function(r){
      if(r.error==null)ready++;
      else { fail++; if(!/date/i.test(String(r.error)))allDate=false; }
    });
    var failBit=fail?(allDate?fail+" need a date":fail+" need a fix"):"";
    $("pdfStrip").textContent=n+" found \\u00b7 "+ready+" ready"+(failBit?" \\u00b7 "+failBit:"");
    $("pdfMsg").innerHTML="";
    $("pdfMsg").classList.add("hide");
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
        inp.addEventListener("input",function(){
          if(pdfPending.rows[i])pdfPending.rows[i].values[inp.getAttribute("data-k")]=inp.value;
        });
      }
    });
    refreshPdfGo();
    $("pdfSec").scrollIntoView({behavior:"smooth",block:"start"});
  }

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
    $("res").innerHTML='<div class="msg ok">Cancelled. Nothing was saved.</div>';
  });

  $("pick").addEventListener("click",function(){ $("file").click() });
  // Step 1's button is the same door as #pick — one file input on the whole
  // page, so an upload started here lands in the same handler and the same
  // result message.
  $("bookPick").addEventListener("click",function(){ $("file").click() });
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
        // 401/403 are not errors to report here: the whole page is already
        // gated, and a member who cannot see hubs sees the deck's empty state
        // rather than a refusal they can do nothing about.
        if(o.s!==200){hubs=[];renderHubs();return;}
        hubs=o.j.mine||[];renderHubs();
      })
      .catch(function(){hubs=[];renderHubs();});
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
    var head='<p class="note">Your hub is ready. Copy each link and send it to that '+
      'person yourself: CompNinja does not email them yet, and these links cannot be '+
      'shown again.</p>';
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

  loadHubs();

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
