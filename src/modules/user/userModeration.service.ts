import {
  DevotionalModerationActionType,
  Prisma,
  UserModerationActionType,
} from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'

export const USER_BLOCK_RECOMMENDATION_THRESHOLD = 3
export const USER_BLOCK_RECOMMENDATION_WINDOW_DAYS = 30

const userModerationActorSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  name: true,
  email: true,
})

export const userModerationSelect = Prisma.validator<Prisma.UserSelect>()({
  isBlocked: true,
  blockedReason: true,
  blockedAt: true,
  unblockedReason: true,
  unblockedAt: true,
  blockedByUser: {
    select: userModerationActorSelect,
  },
  unblockedByUser: {
    select: userModerationActorSelect,
  },
})

export type UserModerationSnapshot = Prisma.UserGetPayload<{
  select: typeof userModerationSelect
}>

type ModerationActor = {
  id: string
  name: string
  email: string
}

type FormattableUserModeration = {
  isBlocked: boolean
  blockedReason: string | null
  blockedAt: Date | null
  blockedByUser?: ModerationActor | null
  unblockedReason: string | null
  unblockedAt: Date | null
  unblockedByUser?: ModerationActor | null
}

const toIso = (value: Date | null | undefined) => (value ? value.toISOString() : null)

const formatModerationActor = (
  actor?: ModerationActor | null
) =>
  actor
    ? {
        id: actor.id,
        name: actor.name,
        email: actor.email,
      }
    : null

export const formatUserModeration = (user: FormattableUserModeration) => ({
  moderation: {
    is_blocked: user.isBlocked,
    blocked_reason: user.blockedReason,
    blocked_at: toIso(user.blockedAt),
    blocked_by: formatModerationActor(user.blockedByUser),
    unblocked_reason: user.unblockedReason,
    unblocked_at: toIso(user.unblockedAt),
    unblocked_by: formatModerationActor(user.unblockedByUser),
  },
})

export type AuthorBlockRecommendation = {
  restricted_devotionals_count_last_30_days: number
  threshold: number
  window_days: number
  threshold_met: boolean
  author_is_blocked: boolean
}

const getRecommendationWindowStart = () =>
  new Date(
    Date.now() - USER_BLOCK_RECOMMENDATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )

export const resolveAuthorBlockRecommendation = async (
  authorId: string
): Promise<AuthorBlockRecommendation> => {
  const [author, restrictedActions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: authorId },
      select: { isBlocked: true },
    }),
    prisma.devotionalModerationAction.findMany({
      where: {
        actionType: DevotionalModerationActionType.RESTRICT,
        createdAt: {
          gte: getRecommendationWindowStart(),
        },
        devotional: {
          authorId,
        },
      },
      select: {
        devotionalId: true,
      },
      distinct: ['devotionalId'],
    }),
  ])

  return {
    restricted_devotionals_count_last_30_days: restrictedActions.length,
    threshold: USER_BLOCK_RECOMMENDATION_THRESHOLD,
    window_days: USER_BLOCK_RECOMMENDATION_WINDOW_DAYS,
    threshold_met:
      restrictedActions.length >= USER_BLOCK_RECOMMENDATION_THRESHOLD,
    author_is_blocked: author?.isBlocked ?? false,
  }
}

export const resolveAuthorBlockRecommendations = async (authorIds: string[]) => {
  const uniqueAuthorIds = [...new Set(authorIds.filter(Boolean))]
  const recommendations = await Promise.all(
    uniqueAuthorIds.map(async (authorId) => [
      authorId,
      await resolveAuthorBlockRecommendation(authorId),
    ] as const)
  )

  return new Map(recommendations)
}

const moderationReturnSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  ...userModerationSelect,
})

export type ModeratedUserRecord = Prisma.UserGetPayload<{
  select: typeof moderationReturnSelect
}>

const getModeratedUserById = (
  tx: Prisma.TransactionClient,
  userId: string
) =>
  tx.user.findUnique({
    where: { id: userId },
    select: moderationReturnSelect,
  })

const addUserModerationAction = async (
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    actorId: string
    actionType: UserModerationActionType
    reason: string
  }
) => {
  await tx.userModerationAction.create({
    data: {
      userId: params.userId,
      actorId: params.actorId,
      actionType: params.actionType,
      reason: params.reason,
    },
  })
}

export const blockUser = async (params: {
  userId: string
  actorId: string
  reason: string
}) => {
  const reason = params.reason.trim()
  if (!reason) {
    throw new AppError('Debes indicar el motivo del bloqueo.', 'BLOCK_REASON_REQUIRED', 400)
  }

  if (params.userId === params.actorId) {
    throw new AppError('No puedes bloquear tu propia cuenta.', 'CANNOT_BLOCK_SELF', 400)
  }

  return prisma.$transaction(async (tx) => {
    const targetUser = await getModeratedUserById(tx, params.userId)

    if (!targetUser) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404)
    }

    if (targetUser.isBlocked) {
      throw new AppError('La cuenta ya está bloqueada.', 'USER_ALREADY_BLOCKED', 400)
    }

    const blockedAt = new Date()

    await addUserModerationAction(tx, {
      userId: params.userId,
      actorId: params.actorId,
      actionType: UserModerationActionType.BLOCK,
      reason,
    })

    return tx.user.update({
      where: { id: params.userId },
      data: {
        isBlocked: true,
        blockedReason: reason,
        blockedBy: params.actorId,
        blockedAt,
        unblockedReason: null,
        unblockedBy: null,
        unblockedAt: null,
      },
      select: moderationReturnSelect,
    })
  })
}

export const unblockUser = async (params: {
  userId: string
  actorId: string
  reason: string
}) => {
  const reason = params.reason.trim()
  if (!reason) {
    throw new AppError('Debes indicar el motivo del desbloqueo.', 'UNBLOCK_REASON_REQUIRED', 400)
  }

  if (params.userId === params.actorId) {
    throw new AppError('No puedes desbloquear tu propia cuenta.', 'CANNOT_UNBLOCK_SELF', 400)
  }

  return prisma.$transaction(async (tx) => {
    const targetUser = await getModeratedUserById(tx, params.userId)

    if (!targetUser) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404)
    }

    if (!targetUser.isBlocked) {
      throw new AppError('La cuenta no está bloqueada.', 'USER_NOT_BLOCKED', 400)
    }

    const unblockedAt = new Date()

    await addUserModerationAction(tx, {
      userId: params.userId,
      actorId: params.actorId,
      actionType: UserModerationActionType.UNBLOCK,
      reason,
    })

    return tx.user.update({
      where: { id: params.userId },
      data: {
        isBlocked: false,
        unblockedReason: reason,
        unblockedBy: params.actorId,
        unblockedAt,
      },
      select: moderationReturnSelect,
    })
  })
}
