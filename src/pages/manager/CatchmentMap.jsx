import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import { Copy, Check } from "lucide-react";
import L from "leaflet";
import catchmentData from "../../data/dicklumCatchment.json";
import "../../styles/manager/CatchmentMap.css";

const BOUNDARY_STYLE = { color: "#14658f", weight: 3, fillColor: "#14658f", fillOpacity: 0.08 };
const HOVER_STYLE = { color: "#14658f", weight: 4, fillOpacity: 0.16 };

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
      <MapContainer center={[8.29, 124.84]} zoom={13} scrollWheelZoom={false} className="catchment-map">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <GeoJSON data={catchmentData} style={BOUNDARY_STYLE} onEachFeature={onEachFeature} />
        <FitBounds data={catchmentData} />
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
      {boundaryHovered && <span className="catchment-map-hint">Dicklum River Catchment Boundary</span>}
    </div>
  );
};

export default CatchmentMap;
