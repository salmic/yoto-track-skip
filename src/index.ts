import { config } from './config.js'
import { authService } from './auth/yoto-auth.js'
import { getSkipEngine, yotoService } from './yoto/service.js'
import { createApp } from './web/server.js'

async function main(): Promise<void> {
  if (authService.isAuthenticated()) {
    try {
      await yotoService.start(getSkipEngine())
      console.log('Yoto service started')
    } catch (error) {
      console.error('Failed to start Yoto service:', error)
    }
  } else {
    console.log('Not authenticated — open the web UI to connect your Yoto account')
  }

  const app = createApp()
  app.listen(config.port, config.host, () => {
    console.log(`Yoto Track Skip running at http://localhost:${config.port}`)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
