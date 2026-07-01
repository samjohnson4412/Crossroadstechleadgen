import Link from 'next/link'
import LeadForm from '@/components/LeadForm'
import { ArrowLeft } from 'lucide-react'

export default function NewLeadPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={14} /> Back to Leads
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Add New Lead</h1>
      </div>
      <LeadForm />
    </div>
  )
}
