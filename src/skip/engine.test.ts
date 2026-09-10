import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../db/index.js'
import type { CardContent, PlaybackEvent } from '../types.js'
import { SkipEngine } from './engine.js'

const sampleContent: CardContent = {
  cardId: 'abc123',
  title: 'Sample Story',
  chapters: [
    {
      chapterKey: '01',
      title: 'Intro',
      tracks: [
        { trackKey: 't1', title: 'Theme Song' },
        { trackKey: 't2', title: 'Welcome' }
      ]
    },
    {
      chapterKey: '02',
      title: 'Story',
      tracks: [{ trackKey: 't3', title: 'Chapter 1' }]
    }
  ]
}

function createTestDb(): AppDatabase {
  return new AppDatabase(':memory:')
}

function createEvent(overrides: Partial<PlaybackEvent> = {}): PlaybackEvent {
  return {
    deviceId: 'device-1',
    deviceName: 'Bedroom',
    cardId: 'abc123',
    chapterKey: '01',
    trackKey: 't1',
    playbackStatus: 'playing',
    source: 'card',
    ...overrides
  }
}

describe('SkipEngine', () => {
  it('skips configured track and jumps to next allowed track', async () => {
    const db = createTestDb()
    db.upsertProfile({
      cardId: 'abc123',
      cardTitle: 'Sample Story',
      skipTrackKeys: ['t1', 't2'],
      enabled: true
    })

    const onSkip = vi.fn(async () => {})
    const engine = new SkipEngine(db, {
      getCardContent: async () => sampleContent,
      onSkip
    })

    await engine.handlePlayback(createEvent({ trackKey: 't1', source: 'card' }))

    expect(onSkip).toHaveBeenCalledOnce()
    const skipAction = onSkip.mock.calls[0]![1]
    expect(skipAction).toMatchObject({
      cardId: 'abc123',
      skippedTrackKey: 't1',
      trackKey: 't3',
      chapterKey: '02'
    })
  })

  it('does nothing when profile is disabled', async () => {
    const db = createTestDb()
    db.upsertProfile({
      cardId: 'abc123',
      cardTitle: 'Sample Story',
      skipTrackKeys: ['t1'],
      enabled: false
    })

    const onSkip = vi.fn(async () => {})
    const engine = new SkipEngine(db, {
      getCardContent: async () => sampleContent,
      onSkip
    })

    await engine.handlePlayback(createEvent())
    expect(onSkip).not.toHaveBeenCalled()
  })

  it('debounces duplicate track events', async () => {
    const db = createTestDb()
    db.upsertProfile({
      cardId: 'abc123',
      cardTitle: 'Sample Story',
      skipTrackKeys: ['t1'],
      enabled: true
    })

    const onSkip = vi.fn(async () => {})
    const engine = new SkipEngine(db, {
      getCardContent: async () => sampleContent,
      onSkip
    })

    await engine.handlePlayback(createEvent({ trackKey: 't1' }))
    await engine.handlePlayback(createEvent({ trackKey: 't1' }))

    expect(onSkip).toHaveBeenCalledOnce()
  })

  it('stops playback when all remaining tracks are skipped', async () => {
    const db = createTestDb()
    db.upsertProfile({
      cardId: 'abc123',
      cardTitle: 'Sample Story',
      skipTrackKeys: ['t1', 't2', 't3'],
      enabled: true
    })

    const onSkip = vi.fn(async () => {})
    const onStop = vi.fn(async () => {})
    const engine = new SkipEngine(db, {
      getCardContent: async () => sampleContent,
      onSkip,
      onStop
    })

    await engine.handlePlayback(createEvent({ trackKey: 't3' }))

    expect(onSkip).not.toHaveBeenCalled()
    expect(onStop).toHaveBeenCalledOnce()
  })
})
