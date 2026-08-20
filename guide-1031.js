// ---------------------------------------------------------------------------
// The 1031 exchange guide — the whole /1031-exchange page's content.
//
// Spec: docs/superpowers/specs/2026-08-08-1031-guide-design.md
//
// A WEB PAGE, so it lives in its own file (the vault-page.js precedent);
// server.js only wires the route through marketShell and spreads these
// JSON-LD nodes into the shared brandGraph @graph. Pure: no requires, no
// I/O, no clock — a string in, a string out, which is what makes the
// compliance promises and the widget testable with no server.
//
// THE COMPLIANCE LINE THIS PAGE WALKS: education, never advice. The owner is
// not a licensed broker, CompNinja is not a qualified intermediary, and
// nothing here may read as tax advice — the not-advice box is a feature,
// and test/guide-1031.test.js pins both what must appear and what must not.
// The widget computes calendar DATES only, deliberately: the moment it
// touches gains or taxes it stops being education.
// ---------------------------------------------------------------------------

const TITLE = "1031 Exchange Basics | CompNinja";
const DESCRIPTION =
  "The 1031 exchange workflow in plain English: the 45-day and 180-day " +
  "deadlines, identification rules, common pitfalls, and what to line up " +
  "before you sell.";

// Small additions on top of MARKET_CSS (which styles h1/.sub/.card/.cta/
// .disc already). Only what this page needs: the numbered steps, the FAQ
// accordions, and the widget's output line.
const GUIDE_CSS = `
.steps1031{list-style:none;margin:0;padding:0;counter-reset:s}
.steps1031 li{counter-increment:s;position:relative;padding:0 0 18px 44px}
.steps1031 li::before{content:counter(s);position:absolute;left:0;top:0;
  width:28px;height:28px;border-radius:50%;border:1px solid #D8D4C9;
  background:#F5F4EF;color:#4C5665;font-weight:600;font-size:13px;
  display:flex;align-items:center;justify-content:center}
ol.steps1031 h3{margin:0 0 4px;font-size:16px}
ol.steps1031 p{margin:0;color:#4C5665}
details.faq{border-top:1px solid #E4E2DA;padding:10px 0}
details.faq summary{cursor:pointer;font-weight:600}
details.faq p{color:#4C5665;margin:8px 0 0}
#q1031out{font-size:18px;font-weight:600;margin-top:10px}
#q1031out span{display:block;margin-top:4px}
#q1031ics{display:inline-block;margin-top:10px;font-size:13.5px;color:#4C5665;
  text-decoration:underline;text-decoration-color:#D8D4C9}
/* display:inline-block out-specifies the UA's [hidden] rule (the same trap
   ACCOUNT_NAV_CSS documents), so the hidden state needs its own line. */
#q1031ics[hidden]{display:none}
.datebox label{font-weight:600}
.datebox input{padding:6px 8px;border:1px solid #D8D4C9;border-radius:4px;
  font-family:inherit;font-size:16px;margin-left:8px}
/* 16px: smaller inputs make iOS Safari zoom on focus and stay zoomed. */
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
];

function escGuide(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// The deadline widget's script. Calendar-day arithmetic only, done in local
// time from the typed Y-M-D so timezones can never shift a date. Month names
// are spelled here (not toLocaleDateString) so tests and visitors see the
// same string on every OS locale.
const WIDGET_JS = `(function(){
  // Reading this guide is the one signal the app has that a later BOV request
  // is 1031-driven; index.html reads this marker at lead submit and tags the
  // lead's source. A timestamp, not a flag, so the signal can expire. Guarded:
  // no localStorage (the Node test harness, a locked-down browser) = no marker,
  // and the widget still works.
  try{localStorage.setItem("cnRef1031.v1",String(Date.now()))}catch(e){}
  var MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var input=document.getElementById("q1031close");
  var out=document.getElementById("q1031out");
  var ics=document.getElementById("q1031ics");
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
  function update(){
    var raw=String(input.value||"");
    if(raw.length!==10){ out.innerHTML=""; ics.hidden=true; return; }
    var m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(raw);
    if(!m){ out.innerHTML=""; ics.hidden=true; return; }
    var y=+m[1], mo=+m[2]-1, day=+m[3];
    var d45=new Date(y,mo,day+45), d180=new Date(y,mo,day+180);
    out.innerHTML="<span>Day 45 \\u2014 identify in writing by: "+fmt(d45)+"</span>"+
      "<span>Day 180 \\u2014 close your replacement by: "+fmt(d180)+"</span>";
    var cal=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//CompNinja//1031 deadlines//EN"]
      .concat(icsEvent(d45,45,"1031 exchange \\u2014 day 45: identify replacements in writing"))
      .concat(icsEvent(d180,180,"1031 exchange \\u2014 day 180: close on the replacement"))
      .concat(["END:VCALENDAR"]).join("\\r\\n");
    ics.href="data:text/calendar;charset=utf-8,"+encodeURIComponent(cal);
    ics.hidden=false;
  }
  input.addEventListener("input",update);
})();`;

function renderGuide1031Body() {
  const steps = [
    ["Know what the building is worth before you list",
     'A defensible asking price starts the whole timeline on the right foot. <a href="/">Run a free valuation</a> — an automated estimate built from real comparable sales, not an appraisal.'],
    ["Engage a qualified intermediary before closing",
     "The QI holds your sale proceeds. Touch the money yourself and the exchange generally fails — this is the step that cannot be fixed after the fact."],
    ["Close the sale — the clock starts",
     "Both deadlines below count calendar days from this closing date. Weekends and holidays do not extend them."],
    ["Identify replacements in writing within 45 days",
     "A signed, unambiguous list of candidate properties delivered to your QI. The identification rules below limit how many and how much."],
    ["Close on the replacement within 180 days",
     "The purchase of the identified property must complete within 180 days of your sale (or by your tax-return due date, if that comes first and you do not extend)."],
    ["Report it on your return",
     "The exchange is reported on IRS Form 8824 for the year of the sale. Keep the QI agreement and both closing statements together for your tax preparer."],
  ];

  const faq = GUIDE_1031_FAQ.map((f) =>
    `<details class="faq"><summary>${escGuide(f.q)}</summary><p>${escGuide(f.a)}</p></details>`).join("");

  return (
    `<h1>The 1031 exchange, in plain English</h1>` +
    `<p class="sub">Selling an investment property and buying another? A section 1031 ` +
    `exchange can defer the capital-gains tax — if the strict deadlines and rules are ` +
    `followed to the letter. Here is the workflow, what each deadline means, and the ` +
    `mistakes that end exchanges.</p>` +

    `<div class="card"><h2>What a 1031 exchange is</h2>` +
    `<p>When you sell investment or business real property and reinvest the proceeds in ` +
    `other like-kind real property, section 1031 of the tax code lets the capital-gains ` +
    `tax be deferred rather than paid now. Like-kind is broad for real estate — an ` +
    `industrial building for a retail center is fine. Since the 2017 tax law took effect, ` +
    `only <strong>real property</strong> qualifies. The tax is deferred, not erased: the ` +
    `gain rolls into the new property's basis.</p></div>` +

    `<div class="card"><h2>The workflow, in order</h2><ol class="steps1031">` +
    steps.map(([h, p]) => `<li><h3>${h}</h3><p>${p}</p></li>`).join("") +
    `</ol></div>` +

    `<div class="card datebox" id="deadlines"><h2>Your 45- and 180-day dates</h2>` +
    `<p>Enter your sale's closing date to see the two deadlines. This runs entirely in ` +
    `your browser — the date is not sent anywhere, and the calendar file below is ` +
    `built in your browser too.</p>` +
    `<label for="q1031close">Closing date</label> <input type="date" id="q1031close"/>` +
    // aria-live: the computed 45/180-day dates replace this div's content on
    // every input change, and without a live region a screen-reader user who
    // just typed a closing date hears nothing back.
    `<div id="q1031out" aria-live="polite"></div>` +
    // A data: URI the widget fills in — the deadlines leave as an .ics file
    // without the date ever touching a server. Hidden until a valid date is
    // typed: a download link over nothing is a control that does nothing.
    `<a id="q1031ics" download="1031-deadlines.ics" hidden>Add both deadlines to your calendar (.ics)</a>` +
    `<p class="disc">Calendar days, no extensions assumed. The 180-day period can end ` +
    `sooner if your tax-return due date arrives first and you do not file an extension — ` +
    `confirm your dates with your tax advisor.</p></div>` +

    `<div class="card"><h2>The identification rules</h2>` +
    `<p>Within the 45 days you may identify, in writing:</p><ul>` +
    `<li><strong>Up to three properties</strong> of any value (the three-property rule) — the route most exchanges take; or</li>` +
    `<li><strong>Any number of properties</strong> whose combined value stays within 200% of what you sold (the 200% rule); or</li>` +
    `<li><strong>More than that</strong> only if you actually acquire 95% of the value you identified (the 95% rule — rarely used on purpose).</li>` +
    `</ul></div>` +

    `<div class="card"><h2>Common ways exchanges fail</h2><ul>` +
    `<li><strong>Touching the proceeds.</strong> The money must go from closing to the qualified intermediary, never through your account.</li>` +
    `<li><strong>Missing the written identification.</strong> Day 45 needs a signed list delivered to the QI, not an intention.</li>` +
    `<li><strong>Boot.</strong> Leftover cash, or debt you do not replace, is taxable even when the exchange otherwise succeeds.</li>` +
    `<li><strong>Specialist variations.</strong> Reverse exchanges (buy first) and improvement exchanges exist, but they need specialist QIs and more structure — get advice early.</li>` +
    `</ul></div>` +

    `<h2 id="faq" style="margin-top:32px">Questions owners actually ask</h2>` + faq +

    `<div class="cta"><h2>Selling? Start with the number.</h2>` +
    `<p>See what your building is worth before you list — a free automated estimate from ` +
    `real comparable sales. When you are ready, CompNinja can connect you with a local ` +
    `broker for a Broker Opinion of Value.</p>` +
    `<a class="btn" href="/">Value my building</a>` +
    `<p style="margin:0"><a class="alt" href="/brokers">Are you a broker? Send this page to a client &rarr;</a></p></div>` +

    `<p class="disc">This page is educational only. It is not tax, legal, or investment ` +
    `advice, and CompNinja is not a brokerage, a qualified intermediary, or a tax advisor. ` +
    `Rules have exceptions and change; before acting, confirm your situation with a ` +
    `qualified intermediary and your tax advisor. Every CompNinja valuation is an ` +
    `automated estimate, not an appraisal.</p>` +

    `<script>${WIDGET_JS}</script>`
  );
}

// JSON-LD nodes for the page @graph. They REFERENCE the site's canonical
// Organization/WebSite by @id — the ids brandGraph() declares — and never
// restate them (the standing brand-entity rule in CLAUDE.md).
function webPageNode(siteUrl) {
  return {
    "@type": "WebPage",
    name: "1031 Exchange Basics",
    description: DESCRIPTION,
    url: `${siteUrl}/1031-exchange`,
    isPartOf: { "@id": `${siteUrl}/#website` },
    publisher: { "@id": `${siteUrl}/#organization` },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "CompNinja", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "1031 Exchange Basics", item: `${siteUrl}/1031-exchange` },
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
  TITLE, DESCRIPTION, GUIDE_CSS, GUIDE_1031_FAQ,
  renderGuide1031Body, webPageNode, faqPageNode,
};
