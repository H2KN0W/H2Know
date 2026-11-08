/**
 * src/utils/rangeSummary.js
 * Rule-based interpretation of actual stored readings for a user-selected date range.
 * No AI/API calls. Wording can be edited in this single place.
 */

import { DENR_CLASS_C_THRESHOLDS } from "../config/reportQualityConfig.js";

/**
 * Interpret summary statistics for a date range.
 * 
 * @param {Object} stats
 * @param {number} stats.totalDistinctReadings - count of distinct reading timestamps
 * @param {number} stats.days - number of calendar days in the range (inclusive)
 * @param {Object} stats.parameterStats - per-parameter stats:
 *   {
 *     [param]: {
 *       count: number,
 *       min: number,
 *       max: number,
 *       mean: number,
 *       latest: number,
 *       latestTime: string,
 *       safePercent: number, // % of readings within safe/Class C range
 *       criticalPercent: number, // % of readings in critical/danger tier
 *       warningPercent: number, // % of readings in warning tier
 *       trend: "up" | "down" | "steady" | "insufficient",
 *       unit: string,
 *     }
 *   }
 * @returns {Object} {
 *   overallStatus: "within" | "warning" | "concern",
 *   overallBadge: "Within limits" | "Needs attention" | "Concern",
 *   overallLine: string,
 *   parameterLines: { [param]: string },
 *   crossNote: string | null
 * }
 */
export function interpretRange(stats) {
  if (!stats || !stats.parameterStats) {
    return {
      overallStatus: "within",
      overallBadge: "Within limits",
      overallLine: "No data available for interpretation.",
      parameterLines: {},
      crossNote: null,
    };
  }

  const { parameterStats } = stats;
  const paramNames = Object.keys(parameterStats);

  let maxCriticalPercent = 0;
  let hasAnyCritical = false;
  let hasAnyWarningAbove5 = false;
  let allSafeAtLeast95 = true;
  let hasAnyValidParam = false;

  const parameterLines = {};

  for (const param of paramNames) {
    const p = parameterStats[param];
    if (!p || p.count < 5) {
      parameterLines[param] = "Not enough readings to summarize";
      continue;
    }

    hasAnyValidParam = true;

    if (p.safePercent < 95) {
      allSafeAtLeast95 = false;
    }
    if (p.warningPercent > 5) {
      hasAnyWarningAbove5 = true;
    }
    if (p.criticalPercent > 0) {
      hasAnyCritical = true;
    }
    if (p.criticalPercent > maxCriticalPercent) {
      maxCriticalPercent = p.criticalPercent;
    }

    // Build parameter sentence (maximum 20 words, cautious language, describes measurements)
    const unitStr = p.unit ? ` ${p.unit}` : "";
    const minFormatted = p.min.toFixed(param === "pH" ? 1 : 0);
    const maxFormatted = p.max.toFixed(param === "pH" ? 1 : 0);
    const meanFormatted = p.mean.toFixed(param === "pH" ? 2 : 1);

    const trendText =
      p.trend === "up"
        ? "rising toward the end"
        : p.trend === "down"
        ? "declining toward the end"
        : "holding steady";

    const limits = DENR_CLASS_C_THRESHOLDS[param];
    const isFullySafe = p.safePercent >= 99.5;

    let line = "";
    if (isFullySafe) {
      line = `${param} averaged ${meanFormatted}${unitStr} (${minFormatted} to ${maxFormatted}), staying within Class C limits, ${trendText}.`;
    } else if (p.safePercent >= 90) {
      line = `${param} averaged ${meanFormatted}${unitStr} (${minFormatted} to ${maxFormatted}), with ${p.safePercent.toFixed(0)}% of readings within safe limits, ${trendText}.`;
    } else {
      line = `${param} averaged ${meanFormatted}${unitStr} (${minFormatted} to ${maxFormatted}), showing ${p.safePercent.toFixed(0)}% safe compliance, ${trendText}.`;
    }

    // Ensure under 20 words
    const words = line.split(/\s+/);
    if (words.length > 20) {
      line = words.slice(0, 19).join(" ") + ".";
    }

    parameterLines[param] = line;
  }

  // Cross-parameter note: "Rising turbidity and TDS together can be linked to runoff or disturbance; check rainfall for these dates."
  let crossNote = null;
  const turb = parameterStats["Turbidity"];
  const tds = parameterStats["TDS"];
  if (turb && tds && turb.count >= 5 && tds.count >= 5) {
    if (turb.trend === "up" && tds.trend === "up") {
      crossNote = "Rising turbidity and TDS together can be linked to runoff or disturbance; check rainfall for these dates.";
    }
  }

  // Overall badge evaluation:
  // "Concern" (more than 10% of readings critical)
  // "Needs attention" (any warning share above 5% or any critical reading)
  // "Within limits" (at least 95% of readings safe and no critical reading)
  let overallBadge = "Within limits";
  let overallStatus = "within";

  if (!hasAnyValidParam) {
    overallBadge = "Within limits";
    overallStatus = "within";
  } else if (maxCriticalPercent > 10) {
    overallBadge = "Concern";
    overallStatus = "concern";
  } else if (hasAnyWarningAbove5 || hasAnyCritical || !allSafeAtLeast95) {
    overallBadge = "Needs attention";
    overallStatus = "warning";
  } else {
    overallBadge = "Within limits";
    overallStatus = "within";
  }

  const overallLine =
    overallBadge === "Within limits"
      ? "All monitored parameters remained within safe operating limits throughout this selected period."
      : overallBadge === "Needs attention"
      ? "Selected period shows elevated observations exceeding standard guidelines on monitored parameters."
      : "Selected period shows notable guideline excursions requiring review of water conditions.";

  return {
    overallStatus,
    overallBadge,
    overallLine,
    parameterLines,
    crossNote,
  };
}
