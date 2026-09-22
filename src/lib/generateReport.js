import { supabase } from "./supabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Chart } from "chart.js/auto";

// Groups raw readings into { "YYYY-MM-DD": { paramName: avgValue } }
const aggregateByDay = (readings, parameterMap) => {
  const days = {};
  readings.forEach((row) => {
    const day = row.recorded_at.slice(0, 10);
    const paramName = parameterMap[row.parameter_id] || "Unknown";
    if (!days[day]) days[day] = {};
    if (!days[day][paramName]) days[day][paramName] = { sum: 0, count: 0 };
    days[day][paramName].sum += Number(row.value);
    days[day][paramName].count += 1;
  });
  return Object.keys(days).sort().map((day) => {
    const row = { day };
    Object.entries(days[day]).forEach(([paramName, { sum, count }]) => {
      row[paramName] = +(sum / count).toFixed(2);
    });
    return row;
  });
};

// Renders a bar chart (one bar group per day, one series per parameter) to a PNG data URL
const renderChartImage = async (dailyRows, paramNames) => {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 450;
  document.body.appendChild(canvas); // Chart.js needs it attached to measure

  const colors = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];
  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: dailyRows.map((row) => row.day),
      datasets: paramNames.map((name, i) => ({
        label: name,
        data: dailyRows.map((row) => row[name] ?? null),
        backgroundColor: colors[i % colors.length],
      })),
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true } },
    },
  });

  // Let Chart.js finish drawing before reading the canvas
  await new Promise((resolve) => setTimeout(resolve, 100));
  const imageDataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  document.body.removeChild(canvas);
  return imageDataUrl;
};

const buildPdf = async (form, dailyRows, paramNames, chartImage) => {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(form.name, 14, 18);
  doc.setFontSize(10);
  doc.text(`Range: ${form.startDate} to ${form.endDate}`, 14, 26);
  doc.text(`Parameters: ${paramNames.join(", ")}`, 14, 32);

  if (chartImage) doc.addImage(chartImage, "PNG", 14, 38, 180, 90);

  autoTable(doc, {
    startY: chartImage ? 134 : 40,
    head: [["Date", ...paramNames]],
    body: dailyRows.map((row) => [row.day, ...paramNames.map((name) => row[name] ?? "—")]),
  });

  return doc.output("blob");
};

const buildCsv = (dailyRows, paramNames) => {
  const header = ["Date", ...paramNames].join(",");
  const lines = dailyRows.map((row) => [row.day, ...paramNames.map((name) => row[name] ?? "")].join(","));
  return new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
};

export const generateReportFile = async ({ form, parameters, reportId }) => {
  const selectedIds = form.parameterIds.includes("all")
    ? parameters.map((p) => p.id)
    : form.parameterIds;
  const parameterMap = Object.fromEntries(parameters.map((p) => [p.id, p.name]));
  const paramNames = selectedIds.map((id) => parameterMap[id]);

  const { data: readings, error: readingsError } = await supabase
    .from("sensor_readings")
    .select("parameter_id, value, recorded_at")
    .in("parameter_id", selectedIds)
    .gte("recorded_at", `${form.startDate}T00:00:00`)
    .lte("recorded_at", `${form.endDate}T23:59:59`);

  if (readingsError) throw readingsError;

  const dailyRows = aggregateByDay(readings || [], parameterMap);

  let fileBlob;
  let extension;
  if (form.format === "pdf") {
    const chartImage = dailyRows.length > 0 ? await renderChartImage(dailyRows, paramNames) : null;
    fileBlob = await buildPdf(form, dailyRows, paramNames, chartImage);
    extension = "pdf";
  } else {
    fileBlob = buildCsv(dailyRows, paramNames);
    extension = "csv";
  }

  const filePath = `reports/${reportId}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("reports")
    .upload(filePath, fileBlob, { upsert: true, contentType: form.format === "pdf" ? "application/pdf" : "text/csv" });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("reports").getPublicUrl(filePath);
  return publicUrlData.publicUrl;
  
};