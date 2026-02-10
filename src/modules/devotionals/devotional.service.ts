import { DevotionalStatus, Prisma } from '@prisma/client'
import { prisma } from '../../config/db'
import { AppError } from '../../common/errors'

const MAX_CONTENT_BYTES = 200 * 1024
const MAX_LIMIT = 50

const toIso = (value: Date | null) => (value ? value.toISOString() : null)

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

const formatAuthor = (author: { id: string; name: string }) => ({
  id: author.id,
  name: author.name,
})

type DevotionalWithRelations = Prisma.DevotionalGetPayload<{
  include: {
    author: { select: { id: true; name: true } }
    verseReferences: { orderBy: { createdAt: 'asc' } }
    _count: { select: { likes: true; comments: true } }
    likes: { where: { userId: string }; select: { id: true } }
  }
}>

const formatDevotional = (
  devotional: DevotionalWithRelations,
  options: { includeContent?: boolean; viewerId?: string | null } = {}
) => ({
  id: devotional.id,
  title: devotional.title,
  ...(options.includeContent ? { content: devotional.content } : {}),
  status: devotional.status,
  cover_image_url: devotional.coverImageUrl,
  view_count: devotional.viewCount,
  published_at: toIso(devotional.publishedAt),
  created_at: devotional.createdAt.toISOString(),
  updated_at: devotional.updatedAt.toISOString(),
  author: formatAuthor(devotional.author),
  verse_references: devotional.verseReferences.map(formatVerseReference),
  likes_count: devotional._count.likes,
  comments_count: devotional._count.comments,
  liked: devotional.likes ? devotional.likes.length > 0 : false,
  is_owner: options.viewerId ? devotional.authorId === options.viewerId : false,
})

const ensureContentSize = (content: Prisma.InputJsonValue) => {
  const size = Buffer.byteLength(JSON.stringify(content), 'utf8')
  if (size > MAX_CONTENT_BYTES) {
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

const includeForList = (viewerId?: string | null) =>
  Prisma.validator<Prisma.DevotionalInclude>()({
    author: { select: { id: true, name: true } },
    verseReferences: { orderBy: { createdAt: 'asc' } },
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId: viewerId ?? '' }, select: { id: true } },
  })

const includeForDetail = (viewerId?: string | null) =>
  Prisma.validator<Prisma.DevotionalInclude>()({
    author: { select: { id: true, name: true } },
    verseReferences: { orderBy: { createdAt: 'asc' } },
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId: viewerId ?? '' }, select: { id: true } },
  })

export const createDevotional = async (params: {
  authorId: string
  title: string
  content: Prisma.InputJsonValue
  coverImageUrl?: string | null
  verseReferences: {
    book: string
    chapter: number
    verse_start: number
    verse_end?: number
    is_primary?: boolean
  }[]
  status?: DevotionalStatus
}) => {
  ensureContentSize(params.content)
  ensurePrimaryReference(params.verseReferences)

  const normalizedStatus = params.status ?? DevotionalStatus.DRAFT
  const publishedAt =
    normalizedStatus === DevotionalStatus.PUBLISHED ? new Date() : null

  const devotional = await prisma.devotional.create({
    data: {
      title: params.title.trim(),
      content: params.content,
      authorId: params.authorId,
      status: normalizedStatus,
      coverImageUrl: params.coverImageUrl ?? null,
      publishedAt,
      verseReferences: {
        create: params.verseReferences.map((reference) => ({
          book: reference.book.trim(),
          chapter: reference.chapter,
          verseStart: reference.verse_start,
          verseEnd: reference.verse_end,
          isPrimary: reference.is_primary ?? false,
        })),
      },
    },
    include: includeForDetail(params.authorId),
  })

  return formatDevotional(devotional, {
    includeContent: true,
    viewerId: params.authorId,
  })
}

export const listDevotionals = async (params: {
  status: DevotionalStatus
  page: number
  limit: number
  authorId?: string
  viewerId?: string | null
}) => {
  const limit = Math.min(Math.max(params.limit, 1), MAX_LIMIT)
  const page = Math.max(params.page, 1)
  const skip = (page - 1) * limit

  const where: Prisma.DevotionalWhereInput = {
    status: params.status,
    ...(params.authorId ? { authorId: params.authorId } : {}),
  }

  const [items, total] = await prisma.$transaction([
    prisma.devotional.findMany({
      where,
      orderBy:
        params.status === DevotionalStatus.PUBLISHED
          ? { publishedAt: 'desc' }
          : { createdAt: 'desc' },
      skip,
      take: limit,
      include: includeForList(params.viewerId),
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

export const getDevotionalById = async (params: {
  devotionalId: string
  viewerId?: string | null
}) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: params.devotionalId },
    include: includeForDetail(params.viewerId),
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  return formatDevotional(devotional, {
    includeContent: true,
    viewerId: params.viewerId,
  })
}

export const updateDevotional = async (params: {
  devotionalId: string
  title?: string
  content?: Prisma.InputJsonValue
  coverImageUrl?: string | null
  verseReferences?: {
    book: string
    chapter: number
    verse_start: number
    verse_end?: number
    is_primary?: boolean
  }[]
  viewerId?: string | null
}) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: params.devotionalId },
    select: { id: true },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  if (params.content !== undefined) {
    ensureContentSize(params.content)
  }

  if (params.verseReferences) {
    ensurePrimaryReference(params.verseReferences)
  }

  await prisma.$transaction(async (tx) => {
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
          verseEnd: reference.verse_end,
          isPrimary: reference.is_primary ?? false,
        })),
      })
    }

    const data: Prisma.DevotionalUpdateInput = {}
    if (params.title) data.title = params.title.trim()
    if (params.content !== undefined) data.content = params.content
    if (params.coverImageUrl !== undefined) {
      data.coverImageUrl = params.coverImageUrl
    }

    if (Object.keys(data).length) {
      await tx.devotional.update({
        where: { id: params.devotionalId },
        data,
      })
    }
  })

  const updated = await prisma.devotional.findUnique({
    where: { id: params.devotionalId },
    include: includeForDetail(params.viewerId),
  })

  if (!updated) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

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
  viewerId?: string | null
}) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: params.devotionalId },
    select: { status: true },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  if (devotional.status !== DevotionalStatus.DRAFT) {
    throw new AppError(
      'Only draft devotionals can be published',
      'DEVOTIONAL_NOT_DRAFT',
      400
    )
  }

  const updated = await prisma.devotional.update({
    where: { id: params.devotionalId },
    data: {
      status: DevotionalStatus.PUBLISHED,
      publishedAt: new Date(),
    },
    include: includeForDetail(params.viewerId),
  })

  return formatDevotional(updated, {
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
    select: { status: true },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  if (devotional.status === DevotionalStatus.ARCHIVED) {
    throw new AppError(
      'Devotional already archived',
      'DEVOTIONAL_ALREADY_ARCHIVED',
      400
    )
  }

  const updated = await prisma.devotional.update({
    where: { id: params.devotionalId },
    data: {
      status: DevotionalStatus.ARCHIVED,
    },
    include: includeForDetail(params.viewerId),
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
      select: { id: true },
    })

    if (existing) {
      await tx.devotionalLike.delete({ where: { id: existing.id } })
    } else {
      await tx.devotionalLike.create({
        data: {
          devotionalId: params.devotionalId,
          userId: params.userId,
        },
      })
    }

    const likesCount = await tx.devotionalLike.count({
      where: { devotionalId: params.devotionalId },
    })

    return {
      liked: !existing,
      likesCount,
    }
  })
}

export const listComments = async (params: {
  devotionalId: string
  page: number
  limit: number
}) => {
  const limit = Math.min(Math.max(params.limit, 1), MAX_LIMIT)
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
  const comment = await prisma.devotionalComment.create({
    data: {
      devotionalId: params.devotionalId,
      userId: params.userId,
      content: params.content.trim(),
    },
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
  await prisma.devotionalComment.delete({ where: { id: commentId } })
}

export const trackView = async (params: {
  devotionalId: string
  userId?: string | null
}) => {
  if (!params.userId) {
    await prisma.devotional.update({
      where: { id: params.devotionalId },
      data: { viewCount: { increment: 1 } },
    })
    return
  }

  const viewDate = new Date().toISOString().slice(0, 10)

  await prisma.$transaction(async (tx) => {
    const existing = await tx.devotionalView.findUnique({
      where: {
        devotionalId_userId_viewDate: {
          devotionalId: params.devotionalId,
          userId: params.userId!,
          viewDate,
        },
      },
      select: { id: true },
    })

    if (existing) return

    await tx.devotionalView.create({
      data: {
        devotionalId: params.devotionalId,
        userId: params.userId!,
        viewDate,
      },
    })

    await tx.devotional.update({
      where: { id: params.devotionalId },
      data: { viewCount: { increment: 1 } },
    })
  })
}

export const getDevotionalAuthorId = async (devotionalId: string) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: devotionalId },
    select: { authorId: true, status: true },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  return devotional
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
