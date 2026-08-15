import { jsPDF } from 'jspdf'
import type { Invoice, Quote, ServiceRequest } from '../types'

function formatEuro(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value)
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

function baseDocument(companyName: string, title: string) {
  const doc = new jsPDF()
  doc.setFontSize(10)
  doc.setTextColor(138, 138, 138)
  doc.text(companyName, 20, 18)
  doc.setFontSize(22)
  doc.setTextColor(10, 10, 10)
  doc.text(title, 20, 32)
  doc.setDrawColor(228, 228, 224)
  doc.line(20, 38, 190, 38)
  return doc
}

export function downloadQuotePdf(companyName: string, request: ServiceRequest, quote: Quote) {
  const doc = baseDocument(companyName, 'Angebot')

  let y = 52
  doc.setFontSize(11)
  doc.setTextColor(10, 10, 10)
  doc.text(request.title, 20, y)
  y += 8
  doc.setTextColor(138, 138, 138)
  doc.text(`${request.location ?? ''} · ${request.federal_state}`, 20, y)
  y += 6
  doc.text(`${formatDate(request.starts_at)} – ${formatDate(request.ends_at)}`, 20, y)
  y += 6
  doc.text(`${request.guards_required} Kräfte · Qualifikation: ${request.qualification_required}`, 20, y)

  y += 16
  doc.setTextColor(10, 10, 10)
  doc.setFontSize(13)
  doc.text('Kalkulation', 20, y)
  y += 10
  doc.setFontSize(11)
  doc.setTextColor(50, 50, 50)

  const rows: [string, string][] = [
    ['Personalkosten', formatEuro(quote.hourly_cost)],
    ['Zuschläge (Nacht/Sonntag/Feiertag)', formatEuro(quote.premiums_cost)],
    ['Zwischensumme', formatEuro(quote.subtotal)],
    [`Marge (${quote.margin_percent}%)`, formatEuro(quote.total - quote.subtotal)],
  ]
  for (const [label, value] of rows) {
    doc.text(label, 20, y)
    doc.text(value, 190, y, { align: 'right' })
    y += 8
  }

  y += 4
  doc.setDrawColor(228, 228, 224)
  doc.line(20, y, 190, y)
  y += 10
  doc.setFontSize(15)
  doc.setTextColor(10, 10, 10)
  doc.text('Gesamt (netto)', 20, y)
  doc.text(formatEuro(quote.total), 190, y, { align: 'right' })

  doc.setFontSize(9)
  doc.setTextColor(138, 138, 138)
  doc.text('Alle Preise netto zzgl. gesetzlicher USt.', 20, 280)

  doc.save(`Angebot-${request.title.replace(/\s+/g, '-')}.pdf`)
}

export function downloadInvoicePdf(companyName: string, invoice: Invoice) {
  const doc = baseDocument(companyName, `Rechnung ${invoice.invoice_number}`)

  let y = 52
  doc.setFontSize(11)
  doc.setTextColor(10, 10, 10)
  if (invoice.audit_record.client) {
    doc.text(`Kunde: ${invoice.audit_record.client}`, 20, y)
    y += 10
  }

  doc.setFontSize(9)
  doc.setTextColor(138, 138, 138)
  doc.text('Kraft', 20, y)
  doc.text('Stunden', 120, y)
  doc.text('Satz', 145, y)
  doc.text('Betrag', 190, y, { align: 'right' })
  y += 6
  doc.setDrawColor(228, 228, 224)
  doc.line(20, y, 190, y)
  y += 8

  doc.setFontSize(10)
  doc.setTextColor(10, 10, 10)
  for (const item of invoice.line_items) {
    doc.text(item.guard_name, 20, y)
    doc.text(item.hours.toFixed(2), 120, y)
    doc.text(formatEuro(item.hourly_rate), 145, y)
    doc.text(formatEuro(item.amount), 190, y, { align: 'right' })
    y += 8
    if (y > 260) {
      doc.addPage()
      y = 20
    }
  }

  y += 6
  doc.line(20, y, 190, y)
  y += 10

  const totals: [string, string][] = [
    ['Zwischensumme (netto)', formatEuro(invoice.subtotal)],
    [`USt. (${invoice.vat_percent}%)`, formatEuro(invoice.vat_amount)],
  ]
  doc.setFontSize(11)
  for (const [label, value] of totals) {
    doc.text(label, 130, y)
    doc.text(value, 190, y, { align: 'right' })
    y += 8
  }
  y += 4
  doc.setFontSize(15)
  doc.text('Gesamt', 130, y)
  doc.text(formatEuro(invoice.total), 190, y, { align: 'right' })

  doc.setFontSize(9)
  doc.setTextColor(138, 138, 138)
  doc.text('Nachweis (Prüfprotokoll) im Dashboard hinterlegt.', 20, 285)

  doc.save(`Rechnung-${invoice.invoice_number}.pdf`)
}
