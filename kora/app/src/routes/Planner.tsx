import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { calculateQuote, fetchAvailableGuards, notifyProactive } from '../lib/api'
import type { AvailableGuard, Quote, ServiceRequest, Shift, ShiftAssignment } from '../types'

function formatEuro(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value)
}

export default function Planner() {
  const { requestId } = useParams<{ requestId: string }>()
  const { companyId } = useAuth()
  const navigate = useNavigate()

  const [request, setRequest] = useState<ServiceRequest | null>(null)
  const [shift, setShift] = useState<Shift | null>(null)
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [staff, setStaff] = useState<AvailableGuard[]>([])
  const [margin, setMargin] = useState(20)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadPlan = useCallback(async () => {
    if (!requestId || !supabase) return
    const { data: requestRow } = await supabase.from('requests').select('*, clients(name)').eq('id', requestId).maybeSingle()
    if (!requestRow) return
    setRequest(requestRow as ServiceRequest)

    let { data: shiftRow } = await supabase.from('shifts').select('*').eq('request_id', requestId).limit(1).maybeSingle()
    if (!shiftRow) {
      const { data: created } = await supabase
        .from('shifts')
        .insert({
          company_id: requestRow.company_id,
          request_id: requestId,
          starts_at: requestRow.starts_at,
          ends_at: requestRow.ends_at,
          qualification_required: requestRow.qualification_required,
        })
        .select()
        .single()
      shiftRow = created
    }
    setShift(shiftRow as Shift)

    if (shiftRow) {
      const { data: assignmentRows } = await supabase
        .from('shift_assignments')
        .select('*, guards(id, name)')
        .eq('shift_id', shiftRow.id)
        .neq('status', 'declined')
      setAssignments((assignmentRows as ShiftAssignment[]) ?? [])

      const { guards } = await fetchAvailableGuards(shiftRow.id)
      setStaff(guards)
    }
  }, [requestId])

  useEffect(() => {
    loadPlan()
  }, [loadPlan])

  useEffect(() => {
    if (!requestId) return
    const timeout = setTimeout(async () => {
      try {
        const { quote: q } = await calculateQuote(requestId, margin)
        setQuote(q)
      } catch (err) {
        setError((err as Error).message)
      }
    }, 400)
    return () => clearTimeout(timeout)
  }, [requestId, margin])

  const assignedIds = new Set(assignments.map((a) => a.guard_id))
  const unassignedSlots = (request?.guards_required ?? 1) - assignments.length

  async function assignGuard(guardId: string) {
    if (!shift || assignedIds.has(guardId)) return
    setError(null)
    const { error: insertError } = await supabase!.from('shift_assignments').insert({
      shift_id: shift.id,
      guard_id: guardId,
      company_id: shift.company_id,
    })
    if (insertError) {
      setError(insertError.message)
      return
    }
    loadPlan()
  }

  async function removeAssignment(assignmentId: string) {
    await supabase!.from('shift_assignments').delete().eq('id', assignmentId)
    loadPlan()
  }

  async function requestQuotePdf() {
    navigate(`/quotes/${requestId}`)
  }

  async function askForHelp() {
    if (!companyId || !request) return
    setBusy(true)
    try {
      await notifyProactive(companyId, 'unfilled_slots', {
        request_title: request.title,
        shift_date: request.starts_at,
        unfilled_count: unassignedSlots,
        available_count: staff.filter((s) => s.eligible && !assignedIds.has(s.id)).length,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function markExecuted() {
    if (!shift) return
    setBusy(true)
    const hours = (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 3_600_000
    for (const assignment of assignments) {
      await supabase!
        .from('shift_assignments')
        .update({ status: 'confirmed', hours_worked: hours })
        .eq('id', assignment.id)
    }
    await supabase!.from('requests').update({ status: 'executed' }).eq('id', requestId)
    setBusy(false)
    navigate(`/invoices/${requestId}`)
  }

  if (!request || !shift) return <p className="muted">Lädt …</p>

  return (
    <div>
      <h1>
        {request.title}
        <span className="sub">
          {request.location} · {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.starts_at))}
        </span>
      </h1>

      {error && <p className="error-text">{error}</p>}

      <div className="planner-grid" style={{ marginTop: 20 }}>
        <div>
          <h3 style={{ fontSize: 15 }}>Verfügbares Personal</h3>
          <div className="staff-list">
            {staff.map((s) => {
              const assigned = assignedIds.has(s.id)
              return (
                <div
                  key={s.id}
                  className={`staff-card${!s.eligible || assigned ? ' blocked' : ''}`}
                  draggable={s.eligible && !assigned}
                  title={s.reason ?? undefined}
                  onDragStart={(e) => e.dataTransfer.setData('text/guard-id', s.id)}
                  onClick={() => s.eligible && !assigned && assignGuard(s.id)}
                >
                  <span>{s.name}</span>
                  {!s.eligible && <span className="pill pill-danger">Kein Nachweis</span>}
                  {assigned && <span className="pill">Eingeteilt</span>}
                </div>
              )
            })}
            {staff.length === 0 && <p className="muted">Noch keine Mitarbeitenden angelegt (Einstellungen).</p>}
          </div>
        </div>

        <div>
          <div
            className={`shift-slot${dragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const guardId = e.dataTransfer.getData('text/guard-id')
              if (guardId) assignGuard(guardId)
            }}
          >
            <div className="muted">
              {assignments.length} / {request.guards_required} besetzt — Kräfte hier ablegen oder links anklicken
            </div>
            <div style={{ marginTop: 8 }}>
              {assignments.map((a) => (
                <span key={a.id} className="assigned-guard-chip">
                  {a.guards?.name}
                  <button
                    onClick={() => removeAssignment(a.id)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--grey)' }}
                    aria-label="Entfernen"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {unassignedSlots > 0 && (
            <button className="btn btn-secondary" onClick={askForHelp} disabled={busy}>
              KORA soll {unassignedSlots} verfügbare Kraft/Kräfte anfragen
            </button>
          )}

          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 15 }}>Kalkulation</h3>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Marge: {margin}%</label>
              <input type="range" min={0} max={60} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
            </div>
            {quote && (
              <div className="cost-panel">
                <div className="cost-row">
                  <span>Personalkosten</span>
                  <span>{formatEuro(quote.hourly_cost)}</span>
                </div>
                <div className="cost-row">
                  <span>Zuschläge</span>
                  <span>{formatEuro(quote.premiums_cost)}</span>
                </div>
                <div className="cost-row">
                  <span>Marge</span>
                  <span>{formatEuro(quote.total - quote.subtotal)}</span>
                </div>
                <div className="cost-row total">
                  <span>Angebot</span>
                  <span>{formatEuro(quote.total)}</span>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={requestQuotePdf} disabled={!quote}>
                Angebot als PDF
              </button>
              <button className="btn btn-secondary" onClick={markExecuted} disabled={busy || assignments.length === 0}>
                Schicht abschließen → Rechnung
              </button>
            </div>
          </div>

          <p className="muted" style={{ marginTop: 12 }}>
            <Link to={`/invoices/${requestId}`}>Zur Rechnung</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
