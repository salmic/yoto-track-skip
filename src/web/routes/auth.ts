import { Router } from 'express'
import { authService, formatAuthError } from '../../auth/yoto-auth.js'
import { config } from '../../config.js'
import { yotoService, createSkipEngine } from '../../yoto/service.js'

export const authRouter = Router()

authRouter.get('/status', async (_req, res, next) => {
  try {
    const deviceAccess = authService.isAuthenticated()
      ? await authService.checkDeviceAccess()
      : { ok: false as const }

    res.json({
      authenticated: authService.isAuthenticated(),
      expiresAt: authService.getTokenExpiry(),
      yotoConfigured: Boolean(config.yotoClientId),
      serviceRunning: yotoService.isRunning(),
      hasDeviceAccess: deviceAccess.ok,
      needsReauth: authService.isAuthenticated() && !deviceAccess.ok,
      serviceError: yotoService.getLastError() ?? deviceAccess.message ?? null,
      redirectUri: authService.getRedirectUri()
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/login', (_req, res, next) => {
  try {
    const { authUrl, state } = authService.startLogin()
    res.json({ authUrl, state, redirectUri: authService.getRedirectUri() })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/callback', async (req, res, next) => {
  try {
    const code = req.body?.code as string | undefined
    const state = req.body?.state as string | undefined

    if (!code || !state) {
      res.status(400).json({ error: 'code and state are required' })
      return
    }

    await authService.completeLogin(code, state)
    await yotoService.restart(createSkipEngine())

    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: formatAuthError(error) })
  }
})

authRouter.post('/logout', async (_req, res, next) => {
  try {
    await yotoService.stop()
    authService.logout()
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})
