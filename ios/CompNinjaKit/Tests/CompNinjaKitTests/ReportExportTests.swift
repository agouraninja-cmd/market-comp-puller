import Foundation
import Testing
@testable import CompNinjaKit

@Suite("Share sheet export")
struct ReportExportTests {

    func exported() throws -> String {
        let report = try JSONDecoder().decode(Report.self, from: sampleReportData())
        return ReportExport.text(report: report,
                                 address: "1200 W Industrial Blvd, Dallas, TX",
                                 propertyType: "Industrial")
    }

    /// The owner is not a licensed broker and no output of this product is an
    /// appraisal. What leaves the phone says so, every time.
    @Test func alwaysCarriesTheEstimateDisclaimer() throws {
        let text = try exported()
        #expect(text.contains("Automated estimate, not an appraisal"))
        #expect(text.lowercased().contains("not a licensed broker"))
    }

    /// "Verified" is a badge only the server may award — it means a named
    /// broker vouched for the deal. It must never appear on a comp that did
    /// not earn it.
    @Test func verifiedAppearsOnlyWhereTheServerAwardedIt() throws {
        let text = try exported()
        #expect(text.contains("Verified · via Lonestar Industrial Advisors"))
        #expect(text.components(separatedBy: "Verified").count - 1 == 1)
    }

    @Test func everyCompKeepsItsSourceBadge() throws {
        let text = try exported()
        for badge in ["Verified", "Public record", "Listing", "News", "Estimate"] {
            #expect(text.contains(badge), "badge \(badge) missing from the shared text")
        }
    }

    @Test func carriesTheHeadlineFiguresAndTheDrivers() throws {
        let text = try exported()
        #expect(text.contains("Average $/SF: $113 (sale comps)"))
        #expect(text.contains("Market cap rate: 5.8%–6.3%"))
        #expect(text.contains("What's driving prices here"))
        #expect(text.contains("COMPARABLES (5)"))
    }

    /// A withheld comp is counted, never described. The basis rows deliberately
    /// carry no address and no sale price, and nothing about them may leak into
    /// a document the user hands to someone else.
    @Test func lockedCompsAreCountedNotDescribed() throws {
        let json = Data("""
        {"comps":[],"locked_count":14,
         "locked_basis":[{"date":"Mar 2025","transaction":"Sale","price_per_sqft":"118"}]}
        """.utf8)
        let report = try JSONDecoder().decode(Report.self, from: json)
        let text = ReportExport.text(report: report, address: "500 Main St", propertyType: "Retail")
        #expect(text.contains("14 further comparables was not included"))
        #expect(!text.contains("118"))
        #expect(!text.contains("Mar 2025"))
    }

    @Test func aCompWithAlmostNothingStillRenders() {
        var comp = Comp()
        comp.date = LooseString("Mar 2025")
        let lines = ReportExport.lines(for: comp)
        #expect(lines[0] == "Address withheld — Mar 2025")
        #expect(lines.contains("  Estimate"))
    }
}
