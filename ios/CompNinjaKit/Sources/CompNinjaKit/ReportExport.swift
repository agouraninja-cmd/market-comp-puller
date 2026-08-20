import Foundation

/// The plain-text rendering of a report, for the iOS share sheet.
///
/// Sharing is the whole point of this product — the tagline is a report you
/// can hand to someone who will argue with it — so what leaves the phone has
/// to carry the PROOF, not just the number: every comp keeps its source badge
/// and its link. Two rules are load-bearing and both are tested:
///
///  * the estimate is labeled an automated estimate, never an appraisal;
///  * "Verified" appears only where the server awarded it.
public enum ReportExport {

    public static func plainText(_ saved: SavedReport) -> String {
        text(report: saved.report, address: saved.address, propertyType: saved.propertyType)
    }

    public static func text(report: Report, address: String, propertyType: String) -> String {
        var out: [String] = []
        out.append("CompNinja — \(propertyType) comps")
        out.append(address)
        out.append("")

        if let summary = report.summary.value {
            out.append(summary)
            out.append("")
        }

        if let psf = ReportFormat.money(report.avgPricePerSqft, currency: report.currency) {
            out.append("Average $/SF: \(psf)")
        }
        if let low = report.marketCapRateRange?.low.value,
           let high = report.marketCapRateRange?.high.value {
            out.append("Market cap rate: \(low)–\(high)")
        }
        if let trend = report.marketTrend.value {
            out.append("Trend: \(trend)")
        }
        if let radius = report.searchRadius.value {
            out.append("Search area: \(radius)")
        }
        if let reviewed = report.transactionsReviewed.value {
            out.append("Transactions reviewed: \(reviewed)")
        }

        if !report.valueDrivers.isEmpty {
            out.append("")
            out.append("What's driving prices here")
            out.append(contentsOf: report.valueDrivers.map { "  - \($0)" })
        }

        out.append("")
        out.append("COMPARABLES (\(report.comps.count))")
        for comp in report.comps {
            out.append("")
            out.append(contentsOf: lines(for: comp))
        }

        if report.lockedCount > 0 {
            out.append("")
            out.append("\(report.lockedCount) further comparable\(report.lockedCount == 1 ? "" : "s") "
                       + "was not included in this report.")
        }

        out.append("")
        out.append("Automated estimate, not an appraisal. CompNinja is not a licensed broker.")
        out.append("compninja.co")
        return out.joined(separator: "\n")
    }

    static func lines(for comp: Comp) -> [String] {
        var head = comp.address.value ?? "Address withheld"
        if let date = comp.date.value { head += " — \(date)" }
        if let tx = comp.transaction.value { head += " (\(tx))" }
        var lines = [head]

        var facts: [String] = []
        if let size = ReportFormat.count(comp.sizeSqft) { facts.append("\(size) SF") }
        if let price = ReportFormat.money(comp.priceOrRate) { facts.append(price) }
        if let psf = ReportFormat.money(comp.pricePerSqft) { facts.append("\(psf)/SF") }
        if let cap = comp.capRate.value { facts.append("\(cap) cap") }
        if let units = ReportFormat.count(comp.units) { facts.append("\(units) units") }
        if let ppu = ReportFormat.money(comp.pricePerUnit) { facts.append("\(ppu)/unit") }
        if let acres = comp.lotAcres.value { facts.append("\(acres) ac") }
        if let year = comp.yearBuilt.value { facts.append("built \(year)") }
        if !facts.isEmpty { lines.append("  " + facts.joined(separator: " · ")) }

        let badge = SourceConfidence(comp: comp)
        if badge == .verified, let by = comp.verifiedBy.value {
            lines.append("  Verified · via \(by)")
        } else {
            lines.append("  \(badge.label)")
        }

        if let tenancy = comp.tenancy.value { lines.append("  \(tenancy)") }
        if let notes = comp.notes.value { lines.append("  \(notes)") }
        if let url = comp.sourceURL.value { lines.append("  \(url)") }
        return lines
    }
}
