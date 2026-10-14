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

export const REFRESH_INTERVALS = {
  OFF: 0,
  FAST: 30000,   // 30s
  MEDIUM: 60000, // 1m
  SLOW: 300000,  // 5m
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
