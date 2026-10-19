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
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Clock,
  User,
  Wrench,
  Calendar,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { useSilentRefresh } from "../../hooks/useSilentRefresh";
import { buildInsights } from "../../lib/insights";
import { fetchWeatherInsights } from "../../lib/weather";
import WeatherWidget from "../../components/WeatherWidget";
import ManagerSidebar from "./ManagerSidebar";
import { PageTransition, SkeletonCard, LiveValue } from "../../components/ui";
import Skeleton from "react-loading-skeleton";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
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

// Risk color scale
const RISK_COLORS = {
  low: "#27ae60",
  moderate: "#e67e22",
  high: "#c0392b",
  severe: "#8b0000",
};

const OWNER_ICONS = {
  Manager: User,
  "DENR-CENRO": ShieldCheck,
  Maintenance: Wrench,
};

const PRIORITY_ORDER = { High: 0, Med: 1, Low: 2 };

// Toggle component for collapsible details
const DetailsToggle = ({ children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="details-toggle">
      <button
        type="button"
        className="details-toggle-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        <span>{isOpen ? "Hide details" : "Show details"}</span>
      </button>
      {isOpen && <div className="details-toggle-content">{children}</div>}
    </div>
  );
};

// Sparkline component for summary tiles
const Sparkline = ({ data, color, height = 40 }) => {
  if (!data || data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

// Rainfall bar chart
const RainfallChart = ({ data, height = 100 }) => {
  if (!data || data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        <XAxis dataKey="label" hide />
        <YAxis hide />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              return (
                <div className="chart-tooltip">
                  <span>{payload[0].payload.label}: {payload[0].value} mm</span>
                </div>
              );
            }
            return null;
          }}
        />
        <Bar dataKey="value" fill="#3498db" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.value > 10 ? "#e74c3c" : "#3498db"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// Segmented risk meter
const RiskMeter = ({ riskLevel }) => {
  const segments = [
    { level: "low", label: "Low" },
    { level: "moderate", label: "Mod" },
    { level: "high", label: "High" },
  ];
  const currentIndex = segments.findIndex((s) => s.level === riskLevel);

  return (
    <div className="risk-meter">
      {segments.map((segment, index) => (
        <div
          key={segment.level}
          className={`risk-meter-segment ${index <= currentIndex ? "active" : ""}`}
          style={{
            backgroundColor: index <= currentIndex ? RISK_COLORS[segment.level] : "#e0e0e0",
          }}
          title={segment.label}
        />
      ))}
    </div>
  );
};

// Direction arrow
const DirectionArrow = ({ direction }) => {
  if (direction === "rising") return <TrendingUp size={16} className="trend-up" />;
  if (direction === "falling") return <TrendingDown size={16} className="trend-down" />;
  return <Minus size={16} className="trend-stable" />;
};

// Confidence dots
const ConfidenceDots = ({ confidence }) => {
  const levels = { Low: 1, Medium: 2, High: 3 };
  const count = levels[confidence] || 2;
  return (
    <div className="confidence-dots">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`confidence-dot ${i <= count ? "active" : ""}`}
          title={confidence}
        />
      ))}
    </div>
  );
};

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
      // Only on initial load or explicit refresh, not on every realtime update
      if (isInitial) {
        loadWeatherInsights(loadedReadings);
      }
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
  }, []);

  useEffect(() => {
    loadInsightsData();
  }, []);

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
  const next24h = unifiedAnalysis?.next24h;
  const next3to7Days = unifiedAnalysis?.next3to7Days;
  const recommendations = unifiedAnalysis?.recommendations;

  // Get parameter trends for sparklines
  const getParamTrend = (paramName) => {
    const paramReadings = readings.filter(r => r.parameters?.name === paramName).slice(0, 50).reverse();
    return paramReadings.map(r => ({ value: Number(r.value), time: r.recorded_at }));
  };

  const turbidityTrend = getParamTrend("Turbidity");
  const tdsTrend = getParamTrend("TDS");
  const turbidityCurrent = turbidityTrend[turbidityTrend.length - 1]?.value ?? null;
  const tdsCurrent = tdsTrend[tdsTrend.length - 1]?.value ?? null;

  // Generate rainfall chart data
  const generateRainfallData = (weatherData, hours = 24) => {
    if (!weatherData?.daily) return [];
    const daily = weatherData.daily;
    const times = daily.time || [];
    const rain = daily.rain_sum || daily.precipitation_sum || [];
    const today = new Date().toISOString().slice(0, 10);
    const todayIdx = Math.max(0, times.findIndex((d) => d >= today));

    const data = [];
    const count = hours === 24 ? 1 : 7;
    for (let i = 0; i < count; i++) {
      const idx = todayIdx + i;
      if (idx < rain.length) {
        const date = new Date(times[idx]);
        const label = hours === 24 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short" });
        data.push({ label, value: rain[idx] || 0 });
      }
    }
    return data;
  };

  const rainfall24h = generateRainfallData(weather, 24);
  const rainfall7d = generateRainfallData(weather, 168);

  // Generate sparkline data for summary tiles
  const summarySparklines = {
    turbidity: turbidityTrend,
    tds: tdsTrend,
  };

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

  // Truncate text defensively
  const truncate = (text, maxWords) => {
    if (!text) return "";
    const words = text.split(" ");
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ") + "...";
  };

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <PageTransition className="admin-main manager-main insights-page">
        {/* Page Header */}
        <header className="page-header page-header-with-actions">
          <div>
            <h1>Watershed Insights</h1>
            <p>Quick-read predictive analysis for water quality decisions</p>
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
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {/* Global Loading / Error State */}
        {loading && !updatedAt ? (
          <section className="unified-analysis-panel" aria-live="polite" aria-busy="true">
            <div className="summary-strip">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="summary-tile">
                  <Skeleton height={80} />
                </div>
              ))}
            </div>
            <div className="horizon-cards">
              <div className="horizon-card">
                <Skeleton height={200} />
              </div>
              <div className="horizon-card">
                <Skeleton height={200} />
              </div>
            </div>
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
          <>
            {/* Top Summary Strip */}
            <section className="summary-strip" aria-label="Quick summary">
              <div className="summary-tile">
                <div className="summary-tile-label">Overall Risk</div>
                <div className="summary-tile-value" style={{ color: RISK_COLORS[riskLevel] }}>
                  {riskLevel.toUpperCase()}
                </div>
                {summarySparklines.turbidity && summarySparklines.turbidity.length > 1 && (
                  <Sparkline data={summarySparklines.turbidity} color={RISK_COLORS[riskLevel]} height={30} />
                )}
              </div>

              <div className="summary-tile">
                <div className="summary-tile-label">Rainfall (7d)</div>
                <div className="summary-tile-value">
                  {weatherSummary?.next7DaysRainMm != null
                    ? `${weatherSummary.next7DaysRainMm.toFixed(0)} mm`
                    : "—"}
                </div>
                {rainfall7d.length > 0 && (
                  <Sparkline data={rainfall7d} color="#3498db" height={30} />
                )}
              </div>

              <div className="summary-tile">
                <div className="summary-tile-label">Turbidity</div>
                <div className="summary-tile-value">
                  {turbidityCurrent != null ? `${turbidityCurrent.toFixed(1)} NTU` : "—"}
                  <span className="summary-tile-sub">/ 5 Class C</span>
                </div>
                {next24h && (
                  <div className="summary-tile-trend">
                    <DirectionArrow direction={next24h.turbidityDirection} />
                    <span>{next24h.turbidityDirection}</span>
                  </div>
                )}
              </div>

              <div className="summary-tile">
                <div className="summary-tile-label">TDS</div>
                <div className="summary-tile-value">
                  {tdsCurrent != null ? `${tdsCurrent.toFixed(0)} ppm` : "—"}
                </div>
                {next24h && (
                  <div className="summary-tile-trend">
                    <DirectionArrow direction={next24h.tdsDirection} />
                    <span>{next24h.tdsDirection}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Dual-Horizon Predictive Analysis */}
            <section className="horizon-section" aria-label="Predictive analysis">
              <h2 className="section-title">Predictive Analysis</h2>
              <div className="horizon-cards">
                {/* Next 24 Hours Card */}
                {next24h && (
                  <div className={`horizon-card horizon-${next24h.riskLevel}`}>
                    <div className="horizon-card-header">
                      <h3>Next 24 hours</h3>
                      <span className={`risk-badge risk-${next24h.riskLevel}`}>
                        {next24h.riskLevel.toUpperCase()}
                      </span>
                    </div>
                    <RiskMeter riskLevel={next24h.riskLevel} />
                    <p className="horizon-headline">{truncate(next24h.headline, 12)}</p>
                    <div className="horizon-params">
                      <div className="horizon-param">
                        <Waves size={14} />
                        <span>Turbidity: </span>
                        <DirectionArrow direction={next24h.turbidityDirection} />
                        <span>{next24h.turbidityValue != null ? `${next24h.turbidityValue.toFixed(1)} NTU` : "—"}</span>
                      </div>
                      <div className="horizon-param">
                        <Gauge size={14} />
                        <span>TDS: </span>
                        <DirectionArrow direction={next24h.tdsDirection} />
                        <span>{next24h.tdsValue != null ? `${next24h.tdsValue.toFixed(0)} ppm` : "—"}</span>
                      </div>
                    </div>
                    {rainfall24h.length > 0 && (
                      <div className="horizon-chart">
                        <RainfallChart data={rainfall24h} height={80} />
                      </div>
                    )}
                    <div className="horizon-footer">
                      <div className="horizon-confidence">
                        <ConfidenceDots confidence={next24h.confidence} />
                        <span>{next24h.confidence}</span>
                      </div>
                      <div className="horizon-driver">
                        <CloudRain size={14} />
                        <span>{truncate(next24h.mainDriver, 8)}</span>
                      </div>
                    </div>
                    <DetailsToggle>
                      <p className="horizon-details">{next24h.details}</p>
                    </DetailsToggle>
                  </div>
                )}

                {/* Next 3-7 Days Card */}
                {next3to7Days && (
                  <div className={`horizon-card horizon-${next3to7Days.riskLevel}`}>
                    <div className="horizon-card-header">
                      <h3>Next 3-7 days</h3>
                      <span className={`risk-badge risk-${next3to7Days.riskLevel}`}>
                        {next3to7Days.riskLevel.toUpperCase()}
                      </span>
                    </div>
                    <RiskMeter riskLevel={next3to7Days.riskLevel} />
                    <p className="horizon-headline">{truncate(next3to7Days.headline, 12)}</p>
                    <div className="horizon-params">
                      <div className="horizon-param">
                        <Waves size={14} />
                        <span>Turbidity: </span>
                        <DirectionArrow direction={next3to7Days.turbidityDirection} />
                        <span>{next3to7Days.turbidityValue != null ? `${next3to7Days.turbidityValue.toFixed(1)} NTU` : "—"}</span>
                      </div>
                      <div className="horizon-param">
                        <Gauge size={14} />
                        <span>TDS: </span>
                        <DirectionArrow direction={next3to7Days.tdsDirection} />
                        <span>{next3to7Days.tdsValue != null ? `${next3to7Days.tdsValue.toFixed(0)} ppm` : "—"}</span>
                      </div>
                    </div>
                    {rainfall7d.length > 0 && (
                      <div className="horizon-chart">
                        <RainfallChart data={rainfall7d} height={80} />
                      </div>
                    )}
                    <div className="horizon-footer">
                      <div className="horizon-confidence">
                        <ConfidenceDots confidence={next3to7Days.confidence} />
                        <span>{next3to7Days.confidence}</span>
                      </div>
                      <div className="horizon-driver">
                        <CloudRain size={14} />
                        <span>{truncate(next3to7Days.mainDriver, 8)}</span>
                      </div>
                    </div>
                    <DetailsToggle>
                      <p className="horizon-details">{next3to7Days.details}</p>
                    </DetailsToggle>
                  </div>
                )}
              </div>
            </section>

            {/* Strategic & Operational Directives */}
            <section className="actions-section" aria-label="Action directives">
              <h2 className="section-title">Action Directives</h2>

              {riskLevel === "low" && (!recommendations?.immediate || recommendations.immediate.length === 0) ? (
                <div className="actions-no-action">
                  <CheckCircle size={24} className="no-action-icon" />
                  <p>No action needed. Continue routine monitoring.</p>
                </div>
              ) : (
                <>
                  {/* Do Now (Next 24h) */}
                  {recommendations?.immediate && recommendations.immediate.length > 0 && (
                    <div className="actions-group">
                      <h3 className="actions-group-title">
                        <Clock size={16} />
                        Do now (next 24h)
                      </h3>
                      <div className="actions-list">
                        {recommendations.immediate
                          .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
                          .slice(0, 3)
                          .map((action, idx) => {
                            const OwnerIcon = OWNER_ICONS[action.owner] || User;
                            return (
                              <div key={idx} className="action-item">
                                <div className="action-item-main">
                                  <span className="action-text">{truncate(action.text, 12)}</span>
                                  <span className={`action-priority priority-${action.priority.toLowerCase()}`}>
                                    {action.priority}
                                  </span>
                                  <span className="action-owner">
                                    <OwnerIcon size={14} />
                                    {action.owner}
                                  </span>
                                </div>
                                <DetailsToggle>
                                  <p className="action-details">{action.details}</p>
                                </DetailsToggle>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Plan This Week */}
                  {recommendations?.strategic && recommendations.strategic.length > 0 && (
                    <div className="actions-group">
                      <h3 className="actions-group-title">
                        <Calendar size={16} />
                        Plan this week
                      </h3>
                      <div className="actions-list">
                        {recommendations.strategic
                          .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
                          .slice(0, 3)
                          .map((action, idx) => {
                            const OwnerIcon = OWNER_ICONS[action.owner] || User;
                            return (
                              <div key={idx} className="action-item">
                                <div className="action-item-main">
                                  <span className="action-text">{truncate(action.text, 12)}</span>
                                  <span className={`action-priority priority-${action.priority.toLowerCase()}`}>
                                    {action.priority}
                                  </span>
                                  <span className="action-owner">
                                    <OwnerIcon size={14} />
                                    {action.owner}
                                  </span>
                                </div>
                                <DetailsToggle>
                                  <p className="action-details">{action.details}</p>
                                </DetailsToggle>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </PageTransition>
    </div>
  );
};

export default Insights;
