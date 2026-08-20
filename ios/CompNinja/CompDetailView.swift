import SwiftUI
import CompNinjaKit

struct CompDetailView: View {
    let comp: Comp

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(comp.address.value ?? "Address withheld").font(.headline)
                    ConfidenceBadge(comp: comp)
                    if SourceConfidence(comp: comp) == .verified, let by = comp.verifiedBy.value {
                        Text("A named broker vouched for this deal — via \(by)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            Section("The deal") {
                ForEach(rows, id: \.label) { row in
                    LabeledContent(row.label, value: row.value)
                }
            }

            if let notes = comp.notes.value {
                Section("Notes") { Text(notes) }
            }

            if let url = comp.sourceURL.value, let link = URL(string: url) {
                Section("Source") {
                    Link(destination: link) {
                        Label("Open the source page", systemImage: "safari")
                    }
                }
            }
        }
        .navigationTitle(comp.date.value ?? "Comparable")
        .navigationBarTitleDisplayMode(.inline)
    }

    private struct Row { let label: String; let value: String }

    /// Every field this comp actually carries, type-specific columns included.
    /// Absent fields are omitted rather than shown blank — a blank row reads as
    /// a bug, an absent one reads as "not known".
    private var rows: [Row] {
        let candidates: [(String, LooseString)] = [
            ("Date", comp.date),
            ("Transaction", comp.transaction),
            ("Size", comp.sizeSqft),
            ("Price", comp.priceOrRate),
            ("$/SF", comp.pricePerSqft),
            ("Cap rate", comp.capRate),
            ("Tenancy", comp.tenancy),
            ("Year built", comp.yearBuilt),
            ("Clear height", comp.clearHeight),
            ("Dock doors", comp.dockDoors),
            ("Building class", comp.buildingClass),
            ("Floor plate", comp.floorPlate),
            ("Center type", comp.centerType),
            ("Anchor tenant", comp.anchorTenant),
            ("Units", comp.units),
            ("$/unit", comp.pricePerUnit),
            ("Lot", comp.lotAcres),
            ("$/acre", comp.pricePerAcre),
            ("Zoning", comp.zoning),
            ("Beds / baths", comp.bedsBaths),
            ("Condition", comp.condition),
        ]
        return candidates.compactMap { label, field in
            field.value.map { Row(label: label, value: $0) }
        }
    }
}
