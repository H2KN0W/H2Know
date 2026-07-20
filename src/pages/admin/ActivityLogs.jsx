import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "../../styles/Dashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import LogoutButton from "../../components/LogoutButton";
import H2knowLogo from "../../assets/img/H2knowlogo.jpg";

/**
 * User Activity Logs — Admin page.
 * Pulls real rows from the activity_logs table (written server-side
 * by the log-activity Edge Function, which captures the real client IP).
 */

const navItems = [
  { label: "Dashboard", path: "/admin/dashboard" },
  { label: "Alert History", path: "/admin/alert-history" },
  { label: "Activity Logs", path: "/admin/user-activity-logs" },
  { label: "Data Records", path: "/admin/data-records" },
  { label: "Reports", path: "/admin/reports" },
  { label: "User Management", path: "/admin/user-management" },
];

const formatDateTime = (isoString) => {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const ActivityLogs = () => {
  useLogPageView("Viewed User Activity Logs");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      setError("");

      const { data, error: fetchError } = await supabase
        .from("activity_logs")
        .select("id, full_name, role, activity, status, ip_address, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (fetchError) {
        setError("Could not load activity logs.");
      } else {
        setLogs(data);
      }
      setLoading(false);
    };

    fetchLogs();
  }, []);

  return (
    <div className="admin-shell">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <img src={H2knowLogo} alt="H2KNOW logo" className="sidebar-logo" />
          <div>
            <p className="sidebar-title">
              H<sub>2</sub>KNOW
            </p>
            <p className="sidebar-subtitle">Admin Panel</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-nav-label">Menu</p>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <LogoutButton />
      </aside>

      {/* Main content */}
      <main className="admin-main">
        <header className="page-header">
          <h1>User Activity Logs</h1>
          <p>Login events and account activity across H2KNOW</p>
        </header>

        <section className="panel">
          <h2>All Activity</h2>

          {loading && <p>Loading activity logs...</p>}
          {error && <p style={{ color: "#d64545" }}>{error}</p>}

          {!loading && !error && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date &amp; Time</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Activity</th>
                    <th>IP Address</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={6}>No activity recorded yet.</td>
                    </tr>
                  )}
                  {logs.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>{row.full_name}</td>
                      <td>{row.role || "—"}</td>
                      <td>{row.activity}</td>
                      <td>{row.ip_address || "—"}</td>
                      <td>
                        <span
                          className={`badge badge-${row.status.toLowerCase()}`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default ActivityLogs;