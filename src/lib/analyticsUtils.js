/**
 * analyticsUtils.js
 * Pure logic and helper utilities for Manager Analytics & Trends.
 */

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const ASIA_MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8

/**
 * Returns Date object or timestamp for ISO string in Asia/Manila (UTC+8).
 * Note: standard JavaScript Date works in local or UTC. When displaying in Manila,
 * we can format using Intl.DateTimeFormat with timeZone: 'Asia/Manila'.
 */
export const MANILA_TIMEZONE = "Asia/Manila";

/**
 * Formats an ISO date string into DD/MM/YYYY HH:mm in Asia/Manila.
 */
export const formatManilaDateTime = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MANILA_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d).replace(",", "");
};

/**
 * Formats an ISO date string into MM/DD HH:mm for compact chart x-axis in Asia/Manila.
 */
export const formatManilaChartTick = (isoString) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const p = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
};

/**
 * Normalizes Date Range filters from user inputs (YYYY-MM-DD strings from <input type="date">).
 * Ensures:
 * 1. Inclusive start of day in Asia/Manila (00:00:00.000+08:00).
 * 2. Inclusive end of day in Asia/Manila (23:59:59.999+08:00).
 * 3. Validation when dateFrom > dateTo.
 * 4. Automatic ISO string generation for Supabase gte/lte queries.
 */
export const normalizeDateRange = (rawFrom, rawTo) => {
  const fromClean = rawFrom ? String(rawFrom).trim().slice(0, 10) : "";
  const toClean = rawTo ? String(rawTo).trim().slice(0, 10) : "";

  if (fromClean && toClean && fromClean > toClean) {
    return {
      isValid: false,
      error: "From date cannot be later than To date.",
      isoFrom: null,
      isoTo: null,
      displayRange: "",
    };
  }

  // Convert to ISO with explicit Asia/Manila (+08:00) offset
  const isoFrom = fromClean ? `${fromClean}T00:00:00.000+08:00` : null;
  const isoTo = toClean ? `${toClean}T23:59:59.999+08:00` : null;

  let displayRange = "";
  if (fromClean && toClean) {
    displayRange = `${fromClean} to ${toClean}`;
  } else if (fromClean) {
    displayRange = `From ${fromClean} onwards`;
  } else if (toClean) {
    displayRange = `Up to ${toClean}`;
  } else {
    displayRange = "All available records";
  }

  return {
    isValid: true,
    error: null,
    isoFrom,
    isoTo,
    displayRange,
  };
};

/**
 * Calculates Avg, Min, Max, and Median on an array of sensor reading items.
 * Guaranteed to operate on raw numbers without cutting off or crashing on nulls.
 */
export const calculateStats = (readingList = []) => {
  if (!Array.isArray(readingList) || readingList.length === 0) return null;

  const values = readingList
    .map((item) => Number(item?.value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!values.length) return null;

  const count = values.length;
  const min = values[0];
  const max = values[count - 1];

  const middle = Math.floor(count / 2);
  const median =
    count % 2 !== 0
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2;

  const sum = values.reduce((acc, v) => acc + v, 0);
  const average = sum / count;

  return {
    min,
    max,
    median,
    average,
    count,
  };
};

/**
 * Downsamples time-series data while preserving Min, Max, and temporal extremes (Peak-Preserving Bucketing).
 * Only activates if points count exceeds maxPoints (default 2,000).
 * Assumes chronological ordering.
 */
export const downsampleTimeSeries = (items = [], maxPoints = 2000) => {
  if (!items || items.length <= maxPoints) return items;

  // We want to reduce items to approximately maxPoints.
  // We divide the array into chunks of size K.
  // In each chunk, we preserve the first, minimum, maximum, and last points in chronological order.
  const targetChunks = Math.floor(maxPoints / 4);
  const chunkSize = Math.max(2, Math.ceil(items.length / targetChunks));

  const result = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    if (chunk.length <= 4) {
      result.push(...chunk);
      continue;
    }

    let minItem = chunk[0];
    let maxItem = chunk[0];
    let minIdx = 0;
    let maxIdx = 0;

    for (let c = 0; c < chunk.length; c++) {
      const val = Number(chunk[c].value);
      if (val < Number(minItem.value)) {
        minItem = chunk[c];
        minIdx = c;
      }
      if (val > Number(maxItem.value)) {
        maxItem = chunk[c];
        maxIdx = c;
      }
    }

    // Pick unique indices from chunk: first (0), min, max, last (chunk.length - 1)
    const indices = Array.from(new Set([0, minIdx, maxIdx, chunk.length - 1])).sort((a, b) => a - b);
    for (const idx of indices) {
      result.push(chunk[idx]);
    }
  }

  return result;
};

/**
 * Injects synthetic null points across gaps larger than gapThresholdMs (default 3 hours)
 * so that Recharts line charts do not draw a continuous line over missing periods.
 * Items must be sorted chronologically by recorded_at ascending.
 */
export const insertGapMarkers = (items = [], gapThresholdMs = THREE_HOURS_MS) => {
  if (!items || items.length < 2) return items || [];

  const processed = [];

  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    processed.push(current);

    if (i < items.length - 1) {
      const next = items[i + 1];
      const curTime = new Date(current.recorded_at).getTime();
      const nextTime = new Date(next.recorded_at).getTime();

      if (Number.isFinite(curTime) && Number.isFinite(nextTime) && nextTime - curTime > gapThresholdMs) {
        // Insert a null-valued synthetic point right after current and right before next
        const midTime = new Date(curTime + 1000).toISOString();
        processed.push({
          id: `gap-${current.id || i}`,
          recorded_at: midTime,
          value: null,
          isGap: true,
        });
      }
    }
  }

  return processed;
};

/**
 * Paged loader helper for Supabase queries.
 * Queries Supabase using `.range(fromIndex, toIndex)` in chunks of `pageSize` (default 1000)
 * in ascending order of recorded_at, id until a chunk is shorter than pageSize.
 * 
 * @param {Function} buildQuery - function returning a Supabase query builder configured with filters
 * @param {number} pageSize - default 1000
 * @returns {Promise<Array>} all combined rows
 */
export const fetchAllPagedReadings = async (supabaseClient, { parameterId, isoFrom, isoTo, pageSize = 1000 }) => {
  let allReadings = [];
  let fromIndex = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabaseClient
      .from("sensor_readings")
      .select(
        "id, value, source, recorded_at, parameter_id, parameters ( name, unit ), nodes ( device_label )"
      );

    if (parameterId && parameterId !== "all") {
      query = query.eq("parameter_id", parameterId);
    }
    if (isoFrom) {
      query = query.gte("recorded_at", isoFrom);
    }
    if (isoTo) {
      query = query.lte("recorded_at", isoTo);
    }

    // Deterministic ordering: recorded_at ascending, then id ascending
    query = query
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIndex, fromIndex + pageSize - 1);

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const chunk = data || [];
    allReadings = allReadings.concat(chunk);

    if (chunk.length < pageSize) {
      hasMore = false;
    } else {
      fromIndex += pageSize;
    }
  }

  // De-duplicate in case of any overlap
  const seenIds = new Set();
  const deduped = [];
  for (const r of allReadings) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id);
      deduped.push(r);
    }
  }

  return deduped;
};
