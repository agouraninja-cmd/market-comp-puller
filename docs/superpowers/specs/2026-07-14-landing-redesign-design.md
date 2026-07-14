# CompNinja Landing Redesign — "Research Desk" Direction

**Date:** 2026-07-14
**Status:** Approved by owner (mockup: claude.ai artifact `c992bcb8`, direction picked from 3 candidates)
**Goal:** Make the landing page and brand look professional and hand-designed — credible enough to pitch brokers — without changing any functionality.

## Why

The owner is starting broker outreach (Founding Broker sponsorships) in July 2026. The current landing page reads as AI-generated: gradient-glow dark hero, uppercase condensed headline, checkmark pills, mascot easter eggs, floating Tailwind cards. The redesign replaces the landing chrome with an institutional "research portal" look. The judgment bar: *would a broker trust this page with a $4M building?*

## Design direction (approved)

Institutional and quiet, like a Green Street / JLL research portal.

### Tokens

| Role | Value |
|---|---|
| Page ground | `#FBFBF9` paper white |
| Ink / headings / footer bg | `#1A2433` deep navy |
| Accent (sparing) | `#B91C1C` red — kicker labels, submit button, wordmark "NINJA", logo slice |
| Hairlines / borders | `#E4E2DA` warm gray (`#D8D4C9` for form/exhibit borders) |
| Alt section ground | `#F5F4EF` |
| Muted text | `#5A6473` (nav), `#4C5665` (body), `#8A93A0` (labels) |
| Display face | Georgia, "Times New Roman", serif — headlines only, weight 500, sentence case |
| UI face | "Segoe UI", system-ui, sans-serif |
| Labels | 10.5–12px, uppercase, letter-spacing 0.1–0.16em |

No webfonts (site stays self-contained). No gradients, no glow, no drift animation, no entrance animations beyond what exists. Numbers use `tabular-nums`.

### Logo

- **Mark:** "cut card" — a navy rounded rectangle (a comp card) sliced by a clean red diagonal. Inline SVG, ~26–44px. Two-color: `#1A2433` + `#B91C1C` (white card variant on dark footer).
- **Wordmark:** `COMPNINJA` — spaced caps (letter-spacing ~0.14em), semibold, UI face; `COMP` in ink, `NINJA` in red.
- **Favicon:** replace the current headband glyph with the cut-card mark (same inline data-URI mechanism in `<head>`).
- The old ninja-with-headband iconography, skyline silhouette, and rooftop-ninja easter egg are **removed** from the landing chrome. (The in-search loading ninja on the progress bar is out of scope — untouched for now.)

## Page structure (top to bottom)

1. **Header** — logo + wordmark left; nav right: `Markets` (→ `/markets`), `For Brokers` (→ broker section anchor), `Methodology` (→ method section anchor). No CTA button in the header — the form is the hero. Single hairline below.
2. **Hero** — kicker `COMMERCIAL COMP REPORTS`; serif H1 **"Know what the building is worth before you make the call."**; one-line sub (live search, every comp cited, ~1 minute). Light ground (this replaces the dark hero entirely).
3. **Search form** — same fields and element IDs as today (`compForm`, `address`, `propertyType`, `marketNote`, `lookback`, `lookbackCustom`, `txFocus`, `subjectDetails` + subject inputs), recomposed as one bordered unit: cells divided by hairlines, uppercase micro-labels above each input, borderless inputs inside cells. Footer row: "+ Your property details (size, price, NOI) — optional" expander trigger left, red **"Run a report"** submit right. Exactly one CTA on the page, labeled once. Fine print below: *Free · No account required · An automated estimate, not an appraisal*.
4. **Stat strip** — 4 cells separated by hairlines: `27 markets covered` (keep in sync with actual market-seed count) · `3–6 cited comps per report` · `~60s search to report` · `100% sources disclosed`.
5. **The Report (exhibit)** — alt ground. Static sample report styled as a research exhibit: caption bar, left column value range + "what's driving prices," right column comp table with source badges incl. `Verified · via <firm>`. Hardcoded sample data (realistic Rancho Cucamonga industrial), clearly captioned "Sample report." Below: badge legend (Verified / Public record / Listing) + the line "Badges under-claim, never over-claim."
6. **Method** — 3 steps in one bordered row, serif Roman numerals: Search live / Cite everything / Value the subject (incl. "your figures stay in your browser").
7. **For Brokers** — alt ground, two cards: *Submit a comp, get the credit* (→ existing comp-submission UI) and *Meet owners already asking about value* (→ `mailto:agouraninja@gmail.com` with a prefilled subject, same as today's contact CTA). This section doubles as the landing spot for founding-broker pitches.
8. **Markets** — multi-column list of market-page links (subset + "All 27 markets →" to `/markets`).
9. **Footer** — navy ground, white-card logo variant, plain-English disclosure: automated estimate not an appraisal; not a licensed brokerage — we connect you with local brokers; verify independently before underwriting. Contact email. No mode toggles, no extra nav.

Everything below the landing chrome — results rendering, report UI, exports, lead-capture modals, password gate, share-report view — is **functionally out of scope**; restyle only where colors/typography must cohere (e.g., section heading faces), and do not change any JS behavior or element IDs.

## Constraints & mechanics

- **No functional changes.** All JS hooks, IDs, endpoints, and flows stay identical. `#owner` deep link still opens the property-details section.
- **Tailwind:** new utilities used in `index.html` require regenerating vendored `tailwind.css` — the local auto-regen hook handles this; do not hand-edit `tailwind.css`. Bespoke landing styles may live in the existing inline `<style>` block instead of stretching Tailwind.
- **Self-contained:** no webfonts, no new CDNs. Inline SVG for the logo.
- **Print styles** must keep producing a clean document (unchanged expectations).
- **Responsive:** form cells stack on mobile; stat strip wraps 2×2; exhibit columns stack; markets list drops to 2 columns.
- **SEO/meta:** canonical/OG/JSON-LD mechanism untouched. `SITE_URL` rewrite behavior unaffected.
- Copy rules: "connect you with a local broker," never "we are brokers"; "automated estimate," never "appraisal."

## Out of scope (follow-ups)

- Market pages (`/market/<slug>`) have their own inline styles — restyle to match in a later pass.
- OG share image refresh.
- The in-app loading ninja and report-body typography pass.

## Verification

- Run dev server; full search end-to-end (Industrial + one other type); confirm report renders, exports (CSV/PNG/print) work, subject-details expander works, `#owner` opens it, `/r/<id>` shared view renders.
- Mobile-width pass (375px) and print preview.
- Confirm no `tailwind.css` class is missing (hook regen ran) and no console errors.
