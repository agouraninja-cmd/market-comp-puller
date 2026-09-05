// ---------------------------------------------------------------------------
// The bulk valuation workspace — the whole /bulk screen, AND the run view that
// index.html shows inline when somebody pastes a list into the main search.
//
// Pure, like vault-page.js and guide-1031.js: it takes a boot payload and
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
// It renders a BODY, not a document: server.js dresses it in marketShell(), so
// the header, footer, theme boot and account chrome are the site's shared ones
// rather than a second copy. That is the /brokers and /1031-exchange pattern.
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
.bk-run .deck{margin:0 0 28px}
.bk-run .deckrule{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
  border-bottom:1px solid var(--ink,#1A2433);padding-bottom:6px;margin:0 0 14px}
.bk-run .deckrule h2{font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:400;margin:0;letter-spacing:.01em;
  color:var(--ink,#1A2433)}
.bk-run .msg{font-size:13px;margin:12px 0 0;color:var(--ink,#1A2433)}
.bk-run .msg.bad{color:var(--red-deep,#991B1B)}
.bk-run .notes{margin:12px 0 0;padding:10px 12px;border:1px solid var(--line,#E4E2DA);border-radius:6px;
  font-size:12.5px;color:var(--ink,#1A2433)}
.bk-run .notes ul{margin:6px 0 0;padding-left:18px}
.bk-run .acts{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:14px}
.bk-run button.lnk,.bk-run a.lnk{background:none;border:0;padding:0;font:inherit;font-size:13px;
  color:var(--red,#B91C1C);cursor:pointer;text-decoration:underline}
.bk-run .strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;
  background:var(--line,#E4E2DA);border:1px solid var(--line,#E4E2DA);border-radius:6px;overflow:hidden;margin:0 0 16px}
.bk-run .strip div{background:var(--paper,#FBFBF9);padding:10px 12px}
.bk-run .strip .k{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink,#1A2433)}
.bk-run .strip .v{font-size:17px;font-variant-numeric:tabular-nums;color:var(--ink,#1A2433)}
.bk-run table{width:100%;border-collapse:collapse;font-size:13px;color:var(--ink,#1A2433)}
.bk-run th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink,#1A2433);
  font-weight:500;padding:6px 8px;border-bottom:1px solid var(--ink,#1A2433)}
.bk-run td{padding:7px 8px;border-bottom:1px solid var(--line,#E4E2DA);vertical-align:top}
.bk-run td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.bk-run td a{color:var(--red,#B91C1C)}
.bk-run .chip{display:inline-block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;
  padding:1px 7px;border:1px solid var(--line,#E4E2DA);border-radius:99px;color:var(--ink,#1A2433)}
.bk-run .chip.run{border-color:var(--red,#B91C1C);color:var(--red,#B91C1C)}
.bk-run .chip.bad{border-color:var(--red-deep,#991B1B);color:var(--red-deep,#991B1B)}
/* A finished row earns the site's green (the ok-* tokens, theme.js), so a
   table of done rows reads as done at a glance rather than as a column of
   identical grey pills. */
.bk-run .chip.ok{border-color:var(--ok-rule,#BFE5D2);background:var(--ok-bg,#E7F5EE);color:var(--ok-text,#06603A)}
.bk-run .strip .v{font-family:Georgia,'Times New Roman',serif;font-weight:500;letter-spacing:-.02em;font-size:22px}
.bk-run .sub{color:var(--ink,#1A2433);font-size:11.5px}
/* Earlier runs is a ledger (2026-09-04 evening): a table with the same
   headers as the rows table above it, not a list of links. */
.bk-run .runs td a{font-weight:500}
.bk-run .hide{display:none}
/* The size cell is an input rather than a button-then-field, because a bulk
   run's usual gap IS the size and one click should not stand between a member
   and fixing it. Borderless until focus so a table of them still reads as a
   table. */
.bk-run input.szin{width:88px;padding:2px 4px;font:inherit;font-size:13px;text-align:right;
  color:var(--ink,#1A2433);background:transparent;border:1px solid transparent;border-radius:4px;
  font-variant-numeric:tabular-nums}
.bk-run input.szin:hover{border-color:var(--line,#E4E2DA)}
.bk-run input.szin:focus{border-color:var(--red,#B91C1C);background:var(--paper,#FBFBF9);outline:none}
.bk-run input.szin::placeholder{color:var(--red,#B91C1C);opacity:1}
.bk-run input.szin[disabled]{color:var(--ink,#1A2433)}
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
.bulk .lede{color:var(--ink);font-size:14px;line-height:1.55;margin:6px 0 0;max-width:62ch}
.bulk .top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap}
.bulk .top h1{margin:0}
/* The two-cell strip. Serif figures, like every headline number on the site. */
.bulk .cap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--edge);
  border-radius:6px;background:var(--card);overflow:hidden;width:300px;flex:0 0 300px;
  box-shadow:0 1px 2px rgba(15,23,42,.04)}
.bulk .cap div{padding:12px 16px}
.bulk .cap div+div{border-left:1px solid var(--hair)}
.bulk .cap .k{display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink);font-weight:600;margin-bottom:4px}
.bulk .cap .v{display:block;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:22px;
  line-height:1.15;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink)}
/* The chamber. */
.bulk .desk{margin-top:28px;border:1px solid var(--edge);border-radius:6px;background:var(--card);
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -18px rgba(15,23,42,.25);display:flex;flex-direction:column}
.bulk .dhead{padding:11px 16px;border-bottom:1px solid var(--hair);display:flex;align-items:center;
  justify-content:space-between;gap:16px}
.bulk .dlab{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink);font-weight:600;line-height:1.5}
.bulk .count{font-size:12.5px;color:var(--ink)}
.bulk .addr{padding:14px 16px 12px;display:flex;flex-direction:column;gap:6px}
.bulk label{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink);font-weight:600;margin:0 0 2px}
.bulk label .opt{font-weight:400;letter-spacing:0;text-transform:none}
/* Borderless fields: the card's hairlines draw the cells, so a box inside a
   box would be two borders for one input. */
.bulk textarea,.bulk input[type=text],.bulk select{width:100%;box-sizing:border-box;padding:2px 0;
  font:inherit;font-size:14px;color:var(--ink);background:transparent;border:0;outline:0}
.bulk textarea{min-height:132px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:14px;line-height:1.7;padding:0}
.bulk .links{display:flex;align-items:center;gap:18px;font-size:13px;flex-wrap:wrap}
.bulk .row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--hair)}
.bulk .cell{padding:11px 16px;border-right:1px solid var(--hair)}
.bulk .cell:last-child{border-right:0}
.bulk .cell:focus-within{box-shadow:inset 0 0 0 2px var(--red)}
.bulk .go-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;
  border-top:1px solid var(--hair);background:var(--wash);border-radius:0 0 6px 6px}
.bulk button.go{flex:0 0 auto;background:var(--red);color:#fff;border:0;border-radius:6px;padding:12px 22px;
  font:inherit;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px -6px rgba(185,28,28,.55)}
/* Never dimmed (owner's call, 2026-09-04): "no parts of the bulk valuation
   dim". The button is solid red in every state; when it cannot run, the cost
   line beside it says why, and an empty box answers a click with a message
   (see run()) rather than with a control that looks switched off. The same
   call is why every muted colour in this file is full ink. */
.bulk button.go[disabled]{cursor:default}
.bulk .cost{color:var(--ink);font-size:13px;line-height:1.5;margin:0}
.bulk .foot{margin-top:28px;padding-top:12px;border-top:1px solid var(--line);
  color:var(--ink);font-size:12.5px;line-height:1.6;max-width:72ch}
/* The Tab hint's key cap. Inline in the button so the shortcut is named where
   the action is, rather than in a legend somebody has to go and find. */
.bulk .kbd{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:10.5px;line-height:1.5;padding:0 5px;margin-left:4px;border:1px solid var(--line);
  border-radius:4px;color:var(--ink);text-decoration:none;vertical-align:1px}
@media (max-width:760px){
  .bulk .row{grid-template-columns:1fr}
  .bulk .cell{border-right:0;border-bottom:1px solid var(--hair)}
  .bulk .cell:last-child{border-bottom:0}
  .bulk .cap{width:100%;flex-basis:100%}
}
`;

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
    <div class="strip" id="bkTotals"></div>
    <p class="acts">
      <button type="button" class="lnk hide" id="bkCancel">Cancel the rest</button>
      <a class="lnk" id="bkDl" href="#" style="display:none">Download CSV</a>
      <a class="lnk" href="/desk">Open your workspace</a>${past ? "" : `
      <a class="lnk" href="/bulk">Earlier runs &rarr;</a>`}
    </p>
    <div style="overflow-x:auto"><table id="bkRows"></table></div>
  </div>${past ? `

  <div class="deck hide" id="bkPastDeck">
    <div class="deckrule"><h2>Earlier runs</h2></div>
    <div style="overflow-x:auto"><table class="runs"><thead><tr><th>Run</th><th>Type &middot; lookback</th>
      <th class="n">Addresses</th><th>Status</th><th class="n"></th></tr></thead>
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
    <div class="deckrule"><h2>Bulk valuation</h2></div>
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
        <p class="lede">One address opens its comp report. A list becomes a portfolio, every row
          linking to the report behind its number.</p>
      </div>
      <!-- Two cells, not three (owner's call): "runs on file" was a weak number
           to give that much weight. Both figures are written by renderCap(). -->
      <div class="cap" aria-label="Your allowance">
        <div><span class="k">Left today</span><span class="v" id="capLeft">&mdash;</span></div>
        <div><span class="k">Per run</span><span class="v" id="capPer">&mdash;</span></div>
      </div>
    </div>

    <div class="desk">
      <div class="dhead">
        <span class="dlab">Value one property, or a list</span>
        <span class="count" id="count"></span>
      </div>
      <div class="addr">
        <label for="bulkText">Address, or one per line</label>
        <textarea id="bulkText" spellcheck="false" placeholder="1201 W Idaho St, Boise, ID 83702
4610 E Fairview Ave, Meridian, ID 83642
900 N Cole Rd, Boise, ID"></textarea>
        <p class="links" style="margin:0">
          <input type="file" id="bulkFile" accept=".csv,.txt,text/csv,text/plain" class="hide"/>
          <button type="button" class="lnk" id="pickFile">Upload a CSV or text file</button>
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
          <label for="bulkNote">Focus <span class="opt">(optional)</span></label>
          <input type="text" id="bulkNote" maxlength="200" placeholder="e.g. within 2.5 miles"/>
        </div>
        <div class="cell">
          <label for="bulkLabel">Name this run <span class="opt">(optional)</span></label>
          <input type="text" id="bulkLabel" maxlength="120" placeholder="e.g. Q3 portfolio review"/>
        </div>
      </div>

      <!-- The cost said beside the button, BEFORE the click. -->
      <div class="go-row">
        <p class="cost" id="cost">Each address is its own billed search; nothing runs until you press the button.</p>
        <button type="button" class="go" id="run">Run valuations</button>
      </div>
    </div>

    ${renderBulkRunMarkup({ past: true })}

    <p class="foot">Every figure here is an automated estimate produced from comparable sales,
      not an appraisal, and each one carries the same caveats as the report behind it — open a
      row to see its comps and how the range was reached. Addresses with no
      priced sale comps in the window are reported as such rather than valued at zero.
      <!-- The one door left to the single-property form (owner's, 2026-09-04
           evening). A bulk row has no column for an NOI, a cap rate, a
           sales-only or leases-only focus or the per-type subject details,
           and those inputs still live on the real #compForm at /run-report —
           which index.html serves at that path and nothing else links. -->
      Need an NOI, a cap rate, a sales-only or leases-only focus, or the property-detail fields?
      <a href="/run-report">Use the single-property form</a>.</p>
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
var onState=null,onList=null;

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
// told "42 addresses" and then handed 40 rows. It is the same rule the parser
// enforces, restated cheaply: blank lines and '#' notes do not count, and a
// line with no digit in it is not an address.
//
// Shared with index.html's paste detector on purpose: two copies of this
// heuristic would let the homepage and /bulk disagree about what a list is.
function countLines(text){
  var lines=String(text||"").split(/\\r\\n|\\r|\\n/),seen={},n=0;
  var first=lines.length?lines[0].toLowerCase():"";
  var header=first.indexOf("address")>=0&&first.indexOf(",")>=0;
  for(var i=header?1:0;i<lines.length;i++){
    var raw=lines[i].trim();
    if(!raw||raw.charAt(0)==="#")continue;
    var addr=header?raw.split(",")[0].trim():raw;
    if(addr.length<6||!/\\d/.test(addr))continue;
    var k=addr.toLowerCase().replace(/[^a-z0-9]+/g,"");
    if(seen[k])continue;
    seen[k]=1;n++;
  }
  return n;
}

// The first address a paste holds, for the branch that cannot run a list and
// falls back to a single search rather than throwing the paste away.
function firstAddress(text){
  var lines=String(text||"").split(/\\r\\n|\\r|\\n/);
  var first=lines.length?lines[0].toLowerCase():"";
  var header=first.indexOf("address")>=0&&first.indexOf(",")>=0;
  for(var i=header?1:0;i<lines.length;i++){
    var raw=lines[i].trim();
    if(!raw||raw.charAt(0)==="#")continue;
    var addr=header?raw.split(",")[0].trim():raw;
    if(addr.length<6||!/\\d/.test(addr))continue;
    return addr;
  }
  return "";
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
  var val=it.status==="done"&&Number(it.value_likely)>0
    ? money(it.value_likely)+'<div class="sub">'+money(it.value_low)+" \\u2013 "+money(it.value_high)+"</div>"
    : '<span class="sub">\\u2014</span>';
  var note=it.error?'<div class="sub">'+esc(it.error)+"</div>":"";
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
  var sz;
  if(it.status!=="done"){
    sz="\\u2014";
  }else{
    var szv=Number(it.size_sqft)>0?String(Math.round(it.size_sqft)):"";
    sz='<input class="szin" type="text" inputmode="numeric" data-id="'+esc(it.id)+'"'+
       ' value="'+esc(szv)+'" placeholder="add size" aria-label="Building size in square feet for '+esc(it.address)+'"/>'+
       (szv?'<div class="sub">'+esc(it.size_source||"you")+"</div>":"");
  }
  // Sale comps, not the comp count: the band comes from the sales, and a
  // lease-heavy report showing "10" would imply ten deals behind the number.
  var comps=Number(it.sale_comps)>0
    ? String(it.sale_comps)+(it.trimmed?"":'<div class="sub">wide band</div>') : "\\u2014";
  return "<tr><td class=\\"n\\">"+(i+1)+"</td>"+
    "<td>"+addr+lbl+note+"</td>"+
    "<td class=\\"n\\">"+val+"</td>"+
    "<td class=\\"n\\">"+psf(it.psf_mid)+"</td>"+
    "<td class=\\"n\\">"+sz+"</td>"+
    "<td class=\\"n\\">"+comps+"</td>"+
    "<td>"+statusChip(it.status)+(it.cached?' <span class="sub">cached</span>':"")+"</td></tr>";
}

function renderJob(){
  if(!job){$("bkJobDeck").className="deck hide";return;}
  $("bkJobDeck").className="deck";
  $("bkJobTitle").textContent=job.label||"This run";
  $("bkJobMeta").innerHTML=esc(job.property_type)+" \\u00b7 "+esc(String(job.months))+"-month lookback \\u00b7 "+
    statusChip(job.status)+' <span class="sub">'+job.done_count+" of "+job.total+" done</span>";
  renderTotals(summary||{total:items.length,valued:0,failed:0,low:0,likely:0,high:0});
  $("bkRows").innerHTML="<thead><tr><th></th><th>Address</th><th>Likely value</th><th>$/SF</th>"+
    "<th>Size</th><th>Sale comps</th><th>Status</th></tr></thead><tbody>"+
    items.map(rowHtml).join("")+"</tbody>";
  $("bkCancel").className=job.status==="running"?"lnk":"lnk hide";
  bindSizeInputs();
  renderPast();
  // The page's own copy — /bulk's button and cap line, or the homepage's.
  // Guarded rather than called directly: this module must not know that a
  // form exists, because on index.html one does not.
  if(onState)onState(job,items);
  var dl=$("bkDl");
  dl.href="/api/bulk/export.csv?id="+encodeURIComponent(job.id);
  dl.style.display=job.done_count>0?"":"none";
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
  // A ledger row per run: name and date, type and lookback, the address
  // count, the status chip, and its CSV. No portfolio value here — the list
  // read carries no totals, and a figure would mean one more query per run
  // on every page load; clicking the run shows it in the strip above.
  $("bkPast").innerHTML=rest.map(function(j){
    var done=j.status==="done"||(j.status!=="running"&&j.done_count>=j.total&&j.total>0);
    return "<tr><td>"+'<a href="#" data-job="'+esc(j.id)+'">'+esc(j.label||j.property_type+" run")+"</a>"+
      '<div class="sub">'+esc(String(j.created_at||"").slice(0,10))+"</div></td>"+
      "<td>"+esc(j.property_type)+" \\u00b7 "+esc(String(j.months))+" months</td>"+
      '<td class="n">'+j.total+"</td>"+
      "<td>"+statusChip(j.status)+(j.status!=="running"&&j.done_count<j.total
        ?' <span class="sub">'+(j.total-j.done_count)+" not valued</span>":"")+"</td>"+
      '<td class="n">'+(done||j.done_count>0
        ?'<a href="/api/bulk/export.csv?id='+encodeURIComponent(j.id)+'">CSV</a>':"")+"</td></tr>";}).join("");
  Array.prototype.forEach.call($("bkPast").querySelectorAll("a[data-job]"),function(a){
    a.addEventListener("click",function(e){e.preventDefault();poll(a.getAttribute("data-job"),true);});});
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
    renderJob();
    if(force&&onList)onList();
    if(job&&job.status==="running")timer=setTimeout(function(){poll(id);},4000);
    else if(onList)onList();
  }).catch(function(e){msg(e.message,true);});
}

// Stop polling without clearing what is drawn. index.html calls this when a
// single-address report takes the viewport, so a hidden run view does not go
// on requesting every four seconds for the life of the tab.
function stop(){if(timer){clearTimeout(timer);timer=null;}}

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
  renderJob();
}

function init(opts){
  opts=opts||{};
  onState=opts.onState||null;
  onList=opts.onList||null;
  if(opts.max)MAX=opts.max;
  var c=$("bkCancel");
  if(c)c.addEventListener("click",function(){
    if(!job)return;
    // Says what a cancel actually does. Searches already in flight are billed
    // the moment they start, so promising to stop them would be a lie.
    if(!confirm("Stop the addresses that have not started yet? Searches already running will finish."))return;
    api("POST","/api/bulk/cancel",{id:job.id}).then(function(){poll(job.id,true);}).catch(function(){});
  });
}

return {init:init,showRun:showRun,poll:poll,stop:stop,setJobs:setJobs,
  countLines:countLines,firstAddress:firstAddress,showNotes:showNotes,msg:msg,api:api,
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
// The id of a ONE-address run started from this page load, or null. When it
// finishes with a report, the page opens that report instead of leaving a
// one-row table on screen (owner's, 2026-09-04: this page is the comp-report
// tool). Scoped to runs THIS page started: an earlier single run re-opened
// from the list below is being looked at as a row, not re-run, so it stays.
var singleJob=null;

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

function refreshCount(){
  parsedCount=Math.min(BULKRUN.countLines($("bulkText").value),MAX);
  $("count").textContent=parsedCount?parsedCount+" address"+(parsedCount===1?"":"es")+" ready":"";
  // The offer applies to an empty box only, so it leaves once there is
  // anything to lose — a control that would overwrite nothing is noise, and
  // one that WOULD overwrite something should not be a stray keystroke.
  var ex=$("useExample");
  if(ex)ex.className=$("bulkText").value===""?"lnk":"lnk hide";
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
  $("cost").textContent=busy
    ? "A run is going below. Wait for it to finish, or cancel it first."
    : overCap
    ? (LEFT===0
        ? "You have valued "+DAILY+" addresses today — the daily limit. It resets at midnight UTC."
        : "Only "+LEFT+" left today (the daily limit is "+DAILY+"). Trim the list, or come back after midnight UTC.")
    : parsedCount===1
    ? "About a minute; the comp report opens when it finishes. An address searched before is served from cache and opens at once."
    : parsedCount
    ? "Roughly "+Math.max(1,Math.round(parsedCount*0.9))+"\\u2013"+Math.ceil(parsedCount*1.1)+
      " min. Addresses searched before come from cache and finish at once. Each address is its own billed search."
    : "Each address is its own billed search; nothing runs until you press the button.";
}

// BULKRUN's onState hook: the cap copy above, plus the single-address rule.
// A finished one-address run started here opens its report (the row's own
// ?recent= door, user-scoped like every other read of it); a failed one
// stays as a row with its reason, because a redirect to nothing would hide
// the one line that says what went wrong.
function onRunState(job,items){
  refreshCount();
  if(!singleJob||!job||job.id!==singleJob||job.status==="running")return;
  singleJob=null;
  var it=items&&items[0];
  var id=it&&it.status==="done"&&it.recent_item_id;
  if(!id)return;
  BULKRUN.msg("Valued. Opening the report\\u2026",false);
  location.href="/?recent="+encodeURIComponent(id);
}

// The two-cell strip: the daily allowance and the per-run cap, as figures.
// A dash until the numbers are known rather than a zero that reads as "none
// left" — the boot payload carries them, so the dash is rarely seen.
function renderCap(){
  $("capLeft").textContent=LEFT===null?"\\u2014":String(LEFT);
  $("capPer").textContent=String(MAX);
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

function loadList(){
  return BULKRUN.api("GET","/api/bulk").then(function(d){
    if(d.maxAddresses){MAX=d.maxAddresses;BULKRUN.setMax(MAX);}
    if(typeof d.leftToday==="number"){LEFT=d.leftToday;DAILY=d.dailyLimit;}
    if(d.types&&d.types.length&&!TYPES.length){TYPES=d.types;fillTypes();}
    renderCap();
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

function run(){
  if(parsedCount===0){
    BULKRUN.msg("Type or paste at least one address first.",true);
    $("bulkText").focus();
    return;
  }
  var btn=$("run");btn.disabled=true;
  BULKRUN.msg("Starting\\u2026",false);
  BULKRUN.api("POST","/api/bulk",{
    text:$("bulkText").value,type:$("bulkType").value,
    months:Number($("bulkMonths").value),note:$("bulkNote").value,label:$("bulkLabel").value
  }).then(function(d){
    var one=Boolean(d.job&&d.job.total===1);
    singleJob=one?d.job.id:null;
    BULKRUN.msg(one
      ? "Running. The comp report opens here when it finishes; if you leave, the row below keeps its link."
      : "Running. You can close this tab \\u2014 the valuations keep going and land on your workspace.",false);
    BULKRUN.showNotes(d);
    BULKRUN.showRun(d);BULKRUN.poll(d.job.id);
  }).catch(function(e){
    BULKRUN.msg(e.message,true);
    // A refusal carries the fresh number, so the hint above corrects itself
    // rather than going on claiming an allowance the server just denied.
    if(e.data&&typeof e.data.left_today==="number"){
      LEFT=e.data.left_today;DAILY=e.data.daily_limit;renderCap();}
    if(e.data)BULKRUN.showNotes(e.data);
    if(e.data&&e.data.job)BULKRUN.poll(e.data.job.id);
  }).then(function(){refreshCount();});
}

function fillTypes(){
  $("bulkType").innerHTML=TYPES.map(function(t){
    return '<option value="'+esc(t)+'">'+esc(t)+"</option>";}).join("");
}

function gate(msg,actionHtml){
  $("gate").hidden=false;$("app").hidden=true;
  $("gateMsg").textContent=msg;
  $("gateAct").innerHTML=actionHtml||"";
}

function start(boot){
  if(!boot||boot.s===401)
    return gate("Sign in to run a bulk valuation.",'<a class="lnk" href="/?auth=signin">Sign in</a>');
  if(boot.s===403)
    return gate((boot.j&&boot.j.error)||"Bulk valuation is part of Pro.",
      '<a class="lnk" href="/?pricing=1">See Pro</a>');
  if(boot.s!==200)
    return gate((boot.j&&boot.j.error)||"Bulk valuation is unavailable right now.","");
  $("gate").hidden=true;$("app").hidden=false;
  var d=boot.j||{};
  if(d.maxAddresses)MAX=d.maxAddresses;
  if(typeof d.leftToday==="number"){LEFT=d.leftToday;DAILY=d.dailyLimit;}
  TYPES=d.types||[];fillTypes();
  renderCap();
  BULKRUN.init({max:MAX,onState:onRunState,onList:loadList});
  BULKRUN.setJobs(d.jobs||[]);
  var live=(d.jobs||[]).filter(function(j){return j.status==="running";})[0];
  if(live)BULKRUN.poll(live.id);

  $("bulkText").addEventListener("input",refreshCount);
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
    fr.onload=function(){$("bulkText").value=String(fr.result||"");refreshCount();};
    fr.onerror=function(){BULKRUN.msg("That file could not be read.",true);};
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
