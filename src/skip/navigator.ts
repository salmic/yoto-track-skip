import type { CardContent } from '../types.js'

export interface TrackLocation {
  chapterKey: string
  trackKey: string
  chapterTitle: string
  trackTitle: string
}

export function flattenTracks(content: CardContent): TrackLocation[] {
  const tracks: TrackLocation[] = []
  for (const chapter of content.chapters) {
    for (const track of chapter.tracks) {
      tracks.push({
        chapterKey: chapter.chapterKey,
        trackKey: track.trackKey,
        chapterTitle: chapter.title,
        trackTitle: track.title
      })
    }
  }
  return tracks
}

export function findTrackLocation(content: CardContent, trackKey: string): TrackLocation | null {
  return flattenTracks(content).find((track) => track.trackKey === trackKey) ?? null
}

export function findNextAllowedTrack(
  content: CardContent,
  currentTrackKey: string,
  skipTrackKeys: Set<string>
): TrackLocation | null {
  const tracks = flattenTracks(content)
  const currentIndex = tracks.findIndex((track) => track.trackKey === currentTrackKey)
  if (currentIndex === -1) {
    return tracks.find((track) => !skipTrackKeys.has(track.trackKey)) ?? null
  }

  for (let index = currentIndex + 1; index < tracks.length; index += 1) {
    const track = tracks[index]
    if (!skipTrackKeys.has(track.trackKey)) {
      return track
    }
  }

  return null
}

export function findFirstAllowedTrack(
  content: CardContent,
  skipTrackKeys: Set<string>
): TrackLocation | null {
  return flattenTracks(content).find((track) => !skipTrackKeys.has(track.trackKey)) ?? null
}

export function shouldSkipTrack(trackKey: string, skipTrackKeys: Set<string>): boolean {
  return skipTrackKeys.has(trackKey)
}
