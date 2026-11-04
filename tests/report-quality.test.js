import test from "node:test";
import assert from "node:assert/strict";
import {
  runDataQualityQC,
  evaluateReportCompliance,
  generateReportNarratives,
  toCanonicalParam,
} from "../src/lib/reportAnalytics.js";
import {
  QC_FLAGS,
  STATUS_CODES,
  DENR_CLASS_C_THRESHOLDS,
} from "../src/config/reportQualityConfig.js";

// Helper to generate timestamps
const makeTime = (baseIso, offsetMinutes) => {
  const t = new Date(baseIso).getTime() + offsetMinutes * 60 * 1000;
  return new Date(t).toISOString();
};

test("Fixture 1: Turbidity square-wave series [80, 80, 0, 0, 3000, 0, 3000...] must NOT produce compliant or stable claims", () => {
  const baseTime = "2026-10-15T08:00:00.000Z";
  const rawValues = [80, 80, 0, 0, 3000, 0, 3000, 0, 0, 0, 80, 80, 0, 3000, 0];
  const readings = rawValues.map((val, idx) => ({
    parameter_id: "param-turb",
    paramName: "Turbidity",
    value: val,
    recorded_at: makeTime(baseTime, idx * 8), // 8-minute intervals
  }));

  const qc = runDataQualityQC(readings);
  assert.equal(qc.length, readings.length);

  // Check that zeros and 3000 saturations are flagged
  const saturated = qc.filter((r) => r.qcFlag === QC_FLAGS.SATURATED);
  const zeros = qc.filter((r) => r.qcFlag === QC_FLAGS.EXACT_ZERO);
  assert.ok(saturated.length >= 2, "Saturated 3000 NTU readings should be flagged");
  assert.ok(zeros.length >= 5, "Exact zero 0.00 readings should be flagged");

  // Evaluate compliance
  const evalResult = evaluateReportCompliance(qc, ["Turbidity"]);
  const turbResult = evalResult.parameterResults["Turbidity"];

  // Status must be suspect or exceedance, NEVER compliant
  assert.notEqual(turbResult.status, STATUS_CODES.COMPLIANT);
  assert.equal(turbResult.status, STATUS_CODES.DATA_SUSPECT);

  // Excluded readings must not distort min/avg of valid readings
  assert.equal(turbResult.excludedCount, saturated.length + zeros.length);
  assert.equal(turbResult.avg, 80); // Only the valid 80 NTU readings remain

  // Narrative verification: must not contain "compliant" or "stable"
  const narratives = generateReportNarratives(evalResult);
  const narrativeText = narratives.map((n) => `${n.title} ${n.text}`).join(" ").toLowerCase();

  assert.ok(!narrativeText.includes("compliant watershed condition"));
  assert.ok(!narrativeText.includes("steady ionic and physical stability"));
  assert.ok(narrativeText.includes("data quality & telemetry audit") || narrativeText.includes("suspect"));
});

test("Fixture 2: pH series starting at 9.21 and decaying to 7.7 must be flagged and NOT silently produce Normal", () => {
  const baseTime = "2026-10-15T08:00:00.000Z";
  // Series with 9.21 (exceeding DENR 9.0 upper limit), then dropping to normal range
  const rawValues = [
    9.21, 9.15, 9.05, 8.90, 8.70, 8.50, 8.30, 8.10, 8.00, 7.95,
    7.90, 7.85, 7.80, 7.75, 7.70, 7.70, 7.70, 7.70, 7.70, 7.70
  ];
  const readings = rawValues.map((val, idx) => ({
    parameter_id: "param-ph",
    paramName: "pH",
    value: val,
    recorded_at: makeTime(baseTime, idx * 10),
  }));

  const qc = runDataQualityQC(readings);
  const evalResult = evaluateReportCompliance(qc, ["pH"]);
  const phResult = evalResult.parameterResults["pH"];

  // Must detect exceedance
  assert.equal(phResult.status, STATUS_CODES.EXCEEDANCE);
  assert.ok(phResult.exceedanceCount >= 3, "Readings > 9.0 must be counted as exceedances");
  assert.equal(phResult.max, 9.21);

  // Narratives must explicitly report pH exceedance
  const narratives = generateReportNarratives(evalResult);
  const narrativeText = narratives.map((n) => `${n.title} ${n.text}`).join(" ");
  assert.ok(narrativeText.includes("pH Threshold Exceedance"));
  assert.ok(narrativeText.includes("9.21"));
  assert.ok(!narrativeText.includes("All 20 verified pH readings remained fully within Class C standards"));
});

test("Fixture 3: All-zero turbidity probe produces DATA SUSPECT", () => {
  const baseTime = "2026-10-15T08:00:00.000Z";
  const rawValues = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const readings = rawValues.map((val, idx) => ({
    parameter_id: "param-turb",
    paramName: "Turbidity",
    value: val,
    recorded_at: makeTime(baseTime, idx * 5),
  }));

  const qc = runDataQualityQC(readings);
  const evalResult = evaluateReportCompliance(qc, ["Turbidity"]);
  const turbResult = evalResult.parameterResults["Turbidity"];

  assert.equal(turbResult.status, STATUS_CODES.DATA_SUSPECT);
  assert.equal(turbResult.validCount, 0);
  assert.equal(turbResult.excludedCount, 15);
  assert.equal(evalResult.overallStatus, STATUS_CODES.DATA_SUSPECT);
});

test("Fixture 4: Short series (< 20 readings / < 12h) produces INSUFFICIENT TELEMETRY without compliance claims", () => {
  const baseTime = "2026-10-15T08:00:00.000Z";
  // 5 readings spanning 40 minutes with normal pH
  const rawValues = [7.2, 7.3, 7.25, 7.28, 7.31];
  const readings = rawValues.map((val, idx) => ({
    parameter_id: "param-ph",
    paramName: "pH",
    value: val,
    recorded_at: makeTime(baseTime, idx * 10),
  }));

  const qc = runDataQualityQC(readings);
  const evalResult = evaluateReportCompliance(qc, ["pH"]);
  const phResult = evalResult.parameterResults["pH"];

  assert.equal(phResult.status, STATUS_CODES.INSUFFICIENT_DATA);
  assert.equal(evalResult.overallStatus, STATUS_CODES.INSUFFICIENT_DATA);

  const narratives = generateReportNarratives(evalResult);
  const narrativeText = narratives.map((n) => `${n.title} ${n.text}`).join(" ");
  assert.ok(narrativeText.includes("Insufficient Telemetry Coverage"));
  assert.ok(narrativeText.includes("No regulatory compliance claims can be certified"));
});
