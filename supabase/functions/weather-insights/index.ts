import { createClient } from "@supabase/supabase-js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Dicklum River Node 1 coordinates
const LAT = 8.3819;
const LON = 124.845;

// ── Open-Meteo ────────────────────────────────────────────────────────────────
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
  url.searchParams.set("past_days", "3");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("timezone", "Asia/Manila");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}

// ── Supabase telemetry ────────────────────────────────────────────────────────
async function fetchTelemetry(supabase: ReturnType<typeof createClient>) {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("sensor_readings")
    .select("value, recorded_at, parameters ( name, unit )")
    .gte("recorded_at", from)
    .order("recorded_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

// ── Analysis helpers ──────────────────────────────────────────────────────────
type Reading = { value: number | string; recorded_at: string; parameters: { name: string; unit: string } | null };

function statsByParam(readings: Reading[]) {
  const map: Record<string, number[]> = {};
  for (const r of readings) {
    const name = r.parameters?.name;
    if (!name) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    (map[name] ??= []).push(v);
  }
  return Object.fromEntries(
    Object.entries(map).map(([name, vals]) => {
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const trend = vals.length >= 4
        ? vals.slice(-4).reduce((s, v) => s + v, 0) / 4 > avg ? "rising" : "falling"
        : "stable";
      return [name, { avg: +avg.toFixed(3), min: +min.toFixed(3), max: +max.toFixed(3), count: vals.length, trend }];
    })
  );
}

function weatherSummary(weather: Record<string, unknown>) {
  const daily = weather.daily as Record<string, unknown[]> | undefined;
  if (!daily) return null;
  const dates: string[] = daily.time as string[];
  const rain: number[] = daily.rain_sum as number[];
  const precipProb: number[] = daily.precipitation_probability_max as number[];
  const tempMax: number[] = daily.temperature_2m_max as number[];

  const todayIdx = Math.max(0, dates.findIndex((d) => d >= new Date().toISOString().slice(0, 10)));
  return {
    past3DaysRainMm: rain.slice(0, todayIdx).reduce((s, v) => s + (v ?? 0), 0),
    todayRainMm: rain[todayIdx] ?? 0,
    next48hRainMm: rain.slice(todayIdx + 1, todayIdx + 3).reduce((s, v) => s + (v ?? 0), 0),
    next48hPrecipProbMax: Math.max(...precipProb.slice(todayIdx + 1, todayIdx + 3).map((v) => v ?? 0)),
    tomorrowTempMaxC: tempMax[todayIdx + 1] ?? null,
  };
}

// ── Rule-based predictive analysis ───────────────────────────────────────────
function analyze(
  stats: ReturnType<typeof statsByParam>,
  ws: ReturnType<typeof weatherSummary>
) {
  const risks: string[] = [];
  const recommendations: string[] = [];
  let riskLevel: "low" | "moderate" | "high" = "low";

  const turbidity = stats["Turbidity"];
  const pH = stats["pH"];
  const tds = stats["TDS"];
  const temp = stats["Temperature"];

  // Rain → turbidity & TDS surge
  const heavyRainComing = (ws?.next48hRainMm ?? 0) > 20;
  const recentHeavyRain = (ws?.past3DaysRainMm ?? 0) > 30;

  if (recentHeavyRain && turbidity) {
    if (turbidity.avg > 50 || turbidity.trend === "rising") {
      risks.push("Recent heavy rain has likely elevated suspended sediment; turbidity trending upward.");
      recommendations.push("Increase turbidity sampling frequency and review filtration capacity.");
      riskLevel = "high";
    }
  }

  if (heavyRainComing) {
    risks.push(`${ws!.next48hRainMm.toFixed(1)} mm of rain expected in the next 48 hours — expect runoff-driven turbidity and TDS spikes.`);
    recommendations.push("Pre-position treatment chemicals and alert downstream users.");
    if (riskLevel !== "high") riskLevel = "moderate";
  }

  if (tds && tds.trend === "rising" && recentHeavyRain) {
    risks.push("TDS is rising after recent rainfall, suggesting increased dissolved load from catchment runoff.");
    recommendations.push("Check for upstream agricultural or erosion sources.");
    if (riskLevel !== "high") riskLevel = "moderate";
  }

  if (pH) {
    if (pH.avg < 6.5) {
      risks.push(`Average pH (${pH.avg}) is acidic — acidic rainfall may be contributing.`);
      recommendations.push("Test alkalinity and consider lime dosing.");
      if (riskLevel !== "high") riskLevel = "moderate";
    } else if (pH.avg > 8.5) {
      risks.push(`Average pH (${pH.avg}) is elevated — algal bloom possible under warm, calm conditions.`);
      recommendations.push("Monitor for algal blooms, especially in calmer sections.");
      if (riskLevel !== "high") riskLevel = "moderate";
    }
  }

  if (temp && (ws?.tomorrowTempMaxC ?? 0) > 32) {
    risks.push(`High air temperature tomorrow (${ws!.tomorrowTempMaxC}°C) may raise water temperature and reduce dissolved oxygen.`);
    recommendations.push("Monitor temperature and dissolved oxygen levels closely.");
    if (riskLevel === "low") riskLevel = "moderate";
  }

  if (risks.length === 0) {
    risks.push("No immediate weather-driven water quality risks detected.");
    recommendations.push("Continue routine monitoring.");
  }

  return { riskLevel, risks, recommendations };
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [weather, telemetry] = await Promise.all([fetchWeather(), fetchTelemetry(supabase)]);

    const stats = statsByParam(telemetry as Reading[]);
    const ws = weatherSummary(weather as Record<string, unknown>);
    const { riskLevel, risks, recommendations } = analyze(stats, ws);

    const payload = {
      generatedAt: new Date().toISOString(),
      location: { name: "Dicklum River, Malaybalay City", city: "Malaybalay City", province: "Bukidnon", lat: LAT, lon: LON },
      weatherSummary: ws,
      currentWeather: (weather as Record<string, unknown>).current || null,
      hourlyForecast: (weather as Record<string, unknown>).hourly || null,
      telemetrySummary: stats,
      aiInsights: {
        riskLevel,
        risks,
        recommendations,
        forecastHorizonHours: 48,
        model: "rule-based-v1",
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
