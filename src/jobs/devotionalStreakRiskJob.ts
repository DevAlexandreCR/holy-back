import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { sendStreakRiskNotifications } from '../modules/notifications/notification.service'

const runStreakRiskJob = async () => {
  const result = await sendStreakRiskNotifications()
  console.log('[DevotionalStreakRiskJob] Evaluated streak-risk notifications', result)
}

export const registerDevotionalStreakRiskJob = (): ScheduledTask => {
  console.log(
    `[DevotionalStreakRiskJob] Registering cron at "${config.jobs.devotionalStreakRiskCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.devotionalStreakRiskCron,
    async () => {
      try {
        await runStreakRiskJob()
      } catch (error) {
        console.error(
          '[DevotionalStreakRiskJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runDevotionalStreakRiskOnce = async () => {
  try {
    await runStreakRiskJob()
  } catch (error) {
    console.error('[DevotionalStreakRiskJob] Initial run failed', error)
  }
}
