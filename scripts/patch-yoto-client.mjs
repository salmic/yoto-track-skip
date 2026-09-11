import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devicePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'yoto-nodejs-client',
  'lib',
  'yoto-device.js'
)

const MARKER = 'family:device-status:view may be unavailable'

if (!fs.existsSync(devicePath)) {
  console.warn('[patch-yoto-client] yoto-device.js not found; skipping')
  process.exit(0)
}

let source = fs.readFileSync(devicePath, 'utf8')
if (source.includes(MARKER)) {
  process.exit(0)
}

const startBlock = `      // Fetch device status from status endpoint
      const statusResponse = await this.#client.getDeviceStatus({
        deviceId: this.#state.device.deviceId
      })

      // Update status from dedicated status endpoint
      this.#updateStatusFromStatusResponse(statusResponse)

      // Also update from full status if available in config response`

const startReplacement = `      // Fetch device status from status endpoint (optional scope; MQTT is primary)
      try {
        const statusResponse = await this.#client.getDeviceStatus({
          deviceId: this.#state.device.deviceId
        })
        this.#updateStatusFromStatusResponse(statusResponse)
      } catch {
        // family:device-status:view may be unavailable; continue with config/MQTT
      }

      // Also update from full status if available in config response`

const refreshBlock = `    // Also fetch and update status from status endpoint
    const statusResponse = await this.#client.getDeviceStatus({
      deviceId: this.#state.device.deviceId
    })
    this.#updateStatusFromStatusResponse(statusResponse)`

const refreshReplacement = `    // Also fetch and update status from status endpoint (optional scope)
    try {
      const statusResponse = await this.#client.getDeviceStatus({
        deviceId: this.#state.device.deviceId
      })
      this.#updateStatusFromStatusResponse(statusResponse)
    } catch {
      // ignore; MQTT/config may still provide status
    }`

if (!source.includes(startBlock)) {
  console.error(
    '[patch-yoto-client] Unexpected yoto-device.js start(); patch not applied'
  )
  process.exit(1)
}

source = source.replace(startBlock, startReplacement)

if (source.includes(refreshBlock)) {
  source = source.replace(refreshBlock, refreshReplacement)
}

fs.writeFileSync(devicePath, source)
console.log('[patch-yoto-client] Patched yoto-device.js for optional device-status API')
