// Tampa business tax receipts (business licenses) via the city's ArcGIS server.
//
// Every business operating in the City of Tampa holds a business tax receipt,
// published in the BusinessTax folder on arcgis.tampagov.net. Recently issued
// receipts = businesses that just opened or moved — prime prospects for
// internet, VoIP, cameras, and managed IT.
//
// Layer names/fields aren't documented, so we discover them at runtime and
// report what we find in the run diagnostics.

import { createClient } from '@supabase/supabase-js'
import { normalizeCity } from './sunbiz'

const ARCGIS_ROOT = 'https://arcgis.tampagov.net/arcgis/rest/services'
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

async function findBusinessTaxLayer(diag: string[]): Promise<{ url: string; name: string } | null> {
  const folderInfo = await fetchJson(`${ARCGIS_ROOT}/BusinessTax?f=json`)
  const services = (folderInfo.services as { name: string; type: string }[] | undefined) ?? []
  diag.push(`[diag] BusinessTax folder services: ${services.map(s => `${s.name} (${s.type})`).join(', ') || 'none'}`)

  for (const svc of services) {
    if (svc.type !== 'MapServer' && svc.type !== 'FeatureServer') continue
    try {
      const svcUrl = `${ARCGIS_ROOT}/${svc.name}/${svc.type}`
      const info = await fetchJson(`${svcUrl}?f=json`)
      const layers = (info.layers as { id: number; name: string }[] | undefined) ?? []
      diag.push(`[diag] ${svc.name} layers: ${layers.map(l => `${l.id}:"${l.name}"`).join(', ') || 'none'}`)
      if (layers.length === 0) continue
      // Prefer a receipts/licenses layer; otherwise take the first
      const layer =
        layers.find(l => /receipt|license|business/i.test(l.name)) ?? layers[0]
      return { url: `${svcUrl}/${layer.id}`, name: layer.name }
    } catch { /* try next service */ }
  }
  return null
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
    const layer = await findBusinessTaxLayer(errors)
    if (!layer) throw new Error('No usable layer found in the BusinessTax folder — see run notes.')

    const meta = await fetchJson(`${layer.url}?f=json`)
    const fields = ((meta.fields as ArcgisField[] | undefined) ?? [])
    errors.push(`[diag] layer "${layer.name}" fields: ${fields.map(f => f.name).slice(0, 20).join(', ')}`)

    const findField = (patterns: RegExp[], typeFilter?: string) =>
      fields.find(f =>
        patterns.some(p => p.test(f.name)) && (!typeFilter || f.type === typeFilter)
      )?.name

    const nameField = findField([/business.?name/i, /^dba/i, /company/i, /^name$/i, /owner/i])
    const addrField = findField([/address|location|site/i])
    const categoryField = findField([/class|categor|type|naics|descript|activity/i])
    const dateField =
      findField([/issue/i], 'esriFieldTypeDate') ??
      findField([/open|start|effective/i], 'esriFieldTypeDate') ??
      findField([/date/i], 'esriFieldTypeDate')
    const cityField = findField([/city/i])
    const zipField = findField([/zip/i])

    errors.push(`[diag] mapped: name=${nameField ?? '?'} addr=${addrField ?? '?'} category=${categoryField ?? '?'} date=${dateField ?? '?'} city=${cityField ?? '?'} zip=${zipField ?? '?'}`)

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
    errors.push(`[diag] query returned ${features.length} features` +
      (features[0] ? ` | sample: ${JSON.stringify(features[0].attributes).slice(0, 280)}` : ''))

    if (!nameField || !addrField) {
      throw new Error('Could not identify business name / address fields — see the field list in run notes.')
    }

    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000

    for (const feat of features) {
      const a = feat.attributes

      if (dateField) {
        const ts = a[dateField]
        if (typeof ts === 'number' && ts < cutoff) continue
      }

      const name = String(a[nameField] ?? '').replace(/\s+/g, ' ').trim()
      const address = String(a[addrField] ?? '').replace(/\s+/g, ' ').trim()
      if (!name || name.length < 3 || !address) continue

      found++

      const { data: existing } = await db
        .from('businesses')
        .select('id')
        .eq('company_name', name)
        .limit(1)

      if (existing && existing.length > 0) { skipped++; continue }

      const category = categoryField ? String(a[categoryField] ?? '').trim() : ''
      const ts = dateField ? a[dateField] : null
      const issued = typeof ts === 'number' ? new Date(ts).toLocaleDateString('en-US') : ''
      const city = cityField ? String(a[cityField] ?? '').trim() : ''
      const zip = zipField ? String(a[zipField] ?? '').trim().slice(0, 5) : null

      const { error } = await db.from('businesses').insert({
        company_name: name,
        address,
        city: city ? toTitleCase(normalizeCity(city)) : 'Tampa',
        state: 'FL',
        zip: zip || null,
        county: 'Hillsborough',
        industry: category || null,
        lead_source: 'Business License',
        pitch_angle: 'New Business Package',
        status: 'cold',
        priority: 'medium',
        notes: `Tampa business tax receipt${issued ? ` issued ${issued}` : ''}${category ? ` | Category: ${category}` : ''}`,
      })

      if (error) { errors.push(`${name}: ${error.message}`); skipped++ }
      else inserted++
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }

  return { found, inserted, skipped, errors }
}

function toTitleCase(s: string) {
  return s.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
