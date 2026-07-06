import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runPermitIngest } from '@/lib/ingest/permits'

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const db = createClient(supabaseUrl, supabaseKey)

  const body = await req.json().catch(() => ({}))
  const daysBack: number = body.daysBack ?? 30

  const { data: log } = await db.from('ingest_logs').insert({
    source: 'building_permits',
    status: 'running',
  }).select().single()

  const logId = log?.id

  try {
    const result = await runPermitIngest(supabaseUrl, supabaseKey, daysBack)

    await db.from('ingest_logs').update({
      status: 'success',
      completed_at: new Date().toISOString(),
      records_found: result.found,
      records_inserted: result.inserted,
      records_skipped: result.skipped,
      details: { errors: result.errors.slice(0, 20) },
    }).eq('id', logId)

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.from('ingest_logs').update({
      status: 'error',
      completed_at: new Date().toISOString(),
      error_message: message,
    }).eq('id', logId)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
