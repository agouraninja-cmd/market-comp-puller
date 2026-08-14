// City hero photos for /market/<slug> page headers.
//
// Curated Wikimedia Commons aerials / skylines, keyed by "city, st" so every
// property type in the same city shares one photograph. Explorer-generated
// markets that are not in the table fall through to an Esri World Imagery
// aerial of downtown when we have coordinates, and to no photo otherwise —
// a missing picture must not invent a skyline of the wrong city (Ontario, CA
// is not Ontario, Canada).
//
// Photos are downloaded, cropped, and served from /market-heroes/ rather than
// hotlinked: Wikimedia asks not to be used as a CDN. Credits render on the
// photograph. Pure, no I/O, so npm test can pin the lookup.

"use strict";

// Downtown / most photogenic point, used only for the Esri fallback.
const CITY_COORDS = {
  "atlanta, ga": { lat: 33.7550, lng: -84.3900 },
  "austin, tx": { lat: 30.2672, lng: -97.7431 },
  "boise, id": { lat: 43.6150, lng: -116.2023 },
  "charlotte, nc": { lat: 35.2271, lng: -80.8431 },
  "columbus, oh": { lat: 39.9612, lng: -82.9988 },
  "dallas, tx": { lat: 32.7787, lng: -96.7970 },
  "denver, co": { lat: 39.7392, lng: -104.9903 },
  "fontana, ca": { lat: 34.0922, lng: -117.4350 },
  "houston, tx": { lat: 29.7604, lng: -95.3698 },
  "indianapolis, in": { lat: 39.7684, lng: -86.1581 },
  "las vegas, nv": { lat: 36.1147, lng: -115.1728 },
  "memphis, tn": { lat: 35.1495, lng: -90.0490 },
  "nashville, tn": { lat: 36.1627, lng: -86.7816 },
  "ontario, ca": { lat: 34.0560, lng: -117.6012 },
  "orlando, fl": { lat: 28.5383, lng: -81.3792 },
  "phoenix, az": { lat: 33.4484, lng: -112.0740 },
  "riverside, ca": { lat: 33.9806, lng: -117.3755 },
  "sacramento, ca": { lat: 38.5816, lng: -121.4944 },
  "san antonio, tx": { lat: 29.4241, lng: -98.4936 },
  "san diego, ca": { lat: 32.7157, lng: -117.1611 },
  "savannah, ga": { lat: 32.0809, lng: -81.0912 },
  "tampa, fl": { lat: 27.9506, lng: -82.4572 },
};

// Commons file titles (unprefixed) are the audit trail; `file` is what we
// serve. Adding a city means downloading the 1920px thumb, cropping to
// 1600×720, and dropping the JPEG next to the others.
const HEROES = {
  "atlanta, ga": {
    file: "atlanta-ga.jpg",
    credit: "Ron Reiring",
    license: "CC BY 2.0",
    commons: "Aerial of Downtown Atlanta, GA.jpg",
    alt: "Aerial view of downtown Atlanta",
  },
  "austin, tx": {
    file: "austin-tx.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Skyline of Austin, Texas (cropped).jpg",
    alt: "Austin skyline",
  },
  "charlotte, nc": {
    file: "charlotte-nc.jpg",
    credit: "Precisionviews",
    license: "CC BY-SA 4.0",
    commons: "Uptown Charlotte 2018 taking by DJI Phantom 4 pro.jpg",
    alt: "Drone view of uptown Charlotte",
  },
  "columbus, oh": {
    file: "columbus-oh.jpg",
    credit: "Pi.1415926535",
    license: "CC BY-SA 3.0",
    commons: "Aerial view of Columbus, Ohio, September 2015.JPG",
    alt: "Aerial view of Columbus",
  },
  "dallas, tx": {
    file: "dallas-tx.jpg",
    credit: "IcedCowboyCoffee",
    license: "CC0",
    commons: "Dallas Texas skyline from Reunion Tower September 2025 (cropped).png",
    alt: "Dallas skyline",
  },
  "denver, co": {
    file: "denver-co.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Denver, Colorado skyline (cropped 3x5).jpg",
    alt: "Denver skyline",
  },
  "fontana, ca": {
    file: "fontana-ca.jpg",
    credit: "Doc Searls",
    license: "CC BY-SA 2.0",
    commons: "California Speedway, aerial view.jpg",
    alt: "Aerial view of Fontana",
  },
  "houston, tx": {
    file: "houston-tx.jpg",
    credit: "Carol M. Highsmith",
    license: "Public domain",
    commons: "Aerial views of the Houston, Texas, skyline in 2014 LCCN2014632199.tif",
    alt: "Aerial view of the Houston skyline",
  },
  "indianapolis, in": {
    file: "indianapolis-in.jpg",
    credit: "Carol M. Highsmith",
    license: "Public domain",
    commons: "Aerial view of Indianapolis, Indiana, with a focus on Lucas Oil Stadium, highsm.40934.jpg",
    alt: "Aerial view of Indianapolis",
  },
  "las vegas, nv": {
    file: "las-vegas-nv.jpg",
    credit: "Mike McBey",
    license: "CC BY 2.0",
    commons: "Las Vegas from above (40064746644).jpg",
    alt: "Aerial view of the Las Vegas Strip",
  },
  "memphis, tn": {
    file: "memphis-tn.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Skyline of Memphis, TN.jpg",
    alt: "Memphis skyline",
  },
  "nashville, tn": {
    file: "nashville-tn.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Nashville, TN skyline.jpg",
    alt: "Nashville skyline",
  },
  "ontario, ca": {
    file: "ontario-ca.jpg",
    credit: "skinnylawyer",
    license: "CC BY-SA 2.0",
    commons: "Ontario Airport from United 793 - Flickr - skinnylawyer.jpg",
    alt: "Aerial view of Ontario, California",
  },
  "orlando, fl": {
    file: "orlando-fl.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Orlando, Florida (cropped).jpg",
    alt: "Orlando skyline",
  },
  "phoenix, az": {
    file: "phoenix-az.jpg",
    credit: "DPPed",
    license: "CC BY-SA 3.0",
    commons: "Downtown Phoenix Aerial Looking Northeast.jpg",
    alt: "Aerial view of downtown Phoenix",
  },
  "riverside, ca": {
    file: "riverside-ca.jpg",
    credit: "Famartin",
    license: "CC BY-SA 4.0",
    commons: "2021-10-05 14 11 03 View south across western Riverside County, California from an airplane heading for Los Angeles International Airport.jpg",
    alt: "Aerial view of Riverside, California",
    crop: "bottom",
  },
  "sacramento, ca": {
    file: "sacramento-ca.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Sacramento, CA skyline (cropped).jpg",
    alt: "Sacramento skyline",
  },
  "san antonio, tx": {
    file: "san-antonio-tx.jpg",
    credit: "Jouaienttoi",
    license: "CC BY-SA 4.0",
    commons: "San Antonio Botanical Garden Overlook View.jpg",
    alt: "San Antonio from above",
  },
  "san diego, ca": {
    file: "san-diego-ca.jpg",
    credit: "JDrewes",
    license: "CC BY-SA 3.0",
    commons: "San Diego Skyline Day JD111107.jpg",
    alt: "San Diego skyline",
  },
  "savannah, ga": {
    file: "savannah-ga.jpg",
    credit: "Bigdaverhuberg",
    license: "CC BY-SA 4.0",
    commons: "Savannah.tif",
    alt: "Savannah from above",
  },
  "tampa, fl": {
    file: "tampa-fl.jpg",
    credit: "Clément Bardot",
    license: "CC BY-SA 4.0",
    commons: "Downtown Tampa, Florida.jpg",
    alt: "Tampa skyline",
  },
};

const FILE_RE = /^[a-z0-9-]+\.jpg$/;

function cityKey(city, state) {
  return `${String(city || "").trim().toLowerCase()}, ${String(state || "").trim().toLowerCase()}`;
}

function commonsFileUrl(commons) {
  // MediaWiki File: titles keep spaces; the wiki page encodes them as _.
  return "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(commons).replace(/%20/g, "_");
}

function esriAerialUrl(lat, lng, w = 1600, h = 720) {
  const latRad = Number(lat) * Math.PI / 180;
  const widthM = 9000;
  const heightM = widthM * (h / w);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  const dLat = (heightM / 2) / mPerDegLat;
  const dLng = (widthM / 2) / mPerDegLng;
  const bbox = [
    Number(lng) - dLng,
    Number(lat) - dLat,
    Number(lng) + dLng,
    Number(lat) + dLat,
  ].map((n) => n.toFixed(5)).join(",");
  return "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
    + `?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${w},${h}&format=jpg&f=image`;
}

function heroFor(city, state) {
  const key = cityKey(city, state);
  const curated = HEROES[key];
  if (curated) {
    return {
      src: "/market-heroes/" + curated.file,
      alt: curated.alt,
      credit: curated.credit,
      license: curated.license,
      commonsUrl: commonsFileUrl(curated.commons),
      kind: "photo",
    };
  }
  const ll = CITY_COORDS[key];
  if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng)) {
    return {
      src: esriAerialUrl(ll.lat, ll.lng),
      alt: `Aerial view of ${String(city || "").trim()}, ${String(state || "").trim()}`.trim(),
      credit: "Esri, Maxar",
      license: "",
      commonsUrl: "",
      kind: "satellite",
    };
  }
  return null;
}

function isHeroFilename(name) {
  return FILE_RE.test(String(name || ""));
}

module.exports = {
  HEROES,
  CITY_COORDS,
  FILE_RE,
  cityKey,
  heroFor,
  esriAerialUrl,
  commonsFileUrl,
  isHeroFilename,
};
