import SwiftUI
import CompNinjaKit

struct ReportView: View {
    let saved: SavedReport

    var report: Report { saved.report }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(saved.address).font(.headline)
                    Text(saved.propertyType).font(.subheadline).foregroundStyle(.secondary)
                    if let psf = report.avgPricePerSqft.value {
                        Text(psf).font(.title.weight(.semibold)).padding(.top, 4)
                        Text("Average $/SF across the sale comps below")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            } footer: {
                Text("Automated estimate, not an appraisal. CompNinja connects you with a local broker; it is not one.")
            }

            if let summary = report.summary.value {
                Section("The market") { Text(summary) }
            }

            if !report.valueDrivers.isEmpty || report.marketTrend.isPresent {
                Section("What's driving prices here") {
                    if let trend = report.marketTrend.value {
                        Text(trend).font(.subheadline.weight(.semibold))
                    }
                    ForEach(report.valueDrivers, id: \.self) { driver in
                        Label(driver, systemImage: "circle.fill")
                            .labelStyle(BulletLabelStyle())
                    }
                }
            }

            let facts = marketFacts
            if !facts.isEmpty {
                Section("The numbers") {
                    ForEach(facts, id: \.label) { fact in
                        LabeledContent(fact.label, value: fact.value)
                    }
                }
            }

            if !mappableComps.isEmpty {
                Section("Where they are") {
                    CompMapView(report: report, comps: mappableComps)
                        .frame(height: 260)
                        .listRowInsets(EdgeInsets())
                }
            }

            Section("Comparables (\(report.comps.count))") {
                ForEach(report.comps) { comp in
                    NavigationLink { CompDetailView(comp: comp) } label: { CompRow(comp: comp) }
                }
            }

            if report.lockedCount > 0 {
                Section {
                    // Redacted, never blurred — and on iOS there is no upgrade
                    // button here on purpose. App Store guideline 3.1.3(b)
                    // forbids selling this, and forbids linking out to sell
                    // it. See ios/README.md.
                    Text("\(report.lockedCount) further comparable\(report.lockedCount == 1 ? "" : "s") "
                         + "not included on your plan.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Report")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ShareLink(item: ReportExport.plainText(saved)) {
                Image(systemName: "square.and.arrow.up")
            }
        }
    }

    private var mappableComps: [Comp] {
        report.comps.filter { $0.lat.number != nil && $0.lng.number != nil }
    }

    private struct Fact { let label: String; let value: String }

    private var marketFacts: [Fact] {
        var facts: [Fact] = []
        if let low = report.marketCapRateRange?.low.value,
           let high = report.marketCapRateRange?.high.value {
            facts.append(Fact(label: "Market cap rate", value: "\(low)–\(high)"))
        }
        if let radius = report.searchRadius.value {
            facts.append(Fact(label: "Search area", value: radius))
        }
        if let reviewed = report.transactionsReviewed.value {
            facts.append(Fact(label: "Transactions reviewed", value: reviewed))
        }
        if let size = report.subjectSizeSqft.value {
            facts.append(Fact(label: "Building size", value: "\(size) SF"))
        }
        if let year = report.subjectYearBuilt.value {
            facts.append(Fact(label: "Year built", value: year))
        }
        if let discovery = report.priceDiscovery?.note.value {
            facts.append(Fact(label: "Price discovery", value: discovery))
        }
        return facts
    }
}

struct CompRow: View {
    let comp: Comp

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(comp.address.value ?? "Address withheld")
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
            HStack(spacing: 6) {
                if let date = comp.date.value { Text(date) }
                if let tx = comp.transaction.value { Text("· \(tx)") }
                if let size = comp.sizeSqft.value { Text("· \(size) SF") }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                if let price = comp.priceOrRate.value {
                    Text(price).font(.subheadline.weight(.semibold))
                }
                if let psf = comp.pricePerSqft.value {
                    Text("\(psf)/SF").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                ConfidenceBadge(comp: comp)
            }
        }
        .padding(.vertical, 2)
    }
}

struct ConfidenceBadge: View {
    let comp: Comp

    var body: some View {
        let confidence = SourceConfidence(comp: comp)
        Text(confidence.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color(confidence).opacity(0.15), in: Capsule())
            .foregroundStyle(color(confidence))
    }

    private func color(_ confidence: SourceConfidence) -> Color {
        switch confidence {
        case .verified: return .green
        case .publicRecord: return .blue
        case .listing: return .indigo
        case .news: return .orange
        case .estimate: return .secondary
        }
    }
}

struct BulletLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            configuration.icon.font(.system(size: 5)).foregroundStyle(.secondary)
            configuration.title
        }
    }
}
