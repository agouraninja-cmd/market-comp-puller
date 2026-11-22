#if DEBUG
import SwiftUI

/// Screenshot mode, for the App Store pictures only.
///
/// `.github/workflows/ios-screenshots.yml` launches a DEBUG simulator build
/// with `-demoScene <name>` after writing a sample saved report into the app's
/// store, and the app opens straight on that screen so `simctl io screenshot`
/// can photograph it. `simctl` cannot tap, which is the whole reason this
/// exists. None of it is compiled into a Release build, so the App Store
/// binary never reads the argument.
enum DemoScene: String {
    case search, saved, report, map, comp

    static let current: DemoScene? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-demoScene"), i + 1 < args.count else { return nil }
        return DemoScene(rawValue: args[i + 1])
    }()

    /// The tab RootView opens on. Matches the `.tag`s there.
    static var initialTab: Int {
        switch current {
        case .saved, .report, .map, .comp: return 1
        default: return 0
        }
    }

    /// Whether the Saved tab pushes the newest saved report on appear.
    static var opensReport: Bool {
        current == .report || current == .map || current == .comp
    }
}
#endif
