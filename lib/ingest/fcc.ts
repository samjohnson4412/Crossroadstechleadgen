const FCC_API = 'https://broadbandmap.fcc.gov/api/public/map'

export interface FccLocation {
  location_id: string
  address: string
  city: string
  state: string
  zip: string
  latitude: number
  longitude: number
}

export interface FccProvider {
  provider_id: string
  brand_name: string
  technology: string
  max_download_speed: number
  max_upload_speed: number
  low_latency: boolean
}

export interface FccCoverageResult {
  location: FccLocation | null
  providers: FccProvider[]
  hasHighSpeed: boolean
  underserved: boolean
  providerCount: number
  fastestDownload: number
  summary: string
}

export async function lookupAddressCoverage(
  street: string,
  city: string,
  state = 'FL',
  zip?: string
): Promise<FccCoverageResult> {
  const locationParams = new URLSearchParams({
    street_address: street,
    city,
    state,
    zip: zip ?? '',
    unit: '',
    limit: '1',
    offset: '0',
  })

  const locationRes = await fetch(`${FCC_API}/location/search?${locationParams}`, {
    headers: { 'Accept': 'application/json' },
  })

  if (!locationRes.ok) throw new Error(`FCC location lookup failed: ${locationRes.status}`)

  const locationData = await locationRes.json()
  const locations: FccLocation[] = locationData?.results ?? []

  if (!locations.length) {
    return { location: null, providers: [], hasHighSpeed: false, underserved: true, providerCount: 0, fastestDownload: 0, summary: 'Address not found in FCC database' }
  }

  const location = locations[0]

  const availParams = new URLSearchParams({
    location_id: location.location_id,
    unit_id: '',
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    category: 'Fixed Broadband',
  })

  const availRes = await fetch(`${FCC_API}/listAvailability?${availParams}`, {
    headers: { 'Accept': 'application/json' },
  })

  if (!availRes.ok) throw new Error(`FCC availability lookup failed: ${availRes.status}`)

  const availData = await availRes.json()
  const providers: FccProvider[] = (availData?.results ?? []).map((r: Record<string, unknown>) => ({
    provider_id: r.provider_id as string,
    brand_name: r.brand_name as string,
    technology: technologyName(r.technology as number),
    max_download_speed: (r.max_advertised_download_speed as number) ?? 0,
    max_upload_speed: (r.max_advertised_upload_speed as number) ?? 0,
    low_latency: (r.low_latency as boolean) ?? false,
  }))

  const fastestDownload = Math.max(0, ...providers.map(p => p.max_download_speed))
  const hasHighSpeed = fastestDownload >= 100
  const underserved = providers.length <= 1 || fastestDownload < 25

  return {
    location,
    providers,
    hasHighSpeed,
    underserved,
    providerCount: providers.length,
    fastestDownload,
    summary: buildSummary(providers, fastestDownload, underserved),
  }
}

function buildSummary(providers: FccProvider[], fastest: number, underserved: boolean): string {
  if (!providers.length) return 'No ISPs on record for this address'
  const names = [...new Set(providers.map(p => p.brand_name))].slice(0, 3).join(', ')
  const speed = fastest >= 1000 ? `${fastest / 1000}Gbps` : `${fastest}Mbps`
  const flag = underserved ? ' ⚠️ UNDERSERVED — Sales opportunity' : ''
  return `${providers.length} provider(s): ${names} | Fastest: ${speed}${flag}`
}

function technologyName(code: number): string {
  const map: Record<number, string> = {
    10: 'DSL', 11: 'DSL', 12: 'DSL', 20: 'DSL', 30: 'DSL',
    40: 'Cable', 41: 'Cable', 42: 'Cable', 43: 'Cable', 50: 'Fiber',
    60: 'Satellite', 61: 'Satellite', 70: 'Fixed Wireless', 71: 'Fixed Wireless',
    72: 'Fixed Wireless', 300: 'Licensed Fixed Wireless', 400: 'Licensed Fixed Wireless',
  }
  return map[code] ?? `Technology ${code}`
}
