import type { ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import { isSupabaseConfigured } from './lib/supabase'
import Login from './routes/Login'
import Dashboard from './routes/Dashboard'
import NewRequest from './routes/NewRequest'
import Planner from './routes/Planner'
import QuoteView from './routes/QuoteView'
import InvoiceView from './routes/InvoiceView'
import EmployeePortal from './routes/EmployeePortal'
import Subprocessors from './routes/Subprocessors'
import Settings from './routes/Settings'

function ConfigWarning() {
  return (
    <div className="center-screen">
      <div className="card">
        <h2>KORA ist noch nicht verbunden</h2>
        <p className="muted">
          Es fehlen <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code>. Siehe
          kora/README.md für die Einrichtung.
        </p>
      </div>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function Shell({ children }: { children: ReactNode }) {
  const { session, companyName, signOut } = useAuth()
  return (
    <>
      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark">
            <span />
          </div>
          KORA
          {companyName && <span className="muted">· {companyName}</span>}
        </div>
        {session && (
          <nav>
            <NavLink to="/" end>
              Dienstplan
            </NavLink>
            <NavLink to="/requests/new">Neue Anfrage</NavLink>
            <NavLink to="/settings">Einstellungen</NavLink>
            <a role="button" onClick={() => signOut()}>
              Abmelden
            </a>
          </nav>
        )}
      </header>
      <main className="app-shell">{children}</main>
    </>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigWarning />

  return (
    <Routes>
      <Route path="/guard/:token" element={<EmployeePortal />} />
      <Route path="/legal/subprocessors" element={<Subprocessors />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/requests/new" element={<NewRequest />} />
                <Route path="/planner/:requestId" element={<Planner />} />
                <Route path="/quotes/:requestId" element={<QuoteView />} />
                <Route path="/invoices/:requestId" element={<InvoiceView />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Shell>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
