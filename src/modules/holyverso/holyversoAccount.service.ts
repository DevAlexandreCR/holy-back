import crypto from 'crypto'
import { Prisma, UserRole } from '@prisma/client'
import { prisma } from '../../config/db'
import { AppError } from '../../common/errors'
import { config } from '../../config/env'
import { hashPassword } from '../auth/password'
import { HOLYVERSO_TIMEZONE } from './holyverso.constants'

const holyversoUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  name: true,
  email: true,
  handle: true,
  role: true,
  isSystemManaged: true,
  suppressCreatorNotifications: true,
})

export const ensureHolyversoUser = async () => {
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { email: config.holyverso.user.email },
        { handle: config.holyverso.user.handle },
      ],
    },
    select: holyversoUserSelect,
  })

  const uniqueIds = [...new Set(candidates.map((candidate) => candidate.id))]
  if (uniqueIds.length > 1) {
    throw new AppError(
      'HolyVerso account identity is ambiguous.',
      'HOLYVERSO_ACCOUNT_CONFLICT',
      500
    )
  }

  const passwordHash =
    config.holyverso.user.password != null
      ? await hashPassword(config.holyverso.user.password)
      : candidates[0]
        ? null
        : await hashPassword(crypto.randomUUID())

  const now = new Date()

  const user = await prisma.$transaction(async (tx) => {
    const storedUser = candidates[0]
      ? await tx.user.update({
          where: { id: candidates[0].id },
          data: {
            name: config.holyverso.user.name,
            email: config.holyverso.user.email,
            handle: config.holyverso.user.handle,
            creatorBio: config.holyverso.user.bio,
            creatorProfileUpdatedAt: now,
            role: UserRole.USER,
            isSystemManaged: true,
            suppressCreatorNotifications: true,
            ...(passwordHash ? { passwordHash } : {}),
          },
          select: holyversoUserSelect,
        })
      : await tx.user.create({
          data: {
            name: config.holyverso.user.name,
            email: config.holyverso.user.email,
            handle: config.holyverso.user.handle,
            creatorBio: config.holyverso.user.bio,
            creatorProfileUpdatedAt: now,
            passwordHash: passwordHash ?? (await hashPassword(crypto.randomUUID())),
            role: UserRole.USER,
            isSystemManaged: true,
            suppressCreatorNotifications: true,
          },
          select: holyversoUserSelect,
        })

    await tx.userSettings.upsert({
      where: {
        userId: storedUser.id,
      },
      create: {
        userId: storedUser.id,
        timezone: HOLYVERSO_TIMEZONE,
      },
      update: {
        timezone: HOLYVERSO_TIMEZONE,
      },
    })

    return storedUser
  })

  return user
}
