const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseQuotaData,
  resolveQuotaModelName,
  formatAbsoluteTime,
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
