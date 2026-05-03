import assert from 'node:assert/strict'
import test from 'node:test'
import { DevotionalPublicationState } from '@prisma/client'
import {
  listFollowingSelections,
  listForYouSelections,
  mergeUniqueFeedCandidates,
  type FeedCandidate,
} from './devotionalFeedStrategy'

const now = Date.now()

const buildCandidate = (params: {
  id: string
  authorId: string
  rankingScore: number
  publishedHoursAgo: number
  publicationState?: DevotionalPublicationState
}) =>
  ({
    id: params.id,
    authorId: params.authorId,
    rankingScore: params.rankingScore,
    publishedAt: new Date(now - params.publishedHoursAgo * 60 * 60 * 1000),
    lastScoredAt: new Date(now - Math.max(params.publishedHoursAgo - 1, 0) * 60 * 60 * 1000),
    publicationState:
      params.publicationState ?? DevotionalPublicationState.PUBLISHED_LOW_REACH,
    featuredUntil: null,
  }) satisfies FeedCandidate

test('for you prioritizes unread inventory and gives fresh unread devotionals visible slots', () => {
  const candidates = [
    buildCandidate({
      id: 'read-top',
      authorId: 'author-a',
      rankingScore: 200,
      publishedHoursAgo: 240,
    }),
    buildCandidate({
      id: 'fresh-unread',
      authorId: 'author-b',
      rankingScore: 5,
      publishedHoursAgo: 2,
    }),
    buildCandidate({
      id: 'stale-unread',
      authorId: 'author-c',
      rankingScore: 6,
      publishedHoursAgo: 160,
    }),
  ]

  const selections = listForYouSelections({
    candidates,
    recentDeliveryIds: new Set<string>(),
    unreadDevotionalIds: new Set(['fresh-unread', 'stale-unread']),
    limit: 2,
    followedAuthorIds: new Set<string>(),
    affinityByCreatorId: new Map<string, number>(),
    affinityBoostByDevotionalId: new Map<string, number>(),
    lowReachAuthorIds: new Set<string>(),
  })

  assert.deepEqual(
    selections.map((item) => item.devotional.id),
    ['fresh-unread', 'stale-unread']
  )
})

test('for you only reuses read devotionals when unread inventory is exhausted', () => {
  const candidates = [
    buildCandidate({
      id: 'read-top',
      authorId: 'author-a',
      rankingScore: 200,
      publishedHoursAgo: 240,
    }),
    buildCandidate({
      id: 'read-second',
      authorId: 'author-b',
      rankingScore: 150,
      publishedHoursAgo: 120,
    }),
  ]

  const selections = listForYouSelections({
    candidates,
    recentDeliveryIds: new Set<string>(),
    unreadDevotionalIds: new Set<string>(),
    limit: 2,
    followedAuthorIds: new Set<string>(),
    affinityByCreatorId: new Map<string, number>(),
    affinityBoostByDevotionalId: new Map<string, number>(),
    lowReachAuthorIds: new Set<string>(),
  })

  assert.deepEqual(
    selections.map((item) => item.devotional.id),
    ['read-top', 'read-second']
  )
})

test('following keeps unread devotionals ahead of already read ones', () => {
  const candidates = [
    buildCandidate({
      id: 'read-newer',
      authorId: 'author-a',
      rankingScore: 100,
      publishedHoursAgo: 1,
    }),
    buildCandidate({
      id: 'unread-older',
      authorId: 'author-b',
      rankingScore: 10,
      publishedHoursAgo: 48,
    }),
  ]

  const selections = listFollowingSelections({
    candidates,
    recentDeliveryIds: new Set<string>(),
    unreadDevotionalIds: new Set(['unread-older']),
    limit: 1,
  })

  assert.deepEqual(selections.map((item) => item.devotional.id), ['unread-older'])
})

test('merges candidate sources without duplicating devotionals', () => {
  const merged = mergeUniqueFeedCandidates(
    [
      buildCandidate({
        id: 'a',
        authorId: 'author-a',
        rankingScore: 50,
        publishedHoursAgo: 24,
      }),
      buildCandidate({
        id: 'b',
        authorId: 'author-b',
        rankingScore: 40,
        publishedHoursAgo: 12,
      }),
    ],
    [
      buildCandidate({
        id: 'b',
        authorId: 'author-b',
        rankingScore: 40,
        publishedHoursAgo: 12,
      }),
      buildCandidate({
        id: 'c',
        authorId: 'author-c',
        rankingScore: 30,
        publishedHoursAgo: 2,
      }),
    ]
  )

  assert.deepEqual(
    merged.map((item) => item.id),
    ['a', 'b', 'c']
  )
})
