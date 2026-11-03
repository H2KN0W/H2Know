import { useState, useMemo } from "react";
import {
  Droplets,
  Waves,
  Gauge,
  Thermometer,
  ShieldCheck,
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Calendar,
} from "lucide-react";
import { buildSensorSummary, INSIGHT_PARAMETERS } from "../lib/insights";

const PARAM_META = {
  pH: { icon: Droplets, color: "#0284c7", standardLabel: "DENR 6.5–8.5" },
  Turbidity: { icon: Waves, color: "#0ea5e9", standardLabel: "Class C ≤ 5 NTU" },
  TDS: { icon: Gauge, color: "#6366f1", standardLabel: "Class C ≤ 500 ppm" },
  Temperature: { icon: Thermometer, color: "#f59e0b", standardLabel: "Ambient 25–31 °C" },
};

const WINDOW_OPTIONS = [
  { days: 3, label: "3 Days" },
  { days: 5, label: "5 Days" },
  { days: 7, label: "7 Days" },
  { days: 14, label: "2 Weeks" },
];

export default function SensorSummaryCard({ readings = [], thresholds = [], excludeTurbidity = false }) {
  const [selectedWindowDays, setSelectedWindowDays] = useState(5);

  const summary = useMemo(() => {
    return buildSensorSummary(readings, thresholds, selectedWindowDays);
  }, [readings, thresholds, selectedWindowDays]);

  const { overallCondition, overallBadge, parameterStats, interpretations, totalReadingsInWindow } = summary;

  return (
    <section className="sensor-summary-card" aria-label="Empirical sensor reading interpretation and summary">
      {/* Card Header */}
      <div className="summary-card-header">
        <div className="summary-card-title-group">
          <div className="summary-card-badge-row">
            <span className="summary-card-eyebrow">Ground Truth Summary</span>
            <span className={`summary-status-badge badge-${overallBadge}`}>
              {overallBadge === "optimal" && <ShieldCheck size={14} className="badge-icon" />}
              {overallBadge === "moderate" && <Info size={14} className="badge-icon" />}
              {overallBadge === "stressed" && <AlertTriangle size={14} className="badge-icon" />}
              {overallCondition}
            </span>
          </div>
          <h2 className="summary-card-title">Watershed Observation & Empirical Baseline</h2>
          <p className="summary-card-subtitle">
            Observed telemetry from {totalReadingsInWindow} valid samples across the last {selectedWindowDays} days.
          </p>
        </div>

        {/* Window Selector Controls */}
        <div className="summary-window-selector" role="group" aria-label="Historical Window Duration">
          <Calendar size={14} className="calendar-icon" aria-hidden="true" />
          <span className="window-label">Window:</span>
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              className={`window-pill-btn ${selectedWindowDays === opt.days ? "active" : ""}`}
              onClick={() => setSelectedWindowDays(opt.days)}
              aria-pressed={selectedWindowDays === opt.days}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cross-Parameter / Ground Truth Interpretations Strip */}
      <div className="summary-interpretations-list">
        {interpretations.map((item) => (
          <div key={item.id} className={`interpretation-bubble type-${item.type}`}>
            <div className="interpretation-icon-wrap">
              {item.type === "positive" ? (
                <CheckCircle2 size={16} className="text-emerald-500" />
              ) : (
                <AlertTriangle size={16} className="text-amber-500" />
              )}
            </div>
            <div className="interpretation-content">
              <span className="interpretation-title">{item.title}:</span>
              <span className="interpretation-text">{item.text}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Parameter Baseline Breakdown Grid */}
      <div className="summary-parameters-grid">
        {INSIGHT_PARAMETERS.map((param) => {
          const stats = parameterStats[param];
          const meta = PARAM_META[param] || { icon: Droplets, color: "#64748b", standardLabel: "" };
          const IconComponent = meta.icon;
          const isTurbidityOffline = param === "Turbidity" && excludeTurbidity;

          if (!stats || !stats.hasData) {
            return (
              <div key={param} className="param-stat-cell is-empty">
                <div className="param-stat-top">
                  <span className="param-name">
                    <IconComponent size={15} style={{ color: meta.color }} />
                    {param}
                  </span>
                  <span className="param-status-pill pill-empty">No Telemetry</span>
                </div>
                <div className="param-stat-body">
                  <span className="param-empty-hint">
                    {isTurbidityOffline ? "Sensor Offline" : "No recent readings in window"}
                  </span>
                </div>
              </div>
            );
          }

          const driftSign = stats.driftPercent > 0 ? "+" : "";
          const driftFormatted = stats.driftPercent != null ? `${driftSign}${stats.driftPercent.toFixed(1)}%` : "—";

          return (
            <div key={param} className={`param-stat-cell state-${stats.state}`}>
              <div className="param-stat-top">
                <span className="param-name">
                  <IconComponent size={15} style={{ color: meta.color }} />
                  {param}
                </span>
                <span className={`param-status-pill pill-${stats.state}`}>
                  {stats.complianceRate >= 95 ? "Compliant" : `${stats.complianceRate.toFixed(0)}% In-Spec`}
                </span>
              </div>

              <div className="param-stat-metrics">
                <div className="param-metric-item">
                  <span className="metric-label">Window Avg</span>
                  <span className="metric-val">
                    {stats.mean.toFixed(param === "pH" ? 2 : 1)} <small>{stats.unit}</small>
                  </span>
                </div>

                <div className="param-metric-item">
                  <span className="metric-label">Observed Range</span>
                  <span className="metric-val range-val">
                    {stats.min.toFixed(param === "pH" ? 1 : 0)} – {stats.max.toFixed(param === "pH" ? 1 : 0)}
                  </span>
                </div>

                <div className="param-metric-item">
                  <span className="metric-label">Baseline Drift</span>
                  <div className="drift-badge">
                    {stats.trend === "rising" && <TrendingUp size={13} className="text-amber-500" />}
                    {stats.trend === "falling" && <TrendingDown size={13} className="text-blue-500" />}
                    {stats.trend === "stable" && <Minus size={13} className="text-slate-400" />}
                    <span className="drift-text">{driftFormatted}</span>
                  </div>
                </div>
              </div>

              <div className="param-standard-footer">
                <span className="param-standard-ref">{meta.standardLabel}</span>
                <span className="param-sample-count">{stats.count} samples</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}