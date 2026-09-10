import express, { type Express } from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { authRouter } from './routes/auth.js'
import { devicesRouter } from './routes/devices.js'
import { cardsRouter } from './routes/cards.js'
import { profilesRouter } from './routes/profiles.js'
import { activityRouter } from './routes/activity.js'

export function createApp(): Express {
  const app = express()

  app.set('trust proxy', 1)
  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/devices', devicesRouter)
  app.use('/api/cards', cardsRouter)
  app.use('/api/profiles', profilesRouter)
  app.use('/api/activity', activityRouter)

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    res.status(500).json({ error: message })
  })

  const webDist = join(process.cwd(), 'web', 'dist')
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
    app.get('*', (_req, res) => {
      res.sendFile(join(webDist, 'index.html'))
    })
  }

  return app
}
