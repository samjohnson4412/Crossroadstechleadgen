import { parse } from 'node-html-parser'
import { createClient } from '@supabase/supabase-js'
import { SUNBIZ_SEARCH_CITIES, CITY_TO_COUNTY } from './constants'

const SUNBIZ_SEARCH = 'https://search.sunbiz.org/Inquiry/corporationsearch/GetList'

interface SunbizEntity {
  name: string
  docNumber: string
  status: string
  filingDate: string
  entityType: string
  detailUrl: string
}

interface SunbizDetail {
  principalAddress: string | null
  principalCity: string | null
  principalZip: string | null
  registeredAgent: string | null
}

function dateRange(daysBack: number): { begin: string; end: string } {
  const end = new Date()
  const begin = new Date()
  begin.setDate(begin.getDate() - daysBack)
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}%2F${String(d.getDate()).padStart(2, '0')}%2F${d.getFullYear()}`
  return { begin: fmt(begin), end: fmt(end) }
}

async function searchSunbiz(city: string, begin: string, end: string, skip = 0): Promise<SunbizEntity[]> {
  const body = [
    `SearchTerm=`,
    `SearchType=EntityName`,
    `SearchStatus=Active`,
    `SearchMainType=AllEntityTypes`,
    `SearchSubType=AllEntitySubTypes`,
    `SearchCitizenship=AllCitizenship`,
    `SearchDateTimeRange=FilingDate`,
    `SearchDateBegin=${begin}`,
    `SearchDateEnd=${end}`,
    `SearchCity=${encodeURIComponent(city)}`,
    `skip=${skip}`,
    `take=100`,
  ].join('&')

  const res = await fetch(SUNBIZ_SEARCH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; CrossroadsLeadGen/1.0)',
      'Referer': 'https://search.sunbiz.org/Inquiry/corporationsearch/ByEntityName',
    },
    body,
  })

  if (!res.ok) throw new Error(`Sunbiz returned ${res.status} for city ${city}`)
  const html = await res.text()
  return parseSunbizResults(html)
}

function parseSunbizResults(html: string): SunbizEntity[] {
  const root = parse(html)
  const rows = root.querySelectorAll('table.result-list tbody tr')
  const entities: SunbizEntity[] = []

  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue
    const link = cells[0].querySelector('a')
    if (!link) continue

    entities.push({
      name: link.text.trim(),
      detailUrl: `https://search.sunbiz.org${link.getAttribute('href') ?? ''}`,
      docNumber: cells[1].text.trim(),
      status: cells[2].text.trim(),
      filingDate: cells[3].text.trim(),
      entityType: cells[4]?.text.trim() ?? '',
    })
  }
  return entities
}

async function fetchSunbizDetail(url: string): Promise<SunbizDetail> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrossroadsLeadGen/1.0)' },
    })
    if (!res.ok) return { principalAddress: null, principalCity: null, principalZip: null, registeredAgent: null }
    const html = await res.text()
    const root = parse(html)

    let principalAddress: string | null = null
    let principalCity: string | null = null
    let principalZip: string | null = null
    let registeredAgent: string | null = null

    const spans = root.querySelectorAll('span')
    for (let i = 0; i < spans.length; i++) {
      const text = spans[i].text.trim()
      if (text === 'Principal Address') {
        principalAddress = spans[i + 1]?.text.trim() ?? null
        principalCity = spans[i + 2]?.text.trim() ?? null
        principalZip = spans[i + 3]?.text.trim() ?? null
      }
      if (text === 'Registered Agent Name') {
        registeredAgent = spans[i + 1]?.text.trim() ?? null
      }
    }

    return { principalAddress, principalCity, principalZip, registeredAgent }
  } catch {
    return { principalAddress: null, principalCity: null, principalZip: null, registeredAgent: null }
  }
}

export async function runSunbizIngest(
  supabaseUrl: string,
  supabaseKey: string,
  daysBack = 30,
  fetchDetails = false
): Promise<{ found: number; inserted: number; skipped: number; errors: string[] }> {
  const db = createClient(supabaseUrl, supabaseKey)
  const { begin, end } = dateRange(daysBack)
  const errors: string[] = []
  let found = 0, inserted = 0, skipped = 0

  for (const city of SUNBIZ_SEARCH_CITIES) {
    try {
      const entities = await searchSunbiz(city, begin, end)
      found += entities.length

      for (const entity of entities) {
        const { data: existing } = await db
          .from('businesses')
          .select('id')
          .eq('company_name', entity.name)
          .limit(1)

        if (existing && existing.length > 0) { skipped++; continue }

        let detail: SunbizDetail = { principalAddress: null, principalCity: null, principalZip: null, registeredAgent: null }
        if (fetchDetails) {
          detail = await fetchSunbizDetail(entity.detailUrl)
          await new Promise(r => setTimeout(r, 200))
        }

        const cityKey = (detail.principalCity ?? city).toUpperCase()
        const county = CITY_TO_COUNTY[cityKey] ?? CITY_TO_COUNTY[city] ?? null

        const { error } = await db.from('businesses').insert({
          company_name: entity.name,
          address: detail.principalAddress,
          city: detail.principalCity ?? toTitleCase(city),
          state: 'FL',
          zip: detail.principalZip,
          county,
          lead_source: 'SOS Filing',
          pitch_angle: 'New Business Package',
          status: 'cold',
          priority: 'medium',
          notes: `SOS Filing: ${entity.docNumber} | Filed: ${entity.filingDate} | Type: ${entity.entityType}`,
        })

        if (error) { errors.push(`${entity.name}: ${error.message}`); skipped++ }
        else inserted++
      }

      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      errors.push(`City ${city}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { found, inserted, skipped, errors }
}

function toTitleCase(s: string) {
  return s.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
