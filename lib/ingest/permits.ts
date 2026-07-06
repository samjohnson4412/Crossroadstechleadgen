// Hillsborough County Building Permit scraper
// Public data portal: https://www.hillsboroughcounty.org/en/residents/property-owners-and-renters/building-services
// HillsGovHub (Accela Citizen Access): https://aca-prod.accela.com/HCFL/

import { parse } from 'node-html-parser'
import { createClient } from '@supabase/supabase-js'
import { CITY_TO_COUNTY } from './constants'

// HillsGovHub — Hillsborough County's Accela tenant is "HCFL"
const HILLSBOROUGH_BASE = 'https://aca-prod.accela.com/HCFL'

// Commercial permit type codes that signal low-voltage / networking / security work
const COMMERCIAL_TYPES = [
  'COMMERCIAL NEW', 'COMMERCIAL ADDITION', 'COMMERCIAL ALTERATION',
  'TENANT IMPROVEMENT', 'CHANGE OF OCCUPANCY', 'COMMERCIAL REMODEL',
]

export interface PermitRecord {
  permitNumber: string
  permitType: string
  address: string
  city: string
  projectName: string
  issueDate: string
  description: string
}

export async function fetchHillsboroughPermits(daysBack = 30): Promise<PermitRecord[]> {
  const end = new Date()
  const begin = new Date()
  begin.setDate(begin.getDate() - daysBack)

  const fmtDate = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`

  // Hillsborough's Accela public search for commercial permits
  const searchUrl = `${HILLSBOROUGH_BASE}/Cap/CapHome.aspx?module=Building&TabName=Building`

  // The Accela system uses ASP.NET WebForms with __VIEWSTATE
  // First GET the form to get the VIEWSTATE token
  const getRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  })
  if (!getRes.ok) throw new Error(`Hillsborough portal returned ${getRes.status}`)

  // Carry the ASP.NET session cookie into the search POST
  const cookies = (getRes.headers.get('set-cookie') ?? '')
    .split(/,(?=[^;]+=[^;]+)/)
    .map(c => c.trim().split(';')[0])
    .join('; ')

  const html = await getRes.text()
  const root = parse(html)

  const viewState = root.querySelector('#__VIEWSTATE')?.getAttribute('value') ?? ''
  const eventValidation = root.querySelector('#__EVENTVALIDATION')?.getAttribute('value') ?? ''

  // POST the search form
  const formData = new URLSearchParams({
    '__VIEWSTATE': viewState,
    '__EVENTVALIDATION': eventValidation,
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitType': 'COMMERCIAL',
    'ctl00$PlaceHolderMain$generalSearchForm$drpGSDateSearchField': 'IssuedDate',
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSDateFrom': fmtDate(begin),
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSDateTo': fmtDate(end),
    'ctl00$PlaceHolderMain$generalSearchForm$btnSearch': 'Search',
  })

  const postRes = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': searchUrl,
      ...(cookies ? { 'Cookie': cookies } : {}),
    },
    body: formData.toString(),
  })

  if (!postRes.ok) throw new Error(`Hillsborough search POST returned ${postRes.status}`)
  const resultsHtml = await postRes.text()
  return parsePermitResults(resultsHtml)
}

function parsePermitResults(html: string): PermitRecord[] {
  const root = parse(html)
  const rows = root.querySelectorAll('table.aca_grid_table tbody tr, #tbl_permit tbody tr')
  const permits: PermitRecord[] = []

  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue

    const permitNumber = cells[0]?.text.trim()
    const permitType = cells[1]?.text.trim()
    const address = cells[2]?.text.trim()
    const projectName = cells[3]?.text.trim() ?? ''
    const issueDate = cells[4]?.text.trim() ?? ''
    const description = cells[5]?.text.trim() ?? ''

    if (!permitNumber || !address) continue

    // Filter for commercial types only
    const isCommercial = COMMERCIAL_TYPES.some(t =>
      permitType.toUpperCase().includes(t) || description.toUpperCase().includes('COMMERCIAL')
    )
    if (!isCommercial) continue

    permits.push({ permitNumber, permitType, address, city: 'Tampa', projectName, issueDate, description })
  }
  return permits
}

export async function runPermitIngest(
  supabaseUrl: string,
  supabaseKey: string,
  daysBack = 30
): Promise<{ found: number; inserted: number; skipped: number; errors: string[] }> {
  const db = createClient(supabaseUrl, supabaseKey)
  const errors: string[] = []
  let found = 0, inserted = 0, skipped = 0

  try {
    const permits = await fetchHillsboroughPermits(daysBack)
    found = permits.length

    for (const permit of permits) {
      // Check for duplicates by address
      const { data: existing } = await db
        .from('businesses')
        .select('id')
        .ilike('address', `%${permit.address.split(' ').slice(0, 3).join(' ')}%`)
        .eq('lead_source', 'Building Permit')
        .limit(1)

      if (existing && existing.length > 0) { skipped++; continue }

      const cityKey = permit.city.toUpperCase()
      const county = CITY_TO_COUNTY[cityKey] ?? 'Hillsborough'

      const { error } = await db.from('businesses').insert({
        company_name: permit.projectName || `Commercial Permit — ${permit.address}`,
        address: permit.address,
        city: permit.city,
        state: 'FL',
        county,
        lead_source: 'Building Permit',
        pitch_angle: 'Camera / Surveillance',
        status: 'cold',
        priority: 'high',
        notes: `Permit #${permit.permitNumber} | Type: ${permit.permitType} | Issued: ${permit.issueDate}\n${permit.description}`,
      })

      if (error) { errors.push(`${permit.address}: ${error.message}`); skipped++ }
      else inserted++
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }

  return { found, inserted, skipped, errors }
}
