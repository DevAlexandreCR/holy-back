import { promises as fs } from 'fs'
import path from 'path'
import {
  CreatorAvatarAsset,
  DevotionalImageAssetStatus,
  DevotionalImageModerationStatus,
  Prisma,
} from '@prisma/client'
import { prisma } from '../../config/db'
import { AppError } from '../../common/errors'
import { devotionalFeedPolicy } from '../devotionals/devotional.policy'

const normalizeStorageUrl = (value?: string | null) => {
  if (!value) {
    return null
  }

  if (value.startsWith('/storage/')) {
    return value
  }

  try {
    const parsed = new URL(value)
    if (parsed.pathname.startsWith('/storage/')) {
      return parsed.pathname
    }
  } catch {}

  return value
}

const formatProfile = (
  user: {
    id: string
    name: string
    handle: string | null
    creatorBio: string | null
    creatorAvatarUrl: string | null
    followersCount: number
    followingCount: number
  },
  params: {
    followedByMe: boolean
    publishedDevotionalsCount: number
  }
) => ({
  id: user.id,
  handle: user.handle,
  name: user.name,
  bio: user.creatorBio,
  avatar_url: normalizeStorageUrl(user.creatorAvatarUrl),
  followers_count: user.followersCount,
  following_count: user.followingCount,
  followed_by_me: params.followedByMe,
  published_devotionals_count: params.publishedDevotionalsCount,
})

const normalizeHandle = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/[._]{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')

  if (
    normalized.length < devotionalFeedPolicy.profile.handleMinLength ||
    normalized.length > devotionalFeedPolicy.profile.handleMaxLength
  ) {
    throw new AppError('Handle is invalid', 'INVALID_HANDLE', 400)
  }

  return normalized
}

const ensureCreatorExists = async (creatorId: string) => {
  const user = await prisma.user.findFirst({
    where: {
      id: creatorId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      handle: true,
      creatorBio: true,
      creatorAvatarUrl: true,
      followersCount: true,
      followingCount: true,
    },
  })

  if (!user) {
    throw new AppError('User not found', 'USER_NOT_FOUND', 404)
  }

  return user
}

const resolvePublishedDevotionalsCount = (creatorId: string) =>
  prisma.devotional.count({
    where: {
      authorId: creatorId,
      publicationState: {
        in: ['PUBLISHED_LOW_REACH', 'TRENDING', 'FEATURED'],
      },
      moderationStatus: 'CLEAR',
      author: {
        isBlocked: false,
      },
    },
  })

const resolveFollowedByMe = async (viewerId: string, creatorId: string) => {
  if (viewerId === creatorId) {
    return false
  }

  const follow = await prisma.userFollow.findUnique({
    where: {
      followerId_followedId: {
        followerId: viewerId,
        followedId: creatorId,
      },
    },
    select: { id: true },
  })

  return follow != null
}

const ensureAttachableAvatarAsset = async (
  tx: Prisma.TransactionClient,
  userId: string,
  avatarAssetId?: string | null
) => {
  if (!avatarAssetId) {
    return null
  }

  const asset = await tx.creatorAvatarAsset.findUnique({
    where: { id: avatarAssetId },
  })

  if (!asset || asset.userId !== userId) {
    throw new AppError('Avatar asset not found', 'AVATAR_ASSET_NOT_FOUND', 404)
  }

  if (
    asset.status !== DevotionalImageAssetStatus.ATTACHABLE &&
    asset.status !== DevotionalImageAssetStatus.USED
  ) {
    throw new AppError(
      'Avatar asset is not attachable',
      'AVATAR_ASSET_NOT_ATTACHABLE',
      400
    )
  }

  if (
    asset.imageModerationStatus !== DevotionalImageModerationStatus.APPROVED
  ) {
    throw new AppError('Avatar asset was rejected', 'AVATAR_ASSET_REJECTED', 400)
  }

  if (asset.expiresAt != null && asset.expiresAt.getTime() <= Date.now()) {
    throw new AppError('Avatar asset expired', 'AVATAR_ASSET_EXPIRED', 400)
  }

  return asset
}

const ensurePermanentAvatar = async (
  tx: Prisma.TransactionClient,
  asset: CreatorAvatarAsset
) => {
  if (asset.permanentUrl) {
    await tx.creatorAvatarAsset.update({
      where: { id: asset.id },
      data: {
        status: DevotionalImageAssetStatus.USED,
        usedAt: asset.usedAt ?? new Date(),
      },
    })

    return normalizeStorageUrl(asset.permanentUrl)
  }

  const extension = path.extname(asset.tempPath) || '.webp'
  const filename = `${asset.id}${extension}`
  const permanentDir = path.join(process.cwd(), 'storage', 'users', 'avatars')
  const permanentPath = path.join(permanentDir, filename)
  const permanentUrl = `/storage/users/avatars/${filename}`

  await fs.mkdir(permanentDir, { recursive: true })
  await fs.rename(asset.tempPath, permanentPath)

  await tx.creatorAvatarAsset.update({
    where: { id: asset.id },
    data: {
      status: DevotionalImageAssetStatus.USED,
      permanentPath,
      permanentUrl,
      usedAt: new Date(),
    },
  })

  return permanentUrl
}

export const getCreatorProfile = async (params: {
  viewerId: string
  creatorId: string
}) => {
  const [user, followedByMe, publishedDevotionalsCount] = await Promise.all([
    ensureCreatorExists(params.creatorId),
    resolveFollowedByMe(params.viewerId, params.creatorId),
    resolvePublishedDevotionalsCount(params.creatorId),
  ])

  return formatProfile(user, {
    followedByMe,
    publishedDevotionalsCount,
  })
}

export const updateMyCreatorProfile = async (params: {
  userId: string
  handle?: string
  bio?: string | null
  avatarAssetId?: string | null
  avatarAssetProvided: boolean
}) => {
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: {
          id: true,
          name: true,
          handle: true,
          creatorBio: true,
          creatorAvatarUrl: true,
          followersCount: true,
          followingCount: true,
        },
      })

      if (!user) {
        throw new AppError('User not found', 'USER_NOT_FOUND', 404)
      }

      const data: Prisma.UserUpdateInput = {
        creatorProfileUpdatedAt: new Date(),
      }

      if (params.handle !== undefined) {
        data.handle = normalizeHandle(params.handle)
      }

      if (params.bio !== undefined) {
        data.creatorBio = params.bio?.trim() ? params.bio.trim() : null
      }

      let avatarAttachmentError: { message: string; code: string } | null = null

      if (params.avatarAssetProvided) {
        if (params.avatarAssetId === null) {
          data.creatorAvatarUrl = null
        } else if (params.avatarAssetId) {
          try {
            const avatarAsset = await ensureAttachableAvatarAsset(
              tx,
              params.userId,
              params.avatarAssetId
            )

            if (avatarAsset) {
              data.creatorAvatarUrl = await ensurePermanentAvatar(tx, avatarAsset)
            }
          } catch (error) {
            if (error instanceof AppError) {
              avatarAttachmentError = {
                message: error.message,
                code: error.code,
              }
            } else {
              throw error
            }
          }
        }
      }

      const updated = await tx.user.update({
        where: { id: params.userId },
        data,
        select: {
          id: true,
          name: true,
          handle: true,
          creatorBio: true,
          creatorAvatarUrl: true,
          followersCount: true,
          followingCount: true,
        },
      })

      const publishedDevotionalsCount = await tx.devotional.count({
        where: {
          authorId: params.userId,
          publicationState: {
            in: ['PUBLISHED_LOW_REACH', 'TRENDING', 'FEATURED'],
          },
          moderationStatus: 'CLEAR',
          author: {
            isBlocked: false,
          },
        },
      })

      return {
        profile: formatProfile(updated, {
          followedByMe: false,
          publishedDevotionalsCount,
        }),
        avatarAttachmentError,
      }
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('Handle is already taken', 'HANDLE_ALREADY_TAKEN', 409)
    }

    throw error
  }
}

export const followCreator = async (params: {
  followerId: string
  creatorId: string
}) => {
  if (params.followerId === params.creatorId) {
    throw new AppError('You cannot follow yourself', 'FOLLOW_SELF_FORBIDDEN', 400)
  }

  await ensureCreatorExists(params.creatorId)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.userFollow.findUnique({
      where: {
        followerId_followedId: {
          followerId: params.followerId,
          followedId: params.creatorId,
        },
      },
    })

    if (!existing) {
      await tx.userFollow.create({
        data: {
          followerId: params.followerId,
          followedId: params.creatorId,
        },
      })

      await Promise.all([
        tx.user.update({
          where: { id: params.creatorId },
          data: { followersCount: { increment: 1 } },
        }),
        tx.user.update({
          where: { id: params.followerId },
          data: { followingCount: { increment: 1 } },
        }),
        tx.userCreatorAffinity.upsert({
          where: {
            userId_creatorId: {
              userId: params.followerId,
              creatorId: params.creatorId,
            },
          },
          create: {
            userId: params.followerId,
            creatorId: params.creatorId,
            score: devotionalFeedPolicy.affinitySignals.follow,
            lastSignalAt: new Date(),
          },
          update: {
            score: {
              increment: devotionalFeedPolicy.affinitySignals.follow,
            },
            lastSignalAt: new Date(),
          },
        }),
      ])
    }

    const [user, publishedDevotionalsCount] = await Promise.all([
      tx.user.findUnique({
        where: { id: params.creatorId },
        select: {
          id: true,
          name: true,
          handle: true,
          creatorBio: true,
          creatorAvatarUrl: true,
          followersCount: true,
          followingCount: true,
        },
      }),
      tx.devotional.count({
        where: {
          authorId: params.creatorId,
          publicationState: {
            in: ['PUBLISHED_LOW_REACH', 'TRENDING', 'FEATURED'],
          },
          moderationStatus: 'CLEAR',
          author: {
            isBlocked: false,
          },
        },
      }),
    ])

    if (!user) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404)
    }

    return formatProfile(user, {
      followedByMe: true,
      publishedDevotionalsCount,
    })
  })
}

export const unfollowCreator = async (params: {
  followerId: string
  creatorId: string
}) => {
  if (params.followerId === params.creatorId) {
    throw new AppError('You cannot unfollow yourself', 'FOLLOW_SELF_FORBIDDEN', 400)
  }

  await ensureCreatorExists(params.creatorId)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.userFollow.findUnique({
      where: {
        followerId_followedId: {
          followerId: params.followerId,
          followedId: params.creatorId,
        },
      },
    })

    if (existing) {
      await tx.userFollow.delete({ where: { id: existing.id } })
      await Promise.all([
        tx.user.update({
          where: { id: params.creatorId },
          data: { followersCount: { decrement: 1 } },
        }),
        tx.user.update({
          where: { id: params.followerId },
          data: { followingCount: { decrement: 1 } },
        }),
      ])
    }

    const [user, publishedDevotionalsCount] = await Promise.all([
      tx.user.findUnique({
        where: { id: params.creatorId },
        select: {
          id: true,
          name: true,
          handle: true,
          creatorBio: true,
          creatorAvatarUrl: true,
          followersCount: true,
          followingCount: true,
        },
      }),
      tx.devotional.count({
        where: {
          authorId: params.creatorId,
          publicationState: {
            in: ['PUBLISHED_LOW_REACH', 'TRENDING', 'FEATURED'],
          },
          moderationStatus: 'CLEAR',
          author: {
            isBlocked: false,
          },
        },
      }),
    ])

    if (!user) {
      throw new AppError('User not found', 'USER_NOT_FOUND', 404)
    }

    return formatProfile(user, {
      followedByMe: false,
      publishedDevotionalsCount,
    })
  })
}
