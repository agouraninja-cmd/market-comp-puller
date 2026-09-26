// firm-skyline.js — the Workspace banner drawn as the firm's own skyline
// (Draft B of the banner drafts, the owner's pick on 2026-09-25: "your
// firm's skyline").
//
// Every building on the firm's board is a tower. Its height is the
// building's size, its lit windows are recent work on it, a red light is a
// lease date inside 90 days, a crane is a building added this month, and the
// newest buildings rise on the right, so the skyline grows as the firm does.
// The sky follows the time of day, on the greeting's own boundaries.
//
// This file is the rule; index.html draws it. It decides from what the desk
// ALREADY read — the buildings list, the leases read's `critical` dates and
// the firm shelf — so the banner costs no read of its own (bootFetch hands
// each embedded answer to its first caller, and a second reader of any of
// those routes would cost a live round trip on every first paint).
//
// Pure and dual-exported (Node for npm test, the browser global SKYLINE for
// index.html), like valuation.js, and served with the same maxAge: 0 rule: a
// stale copy against a newer index.html is the failure nobody detects. No
// clock reads: the caller passes `now`.
//
// Each property type is its own kind of building (the owner, 2026-09-26: "for
// residential make it a house, and a different type of building for each
// property type"): an office is a tower with a stepped crown, industrial a
// sawtooth-roofed warehouse, retail a storefront under an awning,
// multifamily an apartment block with balconies, residential a house, and
// land an open lot with a fence, a sign and a tree. A building with no type
// is the plain tower it always was. shapeFor names the shape, PROPORTIONS
// says how each carries its size, and index.html draws it.
//
// What "worked on lately" means is deliberately narrow, and the key on the
// banner says so: a report on the firm's shelf naming the building in the
// last 30 days, the building being added in the last 30 days, or a lease
// date inside 90 days. CompNinja does not know a firm's revenue or its deals
// won (each broker's won/lost list is private to them), so the skyline never
// pretends to show either.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SKYLINE = api;
})(typeof self !== "undefined" ? self : this, function () {
  const DUE_DAYS = 90;       // the agenda's window: a date inside it "needs you"
  const ACTIVE_DAYS = 30;    // "lately"
  const DAY_MS = 86400000;
  const SMALL_SF = 6000;     // the shortest tower
  const TALL_FLOOR_SF = 60000; // a board of small buildings is not drawn as towers
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // The vault's PROPERTY_TYPES, each drawn as its own building. Anything
  // else — no type, or a type this list has not met — is the plain tower.
  const SHAPE_OF = { office: "office", industrial: "warehouse", retail: "store",
    multifamily: "apartments", residential: "house", land: "lot" };
  function shapeFor(type) { return SHAPE_OF[str(type).trim().toLowerCase()] || "tower"; }

  // How each shape carries its size. `floor` is the shortest it is drawn
  // (px), `tall` the share of the room's height its largest reaches, and
  // `wide` how much broader it stands than a tower of the same size. A tower
  // grows up; a warehouse and a store grow out; a house stays house-sized.
  // Size still decides every one of them — only the proportions differ —
  // so a building is never drawn smaller than a smaller one of its own type
  // (below SMALL_SF they are all the smallest, which is where most houses
  // sit: a house stays a house).
  const PROPORTIONS = {
    tower: { floor: 34, tall: 1, wide: 1 },
    office: { floor: 34, tall: 1, wide: 1 },
    apartments: { floor: 34, tall: 0.8, wide: 1.2 },
    warehouse: { floor: 24, tall: 0.42, wide: 1.9 },
    store: { floor: 26, tall: 0.38, wide: 1.45 },
    house: { floor: 30, tall: 0.46, wide: 1.1 },
    lot: { floor: 24, tall: 0.32, wide: 1.5 },
  };
  function proportionsOf(tower) { return PROPORTIONS[tower && tower.shape] || PROPORTIONS.tower; }

  function str(v) { return v === null || v === undefined ? "" : String(v); }
  function msOf(iso) { const t = Date.parse(str(iso)); return Number.isFinite(t) ? t : NaN; }
  function nowMs(now) { const t = now instanceof Date ? now.getTime() : Number(now); return Number.isFinite(t) ? t : NaN; }
  function sizeOf(b) { const n = Number(b && b.sizeSqft); return Number.isFinite(n) && n > 0 ? n : null; }
  function shortDate(iso) {
    const t = msOf(iso);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  }

  // The part of the day, on the greeting's boundaries (deskGreetingFor):
  // before noon is dawn, noon to five is day, five onward is dusk.
  function skyFor(now) {
    const d = now instanceof Date ? now : new Date(nowMs(now));
    const h = d.getHours();
    if (!Number.isFinite(h)) return "day";
    return h < 12 ? "dawn" : h < 17 ? "day" : "dusk";
  }

  // Reports naming this building: the exact address, any case — the Shelf
  // column's rule, so the banner and the table can never count one building
  // differently. It can under-count, never over-count.
  function reportsFor(b, shelf, now) {
    const want = str(b && b.address).trim().toLowerCase();
    if (!want) return 0;
    const since = now - ACTIVE_DAYS * DAY_MS;
    let n = 0;
    for (const s of Array.isArray(shelf) ? shelf : []) {
      if (str(s && s.address).trim().toLowerCase() !== want) continue;
      const t = msOf(s.createdAt);
      if (Number.isFinite(t) && t >= since && t <= now + DAY_MS) n += 1;
    }
    return n;
  }

  function dueByBuilding(critical) {
    const out = new Map();
    for (const c of Array.isArray(critical) ? critical : []) {
      const id = str(c && c.buildingId);
      const days = Number(c && c.days);
      if (!id || !Number.isFinite(days) || days < 0 || days > DUE_DAYS) continue;
      const cur = out.get(id);
      if (!cur || days < cur.days) out.set(id, { what: c.kind === "notice" ? "notice" : "expiry", tenant: str(c.tenant).trim(), days });
    }
    return out;
  }

  /**
   * One tower per building on the board, oldest on the left.
   * @param {object} input { buildings, critical, shelf, now }
   * @returns {Array<object>} each: { building, shape, t, w, lit, activity,
   *   reports, due, isNew, sized } — shape is shapeFor's, t the size as a
   *   height (0..1), w as a width (0..1), lit the share of windows lit (0..1).
   */
  function towersFor(input) {
    const src = input || {};
    const now = nowMs(src.now);
    if (!Number.isFinite(now)) return [];
    const list = (Array.isArray(src.buildings) ? src.buildings : []).filter((b) => b && b.id);
    if (!list.length) return [];
    const due = dueByBuilding(src.critical);
    const today = new Date(now);
    // A lot's size is ground, not floor area, and a ten-acre parcel would
    // otherwise be the "largest building" every real one is measured
    // against. So lots stay out of the scale unless the board is all lots.
    const built = list.filter((b) => shapeFor(b.type) !== "lot").map(sizeOf).filter((n) => n !== null);
    const sizes = built.length ? built : list.map(sizeOf).filter((n) => n !== null);
    const top = Math.max(TALL_FLOOR_SF, sizes.length ? Math.max.apply(null, sizes) : 0);
    // A building with no size stands at the board's middle height rather than
    // being guessed small or tall; `sized: false` lets the page say so.
    const middle = sizes.length ? sizes.slice().sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : 20000;
    const lo = Math.log(SMALL_SF), hi = Math.log(top);
    return list.slice()
      .sort((a, b) => (msOf(a.createdAt) || 0) - (msOf(b.createdAt) || 0) || str(a.address).localeCompare(str(b.address)))
      .map((b) => {
        const size = sizeOf(b);
        const s = Math.max(SMALL_SF, size || middle);
        const t = Math.max(0, Math.min(1, (Math.log(s) - lo) / (hi - lo)));
        const w = Math.max(0, Math.min(1, Math.sqrt(s / top)));
        const added = msOf(b.createdAt);
        const addedRecently = Number.isFinite(added) && now - added <= ACTIVE_DAYS * DAY_MS && added <= now + DAY_MS;
        const d = Number.isFinite(added) ? new Date(added) : null;
        const isNew = Boolean(d) && d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && added <= now + DAY_MS;
        const reports = reportsFor(b, src.shelf, now);
        const dueNow = due.get(str(b.id)) || null;
        const activity = reports + (addedRecently ? 1 : 0) + (dueNow ? 1 : 0);
        const lit = activity === 0 ? 0.05 : Math.min(0.78, 0.2 * activity + 0.14);
        return { building: b, shape: shapeFor(b.type), t, w, lit, activity, reports, due: dueNow, isNew, sized: size !== null };
      });
  }

  // The tower the banner speaks about at rest: the soonest lease date, and
  // otherwise none, so the callout waits for a hover. A building that is
  // merely new used to be spoken about too, and a new firm's lone building
  // always is new, so its card sat over the skyline all day saying what the
  // crane already says (the owner, 2026-09-25). A date is the one thing on
  // the banner somebody has to act on, so it is the one that speaks unasked.
  function focusOf(towers) {
    const list = Array.isArray(towers) ? towers : [];
    const due = list.filter((x) => x.due).sort((a, b) => a.due.days - b.due.days);
    return due.length ? due[0] : null;
  }

  function captionFor(towers) {
    const list = Array.isArray(towers) ? towers : [];
    return { count: list.length, addedThisMonth: list.filter((x) => x.isNew).length };
  }

  // Positions, left to right between x0 and x1, standing on `ground`, never
  // taller than `maxHeight`. Widths shrink together when the board is wider
  // than the room, so every building keeps a tower. Each shape keeps its own
  // proportions (PROPORTIONS); a tower with no shape is the plain tower.
  function layout(towers, box) {
    const list = Array.isArray(towers) ? towers : [];
    const b = box || {};
    const x0 = Number(b.x0) || 0, x1 = Number(b.x1) || 0;
    const ground = Number(b.ground) || 0;
    const maxHeight = Math.max(20, Number(b.maxHeight) || 0);
    const gap = Number.isFinite(Number(b.gap)) ? Number(b.gap) : 9;
    const minW = Number(b.minWidth) || 26, maxW = Number(b.maxWidth) || 52;
    let widths = list.map((x) => (minW + (maxW - minW) * x.w) * proportionsOf(x).wide);
    const room = Math.max(0, x1 - x0);
    const gaps = gap * Math.max(0, list.length - 1);
    let total = widths.reduce((s, w) => s + w, 0) + gaps;
    if (total > room && widths.length) {
      const k = Math.max(0.05, (room - gaps) / (total - gaps));
      widths = widths.map((w) => w * k);
      total = room;
    }
    let x = x1 - total;
    return list.map((tw, i) => {
      const pr = proportionsOf(tw);
      const floor = Math.min(pr.floor, maxHeight);
      const reach = Math.max(floor, maxHeight * pr.tall);
      const height = floor + (reach - floor) * Math.pow(tw.t, 0.8);
      const out = { x, width: widths[i], height, top: ground - height };
      x += widths[i] + gap;
      return out;
    });
  }

  // A board of one or two buildings is not a skyline yet. Drawn the ordinary
  // way, it was one thin tower pinned to the banner's right edge in a wide
  // empty sky, which read as a rendering glitch rather than a start (the
  // owner, 2026-09-25). So below SPARSE_BELOW the real towers are drawn a
  // size up, beside faint dashed outlines of towers still to come (the empty
  // board's ghosts), and the group stands in the middle of its room instead
  // of against the edge. Heights still mean size. The outlines are the only
  // shapes not drawn to scale, and they are not buildings.
  const SPARSE_BELOW = 3;
  const GHOST_SHAPES = [{ w: 30, h: 0.62 }, { w: 38, h: 0.9 }, { w: 26, h: 0.45 }]; // px wide, share of maxHeight tall

  function isSparse(towers) {
    const n = Array.isArray(towers) ? towers.length : 0;
    return n > 0 && n < SPARSE_BELOW;
  }

  // { towers, ghosts }: towers are layout()'s positions, moved so the whole
  // group (towers, then ghosts to their right, where the skyline grows) is
  // centred between x0 and x1 — or, with box.align "end", set against x1 (a
  // phone, where the words fill the banner and the middle is under the
  // greeting). Ghosts are { x, width, height, top }.
  function sparseLayout(towers, box) {
    const list = Array.isArray(towers) ? towers : [];
    const b = box || {};
    const x0 = Number(b.x0) || 0, x1 = Number(b.x1) || 0;
    const ground = Number(b.ground) || 0;
    const maxHeight = Math.max(20, Number(b.maxHeight) || 0);
    const gap = Number.isFinite(Number(b.gap)) ? Number(b.gap) : 9;
    const real = layout(list, Object.assign({}, b, { minWidth: 34, maxWidth: 60 }));
    const shapes = list.length ? GHOST_SHAPES.slice(0, Math.max(0, SPARSE_BELOW + 1 - list.length)) : [];
    const ghosts = shapes.map((s) => ({ width: s.w, height: Math.max(20, maxHeight * s.h) }));
    const realW = real.length ? real[real.length - 1].x + real[real.length - 1].width - real[0].x : 0;
    const total = realW + ghosts.reduce((sum, g) => sum + g.width + gap, 0);
    const spare = Math.max(0, x1 - x0 - total);
    const start = x0 + (b.align === "end" ? spare : spare / 2);
    const shift = real.length ? start - real[0].x : 0;
    for (const p of real) p.x += shift;
    let x = start + realW + gap;
    for (const g of ghosts) {
      g.x = x;
      g.top = ground - g.height;
      x += g.width + gap;
    }
    return { towers: real, ghosts };
  }

  // Which windows are lit: a fixed pattern per building, so a tower does not
  // flicker between paints, with about `lit` of them on.
  function windowPattern(id, lit, count) {
    let h = 2166136261;
    for (const c of str(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const out = [];
    for (let i = 0; i < Math.max(0, count | 0); i++) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      out.push((h % 1000) / 1000 < lit);
    }
    return out;
  }

  // Which of a building's windows are lit: windowPattern, plus two rules for
  // buildings with only a few windows (a house has three, a storefront two).
  // One the firm has worked on always shows at least one lit window, since a
  // dark house would say nobody touched it; and a quiet one with fewer than
  // FEW_WINDOWS stays dark, since one stray light in three windows would read
  // as work rather than as a city at night.
  const FEW_WINDOWS = 8;
  function lightsFor(tower, count) {
    const x = tower || {};
    const n = Math.max(0, count | 0);
    const id = str(x.building && x.building.id);
    if (!x.activity && n < FEW_WINDOWS) return new Array(n).fill(false);
    const out = windowPattern(id, Number(x.lit) || 0, n);
    if (x.activity && n && !out.some(Boolean)) out[0] = true;
    return out;
  }

  // The words for a tower: its name, what is due, whether it is new, and its
  // shelf. Plain strings for textContent — tenants and names are text a
  // person typed.
  function calloutFor(tower) {
    const x = tower || {};
    const b = x.building || {};
    const street = str(b.address).split(",")[0].trim();
    let due = "";
    if (x.due) {
      const when = x.due.days === 0 ? "today" : x.due.days === 1 ? "tomorrow" : `in ${x.due.days} days`;
      const who = x.due.tenant ? ` for ${x.due.tenant}` : "";
      due = x.due.what === "notice" ? `Option notice${who} ${when}` : `Lease${who} expires ${when}`;
    }
    let fresh = "";
    if (x.isNew) {
      const by = b.mine ? "you" : str(b.addedBy).trim();
      fresh = by ? `New this month, added by ${by}` : "New this month";
    }
    // Short, because it shares a line with the callout's link.
    const meta = x.reports
      ? `${x.reports} ${x.reports === 1 ? "report" : "reports"} this month`
      : "No reports this month";
    const facts = [str(b.type).trim(), x.sized ? `${Number(b.sizeSqft).toLocaleString("en-US")} SF` : "",
      b.createdAt ? `on the board since ${shortDate(b.createdAt)}` : ""].filter(Boolean).join(" · ");
    return { name: street, due, fresh, meta, facts };
  }

  // What a screen reader hears for a tower.
  function labelFor(tower) {
    const c = calloutFor(tower);
    return [c.name, c.facts, c.due, c.fresh, c.meta].filter(Boolean).join(". ") + ".";
  }

  return { DUE_DAYS, ACTIVE_DAYS, SPARSE_BELOW, FEW_WINDOWS, PROPORTIONS, skyFor, shapeFor, towersFor, focusOf, captionFor,
    layout, isSparse, sparseLayout, windowPattern, lightsFor, calloutFor, labelFor, shortDate };
});
