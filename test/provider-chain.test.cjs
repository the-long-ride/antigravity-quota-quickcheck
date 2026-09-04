const assert = require('node:assert/strict');
const test = require('node:test');

const { fetchFromProvidersWith } = require('../out/telemetry/providers');
const { createSingleFlight } = require('../out/telemetry');

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

function failure(name, calls) {
  return async () => {
    calls.push(name);
    throw new Error(`${name} failed`);
  };
}

function success(name, calls) {
  return async () => {
    calls.push(name);
    return good;
  };
}

test('production provider helper stops after CLI success', async () => {
  const calls = [];
  const result = await fetchFromProvidersWith(
    false,
    success('cli', calls),
    failure('cloud', calls),
    failure('language', calls),
  );
  assert.equal(result, good);
  assert.deepEqual(calls, ['cli']);
});

test('production provider helper falls from CLI to Cloud Code', async () => {
  const calls = [];
  const result = await fetchFromProvidersWith(
    false,
    failure('cli', calls),
    success('cloud', calls),
    failure('language', calls),
  );
  assert.equal(result, good);
  assert.deepEqual(calls, ['cli', 'cloud']);
});

test('production provider helper falls through to language server last', async () => {
  const calls = [];
  const result = await fetchFromProvidersWith(
    false,
    failure('cli', calls),
    failure('cloud', calls),
    success('language', calls),
  );
  assert.equal(result, good);
  assert.deepEqual(calls, ['cli', 'cloud', 'language']);
});

test('all three provider failures stay source-neutral', async () => {
  const calls = [];
  await assert.rejects(
    () => fetchFromProvidersWith(
      false,
      failure('cli', calls),
      failure('cloud', calls),
      failure('language', calls),
    ),
    /Antigravity quota unavailable/i,
  );
  assert.deepEqual(calls, ['cli', 'cloud', 'language']);
});

test('single-flight wrapper shares one in-flight provider execution', async () => {
  let calls = 0;
  let resolveFetch;
  const deferred = new Promise((resolve) => {
    resolveFetch = resolve;
  });

  const fetch = createSingleFlight(async () => {
    calls += 1;
    return deferred;
  });

  const first = fetch(false);
  const second = fetch(true);
  assert.equal(calls, 1);
  assert.equal(first, second);

  resolveFetch(good);
  assert.equal(await first, good);
  assert.equal(await second, good);
});
