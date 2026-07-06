// Tampa building permits via the City of Tampa GeoHub (ArcGIS Open Data).
//
// The county's Accela portal (HillsGovHub) renders its search form with
// JavaScript, so it can't be driven server-side. The City of Tampa instead
// publishes an "Active Residential / Commercial Permits" layer on its public
// ArcGIS REST server — a real JSON API meant for programmatic access:
//   https://city-tampa.opendata.arcgis.com/datasets/active-residential-commercial-permits-1/about
//
// The exact service path can change as the city reorganizes its GeoHub, so we
// discover the permit layer at runtime from the REST services directory and
// read its field list from layer metadata.

import { createClient } from '@supabase/supabase-js'

const ARCGIS_ROOT = 'https://arcgis.tampagov.net/arcgis/rest/services'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Keywords that signal a commercial project worth pitching low-voltage/cameras/networking
const COMMERCIAL_MARKERS = ['COMM', 'TENANT', 'OFFICE', 'RETAIL', 'RESTAURANT', 'WAREHOUSE', 'INDUSTRIAL']

interface ArcgisLayerRef {
  url: string
  name: string
}

interface ArcgisField {
  name: string
  type: string
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': BROWSER_UA },
  })
  if (!res.ok) throw new Error(`ArcGIS returned ${res.status} for ${url}`)
  return res.json()
}

async function findPermitLayer(diag: string[]): Promise<ArcgisLayerRef | null> {
  const root = await fetchJson(`${ARCGIS_ROOT}?f=json`)
  const folders = (root.folders as string[] | undefined) ?? []
  const rootServices = (root.services as { name: string; type: string }[] | undefined) ?? []

  diag.push(`[diag] arcgis root: folders=[${folders.slice(0, 10).join(', ')}], services=${rootServices.length}`)

  // Gather services: root ones plus likely folders (permit/open-data/development flavored first)
  const services: { name: string; type: string }[] = [...rootServices]
  const likelyFolders = folders.sort((a, b) => {
    const score = (f: string) => (/permit|open|develop|construct/i.test(f) ? 0 : 1)
    return score(a) - score(b)
  })
  for (const folder of likelyFolders.slice(0, 6)) {
    try {
      const info = await fetchJson(`${ARCGIS_ROOT}/${folder}?f=json`)
      services.push(...(((info.services as { name: string; type: string }[] | undefined) ?? [])))
    } catch { /* skip unreadable folders */ }
  }

  // Inspect permit-flavored services first, then a few others
  const ordered = services.sort((a, b) => {
    const score = (s: { name: string }) => (/permit/i.test(s.name) ? 0 : 1)
    return score(a) - score(b)
  })

  // Collect ALL permit-named layers, then prefer commercial over residential
  const candidates: (ArcgisLayerRef & { score: number })[] = []
  let inspected = 0
  for (const svc of ordered) {
    if (inspected >= 12) break
    if (svc.type !== 'MapServer' && svc.type !== 'FeatureServer') continue
    inspected++
    try {
      const svcUrl = `${ARCGIS_ROOT}/${svc.name}/${svc.type}`
      const info = await fetchJson(`${svcUrl}?f=json`)
      const layers = (info.layers as { id: number; name: string }[] | undefined) ?? []
      for (const layer of layers) {
        if (!/permit/i.test(layer.name)) continue
        const score = /comm/i.test(layer.name) ? 0
          : /single|resid|family/i.test(layer.name) ? 2
          : 1
        candidates.push({ url: `${svcUrl}/${layer.id}`, name: layer.name, score })
      }
    } catch { /* skip broken services */ }
  }

  if (candidates.length === 0) {
    diag.push(`[diag] no layer named *permit* among ${inspected} inspected services: ${ordered.slice(0, 12).map(s => s.name).join(', ')}`)
    return null
  }

  candidates.sort((a, b) => a.score - b.score)
  diag.push(`[diag] permit layers found: ${candidates.map(c => `"${c.name}"`).join(', ')} — using "${candidates[0].name}" (${candidates[0].url})`)
  return candidates[0]
}

export interface PermitLead {
  permitNumber: string
  permitType: string
  address: string
  description: string
  issueDate: string
}

export async function fetchTampaPermits(daysBack: number): Promise<{ permits: PermitLead[]; diag: string[] }> {
  const diag: string[] = []

  const layer = await findPermitLayer(diag)
  if (!layer) throw new Error('Could not find a permits layer on the Tampa ArcGIS server — see run notes for what was inspected.')

  // Read the layer's field list so we can map columns by name
  const meta = await fetchJson(`${layer.url}?f=json`)
  const fields = ((meta.fields as ArcgisField[] | undefined) ?? [])
  const fieldNames = fields.map(f => f.name)
  diag.push(`[diag] layer fields: ${fieldNames.slice(0, 16).join(', ')}`)

  const findField = (patterns: RegExp[], typeFilter?: string) =>
    fields.find(f =>
      patterns.some(p => p.test(f.name)) && (!typeFilter || f.type === typeFilter)
    )?.name

  const dateField =
    findField([/issue/i], 'esriFieldTypeDate') ??
    findField([/date/i], 'esriFieldTypeDate')
  const numField = findField([/permit.?(no|num)/i, /record/i, /^permit$/i, /number/i])
  const addrField = findField([/address|site_?addr|location/i])
  const typeField = findField([/type|class|category/i])
  const descField = findField([/desc|project|work|name/i])

  diag.push(`[diag] mapped: num=${numField ?? '?'} addr=${addrField ?? '?'} type=${typeField ?? '?'} desc=${descField ?? '?'} date=${dateField ?? '?'}`)

  // Pull the most recent records and filter by date client-side (avoids SQL dialect issues)
  const query = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: '1000',
    f: 'json',
  })
  if (dateField) query.set('orderByFields', `${dateField} DESC`)

  const data = await fetchJson(`${layer.url}/query?${query}`)
  const features = ((data.features as { attributes: Record<string, unknown> }[] | undefined) ?? [])
  diag.push(`[diag] query returned ${features.length} features` +
    (features[0] ? ` | sample: ${JSON.stringify(features[0].attributes).slice(0, 280)}` : ''))

  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000
  const permits: PermitLead[] = []

  for (const feat of features) {
    const a = feat.attributes

    if (dateField) {
      const ts = a[dateField]
      if (typeof ts === 'number' && ts < cutoff) continue
    }

    const typeVal = String(typeField ? a[typeField] ?? '' : '')
    const descVal = String(descField ? a[descField] ?? '' : '')
    const haystack = `${typeVal} ${descVal}`.toUpperCase()
    if (!COMMERCIAL_MARKERS.some(m => haystack.includes(m))) continue

    const address = String(addrField ? a[addrField] ?? '' : '').replace(/\s+/g, ' ').trim()
    const permitNumber = String(numField ? a[numField] ?? '' : '').trim()
    if (!address || !permitNumber) continue

    const ts = dateField ? a[dateField] : null
    const issueDate = typeof ts === 'number' ? new Date(ts).toLocaleDateString('en-US') : ''

    permits.push({ permitNumber, permitType: typeVal, address, description: descVal, issueDate })
  }

  return { permits, diag }
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
    const { permits, diag } = await fetchTampaPermits(daysBack)
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

      const { error } = await db.from('businesses').insert({
        company_name: permit.description
          ? permit.description.slice(0, 120)
          : `Commercial Permit — ${permit.address}`,
        address: permit.address,
        city: 'Tampa',
        state: 'FL',
        county: 'Hillsborough',
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
