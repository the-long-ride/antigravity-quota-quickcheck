import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FullStatus, QuotaData } from '../types';
import { ProviderError, ProviderErrorKind, isUsableStatus } from './types';

const PROVIDER = 'agy CLI';
const COMMAND_TIMEOUT_MS = 12_000;
const OUTPUT_LIMIT_BYTES = 1024 * 1024;
const MISSING_BINARY_TTL_MS = 5 * 60_000;

let missingBinaryUntil = 0;
let unsupportedContractKey: string | null = null;

interface WindowValue {
  percent: number;
  reset: string;
  present: boolean;
}

interface ProviderWindows {
  fiveHour: WindowValue;
  weekly: WindowValue;
}

function emptyWindow(): WindowValue {
  return { percent: 0, reset: '', present: false };
}

function emptyProviderWindows(): ProviderWindows {
  return { fiveHour: emptyWindow(), weekly: emptyWindow() };
}

function isFile(candidate: string | undefined | null): candidate is string {
  if (!candidate) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function findAgyBinary(): string | null {
  if (Date.now() < missingBinaryUntil) {
    return null;
  }

  const override = process.env.AGY_BIN;
  if (isFile(override)) {
    return override;
  }

  const executable = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const pathValue = process.env.PATH;
  if (pathValue) {
    for (const directory of pathValue.split(path.delimiter)) {
      if (!directory) continue;
      const candidate = path.join(directory, executable);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const candidate = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      if (isFile(candidate)) {
        return candidate;
      }
    }
  } else {
    const home = os.homedir();
    if (home) {
      const candidate = path.join(home, '.local', 'bin', 'agy');
      if (isFile(candidate)) {
        return candidate;
      }
    }
    if (isFile('/usr/local/bin/agy')) {
      return '/usr/local/bin/agy';
    }
  }

  missingBinaryUntil = Date.now() + MISSING_BINARY_TTL_MS;
  return null;
}

function binaryContractKey(binary: string): string {
  try {
    return `${binary}:${fs.statSync(binary).mtimeMs}`;
  } catch {
    return binary;
  }
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function remainingPercent(bucket: any): number | null {
  for (const key of ['remainingFraction', 'remaining_fraction']) {
    const value = numberValue(bucket?.[key]);
    if (value !== null) {
      return Math.round(Math.max(0, Math.min(1, value)) * 100);
    }
  }

  for (const key of [
    'percentRemaining',
    'percent_remaining',
    'remainingPercent',
    'remaining_percent',
  ]) {
    const value = numberValue(bucket?.[key]);
    if (value !== null) {
      return Math.round(Math.max(0, Math.min(100, value)));
    }
  }

  return null;
}

function resetTime(bucket: any): string {
  const value = bucket?.resetTime ?? bucket?.reset_time;
  return typeof value === 'string' ? value : '';
}

function windowName(bucket: any): string {
  const value = bucket?.window ?? bucket?.name ?? bucket?.label ?? bucket?.duration;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isFiveHourWindow(window: string): boolean {
  const compact = window.replace(/[\s_-]/g, '');
  return compact === '5h' || compact.includes('5hour') || compact.includes('fivehour');
}

function isWeeklyWindow(window: string): boolean {
  const compact = window.replace(/[\s_-]/g, '');
  return compact.includes('week') || compact === '7d';
}

function assignWindow(slot: WindowValue, percent: number, reset: string): void {
  if (!slot.present || percent < slot.percent) {
    slot.percent = percent;
    slot.reset = reset;
    slot.present = true;
  }
}

function buildCard(model: string, windows: ProviderWindows): QuotaData {
  const legacy = windows.fiveHour.present
    ? windows.fiveHour
    : windows.weekly.present
      ? windows.weekly
      : emptyWindow();

  return {
    model,
    percent: legacy.percent,
    refreshTime: legacy.reset,
    fiveHourPercent: windows.fiveHour.percent,
    fiveHourReset: windows.fiveHour.reset,
    fiveHourDisabled: !windows.fiveHour.present,
    weeklyPercent: windows.weekly.percent,
    weeklyReset: windows.weekly.reset,
    weeklyDisabled: !windows.weekly.present,
  };
}

export function parseAgyQuotaEnvelope(raw: string): FullStatus {
  let root: any;
  try {
    root = JSON.parse(raw);
  } catch {
    throw new ProviderError(
      PROVIDER,
      'invalid-data',
      'quota output was not valid JSON',
    );
  }

  const data = root?.command?.data ?? root?.data;
  if (!data || !Array.isArray(data.groups)) {
    throw new ProviderError(
      PROVIDER,
      'invalid-data',
      'quota JSON did not contain structured groups',
    );
  }

  const gemini = emptyProviderWindows();
  const shared = emptyProviderWindows();
  let sawRecognizedGroup = false;

  for (const group of data.groups) {
    const rawName = group?.name ?? group?.displayName ?? '';
    const name = typeof rawName === 'string' ? rawName.toLowerCase() : '';

    let target: ProviderWindows | null = null;
    if (name.includes('gemini')) {
      target = gemini;
      sawRecognizedGroup = true;
    } else if (
      name.includes('claude') ||
      name.includes('gpt') ||
      name.includes('openai')
    ) {
      target = shared;
      sawRecognizedGroup = true;
    }

    if (!target || !Array.isArray(group?.buckets)) continue;

    for (const bucket of group.buckets) {
      const percent = remainingPercent(bucket);
      if (percent === null) continue;
      const reset = resetTime(bucket);
      const window = windowName(bucket);
      if (isFiveHourWindow(window)) {
        assignWindow(target.fiveHour, percent, reset);
      } else if (isWeeklyWindow(window)) {
        assignWindow(target.weekly, percent, reset);
      }
    }
  }

  if (!sawRecognizedGroup) {
    throw new ProviderError(
      PROVIDER,
      'invalid-data',
      'quota JSON contained no recognized provider groups',
    );
  }

  const tierCandidate = data.planTier ?? data.plan_tier ?? data.tier;
  const planTier = typeof tierCandidate === 'string' && tierCandidate
    ? tierCandidate
    : null;

  return {
    credits: null,
    quotas: [
      buildCard('Gemini', gemini),
      buildCard('Claude & OpenAI', shared),
    ],
    recentlyUsedModel: null,
    planTier,
  };
}

function classifyFailure(text: string): ProviderErrorKind {
  const lower = text.toLowerCase();
  if (
    lower.includes('login') ||
    lower.includes('sign in') ||
    lower.includes('sign-in') ||
    lower.includes('auth') ||
    lower.includes('credential')
  ) {
    return 'auth';
  }
  if (
    lower.includes('unknown command') ||
    lower.includes('unexpected arguments') ||
    lower.includes('flags provided but not defined') ||
    lower.includes('unknown flag') ||
    lower.includes('not defined')
  ) {
    return 'unsupported';
  }
  if (
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('connection') ||
    lower.includes('temporar')
  ) {
    return 'transient';
  }
  return 'unsupported';
}

function runStructuredCommand(binary: string, slashCommand: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      ['-p', slashCommand, '--output-format', 'json'],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finishReject = (error: ProviderError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill();
      finishReject(
        new ProviderError(PROVIDER, 'transient', 'agy quota command timed out'),
      );
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > OUTPUT_LIMIT_BYTES) {
        child.kill();
        finishReject(
          new ProviderError(PROVIDER, 'invalid-data', 'agy stdout exceeded output limit'),
        );
        return;
      }
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (stderrBytes > OUTPUT_LIMIT_BYTES) {
        child.kill();
        finishReject(
          new ProviderError(PROVIDER, 'invalid-data', 'agy stderr exceeded output limit'),
        );
        return;
      }
      stderr += chunk.toString('utf8');
    });

    child.on('error', () => {
      finishReject(
        new ProviderError(PROVIDER, 'unavailable', 'failed to start agy'),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        if (!stdout.trim()) {
          reject(
            new ProviderError(
              PROVIDER,
              'invalid-data',
              'agy returned empty structured output',
            ),
          );
          return;
        }
        resolve(stdout);
        return;
      }

      const kind = classifyFailure(`${stderr} ${stdout}`);
      reject(
        new ProviderError(
          PROVIDER,
          kind,
          `agy could not run structured ${slashCommand}`,
        ),
      );
    });
  });
}

export async function fetchAgyCli(force: boolean): Promise<FullStatus> {
  void force;

  const binary = findAgyBinary();
  if (!binary) {
    throw new ProviderError(PROVIDER, 'unavailable', 'agy executable was not found');
  }

  const contractKey = binaryContractKey(binary);
  if (unsupportedContractKey === contractKey) {
    throw new ProviderError(
      PROVIDER,
      'unsupported',
      'installed agy does not expose structured quota output',
    );
  }

  let lastError: ProviderError | null = null;
  for (const slashCommand of ['/usage', '/quota']) {
    try {
      const stdout = await runStructuredCommand(binary, slashCommand);
      const status = parseAgyQuotaEnvelope(stdout);
      if (isUsableStatus(status)) {
        return status;
      }
      lastError = new ProviderError(
        PROVIDER,
        'invalid-data',
        'agy returned an empty quota snapshot',
      );
    } catch (error) {
      const providerError = error instanceof ProviderError
        ? error
        : new ProviderError(PROVIDER, 'unsupported', 'agy quota command failed');
      if (providerError.kind === 'auth' || providerError.kind === 'transient') {
        throw providerError;
      }
      lastError = providerError;
    }
  }

  if (
    lastError?.kind === 'unsupported' ||
    lastError?.kind === 'invalid-data'
  ) {
    unsupportedContractKey = contractKey;
  }

  throw lastError ?? new ProviderError(
    PROVIDER,
    'unsupported',
    'agy did not expose a structured quota command',
  );
}
