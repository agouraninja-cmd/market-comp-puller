// ---------------------------------------------------------------------------
// bov-doc.js — a broker's Broker Opinion of Value, as a document (2026-11-27).
//
// The owner's ask: "Create a tool in the pipeline section that creates a
// Professional BOV for the brokers." The tool is the BOV builder at /bov
// (bov-page.js draws the form; bov-builder.js runs it in the browser). This
// file is everything the builder KNOWS: how a typed figure is read, which of
// the broker's comps suit a subject, the range those comps support, and the
// document itself, as HTML. PURE and dual-exported (Node for npm test, the
// browser global BOVDOC), like collateral-check.js and gut-check.js, and
// served with the same max-age 0.
//
// ---------------------------------------------------------------------------
// THE RULES
// ---------------------------------------------------------------------------
// 1. THE OPINION IS THE BROKER'S, STATED, NEVER COMPUTED FOR THEM. The comps
//    support a range (suggestValue) and the builder offers it, but the
//    "Opinion of value" on the document is only the low, high and list price
//    the broker typed. CompNinja's owner is not a licensed broker
//    (CLAUDE.md): a figure this file put there unasked would be our opinion
//    wearing their name. With nothing typed there is no opinion block, and
//    the builder will not print. What the comparables page does say is the
//    sales' own arithmetic under their own heading (their low, median and
//    high rate, and what those come to at the subject's size), which is a
//    statement about the comps and is labelled as one.
//
// 2. NOT AN APPRAISAL, AND THE DOCUMENT SAYS SO. limitingConditions() is on
//    every BOV and cannot be switched off; the broker's own disclaimer (their
//    saved report branding) is added to it, never in place of it.
//
// 3. REFUSE RATHER THAN GUESS. "1.2M" is not read as 1.2 (the vault's rule,
//    broker-vault.js): money() answers an error the builder shows beside the
//    field, and the figure is left off the document until it reads.
//
// 4. ONE PROPERTY TYPE, ONE UNIT. $/SF is not comparable across property
//    types, and land is priced per acre (vault-page.js's saleStats). The
//    range is taken over the chosen SALES of the subject's own type alone;
//    a comp of another type is still listed, and the document says it was
//    left out of the range.
//
// 5. A DRAFT LEAVES THE BROWSER ONLY WHEN THE BROKER SAVES IT (CLAUDE.md rule
//    6). It holds an owner's name, an NOI and which private comps were used.
//    Nothing in this file makes a request. bov-builder.js sends the draft to
//    one place, the broker's own account (POST /api/broker/bov-docs), and
//    only on a press of Save; the route stores cleanDraft's answer, never
//    the body as sent.
//
// 6. EVERY STRING IS ESCAPED ON THE WAY INTO THE DOCUMENT. An address, a note
//    and an owner's name are all text a person typed.
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BOVDOC = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The vault's own list (broker-vault.js PROPERTY_TYPES); test/bov-doc.test.js
  // holds the two together.
  const PROPERTY_TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];

  // The accent a BOV is printed in. Named, never free: a colour picker's
  // pale yellow would print white headings on a white page.
  const ACCENTS = [
    ["navy", "Navy", "#1A2433"],
    ["charcoal", "Charcoal", "#2B2B2B"],
    ["forest", "Forest", "#1F4D3A"],
    ["burgundy", "Burgundy", "#6E1F2B"],
    ["royal", "Royal blue", "#1E3A8A"],
  ];
  const accentOf = (key) => (ACCENTS.find((a) => a[0] === key) || ACCENTS[0])[2];

  // How many comps the builder ticks on its own, and how many a BOV can hold.
  const SUGGEST_MAX = 6;
  const COMPS_MAX = 15;
  const MANUAL_MAX = 10;
  // How many BOVs one account may keep saved (the save route refuses past
  // it, so the list never silently leaves one out).
  const SAVED_MAX = 100;

  const LIMITS = {
    address: 200, name: 120, short: 80, highlights: 1200, text: 4000,
  };

  // ---- reading what was typed ------------------------------------------------

  const str = (v) => String(v == null ? "" : v);
  const clean = (v, max) => str(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);

  // "$1,250,000" and "1250000.50" read; "1.2M", "1.2 million" and "about 3m"
  // do not. Empty is no figure and no error.
  function money(v) {
    const raw = str(v).trim();
    if (!raw) return { ok: true, value: null };
    const s = raw.replace(/^\$\s*/, "").replace(/,/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      return { ok: false, value: null, error: "“" + raw + "” is not a dollar amount we can read. Write it out in full, like 1,250,000." };
    }
    const n = Number(s);
    if (!(n > 0)) return { ok: false, value: null, error: "Enter an amount above zero." };
    return { ok: true, value: n };
  }

  // "45,000", "45,000 SF", "4.5" (acres). Never a shorthand.
  function number(v) {
    const raw = str(v).trim();
    if (!raw) return { ok: true, value: null };
    const s = raw.replace(/,/g, "").replace(/\s*(sf|sq\.?\s*ft\.?|square feet|acres?|ac)\s*$/i, "");
    if (!/^\d+(\.\d+)?$/.test(s)) {
      return { ok: false, value: null, error: "“" + raw + "” is not a number we can read." };
    }
    const n = Number(s);
    if (!(n > 0)) return { ok: false, value: null, error: "Enter a number above zero." };
    return { ok: true, value: n };
  }

  // "6.25%" and "6.25". A cap rate outside 0-30 is a typo, not a market.
  function percent(v) {
    const raw = str(v).trim();
    if (!raw) return { ok: true, value: null };
    const s = raw.replace(/\s*%$/, "");
    if (!/^\d+(\.\d+)?$/.test(s)) {
      return { ok: false, value: null, error: "“" + raw + "” is not a percentage we can read. Write it like 6.25." };
    }
    const n = Number(s);
    if (!(n > 0) || n > 30) return { ok: false, value: null, error: "A cap rate is between 0 and 30 percent." };
    return { ok: true, value: n };
  }

  function year(v) {
    const raw = str(v).trim();
    if (!raw) return { ok: true, value: null };
    if (!/^\d{4}$/.test(raw) || Number(raw) < 1700 || Number(raw) > 2100) {
      return { ok: false, value: null, error: "Enter the year as four digits, like 1998." };
    }
    return { ok: true, value: Number(raw) };
  }

  function isoDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d };
  }

  // ---- saying it back --------------------------------------------------------

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MON = MONTHS.map((m) => m.slice(0, 3));

  const fmtMoney = (n) => n == null ? "" : "$" + Math.round(Number(n)).toLocaleString("en-US");
  const fmtNum = (n, digits) => n == null ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits || 0 });
  const fmtPsf = (n) => n == null ? "" : "$" + (Number(n) >= 1000 ? Math.round(Number(n)).toLocaleString("en-US") : Number(n).toFixed(2));
  const fmtRate = (n, unit) => n == null ? "" : unit === "acre" ? fmtMoney(n) + " per acre" : fmtPsf(n) + " per SF";
  // The figure alone, for a sentence that names the unit once: "$84.99 to $88.00 per SF".
  const bare = (n, unit) => n == null ? "" : unit === "acre" ? fmtMoney(n) : fmtPsf(n);
  const fmtRateShort = (n, unit) => n == null ? "" : unit === "acre" ? fmtMoney(n) + "/acre" : fmtPsf(n) + "/SF";
  const longDate = (iso) => { const p = isoDate(iso); return p ? MONTHS[p.m - 1] + " " + p.d + ", " + p.y : ""; };
  const shortDate = (iso) => { const p = isoDate(iso); return p ? MON[p.m - 1] + " " + p.y : ""; };

  function esc(s) {
    return str(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Typed paragraphs: a blank line starts a new one, a single break is kept.
  function paragraphs(text, cls) {
    return str(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      .map((p) => "<p" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(p).replace(/\n/g, "<br/>") + "</p>").join("");
  }

  // "8400 W Fairview Ave, Boise, ID 83704" -> the street, and the rest.
  function splitAddress(address) {
    const parts = str(address).split(",").map((s) => s.trim()).filter(Boolean);
    return { street: parts[0] || "", rest: parts.slice(1).join(", ") };
  }
  // "Boise, ID" out of an address, for matching the broker's comps (their
  // `market` is server.js's marketOf, the same "City, ST"). A helper for
  // suggesting, never a gate: an address it cannot read matches no market
  // and the suggestion falls back to the property type alone.
  function marketOfAddress(address) {
    const parts = str(address).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) return "";
    const st = /^([A-Za-z]{2})\b/.exec(parts[parts.length - 1]);
    if (!st) return "";
    return parts[parts.length - 2] + ", " + st[1].toUpperCase();
  }

  // ---- the draft -------------------------------------------------------------

  function blankDraft() {
    return {
      v: 1,
      // The saved copy this draft is, once the broker has pressed Save
      // (broker_bov_docs.id); "" for a draft that lives in the browser only.
      docId: "",
      from: "",
      subject: { address: "", type: "Industrial", size: "", acres: "", year: "", occupancy: "", zoning: "", highlights: "" },
      client: { name: "", company: "" },
      compIds: [],
      touchedComps: false,
      manual: [],
      value: { low: "", high: "", list: "" },
      income: { noi: "", cap: "" },
      text: { summary: "", market: "", strategy: "", about: "" },
      accent: "navy",
      photo: "",
    };
  }

  const PHOTO_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  // Our own street photo proxy, the address sealed in the token (photo-token.js).
  const STREET_RE = /^\/api\/streetview\?t=[A-Za-z0-9._~-]+$/;
  const PHOTO_MAX = 900000;
  const okPhoto = (v) => {
    const s = str(v);
    return (s.length <= PHOTO_MAX && PHOTO_RE.test(s)) || STREET_RE.test(s) ? s : "";
  };

  // Whatever came out of storage (or a test), as a draft this file can trust.
  // Unknown keys are dropped; every string is capped.
  function cleanDraft(raw) {
    const d = blankDraft();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
    const sub = raw.subject || {}, cl = raw.client || {}, val = raw.value || {}, inc = raw.income || {}, tx = raw.text || {};
    d.from = /^[0-9a-f-]{36}$/i.test(str(raw.from)) ? str(raw.from) : "";
    d.docId = /^[0-9a-f-]{36}$/i.test(str(raw.docId)) ? str(raw.docId) : "";
    d.subject.address = clean(sub.address, LIMITS.address);
    d.subject.type = PROPERTY_TYPES.includes(sub.type) ? sub.type : "Industrial";
    ["size", "acres", "year", "occupancy", "zoning"].forEach((k) => { d.subject[k] = clean(sub[k], LIMITS.short); });
    d.subject.highlights = clean(sub.highlights, LIMITS.highlights);
    d.client.name = clean(cl.name, LIMITS.name);
    d.client.company = clean(cl.company, LIMITS.name);
    d.compIds = (Array.isArray(raw.compIds) ? raw.compIds : []).map((x) => clean(x, 64)).filter(Boolean).slice(0, COMPS_MAX);
    d.touchedComps = raw.touchedComps === true;
    d.manual = (Array.isArray(raw.manual) ? raw.manual : []).slice(0, MANUAL_MAX).map((m, i) => ({
      id: "m" + (i + 1),
      address: clean(m && m.address, LIMITS.address),
      date: isoDate(m && m.date) ? str(m.date).slice(0, 10) : "",
      size: clean(m && m.size, LIMITS.short),
      price: clean(m && m.price, LIMITS.short),
      cap: clean(m && m.cap, LIMITS.short),
    })).filter((m) => m.address);
    ["low", "high", "list"].forEach((k) => { d.value[k] = clean(val[k], LIMITS.short); });
    d.income.noi = clean(inc.noi, LIMITS.short);
    d.income.cap = clean(inc.cap, LIMITS.short);
    ["summary", "market", "strategy", "about"].forEach((k) => { d.text[k] = clean(tx[k], LIMITS.text); });
    d.accent = ACCENTS.some((a) => a[0] === raw.accent) ? raw.accent : "navy";
    d.photo = okPhoto(raw.photo);
    return d;
  }

  const isLandType = (type) => type === "Land";
  const unitOfType = (type) => isLandType(type) ? "acre" : "sf";

  // The subject's size in the unit its type is priced in: acres for land,
  // square feet for a building. null when it is missing or unreadable.
  function subjectSize(draft) {
    const s = draft.subject;
    const r = number(isLandType(s.type) ? s.acres : s.size);
    return r.ok ? r.value : null;
  }

  // ---- comps -----------------------------------------------------------------

  // A typed comp in the shape the broker's stored ones have, so one table and
  // one set of statistics reads both. It takes the subject's type: a comp
  // typed into a BOV is one the broker chose FOR this property.
  function manualComp(m, type) {
    const land = isLandType(type);
    const size = number(m.size), price = money(m.price), cap = percent(m.cap);
    const c = {
      id: m.id, manual: true, address: m.address, property_type: type, transaction: "sale",
      deal_date: m.date || null,
      size_sqft: !land && size.ok ? size.value : null,
      lot_acres: land && size.ok ? size.value : null,
      price: price.ok ? price.value : null,
      cap_rate: cap.ok ? cap.value : null,
      price_per_sqft: null, price_per_acre: null,
    };
    if (c.price && !land && c.size_sqft) c.price_per_sqft = Math.round((c.price / c.size_sqft) * 100) / 100;
    if (c.price && land && c.lot_acres) c.price_per_acre = Math.round(c.price / c.lot_acres);
    return c;
  }

  // A sale's rate in its own unit. The STORED figures are read, as the comps
  // page reads them (vault-page.js psfOf / acreOf): price_per_sqft is written
  // for sales only, so a lease can never enter a sale median here.
  function saleRate(c) {
    if (!c || c.transaction === "lease") return null;
    if (isLandType(c.property_type)) {
      const t = Number(c.price_per_acre);
      if (c.price_per_acre != null && c.price_per_acre !== "" && isFinite(t) && t > 0) return t;
      const p = Number(c.price), a = Number(c.lot_acres);
      return c.price != null && c.price !== "" && p > 0 && isFinite(a) && a > 0 ? Math.round(p / a) : null;
    }
    const v = Number(c.price_per_sqft);
    return c.price_per_sqft == null || c.price_per_sqft === "" || !isFinite(v) || !(v > 0) ? null : v;
  }
  const rentRate = (c) => {
    if (!c || c.transaction !== "lease") return null;
    const v = Number(c.rent_psf_yr);
    return c.rent_psf_yr == null || !isFinite(v) || !(v > 0) ? null : v;
  };

  function median(list) {
    if (!list.length) return null;
    const s = list.slice().sort((a, b) => a - b), h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }

  // The broker's comps in the order the builder lists them for one subject:
  // the subject's own type first, its own market first inside that, sales
  // before leases, newest first.
  function rankComps(comps, subject) {
    const type = subject && subject.type, mkt = marketOfAddress(subject && subject.address).toLowerCase();
    const score = (c) =>
      (c.property_type === type ? 0 : 4) +
      (mkt && str(c.market).toLowerCase() === mkt ? 0 : 2) +
      (c.transaction === "lease" ? 1 : 0);
    return (comps || []).slice().sort((a, b) =>
      score(a) - score(b) || str(b.deal_date).localeCompare(str(a.deal_date)) || str(a.id).localeCompare(str(b.id)));
  }

  // The comps the builder ticks before the broker has chosen any: priced
  // sales of the subject's type, the ones in its own market first and then
  // the newest elsewhere (a Boise building's comps are in Meridian too), up
  // to SUGGEST_MAX. A suggestion, shown ticked and theirs to untick.
  function suggestComps(comps, subject) {
    const type = subject && subject.type;
    return rankComps(comps, subject).filter((c) => c.property_type === type && saleRate(c) != null)
      .slice(0, SUGGEST_MAX).map((c) => str(c.id));
  }

  // The chosen comps, stored ones in the broker's order then the typed ones.
  function chosenComps(draft, comps) {
    const byId = {};
    (comps || []).forEach((c) => { byId[str(c.id)] = c; });
    const stored = draft.compIds.map((id) => byId[id]).filter(Boolean);
    const typed = draft.manual.map((m) => manualComp(m, draft.subject.type));
    return stored.concat(typed);
  }

  // What the chosen SALES of the subject's type say: the low, the median and
  // the high rate. `others` counts chosen sales left out for being another
  // type (rule 4), `unpriced` the ones with no rate to read.
  function saleBasis(chosen, type) {
    const unit = unitOfType(type);
    const sales = (chosen || []).filter((c) => c && c.transaction !== "lease");
    const mine = sales.filter((c) => c.property_type === type);
    const vals = mine.map(saleRate).filter((v) => v != null);
    const dates = mine.filter((c) => saleRate(c) != null).map((c) => str(c.deal_date)).filter((d) => isoDate(d)).sort();
    return {
      unit, n: vals.length,
      low: vals.length ? Math.min.apply(null, vals) : null,
      median: median(vals),
      high: vals.length ? Math.max.apply(null, vals) : null,
      others: sales.length - mine.length,
      unpriced: mine.length - vals.length,
      from: dates[0] || "", to: dates[dates.length - 1] || "",
    };
  }

  // A value is said to the nearest figure a person would quote, never to the
  // dollar: an opinion of value exact to $3,690,412 claims a precision no
  // comp set has.
  function roundValue(n) {
    if (n == null || !isFinite(n)) return null;
    const step = n < 250000 ? 1000 : n < 1000000 ? 5000 : n < 10000000 ? 25000 : 100000;
    return Math.round(n / step) * step;
  }

  // The range the chosen comps support for a property this size. Offered to
  // the broker (rule 1); null until there is a rate and a size to multiply.
  function suggestValue(basis, size) {
    if (!basis || !basis.n || !(size > 0)) return null;
    return {
      low: roundValue(basis.low * size),
      likely: roundValue(basis.median * size),
      high: roundValue(basis.high * size),
      single: basis.n === 1 || basis.low === basis.high,
    };
  }

  // NOI over a cap rate: the income approach, as a cross-check beside the
  // sales. null unless both read.
  function incomeValue(draft) {
    const noi = money(draft.income.noi), cap = percent(draft.income.cap);
    if (!noi.ok || !cap.ok || noi.value == null || cap.value == null) return null;
    return { noi: noi.value, cap: cap.value, value: roundValue(noi.value / (cap.value / 100)) };
  }

  // The three figures the broker typed, read. `errors` names each one that
  // cannot be read or does not make sense beside the others.
  function opinion(draft) {
    const low = money(draft.value.low), high = money(draft.value.high), list = money(draft.value.list);
    const errors = {};
    if (!low.ok) errors.low = low.error;
    if (!high.ok) errors.high = high.error;
    if (!list.ok) errors.list = list.error;
    if (low.ok && high.ok && low.value != null && high.value != null && low.value > high.value) {
      errors.high = "The high end is below the low end.";
    }
    const out = { low: errors.low ? null : low.value, high: errors.high ? null : high.value, list: errors.list ? null : list.value, errors };
    out.stated = out.low != null || out.high != null || out.list != null;
    return out;
  }

  // What is still missing before this reads as a finished BOV. `need` stops
  // the print button; `want` is advice the broker may ignore.
  function readiness(draft, comps, brand) {
    const need = [], want = [];
    const s = draft.subject;
    if (!s.address.trim()) need.push(["address", "The property’s address"]);
    const size = number(isLandType(s.type) ? s.acres : s.size);
    if (!size.ok || size.value == null) need.push(["size", isLandType(s.type) ? "The site’s acreage" : "The building’s size"]);
    const op = opinion(draft);
    if (Object.keys(op.errors).length) need.push(["value", "A value that reads as a dollar amount"]);
    else if (op.low == null && op.high == null && op.list == null) need.push(["value", "Your opinion of value"]);
    const chosen = chosenComps(draft, comps);
    if (!chosen.length) need.push(["comps", "At least one comparable"]);
    else if (saleBasis(chosen, s.type).n < 3) want.push(["comps", "Three or more comparable sales of this property type"]);
    if (!draft.client.name.trim() && !draft.client.company.trim()) want.push(["client", "Who it is prepared for"]);
    if (!brand || !(brand.firmName || brand.logo)) want.push(["brand", "Your firm’s letterhead"]);
    else if (!brand.licenseNumber) want.push(["brand", "Your license number on the letterhead"]);
    if (!draft.text.summary.trim()) want.push(["summary", "A summary of how you reached the value"]);
    return { need, want, ready: need.length === 0 };
  }

  // ---- starting drafts for the two paragraphs brokers write every time -------
  // Built from the draft's own facts and nothing else. They are a first
  // sentence to edit, offered by a button, never written into the document
  // by themselves.

  function starterSummary(draft, comps) {
    const s = draft.subject, chosen = chosenComps(draft, comps), b = saleBasis(chosen, s.type);
    const op = opinion(draft), size = subjectSize(draft);
    const where = marketOfAddress(s.address) || "the area";
    const parts = [];
    if (b.n) {
      const span = b.from && b.to && b.from !== b.to ? " that closed between " + shortDate(b.from) + " and " + shortDate(b.to)
        : b.to ? " from " + shortDate(b.to) : "";
      parts.push("This opinion is based on " + b.n + " comparable " + s.type.toLowerCase() + " sale" + (b.n === 1 ? "" : "s") + " in and around " + where + span +
        (b.n === 1 || b.low === b.high ? ", at " + fmtRate(b.median, b.unit) + "."
          : ", at " + bare(b.low, b.unit) + " to " + fmtRate(b.high, b.unit) + ", with a median of " + fmtRate(b.median, b.unit) + "."));
    }
    if (op.low != null && op.high != null) {
      parts.push("Weighing those sales against the property’s size, age, location and condition, we believe it would sell for between " +
        fmtMoney(op.low) + " and " + fmtMoney(op.high) +
        (size ? " (" + bare(op.low / size, b.unit) + " to " + fmtRate(op.high / size, b.unit) + ")" : "") + " in today’s market." +
        (op.list != null ? " We recommend bringing it to market at " + fmtMoney(op.list) + "." : ""));
    }
    return parts.join(" ");
  }

  function starterStrategy(draft) {
    const op = opinion(draft);
    const lead = op.list != null
      ? "We recommend listing the property at " + fmtMoney(op.list) + ". That price sits inside the range the comparable sales support, leaves room to negotiate, and should draw serious buyers early."
      : "We recommend pricing the property inside the range the comparable sales support, so it draws serious buyers early.";
    return lead + "\n\n" +
      "Our marketing plan:\n" +
      "• Professional photography and a full offering package\n" +
      "• Listing on the commercial listing services, with direct outreach to the buyers and brokers active in this market\n" +
      "• Signage on the property and a targeted email campaign\n" +
      "• A report to you every two weeks on showings, inquiries and feedback\n\n" +
      "On this plan we would expect to be under contract within 90 to 120 days of launch.";
  }

  // ---- the document ----------------------------------------------------------

  // Printed on every BOV. Rule 2: not optional, and the broker's own
  // disclaimer is added after it.
  function limitingConditions() {
    return [
      "This Broker Opinion of Value is an opinion of the price the property would probably sell for, prepared by a real estate licensee to help its owner decide on a price to list or sell at. It is not an appraisal. It has not been prepared in accordance with the Uniform Standards of Professional Appraisal Practice, and it should not be used to obtain financing or for any purpose that calls for an appraisal. If an appraisal is wanted, the services of a licensed or certified appraiser should be obtained.",
      "The comparable transactions are drawn from the preparer’s own records and from sources believed to be reliable, and have not been independently verified. Unless stated above, the property has not been inspected, measured or surveyed, and no review of its title, zoning, environmental condition or structure has been made. This opinion reflects the market on the date above, and the market changes.",
    ];
  }

  function fileName(draft) {
    const street = splitAddress(draft.subject.address).street.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return "BOV" + (street ? "-" + street : "");
  }

  function preparerOf(brand, identity) {
    const b = brand || {};
    const firm = b.firmName || (identity && (identity.company || identity.creditedTo)) || "";
    const name = b.preparerName || (identity && identity.display_name) || "";
    return {
      firm, name: name && name !== firm ? name : "",
      license: b.licenseNumber || "", phone: b.phone || "", email: b.email || "",
      logo: b.logo && PHOTO_RE.test(b.logo) ? b.logo : "", disclaimer: b.disclaimer || "",
    };
  }

  function compRow(c, unit) {
    const land = isLandType(c.property_type);
    const lease = c.transaction === "lease";
    const size = c.size_sqft ? fmtNum(c.size_sqft) + " SF" : land && c.lot_acres ? fmtNum(c.lot_acres, 2) + " ac" : "";
    const rate = lease
      ? (rentRate(c) != null ? "$" + rentRate(c).toFixed(2) + "/SF/yr" + (c.lease_type ? " " + esc(c.lease_type) : "") : "")
      : (saleRate(c) != null ? fmtRateShort(saleRate(c), land ? "acre" : "sf") : "");
    const a = splitAddress(c.address);
    return "<tr><td><b>" + esc(a.street) + "</b>" + (a.rest ? '<span class="bvd-sub">' + esc(a.rest) + "</span>" : "") + "</td>" +
      (unit === "mixed" ? "<td>" + esc(c.property_type || "") + "</td>" : "") +
      "<td>" + esc(shortDate(c.deal_date) || "Undated") + "</td>" +
      '<td class="num">' + esc(size) + "</td>" +
      (lease ? "" : '<td class="num">' + (c.price ? fmtMoney(c.price) : "Undisclosed") + "</td>") +
      '<td class="num">' + rate + "</td>" +
      (lease ? "" : '<td class="num">' + (c.cap_rate != null && c.cap_rate !== "" ? esc(String(c.cap_rate)) + "%" : "") + "</td>") +
      "</tr>";
  }

  // The whole BOV. opts: { comps (the broker's own, as /api/vault serves
  // them), brand, identity, today ("YYYY-MM-DD"), preview }. With `preview`
  // the page shows where something is still missing; the printed copy is
  // rendered without it, so no hint can reach a client.
  function documentHtml(draftIn, opts) {
    const o = opts || {};
    const draft = cleanDraft(draftIn);
    const s = draft.subject, land = isLandType(s.type), unit = unitOfType(s.type);
    const who = preparerOf(o.brand, o.identity);
    const chosen = chosenComps(draft, o.comps);
    const sales = chosen.filter((c) => c.transaction !== "lease");
    const leases = chosen.filter((c) => c.transaction === "lease");
    const basis = saleBasis(chosen, s.type);
    const op = opinion(draft);
    const size = subjectSize(draft);
    const inc = incomeValue(draft);
    const addr = splitAddress(s.address);
    const dated = longDate(o.today) || "";
    const hint = (text) => o.preview ? '<span class="bvd-hint">' + esc(text) + "</span>" : "";
    const yr = year(s.year);

    // -- the cover ------------------------------------------------------------
    const facts = [s.type, size ? (land ? fmtNum(size, 2) + " acres" : fmtNum(size) + " SF") : "", yr.ok && yr.value ? "Built " + yr.value : ""].filter(Boolean);
    const letterhead =
      '<header class="bvd-lh">' + (who.logo ? '<img src="' + esc(who.logo) + '" alt=""/>' : "") +
      '<div class="bvd-lh-firm">' + (who.firm ? "<b>" + esc(who.firm) + "</b>" : hint("Your firm’s name")) + "</div></header>";
    const prepBy = [who.name, who.firm].filter(Boolean);
    const cover =
      '<section class="bvd-sheet bvd-cover">' + letterhead +
      '<div class="bvd-cv-main">' +
      '<p class="bvd-eyebrow">Broker Opinion of Value</p>' +
      "<h1>" + (addr.street ? esc(addr.street) : hint("The property’s address")) + "</h1>" +
      (addr.rest ? '<p class="bvd-cv-city">' + esc(addr.rest) + "</p>" : "") +
      (facts.length ? '<p class="bvd-cv-facts">' + esc(facts.join("  ·  ")) + "</p>" : "") +
      "</div>" +
      (draft.photo ? '<div class="bvd-photo"><img src="' + esc(draft.photo) + '" alt=""/></div>' : '<div class="bvd-band"></div>') +
      '<div class="bvd-cv-foot">' +
      '<div><span>Prepared for</span>' +
        (draft.client.name || draft.client.company
          ? (draft.client.name ? "<b>" + esc(draft.client.name) + "</b>" : "") + (draft.client.company ? (draft.client.name ? "<i>" : "<b>") + esc(draft.client.company) + (draft.client.name ? "</i>" : "</b>") : "")
          : hint("The owner’s name")) + "</div>" +
      '<div><span>Prepared by</span>' +
        (prepBy.length ? "<b>" + esc(prepBy[0]) + "</b>" + (prepBy[1] ? "<i>" + esc(prepBy[1]) + "</i>" : "") : hint("Your name and firm")) +
        (who.license ? "<i>License " + esc(who.license) + "</i>" : "") +
        (who.phone ? "<i>" + esc(who.phone) + "</i>" : "") + (who.email ? "<i>" + esc(who.email) + "</i>" : "") + "</div>" +
      "<div><span>Date</span><b>" + esc(dated) + "</b></div>" +
      "</div></section>";

    const run = '<div class="bvd-run"><span>' + esc(who.firm || "Broker Opinion of Value") + "</span><span>" +
      esc(addr.street ? "Broker Opinion of Value  ·  " + addr.street : "Broker Opinion of Value") + "</span></div>";

    // -- opinion of value, and the property -------------------------------------
    const perUnit = (v) => size && v != null ? fmtRateShort(v / size, unit) : "";
    let valueBlock;
    if (op.low != null || op.high != null || op.list != null) {
      const range = op.low != null && op.high != null
        ? (op.low === op.high ? fmtMoney(op.low) : fmtMoney(op.low) + " – " + fmtMoney(op.high))
        : fmtMoney(op.low != null ? op.low : op.high != null ? op.high : op.list);
      const rangeRate = op.low != null && op.high != null && size
        ? (op.low === op.high ? perUnit(op.low) : perUnit(op.low) + " – " + perUnit(op.high)) : "";
      valueBlock = '<div class="bvd-value">' +
        '<div class="bvd-v-main"><span>' + (op.low != null && op.high != null && op.low !== op.high ? "Probable selling price" : "Opinion of value") + "</span>" +
        "<b>" + range + "</b>" + (rangeRate ? "<i>" + rangeRate + "</i>" : "") + "</div>" +
        (op.list != null && (op.low != null || op.high != null)
          ? '<div class="bvd-v-list"><span>Recommended list price</span><b>' + fmtMoney(op.list) + "</b>" + (perUnit(op.list) ? "<i>" + perUnit(op.list) + "</i>" : "") + "</div>" : "") +
        "</div>";
    } else {
      valueBlock = o.preview ? '<div class="bvd-value empty">' + hint("Your opinion of value goes here: a low, a high and the price you would list at.") + "</div>" : "";
    }
    const fact = (label, value) => value ? "<tr><th>" + label + "</th><td>" + esc(value) + "</td></tr>" : "";
    const acres = number(s.acres);
    const factRows =
      fact("Address", s.address) + fact("Property type", s.type) +
      fact(land ? "Site" : "Building size", size ? (land ? fmtNum(size, 2) + " acres" : fmtNum(size) + " SF") : "") +
      (!land && acres.ok && acres.value ? fact("Lot", fmtNum(acres.value, 2) + " acres") : "") +
      fact("Year built", yr.ok && yr.value ? String(yr.value) : "") +
      fact("Occupancy", s.occupancy) + fact("Zoning", s.zoning);
    const valuePage =
      '<section class="bvd-sheet">' + run +
      "<h2>Opinion of value</h2>" + valueBlock +
      (draft.text.summary.trim() ? paragraphs(draft.text.summary) : hint("A short summary of how you reached this value.")) +
      "<h3>The property</h3>" +
      '<table class="bvd-facts"><tbody>' + factRows + "</tbody></table>" +
      (s.highlights.trim() ? paragraphs(s.highlights) : "") +
      "</section>";

    // -- the comparables --------------------------------------------------------
    const mixed = sales.some((c) => c.property_type !== s.type) ? "mixed" : unit;
    const rateHead = mixed === "mixed" ? "Price per SF or acre" : unit === "acre" ? "Price per acre" : "Price per SF";
    let compsBody = "";
    if (sales.length) {
      compsBody += "<h2>Comparable sales</h2>";
      if (basis.n) {
        const cell = (label, v) => "<div><span>" + label + "</span><b>" + fmtRateShort(v, basis.unit) + "</b></div>";
        compsBody += '<div class="bvd-stats">' +
          (basis.n === 1 || basis.low === basis.high
            ? cell(basis.n === 1 ? "The one sale" : "Every sale", basis.median)
            : cell("Lowest", basis.low) + cell("Median", basis.median) + cell("Highest", basis.high)) +
          "<div><span>Sales</span><b>" + basis.n + "</b></div>" +
          (size && basis.n ? "<div><span>At " + (land ? fmtNum(size, 2) + " acres" : fmtNum(size) + " SF") + "</span><b>" +
            (basis.n === 1 || basis.low === basis.high ? fmtMoney(roundValue(basis.median * size))
              : fmtMoney(roundValue(basis.low * size)) + " – " + fmtMoney(roundValue(basis.high * size))) + "</b></div>" : "") +
          "</div>";
      }
      compsBody += '<table class="bvd-comps"><thead><tr><th>Property</th>' + (mixed === "mixed" ? "<th>Type</th>" : "") +
        '<th>Sold</th><th class="num">Size</th><th class="num">Price</th><th class="num">' + rateHead + '</th><th class="num">Cap rate</th></tr></thead><tbody>' +
        sales.map((c) => compRow(c, mixed)).join("") + "</tbody></table>";
      const notes = [];
      if (basis.others) notes.push(basis.others + " of these sales " + (basis.others === 1 ? "is" : "are") + " of another property type and " + (basis.others === 1 ? "is" : "are") + " shown for context; the figures above are from the " + s.type.toLowerCase() + " sales alone.");
      if (basis.unpriced) notes.push(basis.unpriced + " sale" + (basis.unpriced === 1 ? " has" : "s have") + " no disclosed price or size and " + (basis.unpriced === 1 ? "is" : "are") + " not in the figures above.");
      if (notes.length) compsBody += '<p class="bvd-note">' + esc(notes.join(" ")) + "</p>";
    }
    if (leases.length) {
      compsBody += (sales.length ? "<h3>Comparable leases</h3>" : "<h2>Comparable leases</h2>") +
        '<table class="bvd-comps"><thead><tr><th>Property</th>' +
        '<th>Signed</th><th class="num">Size</th><th class="num">Rent</th></tr></thead><tbody>' +
        leases.map((c) => compRow(c, unit)).join("") + "</tbody></table>";
    }
    if (!chosen.length && o.preview) compsBody = "<h2>Comparable sales</h2>" + hint("The comparables you choose are listed here.");
    if (inc) {
      compsBody += "<h3>Income cross-check</h3>" +
        '<table class="bvd-facts"><tbody>' +
        "<tr><th>Net operating income</th><td>" + fmtMoney(inc.noi) + " a year</td></tr>" +
        "<tr><th>Capitalization rate</th><td>" + esc(String(inc.cap)) + "%</td></tr>" +
        "<tr><th>Indicated value</th><td><b>" + fmtMoney(inc.value) + "</b>" + (size ? " (" + fmtRateShort(inc.value / size, unit) + ")" : "") + "</td></tr>" +
        "</tbody></table>";
    }
    const compsPage = compsBody ? '<section class="bvd-sheet">' + run + compsBody + "</section>" : "";

    // -- the recommendation, the firm and the conditions --------------------------
    let last = "";
    if (draft.text.market.trim()) last += "<h2>Market overview</h2>" + paragraphs(draft.text.market);
    if (draft.text.strategy.trim()) last += "<h2>Pricing and marketing</h2>" + paragraphs(draft.text.strategy);
    if (draft.text.about.trim()) last += "<h2>About " + esc(who.firm || who.name || "us") + "</h2>" + paragraphs(draft.text.about);
    const sign = [who.name, who.firm].filter(Boolean);
    // A line to sign on and the date beside it, on one row: stacked, the
    // block was tall enough to push the fine print onto a fifth page.
    const signSub = [sign[1], who.license ? "License " + who.license : ""].filter(Boolean).join("  \u00b7  ");
    last += '<div class="bvd-sign"><div class="bvd-sign-who"><div class="bvd-sign-line"></div>' +
      (sign.length ? "<b>" + esc(sign[0]) + "</b>" : "") + (signSub ? "<span>" + esc(signSub) + "</span>" : "") + "</div>" +
      '<div class="bvd-sign-date"><div class="bvd-sign-line"><i>' + esc(dated) + "</i></div><span>Date</span></div></div>";
    last += '<div class="bvd-terms"><h4><span>About this opinion</span><span class="bvd-made">Prepared with CompNinja</span></h4>' +
      '<div class="bvd-terms-cols">' +
      limitingConditions().map((p) => "<p>" + esc(p) + "</p>").join("") +
      (who.disclaimer ? "<p>" + esc(who.disclaimer) + "</p>" : "") +
      "</div></div>";
    const lastPage = '<section class="bvd-sheet">' + run + last + "</section>";

    return '<div class="bvd">' + cover + valuePage + compsPage + lastPage + "</div>";
  }

  // The document's own stylesheet, for the preview and for paper. Colours are
  // named, never the site's tokens: this is paper, black on white in either
  // theme, and a token would print the dark theme's pale ink onto white. A
  // sheet is a US Letter page at 96 pixels to the inch; the builder scales it
  // to fit its column.
  function documentCss(accentKey) {
    const A = accentOf(accentKey);
    return [
      ".bvd{font:400 14px/1.6 Inter,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1c1c;text-align:left}",
      ".bvd *{box-sizing:border-box}",
      ".bvd-sheet{position:relative;width:816px;min-height:1056px;padding:72px 76px 64px;background:#fff;color:#1c1c1c;margin:0 0 24px;box-shadow:0 1px 3px rgba(0,0,0,.12),0 12px 32px rgba(0,0,0,.10)}",
      ".bvd h1,.bvd h2{font-family:Georgia,'Times New Roman',serif;font-weight:500;color:" + A + ";margin:0;letter-spacing:-.01em}",
      ".bvd h2{font-size:25px;line-height:1.2;margin:28px 0 13px;padding-bottom:9px;border-bottom:1px solid #d9d9d9}",
      ".bvd-run+h2{margin-top:0}",
      ".bvd h3{font:600 12px/1.3 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:" + A + ";margin:30px 0 10px}",
      ".bvd h4{font:600 11px/1.3 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#555;margin:0 0 8px}",
      ".bvd p{margin:0 0 12px}",
      ".bvd-hint{display:inline-block;color:#8a6d1a;background:#fbf3dc;border:1px dashed #d9c27a;border-radius:4px;padding:2px 8px;font:500 13px/1.5 Inter,system-ui,sans-serif;font-style:normal}",
      // The cover.
      ".bvd-cover{display:flex;flex-direction:column;height:1056px;padding-top:64px}",
      ".bvd-lh{display:flex;align-items:center;gap:16px;min-height:56px}",
      ".bvd-lh img{max-height:56px;max-width:200px;display:block}",
      ".bvd-lh-firm b{font:600 17px/1.3 Inter,system-ui,sans-serif;color:" + A + ";letter-spacing:-.005em}",
      ".bvd-cv-main{margin-top:104px}",
      ".bvd-eyebrow{font:600 12px/1.3 Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#666;margin:0 0 18px!important}",
      ".bvd-cover h1{font-size:46px;line-height:1.08;letter-spacing:-.02em}",
      ".bvd-cv-city{font:400 20px/1.4 Georgia,serif;color:#444;margin:10px 0 0!important}",
      ".bvd-cv-facts{font:500 13px/1.4 Inter,system-ui,sans-serif;letter-spacing:.04em;color:#555;margin:22px 0 0!important}",
      ".bvd-band{height:6px;background:" + A + ";margin:44px 0 0;width:96px}",
      ".bvd-photo{margin:36px 0 0;flex:1 1 auto;min-height:0;max-height:420px;overflow:hidden;border-radius:2px;background:#eee}",
      ".bvd-photo img{width:100%;height:100%;object-fit:cover;display:block}",
      ".bvd-cv-foot{margin-top:auto;display:grid;grid-template-columns:1fr 1.25fr .8fr;gap:28px;border-top:2px solid " + A + ";padding-top:18px}",
      ".bvd-cv-foot span{display:block;font:600 10.5px/1.3 Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#777;margin-bottom:7px}",
      ".bvd-cv-foot .bvd-hint{display:inline-block;letter-spacing:0;text-transform:none;color:#8a6d1a;font:500 13px/1.5 Inter,system-ui,sans-serif;margin:0}",
      ".bvd-cv-foot b{display:block;font:600 15px/1.35 Inter,system-ui,sans-serif;color:#1c1c1c}",
      ".bvd-cv-foot i{display:block;font:400 12.5px/1.5 Inter,system-ui,sans-serif;font-style:normal;color:#555}",
      // The line across the top of every page after the cover.
      ".bvd-run{display:flex;justify-content:space-between;gap:16px;font:500 10.5px/1.3 Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#888;border-bottom:1px solid #e3e3e3;padding-bottom:10px;margin-bottom:34px}",
      // The value.
      ".bvd-value{display:flex;gap:0;border:1px solid #d9d9d9;border-top:4px solid " + A + ";margin:0 0 22px}",
      ".bvd-value.empty{padding:22px;border-style:dashed;border-top-style:solid}",
      ".bvd-value>div{padding:20px 24px;flex:1 1 0}",
      ".bvd-v-main{flex:1.5 1 0!important}",
      ".bvd-v-list{border-left:1px solid #d9d9d9;background:#f7f7f5}",
      ".bvd-value span{display:block;font:600 10.5px/1.3 Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#666;margin-bottom:8px}",
      ".bvd-value b{display:block;font:500 30px/1.15 Georgia,serif;color:" + A + ";letter-spacing:-.01em;white-space:nowrap}",
      ".bvd-v-list b{font-size:26px}",
      ".bvd-value i{display:block;font:400 13px/1.4 Inter,system-ui,sans-serif;font-style:normal;color:#555;margin-top:6px}",
      // Tables.
      ".bvd table{width:100%;border-collapse:collapse;margin:0 0 14px;min-width:0}",
      ".bvd-facts th{text-align:left;font:500 13px/1.5 Inter,system-ui,sans-serif;text-transform:none;letter-spacing:0;color:#666;width:34%;padding:8px 12px 8px 0;border-bottom:1px solid #e9e9e9;vertical-align:top;background:none}",
      ".bvd-facts td{font:400 14px/1.5 Inter,system-ui,sans-serif;color:#1c1c1c;padding:8px 0;border-bottom:1px solid #e9e9e9;background:none}",
      ".bvd-comps{font-size:12.5px}",
      ".bvd-comps th{text-align:left;font:600 10px/1.3 Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#666;padding:8px 8px 8px 0;border-bottom:1.5px solid " + A + ";background:none;white-space:nowrap}",
      ".bvd-comps td{padding:9px 8px 9px 0;border-bottom:1px solid #e6e6e6;color:#1c1c1c;vertical-align:top;background:none}",
      ".bvd-comps td b{font-weight:600;display:block}",
      ".bvd-comps .bvd-sub{display:block;color:#666;font-size:11.5px}",
      ".bvd .num{text-align:right;white-space:nowrap;padding-right:0;padding-left:8px;font-variant-numeric:tabular-nums}",
      ".bvd-comps tr{break-inside:avoid}",
      ".bvd-stats{display:flex;border:1px solid #d9d9d9;margin:0 0 18px}",
      ".bvd-stats>div{flex:1 1 0;padding:12px 16px;border-left:1px solid #e3e3e3}",
      ".bvd-stats>div:first-child{border-left:0}",
      ".bvd-stats span{display:block;font:600 10px/1.3 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#666;margin-bottom:5px}",
      ".bvd-stats b{font:500 18px/1.2 Georgia,serif;color:#1c1c1c;white-space:nowrap}",
      ".bvd-note{font-size:12px;color:#666}",
      // The signature and the conditions.
      ".bvd-sign{display:flex;align-items:flex-start;margin:30px 0 0;break-inside:avoid}",
      ".bvd-sign-who{width:320px;margin-right:40px}",
      ".bvd-sign-date{width:170px}",
      ".bvd-sign-line{display:flex;align-items:flex-end;border-bottom:1px solid #1c1c1c;height:28px;margin-bottom:7px}",
      ".bvd-sign-line i{font:400 13px/1.3 Inter,system-ui,sans-serif;font-style:normal;color:#1c1c1c;padding-bottom:4px}",
      ".bvd-sign b{display:block;font:600 14px/1.4 Inter,system-ui,sans-serif}",
      ".bvd-sign span{display:block;font:400 12.5px/1.5 Inter,system-ui,sans-serif;color:#555}",
      ".bvd-terms{margin-top:26px;padding-top:13px;border-top:1px solid #d9d9d9;break-inside:avoid}",
      ".bvd-terms h4{display:flex;justify-content:space-between}",
      ".bvd-terms p{font-size:9.5px;line-height:1.5;color:#666;margin:0 0 6px}",
      // The fine print in two columns: half the height, so an ordinary BOV
      // ends on its fourth page instead of spilling six lines onto a fifth.
      ".bvd-terms-cols{column-count:2;column-gap:28px}",
      ".bvd-terms .bvd-made{color:#999;font-weight:500}",
      // Paper. The sheet gives up its own size and padding to the page box.
      "@page{size:letter;margin:.7in .75in}",
      "@media print{",
      ".bvd-sheet{width:auto;min-height:0;padding:0;margin:0;box-shadow:none;break-before:page}",
      ".bvd-sheet:first-child{break-before:auto}",
      ".bvd-cover{height:9.55in;padding-top:0}",
      ".bvd-value,.bvd-stats,.bvd h2,.bvd h3{break-inside:avoid;break-after:avoid}",
      ".bvd-value,.bvd-stats{break-after:auto}",
      ".bvd *{-webkit-print-color-adjust:exact;print-color-adjust:exact}",
      "}",
    ].join("\n");
  }

  return {
    PROPERTY_TYPES, ACCENTS, SUGGEST_MAX, COMPS_MAX, MANUAL_MAX, SAVED_MAX, LIMITS,
    money, number, percent, year,
    fmtMoney, fmtNum, fmtRate, fmtRateShort, longDate, shortDate,
    splitAddress, marketOfAddress,
    blankDraft, cleanDraft, okPhoto,
    isLandType, unitOfType, subjectSize,
    manualComp, saleRate, rentRate, median,
    rankComps, suggestComps, chosenComps, saleBasis, roundValue, suggestValue, incomeValue, opinion, readiness,
    starterSummary, starterStrategy,
    limitingConditions, fileName, preparerOf, documentHtml, documentCss, accentOf,
  };
});
