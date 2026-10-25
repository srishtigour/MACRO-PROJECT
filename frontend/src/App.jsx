import L from 'leaflet'
import { useEffect, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

function isValidDistrictFeature(feature) {
  if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) return false

  try {
    return L.geoJSON(feature).getBounds().isValid()
  } catch {
    return false
  }
}

function FitMapToDistricts({ data }) {
  const map = useMap()

  useEffect(() => {
    if (!data) return

    const bounds = L.geoJSON(data).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] })
    }
  }, [data, map])

  return null
}

function App() {
  const [districts, setDistricts] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('http://localhost:5000/api/districts')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load districts.geojson')
        }
        return response.json()
      })
      .then((data) => {
        if (!Array.isArray(data?.features)) {
          throw new Error('districts.geojson does not contain a valid feature list')
        }

        const features = data.features.filter(isValidDistrictFeature)
        if (features.length === 0) {
          throw new Error('No valid district boundaries were found in districts.geojson')
        }

        setDistricts({ ...data, features })
      })
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p>{error}</p>
  if (!districts) return <p>Loading Madhya Pradesh districts...</p>

  const visibleDistricts = selectedDistrict
    ? { ...districts, features: [selectedDistrict] }
    : districts

  const selectDistrict = (feature) => {
    if (isValidDistrictFeature(feature)) setSelectedDistrict(feature)
  }

  return (
    <div className="map-page">
      {selectedDistrict && (
        <div className="district-selection" role="region" aria-label="Selected district">
          <span>{selectedDistrict.properties?.dtname || 'Selected district'}</span>
          <button type="button" onClick={() => setSelectedDistrict(null)}>
            Show All Districts
          </button>
        </div>
      )}
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
          key={selectedDistrict?.properties?.dtname || 'all-districts'}
          data={visibleDistricts}
          style={(feature) =>
            feature === selectedDistrict
              ? {
                  color: '#b45309',
                  weight: 3,
                  fillColor: '#f59e0b',
                  fillOpacity: 0.55,
                }
              : {
                  color: '#1769aa',
                  weight: 2,
                  fillColor: '#64b5f6',
                  fillOpacity: 0.2,
                }
          }
          onEachFeature={(feature, layer) => {
            if (!selectedDistrict) {
              layer.on({ click: () => selectDistrict(feature) })
            }
          }}
        />
        <FitMapToDistricts data={visibleDistricts} />
      </MapContainer>
    </div>
  )
}

export default App
