import { useEffect, useState, useRef, useCallback } from "react";
import {
  X,
  Download,
  ExternalLink,
  FileText,
  AlertCircle,
  RefreshCw,
  Calendar,
  Layers,
} from "lucide-react";
import AnimatedModal from "./ui/AnimatedModal";
import ButtonSpinner from "./ui/ButtonSpinner";
import { fetchReportBlob, downloadReportBlob } from "../lib/reportStorage";
import { parseCsvPreview } from "../lib/csvPreviewParser";
import { formatDate } from "../lib/formatters";
import "../styles/ReportPreviewModal.css";

const MAX_CSV_PREVIEW_ROWS = 50;

/**
 * ReportPreviewModal
 *
 * Full-featured in-app preview for generated PDF and CSV water-quality reports.
 * - PDF: Rendered in an interactive <iframe> via secure Object URL, with responsive fallback.
 * - CSV: Parsed without third-party libraries and displayed in a horizontally-scrollable table with sticky header.
 * - Focus-trapping, Escape/backdrop closing, body-scroll locking, and safe Object URL revocation.
 *
 * @param {{
 *   report: object | null,
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onDownloaded?: (report: object) => void
 * }} props
 */
export default function ReportPreviewModal({
  report,
  isOpen,
  onClose,
  onDownloaded,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [blob, setBlob] = useState(null);
  const [objectUrl, setObjectUrl] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );

  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Monitor window resize for responsive PDF fallback
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Safe object URL cleanup
  const cleanupUrl = useCallback(() => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }
  }, [objectUrl]);

  // Load report blob when opened
  const loadReport = useCallback(async () => {
    if (!report) return;

    setLoading(true);
    setError(null);
    setCsvData(null);
    cleanupUrl();

    try {
      const fileBlob = await fetchReportBlob(report);
      setBlob(fileBlob);

      const format = report.format?.toLowerCase();
      if (format === "csv") {
        const text = await fileBlob.text();
        const parsed = parseCsvPreview(text, MAX_CSV_PREVIEW_ROWS);
        setCsvData(parsed);
      } else {
        // PDF or default: create Object URL
        const url = URL.createObjectURL(fileBlob);
        setObjectUrl(url);
      }
    } catch (err) {
      console.error("Failed to load report for preview:", err);
      setError(
        err.message ||
          "Could not load the report preview. Please check storage or try downloading directly."
      );
    } finally {
      setLoading(false);
    }
  }, [report, cleanupUrl]);

  // Handle open / close lifecycle
  useEffect(() => {
    if (isOpen && report) {
      previousFocusRef.current = document.activeElement;
      document.body.style.overflow = "hidden";
      loadReport();
    } else {
      document.body.style.overflow = "";
      cleanupUrl();
      setBlob(null);
      setCsvData(null);
      setError(null);
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus();
      }
    }

    return () => {
      document.body.style.overflow = "";
      cleanupUrl();
    };
  }, [isOpen, report]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation: Escape key & focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleDownloadClick = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      let fileBlob = blob;
      if (!fileBlob) {
        fileBlob = await fetchReportBlob(report);
        setBlob(fileBlob);
      }
      downloadReportBlob(fileBlob, report.report_name, report.format);
      if (onDownloaded) {
        onDownloaded(report);
      }
    } catch (err) {
      console.error("Download failed in preview modal:", err);
      setError(err.message || "Failed to download report.");
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenInNewTab = () => {
    if (!objectUrl) return;
    window.open(objectUrl, "_blank", "noopener,noreferrer");
  };

  if (!isOpen || !report) return null;

  const isPdf = report.format?.toLowerCase() === "pdf";
  const isCsv = report.format?.toLowerCase() === "csv";

  return (
    <AnimatedModal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="rpm-overlay"
      modalClassName="rpm-modal"
    >
      <div
        ref={modalRef}
        className="rpm-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpm-title"
      >
        {/* Header */}
        <header className="rpm-header">
          <div className="rpm-header-meta">
            <div className="rpm-title-row">
              <FileText size={18} className="rpm-file-icon" />
              <h2 id="rpm-title" className="rpm-title" title={report.report_name}>
                {report.report_name || "Water Quality Report"}
              </h2>
              <span className={`rpm-badge rpm-badge-${report.format?.toLowerCase()}`}>
                {report.format?.toUpperCase() || "PDF"}
              </span>
            </div>
            <div className="rpm-sub-row">
              <span className="rpm-sub-item">
                <Calendar size={13} />
                <span>
                  {formatDate(report.date_range_start)} – {formatDate(report.date_range_end)}
                </span>
              </span>
              {report.parameters && (
                <span className="rpm-sub-item rpm-sub-params">
                  <Layers size={13} />
                  <span>
                    {Array.isArray(report.parameters)
                      ? report.parameters.join(", ")
                      : report.parameters}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="rpm-header-actions">
            <button
              type="button"
              className="rpm-btn rpm-btn-primary"
              onClick={handleDownloadClick}
              disabled={loading || downloading}
              title="Download full report"
            >
              {downloading ? (
                <>
                  <ButtonSpinner size={13} color="#ffffff" />
                  <span>Downloading…</span>
                </>
              ) : (
                <>
                  <Download size={15} />
                  <span>Download</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="rpm-close-btn"
              onClick={onClose}
              aria-label="Close preview"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Modal Body */}
        <div className="rpm-body">
          {loading ? (
            <div className="rpm-state-box">
              <span className="spinner spinner-dark" role="status" aria-label="Loading preview" />
              <p className="rpm-state-text">Loading report preview…</p>
            </div>
          ) : error ? (
            <div className="rpm-state-box rpm-error-box">
              <AlertCircle size={32} className="rpm-error-icon" />
              <h3 className="rpm-state-heading">Unable to Load Preview</h3>
              <p className="rpm-state-text">{error}</p>
              <div className="rpm-state-actions">
                <button
                  type="button"
                  className="rpm-btn rpm-btn-secondary"
                  onClick={loadReport}
                >
                  <RefreshCw size={14} />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  className="rpm-btn rpm-btn-primary"
                  onClick={handleDownloadClick}
                >
                  <Download size={14} />
                  <span>Download file directly</span>
                </button>
              </div>
            </div>
          ) : isPdf ? (
            isMobile ? (
              <div className="rpm-state-box rpm-fallback-box">
                <FileText size={40} className="rpm-fallback-icon" />
                <h3 className="rpm-state-heading">Preview not supported on this device</h3>
                <p className="rpm-state-text">
                  Mobile web browsers do not render embedded PDF documents inside frames. You can
                  open the document in a new tab or download the file.
                </p>
                <div className="rpm-state-actions">
                  <button
                    type="button"
                    className="rpm-btn rpm-btn-secondary"
                    onClick={handleOpenInNewTab}
                  >
                    <ExternalLink size={14} />
                    <span>Open in new tab</span>
                  </button>
                  <button
                    type="button"
                    className="rpm-btn rpm-btn-primary"
                    onClick={handleDownloadClick}
                  >
                    <Download size={14} />
                    <span>Download PDF</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rpm-pdf-frame-wrap">
                <iframe
                  src={objectUrl || ""}
                  title={`Preview of ${report.report_name}`}
                  className="rpm-pdf-iframe"
                />
              </div>
            )
          ) : isCsv && csvData ? (
            <div className="rpm-csv-wrap">
              <div className="rpm-csv-banner">
                <span>
                  Showing first {csvData.rows.length} rows of {csvData.totalRowsCount} total records.
                  {csvData.hasMore && " Download the file for the complete dataset."}
                </span>
              </div>
              <div className="rpm-csv-table-scroll">
                <table className="rpm-csv-table">
                  <thead>
                    <tr>
                      <th className="rpm-csv-row-num">#</th>
                      {csvData.headers.map((header, idx) => (
                        <th key={idx}>{header || `Col ${idx + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvData.rows.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        <td className="rpm-csv-row-num">{rowIdx + 1}</td>
                        {row.map((cell, cellIdx) => (
                          <td key={cellIdx}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rpm-state-box">
              <p className="rpm-state-text">No preview content available.</p>
            </div>
          )}
        </div>
      </div>
    </AnimatedModal>
  );
}
