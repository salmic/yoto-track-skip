export function formatYotoApiError(error: unknown): string {
  if (error && typeof error === 'object') {
    const apiError = error as {
      textBody?: string
      jsonBody?: { error?: { message?: string; code?: string } }
      message?: string
    }

    const scopeMessage = apiError.jsonBody?.error?.message
    if (scopeMessage) return scopeMessage

    if (apiError.textBody) {
      try {
        const parsed = JSON.parse(apiError.textBody) as {
          error?: { message?: string }
        }
        if (parsed.error?.message) return parsed.error.message
      } catch {
        // fall through
      }
    }

    if (apiError.message) return apiError.message
  }

  return error instanceof Error ? error.message : 'Yoto API request failed'
}

/** Scopes required for listing/controlling players (re-login if missing). */
export function isMissingCriticalDeviceScope(message: string): boolean {
  return (
    message.includes('family:devices:view') ||
    message.includes('family:devices:control')
  )
}

/** Status HTTP API only; auto-skip uses MQTT and does not require this scope. */
export function isMissingDeviceStatusScope(message: string): boolean {
  return message.includes('family:device-status:view')
}

/** @deprecated use isMissingCriticalDeviceScope */
export function isMissingDeviceScope(message: string): boolean {
  return (
    isMissingCriticalDeviceScope(message) ||
    isMissingDeviceStatusScope(message)
  )
}

export function reauthMessage(message: string): string {
  if (isMissingCriticalDeviceScope(message)) {
    return 'Your Yoto login is missing device permissions. Log out and sign in again to enable auto-skip and player status.'
  }
  return message
}
