export const INSIGHT_PARAMETERS = ["pH", "TDS", "Turbidity", "Temperature"];
const PARAMETER_ALIASES = new Map([
  ["ph", "pH"],
  ["tds", "TDS"],
  ["total dissolved solids", "TDS"],
  ["turbidity", "Turbidity"],
  ["temperature", "Temperature"],
]);
const SEVERITY_RANK = { safe: 0, normal: 0, warning: 1, critical: 2, danger: 2 };
const CURRENT_MAX_AGE_MS = 65 * 60 * 1000;
const MAX_CURRENT_SPREAD_MS = 60 * 60 * 1000;
const MIN_TREND_READINGS_PER_HALF = 3;
const FORECAST_WINDOW_MS = 12 * 60 * 60 * 1000;
const FORECAST_STEP_MS = 30 * 60 * 1000;
const MIN_FORECAST_READINGS = 20;

export const canonicalParameterName = (name) =>
  PARAMETER_ALIASES.get(String(name || "").trim().toLowerCase()) || null;

export const validateInsightReading = (reading, now = Date.now()) => {
  const parameter = canonicalParameterName(reading?.parameters?.name);
  if (!parameter) return "Unknown parameter";

  if (reading?.value == null || String(reading.value).trim() === "") {
    return "Missing value";
  }
  const value = Number(reading.value);
  if (!Number.isFinite(value)) return "Value is not a finite number";

  if (parameter === "pH" && (value < 0 || value > 14)) {
    return "pH is outside the documented 0–14 scale";
  }
  if (parameter === "TDS" && value < 0) return "TDS cannot be negative";
  if (parameter === "Turbidity" && value < 0) return "Turbidity cannot be negative";
  if (parameter === "Temperature" && (value < -10 || value > 50)) {
    return "Temperature is outside the documented sensor range (-10–50 °C)";
  }

  const timestamp = new Date(reading.recorded_at).getTime();
  if (!Number.isFinite(timestamp)) return "Invalid timestamp";
  if (timestamp > now + 5 * 60 * 1000) return "Timestamp is in the future";
  return null;
};

const getParameterId = (item) => item.parameter_id || item.parameters?.id;
const readingsShareStation = (rows) => {
  const nodeIds = [...new Set(rows.map((reading) => reading.nodes?.id || reading.node_id).filter(Boolean))];
  if (nodeIds.length <= 1) return true;
  const locations = rows.map((reading) => String(reading.nodes?.location || "").trim().toLowerCase());
  return locations.every(Boolean) && new Set(locations).size === 1;
};
const getThresholdSeverity = (threshold) =>
  String(threshold.severity_label || "").trim().toLowerCase();

const matchesThreshold = (value, threshold) => {
  const minimum = threshold.min_value == null ? null : Number(threshold.min_value);
  const maximum = threshold.max_value == null ? null : Number(threshold.max_value);
  if (minimum != null && !Number.isFinite(minimum)) return false;
  if (maximum != null && !Number.isFinite(maximum)) return false;
  if (minimum == null && maximum == null) return false;
  return (minimum == null || value >= minimum) && (maximum == null || value <= maximum);
};

export const classifyInsightReading = (reading, thresholds) => {
  const parameter = canonicalParameterName(reading?.parameters?.name);
  const parameterThresholds = (thresholds || []).filter((threshold) => {
    if (getParameterId(threshold) !== getParameterId(reading)) return false;
    const minimum = threshold.min_value == null ? null : Number(threshold.min_value);
    const maximum = threshold.max_value == null ? null : Number(threshold.max_value);
    return (minimum != null || maximum != null) &&
      (minimum == null || Number.isFinite(minimum)) &&
      (maximum == null || Number.isFinite(maximum)) &&
      (minimum == null || maximum == null || minimum <= maximum);
  });
  if (!parameterThresholds.length) return { parameter, state: "unconfigured", label: null };

  const value = Number(reading.value);
  const matching = parameterThresholds
    .filter((threshold) => matchesThreshold(value, threshold))
    .sort((a, b) => {
      const aSpan = a.min_value == null || a.max_value == null
        ? Infinity
        : Number(a.max_value) - Number(a.min_value);
      const bSpan = b.min_value == null || b.max_value == null
        ? Infinity
        : Number(b.max_value) - Number(b.min_value);
      return aSpan - bSpan ||
        (SEVERITY_RANK[getThresholdSeverity(a)] ?? -1) -
        (SEVERITY_RANK[getThresholdSeverity(b)] ?? -1);
    });

  if (!matching.length) return { parameter, state: "outside", label: null, threshold: null };
  const label = getThresholdSeverity(matching[0]);
  const severity = SEVERITY_RANK[label];
  if (severity == null) return { parameter, state: "unknown", label, threshold: matching[0] };
  return {
    parameter,
    state: severity === 0 ? "within" : "exceeded",
    label,
    threshold: matching[0],
  };
};

const formatValue = (value) => Number(value).toLocaleString(undefined, {
  maximumFractionDigits: 2,
});

const formatReading = (item) => {
  const value = formatValue(item.reading.value);
  const unit = item.reading.parameters?.unit ? ` ${item.reading.parameters.unit}` : "";
  const band = item.comparison.state === "within"
    ? "within the configured safe band"
    : item.comparison.state === "exceeded"
      ? `in the configured ${item.comparison.label} band`
      : item.comparison.state === "outside"
        ? "outside all configured bands"
        : `in an unrecognized ${item.comparison.label || "unknown"} band`;
  return `${item.parameter} ${value}${unit} (${band})`;
};

const describeCurrentDataGap = ({ latest, latestIsFresh,
  readingsAreSynchronized, latestReadingsShareStation, allThresholdsConfigured,
  excluded, now }) => {
  const gaps = [];
  const allParametersPresent = latest.every((item) => item.reading);
  const missing = latest.filter((item) => !item.reading).map((item) => item.parameter);
  if (missing.length) {
    const missingDetails = missing.map((parameter) => {
      const invalidRows = excluded.filter((item) =>
        canonicalParameterName(item.reading?.parameters?.name) === parameter
      );
      const reasons = [...new Set(invalidRows.map((item) => item.reason))];
      return `no valid current reading for ${parameter}${invalidRows.length
        ? ` (${invalidRows.length} excluded: ${reasons.join(", ")})`
        : ""}`;
    });
    gaps.push(missingDetails.join("; "));
  }

  if (allParametersPresent && !latestIsFresh) {
    const stale = latest.filter((item) => now - new Date(item.reading.recorded_at).getTime() > CURRENT_MAX_AGE_MS);
    const details = stale.map((item) => {
      const ageMinutes = Math.max(0, Math.round((now - new Date(item.reading.recorded_at).getTime()) / 60000));
      return `${item.parameter} is ${ageMinutes} minutes old`;
    });
    gaps.push(`${details.join(", ")}; current readings must be no more than 65 minutes old`);
  }
  if (allParametersPresent && !readingsAreSynchronized) {
    const timestamps = latest.map((item) => new Date(item.reading.recorded_at).getTime());
    const spreadMinutes = Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 60000);
    gaps.push(`the four readings span ${spreadMinutes} minutes; they must span no more than 60 minutes`);
  }
  if (allParametersPresent && !latestReadingsShareStation) {
    const locations = [...new Set(latest.map((item) => item.reading.nodes?.location).filter(Boolean))];
    gaps.push(`the latest readings come from separate monitoring locations${locations.length ? ` (${locations.join(", ")})` : ""}`);
  }
  if (!allThresholdsConfigured) {
    const missingThresholds = latest.filter((item) =>
      item.reading && item.comparison && ["unconfigured", "unknown"].includes(item.comparison.state)
    ).map((item) => item.parameter);
    if (missingThresholds.length) gaps.push(`no usable recognized threshold band for ${missingThresholds.join(", ")}`);
  }
  return `Insufficient Data for Analysis: ${gaps.join("; ")}.`;
};

export const buildInsights = (readings, thresholds, now = Date.now()) => {
  const excluded = [];
  const valid = [];
  for (const reading of readings || []) {
    const reason = validateInsightReading(reading, now);
    if (reason) excluded.push({ reading, reason });
    else valid.push(reading);
  }

  const latestByParameter = new Map();
  for (const reading of valid) {
    const parameter = canonicalParameterName(reading.parameters?.name);
    const timestamp = new Date(reading.recorded_at).getTime();
    const existing = latestByParameter.get(parameter);
    if (!existing || timestamp > new Date(existing.recorded_at).getTime()) {
      latestByParameter.set(parameter, reading);
    }
  }

  const latest = INSIGHT_PARAMETERS.map((parameter) => {
    const reading = latestByParameter.get(parameter) || null;
    return {
      parameter,
      reading,
      comparison: reading ? classifyInsightReading(reading, thresholds) : null,
    };
  });
  const latestTimestamps = latest
    .filter((item) => item.reading)
    .map((item) => new Date(item.reading.recorded_at).getTime());
  const allParametersPresent = latest.every((item) => item.reading);
  const latestIsFresh = latestTimestamps.length === INSIGHT_PARAMETERS.length &&
    latestTimestamps.every((timestamp) => now - timestamp <= CURRENT_MAX_AGE_MS);
  const readingsAreSynchronized = latestTimestamps.length === INSIGHT_PARAMETERS.length &&
    Math.max(...latestTimestamps) - Math.min(...latestTimestamps) <= MAX_CURRENT_SPREAD_MS;
  const latestReadingsShareStation = latest.every((item) => item.reading) &&
    readingsShareStation(latest.map((item) => item.reading));
  const allThresholdsConfigured = latest.every((item) =>
    item.comparison && item.comparison.state !== "unconfigured" && item.comparison.state !== "unknown"
  );
  const assessmentAvailable = allParametersPresent && latestIsFresh &&
    readingsAreSynchronized && latestReadingsShareStation && allThresholdsConfigured;
  const exceeded = latest.filter((item) => item.comparison?.state === "exceeded");
  const outside = latest.filter((item) => item.comparison?.state === "outside");

  let status = "Insufficient Data for Analysis";
  if (assessmentAvailable) {
    status = exceeded.length || outside.length
      ? "Configured threshold exceedance"
      : "Within configured thresholds";
  }

  const reasons = [];
  if (!allParametersPresent) {
    reasons.push(`Latest valid readings are missing for ${latest.filter((item) => !item.reading).map((item) => item.parameter).join(", ")}.`);
  }
  if (allParametersPresent && !latestIsFresh) {
    reasons.push(describeCurrentDataGap({ latest, latestIsFresh, readingsAreSynchronized,
      latestReadingsShareStation, allThresholdsConfigured, excludedCount: excluded.length, now }));
  }
  if (allParametersPresent && !readingsAreSynchronized) {
    reasons.push("The latest parameter readings span more than one hour and may not describe the same conditions.");
  }
  if (allParametersPresent && !latestReadingsShareStation) {
    reasons.push("The latest readings come from different monitoring locations, so they cannot be combined into one station assessment.");
  }
  if (!allThresholdsConfigured) {
    const missing = latest.filter((item) => item.comparison &&
      ["unconfigured", "unknown"].includes(item.comparison.state));
    if (missing.length) reasons.push(`Usable configured thresholds are missing for ${missing.map((item) => item.parameter).join(", ")}.`);
  }

  const sortedValid = valid.slice().sort((a, b) =>
    new Date(b.recorded_at) - new Date(a.recorded_at)
  );
  const latestUsedAt = assessmentAvailable
    ? new Date(Math.min(...latestTimestamps)).toISOString()
    : null;

  let summary;
  if (!assessmentAvailable) {
    summary = describeCurrentDataGap({ latest, latestIsFresh,
      readingsAreSynchronized, latestReadingsShareStation, allThresholdsConfigured,
      excluded, now });
  } else {
    const outsideCount = exceeded.length + outside.length;
    const withinCount = INSIGHT_PARAMETERS.length - outsideCount;
    const exceptions = latest
      .filter((item) => item.comparison.state !== "within")
      .map(formatReading);
    summary = `At ${new Date(latestUsedAt).toLocaleString()}, ${withinCount} of 4 latest readings are within their configured safe bands${exceptions.length ? `; ${exceptions.join("; ")}` : ""}.`;
  }

  const trend = buildTrend(valid, thresholds, now);
  const prediction = buildPrediction(valid, thresholds, now);

  return {
    status,
    summary,
    reasons: assessmentAvailable ? [] : [summary],
    latest,
    assessmentAvailable,
    latestUsedAt,
    latestReceivedAt: sortedValid[0]?.recorded_at || null,
    validCount: valid.length,
    excludedCount: excluded.length,
    excludedReasons: excluded.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {}),
    trend,
    prediction,
  };
};

const buildTrend = (validReadings, thresholds, now) => {
  const windowStart = now - 7 * 24 * 60 * 60 * 1000;
  const inWindow = validReadings.filter((reading) =>
    new Date(reading.recorded_at).getTime() >= windowStart
  );
  if (!readingsShareStation(inWindow)) {
    return {
      label: "Not Enough Data to Determine Trend",
      period: null,
      detail: "Readings from multiple monitoring locations cannot be combined into one station trend.",
    };
  }
  const midpoint = now - 3.5 * 24 * 60 * 60 * 1000;
  const directions = [];
  const parameterResults = [];

  for (const parameter of INSIGHT_PARAMETERS) {
    const rows = inWindow.filter((reading) =>
      canonicalParameterName(reading.parameters?.name) === parameter
    );
    const early = rows.filter((reading) => new Date(reading.recorded_at).getTime() < midpoint);
    const recent = rows.filter((reading) => new Date(reading.recorded_at).getTime() >= midpoint);
    if (early.length < MIN_TREND_READINGS_PER_HALF || recent.length < MIN_TREND_READINGS_PER_HALF) {
      return {
        label: "Not Enough Data to Determine Trend",
        period: null,
        detail: `${parameter} has ${early.length} valid readings in the earlier period and ${recent.length} in the recent period; at least ${MIN_TREND_READINGS_PER_HALF} are required in each.`,
      };
    }

    const thresholdRows = thresholds.filter((threshold) =>
      getParameterId(threshold) === getParameterId(rows[0])
    );
    if (!thresholdRows.length) {
      return {
        label: "Not Enough Data to Determine Trend",
        period: null,
        detail: `Configured thresholds are missing for ${parameter}.`,
      };
    }

    const getPeriodStats = (periodRows) => {
      const classifiable = periodRows
        .map((reading) => classifyInsightReading(reading, thresholds).state)
        .filter((state) => ["within", "exceeded", "outside"].includes(state));
      if (classifiable.length < MIN_TREND_READINGS_PER_HALF) return null;
      const outsideCount = classifiable.filter((state) => state !== "within").length;
      return { outsideCount, count: classifiable.length, rate: outsideCount / classifiable.length };
    };
    const earlyStats = getPeriodStats(early);
    const recentStats = getPeriodStats(recent);
    if (earlyStats == null || recentStats == null) {
      return {
        label: "Not Enough Data to Determine Trend",
        period: null,
        detail: `${parameter} has ${earlyStats?.count || 0} classifiable earlier readings and ${recentStats?.count || 0} recent readings; at least ${MIN_TREND_READINGS_PER_HALF} are needed in each period.`,
      };
    }
    const { rate: earlyRate } = earlyStats;
    const { rate: recentRate } = recentStats;
    const direction = Math.sign(earlyRate - recentRate);
    directions.push(direction);
    const asPercent = (rate) => `${(rate * 100).toFixed(0)}%`;
    parameterResults.push({
      parameter,
      earlyOutside: earlyStats.outsideCount,
      earlyCount: earlyStats.count,
      earlyRate,
      recentOutside: recentStats.outsideCount,
      recentCount: recentStats.count,
      recentRate,
      changePercentagePoints: (recentRate - earlyRate) * 100,
      detail: `${parameter}: ${asPercent(earlyRate)} (${earlyStats.outsideCount}/${earlyStats.count}) to ${asPercent(recentRate)} (${recentStats.outsideCount}/${recentStats.count}) outside the safe band`,
    });
  }

  const uniqueDirections = new Set(directions);
  let label = "Conditions Show Inconsistent Changes";
  if (uniqueDirections.size === 1 && uniqueDirections.has(0)) label = "Conditions Remain Relatively Stable";
  else if (uniqueDirections.size === 1 && uniqueDirections.has(1)) label = "Conditions Appear to Be Improving";
  else if (uniqueDirections.size === 1 && uniqueDirections.has(-1)) label = "Conditions Appear to Be Worsening";

  const falling = directions.filter((direction) => direction > 0).length;
  const rising = directions.filter((direction) => direction < 0).length;
  const unchanged = directions.filter((direction) => direction === 0).length;
  const changes = [];
  if (falling) changes.push(`fell in ${falling} of 4 parameter series`);
  if (rising) changes.push(`rose in ${rising} of 4 parameter series`);
  if (unchanged) changes.push(`was unchanged in ${unchanged} of 4 parameter series`);

  const start = new Date(Math.min(...inWindow.map((reading) => new Date(reading.recorded_at).getTime())));
  const end = new Date(Math.max(...inWindow.map((reading) => new Date(reading.recorded_at).getTime())));
  return {
    label,
    period: `${start.toLocaleString()} to ${end.toLocaleString()}`,
    detail: `Share of readings outside configured safe bands ${changes.join(" and ")}.`,
    parameterResults,
  };
};

const fitLinearTrend = (rows) => {
  if (rows.length < 2) return null;
  const origin = new Date(rows[0].recorded_at).getTime();
  const points = rows.map((row) => ({
    x: (new Date(row.recorded_at).getTime() - origin) / 60000,
    y: Number(row.value),
  }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (!denominator) return null;
  const slope = points.reduce((sum, point) =>
    sum + (point.x - meanX) * (point.y - meanY), 0
  ) / denominator;
  return { slope, intercept: meanY - slope * meanX, origin };
};

const predictFromFit = (fit, timestamp) =>
  fit.intercept + fit.slope * ((timestamp - fit.origin) / 60000);

const buildPrediction = (validReadings, thresholds, now) => {
  const windowStart = now - FORECAST_WINDOW_MS;
  const forecastRows = [];
  const unavailableReasons = [];

  for (const parameter of INSIGHT_PARAMETERS) {
    const rows = validReadings
      .filter((reading) => canonicalParameterName(reading.parameters?.name) === parameter &&
        new Date(reading.recorded_at).getTime() >= windowStart)
      .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
    const span = rows.length > 1
      ? new Date(rows.at(-1).recorded_at).getTime() - new Date(rows[0].recorded_at).getTime()
      : 0;
    const intervals = rows.slice(1).map((row, index) =>
      new Date(row.recorded_at).getTime() - new Date(rows[index].recorded_at).getTime()
    );

    if (rows.length < MIN_FORECAST_READINGS || span < 9.5 * 60 * 60 * 1000) {
      unavailableReasons.push(`${parameter} has ${rows.length} valid readings over ${(span / 3600000).toFixed(1)} hours; at least ${MIN_FORECAST_READINGS} readings across 9.5 hours are required`);
      continue;
    }
    if (intervals.some((interval) => interval < 20 * 60 * 1000 || interval > 40 * 60 * 1000)) {
      unavailableReasons.push(`${parameter} readings are not consistently spaced 20–40 minutes apart`);
      continue;
    }

    const targetTime = new Date(rows.at(-1).recorded_at).getTime() + FORECAST_STEP_MS;
    const fit = fitLinearTrend(rows);
    if (!fit) {
      unavailableReasons.push(`${parameter} readings do not support a linear fit`);
      continue;
    }
    const predictedValue = predictFromFit(fit, targetTime);
    const measurementTemplate = rows.at(-1);
    const predictedReading = { ...measurementTemplate, value: predictedValue, recorded_at: new Date(targetTime).toISOString() };
    if (!Number.isFinite(predictedValue) || validateInsightReading(predictedReading, targetTime)) {
      unavailableReasons.push(`${parameter} extrapolation falls outside its documented valid range`);
      continue;
    }

    const validationPredictions = [];
    for (let index = rows.length - 4; index < rows.length; index++) {
      const training = rows.slice(0, index);
      const validationTime = new Date(rows[index].recorded_at).getTime();
      const validationFit = fitLinearTrend(training);
      if (validationFit) {
        validationPredictions.push(Math.abs(
          predictFromFit(validationFit, validationTime) - Number(rows[index].value)
        ));
      }
    }
    if (validationPredictions.length < 4) {
      unavailableReasons.push(`${parameter} does not have four readings available for a backtest`);
      continue;
    }

    const comparison = classifyInsightReading(predictedReading, thresholds);
    forecastRows.push({
      parameter,
      value: predictedValue,
      unit: measurementTemplate.parameters?.unit || "",
      forecastAt: new Date(targetTime).toISOString(),
      comparison,
      meanAbsoluteError: validationPredictions.reduce((sum, value) => sum + value, 0) / validationPredictions.length,
      validationCount: validationPredictions.length,
    });
  }

  if (unavailableReasons.length || forecastRows.length !== INSIGHT_PARAMETERS.length) {
    return {
      available: false,
      rows: [],
      forecastAt: null,
      validationMethod: null,
      message: `Prediction Unavailable: ${unavailableReasons.join("; ") || "valid forecast data are incomplete"}.`,
    };
  }

  return {
    available: true,
    rows: forecastRows,
    validationMethod: "Linear regression over each parameter’s latest 12 hours; one-step-ahead backtest against its four most recent readings.",
    message: `Each estimate is 30 minutes beyond that parameter’s latest valid reading. Backtest errors use observed values and are shown as mean absolute error in the parameter’s unit. Estimates are not measurements.`,
  };
};
