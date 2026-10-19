import SwiftUI
import WebKit
import UIKit

struct ContentView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "exportPlist")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.957, green: 0.965, blue: 0.984, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        context.coordinator.webView = webView

        if let pageURL = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(pageURL, allowingReadAccessTo: Bundle.main.bundleURL)
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.name == "exportPlist",
                let payload = message.body as? [String: String],
                let content = payload["content"],
                let requestedName = payload["filename"]
            else { return }

            let safeName = URL(fileURLWithPath: requestedName).lastPathComponent
            guard safeName.lowercased().hasSuffix(".plist") else { return }

            let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
            do {
                try Data(content.utf8).write(to: fileURL, options: .atomic)
                presentShareSheet(for: fileURL)
            } catch {
                assertionFailure("Could not prepare plist export: \(error)")
            }
        }

        private func presentShareSheet(for fileURL: URL) {
            guard let webView, let presenter = topViewController(from: webView) else { return }
            let sheet = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = webView
                popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
            }
            sheet.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: fileURL)
            }
            presenter.present(sheet, animated: true)
        }

        private func topViewController(from view: UIView) -> UIViewController? {
            var controller = view.window?.rootViewController
            while let presented = controller?.presentedViewController {
                controller = presented
            }
            return controller
        }
    }
}
