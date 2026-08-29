import SwiftUI
import CompNinjaKit

/// The minute-long wait, narrated.
///
/// A report is slow because of how long it takes to WRITE, not to search, so
/// the wait is this app's longest-held screen. The stream is doing real work
/// and says so: the live web query, comps appearing as they are found, the
/// summary sentence as it lands.
struct SearchingView: View {
    let search: RunningSearch
    let completion: (Result<Report, Error>) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var narrator = ProgressNarrator()
    @State private var task: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Spacer()
                Button("Cancel") {
                    task?.cancel()
                    dismiss()
                }
            }

            Text(narrator.headline)
                .font(.title2.weight(.semibold))
                .animation(.default, value: narrator.headline)

            ProgressView(value: narrator.fraction)
                .animation(.easeInOut(duration: 0.4), value: narrator.fraction)

            if !narrator.detail.isEmpty {
                Text(narrator.detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            if narrator.identifiedComps > 0 {
                Label("\(narrator.identifiedComps) comparable\(narrator.identifiedComps == 1 ? "" : "s") found",
                      systemImage: "checkmark.circle")
                    .font(.subheadline)
            }
            if narrator.lockedComps > 0 {
                // Redacted, never blurred — the same stance the report takes.
                Text("\(narrator.lockedComps) more found but not included on your plan")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(search.address)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .task { start() }
        .onDisappear { task?.cancel() }
    }

    private func start() {
        guard task == nil else { return }
        task = Task {
            do {
                let report = try await model.api.runReport(search.request) { event in
                    Task { @MainActor in narrator.apply(event) }
                }
                guard !Task.isCancelled else { return }
                completion(.success(report))
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                completion(.failure(error))
            }
        }
    }
}
