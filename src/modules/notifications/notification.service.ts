import {
  DeviceOsPermissionStatus,
  DevicePlatform,
  DevotionalModerationStatus,
  DevotionalNotificationType,
  DevotionalPublicationState,
  Prisma,
} from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { ensureSettings, updateSettings } from '../user/userSettings.service'
import { devotionalNotificationPolicy } from '../devotionals/devotional.policy'
import { sendPushMessage } from './notification.provider'

const SENDABLE_PERMISSION_STATUSES = [
  DeviceOsPermissionStatus.AUTHORIZED,
  DeviceOsPermissionStatus.PROVISIONAL,
] as const

const formatNotificationPreferences = (settings: {
  devotionalNotificationsEnabled: boolean
  followedCreatorNotificationsEnabled: boolean
  featuredDevotionalNotificationsEnabled: boolean
}) => ({
  devotional_notifications_enabled: settings.devotionalNotificationsEnabled,
  followed_creator_notifications_enabled:
    settings.followedCreatorNotificationsEnabled,
  featured_devotional_notifications_enabled:
    settings.featuredDevotionalNotificationsEnabled,
})

const buildNotificationBody = (devotional: { title: string; author: { name: string } }) => ({
  [DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL]: {
    title: devotionalNotificationPolicy.titleTemplates.followedCreator,
    body: `${devotional.author.name} compartió "${devotional.title}".`,
  },
  [DevotionalNotificationType.FEATURED_DEVOTIONAL]: {
    title: devotionalNotificationPolicy.titleTemplates.featured,
    body: devotional.title,
  },
})

const resolveImageUrl = (value?: string | null) => {
  if (!value) {
    return null
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }

  if (value.startsWith('/')) {
    return `${config.app.publicBaseUrl.replace(/\/+$/, '')}${value}`
  }

  return null
}

const findActiveDeliveryForToken = async (params: {
  userId: string
  token: string
}) =>
  prisma.deviceToken.findFirst({
    where: {
      userId: params.userId,
      token: params.token,
      isActive: true,
    },
  })

const buildCooldownWhere = (
  type: DevotionalNotificationType,
  since: Date
): Prisma.DevotionalNotificationSendWhereInput => ({
  type,
  sentAt: {
    gte: since,
  },
  providerAcceptedAt: {
    not: null,
  },
})

const getCooldownEligibility = async (params: {
  userId: string
  type: DevotionalNotificationType
  now: Date
}) => {
  if (params.type === DevotionalNotificationType.FEATURED_DEVOTIONAL) {
    const since = new Date(
      params.now.getTime() -
        devotionalNotificationPolicy.cooldowns.featuredHours * 60 * 60 * 1000
    )
    const existing = await prisma.devotionalNotificationSend.findFirst({
      where: {
        userId: params.userId,
        ...buildCooldownWhere(params.type, since),
      },
      select: { id: true },
    })

    return existing == null
  }

  const since = new Date(params.now.getTime() - 24 * 60 * 60 * 1000)
  const count = await prisma.devotionalNotificationSend.count({
    where: {
      userId: params.userId,
      ...buildCooldownWhere(params.type, since),
    },
  })

  return count < devotionalNotificationPolicy.cooldowns.followedCreatorPer24h
}

const listTargetUserIds = async (params: {
  devotionalId: string
  authorId: string
  type: DevotionalNotificationType
}) => {
  if (
    params.type === DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL
  ) {
    const followers = await prisma.userFollow.findMany({
      where: {
        followedId: params.authorId,
        followerId: {
          not: params.authorId,
        },
      },
      select: { followerId: true },
    })

    return followers.map((item) => item.followerId)
  }

  if (!devotionalNotificationPolicy.featuredCampaignEnabled) {
    return []
  }

  const since = new Date(
    Date.now() -
      devotionalNotificationPolicy.shareAttributionWindowDays *
        24 *
        60 *
        60 *
        1000
  )

  const [activityUsers, fallbackUsers] = await Promise.all([
    prisma.userActivityDailyMetric.findMany({
      where: {
        date: {
          gte: since.toISOString().slice(0, 10),
        },
        hadDevotionalActivity: true,
      },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.appSessionEvent.findMany({
      where: {
        occurredAt: {
          gte: since,
        },
      },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ])

  return [
    ...new Set([
      ...activityUsers.map((item) => item.userId),
      ...fallbackUsers.map((item) => item.userId),
    ]),
  ].filter((userId) => userId !== params.authorId)
}

const listEligibleDeviceTokens = async (userIds: string[]) => {
  if (userIds.length === 0) {
    return []
  }

  return prisma.deviceToken.findMany({
    where: {
      userId: {
        in: userIds,
      },
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
}

const isPreferenceEnabled = (params: {
  settings: {
    devotionalNotificationsEnabled: boolean
    followedCreatorNotificationsEnabled: boolean
    featuredDevotionalNotificationsEnabled: boolean
  } | null
  type: DevotionalNotificationType
}) => {
  const settings = params.settings
  if (!settings?.devotionalNotificationsEnabled) {
    return false
  }

  if (
    params.type === DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL
  ) {
    return settings.followedCreatorNotificationsEnabled
  }

  return settings.featuredDevotionalNotificationsEnabled
}

export const getNotificationPreferences = async (userId: string) => {
  const settings = await ensureSettings(userId)
  return formatNotificationPreferences(settings)
}

export const updateNotificationPreferences = async (
  userId: string,
  input: {
    devotional_notifications_enabled: boolean
    followed_creator_notifications_enabled: boolean
    featured_devotional_notifications_enabled: boolean
  }
) => {
  const settings = await updateSettings(userId, {
    devotionalNotificationsEnabled: input.devotional_notifications_enabled,
    followedCreatorNotificationsEnabled:
      input.followed_creator_notifications_enabled,
    featuredDevotionalNotificationsEnabled:
      input.featured_devotional_notifications_enabled,
  })

  return formatNotificationPreferences(settings)
}

export const registerDeviceToken = async (params: {
  userId: string
  token: string
  platform: DevicePlatform
  osPermissionStatus: DeviceOsPermissionStatus
}) => {
  const now = new Date()
  const deviceToken = await prisma.deviceToken.upsert({
    where: { token: params.token },
    create: {
      userId: params.userId,
      token: params.token,
      platform: params.platform,
      osPermissionStatus: params.osPermissionStatus,
      isActive: true,
      lastSeenAt: now,
      lastPermissionSyncedAt: now,
    },
    update: {
      userId: params.userId,
      platform: params.platform,
      osPermissionStatus: params.osPermissionStatus,
      isActive: true,
      lastSeenAt: now,
      lastPermissionSyncedAt: now,
    },
  })

  return {
    token: deviceToken.token,
    platform: deviceToken.platform,
    os_permission_status: deviceToken.osPermissionStatus,
    is_active: deviceToken.isActive,
    last_seen_at: deviceToken.lastSeenAt.toISOString(),
    last_permission_synced_at:
      deviceToken.lastPermissionSyncedAt.toISOString(),
  }
}

export const deleteDeviceToken = async (params: {
  userId: string
  token: string
}) => {
  const existing = await findActiveDeliveryForToken(params)
  if (!existing) {
    return { success: true }
  }

  await prisma.deviceToken.update({
    where: { id: existing.id },
    data: {
      isActive: false,
    },
  })

  return { success: true }
}

export const markNotificationOpened = async (params: {
  userId: string
  devotionalId: string
  type: DevotionalNotificationType
}) => {
  const send = await prisma.devotionalNotificationSend.findFirst({
    where: {
      userId: params.userId,
      devotionalId: params.devotionalId,
      type: params.type,
      providerAcceptedAt: {
        not: null,
      },
      openedAt: null,
    },
    orderBy: {
      sentAt: 'desc',
    },
  })

  if (!send) {
    return { opened: false }
  }

  await prisma.devotionalNotificationSend.update({
    where: { id: send.id },
    data: {
      openedAt: new Date(),
    },
  })

  return { opened: true }
}

export const sendDevotionalNotifications = async (params: {
  devotionalId: string
  type: DevotionalNotificationType
}) => {
  const devotional = await prisma.devotional.findUnique({
    where: { id: params.devotionalId },
    include: {
      author: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  if (!devotional) {
    throw new AppError('Devotional not found', 'DEVOTIONAL_NOT_FOUND', 404)
  }

  if (
    devotional.moderationStatus !== DevotionalModerationStatus.CLEAR ||
    ![
      DevotionalPublicationState.PUBLISHED_LOW_REACH,
      DevotionalPublicationState.TRENDING,
      DevotionalPublicationState.FEATURED,
    ].some((state) => state === devotional.publicationState)
  ) {
    return {
      sent: 0,
      provider_accepted: 0,
      failed: 0,
      token_deactivated: 0,
    }
  }

  const userIds = await listTargetUserIds({
    devotionalId: devotional.id,
    authorId: devotional.authorId,
    type: params.type,
  })
  const deviceTokens = await listEligibleDeviceTokens(userIds)
  const messageTemplates = buildNotificationBody(devotional)
  const payload = messageTemplates[params.type]
  const imageUrl = resolveImageUrl(devotional.imageUrl)
  const now = new Date()

  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0

  for (const deviceToken of deviceTokens) {
    if (
      !isPreferenceEnabled({
        settings: deviceToken.user.settings,
        type: params.type,
      })
    ) {
      continue
    }

    const cooldownEligible = await getCooldownEligibility({
      userId: deviceToken.userId,
      type: params.type,
      now,
    })
    if (!cooldownEligible) {
      continue
    }

    const createdSend = await prisma.devotionalNotificationSend.create({
      data: {
        devotionalId: devotional.id,
        userId: deviceToken.userId,
        deviceTokenId: deviceToken.id,
        type: params.type,
        title: payload.title,
        body: payload.body,
        imageUrl,
        payload: {
          type: params.type,
          title: payload.title,
          body: payload.body,
          devotional_id: devotional.id,
          image_url: imageUrl,
        },
      },
    })

    sent += 1

    const providerResult = await sendPushMessage({
      token: deviceToken.token,
      title: payload.title,
      body: payload.body,
      imageUrl,
      data: {
        type: params.type,
        title: payload.title,
        body: payload.body,
        devotional_id: devotional.id,
        ...(imageUrl ? { image_url: imageUrl } : {}),
      },
    })

    if (providerResult.providerAccepted) {
      providerAccepted += 1
      await prisma.devotionalNotificationSend.update({
        where: { id: createdSend.id },
        data: {
          providerAcceptedAt: new Date(),
          providerMessageId: providerResult.providerMessageId ?? null,
        },
      })
      continue
    }

    failed += 1
    const failureCode = providerResult.failureCode ?? 'FCM_REQUEST_FAILED'
    const updatePayload: Prisma.DevotionalNotificationSendUpdateInput = {
      failedAt: new Date(),
      failureCode,
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

    await prisma.devotionalNotificationSend.update({
      where: { id: createdSend.id },
      data: updatePayload,
    })
  }

  return {
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}
