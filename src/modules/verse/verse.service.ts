import { BibleVersion, Prisma, VerseSeed, VerseTranslation } from '@prisma/client';
import { AppError } from '../../common/errors';
import { prisma } from '../../config/db';
import { ensureSettings } from '../user/userSettings.service';
import BibleApiClient from '../bible/bibleApiClient';
import { VerseApiModel } from '../bible/bible.types';
import { createSeedHash, fetchRandomSeed, normalizeRandomSeed } from '../bible/bibleRandomSeedClient';

const bibleApiClient = new BibleApiClient();

const composeVerseText = (verses: VerseApiModel[]): string => verses.map((verse) => verse.verse.trim()).join(' ');

const normalizeBookKey = (value: string): string => {
  const romanPrefix = value.trim().replace(/^iii\b/i, '3 ').replace(/^ii\b/i, '2 ').replace(/^i\b/i, '1 ');
  return romanPrefix
    .toLowerCase()
    .replace(/[.'`]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const BOOK_ABBREVIATIONS: Record<string, string> = {
  genesis: 'GN',
  génesis: 'GN',
  exodo: 'EX',
  éxodo: 'EX',
  exodus: 'EX',
  levitico: 'LV',
  levítico: 'LV',
  leviticus: 'LV',
  numeros: 'NM',
  números: 'NM',
  numbers: 'NM',
  deuteronomio: 'DT',
  deuteronomy: 'DT',
  josue: 'JOS',
  josué: 'JOS',
  joshua: 'JOS',
  jueces: 'JUE',
  judges: 'JUE',
  rut: 'RT',
  ruth: 'RT',
  '1 samuel': '1S',
  '2 samuel': '2S',
  '1 kings': '1R',
  '2 kings': '2R',
  '1 reyes': '1R',
  '2 reyes': '2R',
  '1 cronicas': '1CR',
  '1 crónicas': '1CR',
  '1 chronicles': '1CR',
  '2 cronicas': '2CR',
  '2 crónicas': '2CR',
  '2 chronicles': '2CR',
  esdras: 'ESD',
  ezra: 'ESD',
  nehemias: 'NEH',
  nehemías: 'NEH',
  nehemiah: 'NEH',
  ester: 'EST',
  esther: 'EST',
  job: 'JOB',
  salmos: 'SAL',
  psalms: 'SAL',
  psalm: 'SAL',
  proverbios: 'PR',
  proverbs: 'PR',
  eclesiastes: 'EC',
  ecclesiastes: 'EC',
  cantares: 'CNT',
  'song of solomon': 'CNT',
  'song of songs': 'CNT',
  isaías: 'IS',
  isaias: 'IS',
  isaiah: 'IS',
  jeremias: 'JER',
  jeremías: 'JER',
  jeremiah: 'JER',
  lamentaciones: 'LM',
  lamentations: 'LM',
  ezequiel: 'EZ',
  ezekiel: 'EZ',
  daniel: 'DN',
  oseas: 'OS',
  hosea: 'OS',
  joel: 'JL',
  amos: 'AM',
  amós: 'AM',
  obadias: 'ABD',
  abdias: 'ABD',
  obadiah: 'ABD',
  jonas: 'JON',
  jonás: 'JON',
  jonah: 'JON',
  miqueas: 'MI',
  micah: 'MI',
  nahum: 'NAH',
  habacuc: 'HAB',
  habakkuk: 'HAB',
  sofonias: 'SOF',
  zephaniah: 'SOF',
  hageo: 'HAG',
  haggai: 'HAG',
  zacarias: 'ZAC',
  zacarías: 'ZAC',
  zechariah: 'ZAC',
  malaquias: 'MAL',
  malachi: 'MAL',
  mateo: 'MT',
  matthew: 'MT',
  marcos: 'MR',
  mark: 'MR',
  lucas: 'LC',
  luke: 'LC',
  juan: 'JN',
  john: 'JN',
  hechos: 'HCH',
  acts: 'HCH',
  romanos: 'RO',
  romans: 'RO',
  '1 corintios': '1CO',
  '1 corinthians': '1CO',
  '2 corintios': '2CO',
  '2 corinthians': '2CO',
  galatas: 'GA',
  gálatas: 'GA',
  galatians: 'GA',
  efesios: 'EF',
  ephesians: 'EF',
  filipenses: 'FIL',
  philippians: 'FIL',
  colosenses: 'COL',
  colossians: 'COL',
  '1 tesalonicenses': '1TS',
  '1 thessalonians': '1TS',
  '2 tesalonicenses': '2TS',
  '2 thessalonians': '2TS',
  '1 timoteo': '1TI',
  '1 timothy': '1TI',
  '2 timoteo': '2TI',
  '2 timothy': '2TI',
  tito: 'TIT',
  titus: 'TIT',
  filemon: 'FLM',
  filémon: 'FLM',
  philemon: 'FLM',
  hebreos: 'HE',
  hebrews: 'HE',
  santiago: 'STG',
  james: 'STG',
  '1 pedro': '1P',
  '1 peter': '1P',
  '2 pedro': '2P',
  '2 peter': '2P',
  '1 juan': '1JN',
  '1 john': '1JN',
  '2 juan': '2JN',
  '2 john': '2JN',
  '3 juan': '3JN',
  '3 john': '3JN',
  judas: 'JUD',
  jude: 'JUD',
  apocalipsis: 'AP',
  revelation: 'AP',
};

const mapBookToApiCode = (book: string): string => {
  const key = normalizeBookKey(book);
  return BOOK_ABBREVIATIONS[key] ?? book;
};

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
  const normalized = normalizeRandomSeed(randomSeed);
  const sourceTranslation = normalized.translationId ?? 'web';
  const seedHash = createSeedHash(normalized.reference, sourceTranslation);

  const seedData = {
    seedHash,
    sourceTranslation,
    reference: normalized.reference.trim(),
    referenceBook: normalized.bookName.trim(),
    referenceChapter: normalized.chapter,
    referenceFromVerse: normalized.fromVerse,
    referenceToVerse: normalized.toVerse ?? null,
    textEn: normalized.textEn,
    meta: {
      translation_name: normalized.translationName,
      translation_note: normalized.translationNote,
      book_id: normalized.bookId,
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
      book: mapBookToApiCode(seed.referenceBook),
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
