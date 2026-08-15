import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchEmployeePortal, respondToShift } from '../lib/api'

interface PortalData {
  guard: { name: string }
  credentials: Array<{ qualification: string; expires_at: string; permitted_deployment: string | null }>
  hours_this_month: number
  shifts: Array<{ id: string; status: string; shifts: { starts_at: string; ends_at: string; qualification_required: string } }>
}

const QUALIFICATION_LABEL: Record<string, string> = {
  unterrichtung: 'Unterrichtung (§ 34a)',
  sachkunde: 'Sachkunde § 34a',
  meister: 'Meister für Schutz und Sicherheit',
}

export default function EmployeePortal() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!token) return
    try {
      const result = await fetchEmployeePortal(token)
      setData(result)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function respond(shiftAssignmentId: string, action: 'accept' | 'decline') {
    if (!token) return
    await respondToShift(token, shiftAssignmentId, action)
    load()
  }

  if (error) {
    return (
      <div className="center-screen">
        <div className="card">
          <p className="error-text">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return <p className="muted" style={{ padding: 20 }}>Lädt …</p>

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="app-shell">
      <h1>
        Hallo {data.guard.name}
        <span className="sub">Dein Nachweis, deine Stunden, deine Schichten.</span>
      </h1>

      <div className="grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ fontSize: 15 }}>Nachweis</h3>
          {data.credentials.map((c, i) => {
            const expired = c.expires_at < today
            return (
              <div key={i} style={{ padding: '10px 0', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
                <div>{QUALIFICATION_LABEL[c.qualification] ?? c.qualification}</div>
                <span className={`pill ${expired ? 'pill-danger' : ''}`}>Gültig bis {c.expires_at}</span>
              </div>
            )
          })}
          {data.credentials.length === 0 && <p className="muted">Kein Nachweis hinterlegt.</p>}
        </div>

        <div className="card">
          <h3 style={{ fontSize: 15 }}>Stunden diesen Monat</h3>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '8px 0' }}>{data.hours_this_month.toFixed(1)} h</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 15 }}>Angebotene Schichten</h3>
        {data.shifts.map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div>
              <div>{new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s.shifts.starts_at))}</div>
              <span className="pill">{s.status}</span>
            </div>
            {s.status === 'proposed' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => respond(s.id, 'accept')}>
                  Annehmen
                </button>
                <button className="btn btn-secondary" onClick={() => respond(s.id, 'decline')}>
                  Ablehnen
                </button>
              </div>
            )}
          </div>
        ))}
        {data.shifts.length === 0 && <p className="muted">Aktuell keine angebotenen Schichten.</p>}
      </div>
    </div>
  )
}
