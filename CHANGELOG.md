# Changelog

All notable changes to this project will be documented in this file.

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
