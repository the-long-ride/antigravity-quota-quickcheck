# Desktop Polish and VS Code Provider Chain Design

## Goal

Apply four follow-up changes on `feat/cli-quota-provider-chain`:

1. Remove the large empty area in the desktop tray panel by reducing the fixed Tauri window height while keeping all existing controls visible.
2. Render reset dates with abbreviated month names (`Sep 11, 10:18 AM` instead of `September 11, 10:18 AM`).
3. Prevent quota refresh subprocesses from opening visible terminal/PowerShell windows on Windows.
4. Give the VS Code extension the same three-provider quota fallback chain as the desktop app, in this order:
   1. `agy` CLI structured quota output
   2. direct Cloud Code using `agy` credentials
   3. Antigravity language server

The desktop and extension should continue exposing their current UI-facing status shapes so this work does not require redesigning the quota UI.

## Current state

### Desktop

The Tauri window is fixed at `680x650`, while the dashboard content only needs a little over half of that height. The quota list is flex-grown to fill the remaining space, which creates the visible empty region between the quota cards and footer.

The desktop backend already has the new provider chain under `desktop-app/src-tauri/src/quota/`:

```text
agy CLI -> Cloud Code -> language server
```

Quota subprocesses currently use normal process creation. On Windows, `agy.exe`, PowerShell credential lookup, and PowerShell language-server discovery can therefore flash a console window.

### VS Code extension

The extension is still language-server only. `src/telemetry/index.ts` discovers the Antigravity process, port and CSRF token directly, queries the local language-server API, then normalizes the response.

The UI calls `fetchFullStatus()` and should remain unaware of which provider produced the snapshot.

## Desktop panel sizing

### Chosen behavior

Reduce the desktop window height from `650` to a compact fixed value sized for:

- header
- top tier/credit cards
- section heading
- two quota cards
- footer
- small breathing room

Target height: **approximately 380px**. The implementation may adjust by a few pixels after checking actual rendered content, but it should not retain a large flexible blank region.

The window remains:

- `680px` wide
- non-resizable
- always-on-top
- tray-style popup

If tray positioning logic assumes `650px`, update it to use the new height or query the actual outer size so the popup still anchors correctly above/beside the tray icon.

The quota list may keep vertical scrolling as a safety fallback, but with the normal two-card layout the scrollbar should not be needed.

## Reset date formatting

All human-facing absolute reset times should use a short month:

```text
Sep 11, 10:18 AM
Jan 3, 2:04 PM
```

Requirements:

- use the user's local timezone, as today
- keep 12-hour clock behavior where already used
- abbreviate month names to the locale's short month form
- do not alter raw timestamps carried between backend/provider layers

Desktop and VS Code should use their existing formatting helpers where possible rather than duplicating formatting in individual UI components.

## Hidden quota subprocesses

### Windows

Every subprocess launched only for quota discovery/authentication must be created without a visible console window.

Desktop Rust processes covered:

- `agy` CLI quota command
- PowerShell Windows Credential Manager reader
- PowerShell language-server process discovery
- PowerShell language-server port discovery
- any future quota-only helper spawned by these provider modules

Use Windows process creation flag `CREATE_NO_WINDOW` (`0x08000000`) through `std::os::windows::process::CommandExt` / Tokio's underlying `Command` access.

The flag should be applied through a small helper so it is difficult to forget on later provider subprocesses.

Do **not** apply this behavior to unrelated user-visible processes such as the updater installer.

### VS Code / Node

All provider subprocesses should be spawned with `windowsHide: true`.

This includes:

- `agy`
- PowerShell keyring lookup
- PowerShell language-server discovery
- other quota-only helper processes

Stdout/stderr must remain captured exactly as needed for parsing and error classification.

## VS Code provider architecture

### Provider contract

Introduce provider modules under `src/telemetry/providers/` while keeping `fetchFullStatus()` as the public orchestration entry point.

Proposed structure:

```text
src/telemetry/
  index.ts                     public fetchFullStatus + cache
  types.ts
  parser.ts                    existing shared UI normalization helpers
  providers/
    index.ts                   ordered provider orchestrator
    types.ts                   ProviderError / provider result helpers
    agyCli.ts                  CLI discovery, execution, structured parser
    cloudCode.ts               OAuth refresh + Cloud Code HTTP calls/mapping
    credentials.ts             agy credential/keyring loading + OAuth client discovery
    languageServer.ts          existing process/port/CSRF provider
```

Existing `client.ts` / `process.ts` logic can be moved or wrapped by `languageServer.ts`; avoid unrelated refactors.

### Fallback order

```text
1. agy CLI
   success -> return
   unavailable/unsupported/auth/transient/invalid -> continue

2. Cloud Code
   success -> return
   unavailable/auth/transient/invalid -> continue

3. language server
   success -> return
   failure -> throw combined diagnostic
```

A result is usable when it contains at least one meaningful quota card or useful credits/tier data. An empty placeholder must not stop fallback.

`fetchFullStatus()` caches the last successful status as it does today. A failed provider must not clear the last good status unless the entire chain fails and the caller explicitly needs an error.

## VS Code provider 1: `agy` CLI

Use the same contract as the desktop provider:

```text
agy -p /usage --output-format json
```

with `/quota` as the compatibility fallback when needed.

Requirements:

- binary discovery: `AGY_BIN`, `PATH`, known install locations
- direct process spawn; no shell interpolation
- `windowsHide: true`
- bounded timeout
- capture stdout/stderr
- parse `command.data.groups`
- support `Gemini Models` and `Claude and GPT models`
- preserve explicit `5h` and `weekly` windows and reset timestamps
- never scrape human-formatted terminal tables
- no token/secret logging

The normalized extension status should keep the same grouped quota labels already used by the extension UI:

- `Gemini`
- `Claude & OpenAI`

## VS Code provider 2: direct Cloud Code

Port the desktop provider semantics to TypeScript; do not call the Rust desktop binary from the extension.

### Credentials

Credential priority should match desktop behavior:

- Windows Credential Manager target `gemini:antigravity`
- macOS Keychain service/account `gemini` / `antigravity`
- Linux Secret Service via `secret-tool`
- legacy `~/.gemini/oauth_creds.json` fallback

All helper processes use `windowsHide: true`.

### OAuth client discovery

Read the installed `agy` binary and discover candidate OAuth client IDs/secrets using the same matching rules as the desktop implementation. Do not hard-code Google OAuth client credentials in the repository.

Use the stored refresh token to obtain an access token from Google's OAuth token endpoint. Keep tokens in extension-host memory only.

### HTTP transport

The extension supports VS Code `^1.80.0`, whose extension-host Node runtime cannot be assumed to provide modern browser-style `fetch` consistently. Use Node core `https` (or the existing transport style) instead of adding a dependency solely for HTTP.

Requirements:

- TLS certificate validation enabled
- explicit request timeout
- bounded response size
- JSON parsing separated from transport so fixtures can be tested without network access
- never include token values in thrown/logged errors

### Cloud Code calls

Call the same endpoints as the desktop provider:

1. `loadCodeAssist`
2. `retrieveUserQuota`
3. `fetchAvailableModels`

Normalize them to the extension's current `FullStatus` shape.

Mapping rules remain identical to desktop:

- explicit 5h/weekly values are preferred
- missing windows remain unavailable rather than fabricated
- Gemini and Claude/OpenAI stay grouped
- credits and plan tier come from `loadCodeAssist` when available

## VS Code provider 3: language server

Move the current extension language-server logic behind a provider module with behavior preserved:

- locate `language_server`
- extract CSRF token
- detect listening port
- query `GetUserStatus`
- query `RetrieveUserQuotaSummary`
- normalize into grouped cards

The language server becomes the final fallback rather than the only source.

The status-bar error text should no longer say only `Language server not reachable.` because failure may come from all three providers. Use a source-neutral message such as:

```text
Antigravity quota unavailable. Click to retry.
```

Detailed provider diagnostics may remain internal/debug-only and must redact secrets.

## Provider cooldown and polling

The extension polls every 30 seconds by default. Repeatedly probing unavailable providers should not spawn unnecessary processes each cycle.

Add lightweight per-provider cooldowns:

- missing `agy` binary: cache discovery failure for about 5 minutes
- unsupported structured CLI contract: cache for the current extension-host session or until the binary mtime/version changes
- missing native keyring helper/credential: cache for about 1 minute
- transient network/server failure: short cooldown around 15-30 seconds
- successful provider: no special cooldown beyond normal polling

A manual force refresh may bypass transient cooldowns, but should not repeatedly re-read an unchanged unsupported CLI binary unless useful.

Only one `fetchFullStatus()` refresh should run at a time; concurrent callers should share the in-flight promise.

## Shared behavior across desktop and extension

The implementations are in different languages, so they will not share source code. They should share **behavioral fixtures and semantics**:

- same sample `agy /usage` envelopes
- same grouping rules
- same 5h/weekly interpretation
- same missing-window behavior
- same key credential JSON shapes
- same Cloud Code response fixtures where practical

This keeps the two clients aligned without introducing a cross-language runtime dependency.

## Security constraints

- never log OAuth access tokens, refresh tokens, client secrets, or raw credential blobs
- never send credentials to VS Code UI/webviews or desktop frontend
- no shell interpolation for `agy`
- hidden Windows subprocesses only for background quota helpers
- timeout and output-size bounds on child processes
- timeout and response-size bounds on Cloud Code/OAuth HTTP calls
- no TLS certificate bypass for Google endpoints
- language-server HTTPS loopback exception remains local-only and unchanged where already required

## Testing strategy

### Desktop regression tests

Add/adjust tests for:

- Windows background process helper configuration where testable
- date formatting helper if implemented in TypeScript frontend
- provider behavior remains unchanged after process-spawn refactor

Build checks:

- Linux desktop `cargo test` + `cargo check`
- Windows desktop `cargo check`
- desktop frontend build

### VS Code provider tests

Use Node's existing test setup and fixture-driven unit tests.

`agyCli`:

- valid two-group envelope
- tier with only weekly windows
- malformed JSON
- unsupported output
- command timeout/error classification

`credentials`:

- credential JSON normalization
- keyring base64 form
- OAuth client extraction from synthetic binary bytes
- no secret-shaped fixture literals that trigger GitHub secret scanning

`cloudCode`:

- plan/credits parsing
- Gemini quota mapping
- shared Claude/OpenAI mapping
- missing windows remain unavailable
- HTTP errors classified without leaking auth headers

`orchestrator`:

- CLI success prevents Cloud Code/language-server invocation
- CLI fail -> Cloud Code success
- CLI + Cloud Code fail -> language server success
- all fail -> source-neutral diagnostic
- concurrent calls share one in-flight refresh
- cooldown prevents repeated missing-provider process spawning

Existing parser/UI tests must continue passing.

## Acceptance criteria

1. Desktop panel no longer has the large blank region shown in the reported screenshot.
2. The normal two-card desktop layout fits without vertical scrolling at the chosen fixed window height.
3. Reset times render `Sep`, `Oct`, etc. instead of full month names.
4. Background quota refresh on Windows does not flash an `agy`, PowerShell, or terminal window.
5. VS Code extension uses `agy -> Cloud Code -> language server` in that exact order.
6. VS Code works for a user who is signed into `agy` but has no Antigravity language server running.
7. VS Code can still use the existing language-server path when the first two providers fail.
8. Desktop and extension group quota as `Gemini` and `Claude & OpenAI` with truthful 5h/weekly availability.
9. No credentials or OAuth secrets are exposed in UI or logs.
10. Extension compile/tests and Linux/Windows desktop verification pass before merge.

## Out of scope

- changing quota card visual styling beyond removing the excessive empty height
- changing polling defaults
- adding user-selectable provider priority
- sharing provider implementation code between Rust and TypeScript through a native bridge
- changing the official `agy` credential store
- introducing a new HTTP library solely for the extension Cloud Code provider
