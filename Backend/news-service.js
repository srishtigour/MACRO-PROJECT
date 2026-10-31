const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const SOURCES_PATH = path.join(__dirname, 'news-sources.json')
const STORE_PATH = path.join(__dirname, '.data', 'news-store.json')
const IST_MINUTES = 330
const POLL_MS = 15 * 60 * 1000
const DISTRICTS = [
  ['Agar Malwa', 'आगर मालवा'], ['Alirajpur', 'अलीराजपुर'], ['Anuppur', 'अनूपपुर'],
  ['Ashoknagar', 'अशोकनगर'], ['Balaghat', 'बालाघाट'], ['Barwani', 'बड़वानी'],
  ['Betul', 'बैतूल'], ['Bhind', 'भिंड'], ['Bhopal', 'भोपाल'], ['Burhanpur', 'बुरहानपुर'],
  ['Chhatarpur', 'छतरपुर'], ['Chhindwara', 'छिंदवाड़ा'], ['Damoh', 'दमोह'],
  ['Datia', 'दतिया'], ['Dewas', 'देवास'], ['Dhar', 'धार'], ['Dindori', 'डिंडोरी'],
  ['Guna', 'गुना'], ['Gwalior', 'ग्वालियर'], ['Harda', 'हरदा'], ['Indore', 'इंदौर'],
  ['Jabalpur', 'जबलपुर'], ['Jhabua', 'झाबुआ'], ['Katni', 'कटनी'], ['Khandwa', 'खंडवा'],
  ['Khargone', 'खरगोन'], ['Mandla', 'मंडला'], ['Mandsaur', 'मंदसौर'], ['Morena', 'मुरैना'],
  ['Narmadapuram', 'नर्मदापुरम', 'Hoshangabad', 'होशंगाबाद'],
  ['Narsimhapur', 'नरसिंहपुर', 'Narsinghpur'], ['Neemuch', 'नीमच'], ['Niwari', 'निवाड़ी'],
  ['Pandhurna', 'पांढुर्णा'], ['Panna', 'पन्ना'], ['Raisen', 'रायसेन'], ['Rajgarh', 'राजगढ़'],
  ['Ratlam', 'रतलाम'], ['Rewa', 'रीवा'], ['Sagar', 'सागर'], ['Satna', 'सतना'],
  ['Sehore', 'सीहोर'], ['Seoni', 'सिवनी'], ['Shahdol', 'शहडोल'], ['Shajapur', 'शाजापुर'],
  ['Sheopur', 'श्योपुर'], ['Shivpuri', 'शिवपुरी'], ['Sidhi', 'सीधी'],
  ['Singrauli', 'सिंगरौली'], ['Tikamgarh', 'टीकमगढ़'], ['Ujjain', 'उज्जैन'],
  ['Umaria', 'उमरिया'], ['Vidisha', 'विदिशा'], ['Maihar', 'मैहर'], ['Mauganj', 'मऊगंज'],
]
const BOUNDARY_ALIASES = { Pandhurna: 'Chhindwara', Maihar: 'Satna', Mauganj: 'Rewa', Narmadapuram: 'Hoshangabad' }
const STOP_WORDS = new Set(['the','and','for','with','from','after','before','into','near','about','says','said','report','reports','latest','news','live','में','का','की','के','से','को','पर','और','है','हैं','एक','लिए','ने','बताया','कहा','यह','वह','भी','तक','साथ','बाद'])
let collecting = false
let publishing = false

function istDate(date = new Date()) {
  return new Date(date.getTime() + IST_MINUTES * 60_000).toISOString().slice(0, 10)
}
function previousDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
}
function plainText(value = '') {
  return decodeXml(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
function field(xml, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return xml.match(new RegExp(`<${safe}\\b[^>]*>([\\s\\S]*?)<\\/${safe}\\s*>`, 'i'))?.[1] || ''
}
function findDistrict(text) {
  const allNames = DISTRICTS.flatMap(([name, ...aliases]) => aliases.map((alias) => [alias, name]))
    .sort((a, b) => b[0].length - a[0].length)
  for (const [alias, district] of allNames) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = /^[\x00-\x7f]+$/.test(alias)
      ? new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu')
      : new RegExp(escaped, 'u')
    if (regex.test(text)) return district
  }
  return null
}
function parseFeed(xml, source) {
  const itemMatches = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
  return itemMatches.flatMap((item) => {
    const body = item[2]
    const title = plainText(field(body, 'title'))
    const atomLink = body.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]
    const link = plainText(field(body, 'link')) || atomLink || plainText(field(body, 'guid'))
    const description = plainText(field(body, 'content:encoded') || field(body, 'description') || field(body, 'summary') || field(body, 'content')).slice(0, 900)
    const dateText = plainText(field(body, 'pubDate') || field(body, 'published') || field(body, 'updated'))
    if (!title || !link) return []
    let url
    try {
      const parsed = new URL(link, source.url)
      for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key)
      url = parsed.href
    } catch { return [] }
    const text = `${title} ${description}`
    const district = findDistrict(text) || source.districtHint || null
    if (!district && !source.mpScoped && !/madhya\s*pradesh|\bmp\b|मध्य\s*प्रदेश|मध्यप्रदेश/i.test(text)) return []
    const pubDate = new Date(dateText)
    const devanagari = (text.match(/[\u0900-\u097f]/g) || []).length
    return [{
      id: crypto.createHash('sha256').update(url).digest('hex'), title, description, url,
      sourceName: source.name,
      publishedAt: Number.isNaN(pubDate.getTime()) ? new Date().toISOString() : pubDate.toISOString(),
      language: devanagari > 3 ? 'hi' : 'en', district, mapDistrict: district ? (BOUNDARY_ALIASES[district] || district) : null,
    }]
  })
}
function tokens(article) {
  return new Set(`${article.title} ${article.description}`.toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)?.filter((word) => !STOP_WORDS.has(word)) || [])
}
function similarity(first, second) {
  const a = tokens(first); const b = tokens(second)
  if (a.size < 3 || b.size < 3) return 0
  const shared = [...a].filter((word) => b.has(word)).length
  return Math.max(shared / (a.size + b.size - shared), shared / Math.min(a.size, b.size))
}
function groupArticles(articles) {
  const groups = []
  for (const article of [...articles].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))) {
    const group = groups.find((candidate) => {
      const first = candidate.articles[0]
      const hours = Math.abs(new Date(article.publishedAt) - new Date(first.publishedAt)) / 3_600_000
      return Boolean(article.district && first.district && article.district === first.district && hours <= 36 && similarity(article, first) >= 0.46)
    })
    if (group) group.articles.push(article)
    else groups.push({ articles: [article] })
  }
  return groups.map(({ articles: related }) => {
    const best = [...related].sort((a, b) => {
      const score = (item) => Math.min(item.description.length, 600) + (item.description.length >= 80 ? 100 : 0)
      return score(b) - score(a)
    })[0]
    const sources = [...new Map(related.map((article) => [article.sourceName, { name: article.sourceName, url: article.url }])).values()]
    return {
      id: crypto.createHash('sha1').update(related.map((article) => article.id).sort().join('|')).digest('hex'),
      title: best.title, description: best.description, descriptionSource: best.sourceName,
      district: best.district, mapDistrict: best.mapDistrict, language: best.language, publishedAt: best.publishedAt,
      articleCount: related.length, sources,
    }
  }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
}
async function readStore() {
  try {
    const store = JSON.parse((await fs.readFile(STORE_PATH, 'utf8')).replace(/^\uFEFF/, ''))
    store.articles = (store.articles || []).map((article) => {
      const district = findDistrict(`${article.title} ${article.description}`)
      return {
        ...article,
        district,
        publicationDate: article.publicationDate || istDate(new Date(article.publishedAt)),
        mapDistrict: district ? (BOUNDARY_ALIASES[district] || district) : null,
      }
    })
    return store
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return { articles: [], digests: [], sourceStatus: [], lastCollectionAt: null }
  }
}
async function writeStore(store) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true })
  const temp = `${STORE_PATH}.tmp`
  await fs.writeFile(temp, JSON.stringify(store, null, 2), 'utf8')
  await fs.rename(temp, STORE_PATH)
}
async function collectNews() {
  if (collecting) return { skipped: true }
  collecting = true
  try {
    const sources = JSON.parse((await fs.readFile(SOURCES_PATH, 'utf8')).replace(/^\uFEFF/, ''))
    const store = await readStore()
    const now = new Date()
    const knownIds = new Set(store.articles.map((item) => item.id))
    const feedResults = await Promise.all(sources.map(async (source) => {
      try {
        const response = await fetch(source.url, { headers: { 'User-Agent': 'MP-Smart-Geospatial-News/1.0 (RSS reader)' }, signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const items = parseFeed(await response.text(), source).filter((item) => {
          const age = now.getTime() - new Date(item.publishedAt).getTime()
          return age <= 48 * 3_600_000 || age < 0
        })
        const fresh = items.filter((item) => !knownIds.has(item.id)).map((item) => ({
          ...item, firstSeenAt: now.toISOString(), collectionDate: istDate(now), publicationDate: istDate(new Date(item.publishedAt)),
        }))
        fresh.forEach((item) => knownIds.add(item.id))
        return { source: source.name, ok: true, itemCount: items.length, newCount: fresh.length, error: null, articles: fresh }
      } catch (error) {
        return { source: source.name, ok: false, itemCount: 0, newCount: 0, error: error.message, articles: [] }
      }
    }))
    const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString()
    store.articles = [...store.articles.filter((item) => item.firstSeenAt >= cutoff), ...feedResults.flatMap((feed) => feed.articles)]
    store.sourceStatus = feedResults.map(({ source, ok, itemCount, newCount, error }) => ({ source, ok, itemCount, newCount, error }))
    store.lastCollectionAt = now.toISOString()
    await writeStore(store)
    const added = feedResults.reduce((sum, feed) => sum + feed.newCount, 0)
    console.log(`News feeds checked: ${added} new MP stories; ${feedResults.filter((feed) => feed.ok).length}/${sources.length} sources available`)
    return { newCount: added, sourceStatus: store.sourceStatus }
  } finally { collecting = false }
}
async function publishYesterday(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_MINUTES * 60_000)
  if (shifted.getUTCHours() < 6 || publishing) return null
  publishing = true
  try {
    const forDate = previousDate(istDate(now))
    const store = await readStore()
    if (store.digests.some((digest) => digest.forDate === forDate)) return null
    const articles = store.articles.filter((article) => article.publicationDate === forDate)
    if (!articles.length) return null
    const digest = { forDate, publishedAt: now.toISOString(), events: groupArticles(articles), collectedArticleCount: articles.length }
    store.digests = [digest, ...store.digests.filter((item) => item.forDate !== forDate)].slice(0, 60)
    await writeStore(store)
    console.log(`Daily MP news digest ready for ${forDate}: ${digest.events.length} grouped stories`)
    return digest
  } finally { publishing = false }
}
function nextSixAm(now = new Date()) {
  const local = new Date(now.getTime() + IST_MINUTES * 60_000)
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 6))
  if (local >= target) target.setUTCDate(target.getUTCDate() + 1)
  return new Date(target.getTime() - IST_MINUTES * 60_000).toISOString()
}
async function getNewsPayload() {
  const store = await readStore()
  const today = istDate()
  const articles = store.articles.filter((article) => article.publicationDate === today)
  return {
    today: { date: today, events: groupArticles(articles), collectedArticleCount: articles.length },
    publishedDigest: store.digests[0] || null,
    status: { lastCollectionAt: store.lastCollectionAt, nextDigestAt: nextSixAm(), everyMinutes: 15, timeZone: 'Asia/Kolkata', sourceStatus: store.sourceStatus },
  }
}
function startNewsScheduler() {
  let lastCollection = Date.now()
  const collectThenPublish = async () => {
    await collectNews()
    lastCollection = Date.now()
    await publishYesterday()
  }
  collectThenPublish().catch((error) => console.error('Initial news collection failed:', error))
  const timer = setInterval(async () => {
    const now = new Date()
    const localNow = new Date(now.getTime() + IST_MINUTES * 60_000)
    const sixAmPublicationCheck = localNow.getUTCHours() === 6 && localNow.getUTCMinutes() < 2
    if (Date.now() - lastCollection >= POLL_MS || sixAmPublicationCheck) {
      await collectNews()
      lastCollection = Date.now()
    }
    publishYesterday().catch((error) => console.error('Scheduled digest publication failed:', error))
  }, 60_000)
  timer.unref()
}
module.exports = { collectNews, getNewsPayload, startNewsScheduler }
if (require.main === module) {
  collectNews().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}








