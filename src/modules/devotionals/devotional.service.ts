import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import {
  DevotionalFeedEventType,
  DevotionalImageAssetStatus,
  DevotionalImageModerationStatus,
  DevotionalModerationActionType,
  DevotionalModerationStatus,
  DevotionalNotificationType,
  DevotionalPublicationState,
  DevotionalReportReason,
  DevotionalReportStatus,
  DevotionalStateTransitionSource,
  Prisma,
  UserRole,
} from '@prisma/client'
import { prisma } from '../../config/db'
import { AppError } from '../../common/errors'
import {
  DEVOTIONAL_FEED_DEFAULT_LIMIT,
  DEVOTIONAL_FEED_ELIGIBLE_STATES,
  DEVOTIONAL_MAX_CONTENT_BYTES,
  DEVOTIONAL_MAX_PAGE_LIMIT,
  DEVOTIONAL_PRIVILEGED_FEATURE_ROLES,
  DEVOTIONAL_PREVIEW_MAX_CHARS,
  DEVOTIONAL_PUBLISHED_MANAGEMENT_STATES,
  DEVOTIONAL_WORDS_PER_MINUTE,
  DevotionalFeedMode,
  devotionalFeedPolicy,
  devotionalModerationPolicy,
  devotionalRankingPolicy,
} from './devotional.policy'
import { moderateText, toModerationAuditMetadata } from './devotional.moderation'
import {
  recordPublicationStateTransition,
  resolveDeliveryIdByToken,
} from './devotionalPhase3.service'
import {
  createShareAttributionSource,
  recordFirstAttributedDevotionalOpen,
  recordFirstAttributedReadComplete,
} from '../shareAttribution/shareAttribution.service'
import { sendDevotionalNotifications } from '../notifications/notification.service'

export const DEVOTIONAL_MANAGEMENT_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
] as const

export type DevotionalManagementStatus =
  (typeof DEVOTIONAL_MANAGEMENT_STATUSES)[number]

export const DEVOTIONAL_RECOMMENDATION_REASONS = [
  'FOLLOWED_AUTHOR',
  'RECENTLY_ENGAGED_AUTHOR',
  'TRENDING',
  'DISCOVERY',
] as const

export type DevotionalRecommendationReason =
  (typeof DEVOTIONAL_RECOMMENDATION_REASONS)[number]

type DevotionalWithRelations = Prisma.DevotionalGetPayload<{
  include: {
    author: {
      select: {
        id: true
        name: true
        handle: true
        creatorAvatarUrl: true
        followedBy: { where: { followerId: string }; select: { id: true } }
      }
    }
    moderatedByUser: { select: { id: true; name: true } }
    imageAsset: {
      select: {
        id: true
        status: true
        tempUrl: true
        permanentUrl: true
        width: true
        height: true
        imageModerationStatus: true
      }
    }
    verseReferences: { orderBy: { createdAt: 'asc' } }
    likes: { where: { userId: string }; select: { id: true } }
    saves: { where: { userId: string }; select: { id: true } }
  }
}>

type OffsetCursor = {
  offset: number
}

type FeedSelection = {
  devotional: DevotionalWithRelations
  recommendationReason: DevotionalRecommendationReason
}

const isImageAssetUniqueConstraintError = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false
  }

  if (error.code !== 'P2002') {
    return false
  }

  const target = error.meta?.target
  if (Array.isArray(target)) {
    return target.includes('image_asset_id') || target.includes('imageAssetId')
  }

  if (typeof target === 'string') {
    return target.includes('image_asset_id') || target.includes('imageAssetId')
  }

  return error.message.includes('devotionals_image_asset_id_key')
}

const rethrowKnownDevotionalWriteError = (error: unknown): never => {
  if (isImageAssetUniqueConstraintError(error)) {
    throw new AppError(
      'Image asset is already attached to another devotional',
      'IMAGE_ASSET_ALREADY_ATTACHED',
      409
    )
  }

  throw error
}

const RETRYABLE_WRITE_CONFLICT_ERROR_CODES = new Set(['P2034'])
const RETRYABLE_WRITE_CONFLICT_MAX_ATTEMPTS = 5

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

const toIso = (value: Date | null | undefined) => (value ? value.toISOString() : null)

const formatAuthor = (author: {
  id: string
  name: string
  handle?: string | null
  creatorAvatarUrl?: string | null
}) => ({
  id: author.id,
  name: author.name,
  handle: author.handle,
  avatar_url: normalizeStorageUrl(author.creatorAvatarUrl),
})

const formatAuthorRelationship = (author: {
  followedBy: { id: string }[]
}) => ({
  following: author.followedBy.length > 0,
})

const formatVerseReference = (reference: {
  id: string
  book: string
  chapter: number
  verseStart: number
  verseEnd: number | null
  isPrimary: boolean
  createdAt: Date
}) => ({
  id: reference.id,
  book: reference.book,
  chapter: reference.chapter,
  verse_start: reference.verseStart,
  verse_end: reference.verseEnd,
  is_primary: reference.isPrimary,
  created_at: reference.createdAt.toISOString(),
})

const devotionalInclude = (viewerId?: string | null) =>
  Prisma.validator<Prisma.DevotionalInclude>()({
    author: {
      select: {
        id: true,
        name: true,
        handle: true,
        creatorAvatarUrl: true,
        followedBy: {
          where: { followerId: viewerId ?? '' },
          select: { id: true },
        },
      },
    },
    moderatedByUser: { select: { id: true, name: true } },
    imageAsset: {
      select: {
        id: true,
        status: true,
        tempUrl: true,
        permanentUrl: true,
        width: true,
        height: true,
        imageModerationStatus: true,
      },
    },
    verseReferences: { orderBy: { createdAt: 'asc' } },
    likes: { where: { userId: viewerId ?? '' }, select: { id: true } },
    saves: { where: { userId: viewerId ?? '' }, select: { id: true } },
  })

const ensureContentSize = (content: Prisma.InputJsonValue) => {
  const size = Buffer.byteLength(JSON.stringify(content), 'utf8')
  if (size > DEVOTIONAL_MAX_CONTENT_BYTES) {
    throw new AppError('Content is too large', 'CONTENT_TOO_LARGE', 400)
  }
}

const ensurePrimaryReference = (
  references: {
    is_primary?: boolean
    isPrimary?: boolean
  }[]
) => {
  const hasPrimary = references.some(
    (ref) => ref.is_primary === true || ref.isPrimary === true
  )
  if (!hasPrimary) {
    throw new AppError(
      'At least one primary verse reference is required',
      'PRIMARY_REFERENCE_REQUIRED',
      400
    )
  }
}

const extractContentOps = (content: unknown): Record<string, unknown>[] => {
  if (Array.isArray(content)) {
    return content.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  }
  if (
    content &&
    typeof content === 'object' &&
    'ops' in content &&
    Array.isArray((content as { ops?: unknown }).ops)
  ) {
    return (content as { ops: unknown[] }).ops.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === 'object'
    )
  }
  return []
}

const extractPlainText = (content: unknown) => {
  const buffer = extractContentOps(content)
    .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
    .join('')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  return buffer.replace(/\n{3,}/g, '\n\n')
}

const buildPreviewText = (content: unknown) => {
  const text = extractPlainText(content).replace(/\s+/g, ' ').trim()
  if (text.length <= DEVOTIONAL_PREVIEW_MAX_CHARS) {
    return text
  }
  return `${text.slice(0, DEVOTIONAL_PREVIEW_MAX_CHARS).trimEnd()}...`
}

const estimateReadTime = (content: unknown) => {
  const words = extractPlainText(content).split(/\s+/).filter(Boolean).length
  if (words <= 0) {
    return 1
  }
  return Math.max(1, Math.ceil(words / DEVOTIONAL_WORDS_PER_MINUTE))
}

const toManagementStatus = (
  publicationState: DevotionalPublicationState
): DevotionalManagementStatus => {
  if (publicationState === DevotionalPublicationState.DRAFT) {
    return 'DRAFT'
  }
  if (publicationState === DevotionalPublicationState.ARCHIVED) {
    return 'ARCHIVED'
  }
  return 'PUBLISHED'
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

const isFeedEligible = (devotional: {
  publicationState: DevotionalPublicationState
  moderationStatus: DevotionalModerationStatus
}) =>
  DEVOTIONAL_FEED_ELIGIBLE_STATES.some(
    (state) => state === devotional.publicationState
  ) &&
  devotional.moderationStatus === DevotionalModerationStatus.CLEAR

const isPubliclyVisible = (devotional: {
  publicationState: DevotionalPublicationState
  moderationStatus: DevotionalModerationStatus
}) => isFeedEligible(devotional)

const isPrivilegedViewer = (role?: UserRole | null) =>
  role === UserRole.ADMIN || role === UserRole.EDITOR || role === UserRole.LEAD

const getsPrivilegedInitialVisibility = (role?: UserRole | null) =>
  role != null &&
  DEVOTIONAL_PRIVILEGED_FEATURE_ROLES.some(
    (allowedRole) => allowedRole === role
  )

const normalizeStorageUrl = (value?: string | null) => {
  if (!value) {
    return null
  }

  if (value.startsWith('/storage/')) {
    return value
  }

  try {
    const parsed = new URL(value)
    if (parsed.pathname.startsWith('/storage/')) {
      return parsed.pathname
    }
  } catch {}

  return value
}

const resolveImageUrl = (devotional: {
  imageUrl: string | null
  imageAsset?: { permanentUrl: string | null; tempUrl: string } | null
}) =>
  normalizeStorageUrl(devotional.imageUrl) ??
  normalizeStorageUrl(devotional.imageAsset?.permanentUrl) ??
  normalizeStorageUrl(devotional.imageAsset?.tempUrl) ??
  null

const formatCounters = (devotional: {
  likeCount: number
  commentCount: number
  shareCount: number
  saveCount: number
}) => ({
  like_count: devotional.likeCount,
  comment_count: devotional.commentCount,
  share_count: devotional.shareCount,
  save_count: devotional.saveCount,
})

const formatViewerState = (devotional: {
  likes: { id: string }[]
  saves: { id: string }[]
}) => ({
  liked: devotional.likes.length > 0,
  saved: devotional.saves.length > 0,
})

const formatDevotional = (
  devotional: DevotionalWithRelations,
  options: {
    includeContent?: boolean
    viewerId?: string | null
    deliveryToken?: string
    recommendationReason?: DevotionalRecommendationReason | null
  } = {}
) => {
  const viewerState = formatViewerState(devotional)
  const imageUrl = resolveImageUrl(devotional)
  const authorRelationship = formatAuthorRelationship(devotional.author)

  return {
    id: devotional.id,
    title: devotional.title,
    ...(options.includeContent ? { content: devotional.content } : {}),
    status: toManagementStatus(devotional.publicationState),
    publication_state: devotional.publicationState,
    moderation_status: devotional.moderationStatus,
    effective_state: toEffectiveState(
      devotional.publicationState,
      devotional.moderationStatus
    ),
    moderation_reason: devotional.moderationReason,
    image_moderation_status: devotional.imageModerationStatus,
    cover_image_url: imageUrl,
    image_url: imageUrl,
    preview_image_url: imageUrl,
    cover_image_focus_y: devotional.coverImageFocusY,
    preview_text: buildPreviewText(devotional.content),
    estimated_read_time: estimateReadTime(devotional.content),
    view_count: devotional.viewCount,
    published_at: toIso(devotional.publishedAt),
    first_published_at: toIso(devotional.firstPublishedAt),
    created_at: devotional.createdAt.toISOString(),
    updated_at: devotional.updatedAt.toISOString(),
    author: formatAuthor(devotional.author),
    author_relationship: authorRelationship,
    moderated_by: devotional.moderatedByUser
      ? formatAuthor(devotional.moderatedByUser)
      : null,
    moderated_at: toIso(devotional.moderatedAt),
    verse_references: devotional.verseReferences.map(formatVerseReference),
    likes_count: devotional.likeCount,
    comments_count: devotional.commentCount,
    share_count: devotional.shareCount,
    save_count: devotional.saveCount,
    read_complete_count: devotional.readCompleteCount,
    impression_count: devotional.impressionCount,
    unique_impression_count: devotional.uniqueImpressionCount,
    liked: viewerState.liked,
    saved: viewerState.saved,
    is_owner: options.viewerId ? devotional.authorId === options.viewerId : false,
    viewer_state: viewerState,
    counters: formatCounters(devotional),
    ...(options.deliveryToken ? { delivery_token: options.deliveryToken } : {}),
    recommendation_reason: options.recommendationReason ?? null,
  }
}

const encodeOffsetCursor = (cursor: OffsetCursor) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')

const decodeOffsetCursor = (cursor?: string | null): OffsetCursor | null => {
  if (!cursor) return null

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as OffsetCursor
    if (typeof parsed.offset !== 'number' || parsed.offset < 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const getCursorOffset = (cursor?: string | null) =>
  Math.max(0, decodeOffsetCursor(cursor)?.offset ?? 0)

const ensureImageAssetAttachable = async (
  tx: Prisma.TransactionClient,
  userId: string,
  imageAssetId?: string | null
) => {
  if (!imageAssetId) {
    return null
  }

  const asset = await tx.devotionalImageAsset.findUnique({
    where: { id: imageAssetId },
  })

  if (!asset || asset.userId !== userId) {
    throw new AppError('Image asset not found', 'IMAGE_ASSET_NOT_FOUND', 404)
  }

  if (
    asset.status !== DevotionalImageAssetStatus.ATTACHABLE &&
    asset.status !== DevotionalImageAssetStatus.USED
  ) {
    throw new AppError(
      'Image asset is not attachable',
      'IMAGE_ASSET_NOT_ATTACHABLE',
      400
    )
  }

  if (asset.imageModerationStatus !== DevotionalImageModerationStatus.APPROVED) {
    throw new AppError(
      'Image asset was rejected',
      'IMAGE_ASSET_REJECTED',
      400
    )
  }

  return asset
}

const ensurePermanentImage = async (
  tx: Prisma.TransactionClient,
  imageAssetId?: string | null
) => {
  if (!imageAssetId) {
    return {
      imageUrl: null as string | null,
      imageModerationStatus: DevotionalImageModerationStatus.PENDING,
      imageModerationResultRaw: Prisma.JsonNull,
      disconnectImageAsset: false,
    }
  }

  const asset = await tx.devotionalImageAsset.findUnique({
    where: { id: imageAssetId },
  })

  if (!asset) {
    return {
      imageUrl: null as string | null,
      imageModerationStatus: DevotionalImageModerationStatus.PENDING,
      imageModerationResultRaw: Prisma.JsonNull,
      disconnectImageAsset: true,
    }
  }

  if (
    asset.imageModerationStatus !== DevotionalImageModerationStatus.APPROVED ||
    (asset.expiresAt != null && asset.expiresAt.getTime() <= Date.now()) ||
    (asset.status !== DevotionalImageAssetStatus.ATTACHABLE &&
      asset.status !== DevotionalImageAssetStatus.USED)
  ) {
    return {
      imageUrl: null as string | null,
      imageModerationStatus: asset.imageModerationStatus,
      imageModerationResultRaw: asset.moderationResultRaw ?? Prisma.JsonNull,
      disconnectImageAsset: true,
    }
  }

  if (asset.permanentUrl) {
    await tx.devotionalImageAsset.update({
      where: { id: asset.id },
      data: {
        status: DevotionalImageAssetStatus.USED,
        usedAt: asset.usedAt ?? new Date(),
      },
    })

    return {
      imageUrl: asset.permanentUrl,
      imageModerationStatus: asset.imageModerationStatus,
      imageModerationResultRaw: asset.moderationResultRaw ?? Prisma.JsonNull,
      disconnectImageAsset: false,
    }
  }

  const extension = path.extname(asset.tempPath) || '.webp'
  const filename = `${asset.id}${extension}`
  const permanentDir = path.join(process.cwd(), 'storage', 'devotionals', 'images')
  const permanentPath = path.join(permanentDir, filename)
  const permanentUrl = `/storage/devotionals/images/${filename}`

  await fs.mkdir(permanentDir, { recursive: true })
  await fs.rename(asset.tempPath, permanentPath)

  await tx.devotionalImageAsset.update({
    where: { id: asset.id },
    data: {
      status: DevotionalImageAssetStatus.USED,
      permanentPath,
      permanentUrl,
      usedAt: new Date(),
    },
  })

  return {
    imageUrl: permanentUrl,
    imageModerationStatus: asset.imageModerationStatus,
    imageModerationResultRaw: asset.moderationResultRaw ?? Prisma.JsonNull,
    disconnectImageAsset: false,
  }
}

const addModerationAction = async (
  tx: Prisma.TransactionClient,
  params: {
    devotionalId: string
    actorId?: string | null
    actionType: DevotionalModerationActionType
    reason?: string | null
    metadata?: Prisma.InputJsonValue
  }
) => {
  await tx.devotionalModerationAction.create({
    data: {
      devotionalId: params.devotionalId,
      actorId: params.actorId ?? null,
      actionType: params.actionType,
      reason: params.reason ?? null,
      metadata: params.metadata ?? undefined,
    },
  })
}

const buildManagementWhere = (
  status: DevotionalManagementStatus,
  authorId?: string
): Prisma.DevotionalWhereInput => {
  const publicationFilter =
    status === 'DRAFT'
      ? { publicationState: DevotionalPublicationState.DRAFT }
      : status === 'ARCHIVED'
        ? { publicationState: DevotionalPublicationState.ARCHIVED }
        : {
            publicationState: {
              in: [...DEVOTIONAL_PUBLISHED_MANAGEMENT_STATES],
            },
          }

  return {
    ...publicationFilter,
    ...(authorId ? { authorId } : {}),
  }
}

const getFeedCandidateWindow = (limit: number) =>
  Math.max(limit, DEVOTIONAL_FEED_DEFAULT_LIMIT)

const getFeedCandidateWindowByMode = (
  mode: DevotionalFeedMode,
  requiredItems: number
) =>
  getFeedCandidateWindow(requiredItems) *
  (mode === 'following'
    ? devotionalFeedPolicy.following.candidateWindowMultiplier
    : devotionalFeedPolicy.forYou.candidateWindowMultiplier)

const selectFeedCandidates = (params: {
  candidates: DevotionalWithRelations[]
  recentDeliveryIds: Set<string>
  limit: number
}) => {
  const authorCounts = new Map<string, number>()
  const selected: DevotionalWithRelations[] = []
  const selectedIds = new Set<string>()

  const trySelect = (candidate: DevotionalWithRelations, respectAuthorCap: boolean) => {
    if (selected.length >= params.limit || selectedIds.has(candidate.id)) {
      return
    }

    const authorCount = authorCounts.get(candidate.authorId) ?? 0
    if (
      respectAuthorCap &&
      authorCount >= devotionalFeedPolicy.authorRepetitionMax
    ) {
      return
    }

    selected.push(candidate)
    selectedIds.add(candidate.id)
    authorCounts.set(candidate.authorId, authorCount + 1)
  }

  for (const candidate of params.candidates) {
    if (params.recentDeliveryIds.has(candidate.id)) {
      continue
    }
    trySelect(candidate, true)
  }

  for (const candidate of params.candidates) {
    if (!params.recentDeliveryIds.has(candidate.id)) {
      continue
    }
    trySelect(candidate, true)
  }

  for (const candidate of params.candidates) {
    trySelect(candidate, false)
  }

  return {
    items: selected,
    selectedIds,
  }
}

const isActiveFeatured = (devotional: {
  publicationState: DevotionalPublicationState
  featuredUntil: Date | null
}) =>
  devotional.publicationState === DevotionalPublicationState.FEATURED &&
  (devotional.featuredUntil == null ||
    devotional.featuredUntil.getTime() > Date.now())

const compareDatesDesc = (left?: Date | null, right?: Date | null) =>
  (right?.getTime() ?? 0) - (left?.getTime() ?? 0)

const compareNumbersDesc = (left: number, right: number) => right - left

const compareStringsDesc = (left: string, right: string) =>
  right.localeCompare(left)

const buildEligibleFeedWhere = (): Prisma.DevotionalWhereInput => ({
  publicationState: { in: [...DEVOTIONAL_FEED_ELIGIBLE_STATES] },
  moderationStatus: DevotionalModerationStatus.CLEAR,
})

const getDiscoveryReason = (
  devotional: Pick<DevotionalWithRelations, 'publicationState' | 'rankingScore'>
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

const buildBucketTargets = (limit: number) => {
  const personalized = Math.round(limit * devotionalFeedPolicy.forYou.mix.personalized)
  const lowReach = Math.round(
    limit * devotionalFeedPolicy.forYou.mix.lowReachExploration
  )
  const global = Math.max(limit - personalized - lowReach, 0)

  return {
    global,
    lowReach,
    personalized,
  }
}

const appendSelectionsFromBucket = (params: {
  bucket: FeedSelection[]
  target: number
  selected: FeedSelection[]
  selectedIds: Set<string>
  authorCounts: Map<string, number>
  recentDeliveryIds: Set<string>
}) => {
  let added = 0
  const phases = [
    { recentOnly: false, respectAuthorCap: true },
    { recentOnly: true, respectAuthorCap: true },
    { recentOnly: undefined as boolean | undefined, respectAuthorCap: false },
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

      const isRecent = params.recentDeliveryIds.has(devotional.id)
      if (phase.recentOnly === false && isRecent) {
        continue
      }
      if (phase.recentOnly === true && !isRecent) {
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

const upsertCreatorAffinity = async (
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    creatorId: string
    scoreDelta: number
    signaledAt?: Date
  }
) => {
  if (
    params.userId === params.creatorId ||
    !Number.isFinite(params.scoreDelta) ||
    params.scoreDelta <= 0
  ) {
    return
  }

  await tx.userCreatorAffinity.upsert({
    where: {
      userId_creatorId: {
        userId: params.userId,
        creatorId: params.creatorId,
      },
    },
    create: {
      userId: params.userId,
      creatorId: params.creatorId,
      score: params.scoreDelta,
      lastSignalAt: params.signaledAt ?? new Date(),
    },
    update: {
      score: { increment: params.scoreDelta },
      lastSignalAt: params.signaledAt ?? new Date(),
    },
  })
}

const getCurrentReadCompleteCount = async (devotionalId: string) => {
  const updated = await prisma.devotional.findUnique({
    where: { id: devotionalId },
    select: { readCompleteCount: true },
  })

  return updated?.readCompleteCount ?? 0
}

const syncReadCompleteCount = async (devotionalId: string) => {
  const readCompleteCount = await prisma.devotionalReadComplete.count({
    where: { devotionalId },
  })

  const updated = await prisma.devotional.update({
    where: { id: devotionalId },
    data: { readCompleteCount },
    select: { readCompleteCount: true },
  })

  return updated.readCompleteCount
}

const insertDevotionalReadComplete = async (params: {
  devotionalId: string
  userId: string
  deliveryId?: string | null
}) => {
  const created = await withRetryableWriteConflict(() =>
    prisma.$executeRaw`
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
  )

  return Number(created) > 0
}

const previewDeliveryToken = (token?: string | null) => {
  if (!token) {
    return null
  }

  if (token.length <= 12) {
    return token
  }

  return `${token.slice(0, 8)}...${token.slice(-4)}`
}

const applyReadCompleteSideEffects = async (params: {
  devotionalId: string
  userId: string
  creatorId: string
}) =>
  withRetryableWriteConflict(() =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.devotional.update({
        where: { id: params.devotionalId },
        data: { readCompleteCount: { increment: 1 } },
        select: { readCompleteCount: true },
      })

      await upsertCreatorAffinity(tx, {
        userId: params.userId,
        creatorId: params.creatorId,
        scoreDelta: devotionalFeedPolicy.affinitySignals.readComplete,
      })

      return updated.readCompleteCount
    })
  )

const listFollowingSelections = (params: {
  candidates: DevotionalWithRelations[]
  recentDeliveryIds: Set<string>
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

  const selected = selectFeedCandidates({
    candidates: ordered,
    recentDeliveryIds: params.recentDeliveryIds,
    limit: params.limit,
  }).items

  return selected.map<FeedSelection>((devotional) => ({
    devotional,
    recommendationReason: 'FOLLOWED_AUTHOR',
  }))
}

const listForYouSelections = (params: {
  candidates: DevotionalWithRelations[]
  recentDeliveryIds: Set<string>
  limit: number
  followedAuthorIds: Set<string>
  affinityByCreatorId: Map<string, number>
  lowReachAuthorIds: Set<string>
}) => {
  const personalizedBucket = params.candidates
    .filter((devotional) => {
      const affinityScore = params.affinityByCreatorId.get(devotional.authorId) ?? 0
      return (
        params.followedAuthorIds.has(devotional.authorId) || affinityScore > 0
      )
    })
    .sort((left, right) => {
      const leftScore =
        left.rankingScore +
        (params.followedAuthorIds.has(left.authorId)
          ? devotionalFeedPolicy.forYou.followBoost
          : 0) +
        (params.affinityByCreatorId.get(left.authorId) ?? 0) *
          devotionalFeedPolicy.forYou.affinityScoreMultiplier +
        (isActiveFeatured(left) ? devotionalFeedPolicy.forYou.featuredBoost : 0)
      const rightScore =
        right.rankingScore +
        (params.followedAuthorIds.has(right.authorId)
          ? devotionalFeedPolicy.forYou.followBoost
          : 0) +
        (params.affinityByCreatorId.get(right.authorId) ?? 0) *
          devotionalFeedPolicy.forYou.affinityScoreMultiplier +
        (isActiveFeatured(right) ? devotionalFeedPolicy.forYou.featuredBoost : 0)

      const scoreComparison = compareNumbersDesc(leftScore, rightScore)
      if (scoreComparison !== 0) {
        return scoreComparison
      }

      const publishedComparison = compareDatesDesc(left.publishedAt, right.publishedAt)
      if (publishedComparison !== 0) {
        return publishedComparison
      }

      return compareStringsDesc(left.id, right.id)
    })
    .map<FeedSelection>((devotional) => ({
      devotional,
      recommendationReason: params.followedAuthorIds.has(devotional.authorId)
        ? 'FOLLOWED_AUTHOR'
        : 'RECENTLY_ENGAGED_AUTHOR',
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
    .map<FeedSelection>((devotional) => ({
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

      const scoredComparison = compareDatesDesc(left.lastScoredAt, right.lastScoredAt)
      if (scoredComparison !== 0) {
        return scoredComparison
      }

      return compareStringsDesc(left.id, right.id)
    })
    .map<FeedSelection>((devotional) => ({
      devotional,
      recommendationReason: getDiscoveryReason(devotional),
    }))

  const targets = buildBucketTargets(params.limit)
  const selected: FeedSelection[] = []
  const selectedIds = new Set<string>()
  const authorCounts = new Map<string, number>()

  appendSelectionsFromBucket({
    bucket: globalBucket,
    target: targets.global,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
  })
  appendSelectionsFromBucket({
    bucket: lowReachBucket,
    target: targets.lowReach,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
  })
  appendSelectionsFromBucket({
    bucket: personalizedBucket,
    target: targets.personalized,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
  })

  appendSelectionsFromBucket({
    bucket: personalizedBucket,
    target: params.limit - selected.length,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
  })
  appendSelectionsFromBucket({
    bucket: globalBucket,
    target: params.limit - selected.length,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
  })
  appendSelectionsFromBucket({
    bucket: lowReachBucket,
    target: params.limit - selected.length,
    selected,
    selectedIds,
    authorCounts,
    recentDeliveryIds: params.recentDeliveryIds,
  })

  return selected
}

const maybeTrackView = async (devotionalId: string, userId?: string | null) => {
  if (!userId) {
    await prisma.devotional.update({
      where: { id: devotionalId },
      data: { viewCount: { increment: 1 } },
    })
    return
  }

  const viewDate = new Date().toISOString().slice(0, 10)

  await prisma.$transaction(async (tx) => {
    const existing = await tx.devotionalView.findUnique({
      where: {
        devotionalId_userId_viewDate: {
          devotionalId,
          userId,
          viewDate,
        },
      },
    })

    if (existing) {
      return
    }

    await tx.devotionalView.create({
      data: {
        devotionalId,
        userId,
        viewDate,
      },
    })

    await tx.devotional.update({
      where: { id: devotionalId },
      data: { viewCount: { increment: 1 } },
    })
  })
}

const assertPublicInteractionAllowed = (devotional: {
  publicationState: DevotionalPublicationState
  moderationStatus: DevotionalModerationStatus
}) => {
  if (!isPubliclyVisible(devotional)) {
    throw new AppError(
      'This devotional is not available for public interaction',
      'DEVOTIONAL_NOT_PUBLIC',
      403
    )
  }
}

const getAuthorImpressionsLast24h = async () => {
  const today = new Date()
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const dates = [today.toISOString().slice(0, 10), yesterday.toISOString().slice(0, 10)]

  const rows = await prisma.devotionalAuthorImpressionDaily.findMany({
    where: { date: { in: dates } },
    select: { authorId: true, impressions: true, date: true },
  })

  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.authorId, (totals.get(row.authorId) ?? 0) + row.impressions)
  }
  return totals
}

export const createDevotional = async (params: {
  authorId: string
  title: string
  content: Prisma.InputJsonValue
  verseReferences: {
    book: string
    chapter: number
    verse_start: number
    verse_end?: number
    is_primary?: boolean
  }[]
  imageAssetId?: string | null
  coverImageFocusY?: number | null
}) => {
  ensureContentSize(params.content)
  ensurePrimaryReference(params.verseReferences)
  try {
    const devotional = await prisma.$transaction(async (tx) => {
      await ensureImageAssetAttachable(tx, params.authorId, params.imageAssetId)

      return tx.devotional.create({
        data: {
          title: params.title.trim(),
          content: params.content,
          authorId: params.authorId,
          imageAssetId: params.imageAssetId ?? null,
          coverImageFocusY: params.coverImageFocusY ?? null,
          publicationState: DevotionalPublicationState.DRAFT,
          moderationStatus: DevotionalModerationStatus.CLEAR,
          verseReferences: {
            create: params.verseReferences.map((reference) => ({
              book: reference.book.trim(),
              chapter: reference.chapter,
              verseStart: reference.verse_start,
              verseEnd: reference.verse_end ?? null,
              isPrimary: reference.is_primary ?? false,
            })),
          },
        },
        include: devotionalInclude(params.authorId),
      })
    })

    console.log('[CreateDevotional] Created draft devotional; notifications are sent on publish', {
      devotionalId: devotional.id,
      authorId: params.authorId,
      publicationState: devotional.publicationState,
      moderationStatus: devotional.moderationStatus,
    })

    return formatDevotional(devotional, {
      includeContent: true,
      viewerId: params.authorId,
    })
  } catch (error) {
    return rethrowKnownDevotionalWriteError(error)
  }
}

export const listDevotionals = async (params: {
  status: DevotionalManagementStatus
  page: number
  limit: number
  authorId?: string
  viewerId?: string | null
}) => {
  const limit = Math.min(Math.max(params.limit, 1), DEVOTIONAL_MAX_PAGE_LIMIT)
  const page = Math.max(params.page, 1)
  const skip = (page - 1) * limit
  const where = buildManagementWhere(params.status, params.authorId)

  const orderBy =
    params.status === 'PUBLISHED'
      ? [{ publishedAt: 'desc' as const }, { updatedAt: 'desc' as const }]
      : [{ updatedAt: 'desc' as const }]

  const [items, total] = await prisma.$transaction([
    prisma.devotional.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: devotionalInclude(params.viewerId),
    }),
    prisma.devotional.count({ where }),
  ])

  return {
    items: items.map((item) =>
      formatDevotional(item, { viewerId: params.viewerId })
    ),
    page,
    limit,
    total,
  }
}

export const listFeedDevotionals = async (params: {
  userId: string
  cursor?: string | null
  limit: number
  mode?: DevotionalFeedMode
}) => {
  const mode = params.mode ?? 'for_you'
  const limit = Math.min(Math.max(params.limit, 1), DEVOTIONAL_FEED_DEFAULT_LIMIT)
  const offset = getCursorOffset(params.cursor)
  const selectionWindow = offset + limit + 1
  const candidateWindow = getFeedCandidateWindowByMode(mode, selectionWindow)
  const dedupSince = new Date(
    Date.now() - devotionalFeedPolicy.dedupWindowHours * 60 * 60 * 1000
  )

  const recentDeliveries = await prisma.devotionalFeedDelivery.findMany({
    where: {
      userId: params.userId,
      deliveredAt: { gte: dedupSince },
    },
    select: { devotionalId: true },
  })

  const seenDevotionalIds = new Set(recentDeliveries.map((item) => item.devotionalId))
  const followedAuthorRows = await prisma.userFollow.findMany({
    where: { followerId: params.userId },
    select: { followedId: true },
  })
  const followedAuthorIds = new Set(
    followedAuthorRows.map((item) => item.followedId)
  )

  const where: Prisma.DevotionalWhereInput =
    mode === 'following'
      ? {
          ...buildEligibleFeedWhere(),
          authorId: { in: [...followedAuthorIds] },
        }
      : buildEligibleFeedWhere()

  const fetchedCandidates = await prisma.devotional.findMany({
    where,
    orderBy:
      mode === 'following'
        ? [
            { publishedAt: 'desc' },
            { rankingScore: 'desc' },
            { id: 'desc' },
          ]
        : [
            { rankingScore: 'desc' },
            { lastScoredAt: 'desc' },
            { id: 'desc' },
          ],
    take: candidateWindow,
    include: devotionalInclude(params.userId),
  })

  let orderedSelections: FeedSelection[] = []

  if (mode === 'following') {
    orderedSelections = listFollowingSelections({
      candidates: fetchedCandidates,
      recentDeliveryIds: seenDevotionalIds,
      limit: selectionWindow,
    })
  } else {
    const affinityRows = await prisma.userCreatorAffinity.findMany({
      where: {
        userId: params.userId,
        creatorId: {
          in: [...new Set(fetchedCandidates.map((item) => item.authorId))],
        },
      },
      select: {
        creatorId: true,
        score: true,
      },
    })
    const affinityByCreatorId = new Map(
      affinityRows.map((item) => [item.creatorId, item.score])
    )
    const authorImpressionsLast24h = await getAuthorImpressionsLast24h()
    const lowReachAuthorIds = new Set<string>()

    for (const devotional of fetchedCandidates) {
      if (
        (authorImpressionsLast24h.get(devotional.authorId) ?? 0) <=
        devotionalFeedPolicy.forYou.lowReachAuthorImpressions24hMax
      ) {
        lowReachAuthorIds.add(devotional.authorId)
      }
    }

    orderedSelections = listForYouSelections({
      candidates: fetchedCandidates,
      recentDeliveryIds: seenDevotionalIds,
      limit: selectionWindow,
      followedAuthorIds,
      affinityByCreatorId,
      lowReachAuthorIds,
    })
  }

  const pageSelections = orderedSelections.slice(offset, offset + limit)

  const deliveries = await Promise.all(
    pageSelections.map(async ({ devotional, recommendationReason }) => {
      const delivery = await prisma.devotionalFeedDelivery.create({
        data: {
          token: crypto.randomUUID(),
          devotionalId: devotional.id,
          userId: params.userId,
          feedMode: mode,
          recommendationReason,
          rankingScore: devotional.rankingScore,
        },
      })

      return {
        devotional,
        token: delivery.token,
        recommendationReason,
      }
    })
  )

  const hasMore = orderedSelections.length > offset + pageSelections.length
  const nextOffset = offset + pageSelections.length

  return {
    items: deliveries.map(({ devotional, token, recommendationReason }) =>
      formatDevotional(devotional, {
        viewerId: params.userId,
        deliveryToken: token,
        recommendationReason,
      })
    ),
    next_cursor:
      pageSelections.length > 0 && hasMore
        ? encodeOffsetCursor({ offset: nextOffset })
        : null,
    has_more: pageSelections.length > 0 && hasMore,
  }
}

export const listPublicCreatorDevotionals = async (params: {
  creatorId: string
  viewerId: string
  cursor?: string | null
  limit: number
}) => {
  const limit = Math.min(Math.max(params.limit, 1), DEVOTIONAL_FEED_DEFAULT_LIMIT)
  const offset = getCursorOffset(params.cursor)
  const take = offset + limit + 1

  const items = await prisma.devotional.findMany({
    where: {
      ...buildEligibleFeedWhere(),
      authorId: params.creatorId,
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take,
    include: devotionalInclude(params.viewerId),
  })

  const pageItems = items.slice(offset, offset + limit)
  const hasMore = items.length > offset + pageItems.length

  return {
    items: pageItems.map((item) =>
      formatDevotional(item, { viewerId: params.viewerId })
    ),
    next_cursor:
      pageItems.length > 0 && hasMore
        ? encodeOffsetCursor({ offset: offset + pageItems.length })
        : null,
    has_more: pageItems.length > 0 && hasMore,
  }
}

export const getDevotionalById = async (params: {
  devotionalId: string
  viewerId?: string | null
  viewerRole?: UserRole | null
  shareToken?: string | null
  deviceId?: string | null
}) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: params.devotionalId },
    include: devotionalInclude(params.viewerId),
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  const canAccessPrivate =
    params.viewerId === devotional.authorId || isPrivilegedViewer(params.viewerRole)

  if (!isPubliclyVisible(devotional) && !canAccessPrivate) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  if (isPubliclyVisible(devotional)) {
    await maybeTrackView(params.devotionalId, params.viewerId)
    if (params.viewerId && params.shareToken) {
      await recordFirstAttributedDevotionalOpen({
        token: params.shareToken,
        devotionalId: devotional.id,
        userId: params.viewerId,
        deviceId: params.deviceId,
      })
    }
  }

  return formatDevotional(devotional, {
    includeContent: true,
    viewerId: params.viewerId,
  })
}

export const updateDevotional = async (params: {
  devotionalId: string
  viewerId: string
  title?: string
  content?: Prisma.InputJsonValue
  imageAssetId?: string | null
  coverImageFocusY?: number | null
  verseReferences?: {
    book: string
    chapter: number
    verse_start: number
    verse_end?: number
    is_primary?: boolean
  }[]
}) => {
  if (params.content !== undefined) {
    ensureContentSize(params.content)
  }

  if (params.verseReferences) {
    ensurePrimaryReference(params.verseReferences)
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.devotional.findUnique({
        where: { id: params.devotionalId },
        select: { publicationState: true },
      })

      if (!existing) {
        throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
      }

      if (existing.publicationState === DevotionalPublicationState.ARCHIVED) {
        throw new AppError(
          'Archived devotionals cannot be edited',
          'DEVOTIONAL_EDIT_NOT_ALLOWED',
          403
        )
      }

      await ensureImageAssetAttachable(tx, params.viewerId, params.imageAssetId)

      if (params.verseReferences) {
        await tx.devotionalVerseReference.deleteMany({
          where: { devotionalId: params.devotionalId },
        })
        await tx.devotionalVerseReference.createMany({
          data: params.verseReferences.map((reference) => ({
            devotionalId: params.devotionalId,
            book: reference.book.trim(),
            chapter: reference.chapter,
            verseStart: reference.verse_start,
            verseEnd: reference.verse_end ?? null,
            isPrimary: reference.is_primary ?? false,
          })),
        })
      }

      const data: Prisma.DevotionalUpdateInput = {}
      if (params.title !== undefined) {
        data.title = params.title.trim()
      }
      if (params.content !== undefined) {
        data.content = params.content
      }
      if (params.imageAssetId !== undefined) {
        data.imageAsset = params.imageAssetId
          ? { connect: { id: params.imageAssetId } }
          : { disconnect: true }
        if (params.imageAssetId === null) {
          data.imageUrl = null
          data.imageModerationStatus = DevotionalImageModerationStatus.PENDING
          data.imageModerationResultRaw = Prisma.JsonNull
        }
      }
      if (params.coverImageFocusY !== undefined) {
        data.coverImageFocusY = params.coverImageFocusY
      }

      await tx.devotional.update({
        where: { id: params.devotionalId },
        data,
      })

      const devotional = await tx.devotional.findUnique({
        where: { id: params.devotionalId },
        include: devotionalInclude(params.viewerId),
      })

      if (!devotional) {
        throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
      }

      return devotional
    })

    return formatDevotional(updated, {
      includeContent: true,
      viewerId: params.viewerId,
    })
  } catch (error) {
    return rethrowKnownDevotionalWriteError(error)
  }
}

export const deleteDevotional = async (devotionalId: string) => {
  await prisma.devotional.delete({ where: { id: devotionalId } })
}

export const publishDevotional = async (params: {
  devotionalId: string
  viewerId: string
  viewerRole?: UserRole | null
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const devotional = await tx.devotional.findUnique({
      where: { id: params.devotionalId },
      select: {
        id: true,
        title: true,
        content: true,
        authorId: true,
        publicationState: true,
        imageAssetId: true,
        firstPublishedAt: true,
      },
    })

    if (!devotional) {
      throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
    }

    if (devotional.publicationState !== DevotionalPublicationState.DRAFT) {
      throw new AppError(
        'Only draft devotionals can be published',
        'DEVOTIONAL_NOT_DRAFT',
        400
      )
    }

    const textModeration = await moderateText(extractPlainText(devotional.content))
    if (
      textModeration.severity === 'HIGH' ||
      textModeration.severity === 'CRITICAL'
    ) {
      await tx.devotional.update({
        where: { id: devotional.id },
        data: {
          moderationReason: textModeration.reason,
        },
      })
      await addModerationAction(tx, {
        devotionalId: devotional.id,
        actionType: DevotionalModerationActionType.PUBLISH_BLOCKED,
        reason: textModeration.reason,
        metadata: toModerationAuditMetadata(textModeration),
      })

      throw new AppError(
        textModeration.reason ?? 'Publication blocked by moderation.',
        'DEVOTIONAL_PUBLISH_BLOCKED',
        400
      )
    }

    const imageResult = await ensurePermanentImage(tx, devotional.imageAssetId)
    const now = new Date()
    const isPrivilegedLaunch = getsPrivilegedInitialVisibility(params.viewerRole)
    const moderationStatus =
      textModeration.severity === 'MEDIUM'
        ? DevotionalModerationStatus.UNDER_REVIEW
        : DevotionalModerationStatus.CLEAR
    const publicationState =
      moderationStatus === DevotionalModerationStatus.CLEAR && isPrivilegedLaunch
        ? DevotionalPublicationState.FEATURED
        : DevotionalPublicationState.PUBLISHED_LOW_REACH
    const featuredUntil =
      publicationState === DevotionalPublicationState.FEATURED
        ? new Date(
            now.getTime() +
              devotionalRankingPolicy.featureDurationHours * 60 * 60 * 1000
          )
        : null
    const rankingScore =
      publicationState === DevotionalPublicationState.FEATURED
        ? devotionalRankingPolicy.privilegedLaunchScore
        : 0

    const updated = await tx.devotional.update({
      where: { id: devotional.id },
      data: {
        publicationState,
        moderationStatus,
        moderationReason: textModeration.reason,
        moderatedAt:
          moderationStatus === DevotionalModerationStatus.CLEAR ? null : now,
        imageUrl: imageResult.imageUrl,
        imageModerationStatus: imageResult.imageModerationStatus,
        imageModerationResultRaw: imageResult.imageModerationResultRaw,
        imageAsset: imageResult.disconnectImageAsset
          ? { disconnect: true }
          : devotional.imageAssetId
            ? { connect: { id: devotional.imageAssetId } }
            : undefined,
        rankingScore,
        publishedAt: now,
        firstPublishedAt: devotional.firstPublishedAt ?? now,
        lastScoredAt: now,
        featuredUntil,
      },
      include: devotionalInclude(params.viewerId),
    })

    await recordPublicationStateTransition(tx, {
      devotionalId: devotional.id,
      fromPublicationState: devotional.publicationState,
      toPublicationState: publicationState,
      source: DevotionalStateTransitionSource.PUBLISH,
      metadata: {
        moderation_status: moderationStatus,
      },
    })

    if (textModeration.severity === 'MEDIUM') {
      await addModerationAction(tx, {
        devotionalId: devotional.id,
        actionType: DevotionalModerationActionType.AUTO_UNDER_REVIEW,
        reason: textModeration.reason,
        metadata: toModerationAuditMetadata(textModeration),
      })
    }

    return updated
  })

  if (
    result.moderationStatus === DevotionalModerationStatus.CLEAR &&
    [
      DevotionalPublicationState.PUBLISHED_LOW_REACH,
      DevotionalPublicationState.TRENDING,
      DevotionalPublicationState.FEATURED,
    ].some((state) => state === result.publicationState)
  ) {
    console.log('[PublishDevotional] Triggering follower notifications', {
      devotionalId: result.id,
      authorId: result.authorId,
      publicationState: result.publicationState,
      moderationStatus: result.moderationStatus,
    })

    const followerNotificationResult = await sendDevotionalNotifications({
      devotionalId: result.id,
      type: DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL,
    })

    console.log('[PublishDevotional] Follower notifications finished', {
      devotionalId: result.id,
      type: DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL,
      ...followerNotificationResult,
    })

    if (result.publicationState === DevotionalPublicationState.FEATURED) {
      const featuredNotificationResult = await sendDevotionalNotifications({
        devotionalId: result.id,
        type: DevotionalNotificationType.FEATURED_DEVOTIONAL,
      })

      console.log('[PublishDevotional] Featured notifications finished', {
        devotionalId: result.id,
        type: DevotionalNotificationType.FEATURED_DEVOTIONAL,
        ...featuredNotificationResult,
      })
    }
  } else {
    console.log('[PublishDevotional] Skipping notifications after publish', {
      devotionalId: result.id,
      authorId: result.authorId,
      publicationState: result.publicationState,
      moderationStatus: result.moderationStatus,
    })
  }

  return formatDevotional(result, {
    includeContent: true,
    viewerId: params.viewerId,
  })
}

export const archiveDevotional = async (params: {
  devotionalId: string
  viewerId?: string | null
}) => {
  const updated = await prisma.$transaction(async (tx) => {
    const devotional = await tx.devotional.findUnique({
      where: { id: params.devotionalId },
      select: { publicationState: true },
    })

    if (!devotional) {
      throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
    }

    if (devotional.publicationState === DevotionalPublicationState.ARCHIVED) {
      throw new AppError(
        'Devotional already archived',
        'DEVOTIONAL_ALREADY_ARCHIVED',
        400
      )
    }

    await recordPublicationStateTransition(tx, {
      devotionalId: params.devotionalId,
      fromPublicationState: devotional.publicationState,
      toPublicationState: DevotionalPublicationState.ARCHIVED,
      source: DevotionalStateTransitionSource.OWNER_ARCHIVE,
    })

    return tx.devotional.update({
      where: { id: params.devotionalId },
      data: {
        publicationState: DevotionalPublicationState.ARCHIVED,
      },
      include: devotionalInclude(params.viewerId),
    })
  })

  return formatDevotional(updated, {
    includeContent: true,
    viewerId: params.viewerId,
  })
}

export const toggleDevotionalLike = async (params: {
  devotionalId: string
  userId: string
}) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.devotionalLike.findUnique({
      where: {
        devotionalId_userId: {
          devotionalId: params.devotionalId,
          userId: params.userId,
        },
      },
    })

    if (existing) {
      await tx.devotionalLike.delete({ where: { id: existing.id } })
      const updated = await tx.devotional.update({
        where: { id: params.devotionalId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      })
      return { liked: false, likesCount: Math.max(0, updated.likeCount) }
    }

    await tx.devotionalLike.create({
      data: {
        devotionalId: params.devotionalId,
        userId: params.userId,
      },
    })

    const updated = await tx.devotional.update({
      where: { id: params.devotionalId },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    })

    return { liked: true, likesCount: updated.likeCount }
  })
}

export const saveDevotional = async (params: {
  devotionalId: string
  userId: string
  deliveryToken?: string | null
}) => {
  return prisma.$transaction(async (tx) => {
    const devotional = await tx.devotional.findUnique({
      where: { id: params.devotionalId },
      select: { authorId: true },
    })

    if (!devotional) {
      throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
    }

    const existing = await tx.devotionalSave.findUnique({
      where: {
        devotionalId_userId: {
          devotionalId: params.devotionalId,
          userId: params.userId,
        },
      },
    })

    if (!existing) {
      const deliveryId = await resolveDeliveryIdByToken(tx, {
        userId: params.userId,
        devotionalId: params.devotionalId,
        deliveryToken: params.deliveryToken,
      })

      await tx.devotionalSave.create({
        data: {
          devotionalId: params.devotionalId,
          userId: params.userId,
          deliveryId,
        },
      })
      const updated = await tx.devotional.update({
        where: { id: params.devotionalId },
        data: { saveCount: { increment: 1 } },
        select: { saveCount: true },
      })
      await upsertCreatorAffinity(tx, {
        userId: params.userId,
        creatorId: devotional.authorId,
        scoreDelta: devotionalFeedPolicy.affinitySignals.save,
      })
      return { saved: true, saveCount: updated.saveCount }
    }

    const updated = await tx.devotional.findUnique({
      where: { id: params.devotionalId },
      select: { saveCount: true },
    })

    return {
      saved: true,
      saveCount: updated?.saveCount ?? 0,
    }
  })
}

export const unsaveDevotional = async (params: {
  devotionalId: string
  userId: string
}) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.devotionalSave.findUnique({
      where: {
        devotionalId_userId: {
          devotionalId: params.devotionalId,
          userId: params.userId,
        },
      },
    })

    if (existing) {
      await tx.devotionalSave.delete({ where: { id: existing.id } })
      const updated = await tx.devotional.update({
        where: { id: params.devotionalId },
        data: { saveCount: { decrement: 1 } },
        select: { saveCount: true },
      })
      return { saved: false, saveCount: Math.max(0, updated.saveCount) }
    }

    const updated = await tx.devotional.findUnique({
      where: { id: params.devotionalId },
      select: { saveCount: true },
    })

    return { saved: false, saveCount: updated?.saveCount ?? 0 }
  })
}

export const shareDevotional = async (params: {
  devotionalId: string
  userId: string
  deliveryToken?: string | null
}) => {
  return prisma.$transaction(async (tx) => {
    const deliveryId = await resolveDeliveryIdByToken(tx, {
      userId: params.userId,
      devotionalId: params.devotionalId,
      deliveryToken: params.deliveryToken,
    })

    await tx.devotionalShareEvent.create({
      data: {
        devotionalId: params.devotionalId,
        userId: params.userId,
        deliveryId,
      },
    })

    const shareSource = await createShareAttributionSource({
      devotionalId: params.devotionalId,
      userId: params.userId,
      tx,
    })

    const updated = await tx.devotional.update({
      where: { id: params.devotionalId },
      data: { shareCount: { increment: 1 } },
      select: { shareCount: true },
    })

    return { shareCount: updated.shareCount, shareUrl: shareSource.shareUrl }
  })
}

export const markReadComplete = async (params: {
  devotionalId: string
  userId: string
  deliveryToken?: string | null
  shareToken?: string | null
  deviceId?: string | null
}) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: params.devotionalId },
    select: { authorId: true },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  let deliveryId: string | null = null
  let usedDeliveryFallback = false

  try {
    deliveryId = await resolveDeliveryIdByToken(prisma, {
      userId: params.userId,
      devotionalId: params.devotionalId,
      deliveryToken: params.deliveryToken,
    })
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === 'INVALID_DELIVERY_TOKEN' &&
      params.deliveryToken
    ) {
      usedDeliveryFallback = true
      console.warn('[ReadComplete] Falling back to unattributed read-complete due to invalid delivery token', {
        devotionalId: params.devotionalId,
        userId: params.userId,
        hasDeliveryToken: true,
        deliveryTokenPreview: previewDeliveryToken(params.deliveryToken),
      })
    } else {
      throw error
    }
  }

  const created = await insertDevotionalReadComplete({
    devotionalId: params.devotionalId,
    userId: params.userId,
    deliveryId,
  })

  if (!created) {
    const readCompleteCount = await getCurrentReadCompleteCount(params.devotionalId)

    if (usedDeliveryFallback) {
      console.log('[ReadComplete] Completed with delivery fallback', {
        devotionalId: params.devotionalId,
        userId: params.userId,
        readCompleteCreated: false,
        readCompleteCount,
      })
    }

    return {
      readComplete: true,
      readCompleteCount,
    }
  }

  let readCompleteCount: number

  try {
    readCompleteCount = await applyReadCompleteSideEffects({
      devotionalId: params.devotionalId,
      userId: params.userId,
      creatorId: devotional.authorId,
    })
  } catch (error) {
    if (!isRetryableWriteConflictError(error)) {
      throw error
    }

    readCompleteCount = await withRetryableWriteConflict(() =>
      syncReadCompleteCount(params.devotionalId)
    )
  }

  if (params.shareToken) {
    await recordFirstAttributedReadComplete({
      token: params.shareToken,
      devotionalId: params.devotionalId,
      userId: params.userId,
      deviceId: params.deviceId,
    })
  }

  if (usedDeliveryFallback) {
    console.log('[ReadComplete] Completed with delivery fallback', {
      devotionalId: params.devotionalId,
      userId: params.userId,
      readCompleteCreated: true,
      readCompleteCount,
    })
  }

  return {
    readComplete: true,
    readCompleteCount,
  }
}

export const reportDevotional = async (params: {
  devotionalId: string
  userId: string
  reason: DevotionalReportReason
  details?: string | null
  deliveryToken?: string | null
}) => {
  if (!devotionalModerationPolicy.allowedReportReasons.includes(params.reason)) {
    throw new AppError('Invalid report reason', 'INVALID_REPORT_REASON', 400)
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.devotionalReport.findUnique({
      where: {
        devotionalId_userId: {
          devotionalId: params.devotionalId,
          userId: params.userId,
        },
      },
    })

    if (existing) {
      throw new AppError(
        'You have already reported this devotional',
        'DEVOTIONAL_ALREADY_REPORTED',
        400
      )
    }

    await tx.devotionalReport.create({
      data: {
        devotionalId: params.devotionalId,
        userId: params.userId,
        deliveryId: await resolveDeliveryIdByToken(tx, {
          userId: params.userId,
          devotionalId: params.devotionalId,
          deliveryToken: params.deliveryToken,
        }),
        reason: params.reason,
        details: params.details ?? null,
      },
    })

    const reportCountResult = await tx.devotionalReport.count({
      where: {
        devotionalId: params.devotionalId,
        status: DevotionalReportStatus.OPEN,
      },
    })

    await tx.devotional.update({
      where: { id: params.devotionalId },
      data: { reportCount: reportCountResult },
    })

    const shouldEscalate =
      reportCountResult >= devotionalModerationPolicy.reportEscalation.distinctReports

    if (shouldEscalate) {
      await tx.devotional.update({
        where: { id: params.devotionalId },
        data: {
          moderationStatus: DevotionalModerationStatus.UNDER_REVIEW,
          moderationReason: 'Este devocional fue enviado a revisión por reportes.',
          moderatedAt: new Date(),
        },
      })

      await addModerationAction(tx, {
        devotionalId: params.devotionalId,
        actionType: DevotionalModerationActionType.AUTO_UNDER_REVIEW,
        reason: 'Escalated by report threshold.',
        metadata: {
          report_count: reportCountResult,
        },
      })
    }

    return {
      reported: true,
      reportCount: reportCountResult,
      escalated: shouldEscalate,
    }
  })
}

export const recordFeedEvents = async (params: {
  userId: string
  events: {
    eventId: string
    type: DevotionalFeedEventType
    devotionalId: string
    deliveryToken: string
    occurredAt: Date
  }[]
}) => {
  let accepted = 0

  await prisma.$transaction(async (tx) => {
    for (const event of params.events) {
      const existing = await tx.devotionalFeedEvent.findUnique({
        where: { eventId: event.eventId },
      })

      if (existing) {
        continue
      }

      const delivery = await tx.devotionalFeedDelivery.findUnique({
        where: { token: event.deliveryToken },
        include: {
          devotional: {
            select: {
              authorId: true,
            },
          },
        },
      })

      if (
        !delivery ||
        delivery.userId !== params.userId ||
        delivery.devotionalId !== event.devotionalId
      ) {
        throw new AppError(
          'Invalid delivery token',
          'INVALID_DELIVERY_TOKEN',
          400
        )
      }

      await tx.devotionalFeedEvent.create({
        data: {
          eventId: event.eventId,
          devotionalId: event.devotionalId,
          deliveryId: delivery.id,
          userId: params.userId,
          type: event.type,
          occurredAt: event.occurredAt,
        },
      })

      accepted += 1

      if (event.type === DevotionalFeedEventType.IMPRESSION) {
        await tx.devotional.update({
          where: { id: event.devotionalId },
          data: { impressionCount: { increment: 1 } },
        })

        const uniqueImpression = await tx.devotionalUniqueImpression.findUnique({
          where: {
            devotionalId_userId: {
              devotionalId: event.devotionalId,
              userId: params.userId,
            },
          },
        })

        if (!uniqueImpression) {
          await tx.devotionalUniqueImpression.create({
            data: {
              devotionalId: event.devotionalId,
              userId: params.userId,
              firstSeenAt: event.occurredAt,
            },
          })

          await tx.devotional.update({
            where: { id: event.devotionalId },
            data: { uniqueImpressionCount: { increment: 1 } },
          })

          const aggregateDate = event.occurredAt.toISOString().slice(0, 10)
          await tx.devotionalAuthorImpressionDaily.upsert({
            where: {
              authorId_date: {
                authorId: delivery.devotional.authorId,
                date: aggregateDate,
              },
            },
            create: {
              authorId: delivery.devotional.authorId,
              date: aggregateDate,
              impressions: 1,
            },
            update: {
              impressions: { increment: 1 },
            },
          })
        }
      }
    }
  })

  return { accepted }
}

export const listComments = async (params: {
  devotionalId: string
  page: number
  limit: number
}) => {
  const limit = Math.min(Math.max(params.limit, 1), DEVOTIONAL_MAX_PAGE_LIMIT)
  const page = Math.max(params.page, 1)
  const skip = (page - 1) * limit

  const [items, total] = await prisma.$transaction([
    prisma.devotionalComment.findMany({
      where: { devotionalId: params.devotionalId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.devotionalComment.count({
      where: { devotionalId: params.devotionalId },
    }),
  ])

  return {
    items: items.map((comment) => ({
      id: comment.id,
      devotional_id: comment.devotionalId,
      content: comment.content,
      created_at: comment.createdAt.toISOString(),
      updated_at: comment.updatedAt.toISOString(),
      author: formatAuthor(comment.user),
    })),
    page,
    limit,
    total,
  }
}

export const addComment = async (params: {
  devotionalId: string
  userId: string
  content: string
}) => {
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.devotionalComment.create({
      data: {
        devotionalId: params.devotionalId,
        userId: params.userId,
        content: params.content.trim(),
      },
      include: { user: { select: { id: true, name: true } } },
    })

    await tx.devotional.update({
      where: { id: params.devotionalId },
      data: { commentCount: { increment: 1 } },
    })

    return created
  })

  return {
    id: comment.id,
    devotional_id: comment.devotionalId,
    content: comment.content,
    created_at: comment.createdAt.toISOString(),
    updated_at: comment.updatedAt.toISOString(),
    author: formatAuthor(comment.user),
  }
}

export const updateComment = async (params: {
  commentId: string
  content: string
}) => {
  const comment = await prisma.devotionalComment.update({
    where: { id: params.commentId },
    data: { content: params.content.trim() },
    include: { user: { select: { id: true, name: true } } },
  })

  return {
    id: comment.id,
    devotional_id: comment.devotionalId,
    content: comment.content,
    created_at: comment.createdAt.toISOString(),
    updated_at: comment.updatedAt.toISOString(),
    author: formatAuthor(comment.user),
  }
}

export const deleteComment = async (commentId: string) => {
  await prisma.$transaction(async (tx) => {
    const comment = await tx.devotionalComment.findUnique({
      where: { id: commentId },
      select: { devotionalId: true },
    })

    if (!comment) {
      throw new AppError('Comment not found', 'COMMENT_NOT_FOUND', 404)
    }

    await tx.devotionalComment.delete({ where: { id: commentId } })
    await tx.devotional.update({
      where: { id: comment.devotionalId },
      data: { commentCount: { decrement: 1 } },
    })
  })
}

export const getDevotionalSnapshot = async (devotionalId: string) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: devotionalId },
    select: {
      id: true,
      authorId: true,
      publicationState: true,
      moderationStatus: true,
    },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  return {
    ...devotional,
    status: toManagementStatus(devotional.publicationState),
    isPubliclyVisible: isPubliclyVisible(devotional),
  }
}

export const getCommentAuthorId = async (commentId: string) => {
  const comment = await prisma.devotionalComment.findUnique({
    where: { id: commentId },
    select: { userId: true, devotionalId: true },
  })

  if (!comment) {
    throw new AppError('Comment not found', 'COMMENT_NOT_FOUND', 404)
  }

  return comment
}

export const rescoreDevotionals = async () => {
  const authorImpressions = await getAuthorImpressionsLast24h()
  const candidates = await prisma.devotional.findMany({
    where: {
      publicationState: {
        in: [...DEVOTIONAL_FEED_ELIGIBLE_STATES],
      },
      moderationStatus: DevotionalModerationStatus.CLEAR,
    },
    select: {
      id: true,
      authorId: true,
      author: {
        select: {
          role: true,
        },
      },
      publicationState: true,
      moderationStatus: true,
      publishedAt: true,
      featuredUntil: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      saveCount: true,
      readCompleteCount: true,
      uniqueImpressionCount: true,
      skipCount: true,
      reportCount: true,
    },
  })

  const now = new Date()

  const newlyFeaturedIds: string[] = []

  await prisma.$transaction(async (tx) => {
    for (const devotional of candidates) {
      const ageHours = devotional.publishedAt
        ? Math.max(
            0,
            (now.getTime() - devotional.publishedAt.getTime()) /
              (1000 * 60 * 60)
          )
        : 0
      const uniqueImpressions = Math.max(devotional.uniqueImpressionCount, 1)
      const weightedEngagement =
        devotional.likeCount * devotionalRankingPolicy.scoreWeights.like +
        devotional.commentCount * devotionalRankingPolicy.scoreWeights.comment +
        devotional.shareCount * devotionalRankingPolicy.scoreWeights.share +
        devotional.saveCount * devotionalRankingPolicy.scoreWeights.save +
        devotional.readCompleteCount *
          devotionalRankingPolicy.scoreWeights.readComplete
      const qualityRate = weightedEngagement / Math.max(uniqueImpressions, 25)
      const freshness = 1 / (1 + ageHours / 24)
      const skipRate = devotional.skipCount / uniqueImpressions
      const readCompleteRate = devotional.readCompleteCount / uniqueImpressions
      const saveRate = devotional.saveCount / uniqueImpressions
      const shareRate = devotional.shareCount / uniqueImpressions
      const reportRate = devotional.reportCount / uniqueImpressions
      const authorPenalty = Math.log10(
        1 +
          (authorImpressions.get(devotional.authorId) ?? 0) /
            devotionalRankingPolicy.scoreWeights
              .authorPenaltyImpressionsDivisor
      )
      const score =
        weightedEngagement * freshness +
        qualityRate *
          devotionalRankingPolicy.scoreWeights.qualityRateMultiplier -
        devotional.reportCount *
          devotionalRankingPolicy.scoreWeights.reportPenalty -
        skipRate * devotionalRankingPolicy.scoreWeights.skipPenalty -
        authorPenalty

      let publicationState = devotional.publicationState
      let featuredUntil = devotional.featuredUntil

      const qualifiesFeatured =
        uniqueImpressions >=
          devotionalRankingPolicy.promotion.featured.uniqueImpressions &&
        score >= devotionalRankingPolicy.promotion.featured.score &&
        readCompleteRate >=
          devotionalRankingPolicy.promotion.featured.readCompleteRate &&
        shareRate >= devotionalRankingPolicy.promotion.featured.shareRate &&
        reportRate < devotionalRankingPolicy.promotion.featured.reportRate &&
        skipRate < devotionalRankingPolicy.promotion.featured.skipRate

      const qualifiesTrending =
        uniqueImpressions >=
          devotionalRankingPolicy.promotion.trending.uniqueImpressions &&
        score >= devotionalRankingPolicy.promotion.trending.score &&
        readCompleteRate >=
          devotionalRankingPolicy.promotion.trending.readCompleteRate &&
        saveRate >= devotionalRankingPolicy.promotion.trending.saveRate &&
        reportRate < devotionalRankingPolicy.promotion.trending.reportRate &&
        skipRate < devotionalRankingPolicy.promotion.trending.skipRate

      if (publicationState === DevotionalPublicationState.FEATURED) {
        const featureExpired =
          !featuredUntil || featuredUntil.getTime() <= now.getTime()
        const privilegedFeaturedAuthor = getsPrivilegedInitialVisibility(
          devotional.author.role
        )
        if (
          !featureExpired &&
          (privilegedFeaturedAuthor ||
            score >= devotionalRankingPolicy.decay.featuredScoreFloor)
        ) {
          publicationState = DevotionalPublicationState.FEATURED
        } else if (score >= devotionalRankingPolicy.decay.trendingScoreFloor) {
          publicationState = DevotionalPublicationState.TRENDING
          featuredUntil = null
        } else {
          publicationState = DevotionalPublicationState.PUBLISHED_LOW_REACH
          featuredUntil = null
        }
      } else if (qualifiesFeatured) {
        publicationState = DevotionalPublicationState.FEATURED
        featuredUntil = new Date(
          now.getTime() +
            devotionalRankingPolicy.featureDurationHours * 60 * 60 * 1000
        )
      } else if (qualifiesTrending) {
        publicationState = DevotionalPublicationState.TRENDING
        featuredUntil = null
      } else {
        publicationState = DevotionalPublicationState.PUBLISHED_LOW_REACH
        featuredUntil = null
      }

      await tx.devotional.update({
        where: { id: devotional.id },
        data: {
          rankingScore: score,
          lastScoredAt: now,
          publicationState,
          featuredUntil,
        },
      })

      const changed = await recordPublicationStateTransition(tx, {
        devotionalId: devotional.id,
        fromPublicationState: devotional.publicationState,
        toPublicationState: publicationState,
        source: DevotionalStateTransitionSource.RANKING,
        metadata: {
          ranking_score: score,
        },
      })

      if (
        changed &&
        publicationState === DevotionalPublicationState.FEATURED &&
        devotional.publicationState !== DevotionalPublicationState.FEATURED
      ) {
        newlyFeaturedIds.push(devotional.id)
      }
    }
  })

  for (const devotionalId of newlyFeaturedIds) {
    await sendDevotionalNotifications({
      devotionalId,
      type: DevotionalNotificationType.FEATURED_DEVOTIONAL,
    })
  }

  return { rescored: candidates.length }
}
