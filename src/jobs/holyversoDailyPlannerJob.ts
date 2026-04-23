import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { ensureHolyversoDailyBatch } from '../modules/holyverso/holyversoGeneration.service'

const runPlannerJob = async () => {
  if (!config.holyverso.isConfigured) {
    console.log('[HolyversoDailyPlannerJob] Skipping run because HolyVerso is not configured')
    return
  }

  const batch = await ensureHolyversoDailyBatch()
  console.log('[HolyversoDailyPlannerJob] Planned batch', {
    batchId: batch?.id ?? null,
    localDate: batch?.localDate ?? null,
    slots: batch?.slots.length ?? 0,
  })
}

export const registerHolyversoDailyPlannerJob = (): ScheduledTask => {
  console.log(
    `[HolyversoDailyPlannerJob] Registering cron at "${config.jobs.holyversoDailyPlannerCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.holyversoDailyPlannerCron,
    async () => {
      try {
        await runPlannerJob()
      } catch (error) {
        console.error('[HolyversoDailyPlannerJob] Unhandled error during scheduled run', error)
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runHolyversoDailyPlannerOnce = async () => {
  try {
    await runPlannerJob()
  } catch (error) {
    console.error('[HolyversoDailyPlannerJob] Initial run failed', error)
  }
}
