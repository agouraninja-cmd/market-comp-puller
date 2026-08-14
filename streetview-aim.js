// Street View honesty gate. The Static API's metadata check only answers
// "does SOME outdoor camera exist near this point?" — a fence 80 m up the
// street still returns OK, which is how map popups showed the neighbor
// ~80% of the time. This module is the second question: is THAT camera
// close enough to the snapped building, and which way should it look?
//
// Pure on purpose: no I/O, no fetch, no clock. server.js owns the Google
// call and passes the metadata's pano location in. 35 m is a house's
// street-to-centroid distance with slack; a warehouse whose centroid sits
// 80 m inside the lot fails and the aerial stays, which is the right
// picture for that building.

"use strict";

const MAX_PANO_M = 35;

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
  if (dist > MAX_PANO_M) return null;
  return { heading: headingDeg(pano, target), dist };
}

module.exports = { MAX_PANO_M, metersBetween, headingDeg, aimAt };
