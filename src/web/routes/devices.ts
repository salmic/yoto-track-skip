import { Router } from 'express'
import { yotoService } from '../../yoto/service.js'

export const devicesRouter = Router()

devicesRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await yotoService.listDevices())
  } catch (error) {
    next(error)
  }
})
