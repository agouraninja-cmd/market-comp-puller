// test/helpers/permit-portal-stub.js
// A stand-in for the Boise and Meridian permit portals, reached through the
// test-only PERMIT_PORTAL_ORIGIN. It serves the detail page captured from the
// live Boise portal on 2026-09-16 with the permit number and status swapped for
// whatever the test says the city now reads. Shared by the permit-watch suites
// so the two cannot drift into two different portals.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const http = require("node:http");

const FIX = path.join(__dirname, "..", "fixtures", "permit-portals");
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIX, f))).toString("utf8");
const NUM_FIELD = "ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitNumber";
const NAMPA = require("./nampa-reports");

// `statusOf` is what each city's portal reads for a permit number right now;
// `down` lists numbers whose search the portal answers with a 500.
// `nampa`: the published-reports stand-in Nampa is swept from (2026-10-01);
// by default one empty plan review report, so a suite about Boise permits
// reads Nampa cleanly and stores nothing from it.
function startPortal({ nampa = NAMPA.quietNampa() } = {}) {
  const statusOf = {};
  const down = new Set();
  const hits = [];
  const nampaRoute = NAMPA.nampaRoutes(nampa);
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      hits.push({ method: req.method, path: url.pathname, body });
      if (nampaRoute(req, res, url)) return;
      const html = (s) => { res.writeHead(200, { "content-type": "text/html" }); res.end(s); };
      const city = url.pathname.startsWith("/CitizenAccess/") ? "boise"
        : url.pathname.startsWith("/MERIDIAN/") ? "meridian" : null;
      if (!city) { res.writeHead(404); return res.end("no such portal"); }
      const root = city === "boise" ? "/CitizenAccess" : "/MERIDIAN";
      if (/CapDetail\.aspx$/.test(url.pathname)) {
        const num = url.searchParams.get("watch") || "";
        return html(readGz(`${city}.detail.html.gz`)
          .replace(/(id="ctl00_PlaceHolderMain_lblRecordStatus"[^>]*>)[^<]*</, `$1${statusOf[num] || ""}<`)
          .replace(/(id="ctl00_PlaceHolderMain_lblPermitNumber"[^>]*>)[^<]*</, `$1${num}<`));
      }
      if (/CapHome\.aspx$/.test(url.pathname)) {
        if (req.method === "GET") return html(readGz(`${city}.search.html.gz`));
        const num = (new URLSearchParams(body).get(NUM_FIELD) || "").trim().toUpperCase();
        if (num && down.has(num)) { res.writeHead(500); return res.end("portal down"); }
        if (num && statusOf[num]) {
          res.writeHead(302, { location: `${root}/Cap/CapDetail.aspx?watch=${encodeURIComponent(num)}` });
          return res.end();
        }
        // An unknown number, or the city sweep's own type searches: nothing.
        return html("<html><body><span>Your search returned no results.</span></body></html>");
      }
      res.writeHead(404); res.end("no route");
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${srv.address().port}`, statusOf, down, hits, nampa,
    stop: () => new Promise((r) => srv.close(r)),
  })));
}

module.exports = { startPortal };
