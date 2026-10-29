# Changelog

All notable changes to this project will be documented in this file.

## [1.3.2] - 2026-10-29

### VS Code Extension
- **Added**:
  - **Antigravity Model Pools Parity**: Full support for tracking the three canonical provider pools: `Gemini`, `Gemini 4 Argon`, and `Claude & OpenAI`.
  - **Argon Pool Placement**: Prioritized `Gemini 4 Argon` directly above `Claude & OpenAI`.
  - **Dynamic Argon Deduplication**: Dynamically deduplicates `Gemini 4 Argon` when its quota signatures match `Gemini`, cleanly merging it to avoid duplicate UI cards.
  - **Single-Lane Weekly Pool Support**: Clean single-lane weekly Argon pool representation across the status bar, compact hover panel, and QuickPick menu.
  - **Gemini-Only Compact Layout**: Optimized layouts to handle single-lane pools gracefully without dangling limit slots.
  - **Theme-Aware Desktop Icons**: Local light and dark SVG icons for Desktop App quickpick entries.
- **Changed**:
  - **Fullwidth Dash for Unavailable Credits**: Displays `—` instead of `unavailable` across hover tooltip and QuickPick when credits are absent.
  - **QuickPick 2nd-Row Usage Format**: Formats QuickPick pool usage strictly in row 2 as `5h {pct}% - {time} (fullwidth) 7d {pct}% - {time}`.
- **Fixed**:
  - **Account Tier Normalization**: Restored Google AI Pro tier detection from `loadCodeAssist` and `command.data.planTier` across all sources.

### Desktop App
- **Added**:
  - **Adaptive Window Height**: Dynamically resizes the desktop window according to active quota pool count to display all pools cleanly without vertical scrolling (216px for loading, 224px for Gemini-only compact, 292px for 1 pool, 381px for 2 pools, 470px for 3 pools, 559px for 4+ pools).
  - **Header Version Hyperlink**: Added a subtle gray version link in the header (`v1.3.2`) with underline on hover, opening the GitHub changelog directly in the default browser.
  - **Low Quota Warning Levels**: Usage bars and percentage values turn dark orange for 11–20% remaining and dark red for ≤ 10%.
  - **7d Tray Tooltip Label**: Standardized tray icon hover tooltip to use `5h` and `7d` limit labels.
  - **Argon Pool Placement**: Positioned `Gemini 4 Argon` directly above `Claude & OpenAI` in the dashboard.
  - **Edge-Clamped Floating Tooltips**: Replaced native browser `title=` tooltips across all buttons and hyperlinks with sleek, themed floating tooltips dynamically clamped to stay strictly inside the panel edges.
- **Changed**:
  - **Optimized Panel Width**: Balanced desktop panel width at 598px (110% of compact baseline) for a comfortably readable and sleek desktop footprint.
  - **Compacted Desktop Top Row**: Displays Plan Tier and Remaining AI Credits in a compact, single-row layout.
  - **Simplified Reset Time Format**: Removed the `Resets at:` prefix so reset times render cleanly (e.g. `4:25 AM` or `Oct 30, 4:25 AM`).
  - **Inline Quotas Header**: Streamlined section title to `Quotas` with an inline `- Periods & reset time` subtitle.
- **Fixed**:
  - **Desktop Window Scrollbar Elimination**: Expanded desktop panel height for 3 pools to 470px, removing vertical clipping and scrollbars.
  - **Tauri Package Alignment**: Aligned `@tauri-apps/api`, `@tauri-apps/cli`, and `@tauri-apps/plugin-opener` with Tauri 2.12 Rust crates to eliminate version mismatch warnings.
  - **Account Tier Detection in Desktop**: Restored Google AI Pro tier detection across all sources.

## [1.3.1] - 2026-09-10

### VS Code Extension
- **Added**:
  - **QuotaShift Discovery**: Added discovery links from the extension tooltip and QuickPick menu to QuotaShift for multiple-account switching.
- **Changed**:
  - **Narrower Hover Panel**: Tightened quota-table spacing and progress bars so the status-bar hover panel stays compact while keeping hints on one line.
  - **Abbreviated Reset Dates**: Formatted reset timestamps using abbreviated month names (e.g. `Sep 11, 10:18 AM`).
- **Fixed**:
  - **Silent Windows Refresh**: Language-server discovery now launches PowerShell directly with no intermediate command shell, in hidden non-interactive mode.

### Desktop App
- **Added**:
  - **QuotaShift Discovery**: Added footer link to QuotaShift.
- **Fixed**:
  - **Silent Windows Refresh**: Background quota refresh helpers no longer open visible terminal or PowerShell windows on Windows.

## [1.3.0] - 2026-09-04

### VS Code Extension
- **Added**:
  - **Three-Layer Quota Fallback**: Prefer structured `agy` CLI usage, fall back to direct Cloud Code with existing sign-in, and use language server as the final source.
- **Changed**:
  - **Source-Neutral Extension Errors**: Extension retry messaging no longer assumes the language server was the failed source.
  - **Short Reset Dates**: Reset timestamps use abbreviated month names.

### Desktop App
- **Added**:
  - **Three-Layer Quota Fallback**: Implemented the 3-layer provider fallback chain in the Rust backend.
- **Changed**:
  - **Compact Desktop Panel**: Reduced desktop tray dashboard to 680x380 and removed unused quota-area gap.
  - **Hidden Windows Helpers**: Spawns background process helpers silently without console windows.

## [1.2.3] - 2026-06-22

### VS Code Extension
- **Added**:
  - **Desktop Companion App Hint**: Added note/link in the status bar tooltip and QuickPick menu prompting users to check out the standalone Desktop App.

### Desktop App
- **Added**:
  - **Installer Icon**: Set the custom desktop app icon for the generated NSIS installer and uninstaller on Windows.
- **Changed**:
  - **Robust Installer Path Detection**: Re-implemented registry path discovery across HKCU and HKLM uninstall/publisher keys.
  - **Backend Updater Args**: Pass `/UPDATE` flag to installer from Rust backend when launching update on Windows.

## [1.2.2] - 2026-06-22

### VS Code Extension
- **Added**:
  - **Multi-Limit Support**: Formatted dual 5-hour and weekly limits with localized absolute reset times.

### Desktop App
- **Added**:
  - **Multi-Limit Quota Display**: Concurrently displays rolling 5-Hour Limit and Weekly Limit.
  - **Limit Interdependence Logic**: Depleted weekly limit automatically forces 5-hour limit to 0%.
  - **Double-Column Desktop Layout**: Re-laid out limits side-by-side as two vertical columns below model name.
  - **Single-Instance Enforcement**: Integrated `tauri-plugin-single-instance` to prevent multiple simultaneous instances.
  - **Click-to-Center Scrolling**: Monitored model smooth-scrolls into vertical center on focus or tray click.
- **Changed**:
  - **Renamed App**: Renamed desktop app to `Antigravity Quota Quickcheck`.
  - **Compact Tray Tooltip**: Simplified system tray tooltip to prevent Windows 64-character truncation.

## [1.2.1] - 2026-06-21

### VS Code Extension
- **Added**:
  - Documentation and links for the new standalone desktop companion app.

### Desktop App
- **Added**:
  - **Tauri Standalone Desktop Tray App**: Initial standalone system tray app to monitor model quotas and credits outside VS Code.
  - Lightweight system tray utility with hover tooltip info.
  - Translucent overlay dashboard togglable on click.
  - Progress bars, custom refresh rate, theme toggle (dark/light), and direct GitHub release updater.

## [1.2.0] - 2026-06-20

### VS Code Extension
- **Added**:
  - **Manual Model Selection**: Choose which model to monitor in status bar via QuickPick modal with checkmark indicator.
  - **Exact Reset Times**: Updated "Resets in" to show exact local reset time along with relative duration.
- **Changed**:
  - **Simplified Usage Monitoring**: Removed background period-based hardest-working model tracking.
  - **UI Refinement**: Removed redundant `Model Quotas:` label from hover tooltip.

## [1.1.5 ~ 1.1.6] - 2026-05-08

### VS Code Extension
- **Fixed**:
  - **Linux Compatibility**: Resolved protocol mismatch ("http instead of https") on Linux distributions.
  - **Automatic HTTPS Fallback**: Switches to HTTPS if local language server requires it.
  - **Robust Port Detection**: Regex-based parsing of `ss` output on Linux.
- **Changed**:
  - **Extended Tracking Window**: Increased default usage tracking window to 20 minutes.
  - **UI Refinement**: Polished hover tooltip labels for subscriptions.

## [1.1.4] - 2026-04-23

### VS Code Extension
- **Added**:
  - **Hardest Working Model Logic**: Calculates hardest working model based on quota drops within sliding window.
  - **Visual Pulse Indicator**: Active model features a pulse icon `$(pulse)` and bold styling in tooltip table.
  - **Adjustable Tracking Window**: Button `$(history)` in tooltip to customize usage tracking window.
- **Changed**:
  - **Code Refactor**: Renamed `activeModel` to `recentlyUsedModel` across codebase.
  - **Automatic History Pruning**: Background interval to prune old usage events every minute.

## [1.1.2 & 1.1.3] - 2026-04-22

### VS Code Extension
- **Added**:
  - **Smart Active Model Tracker**: Highlights actively used model in status bar.
  - **Minimize UI Mode**: Toggle in tooltip to hide status bar usage text.
  - **HTML Hover Panel**: Borderless table with theme-aware `<kbd>` action buttons.
  - **Plan Tier Display**: Shows user plan tier in tooltip.
- **Changed**:
  - **Real-time Reliability**: Removed response-level `CACHE_TTL`.
  - **Code Centralization**: Extracted UI strings into `constants.ts`.

## [1.1.1] - 2026-04-22

### VS Code Extension
- **Added**:
  - **Configurable Polling Interval**: Status bar button and tooltip link to adjust refresh rate.
  - **Documentation**: Overhauled README with modern concise design.
- **Changed**:
  - **Architectural Refactor**: Modularized codebase into `ui/` and `telemetry/`.
  - **Performance Optimization**: Connection caching to eliminate redundant port scans.

## [1.1.0] - 2026-04-22

### VS Code Extension
- **Added**:
  - **Visual Quota Indicators**: Dynamic SVG battery icons (25%, 50%, 75%, 100%) and depleted slash icon.
  - **Enhanced Tooltip**: Rich hover panel with progress bars.
- **Changed**:
  - **UI Refinement**: Optimized status bar text and QuickPick layout.

## [1.0.0] - 2026-04-20

### VS Code Extension
- **Added**:
  - Initial release of Antigravity Quota Quickcheck for VS Code.
  - Status bar integration for real-time model quota tracking.
  - Google AI Credits balance display.
  - One-click QuickPick menu for all available models.
