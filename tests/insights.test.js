import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInsights,
  classifyInsightReading,
  validateInsightReading,
} from "../src/lib/insights.js";

const now = Date.parse("2026-10-02T12:00:00Z");
const parameterNames = ["pH", "TDS", "Turbidity", "Temperature"];
const thresholds = parameterNames.map((name, index) => ({
  parameter_id: `parameter-${index}`,
  min_value: 1,
  max_value: 9,
  severity_label: "safe",
}));

const makeReading = (name, value, recordedAt, index = parameterNames.indexOf(name)) => ({
  id: `${name}-${recordedAt}`,
  parameter_id: `parameter-${index}`,
  value,
  recorded_at: new Date(recordedAt).toISOString(),
  parameters: { id: `parameter-${index}`, name },
});

const currentReadings = () => parameterNames.map((name) =>
  makeReading(name, 5, now - 10 * 60 * 1000)
);

test("rejects malformed, physically impossible, and future readings", () => {
  assert.equal(validateInsightReading(makeReading("pH", "abc", now), now), "Value is not a finite number");
  assert.equal(validateInsightReading(makeReading("pH", 15, now), now), "pH is outside the documented 0–14 scale");
  assert.equal(validateInsightReading(makeReading("TDS", -1, now), now), "TDS cannot be negative");
  assert.equal(validateInsightReading(makeReading("Temperature", 51, now), now), "Temperature is outside the documented sensor range (-10–50 °C)");
  assert.equal(validateInsightReading(makeReading("Turbidity", 2, now + 10 * 60 * 1000), now), "Timestamp is in the future");
});

test("uses the narrowest matching configured severity band", () => {
  const reading = makeReading("pH", 7, now);
  const configured = [
    { parameter_id: "parameter-0", min_value: 5, max_value: 9, severity_label: "warning" },
    { parameter_id: "parameter-0", min_value: 6, max_value: 8, severity_label: "safe" },
  ];
  assert.equal(classifyInsightReading(reading, configured).state, "within");
});

test("reports insufficient data when a parameter is missing or stale", () => {
  assert.equal(buildInsights(currentReadings().slice(1), thresholds, now).status, "Insufficient Data for Analysis");
  const stale = parameterNames.map((name) => makeReading(name, 5, now - 90 * 60 * 1000));
  assert.equal(buildInsights(stale, thresholds, now).status, "Insufficient Data for Analysis");
});

test("does not combine readings from different monitoring locations", () => {
  const rows = currentReadings().map((reading, index) => ({
    ...reading,
    nodes: { id: `node-${index}`, location: `station-${index}` },
  }));
  const result = buildInsights(rows, thresholds, now);
  assert.equal(result.status, "Insufficient Data for Analysis");
  assert.match(result.reasons.join(" "), /separate monitoring locations/);
});

test("flags a configured warning band without claiming water is unsafe", () => {
  const rows = currentReadings();
  rows[0].value = 11;
  const configured = [
    ...thresholds,
    { parameter_id: "parameter-0", min_value: 10, max_value: 12, severity_label: "warning" },
  ];
  const result = buildInsights(rows, configured, now);
  assert.equal(result.status, "Configured threshold exceedance");
  assert.match(result.summary, /pH 11 \(in the configured warning band\)/);
  assert.doesNotMatch(result.summary, /water is (?:safe|unsafe)/i);
});

test("requires all four configured threshold sets before producing an assessment", () => {
  assert.equal(buildInsights(currentReadings(), thresholds.slice(1), now).status, "Insufficient Data for Analysis");
  const invalidThresholds = thresholds.map((threshold, index) => index === 0
    ? { ...threshold, min_value: 10, max_value: 1 }
    : threshold);
  assert.equal(buildInsights(currentReadings(), invalidThresholds, now).status, "Insufficient Data for Analysis");
});

test("detects a descriptive improving trend from actual seven-day readings", () => {
  const rows = [];
  for (const name of parameterNames) {
    for (let index = 0; index < 3; index++) {
      rows.push(makeReading(name, 0, now - (6 * 24 + index) * 60 * 60 * 1000));
      rows.push(makeReading(name, 5, now - (24 + index) * 60 * 60 * 1000));
    }
    rows.push(makeReading(name, 5, now - 10 * 60 * 1000));
  }
  const result = buildInsights(rows, thresholds, now);
  assert.equal(result.trend.label, "Conditions Appear to Be Improving");
  assert.match(result.trend.period, /2026/);
  assert.equal(result.trend.parameterResults[0].earlyRate, 1);
  assert.equal(result.trend.parameterResults[0].recentRate, 0);
  assert.match(result.trend.parameterResults[0].detail, /pH: 100% \(3\/3\) to 0% \(0\/4\)/);
});

test("withholds trend when there are too few readings", () => {
  const result = buildInsights(currentReadings(), thresholds, now);
  assert.equal(result.trend.label, "Not Enough Data to Determine Trend");
  assert.match(result.trend.detail, /pH has 0 valid readings/);
});

test("summary changes with measured values and threshold outcomes", () => {
  const safeResult = buildInsights(currentReadings(), thresholds, now);
  const changed = currentReadings();
  changed[0].value = 11;
  const configured = [
    ...thresholds,
    { parameter_id: "parameter-0", min_value: 10, max_value: 12, severity_label: "warning" },
  ];
  const warningResult = buildInsights(changed, configured, now);
  assert.notEqual(safeResult.summary, warningResult.summary);
  assert.match(safeResult.summary, /4 of 4 latest readings are within/);
  assert.match(warningResult.summary, /3 of 4 latest readings are within/);
  assert.match(warningResult.summary, /pH 11/);
});

test("unavailable assessment summary identifies actual missing parameter and thresholds", () => {
  const rows = currentReadings().filter((reading) => reading.parameters.name !== "TDS");
  const result = buildInsights(rows, thresholds.slice(1), now);
  assert.match(result.status, /Insufficient Data for Analysis/);
  assert.match(result.summary, /no valid current reading for TDS/);
  assert.match(result.summary, /no usable recognized threshold band for pH/);
});

test("produces labeled, backtested forecasts only from regular observed history", () => {
  const rows = [];
  for (const name of parameterNames) {
    for (let index = 0; index < 24; index++) {
      rows.push(makeReading(name, 5 + index / 10, now - (24 - index) * 30 * 60 * 1000));
    }
  }
  const result = buildInsights(rows, thresholds, now);
  assert.equal(result.prediction.available, true);
  assert.equal(result.prediction.rows.length, 4);
  assert.equal(result.prediction.rows[0].validationCount, 4);
  assert.equal(result.prediction.rows[0].comparison.state, "within");
  assert.match(result.prediction.validationMethod, /Linear regression/);
});

test("withholds forecasts when observations are irregular", () => {
  const rows = [];
  for (const name of parameterNames) {
    for (let index = 0; index < 24; index++) {
      if (name === "pH" && index === 12) continue;
      rows.push(makeReading(name, 5 + index / 10, now - (24 - index) * 30 * 60 * 1000));
    }
  }
  const result = buildInsights(rows, thresholds, now);
  assert.equal(result.prediction.available, false);
  assert.match(result.prediction.message, /pH readings are not consistently spaced/);
});
