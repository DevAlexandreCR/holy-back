import { UserSettings } from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'

export const getSettingsByUserId = async (userId: string): Promise<UserSettings | null> => {
  return prisma.userSettings.findUnique({ where: { userId } })
}

export const ensureSettings = async (userId: string): Promise<UserSettings> => {
  const existing = await getSettingsByUserId(userId)
  if (existing) return existing

  return prisma.userSettings.create({
    data: {
      userId,
      preferredVersionId: null,
      timezone: null,
      widgetFontSize: 'large',
    },
  })
}

export const updateSettings = async (
  userId: string,
  data: Partial<Pick<UserSettings, 'preferredVersionId' | 'timezone' | 'widgetFontSize'>>,
): Promise<UserSettings> => {
  await ensureSettings(userId)
  return prisma.userSettings.update({
    where: { userId },
    data,
  })
}

export const setPreferredVersion = async (userId: string, versionId: number): Promise<UserSettings> => {
  const version = await prisma.bibleVersion.findUnique({ where: { id: versionId } })
  if (!version) {
    throw new AppError('Bible version not found', 'BIBLE_VERSION_NOT_FOUND', 404)
  }

  if (!version.isActive) {
    throw new AppError('Bible version is not active', 'BIBLE_VERSION_INACTIVE', 400)
  }

  return updateSettings(userId, { preferredVersionId: versionId })
}

export const setTimezone = async (userId: string, timezone: string): Promise<UserSettings> => {
  return updateSettings(userId, { timezone })
}

export const setWidgetFontSize = async (userId: string, widgetFontSize: string): Promise<UserSettings> => {
  return updateSettings(userId, { widgetFontSize })
}
