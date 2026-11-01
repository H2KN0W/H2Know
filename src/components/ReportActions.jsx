import { Download, Eye } from "lucide-react";
import ButtonSpinner from "./ui/ButtonSpinner";
import "../styles/ReportActions.css";

/**
 * ReportActions
 *
 * Consistent Action buttons for Download and Preview across Manager and Admin report tables.
 *
 * Rules:
 * - Enabled only when status === 'success'
 * - Disabled with informative tooltips when status === 'pending' or 'failed'
 * - Displays per-row spinner and disabled state during active download
 * - Responsive: text + icon on desktop, icon-only on compact mobile screens
 *
 * @param {{
 *   report: object,
 *   onDownload: (report: object) => void,
 *   onPreview: (report: object) => void,
 *   isDownloading?: boolean
 * }} props
 */
export default function ReportActions({
  report,
  onDownload,
  onPreview,
  isDownloading = false,
}) {
  const isSuccess = report?.status === "success";
  const isPending = report?.status === "pending";
  const isFailed = report?.status === "failed";

  const getTooltip = (baseAction) => {
    if (isPending) return "Report is still generating";
    if (isFailed) return "Report generation failed";
    if (!isSuccess) return "Report is unavailable";
    return `${baseAction} report`;
  };

  return (
    <div className="report-actions-group">
      {/* Preview Button */}
      <button
        type="button"
        className="report-action-btn report-action-preview"
        onClick={() => onPreview(report)}
        disabled={!isSuccess || isDownloading}
        title={getTooltip("Preview")}
        aria-label={`Preview ${report?.report_name || "report"}`}
      >
        <Eye size={14} className="report-action-icon" />
        <span className="report-action-label">Preview</span>
      </button>

      {/* Download Button */}
      <button
        type="button"
        className="report-action-btn report-action-download"
        onClick={() => onDownload(report)}
        disabled={!isSuccess || isDownloading}
        title={isDownloading ? "Downloading report…" : getTooltip("Download")}
        aria-label={`Download ${report?.report_name || "report"}`}
      >
        {isDownloading ? (
          <>
            <ButtonSpinner size={12} color="#0c4c7c" />
            <span className="report-action-label">Downloading…</span>
          </>
        ) : (
          <>
            <Download size={14} className="report-action-icon" />
            <span className="report-action-label">Download</span>
          </>
        )}
      </button>
    </div>
  );
}
