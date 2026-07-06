'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Business, STATUSES, STATUS_LABELS } from '@/lib/types'
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge'
import { Users, TrendingUp, AlertCircle, Calendar, ArrowRight, Phone } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Stats {
  total: number
  byStatus: Record<string, number>
  highPriority: number
  followUpsToday: number
  recentLeads: Business[]
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const [{ data: businesses }, { data: followUps }] = await Promise.all([
        supabase.from('businesses').select('*').order('created_at', { ascending: false }),
        supabase.from('outreach_log').select('business_id').eq('next_follow_up', today),
      ])

      if (!businesses) return

      const byStatus: Record<string, number> = {}
      STATUSES.forEach(s => (byStatus[s] = 0))
      businesses.forEach(b => { byStatus[b.status] = (byStatus[b.status] || 0) + 1 })

      setStats({
        total: businesses.length,
        byStatus,
        highPriority: businesses.filter(b => b.priority === 'high').length,
        followUpsToday: followUps?.length ?? 0,
        recentLeads: businesses.slice(0, 5),
      })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <LoadingSkeleton />

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>
          Lead Pipeline
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Tampa Bay Area · Florida
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Leads" value={stats?.total ?? 0} icon={<Users size={20} />} color="var(--navy)" />
        <StatCard label="High Priority" value={stats?.highPriority ?? 0} icon={<AlertCircle size={20} />} color="var(--danger)" />
        <StatCard label="Follow-Ups Today" value={stats?.followUpsToday ?? 0} icon={<Calendar size={20} />} color="var(--warning)" />
        <StatCard label="Qualified" value={stats?.byStatus['qualified'] ?? 0} icon={<TrendingUp size={20} />} color="var(--success)" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--navy)' }}>Pipeline Overview</h2>
        <div className="space-y-3">
          {STATUSES.map(status => {
            const count = stats?.byStatus[status] ?? 0
            const max = stats?.total || 1
            const pct = Math.round((count / max) * 100)
            return (
              <div key={status} className="flex items-center gap-3">
                <div className="w-32 text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {STATUS_LABELS[status]}
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{ width: `${pct}%`, background: status === 'transferred' ? 'var(--cyan)' : 'var(--navy)' }}
                  />
                </div>
                <div className="w-8 text-sm text-right font-medium" style={{ color: 'var(--navy)' }}>{count}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold" style={{ color: 'var(--navy)' }}>Recent Leads</h2>
          <Link href="/leads" className="text-sm flex items-center gap-1 font-medium" style={{ color: 'var(--blue)' }}>
            View all <ArrowRight size={14} />
          </Link>
        </div>
        {!stats?.recentLeads.length ? (
          <EmptyState />
        ) : (
          <div className="divide-y divide-gray-50">
            {stats.recentLeads.map(lead => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate" style={{ color: 'var(--text)' }}>{lead.company_name}</div>
                  <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                    {lead.city && <span>{lead.city}</span>}
                    {lead.contact_phone && (
                      <span className="flex items-center gap-1"><Phone size={10} /> {lead.contact_phone}</span>
                    )}
                    <span>{formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <PriorityBadge priority={lead.priority} />
                  <StatusBadge status={lead.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="text-3xl font-bold" style={{ color }}>{value}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-10">
      <div className="text-4xl mb-3">📋</div>
      <p className="font-medium" style={{ color: 'var(--navy)' }}>No leads yet</p>
      <p className="text-sm mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>Import a CSV or add your first lead manually</p>
      <div className="flex justify-center gap-3">
        <Link href="/import" className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--navy)' }}>Import CSV</Link>
        <Link href="/leads/new" className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--cyan)', color: 'var(--navy)' }}>Add Lead</Link>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-48 bg-gray-200 rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl h-24 border border-gray-100" />)}
      </div>
      <div className="bg-white rounded-xl h-64 border border-gray-100" />
    </div>
  )
}
