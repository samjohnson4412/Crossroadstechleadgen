'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Business, STATUSES, STATUS_LABELS, COUNTIES } from '@/lib/types'
import { TrendingUp, MapPin, Target, Zap } from 'lucide-react'

export default function StatsPage() {
  const [leads, setLeads] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('businesses').select('*').then(({ data }) => { setLeads(data ?? []); setLoading(false) })
  }, [])

  if (loading) return <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>

  const total = leads.length
  const byStatus = STATUSES.map(s => ({ label: STATUS_LABELS[s], status: s, count: leads.filter(l => l.status === s).length }))
  const byCounty = COUNTIES.map(c => ({ county: c, count: leads.filter(l => l.county === c).length })).filter(c => c.count > 0).sort((a, b) => b.count - a.count)
  const byPitch = ['New Business Package','POTS Replacement','ISP Upgrade','Camera / Surveillance','Wi-Fi / Networking','Microsoft 365','Full MSA','Multiple']
    .map(p => ({ pitch: p, count: leads.filter(l => l.pitch_angle === p).length })).filter(p => p.count > 0).sort((a, b) => b.count - a.count)
  const bySource = ['SOS Filing','Building Permit','FCC Lookup','POTS Zone','Referral','Manual','Other']
    .map(s => ({ source: s, count: leads.filter(l => l.lead_source === s).length })).filter(s => s.count > 0).sort((a, b) => b.count - a.count)
  const opportunities = [
    { label: 'POTS Replacement', count: leads.filter(l => l.phone_system === 'POTS').length, icon: '📞' },
    { label: 'No Cameras', count: leads.filter(l => l.has_cameras === false).length, icon: '📷' },
    { label: 'No Managed IT', count: leads.filter(l => l.has_managed_it === false).length, icon: '💻' },
    { label: 'High Priority', count: leads.filter(l => l.priority === 'high').length, icon: '🔥' },
  ]
  const conversionRate = total > 0 ? Math.round((leads.filter(l => ['qualified','transferred'].includes(l.status)).length / total) * 100) : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Stats</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{total} total leads</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard icon={<TrendingUp size={18} />} label="Conversion Rate" value={`${conversionRate}%`} sub="Cold → Qualified" />
        <MetricCard icon={<Target size={18} />} label="Qualified" value={String(leads.filter(l => l.status === 'qualified').length)} sub="Ready for Zoho" />
        <MetricCard icon={<Zap size={18} />} label="Transferred" value={String(leads.filter(l => l.status === 'transferred').length)} sub="In Zoho CRM" />
        <MetricCard icon={<MapPin size={18} />} label="Counties" value={String(byCounty.length)} sub="Areas covered" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Pipeline Status">{byStatus.map(({ label, count }) => <Bar key={label} label={label} count={count} max={total} />)}</ChartCard>
        <ChartCard title="Identified Opportunities">
          {opportunities.map(o => (
            <div key={o.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm flex items-center gap-2">{o.icon} <span style={{ color: 'var(--text)' }}>{o.label}</span></span>
              <span className="font-bold text-sm" style={{ color: o.count > 0 ? 'var(--navy)' : 'var(--text-muted)' }}>{o.count}</span>
            </div>
          ))}
        </ChartCard>
        {byCounty.length > 0 && <ChartCard title="By County">{byCounty.map(({ county, count }) => <Bar key={county} label={county} count={count} max={total} />)}</ChartCard>}
        {byPitch.length > 0 && <ChartCard title="By Pitch Angle">{byPitch.map(({ pitch, count }) => <Bar key={pitch} label={pitch} count={count} max={total} />)}</ChartCard>}
        {bySource.length > 0 && <ChartCard title="By Lead Source">{bySource.map(({ source, count }) => <Bar key={source} label={source} count={count} max={total} />)}</ChartCard>}
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--cyan)' }}>{icon}<span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span></div>
      <div className="text-3xl font-bold" style={{ color: 'var(--navy)' }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--navy)' }}>{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 text-xs shrink-0 truncate" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="flex-1 bg-gray-100 rounded-full h-2"><div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--navy)' }} /></div>
      <div className="w-6 text-xs text-right font-medium" style={{ color: 'var(--navy)' }}>{count}</div>
    </div>
  )
}
