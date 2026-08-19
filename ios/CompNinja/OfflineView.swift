import UIKit

/// What the app shows when the network is unreachable.
///
/// This exists as native views rather than as a bundled HTML file for one
/// reason: it has to render when the web view is the thing that just failed.
/// It is also the single most commonly cited cause of a Guideline 4.2
/// rejection -- a wrapper that shows a blank white screen with no connection
/// reads to a reviewer as an unfinished website rather than an app.
///
/// The web app has its own offline page (offline.html, served by the service
/// worker) for the same job in a browser. Both exist; neither can cover the
/// other's case.
final class OfflineView: UIView {
    private let retry: () -> Void

    init(retry: @escaping () -> Void) {
        self.retry = retry
        super.init(frame: .zero)
        backgroundColor = .systemBackground
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    private func build() {
        let mark = UIImageView(image: UIImage(named: "OfflineMark"))
        mark.contentMode = .scaleAspectFit
        mark.setContentHuggingPriority(.required, for: .vertical)

        let title = UILabel()
        title.text = "You're offline"
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center

        let body = UILabel()
        body.text = "CompNinja pulls live comps from public records and listings, so it needs a connection to run a report."
        body.font = .preferredFont(forTextStyle: .body)
        body.adjustsFontForContentSizeCategory = true
        body.textColor = .secondaryLabel
        body.numberOfLines = 0
        body.textAlignment = .center

        var config = UIButton.Configuration.filled()
        config.title = "Try again"
        config.baseBackgroundColor = .label
        config.baseForegroundColor = .systemBackground
        config.cornerStyle = .medium
        let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in
            self?.retry()
        })

        let stack = UIStackView(arrangedSubviews: [mark, title, body, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(24, after: body)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -32),
            mark.heightAnchor.constraint(equalToConstant: 52),
        ])
    }
}
