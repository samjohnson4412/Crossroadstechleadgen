'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Business, COUNTIES, LeadStatus, LeadPriority, LeadSource, PitchAngle, PhoneSystem } from '@/lib/types'

type FormData = Omit<Business, 'id' | 'created_at' | 'updated_at'>

const EMPTY: FormData = {
  company_name: '', address: null, city: null, state: 'FL', zip: null, county: null,
  employee_count_estimate: null, industry: null, contact_name: null, contact_title: null,
  contact_phone: null, contact_email: null, current_isp: null, internet_speed: null,
  phone_system: null, has_cameras: null, has_managed_it: null, lead_source: null,
  pitch_angle: null, status: 'cold', priority: 'medium', assigned_to: null, notes: null, zoho_id: null,
}

export default function LeadForm({ initial }: { initial?: Business }) {
  const router = useRouter()
  const [form, setForm] = useState<FormData>(initial ? { ...initial } : EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(f => ({ ...f, [key]: value || null }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (initial?.id) {
        const { error } = await supabase.from('businesses').update(form).eq('id', initial.id)
        if (error) throw error
        router.push(`/leads/${initial.id}`)
      } else {
        const { data, error } = await supabase.from('businesses').insert(form).select().single()
        if (error) throw error
        router.push(`/leads/${data.id}`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && <div className="p-4 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">{error}</div>}

      <Section title="Company Info">
        <Field label="Company Name" required>
          <input required type="text" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className={inp} placeholder="Acme Plumbing LLC" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Industry"><input type="text" value={form.industry ?? ''} onChange={e => set('industry', e.target.value as never)} className={inp} placeholder="Plumbing, Retail, Medical..." /></Field>
          <Field label="Employee Count">
            <select value={form.employee_count_estimate ?? ''} onChange={e => set('employee_count_estimate', e.target.value as never)} className={inp}>
              <option value="">Unknown</option><option value="1-10">1–10</option><option value="10-50">10–50</option><option value="50-150">50–150</option><option value="150-300">150–300</option>
            </select>
          </Field>
        </div>
        <Field label="Address"><input type="text" value={form.address ?? ''} onChange={e => set('address', e.target.value as never)} className={inp} placeholder="123 Main St" /></Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="City"><input type="text" value={form.city ?? ''} onChange={e => set('city', e.target.value as never)} className={inp} placeholder="Tampa" /></Field>
          <Field label="County">
            <select value={form.county ?? ''} onChange={e => set('county', e.target.value as never)} className={inp}>
              <option value="">Select county</option>{COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="ZIP"><input type="text" value={form.zip ?? ''} onChange={e => set('zip', e.target.value as never)} className={inp} placeholder="33601" maxLength={5} /></Field>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contact Name"><input type="text" value={form.contact_name ?? ''} onChange={e => set('contact_name', e.target.value as never)} className={inp} placeholder="Jane Smith" /></Field>
          <Field label="Title"><input type="text" value={form.contact_title ?? ''} onChange={e => set('contact_title', e.target.value as never)} className={inp} placeholder="Owner, Office Manager..." /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone"><input type="tel" value={form.contact_phone ?? ''} onChange={e => set('contact_phone', e.target.value as never)} className={inp} placeholder="(813) 555-0100" /></Field>
          <Field label="Email"><input type="email" value={form.contact_email ?? ''} onChange={e => set('contact_email', e.target.value as never)} className={inp} placeholder="jane@acme.com" /></Field>
        </div>
      </Section>

      <Section title="Current Services (Intel)">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Current ISP"><input type="text" value={form.current_isp ?? ''} onChange={e => set('current_isp', e.target.value as never)} className={inp} placeholder="Spectrum, AT&T, Comcast..." /></Field>
          <Field label="Internet Speed"><input type="text" value={form.internet_speed ?? ''} onChange={e => set('internet_speed', e.target.value as never)} className={inp} placeholder="100Mbps, unknown..." /></Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Phone System">
            <select value={form.phone_system ?? ''} onChange={e => set('phone_system', e.target.value as PhoneSystem)} className={inp}>
              <option value="">Unknown</option><option value="POTS">POTS (Copper)</option><option value="VoIP">VoIP</option>
            </select>
          </Field>
          <Field label="Has Security Cameras?">
            <select value={form.has_cameras === null ? '' : String(form.has_cameras)} onChange={e => set('has_cameras', e.target.value === '' ? null : e.target.value === 'true')} className={inp}>
              <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
            </select>
          </Field>
          <Field label="Has Managed IT?">
            <select value={form.has_managed_it === null ? '' : String(form.has_managed_it)} onChange={e => set('has_managed_it', e.target.value === '' ? null : e.target.value === 'true')} className={inp}>
              <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Pipeline">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Lead Source">
            <select value={form.lead_source ?? ''} onChange={e => set('lead_source', e.target.value as LeadSource)} className={inp}>
              <option value="">Select source</option>{(['SOS Filing','Building Permit','FCC Lookup','POTS Zone','Referral','Manual','Other'] as LeadSource[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Pitch Angle">
            <select value={form.pitch_angle ?? ''} onChange={e => set('pitch_angle', e.target.value as PitchAngle)} className={inp}>
              <option value="">Select pitch</option>{(['New Business Package','POTS Replacement','ISP Upgrade','Camera / Surveillance','Wi-Fi / Networking','Microsoft 365','Full MSA','Multiple'] as PitchAngle[]).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value as LeadStatus)} className={inp}>
              <option value="cold">Cold</option><option value="researched">Researched</option><option value="contacted">Contacted</option>
              <option value="engaged">Engaged</option><option value="qualified">Qualified</option><option value="transferred">Transferred to Zoho</option>
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={e => set('priority', e.target.value as LeadPriority)} className={inp}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </Field>
        </div>
        <Field label="Assigned To"><input type="text" value={form.assigned_to ?? ''} onChange={e => set('assigned_to', e.target.value as never)} className={inp} placeholder="Sam, Alex..." /></Field>
        <Field label="Notes"><textarea rows={4} value={form.notes ?? ''} onChange={e => set('notes', e.target.value as never)} className={inp + ' resize-none'} placeholder="Any context, observations, or background on this lead..." /></Field>
      </Section>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ background: 'var(--navy)' }}>
          {saving ? 'Saving...' : initial ? 'Save Changes' : 'Add Lead'}
        </button>
        <button type="button" onClick={() => router.back()} className="px-6 py-2.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50 transition-colors">Cancel</button>
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
      <h3 className="font-semibold text-sm uppercase tracking-wide" style={{ color: 'var(--navy)' }}>{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white'
