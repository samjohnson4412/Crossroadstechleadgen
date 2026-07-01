'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Business, COUNTIES } from '@/lib/types'
import { Upload, CheckCircle, AlertCircle, Download, ArrowLeft } from 'lucide-react'

type Row = Record<string, string>

const COLUMN_MAP: Record<string, keyof Business> = {
  'company name': 'company_name', 'business name': 'company_name', 'company': 'company_name', 'name': 'company_name',
  'address': 'address', 'city': 'city', 'zip': 'zip', 'zip code': 'zip', 'county': 'county',
  'industry': 'industry', 'employees': 'employee_count_estimate', 'employee count': 'employee_count_estimate',
  'contact': 'contact_name', 'contact name': 'contact_name', 'contact person': 'contact_name',
  'title': 'contact_title', 'phone': 'contact_phone', 'phone number': 'contact_phone',
  'email': 'contact_email', 'isp': 'current_isp', 'current isp': 'current_isp',
  'phone system': 'phone_system', 'notes': 'notes', 'lead source': 'lead_source', 'source': 'lead_source',
  'pitch': 'pitch_angle', 'pitch angle': 'pitch_angle',
}

function parseCSV(text: string): Row[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row: Row = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

function mapRow(row: Row): Partial<Business> {
  const out: Partial<Business> = { state: 'FL', status: 'cold', priority: 'medium' }
  for (const [col, val] of Object.entries(row)) {
    const key = COLUMN_MAP[col.toLowerCase().trim()]
    if (key && val) {
      // @ts-expect-error dynamic key assignment
      out[key] = val
    }
  }
  if (!out.county && out.city) {
    const city = out.city.toLowerCase()
    if (['tampa','brandon','plant city','riverview','valrico'].some(c => city.includes(c))) out.county = 'Hillsborough'
    else if (['st pete','saint pete','clearwater','largo','dunedin','pinellas'].some(c => city.includes(c))) out.county = 'Pinellas'
    else if (['wesley chapel','new port richey','zephyrhills','land o lakes'].some(c => city.includes(c))) out.county = 'Pasco'
    else if (['bradenton','palmetto'].some(c => city.includes(c))) out.county = 'Manatee'
    else if (['spring hill'].some(c => city.includes(c))) out.county = 'Hernando'
    else if (['lakeland','winter haven'].some(c => city.includes(c))) out.county = 'Polk'
  }
  return out
}

export default function ImportPage() {
  const [rows, setRows] = useState<Partial<Business>[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: number } | null>(null)
  const [countyOverride, setCountyOverride] = useState('')
  const [sourceOverride, setSourceOverride] = useState('')
  const [pitchOverride, setPitchOverride] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      setRows(parsed.map(mapRow))
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!rows.length) return
    setImporting(true)
    const toInsert = rows.map(r => ({ ...r, county: countyOverride || r.county || null, lead_source: sourceOverride || r.lead_source || null, pitch_angle: pitchOverride || r.pitch_angle || null })).filter(r => r.company_name)
    let imported = 0, errors = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const { error } = await supabase.from('businesses').insert(toInsert.slice(i, i + 50))
      if (error) errors += Math.min(50, toInsert.length - i)
      else imported += Math.min(50, toInsert.length - i)
    }
    setResult({ imported, errors })
    setImporting(false)
    if (imported > 0) setRows([])
  }

  const sel = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'var(--text-muted)' }}><ArrowLeft size={14} /> Dashboard</Link>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Import Leads</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Upload a CSV file to bulk-import leads. The tool auto-maps common column names.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--navy)' }}>Need a template?</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Download a CSV template with all supported columns</p>
        </div>
        <a href="/template.csv" download className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          <Download size={14} /> Template
        </a>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-blue-300 transition-colors" onClick={() => fileRef.current?.click()}>
          <Upload size={28} className="mx-auto mb-3" style={{ color: 'var(--cyan)' }} />
          <p className="font-medium text-sm" style={{ color: 'var(--navy)' }}>{fileName || 'Click to upload a CSV file'}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{rows.length > 0 ? `${rows.filter(r => r.company_name).length} valid rows detected` : 'CSV files only'}</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </div>

        {rows.length > 0 && (
          <div className="mt-6 space-y-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--navy)' }}>Import Options</h3>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Apply county to all</label>
                <select value={countyOverride} onChange={e => setCountyOverride(e.target.value)} className={sel}>
                  <option value="">Auto-detect</option>{COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div><label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Lead source</label>
                <select value={sourceOverride} onChange={e => setSourceOverride(e.target.value)} className={sel}>
                  <option value="">From CSV</option>{['SOS Filing','Building Permit','FCC Lookup','POTS Zone','Referral','Manual','Other'].map(s => <option key={s} value={s}>{s}</option>)}
                </select></div>
              <div><label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Pitch angle</label>
                <select value={pitchOverride} onChange={e => setPitchOverride(e.target.value)} className={sel}>
                  <option value="">From CSV</option>{['New Business Package','POTS Replacement','ISP Upgrade','Camera / Surveillance','Wi-Fi / Networking','Microsoft 365','Full MSA','Multiple'].map(p => <option key={p} value={p}>{p}</option>)}
                </select></div>
            </div>
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Preview (first 3 rows)</p>
              <div className="overflow-x-auto border border-gray-100 rounded-lg text-xs">
                <table className="w-full">
                  <thead style={{ background: 'var(--bg)' }}><tr>{['Company','City','County','Contact','Phone','Source'].map(h => <th key={h} className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-50">{rows.slice(0,3).map((r,i) => <tr key={i}><td className="px-3 py-2 font-medium" style={{ color: 'var(--navy)' }}>{r.company_name||'—'}</td><td className="px-3 py-2">{r.city||'—'}</td><td className="px-3 py-2">{countyOverride||r.county||'—'}</td><td className="px-3 py-2">{r.contact_name||'—'}</td><td className="px-3 py-2">{r.contact_phone||'—'}</td><td className="px-3 py-2">{sourceOverride||r.lead_source||'—'}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <button onClick={handleImport} disabled={importing} className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ background: 'var(--navy)' }}>
              {importing ? 'Importing...' : `Import ${rows.filter(r => r.company_name).length} Leads`}
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className={`p-4 rounded-xl flex items-start gap-3 ${result.errors === 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          {result.errors === 0 ? <CheckCircle size={18} className="text-green-600 shrink-0 mt-0.5" /> : <AlertCircle size={18} className="text-yellow-600 shrink-0 mt-0.5" />}
          <div>
            <p className="font-medium text-sm">{result.imported} leads imported successfully</p>
            {result.errors > 0 && <p className="text-xs mt-0.5 text-yellow-700">{result.errors} rows failed</p>}
            <Link href="/leads" className="text-sm font-medium mt-2 inline-block" style={{ color: 'var(--blue)' }}>View Leads →</Link>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--navy)' }}>Supported Column Names</h3>
        <div className="grid grid-cols-3 gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {Object.keys(COLUMN_MAP).map(col => <span key={col} className="px-2 py-1 bg-gray-50 rounded">{col}</span>)}
        </div>
      </div>
    </div>
  )
}
