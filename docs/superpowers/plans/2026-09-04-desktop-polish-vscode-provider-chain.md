# Desktop Polish and VS Code Provider Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact the desktop tray UI, abbreviate reset dates, hide quota helper windows on Windows, and make the VS Code extension fetch quota through `agy CLI -> Cloud Code -> language server`.

**Architecture:** Keep the desktop UI contract unchanged while making its helper process creation silent on Windows and reducing the Tauri window to `680x380`. In the extension, replace the language-server-only fetch path with provider modules that normalize into the existing `FullStatus` shape, preserve grouped `Gemini` / `Claude & OpenAI` cards, and share a single in-flight refresh with provider cooldowns.

**Tech Stack:** TypeScript/Node 18 extension host, VS Code API `^1.80.0`, Node core `child_process` / `https`, Rust/Tokio/Tauri 2, existing `reqwest` + `serde_json`, Node built-in test runner, Cargo tests/checks.

**Spec:** `docs/superpowers/specs/2026-09-04-desktop-polish-vscode-provider-chain-design.md`

## Global Constraints

- Desktop window is exactly `680x380`, non-resizable, always-on-top, tray-style.
- Human-facing reset dates use abbreviated month names such as `Sep 11, 10:18 AM`; raw timestamps remain unchanged.
- All quota-only Windows subprocesses are hidden; updater/installer processes remain user-visible as before.
- VS Code provider order is exactly `agy CLI -> Cloud Code -> language server`.
- `agy` uses structured `/usage` JSON first and `/quota` as compatibility fallback; never scrape human terminal tables.
- Cloud Code uses the user's existing `agy` credentials and runtime OAuth client discovery; never hard-code or log OAuth secrets/tokens.
- Missing 5h/weekly windows stay unavailable rather than being fabricated.
- Extension keeps the existing `FullStatus` / `QuotaData` UI-facing contract.
- Extension uses Node core HTTP(S); do not add an HTTP dependency solely for Cloud Code.
- All subprocesses and HTTP calls are bounded by timeouts and output/response-size limits.
- Extension compile/tests and Linux/Windows desktop verification must pass before completion.

---

### Task 1: Compact desktop window and abbreviate reset dates

**Files:**
- Modify: `desktop-app/src-tauri/tauri.conf.json`
- Modify: `desktop-app/src-tauri/src/lib.rs`
- Modify: `desktop-app/src/main.ts`
- Modify: `desktop-app/src/styles.css`

**Interfaces:**
- Consumes: existing Tauri `main` window and `formatAbsoluteTime(isoDate: string): string` behavior.
- Produces: fixed `680x380` tray window, positioning that derives actual window size where possible, and short-month reset labels.

- [ ] **Step 1: Write the failing desktop layout/date checks**

Add a small verification test script `desktop-app/scripts/verify-ui-contract.cjs` that reads source/config files and asserts the exact contract:

```js
const fs = require('node:fs');
const assert = require('node:assert/strict');

const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const mainWindow = config.app.windows.find((w) => w.label === 'main');
assert.equal(mainWindow.width, 680);
assert.equal(mainWindow.height, 380);

const mainTs = fs.readFileSync('src/main.ts', 'utf8');
for (const month of ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']) {
  assert.ok(mainTs.includes(`"${month}"`) || mainTs.includes(`'${month}'`));
}
assert.ok(!mainTs.includes('"September"'));

const styles = fs.readFileSync('src/styles.css', 'utf8');
assert.match(styles, /\.quotas-section[\s\S]*?flex:\s*0\s+1\s+auto/);
```

Add to `desktop-app/package.json`:

```json
"test:ui": "node scripts/verify-ui-contract.cjs"
```

- [ ] **Step 2: Run the UI contract test and verify it fails**

Run:

```bash
cd desktop-app
npm run test:ui
```

Expected: FAIL because the window is still `650` high, full month names remain, and `.quotas-section` is still flex-grown.

- [ ] **Step 3: Make the window exactly 380px high and remove flex-grown blank space**

In `desktop-app/src-tauri/tauri.conf.json` set:

```json
"width": 680,
"height": 380
```

In `desktop-app/src/styles.css`, change the quota section/list sizing so two normal cards occupy intrinsic height instead of stretching into the remaining viewport:

```css
.quotas-section {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
  min-height: 0;
}

.quotas-list {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  min-height: 0;
}
```

Keep `.app-content { flex: 1; }` so the footer stays pinned to the bottom; do not add new spacer elements.

- [ ] **Step 4: Make tray positioning use the actual window size**

Replace the hard-coded `680/650` calculation in `position_window()` with the current outer size, falling back to `680x380` only if the size call fails:

```rust
fn position_window(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let monitor_size = monitor.size();
        let monitor_pos = monitor.position();
        let scale_factor = monitor.scale_factor();
        let fallback_w = (680.0 * scale_factor) as u32;
        let fallback_h = (380.0 * scale_factor) as u32;
        let size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(fallback_w, fallback_h));
        let padding = (12.0 * scale_factor) as i32;
        let taskbar_h = (48.0 * scale_factor) as i32;
        let x = monitor_pos.x + monitor_size.width as i32 - size.width as i32 - padding;
        let y = monitor_pos.y + monitor_size.height as i32 - size.height as i32 - taskbar_h - padding;
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}
```

- [ ] **Step 5: Change desktop reset months to abbreviations**

In `desktop-app/src/main.ts`, change the month table used by `formatAbsoluteTime()` to:

```ts
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
```

Keep same-day output unchanged (`Resets at: 3:18 PM`) and non-current-day output as `Resets at: Sep 11, 10:18 AM`.

- [ ] **Step 6: Run desktop UI contract and frontend build**

Run:

```bash
cd desktop-app
npm run test:ui
npm run build
```

Expected: both exit `0`.

- [ ] **Step 7: Commit Task 1**

```bash
git add desktop-app/src-tauri/tauri.conf.json desktop-app/src-tauri/src/lib.rs desktop-app/src/main.ts desktop-app/src/styles.css desktop-app/scripts/verify-ui-contract.cjs desktop-app/package.json
git commit -m "fix: compact desktop quota panel"
```

---

### Task 2: Hide desktop quota subprocess windows on Windows

**Files:**
- Create: `desktop-app/src-tauri/src/quota/process.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Modify: `desktop-app/src-tauri/src/quota/agy_cli.rs`
- Modify: `desktop-app/src-tauri/src/quota/credentials.rs`
- Modify: `desktop-app/src-tauri/src/quota/language_server.rs`
- Test: `desktop-app/src-tauri/tests/quota_sources.rs`

**Interfaces:**
- Produces: `quota::process::hide_window(&mut tokio::process::Command)` and `quota::process::hide_std_window(&mut std::process::Command)`.
- Consumes: all quota-only child process builders.

- [ ] **Step 1: Write failing helper tests**

Add a platform-neutral unit around a helper constant and Windows-only compile path:

```rust
#[test]
fn background_process_creation_flag_matches_windows_create_no_window() {
    assert_eq!(tauri_app_lib::quota::process::CREATE_NO_WINDOW_FLAG, 0x0800_0000);
}
```

Expose the constant publicly for tests, but keep process helper functions crate-internal where possible.

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cd desktop-app/src-tauri
cargo test background_process_creation_flag_matches_windows_create_no_window
```

Expected: FAIL because `quota::process` does not exist.

- [ ] **Step 3: Add the shared process helper**

Create `quota/process.rs`:

```rust
pub const CREATE_NO_WINDOW_FLAG: u32 = 0x0800_0000;

pub fn hide_window(command: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW_FLAG);
    }
}

pub fn hide_std_window(command: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }
}
```

Add `pub mod process;` in `quota/mod.rs`.

- [ ] **Step 4: Apply the helper to every desktop quota child process**

In `agy_cli.rs`, immediately after `Command::new(binary)`:

```rust
super::process::hide_window(&mut command);
```

In `credentials.rs`, inside `run_keyring_command()` after `Command::new(program)`:

```rust
super::process::hide_window(&mut command);
```

In `language_server.rs`, refactor each `std::process::Command::new(...)` into a mutable command, call:

```rust
super::process::hide_std_window(&mut command);
```

then add args and call `.output()`.

Do not call the helper in `lib.rs::execute_update()`.

- [ ] **Step 5: Run Rust tests/checks on Linux**

Run:

```bash
cd desktop-app/src-tauri
cargo test
cargo check --lib
```

Expected: both exit `0`.

- [ ] **Step 6: Compile the Windows-specific process code in CI or on a Windows runner**

Run on Windows:

```powershell
cd desktop-app/src-tauri
cargo check --lib
```

Expected: exit `0`, proving the `CommandExt::creation_flags` path compiles natively.

- [ ] **Step 7: Commit Task 2**

```bash
git add desktop-app/src-tauri/src/quota/process.rs desktop-app/src-tauri/src/quota/mod.rs desktop-app/src-tauri/src/quota/agy_cli.rs desktop-app/src-tauri/src/quota/credentials.rs desktop-app/src-tauri/src/quota/language_server.rs desktop-app/src-tauri/tests/quota_sources.rs
git commit -m "fix: hide desktop quota helper windows"
```

---

### Task 3: Introduce the VS Code provider contract and orchestrator

**Files:**
- Create: `src/telemetry/providers/types.ts`
- Create: `src/telemetry/providers/index.ts`
- Modify: `src/telemetry/index.ts`
- Modify: `package.json`
- Create: `test/providers.test.cjs`

**Interfaces:**
- Produces:
  - `ProviderErrorKind = "unavailable" | "unsupported" | "auth" | "transient" | "invalid-data"`
  - `class ProviderError extends Error`
  - `type ProviderFetch = (force: boolean) => Promise<FullStatus>`
  - `fetchFromProviders(force: boolean): Promise<FullStatus>`
- `fetchFullStatus(force)` remains the public UI API.

- [ ] **Step 1: Expand the Node test command**

Change root `package.json` from:

```json
"test": "npm run compile && node --test test/parser.test.cjs"
```

to:

```json
"test": "npm run compile && node --test test/*.test.cjs"
```

- [ ] **Step 2: Write failing orchestrator tests**

In `test/providers.test.cjs`, require `../out/telemetry/providers` and test an injected provider list so no real processes/network are touched:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { runProviderChain, ProviderError } = require('../out/telemetry/providers');

const status = {
  credits: null,
  quotas: [{
    model: 'Gemini', percent: 50, refreshTime: '',
    fiveHourPercent: 50, fiveHourReset: '', fiveHourDisabled: false,
    weeklyPercent: 75, weeklyReset: '', weeklyDisabled: false,
  }],
  recentlyUsedModel: 'Gemini', planTier: null,
};

test('CLI success stops fallback chain', async () => {
  const calls = [];
  const result = await runProviderChain(false, [
    async () => { calls.push('cli'); return status; },
    async () => { calls.push('cloud'); throw new Error('must not run'); },
  ]);
  assert.equal(result, status);
  assert.deepEqual(calls, ['cli']);
});

test('falls through unavailable providers', async () => {
  const calls = [];
  const result = await runProviderChain(false, [
    async () => { calls.push('cli'); throw new ProviderError('agy CLI', 'unavailable', 'missing'); },
    async () => { calls.push('cloud'); return status; },
  ]);
  assert.equal(result, status);
  assert.deepEqual(calls, ['cli', 'cloud']);
});
```

Also assert an empty snapshot does not stop fallback and all-failed errors are source-neutral.

- [ ] **Step 3: Run provider tests and verify they fail**

Run:

```bash
npm test
```

Expected: FAIL because `out/telemetry/providers` does not exist.

- [ ] **Step 4: Add provider error types and usable-status check**

Create `src/telemetry/providers/types.ts`:

```ts
import { FullStatus } from '../types';

export type ProviderErrorKind =
  | 'unavailable'
  | 'unsupported'
  | 'auth'
  | 'transient'
  | 'invalid-data';

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ProviderFetch = (force: boolean) => Promise<FullStatus>;

export function isUsableStatus(status: FullStatus): boolean {
  return status.quotas.length > 0 || status.credits !== null || !!status.planTier;
}
```

- [ ] **Step 5: Add ordered orchestration with injection for tests**

Create `src/telemetry/providers/index.ts` with exported `runProviderChain(force, providers)` and later default imports:

```ts
import { FullStatus } from '../types';
import { ProviderError, ProviderFetch, isUsableStatus } from './types';

export { ProviderError } from './types';

export async function runProviderChain(
  force: boolean,
  providers: ProviderFetch[],
): Promise<FullStatus> {
  const errors: ProviderError[] = [];
  for (const provider of providers) {
    try {
      const status = await provider(force);
      if (isUsableStatus(status)) return status;
      errors.push(new ProviderError('provider', 'invalid-data', 'empty quota snapshot'));
    } catch (error) {
      errors.push(error instanceof ProviderError
        ? error
        : new ProviderError('provider', 'transient', 'quota provider failed'));
    }
  }
  throw new Error('Antigravity quota unavailable. Sign in with agy or start Antigravity IDE.');
}
```

Do not include provider-specific raw diagnostics in the thrown user-facing message.

- [ ] **Step 6: Add one in-flight `fetchFullStatus()` promise**

Refactor `src/telemetry/index.ts` so it owns only cache/in-flight behavior and delegates provider order to the provider index:

```ts
let cachedStatus: FullStatus | null = null;
let inFlight: Promise<FullStatus> | null = null;

export async function fetchFullStatus(force = false): Promise<FullStatus> {
  if (inFlight) return inFlight;
  inFlight = fetchFromProviders(force)
    .then((status) => {
      if (status.quotas.length > 0) status.recentlyUsedModel = status.quotas[0].model;
      cachedStatus = status;
      return status;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}
```

`cachedStatus` is retained for the last-good state and must not be cleared on individual provider failure.

- [ ] **Step 7: Run tests/compile**

Run:

```bash
npm test
npm run compile
```

Expected: exit `0` after temporary stub providers are wired in the provider index for later tasks.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/telemetry/providers src/telemetry/index.ts test/providers.test.cjs package.json
git commit -m "refactor: add extension quota provider chain"
```

---

### Task 4: Add the VS Code `agy` CLI provider

**Files:**
- Create: `src/telemetry/providers/agyCli.ts`
- Modify: `src/telemetry/providers/index.ts`
- Modify: `test/providers.test.cjs`
- Create: `test/fixtures/agy-usage.json`

**Interfaces:**
- Produces:
  - `parseAgyQuotaEnvelope(raw: string): FullStatus`
  - `fetchAgyCli(force: boolean): Promise<FullStatus>`
- Consumes: `ProviderError`, `FullStatus`, Node `child_process.spawn`.

- [ ] **Step 1: Add a real structured CLI fixture and parser tests**

Create `test/fixtures/agy-usage.json` with the exact public structured shape:

```json
{
  "status": "SUCCESS",
  "command": {
    "name": "usage",
    "data": {
      "groups": [
        {
          "name": "Gemini Models",
          "buckets": [
            {"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.72,"reset_time":"2030-09-11T03:18:00Z"},
            {"id":"gemini-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":1,"reset_time":"2030-09-04T08:18:00Z"}
          ]
        },
        {
          "name": "Claude and GPT models",
          "buckets": [
            {"id":"3p-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.55,"reset_time":"2030-09-10T11:51:00Z"},
            {"id":"3p-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":0.8,"reset_time":"2030-09-04T08:18:00Z"}
          ]
        }
      ]
    }
  }
}
```

Test `Gemini` = 100%/72% and `Claude & OpenAI` = 80%/55%, malformed JSON, missing groups, and a group with only weekly quota marking 5h disabled.

- [ ] **Step 2: Run tests and verify the parser is missing**

Run `npm test`.

Expected: FAIL because `parseAgyQuotaEnvelope` is undefined.

- [ ] **Step 3: Implement the structured parser**

Use only `command.data.groups` (with optional top-level `data` compatibility), clamp fractions to `[0,1]`, group on names containing `gemini` vs `claude|gpt|openai`, and construct `QuotaData` with disabled flags for absent windows. Do not parse the human `response` field.

- [ ] **Step 4: Implement binary discovery and hidden spawn**

Use discovery order:

```text
AGY_BIN
PATH
%LOCALAPPDATA%/agy/bin/agy.exe
~/.local/bin/agy
/usr/local/bin/agy
```

Spawn directly:

```ts
const child = spawn(binary, ['-p', slashCommand, '--output-format', 'json'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

Bound runtime to 12 seconds and bound stdout/stderr accumulation to 1 MiB each; kill the child if exceeded or timed out.

Attempt `/usage`, then `/quota` only when the first command is unavailable/unsupported/invalid-data. Auth/transient failures should return their classified error immediately so the orchestrator can continue to Cloud Code without trying a second equivalent slash command.

- [ ] **Step 5: Add CLI discovery cooldown**

Cache a missing binary result for 5 minutes. Cache an unsupported structured contract for the extension-host session keyed by binary path + `stat.mtimeMs`. `force=true` bypasses transient cooldowns but does not bypass an unchanged unsupported binary marker.

- [ ] **Step 6: Wire CLI as provider #1 and run tests**

In `providers/index.ts`, set default order beginning with `fetchAgyCli`.

Run:

```bash
npm test
npm run compile
```

Expected: exit `0`.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/telemetry/providers/agyCli.ts src/telemetry/providers/index.ts test/providers.test.cjs test/fixtures/agy-usage.json
git commit -m "feat: add extension agy quota provider"
```

---

### Task 5: Add VS Code credentials and direct Cloud Code provider

**Files:**
- Create: `src/telemetry/providers/credentials.ts`
- Create: `src/telemetry/providers/http.ts`
- Create: `src/telemetry/providers/cloudCode.ts`
- Modify: `src/telemetry/providers/index.ts`
- Modify: `test/providers.test.cjs`
- Create: `test/fixtures/cloud-load-code-assist.json`
- Create: `test/fixtures/cloud-retrieve-user-quota.json`
- Create: `test/fixtures/cloud-models.json`

**Interfaces:**
- Produces:
  - `findAgyBinary(): Promise<string | null>` shared/re-exported with CLI provider.
  - `parseCredentialJson(raw: string): AgyCredential`
  - `extractOauthClients(bytes: Buffer): Array<{ clientId: string; clientSecret: string }>`
  - `requestJson(options): Promise<unknown>`
  - `parseCloudCodeStatus(load, quota, models): FullStatus`
  - `fetchCloudCode(force: boolean): Promise<FullStatus>`
- Consumes: Node `fs/promises`, `child_process.spawn`, `https`, `ProviderError`.

- [ ] **Step 1: Write credential parsing tests**

Test both:

```json
{"refresh_token":"refresh-value","access_token":"access-value","expiry":4102444800000}
```

and:

```json
{"token":{"refresh_token":"refresh-value","access_token":"access-value","expiry_date":4102444800000}}
```

Also test `go-keyring-base64:` decoding and OAuth client discovery from a synthetic Buffer assembled at runtime so no secret-scanner-shaped literal is stored in the repository.

- [ ] **Step 2: Write Cloud Code fixture mapping tests**

Fixtures should prove:

- plan label/credits from `loadCodeAssist`
- Gemini meter from `retrieveUserQuota`
- shared Claude/OpenAI meter from `fetchAvailableModels`
- missing 5h or weekly windows are `disabled: true`, not copied from another meter
- numeric strings are accepted for credit amounts/fractions

- [ ] **Step 3: Run tests and verify missing modules fail**

Run `npm test`.

Expected: FAIL on missing credentials/cloud modules.

- [ ] **Step 4: Implement credential loading with hidden helpers**

Use direct spawn with `windowsHide: true` for all native helpers:

- Windows: PowerShell/CredRead target `gemini:antigravity`
- macOS: `security find-generic-password -s gemini -a antigravity -w`
- Linux: `secret-tool lookup service gemini username antigravity`
- fallback: `~/.gemini/oauth_creds.json`

Each helper gets a 5-second timeout and 1 MiB output cap. Parse credentials in memory only.

- [ ] **Step 5: Implement OAuth client discovery from the installed `agy` binary**

Use the same patterns as desktop:

```ts
const CLIENT_ID = /[0-9]{10,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com/g;
const CLIENT_SECRET = /GOCSPX-[A-Za-z0-9_-]{28}/g;
```

Read the binary once per process/path, deduplicate candidate pairs, and never include discovered values in error strings/logs.

- [ ] **Step 6: Implement bounded Node HTTPS JSON transport**

Create `requestJson()` over Node core `https.request` with:

- TLS verification on
- 10-second timeout
- 2 MiB response cap
- JSON body serialization
- response status classification
- error messages containing status/endpoint name only, never Authorization header/token/body secrets

- [ ] **Step 7: Implement OAuth refresh**

POST form-urlencoded to `https://oauth2.googleapis.com/token` with each discovered candidate pair until one succeeds. Keep access/rotated refresh token in memory only. Cache the working client pair in memory for the extension-host session; do not persist a secret file from the extension.

- [ ] **Step 8: Implement Cloud Code requests and parser**

Call:

```text
POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
POST https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
```

Use `Authorization: Bearer <access token>`, Antigravity-style metadata, and parser-only fixture functions. Preserve truthful window availability exactly as in the desktop implementation.

- [ ] **Step 9: Add credential/transient cooldowns and wire provider #2**

- missing keyring helper/credential: 60-second cooldown
- transient OAuth/Cloud Code failure: 20-second cooldown
- `force=true` bypasses transient cooldown only

Default provider order becomes:

```ts
[fetchAgyCli, fetchCloudCode, fetchLanguageServer]
```

with language-server import temporarily satisfied by the existing wrapper until Task 6.

- [ ] **Step 10: Run tests/compile**

Run:

```bash
npm test
npm run compile
```

Expected: exit `0` without live credentials/network.

- [ ] **Step 11: Commit Task 5**

```bash
git add src/telemetry/providers/credentials.ts src/telemetry/providers/http.ts src/telemetry/providers/cloudCode.ts src/telemetry/providers/index.ts test/providers.test.cjs test/fixtures/cloud-*.json
git commit -m "feat: add extension Cloud Code quota fallback"
```

---

### Task 6: Move existing VS Code language-server fetch behind provider #3

**Files:**
- Create: `src/telemetry/providers/languageServer.ts`
- Modify: `src/telemetry/process.ts`
- Modify: `src/telemetry/client.ts`
- Modify: `src/telemetry/providers/index.ts`
- Modify: `src/telemetry/index.ts`
- Modify: `src/ui/statusBar.ts`
- Modify: `test/providers.test.cjs`

**Interfaces:**
- Produces: `fetchLanguageServer(force: boolean): Promise<FullStatus>`.
- Consumes: existing `locateAntigravityBeacon()`, `detectActivePort()`, `queryServer()`, and `parseFullStatus()`.

- [ ] **Step 1: Write the final-order test**

Add a test asserting calls are exactly `cli`, `cloud`, `language` when first two fail, and `language` result is returned. Add an all-fail test asserting the final message is exactly:

```text
Antigravity quota unavailable. Sign in with agy or start Antigravity IDE.
```

- [ ] **Step 2: Run tests and verify provider #3 is not yet modularized**

Run `npm test`.

Expected: FAIL on the new language-server provider import/expectation.

- [ ] **Step 3: Wrap the existing language-server behavior**

Move the cache + discovery/query flow from old `src/telemetry/index.ts` into `providers/languageServer.ts`; continue to use `parseFullStatus(rawData, rawQuotaSummary)` so existing grouping semantics remain intact.

Do not change the local loopback HTTPS behavior (`rejectUnauthorized = false`) because it is limited to the local language server.

- [ ] **Step 4: Hide Windows discovery processes in the extension**

In `src/telemetry/process.ts`, add `windowsHide: true` to every `execAsync` options object, including PowerShell process discovery and port discovery:

```ts
{ timeout: 8000, windowsHide: true }
```

and:

```ts
{ timeout: 5000, windowsHide: true }
```

No terminal/UI shell should be opened for quota discovery.

- [ ] **Step 5: Replace source-specific status-bar error text**

In `src/ui/statusBar.ts`, replace:

```text
Language server not reachable.
```

with:

```text
Antigravity quota unavailable. Click to retry.
```

Keep last displayed status-bar value; update tooltip only.

- [ ] **Step 6: Run existing parser tests plus provider tests**

Run:

```bash
npm test
npm run compile
```

Expected: exit `0`.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/telemetry/providers/languageServer.ts src/telemetry/process.ts src/telemetry/client.ts src/telemetry/providers/index.ts src/telemetry/index.ts src/ui/statusBar.ts test/providers.test.cjs
git commit -m "feat: add language server as final extension fallback"
```

---

### Task 7: Align extension reset formatting and verify full cross-client behavior

**Files:**
- Modify: `src/telemetry/parser.ts`
- Modify: `test/parser.test.cjs`
- Modify: `README.md` if current usage wording states language-server-only requirements
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: abbreviated month output from extension `formatAbsoluteTime()` and `getRelativeTime()`.

- [ ] **Step 1: Add failing short-month parser tests**

In `test/parser.test.cjs`, use a future fixed timestamp and assert month names are abbreviated. Where timezone variability matters, derive expected month from `Date#getMonth()` and a short month table rather than hard-coding a timezone-dependent date.

Example assertion structure:

```js
const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const date = new Date('2030-09-11T03:18:00Z');
const output = parser.formatAbsoluteTime(date.toISOString());
assert.ok(output.includes(shortMonths[date.getMonth()]));
assert.ok(!output.includes('September'));
```

- [ ] **Step 2: Run parser tests and verify they fail**

Run `npm test`.

Expected: FAIL because `parser.ts` still uses full month names.

- [ ] **Step 3: Replace both extension month tables with abbreviations**

Use one shared constant in `src/telemetry/parser.ts`:

```ts
const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec',
];
```

Remove the second local full-month array inside `formatAbsoluteTime()` and reuse the module constant in both date formatting functions.

- [ ] **Step 4: Update docs/changelog without claiming unsupported behavior**

Document the provider order and that CLI-only users can be served by `agy` without a language server. Mention that direct Cloud Code is automatic fallback and language server remains compatibility fallback. Do not document tokens/keyring internals beyond a concise security note.

- [ ] **Step 5: Run all local/root verification commands**

Run:

```bash
npm ci
npm test
npm run compile

cd desktop-app
npm ci
npm run test:ui
npm run build

cd src-tauri
cargo test
cargo check --lib
```

Expected: every command exits `0`.

- [ ] **Step 6: Run Windows native verification**

On `windows-latest`:

```powershell
cd desktop-app/src-tauri
cargo check --lib
```

Expected: exit `0`, covering both Rust hidden-window helpers and Windows credential code.

- [ ] **Step 7: Run a manual/package build for all deliverables**

Use the repository's existing `Manual Build` workflow with all three inputs enabled:

```text
build_extension = true
build_windows   = true
build_linux     = true
```

Expected artifacts:

```text
extension-vsix
desktop-windows
desktop-linux
```

- [ ] **Step 8: Review the final diff against the spec**

Verify all acceptance criteria explicitly:

```text
[ ] desktop fixed at 680x380
[ ] no large quota-section blank expansion
[ ] desktop and extension show short months
[ ] desktop quota subprocesses hidden on Windows
[ ] extension quota subprocesses use windowsHide: true
[ ] extension provider order is CLI -> Cloud Code -> language server
[ ] missing windows remain unavailable
[ ] source-neutral failure copy
[ ] no token/client-secret logging
[ ] all tests/build checks green
```

- [ ] **Step 9: Commit final docs/test alignment**

```bash
git add src/telemetry/parser.ts test/parser.test.cjs README.md CHANGELOG.md
git commit -m "docs: document CLI-first quota fallback"
```
