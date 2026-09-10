import type { CardContent } from '../api'

export function findFirstAllowedTrack(content: CardContent, skipTrackKeys: Set<string>) {
  for (const chapter of content.chapters) {
    for (const track of chapter.tracks) {
      if (!skipTrackKeys.has(track.trackKey)) {
        return {
          chapterKey: chapter.chapterKey,
          trackKey: track.trackKey,
          trackTitle: track.title
        }
      }
    }
  }
  return null
}
