import { useState, useEffect, useMemo } from "react";
import {
  Droplets,
  Waves,
  Gauge,
  Thermometer,
  ShieldCheck,
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
} from "lucide-react";
import { ResponsiveContainer, LineChart, Line } from "recharts";
import Skeleton from "react-loading-skeleton";
import { supabase } from "../lib/supabase";
import { SENSOR_CYCLE_INTERVAL_MS, OFFLINE_AFTER_MS } from "../lib/nodeHealth";
import { DENR_CLASS_C_THRESHOLDS } from "../config/reportQualityConfig";
import { formatDateTime } from "../lib/formatters";
import { interpretRange } from "../utils/rangeSummary";

const MONITORED_PARAMS = ["pH", "Turbidity", "TDS", "Temperature"];

const PARAM_META = {
  pH: {
    icon: Droplets,
    color: "#0284c7",
    unit: "",
    decimals: 2,
    threshold: DENR_CLASS_C_THRESHOLDS.pH,
    standardLabel: "Class C: 6.5 – 9.0",
  },
  Turbidity: {
    icon: Waves,
    color: "#0ea5e9",
    unit: "NTU",
    decimals: 1,
    threshold: DENR_CLASS_C_THRESHOLDS.Turbidity,
    standardLabel: "Class C: ≤ 50 NTU",
  },
  TDS: {
    icon: Gauge,
    color: "#6366f1",
    unit: "ppm",
    decimals: 0,
    threshold: DENR_CLASS_C_THRESHOLDS.TDS,
    standardLabel: "Class C: ≤ 1000 ppm",
  },
  Temperature: {
    icon: Thermometer,
    color: "#f59e0b",
    unit: "°C",
    decimals: 1,
    threshold: DENR_CLASS_C_THRESHOLDS.Temperature,
    standardLabel: "Class C: 25.0 – 31.0 °C",
  },
};

const SEVERITY_RANK = { safe: 0, normal: 0, warning: 1, critical: 2, danger: 2 };

const getThresholdSeverity = (threshold) =>
  String(threshold?.severity_label || "").trim().toLowerCase();

const matchesThreshold = (value, threshold) => {
  const minimum = threshold.min_value == null ? null : Number(threshold.min_value);
  const maximum = threshold.max_value == null ? null : Number(threshold.max_value);
  if (minimum != null && !Number.isFinite(minimum)) return false;
  if (maximum != null && !Number.isFinite(maximum)) return false;
  if (minimum == null && maximum == null) return false;
  return (minimum == null || value >= minimum) && (maximum == null || value <= maximum);
};

// Helper: classify a reading value using configured DB thresholds, falling back to DENR Class C
const evaluateReadingSeverity = (paramName, value, thresholdsForParam = []) => {
  const numVal = Number(value);
  if (!Number.isFinite(numVal)) return { state: "unknown", severity: 0 };

  if (thresholdsForParam.length > 0) {
    const matching = thresholdsForParam
      .filter((t) => matchesThreshold(numVal, t))
      .sort((a, b) => {
        const aSpan =
          a.min_value == null || a.max_value == null
            ? Infinity
            : Number(a.max_value) - Number(a.min_value);
        const bSpan =
          b.min_value == null || b.max_value == null
            ? Infinity
            : Number(b.max_value) - Number(b.min_value);
        return (
          aSpan - bSpan ||
          (SEVERITY_RANK[getThresholdSeverity(a)] ?? -1) -
            (SEVERITY_RANK[getThresholdSeverity(b)] ?? -1)
        );
      });

    if (matching.length > 0) {
      const label = getThresholdSeverity(matching[0]);
      const rank = SEVERITY_RANK[label] ?? 0;
      return {
        state: rank === 0 ? "safe" : rank === 1 ? "warning" : "critical",
        severity: rank,
      };
    }
  }

  // Fallback to DENR Class C threshold config
  const standard = DENR_CLASS_C_THRESHOLDS[paramName];
  if (standard) {
    const isSafe =
      (standard.min == null || numVal >= standard.min) &&
      (standard.max == null || numVal <= standard.max);
    return {
      state: isSafe ? "safe" : "warning",
      severity: isSafe ? 0 : 1,
    };
  }

  return { state: "safe", severity: 0 };
};

// Helper: Get Philippine (Asia/Manila) YYYY-MM-DD
function getManilaDateString(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Helper: Get default 7 days range ending today in Manila time
function getDefaultDateRange() {
  const now = new Date();
  const todayStr = getManilaDateString(now);
  const pastDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const startStr = getManilaDateString(pastDate);
  return { start: startStr, end: todayStr };
}

// Helper: Format date for header line "N readings from MMM D, YYYY to MMM D, YYYY (X days)"
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function formatPHDateDisplay(dateStr) {
  if (!dateStr) return "—";
  const clean = String(dateStr).trim().slice(0, 10);
  const [y, m, d] = clean.split("-").map(Number);
  if (!y || !m || !d) return clean;
  return `${SHORT_MONTHS[m - 1]} ${d}, ${y}`;
}

export default function SensorSummaryCard({
  thresholds = [],
  excludeTurbidity = false,
}) {
  const defaults = useMemo(() => getDefaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);

  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  // Take first 10 characters to build clean YYYY-MM-DD without appending bug
  const cleanStart = (startDate || "").trim().slice(0, 10);
  const cleanEnd = (endDate || "").trim().slice(0, 10);

  // Validate dates
  const validationError = useMemo(() => {
    if (!cleanStart || !cleanEnd) return "Please choose a start and end date.";
    if (cleanEnd < cleanStart) return "End date must be after the start date";

    const [sy, sm, sd] = cleanStart.split("-").map(Number);
    const [ey, em, ed] = cleanEnd.split("-").map(Number);
    const sDate = new Date(Date.UTC(sy, sm - 1, sd));
    const eDate = new Date(Date.UTC(ey, em - 1, ed));
    const days = Math.round((eDate - sDate) / (1000 * 60 * 60 * 24)) + 1;

    if (days > 31) return "Please choose 31 days or less";
    return "";
  }, [cleanStart, cleanEnd]);

  // Compute calendar days count
  const daysCount = useMemo(() => {
    if (validationError || !cleanStart || !cleanEnd) return 0;
    const [sy, sm, sd] = cleanStart.split("-").map(Number);
    const [ey, em, ed] = cleanEnd.split("-").map(Number);
    const sDate = new Date(Date.UTC(sy, sm - 1, sd));
    const eDate = new Date(Date.UTC(ey, em - 1, ed));
    return Math.max(1, Math.round((eDate - sDate) / (1000 * 60 * 60 * 24)) + 1);
  }, [cleanStart, cleanEnd, validationError]);

  // Fetch readings for range
  useEffect(() => {
    if (validationError) {
      setReadings([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    const abortController = new AbortController();

    async function loadRangeData() {
      setLoading(true);
      setFetchError("");

      try {
        const isoFrom = `${cleanStart}T00:00:00.000+08:00`;
        const isoTo = `${cleanEnd}T23:59:59.999+08:00`;

        let allRows = [];
        let fromIndex = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from("sensor_readings")
            .select("parameter_id, value, recorded_at, parameters(name, unit)")
            .gte("recorded_at", isoFrom)
            .lte("recorded_at", isoTo)
            .order("recorded_at", { ascending: true })
            .range(fromIndex, fromIndex + pageSize - 1);

          if (abortController.signal.aborted) return;

          if (error) throw error;

          const chunk = data || [];
          allRows = allRows.concat(chunk);

          if (chunk.length < pageSize) {
            hasMore = false;
          } else {
            fromIndex += pageSize;
          }
        }

        if (isMounted) {
          setReadings(allRows);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Ground truth summary fetch error:", err);
          setFetchError(err.message || "Could not load readings for this range.");
          setLoading(false);
        }
      }
    }

    loadRangeData();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [cleanStart, cleanEnd, validationError, retryKey]);

  // Calculate distinct timestamps, coverage, gap, and parameter statistics
  const summaryData = useMemo(() => {
    if (!readings || readings.length === 0 || daysCount === 0) {
      return null;
    }

    // Filter to monitored parameters (respecting excludeTurbidity)
    const validRows = readings.filter((r) => {
      const pName = r.parameters?.name;
      if (!pName) return false;
      const match = MONITORED_PARAMS.find(
        (mp) => mp.toLowerCase() === pName.toLowerCase()
      );
      if (!match) return false;
      if (excludeTurbidity && match === "Turbidity") return false;
      const v = Number(r.value);
      return Number.isFinite(v);
    });

    // Number of readings = count of DISTINCT recorded_at values
    const distinctTimesMap = new Map();
    for (const r of validRows) {
      if (!r.recorded_at) continue;
      distinctTimesMap.set(r.recorded_at, new Date(r.recorded_at).getTime());
    }

    const distinctTimestamps = Array.from(distinctTimesMap.values()).sort(
      (a, b) => a - b
    );
    const totalDistinctReadings = distinctTimestamps.length;

    // Coverage calculation: expected readings = days x 48 (based on 30m SENSOR_CYCLE_INTERVAL_MS)
    const readingsPerDay = Math.round((24 * 60 * 60 * 1000) / SENSOR_CYCLE_INTERVAL_MS); // 48
    const expectedReadings = daysCount * readingsPerDay;
    const rawCoverage = expectedReadings > 0 ? (totalDistinctReadings / expectedReadings) * 100 : 0;
    const coveragePercent = Math.min(100, Math.round(rawCoverage * 10) / 10);

    // Longest gap calculation (> OFFLINE_AFTER_MS or 90 minutes)
    const gapThresholdMs = Math.max(OFFLINE_AFTER_MS, 90 * 60 * 1000); // 90 min
    let longestGapMs = 0;
    let longestGapStart = null;

    for (let i = 0; i < distinctTimestamps.length - 1; i++) {
      const gap = distinctTimestamps[i + 1] - distinctTimestamps[i];
      if (gap > longestGapMs && gap > gapThresholdMs) {
        longestGapMs = gap;
        longestGapStart = new Date(distinctTimestamps[i]).toISOString();
      }
    }

    // Group rows by monitored parameter
    const parameterStats = {};

    for (const param of MONITORED_PARAMS) {
      if (excludeTurbidity && param === "Turbidity") {
        parameterStats[param] = {
          count: 0,
          unit: PARAM_META[param].unit,
          isExcluded: true,
        };
        continue;
      }

      const pRows = validRows.filter(
        (r) => r.parameters?.name?.toLowerCase() === param.toLowerCase()
      );

      if (pRows.length === 0) {
        parameterStats[param] = {
          count: 0,
          unit: PARAM_META[param].unit,
          sparklineData: [],
        };
        continue;
      }

      const values = pRows.map((r) => Number(r.value));
      const count = values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const sum = values.reduce((acc, v) => acc + v, 0);
      const mean = sum / count;

      const latestRow = pRows[pRows.length - 1];
      const latest = Number(latestRow.value);
      const latestTime = latestRow.recorded_at;

      // Classify each reading against thresholds
      const paramThresholds = thresholds.filter(
        (t) => t.parameters?.name?.toLowerCase() === param.toLowerCase()
      );

      let safeCount = 0;
      let warningCount = 0;
      let criticalCount = 0;

      for (const val of values) {
        const evalResult = evaluateReadingSeverity(param, val, paramThresholds);
        if (evalResult.state === "safe") safeCount++;
        else if (evalResult.state === "warning") warningCount++;
        else if (evalResult.state === "critical") criticalCount++;
      }

      const safePercent = (safeCount / count) * 100;
      const warningPercent = (warningCount / count) * 100;
      const criticalPercent = (criticalCount / count) * 100;

      // Trend: compare average of first third of the range with the last third
      // (up, down, steady if change is under 5%)
      let trend = "steady";
      if (count >= 6) {
        const thirdSize = Math.max(1, Math.floor(count / 3));
        const firstThirdAvg =
          values.slice(0, thirdSize).reduce((acc, v) => acc + v, 0) / thirdSize;
        const lastThirdAvg =
          values.slice(count - thirdSize).reduce((acc, v) => acc + v, 0) / thirdSize;

        if (firstThirdAvg !== 0) {
          const delta = ((lastThirdAvg - firstThirdAvg) / Math.abs(firstThirdAvg)) * 100;
          if (Math.abs(delta) >= 5) {
            trend = delta > 0 ? "up" : "down";
          }
        }
      }

      // Sparkline downsampled data (up to 40 points)
      const sparkStep = Math.max(1, Math.floor(count / 40));
      const sparklineData = [];
      for (let i = 0; i < count; i += sparkStep) {
        sparklineData.push({ value: values[i] });
      }

      parameterStats[param] = {
        count,
        min,
        max,
        mean,
        latest,
        latestTime,
        safePercent,
        warningPercent,
        criticalPercent,
        trend,
        unit: pRows[0]?.parameters?.unit || PARAM_META[param].unit,
        sparklineData,
      };
    }

    // Call rule-based interpretation
    const interpretation = interpretRange({
      totalDistinctReadings,
      days: daysCount,
      parameterStats,
    });

    return {
      totalDistinctReadings,
      daysCount,
      coveragePercent,
      longestGapMs,
      longestGapStart,
      parameterStats,
      interpretation,
    };
  }, [readings, daysCount, thresholds, excludeTurbidity]);

  const handleClear = () => {
    const d = getDefaultDateRange();
    setStartDate(d.start);
    setEndDate(d.end);
  };

  return (
    <section
      className="sensor-summary-card"
      aria-label="Ground truth sensor reading summary and interpretation"
    >
      {/* ── Header: Title & Reused Range Filter ── */}
      <div className="summary-card-header">
        <div className="summary-card-title-group">
          <div className="summary-card-badge-row">
            <span className="summary-card-eyebrow">Ground Truth Summary</span>
            {summaryData && !loading && (
              <span
                className={`summary-status-badge badge-${
                  summaryData.interpretation.overallStatus === "within"
                    ? "optimal"
                    : summaryData.interpretation.overallStatus === "warning"
                    ? "moderate"
                    : "stressed"
                }`}
              >
                {summaryData.interpretation.overallStatus === "within" && (
                  <ShieldCheck size={14} className="badge-icon" />
                )}
                {summaryData.interpretation.overallStatus === "warning" && (
                  <Info size={14} className="badge-icon" />
                )}
                {summaryData.interpretation.overallStatus === "concern" && (
                  <AlertTriangle size={14} className="badge-icon" />
                )}
                {summaryData.interpretation.overallBadge}
              </span>
            )}
          </div>
          <h2 className="summary-card-title">Watershed Observation & Empirical Baseline</h2>
          <p className="summary-card-subtitle">
            Actual stored sensor telemetry across the user-selected date range.
          </p>
        </div>

        {/* Reused manager date range picker */}
        <div className="manager-filters range-summary-picker">
          <label>
            From{" "}
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Range start date"
            />
          </label>
          <label>
            To{" "}
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="Range end date"
            />
          </label>
          <button type="button" onClick={handleClear} className="summary-clear-btn">
            Reset
          </button>
        </div>
      </div>

      {/* ── Validation Error State ── */}
      {validationError && (
        <div className="range-summary-feedback feedback-validation">
          <AlertTriangle size={16} />
          <span>{validationError}</span>
        </div>
      )}

      {/* ── Fetch Error State with Retry Button ── */}
      {!validationError && fetchError && (
        <div className="range-summary-feedback feedback-error">
          <AlertTriangle size={16} />
          <span>{fetchError}</span>
          <button
            type="button"
            className="summary-retry-btn"
            onClick={() => setRetryKey((k) => k + 1)}
          >
            <RefreshCw size={13} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* ── Loading Skeleton State ── */}
      {loading && !validationError && !fetchError && (
        <div className="range-summary-loading">
          <div className="summary-meta-skeleton">
            <Skeleton width={320} height={18} />
            <Skeleton width={240} height={14} style={{ marginTop: 6 }} />
          </div>
          <div className="summary-parameters-grid">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="param-stat-cell is-loading">
                <Skeleton width={90} height={16} />
                <Skeleton width={120} height={28} style={{ margin: "12px 0 6px" }} />
                <Skeleton width="100%" height={40} borderRadius={6} />
                <Skeleton width={150} height={12} style={{ marginTop: 10 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {!loading && !validationError && !fetchError && (!summaryData || summaryData.totalDistinctReadings === 0) && (
        <div className="range-summary-empty">
          <p>
            No readings in this range ({formatPHDateDisplay(cleanStart)} to{" "}
            {formatPHDateDisplay(cleanEnd)}).
          </p>
        </div>
      )}

      {/* ── Populated State ── */}
      {!loading && !validationError && !fetchError && summaryData && summaryData.totalDistinctReadings > 0 && (
        <>
          {/* Header Line & Data Coverage */}
          <div className="range-summary-meta-block">
            <div className="meta-primary-line">
              <strong>
                {summaryData.totalDistinctReadings.toLocaleString()}{" "}
                {summaryData.totalDistinctReadings === 1 ? "reading" : "readings"}
              </strong>{" "}
              from {formatPHDateDisplay(cleanStart)} to {formatPHDateDisplay(cleanEnd)} (
              {summaryData.daysCount} {summaryData.daysCount === 1 ? "day" : "days"})
            </div>

            <div className="meta-coverage-line">
              <span>
                Data coverage: <strong>{summaryData.coveragePercent}%</strong> of expected
                readings
              </span>
              {summaryData.longestGapMs > 0 && summaryData.longestGapStart && (
                <span className="meta-gap-info">
                  · Longest gap:{" "}
                  <strong>{Math.round(summaryData.longestGapMs / (60 * 1000))} mins</strong>{" "}
                  (started {formatDateTime(summaryData.longestGapStart)})
                </span>
              )}
            </div>

            {summaryData.coveragePercent < 80 && (
              <div className="meta-coverage-warning">
                <Info size={14} />
                <span>
                  Some readings are missing, so this summary may not show every change.
                </span>
              </div>
            )}
          </div>

          {/* Plain-Language Rule-Based Interpretations */}
          <div className="summary-interpretations-list">
            <div
              className={`interpretation-bubble type-${
                summaryData.interpretation.overallStatus === "within"
                  ? "positive"
                  : "warning"
              }`}
            >
              <div className="interpretation-icon-wrap">
                {summaryData.interpretation.overallStatus === "within" ? (
                  <ShieldCheck size={16} className="text-emerald-500" />
                ) : (
                  <AlertTriangle size={16} className="text-amber-500" />
                )}
              </div>
              <div className="interpretation-content">
                <span className="interpretation-title">Summary:</span>
                <span className="interpretation-text">
                  {summaryData.interpretation.overallLine}
                </span>
              </div>
            </div>

            {summaryData.interpretation.crossNote && (
              <div className="interpretation-bubble type-warning">
                <div className="interpretation-icon-wrap">
                  <Info size={16} className="text-amber-500" />
                </div>
                <div className="interpretation-content">
                  <span className="interpretation-title">Cross-Parameter Note:</span>
                  <span className="interpretation-text">
                    {summaryData.interpretation.crossNote}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Compact Parameter Cards (2 columns on desktop, 1 on mobile) */}
          <div className="summary-parameters-grid">
            {MONITORED_PARAMS.map((param) => {
              const meta = PARAM_META[param];
              const stats = summaryData.parameterStats[param];
              const IconComponent = meta.icon;

              if (!stats || stats.isExcluded) {
                return (
                  <div key={param} className="param-stat-cell is-empty">
                    <div className="param-stat-top">
                      <span className="param-name">
                        <IconComponent size={15} style={{ color: meta.color }} />
                        {param}
                      </span>
                      <span className="param-status-pill pill-empty">Offline</span>
                    </div>
                    <div className="param-stat-body">
                      <span className="param-empty-hint">Sensor Offline</span>
                    </div>
                  </div>
                );
              }

              if (stats.count === 0) {
                return (
                  <div key={param} className="param-stat-cell is-empty">
                    <div className="param-stat-top">
                      <span className="param-name">
                        <IconComponent size={15} style={{ color: meta.color }} />
                        {param}
                      </span>
                      <span className="param-status-pill pill-empty">No Telemetry</span>
                    </div>
                    <div className="param-stat-body">
                      <span className="param-empty-hint">
                        No readings in this range
                      </span>
                    </div>
                  </div>
                );
              }

              const paramSentence = summaryData.interpretation.parameterLines[param];
              const isSafeBand = stats.safePercent >= 95;

              return (
                <div
                  key={param}
                  className={`param-stat-cell ${
                    isSafeBand
                      ? "state-normal"
                      : stats.criticalPercent > 0
                      ? "state-critical"
                      : "state-warning"
                  }`}
                >
                  <div className="param-stat-top">
                    <span className="param-name">
                      <IconComponent size={15} style={{ color: meta.color }} />
                      {param}
                    </span>
                    <span
                      className={`param-status-pill ${
                        isSafeBand
                          ? "pill-optimal"
                          : stats.criticalPercent > 0
                          ? "pill-stressed"
                          : "pill-moderate"
                      }`}
                    >
                      {stats.safePercent.toFixed(0)}% in safe range
                    </span>
                  </div>

                  <div className="param-stat-metrics">
                    <div className="param-metric-item">
                      <span className="metric-label">Latest</span>
                      <span className="metric-val">
                        {stats.latest.toFixed(meta.decimals)}{" "}
                        <small>{stats.unit}</small>
                      </span>
                      {stats.latestTime && (
                        <span className="metric-subtime">
                          {formatDateTime(stats.latestTime)}
                        </span>
                      )}
                    </div>

                    <div className="param-metric-item">
                      <span className="metric-label">Min / Avg / Max</span>
                      <span className="metric-val range-val">
                        {stats.min.toFixed(meta.decimals)} /{" "}
                        {stats.mean.toFixed(meta.decimals)} /{" "}
                        {stats.max.toFixed(meta.decimals)}
                      </span>
                      <span className="metric-subtime">{meta.standardLabel}</span>
                    </div>

                    <div className="param-metric-item">
                      <span className="metric-label">Range Trend</span>
                      <div className="drift-badge">
                        {stats.trend === "up" && (
                          <>
                            <TrendingUp size={13} className="text-amber-500" />
                            <span className="drift-text">Trending Up</span>
                          </>
                        )}
                        {stats.trend === "down" && (
                          <>
                            <TrendingDown size={13} className="text-blue-500" />
                            <span className="drift-text">Trending Down</span>
                          </>
                        )}
                        {stats.trend === "steady" && (
                          <>
                            <Minus size={13} className="text-slate-400" />
                            <span className="drift-text">Steady (±5%)</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Small sparkline with Recharts */}
                  {stats.sparklineData && stats.sparklineData.length >= 2 && (
                    <div className="param-sparkline-wrap">
                      <ResponsiveContainer width="100%" height={32}>
                        <LineChart data={stats.sparklineData}>
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={meta.color}
                            strokeWidth={1.8}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Parameter plain-language interpretation */}
                  {paramSentence && (
                    <div className="param-interpretation-line">
                      <span>{paramSentence}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
