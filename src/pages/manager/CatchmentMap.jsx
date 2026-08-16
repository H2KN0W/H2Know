import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import catchmentData from "../../data/dicklumCatchment.json";
import "../../styles/manager/CatchmentMap.css";

const BOUNDARY_STYLE = { color: "#ff8c00", weight: 3, fillColor: "#ff8c00", fillOpacity: 0.08 };
const HOVER_STYLE = { color: "#ff8c00", weight: 4, fillOpacity: 0.2 };

const FitBounds = ({ data }) => {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(data);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
  }, [data, map]);
  return null;
};

const CatchmentMap = () => {
  const [hovered, setHovered] = useState(false);

  const onEachFeature = useMemo(() => (feature, layer) => {
    layer.on({
      mouseover: (e) => { e.target.setStyle(HOVER_STYLE); setHovered(true); },
      mouseout: (e) => { e.target.setStyle(BOUNDARY_STYLE); setHovered(false); },
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
      </MapContainer>
      {hovered && <span className="catchment-map-hint">Dicklum River Catchment Boundary</span>}
    </div>
  );
};

export default CatchmentMap;