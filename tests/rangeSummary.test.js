import test from "node:test";
import assert from "node:assert/strict";
import { interpretRange } from "../src/utils/rangeSummary.js";

test("interpretRange produces Within limits when readings are in safe limits", () => {
  const stats = {
    totalDistinctReadings: 48,
    days: 1,
    parameterStats: {
      pH: {
        count: 48,
        min: 7.2,
        max: 7.6,
        mean: 7.42,
        latest: 7.4,
        latestTime: "2026-11-08T06:00:00Z",
        safePercent: 100,
        warningPercent: 0,
        criticalPercent: 0,
        trend: "steady",
        unit: "",
      },
      Turbidity: {
        count: 48,
        min: 10,
        max: 25,
        mean: 18.5,
        latest: 19,
        latestTime: "2026-11-08T06:00:00Z",
        safePercent: 100,
        warningPercent: 0,
        criticalPercent: 0,
        trend: "down",
        unit: "NTU",
      },
      TDS: {
        count: 48,
        min: 150,
        max: 220,
        mean: 180,
        latest: 185,
        latestTime: "2026-11-08T06:00:00Z",
        safePercent: 100,
        warningPercent: 0,
        criticalPercent: 0,
        trend: "steady",
        unit: "ppm",
      },
      Temperature: {
        count: 48,
        min: 26.5,
        max: 28.2,
        mean: 27.1,
        latest: 27.5,
        latestTime: "2026-11-08T06:00:00Z",
        safePercent: 100,
        warningPercent: 0,
        criticalPercent: 0,
        trend: "up",
        unit: "°C",
      },
    },
  };

  const res = interpretRange(stats);
  assert.equal(res.overallBadge, "Within limits");
  assert.equal(res.overallStatus, "within");
  assert.match(res.parameterLines.pH, /pH averaged 7.42/);
  assert.equal(res.crossNote, null);
});

test("interpretRange detects cross-parameter runoff note when turbidity and TDS both trend up", () => {
  const stats = {
    totalDistinctReadings: 100,
    days: 3,
    parameterStats: {
      pH: { count: 100, min: 7.1, max: 7.8, mean: 7.4, latest: 7.5, safePercent: 100, warningPercent: 0, criticalPercent: 0, trend: "steady", unit: "" },
      Turbidity: { count: 100, min: 10, max: 45, mean: 28, latest: 42, safePercent: 96, warningPercent: 4, criticalPercent: 0, trend: "up", unit: "NTU" },
      TDS: { count: 100, min: 200, max: 480, mean: 350, latest: 470, safePercent: 98, warningPercent: 2, criticalPercent: 0, trend: "up", unit: "ppm" },
      Temperature: { count: 100, min: 26, max: 29, mean: 27.5, latest: 28, safePercent: 100, warningPercent: 0, criticalPercent: 0, trend: "steady", unit: "°C" },
    },
  };

  const res = interpretRange(stats);
  assert.equal(res.overallBadge, "Within limits");
  assert.match(res.crossNote, /Rising turbidity and TDS together/);
});

test("interpretRange flags Needs attention and Concern appropriately", () => {
  // Case 1: Warning > 5% -> Needs attention
  const statsWarn = {
    totalDistinctReadings: 50,
    days: 2,
    parameterStats: {
      pH: { count: 50, min: 6.0, max: 7.5, mean: 6.8, latest: 6.2, safePercent: 90, warningPercent: 10, criticalPercent: 0, trend: "down", unit: "" },
    },
  };
  const resWarn = interpretRange(statsWarn);
  assert.equal(resWarn.overallBadge, "Needs attention");
  assert.equal(resWarn.overallStatus, "warning");

  // Case 2: Critical > 10% -> Concern
  const statsConcern = {
    totalDistinctReadings: 50,
    days: 2,
    parameterStats: {
      pH: { count: 50, min: 4.5, max: 7.5, mean: 6.2, latest: 5.1, safePercent: 80, warningPercent: 5, criticalPercent: 15, trend: "down", unit: "" },
    },
  };
  const resConcern = interpretRange(statsConcern);
  assert.equal(resConcern.overallBadge, "Concern");
  assert.equal(resConcern.overallStatus, "concern");
});

test("interpretRange shows Not enough readings to summarize when count < 5", () => {
  const statsFew = {
    totalDistinctReadings: 3,
    days: 1,
    parameterStats: {
      pH: { count: 3, min: 7.0, max: 7.2, mean: 7.1, latest: 7.2, safePercent: 100, warningPercent: 0, criticalPercent: 0, trend: "insufficient", unit: "" },
    },
  };
  const resFew = interpretRange(statsFew);
  assert.equal(resFew.parameterLines.pH, "Not enough readings to summarize");
});
