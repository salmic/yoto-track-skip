import { YotoClient } from 'yoto-nodejs-client'
import { config, assertYotoConfigured } from '../config.js'
import { getDb } from '../db/index.js'
import type { AuthTokens } from '../types.js'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce.js'
import { formatYotoApiError, reauthMessage } from './permissions.js'

const OAUTH_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'family:library:view',
  'family:devices:view',
  'family:device-status:view',
  'family:devices:control',
  'user:content:manage'
].join(' ')

interface PkceSession {
  state: string
  codeVerifier: string
  expiresAt: number
}

const pkceSessions = new Map<string, PkceSession>()

export class YotoAuthService {
  private client: YotoClient | null = null

  isAuthenticated(): boolean {
    return getDb().getAuthTokens() !== null
  }

  getTokenExpiry(): string | null {
    return getDb().getAuthTokens()?.expiresAt ?? null
  }

  getClient(): YotoClient | null {
    return this.client
  }

  getRedirectUri(): string {
    return `${config.publicBaseUrl}/login`
  }

  async initializeClient(): Promise<YotoClient | null> {
    assertYotoConfigured()
    const tokens = getDb().getAuthTokens()
    if (!tokens) {
      this.client = null
      return null
    }

    this.client = new YotoClient({
      clientId: config.yotoClientId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userAgent: 'YotoTrackSkip/1.0.0',
      onTokenRefresh: async (event) => {
        getDb().saveAuthTokens({
          accessToken: event.updatedAccessToken,
          refreshToken: event.updatedRefreshToken,
          expiresAt: new Date(event.updatedExpiresAt * 1000).toISOString()
        })
      }
    })

    return this.client
  }

  startLogin(): { authUrl: string; state: string } {
    assertYotoConfigured()

    const codeVerifier = generateCodeVerifier()
    const state = generateState()
    const session: PkceSession = {
      state,
      codeVerifier,
      expiresAt: Date.now() + 10 * 60 * 1000
    }

    pkceSessions.set(state, session)

    const authUrl = YotoClient.getAuthorizeUrl({
      audience: 'https://api.yotoplay.com',
      scope: OAUTH_SCOPES,
      responseType: 'code',
      clientId: config.yotoClientId,
      redirectUri: this.getRedirectUri(),
      state,
      codeChallenge: generateCodeChallenge(codeVerifier),
      codeChallengeMethod: 'S256'
    })

    return { authUrl, state }
  }

  async completeLogin(code: string, state: string): Promise<void> {
    assertYotoConfigured()

    const session = pkceSessions.get(state)
    if (!session) {
      throw new Error('Login session expired. Please try again.')
    }

    if (Date.now() > session.expiresAt) {
      pkceSessions.delete(state)
      throw new Error('Login session expired. Please try again.')
    }

    pkceSessions.delete(state)

    const tokens = await YotoClient.exchangeToken({
      grantType: 'authorization_code',
      code,
      clientId: config.yotoClientId,
      clientSecret: config.yotoClientSecret || undefined,
      redirectUri: this.getRedirectUri(),
      codeVerifier: session.codeVerifier,
      audience: 'https://api.yotoplay.com'
    })

    const expiresAt =
      tokens.expires_in != null
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString()

    const stored: AuthTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      expiresAt
    }

    if (!stored.refreshToken) {
      throw new Error('Yoto did not return a refresh token. Ensure offline_access scope is enabled.')
    }

    getDb().saveAuthTokens(stored)
    await this.initializeClient()
  }

  logout(): void {
    getDb().clearAuthTokens()
    this.client = null
    pkceSessions.clear()
  }

  async checkDeviceAccess(): Promise<{ ok: boolean; message?: string }> {
    if (!this.isAuthenticated()) {
      return { ok: false, message: 'Not signed in' }
    }

    const client = await this.initializeClient()
    if (!client) {
      return { ok: false, message: 'Not signed in' }
    }

    try {
      const { devices } = await client.getDevices()
      if (devices.length > 0) {
        await client.getDeviceStatus({ deviceId: devices[0]!.deviceId })
      }
      return { ok: true }
    } catch (error) {
      const message = reauthMessage(formatYotoApiError(error))
      return { ok: false, message }
    }
  }
}

export const authService = new YotoAuthService()

export function formatAuthError(error: unknown): string {
  if (error && typeof error === 'object') {
    const apiError = error as {
      jsonBody?: { error_description?: string; error?: string }
      message?: string
    }
    if (apiError.jsonBody?.error_description) {
      return apiError.jsonBody.error_description
    }
    if (apiError.jsonBody?.error) {
      return apiError.jsonBody.error
    }
    if (apiError.message) {
      return apiError.message
    }
  }

  return error instanceof Error ? error.message : 'Authorization failed'
}
