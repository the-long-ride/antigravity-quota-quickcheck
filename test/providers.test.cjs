const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { runProviderChain, ProviderError } = require('../out/telemetry/providers');
const { parseAgyQuotaEnvelope } = require('../out/telemetry/providers/agyCli');

const good = {
  credits: null,
  quotas: [{
    model: 'Gemini',
    percent: 50,
    refreshTime: '',
    fiveHourPercent: 50,
    fiveHourReset: '',
    fiveHourDisabled: false,
    weeklyPercent: 75,
    weeklyReset: '',
    weeklyDisabled: false,
  }],
  recentlyUsedModel: 'Gemini',
  planTier: null,
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

test('empty status falls through', async () => {
  const calls = [];
  const result = await runProviderChain(false, [
    async () => {
      calls.push('a');
      return { credits: null, quotas: [], recentlyUsedModel: null, planTier: null };
    },
    async () => { calls.push('b'); return good; },
  ]);
  assert.equal(result, good);
  assert.deepEqual(calls, ['a', 'b']);
});

test('all provider failures return source-neutral guidance', async () => {
  await assert.rejects(
    () => runProviderChain(false, [
      async () => { throw new ProviderError('agy CLI', 'unavailable', 'missing'); },
      async () => { throw new ProviderError('Cloud Code', 'auth', 'expired'); },
    ]),
    (error) => {
      assert.match(error.message, /Antigravity quota unavailable/i);
      assert.match(error.message, /Sign in with agy or start Antigravity IDE/i);
      assert.doesNotMatch(error.message, /Cloud Code|language server|expired/i);
      return true;
    },
  );
});

test('agy usage fixture normalizes provider groups', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'agy-usage.json'), 'utf8');
  const status = parseAgyQuotaEnvelope(raw);
  assert.deepEqual(status.quotas.map((q) => q.model), ['Gemini', 'Claude & OpenAI']);

  const gemini = status.quotas[0];
  assert.equal(gemini.fiveHourPercent, 100);
  assert.equal(gemini.weeklyPercent, 72);
  assert.equal(gemini.fiveHourDisabled, false);
  assert.equal(gemini.weeklyDisabled, false);

  const shared = status.quotas[1];
  assert.equal(shared.fiveHourPercent, 80);
  assert.equal(shared.weeklyPercent, 55);
});

test('agy parser rejects malformed or missing structured quota data', () => {
  assert.throws(() => parseAgyQuotaEnvelope('Gemini Models 80%'));
  assert.throws(() => parseAgyQuotaEnvelope('{"command":{"data":{}}}'));
});

test('agy parser keeps absent quota windows unavailable', () => {
  const status = parseAgyQuotaEnvelope(JSON.stringify({
    command: {
      data: {
        groups: [{
          name: 'Gemini Models',
          buckets: [{
            window: 'weekly',
            remaining_fraction: 0.5,
            reset_time: '2026-09-08T00:00:00Z',
          }],
        }],
      },
    },
  }));

  const gemini = status.quotas.find((q) => q.model === 'Gemini');
  assert.ok(gemini);
  assert.equal(gemini.fiveHourPercent, 0);
  assert.equal(gemini.fiveHourDisabled, true);
  assert.equal(gemini.weeklyPercent, 50);
  assert.equal(gemini.weeklyDisabled, false);
});
