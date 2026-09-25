/* Draft A — "Welcome desk".
 * The same page, warmed up: a greeting instead of the word "Workspace", a
 * set-up checklist that stands in for the empty top row and ticks itself off
 * from real data, and empty sections drawn as an icon, a line and one button
 * rather than a grey paragraph. Layout, sections and order are unchanged.
 */
(function () {
  var D = window.DRAFT;
  var CSS = [
    /* header */
    ".dA-kick{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);font-weight:600;margin-bottom:5px}",
    ".dA-kick b{color:var(--red);font-weight:600}",
    "#deskView .dk-title{font-size:30px}",
    /* setup card */
    ".dA-setup{grid-column:1/-1;border:1px solid var(--edge);border-radius:10px;background:var(--card);box-shadow:var(--lift);overflow:hidden}",
    ".dk-top.dA-solo{grid-template-columns:minmax(0,1fr)}",
    ".dk-top.dA-solo .dk-strip{grid-template-columns:repeat(4,minmax(0,1fr))}",
    ".dk-top.dA-solo .dk-scell{border-top:0!important;border-left:1px solid var(--hair)!important}",
    ".dk-top.dA-solo .dk-scell:first-child{border-left:0!important}",
    ".dA-setup-h{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:18px 20px 14px;border-bottom:1px solid var(--hair);background:var(--wash)}",
    ".dA-setup-t{margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:20px;color:var(--ink);letter-spacing:-.01em}",
    ".dA-setup-s{margin:4px 0 0;font-size:13px;color:var(--ink-2)}",
    ".dA-prog{min-width:150px;text-align:right}",
    ".dA-prog-n{font-size:12px;color:var(--ink-3);font-weight:600}",
    ".dA-bar{height:6px;border-radius:99px;background:var(--hair);margin-top:6px;overflow:hidden}",
    ".dA-bar>i{display:block;height:100%;background:var(--red-fill);border-radius:99px}",
    ".dA-steps{display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr))}",
    ".dA-step{position:relative;display:flex;flex-direction:column;gap:6px;padding:16px 18px 18px;border-left:1px solid var(--hair);text-decoration:none;color:inherit;background:none;border-top:0;border-right:0;border-bottom:0;font:inherit;text-align:left;cursor:pointer}",
    ".dA-step:first-child{border-left:0}",
    ".dA-step:hover{background:var(--wash)}",
    ".dA-num{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:1.5px solid var(--edge);color:var(--ink-2);font-family:Georgia,'Times New Roman',serif;font-size:14px;margin-bottom:4px}",
    ".dA-step.done .dA-num{background:var(--ok-bg);border-color:var(--ok-rule);color:var(--ok-text)}",
    ".dA-step-t{font-size:14px;font-weight:600;color:var(--ink)}",
    ".dA-step.done .dA-step-t{color:var(--ink-3);text-decoration:line-through;text-decoration-color:var(--ink-4)}",
    ".dA-step-x{font-size:12.5px;line-height:1.5;color:var(--ink-3)}",
    ".dA-go{margin-top:auto;padding-top:6px;font-size:12.5px;font-weight:600;color:var(--red)}",
    ".dA-step.done .dA-go{color:var(--ok-text)}",
    /* strip: zeros step back so the page does not shout nothing */
    ".dk-sfig.dA-zero{color:var(--ink-4)}",
    ".dk-slab{display:flex;align-items:center;gap:6px}",
    ".dk-slab svg{color:var(--ink-3)}",
    /* designed empty states */
    ".dA-empty{display:flex;align-items:center;gap:14px;margin-top:12px;padding:14px 16px;border:1px dashed var(--edge);border-radius:10px;background:var(--card)}",
    ".dk-side .dA-empty{margin:10px 0 2px;padding:12px;border:0;background:var(--wash)}",
    ".dA-ico{flex:0 0 40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--wash);color:var(--ink-2)}",
    ".dk-side .dA-ico{background:var(--card);flex-basis:36px;height:36px}",
    ".dA-txt{flex:1 1 auto;min-width:0}",
    ".dA-et{display:block;font-family:Georgia,'Times New Roman',serif;font-size:15.5px;color:var(--ink)}",
    ".dA-ex{display:block;font-size:12.5px;line-height:1.5;color:var(--ink-3);margin-top:2px}",
    ".dA-btn{flex:0 0 auto;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink);background:var(--card);border:1px solid var(--edge);border-radius:7px;padding:7px 12px;cursor:pointer;text-decoration:none;white-space:nowrap}",
    ".dA-btn:hover{border-color:var(--ink-3)}",
    ".dA-btn.red{background:var(--red-fill);border-color:var(--red-fill);color:#fff}",
    ".dk-side .dA-empty .dA-btn{display:none}",
    "@media (max-width:900px){.dA-steps{grid-template-columns:minmax(0,1fr)}.dA-step{border-left:0;border-top:1px solid var(--hair);flex-direction:row;flex-wrap:wrap;align-items:center}.dA-step:first-child{border-top:0}.dA-step .dA-step-x{flex-basis:100%}.dA-go{margin:0 0 0 auto}}",
    "@media (max-width:640px){.dA-setup-h{flex-wrap:wrap}.dA-prog{flex:1 1 100%;min-width:0;text-align:left}.dA-empty{flex-wrap:wrap}.dA-txt{flex:1 1 0}.dA-empty>.dA-btn{margin-left:54px}}",
  ].join("\n");

  function click(id) { return function () { var b = document.getElementById(id); if (b) b.click(); }; }

  function stepsFor(d) {
    if (d.firm) {
      return {
        title: "Get " + d.firm.name + " set up",
        sub: "Four things make this page useful. Each one ticks itself off.",
        steps: [
          { t: "Put a building on the board", x: "The buildings your office works on, with their leases and dates.", go: "Add a building", done: d.buildings.length > 0, act: click("buildingAddToggle") },
          { t: "Share a report with the firm", x: "Run a comp report, then Share → My firm. It lands on everyone's shelf.", go: "Run a comp report", done: d.shelf.length > 0, href: "/bulk" },
          { t: "Invite a colleague", x: "They see the board and the shelf; each of you keeps your own vault.", go: "Invite by email", done: d.members.length > 1, act: click("menuFirmBtn") },
          { t: "Add your contacts", x: "Type them in or bring a spreadsheet — Excel or CSV.", go: "Add or import", done: d.contacts.length > 0, act: click("contactAddToggle") },
        ],
      };
    }
    if (d.isPro) {
      return {
        title: "Start here", sub: "Three places to begin.",
        steps: [
          { t: "Run a comp report", x: "One address or fifty. About a minute each.", go: "Open Comp report", href: "/bulk" },
          { t: "Bring in your comps", x: "Your own deals, private to you, in your Vault.", go: "Open your Vault", href: "/vault" },
          { t: "Start a firm", x: "A shared board, shelf and contact list for your office.", go: "Create a firm", act: click("deskFirmEmptyBtn") },
        ],
      };
    }
    return {
      title: "Start here", sub: "Your account is ready. Three places to begin.",
      steps: [
        { t: "Explore a market", x: "Median $/SF, cap rates and recent comps for a city and property type.", go: "Open Market explorer", href: "/markets" },
        { t: "Watch new permits", x: "Commercial building permits filed in Boise and Meridian, as they post.", go: "Open Permit tracker", href: "/permits" },
        { t: "Bring your office in", x: "A firm shares one board of buildings, a shelf and a contact list. Part of Pro.", go: "How a firm works", act: click("deskFirmEmptyBtn") },
      ],
    };
  }

  function setupCard(d) {
    var s = stepsFor(d);
    var tracked = s.steps.some(function (x) { return x.done !== undefined; });
    var done = s.steps.filter(function (x) { return x.done; }).length;
    if (tracked && done === s.steps.length) return null;
    var card = D.el("section", { class: "dA-setup", "aria-label": "Get set up" });
    card.innerHTML =
      '<div class="dA-setup-h"><div><h3 class="dA-setup-t">' + D.esc(s.title) + '</h3><p class="dA-setup-s">' + D.esc(s.sub) + "</p></div>" +
      (tracked ? '<div class="dA-prog"><span class="dA-prog-n">' + done + " of " + s.steps.length + ' done</span><div class="dA-bar"><i style="width:' + Math.round(done / s.steps.length * 100) + '%"></i></div></div>' : "") +
      "</div>";
    var grid = D.el("div", { class: "dA-steps", style: "--n:" + s.steps.length });
    s.steps.forEach(function (st, i) {
      var a = D.el(st.href ? "a" : "button", st.href ? { href: st.href, class: "dA-step" + (st.done ? " done" : "") } : { type: "button", class: "dA-step" + (st.done ? " done" : "") });
      a.innerHTML = '<span class="dA-num">' + (st.done ? D.icon("check", 15) : i + 1) + '</span><span class="dA-step-t">' + D.esc(st.t) + '</span><span class="dA-step-x">' + D.esc(st.x) + '</span><span class="dA-go">' + (st.done ? "Done" : D.esc(st.go) + " →") + "</span>";
      if (st.act && !st.done) a.addEventListener("click", st.act);
      grid.appendChild(a);
    });
    card.appendChild(grid);
    return card;
  }

  function emptyState(pId, ico, title, text, btn) {
    var p = document.getElementById(pId);
    if (!p || p.classList.contains("hidden")) return;
    var box = D.el("div", { class: "dA-empty" });
    box.innerHTML = '<span class="dA-ico">' + D.icon(ico, 19) + '</span><span class="dA-txt"><span class="dA-et">' + D.esc(title) + '</span><span class="dA-ex">' + D.esc(text) + "</span></span>";
    if (btn) {
      var b = D.el(btn.href ? "a" : "button", btn.href ? { href: btn.href, class: "dA-btn" + (btn.red ? " red" : "") } : { type: "button", class: "dA-btn" + (btn.red ? " red" : "") }, D.esc(btn.label));
      if (btn.act) b.addEventListener("click", btn.act);
      box.appendChild(b);
    }
    p.classList.add("hidden");
    p.parentNode.insertBefore(box, p.nextSibling);
  }

  document.addEventListener("DOMContentLoaded", function () { D.addStyle(CSS); });
  D.whenDesk(function (d) {
    // Header: the day and the firm over a greeting.
    var line = document.getElementById("deskFirmLine");
    if (line) {
      line.classList.remove("hidden");
      line.className = "dA-kick";
      line.innerHTML = D.esc(D.today()) + (d.firm ? " · <b>" + D.esc(d.firm.name) + "</b>" : "");
    }
    var title = document.querySelector("#deskView .dk-title");
    if (title) title.textContent = D.greeting() + (d.first ? ", " + d.first : "");

    // Strip icons, and zeros that step back.
    var icons = ["building", "shelf", "chat", "calendar"];
    document.querySelectorAll("#deskStrip .dk-slab").forEach(function (lab, i) { lab.insertAdjacentHTML("afterbegin", D.icon(icons[i], 14)); });
    document.querySelectorAll("#deskStrip .dk-sfig").forEach(function (f) { if (/^0\b/.test(f.textContent.trim())) f.classList.add("dA-zero"); });

    // The set-up card: in the top row's left cell when nothing needs you,
    // at the top of the desk for a member in no firm.
    var card = setupCard(d);
    if (card) {
      var top = document.querySelector("#myDesk .dk-top");
      var desk = document.getElementById("myDesk");
      var needs = d.critical.some(function (c) { return c.days <= 90; }) || d.unread > 0;
      if (top && d.firm) {
        card.style.marginTop = "20px";
        top.parentNode.insertBefore(card, top);
        if (!needs) { D.hide("deskAgenda"); top.classList.add("dA-solo"); }
        var nothing = !d.buildings.length && !d.shelf.length && !d.unread && !d.critical.length;
        if (nothing) top.style.display = "none";
      } else {
        card.style.marginTop = "4px";
        desk.insertBefore(card, desk.firstChild);
        D.hide("deskFirmEmpty");
      }
    }

    // Designed empty states.
    emptyState("buildingsEmpty", "building", "No buildings on the board yet", "Add one by address, from a report on the shelf, or from a property in your Vault.", { label: "+ Add a building", act: click("buildingAddToggle") });
    emptyState("deskSharedWithFirmEmpty", "shelf", "The shelf is empty", "When anyone at the firm shares a report with it, it appears here for everyone.", { label: "Run a comp report", href: "/bulk" });
    emptyState("deskSharesEmpty", "report", "Nothing shared yet", "Open a report and use Share to send a client a link or invite a colleague.", null);
    emptyState("deskThreadsEmpty", "chat", "No conversations yet", "Start one with a colleague, or use Discuss on a building, report or contact.", null);
    emptyState("deskCriticalEmpty", "calendar", "No dates in the next 12 months", "Lease expiries and option notices appear here once a lease is filed on a building.", null);
    emptyState("contactsEmpty", "people", "No contacts yet", "Type one in or import an Excel or CSV list with a name column.", null);
    var cc = document.querySelector("#deskContacts > .dk-copy");
    if (cc && !document.getElementById("contactsEmpty").nextElementSibling) {} // keep populated copy
    if (d.contacts.length === 0 && cc) cc.classList.add("hidden");
    var fe = document.getElementById("deskFirmEmptyCopy");
    if (fe && document.getElementById("deskFirmEmpty") && !document.getElementById("deskFirmEmpty").classList.contains("hidden")) {
      var box = D.el("div", { class: "dA-empty" });
      box.innerHTML = '<span class="dA-ico">' + D.icon("people", 19) + '</span><span class="dA-txt"><span class="dA-et">Work with your office</span><span class="dA-ex">A firm gives your office one board of buildings, a shelf of shared reports and a contact list. Each of you keeps your own reports and vault.</span></span>';
      var b = D.el("button", { type: "button", class: "dA-btn" }, D.esc(document.getElementById("deskFirmEmptyBtn").textContent));
      b.addEventListener("click", click("deskFirmEmptyBtn"));
      box.appendChild(b);
      fe.classList.add("hidden");
      fe.parentNode.appendChild(box);
    }
  });
})();
