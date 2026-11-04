import LoadingAnimation from "./LoadingAnimation";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Compass,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Maximize,
} from "lucide-react";

/**
 * SurroundingsViewerModal
 *
 * Interactive 360-style surroundings viewer modal for sensor monitoring sites.
 *
 * Modes:
 * 1. "look-around" (default): video acts as a draggable horizontal scrubber.
 *    Dragging left or right scrubs `currentTime` proportionally.
 *    Smooth inertia/easing via requestAnimationFrame lerp toward target time.
 *    Clamp/wrap configurable (clamp by default).
 *    Keyboard Left/Right arrows step scrub time.
 * 2. "play": normal video playback with play/pause controls.
 *    Keyboard Space toggles play/pause.
 *
 * Tunable constants (exported for custom configuration):
 * - DRAG_SENSITIVITY: seconds of video scrubbed per pixel of horizontal drag (default: 0.05 s/px)
 * - LERP_FACTOR: smoothing interpolation rate per animation frame (0 < factor <= 1, default: 0.18)
 * - KEYBOARD_STEP: seconds scrubbed per arrow key press (default: 1.0s)
 * - WRAP_AROUND: whether scrubbing wraps at the ends or clamps (default: false -> clamped)
 */

export const VIEWER_CONFIG = {
  DRAG_SENSITIVITY: 0.05, // seconds scrubbed per pixel moved
  LERP_FACTOR: 0.18,      // rAF lerp interpolation speed (1.0 = instant, 0.1 = slower/smoother)
  KEYBOARD_STEP: 1.0,     // scrub step in seconds for arrow keys
  WRAP_AROUND: false,     // wrap or clamp at clip boundaries
};

export default function SurroundingsViewerModal({ surroundings, title = "Sensor Surroundings", location = "", onClose }) {
  const [mode, setMode] = useState("look-around"); // "look-around" | "play"
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);

  const videoRef = useRef(null);
  const modalRef = useRef(null);
  const targetTimeRef = useRef(0);
  const rafIdRef = useRef(null);
  const pointerStartRef = useRef({ x: 0, time: 0 });
  const hasMovedRef = useRef(false);

  // Check prefers-reduced-motion
  const prefersReducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // Lock background scroll on mount
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Update target time ref when duration arrives
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const dur = videoRef.current.duration || 0;
    setDuration(dur);
    setIsLoading(false);
    setHasError(false);
  };

  const handleCanPlay = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  // Smooth lerp loop for look-around mode
  const updateScrubLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration || Number.isNaN(video.duration)) return;

    const dur = video.duration;
    let target = targetTimeRef.current;

    if (VIEWER_CONFIG.WRAP_AROUND) {
      target = ((target % dur) + dur) % dur;
      targetTimeRef.current = target;
    } else {
      target = Math.max(0, Math.min(dur, target));
      targetTimeRef.current = target;
    }

    if (prefersReducedMotion.current) {
      video.currentTime = target;
      setCurrentTime(target);
      return;
    }

    const current = video.currentTime;
    const diff = target - current;

    if (Math.abs(diff) > 0.01) {
      const nextTime = current + diff * VIEWER_CONFIG.LERP_FACTOR;
      video.currentTime = nextTime;
      setCurrentTime(nextTime);
      rafIdRef.current = requestAnimationFrame(updateScrubLoop);
    } else {
      video.currentTime = target;
      setCurrentTime(target);
      rafIdRef.current = null;
    }
  }, []);

  const scheduleUpdate = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(updateScrubLoop);
    }
  }, [updateScrubLoop]);

  // Clean up rAF loop on unmount or mode switch
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [mode]);

  // Handle Play/Pause
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  // Switch mode
  const handleModeSwitch = (newMode) => {
    if (newMode === mode) return;
    const video = videoRef.current;
    if (video) {
      if (newMode === "look-around") {
        video.pause();
        setIsPlaying(false);
        targetTimeRef.current = video.currentTime;
      }
    }
    setMode(newMode);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") {
        // If focused on a button and user hits Space, let button handle it
        if (e.key === " " && e.target.tagName === "BUTTON") return;
      }

      if (mode === "play") {
        if (e.key === " " || e.key === "k") {
          e.preventDefault();
          togglePlay();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 3);
          }
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 3);
          }
        }
      } else {
        // Look-around mode
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setHasInteracted(true);
          targetTimeRef.current = Math.max(0, targetTimeRef.current - VIEWER_CONFIG.KEYBOARD_STEP);
          scheduleUpdate();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setHasInteracted(true);
          targetTimeRef.current = Math.min(duration, targetTimeRef.current + VIEWER_CONFIG.KEYBOARD_STEP);
          scheduleUpdate();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, duration, onClose, togglePlay, scheduleUpdate]);

  // Pointer drag events for look-around scrubber
  const handlePointerDown = (e) => {
    if (mode !== "look-around" || hasError || isLoading) return;
    // Only primary mouse button or touch
    if (e.button !== undefined && e.button !== 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPointerDown(true);
    hasMovedRef.current = false;
    pointerStartRef.current = {
      x: e.clientX,
      time: targetTimeRef.current,
    };
    setHasInteracted(true);
  };

  const handlePointerMove = (e) => {
    if (!isPointerDown || mode !== "look-around") return;

    const deltaX = e.clientX - pointerStartRef.current.x;
    if (Math.abs(deltaX) > 2) {
      hasMovedRef.current = true;
    }

    // Dragging right moves forward, dragging left moves backward (natural pan feeling)
    const timeDelta = deltaX * VIEWER_CONFIG.DRAG_SENSITIVITY;
    let nextTarget = pointerStartRef.current.time + timeDelta;

    if (VIEWER_CONFIG.WRAP_AROUND && duration > 0) {
      nextTarget = ((nextTarget % duration) + duration) % duration;
    } else {
      nextTarget = Math.max(0, Math.min(duration, nextTarget));
    }

    targetTimeRef.current = nextTarget;
    scheduleUpdate();
  };

  const handlePointerUp = (e) => {
    if (!isPointerDown) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // In case capture was lost
    }
    setIsPointerDown(false);
  };

  // Video time update in play mode
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      if (mode === "play") {
        targetTimeRef.current = videoRef.current.currentTime;
      }
    }
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
  };

  // Reset look-around to start
  const handleReset = () => {
    targetTimeRef.current = 0;
    scheduleUpdate();
  };

  // Progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Format time MM:SS
  const formatTime = (sec) => {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? "0" : ""}${rem}`;
  };

  return (
    <div
      className="surroundings-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sensor Site Surroundings Viewer"
    >
      <div
        ref={modalRef}
        className="surroundings-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="surroundings-modal-header">
          <div className="surroundings-header-info">
            <div className="surroundings-title-row">
              <Compass className="surroundings-compass-icon" size={18} />
              <h3 className="surroundings-modal-title">{title}</h3>
              <span className="surroundings-badge">Site Surroundings</span>
            </div>
            {location && <p className="surroundings-modal-loc">{location}</p>}
          </div>

          <div className="surroundings-header-actions">
            {/* Mode Switcher */}
            <div className="surroundings-mode-toggle" role="radiogroup" aria-label="Viewer Mode">
              <button
                type="button"
                role="radio"
                aria-checked={mode === "look-around"}
                className={`surroundings-mode-btn ${mode === "look-around" ? "active" : ""}`}
                onClick={() => handleModeSwitch("look-around")}
                title="Interactive 360-degree look-around (drag or use arrow keys)"
              >
                <Compass size={13} />
                <span>Look Around</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "play"}
                className={`surroundings-mode-btn ${mode === "play" ? "active" : ""}`}
                onClick={() => handleModeSwitch("play")}
                title="Normal linear video playback"
              >
                <Play size={13} />
                <span>Play Clip</span>
              </button>
            </div>

            <button
              type="button"
              className="surroundings-close-btn"
              onClick={onClose}
              title="Close viewer (Esc)"
              aria-label="Close viewer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Viewport Area */}
        <div
          className={`surroundings-viewport ${mode === "look-around" ? "lookaround-mode" : "play-mode"} ${
            isPointerDown ? "is-dragging" : ""
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Video element */}
          <video
            ref={videoRef}
            src={surroundings?.video}
            poster={surroundings?.poster}
            muted
            playsInline
            preload="auto"
            className="surroundings-video"
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            onError={handleError}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleVideoEnded}
          />

          {/* Loading Spinner */}
          {isLoading && !hasError && (
            <div className="surroundings-loading-overlay">
              <LoadingAnimation size={90} message="Loading site surroundings..." />
            </div>
          )}

          {/* Error Message */}
          {hasError && (
            <div className="surroundings-error-overlay">
              <AlertCircle size={40} className="surroundings-error-icon" />
              <h4>Unable to load surroundings video</h4>
              <p>The media file could not be found or played. Please verify site media assets.</p>
            </div>
          )}

          {/* Look-around drag guide hint (fades after first interaction) */}
          {mode === "look-around" && !isLoading && !hasError && (
            <div className={`surroundings-drag-hint ${hasInteracted ? "faded" : ""}`}>
              <div className="surroundings-drag-pill">
                <ChevronLeft size={16} className="hint-arrow hint-arrow-left" />
                <span>Drag to look around</span>
                <ChevronRight size={16} className="hint-arrow hint-arrow-right" />
              </div>
              <span className="surroundings-drag-subhint">or use Left / Right arrow keys</span>
            </div>
          )}

          {/* Play mode big center play/pause button overlay */}
          {mode === "play" && !isLoading && !hasError && !isPlaying && (
            <button
              type="button"
              className="surroundings-center-play-btn"
              onClick={togglePlay}
              aria-label="Play video"
            >
              <Play size={32} />
            </button>
          )}

          {/* Progress bar line along bottom of video */}
          <div className="surroundings-progress-bar">
            <div
              className="surroundings-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Bottom Toolbar */}
        <div className="surroundings-toolbar">
          <div className="surroundings-controls-left">
            {mode === "play" ? (
              <button
                type="button"
                className="surroundings-tool-btn"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause video" : "Play video"}
                title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                <span>{isPlaying ? "Pause" : "Play"}</span>
              </button>
            ) : (
              <button
                type="button"
                className="surroundings-tool-btn"
                onClick={handleReset}
                aria-label="Reset viewing angle to start"
                title="Reset angle to 0:00"
              >
                <RotateCcw size={15} />
                <span>Reset View</span>
              </button>
            )}

            <span className="surroundings-timestamp" aria-label="Current timestamp">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="surroundings-controls-right">
            <span className="surroundings-instructions">
              {mode === "look-around"
                ? "Click & drag left/right to pan view • Arrow keys to nudge"
                : "Space to play/pause • Arrow keys to seek"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
