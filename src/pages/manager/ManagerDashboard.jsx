import { useEffect, useState } from "react";
import { Activity, Droplets, Gauge, Thermometer, Waves } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import ManagerSidebar from "../../components/manager/ManagerSidebar";
import "../../styles/Dashboard.css";
import "../../styles/manager/ManagerPortal.css";

const PARAMETERS = ["pH", "Turbidity", "TDS", "Temperature"];
const icons = { ph: Droplets, turbidity: Waves, tds: Gauge, temperature: Thermometer };
const formatDateTime = (value) => value ? new Date(value).toLocaleString() : "—";
const severityClass = (value) => {
  const severity = (value || "").toLowerCase();
  return severity === "critical" || severity === "danger" ? "badge-failed" : severity === "warning" ? "badge-warning" : "badge-normal";
};

const ManagerDashboard = () => {
  useLogPageView("Viewed Manager Dashboard");
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [readingResult, alertResult, nodeResult] = await Promise.all([
        supabase.from("sensor_readings").select("id, value, recorded_at, parameters ( name, unit ), nodes ( id, device_label )").order("recorded_at", { ascending: false }).limit(200),
        supabase.from("alerts").select("id, status, triggered_at, thresholds!inner ( min_value, max_value, severity_label, parameters!inner ( name, unit ) ), sensor_readings ( value )").eq("status", "active").order("triggered_at", { ascending: false }).limit(10),
        supabase.from("nodes").select("id, device_label"),
      ]);
      const firstError = readingResult.error || alertResult.error || nodeResult.error;
      if (firstError) setError("Could not load live monitoring data. Ensure the manager RLS policies and manager migration have been applied.");
      setReadings(readingResult.data || []);
      setAlerts(alertResult.data || []);
      setNodes(nodeResult.data || []);
      setCheckedAt(Date.now());
      setLoading(false);
    };
    load();
  }, []);

  const latestFor = (name) => readings.find((reading) => reading.parameters?.name?.toLowerCase() === name.toLowerCase());
  const nodeLastSync = (node) => readings.find((reading) => reading.nodes?.id === node.id)?.recorded_at;
  const isOnline = (time) => time && checkedAt - new Date(time).getTime() <= 5 * 60 * 1000;

  return <div className="admin-shell"><ManagerSidebar /><main className="admin-main manager-main">
    <header className="page-header"><h1>Monitoring Dashboard</h1><p>Current water-quality readings and node health</p></header>
    {error && <p className="manager-error">{error}</p>}
    {loading ? <p>Loading monitoring data...</p> : <>
      <section className="manager-card-grid">
        {PARAMETERS.map((name) => {
          const reading = latestFor(name); const Icon = icons[name.toLowerCase()] || Activity;
          return <article className="manager-stat-card" key={name}><Icon size={21} /><div><p>{name}</p><strong>{reading ? `${reading.value} ${reading.parameters?.unit || ""}` : "No reading"}</strong><small>{reading ? formatDateTime(reading.recorded_at) : "Awaiting data"}</small></div></article>;
        })}
      </section>
      <section className="manager-panel"><div className="manager-panel-heading"><h2>Sensor Status</h2><span>Online if synced in the last 5 minutes</span></div><div className="manager-node-grid">
        {nodes.length === 0 && <p>No monitoring nodes found.</p>}
        {nodes.map((node) => { const sync = nodeLastSync(node); return <article className="manager-node-card" key={node.id}><div><strong>{node.device_label || "Unnamed node"}</strong><p>Last sync: {formatDateTime(sync)}</p></div><span className={`manager-state ${isOnline(sync) ? "online" : "offline"}`}>{isOnline(sync) ? "Online" : "Offline"}</span></article>; })}
      </div></section>
      <section className="manager-two-column">
        <article className="manager-panel"><h2>Active Alerts</h2><div className="table-wrap"><table><thead><tr><th>Parameter</th><th>Reading</th><th>Threshold</th><th>Severity</th></tr></thead><tbody>{alerts.length === 0 ? <tr><td colSpan={4}>No active alerts.</td></tr> : alerts.map((alert) => { const threshold = alert.thresholds; return <tr key={alert.id}><td>{threshold?.parameters?.name || "—"}</td><td>{alert.sensor_readings?.value ?? "—"} {threshold?.parameters?.unit || ""}</td><td>{threshold?.min_value ?? "—"} – {threshold?.max_value ?? "—"}</td><td><span className={`badge ${severityClass(threshold?.severity_label)}`}>{threshold?.severity_label || "—"}</span></td></tr>; })}</tbody></table></div></article>
        <article className="manager-panel"><h2>Recent Readings</h2><div className="table-wrap"><table><thead><tr><th>Time</th><th>Parameter</th><th>Value</th></tr></thead><tbody>{readings.slice(0, 10).map((reading) => <tr key={reading.id}><td>{formatDateTime(reading.recorded_at)}</td><td>{reading.parameters?.name || "—"}</td><td>{reading.value} {reading.parameters?.unit || ""}</td></tr>)}</tbody></table></div></article>
      </section>
    </>}
  </main></div>;
};

export default ManagerDashboard;
