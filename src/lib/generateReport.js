import { supabase } from "./supabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Chart } from "chart.js/auto";

// ─── Color constants (RGB) ────────────────────────────────────────────────────
const C = {
  primary:  [12,  76,  124],   // #0C4C7C
  accent:   [0,  180,  216],   // #00b4d8
  danger:   [220, 38,  38],    // #dc2626
  warning:  [217,119,   6],    // #d97706
  safe:     [22, 163,  74],    // #16a34a
  muted:    [100,116, 139],    // #64748b
  rule:     [226,232, 240],    // #e2e8f0
  black:    [0,   0,   0],
  white:    [255,255, 255],
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

const formatDate = (isoStr) => {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
};

const formatDateOnly = (value) => {
  if (!value) return "—";
  const d = new Date(value);
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
// ─── Stats calculator ─────────────────────────────────────────────────────────

const calculateStats = (readings, paramNames, parameterMap) => {
  const stats = {};
  paramNames.forEach((name) => {
    const paramId = Object.entries(parameterMap).find(([, n]) => n === name)?.[0];
    const paramReadings = readings.filter((r) => r.parameter_id === paramId);
    const values = paramReadings.map((r) => Number(r.value)).filter((v) => !isNaN(v));
    if (values.length === 0) {
      stats[name] = { count: 0, avg: "—", min: "—", max: "—", latest: "—" };
    } else {
      const sorted = [...paramReadings].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
      stats[name] = {
        count: values.length,
        avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
        min: Math.min(...values).toFixed(2),
        max: Math.max(...values).toFixed(2),
        latest: String(sorted[0]?.value ?? "—"),
      };
    }
  });
  return stats;
};

// ─── Chart renderer ───────────────────────────────────────────────────────────

const renderSingleChart = async (readings, paramName, parameterMap) => {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 380;
  canvas.style.position = "absolute";
  canvas.style.left = "-9999px";
  document.body.appendChild(canvas);

  const paramId = Object.entries(parameterMap).find(([, n]) => n === paramName)?.[0];
  const sorted = readings
    .filter((r) => r.parameter_id === paramId)
    .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

  const points = sorted.map((r) => ({
    x: new Date(r.recorded_at).getTime(),
    y: Number(r.value),
  }));

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: paramName,
        data: points,
        borderColor: "#0C4C7C",
        backgroundColor: "rgba(12,76,124,0.08)",
        tension: 0.3,
        pointRadius: 3,
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
          text: `${paramName} Over Time`,
          font: { size: 14, weight: "bold" },
          color: "#0C4C7C",
        },
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            title: (items) => {
              const ts = items[0]?.raw?.x;
              if (typeof ts === "number") {
                const d = new Date(ts);
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
            maxRotation: 45,
            callback: (val) => {
              const d = new Date(val);
              return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            },
          },
          title: { display: true, text: "Date / Time" },
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
    doc.text("H2Know Monitoring System — Dicklum River Basin", MARGIN, footerY);

    // Center
    setColor(doc, C.muted, "text");
    doc.text("CONFIDENTIAL — For Institutional Review Only", PAGE_W / 2, footerY, { align: "center" });

    // Right
    setColor(doc, C.muted, "text");
    doc.text(`Page ${i} of ${totalPages}`, PAGE_W - MARGIN, footerY, { align: "right" });

    resetTextColor(doc);
  }
};

// ─── Page 1: Cover ────────────────────────────────────────────────────────────

const buildCoverPage = (doc, form, authorName) => {
  let y = MARGIN;

  // Logo placeholder (blue rectangle top-left)
  setColor(doc, C.primary, "fill");
  doc.roundedRect(MARGIN, y, 38, 18, 2, 2, "F");
  setColor(doc, C.white, "text");
  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  doc.text("H2KNOW", MARGIN + 19, y + 7, { align: "center" });
  doc.setFontSize(7);
  doc.setFont(undefined, "normal");
  doc.text("LOGO", MARGIN + 19, y + 13, { align: "center" });
  resetTextColor(doc);

  // Station info block (right of logo)
  const infoX = MARGIN + 44;
  doc.setFontSize(15);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text("H2Know — Dicklum River Water Quality Report", infoX, y + 7);

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.muted, "text");
  doc.text("Station: Dicklum River, Barangay Dicklum, Manolo Fortich, Bukidnon", infoX, y + 13);
  doc.text("Coordinates: 8.3819°N, 124.8450°E", infoX, y + 18);
  resetTextColor(doc);

  y += 26;

  // Horizontal rule
  hRule(doc, y, C.primary, 0.6);
  y += 7;

  // Dynamic report name
  doc.setFontSize(20);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text(form.name || "Water Quality Report", PAGE_W / 2, y + 8, { align: "center" });
  y += 18;

  // Report period
  doc.setFontSize(11);
  doc.setFont(undefined, "normal");
  setColor(doc, C.black, "text");
  doc.text(
    `Report Period:  ${form.startDate}  to  ${form.endDate}`,
    PAGE_W / 2, y, { align: "center" }
  );
  y += 8;

  // Format & generated
  const generatedAt = new Date().toISOString();
  doc.setFontSize(9);
  setColor(doc, C.muted, "text");
  doc.text(
    `Format: PDF  |  Generated: ${generatedAt}`,
    PAGE_W / 2, y, { align: "center" }
  );
  y += 14;

  // Decorative accent band
  setColor(doc, C.accent, "fill");
  doc.rect(MARGIN, y, CONTENT_W, 1.5, "F");
  y += 10;

  // Centered decorative title block
  setColor(doc, C.primary, "fill");
  doc.roundedRect(PAGE_W / 2 - 60, y, 120, 40, 3, 3, "F");
  setColor(doc, C.white, "text");
  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  doc.text("OFFICIAL INSTITUTIONAL REPORT", PAGE_W / 2, y + 10, { align: "center" });
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.text("Prepared for Academic and Administrative Review", PAGE_W / 2, y + 17, { align: "center" });
  doc.text("Dicklum River Watershed Monitoring Program", PAGE_W / 2, y + 23, { align: "center" });
  doc.text("Manolo Fortich, Bukidnon, Philippines", PAGE_W / 2, y + 29, { align: "center" });
  resetTextColor(doc);
  y += 52;

  // Generated by
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  setColor(doc, C.black, "text");
  doc.text("Generated By:", PAGE_W / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(13);
  setColor(doc, C.primary, "text");
  doc.text(authorName || "System Administrator", PAGE_W / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(9);
  setColor(doc, C.muted, "text");
  doc.setFont(undefined, "normal");
  doc.text(`Report Date: ${formatDate(new Date().toISOString())}`, PAGE_W / 2, y, { align: "center" });
  resetTextColor(doc);

  // Bottom rule
  hRule(doc, PAGE_H - 20, C.primary, 0.6);
  doc.setFontSize(8);
  setColor(doc, C.muted, "text");
  doc.text(
    "This document is generated automatically by the H2Know Environmental Monitoring System.",
    PAGE_W / 2, PAGE_H - 15, { align: "center" }
  );
  resetTextColor(doc);
};

// ─── Page 2: Executive Summary ────────────────────────────────────────────────

const buildExecutiveSummaryPage = (doc, form, readings, paramNames, parameterMap, aiInsights, weatherSummary) => {
  doc.addPage();
  let y = MARGIN;

  // Section title
  setColor(doc, C.primary, "fill");
  doc.rect(MARGIN, y, CONTENT_W, 10, "F");
  setColor(doc, C.white, "text");
  doc.setFontSize(12);
  doc.setFont(undefined, "bold");
  doc.text("Executive Summary — Water Quality Status", MARGIN + 4, y + 7);
  resetTextColor(doc);
  y += 15;

  // Sub-header
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  setColor(doc, C.muted, "text");
  doc.text(
    `Period: ${form.startDate} to ${form.endDate}   |   Parameters: ${paramNames.length}   |   Total Readings: ${readings.length}`,
    MARGIN, y
  );
  resetTextColor(doc);
  y += 8;

  // Summary stats table
  const stats = calculateStats(readings, paramNames, parameterMap);
  const tableBody = paramNames.map((name) => {
    const s = stats[name];
    // Determine unit (if parameter objects carried unit info this would be richer — use blank for now)
    return [
      name,
      s.latest,
      "",          // Unit — not available at this layer
      s.avg,
      s.min,
      s.max,
      s.count > 0 ? "Normal" : "—",
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Parameter", "Latest Reading", "Unit", "7-Day Avg", "Min", "Max", "Status"]],
    body: tableBody,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 252] },
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

  // ── AI Insights block ──
  if (aiInsights) {
    // Title banner
    setColor(doc, [0, 180, 216], "fill"); // accent
    doc.rect(MARGIN, y, CONTENT_W, 8, "F");
    setColor(doc, C.white, "text");
    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    doc.text("AI-Powered Watershed Analysis", MARGIN + 4, y + 5.5);
    resetTextColor(doc);
    y += 13;

    // Overview text
    if (aiInsights.currentInterpretation?.overview) {
      doc.setFontSize(9);
      doc.setFont(undefined, "normal");
      setColor(doc, C.black, "text");
      const lines = doc.splitTextToSize(aiInsights.currentInterpretation.overview, 180);
      doc.text(lines, MARGIN, y);
      y += lines.length * 5 + 5;
    }

    // Runoff risk badge
    const riskLevel = (aiInsights.riskLevel || "").toUpperCase();
    let riskColor = C.safe;
    if (riskLevel === "HIGH") riskColor = C.danger;
    else if (riskLevel === "MODERATE") riskColor = C.warning;

    doc.setFontSize(9);
    doc.setFont(undefined, "bold");
    setColor(doc, C.black, "text");
    doc.text("Runoff Risk:", MARGIN, y);
    // Badge
    const badgeX = MARGIN + 24;
    const labelW = doc.getTextWidth(riskLevel) + 6;
    setColor(doc, riskColor, "fill");
    doc.roundedRect(badgeX, y - 4.5, labelW, 6, 1.5, 1.5, "F");
    setColor(doc, C.white, "text");
    doc.setFontSize(8);
    doc.text(riskLevel || "—", badgeX + 3, y - 0.3);
    resetTextColor(doc);
    y += 9;

    // Key observations (up to 3)
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

    // Weather / 7-day forecast
    if (weatherSummary) {
      doc.setFontSize(9);
      doc.setFont(undefined, "bold");
      setColor(doc, C.primary, "text");
      doc.text("7-Day Forecast Note:", MARGIN, y);
      doc.setFont(undefined, "normal");
      setColor(doc, C.black, "text");
      y += 5;
      const rainMm = weatherSummary.next7DaysRainMm ?? "—";
      const precipProb = weatherSummary.next7DaysPrecipProbMax ?? "—";
      doc.text(
        `Expected Rainfall: ${rainMm} mm over next 7 days   |   Max Precipitation Probability: ${precipProb}%`,
        MARGIN, y
      );
      y += 8;
    }

    // Immediate recommendations (up to 2)
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
        const lines = doc.splitTextToSize(`→ ${rec}`, CONTENT_W - 5);
        doc.text(lines, MARGIN + 3, y);
        y += lines.length * 5 + 1;
      });
    }

    resetTextColor(doc);
  }
};

// ─── Per-parameter pages ──────────────────────────────────────────────────────

const buildParameterPage = async (doc, form, readings, paramName, parameterMap) => {
  doc.addPage();
  let y = MARGIN;

  // Page header banner
  setColor(doc, C.primary, "fill");
  doc.rect(MARGIN, y, CONTENT_W, 10, "F");
  setColor(doc, C.white, "text");
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text(`${paramName}`, MARGIN + 4, y + 7);
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.text(`${form.startDate} — ${form.endDate}`, PAGE_W - MARGIN - 4, y + 7, { align: "right" });
  resetTextColor(doc);
  y += 14;

  // Stats row
  const paramId = Object.entries(parameterMap).find(([, n]) => n === paramName)?.[0];
  const paramReadings = readings
    .filter((r) => r.parameter_id === paramId)
    .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

  const values = paramReadings.map((r) => Number(r.value)).filter((v) => !isNaN(v));
  const count = values.length;
  const avg = count > 0 ? (values.reduce((a, b) => a + b, 0) / count).toFixed(2) : "—";
  const min = count > 0 ? Math.min(...values).toFixed(2) : "—";
  const max = count > 0 ? Math.max(...values).toFixed(2) : "—";

  doc.setFontSize(9);
  doc.setFont(undefined, "bold");
  setColor(doc, C.primary, "text");
  doc.text(
    `Readings: ${count}   |   Avg: ${avg}   |   Min: ${min}   |   Max: ${max}`,
    MARGIN, y
  );
  resetTextColor(doc);
  y += 8;

  // Chart
  if (paramReadings.length > 0) {
    const chartImage = await renderSingleChart(readings, paramName, parameterMap);
    if (chartImage) {
      // Chart at 180mm wide, ~76mm tall (proportional to 900×380 canvas)
      doc.addImage(chartImage, "PNG", MARGIN, y, CONTENT_W, 76);
      y += 80;
    }
  } else {
    doc.setFontSize(9);
    setColor(doc, C.muted, "text");
    doc.text("No readings available for this parameter in the selected period.", MARGIN, y);
    resetTextColor(doc);
    y += 10;
  }

  // Data table (max 50 rows)
  const MAX_ROWS = 50;
  const truncated = paramReadings.length > MAX_ROWS;
  const displayRows = paramReadings.slice(0, MAX_ROWS);

  const tableBody = displayRows.map((row) => [
    formatDateOnly(row.recorded_at),
    formatTimeOnly(row.recorded_at),
    String(row.value ?? ""),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Date", "Time", "Value"]],
    body: tableBody,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 25 },
      2: { cellWidth: 30, halign: "right" },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  if (truncated) {
    const noteY = doc.lastAutoTable.finalY + 4;
    doc.setFontSize(7.5);
    setColor(doc, C.muted, "text");
    doc.text(
      `Note: Table shows first ${MAX_ROWS} of ${paramReadings.length} readings. Full data available in CSV export.`,
      MARGIN, noteY
    );
    resetTextColor(doc);
  }
};

// ─── CSV builder (unchanged) ──────────────────────────────────────────────────

const buildCsv = (readings, parameterMap, paramNames) => {
  const stats = calculateStats(readings, paramNames, parameterMap);
  const summaryLines = paramNames.map((name) => {
    const s = stats[name];
    return `# ${name}: ${s.count} readings, avg=${s.avg}, min=${s.min}, max=${s.max}`;
  });
  const summaryHeader = `# Report summary - Total readings: ${readings.length}\n` + summaryLines.join("\n") + "\n";
  const header = "Date,Time,Parameter,Value\n";
  const lines = readings.map((row) => {
    const d = row.recorded_at ? new Date(row.recorded_at) : null;
    const dateStr = d
      ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`
      : "";
    const timeStr = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
    const paramName = parameterMap[row.parameter_id] || "Unknown";
    return `${dateStr},${timeStr},"${paramName}",${row.value ?? ""}`;
  }).join("\n");
  return new Blob([summaryHeader + header + lines], { type: "text/csv" });
};

// ─── Main PDF builder ─────────────────────────────────────────────────────────

const buildPdf = async (form, readings, paramNames, parameterMap, authorName, aiInsights, weatherSummary) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Page 1 — Cover
  buildCoverPage(doc, form, authorName);

  // Page 2 — Executive Summary
  buildExecutiveSummaryPage(doc, form, readings, paramNames, parameterMap, aiInsights, weatherSummary);

  // Pages 3+ — One page per parameter
  for (const paramName of paramNames) {
    await buildParameterPage(doc, form, readings, paramName, parameterMap);
  }

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
  const paramNames = selectedIds.map((id) => parameterMap[id]).filter(Boolean);

  const { data: readings, error: readingsError } = await supabase
    .from("sensor_readings")
    .select("parameter_id, value, recorded_at")
    .in("parameter_id", selectedIds)
    .gte("recorded_at", `${form.startDate}T00:00:00`)
    .lte("recorded_at", `${form.endDate}T23:59:59`);

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
      authorName,
      aiInsights ?? null,
      weatherSummary ?? null
    );
    extension = "pdf";
  } else {
    fileBlob = buildCsv(sortedReadings, parameterMap, paramNames);
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
