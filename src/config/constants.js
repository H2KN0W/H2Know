/**
 * Application constants and configuration tokens.
 * Single source of truth for fixed roles, polling intervals, page sizes,
 * error messages, and parameters across H2KNOW.
 */

export const USER_ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
};

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
