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
const SEX_RATIO_CLASSES = [
  { label: '< 900', minimum: 0, color: '#d73027' },
  { label: '900–949', minimum: 900, color: '#fc8d59' },
  { label: '950–999', minimum: 950, color: '#fee08b' },
  { label: '1,000+', minimum: 1000, color: '#1a9850' },
]
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
const SEX_RATIO_SOURCE_NAMES = {
  Khargone: 'West Nimar',
  Khandwa: 'East Nimar',
  Chhatarpur: 'Chhattarpur',
}
const NEWS_COLORS = { none: '#e5e7eb', low: '#bfdbfe', medium: '#60a5fa', high: '#1d4ed8' }
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const PCI_COLORS = ['#fff7bc', '#fec44f', '#fe9929', '#ec7014', '#990000']
const PCI_NAME_ALIASES = {
  narmadapuram: 'hoshangabad',
  narsinghpur: 'narsimhapur',
}

const LITERACY_CLASSES = [
  { label: '0–49.99%', minimum: 0, color: '#ffffcc' },
  { label: '50–59.99%', minimum: 50, color: '#c2e699' },
  { label: '60–69.99%', minimum: 60, color: '#78c679' },
  { label: '70–79.99%', minimum: 70, color: '#31a354' },
  { label: '80–100%', minimum: 80, color: '#006837' },
]

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

function getSexRatioColor(value) {
  if (!Number.isFinite(value) || value < 0) return '#cbd5e1'
  return [...SEX_RATIO_CLASSES].reverse().find((item) => value >= item.minimum)?.color || '#cbd5e1'
}

function getLiteracyColor(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) return '#cbd5e1'
  const colorClass = [...LITERACY_CLASSES].reverse().find((item) => value >= item.minimum)
  return colorClass?.color || '#cbd5e1'
}

function formatCount(value) {
  return new Intl.NumberFormat('en-IN').format(value)
}

function formatRupees(value) {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)}`
}

function normalizeDistrictName(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  return PCI_NAME_ALIASES[normalized] || normalized
}

function getPciColor(value, breaks) {
  if (!Number.isFinite(value) || breaks.length !== PCI_COLORS.length - 1) {
    return '#cbd5e1'
  }

  const colorIndex = breaks.findIndex((limit) => value <= limit)
  return PCI_COLORS[colorIndex === -1 ? PCI_COLORS.length - 1 : colorIndex]
}

function createPciPopupContent(mapDistrictName, record) {
  const content = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = `District: ${mapDistrictName}`
  content.append(title)

  if (record.districtName.toLowerCase() !== mapDistrictName.trim().toLowerCase()) {
    const csvName = document.createElement('div')
    csvName.textContent = `CSV district name: ${record.districtName}`
    content.append(csvName)
  }

  const income = document.createElement('div')
  income.textContent = `Average Per Capita Income: ${formatRupees(record.amount)}`
  content.append(income)

  const estimateType = document.createElement('div')
  estimateType.textContent = `Estimate Type: ${record.estimateType || 'Not specified'}`
  content.append(estimateType)
  if (record.isProxy) {
    const proxyNote = document.createElement('div')
    proxyNote.textContent = 'This is a parent-district proxy estimate.'
    content.append(proxyNote)
  }
  return content
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
  const [sexRatioData, setSexRatioData] = useState(null)
  const [literacyData, setLiteracyData] = useState(null)
  const [pciData, setPciData] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [activeLayer, setActiveLayer] = useState('districts')
  const [populationMetric, setPopulationMetric] = useState('total')
  const [error, setError] = useState('')
  const [crimeError, setCrimeError] = useState('')
  const [populationError, setPopulationError] = useState('')
  const [sexRatioError, setSexRatioError] = useState('')
  const [literacyError, setLiteracyError] = useState('')
  const [newsPayload, setNewsPayload] = useState(null)
  const [newsError, setNewsError] = useState('')
  const [newsView, setNewsView] = useState('today')
  const [newsLanguage, setNewsLanguage] = useState('all')
  const [pciError, setPciError] = useState('')
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

    fetch(`${API_BASE_URL}/api/sex-ratio`)
      .then((response) => {
        if (!response.ok) throw new Error('Could not load 2011 Census sex-ratio data')
        return response.json()
      })
      .then((data) => {
        if (data?.year !== 2011 || !Array.isArray(data?.records)) {
          throw new Error('Sex-ratio data does not contain valid 2011 district records')
        }
        setSexRatioData(data)
      })
      .catch((err) => setSexRatioError(err.message))

    fetch('http://localhost:5000/api/literacy')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load the 2011 Census literacy data (HTTP ${response.status})`)
        }
        return response.json()
      })
      .then((data) => {
        if (!Array.isArray(data?.records)) {
          throw new Error('Census literacy data does not contain a valid record list')
        }
        setLiteracyData(data)
      })
      .catch((err) => setLiteracyError(err.message))

    fetch(`${API_BASE_URL}/api/pci`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load the PCI dataset (HTTP ${response.status})`)
        }
        return response.json()
      })
      .then((data) => {
        if (!Array.isArray(data?.records)) {
          throw new Error('PCI data does not contain a valid record list')
        }
        setPciData(data)
      })
      .catch((err) => setPciError(err.message))
  }, [])

  useEffect(() => {
    let mounted = true
    const loadNews = () => {
      fetch(`${API_BASE_URL}/api/news`)
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load news (HTTP ${response.status})`)
          return response.json()
        })
        .then((data) => {
          if (!mounted) return
          setNewsPayload(data)
          setNewsError('')
        })
        .catch((error) => {
          if (mounted) setNewsError(error.message)
        })
    }
    loadNews()
    const interval = window.setInterval(loadNews, 60_000)
    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [])
  const visibleDistricts = useMemo(() => {
    if (!districts) return null
    return selectedDistrict && activeLayer !== 'pci'
      ? { ...districts, features: [selectedDistrict] }
      : districts
  }, [districts, selectedDistrict, activeLayer])

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

  const sexRatioByDistrict = useMemo(() => {
    if (!districts || !sexRatioData) return null

    const counts = new Map()
    sexRatioData.records.forEach((record) => {
      const name = record.district_name?.trim()
      if (name) counts.set(name, (counts.get(name) || 0) + 1)
    })
    const duplicates = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
    const recordsByName = new Map(
      sexRatioData.records
        .filter((record) => !duplicates.has(record.district_name?.trim()))
        .map((record) => [record.district_name.trim(), record]),
    )
    const matchedNames = new Set()
    const values = {}

    districts.features.forEach((feature) => {
      const districtName = feature.properties?.dtname
      const sourceName = SEX_RATIO_SOURCE_NAMES[districtName] || districtName
      const record = recordsByName.get(sourceName)
      if (
        record &&
        Number.isFinite(record.sex_ratio) &&
        record.sex_ratio >= 0 &&
        record.sex_ratio <= 2000
      ) {
        values[districtName] = record
        matchedNames.add(sourceName)
      }
    })

    return {
      values,
      duplicateNames: [...duplicates],
      unmatchedNames: sexRatioData.records
        .filter((record) => !matchedNames.has(record.district_name?.trim()))
        .map((record) => record.district_name?.trim()),
      unavailableDistricts: districts.features
        .map((feature) => feature.properties?.dtname)
        .filter((name) => !values[name]),
    }
  }, [districts, sexRatioData])

  const literacyByCode = useMemo(() => {
    if (!districts || !literacyData) return null

    const recordCounts = new Map()
    literacyData.records.forEach((record) => {
      const code = String(record.census_district_code)
      recordCounts.set(code, (recordCounts.get(code) || 0) + 1)
    })
    const duplicateCodes = new Set(
      [...recordCounts].filter(([, count]) => count > 1).map(([code]) => code),
    )
    const recordsByCode = new Map(
      literacyData.records
        .filter((record) => !duplicateCodes.has(String(record.census_district_code)))
        .map((record) => [String(record.census_district_code), record]),
    )
    const featureCodes = new Set(
      districts.features.map((feature) => String(feature.properties?.dtcode11)),
    )
    const values = {}

    districts.features.forEach((feature) => {
      const code = String(feature.properties?.dtcode11)
      const record = recordsByCode.get(code)
      if (
        record?.data_type === 'census' &&
        record.data_year === 2011 &&
        Number.isFinite(record.literacy_rate) &&
        record.literacy_rate >= 0 &&
        record.literacy_rate <= 100
      ) {
        values[code] = record
      }
    })

    return {
      values,
      duplicateCodes: [...duplicateCodes],
      unmatchedCodes: literacyData.records
        .filter((record) => !featureCodes.has(String(record.census_district_code)))
        .map((record) => record.census_district_code),
    }
  }, [districts, literacyData])

  const newsEvents = newsView === 'today'
    ? newsPayload?.today?.events || []
    : newsPayload?.publishedDigest?.events || []
  const languageNewsEvents = newsEvents.filter((event) => newsLanguage === 'all' || event.language === newsLanguage)
  const visibleNewsEvents = languageNewsEvents.filter((event) => !selectedDistrict || (event.mapDistrict || event.district) === selectedDistrict?.properties?.dtname)
  const newsDistrictCounts = useMemo(() => languageNewsEvents.reduce((counts, event) => {
    const boundaryName = event.mapDistrict || event.district
    if (boundaryName) counts[boundaryName] = (counts[boundaryName] || 0) + 1
    return counts
  }, {}), [languageNewsEvents])

  const pciByDistrict = useMemo(() => {
    if (!districts || !pciData) return null
    const recordCounts = new Map()
    pciData.records.forEach((record) => {
      const key = normalizeDistrictName(record.District)
      recordCounts.set(key, (recordCounts.get(key) || 0) + 1)
    })
    const duplicateNames = new Set([...recordCounts].filter(([, count]) => count > 1).map(([name]) => name))
    const recordsByName = new Map()
    pciData.records.forEach((record) => {
      const key = normalizeDistrictName(record.District)
      const amount = Number(record.Average_PCI_Rupees)
      if (!duplicateNames.has(key) && record.Average_PCI_Rupees?.trim() && Number.isFinite(amount) && amount >= 0) {
        recordsByName.set(key, { ...record, amount })
      }
    })
    const usedNames = new Set()
    const values = {}
    const unmatchedBoundaryNames = []
    districts.features.forEach((feature) => {
      const districtName = feature.properties?.dtname || ''
      const key = normalizeDistrictName(districtName)
      const record = duplicateNames.has(key) ? null : recordsByName.get(key)
      if (!record) {
        unmatchedBoundaryNames.push(districtName)
        return
      }
      values[key] = {
        districtName: record.District.trim(),
        amount: record.amount,
        estimateType: record.Estimate_Type,
        isProxy: /^proxy\b/i.test(record.Estimate_Type?.trim() || ''),
      }
      usedNames.add(record.District)
    })
    return {
      values,
      duplicateNames: [...duplicateNames],
      unmatchedRecords: pciData.records.filter((record) => !usedNames.has(record.District)).map((record) => record.District),
      unmatchedBoundaryNames,
    }
  }, [districts, pciData])

  const pciBreaks = useMemo(() => {
    if (!pciByDistrict) return []
    return getQuantileBreaks(Object.values(pciByDistrict.values).map((district) => district.amount), PCI_COLORS.length)
  }, [pciByDistrict])

  const selectedDistrictName = selectedDistrict?.properties?.dtname || 'Selected district'
  const selectedCrime = crimeData?.districts?.[selectedDistrictName]
  const selectedPopulation = populationByDistrict?.values?.[selectedDistrictName]
  const selectedSexRatio = sexRatioByDistrict?.values?.[selectedDistrictName]
  const selectedLiteracy = literacyByCode?.values?.[String(selectedDistrict?.properties?.dtcode11)]
  const selectedPci = pciByDistrict?.values?.[normalizeDistrictName(selectedDistrictName)]
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
          <button type="button" aria-pressed={activeLayer === 'news'} onClick={() => setActiveLayer('news')}>News · Live</button>
          <button type="button" aria-pressed={activeLayer === 'literacy'}
            onClick={() => setActiveLayer('literacy')}>Literacy 2011</button>
          <button type="button" aria-pressed={activeLayer === 'pci'}
            onClick={() => setActiveLayer('pci')}>Per Capita Income (PCI)</button>
        </div>
        {activeLayer === 'population' && (
          <div className="population-metric-selector" role="group" aria-label="Population data type">
            <span>Population breakdown</span>
            <button type="button" aria-pressed={populationMetric === 'total'}
              onClick={() => setPopulationMetric('total')}>Total population</button>
            <button type="button" aria-pressed={populationMetric === 'sexRatio'}
              onClick={() => setPopulationMetric('sexRatio')}>Sex ratio · Census 2011</button>
          </div>
        )}
        {activeLayer === 'crime' && !crimeData && !crimeError &&
          <span className="layer-status">Loading crime data…</span>}
        {activeLayer === 'crime' && crimeError &&
          <span className="crime-load-error">{crimeError}</span>}
        {activeLayer === 'population' && !populationData && !populationError &&
          <span className="layer-status">Loading 2026 population estimates…</span>}
        {activeLayer === 'population' && populationError &&
          <span className="crime-load-error">{populationError}</span>}
        {activeLayer === 'population' && populationMetric === 'sexRatio' && !sexRatioData && !sexRatioError &&
          <span className="layer-status">Loading 2011 Census sex-ratio data…</span>}
        {activeLayer === 'population' && populationMetric === 'sexRatio' && sexRatioError &&
          <span className="crime-load-error">{sexRatioError}</span>}
        {activeLayer === 'literacy' && !literacyData && !literacyError &&
          <span className="layer-status">Loading Census literacy data…</span>}
        {activeLayer === 'news' && newsError &&
          <span className="crime-load-error">{newsError}</span>}
        {activeLayer === 'literacy' && literacyError &&
          <span className="crime-load-error">{literacyError}</span>}
        {activeLayer === 'pci' && !pciData && !pciError &&
          <span className="layer-status">Loading per capita income data…</span>}
        {activeLayer === 'pci' && pciError &&
          <span className="crime-load-error">{pciError}</span>}

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
            ) : activeLayer === 'population' && populationMetric === 'sexRatio' && selectedSexRatio ? (
              <>
                <div className="literacy-data-type">Official Census value · 2011</div>
                <div className="district-crime-total">
                  <span>Sex ratio</span>
                  <strong>{formatCount(selectedSexRatio.sex_ratio)}</strong>
                </div>
                <p className="district-crime-note">Females per 1,000 males. Source: Census 2011 district table.</p>
              </>
            ) : activeLayer === 'population' && populationMetric === 'sexRatio' && sexRatioByDistrict ? (
              <p>No separate Census 2011 sex-ratio value is available for this boundary; no parent district value was copied.</p>
            ) : activeLayer === 'population' && populationMetric === 'sexRatio' ? (
              <p>Loading Census 2011 sex-ratio data…</p>
            ) : activeLayer === 'population' && selectedPopulation ? (
              <>
                <div className="district-crime-total">
                  <span>Estimated population · 2026</span>
                  <strong>{formatCount(selectedPopulation.total)}</strong>
                </div>
                <p className="district-crime-note">Third-party estimate; not an official Census count.
                  {selectedPopulation.grouped && ` Combined from ${selectedPopulation.sourceNames.join(' + ')} to match this existing boundary.`}</p>
              </>
            ) : activeLayer === 'population' && populationMetric === 'total' && populationByDistrict ? (
              <p>Population estimate unavailable for this boundary; no other district’s value was assigned.</p>
            ) : activeLayer === 'population' && populationMetric === 'total' ? (
              <p>Loading district population estimate…</p>
            ) : activeLayer === 'literacy' && selectedLiteracy ? (
              <>
                <div className="literacy-data-type">Official Census value · 2011</div>
                <div className="district-crime-total">
                  <span>Literacy rate</span>
                  <strong>{selectedLiteracy.literacy_rate.toFixed(2)}%</strong>
                </div>
                <dl className="literacy-details">
                  <div><dt>Literate population</dt><dd>{formatCount(selectedLiteracy.literate_population)}</dd></div>
                  <div><dt>Total population</dt><dd>{formatCount(selectedLiteracy.total_population)}</dd></div>
                  <div><dt>Population aged 0–6</dt><dd>{formatCount(selectedLiteracy.population_age_0_6)}</dd></div>
                  <div><dt>Population aged 7+</dt><dd>{formatCount(selectedLiteracy.population_age_7_plus)}</dd></div>
                </dl>
                <p className="district-crime-note">Rate uses literate population divided by population aged 7+.</p>
              </>
            ) : activeLayer === 'literacy' && literacyByCode ? (
              <p>No separate 2011 Census/tehsil records are available for this district. The value is unavailable; no parent district’s rate was copied.</p>
            ) : activeLayer === 'literacy' ? (
              <p>Loading Census literacy data…</p>
            ) : activeLayer === 'pci' && selectedPci ? (
              <>
                <div className={`pci-data-type ${selectedPci.isProxy ? 'is-proxy' : ''}`}>
                  {selectedPci.isProxy ? 'Parent-district proxy estimate' : 'Historical average'}
                </div>
                <div className="district-crime-total">
                  <span>Average Per Capita Income</span>
                  <strong>{formatRupees(selectedPci.amount)}</strong>
                </div>
                <p className="district-crime-note">Estimate Type: {selectedPci.estimateType}</p>
              </>
            ) : activeLayer === 'pci' && pciByDistrict ? (
              <p>No matching PCI record is available for this district boundary.</p>
            ) : activeLayer === 'pci' ? (
              <p>Loading per capita income data…</p>
            ) : (
              <p>Select a data layer to view district details.</p>
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

        {activeLayer === 'population' && populationMetric === 'total' && populationByDistrict && (
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

        {activeLayer === 'population' && populationMetric === 'sexRatio' && sexRatioByDistrict && (
          <div className="crime-legend" aria-label="2011 Census sex-ratio map legend">
            <strong>Sex Ratio · Census 2011</strong>
            <span className="crime-legend-subtitle">Females per 1,000 males</span>
            <div className="crime-legend-items">
              {SEX_RATIO_CLASSES.map((item) => (
                <div className="crime-legend-item" key={item.label}>
                  <span className="crime-legend-swatch" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
              ))}
              <div className="crime-legend-item">
                <span className="crime-legend-swatch" style={{ backgroundColor: '#cbd5e1' }} />
                <span>Unavailable</span>
              </div>
            </div>
            <p>Higher values mean more females per 1,000 males. The workbook covers 50 Census 2011 districts; newer or unmatched boundaries are left unavailable.</p>
            {sexRatioByDistrict.unavailableDistricts.length > 0 &&
              <p>Unavailable boundaries: {sexRatioByDistrict.unavailableDistricts.join(', ')}.</p>}
            {sexRatioByDistrict.duplicateNames.length > 0 &&
              <p>Duplicate workbook district names left unmapped: {sexRatioByDistrict.duplicateNames.join(', ')}.</p>}
            {sexRatioByDistrict.unmatchedNames.length > 0 &&
              <p>Workbook districts without matching map boundaries: {sexRatioByDistrict.unmatchedNames.join(', ')}.</p>}
          </div>
        )}

        {activeLayer === 'news' && (
          <div className="crime-legend" aria-label="News by district map legend">
            <strong>{newsView === 'today' ? 'Today’s collected news' : 'Yesterday’s news digest'}</strong>
            <span className="crime-legend-subtitle">Fill shows grouped reports matched to each district</span>
            <div className="crime-legend-items">
              {[
                ['No matched stories', NEWS_COLORS.none],
                ['1 story', NEWS_COLORS.low],
                ['2–3 stories', NEWS_COLORS.medium],
                ['4+ stories', NEWS_COLORS.high],
              ].map(([label, color]) => (
                <div className="crime-legend-item" key={label}>
                  <span className="crime-legend-swatch" style={{ backgroundColor: color }} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p>Today’s map updates as feeds are checked. Stories without a clearly matched district stay in the news list.</p>
          </div>
        )}
        {activeLayer === 'literacy' && literacyByCode && (
          <div className="crime-legend literacy-legend" aria-label="Census 2011 literacy rate legend">
            <strong>Literacy Rate (Census 2011)</strong>
            <span className="crime-legend-subtitle">Official district-level Census values</span>
            <div className="crime-legend-items">
              {LITERACY_CLASSES.map((item) => (
                <div className="crime-legend-item" key={item.label}>
                  <span className="crime-legend-swatch" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
              ))}
              <div className="crime-legend-item">
                <span className="crime-legend-swatch" style={{ backgroundColor: '#cbd5e1' }} />
                <span>Unavailable</span>
              </div>
            </div>
            <p>Source: Census of India, Primary Census Abstract 2011. Rate = literate population ÷ population aged 7+ × 100. The workbook contains no tehsil rows, so Agar Malwa and Niwari are unavailable; no rates were estimated.</p>
            {literacyByCode.duplicateCodes.length > 0 &&
              <p>Duplicate Census codes left unmapped: {literacyByCode.duplicateCodes.join(', ')}.</p>}
            {literacyByCode.unmatchedCodes.length > 0 &&
              <p>Census district codes without a matching map feature: {literacyByCode.unmatchedCodes.join(', ')}.</p>}
          </div>
        )}
        {activeLayer === 'news' && (
          <section className="news-panel" aria-label="Madhya Pradesh news">
            <div className="news-view-selector" role="group" aria-label="Choose news date">
              <button type="button" aria-pressed={newsView === 'today'} onClick={() => setNewsView('today')}>Today · updating</button>
              <button type="button" aria-pressed={newsView === 'digest'} onClick={() => setNewsView('digest')}>Yesterday’s digest</button>
            </div>
            <div className="news-language-selector" role="group" aria-label="Filter news language">
              {[
                ['all', 'All'],
                ['en', 'English'],
                ['hi', 'Hindi'],
              ].map(([language, label]) => (
                <button key={language} type="button" aria-pressed={newsLanguage === language}
                  onClick={() => setNewsLanguage(language)}>{label}</button>
              ))}
            </div>
            {newsPayload ? (
              <>
                <p className="news-collection-status">
                  {newsView === 'today'
                    ? `Today’s news is checked every 15 minutes. ${newsPayload.today.collectedArticleCount} articles collected so far.`
                    : newsPayload.publishedDigest
                      ? `Digest for ${newsPayload.publishedDigest.forDate}, published at 6:00 AM IST.`
                      : 'No digest has been published yet. Yesterday’s collected news appears here after 6:00 AM IST.'}
                </p>
                {newsPayload.status.lastCollectionAt && (
                  <p className="news-last-checked">Last checked: {new Date(newsPayload.status.lastCollectionAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</p>
                )}
                {selectedDistrict && <p className="news-district-filter">Showing {selectedDistrictName} news. Select “Show All Districts” to see all districts.</p>}
                {visibleNewsEvents.length ? (
                  <div className="news-story-list">
                    {visibleNewsEvents.map((event) => (
                      <article className="news-story" key={event.id}>
                        <span className="news-story-place">{event.district ? `${event.district}${event.mapDistrict && event.mapDistrict !== event.district ? ` · shown on ${event.mapDistrict} boundary` : ''}` : 'Madhya Pradesh · district not identified'}</span>
                        <h3>{event.title}</h3>
                        {event.description && <p>{event.description}</p>}
                        <div className="news-story-meta">
                          <span>{event.articleCount > 1 ? `${event.articleCount} related reports` : '1 report'}</span>
                          <span>{event.language === 'hi' ? 'Hindi' : 'English'}</span>
                        </div>
                        {event.descriptionSource && <span className="news-description-source">Description from {event.descriptionSource}</span>}
                        <div className="news-source-links">
                          {event.sources.map((source) => (
                            <a key={`${event.id}-${source.name}`} href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="news-empty-state">
                    {newsView === 'digest' && !newsPayload.publishedDigest
                      ? 'The daily digest will appear here after it is first published.'
                      : selectedDistrict
                        ? `No ${newsLanguage === 'all' ? '' : `${newsLanguage === 'hi' ? 'Hindi' : 'English'} `}news has been matched to ${selectedDistrictName} in this view yet.`
                        : 'No matching MP stories have been collected for this view yet.'}
                  </p>
                )}
                <div className="news-source-status">
                  <strong>Feed status</strong>
                  {newsPayload.status.sourceStatus.length ? newsPayload.status.sourceStatus.map((source) => (
                    <span key={source.source} className={source.ok ? 'news-source-ok' : 'news-source-failed'}>
                      {source.ok ? '●' : '○'} {source.source}{source.error ? ` · ${source.error}` : ''}
                    </span>
                  )) : <span>Waiting for the first feed check…</span>}
                </div>
              </>
            ) : (
              <p className="news-empty-state">{newsError || 'Loading Madhya Pradesh news…'}</p>
            )}
          </section>
        )}

{activeLayer === 'pci' && pciByDistrict && (
          <div className="crime-legend pci-legend" aria-label="Per Capita Income legend">
            <strong>Per Capita Income (₹)</strong>
            <span className="crime-legend-subtitle">Five quantile classes · amounts in rupees per person</span>
            <div className="crime-legend-items">
              {PCI_COLORS.map((color, index) => {
                const lower = index === 0 ? null : pciBreaks[index - 1]
                const upper = pciBreaks[index]
                const label = index === 0
                  ? `≤ ${formatRupees(upper)}`
                  : index === PCI_COLORS.length - 1
                    ? `> ${formatRupees(lower)}`
                    : `${formatRupees(lower + 1)}–${formatRupees(upper)}`
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
            <p>Proxy estimates are explicitly labelled in each district popup and detail panel.</p>
            <p>Showing {Object.keys(pciByDistrict.values).length} matched GeoJSON districts from {pciData.records.length} CSV rows.</p>
            {pciByDistrict.unmatchedRecords.length > 0 &&
              <p>CSV rows without separate boundary features: {pciByDistrict.unmatchedRecords.join(', ')}.</p>}
            {pciByDistrict.unmatchedBoundaryNames.length > 0 &&
              <p>Boundaries without a PCI value: {pciByDistrict.unmatchedBoundaryNames.join(', ')}.</p>}
            {pciByDistrict.duplicateNames.length > 0 &&
              <p>Ambiguous duplicate district records left unmapped: {pciByDistrict.duplicateNames.join(', ')}.</p>}
          </div>        )}
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
          key={activeLayer === 'pci'
            ? 'pci-all-districts'
            : `${selectedDistrictName}-${activeLayer}-${populationMetric}-${newsView}-${newsLanguage}-${newsPayload?.status.lastCollectionAt}`}          data={visibleDistricts}
          style={(feature) => {
            const isSelected = feature === selectedDistrict
            const districtName = feature.properties?.dtname
            const crimeCount = crimeData?.districts?.[districtName]?.total
            const population = populationByDistrict?.values?.[districtName]?.total
            const sexRatio = sexRatioByDistrict?.values?.[districtName]?.sex_ratio
            const literacy = literacyByCode?.values?.[String(feature.properties?.dtcode11)]
            const newsCount = newsDistrictCounts[districtName] || 0

            if (activeLayer === 'news') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: newsCount >= 4 ? NEWS_COLORS.high : newsCount >= 2 ? NEWS_COLORS.medium : newsCount === 1 ? NEWS_COLORS.low : NEWS_COLORS.none,
                fillOpacity: 0.82,
              }
            }
            const pci = pciByDistrict?.values?.[normalizeDistrictName(districtName)]
            if (activeLayer === 'crime') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getCrimeColor(crimeCount, crimeBreaks),
                fillOpacity: 0.78,
              }
            }

            if (activeLayer === 'population' && populationMetric === 'sexRatio') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getSexRatioColor(sexRatio),
                fillOpacity: 0.84,
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

            if (activeLayer === 'literacy') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getLiteracyColor(literacy?.literacy_rate),
                fillOpacity: 0.84,
              }
            }

            if (activeLayer === 'pci') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getPciColor(pci?.amount, pciBreaks),
                fillOpacity: 0.84,
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
            const sexRatio = sexRatioByDistrict?.values?.[districtName]?.sex_ratio
            const literacy = literacyByCode?.values?.[String(feature.properties?.dtcode11)]
            const newsCount = newsDistrictCounts[districtName] || 0
            const newsPeriod = newsView === 'today' ? 'in today’s collection' : 'in yesterday’s digest'
            const pci = pciByDistrict?.values?.[normalizeDistrictName(districtName)]
            const tooltip = activeLayer === 'news'
              ? `${districtName}: ${newsCount} grouped news stories ${newsPeriod}`
              : activeLayer === 'crime' && Number.isFinite(crimeCount)
                ? `${districtName}: ${formatCount(crimeCount)} reported crimes against women in 2024`
                : activeLayer === 'population' && populationMetric === 'sexRatio' && Number.isFinite(sexRatio)
                  ? `${districtName}: ${formatCount(sexRatio)} females per 1,000 males (Census 2011)`
                  : activeLayer === 'population' && populationMetric === 'sexRatio'
                    ? `${districtName}: Census 2011 sex ratio unavailable`
                    : activeLayer === 'population' && population
                      ? `${districtName}: ${formatCount(population.total)} estimated population in 2026`
                      : activeLayer === 'population'
                        ? `${districtName}: population estimate unavailable`
                        : activeLayer === 'literacy' && literacy
                          ? `${districtName} (2011 Census: ${literacy.district_name.trim()}): ${literacy.literacy_rate.toFixed(2)}% literacy; ${formatCount(literacy.literate_population)} literate people; total population ${formatCount(literacy.total_population)}; official Census value`
                          : activeLayer === 'literacy'
                            ? `${districtName}: literacy rate unavailable; no 2011 tehsil rows were provided for a derived value`
                            : activeLayer === 'pci' && pci
                              ? `${districtName}: ${formatRupees(pci.amount)} average per capita income; ${pci.estimateType}`
                              : activeLayer === 'pci'
                                ? `${districtName}: PCI value unavailable`
                                : districtName
            layer.bindTooltip(tooltip, { sticky: true })
            if (!selectedDistrict || activeLayer === 'pci') {
              layer.on({
                click: () => {
                  selectDistrict(feature)
                  if (activeLayer === 'pci' && pci) {
                    layer.bindPopup(createPciPopupContent(districtName, pci)).openPopup()
                  }
                },
              })
            }
          }}
        />
        <FitMapToDistricts data={visibleDistricts} />
      </MapContainer>
    </div>
  )
}

export default App







