import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { lookupAddress } from '@/lib/ingest/fcc'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { street, city, state = 'FL', zip, businessId } = body

  if (!street || !city) {
    return NextResponse.json({ success: false, error: 'street and city are required' }, { status: 400 })
  }

  try {
    const result = await lookupAddress(street, city, state, zip)

    // Fill in the county on the lead if we learned it and it was missing
    if (businessId && result.matched && result.county) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const db = createClient(supabaseUrl, supabaseKey)

      const { data: lead } = await db.from('businesses').select('county').eq('id', businessId).single()
      if (lead && !lead.county) {
        await db.from('businesses').update({ county: result.county }).eq('id', businessId)
      }
    }

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
