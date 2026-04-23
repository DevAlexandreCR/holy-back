import { config } from '../config/env'
import { connectToDatabase, disconnectFromDatabase, prisma } from '../config/db'
import {
  HOLYVERSO_RETRY_CUTOFF,
  HOLYVERSO_SLOT_TIMES,
} from '../modules/holyverso/holyverso.constants'
import {
  ensureHolyversoDailyBatch,
  publishDueHolyversoSlots,
} from '../modules/holyverso/holyversoGeneration.service'
import {
  buildHolyversoScheduledDate,
  getHolyversoLocalDateKey,
} from '../modules/holyverso/holyverso.time'

type CliOptions = {
  now?: string
  localDate?: string
  slot?: number
  allDue: boolean
  minutesAfter: number
}

const HELP_TEXT = `
Usage:
  npm run test:holyverso-publish -- [--slot <1-5>] [--date <YYYY-MM-DD>] [--minutes-after <n>]
  npm run test:holyverso-publish -- --all-due [--date <YYYY-MM-DD>] [--minutes-after <n>]
  npm run test:holyverso-publish -- --now <ISO_DATE>

Notes:
  If you omit --date and --now, the script uses the next HolyVerso local day by default.
  That avoids collisions with the live scheduler running against the current local day.

Examples:
  npm run test:holyverso-publish -- --slot 1
  npm run test:holyverso-publish -- --slot 3 --date 2026-04-22
  npm run test:holyverso-publish -- --all-due
  npm run test:holyverso-publish -- --now 2026-04-22T20:05:00-05:00
`.trim()

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    allDue: false,
    minutesAfter: 5,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT)
      process.exit(0)
    }

    if (arg === '--all-due') {
      options.allDue = true
      continue
    }

    if (arg === '--now') {
      if (!next) {
        throw new Error('Missing value for --now')
      }
      options.now = next
      index += 1
      continue
    }

    if (arg === '--date') {
      if (!next) {
        throw new Error('Missing value for --date')
      }
      options.localDate = next
      index += 1
      continue
    }

    if (arg === '--slot') {
      if (!next) {
        throw new Error('Missing value for --slot')
      }
      options.slot = Number(next)
      index += 1
      continue
    }

    if (arg === '--minutes-after') {
      if (!next) {
        throw new Error('Missing value for --minutes-after')
      }
      options.minutesAfter = Number(next)
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.now && (options.slot !== undefined || options.allDue || options.localDate)) {
    throw new Error('--now cannot be combined with --slot, --all-due, or --date')
  }

  if (options.slot !== undefined && options.allDue) {
    throw new Error('--slot cannot be combined with --all-due')
  }

  if (options.slot !== undefined && (!Number.isInteger(options.slot) || options.slot < 1 || options.slot > HOLYVERSO_SLOT_TIMES.length)) {
    throw new Error(`--slot must be an integer between 1 and ${HOLYVERSO_SLOT_TIMES.length}`)
  }

  if (!Number.isFinite(options.minutesAfter) || options.minutesAfter < 0) {
    throw new Error('--minutes-after must be a number >= 0')
  }

  return options
}

const getDefaultTestLocalDate = () => {
  const now = new Date()
  const todayLocalDate = getHolyversoLocalDateKey(now)
  const retryCutoff = buildHolyversoScheduledDate(
    todayLocalDate,
    HOLYVERSO_RETRY_CUTOFF
  )

  if (now.getTime() >= retryCutoff.getTime()) {
    return getHolyversoLocalDateKey(
      new Date(now.getTime() + 24 * 60 * 60 * 1000)
    )
  }

  return getHolyversoLocalDateKey(
    new Date(now.getTime() + 24 * 60 * 60 * 1000)
  )
}

const resolveSimulationDate = (options: CliOptions) => {
  if (options.now) {
    const resolvedNow = new Date(options.now)
    if (Number.isNaN(resolvedNow.getTime())) {
      throw new Error('Invalid value for --now. Use an ISO date string.')
    }

    return resolvedNow
  }

  const localDate = options.localDate ?? getDefaultTestLocalDate()
  const targetTime =
    options.allDue || options.slot === undefined
      ? HOLYVERSO_SLOT_TIMES[HOLYVERSO_SLOT_TIMES.length - 1]
      : HOLYVERSO_SLOT_TIMES[options.slot - 1]

  const scheduledFor = buildHolyversoScheduledDate(localDate, targetTime)

  return new Date(scheduledFor.getTime() + options.minutesAfter * 60 * 1000)
}

const printBatchState = async (now: Date) => {
  const batch = await ensureHolyversoDailyBatch(now)

  if (!batch) {
    console.log('No HolyVerso batch found for the simulated date.')
    return
  }

  const refreshedBatch = await prisma.holyversoGenerationBatch.findUnique({
    where: { id: batch.id },
    include: {
      slots: {
        orderBy: {
          slotIndex: 'asc',
        },
      },
    },
  })

  if (!refreshedBatch) {
    console.log('HolyVerso batch disappeared before reporting.')
    return
  }

  console.log(`batch_id=${refreshedBatch.id}`)
  console.log(`local_date=${refreshedBatch.localDate}`)
  console.log(`batch_status=${refreshedBatch.status}`)
  console.log(`published_count=${refreshedBatch.publishedCount}/${refreshedBatch.targetCount}`)

  refreshedBatch.slots.forEach((slot) => {
    console.log(
      [
        `slot=${slot.slotIndex + 1}`,
        `scheduled_for=${slot.scheduledFor.toISOString()}`,
        `status=${slot.status}`,
        `retry_count=${slot.retryCount}`,
        `devotional_id=${slot.devotionalId ?? ''}`,
        `failure_code=${slot.failureCode ?? ''}`,
      ].join(' ')
    )
  })
}

async function run() {
  const options = parseArgs(process.argv.slice(2))

  if (!config.holyverso.isConfigured) {
    throw new Error(
      'HolyVerso is not configured. Check OPENAI_API_KEY, OPENAI_HOLYVERSO_TEXT_MODEL, and OPENAI_HOLYVERSO_IMAGE_MODEL.'
    )
  }

  const simulatedNow = resolveSimulationDate(options)

  try {
    await connectToDatabase()

    if (!options.localDate && !options.now) {
      console.log(
        `No test date provided. Using next HolyVerso local day: ${getHolyversoLocalDateKey(simulatedNow)}`
      )
    }

    const batch = await ensureHolyversoDailyBatch(simulatedNow)
    const result = await publishDueHolyversoSlots(simulatedNow)

    console.log(`simulated_now=${simulatedNow.toISOString()}`)
    console.log(`batch_ready=${batch?.id ?? ''}`)
    console.log(`processed=${result.processed}`)
    console.log(`published=${result.published}`)
    console.log(`failed=${result.failed}`)
    console.log(`expired=${result.expired}`)

    await printBatchState(simulatedNow)
  } finally {
    await disconnectFromDatabase().catch(() => undefined)
  }
}

void run().catch((error) => {
  console.error('HolyVerso local publish test failed:', error)
  process.exitCode = 1
})
