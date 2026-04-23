# Changelog

All notable changes to this project will be documented in this file.

## [1.1.4] - 2026-04-23

### Added
- **Hardest Working Model Logic**: Improved the recently used model tracker to calculate the "hardest working" model based on usage volume (quota drops) within a sliding window (**default 5 minutes, user-customizable**), rather than just the last seen decrease.
- **Visual "Pulse" Indicator**: The recently used model now features a pulse icon (**$(pulse)**) and bold styling in the tooltip table for better visibility.
- **Adjustable Tracking Window**: Added a new button (**$(history)**) in the tooltip to allow users to customize the recent usage tracking window (e.g., from 5 minutes to 1 minute or 15 minutes).

### Changed
- **Code Refactor**: Renamed `activeModel` to `recentlyUsedModel` across the entire codebase for better clarity.
- **Improved UI Labels**: Refined tooltip action labels for better clarity ("Set interval" and "Set period") and removed legacy styling for a cleaner look.
- **Descriptive Tooltips**: Added more detailed hover tooltips for all action buttons in the status bar panel.
- **Automatic History Pruning**: Added a background interval to prune old usage events every minute to ensure optimal memory usage.

## [1.1.2 & 1.1.3] - 2026-04-22

### Added
- **Smart Active Model Tracker**: Automatically highlights the model you are actively using in the status bar (with a smart fallback to the highest quota).
- **Minimize UI Mode**: Added a toggle in the tooltip to hide the status bar usage text for a cleaner workspace.
- **HTML Hover Panel**: Refined the tooltip using borderless HTML tables and theme-aware `<kbd>` action buttons.
- **Plan Tier**: Display user's plan tier in the tooltip.

### Changed
- **Real-time Reliability**: Removed the response-level `CACHE_TTL` to ensure all manual checks and hovers display perfectly up-to-date data.
- **Code Centralization**: Extracted all hardcoded UI strings and commands into a centralized `constants.ts`.
- **UI Polishing**: Right-aligned the tooltip footer actions and hints for a more professional layout.

## [1.1.1] - 2026-04-22

### Added
- **Configurable Polling Interval**: Added a status bar button and tooltip link to manually adjust the data refresh rate.

### Changed
- **Architectural Refactor**: Modularized the codebase into `ui/` and `telemetry/` packages for better maintainability.
- **Performance Optimization**: Implemented connection caching to eliminate redundant OS-level process and port scanning, significantly reducing CPU usage.
- **UI Polishing**: Refined tooltip footer layout and command interaction.

## [1.1.0] - 2026-04-22

### Added
- **Visual Quota Indicators**: Replaced emojis with dynamic SVG battery icons (25%, 50%, 75%, 100%) and a slash icon for depleted quotas.
- **Enhanced Tooltip**: Rich hover panel with visual progress bars and color-coded status.
### Changed
- **UI Refinement**: Optimized the status bar text and QuickPick layout for better readability.
- **Documentation**: Overhauled README with a more modern, concise design.

## [1.0.0] - 2026-04-20

### Added
- Initial release of Antigravity Quota Quickcheck.
- Status bar integration for real-time model tracking.
- Google AI Credits balance display.
- One-click QuickPick menu for all available models.
