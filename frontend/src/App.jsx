import L from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const CRIME_CLASSES = [{label:'Low',color:'#2e9d50'},{label:'Medium',color:'#f28c28'},{label:'High',color:'#d62828'}]

function isValidDistrictFeature(feature) {
  if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) return false

  try {
    return L.geoJSON(feature).getBounds().isValid()
  } catch {
    return false
  }
}

function getQuantileBreaks(values) {
  if (values.length === 0) return []

  const sortedValues = [...values].sort((first, second) => first - second)
  return [1 / 3, 2 / 3].map((quantile) =>
    sortedValues[Math.ceil(quantile * sortedValues.length) - 1],
  )
}

function getCrimeColor(value, breaks) {
  if (!Number.isFinite(value) || breaks.length === 0) return '#cbd5e1'

  const colorIndex = breaks.findIndex((limit) => value <= limit)
  return CRIME_CLASSES[colorIndex === -1 ? CRIME_CLASSES.length - 1 : colorIndex].color
}

function formatCount(value) {
  return new Intl.NumberFormat('en-IN').format(value)
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
  const [crimeData, setCrimeData] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [showCrimeLayer, setShowCrimeLayer] = useState(false)
  const [error, setError] = useState('')
  const [crimeError, setCrimeError] = useState('')

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

    fetch('http://localhost:5000/api/crime')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load the 2024 crime data')
        }
        return response.json()
      })
      .then((data) => {
        if (!data?.districts || data.year !== 2024) {
          throw new Error('The crime data is missing district totals')
        }
        setCrimeData(data)
      })
      .catch((err) => setCrimeError(err.message))
  }, [])

  const visibleDistricts = useMemo(() => {
    if (!districts) return null
    return selectedDistrict
      ? { ...districts, features: [selectedDistrict] }
      : districts
  }, [districts, selectedDistrict])

  const crimeBreaks = useMemo(() => {
    if (!crimeData) return []
    return getQuantileBreaks(
      Object.values(crimeData.districts).map((district) => district.total),
    )
  }, [crimeData])
  const crimeLegendLabels = crimeBreaks.length === 2
    ? [
        '≤ ' + formatCount(crimeBreaks[0]),
        formatCount(crimeBreaks[0] + 1) + '–' + formatCount(crimeBreaks[1]),
        '> ' + formatCount(crimeBreaks[1]),
      ]
    : []
  const selectedDistrictName = selectedDistrict?.properties?.dtname || 'Selected district'
  const selectedCrime = crimeData?.districts?.[selectedDistrictName]
  const selectedCrimeTypes = selectedCrime?.crimeTypes
    ? selectedCrime.crimeTypes
        .filter((crimeType) => crimeType.count > 0)
        .sort((first, second) => second.count - first.count)
    : []
  const largestCrimeTypeCount = selectedCrimeTypes[0]?.count || 1

  if (error) return <p>{error}</p>
  if (!districts || !visibleDistricts) return <p>Loading Madhya Pradesh districts...</p>

  const selectDistrict = (feature) => {
    if (isValidDistrictFeature(feature)) setSelectedDistrict(feature)
  }



  return (
    <div className="map-page">
      <aside className="layer-panel" aria-label="Map layers">
        <h2>Map Layers</h2>
        <label className="layer-option">
          <input type="checkbox" checked={showCrimeLayer} disabled={!crimeData}
            onChange={(event) => setShowCrimeLayer(event.target.checked)} />
          <span>Crimes against women · 2024</span>
        </label>
        {!crimeData && !crimeError && <span className="layer-status">Loading crime data…</span>}
        {crimeError && <span className="crime-load-error">{crimeError}</span>}
        {selectedDistrict && (
          <section className="district-details" aria-label="Selected district crime details">
            <h3>{selectedDistrictName}</h3>
            {selectedCrime ? (
              <>
                <div className="district-crime-total">
                  <span>Total reported crimes · 2024</span>
                  <strong>{formatCount(selectedCrime.total)}</strong>
                </div>
                <h4>Crime type breakdown</h4>
                {selectedCrimeTypes.length > 0 ? (
                  <div className="district-crime-list">
                    {selectedCrimeTypes.map((crimeType) => (
                      <div className="district-crime-row" key={crimeType.name}>
                        <div className="district-crime-row-label">
                          <span>{crimeType.name}</span>
                          <strong>{formatCount(crimeType.count)}</strong>
                        </div>
                        <div className="district-crime-track">
                          <span
                            style={{ width: `${(crimeType.count / largestCrimeTypeCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>No crime-type counts were reported for this district.</p>
                )}
                <p className="district-crime-note">Only categories with reported cases are listed. Counts are not population-adjusted rates.</p>
              </>
            ) : crimeData ? (
              <p>Crime details are not available for this district boundary.</p>
            ) : (
              <p>Loading district crime details…</p>
            )}
          </section>
        )}
        {showCrimeLayer && crimeData && (
          <div className="crime-legend" aria-label="2024 crime map legend">
            <strong>Reported cases by district</strong>
            <span className="crime-legend-subtitle">Relative totals across MP districts</span>
            <div className="crime-legend-items">
              {CRIME_CLASSES.map((crimeClass, index) => (
                <div className="crime-legend-item" key={crimeClass.label}>
                  <span className="crime-legend-swatch" style={{ backgroundColor: crimeClass.color }} />
                  <span>{crimeClass.label}: {crimeLegendLabels[index]}</span>
                </div>
              ))}
            </div>
            <p>Pandhurna, Maihar, and Mauganj are grouped with their former district areas.
              Railway and cyber-unit reports ({formatCount(crimeData.excludedTotal)}) are not shown because they do not map to one district boundary.</p>
          </div>
        )}
      </aside>

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
          key={`${selectedDistrict?.properties?.dtname || 'all-districts'}-${showCrimeLayer ? 'crime' : 'plain'}`}
          data={visibleDistricts}
          style={(feature) => {
            const isSelected = feature === selectedDistrict
            const districtName = feature.properties?.dtname
            const count = crimeData?.districts?.[districtName]?.total

            if (showCrimeLayer) {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getCrimeColor(count, crimeBreaks),
                fillOpacity: 0.78,
              }
            }

            return isSelected
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
          }}
          onEachFeature={(feature, layer) => {
            const districtName = feature.properties?.dtname || 'District'
            const count = crimeData?.districts?.[districtName]?.total
            const tooltip = Number.isFinite(count)
              ? `${districtName}: ${formatCount(count)} reported crimes against women in 2024`
              : districtName

            layer.bindTooltip(tooltip, { sticky: true })
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
