/* Draft B — "The slab".
 * A dark band across the top — the footer's navy, dark in both themes — that
 * carries the greeting, what needs you in one sentence, and the firm's four
 * figures set large in white. An empty workspace gets three big doors on the
 * band instead of four zeros, and every section head gets a small colour chip
 * so the page has a key you can read from across the room.
 */
(function () {
  var D = window.DRAFT;
  // The band is --slab, dark in BOTH themes, so text on it is literal (the
  // footer's rule — FOOTER_DARK_CSS — for the same reason).
  var CSS = [
    "#deskView > .dk-head{display:none}",
    ".dB-slab{position:relative;overflow:hidden;margin-top:0;border-radius:14px;background:var(--slab);color:#E4E9F0;padding:26px 30px 0;box-shadow:0 18px 40px -24px rgba(15,23,42,.55)}",
    /* the mark's red sweep, blown up and set at the right edge */
    ".dB-slab::before{content:'';position:absolute;right:-170px;top:-120px;width:400px;height:400px;background:linear-gradient(135deg,transparent 47%,rgba(220,38,38,.9) 47.2%,rgba(220,38,38,.9) 53%,transparent 53.2%);opacity:.22;pointer-events:none}",
    ".dB-slab::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(90deg,transparent 30%,#000 90%);-webkit-mask-image:linear-gradient(90deg,transparent 30%,#000 90%);pointer-events:none}",
    ".dB-slab>*{position:relative;z-index:1}",
    ".dB-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px}",
    ".dB-kick{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:#96A3B4}",
    ".dB-kick b{color:#F87171;font-weight:600}",
    ".dB-hi{margin:10px 0 0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:36px;line-height:1.08;letter-spacing:-.02em;color:#fff}",
    ".dB-say{margin:8px 0 0;font-size:14.5px;color:#B6C1CF;max-width:62ch}",
    ".dB-say b{color:#fff;font-weight:600}",
    ".dB-say .due{color:#FCA5A5;font-weight:600}",
    ".dB-slab .dk-find input{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.16);color:#fff}",
    ".dB-slab .dk-find input::placeholder{color:#96A3B4}",
    ".dB-slab .dk-find-ico{color:#96A3B4}",
    ".dB-slab .dk-find input:focus{border-color:rgba(255,255,255,.4);box-shadow:0 0 0 3px rgba(255,255,255,.08)}",
    /* figures */
    ".dB-figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:24px -30px 0;border-top:1px solid rgba(255,255,255,.1)}",
    ".dB-fig{display:block;padding:16px 30px 20px;border-left:1px solid rgba(255,255,255,.1);text-decoration:none;color:inherit}",
    ".dB-fig:first-child{border-left:0}",
    ".dB-fig:hover{background:rgba(255,255,255,.04)}",
    ".dB-fl{display:flex;align-items:center;gap:7px;font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;font-weight:600;color:#96A3B4}",
    ".dB-fn{display:block;margin-top:6px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1;color:#fff;font-variant-numeric:tabular-nums}",
    ".dB-fn.due{color:#FCA5A5}",
    ".dB-fn.zero{color:#5E6978}",
    ".dB-fs{display:block;margin-top:6px;font-size:12px;color:#96A3B4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    /* doors (the empty band) */
    ".dB-doors{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:24px 0 28px}",
    ".dB-door{display:flex;flex-direction:column;gap:6px;padding:18px 18px 16px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;text-decoration:none;font:inherit;text-align:left;cursor:pointer}",
    ".dB-door:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22)}",
    ".dB-door-i{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9px;background:#DC2626;color:#fff;margin-bottom:6px}",
    ".dB-door:nth-child(2) .dB-door-i{background:rgba(255,255,255,.12)}",
    ".dB-door:nth-child(3) .dB-door-i{background:rgba(255,255,255,.12)}",
    ".dB-door-t{font-size:15px;font-weight:600;color:#fff}",
    ".dB-door-x{font-size:12.5px;line-height:1.5;color:#B6C1CF}",
    ".dB-door-go{margin-top:auto;padding-top:8px;font-size:12.5px;font-weight:600;color:#FCA5A5;display:flex;align-items:center;gap:5px}",
    /* below the band */
    "#myDesk .dk-top.dB-one{grid-template-columns:minmax(0,1fr)}",
    "#myDesk .dk-top{margin-top:24px}",
    ".dk-card.dk-agenda{border-left:3px solid var(--red-fill)}",
    ".dB-chip{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;margin-right:9px;vertical-align:-5px;flex:0 0 auto}",
    ".dk-side .dB-chip{width:22px;height:22px;border-radius:6px;vertical-align:-6px}",
    ".dB-c-ink{background:var(--wash);color:var(--ink)}",
    ".dB-c-bv{background:var(--bv-bg);color:var(--bv-text)}",
    ".dB-c-ok{background:var(--ok-bg);color:var(--ok-text)}",
    ".dB-c-red{background:var(--err-bg);color:var(--err-text)}",
    ".dB-c-warn{background:var(--warn-bg);color:var(--warn-text)}",
    ".dB-c-est{background:var(--est-bg);color:var(--est-text)}",
    ".dk-side .dk-rule>.rd-lab{display:inline-flex;align-items:center}",
    ".dk-main .dk-rule>.rd-lab{display:inline-flex;align-items:center}",
    /* empty slots */
    ".dB-slot{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;margin-top:14px;padding:26px 20px 24px;border:1.5px dashed var(--edge);border-radius:12px;background:repeating-linear-gradient(135deg,transparent 0 10px,var(--hair) 10px 11px)}",
    ".dk-side .dB-slot{margin:12px 0 4px;padding:18px 14px}",
    ".dB-slot-i{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;background:var(--card);border:1px solid var(--edge);color:var(--ink-2);margin-bottom:4px}",
    ".dB-slot-t{font-family:Georgia,'Times New Roman',serif;font-size:16px;color:var(--ink)}",
    ".dB-slot-x{font-size:12.5px;line-height:1.5;color:var(--ink-3);max-width:46ch}",
    ".dB-slot-b{margin-top:8px;font:inherit;font-size:12.5px;font-weight:600;color:#fff;background:var(--red-fill);border:0;border-radius:7px;padding:8px 14px;cursor:pointer;text-decoration:none}",
    ".dB-slot-b:hover{background:var(--red-fill-hover)}",
    "@media (max-width:1179px){.dB-figs{grid-template-columns:repeat(2,minmax(0,1fr))}.dB-fig:nth-child(3){border-left:0}.dB-fig:nth-child(n+3){border-top:1px solid rgba(255,255,255,.1)}}",
    "@media (max-width:760px){.dB-doors{grid-template-columns:minmax(0,1fr)}.dB-slab{padding:22px 18px 0}.dB-figs{margin:20px -18px 0}.dB-fig{padding:14px 18px 16px}.dB-hi{font-size:29px}}",
  ].join("\n");

  function click(id) { return function () { var b = document.getElementById(id); if (b) b.click(); }; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }

  function doors(d) {
    if (d.firm) return [
      { i: "building", t: "Put a building on the board", x: "The buildings your office works on, with their leases and critical dates.", go: "Add a building", act: click("buildingAddToggle") },
      { i: "people", t: "Invite your team", x: "Colleagues see the board and the shelf. Each of you keeps your own vault.", go: "Invite by email", act: click("menuFirmBtn") },
      { i: "report", t: "Run a comp report", x: "One address or fifty. Share it with the firm and it lands on everyone's shelf.", go: "Open Comp report", href: "/bulk" },
    ];
    if (d.isPro) return [
      { i: "report", t: "Run a comp report", x: "One address or fifty, about a minute each.", go: "Open Comp report", href: "/bulk" },
      { i: "vault", t: "Bring in your comps", x: "Your own deals, private to you.", go: "Open your Vault", href: "/vault" },
      { i: "people", t: "Start a firm", x: "A shared board, shelf and contact list.", go: "Create a firm", act: click("deskFirmEmptyBtn") },
    ];
    return [
      { i: "map", t: "Explore a market", x: "Median $/SF, cap rates and recent comps for a city and property type.", go: "Open Market explorer", href: "/markets" },
      { i: "permit", t: "Watch new permits", x: "Commercial permits filed in Boise and Meridian, as they post.", go: "Open Permit tracker", href: "/permits" },
      { i: "people", t: "Bring your office in", x: "A firm shares one board of buildings, a shelf and a contact list. Part of Pro.", go: "How a firm works", act: click("deskFirmEmptyBtn") },
    ];
  }

  function chip(sel, ico, tone) {
    document.querySelectorAll(sel).forEach(function (lab) {
      if (lab.querySelector(".dB-chip")) return;
      lab.insertAdjacentHTML("afterbegin", '<span class="dB-chip dB-c-' + tone + '">' + D.icon(ico, 14) + "</span>");
    });
  }

  function slot(pId, ico, title, text, btn) {
    var p = document.getElementById(pId);
    if (!p || p.classList.contains("hidden")) return;
    var box = D.el("div", { class: "dB-slot" });
    box.innerHTML = '<span class="dB-slot-i">' + D.icon(ico, 20) + '</span><span class="dB-slot-t">' + D.esc(title) + '</span><span class="dB-slot-x">' + D.esc(text) + "</span>";
    if (btn) {
      var b = D.el(btn.href ? "a" : "button", btn.href ? { href: btn.href, class: "dB-slot-b" } : { type: "button", class: "dB-slot-b" }, D.esc(btn.label));
      if (btn.act) b.addEventListener("click", btn.act);
      box.appendChild(b);
    }
    p.classList.add("hidden");
    p.parentNode.insertBefore(box, p.nextSibling);
  }

  document.addEventListener("DOMContentLoaded", function () { D.addStyle(CSS); });
  D.whenDesk(function (d) {
    var view = document.getElementById("deskView");
    var head = view.querySelector(".dk-head");
    var soon = d.critical.filter(function (c) { return c.days <= 90; });
    var empty = !d.buildings.length && !d.shelf.length && !d.unread && !d.critical.length && !d.contacts.length;

    var slab = D.el("section", { class: "dB-slab", "aria-label": "Your workspace" });
    var kick = d.firm ? D.esc(d.firm.name) + " · <b>" + (d.firm.kind === "development" ? "Development shop" : "Broker shop") + "</b>" : "Your workspace";
    var say;
    if (!d.firm) say = "Your account is ready. Here are three good places to begin.";
    else if (empty) say = "<b>" + D.esc(d.firm.name) + "</b> is set up. Three steps fill this page in.";
    else {
      var bits = [];
      if (soon.length) bits.push('<span class="due">' + plural(soon.length, "date") + " in the next 90 days</span>");
      if (d.unread) bits.push("<b>" + plural(d.unread, "unread conversation") + "</b>");
      say = bits.length ? bits.join(" · ") + "." : "Nothing needs you right now.";
    }
    slab.innerHTML = '<div class="dB-top"><span class="dB-kick">' + D.esc(D.today()) + " · " + kick + '</span><span class="dB-find-slot"></span></div>' +
      '<h2 class="dB-hi">' + D.esc(D.greeting()) + (d.first ? ", " + D.esc(d.first) : "") + '</h2><p class="dB-say">' + say + "</p>";
    var find = document.getElementById("deskFindWrap");
    if (find && !find.classList.contains("hidden")) slab.querySelector(".dB-find-slot").appendChild(find);

    if (d.firm && !empty) {
      var figs = D.el("div", { class: "dB-figs" });
      var cells = document.querySelectorAll("#deskStrip .dk-scell");
      var icons = ["building", "shelf", "chat", "calendar"];
      cells.forEach(function (c, i) {
        var n = c.querySelector(".dk-sfig"), lab = c.querySelector(".dk-slab"), sub = c.querySelector(".dk-ssub");
        var num = (n && n.textContent.trim()) || "—";
        var cls = /^0\b/.test(num) ? " zero" : (i === 3 && soon.length ? " due" : "");
        var a = D.el("a", { class: "dB-fig", href: c.getAttribute("href") || "#" });
        a.innerHTML = '<span class="dB-fl">' + D.icon(icons[i], 13) + D.esc(lab ? lab.textContent : "") + '</span><span class="dB-fn' + cls + '">' + D.esc(num.replace(/ this month$/, "")) + '</span><span class="dB-fs">' + D.esc(sub ? sub.textContent : "") + "</span>";
        figs.appendChild(a);
      });
      slab.appendChild(figs);
      D.hide("deskStrip");
      document.querySelector("#myDesk .dk-top").classList.add("dB-one");
      if (!soon.length && !d.unread) D.hide("deskAgenda");
    } else {
      var box = D.el("div", { class: "dB-doors" });
      doors(d).forEach(function (o) {
        var a = D.el(o.href ? "a" : "button", o.href ? { href: o.href, class: "dB-door" } : { type: "button", class: "dB-door" });
        a.innerHTML = '<span class="dB-door-i">' + D.icon(o.i, 18) + '</span><span class="dB-door-t">' + D.esc(o.t) + '</span><span class="dB-door-x">' + D.esc(o.x) + '</span><span class="dB-door-go">' + D.esc(o.go) + " " + D.icon("arrow", 13) + "</span>";
        if (o.act) a.addEventListener("click", o.act);
        box.appendChild(a);
      });
      slab.appendChild(box);
      D.hide("deskStrip");
      D.hide("deskAgenda");
      D.hide("deskFirmEmpty");
      var top = document.querySelector("#myDesk .dk-top");
      if (top) top.style.display = "none";
    }
    head.parentNode.insertBefore(slab, head);

    // A colour key on every section head.
    chip("#deskBuildings > .dk-rule > .rd-lab", "building", "ink");
    chip("#deskSharedWithFirm > .dk-rule > .rd-lab", "shelf", "bv");
    chip("#deskShares > .dk-rule > .rd-lab", "report", "bv");
    chip("#deskThreads > .dk-rule > .rd-lab", "chat", "ok");
    chip("#deskCritical > .dk-rule > .rd-lab", "calendar", "red");
    chip("#deskDealBoard > .dk-rule > .rd-lab", "spark", "warn");
    chip("#deskPermits > .dk-rule > .rd-lab", "permit", "est");
    chip("#deskContacts > .dk-rule > .rd-lab", "people", "ink");

    // Empty sections as slots waiting to be filled.
    slot("buildingsEmpty", "building", "Your board is empty", "Add a building by address, from a report on the shelf, or from a property in your Vault.", { label: "+ Add a building", act: click("buildingAddToggle") });
    slot("deskSharedWithFirmEmpty", "shelf", "Nothing on the shelf yet", "Reports anyone at the firm shares land here for everyone.", null);
    slot("deskSharesEmpty", "report", "Nothing shared yet", "Open a report and use Share to send a client a link or invite a colleague.", null);
    slot("deskThreadsEmpty", "chat", "No conversations yet", "Start one with a colleague, or use Discuss on a building, report or contact.", null);
    slot("deskCriticalEmpty", "calendar", "No dates coming up", "Lease expiries and option notices appear once a lease is filed on a building.", null);
    slot("contactsEmpty", "people", "No contacts yet", "Type one in, or import an Excel or CSV list with a name column.", null);
    var cc = document.querySelector("#deskContacts > .dk-copy");
    if (!d.contacts.length && cc) cc.classList.add("hidden");
  });
})();
