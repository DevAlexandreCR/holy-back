import cron, { ScheduledTask } from 'node-cron'
import { rescoreDevotionals } from '../modules/devotionals/devotional.service'

const DEVOTIONAL_RANKING_CRON = '*/15 * * * *'

const runRankingJob = async () => {
  const result = await rescoreDevotionals()
  console.log(`[DevotionalRankingJob] Rescored ${result.rescored} devotionals`)
}

export const registerDevotionalRankingJob = (): ScheduledTask => {
  console.log(
    `[DevotionalRankingJob] Registering cron at "${DEVOTIONAL_RANKING_CRON}" (UTC)`
  )

  return cron.schedule(
    DEVOTIONAL_RANKING_CRON,
    async () => {
      try {
        await runRankingJob()
      } catch (error) {
        console.error(
          '[DevotionalRankingJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runDevotionalRankingOnce = async () => {
  try {
    await runRankingJob()
  } catch (error) {
    console.error('[DevotionalRankingJob] Initial run failed', error)
  }
}
