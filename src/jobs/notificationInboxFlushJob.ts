import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { flushPendingReactionNotificationPushes } from '../modules/notifications/notificationInbox.service'

const runNotificationInboxFlushJob = async () => {
  const result = await flushPendingReactionNotificationPushes()
  console.log('[NotificationInboxFlushJob] Processed creator-activity notification windows', result)
}

export const registerNotificationInboxFlushJob = (): ScheduledTask => {
  console.log(
    `[NotificationInboxFlushJob] Registering cron at "${config.jobs.notificationInboxFlushCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.notificationInboxFlushCron,
    async () => {
      try {
        await runNotificationInboxFlushJob()
      } catch (error) {
        console.error(
          '[NotificationInboxFlushJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runNotificationInboxFlushOnce = async () => {
  try {
    await runNotificationInboxFlushJob()
  } catch (error) {
    console.error('[NotificationInboxFlushJob] Initial run failed', error)
  }
}
