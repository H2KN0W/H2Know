import { motion } from "motion/react";
import { ClipLoader } from "react-spinners";

/**
 * FullPageLoader — clean, branded full-screen loading state for initial auth & session checks.
 */
export default function FullPageLoader({ message = "Checking authentication..." }) {
  return (
    <div className="fullpage-loader-overlay" role="status" aria-live="polite">
      <motion.div
        className="fullpage-loader-card"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <span className="fullpage-loader-brand">
          H<sub>2</sub>KNOW
        </span>
        <ClipLoader size={26} color="#0C4C7C" speedMultiplier={0.8} />
        <span className="fullpage-loader-text">{message}</span>
      </motion.div>
    </div>
  );
}
