import { supabase } from "./supabase";

/**
 * Calls the weather-insights Edge Function.
 * Returns the predictive JSON payload or throws on error.
 */
export async function fetchWeatherInsights() {
  const { data, error } = await supabase.functions.invoke("weather-insights");
  if (error) throw error;
  return data;
}
