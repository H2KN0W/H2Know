import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/ManagerAlerts.css";
import {
  PageTransition,
  SlidingTabs,
  SkeletonTableRows,
  AnimatedRow,
  ButtonSpinner,
} from "../../components/ui";

import { formatDateTime, severityBadgeClass } from "../../lib/formatters";
import { PAGE_SIZES, filterMonitoredParameters } from "../../config/constants";

const PAGE_SIZE = PAGE_SIZES.DEFAULT;
const severityClass = severityBadgeClass;

const ManagerAlerts = () => {
  useLogPageView("Viewed Manager Alerts");
  const [parameters, setParameters] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [counts, setCounts] = useState({ active: 0, reviewed: 0, resolved: 0 });
  const [tab, setTab] = useState("active");
  const [parameterId, setParameterId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

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
        "id, message, status, triggered_at, reviewed_at, thresholds!inner ( min_value, max_value, severity_label, parameter_id, parameters!inner ( name, unit ) ), sensor_readings ( value, nodes ( device_label ) )",
        { count: "exact" }
      )
      .eq("status", tab);

    if (parameterId) query = query.eq("thresholds.parameter_id", parameterId);
    if (dateFrom) query = query.gte("triggered_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("triggered_at", `${dateTo}T23:59:59`);

    const [{ data, error: fetchError, count }, countResults] = await Promise.all([
      query.order("triggered_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
      Promise.all(
        ["active", "reviewed", "resolved"].map((status) =>
          supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", status)
        )
      ),
    ]);

    if (fetchError) {
      setError(
        "Could not load alerts. Apply the manager portal migration before using alert status actions."
      );
    } else {
      setAlerts(data || []);
      setTotalCount(count || 0);
      setCounts(
        Object.fromEntries(
          ["active", "reviewed", "resolved"].map((status, index) => [
            status,
            countResults[index].count || 0,
          ])
        )
      );
    }
    setLoading(false);
  };

  // fetchAlerts intentionally refreshes after manager actions as well as filters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchAlerts();
  }, [tab, parameterId, dateFrom, dateTo, page]);

  const updateStatus = async (alert, status) => {
    setUpdatingId(alert.id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const { error: updateError } = await supabase
        .from("alerts")
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: session?.user?.id || null,
        })
        .eq("id", alert.id);

      if (updateError) {
        setError(updateError.message);
      } else {
        await fetchAlerts();
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const alertTabs = [
    { id: "active", label: "Active", badge: counts.active },
    { id: "reviewed", label: "Reviewed", badge: counts.reviewed },
    { id: "resolved", label: "Resolved", badge: counts.resolved },
  ];

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <PageTransition className="admin-main manager-main">
        <header className="page-header">
          <h1>Alerts</h1>
          <p>Review and resolve water-quality threshold breaches</p>
        </header>

        <section className="manager-panel">
          <SlidingTabs
            tabs={alertTabs}
            activeTab={tab}
            onChange={(newTab) => {
              setTab(newTab);
              setPage(1);
            }}
            layoutId="managerAlertsTabIndicator"
          />

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
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRows rows={PAGE_SIZE} columns={7} />
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No {tab} alerts match the current filters.</td>
                  </tr>
                ) : (
                  alerts.map((alert, idx) => {
                    const threshold = alert.thresholds;
                    const isProcessing = updatingId === alert.id;

                    return (
                      <AnimatedRow key={alert.id} index={idx} isNew={tab === "active"}>
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
                            {threshold?.severity_label || "—"}
                          </span>
                        </td>
                        <td className="manager-actions">
                          {tab === "active" && (
                            <>
                              <button
                                disabled={isProcessing}
                                onClick={() => updateStatus(alert, "reviewed")}
                              >
                                {isProcessing && <ButtonSpinner size={11} />}
                                Review
                              </button>
                              <button
                                disabled={isProcessing}
                                onClick={() => updateStatus(alert, "resolved")}
                              >
                                {isProcessing && <ButtonSpinner size={11} />}
                                Resolve
                              </button>
                            </>
                          )}
                          {tab === "reviewed" && (
                            <button
                              disabled={isProcessing}
                              onClick={() => updateStatus(alert, "resolved")}
                            >
                              {isProcessing && <ButtonSpinner size={11} />}
                              Resolve
                            </button>
                          )}
                          {tab === "resolved" && <span>Resolved</span>}
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
