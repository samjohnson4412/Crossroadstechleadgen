'use client'
import { useEffect, useState } from 'react'
import { Play, RefreshCw, CheckCircle, XCircle, Clock, Building2, FileText, Wifi, ChevronDown, ChevronUp } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

interface IngestLog {
  id: string
  source: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'success' | 'error'
  records_found: number
  records_inserted: number
  records_skipped: number
  error_message: string | null
  details: { errors?: string[] } | null
}

interface RunResult {
  success: boolean
  found?: number
  inserted?: number
  skipped?: number
  errors?: string[]
  error?: string
}

const SOURCES = [
  {
    id: 'sunbiz',
    label: 'Florida SOS — New Business Filings',
    description: 'Scrapes Sunbiz.org for LLCs and corporations newly registered in Tampa Bay. These are businesses that need everything: VoIP, email, M365, Wi-Fi, cameras.',
    icon: <Building2 size={20} />,
    endpoint: '/api/ingest/sunbiz',
    defaultDays: 30,
    pitch: 'New Business Package',
    color: 'var(--navy)',
  },
  {
    id: 'permits',
    label: 'Hillsborough County Building Permits',
    description: 'Pulls commercial building permits from Hillsborough County. New construction and renovations signal immediate need for low-voltage, cameras, and networking.',
    icon: <FileText size={20} />,
    endpoint: '/api/ingest/permits',
    defaultDays: 30,
    pitch: 'Camera / Surveillance',
    color: 'var(--blue)',
  },
]

export default function DataPage() {
  const [logs, setLogs] = useState<IngestLog[]>([])
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [daysBack, setDaysBack] = useState<Record<string, number>>({})

  async function loadLogs() {
    const res = await fetch('/api/ingest/logs')
    if (res.ok) setLogs(await res.json())
  }

  useEffect(() => { loadLogs() }, [])

  async function runSource(source: typeof SOURCES[0]) {
    setRunning(r => ({ ...r, [source.id]: true }))
    setResults(r => ({ ...r, [source.id]: undefined as unknown as RunResult }))
    try {
      const res = await fetch(source.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: daysBack[source.id] ?? source.defaultDays }),
      })
      const data = await res.json()
      setResults(r => ({ ...r, [source.id]: data }))
      await loadLogs()
    } catch (err) {
      setResults(r => ({ ...r, [source.id]: { success: false, error: String(err) } }))
    } finally {
      setRunning(r => ({ ...r, [source.id]: false }))
    }
  }

  function lastRunForSource(sourceId: string) {
    return logs.find(l => l.source === sourceId)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Data Sources</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Automated lead ingestion from public Tampa Bay data sources</p>
      </div>

      <div className="space-y-4">
        {SOURCES.map(source => {
          const lastRun = lastRunForSource(source.id)
          const result = results[source.id]
          const isRunning = running[source.id]
          return (
            <div key={source.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: source.color }}>{source.icon}</div>
                  <div>
                    <h2 className="font-semibold" style={{ color: 'var(--navy)' }}>{source.label}</h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{source.description}</p>
                    <div className="flex items-center gap-4 mt-3">
                      <span className="text-xs px-2 py-1 rounded-full border border-gray-200" style={{ color: 'var(--text-muted)' }}>Pitch: {source.pitch}</span>
                      {lastRun && (
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                          <Clock size={11} /> Last run: {formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })} · {lastRun.records_inserted} inserted
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-1">
                    <label className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Days back:</label>
                    <input type="number" min={1} max={365} value={daysBack[source.id] ?? source.defaultDays}
                      onChange={e => setDaysBack(d => ({ ...d, [source.id]: Number(e.target.value) }))}
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  </div>
                  <button onClick={() => runSource(source)} disabled={isRunning}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
                    style={{ background: source.color }}>
                    {isRunning ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                    {isRunning ? 'Running...' : 'Run Now'}
                  </button>
                </div>
              </div>
              {result && (
                <div className={`mt-4 p-4 rounded-lg text-sm ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center gap-2 font-medium">
                    {result.success ? <CheckCircle size={15} className="text-green-600" /> : <XCircle size={15} className="text-red-600" />}
                    {result.success
                      ? `Found ${result.found} · Inserted ${result.inserted} new leads · Skipped ${result.skipped} duplicates`
                      : `Error: ${result.error}`}
                  </div>
                  {result.errors && result.errors.length > 0 && (
                    <details className="mt-2"><summary className="cursor-pointer text-xs" style={{ color: 'var(--text-muted)' }}>{result.errors.length} row error(s)</summary>
                      <ul className="mt-1 space-y-1">{result.errors.slice(0, 5).map((e, i) => <li key={i} className="text-xs" style={{ color: 'var(--danger)' }}>{e}</li>)}</ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--cyan)' }}>
              <span style={{ color: 'var(--navy)' }}><Wifi size={20} /></span>
            </div>
            <div>
              <h2 className="font-semibold" style={{ color: 'var(--navy)' }}>FCC Broadband Coverage Lookup</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Check what ISPs serve any lead&apos;s address, identify underserved locations, and auto-populate the current ISP field. Use this on any Lead Detail page.</p>
              <div className="mt-3"><span className="text-xs px-2 py-1 rounded-full border border-gray-200" style={{ color: 'var(--text-muted)' }}>Available on Lead Detail pages</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-semibold mb-3" style={{ color: 'var(--navy)' }}>Automate with Vercel Cron</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Add this to <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">vercel.json</code> to run ingestion automatically on a schedule:</p>
        <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-x-auto">{`{
  "crons": [
    { "path": "/api/ingest/sunbiz", "schedule": "0 8 * * 1" },
    { "path": "/api/ingest/permits", "schedule": "0 9 * * 1" }
  ]
}`}</pre>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Runs both sources every Monday at 8am and 9am. Free on Vercel Hobby plan.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold" style={{ color: 'var(--navy)' }}>Run History</h2>
          <button onClick={loadLogs} className="text-xs flex items-center gap-1" style={{ color: 'var(--blue)' }}><RefreshCw size={12} /> Refresh</button>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>No runs yet. Click Run Now on a source above.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {logs.map(log => (
              <div key={log.id}>
                <div className="flex items-center justify-between py-3 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
                  onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                  <div className="flex items-center gap-3">
                    <StatusIcon status={log.status} />
                    <div>
                      <span className="text-sm font-medium" style={{ color: 'var(--navy)' }}>{SOURCE_LABELS[log.source] ?? log.source}</span>
                      <span className="text-xs ml-3" style={{ color: 'var(--text-muted)' }}>{formatDistanceToNow(new Date(log.started_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {log.status === 'success' && <div className="text-xs flex gap-3" style={{ color: 'var(--text-muted)' }}><span className="text-green-700 font-medium">+{log.records_inserted}</span><span>{log.records_skipped} skipped</span></div>}
                    {log.status === 'error' && <span className="text-xs" style={{ color: 'var(--danger)' }}>Failed</span>}
                    {expandedLog === log.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </div>
                {expandedLog === log.id && (
                  <div className="pb-3 px-2 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <div>Started: {format(new Date(log.started_at), 'MMM d yyyy, h:mm a')}</div>
                    {log.completed_at && <div>Completed: {format(new Date(log.completed_at), 'MMM d yyyy, h:mm a')}</div>}
                    <div>Found: {log.records_found} · Inserted: {log.records_inserted} · Skipped: {log.records_skipped}</div>
                    {log.error_message && <div className="text-red-600">{log.error_message}</div>}
                    {log.details?.errors?.map((e, i) => <div key={i} className="text-red-500">{e}</div>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle size={16} className="text-green-500" />
  if (status === 'error') return <XCircle size={16} className="text-red-500" />
  return <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
}

const SOURCE_LABELS: Record<string, string> = {
  sunbiz: 'Florida SOS — Sunbiz',
  building_permits: 'Hillsborough Building Permits',
}
