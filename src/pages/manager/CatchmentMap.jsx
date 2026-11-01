import { evaluateNodeStatus, NODE_STATUS_LABELS } from "../../lib/nodeHealth";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import {
  Copy,
  Check,
  ExternalLink,
  MapPin,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  Maximize2,
  Video,
} from "lucide-react";
import L from "leaflet";
import { SITE_MAP_FALLBACK_LABEL } from "../../config/siteLocation";
import catchmentData from "../../data/catchmentBoundary.geojson?raw";
import landCoverRaw from "../../data/landCover.geojson?raw";
import riversRaw from "../../data/riverNetwork.geojson?raw";
import sensorRaw from "../../data/sensorLocation.geojson?raw";
import "../../styles/manager/CatchmentMap.css";
import MapLegendPanel from "../../components/MapLegend";
import SurroundingsViewerModal from "../../components/SurroundingsViewerModal";
import { LAND_COVER_COLORS, getClassByValue } from "../../components/mapLandCoverConfig";

const boundaryData = JSON.parse(catchmentData);
const landCoverData = JSON.parse(landCoverRaw);
const riversData = JSON.parse(riversRaw);
const sensorData = JSON.parse(sensorRaw);

// Original catchment boundary style and colors
const BOUNDARY_STYLE = { color: "#000000", weight: 1.5, fillColor: "#000000", fillOpacity: 0.08 };
const HOVER_STYLE = { color: "#000000", weight: 2.5, fillOpacity: 0.16 };

// Original river network style and cyan color
const RIVER_STYLE = { color: "#0891b2", weight: 1.5, opacity: 1, interactive: false };
const RIVER_STYLE_HIGHLIGHT = { color: "#06b6d4", weight: 3, opacity: 1, interactive: false };
const RIVER_STYLE_DIMMED = { color: "#0891b2", weight: 1, opacity: 0.35, interactive: false };

// Red sensor marker dot ~1.3x larger (26x26px, anchor 13x13px)
const sensorIcon = L.divIcon({
  className: "sensor-marker-icon",
  html: `<div class="sensor-marker-dot" title="Click to view sensor details"></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// Pin icon for user-dropped markers
const pinIcon = L.divIcon({
  className: "custom-pin-icon",
  html: `
    <div class="pin-marker-dot">
      <div class="pin-marker-inner"></div>
    </div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Land-cover styling — delegates to mapLandCoverConfig.js
// Builds the base style for a feature. Highlight overrides are applied by
// the CatchmentMap component via ref.setStyle() without remounting.
const makeLandCoverStyle = (feature, selectedClass) => {
  const raw = feature.properties?.landuse;
  const key = raw === undefined || raw === null ? "" : String(Number.isFinite(Number(raw)) ? Number(raw) : raw);
  const baseColor = LAND_COVER_COLORS[key] ?? "#b0bec5";

  if (selectedClass === null) {
    // Normal view: full opacity for all polygons
    return {
      color: "#5f6b6f",
      weight: 0.4,
      opacity: 0.6,
      fillColor: baseColor,
      fillOpacity: 0.85,
      interactive: true,
      bubblingMouseEvents: true,
    };
  }

  const isSelected = key === selectedClass;
  if (isSelected) {
    // Highlighted class
    const cls = getClassByValue(key);
    const highlight = cls ? cls.color : baseColor;
    return {
      color: "#1a1a2e",
      weight: 1.8,
      opacity: 1,
      fillColor: highlight,
      fillOpacity: 0.95,
      interactive: true,
      bubblingMouseEvents: true,
    };
  }

  // Dimmed class
  return {
    color: "transparent",
    weight: 0,
    opacity: 0,
    fillColor: baseColor,
    fillOpacity: 0.15,
    interactive: true,
    bubblingMouseEvents: true,
  };
};

const FitBounds = ({ data }) => {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(data);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
  }, [data, map]);
  return null;
};

/**
 * RecenterControl
 *
 * Adds a "Reset view" button underneath the Leaflet zoom controls.
 * Calls fitBounds on the catchment boundary with the same [16, 16] padding.
 */
const RecenterControl = ({ data }) => {
  const map = useMap();

  useEffect(() => {
    const CustomControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd: () => {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-recenter");
        const btn = L.DomUtil.create("a", "leaflet-control-recenter-btn", container);
        btn.href = "#";
        btn.role = "button";
        btn.title = "Reset view to full catchment boundary";
        btn.setAttribute("aria-label", "Reset view to full catchment boundary");

        // Simple recenter icon SVG
        btn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        `;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        L.DomEvent.on(btn, "click", (e) => {
          L.DomEvent.preventDefault(e);
          const layer = L.geoJSON(data);
          const bounds = layer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [16, 16] });
          }
        });

        return container;
      },
    });

    const control = new CustomControl();
    map.addControl(control);

    return () => {
      map.removeControl(control);
    };
  }, [map, data]);

  return null;
};

const ClickToPin = ({ onPick }) => {
  useMapEvents({ click: (e) => onPick(e.latlng) });
  return null;
};

const CoordPopupContent = ({ latlng }) => {
  const [copied, setCopied] = useState(false);
  const lat = Number(latlng.lat).toFixed(6);
  const lng = Number(latlng.lng).toFixed(6);
  const text = `${lat}, ${lng}`;

  const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="coord-popup">
      <div className="coord-header">
        <MapPin size={13} className="coord-pin-icon" />
        <span>Selected Location</span>
      </div>
      <div className="coord-value-row">
        <code className="coord-text">{text}</code>
        <button type="button" onClick={handleCopy} title="Copy coordinates" aria-label="Copy coordinates" className="coord-copy-btn">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      <div className="coord-actions">
        <a href={gmapsUrl} target="_blank" rel="noopener noreferrer" className="coord-map-link coord-gmaps" title="Open in Google Maps">
          <span>Google Maps</span>
          <ExternalLink size={11} />
        </a>
        <a href={osmUrl} target="_blank" rel="noopener noreferrer" className="coord-map-link coord-osm" title="Open in OpenStreetMap">
          <span>OpenStreetMap</span>
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
};

/**
 * SensorPopupContent
 *
 * Reactive React popup content component.
 * Synchronizes online/offline status live with SensorStatusPanel & ManagerDashboard.
 * Compact and clean presentation without readings table for optimal responsive map viewing.
 */
const SensorPopupContent = ({
  feature,
  readings = [],
  nodes = [],
  checkedAt = null,
  popupWidth = 275,
  maxBodyHeight = 340,
  onExpandPhoto = null,
  onOpenSurroundings = null,
}) => {
  const p = feature.properties || {};
  const sensorId = p.id;
  const sensorName = p.name || "";

  // Extract coordinates for navigation redirect
  const geomCoords = feature.geometry?.coordinates;
  const lng = geomCoords ? Number(geomCoords[0]).toFixed(6) : "124.845042";
  const lat = geomCoords ? Number(geomCoords[1]).toFixed(6) : "8.381901";
  const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  const photoSrc = p.photo || "/assets/img/location.jpg";
  const surroundings = p.surroundings || null;

  // Robust matching to node across all scenarios (exact id, device_label / name similarity, reading node, or single station)
  const matchedNode = useMemo(() => {
    let found = nodes.find((n) => String(n.id) === String(sensorId));
    if (found) return found;

    if (sensorName) {
      const lowerName = sensorName.toLowerCase();
      found = nodes.find((n) => {
        if (!n.device_label) return false;
        const lowerLabel = String(n.device_label).toLowerCase();
        return lowerName.includes(lowerLabel) || lowerLabel.includes(lowerName);
      });
      if (found) return found;
    }

    if (readings.length > 0) {
      const readingNode = readings.find((r) => {
        if (!r.nodes) return false;
        if (String(r.nodes.id) === String(sensorId)) return true;
        if (sensorName && r.nodes.device_label) {
          const lowerLabel = String(r.nodes.device_label).toLowerCase();
          const lowerName = sensorName.toLowerCase();
          return lowerName.includes(lowerLabel) || lowerLabel.includes(lowerName);
        }
        return false;
      })?.nodes;
      if (readingNode) return readingNode;
    }

    if (nodes.length === 1) return nodes[0];
    if (readings[0]?.nodes) return readings[0].nodes;

    return null;
  }, [nodes, readings, sensorId, sensorName]);

  // Exact matching logic used by SensorStatusPanel & ManagerDashboard:
  const lastSync = useMemo(() => {
    if (matchedNode) {
      const nodeSync = readings.find((r) => r.nodes?.id === matchedNode.id)?.recorded_at;
      if (nodeSync) return nodeSync;
    }
    return readings[0]?.recorded_at ?? null;
  }, [matchedNode, readings]);

  // Real-time online check: synced within threshold (sync live with SensorStatusPanel)
  const online = useMemo(() => {
    if (!lastSync || !checkedAt) return false;
    const ageMs = checkedAt - new Date(lastSync).getTime();
    return evaluateNodeStatus(ageMs) === NODE_STATUS_LABELS.ONLINE;
  }, [lastSync, checkedAt]);

  const handleOpenPhoto = () => {
    onExpandPhoto?.({
      src: photoSrc,
      title: p.name || `Sensor Node #${sensorId}`,
      location: p.location || SITE_MAP_FALLBACK_LABEL,
      lat,
      lng,
    });
  };

  const handleOpenSurroundings = () => {
    if (!surroundings?.video) return;
    onOpenSurroundings?.({
      surroundings,
      title: p.name || `Sensor Node #${sensorId}`,
      location: p.location || SITE_MAP_FALLBACK_LABEL,
    });
  };

  return (
    <div
      className="sensor-map-popup"
      style={{
        width: `${popupWidth}px`,
        maxWidth: `${popupWidth}px`,
        "--smp-max-body-height": `${maxBodyHeight}px`,
      }}
    >
      <div
        className="smp-photo-wrap"
        title="Click to expand photo"
        onClick={handleOpenPhoto}
      >
        <img
          className="smp-photo"
          src={photoSrc}
          alt={p.name || "Sensor location"}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = "/assets/img/location.jpg";
          }}
        />
        <div className="smp-photo-tag">{p.location ? p.location.split(",")[0] : "River Basin"}</div>
        <div className="smp-photo-actions-overlay">
          {surroundings && (
            <button
              type="button"
              className="smp-photo-tool-btn smp-surroundings-btn"
              aria-label="View surroundings 360-style viewer"
              title={surroundings.video ? "View surroundings" : "Surroundings view coming soon"}
              disabled={!surroundings.video}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenSurroundings();
              }}
            >
              <Video size={12} />
              <span>Surroundings</span>
            </button>
          )}
          <button
            type="button"
            className="smp-photo-tool-btn smp-photo-expand-btn"
            aria-label="Expand photo"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenPhoto();
            }}
          >
            <Maximize2 size={12} />
            <span>Expand</span>
          </button>
        </div>
      </div>

      <div className="smp-body" style={{ maxHeight: `${maxBodyHeight}px` }}>
        <div className="smp-header">
          <strong className="smp-name" title={p.name || `Sensor #${sensorId}`}>
            {p.name || `Sensor #${sensorId}`}
          </strong>
          <span className={`smp-status ${online ? "online" : "offline"}`}>
            <span className="smp-status-dot" />
            {online ? "Online" : "Offline"}
          </span>
        </div>

        {p.description && <p className="smp-desc">{p.description}</p>}

        {p.location && (
          <div className="smp-location-row">
            <MapPin size={13} className="smp-location-pin" />
            <span className="smp-location-text" title={p.location}>
              {p.location}
            </span>
          </div>
        )}

        <div className="smp-actions">
          <a
            href={gmapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="smp-btn smp-btn-gmaps"
            title="Open in Google Maps"
          >
            <span>Google Maps</span>
            <ExternalLink size={11} />
          </a>
          <a
            href={osmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="smp-btn smp-btn-osm"
            title="Open in OpenStreetMap"
          >
            <span>OSM</span>
            <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  );
};

/**
 * SensorMarkerWithResponsivePopup
 *
 * Inner component to access map dimensions via useMap() and dynamically compute:
 * - popup width = Math.min(280, Math.max(220, mapWidth - 32))
 * - maxBodyHeight = Math.max(140, mapHeight - 195)
 * - autoPanPadding = responsive [16, 16] on narrow maps, [40, 40] on desktop
 */
const SensorMarkerWithResponsivePopup = ({
  feature,
  position,
  readings,
  nodes,
  checkedAt,
  onExpandPhoto,
  onOpenSurroundings,
}) => {
  const map = useMap();
  const [mapDimensions, setMapDimensions] = useState(() => {
    const size = map.getSize();
    return { width: size.x || 320, height: size.y || 400 };
  });

  useEffect(() => {
    const updateSize = () => {
      const size = map.getSize();
      setMapDimensions({ width: size.x || 320, height: size.y || 400 });
    };

    map.on("resize", updateSize);
    updateSize();

    return () => {
      map.off("resize", updateSize);
    };
  }, [map]);

  const popupWidth = useMemo(() => {
    return Math.min(280, Math.max(220, mapDimensions.width - 32));
  }, [mapDimensions.width]);

  const maxBodyHeight = useMemo(() => {
    // Reserve ~195px for popup tip, header/photo banner (~115px), and margins
    return Math.max(140, mapDimensions.height - 195);
  }, [mapDimensions.height]);

  const autoPanPadding = useMemo(() => {
    if (mapDimensions.width <= 360) {
      return [16, 16];
    }
    if (mapDimensions.width <= 480) {
      return [24, 24];
    }
    return [40, 40];
  }, [mapDimensions.width]);

  return (
    <Marker position={position} icon={sensorIcon}>
      <Popup
        className="sensor-popup-wrapper"
        maxWidth={popupWidth}
        minWidth={popupWidth}
        autoPan={true}
        autoPanPaddingTopLeft={autoPanPadding}
        autoPanPaddingBottomRight={autoPanPadding}
      >
        <SensorPopupContent
          feature={feature}
          readings={readings}
          nodes={nodes}
          checkedAt={checkedAt}
          popupWidth={popupWidth}
          maxBodyHeight={maxBodyHeight}
          onExpandPhoto={onExpandPhoto}
          onOpenSurroundings={onOpenSurroundings}
        />
      </Popup>
    </Marker>
  );
};

/**
 * PhotoLightboxModal
 *
 * Full-featured modal preview with smooth zoom controls (zoom in, zoom out, reset, fit),
 * interactive mouse drag-to-pan when enlarged, mouse wheel zooming, double-click toggle,
 * and keyboard shortcuts (Esc to close, +/- to zoom, R to reset).
 */
const PhotoLightboxModal = ({ photo, onClose }) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const imgContainerRef = useRef(null);

  // Reset zoom & pan when photo changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [photo]);

  // Lock background scrolling and support keyboard shortcuts
  useEffect(() => {
    if (!photo) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom((z) => {
          const next = Math.max(0.75, Number((z - 0.25).toFixed(2)));
          if (next <= 1) setPan({ x: 0, y: 0 });
          return next;
        });
      } else if (e.key === "0" || e.key.toLowerCase() === "r") {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [photo, onClose]);

  const handleZoomIn = () => {
    setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((z) => {
      const next = Math.max(0.75, Number((z - 0.25).toFixed(2)));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleToggleZoom = () => {
    if (zoom > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setZoom(2);
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoom((z) => {
      const next = Math.min(4, Math.max(0.75, Number((z + delta).toFixed(2))));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Pan / Drag handlers
  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (!photo) return null;

  return (
    <div
      className="map-photo-lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sensor Photo Preview"
    >
      <div className="map-photo-lightbox-modal" onClick={(e) => e.stopPropagation()}>
        {/* Lightbox Header */}
        <div className="map-lightbox-header">
          <div className="map-lightbox-title-group">
            <h3 className="map-lightbox-title">{photo.title}</h3>
            {photo.location && (
              <span className="map-lightbox-location">
                <MapPin size={12} className="map-lightbox-pin" />
                {photo.location}
              </span>
            )}
          </div>
          <button
            type="button"
            className="map-lightbox-close-btn"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close photo preview"
          >
            <X size={18} />
          </button>
        </div>

        {/* Viewport for image with zoom & pan */}
        <div
          ref={imgContainerRef}
          className={`map-lightbox-viewport ${zoom > 1 ? (isDragging ? "is-grabbing" : "is-grabbable") : ""}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleToggleZoom}
        >
          <img
            src={photo.src}
            alt={photo.title}
            className="map-lightbox-image"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: isDragging ? "none" : "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
            }}
            draggable={false}
          />
        </div>

        {/* Floating Zoom Control Pill */}
        <div className="map-lightbox-toolbar">
          <div className="map-lightbox-controls">
            <button
              type="button"
              className="map-lightbox-btn"
              onClick={handleZoomOut}
              disabled={zoom <= 0.75}
              title="Zoom out (-)"
              aria-label="Zoom out"
            >
              <ZoomOut size={15} />
            </button>

            <button
              type="button"
              className="map-lightbox-zoom-indicator"
              onClick={handleResetZoom}
              title="Click to reset zoom (100%)"
              aria-label="Reset zoom level"
            >
              {Math.round(zoom * 100)}%
            </button>

            <button
              type="button"
              className="map-lightbox-btn"
              onClick={handleZoomIn}
              disabled={zoom >= 4}
              title="Zoom in (+)"
              aria-label="Zoom in"
            >
              <ZoomIn size={15} />
            </button>

            <div className="map-lightbox-divider" />

            <button
              type="button"
              className="map-lightbox-btn map-lightbox-reset-btn"
              onClick={handleResetZoom}
              title="Reset zoom & position (0 or R)"
              aria-label="Reset view"
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          </div>

          <div className="map-lightbox-hint">
            <span>Scroll or pinch to zoom • Drag to pan • Double-click for 2× • Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * CatchmentMap
 *
 * Props:
 *   readings   – sensor_readings rows from Supabase (for live status/values in popup)
 *   nodes      – nodes rows from Supabase (to match sensor IDs)
 *   checkedAt  – Date.now() timestamp of last data fetch (for online/offline calc)
 */
const CatchmentMap = ({ readings = [], nodes = [], checkedAt = null }) => {
  const [boundaryHovered, setBoundaryHovered] = useState(false);
  const [pin, setPin] = useState(null);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [surroundingsData, setSurroundingsData] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);

  // Refs to Leaflet layer groups so we can restyle without remounting
  const landCoverRef = useRef(null);
  const riversRef = useRef(null);

  // Boundary hover handlers (unchanged)
  const onEachFeature = useMemo(() => (feature, layer) => {
    layer.on({
      mouseover: (e) => { e.target.setStyle(HOVER_STYLE); setBoundaryHovered(true); },
      mouseout: (e) => { e.target.setStyle(BOUNDARY_STYLE); setBoundaryHovered(false); },
    });
  }, []);

  // Land cover: attach tooltip + keep interactive for hover, but let clicks
  // pass through to the map (so pin-dropping always works on polygon areas).
  const onEachLandCover = useCallback((feature, layer) => {
    const cls = getClassByValue(feature.properties?.landuse);
    if (cls) {
      layer.bindTooltip(cls.label, {
        sticky: true,
        direction: "top",
        className: "lc-tooltip",
        offset: [0, -8],
      });
    }
  }, []);

  // Apply highlight styles via ref when selectedClass changes
  useEffect(() => {
    const lcLayer = landCoverRef.current;
    if (lcLayer) {
      lcLayer.eachLayer((layer) => {
        const style = makeLandCoverStyle(layer.feature, selectedClass);
        layer.setStyle(style);
      });
    }
    const rvLayer = riversRef.current;
    if (rvLayer) {
      const isRiverHighlight =
        selectedClass === "__rivers__" ||
        (selectedClass === "1"); // Water highlights rivers too
      rvLayer.setStyle(
        selectedClass === null
          ? RIVER_STYLE
          : isRiverHighlight
            ? RIVER_STYLE_HIGHLIGHT
            : RIVER_STYLE_DIMMED
      );
    }
  }, [selectedClass]);

  // Compute the selected class label for the chip
  const selectedLabel = useMemo(() => {
    if (selectedClass === null) return null;
    if (selectedClass === "__rivers__") return "Rivers";
    const cls = getClassByValue(selectedClass);
    return cls ? cls.label : null;
  }, [selectedClass]);

  return (
    <div className="catchment-map-wrap">
      <MapContainer center={[8.29, 124.84]} zoom={13} scrollWheelZoom className="catchment-map">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        <GeoJSON
          key="land-cover"
          data={landCoverData}
          style={(feature) => makeLandCoverStyle(feature, null)}
          onEachFeature={onEachLandCover}
          ref={landCoverRef}
        />
        <GeoJSON data={boundaryData} style={BOUNDARY_STYLE} onEachFeature={onEachFeature} />
        <GeoJSON
          key="rivers"
          data={riversData}
          style={RIVER_STYLE}
          ref={riversRef}
        />

        {/* Dynamic sensor markers with live reactive popups */}
        {sensorData.features.map((feature, idx) => {
          const coords = feature.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const [lng, lat] = coords;
          return (
            <SensorMarkerWithResponsivePopup
              key={feature.properties?.id ?? idx}
              feature={feature}
              position={[lat, lng]}
              readings={readings}
              nodes={nodes}
              checkedAt={checkedAt}
              onExpandPhoto={setExpandedPhoto}
              onOpenSurroundings={setSurroundingsData}
            />
          );
        })}

        <FitBounds data={boundaryData} />
        <RecenterControl data={boundaryData} />
        <ClickToPin onPick={setPin} />
        {pin && (
          <>
            <Marker position={pin} icon={pinIcon} />
            <Popup
              key={`${pin.lat}-${pin.lng}`}
              position={pin}
              autoClose={false}
              closeOnClick={false}
              className="coord-popup-wrapper"
              eventHandlers={{ remove: () => setPin(null) }}
            >
              <CoordPopupContent latlng={pin} />
            </Popup>
          </>
        )}
      </MapContainer>

      {/* "Showing: X" chip */}
      {selectedLabel && (
        <div className="lc-showing-chip">
          <span>Showing: {selectedLabel}</span>
          <button
            type="button"
            className="lc-showing-chip-x"
            onClick={() => setSelectedClass(null)}
            aria-label="Clear filter"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Interactive legend panel */}
      <MapLegendPanel
        selectedClass={selectedClass}
        onSelect={setSelectedClass}
      />

      {boundaryHovered && <span className="catchment-map-hint">Dicklum River Catchment Boundary</span>}

      {/* Modern Photo Lightbox with Smooth Zoom Controls */}
      <PhotoLightboxModal
        photo={expandedPhoto}
        onClose={() => setExpandedPhoto(null)}
      />

      {/* Interactive Surroundings 360-style Viewer Modal */}
      {surroundingsData && (
        <SurroundingsViewerModal
          surroundings={surroundingsData.surroundings}
          title={surroundingsData.title}
          location={surroundingsData.location}
          onClose={() => setSurroundingsData(null)}
        />
      )}
    </div>
  );
};

export default CatchmentMap;
