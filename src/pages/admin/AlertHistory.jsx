import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/admin/AdminDashboard.css";
import "../../styles/admin/AlertHistory.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";

const PAGE_SIZE = 15;

/**
 * Alert History — Admin page.
 * `alerts` rows link to `thresholds` (min/max + severity_label, which
 * itself links to `parameters`) and to `sensor_readings` (the actual
 * value that triggered the alert), which links to `nodes`.
 * Server-side paginated, filterable by parameter and date range.
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

  // Filters
  const [parameters, setParameters] = useState([]);
  const [parameterFilter, setParameterFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Load the parameter list once, for the filter dropdown.
  useEffect(() => {
    const fetchParameters = async () => {
      const { data, error: fetchError } = await supabase
        .from("parameters")
        .select("id, name")
        .order("name", { ascending: true });

      if (!fetchError) {
        // H2KNOW only monitors pH, TDS, Turbidity, and Temperature —
        // exclude Water Level in case it's still seeded in the DB.
        setParameters(data.filter((p) => p.name?.toLowerCase() !== "water level"));
      }
    };

    fetchParameters();
  }, []);

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true);
      setError("");

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("alerts")
        .select(
          `id, message, triggered_at,
           thresholds!inner ( min_value, max_value, severity_label, parameter_id,
             parameters!inner ( name, unit ) ),
           sensor_readings ( value, recorded_at, nodes ( device_label ) )`,
          { count: "exact" }
        );

      if (parameterFilter) {
        query = query.eq("thresholds.parameter_id", parameterFilter);
      }
      if (dateFrom) {
        query = query.gte("triggered_at", `${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        query = query.lte("triggered_at", `${dateTo}T23:59:59`);
      }

      const { data, error: fetchError, count } = await query
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
  }, [page, parameterFilter, dateFrom, dateTo]);

  const handleParameterChange = (e) => {
    setPage(1);
    setParameterFilter(e.target.value);
  };

  const handleDateFromChange = (e) => {
    setPage(1);
    setDateFrom(e.target.value);
  };

  const handleDateToChange = (e) => {
    setPage(1);
    setDateTo(e.target.value);
  };

  const handleClearFilters = () => {
    setPage(1);
    setParameterFilter("");
    setDateFrom("");
    setDateTo("");
  };

  const hasActiveFilters = parameterFilter || dateFrom || dateTo;

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

          <div className="filter-bar">
            <select
              className="filter-select"
              value={parameterFilter}
              onChange={handleParameterChange}
            >
              <option value="">All Parameters</option>
              {parameters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label className="filter-date-label">
              From
              <input
                type="date"
                className="filter-input"
                value={dateFrom}
                onChange={handleDateFromChange}
                max={dateTo || undefined}
              />
            </label>

            <label className="filter-date-label">
              To
              <input
                type="date"
                className="filter-input"
                value={dateTo}
                onChange={handleDateToChange}
                min={dateFrom || undefined}
              />
            </label>

            {hasActiveFilters && (
              <button className="filter-clear-btn" onClick={handleClearFilters}>
                Clear Filters
              </button>
            )}
          </div>

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
                        <td colSpan={6}>No alerts match the current filters.</td>
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