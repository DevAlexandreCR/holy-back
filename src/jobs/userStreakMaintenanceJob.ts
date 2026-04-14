import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { runUserStreakMaintenance } from '../modules/devotionals/devotionalEngagement.service'

const runStreakMaintenanceJob = async () => {
  const result = await runUserStreakMaintenance()
  console.log(
    `[UserStreakMaintenanceJob] Reconciled ${result.processed} user streaks`
  )
}

export const registerUserStreakMaintenanceJob = (): ScheduledTask => {
  console.log(
    `[UserStreakMaintenanceJob] Registering cron at "${config.jobs.userStreakMaintenanceCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.userStreakMaintenanceCron,
    async () => {
      try {
        await runStreakMaintenanceJob()
      } catch (error) {
        console.error(
          '[UserStreakMaintenanceJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runUserStreakMaintenanceOnce = async () => {
  try {
    await runStreakMaintenanceJob()
  } catch (error) {
    console.error('[UserStreakMaintenanceJob] Initial run failed', error)
  }
}
