import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Activity,
  Server,
  Radio,
  Wifi,
  HardDrive,
  RefreshCw,
  Clock,
  Layers,
  BatteryCharging,
  Cpu,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  Flame,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ReferenceDot,
  AreaChart,
  Area,
} from "recharts";

import Sidebar from "../../components/Sidebar";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { useSilentRefresh } from "../../hooks/useSilentRefresh";
import { formatDateTime, formatClockTime } from "../../lib/formatters";
import { REFRESH_INTERVALS } from "../../config/constants";
import {
  HEARTBEAT_INTERVAL_MS,
  SENSOR_CYCLE_INTERVAL_MS,
  evaluateNodeStatus,
  decodeQualityFlags,
  decodeSensorResetFlags,
  decodeControllerResetReason,
  calculatePacketLoss,
  inferHeartbeatInterval,
  NODE_STATUS_LABELS,
} from "../../lib/nodeHealth";
import { PageTransition, SlidingTabs } from "../../components/ui";
import "../../styles/admin/NodeHealth.css";

const TIME_RANGES = {
  "6H": { label: "Last 6 Hours", hours: 6 },
  "24H": { label: "Last 24 Hours", hours: 24 },
  "7D": { label: "Last 7 Days", hours: 168 },
};

export default function NodeHealth() {
  useLogPageView("Viewed Node Health");

  // Sub-tabs: "overview", "controller", "sensor"
  const [activeTab, setActiveTab] = useState("overview");

  // Filters & Controls
  const [timeRange, setTimeRange] = useState("24H");
  const [refreshInterval, setRefreshInterval] = useState(REFRESH_INTERVALS.FAST);
  const [checkedAt, setCheckedAt] = useState(null);
  const initialLoadRef = useRef(true);

  // Data states
  const [nodes, setNodes] = useState([]);
  const [nodeStatuses, setNodeStatuses] = useState([]);
  const [rawReadings, setRawReadings] = useState([]);
  const [latestReadings, setLatestReadings] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // 1. Fetch hardware telemetry data
  const fetchData = useCallback(async (signal) => {
    const isInitial = initialLoadRef.current;
    if (isInitial) {
      setLoading(true);
    }

    setError("");

    try {
      const hours = TIME_RANGES[timeRange].hours;
      const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();

      const [nodesRes, statusRes, rawRes, readingsRes] = await Promise.all([
        supabase.from("nodes").select("*"),
        supabase
          .from("node_status")
          .select("*")
          .gte("recorded_at", sinceIso)
          .order("recorded_at", { ascending: false })
          .limit(500),
        supabase
          .from("sensor_readings_raw")
          .select("*")
          .gte("recorded_at", sinceIso)
          .order("recorded_at", { ascending: false })
          .limit(500),
        supabase
          .from("sensor_readings")
          .select("id, node_id, recorded_at, source")
          .order("recorded_at", { ascending: false })
          .limit(10),
      ]);

      if (signal?.aborted) return;

      if (nodesRes.error) throw nodesRes.error;
      if (statusRes.error) throw statusRes.error;
      if (rawRes.error) throw rawRes.error;

      setNodes(nodesRes.data || []);
      setNodeStatuses(statusRes.data || []);
      setRawReadings(rawRes.data || []);
      setLatestReadings(readingsRes.data || []);
      setCheckedAt(Date.now());
    } catch (err) {
      if (signal?.aborted) return;
      console.error("Failed to load node health telemetry:", err);
      setError(
        "Could not load node telemetry. Ensure the migration '20261018000000_node_health_policies_and_indexes.sql' has been applied in Supabase."
      );
    } finally {
      if (isInitial) {
        setLoading(false);
        initialLoadRef.current = false;
      }
    }
  }, [timeRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Silent Refresh Hook
  const { isRefreshing } = useSilentRefresh(fetchData, {
    intervalMs: refreshInterval,
    enabled: refreshInterval > 0,
  });

  // Dynamic interval detection
  const inferredIntervalMs = useMemo(() => {
    return inferHeartbeatInterval(nodeStatuses) || HEARTBEAT_INTERVAL_MS;
  }, [nodeStatuses]);

  // Latest status rows
  const latestStatus = nodeStatuses[0] || null;
  const latestRaw = rawReadings[0] || null;
  const latestSensorReading = latestReadings[0] || null;

  // Station identification
  const masterNode = nodes.find((n) => n.node_type === "master") || nodes[0] || {
    device_label: "Controller Node (Master)",
    id: "821333d5-602d-478e-accc-12fbecb39203",
  };

  const fieldNode = nodes.find((n) => n.node_type === "field") || {
    device_label: "Sensor Node (Field)",
    id: "field-node-station",
  };

  // Controller Health calculation
  const controllerLastSeen = latestStatus?.recorded_at ? new Date(latestStatus.recorded_at) : null;
  const controllerAgeMs = controllerLastSeen ? Date.now() - controllerLastSeen.getTime() : null;
  const controllerStatus = evaluateNodeStatus(controllerAgeMs, inferredIntervalMs);

  // Field Sensor Health calculation
  // The field node is considered online if:
  // 1) Controller received a LoRa packet recently (sensor_last_seen_s <= 2 * CYCLE)
  // 2) Or raw readings arrived recently
  const sensorLastSeenTime = useMemo(() => {
    if (latestStatus?.sensor_last_seen_s != null && latestStatus.sensor_last_seen_s >= 0 && controllerLastSeen) {
      return new Date(controllerLastSeen.getTime() - latestStatus.sensor_last_seen_s * 1000);
    }
    if (latestRaw?.recorded_at) {
      return new Date(latestRaw.recorded_at);
    }
    if (latestSensorReading?.recorded_at) {
      return new Date(latestSensorReading.recorded_at);
    }
    return null;
  }, [latestStatus, controllerLastSeen, latestRaw, latestSensorReading]);

  const sensorAgeMs = sensorLastSeenTime ? Date.now() - sensorLastSeenTime.getTime() : null;
  const sensorStatus = evaluateNodeStatus(sensorAgeMs, SENSOR_CYCLE_INTERVAL_MS);

  // Packet Loss calculation
  const packetStats = useMemo(() => {
    return calculatePacketLoss(rawReadings);
  }, [rawReadings]);

  // ============================================================================
  // ECG HEARTBEAT STRIP CHART DATA PREPARATION
  // ============================================================================
  const { ecgData, rebootPoints, missingSegments } = useMemo(() => {
    if (!nodeStatuses || nodeStatuses.length === 0) {
      return { ecgData: [], rebootPoints: [], missingSegments: [] };
    }

    // Chronological order
    const sorted = [...nodeStatuses].sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );

    const points = [];
    const reboots = [];
    const missing = [];
    let prevUptime = null;
    let prevTime = null;

    sorted.forEach((row, idx) => {
      const t = new Date(row.recorded_at).getTime();
      const timeStr = formatClockTime(row.recorded_at);

      // Detect controller reboot (uptime dropped)
      if (prevUptime != null && row.controller_uptime_s != null && row.controller_uptime_s < prevUptime) {
        reboots.push({
          timeStr,
          timestamp: t,
          uptime: row.controller_uptime_s,
          reason: decodeControllerResetReason(row.controller_reset_reason),
        });
      }
      prevUptime = row.controller_uptime_s;

      // Detect missed heartbeat gap (> 2x inferred interval)
      if (prevTime != null) {
        const gap = t - prevTime;
        if (gap > inferredIntervalMs * 2) {
          missing.push({
            start: formatClockTime(new Date(prevTime).toISOString()),
            end: timeStr,
            gapMin: Math.round(gap / 60000),
          });
        }
      }
      prevTime = t;

      // Draw ECG P-Q-R-S-T wave pulse
      // Lead-in baseline
      points.push({ time: `${timeStr}_a`, displayTime: timeStr, value: 0, row });
      // P small deflection
      points.push({ time: `${timeStr}_b`, displayTime: timeStr, value: 0.15, row });
      // Q negative dip
      points.push({ time: `${timeStr}_c`, displayTime: timeStr, value: -0.2, row });
      // R sharp positive spike (Heartbeat arrived!)
      points.push({ time: timeStr, displayTime: timeStr, value: 1.0, row });
      // S negative dip
      points.push({ time: `${timeStr}_e`, displayTime: timeStr, value: -0.3, row });
      // T recovery bump
      points.push({ time: `${timeStr}_f`, displayTime: timeStr, value: 0.2, row });
      // Lead-out baseline
      points.push({ time: `${timeStr}_g`, displayTime: timeStr, value: 0, row });
    });

    return { ecgData: points, rebootPoints: reboots, missingSegments: missing };
  }, [nodeStatuses, inferredIntervalMs]);

  // Controller Time-series Data
  const controllerChartData = useMemo(() => {
    return [...nodeStatuses]
      .reverse()
      .map((s) => ({
        time: formatClockTime(s.recorded_at),
        wifi_rssi: s.wifi_rssi ?? null,
        queue_depth: s.queue_depth ?? 0,
        free_heap_kb: s.free_heap ? Math.round(s.free_heap / 1024) : null,
        uptime_hr: s.controller_uptime_s ? Math.round((s.controller_uptime_s / 3600) * 10) / 10 : 0,
        lora_rssi: s.last_lora_rssi ?? null,
        lora_snr: s.last_lora_snr ?? null,
      }));
  }, [nodeStatuses]);

  // Sensor Time-series Data
  const sensorChartData = useMemo(() => {
    return [...rawReadings]
      .reverse()
      .map((r) => ({
        time: formatClockTime(r.recorded_at),
        supply_mv: r.supply_mv ?? null,
        lora_rssi: r.lora_rssi ?? null,
        lora_snr: r.lora_snr ?? null,
        seq: r.seq ?? null,
        quality_flags: r.quality_flags ?? 0,
      }));
  }, [rawReadings]);

  // Latest decoded quality flags
  const activeQualityFlags = useMemo(() => {
    return decodeQualityFlags(latestRaw?.quality_flags ?? 0);
  }, [latestRaw]);

  return (
    <div className="admin-shell">
      <Sidebar />

      <PageTransition className="admin-main">
        <header className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1>Node Health & Diagnostics</h1>
            <p>Real-time hardware status, heartbeat ECG telemetry, and link reliability</p>
          </div>

          <div className="nh-header-controls">
            {/* Time Range Selector */}
            <select
              className="nh-select"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              aria-label="Select history range"
            >
              {Object.entries(TIME_RANGES).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>

            {/* Refresh Interval Selector */}
            <select
              className="nh-select"
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              aria-label="Auto-refresh interval"
            >
              <option value={REFRESH_INTERVALS.OFF}>Auto-refresh: Off</option>
              <option value={REFRESH_INTERVALS.FAST}>Refresh: 30s</option>
              <option value={REFRESH_INTERVALS.MEDIUM}>Refresh: 1m</option>
              <option value={REFRESH_INTERVALS.SLOW}>Refresh: 5m</option>
            </select>

            {/* Manual Refresh Button */}
            <button
              type="button"
              className="nh-refresh-btn"
              onClick={fetchData}
              disabled={isRefreshing}
              title="Refresh Telemetry Now"
            >
              <RefreshCw size={14} className={isRefreshing ? "spinning" : ""} />
              <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
            </button>

            {checkedAt && (
              <span className="nh-last-checked">
                Last checked: {formatClockTime(new Date(checkedAt).toISOString())}
              </span>
            )}
          </div>
        </header>

        {error && (
          <div className="nh-alert-banner danger">
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>
              <div className="nh-alert-title">Database RLS Policy Required</div>
              <div className="nh-alert-body">{error}</div>
            </div>
          </div>
        )}

        {/* Paper-Aligned Field Health Warning */}
        {sensorStatus === NODE_STATUS_LABELS.OFFLINE && (
          <div className="nh-alert-banner warning">
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
            <div>
              <div className="nh-alert-title">Sensor Node Communication Loss</div>
              <div className="nh-alert-body">
                The Field Sensor Node has not reported readings for {sensorAgeMs ? Math.round(sensorAgeMs / 60000) : "—"} minutes
                (expected every 30 minutes). Check solar power rail, LoRa link line-of-sight, or river container pump relays.
              </div>
            </div>
          </div>
        )}

        {/* Sub-Tabs Navigation */}
        <SlidingTabs
          className="nh-tabs"
          layoutId="nhTabUnderline"
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: "overview", label: "System Overview", icon: Layers },
            { id: "controller", label: "Controller Node (Master)", icon: Server },
            { id: "sensor", label: "Sensor Node (Field)", icon: Radio },
          ]}
        />

        {/* ==================================================================== */}
        {/* SUB-TAB 1: SYSTEM OVERVIEW                                          */}
        {/* ==================================================================== */}
        {activeTab === "overview" && (
          <div className="node-health-page">
            {/* Top Node Cards */}
            <div className="nh-nodes-grid">
              {/* Controller Node Card */}
              <article className="nh-node-card">
                <div className="nh-node-card-header">
                  <div className="nh-node-card-title">
                    <Server size={20} color="#0284c7" />
                    <div>
                      <div className="nh-node-name">{masterNode.device_label || "Controller Node"}</div>
                      <div className="nh-node-type">Master Node · ESP32 Gateway</div>
                    </div>
                  </div>
                  <span className={`nh-badge nh-badge-${controllerStatus.toLowerCase()}`}>
                    <span className="nh-dot" />
                    {controllerStatus}
                  </span>
                </div>

                <div className="nh-node-vitals">
                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Last Heartbeat</span>
                    <span className="nh-vital-value">
                      {controllerLastSeen ? formatDateTime(controllerLastSeen.toISOString()) : "No heartbeat"}
                    </span>
                    <span className="nh-vital-sub">
                      {controllerAgeMs ? `${Math.round(controllerAgeMs / 60000)} min ago` : "Offline"}
                    </span>
                  </div>

                  <div className="nh-vital-item">
                    <span className="nh-vital-label">WiFi Signal</span>
                    <span className="nh-vital-value">
                      {latestStatus?.wifi_rssi != null ? `${latestStatus.wifi_rssi} dBm` : "—"}
                    </span>
                    <span className="nh-vital-sub">
                      {latestStatus?.wifi_rssi > -70 ? "Strong Link" : "Moderate Link"}
                    </span>
                  </div>

                  <div className="nh-vital-item">
                    <span className="nh-vital-label">MicroSD Storage</span>
                    <span className="nh-vital-value">
                      {latestStatus?.sd_ok ? "✓ Operational" : "⚠ Degraded / Fail"}
                    </span>
                    <span className="nh-vital-sub">Offline backup journal</span>
                  </div>

                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Upload Backlog</span>
                    <span className="nh-vital-value">
                      {latestStatus?.queue_depth ?? 0} queued
                    </span>
                    <span className="nh-vital-sub">
                      {latestStatus?.queue_depth === 0 ? "All frames synced" : "Pending upload"}
                    </span>
                  </div>
                </div>
              </article>

              {/* Sensor Node Card */}
              <article className="nh-node-card">
                <div className="nh-node-card-header">
                  <div className="nh-node-card-title">
                    <Radio size={20} color="#16a34a" />
                    <div>
                      <div className="nh-node-name">{fieldNode.device_label || "Sensor Node"}</div>
                      <div className="nh-node-type">Field Node · ATmega2560 Transceiver</div>
                    </div>
                  </div>
                  <span className={`nh-badge nh-badge-${sensorStatus.toLowerCase()}`}>
                    <span className="nh-dot" />
                    {sensorStatus}
                  </span>
                </div>

                <div className="nh-node-vitals">
                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Last Sample Sync</span>
                    <span className="nh-vital-value">
                      {sensorLastSeenTime ? formatDateTime(sensorLastSeenTime.toISOString()) : "No samples"}
                    </span>
                    <span className="nh-vital-sub">
                      {sensorAgeMs ? `${Math.round(sensorAgeMs / 60000)} min ago` : "Offline"}
                    </span>
                  </div>

                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Supply Rail (5V)</span>
                    <span className="nh-vital-value">
                      {latestStatus?.sensor_supply_mv != null
                        ? `${(latestStatus.sensor_supply_mv / 1000).toFixed(2)} V`
                        : latestRaw?.supply_mv != null
                        ? `${(latestRaw.supply_mv / 1000).toFixed(2)} V`
                        : "—"}
                    </span>
                    <span className="nh-vital-sub">Under pump load</span>
                  </div>

                  <div className="nh-vital-item">
                    <span className="nh-vital-label">LoRa Link Quality</span>
                    <span className="nh-vital-value">
                      {latestStatus?.last_lora_rssi != null ? `${latestStatus.last_lora_rssi} dBm` : "—"}
                    </span>
                    <span className="nh-vital-sub">
                      SNR: {latestStatus?.last_lora_snr != null ? `${latestStatus.last_lora_snr} dB` : "—"}
                    </span>
                  </div>

                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Packet Delivery</span>
                    <span className="nh-vital-value">
                      {packetStats.deliveryRate}%
                    </span>
                    <span className="nh-vital-sub">
                      {packetStats.lostPackets} lost of {packetStats.expectedTotal}
                    </span>
                  </div>
                </div>
              </article>
            </div>

            {/* Overall Vitals Metric Pills */}
            <div className="nh-metrics-grid">
              <div className="nh-metric-pill">
                <div className="nh-metric-icon">
                  <Clock size={20} />
                </div>
                <div className="nh-metric-info">
                  <span className="nh-metric-label">Latest Cloud Reading</span>
                  <span className="nh-metric-val">
                    {latestSensorReading ? formatClockTime(latestSensorReading.recorded_at) : "None"}
                  </span>
                </div>
              </div>

              <div className="nh-metric-pill">
                <div className="nh-metric-icon" style={{ background: "rgba(22, 163, 74, 0.1)", color: "#16a34a" }}>
                  <HardDrive size={20} />
                </div>
                <div className="nh-metric-info">
                  <span className="nh-metric-label">MicroSD Backup</span>
                  <span className="nh-metric-val">
                    {latestStatus?.sd_ok ? "OK" : "Degraded"}
                  </span>
                </div>
              </div>

              <div className="nh-metric-pill">
                <div className="nh-metric-icon" style={{ background: "rgba(234, 88, 12, 0.1)", color: "#ea580c" }}>
                  <Layers size={20} />
                </div>
                <div className="nh-metric-info">
                  <span className="nh-metric-label">Backlog Queue</span>
                  <span className="nh-metric-val">
                    {latestStatus?.queue_depth ?? 0}
                  </span>
                </div>
              </div>

              <div className="nh-metric-pill">
                <div className="nh-metric-icon" style={{ background: "rgba(147, 51, 234, 0.1)", color: "#9333ea" }}>
                  <Cpu size={20} />
                </div>
                <div className="nh-metric-info">
                  <span className="nh-metric-label">Controller Heap</span>
                  <span className="nh-metric-val">
                    {latestStatus?.free_heap ? `${Math.round(latestStatus.free_heap / 1024)} KB` : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick ECG Preview on Overview */}
            <article className="nh-chart-card">
              <div className="nh-chart-header">
                <div>
                  <h2 className="nh-chart-title">
                    <Activity size={18} color="#0284c7" />
                    Heartbeat Pulse Strip (ECG Monitor)
                  </h2>
                  <p className="nh-chart-desc">
                    Pulses indicate verified Controller heartbeats. Expected frequency: ~{Math.round(inferredIntervalMs / 60000)} minutes.
                  </p>
                </div>
                <div className="nh-chart-legend">
                  <div className="nh-legend-item">
                    <span className="nh-legend-color" style={{ background: "#0284c7" }} />
                    <span>Received Heartbeat Pulse</span>
                  </div>
                  {rebootPoints.length > 0 && (
                    <div className="nh-legend-item">
                      <span className="nh-legend-color" style={{ background: "#dc2626" }} />
                      <span>Controller Reboot ({rebootPoints.length})</span>
                    </div>
                  )}
                </div>
              </div>

              {ecgData.length === 0 ? (
                <div className="nh-empty-card">
                  <HelpCircle size={32} className="nh-empty-icon" />
                  <p>No heartbeat telemetry recorded within {TIME_RANGES[timeRange].label.toLowerCase()}.</p>
                </div>
              ) : (
                <div className="nh-ecg-container">
                  <ResponsiveContainer width="100%" height={170}>
                    <LineChart data={ecgData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="displayTime" tick={{ fontSize: 11 }} />
                      <YAxis domain={[-0.5, 1.2]} ticks={[0, 1]} tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(val, name, props) => [
                          val >= 0.8 ? "Heartbeat Received" : "Baseline",
                          "Pulse Status",
                        ]}
                        labelFormatter={(label, items) => {
                          const r = items?.[0]?.payload?.row;
                          return r ? `${formatDateTime(r.recorded_at)} (Uptime: ${Math.round(r.controller_uptime_s / 60)} min)` : label;
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#0284c7"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
          </div>
        )}

        {/* ==================================================================== */}
        {/* SUB-TAB 2: CONTROLLER NODE (MASTER)                                 */}
        {/* ==================================================================== */}
        {activeTab === "controller" && (
          <div className="node-health-page">
            {/* ECG Strip Chart Full Width */}
            <article className="nh-chart-card">
              <div className="nh-chart-header">
                <div>
                  <h2 className="nh-chart-title">
                    <Activity size={18} color="#0284c7" />
                    ECG Heartbeat Timeline & Reboot Flags
                  </h2>
                  <p className="nh-chart-desc">
                    Reboot flags highlight drops in `controller_uptime_s`. Inferred interval: {Math.round(inferredIntervalMs / 60000)} min.
                  </p>
                </div>
              </div>

              {ecgData.length === 0 ? (
                <div className="nh-empty-card">
                  <p>No heartbeat rows available.</p>
                </div>
              ) : (
                <div className="nh-ecg-container">
                  <ResponsiveContainer width="100%" height={170}>
                    <LineChart data={ecgData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="displayTime" tick={{ fontSize: 11 }} />
                      <YAxis domain={[-0.5, 1.2]} ticks={[0, 1]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#0284c7"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Reboot Events Log */}
              {rebootPoints.length > 0 && (
                <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef2f2", borderRadius: "8px" }}>
                  <strong style={{ fontSize: "0.85rem", color: "#991b1b" }}>Detected Controller Reboots:</strong>
                  <ul style={{ margin: "0.5rem 0 0 1.25rem", fontSize: "0.82rem", color: "#b91c1c" }}>
                    {rebootPoints.map((rb, idx) => (
                      <li key={idx}>
                        Reboot at {rb.timeStr} · Reason: <strong>{rb.reason}</strong> (Uptime reset to {rb.uptime}s)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>

            {/* Controller Metrics Split Charts */}
            <div className="nh-nodes-grid">
              {/* WiFi RSSI Chart */}
              <article className="nh-chart-card" style={{ marginBottom: 0 }}>
                <h3 className="nh-chart-title">
                  <Wifi size={16} color="#0284c7" />
                  WiFi RSSI Link (dBm)
                </h3>
                <p className="nh-chart-desc">Signal strength between Controller Node and Local AP</p>
                <div style={{ height: "180px", marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={controllerChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis domain={[-95, -30]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="wifi_rssi" stroke="#0284c7" fill="rgba(2, 132, 199, 0.15)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </article>

              {/* Free Heap Memory Chart */}
              <article className="nh-chart-card" style={{ marginBottom: 0 }}>
                <h3 className="nh-chart-title">
                  <Cpu size={16} color="#9333ea" />
                  ESP32 Free Heap (KB)
                </h3>
                <p className="nh-chart-desc">Tracks dynamic memory to verify no RAM exhaustion or leaks</p>
                <div style={{ height: "180px", marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={controllerChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="free_heap_kb" stroke="#9333ea" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </div>

            {/* Queue Depth & LoRa Link History */}
            <div className="nh-nodes-grid">
              {/* Backlog Queue Depth */}
              <article className="nh-chart-card" style={{ marginBottom: 0 }}>
                <h3 className="nh-chart-title">
                  <Layers size={16} color="#ea580c" />
                  Upload Queue Depth (Frames Backlog)
                </h3>
                <p className="nh-chart-desc">Spikes indicate network drops where frames buffered on SD card</p>
                <div style={{ height: "180px", marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={controllerChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="queue_depth" stroke="#ea580c" fill="rgba(234, 88, 12, 0.15)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </article>

              {/* LoRa Signal from Sensor Node */}
              <article className="nh-chart-card" style={{ marginBottom: 0 }}>
                <h3 className="nh-chart-title">
                  <Radio size={16} color="#16a34a" />
                  Received LoRa Signal Quality
                </h3>
                <p className="nh-chart-desc">RSSI (dBm) and SNR (dB) from Field Sensor transmissions</p>
                <div style={{ height: "180px", marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={controllerChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" domain={[-125, -40]} tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" domain={[-15, 15]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line yAxisId="left" type="monotone" dataKey="lora_rssi" stroke="#16a34a" strokeWidth={1.5} dot={false} name="RSSI (dBm)" />
                      <Line yAxisId="right" type="monotone" dataKey="lora_snr" stroke="#0ea5e9" strokeWidth={1.5} dot={false} name="SNR (dB)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* SUB-TAB 3: SENSOR NODE (FIELD)                                      */}
        {/* ==================================================================== */}
        {activeTab === "sensor" && (
          <div className="node-health-page">
            {/* Supply Rail & Reset Flags Overview */}
            <div className="nh-nodes-grid">
              {/* Battery / 5V Supply Rail Voltage */}
              <article className="nh-chart-card" style={{ marginBottom: 0 }}>
                <h3 className="nh-chart-title">
                  <BatteryCharging size={18} color="#16a34a" />
                  Field 5V Supply Voltage Under Pump Load (mV)
                </h3>
                <p className="nh-chart-desc">
                  Recorded during intake pump activation. Dips below 4,500 mV indicate brownout hazard.
                </p>
                <div style={{ height: "180px", marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sensorChartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis domain={[4200, 5300]} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(val) => [`${val} mV (${(val / 1000).toFixed(2)} V)`, "Supply"]} />
                      <Area type="monotone" dataKey="supply_mv" stroke="#16a34a" fill="rgba(22, 163, 74, 0.15)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </article>

              {/* LoRa Packet Sequence & Loss Counter */}
              <article className="nh-chart-card" style={{ marginBottom: 0 }}>
                <h3 className="nh-chart-title">
                  <Layers size={18} color="#0284c7" />
                  Packet Sequence Counter & Reliability
                </h3>
                <p className="nh-chart-desc">
                  Detects missing sequence gaps (uint8 0..255).
                </p>

                <div className="nh-vitals-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Packets Delivered</span>
                    <span className="nh-vital-value">{packetStats.receivedCount}</span>
                    <span className="nh-vital-sub">Frames received by Master</span>
                  </div>
                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Packets Lost</span>
                    <span className="nh-vital-value" style={{ color: packetStats.lostPackets > 0 ? "#dc2626" : "inherit" }}>
                      {packetStats.lostPackets}
                    </span>
                    <span className="nh-vital-sub">Missing sequence gaps</span>
                  </div>
                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Delivery Rate</span>
                    <span className="nh-vital-value" style={{ color: packetStats.deliveryRate > 95 ? "#16a34a" : "#d97706" }}>
                      {packetStats.deliveryRate}%
                    </span>
                    <span className="nh-vital-sub">Success percentage</span>
                  </div>
                  <div className="nh-vital-item">
                    <span className="nh-vital-label">Latest Sequence #</span>
                    <span className="nh-vital-value">#{latestRaw?.seq ?? "—"}</span>
                    <span className="nh-vital-sub">Current rollover cycle</span>
                  </div>
                </div>
              </article>
            </div>

            {/* Diagnostic Flags & Sensor State */}
            <article className="nh-chart-card">
              <h3 className="nh-chart-title">
                <CheckCircle size={18} color="#0284c7" />
                Active Sensor Node Hardware Flags
              </h3>
              <p className="nh-chart-desc">
                Decoded directly from `sensor_readings_raw.quality_flags` and ATmega2560 `MCUSR` register.
              </p>

              <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                {/* Reset Reason */}
                <div style={{ padding: "0.85rem", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px" }}>
                  <strong style={{ fontSize: "0.85rem" }}>Sensor Node Reset Cause (MCUSR):</strong>
                  <p style={{ marginTop: "0.35rem", fontSize: "0.9rem", fontWeight: 600, color: "var(--color-primary)" }}>
                    {decodeSensorResetFlags(latestStatus?.sensor_reset_flags ?? latestRaw?.reset_flags)}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.2rem" }}>
                    Raw code: {latestStatus?.sensor_reset_flags != null ? `0x${latestStatus.sensor_reset_flags.toString(16).toUpperCase()}` : "—"}
                  </p>
                </div>

                {/* Quality Flags */}
                <div style={{ padding: "0.85rem", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px" }}>
                  <strong style={{ fontSize: "0.85rem" }}>Active Reading Quality Flags:</strong>
                  {activeQualityFlags.length === 0 ? (
                    <div className="nh-flag-list">
                      <span className="nh-flag-pill clean">✓ All Sensor Signals Nominal (0x00)</span>
                    </div>
                  ) : (
                    <div className="nh-flag-list">
                      {activeQualityFlags.map((q) => (
                        <span key={q.key} className="nh-flag-pill">
                          ⚠ {q.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.4rem" }}>
                    Raw quality mask: {latestRaw?.quality_flags != null ? `0x${latestRaw.quality_flags.toString(16).toUpperCase()}` : "0x00"}
                  </p>
                </div>
              </div>
            </article>

            {/* Raw ADC Telemetry Table */}
            <article className="nh-chart-card">
              <h3 className="nh-chart-title">
                <Layers size={18} color="#0284c7" />
                Raw Transceiver Packet Log (sensor_readings_raw)
              </h3>
              <p className="nh-chart-desc">
                Latest unprocessed LoRa payload frames received at Controller Node
              </p>

              {rawReadings.length === 0 ? (
                <div className="nh-empty-card">
                  <p>No raw readings found for this time range.</p>
                </div>
              ) : (
                <div className="table-wrap" style={{ marginTop: "1rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Recorded At</th>
                        <th>Seq #</th>
                        <th>Raw Turbidity (A0)</th>
                        <th>Raw pH (A1)</th>
                        <th>Raw TDS (A2)</th>
                        <th>Supply Rail</th>
                        <th>LoRa Signal</th>
                        <th>Quality Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rawReadings.slice(0, 15).map((row, i) => {
                        const flags = decodeQualityFlags(row.quality_flags);
                        return (
                          <tr key={`${row.node_id}-${row.recorded_at}-${i}`}>
                            <td>{formatDateTime(row.recorded_at)}</td>
                            <td>#{row.seq ?? "—"}</td>
                            <td>{row.raw_turbidity ?? "—"}</td>
                            <td>{row.raw_ph ?? "—"}</td>
                            <td>{row.raw_tds ?? "—"}</td>
                            <td>{row.supply_mv ? `${row.supply_mv} mV` : "—"}</td>
                            <td>
                              {row.lora_rssi != null ? `${row.lora_rssi} dBm` : "—"}
                              {row.lora_snr != null ? ` (${row.lora_snr} dB)` : ""}
                            </td>
                            <td>
                              {flags.length === 0 ? (
                                <span style={{ color: "#16a34a", fontSize: "0.8rem", fontWeight: 600 }}>Nominal</span>
                              ) : (
                                <span style={{ color: "#dc2626", fontSize: "0.8rem", fontWeight: 600 }}>
                                  {flags.map((f) => f.key).join(", ")}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </div>
        )}
      </PageTransition>
    </div>
  );
}
