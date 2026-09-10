import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'

dotenv.config()

function resolvePublicBaseUrl(port: number): string {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
  }

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  }

  if (process.env.RAILWAY_STATIC_URL) {
    return process.env.RAILWAY_STATIC_URL.replace(/\/$/, '')
  }

  return `http://localhost:${port}`
}

const port = Number(process.env.PORT ?? 3847)
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data')
mkdirSync(dataDir, { recursive: true })

export const config = {
  port,
  host: process.env.HOST ?? '0.0.0.0',
  publicBaseUrl: resolvePublicBaseUrl(port),
  dataDir,
  dbPath: join(dataDir, 'skip.db'),
  yotoClientId: process.env.YOTO_CLIENT_ID ?? '',
  yotoClientSecret: process.env.YOTO_CLIENT_SECRET ?? '',
  cardCacheTtlMs: 24 * 60 * 60 * 1000,
  skipDebounceMs: 2000,
  maxAutoSkipsPerSession: 20
}

export function assertYotoConfigured(): void {
  if (!config.yotoClientId) {
    throw new Error('YOTO_CLIENT_ID is required. Copy .env.example to .env and add your credentials.')
  }
}
