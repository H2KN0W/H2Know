import { createClient } from "@supabase/supabase-js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Site location (single source of truth, mirrored from src/config/siteLocation.js) ───
// Edge functions cannot import frontend modules, so this mirror must be updated
// together with src/config/siteLocation.js when the deployment site changes.
const SITE_LOCATION = {
  river: "Dicklum River",
  barangay: "Barangay Dicklum",
  city: "Manolo Fortich",
  province: "Bukidnon",
  country: "Philippines",
  basin: "Dicklum River Basin",
  lat: 8.3819,
  lon: 124.845,
};

// Dicklum River Node 1 coordinates (see SITE_LOCATION above)
const LAT = SITE_LOCATION.lat;
const LON = SITE_LOCATION.lon;

// ── Open-Meteo Forecast & Historical Rainfall ────────────────────────────────
async function fetchWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(LAT));
  url.searchParams.set("longitude", String(LON));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m"
  );
  url.searchParams.set(
    "hourly",
    "precipitation,rain,temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,precipitation_probability,uv_index,weather_code"
  );
  url.searchParams.set(
    "daily",
    "precipitation_sum,rain_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,uv_index_max"
  );
  url.searchParams.set("past_days", "7");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "Asia/Manila");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
  return res.json();
}

// ── Supabase telemetry (Last 14 days of sensor readings) ──────────────────────
async function fetchTelemetry(supabase: ReturnType<typeof createClient>) {
  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("sensor_readings")
    .select("value, recorded_at, parameters ( name, unit )")
    .gte("recorded_at", from)
    .order("recorded_at", { ascending: false })
    .limit(3000);
  if (error) throw error;
  return data ?? [];
}

type Reading = { value: number | string; recorded_at: string; parameters: { name: string; unit: string } | null };

function statsByParam(readings: Reading[]) {
  const map: Record<string, { values: number[]; dates: string[] }> = {};
  for (const r of readings) {
    const name = r.parameters?.name;
    if (!name) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    if (!map[name]) map[name] = { values: [], dates: [] };
    map[name].values.push(v);
    map[name].dates.push(r.recorded_at);
  }

  return Object.fromEntries(
    Object.entries(map).map(([name, data]) => {
      const vals = data.values;
      const latest = vals[0] ?? 0;
      const avg = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
      const min = Math.min(...vals);
      const max = Math.max(...vals);

      // Trajectory calculation comparing recent 25% vs older 75%
      const quarter = Math.max(1, Math.floor(vals.length / 4));
      const recentAvg = vals.slice(0, quarter).reduce((s, v) => s + v, 0) / quarter;
      const olderAvg = vals.slice(quarter).reduce((s, v) => s + v, 0) / (vals.length - quarter || 1);
      const deltaPercent = olderAvg !== 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

      const trend = Math.abs(deltaPercent) < 3
        ? "stable"
        : deltaPercent > 0
          ? "rising"
          : "falling";

      return [
        name,
        {
          current: +latest.toFixed(2),
          avg: +avg.toFixed(2),
          min: +min.toFixed(2),
          max: +max.toFixed(2),
          count: vals.length,
          trend,
          deltaPercent: +deltaPercent.toFixed(1),
        },
      ];
    })
  );
}

function summarizeWeather(weather: Record<string, unknown>) {
  const daily = weather.daily as Record<string, unknown[]> | undefined;
  const current = weather.current as Record<string, number> | undefined;
  if (!daily) return null;

  const dates = (daily.time || []) as string[];
  const rain = (daily.rain_sum || daily.precipitation_sum || []) as number[];
  const precipProb = (daily.precipitation_probability_max || []) as number[];
  const tempMax = (daily.temperature_2m_max || []) as number[];

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayIdx = Math.max(0, dates.findIndex((d) => d >= todayStr));

  const past7DaysRain = rain.slice(0, todayIdx).reduce((s, v) => s + (v ?? 0), 0);
  const past3DaysRain = rain.slice(Math.max(0, todayIdx - 3), todayIdx).reduce((s, v) => s + (v ?? 0), 0);
  const todayRain = rain[todayIdx] ?? 0;
  const next48hRain = rain.slice(todayIdx + 1, todayIdx + 3).reduce((s, v) => s + (v ?? 0), 0);
  const next7DaysRain = rain.slice(todayIdx + 1, todayIdx + 8).reduce((s, v) => s + (v ?? 0), 0);
  const next48hPrecipProbMax = Math.max(0, ...precipProb.slice(todayIdx + 1, todayIdx + 3).map((v) => v ?? 0));
  const next7DaysPrecipProbMax = Math.max(0, ...precipProb.slice(todayIdx + 1, todayIdx + 8).map((v) => v ?? 0));

  // Determine soil saturation level based on cumulative past precipitation
  let soilSaturation: "low" | "moderate" | "high" | "saturated" = "low";
  if (past7DaysRain > 80 || (past3DaysRain > 45)) soilSaturation = "saturated";
  else if (past7DaysRain > 45 || past3DaysRain > 25) soilSaturation = "high";
  else if (past7DaysRain > 20 || past3DaysRain > 10) soilSaturation = "moderate";

  return {
    currentTempC: current?.temperature_2m ?? null,
    currentHumidity: current?.relative_humidity_2m ?? null,
    currentPrecipMm: current?.precipitation ?? 0,
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

// ── Comprehensive Hydrological & AI Risk Model ────────────────────────────────
function generateUnifiedAnalysis(
  stats: ReturnType<typeof statsByParam>,
  ws: ReturnType<typeof summarizeWeather>
) {
  const turbidity = stats["Turbidity"];
  const pH = stats["pH"];
  const tds = stats["TDS"];
  const temp = stats["Temperature"];

  const pastWeekRain = ws?.past7DaysRainMm ?? 0;
  const nextWeekRain = ws?.next7DaysRainMm ?? 0;
  const next48hRain = ws?.next48hRainMm ?? 0;
  const soilSaturation = ws?.soilSaturation ?? "low";

  // Calculate Overall Risk Level
  let riskLevel: "low" | "moderate" | "high" | "severe" = "low";
  const riskFactors: string[] = [];
  const positiveFactors: string[] = [];

  // Runoff Risk Evaluation
  let runoffRiskLevel: "low" | "moderate" | "high" | "severe" = "low";
  if (soilSaturation === "saturated" && nextWeekRain > 35) {
    runoffRiskLevel = "severe";
    riskLevel = "severe";
    riskFactors.push("Catchment soils are fully saturated and sustained rainfall is forecast, indicating severe runoff and sediment erosion.");
  } else if ((soilSaturation === "high" || soilSaturation === "saturated") || nextWeekRain > 40 || next48hRain > 25) {
    runoffRiskLevel = "high";
    riskLevel = "high";
    riskFactors.push("High soil moisture and sustained weekly rainfall create elevated watershed runoff, carrying sediment and dissolved minerals into the river.");
  } else if (soilSaturation === "moderate" || nextWeekRain > 20 || next48hRain > 12) {
    runoffRiskLevel = "moderate";
    if (riskLevel === "low") riskLevel = "moderate";
    riskFactors.push("Moderate rainfall forecast may trigger localized surface runoff from upstream agricultural and cleared zones.");
  } else {
    positiveFactors.push("Low cumulative precipitation and dry catchment soil profile minimize immediate flash runoff risk.");
  }

  // Parameter Diagnostics
  if (turbidity) {
    if (turbidity.current > 50 || turbidity.avg > 40) {
      riskFactors.push(`Turbidity is significantly elevated (${turbidity.current} NTU), showing heavy suspended solids in the water column.`);
      if (riskLevel === "low" || riskLevel === "moderate") riskLevel = "high";
    } else if (turbidity.trend === "rising") {
      riskFactors.push(`Turbidity is trending upward (+${turbidity.deltaPercent}%), indicating incoming particulate load.`);
      if (riskLevel === "low") riskLevel = "moderate";
    } else {
      positiveFactors.push(`Turbidity is well within clear river baselines (${turbidity.current} NTU).`);
    }
  }

  if (pH) {
    if (pH.current < 6.5) {
      riskFactors.push(`Current pH (${pH.current}) is slightly acidic. Rainfall wash-in or organic acid drainage may be lowering alkalinity.`);
      if (riskLevel === "low") riskLevel = "moderate";
    } else if (pH.current > 8.5) {
      riskFactors.push(`Current pH (${pH.current}) is alkaline, which under sunny conditions can stimulate algal proliferation.`);
      if (riskLevel === "low") riskLevel = "moderate";
    } else {
      positiveFactors.push(`pH balance (${pH.current}) is optimal for natural freshwater ecology (6.5 – 8.5).`);
    }
  }

  if (tds) {
    if (tds.current > 500) {
      riskFactors.push(`TDS is elevated at ${tds.current} ppm, reflecting high dissolved mineral/nutrient load.`);
      if (riskLevel === "low") riskLevel = "moderate";
    } else if (tds.trend === "rising" && runoffRiskLevel !== "low") {
      riskFactors.push(`TDS is rising (+${tds.deltaPercent}%), indicating dissolved run-off from agricultural and riparian land.`);
    } else {
      positiveFactors.push(`Total dissolved solids (${tds.current} ppm) are in healthy range.`);
    }
  }

  if (temp) {
    if (temp.current > 30 || (ws?.tomorrowTempMaxC ?? 0) > 33) {
      riskFactors.push(`Warm water temperatures (${temp.current} °C) may accelerate microbial activity and reduce dissolved oxygen saturation.`);
      if (riskLevel === "low") riskLevel = "moderate";
    }
  }

  // Current Data Interpretation (Clear narrative breakdown)
  const currentInterpretation = {
    overview: riskLevel === "low"
      ? "Current sensor telemetry reflects a balanced, healthy river system with stable chemical baselines and minimal active stress."
      : riskLevel === "moderate"
        ? "Monitoring telemetry exhibits moderate fluctuations, with early runoff or mineral indicators showing dynamic watershed response to rainfall."
        : "River telemetry demonstrates significant environmental pressure, marked by particulate turbidity surge and watershed surface runoff.",
    hydroChemicalStatus: `The Dicklum River is currently exhibiting ${pH ? `pH ${pH.current} (${pH.trend})` : "stable pH"}, ${turbidity ? `turbidity of ${turbidity.current} NTU (${turbidity.trend})` : "normal clarity"}, and ${tds ? `TDS of ${tds.current} ppm` : "stable TDS"}. The hydro-chemical balance indicates ${pH && pH.current >= 6.5 && pH.current <= 8.5 ? "sound buffering capacity" : "alkalinity stress"}.`,
    keyObservations: riskFactors.length > 0 ? riskFactors : positiveFactors,
  };

  // Runoff Risk Details
  const runoffAnalysis = {
    riskLevel: runoffRiskLevel,
    soilSaturation,
    past7DaysRainMm: pastWeekRain,
    next7DaysRainMm: nextWeekRain,
    summary: runoffRiskLevel === "severe" || runoffRiskLevel === "high"
      ? `Sustained weekly rainfall of ${nextWeekRain} mm over already ${soilSaturation} soil will induce extensive surface wash-off, accelerating topsoil transport into the stream channel.`
      : runoffRiskLevel === "moderate"
        ? `Forecasted weekly precipitation (${nextWeekRain} mm) is expected to trigger moderate overland flow in unpaved and agricultural tracts of the Dicklum catchment.`
        : `With ${nextWeekRain} mm rain forecast across the next 7 days and low soil saturation, surface runoff risk remains low.`,
  };

  // Long-Term (Weeks and Months) Predictive Impacts
  const longTermPredictiveImpacts = {
    weeksHorizon: {
      title: "1–4 Weeks Horizon: Catchment Siltation & Runoff Dynamics",
      impacts: [
        nextWeekRain > 30 || pastWeekRain > 40
          ? `Sustained multi-day rain is predicted to deliver cumulative sediment plumes, keeping fine suspended particles in the water column for 10–14 days post-rainfall.`
          : `Gradual river self-cleansing and settling will maintain low turbidity levels across upcoming weeks if rainfall remains intermittent.`,
        `Fine silt settling in lower-gradient river reaches will temporarily increase bed sediment deposition, altering micro-habitats of benthic fauna.`,
        `Intermittent flush events followed by clear spells will cause cyclical turbidity peaks followed by swift TDS dilution and subsequent reconcentration.`,
        `Local community and municipal water intakes will experience increased filter cake buildup and higher coagulant dosing requirements during heavy rain episodes.`,
      ],
    },
    monthsHorizon: {
      title: "1–3 Months Horizon: Seasonal Watershed & Ecological Trajectory",
      impacts: [
        `Seasonal monsoonal precipitation shifts over the next 2–3 months will transition the catchment between high-volume flush regimes and low-flow dry intervals.`,
        `Sustained topsoil erosion along agricultural margins can progressively reduce streambank stability unless vegetative riparian buffer strips are fortified.`,
        `During forthcoming dry spells, diminished baseflow combined with solar heating will concentrate dissolved ions (elevating TDS) and lower dissolved oxygen carrying capacity.`,
        `Cumulative seasonal nutrient runoff (phosphates and nitrates from cultivated catchment acreage) may trigger benthic algal blooms as river velocity decreases.`,
      ],
    },
  };

  // Actionable Recommendations
  const recommendations = {
    immediate: [
      runoffRiskLevel !== "low"
        ? "Alert municipal and irrigation intakes to prepare for turbidity surges and schedule intake valve adjustments."
        : "Maintain standard telemetry sampling cadence and calibrate optical turbidity sensors.",
      (turbidity && turbidity.current > 30) || next48hRain > 20
        ? "Pre-position flocculation / coagulant supplies at treatment filtration plants."
        : "Verify that sensor solar charging and battery levels are adequate ahead of cloudy rainy sequences.",
      pH && (pH.current < 6.8 || pH.current > 8.2)
        ? "Perform spot titration tests at upstream tributary junctions to isolate chemical discharge points."
        : "Conduct visual shoreline spot-checks for localized bank scouring or illegal dumping.",
    ],
    strategic: [
      "Implement riparian buffer reforestation along vulnerable agricultural segments of the Dicklum catchment boundary.",
      "Establish seasonal silt traps and sediment retention ponds upstream of municipal abstraction points.",
      "Collaborate with Barangay Dicklum local agricultural cooperatives to promote contour farming and cover cropping to limit rainy-season topsoil loss.",
      "Schedule quarterly riverbed bathymetry assessments to monitor long-term silt accumulation and maintain hydrological carrying capacity.",
    ],
  };

  return {
    riskLevel,
    currentInterpretation,
    runoffAnalysis,
    longTermPredictiveImpacts,
    recommendations,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [weather, telemetry] = await Promise.all([
      fetchWeather().catch(() => null),
      fetchTelemetry(supabase).catch(() => []),
    ]);

    const stats = statsByParam(telemetry as Reading[]);
    const ws = weather ? summarizeWeather(weather as Record<string, unknown>) : null;
    const analysis = generateUnifiedAnalysis(stats, ws);

    const payload = {
      generatedAt: new Date().toISOString(),
      location: {
        name: `${SITE_LOCATION.river}, ${SITE_LOCATION.city}`,
        city: SITE_LOCATION.city,
        province: SITE_LOCATION.province,
        lat: LAT,
        lon: LON,
      },
      weatherSummary: ws,
      currentWeather: (weather as Record<string, unknown>)?.current || null,
      dailyForecast: (weather as Record<string, unknown>)?.daily || null,
      telemetrySummary: stats,
      unifiedAnalysis: analysis,
      aiInsights: {
        riskLevel: analysis.riskLevel,
        risks: analysis.currentInterpretation.keyObservations,
        recommendations: analysis.recommendations.immediate,
        forecastHorizonHours: 168, // 7 days
        model: "hydrological-ai-v2",
      },
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
