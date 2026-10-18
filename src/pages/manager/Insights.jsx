import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  RefreshCw,
  CloudRain,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Droplets,
  Waves,
  Gauge,
  Thermometer,
  Calendar,
  Compass,
  ArrowRight,
  Layers,
  Sparkles,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { useSilentRefresh } from "../../hooks/useSilentRefresh";
import { buildInsights } from "../../lib/insights";
import { fetchWeatherInsights } from "../../lib/weather";
import WeatherWidget from "../../components/WeatherWidget";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/Insights.css";

import { formatDateTime } from "../../lib/formatters";
import { REFRESH_INTERVALS } from "../../config/constants";

const HISTORY_DAYS = 14;

const formatValue = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

const PARAM_ICONS = {
  pH: Droplets,
  TDS: Gauge,
  Turbidity: Waves,
  Temperature: Thermometer,
};

const withNodeLocation = (row) => ({
  ...row,
  nodes: row.nodes ? { ...row.nodes, location: row.nodes.device_label } : row.nodes,
});

const Insights = () => {
  useLogPageView("Viewed Insights");
  const [readings, setReadings] = useState([]);
  const [thresholds, setThresholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [activeHorizonTab, setActiveHorizonTab] = useState("both"); // "current" | "longterm" | "both"
  const initialLoadRef = useRef(true);

  const loadWeatherInsights = useCallback(async (currentReadings = []) => {
    setWeatherLoading(true);
    setWeatherError("");
    try {
      const data = await fetchWeatherInsights(currentReadings);
      setWeather(data);
    } catch (e) {
      setWeatherError(e.message || "Could not load weather insights.");
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  const loadInsightsData = useCallback(async (signal) => {
    const isInitial = initialLoadRef.current;
    if (isInitial) {
      setLoading(true);
    }

    setError("");
    try {
      const from = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const [readingResult, thresholdResult] = await Promise.all([
        supabase
          .from("sensor_readings")
          .select("id, value, source, recorded_at, parameter_id, parameters ( id, name, unit ), nodes ( id, device_label )")
          .gte("recorded_at", from)
          .order("recorded_at", { ascending: false })
          .limit(3000),
        supabase
          .from("thresholds")
          .select("parameter_id, min_value, max_value, severity_label"),
      ]);

      if (signal?.aborted) return;

      if (readingResult.error || thresholdResult.error) {
        throw readingResult.error || thresholdResult.error;
      }
      const loadedReadings = (readingResult.data || []).map(withNodeLocation);
      const loadedThresholds = thresholdResult.data || [];

      setReadings(loadedReadings);
      setThresholds(loadedThresholds);
      setUpdatedAt(new Date().toISOString());

      // Trigger weather and AI correlation analysis with freshly loaded data
      loadWeatherInsights(loadedReadings);
    } catch (fetchError) {
      if (signal?.aborted) return;
      setError(fetchError.message || "Could not load sensor readings and configured thresholds.");
      setReadings([]);
      setThresholds([]);
    } finally {
      if (isInitial) {
        setLoading(false);
        initialLoadRef.current = false;
      }
    }
  }, [loadWeatherInsights]);

  useEffect(() => {
    loadInsightsData();
  }, [loadInsightsData]);

  // Silent Refresh Hook (30 min interval)
  const { isRefreshing } = useSilentRefresh(loadInsightsData, {
    intervalMs: REFRESH_INTERVALS.WEATHER,
    enabled: true,
  });

  // Debounced realtime handler
  const realtimeDebounceRef = useRef(null);

  useEffect(() => {
    const channel = supabase
      .channel("manager-insights-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sensor_readings" }, () => {
        if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
        realtimeDebounceRef.current = setTimeout(() => loadInsightsData(), 1500);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thresholds" }, () => {
        if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
        realtimeDebounceRef.current = setTimeout(() => loadInsightsData(), 1500);
      })
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadInsightsData]);

  // Client-side statistical calculation and backtesting
  const insights = useMemo(() => buildInsights(readings, thresholds), [readings, thresholds]);

  // Unified AI analysis payload (from Edge endpoint with client fallback)
  const unifiedAnalysis = weather?.unifiedAnalysis;
  const weatherSummary = weather?.weatherSummary;

  // Derive unified risk level
  const riskLevel = unifiedAnalysis?.riskLevel || "low";
  const runoffAnalysis = unifiedAnalysis?.runoffAnalysis;
  const currentInterpretation = unifiedAnalysis?.currentInterpretation;
  const longTermPredictiveImpacts = unifiedAnalysis?.longTermPredictiveImpacts;
  const recommendations = unifiedAnalysis?.recommendations;

  // Condition evaluation
  const conditionState = insights.status === "Insufficient Data for Analysis"
    ? "insufficient"
    : insights.status === "Within configured thresholds"
      ? "within"
      : "exceedance";

  const conditionIcon = conditionState === "within"
    ? ShieldCheck
    : conditionState === "exceedance"
      ? ShieldAlert
      : AlertTriangle;

  const ConditionIconComponent = conditionIcon;

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <main className="admin-main manager-main insights-page">
        {/* Page Header */}
        <header className="page-header page-header-with-actions">
          <div>
            <h1>Watershed Insights</h1>
            <p>Unified telemetry, Open-Meteo runoff modeling, and multi-horizon AI intelligence</p>
          </div>
          <WeatherWidget />
          <div className="insights-refreshed">
            <span className="insights-refreshed-label">Data Refreshed</span>
            <time className="insights-refreshed-time">{formatDateTime(updatedAt)}</time>
            <button
              type="button"
              className="insights-button"
              onClick={() => loadInsightsData()}
              disabled={loading || weatherLoading}
              title="Refresh telemetry and AI predictive analysis"
            >
              <RefreshCw size={14} className={weatherLoading ? "spin" : ""} aria-hidden="true" />
              <span>Refresh analysis</span>
            </button>
          </div>
        </header>

        {/* Global Loading / Error State */}
        {loading && !updatedAt ? (
          <section className="insights-loading" aria-live="polite">
            <span className="spinner spinner-dark" role="status" aria-label="Loading insights" />
            <p>Correlating live sensor readings, thresholds, and meteorological models…</p>
          </section>
        ) : error && readings.length === 0 ? (
          <section className="insights-empty" aria-live="polite">
            <h2>No analysis available</h2>
            <p>{error}</p>
            <button type="button" className="insights-button" onClick={() => loadInsightsData()}>
              Retry
            </button>
          </section>
        ) : (
          /* ═══════════════════════════════════════════════════════════════════
             UNIFIED ANALYSIS PANEL (Consolidated Executive Intelligence)
             ═══════════════════════════════════════════════════════════════════ */
          <div className="unified-analysis-panel">
            {weatherError && !weatherLoading && (
              <div className="unified-notice is-warn">
                <AlertTriangle size={14} />
                <span>Operating on local hydrological model: {weatherError}</span>
              </div>
            )}
            {/* ── 1. Executive AI Synthesis & Environmental Risk Banner ── */}
            <section className={`unified-hero is-${conditionState}`} aria-label="Executive Health Overview">
              <div className="unified-hero-top">
                <div className="unified-hero-title-group">
                  <span className="unified-hero-icon-wrap">
                    <ConditionIconComponent size={28} />
                  </span>
                  <div>
                    <span className="unified-hero-eyebrow">Executive Water Quality &amp; Watershed Assessment</span>
                    <h2 className="unified-hero-status">{insights.status}</h2>
                  </div>
                </div>

                <div className="unified-hero-badges">
                  <span className={`unified-risk-pill is-${riskLevel}`}>
                    <Sparkles size={13} />
                    <span>{riskLevel.toUpperCase()} RUNOFF RISK</span>
                  </span>
                  {runoffAnalysis && (
                    <span className={`unified-soil-pill is-${runoffAnalysis.soilSaturation}`}>
                      <CloudRain size={13} />
                      <span>Soil Saturation: {runoffAnalysis.soilSaturation}</span>
                    </span>
                  )}
                  <span className="unified-model-tag">
                    AI Correlated · Open-Meteo 7-Day Horizon
                  </span>
                </div>
              </div>

              <div className="unified-hero-body">
                <p className="unified-hero-summary">
                  {currentInterpretation?.overview || insights.summary}
                </p>
                {currentInterpretation?.hydroChemicalStatus && (
                  <p className="unified-hero-details">
                    {currentInterpretation.hydroChemicalStatus}
                  </p>
                )}
              </div>
            </section>

            {/* ── 2. Live Telemetry & Parameter Diagnostic Grid ── */}
            <section className="unified-section" aria-labelledby="telemetry-grid-title">
              <div className="unified-section-head">
                <div>
                  <h3 id="telemetry-grid-title">Live Parameter Diagnostics &amp; Trajectory</h3>
                  <p>Validated real-time readings, historical 7-day movement, and short-term projections</p>
                </div>
              </div>

              <div className="unified-param-grid">
                {insights.latest.map(({ parameter, reading, comparison }) => {
                  const Icon = PARAM_ICONS[parameter] || Droplets;
                  const isSafe = comparison?.state === "within";
                  const isAlert = comparison?.state === "exceeded" || comparison?.state === "outside";
                  const toneClass = isSafe ? "is-safe" : isAlert ? "is-alert" : "is-warn";

                  // Match trend details from 7-day calculations
                  const trendParam = insights.trend.parameterResults?.find((p) => p.parameter === parameter);
                  const deltaPercent = trendParam
                    ? trendParam.changePercentagePoints
                    : 0;
                  const trendDir = deltaPercent > 1 ? "rising" : deltaPercent < -1 ? "falling" : "stable";

                  // Match short-term estimate projection
                  const estimateRow = insights.prediction?.rows?.find((r) => r.parameter === parameter);

                  return (
                    <article key={parameter} className={`unified-param-card ${toneClass}`}>
                      <div className="unified-param-card-header">
                        <div className="unified-param-title">
                          <Icon size={17} className="unified-param-icon" />
                          <span>{parameter}</span>
                        </div>
                        <span className={`unified-param-badge ${toneClass}`}>
                          {comparison?.state === "within"
                            ? "Safe Band"
                            : comparison?.label
                              ? `${comparison.label} Band`
                              : "Unconfigured"}
                        </span>
                      </div>

                      <div className="unified-param-value-row">
                        <span className="unified-param-current">
                          {reading ? formatValue(reading.value) : "—"}
                        </span>
                        {reading?.parameters?.unit && (
                          <span className="unified-param-unit">{reading.parameters.unit}</span>
                        )}
                      </div>

                      <div className="unified-param-metrics">
                        <div className="unified-param-metric">
                          <span className="unified-metric-label">7-Day Trajectory</span>
                          <span className={`unified-metric-val is-${trendDir}`}>
                            {trendDir === "rising" && <TrendingUp size={13} />}
                            {trendDir === "falling" && <TrendingDown size={13} />}
                            {trendDir === "stable" && <Minus size={13} />}
                            <span>
                              {deltaPercent > 0 ? `+${deltaPercent.toFixed(0)}%` : `${deltaPercent.toFixed(0)}%`}{" "}
                              {trendDir}
                            </span>
                          </span>
                        </div>

                        {estimateRow && (
                          <div className="unified-param-metric">
                            <span className="unified-metric-label">30-min Estimate</span>
                            <span className="unified-metric-val">
                              {formatValue(estimateRow.value)} {estimateRow.unit || ""}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="unified-param-footer">
                        <span>
                          {reading ? `Updated ${formatDateTime(reading.recorded_at)}` : "Awaiting data"}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {/* ── 3. Open-Meteo Meteorological & Watershed Runoff Intelligence ── */}
            <section className="unified-section unified-weather-section" aria-labelledby="weather-intel-title">
              <div className="unified-section-head">
                <div>
                  <h3 id="weather-intel-title">Weather &amp; Watershed Runoff Intelligence</h3>
                  <p>Open-Meteo meteorological telemetry correlated with catchment hydrological response</p>
                </div>
              </div>

              <div className="unified-weather-container">
                <div className="unified-weather-stats-bar">
                  <div className="unified-w-stat">
                    <span className="unified-w-label">Past 7 Days Rain</span>
                    <strong className="unified-w-val">
                      {weatherSummary?.past7DaysRainMm != null ? `${weatherSummary.past7DaysRainMm} mm` : "—"}
                    </strong>
                    <span className="unified-w-hint">Cumulative watershed wash</span>
                  </div>

                  <div className="unified-w-stat">
                    <span className="unified-w-label">Past 3 Days Rain</span>
                    <strong className="unified-w-val">
                      {weatherSummary?.past3DaysRainMm != null ? `${weatherSummary.past3DaysRainMm} mm` : "—"}
                    </strong>
                    <span className="unified-w-hint">Recent soil soaking</span>
                  </div>

                  <div className="unified-w-stat">
                    <span className="unified-w-label">Next 48 Hours Rain</span>
                    <strong className="unified-w-val">
                      {weatherSummary?.next48hRainMm != null ? `${weatherSummary.next48hRainMm} mm` : "—"}
                    </strong>
                    <span className="unified-w-hint">
                      {weatherSummary?.next48hPrecipProbMax != null ? `${weatherSummary.next48hPrecipProbMax}% peak prob.` : "Short-term"}
                    </span>
                  </div>

                  <div className="unified-w-stat highlight">
                    <span className="unified-w-label">Next 7 Days Sustained Rain</span>
                    <strong className="unified-w-val">
                      {weatherSummary?.next7DaysRainMm != null ? `${weatherSummary.next7DaysRainMm} mm` : "—"}
                    </strong>
                    <span className="unified-w-hint">
                      {weatherSummary?.next7DaysPrecipProbMax != null ? `${weatherSummary.next7DaysPrecipProbMax}% weekly max prob.` : "Weekly forecast"}
                    </span>
                  </div>

                  <div className="unified-w-stat">
                    <span className="unified-w-label">Air Temperature</span>
                    <strong className="unified-w-val">
                      {weatherSummary?.currentTempC != null ? `${weatherSummary.currentTempC} °C` : "—"}
                    </strong>
                    <span className="unified-w-hint">
                      Tomorrow Max: {weatherSummary?.tomorrowTempMaxC != null ? `${weatherSummary.tomorrowTempMaxC} °C` : "—"}
                    </span>
                  </div>
                </div>

                {runoffAnalysis && (
                  <div className={`unified-runoff-card is-${runoffAnalysis.riskLevel}`}>
                    <div className="unified-runoff-header">
                      <div className="unified-runoff-title">
                        <AlertTriangle size={18} />
                        <strong>Weekly Sustained Rainfall &amp; Runoff Risk Analysis</strong>
                      </div>
                      <span className={`unified-runoff-badge is-${runoffAnalysis.riskLevel}`}>
                        {runoffAnalysis.riskLevel.toUpperCase()} RUNOFF RISK
                      </span>
                    </div>
                    <p className="unified-runoff-desc">
                      {runoffAnalysis.summary}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* ── 4. Dual-Horizon Analytical Interpretations (Current vs Long-Term) ── */}
            <section className="unified-section" aria-labelledby="dual-horizon-title">
              <div className="unified-section-head flex-between">
                <div>
                  <h3 id="dual-horizon-title">Dual-Horizon Predictive Analysis</h3>
                  <p>Immediate telemetry interpretations alongside long-term watershed impacts</p>
                </div>

                {/* Horizon Selector Filter */}
                <div className="unified-tab-buttons" role="tablist" aria-label="Analytical Horizon Filters">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeHorizonTab === "both"}
                    className={`unified-tab-btn ${activeHorizonTab === "both" ? "is-active" : ""}`}
                    onClick={() => setActiveHorizonTab("both")}
                  >
                    All Horizons
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeHorizonTab === "current"}
                    className={`unified-tab-btn ${activeHorizonTab === "current" ? "is-active" : ""}`}
                    onClick={() => setActiveHorizonTab("current")}
                  >
                    Current Diagnostic
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeHorizonTab === "longterm"}
                    className={`unified-tab-btn ${activeHorizonTab === "longterm" ? "is-active" : ""}`}
                    onClick={() => setActiveHorizonTab("longterm")}
                  >
                    Long-Term Impacts
                  </button>
                </div>
              </div>

              <div className="unified-horizon-grid">
                {/* ── Left Column: Current Data Interpretation ── */}
                {(activeHorizonTab === "both" || activeHorizonTab === "current") && (
                  <div className="unified-horizon-card">
                    <div className="unified-horizon-header">
                      <div className="unified-horizon-icon-box is-current">
                        <Compass size={20} />
                      </div>
                      <div>
                        <h4>Current Telemetry Interpretation</h4>
                        <span className="unified-horizon-sub">Immediate Hydro-Chemical Diagnostic</span>
                      </div>
                    </div>

                    <div className="unified-horizon-body">
                      <p className="unified-horizon-lead">
                        {currentInterpretation?.overview || "Telemetry readings reflect active baseline monitoring along the Dicklum River basin."}
                      </p>

                      <div className="unified-horizon-points">
                        <h5 className="unified-points-title">Key Diagnostic Observations:</h5>
                        <ul className="unified-point-list">
                          {currentInterpretation?.keyObservations?.map((obs, idx) => (
                            <li key={idx} className="unified-point-item">
                              <span className="point-bullet" />
                              <span>{obs}</span>
                            </li>
                          )) || (
                            <li className="unified-point-item">
                              <span className="point-bullet" />
                              <span>All parameters are exhibiting standard daytime fluctuation characteristics.</span>
                            </li>
                          )}
                        </ul>
                      </div>

                      {insights.trend?.detail && (
                        <div className="unified-trend-note">
                          <strong>7-Day Historical Movement:</strong> {insights.trend.detail}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Right Column: Long-Term Predictive Impacts (Weeks & Months) ── */}
                {(activeHorizonTab === "both" || activeHorizonTab === "longterm") && (
                  <div className="unified-horizon-card">
                    <div className="unified-horizon-header">
                      <div className="unified-horizon-icon-box is-future">
                        <Calendar size={20} />
                      </div>
                      <div>
                        <h4>Long-Term Predictive Impacts</h4>
                        <span className="unified-horizon-sub">Weeks &amp; Months Environmental Forecast</span>
                      </div>
                    </div>

                    <div className="unified-horizon-body">
                      {/* 1–4 Weeks Horizon */}
                      <div className="unified-sub-horizon">
                        <div className="unified-sub-badge">
                          <Layers size={13} />
                          <span>1–4 WEEKS HORIZON (RUNOFF &amp; SEDIMENTATION)</span>
                        </div>
                        <ul className="unified-point-list">
                          {longTermPredictiveImpacts?.weeksHorizon?.impacts?.map((item, idx) => (
                            <li key={idx} className="unified-point-item">
                              <span className="point-bullet is-warning" />
                              <span>{item}</span>
                            </li>
                          )) || (
                            <li className="unified-point-item">
                              <span className="point-bullet is-warning" />
                              <span>Sustained weekly rainfall will drive cumulative sediment transport into river bends.</span>
                            </li>
                          )}
                        </ul>
                      </div>

                      {/* 1–3 Months Horizon */}
                      <div className="unified-sub-horizon mt-4">
                        <div className="unified-sub-badge is-secondary">
                          <Calendar size={13} />
                          <span>1–3 MONTHS HORIZON (SEASONAL &amp; ECOSYSTEM DYNAMICS)</span>
                        </div>
                        <ul className="unified-point-list">
                          {longTermPredictiveImpacts?.monthsHorizon?.impacts?.map((item, idx) => (
                            <li key={idx} className="unified-point-item">
                              <span className="point-bullet is-accent" />
                              <span>{item}</span>
                            </li>
                          )) || (
                            <li className="unified-point-item">
                              <span className="point-bullet is-accent" />
                              <span>Seasonal precipitation regimes will transition river baseflow between wet flushing and dry concentration.</span>
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── 5. Actionable Recommendations (Immediate vs Strategic) ── */}
            <section className="unified-section" aria-labelledby="recommendations-title">
              <div className="unified-section-head">
                <div>
                  <h3 id="recommendations-title">Strategic &amp; Operational Directives</h3>
                  <p>Prescribed interventions for treatment management and watershed resilience</p>
                </div>
              </div>

              <div className="unified-rec-grid">
                {/* Immediate Protocols */}
                <div className="unified-rec-column">
                  <div className="unified-rec-column-header">
                    <span className="unified-rec-chip is-immediate">Immediate Actions</span>
                    <span className="unified-rec-timing">Next 24–48 Hours</span>
                  </div>
                  <ul className="unified-rec-list">
                    {(recommendations?.immediate || []).map((rec, idx) => (
                      <li key={idx} className="unified-rec-item">
                        <ArrowRight size={14} className="unified-rec-arrow is-immediate" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Long-Term Watershed Protocols */}
                <div className="unified-rec-column">
                  <div className="unified-rec-column-header">
                    <span className="unified-rec-chip is-strategic">Watershed Management</span>
                    <span className="unified-rec-timing">Weeks to Months</span>
                  </div>
                  <ul className="unified-rec-list">
                    {(recommendations?.strategic || []).map((rec, idx) => (
                      <li key={idx} className="unified-rec-item">
                        <ArrowRight size={14} className="unified-rec-arrow is-strategic" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default Insights;