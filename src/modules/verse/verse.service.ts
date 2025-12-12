import { BibleVersion, Prisma, VerseSeed, VerseTranslation } from '@prisma/client';
import { AppError } from '../../common/errors';
import { prisma } from '../../config/db';
import { ensureSettings } from '../user/userSettings.service';
import BibleApiClient from '../bible/bibleApiClient';
import { VerseApiModel } from '../bible/bible.types';
import { createSeedHash, fetchRandomSeed, parseReference } from '../bible/bibleRandomSeedClient';

const bibleApiClient = new BibleApiClient();

const composeVerseText = (verses: VerseApiModel[]): string => verses.map((verse) => verse.verse.trim()).join(' ');

const findActiveVersionOrThrow = async (versionId: number): Promise<BibleVersion> => {
  const version = await prisma.bibleVersion.findFirst({
    where: { id: versionId, isActive: true },
  });

  if (!version) {
    throw new AppError('Bible version not found or inactive', 'BIBLE_VERSION_NOT_FOUND', 404);
  }

  return version;
};

const pickDefaultVersion = async (): Promise<BibleVersion> => {
  const spanish = await prisma.bibleVersion.findFirst({
    where: {
      isActive: true,
      OR: [{ language: { contains: 'spa' } }, { language: { startsWith: 'es' } }],
    },
    orderBy: { name: 'asc' },
  });
  if (spanish) return spanish;

  const web = await prisma.bibleVersion.findFirst({
    where: { isActive: true, apiCode: 'web' },
  });
  if (web) return web;

  const fallback = await prisma.bibleVersion.findFirst({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  if (!fallback) {
    throw new AppError('No active bible version available', 'NO_ACTIVE_BIBLE_VERSION', 404);
  }

  return fallback;
};

const resolveVersionForUser = async (userId: string, requestedVersionId?: number): Promise<BibleVersion> => {
  const settings = await ensureSettings(userId);

  if (requestedVersionId) {
    return findActiveVersionOrThrow(requestedVersionId);
  }

  if (settings.preferredVersionId) {
    return findActiveVersionOrThrow(settings.preferredVersionId);
  }

  return pickDefaultVersion();
};

const findUnseenSeedForUser = async (userId: string): Promise<VerseSeed | null> => {
  return prisma.verseSeed.findFirst({
    where: { userHistory: { none: { userId } } },
    orderBy: { id: 'asc' },
  });
};

const upsertRandomSeed = async (): Promise<VerseSeed> => {
  const randomSeed = await fetchRandomSeed();
  const parsed = parseReference(randomSeed.reference);
  const seedHash = createSeedHash(randomSeed.reference);
  const bookName = (randomSeed.verses?.[0]?.book_name ?? parsed.bookName).trim();

  const seedData = {
    seedHash,
    sourceTranslation: 'web',
    reference: randomSeed.reference.trim(),
    referenceBook: bookName,
    referenceChapter: parsed.chapter,
    referenceFromVerse: parsed.fromVerse,
    referenceToVerse: parsed.toVerse ?? null,
    textEn: randomSeed.text.trim(),
    meta: {
      translation_name: randomSeed.translation_name,
      translation_note: randomSeed.translation_note,
      book_id: randomSeed.verses?.[0]?.book_id,
    },
  };

  return prisma.verseSeed.upsert({
    where: { seedHash },
    create: seedData,
    update: seedData,
  });
};

const pickSeedForUser = async (userId: string): Promise<VerseSeed> => {
  const cached = await findUnseenSeedForUser(userId);
  if (cached) return cached;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const seeded = await upsertRandomSeed();
      const unseen = await prisma.verseSeed.findFirst({
        where: { id: seeded.id, userHistory: { none: { userId } } },
      });
      if (unseen) return unseen;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[VerseService] Random seed fetch failed', error);
    }
  }

  throw new AppError('Unable to fetch a verse right now', 'VERSE_SEED_UNAVAILABLE', 503);
};

const findTranslation = async (seedId: number, versionId: number): Promise<VerseTranslation | null> => {
  return prisma.verseTranslation.findUnique({
    where: { seedId_versionId: { seedId, versionId } },
  });
};

const getOrCreateTranslation = async (
  seed: VerseSeed,
  version: BibleVersion,
): Promise<VerseTranslation | null> => {
  const existing = await findTranslation(seed.id, version.id);
  if (existing) return existing;

  try {
    const verses = await bibleApiClient.getVerses({
      versionCode: version.apiCode,
      book: seed.referenceBook,
      chapter: seed.referenceChapter,
      fromVerse: seed.referenceFromVerse,
      toVerse: seed.referenceToVerse ?? undefined,
    });

    if (!verses.length) {
      throw new Error('Bible API returned no verses for the requested reference');
    }

    const text = composeVerseText(verses);

    return await prisma.verseTranslation.create({
      data: {
        seedId: seed.id,
        versionId: version.id,
        translationCode: version.apiCode,
        text,
        meta: {
          fetchedVerses: verses.length,
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return findTranslation(seed.id, version.id);
    }

    // eslint-disable-next-line no-console
    console.error(
      `[VerseService] Translation fetch failed for seed ${seed.id} (${seed.reference}) and version ${version.apiCode}`,
      error,
    );
    return null;
  }
};

const markSeedAsSeen = async (userId: string, seedId: number): Promise<void> => {
  try {
    await prisma.userVerseHistory.create({
      data: { userId, seedId },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return;
    }
    // eslint-disable-next-line no-console
    console.error(`[VerseService] Failed to mark seed ${seedId} as seen for user ${userId}`, error);
  }
};

export type VersePayload = {
  reference: string;
  text: string;
  version_code: string;
  version_name: string;
  source_seed_translation: string;
};

export const getDailyVerseForUser = async (
  userId: string,
  options?: { versionId?: number },
): Promise<VersePayload> => {
  const version = await resolveVersionForUser(userId, options?.versionId);
  const seed = await pickSeedForUser(userId);
  const translation = await getOrCreateTranslation(seed, version);

  await markSeedAsSeen(userId, seed.id);

  const text = translation?.text ?? seed.textEn;

  if (!translation) {
    // eslint-disable-next-line no-console
    console.error(
      `[VerseService] Falling back to English seed text for seed ${seed.id} (${seed.reference}) and version ${version.apiCode}`,
    );
  }

  return {
    reference: seed.reference,
    text,
    version_code: version.apiCode,
    version_name: version.name,
    source_seed_translation: seed.sourceTranslation,
  };
};
