import SwiftUI
import CompNinjaKit

/// Every report this phone has run, readable with no signal at all.
///
/// This is the app's answer to "why isn't this just the website": a broker
/// standing in a building with one bar can open last week's report on the
/// property next door. Nothing here touches the network.
struct SavedReportsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            Group {
                if model.savedReports.isEmpty {
                    ContentUnavailableView(
                        "No reports yet",
                        systemImage: "tray",
                        description: Text("Reports you run are kept here and open without a connection.")
                    )
                } else {
                    List {
                        ForEach(model.savedReports) { saved in
                            NavigationLink {
                                ReportView(saved: saved)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(saved.address).font(.subheadline.weight(.medium)).lineLimit(2)
                                    Text("\(saved.propertyType) · \(saved.savedAt.formatted(date: .abbreviated, time: .omitted)) · \(saved.report.comps.count) comps")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .onDelete { offsets in
                            for index in offsets { model.delete(id: model.savedReports[index].id) }
                        }
                    }
                }
            }
            .navigationTitle("Saved")
        }
    }
}
