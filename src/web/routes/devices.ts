import { Router } from 'express'
import { yotoService } from '../../yoto/service.js'

export const devicesRouter = Router()

devicesRouter.get('/', (_req, res) => {
  res.json({ devices: yotoService.listDevices() })
})
