#!/usr/bin/env python3
"""Write the sample saved-reports store the App Store screenshots are taken from.

Usage: screenshot-data.py <fixture.json> <out saved-reports.json>

The report is the test fixture (an illustrative DFW industrial report). Its one
"verified" comp is turned into a public-record comp first: the green Verified
badge means a named broker vouched for a real deal, and a sample must not wear
it. Output is the SavedReportStore file shape (a list of SavedReport, ISO-8601
dates), newest first.
"""
import json
import sys

fixture, out = sys.argv[1], sys.argv[2]
with open(fixture, encoding="utf-8") as f:
    report = json.load(f)

for comp in report.get("comps", []):
    if comp.pop("verified", None):
        comp.pop("verified_by", None)
        comp["source_type"] = "public_record"

# Put the subject pin at the first saved address (the one the screenshots
# open), not at the fixture's own coordinates across town.
report["subject_lat"], report["subject_lng"] = "32.7085", "-97.0045"

saved = [
    ("2602 E Pioneer Pkwy, Grand Prairie, TX 75051", "2026-11-19T15:10:00Z"),
    ("1101 Avenue H East, Arlington, TX 76011", "2026-11-14T18:42:00Z"),
    ("3400 Duncanville Rd, Dallas, TX 75236", "2026-11-06T14:05:00Z"),
]
store = [
    {
        "id": f"demo-{i}",
        "address": address,
        "propertyType": "Industrial",
        "savedAt": saved_at,
        "report": report,
    }
    for i, (address, saved_at) in enumerate(saved)
]
with open(out, "w", encoding="utf-8") as f:
    json.dump(store, f)
print(f"Wrote {len(store)} saved reports to {out}")
