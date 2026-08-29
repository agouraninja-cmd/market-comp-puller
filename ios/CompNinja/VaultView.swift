import SwiftUI
import Charts
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
    @State private var adding = false

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
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        adding = true
                    } label: { Label("Add a comp", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $adding) {
                VaultCompFormView(mode: .add) {
                    Task { await vm.load(api: model.api) }
                }
                .environmentObject(model)
            }
            .safeAreaInset(edge: .bottom) {
                if let notice = vm.notice {
                    NoticeBar(text: notice,
                              undo: vm.undoable != nil
                                  ? { Task { await vm.undoDelete(api: model.api) } }
                                  : nil,
                              dismiss: { vm.notice = nil; vm.undoable = nil })
                }
            }
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

            if !vm.visible.isEmpty {
                VaultNumbers(comps: vm.visible)
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
                            VaultCompView(comp: comp, payload: vm.payload,
                                          onChanged: { Task { await vm.load(api: model.api) } })
                        } label: {
                            VaultCompRow(comp: comp,
                                         sharedWithFirm: vm.payload.sharedWithFirm.contains(comp.id))
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task { await vm.delete(comp, api: model.api) }
                            } label: { Label("Delete", systemImage: "trash") }
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

    // MARK: Delete, and putting it back

    /// The last deleted comp, held IN MEMORY ONLY.
    ///
    /// This catches the misclick noticed immediately, not a deletion regretted
    /// tomorrow. A store that survived a relaunch would promise more than it
    /// keeps, and the confirm below is worded to match what this actually is.
    @Published var undoable: VaultComp?
    @Published var notice: String?

    func delete(_ comp: VaultComp, api: APIClient) async {
        do {
            try await api.deleteVaultComp(id: comp.id)
            undoable = comp
            notice = "Deleted \(comp.address.isEmpty ? "that comp" : comp.address)."
            await load(api: api)
        } catch let e as APIError {
            notice = e.message
        } catch {
            notice = "Couldn't delete that. Please try again."
        }
    }

    /// Put it back through the ordinary add route.
    ///
    /// Deliberately POST /api/vault/comp rather than some restore endpoint, so
    /// a restored comp goes through `normalizeRow` like every other written
    /// row and cannot put back something the vault would refuse to be told
    /// today. Two consequences said plainly rather than left to be discovered:
    /// it comes back as a NEW entry belonging to no import, and a comp that
    /// was published is NOT republished, because publishing is a deliberate
    /// public act and undoing a delete is not consent to repeat it.
    func undoDelete(api: APIClient) async {
        guard let comp = undoable else { return }
        undoable = nil
        do {
            try await api.addVaultComp(VaultDraft(comp).body())
            notice = comp.published
                ? "Put back as a new entry. It is not published again, so publish it when you want to."
                : "Put back as a new entry."
            await load(api: api)
        } catch let e as APIError {
            notice = e.message
        } catch {
            notice = "Couldn't put that back. Please try again."
        }
    }

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

/// What just happened, with the way back where there is one.
private struct NoticeBar: View {
    let text: String
    let undo: (() -> Void)?
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(text).font(.caption).lineLimit(2)
            Spacer()
            if let undo {
                Button("Undo", action: undo).font(.caption.weight(.semibold))
            }
            Button {
                dismiss()
            } label: { Image(systemName: "xmark").font(.caption2) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }
}

/// The three panels the web keeps behind a reading strip: markets, years, and
/// buildings this book holds more than one deal on.
///
/// All three ship COLLAPSED, which is not a style choice. On the web these
/// were three bordered panels in front of the table and, measured on a seeded
/// book, they pushed the comps table from 1101px down to 4363px. A phone has
/// far less room, so the list a broker came for stays at the top and the
/// numbers are one tap away.
///
/// Every one of them is scoped by the SAME filter as the list above, so a
/// figure here always describes exactly what is on screen.
private struct VaultNumbers: View {
    let comps: [VaultComp]

    var body: some View {
        let buckets = VaultAnalytics.rollup(comps)
        let years = VaultAnalytics.byYear(comps)
        let repeats = VaultAnalytics.repeatProperties(comps)

        Section {
            if buckets.count > 1 {
                DisclosureGroup("Markets (\(buckets.count))") {
                    ForEach(buckets) { bucket in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(bucket.market).font(.subheadline)
                                Text(bucket.propertyType)
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            // A bucket with no median shows its comp count
                            // instead of a fabricated number.
                            if let median = bucket.median, let unit = bucket.unit {
                                Text(Self.rate(median, unit))
                                    .font(.subheadline.weight(.medium)).monospacedDigit()
                            } else {
                                Text("\(bucket.count) comp\(bucket.count == 1 ? "" : "s")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            if years.contains(where: { $0.median != nil }) {
                DisclosureGroup("By year") {
                    Chart(years.filter { $0.median != nil }) { point in
                        BarMark(x: .value("Year", String(point.year)),
                                y: .value("Median", point.median ?? 0))
                    }
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine()
                            AxisValueLabel {
                                if let n = value.as(Double.self) {
                                    Text(Self.rate(n, years.first?.unit ?? ""))
                                }
                            }
                        }
                    }
                    .frame(height: 160)
                    .padding(.vertical, 6)

                    // A year that could not state a median is named rather
                    // than silently missing from the chart.
                    let quiet = years.filter { $0.median == nil }
                    if !quiet.isEmpty {
                        // String(), never interpolation: SwiftUI's Text
                        // locale-formats an interpolated Int, so a year comes
                        // out as "2,025". The same trap the report side already
                        // carries a rule about for year_built — sizes get
                        // thousands separators, years never do.
                        Text(quiet.count == 1
                             ? "\(String(quiet[0].year)) mixes sales and leases, so it states no median."
                             : "\(quiet.map { String($0.year) }.joined(separator: ", ")) mix sales and leases, so they state no median.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }

            if !repeats.isEmpty {
                DisclosureGroup("Repeat properties (\(repeats.count))") {
                    ForEach(repeats) { property in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(property.address).font(.subheadline).lineLimit(2)
                            Text("\(property.count) deals · \(property.comps.compactMap { $0.dealDate.isEmpty ? nil : String($0.dealDate.prefix(4)) }.joined(separator: ", "))")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private static func rate(_ value: Double, _ unit: String) -> String {
        let n = value >= 100 ? String(Int(value.rounded())) : String(format: "%.2f", value)
        return "$\(n)\(unit.hasPrefix("$") ? String(unit.dropFirst()) : unit)"
    }
}
