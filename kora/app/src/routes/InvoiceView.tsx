import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { generateInvoice, notifyProactive } from '../lib/api'
import { downloadInvoicePdf } from '../lib/pdf'
import type { Invoice } from '../types'

function formatEuro(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value)
}

export default function InvoiceView() {
  const { requestId } = useParams<{ requestId: string }>()
  const { companyId, companyName } = useAuth()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!requestId || !supabase) return
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setInvoice(data as Invoice)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  async function handleGenerate() {
    if (!requestId) return
    setBusy(true)
    setError(null)
    try {
      const { invoice: created } = await generateInvoice(requestId)
      setInvoice(created)
      if (companyId) {
        await notifyProactive(companyId, 'invoice_ready', { invoice_id: created.id }).catch(() => {})
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>
        Rechnung
        <span className="sub">Aus dem ausgeführten Dienstplan, mit Nachweis.</span>
      </h1>

      {!invoice && (
        <div className="card" style={{ marginTop: 20, maxWidth: 480 }}>
          <p className="muted">Noch keine Rechnung erzeugt.</p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" onClick={handleGenerate} disabled={busy}>
            {busy ? 'Wird erzeugt …' : 'Rechnung erzeugen'}
          </button>
        </div>
      )}

      {invoice && (
        <div className="card" style={{ marginTop: 20, maxWidth: 600 }}>
          <h3>Rechnung {invoice.invoice_number}</h3>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Kraft</th>
                <th>Stunden</th>
                <th>Satz</th>
                <th>Betrag</th>
              </tr>
            </thead>
            <tbody>
              {invoice.line_items.map((item, i) => (
                <tr key={i}>
                  <td>{item.guard_name}</td>
                  <td>{item.hours.toFixed(2)}</td>
                  <td>{formatEuro(item.hourly_rate)}</td>
                  <td>{formatEuro(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="cost-panel" style={{ marginTop: 16 }}>
            <div className="cost-row">
              <span>Zwischensumme</span>
              <span>{formatEuro(invoice.subtotal)}</span>
            </div>
            <div className="cost-row">
              <span>USt. ({invoice.vat_percent}%)</span>
              <span>{formatEuro(invoice.vat_amount)}</span>
            </div>
            <div className="cost-row total">
              <span>Gesamt</span>
              <span>{formatEuro(invoice.total)}</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => downloadInvoicePdf(companyName ?? 'KORA', invoice)}>
            Als PDF herunterladen
          </button>

          <details style={{ marginTop: 16 }}>
            <summary className="muted">Nachweis (Prüfprotokoll)</summary>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 8 }}>{JSON.stringify(invoice.audit_record, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  )
}
