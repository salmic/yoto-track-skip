import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type CardContent, type CardSummary } from '../api'
import { TrackTree } from '../components/TrackTree'
import { findFirstAllowedTrack } from '../utils/navigator'

export function CardEditor() {
  const { cardId = 'new' } = useParams()
  const navigate = useNavigate()
  const isNew = cardId === 'new'

  const [cards, setCards] = useState<CardSummary[]>([])
  const [selectedCardId, setSelectedCardId] = useState(isNew ? '' : cardId)
  const [content, setContent] = useState<CardContent | null>(null)
  const [selectedTrackKeys, setSelectedTrackKeys] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const cardList = await api.getCards()
        setCards(cardList.cards)

        const activeCardId = isNew ? cardList.cards[0]?.cardId ?? '' : cardId
        setSelectedCardId(activeCardId)

        if (activeCardId) {
          const [cardContent, profileResult] = await Promise.all([
            api.getCardContent(activeCardId, true),
            api.getProfiles().catch(() => ({ profiles: [] }))
          ])
          setContent(cardContent)
          const existing = profileResult.profiles.find((profile) => profile.cardId === activeCardId)
          setSelectedTrackKeys(new Set(existing?.skipTrackKeys ?? []))
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load card')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [cardId, isNew])

  const filteredCards = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return cards
    return cards.filter((card) => card.title.toLowerCase().includes(query))
  }, [cards, search])

  const preview = useMemo(() => {
    if (!content) return null
    return findFirstAllowedTrack(content, selectedTrackKeys)
  }, [content, selectedTrackKeys])

  const loadCard = async (nextCardId: string) => {
    setSelectedCardId(nextCardId)
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const [cardContent, profileResult] = await Promise.all([
        api.getCardContent(nextCardId, true),
        api.getProfiles()
      ])
      setContent(cardContent)
      const existing = profileResult.profiles.find((profile) => profile.cardId === nextCardId)
      setSelectedTrackKeys(new Set(existing?.skipTrackKeys ?? []))
      navigate(`/cards/${nextCardId}`, { replace: true })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load card')
    } finally {
      setLoading(false)
    }
  }

  const toggleTrack = (trackKey: string, checked: boolean) => {
    setSelectedTrackKeys((current) => {
      const next = new Set(current)
      if (checked) next.add(trackKey)
      else next.delete(trackKey)
      return next
    })
  }

  const saveProfile = async () => {
    if (!content) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.saveProfile(content.cardId, {
        cardTitle: content.title,
        skipTrackKeys: Array.from(selectedTrackKeys),
        enabled: true
      })
      setMessage(
        result.preview
          ? `Saved. First track on insert: “${result.preview.title}”`
          : 'Saved, but all tracks are skipped.'
      )
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !content) {
    return <p>Loading card…</p>
  }

  return (
    <>
      <div className="card">
        <div className="actions" style={{ marginBottom: '1rem' }}>
          <Link to="/">
            <button className="secondary" type="button">
              Back
            </button>
          </Link>
        </div>

        <h2>{isNew ? 'Add Skip Profile' : content?.title ?? 'Edit Skip Profile'}</h2>

        {isNew ? (
          <>
            <input
              className="search-input"
              placeholder="Search your Yoto library…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="actions" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
              {filteredCards.map((card) => (
                <button
                  key={card.cardId}
                  className={card.cardId === selectedCardId ? undefined : 'secondary'}
                  type="button"
                  onClick={() => void loadCard(card.cardId)}
                >
                  {card.title}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {content ? (
          <>
            <p className="muted">Check the tracks you want to skip automatically when this card plays.</p>
            {content.chapters.length === 0 ? (
              <p className="muted">No tracks found for this card. Try refreshing, or log out and back in if your library access expired.</p>
            ) : (
              <TrackTree
                chapters={content.chapters}
                selectedTrackKeys={selectedTrackKeys}
                onToggle={toggleTrack}
              />
            )}

            {content.chapters.length > 0 && preview ? (
              <div className="preview-box">
                <strong>First track on insert:</strong> {preview.trackTitle}
              </div>
            ) : content.chapters.length > 0 ? (
              <div className="preview-box">
                <strong>Warning:</strong> All tracks are marked to skip.
              </div>
            ) : null}

            <div className="actions" style={{ marginTop: '1rem' }}>
              <button type="button" disabled={saving} onClick={() => void saveProfile()}>
                {saving ? 'Saving…' : 'Save skip profile'}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => void loadCard(content.cardId)}
              >
                Refresh tracks
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Select a card from your library to configure skip tracks.</p>
        )}

        {message ? <p>{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </>
  )
}
