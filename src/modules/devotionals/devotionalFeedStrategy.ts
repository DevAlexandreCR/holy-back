import { DevotionalPublicationState } from '@prisma/client'
import { devotionalFeedPolicy } from './devotional.policy'

export const DEVOTIONAL_RECOMMENDATION_REASONS = [
  'FOLLOWED_AUTHOR',
  'RECENTLY_ENGAGED_AUTHOR',
  'TRENDING',
  'DISCOVERY',
] as const

export type DevotionalRecommendationReason =
  (typeof DEVOTIONAL_RECOMMENDATION_REASONS)[number]

export type FeedCandidate = {
  id: string
  authorId: string
  rankingScore: number
  publishedAt: Date | null
  lastScoredAt?: Date | null
  publicationState: DevotionalPublicationState
  featuredUntil?: Date | null
}

export type FeedSelection<T extends FeedCandidate> = {
  devotional: T
  recommendationReason: DevotionalRecommendationReason
}

const compareDatesDesc = (left?: Date | null, right?: Date | null) =>
  (right?.getTime() ?? 0) - (left?.getTime() ?? 0)

const compareNumbersDesc = (left: number, right: number) => right - left

const compareStringsDesc = (left: string, right: string) =>
  right.localeCompare(left)

const isActiveFeatured = (devotional: {
  publicationState: DevotionalPublicationState
  featuredUntil?: Date | null
}) =>
  devotional.publicationState === DevotionalPublicationState.FEATURED &&
  (devotional.featuredUntil == null ||
    devotional.featuredUntil.getTime() > Date.now())

const getDiscoveryReason = (
  devotional: Pick<FeedCandidate, 'publicationState' | 'rankingScore'>
): DevotionalRecommendationReason => {
  if (
    devotional.publicationState === DevotionalPublicationState.TRENDING ||
    devotional.publicationState === DevotionalPublicationState.FEATURED ||
    devotional.rankingScore >= devotionalFeedPolicy.forYou.trendingThreshold
  ) {
    return 'TRENDING'
  }

  return 'DISCOVERY'
}

const getAgeHours = (publishedAt: Date | null, now: number) => {
  if (!publishedAt) {
    return Number.POSITIVE_INFINITY
  }

  return Math.max(0, (now - publishedAt.getTime()) / (1000 * 60 * 60))
}

const isFreshCandidate = (devotional: FeedCandidate, now: number) =>
  getAgeHours(devotional.publishedAt, now) <=
  devotionalFeedPolicy.forYou.freshnessWindowHours

const buildForYouBucketTargets = (limit: number) => {
  const fresh = Math.min(
    limit,
    Math.max(1, Math.round(limit * devotionalFeedPolicy.forYou.mix.fresh))
  )
  const personalized = Math.round(
    limit * devotionalFeedPolicy.forYou.mix.personalized
  )
  const lowReach = Math.round(
    limit * devotionalFeedPolicy.forYou.mix.lowReachExploration
  )
  const global = Math.max(limit - fresh - personalized - lowReach, 0)

  return {
    fresh,
    global,
    lowReach,
    personalized,
  }
}

const appendSelectionsFromBucket = <T extends FeedCandidate>(params: {
  bucket: FeedSelection<T>[]
  target: number
  selected: FeedSelection<T>[]
  selectedIds: Set<string>
  authorCounts: Map<string, number>
  recentDeliveryIds: Set<string>
  unreadDevotionalIds: Set<string>
}) => {
  let added = 0
  const phases = [
    { unreadOnly: true, recentOnly: false, respectAuthorCap: true },
    { unreadOnly: true, recentOnly: true, respectAuthorCap: true },
    {
      unreadOnly: true,
      recentOnly: undefined as boolean | undefined,
      respectAuthorCap: false,
    },
    { unreadOnly: false, recentOnly: false, respectAuthorCap: true },
    { unreadOnly: false, recentOnly: true, respectAuthorCap: true },
    {
      unreadOnly: false,
      recentOnly: undefined as boolean | undefined,
      respectAuthorCap: false,
    },
  ]

  for (const phase of phases) {
    for (const item of params.bucket) {
      if (added >= params.target) {
        return
      }

      const devotional = item.devotional
      if (params.selectedIds.has(devotional.id)) {
        continue
      }

      const isUnread = params.unreadDevotionalIds.has(devotional.id)
      if (phase.unreadOnly && !isUnread) {
        continue
      }
      if (!phase.unreadOnly && isUnread) {
        continue
      }

      const isRecentDelivery = params.recentDeliveryIds.has(devotional.id)
      if (phase.recentOnly === false && isRecentDelivery) {
        continue
      }
      if (phase.recentOnly === true && !isRecentDelivery) {
        continue
      }

      const authorCount = params.authorCounts.get(devotional.authorId) ?? 0
      if (
        phase.respectAuthorCap &&
        authorCount >= devotionalFeedPolicy.authorRepetitionMax
      ) {
        continue
      }

      params.selected.push(item)
      params.selectedIds.add(devotional.id)
      params.authorCounts.set(devotional.authorId, authorCount + 1)
      added += 1
    }
  }
}

const getPersonalizedScore = (
  devotional: FeedCandidate,
  params: {
    followedAuthorIds: Set<string>
    affinityByCreatorId: Map<string, number>
    affinityBoostByDevotionalId: Map<string, number>
  }
) =>
  devotional.rankingScore +
  (params.followedAuthorIds.has(devotional.authorId)
    ? devotionalFeedPolicy.forYou.followBoost
    : 0) +
  (params.affinityByCreatorId.get(devotional.authorId) ?? 0) *
    devotionalFeedPolicy.forYou.affinityScoreMultiplier +
  (params.affinityBoostByDevotionalId.get(devotional.id) ?? 0) +
  (isActiveFeatured(devotional) ? devotionalFeedPolicy.forYou.featuredBoost : 0)

export const mergeUniqueFeedCandidates = <T extends FeedCandidate>(
  ...candidateLists: T[][]
) => {
  const merged: T[] = []
  const seen = new Set<string>()

  for (const candidateList of candidateLists) {
    for (const candidate of candidateList) {
      if (seen.has(candidate.id)) {
        continue
      }

      seen.add(candidate.id)
      merged.push(candidate)
    }
  }

  return merged
}

export const listFollowingSelections = <T extends FeedCandidate>(params: {
  candidates: T[]
  recentDeliveryIds: Set<string>
  unreadDevotionalIds: Set<string>
  limit: number
}) => {
  const ordered = [...params.candidates].sort((left, right) => {
    const featuredComparison =
      Number(isActiveFeatured(right)) - Number(isActiveFeatured(left))
    if (featuredComparison !== 0) {
      return featuredComparison
    }

    const publishedComparison = compareDatesDesc(left.publishedAt, right.publishedAt)
    if (publishedComparison !== 0) {
      return publishedComparison
    }

    const rankingComparison = compareNumbersDesc(
      left.rankingScore,
      right.rankingScore
    )
    if (rankingComparison !== 0) {
      return rankingComparison
    }

    return compareStringsDesc(left.id, right.id)
  })

  const selected: FeedSelection<T>[] = []
  const selectedIds = new Set<string>()
  const authorCounts = new Map<string, number>()

  appendSelectionsFromBucket({
    bucket: ordered.map((devotional) => ({
      devotional,
      recommendationReason: 'FOLLOWED_AUTHOR' as const,
    })),
    target: params.limit,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })

  return selected
}

export const listForYouSelections = <T extends FeedCandidate>(params: {
  candidates: T[]
  recentDeliveryIds: Set<string>
  unreadDevotionalIds: Set<string>
  limit: number
  followedAuthorIds: Set<string>
  affinityByCreatorId: Map<string, number>
  affinityBoostByDevotionalId: Map<string, number>
  lowReachAuthorIds: Set<string>
}) => {
  const now = Date.now()
  const personalizedBucket = params.candidates
    .filter((devotional) => {
      const affinityScore = params.affinityByCreatorId.get(devotional.authorId) ?? 0
      return (
        params.followedAuthorIds.has(devotional.authorId) || affinityScore > 0
      )
    })
    .sort((left, right) => {
      const scoreComparison = compareNumbersDesc(
        getPersonalizedScore(left, params),
        getPersonalizedScore(right, params)
      )
      if (scoreComparison !== 0) {
        return scoreComparison
      }

      const publishedComparison = compareDatesDesc(left.publishedAt, right.publishedAt)
      if (publishedComparison !== 0) {
        return publishedComparison
      }

      return compareStringsDesc(left.id, right.id)
    })
    .map<FeedSelection<T>>((devotional) => ({
      devotional,
      recommendationReason: params.followedAuthorIds.has(devotional.authorId)
        ? 'FOLLOWED_AUTHOR'
        : 'RECENTLY_ENGAGED_AUTHOR',
    }))

  const freshBucket = params.candidates
    .filter((devotional) => isFreshCandidate(devotional, now))
    .sort((left, right) => {
      const featuredComparison =
        Number(isActiveFeatured(right)) - Number(isActiveFeatured(left))
      if (featuredComparison !== 0) {
        return featuredComparison
      }

      const publishedComparison = compareDatesDesc(left.publishedAt, right.publishedAt)
      if (publishedComparison !== 0) {
        return publishedComparison
      }

      const personalizedComparison = compareNumbersDesc(
        getPersonalizedScore(left, params),
        getPersonalizedScore(right, params)
      )
      if (personalizedComparison !== 0) {
        return personalizedComparison
      }

      return compareStringsDesc(left.id, right.id)
    })
    .map<FeedSelection<T>>((devotional) => ({
      devotional,
      recommendationReason: params.followedAuthorIds.has(devotional.authorId)
        ? 'FOLLOWED_AUTHOR'
        : (params.affinityByCreatorId.get(devotional.authorId) ?? 0) > 0
          ? 'RECENTLY_ENGAGED_AUTHOR'
          : getDiscoveryReason(devotional),
    }))

  const lowReachBucket = params.candidates
    .filter((devotional) => params.lowReachAuthorIds.has(devotional.authorId))
    .sort((left, right) => {
      const publishedComparison = compareDatesDesc(left.publishedAt, right.publishedAt)
      if (publishedComparison !== 0) {
        return publishedComparison
      }

      const rankingComparison = compareNumbersDesc(
        left.rankingScore,
        right.rankingScore
      )
      if (rankingComparison !== 0) {
        return rankingComparison
      }

      return compareStringsDesc(left.id, right.id)
    })
    .map<FeedSelection<T>>((devotional) => ({
      devotional,
      recommendationReason: 'DISCOVERY',
    }))

  const globalBucket = [...params.candidates]
    .sort((left, right) => {
      const rankingComparison = compareNumbersDesc(
        left.rankingScore,
        right.rankingScore
      )
      if (rankingComparison !== 0) {
        return rankingComparison
      }

      const publishedComparison = compareDatesDesc(left.publishedAt, right.publishedAt)
      if (publishedComparison !== 0) {
        return publishedComparison
      }

      const scoredComparison = compareDatesDesc(left.lastScoredAt, right.lastScoredAt)
      if (scoredComparison !== 0) {
        return scoredComparison
      }

      return compareStringsDesc(left.id, right.id)
    })
    .map<FeedSelection<T>>((devotional) => ({
      devotional,
      recommendationReason: getDiscoveryReason(devotional),
    }))

  const targets = buildForYouBucketTargets(params.limit)
  const selected: FeedSelection<T>[] = []
  const selectedIds = new Set<string>()
  const authorCounts = new Map<string, number>()

  appendSelectionsFromBucket({
    bucket: freshBucket,
    target: targets.fresh,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })
  appendSelectionsFromBucket({
    bucket: personalizedBucket,
    target: targets.personalized,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })
  appendSelectionsFromBucket({
    bucket: lowReachBucket,
    target: targets.lowReach,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })
  appendSelectionsFromBucket({
    bucket: globalBucket,
    target: targets.global,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })

  appendSelectionsFromBucket({
    bucket: personalizedBucket,
    target: params.limit - selected.length,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })
  appendSelectionsFromBucket({
    bucket: freshBucket,
    target: params.limit - selected.length,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })
  appendSelectionsFromBucket({
    bucket: globalBucket,
    target: params.limit - selected.length,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })
  appendSelectionsFromBucket({
    bucket: lowReachBucket,
    target: params.limit - selected.length,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
    unreadDevotionalIds: params.unreadDevotionalIds,
  })

  return selected
}
