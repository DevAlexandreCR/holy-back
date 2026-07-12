import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { sendWinbackNotifications } from '../modules/notifications/notification.service'

const runWinbackJob = async () => {
  const result = await sendWinbackNotifications()
  console.log('[WinbackJob] Evaluated winback notifications', result)
}

export const registerWinbackJob = (): ScheduledTask => {
  console.log(`[WinbackJob] Registering cron at "${config.jobs.winbackCron}" (UTC)`)

  return cron.schedule(
    config.jobs.winbackCron,
    async () => {
      try {
        await runWinbackJob()
      } catch (error) {
        console.error('[WinbackJob] Unhandled error during scheduled run', error)
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runWinbackOnce = async () => {
  try {
    await runWinbackJob()
  } catch (error) {
    console.error('[WinbackJob] Initial run failed', error)
  }
}
