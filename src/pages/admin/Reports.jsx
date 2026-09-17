import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/admin/AdminDashboard.css";
import "../../styles/admin/Reports.css";
import { useLogPageView } from "../../lib/useLogPageView";
import { logActivity } from "../../lib/logActivity";
import Sidebar from "../../components/Sidebar";

const PAGE_SIZE = 15;

/**
 * Reports — Admin page.
 * Lists rows from the `reports` table (generated_by -> profiles,
 * site_id -> monitoring_sites) and lets an admin kick off a new
 * report for a date range + site.
 *
 * NOTE: this only writes the `reports` row (who/when/range/site).
 * Actual file generation (PDF/CSV) is NOT wired up yet — file_url
 * stays null and the row shows a "Pending" badge until a backend
 * piece (e.g. an Edge Function) fills it in.
 */

const formatDateTime = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const formatDate = (isoString) => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const Reports = () => {
  useLogPageView("Viewed Reports");

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [sites, setSites] = useState([]);
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchReports = async () => {
    setLoading(true);
    setError("");

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error: fetchError, count } = await supabase
      .from("reports")
      .select(
        `id, date_range_start, date_range_end, file_url, created_at,
         profiles ( full_name ),
         monitoring_sites ( name )`,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (fetchError) {
      setError("Could not load reports.");
    } else {
      setReports(data);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  const fetchSites = async () => {
    const { data } = await supabase.from("monitoring_sites").select("id, name");
    if (data) setSites(data);
  };

  const fetchCurrentAdmin = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", session.user.id)
      .single();
    setCurrentAdmin(data);
  };

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    fetchSites();
    fetchCurrentAdmin();
  }, []);

  const handleGenerate = async ({ siteId, startDate, endDate }) => {
    setActionError("");

    if (!currentAdmin) {
      return { success: false, error: "Could not identify the current admin." };
    }
    if (!startDate || !endDate) {
      return { success: false, error: "Please select both a start and end date." };
    }

    const { error: insertError } = await supabase.from("reports").insert({
      generated_by: currentAdmin.id,
      site_id: siteId || null,
      date_range_start: startDate,
      date_range_end: endDate,
      file_url: null,
    });

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    await logActivity({
      user_id: currentAdmin.id,
      full_name: currentAdmin.full_name,
      role: currentAdmin.role,
      activity: `Generated report (${startDate} to ${endDate})`,
      status: "Success",
    });

    setPage(1);
    await fetchReports();
    return { success: true };
  };

  return (
    <div className="admin-shell">
      <Sidebar />

      <main className="admin-main">
        <header className="page-header">
          <h1>Reports</h1>
          <p>Generated water quality summaries for the monitoring site</p>
        </header>

        <div className="rp-toolbar-top">
          <p className="rp-toolbar-note">
            Select a date range to generate a new report.
          </p>
          <button className="rp-generate-btn" onClick={() => setShowGenerateModal(true)}>
            + Generate Report
          </button>
        </div>

        <section className="panel">
          <h2>All Reports</h2>

          {actionError && <p className="rp-action-error">{actionError}</p>}
          {loading && <p>Loading reports...</p>}
          {error && <p style={{ color: "#d64545" }}>{error}</p>}

          {!loading && !error && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Generated At</th>
                      <th>Generated By</th>
                      <th>Site</th>
                      <th>Date Range</th>
                      <th>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.length === 0 && (
                      <tr>
                        <td colSpan={5}>No reports generated yet.</td>
                      </tr>
                    )}
                    {reports.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td>{row.profiles?.full_name || "—"}</td>
                        <td>{row.monitoring_sites?.name || "—"}</td>
                        <td className="data-cell">
                          {formatDate(row.date_range_start)} – {formatDate(row.date_range_end)}
                        </td>
                        <td>
                          {row.file_url ? (
                            <a href={row.file_url} target="_blank" rel="noreferrer">
                              Download
                            </a>
                          ) : (
                            <span className="badge badge-pending">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="um-pagination">
                  <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    ‹
                  </button>
                  <span style={{ fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {showGenerateModal && (
        <GenerateReportModal
          sites={sites}
          onCancel={() => setShowGenerateModal(false)}
          onGenerate={handleGenerate}
        />
      )}
    </div>
  );
};

const GenerateReportModal = ({ sites, onCancel, onGenerate }) => {
  const [siteId, setSiteId] = useState(sites[0]?.id || "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async () => {
    setValidationError("");

    if (!startDate || !endDate) {
      setValidationError("Please select both a start and end date.");
      return;
    }
    if (startDate > endDate) {
      setValidationError("Start date must be before the end date.");
      return;
    }

    setSaving(true);
    const result = await onGenerate({ siteId, startDate, endDate });
    setSaving(false);

    if (!result.success) {
      setValidationError(result.error);
      return;
    }

    setSaved(true);
    setTimeout(() => {
      onCancel();
    }, 1100);
  };

  return (
    <div className="rp-modal-overlay" onClick={saving ? undefined : onCancel}>
      <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
        {saved ? (
          <div className="rp-modal-success">
            <div className="rp-modal-success-check">✓</div>
            <p>Report request submitted</p>
          </div>
        ) : (
          <>
            <h2>Generate Report</h2>

            {validationError && (
              <div className="rp-modal-error">
                <span className="rp-modal-error-icon">!</span>
                <span>{validationError}</span>
              </div>
            )}

            {sites.length > 0 && (
              <>
                <label className="rp-modal-label">Site</label>
                <select
                  className="rp-modal-input"
                  value={siteId}
                  disabled={saving}
                  onChange={(e) => setSiteId(e.target.value)}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="rp-modal-label">Start Date</label>
            <input
              type="date"
              className="rp-modal-input"
              value={startDate}
              disabled={saving}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
            />

            <label className="rp-modal-label">End Date</label>
            <input
              type="date"
              className="rp-modal-input"
              value={endDate}
              disabled={saving}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />

            <p className="rp-modal-note">
              This creates the report record. File generation isn't wired up yet —
              the report will show as "Pending" until that's connected.
            </p>

            <div className="rp-modal-actions">
              <button className="rp-modal-cancel" onClick={onCancel} disabled={saving}>
                Cancel
              </button>
              <button className="rp-modal-save" onClick={handleSubmit} disabled={saving}>
                {saving ? (
                  <span className="rp-modal-save-loading">
                    <span className="spinner" role="status" aria-label="Saving" />
                    Generating...
                  </span>
                ) : (
                  "Generate"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Reports;