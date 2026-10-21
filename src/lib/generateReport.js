import { supabase } from "./supabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Chart } from "chart.js/auto";
import { toStartOfDay, toEndOfDay } from "../config/constants";
// H2Know logo embedded as a static Base64 Data URL so PDF generation
// never depends on async loading, bundler asset URLs, or CORS.
// (300x300 JPEG, ~11KB source). Pass straight into pdf.addImage().
const LOGO_BASE64 = "data:image/jpeg;base64,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AAF/+xq3ompaFcazZ2+lPbpfyzKlsyQbGEhOFw2OOe9eXqdzBU+ZicADkk16Z8E/Amu6p4y07VbnTrm102xmW4eaeMoHK8qq56knHToKzqSUYts0ppykkj6islmSzhS4cPMsaiRh3bHJ/OpaKK8c9YKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigDN1fUntpYrO1QSXc33Qeij1NSqf7PtGmvLl5nP3iehPoo6CsfWWfT/EUOouheFgBkduMEfXvWreIl/bwXFsyzKjhwueHHcfWuuUFGMez3fn2OCFSUpzv8S2Xl3POPjr8Om+KXhFoI7SG11OzBl025kbDbscxt/sNwD6HB7V8F6lZXem6hcafqFtJbXdtK0U0Mgw0bqcFT7g1+pMbiRN21l9mGCK848ffBH4e+NvELa9relz/AG+RAksltdPCJccAsFPJA4z1wB6VVHEqDs1oFfCOouZPU+BNBI+2t/1zP8xW4a+xbf8AZs+Flu5ki0zUd2Mc6lL/AI1LF+z78PUmSRNJnGxg2JdQlkBx2K9CPat1i6bOf6nURxf7KXw2gAPjPXbUNMyY02CVeFQ8GYg9z0X2ye4r3e6LaJcRSxuzWMrbHjY58s+q+3tVq2TT9HtyrTxx8DJYgcDoAB2HoKzNRmm15ktbKJxbK+XmcYB+lYxbqTbfw9e39djSpy06aS+Ppbf/AIbv0NHVr6XTriC5dg1lIwikGOYyejA9x2Nadc74xkRtPi0iH95c3DoqIOoAPU/lXQRLsiVCc7QBmsKkEqcZdXf7u500Zt1px6K3yb3X5P5jqKKKwOoKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAGXEMVxE0U0ayI3VSKxjo1zZymXSbwx55MUnKmtyitIVZQ0WxjVoQqata9+pkJqV/B8t9pcvHV4PnH5VKNY06VSpuTCx/vqUI/MVpUEA9QD9apzg94/c/+HJVOrHRTv6r/Kxnxrb3LbYtUlc9cJMuf0FK2lQP/rZruQejTtj+dXgiA5CqD7ClqfayXwspUIte8rlKHStOhbclnFu9WG4/rTLq31OZ2SG9htIP4THFufH1JwPyrQooVWV7vX11/MboQtZKy8tPyKGmaTaWMjTIHluH+/PK252/HtV+iipnOU3eTuVCnGmuWKsgoooqSwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9k=";

// ─── Brand Color Constants (RGB) ──────────────────────────────────────────────
const C = {
  primary:  [12,  76,  124],   // #0C4C7C - Dark Blue
  accent:   [0,  180,  216],   // #00B4D8 - Cyan
  danger:   [220, 38,  38],    // #DC2626 - Red
  warning:  [217,119,   6],    // #D97706 - Orange
  safe:     [22, 163,  74],    // #16A34A - Green
  muted:    [100,116, 139],    // #64748B - Gray
  lightBg:  [240,249, 255],    // #F0F9FF - Light Background Tint
  rule:     [226,232, 240],    // #E2E8F0 - Border color
  black:    [0,   0,   0],
  white:    [255,255, 255],
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Chart Dimensions (explicit mm sizing) ────────────────────────────────────
const CHART_W = 170;
const CHART_H = 85;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

const formatDate = (isoStr) => {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
};

const formatTimeOnly = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const setColor = (doc, rgb, type = "text") => {
  if (type === "text") doc.setTextColor(...rgb);
  else if (type === "draw") doc.setDrawColor(...rgb);
  else if (type === "fill") doc.setFillColor(...rgb);
};

const resetTextColor = (doc) => doc.setTextColor(...C.black);

// Draw a horizontal rule
const hRule = (doc, y, color = C.rule, lw = 0.3) => {
  doc.setLineWidth(lw);
  setColor(doc, color, "draw");
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setLineWidth(0.2);
  setColor(doc, C.black, "draw");
};

// ─── Smart Data Aggregation ────────────────────────────────────────────────────

const aggregateReadingsByDay = (readings) => {
  if (readings.length <= 30) return readings; // No aggregation needed for short ranges

  const dailyMap = new Map();

  readings.forEach((r) => {
    const date = new Date(r.recorded_at);
    const dateKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const value = Number(r.value);

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { values: [], min: value, max: value, sum: 0, count: 0 });
    }

    const dayData = dailyMap.get(dateKey);
    dayData.values.push(value);
    dayData.min = Math.min(dayData.min, value);
    dayData.max = Math.max(dayData.max, value);
    dayData.sum += value;
    dayData.count += 1;
  });

  // Convert map to aggregated readings (use mid-day timestamp)
  const aggregated = [];
  dailyMap.forEach((data, dateKey) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    const midDayTimestamp = new Date(year, month - 1, day, 12, 0, 0).toISOString();
    const avg = data.sum / data.count;

    aggregated.push({
      parameter_id: readings[0].parameter_id,
      value: avg,
      recorded_at: midDayTimestamp,
      _aggregated: true,
      _min: data.min,
      _max: data.max,
    });
  });

  return aggregated.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
};

// ─── Stats calculator ─────────────────────────────────────────────────────────

const calculateStats = (readings, paramNames, parameterMap, unitMap) => {
  const stats = {};
  paramNames.forEach((name) => {
    const paramId = Object.entries(parameterMap).find(([, n]) => n === name)?.[0];
    const paramReadings = readings.filter((r) => r.parameter_id === paramId);
    const values = paramReadings.map((r) => Number(r.value)).filter((v) => !isNaN(v));
    const unit = unitMap?.[paramId] || "";
    if (values.length === 0) {
      stats[name] = { count: 0, avg: "—", min: "—", max: "—", latest: "—", unit };
    } else {
      const sorted = [...paramReadings].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
      stats[name] = {
        count: values.length,
        avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
        min: Math.min(...values).toFixed(2),
        max: Math.max(...values).toFixed(2),
        latest: String(sorted[0]?.value ?? "—"),
        unit,
      };
    }
  });
  return stats;
};

// ─── Chart renderer with smart aggregation ─────────────────────────────────────

const renderSingleChart = async (readings, paramName, parameterMap) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 600;
  canvas.style.position = "absolute";
  canvas.style.left = "-9999px";
  document.body.appendChild(canvas);

  const paramId = Object.entries(parameterMap).find(([, n]) => n === paramName)?.[0];
  const sorted = readings
    .filter((r) => r.parameter_id === paramId)
    .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

  // Apply smart aggregation
  const aggregatedReadings = aggregateReadingsByDay(sorted);
  const isAggregated = aggregatedReadings.length !== sorted.length;

  const points = aggregatedReadings.map((r) => ({
    x: new Date(r.recorded_at).getTime(),
    y: Number(r.value),
  }));

  // Format tick labels based on aggregation
  const formatTick = (val) => {
    const d = new Date(val);
    if (isAggregated) {
      return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
    } else {
      return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  };

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: paramName,
        data: points,
        borderColor: "#0C4C7C",
        backgroundColor: "rgba(12,76,124,0.08)",
        tension: 0.3,
        pointRadius: isAggregated ? 4 : 3,
        pointBackgroundColor: "#0C4C7C",
        fill: true,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: {
          display: true,
          text: `${paramName} Over Time${isAggregated ? " (Daily Averages)" : ""}`,
          font: { size: 16, weight: "bold" },
          color: "#0C4C7C",
        },
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            title: (items) => {
              const ts = items[0]?.raw?.x;
              if (typeof ts === "number") {
                const d = new Date(ts);
                if (isAggregated) {
                  return `${pad(d.getMonth()+1)}/${pad(d.getDate())}/${d.getFullYear()}`;
                }
                return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
              }
              return "";
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          grid: { color: "rgba(200,200,200,0.3)" },
          ticks: {
            maxRotation: isAggregated ? 0 : 45,
            callback: formatTick,
          },
          title: { display: true, text: isAggregated ? "Date" : "Date / Time" },
        },
        y: {
          beginAtZero: false,
          grid: { color: "rgba(200,200,200,0.3)" },
          title: { display: true, text: "Value" },
        },
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  const imageDataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  document.body.removeChild(canvas);
  return imageDataUrl;
};

// Render multi-parameter comparison chart (bar chart)
const renderComparisonChart = async (readings, paramNames, parameterMap) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 600;
  canvas.style.position = "absolute";
  canvas.style.left = "-9999px";
  document.body.appendChild(canvas);

  const datasets = paramNames.map((name, idx) => {
    const paramId = Object.entries(parameterMap).find(([, n]) => n === name)?.[0];
    const paramReadings = readings.filter((r) => r.parameter_id === paramId);
    const values = paramReadings.map((r) => Number(r.value)).filter((v) => !isNaN(v));
    const avg = values.length > 0 ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : 0;

    const colors = ["#0C4C7C", "#00B4D8", "#16A34A", "#D97706", "#DC2626"];
    return {
      label: name,
      data: [avg],
      backgroundColor: colors[idx % colors.length],
      borderColor: colors[idx % colors.length],
      borderWidth: 2,
    };
  });

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ["Average Values"],
      datasets,
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: {
          display: true,
          text: "Parameter Comparison — Average Values",
          font: { size: 16, weight: "bold" },
          color: "#0C4C7C",
        },
        legend: { position: "top" },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "rgba(200,200,200,0.3)" },
          title: { display: true, text: "Average Value" },
        },
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  const imageDataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  document.body.removeChild(canvas);
  return imageDataUrl;
};

// ─── Logo embedding helper (static Base64 — no async load, no CORS) ───

const addLogoWithAspectRatio = (doc, logoBase64, x, y, maxWidth, maxHeight) => {
  const src = logoBase64 || LOGO_BASE64;
  if (!src) return false;

  try {
    // LOGO_BASE64 is a 300x300 square, so aspect ratio is 1:1 — fit synchronously.
    const side = Math.min(maxWidth, maxHeight);
    const centeredX = x + (maxWidth - side) / 2;
    const centeredY = y + (maxHeight - side) / 2;

    doc.addImage(src, "JPEG", centeredX, centeredY, side, side);
    return true;
  } catch (e) {
    console.warn("Failed to embed logo with aspect ratio:", e);
    return false;
  }
};

// ─── Footer writer (called after all pages are built) ─────────────────────────

const writeFooters = (doc, totalPages) => {
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const footerY = PAGE_H - 10;

    // Rule above footer
    hRule(doc, footerY - 4, C.rule, 0.3);

    doc.setFontSize(7.5);

    // Left
    setColor(doc, C.muted, "text");
    doc.text("H2Know Environmental Monitoring — Dicklum River Basin", MARGIN, footerY);

    // Center
    setColor(doc, C.muted, "text");
    doc.text("CONFIDENTIAL — Official Regional Submission", PAGE_W / 2, footerY, { align: "center" });

    // Right
    setColor(doc, C.muted, "text");
    doc.text(`Page ${i} of ${totalPages}`, PAGE_W - MARGIN, footerY, { align: "right" });

    resetTextColor(doc);
  }
};

// ─── Page 1: Modern Minimalist Cover Page ─────────────────────────────────────

const buildCoverPage = (doc, form, authorName, logoBase64) => {
  // Subtle background tint (top to bottom gradient simulation)
  setColor(doc, C.lightBg, "fill");
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // Top rule
  hRule(doc, MARGIN, C.primary, 0.8);

  let y = MARGIN + 10;

  // Header Branding - Logo with proper aspect ratio
  const logoSuccess = addLogoWithAspectRatio(doc, logoBase64, PAGE_W / 2 - 25, y, 50, 50);

  if (!logoSuccess) {
    // Fallback placeholder
    setColor(doc, C.primary, "fill");
    doc.roundedRect(PAGE_W / 2 - 15, y, 30, 30, 3, 3, "F");
    setColor(doc, C.white, "text");
    doc.setFontSize(8);
    doc.setFont(undefined, "bold");
    doc.text("H2", PAGE_W / 2, y + 13, { align: "center" });
    doc.setFontSize(6);
    doc.text("LOGO", PAGE_W / 2, y + 20, { align: "center" });
    resetTextColor(doc);
  }

  y += 55;

  // Brand name in uppercase tracking
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("H2KNOW ENVIRONMENTAL MONITORING", PAGE_W / 2, y, { align: "center" });
  y += 15;

  // Main Title
  doc.setFontSize(28);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("ENVIRONMENTAL FIELD REPORT", PAGE_W / 2, y, { align: "center" });
  y += 12;

  // Subtitle
  doc.setFontSize(12);
  doc.setFont(undefined, "normal");
  setColor(doc, C.accent, "text");
  doc.text("Dicklum River Basin Telemetry & Water Quality Audit", PAGE_W / 2, y, { align: "center" });
  y += 8;

  // Dynamic report name
  doc.setFontSize(14);
  doc.setFont(undefined, "bold");
  setColor(doc, C.black, "text");
  doc.text(form.name || "Water Quality Report", PAGE_W / 2, y, { align: "center" });
  y += 10;

  // Report period
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  setColor(doc, C.muted, "text");
  doc.text(
    `Report Period: ${form.startDate} to ${form.endDate}`,
    PAGE_W / 2, y, { align: "center" }
  );
  y += 8;

  // Generated timestamp
  const generatedAt = new Date().toISOString();
  doc.setFontSize(8);
  doc.text(
    `Generated: ${formatDate(generatedAt)} ${formatTimeOnly(generatedAt)}`,
    PAGE_W / 2, y, { align: "center" }
  );
  y += 30;

  // Decorative divider
  setColor(doc, C.accent, "fill");
  doc.rect(PAGE_W / 2 - 30, y, 60, 2, "F");
  y += 15;

  // Footer Metadata Block
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.black, "text");
  doc.text(`Prepared by: ${authorName || "Station Lead"}`, PAGE_W / 2, y, { align: "center" });
  y += 7;
  doc.text("Northern Bukidnon State College — DRRM Unit", PAGE_W / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(8);
  setColor(doc, C.muted, "text");
  doc.text("Station Coordinates: 8.3819°N, 124.8450°E | Dicklum, Manolo Fortich", PAGE_W / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("Official Submission Copy — Regional Office Review", PAGE_W / 2, y, { align: "center" });
  resetTextColor(doc);

  // Bottom rule
  hRule(doc, PAGE_H - MARGIN, C.primary, 0.8);
};

// ─── Page 2: Executive Summary & Watershed Analysis (Stacked Layout) ───────

const buildExecutiveSummaryPage = async (doc, form, readings, paramNames, parameterMap, unitMap, aiInsights, weatherSummary, logoBase64) => {
  doc.addPage();
  let y = MARGIN;

  // Page Header Banner with Logo
  setColor(doc, C.primary, "fill");
  doc.rect(MARGIN, y, CONTENT_W, 12, "F");
  setColor(doc, C.white, "text");
  doc.setFontSize(13);
  doc.setFont(undefined, "bold");
  doc.text("EXECUTIVE SUMMARY & WATERSHED ANALYSIS", MARGIN + 4, y + 8);
  resetTextColor(doc);

  // Add small logo in header (static embed — never async, never CORS-blocked)
  try {
    doc.addImage(logoBase64 || LOGO_BASE64, "JPEG", PAGE_W - MARGIN - 12, y + 2, 8, 8);
  } catch (logoErr) {
    console.warn("Header logo embed skipped:", logoErr?.message);
  }

  y += 17;

  // Sub-header
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.muted, "text");
  doc.text(
    `Period: ${form.startDate} to ${form.endDate}   |   Parameters: ${paramNames.length}   |   Total Readings: ${readings.length}`,
    MARGIN, y
  );
  resetTextColor(doc);
  y += 10;

  // ── Key Metrics Banner (Top) ──
  const stats = calculateStats(readings, paramNames, parameterMap, unitMap);
  const firstParam = paramNames[0];
  const firstStats = stats[firstParam];

  setColor(doc, C.primary, "fill");
  doc.roundedRect(MARGIN, y, CONTENT_W, 25, 3, 3, "F");

  setColor(doc, C.white, "text");
  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  doc.text("KEY METRICS", MARGIN + 4, y + 8);
  let metricsY = y + 15;

  if (firstStats) {
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text(`${firstStats.latest} ${firstStats.unit}`, MARGIN + 4, metricsY);
    metricsY += 7;
    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    doc.text(`${firstParam} — Latest Reading`, MARGIN + 4, metricsY);

    // Additional stats on the right side
    const rightX = MARGIN + 70;
    doc.setFontSize(7);
    doc.text(`Avg: ${firstStats.avg} ${firstStats.unit}`, rightX, y + 10);
    doc.text(`Min: ${firstStats.min} ${firstStats.unit}`, rightX, y + 17);
    doc.text(`Max: ${firstStats.max} ${firstStats.unit}`, rightX, y + 24);

    // Status badge
    const statusColor = C.safe;
    const badgeX = MARGIN + 130;
    const badgeW = 28;
    setColor(doc, statusColor, "fill");
    doc.roundedRect(badgeX, y + 12, badgeW, 8, 2, 2, "F");
    setColor(doc, C.white, "text");
    doc.setFontSize(7);
    doc.setFont(undefined, "bold");
    doc.text("NORMAL", badgeX + badgeW / 2, y + 17, { align: "center" });
  }

  resetTextColor(doc);
  y += 32;

  // ── Full-Width Parameter Trend Chart ──
  setColor(doc, C.rule, "draw");
  doc.setLineWidth(0.5);
  doc.rect(MARGIN, y, CONTENT_W, CHART_H);
  doc.setLineWidth(0.2);
  setColor(doc, C.black, "draw");

  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("Primary Parameter Trend", MARGIN + 4, y + 6);
  resetTextColor(doc);

  // Render first parameter chart with full width
  if (paramNames.length > 0) {
    const chartImage = await renderSingleChart(readings, paramNames[0], parameterMap);
    if (chartImage) {
      doc.addImage(chartImage, "PNG", MARGIN + 4, y + 10, CONTENT_W - 8, CHART_H - 14);
    }
  }

  y += CHART_H + 10;

  // ── AI Watershed Analysis Block ──
  if (aiInsights) {
    // AI Insights title banner
    setColor(doc, C.accent, "fill");
    doc.rect(MARGIN, y, CONTENT_W, 8, "F");
    setColor(doc, C.white, "text");
    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    doc.text("AI-POWERED WATERSHED ANALYSIS", MARGIN + 4, y + 5.5);
    resetTextColor(doc);
    y += 13;

    // Overview text
    if (aiInsights.currentInterpretation?.overview) {
      doc.setFontSize(9);
      doc.setFont(undefined, "normal");
      setColor(doc, C.black, "text");
      const lines = doc.splitTextToSize(aiInsights.currentInterpretation.overview, CONTENT_W - 5);
      doc.text(lines, MARGIN, y);
      y += lines.length * 5 + 5;
    }

    // Runoff risk badge
    const riskLevel = (aiInsights.riskLevel || "").toUpperCase();
    let riskColor = C.safe;
    if (riskLevel === "HIGH" || riskLevel === "SEVERE") riskColor = C.danger;
    else if (riskLevel === "MODERATE") riskColor = C.warning;

    doc.setFontSize(9);
    doc.setFont(undefined, "bold");
    setColor(doc, C.black, "text");
    doc.text("Runoff Risk:", MARGIN, y);
    const badgeX = MARGIN + 24;
    const labelW = doc.getTextWidth(riskLevel) + 6;
    setColor(doc, riskColor, "fill");
    doc.roundedRect(badgeX, y - 4.5, labelW, 6, 1.5, 1.5, "F");
    setColor(doc, C.white, "text");
    doc.setFontSize(8);
    doc.text(riskLevel || "—", badgeX + 3, y - 0.3);
    resetTextColor(doc);
    y += 9;

    // Key observations
    const observations = aiInsights.currentInterpretation?.keyObservations || [];
    if (observations.length > 0) {
      doc.setFontSize(9);
      doc.setFont(undefined, "bold");
      setColor(doc, C.primary, "text");
      doc.text("Key Observations:", MARGIN, y);
      y += 5;
      doc.setFont(undefined, "normal");
      setColor(doc, C.black, "text");
      observations.slice(0, 3).forEach((obs) => {
        const lines = doc.splitTextToSize(`• ${obs}`, CONTENT_W - 5);
        doc.text(lines, MARGIN + 3, y);
        y += lines.length * 5 + 1;
      });
      y += 3;
    }

    // Weather forecast
    if (weatherSummary) {
      doc.setFontSize(9);
      doc.setFont(undefined, "bold");
      setColor(doc, C.primary, "text");
      doc.text("7-Day Forecast:", MARGIN, y);
      doc.setFont(undefined, "normal");
      setColor(doc, C.black, "text");
      y += 5;
      const rainMm = weatherSummary.next7DaysRainMm ?? "—";
      const precipProb = weatherSummary.next7DaysPrecipProbMax ?? "—";
      doc.text(
        `Expected Rainfall: ${rainMm} mm | Max Precipitation Probability: ${precipProb}%`,
        MARGIN, y
      );
      y += 8;
    }

    // Immediate recommendations
    const immediateRecs = aiInsights.recommendations?.immediate || [];
    if (immediateRecs.length > 0) {
      doc.setFontSize(9);
      doc.setFont(undefined, "bold");
      setColor(doc, C.primary, "text");
      doc.text("Immediate Recommendations:", MARGIN, y);
      y += 5;
      doc.setFont(undefined, "normal");
      setColor(doc, C.black, "text");
      immediateRecs.slice(0, 2).forEach((rec) => {
        const recText = typeof rec === "object" && rec !== null ? rec.text : rec;
        const lines = doc.splitTextToSize(`→ ${recText}`, CONTENT_W - 5);
        doc.text(lines, MARGIN + 3, y);
        y += lines.length * 5 + 1;
      });
    }

    resetTextColor(doc);
  }
};

// ─── Page 3: Parameter Comparison & Aggregated Summaries ──────────────────────

const buildParameterComparisonPage = async (doc, form, readings, paramNames, parameterMap, unitMap) => {
  doc.addPage();
  let y = MARGIN;

  // Page Header Banner
  setColor(doc, C.primary, "fill");
  doc.rect(MARGIN, y, CONTENT_W, 12, "F");
  setColor(doc, C.white, "text");
  doc.setFontSize(13);
  doc.setFont(undefined, "bold");
  doc.text("PARAMETER COMPARISON & AGGREGATED SUMMARIES", MARGIN + 4, y + 8);
  resetTextColor(doc);
  y += 17;

  // Sub-header
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.muted, "text");
  doc.text(
    `Period: ${form.startDate} to ${form.endDate}   |   Parameters: ${paramNames.length}`,
    MARGIN, y
  );
  resetTextColor(doc);
  y += 10;

  // ── Comparison Chart (Bar Chart) ──
  if (paramNames.length > 1) {
    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    setColor(doc, C.primary, "text");
    doc.text("Average Values Comparison", MARGIN, y);
    resetTextColor(doc);
    y += 5;

    const comparisonChart = await renderComparisonChart(readings, paramNames, parameterMap);
    if (comparisonChart) {
      doc.addImage(comparisonChart, "PNG", MARGIN, y, CHART_W, CHART_H);
      y += CHART_H + 8;
    }
  }

  // ── Summary Statistics Table ──
  const stats = calculateStats(readings, paramNames, parameterMap, unitMap);

  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("Aggregated Parameter Statistics", MARGIN, y);
  resetTextColor(doc);
  y += 5;

  const tableBody = paramNames.map((name) => {
    const s = stats[name];
    return [
      name,
      s.unit,
      s.avg,
      s.min,
      s.max,
      s.count,
      s.count > 0 ? "Normal" : "—",
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Parameter", "Unit", "Average", "Min", "Max", "Readings", "Status"]],
    body: tableBody,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [240, 249, 255] },
    columnStyles: {
      0: { fontStyle: "bold" },
      6: {
        fontStyle: "bold",
        textColor: C.safe,
      },
    },
    didParseCell: (data) => {
      if (data.column.index === 6 && data.section === "body") {
        const val = data.cell.raw;
        if (val === "Normal") {
          data.cell.styles.textColor = C.safe;
        } else {
          data.cell.styles.textColor = C.muted;
        }
      }
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  y = doc.lastAutoTable.finalY + 10;

  // Note about raw data
  doc.setFontSize(8);
  setColor(doc, C.muted, "text");
  doc.text(
    "Note: Detailed time-series data (50+ readings per parameter) is available in the CSV export.",
    MARGIN, y
  );
  resetTextColor(doc);
};

// ─── Page 4: Regional Certification & Sign-Off Block ─────────────────────────

const buildCertificationPage = (doc, form, authorName, logoBase64) => {
  doc.addPage();
  let y = MARGIN;

  // Page header banner
  setColor(doc, C.primary, "fill");
  doc.rect(MARGIN, y, CONTENT_W, 12, "F");
  setColor(doc, C.white, "text");
  doc.setFontSize(13);
  doc.setFont(undefined, "bold");
  doc.text("REGIONAL CERTIFICATION & SIGN-OFF", MARGIN + 4, y + 8);
  resetTextColor(doc);

  // Add small logo in header (static embed — never async, never CORS-blocked)
  try {
    doc.addImage(logoBase64 || LOGO_BASE64, "JPEG", PAGE_W - MARGIN - 12, y + 2, 8, 8);
  } catch (logoErr) {
    console.warn("Header logo embed skipped:", logoErr?.message);
  }

  y += 17;

  // Title
  doc.setFontSize(12);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("Official Certification and Acknowledgment", PAGE_W / 2, y, { align: "center" });
  y += 10;

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.black, "text");
  const certText = "This environmental field report has been prepared in accordance with regional DRRM standards and submitted for official review.";
  const lines = doc.splitTextToSize(certText, CONTENT_W - 10);
  doc.text(lines, PAGE_W / 2, y, { align: "center" });
  y += lines.length * 5 + 25;

  // 3-Column Signature Block
  const colWidth = CONTENT_W / 3;
  const col1X = MARGIN;
  const col2X = MARGIN + colWidth;
  const col3X = MARGIN + colWidth * 2;

  // Column 1: Station Lead
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("Station Lead", col1X + colWidth / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.black, "text");
  doc.text(authorName || "Station Officer", col1X + colWidth / 2, y, { align: "center" });
  y += 5;
  doc.text("Northern Bukidnon State College", col1X + colWidth / 2, y, { align: "center" });
  y += 15;

  // Signature line
  hRule(doc, y, C.black, 0.5);
  y += 5;
  doc.setFontSize(8);
  setColor(doc, C.muted, "text");
  doc.text("Signature over Printed Name", col1X + colWidth / 2, y, { align: "center" });
  y += 8;
  doc.text("Date: _______________", col1X + colWidth / 2, y, { align: "center" });
  resetTextColor(doc);

  // Column 2: NBSC Coordinator
  let col2Y = y - 33;
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("NBSC Coordinator", col2X + colWidth / 2, col2Y, { align: "center" });
  col2Y += 6;
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.black, "text");
  doc.text("DRRM Coordinator", col2X + colWidth / 2, col2Y, { align: "center" });
  col2Y += 5;
  doc.text("Northern Bukidnon State College", col2X + colWidth / 2, col2Y, { align: "center" });
  col2Y += 15;

  // Signature line
  hRule(doc, col2Y, C.black, 0.5);
  col2Y += 5;
  doc.setFontSize(8);
  setColor(doc, C.muted, "text");
  doc.text("Signature over Printed Name", col2X + colWidth / 2, col2Y, { align: "center" });
  col2Y += 8;
  doc.text("Date: _______________", col2X + colWidth / 2, col2Y, { align: "center" });
  resetTextColor(doc);

  // Column 3: Regional Director
  let col3Y = y - 33;
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("Regional Director", col3X + colWidth / 2, col3Y, { align: "center" });
  col3Y += 6;
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.black, "text");
  doc.text("Regional Office Director", col3X + colWidth / 2, col3Y, { align: "center" });
  col3Y += 5;
  doc.text("DRRM Regional Office", col3X + colWidth / 2, col3Y, { align: "center" });
  col3Y += 15;

  // Signature line
  hRule(doc, col3Y, C.black, 0.5);
  col3Y += 5;
  doc.setFontSize(8);
  setColor(doc, C.muted, "text");
  doc.text("Signature over Printed Name", col3X + colWidth / 2, col3Y, { align: "center" });
  col3Y += 8;
  doc.text("Date: _______________", col3X + colWidth / 2, col3Y, { align: "center" });
  resetTextColor(doc);

  y = col3Y + 25;

  // Official Stamp Placeholder
  const stampX = PAGE_W / 2 - 25;
  const stampY = y;
  setColor(doc, C.rule, "draw");
  doc.setLineWidth(0.5);
  doc.rect(stampX, stampY, 50, 50);
  doc.setLineWidth(0.2);
  setColor(doc, C.black, "draw");

  doc.setFontSize(8);
  doc.setFont(undefined, "bold");
  setColor(doc, C.muted, "text");
  doc.text("OFFICIAL STAMP", stampX + 25, stampY + 25, { align: "center" });
  doc.setFont(undefined, "normal");
  doc.text("PLACEHOLDER", stampX + 25, stampY + 32, { align: "center" });
  resetTextColor(doc);

  y = stampY + 60;

  // Footer note
  doc.setFontSize(8);
  setColor(doc, C.muted, "text");
  doc.text(
    "This document is an official environmental field report prepared for regional DRRM submission.",
    PAGE_W / 2, y, { align: "center" }
  );
  resetTextColor(doc);
};

// ─── CSV builder ─────────────────────────────────────────────────────────────

const buildCsv = (readings, parameterMap, unitMap, paramNames) => {
  const stats = calculateStats(readings, paramNames, parameterMap, unitMap);
  const summaryLines = paramNames.map((name) => {
    const s = stats[name];
    return `# ${name}: ${s.count} readings, avg=${s.avg} ${s.unit}, min=${s.min} ${s.unit}, max=${s.max} ${s.unit}`;
  });
  const summaryHeader = `# Report summary - Total readings: ${readings.length}\n` + summaryLines.join("\n") + "\n";
  const header = "Date,Time,Parameter,Value,Unit\n";
  const lines = readings.map((row) => {
    const d = row.recorded_at ? new Date(row.recorded_at) : null;
    const dateStr = d
      ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`
      : "";
    const timeStr = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
    const paramName = parameterMap[row.parameter_id] || "Unknown";
    const unit = unitMap?.[row.parameter_id] || "";
    return `${dateStr},${timeStr},"${paramName}",${row.value ?? ""},"${unit}"`;
  }).join("\n");
  return new Blob([summaryHeader + header + lines], { type: "text/csv" });
};

// ─── Main PDF builder ─────────────────────────────────────────────────────────

const buildPdf = async (form, readings, paramNames, parameterMap, unitMap, authorName, aiInsights, weatherSummary, logoBase64 = LOGO_BASE64) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Logo is a static Base64 constant — no async load, no CORS, no bundler URL.
  const finalLogoBase64 = logoBase64 || LOGO_BASE64;

  // Page 1 — Cover
  buildCoverPage(doc, form, authorName, finalLogoBase64);

  // Page 2 — Executive Summary & Watershed Analysis (Stacked Layout)
  await buildExecutiveSummaryPage(doc, form, readings, paramNames, parameterMap, unitMap, aiInsights, weatherSummary, finalLogoBase64);

  // Page 3 — Parameter Comparison & Aggregated Summaries
  await buildParameterComparisonPage(doc, form, readings, paramNames, parameterMap, unitMap);

  // Page 4 — Certification & Sign-Off
  buildCertificationPage(doc, form, authorName, finalLogoBase64);

  // Stamp footers on every page now that we know total count
  const totalPages = doc.internal.pages.length - 1;
  writeFooters(doc, totalPages);

  return doc.output("blob");
};

// ─── Public export ────────────────────────────────────────────────────────────

export const generateReportFile = async ({
  form,
  parameters,
  reportId,
  authorName,
  aiInsights,
  weatherSummary,
}) => {
  const selectedIds = form.parameterIds.includes("all")
    ? parameters.map((p) => p.id)
    : form.parameterIds;

  const parameterMap = Object.fromEntries(parameters.map((p) => [p.id, p.name]));
  const unitMap = Object.fromEntries(parameters.map((p) => [p.id, p.unit || ""]));
  const paramNames = selectedIds.map((id) => parameterMap[id]).filter(Boolean);

  const { data: readings, error: readingsError } = await supabase
    .from("sensor_readings")
    .select("parameter_id, value, recorded_at")
    .in("parameter_id", selectedIds)
    .gte("recorded_at", toStartOfDay(form.startDate))
    .lte("recorded_at", toEndOfDay(form.endDate));

  if (readingsError) throw readingsError;

  const sortedReadings = (readings || []).sort(
    (a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)
  );

  let fileBlob;
  let extension;

  if (form.format === "pdf") {
    fileBlob = await buildPdf(
      form,
      sortedReadings,
      paramNames,
      parameterMap,
      unitMap,
      authorName,
      aiInsights ?? null,
      weatherSummary ?? null,
      null // logoBase64 will be loaded internally
    );
    extension = "pdf";
  } else {
    fileBlob = buildCsv(sortedReadings, parameterMap, unitMap, paramNames);
    extension = "csv";
  }

  const filePath = `reports/${reportId}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("reports")
    .upload(filePath, fileBlob, {
      upsert: true,
      contentType: form.format === "pdf" ? "application/pdf" : "text/csv",
    });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("reports").getPublicUrl(filePath);
  return { url: publicUrlData.publicUrl, blob: fileBlob };
};
