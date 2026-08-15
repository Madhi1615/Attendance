import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function Login() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const message = await signIn(email, password)
    setSubmitting(false)
    if (message) setError(message)
  }

  return (
    <div className="center-screen">
      <div className="card">
        <div className="brand-mark" style={{ marginBottom: 16 }}>
          <span />
        </div>
        <h2>Anmelden</h2>
        <p className="muted" style={{ marginBottom: 20 }}>
          Dienstplan, Nachweis, Angebot und Rechnung an einem Ort.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">E-Mail</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
            {submitting ? 'Einen Moment …' : 'Anmelden'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          Neuer Betrieb? Ein Konto wird in Supabase Authentication angelegt — siehe kora/README.md.
        </p>
      </div>
    </div>
  )
}
