// ---------------------------------------------------------------------------
// Sites: the rules for a development firm's list of the land and buildings
// its members are buying, own or track (2026-10-05; migration 060).
//
// Design: the owner's pick "M2" of the Sites drafts,
//   https://claude.ai/artifact/BMeJY9d3vegjmDxcAPtxzR
// Two sections on one tab: Buying (deals moving Prospect -> LOI -> Under
// contract -> Entitlements) and Owned and tracking (the Properties tab's own
// features, folded in). A deal that closes becomes Owned.
//
// PURE and dual-exported, like gut-check.js and valuation.js: Node gets a
// CommonJS module (the /api/sites routes validate through it, and npm test
// covers it), the browser gets the global SITES (the Sites tab reads the
// stage names, order and deadline rule from the SAME copy). No I/O and no
// clock reads: every function that needs today takes it as an argument.
//
// Rejects rather than guesses, the vault's rule: "3.4M" for a price, a date
// that is not YYYY-MM-DD, or a stage nobody defined is refused with a sentence
// the member can act on, never stored as a best effort.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SITES = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // migrations/060-user-sites.sql restates this list in its CHECK; keep the
  // two in step.
  const STAGES = ["prospect", "loi", "contract", "entitle", "owned", "tracking", "passed"];
  const LABELS = {
    prospect: "Prospect", loi: "LOI", contract: "Under contract", entitle: "Entitlements",
    owned: "Owned", tracking: "Tracking", passed: "Passed",
  };
  // The five-step tracker. Closing on a site is what makes you its owner, so
  // the last step is Owned rather than a separate "Closed".
  const STEPS = ["prospect", "loi", "contract", "entitle", "owned"];
  // A deal in progress: the Buying section.
  const BUYING = ["prospect", "loi", "contract", "entitle"];
  // A status on a property already held in portfolio_items.
  const HELD = ["owned", "tracking"];

  // Read cap, newest first, and the write cap that keeps a member from owning
  // rows the read silently truncates away (bov-log.js's discipline).
  const MAX_ROWS = 500;
  const MAX_DATES = 20;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isStage(v) { return STAGES.indexOf(v) >= 0; }
  function isBuying(v) { return BUYING.indexOf(v) >= 0; }
  function isHeld(v) { return HELD.indexOf(v) >= 0; }
  function labelOf(stage) { return LABELS[stage] || ""; }

  // The step after this one on the tracker, or null at Owned and off it.
  function nextStage(stage) {
    const i = STEPS.indexOf(stage);
    return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null;
  }

  function cleanText(v, max) {
    const s = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return s ? s.slice(0, max) : null;
  }

  // A dollar figure as people type it: "$3,450,000", "3450000", "3,450,000.50".
  // A suffix ("3.4M", "450k") is refused rather than multiplied out: a price
  // read 1,000x wrong in someone's own deal record is worse than a refusal.
  function cleanMoney(v, what) {
    const raw = String(v == null ? "" : v).trim();
    if (!raw) return { ok: true, value: null };
    const s = raw.replace(/^\$/, "").replace(/,/g, "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      return { ok: false, error: `"${raw}" is not a ${what} we can read: type the full figure, like 3,450,000` };
    }
    return { ok: true, value: Number(s) };
  }

  // "18.4", "18.4 ac", "18.4 acres". Zero and negatives are refused.
  function cleanAcres(v) {
    const raw = String(v == null ? "" : v).trim();
    if (!raw) return { ok: true, value: null };
    const s = raw.replace(/\s*(ac|acres?)\.?$/i, "").replace(/,/g, "").trim();
    if (!/^\d+(\.\d{1,3})?$/.test(s) || Number(s) <= 0) {
      return { ok: false, error: `"${raw}" is not an acreage we can read: type a number, like 18.4` };
    }
    return { ok: true, value: Number(s) };
  }

  // ISO only, what <input type=date> emits. Anything else is refused rather
  // than guessed (the vault importer's rule: 03/04 is two different days).
  function cleanDate(v) {
    const raw = String(v == null ? "" : v).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
        return { ok: true, value: raw };
      }
    }
    return { ok: false, error: `"${raw}" is not a date we can read: use YYYY-MM-DD` };
  }

  // The key dates: due diligence, hearings, closing. Each needs both halves,
  // because a date with no label is a deadline nobody can act on. Sorted
  // soonest first so every reader sees one order.
  function cleanDates(list) {
    if (list == null || list === "") return { ok: true, value: [] };
    if (!Array.isArray(list)) return { ok: false, error: "Dates must be a list." };
    if (list.length > MAX_DATES) return { ok: false, error: `A site can hold ${MAX_DATES} dates.` };
    const out = [];
    for (const d of list) {
      const on = cleanDate(d && d.on);
      if (!on.ok) return on;
      const label = cleanText(d && d.label, 80);
      if (!label) return { ok: false, error: `Say what happens on ${on.value}.` };
      out.push({ on: on.value, label });
    }
    out.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
    return { ok: true, value: out };
  }

  // The deadline the list shows: the soonest date that is today or later.
  function nextDeadline(dates, today) {
    const list = Array.isArray(dates) ? dates : [];
    let best = null;
    for (const d of list) {
      if (!d || typeof d.on !== "string" || d.on < today) continue;
      if (!best || d.on < best.on) best = d;
    }
    return best;
  }

  // Whole days from today to an ISO date (negative when it has passed).
  function daysUntil(on, today) {
    const a = Date.parse(String(today) + "T00:00:00Z"), b = Date.parse(String(on) + "T00:00:00Z");
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.round((b - a) / 864e5);
  }

  // The editable fields, each validated the same way on create and on edit.
  // Returns { ok, value } with only the fields present in `body`.
  function cleanFields(body, opts) {
    const o = opts || {};
    const out = {};
    if (body.address !== undefined) {
      const a = cleanText(body.address, 300);
      if (!a) return { ok: false, error: "Type the site's address." };
      out.address = a;
    }
    if (body.property_type !== undefined) {
      const t = String(body.property_type || "");
      if (typeof o.isPropertyType === "function" && !o.isPropertyType(t)) {
        return { ok: false, error: "Unknown property type." };
      }
      out.property_type = t;
    }
    if (body.acres !== undefined) {
      const r = cleanAcres(body.acres); if (!r.ok) return r; out.acres = r.value;
    }
    if (body.zoning !== undefined) out.zoning = cleanText(body.zoning, 40);
    if (body.asking_price !== undefined) {
      const r = cleanMoney(body.asking_price, "price"); if (!r.ok) return r; out.asking_price = r.value;
    }
    if (body.earnest_money !== undefined) {
      const r = cleanMoney(body.earnest_money, "deposit"); if (!r.ok) return r; out.earnest_money = r.value;
    }
    if (body.seller !== undefined) out.seller = cleanText(body.seller, 120);
    if (body.notes !== undefined) out.notes = cleanText(body.notes, 1000);
    if (body.dates !== undefined) {
      const r = cleanDates(body.dates); if (!r.ok) return r; out.dates = r.value;
    }
    return { ok: true, value: out };
  }

  // A new row. A deal starts on a buying stage (Prospect unless said) or
  // Passed; a status row (Owned or Tracking) must name the held property it
  // describes, and a deal must not.
  function validateNew(body, opts) {
    const b = body && typeof body === "object" ? body : {};
    const o = opts || {};
    const stage = b.stage === undefined || b.stage === "" ? "prospect" : String(b.stage);
    if (!isStage(stage)) return { ok: false, error: "Unknown stage." };
    const pid = b.portfolio_item_id == null || b.portfolio_item_id === "" ? null : String(b.portfolio_item_id);
    if (pid && !UUID.test(pid)) return { ok: false, error: "Unknown property." };
    if (isHeld(stage) && !pid) return { ok: false, error: "Owned and Tracking describe a property you already hold." };
    if (!isHeld(stage) && pid) return { ok: false, error: "A deal in progress is not one of your properties yet." };
    if (b.address === undefined) return { ok: false, error: "Type the site's address." };
    const f = cleanFields(Object.assign({ property_type: b.property_type === undefined ? "Land" : b.property_type }, b), o);
    if (!f.ok) return f;
    const today = String(o.today || "");
    const row = Object.assign({ property_type: "Land", dates: [] }, f.value, {
      stage,
      stage_dates: today ? { [stage]: today } : {},
      portfolio_item_id: pid,
    });
    return { ok: true, row };
  }

  // An edit. A stage change stamps the day it was reached, and keeps the days
  // the earlier stages were reached: that is the tracker's history. Moving a
  // deal to Owned needs the held property it became; the route checks that
  // property belongs to the caller.
  function validatePatch(existing, body, opts) {
    const b = body && typeof body === "object" ? body : {};
    const o = opts || {};
    const f = cleanFields(b, o);
    if (!f.ok) return f;
    const patch = f.value;
    if (b.portfolio_item_id !== undefined) {
      const pid = b.portfolio_item_id == null || b.portfolio_item_id === "" ? null : String(b.portfolio_item_id);
      if (pid && !UUID.test(pid)) return { ok: false, error: "Unknown property." };
      patch.portfolio_item_id = pid;
    }
    if (b.stage !== undefined) {
      const stage = String(b.stage);
      if (!isStage(stage)) return { ok: false, error: "Unknown stage." };
      const pid = patch.portfolio_item_id !== undefined ? patch.portfolio_item_id : (existing && existing.portfolio_item_id) || null;
      if (isHeld(stage) && !pid) return { ok: false, error: "Add it to your properties first, then mark it Owned." };
      patch.stage = stage;
      if (!existing || existing.stage !== stage) {
        const prior = existing && existing.stage_dates && typeof existing.stage_dates === "object" ? existing.stage_dates : {};
        patch.stage_dates = Object.assign({}, prior, o.today ? { [stage]: String(o.today) } : {});
      }
    }
    if (!Object.keys(patch).length) return { ok: false, error: "Nothing to update." };
    return { ok: true, patch };
  }

  return {
    STAGES, LABELS, STEPS, BUYING, HELD, MAX_ROWS, MAX_DATES,
    isStage, isBuying, isHeld, labelOf, nextStage,
    cleanMoney, cleanAcres, cleanDate, cleanDates, nextDeadline, daysUntil,
    validateNew, validatePatch,
  };
});
