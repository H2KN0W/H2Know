import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import "../../styles/admin/AdminDashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";
import { Wifi, Clock, AlertTriangle, Database, Users } from "lucide-react";

/**
 * Dashboard — Admin/Manager landing page.
 * Includes sidebar, topbar, summary cards, and recent activity tables
 * all in one file for simplicity at this stage of the project.
 *
 * NOTE: All data below is placeholder/sample data for layout purposes.
 * Replace with real Supabase queries once Data Records / Alert History
 * tables exist in the database.
 */

const summaryCards = [
  { label: "Sensor Status", value: "Online", tone: "positive", icon: Wifi, live: true },
  { label: "Last Data Received", value: "10 sec ago", tone: "neutral", icon: Clock },
  { label: "Active Alerts", value: "3 Warnings", tone: "warning", icon: AlertTriangle },
  { label: "Total Data Records", value: "15,420", tone: "neutral", icon: Database },
  { label: "Total Users", value: "5", tone: "neutral", icon: Users },
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
      <Sidebar />

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
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div className="summary-card" key={card.label}>
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
                      <td className="data-cell">{row.reading}</td>
                      <td className="data-cell">{row.threshold}</td>
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