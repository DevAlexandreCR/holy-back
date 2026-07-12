import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { sendDailyReminderNotifications } from '../modules/notifications/notification.service'

const runDailyReminderJob = async () => {
  const result = await sendDailyReminderNotifications()
  console.log('[DailyReminderJob] Evaluated daily reminder notifications', result)
}

export const registerDailyReminderJob = (): ScheduledTask => {
  console.log(
    `[DailyReminderJob] Registering cron at "${config.jobs.dailyReminderCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.dailyReminderCron,
    async () => {
      try {
        await runDailyReminderJob()
      } catch (error) {
        console.error(
          '[DailyReminderJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runDailyReminderOnce = async () => {
  try {
    await runDailyReminderJob()
  } catch (error) {
    console.error('[DailyReminderJob] Initial run failed', error)
  }
}
