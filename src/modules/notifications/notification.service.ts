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
import { reconcileUserStreak } from '../devotionals/devotionalEngagement.service'
import {
  resolveDailyFeaturedForUser,
  resolveUserLocalDayContext,
} from '../devotionals/devotionalPersonalization.service'
import { ensureSettings, updateSettings } from '../user/userSettings.service'
import {
  devotionalNotificationPolicy,
  resolveDailyReminderCopy,
  resolveStreakMilestoneCopy,
  resolveWinbackCopy,
} from '../devotionals/devotional.policy'
import { sendPushMessage } from './notification.provider'
import { formatNotificationPreferences } from './notificationPreferences'
import { getDailyVerseForUser } from '../verse/verse.service'

const SENDABLE_PERMISSION_STATUSES = [
  DeviceOsPermissionStatus.AUTHORIZED,
  DeviceOsPermissionStatus.PROVISIONAL,
] as const

const buildNotificationBody = (devotional: { title: string; author: { name: string } }) => ({
  [DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL]: {
    title: devotionalNotificationPolicy.titleTemplates.followedCreator,
    body: `${devotional.author.name} compartió "${devotional.title}".`,
  },
  [DevotionalNotificationType.FEATURED_DEVOTIONAL]: {
    title: devotionalNotificationPolicy.titleTemplates.featured,
    body: devotional.title,
  },
  [DevotionalNotificationType.STREAK_AT_RISK]: {
    title: devotionalNotificationPolicy.titleTemplates.streakRisk,
    body: `Retoma "${devotional.title}" y protege tu racha de hoy.`,
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
  // Unused fallbacks: DAILY_REMINDER, STREAK_MILESTONE and WINBACK never route
  // through sendDevotionalNotifications — each has a bespoke sender that builds
  // its own copy (see sendStreakRiskNotifications / sendDailyReminderNotifications).
  // These entries only keep this map exhaustive over DevotionalNotificationType.
  [DevotionalNotificationType.DAILY_REMINDER]: {
    title: 'Tu momento con Dios te espera',
    body: devotional.title,
  },
  [DevotionalNotificationType.STREAK_MILESTONE]: {
    title: '¡Nueva racha alcanzada!',
    body: devotional.title,
  },
  [DevotionalNotificationType.WINBACK]: {
    title: 'Te extrañamos',
    body: devotional.title,
  },
})

const isSuppressedCreatorNotificationType = (type: DevotionalNotificationType) =>
  type === DevotionalNotificationType.FOLLOWED_CREATOR_NEW_DEVOTIONAL ||
  type === DevotionalNotificationType.FEATURED_DEVOTIONAL

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

const incrementNotificationEvaluationMetrics = async (params: {
  date: string
  type: DevotionalNotificationType
  evaluatedCount: number
  eligibleCount: number
  skippedCount: number
}) => {
  if (
    params.evaluatedCount === 0 &&
    params.eligibleCount === 0 &&
    params.skippedCount === 0
  ) {
    return
  }

  await prisma.$executeRaw`
    INSERT INTO devotional_notification_evaluation_daily_metrics (
      date,
      notification_type,
      evaluated_count,
      eligible_count,
      skipped_count,
      created_at,
      updated_at
    )
    VALUES (
      ${params.date},
      ${params.type},
      ${params.evaluatedCount},
      ${params.eligibleCount},
      ${params.skippedCount},
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      evaluated_count = evaluated_count + VALUES(evaluated_count),
      eligible_count = eligible_count + VALUES(eligible_count),
      skipped_count = skipped_count + VALUES(skipped_count),
      updated_at = NOW()
  `
}

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
        config.engagement.notifications.featuredCooldownHours * 60 * 60 * 1000
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
    streakRiskNotificationsEnabled: boolean
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

  if (params.type === DevotionalNotificationType.STREAK_AT_RISK) {
    return (
      settings?.devotionalNotificationsEnabled === true &&
      settings.streakRiskNotificationsEnabled
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
    params.type === DevotionalNotificationType.FEATURED_DEVOTIONAL ||
    params.type === DevotionalNotificationType.STREAK_AT_RISK
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
    streak_risk_notifications_enabled: boolean
    author_moderation_notifications_enabled: boolean
    editor_review_notifications_enabled: boolean
    social_activity_notifications_enabled: boolean
    comment_notifications_enabled: boolean
    follow_notifications_enabled: boolean
    reaction_notifications_enabled: boolean
    daily_reminder_hour: number | null
    daily_reminder_notifications_enabled: boolean
    streak_milestone_notifications_enabled: boolean
    winback_notifications_enabled: boolean
  }
) => {
  const settings = await updateSettings(userId, {
    devotionalNotificationsEnabled: input.devotional_notifications_enabled,
    followedCreatorNotificationsEnabled:
      input.followed_creator_notifications_enabled,
    featuredDevotionalNotificationsEnabled:
      input.featured_devotional_notifications_enabled,
    streakRiskNotificationsEnabled: input.streak_risk_notifications_enabled,
    authorModerationNotificationsEnabled:
      input.author_moderation_notifications_enabled,
    editorReviewNotificationsEnabled: input.editor_review_notifications_enabled,
    socialActivityNotificationsEnabled:
      input.social_activity_notifications_enabled,
    commentNotificationsEnabled: input.comment_notifications_enabled,
    followNotificationsEnabled: input.follow_notifications_enabled,
    reactionNotificationsEnabled: input.reaction_notifications_enabled,
    dailyReminderHour: input.daily_reminder_hour,
    dailyReminderNotificationsEnabled:
      input.daily_reminder_notifications_enabled,
    streakMilestoneNotificationsEnabled:
      input.streak_milestone_notifications_enabled,
    winbackNotificationsEnabled: input.winback_notifications_enabled,
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
          suppressCreatorNotifications: true,
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
    suppressCreatorNotifications: devotional.author.suppressCreatorNotifications,
  })

  if (
    devotional.author.suppressCreatorNotifications &&
    isSuppressedCreatorNotificationType(params.type)
  ) {
    console.log('[DevotionalNotifications] Skipping send because author notifications are suppressed', {
      devotionalId: devotional.id,
      authorId: devotional.authorId,
      type: params.type,
    })

    return {
      sent: 0,
      provider_accepted: 0,
      failed: 0,
      token_deactivated: 0,
    }
  }

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

  await incrementNotificationEvaluationMetrics({
    date: now.toISOString().slice(0, 10),
    type: params.type,
    evaluatedCount: deviceTokens.length,
    eligibleCount: sent,
    skippedCount: skippedByPreference + skippedByCooldown,
  })

  return {
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}

export const sendStreakRiskNotifications = async (now = new Date()) => {
  let processedUsers = 0
  let eligibleUsers = 0
  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0
  let cursorUserId: string | undefined
  const evaluationMetricsByDate = new Map<
    string,
    {
      evaluatedCount: number
      eligibleCount: number
      skippedCount: number
    }
  >()

  while (true) {
    const streaks = await prisma.userStreak.findMany({
      where: {
        currentStreak: {
          gte: 2,
        },
      },
      orderBy: {
        userId: 'asc',
      },
      take: 100,
      ...(cursorUserId
        ? {
            cursor: { userId: cursorUserId },
            skip: 1,
          }
        : {}),
      select: { userId: true },
    })

    if (streaks.length === 0) {
      break
    }

    for (const streak of streaks) {
      processedUsers += 1

      const reconciled = await reconcileUserStreak({ userId: streak.userId })
      if (reconciled.currentStreak < 2) {
        continue
      }

      const context = await resolveUserLocalDayContext(prisma, streak.userId, now)
      const dailyMetric =
        evaluationMetricsByDate.get(context.localToday) ?? {
          evaluatedCount: 0,
          eligibleCount: 0,
          skippedCount: 0,
        }
      dailyMetric.evaluatedCount += 1
      evaluationMetricsByDate.set(context.localToday, dailyMetric)

      if (
        context.localHour <
        config.engagement.notifications.streakRiskSendAfterLocalHour
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      const deviceTokens = await listEligibleDeviceTokens([streak.userId])
      if (deviceTokens.length === 0) {
        dailyMetric.skippedCount += 1
        continue
      }

      const settings = deviceTokens[0]?.user.settings
      if (
        !settings ||
        settings.devotionalNotificationsEnabled !== true ||
        settings.streakRiskNotificationsEnabled !== true
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      const completedTodayCount = await prisma.devotionalReadComplete.count({
        where: {
          userId: streak.userId,
          createdAt: {
            gte: context.dayWindowStart,
            lt: context.nextDayWindowStart,
          },
        },
      })
      if (completedTodayCount > 0) {
        dailyMetric.skippedCount += 1
        continue
      }

      const acceptedToday = await prisma.devotionalNotificationSend.count({
        where: {
          userId: streak.userId,
          type: DevotionalNotificationType.STREAK_AT_RISK,
          providerAcceptedAt: {
            gte: context.dayWindowStart,
            lt: context.nextDayWindowStart,
          },
        },
      })
      if (acceptedToday > 0) {
        dailyMetric.skippedCount += 1
        continue
      }

      const dailyFeatured = await resolveDailyFeaturedForUser({
        userId: streak.userId,
        now,
      })
      if (!dailyFeatured) {
        dailyMetric.skippedCount += 1
        continue
      }

      const devotional = await prisma.devotional.findUnique({
        where: { id: dailyFeatured.devotional.id },
        include: {
          author: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      if (
        !devotional ||
        !isNotificationEligibleForDevotional({
          type: DevotionalNotificationType.STREAK_AT_RISK,
          moderationStatus: devotional.moderationStatus,
          publicationState: devotional.publicationState,
        })
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      eligibleUsers += 1
      dailyMetric.eligibleCount += 1
      const messageTemplates = buildNotificationBody(devotional)
      const payload = messageTemplates[DevotionalNotificationType.STREAK_AT_RISK]
      const imageUrl = await resolveImageUrl({
        devotionalId: devotional.id,
        value: devotional.imageUrl,
      })

      for (const deviceToken of deviceTokens) {
        const createdSend = await prisma.devotionalNotificationSend.create({
          data: {
            devotionalId: devotional.id,
            userId: deviceToken.userId,
            deviceTokenId: deviceToken.id,
            type: DevotionalNotificationType.STREAK_AT_RISK,
            title: payload.title,
            body: payload.body,
            imageUrl,
            payload: {
              type: DevotionalNotificationType.STREAK_AT_RISK,
              title: payload.title,
              body: payload.body,
              devotional_id: devotional.id,
              image_url: imageUrl,
              local_date: context.localToday,
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
            type: DevotionalNotificationType.STREAK_AT_RISK,
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
    }

    cursorUserId = streaks[streaks.length - 1]?.userId
  }

  for (const [date, metric] of evaluationMetricsByDate.entries()) {
    await incrementNotificationEvaluationMetrics({
      date,
      type: DevotionalNotificationType.STREAK_AT_RISK,
      evaluatedCount: metric.evaluatedCount,
      eligibleCount: metric.eligibleCount,
      skippedCount: metric.skippedCount,
    })
  }

  console.log('[DevotionalNotifications] Completed streak-risk send', {
    processedUsers,
    eligibleUsers,
    sent,
    providerAccepted,
    failed,
    tokenDeactivated,
  })

  return {
    processed_users: processedUsers,
    eligible_users: eligibleUsers,
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}

export const isDailyReminderHourDue = (params: {
  localHour: number
  reminderHour: number
}): boolean => params.localHour === params.reminderHour

export const isDailyReminderPreferenceEnabled = (
  settings: { dailyReminderNotificationsEnabled: boolean } | null | undefined
): boolean => settings?.dailyReminderNotificationsEnabled === true

export const isDailyReminderAlreadySentToday = (
  reminderSentTodayCount: number
): boolean => reminderSentTodayCount > 0

export const isDailyReminderDaySuppressedByCompletion = (params: {
  lastCompletedDate: string | null | undefined
  localToday: string
}): boolean => params.lastCompletedDate === params.localToday

export const isDailyReminderSuppressedByStreakRisk = (
  streakRiskSentTodayCount: number
): boolean => streakRiskSentTodayCount > 0

export const isDailyReminderSuppressedByWinbackPause = (
  pausedAt: Date | null | undefined
): boolean => Boolean(pausedAt)

export const hasDailyFeaturedDevotional = <T>(
  dailyFeatured: T | null | undefined
): dailyFeatured is T => Boolean(dailyFeatured)

export const sendDailyReminderNotifications = async (now = new Date()) => {
  let processedUsers = 0
  let eligibleUsers = 0
  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0
  let cursorId: number | undefined
  const evaluationMetricsByDate = new Map<
    string,
    {
      evaluatedCount: number
      eligibleCount: number
      skippedCount: number
    }
  >()

  while (true) {
    const settingsBatch = await prisma.userSettings.findMany({
      where: {
        dailyReminderNotificationsEnabled: true,
        dailyReminderHour: {
          not: null,
        },
      },
      orderBy: {
        id: 'asc',
      },
      take: 100,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
      select: { id: true, userId: true, dailyReminderHour: true },
    })

    if (settingsBatch.length === 0) {
      break
    }

    for (const settingsRow of settingsBatch) {
      processedUsers += 1
      cursorId = settingsRow.id

      const reminderHour = settingsRow.dailyReminderHour
      if (reminderHour == null) {
        continue
      }

      const context = await resolveUserLocalDayContext(
        prisma,
        settingsRow.userId,
        now
      )
      const dailyMetric =
        evaluationMetricsByDate.get(context.localToday) ?? {
          evaluatedCount: 0,
          eligibleCount: 0,
          skippedCount: 0,
        }
      dailyMetric.evaluatedCount += 1
      evaluationMetricsByDate.set(context.localToday, dailyMetric)

      if (
        !isDailyReminderHourDue({
          localHour: context.localHour,
          reminderHour,
        })
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      const deviceTokens = await listEligibleDeviceTokens([
        settingsRow.userId,
      ])
      if (deviceTokens.length === 0) {
        dailyMetric.skippedCount += 1
        continue
      }

      const settings = deviceTokens[0]?.user.settings
      if (!isDailyReminderPreferenceEnabled(settings)) {
        dailyMetric.skippedCount += 1
        continue
      }

      const reminderSentToday = await prisma.devotionalNotificationSend.count(
        {
          where: {
            userId: settingsRow.userId,
            type: DevotionalNotificationType.DAILY_REMINDER,
            providerAcceptedAt: {
              gte: context.dayWindowStart,
              lt: context.nextDayWindowStart,
            },
          },
        }
      )
      if (isDailyReminderAlreadySentToday(reminderSentToday)) {
        dailyMetric.skippedCount += 1
        continue
      }

      const streak = await prisma.userStreak.findUnique({
        where: { userId: settingsRow.userId },
        select: { currentStreak: true, lastCompletedDate: true },
      })
      if (
        isDailyReminderDaySuppressedByCompletion({
          lastCompletedDate: streak?.lastCompletedDate,
          localToday: context.localToday,
        })
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      const streakRiskSentToday =
        await prisma.devotionalNotificationSend.count({
          where: {
            userId: settingsRow.userId,
            type: DevotionalNotificationType.STREAK_AT_RISK,
            providerAcceptedAt: {
              gte: context.dayWindowStart,
              lt: context.nextDayWindowStart,
            },
          },
        })
      if (isDailyReminderSuppressedByStreakRisk(streakRiskSentToday)) {
        dailyMetric.skippedCount += 1
        continue
      }

      const winbackState = await prisma.userWinbackState.findUnique({
        where: { userId: settingsRow.userId },
        select: { pausedAt: true },
      })
      if (isDailyReminderSuppressedByWinbackPause(winbackState?.pausedAt)) {
        dailyMetric.skippedCount += 1
        continue
      }

      const dailyFeatured = await resolveDailyFeaturedForUser({
        userId: settingsRow.userId,
        now,
      })
      if (!hasDailyFeaturedDevotional(dailyFeatured)) {
        dailyMetric.skippedCount += 1
        continue
      }

      eligibleUsers += 1
      dailyMetric.eligibleCount += 1

      const devotionalId = dailyFeatured.devotional.id
      const imageUrl = await resolveImageUrl({
        devotionalId,
        value: dailyFeatured.devotional.preview_image_url,
      })
      const copy = resolveDailyReminderCopy({
        name: deviceTokens[0].user.name,
        streak: streak?.currentStreak ?? 0,
      })

      for (const deviceToken of deviceTokens) {
        const createdSend = await prisma.devotionalNotificationSend.create({
          data: {
            devotionalId,
            userId: deviceToken.userId,
            deviceTokenId: deviceToken.id,
            type: DevotionalNotificationType.DAILY_REMINDER,
            title: copy.title,
            body: copy.body,
            imageUrl,
            payload: {
              type: DevotionalNotificationType.DAILY_REMINDER,
              title: copy.title,
              body: copy.body,
              devotional_id: devotionalId,
              image_url: imageUrl,
              local_date: context.localToday,
            },
          },
        })

        sent += 1

        const providerResult = await sendPushMessage({
          token: deviceToken.token,
          title: copy.title,
          body: copy.body,
          imageUrl,
          data: {
            type: DevotionalNotificationType.DAILY_REMINDER,
            title: copy.title,
            body: copy.body,
            devotional_id: devotionalId,
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
    }
  }

  for (const [date, metric] of evaluationMetricsByDate.entries()) {
    await incrementNotificationEvaluationMetrics({
      date,
      type: DevotionalNotificationType.DAILY_REMINDER,
      evaluatedCount: metric.evaluatedCount,
      eligibleCount: metric.eligibleCount,
      skippedCount: metric.skippedCount,
    })
  }

  console.log('[DevotionalNotifications] Completed daily reminder send', {
    processedUsers,
    eligibleUsers,
    sent,
    providerAccepted,
    failed,
    tokenDeactivated,
  })

  return {
    processed_users: processedUsers,
    eligible_users: eligibleUsers,
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}

export const isStreakMilestonePreferenceEnabled = (
  settings: { streakMilestoneNotificationsEnabled: boolean } | null | undefined
): boolean => settings?.streakMilestoneNotificationsEnabled === true

// Combines both gates the milestone push must pass: it must be the first time
// the milestone was ever reached (re-reaches after a streak reset never push,
// only re-celebrate in-app) AND the user must have milestone notifications enabled.
export const shouldSendStreakMilestonePush = (params: {
  isFirstReach: boolean
  settings: { streakMilestoneNotificationsEnabled: boolean } | null | undefined
}): boolean =>
  params.isFirstReach && isStreakMilestonePreferenceEnabled(params.settings)

// Sends the one-time STREAK_MILESTONE congratulation push. Must be called
// strictly AFTER the streak transaction that detected the milestone has
// committed (never from inside that transaction callback) — see
// applyReadCompleteEngagement in devotionalEngagement.service.ts, whose
// milestoneReached signal drives the `isFirstReach` param here.
export const sendStreakMilestoneNotification = async (params: {
  userId: string
  milestone: number
  devotionalId: string
  isFirstReach: boolean
}) => {
  if (!params.isFirstReach) {
    return { sent: 0, provider_accepted: 0, failed: 0, token_deactivated: 0 }
  }

  const deviceTokens = await listEligibleDeviceTokens([params.userId])
  if (deviceTokens.length === 0) {
    return { sent: 0, provider_accepted: 0, failed: 0, token_deactivated: 0 }
  }

  const settings = deviceTokens[0]?.user.settings
  if (
    !shouldSendStreakMilestonePush({
      isFirstReach: params.isFirstReach,
      settings,
    })
  ) {
    return { sent: 0, provider_accepted: 0, failed: 0, token_deactivated: 0 }
  }

  const copy = resolveStreakMilestoneCopy(params.milestone)

  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0

  for (const deviceToken of deviceTokens) {
    const createdSend = await prisma.devotionalNotificationSend.create({
      data: {
        devotionalId: params.devotionalId,
        userId: deviceToken.userId,
        deviceTokenId: deviceToken.id,
        type: DevotionalNotificationType.STREAK_MILESTONE,
        title: copy.title,
        body: copy.body,
        imageUrl: null,
        payload: {
          type: DevotionalNotificationType.STREAK_MILESTONE,
          title: copy.title,
          body: copy.body,
          devotional_id: params.devotionalId,
          milestone: params.milestone,
        },
      },
    })

    sent += 1

    const providerResult = await sendPushMessage({
      token: deviceToken.token,
      title: copy.title,
      body: copy.body,
      imageUrl: null,
      data: {
        type: DevotionalNotificationType.STREAK_MILESTONE,
        title: copy.title,
        body: copy.body,
        devotional_id: params.devotionalId,
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

  console.log('[DevotionalNotifications] Completed milestone push', {
    userId: params.userId,
    milestone: params.milestone,
    sent,
    providerAccepted,
    failed,
    tokenDeactivated,
  })

  return {
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}

// --- Win-back ladder predicates (pure) -------------------------------------
// Extracted so unit tests (task 5.3) can exercise ladder/window/spacing logic
// without hitting Prisma, following the sendDailyReminderNotifications seam.

export const hasEverHadAppSession = (
  lastSessionAt: Date | null | undefined
): boolean => Boolean(lastSessionAt)

export const isWinbackPaused = (
  pausedAt: Date | null | undefined
): boolean => Boolean(pausedAt)

export const isWinbackPreferenceEnabled = (
  settings: { winbackNotificationsEnabled: boolean } | null | undefined
): boolean => settings?.winbackNotificationsEnabled === true

// Highest step in stepDays (ascending, e.g. [3, 7, 14]) whose threshold has
// been crossed by daysSinceLastSession, or null if none has been crossed yet.
export const resolveWinbackStep = (params: {
  daysSinceLastSession: number
  stepDays: readonly number[]
}): number | null => {
  let matchedStep: number | null = null
  for (const step of params.stepDays) {
    if (params.daysSinceLastSession >= step) {
      matchedStep = step
    }
  }
  return matchedStep
}

export const isWinbackLocalWindowOpen = (params: {
  localHour: number
  windowStartLocalHour: number
  windowEndLocalHour: number
}): boolean =>
  params.localHour >= params.windowStartLocalHour &&
  params.localHour < params.windowEndLocalHour

export const isWinbackStepMonotonic = (params: {
  lastStepSent: number
  step: number
}): boolean => params.lastStepSent < params.step

export const isWinbackSpacingSatisfied = (params: {
  lastSentAt: Date | null | undefined
  now: Date
  minHoursBetweenSends: number
}): boolean => {
  if (!params.lastSentAt) {
    return true
  }

  const elapsedHours =
    (params.now.getTime() - params.lastSentAt.getTime()) / (60 * 60 * 1000)

  return elapsedHours >= params.minHoursBetweenSends
}

const computeDaysSinceLastSession = (params: {
  lastSessionAt: Date
  now: Date
}): number =>
  Math.floor(
    (params.now.getTime() - params.lastSessionAt.getTime()) /
      (24 * 60 * 60 * 1000)
  )

export const sendWinbackNotifications = async (now = new Date()) => {
  const winbackPolicy = config.engagement.notifications.winback
  let processedUsers = 0
  let eligibleUsers = 0
  let sent = 0
  let providerAccepted = 0
  let failed = 0
  let tokenDeactivated = 0
  let cursorId: number | undefined
  const evaluationMetricsByDate = new Map<
    string,
    {
      evaluatedCount: number
      eligibleCount: number
      skippedCount: number
    }
  >()

  while (true) {
    const settingsBatch = await prisma.userSettings.findMany({
      where: {
        winbackNotificationsEnabled: true,
      },
      orderBy: {
        id: 'asc',
      },
      take: 100,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
      select: { id: true, userId: true },
    })

    if (settingsBatch.length === 0) {
      break
    }

    for (const settingsRow of settingsBatch) {
      processedUsers += 1
      cursorId = settingsRow.id

      const context = await resolveUserLocalDayContext(
        prisma,
        settingsRow.userId,
        now
      )
      const dailyMetric =
        evaluationMetricsByDate.get(context.localToday) ?? {
          evaluatedCount: 0,
          eligibleCount: 0,
          skippedCount: 0,
        }
      dailyMetric.evaluatedCount += 1
      evaluationMetricsByDate.set(context.localToday, dailyMetric)

      const lastSession = await prisma.appSessionEvent.findFirst({
        where: { userId: settingsRow.userId },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      })
      if (!hasEverHadAppSession(lastSession?.occurredAt)) {
        dailyMetric.skippedCount += 1
        continue
      }

      const winbackState = await prisma.userWinbackState.findUnique({
        where: { userId: settingsRow.userId },
      })
      if (isWinbackPaused(winbackState?.pausedAt)) {
        dailyMetric.skippedCount += 1
        continue
      }

      const daysSinceLastSession = computeDaysSinceLastSession({
        lastSessionAt: lastSession!.occurredAt,
        now,
      })
      const step = resolveWinbackStep({
        daysSinceLastSession,
        stepDays: winbackPolicy.stepDays,
      })
      if (step === null) {
        dailyMetric.skippedCount += 1
        continue
      }

      if (
        !isWinbackStepMonotonic({
          lastStepSent: winbackState?.lastStepSent ?? 0,
          step,
        })
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      if (
        !isWinbackSpacingSatisfied({
          lastSentAt: winbackState?.lastSentAt,
          now,
          minHoursBetweenSends: winbackPolicy.minHoursBetweenSends,
        })
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      if (
        !isWinbackLocalWindowOpen({
          localHour: context.localHour,
          windowStartLocalHour: winbackPolicy.windowStartLocalHour,
          windowEndLocalHour: winbackPolicy.windowEndLocalHour,
        })
      ) {
        dailyMetric.skippedCount += 1
        continue
      }

      const deviceTokens = await listEligibleDeviceTokens([
        settingsRow.userId,
      ])
      if (deviceTokens.length === 0) {
        dailyMetric.skippedCount += 1
        continue
      }

      const settings = deviceTokens[0]?.user.settings
      if (!isWinbackPreferenceEnabled(settings)) {
        dailyMetric.skippedCount += 1
        continue
      }

      const dailyFeatured = await resolveDailyFeaturedForUser({
        userId: settingsRow.userId,
        now,
      })
      if (!hasDailyFeaturedDevotional(dailyFeatured)) {
        // Null-featured-devotional skip must NOT advance ladder state, so no
        // UserWinbackState write happens on this path.
        dailyMetric.skippedCount += 1
        continue
      }

      eligibleUsers += 1
      dailyMetric.eligibleCount += 1

      const devotionalId = dailyFeatured.devotional.id
      const imageUrl = await resolveImageUrl({
        devotionalId,
        value: dailyFeatured.devotional.preview_image_url,
      })

      let verseText: string | null = null
      if (step === 3) {
        const dailyVerse = await getDailyVerseForUser(settingsRow.userId)
        verseText = `${dailyVerse.text} (${dailyVerse.reference})`
      }

      const copy = resolveWinbackCopy({
        step,
        name: deviceTokens[0].user.name,
        verseText,
      })

      for (const deviceToken of deviceTokens) {
        const createdSend = await prisma.devotionalNotificationSend.create({
          data: {
            devotionalId,
            userId: deviceToken.userId,
            deviceTokenId: deviceToken.id,
            type: DevotionalNotificationType.WINBACK,
            title: copy.title,
            body: copy.body,
            imageUrl,
            payload: {
              type: DevotionalNotificationType.WINBACK,
              title: copy.title,
              body: copy.body,
              devotional_id: devotionalId,
              image_url: imageUrl,
              step,
              local_date: context.localToday,
            },
          },
        })

        sent += 1

        const providerResult = await sendPushMessage({
          token: deviceToken.token,
          title: copy.title,
          body: copy.body,
          imageUrl,
          data: {
            type: DevotionalNotificationType.WINBACK,
            title: copy.title,
            body: copy.body,
            devotional_id: devotionalId,
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

      await prisma.userWinbackState.upsert({
        where: { userId: settingsRow.userId },
        create: {
          userId: settingsRow.userId,
          lastStepSent: step,
          lastSentAt: now,
          pausedAt: step === 14 ? now : null,
        },
        update: {
          lastStepSent: step,
          lastSentAt: now,
          pausedAt: step === 14 ? now : null,
        },
      })
    }
  }

  for (const [date, metric] of evaluationMetricsByDate.entries()) {
    await incrementNotificationEvaluationMetrics({
      date,
      type: DevotionalNotificationType.WINBACK,
      evaluatedCount: metric.evaluatedCount,
      eligibleCount: metric.eligibleCount,
      skippedCount: metric.skippedCount,
    })
  }

  console.log('[DevotionalNotifications] Completed win-back send', {
    processedUsers,
    eligibleUsers,
    sent,
    providerAccepted,
    failed,
    tokenDeactivated,
  })

  return {
    processed_users: processedUsers,
    eligible_users: eligibleUsers,
    sent,
    provider_accepted: providerAccepted,
    failed,
    token_deactivated: tokenDeactivated,
  }
}
