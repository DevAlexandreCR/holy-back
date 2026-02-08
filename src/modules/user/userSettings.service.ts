import { BibleVersion, UserSettings } from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'

const DEFAULT_PREFERRED_VERSION_CODE = 'rv1960'
const DEFAULT_PREFERRED_VERSION_NAME = 'Reina-Valera 1960'
const DEFAULT_PREFERRED_VERSION_NAME_ALT = 'Reina Valera 1960'

const findDefaultPreferredVersion = async (): Promise<BibleVersion | null> => {
  const byCode = await prisma.bibleVersion.findFirst({
    where: { apiCode: DEFAULT_PREFERRED_VERSION_CODE, isActive: true },
  })
  if (byCode) return byCode

  const byCodeUpper = await prisma.bibleVersion.findFirst({
    where: { apiCode: DEFAULT_PREFERRED_VERSION_CODE.toUpperCase(), isActive: true },
  })
  if (byCodeUpper) return byCodeUpper

  const byName = await prisma.bibleVersion.findFirst({
    where: { name: { contains: DEFAULT_PREFERRED_VERSION_NAME }, isActive: true },
  })
  if (byName) return byName

  const byNameAlt = await prisma.bibleVersion.findFirst({
    where: { name: { contains: DEFAULT_PREFERRED_VERSION_NAME_ALT }, isActive: true },
  })
  if (byNameAlt) return byNameAlt

  return prisma.bibleVersion.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } })
}

export const getSettingsByUserId = async (userId: string): Promise<UserSettings | null> => {
  return prisma.userSettings.findUnique({ where: { userId } })
}

export const ensureSettings = async (userId: string): Promise<UserSettings> => {
  const existing = await getSettingsByUserId(userId)
  if (existing) {
    if (existing.preferredVersionId) return existing
    const fallback = await findDefaultPreferredVersion()
    if (!fallback) return existing
    return prisma.userSettings.update({
      where: { userId },
      data: { preferredVersionId: fallback.id },
    })
  }

  const fallback = await findDefaultPreferredVersion()

  return prisma.userSettings.create({
    data: {
      userId,
      preferredVersionId: fallback?.id ?? null,
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
