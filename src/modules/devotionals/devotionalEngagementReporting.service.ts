import {
  DevotionalFeedEventType,
  DevotionalDailyFeaturedSelectionMode,
  DevotionalNotificationType,
  UserStreakFreezeEventType,
} from '@prisma/client'
import { prisma } from '../../config/db'

const DEFAULT_TIMEZONE = 'America/Bogota'

const toDateKey = (value: Date | string) =>
  (value instanceof Date ? value.toISOString() : value).slice(0, 10)

const toNumber = (value: unknown) => Number(value ?? 0)

const startOfUtcDay = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

const addUtcDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000)

const getWindowBounds = (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  if (params?.startDate && params?.endDate) {
    return {
      startDate: startOfUtcDay(params.startDate),
      endDate: startOfUtcDay(params.endDate),
      endExclusive: addUtcDays(startOfUtcDay(params.endDate), 1),
    }
  }

  const trailingDays = Math.max(params?.trailingDays ?? 7, 1)
  const endDate = startOfUtcDay(new Date())
  const startDate = addUtcDays(endDate, -(trailingDays - 1))
  return {
    startDate,
    endDate,
    endExclusive: addUtcDays(endDate, 1),
  }
}

const pad = (value: number) => value.toString().padStart(2, '0')

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

  return {
    year: Number(byType('year')),
    month: Number(byType('month')),
    day: Number(byType('day')),
  }
}

const isValidTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

const resolveTimezone = (rawTimezone: string | null | undefined) => {
  if (!rawTimezone) {
    return DEFAULT_TIMEZONE
  }

  if (isValidTimezone(rawTimezone)) {
    return rawTimezone
  }

  return DEFAULT_TIMEZONE
}

const getLocalDate = (date: Date, timezone: string) => {
  const parts = getZonedDateParts(date, timezone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

type TagMetricRow = {
  date: string
  tagId: number
  deliveries: number
  opens: number
  readCompletes: number
  saves: number
  shares: number
}

const mergeTagMetric = (
  map: Map<string, TagMetricRow>,
  params: {
    date: string
    tagId: number
    patch: Partial<Omit<TagMetricRow, 'date' | 'tagId'>>
  }
) => {
  const key = `${params.date}:${params.tagId}`
  const current = map.get(key) ?? {
    date: params.date,
    tagId: params.tagId,
    deliveries: 0,
    opens: 0,
    readCompletes: 0,
    saves: 0,
    shares: 0,
  }

  const next = {
    ...current,
    deliveries: current.deliveries + (params.patch.deliveries ?? 0),
    opens: current.opens + (params.patch.opens ?? 0),
    readCompletes: current.readCompletes + (params.patch.readCompletes ?? 0),
    saves: current.saves + (params.patch.saves ?? 0),
    shares: current.shares + (params.patch.shares ?? 0),
  }

  map.set(key, next)
}

export const rebuildDevotionalEngagementAggregates = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startDate, endDate, endExclusive } = getWindowBounds(params)
  const startKey = toDateKey(startDate)
  const endKey = toDateKey(endDate)

  const dailyFeaturedMetricMap = new Map<
    string,
    {
      date: string
      selectionMode: DevotionalDailyFeaturedSelectionMode
      locksCreated: number
      selectedDevotionalReadCompletes: number
    }
  >()

  let cursor: { userId: string; localDate: string } | undefined

  while (true) {
    const locks = await prisma.userDailyFeaturedDevotional.findMany({
      where: {
        localDate: {
          gte: startKey,
          lte: endKey,
        },
      },
      orderBy: [{ userId: 'asc' }, { localDate: 'asc' }],
      take: 200,
      ...(cursor
        ? {
            cursor: {
              userId_localDate: {
                userId: cursor.userId,
                localDate: cursor.localDate,
              },
            },
            skip: 1,
          }
        : {}),
      select: {
        userId: true,
        devotionalId: true,
        localDate: true,
        selectionMode: true,
        user: {
          select: {
            settings: {
              select: {
                timezone: true,
              },
            },
          },
        },
      },
    })

    if (locks.length === 0) {
      break
    }

    const completionRows =
      locks.length === 0
        ? []
        : await prisma.devotionalReadComplete.findMany({
            where: {
              OR: locks.map((lock) => ({
                userId: lock.userId,
                devotionalId: lock.devotionalId,
              })),
            },
            select: {
              userId: true,
              devotionalId: true,
              createdAt: true,
            },
          })

    const completionByPair = new Map(
      completionRows.map((row) => [`${row.userId}:${row.devotionalId}`, row])
    )

    for (const lock of locks) {
      const key = `${lock.localDate}:${lock.selectionMode}`
      const current =
        dailyFeaturedMetricMap.get(key) ?? {
          date: lock.localDate,
          selectionMode: lock.selectionMode,
          locksCreated: 0,
          selectedDevotionalReadCompletes: 0,
        }

      current.locksCreated += 1

      const completion = completionByPair.get(`${lock.userId}:${lock.devotionalId}`)
      if (completion) {
        const timezone = resolveTimezone(lock.user.settings?.timezone)
        if (getLocalDate(completion.createdAt, timezone) === lock.localDate) {
          current.selectedDevotionalReadCompletes += 1
        }
      }

      dailyFeaturedMetricMap.set(key, current)
    }

    const lastLock = locks[locks.length - 1]
    cursor = {
      userId: lastLock.userId,
      localDate: lastLock.localDate,
    }
  }

  const [
    tagDeliveryRows,
    tagOpenRows,
    tagReadRows,
    tagSaveRows,
    tagShareRows,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ date: Date; tag_id: number; deliveries: bigint }>>`
      SELECT
        DATE(d.delivered_at) AS date,
        a.tag_id,
        COUNT(*) AS deliveries
      FROM devotional_feed_deliveries d
      INNER JOIN devotional_tag_assignments a
        ON a.devotional_id = d.devotional_id
      WHERE d.delivered_at >= ${startDate} AND d.delivered_at < ${endExclusive}
      GROUP BY DATE(d.delivered_at), a.tag_id
    `,
    prisma.$queryRaw<Array<{ date: Date; tag_id: number; opens: bigint }>>`
      SELECT
        DATE(e.occurred_at) AS date,
        a.tag_id,
        COUNT(*) AS opens
      FROM devotional_feed_events e
      INNER JOIN devotional_feed_deliveries d
        ON d.id = e.delivery_id
      INNER JOIN devotional_tag_assignments a
        ON a.devotional_id = d.devotional_id
      WHERE e.occurred_at >= ${startDate}
        AND e.occurred_at < ${endExclusive}
        AND e.type = 'OPEN'
      GROUP BY DATE(e.occurred_at), a.tag_id
    `,
    prisma.$queryRaw<Array<{ date: Date; tag_id: number; read_completes: bigint }>>`
      SELECT
        DATE(r.created_at) AS date,
        a.tag_id,
        COUNT(*) AS read_completes
      FROM devotional_read_completions r
      INNER JOIN devotional_feed_deliveries d
        ON d.id = r.delivery_id
      INNER JOIN devotional_tag_assignments a
        ON a.devotional_id = d.devotional_id
      WHERE r.created_at >= ${startDate} AND r.created_at < ${endExclusive}
      GROUP BY DATE(r.created_at), a.tag_id
    `,
    prisma.$queryRaw<Array<{ date: Date; tag_id: number; saves: bigint }>>`
      SELECT
        DATE(s.created_at) AS date,
        a.tag_id,
        COUNT(*) AS saves
      FROM devotional_saves s
      INNER JOIN devotional_feed_deliveries d
        ON d.id = s.delivery_id
      INNER JOIN devotional_tag_assignments a
        ON a.devotional_id = d.devotional_id
      WHERE s.created_at >= ${startDate} AND s.created_at < ${endExclusive}
      GROUP BY DATE(s.created_at), a.tag_id
    `,
    prisma.$queryRaw<Array<{ date: Date; tag_id: number; shares: bigint }>>`
      SELECT
        DATE(s.created_at) AS date,
        a.tag_id,
        COUNT(*) AS shares
      FROM devotional_share_events s
      INNER JOIN devotional_feed_deliveries d
        ON d.id = s.delivery_id
      INNER JOIN devotional_tag_assignments a
        ON a.devotional_id = d.devotional_id
      WHERE s.created_at >= ${startDate} AND s.created_at < ${endExclusive}
      GROUP BY DATE(s.created_at), a.tag_id
    `,
  ])

  const tagMetricMap = new Map<string, TagMetricRow>()

  for (const row of tagDeliveryRows) {
    mergeTagMetric(tagMetricMap, {
      date: toDateKey(row.date),
      tagId: row.tag_id,
      patch: {
        deliveries: toNumber(row.deliveries),
      },
    })
  }

  for (const row of tagOpenRows) {
    mergeTagMetric(tagMetricMap, {
      date: toDateKey(row.date),
      tagId: row.tag_id,
      patch: {
        opens: toNumber(row.opens),
      },
    })
  }

  for (const row of tagReadRows) {
    mergeTagMetric(tagMetricMap, {
      date: toDateKey(row.date),
      tagId: row.tag_id,
      patch: {
        readCompletes: toNumber(row.read_completes),
      },
    })
  }

  for (const row of tagSaveRows) {
    mergeTagMetric(tagMetricMap, {
      date: toDateKey(row.date),
      tagId: row.tag_id,
      patch: {
        saves: toNumber(row.saves),
      },
    })
  }

  for (const row of tagShareRows) {
    mergeTagMetric(tagMetricMap, {
      date: toDateKey(row.date),
      tagId: row.tag_id,
      patch: {
        shares: toNumber(row.shares),
      },
    })
  }

  const dailyFeaturedRows = [...dailyFeaturedMetricMap.values()]
  const tagRows = [...tagMetricMap.values()]

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM daily_featured_engagement_daily_metrics
      WHERE date >= ${startKey} AND date <= ${endKey}
    `

    await tx.$executeRaw`
      DELETE FROM devotional_tag_engagement_daily_metrics
      WHERE date >= ${startKey} AND date <= ${endKey}
    `

    for (const row of dailyFeaturedRows) {
      await tx.$executeRaw`
        INSERT INTO daily_featured_engagement_daily_metrics (
          date,
          selection_mode,
          locks_created,
          selected_devotional_read_completes,
          created_at,
          updated_at
        )
        VALUES (
          ${row.date},
          ${row.selectionMode},
          ${row.locksCreated},
          ${row.selectedDevotionalReadCompletes},
          NOW(),
          NOW()
        )
      `
    }

    for (const row of tagRows) {
      await tx.$executeRaw`
        INSERT INTO devotional_tag_engagement_daily_metrics (
          date,
          tag_id,
          deliveries,
          opens,
          read_completes,
          saves,
          shares,
          created_at,
          updated_at
        )
        VALUES (
          ${row.date},
          ${row.tagId},
          ${row.deliveries},
          ${row.opens},
          ${row.readCompletes},
          ${row.saves},
          ${row.shares},
          NOW(),
          NOW()
        )
      `
    }
  })

  return {
    start_date: startKey,
    end_date: endKey,
    daily_featured_rows: dailyFeaturedRows.length,
    tag_rows: tagRows.length,
  }
}

export const getStreakDistributionReport = async () => {
  const rows = await prisma.userStreak.groupBy({
    by: ['currentStreak'],
    _count: {
      currentStreak: true,
    },
  })

  const bucketMap = new Map<string, number>()
  const getBucket = (value: number) => {
    if (value <= 0) return '0'
    if (value === 1) return '1'
    if (value === 2) return '2'
    if (value <= 6) return '3-6'
    if (value <= 13) return '7-13'
    if (value <= 29) return '14-29'
    return '30+'
  }

  for (const row of rows) {
    const bucket = getBucket(row.currentStreak)
    bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + row._count.currentStreak)
  }

  const orderedBuckets = ['0', '1', '2', '3-6', '7-13', '14-29', '30+']

  return orderedBuckets.map((bucket) => ({
    bucket,
    users: bucketMap.get(bucket) ?? 0,
  }))
}

export const getFreezeEventSummaryReport = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startDate, endExclusive } = getWindowBounds(params)
  const grouped = await prisma.userStreakFreezeEvent.groupBy({
    by: ['eventType'],
    where: {
      createdAt: {
        gte: startDate,
        lt: endExclusive,
      },
    },
    _count: {
      eventType: true,
    },
  })

  const summary = new Map(
    grouped.map((row) => [row.eventType, row._count.eventType])
  )

  return {
    granted: summary.get(UserStreakFreezeEventType.GRANTED) ?? 0,
    skipped_at_cap:
      summary.get(UserStreakFreezeEventType.GRANT_SKIPPED_AT_CAP) ?? 0,
    consumed: summary.get(UserStreakFreezeEventType.CONSUMED) ?? 0,
    reset: summary.get(UserStreakFreezeEventType.RESET) ?? 0,
  }
}

export const getDailyFeaturedCoverageReport = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startDate, endDate } = getWindowBounds(params)
  const startKey = toDateKey(startDate)
  const endKey = toDateKey(endDate)

  const [lockRows, candidateRows, activeRows] = await Promise.all([
    prisma.userDailyFeaturedDevotional.groupBy({
      by: ['localDate'],
      where: {
        localDate: {
          gte: startKey,
          lte: endKey,
        },
      },
      _count: {
        userId: true,
      },
    }),
    prisma.devotionalDailyFeatureCandidate.groupBy({
      by: ['localDate'],
      where: {
        localDate: {
          gte: startKey,
          lte: endKey,
        },
      },
      _count: {
        devotionalId: true,
      },
    }),
    prisma.userActivityDailyMetric.groupBy({
      by: ['date'],
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
        hadDevotionalActivity: true,
      },
      _count: {
        userId: true,
      },
    }),
  ])

  const lockCountByDate = new Map(lockRows.map((row) => [row.localDate, row._count.userId]))
  const candidateCountByDate = new Map(
    candidateRows.map((row) => [row.localDate, row._count.devotionalId])
  )
  const activeCountByDate = new Map(activeRows.map((row) => [row.date, row._count.userId]))

  const dates = new Set([
    ...lockCountByDate.keys(),
    ...candidateCountByDate.keys(),
    ...activeCountByDate.keys(),
  ])

  return [...dates]
    .sort((left, right) => left.localeCompare(right))
    .map((date) => {
      const lockCount = lockCountByDate.get(date) ?? 0
      const activeUsers = activeCountByDate.get(date) ?? 0
      return {
        date,
        candidate_count: candidateCountByDate.get(date) ?? 0,
        lock_count: lockCount,
        active_users: activeUsers,
        lock_coverage_rate: activeUsers > 0 ? lockCount / activeUsers : 0,
      }
    })
}

export const getNotificationPerformanceReport = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startDate, endDate } = getWindowBounds(params)
  const startKey = toDateKey(startDate)
  const endKey = toDateKey(endDate)
  const trackedTypes = [
    DevotionalNotificationType.FEATURED_DEVOTIONAL,
    DevotionalNotificationType.STREAK_AT_RISK,
  ]

  const [dailyRows, evaluationRows] = await Promise.all([
    prisma.notificationDailyMetric.findMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
        notificationType: {
          in: trackedTypes,
        },
      },
      orderBy: [{ date: 'asc' }, { notificationType: 'asc' }],
    }),
    prisma.$queryRaw<
      Array<{
        date: string
        notification_type: DevotionalNotificationType
        evaluated_count: bigint
        eligible_count: bigint
        skipped_count: bigint
      }>
    >`
      SELECT
        date,
        notification_type,
        evaluated_count,
        eligible_count,
        skipped_count
      FROM devotional_notification_evaluation_daily_metrics
      WHERE date >= ${startKey}
        AND date <= ${endKey}
        AND notification_type IN (${trackedTypes[0]}, ${trackedTypes[1]})
      ORDER BY date ASC, notification_type ASC
    `,
  ])

  const evaluationByKey = new Map(
    evaluationRows.map((row) => [
      `${row.date}:${row.notification_type}`,
      {
        evaluatedCount: toNumber(row.evaluated_count),
        eligibleCount: toNumber(row.eligible_count),
        skippedCount: toNumber(row.skipped_count),
      },
    ])
  )

  return dailyRows.map((row) => {
    const evaluation = evaluationByKey.get(`${row.date}:${row.notificationType}`)
    return {
      date: row.date,
      notification_type: row.notificationType,
      sent: row.sent,
      provider_accepted: row.providerAccepted,
      opened: row.opened,
      skipped: evaluation?.skippedCount ?? 0,
      evaluated: evaluation?.evaluatedCount ?? 0,
      eligible: evaluation?.eligibleCount ?? 0,
      failed: row.failed,
      token_deactivated: row.tokenDeactivated,
    }
  })
}

export const getDailyFeaturedPerformanceReport = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startDate, endDate } = getWindowBounds(params)
  const startKey = toDateKey(startDate)
  const endKey = toDateKey(endDate)

  const rows = await prisma.$queryRaw<
    Array<{
      date: string
      selection_mode: DevotionalDailyFeaturedSelectionMode
      locks_created: bigint
      selected_devotional_read_completes: bigint
    }>
  >`
    SELECT
      date,
      selection_mode,
      locks_created,
      selected_devotional_read_completes
    FROM daily_featured_engagement_daily_metrics
    WHERE date >= ${startKey} AND date <= ${endKey}
    ORDER BY date ASC, selection_mode ASC
  `

  return rows.map((row) => ({
    date: row.date,
    selection_mode: row.selection_mode,
    locks_created: toNumber(row.locks_created),
    selected_devotional_read_completes: toNumber(
      row.selected_devotional_read_completes
    ),
    selected_devotional_completion_rate:
      toNumber(row.locks_created) > 0
        ? toNumber(row.selected_devotional_read_completes) /
          toNumber(row.locks_created)
        : 0,
  }))
}

export const getTagInteractionLiftReport = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startDate, endExclusive } = getWindowBounds(params)
  const startKey = toDateKey(startDate)
  const endKey = toDateKey(addUtcDays(endExclusive, -1))

  const [tagRows, tags, baselineRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        date: string
        tag_id: number
        deliveries: bigint
        opens: bigint
        read_completes: bigint
        saves: bigint
        shares: bigint
      }>
    >`
      SELECT
        date,
        tag_id,
        deliveries,
        opens,
        read_completes,
        saves,
        shares
      FROM devotional_tag_engagement_daily_metrics
      WHERE date >= ${startKey} AND date <= ${endKey}
    `,
    prisma.devotionalTag.findMany({
      select: {
        id: true,
        name: true,
      },
    }),
    Promise.all([
      prisma.devotionalFeedDelivery.count({
        where: {
          deliveredAt: {
            gte: startDate,
            lt: endExclusive,
          },
        },
      }),
      prisma.devotionalFeedEvent.count({
        where: {
          occurredAt: {
            gte: startDate,
            lt: endExclusive,
          },
          type: DevotionalFeedEventType.OPEN,
        },
      }),
      prisma.devotionalReadComplete.count({
        where: {
          createdAt: {
            gte: startDate,
            lt: endExclusive,
          },
          deliveryId: {
            not: null,
          },
        },
      }),
      prisma.devotionalSave.count({
        where: {
          createdAt: {
            gte: startDate,
            lt: endExclusive,
          },
          deliveryId: {
            not: null,
          },
        },
      }),
      prisma.devotionalShareEvent.count({
        where: {
          createdAt: {
            gte: startDate,
            lt: endExclusive,
          },
          deliveryId: {
            not: null,
          },
        },
      }),
    ]),
  ])

  const [baselineDeliveries, baselineOpens, baselineReadCompletes, baselineSaves, baselineShares] =
    baselineRows

  const globalInteractionRate =
    baselineDeliveries > 0
      ? (baselineOpens + baselineSaves + baselineShares) / baselineDeliveries
      : 0
  const globalCompletionRate =
    baselineDeliveries > 0 ? baselineReadCompletes / baselineDeliveries : 0

  const totalsByTagId = new Map<
    number,
    {
      deliveries: number
      opens: number
      readCompletes: number
      saves: number
      shares: number
    }
  >()

  for (const row of tagRows) {
    const current =
      totalsByTagId.get(row.tag_id) ?? {
        deliveries: 0,
        opens: 0,
        readCompletes: 0,
        saves: 0,
        shares: 0,
      }

    current.deliveries += toNumber(row.deliveries)
    current.opens += toNumber(row.opens)
    current.readCompletes += toNumber(row.read_completes)
    current.saves += toNumber(row.saves)
    current.shares += toNumber(row.shares)
    totalsByTagId.set(row.tag_id, current)
  }

  const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]))

  return [...totalsByTagId.entries()]
    .map(([tagId, totals]) => {
      const interactionRate =
        totals.deliveries > 0
          ? (totals.opens + totals.saves + totals.shares) / totals.deliveries
          : 0
      const completionRate =
        totals.deliveries > 0 ? totals.readCompletes / totals.deliveries : 0

      return {
        tag_id: tagId,
        tag_name: tagNameById.get(tagId) ?? `tag:${tagId}`,
        deliveries: totals.deliveries,
        opens: totals.opens,
        read_completes: totals.readCompletes,
        saves: totals.saves,
        shares: totals.shares,
        interaction_rate: interactionRate,
        completion_rate: completionRate,
        interaction_lift:
          globalInteractionRate > 0 ? interactionRate / globalInteractionRate : 0,
        completion_lift:
          globalCompletionRate > 0 ? completionRate / globalCompletionRate : 0,
      }
    })
    .sort((left, right) => right.completion_lift - left.completion_lift)
}

export const getDevotionalEngagementReportingSnapshot = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const [
    streakDistribution,
    freezeSummary,
    lockCoverage,
    notificationPerformance,
    dailyFeaturedPerformance,
    tagLift,
  ] = await Promise.all([
    getStreakDistributionReport(),
    getFreezeEventSummaryReport(params),
    getDailyFeaturedCoverageReport(params),
    getNotificationPerformanceReport(params),
    getDailyFeaturedPerformanceReport(params),
    getTagInteractionLiftReport(params),
  ])

  return {
    streak_distribution: streakDistribution,
    freeze_summary: freezeSummary,
    daily_featured_lock_coverage: lockCoverage,
    notification_performance: notificationPerformance,
    daily_featured_performance: dailyFeaturedPerformance,
    tag_lift: tagLift,
  }
}
