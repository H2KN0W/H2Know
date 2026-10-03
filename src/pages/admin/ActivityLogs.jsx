import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/admin/AdminDashboard.css";
import "../../styles/admin/ActivityLogs.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";

/**
 * User Activity Logs — Admin page.
 * Pulls real rows from the activity_logs table (written server-side
 * by the log-activity Edge Function, which captures the real client IP).
 */

const PAGE_SIZE = 25;

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
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState({
    name: "",
    activity: "",
    dateFrom: "",
    dateTo: "",
    role: "",
    status: "",
  });
  const [textSearch, setTextSearch] = useState({ name: "", activity: "" });

  useEffect(() => {
    const timer = setTimeout(() => {
      setTextSearch({ name: filters.name.trim(), activity: filters.activity.trim() });
    }, 250);
    return () => clearTimeout(timer);
  }, [filters.name, filters.activity]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("role")
      .not("role", "is", null)
      .then(({ data }) => {
        setRoles([...new Set((data || []).map((item) => item.role))].sort());
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchLogs = async () => {
      setLoading(true);
      setError("");

      const from = (page - 1) * PAGE_SIZE;
      let query = supabase
        .from("activity_logs")
        .select("id, full_name, role, activity, status, ip_address, created_at", { count: "exact" });

      if (textSearch.name) query = query.ilike("full_name", `%${textSearch.name}%`);
      if (textSearch.activity) query = query.ilike("activity", `%${textSearch.activity}%`);
      if (filters.dateFrom) query = query.gte("created_at", `${filters.dateFrom}T00:00:00`);
      if (filters.dateTo) query = query.lte("created_at", `${filters.dateTo}T23:59:59.999`);
      if (filters.role) query = query.eq("role", filters.role);
      if (filters.status) query = query.eq("status", filters.status);

      const { data, error: fetchError, count } = await query
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (cancelled) return;
      if (fetchError) {
        setError("Could not load activity logs.");
      } else {
        setLogs(data || []);
        setTotalCount(count || 0);
      }
      setLoading(false);
    };

    fetchLogs();
    return () => { cancelled = true; };
  }, [page, textSearch, filters.dateFrom, filters.dateTo, filters.role, filters.status]);

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    setPage(1);
    setFilters({ name: "", activity: "", dateFrom: "", dateTo: "", role: "", status: "" });
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="admin-shell">
      <Sidebar />

      {/* Main content */}
      <main className="admin-main">
        <header className="page-header">
          <h1>User Activity Logs</h1>
          <p>Login events and account activity across H2KNOW</p>
        </header>

        <section className="panel">
          <h2>All Activity</h2>

          <div className="activity-filter-bar">
            <label className="activity-filter-field activity-filter-search">
              User name
              <input
                className="activity-filter-control"
                type="search"
                value={filters.name}
                onChange={(event) => updateFilter("name", event.target.value)}
                placeholder="Search names"
              />
            </label>
            <label className="activity-filter-field activity-filter-search">
              Activity
              <input
                className="activity-filter-control"
                type="search"
                value={filters.activity}
                onChange={(event) => updateFilter("activity", event.target.value)}
                placeholder="Search activity"
              />
            </label>
            <label className="activity-filter-date">
              From
              <input
                className="activity-filter-control"
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(event) => updateFilter("dateFrom", event.target.value)}
              />
            </label>
            <label className="activity-filter-date">
              To
              <input
                className="activity-filter-control"
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(event) => updateFilter("dateTo", event.target.value)}
              />
            </label>
            <label className="activity-filter-field">
              Role
              <select
                className="activity-filter-control"
                value={filters.role}
                onChange={(event) => updateFilter("role", event.target.value)}
              >
                <option value="">All roles</option>
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label className="activity-filter-field">
              Status
              <select
                className="activity-filter-control"
                value={filters.status}
                onChange={(event) => updateFilter("status", event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="Success">Success</option>
                <option value="Failed">Failed</option>
              </select>
            </label>
            <button type="button" className="activity-filter-clear" onClick={clearFilters}>
              Clear filters
            </button>
          </div>

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
                      <td colSpan={6}>No activity matches these filters.</td>
                    </tr>
                  )}
                  {logs.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>{row.full_name}</td>
                      <td>{row.role || "—"}</td>
                      <td>{row.activity}</td>
                      <td className="data-cell">{row.ip_address || "—"}</td>
                      <td>
                        <span
                          className={`badge badge-${(row.status || "unknown").toLowerCase()}`}
                        >
                          {row.status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && totalCount > 0 && (
            <div className="um-pagination">
              <button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
                ‹
              </button>
              <span>Page {page} of {totalPages} ({totalCount} activities)</span>
              <button disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>
                ›
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default ActivityLogs;