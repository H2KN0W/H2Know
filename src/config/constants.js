/**
 * Application constants and configuration tokens.
 * Single source of truth for fixed roles, polling intervals, page sizes,
 * error messages, and parameters across H2KNOW.
 */

export const USER_ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
};

// Single source of truth for the displayed deployment city.
// The Dicklum catchment coordinates stay in src/config/siteLocation.js;
// only this label is rendered in the UI.
export const CITY_NAME = "Manolo Fortich";

export const USER_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export const PARAMETERS = ["pH", "Turbidity", "TDS", "Temperature"];
export const MONITORED_PARAMETERS = ["pH", "Turbidity", "TDS", "Temperature"];

const MONITORED_PARAM_SET = new Set(MONITORED_PARAMETERS.map((p) => p.toLowerCase()));

/**
 * Validates whether a parameter name is one of the four monitored water-quality parameters.
 * Explicitly rejects "Water Level" and unknown names.
 */
export const isMonitoredParameter = (name) => {
  if (!name || typeof name !== "string") return false;
  const clean = name.trim().toLowerCase();
  if (clean === "water level") return false;
  return MONITORED_PARAM_SET.has(clean);
};

/**
 * Filters an array of parameter objects to only include the four monitored water parameters.
 */
export const filterMonitoredParameters = (items = []) => {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => isMonitoredParameter(item?.name));
};

export const REFRESH_INTERVALS = {
  OFF: 0,
  FAST: 30000,   // 30s
  MEDIUM: 60000, // 1m
  SLOW: 300000,  // 5m
  VERY_SLOW: 600000, // 10m
  WEATHER: 30 * 60 * 1000, // 30 min
};

export const PAGE_SIZES = {
  DEFAULT: 15,
  ACTIVITY_LOGS: 25,
  USERS: 5,
};

export const ALERT_STATUSES = {
  ACTIVE: "active",
  REVIEWED: "reviewed",
  RESOLVED: "resolved",
};

export const REPORT_FORMATS = {
  PDF: "pdf",
  CSV: "csv",
};

// ─── Report date-range helpers ───────────────────────────────────────────────
// Always slice only the YYYY-MM-DD part first so callers can pass either a
// plain date-picker value ("2026-10-17") or a full ISO timestamp
// ("2026-10-17T00:00:00+00:00") without ever producing a double time suffix
// like "2026-10-17T00:00:00+00:00T00:00:00" (invalid timestamptz input).
export const toStartOfDay = (d) => `${String(d).slice(0, 10)}T00:00:00.000Z`;
export const toEndOfDay = (d) => `${String(d).slice(0, 10)}T23:59:59.999Z`;

/**
 * Shared UI animation timings and transition configurations.
 * Kept short (150-250ms) and lightweight for a responsive monitoring dashboard.
 */
export const ANIMATION_DURATIONS = {
  FAST: 0.15,      // 150ms
  BASE: 0.2,       // 200ms
  MODAL: 0.2,      // 200ms
  STAGGER: 0.035,  // 35ms between items (<40ms)
};

export const ANIMATION_EASING = [0.4, 0, 0.2, 1]; // standard smooth cubic-bezier

export const PAGE_TRANSITION_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: ANIMATION_EASING } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15, ease: ANIMATION_EASING } },
};

export const MODAL_ANIMATION_VARIANTS = {
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.18 } },
    exit: { opacity: 0, transition: { duration: 0.15 } },
  },
  modal: {
    initial: { opacity: 0, scale: 0.96, y: 6 },
    animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: ANIMATION_EASING } },
    exit: { opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.15, ease: ANIMATION_EASING } },
  },
};

/**
 * THRESHOLDS — single source of truth for all water-quality limits
 * shown to the user in the Manager portal.
 *
 * official: true  → value comes from DENR DAO 2016-08 / DAO 2021-19 Class C.
 * official: false → system-defined alert level; not yet confirmed against the DAO.
 *
 * label rule (used by ThresholdInfoPopover):
 *   official === true  → "DENR Class C limit"
 *   official === false → "Alert threshold"
 */
export const THRESHOLDS = {
  pH: {
    label:        "pH",
    unit:         "",
    min:          6.5,
    max:          9.0,
    warning:      null,
    standardLabel: "DENR Class C Limit",
    source:       "DENR DAO 2016-08 / DAO 2021-19 Table 3 (Class C)",
    fullCitation: "DENR Administrative Order No. 2016-08 / DAO 2021-19 (Table 3: Water Quality Guidelines for Class C Waters). Sets safe pH range between 6.5 and 9.0 for freshwater aquatic life.",
    url:          "https://air.emb.gov.ph/wp-content/uploads/2016/07/DAO-2016-08.pdf",
    official:     true,
  },
  Turbidity: {
    label:        "Turbidity",
    unit:         "NTU",
    min:          null,
    max:          50,
    warning:      null,
    standardLabel: "US EPA Aquatic Life Criteria",
    source:       "US EPA Surface Water Criteria (Warmwater Aquatic Life)",
    fullCitation: "US EPA State-Specific Water Quality Standards for Turbidity (Compilation of State & Tribal Criteria under the Clean Water Act). Limits stream & river turbidity to ≤ 50 NTU for warmwater aquatic habitats, with ≤ 10 NTU reserved for sensitive coldwater/lake environments.",
    url:          "https://www.epa.gov/system/files/documents/2022-01/list-of-state-specific-water-quality-standards.pdf",
    official:     false,
  },
  TDS: {
    label:        "TDS",
    unit:         "ppm",
    min:          null,
    max:          1000,
    warning:      null,
    standardLabel: "DENR DAO 1990-34 Standard",
    source:       "DENR DAO 1990-34 (Table 1: Surface Water Criteria)",
    fullCitation: "DENR Administrative Order No. 34, Series of 1990 (Section 69b / Table 1: Minimum Criteria for Surface Waters). Establishes the 1,000 mg/L (ppm) freshwater standard for Class A & Class D waters, used as the benchmark for general inland freshwater quality.",
    url:          "https://openjicareport.jica.go.jp/pdf/11948882_17.pdf",
    official:     true,
  },
  Temperature: {
    label:        "Temperature",
    unit:         "°C",
    min:          25.0,
    max:          31.0,
    warning:      null,
    standardLabel: "DENR Class C Limit",
    source:       "DENR DAO 2016-08 Table 3 (Class C: 25.0 – 31.0 °C)",
    fullCitation: "DENR Administrative Order No. 2016-08 (Table 3: Water Quality Guidelines for Class C Waters). Sets ambient water temperature guideline of 25.0 – 31.0 °C.",
    url:          "https://air.emb.gov.ph/wp-content/uploads/2016/07/DAO-2016-08.pdf",
    official:     true,
  },
};
