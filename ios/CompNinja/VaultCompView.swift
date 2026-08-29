import SwiftUI
import CompNinjaKit

/// One stored comp, read-only for now.
///
/// The web edits a comp cell by cell like a spreadsheet. That does not port:
/// a phone has no Tab key and no room for 37 columns. Editing here will be a
/// form, and it is the next slice.
struct VaultCompView: View {
    let comp: VaultComp
    let payload: VaultPayload

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(comp.address.isEmpty ? "Address not recorded" : comp.address)
                        .font(.headline)
                    Text([comp.market, comp.propertyType]
                        .filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        if comp.published {
                            chip("Published", .green)
                            if comp.citedCount > 0 {
                                Text("cited in \(comp.citedCount) report\(comp.citedCount == 1 ? "" : "s")")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        if payload.sharedWithFirm.contains(comp.id),
                           let firm = payload.firm {
                            chip("Shared with \(firm.name)", .blue)
                        }
                    }
                }
                .padding(.vertical, 2)
            }

            Section("The deal") {
                ForEach(dealRows, id: \.label) { row in
                    LabeledContent(row.label, value: row.value)
                }
            }

            if !specRows.isEmpty {
                Section(comp.propertyType.isEmpty ? "Specs" : "\(comp.propertyType) specs") {
                    ForEach(specRows, id: \.label) { row in
                        LabeledContent(row.label, value: row.value)
                    }
                }
            }

            if !leaseRows.isEmpty {
                Section("Lease") {
                    ForEach(leaseRows, id: \.label) { row in
                        LabeledContent(row.label, value: row.value)
                    }
                }
            }

            if !comp.notes.isEmpty {
                Section("Notes") { Text(comp.notes) }
            }

            Section {
                // The one thing this screen must say about itself. A comp here
                // is in the broker's valuations and in nothing they send.
                Text("From your own records. Counted in your reports, and left out of anything you share.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle(comp.dealDate.isEmpty ? "Comp" : comp.dealDate)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var dealRows: [(label: String, value: String)] {
        var rows: [(String, String)] = []
        if !comp.transaction.isEmpty { rows.append(("Transaction", comp.transaction)) }
        if !comp.dealDate.isEmpty { rows.append(("Date", comp.dealDate)) }
        if let size = ReportFormat.count(comp.sizeSqft) { rows.append(("Size", "\(size) SF")) }
        if let price = ReportFormat.money(comp.price) { rows.append(("Price", price)) }
        // Derived server-side for priced SALES only. Never recomputed here.
        if let psf = ReportFormat.money(comp.pricePerSqft) { rows.append(("$/SF", psf)) }
        if let cap = comp.capRate.value { rows.append(("Cap rate", cap)) }
        if let ppu = ReportFormat.money(comp.pricePerUnit) { rows.append(("$/unit", ppu)) }
        if let ppa = ReportFormat.money(comp.pricePerAcre) { rows.append(("$/acre", ppa)) }
        if !comp.tenancy.isEmpty { rows.append(("Tenancy", comp.tenancy)) }
        if let year = comp.yearBuilt.value { rows.append(("Built", year)) }
        return rows
    }

    private var leaseRows: [(label: String, value: String)] {
        var rows: [(String, String)] = []
        if let rent = comp.rentPsf.value {
            // The basis is shown beside the figure, never assumed. California
            // quotes monthly and most of the country annually, so a bare
            // "$1.35/SF" is ambiguous by a factor of twelve.
            let basis = comp.rentBasis.isEmpty ? "" : " \(comp.rentBasis)"
            rows.append(("Rent", "$\(rent)/SF\(basis)"))
        }
        if let yr = comp.rentPsfYr.value { rows.append(("Annual", "$\(yr)/SF/yr")) }
        if !comp.leaseType.isEmpty { rows.append(("Structure", comp.leaseType)) }
        if !comp.leaseExpiry.isEmpty { rows.append(("Expires", comp.leaseExpiry)) }
        if !comp.optionNoticeDate.isEmpty { rows.append(("Option notice", comp.optionNoticeDate)) }
        return rows
    }

    /// Only the specs this property type actually carries, so a warehouse
    /// never shows an empty "Anchor tenant" row.
    private var specRows: [(label: String, value: String)] {
        var rows: [(String, String)] = []
        func add(_ label: String, _ v: LooseString) {
            if let s = v.value, !s.isEmpty { rows.append((label, s)) }
        }
        func addText(_ label: String, _ s: String) {
            if !s.isEmpty { rows.append((label, s)) }
        }
        add("Clear height", comp.clearHeight)
        add("Dock doors", comp.dockDoors)
        addText("Class", comp.buildingClass)
        add("Floor plate", comp.floorPlate)
        addText("Center type", comp.centerType)
        addText("Anchor tenant", comp.anchorTenant)
        add("Units", comp.units)
        add("Lot acres", comp.lotAcres)
        addText("Zoning", comp.zoning)
        addText("Beds / baths", comp.bedsBaths)
        return rows
    }

    private func chip(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }
}
