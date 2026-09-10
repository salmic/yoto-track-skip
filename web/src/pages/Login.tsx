import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'

interface LoginProps {
  onAuthenticated: () => Promise<unknown>
  yotoConfigured: boolean
}

export function Login({ onAuthenticated, yotoConfigured }: LoginProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<'idle' | 'redirecting' | 'completing' | 'complete' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [redirectUri, setRedirectUri] = useState<string | null>(null)

  useEffect(() => {
    void api.getAuthStatus().then((auth) => setRedirectUri(auth.redirectUri ?? null))
  }, [])

  useEffect(() => {
    const oauthError = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')
    if (oauthError) {
      setStatus('error')
      setError(errorDescription ?? oauthError)
      setSearchParams({}, { replace: true })
      return
    }

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (!code || !state) return

    setStatus('completing')
    setSearchParams({}, { replace: true })

    void api
      .completeLogin(code, state)
      .then(async () => {
        setStatus('complete')
        await onAuthenticated()
        navigate('/')
      })
      .catch((callbackError) => {
        setStatus('error')
        setError(callbackError instanceof Error ? callbackError.message : 'Login failed')
      })
  }, [navigate, onAuthenticated, searchParams, setSearchParams])

  const startLogin = async () => {
    setError(null)
    setStatus('redirecting')
    try {
      const { authUrl } = await api.startLogin()
      window.location.href = authUrl
    } catch (loginError) {
      setStatus('error')
      setError(loginError instanceof Error ? loginError.message : 'Could not start login')
    }
  }

  if (!yotoConfigured) {
    return (
      <div className="card">
        <h2>Setup required</h2>
        <p>
          Add your <code>YOTO_CLIENT_ID</code> to a <code>.env</code> file in the project root, then restart
          the server. Register an app at{' '}
          <a href="https://yoto.dev/" target="_blank" rel="noreferrer">
            yoto.dev
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Connect Yoto Account</h2>
      <p className="muted">
        Sign in with your Yoto account so this service can monitor playback and skip configured tracks.
        If cards or tracks are missing, log out and sign in again to refresh permissions.
      </p>

      {redirectUri ? (
        <p className="muted">
          Redirect URI: <code>{redirectUri}</code> — add this in your Yoto developer app settings.
        </p>
      ) : null}

      {status === 'completing' ? (
        <p>Completing sign-in…</p>
      ) : (
        <button type="button" onClick={() => void startLogin()} disabled={status === 'redirecting'}>
          {status === 'redirecting' ? 'Redirecting…' : 'Connect Yoto Account'}
        </button>
      )}

      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
