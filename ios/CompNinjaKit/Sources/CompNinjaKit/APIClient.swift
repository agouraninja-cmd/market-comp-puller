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

    // MARK: - Plumbing

    private func getJSON<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "accept")
        return try Self.decode(type, from: try await send(req))
    }

    private func postJSON<T: Decodable>(_ type: T.Type, path: String, body: [String: Any]) async throws -> T {
        try Self.decode(type, from: try await postRaw(path: path, body: body))
    }

    private func postRaw(path: String, body: [String: Any]) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
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
