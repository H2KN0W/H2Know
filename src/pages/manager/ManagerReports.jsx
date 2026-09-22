import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLogPageView } from "../../lib/useLogPageView";
import { logActivity } from "../../lib/logActivity";
import { generateReportFile } from "../../lib/generateReport";
import ManagerSidebar from "./ManagerSidebar";
import "../../styles/manager/ManagerPortal.css";
import "../../styles/manager/ManagerReports.css";

const PAGE_SIZE = 15;
const ALL_VALUE = "all";
const formatDateTime = (value) => value ? new Date(value).toLocaleString() : "—";
const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "—";

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
  const [success, setSuccess] = useState(null); // { name, url, format }
  const [form, setForm] = useState({ name: "", parameterIds: [], startDate: "", endDate: "", format: "pdf" });

  const fetchReports = async () => {
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const { data, error: fetchError, count } = await supabase
      .from("reports")
      .select("id, report_name, parameters, format, date_range_start, date_range_end, file_url, created_at, profiles ( full_name )", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (fetchError) setError("Could not load reports. Apply the manager portal migration before using report metadata.");
    else { setReports(data || []); setTotalCount(count || 0); }
    setLoading(false);
  };

  // fetchReports is reused after a report submission.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchReports(); }, [page]);

  useEffect(() => {
    Promise.all([
      supabase.from("parameters").select("id, name").order("name"),
      supabase.auth.getSession()
    ]).then(async ([parameterResult, sessionResult]) => {
      setParameters((parameterResult.data || []).filter((item) => item.name?.toLowerCase() !== "water level"));
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

  // Auto-dismiss the success banner after a few seconds so it doesn't linger forever.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 8000);
    return () => clearTimeout(timer);
  }, [success]);

  const toggleParameter = (id) => setForm((current) => ({
    ...current,
    parameterIds: current.parameterIds.includes(id)
      ? current.parameterIds.filter((item) => item !== id)
      : [...current.parameterIds, id]
  }));

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess(null);

    if (!currentUser) { setError("Your profile hasn't finished loading yet. Please wait a moment and try again."); return; }
    if (!form.name.trim()) { setError("Enter a report name."); return; }
    if (form.parameterIds.length === 0) { setError("Select at least one parameter."); return; }
    if (!form.startDate || !form.endDate) { setError("Choose a start and end date."); return; }
    if (form.startDate > form.endDate) { setError("Start date must be before end date."); return; }

    setSaving(true);
    const parameterNames = form.parameterIds.includes(ALL_VALUE)
      ? ["All Parameters"]
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

    if (insertError) { setError(insertError.message); setSaving(false); return; }

    try {
      const fileUrl = await generateReportFile({ form, parameters, reportId: inserted.id });
      await supabase.from("reports").update({ file_url: fileUrl }).eq("id", inserted.id);
      await logActivity({
        user_id: currentUser.id,
        full_name: currentUser.full_name,
        role: currentUser.role,
        activity: `Requested ${form.format.toUpperCase()} report: ${form.name}`,
        status: "Success"
      });
      setSuccess({ name: form.name, url: fileUrl, format: form.format });
    } catch (genError) {
      console.error("Report generation failed:", genError);
      setError("Report was requested but generation failed: " + genError.message);
    }

    setForm({ name: "", parameterIds: [], startDate: "", endDate: "", format: "pdf" });
    setPage(1);
    await fetchReports();
    setSaving(false);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="admin-shell">
      <ManagerSidebar />
      <main className="admin-main manager-main">
        <header className="page-header">
          <h1>Reports</h1>
          <p>Request water-quality summaries and download completed reports</p>
        </header>

        {success && (
          <div className="manager-success-banner" role="status">
            <span className="manager-success-icon" aria-hidden="true">✓</span>
            <div className="manager-success-text">
              <strong>“{success.name}” is ready.</strong>
              <span> Your {success.format.toUpperCase()} report has finished generating.</span>
            </div>
            <a
              className="manager-success-download"
              href={success.url}
              target="_blank"
              rel="noreferrer"
            >
              Download
            </a>
            <button
              type="button"
              className="manager-success-dismiss"
              onClick={() => setSuccess(null)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        <section className="manager-panel">
          <h2>Generate New Report</h2>
          <form className="manager-report-form" onSubmit={submit}>
            <label>
              Report name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekly water quality summary" />
            </label>
            <fieldset>
              <legend>Parameters</legend>
              <div className="manager-checkboxes">
                <label>
                  <input type="checkbox" checked={form.parameterIds.includes(ALL_VALUE)} onChange={() => toggleParameter(ALL_VALUE)} /> All Parameters
                </label>
                {parameters.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={form.parameterIds.includes(item.id)}
                      onChange={() => toggleParameter(item.id)}
                      disabled={form.parameterIds.includes(ALL_VALUE)}
                    /> {item.name}
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
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
              </select>
            </label>
            <button type="submit" disabled={saving}>{saving ? "Generating..." : "Generate report"}</button>
          </form>
          {error && <p className="manager-error">{error}</p>}
        </section>
        <section className="manager-panel">
          <h2>Report History</h2>
          {loading ? <p>Loading reports...</p> : (
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
                        <td data-label="Parameters">{report.parameters?.join(", ") || "All parameters"}</td>
                        <td data-label="Format">{report.format?.toUpperCase() || "PDF"}</td>
                        <td data-label="Status">
                          {report.file_url
                            ? <a className="badge badge-ready" href={report.file_url} target="_blank" rel="noreferrer">Ready — Download</a>
                            : <span className="badge badge-pending">Generating…</span>}
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
    </div>
  );
};

export default ManagerReports;