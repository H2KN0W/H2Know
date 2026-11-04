import React, { useState, useEffect, useRef } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

export const LOTTIE_LOADER_SRC =
  "https://lottie.host/63efa922-6b17-4bb1-a0e1-a6e7d31f1b39/WQlMeX7Tti.lottie";

/**
 * LoadingAnimation - Reusable DotLottie animation loader.
 *
 * Requirements:
 * - Uses @lottiefiles/dotlottie-react with the .lottie asset URL
 * - loop & autoplay enabled
 * - Props:
 *     - size (number | string, default 160)
 *     - fullScreen (boolean, default false - centers over viewport with backdrop)
 *     - message (optional text displayed below animation)
 *     - className (optional custom wrapper class)
 *     - style (optional custom wrapper styles)
 * - Accessibility: role="status", aria-live="polite", visually hidden "Loading..." label
 * - Fallback: Gracefully falls back to a CSS spinner on load error / timeout
 * - Adapts to light/dark mode and maintains exact bounding dimensions to avoid layout shift
 */
export default function LoadingAnimation({
  size = 160,
  fullScreen = false,
  message,
  className = "",
  style = {},
}) {
  const [hasError, setHasError] = useState(false);
  const dotLottieRef = useRef(null);

  const numericSize = typeof size === "number" ? size : parseInt(size, 10) || 160;
  const isInline = !fullScreen && numericSize <= 32;

  // Track DotLottie instance and listen for load / render errors
  const handleDotLottieRef = (instance) => {
    dotLottieRef.current = instance;
    if (!instance) return;

    const handleError = () => {
      setHasError(true);
    };

    instance.addEventListener("loadError", handleError);
    instance.addEventListener("renderError", handleError);
  };

  // Fallback safety timeout: if animation doesn't load within 8s, show spinner
  useEffect(() => {
    if (hasError) return;
    const timer = setTimeout(() => {
      if (dotLottieRef.current && !dotLottieRef.current.isLoaded) {
        setHasError(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [hasError]);

  const spinnerSize = Math.max(12, Math.min(numericSize * 0.45, 40));

  const renderContent = () => (
    <div
      className={`loading-animation-container ${isInline ? "loading-animation-inline" : "loading-animation-block"}`}
      style={{
        display: isInline ? "inline-flex" : "flex",
        flexDirection: isInline ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: message ? (numericSize <= 48 ? "6px" : "12px") : 0,
      }}
    >
      <div
        className="loading-animation-canvas-wrap"
        style={{
          width: `${numericSize}px`,
          height: `${numericSize}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          flexShrink: 0,
        }}
      >
        {!hasError ? (
          <DotLottieReact
            src={LOTTIE_LOADER_SRC}
            loop
            autoplay
            dotLottieRefCallback={handleDotLottieRef}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
        ) : (
          <span
            className="loading-animation-fallback-spinner"
            style={{
              width: `${spinnerSize}px`,
              height: `${spinnerSize}px`,
              border: `${Math.max(2, Math.round(spinnerSize / 8))}px solid rgba(12, 76, 124, 0.2)`,
              borderTopColor: "var(--color-primary, #0C4C7C)",
              borderRadius: "50%",
              animation: "loading-animation-spin 0.75s linear infinite",
              display: "inline-block",
              boxSizing: "border-box",
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {message && (
        <span
          className="loading-animation-message"
          style={{
            fontSize: numericSize <= 48 ? "0.8125rem" : "0.9375rem",
            fontWeight: 500,
            color: "var(--color-text, #0a2e3d)",
            textAlign: "center",
            letterSpacing: "-0.01em",
            lineHeight: 1.4,
          }}
        >
          {message}
        </span>
      )}
    </div>
  );

  const visuallyHiddenText = message ? `Loading: ${message}` : "Loading...";

  if (fullScreen) {
    return (
      <div
        className={`loading-animation-fullscreen-backdrop ${className}`}
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(255, 255, 255, 0.88)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          ...style,
        }}
      >
        <span className="sr-only" style={srOnlyStyle}>
          {visuallyHiddenText}
        </span>
        {renderContent()}
      </div>
    );
  }

  return (
    <div
      className={`loading-animation-wrapper ${className}`}
      role="status"
      aria-live="polite"
      style={{
        display: isInline ? "inline-flex" : "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      <span className="sr-only" style={srOnlyStyle}>
        {visuallyHiddenText}
      </span>
      {renderContent()}
    </div>
  );
}

const srOnlyStyle = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};
