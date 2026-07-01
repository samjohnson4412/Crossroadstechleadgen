'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Business, OutreachLog, OutreachMethod, OutreachOutcome, STATUS_LABELS } from '@/lib/types'
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge'
import {
  ArrowLeft, Pencil, Phone, Mail, MapPin, Building2,
  Wifi, PhoneCall, Camera, Monitor, Plus, Trash2, ExternalLink,
  RefreshCw, CheckCircle, AlertTriangle, Signal
} from 'lucide-react'
import { format } from 'date-fns'

interface FccResult {
  success: boolean
  providers?: string[]
  hasHighSpeed?: boolean
  underserved?: boolean
  fastestDownload?: number
  summary?: string
  error?: string
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [lead, setLead] = useState<Business | null>(null)
  const [logs, setLogs] = useState<OutreachLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showLogForm, setShowLogForm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [fccLoading, setFccLoading] = useState(false)
  const [fccResult, setFccResult] = useState<FccResult | null>(null)

  async function load() {
    const [{ data: biz }, { data: outreach }] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', id).single(),
      supabase.from('outreach_log').select('*').eq('business_id', id).order('contact_date', { ascending: false }),
    ])
    setLead(biz)
    setLogs(outreach ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function handleStatusChange(status: string) {
    await supabase.from('businesses').update({ status }).eq('id', id)
    setLead(l => l ? { ...l, status: status as Business['status'] } : l)
  }

  async function handleDelete() {
    if (!confirm('Delete this lead? This cannot be undone.')) return
    setDeleting(true)
    await supabase.from('businesses').delete().eq('id', id)
    router.push('/leads')
  }

  async function runFccLookup() {
    if (!lead) return
    setFccLoading(true)
    setFccResult(null)
    try {
      const res = await fetch('/api/ingest/fcc-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: lead.address ?? '',
          city: lead.city ?? '',
          state: lead.state ?? 'FL',
          zip: lead.zip ?? '',
          businessId: id,
        }),
      })
      const data = await res.json()
      setFccResult(data)
      if (data.success) load()
    } catch (err) {
      setFccResult({ success: false, error: String(err) })
    } finally {
      setFccLoading(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>
  if (!lead) return <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Lead not found.</div>

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/leads/${id}/edit`}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            <Pencil size={13} /> Edit
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ color: 'var(--danger)', border: '1px solid #fecaca' }}
          >
            <Trash2 size={13} /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--navy)' }}>{lead.company_name}</h1>
            {lead.industry && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{lead.industry}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <StatusBadge status={lead.status} />
              <PriorityBadge priority={lead.priority} />
              {lead.pitch_angle && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-gray-200" style={{ color: 'var(--text-muted)' }}>
                  {lead.pitch_angle}
                </span>
              )}
            </div>
          </div>
          {/* Quick status update */}
          <div className="shrink-0">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Move to</label>
            <select
              value={lead.status}
              onChange={e => handleStatusChange(e.target.value)}
              className="border border-gray-200 rounded-lg text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
              style={{ color: 'var(--navy)' }}
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Contact + location */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-5 pt-5 border-t border-gray-50 text-sm">
          {lead.contact_name && (
            <InfoRow icon={<Building2 size={14} />} label="Contact" value={`${lead.contact_name}${lead.contact_title ? ` · ${lead.contact_title}` : ''}`} />
          )}
          {lead.contact_phone && (
            <InfoRow icon={<Phone size={14} />} label="Phone" value={lead.contact_phone} href={`tel:${lead.contact_phone}`} />
          )}
          {lead.contact_email && (
            <InfoRow icon={<Mail size={14} />} label="Email" value={lead.contact_email} href={`mailto:${lead.contact_email}`} />
          )}
          {(lead.city || lead.county) && (
            <InfoRow icon={<MapPin size={14} />} label="Location"
              value={[lead.address, lead.city, lead.county ? `${lead.county} Co.` : null, lead.zip].filter(Boolean).join(', ')} />
          )}
          {lead.employee_count_estimate && (
            <InfoRow icon={<Building2 size={14} />} label="Employees" value={lead.employee_count_estimate} />
          )}
          {lead.lead_source && (
            <InfoRow icon={<ExternalLink size={14} />} label="Source" value={lead.lead_source} />
          )}
          {lead.assigned_to && (
            <InfoRow icon={<Building2 size={14} />} label="Assigned To" value={lead.assigned_to} />
          )}
        </div>
      </div>

      {/* Services intel */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--navy)' }}>
            Current Services Intel
          </h2>
          {(lead.address || lead.city) && (
            <button
              onClick={runFccLookup}
              disabled={fccLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-60"
              style={{ borderColor: 'var(--cyan)', color: 'var(--navy)' }}
            >
              {fccLoading ? <RefreshCw size={13} className="animate-spin" /> : <Signal size={13} />}
              {fccLoading ? 'Checking...' : 'Check FCC Coverage'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <IntelCard
            icon={<Wifi size={18} />}
            label="Internet"
            value={lead.current_isp ?? 'Unknown'}
            sub={lead.internet_speed ?? undefined}
            highlight={!lead.current_isp}
          />
          <IntelCard
            icon={<PhoneCall size={18} />}
            label="Phone System"
            value={lead.phone_system ?? 'Unknown'}
            highlight={lead.phone_system === 'POTS'}
            highlightLabel={lead.phone_system === 'POTS' ? 'POTS — Opportunity!' : undefined}
          />
          <IntelCard
            icon={<Camera size={18} />}
            label="Cameras"
            value={lead.has_cameras === null ? 'Unknown' : lead.has_cameras ? 'Yes' : 'No'}
            highlight={lead.has_cameras === false}
            highlightLabel={lead.has_cameras === false ? 'No cameras — Opportunity!' : undefined}
          />
          <IntelCard
            icon={<Monitor size={18} />}
            label="Managed IT"
            value={lead.has_managed_it === null ? 'Unknown' : lead.has_managed_it ? 'Yes' : 'No'}
            highlight={lead.has_managed_it === false}
            highlightLabel={lead.has_managed_it === false ? 'No MSP — Opportunity!' : undefined}
          />
        </div>

        {/* FCC lookup result */}
        {fccResult && (
          <div className={`mt-4 p-4 rounded-lg text-sm border ${fccResult.success ? (fccResult.underserved ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200') : 'bg-red-50 border-red-200'}`}>
            {fccResult.success ? (
              <>
                <div className="flex items-center gap-2 font-medium mb-2">
                  {fccResult.underserved
                    ? <AlertTriangle size={15} className="text-orange-500" />
                    : <CheckCircle size={15} className="text-green-600" />}
                  <span style={{ color: fccResult.underserved ? '#b45309' : '#15803d' }}>
                    {fccResult.underserved ? 'Underserved area — ISP opportunity!' : 'Broadband available'}
                  </span>
                </div>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{fccResult.summary}</p>
                {fccResult.providers && fccResult.providers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {fccResult.providers.map((p, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white border border-gray-200" style={{ color: 'var(--text)' }}>{p}</span>
                    ))}
                  </div>
                )}
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  ISP and speed fields updated on this lead.
                </p>
              </>
            ) : (
              <div className="flex items-center gap-2" style={{ color: 'var(--danger)' }}>
                <AlertTriangle size={15} />
                {fccResult.error ?? 'FCC lookup failed — address may not be specific enough.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      {lead.notes && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="font-semibold text-sm uppercase tracking-wide mb-3" style={{ color: 'var(--navy)' }}>Notes</h2>
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{lead.notes}</p>
        </div>
      )}

      {/* Outreach log */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--navy)' }}>
            Outreach History ({logs.length})
          </h2>
          <button
            onClick={() => setShowLogForm(f => !f)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--cyan)', color: 'var(--navy)' }}
          >
            <Plus size={14} /> Log Activity
          </button>
        </div>

        {showLogForm && (
          <OutreachForm
            businessId={id}
            onSaved={() => { setShowLogForm(false); load() }}
            onCancel={() => setShowLogForm(false)}
          />
        )}

        {logs.length === 0 && !showLogForm ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
            No outreach logged yet. Click &quot;Log Activity&quot; to record your first contact.
          </p>
        ) : (
          <div className="space-y-3 mt-2">
            {logs.map(log => (
              <div key={log.id} className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--navy)', color: 'white' }}>
                      {log.method}
                    </span>
                    <span className="text-xs font-medium" style={{ color: outcomeColor(log.outcome) }}>
                      {log.outcome}
                    </span>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(log.contact_date), 'MMM d, yyyy')}
                    {log.contacted_by && ` · ${log.contacted_by}`}
                  </div>
                </div>
                {log.notes && (
                  <p className="text-sm mt-2" style={{ color: 'var(--text)' }}>{log.notes}</p>
                )}
                {log.next_follow_up && (
                  <p className="text-xs mt-2 font-medium" style={{ color: 'var(--blue)' }}>
                    Follow up: {format(new Date(log.next_follow_up), 'MMM d, yyyy')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OutreachForm({ businessId, onSaved, onCancel }: { businessId: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    contact_date: new Date().toISOString().split('T')[0],
    method: 'Call' as OutreachMethod,
    outcome: 'No Answer' as OutreachOutcome,
    contacted_by: '',
    notes: '',
    next_follow_up: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('outreach_log').insert({
      business_id: businessId,
      ...form,
      contacted_by: form.contacted_by || null,
      notes: form.notes || null,
      next_follow_up: form.next_follow_up || null,
    })
    onSaved()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3 border border-gray-200">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Date</label>
          <input type="date" required value={form.contact_date} onChange={e => setForm(f => ({ ...f, contact_date: e.target.value }))} className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Contacted By</label>
          <input type="text" value={form.contacted_by} onChange={e => setForm(f => ({ ...f, contacted_by: e.target.value }))} className={inp} placeholder="Sam..." />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Method</label>
          <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value as OutreachMethod }))} className={inp}>
            {(['Call','Email','Visit','LinkedIn','Text'] as OutreachMethod[]).map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Outcome</label>
          <select value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value as OutreachOutcome }))} className={inp}>
            {(['No Answer','Left Voicemail','Spoke - Not Interested','Spoke - Interested','Meeting Scheduled','Email Sent','Other'] as OutreachOutcome[]).map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Notes</label>
        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inp + ' resize-none'} placeholder="What happened? Any useful info?" />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Follow-up Date</label>
        <input type="date" value={form.next_follow_up} onChange={e => setForm(f => ({ ...f, next_follow_up: e.target.value }))} className={inp} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ background: 'var(--navy)' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-gray-200 hover:bg-white transition-colors">Cancel</button>
      </div>
    </form>
  )
}

function InfoRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--cyan)' }}>{icon}</span>
      <div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
        {href ? (
          <a href={href} className="text-sm font-medium hover:underline" style={{ color: 'var(--blue)' }}>{value}</a>
        ) : (
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>{value}</div>
        )}
      </div>
    </div>
  )
}

function IntelCard({ icon, label, value, sub, highlight, highlightLabel }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean; highlightLabel?: string
}) {
  return (
    <div className={`rounded-lg p-3 border ${highlight ? 'border-orange-200 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center gap-1.5 mb-1" style={{ color: highlight ? 'var(--warning)' : 'var(--navy)' }}>
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-sm font-semibold" style={{ color: highlight ? '#b45309' : 'var(--text)' }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
      {highlightLabel && <div className="text-xs mt-1 font-medium" style={{ color: '#b45309' }}>{highlightLabel}</div>}
    </div>
  )
}

function outcomeColor(outcome: string) {
  if (outcome.includes('Interested') && !outcome.includes('Not')) return 'var(--success)'
  if (outcome.includes('Not Interested')) return 'var(--danger)'
  if (outcome === 'Meeting Scheduled') return 'var(--blue)'
  return 'var(--text-muted)'
}
