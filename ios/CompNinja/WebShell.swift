import SwiftUI
import WebKit
import SafariServices

struct WebShellView: UIViewControllerRepresentable {
    let vaultLock: VaultLock

    func makeUIViewController(context: Context) -> WebShellController {
        WebShellController(vaultLock: vaultLock)
    }

    func updateUIViewController(_ controller: WebShellController, context: Context) {}
}

/// The app: one WKWebView onto compninja.co, plus the native layer around it.
final class WebShellController: UIViewController {
    private let vaultLock: VaultLock
    private var webView: WKWebView!
    private let refreshControl = UIRefreshControl()
    private lazy var offlineView = OfflineView { [weak self] in self?.reload() }

    init(vaultLock: VaultLock) {
        self.vaultLock = vaultLock
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: - Setup

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        // The DEFAULT (persistent) data store, not a non-persistent one: the
        // session lives in the `cn_session` cookie, and an ephemeral store
        // would sign the broker out every single launch.
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        // The share bridge. The web app calls this when it has something worth
        // handing to the system share sheet; a plain browser simply has no
        // such handler and falls back to its own copy-link affordance.
        config.userContentController.add(self, name: "share")
        // Appended to the standard UA rather than replacing it, so the server
        // still sees a complete, truthful Safari user agent and merely gains a
        // way to tell that a request came from the app.
        config.applicationNameForUserAgent = "CompNinja-iOS/1.0"

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        webView.scrollView.refreshControl = refreshControl
        refreshControl.addTarget(self, action: #selector(pulledToRefresh), for: .valueChanged)

        add(webView, pinnedTo: view.safeAreaLayoutGuide)
        add(offlineView, pinnedTo: view.safeAreaLayoutGuide)
        offlineView.isHidden = true

        NotificationCenter.default.addObserver(
            self, selector: #selector(handleDeepLink(_:)),
            name: .openCompNinjaURL, object: nil
        )

        load(CompNinjaApp.origin)
    }

    private func add(_ child: UIView, pinnedTo guide: UILayoutGuide) {
        child.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(child)
        NSLayoutConstraint.activate([
            child.topAnchor.constraint(equalTo: guide.topAnchor),
            child.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            child.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            child.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
        ])
    }

    // MARK: - Navigation

    private func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    private func reload() {
        if webView.url == nil { load(CompNinjaApp.origin) } else { webView.reload() }
    }

    @objc private func pulledToRefresh() {
        webView.reload()
    }

    @objc private func handleDeepLink(_ note: Notification) {
        guard let url = note.object as? URL, isOurs(url) else { return }
        load(url)
    }

    private func isOurs(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "compninja.co" || host == "www.compninja.co"
    }

    /// Anything not on our own origin is handed to the system rather than
    /// rendered inside the app. Two different reasons, and both matter:
    ///
    ///   - Payments. Subscribing happens at Stripe's own checkout, and on the
    ///     US storefront an app is allowed to link out to it (Guideline
    ///     3.1.1(a), as amended May 2025). Opening it in a Safari view keeps
    ///     that unambiguously an EXTERNAL purchase rather than something that
    ///     merely looks like an in-app one, and it gives the buyer the URL bar
    ///     and padlock they expect when typing a card number.
    ///   - Citations. Every comp carries a `source_url` to a county record or
    ///     a listing. Those are other people's sites; rendering them chromeless
    ///     inside CompNinja misrepresents whose page the reader is on.
    private func openExternally(_ url: URL) {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            UIApplication.shared.open(url)   // tel:, mailto:
            return
        }
        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = UIColor(red: 0.72, green: 0.11, blue: 0.11, alpha: 1)
        present(safari, animated: true)
    }

    /// The vault gate. `decidePolicyFor` has to answer synchronously and
    /// authentication cannot, so the navigation is cancelled and re-issued
    /// once the broker has authenticated. Re-issuing rather than resuming is
    /// what keeps this simple enough to be obviously correct.
    private func gateVault(_ url: URL) {
        Task { @MainActor in
            if await vaultLock.authenticate() {
                load(url)
            } else if webView.url == nil {
                load(CompNinjaApp.origin)
            }
        }
    }
}

// MARK: - WKNavigationDelegate

extension WebShellController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if !isOurs(url) {
            decisionHandler(.cancel)
            openExternally(url)
            return
        }

        // Only gate a real navigation the broker initiated; subresource loads
        // and redirects inside the vault must not each raise a Face ID prompt.
        if url.path.hasPrefix("/vault"), navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
            if !vaultLock.isCurrent && vaultLock.enabled {
                decisionHandler(.cancel)
                gateVault(url)
                return
            }
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
        offlineView.isHidden = true
        webView.isHidden = false
    }

    /// The failure App Review looks for. A wrapper that shows a white screen
    /// with no connection is the canonical Guideline 4.2 rejection, so this
    /// path shows a real, branded, retryable view instead -- and only when the
    /// failure was actually the network, since a cancelled navigation (which
    /// is how every external link above exits) is not an error.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        refreshControl.endRefreshing()
        let err = error as NSError
        guard err.domain == NSURLErrorDomain, err.code != NSURLErrorCancelled else { return }
        webView.isHidden = true
        offlineView.isHidden = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        refreshControl.endRefreshing()
    }
}

// MARK: - WKUIDelegate

extension WebShellController: WKUIDelegate {
    /// target="_blank" has no meaning in a single-webview app: returning nil
    /// from here would silently swallow the tap, so those open externally too.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            isOurs(url) ? load(url) : openExternally(url)
        }
        return nil
    }
}

// MARK: - Share bridge

extension WebShellController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "share" else { return }
        // Accepts either a bare URL string or { url, title }. Anything else is
        // ignored rather than guessed at -- this is a bridge into native code
        // and the page on the other side of it is the only caller it should
        // ever have.
        var items: [Any] = []
        if let text = message.body as? String, let url = URL(string: text) {
            items = [url]
        } else if let dict = message.body as? [String: Any] {
            if let title = dict["title"] as? String { items.append(title) }
            if let raw = dict["url"] as? String, let url = URL(string: raw) { items.append(url) }
        }
        guard !items.isEmpty else { return }

        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // Required on iPad, where a popover with no anchor crashes.
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(
            x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0
        )
        present(sheet, animated: true)
    }
}
