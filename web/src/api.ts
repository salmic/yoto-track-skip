export interface AuthStatus {
  authenticated: boolean
  expiresAt: string | null
  yotoConfigured: boolean
  serviceRunning: boolean
  hasDeviceAccess?: boolean
  needsReauth?: boolean
  serviceError?: string | null
  redirectUri?: string
}

export interface LoginStart {
  authUrl: string
  state: string
  redirectUri: string
}

export interface DeviceStatus {
  deviceId: string
  name: string
  description: string
  deviceType: string
  deviceFamily: string
  online: boolean
  mqttConnected: boolean
  batteryLevel?: number
  activeCard?: string
}

export interface CardSummary {
  cardId: string
  title: string
  chapterCount: number
  trackCount: number
}

export interface CardTrack {
  trackKey: string
  title: string
  durationSec?: number
}

export interface CardChapter {
  chapterKey: string
  title: string
  tracks: CardTrack[]
}

export interface CardContent {
  cardId: string
  title: string
  chapters: CardChapter[]
}

export interface SkipProfile {
  id: string
  cardId: string
  cardTitle: string
  enabled: boolean
  skipTrackKeys: string[]
  createdAt: string
  updatedAt: string
}

export interface ActivityEntry {
  id: string
  timestamp: string
  deviceId: string
  deviceName: string
  cardId: string
  cardTitle: string
  skippedTrackKey: string
  skippedTrackTitle: string
  jumpedToTrackKey: string
  jumpedToTrackTitle: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }

  return response.json() as Promise<T>
}

export const api = {
  getAuthStatus: () => request<AuthStatus>('/api/auth/status'),
  startLogin: () => request<LoginStart>('/api/auth/login', { method: 'POST' }),
  completeLogin: (code: string, state: string) =>
    request<{ ok: boolean }>('/api/auth/callback', {
      method: 'POST',
      body: JSON.stringify({ code, state })
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  getDevices: () => request<{ devices: DeviceStatus[]; error?: string }>('/api/devices'),
  getCards: () => request<{ cards: CardSummary[] }>('/api/cards'),
  getCardContent: (cardId: string, refresh = false) =>
    request<CardContent>(`/api/cards/${cardId}/content${refresh ? '?refresh=true' : ''}`),
  getProfiles: () => request<{ profiles: SkipProfile[] }>('/api/profiles'),
  saveProfile: (cardId: string, body: { cardTitle: string; skipTrackKeys: string[]; enabled?: boolean }) =>
    request<{ profile: SkipProfile; preview: { trackKey: string; title: string } | null }>(
      `/api/profiles/${cardId}`,
      { method: 'PUT', body: JSON.stringify(body) }
    ),
  toggleProfile: (cardId: string, enabled: boolean) =>
    request<{ profile: SkipProfile }>(`/api/profiles/${cardId}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled })
    }),
  deleteProfile: (cardId: string) =>
    request<{ ok: boolean }>(`/api/profiles/${cardId}`, { method: 'DELETE' }),
  getActivity: () => request<{ activity: ActivityEntry[] }>('/api/activity')
}
