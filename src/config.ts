import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'

dotenv.config()

const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data')
mkdirSync(dataDir, { recursive: true })

export const config = {
  port: Number(process.env.PORT ?? 3847),
  host: process.env.HOST ?? '0.0.0.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3847}`,
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
