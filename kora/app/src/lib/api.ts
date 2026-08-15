import { supabase, functionsBaseUrl } from './supabase'
import type { AvailableGuard, Invoice, Quote } from '../types'

async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase!.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch(`${functionsBaseUrl}/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

export async function calculateQuote(requestId: string, marginPercent: number): Promise<{ quote: Quote }> {
  return authedFetch('quote-calculate', {
    method: 'POST',
    body: JSON.stringify({ request_id: requestId, margin_percent: marginPercent }),
  })
}

export async function fetchAvailableGuards(shiftId: string): Promise<{ guards: AvailableGuard[] }> {
  return authedFetch(`available-guards?shift_id=${shiftId}`)
}

export async function generateInvoice(requestId: string): Promise<{ invoice: Invoice }> {
  return authedFetch('invoice-generate', {
    method: 'POST',
    body: JSON.stringify({ request_id: requestId }),
  })
}

export async function sendWhatsAppToGuard(guardId: string, body: string): Promise<{ sent: boolean }> {
  return authedFetch('whatsapp-outbound', {
    method: 'POST',
    body: JSON.stringify({ guard_id: guardId, body }),
  })
}

export async function notifyProactive(companyId: string, event: string, extra: Record<string, unknown>) {
  return authedFetch('ai-assistant', {
    method: 'POST',
    body: JSON.stringify({ mode: 'proactive', company_id: companyId, event, ...extra }),
  })
}

const employeePortalUrl = `${functionsBaseUrl}/employee-portal`

export async function fetchEmployeePortal(token: string) {
  const res = await fetch(`${employeePortalUrl}?token=${encodeURIComponent(token)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Link not recognised.')
  return json
}

export async function respondToShift(token: string, shiftAssignmentId: string, action: 'accept' | 'decline') {
  const res = await fetch(employeePortalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, shift_assignment_id: shiftAssignmentId, action }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Could not save your answer.')
  return json
}
