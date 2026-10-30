---
schema_version: 1
id: "feature.desktop-tray-app"
title: "Desktop system tray dashboard application"
kind: "feature"
status: "verified"
summary: "Cross-platform Tauri tray application with dynamically adapting window height, low quota warning levels, and taskbar-pinned dashboard."
tags: ["desktop", "tauri", "tray", "adaptive-height", "ui"]
source_paths: ["desktop-app/index.html", "desktop-app/src-tauri/src/lib.rs", "desktop-app/src-tauri/src/main.rs", "desktop-app/src-tauri/tauri.conf.json", "desktop-app/src/layout-fixes.css", "desktop-app/src/main.ts", "desktop-app/src/styles.css", "desktop-app/src/tooltip.ts"]
related_specs: ["architecture.data-models", "architecture.provider-chain", "workflow.quota-polling-refresh"]
last_doc_update_at: "2026-10-30T00:12:00Z"
last_verified_at: "2026-10-30T00:12:00Z"
last_verified_code_commit: "9188bdb"
last_source_change_commit: "9188bdb"
last_source_change_at: "2026-10-30T00:04:35+07:00"
source_fingerprint: "sha256:fa072dbe8a1f112a739dba4ea0ef8fe877a5da4b33c0de79f0ebbaa878f0399e"
---

# Desktop system tray dashboard application

## Purpose and boundaries
Provides a lightweight, standalone desktop system tray dashboard to monitor Antigravity quotas independently of VS Code.

Runs as a background daemon with minimal memory footprint, positioning its dashboard directly above the Windows taskbar near the notification area.

## Observable behavior
- **System Tray Icon**:
  - Displays battery/charge status icon in OS notification tray.
  - Left-clicking toggles dashboard window visibility; right-clicking opens context menu (Show / Quit).
  - Hovering displays multi-line tooltip with active model, `5h` and `7d` limit bars and percentages.
- **Adaptive Window Height**:
  - Automatically calculates authoritative window height based on active pool count to display all pools cleanly with 0 vertical scrolling:
    - 0 pools (loading/offline): 216px
    - 1 pool (Gemini-only compact): 224px
    - 1 pool (standard with header): 292px
    - 2 pools: 381px
    - 3 pools: 470px
    - 4+ pools: 559px+
- **Usage Warning Colors**:
  - Remaining percentage and progress bar render dark orange (`--quota-warning`) when usage is between 11% and 20%.
  - Renders dark red (`--quota-danger`) when usage is ≤ 10%.
- **Top Row Compacting**:
  - Plan Tier and Remaining AI Credits cards are presented side-by-side in a single row.
- **Edge-Clamped Floating Tooltips**:
  - Replaces native OS `title=` attributes on all buttons and hyperlinks with custom themed floating tooltips.
  - Automatically calculates viewport constraints and clamps tooltips so they are never clipped by the window edges.
- **Theme Support**:
  - Dark mode by default with instant toggle to light mode via header button.

## Workflow
1. User clicks tray icon -> Rust backend calls `position_window(&window)` using active `current_height` and monitor DPI scale factor.
2. Window displays borderless and shadowless above taskbar.
3. Frontend receives quota status -> renders quota cards -> invokes `set_window_height({ height: target })`.
4. Rust backend updates `current_height` and repositions/resizes window smoothly.
5. User clicks a model card -> triggers `set_monitored_model` to pin model to tray icon.

## Code map
- `desktop-app/src-tauri/src/main.rs` — Tauri application entrypoint
- `desktop-app/src-tauri/src/lib.rs` — Window positioning, DPI scaling, tray builder, and Tauri command bindings
- `desktop-app/src-tauri/tauri.conf.json` — Window geometry (598x470), security, and build configuration
- `desktop-app/src/main.ts` — TypeScript UI rendering, `calculateWindowHeight`, and theme management
- `desktop-app/src/styles.css` — Modern monochromatic styling, warning levels, and animations
- `desktop-app/src/layout-fixes.css` — Card flex structure
- `desktop-app/src/tooltip.ts` — Floating tooltip positioning and edge clamping
- `desktop-app/index.html` — HTML shell

## Interfaces and data
- Tauri Commands: `set_window_height`, `set_monitored_model`, `set_poll_interval`, `force_refresh`, `get_quota_status`
- Tauri Events: `status-updated`, `window-shown`

## Verification
- Headless browser verification checks `calculateWindowHeight` against DOM scrollHeight (`isOverflowing === false`).
- `test/presentation-contract.test.cjs` validates window height calculation and warning level tier assignments.
- `desktop-app/scripts/verify-ui-contract.cjs` validates UI contract and layout integrity.

## Related documentation
- [Canonical model pools and account plan tiers](../architecture/data-models.md)
- [Quota polling and refresh workflow](../workflows/quota-polling-refresh.md)
- [VS Code extension presentation](vscode-extension.md)

## Known limitations and open questions
- Multi-monitor setups position relative to the monitor containing the cursor or primary monitor.
