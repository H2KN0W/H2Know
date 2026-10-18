import { motion, useReducedMotion } from "motion/react";
import { ANIMATION_DURATIONS } from "../../config/constants";

/**
 * AnimatedRow — table row with stagger fade-in on first load for the first ~10 rows,
 * and optional pulse/highlight when newly triggered.
 */
export default function AnimatedRow({
  index = 0,
  isNew = false,
  className = "",
  children,
  onClick,
  ...props
}) {
  const shouldReduceMotion = useReducedMotion();

  // Only animate the first 10 rows to maintain high table performance
  const shouldAnimate = !shouldReduceMotion && index < 10;
  const delay = index * ANIMATION_DURATIONS.STAGGER;

  const rowClasses = [
    className,
    isNew ? "row-new-alert" : "",
  ].filter(Boolean).join(" ");

  if (!shouldAnimate) {
    return (
      <tr className={rowClasses} onClick={onClick} {...props}>
        {children}
      </tr>
    );
  }

  return (
    <motion.tr
      className={rowClasses}
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay, ease: "easeOut" }}
      {...props}
    >
      {children}
    </motion.tr>
  );
}
