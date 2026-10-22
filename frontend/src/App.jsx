
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

function FitMapToDistricts({ data }) {
  const map = useMap()

  useEffect(() => {
    if (data) {
      const layer = L.geoJSON(data)
      const bounds = layer.getBounds()

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] })
      }
    }
  }, [data, map])

  return null
}

function App() {
  const [districts, setDistricts] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/districts.geojson')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load districts.geojson')
        }
        return response.json()
      })
      .then(setDistricts)
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p>{error}</p>
  if (!districts) return <p>Loading Madhya Pradesh districts...</p>

  return (
    <div style={{ height: '100vh', width: '100%' }}>
      <MapContainer
        center={[23.5, 78.5]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON
          data={districts}
          style={{
            color: '#1769aa',
            weight: 2,
            fillColor: '#64b5f6',
            fillOpacity: 0.2,
          }}
        />
        <FitMapToDistricts data={districts} />
      </MapContainer>
    </div>
  )
}

export default App

