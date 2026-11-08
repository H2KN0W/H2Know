import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/ManagerAlerts.css";
import {
  PageTransition,
  SkeletonTableRows,
  AnimatedRow,
} from "../../components/ui";

import { formatDateTime, severityBadgeClass, formatSeverityLabel } from "../../lib/formatters";
import { PAGE_SIZES, filterMonitoredParameters } from "../../config/constants";

const PAGE_SIZE = PAGE_SIZES.DEFAULT;
const severityClass = severityBadgeClass;

const ManagerAlerts = () => {
  useLogPageView("Viewed Manager Alerts");
  const [parameters, setParameters] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [parameterId, setParameterId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("parameters")
      .select("id, name")
      .order("name")
      .then(({ data }) => setParameters(filterMonitoredParameters(data)));
  }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    setError("");
    const from = (page - 1) * PAGE_SIZE;

    let query = supabase
      .from("alerts")
      .select(
        "id, message, status, triggered_at, thresholds!inner ( min_value, max_value, severity_label, parameter_id, parameters!inner ( name, unit ) ), sensor_readings!alerts_reading_id_fkey ( value, nodes ( device_label ) )",
        { count: "exact" }
      );

    if (parameterId) query = query.eq("thresholds.parameter_id", parameterId);
    if (dateFrom) query = query.gte("triggered_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("triggered_at", `${dateTo}T23:59:59`);

    const { data, error: fetchError, count } = await query
      .order("triggered_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (fetchError) {
      setError("Could not load alerts.");
    } else {
      setAlerts(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAlerts();
  }, [parameterId, dateFrom, dateTo, page]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <PageTransition className="admin-main manager-main">
        <header className="page-header">
          <h1>Alerts</h1>
          <p>Real-time and historical water-quality threshold breaches</p>
        </header>

        <section className="manager-panel">
          <div className="manager-filters">
            <select
              value={parameterId}
              onChange={(e) => {
                setParameterId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All parameters</option>
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
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
              />
            </label>

            <label>
              To{" "}
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
              />
            </label>

            <button
              onClick={() => {
                setParameterId("");
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
            >
              Clear
            </button>
          </div>

          {error && <p className="manager-error">{error}</p>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Triggered</th>
                  <th>Node</th>
                  <th>Parameter</th>
                  <th>Reading</th>
                  <th>Threshold</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRows rows={PAGE_SIZE} columns={6} />
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No alerts match the current filters.</td>
                  </tr>
                ) : (
                  alerts.map((alert, idx) => {
                    const threshold = alert.thresholds;

                    return (
                      <AnimatedRow key={alert.id} index={idx}>
                        <td>{formatDateTime(alert.triggered_at)}</td>
                        <td>{alert.sensor_readings?.nodes?.device_label || "—"}</td>
                        <td>{threshold?.parameters?.name || "—"}</td>
                        <td className="data-cell">
                          {alert.sensor_readings?.value ?? "—"}{" "}
                          {threshold?.parameters?.unit || ""}
                        </td>
                        <td className="data-cell">
                          {threshold?.min_value ?? "—"} – {threshold?.max_value ?? "—"}
                        </td>
                        <td>
                          <span className={`badge ${severityClass(threshold?.severity_label)}`}>
                            {formatSeverityLabel(threshold?.severity_label)}
                          </span>
                        </td>
                      </AnimatedRow>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && totalPages > 1 && (
            <div className="um-pagination">
              <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
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
        </section>
      </PageTransition>
    </div>
  );
};

export default ManagerAlerts;
