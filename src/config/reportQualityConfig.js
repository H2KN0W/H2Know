/**
 * reportQualityConfig.js
 * Configurable thresholds and limits for Water Quality Telemetry QC,
 * DAO 2016-08 / DAO 2021-19 Class C standards, and telemetry sufficiency rules.
 */

export const QC_FLAGS = {
  OUT_OF_RANGE: "OUT_OF_RANGE",
  SATURATED: "SATURATED",
  STUCK: "STUCK",
  EXACT_ZERO: "EXACT_ZERO",
  RATE_OF_CHANGE: "RATE_OF_CHANGE",
  WARMUP: "WARMUP",
};

export const QC_DESCRIPTIONS = {
  OUT_OF_RANGE: "Outside physical or valid sensor measurement scale",
  SATURATED: "Reached full-scale saturation limit of sensor hardware",
  STUCK: "Value remained invariant for consecutive intervals",
  EXACT_ZERO: "Unsubmerged or unpowered zero signal",
  RATE_OF_CHANGE: "Rate of change exceeded plausible physical maximum per minute",
  WARMUP: "Recorded inside sensor settling or warmup window",
};

/**
 * Quality Control thresholds per water parameter.
 * - range: [min, max] plausible physical reading bounds
 * - saturationValue: upper electrical clipping value (e.g. 3000 NTU for typical optical probe)
 * - stuckThreshold: number of consecutive identical values before flagging
 * - flagExactZero: true if 0.00 is physically suspect (TDS, Turbidity)
 * - maxRatePerMinute: maximum plausible change rate in units per minute
 * - warmupSeconds: time window in seconds after first detection where readings are tagged warmup
 */
export const PARAMETER_QC_CONFIG = {
  pH: {
    unit: "",
    range: [0.0, 14.0],
    saturationValue: 14.0,
    stuckThreshold: 6,
    flagExactZero: true, // pH 0.00 in a natural river indicates missing/unpowered probe
    maxRatePerMinute: 1.5, // Natural streams do not jump >1.5 pH units in 60s
    warmupSeconds: 0,
  },
  Turbidity: {
    unit: "NTU",
    range: [0.0, 3000.0],
    saturationValue: 3000.0, // Typical optical sensor full-scale limit
    stuckThreshold: 6,
    flagExactZero: true, // Natural river water always has background scatter > 0.00 NTU
    maxRatePerMinute: 500.0, // Turbidity rate-of-change cap (NTU/min)
    warmupSeconds: 0,
  },
  TDS: {
    unit: "ppm",
    range: [0.0, 2000.0],
    saturationValue: 2000.0,
    stuckThreshold: 6,
    flagExactZero: true, // Freshwater stream TDS is never pure deionized 0.00 ppm
    maxRatePerMinute: 150.0,
    warmupSeconds: 0,
  },
  Temperature: {
    unit: "°C",
    range: [0.0, 50.0],
    saturationValue: 50.0,
    stuckThreshold: 10,
    flagExactZero: true, // Stream temperature is not 0.00 °C in tropical Bukidnon
    maxRatePerMinute: 2.0, // River temperature changes slowly
    warmupSeconds: 0,
  },
};

/**
 * Regulatory Water Quality Compliance Thresholds:
 * DENR Administrative Order (DAO) 2016-08 & DAO 2021-19 Class C Waters (Fishery, Agriculture, Recreation).
 *
 * NOTE ON DAO 2016-08 / 2021-19:
 * - pH: 6.5 – 9.0
 * - Temperature: 25.0 – 31.0 °C (maximum allowable rise is 3 °C above ambient baseline)
 * - TDS: <= 1000 ppm (Class C standard)
 * - Turbidity: DAO 2016-08 specifies TSS (Total Suspended Solids) <= 80 mg/L.
 *   Standard field surrogate guideline for freshwater Class C stream turbidity is <= 50 NTU.
 *   // TODO: Confirm regional watershed-specific NTU threshold with EMB Region 10 if specific NTU baseline ordinance applies.
 */
export const DENR_CLASS_C_THRESHOLDS = {
  pH: {
    min: 6.5,
    max: 9.0,
    unit: "",
    standardName: "DAO 2016-08 / DAO 2021-19 Table 3 (Class C)",
  },
  Turbidity: {
    min: 0.0,
    max: 50.0, // Standard Class C surrogate guideline
    unit: "NTU",
    standardName: "DAO 2016-08 TSS Guideline Surrogate (Class C: <= 50 NTU)",
    // TODO: Confirm with EMB Region 10 if a local NTU criteria exists.
  },
  TDS: {
    min: 0.0,
    max: 1000.0,
    unit: "ppm",
    standardName: "DAO 2016-08 Table 3 (Class C: <= 1000 mg/L TDS)",
  },
  Temperature: {
    min: 25.0,
    max: 31.0,
    unit: "°C",
    standardName: "DAO 2016-08 Table 3 (Class C: 25.0 – 31.0 °C)",
  },
};

/**
 * Telemetry Sufficiency Requirements:
 * Used to classify whether a reporting period has enough data to make scientific compliance claims.
 */
export const TELEMETRY_SUFFICIENCY_CONFIG = {
  minValidReadings: 20,          // Minimum number of valid (unflagged) readings
  minCoverageHours: 12.0,        // Minimum time spread (hours) between first and last reading
  maxGapMinutes: 180,            // Maximum allowable time gap between consecutive readings (3 hours)
  staleThresholdHours: 48,       // Readings older than this relative to now are marked as stale
};

/**
 * Status Enums & Severity Priorities
 */
export const STATUS_CODES = {
  COMPLIANT: "COMPLIANT",
  EXCEEDANCE: "EXCEEDANCE",
  DATA_SUSPECT: "DATA SUSPECT",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA",
  INSUFFICIENT_TELEMETRY: "INSUFFICIENT TELEMETRY",
};

/**
 * Severity priority order:
 * EXCEEDANCE > DATA SUSPECT > INSUFFICIENT DATA > COMPLIANT
 */
export const STATUS_PRIORITY = {
  [STATUS_CODES.EXCEEDANCE]: 4,
  [STATUS_CODES.DATA_SUSPECT]: 3,
  [STATUS_CODES.INSUFFICIENT_DATA]: 2,
  [STATUS_CODES.INSUFFICIENT_TELEMETRY]: 2,
  [STATUS_CODES.COMPLIANT]: 1,
};
