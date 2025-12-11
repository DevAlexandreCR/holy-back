import { BibleVersion, DailyVerse } from '@prisma/client';
import { AppError } from '../../common/errors';
import { prisma } from '../../config/db';
import { ensureSettings } from '../user/userSettings.service';
import { VerseReference, buildReferenceLabel, fetchAndStoreDailyVerse, toUTCDateOnly } from './dailyVerse.service';

type DailyVerseWithVersion = DailyVerse & { version: BibleVersion };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getDateForTimezone = (timezone?: string, now: Date = new Date()): Date => {
  if (!timezone) {
    return toUTCDateOnly(now);
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);

    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
      throw new Error('Invalid date components resolved from timezone');
    }

    return new Date(Date.UTC(year, month - 1, day));
  } catch (error) {
    throw new AppError('Invalid timezone', 'INVALID_TIMEZONE', 400, error);
  }
};

const getActiveVersionOrThrow = async (versionId: number): Promise<BibleVersion> => {
  const version = await prisma.bibleVersion.findFirst({
    where: { id: versionId, isActive: true },
  });

  if (!version) {
    throw new AppError('Bible version not found or inactive', 'BIBLE_VERSION_NOT_FOUND', 404);
  }

  return version;
};

const pickDefaultVersion = async (): Promise<BibleVersion> => {
  const version = await prisma.bibleVersion.findFirst({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  if (!version) {
    throw new AppError('No active bible version available', 'NO_ACTIVE_BIBLE_VERSION', 404);
  }

  return version;
};

const resolveVersion = async (
  requestedVersionId: number | undefined,
  preferredVersionId: number | null,
): Promise<BibleVersion> => {
  if (requestedVersionId) {
    return getActiveVersionOrThrow(requestedVersionId);
  }

  if (preferredVersionId) {
    return getActiveVersionOrThrow(preferredVersionId);
  }

  return pickDefaultVersion();
};

const findDailyVerseWithVersion = async (
  versionId: number,
  date: Date,
): Promise<DailyVerseWithVersion | null> => {
  return prisma.dailyVerse.findUnique({
    where: { date_versionId: { date, versionId } },
    include: { version: true },
  });
};

const ensureDailyVerse = async (
  version: BibleVersion,
  date: Date,
): Promise<DailyVerseWithVersion> => {
  const targetDate = toUTCDateOnly(date);
  const existing = await findDailyVerseWithVersion(version.id, targetDate);
  if (existing) return existing;

  try {
    await fetchAndStoreDailyVerse(version, targetDate);
  } catch (error) {
    throw new AppError('Failed to fetch verse of the day', 'VERSE_FETCH_FAILED', 502, error);
  }

  const created = await findDailyVerseWithVersion(version.id, targetDate);
  if (!created) {
    throw new AppError('Verse of the day not found', 'VERSE_NOT_FOUND', 404);
  }

  return created;
};

const buildReferenceFromRow = (verse: DailyVerse): string => {
  const metaReference =
    isRecord(verse.meta) && typeof verse.meta.reference === 'string' ? verse.meta.reference : undefined;

  if (metaReference?.trim()) {
    return metaReference;
  }

  const reference: VerseReference = {
    book: verse.referenceBook,
    chapter: verse.referenceChapter,
    fromVerse: verse.referenceFromVerse,
    toVerse: verse.referenceToVerse ?? undefined,
  };

  return buildReferenceLabel(reference);
};

export type VersePayload = {
  date: string;
  version_code: string;
  version_name: string;
  reference: string;
  text: string;
};

export const getDailyVerseForUser = async (
  userId: string,
  options?: { versionId?: number; now?: Date },
): Promise<VersePayload> => {
  const settings = await ensureSettings(userId);
  const targetDate = getDateForTimezone(settings.timezone ?? undefined, options?.now ?? new Date());
  const version = await resolveVersion(options?.versionId, settings.preferredVersionId);
  const verse = await ensureDailyVerse(version, targetDate);

  return {
    date: verse.date.toISOString().slice(0, 10),
    version_code: verse.version.apiCode,
    version_name: verse.version.name,
    reference: buildReferenceFromRow(verse),
    text: verse.text,
  };
};
