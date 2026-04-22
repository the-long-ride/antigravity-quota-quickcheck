# Antigravity Quota Quickcheck - AI Source Instructions

This document provides AI agents and developers with context about the architecture, module responsibilities, and workflows in the `antigravity-quota-quickcheck` codebase.

## 🎯 Project Overview
A Visual Studio Code extension built in TypeScript that securely fetches and displays the user's real-time Antigravity model quota. It uses native VS Code UI components (Status Bar Items, Markdown Tooltips, and QuickPick popups) for seamless IDE integration, while maintaining zero external dependencies.

## 📁 Repository Structure

The project has been modularized for maintainability:

- `src/extension.ts`: The lightweight UI and lifecycle entry point. Handles extension activation, registers the status bar items, and manages the polling interval timer.
- `src/ui/`: Contains all UI rendering logic.
  - `statusBar.ts`: Manages the text and state of the bottom status bar items.
  - `tooltip.ts`: Generates the rich Markdown hover panel (with tables and SVG images).
  - `quickPick.ts`: Generates the native VS Code dropdown menu (`showQuotaPopup`).
  - `helpers.ts`: Shared utilities for formatting numbers and building progress bars.
- `src/telemetry/`: The data acquisition module.
  - `index.ts`: Exposes `fetchFullStatus()` and manages the **connection cache** to prevent heavy OS polling.
  - `process.ts`: Contains OS-level logic to scan processes and ports (Windows, Mac, Linux).
  - `client.ts`: Handles the raw HTTP POST request to the local Language Server.
  - `parser.ts`: Normalizes raw JSON responses into clean `FullStatus` and `QuotaData` interfaces.
- `package.json`: Contains the VS Code extension manifest (activation events, commands like `antigravity-quota.setInterval`).
- `assets/icons/`: Contains custom branding and the dynamic SVG battery icons.

## 🧩 Key Workflows

### 1. Extension Activation & Polling
- **Trigger**: The extension is activated implicitly via `onStartupFinished`.
- **Flow**: Registers two status bar items: one for the quota/credits (right), and one for the polling interval setting (left). It starts a `setInterval` loop that fetches data in the background.

### 2. Telemetry Acquisition (The "Magic")
Because the main Antigravity extension doesn't expose a public API, `src/telemetry/` uses the following workflow to get real data:
1. **Cache Check**: Checks if the PID, Port, and Token are already known to avoid running OS shell commands repeatedly.
2. **Process Discovery**: If not cached, scans OS processes (via `powershell` or `ps`) to find the hidden `language_server` background process.
3. **Token Extraction**: Parses the process's command-line arguments to extract a secure `--csrf-token`.
4. **Port Scanning**: Uses OS network tools (`Get-NetTCPConnection`, `ss`, or `lsof`) to discover the local port.
5. **API Query**: Sends an `http` (not https) POST request to `127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus`.
6. **Parsing**: Normalizes the response, sorting quotas in descending order (highest % first).

### 3. UI Display & Interactivity
- **Status Bar**: Displays the active model's percentage and remaining Google AI credits.
- **Hover Tooltip**: Renders a rich Markdown table with battery SVG icons for visual indicators. Includes a link to change the polling interval.
- **QuickPick**: Clicking the main status bar item opens a searchable dropdown with progress bars (`█` and `░`).
- **Settings**: Clicking the interval status bar item (or the tooltip link) triggers an InputBox to adjust the background polling rate dynamically.

## 🤖 AI Guidelines
- **UI Strictness**: Strictly use native VS Code components (QuickPick, InformationMessages, MarkdownStrings) to create popup experiences. Do NOT use Webview Panels.
- **Zero Dependencies**: Keep the extension perfectly lean. All network and OS calls must use built-in Node.js modules (`http`, `child_process`, `os`).
- **Security & Portability**: Ensure any modifications to `process.ts` work securely across Windows, Mac, and Linux.
- **Caching**: Always respect the `cachedPid`/`cachedPort` design in telemetry. Running shell commands every 30 seconds freezes the extension host; rely on HTTP polling as much as possible.
