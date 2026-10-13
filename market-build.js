// ---------------------------------------------------------------------------
// Build a market from /markets (2026-10-13; the owner: "right now I don't see
// where to insert the city").
//
// The Market Explorer's build step (POST /api/explore-market) lost its only
// door on 2026-09-04: its box sat beside the comp form, the comp form left
// Home, and /run-report left every nav. /bulk deliberately did not carry the
// box over because "/markets is that page", and /markets only ever FILTERED
// its cards. This file is the missing half: under the filter box, when what a
// member typed names a market with no card, it offers to build that page.
//
// Rules this file keeps:
//   * It decides nothing the server re-checks. The route validates the type,
//     the state, the city (city-check.js), the guest gate, the per-visitor
//     limiter and the daily cap; a refusal comes back as the route's own
//     sentence. An existing page short-circuits server-side too, so a stale
//     offer costs nothing.
//   * Members only. /markets for an anonymous visitor is cached publicly,
//     and the route would ask them to sign in anyway; server.js loads this
//     script only into the signed-in page.
//   * Parsing is explore-query.js's (EXPLOREQ), the Explorer's own, so the
//     two doors read one query the same way. Without it this file offers
//     nothing rather than guessing.
//   * A build is never automatic: it costs a billed search, so it runs only
//     on a click on the button that names the market.
//   * Built with createElement/textContent; progress text is model-written.
//
// Dual-exported: Node gets the pure helpers (test/market-build.test.js), the
// browser gets the global MARKETBUILD, whose mount() the Markets page calls.
// Served at /market-build.js with maxAge 0.
// ---------------------------------------------------------------------------
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MARKETBUILD = api;
})(typeof self !== "undefined" ? self : this, function () {

  const TYPES = ["Industrial", "Office", "Retail", "Multifamily"];

  // ⚠ Twin of market-snapshot.js's slugify (server-side page keys). This
  // only decides whether a card already exists; the server's own lookup is
  // what actually short-circuits, so a drift here offers a build that then
  // simply opens the existing page.
  function slugFor(type, city, state) {
    return `${type}-${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // What to show under the filter for a query.
  //   parse    — EXPLOREQ.parseExploreQuery
  //   existing — a Set of the slugs that have a card on the page
  //   shown    — how many cards the filter left on screen
  // Returns null (show nothing), { kind: "build", type, city, state },
  // { kind: "types", city, state, types: [...] } or { kind: "hint", text }.
  function offerFor(query, parse, existing, shown) {
    const q = String(query || "").trim();
    if (!q || typeof parse !== "function") return null;
    const p = parse(q) || {};
    const has = (t, c, s) => existing.has(slugFor(t, c, s));
    if (p.type && p.city && p.state) {
      return has(p.type, p.city, p.state) ? null : { kind: "build", type: p.type, city: p.city, state: p.state };
    }
    if (p.reason === "no-type" && p.city && p.state) {
      const types = TYPES.filter((t) => !has(t, p.city, p.state));
      return types.length ? { kind: "types", city: p.city, state: p.state, types } : null;
    }
    // The rest are hints, and only when the filter found nothing: "Boise"
    // with a Boise card on screen is a search that worked.
    if (shown > 0) return null;
    if (p.reason === "no-state") return { kind: "hint", text: "To build a page for a new market, add the state, e.g. industrial Twin Falls ID." };
    if (p.reason === "zip") return { kind: "hint", text: "To build a page for a new market, type its city and state, e.g. industrial Twin Falls ID." };
    if (p.reason === "unsupported-type") return { kind: "hint", text: "Market pages cover Industrial, Office, Retail and Multifamily." };
    return null;
  }

  // Server-sent events out of a growing text buffer. Returns the complete
  // events and whatever is left of a partial one.
  function parseSse(buf) {
    const events = [];
    const blocks = String(buf).split(/\r?\n\r?\n/);
    const rest = blocks.pop();
    for (const block of blocks) {
      let event = "message", data = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;   // the padding comment and anything without data
      try { events.push({ event, data: JSON.parse(data) }); } catch (_) {}
    }
    return { events, rest };
  }

  // A progress event as { head, detail, pct }; any field may be absent.
  function progressOf(evt, compsSoFar) {
    if (!evt || !evt.phase) return {};
    switch (evt.phase) {
      case "start": return { head: "Searching recent sales…", pct: 12 };
      case "search": return {
        head: "Searching recent sales…",
        detail: String(evt.query || "").replace(/\s+/g, " ").trim().slice(0, 70),
        pct: 20 + (Number(evt.n) || 0) * 5,
      };
      case "results": return { detail: evt.count ? `${evt.count} results to review` : undefined, pct: 48 };
      case "writing": return { head: "Building the page…", detail: "Reading sale prices and sizes", pct: 55 };
      case "drafting": return { pct: 50 + Math.min(45, ((Number(evt.chars) || 0) / 7500) * 45) };
      case "comp": return { detail: `${compsSoFar} recent sale${compsSoFar === 1 ? "" : "s"} found` };
      case "retry": return { head: "The results came back oddly, rechecking…", detail: "" };
      default: return {};
    }
  }

  function mount(opts) {
    const input = opts.input, box = opts.root, parse = opts.parse, count = opts.count || null;
    if (!input || !box || typeof parse !== "function") return;
    const cards = [].slice.call(document.querySelectorAll(".mcard"));
    const existing = new Set(cards.map((el) =>
      (el.getAttribute("href") || "").replace(/^\/market\//, "")));
    let building = false;

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const clear = () => { while (box.firstChild) box.removeChild(box.firstChild); };
    const shown = () => cards.filter((c) => c.style.display !== "none" && !c.classList.contains("mmhide")).length;
    const label = (t, c, s) => `${t} · ${c}, ${s}`;

    function render() {
      if (building) return;
      clear();
      const o = offerFor(input.value, parse, existing, shown());
      box.hidden = !o;
      if (!o) return;
      // The filter just said "No markets match"; the offer below says it
      // better, so the two never stack.
      if (count && o.kind !== "hint" && shown() === 0) count.textContent = "";
      if (o.kind === "hint") { box.appendChild(el("p", "mb-note", o.text)); return; }
      if (o.kind === "build") {
        const line = el("p", "mb-line");
        line.appendChild(document.createTextNode("No page for "));
        line.appendChild(el("strong", null, label(o.type, o.city, o.state)));
        line.appendChild(document.createTextNode(" yet."));
        box.appendChild(line);
        const btn = el("button", "btn sm", "Build it →");
        btn.type = "button";
        btn.id = "mbuildGo";
        btn.addEventListener("click", () => build(o));
        box.appendChild(btn);
      } else {
        const line = el("p", "mb-line");
        line.appendChild(document.createTextNode("Build a page for "));
        line.appendChild(el("strong", null, `${o.city}, ${o.state}`));
        line.appendChild(document.createTextNode(" as:"));
        box.appendChild(line);
        const row = el("div", "mb-types");
        o.types.forEach((t) => {
          const b = el("button", "btn sm", t + " →");
          b.type = "button";
          b.addEventListener("click", () => build({ type: t, city: o.city, state: o.state }));
          row.appendChild(b);
        });
        box.appendChild(row);
      }
      box.appendChild(el("p", "mb-note", "We pull recent sales and build the page. It takes about a minute and counts as one search."));
    }

    function fail(msg, signIn) {
      building = false;
      input.readOnly = false;
      box.removeAttribute("aria-busy");
      clear();
      box.hidden = false;
      box.appendChild(el("p", "mb-err", msg));
      if (signIn) {
        // The page was drawn for a member, but the session behind it has
        // gone; the route said so, and nothing was spent.
        const a = el("a", "btn sm", "Sign in →");
        a.href = "/?auth=signin";
        box.appendChild(a);
      } else {
        box.appendChild(el("p", "mb-note", "Adjust the search and try again, e.g. industrial Twin Falls ID."));
      }
    }

    async function build(o) {
      if (building) return;
      building = true;
      input.readOnly = true;
      clear();
      box.hidden = false;
      box.setAttribute("aria-busy", "true");
      const head = el("p", "mb-line");
      head.appendChild(document.createTextNode("Building "));
      head.appendChild(el("strong", null, label(o.type, o.city, o.state)));
      head.appendChild(document.createTextNode("…"));
      const sub = el("p", "mb-sub", "Usually 30 to 60 seconds. Keep this tab open.");
      const track = el("div", "mb-track");
      const bar = el("div", "mb-bar");
      bar.style.width = "6%";
      track.appendChild(bar);
      const detail = el("p", "mb-note", "");
      box.appendChild(head); box.appendChild(sub); box.appendChild(track); box.appendChild(detail);
      let comps = 0;
      const apply = (evt) => {
        if (evt && evt.phase === "comp") comps++;
        if (evt && evt.phase === "retry") comps = 0;
        const p = progressOf(evt, comps);
        if (p.head) sub.textContent = p.head;
        if (p.detail !== undefined) detail.textContent = p.detail;
        if (p.pct) bar.style.width = Math.max(6, Math.min(97, p.pct)) + "%";
      };
      try {
        let pw = "";
        try { pw = sessionStorage.getItem("APP_PASSWORD") || ""; } catch (_) {}
        const res = await fetch("/api/explore-market", {
          method: "POST",
          headers: { "content-type": "application/json", "x-app-password": pw },
          body: JSON.stringify({ type: o.type, city: o.city, state: o.state, stream: true }),
        });
        const ct = res.headers.get("content-type") || "";
        let data = null;
        if (ct.indexOf("text/event-stream") !== -1 && res.body && res.body.getReader) {
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const out = parseSse(buf + dec.decode(value, { stream: true }));
            buf = out.rest;
            for (const e of out.events) {
              if (e.event === "progress") apply(e.data);
              else if (e.event === "result" || e.event === "error") data = e.data;
            }
            if (data) break;
          }
          if (!data) throw new Error("The connection dropped before the page finished. Please try again.");
        } else {
          try { data = await res.json(); } catch (_) { data = null; }
          if (data && data.signin_required) return fail(data.error || "Sign in to build a market page.", true);
          if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
        }
        if (data && data.url) { window.location.href = data.url; return; }
        throw new Error((data && data.error) || "Something went wrong. Please try again.");
      } catch (err) {
        fail(err instanceof TypeError ? "Connection lost. Please try again." : (err.message || "Something went wrong. Please try again."));
      }
    }

    input.addEventListener("input", render);
    // Enter builds only when the filter left nothing to open: the filter's
    // own Enter opens the first card, and that must keep winning.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || building || shown() > 0) return;
      const go = document.getElementById("mbuildGo");
      if (go) { e.preventDefault(); go.click(); }
    });
    render();
  }

  return { offerFor, parseSse, progressOf, slugFor, mount, TYPES };
});
