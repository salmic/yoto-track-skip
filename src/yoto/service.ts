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
      const raw = formatYotoApiError(error)
      const friendly = reauthMessage(raw)
      this.lastError = friendly
      console.error(
        '[yoto] Account error:',
        friendly,
        context,
        raw !== friendly ? { raw } : undefined
      )
    })

    this.account.on('playbackUpdate', ({ deviceId, playback }) => {
      if (!this.skipEngine || !playback) return

      const deviceName = this.getDeviceName(deviceId)
      const cardLabel = playback.cardId
        ? this.getCardTitle(playback.cardId, playback.cardTitle ?? undefined)
        : 'none'

      console.log(
        `[yoto] playback ${deviceName}: card=${cardLabel} track=${playback.trackKey ?? 'none'} status=${playback.playbackStatus ?? 'unknown'} source=${playback.source ?? 'unknown'}`
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
        if (cardInserted) {
          void this.getCardContent(playback.cardId).catch((error) => {
            console.warn(`[yoto] Failed to prefetch card ${cardLabel}:`, error)
          })
        }
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
        cardInserted,
        positionSec:
          typeof playback.position === 'number' ? playback.position : undefined,
        trackLengthSec:
          typeof playback.trackLength === 'number'
            ? playback.trackLength
            : undefined
      }

      void this.skipEngine.handlePlayback(event).catch((error) => {
        console.error(`[skip-engine] Failed to handle playback on ${deviceName}:`, error)
      })
    })

    try {
      await this.account.start()
      await this.refreshDeviceCatalog(client)
      this.warmSkipProfileCaches()
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

  private getCardTitle(cardId: string, playbackTitle?: string): string {
    return (
      playbackTitle ??
      getDb().getCachedCard(cardId)?.title ??
      getDb().getProfile(cardId)?.cardTitle ??
      cardId
    )
  }

  warmSkipProfileCaches(): void {
    if (!this.getClient()) return
    for (const profile of getDb().listProfiles()) {
      if (!profile.enabled || profile.skipTrackKeys.length === 0) continue
      void this.getCardContent(profile.cardId).catch((error) => {
        console.warn(
          `[yoto] Failed to warm cache for ${profile.cardTitle ?? profile.cardId}:`,
          error
        )
      })
    }
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

        if (model?.mqttConnected) {
          await model.requestStatus().catch(() => {})
        }

        const online = device.online || (model?.deviceOnline ?? false)
        const batteryLevel = model?.status.batteryLevelPercentage
        const activeCard =
          model?.status.activeCardId ?? model?.playback?.cardId ?? undefined

        return {
          ...device,
          online,
          mqttConnected: model?.mqttConnected ?? false,
          batteryLevel,
          activeCard
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
    const deviceName = this.getDeviceName(deviceId)
    const device = this.account?.getDevice(deviceId)
    if (!device) {
      throw new Error(`Device ${deviceName} not found`)
    }
    if (!device.mqttConnected) {
      throw new Error(`Device ${deviceName} is not connected via MQTT`)
    }

    const cardTitle = this.getCardTitle(action.cardId)

    console.log(
      `[yoto] startCard ${cardTitle} ${action.chapterKey}/${action.trackKey} on ${deviceName}`
    )

    await device.startCard({
      cardId: action.cardId,
      chapterKey: action.chapterKey,
      trackKey: action.trackKey,
      secondsIn: 0
    })

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
        const profile = getDb().getProfile(cardId)
        const cardLabel = cached?.title ?? profile?.cardTitle ?? cardId
        console.warn(`[skip-engine] Failed to fetch content for ${cardLabel}:`, error)
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
