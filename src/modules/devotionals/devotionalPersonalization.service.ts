import {
  DevotionalAffinitySignalType,
  DevotionalDailyFeaturedSelectionMode,
  DevotionalModerationStatus,
  DevotionalPublicationState,
  Prisma,
} from '@prisma/client'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { buildPreviewTextFromPlainText, extractPlainText } from './devotionalFeedContent'
import { DEVOTIONAL_FEED_ELIGIBLE_STATES, DEVOTIONAL_WORDS_PER_MINUTE } from './devotional.policy'

const DEFAULT_TIMEZONE = 'America/Bogota'
const DAILY_FEATURE_CANDIDATE_TARGET = 10
const TAG_AFFINITY_DECAY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
const TAG_AFFINITY_DECAY_FACTOR = 0.9
const TAG_AFFINITY_MIN_SCORE = 0.25

type PersonalizationDbClient = Prisma.TransactionClient | typeof prisma

type DailyFeaturedCandidateRow = {
  id: string
  localDate: string
  devotionalId: string
  baseScore: number
}

type CandidateWithDevotional = DailyFeaturedCandidateRow & {
  devotional: {
    id: string
    title: string
    content: Prisma.JsonValue
    optimizedPreviewText: string
    imageUrl: string | null
    publicationState: DevotionalPublicationState
    moderationStatus: DevotionalModerationStatus
  }
}

export type UserLocalDayContext = {
  timezone: string
  localToday: string
  dayWindowStart: Date
  nextDayWindowStart: Date
  localHour: number
}

export type ResolvedDailyFeatured = {
  localDate: string
  selectionMode: DevotionalDailyFeaturedSelectionMode
  devotional: {
    id: string
    title: string
    estimated_read_time: number
    preview_text: string
    preview_image_url: string | null
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
    hour: Number(byType('hour')),
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

const estimateReadTime = (content: Prisma.JsonValue) => {
  const words = extractPlainText(content).split(/\s+/).filter(Boolean).length
  if (words <= 0) {
    return 1
  }

  return Math.max(1, Math.ceil(words / DEVOTIONAL_WORDS_PER_MINUTE))
}

const isPubliclyEligible = (devotional: {
  publicationState: DevotionalPublicationState
  moderationStatus: DevotionalModerationStatus
}) =>
  DEVOTIONAL_FEED_ELIGIBLE_STATES.some(
    (state) => state === devotional.publicationState
  ) && devotional.moderationStatus === DevotionalModerationStatus.CLEAR

const formatDailyFeatured = (
  devotional: CandidateWithDevotional['devotional']
): ResolvedDailyFeatured['devotional'] => ({
  id: devotional.id,
  title: devotional.title,
  estimated_read_time: estimateReadTime(devotional.content),
  preview_text:
    devotional.optimizedPreviewText.trim() ||
    buildPreviewTextFromPlainText(extractPlainText(devotional.content)),
  preview_image_url: devotional.imageUrl,
})

const computePendingDecay = (params: {
  score: number
  lastDecayAt: Date
  now: Date
}) => {
  const elapsedMs = params.now.getTime() - params.lastDecayAt.getTime()
  const windows = Math.max(0, Math.floor(elapsedMs / TAG_AFFINITY_DECAY_WINDOW_MS))

  if (windows <= 0) {
    return {
      score: params.score,
      windows,
      nextLastDecayAt: params.lastDecayAt,
    }
  }

  let nextScore = params.score * TAG_AFFINITY_DECAY_FACTOR ** windows
  if (nextScore < TAG_AFFINITY_MIN_SCORE) {
    nextScore = 0
  }

  return {
    score: nextScore,
    windows,
    nextLastDecayAt: params.now,
  }
}

const getSignalWeight = (signalType: DevotionalAffinitySignalType) => {
  if (signalType === DevotionalAffinitySignalType.READ_COMPLETE) {
    return config.engagement.affinityWeights.readComplete
  }

  if (signalType === DevotionalAffinitySignalType.SAVE) {
    return config.engagement.affinityWeights.save
  }

  return config.engagement.affinityWeights.share
}

const getCurrentBogotaDate = (now: Date) => getLocalDate(now, DEFAULT_TIMEZONE)

const materializeDailyFeatureCandidatesForDate = async (
  db: PersonalizationDbClient,
  localDate: string
) => {
  const totalEligible = await db.devotional.count({
    where: {
      publicationState: {
        in: [...DEVOTIONAL_FEED_ELIGIBLE_STATES],
      },
      moderationStatus: DevotionalModerationStatus.CLEAR,
    },
  })

  if (totalEligible === 0) {
    return [] as CandidateWithDevotional[]
  }

  const take = Math.min(totalEligible, DAILY_FEATURE_CANDIDATE_TARGET)
  const devotionals = await db.devotional.findMany({
    where: {
      publicationState: {
        in: [...DEVOTIONAL_FEED_ELIGIBLE_STATES],
      },
      moderationStatus: DevotionalModerationStatus.CLEAR,
    },
    orderBy: [
      { rankingScore: 'desc' },
      { lastScoredAt: 'desc' },
      { id: 'desc' },
    ],
    take,
    select: {
      id: true,
      title: true,
      content: true,
      optimizedPreviewText: true,
      imageUrl: true,
      rankingScore: true,
      publicationState: true,
      moderationStatus: true,
    },
  })

  const devotionalById = new Map(devotionals.map((item) => [item.id, item]))

  const candidateRows = await Promise.all(
    devotionals.map((devotional) =>
      db.devotionalDailyFeatureCandidate.upsert({
        where: {
          localDate_devotionalId: {
            localDate,
            devotionalId: devotional.id,
          },
        },
        create: {
          localDate,
          devotionalId: devotional.id,
          baseScore: devotional.rankingScore,
        },
        update: {
          baseScore: devotional.rankingScore,
        },
      })
    )
  )

  return candidateRows.map((row) => ({
    id: row.id,
    localDate: row.localDate,
    devotionalId: row.devotionalId,
    baseScore: row.baseScore,
    devotional: devotionalById.get(row.devotionalId)!,
  }))
}

const buildAffinitySumByDevotionalId = async (
  db: PersonalizationDbClient,
  params: {
    userId: string
    devotionalIds: string[]
    now: Date
  }
) => {
  const devotionalIds = [...new Set(params.devotionalIds)]
  if (devotionalIds.length === 0) {
    return new Map<string, number>()
  }

  const assignments = await db.devotionalTagAssignment.findMany({
    where: {
      devotionalId: {
        in: devotionalIds,
      },
    },
    select: {
      devotionalId: true,
      tagId: true,
    },
  })

  if (assignments.length === 0) {
    return new Map<string, number>()
  }

  const affinityRows = await db.userDevotionalTagAffinity.findMany({
    where: {
      userId: params.userId,
      tagId: {
        in: [...new Set(assignments.map((item) => item.tagId))],
      },
      score: {
        gt: 0,
      },
    },
    select: {
      tagId: true,
      score: true,
      lastDecayAt: true,
    },
  })

  const affinityByTagId = new Map<number, number>()
  for (const row of affinityRows) {
    const decay = computePendingDecay({
      score: row.score,
      lastDecayAt: row.lastDecayAt,
      now: params.now,
    })
    affinityByTagId.set(row.tagId, decay.score)
  }

  const result = new Map<string, number>()
  for (const assignment of assignments) {
    const tagScore = affinityByTagId.get(assignment.tagId) ?? 0
    if (tagScore <= 0) {
      continue
    }

    result.set(
      assignment.devotionalId,
      (result.get(assignment.devotionalId) ?? 0) + tagScore
    )
  }

  return result
}

const resolveLockedDailyFeatured = async (
  db: PersonalizationDbClient,
  params: {
    userId: string
    localDate: string
  }
) => {
  const existing = await db.userDailyFeaturedDevotional.findUnique({
    where: {
      userId_localDate: {
        userId: params.userId,
        localDate: params.localDate,
      },
    },
    select: {
      localDate: true,
      selectionMode: true,
      devotional: {
        select: {
          id: true,
          title: true,
          content: true,
          optimizedPreviewText: true,
          imageUrl: true,
          publicationState: true,
          moderationStatus: true,
        },
      },
    },
  })

  if (!existing || !isPubliclyEligible(existing.devotional)) {
    return null
  }

  return {
    localDate: existing.localDate,
    selectionMode: existing.selectionMode,
    devotional: formatDailyFeatured(existing.devotional),
  } satisfies ResolvedDailyFeatured
}

export const resolveUserLocalDayContext = async (
  db: PersonalizationDbClient,
  userId: string,
  now = new Date()
): Promise<UserLocalDayContext> => {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  })
  const timezone = resolveTimezone(settings?.timezone)
  const localToday = getLocalDate(now, timezone)
  const parts = getZonedDateParts(now, timezone)

  return {
    timezone,
    localToday,
    dayWindowStart: toUtcForLocalMidnight(localToday, timezone),
    nextDayWindowStart: toUtcForLocalMidnight(addDays(localToday, 1), timezone),
    localHour: parts.hour,
  }
}

export const resolveDailyFeaturedForUser = async (params: {
  userId: string
  now?: Date
  db?: PersonalizationDbClient
}) => {
  const db = params.db ?? prisma
  const now = params.now ?? new Date()
  const context = await resolveUserLocalDayContext(db, params.userId, now)
  const existing = await resolveLockedDailyFeatured(db, {
    userId: params.userId,
    localDate: context.localToday,
  })

  if (existing) {
    return existing
  }

  const candidates = await materializeDailyFeatureCandidatesForDate(
    db,
    context.localToday
  )

  if (candidates.length === 0) {
    return null
  }

  const affinitySums = await buildAffinitySumByDevotionalId(db, {
    userId: params.userId,
    devotionalIds: candidates.map((item) => item.devotionalId),
    now,
  })
  const affinityMultiplier = config.engagement.dailyFeaturedAffinity.multiplier
  const affinityCap = config.engagement.dailyFeaturedAffinity.cap

  const selected = [...candidates].sort((left, right) => {
    const leftPersonalizedScore =
      left.baseScore +
      Math.min(
        affinityCap,
        (affinitySums.get(left.devotionalId) ?? 0) * affinityMultiplier
      )
    const rightPersonalizedScore =
      right.baseScore +
      Math.min(
        affinityCap,
        (affinitySums.get(right.devotionalId) ?? 0) * affinityMultiplier
      )

    if (rightPersonalizedScore !== leftPersonalizedScore) {
      return rightPersonalizedScore - leftPersonalizedScore
    }

    if (right.baseScore !== left.baseScore) {
      return right.baseScore - left.baseScore
    }

    return right.devotionalId.localeCompare(left.devotionalId)
  })[0]

  const lock = await db.userDailyFeaturedDevotional.upsert({
    where: {
      userId_localDate: {
        userId: params.userId,
        localDate: context.localToday,
      },
    },
    create: {
      userId: params.userId,
      localDate: context.localToday,
      devotionalId: selected.devotionalId,
      candidateId: selected.id,
      selectionMode: DevotionalDailyFeaturedSelectionMode.BASE_SCORE_PLUS_AFFINITY,
    },
    update: {},
    select: {
      localDate: true,
      selectionMode: true,
      devotional: {
        select: {
          id: true,
          title: true,
          content: true,
          optimizedPreviewText: true,
          imageUrl: true,
          publicationState: true,
          moderationStatus: true,
        },
      },
    },
  })

  if (!isPubliclyEligible(lock.devotional)) {
    return null
  }

  return {
    localDate: lock.localDate,
    selectionMode: lock.selectionMode,
    devotional: formatDailyFeatured(lock.devotional),
  } satisfies ResolvedDailyFeatured
}

export const applyDevotionalAffinitySignal = async (
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    devotionalId: string
    signalType: DevotionalAffinitySignalType
    now?: Date
  }
) => {
  const existingSignal = await tx.devotionalAffinitySignalEvent.findUnique({
    where: {
      userId_devotionalId_signalType: {
        userId: params.userId,
        devotionalId: params.devotionalId,
        signalType: params.signalType,
      },
    },
    select: { id: true },
  })

  if (existingSignal) {
    return {
      applied: false,
      hadAssignments: false,
    }
  }

  await tx.devotionalAffinitySignalEvent.create({
    data: {
      userId: params.userId,
      devotionalId: params.devotionalId,
      signalType: params.signalType,
    },
  })

  const assignments = await tx.devotionalTagAssignment.findMany({
    where: {
      devotionalId: params.devotionalId,
    },
    select: {
      tagId: true,
    },
  })

  if (assignments.length === 0) {
    return {
      applied: false,
      hadAssignments: false,
    }
  }

  const now = params.now ?? new Date()
  const signalWeight = getSignalWeight(params.signalType)
  const existingAffinities = await tx.userDevotionalTagAffinity.findMany({
    where: {
      userId: params.userId,
      tagId: {
        in: assignments.map((item) => item.tagId),
      },
    },
  })
  const affinityByTagId = new Map(existingAffinities.map((item) => [item.tagId, item]))

  for (const assignment of assignments) {
    const existingAffinity = affinityByTagId.get(assignment.tagId)

    if (!existingAffinity) {
      await tx.userDevotionalTagAffinity.create({
        data: {
          userId: params.userId,
          tagId: assignment.tagId,
          score: signalWeight,
          lastSignalAt: now,
          lastDecayAt: now,
        },
      })
      continue
    }

    const decay = computePendingDecay({
      score: existingAffinity.score,
      lastDecayAt: existingAffinity.lastDecayAt,
      now,
    })

    await tx.userDevotionalTagAffinity.update({
      where: {
        userId_tagId: {
          userId: params.userId,
          tagId: assignment.tagId,
        },
      },
      data: {
        score: decay.score + signalWeight,
        lastSignalAt: now,
        lastDecayAt: decay.nextLastDecayAt,
      },
    })
  }

  return {
    applied: true,
    hadAssignments: true,
  }
}

export const getFeedAffinityBoostByDevotionalId = async (params: {
  userId: string
  devotionalIds: string[]
  now?: Date
}) => {
  const affinitySums = await buildAffinitySumByDevotionalId(prisma, {
    userId: params.userId,
    devotionalIds: params.devotionalIds,
    now: params.now ?? new Date(),
  })

  return new Map(
    [...affinitySums.entries()].map(([devotionalId, sum]) => [
      devotionalId,
      Math.min(
        config.engagement.forYouAffinity.cap,
        sum * config.engagement.forYouAffinity.multiplier
      ),
    ])
  )
}

export const runDevotionalDailyFeatureCandidateRefresh = async () => {
  const now = new Date()
  const today = getCurrentBogotaDate(now)
  const tomorrow = addDays(today, 1)

  const [todayCandidates, tomorrowCandidates] = await Promise.all([
    materializeDailyFeatureCandidatesForDate(prisma, today),
    materializeDailyFeatureCandidatesForDate(prisma, tomorrow),
  ])

  return {
    local_dates: [today, tomorrow],
    candidate_counts: {
      [today]: todayCandidates.length,
      [tomorrow]: tomorrowCandidates.length,
    },
  }
}

export const runDevotionalTagAffinityDecay = async () => {
  let processed = 0
  let updated = 0
  let cursor: { userId: string; tagId: number } | undefined
  const now = new Date()

  while (true) {
    const rows = await prisma.userDevotionalTagAffinity.findMany({
      orderBy: [{ userId: 'asc' }, { tagId: 'asc' }],
      take: 100,
      ...(cursor
        ? {
            cursor: {
              userId_tagId: {
                userId: cursor.userId,
                tagId: cursor.tagId,
              },
            },
            skip: 1,
          }
        : {}),
    })

    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      processed += 1
      const decay = computePendingDecay({
        score: row.score,
        lastDecayAt: row.lastDecayAt,
        now,
      })

      if (decay.windows <= 0 || decay.score === row.score) {
        continue
      }

      await prisma.userDevotionalTagAffinity.update({
        where: {
          userId_tagId: {
            userId: row.userId,
            tagId: row.tagId,
          },
        },
        data: {
          score: decay.score,
          lastDecayAt: decay.nextLastDecayAt,
        },
      })
      updated += 1
    }

    const last = rows[rows.length - 1]
    cursor = {
      userId: last.userId,
      tagId: last.tagId,
    }
  }

  return { processed, updated }
}
