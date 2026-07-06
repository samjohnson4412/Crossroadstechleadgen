export type LeadStatus = 'cold' | 'researched' | 'contacted' | 'engaged' | 'qualified' | 'transferred'
export type LeadPriority = 'low' | 'medium' | 'high'
export type PhoneSystem = 'POTS' | 'VoIP' | 'Unknown'
export type OutreachMethod = 'Call' | 'Email' | 'Visit' | 'LinkedIn' | 'Text'
export type OutreachOutcome =
  | 'No Answer'
  | 'Left Voicemail'
  | 'Spoke - Not Interested'
  | 'Spoke - Interested'
  | 'Meeting Scheduled'
  | 'Email Sent'
  | 'Other'

export type LeadSource =
  | 'SOS Filing'
  | 'Building Permit'
  | 'Business License'
  | 'FCC Lookup'
  | 'POTS Zone'
  | 'Referral'
  | 'Manual'
  | 'Other'

export type PitchAngle =
  | 'New Business Package'
  | 'POTS Replacement'
  | 'ISP Upgrade'
  | 'Camera / Surveillance'
  | 'Wi-Fi / Networking'
  | 'Microsoft 365'
  | 'Full MSA'
  | 'Multiple'

export interface Business {
  id: string
  company_name: string
  address: string | null
  city: string | null
  state: string
  zip: string | null
  county: string | null
  employee_count_estimate: string | null
  industry: string | null

  contact_name: string | null
  contact_title: string | null
  contact_phone: string | null
  contact_email: string | null

  current_isp: string | null
  internet_speed: string | null
  phone_system: PhoneSystem | null
  has_cameras: boolean | null
  has_managed_it: boolean | null

  lead_source: LeadSource | null
  pitch_angle: PitchAngle | null
  status: LeadStatus
  priority: LeadPriority
  assigned_to: string | null
  notes: string | null
  zoho_id: string | null

  created_at: string
  updated_at: string
}

export interface OutreachLog {
  id: string
  business_id: string
  contact_date: string
  method: OutreachMethod
  outcome: OutreachOutcome
  contacted_by: string | null
  notes: string | null
  next_follow_up: string | null
  created_at: string
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  cold: 'Cold',
  researched: 'Researched',
  contacted: 'Contacted',
  engaged: 'Engaged',
  qualified: 'Qualified',
  transferred: 'Transferred to Zoho',
}

export const STATUS_COLORS: Record<LeadStatus, string> = {
  cold: 'bg-gray-100 text-gray-700',
  researched: 'bg-blue-100 text-blue-800',
  contacted: 'bg-yellow-100 text-yellow-800',
  engaged: 'bg-orange-100 text-orange-800',
  qualified: 'bg-green-100 text-green-800',
  transferred: 'bg-purple-100 text-purple-800',
}

export const PRIORITY_COLORS: Record<LeadPriority, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-red-100 text-red-700',
}

export const STATUSES: LeadStatus[] = [
  'cold',
  'researched',
  'contacted',
  'engaged',
  'qualified',
  'transferred',
]

export const COUNTIES = [
  'Hillsborough',
  'Pinellas',
  'Pasco',
  'Hernando',
  'Manatee',
  'Polk',
  'Sarasota',
  'Other',
]
