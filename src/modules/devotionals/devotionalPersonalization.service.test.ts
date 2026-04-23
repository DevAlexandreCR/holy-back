import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DevotionalDailyFeaturedSelectionMode,
  DevotionalModerationStatus,
  DevotionalPublicationState,
} from '@prisma/client'
import { resolveDailyFeaturedForUser } from './devotionalPersonalization.service'

type TestDevotional = {
  id: string
  title: string
  rankingScore: number
  tagIds: number[]
  completedByUserIds: string[]
  publicationState: DevotionalPublicationState
  moderationStatus: DevotionalModerationStatus
}

type TestLock = {
  userId: string
  localDate: string
  devotionalId: string
  candidateId: string
  selectionMode: DevotionalDailyFeaturedSelectionMode
}

type TestAffinity = {
  userId: string
  tagId: number
  score: number
  lastDecayAt: Date
}

const now = new Date('2026-04-23T15:00:00.000Z')
const localDate = '2026-04-23'

const buildDevotional = (params: {
  id: string
  rankingScore: number
  tagIds?: number[]
  completedByUserIds?: string[]
}) =>
  ({
    id: params.id,
    title: `Devocional ${params.id}`,
    rankingScore: params.rankingScore,
    tagIds: params.tagIds ?? [],
    completedByUserIds: params.completedByUserIds ?? [],
    publicationState: DevotionalPublicationState.FEATURED,
    moderationStatus: DevotionalModerationStatus.CLEAR,
  }) satisfies TestDevotional

class FakePersonalizationDb {
  private readonly devotionals: TestDevotional[]
  private readonly timezones = new Map<string, string | null>()
  private readonly affinities: TestAffinity[]
  private readonly locks = new Map<string, TestLock>()
  private readonly candidateRows = new Map<
    string,
    { id: string; localDate: string; devotionalId: string; baseScore: number }
  >()

  constructor(params: {
    devotionals: TestDevotional[]
    affinities?: TestAffinity[]
    locks?: TestLock[]
  }) {
    this.devotionals = params.devotionals
    this.affinities = params.affinities ?? []

    for (const lock of params.locks ?? []) {
      this.locks.set(this.lockKey(lock.userId, lock.localDate), lock)
    }
  }

  readonly userSettings = {
    findUnique: async ({
      where,
    }: {
      where: { userId: string }
      select: { timezone: true }
    }) => ({
      timezone: this.timezones.get(where.userId) ?? null,
    }),
  }

  readonly devotional = {
    findMany: async ({
      where,
      orderBy,
      take,
    }: {
      where: {
        publicationState: { in: DevotionalPublicationState[] }
        moderationStatus: DevotionalModerationStatus
        readCompletions?: {
          none: {
            userId: string
          }
        }
      }
      orderBy: Array<Record<string, 'asc' | 'desc'>>
      take: number
      select: Record<string, boolean>
    }) => {
      const excludedUserId = where.readCompletions?.none.userId

      return this.devotionals
        .filter(
          (devotional) =>
            where.publicationState.in.includes(devotional.publicationState) &&
            devotional.moderationStatus === where.moderationStatus &&
            (!excludedUserId ||
              !devotional.completedByUserIds.includes(excludedUserId))
        )
        .sort((left, right) => {
          if (right.rankingScore !== left.rankingScore) {
            return right.rankingScore - left.rankingScore
          }

          return right.id.localeCompare(left.id)
        })
        .slice(0, take)
        .map((devotional) => this.projectDevotional(devotional))
    },
  }

  readonly devotionalDailyFeatureCandidate = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: {
        localDate_devotionalId: {
          localDate: string
          devotionalId: string
        }
      }
      create: {
        localDate: string
        devotionalId: string
        baseScore: number
      }
      update: {
        baseScore: number
      }
    }) => {
      const key = this.candidateKey(
        where.localDate_devotionalId.localDate,
        where.localDate_devotionalId.devotionalId
      )
      const existing = this.candidateRows.get(key)

      if (existing) {
        const next = { ...existing, baseScore: update.baseScore }
        this.candidateRows.set(key, next)
        return next
      }

      const created = {
        id: `candidate-${create.localDate}-${create.devotionalId}`,
        localDate: create.localDate,
        devotionalId: create.devotionalId,
        baseScore: create.baseScore,
      }
      this.candidateRows.set(key, created)
      return created
    },
  }

  readonly devotionalTagAssignment = {
    findMany: async ({
      where,
    }: {
      where: {
        devotionalId: {
          in: string[]
        }
      }
      select: {
        devotionalId: true
        tagId: true
      }
    }) =>
      this.devotionals
        .filter((devotional) => where.devotionalId.in.includes(devotional.id))
        .flatMap((devotional) =>
          devotional.tagIds.map((tagId) => ({
            devotionalId: devotional.id,
            tagId,
          }))
        ),
  }

  readonly userDevotionalTagAffinity = {
    findMany: async ({
      where,
    }: {
      where: {
        userId: string
        tagId: {
          in: number[]
        }
        score: {
          gt: number
        }
      }
      select: {
        tagId: true
        score: true
        lastDecayAt: true
      }
    }) =>
      this.affinities.filter(
        (affinity) =>
          affinity.userId === where.userId &&
          where.tagId.in.includes(affinity.tagId) &&
          affinity.score > where.score.gt
      ),
  }

  readonly userDailyFeaturedDevotional = {
    findUnique: async ({
      where,
    }: {
      where: {
        userId_localDate: {
          userId: string
          localDate: string
        }
      }
      select: {
        localDate: true
        selectionMode: true
        devotional: {
          select: Record<string, boolean>
        }
      }
    }) => {
      const existing = this.locks.get(
        this.lockKey(
          where.userId_localDate.userId,
          where.userId_localDate.localDate
        )
      )

      if (!existing) {
        return null
      }

      const devotional = this.devotionals.find(
        (item) => item.id === existing.devotionalId
      )

      if (!devotional) {
        return null
      }

      return {
        localDate: existing.localDate,
        selectionMode: existing.selectionMode,
        devotional: this.projectDevotional(devotional),
      }
    },
    upsert: async ({
      where,
      create,
    }: {
      where: {
        userId_localDate: {
          userId: string
          localDate: string
        }
      }
      create: TestLock
      update: Record<string, never>
      select: {
        localDate: true
        selectionMode: true
        devotional: {
          select: Record<string, boolean>
        }
      }
    }) => {
      const key = this.lockKey(
        where.userId_localDate.userId,
        where.userId_localDate.localDate
      )
      const existing = this.locks.get(key) ?? create
      this.locks.set(key, existing)

      const devotional = this.devotionals.find(
        (item) => item.id === existing.devotionalId
      )

      if (!devotional) {
        throw new Error(`Missing devotional ${existing.devotionalId}`)
      }

      return {
        localDate: existing.localDate,
        selectionMode: existing.selectionMode,
        devotional: this.projectDevotional(devotional),
      }
    },
  }

  private projectDevotional(devotional: TestDevotional) {
    return {
      id: devotional.id,
      title: devotional.title,
      content: [{ type: 'paragraph', content: `Contenido ${devotional.id}` }],
      optimizedPreviewText: `Preview ${devotional.id}`,
      imageUrl: null,
      rankingScore: devotional.rankingScore,
      lastScoredAt: now,
      publicationState: devotional.publicationState,
      moderationStatus: devotional.moderationStatus,
    }
  }

  private lockKey(userId: string, lockLocalDate: string) {
    return `${userId}:${lockLocalDate}`
  }

  private candidateKey(candidateLocalDate: string, devotionalId: string) {
    return `${candidateLocalDate}:${devotionalId}`
  }
}

test('selects the highest personalized unread devotional', async () => {
  const db = new FakePersonalizationDb({
    devotionals: [
      buildDevotional({ id: 'a', rankingScore: 79, tagIds: [1] }),
      buildDevotional({ id: 'b', rankingScore: 80, tagIds: [2] }),
    ],
    affinities: [
      {
        userId: 'user-1',
        tagId: 1,
        score: 20,
        lastDecayAt: now,
      },
    ],
  })

  const result = await resolveDailyFeaturedForUser({
    userId: 'user-1',
    now,
    db: db as never,
  })

  assert.ok(result)
  assert.equal(result.devotional.id, 'a')
})

test('falls back to the highest-ranking unread devotional without affinity', async () => {
  const db = new FakePersonalizationDb({
    devotionals: [
      buildDevotional({ id: 'a', rankingScore: 70, tagIds: [1] }),
      buildDevotional({ id: 'b', rankingScore: 80, tagIds: [2] }),
    ],
  })

  const result = await resolveDailyFeaturedForUser({
    userId: 'user-1',
    now,
    db: db as never,
  })

  assert.ok(result)
  assert.equal(result.devotional.id, 'b')
})

test('searches unread inventory before allowing repeated fallback', async () => {
  const devotionals = Array.from({ length: 12 }, (_, index) =>
    buildDevotional({
      id: `d${index + 1}`,
      rankingScore: 120 - index,
      completedByUserIds: index < 11 ? ['user-1'] : [],
    })
  )
  const db = new FakePersonalizationDb({ devotionals })

  const result = await resolveDailyFeaturedForUser({
    userId: 'user-1',
    now,
    db: db as never,
  })

  assert.ok(result)
  assert.equal(result.devotional.id, 'd12')
})

test('returns a repeated devotional only when unread inventory is exhausted', async () => {
  const db = new FakePersonalizationDb({
    devotionals: [
      buildDevotional({
        id: 'a',
        rankingScore: 90,
        completedByUserIds: ['user-1'],
      }),
      buildDevotional({
        id: 'b',
        rankingScore: 80,
        completedByUserIds: ['user-1'],
      }),
    ],
  })

  const result = await resolveDailyFeaturedForUser({
    userId: 'user-1',
    now,
    db: db as never,
  })

  assert.ok(result)
  assert.equal(result.devotional.id, 'a')
})

test('reuses the existing daily lock for the same local day', async () => {
  const db = new FakePersonalizationDb({
    devotionals: [
      buildDevotional({ id: 'a', rankingScore: 79, tagIds: [1] }),
      buildDevotional({ id: 'b', rankingScore: 80, tagIds: [2] }),
    ],
    affinities: [
      {
        userId: 'user-1',
        tagId: 1,
        score: 20,
        lastDecayAt: now,
      },
    ],
    locks: [
      {
        userId: 'user-1',
        localDate,
        devotionalId: 'b',
        candidateId: 'candidate-2026-04-23-b',
        selectionMode:
          DevotionalDailyFeaturedSelectionMode.BASE_SCORE_PLUS_AFFINITY,
      },
    ],
  })

  const result = await resolveDailyFeaturedForUser({
    userId: 'user-1',
    now,
    db: db as never,
  })

  assert.ok(result)
  assert.equal(result.devotional.id, 'b')
})

test('can return different daily devotionals for users with different affinities', async () => {
  const devotionals = [
    buildDevotional({ id: 'a', rankingScore: 79, tagIds: [1] }),
    buildDevotional({ id: 'b', rankingScore: 79, tagIds: [2] }),
  ]
  const affinities = [
    {
      userId: 'user-1',
      tagId: 1,
      score: 20,
      lastDecayAt: now,
    },
    {
      userId: 'user-2',
      tagId: 2,
      score: 20,
      lastDecayAt: now,
    },
  ] satisfies TestAffinity[]
  const db = new FakePersonalizationDb({
    devotionals,
    affinities,
  })

  const [first, second] = await Promise.all([
    resolveDailyFeaturedForUser({
      userId: 'user-1',
      now,
      db: db as never,
    }),
    resolveDailyFeaturedForUser({
      userId: 'user-2',
      now,
      db: db as never,
    }),
  ])

  assert.ok(first)
  assert.ok(second)
  assert.equal(first.devotional.id, 'a')
  assert.equal(second.devotional.id, 'b')
})
