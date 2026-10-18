import { motion, useReducedMotion } from "motion/react";

/**
 * SlidingTabs — tabs with a sliding underline indicator on selection.
 * Ideal for ManagerAlerts (Active, Reviewed, Resolved) and NodeHealth sub-tabs.
 */
export default function SlidingTabs({
  tabs = [],
  activeTab,
  onChange,
  className = "manager-tabs",
  layoutId = "activeTabUnderline",
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className={`animated-tabs-container ${className}`} role="tablist">
      {tabs.map((tab) => {
        const id = typeof tab === "string" ? tab : tab.id;
        const label = typeof tab === "string" ? tab : tab.label;
        const badge = typeof tab === "object" ? tab.badge : null;
        const Icon = typeof tab === "object" ? tab.icon : null;
        const isActive = activeTab === id;

        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`animated-tab-btn ${isActive ? "active" : ""}`}
            onClick={() => onChange(id)}
          >
            {Icon && <Icon size={15} />}
            <span>{label}</span>
            {badge !== null && badge !== undefined && (
              <span className="tab-badge" style={{
                background: isActive ? "rgba(12, 76, 124, 0.12)" : "rgba(0, 119, 182, 0.08)",
                padding: "2px 7px",
                borderRadius: "999px",
                fontSize: "0.72rem",
                fontWeight: 600,
                marginLeft: "4px"
              }}>
                {badge}
              </span>
            )}
            {isActive && (
              <motion.span
                layoutId={shouldReduceMotion ? undefined : layoutId}
                className="animated-tab-underline"
                transition={{
                  type: "spring",
                  stiffness: 450,
                  damping: 35,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
