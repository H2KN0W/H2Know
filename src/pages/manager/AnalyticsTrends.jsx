import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { ExternalLink } from "lucide-react";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/AnalyticsTrends.css";
import { PAGE_SIZES, filterMonitoredParameters, THRESHOLDS } from "../../config/constants";
import {
  PageTransition,
  SkeletonChart,
  SkeletonTableRows,
  AnimatedRow,
} from "../../components/ui";
import {
  normalizeDateRange,
  calculateStats,
  downsampleTimeSeries,
  insertGapMarkers,
  fetchAllPagedReadings,
  formatManilaDateTime,
  formatManilaChartTick,
} from "../../lib/analyticsUtils";

const PAGE_SIZE = PAGE_SIZES.DEFAULT;
const ALL_VALUE = "all";

const LINE_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#14B8A6"];

const PARAMETER_COLORS = {
  pH: "#3B82F6",
  Temperature: "#F59E0B",
  TDS: "#10B981",
  Turbidity: "#EF4444",
};

const getLineColor = (paramName, index) =>
  PARAMETER_COLORS[paramName] || LINE_COLORS[index % LINE_COLORS.length];

const bandName = (severity) => {
  const value = (severity || "").toLowerCase();
  if (value === "warning") return "Warning";
  if (value === "critical" || value === "danger" || value === "elevated" || value === "exceeded") return "Exceeded";
  return "Safe";
};

const ThresholdInfoPopover = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div
        className="threshold-popover-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="threshold-popover"
        role="dialog"
        aria-modal="true"
        aria-label="Water Quality Standards Reference"
      >
        <button
          className="threshold-popover-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h4 className="threshold-popover-title">Water Quality Standards Reference</h4>
        <div className="threshold-popover-table-container">
          <table className="threshold-popover-table">
            <thead>
              <tr>
                <th style={{ width: "12%" }}>Parameter</th>
                <th style={{ width: "14%" }}>Safe Range</th>
                <th style={{ width: "8%" }}>Unit</th>
                <th style={{ width: "24%" }}>Standard</th>
                <th style={{ width: "42%" }}>Regulatory Document</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(THRESHOLDS).map((t) => {
                const safeRangeStr =
                  t.min != null && t.max != null
                    ? `${t.min} – ${t.max}`
                    : t.max != null
                    ? `Up to ${t.max}`
                    : `Min ${t.min}`;
                return (
                  <tr key={t.label}>
                    <td data-label="Parameter">
                      <strong>{t.label}</strong>
                    </td>
                    <td data-label="Safe Range">
                      <span className="threshold-safe-val">{safeRangeStr}</span>
                    </td>
                    <td data-label="Unit">{t.unit || "—"}</td>
                    <td data-label="Standard">
                      <span
                        className={`threshold-label-badge ${
                          t.official ? "official" : "system"
                        }`}
                      >
                        {t.standardLabel || (t.official ? "DENR Standard" : "System Alert")}
                      </span>
                    </td>
                    <td data-label="Regulatory Document">
                      {t.url ? (
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="threshold-source-link"
                          title={t.fullCitation || `View ${t.source}`}
                        >
                          <span className="threshold-source-text">{t.source}</span>
                          <ExternalLink size={12} className="threshold-link-icon" />
                        </a>
                      ) : (
                        <span className="threshold-source-plain" title={t.fullCitation || t.source}>
                          {t.source}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

const AnalyticsTrends = () => {
  useLogPageView("Viewed Analytics & Trends");

  const [parameters, setParameters] = useState([]);
  const [parameterId, setParameterId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [validationError, setValidationError] = useState("");
  const [readings, setReadings] = useState([]);
  const [thresholds, setThresholds] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const isAll = parameterId === ALL_VALUE;

  useEffect(() => {
    supabase
      .from("parameters")
      .select("id, name, unit")
      .order("name")
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError("Could not load parameters.");
        } else {
          setParameters(filterMonitoredParameters(data));
          setParameterId(ALL_VALUE);
        }
      });
  }, []);

  // Compute normalized date range from user inputs
  const dateRangeInfo = useMemo(() => {
    return normalizeDateRange(dateFrom, dateTo);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!parameterId) return;

    if (!dateRangeInfo.isValid) {
      setValidationError(dateRangeInfo.error || "Invalid date range");
      setReadings([]);
      setLoading(false);
      return;
    }

    setValidationError("");
    let isCancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        let thresholdQuery = supabase
          .from("thresholds")
          .select("parameter_id, min_value, max_value, severity_label");

        if (!isAll) {
          thresholdQuery = thresholdQuery.eq("parameter_id", parameterId);
        }

        const [pagedReadings, thresholdResult] = await Promise.all([
          fetchAllPagedReadings(supabase, {
            parameterId: isAll ? null : parameterId,
            isoFrom: dateRangeInfo.isoFrom,
            isoTo: dateRangeInfo.isoTo,
            pageSize: 1000,
          }),
          thresholdQuery,
        ]);

        if (isCancelled) return;

        if (thresholdResult.error) {
          throw thresholdResult.error;
        }

        // pagedReadings is ordered recorded_at ASC
        // readings state keeps newest-first (DESC) for the reading table
        const descReadings = pagedReadings.slice().reverse();

        setReadings(descReadings);
        setThresholds(thresholdResult.data || []);
        setPage(1);
      } catch (err) {
        if (isCancelled) return;
        console.error("Analytics fetch error:", err);
        setError("Could not load analytics data.");
        setReadings([]);
        setThresholds([]);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isCancelled = true;
    };
  }, [parameterId, dateRangeInfo, isAll]);

  // Single parameter statistics calculated on full filtered dataset
  const singleStats = useMemo(() => {
    if (isAll) return null;
    return calculateStats(readings);
  }, [readings, isAll]);

  // Per-parameter statistics (for All Parameters view) calculated on full filtered dataset
  const statsByParam = useMemo(() => {
    if (!isAll) return {};
    const map = {};
    parameters.forEach((param) => {
      const paramReadings = readings.filter(
        (r) =>
          r.parameter_id === param.id ||
          r.parameters?.name?.toLowerCase() === param.name?.toLowerCase()
      );
      map[param.name] = calculateStats(paramReadings);
    });
    return map;
  }, [parameters, readings, isAll]);

  // Overall Severity Bands Distribution
  const bands = useMemo(() => {
    const counts = { Safe: 0, Warning: 0, Exceeded: 0 };
    readings.forEach((reading) => {
      const relevantThresholds = isAll
        ? thresholds.filter((t) => t.parameter_id === reading.parameter_id)
        : thresholds;
      const match = relevantThresholds.find(
        (threshold) =>
          (threshold.min_value == null ||
            Number(reading.value) >= Number(threshold.min_value)) &&
          (threshold.max_value == null ||
            Number(reading.value) <= Number(threshold.max_value))
      );
      counts[bandName(match?.severity_label)] += 1;
    });
    return counts;
  }, [readings, thresholds, isAll]);

  const selected = parameters.find((item) => item.id === parameterId);
  const totalPages = Math.max(1, Math.ceil(readings.length / PAGE_SIZE));
  const pageRows = readings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Chronological order (oldest to newest) for chart timeline
  const chronologicalReadings = useMemo(() => readings.slice().reverse(), [readings]);

  // Single chart data: downsampled (if >2,000 points) + 3hr gap markers
  const singleChartRows = useMemo(() => {
    if (isAll) return [];
    const downsampled = downsampleTimeSeries(chronologicalReadings, 2000);
    return downsampled.map((item) => ({
      time: formatManilaChartTick(item.recorded_at),
      fullTime: formatManilaDateTime(item.recorded_at),
      value: item.value,
      isGap: item.isGap,
    }));
  }, [chronologicalReadings, isAll]);

  // Small multiples subchart data grouped by parameter
  const subchartData = useMemo(() => {
    if (!isAll) return {};
    const data = {};
    parameters.forEach((param) => {
      const paramReadings = chronologicalReadings.filter(
        (r) =>
          r.parameter_id === param.id ||
          r.parameters?.name?.toLowerCase() === param.name?.toLowerCase()
      );
      const downsampled = downsampleTimeSeries(paramReadings, 2000);
      data[param.name] = downsampled.map((item) => ({
        time: formatManilaChartTick(item.recorded_at),
        fullTime: formatManilaDateTime(item.recorded_at),
        value: item.value,
        isGap: item.isGap,
      }));
    });
    return data;
  }, [parameters, chronologicalReadings, isAll]);

  const handleClear = () => {
    setParameterId(ALL_VALUE);
    setDateFrom("");
    setDateTo("");
    setValidationError("");
  };

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <PageTransition className="admin-main manager-main">
        <header className="page-header">
          <div className="page-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", gap: "12px", flexWrap: "wrap" }}>
            <div>
              <h1>Analytics &amp; Trends</h1>
              <p>Explore historical sensor performance and threshold bands</p>
            </div>
            <button
              type="button"
              className="threshold-info-btn"
              onClick={() => setPopoverOpen(true)}
              aria-label="View standards reference"
              title="View standards reference"
            >
              ℹ Standards Reference
            </button>
          </div>
          {popoverOpen && (
            <ThresholdInfoPopover
              open={popoverOpen}
              onClose={() => setPopoverOpen(false)}
            />
          )}
        </header>

        <section className="manager-panel">
          {/* Filters Bar */}
          <div className="manager-filters">
            <select
              value={parameterId}
              onChange={(e) => setParameterId(e.target.value)}
              aria-label="Filter by parameter"
            >
              <option value={ALL_VALUE}>All Parameters (Small Multiples)</option>
              {parameters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <label>
              From{" "}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
              />
            </label>

            <label>
              To{" "}
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
              />
            </label>

            <button type="button" onClick={handleClear}>
              Clear
            </button>
          </div>

          {/* Active Range & Validation Status */}
          <div className="analytics-range-status">
            <span className="analytics-range-label">Active Range:</span>
            <span className="analytics-range-value">
              {validationError ? (
                <strong className="analytics-range-error">{validationError}</strong>
              ) : (
                <>
                  {dateRangeInfo.displayRange} ({readings.length.toLocaleString()} total reading{readings.length === 1 ? "" : "s"})
                </>
              )}
            </span>
          </div>

          {loading ? (
            <>
              <SkeletonChart isAll={isAll} />
              <div className="table-wrap" style={{ marginTop: "24px" }}>
                <table>
                  <thead>
                    <tr>
                      {isAll && <th>Parameter</th>}
                      <th>Date &amp; Time</th>
                      <th>Node</th>
                      <th>Value</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    <SkeletonTableRows rows={PAGE_SIZE} columns={isAll ? 5 : 4} />
                  </tbody>
                </table>
              </div>
            </>
          ) : error ? (
            <p className="manager-error">{error}</p>
          ) : validationError ? (
            <div className="analytics-empty-state">
              <p className="manager-error">{validationError}</p>
            </div>
          ) : (
            <>
              {/* ── Visual Charts ── */}
              {isAll ? (
                /* Small Multiple Subcharts (One per parameter) */
                <div className="analytics-multi-grid">
                  {parameters.map((param, index) => {
                    const rows = subchartData[param.name] || [];
                    const pStats = statsByParam[param.name];
                    const color = getLineColor(param.name, index);

                    return (
                      <div className="analytics-subchart-card" key={param.id}>
                        <div className="analytics-subchart-header">
                          <div className="analytics-subchart-title">
                            <span
                              className="analytics-subchart-dot"
                              style={{ background: color }}
                            />
                            <h3>{param.name}</h3>
                            <span className="analytics-subchart-unit">
                              ({param.unit || ""})
                            </span>
                          </div>

                          {pStats ? (
                            <div className="analytics-subchart-stats">
                              <span>
                                Avg: <strong>{pStats.average.toFixed(1)}</strong>
                              </span>
                              <span>
                                Min: <strong>{pStats.min}</strong>
                              </span>
                              <span>
                                Max: <strong>{pStats.max}</strong>
                              </span>
                              <span>
                                Med: <strong>{pStats.median}</strong>
                              </span>
                            </div>
                          ) : (
                            <div className="analytics-subchart-stats">
                              <span>No stats available</span>
                            </div>
                          )}
                        </div>

                        <div className="analytics-subchart-body">
                          {rows.length === 0 ? (
                            <div className="analytics-subchart-empty">
                              No {param.name} readings in this range
                            </div>
                          ) : (
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart
                                data={rows}
                                margin={{ top: 10, right: 16, left: 10, bottom: 5 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                  dataKey="time"
                                  minTickGap={28}
                                  tick={{ fontSize: 10 }}
                                />
                                <YAxis
                                  domain={["auto", "auto"]}
                                  tick={{ fontSize: 10 }}
                                  width={55}
                                  tickFormatter={(val) =>
                                    val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val
                                  }
                                />
                                <Tooltip
                                  formatter={(val) => [
                                    `${val} ${param.unit || ""}`,
                                    param.name,
                                  ]}
                                  labelFormatter={(_, payload) =>
                                    payload?.[0]?.payload?.fullTime || ""
                                  }
                                />
                                <Line
                                  type="monotone"
                                  dataKey="value"
                                  name={param.name}
                                  stroke={color}
                                  strokeWidth={2}
                                  dot={false}
                                  connectNulls={true}
                                  activeDot={{ r: 4 }}
                                  isAnimationActive={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Single Parameter Focused Deep-Dive Chart */
                <>
                  <div className="manager-chart">
                    {singleChartRows.length === 0 ? (
                      <div className="analytics-subchart-empty">
                        No {selected?.name || "sensor"} readings in this range
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={310}>
                        <LineChart
                          data={singleChartRows}
                          margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="time" minTickGap={34} />
                          <YAxis
                            domain={["auto", "auto"]}
                            width={55}
                            tickFormatter={(val) =>
                              val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val
                            }
                          />
                          <Tooltip
                            formatter={(val) => [
                              `${val} ${selected?.unit || ""}`,
                              selected?.name || "Value",
                            ]}
                            labelFormatter={(_, payload) =>
                              payload?.[0]?.payload?.fullTime || ""
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            name={selected?.name || "Value"}
                            stroke={getLineColor(selected?.name, 0)}
                            strokeWidth={2}
                            dot={false}
                            connectNulls={true}
                            activeDot={{ r: 4 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* Single Parameter Metric Summary Cards */}
                  <div className="manager-card-grid manager-small-cards">
                    {[
                      ["Minimum", singleStats?.min],
                      ["Maximum", singleStats?.max],
                      ["Median", singleStats?.median],
                      ["Average", singleStats?.average],
                      ["Total readings", readings.length],
                    ].map(([label, value]) => (
                      <article className="manager-stat-card" key={label}>
                        <div>
                          <p>{label}</p>
                          <strong>
                            {value == null
                              ? "—"
                              : `${Number(value).toFixed(2)}${
                                  label === "Total readings"
                                    ? ""
                                    : ` ${selected?.unit || ""}`
                                }`}
                          </strong>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}

              {/* ── Severity Bands Distribution Row ── */}
              <div className="manager-band-row">
                {Object.entries(bands).map(([band, count]) => (
                  <div key={band}>
                    <strong>{band} Range</strong>
                    <span>
                      {count} readings (
                      {readings.length
                        ? ((count / readings.length) * 100).toFixed(1)
                        : 0}
                      %)
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Data Readings Table ── */}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {isAll && <th>Parameter</th>}
                      <th>Date &amp; Time</th>
                      <th>Node</th>
                      <th>Value</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={isAll ? 5 : 4}>
                          No readings match the selected range.
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((row, idx) => (
                        <AnimatedRow key={row.id} index={idx}>
                          {isAll && <td>{row.parameters?.name || "—"}</td>}
                          <td>{formatManilaDateTime(row.recorded_at)}</td>
                          <td>{row.nodes?.device_label || "—"}</td>
                          <td className="data-cell">
                            {row.value} {row.parameters?.unit || selected?.unit || ""}
                          </td>
                          <td>{row.source || "—"}</td>
                        </AnimatedRow>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="um-pagination">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    ‹
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </PageTransition>
    </div>
  );
};

export default AnalyticsTrends;
