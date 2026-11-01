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
const WORKER_COLORS = ['#fce4ec', '#f48fb1', '#c2185b']
const MALE_WORKER_COLORS = ['#ede9fe', '#a78bfa', '#6d28d9']
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

function getWorkerColor(value, breaks, colors) {
  if (!Number.isFinite(value) || breaks.length !== colors.length - 1) {
    return '#cbd5e1'
  }

  const colorIndex = breaks.findIndex((limit) => value <= limit)
  return colors[colorIndex === -1 ? colors.length - 1 : colorIndex]
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

const NFHS_DISTRICT_ALIASES = {
  khandwaeastnimar: 'khandwa',
  khargonewestnimar: 'khargone',
}

function normalizeNfhsDistrictName(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  return NFHS_DISTRICT_ALIASES[normalized] || normalized
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
  const [workforceData, setWorkforceData] = useState(null)
  const [literacyData, setLiteracyData] = useState(null)
  const [femaleEducationData, setFemaleEducationData] = useState(null)
  const [pciData, setPciData] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState(null)
  const [activeLayer, setActiveLayer] = useState('districts')
  const [comparisonRules, setComparisonRules] = useState([
    { id: 'rule-1', metricId: 'crime.total', level: 'high' },
  ])
  const [populationMetric, setPopulationMetric] = useState('total')
  const [workerSex, setWorkerSex] = useState('female')
  const [literacyMetric, setLiteracyMetric] = useState('census')
  const [error, setError] = useState('')
  const [crimeError, setCrimeError] = useState('')
  const [populationError, setPopulationError] = useState('')
  const [sexRatioError, setSexRatioError] = useState('')
  const [workforceError, setWorkforceError] = useState('')
  const [literacyError, setLiteracyError] = useState('')
  const [femaleEducationError, setFemaleEducationError] = useState('')
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

    fetch(`${API_BASE_URL}/api/workforce`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load Census 2011 workforce data (HTTP ${response.status})`)
        return response.json()
      })
      .then((data) => {
        if (data?.year !== 2011 || !Array.isArray(data?.records)) {
          throw new Error('Workforce data does not contain valid Census 2011 district records')
        }
        setWorkforceData(data)
      })
      .catch((err) => setWorkforceError(err.message))

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

    fetch(`${API_BASE_URL}/api/female-education`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load NFHS-6 female education data (HTTP ${response.status})`)
        return response.json()
      })
      .then((data) => {
        if (data?.survey !== 'NFHS-6' || !Array.isArray(data?.records)) {
          throw new Error('NFHS-6 data does not contain a valid district record list')
        }
        setFemaleEducationData(data)
      })
      .catch((err) => setFemaleEducationError(err.message))

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

  const workforceByCode = useMemo(() => {
    if (!districts || !workforceData) return null

    const recordCounts = new Map()
    workforceData.records.forEach((record) => {
      const code = String(record.census_district_code)
      recordCounts.set(code, (recordCounts.get(code) || 0) + 1)
    })
    const duplicateCodes = new Set([...recordCounts].filter(([, count]) => count > 1).map(([code]) => code))
    const recordsByCode = new Map(
      workforceData.records
        .filter((record) => !duplicateCodes.has(String(record.census_district_code)))
        .map((record) => [String(record.census_district_code), record]),
    )
    const values = {}

    districts.features.forEach((feature) => {
      const code = String(feature.properties?.dtcode11)
      const record = recordsByCode.get(code)
      if (
        record &&
        Number.isFinite(record.workers_male) &&
        Number.isFinite(record.workers_female) &&
        Number.isFinite(record.population_male) &&
        Number.isFinite(record.population_female) &&
        record.population_male > 0 &&
        record.population_female > 0
      ) {
        values[code] = record
      }
    })

    return {
      values,
      duplicateCodes: [...duplicateCodes],
      unavailableDistricts: districts.features
        .filter((feature) => !values[String(feature.properties?.dtcode11)])
        .map((feature) => feature.properties?.dtname),
      unmatchedDistricts: workforceData.records
        .filter((record) => !districts.features.some((feature) => String(feature.properties?.dtcode11) === String(record.census_district_code)))
        .map((record) => record.district_name),
    }
  }, [districts, workforceData])

  const workforceRates = useMemo(() => {
    if (!workforceByCode) return {}
    return Object.fromEntries(Object.entries(workforceByCode.values).map(([code, record]) => {
      const workers = workerSex === 'female' ? record.workers_female : record.workers_male
      const population = workerSex === 'female' ? record.population_female : record.population_male
      return [code, workers / population * 100]
    }))
  }, [workforceByCode, workerSex])

  const workforceBreaks = useMemo(() => {
    return getQuantileBreaks(Object.values(workforceRates), WORKER_COLORS.length)
  }, [workforceRates])

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

  const femaleEducationByDistrict = useMemo(() => {
    if (!districts || !femaleEducationData) return null

    const recordsByName = new Map(femaleEducationData.records.map((record) => [
      normalizeNfhsDistrictName(record.district_name),
      record,
    ]))
    const values = {}
    districts.features.forEach((feature) => {
      const districtName = feature.properties?.dtname
      const record = recordsByName.get(normalizeNfhsDistrictName(districtName))
      if (!record) return
      values[districtName] = record
    })

    return {
      values,
      unmatchedBoundaryNames: districts.features
        .map((feature) => feature.properties?.dtname)
        .filter((name) => name && !values[name]),
    }
  }, [districts, femaleEducationData])

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

  const comparisonOptions = useMemo(() => {
    if (!districts) return []
    const names = districts.features.map((feature) => feature.properties?.dtname).filter(Boolean)
    const options = []
    const makeOption = (id, label, valueForDistrict) => ({
      id,
      label,
      values: Object.fromEntries(names
        .map((name) => [name, valueForDistrict(name)])
        .filter(([, value]) => Number.isFinite(value))),
    })

    if (crimeData?.districts) {
      options.push(makeOption('crime.total', `Overall crimes against women · ${crimeData.year}`, (name) => crimeData.districts[name]?.total))
      const crimeTypes = [...new Set(Object.values(crimeData.districts)
        .flatMap((district) => (district.crimeTypes || []).map((item) => item.name)))].sort()
      crimeTypes.forEach((crimeType, index) => {
        options.push(makeOption(`crime.type.${index}`, `${crimeType} · ${crimeData.year}`, (name) =>
          crimeData.districts[name]?.crimeTypes?.find((item) => item.name === crimeType)?.count))
      })
    }

    if (populationByDistrict) {
      options.push(makeOption('population.total', 'Total population · 2026 estimate', (name) => populationByDistrict.values[name]?.total))
    }
    if (sexRatioByDistrict) {
      options.push(makeOption('population.sexRatio', 'Sex ratio · Census 2011 (females per 1,000 males)', (name) => sexRatioByDistrict.values[name]?.sex_ratio))
    }
    if (workforceByCode && districts) {
      const workforceValue = (name) => workforceByCode.values[String(
        districts.features.find((feature) => feature.properties?.dtname === name)?.properties?.dtcode11,
      )]
      const workforceFields = [...new Set((workforceData?.records || [])
        .flatMap((record) => Object.keys(record)))]
        .filter((field) => /_(male|female)$/.test(field))
        .sort((first, second) => first.localeCompare(second))
      workforceFields.forEach((field) => {
        const sex = field.endsWith('_female') ? 'Women' : 'Men'
        const measure = field.replace(/_(male|female)$/, '').replaceAll('_', ' ')
        const id = `workers.breakdown.${field}`
        options.push(makeOption(id, `${sex} ${measure} · Census 2011 (people)`, (name) => workforceValue(name)?.[field]))
      })
      options.push(makeOption('workers.women.rate', 'Women worker participation · Census 2011 (%)', (name) => {
        const record = workforceValue(name)
        return record ? record.workers_female / record.population_female * 100 : Number.NaN
      }))
      options.push(makeOption('workers.men.rate', 'Men worker participation · Census 2011 (%)', (name) => {
        const record = workforceValue(name)
        return record ? record.workers_male / record.population_male * 100 : Number.NaN
      }))
    }
    if (literacyByCode && districts) {
      options.push(makeOption('literacy.rate', 'Literacy rate · Census 2011 (%)', (name) => {
        const code = districts.features.find((feature) => feature.properties?.dtname === name)?.properties?.dtcode11
        return literacyByCode.values[String(code)]?.literacy_rate
      }))
    }
    if (femaleEducationByDistrict) {
      options.push(makeOption('literacy.femaleAttendance.rate', 'Female school attendance · NFHS-6 (2023–24, %)', (name) =>
        femaleEducationByDistrict.values[name]?.female_school_attendance_age_6_plus_percent))
      options.push(makeOption('literacy.women10Years.rate', 'Women with 10+ years schooling · NFHS-6 (2023–24, %)', (name) =>
        femaleEducationByDistrict.values[name]?.women_10_plus_years_schooling_percent))
    }
    if (pciByDistrict) {
      options.push(makeOption('income.pci', 'Per capita income · supplied dataset (₹)', (name) => pciByDistrict.values[normalizeDistrictName(name)]?.amount))
    }
    return options.filter((option) => Object.keys(option.values).length > 0)
  }, [districts, crimeData, populationByDistrict, sexRatioByDistrict, workforceByCode, workforceData, literacyByCode, femaleEducationByDistrict, pciByDistrict])

  const comparisonRuleOptions = useMemo(() => comparisonRules.map((rule) => ({
    ...rule,
    option: comparisonOptions.find((option) => option.id === rule.metricId) || comparisonOptions[0],
  })), [comparisonRules, comparisonOptions])
  const comparisonResults = useMemo(() => {
    if (comparisonRuleOptions.some((rule) => !rule.option)) return { matches: [], available: false }
    const classify = (option) => {
      const values = Object.values(option.values)
      const cuts = getQuantileBreaks(values, 3)
      return { cuts, values }
    }
    const classifications = comparisonRuleOptions.map((rule) => ({ ...rule, ...classify(rule.option) }))
    const matches = districts.features.map((feature) => {
      const name = feature.properties?.dtname
      const values = classifications.map((rule) => rule.option.values[name])
      if (values.some((value) => !Number.isFinite(value))) return null
      const matchesAll = classifications.every((rule, index) => {
        const value = values[index]
        const [lowCut, highCut] = rule.cuts
        if (rule.level === 'low') return value <= lowCut
        if (rule.level === 'medium') return value > lowCut && value <= highCut
        return value > highCut
      })
      return matchesAll ? { name, values } : null
    }).filter(Boolean)
    return { matches, available: true }
  }, [districts, comparisonRuleOptions])

  const updateComparisonRule = (id, changes) => {
    setComparisonRules((rules) => rules.map((rule) => rule.id === id ? { ...rule, ...changes } : rule))
  }

  const downloadComparisonCsv = () => {
    const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const formatThreshold = (value, metricId) => {
      if (metricId === 'income.pci') return formatRupees(value)
      const formatted = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value)
      return metricId.endsWith('.rate') || metricId === 'literacy.rate' ? `${formatted}%` : formatted
    }
    const reportRows = [
      ['Report', 'Madhya Pradesh district comparison'],
      ['Generated at (India time)', new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date())],
      ['Match logic', 'All conditions must match (AND)'],
      ['Matching districts', comparisonResults.matches.length],
    ]
    comparisonRuleOptions.forEach((rule, index) => {
      const cuts = getQuantileBreaks(Object.values(rule.option.values), 3)
      const threshold = rule.level === 'low'
        ? `≤ ${formatThreshold(cuts[0], rule.option.id)}`
        : rule.level === 'medium'
          ? `> ${formatThreshold(cuts[0], rule.option.id)} and ≤ ${formatThreshold(cuts[1], rule.option.id)}`
          : `> ${formatThreshold(cuts[1], rule.option.id)}`
      const levelLabel = rule.level === 'high' ? 'High (top third)' : rule.level === 'medium' ? 'Medium (middle third)' : 'Low (bottom third)'
      reportRows.push([`Condition ${index + 1}`, rule.option.label, levelLabel, `Cutoff: ${threshold}`])
    })
    reportRows.push(['Note', 'Districts without data for every selected condition are excluded. High/medium/low use relative thirds across districts with available data.'])
    reportRows.push([])
    reportRows.push(['District', ...comparisonRuleOptions.map((rule) => rule.option?.label || 'Selected metric')])
    comparisonResults.matches.forEach((match) => reportRows.push([match.name, ...match.values]))
    const csv = `\uFEFF${reportRows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'mp-district-comparison-report.csv'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const selectedDistrictName = selectedDistrict?.properties?.dtname || 'Selected district'
  const selectedCrime = crimeData?.districts?.[selectedDistrictName]
  const selectedPopulation = populationByDistrict?.values?.[selectedDistrictName]
  const selectedSexRatio = sexRatioByDistrict?.values?.[selectedDistrictName]
  const selectedWorkforce = workforceByCode?.values?.[String(selectedDistrict?.properties?.dtcode11)]
  const workerColors = workerSex === 'female' ? WORKER_COLORS : MALE_WORKER_COLORS
  const selectedWorkerCount = selectedWorkforce
    ? workerSex === 'female' ? selectedWorkforce.workers_female : selectedWorkforce.workers_male
    : null
  const selectedWorkerRate = selectedWorkforce
    ? workerSex === 'female'
      ? selectedWorkforce.workers_female / selectedWorkforce.population_female * 100
      : selectedWorkforce.workers_male / selectedWorkforce.population_male * 100
    : null
  const selectedLiteracy = literacyByCode?.values?.[String(selectedDistrict?.properties?.dtcode11)]
  const selectedFemaleEducation = femaleEducationByDistrict?.values?.[selectedDistrictName]
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
          <button type="button" aria-pressed={activeLayer === 'compare'}
            onClick={() => { setSelectedDistrict(null); setActiveLayer('compare') }}>Compare</button>
          <button type="button" aria-pressed={activeLayer === 'population'}
            onClick={() => setActiveLayer('population')}>Population</button>
          <button type="button" aria-pressed={activeLayer === 'news'} onClick={() => setActiveLayer('news')}>News · Live</button>
          <button type="button" aria-pressed={activeLayer === 'literacy'}
            onClick={() => setActiveLayer('literacy')}>Literacy</button>
          <button type="button" aria-pressed={activeLayer === 'pci'}
            onClick={() => setActiveLayer('pci')}>Per Capita Income (PCI)</button>
        </div>
        {activeLayer === 'compare' && (
          <section className="comparison-panel" aria-label="District data comparison">
            <h3>Build a district comparison</h3>
            <p className="comparison-help">Choose a measure and whether it should be low, medium, or high. Conditions are combined with AND.</p>
            {comparisonRuleOptions.map((rule) => (
              <div className="comparison-rule" key={rule.id}>
                <select
                  aria-label="Comparison data"
                  value={rule.option?.id || ''}
                  onChange={(event) => updateComparisonRule(rule.id, { metricId: event.target.value })}
                >
                  {comparisonOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <select
                  aria-label="Comparison level"
                  value={rule.level}
                  onChange={(event) => updateComparisonRule(rule.id, { level: event.target.value })}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                {comparisonRules.length > 1 && (
                  <button type="button" className="comparison-remove" aria-label="Remove condition"
                    onClick={() => setComparisonRules((rules) => rules.filter((item) => item.id !== rule.id))}>Remove</button>
                )}
              </div>
            ))}
            <button type="button" className="comparison-add"
              disabled={!comparisonOptions.length}
              onClick={() => setComparisonRules((rules) => [...rules, {
                id: `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                metricId: comparisonOptions[0]?.id || '',
                level: 'high',
              }])}>+ Add condition</button>
            <div className="comparison-results" aria-live="polite">
              <strong>{comparisonResults.available ? `${comparisonResults.matches.length} matching district${comparisonResults.matches.length === 1 ? '' : 's'}` : 'Loading district data…'}</strong>
              {comparisonResults.available && comparisonResults.matches.length > 0 ? (
                <div className="comparison-table-wrap">
                  <table>
                    <thead><tr><th>District</th>{comparisonRuleOptions.map((rule) => <th key={rule.id}>{rule.option?.label}</th>)}</tr></thead>
                    <tbody>{comparisonResults.matches.map((match) => (
                      <tr key={match.name}>
                        <th scope="row">{match.name}</th>
                        {match.values.map((value, index) => {
                          const metricId = comparisonRuleOptions[index].option.id
                          const formatted = metricId.endsWith('.rate') || metricId === 'literacy.rate'
                            ? `${value.toFixed(1)}%`
                            : metricId === 'income.pci'
                              ? formatRupees(value)
                              : formatCount(Math.round(value))
                          return <td key={comparisonRuleOptions[index].id}>{formatted}</td>
                        })}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : comparisonResults.available ? (
                <p>No district matches all these conditions. Try changing a level or removing a condition.</p>
              ) : null}
              {comparisonResults.available && (
                <button type="button" className="comparison-download" onClick={downloadComparisonCsv}>Generate comparison report · CSV</button>
              )}
              <p className="comparison-footnote">High, medium, and low are relative thirds among districts with data. Missing values are excluded. Dataset years differ and are shown in each option label.</p>
            </div>
          </section>
        )}
        {activeLayer === 'population' && (
          <div className="population-metric-selector" role="group" aria-label="Population data type">
            <span>Population breakdown</span>
            <button type="button" aria-pressed={populationMetric === 'total'}
              onClick={() => setPopulationMetric('total')}>Total population</button>
            <button type="button" aria-pressed={populationMetric === 'sexRatio'}
              onClick={() => setPopulationMetric('sexRatio')}>Sex ratio · Census 2011</button>
            <button type="button" aria-pressed={populationMetric === 'workers'}
              onClick={() => setPopulationMetric('workers')}>Workers by sex · Census 2011</button>
          </div>
        )}
        {activeLayer === 'literacy' && (
          <div className="population-metric-selector" role="group" aria-label="Choose literacy and education measure">
            <span>Literacy &amp; female education</span>
            <button type="button" aria-pressed={literacyMetric === 'census'}
              onClick={() => setLiteracyMetric('census')}>Literacy rate · Census 2011</button>
            <button type="button" aria-pressed={literacyMetric === 'femaleAttendance'}
              onClick={() => setLiteracyMetric('femaleAttendance')}>Female school attendance · NFHS-6</button>
            <button type="button" aria-pressed={literacyMetric === 'women10Years'}
              onClick={() => setLiteracyMetric('women10Years')}>Women with 10+ years schooling · NFHS-6</button>
          </div>
        )}
        {activeLayer === 'population' && populationMetric === 'workers' && (
          <div className="population-metric-selector" role="group" aria-label="Choose worker sex for the map">
            <span>Map worker participation rate</span>
            <button type="button" aria-pressed={workerSex === 'female'}
              onClick={() => setWorkerSex('female')}>Women workers</button>
            <button type="button" aria-pressed={workerSex === 'male'}
              onClick={() => setWorkerSex('male')}>Men workers</button>
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
        {activeLayer === 'population' && populationMetric === 'workers' && !workforceData && !workforceError &&
          <span className="layer-status">Loading Census 2011 worker data…</span>}
        {activeLayer === 'population' && populationMetric === 'workers' && workforceError &&
          <span className="crime-load-error">{workforceError}</span>}
        {activeLayer === 'literacy' && !literacyData && !literacyError &&
          literacyMetric === 'census' && <span className="layer-status">Loading Census literacy data…</span>}
        {activeLayer === 'literacy' && literacyMetric !== 'census' && !femaleEducationData && !femaleEducationError &&
          <span className="layer-status">Loading NFHS-6 female education data…</span>}
        {activeLayer === 'news' && newsError &&
          <span className="crime-load-error">{newsError}</span>}
        {activeLayer === 'literacy' && literacyError &&
          literacyMetric === 'census' && <span className="crime-load-error">{literacyError}</span>}
        {activeLayer === 'literacy' && literacyMetric !== 'census' && femaleEducationError &&
          <span className="crime-load-error">{femaleEducationError}</span>}
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
            ) : activeLayer === 'population' && populationMetric === 'workers' && selectedWorkforce ? (
              <>
                <div className="literacy-data-type">Official Census value · 2011</div>
                <div className="district-crime-total">
                  <span>{workerSex === 'female' ? 'Women workers' : 'Men workers'}</span>
                  <strong>{formatCount(selectedWorkerCount)}</strong>
                </div>
                <p className="district-crime-note">{selectedWorkerRate.toFixed(1)}% of the district’s {workerSex === 'female' ? 'female' : 'male'} population was recorded as working.</p>
                <dl className="literacy-details">
                  <div><dt>Male workers</dt><dd>{formatCount(selectedWorkforce.workers_male)}</dd></div>
                  <div><dt>Female workers</dt><dd>{formatCount(selectedWorkforce.workers_female)}</dd></div>
                  <div><dt>Male main workers</dt><dd>{formatCount(selectedWorkforce.main_workers_male)}</dd></div>
                  <div><dt>Female main workers</dt><dd>{formatCount(selectedWorkforce.main_workers_female)}</dd></div>
                  <div><dt>Male marginal workers</dt><dd>{formatCount(selectedWorkforce.marginal_workers_male)}</dd></div>
                  <div><dt>Female marginal workers</dt><dd>{formatCount(selectedWorkforce.marginal_workers_female)}</dd></div>
                </dl>
              </>
            ) : activeLayer === 'population' && populationMetric === 'workers' && workforceByCode ? (
              <p>No separate 2011 Census worker record is available for this boundary; no parent district’s value was copied.</p>
            ) : activeLayer === 'population' && populationMetric === 'workers' ? (
              <p>Loading Census 2011 worker details…</p>
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
            ) : activeLayer === 'literacy' && literacyMetric !== 'census' && selectedFemaleEducation ? (
              <>
                <div className="literacy-data-type">NFHS-6 survey estimate · 2023–24</div>
                <div className="district-crime-total">
                  <span>{literacyMetric === 'femaleAttendance' ? 'Female population age 6+ ever attended school' : 'Women with 10+ years of schooling'}</span>
                  <strong>{(literacyMetric === 'femaleAttendance'
                    ? selectedFemaleEducation.female_school_attendance_age_6_plus_percent
                    : selectedFemaleEducation.women_10_plus_years_schooling_percent).toFixed(1)}%</strong>
                </div>
                <p className="district-crime-note">
                  {literacyMetric === 'femaleAttendance'
                    ? 'Share of female population aged 6 and above who have ever attended school. This is not the same as a literacy rate.'
                    : 'Share of women with 10 or more years of schooling.'}
                </p>
              </>
            ) : activeLayer === 'literacy' && literacyMetric !== 'census' && femaleEducationByDistrict ? (
              <p>No separate NFHS-6 estimate is available for this boundary; no neighbouring or parent district value was copied.</p>
            ) : activeLayer === 'literacy' && literacyMetric === 'census' && selectedLiteracy ? (
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
            ) : activeLayer === 'literacy' && literacyMetric === 'census' && literacyByCode ? (
              <p>No separate 2011 Census/tehsil records are available for this district. The value is unavailable; no parent district’s rate was copied.</p>
            ) : activeLayer === 'literacy' ? (
              <p>{literacyMetric === 'census' ? 'Loading Census literacy data…' : 'Loading NFHS-6 female education data…'}</p>
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

        {activeLayer === 'crime' && crimeData?.courtOutcomes && (
          <section className="crime-outcomes" aria-label="State-wide crime against women court outcomes">
            <h3>Court outcomes · {crimeData.courtOutcomes.year}</h3>
            <span className="crime-outcomes-scope">{crimeData.courtOutcomes.geography}</span>
            <dl>
              <div><dt>Cases registered</dt><dd>{formatCount(crimeData.courtOutcomes.registered)}</dd></div>
              <div><dt>Cases chargesheeted</dt><dd>{formatCount(crimeData.courtOutcomes.chargesheeted)}</dd></div>
              <div><dt>Cases convicted</dt><dd>{formatCount(crimeData.courtOutcomes.convicted)}</dd></div>
              <div><dt>Cases acquitted</dt><dd>{formatCount(crimeData.courtOutcomes.acquitted)}</dd></div>
              <div><dt>Pending trial at year end</dt><dd>{formatCount(crimeData.courtOutcomes.pendingTrialAtYearEnd)}</dd></div>
            </dl>
            <p>{crimeData.courtOutcomes.note}</p>
            <a href={crimeData.courtOutcomes.sourceUrl} target="_blank" rel="noreferrer">
              Source: {crimeData.courtOutcomes.source}
            </a>
          </section>
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

        {activeLayer === 'population' && populationMetric === 'workers' && workforceByCode && (
          <div className="crime-legend" aria-label="Census 2011 worker participation map legend">
            <strong>{workerSex === 'female' ? 'Female' : 'Male'} worker participation · Census 2011</strong>
            <span className="crime-legend-subtitle">Workers of selected sex as a share of that sex’s total district population</span>
            {workforceBreaks.length === workerColors.length - 1 ? (
              <div className="crime-legend-items">
                {workerColors.map((color, index) => {
                  const lower = index === 0 ? null : workforceBreaks[index - 1]
                  const upper = workforceBreaks[index]
                  const className = index === 0 ? 'Low' : index === workerColors.length - 1 ? 'High' : 'Middle'
                  const label = index === 0
                    ? `${className}: ≤ ${upper.toFixed(1)}%`
                    : index === workerColors.length - 1
                      ? `${className}: > ${lower.toFixed(1)}%`
                      : `${className}: ${lower.toFixed(1)}–${upper.toFixed(1)}%`
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
              <p>Not enough matched Census records to build the legend.</p>
            )}
            <p>Source: <a href="https://censusindia.gov.in/nada/index.php/catalog/6191" target="_blank" rel="noreferrer">Census of India, Primary Census Abstract 2011</a>. Rate = workers of the selected sex ÷ total population of that sex × 100. Newer or unmatched boundaries are left unavailable.</p>
            {workforceByCode.unavailableDistricts.length > 0 &&
              <p>Unavailable boundaries: {workforceByCode.unavailableDistricts.join(', ')}.</p>}
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
        {activeLayer === 'literacy' && ((literacyMetric === 'census' && literacyByCode) || (literacyMetric !== 'census' && femaleEducationByDistrict)) && (
          <div className="crime-legend literacy-legend" aria-label="Literacy and female education map legend">
            <strong>{literacyMetric === 'census'
              ? 'Literacy Rate (Census 2011)'
              : literacyMetric === 'femaleAttendance'
                ? 'Female School Attendance (NFHS-6)'
                : 'Women with 10+ Years Schooling (NFHS-6)'}</strong>
            <span className="crime-legend-subtitle">{literacyMetric === 'census' ? 'Official district-level Census values' : 'District survey estimates · 2023–24'}</span>
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
            {literacyMetric === 'census' ? (
              <p>Source: Census of India, Primary Census Abstract 2011. Rate = literate population ÷ population aged 7+ × 100. The workbook contains no tehsil rows, so Agar Malwa and Niwari are unavailable; no rates were estimated.</p>
            ) : (
              <p>Source: <a href="https://www.nfhsiips.in/nfhsuser/release-details.php" target="_blank" rel="noreferrer">NFHS-6 district fact sheets (IIPS / MoHFW)</a>. Attendance is for female population aged 6+ who ever attended school; 10+ years schooling is a separate indicator. Niwari is unavailable because NFHS-6 reports the older 51-district geography.</p>
            )}
            {literacyMetric === 'census' && literacyByCode.duplicateCodes.length > 0 &&
              <p>Duplicate Census codes left unmapped: {literacyByCode.duplicateCodes.join(', ')}.</p>}
            {literacyMetric === 'census' && literacyByCode.unmatchedCodes.length > 0 &&
              <p>Census district codes without a matching map feature: {literacyByCode.unmatchedCodes.join(', ')}.</p>}
            {literacyMetric !== 'census' && femaleEducationByDistrict?.unmatchedBoundaryNames.length > 0 &&
              <p>Boundary areas without a matching NFHS-6 district estimate: {femaleEducationByDistrict.unmatchedBoundaryNames.join(', ')}.</p>}
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
            : `${selectedDistrictName}-${activeLayer}-${populationMetric}-${workerSex}-${literacyMetric}-${newsView}-${newsLanguage}-${newsPayload?.status.lastCollectionAt}-${comparisonRules.map((rule) => `${rule.metricId}:${rule.level}`).join('|')}-${comparisonResults.matches.map((match) => match.name).join(',')}`}          data={visibleDistricts}
          style={(feature) => {
            const isSelected = feature === selectedDistrict
            const districtName = feature.properties?.dtname
            const crimeCount = crimeData?.districts?.[districtName]?.total
            const population = populationByDistrict?.values?.[districtName]?.total
            const sexRatio = sexRatioByDistrict?.values?.[districtName]?.sex_ratio
            const workerRecord = workforceByCode?.values?.[String(feature.properties?.dtcode11)]
            const workerRate = workerRecord
              ? workerSex === 'female'
                ? workerRecord.workers_female / workerRecord.population_female * 100
                : workerRecord.workers_male / workerRecord.population_male * 100
              : Number.NaN
            const literacy = literacyByCode?.values?.[String(feature.properties?.dtcode11)]
            const femaleEducation = femaleEducationByDistrict?.values?.[districtName]
            const newsCount = newsDistrictCounts[districtName] || 0

            if (activeLayer === 'compare') {
              const isMatch = comparisonResults.matches.some((match) => match.name === districtName)
              return {
                color: isMatch ? '#7e57a5' : '#9ca3af',
                weight: isMatch ? 2.5 : 1,
                fillColor: isMatch ? '#e8d9f2' : '#cbd5e1',
                fillOpacity: isMatch ? 0.88 : 0.28,
              }
            }

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

            if (activeLayer === 'population' && populationMetric === 'workers') {
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getWorkerColor(workerRate, workforceBreaks, workerColors),
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
              const value = literacyMetric === 'census'
                ? literacy?.literacy_rate
                : literacyMetric === 'femaleAttendance'
                  ? femaleEducation?.female_school_attendance_age_6_plus_percent
                  : femaleEducation?.women_10_plus_years_schooling_percent
              return {
                color: isSelected ? '#1f2937' : '#ffffff',
                weight: isSelected ? 3 : 1,
                fillColor: getLiteracyColor(value),
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
            const workerRecord = workforceByCode?.values?.[String(feature.properties?.dtcode11)]
            const workerRate = workerRecord
              ? workerSex === 'female'
                ? workerRecord.workers_female / workerRecord.population_female * 100
                : workerRecord.workers_male / workerRecord.population_male * 100
              : Number.NaN
            const literacy = literacyByCode?.values?.[String(feature.properties?.dtcode11)]
            const femaleEducation = femaleEducationByDistrict?.values?.[districtName]
            const newsCount = newsDistrictCounts[districtName] || 0
            const newsPeriod = newsView === 'today' ? 'in today’s collection' : 'in yesterday’s digest'
            const pci = pciByDistrict?.values?.[normalizeDistrictName(districtName)]
            const comparisonMatch = comparisonResults.matches.some((match) => match.name === districtName)
            const tooltip = activeLayer === 'compare'
              ? `${districtName}: ${comparisonMatch ? 'matches all selected conditions' : 'does not match all selected conditions'}`
              : activeLayer === 'news'
              ? `${districtName}: ${newsCount} grouped news stories ${newsPeriod}`
              : activeLayer === 'crime' && Number.isFinite(crimeCount)
                ? `${districtName}: ${formatCount(crimeCount)} reported crimes against women in 2024`
                : activeLayer === 'population' && populationMetric === 'workers' && Number.isFinite(workerRate)
                  ? `${districtName}: ${workerRate.toFixed(1)}% ${workerSex} worker participation; Census 2011`
                  : activeLayer === 'population' && populationMetric === 'workers'
                    ? `${districtName}: Census 2011 worker data unavailable`
                    : activeLayer === 'population' && populationMetric === 'sexRatio' && Number.isFinite(sexRatio)
                  ? `${districtName}: ${formatCount(sexRatio)} females per 1,000 males (Census 2011)`
                  : activeLayer === 'population' && populationMetric === 'sexRatio'
                    ? `${districtName}: Census 2011 sex ratio unavailable`
                    : activeLayer === 'population' && population
                      ? `${districtName}: ${formatCount(population.total)} estimated population in 2026`
                      : activeLayer === 'population'
                        ? `${districtName}: population estimate unavailable`
                   : activeLayer === 'literacy' && literacyMetric === 'census' && literacy
                          ? `${districtName} (2011 Census: ${literacy.district_name.trim()}): ${literacy.literacy_rate.toFixed(2)}% literacy; ${formatCount(literacy.literate_population)} literate people; total population ${formatCount(literacy.total_population)}; official Census value`
                          : activeLayer === 'literacy' && literacyMetric !== 'census' && femaleEducation
                            ? literacyMetric === 'femaleAttendance'
                              ? `${districtName}: ${femaleEducation.female_school_attendance_age_6_plus_percent.toFixed(1)}% of female population aged 6+ ever attended school (NFHS-6, 2023–24)`
                              : `${districtName}: ${femaleEducation.women_10_plus_years_schooling_percent.toFixed(1)}% of women have 10+ years of schooling (NFHS-6, 2023–24)`
                            : activeLayer === 'literacy' && literacyMetric === 'census'
                            ? `${districtName}: literacy rate unavailable; no 2011 tehsil rows were provided for a derived value`
                            : activeLayer === 'literacy'
                              ? `${districtName}: NFHS-6 female education data unavailable for this boundary`
                            : activeLayer === 'pci' && pci
                              ? `${districtName}: ${formatRupees(pci.amount)} average per capita income; ${pci.estimateType}`
                              : activeLayer === 'pci'
                                ? `${districtName}: PCI value unavailable`
                                : districtName
            layer.bindTooltip(tooltip, { sticky: true })
            if (activeLayer !== 'compare' && (!selectedDistrict || activeLayer === 'pci')) {
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







