import { Cloud, CloudRain } from "lucide-react";

/**
 * Vertical Overcast Weather Card
 * Fits cleanly on the far left column alongside Catchment Map and Sensor Status.
 * Displays:
 * - City / Location
 * - Current Overcast state with big icon and temperature
 * - Mini table showing recent rainfall (past 3 days, today) and upcoming rain forecast (next 48h, max probability)
 */
export default function VerticalOvercastWeatherCard({ weatherData, loading }) {
  const current = weatherData?.currentWeather;
  const weatherSummary = weatherData?.weatherSummary;

  const temp = current?.temperature_2m != null ? Math.round(current.temperature_2m) : 28;
  const feelsLike = current?.apparent_temperature != null ? Math.round(current.apparent_temperature) : temp;

  const past3DaysRain = weatherSummary?.past3DaysRainMm != null
    ? `${weatherSummary.past3DaysRainMm.toFixed(1)} mm`
    : "—";

  const todayRain = weatherSummary?.todayRainMm != null
    ? `${weatherSummary.todayRainMm.toFixed(1)} mm`
    : "—";

  const next48hRain = weatherSummary?.next48hRainMm != null
    ? `${weatherSummary.next48hRainMm.toFixed(1)} mm`
    : "—";

  const precipProb = weatherSummary?.next48hPrecipProbMax != null
    ? `${weatherSummary.next48hPrecipProbMax}%`
    : "—";

  return (
    <article className="vertical-overcast-card" aria-label="Current Weather and Rainfall Status">
      <div className="voc-top">
        <div className="voc-badge">
          <span className="voc-live-dot" />
          <span>Live Weather</span>
        </div>
        <p className="voc-city">Malaybalay City</p>
        <span className="voc-sub">Dicklum River Basin</span>
      </div>

      <div className="voc-main">
        <div className="voc-icon-wrap" aria-hidden="true">
          <Cloud size={52} strokeWidth={1.5} className="voc-cloud-icon" />
          <CloudRain size={26} strokeWidth={1.8} className="voc-rain-icon" />
        </div>
        <div className="voc-temp-block">
          <div className="voc-temp-row">
            <span className="voc-temp">{temp}</span>
            <span className="voc-deg">°C</span>
          </div>
          <span className="voc-condition">Overcast Skies</span>
          <span className="voc-feels">Feels like {feelsLike}°C</span>
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
