/* Draft C — "Your market, pictured".
 * The workspace opens on a photograph of the firm's home market — the same
 * licensed, credited photographs the market pages carry — with the greeting
 * over it and the four figures as cards resting on its lower edge. With no
 * market to picture (no buildings yet), the banner is a drawn contour map,
 * never somebody else's skyline (market-hero.js's rule). Empty sections show
 * a faint preview of the rows they will hold, with the one door on top.
 */
(function () {
  var D = window.DRAFT;
  // Only curated/licensed photos, and always credited. The prototype knows
  // Boise's; the real build would ask market-hero.js's heroFor().
  var PHOTOS = {
    "Boise, ID": { src: "/market-heroes/boise-id-1920.jpg", credit: "Patrick R.", license: "CC BY-SA 3.0" },
  };
  var CSS = [
    "#deskView > .dk-head{display:none}",
    ".dC-hero{position:relative;overflow:hidden;border-radius:14px;min-height:214px;background:var(--slab);background-size:cover;background-position:center 58%;color:#fff;padding:26px 30px 62px;box-shadow:0 18px 40px -26px rgba(15,23,42,.6)}",
    ".dC-hero::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(15,23,42,.86) 0%,rgba(15,23,42,.62) 42%,rgba(15,23,42,.12) 100%)}",
    ".dC-hero.drawn::before{background:radial-gradient(120% 140% at 88% 20%,rgba(220,38,38,.28) 0%,transparent 45%)}",
    ".dC-hero>*{position:relative;z-index:1}",
    ".dC-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px}",
    ".dC-kick{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:rgba(255,255,255,.72)}",
    ".dC-hi{margin:14px 0 0;font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:38px;line-height:1.06;letter-spacing:-.02em;color:#fff;text-shadow:0 1px 18px rgba(0,0,0,.25)}",
    ".dC-sub{margin:9px 0 0;font-size:14.5px;color:rgba(255,255,255,.84);max-width:60ch}",
    ".dC-sub b{color:#fff;font-weight:600}",
    ".dC-where{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:5px 11px 5px 9px;border-radius:99px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);font-size:12px;font-weight:500;color:#fff;backdrop-filter:blur(4px)}",
    ".dC-credit{position:absolute;right:16px;bottom:50px;z-index:1;font-size:10.5px;color:rgba(255,255,255,.7)}",
    ".dC-hero .dk-find input{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.28);color:#fff;backdrop-filter:blur(6px)}",
    ".dC-hero .dk-find input::placeholder{color:rgba(255,255,255,.75)}",
    ".dC-hero .dk-find-ico{color:rgba(255,255,255,.85);z-index:1}",
    /* figures resting on the banner's edge */
    ".dC-figs{position:relative;z-index:2;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:-40px 22px 0}",
    ".dC-fig{display:flex;align-items:center;gap:13px;padding:14px 16px;border-radius:11px;background:var(--card);border:1px solid var(--edge);box-shadow:0 10px 26px -14px rgba(15,23,42,.35);text-decoration:none;color:var(--ink);min-width:0}",
    ".dC-fig:hover{border-color:var(--ink-4)}",
    ".dC-fi{flex:0 0 40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center}",
    ".dC-fb{min-width:0}",
    ".dC-fn{display:block;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}",
    ".dC-fn.due{color:var(--red)}",
    ".dC-fl{display:block;margin-top:4px;font-size:11.5px;font-weight:600;color:var(--ink-2)}",
    ".dC-fs{display:block;font-size:11.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".t-ink{background:var(--wash);color:var(--ink)}.t-bv{background:var(--bv-bg);color:var(--bv-text)}.t-ok{background:var(--ok-bg);color:var(--ok-text)}.t-red{background:var(--err-bg);color:var(--err-text)}.t-warn{background:var(--warn-bg);color:var(--warn-text)}.t-est{background:var(--est-bg);color:var(--est-text)}",
    "#myDesk .dk-top.dC-one{grid-template-columns:minmax(0,1fr);margin-top:26px}",
    /* type pills in the buildings table */
    ".dC-pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11.5px;font-weight:600}",
    /* ghost previews */
    ".dC-ghost{position:relative;margin-top:12px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card)}",
    ".dk-side .dC-ghost{margin:12px 0 4px}",
    ".dC-grow{display:flex;align-items:center;gap:14px;padding:13px 16px;border-bottom:1px solid var(--hair)}",
    ".dC-grow:last-child{border-bottom:0}",
    ".dC-gdot{flex:0 0 26px;height:26px;border-radius:7px;background:var(--wash)}",
    ".dC-gcol{flex:1 1 auto;display:flex;flex-direction:column;gap:6px}",
    ".dC-bar{display:block;height:8px;border-radius:5px;background:var(--hair)}",
    ".dC-bar.b2{height:6px;opacity:.8}",
    ".dC-gend{flex:0 0 60px;height:8px;border-radius:5px;background:var(--hair)}",
    ".dC-over{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:14px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,var(--card) 88%)}",
    ".dC-cta{display:flex;align-items:center;gap:13px;max-width:440px;padding:13px 16px;border-radius:11px;background:var(--card);border:1px solid var(--edge);box-shadow:0 12px 28px -14px rgba(15,23,42,.35)}",
    ".dC-ci{flex:0 0 38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center}",
    ".dC-ct{display:block;font-family:Georgia,'Times New Roman',serif;font-size:15.5px;color:var(--ink)}",
    ".dC-cx{display:block;font-size:12px;line-height:1.45;color:var(--ink-3);margin-top:1px}",
    ".dC-cb{flex:0 0 auto;font:inherit;font-size:12.5px;font-weight:600;color:#fff;background:var(--red-fill);border:0;border-radius:7px;padding:8px 12px;cursor:pointer;text-decoration:none;white-space:nowrap}",
    ".dk-side .dC-ghost{border:0;background:none;margin:10px 0 2px}.dk-side .dC-grow{display:none}.dk-side .dC-over{position:static;padding:0;background:none;justify-content:flex-start}.dk-side .dC-cta{box-shadow:none;border:0;padding:4px 0;background:none;max-width:none;align-items:flex-start}.dk-side .dC-cb{display:none}",
    ".dC-fn.zero{color:var(--ink-4)}",
    /* the no-firm start cards */
    ".dC-start{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:30px 0 8px}",
    ".dC-sc{display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--card);border:1px solid var(--edge);box-shadow:var(--lift);text-decoration:none;color:inherit;font:inherit;text-align:left;padding:0;cursor:pointer}",
    ".dC-sc:hover{border-color:var(--ink-4)}",
    ".dC-art{height:104px;position:relative;display:flex;overflow:hidden;background:var(--wash)}",
    ".dC-art img{flex:1 1 0;min-width:0;height:100%;object-fit:cover;display:block}",
    ".dC-art .cap{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-around;padding:4px 0 5px;font-size:10.5px;font-weight:600;color:#fff;background:linear-gradient(0deg,rgba(15,23,42,.7),transparent)}",
    ".dC-art.ic{align-items:center;justify-content:center}",
    ".dC-sb{padding:14px 16px 16px;display:flex;flex-direction:column;gap:5px;flex:1 1 auto}",
    ".dC-st{font-size:15px;font-weight:600;color:var(--ink)}",
    ".dC-sx{font-size:12.5px;line-height:1.5;color:var(--ink-3)}",
    ".dC-sg{margin-top:auto;padding-top:6px;font-size:12.5px;font-weight:600;color:var(--red)}",
    "@media (max-width:1179px){.dC-figs{grid-template-columns:repeat(2,minmax(0,1fr))}}",
    "@media (max-width:760px){.dC-hero{padding:22px 18px 56px}.dC-hi{font-size:30px}.dC-figs{margin:-36px 10px 0;gap:10px}.dC-start{grid-template-columns:minmax(0,1fr)}.dC-fig{padding:12px}.dC-fi{flex-basis:34px;height:34px}}",
  ].join("\n");

  function click(id) { return function () { var b = document.getElementById(id); if (b) b.click(); }; }

  // A drawn contour map: closed, wobbling rings around two peaks.
  function contours() {
    var paths = "";
    [[980, 60, 13], [560, 250, 8]].forEach(function (pk, j) {
      for (var r = 1; r <= pk[2]; r++) {
        var pts = [], R = 26 * r;
        for (var a = 0; a <= 64; a++) {
          var t = a / 64 * Math.PI * 2;
          var w = 1 + 0.13 * Math.sin(3 * t + r * 0.7 + j) + 0.07 * Math.sin(5 * t - r * 0.4);
          pts.push((pk[0] + Math.cos(t) * R * 1.5 * w).toFixed(1) + "," + (pk[1] + Math.sin(t) * R * w).toFixed(1));
        }
        paths += '<path d="M' + pts.join("L") + 'Z" fill="none" stroke="white" stroke-opacity="' + (r % 4 === 0 ? 0.2 : 0.09) + '" stroke-width="1"/>';
      }
    });
    return "url(\"data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice">' + paths + "</svg>") + "\")";
  }

  function ghost(pId, rows, ico, tone, title, text, btn) {
    var p = document.getElementById(pId);
    if (!p || p.classList.contains("hidden")) return;
    var g = D.el("div", { class: "dC-ghost", "aria-hidden": "false" });
    var h = "";
    for (var i = 0; i < rows; i++) {
      h += '<div class="dC-grow"><span class="dC-gdot"></span><span class="dC-gcol"><span class="dC-bar" style="width:' + [62, 48, 70, 55][i % 4] + '%"></span><span class="dC-bar b2" style="width:' + [34, 40, 28, 38][i % 4] + '%"></span></span><span class="dC-gend"></span></div>';
    }
    g.innerHTML = h + '<div class="dC-over"><div class="dC-cta"><span class="dC-ci t-' + tone + '">' + D.icon(ico, 19) + '</span><span><span class="dC-ct">' + D.esc(title) + '</span><span class="dC-cx">' + D.esc(text) + "</span></span></div></div>";
    if (btn) {
      var b = D.el(btn.href ? "a" : "button", btn.href ? { href: btn.href, class: "dC-cb" } : { type: "button", class: "dC-cb" }, D.esc(btn.label));
      if (btn.act) b.addEventListener("click", btn.act);
      g.querySelector(".dC-cta").appendChild(b);
    }
    p.classList.add("hidden");
    p.parentNode.insertBefore(g, p.nextSibling);
  }

  var TYPE_TONE = { Industrial: "est", Office: "bv", Retail: "ok", Multifamily: "warn", Land: "ok", Residential: "warn" };

  document.addEventListener("DOMContentLoaded", function () { D.addStyle(CSS); });
  D.whenDesk(function (d) {
    var view = document.getElementById("deskView");
    var head = view.querySelector(".dk-head");
    var photo = d.market && PHOTOS[d.market];
    var soon = d.critical.filter(function (c) { return c.days <= 90; });
    var empty = !d.buildings.length && !d.shelf.length && !d.unread && !d.critical.length && !d.contacts.length;

    var hero = D.el("section", { class: "dC-hero" + (photo ? "" : " drawn"), "aria-label": "Your workspace" });
    hero.style.backgroundImage = photo ? "url('" + photo.src + "')" : contours();
    var markets = {};
    d.buildings.forEach(function (b) { if (b.market) markets[b.market] = 1; });
    var mk = Object.keys(markets);
    var sub;
    if (!d.firm) sub = "Your account is ready. Pick a place to start below.";
    else if (empty) sub = "<b>" + D.esc(d.firm.name) + "</b> is ready. Your city's photograph appears here once the board has its first building.";
    else sub = soon.length || d.unread
      ? [soon.length ? "<b>" + soon.length + (soon.length === 1 ? " date" : " dates") + "</b> in the next 90 days" : "", d.unread ? "<b>" + d.unread + " unread</b> conversation" + (d.unread === 1 ? "" : "s") : ""].filter(Boolean).join(" and ") + "."
      : "Nothing needs you right now.";
    hero.innerHTML = '<div class="dC-top"><span class="dC-kick">' + D.esc(D.today()) + (d.firm ? " · " + D.esc(d.firm.name) : "") + '</span><span class="dC-find-slot"></span></div>' +
      '<h2 class="dC-hi">' + D.esc(D.greeting()) + (d.first ? ", " + D.esc(d.first) : "") + '</h2><p class="dC-sub">' + sub + "</p>" +
      (mk.length ? '<span class="dC-where">' + D.icon("map", 13) + D.esc(mk.slice(0, 3).join(" · ")) + "</span>" : "") +
      (photo ? '<span class="dC-credit">Photo: ' + D.esc(photo.credit) + " · " + D.esc(photo.license) + "</span>" : "");
    var find = document.getElementById("deskFindWrap");
    if (find && !find.classList.contains("hidden")) hero.querySelector(".dC-find-slot").appendChild(find);
    head.parentNode.insertBefore(hero, head);

    var top = document.querySelector("#myDesk .dk-top");
    if (d.firm) {
      var figs = D.el("div", { class: "dC-figs" });
      var tones = ["ink", "bv", "ok", "red"], icons = ["building", "shelf", "chat", "calendar"];
      document.querySelectorAll("#deskStrip .dk-scell").forEach(function (c, i) {
        var n = c.querySelector(".dk-sfig"), lab = c.querySelector(".dk-slab"), sub2 = c.querySelector(".dk-ssub");
        var num = ((n && n.textContent.trim()) || "—").replace(/ this month$/, "");
        var a = D.el("a", { class: "dC-fig", href: c.getAttribute("href") || "#" });
        a.innerHTML = '<span class="dC-fi t-' + tones[i] + '">' + D.icon(icons[i], 19) + '</span><span class="dC-fb"><span class="dC-fn' + (i === 3 && soon.length ? " due" : /^0\b/.test(num) ? " zero" : "") + '">' + D.esc(num) + '</span><span class="dC-fl">' + D.esc(lab ? lab.textContent : "") + '</span><span class="dC-fs">' + D.esc(sub2 ? sub2.textContent : "") + "</span></span>";
        figs.appendChild(a);
      });
      head.parentNode.insertBefore(figs, head);
      D.hide("deskStrip");
      if (top) top.classList.add("dC-one");
      if (!soon.length && !d.unread) { D.hide("deskAgenda"); if (top) top.style.display = "none"; }
    } else {
      if (top) top.style.display = "none";
      var start = D.el("div", { class: "dC-start" });
      var cards = [
        { art: '<div class="dC-art"><img src="/market-heroes/boise-id-768.jpg" alt=""><img src="/market-heroes/austin-tx-768.jpg" alt=""><img src="/market-heroes/atlanta-ga-768.jpg" alt=""><span class="cap"><span>Boise</span><span>Austin</span><span>Atlanta</span></span></div>', t: "Explore a market", x: "Median $/SF, cap rates and recent comps for a city and property type.", go: "Open Market explorer", href: "/markets" },
        { art: '<div class="dC-art ic t-est">' + D.icon("permit", 44) + "</div>", t: "Watch new permits", x: "Commercial permits filed in Boise and Meridian, as they post.", go: "Open Permit tracker", href: "/permits" },
        { art: '<div class="dC-art ic t-bv">' + D.icon("people", 44) + "</div>", t: "Bring your office in", x: "A firm shares one board of buildings, a shelf and a contact list. Part of Pro.", go: "How a firm works", act: click("deskFirmEmptyBtn") },
      ];
      cards.forEach(function (c) {
        var a = D.el(c.href ? "a" : "button", c.href ? { href: c.href, class: "dC-sc" } : { type: "button", class: "dC-sc" });
        a.innerHTML = c.art + '<span class="dC-sb"><span class="dC-st">' + D.esc(c.t) + '</span><span class="dC-sx">' + D.esc(c.x) + '</span><span class="dC-sg">' + D.esc(c.go) + " →</span></span>";
        if (c.act) a.addEventListener("click", c.act);
        start.appendChild(a);
      });
      head.parentNode.insertBefore(start, head);
      D.hide("deskFirmEmpty");
    }

    // Type pills in the buildings table.
    document.querySelectorAll("#buildingRows .dk-bc-type").forEach(function (c) {
      var t = c.textContent.trim();
      if (!t) return;
      c.innerHTML = '<span class="dC-pill t-' + (TYPE_TONE[t] || "ink") + '">' + D.esc(t) + "</span>";
    });
    // Icons on the side cards' heads.
    [["deskThreads", "chat", "ok"], ["deskCritical", "calendar", "red"], ["deskDealBoard", "spark", "warn"], ["deskPermits", "permit", "est"], ["deskContacts", "people", "ink"]].forEach(function (x) {
      var lab = document.querySelector("#" + x[0] + " > .dk-rule > .rd-lab");
      if (lab) { lab.style.display = "inline-flex"; lab.style.alignItems = "center"; lab.style.gap = "8px"; lab.insertAdjacentHTML("afterbegin", '<span class="dC-fi t-' + x[2] + '" style="flex:0 0 22px;height:22px;border-radius:6px">' + D.icon(x[1], 13) + "</span>"); }
    });

    ghost("buildingsEmpty", 3, "building", "ink", "Your board starts here", "Add the buildings your office works on — by address, from the shelf, or from your Vault.", { label: "+ Add a building", act: click("buildingAddToggle") });
    ghost("deskSharedWithFirmEmpty", 2, "shelf", "bv", "The firm's shelf", "Reports anyone here shares with the firm land on this shelf for everyone.", { label: "Run a comp report", href: "/bulk" });
    ghost("deskSharesEmpty", 2, "report", "bv", "Nothing shared yet", "Open a report and use Share to send a client a link or invite a colleague.", null);
    ghost("deskThreadsEmpty", 2, "chat", "ok", "No conversations yet", "Start one with a colleague, or use Discuss on a building.", null);
    ghost("deskCriticalEmpty", 2, "calendar", "red", "No dates coming up", "Expiries and notices appear once a lease is filed.", null);
    ghost("contactsEmpty", 2, "people", "ink", "No contacts yet", "Type one in, or import an Excel or CSV list.", null);
    var cc = document.querySelector("#deskContacts > .dk-copy");
    if (!d.contacts.length && cc) cc.classList.add("hidden");
  });
})();
