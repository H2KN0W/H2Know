import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDateRange,
  calculateStats,
  downsampleTimeSeries,
  insertGapMarkers,
  fetchAllPagedReadings,
  formatManilaDateTime,
  formatManilaChartTick,
} from "../src/lib/analyticsUtils.js";

test("normalizeDateRange: handles empty From and To with default view", () => {
  const result = normalizeDateRange("", "");
  assert.equal(result.isValid, true);
  assert.equal(result.error, null);
  assert.equal(result.isoFrom, null);
  assert.equal(result.isoTo, null);
  assert.equal(result.displayRange, "All available records");
});

test("normalizeDateRange: handles From only with inclusive start in UTC+8", () => {
  const result = normalizeDateRange("2026-10-16", "");
  assert.equal(result.isValid, true);
  assert.equal(result.isoFrom, "2026-10-16T00:00:00.000+08:00");
  assert.equal(result.isoTo, null);
  assert.equal(result.displayRange, "From 2026-10-16 onwards");
});

test("normalizeDateRange: handles To only with inclusive end of day in UTC+8", () => {
  const result = normalizeDateRange("", "2026-10-23");
  assert.equal(result.isValid, true);
  assert.equal(result.isoFrom, null);
  assert.equal(result.isoTo, "2026-10-23T23:59:59.999+08:00");
  assert.equal(result.displayRange, "Up to 2026-10-23");
});

test("normalizeDateRange: handles same-day From and To inclusively", () => {
  const result = normalizeDateRange("2026-10-19", "2026-10-19");
  assert.equal(result.isValid, true);
  assert.equal(result.isoFrom, "2026-10-19T00:00:00.000+08:00");
  assert.equal(result.isoTo, "2026-10-19T23:59:59.999+08:00");
  assert.equal(result.displayRange, "2026-10-19 to 2026-10-19");
});

test("normalizeDateRange: detects From later than To and returns validation error", () => {
  const result = normalizeDateRange("2026-10-25", "2026-10-19");
  assert.equal(result.isValid, false);
  assert.match(result.error, /cannot be later than To date/i);
});

test("calculateStats: computes Avg, Min, Max, and Median on filtered array", () => {
  const data = [
    { value: 10 },
    { value: 20 },
    { value: 30 },
    { value: 40 },
    { value: 50 },
  ];
  const stats = calculateStats(data);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 50);
  assert.equal(stats.average, 30);
  assert.equal(stats.median, 30);
  assert.equal(stats.count, 5);
});

test("calculateStats: computes even-length Median correctly", () => {
  const data = [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }];
  const stats = calculateStats(data);
  assert.equal(stats.median, 25);
  assert.equal(stats.average, 25);
});

test("calculateStats: handles empty or invalid arrays safely", () => {
  assert.equal(calculateStats([]), null);
  assert.equal(calculateStats(null), null);
  assert.equal(calculateStats([{ value: "invalid" }]), null);
});

test("downsampleTimeSeries: retains spikes and min/max extremes", () => {
  // Create 3000 points with a huge turbidity spike at index 1500
  const points = [];
  for (let i = 0; i < 3000; i++) {
    points.push({
      id: i,
      recorded_at: new Date(1760000000000 + i * 60000).toISOString(),
      value: i === 1500 ? 1400 : 5,
    });
  }

  const downsampled = downsampleTimeSeries(points, 2000);
  assert.ok(downsampled.length <= 2000);
  const maxVal = Math.max(...downsampled.map((d) => d.value));
  assert.equal(maxVal, 1400); // 1,400 NTU spike is preserved!
});

test("insertGapMarkers: detects gap greater than 3 hours and inserts null-value marker", () => {
  const t0 = new Date("2026-10-20T12:00:00+08:00").getTime();
  const t1 = new Date("2026-10-22T12:00:00+08:00").getTime(); // 48-hour gap

  const readings = [
    { id: 1, recorded_at: new Date(t0).toISOString(), value: 7.2 },
    { id: 2, recorded_at: new Date(t1).toISOString(), value: 7.4 },
  ];

  const marked = insertGapMarkers(readings);
  assert.equal(marked.length, 3);
  assert.equal(marked[0].value, 7.2);
  assert.equal(marked[1].value, null);
  assert.equal(marked[1].isGap, true);
  assert.equal(marked[2].value, 7.4);
});

test("insertGapMarkers: does not insert gap markers for normal 30-minute intervals", () => {
  const t0 = new Date("2026-10-20T12:00:00+08:00").getTime();
  const t1 = new Date("2026-10-20T12:30:00+08:00").getTime();

  const readings = [
    { id: 1, recorded_at: new Date(t0).toISOString(), value: 7.2 },
    { id: 2, recorded_at: new Date(t1).toISOString(), value: 7.4 },
  ];

  const marked = insertGapMarkers(readings);
  assert.equal(marked.length, 2);
});

test("fetchAllPagedReadings: simulates paging through multiple 1000-row chunks", async () => {
  // Mock Supabase client
  const fakeDatabase = [];
  for (let i = 0; i < 2500; i++) {
    fakeDatabase.push({
      id: i + 1,
      recorded_at: new Date(1760000000000 + i * 60000).toISOString(),
      value: 7.0 + (i % 10) * 0.1,
      parameter_id: "param-1",
    });
  }

  const mockSupabase = {
    from: () => ({
      select: () => {
        let fromIdx = 0;
        let toIdx = 999;
        const chain = {
          eq: () => chain,
          gte: () => chain,
          lte: () => chain,
          order: () => chain,
          range: (from, to) => {
            fromIdx = from;
            toIdx = to;
            return Promise.resolve({
              data: fakeDatabase.slice(fromIdx, toIdx + 1),
              error: null,
            });
          },
        };
        return chain;
      },
    }),
  };

  const results = await fetchAllPagedReadings(mockSupabase, {
    parameterId: "param-1",
    pageSize: 1000,
  });

  assert.equal(results.length, 2500);
  assert.equal(results[0].id, 1);
  assert.equal(results[2499].id, 2500);
});

test("formatManilaDateTime: formats accurately in Asia/Manila (UTC+8)", () => {
  // UTC 2026-10-19T08:00:00Z should be 2026-10-19 16:00 in Manila
  const utcIso = "2026-10-19T08:00:00.000Z";
  const formatted = formatManilaDateTime(utcIso);
  assert.equal(formatted, "19/10/2026 16:00");
});
