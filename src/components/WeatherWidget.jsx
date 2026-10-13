import { useEffect, useState, useCallback } from "react";
import { CloudRain, CloudSun, AlertTriangle } from "lucide-react";
import { fetchWeatherInsights } from "../lib/weather";

const RISK_COLOR = {
  low: "var(--color-ok, #27ae60)",
  moderate: "var(--color-warn, #e67e22)",
  high: "var(--color-alert, #c0392b)",
};

const RISK_ICON = {
  low: CloudSun,
  moderate: CloudRain,
  high: AlertTriangle,
};

/**
 * WeatherWidget — compact header chip.
 * Shows current risk level + 48-h rain forecast.
 * Refreshes every 30 minutes automatically.
 */
const WeatherWidget = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchWeatherInsights();
      setData(result);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return null; // silent fail — don't break header layout

  if (!data) {
    return (
      <div className="weather-widget weather-widget--loading" aria-label="Loading weather">
        <CloudRain size={14} />
        <span>Weather…</span>
      </div>
    );
  }

  const ai = data.aiInsights;
  const ws = data.weatherSummary;
  const risk = ai?.riskLevel ?? "low";
  const Icon = RISK_ICON[risk] ?? CloudSun;
  const color = RISK_COLOR[risk];

  return (
    <div className="weather-widget" title={`48-h forecast · ${data.location?.name}`}>
      <Icon size={14} style={{ color, flexShrink: 0 }} aria-hidden="true" />
      <span className="weather-widget__risk" style={{ color, fontWeight: 700, textTransform: "capitalize" }}>
        {risk} risk
      </span>
      {ws?.next48hRainMm != null && (
        <span className="weather-widget__rain">
          · {ws.next48hRainMm.toFixed(0)} mm / 48 h
        </span>
      )}
    </div>
  );
};

export default WeatherWidget;
