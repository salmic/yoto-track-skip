import { describe, expect, it } from 'vitest'
import type { CardContent } from '../types.js'
import {
  findFirstAllowedTrack,
  findNextAllowedTrack,
  flattenTracks,
  shouldSkipTrack
} from './navigator.js'

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
      tracks: [
        { trackKey: 't3', title: 'Chapter 1' },
        { trackKey: 't4', title: 'Chapter 2' }
      ]
    }
  ]
}

describe('navigator', () => {
  it('flattens tracks in chapter order', () => {
    expect(flattenTracks(sampleContent).map((track) => track.trackKey)).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('finds first allowed track', () => {
    const skip = new Set(['t1', 't2'])
    const first = findFirstAllowedTrack(sampleContent, skip)
    expect(first?.trackKey).toBe('t3')
  })

  it('finds next allowed track skipping consecutive entries', () => {
    const skip = new Set(['t1', 't2', 't3'])
    const next = findNextAllowedTrack(sampleContent, 't1', skip)
    expect(next?.trackKey).toBe('t4')
  })

  it('returns null when no tracks remain', () => {
    const skip = new Set(['t1', 't2', 't3', 't4'])
    expect(findNextAllowedTrack(sampleContent, 't3', skip)).toBeNull()
  })

  it('detects skipped tracks', () => {
    expect(shouldSkipTrack('t1', new Set(['t1']))).toBe(true)
    expect(shouldSkipTrack('t2', new Set(['t1']))).toBe(false)
  })
})
