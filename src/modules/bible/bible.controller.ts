import { Request, Response } from 'express';
import { AppError } from '../../common/errors';
import BibleApiClient from './bibleApiClient';
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
