import Skeleton from "react-loading-skeleton";

/**
 * SkeletonChart — matches AnalyticsTrends chart grids and containers to prevent layout shift.
 */
export default function SkeletonChart({ isAll = true }) {
  if (isAll) {
    return (
      <div className="analytics-multiples-grid" aria-hidden="true" style={{ marginTop: "16px" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="analytics-subchart-card" style={{ padding: "16px" }}>
            <div className="analytics-subchart-head" style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Skeleton circle width={10} height={10} />
                <Skeleton width={110} height={16} />
              </div>
              <Skeleton width={180} height={14} />
            </div>
            <div style={{ height: "190px", display: "flex", alignItems: "flex-end", gap: "8px", padding: "10px 0" }}>
              <Skeleton width="100%" height={170} borderRadius={8} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="manager-chart" aria-hidden="true" style={{ marginTop: "16px", padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <Skeleton width={160} height={20} />
        <Skeleton width={200} height={14} />
      </div>
      <div style={{ height: "310px" }}>
        <Skeleton width="100%" height={300} borderRadius={12} />
      </div>
    </div>
  );
}
