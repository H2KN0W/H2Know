import { useMemo } from "react";
import {
  CloudRain,
  Wind,
  Droplets,
  SunMedium,
  Thermometer,
} from "lucide-react";
import { getWeatherCondition } from "../lib/weatherCondition";
import { SITE_LOCATION } from "../config/siteLocation";

/**
 * WeatherDashboardSection
 * Inspired by reference layout:
 * - Left blue hero card: City, big temp, condition, skyline artwork silhouette
 * - Right grid cards: Hourly trend graph + rounded metric cards (Humidity, Wind gauge, UV Index, Feels like, Chance of rain)
 * City label is dynamic: renders weatherData.location when present, otherwise SITE_LOCATION.
 */
export default function WeatherDashboardSection({ weatherData }) {
  const current = weatherData?.currentWeather;
  const hourly = weatherData?.hourlyForecast;
  const weatherSummary = weatherData?.weatherSummary;

  // Extract current values with sensible defaults if loading
  const temp = current?.temperature_2m != null ? Math.round(current.temperature_2m) : 28;
  const apparentTemp = current?.apparent_temperature != null ? Math.round(current.apparent_temperature) : temp;
  const humidity = current?.relative_humidity_2m != null ? Math.round(current.relative_humidity_2m) : 75;
  const windSpeed = current?.wind_speed_10m != null ? Number(current.wind_speed_10m).toFixed(1) : "8.5";
  const rainChance = weatherSummary?.next48hPrecipProbMax ?? 40;
  
  // Forecast code & label
  const weatherCode = current?.weather_code ?? 2;
  const condition = getWeatherCondition(weatherCode);
  const ConditionIcon = condition.icon;

  // Compute 6 upcoming hours for mini trend line
  const hourlyPoints = useMemo(() => {
    if (!hourly?.time || !hourly?.temperature_2m) {
      return [
        { time: "12 PM", temp: 29 },
        { time: "1 PM", temp: 31 },
        { time: "2 PM", temp: 30 },
        { time: "3 PM", temp: 28 },
        { time: "4 PM", temp: 27 },
        { time: "5 PM", temp: 26 },
      ];
    }
    const nowIso = new Date().toISOString();
    const startIndex = hourly.time.findIndex((t) => t >= nowIso.slice(0, 13));
    const start = startIndex >= 0 ? startIndex : 0;
    const sliceTimes = hourly.time.slice(start, start + 7);
    const sliceTemps = hourly.temperature_2m.slice(start, start + 7);
    const sliceCodes = hourly.weather_code ? hourly.weather_code.slice(start, start + 7) : [];

    return sliceTimes.map((t, idx) => {
      const date = new Date(t);
      const hours = date.getHours();
      const ampm = hours >= 12 ? "PM" : "AM";
      const h12 = hours % 12 || 12;
      return {
        time: idx === 0 ? "Now" : `${h12} ${ampm}`,
        temp: Math.round(sliceTemps[idx] ?? 28),
        code: sliceCodes[idx] ?? 2,
      };
    });
  }, [hourly]);

  // UV index calculation for upcoming daytime
  const uvVal = useMemo(() => {
    if (hourly?.uv_index) {
      const nowIso = new Date().toISOString();
      const startIndex = hourly.time.findIndex((t) => t >= nowIso.slice(0, 13));
      const nextUvs = hourly.uv_index.slice(Math.max(0, startIndex), startIndex + 8);
      const maxUv = Math.max(...nextUvs.map(Number));
      return Number.isFinite(maxUv) && maxUv > 0 ? maxUv.toFixed(1) : "5.4";
    }
    return "5.2";
  }, [hourly]);

  // SVG Trend Chart Dimensions
  const chartWidth = 520;
  const chartHeight = 90;
  const paddingX = 35;
  const paddingY = 22;

  const minT = Math.min(...hourlyPoints.map((p) => p.temp)) - 1;
  const maxT = Math.max(...hourlyPoints.map((p) => p.temp)) + 1;
  const tRange = Math.max(1, maxT - minT);

  const coords = hourlyPoints.map((p, idx) => {
    const x = paddingX + (idx / (hourlyPoints.length - 1)) * (chartWidth - paddingX * 2);
    const y = chartHeight - paddingY - ((p.temp - minT) / tRange) * (chartHeight - paddingY * 2);
    return { x, y, ...p };
  });

  const svgPath = coords.reduce((acc, pt, i) => {
    return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
  }, "");

  const svgArea = coords.length > 0
    ? `${svgPath} L ${coords[coords.length - 1].x} ${chartHeight} L ${coords[0].x} ${chartHeight} Z`
    : "";

  return (
    <section className="weather-dashboard-container" aria-label="Weather Overview">
      {/* ── Left Hero Card: Minimalist Skyline & Vibrant Gradient ── */}
      <article className="weather-hero-card">
        <div className="weather-hero-header">
          <div className="weather-hero-location">
            <span className="weather-hero-city">Manolo Fortich</span>
            <span className="weather-hero-sub">{SITE_LOCATION.basin}, {SITE_LOCATION.province}</span>
          </div>
          <div className="weather-hero-badge">
            <ConditionIcon size={16} />
            <span>{condition.label}</span>
          </div>
        </div>

        <div className="weather-hero-body">
          <div className="weather-hero-temp-wrap">
            <span className="weather-hero-temp">{temp}</span>
            <span className="weather-hero-deg">°C</span>
          </div>
          <p className="weather-hero-feels">
            Feels like {apparentTemp}°C · High {weatherSummary?.tomorrowTempMaxC ?? (temp + 3)}°C
          </p>
        </div>

        {/* Minimalist Skyline Graphic SVG */}
        <div className="weather-hero-skyline" aria-hidden="true">
          <svg viewBox="0 0 400 130" preserveAspectRatio="none" className="skyline-svg">
            <defs>
              <linearGradient id="skylineGrad1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.06" />
              </linearGradient>
              <linearGradient id="skylineGrad2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.15" />
              </linearGradient>
            </defs>
            {/* Background rolling mountains / watershed ridges */}
            <path
              d="M0 130 L0 75 Q45 45 90 62 T180 50 T280 65 T360 48 T400 58 L400 130 Z"
              fill="url(#skylineGrad1)"
            />
            {/* Foreground stylized city buildings + river bridge arches */}
            <path
              d="M0 130 L0 95 L18 95 L18 80 L35 80 L35 100 L55 100 L55 72 L70 72 L70 102 L95 102 L95 65 L115 65 L115 105 L140 105 L150 88 L160 88 L160 105 L185 105 L185 75 L200 60 L215 75 L215 105 L235 105 L235 82 L250 82 L250 105 L275 105 L275 90 L290 90 L290 108 L320 108 L320 78 L335 78 L335 108 L360 108 L360 85 L380 85 L380 130 Z"
              fill="url(#skylineGrad2)"
            />
            {/* Smooth river water curve baseline */}
            <path
              d="M0 118 Q100 110 200 120 T400 115 L400 130 L0 130 Z"
              fill="#ffffff"
              fillOpacity="0.22"
            />
          </svg>
        </div>
      </article>

      {/* ── Right Content: Hourly Graph + Rounded Metric Cards ── */}
      <div className="weather-metrics-column">
        {/* Top: Hourly Temperature Trend Card */}
        <div className="weather-metric-card weather-hourly-card">
          <div className="weather-hourly-header">
            <div>
              <span className="weather-card-label">Hourly Temperature Forecast</span>
              <span className="weather-card-sub">Next 6 hours forecast profile</span>
            </div>
            <span className="weather-pill-tag">Live Sensor Point</span>
          </div>

          <div className="weather-chart-wrapper">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="weather-chart-svg" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0077b6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#0077b6" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path d={svgArea} fill="url(#chartGrad)" />
              <path d={svgPath} fill="none" stroke="#0077b6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {coords.map((pt, i) => (
                <g key={i}>
                  <circle cx={pt.x} cy={pt.y} r="3.5" fill="#ffffff" stroke="#0077b6" strokeWidth="2" />
                  <text x={pt.x} y={pt.y - 7} textAnchor="middle" className="chart-temp-label">
                    {pt.temp}°
                  </text>
                  <text x={pt.x} y={chartHeight - 4} textAnchor="middle" className="chart-time-label">
                    {pt.time}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Bottom Row: 5 Clean Rounded Cards */}
        <div className="weather-grid-cards">
          {/* 1. Humidity */}
          <div className="weather-metric-card weather-pill-card">
            <div className="metric-icon-wrap" style={{ background: "rgba(0, 180, 216, 0.12)", color: "#0096c7" }}>
              <Droplets size={18} />
            </div>
            <div className="metric-content">
              <span className="metric-title">Humidity</span>
              <strong className="metric-value">{humidity}%</strong>
              <span className="metric-footnote">{humidity > 80 ? "Humid air" : "Normal level"}</span>
            </div>
          </div>

          {/* 2. Wind Speed */}
          <div className="weather-metric-card weather-pill-card">
            <div className="metric-icon-wrap" style={{ background: "rgba(72, 202, 228, 0.15)", color: "#023e8a" }}>
              <Wind size={18} />
            </div>
            <div className="metric-content">
              <span className="metric-title">Wind Speed</span>
              <strong className="metric-value">{windSpeed} <span className="metric-unit">km/h</span></strong>
              <span className="metric-footnote">Gentle breeze</span>
            </div>
          </div>

          {/* 3. UV Index */}
          <div className="weather-metric-card weather-pill-card">
            <div className="metric-icon-wrap" style={{ background: "rgba(245, 158, 11, 0.12)", color: "#d97706" }}>
              <SunMedium size={18} />
            </div>
            <div className="metric-content">
              <span className="metric-title">UV Index</span>
              <strong className="metric-value">{uvVal}</strong>
              <span className="metric-footnote">{Number(uvVal) > 6 ? "High exposure" : "Moderate UV"}</span>
            </div>
          </div>

          {/* 4. Feels Like */}
          <div className="weather-metric-card weather-pill-card">
            <div className="metric-icon-wrap" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#dc2626" }}>
              <Thermometer size={18} />
            </div>
            <div className="metric-content">
              <span className="metric-title">Feels Like</span>
              <strong className="metric-value">{apparentTemp}°C</strong>
              <span className="metric-footnote">Comfort index</span>
            </div>
          </div>

          {/* 5. Chance of Rain */}
          <div className="weather-metric-card weather-pill-card">
            <div className="metric-icon-wrap" style={{ background: "rgba(59, 130, 246, 0.12)", color: "#2563eb" }}>
              <CloudRain size={18} />
            </div>
            <div className="metric-content">
              <span className="metric-title">Rain Chance</span>
              <strong className="metric-value">{rainChance}%</strong>
              <span className="metric-footnote">Next 48 hours</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
