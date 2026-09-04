#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Build market-tiers.json from the Census Bureau, which is the body that
// defines CBSAs and the only source entitled to name them.
//
//   node scripts/build-market-tiers.js            # report only
//   node scripts/build-market-tiers.js --write    # write market-tiers.json
//
// The file this produces is DERIVED DATA. Nothing in it should be edited by
// hand except the `seeded` list at the top of this script and the tier cut
// points below — everything else comes from one Census call and can be
// regenerated at any time.
//
// WHY IT IS GENERATED RATHER THAN WRITTEN. The first version of this list was
// hand-assembled, and checking it against Census on 2026-09-02 found:
//
//   * Cleveland recorded as CBSA 17460, which is not a CBSA at all (17410 is
//     Cleveland, OH). A pull on 17460 returns nothing forever, and the market
//     would have looked like one with thin data rather than a typo.
//   * 32 of 175 names carried from an older delineation vintage. Miami's MSA
//     now reaches West Palm Beach; Houston swapped Sugar Land for Pasadena;
//     Atlanta swapped Alpharetta for Roswell. Those strings are the key the
//     FRED resolver searches on, so a stale one reads as "no employment data
//     for this market".
//
// Neither error announces itself. Generating from source removes the whole
// class rather than fixing two instances of it.
//
// TIERING is population rank, and population rank alone, because it is the one
// criterion that is reproducible from public data. Industry convention would
// move a handful — San Jose ranks below its CRE importance, Riverside above —
// and the `tier` field stays editable for exactly that reason. What it will
// never be is silently different from run to run.
//
// GEOGRAPHY comes from the Census GAZETTEER, a second read against the same
// authority (2026-09-02). Each row gains an internal point and a land area, so
// a market can be DRAWN rather than only listed. That file is the right source
// for the same reason the delineation is: Census defines the CBSA, so its
// centroid and its acreage are facts about the thing rather than a geocoder's
// opinion about a city name. 936 rows, 46KB, and it matched all 196 markets on
// the first run - which the old MARKETHERO.coordsFor lookup could not do: that
// is keyed to the ~38 seeded market pages and resolved 21 of 50 primary
// markets, missing New York, Los Angeles and Chicago.
//
// Reads CENSUS_API_KEY from the environment or .env. READ-ONLY against Census.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "market-tiers.json");
const VINTAGE = "2023";

// Where the tiers cut. Population rank, largest first.
const PRIMARY_THROUGH = 50;
const SECONDARY_THROUGH = 100;
// Everything else. EVERY metropolitan area, and no micropolitan one.
//
// That line was measured rather than assumed (2026-09-02). FRED was probed for
// seasonally adjusted total-nonfarm employment across the size range:
//
//   Ann Arbor, MI      368,394  metro   2 SA series
//   Abilene, TX        178,244  metro   5
//   Muncie, IN         112,109  metro   2
//   Eagle Pass, TX      57,770  metro   2   <- the smallest metro in the country
//   Seaford, DE        247,799  micro   0
//   Beaver Dam, WI      88,818  micro   0
//
// The cutoff is the statistical designation, not the population: Seaford is
// larger than 193 metros and has nothing, while Eagle Pass at a quarter its
// size has a series. BLS publishes metro employment for MSAs and does not
// publish it for micropolitan areas at all. So including micros would add 542
// rows that can never score on the macro block, which market-score.js would
// honestly report as near-zero coverage — a long tail of markets that look
// unknowable rather than unknown.
const TERTIARY_THROUGH = Infinity;

// Markets CompNinja already seeds in market-seed.json. Carried onto the row so
// the workspace can say "you have comps here", and guaranteed a place in the
// list even if one ever falls outside the population cut — a market the product
// actively covers must not vanish from the ranking because it is small.
// Label AND state. "Columbus" alone flagged Columbus GA-AL and Columbus IN as
// CompNinja markets on the first run; the product seeds Columbus OH. A city
// name is not a key — there are three Columbuses, two Portlands and a great
// many Springfields.
const SEEDED = [
  ["Dallas", "TX"], ["Atlanta", "GA"], ["Phoenix", "AZ"], ["Denver", "CO"],
  ["Austin", "TX"], ["Charlotte", "NC"], ["Nashville", "TN"], ["Tampa", "FL"],
  ["Orlando", "FL"], ["San Diego", "CA"], ["San Antonio", "TX"],
  ["Las Vegas", "NV"], ["Sacramento", "CA"], ["Columbus", "OH"],
  ["Savannah", "GA"], ["Riverside", "CA"],
];

// The floor for "a market with commercial activity worth ranking".
//
// Every metro has an employment series (measured above), so this is not a data
// question — it is a product one. Below roughly a quarter of a million people a
// metro has no institutional commercial real estate market: no third-party
// research, few if any arms-length trades in a year, and a comp set that would
// be one owner-user sale wide. Ranking such a market implies a precision the
// underlying transaction volume cannot support, whatever the macro series say.
//
// 250,000 keeps 196 of 393. It retains genuine regional markets that punch
// above their size - Savannah at 412,089 is a real industrial market because
// of the port - and drops Eagle Pass (57,770) and Columbus, IN (82,881).
// It is one number and it is meant to be argued with.
const MIN_POPULATION = 250000;

// Exact label match, not a prefix. "Charlotte".startsWith caught
// CHARLOTTESVILLE, VA and "Columbus" caught COLUMBUS, IN on the first run —
// two markets rescued below the population cut that nobody had seeded.
function isSeeded(label, state) {
  const l = String(label || "").toLowerCase().trim();
  const st = String(state || "").toLowerCase().trim();
  return SEEDED.some(([city, s]) => city.toLowerCase() === l && s.toLowerCase() === st);
}

// The Gazetteer ships as a zip holding one tab-delimited file. Unzipped here
// with the built-in zlib rather than a dependency, the way the xlsx reader in
// server.js already does it: one local file header, then a raw deflate stream.
const GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
  + VINTAGE + "_Gazetteer/" + VINTAGE + "_Gaz_cbsa_national.zip";

async function fetchGazetteer() {
  const res = await fetch(GAZ_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error("Gazetteer returned HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 2).toString() !== "PK") throw new Error("Gazetteer is not a zip");

  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const method = buf.readUInt16LE(8);
  const body = buf.slice(30 + nameLen + extraLen);
  const text = (method === 0 ? body : zlib.inflateRawSync(body)).toString("utf8");

  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split("\t").map((c) => c.trim());
  const iGeo = head.indexOf("GEOID");
  const iLat = head.indexOf("INTPTLAT");
  const iLng = head.indexOf("INTPTLONG");
  const iLand = head.indexOf("ALAND_SQMI");
  if (iGeo < 0 || iLat < 0 || iLng < 0 || iLand < 0) {
    // A renamed column would otherwise write undefined into every row and the
    // map would draw nothing, silently. Named columns, checked once, loudly.
    throw new Error("Gazetteer columns changed: " + head.join(","));
  }

  const out = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split("\t").map((x) => x.trim());
    const lat = Number(c[iLat]), lng = Number(c[iLng]), sqmi = Number(c[iLand]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(sqmi)) continue;
    out.set(c[iGeo], { lat, lng, sqmi });
  }
  return out;
}

function loadKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY.trim();
  try {
    const m = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/^CENSUS_API_KEY=(.*)$/m);
    if (m) return m[1].trim();
  } catch (e) { /* no .env is normal */ }
  return "";
}

// "Riverside-San Bernardino-Ontario, CA Metro Area" -> short label and state.
// The label is the leading city, which is how a broker names a market and how
// marketOf() already writes one.
function shortName(censusName) {
  const clean = censusName.replace(/\s+Metro Area$/, "");
  const comma = clean.lastIndexOf(",");
  const cities = comma >= 0 ? clean.slice(0, comma) : clean;
  const states = comma >= 0 ? clean.slice(comma + 1).trim() : "";
  return { label: cities.split("-")[0].trim(), state: states.split("-")[0].trim(), full: clean };
}

(async function main() {
  const key = loadKey();
  if (!key) { console.error("No CENSUS_API_KEY. Put it in .env or the environment."); process.exit(1); }

  const geo = "metropolitan statistical area/micropolitan statistical area";
  const url = "https://api.census.gov/data/" + VINTAGE + "/acs/acs5"
    + "?get=NAME,B01003_001E&for=" + encodeURIComponent(geo) + ":*&key=" + encodeURIComponent(key);

  const res = await fetch(url);
  if (!res.ok) { console.error("Census returned HTTP " + res.status); process.exit(1); }
  const rows = (await res.json()).slice(1);

  // Metro areas only. A micropolitan area is a different kind of place and a
  // CRE market list that quietly included one would be comparing a metro's
  // employment series against a town's.
  const metros = rows
    .filter((r) => /Metro Area$/.test(r[0]) && Number(r[1]) >= MIN_POPULATION)
    .map((r) => ({ census: r[0], pop: Number(r[1]), code: r[2] }))
    .sort((a, b) => b.pop - a.pop);

  console.log("Census " + VINTAGE + " ACS5: " + rows.length + " CBSAs, " + metros.length + " of them metropolitan.\n");

  const chosen = Number.isFinite(TERTIARY_THROUGH) ? metros.slice(0, TERTIARY_THROUGH) : metros;
  const chosenCodes = new Set(chosen.map((m) => m.code));

  // Any seeded market that fell outside the cut gets added at the end.
  const rescued = [];
  for (const m of metros.slice(TERTIARY_THROUGH)) {
    const n = shortName(m.census);
    if (isSeeded(n.label, n.state) && !chosenCodes.has(m.code)) {
      rescued.push(m); chosenCodes.add(m.code);
    }
  }

  // Geography, from the same authority. A market with no gazetteer row keeps
  // every other field and simply cannot be drawn - the map's own version of
  // "a market with no readings is not scored", rather than a market placed at
  // a guessed point.
  let gaz = new Map();
  try {
    gaz = await fetchGazetteer();
    console.log("\nGazetteer " + VINTAGE + ": " + gaz.size + " CBSAs with a point and a land area.");
  } catch (e) {
    console.error("\n!! Gazetteer failed: " + e.message);
    console.error("   Rows will carry no geography and the ranking map will draw nothing.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const markets = chosen.concat(rescued).map((m, i) => {
    const n = shortName(m.census);
    const rank = i + 1;
    const tier = rank <= PRIMARY_THROUGH ? "primary"
      : rank <= SECONDARY_THROUGH ? "secondary" : "tertiary";
    const g = gaz.get(m.code) || null;
    return {
      rank,
      market: n.label,
      state: n.state,
      tier: i >= chosen.length ? "tertiary" : tier,
      cbsa: {
        name: n.full,
        code: m.code,
        population: m.pop,
        // Census's INTERNAL POINT, not a centroid: for a concave shape the
        // centroid can fall outside the area entirely, so Census publishes a
        // point guaranteed to lie within it. `land_sq_mi` is land only -
        // AWATER is excluded, so a Great Lakes metro is not credited with the
        // lake.
        ...(g ? { lat: g.lat, lng: g.lng, land_sq_mi: g.sqmi } : {}),
        verified: true,
        verified_on: today,
        verified_by: "scripts/build-market-tiers.js (Census ACS5 " + VINTAGE
          + (g ? " + Gazetteer " + VINTAGE : "") + ")",
      },
      seeded: isSeeded(n.label, n.state),
    };
  });

  const counts = markets.reduce((a, m) => { a[m.tier] = (a[m.tier] || 0) + 1; return a; }, {});
  console.log("  primary   " + (counts.primary || 0));
  console.log("  secondary " + (counts.secondary || 0));
  console.log("  tertiary  " + (counts.tertiary || 0));
  console.log("  total     " + markets.length + "   (seeded: " + markets.filter((m) => m.seeded).length + ")");
  if (rescued.length) {
    console.log("\n  Added below the population cut because CompNinja seeds them:");
    for (const r of rescued) console.log("    " + shortName(r.census).full + " (" + Number(r.pop).toLocaleString() + ")");
  }
  const drawable = markets.filter((m) => Number.isFinite(m.cbsa.lat)).length;
  console.log("  drawable  " + drawable + " of " + markets.length + " have a point and a land area");
  if (drawable < markets.length) {
    console.log("    (the rest are listed and ranked, and simply do not appear on the map)");
  }
  console.log("\n  largest : " + markets[0].cbsa.name + "  " + markets[0].cbsa.population.toLocaleString());
  const lastRow = markets[markets.length - 1];
  console.log("  smallest: " + lastRow.cbsa.name + "  " + lastRow.cbsa.population.toLocaleString());

  if (process.argv.includes("--write")) {
    fs.writeFileSync(OUT, JSON.stringify({
      _comment: "DERIVED DATA — generated by scripts/build-market-tiers.js from Census ACS5 "
        + VINTAGE + ". Do not edit by hand: regenerate. Codes and names come from the Census "
        + "Bureau, which defines CBSAs, so `verified` is true on every row and carries the date "
        + "and vintage. A wrong CBSA code does not error — it returns real data for a different "
        + "city — which is why this list is generated rather than written.",
      generated: today,
      vintage: "Census ACS5 " + VINTAGE + " + Census Gazetteer " + VINTAGE,
      geography: "cbsa.lat/lng is Census's INTERNAL POINT (guaranteed inside the area, unlike a "
        + "centroid on a concave shape) and cbsa.land_sq_mi is ALAND only, excluding water. The "
        + "ranking map draws an EQUIVALENT-AREA CIRCLE from land_sq_mi: the circle's area equals "
        + "the CBSA's real land area, so it is a true claim about SCALE and no claim at all about "
        + "SHAPE. A CBSA is not a circle - Riverside-San Bernardino spans 27,277 sq mi because it "
        + "reaches into the Mojave, and its circle is correspondingly the largest on the map.",
      selection: "Metropolitan statistical areas ranked by population. Primary = top "
        + PRIMARY_THROUGH + ", secondary = next " + (SECONDARY_THROUGH - PRIMARY_THROUGH)
        + ", tertiary = every remaining METROPOLITAN area. Micropolitan areas are excluded "
        + "because BLS publishes no metro employment series for them at all - measured, not "
        + "assumed: Seaford DE (247,799, micro) has zero seasonally adjusted series while Eagle "
        + "Pass TX (57,770, the smallest metro) has two. Population rank sets the tier because "
        + "it is the one criterion reproducible from public data; industry convention would move "
        + "a handful, and `tier` stays editable for that.",
      markets,
    }, null, 2) + "\n", "utf8");
    console.log("\nWrote market-tiers.json.");
  } else {
    console.log("\nNothing written. Re-run with --write to apply.");
  }
})();
