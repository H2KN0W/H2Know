import LoadingAnimation from "../LoadingAnimation";

/**
 * FullPageLoader — branded full-screen loading state for initial auth & session checks.
 * Uses the Lottie animation component with fullScreen backdrop.
 */
export default function FullPageLoader({ message = "Checking authentication..." }) {
  return (
    <LoadingAnimation
      fullScreen={true}
      size={160}
      message={message}
    />
  );
}
