import SwiftUI
import CompNinjaKit

/// The broker's book: every comp they hold, filterable, on a phone.
///
/// This is one of the web's two vault decks. The other, the pipeline, is its
/// own tab here rather than a second scroll on this one — tabs are what a
/// phone has instead of decks, and a broker looking up a comp should not have
/// to scroll past their pipeline to reach it.
///
/// The book is private data. Two rules carry over from the web and neither is
/// cosmetic: an error is never drawn as an empty vault, and an empty RESULT
/// says which kind of empty it is.
struct VaultView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var vm = VaultModel()

    var body: some View {
        NavigationStack {
            Group {
                switch vm.state {
                case .loading:
                    ProgressView("Loading your book")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                case .failed(let message):
                    // The server refuses with a 503 rather than answering with
                    // an empty list, precisely so this can say it could not
                    // load. An empty book drawn on an error reads as the vault
                    // having lost the broker's work.
                    ContentUnavailableView {
                        Label("Couldn't load your book", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") { Task { await vm.load(api: model.api) } }
                    }

                case .loaded:
                    content
                }
            }
            .navigationTitle("Your book")
            .searchable(text: $vm.filter.search, prompt: "Find an address, note or tenant")
            .refreshable { await vm.load(api: model.api) }
        }
        .task { await vm.load(api: model.api) }
    }

    @ViewBuilder
    private var content: some View {
        List {
            if !vm.payload.comps.isEmpty {
                Section {
                    TrustLine(payload: vm.payload, shown: vm.visible.count,
                              median: Vault.medianRate(vm.visible))
                    FilterRow(vm: vm)
                }
            }

            if vm.visible.isEmpty {
                Section {
                    // Which of the two empty states this is matters. Telling a
                    // broker who searched for a deal they own that there is
                    // "nothing here yet" reads as the vault having lost their
                    // book.
                    if vm.payload.comps.isEmpty {
                        VaultEmptyInvitation()
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("No comps match this filter")
                                .font(.subheadline.weight(.medium))
                            Button("Clear filters") { vm.clearFilters() }
                                .font(.caption)
                        }
                        .padding(.vertical, 8)
                    }
                }
            } else {
                Section {
                    ForEach(vm.visible) { comp in
                        NavigationLink {
                            VaultCompView(comp: comp, payload: vm.payload)
                        } label: {
                            VaultCompRow(comp: comp,
                                         sharedWithFirm: vm.payload.sharedWithFirm.contains(comp.id))
                        }
                    }
                } header: {
                    Text(vm.filter.isActive
                         ? "\(vm.visible.count) of \(vm.payload.comps.count)"
                         : "\(vm.visible.count) comps")
                }
            }

            if vm.truncated {
                Section {
                    // Says it rather than under-reporting. The counts above
                    // describe the whole book, so a silently short list would
                    // make them look wrong.
                    Label("Showing the first \(vm.payload.comps.count). Open your book on the web to see the rest.",
                          systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// The privacy statement and the counts, zeros included.
///
/// The zeros are the point: a broker should be able to watch "0 published"
/// stay at zero. Hiding the line until something is in it would remove the
/// only thing that makes the promise checkable.
private struct TrustLine: View {
    let payload: VaultPayload
    let shown: Int
    let median: (value: Double, unit: String)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 16) {
                stat("\(payload.comps.count)", "in your book")
                stat("\(payload.counts.published)", "published")
                if let median {
                    stat(rate(median), median.unit)
                } else {
                    stat("—", "median")
                }
            }
            Text(privacyLine)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    /// Corrects itself once something really is shared, keyed on having
    /// shared rather than on being in a firm: a broker who has shared nothing
    /// genuinely does have a book visible only to them.
    private var privacyLine: String {
        if let firm = payload.firm, !payload.sharedWithFirm.isEmpty {
            return "Visible only to you, except \(payload.sharedWithFirm.count) comp\(payload.sharedWithFirm.count == 1 ? "" : "s") shared with \(firm.name)."
        }
        return "Visible only to you. Never published unless you publish it."
    }

    private func rate(_ r: (value: Double, unit: String)) -> String {
        r.value >= 100 ? "$\(Int(r.value.rounded()))" : String(format: "$%.2f", r.value)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.title3.weight(.medium)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

private struct FilterRow: View {
    @ObservedObject var vm: VaultModel

    var body: some View {
        VStack(spacing: 8) {
            Picker("Deal", selection: $vm.filter.deal) {
                ForEach(VaultFilter.Deal.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            HStack {
                menu(title: vm.filter.market.isEmpty ? "All markets" : vm.filter.market,
                     options: vm.payload.markets,
                     selection: $vm.filter.market,
                     allLabel: "All markets")
                menu(title: vm.filter.propertyType.isEmpty ? "All types" : vm.filter.propertyType,
                     options: vm.payload.types,
                     selection: $vm.filter.propertyType,
                     allLabel: "All types")
                if vm.filter.isActive {
                    Button("Clear") { vm.clearFilters() }
                        .font(.caption)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func menu(title: String, options: [String],
                      selection: Binding<String>, allLabel: String) -> some View {
        Menu {
            Button(allLabel) { selection.wrappedValue = "" }
            ForEach(options, id: \.self) { option in
                Button(option) { selection.wrappedValue = option }
            }
        } label: {
            HStack(spacing: 2) {
                Text(title).lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2)
            }
            .font(.caption)
        }
        .buttonStyle(.bordered)
    }
}

private struct VaultEmptyInvitation: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Nothing in your book yet").font(.subheadline.weight(.medium))
            Text("Add a deal you closed, and it joins your own reports as a comparable only you can see. Importing a whole book is on the web.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
    }
}

private struct VaultCompRow: View {
    let comp: VaultComp
    let sharedWithFirm: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(comp.address.isEmpty ? "Address not recorded" : comp.address)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)

            Text(factLine).font(.caption).foregroundStyle(.secondary)

            HStack(spacing: 6) {
                if let r = comp.rate {
                    Text(rateLabel(r)).font(.caption.weight(.medium))
                }
                if comp.published {
                    chip("Published", .green)
                    // Omitted at zero rather than shown as "0" beside every
                    // freshly published comp.
                    if comp.citedCount > 0 {
                        Text("cited \(comp.citedCount)×")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if sharedWithFirm { chip("Firm", .blue) }
            }
        }
        .padding(.vertical, 2)
    }

    private var factLine: String {
        var parts: [String] = []
        if !comp.propertyType.isEmpty { parts.append(comp.propertyType) }
        if !comp.transaction.isEmpty { parts.append(comp.transaction) }
        if let size = ReportFormat.count(comp.sizeSqft) { parts.append("\(size) SF") }
        if !comp.dealDate.isEmpty { parts.append(comp.dealDate) }
        return parts.joined(separator: " · ")
    }

    /// "$120/SF", not "$120 $/SF". The unit names itself with a dollar sign
    /// because "$/SF" is how the trade writes the LABEL; inline beside a
    /// figure the sign belongs to the number instead.
    private func rateLabel(_ r: (value: Double, unit: String)) -> String {
        let n = r.value >= 100 ? String(Int(r.value.rounded())) : String(format: "%.2f", r.value)
        return "$\(n)\(r.unit.hasPrefix("$") ? String(r.unit.dropFirst()) : r.unit)"
    }

    private func chip(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }
}

@MainActor
final class VaultModel: ObservableObject {
    enum State: Equatable {
        case loading, loaded, failed(String)
    }

    @Published var state: State = .loading
    @Published var payload = VaultPayload()
    @Published var filter = VaultFilter()

    /// The route caps at 1000 and the app asks for the cap, so a book at
    /// exactly that size is the one that might be short.
    var truncated: Bool { payload.comps.count >= 1000 }

    var visible: [VaultComp] { Vault.apply(filter, to: payload.comps) }

    func clearFilters() { filter = VaultFilter() }

    func load(api: APIClient) async {
        do {
            payload = try await api.vault()
            state = .loaded
        } catch let e as APIError {
            // The server's own sentence. Its 403 explains what a broker needs,
            // and rewriting that locally would be a second copy of a rule.
            state = .failed(e.message)
        } catch {
            state = .failed("Something went wrong. Please try again.")
        }
    }
}
