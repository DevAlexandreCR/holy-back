import {
  DeviceOsPermissionStatus,
  NotificationInboxType,
  Prisma,
} from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { sendPushMessage } from './notification.provider'

const SENDABLE_PERMISSION_STATUSES = [
  DeviceOsPermissionStatus.AUTHORIZED,
  DeviceOsPermissionStatus.PROVISIONAL,
] as const

const REACTION_NOTIFICATION_TYPES = [
  NotificationInboxType.DEVOTIONAL_LIKE,
  NotificationInboxType.DEVOTIONAL_SHARE,
] as const

const REACTION_WINDOW_MINUTES = 30
const MAX_ACTOR_PREVIEW = 3
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 50
const FLUSH_BATCH_SIZE = 100

type NotificationInboxFilter = 'all' | 'unread'

type ActorPreview = {
  id: string
  name: string
  avatar_url: string | null
}

type NotificationInboxCursor = {
  createdAt: string
  id: string
}

const encodeCursor = (cursor: NotificationInboxCursor) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')

const decodeCursor = (cursor?: string | null) => {
  if (!cursor) {
    return null
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as Partial<NotificationInboxCursor>

    if (
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.createdAt ||
      !parsed.id
    ) {
      return null
    }

    const createdAt = new Date(parsed.createdAt)
    if (Number.isNaN(createdAt.getTime())) {
      return null
    }

    return {
      createdAt,
      id: parsed.id,
    }
  } catch {
    return null
  }
}

const toAbsoluteUrl = (baseUrl: string, relativePath: string) =>
  `${baseUrl.replace(/\/+$/, '')}${relativePath}`

const resolveAssetUrl = (value?: string | null) => {
  if (!value) {
    return null
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }

  if (value.startsWith('/')) {
    return toAbsoluteUrl(config.app.publicApiBaseUrl, value)
  }

  return null
}

const buildActorPreview = (actor: {
  id: string
  name: string
  creatorAvatarUrl?: string | null
}): ActorPreview => ({
  id: actor.id,
  name: actor.name,
  avatar_url: resolveAssetUrl(actor.creatorAvatarUrl),
})

const readActorPreview = (metadata: Prisma.JsonValue | null): ActorPreview[] => {
  const actorPreview = (metadata as { actor_preview?: unknown } | null)
    ?.actor_preview

  if (!Array.isArray(actorPreview)) {
    return []
  }

  return actorPreview
    .map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as { id?: unknown }).id !== 'string' ||
        typeof (item as { name?: unknown }).name !== 'string'
      ) {
        return null
      }

      return {
        id: (item as { id: string }).id,
        name: (item as { name: string }).name,
        avatar_url:
          typeof (item as { avatar_url?: unknown }).avatar_url === 'string'
            ? ((item as { avatar_url: string }).avatar_url || null)
            : null,
      } satisfies ActorPreview
    })
    .filter((item): item is ActorPreview => item != null)
}

export const mergeActorPreview = (
  existing: ActorPreview[],
  nextActor: ActorPreview
) => [
  nextActor,
  ...existing.filter((item) => item.id !== nextActor.id),
].slice(0, MAX_ACTOR_PREVIEW)

const toActorPreviewMetadata = (actors: ActorPreview[]): Prisma.InputJsonValue =>
  ({
    actor_preview: actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      avatar_url: actor.avatar_url,
    })),
  }) satisfies Prisma.InputJsonValue

const pluralize = (count: number, singular: string, plural: string) =>
  count === 1 ? singular : plural

export const buildInboxCopy = (params: {
  type: NotificationInboxType
  devotionalTitle?: string | null
  actorPreview: ActorPreview[]
  aggregateCount: number
}) => {
  const leadActor = params.actorPreview[0]?.name ?? 'Alguien'
  const devotionalTitle = params.devotionalTitle?.trim() || 'tu devocional'
  const otherActors = Math.max(0, params.aggregateCount - 1)

  if (params.type === NotificationInboxType.DEVOTIONAL_LIKE) {
    if (params.aggregateCount <= 1) {
      return {
        title: 'Nuevo like',
        body: `${leadActor} le dio like a "${devotionalTitle}".`,
      }
    }

    return {
      title: 'Nuevos likes',
      body: `${leadActor} y ${otherActors} ${pluralize(
        otherActors,
        'persona más reaccionó',
        'personas más reaccionaron'
      )} a "${devotionalTitle}".`,
    }
  }

  if (params.type === NotificationInboxType.DEVOTIONAL_SHARE) {
    if (params.aggregateCount <= 1) {
      return {
        title: 'Nuevo compartido',
        body: `${leadActor} compartió "${devotionalTitle}".`,
      }
    }

    return {
      title: 'Nuevos compartidos',
      body: `${leadActor} y ${otherActors} ${pluralize(
        otherActors,
        'persona más compartió',
        'personas más compartieron'
      )} "${devotionalTitle}".`,
    }
  }

  if (params.type === NotificationInboxType.DEVOTIONAL_COMMENT) {
    return {
      title: 'Nuevo comentario',
      body: `${leadActor} comentó en "${devotionalTitle}".`,
    }
  }

  return {
    title: 'Nuevo seguidor',
    body: `${leadActor} comenzó a seguirte.`,
  }
}

const isSocialPushEnabled = (params: {
  settings: {
    socialActivityNotificationsEnabled: boolean
    commentNotificationsEnabled: boolean
    followNotificationsEnabled: boolean
    reactionNotificationsEnabled: boolean
  } | null
  type: NotificationInboxType
}) => {
  const settings = params.settings
  if (!settings || settings.socialActivityNotificationsEnabled !== true) {
    return false
  }

  if (params.type === NotificationInboxType.DEVOTIONAL_COMMENT) {
    return settings.commentNotificationsEnabled === true
  }

  if (params.type === NotificationInboxType.NEW_FOLLOWER) {
    return settings.followNotificationsEnabled === true
  }

  return settings.reactionNotificationsEnabled === true
}

const listEligibleDeviceTokens = async (userId: string) =>
  prisma.deviceToken.findMany({
    where: {
      userId,
      isActive: true,
      osPermissionStatus: {
        in: [...SENDABLE_PERMISSION_STATUSES],
      },
      user: {
        deletedAt: null,
      },
    },
    include: {
      user: {
        include: {
          settings: true,
        },
      },
    },
  })

const buildDestinationPayload = (item: {
  id: string
  type: NotificationInboxType
  devotionalId: string | null
  actorUserId: string | null
  title: string
  body: string
  imageUrl: string | null
}) => ({
  notification_id: item.id,
  notification_type: item.type,
  destination_type:
    item.type === NotificationInboxType.NEW_FOLLOWER
      ? 'creator_profile'
      : 'devotional',
  ...(item.devotionalId ? { devotional_id: item.devotionalId } : {}),
  ...(item.actorUserId ? { creator_id: item.actorUserId } : {}),
  title: item.title,
  body: item.body,
  ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
})

const deliverInboxPush = async (params: {
  inboxItemId: string
  processedAt?: Date
}) => {
  const item = await prisma.notificationInboxItem.findUnique({
    where: { id: params.inboxItemId },
    select: {
      id: true,
      recipientUserId: true,
      actorUserId: true,
      devotionalId: true,
      type: true,
      title: true,
      body: true,
      imageUrl: true,
      lastPushedAt: true,
    },
  })

  if (!item) {
    throw new AppError('Notification inbox item not found', 'NOTIFICATION_INBOX_ITEM_NOT_FOUND', 404)
  }

  const processedAt = params.processedAt ?? new Date()
  const deviceTokens = await listEligibleDeviceTokens(item.recipientUserId)
  const userSettings = deviceTokens[0]?.user.settings ?? null

  if (!isSocialPushEnabled({ settings: userSettings, type: item.type })) {
    await prisma.notificationInboxItem.update({
      where: { id: item.id },
      data: {
        lastPushedAt: processedAt,
      },
    })

    return {
      sent: 0,
      provider_accepted: 0,
      failed: 0,
      token_deactivated: 0,
      skipped: true,
    }
  }

  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0

  for (const deviceToken of deviceTokens) {
    const createdDelivery = await prisma.notificationInboxPushDelivery.create({
      data: {
        inboxItemId: item.id,
        recipientUserId: item.recipientUserId,
        deviceTokenId: deviceToken.id,
        title: item.title,
        body: item.body,
        payload: buildDestinationPayload(item),
      },
    })

    sent += 1

    const providerResult = await sendPushMessage({
      token: deviceToken.token,
      title: item.title,
      body: item.body,
      imageUrl: item.imageUrl,
      data: buildDestinationPayload(item),
    })

    if (providerResult.providerAccepted) {
      providerAccepted += 1
      await prisma.notificationInboxPushDelivery.update({
        where: { id: createdDelivery.id },
        data: {
          providerAcceptedAt: new Date(),
          providerMessageId: providerResult.providerMessageId ?? null,
        },
      })
      continue
    }

    failed += 1
    const updatePayload: Prisma.NotificationInboxPushDeliveryUpdateInput = {
      failedAt: new Date(),
      failureCode: providerResult.failureCode ?? 'FCM_REQUEST_FAILED',
    }

    if (providerResult.shouldDeactivateToken) {
      tokenDeactivated += 1
      updatePayload.tokenDeactivatedAt = new Date()
      await prisma.deviceToken.update({
        where: { id: deviceToken.id },
        data: {
          isActive: false,
        },
      })
    }

    await prisma.notificationInboxPushDelivery.update({
      where: { id: createdDelivery.id },
      data: updatePayload,
    })
  }

  await prisma.notificationInboxItem.update({
    where: { id: item.id },
    data: {
      lastPushedAt: processedAt,
    },
  })

  return {
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
    skipped: false,
  }
}

const resolveDevotionalTarget = async (devotionalId: string) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: devotionalId },
    select: {
      id: true,
      title: true,
      imageUrl: true,
      authorId: true,
    },
  })

  if (!devotional) {
    return null
  }

  return {
    ...devotional,
    imageUrl: resolveAssetUrl(devotional.imageUrl),
  }
}

const resolveActor = async (actorUserId: string) => {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      name: true,
      creatorAvatarUrl: true,
    },
  })

  if (!actor) {
    return null
  }

  return {
    ...actor,
    actorPreview: buildActorPreview(actor),
  }
}

const createImmediateInboxItem = async (params: {
  recipientUserId: string
  type: NotificationInboxType
  actor: ActorPreview
  actorUserId: string
  devotionalId?: string | null
  devotionalTitle?: string | null
  commentId?: string | null
  imageUrl?: string | null
}) => {
  const copy = buildInboxCopy({
    type: params.type,
    devotionalTitle: params.devotionalTitle,
    actorPreview: [params.actor],
    aggregateCount: 1,
  })

  const created = await prisma.notificationInboxItem.create({
    data: {
      recipientUserId: params.recipientUserId,
      type: params.type,
      actorUserId: params.actorUserId,
      devotionalId: params.devotionalId ?? null,
      commentId: params.commentId ?? null,
      title: copy.title,
      body: copy.body,
      imageUrl: params.imageUrl ?? null,
      metadata: toActorPreviewMetadata([params.actor]),
    },
  })

  return created.id
}

const createOrUpdateReactionInboxItem = async (params: {
  type: 'DEVOTIONAL_LIKE' | 'DEVOTIONAL_SHARE'
  recipientUserId: string
  actorUserId: string
  devotionalId: string
  devotionalTitle: string
  imageUrl?: string | null
  actor: ActorPreview
}) => {
  const now = new Date()
  const aggregationKey = `${params.type}:${params.recipientUserId}:${params.devotionalId}`

  return prisma.$transaction(async (tx) => {
    const existing = await tx.notificationInboxItem.findFirst({
      where: {
        recipientUserId: params.recipientUserId,
        type: params.type,
        devotionalId: params.devotionalId,
        aggregationKey,
        windowEndsAt: {
          gt: now,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        aggregateCount: true,
        metadata: true,
      },
    })

    if (existing) {
      const duplicate = await tx.notificationInboxActorEvent.findUnique({
        where: {
          inboxItemId_actorUserId: {
            inboxItemId: existing.id,
            actorUserId: params.actorUserId,
          },
        },
      })

      if (duplicate) {
        return {
          inboxItemId: existing.id,
          created: false,
          updated: false,
        }
      }

      const mergedActors = mergeActorPreview(
        readActorPreview(existing.metadata),
        params.actor
      )
      const nextCount = existing.aggregateCount + 1
      const copy = buildInboxCopy({
        type: params.type,
        devotionalTitle: params.devotionalTitle,
        actorPreview: mergedActors,
        aggregateCount: nextCount,
      })

      await tx.notificationInboxActorEvent.create({
        data: {
          inboxItemId: existing.id,
          actorUserId: params.actorUserId,
        },
      })

      await tx.notificationInboxItem.update({
        where: { id: existing.id },
        data: {
          actorUserId: params.actorUserId,
          title: copy.title,
          body: copy.body,
          imageUrl: params.imageUrl ?? null,
          aggregateCount: nextCount,
          metadata: toActorPreviewMetadata(mergedActors),
        },
      })

      return {
        inboxItemId: existing.id,
        created: false,
        updated: true,
      }
    }

    const copy = buildInboxCopy({
      type: params.type,
      devotionalTitle: params.devotionalTitle,
      actorPreview: [params.actor],
      aggregateCount: 1,
    })

    const created = await tx.notificationInboxItem.create({
      data: {
        recipientUserId: params.recipientUserId,
        type: params.type,
        actorUserId: params.actorUserId,
        devotionalId: params.devotionalId,
        title: copy.title,
        body: copy.body,
        imageUrl: params.imageUrl ?? null,
        aggregationKey,
        windowStartedAt: now,
        windowEndsAt: new Date(
          now.getTime() + REACTION_WINDOW_MINUTES * 60 * 1000
        ),
        metadata: toActorPreviewMetadata([params.actor]),
      },
    })

    await tx.notificationInboxActorEvent.create({
      data: {
        inboxItemId: created.id,
        actorUserId: params.actorUserId,
      },
    })

    return {
      inboxItemId: created.id,
      created: true,
      updated: true,
    }
  })
}

export const notifyDevotionalLikeCreated = async (params: {
  devotionalId: string
  actorUserId: string
}) => {
  try {
    const [devotional, actor] = await Promise.all([
      resolveDevotionalTarget(params.devotionalId),
      resolveActor(params.actorUserId),
    ])

    if (!devotional || !actor || devotional.authorId === params.actorUserId) {
      return
    }

    await createOrUpdateReactionInboxItem({
      type: NotificationInboxType.DEVOTIONAL_LIKE,
      recipientUserId: devotional.authorId,
      actorUserId: params.actorUserId,
      devotionalId: devotional.id,
      devotionalTitle: devotional.title,
      imageUrl: devotional.imageUrl,
      actor: actor.actorPreview,
    })
  } catch (error) {
    console.error('[NotificationInbox] Failed to process devotional like', error)
  }
}

export const notifyDevotionalShareCreated = async (params: {
  devotionalId: string
  actorUserId: string
}) => {
  try {
    const [devotional, actor] = await Promise.all([
      resolveDevotionalTarget(params.devotionalId),
      resolveActor(params.actorUserId),
    ])

    if (!devotional || !actor || devotional.authorId === params.actorUserId) {
      return
    }

    await createOrUpdateReactionInboxItem({
      type: NotificationInboxType.DEVOTIONAL_SHARE,
      recipientUserId: devotional.authorId,
      actorUserId: params.actorUserId,
      devotionalId: devotional.id,
      devotionalTitle: devotional.title,
      imageUrl: devotional.imageUrl,
      actor: actor.actorPreview,
    })
  } catch (error) {
    console.error('[NotificationInbox] Failed to process devotional share', error)
  }
}

export const notifyDevotionalCommentCreated = async (params: {
  devotionalId: string
  commentId: string
  actorUserId: string
}) => {
  try {
    const [devotional, actor] = await Promise.all([
      resolveDevotionalTarget(params.devotionalId),
      resolveActor(params.actorUserId),
    ])

    if (!devotional || !actor || devotional.authorId === params.actorUserId) {
      return
    }

    const inboxItemId = await createImmediateInboxItem({
      recipientUserId: devotional.authorId,
      type: NotificationInboxType.DEVOTIONAL_COMMENT,
      actor: actor.actorPreview,
      actorUserId: params.actorUserId,
      devotionalId: devotional.id,
      devotionalTitle: devotional.title,
      commentId: params.commentId,
      imageUrl: devotional.imageUrl,
    })

    await deliverInboxPush({ inboxItemId })
  } catch (error) {
    console.error('[NotificationInbox] Failed to process devotional comment', error)
  }
}

export const notifyNewFollowerCreated = async (params: {
  recipientUserId: string
  actorUserId: string
}) => {
  try {
    if (params.recipientUserId === params.actorUserId) {
      return
    }

    const actor = await resolveActor(params.actorUserId)
    if (!actor) {
      return
    }

    const inboxItemId = await createImmediateInboxItem({
      recipientUserId: params.recipientUserId,
      type: NotificationInboxType.NEW_FOLLOWER,
      actor: actor.actorPreview,
      actorUserId: params.actorUserId,
      imageUrl: actor.actorPreview.avatar_url,
    })

    await deliverInboxPush({ inboxItemId })
  } catch (error) {
    console.error('[NotificationInbox] Failed to process follower notification', error)
  }
}

const buildInboxWhere = (params: {
  userId: string
  filter: NotificationInboxFilter
  cursor?: { createdAt: Date; id: string } | null
}): Prisma.NotificationInboxItemWhereInput => ({
  recipientUserId: params.userId,
  ...(params.filter === 'unread'
    ? {
        isRead: false,
      }
    : {}),
  ...(params.cursor
    ? {
        OR: [
          {
            createdAt: {
              lt: params.cursor.createdAt,
            },
          },
          {
            createdAt: params.cursor.createdAt,
            id: {
              lt: params.cursor.id,
            },
          },
        ],
      }
    : {}),
})

export const listNotificationInbox = async (params: {
  userId: string
  cursor?: string | null
  limit?: number
  filter?: NotificationInboxFilter
}) => {
  const filter = params.filter ?? 'all'
  const cursor = decodeCursor(params.cursor)

  if (params.cursor && !cursor) {
    throw new AppError('Invalid cursor', 'INVALID_CURSOR', 400)
  }

  const limit = Math.min(
    Math.max(params.limit ?? DEFAULT_LIST_LIMIT, 1),
    MAX_LIST_LIMIT
  )

  const items = await prisma.notificationInboxItem.findMany({
    where: buildInboxWhere({
      userId: params.userId,
      filter,
      cursor,
    }),
    orderBy: [
      {
        createdAt: 'desc',
      },
      {
        id: 'desc',
      },
    ],
    take: limit + 1,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      imageUrl: true,
      aggregateCount: true,
      isRead: true,
      readAt: true,
      openedAt: true,
      createdAt: true,
      actorUserId: true,
      devotionalId: true,
      metadata: true,
      actorUser: {
        select: {
          id: true,
          name: true,
          handle: true,
          creatorAvatarUrl: true,
        },
      },
      devotional: {
        select: {
          id: true,
          title: true,
          imageUrl: true,
        },
      },
    },
  })

  const hasMore = items.length > limit
  const visibleItems = hasMore ? items.slice(0, limit) : items

  return {
    items: visibleItems.map((item) => {
      const actorPreview = readActorPreview(item.metadata)
      const fallbackActor =
        actorPreview.length === 0 && item.actorUser
          ? [
              {
                id: item.actorUser.id,
                name: item.actorUser.name,
                avatar_url: resolveAssetUrl(item.actorUser.creatorAvatarUrl),
              },
            ]
          : actorPreview

      const devotionalImageUrl =
        item.devotional?.imageUrl != null
          ? resolveAssetUrl(item.devotional.imageUrl)
          : null

      return {
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        image_url: item.imageUrl ?? devotionalImageUrl,
        aggregate_count: item.aggregateCount,
        actor_preview: fallbackActor,
        devotional:
          item.devotional != null
            ? {
                id: item.devotional.id,
                title: item.devotional.title,
                image_url: devotionalImageUrl,
              }
            : null,
        creator:
          item.actorUser != null
            ? {
                id: item.actorUser.id,
                name: item.actorUser.name,
                handle: item.actorUser.handle,
                avatar_url: resolveAssetUrl(item.actorUser.creatorAvatarUrl),
              }
            : null,
        destination:
          item.type === NotificationInboxType.NEW_FOLLOWER &&
              item.actorUserId != null
            ? {
                type: 'creator_profile',
                creator_id: item.actorUserId,
              }
            : item.devotionalId != null
            ? {
                type: 'devotional',
                devotional_id: item.devotionalId,
              }
            : null,
        is_read: item.isRead,
        read_at: item.readAt?.toISOString() ?? null,
        opened_at: item.openedAt?.toISOString() ?? null,
        created_at: item.createdAt.toISOString(),
      }
    }),
    next_cursor:
      hasMore && visibleItems.length > 0
        ? encodeCursor({
            createdAt:
              visibleItems[visibleItems.length - 1]!.createdAt.toISOString(),
            id: visibleItems[visibleItems.length - 1]!.id,
          })
        : null,
    has_more: hasMore,
  }
}

export const getNotificationInboxUnreadCount = async (userId: string) => {
  const unreadCount = await prisma.notificationInboxItem.count({
    where: {
      recipientUserId: userId,
      isRead: false,
    },
  })

  return {
    unread_count: unreadCount,
  }
}

export const markNotificationInboxItemRead = async (params: {
  userId: string
  inboxItemId: string
  opened?: boolean
}) => {
  const existing = await prisma.notificationInboxItem.findFirst({
    where: {
      id: params.inboxItemId,
      recipientUserId: params.userId,
    },
  })

  if (!existing) {
    throw new AppError(
      'Notification inbox item not found',
      'NOTIFICATION_INBOX_ITEM_NOT_FOUND',
      404
    )
  }

  const now = new Date()
  const updated = await prisma.notificationInboxItem.update({
    where: { id: existing.id },
    data: {
      isRead: true,
      readAt: existing.readAt ?? now,
      ...(params.opened && !existing.openedAt
        ? {
            openedAt: now,
          }
        : {}),
    },
    select: {
      id: true,
      isRead: true,
      readAt: true,
      openedAt: true,
    },
  })

  return {
    id: updated.id,
    is_read: updated.isRead,
    read_at: updated.readAt?.toISOString() ?? null,
    opened_at: updated.openedAt?.toISOString() ?? null,
  }
}

export const markAllNotificationInboxItemsRead = async (userId: string) => {
  const now = new Date()
  const result = await prisma.notificationInboxItem.updateMany({
    where: {
      recipientUserId: userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: now,
    },
  })

  return {
    updated: result.count,
  }
}

export const flushPendingReactionNotificationPushes = async (now = new Date()) => {
  let processed = 0
  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0

  while (true) {
    const items = await prisma.notificationInboxItem.findMany({
      where: {
        type: {
          in: [...REACTION_NOTIFICATION_TYPES],
        },
        windowEndsAt: {
          lte: now,
        },
        lastPushedAt: null,
      },
      orderBy: [
        {
          windowEndsAt: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
      take: FLUSH_BATCH_SIZE,
      select: {
        id: true,
      },
    })

    if (items.length === 0) {
      break
    }

    for (const item of items) {
      const result = await deliverInboxPush({
        inboxItemId: item.id,
        processedAt: now,
      })

      processed += 1
      sent += result.sent
      providerAccepted += result.provider_accepted
      failed += result.failed
      tokenDeactivated += result.token_deactivated
    }
  }

  return {
    processed,
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}
