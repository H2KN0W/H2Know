import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "../../styles/admin/AdminDashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";
import { Wifi, Clock, AlertTriangle, Database, Users, RefreshCw } from "lucide-react";

/**
 * Dashboard — Admin landing page.
 * Displays live KPI summaries, recent threshold breach alerts,
 * and recent user activity logs with auto-refresh & Supabase realtime updates.
 */

const formatDateTime = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const formatClockTime = (timestamp) => {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formatRelativeTime = (isoString, checkedAt) => {
  if (!isoString) return "No data yet";
  const date = new Date(isoString);
  const now = checkedAt ? new Date(checkedAt) : date;
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 0 || isNaN(diffSec)) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const severityBadgeClass = (severity) => {
  const s = (severity || "").toLowerCase();
  if (s === "critical" || s === "danger") return "badge-failed";
  if (s === "warning") return "badge-warning";
  return "badge-normal";
};

const Dashboard = () => {
  useLogPageView("Viewed Dashboard");
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);

  // KPI states
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersCount, setUsersCount] = useState(0);

  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);
  const [recentAlerts, setRecentAlerts] = useState([]);

  const [loadingReadings, setLoadingReadings] = useState(true);
  const [totalReadings, setTotalReadings] = useState(0);
  const [latestPing, setLatestPing] = useState(null);

  const [loadingActivity, setLoadingActivity] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);

  const [checkedAt, setCheckedAt] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(30000); // 30s default
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        navigate("/");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("Failed to load profile:", error);
        return;
      }

      setProfile(data);
    };

    loadProfile();
  }, [navigate]);

  // 1. Fetch Users Count
  const fetchUsers = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });

      if (!error && count !== null) {
        setUsersCount(count);
      } else {
        setUsersCount(0);
      }
    } catch (err) {
      console.error("Failed to load users count:", err);
      setUsersCount(0);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  // 2. Fetch Alerts (active count and recent alerts)
  const fetchAlerts = useCallback(async () => {
    try {
      const { count, error: countErr } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");

      if (!countErr && count !== null) {
        setActiveAlertsCount(count);
      } else {
        setActiveAlertsCount(0);
      }

      const { data: list, error: listErr } = await supabase
        .from("alerts")
        .select(
          `id, message, status, triggered_at,
           thresholds ( min_value, max_value, severity_label,
             parameters ( name, unit ) ),
           sensor_readings ( value, recorded_at, nodes ( device_label ) )`
        )
        .order("triggered_at", { ascending: false })
        .limit(5);

      if (!listErr && list) {
        setRecentAlerts(list);
      } else {
        setRecentAlerts([]);
      }
    } catch (err) {
      console.error("Failed to load alerts:", err);
      setActiveAlertsCount(0);
      setRecentAlerts([]);
    } finally {
      setLoadingAlerts(false);
    }
  }, []);

  // 3. Fetch Sensor Readings & Latest Ping
  const fetchReadings = useCallback(async () => {
    try {
      const { count, error: countErr } = await supabase
        .from("sensor_readings")
        .select("id", { count: "exact", head: true });

      if (!countErr && count !== null) {
        setTotalReadings(count);
      } else {
        setTotalReadings(0);
      }

      const { data: latestRows, error: pingErr } = await supabase
        .from("sensor_readings")
        .select("recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(1);

      if (!pingErr && latestRows && latestRows.length > 0 && latestRows[0]?.recorded_at) {
        setLatestPing(latestRows[0].recorded_at);
      } else {
        setLatestPing(null);
      }
    } catch (err) {
      console.error("Failed to load sensor readings:", err);
      setTotalReadings(0);
      setLatestPing(null);
    } finally {
      setLoadingReadings(false);
    }
  }, []);

  // 4. Fetch User Activity Logs
  const fetchActivity = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, full_name, role, activity, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      if (!error && data) {
        setRecentActivity(data);
      } else {
        setRecentActivity([]);
      }
    } catch (err) {
      console.error("Failed to load user activity:", err);
      setRecentActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  const fetchAllData = useCallback(
    async (manual = false) => {
      if (manual) setIsRefreshing(true);
      await Promise.allSettled([
        fetchUsers(),
        fetchAlerts(),
        fetchReadings(),
        fetchActivity(),
      ]);
      setCheckedAt(Date.now());
      if (manual) setIsRefreshing(false);
    },
    [fetchUsers, fetchAlerts, fetchReadings, fetchActivity]
  );

  // Initial Load
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Supabase Realtime Subscription (postgres_changes)
  useEffect(() => {
    const channel = supabase
      .channel("admin-dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sensor_readings" },
        () => {
          fetchReadings();
          setCheckedAt(Date.now());
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => {
          fetchAlerts();
          setCheckedAt(Date.now());
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activity_logs" },
        () => {
          fetchActivity();
          setCheckedAt(Date.now());
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          fetchUsers();
          setCheckedAt(Date.now());
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchReadings, fetchAlerts, fetchActivity, fetchUsers]);

  // Interval Polling fallback
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchAllData();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [refreshInterval, fetchAllData]);

  // Compute Sensor Status Card
  const sensorStatus = (() => {
    if (loadingReadings) {
      return { value: "Checking...", tone: "neutral", live: false };
    }
    if (!latestPing) {
      return { value: "Awaiting Data", tone: "neutral", live: false };
    }
    const pingTime = new Date(latestPing).getTime();
    const diffMs = checkedAt ? checkedAt - pingTime : 0;
    const isOnline = diffMs <= 5 * 60 * 1000;

    if (isOnline) {
      return { value: "Online", tone: "positive", live: true };
    }
    return { value: "Offline", tone: "warning", live: false };
  })();

  // Compute Last Data Received Card
  const lastDataReceived = (() => {
    if (loadingReadings) {
      return { value: "Checking...", tone: "neutral" };
    }
    if (!latestPing) {
      return { value: "No data yet", tone: "neutral" };
    }
    return { value: formatRelativeTime(latestPing, checkedAt), tone: "neutral" };
  })();

  // Compute Active Alerts Card
  const activeAlertsCard = (() => {
    if (loadingAlerts) {
      return { value: "Checking...", tone: "neutral" };
    }
    if (activeAlertsCount === 0) {
      return { value: "0 Active", tone: "positive" };
    }
    return {
      value: `${activeAlertsCount} Active`,
      tone: "warning",
    };
  })();

  // Compute Total Data Records Card
  const totalReadingsCard = (() => {
    if (loadingReadings) {
      return { value: "Loading...", tone: "neutral" };
    }
    return { value: (totalReadings ?? 0).toLocaleString(), tone: "neutral" };
  })();

  // Compute Total Users Card
  const totalUsersCard = (() => {
    if (loadingUsers) {
      return { value: "Loading...", tone: "neutral" };
    }
    return { value: (usersCount ?? 0).toLocaleString(), tone: "neutral" };
  })();

  const summaryCards = [
    {
      label: "Sensor Status",
      value: sensorStatus.value,
      tone: sensorStatus.tone,
      icon: Wifi,
      live: sensorStatus.live,
      path: "/admin/data-records",
    },
    {
      label: "Last Data Received",
      value: lastDataReceived.value,
      tone: lastDataReceived.tone,
      icon: Clock,
      path: "/admin/data-records",
    },
    {
      label: "Active Alerts",
      value: activeAlertsCard.value,
      tone: activeAlertsCard.tone,
      icon: AlertTriangle,
      path: "/admin/alert-history",
    },
    {
      label: "Total Data Records",
      value: totalReadingsCard.value,
      tone: totalReadingsCard.tone,
      icon: Database,
      path: "/admin/data-records",
    },
    {
      label: "Total Users",
      value: totalUsersCard.value,
      tone: totalUsersCard.tone,
      icon: Users,
      path: "/admin/user-management",
    },
  ];

  return (
    <div className="admin-shell">
      <Sidebar />

      {/* Main content */}
      <main className="admin-main">
        <header className="page-header page-header-with-actions">
          <div>
            <h1>Dashboard</h1>
            <p>
              Welcome back,{" "}
              {profile?.full_name
                ? profile.full_name
                    .toLowerCase()
                    .replace(/\b\w/g, (char) => char.toUpperCase())
                : "Loading..."}
            </p>
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
                onClick={() => fetchAllData(true)}
                disabled={isRefreshing}
                title="Refresh now"
              >
                <RefreshCw size={14} className={isRefreshing ? "spin-icon" : ""} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </header>

        <div className="summary-grid">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                className="summary-card"
                key={card.label}
                role="button"
                tabIndex={0}
                onClick={() => navigate(card.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(card.path);
                  }
                }}
              >
                <div className="summary-card-body">
                  <p className="summary-label">{card.label}</p>
                  <p className={`summary-value tone-${card.tone}`}>
                    {card.live && <span className="live-dot" />}
                    {card.value}
                  </p>
                </div>
                <div className="summary-icon">
                  <Icon size={17} strokeWidth={2} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="panel-grid">
          <section className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2>Recent Alert History</h2>
              <button
                type="button"
                onClick={() => navigate("/admin/alert-history")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-primary)",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                View All &rarr;
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date &amp; Time</th>
                    <th>Parameter</th>
                    <th>Reading</th>
                    <th>Threshold</th>
                    <th>Alert Level</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAlerts ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "16px", color: "var(--color-text-muted)" }}>
                        Loading alert history...
                      </td>
                    </tr>
                  ) : recentAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "16px", color: "var(--color-text-muted)" }}>
                        No alerts recorded yet.
                      </td>
                    </tr>
                  ) : (
                    recentAlerts.map((row) => {
                      const param = row.thresholds?.parameters;
                      const unit = param?.unit || "";
                      const min = row.thresholds?.min_value;
                      const max = row.thresholds?.max_value;
                      const severity = row.thresholds?.severity_label || "Normal";

                      return (
                        <tr key={row.id}>
                          <td>{formatDateTime(row.triggered_at)}</td>
                          <td>{param?.name || "—"}</td>
                          <td className="data-cell">
                            {row.sensor_readings?.value != null ? `${row.sensor_readings.value} ${unit}` : "—"}
                          </td>
                          <td className="data-cell">
                            {min != null && max != null ? `${min} – ${max} ${unit}` : "—"}
                          </td>
                          <td>
                            <span className={`badge ${severityBadgeClass(severity)}`}>
                              {severity}
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

          <section className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2>Recent User Activity</h2>
              <button
                type="button"
                onClick={() => navigate("/admin/user-activity-logs")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-primary)",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                View All &rarr;
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date &amp; Time</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Activity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingActivity ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "16px", color: "var(--color-text-muted)" }}>
                        Loading user activity...
                      </td>
                    </tr>
                  ) : recentActivity.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "16px", color: "var(--color-text-muted)" }}>
                        No user activity recorded yet.
                      </td>
                    </tr>
                  ) : (
                    recentActivity.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td>{row.full_name || "—"}</td>
                        <td>{row.role || "—"}</td>
                        <td>{row.activity || "—"}</td>
                        <td>
                          <span
                            className={`badge badge-${(row.status || "").toLowerCase()}`}
                          >
                            {row.status || "—"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;