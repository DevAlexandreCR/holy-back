import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { runDevotionalTagAffinityDecay } from '../modules/devotionals/devotionalPersonalization.service'

const runTagAffinityDecayJob = async () => {
  const result = await runDevotionalTagAffinityDecay()
  console.log('[DevotionalTagAffinityDecayJob] Applied pending decay', result)
}

export const registerDevotionalTagAffinityDecayJob = (): ScheduledTask => {
  console.log(
    `[DevotionalTagAffinityDecayJob] Registering cron at "${config.jobs.devotionalTagAffinityDecayCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.devotionalTagAffinityDecayCron,
    async () => {
      try {
        await runTagAffinityDecayJob()
      } catch (error) {
        console.error(
          '[DevotionalTagAffinityDecayJob] Unhandled error during scheduled run',
          error
        )
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runDevotionalTagAffinityDecayOnce = async () => {
  try {
    await runTagAffinityDecayJob()
  } catch (error) {
    console.error('[DevotionalTagAffinityDecayJob] Initial run failed', error)
  }
}
