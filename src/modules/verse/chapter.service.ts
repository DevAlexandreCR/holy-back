import { AppError } from '../../common/errors'
import { prisma } from '../../config/db'
import { config } from '../../config/env'
import { BibleApiClient } from '../bible/bibleApiClient'
import { convertBookToApiCode, getBookDisplayName } from '../bible/bookApiMapping'
import { getDailyVerseForUser } from './verse.service'

const bibleApiClient = new BibleApiClient(config.external.bibleApiBaseUrl)

const CHAPTER_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

type ChapterCacheEntry = {
  payload: ChapterPayload
  expiresAt: number
}

const chapterCache = new Map<string, ChapterCacheEntry>()

const buildCacheKey = (versionCode: string, book: string, chapter: number): string =>
  `${versionCode.toLowerCase()}|${book.toLowerCase()}|${chapter}`

const getCachedChapter = (key: string): ChapterPayload | null => {
  const cached = chapterCache.get(key)
  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    chapterCache.delete(key)
    return null
  }

  return cached.payload
}

const setCachedChapter = (key: string, payload: ChapterPayload): void => {
  chapterCache.set(key, {
    payload,
    expiresAt: Date.now() + CHAPTER_CACHE_TTL_MS,
  })
}

export interface ChapterPayload {
  book: string
  chapter: number
  reference: string
  num_chapters: number
  version_code: string
  version_name: string
  verses: Array<{
    number: number
    text: string
    study?: string
  }>
}

export const getChapterForDailyVerse = async (userId: string): Promise<ChapterPayload> => {
  const dailyVerse = await getDailyVerseForUser(userId)

  const libraryVerseId = dailyVerse.libraryVerseId

  if (!libraryVerseId || Number.isNaN(libraryVerseId)) {
    throw new AppError('Invalid daily verse reference', 'INVALID_REFERENCE', 400)
  }

  const libraryVerse = await prisma.libraryVerse.findUnique({
    where: { id: libraryVerseId },
  })

  if (!libraryVerse) {
    throw new AppError('Today\'s verse reference not found', 'TODAY_VERSE_NOT_FOUND', 404)
  }

  const version = await prisma.bibleVersion.findUnique({
    where: { apiCode: dailyVerse.versionCode },
  })

  if (!version) {
    throw new AppError('Bible version not found', 'BIBLE_VERSION_NOT_FOUND', 404)
  }

  const apiBook = convertBookToApiCode(libraryVerse.book)
  const cacheKey = buildCacheKey(version.apiCode, apiBook, libraryVerse.chapter)
  const cached = getCachedChapter(cacheKey)

  if (cached) {
    return cached
  }

  const chapterData = await bibleApiClient
    .getChapter({
      versionCode: version.apiCode,
      book: apiBook,
      chapter: libraryVerse.chapter,
    })
    .catch(error => {
      throw new AppError('Failed to fetch chapter from Bible API', 'BIBLE_API_ERROR', 502, error)
    })

  if (!chapterData.verses || chapterData.verses.length === 0) {
    throw new AppError('Chapter content unavailable', 'BIBLE_API_EMPTY', 502)
  }

  const language = version.language?.toLowerCase().startsWith('en') ? 'en' : 'es'
  const bookDisplayName = getBookDisplayName(libraryVerse.book, language === 'en' ? 'en' : 'es')

  const payload: ChapterPayload = {
    book: libraryVerse.book,
    chapter: libraryVerse.chapter,
    reference: `${bookDisplayName} ${libraryVerse.chapter}`,
    num_chapters: chapterData.numChapters,
    version_code: version.apiCode,
    version_name: version.name,
    verses: chapterData.verses.map(({ number, text, study }) => ({
      number,
      text,
      study,
    })),
  }

  setCachedChapter(cacheKey, payload)

  return payload
}

export const getChapterForSavedVerse = async (
  userId: string,
  libraryVerseId: number
): Promise<ChapterPayload> => {
  if (!Number.isInteger(libraryVerseId) || libraryVerseId <= 0) {
    throw new AppError('Invalid verse reference', 'INVALID_REFERENCE', 400)
  }

  const savedVerse = await prisma.userSavedVerse.findUnique({
    where: {
      userId_libraryVerseId: {
        userId,
        libraryVerseId,
      },
    },
    include: {
      libraryVerse: true,
      version: true,
    },
  })

  if (!savedVerse) {
    throw new AppError('Saved verse not found', 'SAVED_VERSE_NOT_FOUND', 404)
  }

  const apiBook = convertBookToApiCode(savedVerse.libraryVerse.book)
  const cacheKey = buildCacheKey(savedVerse.version.apiCode, apiBook, savedVerse.libraryVerse.chapter)
  const cached = getCachedChapter(cacheKey)

  if (cached) {
    return cached
  }

  const chapterData = await bibleApiClient
    .getChapter({
      versionCode: savedVerse.version.apiCode,
      book: apiBook,
      chapter: savedVerse.libraryVerse.chapter,
    })
    .catch(error => {
      throw new AppError('Failed to fetch chapter from Bible API', 'BIBLE_API_ERROR', 502, error)
    })

  if (!chapterData.verses || chapterData.verses.length === 0) {
    throw new AppError('Chapter content unavailable', 'BIBLE_API_EMPTY', 502)
  }

  const language = savedVerse.version.language?.toLowerCase().startsWith('en') ? 'en' : 'es'
  const bookDisplayName = getBookDisplayName(savedVerse.libraryVerse.book, language === 'en' ? 'en' : 'es')

  const payload: ChapterPayload = {
    book: savedVerse.libraryVerse.book,
    chapter: savedVerse.libraryVerse.chapter,
    reference: `${bookDisplayName} ${savedVerse.libraryVerse.chapter}`,
    num_chapters: chapterData.numChapters,
    version_code: savedVerse.version.apiCode,
    version_name: savedVerse.version.name,
    verses: chapterData.verses.map(({ number, text, study }) => ({
      number,
      text,
      study,
    })),
  }

  setCachedChapter(cacheKey, payload)

  return payload
}
