import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/Dashboard.css";
import { useLogPageView } from "../../lib/useLogPageView";
import Sidebar from "../../components/Sidebar";

const PAGE_SIZE = 15;

/**
 * Data Records — Admin page.
 * `sensor_readings` is normalized: one row per single-parameter reading
 * (id, node_id, parameter_id, value, source, recorded_at), joined to
 * `parameters` (name, unit) and `nodes` (device_label) for display.
 * Server-side paginated since this table grows continuously.
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

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    const fetchRecords = async () => {
      setLoading(true);
      setError("");

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error: fetchError, count } = await supabase
        .from("sensor_readings")
        .select(
          `id, value, source, recorded_at,
           parameters ( name, unit ),
           nodes ( device_label )`,
          { count: "exact" }
        )
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
  }, [page]);

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
                        <td colSpan={5}>No data records found.</td>
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