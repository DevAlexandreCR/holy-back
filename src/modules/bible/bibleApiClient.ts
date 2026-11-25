import axios, { AxiosInstance } from "axios";
import { config } from "../../config/env";
import {
  BookApiModel,
  Chapter,
  ChapterVerse,
  GetChapterParams,
  GetVersesParams,
  VerseApiModel,
} from "./bible.types";
import {
  DEFAULT_BIBLE_VERSION_CODE,
  findBibleVersionCatalogEntry,
} from "./bibleVersionCatalog";
import { getLegacyAbbreviationForBookId, resolveBookId } from "./bookResolver";
import { BOOK_ENTRIES } from "./bookEntries";
import { sanitizeVerseText } from "./verseTextSanitizer";

interface BollsChapterVerse {
  pk: number;
  verse: number;
  text: string;
}

interface BollsBookEntry {
  bookid: number;
  name: string;
  chapters: number;
}

const BOOKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const logAxiosError = (context: string, error: unknown) => {
  if (axios.isAxiosError(error)) {
    const { response, message, code } = error;
    // eslint-disable-next-line no-console
    console.error(`[BibleApiClient] ${context} failed`, {
      status: response?.status,
      data: response?.data,
      message,
      code,
    });
  } else {
    // eslint-disable-next-line no-console
    console.error(`[BibleApiClient] ${context} failed`, error);
  }
};

export class BibleApiClient {
  private client: AxiosInstance;
  private readonly booksCache = new Map<
    string,
    { entries: BollsBookEntry[]; expiresAt: number }
  >();

  constructor(
    baseUrl = config.external.bibleApiBaseUrl,
    httpClient?: AxiosInstance,
  ) {
    this.client =
      httpClient ??
      axios.create({
        baseURL: baseUrl,
        timeout: 10000,
      });
  }

  private async getCachedBooks(providerCode: string): Promise<BollsBookEntry[]> {
    const cached = this.booksCache.get(providerCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries;
    }

    const path = `/get-books/${providerCode}/`;
    const { data } = await this.client.get<BollsBookEntry[]>(path);

    if (!Array.isArray(data)) {
      throw new Error("Unexpected books payload");
    }

    this.booksCache.set(providerCode, {
      entries: data,
      expiresAt: Date.now() + BOOKS_CACHE_TTL_MS,
    });

    return data;
  }

  async getBooks(): Promise<BookApiModel[]> {
    const catalogEntry = findBibleVersionCatalogEntry(DEFAULT_BIBLE_VERSION_CODE);
    const providerCode = catalogEntry?.providerCode ?? "RV1960";

    try {
      const books = await this.getCachedBooks(providerCode);

      return books.map((book) => ({
        name: book.name,
        abbrev: getLegacyAbbreviationForBookId(book.bookid) ?? "",
        chapters: book.chapters,
        testament: book.bookid <= 39 ? "old" : "new",
      }));
    } catch (error) {
      logAxiosError(`/get-books/${providerCode}/`, error);
      throw new Error("Failed to fetch bible books");
    }
  }

  async getVerses(params: GetVersesParams): Promise<VerseApiModel[]> {
    const { versionCode, book, chapter, fromVerse, toVerse } = params;
    const chapterData = await this.getChapter({ versionCode, book, chapter });
    const rangeEnd = toVerse ?? fromVerse;

    return chapterData.verses
      .filter((verse) => verse.number >= fromVerse && verse.number <= rangeEnd)
      .map((verse) => ({
        verse: verse.text,
        number: verse.number,
      }));
  }

  private async getBookMetadata(
    bookId: number,
    providerCode: string,
  ): Promise<{ name: string; numChapters: number }> {
    try {
      const books = await this.getCachedBooks(providerCode);
      const entry = books.find((book) => book.bookid === bookId);
      if (entry) {
        return { name: entry.name, numChapters: entry.chapters };
      }
    } catch (error) {
      logAxiosError(`/get-books/${providerCode}/`, error);
    }

    const fallback = BOOK_ENTRIES.find((bookEntry) => bookEntry.id === bookId);
    return { name: fallback?.spanish ?? "", numChapters: fallback?.chapters ?? 0 };
  }

  async getChapter(params: GetChapterParams): Promise<Chapter> {
    const { versionCode, book, chapter } = params;
    const normalizedBook = typeof book === "string" ? book.trim() : "";
    const normalizedVersion =
      typeof versionCode === "string" ? versionCode.trim() : "";

    if (!normalizedVersion) {
      throw new Error("Version code is required to fetch a chapter");
    }

    const catalogEntry = findBibleVersionCatalogEntry(normalizedVersion);
    if (!catalogEntry) {
      throw new Error(`Unsupported bible version code: ${versionCode}`);
    }

    if (!normalizedBook) {
      throw new Error("Book is required to fetch a chapter");
    }

    const bookId = resolveBookId(normalizedBook);
    if (bookId === undefined) {
      throw new Error(`Unknown bible book: ${book}`);
    }

    if (!Number.isInteger(chapter) || chapter <= 0) {
      throw new Error("Chapter must be greater than 0");
    }

    const path = `/get-text/${catalogEntry.providerCode}/${bookId}/${chapter}/`;

    try {
      const { data } = await this.client.get<BollsChapterVerse[]>(path);

      if (!Array.isArray(data)) {
        throw new Error("Unexpected chapter payload");
      }

      const metadata = await this.getBookMetadata(bookId, catalogEntry.providerCode);
      const verses: ChapterVerse[] = data.map((verse) => ({
        number: verse.verse,
        text: sanitizeVerseText(verse.text),
      }));

      return {
        testament: bookId <= 39 ? "old" : "new",
        name: metadata.name,
        numChapters: metadata.numChapters,
        chapter,
        verses,
      };
    } catch (error) {
      logAxiosError(path, error);
      throw new Error("Failed to fetch bible chapter");
    }
  }
}

export default BibleApiClient;
