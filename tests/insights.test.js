import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInsights,
  buildSensorSummary,
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

test("buildSensorSummary computes dynamic statistics across selectable historical windows", () => {
  const dynamicThresholds = [
    { parameter_id: "parameter-0", min_value: 6.5, max_value: 8.5, severity_label: "safe" }, // pH
    { parameter_id: "parameter-1", min_value: 0, max_value: 500, severity_label: "safe" },    // TDS
    { parameter_id: "parameter-2", min_value: 0, max_value: 10, severity_label: "safe" },     // Turbidity
    { parameter_id: "parameter-3", min_value: 20, max_value: 32, severity_label: "safe" },    // Temperature
  ];

  const rows = [];
  // 5 days of data: 1 reading every 1 hour
  const totalHours = 5 * 24;
  for (let h = totalHours; h >= 0; h--) {
    const timestamp = now - h * 60 * 60 * 1000;
    rows.push(makeReading("pH", 7.2, timestamp, 0));
    rows.push(makeReading("TDS", 120, timestamp, 1));
    rows.push(makeReading("Turbidity", 3.5, timestamp, 2));
    rows.push(makeReading("Temperature", 26.5, timestamp, 3));
  }

  // 3-day window (3 days * 24h = 72h + 1 reading = 73 readings)
  const summary3d = buildSensorSummary(rows, dynamicThresholds, 3, now);
  assert.equal(summary3d.windowDays, 3);
  assert.equal(summary3d.overallBadge, "optimal");
  assert.equal(summary3d.parameterStats["pH"].count, 3 * 24 + 1);
  assert.equal(summary3d.parameterStats["pH"].mean.toFixed(2), "7.20");
  assert.equal(summary3d.parameterStats["Turbidity"].mean.toFixed(2), "3.50");

  // 5-day window (5 days * 24h = 120h + 1 reading = 121 readings)
  const summary5d = buildSensorSummary(rows, dynamicThresholds, 5, now);
  assert.equal(summary5d.windowDays, 5);
  assert.equal(summary5d.overallBadge, "optimal");
  assert.equal(summary5d.parameterStats["pH"].count, 5 * 24 + 1);
});

test("buildSensorSummary generates cross-parameter runoff warning dynamically", () => {
  const rows = [];
  // Turbidity elevated, TDS rising
  for (let h = 24; h >= 0; h--) {
    const timestamp = now - h * 60 * 60 * 1000;
    rows.push(makeReading("pH", 7.0, timestamp));
    rows.push(makeReading("Turbidity", 15.0, timestamp));
    rows.push(makeReading("TDS", 200 + (24 - h) * 10, timestamp)); // Rising TDS
    rows.push(makeReading("Temperature", 25.0, timestamp));
  }

  const summary = buildSensorSummary(rows, thresholds, 3, now);
  const runoffInterp = summary.interpretations.find((i) => i.id === "turbidity-tds-runoff");
  assert.ok(runoffInterp, "Should trigger turbidity + TDS runoff interpretation");
  assert.match(runoffInterp.text, /particulate runoff/i);
});
