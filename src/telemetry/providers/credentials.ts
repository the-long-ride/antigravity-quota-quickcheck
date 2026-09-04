import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findAgyBinary } from './agyCli';
import { ProviderError } from './types';

const PROVIDER = 'agy credentials';
const KEYRING_TIMEOUT_MS = 5_000;
const OUTPUT_LIMIT_BYTES = 1024 * 1024;

export interface AgyCredential {
  accessToken: string | null;
  refreshToken: string;
  expiryMs: number | null;
}

export interface OauthClient {
  clientId: string;
  clientSecret: string;
}

function parseExpiryMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function decodeKeyringSecret(raw: string): string {
  const trimmed = raw.trim();
  const prefix = 'go-keyring-base64:';
  if (!trimmed.startsWith(prefix)) {
    return trimmed;
  }

  const encoded = trimmed.slice(prefix.length);
  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw new ProviderError(
      PROVIDER,
      'invalid-data',
      'keyring credential could not be decoded',
    );
  }
}

export function parseCredentialJson(raw: string): AgyCredential {
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProviderError(
      PROVIDER,
      'invalid-data',
      'credential payload is not valid JSON',
    );
  }

  const token = value?.token && typeof value.token === 'object'
    ? value.token
    : value;
  const refreshToken = typeof token?.refresh_token === 'string'
    ? token.refresh_token.trim()
    : '';
  if (!refreshToken) {
    throw new ProviderError(
      PROVIDER,
      'auth',
      'agy credential has no refresh token',
    );
  }

  const accessToken = typeof token?.access_token === 'string' && token.access_token.trim()
    ? token.access_token
    : null;
  const expiryMs = parseExpiryMs(token?.expiry ?? token?.expiry_date);

  return { accessToken, refreshToken, expiryMs };
}

export function extractOauthClients(bytes: Buffer): OauthClient[] {
  const text = bytes.toString('latin1');
  const clientIds = text.match(/[0-9]{10,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com/g) ?? [];
  const clientSecrets = text.match(/GOCSPX-[A-Za-z0-9_-]{28}/g) ?? [];
  const seen = new Set<string>();
  const candidates: OauthClient[] = [];

  for (const clientId of clientIds) {
    for (const clientSecret of clientSecrets) {
      const key = `${clientId}\0${clientSecret}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ clientId, clientSecret });
    }
  }

  return candidates;
}

function runBoundedHelper(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let output = '';
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new ProviderError(PROVIDER, 'transient', 'native keyring lookup timed out'));
    }, KEYRING_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT_BYTES) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new ProviderError(PROVIDER, 'invalid-data', 'native keyring output exceeded limit'));
        return;
      }
      output += chunk.toString('utf8');
    });

    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProviderError(PROVIDER, 'unavailable', 'native keyring helper is unavailable'));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 || !output.trim()) {
        reject(new ProviderError(PROVIDER, 'unavailable', 'native keyring credential was not found'));
        return;
      }
      resolve(output);
    });
  });
}

function windowsCredentialScript(): string {
  return `
$ErrorActionPreference='Stop'
$src=@'
using System;
using System.Runtime.InteropServices;
public static class AgyCred {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  public static byte[] Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try { var c=(CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL)); var b=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,b,0,b.Length); return b; } finally { CredFree(ptr); }
  }
}
'@
Add-Type -TypeDefinition $src | Out-Null
$b=[AgyCred]::Read('gemini:antigravity')
if ($null -eq $b) { exit 3 }
[Console]::OutputEncoding=[Text.Encoding]::UTF8
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))
`;
}

async function readNativeKeyring(): Promise<string> {
  if (process.platform === 'win32') {
    const script = windowsCredentialScript();
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return runBoundedHelper('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encoded,
    ]);
  }

  if (process.platform === 'darwin') {
    return runBoundedHelper('security', [
      'find-generic-password',
      '-s',
      'gemini',
      '-a',
      'antigravity',
      '-w',
    ]);
  }

  return runBoundedHelper('secret-tool', [
    'lookup',
    'service',
    'gemini',
    'username',
    'antigravity',
  ]);
}

export async function loadAgyCredential(): Promise<AgyCredential> {
  try {
    const secret = await readNativeKeyring();
    return parseCredentialJson(decodeKeyringSecret(secret));
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'invalid-data') {
      throw error;
    }
  }

  const fallback = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
  try {
    const raw = await fs.promises.readFile(fallback, 'utf8');
    return parseCredentialJson(raw);
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    throw new ProviderError(
      PROVIDER,
      'unavailable',
      'agy credential was not found',
    );
  }
}

export async function readOauthClientsFromAgy(): Promise<OauthClient[]> {
  const binary = findAgyBinary();
  if (!binary) {
    throw new ProviderError(
      PROVIDER,
      'unavailable',
      'agy executable was not found for OAuth client discovery',
    );
  }

  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(binary);
  } catch {
    throw new ProviderError(
      PROVIDER,
      'unavailable',
      'agy executable could not be read',
    );
  }

  const candidates = extractOauthClients(bytes);
  if (candidates.length === 0) {
    throw new ProviderError(
      PROVIDER,
      'unsupported',
      'agy OAuth client metadata could not be discovered',
    );
  }
  return candidates;
}
