import L from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const CRIME_CLASSES = [
  { label: 'Low', color: '#2e9d50' },
  { label: 'Medium', color: '#f28c28' },
  { label: 'High', color: '#d62828' },
]
const POPULATION_COLORS = ['#eff3ff', '#c6dbef', '#6baed6', '#3182bd', '#08519c']
const POPULATION_SOURCE_NAMES = {
  'Agar Malwa': 'Agar-Malwa',
  Hoshangabad: 'Narmadapuram',
  Narsimhapur: 'Narsinghpur',
}
const POPULATION_GROUPS = {
  Chhindwara: ['Chhindwara', 'Pandhurna'],
  Rewa: ['Rewa', 'Mauganj'],
  Satna: ['Satna', 'Maihar'],
}
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

function isValidDistrictFeature(feature) {
  if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) return false

  try {
    return L.geoJSON(feature).getBounds().isValid()
  } catch {
    return false
  }
}

function getQuantileBreaks(values, classCount) {
  if (values.length === 0) return []

  const sortedValues = [...values].sort((first, second) => first - second)
  return Array.from({ length: classCount - 1 }, (_, index) => {
    const quantile = (index + 1) / classCount
    return sortedValues[Math.ceil(quantile * sortedValues.length) - 1]
  })
}

function getCrimeColor(value, breaks) {
  if (!Number.isFinite(value) || breaks.length === 0) return '#cbd5e1'

  const colorIndex = breaks.findIndex((limit) => value <= limit)
  return CRIME_CLASSES[colorIndex === -1 ? CRIME_CLASSES.length - 1 : colorIndex].color
}

function getPopulationColor(value, breaks) {
  if (!Number.isFinite(value) || breaks.length !== POPULATION_COLORS.length - 1) {
    return '#cbd5e1'
  }

  const colorIndex = breaks.findIndex((limit) => value <= limit)
  return POPULATION_COLORS[colorIndex === -1 ? POPULATION_COLORS.length - 1 : colorIndex]
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
  const [populationData, setPopulationData] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [activeLayer, setActiveLayer] = useState('districts')
  const [error, setError] = useState('')
  const [crimeError, setCrimeError] = useState('')
  const [populationError, setPopulationError] = useState('')

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/districts`)
      .then((response) => {
        if (!response.ok) throw new Error('Could not load districts.geojson')
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

    fetch(`${API_BASE_URL}/api/crime`)
      .then((response) => {
        if (!response.ok) throw new Error('Could not load the 2024 crime data')
        return response.json()
      })
      .then((data) => {
        if (!data?.districts || data.year !== 2024) {
          throw new Error('The crime data is missing district totals')
        }
        setCrimeData(data)
      })
      .catch((err) => setCrimeError(err.message))

    fetch(`${API_BASE_URL}/api/population`)
      .then((response) => {
        if (!response.ok) throw new Error('Could not load the 2026 population estimates')
        return response.json()
      })
      .then((data) => {
        if (!Array.isArray(data?.records)) {
          throw new Error('Population data does not contain a valid record list')
        }
        setPopulationData(data)
      })
      .catch((err) => setPopulationError(err.message))
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
      CRIME_CLASSES.length,
    )
  }, [crimeData])
  const crimeLegendLabels = crimeBreaks.length === 2
    ? [
        `≤ ${formatCount(crimeBreaks[0])}`,
        `${formatCount(crimeBreaks[0] + 1)}–${formatCount(crimeBreaks[1])}`,
        `> ${formatCount(crimeBreaks[1])}`,
      ]
    : []

  const populationByDistrict = useMemo(() => {
    if (!districts || !populationData) return null

    const recordCounts = new Map()
    populationData.records.forEach((record) => {
      const name = record.district_name
      recordCounts.set(name, (recordCounts.get(name) || 0) + 1)
    })
    const duplicateNames = new Set(
      [...recordCounts].filter(([, count]) => count > 1).map(([name]) => name),
    )
    const recordsByName = new Map(
      populationData.records
        .filter((record) => !duplicateNames.has(record.district_name))
        .map((record) => [record.district_name, record]),
    )
    const matchedSourceNames = new Set()
    const values = {}

    districts.features.forEach((feature) => {
      const districtName = feature.properties?.dtname
      const sourceNames = POPULATION_GROUPS[districtName] || [
        POPULATION_SOURCE_NAMES[districtName] || districtName,
      ]
      const sourceRecords = sourceNames.map((name) => recordsByName.get(name))
      const counts = sourceRecords.map((record) => {
        const rawValue = record?.population_2026_estimate
        return rawValue?.trim() ? Number(rawValue) : Number.NaN
      })
      const validRecords = sourceRecords.every((record, index) =>
        record && record.year === '2026' && Number.isFinite(counts[index]) && counts[index] >= 0,
      )

      if (!validRecords) return

      sourceNames.forEach((name) => matchedSourceNames.add(name))
      values[districtName] = {
        total: counts.reduce((sum, count) => sum + count, 0),
        sourceNames,
        grouped: sourceNames.length > 1,
      }
    })

    return {
      values,
      duplicateNames: [...duplicateNames],
      unmatchedNames: populationData.records
        .filter((record) => !matchedSourceNames.has(record.district_name))
        .map((record) => record.district_name),
    }
  }, [districts, populationData])

  const populationBreaks = useMemo(() => {
    if (!populationByDistrict) return []
    return getQuantileBreaks(
      Object.values(populationByDistrict.values).map((district) => district.total),
      POPULATION_COLORS.length,
    )
  }, [populationByDistrict])

  const selectedDistrictName = selectedDistrict?.properties?.dtname || 'Selected district'
  const selectedCrime = crimeData?.districts?.[selectedDistrictName]
  const selectedPopulation = populationByDistrict?.values?.[selectedDistrictName]
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
        <div className="layer-selector" role="group" aria-label="Choose map layer">
          <button type="button" aria-pressed={activeLayer === 'districts'}
            onClick={() => setActiveLayer('districts')}>Districts</button>
          <button type="button" aria-pressed={activeLayer === 'crime'}
            onClick={() => setActiveLayer('crime')}>Crime</button>
          <button type="button" aria-pressed={activeLayer === 'population'}
            onClick={() => setActiveLayer('population')}>Population</button>
        </div>
        {activeLayer === 'crime' && !crimeData && !crimeError &&
          <span className="layer-status">Loading crime data…</span>}
        {activeLayer === 'crime' && crimeError &&
          <span className="crime-load-error">{crimeError}</span>}
        {activeLayer === 'population' && !populationData && !populationError &&
          <span className="layer-status">Loading 2026 population estimates…</span>}
        {activeLayer === 'population' && populationError &&
          <span className="crime-load-error">{populationError}</span>}

        {selectedDistrict && (
          <section className="district-details" aria-label="Selected district details">
            <h3>{selectedDistrictName}</h3>
            {activeLayer === 'crime' && selectedCrime ? (
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
                          <span style={{ width: `${(crimeType.count / largestCrimeTypeCount) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>No crime-type counts were reported for this district.</p>
                )}
                <p className="district-crime-note">Only categories with reported cases are listed. Counts are not population-adjusted rates.</p>
              </>
            ) : activeLayer === 'crime' && crimeData ? (
              <p>Crime details are not available for this district boundary.</p>
            ) : activeLayer === 'crime' ? (
              <p>Loading district crime details…</p>
            ) : activeLayer === 'population' && selectedPopulation ? (
              <>
                <div className="district-crime-total">
                  <span>Estimated population · 2026</span>
                  <strong>{formatCount(selectedPopulation.total)}</strong>
                </div>
                <p className="district-crime-note">Third-party estimate; not an official Census count.
                  {selectedPopulation.grouped && ` Combined from ${selectedPopulation.sourceNames.join(' + ')} to match this existing boundary.`}</p>
              </>
            ) : activeLayer === 'population' && populationByDistrict ? (
              <p>Population estimate unavailable for this boundary; no other district’s value was assigned.</p>
            ) : activeLayer === 'population' ? (
              <p>Loading district population estimate…</p>
            ) : (
              <p>Select Crime or Population to view district data.</p>
            )}
          </section>
        )}

        {activeLayer === 'crime' && crimeData && (
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

        {activeLayer === 'population' && populationByDistrict && (
          <div className="crime-legend" aria-label="2026 estimated population map legend">
            <strong>Estimated population · 2026</strong>
            <span className="crime-legend-subtitle">Third-party estimates; not official Census counts</span>
            {populationBreaks.length === POPULATION_COLORS.length - 1 ? (
              <div className="crime-legend-items">
                {POPULATION_COLORS.map((color, index) => {
                  const lower = index === 0 ? null : populationBreaks[index - 1]
                  const upper = populationBreaks[index]
                  const label = index === 0
                    ? `≤ ${formatCount(upper)}`
                    : index === POPULATION_COLORS.length - 1
                      ? `> ${formatCount(lower)}`
                      : `${formatCount(lower + 1)}–${formatCount(upper)}`
                  return (
                    <div className="crime-legend-item" key={color}>
                      <span className="crime-legend-swatch" style={{ backgroundColor: color }} />
                      <span>{label}</span>
                    </div>
                  )
                })}
                <div className="crime-legend-item">
                  <span className="crime-legend-swatch" style={{ backgroundColor: '#cbd5e1' }} />
                  <span>Unavailable</span>
                </div>
              </div>
            ) : (
              <p>No valid population estimates are available to build the legend.</p>
            )}
            <p>Source: <a href="https://indiaindex.vercel.app/madhya-pradesh/districts/" target="_blank" rel="noreferrer">GlobalMetrics, district-wise Madhya Pradesh estimates</a> (accessed 2026-10-28). Maihar, Mauganj, and Pandhurna estimates are combined with their legacy boundary areas.</p>
            {populationByDistrict.duplicateNames.length > 0 &&
              <p>Duplicate CSV district names left unmapped: {populationByDistrict.duplicateNames.join(', ')}.</p>}
            {populationByDistrict.unmatchedNames.length > 0 &&
              <p>Unmatched CSV districts left unmapped: {populationByDistrict.unmatchedNames.join(', ')}.</p>}
          </div>
        )}
      </aside>

      {selectedDistrict && (
        <div className="district-selection" role="region" aria-label="Selected district">
          <span>{selectedDistrictName}</span>
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
          key={`${selectedDistrictName}-${activeLayer}`}
          data={visibleDistricts}
          style={(feature) => {
            const isSelected = feature === selectedDistrict
            const districtName = feature.properties?.dtname
            const crimeCount = crimeData?.districts?.[districtName]?.total
            const population = populationByDistrict?.values?.[districtName]?.total

            if (activeLayer === 'crime') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getCrimeColor(crimeCount, crimeBreaks),
                fillOpacity: 0.78,
              }
            }

            if (activeLayer === 'population') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getPopulationColor(population, populationBreaks),
                fillOpacity: 0.82,
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
            const crimeCount = crimeData?.districts?.[districtName]?.total
            const population = populationByDistrict?.values?.[districtName]
            const tooltip = activeLayer === 'crime' && Number.isFinite(crimeCount)
              ? `${districtName}: ${formatCount(crimeCount)} reported crimes against women in 2024`
              : activeLayer === 'population' && population
                ? `${districtName}: ${formatCount(population.total)} estimated population in 2026`
                : activeLayer === 'population'
                  ? `${districtName}: population estimate unavailable`
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
