import { motion, useReducedMotion } from "motion/react";

/**
 * LiveValue — renders a live telemetry or KPI value with a subtle smooth fade when it changes.
 * Avoids aggressive layout shifts or distracting jumps.
 */
export default function LiveValue({ value, unit = "", className = "", style = {} }) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return (
      <span className={className} style={style}>
        {value} {unit}
      </span>
    );
  }

  return (
    <motion.span
      key={String(value)}
      initial={{ opacity: 0.5, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={className}
      style={{ display: "inline-block", ...style }}
    >
      {value} {unit}
    </motion.span>
  );
}
