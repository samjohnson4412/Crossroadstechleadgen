// Florida Division of Corporations — official daily data files.
//
// Sunbiz blocks web scraping from datacenter IPs, so instead we pull the
// state's official daily filing files from their public SFTP server.
// This is the sanctioned bulk-data route, documented at:
//   https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/
// Credentials below are the public ones published on that page.
//
// Files are fixed-width ASCII (1440-char records), named CCYYMMDDc.txt,
// one file per business day, containing that day's corporate filings.

import SftpClient from 'ssh2-sftp-client'
import { createClient } from '@supabase/supabase-js'
import { TAMPA_BAY_CITIES, CITY_TO_COUNTY } from './constants'

const SFTP_HOST = process.env.SUNBIZ_SFTP_HOST ?? 'sftp.floridados.gov'
const SFTP_USER = process.env.SUNBIZ_SFTP_USER ?? 'Public'
const SFTP_PASS = process.env.SUNBIZ_SFTP_PASS ?? 'PubAccess1845!'

// Directories where the daily corporate files may live (varies by server layout)
const CANDIDATE_DIRS = ['/Public/doc/cor', '/doc/cor', '/cor', '/Public/doc/Cor', '/Public/cor']

// Max daily files per run — keeps us inside Vercel's 60s function limit
const MAX_FILES_PER_RUN = 5

// Fixed-width layout from the FL DOS "Corporate File Definitions" spec.
// Positions are 0-indexed [start, end) for String.slice.
// If the state ever shifts this layout, the validation gate below will
// catch it and surface a raw sample line in the run log for recalibration.
const LAYOUT = {
  docNumber: [0, 12],
  name: [12, 204],
  status: [204, 205],
  filingType: [205, 220],
  princAdd1: [220, 262],
  princAdd2: [262, 304],
  princCity: [304, 332],
  princState: [332, 334],
  princZip: [334, 344],
  princCountry: [344, 346],
  fileDate: [472, 480],
  fei: [480, 494],
} as const

interface DailyRecord {
  docNumber: string
  name: string
  status: string
  filingType: string
  address: string
  city: string
  state: string
  zip: string
  fileDate: string
}

function field(line: string, key: keyof typeof LAYOUT): string {
  const [start, end] = LAYOUT[key]
  return line.slice(start, end).trim()
}

function looksValid(line: string): boolean {
  if (line.length < 494) return false
  const doc = field(line, 'docNumber')
  const state = field(line, 'princState')
  // Doc numbers look like L24000123456 / P24000012345 / N12345 etc.
  if (!/^[A-Z]{0,3}\d/.test(doc)) return false
  if (state && !/^[A-Z]{2}$/.test(state)) return false
  return true
}

function parseFileDate(raw: string): string {
  if (!/^\d{8}$/.test(raw)) return raw
  // Auto-detect CCYYMMDD vs MMDDCCYY
  const asYearFirst = Number(raw.slice(0, 4))
  if (asYearFirst >= 1900 && asYearFirst <= 2100) {
    return `${raw.slice(4, 6)}/${raw.slice(6, 8)}/${raw.slice(0, 4)}`
  }
  return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)}`
}

function parseDailyFile(content: string): { records: DailyRecord[]; invalid: number; sample: string | null } {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0)
  const records: DailyRecord[] = []
  let invalid = 0
  let sample: string | null = null

  for (const line of lines) {
    if (!looksValid(line)) {
      invalid++
      if (!sample) sample = line.slice(0, 360)
      continue
    }
    records.push({
      docNumber: field(line, 'docNumber'),
      name: field(line, 'name'),
      status: field(line, 'status'),
      filingType: field(line, 'filingType'),
      address: [field(line, 'princAdd1'), field(line, 'princAdd2')].filter(Boolean).join(', '),
      city: field(line, 'princCity'),
      state: field(line, 'princState'),
      zip: field(line, 'princZip').slice(0, 5),
      fileDate: parseFileDate(field(line, 'fileDate')),
    })
  }
  return { records, invalid, sample }
}

function dailyFileNames(daysBack: number): string[] {
  const names: string[] = []
  const d = new Date()
  for (let i = 0; i <= daysBack; i++) {
    const day = d.getDay()
    // Files are only generated on business days
    if (day !== 0 && day !== 6) {
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      names.push(`${yyyy}${mm}${dd}c.txt`)
    }
    d.setDate(d.getDate() - 1)
  }
  return names
}

async function findDailyDir(sftp: SftpClient): Promise<{ dir: string; files: string[] } | null> {
  for (const dir of CANDIDATE_DIRS) {
    try {
      const listing = await sftp.list(dir)
      const files = listing.filter(f => /^\d{8}c\.txt$/i.test(f.name)).map(f => f.name)
      if (files.length > 0) return { dir, files }
    } catch {
      // Directory doesn't exist on this layout — try next
    }
  }
  // Last resort: walk the root one level deep looking for daily cor files
  try {
    const root = await sftp.list('/')
    for (const entry of root) {
      if (entry.type !== 'd') continue
      const dir = `/${entry.name}`
      try {
        const listing = await sftp.list(dir)
        const files = listing.filter(f => /^\d{8}c\.txt$/i.test(f.name)).map(f => f.name)
        if (files.length > 0) return { dir, files }
        // One more level (e.g. /Public/doc)
        for (const sub of listing.filter(f => f.type === 'd')) {
          const subdir = `${dir}/${sub.name}`
          const subListing = await sftp.list(subdir)
          const subFiles = subListing.filter(f => /^\d{8}c\.txt$/i.test(f.name)).map(f => f.name)
          if (subFiles.length > 0) return { dir: subdir, files: subFiles }
        }
      } catch { /* skip unreadable dirs */ }
    }
  } catch { /* fall through */ }
  return null
}

export async function runSunbizIngest(
  supabaseUrl: string,
  supabaseKey: string,
  daysBack = 30,
  _fetchDetails = false // kept for API compatibility; not used by the SFTP route
): Promise<{ found: number; inserted: number; skipped: number; errors: string[] }> {
  const db = createClient(supabaseUrl, supabaseKey)
  const errors: string[] = []
  let found = 0, inserted = 0, skipped = 0

  const cityFilter = new Set(TAMPA_BAY_CITIES)
  const sftp = new SftpClient()

  try {
    await sftp.connect({
      host: SFTP_HOST,
      port: 22,
      username: SFTP_USER,
      password: SFTP_PASS,
      readyTimeout: 15000,
    })

    const located = await findDailyDir(sftp)
    if (!located) {
      throw new Error('Could not locate daily corporate files on the Sunbiz SFTP server. Directory layout may have changed.')
    }

    const wanted = new Set(dailyFileNames(daysBack).map(n => n.toLowerCase()))
    let matching = located.files
      .filter(f => wanted.has(f.toLowerCase()))
      .sort()
      .reverse() // newest first

    if (matching.length > MAX_FILES_PER_RUN) {
      errors.push(`${matching.length} daily files in range; processing the ${MAX_FILES_PER_RUN} most recent (run again with a smaller "days back" to backfill the rest)`)
      matching = matching.slice(0, MAX_FILES_PER_RUN)
    }
    if (matching.length === 0) {
      errors.push(`No daily files found in the last ${daysBack} days (dir: ${located.dir}). Newest available: ${located.files.sort().slice(-3).join(', ')}`)
    }

    for (const fileName of matching) {
      const buf = await sftp.get(`${located.dir}/${fileName}`) as Buffer
      const { records, invalid, sample } = parseDailyFile(buf.toString('latin1'))

      if (records.length === 0 && invalid > 0) {
        errors.push(`${fileName}: layout mismatch — ${invalid} unparseable lines. Sample: "${sample}"`)
        continue
      }

      const tampaBay = records.filter(r =>
        r.status === 'A' &&
        r.state === 'FL' &&
        cityFilter.has(r.city.toUpperCase())
      )
      found += tampaBay.length

      for (const rec of tampaBay) {
        const { data: existing } = await db
          .from('businesses')
          .select('id')
          .eq('company_name', rec.name)
          .limit(1)

        if (existing && existing.length > 0) { skipped++; continue }

        const county = CITY_TO_COUNTY[rec.city.toUpperCase()] ?? null

        const { error } = await db.from('businesses').insert({
          company_name: rec.name,
          address: rec.address || null,
          city: toTitleCase(rec.city),
          state: 'FL',
          zip: rec.zip || null,
          county,
          lead_source: 'SOS Filing',
          pitch_angle: 'New Business Package',
          status: 'cold',
          priority: 'medium',
          notes: `SOS Filing: ${rec.docNumber} | Filed: ${rec.fileDate} | Type: ${rec.filingType}`,
        })

        if (error) { errors.push(`${rec.name}: ${error.message}`); skipped++ }
        else inserted++
      }
    }
  } finally {
    await sftp.end().catch(() => {})
  }

  return { found, inserted, skipped, errors }
}

function toTitleCase(s: string) {
  return s.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
