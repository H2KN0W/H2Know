import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { MODAL_ANIMATION_VARIANTS } from "../../config/constants";

/**
 * AnimatedModal — modal and dialog wrapper with fade and subtle scale enter-exit transitions.
 * Always renders through AnimatePresence.
 */
export default function AnimatedModal({
  isOpen = true,
  onClose,
  children,
  overlayClassName = "um-modal-overlay",
  modalClassName = "um-modal",
}) {
  const shouldReduceMotion = useReducedMotion();

  const backdropVariants = shouldReduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.1 } },
        exit: { opacity: 0, transition: { duration: 0.1 } },
      }
    : MODAL_ANIMATION_VARIANTS.backdrop;

  const modalVariants = shouldReduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.1 } },
        exit: { opacity: 0, transition: { duration: 0.1 } },
      }
    : MODAL_ANIMATION_VARIANTS.modal;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={overlayClassName}
          onClick={onClose}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={backdropVariants}
        >
          <motion.div
            className={modalClassName}
            onClick={(e) => e.stopPropagation()}
            variants={modalVariants}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
