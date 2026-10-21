import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import L from "leaflet";
import { LAND_COVER_CLASSES, RIVERS_CLASS } from "./mapLandCoverConfig";

/**
 * MapLegend
 *
 * Interactive legend panel for the Catchment Map.
 * - Desktop: compact card pinned to map corner (always visible)
 * - Mobile (< 640 px): collapses to a "Legend" button; opens as a bottom sheet
 *
 * Clicks, double-clicks, and scrolls on the legend are isolated from the map
 * using L.DomEvent helpers so interacting with the legend never drops a pin or
 * pans/zooms the map.
 *
 * Props:
 *   selectedClass  – currently selected landuse value string, "__rivers__", or null
 *   onSelect       – (value: string | null) => void  (null = show all)
 *   className      – optional extra CSS class on the root element
 */
export default function MapLegend({ selectedClass, onSelect, className = "" }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Refs for L.DomEvent isolation
  const desktopRef = useRef(null);
  const sheetRef = useRef(null);
  const toggleRef = useRef(null);

  // Isolate the legend from map events
  useEffect(() => {
    const nodes = [desktopRef.current, sheetRef.current, toggleRef.current].filter(Boolean);
    nodes.forEach((el) => {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    });
  });

  // Close the mobile sheet when a class is selected
  useEffect(() => {
    if (selectedClass !== null) {
      setMobileOpen(false);
    }
  }, [selectedClass]);

  // Close mobile sheet on Esc
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const handleRowClick = (value) => {
    onSelect(selectedClass === value ? null : value);
  };

  const allRows = [...LAND_COVER_CLASSES, RIVERS_CLASS];

  const legendContent = (
    <div className="ml-content">
      {/* Title + Show all */}
      <div className="ml-header">
        <span className="ml-title">Land Cover</span>
        {selectedClass !== null && (
          <button
            type="button"
            className="ml-show-all"
            onClick={() => onSelect(null)}
            aria-label="Show all classes"
          >
            Show all
          </button>
        )}
      </div>

      {/* Class rows */}
      <div className="ml-rows" role="listbox" aria-label="Land cover filter">
        {allRows.map((cls) => {
          const isSelected = selectedClass === cls.value;
          const isRiverHighlighted =
            cls.isRiverLayer &&
            (selectedClass === "__rivers__" ||
              LAND_COVER_CLASSES.find(
                (c) => c.value === selectedClass && c.highlightsRivers
              ) !== undefined);

          const highlighted = isSelected || isRiverHighlighted;

          return (
            <button
              key={cls.value}
              type="button"
              role="option"
              aria-selected={highlighted}
              aria-pressed={highlighted}
              className={`ml-row${highlighted ? " ml-row--active" : ""}${
                selectedClass !== null && !highlighted ? " ml-row--dimmed" : ""
              }`}
              onClick={() => handleRowClick(cls.value)}
              title={cls.meaning}
            >
              {/* Swatch */}
              {cls.isRiverLayer ? (
                <span
                  className="ml-swatch ml-swatch--line"
                  style={{ borderColor: cls.color }}
                  aria-hidden="true"
                />
              ) : (
                <span
                  className="ml-swatch ml-swatch--fill"
                  style={{ background: cls.color }}
                  aria-hidden="true"
                />
              )}

              {/* Text */}
              <span className="ml-row-text">
                <span className="ml-row-name">{cls.label}</span>
                <span className="ml-row-meaning">{cls.meaning}</span>
              </span>
            </button>
          );
        })}

        {/* Static rows — not filterable */}
        <div className="ml-static-rows">
          <div className="ml-static-row">
            <span className="ml-swatch ml-swatch--boundary" aria-hidden="true" />
            <span className="ml-row-text">
              <span className="ml-row-name">Catchment Boundary</span>
            </span>
          </div>
          <div className="ml-static-row">
            <span className="ml-swatch ml-swatch--sensor" aria-hidden="true" />
            <span className="ml-row-text">
              <span className="ml-row-name">Sensor Location</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop legend (always visible) ── */}
      <div
        ref={desktopRef}
        className={`map-legend map-legend--desktop ${className}`}
        aria-label="Map legend"
      >
        {legendContent}
      </div>

      {/* ── Mobile: toggle button ── */}
      <button
        ref={toggleRef}
        type="button"
        className="map-legend-toggle"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        aria-haspopup="dialog"
      >
        Legend
        {selectedClass !== null && <span className="map-legend-toggle-dot" />}
      </button>

      {/* ── Mobile: bottom sheet ── */}
      {mobileOpen && (
        <>
          <div
            className="map-legend-scrim"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={sheetRef}
            className="map-legend map-legend--sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Map legend"
          >
            <div className="ml-sheet-handle" />
            <button
              type="button"
              className="ml-sheet-close"
              onClick={() => setMobileOpen(false)}
              aria-label="Close legend"
            >
              <X size={16} />
            </button>
            {legendContent}
          </div>
        </>
      )}
    </>
  );
}
