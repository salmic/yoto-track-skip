import { request } from 'undici'
import type { YotoClient } from 'yoto-nodejs-client'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import type { CardChapter, CardContent, CardSummary, CardTrack } from '../types.js'

const YOTO_API_URL = 'https://api.yotoplay.com'

interface RawChapter {
  key?: string
  title?: string
  tracks?: RawTrack[]
}

interface RawTrack {
  key?: string
  title?: string
  duration?: number
  media?: { duration?: number }
}

interface RawCardPayload {
  cardId?: string
  title?: string
  metadata?: { title?: string }
  content?: { chapters?: RawChapter[] }
  chapters?: RawChapter[]
  card?: RawCardPayload
}

function extractChapters(raw: RawCardPayload): RawChapter[] {
  return raw.chapters ?? raw.content?.chapters ?? raw.card?.content?.chapters ?? raw.card?.chapters ?? []
}

function extractTitle(raw: RawCardPayload, cardId: string): string {
  return (
    raw.title ??
    raw.card?.title ??
    raw.metadata?.title ??
    raw.card?.metadata?.title ??
    cardId
  )
}

export function normalizeCardContent(cardId: string, raw: RawCardPayload): CardContent {
  const payload = raw.card ?? raw
  const chapters: CardChapter[] = extractChapters(raw).map((chapter, chapterIndex) => ({
    chapterKey: chapter.key ?? String(chapterIndex + 1).padStart(2, '0'),
    title: chapter.title ?? `Chapter ${chapterIndex + 1}`,
    tracks: (chapter.tracks ?? []).map((track, trackIndex) => normalizeTrack(track, trackIndex))
  }))

  return {
    cardId: payload.cardId ?? cardId,
    title: extractTitle(raw, cardId),
    chapters
  }
}

function normalizeTrack(track: RawTrack, trackIndex: number): CardTrack {
  const durationSec = track.duration ?? track.media?.duration
  return {
    trackKey: track.key ?? String(trackIndex + 1).padStart(2, '0'),
    title: track.title ?? `Track ${trackIndex + 1}`,
    durationSec: durationSec != null ? Math.round(durationSec) : undefined
  }
}

async function ensureFreshAccessToken(client: YotoClient): Promise<string> {
  try {
    await client.getUserMyoContent()
  } catch {
    // Client may still refresh tokens before failing; fall through to stored token.
  }

  const tokens = getDb().getAuthTokens()
  if (!tokens?.accessToken) {
    throw new Error('Not authenticated')
  }
  return tokens.accessToken
}

async function yotoGet(accessToken: string, path: string): Promise<unknown> {
  const response = await request(`${YOTO_API_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'YotoTrackSkip/1.0.0'
    }
  })

  const textBody = await response.body.text()
  if (response.statusCode > 299) {
    throw new Error(`Yoto API ${path} failed (${response.statusCode}): ${textBody.slice(0, 200)}`)
  }

  return JSON.parse(textBody) as unknown
}

async function fetchCardPayload(client: YotoClient, cardId: string): Promise<RawCardPayload> {
  const accessToken = await ensureFreshAccessToken(client)

  try {
    const contentResponse = (await client.getContent({ cardId })) as RawCardPayload
    if (extractChapters(contentResponse).length > 0 || contentResponse.card) {
      return contentResponse
    }
  } catch (error) {
    console.warn(`[yoto] getContent failed for ${cardId}:`, error)
  }

  const cardResponse = (await yotoGet(accessToken, `/card/${cardId}`)) as RawCardPayload
  if (cardResponse.card) {
    return cardResponse
  }

  return { cardId, ...cardResponse }
}

export async function fetchCardContent(client: YotoClient, cardId: string, force = false): Promise<CardContent> {
  const db = getDb()
  if (!force && db.isCardCacheFresh(cardId, config.cardCacheTtlMs)) {
    const cached = db.getCachedCard(cardId)
    if (cached && cached.chapters.length > 0) return cached
  }

  const raw = await fetchCardPayload(client, cardId)
  const content = normalizeCardContent(cardId, raw)
  db.cacheCard(content)
  return content
}

function rawCardToSummary(raw: RawCardPayload): CardSummary | null {
  const cardId = raw.cardId ?? raw.card?.cardId
  if (!cardId) return null

  const content = normalizeCardContent(cardId, raw)
  const trackCount = content.chapters.reduce((sum, chapter) => sum + chapter.tracks.length, 0)
  return {
    cardId: content.cardId,
    title: content.title,
    chapterCount: content.chapters.length,
    trackCount
  }
}

async function fetchFamilyLibraryCards(client: YotoClient): Promise<RawCardPayload[]> {
  const accessToken = await ensureFreshAccessToken(client)
  const json = (await yotoGet(accessToken, '/card/family/library')) as { cards?: RawCardPayload[] }
  return json.cards ?? []
}

export async function listUserCards(client: YotoClient): Promise<CardSummary[]> {
  const [familyCards, myo] = await Promise.all([
    fetchFamilyLibraryCards(client).catch((error) => {
      console.warn('[yoto] family library fetch failed:', error)
      return [] as RawCardPayload[]
    }),
    client.getUserMyoContent() as Promise<{ cards?: RawCardPayload[] }>
  ])

  const merged = new Map<string, CardSummary>()

  for (const card of familyCards) {
    const summary = rawCardToSummary(card)
    if (summary) merged.set(summary.cardId, summary)
  }

  for (const card of myo.cards ?? []) {
    const summary = rawCardToSummary(card)
    if (!summary) continue

    const existing = merged.get(summary.cardId)
    if (!existing || summary.trackCount > existing.trackCount) {
      merged.set(summary.cardId, summary)
    }
  }

  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title))
}

export function findTrackTitle(content: CardContent, trackKey: string): string {
  for (const chapter of content.chapters) {
    const track = chapter.tracks.find((item) => item.trackKey === trackKey)
    if (track) return track.title
  }
  return trackKey
}

export function pruneSkipTrackKeys(content: CardContent, skipTrackKeys: string[]): string[] {
  const validKeys = new Set(
    content.chapters.flatMap((chapter) => chapter.tracks.map((track) => track.trackKey))
  )
  return skipTrackKeys.filter((key) => validKeys.has(key))
}
