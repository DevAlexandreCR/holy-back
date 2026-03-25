import crypto from 'crypto'
import {
  DevotionalModerationStatus,
  DevotionalPublicationState,
  Prisma,
  ShareAttributionEventType,
} from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { config } from '../../config/env'

const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const PUBLIC_DEVOTIONAL_STATES = [
  DevotionalPublicationState.PUBLISHED_LOW_REACH,
  DevotionalPublicationState.TRENDING,
  DevotionalPublicationState.FEATURED,
] as const

const toBaseUrl = (value: string) => value.replace(/\/+$/, '')

const buildDedupKey = (params: { userId?: string | null; deviceId?: string | null }) => {
  if (params.userId) {
    return `user:${params.userId}`
  }
  if (params.deviceId) {
    return `device:${params.deviceId}`
  }
  return null
}

const isPubliclyVisible = (devotional: {
  publicationState: DevotionalPublicationState
  moderationStatus: DevotionalModerationStatus
}) =>
  PUBLIC_DEVOTIONAL_STATES.some(
    (state) => state === devotional.publicationState
  ) &&
  devotional.moderationStatus === DevotionalModerationStatus.CLEAR

const isExpired = async (sourceId: string, createdAt: Date) => {
  const firstLinkOpen = await prisma.devotionalShareAttributionEvent.findFirst({
    where: {
      sourceId,
      type: ShareAttributionEventType.LINK_OPEN,
    },
    orderBy: {
      occurredAt: 'asc',
    },
    select: {
      occurredAt: true,
    },
  })

  const windowStart = firstLinkOpen?.occurredAt ?? createdAt
  return windowStart.getTime() + ATTRIBUTION_WINDOW_MS < Date.now()
}

const createAttributionEvent = async (params: {
  sourceId: string
  type: ShareAttributionEventType
  userId?: string | null
  deviceId?: string | null
  metadata?: Prisma.InputJsonValue
  allowDuplicates?: boolean
}) => {
  const dedupKey = params.allowDuplicates
    ? null
    : buildDedupKey({ userId: params.userId, deviceId: params.deviceId })

  try {
    await prisma.devotionalShareAttributionEvent.create({
      data: {
        sourceId: params.sourceId,
        type: params.type,
        userId: params.userId ?? null,
        deviceId: params.deviceId ?? null,
        dedupKey,
        metadata: params.metadata,
      },
    })
    return true
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return false
    }

    throw error
  }
}

export const buildShareUrl = (token: string) =>
  `${toBaseUrl(config.app.publicBaseUrl)}/s/${token}`

export const buildShareAppLink = (devotionalId: string, token: string) =>
  `holyverso://app/devotionals/${devotionalId}?share_token=${encodeURIComponent(token)}`

export const buildShareUniversalLink = (devotionalId: string, token: string) =>
  `${toBaseUrl(config.app.publicBaseUrl)}/devotionals/${devotionalId}?share_token=${encodeURIComponent(token)}`

export const createShareAttributionSource = async (params: {
  devotionalId: string
  userId: string
  tx?: Prisma.TransactionClient
}) => {
  const client = params.tx ?? prisma
  const source = await client.devotionalShareAttributionSource.create({
    data: {
      devotionalId: params.devotionalId,
      sharerUserId: params.userId,
      token: crypto.randomUUID(),
    },
  })

  return {
    sourceId: source.id,
    token: source.token,
    shareUrl: buildShareUrl(source.token),
  }
}

export const getShareRedirectContext = async (token: string) => {
  const source = await prisma.devotionalShareAttributionSource.findUnique({
    where: { token },
    include: {
      devotional: {
        select: {
          id: true,
          title: true,
          publicationState: true,
          moderationStatus: true,
        },
      },
    },
  })

  if (!source) {
    throw new AppError('Share link not found', 'SHARE_LINK_NOT_FOUND', 404)
  }

  await createAttributionEvent({
    sourceId: source.id,
    type: ShareAttributionEventType.LINK_OPEN,
    metadata: {
      devotional_id: source.devotional.id,
    },
    allowDuplicates: true,
  })

  return {
    token: source.token,
    devotionalId: source.devotional.id,
    devotionalTitle: source.devotional.title,
    isAvailable: isPubliclyVisible(source.devotional),
    appLink: buildShareAppLink(source.devotional.id, source.token),
    universalLink: buildShareUniversalLink(source.devotional.id, source.token),
  }
}

export const recordShareAttributionAppOpen = async (params: {
  token: string
  deviceId?: string | null
  userId?: string | null
  installDetected?: boolean
  registrationCompleted?: boolean
}) => {
  const source = await prisma.devotionalShareAttributionSource.findUnique({
    where: { token: params.token },
  })

  if (!source) {
    throw new AppError('Share link not found', 'SHARE_LINK_NOT_FOUND', 404)
  }

  if (await isExpired(source.id, source.createdAt)) {
    return {
      app_open: false,
      install_detected: false,
      registration: false,
    }
  }

  const [appOpen, installDetected, registration] = await Promise.all([
    createAttributionEvent({
      sourceId: source.id,
      type: ShareAttributionEventType.APP_OPEN,
      userId: params.userId,
      deviceId: params.deviceId,
    }),
    params.installDetected
      ? createAttributionEvent({
          sourceId: source.id,
          type: ShareAttributionEventType.INSTALL_DETECTED,
          userId: params.userId,
          deviceId: params.deviceId,
        })
      : Promise.resolve(false),
    params.registrationCompleted && params.userId
      ? createAttributionEvent({
          sourceId: source.id,
          type: ShareAttributionEventType.REGISTRATION,
          userId: params.userId,
          deviceId: params.deviceId,
        })
      : Promise.resolve(false),
  ])

  return {
    app_open: appOpen,
    install_detected: installDetected,
    registration,
  }
}

const recordFirstAttributedEvent = async (params: {
  token: string
  devotionalId: string
  userId: string
  deviceId?: string | null
  type: 'FIRST_DEVOTIONAL_OPEN' | 'FIRST_READ_COMPLETE'
}) => {
  const source = await prisma.devotionalShareAttributionSource.findUnique({
    where: { token: params.token },
  })

  if (!source || source.devotionalId !== params.devotionalId) {
    return { recorded: false }
  }

  if (await isExpired(source.id, source.createdAt)) {
    return { recorded: false }
  }

  const recorded = await createAttributionEvent({
    sourceId: source.id,
    type: params.type,
    userId: params.userId,
    deviceId: params.deviceId,
  })

  return { recorded }
}

export const recordFirstAttributedDevotionalOpen = (params: {
  token: string
  devotionalId: string
  userId: string
  deviceId?: string | null
}) =>
  recordFirstAttributedEvent({
    ...params,
    type: ShareAttributionEventType.FIRST_DEVOTIONAL_OPEN,
  })

export const recordFirstAttributedReadComplete = (params: {
  token: string
  devotionalId: string
  userId: string
  deviceId?: string | null
}) =>
  recordFirstAttributedEvent({
    ...params,
    type: ShareAttributionEventType.FIRST_READ_COMPLETE,
  })
