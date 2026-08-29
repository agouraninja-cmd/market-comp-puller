// ---------------------------------------------------------------------------
// The 1031 identification worksheet — the whole /1031-exchange page.
//
// Spec: docs/superpowers/specs/2026-08-14-1031-identification-worksheet-design.md
// (amends the 2026-08-08 education-page spec; the explainer stays on this URL).
//
// A WEB PAGE, so it lives in its own file (the vault-page.js precedent);
// server.js only wires the route through marketShell and spreads these
// JSON-LD nodes into the shared brandGraph @graph. Pure: no requires, no
// I/O, no clock — a string in, a string out, which is what makes the
// compliance promises and the widget testable with no server.
//
// THE COMPLIANCE LINE THIS PAGE WALKS: a worksheet, never an exchange.
// Education, never advice. The owner is not a licensed broker, CompNinja is
// not a qualified intermediary, and nothing here may read as tax advice —
// the not-advice box is a feature, and test/guide-1031.test.js pins both
// what must appear and what must not. The widget computes calendar DATES
// only, deliberately: the moment it touches gains or taxes it stops being
// education. Sharing rides the URL fragment so a street address never lands
// in a server log.
// ---------------------------------------------------------------------------

const TITLE = "1031 Exchange Worksheet | CompNinja";
const DESCRIPTION =
  "List the building you are selling and up to three replacements. See the " +
  "45- and 180-day dates. CompNinja values each one. A worksheet, not an " +
  "exchange.";

const PROPERTY_TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];
const MAX_ADDRESS = 300;

// Small additions on top of MARKET_CSS (which styles h1/.sub/.card/.cta/
// .disc already). Tokens, not hex: this page sits in marketShell, which is
// themed, and hardcoded cream would sit as a light island in dark mode.
const GUIDE_CSS = `
.steps1031{list-style:none;margin:0;padding:0;counter-reset:s}
.steps1031 li{counter-increment:s;position:relative;padding:0 0 18px 44px}
.steps1031 li::before{content:counter(s);position:absolute;left:0;top:0;
  width:28px;height:28px;border-radius:50%;border:1px solid var(--edge);
  background:var(--wash);color:var(--ink-2);font-weight:600;font-size:13px;
  display:flex;align-items:center;justify-content:center}
ol.steps1031 h3{margin:0 0 4px;font-size:16px}
ol.steps1031 p{margin:0;color:var(--ink-2)}
details.faq{border-top:1px solid var(--line);padding:10px 0}
details.faq summary{cursor:pointer;font-weight:600}
details.faq p{color:var(--ink-2);margin:8px 0 0}
#q1031out{font-size:18px;font-weight:600;margin-top:10px}
#q1031out span{display:block;margin-top:4px}
#q1031ics{display:inline-block;margin-top:10px;font-size:13.5px;color:#4C5665;
  text-decoration:underline;text-decoration-color:#D8D4C9}
/* display:inline-block out-specifies the UA's [hidden] rule (the same trap
   ACCOUNT_NAV_CSS documents), so the hidden state needs its own line. */
#q1031ics[hidden]{display:none}
.ws label{display:block;font-weight:600;font-size:13px;color:var(--ink-2);margin:10px 0 4px}
.ws input[type=text],.ws input[type=date],.ws select{
  width:100%;max-width:36rem;padding:8px 10px;border:1px solid var(--edge);
  border-radius:4px;background:var(--card);color:var(--ink);font:inherit;font-size:16px}
.wsrow{display:grid;gap:10px;margin:0 0 16px;padding:12px 0;border-top:1px solid var(--hair)}
.wsrow:first-of-type{border-top:0;padding-top:0}
@media (min-width:640px){
  .wsrow{grid-template-columns:1fr 11rem auto;align-items:end}
  .wsrow .span2{grid-column:1 / -1}
}
.ws-actions{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-top:14px}
.ws-actions .alt{background:none;border:0;padding:0;font:inherit;font-size:13.5px;
  color:var(--ink-2);text-decoration:underline;cursor:pointer}
.ws-actions .alt:hover{color:var(--ink)}
#wsShareMsg{font-size:13px;color:var(--ink-2);margin:8px 0 0}
.wsh{font-size:15px;margin:18px 0 6px}
.wsh:first-child{margin-top:0}
@media print{
  .hdr,footer,.cta,.edu,details.faq,.ws-actions,.val{display:none!important}
  .card{break-inside:avoid}
}
`;

// One array, two surfaces: the visible accordions and the FAQPage JSON-LD
// are both rendered from this, so they cannot drift apart (the same rule
// /how-it-works's HOW_FAQ established). Plain text only — answers reach
// JSON-LD unescaped.
// ANSWERS MUST BE PLAIN TEXT ONLY — never HTML, and never the literal
// sequence </script>. `a` is embedded two ways: raw (unescaped) inside the
// faqPageNode() ld+json block, and escaped via escGuide() inside the visible
// <details><p> markup. HTML in `a` would render literally in the JSON-LD
// block instead of being interpreted, and a stray </script> would close the
// page's own <script> tag early no matter which surface it lands in.
const GUIDE_1031_FAQ = [
  {
    q: "What is a 1031 exchange?",
    a: "A section 1031 exchange (named for its section of the U.S. tax code) lets an owner defer capital-gains tax when selling investment or business real property, by reinvesting the proceeds into other like-kind real property under strict rules and deadlines. The tax is deferred, not forgiven — the gain carries into the replacement property.",
  },
  {
    q: "Does my property qualify?",
    a: "Real property held for investment or productive use in a trade or business generally qualifies — an industrial building, an office, a retail center, land. A primary residence does not, and since the 2018 tax-law changes, personal property (equipment, vehicles, franchises) no longer qualifies at all.",
  },
  {
    q: "What is a qualified intermediary, and why before closing?",
    a: "A qualified intermediary (QI) is an independent party who holds the sale proceeds between your sale and your purchase. If you receive the proceeds yourself — even for a day — the exchange generally fails and the gain becomes taxable. The QI must be engaged before your sale closes; there is no fixing it afterward.",
  },
  {
    q: "Is this page the written identification I give my QI?",
    a: "No. This page is a worksheet so you can line up the buildings and the dates. The written identification has to be a signed list delivered to your qualified intermediary by day 45. CompNinja does not send anything to a QI, and this worksheet is not that list.",
  },
  {
    q: "What happens if I miss the 45-day or 180-day deadline?",
    a: "The exchange fails and the deferred gain generally becomes taxable. Both deadlines are counted in calendar days from the closing of your sale, and they are not extended for weekends or holidays. The 180-day period can also end earlier if your tax-return due date arrives first and you do not extend.",
  },
  {
    q: "What is boot?",
    a: "Any non-like-kind value you receive in the exchange — leftover cash, or debt on the old property that is not replaced on the new one. Boot does not sink the exchange, but it is taxable up to your gain. Trading down in price or equity usually creates boot.",
  },
  {
    q: "Do I have to reinvest everything?",
    a: "To defer the full gain, the replacement property generally needs to be of equal or greater value and you need to reinvest all the equity. Reinvesting less still works as a partial exchange, with the difference taxed as boot.",
  },
  {
    q: "Where does the exchange get reported?",
    a: "On IRS Form 8824, filed with the federal return for the year of the sale. Your tax preparer handles the mechanics; what they need from you is the timeline, the QI paperwork, and the closing statements from both legs.",
  },
  {
    q: "How do I choose a qualified intermediary?",
    a: "Verify five things before your sale closes: your funds will sit in a segregated qualified escrow or trust account in your name, never commingled; a fidelity bond and errors-and-omissions insurance are in force, with certificates you can see; the QI is registered in states that regulate exchange facilitators, if yours does; they are independent of you (not your own agent, attorney, or accountant from the last two years); and the fees are in writing, including who keeps the interest earned on your money while they hold it. Your closing attorney, title officer, and CPA all see intermediaries' work firsthand and can point you to established ones.",
  },
  {
    q: "How much does a qualified intermediary cost?",
    a: "A straightforward delayed exchange typically runs from several hundred dollars to around $1,500 in stated fees, and many intermediaries also keep some or all of the interest earned on your escrowed funds while they hold them — ask about both numbers and get them in writing. Reverse and improvement exchanges are specialist work and cost several times more.",
  },
  {
    q: "Can my own attorney or CPA act as my qualified intermediary?",
    a: "Generally not: the rules disqualify anyone who has been your employee, attorney, accountant, investment banker, or real estate agent within the two years before your sale. The intermediary has to be independent — your attorney and CPA still advise you alongside them, which is exactly the arrangement you want.",
  },
];

function escGuide(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function cleanAddr(s) {
  s = String(s == null ? "" : s).replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (s.length > MAX_ADDRESS) s = s.slice(0, MAX_ADDRESS);
  return s;
}

function cleanType(s) {
  s = String(s == null ? "" : s);
  for (let i = 0; i < PROPERTY_TYPES.length; i++) {
    if (PROPERTY_TYPES[i] === s) return s;
  }
  return "";
}

function cleanClose(s) {
  s = String(s == null ? "" : s).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function emptyReps() {
  return [{ a: "", t: "" }, { a: "", t: "" }, { a: "", t: "" }];
}

function normalizePacket(p) {
  p = p && typeof p === "object" ? p : {};
  const repsIn = Array.isArray(p.r) ? p.r : [];
  const r = emptyReps();
  for (let i = 0; i < 3; i++) {
    const row = repsIn[i] && typeof repsIn[i] === "object" ? repsIn[i] : {};
    r[i] = { a: cleanAddr(row.a), t: cleanType(row.t) };
  }
  return {
    v: 1,
    s: cleanAddr(p.s),
    st: cleanType(p.st),
    c: cleanClose(p.c),
    r,
  };
}

function packetIsEmpty(p) {
  p = normalizePacket(p);
  if (p.s || p.st || p.c) return false;
  for (let i = 0; i < 3; i++) {
    if (p.r[i].a || p.r[i].t) return false;
  }
  return true;
}

function serializePacket(p) {
  const json = JSON.stringify(normalizePacket(p));
  return Buffer.from(json, "utf8").toString("base64url");
}

function parsePacket(raw) {
  try {
    const json = Buffer.from(String(raw || ""), "base64url").toString("utf8");
    const obj = JSON.parse(json);
    if (!obj || obj.v !== 1) return null;
    return normalizePacket(obj);
  } catch (err) {
    return null;
  }
}

function typeSelect(id, label) {
  const opts = ['<option value="">Type (optional)</option>']
    .concat(PROPERTY_TYPES.map((t) => `<option value="${t}">${t}</option>`))
    .join("");
  return `<label for="${id}">${escGuide(label)}</label>` +
    `<select id="${id}">${opts}</select>`;
}

// The worksheet script. Calendar-day arithmetic only, done in local time
// from the typed Y-M-D so timezones can never shift a date. Month names are
// spelled here (not toLocaleDateString) so tests and visitors see the same
// string on every OS locale.
//
// VALUE_DEST is interpolated once. A signed-in render must not contain the
// signup door (marketShell's signed-in chrome rule). The address never rides
// that dest — only type, which is not a street.
//
// This script is scanned for "$" / "gain" / "basis" / "tax rate". Do not put
// those strings in comments either. No template literals inside the returned
// source: they would interpolate against widgetJs's scope, or fail the money
// pin.
function widgetJs(signedIn) {
  const dest = signedIn ? "/" : "/?auth=signup";
  return `(function(){
  // Reading this guide is the one signal the app has that a later BOV request
  // is 1031-driven; index.html reads this marker at lead submit and tags the
  // lead's source. A timestamp, not a flag, so the signal can expire. Guarded:
  // no localStorage (the Node test harness, a locked-down browser) = no marker,
  // and the widget still works.
  try{localStorage.setItem("cnRef1031.v1",String(Date.now()))}catch(e){}
  var VALUE_DEST = ${JSON.stringify(dest)};
  var TYPES = ["Industrial","Office","Retail","Multifamily","Land","Residential"];
  var MAX_A = 300;
  var STORE = "cn1031.v1";
  var MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function el(id){ return document.getElementById(id); }
  function cleanAddr(s){
    s = String(s == null ? "" : s).replace(/[\\u0000-\\u001F\\u007F]/g, "").trim();
    if (s.length > MAX_A) s = s.slice(0, MAX_A);
    return s;
  }
  function cleanType(s){
    s = String(s == null ? "" : s);
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i] === s) return s;
    return "";
  }
  function cleanClose(s){
    s = String(s == null ? "" : s).trim();
    return s.length === 10 && s.charAt(4) === "-" && s.charAt(7) === "-" ? s : "";
  }
  function emptyReps(){ return [{a:"",t:""},{a:"",t:""},{a:"",t:""}]; }
  function normalize(p){
    p = p && typeof p === "object" ? p : {};
    var repsIn = Array.isArray(p.r) ? p.r : [];
    var r = emptyReps();
    for (var i = 0; i < 3; i++) {
      var row = repsIn[i] && typeof repsIn[i] === "object" ? repsIn[i] : {};
      r[i] = { a: cleanAddr(row.a), t: cleanType(row.t) };
    }
    return { v: 1, s: cleanAddr(p.s), st: cleanType(p.st), c: cleanClose(p.c), r: r };
  }
  function isEmpty(p){
    p = normalize(p);
    if (p.s || p.st || p.c) return false;
    for (var i = 0; i < 3; i++) if (p.r[i].a || p.r[i].t) return false;
    return true;
  }
  function b64urlEncode(str){
    var b64 = btoa(unescape(encodeURIComponent(str)));
    b64 = b64.replace(/\\+/g, "-").replace(/\\//g, "_");
    while (b64.length && b64.charAt(b64.length - 1) === "=") b64 = b64.slice(0, -1);
    return b64;
  }
  function b64urlDecode(s){
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    try { return decodeURIComponent(escape(atob(s))); }
    catch (err) { return ""; }
  }
  function serialize(p){ return b64urlEncode(JSON.stringify(normalize(p))); }
  function parse(raw){
    try {
      var obj = JSON.parse(b64urlDecode(raw));
      if (!obj || obj.v !== 1) return null;
      return normalize(obj);
    } catch (err) { return null; }
  }
  function readForm(){
    return normalize({
      s: el("wsSell") && el("wsSell").value,
      st: el("wsSellType") && el("wsSellType").value,
      c: el("q1031close") && el("q1031close").value,
      r: [0,1,2].map(function(i){
        return { a: el("wsR"+i) && el("wsR"+i).value, t: el("wsT"+i) && el("wsT"+i).value };
      })
    });
  }
  function fillForm(p){
    p = normalize(p);
    if (el("wsSell")) el("wsSell").value = p.s;
    if (el("wsSellType")) el("wsSellType").value = p.st;
    if (el("q1031close")) el("q1031close").value = p.c;
    for (var i = 0; i < 3; i++) {
      if (el("wsR"+i)) el("wsR"+i).value = p.r[i].a;
      if (el("wsT"+i)) el("wsT"+i).value = p.r[i].t;
    }
    renderDates();
  }
  function hashPacket(){
    var m = /(?:^|#|&)p=([A-Za-z0-9_-]+)/.exec(location.hash || "");
    return m ? m[1] : "";
  }
  function syncHash(){
    var p = readForm();
    var next = isEmpty(p) ? "" : "#p=" + serialize(p);
    var path = (location.pathname || "/1031-exchange") + (location.search || "");
    try { history.replaceState(null, "", path + next); }
    catch (err) { location.hash = next ? next.slice(1) : ""; }
    try {
      if (isEmpty(p)) localStorage.removeItem(STORE);
      else localStorage.setItem(STORE, JSON.stringify(p));
    } catch (err2) {}
  }
  function fmt(d){
    return DAYS[d.getDay()]+", "+MONTHS[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear();
  }
  function pad2(n){ return (n<10?"0":"")+n; }
  function icsDate(d){ return ""+d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate()); }
  // All-day VEVENTs (VALUE=DATE), so no timezone can shift a deadline. The
  // DTSTAMP is derived from the closing date rather than the clock — the file
  // is deterministic for a given closing, which is also what the test pins.
  function icsEvent(d,dayN,summary){
    var next=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1);
    return ["BEGIN:VEVENT",
      "UID:1031-day"+dayN+"-"+icsDate(d)+"@compninja.co",
      "DTSTAMP:"+icsDate(d)+"T000000Z",
      "DTSTART;VALUE=DATE:"+icsDate(d),
      "DTEND;VALUE=DATE:"+icsDate(next),
      "SUMMARY:"+summary,
      "DESCRIPTION:Counted in calendar days from your closing. No extensions assumed. Confirm your dates with your tax advisor.",
      "END:VEVENT"];
  }
  function renderDates(){
    var input = el("q1031close");
    var out = el("q1031out");
    var ics = el("q1031ics");
    if (!input || !out) return;
    var raw = String(input.value || "");
    if (raw.length !== 10){ out.innerHTML = ""; if (ics) ics.hidden = true; return; }
    var m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(raw);
    if (!m){ out.innerHTML = ""; if (ics) ics.hidden = true; return; }
    var y = +m[1], mo = +m[2] - 1, day = +m[3];
    var d45 = new Date(y, mo, day + 45), d180 = new Date(y, mo, day + 180);
    out.innerHTML = "<span>Day 45 \\u2014 identify in writing by: "+fmt(d45)+"</span>"+
      "<span>Day 180 \\u2014 close your replacement by: "+fmt(d180)+"</span>";
    if (ics) {
      var cal=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//CompNinja//1031 deadlines//EN"]
        .concat(icsEvent(d45,45,"1031 exchange \\u2014 day 45: identify replacements in writing"))
        .concat(icsEvent(d180,180,"1031 exchange \\u2014 day 180: close on the replacement"))
        .concat(["END:VCALENDAR"]).join("\\r\\n");
      ics.href="data:text/calendar;charset=utf-8,"+encodeURIComponent(cal);
      ics.hidden=false;
    }
  }
  function goValue(addr, type){
    addr = cleanAddr(addr);
    if (!addr) return;
    try { sessionStorage.setItem("pendingLandingAddress.v1", addr); } catch (err) {}
    var dest = VALUE_DEST;
    type = cleanType(type);
    if (type) dest += (dest.indexOf("?") >= 0 ? "&" : "?") + "type=" + encodeURIComponent(type);
    location.href = dest;
  }
  function onValue(which){
    if (which === "sell") goValue(el("wsSell") && el("wsSell").value, el("wsSellType") && el("wsSellType").value);
    else if (which.charAt(0) === "r") {
      var i = which.slice(1);
      goValue(el("wsR"+i) && el("wsR"+i).value, el("wsT"+i) && el("wsT"+i).value);
    }
  }
  function copyLink(){
    syncHash();
    var url = location.href;
    var msg = el("wsShareMsg");
    function ok(){ if (msg) msg.textContent = "Link copied. Anyone with it can open this worksheet."; }
    function fallback(){ if (msg) msg.textContent = url; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        var p = navigator.clipboard.writeText(url);
        if (p && p.then) p.then(ok, fallback); else ok();
      } catch (err) { fallback(); }
    } else fallback();
  }

  var hashed = hashPacket();
  var packed = hashed ? parse(hashed) : null;
  if (packed) fillForm(packed);
  else {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE) || "null");
      if (saved) fillForm(saved);
    } catch (err) {}
    renderDates();
  }

  ["wsSell","wsSellType","q1031close","wsR0","wsT0","wsR1","wsT1","wsR2","wsT2"].forEach(function(id){
    var node = el(id);
    if (!node) return;
    node.addEventListener("input", function(){ renderDates(); syncHash(); });
    node.addEventListener("change", function(){ renderDates(); syncHash(); });
  });
  function bindVal(id, which){
    var node = el(id);
    if (node) node.addEventListener("click", function(){ onValue(which); });
  }
  bindVal("wsSellVal", "sell");
  bindVal("wsV0", "r0");
  bindVal("wsV1", "r1");
  bindVal("wsV2", "r2");
  var copyBtn = el("wsCopy");
  if (copyBtn) copyBtn.addEventListener("click", copyLink);
  var printBtn = el("wsPrint");
  if (printBtn) printBtn.addEventListener("click", function(){ window.print(); });
})();`;
}

function renderGuide1031Body(signedIn) {
  signedIn = !!signedIn;
  const steps = [
    ["Know what the building is worth before you list",
     'A defensible asking price starts the whole timeline on the right foot. Use the worksheet above, then <a href="/">run a free valuation</a> — an automated estimate built from real comparable sales, not an appraisal.'],
    ["Engage a qualified intermediary before closing",
     "The QI holds your sale proceeds. Touch the money yourself and the exchange generally fails — this is the step that cannot be fixed after the fact."],
    ["Close the sale — the clock starts",
     "Both deadlines below count calendar days from this closing date. Weekends and holidays do not extend them."],
    ["Identify replacements in writing within 45 days",
     "A signed, unambiguous list of candidate properties delivered to your QI. The worksheet on this page is not that list. The identification rules below limit how many and how much."],
    ["Close on the replacement within 180 days",
     "The purchase of the identified property must complete within 180 days of your sale (or by your tax-return due date, if that comes first and you do not extend)."],
    ["Report it on your return",
     "The exchange is reported on IRS Form 8824 for the year of the sale. Keep the QI agreement and both closing statements together for your tax preparer."],
  ];

  const faq = GUIDE_1031_FAQ.map((f) =>
    `<details class="faq"><summary>${escGuide(f.q)}</summary><p>${escGuide(f.a)}</p></details>`).join("");

  const repRows = [0, 1, 2].map((i) =>
    `<div class="wsrow">` +
    `<div><label for="wsR${i}">Replacement ${i + 1}</label>` +
    `<input id="wsR${i}" type="text" maxlength="${MAX_ADDRESS}" autocomplete="street-address" placeholder="Address"/></div>` +
    `<div>${typeSelect("wsT" + i, "Type")}</div>` +
    `<div><button type="button" class="btn val" id="wsV${i}">Value this building</button></div>` +
    `</div>`
  ).join("");

  return (
    `<h1>Identify replacements before day 45</h1>` +
    `<p class="sub">A worksheet, not an exchange. List the building you are selling and up to three ` +
    `replacements. CompNinja values each one. A qualified intermediary has to receive the written list ` +
    `by day 45 &mdash; this page is not that list.</p>` +

    `<div class="card ws" id="worksheet"><h2>1031 identification worksheet</h2>` +
    `<p>Addresses stay in your browser until you choose to value one. Copying the link puts the worksheet ` +
    `in the page address after the #, which is not sent to our servers.</p>` +

    `<h3 class="wsh">What you are selling</h3>` +
    `<div class="wsrow">` +
    `<div><label for="wsSell">Relinquished property</label>` +
    `<input id="wsSell" type="text" maxlength="${MAX_ADDRESS}" autocomplete="street-address" placeholder="Address of the building you are selling"/></div>` +
    `<div>${typeSelect("wsSellType", "Type")}</div>` +
    `<div><button type="button" class="btn val" id="wsSellVal">Value this building</button></div>` +
    `</div>` +

    `<h3 class="wsh">When the clock starts</h3>` +
    `<div class="datebox" id="deadlines">` +
    `<label for="q1031close">Sale closing date</label>` +
    `<input type="date" id="q1031close"/>` +
    // aria-live: the computed 45/180-day dates replace this div's content on
    // every input change, and without a live region a screen-reader user who
    // just typed a closing date hears nothing back.
    `<div id="q1031out" aria-live="polite"></div>` +
    // A data: URI the widget fills in — the deadlines leave as an .ics file
    // without the date ever touching a server. Hidden until a valid date is
    // typed: a download link over nothing is a control that does nothing.
    `<a id="q1031ics" download="1031-deadlines.ics" hidden>Add both deadlines to your calendar (.ics)</a>` +
    `<p class="disc">Calendar days, no extensions assumed. The 180-day period can end ` +
    `sooner if your tax-return due date arrives first and you do not file an extension &mdash; ` +
    `confirm your dates with your tax advisor.</p></div>` +

    `<h3 class="wsh">Up to three replacements</h3>` +
    `<p>Most exchanges identify three properties of any value. You type the addresses; CompNinja does not pick them.</p>` +
    repRows +

    `<div class="ws-actions">` +
    `<button type="button" class="alt" id="wsCopy">Copy link to this worksheet</button>` +
    `<button type="button" class="alt" id="wsPrint">Print</button>` +
    `</div>` +
    `<p id="wsShareMsg"></p>` +
    `<p class="disc">This is not a written identification and not a 1031 exchange. Deliver the signed ` +
    `list to your qualified intermediary. CompNinja does not send it for you.</p>` +
    `</div>` +

    `<div class="edu">` +
    `<div class="card"><h2>What a 1031 exchange is</h2>` +
    `<p>When you sell investment or business real property and reinvest the proceeds in ` +
    `other like-kind real property, section 1031 of the tax code lets the capital-gains ` +
    `tax be deferred rather than paid now. Like-kind is broad for real estate &mdash; an ` +
    `industrial building for a retail center is fine. Since the 2017 tax law took effect, ` +
    `only <strong>real property</strong> qualifies. The tax is deferred, not erased: the ` +
    `gain rolls into the new property's basis.</p></div>` +

    `<div class="card"><h2>The workflow, in order</h2><ol class="steps1031">` +
    steps.map(([h, p]) => `<li><h3>${h}</h3><p>${p}</p></li>`).join("") +
    `</ol></div>` +

    `<div class="card"><h2>The identification rules</h2>` +
    `<p>Within the 45 days you may identify, in writing:</p><ul>` +
    `<li><strong>Up to three properties</strong> of any value (the three-property rule) &mdash; the route most exchanges take; or</li>` +
    `<li><strong>Any number of properties</strong> whose combined value stays within 200% of what you sold (the 200% rule); or</li>` +
    `<li><strong>More than that</strong> only if you actually acquire 95% of the value you identified (the 95% rule &mdash; rarely used on purpose).</li>` +
    `</ul></div>` +

    `<div class="card"><h2>Common ways exchanges fail</h2><ul>` +
    `<li><strong>Touching the proceeds.</strong> The money must go from closing to the qualified intermediary, never through your account.</li>` +
    `<li><strong>Missing the written identification.</strong> Day 45 needs a signed list delivered to the QI, not an intention.</li>` +
    `<li><strong>Boot.</strong> Leftover cash, or debt you do not replace, is taxable even when the exchange otherwise succeeds.</li>` +
    `<li><strong>Specialist variations.</strong> Reverse exchanges (buy first) and improvement exchanges exist, but they need specialist QIs and more structure &mdash; get advice early.</li>` +
    `</ul></div>` +
    `</div>` +

    // The referral stance, made useful: CompNinja is not a QI and holds no
    // funds (the disc below says so; the tests pin it), so what this page CAN
    // give an owner is the vetting list — the industry is lightly regulated
    // and the QI failures that made case law lost clients their money AND
    // their deferral. Education throughout: what to verify, never who to hire.
    `<div class="card" id="choosing-qi"><h2>Choosing a qualified intermediary</h2>` +
    `<p>The QI is the one professional every delayed exchange must have, and the ` +
    `industry is lightly regulated — your sale proceeds sit with whoever you pick. ` +
    `CompNinja is not a qualified intermediary and does not hold funds. Before your ` +
    `sale closes, verify these about anyone who will:</p><ul>` +
    `<li><strong>How your money is held.</strong> A segregated qualified escrow or ` +
    `qualified trust account in your name — never commingled with the QI's operating ` +
    `funds — ideally requiring your signature to move money.</li>` +
    `<li><strong>Insurance and bonding.</strong> A fidelity bond and ` +
    `errors-and-omissions coverage in force, with certificates you can see. Several ` +
    `states (California, Washington, Nevada, Idaho, Colorado, Oregon, Maine, ` +
    `Virginia) regulate exchange facilitators — if yours does, confirm the ` +
    `registration too.</li>` +
    `<li><strong>Independence.</strong> Someone who has been your agent, attorney, ` +
    `accountant, or employee within the last two years generally cannot serve as ` +
    `your QI — a disqualification in the rules themselves, not a preference.</li>` +
    `<li><strong>Track record.</strong> Years in business, exchange volume, ` +
    `references, and membership in the Federation of Exchange Accommodators (the ` +
    `industry body behind the Certified Exchange Specialist designation).</li>` +
    `<li><strong>Fees in writing.</strong> Including who keeps the interest earned ` +
    `on your escrowed funds while they hold them — often the larger number.</li>` +
    `</ul>` +
    `<p>Where to find one: your closing attorney, title or escrow officer, and CPA ` +
    `all see intermediaries' work firsthand. And when CompNinja connects you with a ` +
    `local broker for an opinion of value, ask them which intermediaries their ` +
    `clients use in your market — brokers watch these deals close.</p></div>` +

    `<h2 id="faq" style="margin-top:32px">Questions owners actually ask</h2>` + faq +

    `<div class="cta"><h2>Selling? Start with the number.</h2>` +
    `<p>See what your building is worth before you list &mdash; a free automated estimate from ` +
    `real comparable sales. When you are ready, CompNinja can connect you with a local ` +
    `broker for a Broker Opinion of Value.</p>` +
    `<a class="btn" href="/">Value my building</a>` +
    `<p style="margin:0"><a class="alt" href="/brokers">Are you a broker? Send this worksheet to a client &rarr;</a></p></div>` +

    `<p class="disc">This page is educational only. It is not tax, legal, or investment ` +
    `advice, and CompNinja is not a brokerage, a qualified intermediary, or a tax advisor. ` +
    `Rules have exceptions and change; before acting, confirm your situation with a ` +
    `qualified intermediary and your tax advisor. Every CompNinja valuation is an ` +
    `automated estimate, not an appraisal.</p>` +

    `<script>${widgetJs(signedIn)}</script>`
  );
}

// JSON-LD nodes for the page @graph. They REFERENCE the site's canonical
// Organization/WebSite by @id — the ids brandGraph() declares — and never
// restate them (the standing brand-entity rule in CLAUDE.md).
function webPageNode(siteUrl) {
  return {
    "@type": "WebPage",
    name: "1031 Exchange Worksheet",
    description: DESCRIPTION,
    url: `${siteUrl}/1031-exchange`,
    isPartOf: { "@id": `${siteUrl}/#website` },
    publisher: { "@id": `${siteUrl}/#organization` },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "CompNinja", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "1031 Exchange Worksheet", item: `${siteUrl}/1031-exchange` },
      ],
    },
  };
}

function faqPageNode(siteUrl) {
  return {
    "@type": "FAQPage",
    "@id": `${siteUrl}/1031-exchange#faq`,
    mainEntity: GUIDE_1031_FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

module.exports = {
  TITLE, DESCRIPTION, GUIDE_CSS, GUIDE_1031_FAQ, PROPERTY_TYPES, MAX_ADDRESS,
  cleanAddr, cleanType, normalizePacket, serializePacket, parsePacket, packetIsEmpty,
  renderGuide1031Body, webPageNode, faqPageNode,
};
