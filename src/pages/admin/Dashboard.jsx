import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "../../styles/Dashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";
import { Users, UserCheck, AlertTriangle, Hourglass, Search } from "lucide-react";

/**
 * Dashboard — Admin/Manager landing page. Backed by live Supabase data.
 *
 * Schema notes / deliberate simplifications:
 * - `alerts` has no status/resolved_by/resolved_at columns, so there is
 *   no active-vs-resolved split and no review actions — this shows one
 *   combined "Recent Alerts" list ordered by triggered_at.
 * - "Active Alerts" on the summary card counts alerts triggered in the
 *   last 24 hours (a stand-in for "active", since nothing marks an
 *   alert as resolved). Adjust the window or add a status column later
 *   if that's not the right definition.
 * - "Pending Review" counts profiles with status = 'pending' (accounts
 *   awaiting admin approval), matching the User Management page.
 * - System Status only shows Master Node Status (derived from
 *   last_seen_at recency) and Last Data Sync — `nodes` has no
 *   firmware/health columns to back an "Update" or "System Health" row.
 */

const NODE_ONLINE_WINDOW_MS = 5 * 60 * 1000; // consider a node "online" if seen in the last 5 min
const ACTIVE_ALERTS_WINDOW_MS = 24 * 60 * 60 * 1000; // "active" = triggered in the last 24h

const formatDateTime = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const Dashboard = () => {
  useLogPageView("Viewed Dashboard");
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [search, setSearch] = useState("");

  const [counts, setCounts] = useState({
    totalUsers: null,
    activeAccounts: null,
    pendingReview: null,
    activeAlerts: null,
  });

  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState("");

  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");

  const [masterNode, setMasterNode] = useState(null);
  const [nodeLoading, setNodeLoading] = useState(true);
  const [nodeError, setNodeError] = useState("");

  // Tracked in state (rather than calling Date.now() during render) so
  // the online/offline check below stays a pure function of props/state.
  // Refreshing every 30s also means the status updates on its own.
  const [now, setNow] = useState(() => Date.now());

  // Signed-in profile, for the header greeting.
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

  // Summary card counts.
  useEffect(() => {
    const loadCounts = async () => {
      const activeAlertsSince = new Date(Date.now() - ACTIVE_ALERTS_WINDOW_MS).toISOString();

      const [totalUsers, activeAccounts, pendingReview, activeAlerts] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("status", "approved"),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("alerts")
          .select("id", { count: "exact", head: true })
          .gte("triggered_at", activeAlertsSince),
      ]);

      setCounts({
        totalUsers: totalUsers.count,
        activeAccounts: activeAccounts.count,
        pendingReview: pendingReview.count,
        activeAlerts: activeAlerts.count,
      });
    };

    loadCounts();
  }, []);

  // Recent alerts, joined with the sensor reading, its parameter, and the threshold that fired.
  useEffect(() => {
    const loadAlerts = async () => {
      setAlertsLoading(true);
      setAlertsError("");

      const { data, error } = await supabase
        .from("alerts")
        .select(
          `
          id,
          message,
          triggered_at,
          sensor_readings ( value, recorded_at, parameters ( name, unit ) ),
          thresholds ( severity_label )
        `
        )
        .order("triggered_at", { ascending: false })
        .limit(10);

      if (error) {
        setAlertsError("Could not load alerts.");
      } else {
        setAlerts(data);
      }
      setAlertsLoading(false);
    };

    loadAlerts();
  }, []);

  // Recent user activity.
  useEffect(() => {
    const loadActivity = async () => {
      setActivityLoading(true);
      setActivityError("");

      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, full_name, activity, created_at")
        .order("created_at", { ascending: false })
        .limit(6);

      if (error) {
        setActivityError("Could not load recent activity.");
      } else {
        setActivity(data);
      }
      setActivityLoading(false);
    };

    loadActivity();
  }, []);

  // Master node status.
  useEffect(() => {
    const loadNode = async () => {
      setNodeLoading(true);
      setNodeError("");

      const { data, error } = await supabase
        .from("nodes")
        .select("device_label, status, last_seen_at")
        .eq("node_type", "master")
        .limit(1)
        .maybeSingle();

      if (error) {
        setNodeError("Could not load node status.");
      } else {
        setMasterNode(data);
      }
      setNodeLoading(false);
    };

    loadNode();
  }, []);

  // Keep "now" fresh so isNodeOnline re-evaluates without needing a reload.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  const displayName = profile?.full_name
    ? profile.full_name.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
    : "Loading...";
  const displayRole = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : "";

  const summaryCards = [
    { label: "Total Users", value: counts.totalUsers, tone: "neutral", icon: Users },
    { label: "Active Accounts", value: counts.activeAccounts, tone: "positive", icon: UserCheck },
    { label: "Active Alerts", value: counts.activeAlerts, tone: "warning", icon: AlertTriangle },
    { label: "Pending Review", value: counts.pendingReview, tone: "warning", icon: Hourglass },
  ];

  const alertRows = useMemo(
    () =>
      alerts.map((a) => {
        const reading = a.sensor_readings;
        const parameter = reading?.parameters;
        return {
          id: a.id,
          parameter: parameter?.name ?? "—",
          reading: reading ? `${reading.value}${parameter?.unit ? ` ${parameter.unit}` : ""}` : "—",
          severity: a.thresholds?.severity_label ?? null,
          timestamp: formatDateTime(reading?.recorded_at ?? a.triggered_at),
        };
      }),
    [alerts]
  );

  const activityRows = useMemo(
    () =>
      activity.map((row) => ({
        id: row.id,
        user: row.full_name,
        action: row.activity,
        timestamp: formatDateTime(row.created_at),
      })),
    [activity]
  );

  // Client-side search across the alerts and activity tables. Matches
  // on any visible field. Fine at this volume (limit 10 / limit 6);
  // move to a server-side .ilike() filter if these lists grow.
  const query = search.trim().toLowerCase();
  const isFiltering = query.length > 0;

  const filteredAlertRows = useMemo(() => {
    if (!query) return alertRows;
    return alertRows.filter((row) =>
      [row.parameter, row.reading, row.severity, row.timestamp]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query))
    );
  }, [alertRows, query]);

  const filteredActivityRows = useMemo(() => {
    if (!query) return activityRows;
    return activityRows.filter((row) =>
      [row.user, row.action, row.timestamp]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query))
    );
  }, [activityRows, query]);

  const isNodeOnline =
    !!masterNode?.last_seen_at &&
    now - new Date(masterNode.last_seen_at).getTime() < NODE_ONLINE_WINDOW_MS;

  return (
    <div className="admin-shell">
      <Sidebar />

      <main className="admin-main">
        <header className="page-header">
          <h1>Dashboard</h1>
          <p>
            Welcome back, {displayName}
            {displayRole ? ` · ${displayRole}` : ""}
          </p>
        </header>

        <div className="dashboard-search">
          <Search size={16} className="dashboard-search-icon" />
          <input
            type="text"
            placeholder="Search alerts or activity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="summary-grid">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div className="summary-card" key={card.label}>
                <div className="summary-card-body">
                  <p className="summary-label">{card.label}</p>
                  <p className={`summary-value tone-${card.tone}`}>
                    {card.value === null || card.value === undefined ? "—" : card.value}
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
            <h2>Recent Alerts</h2>
            <div className="table-wrap">
              {alertsLoading && <p>Loading alerts...</p>}
              {alertsError && <p style={{ color: "#d64545" }}>{alertsError}</p>}
              {!alertsLoading && !alertsError && (
                <table>
                  <thead>
                    <tr>
                      <th>Sensor / Parameter</th>
                      <th>Reading</th>
                      <th>Severity</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAlertRows.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          {isFiltering ? "No matching alerts." : "No alerts recorded yet."}
                        </td>
                      </tr>
                    )}
                    {filteredAlertRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.parameter}</td>
                        <td className="data-cell">{row.reading}</td>
                        <td>
                          {row.severity ? (
                            <span className="badge badge-warning">{row.severity}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="data-cell">{row.timestamp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>Recent User Activity</h2>
            <div className="table-wrap">
              {activityLoading && <p>Loading activity...</p>}
              {activityError && <p style={{ color: "#d64545" }}>{activityError}</p>}
              {!activityLoading && !activityError && (
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Action</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivityRows.length === 0 && (
                      <tr>
                        <td colSpan={3}>
                          {isFiltering ? "No matching activity." : "No activity recorded yet."}
                        </td>
                      </tr>
                    )}
                    {filteredActivityRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.user}</td>
                        <td>{row.action}</td>
                        <td className="data-cell">{row.timestamp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>System Status</h2>
            {nodeLoading && <p>Loading node status...</p>}
            {nodeError && <p style={{ color: "#d64545" }}>{nodeError}</p>}
            {!nodeLoading && !nodeError && (
              <div className="status-list">
                <div className="status-row status-row-highlight">
                  <span className="status-label">
                    Master Node Status{masterNode?.device_label ? ` (${masterNode.device_label})` : ""}
                  </span>
                  <span className={`status-value tone-${isNodeOnline ? "positive" : "warning"}`}>
                    {isNodeOnline && <span className="live-dot" />}
                    {masterNode ? (isNodeOnline ? "Online" : "Offline") : "No master node"}
                  </span>
                </div>
                <div className="status-row">
                  <span className="status-label">Last Data Sync</span>
                  <span className="status-value data-cell">
                    {formatDateTime(masterNode?.last_seen_at)}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;