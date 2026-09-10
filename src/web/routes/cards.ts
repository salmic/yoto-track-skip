import { Router } from 'express'
import { yotoService } from '../../yoto/service.js'

export const cardsRouter = Router()

cardsRouter.get('/', async (_req, res, next) => {
  try {
    const cards = await yotoService.getCards()
    res.json({ cards })
  } catch (error) {
    next(error)
  }
})

cardsRouter.get('/:cardId/content', async (req, res, next) => {
  try {
    const force = req.query.refresh === 'true'
    const content = await yotoService.getCardContent(req.params.cardId, force)
    res.json(content)
  } catch (error) {
    next(error)
  }
})
