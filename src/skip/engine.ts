import { config } from '../config.js'
import type { AppDatabase } from '../db/index.js'
import { findTrackTitle } from '../yoto/content.js'
import type { CardContent, PlaybackEvent } from '../types.js'
import {
  findFirstAllowedTrack,
  findNextAllowedTrack,
  findTrackDurationSec,
  flattenTracks,
  getImmediateNextTrack,
  isPlaybackTrackSkipped,
  resolvePlaybackTrack,
  type TrackLocation
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
  preemptedFromTrackKey?: string
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
    if (!event.cardId) return
    if (!this.isActivePlaybackStatus(event.playbackStatus)) return

    const profile = this.db.getProfile(event.cardId)
    if (!profile?.enabled || profile.skipTrackKeys.length === 0) {
      if (!profile) {
        this.deps.log?.(`No skip profile for card ${event.cardId}`)
      }
      return
    }

    let content = await this.deps.getCardContent(event.cardId)
    if (!content) {
      content = await this.deps.getCardContent(event.cardId, true)
    }
    if (!content || content.chapters.length === 0) {
      this.deps.log?.(`No card content for ${event.cardId}, skipping auto-skip`)
      return
    }

    const skipSet = new Set(profile.skipTrackKeys)

    if (event.cardInserted && event.source === 'card') {
      const firstTrack = flattenTracks(content)[0]
      const firstAllowed = findFirstAllowedTrack(content, skipSet)
      if (
        firstTrack &&
        firstAllowed &&
        firstTrack.trackKey !== firstAllowed.trackKey
      ) {
        this.deps.log?.(`Card inserted on ${event.cardId}, skipping leading track(s)`)
        await this.executeSkip(event, content, firstTrack, firstAllowed, skipSet)
        return
      }
    }

    if (!event.trackKey && !event.cardInserted) return

    const resolvedTrack = this.resolveCurrentTrack(content, event)
    const currentTrackKey = resolvedTrack?.trackKey ?? event.trackKey

    const sessionKey = this.sessionKey(event.deviceId, event.cardId)
    const session = this.sessions.get(sessionKey) ?? { autoSkipCount: 0 }

    if (
      session.preemptedFromTrackKey &&
      session.preemptedFromTrackKey !== currentTrackKey
    ) {
      session.preemptedFromTrackKey = undefined
    }

    const playbackProbe = {
      trackKey: resolvedTrack?.trackKey ?? event.trackKey,
      trackTitle: resolvedTrack?.trackTitle ?? event.trackTitle,
      chapterKey: resolvedTrack?.chapterKey ?? event.chapterKey
    }

    const trackIsSkipped = isPlaybackTrackSkipped(content, skipSet, playbackProbe)
    const trackJustChanged = session.lastTrackKey !== currentTrackKey
    const urgentSkip =
      trackIsSkipped &&
      trackJustChanged &&
      (event.playbackStatus === 'loading' || event.cardInserted === true)

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
      !urgentSkip &&
      session.lastTrackKey === currentTrackKey &&
      session.lastEventAt != null &&
      now - session.lastEventAt < config.skipDebounceMs
    ) {
      return
    }

    session.lastTrackKey = currentTrackKey
    session.lastEventAt = now

    if (!trackIsSkipped) {
      if (
        event.playbackStatus === 'playing' &&
        resolvedTrack &&
        currentTrackKey
      ) {
        await this.maybePreemptUpcomingSkip(
          event,
          content,
          resolvedTrack,
          skipSet,
          session
        )
      }
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

    const skippedTrack =
      resolvedTrack ??
      resolvePlaybackTrack(content, event) ?? {
        chapterKey: event.chapterKey,
        trackKey: currentTrackKey,
        chapterTitle: event.chapterTitle ?? '',
        trackTitle: event.trackTitle ?? currentTrackKey
      }

    await this.executeSkip(event, content, skippedTrack, nextTrack, skipSet, session)
  }

  private async executeSkip(
    event: PlaybackEvent,
    content: CardContent,
    skippedTrack: TrackLocation,
    nextTrack: TrackLocation,
    _skipSet: Set<string>,
    session?: SessionState
  ): Promise<void> {
    const sessionKey = this.sessionKey(event.deviceId, event.cardId)
    const activeSession = session ?? this.sessions.get(sessionKey) ?? { autoSkipCount: 0 }

    if (activeSession.autoSkipCount >= config.maxAutoSkipsPerSession) {
      this.deps.log?.(`Max auto-skips reached for ${event.cardId} on ${event.deviceId}`)
      return
    }

    activeSession.autoSkipCount += 1
    activeSession.pendingSkipTo = nextTrack.trackKey
    activeSession.lastTrackKey = skippedTrack.trackKey
    activeSession.lastEventAt = Date.now()
    this.sessions.set(sessionKey, activeSession)

    const skippedTrackTitle =
      skippedTrack.trackTitle ??
      findTrackTitle(content, skippedTrack.trackKey) ??
      event.trackTitle ??
      skippedTrack.trackKey

    this.deps.log?.(
      `Skipping ${skippedTrackTitle} (${skippedTrack.trackKey}) -> ${nextTrack.trackTitle} (${nextTrack.trackKey}) on ${event.deviceId}`
    )

    await this.deps.onSkip(event.deviceId, {
      cardId: event.cardId,
      chapterKey: nextTrack.chapterKey,
      trackKey: nextTrack.trackKey,
      skippedTrackKey: skippedTrack.trackKey,
      skippedTrackTitle,
      jumpedToTrackTitle: nextTrack.trackTitle
    })
  }

  private async maybePreemptUpcomingSkip(
    event: PlaybackEvent,
    content: CardContent,
    currentTrack: TrackLocation,
    skipSet: Set<string>,
    session: SessionState
  ): Promise<void> {
    if (session.preemptedFromTrackKey === currentTrack.trackKey) return

    const immediateNext = getImmediateNextTrack(content, currentTrack.trackKey)
    if (!immediateNext || !skipSet.has(immediateNext.trackKey)) return

    const jumpTo = findNextAllowedTrack(content, currentTrack.trackKey, skipSet)
    if (!jumpTo) return

    const trackLength =
      event.trackLengthSec ??
      findTrackDurationSec(content, currentTrack.trackKey)
    const position = event.positionSec
    if (trackLength == null || position == null || trackLength <= 0) return

    const remaining = trackLength - position
    if (remaining > config.skipPreemptSeconds) return

    session.preemptedFromTrackKey = currentTrack.trackKey
    this.deps.log?.(
      `Preempting upcoming skipped track on ${event.deviceId} (${remaining.toFixed(1)}s left on ${currentTrack.trackTitle})`
    )
    await this.executeSkip(event, content, immediateNext, jumpTo, skipSet, session)
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
