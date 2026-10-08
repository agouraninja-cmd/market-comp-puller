// ---------------------------------------------------------------------------
// The Sites tab on /vault (the Data page), for a development firm's members.
// Design: the owner's pick "M2" of the Sites drafts (2026-10-05),
//   https://claude.ai/artifact/BMeJY9d3vegjmDxcAPtxzR
//
// Two sections on one tab:
//   * Buying: the deals in progress (user_sites rows on Prospect, LOI, Under
//     contract or Entitlements), each opening in place with its tracker, key
//     terms, key dates, notes, and one-click Move to <next stage> / Pass.
//   * Owned and tracking: the member's properties (portfolio_items, the same
//     rows and the same features the Properties tab shows: value, change, the
//     history line, checked, the year-old warning, the market line, Open
//     report, Refresh, Add to firm, Remove), each Owned unless a user_sites
//     status row says Tracking. A deal that closes becomes one of these.
// Passed deals fold away under both.
//
// A BROWSER file, served at /sites-tab.js with max-age 0, defining the global
// SITESTAB. It draws; it decides nothing it can read from SITES (sites.js,
// the same copy the routes validate with), and every write is an ordinary
// fetch to a route that re-checks it: /api/sites for deals and statuses,
// /api/portfolio for properties, /api/org/buildings for the firm door.
// The page's inline script mounts it once, and only for a development firm.
// ---------------------------------------------------------------------------

(function (root) {
  "use strict";

  function mount(ctx) {
    var S = root.SITES;
    if (!S || !ctx || !ctx.root) return null;
    var el = ctx.root, esc = ctx.esc, escA = ctx.escA;
    var state = {
      loaded: false, sites: [], props: [], board: null, today: "",
      // ctx.openAdd ("buy" or "own"): the page was opened to add one (Home's
      // "Add a property", via /vault?add=), so the form starts open on that kind.
      sitesErr: "", propsErr: "", open: null, addOpen: !!ctx.openAdd, addKind: ctx.openAdd === "own" ? "own" : "buy",
      editing: null, dating: null, msg: "", msgBad: false, paneMsg: {},
    };
    var focusAsked = !!ctx.openAdd;   // once, when the first read lands
    var STALE_MS = 365 * 24 * 60 * 60 * 1000;
    var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // ---- small formatters ---------------------------------------------------
    function money(n) { return n == null || n === "" ? "" : "$" + Math.round(Number(n)).toLocaleString("en-US"); }
    function short(n) {
      n = Number(n) || 0;
      if (n >= 1e6) return "$" + (n / 1e6).toFixed(n >= 1e8 ? 0 : 2).replace(/\.?0+$/, "") + "M";
      if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
      return "$" + Math.round(n);
    }
    function acres(n) { return n == null ? "" : String(Math.round(Number(n) * 10) / 10); }
    function todayIso() {
      var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    }
    function dayLabel(iso) {
      var p = String(iso || "").slice(0, 10).split("-");
      if (p.length < 3) return "";
      var same = String(state.today).slice(0, 4) === p[0];
      return MON[Number(p[1]) - 1] + " " + Number(p[2]) + (same ? "" : ", " + p[0]);
    }
    function tsLabel(ts) {
      var d = new Date(ts); if (!isFinite(d.getTime())) return "";
      var same = d.getFullYear() === new Date().getFullYear();
      return MON[d.getMonth()] + " " + d.getDate() + (same ? "" : ", " + d.getFullYear());
    }
    function countdown(on) {
      var n = S.daysUntil(on, state.today);
      if (n == null || n < 0) return "";
      return '<span class="st-chip' + (n <= 7 ? " hot" : "") + '">' + (n === 0 ? "Today" : n === 1 ? "Tomorrow" : n + " days") + "</span>";
    }
    function pct(p) {
      if (p == null || !isFinite(p)) return '<span class="st-mute">&mdash;</span>';
      return '<span class="st-pct ' + (p >= 0 ? "st-up" : "st-dn") + '">' + (p >= 0 ? "&#9650;" : "&#9660;") + " " + Math.abs(p).toFixed(1) + "%</span>";
    }
    function placeOf(address, market) {
      var parts = String(address || "").split(",");
      var street = parts[0].trim();
      var rest = market || parts.slice(1).join(",").replace(/\s+\d{5}(-\d{4})?\s*$/, "").trim();
      return { street: street, place: rest };
    }
    function chev() {
      return '<svg class="st-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    // The stage as its name over a five-step meter: how far along, with no
    // colour per stage. Owned fills green; Tracking and Passed are off it.
    function meter(stage) {
      var i = S.STEPS.indexOf(stage), off = stage === "tracking" || stage === "passed";
      var segs = S.STEPS.map(function (k, j) { return "<i" + (!off && j <= i ? ' class="on"' : "") + "></i>"; }).join("");
      return '<span class="st-stage st-' + stage + '"><span class="st-sn">' + esc(S.labelOf(stage)) +
        '</span><span class="st-meter" aria-hidden="true">' + segs + "</span></span>";
    }
    // The five steps with the day each was reached.
    function stepper(stage, stageDates, preview) {
      var i = preview ? -1 : S.STEPS.indexOf(stage), sd = stageDates || {};
      return '<ol class="st-steps">' + S.STEPS.map(function (k, j) {
        var st = j < i ? "done" : j === i ? "now" : "";
        var when = !preview && sd[k] ? dayLabel(sd[k]) : "";
        return '<li class="' + st + '"><span class="st-dot">' +
          (st === "done" ? '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5.2 4.1 7.3 8 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' : "") +
          '</span><span class="st-sl">' + esc(S.labelOf(k)) + "</span>" + (when ? '<span class="st-sd">' + when + "</span>" : "") + "</li>";
      }).join("") + "</ol>";
    }
    function spark(snaps) {
      var vals = snaps.map(function (s) { return Number(s.likely); }).filter(function (v) { return v > 0; }).slice(-12);
      if (vals.length < 2) return "";
      var w = 76, h = 22, pad = 3, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      var x = function (i) { return pad + i * (w - 2 * pad) / (vals.length - 1); };
      var y = function (v) { return hi === lo ? h / 2 : h - pad - (v - lo) * (h - 2 * pad) / (hi - lo); };
      return '<svg class="st-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-label="' + vals.length +
        ' values tracked"><polyline points="' + vals.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ") +
        '" fill="none" stroke="var(--ink-3)" stroke-width="1.5"/><circle cx="' + x(vals.length - 1).toFixed(1) + '" cy="' +
        y(vals[vals.length - 1]).toFixed(1) + '" r="2.4" fill="var(--red-fill)"/></svg>';
    }
    function chart(snaps) {
      var hist = snaps.filter(function (s) { return Number(s.likely) > 0 && isFinite(Date.parse(s.ts)); });
      if (hist.length < 2) return "";
      var W = 520, H = 120, pad = 18, vals = hist.map(function (s) { return Number(s.likely); });
      var lo = Math.min.apply(null, vals) * 0.985, hi = Math.max.apply(null, vals) * 1.015;
      var t0 = Date.parse(hist[0].ts), t1 = Date.parse(hist[hist.length - 1].ts);
      var x = function (t) { return pad + (Date.parse(t) - t0) * (W - 2 * pad) / (t1 - t0 || 1); };
      var y = function (v) { return H - 26 - (v - lo) * (H - 44) / ((hi - lo) || 1); };
      var anchor = function (i) { return i === 0 ? "start" : i === hist.length - 1 ? "end" : "middle"; };
      return '<svg class="st-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Likely value at each check">' +
        '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + (H - 18) + '" y2="' + (H - 18) + '" stroke="var(--line)"/>' +
        '<polyline fill="none" stroke="var(--ink-2)" stroke-width="2" points="' +
        hist.map(function (s) { return x(s.ts).toFixed(1) + "," + y(Number(s.likely)).toFixed(1); }).join(" ") + '"/>' +
        hist.map(function (s, i) {
          var last = i === hist.length - 1, cx = x(s.ts).toFixed(1), cy = y(Number(s.likely)).toFixed(1), d = new Date(s.ts);
          return '<circle cx="' + cx + '" cy="' + cy + '" r="' + (last ? 4.5 : 3.5) + '" fill="' + (last ? "var(--red-fill)" : "var(--card)") +
            '" stroke="' + (last ? "var(--red-fill)" : "var(--ink-2)") + '" stroke-width="2"/>' +
            '<text x="' + cx + '" y="' + (Number(cy) - 10).toFixed(1) + '" text-anchor="' + anchor(i) + '" class="st-cv">' + short(Number(s.likely)) + "</text>" +
            '<text x="' + cx + '" y="' + (H - 4) + '" text-anchor="' + anchor(i) + '" class="st-cd">' + MON[d.getMonth()] + " " + String(d.getFullYear()).slice(2) + "</text>";
        }).join("") + "</svg>";
    }

    // ---- reading -------------------------------------------------------------
    function getJson(url) {
      return fetch(url, { credentials: "same-origin" }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j || {} }; });
      }).catch(function () { return { s: 0, j: {} }; });
    }
    function send(method, url, body) {
      return fetch(url, { method: method, credentials: "same-origin", headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j || {} }; });
      }).catch(function () { return { s: 0, j: { error: "That didn't reach the server. Nothing was changed." } }; });
    }
    function load() {
      var firmId = ctx.firm && ctx.firm.id;
      return Promise.all([
        getJson("/api/sites"),
        getJson("/api/portfolio"),
        firmId ? getJson("/api/org/buildings?id=" + encodeURIComponent(firmId)) : Promise.resolve(null),
      ]).then(function (r) {
        var s = r[0], p = r[1], b = r[2];
        state.sites = s.s === 200 && Array.isArray(s.j.sites) ? s.j.sites : [];
        state.today = (s.s === 200 && s.j.today) || state.today || todayIso();
        // A failed read renders as a FAILURE, never as an empty list: "nothing
        // here" said to somebody with twelve deals reads as their work gone.
        state.sitesErr = s.s === 200 ? "" : (s.j.error || "Couldn't load your properties. Nothing has been lost.");
        state.props = p.s === 200 && Array.isArray(p.j.items) ? p.j.items : [];
        state.propsErr = p.s === 200 ? "" : "Couldn't load your properties just now. Nothing has been lost.";
        state.board = b && b.s === 200 && Array.isArray(b.j.buildings) ? b.j.buildings : null;
        state.loaded = true;
        render();
        if (focusAsked) {
          focusAsked = false;
          var a = el.querySelector && el.querySelector('form[data-form="add"] input[name="address"]');
          if (a && a.focus) a.focus();
        }
      });
    }

    // ---- the model -----------------------------------------------------------
    function onBoard(item) {
      if (!state.board) return true;   // no door offered on a list we could not read
      var vk = String(item.verified_key || ""), a = String(item.address || "").trim().toLowerCase();
      return state.board.some(function (b) {
        return (vk && b.verifiedKey && b.verifiedKey === vk) || (a && String(b.address || "").trim().toLowerCase() === a);
      });
    }
    function model() {
      var deals = [], passed = [], status = {};
      state.sites.forEach(function (s) {
        if (s.portfolio_item_id) {
          var prior = status[s.portfolio_item_id];
          if (!prior || String(s.updated_at || "") > String(prior.updated_at || "")) status[s.portfolio_item_id] = s;
        } else if (s.stage === "passed") passed.push(s);
        else if (S.isBuying(s.stage)) deals.push(s);
      });
      var rank = function (st) { return S.STAGES.indexOf(st); };
      var next = function (s) { var d = S.nextDeadline(s.dates, state.today); return d ? d.on : "9999"; };
      deals.sort(function (a, b) { return rank(a.stage) - rank(b.stage) || (next(a) < next(b) ? -1 : next(a) > next(b) ? 1 : 0); });
      var held = state.props.map(function (it) {
        var o = status[it.id] || null;
        var snaps = Array.isArray(it.snapshots) ? it.snapshots : [];
        var last = snaps[snaps.length - 1] || null, prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
        var ts = last && last.ts ? Date.parse(last.ts) : NaN;
        return {
          key: "p:" + it.id, item: it, status: o, stage: o && o.stage === "tracking" ? "tracking" : "owned",
          snaps: snaps, last: last, prev: prev,
          likely: last && last.likely ? Number(last.likely) : null,
          chg: last && prev && last.likely && prev.likely ? (last.likely - prev.likely) / prev.likely * 100 : null,
          checked: last && last.ts ? last.ts : null,
          stale: isFinite(ts) && Date.now() - ts > STALE_MS,
          movement: it.movement && it.movement.line ? it.movement.line : "",
        };
      });
      held.sort(function (a, b) {
        return (a.stage === b.stage ? 0 : a.stage === "owned" ? -1 : 1) || String(a.item.address).localeCompare(String(b.item.address));
      });
      // Owned only: a building you watch is not part of what you own.
      var owned = held.filter(function (h) { return h.stage === "owned"; });
      var valued = owned.filter(function (h) { return h.likely; });
      var cur = 0, prv = 0;
      valued.forEach(function (h) { if (h.prev && h.prev.likely) { cur += h.likely; prv += Number(h.prev.likely); } });
      return {
        deals: deals, passed: passed, held: held, status: status,
        ownedValue: valued.reduce(function (t, h) { return t + h.likely; }, 0), valuedN: valued.length,
        between: prv ? (cur - prv) / prv * 100 : null,
        stale: held.filter(function (h) { return h.stale; }).length,
      };
    }
    function siteById(id) { return state.sites.filter(function (s) { return s.id === id; })[0] || null; }
    function propById(id) { return state.props.filter(function (p) { return p.id === id; })[0] || null; }

    // ---- drawing -------------------------------------------------------------
    function render() {
      if (!state.loaded) { el.innerHTML = '<p class="st-mute">Loading your properties&hellip;</p>'; return; }
      var m = model();
      var active = m.deals.length + m.held.length;
      var soon = m.deals.filter(function (s) { var d = S.nextDeadline(s.dates, state.today); return d && S.daysUntil(d.on, state.today) <= 7; }).length;
      if (ctx.setCount) ctx.setCount(soon ? soon + " due this week" : (active || ""), soon > 0);
      if (ctx.addToggle) {
        ctx.addToggle.textContent = state.addOpen ? "Close" : "+ Add a property";
        ctx.addToggle.setAttribute("aria-expanded", state.addOpen ? "true" : "false");
      }
      var nothing = !active && !m.passed.length && !state.sitesErr && !state.propsErr;
      if (nothing) { el.innerHTML = emptyState(); return; }
      var html = '<p class="st-intro">Every property you&rsquo;re buying, own or track. Only you can see this.</p>';
      if (state.msg) html += '<div class="msg ' + (state.msgBad ? "bad" : "ok") + '" role="status">' + esc(state.msg) + "</div>";
      if (state.addOpen) html += '<div class="st-addwrap">' + addForm(false) + "</div>";
      html += buyingSection(m) + heldSection(m) + passedFold(m);
      el.innerHTML = html;
    }

    function buyingSection(m) {
      var d = m.deals, nx = null;
      d.forEach(function (s) { var x = S.nextDeadline(s.dates, state.today); if (x && (!nx || x.on < nx.on)) nx = x; });
      var sumAsk = d.reduce(function (t, s) { return t + (Number(s.asking_price) || 0); }, 0);
      var sumAc = d.reduce(function (t, s) { return t + (Number(s.acres) || 0); }, 0);
      var figs = "<b>" + d.length + "</b> propert" + (d.length === 1 ? "y" : "ies") +
        (sumAc ? " &middot; " + acres(sumAc) + " acres" : "") + (sumAsk ? " &middot; <b>" + short(sumAsk) + "</b> asking" : "") +
        (nx ? ' &middot; next deadline <b class="st-hot">' + dayLabel(nx.on) + "</b>" : "");
      var body;
      if (state.sitesErr) body = '<div class="msg bad">' + esc(state.sitesErr) + "</div>";
      else if (!d.length) body = '<p class="st-none">No deals in progress. Use <b>+ Add a property</b> for the next one you&rsquo;re looking at.</p>';
      else body = '<div class="st-tw"><table class="st-tbl"><thead><tr><th>Property</th><th>Stage</th><th class="n">Acres</th>' +
        '<th class="n">Asking</th><th class="n">Per acre</th><th>Next deadline</th><th></th></tr></thead><tbody>' +
        d.map(dealRow).join("") + "</tbody></table></div>";
      return '<section class="st-sec" aria-labelledby="stBuyH"><div class="st-sh"><h2 id="stBuyH">Buying</h2><span class="st-sf">' + figs + "</span></div>" + body + "</section>";
    }
    function dealRow(s) {
      var key = "s:" + s.id, on = state.open === key, pl = placeOf(s.address, s.market);
      var per = s.asking_price && s.acres ? Number(s.asking_price) / Number(s.acres) : null;
      var nx = S.nextDeadline(s.dates, state.today);
      var tr = '<tr class="st-row' + (on ? " on" : "") + '" data-open="' + escA(key) + '" tabindex="0" aria-expanded="' + (on ? "true" : "false") + '">' +
        '<td><span class="st-a">' + esc(pl.street) + '</span><span class="st-s">' + esc(pl.place) + (s.zoning ? " &middot; Zoned " + esc(s.zoning) : "") + "</span></td>" +
        "<td>" + meter(s.stage) + "</td>" +
        '<td class="n" data-l="Acres">' + (s.acres != null ? acres(s.acres) : "") + "</td>" +
        '<td class="n" data-l="Asking">' + (s.asking_price != null ? money(s.asking_price) : '<span class="st-mute">&mdash;</span>') + "</td>" +
        '<td class="n" data-l="Per acre">' + (per ? money(per) : "") + "</td>" +
        '<td data-l="Next deadline">' + (nx ? '<div class="st-dl"><div class="st-dl1"><b>' + dayLabel(nx.on) + "</b>" + countdown(nx.on) + "</div><span>" + esc(nx.label) + "</span></div>"
          : '<span class="st-mute">No date set</span>') + "</td>" +
        '<td class="st-cv">' + chev() + "</td></tr>";
      if (on) tr += '<tr class="st-open"><td colspan="7">' + dealPane(s) + "</td></tr>";
      return tr;
    }
    function dealPane(s) {
      var pl = placeOf(s.address, s.market), per = s.asking_price && s.acres ? Number(s.asking_price) / Number(s.acres) : null;
      var msg = state.paneMsg["s:" + s.id];
      var head = '<div class="st-ph"><div class="st-pt">' + meter(s.stage) +
        '<button class="st-x" type="button" data-open="' + escA("s:" + s.id) + '" aria-label="Close">&times;</button></div>' +
        '<h3 class="st-addr">' + esc(pl.street) + "</h3>" +
        '<p class="st-sub">' + esc(pl.place) + (s.acres != null ? " &middot; " + acres(s.acres) + " acres" : "") + (s.zoning ? " &middot; Zoned " + esc(s.zoning) : "") + "</p></div>";
      if (state.editing === s.id) return '<div class="st-pane">' + head + editForm(s) + "</div>";
      var terms = [["Asking price", s.asking_price != null ? money(s.asking_price) : "&mdash;"], ["Per acre", per ? money(per) : "&mdash;"],
        ["Acres", s.acres != null ? acres(s.acres) : "&mdash;"], ["Zoning", s.zoning ? esc(s.zoning) : "&mdash;"]];
      if (s.earnest_money != null) terms.push(["Earnest money", money(s.earnest_money)]);
      if (s.seller) terms.push(["Seller", esc(s.seller)]);
      var dates = Array.isArray(s.dates) ? s.dates : [];
      var dateList = dates.map(function (d, i) {
        var past = d.on < state.today;
        return '<li class="' + (past ? "past" : "") + '"><span class="st-dd">' + dayLabel(d.on) + '</span><span class="st-dw">' + esc(d.label) + "</span>" +
          (past ? '<span class="st-mute">Done</span>' : countdown(d.on)) +
          '<button class="st-xs" type="button" data-deldate="' + escA(s.id) + '" data-i="' + i + '" aria-label="Remove this date">&times;</button></li>';
      }).join("");
      var dateForm = state.dating === s.id
        ? '<form class="st-dform" data-form="date" data-id="' + escA(s.id) + '"><input type="date" name="on" required aria-label="Date"/>' +
          '<input type="text" name="label" maxlength="80" placeholder="What happens" required aria-label="What happens"/>' +
          '<button class="btn" type="submit">Add</button><button class="btn ghost" type="button" data-dating="">Cancel</button></form>'
        : '<button class="st-add" type="button" data-dating="' + escA(s.id) + '">+ Add a date</button>';
      var nxt = S.nextStage(s.stage);
      var acts = s.stage === "passed"
        ? '<button class="btn" type="button" data-stage="prospect" data-id="' + escA(s.id) + '">Back to Prospect</button>'
        : (nxt ? '<button class="btn" type="button" data-stage="' + nxt + '" data-id="' + escA(s.id) + '">Move to ' + esc(S.labelOf(nxt)) + " &rarr;</button>" : "") +
          '<button class="btn ghost" type="button" data-stage="passed" data-id="' + escA(s.id) + '">Pass on this property</button>';
      return '<div class="st-pane">' + head + stepper(s.stage === "passed" ? "" : s.stage, s.stage_dates) +
        '<div class="st-grid"><div class="st-blk"><h4>Key terms</h4><dl class="st-terms">' +
        terms.map(function (t) { return "<div><dt>" + t[0] + "</dt><dd>" + t[1] + "</dd></div>"; }).join("") + "</dl></div>" +
        '<div class="st-blk"><h4>Key dates</h4>' + (dates.length ? '<ul class="st-dates">' + dateList + "</ul>" : '<p class="st-mute">No dates yet.</p>') + dateForm + "</div>" +
        '<div class="st-blk"><h4>Notes</h4><p class="st-notes">' + (s.notes ? esc(s.notes) : '<span class="st-mute">None yet.</span>') + "</p></div></div>" +
        (msg ? '<div class="msg bad">' + esc(msg) + "</div>" : "") +
        '<div class="st-acts">' + acts +
        '<a class="btn ghost" href="/?type=' + encodeURIComponent(s.property_type || "Land") + "&amp;address=" + encodeURIComponent(s.address) + '">Run a ' +
        esc(String(s.property_type || "Land").toLowerCase()) + " report</a>" +
        '<button class="btn ghost" type="button" data-edit="' + escA(s.id) + '">Edit</button>' +
        '<button class="st-rm" type="button" data-rmsite="' + escA(s.id) + '">Remove</button></div></div>';
    }
    function editForm(s) {
      var opt = function (v, cur) { return "<option" + (v === cur ? " selected" : "") + ' value="' + escA(v) + '">' + esc(S.labelOf(v) || v) + "</option>"; };
      var types = (ctx.propTypes || ["Land"]).map(function (t) { return "<option" + (t === s.property_type ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("");
      var val = function (v) { return v == null ? "" : escA(String(v)); };
      return '<form class="st-form st-edit" data-form="edit" data-id="' + escA(s.id) + '">' +
        '<label class="st-wide">Address<input type="text" name="address" maxlength="300" required value="' + val(s.address) + '"/></label>' +
        "<label>Property type<select name=\"property_type\">" + types + "</select></label>" +
        "<label>Stage<select name=\"stage\">" + S.BUYING.concat(["passed"]).map(function (k) { return opt(k, s.stage); }).join("") + "</select></label>" +
        '<label>Acres<input type="text" name="acres" value="' + val(s.acres) + '"/></label>' +
        '<label>Zoning<input type="text" name="zoning" maxlength="40" value="' + val(s.zoning) + '"/></label>' +
        '<label>Asking price<input type="text" name="asking_price" value="' + val(s.asking_price) + '"/></label>' +
        '<label>Earnest money<input type="text" name="earnest_money" value="' + val(s.earnest_money) + '"/></label>' +
        '<label class="st-wide">Seller<input type="text" name="seller" maxlength="120" value="' + val(s.seller) + '"/></label>' +
        '<label class="st-wide">Notes<input type="text" name="notes" maxlength="1000" value="' + val(s.notes) + '"/></label>' +
        '<div class="st-wide st-fa"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" data-edit="">Cancel</button></div>' +
        (state.paneMsg["s:" + s.id] ? '<div class="msg bad st-wide">' + esc(state.paneMsg["s:" + s.id]) + "</div>" : "") +
        "</form>";
    }

    function heldSection(m) {
      var show = !!ctx.showValues;
      var figs = "<b>" + m.held.length + "</b> propert" + (m.held.length === 1 ? "y" : "ies") +
        (show && m.valuedN ? " &middot; <b>" + short(m.ownedValue) + "</b> owned, likely value &middot; " + pct(m.between) + " between checks" : "");
      var body;
      if (state.propsErr) body = '<div class="msg bad">' + esc(state.propsErr) + "</div>";
      else if (!m.held.length) body = '<p class="st-none">Nothing here yet. A property you close on lands here, and so does any report you save.</p>';
      else {
        var foot = show && m.valuedN > 1
          ? '<tfoot><tr><td colspan="3">Owned, combined &middot; ' + m.valuedN + ' valued</td><td class="n">' + money(m.ownedValue) + '</td><td class="n">' + pct(m.between) + '</td><td colspan="2"></td></tr></tfoot>'
          : "";
        body = (show && m.stale ? '<p class="st-attn">' + (m.stale === 1 ? "1 property was" : m.stale + " properties were") +
          " last checked over a year ago. Refresh to bring the value up to date.</p>" : "") +
          '<div class="st-tw"><table class="st-tbl"><thead><tr><th>Property</th><th>Status</th>' +
          (show ? '<th>History</th><th class="n">Likely value</th><th class="n">Change</th><th>Checked</th>' : '<th></th><th></th><th></th><th></th>') +
          "<th></th></tr></thead><tbody>" + m.held.map(function (h) { return heldRow(h, show); }).join("") + "</tbody>" + foot + "</table></div>";
      }
      return '<section class="st-sec" aria-labelledby="stHeldH"><div class="st-sh"><h2 id="stHeldH">Owned and tracking</h2><span class="st-sf">' + figs + "</span></div>" + body + "</section>";
    }
    function heldRow(h, show) {
      var on = state.open === h.key, it = h.item, pl = placeOf(it.address, "");
      var tr = '<tr class="st-row' + (on ? " on" : "") + '" data-open="' + escA(h.key) + '" tabindex="0" aria-expanded="' + (on ? "true" : "false") + '">' +
        '<td><span class="st-a">' + esc(pl.street) + '</span><span class="st-s">' + esc(pl.place) + " &middot; " + esc(it.property_type || "") + "</span>" +
        (show && h.movement ? '<span class="st-s st-mv" title="Market median $/SF from comps others have searched. Not a new valuation of this property.">' + esc(h.movement) + "</span>" : "") + "</td>" +
        "<td>" + meter(h.stage) + "</td>";
      if (show) {
        tr += "<td>" + spark(h.snaps) + "</td>" +
          '<td class="n" data-l="Likely value">' + (h.likely ? money(h.likely) : '<span class="st-mute">&mdash;</span>') + "</td>" +
          '<td class="n" data-l="Change">' + pct(h.chg) + "</td>" +
          '<td data-l="Checked">' + (h.checked ? '<div class="st-dl1"><span>' + tsLabel(h.checked) + "</span>" + (h.stale ? '<span class="st-chip warn">Over a year</span>' : "") + "</div>"
            : '<span class="st-mute">Not valued yet</span>') + "</td>";
      } else tr += "<td></td><td></td><td></td><td></td>";
      tr += '<td class="st-cv">' + chev() + "</td></tr>";
      if (on) tr += '<tr class="st-open"><td colspan="7">' + heldPane(h, show) + "</td></tr>";
      return tr;
    }
    function heldPane(h, show) {
      var it = h.item, pl = placeOf(it.address, ""), firmName = (ctx.firm && ctx.firm.name) || "your firm";
      var href = "/?property=" + encodeURIComponent(it.id);
      var since = it.created_at ? new Date(it.created_at) : null;
      var msg = state.paneMsg[h.key];
      var other = h.stage === "owned" ? "tracking" : "owned";
      var html = '<div class="st-pane"><div class="st-ph"><div class="st-pt">' + meter(h.stage) +
        '<span class="st-top"><button class="st-move" type="button" data-held="' + escA(it.id) + '" data-to="' + other + '">Mark as ' + esc(S.labelOf(other)) + "</button>" +
        '<button class="st-x" type="button" data-open="' + escA(h.key) + '" aria-label="Close">&times;</button></span></div>' +
        '<h3 class="st-addr">' + esc(pl.street) + "</h3>" +
        '<p class="st-sub">' + esc(pl.place) + " &middot; " + esc(it.property_type || "") +
        (since && isFinite(since.getTime()) ? " &middot; On your list since " + MON[since.getMonth()] + " " + since.getFullYear() : "") + "</p></div>";
      if (show) {
        html += '<div class="st-val"><div><span class="st-vl">Likely value</span><b class="st-vb">' + (h.likely ? money(h.likely) : "&mdash;") + "</b>" +
          (h.likely ? '<span class="st-vs">' + pct(h.chg) + " vs the check before" +
            (h.last && h.last.low && h.last.high ? " &middot; range " + short(Number(h.last.low)) + " to " + short(Number(h.last.high)) : "") + "</span>"
            : '<span class="st-vs">No value yet. Refresh runs a search for one.</span>') + "</div>" +
          '<div><span class="st-vl">Checked</span><b class="st-vc">' + (h.checked ? tsLabel(h.checked) : "Never") + "</b>" +
          (h.stale ? '<span class="st-chip warn">Over a year ago</span>' : "") + "</div></div>";
      }
      var blocks = "";
      var c = show ? chart(h.snaps) : "";
      if (c) blocks += '<div class="st-blk"><h4>Value at each check</h4>' + c + "</div>";
      if (show && h.movement) blocks += '<div class="st-blk"><h4>The market since your last check</h4><p class="st-notes">' + esc(h.movement) +
        '</p><p class="st-mute">From sales other people&rsquo;s reports found. Not a new value for this building.</p></div>';
      if (ctx.firm && state.board) {
        blocks += '<div class="st-blk"><h4>Your firm</h4><p class="st-notes">' + (onBoard(it)
          ? "On " + esc(firmName) + "&rsquo;s buildings."
          : "Not on " + esc(firmName) + '&rsquo;s buildings yet. <button class="st-add" type="button" data-firm="' + escA(it.id) + '">Add to firm</button>') + "</p></div>";
      }
      if (h.status && h.status.stage_dates && h.status.stage_dates.prospect) {
        blocks += '<div class="st-blk st-wideblk"><h4>How you bought it</h4>' + stepper("owned", h.status.stage_dates) + "</div>";
      }
      if (blocks) html += '<div class="st-grid">' + blocks + "</div>";
      if (msg) html += '<div class="msg bad">' + esc(msg) + "</div>";
      html += '<div class="st-acts"><a class="btn" href="' + escA(href) + '" title="Open this report (no new search, no cost)">Open report</a>' +
        '<a class="btn ghost" href="' + escA(href + "&refresh=1") + '" title="Runs a new live search for this property">Refresh value</a>' +
        '<span class="st-mute st-actnote">Opening costs nothing. Refresh runs a new search.</span>' +
        '<button class="st-rm" type="button" data-rmprop="' + escA(it.id) + '">Remove</button></div></div>';
      return html;
    }
    function passedFold(m) {
      if (!m.passed.length) return "";
      return '<details class="st-fold"' + (m.passed.some(function (s) { return state.open === "s:" + s.id; }) ? " open" : "") + "><summary>Passed <b>" + m.passed.length + "</b></summary>" +
        '<div class="st-tw"><table class="st-tbl"><tbody>' + m.passed.map(dealRow).join("") + "</tbody></table></div></details>";
    }

    // The add form: one place for all three ways a property arrives.
    function addForm(first) {
      var k = state.addKind;
      var types = (ctx.propTypes || ["Land"]).map(function (t) {
        return "<option" + ((k === "buy" ? t === "Land" : false) ? " selected" : "") + ">" + esc(t) + "</option>";
      }).join("");
      var seg = '<div class="st-wide st-kind" role="radiogroup" aria-label="What is it">' +
        [["buy", "I&rsquo;m buying it"], ["own", "I own it"], ["track", "I&rsquo;m tracking it"]].map(function (o) {
          return '<button type="button" role="radio" data-kind="' + o[0] + '" aria-checked="' + (k === o[0] ? "true" : "false") + '"' + (k === o[0] ? ' class="on"' : "") + ">" + o[1] + "</button>";
        }).join("") + "</div>";
      var fields = k === "buy"
        ? '<label>Property type<select name="property_type">' + types + "</select></label>" +
          "<label>Stage<select name=\"stage\">" + S.BUYING.map(function (s) { return '<option value="' + s + '">' + esc(S.labelOf(s)) + "</option>"; }).join("") + "</select></label>" +
          '<label>Acres<input type="text" name="acres" placeholder="18.4"/></label>' +
          '<label>Asking price<input type="text" name="asking_price" placeholder="$3,450,000"/></label>' +
          '<label>Next deadline<input type="date" name="next_on"/></label>' +
          '<label>What it is<input type="text" name="next_label" maxlength="80" placeholder="Due diligence ends"/></label>' +
          '<label class="st-wide">Notes<input type="text" name="notes" maxlength="1000" placeholder="Optional"/></label>'
        : '<label class="st-wide">Property type<select name="property_type"><option value="">Choose one</option>' + types + "</select></label>" +
          '<p class="st-wide st-mute" style="margin:0">No search runs. Use Refresh on it when you want a value, or <a href="/">run a report</a>.</p>';
      return '<form class="st-form" data-form="add"' + (first ? "" : ' aria-label="Add a property"') + ">" +
        (first ? '<h3 class="st-fh">Add your first property</h3>' : "") + seg +
        '<label class="st-wide">Address<input type="text" name="address" maxlength="300" placeholder="Street, City, ST" required/></label>' + fields +
        '<div class="st-wide st-fa"><button class="btn" type="submit">Add property</button>' +
        (first ? "" : '<button class="btn ghost" type="button" data-addclose="1">Cancel</button>') + "</div>" +
        (state.msg && state.msgBad && first ? '<div class="msg bad st-wide">' + esc(state.msg) + "</div>" : "") + "</form>";
    }
    function emptyState() {
      return '<div class="st-empty"><div class="st-ei"><p class="st-k">Properties</p>' +
        '<h2 class="st-eh">Every property in one place, from first look to owning it</h2>' +
        "<p>Track land you&rsquo;re buying through five stages, and keep the value of what you own up to date. Only you can see them.</p>" +
        stepper("", null, true) +
        '<ul class="st-ways"><li><b>Buying</b>Asking price, stage and deadlines</li><li><b>Owned</b>Its value from every report you run, and how it changed</li>' +
        "<li><b>Tracking</b>A building you watch but don&rsquo;t own</li></ul></div>" + addForm(true) + "</div>";
    }

    // ---- writing -------------------------------------------------------------
    function flash(text, bad) { state.msg = text || ""; state.msgBad = !!bad; }
    function update(id, body) {
      return send("POST", "/api/sites/update", Object.assign({ id: id }, body)).then(function (r) {
        if (r.s !== 200) { state.paneMsg["s:" + id] = r.j.error || "That didn't save."; render(); return false; }
        delete state.paneMsg["s:" + id];
        return load().then(function () { return true; });
      });
    }
    // Closing on a site: it joins the member's properties first (the ordinary
    // add-by-address route, with its own caps and refusals), then the deal row
    // becomes that property's status, keeping its stage history.
    function makeOwned(s) {
      return send("POST", "/api/portfolio", { address: s.address, propertyType: s.property_type || "Land" }).then(function (r) {
        if (r.s !== 200 || !r.j.id) { state.paneMsg["s:" + s.id] = r.j.error || "Couldn't add it to your properties."; render(); return; }
        var pid = r.j.id;
        var stale = state.sites.filter(function (x) { return x.portfolio_item_id === pid && x.id !== s.id; });
        return Promise.all(stale.map(function (x) { return send("DELETE", "/api/sites?id=" + encodeURIComponent(x.id)); })).then(function () {
          return update(s.id, { stage: "owned", portfolio_item_id: pid }).then(function (ok) {
            if (ok) { state.open = "p:" + pid; flash("Moved to Owned. " + placeOf(s.address).street + " is with your properties now."); render(); }
          });
        });
      });
    }
    function setHeld(pid, to) {
      var it = propById(pid); if (!it) return;
      var cur = model().status[pid];
      var done = cur
        ? update(cur.id, { stage: to })
        : send("POST", "/api/sites", { address: it.address, property_type: it.property_type, stage: to, portfolio_item_id: pid }).then(function (r) {
          if (r.s !== 200) { state.paneMsg["p:" + pid] = r.j.error || "That didn't save."; render(); return false; }
          return load().then(function () { return true; });
        });
      return done;
    }

    function onClick(e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var b;
      if ((b = t.closest("[data-kind]"))) { state.addKind = b.getAttribute("data-kind"); render(); return; }
      if ((b = t.closest("[data-addclose]"))) { state.addOpen = false; render(); return; }
      if ((b = t.closest("[data-stage]"))) {
        var s = siteById(b.getAttribute("data-id")), to = b.getAttribute("data-stage");
        if (!s) return;
        b.disabled = true;
        if (to === "owned") { makeOwned(s); return; }
        update(s.id, { stage: to }).then(function (ok) {
          if (ok && to === "passed") { state.open = null; flash("Passed on " + placeOf(s.address).street + ". It is under Passed if you change your mind."); render(); }
        });
        return;
      }
      if ((b = t.closest("[data-edit]"))) { state.editing = b.getAttribute("data-edit") || null; render(); return; }
      if ((b = t.closest("[data-dating]"))) { state.dating = b.getAttribute("data-dating") || null; render(); return; }
      if ((b = t.closest("[data-deldate]"))) {
        var ds = siteById(b.getAttribute("data-deldate")); if (!ds) return;
        var i = Number(b.getAttribute("data-i"));
        update(ds.id, { dates: (ds.dates || []).filter(function (_, j) { return j !== i; }) });
        return;
      }
      if ((b = t.closest("[data-rmsite]"))) {
        var rs = siteById(b.getAttribute("data-rmsite")); if (!rs) return;
        if (!window.confirm("Remove " + placeOf(rs.address).street + " from your properties?")) return;
        send("DELETE", "/api/sites?id=" + encodeURIComponent(rs.id)).then(function (r) {
          if (r.s !== 200) { flash(r.j.error || "That didn't go through.", true); render(); return; }
          state.open = null; flash("Removed " + placeOf(rs.address).street + "."); load();
        });
        return;
      }
      if ((b = t.closest("[data-held]"))) { b.disabled = true; setHeld(b.getAttribute("data-held"), b.getAttribute("data-to")); return; }
      if ((b = t.closest("[data-firm]"))) {
        var fi = propById(b.getAttribute("data-firm")); if (!fi || !ctx.firm) return;
        b.disabled = true; b.textContent = "Adding…";
        send("POST", "/api/org/buildings?id=" + encodeURIComponent(ctx.firm.id),
          { address: fi.address, propertyType: fi.property_type, verifiedKey: fi.verified_key || "" }).then(function (r) {
          if (r.s !== 200) { state.paneMsg["p:" + fi.id] = r.j.error || "That didn't go through."; render(); return; }
          flash(r.j.existed ? fi.address + " was already on " + ctx.firm.name + "'s list." : "Added " + fi.address + " to " + ctx.firm.name + "'s buildings.");
          load();
        });
        return;
      }
      if ((b = t.closest("[data-rmprop]"))) {
        var rp = propById(b.getAttribute("data-rmprop")); if (!rp) return;
        if (!window.confirm("Remove " + rp.address + " from your properties?")) return;
        var st = model().status[rp.id];
        send("DELETE", "/api/portfolio?id=" + encodeURIComponent(rp.id)).then(function () {
          return st ? send("DELETE", "/api/sites?id=" + encodeURIComponent(st.id)) : null;
        }).then(function () { state.open = null; flash("Removed " + rp.address + "."); load(); });
        return;
      }
      if ((b = t.closest("[data-open]"))) {
        if (t.closest("a,button:not([data-open]),input,select,label,form")) return;
        var key = b.getAttribute("data-open");
        state.open = state.open === key ? null : key; state.editing = null; state.dating = null;
        render();
      }
    }
    function onKey(e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var row = e.target && e.target.closest ? e.target.closest("tr[data-open]") : null;
      if (!row || row !== e.target) return;
      e.preventDefault();
      var key = row.getAttribute("data-open");
      state.open = state.open === key ? null : key; render();
      var again = el.querySelector('tr[data-open="' + key + '"]'); if (again) again.focus();
    }
    function onSubmit(e) {
      var f = e.target; if (!f || !f.getAttribute) return;
      e.preventDefault();
      var kind = f.getAttribute("data-form"), v = function (n) { return f.elements[n] ? String(f.elements[n].value || "").trim() : ""; };
      var btn = f.querySelector('button[type="submit"]'); if (btn) btn.disabled = true;
      var again = function () { if (btn) btn.disabled = false; };
      if (kind === "add") {
        var address = v("address");
        if (!address) { flash("Type the property's address.", true); render(); return; }
        if (state.addKind === "buy") {
          var body = { address: address, property_type: v("property_type") || "Land", stage: v("stage") || "prospect",
            acres: v("acres"), asking_price: v("asking_price"), notes: v("notes") };
          if (v("next_on") || v("next_label")) body.dates = [{ on: v("next_on"), label: v("next_label") }];
          send("POST", "/api/sites", body).then(function (r) {
            if (r.s !== 200) { flash(r.j.error || "That didn't save.", true); render(); return; }
            state.addOpen = false; state.open = r.j.site ? "s:" + r.j.site.id : null; flash("Added " + placeOf(address).street + ".");
            load();
          });
        } else {
          var type = v("property_type");
          if (!type) { flash("Which kind of property is it?", true); render(); return; }
          var tracking = state.addKind === "track";
          send("POST", "/api/portfolio", { address: address, propertyType: type }).then(function (r) {
            if (r.s !== 200 || !r.j.id) { flash(r.j.error || "That didn't save.", true); render(); return; }
            var pid = r.j.id;
            var after = tracking
              ? send("POST", "/api/sites", { address: address, property_type: type, stage: "tracking", portfolio_item_id: pid })
              : Promise.resolve(null);
            return after.then(function () {
              state.addOpen = false; state.open = "p:" + pid;
              flash(r.j.existed ? address + " was already with your properties." : "Added " + address + ". Use Refresh on it when you want a value.");
              load();
            });
          });
        }
        return;
      }
      if (kind === "edit") {
        var id = f.getAttribute("data-id");
        update(id, { address: v("address"), property_type: v("property_type"), stage: v("stage"), acres: v("acres"), zoning: v("zoning"),
          asking_price: v("asking_price"), earnest_money: v("earnest_money"), seller: v("seller"), notes: v("notes") }).then(function (ok) {
          if (ok) { state.editing = null; render(); } else again();
        });
        return;
      }
      if (kind === "date") {
        var ds = siteById(f.getAttribute("data-id")); if (!ds) return;
        var list = (ds.dates || []).concat([{ on: v("on"), label: v("label") }]);
        update(ds.id, { dates: list }).then(function (ok) { if (ok) { state.dating = null; render(); } else again(); });
      }
    }

    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    el.addEventListener("submit", onSubmit);
    if (ctx.addToggle) ctx.addToggle.addEventListener("click", function () {
      state.addOpen = !state.addOpen; state.msg = ""; render();
      var a = el.querySelector('.st-addwrap input[name="address"]'); if (a && state.addOpen) a.focus();
    });
    state.today = todayIso();
    render();
    load();
    return { reload: load };
  }

  root.SITESTAB = { mount: mount };
})(typeof self !== "undefined" ? self : this);
