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

const MARKER = 'yoto-track-skip: deprecated getDeviceStatus API not used'

if (!fs.existsSync(devicePath)) {
  console.warn('[patch-yoto-client] yoto-device.js not found; skipping')
  process.exit(0)
}

let source = fs.readFileSync(devicePath, 'utf8')
if (source.includes(MARKER)) {
  process.exit(0)
}

const replacements = [
  [
    `      // Fetch device status from status endpoint (optional scope; MQTT is primary)
      try {
        const statusResponse = await this.#client.getDeviceStatus({
          deviceId: this.#state.device.deviceId
        })
        this.#updateStatusFromStatusResponse(statusResponse)
      } catch {
        // family:device-status:view may be unavailable; continue with config/MQTT
      }

      // Also update from full status if available in config response`,
    `      // ${MARKER}
      // Also update from full status if available in config response`
  ],
  [
    `      // Fetch device status from status endpoint
      const statusResponse = await this.#client.getDeviceStatus({
        deviceId: this.#state.device.deviceId
      })

      // Update status from dedicated status endpoint
      this.#updateStatusFromStatusResponse(statusResponse)

      // Also update from full status if available in config response`,
    `      // ${MARKER}
      // Also update from full status if available in config response`
  ],
  [
    `    // Also fetch and update status from status endpoint (optional scope)
    try {
      const statusResponse = await this.#client.getDeviceStatus({
        deviceId: this.#state.device.deviceId
      })
      this.#updateStatusFromStatusResponse(statusResponse)
    } catch {
      // ignore; MQTT/config may still provide status
    }

`,
    ''
  ],
  [
    `    // Also fetch and update status from status endpoint
    const statusResponse = await this.#client.getDeviceStatus({
      deviceId: this.#state.device.deviceId
    })
    this.#updateStatusFromStatusResponse(statusResponse)

`,
    ''
  ],
  [
    `      // Fetch and update status from status endpoint
      const statusResponse = await this.#client.getDeviceStatus({
        deviceId: this.#state.device.deviceId
      })
      this.#updateStatusFromStatusResponse(statusResponse)

      // Also update from full status if available in config response`,
    `      // ${MARKER}
      // Also update from full status if available in config response`
  ]
]

let applied = false
for (const [from, to] of replacements) {
  if (source.includes(from)) {
    source = source.replace(from, to)
    applied = true
  }
}

if (!source.includes(MARKER)) {
  console.error(
    '[patch-yoto-client] Could not remove getDeviceStatus calls; yoto-device.js layout may have changed'
  )
  process.exit(1)
}

fs.writeFileSync(devicePath, source)
console.log('[patch-yoto-client] Removed deprecated getDeviceStatus HTTP calls from yoto-device.js')
