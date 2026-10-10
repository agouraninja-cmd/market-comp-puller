// ---------------------------------------------------------------------------
// The Board, on the Markets page (2026-10-09; the owner: "the board is meant
// to be kind of like a stock portfolio watch list for properties and
// markets", and "where it is right now in the market explorer").
//
// One watchlist, the way a brokerage app lists tickers: every row a name, a
// price, how that price moved, a trend line, and a buying read where there
// is one. Two kinds of row:
//   * a MARKET (watchlist_items, GET /api/watchlist/feed): its median sale
//     $/SF over six months, the move against the six months before, a line
//     of quarterly medians, the Favorable / Mixed / Tough read
//     (buying-read.js) and its new comps;
//   * a PROPERTY the member watches but does not own: a portfolio_items row
//     whose status is Tracking (a user_sites status row; migration 060), the
//     same status a development firm's Sites tab used for "a building you
//     watch". Its price is its likely value from the last check, its move
//     the change against the check before, its line every check, and under
//     it what its market did since (GET /api/portfolio's `movement`). What
//     a member OWNS stays on Home; "I own it" moves a row there.
//
// Rules this file keeps:
//   * It decides nothing the server re-checks: every write is an ordinary
//     fetch to a route with its own gate (/api/watchlist, /api/portfolio,
//     /api/sites). Watching a property needs Pro, like Tracking always did
//     (requireSites); following a market does not.
//   * No search runs from here. A value comes from opening the property's
//     report and refreshing it, the same billed search as anywhere else.
//   * A failed read says so ("Nothing has been lost"); it is never drawn as
//     an empty Board.
//   * Built with createElement/textContent: every address is text a person
//     typed. A private address goes only to our own routes, in a body.
//   * The read is a read of public numbers, never advice: the page carries
//     the not-advice line.
//
// Dual-exported: Node gets the pure helpers (test/board.test.js, and
// server.js's quarterSeries for the feed), the browser gets the global
// BOARD, whose mount() the Markets page calls for a signed-in member. Served
// at /board.js with maxAge 0.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BOARD = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PROP_TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];
  const QUARTERS = 8;          // two years of quarterly medians on a market's line
  const QUARTER_MIN = 2;       // sales a quarter needs before its median is a point
  const STALE_MS = 365 * 864e5;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---- pure ---------------------------------------------------------------
  const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

  // The upper-middle value, server.js medianPsfOf's formula, so a point on
  // the line and the feed's own median are worked out the same way.
  function median(list) {
    const s = list.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    return s.length ? Math.round(s[Math.floor(s.length / 2)] * 100) / 100 : null;
  }

  // A market's trend line: the median sale $/SF of each of the last QUARTERS
  // calendar quarters, oldest first. `dated` is server.js saleRowsWithDates'
  // shape ({ yearFrac, psf }); `nowFrac` is today on the same scale. A
  // quarter with fewer than QUARTER_MIN sales is left out rather than drawn
  // from one deal, so a thin market draws a short line, never a jagged one.
  function quarterSeries(dated, nowFrac) {
    const now = Number(nowFrac);
    if (!Number.isFinite(now)) return [];
    const thisQ = Math.floor(now * 4);
    const buckets = new Map();
    (Array.isArray(dated) ? dated : []).forEach((d) => {
      const yf = num(d && d.yearFrac), psf = num(d && d.psf);
      if (yf == null || !(psf > 0)) return;
      const q = Math.floor(yf * 4);
      if (q > thisQ || q <= thisQ - QUARTERS) return;
      if (!buckets.has(q)) buckets.set(q, []);
      buckets.get(q).push(psf);
    });
    return [...buckets.entries()].filter(([, v]) => v.length >= QUARTER_MIN).sort((a, b) => a[0] - b[0])
      .map(([q, v]) => ({ label: "Q" + ((q % 4) + 1) + " " + Math.floor(q / 4), psf: median(v), n: v.length }));
  }

  function pct(cur, prior) {
    const a = num(cur), b = num(prior);
    return a != null && b ? (a - b) / b * 100 : null;
  }
  function short(n) {
    n = num(n) || 0;
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(n >= 1e8 ? 0 : 2).replace(/\.?0+$/, "") + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }
  function psfLabel(n) { n = num(n); return n == null ? "" : "$" + (n >= 100 ? Math.round(n) : n.toFixed(2).replace(/\.00$/, "")) + "/SF"; }
  // A comp's price or rate as the corpus stores it: a bare number reads as
  // dollars ("5379000" -> "$5,379,000"); anything already written out (a
  // rent with its unit) is shown as it is.
  function figure(v) {
    const t = String(v == null ? "" : v).trim();
    return /^\d+(\.\d+)?$/.test(t) ? "$" + Math.round(Number(t)).toLocaleString("en-US") : t;
  }
  function move(p) {
    if (p == null || !Number.isFinite(p)) return null;
    const r = Math.round(Math.abs(p) * 10) / 10;
    return { dir: r === 0 ? "flat" : p > 0 ? "up" : "down", text: (r === 0 ? "" : p > 0 ? "▲ " : "▼ ") + r.toFixed(1) + "%" };
  }
  function street(address) { return String(address || "").split(",")[0].trim(); }
  // "Boise, ID" from "1550 S Federal Way, Boise, ID 83716": the market a
  // watched property sits in, written the way watchlist_items writes one.
  function marketOf(address) {
    const p = String(address || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (p.length < 3) return "";
    const st = p[2].split(/\s+/)[0].toUpperCase();
    return /^[A-Z]{2}$/.test(st) ? p[1] + ", " + st : "";
  }
  function tsLabel(ts, now) {
    const d = new Date(ts);
    if (!isFinite(d.getTime())) return "";
    const same = d.getFullYear() === new Date(now == null ? Date.now() : now).getFullYear();
    return MON[d.getMonth()] + " " + d.getDate() + (same ? "" : ", " + d.getFullYear());
  }

  // One market as a row. `readOf` is BUYINGREAD.buyingRead, or nothing (no
  // script, no read: a row never invents one).
  function marketRow(item, readOf) {
    const t = item && item.median_trend;
    const change = t ? pct(t.current, t.prior) : null;
    const spark = (Array.isArray(item && item.spark) ? item.spark : []).map((q) => num(q.psf)).filter((v) => v > 0);
    return {
      kind: "market", key: "m:" + item.id, id: item.id,
      name: String(item.market || ""), sub: String(item.property_type || ""),
      price: num(item.median_psf), priceText: psfLabel(item.median_psf), priceNote: "median, 6 mo",
      change, move: move(change), changeNote: change == null ? "" : "vs prior 6 mo",
      spark, newCount: Number(item.new_count) || 0,
      read: typeof readOf === "function" ? readOf(item) : null,
      href: item.market_page && /^[a-z0-9-]{1,120}$/.test(String(item.market_page.slug || "")) ? "/market/" + item.market_page.slug : "",
    };
  }

  // A watched property as a row: its likely value at the last check and the
  // change against the check before (not against the first: a stock's
  // change is the last move, and Home's own row reads the same way).
  function propertyRow(item, status, now) {
    const snaps = (Array.isArray(item && item.snapshots) ? item.snapshots : []).filter((s) => s && num(s.likely) > 0);
    const last = snaps[snaps.length - 1] || null, prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const change = last && prev ? pct(last.likely, prev.likely) : null;
    const ts = last && last.ts ? Date.parse(last.ts) : NaN;
    return {
      kind: "property", key: "p:" + item.id, id: item.id, statusId: status ? status.id : null,
      address: String(item.address || ""), name: street(item.address), sub: [marketOf(item.address), item.property_type].filter(Boolean).join(" · "),
      market: marketOf(item.address), type: String(item.property_type || ""),
      price: last ? num(last.likely) : null, priceText: last ? short(last.likely) : "", priceNote: last ? "likely value" : "",
      low: last ? num(last.low) : null, high: last ? num(last.high) : null,
      change, move: move(change), changeNote: change == null ? "" : "vs last check",
      spark: snaps.map((s) => num(s.likely)),
      checked: last && last.ts ? last.ts : null,
      stale: isFinite(ts) && (now == null ? Date.now() : now) - ts > STALE_MS,
      movement: item && item.movement && item.movement.line ? String(item.movement.line) : "",
    };
  }

  // Which of the member's held properties are watched: those whose newest
  // status row says Tracking. Owned is the default and is Home's.
  function watched(portfolio, sites) {
    const status = new Map();
    (Array.isArray(sites) ? sites : []).forEach((s) => {
      if (!s || s.portfolio_item_id == null) return;
      const k = String(s.portfolio_item_id), prior = status.get(k);
      if (!prior || String(s.updated_at || "") > String(prior.updated_at || "")) status.set(k, s);
    });
    return (Array.isArray(portfolio) ? portfolio : [])
      .filter((p) => p && status.has(String(p.id)) && status.get(String(p.id)).stage === "tracking")
      .map((p) => ({ item: p, status: status.get(String(p.id)) }));
  }

  // The line over the list: how many of each, and how many markets read
  // favourable for buying (only when some market has a read at all).
  function summary(rows) {
    const m = rows.filter((r) => r.kind === "market"), p = rows.filter((r) => r.kind === "property");
    const parts = [];
    if (m.length) parts.push(m.length + " market" + (m.length === 1 ? "" : "s"));
    if (p.length) parts.push(p.length + " propert" + (p.length === 1 ? "y" : "ies"));
    const read = m.filter((r) => r.read);
    const good = read.filter((r) => r.read.lean === "good").length;
    if (read.length) parts.push(good + " favorable for buying");
    return parts.join(" · ");
  }

  // What the add box was given: a street number first means an address,
  // anything else is a market ("Boise, ID"). Refuses rather than guesses.
  function parseAdd(text) {
    const s = String(text || "").trim().replace(/\s+/g, " ");
    if (!s) return { ok: false, error: "Type a market, like Boise, ID, or an address." };
    if (/^\d/.test(s)) {
      if (s.split(",").length < 3) return { ok: false, error: "Type the full address: street, city and state, like 1550 S Federal Way, Boise, ID." };
      return { ok: true, kind: "property", address: s };
    }
    const m = /^([^,]+),\s*([A-Za-z]{2})$/.exec(s);
    if (!m) return { ok: false, error: "Type a market as a city and a two-letter state, like Boise, ID." };
    return { ok: true, kind: "market", market: m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()) + ", " + m[2].toUpperCase() };
  }

  // ---- the browser half -----------------------------------------------------
  // ctx: { root, readOf (BUYINGREAD.buyingRead or null), leans (BUYINGREAD.LEANS) }
  function mount(ctx) {
    if (!ctx || !ctx.root || typeof document === "undefined") return null;
    const SVG = "http://www.w3.org/2000/svg";
    const el = ctx.root;
    const leans = ctx.leans || { good: "Favorable", mid: "Mixed", bad: "Tough" };
    const state = { feed: null, feedErr: "", portfolio: null, sites: null, sitesLocked: false, propErr: "",
      open: "", show: "all", adding: false, addType: "Industrial", msg: "", msgBad: false, busy: false };

    function h(tag, attrs, ...kids) {
      const e = document.createElement(tag);
      Object.entries(attrs || {}).forEach(([k, v]) => {
        if (v == null || v === false) return;
        if (k === "class") e.className = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? "" : String(v));
      });
      kids.flat(3).forEach((k) => { if (k != null && k !== false && k !== "") e.append(k); });
      return e;
    }
    function sv(tag, attrs, ...kids) {
      const e = document.createElementNS(SVG, tag);
      Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, String(v)));
      kids.forEach((k) => { if (k) e.append(k); });
      return e;
    }
    function getJson(url) {
      return fetch(url, { credentials: "same-origin" }).then((r) => r.json().catch(() => ({})).then((j) => ({ s: r.status, j: j || {} })))
        .catch(() => ({ s: 0, j: {} }));
    }
    function send(method, url, body) {
      return fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) }).then((r) =>
        r.json().catch(() => ({})).then((j) => ({ s: r.status, j: j || {} })))
        .catch(() => ({ s: 0, j: { error: "That didn't reach the server. Nothing was changed." } }));
    }

    function load() {
      return Promise.all([getJson("/api/watchlist/feed"), getJson("/api/portfolio"), getJson("/api/sites")]).then(([f, p, s]) => {
        if (f.s === 401) { el.replaceChildren(); return; }
        state.feed = f.s === 200 && Array.isArray(f.j.items) ? f.j.items : state.feed;
        state.feedErr = f.s === 200 ? "" : "Couldn't load your markets just now. Nothing has been lost.";
        state.sitesLocked = s.s === 403;
        state.sites = s.s === 200 && Array.isArray(s.j.sites) ? s.j.sites : (state.sitesLocked ? [] : state.sites);
        state.portfolio = p.s === 200 && Array.isArray(p.j.items) ? p.j.items : state.portfolio;
        state.propErr = (p.s === 200 && (s.s === 200 || s.s === 403)) ? "" : "Couldn't load the properties you watch just now. Nothing has been lost.";
        render();
        // Mark the feed read, as The Board always has: last_seen_at is one of
        // the digest's two high-water marks, so news read here is not mailed.
        if (f.s === 200 && f.j.unseen) send("POST", "/api/watchlist/seen").catch(() => {});
      });
    }

    // ---- drawing ----
    function sparkSvg(vals) {
      const v = vals.filter((x) => x > 0);
      if (v.length < 2) return h("span", { class: "bd-nospark", "aria-hidden": "true" }, "—");
      const w = 96, ht = 28, pad = 3, lo = Math.min(...v), hi = Math.max(...v);
      const x = (i) => pad + i * (w - 2 * pad) / (v.length - 1);
      const y = (n) => (hi === lo ? ht / 2 : ht - pad - (n - lo) * (ht - 2 * pad) / (hi - lo));
      const up = v[v.length - 1] >= v[0];
      return sv("svg", { class: "bd-spark " + (up ? "up" : "dn"), width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, role: "img",
        "aria-label": v.length + " points, " + (up ? "up" : "down") + " over the period" },
        sv("polyline", { points: v.map((n, i) => x(i).toFixed(1) + "," + y(n).toFixed(1)).join(" "), fill: "none", "stroke-width": 1.75,
          "stroke-linejoin": "round", "stroke-linecap": "round" }),
        sv("circle", { cx: x(v.length - 1).toFixed(1), cy: y(v[v.length - 1]).toFixed(1), r: 2.4 }));
    }
    function readPill(read) {
      if (!read) return h("span", { class: "bd-mute" }, "—");
      return h("span", { class: "bd-pill bd-" + read.lean }, h("i"), leans[read.lean]);
    }
    function rowFor(r) {
      const on = state.open === r.key;
      const tr = h("tr", { class: "bd-row" + (on ? " on" : ""), tabindex: "0", "aria-expanded": on ? "true" : "false",
        onclick: () => toggle(r.key), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(r.key); } } },
      h("td", { class: "bd-name" }, h("b", null, r.name), h("small", null, r.sub,
        r.kind === "market" && r.newCount ? h("span", { class: "bd-new" }, " · " + r.newCount + " new") : null)),
      h("td", { class: "n bd-price", "data-l": "Price" }, r.priceText ? [h("b", null, r.priceText), h("small", null, r.priceNote)]
        : h("small", null, r.kind === "property" ? "Not valued yet" : "Too few sales")),
      h("td", { class: "n bd-chg", "data-l": "Change" }, r.move ? [h("b", { class: "bd-" + r.move.dir }, r.move.text), h("small", null, r.changeNote)]
        : h("span", { class: "bd-mute" }, "—")),
      h("td", { class: "bd-trend", "data-l": "Trend" }, sparkSvg(r.spark)),
      h("td", { class: "bd-read", "data-l": "Buying" }, readPill(r.read)),
      h("td", { class: "bd-cv", "aria-hidden": "true" }, "›"));
      return on ? [tr, h("tr", { class: "bd-open" }, h("td", { colspan: "6" }, r.kind === "market" ? marketPane(r) : propertyPane(r)))] : [tr];
    }
    function marketPane(r) {
      const item = (state.feed || []).find((x) => String(x.id) === String(r.id)) || {};
      const out = [];
      if (r.read) {
        out.push(h("div", { class: "bd-why" }, h("h4", null, "Buying: " + leans[r.read.lean]),
          h("ul", null, r.read.reasons.map((x) => h("li", null, h("b", { "aria-hidden": "true" }, x.dir === "down" ? "▼" : x.dir === "up" ? "▲" : "■"), x.text)))));
      }
      const facts = [];
      if (Array.isArray(item.spark) && item.spark.length) facts.push("Trend: quarterly median sale $/SF, " + item.spark[0].label + " to " + item.spark[item.spark.length - 1].label);
      if (item.demand && item.demand.viewers) facts.push(item.demand.viewers + " " + (item.demand.viewers === 1 ? "person" : "people") + " searched here in " + (item.demand.window_days || 30) + " days");
      if (facts.length) out.push(h("p", { class: "bd-mute" }, facts.join(" · ")));
      const comps = Array.isArray(item.comps) ? item.comps : [];
      if (comps.length) {
        out.push(h("div", { class: "bd-tw" }, h("table", { class: "bd-comps" },
          h("thead", null, h("tr", null, h("th", null, "New comp"), h("th", null, "Deal"), h("th", null, "Date"), h("th", { class: "n" }, "Price or rate"), h("th", { class: "n" }, "$/SF"))),
          h("tbody", null, comps.map((c) => h("tr", null,
            h("td", null, /^https?:\/\//.test(String(c.source_url || "")) ? h("a", { href: c.source_url, rel: "nofollow noopener", target: "_blank" }, c.address || "") : (c.address || "")),
            h("td", null, c.transaction || ""), h("td", null, c.deal_date || ""), h("td", { class: "n" }, figure(c.price_or_rate)),
            h("td", { class: "n" }, c.price_per_sqft == null ? "" : psfLabel(c.price_per_sqft))))))));
      }
      if (item.locked_count) out.push(h("p", { class: "bd-mute" }, item.locked_count + " more new comp" + (item.locked_count === 1 ? "" : "s") + " here. ", h("a", { href: "/desk" }, "See your plan"), " to see them all."));
      out.push(h("div", { class: "bd-acts" },
        r.href ? h("a", { class: "bd-btn", href: r.href }, "Open the market page") : null,
        h("button", { type: "button", class: "bd-rm", onclick: () => removeMarket(r) }, "Remove from The Board")));
      return out;
    }
    function propertyPane(r) {
      const href = "/?property=" + encodeURIComponent(r.id);
      const out = [];
      out.push(h("p", { class: "bd-line" },
        r.priceText ? ["Likely value ", h("b", null, short(r.price)), r.low && r.high ? " · range " + short(r.low) + " to " + short(r.high) : "",
          r.checked ? " · checked " + tsLabel(r.checked) : ""] : "No value yet. Open its report and refresh it for one (a new search)."));
      if (r.stale) out.push(h("p", { class: "bd-attn" }, "Last checked over a year ago. Refresh to bring the value up to date."));
      if (r.movement) out.push(h("p", { class: "bd-line" }, r.movement, h("small", null, " From sales other people's reports found, not a new value for this building.")));
      out.push(h("div", { class: "bd-acts" },
        h("a", { class: "bd-btn", href, title: "Opens its saved report: no new search, no cost" }, "Open report"),
        h("a", { class: "bd-btn", href: href + "&refresh=1", title: "Runs a new live search for this property" }, "Refresh value"),
        h("button", { type: "button", class: "bd-btn", onclick: (e) => { e.currentTarget.disabled = true; ownIt(r); } }, "I own it"),
        h("button", { type: "button", class: "bd-rm", onclick: () => removeProperty(r) }, "Remove from The Board")));
      return out;
    }
    // On an empty Board the form IS the Board, so it has no Cancel.
    function addForm(empty) {
      const types = PROP_TYPES.map((t) => h("option", { selected: t === state.addType }, t));
      return h("form", { class: "bd-add", onsubmit: submitAdd, "aria-label": "Add to The Board" },
        h("label", { class: "bd-q" }, h("span", null, "A market or an address"),
          h("input", { type: "text", name: "q", maxlength: 300, autocomplete: "off", required: true,
            placeholder: "Boise, ID   or   1550 S Federal Way, Boise, ID" })),
        h("label", null, h("span", null, "Type"), h("select", { name: "type", onchange: (e) => { state.addType = e.target.value; } }, types)),
        h("button", { type: "submit", class: "btn bd-go" }, "Add"),
        empty ? null : h("button", { type: "button", class: "bd-lnk", onclick: () => { state.adding = false; state.msg = ""; render(); } }, "Cancel"));
    }
    function render() {
      const markets = (state.feed || []).map((it) => marketRow(it, ctx.readOf));
      const props = watched(state.portfolio, state.sites).map((w) => propertyRow(w.item, w.status));
      const rows = markets.concat(props);
      const empty = !rows.length && !state.feedErr && !state.propErr;
      const showM = state.show !== "properties", showP = state.show !== "markets";
      const head = h("div", { class: "bd-head" },
        h("div", null, h("h2", null, "The Board"), h("p", { class: "bd-sum" }, summary(rows) || "Markets you follow and properties you watch, like a watchlist.")),
        h("div", { class: "bd-tools" },
          rows.length ? h("div", { class: "bd-seg", role: "group", "aria-label": "Show" },
            [["all", "All"], ["markets", "Markets"], ["properties", "Properties"]].map(([k, t]) =>
              h("button", { type: "button", "aria-pressed": state.show === k ? "true" : "false", onclick: () => { state.show = k; render(); } }, t))) : null,
          state.adding || empty ? null : h("button", { type: "button", class: "btn bd-addbtn", onclick: () => { state.adding = true; state.msg = ""; render(); focusAdd(); } }, "+ Add to The Board")));
      const parts = [head];
      if (state.msg) parts.push(h("p", { class: "bd-msg" + (state.msgBad ? " bad" : ""), role: state.msgBad ? "alert" : "status" }, state.msg));
      if (state.adding || empty) parts.push(addForm(empty));
      if (empty) parts.push(h("p", { class: "bd-mute bd-empty" }, "Nothing on The Board yet. Add a market to follow its prices and buying conditions, or an address to watch its value."));
      if (state.feedErr) parts.push(h("p", { class: "bd-msg bad" }, state.feedErr));
      if (state.propErr) parts.push(h("p", { class: "bd-msg bad" }, state.propErr));
      if (rows.length) {
        const body = [];
        const group = (title, list, note) => {
          body.push(h("tr", { class: "bd-gh" }, h("td", { colspan: "6" }, h("b", null, title), h("span", null, String(list.length)), note ? h("small", null, note) : null)));
          list.forEach((r) => body.push(rowFor(r)));
        };
        if (showM && markets.length) group("Markets", markets, "median sale $/SF from recorded sales");
        if (showP && (props.length || state.sitesLocked)) {
          group("Properties", props, "likely value from your last check");
          if (state.sitesLocked) body.push(h("tr", { class: "bd-gh" }, h("td", { colspan: "6" }, h("small", null, "Watching properties is part of Pro. "), h("a", { href: "/desk" }, "See your plan"))));
        }
        parts.push(h("div", { class: "bd-tw" }, h("table", { class: "bd-tbl" },
          h("thead", null, h("tr", null, h("th", null, "Name"), h("th", { class: "n" }, "Price"), h("th", { class: "n" }, "Change"),
            h("th", null, "Trend"), h("th", null, "Buying"), h("th", { "aria-label": "Open" }))),
          h("tbody", null, body))));
        if (markets.some((r) => r.read)) parts.push(h("p", { class: "bd-fine" }, "Buying conditions are an automated read of public numbers: the six-month median price of recorded sales and, where one exists, the market page's direction. Values are automated estimates, not appraisals. Not investment advice."));
      }
      el.replaceChildren(...parts);
    }
    function toggle(key) { state.open = state.open === key ? "" : key; render(); }
    function focusAdd() { const i = el.querySelector('.bd-add input[name="q"]'); if (i) i.focus(); }
    function say(text, bad) { state.msg = text; state.msgBad = !!bad; }

    // ---- writing ----
    function submitAdd(e) {
      e.preventDefault();
      if (state.busy) return;
      const f = e.currentTarget, typed = f.elements.q.value, type = f.elements.type.value;
      const p = parseAdd(typed);
      if (!p.ok) { say(p.error, true); render(); focusAdd(); const i = el.querySelector('.bd-add input[name="q"]'); if (i) i.value = typed; return; }
      state.busy = true;
      const done = (text, bad) => { state.busy = false; say(text, bad); if (!bad) state.adding = false; };
      if (p.kind === "market") {
        send("POST", "/api/watchlist", { market: p.market, property_type: type }).then((r) => {
          if (r.s !== 200 && r.s !== 201) { done(r.j.error || "Couldn't add that market.", true); render(); return; }
          done(p.market + " " + type.toLowerCase() + " is on The Board.");
          return load();
        });
        return;
      }
      // Watching needs Pro (the status route's gate): said before anything is
      // written, rather than creating the item and taking it back.
      if (state.sitesLocked) { done("Watching properties is part of Pro. Markets are free to follow.", true); render(); return; }
      send("POST", "/api/portfolio", { address: p.address, propertyType: type }).then((r) => {
        if (r.s !== 200 || !r.j.id) { done(r.j.error || "Couldn't add that property.", true); render(); return; }
        const pid = r.j.id;
        const had = (state.sites || []).filter((s) => String(s.portfolio_item_id) === String(pid))
          .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0];
        // Already one the member owns: it stays on Home rather than being
        // turned into a watched one behind their back.
        if (r.j.existed && (!had || had.stage === "owned")) { done(street(p.address) + " is one you own, on Home."); return load(); }
        if (had && had.stage === "tracking") { done(street(p.address) + " is already on The Board."); return load(); }
        return send("POST", "/api/sites", { address: p.address, property_type: type, stage: "tracking", portfolio_item_id: pid }).then((s) => {
          if (s.s !== 200) {
            // Without the status the item would sit on Home as one they own:
            // a new item is taken back out, so a refusal changes nothing.
            const undo = r.j.existed ? Promise.resolve(null) : send("DELETE", "/api/portfolio?id=" + encodeURIComponent(pid));
            return undo.then(() => { done(s.j.error || "Couldn't watch that property.", true); return load(); });
          }
          done(street(p.address) + " is on The Board. Open its report and refresh it when you want a value.");
          state.open = "p:" + pid;
          return load();
        });
      });
    }
    function removeMarket(r) {
      if (!window.confirm("Remove " + r.name + " " + r.sub.toLowerCase() + " from The Board?")) return;
      send("DELETE", "/api/watchlist?id=" + encodeURIComponent(r.id)).then((x) => {
        say(x.s === 200 || x.s === 204 ? "Removed " + r.name + " " + r.sub.toLowerCase() + "." : (x.j.error || "That didn't go through. Nothing has been lost."), !(x.s === 200 || x.s === 204));
        state.open = ""; return load();
      });
    }
    function removeProperty(r) {
      if (!window.confirm("Remove " + r.name + " from The Board? Its value history goes with it.")) return;
      send("DELETE", "/api/portfolio?id=" + encodeURIComponent(r.id)).then((x) => {
        if (x.s !== 200) { say(x.j.error || "That didn't go through. Nothing has been lost.", true); render(); return; }
        return (r.statusId ? send("DELETE", "/api/sites?id=" + encodeURIComponent(r.statusId)) : Promise.resolve(null)).then(() => {
          say("Removed " + r.name + "."); state.open = ""; return load();
        });
      });
    }
    function ownIt(r) {
      send("POST", "/api/sites/update", { id: r.statusId, stage: "owned" }).then((x) => {
        if (x.s !== 200) { say(x.j.error || "That didn't save. Nothing has been lost.", true); render(); return; }
        say(r.name + " is with what you own, on Home."); state.open = ""; return load();
      });
    }

    el.replaceChildren(h("p", { class: "bd-mute" }, "Loading The Board…"));
    load();
    return { reload: load };
  }

  return { PROP_TYPES, QUARTERS, QUARTER_MIN, median, quarterSeries, pct, short, psfLabel, figure, move, street, marketOf,
    marketRow, propertyRow, watched, summary, parseAdd, mount };
});
