import { BibleVersion } from '@prisma/client';
import { AppError } from '../../common/errors';
import { prisma } from '../../config/db';
import { config } from '../../config/env';
import { ensureSettings } from '../user/userSettings.service';
import { BibleApiClient } from './bibleApiClient';

const bibleApiClient = new BibleApiClient(config.external.bibleApiBaseUrl);
const CHAPTER_CACHE_TTL_MS = 15 * 60 * 1000;

type ChapterPayload = {
  book: string;
  chapter: number;
  reference: string;
  num_chapters: number;
  version_code: string;
  version_name: string;
  verses: Array<{
    number: number;
    text: string;
    study?: string;
  }>;
};

type ChapterCacheEntry = {
  payload: ChapterPayload;
  expiresAt: number;
};

const chapterCache = new Map<string, ChapterCacheEntry>();

const buildCacheKey = (
  versionCode: string,
  book: string,
  chapter: number
): string => `${versionCode.toLowerCase()}|${book.toLowerCase()}|${chapter}`;

const getCachedChapter = (key: string): ChapterPayload | null => {
  const cached = chapterCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    chapterCache.delete(key);
    return null;
  }

  return cached.payload;
};

const setCachedChapter = (key: string, payload: ChapterPayload): void => {
  chapterCache.set(key, {
    payload,
    expiresAt: Date.now() + CHAPTER_CACHE_TTL_MS,
  });
};

async function resolveUserVersion(userId: string): Promise<BibleVersion> {
  const settings = await ensureSettings(userId);
  if (settings.preferredVersionId) {
    const preferredVersion = await prisma.bibleVersion.findUnique({
      where: { id: settings.preferredVersionId },
    });
    if (preferredVersion) {
      return preferredVersion;
    }
  }

  const fallback = await prisma.bibleVersion.findFirst({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  });

  if (!fallback) {
    throw new AppError(
      'No active Bible versions available',
      'BIBLE_VERSION_NOT_FOUND',
      404
    );
  }

  await prisma.userSettings.update({
    where: { userId },
    data: { preferredVersionId: fallback.id },
  });

  return fallback;
}

export const getBibleChapterForReference = async (
  userId: string,
  book: string,
  chapter: number
): Promise<ChapterPayload> => {
  const normalizedBook = book.trim();

  if (!normalizedBook) {
    throw new AppError('Book is required', 'INVALID_BOOK', 400);
  }

  if (!Number.isInteger(chapter) || chapter <= 0) {
    throw new AppError('Chapter is required', 'INVALID_CHAPTER', 400);
  }

  const version = await resolveUserVersion(userId);
  const cacheKey = buildCacheKey(version.apiCode, normalizedBook, chapter);
  const cached = getCachedChapter(cacheKey);

  if (cached) {
    return cached;
  }

  const chapterData = await bibleApiClient
    .getChapter({
      versionCode: version.apiCode,
      book: normalizedBook,
      chapter,
    })
    .catch((error) => {
      throw new AppError(
        'Failed to fetch chapter from Bible API',
        'BIBLE_API_ERROR',
        502,
        error
      );
    });

  if (!chapterData.verses || chapterData.verses.length === 0) {
    throw new AppError('Chapter content unavailable', 'BIBLE_API_EMPTY', 502);
  }

  const payload: ChapterPayload = {
    book: chapterData.name,
    chapter: chapterData.chapter,
    reference: `${chapterData.name} ${chapterData.chapter}`,
    num_chapters: chapterData.numChapters,
    version_code: version.apiCode,
    version_name: version.name,
    verses: chapterData.verses.map(({ number, text, study }) => ({
      number,
      text,
      study,
    })),
  };

  setCachedChapter(cacheKey, payload);

  return payload;
};
