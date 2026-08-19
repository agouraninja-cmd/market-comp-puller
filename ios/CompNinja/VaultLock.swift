import Foundation
import LocalAuthentication

/// Face ID / Touch ID over the broker vault.
///
/// This is the clearest native-only capability in the app. The vault is a
/// broker's private book of business -- off-market deals, client addresses,
/// prices under NDA -- and on the web it is protected by nothing more than
/// whoever is holding an unlocked phone with a live session cookie. A
/// biometric gate in front of that path is something the web app genuinely
/// cannot do for itself.
///
/// Deliberately a gate, not an encryption story: the data lives on the server
/// and is fetched over an authenticated session either way. This stops a
/// shoulder-surfer and a borrowed phone, and it does not pretend to stop
/// anyone who has the device passcode -- which is why `.deviceOwnerAuthentication`
/// is used rather than the biometrics-only variant. Falling back to the
/// passcode means the feature still works for a broker whose Face ID is
/// failing in the cold, instead of locking them out of their own book.
@MainActor
final class VaultLock: ObservableObject {
    /// How long an unlock lasts. Short enough that a phone left on a desk
    /// re-locks, long enough that moving between vault pages does not ask
    /// again. Backgrounding the app re-locks regardless, which is the case
    /// that actually matters.
    private static let graceInterval: TimeInterval = 5 * 60

    @Published private(set) var isUnlocked = false
    private var unlockedAt: Date?

    /// Whether the broker has asked for this at all. Off by default: an app
    /// that demands Face ID before anyone has opted in reads as broken rather
    /// than careful, and a vault with nothing in it is not worth a prompt.
    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "vaultLockEnabled") }
        set { UserDefaults.standard.set(newValue, forKey: "vaultLockEnabled") }
    }

    var isCurrent: Bool {
        guard isUnlocked, let at = unlockedAt else { return false }
        return Date().timeIntervalSince(at) < Self.graceInterval
    }

    func lock() {
        isUnlocked = false
        unlockedAt = nil
    }

    /// Returns true when the vault may be shown. Fails CLOSED on every error
    /// path except one: a device with no passcode at all cannot authenticate
    /// anybody, so refusing there would make the vault permanently
    /// unreachable on that phone rather than merely unprotected.
    func authenticate() async -> Bool {
        guard enabled else { return true }
        if isCurrent { return true }

        let context = LAContext()
        context.localizedFallbackTitle = "Use passcode"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            lock()
            return false
        }

        do {
            let ok = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock your broker vault"
            )
            isUnlocked = ok
            unlockedAt = ok ? Date() : nil
            return ok
        } catch {
            lock()
            return false
        }
    }
}
