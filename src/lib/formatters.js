/**
 * Shared date, time, and badge formatters for H2KNOW.
 * Eliminates redundant formatting functions across admin and manager views.
 */

/**
 * Format ISO date string to `YYYY-MM-DD HH:mm`
 */
export const formatDateTime = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

/**
 * Format ISO date string to `YYYY-MM-DD`
 */
export const formatDate = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Format timestamp into 12-hour digital clock time with AM/PM (e.g. `02:30:15 PM`)
 */
export const formatClockTime = (timestamp) => {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "—";
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const strHours = String(hours).padStart(2, "0");
  return `${strHours}:${minutes}:${seconds} ${ampm}`;
};

/**
 * Format ISO date string relative to current or specified checked time (e.g. `5 mins ago`)
 */
export const formatRelativeTime = (isoString, checkedAt) => {
  if (!isoString) return "No data yet";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "—";
  const now = checkedAt ? new Date(checkedAt) : new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 0 || isNaN(diffSec)) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(isoString);
};

/**
 * Maps severity labels to badge CSS classes.
 */
export const severityBadgeClass = (severity) => {
  const s = (severity || "").toLowerCase();
  if (s === "critical" || s === "danger") return "badge-failed";
  if (s === "warning") return "badge-warning";
  return "badge-normal";
};

/**
 * Format report parameters array for display (handles canonical array, legacy string, or empty)
 */
export const formatReportParameters = (params) => {
  if (!params || !Array.isArray(params) || params.length === 0) {
    return "All parameters";
  }
  if (params.includes("All Parameters") || params.length >= 4) {
    return "All parameters";
  }
  return params.join(", ");
};

