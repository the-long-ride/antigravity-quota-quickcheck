# Antigravity Quota Quickcheck Specification Index

Antigravity Quota Quickcheck is a lightweight, non-intrusive tool for monitoring Google AI model quotas, plan subscription tiers, and credit balances across both a Visual Studio Code extension and a standalone cross-platform desktop system tray application.

## Specifications Map

### Architecture
- [Three-layer quota provider fallback chain](architecture/provider-chain.md)
  Hierarchical multi-source fallback across `agy` CLI, Cloud Code REST, and local Antigravity Language Server with single-flight deduplication.
  *Tags:* `telemetry`, `quota`, `provider`, `cloud-code`, `agy-cli`, `language-server`
  *Sources:* `src/telemetry/providers/`, `desktop-app/src-tauri/src/quota/`

- [Canonical model pools and account plan tiers](architecture/data-models.md)
  Canonical three-pool representation (`Gemini`, `Gemini 4 Argon`, `Claude & OpenAI`), dynamic Argon deduplication, and account plan tier normalization.
  *Tags:* `telemetry`, `model-pools`, `argon`, `plan-tier`, `credits`
  *Sources:* `src/telemetry/parser.ts`, `src/telemetry/types.ts`, `src/constants.ts`, `desktop-app/src-tauri/src/lib.rs`

### Features
- [VS Code extension presentation and user controls](features/vscode-extension.md)
  Status bar item, compact markdown hover panel with quota progress bars, QuickPick interactive menu, and QuotaShift discovery.
  *Tags:* `ui`, `vscode`, `status-bar`, `tooltip`, `quickpick`
  *Sources:* `src/extension.ts`, `src/ui/`, `package.json`

- [Desktop system tray dashboard application](features/desktop-tray-app.md)
  Cross-platform Tauri desktop tray application with dynamically adapting window height, low quota warning colors, and taskbar-docked dashboard.
  *Tags:* `desktop`, `tauri`, `tray`, `adaptive-height`, `ui`
  *Sources:* `desktop-app/src/`, `desktop-app/src-tauri/`

### Workflows
- [Quota polling, silent execution, and refresh lifecycle](workflows/quota-polling-refresh.md)
  Continuous background quota polling (default 30s), hidden silent process execution on Windows (`CREATE_NO_WINDOW`), and on-demand force refresh.
  *Tags:* `workflow`, `polling`, `refresh`, `process`, `lifecycle`
  *Sources:* `src/telemetry/index.ts`, `src/telemetry/process.ts`, `desktop-app/src-tauri/src/lib.rs`, `desktop-app/src-tauri/src/quota/process.rs`
