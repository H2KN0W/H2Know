import Skeleton from "react-loading-skeleton";

/**
 * Skeleton for Admin summary KPI card.
 * Matches .summary-card dimensions exactly to eliminate layout shift.
 */
export function SkeletonKpiCard() {
  return (
    <div className="summary-card" aria-hidden="true" style={{ pointerEvents: "none" }}>
      <div className="summary-card-body" style={{ width: "100%" }}>
        <p className="summary-label" style={{ marginBottom: "6px" }}>
          <Skeleton width={90} height={13} />
        </p>
        <p className="summary-value" style={{ margin: 0 }}>
          <Skeleton width={110} height={24} />
        </p>
      </div>
      <div className="summary-icon">
        <Skeleton circle width={22} height={22} />
      </div>
    </div>
  );
}

/**
 * Skeleton for Manager Dashboard water quality parameter cards (pH, Turbidity, TDS, Temperature).
 * Matches .manager-stat-card dimensions exactly.
 */
export function SkeletonWaterQualityCard() {
  return (
    <article className="manager-stat-card" aria-hidden="true" style={{ pointerEvents: "none" }}>
      <Skeleton circle width={28} height={28} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: "0 0 4px 0" }}>
          <Skeleton width={70} height={12} />
        </p>
        <strong style={{ display: "block", marginBottom: "4px" }}>
          <Skeleton width={100} height={20} />
        </strong>
        <small style={{ display: "block" }}>
          <Skeleton width={120} height={11} />
        </small>
      </div>
    </article>
  );
}

/**
 * Skeleton for Manager Dashboard River Condition card.
 */
export function SkeletonRiverConditionCard() {
  return (
    <article className="manager-stat-card river-condition-card" aria-hidden="true" style={{ pointerEvents: "none" }}>
      <Skeleton circle width={28} height={28} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: "0 0 4px 0" }}>
          <Skeleton width={90} height={12} />
        </p>
        <strong style={{ display: "block", marginBottom: "4px" }}>
          <Skeleton width={80} height={20} />
        </strong>
        <small style={{ display: "block" }}>
          <Skeleton width={180} height={11} />
        </small>
      </div>
    </article>
  );
}

/**
 * Skeleton for Vertical Weather Card on Manager Dashboard.
 */
export function SkeletonWeatherCard() {
  return (
    <article className="vertical-overcast-card" aria-hidden="true" style={{ pointerEvents: "none" }}>
      <div className="voc-top">
        <div className="voc-badge">
          <Skeleton width={70} height={14} borderRadius={999} />
        </div>
        <p className="voc-city">
          <Skeleton width={110} height={18} />
        </p>
        <span className="voc-sub">
          <Skeleton width={130} height={12} />
        </span>
      </div>

      <div className="voc-main" style={{ margin: "20px 0" }}>
        <Skeleton width={56} height={56} borderRadius={16} />
        <div className="voc-temp-block" style={{ flex: 1, marginLeft: "14px" }}>
          <Skeleton width={90} height={36} />
          <Skeleton width={80} height={14} style={{ marginTop: "4px" }} />
        </div>
      </div>

      <div className="voc-table-section">
        <div className="voc-table-header" style={{ marginBottom: "8px" }}>
          <Skeleton width={80} height={14} />
          <Skeleton width={60} height={14} borderRadius={999} />
        </div>
        <table className="voc-table">
          <tbody>
            {[1, 2, 3, 4].map((i) => (
              <tr key={i}>
                <td><Skeleton width={75} height={13} /></td>
                <td className="voc-td-val"><Skeleton width={45} height={13} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

/**
 * Skeleton for Header WeatherWidget chip.
 */
export function SkeletonWeatherWidget() {
  return (
    <div className="weather-widget" aria-hidden="true" style={{ opacity: 0.8 }}>
      <Skeleton circle width={14} height={14} />
      <Skeleton width={100} height={12} borderRadius={999} />
    </div>
  );
}

/**
 * Skeleton for Insights parameter scorecards.
 */
export function SkeletonInsightScorecard() {
  return (
    <article className="unified-param-card" aria-hidden="true" style={{ pointerEvents: "none" }}>
      <div className="unified-param-card-header">
        <div className="unified-param-title">
          <Skeleton circle width={16} height={16} />
          <Skeleton width={70} height={14} style={{ marginLeft: "8px" }} />
        </div>
        <Skeleton width={65} height={18} borderRadius={999} />
      </div>
      <div className="unified-param-value-row" style={{ margin: "14px 0" }}>
        <Skeleton width={90} height={26} />
      </div>
      <div className="unified-param-metrics">
        <div className="unified-param-metric">
          <Skeleton width={80} height={12} />
          <Skeleton width={50} height={14} />
        </div>
      </div>
    </article>
  );
}

export default function SkeletonCard({ type = "kpi", count = 1 }) {
  const getCardComponent = () => {
    switch (type) {
      case "water":
        return SkeletonWaterQualityCard;
      case "river":
        return SkeletonRiverConditionCard;
      case "weather":
        return SkeletonWeatherCard;
      case "weather-chip":
        return SkeletonWeatherWidget;
      case "insight":
        return SkeletonInsightScorecard;
      case "kpi":
      default:
        return SkeletonKpiCard;
    }
  };

  const Component = getCardComponent();
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <Component key={index} />
      ))}
    </>
  );
}
