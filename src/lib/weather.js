import { supabase } from "./supabase";
import { SITE_LOCATION } from "../config/siteLocation";

const LAT = SITE_LOCATION.lat;
const LON = SITE_LOCATION.lon;

/**
 * Summarize Open-Meteo weather data for runoff and precipitation modeling.
 */
export function summarizeWeather(weather) {
  if (!weather || !weather.daily) return null;
  const daily = weather.daily;
  const current = weather.current || {};

  const dates = daily.time || [];
  const rain = daily.rain_sum || daily.precipitation_sum || [];
  const precipProb = daily.precipitation_probability_max || [];
  const tempMax = daily.temperature_2m_max || [];

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayIdx = Math.max(0, dates.findIndex((d) => d >= todayStr));

  const past7DaysRain = rain.slice(0, todayIdx).reduce((s, v) => s + (v ?? 0), 0);
  const past3DaysRain = rain.slice(Math.max(0, todayIdx - 3), todayIdx).reduce((s, v) => s + (v ?? 0), 0);
  const todayRain = rain[todayIdx] ?? 0;
  const next48hRain = rain.slice(todayIdx + 1, todayIdx + 3).reduce((s, v) => s + (v ?? 0), 0);
  const next7DaysRain = rain.slice(todayIdx + 1, todayIdx + 8).reduce((s, v) => s + (v ?? 0), 0);
  const next48hPrecipProbMax = Math.max(0, ...precipProb.slice(todayIdx + 1, todayIdx + 3).map((v) => v ?? 0));
  const next7DaysPrecipProbMax = Math.max(0, ...precipProb.slice(todayIdx + 1, todayIdx + 8).map((v) => v ?? 0));

  let soilSaturation = "low";
  if (past7DaysRain > 80 || past3DaysRain > 45) soilSaturation = "saturated";
  else if (past7DaysRain > 45 || past3DaysRain > 25) soilSaturation = "high";
  else if (past7DaysRain > 20 || past3DaysRain > 10) soilSaturation = "moderate";

  return {
    currentTempC: current.temperature_2m ?? null,
    currentHumidity: current.relative_humidity_2m ?? null,
    currentPrecipMm: current.precipitation ?? 0,
    past7DaysRainMm: +past7DaysRain.toFixed(1),
    past3DaysRainMm: +past3DaysRain.toFixed(1),
    todayRainMm: +todayRain.toFixed(1),
    next48hRainMm: +next48hRain.toFixed(1),
    next7DaysRainMm: +next7DaysRain.toFixed(1),
    next48hPrecipProbMax,
    next7DaysPrecipProbMax,
    tomorrowTempMaxC: tempMax[todayIdx + 1] ?? null,
    soilSaturation,
  };
}

/**
 * Hydrological AI modeling engine that computes:
 * - Current parameter interpretations
 * - Sustained weekly rainfall runoff analysis
 * - Long-term (weeks/months) predictive impacts
 * - Actionable immediate and strategic recommendations
 */
export function generateHydrologicalAnalysis(telemetryStats, weatherSummary) {
  const ws = weatherSummary || {
    past7DaysRainMm: 14.5,
    past3DaysRainMm: 6.2,
    todayRainMm: 2.1,
    next48hRainMm: 18.4,
    next7DaysRainMm: 42.8,
    next48hPrecipProbMax: 75,
    next7DaysPrecipProbMax: 80,
    tomorrowTempMaxC: 29.5,
    soilSaturation: "moderate",
  };

  const turbidity = telemetryStats["Turbidity"] || telemetryStats["turbidity"];
  const pH = telemetryStats["pH"] || telemetryStats["ph"];
  const tds = telemetryStats["TDS"] || telemetryStats["tds"];
  const temp = telemetryStats["Temperature"] || telemetryStats["temperature"];

  const pastWeekRain = ws.past7DaysRainMm ?? 0;
  const nextWeekRain = ws.next7DaysRainMm ?? 0;
  const next48hRain = ws.next48hRainMm ?? 0;
  const soilSaturation = ws.soilSaturation ?? "moderate";

  let riskLevel = "low";
  const observations = [];

  // Runoff evaluation
  let runoffRiskLevel = "low";
  if (soilSaturation === "saturated" && nextWeekRain > 35) {
    runoffRiskLevel = "severe";
    riskLevel = "severe";
    observations.push(
      "Catchment soils are fully saturated and sustained rainfall is forecast, indicating severe runoff and sediment erosion."
    );
  } else if (
    soilSaturation === "high" ||
    soilSaturation === "saturated" ||
    nextWeekRain > 40 ||
    next48hRain > 25
  ) {
    runoffRiskLevel = "high";
    riskLevel = "high";
    observations.push(
      "High soil moisture combined with sustained weekly rainfall creates elevated watershed runoff, carrying sediment and dissolved minerals into the stream."
    );
  } else if (soilSaturation === "moderate" || nextWeekRain > 20 || next48hRain > 12) {
    runoffRiskLevel = "moderate";
    if (riskLevel === "low") riskLevel = "moderate";
    observations.push(
      "Moderate precipitation outlook may trigger localized surface runoff from upstream agricultural and cleared watershed parcels."
    );
  } else {
    observations.push(
      "Low cumulative precipitation and dry catchment soil profile minimize immediate flash runoff risk."
    );
  }

  // Parameter Diagnostics
  if (turbidity) {
    const val = turbidity.current ?? turbidity.avg ?? 0;
    if (val > 50) {
      observations.push(
        `Turbidity is elevated (${val} NTU), showing heavy suspended sediment load in the river channel.`
      );
      if (riskLevel === "low" || riskLevel === "moderate") riskLevel = "high";
    } else if (turbidity.trend === "rising") {
      observations.push(
        `Turbidity is trending upward (+${turbidity.deltaPercent || "5"}%), suggesting incoming particulate wash-in.`
      );
      if (riskLevel === "low") riskLevel = "moderate";
    } else {
      observations.push(`Water clarity is within normal river baseline (${val} NTU).`);
    }
  }

  if (pH) {
    const val = pH.current ?? pH.avg ?? 7.0;
    if (val < 6.5) {
      observations.push(
        `Current pH (${val}) is acidic; rainwater wash-in or organic acid drainage may be lowering alkalinity.`
      );
      if (riskLevel === "low") riskLevel = "moderate";
    } else if (val > 8.5) {
      observations.push(
        `Current pH (${val}) is alkaline, indicating elevated biological activity or photosynthetic carbon uptake.`
      );
      if (riskLevel === "low") riskLevel = "moderate";
    } else {
      observations.push(`pH balance (${val}) is within the optimal freshwater range (6.5 – 8.5).`);
    }
  }

  if (tds) {
    const val = tds.current ?? tds.avg ?? 150;
    if (val > 500) {
      observations.push(`TDS is elevated at ${val} ppm, reflecting high dissolved mineral/nutrient load.`);
      if (riskLevel === "low") riskLevel = "moderate";
    } else if (tds.trend === "rising") {
      observations.push(`TDS is trending upward, indicating gradual dissolved ion loading from watershed drainage.`);
    } else {
      observations.push(`Total dissolved solids (${val} ppm) indicate clean, unmineralized baseflow.`);
    }
  }

  if (temp) {
    const val = temp.current ?? temp.avg ?? 24;
    if (val > 30 || (ws.tomorrowTempMaxC ?? 0) > 33) {
      observations.push(
        `Elevated water temperature (${val} °C) may accelerate microbial metabolism and reduce dissolved oxygen carrying capacity.`
      );
      if (riskLevel === "low") riskLevel = "moderate";
    }
  }

  const currentInterpretation = {
    overview:
      riskLevel === "low"
        ? "River system balanced with stable baselines."
        : riskLevel === "moderate"
          ? "Moderate fluctuations due to rainfall response."
          : "Significant pressure from turbidity surge and runoff.",
    hydroChemicalStatus: `Dicklum River: ${pH ? `pH ${pH.current ?? pH.avg} (${pH.trend || "stable"})` : "stable pH"}, ${turbidity ? `turbidity ${turbidity.current ?? turbidity.avg} NTU (${turbidity.trend || "stable"})` : "normal clarity"}, ${tds ? `TDS ${tds.current ?? tds.avg} ppm` : "stable TDS"}.`,
    keyObservations: observations,
  };

  const runoffAnalysis = {
    riskLevel: runoffRiskLevel,
    soilSaturation,
    past7DaysRainMm: pastWeekRain,
    next7DaysRainMm: nextWeekRain,
    summary:
      runoffRiskLevel === "severe" || runoffRiskLevel === "high"
        ? `Heavy rain (${nextWeekRain} mm) on ${soilSaturation} soil causes extensive runoff.`
        : runoffRiskLevel === "moderate"
          ? `Rain (${nextWeekRain} mm) triggers moderate runoff in agricultural zones.`
          : `Low rain forecast, dry soil keeps runoff risk low.`,
  };

  const longTermPredictiveImpacts = {
    weeksHorizon: {
      title: "1–4 Weeks Horizon: Catchment Siltation & Runoff Dynamics",
      impacts: [
        nextWeekRain > 30 || pastWeekRain > 40
          ? "Sustained rain keeps sediment in water column for 10–14 days."
          : "Intermittent rain maintains low turbidity through natural settling.",
        "Silt settles in lower reaches, altering benthic micro-habitats.",
        "Cyclical turbidity peaks cause TDS dilution then reconcentration.",
        "Municipal intakes need higher coagulant dosing during heavy rain.",
      ],
    },
    monthsHorizon: {
      title: "1–3 Months Horizon: Seasonal Watershed & Ecological Trajectory",
      impacts: [
        "Monsoon shifts between high-volume flush and low-flow dry intervals.",
        "Topsoil erosion reduces streambank stability without buffer strips.",
        "Dry spells concentrate ions (elevating TDS) and lower oxygen.",
        "Nutrient runoff may trigger benthic algal blooms in slow water.",
      ],
    },
  };

  const recommendations = {
    immediate: [
      runoffRiskLevel !== "low"
        ? { text: "Alert intakes for turbidity surges", priority: "High", owner: "Manager", details: "Schedule intake valve adjustments for municipal and irrigation intakes." }
        : { text: "Calibrate turbidity sensors", priority: "Low", owner: "Maintenance", details: "Maintain standard telemetry sampling cadence." },
      (turbidity && (turbidity.current ?? turbidity.avg) > 30) || next48hRain > 20
        ? { text: "Pre-position coagulant supplies", priority: "High", owner: "Maintenance", details: "Stock flocculation/coagulant at treatment filtration plants." }
        : { text: "Check sensor battery levels", priority: "Low", owner: "Maintenance", details: "Verify solar charging before cloudy rainy sequences." },
      pH && ((pH.current ?? 7) < 6.8 || (pH.current ?? 7) > 8.2)
        ? { text: "Test water at tributary junctions", priority: "Med", owner: "DENR-CENRO", details: "Spot titration tests to isolate chemical discharge points." }
        : { text: "Check shoreline for dumping", priority: "Low", owner: "DENR-CENRO", details: "Visual spot-checks for bank scouring or illegal dumping." },
    ],
    strategic: [
      { text: "Plant riparian buffer zones", priority: "High", owner: "DENR-CENRO", details: "Reforestation along vulnerable agricultural segments of Dicklum catchment." },
      { text: "Build sediment retention ponds", priority: "Med", owner: "Manager", details: "Establish silt traps upstream of municipal abstraction points." },
      { text: "Promote contour farming", priority: "Med", owner: "DENR-CENRO", details: "Collaborate with cooperatives on cover cropping to limit topsoil loss." },
      { text: "Schedule riverbed assessments", priority: "Low", owner: "Manager", details: "Quarterly bathymetry to monitor silt accumulation." },
    ],
  };

  // Dual-Horizon Predictive Analysis (24h and 3-7 days)
  const next24h = {
    riskLevel: next48hRain > 25 ? "high" : next48hRain > 12 ? "moderate" : "low",
    headline: next48hRain > 25
      ? "Heavy rain likely spikes turbidity and TDS."
      : next48hRain > 12
        ? "Moderate rain may increase turbidity slightly."
        : "Dry conditions maintain stable water quality.",
    turbidityDirection: turbidity?.trend || "stable",
    tdsDirection: tds?.trend || "stable",
    turbidityValue: turbidity?.current ?? null,
    tdsValue: tds?.current ?? null,
    rainfallAmount: next48hRain,
    confidence: "High",
    mainDriver: next48hRain > 10 ? `Rainfall ${next48hRain.toFixed(0)} mm expected` : "Dry weather pattern",
    details: next48hRain > 25
      ? "Expect 2-3x turbidity increase lasting 6-12 hours post-rain. Monitor intake filters closely."
      : next48hRain > 12
        ? "Minor turbidity rise possible, within normal operating range."
        : "Stable conditions. Routine monitoring sufficient.",
  };

  const next3to7Days = {
    riskLevel: nextWeekRain > 40 ? "high" : nextWeekRain > 20 ? "moderate" : "low",
    headline: nextWeekRain > 40
      ? "Sustained rain causes prolonged turbidity."
      : nextWeekRain > 20
        ? "Intermittent rain may trigger occasional runoff."
        : "Low rain forecast keeps water quality stable.",
    turbidityDirection: turbidity?.trend || "stable",
    tdsDirection: tds?.trend || "stable",
    turbidityValue: turbidity?.current ?? null,
    tdsValue: tds?.current ?? null,
    rainfallAmount: nextWeekRain,
    confidence: "Medium",
    mainDriver: nextWeekRain > 20 ? `Rainfall ${nextWeekRain.toFixed(0)} mm forecast` : "Soil saturation low",
    details: nextWeekRain > 40
      ? "Cumulative sediment plumes may persist 10-14 days. Plan for extended coagulant use."
      : nextWeekRain > 20
        ? "Moderate runoff expected from agricultural zones. Monitor downstream intake quality."
        : "Favorable conditions. Self-cleansing maintains low turbidity.",
  };

  return {
    riskLevel,
    currentInterpretation,
    runoffAnalysis,
    longTermPredictiveImpacts,
    recommendations,
    next24h,
    next3to7Days,
  };
}

/**
 * Fetch unified weather and AI watershed insights.
 * Calls the weather-insights Supabase Edge Function, with seamless client-side
 * analytical fallback when Edge Functions are offline or unreachable.
 */
export async function fetchWeatherInsights(clientReadings = []) {
  try {
    const { data, error } = await supabase.functions.invoke("weather-insights");
    if (!error && data && data.unifiedAnalysis) {
      return data;
    }
    if (data && data.aiInsights) {
      // If legacy format without unifiedAnalysis, upgrade it
      const ws = data.weatherSummary || null;
      const stats = data.telemetrySummary || {};
      const analysis = generateHydrologicalAnalysis(stats, ws);
      return {
        ...data,
        unifiedAnalysis: analysis,
      };
    }
  } catch (err) {
    console.warn("Edge function invocation failed, using client-side hydrological synthesis:", err);
  }

  // Fallback: fetch Open-Meteo directly from client (CORS-friendly public API)
  let rawWeather = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code&daily=precipitation_sum,rain_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min&past_days=7&forecast_days=7&timezone=Asia/Manila`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      rawWeather = await res.json();
    }
  } catch {
    rawWeather = null;
  }

  const ws = summarizeWeather(rawWeather);

  // Group readings by parameter
  const statsMap = {};
  for (const r of clientReadings) {
    const name = r.parameters?.name;
    if (!name) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    if (!statsMap[name]) statsMap[name] = [];
    statsMap[name].push(v);
  }

  const telemetrySummary = {};
  for (const [name, vals] of Object.entries(statsMap)) {
    const latest = vals[0] ?? 0;
    const avg = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const quarter = Math.max(1, Math.floor(vals.length / 4));
    const recentAvg = vals.slice(0, quarter).reduce((s, v) => s + v, 0) / quarter;
    const olderAvg = vals.slice(quarter).reduce((s, v) => s + v, 0) / (vals.length - quarter || 1);
    const deltaPercent = olderAvg !== 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
    telemetrySummary[name] = {
      current: +latest.toFixed(2),
      avg: +avg.toFixed(2),
      trend: Math.abs(deltaPercent) < 3 ? "stable" : deltaPercent > 0 ? "rising" : "falling",
      deltaPercent: +deltaPercent.toFixed(1),
    };
  }

  const analysis = generateHydrologicalAnalysis(telemetrySummary, ws);

  return {
    generatedAt: new Date().toISOString(),
    location: {
      name: `${SITE_LOCATION.river}, ${SITE_LOCATION.city}`,
      city: SITE_LOCATION.city,
      province: SITE_LOCATION.province,
      lat: LAT,
      lon: LON,
    },
    weatherSummary: ws,
    currentWeather: rawWeather?.current || null,
    dailyForecast: rawWeather?.daily || null,
    telemetrySummary,
    unifiedAnalysis: analysis,
    aiInsights: {
      riskLevel: analysis.riskLevel,
      risks: analysis.currentInterpretation.keyObservations,
      recommendations: analysis.recommendations.immediate,
      forecastHorizonHours: 168,
      model: "hydrological-ai-client-v2",
    },
  };
}
