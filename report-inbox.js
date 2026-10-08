// report-inbox.js — the rules behind Messages' Reports view (2026-10-08).
//
// The owner's call that day: Home and its Reports tab were "the exact same
// thing", so the tab and its rail row went, and the rest of the reports moved
// "into messages". Home's Reports tab held three lists (the firm's shelf,
// what was sent to the member, and the links they sent). In Messages they are
// one list beside the chats, because a shared report is correspondence:
// somebody sent it to somebody. This file decides what is in that list and
// how each row reads; messages-page.js draws it. Pure and dual-exported, like
// home-map.js: Node requires it for npm test, and messages-page.js emits this
// whole file inside the page's one script, where it sets the global
// REPORTINBOX. No second request, and never a copy that can drift from what
// the tests ran. So a closing script tag may never appear anywhere in this
// file, comments included (test/messages-page.test.js checks).
//
// Five rules, each tested in test/report-inbox.test.js:
//
//   1. THREE GROUPS, IN THIS ORDER: Sent to you (the one group that asks
//      something of the reader), the firm's shelf (the firm's record), Sent
//      by you.
//   2. A REPORT AND ITS DEAL ROOM ARE ONE ROW (the Sharing card's merge of
//      2026-10-06, carried over): a room opened from a report sent to you
//      joins that report's row as a second door. A room with no report is a
//      chat, and stays in Chats.
//   3. A FIRM SHARE IS LISTED ONCE, on the shelf being shown, where its Take
//      down is. One left on the shelf of a firm the member has since left
//      stays in Sent by you, the only place left to turn it off.
//   4. THE SHELF'S COUNTS DESCRIBE THE WHOLE SHELF, never the filtered view
//      ("3 reports" under a search hiding twenty is how a record stops being
//      trusted), and a search with no hits says so rather than reading as a
//      shelf that was wiped.
//   5. THE SHELF OPENS ON THE FIRM'S SAVED VIEW (a development shop on Land,
//      org-access.js SHOP_COPY's shelfType) only while its type filter is on
//      screen, from MIN_FILTER reports up, and only until the reader picks a
//      type themselves: a hidden control quietly hiding rows would make a
//      small shelf look like one that lost something.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.REPORTINBOX = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MIN_FILTER = 6;
  const str = (v) => (v == null ? "" : String(v));
  const key = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const newestFirst = (a, b) => str(b.date).localeCompare(str(a.date));

  // Rule 2. `reports` is GET /api/shares' sharedWithMe; `rooms` is the deal
  // rooms Messages already lists (GET /api/messages' external). Only a room
  // somebody else opened can have come from a report sent to this reader, and
  // it joins on the report's address (a room started from a report is titled
  // with it) unless both name a sender and the names disagree.
  function received(reports, rooms) {
    const theirs = (Array.isArray(rooms) ? rooms : []).filter((h) => h && !h.owner);
    const used = new Set();
    return (Array.isArray(reports) ? reports : []).filter((r) => r && r.id).map((r) => {
      const k = key(r.address);
      const from = str(r.from);
      const room = k ? theirs.find((h) => {
        if (used.has(h.id) || key(h.title) !== k) return false;
        const who = h.people && h.people[0] ? str(h.people[0].name) : "";
        return !from || !who || who === from;
      }) : null;
      if (room) used.add(room.id);
      return {
        kind: "in", id: str(r.id), address: str(r.address), type: str(r.type), url: str(r.url),
        from, date: str(r.invitedAt),
        // null, not merely missing: an older answer without the field must
        // not light every row up as new.
        isNew: r.viewedAt === null,
        room: room ? { id: str(room.id), closed: Boolean(room.closed) } : null,
      };
    }).sort(newestFirst);
  }

  // Who can open a link the member sent, said as a state rather than a
  // sentence. Revoked wins over the audience. The firm case is named
  // explicitly: a firm share once inherited "Anyone with the link", which
  // told the person who restricted it that they had published it.
  function audience(r) {
    const viewers = Array.isArray(r && r.viewers) ? r.viewers : [];
    if (r && r.revokedAt) return { label: "Turned off", sub: "" };
    if (r && r.visibility === "invited") {
      const opened = viewers.filter((v) => v && v.firstViewedAt).length;
      return { label: `${viewers.length} ${viewers.length === 1 ? "person" : "people"}`,
        sub: viewers.length ? (opened ? `${opened} opened it` : "Not opened yet") : "" };
    }
    if (r && r.visibility === "org") return { label: r.firm ? `Shared with ${r.firm}` : "Shared with your firm", sub: "" };
    return { label: "Anyone with the link", sub: "" };
  }

  // Rule 3. `mine` is GET /api/shares' mine; `firmId` the firm whose shelf
  // is showing ("" with none).
  function sent(mine, firmId) {
    const firm = str(firmId);
    return (Array.isArray(mine) ? mine : [])
      .filter((r) => r && r.id && !(r.visibility === "org" && firm && r.orgId && str(r.orgId) === firm))
      .map((r) => ({
        kind: "out", id: str(r.id), address: str(r.address), type: str(r.type), url: str(r.url),
        date: str(r.createdAt), visibility: str(r.visibility), revoked: Boolean(r.revokedAt),
        viewers: (Array.isArray(r.viewers) ? r.viewers : []).map((v) => ({ email: str(v && v.email), openedAt: str(v && v.firstViewedAt) })),
        audience: audience(r),
      }))
      .sort(newestFirst);
  }

  // Rule 4. `items` is GET /api/org/shelf's items. `q` searches the address,
  // market, type and sharer; `type` is the type filter's value.
  function shelf(items, { q = "", type = "" } = {}) {
    const all = (Array.isArray(items) ? items : []).filter(Boolean).map((i) => ({
      kind: "shelf", id: str(i.id), address: str(i.address), type: str(i.type), market: str(i.market), url: str(i.url),
      sharedBy: str(i.sharedBy), mine: Boolean(i.mine), date: str(i.createdAt),
    }));
    const terms = str(q).toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter((i) => (!type || i.type === type) &&
      terms.every((t) => `${i.address} ${i.market} ${i.type} ${i.sharedBy}`.toLowerCase().includes(t)));
    const filtering = Boolean(terms.length || type);
    return {
      rows: shown, total: all.length, filtering,
      count: filtering ? `${shown.length} of ${all.length}` : "",
      filters: all.length >= MIN_FILTER,
      noMatch: filtering && !shown.length && all.length > 0,
    };
  }

  // Rule 5. What the shelf's type filter shows: nothing while the filter is
  // off screen, the reader's own pick once they have made one, else the
  // firm's saved view.
  function shelfType({ total = 0, touched = false, picked = "", saved = "" } = {}) {
    if (total < MIN_FILTER) return "";
    return touched ? str(picked) : str(saved);
  }

  // The search box over Sent to you and Sent by you (the shelf filters itself).
  function matches(row, q) {
    const terms = str(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = [row.address, row.type, row.from, row.audience && row.audience.label,
      ...(row.viewers || []).map((v) => v.email)].map(str).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  }

  // "Discuss" sends a report to a colleague as its LINK, so report-access.js
  // stays the only judge of who may open it. Never a copy of the payload.
  function discussText(row) {
    return `About the ${row.type ? row.type + " " : ""}report on ${str(row.address)}: ${str(row.url)}`;
  }

  return { MIN_FILTER, received, audience, sent, shelf, shelfType, matches, discussText };
});
