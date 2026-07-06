import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { lookupAddressCoverage } from '@/lib/ingest/fcc'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { street, city, state = 'FL', zip, businessId } = body

  if (!street || !city) {
    return NextResponse.json({ error: 'street and city are required' }, { status: 400 })
  }

  try {
    const result = await lookupAddressCoverage(street, city, state, zip)

    if (businessId && result.providers.length > 0) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const db = createClient(supabaseUrl, supabaseKey)

      const topProvider = result.providers.reduce((a, b) =>
        a.max_download_speed > b.max_download_speed ? a : b
      )

      await db.from('businesses').update({
        current_isp: topProvider.brand_name,
        internet_speed: `${topProvider.max_download_speed}Mbps down / ${topProvider.max_upload_speed}Mbps up`,
      }).eq('id', businessId)
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
