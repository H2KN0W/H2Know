import { evaluateNodeStatus, NODE_STATUS_LABELS } from "../../lib/nodeHealth";
import { useEffect, useMemo, useState, useRef } from "react";
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
  Droplets,
  Trees,
  Wheat,
  Building2,
  Mountain,
  Tent,
  Waves,
  Scan,
} from "lucide-react";
import L from "leaflet";
import { SITE_MAP_FALLBACK_LABEL } from "../../config/siteLocation";
import catchmentData from "../../data/catchmentBoundary.geojson?raw";
import landCoverRaw from "../../data/landCover.geojson?raw";
import riversRaw from "../../data/riverNetwork.geojson?raw";
import sensorRaw from "../../data/sensorLocation.geojson?raw";
import "../../styles/manager/CatchmentMap.css";

const boundaryData = JSON.parse(catchmentData);
const landCoverData = JSON.parse(landCoverRaw);
const riversData = JSON.parse(riversRaw);
const sensorData = JSON.parse(sensorRaw);

// Original catchment boundary style and colors
const BOUNDARY_STYLE = { color: "#000000", weight: 1.5, fillColor: "#000000", fillOpacity: 0.08 };
const HOVER_STYLE = { color: "#000000", weight: 2.5, fillOpacity: 0.16 };

// Original river network style and cyan color
const RIVER_STYLE = { color: "#0891b2", weight: 1.5, opacity: 1, interactive: false };

// Original red sensor marker dot
const sensorIcon = L.divIcon({
  className: "sensor-marker-icon",
  html: `<div class="sensor-marker-dot" title="Click to view sensor details"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
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

// Original Legend / fill colors for the `landuse` attribute values in landCover.geojson
const LAND_USE_CLASSES = [
  { value: "1", label: "Water", color: "#3F8EDB", icon: Droplets },
  { value: "2", label: "Trees", color: "#397D49", icon: Trees },
  { value: "5", label: "Crops", color: "#E49635", icon: Wheat },
  { value: "7", label: "Built Area", color: "#C4281B", icon: Building2 },
  { value: "10", label: "Bare Ground", color: "#E3E2C3", icon: Mountain, iconColor: "#8a8373" },
  { value: "11", label: "Rangeland", color: "#E3E2C3", icon: Tent, iconColor: "#8a8373" },
];

const LAND_USE_COLORS = Object.fromEntries(LAND_USE_CLASSES.map((c) => [c.value, c.color]));

const landCoverStyle = (feature) => {
  const raw = feature.properties?.landuse;
  const key = raw === undefined || raw === null ? "" : String(Number.isFinite(Number(raw)) ? Number(raw) : raw);
  return {
    color: "#5f6b6f",
    weight: 0.4,
    opacity: 0.6,
    fillColor: LAND_USE_COLORS[key] ?? "#b0bec5",
    fillOpacity: 0.85,
    interactive: false,
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

const MapLegend = () => (
  <div className="catchment-legend" aria-label="Map legend">
    <div className="catchment-legend-title">Land Use / Land Cover</div>
    {LAND_USE_CLASSES.map((c) => {
      const Icon = c.icon;
      return (
        <div className="catchment-legend-row" key={c.value}>
          <span className="catchment-legend-swatch" style={{ background: c.color }} />
          <Icon size={12} className="catchment-legend-icon" style={{ color: c.iconColor || c.color }} />
          <span className="catchment-legend-label">{c.label}</span>
        </div>
      );
    })}
    <div className="catchment-legend-divider" />
    <div className="catchment-legend-row">
      <span className="catchment-legend-line catchment-legend-line--river" />
      <Waves size={12} className="catchment-legend-icon" style={{ color: "#0891b2" }} />
      <span className="catchment-legend-label">River Network</span>
    </div>
    <div className="catchment-legend-row">
      <span className="catchment-legend-line catchment-legend-line--boundary" />
      <Scan size={12} className="catchment-legend-icon" style={{ color: "#000000" }} />
      <span className="catchment-legend-label">Catchment Boundary</span>
    </div>
    <div className="catchment-legend-row">
      <span className="catchment-legend-dot" />
      <MapPin size={12} className="catchment-legend-icon" style={{ color: "#d62828" }} />
      <span className="catchment-legend-label">Sensor Location</span>
    </div>
  </div>
);

/**
 * SensorPopupContent
 *
 * Reactive React popup content component.
 * Synchronizes online/offline status live with SensorStatusPanel & ManagerDashboard
 * and dynamically displays parameters without redundant labels or last sync.
 */
const SensorPopupContent = ({ feature, readings = [], nodes = [], checkedAt = null, onExpandPhoto = null }) => {
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

  // Dynamic parameters extraction from latest readings
  const dynamicParams = useMemo(() => {
    const nodeReadings = matchedNode
      ? readings.filter((r) => r.nodes?.id === matchedNode.id)
      : readings;
    const sourceReadings = nodeReadings.length > 0 ? nodeReadings : readings;

    const paramMap = new Map();
    sourceReadings.forEach((r) => {
      const paramName = r.parameters?.name;
      if (paramName) {
        const key = paramName.toLowerCase();
        if (!paramMap.has(key)) {
          paramMap.set(key, {
            name: paramName,
            value: r.value,
            unit: r.parameters?.unit || "",
          });
        }
      }
    });

    return Array.from(paramMap.values());
  }, [matchedNode, readings]);

  const handleOpenPhoto = () => {
    onExpandPhoto?.({
      src: photoSrc,
      title: p.name || `Sensor Node #${sensorId}`,
      location: p.location || SITE_MAP_FALLBACK_LABEL,
      lat,
      lng,
    });
  };

  return (
    <div className="sensor-map-popup">
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
        <button
          type="button"
          className="smp-photo-expand-btn"
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

      <div className="smp-body">
        <div className="smp-header">
          <strong className="smp-name">{p.name || `Sensor #${sensorId}`}</strong>
          <span className={`smp-status ${online ? "online" : "offline"}`}>
            <span className="smp-status-dot" />
            {online ? "Online" : "Offline"}
          </span>
        </div>

        {p.description && <p className="smp-desc">{p.description}</p>}

        <table className="smp-table">
          <tbody>
            <tr>
              <td className="smp-param">Location</td>
              <td className="smp-val">{p.location || `${lat}, ${lng}`}</td>
            </tr>
            {dynamicParams.map((param) => (
              <tr key={param.name}>
                <td className="smp-param">{param.name}</td>
                <td className="smp-val">{param.value} {param.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="smp-actions">
          <a
            href={gmapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="smp-btn smp-btn-gmaps"
            title="Open in Google Maps"
          >
            <span>Open in Google Maps</span>
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

  const onEachFeature = useMemo(() => (feature, layer) => {
    layer.on({
      mouseover: (e) => { e.target.setStyle(HOVER_STYLE); setBoundaryHovered(true); },
      mouseout: (e) => { e.target.setStyle(BOUNDARY_STYLE); setBoundaryHovered(false); },
    });
  }, []);

  return (
    <div className="catchment-map-wrap">
      <MapContainer center={[8.29, 124.84]} zoom={13} scrollWheelZoom className="catchment-map">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        <GeoJSON data={landCoverData} style={landCoverStyle} />
        <GeoJSON data={boundaryData} style={BOUNDARY_STYLE} onEachFeature={onEachFeature} />
        <GeoJSON data={riversData} style={RIVER_STYLE} />

        {/* Dynamic sensor markers with live reactive popups */}
        {sensorData.features.map((feature, idx) => {
          const coords = feature.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const [lng, lat] = coords;
          return (
            <Marker
              key={feature.properties?.id ?? idx}
              position={[lat, lng]}
              icon={sensorIcon}
            >
              <Popup className="sensor-popup-wrapper" maxWidth={290} minWidth={260}>
                <SensorPopupContent
                  feature={feature}
                  readings={readings}
                  nodes={nodes}
                  checkedAt={checkedAt}
                  onExpandPhoto={setExpandedPhoto}
                />
              </Popup>
            </Marker>
          );
        })}

        <FitBounds data={boundaryData} />
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
      <MapLegend />
      {boundaryHovered && <span className="catchment-map-hint">Dicklum River Catchment Boundary</span>}

      {/* Modern Photo Lightbox with Smooth Zoom Controls */}
      <PhotoLightboxModal
        photo={expandedPhoto}
        onClose={() => setExpandedPhoto(null)}
      />
    </div>
  );
};

export default CatchmentMap;
