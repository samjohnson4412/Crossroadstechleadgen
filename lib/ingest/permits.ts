// Hillsborough County Building Permit scraper
// HillsGovHub (Accela Citizen Access): https://aca-prod.accela.com/HCFL/
//
// Accela is an ASP.NET WebForms app: the search must be submitted as a
// postback carrying every form field the page rendered, plus __EVENTTARGET
// pointing at the search button. We read the real form off the page rather
// than hardcoding field names, so tenant-specific naming doesn't break us.

import { parse, HTMLElement } from 'node-html-parser'
import { createClient } from '@supabase/supabase-js'
import { CITY_TO_COUNTY } from './constants'

// HillsGovHub — Hillsborough County's Accela tenant is "HCFL"
const HILLSBOROUGH_BASE = 'https://aca-prod.accela.com/HCFL'

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Commercial permit keywords that signal low-voltage / networking / security work
const COMMERCIAL_TYPES = [
  'COMMERCIAL', 'TENANT IMPROVEMENT', 'CHANGE OF OCCUPANCY', 'NEW CONSTRUCTION',
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

export async function fetchHillsboroughPermits(daysBack = 30): Promise<{ permits: PermitRecord[]; diag: string[] }> {
  const diag: string[] = []
  const end = new Date()
  const begin = new Date()
  begin.setDate(begin.getDate() - daysBack)

  const fmtDate = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`

  const searchUrl = `${HILLSBOROUGH_BASE}/Cap/CapHome.aspx?module=Building&TabName=Building`

  const getRes = await fetch(searchUrl, {
    headers: { 'User-Agent': BROWSER_UA },
  })
  if (!getRes.ok) throw new Error(`Hillsborough portal returned ${getRes.status}`)

  const cookies = (getRes.headers.get('set-cookie') ?? '')
    .split(/,(?=[^;]+=[^;]+)/)
    .map(c => c.trim().split(';')[0])
    .join('; ')

  const html = await getRes.text()
  const root = parse(html)

  // Collect every form field the page actually rendered
  const formData = new URLSearchParams()
  for (const input of root.querySelectorAll('input[name]')) {
    const name = input.getAttribute('name')!
    const type = (input.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'submit' || type === 'button' || type === 'image') continue
    if ((type === 'checkbox' || type === 'radio') && input.getAttribute('checked') == null) continue
    formData.set(name, input.getAttribute('value') ?? '')
  }
  for (const select of root.querySelectorAll('select[name]')) {
    const name = select.getAttribute('name')!
    const selected = select.querySelector('option[selected]') ?? select.querySelector('option')
    formData.set(name, selected?.getAttribute('value') ?? '')
  }

  // Locate the real date fields and search trigger
  const fieldNames = [...formData.keys()]
  const dateFrom = fieldNames.find(n => /datefrom/i.test(n))
  const dateTo = fieldNames.find(n => /dateto/i.test(n))
  const dateKind = fieldNames.find(n => /datesearchfield|searchdatetype/i.test(n))
  const searchTarget =
    html.match(/__doPostBack\('([^']*btnNewSearch[^']*)'/i)?.[1] ??
    html.match(/__doPostBack\('([^']*btnSearch[^']*)'/i)?.[1] ??
    null

  if (dateFrom) formData.set(dateFrom, fmtDate(begin))
  if (dateTo) formData.set(dateTo, fmtDate(end))
  if (searchTarget) {
    formData.set('__EVENTTARGET', searchTarget)
    formData.set('__EVENTARGUMENT', '')
  }

  const dateKindSelect = dateKind ? root.querySelector(`select[name="${dateKind}"]`) : null
  const dateKindOptions = dateKindSelect
    ? dateKindSelect.querySelectorAll('option').map(o => `${o.getAttribute('value')}=${o.text.trim()}`).slice(0, 8).join(' | ')
    : 'n/a'

  diag.push(`[diag] form: ${fieldNames.length} fields | dateFrom=${dateFrom ?? 'NOT FOUND'} | dateTo=${dateTo ?? 'NOT FOUND'} | searchBtn=${searchTarget ?? 'NOT FOUND'} | dateKind=${dateKind ?? 'none'} opts: ${dateKindOptions}`)

  const postRes = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': BROWSER_UA,
      'Referer': searchUrl,
      ...(cookies ? { 'Cookie': cookies } : {}),
    },
    body: formData.toString(),
  })

  if (!postRes.ok) throw new Error(`Hillsborough search POST returned ${postRes.status}`)
  const resultsHtml = await postRes.text()
  const resultRoot = parse(resultsHtml)

  const { permits, gridDiag } = parsePermitResults(resultRoot)
  diag.push(`[diag] POST ${postRes.status}: ${resultsHtml.length} chars | ${gridDiag}`)

  return { permits, diag }
}

// Find the results grid by its headers instead of guessing table ids/positions
function parsePermitResults(root: HTMLElement): { permits: PermitRecord[]; gridDiag: string } {
  const permits: PermitRecord[] = []
  const candidates: string[] = []

  for (const table of root.querySelectorAll('table')) {
    const headerCells = table.querySelectorAll('th, tr:first-child td').map(c => c.text.trim().toLowerCase())
    if (headerCells.length < 3) continue

    const col = (patterns: RegExp[]) =>
      headerCells.findIndex(h => patterns.some(p => p.test(h)))

    const numIdx = col([/record number/, /permit number/, /^record$/, /^permit$/])
    const addrIdx = col([/address/])
    if (numIdx === -1 || addrIdx === -1) continue

    const typeIdx = col([/record type/, /permit type/, /^type$/])
    const dateIdx = col([/^date$/, /date opened/, /issued/, /file date/])
    const descIdx = col([/description/, /project name/, /short notes/])

    const id = table.getAttribute('id') ?? '(no id)'
    const rows = table.querySelectorAll('tr').slice(1)
    candidates.push(`grid ${id}: ${rows.length} rows, headers=[${headerCells.slice(0, 8).join(', ')}]`)

    for (const row of rows) {
      const cells = row.querySelectorAll('td')
      if (cells.length <= Math.max(numIdx, addrIdx)) continue
      const permitNumber = cells[numIdx]?.text.trim()
      const address = cells[addrIdx]?.text.trim().replace(/\s+/g, ' ')
      if (!permitNumber || !address || permitNumber.length < 4) continue

      const permitType = typeIdx >= 0 ? cells[typeIdx]?.text.trim() ?? '' : ''
      const issueDate = dateIdx >= 0 ? cells[dateIdx]?.text.trim() ?? '' : ''
      const description = descIdx >= 0 ? cells[descIdx]?.text.trim() ?? '' : ''

      const isCommercial = COMMERCIAL_TYPES.some(t =>
        permitType.toUpperCase().includes(t) || description.toUpperCase().includes(t)
      )
      if (!isCommercial) continue

      permits.push({ permitNumber, permitType, address, city: 'Tampa', projectName: description, issueDate, description })
    }
  }

  const gridDiag = candidates.length
    ? candidates.slice(0, 3).join(' || ')
    : `no results grid found (tables=${root.querySelectorAll('table').length})`

  return { permits, gridDiag }
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
    const { permits, diag } = await fetchHillsboroughPermits(daysBack)
    errors.push(...diag)
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
