const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('src/telemetry/process.ts', 'utf8');

test('Windows refresh process discovery launches PowerShell directly and hidden', () => {
  assert.match(source, /execFile/);
  assert.match(source, /powershell\.exe/);
  assert.match(source, /-NonInteractive/);
  assert.match(source, /windowsHide:\s*true/);
  assert.doesNotMatch(source, /execAsync\(\s*['"`]powershell/);
});
