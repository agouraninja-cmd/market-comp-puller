// Generates the app icon from the brand mark. Run:
//
//   swift ios/Tools/make-app-icon.swift
//
// The mark is favicon.svg in the repo root: a navy card with a red diagonal
// running bottom-left to top-right. It is NOT reused verbatim here, and the
// reason is the platform. iOS masks every icon to its own squircle, so the
// favicon's inner rounded rect would sit inside Apple's rounded shape with
// dead corners around it. The icon is full-bleed instead: same two brand
// colors, same diagonal, no inner card. iOS icons also may not carry an alpha
// channel, so the bitmap is deliberately opaque.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// favicon.svg: fill="#1A2433" (card) and fill="#B91C1C" (diagonal).
let navy = CGColor(srgbRed: 0x1A / 255, green: 0x24 / 255, blue: 0x33 / 255, alpha: 1)
let red  = CGColor(srgbRed: 0xB9 / 255, green: 0x1C / 255, blue: 0x1C / 255, alpha: 1)

// The favicon's band spans 4.5 units across a 26-unit-wide card: 17%, measured
// along the edge it crosses. Keeping that ratio keeps the two marks the same
// shape rather than merely the same colors.
let bandRatio = 0.17

func renderIcon(size: Int, to url: URL) throws {
    let s = Double(size)
    guard let ctx = CGContext(
        data: nil, width: size, height: size,
        bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else { throw Err("could not create a \(size)px context") }

    ctx.setFillColor(navy)
    ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))

    // CoreGraphics puts the origin at the BOTTOM left, so this runs from the
    // bottom-left corner to the top-right one, matching the SVG's direction
    // even though the SVG's y axis points the other way.
    let band = s * bandRatio
    ctx.setFillColor(red)
    ctx.beginPath()
    ctx.move(to: CGPoint(x: 0, y: 0))
    ctx.addLine(to: CGPoint(x: s, y: s))
    ctx.addLine(to: CGPoint(x: s, y: s - band))
    ctx.addLine(to: CGPoint(x: band, y: 0))
    ctx.closePath()
    ctx.fillPath()

    guard let image = ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw Err("could not encode \(url.lastPathComponent)") }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { throw Err("could not write \(url.lastPathComponent)") }
    print("wrote \(url.path) (\(size)x\(size))")
}

struct Err: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1
               ? CommandLine.arguments[1]
               : FileManager.default.currentDirectoryPath)
let iconSet = root.appendingPathComponent("ios/CompNinja/Assets.xcassets/AppIcon.appiconset")
try FileManager.default.createDirectory(at: iconSet, withIntermediateDirectories: true)

// One 1024 icon is all Xcode 15+ needs; it derives every other size.
try renderIcon(size: 1024, to: iconSet.appendingPathComponent("icon-1024.png"))
// A home-screen-sized copy, written next to the build so the small-size
// legibility of the mark can actually be looked at rather than assumed.
try renderIcon(size: 120, to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("compninja-icon-120.png"))
