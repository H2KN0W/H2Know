import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Activity,
  Droplets,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Thermometer,
  Waves,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import ManagerSidebar from "./ManagerSidebar";
import CatchmentMap from "./CatchmentMap";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/ManagerDashboard.css";

const PARAMETERS = ["pH", "Turbidity", "TDS", "Temperature"];
const icons = { ph: Droplets, turbidity: Waves, tds: Gauge, temperature: Thermometer };

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : "—");

const formatClockTime = (timestamp) => {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const severityClass = (value) => {
  const severity = (value || "").toLowerCase();
  return severity === "critical" || severity === "danger"
    ? "badge-failed"
    : severity === "warning"
    ? "badge-warning"
    : "badge-normal";
};

const conditionRank = { safe: 0, warning: 1, critical: 2, unknown: 3 };
const conditionLabel = {
  safe: "Safe",
  warning: "Warning",
  critical: "Critical",
  unknown: "Unknown",
};
const conditionIcon = {
  safe: ShieldCheck,
  warning: ShieldAlert,
  critical: ShieldX,
  unknown: ShieldQuestion,
};

const ManagerDashboard = () => {
  useLogPageView("Viewed Manager Dashboard");
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(30000); // 30s default

  const load = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    const [readingResult, alertResult, nodeResult] = await Promise.all([
      supabase
        .from("sensor_readings")
        .select(
          "id, value, recorded_at, parameters ( name, unit ), nodes ( id, device_label )"
        )
        .order("recorded_at", { ascending: false })
        .limit(200),
      supabase
        .from("alerts")
        .select(
          "id, status, triggered_at, thresholds!inner ( min_value, max_value, severity_label, parameters!inner ( name, unit ) ), sensor_readings ( id, value )"
        )
        .eq("status", "active")
        .order("triggered_at", { ascending: false })
        .limit(10),
      supabase.from("nodes").select("id, device_label"),
    ]);

    const firstError =
      readingResult.error || alertResult.error || nodeResult.error;
    if (firstError) {
      setError(
        "Could not load live monitoring data. Ensure the manager RLS policies and manager migration have been applied."
      );
    }
    setReadings(readingResult.data || []);
    setAlerts(alertResult.data || []);
    setNodes(nodeResult.data || []);
    setCheckedAt(Date.now());
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Supabase Realtime Subscription (postgres_changes)
  useEffect(() => {
    const channel = supabase
      .channel("manager-dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sensor_readings" },
        () => {
          load();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => {
          load();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "nodes" },
        () => {
          load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Interval Polling fallback
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const timer = setInterval(() => {
      load();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [refreshInterval, load]);

  const latestFor = (name) =>
    readings.find(
      (reading) =>
        reading.parameters?.name?.toLowerCase() === name.toLowerCase()
    );

  const nodeLastSync = (node) =>
    readings.find((reading) => reading.nodes?.id === node.id)?.recorded_at;

  const isOnline = (time) =>
    time && checkedAt - new Date(time).getTime() <= 5 * 60 * 1000;

  const riverCondition = useMemo(() => {
    const latestReadings = PARAMETERS.map((name) =>
      readings.find(
        (reading) =>
          reading.parameters?.name?.toLowerCase() === name.toLowerCase()
      )
    );
    const problems = [];
    let condition = "safe";

    latestReadings.forEach((reading, index) => {
      const parameter = PARAMETERS[index];
      if (!reading) {
        condition = "unknown";
        problems.push(`No recent ${parameter} reading`);
        return;
      }

      const matchingAlert = alerts.find(
        (alert) =>
          alert.thresholds?.parameters?.name?.toLowerCase() ===
            parameter.toLowerCase() &&
          alert.sensor_readings?.id === reading.id
      );
      const severity = matchingAlert?.thresholds?.severity_label?.toLowerCase();
      const nextCondition =
        severity === "critical" || severity === "danger"
          ? "critical"
          : severity === "warning"
          ? "warning"
          : "safe";

      if (
        conditionRank[nextCondition] > conditionRank[condition] &&
        condition !== "unknown"
      ) {
        condition = nextCondition;
      }
      if (nextCondition !== "safe") {
        problems.push(`${parameter} is ${conditionLabel[nextCondition].toLowerCase()}`);
      }
    });

    const hasOfflineNode = nodes.some((node) => {
      const lastSync = readings.find(
        (reading) => reading.nodes?.id === node.id
      )?.recorded_at;
      return !lastSync || checkedAt - new Date(lastSync).getTime() > 5 * 60 * 1000;
    });

    if (condition !== "unknown" && nodes.length > 0 && hasOfflineNode) {
      condition = "unknown";
      problems.push("One or more sensor nodes are offline or stale");
    }

    return {
      condition,
      message:
        problems[0] ||
        "All latest readings are within their configured limits.",
    };
  }, [alerts, nodes, readings, checkedAt]);

  const recentRows = useMemo(() => {
    const map = new Map();
    readings.forEach((reading) => {
      const key = reading.recorded_at;
      if (!map.has(key)) map.set(key, { recorded_at: key });
      const name = reading.parameters?.name?.toLowerCase();
      if (name) map.get(key)[name] = reading.value;
    });
    return Array.from(map.values())
      .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
      .slice(0, 10);
  }, [readings]);

  return (
    <div className="admin-shell manager-shell">
      <ManagerSidebar />
      <main className="admin-main manager-main">
        <header className="page-header page-header-with-actions">
          <div>
            <h1>Monitoring Dashboard</h1>
            <p>Current water-quality readings and node health</p>
          </div>

          <div className="header-refresh-controls">
            <div className="header-last-updated">
              <span className="live-pulse-dot" />
              <span>Last updated: {checkedAt ? formatClockTime(checkedAt) : "—"}</span>
            </div>

            <div className="header-refresh-actions">
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="refresh-interval-select"
                aria-label="Auto-refresh interval"
              >
                <option value={0}>Auto-refresh: Off</option>
                <option value={30000}>Auto-refresh: 30s</option>
                <option value={60000}>Auto-refresh: 1m</option>
                <option value={300000}>Auto-refresh: 5m</option>
              </select>

              <button
                type="button"
                className="header-refresh-btn"
                onClick={() => load(true)}
                disabled={loading}
                title="Refresh now"
              >
                <RefreshCw size={14} className={loading ? "spin-icon" : ""} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </header>

        {error && <p className="manager-error">{error}</p>}

        {loading ? (
          <p>Loading monitoring data...</p>
        ) : (
          <>
            <section className="manager-card-grid">
              {(() => {
                const Icon = conditionIcon[riverCondition.condition];
                const detail =
                  riverCondition.condition === "unknown"
                    ? "Awaiting a complete set of fresh readings"
                    : riverCondition.message;
                return (
                  <article
                    className={`manager-stat-card river-condition-card river-condition-${riverCondition.condition}`}
                    aria-live="polite"
                  >
                    <Icon size={21} />
                    <div>
                      <p>River Condition</p>
                      <strong>{conditionLabel[riverCondition.condition]}</strong>
                      <small>{detail}</small>
                    </div>
                  </article>
                );
              })()}
              {PARAMETERS.map((name) => {
                const reading = latestFor(name);
                const Icon = icons[name.toLowerCase()] || Activity;
                return (
                  <article className="manager-stat-card" key={name}>
                    <Icon size={21} />
                    <div>
                      <p>{name}</p>
                      <strong>
                        {reading
                          ? `${reading.value} ${reading.parameters?.unit || ""}`
                          : "No reading"}
                      </strong>
                      <small>
                        {reading
                          ? formatDateTime(reading.recorded_at)
                          : "Awaiting data"}
                      </small>
                    </div>
                  </article>
                );
              })}
            </section>

            <section className="manager-two-column">
              <article className="manager-panel">
                <h2>Catchment Map</h2>
                <CatchmentMap />
              </article>
              <article className="manager-panel">
                <div className="manager-panel-heading">
                  <h2>Sensor Status</h2>
                  <span>Online if synced in the last 5 minutes</span>
                </div>
                <div className="manager-node-grid">
                  {nodes.length === 0 && <p>No monitoring nodes found.</p>}
                  {nodes.map((node) => {
                    const sync = nodeLastSync(node);
                    return (
                      <article className="manager-node-card" key={node.id}>
                        <div>
                          <strong>{node.device_label || "Unnamed node"}</strong>
                          <p>Last sync: {formatDateTime(sync)}</p>
                        </div>
                        <span
                          className={`manager-state ${
                            isOnline(sync) ? "online" : "offline"
                          }`}
                        >
                          {isOnline(sync) ? "Online" : "Offline"}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </article>
            </section>

            <section className="manager-panel">
              <h2>Active Alerts</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Triggered</th>
                      <th>Parameter</th>
                      <th>Reading</th>
                      <th>Threshold</th>
                      <th>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No active alerts.</td>
                      </tr>
                    ) : (
                      alerts.map((alert) => {
                        const threshold = alert.thresholds;
                        return (
                          <tr key={alert.id}>
                            <td>{formatDateTime(alert.triggered_at)}</td>
                            <td>{threshold?.parameters?.name || "—"}</td>
                            <td className="data-cell">
                              {alert.sensor_readings?.value ?? "—"}{" "}
                              {threshold?.parameters?.unit || ""}
                            </td>
                            <td className="data-cell">
                              {threshold?.min_value ?? "—"} –{" "}
                              {threshold?.max_value ?? "—"}
                            </td>
                            <td>
                              <span
                                className={`badge ${severityClass(
                                  threshold?.severity_label
                                )}`}
                              >
                                {threshold?.severity_label || "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="manager-panel">
              <h2>Recent Readings Log</h2>
              <div className="table-wrap">
                <table className="readings-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>pH</th>
                      <th>Turbidity (NTU)</th>
                      <th>TDS (mg/L)</th>
                      <th>Temperature (°C)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No readings yet.</td>
                      </tr>
                    ) : (
                      recentRows.map((row) => (
                        <tr key={row.recorded_at}>
                          <td>{formatDateTime(row.recorded_at)}</td>
                          <td className="data-cell">{row.ph ?? "—"}</td>
                          <td className="data-cell">{row.turbidity ?? "—"}</td>
                          <td className="data-cell">{row.tds ?? "—"}</td>
                          <td className="data-cell">{row.temperature ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default ManagerDashboard;
