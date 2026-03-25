import { Request, Response } from 'express'
import { z } from 'zod'
import { AppError } from '../../common/errors'
import {
  rebuildDailyAggregates,
  recordAppSessionStarted,
} from './analytics.service'

const appSessionSchema = z.object({
  device_id: z.string().min(1).optional().nullable(),
})

const aggregateRebuildSchema = z.object({
  trailing_days: z.number().int().positive().max(30).optional(),
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

export const appSessionStartedHandler = async (req: Request, res: Response) => {
  ensureAuth(req)
  const body = parseOrThrow(appSessionSchema, req.body)
  const result = await recordAppSessionStarted({
    userId: req.user!.sub,
    deviceId: body.device_id ?? null,
  })
  res.json({ data: result })
}

export const rebuildDailyAggregatesHandler = async (
  req: Request,
  res: Response
) => {
  ensureAuth(req)
  if (req.user!.role !== 'ADMIN') {
    throw new AppError('Insufficient permissions', 'FORBIDDEN', 403)
  }

  const body = parseOrThrow(aggregateRebuildSchema, req.body ?? {})
  const result = await rebuildDailyAggregates({
    trailingDays: body.trailing_days ?? 7,
  })

  res.json({ data: result })
}
