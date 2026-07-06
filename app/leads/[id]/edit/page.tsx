'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Business } from '@/lib/types'
import LeadForm from '@/components/LeadForm'
import { ArrowLeft } from 'lucide-react'

export default function EditLeadPage() {
  const { id } = useParams<{ id: string }>()
  const [lead, setLead] = useState<Business | null>(null)

  useEffect(() => {
    supabase.from('businesses').select('*').eq('id', id).single().then(({ data }) => setLead(data))
  }, [id])

  if (!lead) return <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href={`/leads/${id}`} className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={14} /> Back to Lead
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Edit Lead</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{lead.company_name}</p>
      </div>
      <LeadForm initial={lead} />
    </div>
  )
}
