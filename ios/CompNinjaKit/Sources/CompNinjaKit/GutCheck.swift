import Foundation

// The gut check: a broker's private numbers against the public market layer.
//
// ⚠ THIS IS A SECOND COPY OF `gut-check.js`'s CLIENT HALF. Keep the two in
// step, the way `compWeight` is kept in step between server.js and index.html.
// The rules ported here are `bandOf`, `verdictFor` and `gutCheck`; the file's
// other half (`corpusStats`, `normAddressKey`, `dedupeByBuilding`) runs
// SERVER-side inside `POST /api/vault/benchmarks` and is deliberately absent.
//
// Why a copy rather than asking the server for the verdict: the web computes
// this in the browser on purpose. `/api/vault/benchmarks` takes only bucket
// KEYS — market and property type — and reads no vault rows, so "the broker's
// numbers stay in their browser" and that endpoint cannot leak a private comp
// even in principle. Moving the verdict server-side would mean sending the
// comps up, which trades a real privacy property for a duplication one. The
// duplication is the cheaper cost, and `GutCheckParityTests` pins this port
// against the same cases the JS suite uses.
//
// Honesty is part of the contract, not the UI's problem alone: a verdict
// carries its counts and both benchmark halves so a panel CAN label every
// number with its provenance. A divergence is a flashlight, never a grade —
// the broker's private comps may well be the better data.
public enum GutCheck {

    // The corpus half of a band needs the same coverage `corpusIsStrong()`
    // trusts; a cap-rate median under 3 values is an anecdote; one cap comp is
    // not a practice pattern; and 25% is wide on purpose, so an outlier flag
    // is explainable ("40% above the market band") rather than a statistical
    // test.
    public static let minCorpusPpsf = 4
    public static let minCorpusCap = 3
    public static let minBrokerCap = 2
    /// ⚠ Same product rule as `valuation.js`'s `OUTLIER_PCT` and the report
    /// table's screen-only outlier chips. Change them together.
    public static let outlierPct = 0.25

    // MARK: - Inputs

    /// The corpus half of a benchmark, as `corpusStats` computes it server-side.
    public struct Corpus: Decodable, Sendable, Equatable {
        public var count: Int = 0
        public var q1Ppsf: Double?
        public var q3Ppsf: Double?
        public var capRateMedian: Double?

        enum CodingKeys: String, CodingKey {
            case count
            case q1Ppsf = "q1_ppsf"
            case q3Ppsf = "q3_ppsf"
            case capRateMedian = "cap_rate_median"
        }

        public init(count: Int = 0, q1Ppsf: Double? = nil,
                    q3Ppsf: Double? = nil, capRateMedian: Double? = nil) {
            self.count = count; self.q1Ppsf = q1Ppsf
            self.q3Ppsf = q3Ppsf; self.capRateMedian = capRateMedian
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            count = (try? c.decode(Int.self, forKey: .count)) ?? 0
            q1Ppsf = num(try? c.decode(LooseString.self, forKey: .q1Ppsf))
            q3Ppsf = num(try? c.decode(LooseString.self, forKey: .q3Ppsf))
            capRateMedian = num(try? c.decode(LooseString.self, forKey: .capRateMedian))
        }
    }

    /// The model half: the market page's own published figures.
    public struct Snapshot: Decodable, Sendable, Equatable {
        public struct Band: Decodable, Sendable, Equatable {
            public var low: Double?
            public var high: Double?
            public init(low: Double? = nil, high: Double? = nil) {
                self.low = low; self.high = high
            }
            enum CodingKeys: String, CodingKey { case low, high }
            public init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                low = num(try? c.decode(LooseString.self, forKey: .low))
                high = num(try? c.decode(LooseString.self, forKey: .high))
            }
        }

        public var ppsf: Band?
        public var capRateLow: Double?
        public var capRateHigh: Double?

        enum CodingKeys: String, CodingKey {
            case ppsf
            case capRateLow = "cap_rate_low"
            case capRateHigh = "cap_rate_high"
        }

        public init(ppsf: Band? = nil, capRateLow: Double? = nil, capRateHigh: Double? = nil) {
            self.ppsf = ppsf; self.capRateLow = capRateLow; self.capRateHigh = capRateHigh
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            ppsf = try? c.decodeIfPresent(Band.self, forKey: .ppsf)
            capRateLow = num(try? c.decode(LooseString.self, forKey: .capRateLow))
            capRateHigh = num(try? c.decode(LooseString.self, forKey: .capRateHigh))
        }
    }

    /// One bucket of `POST /api/vault/benchmarks`.
    public struct Benchmark: Decodable, Sendable, Equatable {
        public var market: String = ""
        public var type: String = ""
        public var corpus: Corpus?
        public var snapshot: Snapshot?

        enum CodingKeys: String, CodingKey { case market, type, corpus, snapshot }

        public init(market: String, type: String,
                    corpus: Corpus? = nil, snapshot: Snapshot? = nil) {
            self.market = market; self.type = type
            self.corpus = corpus; self.snapshot = snapshot
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            market = (try? c.decode(String.self, forKey: .market)) ?? ""
            type = (try? c.decode(String.self, forKey: .type)) ?? ""
            corpus = try? c.decodeIfPresent(Corpus.self, forKey: .corpus)
            snapshot = try? c.decodeIfPresent(Snapshot.self, forKey: .snapshot)
        }
    }

    public struct BenchmarkResponse: Decodable, Sendable {
        public var buckets: [Benchmark] = []
        enum CodingKeys: String, CodingKey { case buckets }
        public init() {}
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            buckets = (try? c.decode([Benchmark].self, forKey: .buckets)) ?? []
        }
    }

    // MARK: - Outputs

    public enum Verdict: String, Sendable {
        case inLine = "in_line"
        case above
        case below
        case noData = "no_data"
    }

    public struct Band: Sendable, Equatable {
        public let low: Double
        public let high: Double
    }

    public struct CapCheck: Sendable, Equatable {
        public let verdict: Verdict
        public let deltaPct: Int?
        public let median: Double
        public let count: Int
        public let low: Double
        public let high: Double
        public let corpusMedian: Double?
    }

    public struct Outlier: Sendable, Equatable {
        public let direction: String   // "above" | "below"
        public let pct: Int
    }

    public struct BucketResult: Identifiable, Sendable, Equatable {
        public let market: String
        public let type: String
        public let compCount: Int
        public let pricedSales: Int
        public let medianPpsf: Double?
        public let capCount: Int
        public let corpus: Corpus?
        public let snapshot: Snapshot?
        public let band: Band?
        public let verdict: Verdict
        public let deltaPct: Int?
        public let cap: CapCheck?
        public let outlierIDs: [String]

        public var id: String { market + "|" + type }
    }

    public struct Result: Sendable {
        public let buckets: [BucketResult]
        public let outliers: [String: Outlier]
    }

    // MARK: - The rules

    public static func bucketKey(_ market: String, _ type: String) -> String {
        market + "|" + type
    }

    /// The market band a verdict runs against: the UNION of every half that
    /// clears its floor. Union, not intersection — two honest sources that
    /// disagree should widen what "in line" means, never narrow it.
    static func bandOf(corpus: Corpus?, snapshot: Snapshot?) -> Band? {
        var lows: [Double] = []
        var highs: [Double] = []
        if let corpus, corpus.count >= minCorpusPpsf,
           let q1 = corpus.q1Ppsf, let q3 = corpus.q3Ppsf {
            lows.append(q1); highs.append(q3)
        }
        if let sp = snapshot?.ppsf, let low = sp.low, let high = sp.high {
            lows.append(low); highs.append(high)
        }
        guard let low = lows.min(), let high = highs.max() else { return nil }
        return Band(low: low, high: high)
    }

    /// Delta is a percentage from the NEAREST band edge, signed: +25 means 25%
    /// above the top, -25 means 25% below the bottom.
    ///
    /// A value can sit outside the band by less than half a rounding point
    /// (0.4% over the top, say). Rounding that to 0 while still calling it
    /// "above" would render the contradiction "above · 0%", so a delta that
    /// rounds to zero is reported as in_line instead.
    static func verdictFor(_ value: Double?, _ band: Band?) -> (Verdict, Int?) {
        guard let value, let band, band.high >= band.low else { return (.noData, nil) }
        if value > band.high {
            let d = Int((((value - band.high) / band.high) * 100).rounded())
            return d == 0 ? (.inLine, nil) : (.above, d)
        }
        if value < band.low {
            let d = -Int((((band.low - value) / band.low) * 100).rounded())
            return d == 0 ? (.inLine, nil) : (.below, d)
        }
        return (.inLine, nil)
    }

    /// Vault comps plus benchmark buckets, in; per-bucket verdicts and outlier
    /// flags, out.
    ///
    /// Reads the STORED `price_per_sqft` only — sales-only by construction,
    /// since the vault leaves it null on leases — and never derives one.
    public static func run(comps: [VaultComp], benchmarks: [Benchmark]) -> Result {
        var bench: [String: Benchmark] = [:]
        for b in benchmarks { bench[bucketKey(b.market, b.type)] = b }

        // Insertion order preserved, matching the JS, so two runs over the
        // same book produce the same list before sorting.
        var by: [String: [VaultComp]] = [:]
        var order: [String] = []
        for c in comps {
            let k = bucketKey(c.market, c.propertyType)
            if by[k] == nil { by[k] = []; order.append(k) }
            by[k]?.append(c)
        }

        var buckets: [BucketResult] = []
        var outliers: [String: Outlier] = [:]

        for k in order {
            guard let list = by[k], let first = list.first else { continue }

            let sales = list.filter { c in
                guard isSale(c.transaction), let p = num(c.pricePerSqft) else { return false }
                return p > 0
            }
            // Nothing to check in this bucket. Skipped entirely rather than
            // reported as no_data, matching the JS.
            if sales.isEmpty { continue }

            let b = bench[k]
            let corpus = b?.corpus
            let snapshot = b?.snapshot
            let band = bandOf(corpus: corpus, snapshot: snapshot)
            let med = round2(median(sales.compactMap { num($0.pricePerSqft) }))
            let (verdict, delta) = verdictFor(med, band)

            // Cap rates need a RANGE, and only the snapshot has one; the
            // corpus median is a point and rides along as a supporting figure.
            // SALE comps only (a lease's cap rate is a different instrument)
            // but deliberately NOT priced-sales-only: brokers track
            // undisclosed-price deals, and a sale with no entered price can
            // still carry a real cap rate.
            let capVals = list
                .filter { isSale($0.transaction) }
                .compactMap { num($0.capRate) }
                .filter(capOk)
            var cap: CapCheck?
            if capVals.count >= minBrokerCap,
               let capLow = snapshot?.capRateLow, let capHigh = snapshot?.capRateHigh,
               capHigh >= capLow, let cm = round2(median(capVals)) {
                let (cv, cd) = verdictFor(cm, Band(low: capLow, high: capHigh))
                cap = CapCheck(verdict: cv, deltaPct: cd, median: cm, count: capVals.count,
                               low: capLow, high: capHigh,
                               corpusMedian: corpus?.capRateMedian)
            }

            // Outliers only fire when the bucket verdict has real data behind
            // it: no benchmark, no flags.
            var outlierIDs: [String] = []
            if verdict != .noData, let band {
                for c in sales {
                    guard let p = num(c.pricePerSqft) else { continue }
                    if p > band.high * (1 + outlierPct) {
                        outlierIDs.append(c.id)
                        outliers[c.id] = Outlier(
                            direction: "above",
                            pct: Int((((p - band.high) / band.high) * 100).rounded()))
                    } else if p < band.low * (1 - outlierPct) {
                        outlierIDs.append(c.id)
                        outliers[c.id] = Outlier(
                            direction: "below",
                            pct: Int((((band.low - p) / band.low) * 100).rounded()))
                    }
                }
            }

            buckets.append(BucketResult(
                market: first.market, type: first.propertyType,
                compCount: list.count, pricedSales: sales.count,
                medianPpsf: med, capCount: capVals.count,
                corpus: corpus, snapshot: snapshot, band: band,
                verdict: verdict, deltaPct: delta, cap: cap,
                outlierIDs: outlierIDs))
        }

        buckets.sort { $0.pricedSales > $1.pricedSales }
        return Result(buckets: buckets, outliers: outliers)
    }

    // MARK: - Helpers, ported exactly

    /// Extracts the FIRST number from a string ("$1,234,567" -> 1234567),
    /// which means an ambiguous "100-200" yields 100 rather than a refusal.
    ///
    /// A deliberate divergence from the report side's `displayMoney`, which
    /// refuses ambiguity: that protects one number a customer reads, while
    /// this feeds aggregates over many rows, where refusing a
    /// parseable-enough value starves the benchmark and a rare misread is
    /// damped by the median.
    static func num(_ v: LooseString?) -> Double? {
        guard let s = v?.value, !s.isEmpty else { return nil }
        return firstNumber(in: s)
    }

    static func firstNumber(in raw: String) -> Double? {
        let s = raw.replacingOccurrences(of: ",", with: "")
        var digits = ""
        var started = false
        var seenDot = false
        var index = s.startIndex
        while index < s.endIndex {
            let ch = s[index]
            if !started, ch == "-", s.index(after: index) < s.endIndex,
               s[s.index(after: index)].isNumber {
                digits.append(ch); started = true
            } else if ch.isNumber {
                digits.append(ch); started = true
            } else if started, ch == ".", !seenDot,
                      s.index(after: index) < s.endIndex,
                      s[s.index(after: index)].isNumber {
                digits.append(ch); seenDot = true
            } else if started {
                break
            }
            index = s.index(after: index)
        }
        guard let n = Double(digits), n.isFinite else { return nil }
        return n
    }

    /// A plausible going-in cap rate, in percent. Outside (0, 25) is a typo or
    /// a different unit, not a market signal. One predicate for BOTH the
    /// corpus aggregate and the broker side, so the two cannot drift.
    static func capOk(_ v: Double) -> Bool { v > 0 && v < 25 }

    /// NOT `VaultComp.isLease`, which asks whether the word appears anywhere.
    /// This is `gut-check.js`'s own predicate: anything not STARTING with
    /// "lease" is a sale, so an empty transaction counts as a sale. The two
    /// agree on real stored data — `broker-vault.js` normalises transaction to
    /// exactly "sale" or "lease" — and this one is kept literal so the port
    /// stays faithful rather than nearly faithful.
    static func isSale(_ t: String) -> Bool {
        !t.lowercased().hasPrefix("lease")
    }

    static func median(_ xs: [Double]) -> Double? {
        guard !xs.isEmpty else { return nil }
        let s = xs.sorted()
        let h = s.count / 2
        return s.count % 2 == 1 ? s[h] : (s[h - 1] + s[h]) / 2
    }

    static func round2(_ v: Double?) -> Double? {
        guard let v else { return nil }
        return (v * 100).rounded() / 100
    }
}
