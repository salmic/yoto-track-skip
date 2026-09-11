import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api, type AuthStatus } from './api'
import { CardEditor } from './pages/CardEditor'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [authBanner, setAuthBanner] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const refreshAuth = useCallback(async () => {
    const status = await api.getAuthStatus()
    setAuth(status)
    setAuthBanner(status.needsReauth ? status.serviceError ?? null : null)
    return status
  }, [])

  useEffect(() => {
    refreshAuth()
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [refreshAuth])

  const handleLogout = async () => {
    await api.logout()
    await refreshAuth()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="layout">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div className="layout">
      <header>
        <div>
          <h1>Yoto Track Skip</h1>
          <p className="muted">Pre-set tracks to skip on your Yoto cards</p>
        </div>
        {auth?.authenticated ? (
          <div className="actions">
            <Link to="/">
              <button className="secondary" type="button">
                Dashboard
              </button>
            </Link>
            <button className="secondary" type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        ) : null}
      </header>

      {authBanner ? (
        <div className="card" style={{ borderColor: '#c0392b', marginBottom: '1rem' }}>
          <p className="error" style={{ margin: 0 }}>
            {authBanner}
          </p>
        </div>
      ) : null}

      <Routes>
        <Route
          path="/login"
          element={
            auth?.authenticated ? (
              <Navigate to="/" replace />
            ) : (
              <Login onAuthenticated={refreshAuth} yotoConfigured={auth?.yotoConfigured ?? false} />
            )
          }
        />
        <Route
          path="/"
          element={
            auth?.authenticated ? (
              <Dashboard onRefreshAuth={refreshAuth} serviceRunning={auth.serviceRunning} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/cards/:cardId"
          element={
            auth?.authenticated ? <CardEditor /> : <Navigate to="/login" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
