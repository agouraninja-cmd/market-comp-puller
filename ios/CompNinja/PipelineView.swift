import SwiftUI
import CompNinjaKit

/// The broker's pipeline: one list from a new enquiry through won or lost.
///
/// Mirrors the web's `/vault` pipeline deck rather than inventing a second
/// vocabulary. A lead is the `New` stage whose only action is asking for an
/// introduction; everything past that is a BOV row the broker owns and sets
/// the status on.
///
/// **This screen sells nothing.** Guideline 3.1.3(b) is what lets the app
/// serve web-bought Pro at all, and it forbids advertising the purchase — so
/// a person without the entitlement never reaches this tab (it is not in the
/// bar) rather than reaching a locked version of it with an upgrade prompt.
struct PipelineView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var vm = PipelineModel()

    var body: some View {
        NavigationStack {
            Group {
                switch vm.state {
                case .loading:
                    ProgressView("Loading your pipeline")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                case .failed(let message):
                    // Deliberately NOT an empty state. The server returns 503
                    // rather than an empty list precisely so this can say "we
                    // could not load it" — an empty pipeline shown on an error
                    // reads as "no demand in my markets", which is the one
                    // wrong answer here that changes what a broker does next.
                    ContentUnavailableView {
                        Label("Couldn't load your pipeline", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") { Task { await vm.load(api: model.api) } }
                    }

                case .loaded where vm.items.isEmpty:
                    ContentUnavailableView {
                        Label("Nothing in the pipeline yet", systemImage: "tray")
                    } description: {
                        Text(vm.coverage.isEmpty
                             ? "Add the markets you cover on the web and enquiries in them will appear here."
                             : "Enquiries in the markets you cover will appear here.")
                    }

                case .loaded:
                    List {
                        Section {
                            StageStrip(counts: vm.counts)
                                .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                            if let note = vm.summaryLine {
                                Text(note).font(.caption).foregroundStyle(.secondary)
                            }
                        }

                        Section {
                            ForEach(vm.items) { item in
                                PipelineRow(item: item, vm: vm, api: model.api)
                            }
                        }

                        if !vm.coverage.isEmpty {
                            Section("Markets you watch") {
                                ForEach(vm.coverage) { c in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(c.market).font(.subheadline)
                                            Text(c.propertyType).font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        // The reach has to be stated. A lead
                                        // from a city the broker never typed
                                        // otherwise reads as a bug in the one
                                        // surface whose whole job is being
                                        // trusted about where their business is.
                                        if c.nearby > 0 {
                                            Text("+\(c.nearby) nearby")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Pipeline")
            .refreshable { await vm.load(api: model.api) }
        }
        .task { await vm.load(api: model.api) }
    }
}

/// The five-cell stage strip. Every cell renders always, including the zeros:
/// the shape of the pipeline is the information, and a stage that vanishes at
/// zero makes two different pipelines look identical.
private struct StageStrip: View {
    let counts: [PipelineStage: Int]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(PipelineStage.allCases, id: \.self) { stage in
                VStack(spacing: 3) {
                    Text("\(counts[stage] ?? 0)")
                        .font(.title3.weight(.medium))
                        .monospacedDigit()
                    Text(stage.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct PipelineRow: View {
    let item: PipelineItem
    @ObservedObject var vm: PipelineModel
    let api: APIClient

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(item.market.isEmpty ? "Market not recorded" : item.market)
                    .font(.subheadline.weight(.medium))
                if item.is1031 {
                    // The one fact that changes how fast a broker moves, and
                    // the only thing the anonymization allowlist lets through
                    // about the person enquiring.
                    Text("1031")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.orange.opacity(0.18), in: Capsule())
                }
            }

            Text(detailLine).font(.caption).foregroundStyle(.secondary)

            switch item.kind {
            case .lead(let lead):
                LeadAction(lead: lead, vm: vm, api: api)
            case .bov(let bov):
                Picker("Status", selection: Binding(
                    get: { bov.status },
                    set: { vm.setStatus($0, on: bov, api: api) }
                )) {
                    ForEach(BOVStatus.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
        }
        .padding(.vertical, 4)
    }

    private var detailLine: String {
        var parts: [String] = []
        if !item.propertyType.isEmpty { parts.append(item.propertyType) }
        if let size = ReportFormat.count(item.sizeSqft) { parts.append("\(size) SF") }
        if let when = Self.display(item.sortDate) { parts.append(when) }
        return parts.joined(separator: " · ")
    }

    /// Dates arrive in two shapes: an ISO timestamp on a lead, a bare
    /// YYYY-MM-DD on a BOV's `received_on`. Both are shown as a plain date.
    private static func display(_ raw: String) -> String? {
        guard !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = iso.date(from: raw)
        if date == nil {
            iso.formatOptions = [.withInternetDateTime]
            date = iso.date(from: raw)
        }
        if date == nil {
            let plain = DateFormatter()
            plain.dateFormat = "yyyy-MM-dd"
            plain.timeZone = TimeZone(identifier: "UTC")
            date = plain.date(from: String(raw.prefix(10)))
        }
        guard let date else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

private struct LeadAction: View {
    let lead: Lead
    @ObservedObject var vm: PipelineModel
    let api: APIClient

    var body: some View {
        if lead.introRequested || vm.introRequested.contains(lead.id) {
            Label("Introduction requested", systemImage: "checkmark.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else if vm.introInFlight.contains(lead.id) {
            ProgressView().controlSize(.small)
        } else {
            Button("Ask for an introduction") {
                Task { await vm.requestIntro(lead, api: api) }
            }
            .font(.caption.weight(.medium))
            .buttonStyle(.bordered)
        }
    }
}

@MainActor
final class PipelineModel: ObservableObject {
    enum State: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    @Published var state: State = .loading
    @Published var items: [PipelineItem] = []
    @Published var coverage: [Coverage] = []
    @Published var counts: [PipelineStage: Int] = [:]
    @Published var summaryLine: String?
    @Published var introRequested: Set<String> = []
    @Published var introInFlight: Set<String> = []

    func load(api: APIClient) async {
        do {
            // Both halves, in parallel. Either one failing fails the screen:
            // a pipeline missing its BOVs is not a partial answer, it is a
            // wrong one, because the stage counts would be wrong too.
            async let inbox = api.brokerLeads()
            async let log = api.brokerBOVs()
            let (i, l) = try await (inbox, log)

            items = Pipeline.merge(leads: i.leads, bovs: l.bovs)
            coverage = i.coverage
            counts = Pipeline.counts(items)
            summaryLine = Self.summary(l.rollup)
            state = .loaded
        } catch let e as APIError {
            // The server's own sentence, never a local rewrite. Two clients
            // telling different stories about one failure is a support ticket
            // nobody can reproduce.
            state = .failed(e.message)
        } catch {
            state = .failed("Something went wrong. Please try again.")
        }
    }

    private static func summary(_ r: BOVRollup) -> String? {
        var parts: [String] = []
        if r.thisYear > 0 { parts.append("\(r.thisYear) this year") }
        if let rate = r.winRateLabel {
            parts.append("\(rate) win rate")
        } else if r.decided > 0 {
            // Says why there is no figure rather than leaving a gap. The floor
            // is three decided; below it a rate is noise.
            parts.append("win rate after 3 decided")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    func requestIntro(_ lead: Lead, api: APIClient) async {
        introInFlight.insert(lead.id)
        defer { introInFlight.remove(lead.id) }
        do {
            _ = try await api.requestIntro(leadID: lead.id)
            // Marked whether this was new or already recorded: both mean the
            // broker has raised their hand, and the server will not email
            // twice.
            introRequested.insert(lead.id)
        } catch let e as APIError {
            state = .failed(e.message)
        } catch {
            state = .failed("Couldn't send that request. Please try again.")
        }
    }

    /// Optimistic, because a status change is the one thing done repeatedly
    /// here and a round trip per tap makes the control feel broken. A failure
    /// reloads from the server rather than rolling back by hand, so the screen
    /// can never end up showing a status the server did not accept.
    func setStatus(_ status: BOVStatus, on bov: BOV, api: APIClient) {
        guard let index = items.firstIndex(where: { $0.id == "bov-" + bov.id }) else { return }
        var updated = bov
        updated.statusRaw = status.rawValue
        items[index] = PipelineItem(kind: .bov(updated))
        counts = Pipeline.counts(items)

        // The stage strip is derived from `items` and moves immediately, but
        // the summary line's win rate comes from the server's rollup and its
        // three-decided floor. Recomputing that here would be a second copy of
        // a rule that lives on the server, so the line is instead reconciled
        // by reloading — otherwise the strip reads 3 won / 1 lost while the
        // line under it still says 67%, which is two figures on one screen
        // disagreeing about the same thing.
        //
        // The reload runs on success AND failure. On failure it is also the
        // rollback: the screen can never end up showing a status the server
        // did not accept.
        Task {
            try? await api.updateBOV(id: bov.id, status: status)
            await load(api: api)
        }
    }
}
