import { config } from '../config.js'
import type { AppDatabase } from '../db/index.js'
import { findTrackTitle } from '../yoto/content.js'
import type { CardContent, PlaybackEvent } from '../types.js'
import {
  findFirstAllowedTrack,
  findNextAllowedTrack,
  flattenTracks,
  isPlaybackTrackSkipped,
  resolvePlaybackTrack
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
  getCardContent: (cardId: string, force?: boolean) => Promise<CardContent | null>
  onSkip: (deviceId: string, action: SkipAction) => Promise<void>
  onStop?: (deviceId: string, cardId: string) => Promise<void>
  log?: (message: string) => void
}

interface SessionState {
  lastTrackKey?: string
  lastEventAt?: number
  autoSkipCount: number
  pendingSkipTo?: string
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
    if (!this.isActivePlaybackStatus(event.playbackStatus)) return

    const profile = this.db.getProfile(event.cardId)
    if (!profile?.enabled || profile.skipTrackKeys.length === 0) return

    let content = await this.deps.getCardContent(event.cardId)
    if (!content) {
      content = await this.deps.getCardContent(event.cardId, true)
    }
    if (!content || content.chapters.length === 0) {
      this.deps.log?.(`No card content for ${event.cardId}, skipping auto-skip`)
      return
    }

    const skipSet = new Set(profile.skipTrackKeys)
    const resolvedTrack = this.resolveCurrentTrack(content, event)
    const currentTrackKey = resolvedTrack?.trackKey ?? event.trackKey

    const sessionKey = this.sessionKey(event.deviceId, event.cardId)
    const session = this.sessions.get(sessionKey) ?? { autoSkipCount: 0 }

    const now = Date.now()
    if (
      session.pendingSkipTo &&
      currentTrackKey === session.pendingSkipTo &&
      session.lastEventAt != null &&
      now - session.lastEventAt < config.skipDebounceMs
    ) {
      session.pendingSkipTo = undefined
      session.lastTrackKey = currentTrackKey
      session.lastEventAt = now
      this.sessions.set(sessionKey, session)
      return
    }

    if (
      session.lastTrackKey === currentTrackKey &&
      session.lastEventAt != null &&
      now - session.lastEventAt < config.skipDebounceMs
    ) {
      return
    }

    session.lastTrackKey = currentTrackKey
    session.lastEventAt = now

    const playbackProbe = {
      trackKey: resolvedTrack?.trackKey ?? event.trackKey,
      trackTitle: resolvedTrack?.trackTitle ?? event.trackTitle,
      chapterKey: resolvedTrack?.chapterKey ?? event.chapterKey
    }

    if (!isPlaybackTrackSkipped(content, skipSet, playbackProbe)) {
      this.sessions.set(sessionKey, session)
      return
    }

    let nextTrack =
      findNextAllowedTrack(content, currentTrackKey, skipSet) ??
      (event.source === 'card' ? findFirstAllowedTrack(content, skipSet) : null)

    while (nextTrack && skipSet.has(nextTrack.trackKey)) {
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
    session.pendingSkipTo = nextTrack.trackKey
    this.sessions.set(sessionKey, session)

    const skippedTrackTitle =
      resolvedTrack?.trackTitle ?? findTrackTitle(content, currentTrackKey) ?? event.trackTitle ?? currentTrackKey

    this.deps.log?.(
      `Skipping ${skippedTrackTitle} (${currentTrackKey}) -> ${nextTrack.trackTitle} (${nextTrack.trackKey}) on ${event.deviceId}`
    )

    await this.deps.onSkip(event.deviceId, {
      cardId: event.cardId,
      chapterKey: nextTrack.chapterKey,
      trackKey: nextTrack.trackKey,
      skippedTrackKey: currentTrackKey,
      skippedTrackTitle,
      jumpedToTrackTitle: nextTrack.trackTitle
    })
  }

  private isActivePlaybackStatus(status: string): boolean {
    return status === 'playing' || status === 'loading'
  }

  private resolveCurrentTrack(content: CardContent, event: PlaybackEvent) {
    const resolved = resolvePlaybackTrack(content, event)
    if (resolved) return resolved

    if (event.cardInserted && event.source === 'card') {
      return flattenTracks(content)[0] ?? null
    }

    return null
  }

  private sessionKey(deviceId: string, cardId: string): string {
    return `${deviceId}:${cardId}`
  }
}
