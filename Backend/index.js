const express = require('express')
const cors = require('cors')
const fs = require('node:fs/promises')
const path = require('node:path')

const app = express()
const port = 5000

app.use(cors())

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
app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`)
})