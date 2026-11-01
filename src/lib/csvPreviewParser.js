/**
 * Lightweight, robust CSV parser for in-browser preview without third-party dependencies.
 * Handles:
 * - Commas inside quoted strings (e.g. "Los Angeles, CA")
 * - Escaped quotes ("" -> ")
 * - Newlines inside quotes
 * - CRLF and LF line breaks
 * - Max row limit (default: 50)
 *
 * @param {string} text
 * @param {number} [maxRows=50]
 * @returns {{ headers: string[], rows: string[][], totalRowsCount: number, hasMore: boolean }}
 */
export function parseCsvPreview(text, maxRows = 50) {
  if (!text || typeof text !== "string") {
    return { headers: [], rows: [], totalRowsCount: 0, hasMore: false };
  }

  const allRecords = [];
  let currentRecord = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRecord.push(currentField);
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++; // skip \n of CRLF
      }
      currentRecord.push(currentField);
      // Only push non-empty records (ignore trailing blank lines)
      if (currentRecord.some((f) => f.trim().length > 0)) {
        allRecords.push(currentRecord);
      }
      currentRecord = [];
      currentField = "";
    } else {
      currentField += char;
    }
  }

  // Final field & record if text doesn't end with newline
  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField);
    if (currentRecord.some((f) => f.trim().length > 0)) {
      allRecords.push(currentRecord);
    }
  }

  if (allRecords.length === 0) {
    return { headers: [], rows: [], totalRowsCount: 0, hasMore: false };
  }

  const headers = allRecords[0];
  const dataRows = allRecords.slice(1);
  const totalRowsCount = dataRows.length;
  const slicedRows = dataRows.slice(0, maxRows);
  const hasMore = totalRowsCount > maxRows;

  return {
    headers,
    rows: slicedRows,
    totalRowsCount,
    hasMore,
  };
}
