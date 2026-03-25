import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import {
  DevotionalFeedEventType,
  DevotionalImageAssetStatus,
  DevotionalImageModerationStatus,
  DevotionalModerationActionType,
  DevotionalModerationStatus,
  DevotionalPublicationState,
  DevotionalReportReason,
  DevotionalReportStatus,
  Prisma,
  UserRole,
} from '@prisma/client'
import { prisma } from '../../config/db'
import { AppError } from '../../common/errors'
import {
  DEVOTIONAL_FEED_CANDIDATE_MULTIPLIER,
  DEVOTIONAL_FEED_DEFAULT_LIMIT,
  DEVOTIONAL_FEED_ELIGIBLE_STATES,
  DEVOTIONAL_MAX_CONTENT_BYTES,
  DEVOTIONAL_MAX_PAGE_LIMIT,
  DEVOTIONAL_PRIVILEGED_FEATURE_ROLES,
  DEVOTIONAL_PREVIEW_MAX_CHARS,
  DEVOTIONAL_PUBLISHED_MANAGEMENT_STATES,
  DEVOTIONAL_WORDS_PER_MINUTE,
  devotionalFeedPolicy,
  devotionalModerationPolicy,
  devotionalRankingPolicy,
} from './devotional.policy'
import { moderateText } from './devotional.moderation'

export const DEVOTIONAL_MANAGEMENT_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
] as const

export type DevotionalManagementStatus =
  (typeof DEVOTIONAL_MANAGEMENT_STATUSES)[number]

type DevotionalWithRelations = Prisma.DevotionalGetPayload<{
  include: {
    author: { select: { id: true; name: true } }
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

type FeedCursor = {
  ranking_score: number
  last_scored_at: string
  id: string
}

const toIso = (value: Date | null | undefined) => (value ? value.toISOString() : null)

const formatAuthor = (author: { id: string; name: string }) => ({
  id: author.id,
  name: author.name,
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
    author: { select: { id: true, name: true } },
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

const resolveImageUrl = (devotional: {
  imageUrl: string | null
  imageAsset?: { permanentUrl: string | null; tempUrl: string } | null
}) =>
  devotional.imageUrl ??
  devotional.imageAsset?.permanentUrl ??
  devotional.imageAsset?.tempUrl ??
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
  } = {}
) => {
  const viewerState = formatViewerState(devotional)
  const imageUrl = resolveImageUrl(devotional)

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
  }
}

const encodeFeedCursor = (cursor: FeedCursor) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')

const decodeFeedCursor = (cursor?: string | null): FeedCursor | null => {
  if (!cursor) return null

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as FeedCursor
    if (
      typeof parsed.ranking_score !== 'number' ||
      typeof parsed.last_scored_at !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const buildCursorWhere = (cursor?: string | null): Prisma.DevotionalWhereInput => {
  const decoded = decodeFeedCursor(cursor)
  if (!decoded) return {}

  const lastScoredAt = new Date(decoded.last_scored_at)
  if (Number.isNaN(lastScoredAt.getTime())) {
    return {}
  }

  return {
    OR: [
      { rankingScore: { lt: decoded.ranking_score } },
      {
        rankingScore: decoded.ranking_score,
        lastScoredAt: { lt: lastScoredAt },
      },
      {
        rankingScore: decoded.ranking_score,
        lastScoredAt,
        id: { lt: decoded.id },
      },
    ],
  }
}

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
    }
  }

  if (
    asset.imageModerationStatus !== DevotionalImageModerationStatus.APPROVED ||
    (asset.status !== DevotionalImageAssetStatus.ATTACHABLE &&
      asset.status !== DevotionalImageAssetStatus.USED)
  ) {
    return {
      imageUrl: null as string | null,
      imageModerationStatus: asset.imageModerationStatus,
      imageModerationResultRaw: asset.moderationResultRaw ?? Prisma.JsonNull,
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
  Math.max(limit, DEVOTIONAL_FEED_DEFAULT_LIMIT) *
  DEVOTIONAL_FEED_CANDIDATE_MULTIPLIER

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

  return formatDevotional(devotional, {
    includeContent: true,
    viewerId: params.authorId,
  })
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
}) => {
  const limit = Math.min(
    Math.max(params.limit, 1),
    DEVOTIONAL_FEED_DEFAULT_LIMIT
  )
  const cursorWhere = buildCursorWhere(params.cursor)
  const candidateWindow = getFeedCandidateWindow(limit)
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
  const fetchedCandidates = await prisma.devotional.findMany({
    where: {
      publicationState: { in: [...DEVOTIONAL_FEED_ELIGIBLE_STATES] },
      moderationStatus: DevotionalModerationStatus.CLEAR,
      ...cursorWhere,
    },
    orderBy: [
      { rankingScore: 'desc' },
      { lastScoredAt: 'desc' },
      { id: 'desc' },
    ],
    take: candidateWindow + 1,
    include: devotionalInclude(params.userId),
  })
  const hasAdditionalCandidates = fetchedCandidates.length > candidateWindow
  const candidates = fetchedCandidates.slice(0, candidateWindow)
  const { items: selected, selectedIds } = selectFeedCandidates({
    candidates,
    recentDeliveryIds: seenDevotionalIds,
    limit,
  })

  const deliveries = await Promise.all(
    selected.map(async (item) => {
      const delivery = await prisma.devotionalFeedDelivery.create({
        data: {
          token: crypto.randomUUID(),
          devotionalId: item.id,
          userId: params.userId,
          rankingScore: item.rankingScore,
        },
      })

      return {
        item,
        token: delivery.token,
      }
    })
  )

  const lastItem = selected.length > 0 ? selected[selected.length - 1] : null
  const hasMore =
    candidates.some((candidate) => !selectedIds.has(candidate.id)) ||
    hasAdditionalCandidates

  return {
    items: deliveries.map(({ item, token }) =>
      formatDevotional(item, {
        viewerId: params.userId,
        deliveryToken: token,
      })
    ),
    next_cursor: lastItem
      ? encodeFeedCursor({
          ranking_score: lastItem.rankingScore,
          last_scored_at: (lastItem.lastScoredAt ?? lastItem.updatedAt).toISOString(),
          id: lastItem.id,
        })
      : null,
    has_more: selected.length > 0 && hasMore,
  }
}

export const getDevotionalById = async (params: {
  devotionalId: string
  viewerId?: string | null
  viewerRole?: UserRole | null
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

    const textModeration = moderateText(extractPlainText(devotional.content))
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
        metadata: {
          severity: textModeration.severity,
          categories: textModeration.categories,
        },
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
        rankingScore,
        publishedAt: now,
        firstPublishedAt: devotional.firstPublishedAt ?? now,
        lastScoredAt: now,
        featuredUntil,
      },
      include: devotionalInclude(params.viewerId),
    })

    if (textModeration.severity === 'MEDIUM') {
      await addModerationAction(tx, {
        devotionalId: devotional.id,
        actionType: DevotionalModerationActionType.AUTO_UNDER_REVIEW,
        reason: textModeration.reason,
        metadata: {
          severity: textModeration.severity,
          categories: textModeration.categories,
        },
      })
    }

    return updated
  })

  return formatDevotional(result, {
    includeContent: true,
    viewerId: params.viewerId,
  })
}

export const archiveDevotional = async (params: {
  devotionalId: string
  viewerId?: string | null
}) => {
  const devotional = await prisma.devotional.findUnique({
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

  const updated = await prisma.devotional.update({
    where: { id: params.devotionalId },
    data: {
      publicationState: DevotionalPublicationState.ARCHIVED,
    },
    include: devotionalInclude(params.viewerId),
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

    if (!existing) {
      await tx.devotionalSave.create({
        data: {
          devotionalId: params.devotionalId,
          userId: params.userId,
        },
      })
      const updated = await tx.devotional.update({
        where: { id: params.devotionalId },
        data: { saveCount: { increment: 1 } },
        select: { saveCount: true },
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
}) => {
  return prisma.$transaction(async (tx) => {
    await tx.devotionalShareEvent.create({
      data: {
        devotionalId: params.devotionalId,
        userId: params.userId,
      },
    })

    const updated = await tx.devotional.update({
      where: { id: params.devotionalId },
      data: { shareCount: { increment: 1 } },
      select: { shareCount: true },
    })

    return { shareCount: updated.shareCount }
  })
}

export const markReadComplete = async (params: {
  devotionalId: string
  userId: string
}) => {
  return prisma.$transaction(async (tx) => {
    const created = await tx.devotionalReadComplete.createMany({
      data: [
        {
          devotionalId: params.devotionalId,
          userId: params.userId,
        },
      ],
      skipDuplicates: true,
    })

    if (created.count > 0) {
      const updated = await tx.devotional.update({
        where: { id: params.devotionalId },
        data: { readCompleteCount: { increment: 1 } },
        select: { readCompleteCount: true },
      })
      return {
        readComplete: true,
        readCompleteCount: updated.readCompleteCount,
      }
    }

    const updated = await tx.devotional.findUnique({
      where: { id: params.devotionalId },
      select: { readCompleteCount: true },
    })

    return {
      readComplete: true,
      readCompleteCount: updated?.readCompleteCount ?? 0,
    }
  })
}

export const reportDevotional = async (params: {
  devotionalId: string
  userId: string
  reason: DevotionalReportReason
  details?: string | null
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

  await prisma.$transaction(
    candidates.map((devotional) => {
      const ageHours = devotional.publishedAt
        ? Math.max(
            0,
            (now.getTime() - devotional.publishedAt.getTime()) / (1000 * 60 * 60)
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
            devotionalRankingPolicy.scoreWeights.authorPenaltyImpressionsDivisor
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
        uniqueImpressions >= devotionalRankingPolicy.promotion.featured.uniqueImpressions &&
        score >= devotionalRankingPolicy.promotion.featured.score &&
        readCompleteRate >= devotionalRankingPolicy.promotion.featured.readCompleteRate &&
        shareRate >= devotionalRankingPolicy.promotion.featured.shareRate &&
        reportRate < devotionalRankingPolicy.promotion.featured.reportRate &&
        skipRate < devotionalRankingPolicy.promotion.featured.skipRate

      const qualifiesTrending =
        uniqueImpressions >= devotionalRankingPolicy.promotion.trending.uniqueImpressions &&
        score >= devotionalRankingPolicy.promotion.trending.score &&
        readCompleteRate >= devotionalRankingPolicy.promotion.trending.readCompleteRate &&
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

      return prisma.devotional.update({
        where: { id: devotional.id },
        data: {
          rankingScore: score,
          lastScoredAt: now,
          publicationState,
          featuredUntil,
        },
      })
    })
  )

  return { rescored: candidates.length }
}
