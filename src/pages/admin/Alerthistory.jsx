import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/Dashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";

const PAGE_SIZE = 15;

/**
 * Alert History — Admin page.
 * `alerts` rows link to `thresholds` (min/max + severity_label) and to
 * `sensor_readings` (the actual value that triggered the alert), which
 * itself links to `parameters` (name, unit) and `nodes` (device_label).
 * Server-side paginated since this table grows continuously.
 */

const formatDateTime = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

// Maps whatever severity_label values you seeded in `thresholds`
// onto the existing badge color classes in Dashboard.css.
const severityBadgeClass = (severity) => {
  const s = (severity || "").toLowerCase();
  if (s === "critical" || s === "danger") return "badge-failed";
  if (s === "warning") return "badge-warning";
  return "badge-normal";
};

const AlertHistory = () => {
  useLogPageView("Viewed Alert History");

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true);
      setError("");

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error: fetchError, count } = await supabase
        .from("alerts")
        .select(
          `id, message, triggered_at,
           thresholds ( min_value, max_value, severity_label, parameters ( name, unit ) ),
           sensor_readings ( value, recorded_at, nodes ( device_label ) )`,
          { count: "exact" }
        )
        .order("triggered_at", { ascending: false })
        .range(from, to);

      if (fetchError) {
        setError("Could not load alert history.");
      } else {
        setAlerts(data);
        setTotalCount(count || 0);
      }
      setLoading(false);
    };

    fetchAlerts();
  }, [page]);

  return (
    <div className="admin-shell">
      <Sidebar />

      <main className="admin-main">
        <header className="page-header">
          <h1>Alert History</h1>
          <p>Threshold breaches recorded across the monitoring node</p>
        </header>

        <section className="panel">
          <h2>All Alerts</h2>

          {loading && <p>Loading alert history...</p>}
          {error && <p style={{ color: "#d64545" }}>{error}</p>}

          {!loading && !error && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date &amp; Time</th>
                      <th>Node</th>
                      <th>Parameter</th>
                      <th>Reading</th>
                      <th>Threshold</th>
                      <th>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.length === 0 && (
                      <tr>
                        <td colSpan={6}>No alerts recorded.</td>
                      </tr>
                    )}
                    {alerts.map((row) => {
                      const param = row.thresholds?.parameters;
                      const unit = param?.unit || "";
                      const min = row.thresholds?.min_value;
                      const max = row.thresholds?.max_value;
                      const severity = row.thresholds?.severity_label;

                      return (
                        <tr key={row.id}>
                          <td>{formatDateTime(row.triggered_at)}</td>
                          <td>{row.sensor_readings?.nodes?.device_label || "—"}</td>
                          <td>{param?.name || "—"}</td>
                          <td className="data-cell">
                            {row.sensor_readings?.value ?? "—"} {unit}
                          </td>
                          <td className="data-cell">
                            {min ?? "—"} – {max ?? "—"} {unit}
                          </td>
                          <td>
                            <span className={`badge ${severityBadgeClass(severity)}`}>
                              {severity || "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="um-pagination">
                  <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    ‹
                  </button>
                  <span style={{ fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
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

export default AlertHistory;