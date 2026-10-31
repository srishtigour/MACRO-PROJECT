const express = require('express')
const cors = require('cors')
const fs = require('node:fs/promises')
const path = require('node:path')

const app = express()
const port = Number(process.env.PORT) || 5000
const allowedFrontendOrigins = new Set(
  (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let insideQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      if (insideQuotes && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
    } else if (character === ',' && !insideQuotes) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !insideQuotes) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }

  if (value !== '' || row.length > 0) {
    row.push(value)
    rows.push(row)
  }

  const [headers, ...records] = rows
  if (!headers || records.some((record) => record.length !== headers.length)) {
    throw new Error('Population CSV has an invalid row or header')
  }

  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index]])),
  )
}

app.use(cors({
  origin(origin, callback) {
    const isLocalDevelopment = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '')
    if (!origin || isLocalDevelopment || allowedFrontendOrigins.has(origin)) {
      return callback(null, true)
    }
    return callback(new Error('This frontend origin is not allowed by CORS'))
  },
}))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/districts', async (req, res) => {
  try {
    const filePath = path.resolve(
      __dirname,
      '../frontend/public/districts.geojson'
    )
    const data = await fs.readFile(filePath, 'utf8')
    res.json(JSON.parse(data))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'District data could not be loaded' })
  }
})

app.get('/api/crime', async (req, res) => {
  try {
    const filePath = path.resolve(__dirname, 'crime-data.json')
    const data = await fs.readFile(filePath, 'utf8')
    res.json(JSON.parse(data))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not load crime data' })
  }
})

app.get('/api/population', async (req, res) => {
  try {
    const filePath = path.resolve(
      __dirname,
      '../data/raw/mp_district_population_estimates_2026.csv'
    )
    const csv = await fs.readFile(filePath, 'utf8')
    const records = parseCsv(csv)

    res.json({ records })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Population estimates could not be loaded' })
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on port ${port}`)
})
