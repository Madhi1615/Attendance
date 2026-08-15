import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { Guard, RateCard } from '../types'

export default function Settings() {
  const { companyId } = useAuth()
  const [guards, setGuards] = useState<Guard[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [guardName, setGuardName] = useState('')
  const [guardPhone, setGuardPhone] = useState('')

  async function reload() {
    if (!companyId || !supabase) return
    const [g, r] = await Promise.all([
      supabase.from('guards').select('*').eq('company_id', companyId).order('name'),
      supabase.from('rate_cards').select('*').eq('company_id', companyId),
    ])
    setGuards((g.data as Guard[]) ?? [])
    setRateCards((r.data as RateCard[]) ?? [])
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function addGuard(e: FormEvent) {
    e.preventDefault()
    if (!companyId || !supabase || !guardName) return
    await supabase.from('guards').insert({ company_id: companyId, name: guardName, phone: guardPhone || null })
    setGuardName('')
    setGuardPhone('')
    reload()
  }

  function portalLink(token: string) {
    return `${window.location.origin}/guard/${token}`
  }

  return (
    <div>
      <h1>
        Einstellungen
        <span className="sub">Mitarbeitende und Tarife.</span>
      </h1>

      <div className="grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
        <div className="card">
          <h3>Mitarbeitende</h3>
          <form onSubmit={addGuard} style={{ marginTop: 12 }}>
            <div className="field">
              <label>Name</label>
              <input required value={guardName} onChange={(e) => setGuardName(e.target.value)} />
            </div>
            <div className="field">
              <label>WhatsApp-Nummer (E.164, z. B. +4915112345678)</label>
              <input value={guardPhone} onChange={(e) => setGuardPhone(e.target.value)} />
            </div>
            <button className="btn btn-primary" type="submit">
              Hinzufügen
            </button>
          </form>

          <div style={{ marginTop: 20 }}>
            {guards.map((g) => (
              <div key={g.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                <strong>{g.name}</strong>
                <div className="muted">{g.phone ?? 'Keine Nummer hinterlegt'}</div>
                <div className="muted" style={{ wordBreak: 'break-all' }}>
                  Persönlicher Link: {portalLink(g.portal_token)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Tarife</h3>
          <p className="muted">Ein Tarif pro Bundesland und Qualifikation. Fehlt einer, kann kein Angebot kalkuliert werden.</p>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Bundesland</th>
                <th>Qualifikation</th>
                <th>€/h</th>
              </tr>
            </thead>
            <tbody>
              {rateCards.map((r) => (
                <tr key={r.id}>
                  <td>{r.federal_state}</td>
                  <td>{r.qualification}</td>
                  <td>{r.hourly_rate.toFixed(2)}</td>
                </tr>
              ))}
              {rateCards.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Noch keine Tarife. Über Supabase → Table editor → rate_cards anlegen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
