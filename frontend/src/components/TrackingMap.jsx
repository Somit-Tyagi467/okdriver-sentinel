import { useEffect } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { fmt, vehicleOf } from "../utils/dashboard.js";
function FitTraceToMap({
  events,
  center
}) {
  const map = useMap();
  useEffect(() => {
    if (events.length) {
      map.fitBounds(events.map(event => [+event.latitude, +event.longitude]), {
        padding: [36, 36],
        maxZoom: 14
      });
    } else {
      map.setView(center, 11);
    }
  }, [events, center, map]);
  return null;
}
function numberedMarker(number) {
  return L.divIcon({
    className: "numbered-pin",
    html: `<span>${number}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}
export default function TrackingMap({
  events,
  center
}) {
  const points = events.filter(event => Number.isFinite(+event.latitude) && Number.isFinite(+event.longitude));
  return <div id="trace-map" className="map-shell">
      <MapContainer center={center} zoom={11} scrollWheelZoom className="map">
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitTraceToMap events={points} center={center} />
        {points.length > 1 && <Polyline positions={points.map(event => [+event.latitude, +event.longitude])} pathOptions={{
        color: "#2563eb",
        weight: 4,
        opacity: 0.75
      }} />}
        {points.map((event, index) => <Marker key={event.id || index} position={[+event.latitude, +event.longitude]} icon={numberedMarker(index + 1)}>
            <Popup>
              <b>Sighting {index + 1}</b>
              <br />
              {vehicleOf(event)}
              <br />
              {event.camera_name} · {fmt(event.timestamp)}
            </Popup>
          </Marker>)}
      </MapContainer>
    </div>;
}
