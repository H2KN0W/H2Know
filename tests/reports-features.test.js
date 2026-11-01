import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvPreview } from "../src/lib/csvPreviewParser.js";

test("CSV parser: parses simple headers and rows", () => {
  const csv = "Date,pH,Turbidity\n2026-10-01,7.2,1.5\n2026-10-02,7.4,1.8";
  const result = parseCsvPreview(csv);

  assert.deepEqual(result.headers, ["Date", "pH", "Turbidity"]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], ["2026-10-01", "7.2", "1.5"]);
  assert.deepEqual(result.rows[1], ["2026-10-02", "7.4", "1.8"]);
  assert.equal(result.totalRowsCount, 2);
  assert.equal(result.hasMore, false);
});

test("CSV parser: handles quoted values with commas inside quotes", () => {
  const csv = 'Site,Description,Status\n"Main Basin","Clean, calm water",Active\n"East Runoff","Turbid, heavy flow",Warning';
  const result = parseCsvPreview(csv);

  assert.deepEqual(result.headers, ["Site", "Description", "Status"]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0][1], "Clean, calm water");
  assert.equal(result.rows[1][1], "Turbid, heavy flow");
});

test("CSV parser: handles escaped quotes (double quotes)", () => {
  const csv = 'Name,Note\n"Sensor #1","Calibrated with ""Standard 7.0"""\n"Sensor #2","OK"';
  const result = parseCsvPreview(csv);

  assert.equal(result.rows[0][1], 'Calibrated with "Standard 7.0"');
  assert.equal(result.rows[1][1], "OK");
});

test("CSV parser: handles empty cells properly", () => {
  const csv = "A,B,C,D\n1,,3,\n,2,,4";
  const result = parseCsvPreview(csv);

  assert.deepEqual(result.headers, ["A", "B", "C", "D"]);
  assert.deepEqual(result.rows[0], ["1", "", "3", ""]);
  assert.deepEqual(result.rows[1], ["", "2", "", "4"]);
});

test("CSV parser: respects 50-row cap and reports hasMore = true", () => {
  const rows = ["ID,Value"];
  for (let i = 1; i <= 75; i++) {
    rows.push(`${i},val_${i}`);
  }
  const csv = rows.join("\n");
  const result = parseCsvPreview(csv, 50);

  assert.equal(result.headers.length, 2);
  assert.equal(result.rows.length, 50);
  assert.equal(result.totalRowsCount, 75);
  assert.equal(result.hasMore, true);
  assert.equal(result.rows[0][0], "1");
  assert.equal(result.rows[49][0], "50");
});

test("CSV parser: handles CRLF Windows line endings", () => {
  const csv = "col1,col2\r\nval1,val2\r\nval3,val4\r\n";
  const result = parseCsvPreview(csv);

  assert.deepEqual(result.headers, ["col1", "col2"]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], ["val1", "val2"]);
  assert.deepEqual(result.rows[1], ["val3", "val4"]);
});

test("CSV parser: handles empty or invalid input safely", () => {
  assert.deepEqual(parseCsvPreview(""), { headers: [], rows: [], totalRowsCount: 0, hasMore: false });
  assert.deepEqual(parseCsvPreview(null), { headers: [], rows: [], totalRowsCount: 0, hasMore: false });
  assert.deepEqual(parseCsvPreview(undefined), { headers: [], rows: [], totalRowsCount: 0, hasMore: false });
});

test("Report status enabling logic: only 'success' enables actions", () => {
  const getActionState = (status) => {
    const isSuccess = status === "success";
    const isPending = status === "pending";
    const isFailed = status === "failed";
    const disabled = !isSuccess;

    let tooltip = "";
    if (isPending) tooltip = "Report is still generating";
    else if (isFailed) tooltip = "Report generation failed";
    else if (!isSuccess) tooltip = "Report is unavailable";
    else tooltip = "Action enabled";

    return { disabled, tooltip };
  };

  // Success
  const success = getActionState("success");
  assert.equal(success.disabled, false);
  assert.equal(success.tooltip, "Action enabled");

  // Pending
  const pending = getActionState("pending");
  assert.equal(pending.disabled, true);
  assert.equal(pending.tooltip, "Report is still generating");

  // Failed
  const failed = getActionState("failed");
  assert.equal(failed.disabled, true);
  assert.equal(failed.tooltip, "Report generation failed");
});
