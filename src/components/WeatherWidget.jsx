import { useEffect, useState, useCallback } from "react";
import { CloudRain, CloudSun, AlertTriangle } from "lucide-react";
import { fetchWeatherInsights } from "../lib/weather";
import { useSilentRefresh } from "../hooks/useSilentRefresh";
import { REFRESH_INTERVALS } from "../config/constants";

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
import { SkeletonWeatherWidget } from "./ui/SkeletonCard";

const WeatherWidget = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async (signal) => {
    try {
      setIsLoading(true);
      const result = await fetchWeatherInsights();
      if (signal?.aborted) return;
      setData(result);
      setError(false);
    } catch {
      if (signal?.aborted) return;
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Silent Refresh Hook (30 min interval) - disabled to prevent automatic retries
  // User must manually refresh if data fails to load
  useSilentRefresh(load, {
    intervalMs: REFRESH_INTERVALS.WEATHER,
    enabled: false, // Disabled to prevent infinite retry loops
  });

  // Initial load only
  useEffect(() => {
    load();
  }, [load]);

  if (error) return null; // silent fail — don't break header layout

  if (!data) {
    return <SkeletonWeatherWidget />;
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
