import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Droplets,
  Gauge,
  Waves,
  Thermometer,
  RefreshCw,
  ClipboardCheck,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { logActivity } from "../../lib/logActivity";
import { generateReportFile } from "../../lib/generateReport";
import { buildSensorSummary } from "../../lib/insights";
import { fetchReportBlob, downloadReportBlob } from "../../lib/reportStorage";
import ReportPreviewModal from "../../components/ReportPreviewModal";
import ReportActions from "../../components/ReportActions";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/ManagerReports.css";

import { formatDateTime, formatDate, formatReportParameters } from "../../lib/formatters";
import { PAGE_SIZES, filterMonitoredParameters } from "../../config/constants";
import {
  PageTransition,
  LoadingAnimation,
  ButtonSpinner,
  SkeletonTableRows,
  AnimatedRow,
  AnimatedModal,
} from "../../components/ui";

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

  // Empirical baseline & compliance state for report preview
  const [thresholds, setThresholds] = useState([]);
  const [recentReadings, setRecentReadings] = useState([]);
  const [empiricalSummary, setEmpiricalSummary] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // History action state
  const [downloadingReportId, setDownloadingReportId] = useState(null);
  const [previewReport, setPreviewReport] = useState(null);
  const [historyError, setHistoryError] = useState("");

  const handleDownloadReport = async (report) => {
    if (!report || report.status !== "success") return;
    setDownloadingReportId(report.id);
    setHistoryError("");
    try {
      const blob = await fetchReportBlob(report);
      downloadReportBlob(blob, report.report_name, report.format);
      try {
        await logActivity({
          activity: `Re-downloaded ${report.format?.toUpperCase() || "PDF"} report: ${report.report_name}`,
          status: "Success",
        });
      } catch (logErr) {
        console.warn("Failed to log report re-download activity:", logErr);
      }
    } catch (err) {
      console.error("Re-download failed:", err);
      setHistoryError(err.message || "The report file is no longer available. Please generate a new report.");
    } finally {
      setDownloadingReportId(null);
    }
  };

  const handleOpenPreview = async (report) => {
    if (!report || report.status !== "success") return;
    setPreviewReport(report);
    try {
      await logActivity({
        activity: `Previewed ${report.format?.toUpperCase() || "PDF"} report: ${report.report_name}`,
        status: "Success",
      });
    } catch (logErr) {
      console.warn("Failed to log report preview activity:", logErr);
    }
  };

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
      supabase.from("thresholds").select("parameter_id, min_value, max_value, severity_label"),
      supabase.auth.getSession()
    ]).then(async ([parameterResult, thresholdResult, sessionResult]) => {
      setParameters(filterMonitoredParameters(parameterResult.data));
      setThresholds(thresholdResult.data || []);
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

  // Load empirical baseline summary from verified readings
  const loadComplianceAuditPreview = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: readData } = await supabase
        .from("sensor_readings")
        .select("id, value, recorded_at, parameter_id, parameters ( id, name, unit )")
        .gte("recorded_at", from)
        .order("recorded_at", { ascending: false })
        .limit(1000);

      const rows = readData || [];
      setRecentReadings(rows);
      const summary = buildSensorSummary(rows, thresholds, 7);
      setEmpiricalSummary(summary);
    } catch (e) {
      console.warn("Compliance summary preview unavailable:", e.message);
    } finally {
      setInsightsLoading(false);
    }
  }, [thresholds]);

  useEffect(() => {
    if (thresholds.length > 0) {
      loadComplianceAuditPreview();
    }
  }, [thresholds, loadComplianceAuditPreview]);

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

    const rangeStart = String(form.startDate).slice(0, 10);
    const rangeEnd = String(form.endDate).slice(0, 10);
    const rangeForm = { ...form, startDate: rangeStart, endDate: rangeEnd };

    const { data: inserted, error: insertError } = await supabase
      .from("reports")
      .insert({
        generated_by: currentUser.id,
        report_name: form.name,
        parameters: parameterNames,
        format: form.format,
        date_range_start: rangeStart,
        date_range_end: rangeEnd,
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
        form: rangeForm,
        parameters,
        reportId: inserted.id,
        authorName: currentUser.full_name || "Manager",
        thresholds,
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

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <PageTransition className="admin-main manager-main">
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
              <button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <ButtonSpinner size={13} color="#ffffff" />
                    <span>Generating…</span>
                  </>
                ) : (
                  "Generate report"
                )}
              </button>
            </form>
            {error && <p className="manager-error">{error}</p>}
          </section>

          {/* ── Right: Empirical Compliance Audit Preview Panel ── */}
          <aside className="manager-panel mr-insights-panel" aria-label="Empirical Compliance Audit Preview">
            <div className="mr-panel-header">
              <ClipboardCheck size={18} className="mr-panel-icon" style={{ color: "var(--manager-accent, #0C4C7C)" }} />
              <h2>Compliance Audit Preview</h2>
              <button
                type="button"
                className="mr-refresh-btn"
                onClick={loadComplianceAuditPreview}
                disabled={insightsLoading}
                title="Refresh compliance audit"
                aria-label="Refresh compliance preview"
              >
                <RefreshCw size={13} className={insightsLoading ? "spin" : ""} />
              </button>
            </div>
            <p className="mr-insights-sub">
              Deterministic DENR Class C compliance metrics that will be embedded into your official report.
            </p>

            {insightsLoading ? (
              <div className="mr-insights-loading">
                <LoadingAnimation size={36} message="Fetching AI analysis…" />
              </div>
            ) : !empiricalSummary ? (
              <div className="mr-insights-empty">
                <AlertTriangle size={18} />
                <span>No telemetry available for compliance audit preview. PDF will render using available date range.</span>
              </div>
            ) : (
              <div className="mr-insights-body">

                {/* Condition Banner */}
                <div className={`mr-risk-banner is-${empiricalSummary.overallBadge || "low"}`}>
                  {empiricalSummary.overallBadge === "optimal" ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />}
                  <div>
                    <span className="mr-risk-label">Watershed Condition</span>
                    <strong className="mr-risk-val">{(empiricalSummary.overallCondition || "Compliant").toUpperCase()}</strong>
                  </div>
                  <div className="mr-rain-stat">
                    <span>{recentReadings.length} verified samples (7d)</span>
                  </div>
                </div>

                {/* Key diagnostic observations */}
                {empiricalSummary.interpretations?.length > 0 && (
                  <div className="mr-observations">
                    <span className="mr-obs-title">Diagnostic Telemetry Observations</span>
                    <ul className="mr-obs-list">
                      {empiricalSummary.interpretations.slice(0, 3).map((interp, idx) => (
                        <li key={idx} className="mr-obs-item">
                          <span className="mr-obs-bullet" />
                          <span><strong>{interp.title}:</strong> {interp.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Parameter icons row with compliance status */}
                <div className="mr-param-row">
                  {["pH", "TDS", "Turbidity", "Temperature"].map((param) => {
                    const Icon = PARAM_ICONS[param] || Droplets;
                    const stat = empiricalSummary.parameterStats?.[param];
                    const complianceLabel = stat?.hasData
                      ? (stat.complianceRate >= 95 ? "100% In-Spec" : `${stat.complianceRate.toFixed(0)}% In-Spec`)
                      : "No Data";

                    return (
                      <div key={param} className="mr-param-chip" title={`${param}: ${complianceLabel}`}>
                        <Icon size={14} />
                        <span>{param}</span>
                      </div>
                    );
                  })}
                </div>

                <p className="mr-ai-stamp">
                  <ShieldCheck size={12} />
                  100% Deterministic Math · DAO 2016-08 Class C Criteria · Auditable
                </p>
              </div>
            )}
          </aside>
        </div>

        {/* ── Report History ── */}
        <section className="manager-panel">
          <h2>Report History</h2>
          {historyError && (
            <div className="manager-error" style={{ marginBottom: "12px" }}>
              {historyError}
            </div>
          )}
          <div className="table-wrap">
            <table className="manager-reports-table">
              <thead>
                <tr>
                  <th>Name</th><th>Date generated</th><th>Range covered</th><th>Parameters</th><th>Format</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRows rows={PAGE_SIZE} columns={7} />
                ) : reports.length === 0 ? (
                  <tr><td colSpan={7}>No reports generated yet.</td></tr>
                ) : reports.map((report, idx) => (
                  <AnimatedRow key={report.id} index={idx}>
                    <td data-label="Name">{report.report_name || "Untitled report"}</td>
                    <td data-label="Date generated">{formatDateTime(report.created_at)}</td>
                    <td data-label="Range covered">{formatDate(report.date_range_start)} – {formatDate(report.date_range_end)}</td>
                    <td data-label="Parameters">{formatReportParameters(report.parameters)}</td>
                    <td data-label="Format">{report.format?.toUpperCase() || "PDF"}</td>
                    <td data-label="Status">
                      {report.status === "success"
                        ? <span className="badge badge-ready">✓ Success</span>
                        : report.status === "pending"
                        ? <span className="badge badge-pending">⋯ Pending</span>
                        : <span className="badge badge-failed">× Failed</span>}
                    </td>
                    <td data-label="Actions">
                      <ReportActions
                        report={report}
                        onDownload={handleDownloadReport}
                        onPreview={handleOpenPreview}
                        isDownloading={downloadingReportId === report.id}
                      />
                    </td>
                  </AnimatedRow>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && totalPages > 1 && (
            <div className="um-pagination">
              <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>‹</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>›</button>
            </div>
          )}
        </section>
      </PageTransition>

      <ReportPreviewModal
        report={previewReport}
        isOpen={Boolean(previewReport)}
        onClose={() => setPreviewReport(null)}
        onDownloaded={(rep) => {
          logActivity({
            activity: `Re-downloaded ${rep.format?.toUpperCase() || "PDF"} report: ${rep.report_name}`,
            status: "Success",
          }).catch((e) => console.warn("Failed to log activity:", e));
        }}
      />

      <AnimatedModal
        isOpen={Boolean(reportModal)}
        onClose={() => reportModal?.status !== "loading" && setReportModal(null)}
        overlayClassName="manager-report-modal-backdrop"
        modalClassName={`manager-report-modal manager-report-modal-${reportModal?.status}`}
      >
        {reportModal && (
          <>
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
          </>
        )}
      </AnimatedModal>
    </div>
  );
};

export default ManagerReports;