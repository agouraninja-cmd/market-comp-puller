// swift-tools-version: 5.9
import PackageDescription

// The app's core, kept out of the app target on purpose: models, the API
// client, the SSE reader and the offline store all run — and are TESTED — on
// macOS, so `swift test` works on a machine with only Command Line Tools
// installed. Only the SwiftUI views need a full Xcode.
let package = Package(
    name: "CompNinjaKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "CompNinjaKit", targets: ["CompNinjaKit"]),
    ],
    targets: [
        .target(name: "CompNinjaKit"),
        .testTarget(
            name: "CompNinjaKitTests",
            dependencies: ["CompNinjaKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
