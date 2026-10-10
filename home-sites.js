// ---------------------------------------------------------------------------
// A development firm's deals and holdings, worked on Home's Properties tab
// (2026-10-09, the owner's call: "Development firms only and integrate it
// into the property section of the home page"). It was the Sites tab on
// /vault (2026-10-05, the owner's pick "M2" of the Sites drafts,
// https://claude.ai/artifact/BMeJY9d3vegjmDxcAPtxzR) and, for every Pro
// member, The Board's deal wall (2026-10-07); both were removed the day this
// moved, and The Board went back to being the markets a member follows.
//
// Home already lists every property once (home-map.js): the deals, what the
// member owns, and the firm's buildings. This file adds the WORKING half
// under a row the member opens, in place in that list:
//   * a deal (a user_sites row on Prospect, LOI, Under contract, Entitlements,
//     or Passed): the five-step tracker with the day each step was reached,
//     Move to <next> / Pass / Back to Prospect, key terms, key dates, notes,
//     Edit, Run a land report, Remove;
//   * a property they own (portfolio_items, Owned unless a user_sites status
//     row says Tracking, which puts it on The Board): its likely value,
//     change and history, when it was
//     checked, the market since, the firm door, how they bought it, Open
//     report, Refresh value, Watch it on The Board instead, Remove;
// plus the add form ("I'm buying it", "I own it") that Home's "+ Add a
// property" opens for a development firm's member. A building watched
// rather than owned (a Tracking status) is The Board's since 2026-10-09
// (board.js, on the Markets page), so it is neither listed nor added here.
//
// Rules this file keeps:
//   * It DRAWS and asks; it decides nothing it can read from SITES (sites.js,
//     the same copy the routes validate with). Every write is an ordinary
//     fetch to a route that re-checks it: /api/sites for deals and statuses
//     (requireSites: signed in, Pro, a database), /api/portfolio for held
//     properties, and Home's own door for the firm's buildings.
//   * Built with createElement/textContent, Home's standing rule: every
//     address, note and seller is text a person typed.
//   * A refused write SAYS so ("Nothing has been lost") in the pane it came
//     from, and changes nothing on screen until the server has agreed.
//   * Only for a development firm's member: index.html mounts it only then
//     (HOMEMAP.dealsOn). Nobody else has deals.
//
// Dual-exported like home-map.js: Node gets the pure helpers
// (test/home-sites.test.js), the browser gets the global HOMESITES, whose
// mount() index.html calls once /sites.js has defined SITES. Served at
// /home-sites.js with maxAge 0, like home-map.js.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./sites") : root.SITES);
  if (node) module.exports = api;
  else root.HOMESITES = api;
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const STALE_MS = 365 * 864e5;
  const PROP_TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];

  // ---- pure -----------------------------------------------------------------
  const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  function money(n) { n = num(n); return n == null ? "" : "$" + Math.round(n).toLocaleString("en-US"); }
  function short(n) {
    n = num(n) || 0;
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(n >= 1e8 ? 0 : 2).replace(/\.?0+$/, "") + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }
  function acres(n) { n = num(n); return n == null ? "" : String(Math.round(n * 10) / 10); }
  function perAcre(s) {
    const a = num(s && s.asking_price), ac = num(s && s.acres);
    return a && ac ? a / ac : null;
  }
  // "Oct 12", or "Oct 12, 2027" outside today's year.
  function dayLabel(iso, today) {
    const p = String(iso || "").slice(0, 10).split("-");
    if (p.length < 3 || !p[1]) return "";
    return MON[Number(p[1]) - 1] + " " + Number(p[2]) + (String(today || "").slice(0, 4) === p[0] ? "" : ", " + p[0]);
  }
  function tsLabel(ts, now) {
    const d = new Date(ts);
    if (!isFinite(d.getTime())) return "";
    const same = d.getFullYear() === new Date(now == null ? Date.now() : now).getFullYear();
    return MON[d.getMonth()] + " " + d.getDate() + (same ? "" : ", " + d.getFullYear());
  }
  // How far off a date is, in words, and whether it is inside a week.
  function countdown(on, today) {
    const n = S.daysUntil(on, today);
    if (n == null || n < 0) return null;
    return { text: n === 0 ? "Today" : n === 1 ? "Tomorrow" : n + " days", hot: n <= 7 };
  }
  // The Buying group's figures: how many, their acres, what they ask, and the
  // soonest deadline across them.
  function figures(deals, today) {
    const list = Array.isArray(deals) ? deals : [];
    let next = null;
    list.forEach((s) => { const x = S.nextDeadline(s.dates, today); if (x && (!next || x.on < next.on)) next = x; });
    return {
      count: list.length,
      acres: list.reduce((t, s) => t + (num(s.acres) || 0), 0),
      asking: list.reduce((t, s) => t + (num(s.asking_price) || 0), 0),
      next,
    };
  }
  // The same, as the short line beside Home's "Buying" heading.
  function figuresLine(deals, today) {
    const f = figures(deals, today);
    return [f.acres ? acres(f.acres) + " acres" : "", f.asking ? short(f.asking) + " asking" : ""].filter(Boolean).join(" · ");
  }
  // The five steps, each done, now or ahead, with the day it was reached.
  // A stage off the tracker ("" for a passed deal) draws them all ahead.
  function steps(stage, stageDates, today) {
    const i = S.STEPS.indexOf(stage), sd = stageDates && typeof stageDates === "object" ? stageDates : {};
    return S.STEPS.map((k, j) => ({ key: k, label: S.labelOf(k), state: j < i ? "done" : j === i ? "now" : "",
      when: sd[k] ? dayLabel(sd[k], today) : "" }));
  }
  // A held property's numbers: its newest valuation, the change since the one
  // before, when it was checked and whether that was over a year ago.
  function held(item, status, now) {
    const snaps = Array.isArray(item && item.snapshots) ? item.snapshots : [];
    const last = snaps[snaps.length - 1] || null, prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const ts = last && last.ts ? Date.parse(last.ts) : NaN;
    const likely = last && num(last.likely) ? num(last.likely) : null;
    return {
      stage: status && status.stage === "tracking" ? "tracking" : "owned",
      snaps, last, likely,
      chg: likely && prev && num(prev.likely) ? (likely - num(prev.likely)) / num(prev.likely) * 100 : null,
      checked: last && last.ts ? last.ts : null,
      stale: isFinite(ts) && (now == null ? Date.now() : now) - ts > STALE_MS,
      movement: item && item.movement && item.movement.line ? String(item.movement.line) : "",
    };
  }
  // The status row a held property carries, the newest when there are two.
  function statusFor(sites, pid) {
    let best = null;
    (Array.isArray(sites) ? sites : []).forEach((s) => {
      if (!s || s.portfolio_item_id == null || String(s.portfolio_item_id) !== String(pid)) return;
      if (!best || String(s.updated_at || "") > String(best.updated_at || "")) best = s;
    });
    return best;
  }
  // Whether a held property is already on the firm's list (the "Add to firm"
  // door shows only when it is not).
  function onFirmList(item, buildings) {
    const vk = String((item && item.verified_key) || ""), a = String((item && item.address) || "").trim().toLowerCase();
    return (Array.isArray(buildings) ? buildings : []).some((b) =>
      !!b && ((vk && b.verifiedKey && b.verifiedKey === vk) || (a && String(b.address || "").trim().toLowerCase() === a)));
  }
  function street(address) { return String(address || "").split(",")[0].trim(); }

  // ---- the browser half -----------------------------------------------------
  // ctx (index.html's Home):
  //   data()        -> { sites, portfolio, buildings, firm, showValues, today }
  //   reload()      -> re-read the deals and holdings, then draw Home again
  //   open(key)     -> which row's pane Home keeps open (null: none)
  //   keyOf(addr)   -> the row key Home gives an address (HOMEMAP.addressKey)
  //   say(text)     -> the line under the Properties heading
  //   closeAdd()    -> take the add form away
  //   addToFirm(in) -> Home's one door onto the firm's buildings
  function mount(ctx) {
    if (!S || !ctx || typeof document === "undefined") return null;
    const SVG = "http://www.w3.org/2000/svg";
    const types = Array.isArray(ctx.propTypes) && ctx.propTypes.length ? ctx.propTypes : PROP_TYPES;
    const state = { editing: null, dating: null, msg: {}, addKind: "buy", addMsg: "", busy: false };
    let live = null;      // the open pane: { key, el, sig, row }
    let liveAdd = null;   // the add form's element

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
      kids.flat(2).forEach((k) => { if (k != null) e.append(k); });
      return e;
    }
    const data = () => ctx.data() || {};
    const today = () => data().today || "";

    // ---- talking to the server ----
    function send(method, url, body) {
      return fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) }).then((r) =>
        r.json().catch(() => ({})).then((j) => ({ s: r.status, j: j || {} })))
        .catch(() => ({ s: 0, j: { error: "That didn't reach the server. Nothing was changed." } }));
    }
    // After a write: Home re-reads the deals and holdings and draws again,
    // which hands this file the open row back through pane(). `key`
    // undefined keeps whichever row is open.
    function after(key, text) {
      if (key !== undefined) ctx.open(key);
      if (text) ctx.say(text);
      return Promise.resolve(ctx.reload());
    }
    function fail(key, text) { state.msg[key] = text; refill(); return false; }
    function update(key, id, body) {
      return send("POST", "/api/sites/update", Object.assign({ id }, body)).then((r) => {
        if (r.s !== 200) return fail(key, r.j.error || "That didn't save. Nothing has been lost.");
        delete state.msg[key];
        return after(undefined).then(() => true);
      });
    }

    // ---- small parts ----
    function chip(text, cls) { return h("span", { class: "hs-chip" + (cls ? " " + cls : "") }, text); }
    function check() {
      return sv("svg", { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": "true" },
        sv("path", { d: "M2 5.2 4.1 7.3 8 3", fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    }
    function stepper(stage, stageDates, label) {
      return h("ol", { class: "hs-steps", "aria-label": label || "Where this deal is" },
        steps(stage, stageDates, today()).map((st) => h("li", { class: st.state || null, "aria-current": st.state === "now" ? "step" : null },
          h("span", { class: "hs-dot" }, st.state === "done" ? check() : null),
          h("span", { class: "hs-sl" }, st.label),
          st.when ? h("span", { class: "hs-sd" }, st.when) : null)));
    }
    function btn(text, cls, onclick) {
      return h("button", { type: "button", class: "hm-btn" + (cls ? " " + cls : ""), onclick }, text);
    }
    function blk(title, ...kids) { return h("div", { class: "hs-blk" }, h("h4", null, title), kids); }
    function msgLine(key) { return state.msg[key] ? h("p", { class: "dk-msg bad", role: "alert" }, state.msg[key]) : null; }
    function field(label, control, wide) { return h("label", { class: wide ? "hs-wide" : null }, h("span", null, label), control); }
    function input(name, value, attrs) {
      return h("input", Object.assign({ type: "text", name, value: value == null ? "" : String(value) }, attrs || {}));
    }
    function select(name, opts, cur) {
      return h("select", { name }, opts.map(([v, t]) => h("option", { value: v, selected: v === cur }, t)));
    }
    function chart(snaps) {
      const hist = snaps.filter((s) => num(s.likely) > 0 && isFinite(Date.parse(s.ts)));
      if (hist.length < 2) return null;
      const W = 400, H = 116, pad = 18, vals = hist.map((s) => num(s.likely));
      const lo = Math.min(...vals) * 0.985, hi = Math.max(...vals) * 1.015;
      const t0 = Date.parse(hist[0].ts), t1 = Date.parse(hist[hist.length - 1].ts);
      const x = (t) => pad + (Date.parse(t) - t0) * (W - 2 * pad) / (t1 - t0 || 1);
      const y = (v) => H - 26 - (v - lo) * (H - 44) / ((hi - lo) || 1);
      const anchor = (i) => (i === 0 ? "start" : i === hist.length - 1 ? "end" : "middle");
      return sv("svg", { class: "hs-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Likely value at each check" },
        sv("line", { x1: pad, x2: W - pad, y1: H - 18, y2: H - 18, stroke: "var(--line)" }),
        sv("polyline", { fill: "none", stroke: "var(--ink-2)", "stroke-width": 2,
          points: hist.map((s) => x(s.ts).toFixed(1) + "," + y(num(s.likely)).toFixed(1)).join(" ") }),
        hist.map((s, i) => {
          const last = i === hist.length - 1, cx = x(s.ts).toFixed(1), cy = y(num(s.likely)).toFixed(1), d = new Date(s.ts);
          return [
            sv("circle", { cx, cy, r: last ? 4.5 : 3.5, fill: last ? "var(--red-fill)" : "var(--card)", stroke: last ? "var(--red-fill)" : "var(--ink-2)", "stroke-width": 2 }),
            sv("text", { x: cx, y: (Number(cy) - 10).toFixed(1), "text-anchor": anchor(i), class: "hs-cv" }, short(num(s.likely))),
            sv("text", { x: cx, y: H - 4, "text-anchor": anchor(i), class: "hs-cd" }, MON[d.getMonth()] + " " + String(d.getFullYear()).slice(2)),
          ];
        }));
    }

    // ---- a deal ----
    function dealPane(key, s) {
      if (state.editing === s.id) return [editForm(key, s), msgLine(key)];
      const isPassed = s.stage === "passed";
      const per = perAcre(s), next = S.nextStage(s.stage);
      const acts = isPassed
        ? [btn("Back to Prospect", "red", (e) => { e.currentTarget.disabled = true; move(key, s, "prospect"); })]
        : [next ? btn("Move to " + S.labelOf(next) + " →", "red", (e) => { e.currentTarget.disabled = true; move(key, s, next); }) : null,
          btn("Pass on it", "", (e) => { e.currentTarget.disabled = true; move(key, s, "passed"); })];
      const terms = [["Asking price", s.asking_price != null ? money(s.asking_price) : "—"], ["Per acre", per ? money(per) : "—"],
        ["Acres", s.acres != null ? acres(s.acres) : "—"], ["Zoning", s.zoning || "—"]];
      if (s.earnest_money != null) terms.push(["Earnest money", money(s.earnest_money)]);
      if (s.seller) terms.push(["Seller", s.seller]);
      const dates = Array.isArray(s.dates) ? s.dates : [];
      const dateRows = dates.map((d, i) => {
        const past = d.on < today(), c = past ? null : countdown(d.on, today());
        return h("li", { class: past ? "past" : null },
          h("span", { class: "hs-dd" }, dayLabel(d.on, today())), h("span", { class: "hs-dw" }, d.label),
          past ? h("span", { class: "hs-mute" }, "Done") : c ? chip(c.text, c.hot ? "hot" : "") : h("span"),
          h("button", { type: "button", class: "hs-xs", "aria-label": "Remove " + d.label, onclick: () => {
            update(key, s.id, { dates: dates.filter((_, j) => j !== i) });
          } }, "×"));
      });
      const dateForm = state.dating === s.id
        ? h("form", { class: "hs-dform", onsubmit: (e) => {
          e.preventDefault();
          const f = e.currentTarget, on = f.elements.on.value, label = f.elements.label.value.trim();
          // Closed before the write: the redraw after it must not reopen it.
          // A refusal says why under the dates; two fields are quick to retype.
          state.dating = null;
          update(key, s.id, { dates: dates.concat([{ on, label }]) });
        } }, h("input", { type: "date", name: "on", required: true, "aria-label": "Date" }),
          h("input", { type: "text", name: "label", maxlength: 80, placeholder: "What happens", required: true, "aria-label": "What happens" }),
          h("button", { type: "submit", class: "hm-btn" }, "Add"),
          h("button", { type: "button", class: "hs-lnk", onclick: () => { state.dating = null; refill(); } }, "Cancel"))
        : h("button", { type: "button", class: "hs-lnk", onclick: () => { state.dating = s.id; refill(true); } }, "+ Add a date");
      const type = String(s.property_type || "Land");
      return [
        stepper(isPassed ? "" : s.stage, s.stage_dates),
        isPassed ? h("p", { class: "hs-mute hs-passed" }, "You passed on this" +
          (s.stage_dates && s.stage_dates.passed ? " on " + dayLabel(s.stage_dates.passed, today()) : "") + ".") : null,
        h("div", { class: "hs-acts" }, acts),
        msgLine(key),
        h("div", { class: "hs-grid" },
          blk("Key terms", h("dl", { class: "hs-terms" }, terms.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v))))),
          blk("Key dates", dates.length ? h("ul", { class: "hs-dates" }, dateRows) : h("p", { class: "hs-mute" }, "No dates yet."), dateForm),
          blk("Notes", h("p", { class: "hs-notes" }, s.notes || h("span", { class: "hs-mute" }, "None yet.")))),
        h("div", { class: "hs-foot" },
          h("a", { class: "hm-btn", href: "/?type=" + encodeURIComponent(type) + "&address=" + encodeURIComponent(s.address || "") },
            "Run a " + type.toLowerCase() + " report"),
          btn("Edit", "", () => { state.editing = s.id; refill(true); }),
          h("button", { type: "button", class: "hs-rm", onclick: () => removeDeal(key, s) }, "Remove")),
      ];
    }
    function editForm(key, s) {
      const stages = S.BUYING.concat(["passed"]).map((k) => [k, S.labelOf(k)]);
      const said = h("p", { class: "hs-wide dk-msg bad", role: "alert", hidden: true });
      return h("form", { class: "hs-form", "aria-label": "Edit " + street(s.address), onsubmit: (e) => {
        e.preventDefault();
        const f = e.currentTarget, v = (n) => String(f.elements[n].value || "").trim();
        const b = f.querySelector('button[type="submit"]'); b.disabled = true;
        send("POST", "/api/sites/update", { id: s.id, address: v("address"), property_type: v("property_type"), stage: v("stage"),
          acres: v("acres"), zoning: v("zoning"), asking_price: v("asking_price"), earnest_money: v("earnest_money"),
          seller: v("seller"), notes: v("notes") }).then((r) => {
          // Refused ("3.4M" for a price, say): the form stays as typed, with
          // the server's sentence under it, so nothing has to be typed again.
          if (r.s !== 200) { b.disabled = false; said.textContent = r.j.error || "That didn't save. Nothing has been lost."; said.hidden = false; return; }
          state.editing = null; delete state.msg[key];
          return after(undefined, "Saved " + street(v("address")) + ".");
        });
      } },
        field("Address", input("address", s.address, { maxlength: 300, required: true }), true),
        field("Property type", select("property_type", types.map((t) => [t, t]), s.property_type || "Land")),
        field("Stage", select("stage", stages, s.stage)),
        field("Acres", input("acres", s.acres, { inputmode: "decimal" })),
        field("Zoning", input("zoning", s.zoning, { maxlength: 40 })),
        field("Asking price", input("asking_price", s.asking_price, { inputmode: "decimal" })),
        field("Earnest money", input("earnest_money", s.earnest_money, { inputmode: "decimal" })),
        field("Seller", input("seller", s.seller, { maxlength: 120 }), true),
        field("Notes", input("notes", s.notes, { maxlength: 1000 }), true),
        h("div", { class: "hs-wide hs-fa" }, h("button", { type: "submit", class: "hm-btn red" }, "Save"),
          h("button", { type: "button", class: "hs-lnk", onclick: () => { state.editing = null; refill(); } }, "Cancel")),
        said);
    }
    // A stage move. Owned is two ordinary writes: the property joins the
    // member's holdings (POST /api/portfolio, with its own caps and
    // refusals), then the deal row becomes that property's status, keeping
    // its stage history ("How you bought it").
    function move(key, s, to) {
      if (to === "owned") {
        return send("POST", "/api/portfolio", { address: s.address, propertyType: s.property_type || "Land" }).then((r) => {
          if (r.s !== 200 || !r.j.id) return fail(key, r.j.error || "Couldn't add it to your properties. Nothing has been lost.");
          const pid = r.j.id;
          const stale = (data().sites || []).filter((x) => x.portfolio_item_id === pid && x.id !== s.id);
          return Promise.all(stale.map((x) => send("DELETE", "/api/sites?id=" + encodeURIComponent(x.id)))).then(() =>
            send("POST", "/api/sites/update", { id: s.id, stage: "owned", portfolio_item_id: pid })).then((u) => {
            if (u.s !== 200) return fail(key, u.j.error || "That didn't save. Nothing has been lost.");
            delete state.msg[key];
            return after(key, "Moved to Owned. " + street(s.address) + " is with what you own now.");
          });
        });
      }
      return send("POST", "/api/sites/update", { id: s.id, stage: to }).then((r) => {
        if (r.s !== 200) return fail(key, r.j.error || "That didn't save. Nothing has been lost.");
        delete state.msg[key];
        if (to === "passed") return after(null, "Passed on " + street(s.address) + ". It's under Passed if you change your mind.");
        // Back from Passed, the deal is a Buying row again, keyed by its address.
        const back = s.stage === "passed";
        return after(back ? ctx.keyOf(s.address) : key,
          back ? street(s.address) + " is back at Prospect." : street(s.address) + " moved to " + S.labelOf(to) + ".");
      });
    }
    function removeDeal(key, s) {
      if (!window.confirm("Remove " + street(s.address) + "? Its stages, dates and notes go with it.")) return;
      send("DELETE", "/api/sites?id=" + encodeURIComponent(s.id)).then((r) => {
        if (r.s !== 200) return fail(key, r.j.error || "That didn't go through. Nothing has been lost.");
        return after(null, "Removed " + street(s.address) + ".");
      });
    }

    // ---- a property they hold ----
    function heldPane(key, it, status) {
      const d = data(), show = !!d.showValues, m = held(it, status);
      const href = "/?property=" + encodeURIComponent(it.id);
      const out = [];
      if (show) {
        out.push(h("div", { class: "hs-val" },
          h("div", null, h("span", { class: "hs-vl" }, "Likely value"), h("b", { class: "hs-vb" }, m.likely ? money(m.likely) : "—"),
            h("span", { class: "hs-vs" }, m.likely
              ? [m.chg != null ? h("span", { class: m.chg >= 0 ? "hs-up" : "hs-dn" }, (m.chg >= 0 ? "▲ " : "▼ ") + Math.abs(m.chg).toFixed(1) + "%") : null,
                m.chg != null ? " vs the check before" : "",
                m.last && m.last.low && m.last.high ? (m.chg != null ? " · " : "") + "range " + short(m.last.low) + " to " + short(m.last.high) : ""]
              : "No value yet. Refresh runs a search for one.")),
          h("div", null, h("span", { class: "hs-vl" }, "Checked"), h("b", { class: "hs-vc" }, m.checked ? tsLabel(m.checked) : "Never"),
            m.stale ? chip("Over a year ago", "warn") : null)));
      }
      const blocks = [];
      const c = show ? chart(m.snaps) : null;
      if (c) blocks.push(blk("Value at each check", c));
      if (show && m.movement) {
        blocks.push(blk("The market since your last check", h("p", { class: "hs-notes" }, m.movement),
          h("p", { class: "hs-mute" }, "From sales other people's reports found. Not a new value for this building.")));
      }
      if (d.firm) {
        blocks.push(blk("Your firm", onFirmList(it, d.buildings)
          ? h("p", { class: "hs-notes" }, "On " + d.firm.name + "'s buildings.")
          : h("p", { class: "hs-notes" }, "Not on " + d.firm.name + "'s buildings yet. ",
            h("button", { type: "button", class: "hs-lnk", onclick: (e) => addToFirm(key, it, e.currentTarget) }, "Add to firm"))));
      }
      if (status && status.stage_dates && status.stage_dates.prospect) blocks.push(blk("How you bought it", stepper("owned", status.stage_dates, "How you bought it")));
      if (blocks.length) out.push(h("div", { class: "hs-grid" }, blocks));
      out.push(msgLine(key));
      out.push(h("div", { class: "hs-foot" },
        h("a", { class: "hm-btn", href, title: "Open this report (no new search, no cost)" }, "Open report"),
        h("a", { class: "hm-btn", href: href + "&refresh=1", title: "Runs a new live search for this property" }, "Refresh value"),
        // A building watched rather than owned is The Board's (board.js, on
        // the Markets page, since 2026-10-09): this moves it there.
        btn("Watch it on The Board instead", "", (e) => { e.currentTarget.disabled = true; setHeld(key, it, status, "tracking"); }),
        h("button", { type: "button", class: "hs-rm", onclick: () => removeHeld(key, it, status) }, "Remove")));
      out.push(h("p", { class: "hs-mute hs-note" }, "Opening a report costs nothing. Refresh runs a new search."));
      return out;
    }
    function setHeld(key, it, status, to) {
      const done = status
        ? send("POST", "/api/sites/update", { id: status.id, stage: to })
        : send("POST", "/api/sites", { address: it.address, property_type: it.property_type, stage: to, portfolio_item_id: it.id });
      return done.then((r) => {
        if (r.s !== 200) return fail(key, r.j.error || "That didn't save. Nothing has been lost.");
        delete state.msg[key];
        // A watched building leaves Home for The Board, so its pane closes.
        return to === "tracking"
          ? after(null, street(it.address) + " is on The Board now, on the Markets page.")
          : after(key, street(it.address) + " is one you own now.");
      });
    }
    function removeHeld(key, it, status) {
      if (!window.confirm("Remove " + street(it.address) + " from your properties? Its value history goes with it.")) return;
      send("DELETE", "/api/portfolio?id=" + encodeURIComponent(it.id)).then((r) => {
        if (r.s !== 200) return fail(key, r.j.error || "That didn't go through. Nothing has been lost.");
        return (status ? send("DELETE", "/api/sites?id=" + encodeURIComponent(status.id)) : Promise.resolve(null))
          .then(() => after(null, "Removed " + street(it.address) + "."));
      });
    }
    function addToFirm(key, it, b) {
      b.disabled = true; b.textContent = "Adding…";
      Promise.resolve(ctx.addToFirm({ address: it.address, propertyType: it.property_type, verifiedKey: it.verified_key || "" })).then((out) => {
        const d = data();
        ctx.say(out && out.existed ? street(it.address) + " was already on " + d.firm.name + "'s list." : "Added " + street(it.address) + " to " + d.firm.name + "'s buildings.");
      }, (err) => fail(key, (err && err.message) || "That didn't go through. Nothing has been lost."));
    }

    // ---- the pane Home places under an open row ----
    function sigOf(row) {
      const d = data();
      const s = row.siteId != null ? (d.sites || []).find((x) => x.id === row.siteId) || null : null;
      const it = row.portfolioId != null ? (d.portfolio || []).find((x) => String(x.id) === String(row.portfolioId)) || null : null;
      return { s, it, sig: JSON.stringify([s, it, it ? statusFor(d.sites, it.id) : null, !!d.showValues,
        d.firm ? d.firm.name : null, it ? onFirmList(it, d.buildings) : null]) };
    }
    function fill(el, key, s, it) {
      const body = it ? heldPane(key, it, statusFor(data().sites, it.id)) : s ? dealPane(key, s) : [];
      el.replaceChildren(...body.flat().filter(Boolean));
    }
    // The working pane for one of Home's rows, or null when the row is not
    // the member's own (a firm building) or its data is gone. The same
    // element comes back while nothing about the row changed, so Home's
    // redraws (a geocode landing, say) never wipe a half-typed form.
    function pane(row) {
      if (!row || !row.key) return null;
      const { s, it, sig } = sigOf(row);
      if (!s && !it) return null;
      if (live && live.key === row.key && live.sig === sig && live.el) { live.row = row; return live.el; }
      if (!live || live.key !== row.key) { state.editing = null; state.dating = null; }
      const el = h("div", { class: "hs-pane", role: "region", "aria-label": street((s || it).address) });
      live = { key: row.key, el, sig, row };
      fill(el, row.key, s, it);
      return el;
    }
    // Draw the open pane again after something inside it changed (a form
    // opened, a write refused). `focus` puts the cursor in its first field.
    function refill(focus) {
      if (!live || !live.el) return;
      const { s, it, sig } = sigOf(live.row);
      live.sig = sig;
      fill(live.el, live.key, s, it);
      if (focus) { const f = live.el.querySelector("form input, form select"); if (f) f.focus(); }
    }

    // ---- the add form ----
    function addForm(kind) {
      state.addKind = kind === "own" ? "own" : "buy";
      state.addMsg = "";
      liveAdd = h("div", { class: "hs-add" });
      drawAdd();
      return liveAdd;
    }
    function keep() {
      const f = liveAdd && liveAdd.querySelector("form");
      return f ? Array.from(f.elements).filter((x) => x.name).map((x) => [x.name, x.value]) : [];
    }
    // A select keeps its value only where the redrawn form still offers it:
    // "I own it" has a "Choose one" that "I'm buying it" does not.
    function restore(kept) {
      const g = liveAdd && liveAdd.querySelector("form");
      if (!g) return;
      kept.forEach(([n, v]) => {
        const el = g.elements[n];
        if (!el) return;
        if (el.tagName === "SELECT" && !Array.from(el.options).some((o) => o.value === v)) return;
        el.value = v;
      });
    }
    function drawAdd() {
      if (!liveAdd) return;
      const k = state.addKind;
      const seg = h("div", { class: "hs-kind hs-wide", role: "radiogroup", "aria-label": "What is it" },
        [["buy", "I'm buying it"], ["own", "I own it"]].map(([v, t]) =>
          h("button", { type: "button", role: "radio", "aria-checked": k === v ? "true" : "false", class: k === v ? "on" : null,
            onclick: () => {
              const kept = keep(); state.addKind = v; drawAdd(); restore(kept);
              const b = liveAdd.querySelector('[role="radio"][aria-checked="true"]'); if (b) b.focus();
            } }, t)));
      const typeOpts = (k === "buy" ? [] : [["", "Choose one"]]).concat(types.map((t) => [t, t]));
      const fields = k === "buy"
        ? [field("Property type", select("property_type", typeOpts, "Land")),
          field("Stage", select("stage", S.BUYING.map((s) => [s, S.labelOf(s)]), "prospect")),
          field("Acres", input("acres", "", { placeholder: "18.4", inputmode: "decimal" })),
          field("Asking price", input("asking_price", "", { placeholder: "3,450,000", inputmode: "decimal" })),
          field("Next deadline", h("input", { type: "date", name: "next_on" })),
          field("What it is", input("next_label", "", { maxlength: 80, placeholder: "Due diligence ends" })),
          field("Notes", input("notes", "", { maxlength: 1000, placeholder: "Optional" }), true)]
        : [field("Property type", select("property_type", typeOpts, ""), true),
          h("p", { class: "hs-wide hs-mute" }, "No search runs. Use Refresh on it when you want a value. A building you only want to watch goes on The Board, on the Markets page.")];
      liveAdd.replaceChildren(h("form", { class: "hs-form", "aria-label": "Add a property", onsubmit: submitAdd },
        seg,
        field("Address", input("address", "", { maxlength: 300, placeholder: "Street, City, ST", required: true, autocomplete: "off" }), true),
        fields,
        h("div", { class: "hs-wide hs-fa" }, h("button", { type: "submit", class: "hm-btn red" }, "Add property"),
          h("button", { type: "button", class: "hs-lnk", onclick: () => { liveAdd = null; ctx.closeAdd(); } }, "Cancel")),
        state.addMsg ? h("p", { class: "hs-wide dk-msg bad", role: "alert" }, state.addMsg) : null));
    }
    function addFail(text) {
      state.busy = false;
      state.addMsg = text;
      const kept = keep(); drawAdd(); restore(kept);
      return false;
    }
    function submitAdd(e) {
      e.preventDefault();
      if (state.busy) return;
      const f = e.currentTarget, v = (n) => (f.elements[n] ? String(f.elements[n].value || "").trim() : "");
      const address = v("address");
      if (!address) return addFail("Type the property's address.");
      const added = (text) => { state.busy = false; liveAdd = null; ctx.closeAdd(); return after(ctx.keyOf(address), text); };
      if (state.addKind === "buy") {
        state.busy = true;
        const body = { address, property_type: v("property_type") || "Land", stage: v("stage") || "prospect",
          acres: v("acres"), asking_price: v("asking_price"), notes: v("notes") };
        if (v("next_on") || v("next_label")) body.dates = [{ on: v("next_on"), label: v("next_label") }];
        send("POST", "/api/sites", body).then((r) => r.s !== 200
          ? addFail(r.j.error || "That didn't save. Nothing has been lost.")
          : added("Added " + street(address) + "."));
        return;
      }
      const type = v("property_type");
      if (!type) return addFail("Which kind of property is it?");
      state.busy = true;
      send("POST", "/api/portfolio", { address, propertyType: type }).then((r) => {
        if (r.s !== 200 || !r.j.id) return addFail(r.j.error || "That didn't save. Nothing has been lost.");
        return added(r.j.existed ? street(address) + " was already with your properties."
          : "Added " + street(address) + ". Use Refresh on it when you want a value.");
      });
    }

    return { pane, addForm };
  }

  return { PROP_TYPES, money, short, acres, perAcre, dayLabel, tsLabel, countdown, figures, figuresLine, steps, held, statusFor, onFirmList, street, mount };
});
