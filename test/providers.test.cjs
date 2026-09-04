const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { runProviderChain, ProviderError } = require('../out/telemetry/providers');
const { parseAgyQuotaEnvelope } = require('../out/telemetry/providers/agyCli');
const {
  decodeKeyringSecret,
  extractOauthClients,
  parseCredentialJson,
} = require('../out/telemetry/providers/credentials');
const { parseCloudCodeStatus } = require('../out/telemetry/providers/cloudCode');

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

test('credential parser accepts flat and nested agy shapes', () => {
  const flat = parseCredentialJson(JSON.stringify({
    refresh_token: 'refresh-value',
    access_token: 'access-value',
    expiry: 4102444800000,
  }));
  assert.equal(flat.refreshToken, 'refresh-value');
  assert.equal(flat.accessToken, 'access-value');
  assert.equal(flat.expiryMs, 4102444800000);

  const nested = parseCredentialJson(JSON.stringify({
    token: {
      refresh_token: 'nested-refresh',
      access_token: 'nested-access',
      expiry_date: 4102444800000,
    },
  }));
  assert.equal(nested.refreshToken, 'nested-refresh');
  assert.equal(nested.accessToken, 'nested-access');
  assert.equal(nested.expiryMs, 4102444800000);
});

test('credential helper decodes go-keyring base64 payloads', () => {
  const payload = JSON.stringify({ token: { refresh_token: 'refresh-value' } });
  const encoded = `go-keyring-base64:${Buffer.from(payload).toString('base64')}`;
  assert.equal(decodeKeyringSecret(encoded), payload);
});

test('OAuth client extraction deduplicates discovered candidate pairs', () => {
  const clientId = ['123456789012-', 'abcdefghijklmnop', '.apps.googleusercontent.com'].join('');
  const clientSecret = ['GOC', 'SPX-', 'abcdefghijklmnopqrstuvwxyzAB'].join('');
  const sample = Buffer.from(`${clientId} xx ${clientSecret} ${clientId} ${clientSecret}`);
  const pairs = extractOauthClients(sample);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], { clientId, clientSecret });
});

test('Cloud Code fixture normalizes Google AI subscription, credits, and provider pools', () => {
  const load = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cloud-load-code-assist.json'), 'utf8'));
  const quota = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cloud-retrieve-user-quota.json'), 'utf8'));
  const models = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cloud-models.json'), 'utf8'));

  const status = parseCloudCodeStatus(load, quota, models);
  assert.equal(status.planTier, 'Google AI Pro');
  assert.equal(status.credits.balance, 14.5);
  assert.deepEqual(status.quotas.map((q) => q.model), ['Gemini', 'Claude & OpenAI']);

  const gemini = status.quotas[0];
  assert.equal(gemini.percent, 64);
  assert.equal(gemini.fiveHourDisabled, true);
  assert.equal(gemini.weeklyDisabled, true);

  const shared = status.quotas[1];
  assert.equal(shared.percent, 42);
  assert.equal(shared.fiveHourDisabled, true);
  assert.equal(shared.weeklyDisabled, true);
});

test('Cloud Code plan falls back to tier id when no human-readable name exists', () => {
  const status = parseCloudCodeStatus(
    { paidTier: { id: 'g1-pro-tier' } },
    {},
    {},
  );
  assert.equal(status.planTier, 'g1-pro-tier');
});

test('Cloud Code parser preserves explicit windows and numeric strings', () => {
  const status = parseCloudCodeStatus(
    { paidTier: { id: 'pro', availableCredits: [{ creditAmount: '1.5' }] } },
    {
      buckets: [
        {
          modelId: 'gemini-3-pro',
          tokenType: 'REQUESTS',
          remainingFraction: '0.71',
          resetTime: '2026-09-04T18:00:00Z',
          window: '5h',
        },
        {
          modelId: 'gemini-3-pro',
          tokenType: 'REQUESTS',
          remainingFraction: '0.53',
          resetTime: '2026-09-08T00:00:00Z',
          window: 'weekly',
        },
      ],
    },
    {
      models: {
        'claude-sonnet-4': {
          quotaInfo: {
            remainingFraction: '0.35',
            resetTime: '2026-09-04T17:00:00Z',
            window: '5h',
          },
        },
      },
    },
  );

  const gemini = status.quotas.find((q) => q.model === 'Gemini');
  assert.equal(gemini.fiveHourPercent, 71);
  assert.equal(gemini.fiveHourDisabled, false);
  assert.equal(gemini.weeklyPercent, 53);
  assert.equal(gemini.weeklyDisabled, false);

  const shared = status.quotas.find((q) => q.model === 'Claude & OpenAI');
  assert.equal(shared.fiveHourPercent, 35);
  assert.equal(shared.fiveHourDisabled, false);
  assert.equal(shared.weeklyPercent, 0);
  assert.equal(shared.weeklyDisabled, true);
});
