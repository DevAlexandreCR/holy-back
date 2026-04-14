import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { runDevotionalDailyFeatureCandidateRefresh } from '../modules/devotionals/devotionalPersonalization.service'

const runDailyFeatureCandidatesJob = async () => {
  const result = await runDevotionalDailyFeatureCandidateRefresh()
  console.log('[DevotionalDailyFeatureCandidatesJob] Refreshed candidate pools', result)
}

export const registerDevotionalDailyFeatureCandidatesJob = (): ScheduledTask => {
  console.log(
    `[DevotionalDailyFeatureCandidatesJob] Registering cron at "${config.jobs.devotionalDailyFeatureCandidatesCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.devotionalDailyFeatureCandidatesCron,
    async () => {
      try {
        await runDailyFeatureCandidatesJob()
      } catch (error) {
        console.error(
          '[DevotionalDailyFeatureCandidatesJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runDevotionalDailyFeatureCandidatesOnce = async () => {
  try {
    await runDailyFeatureCandidatesJob()
  } catch (error) {
    console.error('[DevotionalDailyFeatureCandidatesJob] Initial run failed', error)
  }
}
