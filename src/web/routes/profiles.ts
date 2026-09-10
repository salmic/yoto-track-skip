import { Router } from 'express'
import { getDb } from '../../db/index.js'
import { pruneSkipTrackKeys, fetchCardContent } from '../../yoto/content.js'
import { findFirstAllowedTrack } from '../../skip/navigator.js'
import { yotoService } from '../../yoto/service.js'

export const profilesRouter = Router()

profilesRouter.get('/', (_req, res) => {
  res.json({ profiles: getDb().listProfiles() })
})

profilesRouter.put('/:cardId', async (req, res, next) => {
  try {
    const cardId = req.params.cardId
    const skipTrackKeys = Array.isArray(req.body?.skipTrackKeys)
      ? (req.body.skipTrackKeys as string[])
      : []
    const cardTitle = (req.body?.cardTitle as string | undefined) ?? cardId
    const enabled = req.body?.enabled !== false

    let content = getDb().getCachedCard(cardId)
    if (!content) {
      content = await yotoService.getCardContent(cardId)
    }

    const prunedKeys = pruneSkipTrackKeys(content, skipTrackKeys)
    const profile = getDb().upsertProfile({
      cardId,
      cardTitle: content.title || cardTitle,
      skipTrackKeys: prunedKeys,
      enabled
    })

    const firstTrack = findFirstAllowedTrack(content, new Set(prunedKeys))
    res.json({
      profile,
      preview: firstTrack
        ? { chapterKey: firstTrack.chapterKey, trackKey: firstTrack.trackKey, title: firstTrack.trackTitle }
        : null
    })
  } catch (error) {
    next(error)
  }
})

profilesRouter.patch('/:cardId/toggle', (req, res) => {
  const enabled = req.body?.enabled === true
  const profile = getDb().setProfileEnabled(req.params.cardId, enabled)
  if (!profile) {
    res.status(404).json({ error: 'Profile not found' })
    return
  }
  res.json({ profile })
})

profilesRouter.delete('/:cardId', (req, res) => {
  const deleted = getDb().deleteProfile(req.params.cardId)
  if (!deleted) {
    res.status(404).json({ error: 'Profile not found' })
    return
  }
  res.json({ ok: true })
})

profilesRouter.get('/:cardId/preview', async (req, res, next) => {
  try {
    const profile = getDb().getProfile(req.params.cardId)
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' })
      return
    }

    const client = yotoService.getClient()
    if (!client) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const content = await fetchCardContent(client, req.params.cardId)
    const firstTrack = findFirstAllowedTrack(content, new Set(profile.skipTrackKeys))
    res.json({
      firstTrack: firstTrack
        ? { chapterKey: firstTrack.chapterKey, trackKey: firstTrack.trackKey, title: firstTrack.trackTitle }
        : null
    })
  } catch (error) {
    next(error)
  }
})
