import { useMemo, useState, useEffect, useRef } from "react";
import {
  evaluateNodeStatus,
  NODE_STATUS_LABELS,
  ONLINE_WITHIN_MS,
  OFFLINE_AFTER_MS,
  SENSOR_CYCLE_INTERVAL_MS,
} from "../lib/nodeHealth";

/* ─────────────────────────────────────────────────────────
   computeHealth — derives a 0-100 score from existing data.

   Factors:
     1. Freshness  (40 pts): re-anchored to the 30-minute cycle:
         age <= 30 min -> 40 pts
         <= 40 min     -> 36 pts (tiny drop)
         <= 60 min     -> 28 pts
         <= 90 min     -> 16 pts
         otherwise     -> 0 pts
     2. Alert-free (40 pts): active alerts for this node
         0 alerts → 40    1 alert  → 20    ≥ 2    → 0
     3. Node Status (20 pts): based on evaluateNodeStatus(ageMs)
         Online  → 20    Delayed → 10    Offline → 0

   Returns { score: number, factors: [{ label, pts, max }] }
───────────────────────────────────────────────────────── */
function computeHealth({ lastSync, checkedAt, alertCount, status }) {
  const factors = [];
  let score = 0;

  // 1. Freshness
  let freshnessScore = 0;
  let freshnessLabel = "Freshness unknown";
  if (lastSync && checkedAt) {
    const ageMin = (checkedAt - new Date(lastSync).getTime()) / 60000;
    if (ageMin <= 30)       { freshnessScore = 40; freshnessLabel = "Synced <= 30 min ago"; }
    else if (ageMin <= 40) { freshnessScore = 36; freshnessLabel = "Synced <= 40 min ago"; }
    else if (ageMin <= 60) { freshnessScore = 28; freshnessLabel = "Synced <= 1 hr ago"; }
    else if (ageMin <= 90) { freshnessScore = 16; freshnessLabel = "Synced <= 90 min ago"; }
    else                   { freshnessScore = 0;  freshnessLabel = "Last sync > 90 min ago"; }
  }
  score += freshnessScore;
  factors.push({ label: freshnessLabel, pts: freshnessScore, max: 40 });

  // 2. Alert-free
  let alertScore = 20; // partial credit when unknown
  let alertLabel = "Alert data unavailable";
  if (alertCount != null) {
    if (alertCount === 0)      { alertScore = 40; alertLabel = "No active alerts"; }
    else if (alertCount === 1) { alertScore = 20; alertLabel = "1 active alert"; }
    else                       { alertScore = 0;  alertLabel = `${alertCount} active alerts`; }
  }
  score += alertScore;
  factors.push({ label: alertLabel, pts: alertScore, max: 40 });

  // 3. Online / Node Status
  let statusScore = 0;
  let statusLabel = "Currently offline";
  if (status === NODE_STATUS_LABELS.ONLINE) {
    statusScore = 20;
    statusLabel = "Currently online";
  } else if (status === NODE_STATUS_LABELS.DELAYED) {
    statusScore = 10;
    statusLabel = "Reading delayed";
  } else {
    statusScore = 0;
    statusLabel = "Currently offline";
  }
  factors.push({ label: statusLabel, pts: statusScore, max: 20 });
  score += statusScore;

  return { score: Math.max(0, Math.min(100, score)), factors };
}

/* ─── Donut gauge (pure SVG, no new deps) ───────────────── */
const RADIUS = 30;
const STROKE = 6;
const CIRC = 2 * Math.PI * RADIUS;

function DonutGauge({ score }) {
  const color =
    score > 80  ? "#1a9e5c"
    : score >= 50 ? "#b3760a"
    : "#d64545";

  const filled = (score / 100) * CIRC;

  return (
    <svg width={76} height={76} viewBox="0 0 76 76" aria-label={`Health score: ${score}`} role="img">
      {/* Track */}
      <circle cx={38} cy={38} r={RADIUS} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={STROKE} />
      {/* Arc — starts at 12 o'clock (offset = CIRC/4) */}
      <circle
        cx={38} cy={38} r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeDasharray={`${filled} ${CIRC - filled}`}
        strokeDashoffset={CIRC / 4}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.55s cubic-bezier(0.4,0,0.2,1)" }}
      />
      {/* Score */}
      <text x={38} y={35} textAnchor="middle" dominantBaseline="middle"
        fontSize={16} fontWeight={800} fontFamily="'Poppins','Inter',sans-serif" fill={color}>
        {score}
      </text>
      {/* Label */}
      <text x={38} y={49} textAnchor="middle" dominantBaseline="middle"
        fontSize={7} fontWeight={600} fontFamily="'Inter',sans-serif"
        fill="#7a96a4" letterSpacing="0.07em">
        HEALTH
      </text>
    </svg>
  );
}

/* ─── Format Philippines Time (Asia/Manila) ───────────────── */
function formatPHTTime(timestamp, options = {}) {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  });
}

function formatPHTDateTime(timestamp) {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ─────────────────────────────────────────────────────────
   ECG Heartbeat Line Component
───────────────────────────────────────────────────────── */
function HeartbeatLine({ timestamps, status, checkedAt }) {
  const [hoveredBeat, setHoveredBeat] = useState(null);
  const prevCountRef = useRef(timestamps.length);
  const [animatingNewBeat, setAnimatingNewBeat] = useState(false);

  useEffect(() => {
    if (timestamps.length > prevCountRef.current) {
      setAnimatingNewBeat(true);
      const timer = setTimeout(() => setAnimatingNewBeat(false), 2400);
      prevCountRef.current = timestamps.length;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = timestamps.length;
  }, [timestamps.length]);

  const now = checkedAt || Date.now();
  const windowMs = 12 * 60 * 60 * 1000;
  const windowStart = now - windowMs;

  const validTimestamps = useMemo(() => {
    return timestamps
      .filter((t) => t >= windowStart && t <= now + 60000)
      .sort((a, b) => a - b);
  }, [timestamps, windowStart, now]);

  // Color mapping by status
  const themeColor =
    status === NODE_STATUS_LABELS.ONLINE
      ? "#1a9e5c"
      : status === NODE_STATUS_LABELS.DELAYED
      ? "#d97706"
      : "#dc2626";

  // Coordinates
  const SVG_WIDTH = 360;
  const SVG_HEIGHT = 64;
  const Y_BASE = 40;
  const Y_PEAK = 8;
  const Y_DIP1 = 44;
  const Y_DIP2 = 46;

  const getX = (t) => {
    const fraction = (t - windowStart) / windowMs;
    const clamped = Math.max(0, Math.min(1, fraction));
    return Math.round(clamped * SVG_WIDTH * 10) / 10;
  };

  // Segments calculation
  const { segments, spikes, lastBeat, activeDurationMs, nextExpectedTime } = useMemo(() => {
    if (validTimestamps.length === 0) {
      return {
        segments: [],
        spikes: [],
        lastBeat: null,
        activeDurationMs: 0,
        nextExpectedTime: null,
      };
    }

    const latest = validTimestamps[validTimestamps.length - 1];
    const nextExpected = latest + SENSOR_CYCLE_INTERVAL_MS;

    // Calculate active duration (unbroken streak back to last gap > 40 min)
    let streakStart = validTimestamps[0];
    for (let i = validTimestamps.length - 1; i >= 1; i--) {
      const gap = validTimestamps[i] - validTimestamps[i - 1];
      if (gap > ONLINE_WITHIN_MS) {
        streakStart = validTimestamps[i];
        break;
      }
    }
    const activeDuration = Math.max(0, now - streakStart);

    // Build ECG spikes and baseline segments
    const spikeList = validTimestamps.map((t, idx) => {
      const cx = getX(t);
      const isLatest = idx === validTimestamps.length - 1;
      return { t, cx, isLatest };
    });

    // Build segments between spikes
    const segList = [];
    let currentX = 0;

    for (let i = 0; i < spikeList.length; i++) {
      const sp = spikeList[i];
      const spikeStartX = Math.max(currentX, sp.cx - 6);
      const spikeEndX = Math.min(SVG_WIDTH, sp.cx + 6);

      // Check gap from previous spike
      let isGapOver40 = false;
      if (i > 0) {
        const gapMs = sp.t - spikeList[i - 1].t;
        if (gapMs > ONLINE_WITHIN_MS) {
          isGapOver40 = true;
        }
      }

      // Segment up to this spike
      if (spikeStartX > currentX) {
        segList.push({
          x1: currentX,
          x2: spikeStartX,
          isGapOver40,
        });
      }

      // ECG wave path
      const p1 = `${spikeStartX},${Y_BASE}`;
      const p2 = `${sp.cx - 2.5},${Y_DIP1}`;
      const p3 = `${sp.cx},${Y_PEAK}`;
      const p4 = `${sp.cx + 2.5},${Y_DIP2}`;
      const p5 = `${spikeEndX},${Y_BASE}`;
      const spikePath = `M ${p1} L ${p2} L ${p3} L ${p4} L ${p5}`;

      sp.path = spikePath;
      currentX = spikeEndX;
    }

    // Trailing baseline segment from last spike to now/end
    if (currentX < SVG_WIDTH) {
      const ageSinceLatest = now - latest;
      const isTrailingGap = ageSinceLatest > ONLINE_WITHIN_MS;
      segList.push({
        x1: currentX,
        x2: SVG_WIDTH,
        isGapOver40: isTrailingGap,
      });
    }

    return {
      segments: segList,
      spikes: spikeList,
      lastBeat: latest,
      activeDurationMs: activeDuration,
      nextExpectedTime: nextExpected,
    };
  }, [validTimestamps, now, windowStart, windowMs]);

  // Hourly ticks (e.g. 2 PM, 3 PM)
  const hourTicks = useMemo(() => {
    const ticks = [];
    const firstHour = new Date(windowStart);
    firstHour.setMinutes(0, 0, 0);
    if (firstHour.getTime() < windowStart) {
      firstHour.setTime(firstHour.getTime() + 60 * 60 * 1000);
    }

    let curr = firstHour.getTime();
    while (curr <= now) {
      const x = getX(curr);
      const label = formatPHTTime(curr, { minute: undefined }); // e.g. "2 PM"
      ticks.push({ x, label, t: curr });
      curr += 60 * 60 * 1000;
    }
    return ticks;
  }, [windowStart, now]);

  // Compute stat strings
  const lastBeatStr = useMemo(() => {
    if (!lastBeat) return "None";
    const minAgo = Math.max(0, Math.floor((now - lastBeat) / 60000));
    return `${minAgo} min ago`;
  }, [lastBeat, now]);

  const activeStr = useMemo(() => {
    if (!lastBeat || validTimestamps.length === 0) return "0m";
    const totalMin = Math.floor(activeDurationMs / 60000);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }, [activeDurationMs, lastBeat, validTimestamps.length]);

  const nextExpectedStr = useMemo(() => {
    if (!nextExpectedTime) return "—";
    return formatPHTTime(nextExpectedTime);
  }, [nextExpectedTime]);

  const hasNoData = validTimestamps.length === 0;

  return (
    <div className="shg-ecg-container" style={{ width: "100%", marginTop: "10px" }}>
      {/* Short stats summary */}
      <div className="shg-ecg-stats">
        <div className="shg-ecg-stat-item">
          <span className="shg-ecg-stat-label">Last beat:</span>
          <strong className="shg-ecg-stat-value">{lastBeatStr}</strong>
        </div>
        <div className="shg-ecg-stat-item">
          <span className="shg-ecg-stat-label">Active for:</span>
          <strong className="shg-ecg-stat-value">{activeStr}</strong>
        </div>
        <div className="shg-ecg-stat-item">
          <span className="shg-ecg-stat-label">Next expected:</span>
          <strong className="shg-ecg-stat-value">~{nextExpectedStr}</strong>
        </div>
      </div>

      {/* ECG Graphic Area */}
      <div className="shg-ecg-chart-wrap" style={{ position: "relative", width: "100%" }}>
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          width="100%"
          height={SVG_HEIGHT}
          preserveAspectRatio="none"
          className="shg-ecg-svg"
          aria-label="Sensor reading heartbeat ECG"
          role="img"
          style={{ display: "block", overflow: "visible" }}
        >
          {/* Subtle grid lines for ECG aesthetic */}
          <line x1={0} y1={Y_BASE} x2={SVG_WIDTH} y2={Y_BASE} stroke="rgba(0,119,182,0.08)" strokeWidth={1} />
          <line x1={0} y1={Y_PEAK} x2={SVG_WIDTH} y2={Y_PEAK} stroke="rgba(0,119,182,0.04)" strokeWidth={1} strokeDasharray="2 2" />

          {/* Empty state: flat red line with label */}
          {hasNoData ? (
            <g>
              <line x1={0} y1={Y_BASE} x2={SVG_WIDTH} y2={Y_BASE} stroke="#dc2626" strokeWidth={2} />
              <text
                x={SVG_WIDTH / 2}
                y={Y_BASE - 12}
                textAnchor="middle"
                fill="#dc2626"
                fontSize={11}
                fontWeight={600}
                fontFamily="'Inter',sans-serif"
              >
                No data received in last 12 hours
              </text>
            </g>
          ) : (
            <>
              {/* Baseline Segments */}
              {segments.map((seg, sIdx) => (
                <line
                  key={`seg-${sIdx}`}
                  x1={seg.x1}
                  y1={Y_BASE}
                  x2={seg.x2}
                  y2={Y_BASE}
                  stroke={seg.isGapOver40 ? "#dc2626" : themeColor}
                  strokeWidth={2}
                  strokeDasharray={seg.isGapOver40 ? "4 3" : undefined}
                />
              ))}

              {/* Spikes */}
              {spikes.map((sp, spIdx) => {
                const isHovered = hoveredBeat?.t === sp.t;
                const isNew = sp.isLatest && animatingNewBeat;

                return (
                  <g key={`sp-${spIdx}`}>
                    {/* Spike waveform */}
                    <path
                      d={sp.path}
                      fill="none"
                      stroke={themeColor}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={isNew ? "shg-ecg-new-beat" : undefined}
                    />

                    {/* Subtle pulse glow on the newest spike */}
                    {sp.isLatest && (
                      <circle
                        cx={sp.cx}
                        cy={Y_PEAK}
                        r={4}
                        fill={themeColor}
                        className={animatingNewBeat ? "shg-ecg-glow-anim" : "shg-ecg-latest-dot"}
                      />
                    )}

                    {/* Interactive hit area */}
                    <circle
                      cx={sp.cx}
                      cy={Y_PEAK + 12}
                      r={14}
                      fill="transparent"
                      cursor="pointer"
                      onMouseEnter={() => setHoveredBeat(sp)}
                      onMouseLeave={() => setHoveredBeat(null)}
                      onClick={() => setHoveredBeat(hoveredBeat?.t === sp.t ? null : sp)}
                      aria-label={`Reading at ${formatPHTDateTime(sp.t)}`}
                    />

                    {/* Active highlight ring on hover */}
                    {isHovered && (
                      <circle
                        cx={sp.cx}
                        cy={Y_PEAK}
                        r={5}
                        fill="none"
                        stroke={themeColor}
                        strokeWidth={2}
                      />
                    )}
                  </g>
                );
              })}
            </>
          )}

          {/* Hour tick marks */}
          {hourTicks.map((tick, tIdx) => (
            <line
              key={`tick-${tIdx}`}
              x1={tick.x}
              y1={SVG_HEIGHT - 16}
              x2={tick.x}
              y2={SVG_HEIGHT - 12}
              stroke="rgba(0,119,182,0.25)"
              strokeWidth={1}
            />
          ))}
        </svg>

        {/* Hover / Tap Tooltip */}
        {hoveredBeat && (
          <div
            className="shg-ecg-tooltip"
            style={{
              left: `${Math.max(10, Math.min(90, (hoveredBeat.cx / SVG_WIDTH) * 100))}%`,
            }}
          >
            <div className="shg-ecg-tt-time">{formatPHTTime(hoveredBeat.t, { second: "2-digit" })}</div>
            <div className="shg-ecg-tt-sub">{formatPHTDateTime(hoveredBeat.t).split(",")[0]} (PHT)</div>
          </div>
        )}

        {/* Hour tick labels */}
        <div className="shg-ecg-hour-labels">
          {hourTicks.map((tick, idx) => (
            <span
              key={`lbl-${idx}`}
              className="shg-ecg-hour-label"
              style={{
                left: `${(tick.x / SVG_WIDTH) * 100}%`,
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * SensorHealthGauge — always-visible health gauge for a single node.
 *
 * Props:
 *   node       – node row  { id, device_label }
 *   readings   – all sensor_readings rows from Supabase
 *   alerts     – active alerts rows from Supabase
 *   checkedAt  – Date.now() of last fetch
 */
export default function SensorHealthGauge({ node, readings = [], alerts = [], checkedAt }) {
  // Query one parameter (e.g. temperature) for this node in the last 12 hours
  // Distinct timestamps, newest last
  const { nodeReadings, distinctTimestamps, lastSync } = useMemo(() => {
    if (!node) return { nodeReadings: [], distinctTimestamps: [], lastSync: null };

    const matching = readings.filter((r) => r.nodes?.id === node.id);

    // Prefer "temperature" parameter if available, else first parameter found
    let tempReadings = matching.filter(
      (r) => r.parameters?.name?.toLowerCase() === "temperature"
    );
    if (tempReadings.length === 0) {
      tempReadings = matching;
    }

    // Extract timestamps in last 12 hours
    const twelveHoursAgo = (checkedAt || Date.now()) - 12 * 60 * 60 * 1000;
    const timeSet = new Set();
    const timestamps = [];

    tempReadings.forEach((r) => {
      if (!r.recorded_at) return;
      const t = new Date(r.recorded_at).getTime();
      if (!isNaN(t) && !timeSet.has(t) && t >= twelveHoursAgo) {
        timeSet.add(t);
        timestamps.push(t);
      }
    });

    timestamps.sort((a, b) => a - b); // ascending: newest last

    const latest = matching[0]?.recorded_at ?? null;

    return {
      nodeReadings: matching,
      distinctTimestamps: timestamps,
      lastSync: latest,
    };
  }, [node, readings, checkedAt]);

  const ageMs = useMemo(() => {
    if (!lastSync || !checkedAt) return null;
    return Math.max(0, checkedAt - new Date(lastSync).getTime());
  }, [lastSync, checkedAt]);

  const nodeStatus = useMemo(() => {
    return evaluateNodeStatus(ageMs);
  }, [ageMs]);

  const alertCount = useMemo(() => {
    if (!node) return null;
    const nodeReadingIds = new Set(nodeReadings.map((r) => r.id));
    return alerts.filter((a) => nodeReadingIds.has(a.sensor_readings?.id)).length;
  }, [alerts, node, nodeReadings]);

  const { score, factors } = useMemo(
    () => computeHealth({ lastSync, checkedAt, alertCount, status: nodeStatus }),
    [lastSync, checkedAt, alertCount, nodeStatus]
  );

  const formatDT = (v) => (v ? formatPHTDateTime(v) : "No data yet");

  return (
    <div className="shg-card">
      {/* Top row: donut + meta */}
      <div className="shg-top">
        <DonutGauge score={score} />
        <div className="shg-meta">
          <strong className="shg-name">{node?.device_label || "Unnamed node"}</strong>
          <span className={`manager-state ${nodeStatus.toLowerCase()}`}>
            <span className="manager-state-dot" />
            {nodeStatus}
          </span>
          <p className="shg-sync">
            Last sync<br />
            <span>{formatDT(lastSync)}</span>
          </p>
        </div>
      </div>

      {/* Health breakdown */}
      <div className="shg-factors">
        <p className="shg-factors-title">Health Breakdown</p>
        {factors.map((f) => (
          <div key={f.label} className="shg-factor-row" title={`${f.pts} / ${f.max} pts`}>
            <span className="shg-factor-label">{f.label}</span>
            <div className="shg-bar-track">
              <div
                className="shg-bar-fill"
                style={{ width: `${(f.pts / f.max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Heartbeat ECG Line */}
      <div className="shg-heartbeat-section">
        <div className="shg-heartbeat-header">
          <span className="shg-heartbeat-title">Heartbeat (12h)</span>
        </div>
        <HeartbeatLine
          timestamps={distinctTimestamps}
          status={nodeStatus}
          checkedAt={checkedAt}
        />
      </div>
    </div>
  );
}
