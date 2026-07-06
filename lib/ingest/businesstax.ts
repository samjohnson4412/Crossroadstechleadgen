// Tampa business tax receipts (business licenses).
//
// The city's ArcGIS BusinessTax folder only holds inspector territories, but
// Tampa runs a public Business Tax Receipts search app whose results grid is
// pageable via a plain query parameter — every business with a paid receipt
// for the current fiscal year:
//   https://apps.tampa.gov/Business_Tax_WebApp/
//
// We read the pager to find the total page count, pull a handful of pages
// (newest receipts tend to sit at the tail of the account-number ordering),
// and map columns by their header names. Diagnostics report headers, pager
// size, and sample rows so field mapping can be corrected from run logs.

import { parse } from 'node-html-parser'
import { createClient } from '@supabase/supabase-js'

const APP_HOSTS = [
  'https://apps.tampa.gov/Business_Tax_WebApp/',
  'https://apps.tampagov.net/Business_Tax_WebApp/',
]
const PAGE_PARAM = 'ctl00_MainContent_RadGrid1ChangePage'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// How many grid pages to pull per run (each is ~10-50 rows)
const PAGES_PER_RUN = 6

interface GridPage {
  headers: string[]
  rows: string[][]
}

async function fetchPage(base: string, page?: number): Promise<string> {
  const url = page && page > 1 ? `${base}?${PAGE_PARAM}=${page}` : base
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
  })
  if (!res.ok) throw new Error(`Business tax app returned ${res.status} for ${url}`)
  return res.text()
}

// The results grid is the table with the most rows on the page
function parseGrid(html: string): GridPage {
  const root = parse(html)
  let best: GridPage = { headers: [], rows: [] }

  for (const table of root.querySelectorAll('table')) {
    const headerCells = table.querySelectorAll('th').map(c => c.text.trim())
    const rows: string[][] = []
    for (const tr of table.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('td').map(c => c.text.replace(/\s+/g, ' ').trim())
      if (cells.length >= 2 && cells.some(c => c.length > 0)) rows.push(cells)
    }
    if (rows.length > best.rows.length) best = { headers: headerCells, rows }
  }
  return best
}

function maxPageNumber(html: string): number {
  let max = 1
  const re = new RegExp(`${PAGE_PARAM}=(\\d+)`, 'g')
  for (const m of html.matchAll(re)) {
    const n = Number(m[1])
    if (n > max) max = n
  }
  // RadGrid pagers also render "Page X of Y" text
  const ofMatch = html.match(/of\s+(\d{2,6})\s*(?:items|pages)?/i)
  if (ofMatch && Number(ofMatch[1]) > max && Number(ofMatch[1]) < 100000) max = Number(ofMatch[1])
  return max
}

export async function runBusinessTaxIngest(
  supabaseUrl: string,
  supabaseKey: string,
  daysBack = 30
): Promise<{ found: number; inserted: number; skipped: number; errors: string[] }> {
  const db = createClient(supabaseUrl, supabaseKey)
  const errors: string[] = []
  let found = 0, inserted = 0, skipped = 0

  try {
    // Find a host that serves the app
    let base: string | null = null
    let firstHtml = ''
    for (const host of APP_HOSTS) {
      try {
        firstHtml = await fetchPage(host)
        base = host
        break
      } catch (err) {
        errors.push(`[diag] ${host}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (!base) throw new Error('Business tax app unreachable on both hosts')

    const firstGrid = parseGrid(firstHtml)
    const totalPages = maxPageNumber(firstHtml)
    errors.push(`[diag] ${base} | grid headers=[${firstGrid.headers.join(', ')}] | ${firstGrid.rows.length} rows on p1 | pager max=${totalPages}`)
    if (firstGrid.rows[0]) errors.push(`[diag] p1 first row: [${firstGrid.rows[0].slice(0, 8).join(' | ')}]`)

    if (firstGrid.rows.length === 0) {
      throw new Error('No data grid found on the business tax app page — see notes for what was parsed.')
    }

    // Map columns by header names
    const headers = firstGrid.headers.map(h => h.toLowerCase())
    const col = (patterns: RegExp[]) => headers.findIndex(h => patterns.some(p => p.test(h)))
    const nameIdx = col([/business.?name/, /^dba/, /^name/, /company/])
    const addrIdx = col([/address|location/])
    const dateIdx = col([/date|issued|paid/])
    const classIdx = col([/class|categor|type|descript/])
    const acctIdx = col([/account|receipt|number|#/])
    errors.push(`[diag] mapped cols: name=${nameIdx} addr=${addrIdx} date=${dateIdx} class=${classIdx} acct=${acctIdx}`)

    if (nameIdx === -1) {
      throw new Error('Could not identify the business-name column — see grid headers in notes.')
    }

    // Pull the tail pages (newest accounts) plus page 1
    const pageNums = new Set<number>([1])
    for (let i = 0; i < PAGES_PER_RUN - 1; i++) {
      const p = totalPages - i
      if (p > 1) pageNums.add(p)
    }

    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000
    const allRows: string[][] = [...firstGrid.rows]

    for (const p of [...pageNums].filter(p => p !== 1).sort((a, b) => b - a)) {
      try {
        const html = await fetchPage(base, p)
        const grid = parseGrid(html)
        allRows.push(...grid.rows)
        await new Promise(r => setTimeout(r, 300))
      } catch (err) {
        errors.push(`[diag] page ${p}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    errors.push(`[diag] collected ${allRows.length} rows across ${pageNums.size} pages`)

    for (const cells of allRows) {
      const name = (cells[nameIdx] ?? '').trim()
      if (!name || name.length < 3) continue
      const address = addrIdx >= 0 ? (cells[addrIdx] ?? '').trim() : ''

      // If the grid has a usable date column, keep only recent receipts
      if (dateIdx >= 0) {
        const parsed = Date.parse(cells[dateIdx] ?? '')
        if (!Number.isNaN(parsed) && parsed < cutoff) continue
      }

      found++

      const { data: existing } = await db
        .from('businesses')
        .select('id')
        .eq('company_name', name)
        .limit(1)

      if (existing && existing.length > 0) { skipped++; continue }

      const category = classIdx >= 0 ? (cells[classIdx] ?? '').trim() : ''
      const acct = acctIdx >= 0 ? (cells[acctIdx] ?? '').trim() : ''
      const dateVal = dateIdx >= 0 ? (cells[dateIdx] ?? '').trim() : ''

      const { error } = await db.from('businesses').insert({
        company_name: name,
        address: address || null,
        city: 'Tampa',
        state: 'FL',
        county: 'Hillsborough',
        industry: category || null,
        lead_source: 'Business License',
        pitch_angle: 'New Business Package',
        status: 'cold',
        priority: 'medium',
        notes: `Tampa business tax receipt${acct ? ` #${acct}` : ''}${dateVal ? ` | ${dateVal}` : ''}${category ? ` | ${category}` : ''}`,
      })

      if (error) { errors.push(`${name}: ${error.message}`); skipped++ }
      else inserted++
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }

  return { found, inserted, skipped, errors }
}
