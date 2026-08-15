import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { downloadQuotePdf } from '../lib/pdf'
import type { Quote, ServiceRequest } from '../types'

function formatEuro(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value)
}

export default function QuoteView() {
  const { requestId } = useParams<{ requestId: string }>()
  const { companyName } = useAuth()
  const [request, setRequest] = useState<ServiceRequest | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)

  useEffect(() => {
    if (!requestId || !supabase) return
    supabase.from('requests').select('*, clients(name)').eq('id', requestId).maybeSingle().then(({ data }) => setRequest(data as ServiceRequest))
    supabase
      .from('quotes')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setQuote(data as Quote))
  }, [requestId])

  if (!request || !quote) return <p className="muted">Noch kein Angebot berechnet — im Dienstplan die Marge einstellen.</p>

  return (
    <div>
      <h1>
        Angebot
        <span className="sub">{request.title}</span>
      </h1>
      <div className="card" style={{ marginTop: 20, maxWidth: 480 }}>
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
            <span>Marge ({quote.margin_percent}%)</span>
            <span>{formatEuro(quote.total - quote.subtotal)}</span>
          </div>
          <div className="cost-row total">
            <span>Gesamt (netto)</span>
            <span>{formatEuro(quote.total)}</span>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => downloadQuotePdf(companyName ?? 'KORA', request, quote)}>
          Als PDF herunterladen
        </button>
      </div>
    </div>
  )
}
