import { supabase } from "./supabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Chart } from "chart.js/auto";

const formatDateTime = (value) => {
  if (!value) return "\u2014";
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const renderSingleChart = async (readings, paramName, parameterMap) => {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 450;
  document.body.appendChild(canvas);

  const paramId = Object.entries(parameterMap).find(([, n]) => n === paramName)?.[0];
  const sorted = readings
    .filter((r) => (paramId ? r.parameter_id === paramId : true))
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
        borderColor: "#2563eb",
        backgroundColor: "#2563eb",
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "#2563eb",
        fill: false,
      }],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            title: (items) => {
              const ts = items[0]?.raw?.x;
              if (typeof ts === "number") {
                const d = new Date(ts);
                const pad = (n) => String(n).padStart(2, "0");
                return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
              }
              return items[0]?.label || String(items[0]?.raw?.x) || "";
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          ticks: {
            maxRotation: 45,
            callback: (val) => {
              const d = new Date(val);
              const pad = (n) => String(n).padStart(2, "0");
              return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            },
          },
          title: { display: true, text: "Date / Time" },
        },
        y: { beginAtZero: true, title: { display: true, text: "Value" } },
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 150));
  const imageDataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  document.body.removeChild(canvas);
  return imageDataUrl;
};

const calculateInsights = (readings, paramNames, parameterMap) => {
  const stats = {};
  paramNames.forEach((name) => {
    const paramId = Object.entries(parameterMap).find(([, n]) => n === name)?.[0];
    const paramReadings = readings.filter((r) => (paramId ? r.parameter_id === paramId : true));
    const values = paramReadings.map((r) => Number(r.value)).filter((v) => !isNaN(v));
    if (values.length === 0) {
      stats[name] = { count: 0, avg: "\u2014", min: "\u2014", max: "\u2014" };
    } else {
      stats[name] = {
        count: values.length,
        avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }
  });
  return stats;
};

const buildPdf = async (form, readings, paramNames, parameterMap) => {
  const doc = new jsPDF();

  for (let i = 0; i < paramNames.length; i++) {
    const paramName = paramNames[i];
    if (i > 0) doc.addPage();

    doc.setFontSize(16);
    doc.text(form.name, 14, 18);
    doc.setFontSize(12);
    doc.text(`Parameter: ${paramName}`, 14, 28);
    doc.setFontSize(10);
    doc.text(`Range: ${form.startDate} to ${form.endDate}`, 14, 36);

    const paramId = Object.entries(parameterMap).find(([, n]) => n === paramName)?.[0];
    const paramReadings = readings.filter((r) => (paramId ? r.parameter_id === paramId : true));

    const insights = calculateInsights(paramReadings, [paramName], parameterMap);
    const s = insights[paramName] || { count: 0, avg: "\u2014", min: "\u2014", max: "\u2014" };
    doc.setFontSize(9);
    doc.text(`Readings: ${s.count} | Avg: ${s.avg} | Min: ${s.min} | Max: ${s.max}`, 14, 44);

    const chartImage = paramReadings.length > 0 ? await renderSingleChart(readings, paramName, parameterMap) : null;
    if (chartImage) doc.addImage(chartImage, "PNG", 14, 52, 180, 90);

    const tableBody = paramReadings.map((row) => {
      const dtStr = formatDateTime(row.recorded_at);
      const parts = dtStr.includes(" ") ? dtStr.split(" ") : [dtStr, dtStr];
      return [
        parts[0],
        parts[1],
        paramName,
        String(row.value ?? ""),
      ];
    });

    autoTable(doc, {
      startY: chartImage ? 148 : 52,
      head: [["Date", "Time", "Parameter", "Value"]],
      body: tableBody,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
    });
  }

  return doc.output("blob");
};

const buildCsv = (readings, parameterMap, paramNames) => {
  const insights = calculateInsights(readings, paramNames, parameterMap);
  const summaryLines = paramNames.map((name) => {
    const s = insights[name];
    return `# ${name}: ${s.count} readings, avg=${s.avg}, min=${s.min}, max=${s.max}`;
  });
  const summaryHeader = `# Report summary - Total readings: ${readings.length}\n` + summaryLines.join("\n") + "\n";
  const header = "Date,Time,Parameter,Value\n";
  const lines = readings.map((row) => {
    const d = row.recorded_at ? new Date(row.recorded_at) : null;
    const dateStr = d ? `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}` : "";
    const timeStr = d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
    const paramName = parameterMap[row.parameter_id] || "Unknown";
    return `${dateStr},${timeStr},"${paramName}",${row.value ?? ""}`;
  }).join("\n");
  return new Blob([summaryHeader + header + lines], { type: "text/csv" });
};

export const generateReportFile = async ({ form, parameters, reportId }) => {
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
    fileBlob = await buildPdf(form, sortedReadings, paramNames, parameterMap);
    extension = "pdf";
  } else {
    fileBlob = buildCsv(sortedReadings, parameterMap, paramNames);
    extension = "csv";
  }

  const filePath = `reports/${reportId}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("reports")
    .upload(filePath, fileBlob, { upsert: true, contentType: form.format === "pdf" ? "application/pdf" : "text/csv" });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("reports").getPublicUrl(filePath);
  return { url: publicUrlData.publicUrl, blob: fileBlob };
};
