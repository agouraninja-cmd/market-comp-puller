import SwiftUI
import CompNinjaKit

@main
struct CompNinjaApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
        }
    }
}

/// The property types the server knows about. Kept in lockstep with
/// TYPE_COMP_FIELDS in server.js — a type this list invents would come back
/// with no type-specific columns at all.
enum PropertyType: String, CaseIterable, Identifiable {
    case industrial = "Industrial"
    case office = "Office"
    case retail = "Retail"
    case multifamily = "Multifamily"
    case land = "Land"
    case residential = "Residential"

    var id: String { rawValue }
}

@MainActor
final class AppModel: ObservableObject {
    let api: APIClient
    let store: SavedReportStore

    @Published var account: Account?
    @Published var savedReports: [SavedReport] = []
    @Published var signInPrompt: String?

    /// Free accounts top out at a 12-month lookback; Pro gets 120. The app
    /// reads this off the account rather than guessing, and the server clamps
    /// regardless — an over-long ask still returns a report.
    var maxLookbackMonths: Int { (account?.isPro ?? false) ? 120 : 12 }

    init(api: APIClient = APIClient(), store: SavedReportStore = SavedReportStore()) {
        self.api = api
        self.store = store
        self.savedReports = store.all()
    }

    func refreshAccount() async {
        account = try? await api.me()
    }

    func save(_ report: Report, address: String, propertyType: String) {
        savedReports = store.save(SavedReport(address: address,
                                              propertyType: propertyType,
                                              report: report))
    }

    func delete(id: String) {
        savedReports = store.delete(id: id)
    }

    func signOut() async {
        try? await api.logOut()
        account = nil
    }

    /// Delete the account, then leave nothing behind on this device.
    ///
    /// The local wipe is deliberate and is NOT best-effort: these reports were
    /// served by an account that no longer exists. It runs only after the
    /// server confirms the deletion, so a failed call leaves the person's
    /// reports where they were rather than destroying them on a network error.
    func deleteAccount() async throws {
        try await api.deleteAccount()
        savedReports = store.deleteAll()
        account = nil
        signInPrompt = nil
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView {
            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            SavedReportsView()
                .tabItem { Label("Saved", systemImage: "tray.full") }
            NavigationStack { AccountView() }
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
        }
        .task { await model.refreshAccount() }
        .sheet(item: Binding(
            get: { model.signInPrompt.map(SignInPrompt.init) },
            set: { if $0 == nil { model.signInPrompt = nil } }
        )) { prompt in
            NavigationStack { AccountView(prompt: prompt.message) }
        }
    }
}

struct SignInPrompt: Identifiable {
    let message: String
    var id: String { message }
    init(_ message: String) { self.message = message }
}
