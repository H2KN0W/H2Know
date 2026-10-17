/**
 * Hardware Node Health Constants and Telemetry Decoding Utilities.
 * Sourced directly from firmware specifications:
 * - Controller Node (Master Node, ESP32): h2know_controller_node_v1_2_1.ino
 * - Sensor Node (Field Node, ATmega2560): h2know_sensor_node_v3_3.ino
 */

// ============================================================================
// TIMING CONSTANTS (Milliseconds)
// ============================================================================
/** Controller heartbeat interval: 10 minutes */
export const HEARTBEAT_INTERVAL_MS = 600000;

/** Sensor sampling cycle: 20 minutes (at :00, :20, :40) */
export const SENSOR_CYCLE_INTERVAL_MS = 1200000;

/** Status evaluation multiplier thresholds (applied to expected intervals) */
export const STATUS_THRESHOLDS = {
  ONLINE_MULTIPLIER: 2.0,   // <= 2x interval is Online
  DELAYED_MULTIPLIER: 5.0,  // <= 5x interval is Delayed, > 5x is Offline
};

export const NODE_STATUS_LABELS = {
  ONLINE: "Online",
  DELAYED: "Delayed",
  OFFLINE: "Offline",
};

/**
 * Evaluates node health status given the age of the last heartbeat/packet in milliseconds.
 *
 * @param {number|null} ageMs Age since last seen in milliseconds
 * @param {number} baseIntervalMs Expected interval (HEARTBEAT_INTERVAL_MS or SENSOR_CYCLE_INTERVAL_MS)
 * @returns {"Online" | "Delayed" | "Offline"}
 */
export function evaluateNodeStatus(ageMs, baseIntervalMs = HEARTBEAT_INTERVAL_MS) {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) {
    return NODE_STATUS_LABELS.OFFLINE;
  }
  if (ageMs <= baseIntervalMs * STATUS_THRESHOLDS.ONLINE_MULTIPLIER) {
    return NODE_STATUS_LABELS.ONLINE;
  }
  if (ageMs <= baseIntervalMs * STATUS_THRESHOLDS.DELAYED_MULTIPLIER) {
    return NODE_STATUS_LABELS.DELAYED;
  }
  return NODE_STATUS_LABELS.OFFLINE;
}

// ============================================================================
// QUALITY FLAGS (Sensor Node 8-bit mask: sensor_readings_raw.quality_flags)
// ============================================================================
export const QUALITY_FLAGS = {
  0x01: { key: "TEMP_BAD", label: "Temperature Sensor Disconnected / Invalid" },
  0x02: { key: "PH_SUSPECT", label: "pH Sensor Suspect (ADC out of range)" },
  0x04: { key: "TURB_SUSPECT", label: "Turbidity Sensor Suspect (ADC out of range)" },
  0x08: { key: "TDS_SUSPECT", label: "TDS Sensor Suspect (ADC < 3)" },
  0x10: { key: "RTC_BAD", label: "RTC Clock Bad (Lost power or invalid year)" },
  0x20: { key: "NOISY", label: "Sensor Signal Noisy (Sample spread > 60 ADC)" },
};

export function decodeQualityFlags(mask) {
  if (mask == null || mask === 0) return [];
  const results = [];
  for (const [bitStr, item] of Object.entries(QUALITY_FLAGS)) {
    const bit = Number(bitStr);
    if ((mask & bit) === bit) {
      results.push(item);
    }
  }
  return results;
}

// ============================================================================
// SENSOR RESET REASONS (ATmega2560 MCUSR register bitmask: sensor_reset_flags)
// ============================================================================
export const SENSOR_RESET_FLAGS = {
  0x01: "Power-on Reset (PORF)",
  0x02: "External Reset Pin (EXTRF)",
  0x04: "Brown-out Reset (BORF - voltage sag / pump inrush)",
  0x08: "Watchdog Reset (WDRF)",
};

export function decodeSensorResetFlags(val) {
  if (val == null) return "Unknown (no data)";
  if (val === 255 || val === 0xFF) return "Unknown (bootloader cleared register)";
  if (val === 0) return "Clean Startup (No flag set)";

  const matched = [];
  for (const [bitStr, label] of Object.entries(SENSOR_RESET_FLAGS)) {
    const bit = Number(bitStr);
    if ((val & bit) === bit) {
      matched.push(label);
    }
  }
  return matched.length > 0 ? matched.join(", ") : `Raw code 0x${val.toString(16).toUpperCase()}`;
}

// ============================================================================
// CONTROLLER RESET REASON (ESP32 esp_reset_reason_t enum: controller_reset_reason)
// ============================================================================
export const ESP32_RESET_REASONS = {
  1: "Power-on Reset (Vbat power on)",
  3: "Software Reset (esp_restart)",
  4: "Watchdog Reset (Legacy watchdog)",
  5: "Deep Sleep Wakeup",
  6: "SDIO Reset",
  7: "Timer Group 0 Watchdog",
  8: "Timer Group 1 Watchdog",
  9: "RTC Watchdog",
  11: "Task Watchdog (WDT triggered)",
  12: "Other Watchdog",
  13: "Brownout Reset (Software)",
  14: "Brownout Reset (Hardware supply dip)",
  15: "Glitch Reset",
};

export function decodeControllerResetReason(code) {
  if (code == null) return "Unknown";
  return ESP32_RESET_REASONS[code] || `Reset code ${code}`;
}

// ============================================================================
// SEQUENCE & PACKET LOSS CALCULATION
// ============================================================================
/**
 * Analyzes sequence numbers from raw readings to compute packet loss.
 *
 * @param {Array<{seq: number|null, recorded_at: string}>} rawReadings Sorted descending by recorded_at
 * @returns {{ lostPackets: number, receivedCount: number, expectedTotal: number, deliveryRate: number }}
 */
export function calculatePacketLoss(rawReadings = []) {
  const validSeqs = rawReadings
    .map((r) => r.seq)
    .filter((s) => s != null && Number.isFinite(s))
    .reverse(); // sort chronologically ascending

  if (validSeqs.length <= 1) {
    return {
      lostPackets: 0,
      receivedCount: validSeqs.length,
      expectedTotal: validSeqs.length,
      deliveryRate: 100,
    };
  }

  let lost = 0;
  for (let i = 1; i < validSeqs.length; i++) {
    const prev = validSeqs[i - 1];
    const curr = validSeqs[i];

    // Sequence numbers in firmware are uint8 (0..255)
    let diff = curr - prev;
    if (diff < 0) {
      diff += 256; // handle uint8 rollover
    }

    if (diff > 1) {
      lost += (diff - 1);
    }
  }

  const receivedCount = validSeqs.length;
  const expectedTotal = receivedCount + lost;
  const deliveryRate = expectedTotal > 0 ? Math.round((receivedCount / expectedTotal) * 1000) / 10 : 100;

  return {
    lostPackets: lost,
    receivedCount,
    expectedTotal,
    deliveryRate,
  };
}

/**
 * Infers the median heartbeat interval from observed node_status rows in milliseconds.
 *
 * @param {Array<{recorded_at: string}>} statuses Chronological or reverse list of status rows
 * @returns {number|null} Inferred interval in milliseconds, or null if insufficient rows
 */
export function inferHeartbeatInterval(statuses = []) {
  if (!statuses || statuses.length < 2) return null;

  const timestamps = statuses
    .map((s) => new Date(s.recorded_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (timestamps.length < 2) return null;

  const diffs = [];
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > 0) diffs.push(gap);
  }

  if (diffs.length === 0) return null;
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 !== 0 ? diffs[mid] : Math.round((diffs[mid - 1] + diffs[mid]) / 2);
}
