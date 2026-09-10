import { config } from '../config.js'
import type { AppDatabase } from '../db/index.js'
import { findTrackTitle } from '../yoto/content.js'
import type { CardContent, PlaybackEvent } from '../types.js'
import {
  findFirstAllowedTrack,
  findNextAllowedTrack,
  shouldSkipTrack
} from './navigator.js'

export interface SkipAction {
  cardId: string
  chapterKey: string
  trackKey: string
  skippedTrackKey: string
  skippedTrackTitle: string
  jumpedToTrackTitle: string
}

export interface SkipEngineDeps {
  getCardContent: (cardId: string) => Promise<CardContent | null>
  onSkip: (deviceId: string, action: SkipAction) => Promise<void>
  onStop?: (deviceId: string, cardId: string) => Promise<void>
  log?: (message: string) => void
}

interface SessionState {
  lastTrackKey?: string
  lastEventAt?: number
  autoSkipCount: number
}

export class SkipEngine {
  private readonly sessions = new Map<string, SessionState>()

  constructor(
    private readonly db: AppDatabase,
    private readonly deps: SkipEngineDeps
  ) {}

  resetSession(deviceId: string, cardId: string): void {
    this.sessions.delete(this.sessionKey(deviceId, cardId))
  }

  async handlePlayback(event: PlaybackEvent): Promise<void> {
    if (!event.cardId || !event.trackKey) return
    if (event.playbackStatus !== 'playing') return

    const profile = this.db.getProfile(event.cardId)
    if (!profile?.enabled || profile.skipTrackKeys.length === 0) return

    const content = await this.deps.getCardContent(event.cardId)
    if (!content) {
      this.deps.log?.(`No card content for ${event.cardId}, skipping auto-skip`)
      return
    }

    const validSkipKeys = profile.skipTrackKeys.filter((key) =>
      content.chapters.some((chapter) => chapter.tracks.some((track) => track.trackKey === key))
    )
    const skipSet = new Set(validSkipKeys)
    if (skipSet.size === 0) return

    const sessionKey = this.sessionKey(event.deviceId, event.cardId)
    const session = this.sessions.get(sessionKey) ?? { autoSkipCount: 0 }

    const now = Date.now()
    if (
      session.lastTrackKey === event.trackKey &&
      session.lastEventAt != null &&
      now - session.lastEventAt < config.skipDebounceMs
    ) {
      return
    }

    session.lastTrackKey = event.trackKey
    session.lastEventAt = now

    if (!shouldSkipTrack(event.trackKey, skipSet)) {
      this.sessions.set(sessionKey, session)
      return
    }

    let nextTrack =
      findNextAllowedTrack(content, event.trackKey, skipSet) ??
      (event.source === 'card' ? findFirstAllowedTrack(content, skipSet) : null)

    while (nextTrack && shouldSkipTrack(nextTrack.trackKey, skipSet)) {
      nextTrack = findNextAllowedTrack(content, nextTrack.trackKey, skipSet)
    }

    if (!nextTrack) {
      this.deps.log?.(`All remaining tracks skipped for card ${event.cardId}`)
      await this.deps.onStop?.(event.deviceId, event.cardId)
      this.sessions.set(sessionKey, session)
      return
    }

    if (session.autoSkipCount >= config.maxAutoSkipsPerSession) {
      this.deps.log?.(`Max auto-skips reached for ${event.cardId} on ${event.deviceId}`)
      return
    }

    session.autoSkipCount += 1
    this.sessions.set(sessionKey, session)

    const skippedTrackTitle = findTrackTitle(content, event.trackKey)
    await this.deps.onSkip(event.deviceId, {
      cardId: event.cardId,
      chapterKey: nextTrack.chapterKey,
      trackKey: nextTrack.trackKey,
      skippedTrackKey: event.trackKey,
      skippedTrackTitle,
      jumpedToTrackTitle: nextTrack.trackTitle
    })
  }

  private sessionKey(deviceId: string, cardId: string): string {
    return `${deviceId}:${cardId}`
  }
}
