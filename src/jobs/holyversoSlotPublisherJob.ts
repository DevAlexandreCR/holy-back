import cron, { ScheduledTask } from 'node-cron'
import { config } from '../config/env'
import { publishDueHolyversoSlots } from '../modules/holyverso/holyversoGeneration.service'

const runSlotPublisherJob = async () => {
  if (!config.holyverso.isConfigured) {
    console.log('[HolyversoSlotPublisherJob] Skipping run because HolyVerso is not configured')
    return
  }

  const result = await publishDueHolyversoSlots()
  console.log('[HolyversoSlotPublisherJob] Processed due slots', result)
}

export const registerHolyversoSlotPublisherJob = (): ScheduledTask => {
  console.log(
    `[HolyversoSlotPublisherJob] Registering cron at "${config.jobs.holyversoSlotPublisherCron}" (UTC)`
  )

  return cron.schedule(
    config.jobs.holyversoSlotPublisherCron,
    async () => {
      try {
        await runSlotPublisherJob()
      } catch (error) {
        console.error('[HolyversoSlotPublisherJob] Unhandled error during scheduled run', error)
      }
    },
    {
      timezone: 'UTC',
    }
  )
}

export const runHolyversoSlotPublisherOnce = async () => {
  try {
    await runSlotPublisherJob()
  } catch (error) {
    console.error('[HolyversoSlotPublisherJob] Initial run failed', error)
  }
}
