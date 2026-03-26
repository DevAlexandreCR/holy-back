import { access } from 'fs/promises'
import path from 'path'
import {
  DeviceOsPermissionStatus,
  DevicePlatform,
  DevotionalModerationStatus,
  DevotionalNotificationType,
  DevotionalPublicationState,
  Prisma,
  UserRole,
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
  authorModerationNotificationsEnabled: boolean
  editorReviewNotificationsEnabled: boolean
}) => ({
  devotional_notifications_enabled: settings.devotionalNotificationsEnabled,
  followed_creator_notifications_enabled:
    settings.followedCreatorNotificationsEnabled,
  featured_devotional_notifications_enabled:
    settings.featuredDevotionalNotificationsEnabled,
  author_moderation_notifications_enabled:
    settings.authorModerationNotificationsEnabled,
  editor_review_notifications_enabled:
    settings.editorReviewNotificationsEnabled,
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
  [DevotionalNotificationType.EDITOR_DEVOTIONAL_REVIEW_REQUIRED]: {
    title: devotionalNotificationPolicy.titleTemplates.editorReviewRequired,
    body: `${devotional.author.name} publicó "${devotional.title}" y requiere revisión.`,
  },
  [DevotionalNotificationType.AUTHOR_DEVOTIONAL_APPROVED]: {
    title: devotionalNotificationPolicy.titleTemplates.authorApproved,
    body: `"${devotional.title}" ya volvió a estar disponible.`,
  },
  [DevotionalNotificationType.AUTHOR_DEVOTIONAL_RESTRICTED]: {
    title: devotionalNotificationPolicy.titleTemplates.authorRestricted,
    body: `"${devotional.title}" fue retirado por revisión editorial.`,
  },
})

const toAbsoluteUrl = (baseUrl: string, relativePath: string) =>
  `${baseUrl.replace(/\/+$/, '')}${relativePath}`

const resolveImageUrl = async (params: {
  devotionalId: string
  value?: string | null
}) => {
  const value = params.value
  if (!value) {
    return null
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }

  if (value.startsWith('/storage/')) {
    const relativePath = value.replace(/^\/+/, '')
    const absoluteFilePath = path.join(process.cwd(), relativePath)

    try {
      await access(absoluteFilePath)
      return toAbsoluteUrl(config.app.publicApiBaseUrl, value)
    } catch {
      console.warn('[DevotionalNotifications] Skipping notification image because the storage asset is missing', {
        devotionalId: params.devotionalId,
        imagePath: value,
      })
      return null
    }
  }

  if (value.startsWith('/')) {
    return toAbsoluteUrl(config.app.publicApiBaseUrl, value)
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
  if (
    params.type === DevotionalNotificationType.EDITOR_DEVOTIONAL_REVIEW_REQUIRED ||
    params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_APPROVED ||
    params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_RESTRICTED
  ) {
    return true
  }

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
    params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_APPROVED ||
    params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_RESTRICTED
  ) {
    return [params.authorId]
  }

  if (
    params.type === DevotionalNotificationType.EDITOR_DEVOTIONAL_REVIEW_REQUIRED
  ) {
    const reviewers = await prisma.user.findMany({
      where: {
        role: {
          in: [UserRole.EDITOR, UserRole.LEAD, UserRole.ADMIN],
        },
        deletedAt: null,
        id: {
          not: params.authorId,
        },
      },
      select: { id: true },
    })

    return reviewers.map((item) => item.id)
  }

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
    authorModerationNotificationsEnabled: boolean
    editorReviewNotificationsEnabled: boolean
  } | null
  type: DevotionalNotificationType
}) => {
  const settings = params.settings
  if (
    params.type === DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL
  ) {
    return (
      settings?.devotionalNotificationsEnabled === true &&
      settings.followedCreatorNotificationsEnabled
    )
  }

  if (params.type === DevotionalNotificationType.FEATURED_DEVOTIONAL) {
    return (
      settings?.devotionalNotificationsEnabled === true &&
      settings.featuredDevotionalNotificationsEnabled
    )
  }

  if (
    params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_APPROVED ||
    params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_RESTRICTED
  ) {
    return settings?.authorModerationNotificationsEnabled === true
  }

  if (
    params.type === DevotionalNotificationType.EDITOR_DEVOTIONAL_REVIEW_REQUIRED
  ) {
    return settings?.editorReviewNotificationsEnabled === true
  }

  return false
}

const isNotificationEligibleForDevotional = (params: {
  type: DevotionalNotificationType
  moderationStatus: DevotionalModerationStatus
  publicationState: DevotionalPublicationState
}) => {
  if (
    params.type === DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL ||
    params.type === DevotionalNotificationType.FEATURED_DEVOTIONAL
  ) {
    return (
      params.moderationStatus === DevotionalModerationStatus.CLEAR &&
      [
        DevotionalPublicationState.PUBLISHED_LOW_REACH,
        DevotionalPublicationState.TRENDING,
        DevotionalPublicationState.FEATURED,
      ].some((state) => state === params.publicationState)
    )
  }

  if (
    params.type === DevotionalNotificationType.EDITOR_DEVOTIONAL_REVIEW_REQUIRED
  ) {
    return params.moderationStatus === DevotionalModerationStatus.UNDER_REVIEW
  }

  if (params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_APPROVED) {
    return params.moderationStatus === DevotionalModerationStatus.CLEAR
  }

  if (params.type === DevotionalNotificationType.AUTHOR_DEVOTIONAL_RESTRICTED) {
    return params.moderationStatus === DevotionalModerationStatus.RESTRICTED
  }

  return false
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
    author_moderation_notifications_enabled: boolean
    editor_review_notifications_enabled: boolean
  }
) => {
  const settings = await updateSettings(userId, {
    devotionalNotificationsEnabled: input.devotional_notifications_enabled,
    followedCreatorNotificationsEnabled:
      input.followed_creator_notifications_enabled,
    featuredDevotionalNotificationsEnabled:
      input.featured_devotional_notifications_enabled,
    authorModerationNotificationsEnabled:
      input.author_moderation_notifications_enabled,
    editorReviewNotificationsEnabled: input.editor_review_notifications_enabled,
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

  console.log('[DevotionalNotifications] Starting send', {
    devotionalId: devotional.id,
    authorId: devotional.authorId,
    type: params.type,
    publicationState: devotional.publicationState,
    moderationStatus: devotional.moderationStatus,
  })

  if (
    !isNotificationEligibleForDevotional({
      type: params.type,
      moderationStatus: devotional.moderationStatus,
      publicationState: devotional.publicationState,
    })
  ) {
    console.log('[DevotionalNotifications] Skipping send because devotional is not eligible', {
      devotionalId: devotional.id,
      type: params.type,
      publicationState: devotional.publicationState,
      moderationStatus: devotional.moderationStatus,
    })

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
  const imageUrl = await resolveImageUrl({
    devotionalId: devotional.id,
    value: devotional.imageUrl,
  })
  const now = new Date()

  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0
  let skippedByPreference = 0
  let skippedByCooldown = 0
  const failureCounts = new Map<string, number>()

  console.log('[DevotionalNotifications] Resolved audience', {
    devotionalId: devotional.id,
    type: params.type,
    targetUsers: userIds.length,
    eligibleDeviceTokens: deviceTokens.length,
    pushConfigured: config.notifications.isConfigured,
  })

  for (const deviceToken of deviceTokens) {
    if (
      !isPreferenceEnabled({
        settings: deviceToken.user.settings,
        type: params.type,
      })
    ) {
      skippedByPreference += 1
      continue
    }

    const cooldownEligible = await getCooldownEligibility({
      userId: deviceToken.userId,
      type: params.type,
      now,
    })
    if (!cooldownEligible) {
      skippedByCooldown += 1
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
    failureCounts.set(failureCode, (failureCounts.get(failureCode) ?? 0) + 1)
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

  console.log('[DevotionalNotifications] Completed send', {
    devotionalId: devotional.id,
    type: params.type,
    targetUsers: userIds.length,
    eligibleDeviceTokens: deviceTokens.length,
    skippedByPreference,
    skippedByCooldown,
    sent,
    providerAccepted,
    failed,
    tokenDeactivated,
    failureCodes: Object.fromEntries(failureCounts),
  })

  return {
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}
