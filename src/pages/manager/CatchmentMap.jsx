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
const SENSOR_STYLE = {
  radius: 8,
  color: "#ffffff",
  weight: 3,
  fillColor: "#d62828",
  fillOpacity: 1,
  interactive: false,
};

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
      // clipboard blocked (e.g. non-HTTPS) — fail silently, coords are still shown
    }
  };

  return (
    <div className="catchment-pin-popup">
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
        <span>{c.value} — {c.label}</span>
      </div>
    ))}

    <div className="catchment-legend-divider" />

    <div className="catchment-legend-row">
      <span className="catchment-legend-line catchment-legend-line--river" />
      <span>River Network</span>
    </div>
    <div className="catchment-legend-row">
      <span className="catchment-legend-line catchment-legend-line--boundary" />
      <span>Catchment Boundary</span>
    </div>
    <div className="catchment-legend-row">
      <span className="catchment-legend-dot" />
      <span>Sensor Location</span>
    </div>
  </div>
);

const CatchmentMap = () => {
  const [boundaryHovered, setBoundaryHovered] = useState(false);
  const [pin, setPin] = useState(null);

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
        <GeoJSON
          data={sensorData}
          pointToLayer={(feature, latlng) => L.circleMarker(latlng, SENSOR_STYLE)}
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