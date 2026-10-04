import { useMemo } from "react";

/* ─────────────────────────────────────────────────────────
   computeHealth — derives a 0-100 score from existing data.

   Factors (only what is available is used):
     1. Freshness  (40 pts): age of last sync
         ≤ 5 min  → 40    ≤ 15 min → 28    ≤ 1 hr → 16    else → 0
     2. Alert-free (40 pts): active alerts for this node
         0 alerts → 40    1 alert  → 20    ≥ 2    → 0
     3. Online     (20 pts): synced within the last 5 minutes
         online   → 20    offline  → 0

   Returns { score: number, factors: [{ label, pts, max }] }
───────────────────────────────────────────────────────── */
function computeHealth({ lastSync, checkedAt, alertCount, online }) {
  const factors = [];
  let score = 0;

  // 1. Freshness
  let freshnessScore = 0;
  let freshnessLabel = "Freshness unknown";
  if (lastSync && checkedAt) {
    const ageMin = (checkedAt - new Date(lastSync).getTime()) / 60000;
    if (ageMin <= 5)       { freshnessScore = 40; freshnessLabel = "Synced < 5 min ago"; }
    else if (ageMin <= 15) { freshnessScore = 28; freshnessLabel = "Synced < 15 min ago"; }
    else if (ageMin <= 60) { freshnessScore = 16; freshnessLabel = "Synced < 1 hr ago"; }
    else                   { freshnessScore = 0;  freshnessLabel = "Last sync > 1 hr ago"; }
  }
  score += freshnessScore;
  factors.push({ label: freshnessLabel, pts: freshnessScore, max: 40 });

  // 2. Alert-free
  let alertScore = 20;          // partial credit when unknown
  let alertLabel = "Alert data unavailable";
  if (alertCount != null) {
    if (alertCount === 0)      { alertScore = 40; alertLabel = "No active alerts"; }
    else if (alertCount === 1) { alertScore = 20; alertLabel = "1 active alert"; }
    else                       { alertScore = 0;  alertLabel = `${alertCount} active alerts`; }
  }
  score += alertScore;
  factors.push({ label: alertLabel, pts: alertScore, max: 40 });

  // 3. Online
  const onlineScore = online ? 20 : 0;
  factors.push({ label: online ? "Currently online" : "Currently offline", pts: onlineScore, max: 20 });
  score += onlineScore;

  return { score: Math.max(0, Math.min(100, score)), factors };
}

/* ─── Donut gauge (pure SVG, no new deps) ───────────────── */
const RADIUS = 34;
const STROKE = 7;
const CIRC = 2 * Math.PI * RADIUS;

function DonutGauge({ score }) {
  const color =
    score > 80  ? "#1a9e5c"
    : score >= 50 ? "#b3760a"
    : "#d64545";

  const filled = (score / 100) * CIRC;

  return (
    <svg width={90} height={90} viewBox="0 0 90 90" aria-label={`Health score: ${score}`} role="img">
      {/* Track */}
      <circle cx={45} cy={45} r={RADIUS} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={STROKE} />
      {/* Arc — starts at 12 o'clock (offset = CIRC/4) */}
      <circle
        cx={45} cy={45} r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeDasharray={`${filled} ${CIRC - filled}`}
        strokeDashoffset={CIRC / 4}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.55s cubic-bezier(0.4,0,0.2,1)" }}
      />
      {/* Score */}
      <text x={45} y={41} textAnchor="middle" dominantBaseline="middle"
        fontSize={19} fontWeight={800} fontFamily="'Poppins','Inter',sans-serif" fill={color}>
        {score}
      </text>
      {/* Label */}
      <text x={45} y={57} textAnchor="middle" dominantBaseline="middle"
        fontSize={8} fontWeight={600} fontFamily="'Inter',sans-serif"
        fill="#7a96a4" letterSpacing="0.07em">
        HEALTH
      </text>
    </svg>
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
export default function SensorHealthGauge({ node, readings, alerts, checkedAt }) {
  const lastSync = useMemo(
    () => readings.find((r) => r.nodes?.id === node?.id)?.recorded_at ?? null,
    [readings, node]
  );

  const online = useMemo(
    () => !!lastSync && !!checkedAt && (checkedAt - new Date(lastSync).getTime()) <= 5 * 60 * 1000,
    [lastSync, checkedAt]
  );

  const alertCount = useMemo(() => {
    if (!node) return null;
    const nodeReadingIds = new Set(
      readings.filter((r) => r.nodes?.id === node.id).map((r) => r.id)
    );
    return alerts.filter((a) => nodeReadingIds.has(a.sensor_readings?.id)).length;
  }, [alerts, node, readings]);

  const { score, factors } = useMemo(
    () => computeHealth({ lastSync, checkedAt, alertCount, online }),
    [lastSync, checkedAt, alertCount, online]
  );

  const formatDT = (v) => (v ? new Date(v).toLocaleString() : "No data yet");

  return (
    <div className="shg-card">
      {/* Top row: donut + meta */}
      <div className="shg-top">
        <DonutGauge score={score} />
        <div className="shg-meta">
          <strong className="shg-name">{node?.device_label || "Unnamed node"}</strong>
          <span className={`manager-state ${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"}
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
    </div>
  );
}
