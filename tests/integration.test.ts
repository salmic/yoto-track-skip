import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../src/db/index.js'
import { SkipEngine } from '../src/skip/engine.js'
import type { CardContent } from '../src/types.js'

/**
 * Simulates the full configure → insert card → auto-skip flow without a live Yoto player.
 */
describe('integration: configure skip list and auto-skip on playback', () => {
  it('persists profile and auto-skips on simulated card insert', async () => {
    const db = new AppDatabase(':memory:')

    const card: CardContent = {
      cardId: '5WsQg',
      title: 'Bedtime Stories',
      chapters: [
        {
          chapterKey: '01',
          title: 'Intro',
          tracks: [
            { trackKey: 'intro-jingle', title: 'Jingle' },
            { trackKey: 'intro-voice', title: 'Welcome Message' }
          ]
        },
        {
          chapterKey: '02',
          title: 'Story',
          tracks: [{ trackKey: 'story-1', title: 'The Adventure' }]
        }
      ]
    }

    db.cacheCard(card)
    db.upsertProfile({
      cardId: card.cardId,
      cardTitle: card.title,
      skipTrackKeys: ['intro-jingle', 'intro-voice'],
      enabled: true
    })

    const performedSkips: Array<{ deviceId: string; trackKey: string }> = []
    const engine = new SkipEngine(db, {
      getCardContent: async (cardId) => db.getCachedCard(cardId),
      onSkip: async (deviceId, action) => {
        performedSkips.push({ deviceId, trackKey: action.trackKey })
        db.addActivity({
          timestamp: new Date().toISOString(),
          deviceId,
          deviceName: 'Kids Room',
          cardId: action.cardId,
          cardTitle: card.title,
          skippedTrackKey: action.skippedTrackKey,
          skippedTrackTitle: action.skippedTrackTitle,
          jumpedToTrackKey: action.trackKey,
          jumpedToTrackTitle: action.jumpedToTrackTitle
        })
      }
    })

    await engine.handlePlayback({
      deviceId: 'player-1',
      deviceName: 'Kids Room',
      cardId: card.cardId,
      chapterKey: '01',
      trackKey: 'intro-jingle',
      playbackStatus: 'playing',
      source: 'card'
    })

    expect(performedSkips).toEqual([{ deviceId: 'player-1', trackKey: 'story-1' }])
    expect(db.listActivity()).toHaveLength(1)
    expect(db.getProfile(card.cardId)?.skipTrackKeys).toEqual(['intro-jingle', 'intro-voice'])
  })

  it('handles consecutive skipped tracks in one playback event chain', async () => {
    const db = new AppDatabase(':memory:')
    const card: CardContent = {
      cardId: 'xyz',
      title: 'Test Card',
      chapters: [
        {
          chapterKey: '01',
          title: 'All',
          tracks: [
            { trackKey: 'a', title: 'A' },
            { trackKey: 'b', title: 'B' },
            { trackKey: 'c', title: 'C' }
          ]
        }
      ]
    }

    db.cacheCard(card)
    db.upsertProfile({
      cardId: 'xyz',
      cardTitle: 'Test Card',
      skipTrackKeys: ['a', 'b'],
      enabled: true
    })

    const onSkip = vi.fn(async () => {})
    const engine = new SkipEngine(db, {
      getCardContent: async () => card,
      onSkip
    })

    await engine.handlePlayback({
      deviceId: 'player-1',
      deviceName: 'Test',
      cardId: 'xyz',
      chapterKey: '01',
      trackKey: 'a',
      playbackStatus: 'playing',
      source: 'card'
    })

    expect(onSkip).toHaveBeenCalledWith(
      'player-1',
      expect.objectContaining({ skippedTrackKey: 'a', trackKey: 'c' })
    )
  })
})
