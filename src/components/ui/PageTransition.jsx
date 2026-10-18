import { motion, useReducedMotion } from "motion/react";
import { PAGE_TRANSITION_VARIANTS } from "../../config/constants";

/**
 * PageTransition — wraps routed page content with a subtle fade + slight slide-up.
 * Respects prefers-reduced-motion automatically.
 */
export default function PageTransition({ children, className = "", style = {} }) {
  const shouldReduceMotion = useReducedMotion();

  const variants = shouldReduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.1 } },
        exit: { opacity: 0, transition: { duration: 0.1 } },
      }
    : PAGE_TRANSITION_VARIANTS;

  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={variants}
      className={className}
      style={{ width: "100%", ...style }}
    >
      {children}
    </motion.div>
  );
}
