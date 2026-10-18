import Skeleton from "react-loading-skeleton";

/**
 * SkeletonTableRows — renders placeholder skeleton rows directly inside a <tbody>.
 * Avoids any table structure breakdown or layout shift.
 */
export function SkeletonTableRows({ rows = 5, columns = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <tr key={`skel-row-${rIdx}`} aria-hidden="true">
          {Array.from({ length: columns }).map((_, cIdx) => (
            <td key={`skel-col-${cIdx}`} style={{ padding: "14px 16px" }}>
              <Skeleton
                width={cIdx === 0 ? "75%" : cIdx === columns - 1 ? "60%" : "85%"}
                height={14}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * SkeletonTable — standalone table wrapper with header & skeleton rows.
 */
export default function SkeletonTable({
  headers = [],
  rows = 5,
  columns = 5,
  className = "table-wrap",
}) {
  const colCount = headers.length > 0 ? headers.length : columns;

  return (
    <div className={className} aria-hidden="true">
      <table>
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, idx) => (
                <th key={idx}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          <SkeletonTableRows rows={rows} columns={colCount} />
        </tbody>
      </table>
    </div>
  );
}
