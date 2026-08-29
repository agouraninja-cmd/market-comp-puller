import Testing
import Foundation
@testable import CompNinjaKit

/// A broker's own vault comps ride inside their reports, and the rule is that
/// they are counted everywhere and shared nowhere.
@Suite("Private comps")
struct PrivateCompTests {

    /// A report as the server actually sends one to a broker with a vault:
    /// two public comps and one of their own, blended into the same array.
    private func blendedReport() throws -> Report {
        let json = """
        {"summary":"Tight market.",
         "avg_price_per_sqft":"$113",
         "private_count":1,
         "comps":[
           {"address":"2801 S Great Southwest Pkwy, Grand Prairie, TX","date":"Mar 2026",
            "transaction":"Sale","size_sqft":"86,400","price_or_rate":"$9,940,000",
            "price_per_sqft":"$115","source_type":"public_record",
            "source_url":"https://example.com/a"},
           {"address":"14 Private Deal Rd, Boise, ID","date":"Feb 2026",
            "transaction":"Sale","size_sqft":"20,000","price_or_rate":"$2,400,000",
            "price_per_sqft":"$120","source_type":"broker_vault","private":true},
           {"address":"4650 Mountain Creek Pkwy, Dallas, TX","date":"Jan 2026",
            "transaction":"Sale","size_sqft":"152,000","price_or_rate":"$16,700,000",
            "price_per_sqft":"$110","source_type":"news",
            "source_url":"https://example.com/b"}
         ]}
        """
        return try JSONDecoder().decode(Report.self, from: Data(json.utf8))
    }

    @Test func theServerSaysWhichCompsArePrivateAndTheAppBelievesIt() throws {
        let r = try blendedReport()
        #expect(r.comps.count == 3)
        #expect(r.privateCount == 1)
        #expect(r.comps.filter(\.isPrivate).count == 1)
    }

    @Test func aCompWithNoPrivateKeyIsNotPrivate() throws {
        // Every report for everyone without a vault omits the key entirely.
        // Defaulting it any other way would hide ordinary comps from exports.
        let r = try blendedReport()
        #expect(!r.comps[0].isPrivate)
        #expect(!r.comps[2].isPrivate)
    }

    @Test func exportableCompsDropsThePrivateOne() throws {
        let r = try blendedReport()
        #expect(r.exportableComps.count == 2)
        #expect(r.exportableComps.allSatisfy { !$0.isPrivate })
    }

    @Test func theSharedTextNeverCarriesAPrivateAddress() throws {
        // The whole point. This string goes out through Messages, Mail and
        // Files, so the assertion is on the ADDRESS, not on a count.
        let text = ReportExport.text(report: try blendedReport(),
                                     address: "1200 W Industrial Blvd, Dallas, TX",
                                     propertyType: "Industrial")
        #expect(!text.contains("14 Private Deal Rd"))
        #expect(!text.contains("$2,400,000"))
        // and the public ones are still there, so the filter has not eaten the
        // report along with the private row
        #expect(text.contains("2801 S Great Southwest Pkwy"))
        #expect(text.contains("4650 Mountain Creek Pkwy"))
    }

    @Test func theSharedTextDisclosesWhatItLeftOut() throws {
        // The valuation above the list still counts the private comp, so a
        // file that is quietly one row short reads as lost data.
        let text = ReportExport.text(report: try blendedReport(),
                                     address: "1200 W Industrial Blvd, Dallas, TX",
                                     propertyType: "Industrial")
        #expect(text.contains("1 comparable from your own records was left out"))
        #expect(text.contains("still count it"))
        // The heading counts what is actually in the file, not the whole set.
        #expect(text.contains("COMPARABLES (2)"))
    }

    @Test func aReportWithNoPrivateCompsSaysNothingAboutThem() throws {
        // Byte-identical to before the feature for everyone without a vault.
        let json = #"{"comps":[{"address":"1 Main St","source_type":"listing"}]}"#
        let r = try JSONDecoder().decode(Report.self, from: Data(json.utf8))
        let text = ReportExport.text(report: r, address: "1 Main St", propertyType: "Retail")
        #expect(!text.contains("your own records"))
        #expect(text.contains("COMPARABLES (1)"))
    }

    @Test func aPrivateCompIsBadgedAsOwnedNeverAsAnEstimate() throws {
        let r = try blendedReport()
        let mine = r.comps.first(where: \.isPrivate)!
        // Before this existed, broker_vault fell through to the enum default
        // and stamped a real closed transaction as guesswork.
        #expect(SourceConfidence(comp: mine) != .estimate)
        #expect(SourceConfidence(comp: mine) == .brokerVault)
        #expect(SourceConfidence(comp: mine).label == "From your vault")
    }

    @Test func aPrivateCompCanNeverBePaintedVerified() throws {
        // "Verified" is a public claim the server awards when a named broker
        // vouches for a deal in the public records. A private row has not
        // earned it. This pins the ORDER of the checks: even with the verified
        // flag wrongly set, ownership wins.
        var comp = Comp()
        comp.isPrivate = true
        comp.verified = true
        #expect(SourceConfidence(comp: comp) == .brokerVault)
    }

    @Test func theVaultTierIsRecognisedFromSourceTypeAlone() throws {
        // Belt and braces: if a future server sends the tier without the flag,
        // the badge is still right. The export filter keys on the flag, which
        // is why both are checked rather than one standing in for the other.
        var comp = Comp()
        comp.sourceType = LooseString("broker_vault")
        #expect(SourceConfidence(comp: comp) == .brokerVault)
    }
}
