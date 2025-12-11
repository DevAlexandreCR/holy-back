import { BibleVersion, DailyVerse } from '@prisma/client';
import { prisma } from '../../config/db';
import BibleApiClient from '../bible/bibleApiClient';
import { VerseApiModel } from '../bible/bible.types';

export type VerseReference = {
  book: string;
  displayName?: string;
  chapter: number;
  fromVerse: number;
  toVerse?: number;
};

export const DAILY_VERSE_ROTATION: VerseReference[] = [
  { book: 'genesis', displayName: 'Genesis', chapter: 1, fromVerse: 1 },
  { book: 'psalms', displayName: 'Psalms', chapter: 23, fromVerse: 1, toVerse: 3 },
  { book: 'john', displayName: 'John', chapter: 3, fromVerse: 16 },
  { book: 'romans', displayName: 'Romans', chapter: 8, fromVerse: 28 },
];

const bibleApiClient = new BibleApiClient();

export const toUTCDateOnly = (input: Date): Date => {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
};

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const buildRangeString = (reference: VerseReference): string => {
  const toVerse = reference.toVerse ?? reference.fromVerse;
  if (toVerse === reference.fromVerse) {
    return `${reference.fromVerse}`;
  }
  return `${reference.fromVerse}-${toVerse}`;
};

export const buildReferenceLabel = (reference: VerseReference): string => {
  const bookName = reference.displayName ?? capitalize(reference.book);
  const range = buildRangeString(reference);
  return `${bookName} ${reference.chapter}:${range}`;
};

const composeVerseText = (verses: VerseApiModel[]): string => verses.map((verse) => verse.verse.trim()).join(' ');

const pickRotationIndex = (date: Date): number => {
  const daysSinceEpoch = Math.floor(toUTCDateOnly(date).getTime() / 86_400_000);
  return Math.abs(daysSinceEpoch) % DAILY_VERSE_ROTATION.length;
};

export const selectDailyVerseReference = (date: Date): VerseReference => {
  const index = pickRotationIndex(date);
  return DAILY_VERSE_ROTATION[index];
};

export const fetchAndStoreDailyVerse = async (
  version: BibleVersion,
  date: Date = new Date(),
): Promise<DailyVerse> => {
  const targetDate = toUTCDateOnly(date);
  const reference = selectDailyVerseReference(targetDate);
  const verses = await bibleApiClient.getVerses({
    versionCode: version.apiCode,
    book: reference.book,
    chapter: reference.chapter,
    fromVerse: reference.fromVerse,
    toVerse: reference.toVerse,
  });

  if (!verses.length) {
    throw new Error('Bible API returned no verses for the requested reference');
  }

  const text = composeVerseText(verses);
  const referenceLabel = buildReferenceLabel(reference);
  const referenceToVerse = reference.toVerse ?? reference.fromVerse;

  const upsertData = {
    referenceBook: reference.book,
    referenceChapter: reference.chapter,
    referenceFromVerse: reference.fromVerse,
    referenceToVerse,
    text,
    meta: {
      reference: referenceLabel,
      versesFetched: verses.length,
    },
  };

  return prisma.dailyVerse.upsert({
    where: { date_versionId: { date: targetDate, versionId: version.id } },
    create: {
      ...upsertData,
      date: targetDate,
      versionId: version.id,
    },
    update: upsertData,
  });
};
