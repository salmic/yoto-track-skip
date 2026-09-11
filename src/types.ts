export interface SkipProfile {
  id: string
  cardId: string
  cardTitle: string
  enabled: boolean
  skipTrackKeys: string[]
  createdAt: string
  updatedAt: string
}

export interface CardTrack {
  trackKey: string
  title: string
  overlayLabel?: string
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

export interface CardSummary {
  cardId: string
  title: string
  chapterCount: number
  trackCount: number
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export interface DeviceInfo {
  deviceId: string
  name: string
  description: string
  deviceType: string
  deviceFamily: string
  online: boolean
}

export interface DeviceStatus extends DeviceInfo {
  mqttConnected: boolean
  batteryLevel?: number
  activeCard?: string
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

export interface PlaybackEvent {
  deviceId: string
  deviceName: string
  cardId: string
  cardTitle?: string
  chapterKey: string
  chapterTitle?: string
  trackKey: string
  trackTitle?: string
  playbackStatus: string
  source?: string
  eventUtc?: number
  cardInserted?: boolean
  positionSec?: number
  trackLengthSec?: number
}

export interface PendingAuthSession {
  sessionId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  intervalMs: number
  expiresAt: number
  status: 'pending' | 'complete' | 'expired' | 'error'
  error?: string
}
