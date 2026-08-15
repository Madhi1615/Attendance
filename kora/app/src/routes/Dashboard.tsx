import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { ServiceRequest } from '../types'

const STATUS_LABEL: Record<string, string> = {
  new: 'Neu',
  quoted: 'Angebot erstellt',
  planned: 'Geplant',
  executed: 'Ausgeführt',
  invoiced: 'Abgerechnet',
  cancelled: 'Storniert',
}

export default function Dashboard() {
  const { companyId } = useAuth()
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId || !supabase) return
    supabase
      .from('requests')
      .select('*, clients(name)')
      .eq('company_id', companyId)
      .order('starts_at', { ascending: true })
      .then(({ data }) => {
        setRequests((data as ServiceRequest[]) ?? [])
        setLoading(false)
      })
  }, [companyId])

  return (
    <div>
      <h1>
        Dienstplan
        <span className="sub">Alle Anfragen auf einen Blick.</span>
      </h1>

      <div style={{ marginTop: 20 }}>
        {loading && <p className="muted">Lädt …</p>}
        {!loading && requests.length === 0 && (
          <div className="card">
            <p className="muted">Noch keine Anfragen. Leg die erste unter „Neue Anfrage“ an.</p>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map((r) => (
            <Link key={r.id} to={`/planner/${r.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{r.title}</strong>
                  <div className="muted">
                    {r.clients?.name ?? 'Kein Kunde hinterlegt'} · {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.starts_at))}
                  </div>
                </div>
                <span className="pill">{STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
