import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { rebuildDailyAggregates } from '../modules/analytics/analytics.service'

const runDailyAggregatesJob = async () => {
  const result = await rebuildDailyAggregates({ trailingDays: 7 })
  console.log(
    `[DailyAggregatesJob] Rebuilt ${result.devotional_rows} devotional rows from ${result.start_date} to ${result.end_date}`
  )
}

export const registerDailyAggregatesJob = (): ScheduledTask => {
  console.log(
    `[DailyAggregatesJob] Registering cron at "${config.jobs.dailyAggregatesCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.dailyAggregatesCron,
    async () => {
      try {
        await runDailyAggregatesJob()
      } catch (error) {
        console.error(
          '[DailyAggregatesJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runDailyAggregatesOnce = async () => {
  try {
    await runDailyAggregatesJob()
  } catch (error) {
    console.error('[DailyAggregatesJob] Initial run failed', error)
  }
}
