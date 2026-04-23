import { DevotionalGenerationSource, DevotionalPublicationState } from '@prisma/client'
import { prisma } from '../../config/db'

const toDateKey = (value: Date | string) =>
  (value instanceof Date ? value.toISOString() : value).slice(0, 10)

const normalizeWindow = (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  if (params?.startDate && params?.endDate) {
    return {
      startKey: toDateKey(params.startDate),
      endKey: toDateKey(params.endDate),
    }
  }

  const trailingDays = Math.max(params?.trailingDays ?? 7, 1)
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - (trailingDays - 1) * 24 * 60 * 60 * 1000)

  return {
    startKey: toDateKey(startDate),
    endKey: toDateKey(endDate),
  }
}

export const getHolyversoGenerationMetrics = async (params?: {
  startDate?: Date
  endDate?: Date
  trailingDays?: number
}) => {
  const { startKey, endKey } = normalizeWindow(params)

  const [batchRows, failureRows, engagementRows, featuredRows, promotionRows] =
    await Promise.all([
      prisma.holyversoGenerationBatch.findMany({
        where: {
          localDate: {
            gte: startKey,
            lte: endKey,
          },
        },
        select: {
          localDate: true,
          targetCount: true,
          publishedCount: true,
          status: true,
        },
        orderBy: {
          localDate: 'asc',
        },
      }),
      prisma.holyversoGenerationSlot.groupBy({
        by: ['failureCode'],
        where: {
          batch: {
            localDate: {
              gte: startKey,
              lte: endKey,
            },
          },
          failureCode: {
            not: null,
          },
        },
        _count: {
          failureCode: true,
        },
      }),
      prisma.$queryRaw<
        Array<{
          date: string
          generation_source: DevotionalGenerationSource
          impressions: bigint
          opens: bigint
          read_completes: bigint
          saves: bigint
          shares: bigint
        }>
      >`
        SELECT
          m.date AS date,
          d.generation_source AS generation_source,
          SUM(m.impressions) AS impressions,
          SUM(m.opens) AS opens,
          SUM(m.read_completes) AS read_completes,
          SUM(m.saves) AS saves,
          SUM(m.shares) AS shares
        FROM devotional_daily_metrics m
        INNER JOIN devotionals d ON d.id = m.devotional_id
        WHERE m.date >= ${startKey} AND m.date <= ${endKey}
        GROUP BY m.date, d.generation_source
        ORDER BY m.date ASC
      `,
      prisma.$queryRaw<
        Array<{
          date: string
          generation_source: DevotionalGenerationSource
          locks_created: bigint
        }>
      >`
        SELECT
          l.local_date AS date,
          d.generation_source AS generation_source,
          COUNT(*) AS locks_created
        FROM user_daily_featured_devotionals l
        INNER JOIN devotionals d ON d.id = l.devotional_id
        WHERE l.local_date >= ${startKey} AND l.local_date <= ${endKey}
        GROUP BY l.local_date, d.generation_source
        ORDER BY l.local_date ASC
      `,
      prisma.$queryRaw<
        Array<{
          date: string
          generation_source: DevotionalGenerationSource
          to_publication_state: DevotionalPublicationState
          total: bigint
        }>
      >`
        SELECT
          DATE(e.occurred_at) AS date,
          d.generation_source AS generation_source,
          e.to_publication_state AS to_publication_state,
          COUNT(*) AS total
        FROM devotional_state_transition_events e
        INNER JOIN devotionals d ON d.id = e.devotional_id
        WHERE DATE(e.occurred_at) >= ${startKey}
          AND DATE(e.occurred_at) <= ${endKey}
          AND e.to_publication_state IN ('TRENDING', 'FEATURED')
        GROUP BY DATE(e.occurred_at), d.generation_source, e.to_publication_state
        ORDER BY DATE(e.occurred_at) ASC
      `,
    ])

  return {
    window: {
      start_date: startKey,
      end_date: endKey,
    },
    batches: batchRows.map((row) => ({
      local_date: row.localDate,
      target_count: row.targetCount,
      published_count: row.publishedCount,
      publish_success_rate:
        row.targetCount > 0 ? row.publishedCount / row.targetCount : 0,
      status: row.status,
    })),
    failure_reasons: failureRows.map((row) => ({
      failure_code: row.failureCode,
      count: row._count.failureCode,
    })),
    engagement_by_source: engagementRows.map((row) => ({
      date: row.date,
      generation_source: row.generation_source,
      impressions: Number(row.impressions ?? 0),
      opens: Number(row.opens ?? 0),
      read_completes: Number(row.read_completes ?? 0),
      saves: Number(row.saves ?? 0),
      shares: Number(row.shares ?? 0),
    })),
    daily_featured_by_source: featuredRows.map((row) => ({
      date: row.date,
      generation_source: row.generation_source,
      locks_created: Number(row.locks_created ?? 0),
    })),
    promotions_by_source: promotionRows.map((row) => ({
      date: row.date,
      generation_source: row.generation_source,
      to_publication_state: row.to_publication_state,
      total: Number(row.total ?? 0),
    })),
  }
}
