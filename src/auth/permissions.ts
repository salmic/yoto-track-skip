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

export function isMissingDeviceScope(message: string): boolean {
  return (
    message.includes('family:devices:view') ||
    message.includes('family:device-status:view') ||
    message.includes('family:devices:control')
  )
}

export function reauthMessage(message: string): string {
  if (isMissingDeviceScope(message)) {
    return 'Your Yoto login is missing device permissions. Log out and sign in again to enable auto-skip and player status.'
  }
  return message
}
