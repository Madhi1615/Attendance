export type Qualification = 'unterrichtung' | 'sachkunde' | 'meister'

export interface Company {
  id: string
  name: string
  whatsapp_dispatcher_phone: string | null
  vat_percent: number
}

export interface Guard {
  id: string
  company_id: string
  name: string
  phone: string | null
  email: string | null
  portal_token: string
  active: boolean
}

export interface Credential {
  id: string
  guard_id: string
  qualification: Qualification
  bewacher_id: string | null
  permitted_deployment: string | null
  registered_at: string | null
  expires_at: string
}

export interface Client {
  id: string
  company_id: string
  name: string
  contact_email: string | null
  contact_phone: string | null
}

export type RequestStatus = 'new' | 'quoted' | 'planned' | 'executed' | 'invoiced' | 'cancelled'

export interface ServiceRequest {
  id: string
  company_id: string
  client_id: string | null
  title: string
  location: string | null
  federal_state: string
  starts_at: string
  ends_at: string
  guards_required: number
  qualification_required: Qualification
  status: RequestStatus
  clients?: { name: string } | null
}

export interface Quote {
  id: string
  request_id: string
  hourly_cost: number
  premiums_cost: number
  margin_percent: number
  subtotal: number
  total: number
  breakdown: Record<string, unknown>
  created_at: string
}

export type AssignmentStatus = 'proposed' | 'accepted' | 'declined' | 'confirmed'

export interface Shift {
  id: string
  company_id: string
  request_id: string
  starts_at: string
  ends_at: string
  qualification_required: Qualification
}

export interface ShiftAssignment {
  id: string
  shift_id: string
  guard_id: string
  status: AssignmentStatus
  hours_worked: number | null
  guards?: { id: string; name: string }
}

export interface RateCard {
  id: string
  company_id: string
  federal_state: string
  qualification: Qualification
  hourly_rate: number
  night_premium_percent: number
  sunday_premium_percent: number
  holiday_premium_percent: number
}

export interface Invoice {
  id: string
  company_id: string
  request_id: string
  invoice_number: string
  line_items: Array<{ guard_name: string; hours: number; hourly_rate: number; amount: number }>
  subtotal: number
  vat_percent: number
  vat_amount: number
  total: number
  audit_record: { client: string | null; entries: unknown[] }
  created_at: string
}

export interface AvailableGuard {
  id: string
  name: string
  phone: string | null
  eligible: boolean
  reason: string | null
}
