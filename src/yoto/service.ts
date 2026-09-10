import { YotoAccount, type YotoClient } from 'yoto-nodejs-client'
import { authService } from '../auth/yoto-auth.js'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { SkipEngine } from '../skip/engine.js'
import { fetchCardContent, listUserCards } from './content.js'
import type { ActivityEntry, DeviceInfo, DeviceStatus, PlaybackEvent } from '../types.js'

export class YotoService {
  private account: YotoAccount | null = null
  private skipEngine: SkipEngine | null = null
  private starting = false
  private deviceCatalog = new Map<string, DeviceInfo>()

  async start(skipEngine: SkipEngine): Promise<void> {
    if (this.starting || this.account?.running) return
    this.starting = true
    this.skipEngine = skipEngine

    try {
      const client = await authService.initializeClient()
      if (!client) {
        this.starting = false
        return
      }

      await this.startAccount(client)
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
        httpPollIntervalMs: 600000
      }
    })

    const lastCardByDevice = new Map<string, string>()

    this.account.on('playbackUpdate', ({ deviceId, playback }) => {
      if (!this.skipEngine || !playback) return

      if (playback.playbackStatus === 'stopped' && playback.cardId) {
        this.skipEngine.resetSession(deviceId, playback.cardId)
        lastCardByDevice.delete(deviceId)
        return
      }

      if (playback.cardId) {
        const previousCard = lastCardByDevice.get(deviceId)
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
        source: playback.source ?? undefined
      }

      void this.skipEngine.handlePlayback(event)
    })

    await this.account.start()
    await this.refreshDeviceCatalog(client)
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

  getClient(): YotoClient | null {
    return this.account?.client ?? authService.getClient()
  }

  async listDevices(): Promise<DeviceStatus[]> {
    const client = this.getClient()
    if (!client) return []

    await this.refreshDeviceCatalog(client)

    return Array.from(this.deviceCatalog.values()).map((device) => {
      const model = this.account?.getDevice(device.deviceId)
      return {
        ...device,
        online: model?.deviceOnline ?? device.online,
        mqttConnected: model?.mqttConnected ?? false,
        batteryLevel: model?.status?.batteryLevelPercentage,
        activeCard: model?.status?.activeCardId ?? model?.playback?.cardId ?? undefined
      }
    })
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

    await device.startCard({
      cardId: action.cardId,
      chapterKey: action.chapterKey,
      trackKey: action.trackKey
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

export function createSkipEngine(): SkipEngine {
  return new SkipEngine(getDb(), {
    getCardContent: async (cardId) => {
      const cached = getDb().getCachedCard(cardId)
      if (cached) return cached
      try {
        return await yotoService.getCardContent(cardId)
      } catch {
        return null
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
