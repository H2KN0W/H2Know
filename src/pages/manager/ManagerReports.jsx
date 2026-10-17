import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CloudRain,
  Droplets,
  Gauge,
  Waves,
  Thermometer,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { logActivity } from "../../lib/logActivity";
import { generateReportFile } from "../../lib/generateReport";
import { fetchWeatherInsights } from "../../lib/weather";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/ManagerReports.css";

import { formatDateTime, formatDate, formatReportParameters } from "../../lib/formatters";
import { PAGE_SIZES, filterMonitoredParameters } from "../../config/constants";

const PAGE_SIZE = PAGE_SIZES.DEFAULT;
const ALL_VALUE = "all";

const PARAM_ICONS = { pH: Droplets, TDS: Gauge, Turbidity: Waves, Temperature: Thermometer };

const downloadReport = (blob, name, format) => {
  const fileName = name.trim().replace(/[\\/:*?"<>|]/g, "_") || "water-quality-report";
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${fileName}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const ManagerReports = () => {
  useLogPageView("Viewed Manager Reports");
  const [parameters, setParameters] = useState([]);
  const [reports, setReports] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reportModal, setReportModal] = useState(null);
  const [form, setForm] = useState({ name: "", parameterIds: [ALL_VALUE], startDate: "", endDate: "", format: "pdf" });

  // AI insights state for report preview & PDF embedding
  const [aiInsights, setAiInsights] = useState(null);
  const [weatherSummary, setWeatherSummary] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const fetchReports = useCallback(async (userId) => {
    if (!userId) return;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const { data, error: fetchError, count } = await supabase
      .from("reports")
      .select("id, report_name, parameters, format, date_range_start, date_range_end, file_url, status, created_at, profiles ( full_name )", { count: "exact" })
      .eq("generated_by", userId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (fetchError) setError("Could not load reports. Apply the manager portal migration before using report metadata.");
    else { setReports(data || []); setTotalCount(count || 0); }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    if (currentUser?.id) fetchReports(currentUser.id);
  }, [currentUser?.id, fetchReports]);

  useEffect(() => {
    Promise.all([
      supabase.from("parameters").select("id, name, unit").order("name"),
      supabase.auth.getSession()
    ]).then(async ([parameterResult, sessionResult]) => {
      setParameters(filterMonitoredParameters(parameterResult.data));
      const id = sessionResult.data.session?.user?.id;
      if (id) {
        const { data, error: profileError } = await supabase.from("profiles").select("id, full_name, role").eq("id", id).single();
        if (profileError) {
          console.error("Failed to load manager profile:", profileError);
          setError("Could not load your profile. Try refreshing the page.");
        }
        setCurrentUser(data);
      } else {
        console.error("No active session found when loading Manager Reports.");
      }
    });
  }, []);

  // Load live AI insights once on mount for PDF embedding & preview
  const loadInsightsPreview = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const data = await fetchWeatherInsights([]);
      const ua = data?.unifiedAnalysis;
      const ws = data?.weatherSummary;
      if (ua) {
        setAiInsights({
          riskLevel: ua.riskLevel || "low",
          currentInterpretation: ua.currentInterpretation || null,
          recommendations: ua.recommendations || null,
          runoffAnalysis: ua.runoffAnalysis || null,
          riskFactors: ua.riskFactors || [],
          positiveFactors: ua.positiveFactors || [],
        });
      }
      if (ws) setWeatherSummary(ws);
    } catch (e) {
      console.warn("AI insights preview unavailable:", e.message);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInsightsPreview();
  }, [loadInsightsPreview]);

  const toggleParameter = (id) => setForm((current) => {
    if (id === ALL_VALUE) {
      const isCurrentlyAll = current.parameterIds.includes(ALL_VALUE);
      return { ...current, parameterIds: isCurrentlyAll ? [] : [ALL_VALUE] };
    }
    const withoutAll = current.parameterIds.filter((item) => item !== ALL_VALUE);
    const exists = withoutAll.includes(id);
    const next = exists ? withoutAll.filter((item) => item !== id) : [...withoutAll, id];
    if (parameters.length > 0 && next.length === parameters.length) {
      return { ...current, parameterIds: [ALL_VALUE] };
    }
    return { ...current, parameterIds: next };
  });

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    if (!currentUser) { setError("Your profile hasn't finished loading yet. Please wait a moment and try again."); return; }
    if (!form.name.trim()) { setError("Enter a report name."); return; }
    if (form.parameterIds.length === 0) { setError("Select at least one parameter."); return; }
    if (!form.startDate || !form.endDate) { setError("Choose a start and end date."); return; }
    if (form.startDate > form.endDate) { setError("Start date must be before end date."); return; }

    setSaving(true);
    setReportModal({ status: "loading", name: form.name, format: form.format });
    const isAllSelected = form.parameterIds.includes(ALL_VALUE) ||
      (parameters.length > 0 && form.parameterIds.length === parameters.length);
    const parameterNames = isAllSelected
      ? parameters.map((item) => item.name)
      : parameters.filter((item) => form.parameterIds.includes(item.id)).map((item) => item.name);

    const { data: inserted, error: insertError } = await supabase
      .from("reports")
      .insert({
        generated_by: currentUser.id,
        report_name: form.name,
        parameters: parameterNames,
        format: form.format,
        date_range_start: form.startDate,
        date_range_end: form.endDate,
        file_url: null
      })
      .select()
      .single();

    if (insertError) {
      setReportModal({ status: "failed", name: form.name, message: insertError.message });
      setSaving(false);
      return;
    }

    let generationSucceeded = false;
    try {
      const { url: fileUrl, blob } = await generateReportFile({
        form,
        parameters,
        reportId: inserted.id,
        authorName: currentUser.full_name || "Manager",
        aiInsights,
        weatherSummary,
      });
      const { error: updateError } = await supabase
        .from("reports")
        .update({ file_url: fileUrl, status: "success" })
        .eq("id", inserted.id);
      if (updateError) throw updateError;

      downloadReport(blob, form.name, form.format);
      setReportModal({ status: "success", name: form.name, format: form.format });
      generationSucceeded = true;
    } catch (genError) {
      console.error("Report generation failed:", genError);
      await supabase
        .from("reports")
        .update({ status: "failed" })
        .eq("id", inserted.id);
      setReportModal({
        status: "failed",
        name: form.name,
        message: "Report generation failed: " + genError.message
      });
    }

    if (generationSucceeded) {
      try {
        await logActivity({
          activity: `Requested ${form.format.toUpperCase()} report: ${form.name}`,
          status: "Success"
        });
      } catch (activityError) {
        console.error("Failed to log report activity:", activityError);
      }
    }

    setForm({ name: "", parameterIds: [], startDate: "", endDate: "", format: "pdf" });
    setPage(1);
    await fetchReports(currentUser.id);
    setSaving(false);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Risk level helpers
  const riskLevel = aiInsights?.riskLevel || "low";
  const riskIcon = riskLevel === "severe" || riskLevel === "high"
    ? ShieldAlert
    : riskLevel === "moderate"
      ? AlertTriangle
      : ShieldCheck;
  const RiskIcon = riskIcon;

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <main className="admin-main manager-main">
        <header className="page-header">
          <h1>Reports</h1>
          <p>Generate and download professional water-quality reports for institutional review</p>
        </header>

        {/* ── Two-column layout: Form left, AI Preview right ── */}
        <div className="mr-layout">

          {/* ── Left: Generate Form ── */}
          <section className="manager-panel mr-form-panel">
            <div className="mr-panel-header">
              <FileText size={18} className="mr-panel-icon" />
              <h2>Generate New Report</h2>
            </div>
            <form className="manager-report-form" onSubmit={submit}>
              <label>
                Report name
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Weekly Water Quality Summary"
                />
              </label>
              <fieldset>
                <legend>Parameters</legend>
                <div className="manager-checkboxes">
                  <label>
                    <input type="checkbox" checked={form.parameterIds.includes(ALL_VALUE)} onChange={() => toggleParameter(ALL_VALUE)} />
                    All Parameters
                  </label>
                  {parameters.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={form.parameterIds.includes(item.id)}
                        onChange={() => toggleParameter(item.id)}
                        disabled={form.parameterIds.includes(ALL_VALUE)}
                      />
                      {item.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Start date
                <input type="date" value={form.startDate} max={form.endDate || undefined} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </label>
              <label>
                End date
                <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </label>
              <label>
                Format
                <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                  <option value="pdf">PDF — Full Report with Charts &amp; AI Insights</option>
                  <option value="csv">CSV — Raw Data Export</option>
                </select>
              </label>
              <button type="submit" disabled={saving}>{saving ? "Generating…" : "Generate report"}</button>
            </form>
            {error && <p className="manager-error">{error}</p>}
          </section>

          {/* ── Right: AI Insights Preview Panel ── */}
          <aside className="manager-panel mr-insights-panel" aria-label="AI Insights Preview">
            <div className="mr-panel-header">
              <Sparkles size={18} className="mr-panel-icon mr-ai-icon" />
              <h2>Live AI Insights Preview</h2>
              <button
                type="button"
                className="mr-refresh-btn"
                onClick={loadInsightsPreview}
                disabled={insightsLoading}
                title="Refresh AI insights"
                aria-label="Refresh insights"
              >
                <RefreshCw size={13} className={insightsLoading ? "spin" : ""} />
              </button>
            </div>
            <p className="mr-insights-sub">
              These AI insights will be embedded in the PDF when you generate a report.
            </p>

            {insightsLoading ? (
              <div className="mr-insights-loading">
                <span className="spinner spinner-dark" role="status" aria-label="Loading insights" />
                <span>Fetching AI analysis…</span>
              </div>
            ) : !aiInsights ? (
              <div className="mr-insights-empty">
                <AlertTriangle size={18} />
                <span>AI insights unavailable. PDF will still be generated without this section.</span>
              </div>
            ) : (
              <div className="mr-insights-body">

                {/* Risk Banner */}
                <div className={`mr-risk-banner is-${riskLevel}`}>
                  <RiskIcon size={17} />
                  <div>
                    <span className="mr-risk-label">Runoff Risk</span>
                    <strong className="mr-risk-val">{riskLevel.toUpperCase()}</strong>
                  </div>
                  {weatherSummary?.next7DaysRainMm != null && (
                    <div className="mr-rain-stat">
                      <CloudRain size={14} />
                      <span>{weatherSummary.next7DaysRainMm} mm forecast (7 days)</span>
                    </div>
                  )}
                </div>

                {/* Parameter status mini-grid */}
                {aiInsights.currentInterpretation?.overview && (
                  <div className="mr-overview-block">
                    <p className="mr-overview-text">{aiInsights.currentInterpretation.overview}</p>
                  </div>
                )}

                {/* Key observations */}
                {aiInsights.currentInterpretation?.keyObservations?.length > 0 && (
                  <div className="mr-observations">
                    <span className="mr-obs-title">Key Diagnostic Observations</span>
                    <ul className="mr-obs-list">
                      {aiInsights.currentInterpretation.keyObservations.slice(0, 4).map((obs, idx) => (
                        <li key={idx} className="mr-obs-item">
                          <span className="mr-obs-bullet" />
                          <span>{obs}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Parameter icons row */}
                <div className="mr-param-row">
                  {["pH", "TDS", "Turbidity", "Temperature"].map((param) => {
                    const Icon = PARAM_ICONS[param] || Droplets;
                    return (
                      <div key={param} className="mr-param-chip">
                        <Icon size={14} />
                        <span>{param}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Immediate recommendations */}
                {aiInsights.recommendations?.immediate?.length > 0 && (
                  <div className="mr-recs">
                    <span className="mr-recs-title">Immediate Actions</span>
                    <ul className="mr-recs-list">
                      {aiInsights.recommendations.immediate.slice(0, 2).map((rec, idx) => (
                        <li key={idx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mr-ai-stamp">
                  <Sparkles size={11} />
                  AI-Correlated · Open-Meteo 7-Day Horizon · Will be included in PDF
                </p>
              </div>
            )}
          </aside>
        </div>

        {/* ── Report History ── */}
        <section className="manager-panel">
          <h2>Report History</h2>
          {loading ? <p>Loading reports…</p> : (
            <>
              <div className="table-wrap">
                <table className="manager-reports-table">
                  <thead>
                    <tr>
                      <th>Name</th><th>Date generated</th><th>Range covered</th><th>Parameters</th><th>Format</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.length === 0 ? (
                      <tr><td colSpan={6}>No reports generated yet.</td></tr>
                    ) : reports.map((report) => (
                      <tr key={report.id}>
                        <td data-label="Name">{report.report_name || "Untitled report"}</td>
                        <td data-label="Date generated">{formatDateTime(report.created_at)}</td>
                        <td data-label="Range covered">{formatDate(report.date_range_start)} – {formatDate(report.date_range_end)}</td>
                        <td data-label="Parameters">{formatReportParameters(report.parameters)}</td>
                        <td data-label="Format">{report.format?.toUpperCase() || "PDF"}</td>
                        <td data-label="Status">
                          {report.status === "success"
                            ? <span className="badge badge-ready">✓ Success</span>
                            : <span className="badge badge-failed">× Failed</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="um-pagination">
                  <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>‹</button>
                  <span>Page {page} of {totalPages}</span>
                  <button disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>›</button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {reportModal && (
        <div className="manager-report-modal-backdrop">
          <section
            className={`manager-report-modal manager-report-modal-${reportModal.status}`}
            role="dialog"
            aria-modal="true"
            aria-live="polite"
            aria-labelledby="report-modal-title"
            aria-busy={reportModal.status === "loading"}
          >
            <span className={`manager-report-modal-icon manager-report-modal-icon-${reportModal.status}`} aria-hidden="true">
              {reportModal.status === "loading" ? "" : reportModal.status === "success" ? "✓" : "×"}
            </span>
            <h2 id="report-modal-title">
              {reportModal.status === "loading"
                ? "Generating report"
                : reportModal.status === "success"
                ? "Report generated successfully"
                : "Report generation failed"}
            </h2>
            <p>
              {reportModal.status === "loading"
                ? `Creating ${reportModal.format.toUpperCase()} report "${reportModal.name}"…`
                : reportModal.status === "success"
                ? `"${reportModal.name}" was generated successfully as a ${reportModal.format.toUpperCase()} report.`
                : reportModal.message}
            </p>
            {reportModal.status !== "loading" && (
              <button type="button" onClick={() => setReportModal(null)}>
                Done
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default ManagerReports;