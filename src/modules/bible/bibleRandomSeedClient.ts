import axios from 'axios';

const RANDOM_API_BASE_URL = 'https://bible-api.com';
const REQUEST_TIMEOUT = 10000;

type RandomVerseShape = {
  book_id?: string;
  book?: string;
  book_name?: string;
  chapter: number;
  verse: number;
  text: string;
};

type TranslationShape = {
  identifier?: string;
  id?: string;
  name?: string;
  language?: string;
  language_code?: string;
  license?: string;
};

export interface BibleApiRandomResponse {
  reference?: string;
  verses?: RandomVerseShape[];
  random_verse?: RandomVerseShape;
  text?: string;
  translation_id?: string;
  translation_name?: string;
  translation_note?: string;
  translation?: TranslationShape;
}

export const fetchRandomSeed = async (): Promise<BibleApiRandomResponse> => {
  const url = `${RANDOM_API_BASE_URL}/data/web/random`;
  const res = await axios.get<BibleApiRandomResponse>(url, {
    timeout: REQUEST_TIMEOUT,
    headers: { 'User-Agent': 'HolyVerso/1.0' },
  });
  return res.data;
};

export const parseReference = (reference: string) => {
  const match = reference?.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Invalid reference format: ${reference}`);
  const [, bookName, chapter, fromVerse, toVerse] = match;
  return {
    bookName: bookName.trim(),
    chapter: Number(chapter),
    fromVerse: Number(fromVerse),
    toVerse: toVerse ? Number(toVerse) : undefined,
  };
};

const buildReferenceString = (bookName: string, chapter: number, fromVerse: number, toVerse?: number) => {
  const trimmedBook = bookName.trim();
  const range = toVerse && toVerse !== fromVerse ? `${fromVerse}-${toVerse}` : `${fromVerse}`;
  return `${trimmedBook} ${chapter}:${range}`;
};

export const normalizeRandomSeed = (payload: BibleApiRandomResponse) => {
  const verseList = Array.isArray(payload.verses) && payload.verses.length ? payload.verses : [];
  const firstVerse = payload.random_verse ?? verseList[0];

  if (!firstVerse) {
    throw new Error('Random seed payload missing verse data');
  }

  const lastVerse = verseList.length ? verseList[verseList.length - 1] : firstVerse;
  const bookName = firstVerse.book ?? firstVerse.book_name ?? firstVerse.book_id ?? '';
  if (!bookName.trim()) {
    throw new Error('Random seed payload missing book name');
  }

  const chapter = Number(firstVerse.chapter);
  const fromVerse = Number(firstVerse.verse);
  const toVerse = Number.isFinite(lastVerse?.verse) ? Number(lastVerse.verse) : undefined;
  const reference = payload.reference ?? buildReferenceString(bookName, chapter, fromVerse, toVerse);
  const textEn =
    payload.text ??
    verseList.map((v) => v.text?.trim()).filter(Boolean).join(' ').trim() ??
    firstVerse.text?.trim() ??
    '';

  return {
    reference,
    bookName,
    chapter,
    fromVerse,
    toVerse,
    textEn,
    bookId: firstVerse.book_id,
    translationId: payload.translation?.identifier ?? payload.translation_id ?? payload.translation?.id ?? 'web',
    translationName: payload.translation?.name ?? payload.translation_name,
    translationNote: payload.translation_note ?? payload.translation?.license,
  };
};

export const createSeedHash = (reference: string, translation = 'web'): string =>
  reference.trim().toLowerCase().replace(/\s+/g, '_') + `_${translation}`;
