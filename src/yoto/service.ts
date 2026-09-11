import { YotoAccount, type YotoClient } from 'yoto-nodejs-client'
import { authService } from '../auth/yoto-auth.js'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { SkipEngine } from '../skip/engine.js'
import { formatYotoApiError, reauthMessage } from '../auth/permissions.js'
import { fetchCardContent, listUserCards } from './content.js'
import type { ActivityEntry, DeviceInfo, DeviceStatus, PlaybackEvent } from '../types.js'

export class YotoService {
  private account: YotoAccount | null = null
  private skipEngine: SkipEngine | null = null
  private starting = false
  private deviceCatalog = new Map<string, DeviceInfo>()
  private lastError: string | null = null

  async start(skipEngine: SkipEngine): Promise<void> {
    if (this.starting || this.account?.running) return
    this.starting = true
    this.skipEngine = skipEngine

    try {
      const access = await authService.checkDeviceAccess()
      if (!access.ok) {
        this.lastError = access.message ?? 'Missing Yoto device permissions'
        return
      }

      const client = await authService.initializeClient()
      if (!client) {
        this.lastError = 'Not authenticated'
        return
      }

      await this.startAccount(client)
      if (this.account?.running) {
        this.lastError = null
      }
    } catch (error) {
      this.lastError = reauthMessage(formatYotoApiError(error))
      console.error('[yoto] Failed to start service:', this.lastError)
    } finally {
      this.starting = false
    }
  }

  private async startAccount(client: YotoClient): Promise<void> {
    if (this.account?.running) {
      await this.account.stop()
    }

    const tokens = getDb().getAuthTokens()
    if (!tokens) return

    this.account = new YotoAccount({
      clientOptions: {
        clientId: config.yotoClientId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userAgent: 'YotoTrackSkip/1.0.0',
        onTokenRefresh: async (event) => {
          getDb().saveAuthTokens({
            accessToken: event.updatedAccessToken,
            refreshToken: event.updatedRefreshToken,
            expiresAt: new Date(event.updatedExpiresAt * 1000).toISOString()
          })
        }
      },
      deviceOptions: {
        httpPollIntervalMs: 60000
      }
    })

    const lastCardByDevice = new Map<string, string>()

    this.account.on('error', ({ error, context }) => {
      this.lastError = reauthMessage(formatYotoApiError(error))
      console.error('[yoto] Account error:', this.lastError, context)
    })

    this.account.on('playbackUpdate', ({ deviceId, playback }) => {
      if (!this.skipEngine || !playback) return

      console.log(
        `[yoto] playback ${deviceId}: card=${playback.cardId ?? 'none'} track=${playback.trackKey ?? 'none'} status=${playback.playbackStatus ?? 'unknown'} source=${playback.source ?? 'unknown'}`
      )

      if (playback.playbackStatus === 'stopped' && playback.cardId) {
        this.skipEngine.resetSession(deviceId, playback.cardId)
        lastCardByDevice.delete(deviceId)
        return
      }

      let cardInserted = false
      if (playback.cardId) {
        const previousCard = lastCardByDevice.get(deviceId)
        cardInserted = previousCard !== playback.cardId
        if (previousCard && previousCard !== playback.cardId) {
          this.skipEngine.resetSession(deviceId, previousCard)
        }
        lastCardByDevice.set(deviceId, playback.cardId)
      }

      const event: PlaybackEvent = {
        deviceId,
        deviceName: this.getDeviceName(deviceId),
        cardId: playback.cardId ?? '',
        cardTitle: playback.cardTitle ?? undefined,
        chapterKey: playback.chapterKey ?? '',
        chapterTitle: playback.chapterTitle ?? undefined,
        trackKey: playback.trackKey ?? '',
        trackTitle: playback.trackTitle ?? undefined,
        playbackStatus: playback.playbackStatus ?? 'stopped',
        source: playback.source ?? undefined,
        cardInserted
      }

      void this.skipEngine.handlePlayback(event).catch((error) => {
        console.error(`[skip-engine] Failed to handle playback on ${deviceId}:`, error)
      })
    })

    try {
      await this.account.start()
      await this.refreshDeviceCatalog(client)
    } catch (error) {
      this.lastError = reauthMessage(formatYotoApiError(error))
      throw error
    }
  }

  private async refreshDeviceCatalog(client: YotoClient): Promise<void> {
    const { devices } = await client.getDevices()
    this.deviceCatalog.clear()
    for (const device of devices) {
      this.deviceCatalog.set(device.deviceId, {
        deviceId: device.deviceId,
        name: device.name,
        description: device.description,
        deviceType: device.deviceType,
        deviceFamily: device.deviceFamily,
        online: device.online
      })
    }
  }

  private getDeviceName(deviceId: string): string {
    return this.deviceCatalog.get(deviceId)?.name ?? deviceId
  }

  async stop(): Promise<void> {
    if (this.account?.running) {
      await this.account.stop()
    }
    this.account = null
    this.deviceCatalog.clear()
  }

  async restart(skipEngine: SkipEngine): Promise<void> {
    await this.stop()
    await this.start(skipEngine)
  }

  isRunning(): boolean {
    return this.account?.running ?? false
  }

  getLastError(): string | null {
    return this.lastError
  }

  getClient(): YotoClient | null {
    return this.account?.client ?? authService.getClient()
  }

  async ensureRunning(): Promise<void> {
    if (this.account?.running || this.starting) return
    if (!authService.isAuthenticated()) return

    try {
      await this.start(getSkipEngine())
    } catch (error) {
      console.warn('[yoto] Failed to auto-start service:', error)
    }
  }

  async listDevices(): Promise<{ devices: DeviceStatus[]; error?: string }> {
    await this.ensureRunning()

    const client = this.getClient()
    if (!client) {
      return { devices: [], error: this.lastError ?? 'Not authenticated' }
    }

    try {
      await this.refreshDeviceCatalog(client)
    } catch (error) {
      const message = reauthMessage(formatYotoApiError(error))
      this.lastError = message
      return { devices: [], error: message }
    }

    const devices = await Promise.all(
      Array.from(this.deviceCatalog.values()).map(async (device) => {
        const model = this.account?.getDevice(device.deviceId)
        let online = device.online
        let batteryLevel: number | undefined
        let activeCard: string | undefined

        try {
          const status = await client.getDeviceStatus({ deviceId: device.deviceId })
          online = status.isOnline || device.online
          batteryLevel = status.batteryLevelPercentage
          activeCard = status.activeCard && status.activeCard !== 'none' ? status.activeCard : undefined
        } catch (error) {
          console.warn(`[yoto] getDeviceStatus failed for ${device.deviceId}:`, error)
          try {
            const configResponse = await client.getDeviceConfig({ deviceId: device.deviceId })
            online = configResponse.device.online || device.online
          } catch {
            // fall through to model state
          }
          if (model) {
            online = online || model.deviceOnline
            batteryLevel = batteryLevel ?? model.status.batteryLevelPercentage
            activeCard = activeCard ?? model.status.activeCardId ?? model.playback?.cardId ?? undefined
          }
        }

        if (model?.mqttConnected) {
          void model.requestStatus().catch(() => {})
        }

        return {
          ...device,
          online: online || device.online || (model?.deviceOnline ?? false),
          mqttConnected: model?.mqttConnected ?? false,
          batteryLevel: batteryLevel ?? model?.status.batteryLevelPercentage,
          activeCard: activeCard ?? model?.status.activeCardId ?? model?.playback?.cardId ?? undefined
        }
      })
    )

    return { devices, error: this.lastError ?? undefined }
  }

  async getCards() {
    const client = this.getClient()
    if (!client) throw new Error('Not authenticated')
    return listUserCards(client)
  }

  async getCardContent(cardId: string, force = false) {
    const client = this.getClient()
    if (!client) throw new Error('Not authenticated')
    return fetchCardContent(client, cardId, force)
  }

  async performSkip(
    deviceId: string,
    action: {
      cardId: string
      chapterKey: string
      trackKey: string
      skippedTrackKey: string
      skippedTrackTitle: string
      jumpedToTrackTitle: string
    }
  ): Promise<ActivityEntry> {
    const device = this.account?.getDevice(deviceId)
    if (!device) {
      throw new Error(`Device ${deviceId} not found`)
    }
    if (!device.mqttConnected) {
      throw new Error(`Device ${deviceId} is not connected via MQTT`)
    }

    console.log(
      `[yoto] startCard ${action.cardId} ${action.chapterKey}/${action.trackKey} on ${deviceId}`
    )

    await device.startCard({
      cardId: action.cardId,
      chapterKey: action.chapterKey,
      trackKey: action.trackKey,
      secondsIn: 0
    })

    const content = getDb().getCachedCard(action.cardId)
    const cardTitle = content?.title ?? action.cardId

    return getDb().addActivity({
      timestamp: new Date().toISOString(),
      deviceId,
      deviceName: this.getDeviceName(deviceId),
      cardId: action.cardId,
      cardTitle,
      skippedTrackKey: action.skippedTrackKey,
      skippedTrackTitle: action.skippedTrackTitle,
      jumpedToTrackKey: action.trackKey,
      jumpedToTrackTitle: action.jumpedToTrackTitle
    })
  }

  async stopCard(deviceId: string, cardId: string): Promise<void> {
    const device = this.account?.getDevice(deviceId)
    if (!device?.mqttClient) return
    await device.mqttClient.stopCard().catch(() => {})
    this.skipEngine?.resetSession(deviceId, cardId)
  }
}

export const yotoService = new YotoService()

let skipEngineInstance: SkipEngine | null = null

export function getSkipEngine(): SkipEngine {
  if (!skipEngineInstance) {
    skipEngineInstance = createSkipEngine()
  }
  return skipEngineInstance
}

export function createSkipEngine(): SkipEngine {
  return new SkipEngine(getDb(), {
    getCardContent: async (cardId, force = false) => {
      const cached = getDb().getCachedCard(cardId)
      if (cached && !force && cached.chapters.length > 0) return cached
      try {
        return await yotoService.getCardContent(cardId, force)
      } catch (error) {
        console.warn(`[skip-engine] Failed to fetch content for ${cardId}:`, error)
        return cached ?? null
      }
    },
    onSkip: async (deviceId, action) => {
      await yotoService.performSkip(deviceId, action)
    },
    onStop: async (deviceId, cardId) => {
      await yotoService.stopCard(deviceId, cardId)
    },
    log: (message) => {
      console.log(`[skip-engine] ${message}`)
    }
  })
}
