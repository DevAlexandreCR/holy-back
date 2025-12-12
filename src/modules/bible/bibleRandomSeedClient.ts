import axios from 'axios';

const RANDOM_API_BASE_URL = 'https://bible-api.com';
const REQUEST_TIMEOUT = 10000;

export interface BibleApiRandomResponse {
  reference: string;
  verses: Array<{
    book_id: string;
    book_name: string;
    chapter: number;
    verse: number;
    text: string;
  }>;
  text: string;
  translation_id: string;
  translation_name: string;
  translation_note: string;
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
  const match = reference.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Invalid reference format: ${reference}`);
  const [, bookName, chapter, fromVerse, toVerse] = match;
  return {
    bookName: bookName.trim(),
    chapter: Number(chapter),
    fromVerse: Number(fromVerse),
    toVerse: toVerse ? Number(toVerse) : undefined,
  };
};

export const createSeedHash = (reference: string): string =>
  reference.trim().toLowerCase().replace(/\s+/g, '_') + '_web';
