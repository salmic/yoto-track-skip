import { Router } from 'express'
import { getDb } from '../../db/index.js'

export const activityRouter = Router()

activityRouter.get('/', (req, res) => {
  const limit = Number(req.query.limit ?? 50)
  res.json({ activity: getDb().listActivity(Number.isFinite(limit) ? limit : 50) })
})
