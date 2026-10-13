import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, CloudRain } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { buildInsights } from "../../lib/insights";
import { fetchWeatherInsights } from "../../lib/weather";
import WeatherWidget from "../../components/WeatherWidget";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/Insights.css";

const HISTORY_DAYS = 7;
const REFRESH_MS = 30 * 60 * 1000;
const formatDateTime = (value) => value ? new Date(value).toLocaleString() : "—";
const formatValue = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

const bandLabel = (comparison) => {
  if (!comparison) return "Threshold unavailable";
  if (comparison.state === "within") return "Within safe band";
  if (comparison.state === "exceeded") return `${comparison.label} band`;
  if (comparison.state === "outside") return "Outside configured bands";
  if (comparison.state === "unknown") return `Unrecognized band: ${comparison.label}`;
  return "Threshold unavailable";
};

const estimateBandLabel = (comparison) => {
  if (comparison.state === "within") return "Estimated in safe band";
  if (comparison.state === "exceeded") return `Estimated ${comparison.label} band`;
  if (comparison.state === "outside") return "Estimated outside configured bands";
  return `Estimated band unavailable: ${comparison.label}`;
};

const bandTone = (state) => {
  if (state === "within") return "ok";
  if (state === "exceeded" || state === "outside") return "alert";
  return "warn";
};

const trendTone = (label) => {
  if (label === "Improving") return "ok";
  if (label === "Worsening") return "alert";
  return "neutral";
};

const TONE_GLYPH = { ok: "✓", alert: "!", warn: "?" };

const StatusMark = ({ tone }) => (
  <span className={`insights-mark is-${tone}`} aria-hidden="true">{TONE_GLYPH[tone]}</span>
);

// The nodes table has no "location" column, so the node label stands in for it.
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

  const loadWeatherInsights = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherError("");
    try {
      const data = await fetchWeatherInsights();
      setWeather(data);
    } catch (e) {
      setWeatherError(e.message || "Could not load weather insights.");
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  const loadInsightsData = useCallback(async () => {
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

      if (readingResult.error || thresholdResult.error) {
        throw readingResult.error || thresholdResult.error;
      }
      setReadings((readingResult.data || []).map(withNodeLocation));
      setThresholds(thresholdResult.data || []);
      setUpdatedAt(new Date().toISOString());
    } catch (fetchError) {
      setError(fetchError.message || "Could not load sensor readings and configured thresholds.");
      setReadings([]);
      setThresholds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInsightsData();
    loadWeatherInsights();
    const interval = setInterval(() => { loadInsightsData(); loadWeatherInsights(); }, REFRESH_MS);
    const channel = supabase
      .channel("manager-insights-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sensor_readings" }, () => loadInsightsData())
      .on("postgres_changes", { event: "*", schema: "public", table: "thresholds" }, () => loadInsightsData())
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [loadInsightsData, loadWeatherInsights]);

  const insights = useMemo(() => buildInsights(readings, thresholds), [readings, thresholds]);
  const conditionState = insights.status === "Insufficient Data for Analysis"
    ? "insufficient"
    : insights.status === "Within configured thresholds"
      ? "within"
      : "exceedance";
  const conditionTone = conditionState === "within" ? "ok" : conditionState === "exceedance" ? "alert" : "warn";

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <main className="admin-main manager-main insights-page">
        <header className="page-header page-header-with-actions">
          <div>
            <h1>Insights</h1>
            <p>Station review · latest readings and seven-day changes</p>
          </div>
          <WeatherWidget />
          <div className="insights-refreshed">
            <span className="insights-refreshed-label">Data refreshed</span>
            <time className="insights-refreshed-time">{formatDateTime(updatedAt)}</time>
            <button type="button" className="insights-button" onClick={() => { loadInsightsData(); loadWeatherInsights(); }}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>Refresh all</span>
            </button>
          </div>
        </header>

        {/* ── AI Predictions (top of tab) ── */}
        <section className="insights-panel" aria-labelledby="ai-predictions-title">
          <div className="insights-section-head">
            <div>
              <h2 id="ai-predictions-title">AI Predictions</h2>
              <p>Weather-correlated 48-hour water quality risk forecast</p>
            </div>
            <button
              type="button"
              className="insights-button"
              onClick={loadWeatherInsights}
              disabled={weatherLoading}
              style={{ marginLeft: "auto", alignSelf: "flex-start" }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>

          {weatherLoading && !weather && (
            <p className="insights-note">
              <span className="spinner spinner-dark" role="status" aria-label="Loading AI predictions" />
              {" "}Analysing weather and telemetry…
            </p>
          )}

          {weatherError && !weatherLoading && (
            <p className="insights-note" style={{ color: "var(--color-alert, #c0392b)" }}>{weatherError}</p>
          )}

          {weather && (() => {
            const ai = weather.aiInsights;
            const riskColor = ai.riskLevel === "high" ? "var(--color-alert, #c0392b)"
              : ai.riskLevel === "moderate" ? "var(--color-warn, #e67e22)"
              : "var(--color-ok, #27ae60)";
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "0.75rem 0 1rem" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "4px 14px",
                      borderRadius: "999px",
                      background: `${riskColor}18`,
                      border: `1.5px solid ${riskColor}`,
                      color: riskColor,
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      textTransform: "capitalize",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {ai.riskLevel} risk
                  </span>
                  <span className="insights-note" style={{ margin: 0 }}>
                    48-hour horizon · {ai.model}
                    {weather.generatedAt && (
                      <> · generated {new Date(weather.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
                    )}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <p className="insights-eyebrow" style={{ marginBottom: "0.35rem" }}>Risks detected</p>
                    <ul className="insights-trend-list">
                      {ai.risks.map((r, i) => <li key={i} className="insights-trend-item">{r}</li>)}
                    </ul>
                  </div>
                  <div>
                    <p className="insights-eyebrow" style={{ marginBottom: "0.35rem" }}>Recommendations</p>
                    <ul className="insights-trend-list">
                      {ai.recommendations.map((r, i) => <li key={i} className="insights-trend-item">{r}</li>)}
                    </ul>
                  </div>
                </div>
              </>
            );
          })()}

          {!weather && !weatherLoading && !weatherError && (
            <p className="insights-note">No forecast data yet — click Refresh to load.</p>
          )}
        </section>

        {/* ── Telemetry sections (condition, measurements, trend, estimate) ── */}
        {loading ? (
          <section className="insights-loading" aria-live="polite">
            <span className="spinner spinner-dark" role="status" aria-label="Loading insights" />
            <p>Loading recent sensor readings and configured thresholds…</p>
          </section>
        ) : error ? (
          <section className="insights-empty" aria-live="polite">
            <h2>No analysis available</h2>
            <p>The latest sensor readings or configured thresholds could not be read. Try again to rebuild the station review.</p>
            <p>{error}</p>
            <button type="button" className="insights-button" onClick={() => loadInsightsData()}>Try again</button>
          </section>
        ) : (
          <>
            <section className={`insights-condition is-${conditionState}`} aria-live="polite">
              <StatusMark tone={conditionTone} />
              <div className="insights-condition-body">
                <p className="insights-eyebrow">Overall water condition</p>
                <h2 className="insights-condition-status">{insights.status}</h2>
                <p className="insights-condition-summary">{insights.summary}</p>
                {insights.latestUsedAt && (
                  <p className="insights-condition-time">Latest valid measurement set: {formatDateTime(insights.latestUsedAt)}</p>
                )}
              </div>
            </section>

            <section className="insights-measurements" aria-labelledby="insights-measurements-title">
              <div className="insights-section-head">
                <h2 id="insights-measurements-title">Latest measurements</h2>
                <p>Most recent validated value for each monitored parameter.</p>
              </div>
              <ul className="insights-tiles">
                {insights.latest.map(({ parameter, reading, comparison }) => {
                  const tone = reading ? bandTone(comparison?.state) : "warn";
                  return (
                    <li className="insights-tile" key={parameter}>
                      <p className="insights-tile-name">{parameter}</p>
                      <p className={`insights-tile-value${reading ? "" : " is-empty"}`}>
                        {reading ? formatValue(reading.value) : "—"}
                        {reading?.parameters?.unit ? <span className="insights-unit">{reading.parameters.unit}</span> : null}
                      </p>
                      <p className={`insights-band is-${tone}`}>
                        <StatusMark tone={tone} />
                        <span>{reading ? bandLabel(comparison) : "No valid current reading"}</span>
                      </p>
                      <p className="insights-tile-time">
                        {reading ? <time>{formatDateTime(reading.recorded_at)}</time> : "No recorded time"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="insights-body">
              <div className="insights-primary">
                <section className="insights-panel insights-estimate">
                  <div className="insights-section-head">
                    <h2>Short-term estimate</h2>
                    <p className="insights-estimate-status">{insights.prediction.available ? "30-minute estimates" : "Prediction unavailable"}</p>
                  </div>
                  <p className="insights-note insights-note-lead">{insights.prediction.message}</p>
                  {insights.prediction.available && (
                    <>
                      <ul className="insights-estimate-list">
                        {insights.prediction.rows.map((item) => (
                          <li className="insights-estimate-item" key={item.parameter}>
                            <span className="insights-estimate-name">{item.parameter}</span>
                            <span className="insights-estimate-value">
                              {formatValue(item.value)}
                              {item.unit ? <span className="insights-unit">{item.unit}</span> : null}
                            </span>
                            <span className="insights-estimate-meta">
                              <span className={`insights-band is-${bandTone(item.comparison.state)}`}>
                                <StatusMark tone={bandTone(item.comparison.state)} />
                                <span>{estimateBandLabel(item.comparison)}</span>
                              </span>
                              <span className="insights-estimate-caption">
                                for {formatDateTime(item.forecastAt)} · backtest MAE {formatValue(item.meanAbsoluteError)} {item.unit}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="insights-note">{insights.prediction.validationMethod}</p>
                    </>
                  )}
                </section>
              </div>

              <aside className="insights-aside">
                <section className="insights-panel insights-trend">
                  <div className="insights-section-head">
                    <h2>Overall trend</h2>
                  </div>
                  <p className={`insights-trend-label is-${trendTone(insights.trend.label)}`}>{insights.trend.label}</p>
                  {insights.trend.period && <p className="insights-trend-period">{insights.trend.period}</p>}
                  <p className="insights-note insights-note-lead">{insights.trend.detail}</p>
                  {insights.trend.parameterResults?.length > 0 && (
                    <ul className="insights-trend-list">
                      {insights.trend.parameterResults.map((item) => (
                        <li className="insights-trend-item" key={item.parameter}>
                          <span className="insights-trend-name">{item.parameter}</span>
                          <span className={`insights-trend-delta ${item.changePercentagePoints < 0 ? "better" : item.changePercentagePoints > 0 ? "worse" : "flat"}`}>
                            {item.changePercentagePoints > 0 ? "+" : ""}{item.changePercentagePoints.toFixed(0)} pp
                          </span>
                          <span className="insights-trend-detail">
                            Outside safe band: {(item.earlyRate * 100).toFixed(0)}% ({item.earlyOutside}/{item.earlyCount}) → {(item.recentRate * 100).toFixed(0)}% ({item.recentOutside}/{item.recentCount})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </aside>
            </div>

            {/* ── Weather detail (supporting context, below main panels) ── */}
            {weather?.weatherSummary && (
              <section className="insights-panel" style={{ marginTop: "1rem" }} aria-labelledby="weather-detail-title">
                <div className="insights-section-head">
                  <h2 id="weather-detail-title">Weather context</h2>
                  <p>Open-Meteo forecast · {weather.location?.name}</p>
                </div>
                <dl className="insights-note" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem 1.25rem", marginTop: "0.5rem" }}>
                  <dt style={{ fontWeight: 600 }}>Past 3-day rain</dt>
                  <dd>{weather.weatherSummary.past3DaysRainMm?.toFixed(1)} mm</dd>
                  <dt style={{ fontWeight: 600 }}>Today rain</dt>
                  <dd>{weather.weatherSummary.todayRainMm?.toFixed(1)} mm</dd>
                  <dt style={{ fontWeight: 600 }}>Next 48 h rain</dt>
                  <dd>{weather.weatherSummary.next48hRainMm?.toFixed(1)} mm</dd>
                  <dt style={{ fontWeight: 600 }}>48 h precip chance</dt>
                  <dd>{weather.weatherSummary.next48hPrecipProbMax}%</dd>
                  {weather.weatherSummary.tomorrowTempMaxC != null && (
                    <>
                      <dt style={{ fontWeight: 600 }}>Tomorrow max temp</dt>
                      <dd>{weather.weatherSummary.tomorrowTempMaxC} °C</dd>
                    </>
                  )}
                </dl>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Insights;
