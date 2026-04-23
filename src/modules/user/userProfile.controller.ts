import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { Request, Response } from 'express'
import sharp from 'sharp'
import {
  DevotionalImageAssetStatus,
  Prisma,
} from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/db'
import { AppError } from '../../common/errors'
import {
  moderateImageUpload,
  toModerationAuditMetadata,
} from '../devotionals/devotional.moderation'
import { devotionalFeedPolicy } from '../devotionals/devotional.policy'
import { listPublicCreatorDevotionals } from '../devotionals/devotional.service'
import {
  creatorProfilePaginationSchema,
  creatorProfileUpdateSchema,
} from './userProfile.validation'
import {
  followCreator,
  getCreatorProfile,
  unfollowCreator,
  updateMyCreatorProfile,
} from './userProfile.service'

type CreatorRequest = Request<{ id: string }>

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

export const getCreatorProfileHandler = async (
  req: CreatorRequest,
  res: Response
) => {
  ensureAuth(req)
  const profile = await getCreatorProfile({
    viewerId: req.user!.sub,
    creatorId: req.params.id,
  })

  res.json({ data: profile })
}

export const listCreatorDevotionalsHandler = async (
  req: CreatorRequest,
  res: Response
) => {
  ensureAuth(req)
  const query = parseOrThrow(creatorProfilePaginationSchema, req.query)
  const limitRaw = query.limit ? Number(query.limit) : 20
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20

  await getCreatorProfile({
    viewerId: req.user!.sub,
    creatorId: req.params.id,
  })

  const result = await listPublicCreatorDevotionals({
    creatorId: req.params.id,
    viewerId: req.user!.sub,
    cursor: query.cursor,
    limit,
  })

  res.json({ data: result })
}

export const updateMyCreatorProfileHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const body = parseOrThrow(creatorProfileUpdateSchema, req.body)
  const result = await updateMyCreatorProfile({
    userId: req.user!.sub,
    handle: body.handle,
    bio: body.bio,
    avatarAssetId: body.avatar_asset_id,
    avatarAssetProvided: Object.prototype.hasOwnProperty.call(
      req.body,
      'avatar_asset_id'
    ),
  })

  res.json({
    data: {
      ...result.profile,
      avatar_attachment_error: result.avatarAttachmentError,
    },
  })
}

export const uploadCreatorAvatarHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)

  if (!req.file) {
    throw new AppError('Image is required', 'IMAGE_REQUIRED', 400)
  }

  const storageDir = path.join(process.cwd(), 'storage', 'users', 'avatars', 'tmp')
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
    width: 1024,
    height: 1024,
    fit: 'cover',
    withoutEnlargement: true,
  })

  if (extension === 'jpg') {
    pipeline = pipeline.jpeg({ quality: 85 })
  } else if (extension === 'png') {
    pipeline = pipeline.png({ quality: 85 })
  } else {
    pipeline = pipeline.webp({ quality: 85 })
  }

  const outputBuffer = await pipeline.toBuffer()
  const metadata = await sharp(outputBuffer).metadata()
  const moderation = await moderateImageUpload({
    mimeType: req.file.mimetype,
    data: outputBuffer,
  })

  await fs.writeFile(outputPath, outputBuffer)

  const tempUrl = `/storage/users/avatars/tmp/${filename}`
  try {
    const asset = await prisma.creatorAvatarAsset.create({
      data: {
        userId: req.user!.sub,
        status: moderation.attachable
          ? DevotionalImageAssetStatus.ATTACHABLE
          : DevotionalImageAssetStatus.REJECTED,
        imageModerationStatus: moderation.moderationStatus,
        moderationResultRaw: moderation.attachable
          ? Prisma.JsonNull
          : toModerationAuditMetadata(moderation),
        mimeType: req.file.mimetype,
        tempPath: outputPath,
        tempUrl,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        expiresAt: new Date(
          Date.now() +
            devotionalFeedPolicy.profile.avatarAssetTtlHours * 60 * 60 * 1000
        ),
      },
    })

    res.json({
      data: {
        asset_id: asset.id,
        image_moderation_status: asset.imageModerationStatus,
        attachable: moderation.attachable,
        preview_image_url: moderation.attachable ? tempUrl : null,
        width: asset.width,
        height: asset.height,
        moderation_reason: moderation.reason,
      },
    })
  } catch (error) {
    await fs.unlink(outputPath).catch(() => undefined)
    throw error
  }
}

export const followCreatorHandler = async (
  req: CreatorRequest,
  res: Response
) => {
  ensureAuth(req)
  const profile = await followCreator({
    followerId: req.user!.sub,
    creatorId: req.params.id,
  })

  res.json({ data: profile })
}

export const unfollowCreatorHandler = async (
  req: CreatorRequest,
  res: Response
) => {
  ensureAuth(req)
  const profile = await unfollowCreator({
    followerId: req.user!.sub,
    creatorId: req.params.id,
  })

  res.json({ data: profile })
}
