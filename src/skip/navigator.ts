import type { CardContent } from '../types.js'

export interface TrackLocation {
  chapterKey: string
  trackKey: string
  chapterTitle: string
  trackTitle: string
  overlayLabel?: string
}

export function flattenTracks(content: CardContent): TrackLocation[] {
  const tracks: TrackLocation[] = []
  for (const chapter of content.chapters) {
    for (const track of chapter.tracks) {
      tracks.push({
        chapterKey: chapter.chapterKey,
        trackKey: track.trackKey,
        chapterTitle: chapter.title,
        trackTitle: track.title,
        overlayLabel: track.overlayLabel
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

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

function trackFromFlatIndex(tracks: TrackLocation[], rawIndex: number): TrackLocation | null {
  if (Number.isNaN(rawIndex)) return null
  return tracks[rawIndex - 1] ?? tracks[rawIndex] ?? null
}

export function resolvePlaybackTrack(
  content: CardContent,
  playback: { trackKey: string; trackTitle?: string; chapterKey?: string }
): TrackLocation | null {
  const tracks = flattenTracks(content)

  if (playback.trackKey) {
    const byKey = findTrackLocation(content, playback.trackKey)
    if (byKey) return byKey

    const byOverlay = tracks.filter((track) => track.overlayLabel === playback.trackKey)
    if (byOverlay.length === 1) return byOverlay[0]!

    const numericKey = Number.parseInt(playback.trackKey, 10)
    const byFlatIndex = trackFromFlatIndex(tracks, numericKey)
    if (byFlatIndex) return byFlatIndex
  }

  if (playback.trackTitle) {
    const normalized = normalizeTitle(playback.trackTitle)
    const matches = tracks.filter((track) => normalizeTitle(track.trackTitle) === normalized)
    if (matches.length === 1) return matches[0]!
  }

  if (playback.chapterKey && playback.trackKey) {
    const chapter = content.chapters.find((item) => item.chapterKey === playback.chapterKey)
    if (chapter) {
      const index = Number.parseInt(playback.trackKey, 10)
      if (!Number.isNaN(index)) {
        const zeroBased = chapter.tracks[index]
        if (zeroBased) {
          return {
            chapterKey: chapter.chapterKey,
            trackKey: zeroBased.trackKey,
            chapterTitle: chapter.title,
            trackTitle: zeroBased.title,
            overlayLabel: zeroBased.overlayLabel
          }
        }

        const oneBased = chapter.tracks[index - 1]
        if (oneBased) {
          return {
            chapterKey: chapter.chapterKey,
            trackKey: oneBased.trackKey,
            chapterTitle: chapter.title,
            trackTitle: oneBased.title,
            overlayLabel: oneBased.overlayLabel
          }
        }
      }
    }
  }

  return null
}

export function isPlaybackTrackSkipped(
  content: CardContent,
  skipTrackKeys: Set<string>,
  playback: { trackKey: string; trackTitle?: string; chapterKey?: string }
): boolean {
  const resolved = resolvePlaybackTrack(content, playback)
  if (resolved) {
    return shouldSkipTrack(resolved.trackKey, skipTrackKeys)
  }

  if (playback.trackTitle) {
    const normalized = normalizeTitle(playback.trackTitle)
    return flattenTracks(content).some(
      (track) =>
        skipTrackKeys.has(track.trackKey) && normalizeTitle(track.trackTitle) === normalized
    )
  }

  const numericKey = Number.parseInt(playback.trackKey, 10)
  if (!Number.isNaN(numericKey)) {
    const byIndex = trackFromFlatIndex(flattenTracks(content), numericKey)
    if (byIndex) return shouldSkipTrack(byIndex.trackKey, skipTrackKeys)
  }

  return shouldSkipTrack(playback.trackKey, skipTrackKeys)
}
