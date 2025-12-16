import { Request, Response } from 'express'
import { z } from 'zod'
import { AppError } from '../../common/errors'
import { ensureSettings, setPreferredVersion, setTimezone, setWidgetFontSize } from './userSettings.service'

const versionSchema = z.object({
  version_id: z.number().int().positive(),
})

const timezoneSchema = z.object({
  timezone: z.string().min(1, 'timezone is required'),
})

const widgetFontSizeSchema = z.object({
  widget_font_size: z.enum(['small', 'medium', 'large', 'extra_large']),
})

const formatSettings = (settings: { preferredVersionId: number | null; timezone: string | null; widgetFontSize: string | null }) => ({
  preferred_version_id: settings.preferredVersionId,
  timezone: settings.timezone,
  widget_font_size: settings.widgetFontSize,
})

const parseOrThrow = <T>(schema: z.Schema<T>, payload: unknown): T => {
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error)
  }
}

export const updatePreferredVersion = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401)
  }

  const body = parseOrThrow(versionSchema, req.body)
  const settings = await setPreferredVersion(req.user.sub, body.version_id)
  res.json({ data: formatSettings(settings) })
}

export const updateTimezone = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401)
  }

  const body = parseOrThrow(timezoneSchema, req.body)
  const settings = await setTimezone(req.user.sub, body.timezone)
  res.json({ data: formatSettings(settings) })
}

export const updateWidgetFontSize = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401)
  }

  const body = parseOrThrow(widgetFontSizeSchema, req.body)
  const settings = await setWidgetFontSize(req.user.sub, body.widget_font_size)
  res.json({ data: formatSettings(settings) })
}

export const getSettings = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401)
  }

  const settings = await ensureSettings(req.user.sub)
  res.json({ data: formatSettings(settings) })
}
