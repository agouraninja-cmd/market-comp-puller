/* Workspace drafts, shared prototype helper (2026-09-25).
 *
 * NOT product code. Each draft is a layer injected over the real /desk page
 * before its own scripts run, so a screenshot shows the real workspace with
 * real data under the draft's styling. It reads the page's own boot payload
 * (window.DESK_BOOT) — copied the moment it is assigned, because bootFetch
 * deletes each entry as the page consumes it — and never fetches anything.
 */
(function () {
  var copy = null, live;
  try {
    Object.defineProperty(window, "DESK_BOOT", {
      configurable: true,
      get: function () { return live; },
      set: function (v) { live = v; try { copy = JSON.parse(JSON.stringify(v)); } catch (e) { copy = null; } },
    });
  } catch (e) { /* the page will simply read no draft data */ }

  function body(path) {
    if (!copy) return null;
    for (var k in copy) {
      if (k === path || k.indexOf(path + "?") === 0) return copy[k] && copy[k].body;
    }
    return null;
  }

  function mostCommon(list) {
    var n = {}, best = null;
    list.forEach(function (x) { if (!x) return; n[x] = (n[x] || 0) + 1; if (!best || n[x] > n[best]) best = x; });
    return best;
  }

  function data() {
    var me = body("/api/account/me") || {};
    var org = body("/api/org") || {};
    var cfg = body("/api/config") || {};
    var firm = (org.orgs || [])[0] || null;
    var buildings = (body("/api/org/buildings") || {}).buildings || [];
    var shelf = (body("/api/org/shelf") || {}).items || [];
    var contacts = (body("/api/org/contacts") || {}).contacts || [];
    var members = (body("/api/org/members") || {}).members || [];
    var leases = body("/api/org/leases") || {};
    var msgs = body("/api/messages") || {};
    var shares = body("/api/shares") || {};
    var unread = (body("/api/messages/unread") || {}).count || 0;
    var pro = cfg.pro || {};
    var name = String(me.name || me.email || "").trim();
    return {
      first: name.split(/[\s@]/)[0] || "",
      isPro: !!pro.isPro,
      firm: firm,
      invites: org.invites || [],
      buildings: buildings,
      shelf: shelf,
      contacts: contacts,
      members: members.filter(function (m) { return !m.pending; }),
      leases: leases.leases || [],
      critical: leases.critical || [],
      threads: msgs.threads || [],
      unread: unread,
      sharesMine: (shares.mine || []).length,
      sharedWithMe: (shares.sharedWithMe || []).length,
      market: mostCommon(buildings.map(function (b) { return b.market; })),
    };
  }

  function greeting(now) {
    var h = (now || new Date()).getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }
  function today() {
    return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === "class") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Line icons, 20x20, stroke = currentColor.
  var P = {
    building: '<path d="M4 17V5.5L10 3l6 2.5V17"/><path d="M2.5 17h15"/><path d="M7.5 8h1M11.5 8h1M7.5 11h1M11.5 11h1M9 17v-3h2v3"/>',
    shelf: '<rect x="3.5" y="3" width="10" height="13" rx="1.2"/><path d="M6.5 16.9V17h9.2a1 1 0 0 0 1-1V6.5"/><path d="M6.5 7h4.5M6.5 9.8h4.5M6.5 12.6h3"/>',
    chat: '<path d="M3.5 4.5h13v8.5h-7L5.5 16v-3h-2z"/><path d="M7 8.2h6M7 10.6h3.5"/>',
    calendar: '<rect x="3" y="4.5" width="14" height="12" rx="1.3"/><path d="M3 8h14M7 3v3M13 3v3"/><path d="M6.5 11h2M11.5 11h2M6.5 13.6h2"/>',
    people: '<circle cx="7.5" cy="7" r="2.6"/><path d="M2.8 16c.5-2.7 2.4-4.2 4.7-4.2s4.2 1.5 4.7 4.2"/><circle cx="13.6" cy="7.6" r="2"/><path d="M13.4 11.8c1.9.1 3.4 1.4 3.8 3.6"/>',
    report: '<path d="M5 2.8h7l3.5 3.5V17.2H5z"/><path d="M12 2.8v3.5h3.5"/><path d="M7.5 14v-2.5M10 14V9M12.5 14v-4"/>',
    map: '<path d="M10 17.2s-5-4.6-5-8.7a5 5 0 0 1 10 0c0 4.1-5 8.7-5 8.7z"/><circle cx="10" cy="8.5" r="1.8"/>',
    permit: '<path d="M5 2.8h10v14.4H5z"/><path d="M7.5 6h5M7.5 8.6h5"/><circle cx="10" cy="13" r="1.8"/>',
    vault: '<rect x="3" y="4" width="14" height="12.5" rx="1.4"/><circle cx="10" cy="10.2" r="2.6"/><path d="M10 7.6v-.8M12.6 10.2h.8M5.5 16.5v1M14.5 16.5v1"/>',
    spark: '<path d="M10 2.5l1.6 4.7 4.9.1-3.9 3 1.4 4.7-4-2.8-4 2.8 1.4-4.7-3.9-3 4.9-.1z"/>',
    plus: '<path d="M10 4.5v11M4.5 10h11"/>',
    arrow: '<path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5"/>',
    check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  };
  function icon(name, size) {
    var s = size || 18;
    return '<svg viewBox="0 0 20 20" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
  }

  // Runs fn once the desk has filled (the page reveals #myDesk in one paint).
  function whenDesk(fn) {
    var tries = 0;
    (function poll() {
      var d = document.getElementById("myDesk");
      if (d && !d.classList.contains("hidden")) return setTimeout(function () { try { fn(data()); } catch (e) { console.error("draft", e); } }, 250);
      if (++tries < 200) setTimeout(poll, 50);
    })();
  }
  function addStyle(css) {
    var s = el("style", { "data-draft": "1" }, css);
    (document.head || document.documentElement).appendChild(s);
  }
  function shown(id) {
    var e = document.getElementById(id);
    return !!(e && !e.classList.contains("hidden") && e.offsetParent !== null);
  }
  function hide(id) { var e = document.getElementById(id); if (e) e.classList.add("hidden"); }

  window.DRAFT = { data: data, greeting: greeting, today: today, el: el, esc: esc, icon: icon, whenDesk: whenDesk, addStyle: addStyle, shown: shown, hide: hide };
})();
