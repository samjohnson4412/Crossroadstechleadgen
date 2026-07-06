import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runSunbizIngest } from '@/lib/ingest/sunbiz'

// SFTP download + parse can take a while — use the max allowed on Hobby
export const maxDuration = 60

async function runIngest(daysBack: number) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const db = createClient(supabaseUrl, supabaseKey)

  const { data: log } = await db.from('ingest_logs').insert({
    source: 'sunbiz',
    status: 'running',
  }).select().single()

  const logId = log?.id

  try {
    const result = await runSunbizIngest(supabaseUrl, supabaseKey, daysBack)

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  return runIngest(body.daysBack ?? 7)
}

// Vercel Cron invokes with GET — cover the week since the last Monday run
export async function GET() {
  return runIngest(8)
}
