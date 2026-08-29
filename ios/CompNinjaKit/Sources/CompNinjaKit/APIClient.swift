import Foundation

public struct APIError: LocalizedError, Equatable {
    public let status: Int
    public let message: String
    /// The server's own ask, not an error: the guest search cap answers with
    /// `signin_required` and a sentence written server-side. The app shows
    /// that sentence and opens sign-in; it never writes its own copy for this.
    public let signInRequired: Bool

    public var errorDescription: String? { message }

    public init(status: Int, message: String, signInRequired: Bool = false) {
        self.status = status
        self.message = message
        self.signInRequired = signInRequired
    }
}

public struct Account: Codable, Equatable, Sendable {
    public var email: String?
    public var name: String?
    public var plan: String?
    public var pro: Bool?

    /// Pro is whatever the SERVER says it is. The app never infers it from a
    /// receipt or a local flag, because on iOS there is no receipt to infer
    /// from — see the purchase note in ios/README.md.
    public var isPro: Bool { pro == true || (plan ?? "").lowercased() == "pro" }
}

public struct SearchRequest: Sendable {
    public var address: String
    public var type: String
    public var note: String?
    public var months: Int?
    public var maxComps: Int?
    /// "both" | "sales" | "leases"
    public var txFocus: String?
    public var subjectSizeSqft: Int?

    public init(address: String, type: String, note: String? = nil, months: Int? = nil,
                maxComps: Int? = nil, txFocus: String? = nil, subjectSizeSqft: Int? = nil) {
        self.address = address
        self.type = type
        self.note = note
        self.months = months
        self.maxComps = maxComps
        self.txFocus = txFocus
        self.subjectSizeSqft = subjectSizeSqft
    }

    func body(stream: Bool) -> [String: Any] {
        var b: [String: Any] = ["address": address, "type": type, "stream": stream]
        if let note, !note.isEmpty { b["note"] = note }
        if let months { b["months"] = months }
        if let maxComps { b["maxComps"] = maxComps }
        if let txFocus { b["txFocus"] = txFocus }
        // The NOI never leaves the device — the server only needs the size, to
        // bias the comp search toward similar buildings. Same rule the browser
        // follows.
        if let subjectSizeSqft { b["subjectSizeSqft"] = subjectSizeSqft }
        return b
    }
}

/// What a running search reports back.
public enum SearchUpdate: Sendable {
    case progress(ProgressEvent)
    case finished(Report)
}

public final class APIClient: @unchecked Sendable {
    public let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL = URL(string: "https://compninja.co")!, session: URLSession? = nil) {
        self.baseURL = baseURL
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            // The session is a `cn_session` cookie — HttpOnly, SameSite=Lax,
            // 90 days. URLSession's own cookie store handles it end to end, so
            // the app never holds the token itself.
            config.httpCookieAcceptPolicy = .always
            config.httpShouldSetCookies = true
            // A report is a ~1 minute call and the writing phase alone can run
            // 70s. The default 60s request timeout would cut off healthy
            // searches, so the ceiling is the resource timeout instead.
            config.timeoutIntervalForRequest = 120
            config.timeoutIntervalForResource = 300
            config.waitsForConnectivity = true
            self.session = URLSession(configuration: config)
        }
    }

    // MARK: - Account

    public func me() async throws -> Account? {
        do {
            return try await getJSON(Account.self, path: "/api/account/me")
        } catch let e as APIError where e.status == 401 {
            return nil   // signed out is an answer, not a failure
        }
    }

    public func logIn(email: String, password: String) async throws -> Account {
        try await postJSON(Account.self, path: "/api/account/login",
                           body: ["email": email, "password": password])
    }

    public func signUp(email: String, password: String, name: String?) async throws -> Account {
        var body: [String: Any] = ["email": email, "password": password]
        if let name, !name.isEmpty { body["name"] = name }
        return try await postJSON(Account.self, path: "/api/account/signup", body: body)
    }

    public func logOut() async throws {
        _ = try? await postRaw(path: "/api/account/logout", body: [:])
        // Belt and braces: dropping the cookie locally means a failed logout
        // request still signs this device out.
        clearSessionCookie()
    }

    /// Delete the account and everything the server holds for it.
    ///
    /// Required by App Store guideline 5.1.1(v): any app that lets a person
    /// create an account must let them delete it from inside the app. Not a
    /// link to a web page, not an email to support — this call.
    ///
    /// The server cascades to sessions, saved properties and the watchlist,
    /// and clears the session cookie on its way out. The local cookie is
    /// dropped too, so a failure to parse the response still leaves this
    /// device signed out.
    public func deleteAccount() async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/account"))
        req.httpMethod = "DELETE"
        req.setValue("application/json", forHTTPHeaderField: "accept")
        defer { clearSessionCookie() }
        _ = try await send(req)
    }

    private func clearSessionCookie() {
        guard let cookies = session.configuration.httpCookieStorage?.cookies(for: baseURL) else { return }
        for c in cookies where c.name == "cn_session" {
            session.configuration.httpCookieStorage?.deleteCookie(c)
        }
    }

    // MARK: - Reports

    /// Run a report, streaming progress. Returns the final report.
    ///
    /// The server answers plain JSON for everything fast or failed — cache
    /// hits, auth, rate limits — even when the body asked to stream, so which
    /// reader runs is decided by the RESPONSE's content-type, never by the
    /// fact that we asked.
    public func runReport(_ request: SearchRequest,
                          onUpdate: @escaping @Sendable (ProgressEvent) -> Void = { _ in })
    async throws -> Report {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/comps"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")
        req.httpBody = try JSONSerialization.data(withJSONObject: request.body(stream: true))

        let (bytes, response) = try await session.bytes(for: req)
        let http = response as! HTTPURLResponse
        guard (200..<300).contains(http.statusCode) else {
            throw try await Self.error(from: bytes, status: http.statusCode)
        }

        let contentType = (http.value(forHTTPHeaderField: "content-type") ?? "").lowercased()
        guard contentType.contains("text/event-stream") else {
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            return try Self.decode(Report.self, from: data)
        }

        var parser = SSEParser()
        var report: Report?
        for try await chunk in bytes.chunked() {
            for event in parser.consume(chunk) {
                switch event {
                case .progress(let p):
                    onUpdate(p)
                case .result(let data):
                    report = try Self.decode(Report.self, from: data)
                case .failure(let message):
                    throw APIError(status: 200, message: message)
                }
            }
        }
        if let report { return report }
        if case .failure(let message)? = parser.finish(sawResult: false) {
            throw APIError(status: 200, message: message)
        }
        throw APIError(status: 200, message: "The search did not finish. Please try again.")
    }

    // MARK: - Broker pipeline

    /// This visitor's entitlements. The app asks one question of it: whether
    /// to show the pipeline at all.
    ///
    /// Presentation only, exactly as on the web. Every one of these limits is
    /// enforced server-side, so a client that lied to itself about `broker`
    /// would reach `requireBroker` and be refused with a 403 anyway.
    public func config() async throws -> AppConfig {
        try await getJSON(AppConfig.self, path: "/api/config")
    }

    /// BOV enquiries matching the broker's coverage, plus the coverage itself.
    ///
    /// Refuses in three ways and they mean different things: 401 not signed
    /// in, 403 signed in but not a broker, 503 the database is unreachable.
    /// The 503 matters — the server deliberately refuses rather than answering
    /// with an empty list, because an empty inbox reads as "no demand in my
    /// markets", which is a far more damaging wrong answer than an error.
    /// Never turn that 503 into an empty state here.
    public func brokerLeads() async throws -> LeadInbox {
        try await getJSON(LeadInbox.self, path: "/api/broker/leads")
    }

    /// Raise a hand for one lead.
    ///
    /// Owner-mediated by design: this emails the owner naming the broker. It
    /// never sends the broker anything about the person who enquired, and it
    /// never contacts that person. Returns true when this was a NEW request,
    /// false when the server had already recorded one, so the UI can say
    /// "already asked" rather than implying a second email went out.
    @discardableResult
    public func requestIntro(leadID: String) async throws -> Bool {
        struct Answer: Decodable { var ok: Bool?; var already: Bool? }
        let a = try await postJSON(Answer.self, path: "/api/broker/leads/intro",
                                   body: ["lead_id": leadID])
        return !(a.already ?? false)
    }

    /// The broker's own BOV log, with the counts under it.
    public func brokerBOVs() async throws -> BOVLog {
        try await getJSON(BOVLog.self, path: "/api/broker/bovs")
    }

    /// Change a BOV's status, its notes, or both.
    ///
    /// Both arguments are optional because the server treats an absent key as
    /// "leave it alone" and refuses a call that would change nothing. Passing
    /// notes as an empty string is a real edit that clears them; passing nil
    /// leaves whatever is stored.
    public func updateBOV(id: String, status: BOVStatus? = nil, notes: String? = nil) async throws {
        var body: [String: Any] = ["id": id]
        if let status { body["status"] = status.rawValue }
        if let notes { body["notes"] = notes }
        guard body.count > 1 else { return }
        _ = try await postRaw(path: "/api/broker/bovs/update", body: body)
    }

    // MARK: - The vault

    /// The broker's whole book, plus their credit identity and firm.
    ///
    /// Fetched WHOLE and filtered on the device, which is the web's rule and
    /// holds for its reasons: the counts describe the entire book, so a
    /// server-side filter would leave the screen unable to say how much it is
    /// not showing, and a search box that re-queries per keystroke is a
    /// request per keystroke.
    ///
    /// The route defaults to 200 and caps at 1000. Asking for the cap is
    /// deliberate — at the default a broker with 400 comps is shown half their
    /// vault with nothing saying so.
    public func vault(limit: Int = 1000) async throws -> VaultPayload {
        try await getJSON(VaultPayload.self, path: "/api/vault",
                          query: ["limit": String(limit)])
    }

    /// Add one comp by hand. A broker who closed a deal on Tuesday should not
    /// have to author a spreadsheet.
    ///
    /// The server reruns the row through the same `normalizeRow` every
    /// imported comp goes through, so "1.2M" or an Excel serial date is
    /// refused here exactly as it would be on an import. The refusal text is
    /// the server's own and is shown verbatim.
    public func addVaultComp(_ fields: [String: Any]) async throws {
        _ = try await write(method: "POST", path: "/api/vault/comp", body: fields)
    }

    /// Correct one stored comp.
    ///
    /// `EDITABLE_FIELDS` on the server is an allowlist, and the patch is
    /// merged over the stored row and revalidated whole — so a partial edit
    /// cannot sidestep a rule that a full write would fail.
    public func updateVaultComp(id: String, fields: [String: Any]) async throws {
        _ = try await write(method: "PATCH", path: "/api/vault/comp",
                            query: ["id": id], body: fields)
    }

    /// Public benchmarks for the broker's own bucket list.
    ///
    /// Sends only market and property-type PAIRS, never comps. That is the
    /// whole privacy shape of this feature: the endpoint reads no vault rows
    /// and receives none, so it cannot leak a private comp even in principle,
    /// and the verdict is computed on the device by `GutCheck`. Do not "just
    /// send the comps up" to simplify something later.
    ///
    /// The server caps at 50 buckets — a broker's own bucket list, not a scan
    /// surface — so this sends at most that many.
    public func vaultBenchmarks(buckets: [(market: String, type: String)])
    async throws -> [GutCheck.Benchmark] {
        let asked = buckets.prefix(50).map { ["market": $0.market, "type": $0.type] }
        let answer = try await postJSON(GutCheck.BenchmarkResponse.self,
                                        path: "/api/vault/benchmarks",
                                        body: ["buckets": Array(asked)])
        return answer.buckets
    }

    public func deleteVaultComp(id: String) async throws {
        _ = try await write(method: "DELETE", path: "/api/vault/comp", query: ["id": id])
    }

    // MARK: - Plumbing

    /// Build a URL for a path plus optional query items.
    ///
    /// NOT `appendingPathComponent`, which percent-encodes a `?` into `%3F`
    /// and turns `/api/vault/comp?id=x` into a path no route matches. Every
    /// vault write is addressed by a query parameter, so this is the only
    /// correct way to reach them.
    private func url(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: baseURL.appendingPathComponent(path),
                                       resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            // Sorted so a URL is stable across runs, which makes a failing
            // request reproducible from a log line.
            components.queryItems = query.sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url!
    }

    private func getJSON<T: Decodable>(_ type: T.Type, path: String,
                                       query: [String: String] = [:]) async throws -> T {
        var req = URLRequest(url: url(path, query: query))
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "accept")
        return try Self.decode(type, from: try await send(req))
    }

    private func postJSON<T: Decodable>(_ type: T.Type, path: String, body: [String: Any]) async throws -> T {
        try Self.decode(type, from: try await postRaw(path: path, body: body))
    }

    private func postRaw(path: String, body: [String: Any]) async throws -> Data {
        try await write(method: "POST", path: path, body: body)
    }

    /// POST, PATCH and DELETE share one shape: a JSON body, optional query,
    /// and the session cookie the URLSession store carries.
    @discardableResult
    private func write(method: String, path: String,
                       query: [String: String] = [:],
                       body: [String: Any]? = nil) async throws -> Data {
        var req = URLRequest(url: url(path, query: query))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try await send(req)
    }

    private func send(_ req: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: req)
        let http = response as! HTTPURLResponse
        guard (200..<300).contains(http.statusCode) else {
            throw Self.error(from: data, status: http.statusCode)
        }
        return data
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIError(status: 200, message: "The server sent something this version of the app could not read.")
        }
    }

    /// Errors carry the SERVER's sentence wherever there is one. The product's
    /// error copy is written once, server-side, and both clients say it.
    static func error(from data: Data, status: Int) -> APIError {
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let message = obj["error"] as? String ?? Self.fallbackMessage(status)
        return APIError(status: status,
                        message: message,
                        signInRequired: obj["signin_required"] as? Bool ?? false)
    }

    static func error(from bytes: URLSession.AsyncBytes, status: Int) async throws -> APIError {
        var data = Data()
        for try await byte in bytes { data.append(byte) }
        return error(from: data, status: status)
    }

    static func fallbackMessage(_ status: Int) -> String {
        switch status {
        case 401: return "Please sign in."
        case 429: return "Too many searches from this connection. Please wait a few minutes and try again."
        case 500...599: return "CompNinja is having trouble right now. Please try again in a moment."
        default: return "Request failed (\(status))."
        }
    }
}

extension URLSession.AsyncBytes {
    /// `AsyncBytes` yields one byte at a time; the SSE parser wants blocks.
    /// Bytes are gathered until a frame boundary shows up so the parser is
    /// handed something worth scanning rather than 60,000 single-byte calls.
    func chunked(max: Int = 4096) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            Task {
                var buffer = Data()
                var lastWasNewline = false
                do {
                    for try await byte in self {
                        buffer.append(byte)
                        if byte == 0x0A && lastWasNewline {
                            continuation.yield(buffer)
                            buffer.removeAll(keepingCapacity: true)
                        } else if buffer.count >= max {
                            continuation.yield(buffer)
                            buffer.removeAll(keepingCapacity: true)
                        }
                        lastWasNewline = (byte == 0x0A)
                    }
                    if !buffer.isEmpty { continuation.yield(buffer) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
}
