/**
 * Single source of truth for the deployment site location.
 * All UI fallbacks, report headers, map popups, and weather payloads
 * should derive from SITE_LOCATION instead of hardcoding city strings,
 * so a future site move only requires editing this file
 * (plus the edge-function mirror noted in
 * supabase/functions/weather-insights/index.ts, which cannot import
 * frontend modules).
 */
export const SITE_LOCATION = {
  river: "Dicklum River",
  barangay: "Barangay Dicklum",
  city: "Manolo Fortich",
  province: "Bukidnon",
  country: "Philippines",
  basin: "Dicklum River Basin",
  lat: 8.3819,
  lon: 124.845,
};

export const SITE_STATION_LABEL =
  `${SITE_LOCATION.river}, ${SITE_LOCATION.barangay}, ${SITE_LOCATION.city}, ${SITE_LOCATION.province}`;

export const SITE_CITY_PROVINCE_LABEL =
  `${SITE_LOCATION.city}, ${SITE_LOCATION.province}`;

export const SITE_CITY_COUNTRY_LABEL =
  `${SITE_LOCATION.city}, ${SITE_LOCATION.province}, ${SITE_LOCATION.country}`;

export const SITE_RIVER_CITY_LABEL =
  `${SITE_LOCATION.river}, ${SITE_LOCATION.city}`;

export const SITE_MAP_FALLBACK_LABEL =
  `${SITE_LOCATION.river}, ${SITE_LOCATION.city}, ${SITE_LOCATION.province}`;
