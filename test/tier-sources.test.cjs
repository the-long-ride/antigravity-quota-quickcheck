const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizePlanTier,
  extractPlanTier,
  parseFullStatus,
} = require('../out/telemetry/parser.js');
const { parseCloudCodeStatus } = require('../out/telemetry/providers/cloudCode.js');
const { parseAgyQuotaEnvelope } = require('../out/telemetry/providers/agyCli.js');
const { fetchFromProvidersWith } = require('../out/telemetry/providers');

// 1. Plan Tier Normalization & Aliases
test('Tier Normalization: covers Google AI Pro variants', () => {
  const proVariants = [
    'advanced-tier',
    'advanced',
    'advanced tier',
    'google_ai_pro',
    'google-ai-pro',
    'google ai pro',
    'ai-pro',
    'ai pro',
    'g1-pro-tier',
    'g1-pro',
    'pro-tier',
    'pro',
  ];
  for (const variant of proVariants) {
    assert.equal(normalizePlanTier(variant), 'Google AI Pro', `Failed for ${variant}`);
    assert.equal(normalizePlanTier(variant.toUpperCase()), 'Google AI Pro', `Failed for uppercase ${variant}`);
  }
});

test('Tier Normalization: covers Google AI Ultra variants', () => {
  const ultraVariants = [
    'ultra-tier',
    'ultra',
    'ultra tier',
    'google_ai_ultra',
    'google-ai-ultra',
    'google ai ultra',
    'ai-ultra',
    'ai ultra',
    'g1-ultra-tier',
    'g1-ultra',
  ];
  for (const variant of ultraVariants) {
    assert.equal(normalizePlanTier(variant), 'Google AI Ultra', `Failed for ${variant}`);
    assert.equal(normalizePlanTier(variant.toUpperCase()), 'Google AI Ultra', `Failed for uppercase ${variant}`);
  }
});

// 2. Cloud Code Source
test('Cloud Code Source: resolves Google AI Pro from loadCodeAssist paidTier', () => {
  const status = parseCloudCodeStatus(
    {
      currentTier: { id: 'free-tier', name: 'Antigravity' },
      paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
    },
    {},
    {},
  );
  assert.equal(status.planTier, 'Google AI Pro');
});

test('Cloud Code Source: resolves Google AI Pro from loadCodeAssist g1-pro-tier id without name', () => {
  const status = parseCloudCodeStatus(
    {
      currentTier: { id: 'free-tier', name: 'Antigravity' },
      paidTier: { id: 'g1-pro-tier' },
    },
    {},
    {},
  );
  assert.equal(status.planTier, 'Google AI Pro');
});

test('Cloud Code Source: resolves Google AI Pro from availableModels when loadCodeAssist has no tier', () => {
  const status = parseCloudCodeStatus(
    {},
    {},
    {
      paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      models: {
        'gemini-3-pro': { quotaInfo: { remainingFraction: 0.8 } },
      },
    },
  );
  assert.equal(status.planTier, 'Google AI Pro');
});

test('Cloud Code Source: resolves Google AI Pro from userQuota when loadCodeAssist has no tier', () => {
  const status = parseCloudCodeStatus(
    {},
    {
      planTier: 'google_ai_pro',
      buckets: [
        { modelId: 'gemini-3-pro', remainingFraction: 0.8 },
      ],
    },
    {},
  );
  assert.equal(status.planTier, 'Google AI Pro');
});

// 3. agy CLI Source
test('agy CLI Source: resolves Google AI Pro from command.data planTier', () => {
  const payload = {
    command: {
      data: {
        planTier: 'g1-pro-tier',
        groups: [
          {
            name: 'Gemini Models',
            buckets: [{ window: '5h', remaining_fraction: 0.8, reset_time: '2026-10-29T09:47:49Z' }],
          },
        ],
      },
    },
  };
  const status = parseAgyQuotaEnvelope(JSON.stringify(payload));
  assert.equal(status.planTier, 'Google AI Pro');
});

test('agy CLI Source: resolves Google AI Pro from command.data paidTier object', () => {
  const payload = {
    command: {
      data: {
        paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
        groups: [
          {
            name: 'Gemini Models',
            buckets: [{ window: '5h', remaining_fraction: 0.8, reset_time: '2026-10-29T09:47:49Z' }],
          },
        ],
      },
    },
  };
  const status = parseAgyQuotaEnvelope(JSON.stringify(payload));
  assert.equal(status.planTier, 'Google AI Pro');
});

test('agy CLI Source: enrichCliSubscription enriches CLI quota with Google AI Pro', async () => {
  const cliStatus = {
    credits: null,
    quotas: [{ model: 'Gemini', percent: 80, refreshTime: '' }],
    recentlyUsedModel: null,
    planTier: null,
  };

  const enriched = await fetchFromProvidersWith(
    false,
    async () => ({ ...cliStatus }),
    async () => { throw new Error('not called'); },
    async () => { throw new Error('not called'); },
    async (status) => {
      status.planTier = 'Google AI Pro';
    },
  );

  assert.equal(enriched.planTier, 'Google AI Pro');
});

// 4. Language Server Source
test('Language Server Source: resolves Google AI Pro from userStatus.userTier', () => {
  const raw = {
    userStatus: {
      userTier: { name: 'Google AI Pro', id: 'g1-pro-tier' },
      cascadeModelConfigData: { clientModelConfigs: [] },
    },
  };
  const status = parseFullStatus(raw);
  assert.equal(status.planTier, 'Google AI Pro');
});

test('Language Server Source: resolves Google AI Pro from userStatus.paidTier when currentTier is Antigravity', () => {
  const raw = {
    userStatus: {
      currentTier: { id: 'free-tier', name: 'Antigravity' },
      paidTier: { name: 'Google AI Pro' },
      cascadeModelConfigData: { clientModelConfigs: [] },
    },
  };
  const status = parseFullStatus(raw);
  assert.equal(status.planTier, 'Google AI Pro');
});

test('Language Server Source: resolves Google AI Pro from quotaSummary response', () => {
  const raw = {
    userStatus: {
      cascadeModelConfigData: { clientModelConfigs: [] },
    },
  };
  const quotaSummary = {
    response: {
      planTier: 'advanced-tier',
      groups: [],
    },
  };
  const status = parseFullStatus(raw, quotaSummary);
  assert.equal(status.planTier, 'Google AI Pro');
});
