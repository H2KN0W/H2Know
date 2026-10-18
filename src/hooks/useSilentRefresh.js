import { useEffect, useRef, useState, useCallback } from "react";
import { REFRESH_INTERVALS } from "../config/constants";

/**
 * useSilentRefresh - A reusable hook for silent background data refresh
 *
 * Features:
 * - Runs immediately, then every intervalMs
 * - Skips while tab is hidden (Page Visibility API), refreshes once when visible again
 * - No overlapping requests (in-flight guard) with AbortController
 * - Cleans up on unmount
 * - Exponential backoff after repeated errors
 * - Silent updates: never sets main loading state on background refresh
 * - Keeps old data on screen if refresh fails
 * - Optional "last updated" timestamp tracking
 *
 * @param {Function} fetchFn - Async function to fetch data. Should return data or throw on error.
 * @param {Object} options - Configuration options
 * @param {number} options.intervalMs - Refresh interval in milliseconds (default: 60s)
 * @param {boolean} options.enabled - Whether refresh is enabled (default: true)
 * @param {number} options.maxBackoffMs - Maximum backoff interval (default: 5 min)
 * @param {number} options.backoffMultiplier - Multiplier for exponential backoff (default: 2)
 * @param {number} options.maxConsecutiveErrors - Max errors before backing off (default: 3)
 * @param {boolean} options.trackLastUpdated - Whether to track and return last updated timestamp
 * @returns {Object} - { lastUpdated: timestamp | null, isRefreshing: boolean, error: string | null }
 */
export const useSilentRefresh = (fetchFn, options = {}) => {
  const {
    intervalMs = 60000, // Default 60s
    enabled = true,
    maxBackoffMs = 5 * 60 * 1000, // 5 minutes
    backoffMultiplier = 2,
    maxConsecutiveErrors = 3,
    trackLastUpdated = true,
  } = options;

  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Refs to avoid closure issues and prevent re-renders
  const abortControllerRef = useRef(null);
  const inFlightRef = useRef(false);
  const consecutiveErrorsRef = useRef(0);
  const currentIntervalRef = useRef(intervalMs);
  const timerRef = useRef(null);
  const visibilityHandlerRef = useRef(null);
  const wasHiddenRef = useRef(false);

  const executeRefresh = useCallback(async () => {
    // Guard against overlapping requests
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsRefreshing(true);
    setError(null);

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      await fetchFn(abortControllerRef.current.signal);

      // Success: reset error count and interval
      consecutiveErrorsRef.current = 0;
      currentIntervalRef.current = intervalMs;

      if (trackLastUpdated) {
        setLastUpdated(Date.now());
      }
    } catch (err) {
      // Ignore aborted requests (they're intentional)
      if (err.name === "AbortError") {
        return;
      }

      console.error("Silent refresh failed:", err);
      setError(err.message || "Refresh failed");

      // Increment error count and apply backoff
      consecutiveErrorsRef.current += 1;

      if (consecutiveErrorsRef.current >= maxConsecutiveErrors) {
        const newInterval = Math.min(
          currentIntervalRef.current * backoffMultiplier,
          maxBackoffMs
        );
        currentIntervalRef.current = newInterval;
        console.warn(
          `Silent refresh backoff: ${consecutiveErrorsRef.current} consecutive errors, interval now ${newInterval}ms`
        );
      }
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
      abortControllerRef.current = null;
    }
  }, [fetchFn, intervalMs, maxBackoffMs, backoffMultiplier, maxConsecutiveErrors, trackLastUpdated]);

  // Page Visibility API handler
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === "visible" && wasHiddenRef.current) {
      // Tab became visible again - refresh if data is stale (> intervalMs)
      const staleThreshold = lastUpdated ? intervalMs : 0;
      const timeSinceUpdate = lastUpdated ? Date.now() - lastUpdated : Infinity;

      if (timeSinceUpdate > staleThreshold) {
        executeRefresh();
      }
      wasHiddenRef.current = false;
    } else if (document.visibilityState === "hidden") {
      wasHiddenRef.current = true;
    }
  }, [executeRefresh, intervalMs, lastUpdated]);

  // Main effect: set up interval and visibility handler
  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Initial fetch
    executeRefresh();

    // Set up interval
    timerRef.current = setInterval(() => {
      executeRefresh();
    }, currentIntervalRef.current);

    // Set up visibility handler
    visibilityHandlerRef.current = handleVisibilityChange;
    document.addEventListener("visibilitychange", visibilityHandlerRef.current);

    // Cleanup
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (visibilityHandlerRef.current) {
        document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [enabled, executeRefresh, handleVisibilityChange]);

  // Update interval when it changes due to backoff
  useEffect(() => {
    if (!enabled || !timerRef.current) {
      return;
    }

    // Clear and restart timer with new interval
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      executeRefresh();
    }, currentIntervalRef.current);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [currentIntervalRef.current, enabled, executeRefresh]);

  return {
    lastUpdated,
    isRefreshing,
    error,
  };
};

export default useSilentRefresh;
