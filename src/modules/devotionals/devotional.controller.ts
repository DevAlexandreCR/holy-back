import { Request, Response } from 'express'
import {
  DevotionalFeedEventType,
  DevotionalReportReason,
  Prisma,
  UserRole,
} from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { AppError } from '../../common/errors'
import {
  addComment,
  archiveDevotional,
  approveDevotionalReview,
  createDevotional,
  deleteComment,
  deleteDevotional,
  getCommentAuthorId,
  getDevotionalById,
  getDevotionalSnapshot,
  listComments,
  listDevotionals,
  listFeedDevotionals,
  listSavedDevotionals,
  markReadComplete,
  publishDevotional,
  recordFeedEvents,
  reportDevotional,
  restrictDevotionalReview,
  saveDevotional,
  shareDevotional,
  toggleDevotionalLike,
  unsaveDevotional,
  updateComment,
  updateDevotional,
} from './devotional.service'
import {
  getDevotionalAudioConfig,
  requestDevotionalAudio,
} from './devotionalAudio.service'
import {
  celebrateMilestone,
  getDevotionalFeedHeader,
} from './devotionalEngagement.service'
import { createDevotionalImageAssetFromBuffer } from './devotionalImageAsset.service'
import {
  commentSchema,
  createDevotionalSchema,
  devotionalReportSchema,
  devotionalReadCompleteSchema,
  devotionalRestrictSchema,
  devotionalShareSchema,
  feedEventsSchema,
  feedPaginationSchema,
  listDevotionalsSchema,
  paginationSchema,
  savedDevotionalsPaginationSchema,
  updateDevotionalSchema,
} from './devotional.validation'

type DevotionalRequest = Request<{ id: string }>
type DevotionalCommentRequest = Request<{ id: string; commentId: string }>

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

const ensureOwnerOrPrivileged = (
  ownerId: string,
  role?: UserRole | null,
  userId?: string | null
) => {
  if (userId !== ownerId && role !== UserRole.ADMIN && role !== UserRole.EDITOR && role !== UserRole.LEAD) {
    throw new AppError('Insufficient permissions', 'FORBIDDEN', 403)
  }
}

const ensureAdmin = (role?: UserRole | null) => {
  if (role !== UserRole.ADMIN) {
    throw new AppError('Insufficient permissions', 'FORBIDDEN', 403)
  }
}

const ensureReviewer = (role?: UserRole | null) => {
  if (
    role !== UserRole.ADMIN &&
    role !== UserRole.EDITOR &&
    role !== UserRole.LEAD
  ) {
    throw new AppError('Insufficient permissions', 'FORBIDDEN', 403)
  }
}

const ensurePublicInteraction = async (devotionalId: string) => {
  const devotional = await getDevotionalSnapshot(devotionalId)
  if (!devotional.isPubliclyVisible) {
    throw new AppError(
      'This devotional is not available for public interaction',
      'DEVOTIONAL_NOT_PUBLIC',
      403
    )
  }
  return devotional
}

export const createDevotionalHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const body = parseOrThrow(createDevotionalSchema, req.body)
  const content = JSON.parse(JSON.stringify(body.content)) as Prisma.InputJsonValue

  const devotional = await createDevotional({
    authorId: req.user!.sub,
    title: body.title,
    content,
    verseReferences: body.verse_references,
    imageAssetId: body.image_asset_id ?? null,
    coverImageFocusY: body.cover_image_focus_y ?? null,
  })

  res.json({ data: devotional })
}

export const listDevotionalsHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const query = parseOrThrow(listDevotionalsSchema, req.query)
  const status = query.status ?? 'PUBLISHED'
  const userId = req.user!.sub
  const role = req.user!.role
  let authorId = query.authorId

  if (
    !authorId &&
    !(
      status === 'UNDER_REVIEW' &&
      (role === UserRole.ADMIN || role === UserRole.EDITOR || role === UserRole.LEAD)
    ) &&
    role !== UserRole.ADMIN
  ) {
    authorId = userId
  }
  if (authorId) {
    ensureOwnerOrPrivileged(authorId, role, userId)
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
    viewerRole: role,
  })

  res.json({ data: result })
}

export const listFeedHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const query = parseOrThrow(feedPaginationSchema, req.query)
  const limitRaw = query.limit ? Number(query.limit) : 20
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20

  const result = await listFeedDevotionals({
    userId: req.user!.sub,
    cursor: query.cursor,
    limit,
    mode: query.mode,
  })

  res.json({ data: result })
}

export const getDevotionalAudioConfigHandler = async (
  req: Request,
  res: Response,
) => {
  ensureAuth(req)
  res.json({ data: getDevotionalAudioConfig() })
}

export const getFeedHeaderHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const result = await getDevotionalFeedHeader({ userId: req.user!.sub })
  res.json({ data: result })
}

export const celebrateMilestoneHandler = async (
  req: Request<{ milestone: string }>,
  res: Response
) => {
  ensureAuth(req)

  const milestone = Number(req.params.milestone)
  const validMilestones =
    config.engagement.notifications.streakMilestoneValues as readonly number[]

  if (!Number.isInteger(milestone) || !validMilestones.includes(milestone)) {
    throw new AppError('Invalid milestone value', 'INVALID_MILESTONE', 400)
  }

  const result = await celebrateMilestone({
    userId: req.user!.sub,
    milestone,
  })

  res.json({ data: result })
}

export const listSavedDevotionalsHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const query = parseOrThrow(savedDevotionalsPaginationSchema, req.query)
  const limitRaw = query.limit ? Number(query.limit) : 20
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20

  const result = await listSavedDevotionals({
    userId: req.user!.sub,
    cursor: query.cursor,
    limit,
  })

  res.json({ data: result })
}

export const recordFeedEventsHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const body = parseOrThrow(feedEventsSchema, req.body)
  const result = await recordFeedEvents({
    userId: req.user!.sub,
    events: body.events.map((event) => ({
      eventId: event.event_id,
      type: event.type as DevotionalFeedEventType,
      devotionalId: event.devotional_id,
      deliveryToken: event.delivery_token,
      occurredAt: new Date(event.occurred_at),
    })),
  })

  res.json({ data: result })
}

export const getDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  const devotional = await getDevotionalById({
    devotionalId: req.params.id,
    viewerId: req.user?.sub,
    viewerRole: req.user?.role,
    shareToken:
      typeof req.query.share_token === 'string' ? req.query.share_token : null,
    deviceId:
      typeof req.query.device_id === 'string' ? req.query.device_id : null,
  })

  res.json({ data: devotional })
}

export const requestDevotionalAudioHandler = async (
  req: DevotionalRequest,
  res: Response,
) => {
  ensureAuth(req)
  const result = await requestDevotionalAudio({
    devotionalId: req.params.id,
    userId: req.user!.sub,
  })

  if (result.status === 'GENERATING') {
    res.status(202).json({
      data: {
        status: 'GENERATING',
        retry_after_ms: result.retryAfterMs,
      },
    })
    return
  }

  res.json({
    data: {
      status: 'READY',
      segments: result.segments,
    },
  })
}

export const updateDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  const devotionalId = req.params.id
  const body = parseOrThrow(updateDevotionalSchema, req.body)

  if (!Object.keys(body).length) {
    throw new AppError('No fields to update', 'NO_UPDATES', 400)
  }

  const snapshot = await getDevotionalSnapshot(devotionalId)
  ensureOwnerOrPrivileged(snapshot.authorId, req.user?.role, req.user?.sub)
  const content =
    body.content !== undefined
      ? (JSON.parse(JSON.stringify(body.content)) as Prisma.InputJsonValue)
      : undefined

  const updated = await updateDevotional({
    devotionalId,
    viewerId: req.user!.sub,
    viewerRole: req.user?.role,
    title: body.title,
    content,
    imageAssetId: body.image_asset_id,
    coverImageFocusY: body.cover_image_focus_y,
    verseReferences: body.verse_references,
  })

  res.json({ data: updated })
}

export const deleteDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  ensureAdmin(req.user?.role)
  await getDevotionalSnapshot(req.params.id)
  await deleteDevotional(req.params.id)
  res.json({ data: { success: true } })
}

export const publishDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  const snapshot = await getDevotionalSnapshot(req.params.id)
  ensureOwnerOrPrivileged(snapshot.authorId, req.user?.role, req.user?.sub)

  const result = await publishDevotional({
    devotionalId: req.params.id,
    viewerId: req.user!.sub,
    viewerRole: req.user?.role,
  })

  res.json({ data: result })
}

export const archiveDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  const snapshot = await getDevotionalSnapshot(req.params.id)
  ensureOwnerOrPrivileged(snapshot.authorId, req.user?.role, req.user?.sub)

  const result = await archiveDevotional({
    devotionalId: req.params.id,
    viewerId: req.user?.sub,
    viewerRole: req.user?.role,
  })

  res.json({ data: result })
}

export const toggleLikeHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  const snapshot = await getDevotionalSnapshot(req.params.id)
  if (!snapshot.isPubliclyVisible) {
    ensureOwnerOrPrivileged(snapshot.authorId, req.user?.role, req.user?.sub)
  }

  const result = await toggleDevotionalLike({
    devotionalId: req.params.id,
    userId: req.user!.sub,
  })

  res.json({ data: { liked: result.liked, likes_count: result.likesCount } })
}

export const saveDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  await ensurePublicInteraction(req.params.id)
  const body = parseOrThrow(devotionalShareSchema, req.body ?? {})
  const result = await saveDevotional({
    devotionalId: req.params.id,
    userId: req.user!.sub,
    deliveryToken: body.delivery_token ?? null,
  })

  res.json({ data: { saved: result.saved, save_count: result.saveCount } })
}

export const unsaveDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  await ensurePublicInteraction(req.params.id)
  const result = await unsaveDevotional({
    devotionalId: req.params.id,
    userId: req.user!.sub,
  })

  res.json({ data: { saved: result.saved, save_count: result.saveCount } })
}

export const shareDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  await ensurePublicInteraction(req.params.id)
  const body = parseOrThrow(devotionalShareSchema, req.body ?? {})
  const result = await shareDevotional({
    devotionalId: req.params.id,
    userId: req.user!.sub,
    deliveryToken: body.delivery_token ?? null,
  })

  res.json({
    data: { share_count: result.shareCount, share_url: result.shareUrl },
  })
}

export const readCompleteHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  await ensurePublicInteraction(req.params.id)
  const body = parseOrThrow(devotionalReadCompleteSchema, req.body ?? {})
  const result = await markReadComplete({
    devotionalId: req.params.id,
    userId: req.user!.sub,
    deliveryToken: body.delivery_token ?? null,
    shareToken: body.share_token ?? null,
    deviceId: body.device_id ?? null,
  })

  res.json({
    data: {
      read_complete: result.readComplete,
      read_complete_count: result.readCompleteCount,
      milestone: result.milestone,
    },
  })
}

export const reportDevotionalHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  await ensurePublicInteraction(req.params.id)
  const body = parseOrThrow(devotionalReportSchema, req.body)
  const result = await reportDevotional({
    devotionalId: req.params.id,
    userId: req.user!.sub,
    reason: body.reason as DevotionalReportReason,
    details: body.details ?? null,
    deliveryToken: body.delivery_token ?? null,
  })

  res.json({
    data: {
      reported: result.reported,
      report_count: result.reportCount,
      escalated: result.escalated,
    },
  })
}

export const approveDevotionalReviewHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  ensureReviewer(req.user?.role)

  const result = await approveDevotionalReview({
    devotionalId: req.params.id,
    reviewerId: req.user!.sub,
    viewerId: req.user!.sub,
    viewerRole: req.user?.role,
  })

  res.json({ data: result })
}

export const restrictDevotionalReviewHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  ensureReviewer(req.user?.role)
  const body = parseOrThrow(devotionalRestrictSchema, req.body)

  const result = await restrictDevotionalReview({
    devotionalId: req.params.id,
    reviewerId: req.user!.sub,
    reason: body.reason,
    viewerId: req.user!.sub,
    viewerRole: req.user?.role,
  })

  res.json({ data: result })
}

export const listCommentsHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  await ensurePublicInteraction(req.params.id)
  const query = parseOrThrow(paginationSchema, req.query)
  const pageRaw = query.page ? Number(query.page) : 1
  const limitRaw = query.limit ? Number(query.limit) : 50
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50

  const result = await listComments({
    devotionalId: req.params.id,
    page,
    limit,
  })
  res.json({ data: result })
}

export const addCommentHandler = async (
  req: DevotionalRequest,
  res: Response
) => {
  ensureAuth(req)
  await ensurePublicInteraction(req.params.id)
  const body = parseOrThrow(commentSchema, req.body)
  const comment = await addComment({
    devotionalId: req.params.id,
    userId: req.user!.sub,
    content: body.content,
  })

  res.json({ data: comment })
}

export const updateCommentHandler = async (
  req: DevotionalCommentRequest,
  res: Response
) => {
  ensureAuth(req)
  const comment = await getCommentAuthorId(req.params.commentId)
  ensureOwnerOrPrivileged(comment.userId, req.user?.role, req.user?.sub)

  const body = parseOrThrow(commentSchema, req.body)
  const updated = await updateComment({
    commentId: req.params.commentId,
    content: body.content,
  })

  res.json({ data: updated })
}

export const deleteCommentHandler = async (
  req: DevotionalCommentRequest,
  res: Response
) => {
  ensureAuth(req)
  const comment = await getCommentAuthorId(req.params.commentId)
  ensureOwnerOrPrivileged(comment.userId, req.user?.role, req.user?.sub)

  await deleteComment(req.params.commentId)
  res.json({ data: { success: true } })
}

export const uploadImageHandler = async (req: Request, res: Response) => {
  ensureAuth(req)

  if (!req.file) {
    throw new AppError('Image is required', 'IMAGE_REQUIRED', 400)
  }
  const result = await createDevotionalImageAssetFromBuffer({
    userId: req.user!.sub,
    inputBuffer: req.file.buffer,
    inputMimeType: req.file.mimetype,
  })

  res.json({
    data: {
      asset_id: result.asset.id,
      image_moderation_status: result.image_moderation_status,
      attachable: result.attachable,
      preview_image_url: result.preview_image_url,
      width: result.width,
      height: result.height,
      moderation_reason: result.moderation_reason,
    },
  })
}
