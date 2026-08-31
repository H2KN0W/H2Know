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
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/AnalyticsTrends.css";

const PAGE_SIZE = 15;
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

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : "—");

const formatChartTime = (isoString) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const bandName = (severity) => {
  const value = (severity || "").toLowerCase();
  if (value === "warning") return "Warning";
  if (value === "critical" || value === "danger") return "Critical";
  return "Safe";
};

const calculateStats = (readingList) => {
  const values = readingList
    .map((item) => Number(item.value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2;
  const average =
    values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    min: values[0],
    max: values.at(-1),
    median,
    average,
    count: values.length,
  };
};

const AnalyticsTrends = () => {
  useLogPageView("Viewed Analytics & Trends");

  const [parameters, setParameters] = useState([]);
  const [parameterId, setParameterId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [readings, setReadings] = useState([]);
  const [thresholds, setThresholds] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          const available = (data || []).filter(
            (item) => item.name?.toLowerCase() !== "water level"
          );
          setParameters(available);
          setParameterId(ALL_VALUE);
        }
      });
  }, []);

  useEffect(() => {
    if (!parameterId) return;

    const load = async () => {
      setLoading(true);
      setError("");

      let query = supabase
        .from("sensor_readings")
        .select(
          "id, value, source, recorded_at, parameter_id, parameters ( name, unit ), nodes ( device_label )"
        );

      if (!isAll) query = query.eq("parameter_id", parameterId);
      if (dateFrom) query = query.gte("recorded_at", `${dateFrom}T00:00:00`);
      if (dateTo) query = query.lte("recorded_at", `${dateTo}T23:59:59`);

      let thresholdQuery = supabase
        .from("thresholds")
        .select("parameter_id, min_value, max_value, severity_label");

      if (!isAll) thresholdQuery = thresholdQuery.eq("parameter_id", parameterId);

      const [readingResult, thresholdResult] = await Promise.all([
        query.order("recorded_at", { ascending: true }).limit(5000),
        thresholdQuery,
      ]);

      if (readingResult.error || thresholdResult.error) {
        setError("Could not load analytics data.");
      }

      setReadings(readingResult.data || []);
      setThresholds(thresholdResult.data || []);
      setPage(1);
      setLoading(false);
    };

    load();
  }, [parameterId, dateFrom, dateTo, isAll]);

  // Single parameter statistics
  const singleStats = useMemo(() => {
    if (isAll) return null;
    return calculateStats(readings);
  }, [readings, isAll]);

  // Per-parameter statistics (for All Parameters view)
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
    const counts = { Safe: 0, Warning: 0, Critical: 0 };
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

  // Single chart data
  const singleChartRows = useMemo(() => {
    if (isAll) return [];
    return readings.map((item) => ({
      time: formatChartTime(item.recorded_at),
      fullTime: formatDateTime(item.recorded_at),
      value: Number(item.value),
    }));
  }, [readings, isAll]);

  // Small multiples subchart data grouped by parameter
  const subchartData = useMemo(() => {
    if (!isAll) return {};
    const data = {};
    parameters.forEach((param) => {
      const paramReadings = readings
        .filter(
          (r) =>
            r.parameter_id === param.id ||
            r.parameters?.name?.toLowerCase() === param.name?.toLowerCase()
        )
        .map((item) => ({
          time: formatChartTime(item.recorded_at),
          fullTime: formatDateTime(item.recorded_at),
          value: Number(item.value),
        }));
      data[param.name] = paramReadings;
    });
    return data;
  }, [parameters, readings, isAll]);

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <main className="admin-main manager-main">
        <header className="page-header">
          <h1>Analytics &amp; Trends</h1>
          <p>Explore historical sensor performance and threshold bands</p>
        </header>

        <section className="manager-panel">
          {/* Filters Bar */}
          <div className="manager-filters">
            <select
              value={parameterId}
              onChange={(e) => setParameterId(e.target.value)}
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
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>

            <label>
              To{" "}
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>

            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear
            </button>
          </div>

          {loading ? (
            <p>Loading analytics...</p>
          ) : error ? (
            <p className="manager-error">{error}</p>
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

                          {pStats && (
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
                                margin={{ top: 10, right: 12, left: -10, bottom: 0 }}
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
                                  width={36}
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
                                  activeDot={{ r: 4 }}
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
                    <ResponsiveContainer width="100%" height={310}>
                      <LineChart
                        data={singleChartRows}
                        margin={{ top: 10, right: 16, left: -5, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="time" minTickGap={34} />
                        <YAxis domain={["auto", "auto"]} />
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
                          activeDot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
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
                      pageRows.map((row) => (
                        <tr key={row.id}>
                          {isAll && <td>{row.parameters?.name || "—"}</td>}
                          <td>{formatDateTime(row.recorded_at)}</td>
                          <td>{row.nodes?.device_label || "—"}</td>
                          <td className="data-cell">
                            {row.value} {row.parameters?.unit || selected?.unit || ""}
                          </td>
                          <td>{row.source || "—"}</td>
                        </tr>
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
      </main>
    </div>
  );
};

export default AnalyticsTrends;
