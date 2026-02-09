import { Request, Response } from 'express';
import { AppError } from '../../common/errors';
import BibleApiClient from './bibleApiClient';
import { getAutocompleteSuggestions, searchBible } from './bibleSearch.service';
import { listActiveBibleVersions } from './bible.service';

const bibleApiClient = new BibleApiClient();

export const getBibleVersions = async (_req: Request, res: Response) => {
  const versions = await listActiveBibleVersions();
  res.json({
    data: versions.map((version) => ({
      id: version.id,
      api_code: version.apiCode,
      name: version.name,
      language: version.language,
    })),
  });
};

export const getBibleBooks = async (_req: Request, res: Response) => {
  try {
    const books = await bibleApiClient.getBooks();
    res.json({ data: books });
  } catch (error) {
    throw new AppError('Failed to fetch bible books', 'BIBLE_API_ERROR', 502, error);
  }
};

export const searchBibleVerses = async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) {
    throw new AppError('Authentication required', 'AUTH_REQUIRED', 401);
  }

  const { query, versionId } = req.body ?? {};
  if (typeof query !== 'string' || !query.trim()) {
    throw new AppError('No se pudo interpretar la búsqueda', 'INVALID_QUERY', 400);
  }

  const parsedVersionId =
    versionId === undefined || versionId === null ? undefined : Number(versionId);
  if (parsedVersionId !== undefined && Number.isNaN(parsedVersionId)) {
    throw new AppError('No se pudo interpretar la búsqueda', 'INVALID_QUERY', 400);
  }

  const result = await searchBible(userId, query, parsedVersionId);
  res.json({ data: result });
};

export const getBibleAutocomplete = async (req: Request, res: Response) => {
  const query = req.query.q;
  if (typeof query !== 'string' || !query.trim()) {
    res.json({ data: { suggestions: [] } });
    return;
  }

  const suggestions = await getAutocompleteSuggestions(query);
  res.json({ data: { suggestions } });
};
