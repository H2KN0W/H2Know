import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "../../styles/Dashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import LogoutButton from "../../components/LogoutButton";
import H2knowLogo from "../../assets/img/H2knowlogo.jpg";

/**
 * Dashboard — Admin/Manager landing page.
 * Includes sidebar, topbar, summary cards, and recent activity tables
 * all in one file for simplicity at this stage of the project.
 *
 * NOTE: All data below is placeholder/sample data for layout purposes.
 * Replace with real Supabase queries once Data Records / Alert History
 * tables exist in the database.
 */

const navItems = [
  { label: "Dashboard", path: "/admin/dashboard" },
  { label: "Alert History", path: "/admin/alert-history" },
  { label: "Activity Logs", path: "/admin/user-activity-logs" },
  { label: "Data Records", path: "/admin/data-records" },
  { label: "Reports", path: "/admin/reports" },
  { label: "User Management", path: "/admin/user-management" },
];

const summaryCards = [
  { label: "Sensor Status", value: "Online", tone: "positive" },
  { label: "Last Data Received", value: "10 seconds ago", tone: "neutral" },
  { label: "Active Alerts", value: "3 Warnings", tone: "warning" },
  { label: "Total Data Records", value: "15,420 readings", tone: "neutral" },
  { label: "Total Users", value: "5 accounts", tone: "neutral" },
];

const alertHistory = [
  { time: "2026-07-13 08:42", parameter: "Turbidity", reading: "15 NTU", threshold: "> 10 NTU", level: "Warning" },
  { time: "2026-07-13 07:15", parameter: "pH", reading: "5.8", threshold: "< 6.5", level: "Warning" },
  { time: "2026-07-12 22:03", parameter: "TDS", reading: "480 ppm", threshold: "> 500 ppm", level: "Normal" },
];

const userActivity = [
  { time: "2026-07-13 09:10", user: "Admin User", role: "Admin", activity: "Login", status: "Success" },
  { time: "2026-07-13 08:55", user: "J. Santos", role: "Manager", activity: "Viewed Reports", status: "Success" },
  { time: "2026-07-13 08:20", user: "Unknown", role: "—", activity: "Failed Login Attempt", status: "Failed" },
];

const Dashboard = () => {
  useLogPageView("Viewed Dashboard"); // add this line first inside the component
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);

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
          <h1>Dashboard</h1>
          <p>
  Welcome back,{" "}
  {profile?.full_name
    ? profile.full_name
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : "Loading..."}
</p>
        </header>

        <div className="summary-grid">
          {summaryCards.map((card) => (
            <div className="summary-card" key={card.label}>
              <p className="summary-label">{card.label}</p>
              <p className={`summary-value tone-${card.tone}`}>{card.value}</p>
            </div>
          ))}
        </div>

        <div className="panel-grid">
          <section className="panel">
            <h2>Recent Alert History</h2>
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
                  {alertHistory.map((row, i) => (
                    <tr key={i}>
                      <td>{row.time}</td>
                      <td>{row.parameter}</td>
                      <td>{row.reading}</td>
                      <td>{row.threshold}</td>
                      <td>
                        <span className={`badge badge-${row.level.toLowerCase()}`}>
                          {row.level}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Recent User Activity</h2>
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
                  {userActivity.map((row, i) => (
                    <tr key={i}>
                      <td>{row.time}</td>
                      <td>{row.user}</td>
                      <td>{row.role}</td>
                      <td>{row.activity}</td>
                      <td>
                        <span className={`badge badge-${row.status.toLowerCase()}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
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