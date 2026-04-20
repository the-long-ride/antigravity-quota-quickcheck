# Antigravity Quota Quickcheck - AI Source Instructions

This document provides AI agents and developers with context about the architecture, module responsibilities, and workflows in the `antigravity-quota-quickcheck` codebase.

## 🎯 Project Overview
A Visual Studio Code extension built in TypeScript that displays the user's Antigravity quota in the IDE's bottom right status bar. It utilizes native VS Code UI components (Status Bar Items and Information Messages) for seamless integration with the user's IDE theme.

## 📁 Repository Structure

- `src/extension.ts`: The primary entry point for the extension. Contains all logic for activating the extension, registering commands, rendering the status bar icon, and displaying the quota modal.
- `package.json`: Contains the VS Code extension manifest, outlining activation events, contributed commands, publisher details, and configuration properties.
- `tsconfig.json`: TypeScript compiler configuration for building the extension into the `out/` directory.
- `out/`: Contains the compiled JavaScript output (ignored in version control).

## 🧩 Key Workflows

### 1. Extension Activation
- **Trigger**: The extension is activated via `onStartupFinished` (defined in `package.json`).
- **Flow**: VS Code invokes the `activate(context)` function in `src/extension.ts`. This sets up the Status Bar Item and registers the click command.

### 2. Status Bar Item
- Rendered on the `Right` side with priority `100`.

### 3. Quota Popup Display
- When the user clicks the status bar item, the `antigravity-quota.check` command is invoked.
- Displays a native `vscode.window.createQuickPick` popup. We use a QuickPick because it provides a native dropdown popup experience without opening a new editor tab. It leverages custom formatting (text-based progress bars) to present the quota data across columns.

## 🤖 AI Guidelines
- **UI Guidelines**: We strictly use native VS Code components (like QuickPick) to create popup-like experiences without resorting to Webview Panels or opening new editor tabs. Ensure any formatting is done using icons and text styling within the QuickPick items.
- **Dependencies**: Keep dependencies to an absolute minimum. Avoid heavy libraries since this is a simple status bar utility.
- **Error Handling**: Use `vscode.window.showErrorMessage` to display user-facing errors gracefully. Do not silently fail.
