// building-day.js — which of the firm's own buildings opens the Workspace
// this morning, and the reason written on the picture (Draft C of the banner
// drafts, the owner's pick on 2026-09-25: "a building a day").
//
// The banner shows one building on the firm's board from above, picked for
// a reason a member would act on, with that reason on the picture. This file
// is the rule; index.html draws it. It decides from what the desk ALREADY
// read — the buildings list, the leases read's `critical` dates and the
// firm shelf — so the banner costs no read of its own (bootFetch hands each
// embedded answer to its first caller, and a second reader of any of those
// routes would cost a live round trip on every first paint).
//
// Pure and dual-exported (Node for npm test, the browser global BUILDINGDAY
// for index.html), like valuation.js and explore-query.js, and served with
// the same maxAge: 0 rule: a stale copy against a newer index.html is the
// failure nobody detects. No clock reads: the caller passes `now`.
//
// Four rules, all tested:
//   - ONLY a building with a location is ever shown. A building with no
//     coordinates cannot be pictured from above, and guessing one from its
//     city would put somebody else's roof under the firm's name.
//   - The morning's pick, in order: a lease date inside DUE_DAYS (soonest
//     first); else the newest building added inside NEW_DAYS; else the one
//     with the most reports on the shelf inside REPORT_DAYS; else the next in
//     line by the day of the year, so a quiet board still turns over daily.
//   - Every other located building follows the pick, so the banner's arrows
//     flip through the whole board, each with its own reason.
//   - The reason is text a person typed (a tenant, a colleague's name), so
//     reasonText returns plain strings for textContent, never markup.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BUILDINGDAY = api;
})(typeof self !== "undefined" ? self : this, function () {
  const DUE_DAYS = 90;      // the agenda's window: a date inside it "needs you"
  const NEW_DAYS = 14;      // "new on the board"
  const REPORT_DAYS = 30;   // the shelf's "lately"
  const DAY_MS = 86400000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function str(v) { return v === null || v === undefined ? "" : String(v); }
  function num(v) { return v === null || v === undefined || v === "" ? NaN : Number(v); }

  // A building we can picture: both coordinates, finite and on the planet.
  function located(b) {
    if (!b) return false;
    const lat = num(b.lat), lng = num(b.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }

  function msOf(iso) {
    const t = Date.parse(str(iso));
    return Number.isFinite(t) ? t : NaN;
  }
  function nowMs(now) {
    const t = now instanceof Date ? now.getTime() : Number(now);
    return Number.isFinite(t) ? t : NaN;
  }
  // The day-of-the-year counter the quiet-board rotation turns on: whole days
  // since the epoch in the viewer's own zone, so it changes at their midnight
  // (the greeting's clock), not at UTC's.
  function dayNumber(now) {
    const d = now instanceof Date ? now : new Date(nowMs(now));
    if (!Number.isFinite(d.getTime())) return 0;
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY_MS);
  }
  // "Sep 22", in UTC, with no locale: a stored timestamp names a calendar day,
  // and the same building must read the same date on every machine.
  function shortDate(iso) {
    const t = msOf(iso);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  }

  // Reports on the shelf that name this building: the exact address, any
  // case — decorateBuildingRows' rule, so the banner and the Shelf column can
  // never count one building differently. It misses a report typed another
  // way rather than guessing, so a count can be low and never high.
  function reportsFor(b, shelf, now, days) {
    const want = str(b && b.address).trim().toLowerCase();
    if (!want) return 0;
    const since = nowMs(now) - days * DAY_MS;
    let n = 0;
    for (const s of Array.isArray(shelf) ? shelf : []) {
      if (str(s && s.address).trim().toLowerCase() !== want) continue;
      const t = msOf(s.createdAt);
      if (Number.isFinite(t) && t >= since) n += 1;
    }
    return n;
  }

  // The soonest lease date inside DUE_DAYS for each building, off the leases
  // read's `critical` list (already soonest-first and already windowed to a
  // year, so this only narrows it).
  function dueByBuilding(critical) {
    const out = new Map();
    for (const c of Array.isArray(critical) ? critical : []) {
      const id = str(c && c.buildingId);
      const days = Number(c && c.days);
      if (!id || !Number.isFinite(days) || days < 0 || days > DUE_DAYS) continue;
      const cur = out.get(id);
      if (!cur || days < cur.days) {
        out.set(id, { kind: c.kind === "notice" ? "notice" : "expiry", tenant: str(c.tenant).trim(), days });
      }
    }
    return out;
  }

  // One building's own reason, the same ladder as the pick.
  function reasonFor(b, ctx) {
    const due = ctx.due.get(str(b.id));
    if (due) return { kind: "due", what: due.kind, tenant: due.tenant, days: due.days };
    const added = msOf(b.createdAt);
    if (Number.isFinite(added) && ctx.now - added <= NEW_DAYS * DAY_MS && added <= ctx.now + DAY_MS) {
      return { kind: "new", mine: b.mine === true, addedBy: str(b.addedBy).trim(), date: shortDate(b.createdAt),
        reports: reportsFor(b, ctx.shelf, ctx.now, REPORT_DAYS) };
    }
    const n = reportsFor(b, ctx.shelf, ctx.now, REPORT_DAYS);
    if (n > 0) return { kind: "reports", count: n };
    return { kind: "since", date: shortDate(b.createdAt) };
  }

  const byAddress = (a, b) => str(a.address).localeCompare(str(b.address)) || str(a.id).localeCompare(str(b.id));

  /**
   * The banner's running order for this morning.
   * @param {object} input { buildings, critical, shelf, now }
   * @returns {Array<{ building: object, reason: object, picked: boolean }>}
   *   the day's pick first (picked: true), then every other located building
   *   by address. Empty when nothing on the board has a location.
   */
  function orderForDay(input) {
    const src = input || {};
    const now = nowMs(src.now);
    if (!Number.isFinite(now)) return [];
    const list = (Array.isArray(src.buildings) ? src.buildings : []).filter(located).slice().sort(byAddress);
    if (!list.length) return [];
    const ctx = { now, shelf: src.shelf, due: dueByBuilding(src.critical) };
    const reasons = new Map(list.map((b) => [b, reasonFor(b, ctx)]));

    const due = list.filter((b) => reasons.get(b).kind === "due")
      .sort((a, b) => reasons.get(a).days - reasons.get(b).days || byAddress(a, b));
    const fresh = list.filter((b) => reasons.get(b).kind === "new")
      .sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt) || byAddress(a, b));
    const active = list.filter((b) => reasons.get(b).kind === "reports")
      .sort((a, b) => reasons.get(b).count - reasons.get(a).count || byAddress(a, b));
    const pick = due[0] || fresh[0] || active[0] ||
      list[((dayNumber(new Date(now)) % list.length) + list.length) % list.length];

    return [pick].concat(list.filter((b) => b !== pick))
      .map((b) => ({ building: b, reason: reasons.get(b), picked: b === pick }));
  }

  // The sentence on the picture. `lead` is the part the banner sets in the
  // alert colour (the date that is due), `rest` the plain remainder, so the
  // page can write both with textContent.
  function reasonText(reason) {
    const r = reason || {};
    if (r.kind === "due") {
      const when = r.days === 0 ? "today" : r.days === 1 ? "tomorrow" : `in ${r.days} days`;
      const who = r.tenant ? ` for ${r.tenant}` : "";
      return r.what === "notice"
        ? { rest: `The option notice${who} is due `, lead: when + "." }
        : { rest: `The lease${who} expires `, lead: when + "." };
    }
    if (r.kind === "new") {
      const by = r.mine ? "you" : r.addedBy;
      const base = by ? `New on the board, added by ${by}${r.date ? " on " + r.date : ""}.` :
        `New on the board${r.date ? " since " + r.date : ""}.`;
      const shelf = r.reports ? ` ${r.reports} ${r.reports === 1 ? "report" : "reports"} on the shelf already.` : "";
      return { rest: base + shelf, lead: "" };
    }
    if (r.kind === "reports") {
      return { rest: `${r.count} ${r.count === 1 ? "report" : "reports"} on the firm's shelf in the last ${REPORT_DAYS} days.`, lead: "" };
    }
    return { rest: r.date ? `On the board since ${r.date}.` : "On the firm's board.", lead: "" };
  }

  /**
   * An Esri World Imagery export — the source the market pages already fall
   * back to — framed so (lat, lng) lands at (fx, fy) of a width x height
   * picture about groundMeters across. The bbox is in Web Mercator (3857), so
   * the picture is never stretched: Esri fits a bbox whose aspect disagrees
   * with the size by widening it, which would move the point off its mark.
   */
  function aerialUrl(o) {
    const lat = num(o && o.lat), lng = num(o && o.lng);
    const width = Math.max(1, Math.round(num(o && o.width) || 0));
    const height = Math.max(1, Math.round(num(o && o.height) || 0));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) >= 85) return "";
    const ground = num(o.groundMeters) > 0 ? num(o.groundMeters) : 460;
    const fx = Number.isFinite(num(o.fx)) ? num(o.fx) : 0.5;
    const fy = Number.isFinite(num(o.fy)) ? num(o.fy) : 0.5;
    const R = 6378137, rad = Math.PI / 180;
    const x = R * lng * rad;
    const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
    const perPx = ground / Math.cos(lat * rad) / width;
    const xmin = x - fx * width * perPx;
    const ymax = y + fy * height * perPx;
    const box = [xmin, ymax - height * perPx, xmin + width * perPx, ymax].map((v) => v.toFixed(2)).join(",");
    // Esri refuses an export past 4096 on a side.
    const k = Math.min(1, 4096 / Math.max(width, height));
    return "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
      `?bbox=${box}&bboxSR=3857&imageSR=3857&size=${Math.round(width * k)},${Math.round(height * k)}&format=jpg&f=image`;
  }

  return { DUE_DAYS, NEW_DAYS, REPORT_DAYS, located, dayNumber, shortDate, orderForDay, reasonText, aerialUrl };
});
