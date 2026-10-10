// home-map.js — the rules behind Home's map workspace (Draft C of the
// Home and Data drafts, the owner's pick on 2026-10-07: "One map").
//
// Home is one screen: a list on the left with tabs (Today, Properties,
// People) and a map on the right of every property, and of the city's
// permits when they switch those on (2026-10-08; Reports left for Messages
// that day). Comps left Home on 2026-10-09 (the owner's call: "Remove Comps
// from the Homepage"): a member's comps are on their own page, /vault, so
// Home no longer has a Comps tab, a Comps layer or a comp row. This file
// decides what goes in the lists and on the map; index.html draws them.
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
//   3. A PROPERTY IS LIVE. A property row always carries a status (Prospect,
//      LOI, Under contract, Entitlements, Owned, or Firm building; Tracking
//      too until 2026-10-09, when watched buildings moved to The Board),
//      so it can never be mistaken for a comp, a past deal (the owner's
//      wording ask, 2026-10-07). Until 2026-10-09 Home listed comps too, each
//      with its deal date and price per unit; they are /vault's now.
//
// Deals are a DEVELOPMENT FIRM's (2026-10-09, the owner's call: "Development
// firms only and integrate it into the property section of the home page").
// A deal (a user_sites row on Prospect, LOI, Under contract or Entitlements)
// is listed, dated in Today and worked on Home's Properties tab
// (home-sites.js) for a member of a development firm, and for nobody else:
// /vault's Sites tab and The Board's deal wall were removed that day. A
// status row on a held property is the property's, not a deal's, so it is
// read for anyone: Owned lists it here, Tracking puts it on The Board.
//
// Pure and dual-exported (Node for npm test, the browser global HOMEMAP for
// index.html), like valuation.js, and served with the
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
    // A development firm's deal it passed on: Properties' Passed fold only.
    passed: { label: "Passed", step: 0 },
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

  // Whether this member works deals on Home: a development firm's only.
  function dealsOn(firmKind) { return firmKind === "development"; }

  // Rule 1: every property, once. `buildings` are the firm's (GET
  // /api/org/buildings), `sites` the member's deals (GET /api/sites),
  // `portfolio` the properties they hold (GET /api/portfolio), `critical` the
  // leases read's dated list. `today` dates the next-date column. A deal is
  // listed only for a development firm (`firmKind`, dealsOn).
  function properties({ buildings = [], sites = [], portfolio = [], critical = [], today = "", firmKind = "" } = {}) {
    const deals = dealsOn(firmKind);
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
    const newestStatus = new Map();
    (Array.isArray(sites) ? sites : []).forEach((s) => {
      if (!s || s.portfolio_item_id == null) return;
      const k = String(s.portfolio_item_id), prior = newestStatus.get(k);
      if (!prior || str(s.updated_at) > str(prior.updated_at)) newestStatus.set(k, s);
    });

    (Array.isArray(sites) ? sites : []).forEach((s) => {
      if (!s || s.stage === "passed") return;
      if (ACTIVE[s.stage]) {
        if (!deals) return;
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
      // portfolio item's, with the site's stage on it, the newest status
      // where there are two. A Tracking one is a building the member
      // watches, not one they hold, and since 2026-10-09 it is on The Board
      // (board.js, on the Markets page), not here: Home is what you own,
      // manage or are buying.
      const held = s.portfolio_item_id != null ? byId.get(String(s.portfolio_item_id)) : null;
      if (!held) return;
      if (newestStatus.get(String(held.id)) !== s) return;
      usedPortfolio.add(String(held.id));
      if (s.stage === "tracking") return;
      const v = lastValue(held);
      const r = put(addressKey(held.address), held.address, {});
      if (!r) return;
      Object.assign(r, { type: held.property_type || r.type, group: "owned", stage: "owned",
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

  // The deals a development firm's member passed on, newest first: Home's
  // Properties tab folds them away under "Passed", where one can be brought
  // back. Nobody else has deals (dealsOn).
  function passedDeals({ sites = [], firmKind = "" } = {}) {
    if (!dealsOn(firmKind)) return [];
    return (Array.isArray(sites) ? sites : [])
      .filter((s) => s && s.stage === "passed" && s.portfolio_item_id == null)
      .sort((a, b) => str(b.updated_at).localeCompare(str(a.updated_at)));
  }

  // Where Home's "Add a property" takes a property that is only the member's.
  // "home": the add form opens on Home itself (a development firm's deal, or
  // a property it owns or tracks: home-sites.js). A URL: the member's own page
  // with the form already open (vault-page.js reads ?add= once). "": not
  // offered, which is a deal for anyone outside a development firm.
  function addWhere(kind, firmKind) {
    if (dealsOn(firmKind)) return "home";
    return kind === "own" ? "/vault?add=own#properties" : "";
  }

  // What needs the member: unread conversations first, then new BOV requests
  // (newest first), then every lease date inside LEASE_DAYS and every deal
  // date inside DEAL_DAYS, soonest first.
  //
  // `leads` is GET /api/broker/leads' list, which the server has already
  // anonymized to type, size, market and date: a request carries no address,
  // so like a message it has no number and no pin. It is "new" while it is
  // inside BOV_DAYS and the member has not asked for an introduction.
  // A deal's dates are a development firm's only (`firmKind`, dealsOn), and
  // its row opens the deal on Home's Properties tab.
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
        scope: "you", act: "Open your pipeline", href: "/pipeline", id: l.id });
    });
    (Array.isArray(critical) ? critical : []).forEach((c) => {
      if (!c || !c.date) return;
      const n = daysUntil(c.date, today);
      if (n == null || n < 0 || n > LEASE_DAYS) return;
      out.push({ kind: "lease", n, date: str(c.date).slice(0, 10), label: c.kind === "notice" ? "Option notice" : "Lease expires",
        who: str(c.tenant), address: str(c.address), place: street(c.address) + (c.suite ? ` · suite ${c.suite}` : ""),
        scope: "firm", act: "Open lease", href: c.buildingId != null ? `/building/${encodeURIComponent(c.buildingId)}` : "/buildings" });
    });
    (dealsOn(firmKind) && Array.isArray(sites) ? sites : []).forEach((s) => {
      if (!s || !ACTIVE[s.stage]) return;
      (Array.isArray(s.dates) ? s.dates : []).forEach((d) => {
        const n = d && d.on ? daysUntil(d.on, today) : null;
        if (n == null || n < 0 || n > DEAL_DAYS) return;
        out.push({ kind: "deal", n, date: str(d.on).slice(0, 10), label: str(d.label) || "Deal date", who: "", address: str(s.address),
          place: street(s.address) + (town(s.address) ? " · " + town(s.address) : ""), scope: "you", act: "Open deal",
          href: "/desk#properties", stage: s.stage });
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

  // ---- What the map shows (2026-10-08) -------------------------------------
  // The owner's ask: the map "shows where the properties, comps and permits
  // are, and you can filter what you want to see". Layers, any mix on; a
  // Comps layer was the third until 2026-10-09, when comps left Home, and a
  // browser that stored it on simply has it dropped here.
  // The list's tabs choose the LIST and these choose the MAP; opening a tab
  // whose rows are pins of a layer turns that layer on (tabLayer), so a row
  // never opens a card over a map that hides its pin. The choice is kept per
  // browser as JSON; anything unreadable is the default, Properties alone,
  // which is how Draft C drew the switch and so the calm first map.
  const LAYERS = ["properties", "permits"];
  const LAYER_DEFAULT = Object.freeze({ properties: true, permits: false });
  function readLayers(raw) {
    let o = raw;
    if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (_) { o = null; } }
    const out = { ...LAYER_DEFAULT };
    if (o && typeof o === "object") LAYERS.forEach((k) => { if (typeof o[k] === "boolean") out[k] = o[k]; });
    return out;
  }
  // Today draws its own numbered pins whatever the layers say (they are its
  // rows), and People has no pins, so neither turns anything on.
  function tabLayer(tab) { return tab === "properties" ? "properties" : null; }

  // A permit as a pin: GET /api/permits/map's filing (public record, from the
  // sweep), cut to what its pin and card show. No place, no pin: the
  // tracker's list still carries a filing the parcel layer could not place.
  // The stage words are the tracker's own (⚠ permits-page.js STAGE_NAMES;
  // test/home-map.test.js holds the two together), with the portal's raw
  // status always shown beside them, the tracker's rule.
  const PERMIT_STAGES = { open: "Open", attention: "Needs attention", approved: "Approved", issued: "Issued or finaled", ended: "Ended" };
  // A portal prints "1450 S EAGLE RD"; the tracker shows "1450 S Eagle Rd",
  // keeping directions, the state and anything with a digit (⚠ permits-page.js
  // tidy(); test/home-map.test.js runs both on the same inputs). Display only:
  // matching reads the raw text through addressKey, which ignores case.
  function tidyCaps(s) {
    s = str(s);
    if (!s || /[a-z]/.test(s)) return s;
    return s.replace(/[A-Z0-9][A-Z0-9'.&-]*/g, (w) => {
      if (/^(N|S|E|W|NE|NW|SE|SW|ID|PO|US)$/.test(w)) return w;
      if (/[0-9]/.test(w)) return w.toLowerCase();
      return w.charAt(0) + w.slice(1).toLowerCase();
    });
  }
  function permitPin(f) {
    if (!f || f.id == null) return null;
    const lat = num(f.lat), lng = num(f.lng);
    if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;
    return {
      id: str(f.id), number: str(f.permitNumber), type: str(f.type) || "Building permit",
      what: str(f.projectName) || str(f.description), street: tidyCaps(street(f.address)), city: str(f.city),
      status: str(f.status), stage: PERMIT_STAGES[f.stage] ? f.stage : "open", filed: str(f.appliedDate).slice(0, 10),
      href: /^https?:\/\//i.test(str(f.sourceUrl)) ? str(f.sourceUrl) : "",
      applicant: str(f.applicant), contractor: str(f.contractor),
      board: f.onBoard && f.onBoard.address ? { id: f.onBoard.id, address: str(f.onBoard.address) } : null,
      lat, lng,
    };
  }
  function permitStageLabel(stage) { return PERMIT_STAGES[stage] || PERMIT_STAGES.open; }
  // The property a permit was filed at: the same street line in the same
  // city, the sweep's own rule (permit-filings.js matches the street line and
  // the jurisdiction) restated over Home's rows. Strict, like it: "Rd" and
  // "Road" are two streets, and a miss is a miss rather than a guess.
  function permitAt(pin, rows) {
    if (!pin || !pin.street || !pin.city) return null;
    const key = addressKey(pin.street + ", " + pin.city);
    return (Array.isArray(rows) ? rows : []).find((r) => r && addressKey(street(r.address) + ", " + town(r.address)) === key) || null;
  }

  // What the map says under the switch when a layer that is on has nothing
  // to draw where the member is looking. Never a silent empty layer: a map
  // with no permit pins must not read as "nothing was filed" when the truth
  // is "we do not read this city" (permits.md, §7) or "the read failed".
  // `permits` is null while unread and false when the read failed; `show`
  // says whether "Show them" can bring the pins into view.
  function layerNotes({ layers = {}, permits = null, permitsFiled = 0, permitsInView = 0,
    cities = "", windowDays = 30 } = {}) {
    const out = [];
    if (layers.permits) {
      const where = str(cities) || "the cities CompNinja reads";
      const days = `the last ${windowDays} days`;
      if (permits === false) out.push({ layer: "permits", text: "Couldn't read permits just now. Try again in a moment.", show: false });
      else if (Array.isArray(permits) && !permits.length) {
        out.push({ layer: "permits", show: false, text: permitsFiled
          ? `None of the ${permitsFiled} permits filed in ${where} in ${days} has a map location yet.`
          : `No commercial permits were filed in ${where} in ${days}.` });
      } else if (Array.isArray(permits) && !permitsInView) {
        out.push({ layer: "permits", show: true, text: `No permits filed in this part of the map in ${days}. CompNinja reads permits in ${where}.` });
      }
    }
    return out;
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
    stageLabel, stageStep, lastValue, dealsOn, properties, scopeOf, passedDeals, addWhere, agenda, thisWeek, statusLine,
    LAYERS, LAYER_DEFAULT, readLayers, tabLayer, PERMIT_STAGES, tidyCaps, permitPin, permitStageLabel, permitAt, layerNotes };
});
