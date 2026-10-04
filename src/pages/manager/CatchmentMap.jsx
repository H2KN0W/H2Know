import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import { Copy, Check } from "lucide-react";
import L from "leaflet";
import catchmentData from "../../data/catchmentBoundary.geojson?raw";
import landCoverRaw from "../../data/landCover.geojson?raw";
import riversRaw from "../../data/riverNetwork.geojson?raw";
import sensorRaw from "../../data/sensorLocation.geojson?raw";
import "../../styles/manager/CatchmentMap.css";

const boundaryData = JSON.parse(catchmentData);
const landCoverData = JSON.parse(landCoverRaw);
const riversData = JSON.parse(riversRaw);
const sensorData = JSON.parse(sensorRaw);

const BOUNDARY_STYLE = { color: "#000000", weight: 1.5, fillColor: "#000000", fillOpacity: 0.08 };
const HOVER_STYLE = { color: "#000000", weight: 2.5, fillOpacity: 0.16 };

const RIVER_STYLE = { color: "#0891b2", weight: 1.5, opacity: 1, interactive: false };

const sensorIcon = L.divIcon({
  className: "sensor-marker-icon",
  html: `<div class="sensor-marker-dot" title="Click to view sensor details"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// Legend / fill colors for the `landuse` attribute values in landCover.geojson
const LAND_USE_CLASSES = [
  { value: "1", label: "Water", color: "#3F8EDB" },
  { value: "2", label: "Trees", color: "#397D49" },
  { value: "5", label: "Crops", color: "#E49635" },
  { value: "7", label: "Built Area", color: "#C4281B" },
  { value: "10", label: "Bare Ground", color: "#E3E2C3" },
  { value: "11", label: "Rangeland", color: "#E3E2C3" },
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
  const text = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;

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
      <span>{text}</span>
      <button type="button" onClick={handleCopy} title="Copy coordinates" aria-label="Copy coordinates">
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};

const MapLegend = () => (
  <div className="catchment-legend" aria-label="Map legend">
    <div className="catchment-legend-title">Land Use / Land Cover</div>
    {LAND_USE_CLASSES.map((c) => (
      <div className="catchment-legend-row" key={c.value}>
        <span className="catchment-legend-swatch" style={{ background: c.color }} />
        <span className="catchment-legend-label">{c.label}</span>
      </div>
    ))}
  </div>
);

// Build a Leaflet popup DOM element for a sensor feature.
// Uses live data (readings, nodes, checkedAt) when available.
function buildSensorPopup(feature, { readings = [], nodes = [], checkedAt = null } = {}) {
  const p = feature.properties || {};
  const sensorId = p.id;

  // Match to a node by id
  const node = nodes.find((n) => String(n.id) === String(sensorId));

  // Last sync for this node
  const lastSync = node
    ? readings.find((r) => r.nodes?.id === node.id)?.recorded_at ?? null
    : null;

  // Online status
  const online =
    lastSync && checkedAt
      ? checkedAt - new Date(lastSync).getTime() <= 5 * 60 * 1000
      : false;

  const statusDot = online
    ? `<span class="smp-status online">● Online</span>`
    : `<span class="smp-status offline">● Offline</span>`;

  // Latest readings for this node
  const nodeReadings = node
    ? readings.filter((r) => r.nodes?.id === node.id)
    : [];
  const paramMap = {};
  nodeReadings.forEach((r) => {
    const name = r.parameters?.name?.toLowerCase();
    if (name && !(name in paramMap)) paramMap[name] = `${r.value} ${r.parameters?.unit || ""}`.trim();
  });

  const readingRows = Object.entries(paramMap)
    .slice(0, 4)
    .map(([name, val]) => `<tr><td class="smp-param">${name}</td><td class="smp-val">${val}</td></tr>`)
    .join("");

  const lastSyncStr = lastSync ? new Date(lastSync).toLocaleString() : "No data yet";

  // photo: per-sensor field in GeoJSON properties; falls back to placeholder
  const photoSrc = p.photo || "/assets/img/location.jpg";

  const el = document.createElement("div");
  el.className = "sensor-map-popup";
  el.innerHTML = `
    <img class="smp-photo" src="${photoSrc}" alt="${p.name || "Sensor location"}" loading="lazy" />
    <div class="smp-body">
      <div class="smp-header">
        <strong class="smp-name">${p.name || `Sensor #${sensorId}`}</strong>
        ${statusDot}
      </div>
      ${p.description ? `<p class="smp-desc">${p.description}</p>` : ""}
      <table class="smp-table">
        <tr><td class="smp-param">Location</td><td class="smp-val">${p.location || "—"}</td></tr>
        <tr><td class="smp-param">Last sync</td><td class="smp-val">${lastSyncStr}</td></tr>
        ${readingRows}
      </table>
    </div>
  `;
  return el;
}

/**
 * CatchmentMap
 *
 * Props:
 *   readings   – sensor_readings rows from Supabase (for live status/values in popup)
 *   nodes      – nodes rows from Supabase (to match sensor IDs)
 *   checkedAt  – Date.now() timestamp of last data fetch (for online/offline calc)
 *
 * Sensor marker click opens a native Leaflet popup with location photo, name,
 * description, status, and latest readings. The photo path is stored as the
 * `photo` field in sensorLocation.geojson — swap it per-sensor for real deployment.
 */
const CatchmentMap = ({ readings = [], nodes = [], checkedAt = null }) => {
  const [boundaryHovered, setBoundaryHovered] = useState(false);
  const [pin, setPin] = useState(null);

  const onEachFeature = useMemo(() => (feature, layer) => {
    layer.on({
      mouseover: (e) => { e.target.setStyle(HOVER_STYLE); setBoundaryHovered(true); },
      mouseout: (e) => { e.target.setStyle(BOUNDARY_STYLE); setBoundaryHovered(false); },
    });
  }, []);

  // Build and bind sensor popup. Uses live data if provided.
  // stopPropagation on click so ClickToPin doesn't also drop a coordinate pin.
  const onEachSensor = useMemo(() => (feature, layer) => {
    const popupEl = buildSensorPopup(feature, { readings, nodes, checkedAt });
    layer.bindPopup(popupEl, {
      maxWidth: 280,
      className: "sensor-popup-wrapper",
    });
    layer.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, nodes, checkedAt]);

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
        <GeoJSON
          key={`sensors-${checkedAt}`}
          data={sensorData}
          pointToLayer={(feature, latlng) => L.marker(latlng, { icon: sensorIcon })}
          onEachFeature={onEachSensor}
        />
        <FitBounds data={boundaryData} />
        <ClickToPin onPick={setPin} />
        {pin && (
          <>
            <Marker position={pin} />
            <Popup
              key={`${pin.lat}-${pin.lng}`}
              position={pin}
              autoClose={false}
              closeOnClick={false}
              eventHandlers={{ remove: () => setPin(null) }}
            >
              <CoordPopupContent latlng={pin} />
            </Popup>
          </>
        )}
      </MapContainer>
      <MapLegend />
      {boundaryHovered && <span className="catchment-map-hint">Dicklum River Catchment Boundary</span>}
    </div>
  );
};

export default CatchmentMap;
