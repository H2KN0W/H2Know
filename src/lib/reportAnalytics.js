/**
 * reportAnalytics.js
 * Implements deterministic QC flagging, data-quality segregation,
 * regulatory compliance evaluation, coverage statistics, and dynamic narrative generation.
 */

import {
  QC_FLAGS,
  QC_DESCRIPTIONS,
  PARAMETER_QC_CONFIG,
  DENR_CLASS_C_THRESHOLDS,
  TELEMETRY_SUFFICIENCY_CONFIG,
  STATUS_CODES,
  STATUS_PRIORITY,
} from "../config/reportQualityConfig.js";

/**
 * Normalizes parameter string to canonical name (pH, Turbidity, TDS, Temperature).
 */
export const toCanonicalParam = (name) => {
  if (!name) return "Unknown";
  const lower = String(name).trim().toLowerCase();
  if (lower === "ph") return "pH";
  if (lower === "turbidity") return "Turbidity";
  if (lower === "tds" || lower.includes("dissolved")) return "TDS";
  if (lower === "temperature" || lower === "temp") return "Temperature";
  return String(name).trim();
};

/**
 * Step A: Data-Quality (QC) Layer
 * Analyzes each reading and flags suspect/invalid readings with an appropriate reason code.
 *
 * @param {Array} readings - Array of readings sorted by recorded_at ascending
 * @param {Object} [customConfig] - Optional override for PARAMETER_QC_CONFIG
 * @returns {Array} Array of readings with `qcFlag`, `qcReason`, and `isValid` properties
 */
export const runDataQualityQC = (readings = [], customConfig = PARAMETER_QC_CONFIG) => {
  if (!Array.isArray(readings) || readings.length === 0) return [];

  // Group readings by parameter to evaluate time-series rules (stuck, rate-of-change, warmup)
  const grouped = new Map();
  for (const r of readings) {
    const paramName = toCanonicalParam(r.paramName || r.parameters?.name);
    if (!grouped.has(paramName)) {
      grouped.set(paramName, []);
    }
    grouped.get(paramName).push(r);
  }

  const flaggedResults = [];

  for (const [paramName, paramRows] of grouped.entries()) {
    const config = customConfig[paramName] || {
      range: [-Infinity, Infinity],
      saturationValue: Infinity,
      stuckThreshold: 6,
      flagExactZero: false,
      maxRatePerMinute: Infinity,
      warmupSeconds: 0,
    };

    // Ensure sorted ascending by timestamp
    const sorted = [...paramRows].sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );

    const firstTimestamp = sorted.length > 0 ? new Date(sorted[0].recorded_at).getTime() : 0;
    let consecutiveIdenticalCount = 1;
    let lastValue = null;

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const val = Number(item.value);
      const curTime = new Date(item.recorded_at).getTime();

      let flag = null;
      let reason = null;

      if (!Number.isFinite(val)) {
        flag = QC_FLAGS.OUT_OF_RANGE;
        reason = "Non-finite or missing numeric measurement";
      } else if (config.warmupSeconds > 0 && curTime - firstTimestamp < config.warmupSeconds * 1000) {
        flag = QC_FLAGS.WARMUP;
        reason = `Within initial sensor stabilization window (${config.warmupSeconds}s)`;
      } else if (config.flagExactZero && val === 0.0) {
        flag = QC_FLAGS.EXACT_ZERO;
        reason = `Zero value (0.00) indicates inactive, uncalibrated, or unsubmerged sensor`;
      } else if (val >= config.saturationValue) {
        flag = QC_FLAGS.SATURATED;
        reason = `Value reached or exceeded full-scale saturation limit (${config.saturationValue})`;
      } else if (val < config.range[0] || val > config.range[1]) {
        flag = QC_FLAGS.OUT_OF_RANGE;
        reason = `Value ${val} is outside physical sensor bounds [${config.range[0]}, ${config.range[1]}]`;
      } else if (i > 0) {
        const prevItem = sorted[i - 1];
        const prevVal = Number(prevItem.value);
        const prevTime = new Date(prevItem.recorded_at).getTime();
        const deltaMinutes = (curTime - prevTime) / 60000;

        // Rate of change check
        if (deltaMinutes > 0 && deltaMinutes < 120) {
          const rate = Math.abs(val - prevVal) / deltaMinutes;
          if (rate > config.maxRatePerMinute) {
            flag = QC_FLAGS.RATE_OF_CHANGE;
            reason = `Change rate of ${rate.toFixed(1)} units/min exceeded plausible limit of ${config.maxRatePerMinute}`;
          }
        }

        // Stuck check: count identical values
        if (val === lastValue) {
          consecutiveIdenticalCount++;
          if (consecutiveIdenticalCount >= config.stuckThreshold) {
            flag = QC_FLAGS.STUCK;
            reason = `Identical value repeated across ${consecutiveIdenticalCount} consecutive intervals`;
          }
        } else {
          consecutiveIdenticalCount = 1;
        }
      }

      lastValue = val;

      flaggedResults.push({
        ...item,
        canonicalParam: paramName,
        qcFlag: flag,
        qcReason: reason,
        isValid: flag === null,
      });
    }
  }

  // Restore chronological order across all parameters
  return flaggedResults.sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
};

/**
 * Step B & C: Telemetry Sufficiency & Parameter Compliance Evaluation
 *
 * @param {Array} qcReadings - Readings processed through runDataQualityQC
 * @param {Array} paramNames - List of canonical parameter names requested
 * @param {Object} [thresholdConfig] - Threshold limits per parameter
 * @param {Object} [sufficiencyConfig] - Sufficiency configuration
 * @param {number} [nowMs] - Current timestamp anchor
 */
export const evaluateReportCompliance = (
  qcReadings = [],
  paramNames = [],
  thresholdConfig = DENR_CLASS_C_THRESHOLDS,
  sufficiencyConfig = TELEMETRY_SUFFICIENCY_CONFIG,
  nowMs = Date.now()
) => {
  const paramResults = {};
  let overallWorstScore = 0;
  let overallWorstStatus = STATUS_CODES.INSUFFICIENT_TELEMETRY;

  // Global coverage metrics
  const totalReadings = qcReadings.length;
  const validReadings = qcReadings.filter((r) => r.isValid);
  const excludedReadings = qcReadings.filter((r) => !r.isValid);

  let firstTimestamp = null;
  let lastTimestamp = null;
  let coverageHours = 0;
  let isStale = false;
  let maxGapMinutesObserved = 0;

  if (qcReadings.length > 0) {
    const times = qcReadings.map((r) => new Date(r.recorded_at).getTime());
    firstTimestamp = new Date(Math.min(...times)).toISOString();
    lastTimestamp = new Date(Math.max(...times)).toISOString();
    coverageHours = Math.max(0, (Math.max(...times) - Math.min(...times)) / (1000 * 60 * 60));

    const ageHours = (nowMs - Math.max(...times)) / (1000 * 60 * 60);
    isStale = ageHours > sufficiencyConfig.staleThresholdHours;

    // Calculate max gap between consecutive sorted readings
    const sortedTimes = [...times].sort((a, b) => a - b);
    for (let i = 1; i < sortedTimes.length; i++) {
      const gapMins = (sortedTimes[i] - sortedTimes[i - 1]) / 60000;
      if (gapMins > maxGapMinutesObserved) {
        maxGapMinutesObserved = gapMins;
      }
    }
  }

  for (const pName of paramNames) {
    const canonical = toCanonicalParam(pName);
    const pReadings = qcReadings.filter((r) => r.canonicalParam === canonical);
    const pValid = pReadings.filter((r) => r.isValid);
    const pExcluded = pReadings.filter((r) => !r.isValid);

    const limits = thresholdConfig[canonical] || {
      min: null,
      max: null,
      unit: "",
      standardName: "DAO 2016-08 Class C",
    };

    // Breakdown of exclusions by reason code
    const exclusionsByFlag = {};
    for (const ex of pExcluded) {
      const f = ex.qcFlag || "UNKNOWN";
      exclusionsByFlag[f] = (exclusionsByFlag[f] || 0) + 1;
    }

    // Evaluate sufficiency
    const hasMinReadings = pValid.length >= sufficiencyConfig.minValidReadings;
    const hasMinCoverage = coverageHours >= sufficiencyConfig.minCoverageHours;
    const noExcessiveGaps = maxGapMinutesObserved <= sufficiencyConfig.maxGapMinutes;

    let paramStatus = STATUS_CODES.COMPLIANT;
    let statusReason = "";

    // If more than 50% of the readings were excluded or probe had exact zeros/stuck/saturation
    const severeExclusionRatio = pReadings.length > 0 && pExcluded.length / pReadings.length >= 0.5;
    const hasZeroOrSaturated = pExcluded.some(
      (r) => r.qcFlag === QC_FLAGS.EXACT_ZERO || r.qcFlag === QC_FLAGS.SATURATED
    );

    if (pReadings.length === 0 || (!hasMinReadings && !hasZeroOrSaturated)) {
      paramStatus = STATUS_CODES.INSUFFICIENT_DATA;
      statusReason = `Insufficient telemetry: ${pValid.length} valid readings (minimum ${sufficiencyConfig.minValidReadings} required, ${coverageHours.toFixed(1)}h coverage)`;
    } else if (severeExclusionRatio || hasZeroOrSaturated) {
      paramStatus = STATUS_CODES.DATA_SUSPECT;
      const reasonsList = Object.entries(exclusionsByFlag)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      statusReason = `Data quality suspect: ${pExcluded.length} of ${pReadings.length} readings excluded (${reasonsList})`;
    }

    // Evaluate numerical stats on valid readings
    const validValues = pValid.map((r) => Number(r.value));
    let avg = null;
    let min = null;
    let max = null;
    let exceedanceCount = 0;
    let exceedanceRate = 0;

    if (validValues.length > 0) {
      avg = validValues.reduce((a, b) => a + b, 0) / validValues.length;
      min = Math.min(...validValues);
      max = Math.max(...validValues);

      // Check exceedances against regulatory limits
      for (const v of validValues) {
        const isBelow = limits.min !== null && v < limits.min;
        const isAbove = limits.max !== null && v > limits.max;
        if (isBelow || isAbove) {
          exceedanceCount++;
        }
      }

      exceedanceRate = (exceedanceCount / validValues.length) * 100;

      // Only upgrade to EXCEEDANCE if not already flagged as DATA_SUSPECT due to severe probe corruption
      if (exceedanceCount > 0 && paramStatus !== STATUS_CODES.DATA_SUSPECT) {
        paramStatus = STATUS_CODES.EXCEEDANCE;
        statusReason = `Threshold exceedance: ${exceedanceCount} of ${validValues.length} readings (${exceedanceRate.toFixed(1)}%) outside [${limits.min ?? "—"}, ${limits.max ?? "—"}] ${limits.unit}`;
      } else if (paramStatus === STATUS_CODES.COMPLIANT) {
        statusReason = `100% of ${validValues.length} valid readings within standard limits [${limits.min ?? "—"}, ${limits.max ?? "—"}] ${limits.unit}`;
      }
    }

    // Compare with overall severity rank
    const score = STATUS_PRIORITY[paramStatus] || 0;
    if (score > overallWorstScore) {
      overallWorstScore = score;
      overallWorstStatus = paramStatus;
    }

    paramResults[canonical] = {
      parameterName: canonical,
      unit: limits.unit,
      totalCount: pReadings.length,
      validCount: pValid.length,
      excludedCount: pExcluded.length,
      exclusionsByFlag,
      avg: avg !== null ? Number(avg.toFixed(2)) : "—",
      min: min !== null ? Number(min.toFixed(2)) : "—",
      max: max !== null ? Number(max.toFixed(2)) : "—",
      latest: pValid.length > 0 ? String(pValid[pValid.length - 1].value) : "—",
      exceedanceCount,
      exceedanceRate: Number(exceedanceRate.toFixed(1)),
      status: paramStatus,
      statusReason,
      standardName: limits.standardName,
      limits,
    };
  }

  // Fallback if no parameters requested
  if (paramNames.length === 0) {
    overallWorstStatus = STATUS_CODES.INSUFFICIENT_TELEMETRY;
  }

  return {
    overallStatus: overallWorstStatus,
    coverage: {
      totalReadings,
      validReadings: validReadings.length,
      excludedReadings: excludedReadings.length,
      firstTimestamp,
      lastTimestamp,
      coverageHours: Number(coverageHours.toFixed(1)),
      maxGapMinutes: Number(maxGapMinutesObserved.toFixed(1)),
      isStale,
    },
    parameterResults: paramResults,
  };
};

/**
 * Step D: Dynamic Narrative Generator
 * Generates truthful, evidence-backed narrative statements from computed evaluation results.
 * Contains no hardcoded static reassurance text.
 *
 * @param {Object} evaluation - Output from evaluateReportCompliance
 * @returns {Array<{ id: string, type: 'positive'|'warning'|'critical'|'neutral', title: string, text: string }>}
 */
export const generateReportNarratives = (evaluation) => {
  const narratives = [];
  const { overallStatus, coverage, parameterResults } = evaluation;
  const activeParams = Object.values(parameterResults);

  // 1. Data Coverage & QC Telemetry Integrity Summary
  if (coverage.excludedReadings > 0) {
    const reasons = [];
    for (const p of activeParams) {
      if (p.excludedCount > 0) {
        const flagSummary = Object.entries(p.exclusionsByFlag)
          .map(([flag, cnt]) => `${cnt} ${flag}`)
          .join(", ");
        reasons.push(`${p.parameterName} had ${p.excludedCount} readings excluded (${flagSummary})`);
      }
    }
    narratives.push({
      id: "qc-exclusions",
      type: "warning",
      title: "Data Quality & Telemetry Audit",
      text: `${coverage.excludedReadings} of ${coverage.totalReadings} total readings were excluded from statistics and regulatory assessment due to sensor-level anomalies. Details: ${reasons.join("; ")}.`,
    });
  }

  // 2. Insufficient Telemetry Check
  if (
    overallStatus === STATUS_CODES.INSUFFICIENT_DATA ||
    overallStatus === STATUS_CODES.INSUFFICIENT_TELEMETRY
  ) {
    narratives.push({
      id: "insufficient-telemetry-warning",
      type: "neutral",
      title: "Insufficient Telemetry Coverage",
      text: `Telemetry coverage spans ${coverage.coverageHours} hours with ${coverage.validReadings} valid samples (minimum standard requires ${TELEMETRY_SUFFICIENCY_CONFIG.minValidReadings} valid readings over ${TELEMETRY_SUFFICIENCY_CONFIG.minCoverageHours} hours). No regulatory compliance claims can be certified.`,
    });
  }

  // 3. Per-Parameter Specific Findings
  for (const p of activeParams) {
    if (p.status === STATUS_CODES.EXCEEDANCE) {
      narratives.push({
        id: `${p.parameterName.toLowerCase()}-exceedance`,
        type: "critical",
        title: `${p.parameterName} Threshold Exceedance`,
        text: `${p.parameterName} exceeded ${p.standardName} in ${p.exceedanceCount} of ${p.validCount} valid measurements (${p.exceedanceRate}% of window), recording a peak of ${p.max} ${p.unit} (standard limit: ${p.limits.max} ${p.limits.unit}).`,
      });
    } else if (p.status === STATUS_CODES.DATA_SUSPECT) {
      narratives.push({
        id: `${p.parameterName.toLowerCase()}-suspect`,
        type: "warning",
        title: `${p.parameterName} Probe Diagnostic Warning`,
        text: `${p.parameterName} data is marked SUSPECT: ${p.excludedCount} of ${p.totalCount} readings violated sensor physics or recorded consecutive zero/saturation values, indicating a probe fault, submersion loss, or calibration breakdown.`,
      });
    } else if (p.status === STATUS_CODES.COMPLIANT && p.validCount >= TELEMETRY_SUFFICIENCY_CONFIG.minValidReadings) {
      narratives.push({
        id: `${p.parameterName.toLowerCase()}-compliant`,
        type: "positive",
        title: `${p.parameterName} Regulatory Adherence`,
        text: `All ${p.validCount} verified ${p.parameterName} readings remained fully within Class C standards (${p.limits.min ?? "—"} to ${p.limits.max ?? "—"} ${p.unit}), averaging ${p.avg} ${p.unit}.`,
      });
    }
  }

  // 4. Stale Data Notice
  if (coverage.isStale) {
    narratives.push({
      id: "stale-telemetry-notice",
      type: "warning",
      title: "Telemetry Stale",
      text: `The most recent observation was recorded at ${coverage.lastTimestamp}, which is older than the 48-hour monitoring freshness threshold.`,
    });
  }

  // If literally no observations occurred, add clear notice
  if (narratives.length === 0) {
    narratives.push({
      id: "no-observations",
      type: "neutral",
      title: "Station Status",
      text: "No valid sensor observations were available during the selected reporting period.",
    });
  }

  return narratives;
};

/**
 * Step E-0: Build a sufficiencyConfig object from `report_quality_config` DB rows.
 *
 * Converts rows from the `report_quality_config` table (key/value pairs)
 * into the sufficiencyConfig format required by `evaluateReportCompliance`.
 * Any key not present in the DB falls back to the TELEMETRY_SUFFICIENCY_CONFIG
 * hardcoded default, so the app continues to work even if the table is empty
 * or the fetch fails.
 *
 * @param {Array} dbRows - Rows from report_quality_config: { key: string, value: number }
 * @returns {Object} sufficiencyConfig with minValidReadings, minCoverageHours, maxGapMinutes, staleThresholdHours
 */
export const buildSufficiencyConfig = (dbRows = []) => {
  const lookup = new Map(
    (dbRows || []).map((row) => [String(row.key), Number(row.value)])
  );

  const get = (key, fallback) => {
    const v = lookup.get(key);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  return {
    minValidReadings:    get("min_valid_readings",    TELEMETRY_SUFFICIENCY_CONFIG.minValidReadings),
    minCoverageHours:    get("min_coverage_hours",    TELEMETRY_SUFFICIENCY_CONFIG.minCoverageHours),
    maxGapMinutes:       get("max_gap_minutes",       TELEMETRY_SUFFICIENCY_CONFIG.maxGapMinutes),
    staleThresholdHours: get("stale_threshold_hours", TELEMETRY_SUFFICIENCY_CONFIG.staleThresholdHours),
  };
};

/**
 * Step E: Build a thresholdConfig object from Supabase threshold rows.
 *
 * Converts the Supabase `thresholds` table rows (with `parameter_id`, `min_value`,
 * `max_value`, `severity_label`) into the keyed config format required by
 * `evaluateReportCompliance`.
 *
 * Logic:
 * - Finds the row whose `severity_label` is "normal" or "safe" for each parameter —
 *   this is the passing/compliant band. Its min/max become the compliance limits.
 * - If no normal/safe row exists for a parameter, falls back to DENR_CLASS_C_THRESHOLDS.
 * - `parameters` is the array of `{ id, name, unit }` objects loaded from Supabase.
 *
 * @param {Array} thresholds  - Supabase threshold rows: { parameter_id, min_value, max_value, severity_label }
 * @param {Array} parameters  - Supabase parameter rows: { id, name, unit }
 * @returns {Object} thresholdConfig keyed by canonical parameter name
 */
export const buildThresholdConfig = (thresholds = [], parameters = []) => {
  // Build a quick lookup from parameter_id -> { canonicalName, unit }
  const paramById = new Map();
  for (const p of parameters) {
    const canonical = toCanonicalParam(p.name);
    paramById.set(String(p.id), { canonical, unit: p.unit || "" });
  }

  // Group threshold rows by canonical parameter name
  const grouped = new Map();
  for (const row of thresholds) {
    const info = paramById.get(String(row.parameter_id));
    if (!info) continue;
    if (!grouped.has(info.canonical)) {
      grouped.set(info.canonical, { rows: [], unit: info.unit });
    }
    grouped.get(info.canonical).rows.push(row);
  }

  const SAFE_LABELS = new Set(["normal", "safe", "within", "compliant", "good"]);

  const config = {};
  for (const [canonical, { rows, unit }] of grouped) {
    const denrFallback = DENR_CLASS_C_THRESHOLDS[canonical] || {
      min: null,
      max: null,
      unit,
      standardName: "Database Configuration",
    };

    // Prefer the row labeled as "normal" or "safe"
    const safeRow = rows.find((r) =>
      SAFE_LABELS.has(String(r.severity_label || "").trim().toLowerCase())
    );

    if (safeRow) {
      const min = safeRow.min_value == null ? null : Number(safeRow.min_value);
      const max = safeRow.max_value == null ? null : Number(safeRow.max_value);
      config[canonical] = {
        min: Number.isFinite(min) ? min : denrFallback.min,
        max: Number.isFinite(max) ? max : denrFallback.max,
        unit: unit || denrFallback.unit,
        standardName: "Database Threshold Configuration",
      };
    } else {
      // No safe/normal band found — fall back to DENR defaults but keep the unit
      config[canonical] = { ...denrFallback, unit: unit || denrFallback.unit };
    }
  }

  // For any canonical param not covered by DB rows, fill in DENR defaults
  for (const [canonical, fallback] of Object.entries(DENR_CLASS_C_THRESHOLDS)) {
    if (!config[canonical]) {
      config[canonical] = { ...fallback };
    }
  }

  return config;
};

/**
 * Step F: Badge Colors Matching Status
 */
export const getStatusBadgeStyle = (status) => {
  switch (status) {
    case STATUS_CODES.COMPLIANT:
      return {
        bg: [22, 163, 74],      // #16a34a - Green
        text: [255, 255, 255],
        label: "COMPLIANT",
      };
    case STATUS_CODES.EXCEEDANCE:
      return {
        bg: [220, 38, 38],      // #dc2626 - Red
        text: [255, 255, 255],
        label: "EXCEEDANCE",
      };
    case STATUS_CODES.DATA_SUSPECT:
      return {
        bg: [217, 119, 6],      // #d97706 - Amber/Orange
        text: [255, 255, 255],
        label: "DATA SUSPECT",
      };
    case STATUS_CODES.INSUFFICIENT_DATA:
    case STATUS_CODES.INSUFFICIENT_TELEMETRY:
    default:
      return {
        bg: [100, 116, 139],    // #64748b - Gray / Amber fallback
        text: [255, 255, 255],
        label: status || "INSUFFICIENT TELEMETRY",
      };
  }
};
