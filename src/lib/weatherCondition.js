import {
  Cloud,
  CloudSun,
  CloudRain,
  Sun,
  CloudLightning,
  CloudDrizzle,
} from "lucide-react";

/**
 * Interpret WMO Weather Code dynamically from Open-Meteo.
 * Shared utility used by VerticalOvercastWeatherCard and WeatherDashboardSection.
 *
 * @param {number|null} code - WMO weather code from Open-Meteo current weather
 * @returns {{ label: string, icon: React.ComponentType }}
 */
export function getWeatherCondition(code) {
  if (code == null) return { label: "Partly Cloudy", icon: CloudSun };
  if (code === 0) return { label: "Clear Sky", icon: Sun };
  if (code === 1 || code === 2) return { label: "Partly Cloudy", icon: CloudSun };
  if (code === 3) return { label: "Overcast", icon: Cloud };
  if (code >= 45 && code <= 48) return { label: "Foggy", icon: Cloud };
  if (code >= 51 && code <= 55) return { label: "Drizzle", icon: CloudDrizzle };
  if (code >= 61 && code <= 65) return { label: "Rain Showers", icon: CloudRain };
  if (code >= 80 && code <= 82) return { label: "Heavy Rain", icon: CloudRain };
  if (code >= 95) return { label: "Thunderstorm", icon: CloudLightning };
  return { label: "Scattered Clouds", icon: CloudSun };
}
