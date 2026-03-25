import { Request, Response } from 'express'
import { z } from 'zod'
import { AppError } from '../../common/errors'
import {
  getDevotionalInsightDetail,
  getInsightsOverview,
  listDevotionalInsights,
} from './insights.service'

const listSchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
})

const parseOrThrow = <T>(schema: z.Schema<T>, payload: unknown): T => {
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error)
  }
}

const ensureAuth = (req: Request) => {
  if (!req.user) {
    throw new AppError('Authentication required', 'AUTH_REQUIRED', 401)
  }
}

export const getInsightsOverviewHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const result = await getInsightsOverview(req.user!.sub)
  res.json({ data: result })
}

export const listDevotionalInsightsHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const query = parseOrThrow(listSchema, req.query)
  const limitRaw = query.limit ? Number(query.limit) : undefined
  const result = await listDevotionalInsights({
    userId: req.user!.sub,
    cursor: query.cursor,
    limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
  })
  res.json({ data: result })
}

export const getDevotionalInsightDetailHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  const result = await getDevotionalInsightDetail({
    userId: req.user!.sub,
    devotionalId: req.params.id,
  })
  res.json({ data: result })
}
