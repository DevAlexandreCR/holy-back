import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { getDailyVerseForUser } from './verse.service';

const widgetQuerySchema = z.object({
  version_id: z.coerce.number().int().positive().optional(),
});

const parseWidgetQuery = (query: unknown): { version_id?: number } => {
  try {
    return widgetQuerySchema.parse(query);
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error);
  }
};

export const getTodayVerse = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401);
  }

  const data = await getDailyVerseForUser(req.user.sub);
  res.json({ data });
};

export const getWidgetVerse = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401);
  }

  const { version_id } = parseWidgetQuery(req.query);
  const data = await getDailyVerseForUser(req.user.sub, { versionId: version_id });
  res.json({ data });
};
