import type { CardChapter } from '../api'

interface TrackTreeProps {
  chapters: CardChapter[]
  selectedTrackKeys: Set<string>
  onToggle: (trackKey: string, checked: boolean) => void
}

export function TrackTree({ chapters, selectedTrackKeys, onToggle }: TrackTreeProps) {
  return (
    <div className="track-tree">
      {chapters.map((chapter) => (
        <div key={chapter.chapterKey} className="chapter-block">
          <div className="chapter-header">{chapter.title}</div>
          {chapter.tracks.map((track) => (
            <div key={track.trackKey} className="track-row">
              <label>
                <input
                  type="checkbox"
                  checked={selectedTrackKeys.has(track.trackKey)}
                  onChange={(event) => onToggle(track.trackKey, event.target.checked)}
                />
                <span>{track.title}</span>
              </label>
              {track.durationSec != null ? (
                <span className="muted">{formatDuration(track.durationSec)}</span>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}
