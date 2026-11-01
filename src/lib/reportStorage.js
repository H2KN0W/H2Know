import { supabase } from "./supabase";

/**
 * Derives the standard storage file path for a report.
 * Reports are stored as `reports/${report.id}.${report.format}`.
 *
 * @param {{ id: string, format: string }} report
 * @returns {string}
 */
export const getReportStoragePath = (report) => {
  if (!report?.id || !report?.format) {
    throw new Error("Invalid report: id and format are required.");
  }
  return `reports/${report.id}.${report.format.toLowerCase()}`;
};

/**
 * Downloads a report file blob from Supabase Storage using the active session.
 * Does not rely on public URLs or file_url, respecting private storage bucket policies.
 *
 * @param {{ id: string, format: string, report_name?: string }} report
 * @returns {Promise<Blob>}
 * @throws {Error} Clear user-facing error message if not found or unauthorized.
 */
export const fetchReportBlob = async (report) => {
  if (!report?.id || !report?.format) {
    throw new Error("Report details are incomplete. Cannot download file.");
  }

  const filePath = getReportStoragePath(report);

  const { data, error } = await supabase.storage
    .from("reports")
    .download(filePath);

  if (error) {
    const errorMsg = error.message?.toLowerCase() || "";
    if (
      errorMsg.includes("not found") ||
      errorMsg.includes("404") ||
      errorMsg.includes("object not found")
    ) {
      throw new Error(
        "The report file is no longer available in storage. Please generate a new report."
      );
    }
    if (errorMsg.includes("unauthorized") || errorMsg.includes("403")) {
      throw new Error(
        "You do not have permission to access this report file."
      );
    }
    throw new Error(
      error.message ||
        "The report file is no longer available. Please generate a new report."
    );
  }

  if (!data) {
    throw new Error(
      "The report file is no longer available. Please generate a new report."
    );
  }

  return data;
};

/**
 * Helper to trigger browser download for a Blob with a sanitized file name.
 *
 * @param {Blob} blob
 * @param {string} [name]
 * @param {string} [format="pdf"]
 */
export const downloadReportBlob = (blob, name = "report", format = "pdf") => {
  const safeName =
    (name || "report").trim().replace(/[\\/:*?"<>|]/g, "_") || "water-quality-report";
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${safeName}.${format.toLowerCase()}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
