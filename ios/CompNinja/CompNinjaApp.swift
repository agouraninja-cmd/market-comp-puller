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

    /// This visitor's entitlements, from /api/config. Presentation only: it
    /// decides whether the Pipeline tab is in the bar, and nothing else. Every
    /// broker route enforces the same thing server-side, so a client that
    /// lied to itself here would just be refused with a 403.
    @Published var entitlements: Entitlements = Entitlements()

    /// Whether to offer the broker pipeline at all.
    ///
    /// The tab is ABSENT rather than locked for everyone else. A locked tab
    /// would need to explain itself, and any explanation of what is behind it
    /// is advertising a purchase the app is forbidden to advertise under
    /// guideline 3.1.3(b) — the same rule that lets this app serve web-bought
    /// Pro in the first place.
    var showsPipeline: Bool { entitlements.broker }

    /// The book is gated on the CAPABILITY, not the identity. The server keeps
    /// `broker` and `canUseVault` separate because the vault is a private-data
    /// workspace, and mirroring that split is what stops one flag quietly
    /// standing in for the other.
    var showsVault: Bool { entitlements.canUseVault }

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
        // Entitlements are per-user, so this rides with the account read and
        // has to re-run on sign-in, sign-out and account deletion. A failure
        // leaves the default, which grants nothing.
        entitlements = (try? await api.config())?.pro ?? Entitlements()
    }

    /// Returns the report as STORED, which is not always the one passed in:
    /// re-running a property replaces its saved copy and keeps the original
    /// id, so the caller must navigate to the row that actually exists.
    @discardableResult
    func save(_ report: Report, address: String, propertyType: String) -> SavedReport {
        let candidate = SavedReport(address: address, propertyType: propertyType, report: report)
        savedReports = store.save(candidate)
        return savedReports.first { $0.key == candidate.key } ?? candidate
    }

    func delete(id: String) {
        savedReports = store.delete(id: id)
    }

    func signOut() async {
        try? await api.logOut()
        account = nil
        entitlements = Entitlements()
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
        entitlements = Entitlements()
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
            if model.showsVault {
                VaultView()
                    .tabItem { Label("Book", systemImage: "building.2") }
            }
            if model.showsPipeline {
                PipelineView()
                    .tabItem { Label("Pipeline", systemImage: "list.bullet.rectangle") }
            }
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
