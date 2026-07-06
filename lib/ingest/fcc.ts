// Address verification + FCC broadband map jump-off.
//
// The FCC's per-address availability API is not publicly documented (the
// official BDC API is bulk-download only and needs an account token), so
// instead we use two documented, no-auth federal APIs:
//   1. Census Bureau geocoder — verifies/normalizes the address, returns lat/lon
//   2. FCC Area API (geo.fcc.gov) — county + census block for that point
// and hand the user a direct link into the FCC National Broadband Map to
// read the provider list there.

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
const FCC_AREA_API = 'https://geo.fcc.gov/api/census/area'

export interface FccLookupResult {
  matched: boolean
  matchedAddress: string | null
  county: string | null
  lat: number | null
  lon: number | null
  mapUrl: string | null
  summary: string
}

interface CensusMatch {
  matchedAddress: string
  coordinates: { x: number; y: number }
}

export async function lookupAddress(
  street: string,
  city: string,
  state = 'FL',
  zip?: string
): Promise<FccLookupResult> {
  const oneLine = [street, city, state, zip].filter(Boolean).join(', ')
  const params = new URLSearchParams({
    address: oneLine,
    benchmark: 'Public_AR_Current',
    format: 'json',
  })

  const res = await fetch(`${CENSUS_GEOCODER}?${params}`, {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Census geocoder returned ${res.status}`)

  const data = await res.json()
  const matches: CensusMatch[] = data?.result?.addressMatches ?? []

  if (!matches.length) {
    return {
      matched: false,
      matchedAddress: null,
      county: null,
      lat: null,
      lon: null,
      mapUrl: null,
      summary: `No match for "${oneLine}" — check the street address and ZIP`,
    }
  }

  const match = matches[0]
  const lat = match.coordinates.y
  const lon = match.coordinates.x

  // County lookup is best-effort — don't fail the whole request over it
  let county: string | null = null
  try {
    const areaRes = await fetch(`${FCC_AREA_API}?lat=${lat}&lon=${lon}&format=json`, {
      headers: { 'Accept': 'application/json' },
    })
    if (areaRes.ok) {
      const area = await areaRes.json()
      county = area?.results?.[0]?.county_name ?? null
    }
  } catch { /* non-fatal */ }

  return {
    matched: true,
    matchedAddress: match.matchedAddress,
    county,
    lat,
    lon,
    mapUrl: `https://broadbandmap.fcc.gov/home?zoom=15&vlat=${lat}&vlon=${lon}`,
    summary: `Verified: ${match.matchedAddress}${county ? ` (${county} County)` : ''}`,
  }
}
