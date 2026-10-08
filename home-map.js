// home-map.js — the rules behind Home's map workspace (Draft C of the
// Home and Data drafts, the owner's pick on 2026-10-07: "One map").
//
// Home is one screen: a list on the left with tabs (Today, Properties,
// Comps, Reports, People) and every property on a map on the right. This
// file decides what goes in the lists; index.html draws them.
//
// Three rules carry the design, and each is tested:
//
//   1. ONE ROW PER PROPERTY. A building on the firm's list, a deal the member
//      is working on and a property they own can be the same address. Today
//      that address shows up on Home (the firm's buildings) and again on Data
//      (the deals and holdings), with different facts on each. Here it is one
//      row that knows both: `firm` (the firm can see the address, size and
//      lease dates) and `you` (the member's own deal stage or value, which
//      stays private to them). Matching is deliberately strict (the street
//      and the city, case and punctuation aside), so two different buildings
//      are never folded into one; at worst one building shows twice.
//
//   2. EVERY ROW SAYS WHO CAN SEE IT. `scopeOf` answers "firm", "you" or
//      "both". The privacy wall itself is unchanged: these are separate reads
//      the server already scopes, joined only in this member's own browser.
//
//   3. A PROPERTY IS LIVE, A COMP IS PAST. A property row always carries a
//      status (Prospect, LOI, Under contract, Entitlements, Owned, Tracking,
//      or Firm building). A comp row always carries its deal date and its
//      price per unit, so the two can never be mistaken for each other (the
//      owner's wording ask, 2026-10-07).
//
// Pure and dual-exported (Node for npm test, the browser global HOMEMAP for
// index.html), like firm-skyline.js and valuation.js, and served with the
// same maxAge: 0 rule. No clock reads: callers pass `today` as YYYY-MM-DD.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HOMEMAP = api;
})(typeof self !== "undefined" ? self : this, function () {
  const LEASE_DAYS = 90;   // a lease date inside this "needs you" (the old agenda's window)
  const DEAL_DAYS = 30;    // a deal date inside this "needs you"
  const BOV_DAYS = 14;     // a BOV request received inside this, not yet answered, "needs you"
  const WEEK_DAYS = 7;
  const DAY_MS = 86400000;
  const ACTIVE = { prospect: 1, loi: 1, contract: 1, entitle: 1 };
  const STAGES = {
    prospect: { label: "Prospect", step: 1 },
    loi: { label: "LOI", step: 2 },
    contract: { label: "Under contract", step: 3 },
    entitle: { label: "Entitlements", step: 4 },
    owned: { label: "Owned", step: 5 },
    tracking: { label: "Tracking", step: 0 },
    firm: { label: "Firm building", step: 0 },
  };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const str = (v) => (v == null ? "" : String(v));
  // null and "" are "no value", never 0: Number(null) is 0 and finite, which
  // is how unlocated buildings once landed on Null Island (server.js's
  // attachPropertyCoords tells that story).
  const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

  // "725 W Franklin Rd, Meridian, ID 83642" -> "725 w franklin rd|meridian".
  // Street and city only: a ZIP or a state written two ways must not split
  // one building in two, and a different street number must never merge.
  function addressKey(address) {
    const parts = str(address).toLowerCase().split(",").map((p) => p.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
    if (!parts[0]) return "";
    return parts[0] + "|" + (parts[1] || "");
  }
  function street(address) { return str(address).split(",")[0].trim(); }
  // "Meridian, ID" from "725 W Franklin Rd, Meridian, ID 83642".
  function place(address) {
    const p = str(address).split(",").map((x) => x.trim()).filter(Boolean);
    if (p.length < 2) return "";
    const state = p[2] ? p[2].split(/\s+/)[0] : "";
    return p[1] + (state ? ", " + state : "");
  }
  function town(address) { return (str(address).split(",")[1] || "").trim(); }

  // Whole days from `today` to `iso` (both YYYY-MM-DD; time of day ignored).
  function daysUntil(iso, today) {
    const a = Date.parse(str(iso).slice(0, 10) + "T00:00:00Z");
    const b = Date.parse(str(today).slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((a - b) / DAY_MS);
  }
  function shortDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso));
    return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "";
  }
  function inDays(n) {
    if (n == null) return "";
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n === -1) return "yesterday";
    if (n < 0) return `${-n} days ago`;
    return `in ${n} days`;
  }
  function money(v) {
    const n = num(v);
    if (n == null || n <= 0) return "";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }
  function stageLabel(stage) { return (STAGES[stage] || { label: "" }).label; }
  function stageStep(stage) { return (STAGES[stage] || { step: 0 }).step; }

  // The newest valuation on a held property, and its change since the first.
  function lastValue(item) {
    const s = Array.isArray(item && item.snapshots) ? item.snapshots.filter((x) => x && num(x.likely)) : [];
    if (!s.length) return { value: null, change: null };
    const first = num(s[0].likely), last = num(s[s.length - 1].likely);
    return { value: last, change: s.length > 1 && first ? (last - first) / first : null };
  }

  // Rule 1: every property, once. `buildings` are the firm's (GET
  // /api/org/buildings), `sites` the member's deals (GET /api/sites),
  // `portfolio` the properties they hold (GET /api/portfolio), `critical` the
  // leases read's dated list. `today` dates the next-date column.
  function properties({ buildings = [], sites = [], portfolio = [], critical = [], today = "" } = {}) {
    const rows = new Map();
    const put = (key, address, base) => {
      if (!key) return null;
      if (!rows.has(key)) rows.set(key, { key, address, type: "", group: "", stage: "", firm: false, you: false,
        buildingId: null, siteId: null, portfolioId: null, acres: null, size: null, value: null, valueNote: "",
        change: null, next: null, lat: null, lng: null, ...base });
      return rows.get(key);
    };
    const byId = new Map();
    (Array.isArray(portfolio) ? portfolio : []).forEach((p) => { if (p && p.id != null) byId.set(String(p.id), p); });
    const usedPortfolio = new Set();

    (Array.isArray(sites) ? sites : []).forEach((s) => {
      if (!s || s.stage === "passed") return;
      if (ACTIVE[s.stage]) {
        const upcoming = (Array.isArray(s.dates) ? s.dates : [])
          .filter((d) => d && d.on && daysUntil(d.on, today) != null && daysUntil(d.on, today) >= 0)
          .sort((a, b) => str(a.on).localeCompare(str(b.on)))[0];
        const r = put(addressKey(s.address), s.address, {});
        if (!r) return;
        Object.assign(r, { type: s.property_type || r.type, group: "buying", stage: s.stage, you: true, siteId: s.id,
          acres: num(s.acres), value: num(s.asking_price), valueNote: num(s.asking_price) ? "asking" : "",
          next: upcoming ? { on: str(upcoming.on).slice(0, 10), label: str(upcoming.label) } : null });
        return;
      }
      // Owned and Tracking are the STATUS of a held property: the row is the
      // portfolio item's, with the site's stage on it.
      const held = s.portfolio_item_id != null ? byId.get(String(s.portfolio_item_id)) : null;
      if (!held) return;
      usedPortfolio.add(String(held.id));
      const v = lastValue(held);
      const r = put(addressKey(held.address), held.address, {});
      if (!r) return;
      Object.assign(r, { type: held.property_type || r.type, group: "owned", stage: s.stage === "tracking" ? "tracking" : "owned",
        you: true, siteId: s.id, portfolioId: held.id, value: v.value, valueNote: v.value ? "likely value" : "", change: v.change });
    });
    byId.forEach((p, id) => {
      if (usedPortfolio.has(id)) return;
      const v = lastValue(p);
      const r = put(addressKey(p.address), p.address, {});
      if (!r || r.group === "buying") return;
      Object.assign(r, { type: p.property_type || r.type, group: "owned", stage: "owned", you: true, portfolioId: p.id,
        value: v.value, valueNote: v.value ? "likely value" : "", change: v.change });
    });

    const leaseNext = new Map();
    (Array.isArray(critical) ? critical : []).forEach((c) => {
      if (!c || c.buildingId == null || !c.date) return;
      const prev = leaseNext.get(String(c.buildingId));
      if (!prev || str(c.date) < str(prev.date)) leaseNext.set(String(c.buildingId), c);
    });
    (Array.isArray(buildings) ? buildings : []).forEach((b) => {
      if (!b) return;
      const r = put(addressKey(b.address), b.address, { group: "firm", stage: "firm" });
      if (!r) return;
      r.firm = true;
      r.buildingId = b.id;
      if (!r.type) r.type = str(b.type);
      if (num(b.sizeSqft)) r.size = num(b.sizeSqft);
      if (num(b.lat) != null && num(b.lng) != null && !(num(b.lat) === 0 && num(b.lng) === 0)) { r.lat = num(b.lat); r.lng = num(b.lng); }
      const c = leaseNext.get(String(b.id));
      if (c && (!r.next || str(c.date) < r.next.on)) {
        r.next = { on: str(c.date).slice(0, 10), label: (c.kind === "notice" ? "Option notice" : "Lease expires") + (c.tenant ? " · " + c.tenant : "") };
      }
    });

    const order = { buying: 0, owned: 1, firm: 2 };
    return [...rows.values()].sort((a, b) => {
      if (order[a.group] !== order[b.group]) return order[a.group] - order[b.group];
      const x = a.next ? a.next.on : "9999", y = b.next ? b.next.on : "9999";
      if (x !== y) return x < y ? -1 : 1;
      return street(a.address).localeCompare(street(b.address));
    });
  }

  // Rule 2.
  function scopeOf(row) {
    if (row && row.firm && row.you) return "both";
    return row && row.firm ? "firm" : "you";
  }

  // Where the member's own deals are listed on their private page. A
  // development firm has a Sites tab for them; for everyone else they are the
  // deal wall on The Board, because vault-page.js's applyShop hides Sites from
  // anyone outside a development firm and a #sites link would land on Comps.
  function dealsHref(firmKind) { return firmKind === "development" ? "/vault#sites" : "/vault#board"; }

  // Where Home's "Add a property" sends a property that is only the member's,
  // with the right form already open (vault-page.js reads ?add= once). A
  // deal ("buy") is added where deals are listed (dealsHref); a property
  // they own ("own") goes to Properties, except that a development firm's
  // Sites tab takes both, with "I own it" picked.
  function addHref(kind, firmKind) {
    const own = kind === "own";
    if (firmKind === "development") return `/vault?add=${own ? "own" : "buy"}#sites`;
    return own ? "/vault?add=own#properties" : "/vault?add=buy#board";
  }

  // What needs the member: unread conversations first, then new BOV requests
  // (newest first), then every lease date inside LEASE_DAYS and every deal
  // date inside DEAL_DAYS, soonest first.
  //
  // `leads` is GET /api/broker/leads' list, which the server has already
  // anonymized to type, size, market and date: a request carries no address,
  // so like a message it has no number and no pin. It is "new" while it is
  // inside BOV_DAYS and the member has not asked for an introduction.
  // `firmKind` decides where a deal's row links (dealsHref).
  function agenda({ critical = [], threads = [], sites = [], leads = [], firmKind = "", today = "" } = {}) {
    const out = [];
    (Array.isArray(threads) ? threads : []).forEach((t) => {
      if (!t || !t.unread) return;
      out.push({ kind: "msg", n: -1, date: "", label: str(t.label) || "A conversation", who: str(t.label), address: "",
        place: str(t.preview), scope: "firm", act: "Reply", href: "/messages" });
    });
    (Array.isArray(leads) ? leads : []).forEach((l) => {
      if (!l || l.intro_requested) return;
      const n = daysUntil(l.ts, today);
      if (n == null || n < -BOV_DAYS) return;
      const size = num(l.size_sqft);
      // The caller hands `ts` over as the member's own date (index.html's
      // hmLocalDay); a raw UTC stamp from this evening could still read as
      // tomorrow, and a request is never in the future: it is today.
      out.push({ kind: "bov", n: Math.min(n, 0), date: str(l.ts).slice(0, 10), label: "BOV request", who: l.is_1031 ? "1031 exchange" : "",
        address: "", place: [str(l.type), size ? `${Math.round(size).toLocaleString("en-US")} SF` : "", str(l.market)].filter(Boolean).join(" · "),
        scope: "you", act: "Open your pipeline", href: "/vault#pipeline", id: l.id });
    });
    (Array.isArray(critical) ? critical : []).forEach((c) => {
      if (!c || !c.date) return;
      const n = daysUntil(c.date, today);
      if (n == null || n < 0 || n > LEASE_DAYS) return;
      out.push({ kind: "lease", n, date: str(c.date).slice(0, 10), label: c.kind === "notice" ? "Option notice" : "Lease expires",
        who: str(c.tenant), address: str(c.address), place: street(c.address) + (c.suite ? ` · suite ${c.suite}` : ""),
        scope: "firm", act: "Open lease", href: c.buildingId != null ? `/building/${encodeURIComponent(c.buildingId)}` : "/buildings" });
    });
    (Array.isArray(sites) ? sites : []).forEach((s) => {
      if (!s || !ACTIVE[s.stage]) return;
      (Array.isArray(s.dates) ? s.dates : []).forEach((d) => {
        const n = d && d.on ? daysUntil(d.on, today) : null;
        if (n == null || n < 0 || n > DEAL_DAYS) return;
        out.push({ kind: "deal", n, date: str(d.on).slice(0, 10), label: str(d.label) || "Deal date", who: "", address: str(s.address),
          place: street(s.address) + (town(s.address) ? " · " + town(s.address) : ""), scope: "you", act: "Open deal",
          href: dealsHref(firmKind), stage: s.stage });
      });
    });
    const rank = (x) => (x.kind === "msg" ? 0 : x.kind === "bov" ? 1 : 2);
    out.sort((a, b) => (rank(a) - rank(b)) || (a.kind === "bov" ? b.n - a.n : a.n - b.n) || a.label.localeCompare(b.label));
    // Pins carry the same number as their row; a message and a BOV request
    // have no address and so no number.
    let k = 0;
    out.forEach((x) => { x.num = x.kind === "msg" || x.kind === "bov" ? null : ++k; });
    return out;
  }
  function thisWeek(items) { return (Array.isArray(items) ? items : []).filter((x) => x.n <= WEEK_DAYS).length; }

  // Rule 3: a comp is a past deal, said the same way every time.
  function compRow(c) {
    if (!c) return null;
    const lease = str(c.transaction).toLowerCase() === "lease";
    const land = str(c.property_type) === "Land";
    let figure = "";
    if (lease) {
      const r = num(c.rent_psf_yr) != null ? num(c.rent_psf_yr) : (num(c.rent_psf) != null ? num(c.rent_psf) * (str(c.rent_basis) === "monthly" ? 12 : 1) : null);
      if (r != null) figure = `$${r.toFixed(2)}/SF/yr`;
    } else if (land && num(c.price_per_acre)) {
      figure = `${money(c.price_per_acre)}/acre`;
    } else if (num(c.price_per_sqft)) {
      figure = `$${Math.round(num(c.price_per_sqft))}/SF`;
    }
    const size = num(c.lot_acres) && land ? `${num(c.lot_acres)} ac` : (num(c.size_sqft) ? `${Math.round(num(c.size_sqft)).toLocaleString("en-US")} SF` : "");
    const m = /^(\d{4})-(\d{2})/.exec(str(c.deal_date));
    return {
      id: c.id, address: str(c.address), street: street(c.address), place: place(c.address),
      type: str(c.property_type), deal: lease ? "Lease" : "Sale",
      when: m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "", whenIso: str(c.deal_date).slice(0, 10),
      figure, price: lease ? "" : money(c.price), size,
      lat: num(c.lat), lng: num(c.lng),
    };
  }

  // The line under the greeting: one sentence of status, never a description
  // of the page (workspace.md's rule for the banner it replaces).
  function statusLine({ items = [], hasFirm = false, propertyCount = 0 } = {}) {
    const week = thisWeek(items);
    if (week) return `${week} ${week === 1 ? "thing" : "things"} this week. Each one with an address is numbered on the map.`;
    if (items.length) return `Nothing due this week. ${items.length} ${items.length === 1 ? "date" : "dates"} coming up.`;
    if (propertyCount) return "Nothing needs you right now.";
    return hasFirm ? "Add your first property and it shows up here, on the map." : "Everything you add lands on this map.";
  }

  return { LEASE_DAYS, DEAL_DAYS, BOV_DAYS, WEEK_DAYS, STAGES, addressKey, street, place, town, daysUntil, shortDate, inDays, money,
    stageLabel, stageStep, lastValue, properties, scopeOf, dealsHref, addHref, agenda, thisWeek, compRow, statusLine };
});
