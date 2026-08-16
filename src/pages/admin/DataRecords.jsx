import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/admin/AdminDashboard.css";
import "../../styles/admin/DataRecords.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";

const PAGE_SIZE = 15;

/**
 * Data Records — Admin page.
 * `sensor_readings` is normalized: one row per single-parameter reading
 * (id, node_id, parameter_id, value, source, recorded_at), joined to
 * `parameters` (name, unit) and `nodes` (device_label) for display.
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

const DataRecords = () => {
  useLogPageView("Viewed Data Records");

  const [records, setRecords] = useState([]);
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
    const fetchRecords = async () => {
      setLoading(true);
      setError("");

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("sensor_readings")
        .select(
          `id, value, source, recorded_at,
           parameters!inner ( name, unit ),
           nodes ( device_label )`,
          { count: "exact" }
        );

      if (parameterFilter) {
        query = query.eq("parameter_id", parameterFilter);
      }
      if (dateFrom) {
        query = query.gte("recorded_at", `${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        query = query.lte("recorded_at", `${dateTo}T23:59:59`);
      }

      const { data, error: fetchError, count } = await query
        .order("recorded_at", { ascending: false })
        .range(from, to);

      if (fetchError) {
        setError("Could not load data records.");
      } else {
        setRecords(data);
        setTotalCount(count || 0);
      }
      setLoading(false);
    };

    fetchRecords();
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
          <h1>Data Records</h1>
          <p>Raw sensor readings from the river catchment monitoring node</p>
        </header>

        <section className="panel">
          <h2>All Readings</h2>

          <div className="dr-filter-bar">
            <select
              className="dr-filter-select"
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

            <label className="dr-filter-date-label">
              From
              <input
                type="date"
                className="dr-filter-input"
                value={dateFrom}
                onChange={handleDateFromChange}
                max={dateTo || undefined}
              />
            </label>

            <label className="dr-filter-date-label">
              To
              <input
                type="date"
                className="dr-filter-input"
                value={dateTo}
                onChange={handleDateToChange}
                min={dateFrom || undefined}
              />
            </label>

            {hasActiveFilters && (
              <button className="dr-filter-clear-btn" onClick={handleClearFilters}>
                Clear Filters
              </button>
            )}
          </div>

          {loading && <p>Loading data records...</p>}
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
                      <th>Value</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.length === 0 && (
                      <tr>
                        <td colSpan={5}>No records match the current filters.</td>
                      </tr>
                    )}
                    {records.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.recorded_at)}</td>
                        <td>{row.nodes?.device_label || "—"}</td>
                        <td>{row.parameters?.name || "—"}</td>
                        <td className="data-cell">
                          {row.value ?? "—"} {row.parameters?.unit || ""}
                        </td>
                        <td>{row.source || "—"}</td>
                      </tr>
                    ))}
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

export default DataRecords;