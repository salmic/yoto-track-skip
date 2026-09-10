import { execSync } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config()

const port = process.env.PORT ?? '3847'

function findListeningPids(targetPort) {
  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: 'utf8' })
      const pids = new Set()

      for (const line of output.split('\n')) {
        if (!line.includes('LISTENING')) continue
        const parts = line.trim().split(/\s+/)
        const pid = parts.at(-1)
        if (pid && pid !== '0') pids.add(pid)
      }

      return [...pids]
    } catch (error) {
      if (error.status === 1) return []
      throw error
    }
  }

  try {
    const output = execSync(`lsof -ti tcp:${targetPort}`, { encoding: 'utf8' })
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch (error) {
    if (error.status === 1) return []
    throw error
  }
}

function killPid(pid) {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' })
    return
  }

  execSync(`kill -9 ${pid}`, { stdio: 'inherit' })
}

const pids = findListeningPids(port)

if (pids.length === 0) {
  console.log(`No process listening on port ${port}`)
  process.exit(0)
}

for (const pid of pids) {
  killPid(pid)
}

console.log(`Stopped process(es) on port ${port}`)
