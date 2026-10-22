
import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "./App.css";

function App() {
  const [districts, setDistricts] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/MP_DISTRICTS.geojson")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load the GeoJSON file");
        }
        return response.json();
      })
      .then((data) => setDistricts(data))
      .catch((err) => setError(err.message));
  }, []);

  const districtStyle = {
    color: "#174EA6",
    weight: 2,
    fillColor: "#72B7E8",
    fillOpacity: 0.15,
  };

  return (
    <div className="app">
      <h1>Madhya Pradesh Geospatial Data System</h1>
      <p>State and district boundary map</p>

      {error && <p className="error">{error}</p>}

      <MapContainer
        center={[23.5, 78.5]}
        zoom={6}
        scrollWheelZoom={true}
        className="map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {districts && (
          <GeoJSON
            data={districts}
            style={districtStyle}
            onEachFeature={(feature, layer) => {
              const props = feature.properties || {};

              const name =
                props.district ||
                props.DISTRICT ||
                props.Dist_Name ||
                props.NAME_2 ||
                props.name ||
                "District";

              layer.bindPopup(name);
              layer.bindTooltip(name);
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}

export default App;
