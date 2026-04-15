import { prisma } from '../../config/db'
import { rebuildDevotionalEngagementAggregates } from '../devotionals/devotionalEngagementReporting.service'

const toDateKey = (value: Date | string) =>
  (value instanceof Date ? value.toISOString() : value).slice(0, 10)

const toNumber = (value: unknown) => Number(value ?? 0)

const startOfUtcDay = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

const addUtcDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000)

const listDateKeys = (startDate: Date, endDate: Date) => {
  const dates: string[] = []
  for (
    let cursor = startOfUtcDay(startDate);
    cursor.getTime() <= startOfUtcDay(endDate).getTime();
    cursor = addUtcDays(cursor, 1)
  ) {
    dates.push(toDateKey(cursor))
  }
  return dates
}

const getWindowBounds = (params?: { startDate?: Date; endDate?: Date; trailingDays?: number }) => {
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

type DevotionalMetricRow = {
  date: string
  devotional_id: string
  impressions: number
  unique_impressions: number
  opens: number
  read_completes: number
  likes: number
  comments: number
  saves: number
  shares: number
  reports: number
}

type CreatorMetricRow = {
  date: string
  creator_id: string
  published_devotionals: number
  impressions: number
  unique_impressions: number
  opens: number
  read_completes: number
  saves: number
  shares: number
  new_followers: number
  followers_total_snapshot: number
}

type FeedMetricRow = {
  date: string
  feed_mode: string
  impressions: number
  unique_impressions: number
  opens: number
  read_completes: number
  saves: number
  shares: number
  reports: number
}

type ReasonMetricRow = {
  date: string
  recommendation_reason: string
  impressions: number
  unique_impressions: number
  opens: number
  read_completes: number
  saves: number
  shares: number
  reports: number
}

type UserActivityRow = {
  date: string
  user_id: string
  sessions: number
  had_devotional_activity: boolean
}

type ShareAttributionDailyRow = {
  date: string
  link_opens: number
  app_opens: number
  installs_detected: number
  registrations_attributed: number
  first_devotional_opens: number
  first_read_completes: number
}

type NotificationDailyRow = {
  date: string
  notification_type: string
  sent: number
  provider_accepted: number
  opened: number
  failed: number
  token_deactivated: number
}

const mergeMetricRow = <T extends Record<string, number | string>>(
  map: Map<string, T>,
  key: string,
  seed: T,
  patch: Partial<T>
) => {
  const current = map.get(key) ?? seed
  const next = { ...current }
  for (const [patchKey, patchValue] of Object.entries(patch)) {
    if (typeof patchValue === 'number') {
      next[patchKey as keyof T] = (
        Number(next[patchKey as keyof T] ?? 0) + patchValue
      ) as T[keyof T]
    } else if (patchValue !== undefined) {
      next[patchKey as keyof T] = patchValue as T[keyof T]
    }
  }
  map.set(key, next)
}

export const recordAppSessionStarted = async (params: {
  userId: string
  deviceId?: string | null
}) => {
  await prisma.appSessionEvent.create({
    data: {
      userId: params.userId,
      deviceId: params.deviceId ?? null,
    },
  })

  return { recorded: true }
}

export const rebuildDailyAggregates = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startDate, endDate, endExclusive } = getWindowBounds(params)
  const dateKeys = listDateKeys(startDate, endDate)
  const startKey = toDateKey(startDate)
  const endKey = toDateKey(endDate)

  const [
    devotionalEventRows,
    devotionalUniqueRows,
    devotionalReadRows,
    devotionalLikeRows,
    devotionalCommentRows,
    devotionalSaveRows,
    devotionalShareRows,
    devotionalReportRows,
    devotionalsAuthorRows,
    publishedRows,
    newFollowerRows,
    followerBaseRows,
    feedEventRows,
    feedSaveRows,
    feedShareRows,
    feedReadRows,
    feedReportRows,
    reasonEventRows,
    reasonSaveRows,
    reasonShareRows,
    reasonReadRows,
    reasonReportRows,
    sessionRows,
    devotionalActivityRows,
    shareDailyRows,
    notificationDailyRows,
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{ date: Date; devotional_id: string; impressions: bigint; opens: bigint }>
    >`
      SELECT
        DATE(occurred_at) AS date,
        devotional_id,
        SUM(CASE WHEN type = 'IMPRESSION' THEN 1 ELSE 0 END) AS impressions,
        SUM(CASE WHEN type = 'OPEN' THEN 1 ELSE 0 END) AS opens
      FROM devotional_feed_events
      WHERE occurred_at >= ${startDate} AND occurred_at < ${endExclusive}
      GROUP BY DATE(occurred_at), devotional_id
    `,
    prisma.$queryRaw<
      Array<{ date: Date; devotional_id: string; unique_impressions: bigint }>
    >`
      SELECT
        DATE(first_seen_at) AS date,
        devotional_id,
        COUNT(*) AS unique_impressions
      FROM devotional_unique_impressions
      WHERE first_seen_at >= ${startDate} AND first_seen_at < ${endExclusive}
      GROUP BY DATE(first_seen_at), devotional_id
    `,
    prisma.$queryRaw<
      Array<{ date: Date; devotional_id: string; read_completes: bigint }>
    >`
      SELECT DATE(created_at) AS date, devotional_id, COUNT(*) AS read_completes
      FROM devotional_read_completions
      WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      GROUP BY DATE(created_at), devotional_id
    `,
    prisma.$queryRaw<Array<{ date: Date; devotional_id: string; likes: bigint }>>`
      SELECT DATE(created_at) AS date, devotional_id, COUNT(*) AS likes
      FROM devotional_likes
      WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      GROUP BY DATE(created_at), devotional_id
    `,
    prisma.$queryRaw<Array<{ date: Date; devotional_id: string; comments: bigint }>>`
      SELECT DATE(created_at) AS date, devotional_id, COUNT(*) AS comments
      FROM devotional_comments
      WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      GROUP BY DATE(created_at), devotional_id
    `,
    prisma.$queryRaw<Array<{ date: Date; devotional_id: string; saves: bigint }>>`
      SELECT DATE(created_at) AS date, devotional_id, COUNT(*) AS saves
      FROM devotional_saves
      WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      GROUP BY DATE(created_at), devotional_id
    `,
    prisma.$queryRaw<Array<{ date: Date; devotional_id: string; shares: bigint }>>`
      SELECT DATE(created_at) AS date, devotional_id, COUNT(*) AS shares
      FROM devotional_share_events
      WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      GROUP BY DATE(created_at), devotional_id
    `,
    prisma.$queryRaw<Array<{ date: Date; devotional_id: string; reports: bigint }>>`
      SELECT DATE(created_at) AS date, devotional_id, COUNT(*) AS reports
      FROM devotional_reports
      WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      GROUP BY DATE(created_at), devotional_id
    `,
    prisma.devotional.findMany({
      select: {
        id: true,
        authorId: true,
      },
    }),
    prisma.$queryRaw<
      Array<{ date: Date; creator_id: string; published_devotionals: bigint }>
    >`
      SELECT
        DATE(COALESCE(first_published_at, published_at)) AS date,
        author_id AS creator_id,
        COUNT(*) AS published_devotionals
      FROM devotionals
      WHERE COALESCE(first_published_at, published_at) >= ${startDate}
        AND COALESCE(first_published_at, published_at) < ${endExclusive}
      GROUP BY DATE(COALESCE(first_published_at, published_at)), author_id
    `,
    prisma.$queryRaw<
      Array<{ date: Date; creator_id: string; new_followers: bigint }>
    >`
      SELECT DATE(created_at) AS date, followed_id AS creator_id, COUNT(*) AS new_followers
      FROM user_follows
      WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      GROUP BY DATE(created_at), followed_id
    `,
    prisma.$queryRaw<Array<{ creator_id: string; follower_base: bigint }>>`
      SELECT followed_id AS creator_id, COUNT(*) AS follower_base
      FROM user_follows
      WHERE created_at < ${startDate}
      GROUP BY followed_id
    `,
    prisma.$queryRaw<
      Array<{ date: Date; feed_mode: string; impressions: bigint; unique_impressions: bigint; opens: bigint }>
    >`
      SELECT
        DATE(e.occurred_at) AS date,
        d.feed_mode,
        SUM(CASE WHEN e.type = 'IMPRESSION' THEN 1 ELSE 0 END) AS impressions,
        COUNT(DISTINCT CASE WHEN e.type = 'IMPRESSION' THEN CONCAT(e.user_id, ':', e.devotional_id) END) AS unique_impressions,
        SUM(CASE WHEN e.type = 'OPEN' THEN 1 ELSE 0 END) AS opens
      FROM devotional_feed_events e
      INNER JOIN devotional_feed_deliveries d ON d.id = e.delivery_id
      WHERE e.occurred_at >= ${startDate} AND e.occurred_at < ${endExclusive}
      GROUP BY DATE(e.occurred_at), d.feed_mode
    `,
    prisma.$queryRaw<Array<{ date: Date; feed_mode: string; saves: bigint }>>`
      SELECT DATE(s.created_at) AS date, d.feed_mode, COUNT(*) AS saves
      FROM devotional_saves s
      INNER JOIN devotional_feed_deliveries d ON d.id = s.delivery_id
      WHERE s.created_at >= ${startDate} AND s.created_at < ${endExclusive}
      GROUP BY DATE(s.created_at), d.feed_mode
    `,
    prisma.$queryRaw<Array<{ date: Date; feed_mode: string; shares: bigint }>>`
      SELECT DATE(s.created_at) AS date, d.feed_mode, COUNT(*) AS shares
      FROM devotional_share_events s
      INNER JOIN devotional_feed_deliveries d ON d.id = s.delivery_id
      WHERE s.created_at >= ${startDate} AND s.created_at < ${endExclusive}
      GROUP BY DATE(s.created_at), d.feed_mode
    `,
    prisma.$queryRaw<Array<{ date: Date; feed_mode: string; read_completes: bigint }>>`
      SELECT DATE(r.created_at) AS date, d.feed_mode, COUNT(*) AS read_completes
      FROM devotional_read_completions r
      INNER JOIN devotional_feed_deliveries d ON d.id = r.delivery_id
      WHERE r.created_at >= ${startDate} AND r.created_at < ${endExclusive}
      GROUP BY DATE(r.created_at), d.feed_mode
    `,
    prisma.$queryRaw<Array<{ date: Date; feed_mode: string; reports: bigint }>>`
      SELECT DATE(r.created_at) AS date, d.feed_mode, COUNT(*) AS reports
      FROM devotional_reports r
      INNER JOIN devotional_feed_deliveries d ON d.id = r.delivery_id
      WHERE r.created_at >= ${startDate} AND r.created_at < ${endExclusive}
      GROUP BY DATE(r.created_at), d.feed_mode
    `,
    prisma.$queryRaw<
      Array<{ date: Date; recommendation_reason: string; impressions: bigint; unique_impressions: bigint; opens: bigint }>
    >`
      SELECT
        DATE(e.occurred_at) AS date,
        d.recommendation_reason,
        SUM(CASE WHEN e.type = 'IMPRESSION' THEN 1 ELSE 0 END) AS impressions,
        COUNT(DISTINCT CASE WHEN e.type = 'IMPRESSION' THEN CONCAT(e.user_id, ':', e.devotional_id) END) AS unique_impressions,
        SUM(CASE WHEN e.type = 'OPEN' THEN 1 ELSE 0 END) AS opens
      FROM devotional_feed_events e
      INNER JOIN devotional_feed_deliveries d ON d.id = e.delivery_id
      WHERE e.occurred_at >= ${startDate}
        AND e.occurred_at < ${endExclusive}
        AND d.feed_mode = 'for_you'
        AND d.recommendation_reason IS NOT NULL
      GROUP BY DATE(e.occurred_at), d.recommendation_reason
    `,
    prisma.$queryRaw<Array<{ date: Date; recommendation_reason: string; saves: bigint }>>`
      SELECT DATE(s.created_at) AS date, d.recommendation_reason, COUNT(*) AS saves
      FROM devotional_saves s
      INNER JOIN devotional_feed_deliveries d ON d.id = s.delivery_id
      WHERE s.created_at >= ${startDate}
        AND s.created_at < ${endExclusive}
        AND d.feed_mode = 'for_you'
        AND d.recommendation_reason IS NOT NULL
      GROUP BY DATE(s.created_at), d.recommendation_reason
    `,
    prisma.$queryRaw<Array<{ date: Date; recommendation_reason: string; shares: bigint }>>`
      SELECT DATE(s.created_at) AS date, d.recommendation_reason, COUNT(*) AS shares
      FROM devotional_share_events s
      INNER JOIN devotional_feed_deliveries d ON d.id = s.delivery_id
      WHERE s.created_at >= ${startDate}
        AND s.created_at < ${endExclusive}
        AND d.feed_mode = 'for_you'
        AND d.recommendation_reason IS NOT NULL
      GROUP BY DATE(s.created_at), d.recommendation_reason
    `,
    prisma.$queryRaw<Array<{ date: Date; recommendation_reason: string; read_completes: bigint }>>`
      SELECT DATE(r.created_at) AS date, d.recommendation_reason, COUNT(*) AS read_completes
      FROM devotional_read_completions r
      INNER JOIN devotional_feed_deliveries d ON d.id = r.delivery_id
      WHERE r.created_at >= ${startDate}
        AND r.created_at < ${endExclusive}
        AND d.feed_mode = 'for_you'
        AND d.recommendation_reason IS NOT NULL
      GROUP BY DATE(r.created_at), d.recommendation_reason
    `,
    prisma.$queryRaw<Array<{ date: Date; recommendation_reason: string; reports: bigint }>>`
      SELECT DATE(r.created_at) AS date, d.recommendation_reason, COUNT(*) AS reports
      FROM devotional_reports r
      INNER JOIN devotional_feed_deliveries d ON d.id = r.delivery_id
      WHERE r.created_at >= ${startDate}
        AND r.created_at < ${endExclusive}
        AND d.feed_mode = 'for_you'
        AND d.recommendation_reason IS NOT NULL
      GROUP BY DATE(r.created_at), d.recommendation_reason
    `,
    prisma.$queryRaw<Array<{ date: Date; user_id: string; sessions: bigint }>>`
      SELECT DATE(occurred_at) AS date, user_id, COUNT(*) AS sessions
      FROM app_session_events
      WHERE occurred_at >= ${startDate} AND occurred_at < ${endExclusive}
      GROUP BY DATE(occurred_at), user_id
    `,
    prisma.$queryRaw<Array<{ date: Date; user_id: string }>>`
      SELECT DISTINCT date, user_id FROM (
        SELECT DATE(occurred_at) AS date, user_id FROM devotional_feed_events WHERE occurred_at >= ${startDate} AND occurred_at < ${endExclusive}
        UNION ALL
        SELECT DATE(created_at) AS date, user_id FROM devotional_saves WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
        UNION ALL
        SELECT DATE(created_at) AS date, user_id FROM devotional_share_events WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
        UNION ALL
        SELECT DATE(created_at) AS date, user_id FROM devotional_read_completions WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
        UNION ALL
        SELECT DATE(created_at) AS date, user_id FROM devotional_reports WHERE created_at >= ${startDate} AND created_at < ${endExclusive}
      ) activity
    `,
    prisma.$queryRaw<
      Array<{
        date: Date
        link_opens: bigint
        app_opens: bigint
        installs_detected: bigint
        registrations_attributed: bigint
        first_devotional_opens: bigint
        first_read_completes: bigint
      }>
    >`
      SELECT
        DATE(occurred_at) AS date,
        SUM(CASE WHEN type = 'LINK_OPEN' THEN 1 ELSE 0 END) AS link_opens,
        SUM(CASE WHEN type = 'APP_OPEN' THEN 1 ELSE 0 END) AS app_opens,
        SUM(CASE WHEN type = 'INSTALL_DETECTED' THEN 1 ELSE 0 END) AS installs_detected,
        SUM(CASE WHEN type = 'REGISTRATION' THEN 1 ELSE 0 END) AS registrations_attributed,
        SUM(CASE WHEN type = 'FIRST_DEVOTIONAL_OPEN' THEN 1 ELSE 0 END) AS first_devotional_opens,
        SUM(CASE WHEN type = 'FIRST_READ_COMPLETE' THEN 1 ELSE 0 END) AS first_read_completes
      FROM devotional_share_attribution_events
      WHERE occurred_at >= ${startDate} AND occurred_at < ${endExclusive}
      GROUP BY DATE(occurred_at)
    `,
    prisma.$queryRaw<
      Array<{
        date: Date
        notification_type: string
        sent: bigint
        provider_accepted: bigint
        opened: bigint
        failed: bigint
        token_deactivated: bigint
      }>
    >`
      SELECT
        DATE(sent_at) AS date,
        type AS notification_type,
        COUNT(*) AS sent,
        SUM(CASE WHEN provider_accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS provider_accepted,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
        SUM(CASE WHEN failed_at IS NOT NULL THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN token_deactivated_at IS NOT NULL THEN 1 ELSE 0 END) AS token_deactivated
      FROM devotional_notification_sends
      WHERE sent_at >= ${startDate} AND sent_at < ${endExclusive}
      GROUP BY DATE(sent_at), type
    `,
  ])

  const authorByDevotionalId = new Map(
    devotionalsAuthorRows.map((row) => [row.id, row.authorId])
  )

  const devotionalMap = new Map<string, DevotionalMetricRow>()
  const toDevotionalKey = (date: string, devotionalId: string) =>
    `${date}:${devotionalId}`

  for (const row of devotionalEventRows) {
    const date = toDateKey(row.date)
    const key = toDevotionalKey(date, row.devotional_id)
    mergeMetricRow(
      devotionalMap,
      key,
      {
        date,
        devotional_id: row.devotional_id,
        impressions: 0,
        unique_impressions: 0,
        opens: 0,
        read_completes: 0,
        likes: 0,
        comments: 0,
        saves: 0,
        shares: 0,
        reports: 0,
      },
      {
        impressions: toNumber(row.impressions),
        opens: toNumber(row.opens),
      }
    )
  }

  const mergeDevotionalCountRows = (
    rows: Array<{ date: Date; devotional_id: string } & Record<string, bigint>>,
    field: keyof Omit<
      DevotionalMetricRow,
      'date' | 'devotional_id'
    >
  ) => {
    for (const row of rows) {
      const date = toDateKey(row.date)
      const key = toDevotionalKey(date, row.devotional_id)
      mergeMetricRow(
        devotionalMap,
        key,
        {
          date,
          devotional_id: row.devotional_id,
          impressions: 0,
          unique_impressions: 0,
          opens: 0,
          read_completes: 0,
          likes: 0,
          comments: 0,
          saves: 0,
          shares: 0,
          reports: 0,
        },
        {
          [field]: toNumber(row[field as string]),
        } as Partial<DevotionalMetricRow>
      )
    }
  }

  mergeDevotionalCountRows(devotionalUniqueRows as never, 'unique_impressions')
  mergeDevotionalCountRows(devotionalReadRows as never, 'read_completes')
  mergeDevotionalCountRows(devotionalLikeRows as never, 'likes')
  mergeDevotionalCountRows(devotionalCommentRows as never, 'comments')
  mergeDevotionalCountRows(devotionalSaveRows as never, 'saves')
  mergeDevotionalCountRows(devotionalShareRows as never, 'shares')
  mergeDevotionalCountRows(devotionalReportRows as never, 'reports')

  const devotionalRows = [...devotionalMap.values()]

  const creatorMap = new Map<string, CreatorMetricRow>()
  const toCreatorKey = (date: string, creatorId: string) => `${date}:${creatorId}`
  const followerBaseByCreator = new Map(
    followerBaseRows.map((row) => [row.creator_id, toNumber(row.follower_base)])
  )
  const newFollowersByCreatorDate = new Map(
    newFollowerRows.map((row) => [
      toCreatorKey(toDateKey(row.date), row.creator_id),
      toNumber(row.new_followers),
    ])
  )

  for (const row of devotionalRows) {
    const creatorId = authorByDevotionalId.get(row.devotional_id)
    if (!creatorId) {
      continue
    }

    const key = toCreatorKey(row.date, creatorId)
    mergeMetricRow(
      creatorMap,
      key,
      {
        date: row.date,
        creator_id: creatorId,
        published_devotionals: 0,
        impressions: 0,
        unique_impressions: 0,
        opens: 0,
        read_completes: 0,
        saves: 0,
        shares: 0,
        new_followers: 0,
        followers_total_snapshot: 0,
      },
      {
        impressions: row.impressions,
        unique_impressions: row.unique_impressions,
        opens: row.opens,
        read_completes: row.read_completes,
        saves: row.saves,
        shares: row.shares,
      }
    )
  }

  for (const row of publishedRows) {
    const date = toDateKey(row.date)
    const key = toCreatorKey(date, row.creator_id)
    mergeMetricRow(
      creatorMap,
      key,
      {
        date,
        creator_id: row.creator_id,
        published_devotionals: 0,
        impressions: 0,
        unique_impressions: 0,
        opens: 0,
        read_completes: 0,
        saves: 0,
        shares: 0,
        new_followers: 0,
        followers_total_snapshot: 0,
      },
      {
        published_devotionals: toNumber(row.published_devotionals),
      }
    )
  }

  for (const row of newFollowerRows) {
    const date = toDateKey(row.date)
    const key = toCreatorKey(date, row.creator_id)
    mergeMetricRow(
      creatorMap,
      key,
      {
        date,
        creator_id: row.creator_id,
        published_devotionals: 0,
        impressions: 0,
        unique_impressions: 0,
        opens: 0,
        read_completes: 0,
        saves: 0,
        shares: 0,
        new_followers: 0,
        followers_total_snapshot: 0,
      },
      {
        new_followers: toNumber(row.new_followers),
      }
    )
  }

  const creatorIds = [
    ...new Set([...creatorMap.values()].map((row) => row.creator_id)),
  ]
  for (const creatorId of creatorIds) {
    let runningTotal = followerBaseByCreator.get(creatorId) ?? 0
    for (const dateKey of dateKeys) {
      const key = toCreatorKey(dateKey, creatorId)
      const row = creatorMap.get(key)
      runningTotal += newFollowersByCreatorDate.get(key) ?? 0
      if (!row && runningTotal === 0) {
        continue
      }

      creatorMap.set(key, {
        date: dateKey,
        creator_id: creatorId,
        published_devotionals: row?.published_devotionals ?? 0,
        impressions: row?.impressions ?? 0,
        unique_impressions: row?.unique_impressions ?? 0,
        opens: row?.opens ?? 0,
        read_completes: row?.read_completes ?? 0,
        saves: row?.saves ?? 0,
        shares: row?.shares ?? 0,
        new_followers: row?.new_followers ?? 0,
        followers_total_snapshot: runningTotal,
      })
    }
  }

  const creatorRows = [...creatorMap.values()]

  const mergeModeMetrics = <
    T extends { date: string; [key: string]: string | number }
  >(
    rows: T[],
    idField: 'feed_mode' | 'recommendation_reason',
    seed: T
  ) => {
    const map = new Map<string, T>()
    const toKey = (date: string, value: string) => `${date}:${value}`
    for (const row of rows) {
      map.set(toKey(row.date, row[idField] as string), row)
    }
    return { map, toKey, seed }
  }

  const feedRowsSeed: FeedMetricRow = {
    date: '',
    feed_mode: '',
    impressions: 0,
    unique_impressions: 0,
    opens: 0,
    read_completes: 0,
    saves: 0,
    shares: 0,
    reports: 0,
  }
  const feedMap = new Map<string, FeedMetricRow>()
  const toFeedKey = (date: string, mode: string) => `${date}:${mode}`
  const mergeFeedRows = (
    rows: Array<{ date: Date; feed_mode: string } & Record<string, bigint>>,
    fieldMap: Record<string, keyof FeedMetricRow>
  ) => {
    for (const row of rows) {
      const date = toDateKey(row.date)
      const key = toFeedKey(date, row.feed_mode)
      const current = feedMap.get(key) ?? {
        ...feedRowsSeed,
        date,
        feed_mode: row.feed_mode,
      }
      const next = { ...current } as FeedMetricRow
      for (const [sourceField, targetField] of Object.entries(fieldMap)) {
        ;(next as Record<string, number | string>)[targetField] =
          Number((next as Record<string, number | string>)[targetField] ?? 0) +
          toNumber(row[sourceField])
      }
      feedMap.set(key, next)
    }
  }

  mergeFeedRows(feedEventRows as never, {
    impressions: 'impressions',
    unique_impressions: 'unique_impressions',
    opens: 'opens',
  })
  mergeFeedRows(feedSaveRows as never, { saves: 'saves' })
  mergeFeedRows(feedShareRows as never, { shares: 'shares' })
  mergeFeedRows(feedReadRows as never, { read_completes: 'read_completes' })
  mergeFeedRows(feedReportRows as never, { reports: 'reports' })

  const feedRows = [...feedMap.values()]

  const reasonMap = new Map<string, ReasonMetricRow>()
  const toReasonKey = (date: string, reason: string) => `${date}:${reason}`
  const mergeReasonRows = (
    rows: Array<{ date: Date; recommendation_reason: string } & Record<string, bigint>>,
    fieldMap: Record<string, keyof ReasonMetricRow>
  ) => {
    for (const row of rows) {
      const date = toDateKey(row.date)
      const key = toReasonKey(date, row.recommendation_reason)
      const current = reasonMap.get(key) ?? {
        date,
        recommendation_reason: row.recommendation_reason,
        impressions: 0,
        unique_impressions: 0,
        opens: 0,
        read_completes: 0,
        saves: 0,
        shares: 0,
        reports: 0,
      }
      const next = { ...current } as ReasonMetricRow
      for (const [sourceField, targetField] of Object.entries(fieldMap)) {
        ;(next as Record<string, number | string>)[targetField] =
          Number((next as Record<string, number | string>)[targetField] ?? 0) +
          toNumber(row[sourceField])
      }
      reasonMap.set(key, next)
    }
  }

  mergeReasonRows(reasonEventRows as never, {
    impressions: 'impressions',
    unique_impressions: 'unique_impressions',
    opens: 'opens',
  })
  mergeReasonRows(reasonSaveRows as never, { saves: 'saves' })
  mergeReasonRows(reasonShareRows as never, { shares: 'shares' })
  mergeReasonRows(reasonReadRows as never, { read_completes: 'read_completes' })
  mergeReasonRows(reasonReportRows as never, { reports: 'reports' })

  const reasonRows = [...reasonMap.values()]

  const userActivityMap = new Map<string, UserActivityRow>()
  const toUserActivityKey = (date: string, userId: string) => `${date}:${userId}`
  for (const row of sessionRows) {
    const date = toDateKey(row.date)
    const key = toUserActivityKey(date, row.user_id)
    userActivityMap.set(key, {
      date,
      user_id: row.user_id,
      sessions: toNumber(row.sessions),
      had_devotional_activity: false,
    })
  }

  for (const row of devotionalActivityRows) {
    const date = toDateKey(row.date)
    const key = toUserActivityKey(date, row.user_id)
    const current = userActivityMap.get(key) ?? {
      date,
      user_id: row.user_id,
      sessions: 0,
      had_devotional_activity: false,
    }
    current.had_devotional_activity = true
    userActivityMap.set(key, current)
  }

  const userActivityRows = [...userActivityMap.values()]

  const shareAttributionRows: ShareAttributionDailyRow[] = shareDailyRows.map(
    (row) => ({
      date: toDateKey(row.date),
      link_opens: toNumber(row.link_opens),
      app_opens: toNumber(row.app_opens),
      installs_detected: toNumber(row.installs_detected),
      registrations_attributed: toNumber(row.registrations_attributed),
      first_devotional_opens: toNumber(row.first_devotional_opens),
      first_read_completes: toNumber(row.first_read_completes),
    })
  )

  const notificationRows: NotificationDailyRow[] = notificationDailyRows.map(
    (row) => ({
      date: toDateKey(row.date),
      notification_type: row.notification_type,
      sent: toNumber(row.sent),
      provider_accepted: toNumber(row.provider_accepted),
      opened: toNumber(row.opened),
      failed: toNumber(row.failed),
      token_deactivated: toNumber(row.token_deactivated),
    })
  )

  await prisma.$transaction(async (tx) => {
    await tx.devotionalDailyMetric.deleteMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
      },
    })
    await tx.creatorDailyMetric.deleteMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
      },
    })
    await tx.feedDailyMetric.deleteMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
      },
    })
    await tx.forYouReasonDailyMetric.deleteMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
      },
    })
    await tx.userActivityDailyMetric.deleteMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
      },
    })
    await tx.shareAttributionDailyMetric.deleteMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
      },
    })
    await tx.notificationDailyMetric.deleteMany({
      where: {
        date: {
          gte: startKey,
          lte: endKey,
        },
      },
    })

    if (devotionalRows.length > 0) {
      await tx.devotionalDailyMetric.createMany({
        data: devotionalRows.map((row) => ({
          date: row.date,
          devotionalId: row.devotional_id,
          impressions: row.impressions,
          uniqueImpressions: row.unique_impressions,
          opens: row.opens,
          readCompletes: row.read_completes,
          likes: row.likes,
          comments: row.comments,
          saves: row.saves,
          shares: row.shares,
          reports: row.reports,
        })),
      })
    }

    if (creatorRows.length > 0) {
      await tx.creatorDailyMetric.createMany({
        data: creatorRows.map((row) => ({
          date: row.date,
          creatorId: row.creator_id,
          publishedDevotionals: row.published_devotionals,
          impressions: row.impressions,
          uniqueImpressions: row.unique_impressions,
          opens: row.opens,
          readCompletes: row.read_completes,
          saves: row.saves,
          shares: row.shares,
          newFollowers: row.new_followers,
          followersTotalSnapshot: row.followers_total_snapshot,
        })),
      })
    }

    if (feedRows.length > 0) {
      await tx.feedDailyMetric.createMany({
        data: feedRows.map((row) => ({
          date: row.date,
          feedMode: row.feed_mode,
          impressions: row.impressions,
          uniqueImpressions: row.unique_impressions,
          opens: row.opens,
          readCompletes: row.read_completes,
          saves: row.saves,
          shares: row.shares,
          reports: row.reports,
        })),
      })
    }

    if (reasonRows.length > 0) {
      await tx.forYouReasonDailyMetric.createMany({
        data: reasonRows.map((row) => ({
          date: row.date,
          recommendationReason: row.recommendation_reason,
          impressions: row.impressions,
          uniqueImpressions: row.unique_impressions,
          opens: row.opens,
          readCompletes: row.read_completes,
          saves: row.saves,
          shares: row.shares,
          reports: row.reports,
        })),
      })
    }

    if (userActivityRows.length > 0) {
      await tx.userActivityDailyMetric.createMany({
        data: userActivityRows.map((row) => ({
          date: row.date,
          userId: row.user_id,
          sessions: row.sessions,
          hadDevotionalActivity: row.had_devotional_activity,
        })),
      })
    }

    if (shareAttributionRows.length > 0) {
      await tx.shareAttributionDailyMetric.createMany({
        data: shareAttributionRows.map((row) => ({
          date: row.date,
          linkOpens: row.link_opens,
          appOpens: row.app_opens,
          installsDetected: row.installs_detected,
          registrationsAttributed: row.registrations_attributed,
          firstDevotionalOpens: row.first_devotional_opens,
          firstReadCompletes: row.first_read_completes,
        })),
      })
    }

    if (notificationRows.length > 0) {
      await tx.notificationDailyMetric.createMany({
        data: notificationRows.map((row) => ({
          date: row.date,
          notificationType: row.notification_type as never,
          sent: row.sent,
          providerAccepted: row.provider_accepted,
          opened: row.opened,
          failed: row.failed,
          tokenDeactivated: row.token_deactivated,
        })),
      })
    }
  })

  const engagementResult = await rebuildDevotionalEngagementAggregates({
    startDate,
    endDate,
  })

  return {
    start_date: startKey,
    end_date: endKey,
    devotional_rows: devotionalRows.length,
    creator_rows: creatorRows.length,
    feed_rows: feedRows.length,
    reason_rows: reasonRows.length,
    user_activity_rows: userActivityRows.length,
    share_attribution_rows: shareAttributionRows.length,
    notification_rows: notificationRows.length,
    daily_featured_engagement_rows: engagementResult.daily_featured_rows,
    tag_engagement_rows: engagementResult.tag_rows,
  }
}
