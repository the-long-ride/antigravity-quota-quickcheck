const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseQuotaData,
  resolveQuotaModelName,
  formatAbsoluteTime,
  isArgonPoolModel,
  normalizePlanTier,
  extractPlanTier,
  parseFullStatus,
} = require("../out/telemetry/parser.js");

const configs = [
  { label: "Gemini 3 Pro" },
  { label: "Gemini 3 Flash" },
  { label: "Claude Sonnet 4.5" },
  { label: "GPT-5" },
];

const quotaSummary = {
  response: {
    groups: [
      {
        displayName: "Gemini",
        description: "Shared Gemini models",
        buckets: [
          { window: "5h", remainingFraction: 0.72, resetTime: "2026-09-03T20:00:00Z", disabled: false },
          { window: "weekly", remainingFraction: 0.44, resetTime: "2026-09-08T00:00:00Z", disabled: false },
        ],
      },
      {
        displayName: "Claude and GPT",
        description: "Shared Claude and OpenAI models",
        buckets: [
          { window: "5h", remainingFraction: 0.61, resetTime: "2026-09-03T21:00:00Z", disabled: false },
          { window: "weekly", remainingFraction: 0.33, resetTime: "2026-09-09T00:00:00Z", disabled: false },
        ],
      },
    ],
  },
};

test("groups provider models into exactly two quota cards", () => {
  const result = parseQuotaData(configs, quotaSummary);
  assert.deepEqual(result.map((q) => q.model), ["Gemini", "Claude & OpenAI"]);
  assert.equal(result[0].fiveHourPercent, 72);
  assert.equal(result[0].weeklyPercent, 44);
  assert.equal(result[1].fiveHourPercent, 61);
  assert.equal(result[1].weeklyPercent, 33);
});

test("maps persisted model selections to provider quota cards", () => {
  assert.equal(resolveQuotaModelName("Gemini 3 Pro"), "Gemini");
  assert.equal(resolveQuotaModelName("Claude Sonnet 4.5"), "Claude & OpenAI");
  assert.equal(resolveQuotaModelName("GPT-5"), "Claude & OpenAI");
  assert.equal(resolveQuotaModelName("OpenAI GPT-5"), "Claude & OpenAI");
});

test("uses shared Claude/OpenAI quota for OpenAI model labels without GPT", () => {
  const result = parseQuotaData(
    [{ label: "OpenAI o3" }],
    {
      response: {
        groups: [{
          displayName: "Claude and OpenAI",
          description: "Shared Claude and OpenAI models",
          buckets: [
            { window: "5h", remainingFraction: 0.52, resetTime: "2026-09-03T22:00:00Z", disabled: false },
            { window: "weekly", remainingFraction: 0.26, resetTime: "2026-09-10T00:00:00Z", disabled: false },
          ],
        }],
      },
    },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].model, "Claude & OpenAI");
  assert.equal(result[0].fiveHourPercent, 52);
  assert.equal(result[0].weeklyPercent, 26);
});

test("formats non-current reset dates with abbreviated months", () => {
  const formatted = formatAbsoluteTime("2030-09-11T03:18:00Z");
  assert.match(formatted, /\bSep\s+11\b/);
  assert.doesNotMatch(formatted, /September/);
});

test("emits 3 pools when Argon has a distinct weekly bucket", () => {
  const configsWithArgon = [
    { label: "Gemini 3 Pro" },
    { label: "Claude Sonnet 4.5" },
    { label: "Gemini 4 Argon" },
  ];
  const summaryWithArgon = {
    response: {
      groups: [
        {
          displayName: "Gemini",
          description: "Shared Gemini models",
          buckets: [
            { window: "5h", remainingFraction: 0.8, resetTime: "2026-10-25T15:00:00Z", disabled: false },
            { window: "weekly", remainingFraction: 0.6, resetTime: "2026-10-30T00:00:00Z", disabled: false },
          ],
        },
        {
          displayName: "Claude and GPT",
          description: "Shared Claude and OpenAI models",
          buckets: [
            { window: "5h", remainingFraction: 0.7, resetTime: "2026-10-25T16:00:00Z", disabled: false },
            { window: "weekly", remainingFraction: 0.5, resetTime: "2026-10-30T00:00:00Z", disabled: false },
          ],
        },
        {
          displayName: "Gemini 4 Argon",
          description: "Argon weekly model pool",
          buckets: [
            { window: "weekly", remainingFraction: 0.45, resetTime: "2026-10-31T00:00:00Z", disabled: false },
          ],
        },
      ],
    },
  };

  const result = parseQuotaData(configsWithArgon, summaryWithArgon);
  assert.deepEqual(result.map((q) => q.model), ["Gemini", "Gemini 4 Argon", "Claude & OpenAI"]);
  assert.equal(result[1].fiveHourPercent, undefined);
  assert.equal(result[1].fiveHourReset, undefined);
  assert.equal(result[1].weeklyPercent, 45);
  assert.equal(result[1].weeklyReset, "2026-10-31T00:00:00Z");
  assert.equal(result[1].percent, 45);
});

test("merges Argon into Gemini when Argon shares fraction and reset with Gemini", () => {
  const configsSharedArgon = [
    {
      label: "Gemini 3 Pro",
      quotaInfo: {
        remainingFraction: 0.85,
        resetTime: "2026-10-25T15:00:00Z",
      },
    },
    {
      label: "Gemini 4 Argon",
      quotaInfo: {
        remainingFraction: 0.85,
        resetTime: "2026-10-25T15:00:00Z",
      },
    },
  ];

  const result = parseQuotaData(configsSharedArgon);
  assert.deepEqual(result.map((q) => q.model), ["Gemini"]);
  assert.equal(result[0].percent, 85);
  assert.equal(result[0].fiveHourPercent, 85);
});

test("lane aggregation chooses lowest percentage and earliest reset across models", () => {
  const configsMultiModel = [
    {
      label: "Gemini 3 Pro",
      quotaInfo: {
        remainingFraction: 0.8,
        resetTime: "2026-10-25T16:00:00Z",
      },
    },
    {
      label: "Gemini 3 Flash",
      quotaInfo: {
        remainingFraction: 0.5,
        resetTime: "2026-10-25T14:00:00Z",
      },
    },
    {
      label: "Gemini Experimental",
      quotaInfo: {
        remainingFraction: 0.5,
        resetTime: "2026-10-25T12:00:00Z", // tie on 50%, but earlier reset
      },
    },
  ];

  const result = parseQuotaData(configsMultiModel);
  assert.equal(result.length, 1);
  assert.equal(result[0].model, "Gemini");
  assert.equal(result[0].fiveHourPercent, 50);
  assert.equal(result[0].fiveHourReset, "2026-10-25T12:00:00Z");
});

test("resolves Gemini 4 Argon in resolveQuotaModelName and isArgonPoolModel", () => {
  assert.equal(resolveQuotaModelName("Gemini 4 Argon"), "Gemini 4 Argon");
  assert.equal(resolveQuotaModelName("gemini-4-pro"), "Gemini 4 Argon");
  assert.equal(resolveQuotaModelName("argon-preview"), "Gemini 4 Argon");
  assert.equal(resolveQuotaModelName("Gemini 4"), "Gemini 4 Argon");

  assert.equal(isArgonPoolModel("gemini-4"), true);
  assert.equal(isArgonPoolModel("gemini_4"), true);
  assert.equal(isArgonPoolModel("Gemini 4"), true);
  assert.equal(isArgonPoolModel("argon"), true);
  assert.equal(isArgonPoolModel("Gemini 3 Pro"), false);
  assert.equal(isArgonPoolModel("Claude Sonnet"), false);
  assert.equal(isArgonPoolModel(null), false);
});

test("merges Argon into Gemini when Ultra account has shared Gemini quotaSummary and Gemini 4 Argon config", () => {
  const configsUltra = [
    { label: "Gemini 3 Pro" },
    { label: "Gemini 4 Argon" },
  ];
  const summaryUltra = {
    response: {
      groups: [
        {
          displayName: "Gemini",
          description: "Shared Gemini models",
          buckets: [
            { window: "5h", remainingFraction: 0.85, resetTime: "2026-10-25T15:00:00Z", disabled: false },
            { window: "weekly", remainingFraction: 0.70, resetTime: "2026-10-30T00:00:00Z", disabled: false },
          ],
        },
      ],
    },
  };

  const result = parseQuotaData(configsUltra, summaryUltra);
  assert.deepEqual(result.map((q) => q.model), ["Gemini"]);
  assert.equal(result[0].fiveHourPercent, 85);
  assert.equal(result[0].weeklyPercent, 70);
});

test("emits distinct Gemini 4 Argon when raw quotaInfo has distinct remaining fraction", () => {
  const configsDistinct = [
    {
      label: "Gemini 3 Pro",
      quotaInfo: {
        remainingFraction: 0.85,
        resetTime: "2026-10-25T15:00:00Z",
      },
    },
    {
      label: "Gemini 4 Argon",
      quotaInfo: {
        remainingFraction: 0.50,
        resetTime: "2026-10-25T15:00:00Z",
      },
    },
  ];

  const result = parseQuotaData(configsDistinct);
  assert.deepEqual(result.map((q) => q.model), ["Gemini", "Gemini 4 Argon"]);
  assert.equal(result[0].percent, 85);
  assert.equal(result[0].fiveHourPercent, 85);
  assert.equal(result[1].percent, 50);
  assert.equal(result[1].weeklyPercent, 50);
  assert.equal(result[1].fiveHourPercent, undefined);

});

test("normalizePlanTier normalizes standard QuotaShift tiers and aliases", () => {
  assert.equal(normalizePlanTier("free-tier"), "Free");
  assert.equal(normalizePlanTier("free"), "Free");
  assert.equal(normalizePlanTier("free tier"), "Free");

  assert.equal(normalizePlanTier("standard-tier"), "Paid");
  assert.equal(normalizePlanTier("standard"), "Paid");
  assert.equal(normalizePlanTier("paid"), "Paid");
  assert.equal(normalizePlanTier("paid-tier"), "Paid");

  assert.equal(normalizePlanTier("legacy-tier"), "Legacy");
  assert.equal(normalizePlanTier("legacy"), "Legacy");

  assert.equal(normalizePlanTier("advanced-tier"), "Google AI Pro");
  assert.equal(normalizePlanTier("advanced"), "Google AI Pro");
  assert.equal(normalizePlanTier("google_ai_pro"), "Google AI Pro");
  assert.equal(normalizePlanTier("google-ai-pro"), "Google AI Pro");
  assert.equal(normalizePlanTier("google ai pro"), "Google AI Pro");
  assert.equal(normalizePlanTier("ai-pro"), "Google AI Pro");

  assert.equal(normalizePlanTier("ultra-tier"), "Google AI Ultra");
  assert.equal(normalizePlanTier("ultra"), "Google AI Ultra");
  assert.equal(normalizePlanTier("google_ai_ultra"), "Google AI Ultra");
  assert.equal(normalizePlanTier("google-ai-ultra"), "Google AI Ultra");
  assert.equal(normalizePlanTier("google ai ultra"), "Google AI Ultra");
  assert.equal(normalizePlanTier("ai-ultra"), "Google AI Ultra");

  assert.equal(normalizePlanTier("g1-pro-tier"), "Google AI Pro");
  assert.equal(normalizePlanTier("g1-pro"), "Google AI Pro");
  assert.equal(normalizePlanTier("pro-tier"), "Google AI Pro");
  assert.equal(normalizePlanTier("pro"), "Google AI Pro");
  assert.equal(normalizePlanTier("g1-ultra-tier"), "Google AI Ultra");
  assert.equal(normalizePlanTier("g1-ultra"), "Google AI Ultra");
  assert.equal(normalizePlanTier("custom-plan"), "custom-plan");
  assert.equal(normalizePlanTier(""), null);
  assert.equal(normalizePlanTier(null), null);
  assert.equal(normalizePlanTier(undefined), null);
});

test("extractPlanTier resolves tier across planInfo, paidTier, currentTier, userTier, and aliases", () => {
  // 1. planInfo.planType preferred
  assert.equal(
    extractPlanTier({ planInfo: { planType: "advanced-tier" } }),
    "Google AI Pro"
  );
  assert.equal(
    extractPlanTier({ userStatus: { planInfo: { planType: "ultra-tier" } } }),
    "Google AI Ultra"
  );

  // 2. paidTier
  assert.equal(
    extractPlanTier({ paidTier: { name: "Google AI Pro" } }),
    "Google AI Pro"
  );
  assert.equal(
    extractPlanTier({ paidTier: { id: "standard-tier" } }),
    "Paid"
  );

  // 3. currentTier skips 'Antigravity' and resolves id
  assert.equal(
    extractPlanTier({ currentTier: { name: "Antigravity", id: "free-tier" } }),
    "Free"
  );

  // 4. userStatus.userTier
  assert.equal(
    extractPlanTier({ userStatus: { userTier: { name: "standard-tier" } } }),
    "Paid"
  );

  // 5. Root fields
  assert.equal(extractPlanTier({ planTier: "advanced-tier" }), "Google AI Pro");
  assert.equal(extractPlanTier({ plan_tier: "ultra-tier" }), "Google AI Ultra");
  assert.equal(extractPlanTier({ tier: "legacy-tier" }), "Legacy");

  // 6. parseFullStatus integrates extractPlanTier
  const full = parseFullStatus({
    userStatus: {
      planInfo: { planType: "google_ai_pro" },
      cascadeModelConfigData: { clientModelConfigs: [] },
    },
  });
  assert.equal(full.planTier, "Google AI Pro");
});
