import { Request, Response } from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { DevotionalStatus, Prisma, UserRole } from '@prisma/client'
import { AppError } from '../../common/errors'
import {
  addComment,
  archiveDevotional,
  createDevotional,
  deleteComment,
  deleteDevotional,
  getCommentAuthorId,
  getDevotionalAuthorId,
  getDevotionalById,
  listComments,
  listDevotionals,
  publishDevotional,
  toggleDevotionalLike,
  trackView,
  updateComment,
  updateDevotional,
} from './devotional.service'
import {
  commentSchema,
  createDevotionalSchema,
  listDevotionalsSchema,
  paginationSchema,
  updateDevotionalSchema,
} from './devotional.validation'

const parseOrThrow = <T>(schema: z.Schema<T>, payload: unknown): T => {
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error)
  }
}

const ensureAuth = (req: Request) => {
  if (!req.user) {
    throw new AppError('Authentication required', 'AUTH_REQUIRED', 401)
  }
}

const ensureOwnerOrAdmin = (ownerId: string, role?: UserRole, userId?: string) => {
  if (userId !== ownerId && role !== UserRole.ADMIN) {
    throw new AppError('Insufficient permissions', 'FORBIDDEN', 403)
  }
}

export const createDevotionalHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const body = parseOrThrow(createDevotionalSchema, req.body)
  const content = JSON.parse(JSON.stringify(body.content)) as Prisma.InputJsonValue

  const devotional = await createDevotional({
    authorId: req.user!.sub,
    title: body.title,
    content,
    coverImageUrl: body.cover_image_url ?? null,
    verseReferences: body.verse_references,
    status: body.status,
  })

  res.json({ data: devotional })
}

export const listDevotionalsHandler = async (req: Request, res: Response) => {
  const query = parseOrThrow(listDevotionalsSchema, req.query)
  const userId = req.user?.sub
  const role = req.user?.role

  const status = query.status ?? DevotionalStatus.PUBLISHED
  let authorId = query.authorId

  if (status !== DevotionalStatus.PUBLISHED) {
    if (!userId) {
      throw new AppError('Authentication required', 'AUTH_REQUIRED', 401)
    }
    if (!authorId && role !== UserRole.ADMIN) {
      authorId = userId
    }
    if (authorId) {
      ensureOwnerOrAdmin(authorId, role, userId)
    }
  }

  const pageRaw = query.page ? Number(query.page) : 1
  const limitRaw = query.limit ? Number(query.limit) : 20
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20

  const result = await listDevotionals({
    status,
    page,
    limit,
    authorId,
    viewerId: userId,
  })

  res.json({ data: result })
}

export const getDevotionalHandler = async (req: Request, res: Response) => {
  const devotionalId = req.params.id
  const userId = req.user?.sub
  const role = req.user?.role

  const devotional = await getDevotionalById({
    devotionalId,
    viewerId: userId,
  })

  if (devotional.status !== DevotionalStatus.PUBLISHED) {
    if (!userId) {
      throw new AppError('Authentication required', 'AUTH_REQUIRED', 401)
    }
    ensureOwnerOrAdmin(devotional.author.id, role, userId)
  }

  if (devotional.status === DevotionalStatus.PUBLISHED) {
    await trackView({ devotionalId, userId })
  }

  res.json({ data: devotional })
}

export const updateDevotionalHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const devotionalId = req.params.id
  const body = parseOrThrow(updateDevotionalSchema, req.body)

  if (!Object.keys(body).length) {
    throw new AppError('No fields to update', 'NO_UPDATES', 400)
  }

  const devotional = await getDevotionalAuthorId(devotionalId)
  ensureOwnerOrAdmin(devotional.authorId, req.user?.role, req.user?.sub)
  const content = body.content
    ? (JSON.parse(JSON.stringify(body.content)) as Prisma.InputJsonValue)
    : undefined

  const updated = await updateDevotional({
    devotionalId,
    title: body.title,
    content,
    coverImageUrl: body.cover_image_url,
    verseReferences: body.verse_references,
    viewerId: req.user?.sub,
  })

  res.json({ data: updated })
}

export const deleteDevotionalHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const devotionalId = req.params.id
  const devotional = await getDevotionalAuthorId(devotionalId)
  ensureOwnerOrAdmin(devotional.authorId, req.user?.role, req.user?.sub)

  await deleteDevotional(devotionalId)
  res.json({ data: { success: true } })
}

export const publishDevotionalHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const devotionalId = req.params.id
  const devotional = await getDevotionalAuthorId(devotionalId)
  ensureOwnerOrAdmin(devotional.authorId, req.user?.role, req.user?.sub)

  const result = await publishDevotional({
    devotionalId,
    viewerId: req.user?.sub,
  })

  res.json({ data: result })
}

export const archiveDevotionalHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const devotionalId = req.params.id
  const devotional = await getDevotionalAuthorId(devotionalId)
  ensureOwnerOrAdmin(devotional.authorId, req.user?.role, req.user?.sub)

  const result = await archiveDevotional({
    devotionalId,
    viewerId: req.user?.sub,
  })

  res.json({ data: result })
}

export const toggleLikeHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const devotionalId = req.params.id
  const devotional = await getDevotionalAuthorId(devotionalId)

  if (devotional.status !== DevotionalStatus.PUBLISHED) {
    ensureOwnerOrAdmin(devotional.authorId, req.user?.role, req.user?.sub)
  }

  const result = await toggleDevotionalLike({
    devotionalId,
    userId: req.user!.sub,
  })

  res.json({ data: { liked: result.liked, likes_count: result.likesCount } })
}

export const listCommentsHandler = async (req: Request, res: Response) => {
  const devotionalId = req.params.id
  const devotional = await getDevotionalAuthorId(devotionalId)
  const userId = req.user?.sub

  if (devotional.status !== DevotionalStatus.PUBLISHED) {
    if (!userId) {
      throw new AppError('Authentication required', 'AUTH_REQUIRED', 401)
    }
    ensureOwnerOrAdmin(devotional.authorId, req.user?.role, userId)
  }

  const query = parseOrThrow(paginationSchema, req.query)
  const pageRaw = query.page ? Number(query.page) : 1
  const limitRaw = query.limit ? Number(query.limit) : 50
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50

  const result = await listComments({ devotionalId, page, limit })
  res.json({ data: result })
}

export const addCommentHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const devotionalId = req.params.id
  const devotional = await getDevotionalAuthorId(devotionalId)

  if (devotional.status !== DevotionalStatus.PUBLISHED) {
    throw new AppError(
      'Comments are only allowed on published devotionals',
      'COMMENTS_NOT_ALLOWED',
      403
    )
  }

  const body = parseOrThrow(commentSchema, req.body)

  const comment = await addComment({
    devotionalId,
    userId: req.user!.sub,
    content: body.content,
  })

  res.json({ data: comment })
}

export const updateCommentHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const commentId = req.params.commentId
  const comment = await getCommentAuthorId(commentId)
  ensureOwnerOrAdmin(comment.userId, req.user?.role, req.user?.sub)

  const body = parseOrThrow(commentSchema, req.body)
  const updated = await updateComment({
    commentId,
    content: body.content,
  })

  res.json({ data: updated })
}

export const deleteCommentHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const commentId = req.params.commentId
  const comment = await getCommentAuthorId(commentId)
  ensureOwnerOrAdmin(comment.userId, req.user?.role, req.user?.sub)

  await deleteComment(commentId)
  res.json({ data: { success: true } })
}

export const uploadImageHandler = async (req: Request, res: Response) => {
  ensureAuth(req)

  if (!req.file) {
    throw new AppError('Image is required', 'IMAGE_REQUIRED', 400)
  }

  const storageDir = path.join(process.cwd(), 'storage', 'devotionals', 'images')
  await fs.mkdir(storageDir, { recursive: true })

  const extensionByType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }

  const extension = extensionByType[req.file.mimetype]
  if (!extension) {
    throw new AppError('Invalid image type', 'INVALID_IMAGE_TYPE', 400)
  }

  const filename = `${crypto.randomUUID()}.${extension}`
  const outputPath = path.join(storageDir, filename)

  let pipeline = sharp(req.file.buffer).resize({
    width: 1920,
    withoutEnlargement: true,
  })

  if (extension === 'jpg') {
    pipeline = pipeline.jpeg({ quality: 85 })
  } else if (extension === 'png') {
    pipeline = pipeline.png({ quality: 85 })
  } else {
    pipeline = pipeline.webp({ quality: 85 })
  }

  await pipeline.toFile(outputPath)

  const url = `/storage/devotionals/images/${filename}`
  res.json({ data: { url } })
}
