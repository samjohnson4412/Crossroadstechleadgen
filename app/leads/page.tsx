'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Business, LeadStatus, LeadPriority, STATUSES, STATUS_LABELS, COUNTIES } from '@/lib/types'
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge'
import { Plus, Search, Phone, Mail, MapPin, SlidersHorizontal } from 'lucide-react'

export default function LeadsPage() {
  const [leads, setLeads] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('')
  const [countyFilter, setCountyFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | ''>('')
  const [showFilters, setShowFilters] = useState(false)

  const load = useCallback(async () => {
    let query = supabase.from('businesses').select('*').order('created_at', { ascending: false })
    if (statusFilter) query = query.eq('status', statusFilter)
    if (countyFilter) query = query.eq('county', countyFilter)
    if (priorityFilter) query = query.eq('priority', priorityFilter)
    const { data } = await query
    setLeads(data ?? [])
    setLoading(false)
  }, [statusFilter, countyFilter, priorityFilter])

  useEffect(() => { load() }, [load])

  const filtered = leads.filter(l =>
    !search ||
    l.company_name.toLowerCase().includes(search.toLowerCase()) ||
    l.city?.toLowerCase().includes(search.toLowerCase()) ||
    l.contact_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Leads</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{filtered.length} {filtered.length === 1 ? 'lead' : 'leads'}</p>
        </div>
        <Link href="/leads/new" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white shadow-sm" style={{ background: 'var(--navy)' }}>
          <Plus size={16} /> Add Lead
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search company, city, contact..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <button onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            style={{ color: showFilters ? 'var(--navy)' : undefined }}>
            <SlidersHorizontal size={15} /> Filters
          </button>
        </div>
        {showFilters && (
          <div className="flex flex-wrap gap-3 pt-1">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as LeadStatus | '')} className={sel}>
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <select value={countyFilter} onChange={e => setCountyFilter(e.target.value)} className={sel}>
              <option value="">All Counties</option>
              {COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as LeadPriority | '')} className={sel}>
              <option value="">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {(statusFilter || countyFilter || priorityFilter) && (
              <button onClick={() => { setStatusFilter(''); setCountyFilter(''); setPriorityFilter('') }}
                className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors" style={{ color: 'var(--danger)' }}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-medium" style={{ color: 'var(--navy)' }}>No leads found</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              {search || statusFilter || countyFilter ? 'Try adjusting your filters' : 'Add your first lead to get started'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Company','Contact','Location','Status','Priority','Pitch'].map((h, i) => (
                  <th key={h} className={`text-left px-4 py-3 font-medium text-xs uppercase tracking-wide ${i === 1 ? 'hidden md:table-cell' : i === 2 || i === 5 ? 'hidden lg:table-cell' : i === 4 ? 'hidden sm:table-cell' : ''}`}
                    style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(lead => (
                <tr key={lead.id} className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => window.location.href = `/leads/${lead.id}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium" style={{ color: 'var(--navy)' }}>{lead.company_name}</div>
                    {lead.lead_source && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{lead.lead_source}</div>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div style={{ color: 'var(--text)' }}>{lead.contact_name ?? '—'}</div>
                    {lead.contact_phone && <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-muted)' }}><Phone size={10} /> {lead.contact_phone}</div>}
                    {lead.contact_email && <div className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><Mail size={10} /> {lead.contact_email}</div>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {lead.city || lead.county ? (
                      <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <MapPin size={11} />{[lead.city, lead.county].filter(Boolean).join(', ')}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><PriorityBadge priority={lead.priority} /></td>
                  <td className="px-4 py-3 hidden lg:table-cell"><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{lead.pitch_angle ?? '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const sel = 'border border-gray-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200'
