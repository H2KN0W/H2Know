import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import ManagerSidebar from "../../components/manager/ManagerSidebar";
import "../../styles/Dashboard.css";
import "../../styles/manager/ManagerPortal.css";

const PAGE_SIZE = 15;
const formatDateTime = (value) => value ? new Date(value).toLocaleString() : "—";
const bandName = (severity) => {
  const value = (severity || "").toLowerCase();
  if (value === "warning") return "Warning";
  if (value === "critical" || value === "danger") return "Critical";
  return "Safe";
};

const AnalyticsTrends = () => {
  useLogPageView("Viewed Analytics & Trends");
  const [parameters, setParameters] = useState([]); const [parameterId, setParameterId] = useState("");
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const [readings, setReadings] = useState([]); const [thresholds, setThresholds] = useState([]);
  const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  useEffect(() => { supabase.from("parameters").select("id, name, unit").order("name").then(({ data, error: fetchError }) => { if (fetchError) setError("Could not load parameters."); else { const available = (data || []).filter((item) => item.name?.toLowerCase() !== "water level"); setParameters(available); setParameterId(available[0]?.id || ""); } }); }, []);
  useEffect(() => {
    if (!parameterId) return;
    const load = async () => {
      setLoading(true); setError("");
      let query = supabase.from("sensor_readings").select("id, value, source, recorded_at, nodes ( device_label )").eq("parameter_id", parameterId);
      if (dateFrom) query = query.gte("recorded_at", `${dateFrom}T00:00:00`);
      if (dateTo) query = query.lte("recorded_at", `${dateTo}T23:59:59`);
      const [readingResult, thresholdResult] = await Promise.all([query.order("recorded_at", { ascending: true }).limit(5000), supabase.from("thresholds").select("min_value, max_value, severity_label").eq("parameter_id", parameterId)]);
      if (readingResult.error || thresholdResult.error) setError("Could not load analytics data.");
      setReadings(readingResult.data || []); setThresholds(thresholdResult.data || []); setPage(1); setLoading(false);
    }; load();
  }, [parameterId, dateFrom, dateTo]);

  const stats = useMemo(() => { const values = readings.map((item) => Number(item.value)).filter(Number.isFinite).sort((a, b) => a - b); if (!values.length) return null; const middle = Math.floor(values.length / 2); return { min: values[0], max: values.at(-1), median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, average: values.reduce((sum, value) => sum + value, 0) / values.length }; }, [readings]);
  const bands = useMemo(() => { const counts = { Safe: 0, Warning: 0, Critical: 0 }; readings.forEach((reading) => { const match = thresholds.find((threshold) => (threshold.min_value == null || Number(reading.value) >= Number(threshold.min_value)) && (threshold.max_value == null || Number(reading.value) <= Number(threshold.max_value))); counts[bandName(match?.severity_label)] += 1; }); return counts; }, [readings, thresholds]);
  const selected = parameters.find((item) => item.id === parameterId); const totalPages = Math.max(1, Math.ceil(readings.length / PAGE_SIZE)); const pageRows = readings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const chartRows = readings.map((item) => ({ time: new Date(item.recorded_at).toLocaleDateString(), value: Number(item.value) }));

  return <div className="admin-shell"><ManagerSidebar /><main className="admin-main manager-main"><header className="page-header"><h1>Analytics & Trends</h1><p>Explore historical sensor performance and threshold bands</p></header>
    <section className="manager-panel"><div className="manager-filters"><select value={parameterId} onChange={(e) => setParameterId(e.target.value)}>{parameters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><label>From <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} /></label><label>To <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></label><button onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</button></div>
      {loading ? <p>Loading analytics...</p> : error ? <p className="manager-error">{error}</p> : <><div className="manager-chart"><ResponsiveContainer width="100%" height={310}><LineChart data={chartRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" minTickGap={38} /><YAxis /><Tooltip /><Line type="monotone" dataKey="value" name={selected?.name || "Value"} stroke="#1d7a8c" dot={false} /></LineChart></ResponsiveContainer></div>
      <div className="manager-card-grid manager-small-cards">{[["Minimum", stats?.min], ["Maximum", stats?.max], ["Median", stats?.median], ["Average", stats?.average], ["Total readings", readings.length]].map(([label, value]) => <article className="manager-stat-card" key={label}><div><p>{label}</p><strong>{value == null ? "—" : `${Number(value).toFixed(2)}${label === "Total readings" ? "" : ` ${selected?.unit || ""}`}`}</strong></div></article>)}</div>
      <div className="manager-band-row">{Object.entries(bands).map(([band, count]) => <div key={band}><strong>{band}</strong><span>{count} ({readings.length ? ((count / readings.length) * 100).toFixed(1) : 0}%)</span></div>)}</div>
      <div className="table-wrap"><table><thead><tr><th>Date & Time</th><th>Node</th><th>Value</th><th>Source</th></tr></thead><tbody>{pageRows.length === 0 ? <tr><td colSpan={4}>No readings match the selected range.</td></tr> : pageRows.map((row) => <tr key={row.id}><td>{formatDateTime(row.recorded_at)}</td><td>{row.nodes?.device_label || "—"}</td><td>{row.value} {selected?.unit || ""}</td><td>{row.source || "—"}</td></tr>)}</tbody></table></div>
      {totalPages > 1 && <div className="um-pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>‹</button><span>Page {page} of {totalPages}</span><button disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>›</button></div>}</>}</section>
  </main></div>;
};

export default AnalyticsTrends;
