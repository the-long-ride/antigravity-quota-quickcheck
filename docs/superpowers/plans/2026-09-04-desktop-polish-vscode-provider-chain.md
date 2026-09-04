# Desktop Polish and VS Code Provider Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact the desktop tray UI, abbreviate reset dates, hide quota helper windows on Windows, and make the VS Code extension fetch quota through `agy CLI -> Cloud Code -> language server`.

**Architecture:** Keep the desktop UI-facing status contract unchanged. For VS Code, add provider modules behind the existing `fetchFullStatus()` API; build and test each provider independently first, then integrate the final ordered chain in one task so every intermediate commit still compiles and tests cleanly.

**Tech Stack:** TypeScript/Node 18, VS Code API `^1.80.0`, Node core `child_process`/`https`, Rust/Tokio/Tauri 2, `reqwest`, `serde_json`, Node built-in tests, Cargo tests/checks.

**Spec:** `docs/superpowers/specs/2026-09-04-desktop-polish-vscode-provider-chain-design.md`

## Global Constraints

- Desktop window is exactly `680x380`.
- Reset dates use abbreviated months (`Sep`, `Oct`, etc.); raw timestamps stay unchanged.
- Windows quota-only subprocesses are hidden; updater/installer processes are not affected.
- VS Code provider order is exactly `agy CLI -> Cloud Code -> language server`.
- `agy` uses structured JSON from `/usage`, with `/quota` compatibility fallback; never parse the human table output.
- Cloud Code uses existing `agy` credentials; never hard-code or log OAuth tokens/client secrets.
- Missing 5h/weekly windows remain unavailable rather than being copied/invented.
- VS Code keeps the current `FullStatus` / `QuotaData` contract.
- No new HTTP dependency for the extension; use Node core `https`.
- Subprocesses and HTTP requests are timeout- and size-bounded.
- Extension compile/tests, Linux Rust tests/checks, Windows Rust check, and final package builds must pass.

---

### Task 1: Compact desktop window and shorten reset dates

**Files:**
- Modify: `desktop-app/src-tauri/tauri.conf.json`
- Modify: `desktop-app/src-tauri/src/lib.rs`
- Modify: `desktop-app/src/main.ts`
- Modify: `desktop-app/src/styles.css`
- Create: `desktop-app/scripts/verify-ui-contract.cjs`
- Modify: `desktop-app/package.json`

**Interfaces:**
- Consumes: Tauri `main` window and existing desktop `formatAbsoluteTime()`.
- Produces: fixed `680x380` window, correct tray positioning, short-month labels.

- [ ] **Step 1: Add a failing UI contract test**

Create `desktop-app/scripts/verify-ui-contract.cjs`:

```js
const fs = require('node:fs');
const assert = require('node:assert/strict');

const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const main = config.app.windows.find((w) => w.label === 'main');
assert.equal(main.width, 680);
assert.equal(main.height, 380);

const mainTs = fs.readFileSync('src/main.ts', 'utf8');
assert.ok(mainTs.includes('"Sep"'));
assert.ok(!mainTs.includes('"September"'));

const styles = fs.readFileSync('src/styles.css', 'utf8');
assert.match(styles, /\.quotas-section[\s\S]*?flex:\s*0\s+1\s+auto/);
```

Add to `desktop-app/package.json`:

```json
"test:ui": "node scripts/verify-ui-contract.cjs"
```

- [ ] **Step 2: Run the test and verify RED**

```bash
cd desktop-app
npm run test:ui
```

Expected: FAIL because height is `650`, month names are full, and the quota section still stretches.

- [ ] **Step 3: Set exact desktop size and intrinsic quota section height**

In `tauri.conf.json`:

```json
"width": 680,
"height": 380
```

In `styles.css`:

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

- [ ] **Step 4: Make tray positioning use the actual outer size**

Replace the hard-coded `680/650` in `position_window()` with `window.outer_size()`, with a `680x380` fallback:

```rust
let fallback_w = (680.0 * scale_factor) as u32;
let fallback_h = (380.0 * scale_factor) as u32;
let size = window
    .outer_size()
    .unwrap_or(tauri::PhysicalSize::new(fallback_w, fallback_h));
```

Use `size.width` / `size.height` for `x` / `y` calculations.

- [ ] **Step 5: Replace desktop month names with abbreviations**

In `desktop-app/src/main.ts`:

```ts
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
```

Keep same-day output unchanged and non-current-day output shaped as:

```text
Resets at: Sep 11, 10:18 AM
```

- [ ] **Step 6: Run GREEN verification**

```bash
cd desktop-app
npm run test:ui
npm run build
```

Expected: both exit `0`.

- [ ] **Step 7: Commit**

```bash
git add desktop-app/src-tauri/tauri.conf.json desktop-app/src-tauri/src/lib.rs desktop-app/src/main.ts desktop-app/src/styles.css desktop-app/scripts/verify-ui-contract.cjs desktop-app/package.json
git commit -m "fix: compact desktop quota panel"
```

---

### Task 2: Hide desktop quota helper windows on Windows

**Files:**
- Create: `desktop-app/src-tauri/src/quota/process.rs`
- Modify: `desktop-app/src-tauri/src/quota/mod.rs`
- Modify: `desktop-app/src-tauri/src/quota/agy_cli.rs`
- Modify: `desktop-app/src-tauri/src/quota/credentials.rs`
- Modify: `desktop-app/src-tauri/src/quota/language_server.rs`
- Modify: `desktop-app/src-tauri/tests/quota_sources.rs`

**Interfaces:**
- Produces: `hide_window(&mut tokio::process::Command)` and `hide_std_window(&mut std::process::Command)`.

- [ ] **Step 1: Write a failing process-helper test**

Add:

```rust
#[test]
fn create_no_window_flag_is_correct() {
    assert_eq!(tauri_app_lib::quota::process::CREATE_NO_WINDOW_FLAG, 0x0800_0000);
}
```

- [ ] **Step 2: Verify RED**

```bash
cd desktop-app/src-tauri
cargo test create_no_window_flag_is_correct
```

Expected: FAIL because `quota::process` does not exist.

- [ ] **Step 3: Add the shared helper**

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

Add `pub mod process;` to `quota/mod.rs`.

- [ ] **Step 4: Apply it to all desktop quota subprocesses**

Apply `hide_window()` to:

- `agy_cli.rs` before running `agy`
- `credentials.rs` inside `run_keyring_command()`

Apply `hide_std_window()` to every PowerShell/`sh`/`lsof`/`ss` process builder in `language_server.rs`.

Do not change `lib.rs::execute_update()`.

- [ ] **Step 5: Verify Linux and Windows compilation**

Linux:

```bash
cd desktop-app/src-tauri
cargo test
cargo check --lib
```

Windows runner:

```powershell
cd desktop-app/src-tauri
cargo check --lib
```

Expected: all exit `0`.

- [ ] **Step 6: Commit**

```bash
git add desktop-app/src-tauri/src/quota/process.rs desktop-app/src-tauri/src/quota/mod.rs desktop-app/src-tauri/src/quota/agy_cli.rs desktop-app/src-tauri/src/quota/credentials.rs desktop-app/src-tauri/src/quota/language_server.rs desktop-app/src-tauri/tests/quota_sources.rs
git commit -m "fix: hide desktop quota helper windows"
```

---

### Task 3: Add provider primitives and independently testable `agy` provider for VS Code

**Files:**
- Create: `src/telemetry/providers/types.ts`
- Create: `src/telemetry/providers/index.ts`
- Create: `src/telemetry/providers/agyCli.ts`
- Modify: `package.json`
- Create: `test/providers.test.cjs`
- Create: `test/fixtures/agy-usage.json`

**Interfaces:**
- Produces:
  - `ProviderErrorKind`
  - `ProviderError`
  - `ProviderFetch = (force: boolean) => Promise<FullStatus>`
  - `runProviderChain(force, providers)` for injected tests
  - `parseAgyQuotaEnvelope(raw)`
  - `findAgyBinary()`
  - `fetchAgyCli(force)`
- Does not alter production `fetchFullStatus()` yet, so this task compiles independently.

- [ ] **Step 1: Expand test runner**

Change root `package.json`:

```json
"test": "npm run compile && node --test test/*.test.cjs"
```

- [ ] **Step 2: Add failing provider-chain tests**

In `test/providers.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { runProviderChain, ProviderError } = require('../out/telemetry/providers');

const good = {
  credits: null,
  quotas: [{
    model: 'Gemini', percent: 50, refreshTime: '',
    fiveHourPercent: 50, fiveHourReset: '', fiveHourDisabled: false,
    weeklyPercent: 75, weeklyReset: '', weeklyDisabled: false,
  }],
  recentlyUsedModel: 'Gemini', planTier: null,
};

test('first successful provider stops the chain', async () => {
  const calls = [];
  const result = await runProviderChain(false, [
    async () => { calls.push('a'); return good; },
    async () => { calls.push('b'); throw new Error('must not run'); },
  ]);
  assert.equal(result, good);
  assert.deepEqual(calls, ['a']);
});

test('unavailable provider falls through', async () => {
  const calls = [];
  const result = await runProviderChain(false, [
    async () => { calls.push('a'); throw new ProviderError('a', 'unavailable', 'missing'); },
    async () => { calls.push('b'); return good; },
  ]);
  assert.equal(result, good);
  assert.deepEqual(calls, ['a', 'b']);
});
```

Also test an empty status falls through and all failures produce a source-neutral error.

- [ ] **Step 3: Add failing `agy` fixture tests**

Create `test/fixtures/agy-usage.json` with `command.data.groups` containing:

- `Gemini Models`: `5h=1.0`, `weekly=0.72`
- `Claude and GPT models`: `5h=0.80`, `weekly=0.55`

Assert normalized cards are:

```text
Gemini            5h 100% / weekly 72%
Claude & OpenAI   5h 80%  / weekly 55%
```

Also test malformed JSON, missing groups, and a weekly-only group marking 5h unavailable.

- [ ] **Step 4: Verify RED**

```bash
npm test
```

Expected: FAIL because provider modules are missing.

- [ ] **Step 5: Implement provider primitives**

Create `providers/types.ts`:

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

Create `providers/index.ts` exposing only the injected chain for now:

```ts
import { FullStatus } from '../types';
import { ProviderError, ProviderFetch, isUsableStatus } from './types';

export { ProviderError } from './types';

export async function runProviderChain(force: boolean, providers: ProviderFetch[]): Promise<FullStatus> {
  for (const provider of providers) {
    try {
      const status = await provider(force);
      if (isUsableStatus(status)) return status;
    } catch {
      // Continue. User-facing detail is produced only after every provider fails.
    }
  }
  throw new Error('Antigravity quota unavailable. Sign in with agy or start Antigravity IDE.');
}
```

- [ ] **Step 6: Implement `agy` parsing and execution**

In `agyCli.ts`:

- binary discovery order: `AGY_BIN`, `PATH`, `%LOCALAPPDATA%/agy/bin/agy.exe`, `~/.local/bin/agy`, `/usr/local/bin/agy`
- direct `spawn`, never shell interpolation
- `windowsHide: true`
- args: `['-p', '/usage', '--output-format', 'json']`, then `/quota` only for unavailable/unsupported/invalid-data
- 12-second timeout
- 1 MiB cap each for stdout/stderr
- parse only `command.data.groups` (top-level `data.groups` compatibility allowed), never human `response`
- clamp fractions to `[0,1]`
- absent 5h/weekly field sets corresponding `Disabled=true`

Spawn shape:

```ts
spawn(binary, ['-p', slashCommand, '--output-format', 'json'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

Cache missing binary for 5 minutes and an unsupported contract for the session keyed by binary path + `stat.mtimeMs`.

- [ ] **Step 7: Verify GREEN**

```bash
npm test
npm run compile
```

Expected: both exit `0`; production extension behavior is still language-server-only at this checkpoint.

- [ ] **Step 8: Commit**

```bash
git add src/telemetry/providers package.json test/providers.test.cjs test/fixtures/agy-usage.json
git commit -m "feat: add extension agy quota provider"
```

---

### Task 4: Add independently testable VS Code credential and Cloud Code provider

**Files:**
- Create: `src/telemetry/providers/credentials.ts`
- Create: `src/telemetry/providers/http.ts`
- Create: `src/telemetry/providers/cloudCode.ts`
- Modify: `test/providers.test.cjs`
- Create: `test/fixtures/cloud-load-code-assist.json`
- Create: `test/fixtures/cloud-retrieve-user-quota.json`
- Create: `test/fixtures/cloud-models.json`

**Interfaces:**
- Consumes: `findAgyBinary()` from `agyCli.ts`, provider errors/types.
- Produces:
  - `parseCredentialJson(raw)`
  - `extractOauthClients(bytes)`
  - `requestJson(...)`
  - `parseCloudCodeStatus(load, quota, models)`
  - `fetchCloudCode(force)`
- Still not wired into production `fetchFullStatus()` until Task 5.

- [ ] **Step 1: Write credential tests**

Cover both credential shapes:

```json
{"refresh_token":"refresh-value","access_token":"access-value","expiry":4102444800000}
```

```json
{"token":{"refresh_token":"refresh-value","access_token":"access-value","expiry_date":4102444800000}}
```

Also test `go-keyring-base64:` decoding and OAuth client extraction from a Buffer assembled at runtime so secret scanning does not see credential-shaped fixture literals.

- [ ] **Step 2: Write Cloud Code parser tests**

Fixtures must prove:

- plan tier/credits from `loadCodeAssist`
- Gemini quota from `retrieveUserQuota`
- Claude/OpenAI shared meter from `fetchAvailableModels`
- numeric-string fields are accepted
- absent 5h/weekly fields remain disabled instead of being copied from another pool

- [ ] **Step 3: Verify RED**

```bash
npm test
```

Expected: FAIL because credential/Cloud Code modules are missing.

- [ ] **Step 4: Implement native credential loading**

Credential priority:

```text
Windows: gemini:antigravity via PowerShell/CredRead
macOS:   security find-generic-password -s gemini -a antigravity -w
Linux:   secret-tool lookup service gemini username antigravity
fallback ~/.gemini/oauth_creds.json
```

All helper processes use:

```ts
{ windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
```

Bound each helper to 5 seconds / 1 MiB output. Keep credentials in extension-host memory only.

- [ ] **Step 5: Implement runtime OAuth-client discovery**

Read the installed `agy` binary and find candidates with:

```ts
/[0-9]{10,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com/g
/GOCSPX-[A-Za-z0-9_-]{28}/g
```

Deduplicate candidate pairs and never print candidate values in errors/logs.

- [ ] **Step 6: Implement bounded Node HTTPS transport**

`http.ts` uses `https.request` with:

- normal TLS validation
- 10-second timeout
- 2 MiB response cap
- JSON serialization/parsing
- status/endpoint-only errors; Authorization/token content never included

- [ ] **Step 7: Implement OAuth refresh and Cloud Code calls**

OAuth endpoint:

```text
POST https://oauth2.googleapis.com/token
```

Cloud Code endpoints:

```text
POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
POST https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
```

Use `Authorization: Bearer <access token>` and Antigravity-style request metadata. Cache the working OAuth client pair in memory only. If refresh returns a rotated refresh token, use it in memory for the current extension-host session.

- [ ] **Step 8: Add Cloud Code cooldowns**

- missing credential/helper: 60 seconds
- transient OAuth/Cloud Code failure: 20 seconds
- `force=true` bypasses transient cooldown, not a known missing credential until its cooldown expires

- [ ] **Step 9: Verify GREEN**

```bash
npm test
npm run compile
```

Expected: exit `0`; production extension is still unchanged at this checkpoint.

- [ ] **Step 10: Commit**

```bash
git add src/telemetry/providers/credentials.ts src/telemetry/providers/http.ts src/telemetry/providers/cloudCode.ts test/providers.test.cjs test/fixtures/cloud-*.json
git commit -m "feat: add extension Cloud Code quota provider"
```

---

### Task 5: Integrate VS Code provider order and move language server behind provider #3

**Files:**
- Create: `src/telemetry/providers/languageServer.ts`
- Modify: `src/telemetry/providers/index.ts`
- Modify: `src/telemetry/index.ts`
- Modify: `src/telemetry/process.ts`
- Modify: `src/ui/statusBar.ts`
- Modify: `test/providers.test.cjs`

**Interfaces:**
- Produces:
  - `fetchLanguageServer(force)`
  - `fetchFromProviders(force)` with exact order `[fetchAgyCli, fetchCloudCode, fetchLanguageServer]`
  - one shared in-flight `fetchFullStatus()` promise
- Preserves public `fetchFullStatus(force)` API.

- [ ] **Step 1: Add failing exact-order tests**

Add injected-chain assertions for:

```text
CLI success                  -> calls [cli]
CLI fail, Cloud success      -> calls [cli, cloud]
CLI + Cloud fail, LS success -> calls [cli, cloud, language]
all fail                     -> source-neutral final message
```

Also test that two concurrent `fetchFullStatus()` calls share one provider execution using an injected/deferred promise seam.

- [ ] **Step 2: Verify RED**

```bash
npm test
```

Expected: FAIL because production orchestration/language provider are not yet integrated.

- [ ] **Step 3: Move current language-server flow into `providers/languageServer.ts`**

Move the cache/discovery/query logic currently in `src/telemetry/index.ts` behind:

```ts
export async function fetchLanguageServer(_force: boolean): Promise<FullStatus>
```

Keep using existing `locateAntigravityBeacon()`, `detectActivePort()`, `queryServer()`, and `parseFullStatus()` so behavior remains unchanged.

- [ ] **Step 4: Hide extension language-server discovery subprocesses**

In `src/telemetry/process.ts`, every `execAsync` option object gets `windowsHide: true`:

```ts
{ timeout: 8000, windowsHide: true }
```

or:

```ts
{ timeout: 5000, windowsHide: true }
```

- [ ] **Step 5: Wire exact provider order**

In `providers/index.ts`:

```ts
import { fetchAgyCli } from './agyCli';
import { fetchCloudCode } from './cloudCode';
import { fetchLanguageServer } from './languageServer';

export function fetchFromProviders(force: boolean): Promise<FullStatus> {
  return runProviderChain(force, [fetchAgyCli, fetchCloudCode, fetchLanguageServer]);
}
```

- [ ] **Step 6: Refactor public `fetchFullStatus()` to one in-flight promise**

In `src/telemetry/index.ts`:

```ts
let cachedStatus: FullStatus | null = null;
let inFlight: Promise<FullStatus> | null = null;

export async function fetchFullStatus(force = false): Promise<FullStatus> {
  if (inFlight) return inFlight;

  inFlight = fetchFromProviders(force)
    .then((status) => {
      if (status.quotas.length > 0) {
        status.recentlyUsedModel = status.quotas[0].model;
      }
      cachedStatus = status;
      return status;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
```

Do not clear `cachedStatus` on individual provider failure.

- [ ] **Step 7: Replace language-server-specific error copy**

In `src/ui/statusBar.ts`, replace `Language server not reachable.` with:

```text
Antigravity quota unavailable. Click to retry.
```

Keep the existing status-bar value on failure; update tooltip only.

- [ ] **Step 8: Verify GREEN**

```bash
npm test
npm run compile
```

Expected: exit `0` and exact fallback order proven by tests.

- [ ] **Step 9: Commit**

```bash
git add src/telemetry/providers/languageServer.ts src/telemetry/providers/index.ts src/telemetry/index.ts src/telemetry/process.ts src/ui/statusBar.ts test/providers.test.cjs
git commit -m "feat: use three-layer quota fallback in extension"
```

---

### Task 6: Align extension reset formatting, docs, and full verification

**Files:**
- Modify: `src/telemetry/parser.ts`
- Modify: `test/parser.test.cjs`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: extension reset labels with short months matching desktop.

- [ ] **Step 1: Add failing parser test for abbreviated month**

In `test/parser.test.cjs`:

```js
const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const future = new Date('2030-09-11T03:18:00Z');
const formatted = parser.formatAbsoluteTime(future.toISOString());
assert.ok(formatted.includes(shortMonths[future.getMonth()]));
assert.ok(!formatted.includes('September'));
```

- [ ] **Step 2: Verify RED**

```bash
npm test
```

Expected: FAIL because extension parser still uses full month names.

- [ ] **Step 3: Use one shared short-month table in `parser.ts`**

```ts
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
```

Use the same table in both `getRelativeTime()` and `formatAbsoluteTime()`; remove the local full-month duplicate.

- [ ] **Step 4: Update README and changelog**

Document only externally useful behavior:

```text
Quota source priority: agy CLI -> direct Cloud Code -> Antigravity language server.
CLI-only users do not need a running Antigravity language server when agy is signed in.
```

Mention background quota subprocesses are hidden on Windows and reset months are abbreviated. Do not expose OAuth implementation secrets.

- [ ] **Step 5: Run full local verification**

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

- [ ] **Step 6: Run Windows native Rust verification**

On `windows-latest`:

```powershell
cd desktop-app/src-tauri
cargo check --lib
```

Expected: exit `0`.

- [ ] **Step 7: Trigger the existing manual build workflow with all outputs**

Inputs:

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

- [ ] **Step 8: Final spec checklist**

```text
[ ] 680x380 desktop window
[ ] no large blank quota area
[ ] short reset months on desktop and extension
[ ] no visible Windows quota subprocess windows
[ ] extension order CLI -> Cloud Code -> language server
[ ] missing windows remain unavailable
[ ] source-neutral final error copy
[ ] no credentials/tokens/client secrets logged
[ ] extension tests/compile pass
[ ] Linux Rust tests/check pass
[ ] Windows Rust check passes
[ ] all three build artifacts produced
```

- [ ] **Step 9: Commit**

```bash
git add src/telemetry/parser.ts test/parser.test.cjs README.md CHANGELOG.md
git commit -m "docs: document CLI-first quota fallback"
```
