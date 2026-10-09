// Street View honesty gate. The Static API's metadata check only answers
// "does SOME outdoor camera exist near this point?" — a fence 80 m up the
// street still returns OK, which is how map popups showed the neighbor
// ~80% of the time. This module is the second question: is THAT camera
// close enough to the snapped building, and which way should it look?
//
// And the third (2026-10-09, the owner: "make sure they are actual good
// pictures"): is it a picture worth showing? judgePano() is the one gate
// every street photo on the site passes, the report map's pin popups, Home's
// list and map cards and The Board's deal cards alike. It refuses:
//   - imagery that is not Google's own. A user-uploaded photosphere is
//     "outdoor" too, and is the tilted, smeared, wrongly placed kind;
//     Google's metadata names the owner in `copyright` ("© Google").
//   - imagery older than MAX_PANO_AGE_YEARS. A 2009 capture is soft and
//     dim beside a current one, and on a new building it shows the empty
//     lot it was built on. No date proves nothing, so it is refused too.
//   - a camera more than MAX_PANO_M from the building (the neighbor), or
//     nearer than MIN_PANO_M (standing on it, where "which way to look" has
//     no answer and the frame is a wall or the pavement).
// What it passes it frames: fovFor() narrows the lens as the camera gets
// farther away, so a house 30 m back fills the frame the way one 12 m back
// does, instead of sitting small in a wide shot of the street.
//
// Pure on purpose: no I/O, no fetch, no clock. server.js owns the Google
// call and passes the metadata (and the time) in. 35 m is a house's
// street-to-centroid distance with slack; a warehouse whose centroid sits
// 80 m inside the lot fails and the aerial stays, which is the right
// picture for that building.

"use strict";

const MAX_PANO_M = 35;
const MIN_PANO_M = 4;
const MAX_PANO_AGE_YEARS = 10;
// The lens: never wider than 90° (wider bends a facade) nor narrower than
// 45° (narrower is a crop of one wall). FRAME_HALF_M is the half-width of
// what the photo tries to fit across: a house front with a little either
// side of it.
const FOV_MAX = 90;
const FOV_MIN = 45;
const FRAME_HALF_M = 15;

function finiteLL(p) {
  return p && isFinite(p.lat) && isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

function metersBetween(a, b) {
  const dLat = (a.lat - b.lat) * 111320;
  const dLng = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

// Compass heading from the camera to the building, 0–360 clockwise from north.
function headingDeg(from, to) {
  const phi1 = from.lat * Math.PI / 180;
  const phi2 = to.lat * Math.PI / 180;
  const dLam = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// target = snapped building centroid; pano = metadata.location.
// null = refuse (aerial stays). Otherwise { heading, dist }.
function aimAt(target, pano) {
  if (!finiteLL(target) || !finiteLL(pano)) return null;
  const dist = metersBetween(pano, target);
  if (dist > MAX_PANO_M || dist < MIN_PANO_M) return null;
  return { heading: headingDeg(pano, target), dist };
}

// Google's own capture says so in the metadata's copyright ("© Google");
// anyone else's names its uploader.
function isGoogleImagery(copyright) {
  return /\bgoogle\b/i.test(String(copyright || ""));
}

// The metadata's capture date is "YYYY-MM" (sometimes just "YYYY"). A date
// in the future (a clock that is behind) is new, not old.
function panoAgeOk(date, now) {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(String(date || "").trim());
  if (!m) return false;
  const at = new Date(Number(now));
  if (!isFinite(at.getTime())) return false;
  const shot = Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
  const today = at.getUTCFullYear() * 12 + at.getUTCMonth();
  return today - shot <= MAX_PANO_AGE_YEARS * 12;
}

// Field of view, in degrees, that fits FRAME_HALF_M either side of the
// building's middle from `dist` metres away.
function fovFor(dist) {
  const d = Number(dist);
  if (!isFinite(d) || d <= 0) return FOV_MAX;
  const deg = 2 * Math.atan(FRAME_HALF_M / d) * 180 / Math.PI;
  return Math.round(Math.min(FOV_MAX, Math.max(FOV_MIN, deg)));
}

// The whole gate. target = the building centroid we were asked for;
// meta = Google's metadata answer, as parsed JSON; now = ms since epoch.
// null = no photo worth showing (the route 404s, the aerial stays).
function judgePano(target, meta, now) {
  if (!meta || meta.status !== "OK" || !meta.location) return null;
  if (!isGoogleImagery(meta.copyright)) return null;
  if (!panoAgeOk(meta.date, now)) return null;
  const pano = { lat: Number(meta.location.lat), lng: Number(meta.location.lng) };
  const aim = aimAt(target, pano);
  if (!aim) return null;
  return {
    heading: aim.heading,
    fov: fovFor(aim.dist),
    dist: aim.dist,
    panoId: String(meta.pano_id || ""),
    plat: pano.lat,
    plng: pano.lng,
  };
}

module.exports = {
  MAX_PANO_M, MIN_PANO_M, MAX_PANO_AGE_YEARS, FOV_MIN, FOV_MAX,
  metersBetween, headingDeg, aimAt, isGoogleImagery, panoAgeOk, fovFor, judgePano,
};
