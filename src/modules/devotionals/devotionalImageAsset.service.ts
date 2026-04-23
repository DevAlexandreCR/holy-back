import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import {
  DevotionalImageAssetStatus,
  DevotionalImageModerationStatus,
  Prisma,
} from '@prisma/client'
import sharp from 'sharp'
import { prisma } from '../../config/db'
import { moderateImageUpload, toModerationAuditMetadata } from './devotional.moderation'

export type SupportedDevotionalImageMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'devotionals', 'tmp')

const extensionByMimeType: Record<SupportedDevotionalImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const ensureSupportedMimeType = (
  mimeType: string
): SupportedDevotionalImageMimeType => {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    return mimeType
  }

  throw new Error(`Unsupported devotional image mime type: ${mimeType}`)
}

const normalizeImageBuffer = async (params: {
  inputBuffer: Buffer
  outputMimeType: SupportedDevotionalImageMimeType
}) => {
  let pipeline = sharp(params.inputBuffer).resize({
    width: 1920,
    withoutEnlargement: true,
  })

  if (params.outputMimeType === 'image/jpeg') {
    pipeline = pipeline.jpeg({ quality: 85 })
  } else if (params.outputMimeType === 'image/png') {
    pipeline = pipeline.png({ quality: 85 })
  } else {
    pipeline = pipeline.webp({ quality: 85 })
  }

  const outputBuffer = await pipeline.toBuffer()
  const metadata = await sharp(outputBuffer).metadata()

  return {
    buffer: outputBuffer,
    mimeType: params.outputMimeType,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
  }
}

export const createDevotionalImageAssetFromBuffer = async (params: {
  userId: string
  inputBuffer: Buffer
  inputMimeType: string
  outputMimeType?: SupportedDevotionalImageMimeType
}) => {
  const targetMimeType = ensureSupportedMimeType(
    params.outputMimeType ?? params.inputMimeType
  )
  const normalized = await normalizeImageBuffer({
    inputBuffer: params.inputBuffer,
    outputMimeType: targetMimeType,
  })
  const moderation = await moderateImageUpload({
    mimeType: normalized.mimeType,
    data: normalized.buffer,
  })

  await fs.mkdir(STORAGE_DIR, { recursive: true })
  const extension = extensionByMimeType[normalized.mimeType]
  const filename = `${crypto.randomUUID()}.${extension}`
  const outputPath = path.join(STORAGE_DIR, filename)
  await fs.writeFile(outputPath, normalized.buffer)

  const tempUrl = `/storage/devotionals/tmp/${filename}`

  try {
    const asset = await prisma.devotionalImageAsset.create({
      data: {
        userId: params.userId,
        status: moderation.attachable
          ? DevotionalImageAssetStatus.ATTACHABLE
          : DevotionalImageAssetStatus.REJECTED,
        imageModerationStatus: moderation.moderationStatus,
        moderationResultRaw: moderation.attachable
          ? Prisma.JsonNull
          : toModerationAuditMetadata(moderation),
        mimeType: normalized.mimeType,
        tempPath: outputPath,
        tempUrl,
        width: normalized.width,
        height: normalized.height,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    return {
      asset,
      image_moderation_status: asset.imageModerationStatus,
      attachable: moderation.attachable,
      preview_image_url: moderation.attachable ? tempUrl : null,
      width: asset.width,
      height: asset.height,
      moderation_reason: moderation.reason,
    }
  } catch (error) {
    await fs.unlink(outputPath).catch(() => undefined)
    throw error
  }
}

export const isApprovedDevotionalImageAsset = (status: DevotionalImageModerationStatus) =>
  status === DevotionalImageModerationStatus.APPROVED
