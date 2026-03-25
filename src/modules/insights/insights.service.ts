import {
  DevotionalModerationStatus,
  DevotionalPublicationState,
  Prisma,
} from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const INSIGHTS_WINDOW_DAYS = 30

const toDateKey = (value: Date) => value.toISOString().slice(0, 10)

const getWindowStart = () => {
  const end = new Date()
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  )
  start.setUTCDate(start.getUTCDate() - (INSIGHTS_WINDOW_DAYS - 1))
  return start
}

const getWindowBounds = () => {
  const end = new Date()
  const endDate = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  )
  return {
    startKey: toDateKey(getWindowStart()),
    endKey: toDateKey(endDate),
  }
}

const encodeOffsetCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')

const decodeOffsetCursor = (cursor?: string | null) => {
  if (!cursor) {
    return 0
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as { offset?: number }
    return Math.max(parsed.offset ?? 0, 0)
  } catch {
    return 0
  }
}

const toEffectiveState = (
  publicationState: DevotionalPublicationState,
  moderationStatus: DevotionalModerationStatus
) => {
  if (moderationStatus === DevotionalModerationStatus.UNDER_REVIEW) {
    return DevotionalModerationStatus.UNDER_REVIEW
  }
  if (moderationStatus === DevotionalModerationStatus.RESTRICTED) {
    return DevotionalModerationStatus.RESTRICTED
  }
  return publicationState
}

const toRate = (numerator: number, denominator: number) =>
  numerator / Math.max(denominator, 1)

export const getInsightsOverview = async (userId: string) => {
  const { startKey, endKey } = getWindowBounds()

  const aggregate = await prisma.creatorDailyMetric.aggregate({
    where: {
      creatorId: userId,
      date: {
        gte: startKey,
        lte: endKey,
      },
    },
    _sum: {
      publishedDevotionals: true,
      impressions: true,
      uniqueImpressions: true,
      opens: true,
      readCompletes: true,
      saves: true,
      shares: true,
      newFollowers: true,
    },
  })

  const uniqueImpressions = aggregate._sum.uniqueImpressions ?? 0
  const readCompletes = aggregate._sum.readCompletes ?? 0

  return {
    window: 'last_30d',
    window_start: startKey,
    window_end: endKey,
    published_devotionals_last_30d: aggregate._sum.publishedDevotionals ?? 0,
    total_impressions_last_30d: aggregate._sum.impressions ?? 0,
    total_unique_impressions_last_30d: uniqueImpressions,
    total_opens_last_30d: aggregate._sum.opens ?? 0,
    total_reads_completed_last_30d: readCompletes,
    read_complete_rate_last_30d: toRate(readCompletes, uniqueImpressions),
    total_saves_last_30d: aggregate._sum.saves ?? 0,
    total_shares_last_30d: aggregate._sum.shares ?? 0,
    new_followers_last_30d: aggregate._sum.newFollowers ?? 0,
  }
}

export const listDevotionalInsights = async (params: {
  userId: string
  cursor?: string | null
  limit?: number
}) => {
  const { startKey, endKey } = getWindowBounds()
  const offset = decodeOffsetCursor(params.cursor)
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const [devotionals, total] = await prisma.$transaction([
    prisma.devotional.findMany({
      where: {
        authorId: params.userId,
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        title: true,
        publicationState: true,
        moderationStatus: true,
        publishedAt: true,
      },
    }),
    prisma.devotional.count({
      where: {
        authorId: params.userId,
      },
    }),
  ])

  const pageItems = devotionals.slice(0, limit)
  const hasMore = devotionals.length > limit
  const aggregates = await prisma.devotionalDailyMetric.groupBy({
    by: ['devotionalId'],
    where: {
      devotionalId: {
        in: pageItems.map((item) => item.id),
      },
      date: {
        gte: startKey,
        lte: endKey,
      },
    },
    _sum: {
      impressions: true,
      uniqueImpressions: true,
      opens: true,
      readCompletes: true,
      saves: true,
      shares: true,
      reports: true,
    },
  })

  const aggregateByDevotionalId = new Map(
    aggregates.map((item) => [item.devotionalId, item._sum])
  )

  return {
    items: pageItems.map((item) => {
      const metric = aggregateByDevotionalId.get(item.id)
      const uniqueImpressions = metric?.uniqueImpressions ?? 0
      const readCompletes = metric?.readCompletes ?? 0

      return {
        id: item.id,
        title: item.title,
        publication_state: item.publicationState,
        effective_state: toEffectiveState(
          item.publicationState,
          item.moderationStatus
        ),
        published_at: item.publishedAt?.toISOString() ?? null,
        impressions: metric?.impressions ?? 0,
        unique_impressions: uniqueImpressions,
        opens: metric?.opens ?? 0,
        read_completes: readCompletes,
        read_complete_rate: toRate(readCompletes, uniqueImpressions),
        saves: metric?.saves ?? 0,
        shares: metric?.shares ?? 0,
        reports: metric?.reports ?? 0,
      }
    }),
    next_cursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
    has_more: hasMore,
    total,
    window: 'last_30d',
    window_start: startKey,
    window_end: endKey,
  }
}

export const getDevotionalInsightDetail = async (params: {
  userId: string
  devotionalId: string
}) => {
  const { startKey, endKey } = getWindowBounds()
  const devotional = await prisma.devotional.findFirst({
    where: {
      id: params.devotionalId,
      authorId: params.userId,
    },
    select: {
      id: true,
      title: true,
      publicationState: true,
      moderationStatus: true,
      publishedAt: true,
    },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  const aggregate = await prisma.devotionalDailyMetric.aggregate({
    where: {
      devotionalId: devotional.id,
      date: {
        gte: startKey,
        lte: endKey,
      },
    },
    _sum: {
      impressions: true,
      uniqueImpressions: true,
      opens: true,
      readCompletes: true,
      likes: true,
      comments: true,
      saves: true,
      shares: true,
      reports: true,
    },
  })

  const uniqueImpressions = aggregate._sum.uniqueImpressions ?? 0
  const readCompletes = aggregate._sum.readCompletes ?? 0

  return {
    window: 'last_30d',
    window_start: startKey,
    window_end: endKey,
    id: devotional.id,
    title: devotional.title,
    publication_state: devotional.publicationState,
    effective_state: toEffectiveState(
      devotional.publicationState,
      devotional.moderationStatus
    ),
    published_at: devotional.publishedAt?.toISOString() ?? null,
    impressions: aggregate._sum.impressions ?? 0,
    unique_impressions: uniqueImpressions,
    opens: aggregate._sum.opens ?? 0,
    read_completes: readCompletes,
    read_complete_rate: toRate(readCompletes, uniqueImpressions),
    likes: aggregate._sum.likes ?? 0,
    comments: aggregate._sum.comments ?? 0,
    saves: aggregate._sum.saves ?? 0,
    shares: aggregate._sum.shares ?? 0,
    reports: aggregate._sum.reports ?? 0,
  }
}
