# Antigravity Quota Quickcheck - AI Source Instructions

This document provides AI agents and developers with context about the architecture, module responsibilities, and workflows in the `antigravity-quota-quickcheck` codebase.

## 🎯 Project Overview
A Visual Studio Code extension built in TypeScript that securely fetches and displays the user's real-time Antigravity model quota. It uses native VS Code UI components (Status Bar Items and QuickPick popups) for seamless IDE integration, while maintaining zero external dependencies.

## 📁 Repository Structure

- `src/extension.ts`: The UI and lifecycle entry point. Handles extension activation, registers the status bar icon (`$(credit-card)`), and displays the `QuickPick` popup with real-time data fetched from the telemetry service.
- `src/telemetry.ts`: The data acquisition module. Contains the complex logic required to securely discover, authenticate, and query the local Antigravity Language Server for live model quotas.
- `package.json`: Contains the VS Code extension manifest (activation events, commands, publisher). Points to the custom `icon.png` logo.
- `out/`: Contains the compiled JavaScript output (ignored in version control).
- `assets/icons/`: Contains the custom branding (e.g., `logo.png`).

## 🧩 Key Workflows

### 1. Extension Activation
- **Trigger**: The extension is activated implicitly via `onStartupFinished`.
- **Flow**: VS Code invokes `activate(context)` in `src/extension.ts`. It registers a status bar item displaying `$(credit-card) Antigravity Quota` and the command to trigger the popup.

### 2. Telemetry Acquisition (The "Magic")
Because the main Antigravity extension doesn't expose a public API, `src/telemetry.ts` uses the following workflow to get real data:
1. **Process Discovery**: Scans OS processes (via `powershell` or `ps`) to find the hidden `language_server` background process.
2. **Token Extraction**: Parses the process's command-line arguments to extract a secure `--csrf-token`.
3. **Port Scanning**: Uses OS network tools (`Get-NetTCPConnection`, `ss`, or `lsof`) to discover which random local port the language server is listening on.
4. **API Query**: Sends an `http` (not https) POST request to `127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus` using the CSRF token.
5. **Parsing**: Normalizes the response (`remainingFraction` and `resetTime`) into a clean `QuotaData` array.

### 3. Quota Popup Display
- When the user clicks the status bar item, `showQuotaPopup()` is called.
- It `awaits fetchRealQuota()`. If successful, it creates text-based progress bars (`█` and `░`) and displays them in a native `QuickPick` dropdown.
- If the language server isn't running or fails, it catches the error and displays a graceful `vscode.window.showErrorMessage`.

## 🤖 AI Guidelines
- **UI Strictness**: Strictly use native VS Code components (QuickPick, InformationMessages) to create popup experiences. Do NOT use Webview Panels.
- **Zero Dependencies**: Keep the extension perfectly lean. All network and OS calls must use built-in Node.js modules (`http`, `child_process`, `os`).
- **Security & Portability**: The telemetry logic involves raw shell commands. When modifying `src/telemetry.ts`, ensure commands work across Windows (`powershell`), Mac (`lsof`), and Linux (`ss`).
- **Error Handling**: Network requests to local servers can be flaky. Always wrap fetches in `try/catch` and provide user-facing error messages instead of silent failures.
