import crypto from 'crypto'
import { Prisma, UserStreak, UserStreakFreezeEventType } from '@prisma/client'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { resolveDailyFeaturedForUser } from './devotionalPersonalization.service'

const DEFAULT_STREAK_TIMEZONE = 'America/Bogota'
const RETRYABLE_WRITE_CONFLICT_ERROR_CODES = new Set(['P2034'])
const RETRYABLE_WRITE_CONFLICT_MAX_ATTEMPTS = 5

type StreakDbClient = Prisma.TransactionClient | typeof prisma

type UserDayContext = {
  timezone: string
  localToday: string
  dayWindowStart: Date
  nextDayWindowStart: Date
}

const isRetryableWriteConflictError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  RETRYABLE_WRITE_CONFLICT_ERROR_CODES.has(error.code)

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const withRetryableWriteConflict = async <T>(operation: () => Promise<T>) => {
  let attempt = 0

  while (true) {
    try {
      return await operation()
    } catch (error) {
      attempt += 1

      if (
        !isRetryableWriteConflictError(error) ||
        attempt >= RETRYABLE_WRITE_CONFLICT_MAX_ATTEMPTS
      ) {
        throw error
      }

      await wait(50 * attempt)
    }
  }
}

const pad = (value: number) => value.toString().padStart(2, '0')

const formatDateOnly = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

const parseDateOnly = (value: string) => {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  return new Date(Date.UTC(year, month - 1, day))
}

const addDays = (value: string, days: number) => {
  const next = parseDateOnly(value)
  next.setUTCDate(next.getUTCDate() + days)
  return formatDateOnly(next)
}

const diffDateOnly = (from: string, to: string) => {
  const diffMs = parseDateOnly(to).getTime() - parseDateOnly(from).getTime()
  return Math.round(diffMs / 86400000)
}

const getZonedDateParts = (date: Date, timezone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const byType = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00'

  // Some locales/Node.js versions return hour 24 for midnight instead of 0.
  // Normalize to 0 so toUtcForLocalMidnight converges on the correct date.
  const rawHour = Number(byType('hour'))
  return {
    year: Number(byType('year')),
    month: Number(byType('month')),
    day: Number(byType('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(byType('minute')),
    second: Number(byType('second')),
  }
}

const getLocalDate = (date: Date, timezone: string) => {
  const parts = getZonedDateParts(date, timezone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

const toUtcForLocalMidnight = (dateOnly: string, timezone: string) => {
  const [year, month, day] = dateOnly.split('-').map((part) => Number(part))
  const targetUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0)
  let guessUtcMs = targetUtcMs

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = getZonedDateParts(new Date(guessUtcMs), timezone)
    const zonedUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
    const diffMs = zonedUtcMs - targetUtcMs

    if (diffMs === 0) {
      return new Date(guessUtcMs)
    }

    guessUtcMs -= diffMs
  }

  return new Date(guessUtcMs)
}

const isValidTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch (_error) {
    return false
  }
}

const resolveTimezone = (rawTimezone: string | null | undefined, userId: string) => {
  if (!rawTimezone) {
    return DEFAULT_STREAK_TIMEZONE
  }

  if (isValidTimezone(rawTimezone)) {
    return rawTimezone
  }

  console.warn('[DevotionalStreak] Invalid timezone fallback', {
    userId,
    requestedTimezone: rawTimezone,
    fallbackTimezone: DEFAULT_STREAK_TIMEZONE,
  })

  return DEFAULT_STREAK_TIMEZONE
}

const ensureUserStreak = async (db: StreakDbClient, userId: string) => {
  return db.userStreak.upsert({
    where: { userId },
    create: { userId },
    update: {},
  })
}

const lockUserStreak = async (tx: Prisma.TransactionClient, userId: string) => {
  await tx.$queryRaw`
    SELECT user_id
    FROM user_streaks
    WHERE user_id = ${userId}
    FOR UPDATE
  `
}

const createFreezeEvent = async (
  db: StreakDbClient,
  params: {
    userId: string
    eventType: UserStreakFreezeEventType
    amount: number
    balanceAfter: number
    reason: string
    metadata?: Prisma.InputJsonValue
  }
) => {
  await db.userStreakFreezeEvent.create({
    data: {
      userId: params.userId,
      eventType: params.eventType,
      amount: params.amount,
      balanceAfter: params.balanceAfter,
      reason: params.reason,
      metadata: params.metadata,
    },
  })
}

const resolveUserDayContext = async (
  db: StreakDbClient,
  userId: string
): Promise<UserDayContext> => {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  })
  const timezone = resolveTimezone(settings?.timezone, userId)
  const localToday = getLocalDate(new Date(), timezone)

  return {
    timezone,
    localToday,
    dayWindowStart: toUtcForLocalMidnight(localToday, timezone),
    nextDayWindowStart: toUtcForLocalMidnight(addDays(localToday, 1), timezone),
  }
}

const hasCompletionInLocalDay = async (
  db: StreakDbClient,
  params: {
    userId: string
    dayWindowStart: Date
    nextDayWindowStart: Date
  }
) => {
  const count = await db.devotionalReadComplete.count({
    where: {
      userId: params.userId,
      createdAt: {
        gte: params.dayWindowStart,
        lt: params.nextDayWindowStart,
      },
    },
  })

  return count > 0
}

const insertDevotionalReadComplete = async (
  db: StreakDbClient,
  params: {
    devotionalId: string
    userId: string
    deliveryId?: string | null
  }
) => {
  const created = await db.$executeRaw`
    INSERT IGNORE INTO devotional_read_completions (
      id,
      devotional_id,
      user_id,
      delivery_id,
      created_at
    )
    VALUES (
      ${crypto.randomUUID()},
      ${params.devotionalId},
      ${params.userId},
      ${params.deliveryId ?? null},
      NOW()
    )
  `

  return Number(created) > 0
}

const reconcileStreakInTransaction = async (
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    context: UserDayContext
  }
) => {
  let streak = await ensureUserStreak(tx, params.userId)
  await lockUserStreak(tx, params.userId)
  streak =
    (await tx.userStreak.findUnique({
      where: { userId: params.userId },
    })) ?? streak

  if (streak.lastGapEvaluatedDate === params.context.localToday) {
    return streak
  }

  if (!streak.lastCompletedDate || streak.lastCompletedDate >= params.context.localToday) {
    return tx.userStreak.update({
      where: { userId: params.userId },
      data: { lastGapEvaluatedDate: params.context.localToday },
    })
  }

  const dayDifference = diffDateOnly(
    streak.lastCompletedDate,
    params.context.localToday
  )

  if (dayDifference === 1) {
    return tx.userStreak.update({
      where: { userId: params.userId },
      data: { lastGapEvaluatedDate: params.context.localToday },
    })
  }

  if (
    dayDifference === 2 &&
    streak.currentStreak > 0 &&
    streak.streakFreezeCount > 0
  ) {
    const protectedDate = addDays(streak.lastCompletedDate, 1)
    const nextFreezeCount = streak.streakFreezeCount - 1
    const updated = await tx.userStreak.update({
      where: { userId: params.userId },
      data: {
        streakFreezeCount: nextFreezeCount,
        lastCompletedDate: protectedDate,
        lastGapEvaluatedDate: params.context.localToday,
      },
    })

    await createFreezeEvent(tx, {
      userId: params.userId,
      eventType: UserStreakFreezeEventType.CONSUMED,
      amount: -1,
      balanceAfter: nextFreezeCount,
      reason: 'MISSED_SINGLE_DAY',
      metadata: {
        protected_date: protectedDate,
        evaluated_date: params.context.localToday,
      },
    })

    return updated
  }

  const resetAmount = -streak.streakFreezeCount
  const updated = await tx.userStreak.update({
    where: { userId: params.userId },
    data: {
      currentStreak: 0,
      streakFreezeCount: 0,
      freezeProgressCount: 0,
      lastCompletedDate: null,
      lastGapEvaluatedDate: params.context.localToday,
    },
  })

  await createFreezeEvent(tx, {
    userId: params.userId,
    eventType: UserStreakFreezeEventType.RESET,
    amount: resetAmount,
    balanceAfter: 0,
    reason: dayDifference === 2 ? 'MISSED_DAY_WITHOUT_PROTECTION' : 'MULTI_DAY_GAP',
    metadata: {
      evaluated_date: params.context.localToday,
      previous_last_completed_date: streak.lastCompletedDate,
      day_difference: dayDifference,
    },
  })

  return updated
}

const applyFirstDailyCompletion = async (
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    streak: UserStreak
    localToday: string
  }
) => {
  const yesterday = addDays(params.localToday, -1)
  const nextCurrentStreak =
    params.streak.lastCompletedDate === yesterday
      ? params.streak.currentStreak + 1
      : 1
  const nextLongestStreak = Math.max(
    params.streak.longestStreak,
    nextCurrentStreak
  )

  let nextFreezeCount = params.streak.streakFreezeCount
  let nextFreezeProgressCount = params.streak.freezeProgressCount + 1
  const freezeGrantIntervalDays = config.engagement.freeze.grantIntervalDays
  const freezeBalanceCap = config.engagement.freeze.balanceCap

  if (nextFreezeProgressCount >= freezeGrantIntervalDays) {
    if (nextCurrentStreak >= 3 && nextFreezeCount < freezeBalanceCap) {
      nextFreezeCount = Math.min(freezeBalanceCap, nextFreezeCount + 1)
      nextFreezeProgressCount = 0

      await createFreezeEvent(tx, {
        userId: params.userId,
        eventType: UserStreakFreezeEventType.GRANTED,
        amount: 1,
        balanceAfter: nextFreezeCount,
        reason: 'STREAK_PROGRESS_REWARD',
        metadata: {
          granted_on_date: params.localToday,
          current_streak: nextCurrentStreak,
          freeze_cap: freezeBalanceCap,
          grant_interval_days: freezeGrantIntervalDays,
        },
      })
    } else if (nextCurrentStreak >= 3 && nextFreezeCount >= freezeBalanceCap) {
      nextFreezeProgressCount = 0

      await createFreezeEvent(tx, {
        userId: params.userId,
        eventType: UserStreakFreezeEventType.GRANT_SKIPPED_AT_CAP,
        amount: 0,
        balanceAfter: nextFreezeCount,
        reason: 'FREEZE_CAP_REACHED',
        metadata: {
          skipped_on_date: params.localToday,
          current_streak: nextCurrentStreak,
          freeze_cap: freezeBalanceCap,
          grant_interval_days: freezeGrantIntervalDays,
        },
      })
    }
  }

  return tx.userStreak.update({
    where: { userId: params.userId },
    data: {
      currentStreak: nextCurrentStreak,
      longestStreak: nextLongestStreak,
      streakFreezeCount: nextFreezeCount,
      freezeProgressCount: nextFreezeProgressCount,
      lastCompletedDate: params.localToday,
      lastGapEvaluatedDate: params.localToday,
    },
  })
}

export const reconcileUserStreak = async (params: { userId: string }) => {
  return withRetryableWriteConflict(() =>
    prisma.$transaction(async (tx) => {
      const context = await resolveUserDayContext(tx, params.userId)
      return reconcileStreakInTransaction(tx, {
        userId: params.userId,
        context,
      })
    })
  )
}

export const getDevotionalFeedHeader = async (params: { userId: string }) => {
  return withRetryableWriteConflict(() =>
    prisma.$transaction(async (tx) => {
      const context = await resolveUserDayContext(tx, params.userId)
      const streak = await reconcileStreakInTransaction(tx, {
        userId: params.userId,
        context,
      })
      const completedToday = await hasCompletionInLocalDay(tx, {
        userId: params.userId,
        dayWindowStart: context.dayWindowStart,
        nextDayWindowStart: context.nextDayWindowStart,
      })
      const dailyFeatured = await resolveDailyFeaturedForUser({
        userId: params.userId,
        now: new Date(),
        db: tx,
      })
      const primaryCtaType = !dailyFeatured
        ? 'BROWSE_FEED'
        : completedToday
          ? 'DAY_COMPLETED'
          : 'OPEN_DAILY_FEATURED'

      return {
        streak: {
          current_streak: streak.currentStreak,
          longest_streak: streak.longestStreak,
          streak_freeze_count: streak.streakFreezeCount,
        },
        completed_today: completedToday,
        daily_featured: dailyFeatured?.devotional ?? null,
        primary_cta: {
          type: primaryCtaType,
          label:
            primaryCtaType === 'BROWSE_FEED'
              ? 'Seguir explorando'
              : completedToday
                ? 'Día completado'
                : 'Completa tu día',
          devotional_id: dailyFeatured?.devotional.id ?? null,
        },
      }
    })
  )
}

export const applyReadCompleteEngagement = async (params: {
  devotionalId: string
  userId: string
  deliveryId?: string | null
  incrementCreatorAffinity: (tx: Prisma.TransactionClient) => Promise<void>
}) => {
  return withRetryableWriteConflict(() =>
    prisma.$transaction(async (tx) => {
      const context = await resolveUserDayContext(tx, params.userId)
      const reconciledStreak = await reconcileStreakInTransaction(tx, {
        userId: params.userId,
        context,
      })
      const hadCompletionToday = await hasCompletionInLocalDay(tx, {
        userId: params.userId,
        dayWindowStart: context.dayWindowStart,
        nextDayWindowStart: context.nextDayWindowStart,
      })
      const created = await insertDevotionalReadComplete(tx, {
        devotionalId: params.devotionalId,
        userId: params.userId,
        deliveryId: params.deliveryId,
      })

      if (!created) {
        return { created: false }
      }

      const updatedReadCompleteCount = await tx.devotional.update({
        where: { id: params.devotionalId },
        data: { readCompleteCount: { increment: 1 } },
        select: { readCompleteCount: true },
      })

      await params.incrementCreatorAffinity(tx)

      if (!hadCompletionToday) {
        await applyFirstDailyCompletion(tx, {
          userId: params.userId,
          streak: reconciledStreak,
          localToday: context.localToday,
        })
      }

      return {
        created: true,
        readCompleteCount: updatedReadCompleteCount.readCompleteCount,
      }
    })
  )
}

export const runUserStreakMaintenance = async () => {
  let cursorUserId: string | undefined
  let processed = 0

  while (true) {
    const streaks = await prisma.userStreak.findMany({
      where: {
        OR: [
          { currentStreak: { gt: 0 } },
          { lastCompletedDate: { not: null } },
        ],
      },
      orderBy: { userId: 'asc' },
      take: 100,
      ...(cursorUserId
        ? {
          cursor: { userId: cursorUserId },
          skip: 1,
        }
        : {}),
      select: { userId: true },
    })

    if (streaks.length === 0) {
      break
    }

    for (const streak of streaks) {
      await reconcileUserStreak({ userId: streak.userId })
      processed += 1
    }

    cursorUserId = streaks[streaks.length - 1]?.userId
  }

  return { processed }
}
