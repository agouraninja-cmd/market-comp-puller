import Foundation
import Testing
@testable import CompNinjaKit

@Suite("Progress stream")
struct SSEParserTests {

    func frames(_ text: String) -> [SSEEvent] {
        var parser = SSEParser()
        return parser.consume(Data(text.utf8))
    }

    @Test func parsesProgressAndResult() throws {
        let events = frames("""
        event: progress
        data: {"phase":"search","query":"industrial sales Grand Prairie TX","n":2}

        event: result
        data: {"comps":[],"locked_count":3}


        """)
        #expect(events.count == 2)
        guard case .progress(let p) = events[0] else { Issue.record("expected progress"); return }
        #expect(p.phase == "search")
        #expect(p.n == 2)
        guard case .result(let data) = events[1] else { Issue.record("expected result"); return }
        #expect(try JSONDecoder().decode(Report.self, from: data).lockedCount == 3)
    }

    /// The failure this type exists for: bytes arrive split wherever the
    /// network felt like splitting them, including in the middle of a frame.
    @Test func frameSplitAcrossChunksIsHeldUntilComplete() {
        var parser = SSEParser()
        let bytes = Array("event: progress\ndata: {\"phase\":\"writing\"}\n\n".utf8)
        var events: [SSEEvent] = []
        for i in stride(from: 0, to: bytes.count, by: 3) {
            events += parser.consume(Data(bytes[i..<min(i + 3, bytes.count)]))
        }
        #expect(events.count == 1)
        guard case .progress(let p) = events.first else { Issue.record("expected progress"); return }
        #expect(p.phase == "writing")
    }

    /// A multi-byte character split across two chunks must not corrupt the
    /// frame — the ellipsis in the server's copy is three bytes.
    @Test func multibyteCharacterSplitAcrossChunks() {
        var parser = SSEParser()
        let whole = Array("event: progress\ndata: {\"phase\":\"corpus\",\"market\":\"Dallas…\",\"coverage\":9}\n\n".utf8)
        let cut = whole.count - 6
        var events = parser.consume(Data(whole[0..<cut]))
        events += parser.consume(Data(whole[cut...]))
        #expect(events.count == 1)
        guard case .progress(let p) = events.first else { Issue.record("expected progress"); return }
        #expect(p.market == "Dallas…")
        #expect(p.coverage == 9)
    }

    @Test func errorFrameCarriesTheServersSentence() {
        #expect(frames("event: error\ndata: {\"error\":\"The search failed.\"}\n\n")
                == [.failure("The search failed.")])
    }

    /// An event name this build has never heard of is ignored. The server may
    /// add frames; an older app must not turn them into an error card.
    @Test func unknownEventIsIgnored() {
        #expect(frames("event: telemetry\ndata: {\"x\":1}\n\n").isEmpty)
    }

    /// A stream that ends with neither result nor error is a dropped
    /// connection. Without this the waiting screen sits there forever.
    @Test func streamEndingWithoutAResultIsADrop() {
        let parser = SSEParser()
        guard case .failure(let message)? = parser.finish(sawResult: false) else {
            Issue.record("expected a drop"); return
        }
        #expect(message.contains("connection dropped"))
        #expect(parser.finish(sawResult: true) == nil)
    }

    @Test func multiLineDataIsConcatenated() {
        let events = frames("event: progress\ndata: {\"phase\":\ndata: \"results\",\"count\":12}\n\n")
        guard case .progress(let p) = events.first else { Issue.record("expected progress"); return }
        #expect(p.phase == "results")
        #expect(p.count == 12)
    }
}
