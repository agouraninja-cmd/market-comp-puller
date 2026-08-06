// ---------------------------------------------------------------------------
// Which brokers cover which markets — the public directory rules.
//
// Roadmap: docs/ROADMAP.md — the connection hub, the other half of the
// business. This is its first step: a property owner in Boise being able to
// see who works Boise industrial.
//
// PURE, like entitlements.js, comp-gate.js and broker-vault.js: no I/O, no
// requires, no clock reads. server.js owns the reads; this owns the rules
// about who may be shown and what may be said about them. That is what lets
// `npm test` prove the consent and PII rules with no database — and those are
// the two rules where being wrong is a real harm to a real person.
//
// ---------------------------------------------------------------------------
// TWO CONSENTS, NOT ONE
// ---------------------------------------------------------------------------
// This joins two tables that were built for different purposes, and the whole
// correctness of it lives in keeping them straight:
//
//   broker_coverage  — "which markets do I want LEADS from" (migration 015,
//                      the lead inbox). A working preference. A broker ticking
//                      Boise industrial there consented to RECEIVE demand, not
//                      to be listed on a public web page.
//
//   broker_profiles.public — "may CompNinja show me publicly" (migration 003).
//                      THE opt-in. It already exists, it is already what
//                      /broker/<slug> honours, and it is false by default.
//
// So coverage answers WHICH markets, and `public` answers WHETHER to list at
// all. Reading coverage as though it were publication consent would put every
// broker who ever configured a lead inbox onto a public page they never asked
// to be on. It would also look completely fine.
//
// ---------------------------------------------------------------------------
// WHAT A PUBLIC ROW MAY SAY
// ---------------------------------------------------------------------------
// Name, company, and a link to the profile page they opted into. Nothing else.
//
// Deliberately NOT email or phone, even though the existing
// findBrokersForMarket() carries both: that one feeds an owner-facing email
// and never reaches a browser. The product's standing rule is that routing is
// owner-mediated — broker contact details go to the owner, never the reverse,
// and a public directory is the reverse by definition. An allowlist rather
// than a delete, so a column added to broker_profiles later cannot appear here
// by default.
// ---------------------------------------------------------------------------

// Exactly what a public listing may carry. Adding to this list is a decision
// about someone's personal information, so it should be an edit somebody makes
// on purpose and a reviewer can see.
const PUBLIC_BROKER_FIELDS = Object.freeze(["slug", "display_name", "company"]);

function publicBrokerRow(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  if (profile.public !== true) return null;            // the opt-in, tested strictly
  if (!profile.slug) return null;                       // no slug, no page to link to
  const out = { url: `/broker/${profile.slug}` };
  for (const f of PUBLIC_BROKER_FIELDS) {
    if (profile[f] !== null && profile[f] !== undefined && profile[f] !== "") out[f] = profile[f];
  }
  // A listing with no name is a link that says nothing. Company alone is fine
  // — plenty of brokers list under a firm — but something must be readable.
  if (!out.display_name && !out.company) return null;
  return out;
}

// Brokers to show on one market page.
//
// `coverage` is the rows for THIS (market, property_type); `profilesByUser` is
// the profile for each of those user_ids. Both are fetched by server.js, which
// owns the scoping.
//
// Dedupes by slug: a broker whose coverage row appears twice (earned and
// chosen for the same pair should be impossible under the unique constraint,
// but a join is a join) is one person and gets listed once.
function brokersForMarket(coverage, profilesByUser) {
  const cov = Array.isArray(coverage) ? coverage : [];
  const byUser = profilesByUser instanceof Map
    ? profilesByUser
    : new Map(Object.entries(profilesByUser || {}));

  const seen = new Set();
  const out = [];
  for (const c of cov) {
    if (!c || !c.user_id) continue;
    const row = publicBrokerRow(byUser.get(c.user_id));
    if (!row || seen.has(row.slug)) continue;
    seen.add(row.slug);
    out.push(row);
  }

  // Stable, name-first ordering. Deliberately NOT by coverage source or by
  // how much a broker has contributed: this is a directory, not a ranking, and
  // a ranking is a promise about quality that nothing here can support.
  out.sort((a, b) =>
    String(a.display_name || a.company).localeCompare(String(b.display_name || b.company)));
  return out;
}

module.exports = { brokersForMarket, publicBrokerRow, PUBLIC_BROKER_FIELDS };
