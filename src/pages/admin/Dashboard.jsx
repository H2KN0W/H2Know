import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "../../styles/admin/AdminDashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import { useSilentRefresh } from "../../hooks/useSilentRefresh";
import Sidebar from "../../components/Sidebar";
import WeatherWidget from "../../components/WeatherWidget";
import { Wifi, Clock, AlertTriangle, Database, Users, Hourglass, RefreshCw } from "lucide-react";
import { PageTransition, SkeletonCard, SkeletonTableRows, LiveValue, AnimatedRow } from "../../components/ui";

/**
 * Dashboard — Admin landing page.
 * Displays live KPI summaries, recent threshold breach alerts,
 * and recent user activity logs with auto-refresh & Supabase realtime updates.
 */

import { formatDateTime, formatClockTime, formatRelativeTime, severityBadgeClass } from "../../lib/formatters";
import { REFRESH_INTERVALS } from "../../config/constants";
import { evaluateNodeStatus, NODE_STATUS_LABELS } from "../../lib/nodeHealth";

const Dashboard = () => {
  useLogPageView("Viewed Dashboard");
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);

  // KPI states
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersCount, setUsersCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);
  const [recentAlerts, setRecentAlerts] = useState([]);

  const [loadingReadings, setLoadingReadings] = useState(true);
  const [totalReadings, setTotalReadings] = useState(0);
  const [latestPing, setLatestPing] = useState(null);

  const [loadingActivity, setLoadingActivity] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);

  const [checkedAt, setCheckedAt] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(REFRESH_INTERVALS.FAST);

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
      const [usersResult, pendingResult] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);

      if (!usersResult.error && usersResult.count !== null) {
        setUsersCount(usersResult.count);
      } else {
        setUsersCount(0);
      }

      // PR #15: surface the number of accounts awaiting admin approval.
      if (!pendingResult.error && pendingResult.count !== null) {
        setPendingReviewCount(pendingResult.count);
      } else {
        setPendingReviewCount(0);
      }
    } catch (err) {
      console.error("Failed to load users count:", err);
      setUsersCount(0);
      setPendingReviewCount(0);
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
    async (signal) => {
      try {
        await Promise.allSettled([
          fetchUsers(),
          fetchAlerts(),
          fetchReadings(),
          fetchActivity(),
        ]);
        setCheckedAt(Date.now());
      } catch (err) {
        if (signal?.aborted) return;
        console.error("Dashboard refresh failed:", err);
      }
    },
    [fetchUsers, fetchAlerts, fetchReadings, fetchActivity]
  );

  // Silent Refresh Hook
  const { isRefreshing } = useSilentRefresh(fetchAllData, {
    intervalMs: refreshInterval,
    enabled: refreshInterval > 0,
  });

  // Debounced realtime handler
  const realtimeDebounceRef = useRef(null);

  // Supabase Realtime Subscription (postgres_changes)
  useEffect(() => {
    const channel = supabase
      .channel("admin-dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sensor_readings" },
        () => {
          if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
          realtimeDebounceRef.current = setTimeout(() => {
            fetchReadings();
            setCheckedAt(Date.now());
          }, 1500);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => {
          if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
          realtimeDebounceRef.current = setTimeout(() => {
            fetchAlerts();
            setCheckedAt(Date.now());
          }, 1500);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activity_logs" },
        () => {
          if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
          realtimeDebounceRef.current = setTimeout(() => {
            fetchActivity();
            setCheckedAt(Date.now());
          }, 1500);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
          realtimeDebounceRef.current = setTimeout(() => {
            fetchUsers();
            setCheckedAt(Date.now());
          }, 1500);
        }
      )
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchReadings, fetchAlerts, fetchActivity, fetchUsers]);

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
    const status = evaluateNodeStatus(diffMs);

    if (status === NODE_STATUS_LABELS.ONLINE) {
      return { value: "Online", tone: "positive", live: true };
    }
    if (status === NODE_STATUS_LABELS.DELAYED) {
      return { value: "Delayed", tone: "warning", live: false };
    }
    return { value: "Offline", tone: "danger", live: false };
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

  // Compute Pending Review Card (profiles awaiting admin approval)
  const pendingReviewCard = (() => {
    if (loadingUsers) {
      return { value: "Loading...", tone: "neutral" };
    }
    if (pendingReviewCount === 0) {
      return { value: "0 Pending", tone: "positive" };
    }
    return { value: `${pendingReviewCount} Pending`, tone: "warning" };
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
    {
      label: "Pending Review",
      value: pendingReviewCard.value,
      tone: pendingReviewCard.tone,
      icon: Hourglass,
      path: "/admin/user-management",
    },
  ];

  return (
    <div className="admin-shell">
      <Sidebar />

      {/* Main content */}
      <PageTransition className="admin-main">
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

          <WeatherWidget />

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
                onClick={() => fetchAllData()}
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
          {loadingUsers && loadingAlerts && loadingReadings ? (
            <SkeletonCard type="kpi" count={6} />
          ) : (
            summaryCards.map((card) => {
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
                      <LiveValue value={card.value} />
                    </p>
                  </div>
                  <div className="summary-icon">
                    <Icon size={20} strokeWidth={1.8} />
                  </div>
                </div>
              );
            })
          )}
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
                    <SkeletonTableRows rows={3} columns={5} />
                  ) : recentAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "16px", color: "var(--color-text-muted)" }}>
                        No alerts recorded yet.
                      </td>
                    </tr>
                  ) : (
                    recentAlerts.map((row, idx) => {
                      const param = row.thresholds?.parameters;
                      const unit = param?.unit || "";
                      const min = row.thresholds?.min_value;
                      const max = row.thresholds?.max_value;
                      const severity = row.thresholds?.severity_label || "Normal";

                      return (
                        <AnimatedRow key={row.id} index={idx}>
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
                        </AnimatedRow>
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
                    <SkeletonTableRows rows={3} columns={5} />
                  ) : recentActivity.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "16px", color: "var(--color-text-muted)" }}>
                        No user activity recorded yet.
                      </td>
                    </tr>
                  ) : (
                    recentActivity.map((row, idx) => (
                      <AnimatedRow key={row.id} index={idx}>
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
                      </AnimatedRow>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </PageTransition>
    </div>
  );
};

export default Dashboard;