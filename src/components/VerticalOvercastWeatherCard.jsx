import { CloudRain } from "lucide-react";
import { getWeatherCondition } from "../lib/weatherCondition";
import { SITE_LOCATION } from "../config/siteLocation";
import { CITY_NAME } from "../config/constants";

/**
 * Vertical Weather Card
 * Fits on the left column of the Manager Dashboard alongside Catchment Map and Sensor Status.
 * Location is dynamic: renders weatherData.location when present, otherwise falls
 * back to the central SITE_LOCATION config (no hardcoded city strings).
 */
export default function VerticalOvercastWeatherCard({ weatherData, loading }) {
  const current = weatherData?.currentWeather;
  const weatherSummary = weatherData?.weatherSummary;

  // City label comes from the shared CITY_NAME constant. Coordinates stay
  // sourced from SITE_LOCATION — never derived from reverse-geocode or API
  // responses.
  const cityName = CITY_NAME;
  const subLocation = `${SITE_LOCATION.river}, ${SITE_LOCATION.province}`;

  // Dynamic temperature & apparent temperature from Open-Meteo
  const temp = current?.temperature_2m != null ? Math.round(current.temperature_2m) : null;
  const feelsLike = current?.apparent_temperature != null
    ? Math.round(current.apparent_temperature)
    : temp;

  // Dynamic WMO weather code & condition label / icon
  const weatherCode = current?.weather_code;
  const condition = getWeatherCondition(weatherCode);
  const ConditionIcon = condition.icon;

  const past3DaysRain = weatherSummary?.past3DaysRainMm != null
    ? `${Number(weatherSummary.past3DaysRainMm).toFixed(1)} mm`
    : "—";

  const todayRain = weatherSummary?.todayRainMm != null
    ? `${Number(weatherSummary.todayRainMm).toFixed(1)} mm`
    : "—";

  const next48hRain = weatherSummary?.next48hRainMm != null
    ? `${Number(weatherSummary.next48hRainMm).toFixed(1)} mm`
    : "—";

  const precipProb = weatherSummary?.next48hPrecipProbMax != null
    ? `${weatherSummary.next48hPrecipProbMax}%`
    : "—";

  return (
    <article className="vertical-overcast-card" aria-label="Current Weather and Rainfall Status">
      <div className="voc-top">
        <div className="voc-badge">
          <span className="voc-live-dot" />
          <span>{loading ? "Syncing..." : "Live Weather"}</span>
        </div>
        <p className="voc-city">{cityName}</p>
        <span className="voc-sub">{subLocation}</span>
      </div>

      <div className="voc-main">
        <div className="voc-icon-wrap" aria-hidden="true">
          <ConditionIcon size={52} strokeWidth={1.5} className="voc-cloud-icon" />
          {(weatherCode >= 51 || (weatherSummary?.todayRainMm ?? 0) > 0) && (
            <CloudRain size={26} strokeWidth={1.8} className="voc-rain-icon" />
          )}
        </div>
        <div className="voc-temp-block">
          <div className="voc-temp-row">
            <span className="voc-temp">{temp != null ? temp : "—"}</span>
            <span className="voc-deg">°C</span>
          </div>
          <span className="voc-condition">{condition.label}</span>
          {feelsLike != null && (
            <span className="voc-feels">Feels like {feelsLike}°C</span>
          )}
        </div>
      </div>

      <div className="voc-table-section">
        <div className="voc-table-header">
          <span>Rainfall Status</span>
          <span className="voc-table-tag">Open-Meteo</span>
        </div>

        <table className="voc-table">
          <tbody>
            <tr>
              <td>Past 3 Days</td>
              <td className="voc-td-val">{past3DaysRain}</td>
            </tr>
            <tr>
              <td>Today Rain</td>
              <td className="voc-td-val">{todayRain}</td>
            </tr>
            <tr>
              <td>Next 48 Hours</td>
              <td className="voc-td-val font-semibold">{next48hRain}</td>
            </tr>
            <tr>
              <td>Precip Chance</td>
              <td className="voc-td-val">{precipProb}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}
