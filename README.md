# IPCC 配置工作台

一个完全在本地运行的 plist 配置编辑器，并附带一个可由 Xcode 打开的 iOS 工程。它是基于对 LockIPCC 功能流程的理解而重新实现的独立小工具，不包含原程序代码。这个版本没有激活校验，始终可用；页面明确标注“无需激活”。

## 文件

- `index.html`：页面结构和所有界面文案。
- `styles.css`：布局、颜色、响应式样式。
- `app.js`：XML plist 读取、字段编辑、差异比较与副本导出。
- `sample-carrier.plist`：不对应真实运营商的演示配置，可用于试用。
- `ios/CarrierStudio.xcodeproj`：iOS 工程入口。
- `ios/CarrierStudioApp.swift`、`ios/ContentView.swift`：SwiftUI 启动入口和内嵌网页界面；导出 plist 时会调用 iOS 分享菜单。
- `.github/workflows/build-ios-ipa.yml`：GitHub Actions macOS runner 的手动签名构建流程。

## 运行

最简单的方式：在文件管理器中打开这个文件夹，双击 `index.html`，用 Edge 或 Chrome 预览。也可以在 PowerShell 中执行：

```powershell
Start-Process "C:\Users\TW\Documents\Codex\2026-10-18\rea\outputs\LockIPCCWorkbench\index.html"
```

若浏览器不允许从本地文件打开，可用 Codex 自带 Python 启动临时本机服务器：

```powershell
& "C:\Users\TW\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 4173 --directory "C:\Users\TW\Documents\Codex\2026-10-18\rea\outputs\LockIPCCWorkbench"
```

再打开 <http://localhost:4173>；停止服务时回到 PowerShell 按 `Ctrl+C`。

## 在 iPhone 上运行

需要一台 Mac 安装 Xcode。双击 `ios/CarrierStudio.xcodeproj` 打开工程，在 Xcode 的 Signing & Capabilities 中选你的 Team、把 Bundle Identifier 改成唯一值，然后连接自己的 iPhone 并按 Run。要导出 IPA，在 Xcode 中选择 Product → Archive，再按向导选择适用于你设备的签名与导出方式。Windows 不能运行 Xcode，因此本工作区未产出签名 IPA；能否安装取决于你的 Apple 签名和设备配置。

## 试用

点“打开演示配置”，修改 CarrierName 或 APN，点“预览修改差异”，然后点“导出修改后的 plist”。也可以导入自己的 XML `.plist` 文件。

## 当前范围

- 支持以字典为根的 XML Property List（`.plist` / `.xml`），支持常见 dict、array、string、integer、real、true、false、date、data 节点。
- date 和 data 可查看但不会被编辑；未知 plist 类型、二进制 plist 与 `.ipcc` 压缩包暂不支持。
- 文件只在浏览器当前页面内处理，不会上传或连接设备。
- 导出只生成 XML plist 副本，不向 iPhone 写入、安装或修改系统配置，也不模拟原程序中的特权操作。
- 页面只使用系统字体，不请求外部字体或其他网络资源。
