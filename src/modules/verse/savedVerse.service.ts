import { BibleVersion, CachedVerseText, LibraryVerse, UserSavedVerse } from '@prisma/client'
import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { BibleApiClient } from '../bible/bibleApiClient'
import { convertBookToApiCode, getBookDisplayName } from '../bible/bookApiMapping'
import { formatReference } from './libraryLoader.service'

const bibleApiClient = new BibleApiClient(config.external.bibleApiBaseUrl)

export type SavedVersePayload = {
  id: number
  library_verse_id: number
  reference: string
  text: string
  version_code: string
  version_name: string
  theme: string
  saved_at: string
}

const mapSavedVerse = (
  record: UserSavedVerse & { version: BibleVersion; libraryVerse: LibraryVerse }
): SavedVersePayload => ({
  id: record.id,
  library_verse_id: record.libraryVerseId,
  reference: record.reference,
  text: record.text,
  version_code: record.version.apiCode,
  version_name: record.version.name,
  theme: record.libraryVerse.theme,
  saved_at: record.savedAt.toISOString(),
})

const resolveUserVersion = async (userId: string): Promise<BibleVersion> => {
  const userSettings = await prisma.userSettings.findUnique({
    where: { userId },
    include: { preferredVersion: true },
  })

  if (userSettings?.preferredVersion) {
    return userSettings.preferredVersion
  }

  throw new AppError(
    'No Bible version selected. Please select a Bible version in settings.',
    'NO_VERSION_SELECTED',
    400
  )
}

const ensureLibraryVerse = async (libraryVerseId: number): Promise<LibraryVerse> => {
  const libraryVerse = await prisma.libraryVerse.findUnique({
    where: { id: libraryVerseId },
  })

  if (!libraryVerse) {
    throw new AppError('Library verse not found', 'LIBRARY_VERSE_NOT_FOUND', 404)
  }

  return libraryVerse
}

const findCachedVerseText = async (
  libraryVerseId: number,
  versionId: number
): Promise<CachedVerseText | null> => {
  return prisma.cachedVerseText.findUnique({
    where: {
      libraryVerseId_versionId: {
        libraryVerseId,
        versionId,
      },
    },
  })
}

const fetchVerseFromApi = async (
  libraryVerse: LibraryVerse,
  version: BibleVersion
): Promise<{ text: string; reference: string }> => {
  const apiBookCode = convertBookToApiCode(libraryVerse.book)

  const apiResponse = await bibleApiClient.getVerses({
    versionCode: version.apiCode,
    book: apiBookCode,
    chapter: libraryVerse.chapter,
    fromVerse: libraryVerse.verseFrom,
    toVerse: libraryVerse.verseTo === libraryVerse.verseFrom ? undefined : libraryVerse.verseTo,
  })

  if (!apiResponse || apiResponse.length === 0) {
    throw new AppError('No verses returned from Bible API', 'BIBLE_API_EMPTY', 502)
  }

  const text = apiResponse.map(v => v.verse?.trim() || '').filter(Boolean).join(' ')
  const language = version.language === 'en' ? 'en' : 'es'
  const bookDisplayName = getBookDisplayName(libraryVerse.book, language)

  const reference = formatReference(
    bookDisplayName,
    libraryVerse.chapter,
    libraryVerse.verseFrom,
    libraryVerse.verseTo
  )

  return { text, reference }
}

const cacheVerseText = async (
  libraryVerseId: number,
  versionId: number,
  text: string,
  reference: string,
  apiMetadata?: any
): Promise<CachedVerseText> => {
  return prisma.cachedVerseText.upsert({
    where: {
      libraryVerseId_versionId: {
        libraryVerseId,
        versionId,
      },
    },
    create: {
      libraryVerseId,
      versionId,
      text,
      reference,
      apiMetadata,
    },
    update: {
      text,
      reference,
      apiMetadata,
    },
  })
}

const getVerseTextForVersion = async (
  libraryVerse: LibraryVerse,
  version: BibleVersion
): Promise<{ text: string; reference: string }> => {
  const cached = await findCachedVerseText(libraryVerse.id, version.id)
  if (cached) {
    return { text: cached.text, reference: cached.reference }
  }

  const apiResult = await fetchVerseFromApi(libraryVerse, version)
  const cachedResult = await cacheVerseText(
    libraryVerse.id,
    version.id,
    apiResult.text,
    apiResult.reference
  )

  return { text: cachedResult.text, reference: cachedResult.reference }
}

export const saveVerseForUser = async (
  userId: string,
  libraryVerseId: number
): Promise<SavedVersePayload> => {
  if (!Number.isInteger(libraryVerseId) || libraryVerseId <= 0) {
    throw new AppError('Invalid verse id', 'INVALID_VERSE_ID', 400)
  }

  const [libraryVerse, version] = await Promise.all([
    ensureLibraryVerse(libraryVerseId),
    resolveUserVersion(userId),
  ])

  const { text, reference } = await getVerseTextForVersion(libraryVerse, version)

  const saved = await prisma.userSavedVerse.upsert({
    where: {
      userId_libraryVerseId: {
        userId,
        libraryVerseId,
      },
    },
    create: {
      userId,
      libraryVerseId,
      versionId: version.id,
      reference,
      text,
      theme: libraryVerse.theme,
      source: 'daily_verse',
    },
    update: {
      versionId: version.id,
      reference,
      text,
    },
    include: {
      version: true,
      libraryVerse: true,
    },
  })

  return mapSavedVerse(saved)
}

export const removeSavedVerse = async (userId: string, libraryVerseId: number): Promise<void> => {
  if (!Number.isInteger(libraryVerseId) || libraryVerseId <= 0) {
    throw new AppError('Invalid verse id', 'INVALID_VERSE_ID', 400)
  }

  await prisma.userSavedVerse.deleteMany({
    where: {
      userId,
      libraryVerseId,
    },
  })
}

export const getSavedVerses = async (
  userId: string,
  params?: { cursor?: number; limit?: number }
): Promise<{ items: SavedVersePayload[]; nextCursor?: number }> => {
  const limit = params?.limit && params.limit > 0 ? Math.min(params.limit, 50) : 20
  const cursorId = params?.cursor

  let cursorRef: { savedAt: Date; id: number } | null = null

  if (cursorId) {
    cursorRef = await prisma.userSavedVerse.findUnique({
      where: { id: cursorId },
      select: { savedAt: true, id: true },
    })

    if (!cursorRef) {
      throw new AppError('Cursor not found', 'CURSOR_NOT_FOUND', 400)
    }
  }

  const items = await prisma.userSavedVerse.findMany({
    where: {
      userId,
      ...(cursorRef
        ? {
            OR: [
              { savedAt: { lt: cursorRef.savedAt } },
              { savedAt: cursorRef.savedAt, id: { lt: cursorRef.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ savedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      version: true,
      libraryVerse: true,
    },
  })

  const hasNext = items.length > limit
  const paginated = hasNext ? items.slice(0, limit) : items

  return {
    items: paginated.map(mapSavedVerse),
    nextCursor: hasNext ? paginated[paginated.length - 1].id : undefined,
  }
}

export const isVerseSaved = async (userId: string, libraryVerseId: number): Promise<boolean> => {
  if (!Number.isInteger(libraryVerseId) || libraryVerseId <= 0) {
    return false
  }

  const existing = await prisma.userSavedVerse.findUnique({
    where: {
      userId_libraryVerseId: {
        userId,
        libraryVerseId,
      },
    },
  })

  return Boolean(existing)
}
