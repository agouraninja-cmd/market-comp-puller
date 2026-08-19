import SwiftUI

/// App entry point.
///
/// The shell is intentionally thin: CompNinja's product surface is the web
/// app, and duplicating it natively would mean two implementations of the
/// valuation UI drifting apart. What lives here instead is the layer a web
/// page cannot provide -- offline handling, a biometric lock over the broker
/// vault, the system share sheet, and correct routing of external links --
/// which is also what App Review's Guideline 4.2 asks for. See
/// docs/IOS-APP-STORE.md for why each of those is here rather than being a
/// nice-to-have.
@main
struct CompNinjaApp: App {
    /// The one place the origin is configured. Everything downstream decides
    /// "is this us?" against this, so pointing the app at a staging host is a
    /// single edit rather than a search for hard-coded strings.
    static let origin = URL(string: "https://compninja.co")!

    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var vaultLock = VaultLock()

    var body: some Scene {
        WindowGroup {
            WebShellView(vaultLock: vaultLock)
                .ignoresSafeArea(.container, edges: .bottom)
                .onOpenURL { url in
                    // Universal Links: a tap on https://compninja.co/r/<id>
                    // anywhere in iOS. The server only advertises paths this
                    // shell can actually render -- see the AASA route in
                    // server.js, which deliberately excludes the Stripe
                    // checkout return.
                    NotificationCenter.default.post(name: .openCompNinjaURL, object: url)
                }
                .onChange(of: scenePhase) { phase in
                    // Re-arm the vault lock whenever the app leaves the
                    // foreground. Backgrounding is the moment a phone changes
                    // hands, and a broker's book is the one screen here that
                    // is worth a second authentication.
                    if phase != .active { vaultLock.lock() }
                }
        }
    }
}

extension Notification.Name {
    static let openCompNinjaURL = Notification.Name("openCompNinjaURL")
}
